const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXTRA_FISCAL_FIELDS,
  computeExtraFiscal,
  buildExtraFiscalAmounts,
  extraPayableAmount,
  extraWithheldAmount,
  describeExtraFiscal,
  decorateExtraFiscal,
} = require("../src/services/extraRequestFiscal");

const grossRequest = (over = {}) => ({
  amount: 1000000,
  fiscalInputMode: "gross",
  fiscalApplyVat: true,
  fiscalApplyWithholding: true,
  fiscalApplyDiscount: false,
  fiscalVatPercent: 14,
  fiscalWithholdingPercent: 6.5,
  fiscalDiscountPercent: null,
  ...over,
});

// ─── O defeito que isto corrige ─────────────────────────────────────────────

test("o líquido desconta a retenção do valor bruto", () => {
  const f = computeExtraFiscal(grossRequest());
  assert.equal(f.gross, 1000000);
  assert.equal(f.base, 877192.98);
  assert.equal(f.vat, 122807.02);
  assert.equal(f.withholding, 57017.54);
  assert.equal(f.net, 942982.46);
  assert.equal(f.hasFiscal, true);
});

test("a retenção que fica por entregar é a diferença entre o bruto e o líquido", () => {
  const f = computeExtraFiscal(grossRequest());
  assert.equal(Math.round((f.gross - f.net) * 100) / 100, f.withholding);
});

test("o bruto é o valor escrito, não o reconstruído da base", () => {
  // Com arredondamento da base, base − desconto + IVA pode dar um cêntimo a menos.
  const f = computeExtraFiscal(grossRequest({ amount: 333333.33 }));
  assert.equal(f.gross, 333333.33);
});

test("sem retenção, o líquido é o bruto", () => {
  const f = computeExtraFiscal(grossRequest({ fiscalApplyWithholding: false, fiscalWithholdingPercent: null }));
  assert.equal(f.net, 1000000);
  assert.equal(f.withholding, 0);
  assert.equal(f.hasFiscal, true);
});

test("o desconto entra na base e por isso baixa o IVA e a retenção", () => {
  const semDesconto = computeExtraFiscal(grossRequest());
  const comDesconto = computeExtraFiscal(
    grossRequest({ fiscalApplyDiscount: true, fiscalDiscountPercent: 5 })
  );
  assert.ok(comDesconto.base > semDesconto.base, "o mesmo bruto com desconto implica base maior");
  assert.ok(comDesconto.discount > 0);
  // O bruto escrito é o mesmo; o que muda é a repartição.
  assert.equal(comDesconto.gross, 1000000);
  assert.equal(
    Math.round((comDesconto.base - comDesconto.discount + comDesconto.vat) * 100) / 100,
    1000000
  );
});

// ─── Modo base: não há fiscalidade ──────────────────────────────────────────

test("em modo base não há impostos, mesmo com percentagens no corpo", () => {
  const f = computeExtraFiscal(grossRequest({ fiscalInputMode: "base" }));
  assert.equal(f.net, 1000000);
  assert.equal(f.base, 1000000);
  assert.equal(f.vat, 0);
  assert.equal(f.withholding, 0);
  assert.equal(f.hasFiscal, false);
});

test("sem modo declarado trata-se como base", () => {
  const f = computeExtraFiscal({ amount: 5000 });
  assert.equal(f.net, 5000);
  assert.equal(f.hasFiscal, false);
});

test("modo bruto sem nenhuma flag activa não mexe no valor", () => {
  const f = computeExtraFiscal({
    amount: 5000,
    fiscalInputMode: "gross",
    fiscalApplyVat: false,
    fiscalApplyWithholding: false,
    fiscalApplyDiscount: false,
  });
  assert.equal(f.net, 5000);
  assert.equal(f.hasFiscal, false);
});

test("flag activa com percentagem a zero não conta como fiscalidade", () => {
  const f = computeExtraFiscal(
    grossRequest({ fiscalVatPercent: 0, fiscalWithholdingPercent: 0 })
  );
  assert.equal(f.net, 1000000);
  assert.equal(f.hasFiscal, false);
});

test("percentagem sem a flag correspondente é ignorada", () => {
  const f = computeExtraFiscal(grossRequest({ fiscalApplyWithholding: false }));
  assert.equal(f.withholding, 0);
  assert.equal(f.net, 1000000);
});

// ─── Valores a gravar ───────────────────────────────────────────────────────

