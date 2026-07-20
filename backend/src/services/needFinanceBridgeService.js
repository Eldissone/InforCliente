const { prisma } = require("../db");
const { mapNeedBudgetFields, needLineTotal } = require("./needBudgetService");

function httpError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

async function loadNeedForFinanceSend(needId, ccId) {
  const need = await prisma.workNeed.findUnique({
    where: { id: needId },
    include: {
      costCenter: { select: { id: true, code: true, name: true, currency: true } },
      project: { select: { id: true, name: true, code: true } },
      quotes: {
        where: { selected: true },
        take: 1,
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
              paymentTerm: true,
              vatPercent: true,
              withholdingPercent: true,
            },
          },
        },
      },
      _count: { select: { payments: true } },
    },
  });

  if (!need) throw httpError("NEED_NOT_FOUND", "Necessidade não encontrada", 404);
  if (need.costCenterId !== ccId) {
    throw httpError("COST_CENTER_MISMATCH", "Centro de custos inválido para esta necessidade", 400);
  }
  if (need.status !== "APPROVED") {
    throw httpError("NEED_NOT_APPROVED", "O item tem de estar aprovado antes de enviar ao financeiro", 400);
  }
  if (need.scheduled) {
    throw httpError("ALREADY_SENT_TO_FINANCE", "Item já enviado ao financeiro", 400);
  }
  if (need._count.payments > 0) {
    throw httpError("ALREADY_HAS_PAYMENTS", "Item já tem pagamentos registados", 400);
  }

  const quote = need.quotes[0];
  if (!quote) throw httpError("NO_SELECTED_QUOTE", "Seleccione um fornecedor antes de enviar ao financeiro", 400);
  if (!quote.proformaUrl) {
    throw httpError("PROPOSAL_REQUIRED", "Carregue a proposta/proforma antes de enviar ao financeiro", 400);
  }

  return { need, quote };
}

async function sendNeedToFinance({ needId, ccId }) {
  const { need, quote } = await loadNeedForFinanceSend(needId, ccId);

  const updatedNeed = await prisma.workNeed.update({
    where: { id: needId },
    data: { scheduled: true },
    include: {
      costCenter: { select: { code: true, name: true, currency: true } },
      project: { select: { id: true, name: true, code: true } },
      _count: { select: { payments: true, quotes: true } },
    },
  });

  const amount = needLineTotal(updatedNeed, "realizado");
  const payload = {
    need: mapNeedBudgetFields(updatedNeed),
    quote: {
      id: quote.id,
      quotedPrice: String(quote.quotedPrice),
      proformaUrl: quote.proformaUrl,
      orderNumber: quote.orderNumber,
      supplier: quote.supplier,
      paymentTerm: quote.supplier?.paymentTerm || null,
    },
    amount,
    currency: updatedNeed.costCenter?.currency || "AOA",
  };

  return payload;
}

async function listPendingFinanceScheduling({ projectId } = {}) {
  const where = {
    status: "APPROVED",
    scheduled: true,
    payments: { none: {} },
    ...(projectId ? { projectId } : {}),
  };

  const items = await prisma.workNeed.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 200,
    include: {
      costCenter: { select: { code: true, name: true, currency: true } },
      project: { select: { id: true, name: true, code: true } },
      quotes: {
        where: { selected: true },
        take: 1,
        include: { supplier: { select: { id: true, name: true, paymentTerm: true } } },
      },
    },
  });

  return items.map((need) => {
    const mapped = mapNeedBudgetFields(need);
    const quote = need.quotes[0];
    return {
      id: need.id,
      costCenterId: need.costCenterId,
      projectId: need.projectId,
      description: need.description,
      status: need.status,
      scheduled: need.scheduled,
      amount: needLineTotal(mapped, "realizado"),
      currency: need.costCenter?.currency || "AOA",
      project: need.project,
      costCenter: need.costCenter,
      supplier: quote?.supplier || null,
      proformaUrl: quote?.proformaUrl || null,
      quotedPrice: quote ? String(quote.quotedPrice) : null,
      paymentTerm: quote?.supplier?.paymentTerm || null,
      sentAt: need.updatedAt,
    };
  });
}

module.exports = {
  sendNeedToFinance,
  listPendingFinanceScheduling,
  loadNeedForFinanceSend,
};
