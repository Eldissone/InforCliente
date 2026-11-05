const test = require("node:test");
const assert = require("node:assert/strict");
const { computeInvoiceAmounts, creditNoteAmounts, invoiceOpenAmount, resolveCativoPercent } = require("./invoiceAmountsService");

const obra = {
  billingVatPercent: 14,
  billingWithholdingPercent: 6.5,
  billingCarPercent: 0,
  billingGuaranteePercent: 5,
};

test("sem cativação: líquido = ilíquido + IVA − retenção − garantia", () => {
  const a = computeInvoiceAmounts({ grossAmount: 30_000_000 }, obra);
  assert.equal(a.vatAmount, 4_200_000);
  assert.equal(a.vatCativoAmount, 0);
  assert.equal(a.withholdingAmount, 1_950_000);
  assert.equal(a.guaranteeAmount, 1_500_000);
  assert.equal(a.netAmount, 30_750_000);
  assert.equal(a.flagVatCativo, false);
});

test("IVA cativo a 50%: metade do IVA fica com o cliente", () => {
  const a = computeInvoiceAmounts({ grossAmount: 30_000_000, vatCativoPercent: 50 }, obra);
  assert.equal(a.vatAmount, 4_200_000);
  assert.equal(a.vatCativoAmount, 2_100_000);
  assert.equal(a.netAmount, 28_650_000);
  assert.equal(a.flagVatCativo, true);
});

test("IVA cativo a 100%: o IVA do documento fica registado mas não é recebido", () => {
  const a = computeInvoiceAmounts({ grossAmount: 30_000_000, vatCativoPercent: 100 }, obra);
  assert.equal(a.vatAmount, 4_200_000);
  assert.equal(a.vatCativoAmount, 4_200_000);
  assert.equal(a.netAmount, 26_550_000);
});

test("deduções acima do IVA: líquido abaixo do ilíquido", () => {
  const a = computeInvoiceAmounts({ grossAmount: 30_000_000, guaranteePercent: 10 }, obra);
  assert.equal(a.netAmount, 29_250_000);
});

test("a cativação vem da obra quando a fatura não a indica", () => {
  assert.equal(resolveCativoPercent({}, { billingVatCativoPercent: 50 }), 50);
  assert.equal(resolveCativoPercent({}, { billingVatCativo: true }), 100);
  assert.equal(resolveCativoPercent({}, {}), 0);
});

test("a marca antiga «cativo» equivale a 100%; a % explícita prevalece", () => {
  assert.equal(resolveCativoPercent({ flagVatCativo: true }, { billingVatCativoPercent: 50 }), 100);
  assert.equal(resolveCativoPercent({ flagVatCativo: false }, { billingVatCativoPercent: 50 }), 0);
  assert.equal(resolveCativoPercent({ vatCativoPercent: 50, flagVatCativo: true }, {}), 50);
  assert.equal(resolveCativoPercent({ vatCativoPercent: 150 }, {}), 100);
});

test("percentagem 0 explícita na fatura não é substituída pela da obra", () => {
  const a = computeInvoiceAmounts({ grossAmount: 1000, withholdingPercent: 0 }, obra);
  assert.equal(a.withholdingAmount, 0);
});

test("amortização do adiantamento: o ilíquido é o valor dos trabalhos menos a amortização", () => {
  const a = computeInvoiceAmounts({ workValue: 30_000_000, advanceDeductionAmount: 6_000_000 }, obra);
  assert.equal(a.workValue, 30_000_000);
  assert.equal(a.grossAmount, 24_000_000);
  assert.equal(a.vatAmount, 3_360_000);
  assert.equal(a.withholdingAmount, 1_560_000);
  assert.equal(a.guaranteeAmount, 1_200_000);
  assert.equal(a.netAmount, 24_600_000);
});

test("valor em aberto desconta recebimentos e notas de crédito; NC nunca fica em aberto", () => {
  assert.equal(invoiceOpenAmount({ netAmount: 100, receivedAmount: 30, creditedAmount: 20 }), 50);
  assert.equal(invoiceOpenAmount({ netAmount: 100, receivedAmount: 100, creditedAmount: 20 }), -20);
  assert.equal(invoiceOpenAmount({ kind: "NOTA_CREDITO", netAmount: -50, receivedAmount: 0 }), 0);
});

test("nota de crédito: valores proporcionais e a negativo", () => {
  const original = computeInvoiceAmounts({ grossAmount: 30_000_000, vatCativoPercent: 50 }, obra);
  const nc = creditNoteAmounts(original, 15_000_000);
  assert.equal(nc.grossAmount, -15_000_000);
  assert.equal(nc.vatAmount, -2_100_000);
  assert.equal(nc.vatCativoAmount, -1_050_000);
  assert.equal(nc.netAmount, -14_325_000);
  const full = creditNoteAmounts(original, 30_000_000);
  assert.equal(full.netAmount, -original.netAmount);
});

test("faturado (receita) exclui o adiantamento ainda por amortizar; NC a negativo", () => {
  const { billedRevenue } = require("./invoiceAmountsService");
  const docs = [
    { kind: "ADIANTAMENTO", grossAmount: 20_000_000 },
    { kind: "FATURA", grossAmount: 27_000_000, advanceDeductionAmount: 3_000_000 },
    { kind: "FATURA", grossAmount: 19_800_000, advanceDeductionAmount: 2_200_000 },
    { kind: "NOTA_CREDITO", grossAmount: -2_000_000 },
  ];
  const r = billedRevenue(docs);
  assert.equal(r.advanceOutstanding, 14_800_000);
  assert.equal(r.invoiced, 50_000_000); // 30 M + 22 M de trabalhos − 2 M da NC
});
