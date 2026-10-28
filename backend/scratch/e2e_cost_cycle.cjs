/**
 * Ciclo completo do lançamento manual de custo, pelo ecrã real:
 *   1. escolher uma obra com centros de custo e lançar um custo (400 pagos de 1000);
 *   2. confirmar que aparece na lista de custos com o valor pago e por liquidar;
 *   3. confirmar que aparece nas Contas a Pagar;
 *   4. apagar o registo de teste da base de dados.
 */
const jwt = require("jsonwebtoken");
const puppeteer = require("puppeteer");
const { prisma } = require("../src/db");
const { config } = require("../src/config");

const MARK = "TESTE VERIFICACAO CUSTO (apagar)";
const DOC = "TESTE-APAGAR-001";
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "ok   " : "FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  const user = await prisma.user.findFirst({ where: { role: "financeiro" } });
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: "ADMIN", clientId: null },
    config.jwtSecret,
    { expiresIn: "1h" }
  );

  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
  });

  await page.goto("http://localhost:5173/auth/login", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate(
    (t, u) => {
      localStorage.setItem("InfoCliente.token", t);
      localStorage.setItem("InfoCliente.user", JSON.stringify(u));
    },
    token,
    { id: user.id, email: user.email, name: user.name, role: "ADMIN", clientId: null }
  );

  await page.goto("http://localhost:5173/Financeiro/custos/registar/", { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector("#costNew", { timeout: 20000 });
  await page.click("#costNew");
  await page.waitForSelector("#mc_project", { timeout: 15000 });

  // Percorre as obras até encontrar uma com centros de custo ativos.
  const loaded = await page.evaluate(async () => {
    const sel = document.getElementById("mc_project");
    const ids = [...sel.options].map((o) => o.value).filter(Boolean);
    for (const id of ids) {
      sel.value = id;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 120));
        const center = document.getElementById("mc_center");
        if (!center.disabled && center.options.length > 1) {
          return { projectId: id, options: center.options.length, hint: document.getElementById("mc_centerHint").textContent.trim() };
        }
      }
    }
    return { projectId: null };
  });
  check("Obra com centros de custo encontrada", Boolean(loaded.projectId), JSON.stringify(loaded));
  if (!loaded.projectId) throw new Error("Sem obra com centros de custo para o teste.");

  const filled = await page.evaluate((mark, doc) => {
    const $ = (id) => document.getElementById(id);
    const set = (id, value) => {
      const el = $(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const center = $("mc_center");
    set("mc_center", center.options[1].value);
    set("mc_category", "ADMINISTRATIVO");
    set("mc_doc", doc);
    set("mc_desc", mark);
    set("mc_budgeted", "1000");
    set("mc_paid", "400");
    set("mc_method", "Transferência bancária");
    set("mc_type", "CREDITO");
    return {
      total: $("mc_sum_total").textContent.trim(),
      paid: $("mc_sum_paid").textContent.trim(),
      remaining: $("mc_sum_remaining").textContent.trim(),
      centerLabel: center.selectedOptions[0].textContent.trim(),
    };
  }, MARK, DOC);
  check(
    "Formulário soma total / pago / por liquidar",
    filled.total.startsWith("1 000") || filled.total.startsWith("1000")
      ? filled.paid.startsWith("400") && filled.remaining.startsWith("600")
      : false,
    JSON.stringify(filled)
  );

  await page.evaluate(() => document.querySelector(".fixed [data-primary]").click());
  await page.waitForFunction(() => !document.querySelector(".fixed [data-primary]"), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));

  const inList = await page.evaluate((mark) => {
    const rows = [...document.querySelectorAll("#costTable tbody tr")];
    const row = rows.find((tr) => tr.innerText.includes(mark));
    return row ? row.innerText.replace(/\s+/g, " ").trim().slice(0, 200) : null;
  }, MARK);
  check("Custo lançado aparece na lista de custos", Boolean(inList), inList ? inList.slice(0, 150) : "não encontrado");

  const cost = await prisma.costPayment.findFirst({ where: { docNumber: DOC } });
  check("Registo gravado na base de dados (400 pagos de 1000)", Boolean(cost), cost ? `pago=${cost.paidAmount} previsto=${cost.budgetedAmount} estado=${cost.status} fonte=${cost.sourceType} confirmado=${cost.confirmationStatus}` : "");

  // Contas a pagar: o que falta liquidar (600) deve entrar no total.
  const payablesNow = await page.evaluate(async () => {
    const res = await fetch("http://127.0.0.1:4000/finance/payables", {
      headers: { Authorization: `Bearer ${localStorage.getItem("InfoCliente.token")}` },
    });
    const data = await res.json();
    return data.totals || null;
  });
  const inPayables = await page.evaluate(async (doc) => {
    const res = await fetch("http://127.0.0.1:4000/finance/payables", {
      headers: { Authorization: `Bearer ${localStorage.getItem("InfoCliente.token")}` },
    });
    const data = await res.json();
    const item = (data.items || []).find((i) => i.docNumber === doc);
    return item ? item : { notFound: true, docs: (data.items || []).map((i) => i.docNumber) };
  }, DOC);
  check(
    "O custo entra nas Contas a Pagar com os 600 em falta",
    !inPayables.notFound && Number(inPayables.remaining) === 600,
    JSON.stringify(inPayables).slice(0, 250)
  );

  await browser.close();

  if (cost) await prisma.costPayment.delete({ where: { id: cost.id } });
  const leftovers = await prisma.costPayment.count({ where: { docNumber: DOC } });
  check("Registo de teste removido da base de dados", leftovers === 0, `restam ${leftovers}`);
  await prisma.$disconnect();

  check("Sem erros de consola/página", errors.length === 0, errors.slice(0, 3).join(" | "));
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `\nFALHARAM: ${failed.map((f) => f.name).join("; ")}` : "\nCiclo do custo verificado.");
  process.exit(failed.length ? 1 : 0);
})().catch(async (err) => {
  console.error("ERRO:", err.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
