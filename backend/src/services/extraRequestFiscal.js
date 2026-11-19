/**
 * Fiscalidade do pedido extra — um só sítio a decidir o que se paga.
 *
 * O `ExtraRequest` já guardava as percentagens em colunas e validava-as bem, mas
 * nunca as aplicava a valor nenhum: o `amount` era a soma crua quantidade × preço
 * e era esse o número que chegava a «Por pagar», ao valor por omissão do pagamento
 * e ao débito no fundo de maneio. A retenção ficava pelo caminho.
 *
 * Convenção, igual à do `CostPayment` (que já o fazia assim):
 *
 *   base   = valor sem impostos
 *   IVA    = base × iva%
 *   RF     = base × retenção%
 *   bruto  = base − desconto + IVA        ← o valor do documento
 *   net    = bruto − RF                   ← o que o beneficiário recebe
 *
 * Em modo "gross" o utilizador escreve o **bruto** (é o que vem na fatura) e a
 * base deduz-se dele. Em modo "base" não há fiscalidade activa nenhuma — o
 * `resolveFiscalPercentFields` da rota força todas as flags a falso — pelo que o
 * líquido é o próprio valor pedido.
 *
 * A retenção não desaparece: fica em `withholdingAmount`, para quem tiver de a
 * entregar ao Estado a poder somar.
 */

const { computeFiscalBreakdown } = require("./fiscalCalculationService");

