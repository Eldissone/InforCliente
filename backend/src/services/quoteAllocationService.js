/** Alocação de quantidade por fornecedor (várias cotações seleccionadas no mesmo item). */

function quoteAllocatedQty(quote, needQty = 0) {
  const q = Number(quote?.quantity);
  if (Number.isFinite(q) && q > 0) return q;
  return Number(needQty) || 0;
}

function computeQuoteAllocation(need, quotes = []) {
  const required = Number(need?.quantity) || 0;
  const selected = (quotes || []).filter((q) => q.selected);
  const allocated = selected.reduce((sum, q) => sum + quoteAllocatedQty(q, required), 0);
  const remaining = required > 0 ? Math.max(0, required - allocated) : 0;
  const fullyAllocated = required > 0 && remaining < 1e-6;

  let weightedUnitPrice = null;
  if (selected.length > 0 && allocated > 0) {
    const totalValue = selected.reduce(
      (sum, q) => sum + quoteAllocatedQty(q, required) * Number(q.quotedPrice || 0),
      0
    );
    weightedUnitPrice = totalValue / allocated;
  }

  return {
    required,
    allocated,
    remaining,
    fullyAllocated,
    weightedUnitPrice,
    selectedCount: selected.length,
  };
}

function validateQuoteQuantity({ need, quotes, quoteId, quantity }) {
  const required = Number(need?.quantity) || 0;
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    const err = new Error("INVALID_QUOTE_QUANTITY");
    err.status = 400;
    err.message = "Indique uma quantidade válida maior que zero.";
    throw err;
  }

  const others = (quotes || []).filter((q) => q.selected && q.id !== quoteId);
  const otherAllocated = others.reduce((sum, q) => sum + quoteAllocatedQty(q, required), 0);
  const total = otherAllocated + qty;

  if (required > 0 && total > required + 1e-6) {
    const err = new Error("QUOTE_QUANTITY_EXCEEDS_NEED");
    err.status = 400;
    err.message = `Quantidade total alocada (${total}) excede a necessária (${required}).`;
    throw err;
  }

  const quote = (quotes || []).find((q) => q.id === quoteId);
  return { quantity: qty, totalValue: qty * Number(quote?.quotedPrice || 0) };
}

async function syncNeedFromSelectedQuotes(prisma, needId) {
  const need = await prisma.workNeed.findUnique({
    where: { id: needId },
    include: {
      quotes: {
        where: { selected: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!need) return null;

  const allocation = computeQuoteAllocation(need, need.quotes);
  const data = {};

  if (allocation.weightedUnitPrice != null) {
    data.unitPrice = String(allocation.weightedUnitPrice);
  }

  if (
    allocation.fullyAllocated &&
    allocation.selectedCount > 0 &&
    ["IN_QUOTATION", "APPROVED"].includes(need.status)
  ) {
    data.status = "EM_ANALISE";
  }

  if (Object.keys(data).length === 0) return need;

  return prisma.workNeed.update({
    where: { id: needId },
    data,
  });
}

/** Actualiza estado do item: ORDERED só quando todos os fornecedores alocados têm encomenda. */
async function syncNeedOrderStatus(prisma, needId) {
  const need = await prisma.workNeed.findUnique({
    where: { id: needId },
    include: { quotes: { where: { selected: true } } },
  });
  if (!need || !need.quotes.length) return need;

  const allOrdered = need.quotes.every((q) => q.orderNumber != null);
  const anyOrdered = need.quotes.some((q) => q.orderNumber != null);

  let nextStatus = need.status;
  if (allOrdered) {
    nextStatus = "ORDERED";
  } else if (anyOrdered && ["IN_QUOTATION", "PENDING", "APPROVED"].includes(need.status)) {
    nextStatus = "EM_ANALISE";
  }

  if (nextStatus === need.status) return need;

  return prisma.workNeed.update({
    where: { id: needId },
    data: { status: nextStatus },
  });
}

function countPendingOrders(quotes = []) {
  return (quotes || []).filter((q) => q.selected && q.orderNumber == null).length;
}

module.exports = {
  quoteAllocatedQty,
  computeQuoteAllocation,
  validateQuoteQuantity,
  syncNeedFromSelectedQuotes,
  syncNeedOrderStatus,
  countPendingOrders,
};