test("buildExtraFiscalAmounts devolve exactamente as colunas do modelo", () => {
  const cols = buildExtraFiscalAmounts(grossRequest());
  assert.deepEqual(Object.keys(cols).sort(), [...EXTRA_FISCAL_FIELDS].sort());
  for (const k of EXTRA_FISCAL_FIELDS) {
    assert.equal(typeof cols[k], "string", `${k} tem de ir como string`);
  }
});

test("as colunas gravadas batem com a decomposição", () => {
  const cols = buildExtraFiscalAmounts(grossRequest());
  assert.equal(cols.netAmount, "942982.46");
  assert.equal(cols.withholdingAmount, "57017.54");
  assert.equal(cols.grossAmount, "1000000");
  assert.equal(cols.vatAmount, "122807.02");
  assert.equal(cols.discountAmount, "0");
});

test("em modo base grava-se o líquido igual ao pedido", () => {
  const cols = buildExtraFiscalAmounts({ amount: 2000, fiscalInputMode: "base" });
  assert.equal(cols.netAmount, "2000");
  assert.equal(cols.baseAmount, "2000");
  assert.equal(cols.withholdingAmount, "0");
});

// ─── O que sai do caixa ─────────────────────────────────────────────────────

test("extraPayableAmount usa o líquido gravado", () => {
  assert.equal(extraPayableAmount({ amount: "1000000", netAmount: "942982.46" }), 942982.46);
});

test("extraPayableAmount recalcula quando o líquido não está gravado", () => {
  assert.equal(extraPayableAmount(grossRequest({ netAmount: null })), 942982.46);
});

test("extraPayableAmount sem fiscalidade nem líquido devolve o valor pedido", () => {
  assert.equal(extraPayableAmount({ amount: "7500" }), 7500);
});

test("extraPayableAmount aceita Decimal em string, como vem do Prisma", () => {
  assert.equal(extraPayableAmount({ amount: "1000000.00", netAmount: "942982.46" }), 942982.46);
});

test("extraPayableAmount de nada é zero", () => {
  assert.equal(extraPayableAmount(null), 0);
  assert.equal(extraPayableAmount(undefined), 0);
});

test("líquido gravado a zero é respeitado, não tratado como ausente", () => {
  assert.equal(extraPayableAmount({ amount: "500", netAmount: "0" }), 0);
});

test("extraWithheldAmount dá a retenção, gravada ou recalculada", () => {
  assert.equal(extraWithheldAmount({ withholdingAmount: "57017.54" }), 57017.54);
  assert.equal(extraWithheldAmount(grossRequest()), 57017.54);
  assert.equal(extraWithheldAmount({ amount: "100" }), 0);
});

// ─── O que vai para o ecrã ──────────────────────────────────────────────────

test("describeExtraFiscal só fala quando há impostos", () => {
  assert.equal(describeExtraFiscal({ amount: 2000, fiscalInputMode: "base" }), null);
  const texto = describeExtraFiscal(grossRequest());
  assert.match(texto, /base 877192\.98/);
  assert.match(texto, /retido 57017\.54/);
  assert.match(texto, /a pagar 942982\.46/);
});

test("describeExtraFiscal não inventa linhas de desconto que não existem", () => {
  const texto = describeExtraFiscal(grossRequest());
  assert.ok(!texto.includes("desconto"), texto);
});

test("decorateExtraFiscal acrescenta fiscal e payable sem perder o resto", () => {
  const extra = decorateExtraFiscal({ ...grossRequest(), id: "x", description: "Cimento" });
  assert.equal(extra.id, "x");
  assert.equal(extra.description, "Cimento");
  assert.equal(extra.payable, 942982.46);
  assert.equal(extra.fiscal.withholding, 57017.54);
  assert.equal(extra.fiscal.withholdingPercent, 6.5);
  assert.equal(extra.fiscal.hasFiscal, true);
});

test("decorateExtraFiscal lê a decomposição gravada em vez de recalcular", () => {
  // Valores propositadamente diferentes do que a fórmula daria: o que está
  // gravado no documento manda, para o histórico não mudar por baixo.
  const extra = decorateExtraFiscal({
    amount: "1000000",
    baseAmount: "900000",
    grossAmount: "1000000",
    vatAmount: "100000",
    withholdingAmount: "50000",
    discountAmount: "0",
    netAmount: "950000",
    fiscalInputMode: "gross",
    fiscalApplyVat: true,
    fiscalApplyWithholding: true,
    fiscalVatPercent: 14,
    fiscalWithholdingPercent: 6.5,
  });
  assert.equal(extra.payable, 950000);
  assert.equal(extra.fiscal.base, 900000);
  assert.equal(extra.fiscal.withholding, 50000);
});

