/**
 * Desenhar a proposta — **um só modelo para tudo**.
 *
 * O modelo `templates/proposta-mbt.html` é o documento completo em HTML: as
 * páginas A4, os tipos de letra e os ícones vão lá dentro, e o conteúdo entra
 * no lugar do marcador `/*DADOS*​/`. O mesmo ficheiro serve:
 *   - a **pré-visualização** no ecrã (o navegador faz a substituição),
 *   - o **PDF** (o servidor imprime-o com o puppeteer),
 *   - o **HTML** para quem quiser guardar ou imprimir à mão.
 * Por isso é que o que se vê é o que sai — foi assim no protótipo e é assim cá.
 *
 * O PDF **não** é feito de imagens, ao contrário do protótipo (que fotografava
 * cada página com o html2canvas): o puppeteer imprime a página tal como ela é,
 * pelo que o texto fica pesquisável e o ficheiro muito mais leve.
 */

const fs = require("fs");
const path = require("path");
const { readStoredFile } = require("../../utils/storage");

const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "proposta-mbt.html");
const MARKER = "/*DADOS*/";

let cached = null;

/** O modelo, lido uma vez. */
function loadTemplate() {
  if (!cached) {
    const html = fs.readFileSync(TEMPLATE_PATH, "utf8");
    if (!html.includes(MARKER)) throw new Error("MODELO_SEM_MARCADOR");
    cached = html;
  }
  return cached;
}

/** A data da última alteração do modelo, para o navegador o guardar em cache. */
function templateStat() {
  const s = fs.statSync(TEMPLATE_PATH);
  return { mtime: s.mtime, size: s.size };
}

/**
 * As imagens do documento, metidas dentro dele.
 *
 * As imagens vivem em `uploads/…`, que é um caminho do servidor: o navegador
 * sem sessão e o `puppeteer` a imprimir não lhe chegam. Antes de desenhar,
 * trocam-se por `data:` — assim o PDF sai completo e o HTML extraído abre em
 * qualquer lado, sem depender do servidor (é o que o protótipo fazia no
 * `genHtml`).
 *
 * Uma imagem que não se encontre fica como está, em vez de partir o documento.
 */
async function inlineImages(doc) {
  const D = doc;
  const porCarregar = [];
  const marcar = (obj, campo) => {
    const v = obj?.[campo];
    if (typeof v === "string" && v && !v.startsWith("data:") && !/^https?:/i.test(v)) porCarregar.push({ obj, campo, v });
  };

  marcar(D.capa, "imagem");
  marcar(D.contactos?.assinatura, "img");
  (D.memoria?.fotos || []).forEach((f) => marcar(f, "imagem"));
  (D.extras || []).forEach((x) => marcar(x, "imagem"));
  (D.tracado?.mapas || []).forEach((m) => marcar(m, "imagem"));

  for (const { obj, campo, v } of porCarregar) {
    try {
      const f = await readStoredFile(v);
      if (f) obj[campo] = `data:${f.contentType || "image/jpeg"};base64,${f.buffer.toString("base64")}`;
    } catch {
      /* fica o caminho; vale mais uma imagem em falta do que um documento por gerar */
    }
  }
  return D;
}

/**
 * O documento pronto a abrir.
 *
 * `</` dentro do JSON tem de ser escapado: o JSON vai dentro de um `<script>` e
 * um `</script>` no meio de um texto fechava o bloco e partia a página.
 *
 * @param {object} doc documento já finalizado (`finalizeDocument`)
 * @param {boolean} [preview] esconde a barra de ferramentas do modelo
 */
function renderHtml(doc, { preview = false } = {}) {
  const json = JSON.stringify(doc || {}).replace(/<\//g, "<\\/");
  let html = loadTemplate().replace(MARKER, json);
  if (preview) {
    html = html.replace(
      "</head>",
      "<style>#barra{display:none!important}body{background:#dfe5ea!important;margin:0}.page{margin:6mm auto!important}</style></head>"
    );
  }
  return html;
}

/**
 * O PDF, impresso do mesmo HTML.
 *
 * Espera pelo sinal do modelo (`body[data-done="1"]`), que só aparece depois de
 * os tipos de letra e as imagens estarem carregados e a paginação refeita —
 * imprimir antes disso corta as páginas a meio.
 */
async function renderPdf(doc, { timeoutMs = 60000 } = {}) {
  const puppeteer = require("puppeteer");
  const html = renderHtml(await inlineImages(doc), { preview: false });
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
  // Primeiro o Chrome instalado na máquina (é o que o `agtNifLookup` também
  // faz); só depois o Chrome que o puppeteer descarrega para si, que pode não
  // estar presente.
  const browser = await puppeteer
    .launch({ headless: "new", channel: "chrome", args })
    .catch(() => puppeteer.launch({ headless: "new", args }));
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForFunction('document.body && document.body.dataset.done === "1"', { timeout: timeoutMs });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      // O modelo já desenha as margens dentro de cada página A4.
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }
}

/** O nome do ficheiro, como no protótipo: `Proposta_<ref>_Rev<n>.<ext>`. */
function fileName(doc, ext) {
  const d = doc?.documento || {};
  return `${`Proposta_${d.referencia || "MBT"}_Rev${d.revisao ?? "0"}`.replace(/[^A-Za-z0-9_\-.]/g, "_")}.${ext}`;
}

module.exports = { TEMPLATE_PATH, loadTemplate, templateStat, renderHtml, renderPdf, inlineImages, fileName };
