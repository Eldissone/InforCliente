const { LOCKED_WORKFLOW_STATUSES } = require("./needBudgetService");
const { syncNeedFromSelectedQuotes, syncNeedOrderStatus } = require("./quoteAllocationService");
const { setQuoteDeliveryPending } = require("./deliveryFieldBridge");
const { normalizeDateOnly } = require("../utils/dateOnly");
const { syncQuoteFiscalSnapshot } = require("./quoteFiscalSnapshotService");

async function nextEfOrderNumber(prisma) {
  const seqResult = await prisma.$queryRawUnsafe(
    `SELECT nextval('"NeedQuote_orderNumber_seq"') AS val`
  );
  return Number(seqResult[0].val);
}

const ORDER_INCLUDE = {
  supplier: {
    include: { bankAccounts: true },
  },
  project: { select: { id: true, name: true, code: true, location: true, region: true } },
  quotes: {
    include: {
      need: {
        include: {
          costCenter: { select: { id: true, name: true, code: true, currency: true } },
          project: { select: { id: true, name: true, code: true, location: true, region: true } },
        },
      },
      supplier: { include: { bankAccounts: true } },
      supplierProduct: true,
    },
    orderBy: { createdAt: "asc" },
  },
};

function serializeSupplierOrder(order) {
  if (!order) return null;
  return {
    ...order,
    quotes: (order.quotes || []).map((q) => ({
      ...q,
      quotedPrice: String(q.quotedPrice),
      quantity: q.quantity != null ? String(q.quantity) : null,
      totalValue: q.totalValue != null ? String(q.totalValue) : null,
      need: q.need
        ? {
            ...q.need,
            quantity: q.need.quantity != null ? String(q.need.quantity) : null,
            unitPrice: q.need.unitPrice != null ? String(q.need.unitPrice) : null,
          }
        : null,
    })),
  };
}

async function upsertNeedQuoteForSupplier(prisma, { need, supplierId, quotedPrice, quantity, currency, notes, proformaUrl }) {
  const qty = quantity != null ? Number(quantity) : Number(need.quantity) || 1;
  const totalValue = qty * Number(quotedPrice);

  const existing = await prisma.needQuote.findFirst({
    where: { needId: need.id, supplierId },
    orderBy: { createdAt: "desc" },
  });

  const data = {
    quotedPrice,
    quantity: qty,
    totalValue,
    currency: currency || "AOA",
    notes: notes || null,
    selected: true,
    ...(proformaUrl ? { proformaUrl } : {}),
  };

  if (existing) {
    if (existing.orderNumber != null) {
      const err = new Error("QUOTE_ALREADY_ORDERED");
      err.code = "QUOTE_ALREADY_ORDERED";
      err.needId = need.id;
      throw err;
    }
    return prisma.needQuote.update({ where: { id: existing.id }, data });
  }

  return prisma.needQuote.create({
    data: {
      needId: need.id,
      supplierId,
      ...data,
    },
  });
}

async function createOrUpdateBundle(prisma, { supplierId, projectId, notes, items, proformaUrl, placeOrder, expectedReceiptDate }) {
  if (!supplierId || !Array.isArray(items) || items.length < 1) {
    const err = new Error("BUNDLE_ITEMS_REQUIRED");
    err.code = "BUNDLE_ITEMS_REQUIRED";
    throw err;
  }

  const needIds = [...new Set(items.map((i) => i.needId).filter(Boolean))];
  const needs = await prisma.workNeed.findMany({
    where: { id: { in: needIds } },
  });
  if (needs.length !== needIds.length) {
    const err = new Error("NEED_NOT_FOUND");
    err.code = "NEED_NOT_FOUND";
    throw err;
  }

  for (const need of needs) {
    if (LOCKED_WORKFLOW_STATUSES.has(need.status)) {
      const err = new Error("NEED_WORKFLOW_LOCKED");
      err.code = "NEED_WORKFLOW_LOCKED";
      err.needId = need.id;
      throw err;
    }
  }

  const projects = [...new Set(needs.map((n) => n.projectId || null))];
  if (projects.length > 1) {
    const err = new Error("BUNDLE_MIXED_SCOPE");
    err.code = "BUNDLE_MIXED_SCOPE";
    err.message = "Não misture itens gerais com itens de obra, nem obras diferentes.";
    throw err;
  }
  const resolvedProjectId = projectId || needs[0].projectId || null;

  const quoteIds = [];
  for (const line of items) {
    const need = needs.find((n) => n.id === line.needId);
    const quote = await upsertNeedQuoteForSupplier(prisma, {
      need,
      supplierId,
      quotedPrice: Number(line.quotedPrice),
      quantity: line.quantity,
      currency: line.currency,
      notes: line.notes || notes,
      proformaUrl,
    });
    quoteIds.push(quote.id);

    await prisma.needQuote.updateMany({
      where: { needId: need.id, id: { not: quote.id }, orderNumber: null },
      data: { selected: false },
    });

    if (need.status === "PENDING") {
      await prisma.workNeed.update({
        where: { id: need.id },
        data: { status: "IN_QUOTATION" },
      });
    }
    await syncNeedFromSelectedQuotes(prisma, need.id);
    await syncQuoteFiscalSnapshot(quote.id, prisma);
  }

  let order = await prisma.quoteSupplierOrder.findFirst({
    where: {
      supplierId,
      projectId: resolvedProjectId,
      status: "DRAFT",
      quotes: { some: { id: { in: quoteIds } } },
    },
  });

  if (!order) {
    order = await prisma.quoteSupplierOrder.create({
      data: {
        supplierId,
        projectId: resolvedProjectId,
        status: "DRAFT",
        notes: notes || null,
        proformaUrl: proformaUrl || null,
      },
    });
  } else if (proformaUrl || notes) {
    order = await prisma.quoteSupplierOrder.update({
      where: { id: order.id },
      data: {
        ...(notes != null ? { notes } : {}),
        ...(proformaUrl ? { proformaUrl } : {}),
      },
    });
  }

  await prisma.needQuote.updateMany({
    where: { id: { in: quoteIds } },
    data: { supplierOrderId: order.id, ...(proformaUrl ? { proformaUrl } : {}) },
  });

  if (placeOrder) {
    order = await placeSupplierOrder(prisma, order.id, { expectedReceiptDate });
  }

  return prisma.quoteSupplierOrder.findUnique({
    where: { id: order.id },
    include: ORDER_INCLUDE,
  });
}

