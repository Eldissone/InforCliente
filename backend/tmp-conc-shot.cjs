const puppeteer = require("puppeteer");

const today = new Date(2026, 10, 17);
const d = (offset) => {
  const x = new Date(today);
  x.setDate(x.getDate() + offset);
  return x.toISOString().slice(0, 10);
};

const cards = [
  { id: "c1", label: "BAI — Conta principal ···· 4021", bank: "BAI", lastDigits: "4021", type: "CONTA", active: true, currency: "AOA", fund: null, group: "MAIN", balance: 48_320_540.22 },
  { id: "c2", label: "BFA — Obras ···· 7788", bank: "BFA", lastDigits: "7788", type: "CONTA", active: true, currency: "AOA", fund: null, group: "MAIN", balance: 12_804_110.0 },
  { id: "c3", label: "Fundo de Maneio — Obra Talatona", bank: "BAI", lastDigits: "9902", type: "PREPAGO", active: true, currency: "AOA", fund: "FM Talatona", group: "FM", balance: 1_450_000.0 },
];

const meta = {
  types: [
    { code: "PF", label: "Pagamento a Fornecedor", dir: "SAIDA" },
    { code: "RC", label: "Recebimento de Cliente", dir: "ENTRADA" },
    { code: "TRF INT", label: "Transferência Interna", dir: null },
    { code: "SL", label: "Salário", dir: "SAIDA", soon: true },
    { code: "AD SL", label: "Adiantamento de Salário", dir: "SAIDA", soon: true },
    { code: "PE", label: "Pagamento ao Estado", dir: "SAIDA", soon: true },
    { code: "EMP", label: "Empréstimo", dir: null, soon: true },
    { code: "CGM", label: "Amortização de Crédito", dir: "SAIDA", soon: true },
    { code: "CC", label: "Cartão de Crédito", dir: "SAIDA" },
    { code: "ENC", label: "Encargos Bancários (comissões, despesas, IVA, juros, imposto de selo)", dir: "SAIDA" },
    { code: "SC", label: "Sócios", dir: null },
    { code: "REEMB", label: "Devolução / Reembolso (pagamento devolvido, fundo de maneio ou fornecedor)", dir: null },
  ],
  noRequestReasons: ["Comissão bancária", "Juros / imposto de selo", "Transferência entre contas", "Pagamento ao Estado", "Reembolso", "Outro"],
  cards,
  rules: [],
  subtypes: [
    { typeCode: "ENC", name: "COMISSÃO — MANUTENÇÃO DE CONTA", movements: 2 },
    { typeCode: "ENC", name: "IVA S/ COMISSÕES", movements: 1 },
    { typeCode: "ENC", name: "JUROS DE CRÉDITO", movements: 0 },
  ],
};

const mv = (o) => ({
  id: o.id,
  movementDate: o.movementDate,
  effectiveDate: o.movementDate,
  cardId: o.cardId || "c1",
  cardLabel: (cards.find((c) => c.id === (o.cardId || "c1")) || cards[0]).label,
  description: o.description,
  docNumber: o.docNumber || null,
  amount: o.amount,
  direction: o.direction,
  typeCode: o.typeCode ?? null,
  subtype: o.subtype || null,
  typeAuto: Boolean(o.typeAuto),
  reconciled: Boolean(o.reconciled),
  reconcileKind: o.reconcileKind || null,
  reconcileReason: o.reconcileReason || null,
  reconciledBy: o.reconciled ? "Ana Silva" : null,
  reconciledAt: o.reconciled ? `${o.movementDate}T09:12:00.000Z` : null,
  proofPath: o.proofPath || null,
  proofName: o.proofName || null,
  proofMissing: Boolean(o.proofMissing),
  transferCardId: o.transferCardId || null,
  transferCardLabel: o.transferCardLabel || null,
  transferPairId: o.transferPairId || null,
  refundedAmount: o.refundedAmount || 0,
  refundOfId: o.refundOfId || null,
  note: o.note || "",
  ccCode: o.ccCode || null,
  statementName: o.statementName || "extrato-novembro.xlsx",
  paymentRequest: o.paymentRequest || null,
  receipts: o.receipts || [],
});

