const PRICED_STATUSES = new Set(["ORDERED", "EM_ANALISE", "APPROVED", "PAID"]);

const LOCKED_WORKFLOW_STATUSES = new Set(["ORDERED", "EM_ANALISE", "APPROVED", "PAID"]);

function isMarketWorkflowStarted(need) {
  if (!need) return false;
  if (["IN_QUOTATION", "ORDERED", "EM_ANALISE", "PAID"].includes(need.status)) return true;
  if (need.status === "APPROVED") {
    return Boolean(need.scheduled)
      || Boolean(need.priceExceptionReason)
      || Number(need._count?.quotes) > 0;
  }
  return false;
}

function needRealizadoDisplayStatus(need) {
  if (!need) return "PENDING";
  if (need.status === "PAID") return "PAID";
  const realUnit = needRealizadoUnitPrice(need);
  if (realUnit != null && realUnit > 0) return "EM_ANALISE";
  if (need.status === "APPROVED" && !isMarketWorkflowStarted(need)) return "PENDING";
  return need.status;
}

function needPrevistoUnitPrice(need) {
  return Number(need?.originalUnitPrice ?? need?.unitPrice) || 0;
}

function needRealizadoUnitPrice(need) {
  if (!need || !PRICED_STATUSES.has(need.status)) return null;
  if (need.status === "APPROVED" && !isMarketWorkflowStarted(need)) return null;
  if (need.status === "ORDERED" && !need.unitPrice) return null;
  return Number(need.unitPrice) || 0;
}

function needLineTotal(need, mode = "previsto") {
  const qty = Number(need?.quantity) || 0;
  const hours = Number(need?.hours) || 1;
  const unit =
    mode === "realizado"
      ? needRealizadoUnitPrice(need) ?? needPrevistoUnitPrice(need)
      : needPrevistoUnitPrice(need);
  return qty * unit * hours;
}

function needExceedsPrevisto(need) {
  const previsto = needPrevistoUnitPrice(need);
  const real = needRealizadoUnitPrice(need);
  if (real == null) return false;
  return real > previsto + 1e-6;
}

function assertPriceWithinPrevistoOrException(need, newUnitPrice, { priceExceptionReason, actorName }) {
  const previsto = needPrevistoUnitPrice(need);
  const next = Number(newUnitPrice) || 0;
  if (next <= previsto + 1e-6) return null;
  const reason = String(priceExceptionReason || "").trim();
  if (!reason) {
    const err = new Error("PRICE_EXCEEDS_PREVISTO");
    err.code = "PRICE_EXCEEDS_PREVISTO";
    err.message =
      "O preço realizado excede o previsto. Indique uma justificação de excepção para continuar.";
    err.previstoUnitPrice = previsto;
    err.requestedUnitPrice = next;
    throw err;
  }
  return {
    priceExceptionReason: reason,
    priceExceptionBy: actorName || "Sistema",
    priceExceptionAt: new Date(),
  };
}

function mapNeedBudgetFields(need) {
  const previstoUnit = needPrevistoUnitPrice(need);
  const realUnit = needRealizadoUnitPrice(need);
  const previstoTotal = needLineTotal(need, "previsto");
  const realizadoTotal = realUnit != null ? needLineTotal(need, "realizado") : null;
  const exceedsPrevisto = needExceedsPrevisto(need);
  const fiscal = resolveNeedFiscalPercents(need);

  const { quotes, ...rest } = need;

  return {
    ...rest,
    quantity: need.quantity != null ? String(need.quantity) : null,
    unitPrice: need.unitPrice != null ? String(need.unitPrice) : null,
    originalUnitPrice: need.originalUnitPrice != null ? String(need.originalUnitPrice) : null,
    hours: need.hours != null ? String(need.hours) : null,
    previstoUnitPrice: String(previstoUnit),
    realizadoUnitPrice: realUnit != null ? String(realUnit) : null,
    previstoTotal,
    realizadoTotal,
    exceedsPrevisto,
    hasPriceException: Boolean(need.priceExceptionReason),
    withinPrevisto: !exceedsPrevisto || Boolean(need.priceExceptionReason),
    marketWorkflowStarted: isMarketWorkflowStarted(need),
    realizadoDisplayStatus: needRealizadoDisplayStatus(need),
    isPaidLocked: need.status === "PAID",
    fiscalVatPercent: fiscal.vatPercent,
    fiscalWithholdingPercent: fiscal.withholdingPercent,
    fiscalDiscountPercent: fiscal.discountPercent,
  };
}

/** Cotação seleccionada → produto → fornecedor. */
function resolveNeedFiscalPercents(need) {
  const quotes = need?.quotes || [];
  const quote = quotes.find((q) => q.selected) || quotes[0] || null;
  if (!quote) {
    return { vatPercent: null, withholdingPercent: null, discountPercent: null };
  }
  const product = quote.supplierProduct || null;
  const supplier = quote.supplier || null;
  const pick = (productVal, supplierVal) => {
    const p = Number(productVal);
    if (Number.isFinite(p) && p > 0) return p;
    const s = Number(supplierVal);
    if (Number.isFinite(s) && s > 0) return s;
    return null;
  };
  return {
    vatPercent: pick(product?.vatPercent, supplier?.vatPercent),
    withholdingPercent: pick(product?.withholdingPercent, supplier?.withholdingPercent),
    discountPercent: pick(product?.discountPercent, supplier?.discountPercent),
  };
}

module.exports = {
  PRICED_STATUSES,
  LOCKED_WORKFLOW_STATUSES,
  isMarketWorkflowStarted,
  needRealizadoDisplayStatus,
  needPrevistoUnitPrice,
  needRealizadoUnitPrice,
  needLineTotal,
  needExceedsPrevisto,
  assertPriceWithinPrevistoOrException,
  mapNeedBudgetFields,
  resolveNeedFiscalPercents,
};
