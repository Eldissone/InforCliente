/**
 * Verificação temporária (somente leitura) da Área Financeira em browser real:
 * entra com um token de administrador e percorre todos os ecrãs, registando o
 * conteúdo renderizado, os gráficos desenhados e os erros de API/consola.
 */
const jwt = require("jsonwebtoken");
const puppeteer = require("puppeteer");
const { prisma } = require("../src/db");
const { config } = require("../src/config");

const PAGES = [
  ["/Financeiro/overview/", "overview"],
  ["/Financeiro/faturacao/registar/", "faturacao-registar"],
  ["/Financeiro/faturacao/prevista/", "faturacao-prevista"],
  ["/Financeiro/faturacao/resumo/", "faturacao-resumo"],
  ["/Financeiro/custos/registar/", "custos-registar"],
  ["/Financeiro/custos/realizados/", "custos-realizados"],
  ["/Financeiro/custos/overview/", "custos-overview"],
  ["/Financeiro/contas/", "contas"],
  ["/Financeiro/tesouraria/extratos/", "tesouraria-extratos"],
  ["/Financeiro/tesouraria/recebimentos/", "tesouraria-recebimentos"],
  ["/Financeiro/tesouraria/transferencias/", "tesouraria-transferencias"],
  ["/Financeiro/tesouraria/atm/", "tesouraria-atm"],
  ["/Financeiro/tesouraria/pagamentos/", "tesouraria-pagamentos"],
  ["/Financeiro/centro-pagamentos/", "centro-pagamentos"],
  ["/Financeiro/controlo/", "controlo"],
];

(async () => {
  const user = await prisma.user.findFirst({ where: { role: "financeiro" } });
  if (!user) throw new Error("Sem utilizador para o teste.");
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: "ADMIN", clientId: null },
    config.jwtSecret,
    { expiresIn: "1h" }
  );
  console.log(`Utilizador de teste: ${user.email} (${user.role})`);

  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const session = { addInitScript: null };
  await page.goto("http://localhost:5173/auth/login", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate(
    (t, u) => {
      localStorage.setItem("InfoCliente.token", t);
      localStorage.setItem("InfoCliente.user", JSON.stringify(u));
    },
    token,
    { id: user.id, email: user.email, name: user.name, role: "ADMIN", clientId: null }
  );

  const report = [];
  for (const [path, key] of PAGES) {
    const problems = [];
    const onResponse = (res) => {
      const url = res.url();
      if (res.status() >= 400 && url.includes("/api/")) problems.push(`${res.status()} ${url.replace(/^.*\/api/, "/api")}`);
    };
    const onConsole = (msg) => {
      if (msg.type() === "error" && !msg.text().includes("favicon")) problems.push(`console: ${msg.text()}`);
    };
    const onError = (err) => problems.push(`pageerror: ${err.message}`);
    page.on("response", onResponse);
    page.on("console", onConsole);
    page.on("pageerror", onError);

    try {
      await page.goto(`http://localhost:5173${path}`, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 2500));
      const info = await page.evaluate(() => {
        const root = document.getElementById("financeRoot");
        const charts = document.querySelectorAll(".apexcharts-svg").length;
        const cards = document.querySelectorAll(".finance-card").length;
        const rows = document.querySelectorAll("tbody tr").length;
        const empty = document.querySelectorAll(".finance-empty").length;
        const kpis = document.querySelectorAll(".finance-kpi-value").length;
        return {
          title: document.querySelector(".finance-title")?.textContent?.trim() || null,
          chars: (root?.innerText || "").replace(/\s+/g, " ").trim().length,
          hasPlaceholder: Boolean(document.querySelector(".finance-placeholder")),
          cards,
          kpis,
          charts,
          rows,
          empty,
          url: location.pathname,
          sample: (root?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 130),
        };
      });
      report.push({ key, ...info, problems });
    } catch (err) {
      report.push({ key, fatal: err.message, problems });
    } finally {
      page.off("response", onResponse);
      page.off("console", onConsole);
      page.off("pageerror", onError);
    }
  }

  await browser.close();
  await prisma.$disconnect();

  for (const r of report) {
    const flag = r.hasPlaceholder || r.fatal || r.problems.length ? "FALHA" : "ok";
    console.log(
      `${flag.padEnd(6)} ${String(r.key).padEnd(26)} cards=${r.cards ?? "-"} kpis=${r.kpis ?? "-"} graficos=${r.charts ?? "-"} linhas=${r.rows ?? "-"} vazio=${r.empty ?? "-"} texto=${r.chars ?? "-"}`
    );
    if (r.fatal) console.log(`       erro: ${r.fatal}`);
    if (r.problems?.length) console.log(`       ${[...new Set(r.problems)].join("\n       ")}`);
    if (r.sample) console.log(`       "${r.sample}..."`);
  }
  const failed = report.filter((r) => r.hasPlaceholder || r.fatal || r.problems.length);
  console.log(failed.length ? `\nECRÃS COM PROBLEMAS: ${failed.map((f) => f.key).join(", ")}` : "\nTodos os ecrãs renderizaram sem erros.");
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("ERRO:", err.message);
  process.exit(1);
});