const movements = [
  mv({
    id: "m1",
    movementDate: d(-1),
    description: "TRF KWIK PF | FORNECEDOR CIMENTOS ANGOLA",
    docNumber: "2026/8841",
    amount: 2_340_000,
    direction: "SAIDA",
    typeCode: "PF",
    typeAuto: true,
    reconciled: true,
    reconcileKind: "REQUEST",
    proofPath: "uploads/recon/proof-8841.pdf",
    proofName: "comprovativo-8841.pdf",
    ccCode: "OBR-241",
    paymentRequest: { id: "rp1", number: "RP-2026-0142", supplierName: "Cimentos Angola, SA", costCenterCode: "OBR-241", firstItem: "Cimento Portland 50kg — 400 sacos", hasInvoice: true },
  }),
  mv({
    id: "m2",
    movementDate: d(-2),
    description: "IVA SOBRE COMISSÕES",
    amount: 14_250,
    direction: "SAIDA",
    typeCode: "ENC",
    subtype: "IVA S/ COMISSÕES",
    typeAuto: true,
    reconciled: true,
    reconcileKind: "AUTO",
  }),
  mv({
    id: "m3",
    movementDate: d(-3),
    description: "SPTR DE CONSTRUTORA ATLANTICO LDA",
    docNumber: "FT 2026/148",
    amount: 2_340_000,
    direction: "ENTRADA",
    typeCode: "RC",
    typeAuto: true,
    reconciled: true,
    reconcileKind: "INVOICE",
    proofPath: "uploads/recon/rc-148.pdf",
    receipts: [{ invoiceNumber: "FT 2026/148", client: "Construtora Atlântico, Lda.", invoiceHasPdf: true }],
  }),
  mv({
    id: "m4",
    movementDate: d(-4),
    description: "TRF KWIK PF | ENGENHARIA SUL SA",
    docNumber: "2026/8830",
    amount: 1_890_000,
    direction: "SAIDA",
    typeCode: "PF",
    typeAuto: true,
    reconciled: true,
    reconcileKind: "REQUEST",
    proofMissing: true,
    ccCode: "OBR-188",
    paymentRequest: { id: "rp2", number: "RP-2026-0139", supplierName: "Engenharia Sul, SA", costCenterCode: "OBR-188", firstItem: "Betão pronto B25 — 18 m³", hasInvoice: false },
  }),
  mv({
    id: "m5",
    movementDate: d(-5),
    description: "TRF INT — PARA BFA OBRAS",
    amount: 5_000_000,
    direction: "SAIDA",
    typeCode: "TRF INT",
    typeAuto: true,
    transferCardId: "c2",
    transferCardLabel: "BFA — Obras ···· 7788",
  }),
  mv({
    id: "m6",
    movementDate: d(-5),
    description: "TRF INT — DE BAI PRINCIPAL",
    amount: 5_000_000,
    direction: "ENTRADA",
    cardId: "c2",
    typeCode: "TRF INT",
    typeAuto: true,
    reconciled: true,
    reconcileKind: "TRANSFER",
    transferPairId: "m5",
    transferCardId: "c1",
    transferCardLabel: "BAI — Conta principal ···· 4021",
  }),
  mv({
    id: "m7",
    movementDate: d(-6),
    description: "PAGAMENTOS AO ESTADO — IVA OUTUBRO",
    amount: 842_300,
    direction: "SAIDA",
  }),
  mv({
    id: "m8",
    movementDate: d(-7),
    description: "TPA- POSTO COMBUSTIVEL KILAMBA",
    amount: 96_400,
    direction: "SAIDA",
    typeCode: "PF",
    typeAuto: true,
    ccCode: "CC-FROTA",
  }),
  mv({
    id: "m9",
    movementDate: d(-8),
    description: "MANUTENCAO CONTA — COMISSAO MENSAL",
    amount: 7_500,
    direction: "SAIDA",
    typeCode: "ENC",
    subtype: "COMISSÃO — MANUTENÇÃO DE CONTA",
    typeAuto: true,
  }),
  mv({
    id: "m10",
    movementDate: d(-9),
    description: "DEVOLUCAO DE PAGAMENTO — FORNECEDOR",
    amount: 310_000,
    direction: "ENTRADA",
    typeCode: "REEMB",
  }),
  mv({
    id: "m11",
    movementDate: d(-11),
    description: "TRF HBMB | MANUTENCAO DE EQUIPAMENTO",
    docNumber: "2026/8812",
    amount: 415_800,
    direction: "SAIDA",
    typeCode: "PF",
    typeAuto: true,
    reconciled: true,
    reconcileKind: "NONE",
    reconcileReason: "Sem pedido — despesa aprovada por email",
    proofPath: "uploads/recon/proof-8812.pdf",
  }),
  mv({
    id: "m12",
    movementDate: d(-12),
    description: "TRANSFERENCIA RECEBIDA — CLIENTE CAMARA CACUACO",
    amount: 6_500_000,
    direction: "ENTRADA",
    typeCode: "RC",
    typeAuto: true,
    reconciled: true,
    reconcileKind: "INVOICE",
    receipts: [{ invoiceNumber: "FT 2026/097", client: "Câmara de Cacuaco", invoiceHasPdf: false }],
  }),
  mv({
    id: "m13",
    movementDate: d(-14),
    description: "PAG. AUTOM — CARTAO CREDITO BAI",
    amount: 268_900,
    direction: "SAIDA",
    typeCode: "CC",
    typeAuto: true,
  }),
  mv({
    id: "m14",
    movementDate: d(-15),
    description: "COM EMISS — TRANSFERENCIA INTERNACIONAL",
    amount: 23_100,
    direction: "SAIDA",
    typeCode: "ENC",
    subtype: "COMISSÃO — TRANSFERÊNCIA",
    typeAuto: true,
    reconciled: true,
    reconcileKind: "AUTO",
  }),
];

