/** Cálculo fiscal bidireccional (base ↔ bruto) — orçamento usa sempre a base. */

function parsePercent(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
  baseAmount = 0,
  grossAmount = 0,
  inputMode = "base",
  applyVat = false,
  applyWithholding = false,
  applyDiscount = false,
} = {}) {
  const vatPct = applyVat ? parsePercent(supplier?.vatPercent) : 0;
  const whPct = applyWithholding ? parsePercent(supplier?.withholdingPercent) : 0;
  const discPct = applyDiscount ? parsePercent(supplier?.discountPercent) : 0;

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

function computeFiscalFromPaymentInput({ supplier, budgetedAmount, paidAmount, body = {} }) {
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
    payment.fiscalApplyDiscount;
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
  };
}

module.exports = {
  parsePercent,
  computeFiscalBreakdown,
  computeFiscalFromPaymentInput,
  mapStoredFiscalFields,
};