/** Colunas gravadas no `ExtraRequest`. */
const EXTRA_FISCAL_FIELDS = [
  "baseAmount",
  "grossAmount",
  "vatAmount",
  "withholdingAmount",
  "discountAmount",
  "netAmount",
];

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function percent(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** As percentagens que ficam de facto activas. Em modo "base" não há nenhuma. */
function activePercents(input = {}) {
  const gross = input.fiscalInputMode === "gross";
  const applyVat = gross && Boolean(input.fiscalApplyVat);
  const applyWithholding = gross && Boolean(input.fiscalApplyWithholding);
  const applyDiscount = gross && Boolean(input.fiscalApplyDiscount);
  const vatPct = applyVat ? percent(input.fiscalVatPercent) : 0;
  const whPct = applyWithholding ? percent(input.fiscalWithholdingPercent) : 0;
  const discPct = applyDiscount ? percent(input.fiscalDiscountPercent) : 0;
  return {
    applyVat,
    applyWithholding,
    applyDiscount,
    vatPct,
    whPct,
    discPct,
    hasFiscal: vatPct > 0 || whPct > 0 || discPct > 0,
  };
}

function flatBreakdown(amount) {
  return {
    base: amount,
    discount: 0,
    vat: 0,
    withholding: 0,
    gross: amount,
    net: amount,
    lines: [],
    vatPct: 0,
    whPct: 0,
    discPct: 0,
    hasFiscal: false,
  };
}

/**
 * Decomposição a partir do **valor do documento** (o bruto, com IVA). É o que o
 * `amount` guarda, e é por aqui que se lêem os pedidos que já existem.
 *
 * @param {object} input
 * @param {number|string} input.amount valor do documento
 * @param {"base"|"gross"} [input.fiscalInputMode]
 */
function computeExtraFiscal(input = {}) {
  const amount = round2(input.amount);
  const p = activePercents(input);
  if (!p.hasFiscal) return flatBreakdown(amount);

  const breakdown = computeFiscalBreakdown({
    fiscalPercents: { vatPercent: p.vatPct, withholdingPercent: p.whPct, discountPercent: p.discPct },
    grossAmount: amount,
    inputMode: "gross",
    applyVat: p.applyVat,
    applyWithholding: p.applyWithholding,
    applyDiscount: p.applyDiscount,
  });

  // O bruto é o valor escrito, não o reconstruído: evita que o arredondamento da
  // base faça o documento deixar de bater com a fatura por um cêntimo.
  return { ...breakdown, gross: amount, net: round2(amount - breakdown.withholding), hasFiscal: true };
}

/**
 * Decomposição a partir da **base** — a soma das linhas (quantidade × preço),
 * que é o que o formulário tem. O valor do documento sai daqui para cima:
 * `gross = base − desconto + IVA`.
 *
 * É este o caminho da criação e da edição: as linhas dão a base, não o bruto.
 */
function computeExtraFiscalFromBase(input = {}) {
  const base = round2(input.baseAmount);
  const p = activePercents(input);
  if (!p.hasFiscal) return flatBreakdown(base);

  const breakdown = computeFiscalBreakdown({
    fiscalPercents: { vatPercent: p.vatPct, withholdingPercent: p.whPct, discountPercent: p.discPct },
    baseAmount: base,
    inputMode: "base",
    applyVat: p.applyVat,
    applyWithholding: p.applyWithholding,
    applyDiscount: p.applyDiscount,
  });

  return { ...breakdown, hasFiscal: true };
}

function columnsOf(f) {
  return {
    baseAmount: String(f.base),
    grossAmount: String(f.gross),
    vatAmount: String(f.vat),
    withholdingAmount: String(f.withholding),
    discountAmount: String(f.discount),
    netAmount: String(f.net),
  };
}

/** As colunas a gravar, como strings (é o que o resto do código usa com Decimal). */
function buildExtraFiscalAmounts(input = {}) {
  return columnsOf(computeExtraFiscal(input));
}

/**
 * As colunas a gravar quando se parte das linhas. Inclui o `amount`, porque o
 * valor do documento é derivado: o que o utilizador escreve nas linhas é a base.
 */
function buildExtraFiscalAmountsFromBase(input = {}) {
  const f = computeExtraFiscalFromBase(input);
  return { amount: String(f.gross), ...columnsOf(f) };
}

/**
 * O que sai do caixa por este pedido.
 *
 * Usa o `netAmount` gravado; se faltar (pedido anterior a esta correcção que a
 * migração não tenha alcançado), recalcula a partir das percentagens; e só em
 * último recurso devolve o `amount`.
 */
function extraPayableAmount(extra) {
  if (!extra) return 0;
  if (extra.netAmount != null && extra.netAmount !== "") return round2(extra.netAmount);
  return computeExtraFiscal(extra).net;
}

/** Retenção a entregar ao Estado por este pedido. */
function extraWithheldAmount(extra) {
  if (!extra) return 0;
  if (extra.withholdingAmount != null && extra.withholdingAmount !== "") {
    return round2(extra.withholdingAmount);
  }
  return computeExtraFiscal(extra).withholding;
}

/** Uma linha curta para o ecrã: só aparece quando há de facto fiscalidade. */
function describeExtraFiscal(extra) {
  const f = extra?.netAmount != null ? decoratedToBreakdown(extra) : computeExtraFiscal(extra || {});
  if (!f.hasFiscal) return null;
  const bits = [`base ${f.base}`];
  if (f.discount > 0) bits.push(`desconto ${f.discount}`);
  if (f.vat > 0) bits.push(`IVA ${f.vat}`);
  if (f.withholding > 0) bits.push(`retido ${f.withholding}`);
  bits.push(`a pagar ${f.net}`);
  return bits.join(" · ");
}

/** Lê a decomposição já gravada, sem recalcular. */
function decoratedToBreakdown(extra) {
  const withholding = round2(extra.withholdingAmount);
  const vat = round2(extra.vatAmount);
  const discount = round2(extra.discountAmount);
  return {
    base: round2(extra.baseAmount),
    discount,
    vat,
    withholding,
    gross: round2(extra.grossAmount != null ? extra.grossAmount : extra.amount),
    net: round2(extra.netAmount),
    vatPct: percent(extra.fiscalVatPercent),
    whPct: percent(extra.fiscalWithholdingPercent),
    discPct: percent(extra.fiscalDiscountPercent),
    hasFiscal: vat > 0 || withholding > 0 || discount > 0,
    lines: [],
  };
}

/**
 * Acrescenta ao pedido o bloco `fiscal` e o `payable` que os ecrãs usam, sem
 * mexer no que já vinha.
 */
function decorateExtraFiscal(extra) {
  if (!extra) return extra;
  const f = extra.netAmount != null ? decoratedToBreakdown(extra) : computeExtraFiscal(extra);
  return {
    ...extra,
    fiscal: {
      base: f.base,
      discount: f.discount,
      vat: f.vat,
      withholding: f.withholding,
      gross: f.gross,
      net: f.net,
      vatPercent: f.vatPct,
      withholdingPercent: f.whPct,
      discountPercent: f.discPct,
      hasFiscal: f.hasFiscal,
      summary: f.hasFiscal ? describeExtraFiscal(extra) : null,
    },
    payable: f.net,
  };
}

module.exports = {
  EXTRA_FISCAL_FIELDS,
  activePercents,
  computeExtraFiscal,
  computeExtraFiscalFromBase,
  buildExtraFiscalAmounts,
  buildExtraFiscalAmountsFromBase,
  extraPayableAmount,
  extraWithheldAmount,
  describeExtraFiscal,
  decorateExtraFiscal,
};