test("decorateExtraFiscal sem fiscalidade não mostra resumo", () => {
  const extra = decorateExtraFiscal({ amount: "2000", netAmount: "2000", baseAmount: "2000", vatAmount: "0", withholdingAmount: "0", discountAmount: "0" });
  assert.equal(extra.fiscal.hasFiscal, false);
  assert.equal(extra.fiscal.summary, null);
  assert.equal(extra.payable, 2000);
});

test("decorateExtraFiscal de nada devolve nada", () => {
  assert.equal(decorateExtraFiscal(null), null);
});

// ─── Guardas ────────────────────────────────────────────────────────────────

test("valores não numéricos não propagam NaN", () => {
  const f = computeExtraFiscal({ amount: "abc", fiscalInputMode: "gross", fiscalApplyVat: true, fiscalVatPercent: "x" });
  assert.equal(f.net, 0);
  assert.equal(f.hasFiscal, false);
});

test("valor zero com impostos activos continua zero", () => {
  const f = computeExtraFiscal(grossRequest({ amount: 0 }));
  assert.equal(f.net, 0);
  assert.equal(f.withholding, 0);
});

test("percentagem negativa é ignorada", () => {
  const f = computeExtraFiscal(grossRequest({ fiscalWithholdingPercent: -6.5 }));
  assert.equal(f.withholding, 0);
});

test("cêntimos: o líquido nunca excede o bruto", () => {
  for (const amount of [0.01, 1, 99.99, 1234.56, 7777777.77]) {
    const f = computeExtraFiscal(grossRequest({ amount }));
    assert.ok(f.net <= f.gross + 1e-9, `${amount}: líquido ${f.net} > bruto ${f.gross}`);
    assert.ok(f.net >= 0, `${amount}: líquido negativo`);
  }
});

// ─── A partir das linhas (criação e edição) ─────────────────────────────────

const {
  computeExtraFiscalFromBase,
  buildExtraFiscalAmountsFromBase,
} = require("../src/services/extraRequestFiscal");

const baseRequest = (over = {}) => ({
  baseAmount: 1000000,
  fiscalInputMode: "gross",
  fiscalApplyVat: true,
  fiscalApplyWithholding: true,
  fiscalApplyDiscount: false,
  fiscalVatPercent: 14,
  fiscalWithholdingPercent: 6.5,
  ...over,
});

test("das linhas sai o documento e o que se paga", () => {
  const f = computeExtraFiscalFromBase(baseRequest());
  assert.equal(f.base, 1000000);
  assert.equal(f.vat, 140000);
  assert.equal(f.withholding, 65000);
  assert.equal(f.gross, 1140000, "documento = base + IVA");
  assert.equal(f.net, 1075000, "a pagar = documento − retenção");
});

test("o amount gravado é o documento, não a soma crua das linhas", () => {
  const cols = buildExtraFiscalAmountsFromBase(baseRequest());
  assert.equal(cols.amount, "1140000");
  assert.equal(cols.baseAmount, "1000000");
  assert.equal(cols.netAmount, "1075000");
});

test("sem impostos, o documento é a soma das linhas", () => {
  const cols = buildExtraFiscalAmountsFromBase({ baseAmount: 75000, fiscalInputMode: "base" });
  assert.equal(cols.amount, "75000");
  assert.equal(cols.netAmount, "75000");
  assert.equal(cols.withholdingAmount, "0");
});

test("ida e volta: gravar a partir das linhas e reler dá o mesmo", () => {
  const cols = buildExtraFiscalAmountsFromBase(baseRequest());
  const relido = computeExtraFiscal({ ...baseRequest(), amount: cols.amount });
  assert.equal(relido.net, Number(cols.netAmount));
  assert.equal(relido.withholding, Number(cols.withholdingAmount));
  assert.equal(Math.round(relido.base), Number(cols.baseAmount));
});

test("o desconto baixa o documento mas o IVA assenta na base antes do desconto", () => {
  // Convenção do fiscalCalculationService, que é o motor destas colunas.
  const f = computeExtraFiscalFromBase(baseRequest({ fiscalApplyDiscount: true, fiscalDiscountPercent: 5 }));
  assert.equal(f.discount, 50000);
  assert.equal(f.vat, 140000);
  assert.equal(f.gross, 1090000);
  assert.equal(f.net, 1025000);
});

test("a retenção nunca sai maior que o documento", () => {
  const f = computeExtraFiscalFromBase(baseRequest({ fiscalWithholdingPercent: 99 }));
  assert.ok(f.net >= 0, `líquido negativo: ${f.net}`);
});
