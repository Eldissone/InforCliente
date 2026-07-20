const { prisma } = require("../db");

const FREIGHT_INCLUDE = {
  supplier: {
    select: {
      id: true,
      name: true,
      type: true,
      paymentTerm: true,
      vatPercent: true,
      withholdingPercent: true,
    },
  },
  costPayment: {
    select: {
      id: true,
      status: true,
      paymentDate: true,
      costCenterId: true,
      projectId: true,
    },
  },
  allocations: {
    orderBy: { createdAt: "asc" },
    include: {
      project: { select: { id: true, name: true, code: true } },
      costCenter: { select: { id: true, code: true, name: true } },
      needQuote: {
        select: {
          id: true,
          orderNumber: true,
          need: {
            select: {
              id: true,
              description: true,
              unit: true,
            },
          },
        },
      },
    },
  },
};

function httpError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function validateAllocationSum(totalAmount, allocations) {
  const total = roundMoney(totalAmount);
  const sum = roundMoney(allocations.reduce((acc, a) => acc + Number(a.amount || 0), 0));
  if (Math.abs(total - sum) > 0.02) {
    throw httpError(
      "ALLOCATION_SUM_MISMATCH",
      `A soma das alocações (${sum}) deve ser igual ao total do frete (${total})`
    );
  }
}

function mapFreightOrder(order) {
  if (!order) return null;
  return {
    ...order,
    totalAmount: String(order.totalAmount),
    allocations: (order.allocations || []).map((a) => ({
      ...a,
      amount: String(a.amount),
    })),
  };
}

async function assertTransportadorSupplier(supplierId) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, type: true, active: true },
  });
  if (!supplier) throw httpError("SUPPLIER_NOT_FOUND", "Fornecedor não encontrado", 404);
  if (supplier.type !== "TRANSPORTADOR") {
    throw httpError("SUPPLIER_NOT_CARRIER", "Seleccione um fornecedor do tipo Transportador", 400);
  }
  return supplier;
}

