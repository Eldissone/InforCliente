const {
  toDateKey,
  todayDateKey,
  compareDateKeys,
  dateKeyToUtcNoon,
} = require("../utils/dateOnly");

function addDaysKey(dateKey, days) {
  const d = dateKeyToUtcNoon(dateKey);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return toDateKey(d);
}

function formatOrderRef(orderNumber) {
  if (!orderNumber) return null;
  return `EF${String(orderNumber).padStart(3, "0")}`;
}

function getDeliveryDueDateKey(quote) {
  const raw = quote.expectedReceiptDate || quote.need?.siteReceptionPlannedAt || null;
  return toDateKey(raw);
}

function resolveDeliveryTimelineStatus(quote, now = new Date()) {
  const stored = String(quote.deliveryStatus || "PENDENTE").toUpperCase();
  if (stored === "RECEBIDO") return "RECEBIDO";
  const dueKey = getDeliveryDueDateKey(quote);
  if (!dueKey) return "PENDENTE";
  const todayKey = todayDateKey(now);
  if (compareDateKeys(dueKey, todayKey) < 0) return "ATRASADO";
  return "PENDENTE";
}

function matchesSearch(quote, search) {
  if (!search) return true;
  const term = search.toLowerCase();
  const hay = [
    quote.orderRef,
    quote.supplier?.name,
    quote.supplierProduct?.name,
    quote.need?.description,
    quote.need?.project?.name,
    quote.need?.project?.code,
    quote.need?.costCenter?.code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(term);
}

function mapQuoteForTimeline(quote, now = new Date()) {
  const dueDateKey = getDeliveryDueDateKey(quote);
  const timelineStatus = resolveDeliveryTimelineStatus(quote, now);
  const qty = quote.quantity != null ? Number(quote.quantity) : Number(quote.need?.quantity) || 0;
  return {
    id: quote.id,
    needId: quote.needId,
    orderNumber: quote.orderNumber,
    orderRef: formatOrderRef(quote.orderNumber),
    expectedReceiptDate: quote.expectedReceiptDate || quote.need?.siteReceptionPlannedAt || null,
    receivedAt: quote.receivedAt,
    deliveryStatus: quote.deliveryStatus,
    timelineStatus,
    dueDate: dueDateKey,
    quantity: qty,
    quotedPrice: quote.quotedPrice != null ? String(quote.quotedPrice) : null,
    totalValue: quote.totalValue != null ? String(quote.totalValue) : null,
    supplier: quote.supplier,
    supplierProduct: quote.supplierProduct,
    need: quote.need,
    suggestedProductId: quote.suggestedProductId || null,
    suggestedWarehouseId: quote.suggestedWarehouseId || null,
  };
}

function buildDeliveryTimeline(quotes, options = {}) {
  const {
    now = new Date(),
    search = "",
    statusFilter = "",
    includeReceived = false,
    projectId = "",
    dateFrom = null,
    dateTo = null,
    daysAhead = 120,
    daysPast = 30,
  } = options;

  const todayKey = todayDateKey(now);
  const rangeStart = dateFrom ? toDateKey(dateFrom) : addDaysKey(todayKey, -daysPast);
  const rangeEnd = dateTo ? toDateKey(dateTo) : addDaysKey(todayKey, daysAhead);

  const enriched = quotes
    .map((q) => mapQuoteForTimeline(q, now))
    .filter((q) => matchesSearch(q, search))
    .filter((q) => {
      if (projectId && q.need?.projectId !== projectId) return false;
      if (statusFilter && q.timelineStatus !== statusFilter) return false;
      if (q.timelineStatus === "RECEBIDO" && !includeReceived) return false;
      if (!q.dueDate) return !dateFrom && !dateTo;
      if (compareDateKeys(q.dueDate, rangeStart) < 0) return false;
      if (compareDateKeys(q.dueDate, rangeEnd) > 0) return false;
      return true;
    })
    .sort((a, b) => compareDateKeys(a.dueDate, b.dueDate));

  const dayMap = new Map();
  const noDateItems = [];

  enriched.forEach((q) => {
    if (!q.dueDate) {
      noDateItems.push(q);
      return;
    }
    const key = q.dueDate;
    if (!dayMap.has(key)) {
      dayMap.set(key, { date: key, items: [], count: 0 });
    }
    const day = dayMap.get(key);
    day.items.push(q);
    day.count += 1;
  });

  const days = [...dayMap.values()].sort((a, b) => compareDateKeys(a.date, b.date));

  return {
    days,
    noDateItems,
    total: enriched.length,
    summary: {
      pending: enriched.filter((q) => q.timelineStatus === "PENDENTE").length,
      overdue: enriched.filter((q) => q.timelineStatus === "ATRASADO").length,
      received: enriched.filter((q) => q.timelineStatus === "RECEBIDO").length,
    },
  };
}

function suggestProductId(supplierProductName, products) {
  if (!supplierProductName || !products?.length) return null;
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  const target = norm(supplierProductName);
  const exact = products.find((p) => norm(p.name) === target);
  if (exact) return exact.id;
  const partial = products.find((p) => {
    const n = norm(p.name);
    return n.includes(target) || target.includes(n);
  });
  return partial?.id || null;
}

// Compatibilidade com código legado
function startOfDay(value) {
  const key = toDateKey(value);
  return key ? dateKeyToUtcNoon(key) : null;
}

function addDays(value, days) {
  const key = toDateKey(value);
  return key ? dateKeyToUtcNoon(addDaysKey(key, days)) : null;
}

function getDeliveryDueDate(quote) {
  const key = getDeliveryDueDateKey(quote);
  return key ? dateKeyToUtcNoon(key) : null;
}

module.exports = {
  startOfDay,
  addDays,
  formatOrderRef,
  getDeliveryDueDate,
  getDeliveryDueDateKey,
  resolveDeliveryTimelineStatus,
  mapQuoteForTimeline,
  buildDeliveryTimeline,
  suggestProductId,
};
