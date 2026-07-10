/**
 * Serviço centralizado para cronograma / timeline de pagamentos.
 * Regra de visibilidade: um pagamento passa a aparecer 1 dia antes do vencimento.
 */

function startOfDay(value) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(value, days) {
  const d = startOfDay(value);
  d.setDate(d.getDate() + days);
  return d;
}

function getPaymentDueDate(payment) {
  return startOfDay(payment.paymentDate);
}

/** Data em que o pagamento passa a ser visível no cronograma (vencimento - 1 dia). */
function getPaymentVisibilityDate(payment) {
  return addDays(getPaymentDueDate(payment), -1);
}

function resolveTimelineStatus(payment, now = new Date()) {
  const status = String(payment.status || "").toUpperCase();
  if (status === "CONFIRMADO") return "PAGO";
  if (status === "CANCELADO") return "CANCELADO";
  const due = getPaymentDueDate(payment);
  if (due < startOfDay(now)) return "VENCIDO";
  return "PENDENTE";
}

function isPaymentVisible(payment, now = new Date()) {
  const timelineStatus = resolveTimelineStatus(payment, now);
  if (timelineStatus === "PAGO" || timelineStatus === "CANCELADO") return false;
  return getPaymentVisibilityDate(payment) <= startOfDay(now);
}

function matchesSearch(payment, search) {
  if (!search) return true;
  const term = search.toLowerCase();
  const hay = [
    payment.description,
    payment.supplier,
    payment.docNumber,
    payment.project?.name,
    payment.project?.code,
    payment.costCenter?.name,
    payment.costCenter?.code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(term);
}

function enrichPaymentForTimeline(payment, now = new Date()) {
  const dueDate = getPaymentDueDate(payment);
  const visibilityDate = getPaymentVisibilityDate(payment);
  const timelineStatus = resolveTimelineStatus(payment, now);
  return {
    ...payment,
    dueDate: dueDate.toISOString(),
    visibilityDate: visibilityDate.toISOString(),
    timelineStatus,
    isVisible: isPaymentVisible(payment, now),
  };
}

/**
 * Agrupa pagamentos por dia de vencimento, incluindo apenas dias com pagamentos.
 * Filtra por visibilidade (1 dia antes) quando onlyVisible=true.
 */
function buildPaymentTimeline(payments, options = {}) {
  const {
    now = new Date(),
    search = "",
    statusFilter = "",
    onlyVisible = true,
    includePaid = false,
    includeCancelled = false,
    daysAhead = 120,
    daysPast = 30,
  } = options;

  const today = startOfDay(now);
  const rangeStart = addDays(today, -daysPast);
  const rangeEnd = addDays(today, daysAhead);

  const enriched = payments
    .map((p) => enrichPaymentForTimeline(p, now))
    .filter((p) => matchesSearch(p, search))
    .filter((p) => {
      if (statusFilter) {
        if (statusFilter === "PENDENTE" && p.timelineStatus !== "PENDENTE") return false;
        if (statusFilter === "VENCIDO" && p.timelineStatus !== "VENCIDO") return false;
        if (statusFilter === "CONFIRMADO" && p.timelineStatus !== "PAGO") return false;
        if (statusFilter === "CANCELADO" && p.timelineStatus !== "CANCELADO") return false;
      }
      if (p.timelineStatus === "PAGO" && !includePaid) return false;
      if (p.timelineStatus === "CANCELADO" && !includeCancelled) return false;
      if (onlyVisible && p.timelineStatus !== "PAGO" && p.timelineStatus !== "CANCELADO" && !p.isVisible) {
        return false;
      }
      const due = startOfDay(p.dueDate);
      if (due < rangeStart || due > rangeEnd) return false;
      return true;
    })
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const dayMap = new Map();
  enriched.forEach((p) => {
    const key = startOfDay(p.dueDate).toISOString();
    if (!dayMap.has(key)) {
      dayMap.set(key, {
        date: key,
        visibilityDate: p.visibilityDate,
        items: [],
        totalBudgeted: 0,
        currencies: new Set(),
      });
    }
    const day = dayMap.get(key);
    day.items.push(p);
    day.totalBudgeted += Number(p.budgetedAmount || 0);
    day.currencies.add(p.costCenter?.currency || "AOA");
  });

  const days = [...dayMap.values()]
    .map((d) => ({
      date: d.date,
      visibilityDate: d.visibilityDate,
      items: d.items,
      totalBudgeted: Math.round(d.totalBudgeted * 100) / 100,
      currency: d.currencies.size === 1 ? [...d.currencies][0] : "MIXED",
      count: d.items.length,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return { days, total: enriched.length };
}

module.exports = {
  startOfDay,
  addDays,
  getPaymentDueDate,
  getPaymentVisibilityDate,
  resolveTimelineStatus,
  isPaymentVisible,
  enrichPaymentForTimeline,
  buildPaymentTimeline,
};