async function listEligibleQuotes() {
  const quotes = await prisma.needQuote.findMany({
    where: {
      selected: true,
      need: {
        project: { active: true },
        status: { in: ["EM_ANALISE", "APPROVED", "ORDERED"] },
      },
    },
    orderBy: [{ need: { project: { name: "asc" } } }, { createdAt: "desc" }],
    take: 300,
    include: {
      supplier: { select: { id: true, name: true } },
      need: {
        select: {
          id: true,
          description: true,
          quantity: true,
          unit: true,
          projectId: true,
          costCenterId: true,
          project: { select: { id: true, name: true, code: true } },
          costCenter: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });

  return quotes.map((q) => ({
    id: q.id,
    orderNumber: q.orderNumber,
    description: q.need?.description || q.supplierProduct?.name || "—",
    project: q.need?.project,
    costCenter: q.need?.costCenter,
    projectId: q.need?.projectId,
    costCenterId: q.need?.costCenterId,
    supplierName: q.supplier?.name,
    materialSupplier: q.supplier?.name,
  }));
}

async function createFreightOrder({ supplierId, totalAmount, currency, notes, allocations, createdBy }) {
  await assertTransportadorSupplier(supplierId);
  if (!Array.isArray(allocations) || allocations.length < 1) {
    throw httpError("ALLOCATIONS_REQUIRED", "Adicione pelo menos uma linha de rateio", 400);
  }
  validateAllocationSum(totalAmount, allocations);

  const order = await prisma.freightOrder.create({
    data: {
      supplierId,
      totalAmount: String(totalAmount),
      currency: currency || "AOA",
      notes: notes || null,
      status: "PENDENTE",
      createdBy: createdBy || null,
      allocations: {
        create: allocations.map((a) => ({
          needQuoteId: a.needQuoteId || null,
          projectId: a.projectId,
          costCenterId: a.costCenterId || null,
          description: a.description,
          amount: String(a.amount),
        })),
      },
    },
    include: FREIGHT_INCLUDE,
  });

  return mapFreightOrder(order);
}

async function updateFreightOrder(id, { totalAmount, notes, allocations, status }) {
  const existing = await prisma.freightOrder.findUnique({
    where: { id },
    select: { id: true, status: true, costPaymentId: true },
  });
  if (!existing) throw httpError("FREIGHT_NOT_FOUND", "Frete não encontrado", 404);
  if (existing.costPaymentId) {
    throw httpError("FREIGHT_LOCKED", "Frete já enviado ao financeiro — não pode ser editado", 400);
  }
  if (["PAGO", "CANCELADO"].includes(existing.status)) {
    throw httpError("FREIGHT_LOCKED", "Frete fechado — não pode ser editado", 400);
  }

  if (allocations) {
    const current = totalAmount !== undefined
      ? totalAmount
      : (await prisma.freightOrder.findUnique({ where: { id }, select: { totalAmount: true } }))?.totalAmount;
    validateAllocationSum(current, allocations);
    await prisma.freightAllocation.deleteMany({ where: { freightOrderId: id } });
  }

  const order = await prisma.freightOrder.update({
    where: { id },
    data: {
      ...(totalAmount !== undefined ? { totalAmount: String(totalAmount) } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(status ? { status } : {}),
      ...(allocations
        ? {
            allocations: {
              create: allocations.map((a) => ({
                needQuoteId: a.needQuoteId || null,
                projectId: a.projectId,
                costCenterId: a.costCenterId || null,
                description: a.description,
                amount: String(a.amount),
              })),
            },
          }
        : {}),
    },
    include: FREIGHT_INCLUDE,
  });

  return mapFreightOrder(order);
}

async function submitFreightForAnalysis(id) {
  const order = await prisma.freightOrder.findUnique({ where: { id }, select: { status: true } });
  if (!order) throw httpError("FREIGHT_NOT_FOUND", "Frete não encontrado", 404);
  if (order.status !== "PENDENTE") {
    throw httpError("INVALID_STATUS", "Só fretes pendentes podem ser submetidos para análise", 400);
  }
  return updateFreightOrder(id, { status: "EM_ANALISE" });
}

async function approveFreight(id) {
  const order = await prisma.freightOrder.findUnique({ where: { id }, select: { status: true } });
  if (!order) throw httpError("FREIGHT_NOT_FOUND", "Frete não encontrado", 404);
  if (order.status !== "EM_ANALISE" && order.status !== "PENDENTE") {
    throw httpError("INVALID_STATUS", "Frete não está em análise", 400);
  }
  return updateFreightOrder(id, { status: "APPROVED" });
}

async function sendFreightToFinance(id, { paymentDate } = {}) {
  const order = await prisma.freightOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      allocations: { orderBy: { amount: "desc" } },
    },
  });
  if (!order) throw httpError("FREIGHT_NOT_FOUND", "Frete não encontrado", 404);
  if (order.status !== "APPROVED") {
    throw httpError("FREIGHT_NOT_APPROVED", "Aprove o frete antes de enviar ao financeiro", 400);
  }
  if (order.costPaymentId) {
    throw httpError("ALREADY_SENT", "Frete já enviado ao financeiro", 400);
  }
  if (!order.allocations.length) {
    throw httpError("NO_ALLOCATIONS", "Frete sem alocações", 400);
  }

  const anchor = order.allocations[0];
  let costCenterId = anchor.costCenterId;
  if (!costCenterId) {
    const cc = await prisma.costCenter.findFirst({
      where: { projectId: anchor.projectId, active: true },
      select: { id: true },
    });
    costCenterId = cc?.id;
  }
  if (!costCenterId) {
    throw httpError("NO_COST_CENTER", "Obra sem centro de custo activo para lançar o frete", 400);
  }

  const rateioSummary = order.allocations
    .map((a) => `${a.description}: ${Number(a.amount).toLocaleString("pt-PT")}`)
    .join(" | ");

  const payment = await prisma.costPayment.create({
    data: {
      projectId: anchor.projectId,
      costCenterId,
      supplierId: order.supplierId,
      supplier: order.supplier.name,
      category: "TRANSPORTE",
      description: `Frete — ${order.supplier.name}`,
      budgetedAmount: String(order.totalAmount),
      paidAmount: "0",
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentType: "PRONTO_PAGAMENTO",
      status: "PENDENTE",
      notes: order.notes ? `${order.notes}\nRateio: ${rateioSummary}` : `Rateio: ${rateioSummary}`,
    },
  });

  const updated = await prisma.freightOrder.update({
    where: { id },
    data: { costPaymentId: payment.id },
    include: FREIGHT_INCLUDE,
  });

  return { freight: mapFreightOrder(updated), paymentId: payment.id };
}

async function listFreightOrders({ status, supplierId } = {}) {
  const items = await prisma.freightOrder.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: FREIGHT_INCLUDE,
    take: 200,
  });
  return items.map(mapFreightOrder);
}

async function getFreightOrder(id) {
  const order = await prisma.freightOrder.findUnique({
    where: { id },
    include: FREIGHT_INCLUDE,
  });
  if (!order) throw httpError("FREIGHT_NOT_FOUND", "Frete não encontrado", 404);
  return mapFreightOrder(order);
}

module.exports = {
  FREIGHT_INCLUDE,
  mapFreightOrder,
  listEligibleQuotes,
  createFreightOrder,
  updateFreightOrder,
  submitFreightForAnalysis,
  approveFreight,
  sendFreightToFinance,
  listFreightOrders,
  getFreightOrder,
};
