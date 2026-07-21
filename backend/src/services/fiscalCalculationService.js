/** Cálculo fiscal bidireccional (base ↔ bruto) — orçamento usa sempre a base. */

function parsePercent(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Produto tem prioridade; fornecedor é fallback. */
function resolveFiscalPercents({ product = null, supplier = null } = {}) {
  const pick = (productVal, supplierVal) => {
    const p = parsePercent(productVal);
    if (p > 0) return p;
    return parsePercent(supplierVal);
  };
  return {
    vatPercent: pick(product?.vatPercent, supplier?.vatPercent),
    withholdingPercent: pick(product?.withholdingPercent, supplier?.withholdingPercent),
    discountPercent: pick(product?.discountPercent, supplier?.discountPercent),
  };
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * @param {object} options
 * @param {object|null} options.supplier
 * @param {number|string} [options.baseAmount]
 * @param {number|string} [options.grossAmount]
 * @param {"base"|"gross"} [options.inputMode]
 * @param {boolean} [options.applyVat]
 * @param {boolean} [options.applyWithholding]
 * @param {boolean} [options.applyDiscount]
 */
function computeFiscalBreakdown({
  supplier = null,
  product = null,
  fiscalPercents = null,
  baseAmount = 0,
  grossAmount = 0,
  inputMode = "base",
  applyVat = false,
  applyWithholding = false,
  applyDiscount = false,
} = {}) {
  const pct = fiscalPercents || resolveFiscalPercents({ product, supplier });
  const vatPct = applyVat ? pct.vatPercent : 0;
  const whPct = applyWithholding ? pct.withholdingPercent : 0;
  const discPct = applyDiscount ? pct.discountPercent : 0;

  const factor = 1 - discPct / 100 + vatPct / 100;

  let base = 0;
  if (inputMode === "gross") {
    const grossIn = Number(grossAmount) || 0;
    base = factor > 0 ? grossIn / factor : 0;
  } else {
    base = Number(baseAmount) || 0;
  }

  const discount = discPct ? (base * discPct) / 100 : 0;
  const vat = vatPct ? (base * vatPct) / 100 : 0;
  const withholding = whPct ? (base * whPct) / 100 : 0;
  const gross = base - discount + vat;
  const net = gross - withholding;

  const lines = [];
  if (discPct) lines.push({ label: `Desconto (${discPct}%)`, amount: -discount, kind: "discount" });
  if (vatPct) lines.push({ label: `IVA (${vatPct}%)`, amount: vat, kind: "vat" });
  if (whPct) lines.push({ label: `Retenção (${whPct}%)`, amount: -withholding, kind: "withholding" });

  return {
    base: roundMoney(base),
    discount: roundMoney(discount),
    vat: roundMoney(vat),
    withholding: roundMoney(withholding),
    gross: roundMoney(gross),
    net: roundMoney(net),
    lines,
    vatPct,
    whPct,
    discPct,
  };
}

function computeFiscalFromPaymentInput({ supplier, product = null, budgetedAmount, paidAmount, body = {} }) {
  const applyVat = body.fiscalApplyVat === true || body.fiscalApplyVat === "true";
  const applyWithholding =
    body.fiscalApplyWithholding === true || body.fiscalApplyWithholding === "true";
  const applyDiscount =
    body.fiscalApplyDiscount === true || body.fiscalApplyDiscount === "true";
  const inputMode = body.fiscalInputMode === "gross" ? "gross" : "base";

  const hasFiscalFlags = applyVat || applyWithholding || applyDiscount;
  if (!hasFiscalFlags) {
    return null;
  }

  const breakdown = computeFiscalBreakdown({
    supplier,
    product,
    baseAmount: budgetedAmount,
    grossAmount: body.grossAmount ?? paidAmount,
    inputMode,
    applyVat,
    applyWithholding,
    applyDiscount,
  });

  return {
    grossAmount: String(breakdown.gross),
    vatAmount: String(breakdown.vat),
    withholdingAmount: String(breakdown.withholding),
    netAmount: String(breakdown.net),
    fiscalApplyVat: applyVat,
    fiscalApplyWithholding: applyWithholding,
    fiscalApplyDiscount: applyDiscount,
    fiscalInputMode: inputMode,
    paidAmount: String(breakdown.net),
    budgetedAmount: String(breakdown.base),
  };
}

function mapStoredFiscalFields(payment) {
  if (!payment) return null;
  const hasStored =
    payment.grossAmount != null ||
    payment.vatAmount != null ||
    payment.fiscalApplyVat ||
    payment.fiscalApplyWithholding ||
    payment.fiscalApplyDiscount ||
    payment.netAmount != null;
  if (!hasStored) return null;

  return {
    grossAmount: payment.grossAmount != null ? String(payment.grossAmount) : null,
    vatAmount: payment.vatAmount != null ? String(payment.vatAmount) : null,
    withholdingAmount:
      payment.withholdingAmount != null ? String(payment.withholdingAmount) : null,
    netAmount: payment.netAmount != null ? String(payment.netAmount) : null,
    fiscalApplyVat: Boolean(payment.fiscalApplyVat),
    fiscalApplyWithholding: Boolean(payment.fiscalApplyWithholding),
    fiscalApplyDiscount: Boolean(payment.fiscalApplyDiscount),
    fiscalInputMode: payment.fiscalInputMode || "base",
    fiscalFrozen: Boolean(
      payment.netAmount != null &&
        (payment.fiscalApplyVat || payment.fiscalApplyWithholding || payment.fiscalApplyDiscount)
    ),
  };
}

/** Percentagens activas a partir do produto/fornecedor. */
function defaultFiscalFlagsFromRefs({ supplier = null, product = null } = {}) {
  const pct = resolveFiscalPercents({ product, supplier });
  return {
    applyVat: pct.vatPercent > 0,
    applyWithholding: pct.withholdingPercent > 0,
    applyDiscount: pct.discountPercent > 0,
    percents: pct,
  };
}

/** Snapshot fiscal de uma linha de cotação (base + líquido a pagar). */
function buildQuoteFiscalSnapshot({ baseAmount, supplier = null, product = null } = {}) {
  const base = roundMoney(baseAmount);
  const flags = defaultFiscalFlagsFromRefs({ supplier, product });
  const hasFiscal = flags.applyVat || flags.applyWithholding || flags.applyDiscount;

  if (!hasFiscal) {
    return {
      base,
      net: base,
      gross: base,
      vat: 0,
      withholding: 0,
      discount: 0,
      applyVat: false,
      applyWithholding: false,
      applyDiscount: false,
      hasFiscal: false,
    };
  }

  const breakdown = computeFiscalBreakdown({
    supplier,
    product,
    baseAmount: base,
    applyVat: flags.applyVat,
    applyWithholding: flags.applyWithholding,
    applyDiscount: flags.applyDiscount,
  });

  return {
    ...breakdown,
    applyVat: flags.applyVat,
    applyWithholding: flags.applyWithholding,
    applyDiscount: flags.applyDiscount,
    hasFiscal: true,
  };
}

/** Reparte fiscal proporcional de uma parcela (montante = líquido a pagar). */
function buildInstallmentFiscalFields({ snapshot, installmentNet, supplier = null, product = null }) {
  const instNet = roundMoney(installmentNet);
  if (!snapshot?.hasFiscal) {
    return {
      budgetedAmount: String(instNet),
      paidAmount: "0",
      grossAmount: null,
      vatAmount: null,
      withholdingAmount: null,
      netAmount: null,
      fiscalApplyVat: false,
      fiscalApplyWithholding: false,
      fiscalApplyDiscount: false,
      fiscalInputMode: "base",
      payableAmount: instNet,
    };
  }

  const ratio = snapshot.net > 0 ? instNet / snapshot.net : 0;
  const instBase = roundMoney(snapshot.base * ratio);
  const breakdown = computeFiscalBreakdown({
    supplier,
    product,
    baseAmount: instBase,
    applyVat: snapshot.applyVat,
    applyWithholding: snapshot.applyWithholding,
    applyDiscount: snapshot.applyDiscount,
  });

  return {
    budgetedAmount: String(breakdown.base),
    paidAmount: "0",
    grossAmount: String(breakdown.gross),
    vatAmount: String(breakdown.vat),
    withholdingAmount: String(breakdown.withholding),
    netAmount: String(breakdown.net),
    fiscalApplyVat: snapshot.applyVat,
    fiscalApplyWithholding: snapshot.applyWithholding,
    fiscalApplyDiscount: snapshot.applyDiscount,
    fiscalInputMode: "base",
    payableAmount: breakdown.net,
  };
}

function paymentHasPresetFiscal(payment) {
  return Boolean(
    payment?.netAmount != null &&
      (payment.fiscalApplyVat || payment.fiscalApplyWithholding || payment.fiscalApplyDiscount)
  );
}

module.exports = {
  parsePercent,
  resolveFiscalPercents,
  computeFiscalBreakdown,
  computeFiscalFromPaymentInput,
  mapStoredFiscalFields,
  defaultFiscalFlagsFromRefs,
  buildQuoteFiscalSnapshot,
  buildInstallmentFiscalFields,
  paymentHasPresetFiscal,
};
