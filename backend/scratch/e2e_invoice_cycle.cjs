/**
 * Ciclo completo da fatura, pelo ecrã real:
 *   1. lançar uma fatura com V. Ilíquido 1 000 000 e recebimento parcial de 400 000;
 *   2. confirmar que aparece na lista de faturas e nas Contas a Receber em falta;
 *   3. registar o restante pelo botão «Registar recebimento» e confirmar que fica paga;
 *   4. apagar a fatura e os recebimentos de teste.
 */
const jwt = require("jsonwebtoken");
const puppeteer = require("puppeteer");
const { prisma } = require("../src/db");
const { config } = require("../src/config");

const DOC = "TESTE-APAGAR-FAT-001";
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

  const api = async (path) => {
    const res = await fetch(`http://127.0.0.1:4000${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

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

  const receivablesBefore = await api("/finance/receivables");

  await page.goto("http://localhost:5173/Financeiro/faturacao/registar/", { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector("#invNew", { timeout: 20000 });
  await page.click("#invNew");
  await page.waitForSelector("#inv_project", { timeout: 15000 });

  const filled = await page.evaluate((doc) => {
    const $ = (id) => document.getElementById(id);
    const set = (id, value) => {
      const el = $(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const project = $("inv_project");
    const option = [...project.options].find((o) => o.value);
    set("inv_project", option.value);
    set("inv_docNumber", doc);
    set("inv_gross", "1000000");
    set("inv_vat", "14");
    set("inv_withholding", "6.5");
    const net = $("pv_net").textContent.trim();
    document.querySelector('#rcv_choice .finance-choice[data-mode="recebido"]').click();
    set("inv_received", "400000");
    set("inv_receivedMethod", "Transferência bancária");
    return {
      obra: option.textContent.trim(),
      net,
      liquido: $("rcv_net").textContent.trim(),
      recebido: $("rcv_sum_received").textContent.trim(),
      emFalta: $("rcv_sum_missing").textContent.trim(),
    };
  }, DOC);
  check("Fatura: pré-visualização calcula o valor líquido", Number(filled.net.replace(/[^\d]/g, "")) > 0, JSON.stringify(filled));

  await page.evaluate(() => document.querySelector(".fixed [data-primary]").click());
  await page.waitForFunction(() => !document.querySelector(".fixed [data-primary]"), { timeout: 25000 });
  await new Promise((r) => setTimeout(r, 2500));

  const invoice = await prisma.invoice.findFirst({ where: { docNumber: DOC }, include: { receipts: true } });
  check(
    "Fatura gravada com IVA e retenção",
    Boolean(invoice) && Number(invoice.grossAmount) === 1000000 && invoice.receipts.length === 1,
    invoice
      ? `ilíquido=${invoice.grossAmount} iva=${invoice.vatPercent} retenção=${invoice.withholdingPercent} líquido=${invoice.netAmount} recebido=${invoice.receivedAmount} estado=${invoice.status} recebimentos=${invoice.receipts.length}`
      : "não criada"
  );

  const inList = await page.evaluate((doc) => {
    const row = [...document.querySelectorAll("#invTable tbody tr")].find((tr) => tr.innerText.includes(doc));
    return row ? row.innerText.replace(/\s+/g, " ").trim().slice(0, 220) : null;
  }, DOC);
  check("Fatura aparece na lista de faturas", Boolean(inList), inList ? inList.slice(0, 170) : "não encontrada");

  // Contas a receber: apenas o que falta receber deve aparecer.
  const receivablesAfter = await api("/finance/receivables");
  const item = (receivablesAfter.body?.items || []).find((i) => i.docNumber === DOC);
  const expectedMissing = invoice ? Math.max(Number(invoice.netAmount) - 400000, 0) : 0;
  check(
    "Contas a receber mostram só o que está em falta",
    Boolean(item) && Number(item.missingAmount) === Math.round(expectedMissing * 100) / 100,
    item ? `em falta=${item.missingAmount} esperado=${expectedMissing} estado=${item.status}` : "fatura não aparece nas contas a receber"
  );
  check(
    "Total das contas a receber inclui a fatura de teste",
    Number(receivablesAfter.body?.total) > Number(receivablesBefore.body?.total),
    `antes=${receivablesBefore.body?.total} depois=${receivablesAfter.body?.total}`
  );

  // Registar o resto com o botão «Registar recebimento» da lista.
  await page.evaluate((doc) => {
    const row = [...document.querySelectorAll("#invTable tbody tr")].find((tr) => tr.innerText.includes(doc));
    row.querySelector('[data-action="receipt"]').click();
  }, DOC);
  await page.waitForSelector("#rec_amount", { timeout: 15000 });
  // O modal propõe já o valor em falta — aceitar a sugestão deve fechar a fatura.
  const receiptModal = await page.evaluate(() => ({
    note: document.querySelector(".fixed .finance-note")?.textContent?.replace(/\s+/g, " ").trim() || null,
    suggested: document.getElementById("rec_amount").value,
  }));
  check("Modal de recebimento propõe o valor em falta", Number(receiptModal.suggested) > 0, JSON.stringify(receiptModal));
  await page.evaluate(() => document.querySelector(".fixed [data-primary]").click());
  await page.waitForFunction(() => !document.querySelector(".fixed [data-primary]"), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2000));

  const after = await prisma.invoice.findFirst({ where: { docNumber: DOC }, include: { receipts: true } });
  check(
    "Segundo recebimento fecha a fatura",
    Boolean(after) && after.receipts.length === 2 && after.status === "PAGO_TOTAL",
    after ? `recebido=${after.receivedAmount} líquido=${after.netAmount} estado=${after.status} recebimentos=${after.receipts.length}` : ""
  );

  await browser.close();

  const receivablesEnd = await api("/finance/receivables");
  const stillOpen = (receivablesEnd.body?.items || []).some((i) => i.docNumber === DOC);
  check("Fatura paga sai das contas a receber", !stillOpen, `total em aberto=${receivablesEnd.body?.total}`);

  // Limpeza.
  if (invoice) {
    await prisma.invoiceReceipt.deleteMany({ where: { invoiceId: invoice.id } });
    await prisma.invoice.delete({ where: { id: invoice.id } });
  }
  const left = await prisma.invoice.count({ where: { docNumber: DOC } });
  check("Fatura de teste removida da base de dados", left === 0, `restam ${left}`);
  await prisma.$disconnect();

  check("Sem erros de consola/página", errors.length === 0, errors.slice(0, 3).join(" | "));
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `\nFALHARAM: ${failed.map((f) => f.name).join("; ")}` : "\nCiclo da fatura verificado.");
  process.exit(failed.length ? 1 : 0);
})().catch(async (err) => {
  console.error("ERRO:", err.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
