const { prisma } = require("../db");
const { mapNeedBudgetFields, needLineTotal } = require("./needBudgetService");
const { needReadyForFinance } = require("./needPaymentStatusService");
const { listPendingFinanceScheduling } = require("./needInstallmentSchedulingService");

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
  if (!needReadyForFinance(need)) {
    throw httpError(
      "NEED_NOT_APPROVED",
      "O item tem de estar em análise (com preço) antes de enviar ao financeiro",
      400
    );
  }
  if (need.scheduled) {
    throw httpError("ALREADY_SENT_TO_FINANCE", "Item já enviado ao financeiro", 400);
  }
  if (need._count.payments > 0) {
    throw httpError("ALREADY_HAS_PAYMENTS", "Item já tem pagamentos registados", 400);
  }

  const quote = need.quotes[0];
  const missingProforma = (need.quotes || []).filter((q) => !q.proformaUrl);
  if (missingProforma.length > 0) {
    throw httpError(
      "PROPOSAL_REQUIRED",
      `Carregue a proforma de todos os fornecedores (${missingProforma.length} em falta).`,
      400
    );
  }
  if (!quote) throw httpError("NO_SELECTED_QUOTE", "Seleccione um fornecedor antes de enviar ao financeiro", 400);

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

module.exports = {
  sendNeedToFinance,
  listPendingFinanceScheduling,
  loadNeedForFinanceSend,
};