async function placeSupplierOrder(prisma, orderId, { expectedReceiptDate } = {}) {
  const order = await prisma.quoteSupplierOrder.findUnique({
    where: { id: orderId },
    include: { quotes: { include: { need: true } } },
  });
  if (!order) {
    const err = new Error("ORDER_NOT_FOUND");
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }
  if (order.status === "ORDERED" && order.orderNumber != null) {
    return prisma.quoteSupplierOrder.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
  }
  if (!order.quotes.length) {
    const err = new Error("ORDER_EMPTY");
    err.code = "ORDER_EMPTY";
    throw err;
  }

  const orderNumber = order.orderNumber || (await nextEfOrderNumber(prisma));
  let receipt = order.expectedReceiptDate;
  if (expectedReceiptDate) receipt = normalizeDateOnly(expectedReceiptDate);
  else if (!receipt) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 15);
    receipt = normalizeDateOnly(d);
  }

  await prisma.$transaction(async (tx) => {
    await tx.quoteSupplierOrder.update({
      where: { id: orderId },
      data: {
        status: "ORDERED",
        orderNumber,
        expectedReceiptDate: receipt,
      },
    });
    await tx.needQuote.updateMany({
      where: { id: { in: order.quotes.map((q) => q.id) } },
      data: {
        selected: true,
        orderNumber,
        expectedReceiptDate: receipt,
        supplierOrderId: orderId,
      },
    });
  });

  for (const q of order.quotes) {
    await setQuoteDeliveryPending(q.id);
    await syncNeedOrderStatus(prisma, q.needId);
  }

  return prisma.quoteSupplierOrder.findUnique({
    where: { id: orderId },
    include: ORDER_INCLUDE,
  });
}

async function attachSingleQuoteToOrder(prisma, quote) {
  if (quote.supplierOrderId) {
    return prisma.quoteSupplierOrder.findUnique({
      where: { id: quote.supplierOrderId },
      include: ORDER_INCLUDE,
    });
  }
  const created = await prisma.quoteSupplierOrder.create({
    data: {
      supplierId: quote.supplierId,
      projectId: quote.need?.projectId || null,
      orderNumber: quote.orderNumber,
      status: quote.orderNumber != null ? "ORDERED" : "DRAFT",
      purchaseOrderUrl: quote.purchaseOrderUrl || null,
      expectedReceiptDate: quote.expectedReceiptDate || null,
      quotes: { connect: { id: quote.id } },
    },
  });
  await prisma.needQuote.update({
    where: { id: quote.id },
    data: { supplierOrderId: created.id },
  });
  return prisma.quoteSupplierOrder.findUnique({
    where: { id: created.id },
    include: ORDER_INCLUDE,
  });
}

async function applyProformaUrlToOrder(prisma, orderId, proformaUrl) {
  const order = await prisma.quoteSupplierOrder.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!order) {
    const err = new Error("ORDER_NOT_FOUND");
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }

  await prisma.quoteSupplierOrder.update({
    where: { id: orderId },
    data: { proformaUrl },
  });

  await prisma.needQuote.updateMany({
    where: { supplierOrderId: orderId },
    data: { proformaUrl },
  });

  return prisma.quoteSupplierOrder.findUnique({
    where: { id: orderId },
    include: ORDER_INCLUDE,
  });
}

module.exports = {
  nextEfOrderNumber,
  ORDER_INCLUDE,
  serializeSupplierOrder,
  createOrUpdateBundle,
  placeSupplierOrder,
  attachSingleQuoteToOrder,
  applyProformaUrlToOrder,
};
