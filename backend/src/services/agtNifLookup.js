const dns = require("dns").promises;
const puppeteer = require("puppeteer");

const AGT_HOST = "portaldocontribuinte.minfin.gov.ao";
const AGT_NIF_URL =
  "https://portaldocontribuinte.minfin.gov.ao/consultar-nif-do-contribuinte";
const AGT_FALLBACK_IP = "80.88.9.121";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--ignore-certificate-errors",
];

const MISSING = new Set(["", "não encontrado", "nao encontrado", "n/a", "-", "—"]);
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const nifCache = new Map();

function normalizeNif(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function isMissing(value) {
  return MISSING.has(String(value || "").trim().toLowerCase());
}

function parseVatPercent(regimeIva) {
  const text = String(regimeIva || "").trim();
  if (isMissing(text)) return null;
  const lower = text.toLowerCase();
  if (lower.includes("isent")) return 0;
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (match) return Number(match[1].replace(",", "."));
  if (lower.includes("geral") || lower.includes("simplific")) return 14;
  return null;
}

function getCached(nif) {
  const hit = nifCache.get(nif);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    nifCache.delete(nif);
    return null;
  }
  return hit.data;
}

function setCached(nif, data) {
  nifCache.set(nif, { at: Date.now(), data });
}

async function resolveAgtAddress() {
  try {
    const { address } = await dns.lookup(AGT_HOST);
    if (address) return address;
  } catch {
    /* DNS local falhou */
  }

  const resolver = new dns.Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  try {
    const addrs = await resolver.resolve4(AGT_HOST);
    if (addrs?.[0]) return addrs[0];
  } catch {
    /* DNS público falhou */
  }

  return AGT_FALLBACK_IP;
}

async function launchHeadlessBrowser() {
  const address = await resolveAgtAddress();
  const args = [
    ...LAUNCH_ARGS,
    `--host-resolver-rules=MAP ${AGT_HOST} ${address}, MAP www.${AGT_HOST} ${address}`,
  ];

  try {
    return await puppeteer.launch({
      headless: "new",
      channel: "chrome",
      args,
    });
  } catch {
    return puppeteer.launch({
      headless: "new",
      args,
    });
  }
}

async function scrapeAgtNif(nif) {
  const browser = await launchHeadlessBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(AGT_NIF_URL, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    const inputSelector = 'input[id$="txtNIFNumber"], input[name$="txtNIFNumber"], input[type="text"]';
    await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
    await page.click(inputSelector, { clickCount: 3 });
    await page.type(inputSelector, nif, { delay: 40 });

    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((el) =>
        /pesquisar/i.test(el.innerText || "")
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) await page.keyboard.press("Enter");

    await page
      .waitForFunction(
        () => {
          const panel = document.getElementById("showpanelNIF_content");
          const growl = document.querySelector(".ui-growl-item-content, .ui-messages-error");
          return Boolean((panel && panel.innerText.trim()) || growl);
        },
        { timeout: 25000 }
      )
      .catch(() => {});

    const dados = await page.evaluate(() => {
      const normalize = (value) =>
        String(value || "")
          .replace(/:$/, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const byLabel = (rotulo) => {
        const wanted = normalize(rotulo);
        const labels = Array.from(
          document.querySelectorAll("#showpanelNIF label, #panelNIF label")
        );
        for (const el of labels) {
          if (normalize(el.innerText) !== wanted) continue;
          const group = el.closest(".form-group");
          const valueEl = group?.querySelector(".col-sm-6:last-child");
          const value = (valueEl?.innerText || el.nextElementSibling?.innerText || "").trim();
          if (value && normalize(value) !== wanted) return value;
        }
        return null;
      };

      return {
        nome: byLabel("Nome") || "Não encontrado",
        tipo: byLabel("Tipo") || "Não encontrado",
        estado: byLabel("Estado") || "Não encontrado",
        inadimplente: byLabel("Inadimplente") || "Não encontrado",
        regimeIva: byLabel("Regime de IVA") || "Não encontrado",
      };
    });

    const nome = isMissing(dados.nome) ? null : dados.nome;
    const tipo = isMissing(dados.tipo) ? null : dados.tipo;
    const estado = isMissing(dados.estado) ? null : dados.estado;
    const inadimplente = isMissing(dados.inadimplente) ? null : dados.inadimplente;
    const regimeIva = isMissing(dados.regimeIva) ? null : dados.regimeIva;

    return {
      found: Boolean(nome),
      nif,
      nome,
      tipo,
      estado,
      inadimplente,
      regimeIva,
      vatPercent: parseVatPercent(regimeIva),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function consultarNifAgt(rawNif) {
  const nif = normalizeNif(rawNif);
  if (!nif || nif.length < 9) {
    const err = new Error("Indique um NIF válido (mínimo 9 dígitos).");
    err.status = 400;
    throw err;
  }

  const cached = getCached(nif);
  if (cached) return cached;

  try {
    const data = await scrapeAgtNif(nif);
    if (data.found) setCached(nif, data);
    return data;
  } catch (error) {
    console.error("AGT NIF lookup failed:", error);
    const err = new Error(
      /ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(String(error.message || ""))
        ? "O Portal da AGT não está acessível neste momento (falha de DNS/rede). Verifique a internet e tente novamente."
        : `Erro ao consultar o Portal da AGT: ${error.message || "falha na ligação"}`
    );
    err.status = 503;
    throw err;
  }
}

module.exports = {
  normalizeNif,
  parseVatPercent,
  consultarNifAgt,
};
