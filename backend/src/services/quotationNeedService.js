function mapPedidoPriority(priority) {
  const p = String(priority || "").toUpperCase();
  if (p === "URGENTE" || p === "ALTA") return "ALTA";
  if (p === "BAIXA") return "BAIXA";
  return "MEDIA";
}

function lineUnitPrice(line) {
  const n = Number(line?.unitPrice);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

function buildNeedLines({ description, items }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length) {
    return list.map((line, idx) => ({
      description: String(line.description || line.name || description || `Item ${idx + 1}`).trim() || `Item ${idx + 1}`,
      quantity: line.quantity != null ? String(line.quantity) : "1",
      unit: line.unit || "UN",
      unitPrice: lineUnitPrice(line),
    }));
  }
  return [
    {
      description: String(description || "Pedido").trim() || "Pedido",
      quantity: "1",
      unit: "UN",
      unitPrice: null,
    },
  ];
}

function pedidoCanGoToQuotation(source) {
  if (!source) return false;
  if (source.projectId && source.costCenterId) return true;
  if (!source.projectId && !source.costCenterId) return true;
  return false;
}

/**
 * Cria necessidades IN_QUOTATION para a página Cotação (uma por item).
 * Obra: projectId + costCenterId. Geral: ambos nulos.
 * Idempotente: não cria se o pedido já tiver needs.
 */
async function ensureQuotationNeedsFromPedido(prisma, source) {
  const extraRequestId = source.extraRequestId || null;
  const purchaseOrderId = source.purchaseOrderId || null;
  if (!extraRequestId && !purchaseOrderId) return [];
  if (!pedidoCanGoToQuotation(source)) return [];

  const existing = await prisma.workNeed.count({
    where: extraRequestId ? { extraRequestId } : { purchaseOrderId },
  });
  if (existing > 0) return [];

  const lines = buildNeedLines({
    description: source.description,
    items: source.items,
  });

  const created = [];
  for (const line of lines) {
    const need = await prisma.workNeed.create({
      data: {
        projectId: source.projectId || null,
        costCenterId: source.costCenterId || null,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        originalUnitPrice: line.unitPrice,
        status: "IN_QUOTATION",
        priority: mapPedidoPriority(source.priority),
        responsible: source.responsible || null,
        notes: source.notes || null,
        extraRequestId,
        purchaseOrderId,
      },
    });
    created.push(need);
  }
  return created;
}

async function ensureQuotationNeedsForProject(prisma, projectId) {
  if (!projectId) return;

  const extras = await prisma.extraRequest.findMany({
    where: {
      projectId,
      requiresQuote: true,
      costCenterId: { not: null },
      status: { in: ["PENDENTE", "APROVADO"] },
      workNeeds: { none: {} },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });
  for (const extra of extras) {
    await ensureQuotationNeedsFromPedido(prisma, {
      projectId: extra.projectId,
      costCenterId: extra.costCenterId,
      description: extra.description,
      items: extra.items,
      extraRequestId: extra.id,
      priority: extra.priority,
      responsible: extra.requestedBy,
      notes: extra.notes,
    });
  }

  const orders = await prisma.purchaseOrder.findMany({
    where: {
      projectId,
      requiresQuote: true,
      costCenterId: { not: null },
      status: { in: ["PENDENTE_REQUISICAO", "PENDENTE_APROVACAO"] },
      workNeeds: { none: {} },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });
  for (const order of orders) {
    await ensureQuotationNeedsFromPedido(prisma, {
      projectId: order.projectId,
      costCenterId: order.costCenterId,
      description: order.description,
      items: order.items,
      purchaseOrderId: order.id,
      priority: order.priority,
      responsible: order.requestedByName,
      notes: order.notes,
    });
  }
}

async function ensureQuotationNeedsForGeral(prisma) {
  const extras = await prisma.extraRequest.findMany({
    where: {
      type: "GERAL",
      requiresQuote: true,
      status: { in: ["PENDENTE", "APROVADO"] },
      workNeeds: { none: {} },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });
  for (const extra of extras) {
    await ensureQuotationNeedsFromPedido(prisma, {
      projectId: null,
      costCenterId: null,
      description: extra.description,
      items: extra.items,
      extraRequestId: extra.id,
      priority: extra.priority,
      responsible: extra.requestedBy,
      notes: extra.notes,
    });
  }

  const orders = await prisma.purchaseOrder.findMany({
    where: {
      projectId: null,
      requiresQuote: true,
      status: { in: ["PENDENTE_REQUISICAO", "PENDENTE_APROVACAO"] },
      workNeeds: { none: {} },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });
  for (const order of orders) {
    await ensureQuotationNeedsFromPedido(prisma, {
      projectId: null,
      costCenterId: null,
      description: order.description,
      items: order.items,
      purchaseOrderId: order.id,
      priority: order.priority,
      responsible: order.requestedByName,
      notes: order.notes,
    });
  }
}

function isPedidoSourcedNeed(need) {
  return Boolean(need?.extraRequestId || need?.purchaseOrderId);
}

const QUOTE_NEED_INCLUDE = {
  costCenter: { select: { id: true, name: true, code: true } },
  extraRequest: {
    select: {
      id: true,
      type: true,
      costCategory: { select: { id: true, name: true, code: true } },
      generalCostCenter: { select: { id: true, name: true, code: true } },
    },
  },
  quotes: {
    include: {
      supplier: { select: { name: true, vatPercent: true, withholdingPercent: true, discountPercent: true } },
      supplierOrder: {
        select: { id: true, orderNumber: true, status: true, purchaseOrderUrl: true, proformaUrl: true },
      },
    },
    orderBy: { quotedPrice: "asc" },
  },
};

module.exports = {
  ensureQuotationNeedsFromPedido,
  ensureQuotationNeedsForProject,
  ensureQuotationNeedsForGeral,
  isPedidoSourcedNeed,
  QUOTE_NEED_INCLUDE,
};