const fixtures = {
  "/finance/reconciliation/meta": meta,
  "/finance/reconciliation/movements": { items: movements },
  "/permissions/me": { map: {}, tabFallbacks: {} },
};

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("InfoCliente.user", JSON.stringify({ id: "u1", name: "Ana Silva", role: "admin", email: "ana@teste" }));
    localStorage.setItem("InfoCliente.token", "test-token");
  });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (!/^http:\/\/(127\.0\.0\.1|localhost):4000/.test(url)) return req.continue();
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    };
    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors, body: "" });
    const { pathname } = new URL(url);
    const body = fixtures[pathname] || { items: [] };
    return req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
  });

  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto("http://localhost:5173/Financeiro/tesouraria/conciliacao-bancaria/", { waitUntil: "networkidle0" });
  await page.waitForSelector(".fo-table tbody tr", { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: process.argv[2] || "tmp-conc-1440.png", fullPage: true });

  const metrics = await page.evaluate(() => {
    const s = document.querySelector(".fo-table-scroll");
    const rows = document.querySelectorAll(".fo-table tbody tr").length;
    return {
      rows,
      scroll: s ? [s.scrollWidth, s.clientWidth] : null,
      header: (() => {
        const h = document.querySelector(".finance-page-header");
        return h ? Math.round(h.getBoundingClientRect().height) : null;
      })(),
      table: document.querySelector(".fo-table")?.getBoundingClientRect().width | 0,
    };
  });
  console.log("page:", JSON.stringify(metrics), "errors:", errors.slice(0, 6));

  if (process.argv[3] === "mobile") {
    await page.setViewport({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: "tmp-conc-390.png", fullPage: true });
  }

  await browser.close();
})();
