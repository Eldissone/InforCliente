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

function formatOrderRef(orderNumber) {
  if (!orderNumber) return null;
  return `EF${String(orderNumber).padStart(3, "0")}`;
}

function getDeliveryDueDate(quote) {
  if (!quote.expectedReceiptDate) return null;
  return startOfDay(quote.expectedReceiptDate);
}

function resolveDeliveryTimelineStatus(quote, now = new Date()) {
  const stored = String(quote.deliveryStatus || "PENDENTE").toUpperCase();
  if (stored === "RECEBIDO") return "RECEBIDO";
  const due = getDeliveryDueDate(quote);
  if (!due) return "PENDENTE";
  if (due < startOfDay(now)) return "ATRASADO";
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
  const dueDate = getDeliveryDueDate(quote);
  const timelineStatus = resolveDeliveryTimelineStatus(quote, now);
  const qty = quote.quantity != null ? Number(quote.quantity) : Number(quote.need?.quantity) || 0;
  return {
    id: quote.id,
    needId: quote.needId,
    orderNumber: quote.orderNumber,
    orderRef: formatOrderRef(quote.orderNumber),
    expectedReceiptDate: quote.expectedReceiptDate,
    receivedAt: quote.receivedAt,
    deliveryStatus: quote.deliveryStatus,
    timelineStatus,
    dueDate: dueDate ? dueDate.toISOString() : null,
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

  const today = startOfDay(now);
  const rangeStart = dateFrom ? startOfDay(dateFrom) : addDays(today, -daysPast);
  const rangeEnd = dateTo ? startOfDay(dateTo) : addDays(today, daysAhead);

  const enriched = quotes
    .map((q) => mapQuoteForTimeline(q, now))
    .filter((q) => matchesSearch(q, search))
    .filter((q) => {
      if (projectId && q.need?.projectId !== projectId) return false;
      if (statusFilter && q.timelineStatus !== statusFilter) return false;
      if (q.timelineStatus === "RECEBIDO" && !includeReceived) return false;
      if (!q.dueDate) return !dateFrom && !dateTo;
      const due = startOfDay(q.dueDate);
      if (due < rangeStart || due > rangeEnd) return false;
      return true;
    })
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });

  const dayMap = new Map();
  const noDateItems = [];

  enriched.forEach((q) => {
    if (!q.dueDate) {
      noDateItems.push(q);
      return;
    }
    const key = startOfDay(q.dueDate).toISOString();
    if (!dayMap.has(key)) {
      dayMap.set(key, { date: key, items: [], count: 0 });
    }
    const day = dayMap.get(key);
    day.items.push(q);
    day.count += 1;
  });

  const days = [...dayMap.values()].sort((a, b) => new Date(a.date) - new Date(b.date));

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

module.exports = {
  startOfDay,
  addDays,
  formatOrderRef,
  getDeliveryDueDate,
  resolveDeliveryTimelineStatus,
  mapQuoteForTimeline,
  buildDeliveryTimeline,
  suggestProductId,
};
