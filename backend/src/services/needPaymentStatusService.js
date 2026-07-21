const { prisma } = require("../db");
const { needRealizadoUnitPrice } = require("./needBudgetService");
const {
  getEffectivePermissionsForUser,
  resolveAllowedFromMap,
} = require("../services/permissionResolver");

/** Item com preço realizado registado e pagamento ainda por concluir. */
function needHasRealizadoPrice(need) {
  const price = needRealizadoUnitPrice(need);
  return price != null && price > 0;
}

function isNeedPaidLocked(need) {
  return need?.status === "PAID";
}

/** Estado apresentado na vista «Realizado»: com preço e não pago → Em Análise. */
function needRealizadoWorkflowStatus(need) {
  if (!need) return "PENDING";
  if (need.status === "PAID") return "PAID";
  if (needHasRealizadoPrice(need)) return "EM_ANALISE";
  if (need.status === "APPROVED" && !need.marketWorkflowStarted) return "PENDING";
  return need.status;
}

function needReadyForFinance(need) {
  if (!need) return false;
  if (need.status === "PAID") return false;
  return ["EM_ANALISE", "APPROVED"].includes(need.status) && needHasRealizadoPrice(need);
}

async function assertCanModifyPaidNeed(req) {
  const role = (req.user?.role || "").toLowerCase();
  if (role === "admin") return;

  const userId = req.user?.sub;
  if (!userId) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }

  const perms = await getEffectivePermissionsForUser(userId);
  const map = perms?.effectiveMap || {};
  const manage = resolveAllowedFromMap(map, "obras", "manage");
  const full = resolveAllowedFromMap(map, "obras", "full_access");
  if (manage === "true" || full === "true") return;

  const err = new Error("NEED_PAID_LOCKED");
  err.status = 403;
  err.message = "Item pago — alteração apenas com permissão de gestão de obras.";
  throw err;
}

/**
 * Sincroniza WorkNeed com pagamentos ligados:
 * - todas as parcelas CONFIRMADO → PAID
 * - caso contrário, se tinha preço realizado → EM_ANALISE (ex.: estorno parcial)
 */
async function syncNeedPaymentStatus(needId) {
  if (!needId) return null;

  const need = await prisma.workNeed.findUnique({
    where: { id: needId },
    select: {
      id: true,
      status: true,
      unitPrice: true,
      originalUnitPrice: true,
      quantity: true,
      hours: true,
      scheduled: true,
      priceExceptionReason: true,
      quotes: {
        where: { selected: true },
        select: { id: true, supplierId: true },
      },
    },
  });

  if (!need) return null;

  const selectedQuotes = need.quotes || [];
  let payments = [];

  if (selectedQuotes.length > 0) {
    const installments = await prisma.paymentInstallment.findMany({
      where: { needId, quoteId: { in: selectedQuotes.map((q) => q.id) } },
      include: { costPayment: { select: { id: true, status: true } } },
    });

    const installmentsByQuote = new Map();
    installments.forEach((inst) => {
      if (!installmentsByQuote.has(inst.quoteId)) installmentsByQuote.set(inst.quoteId, []);
      installmentsByQuote.get(inst.quoteId).push(inst);
    });

    let allQuotesScheduled = true;
    for (const quote of selectedQuotes) {
      const quoteInst = installmentsByQuote.get(quote.id) || [];
      if (quoteInst.length > 0) {
        payments.push(...quoteInst.map((i) => i.costPayment).filter(Boolean));
        continue;
      }
      const legacy = await prisma.costPayment.findMany({
        where: {
          needId,
          supplierId: quote.supplierId,
          status: { not: "CANCELADO" },
        },
        select: { id: true, status: true },
      });
      if (!legacy.length) {
        allQuotesScheduled = false;
        break;
      }
      payments.push(...legacy);
    }

    if (!allQuotesScheduled || !payments.length) return need;
  } else {
    payments = await prisma.costPayment.findMany({
      where: { needId, status: { not: "CANCELADO" } },
      select: { id: true, status: true },
    });
    if (!payments.length) return need;
  }

  const allConfirmed = payments.every((p) => p.status === "CONFIRMADO");
  if (allConfirmed) {
    if (need.status === "PAID") return need;
    return prisma.workNeed.update({
      where: { id: needId },
      data: { status: "PAID" },
    });
  }

  if (need.status === "PAID" && needHasRealizadoPrice(need)) {
    return prisma.workNeed.update({
      where: { id: needId },
      data: { status: "EM_ANALISE" },
    });
  }

  return need;
}

module.exports = {
  needHasRealizadoPrice,
  isNeedPaidLocked,
  needRealizadoWorkflowStatus,
  needReadyForFinance,
  assertCanModifyPaidNeed,
  syncNeedPaymentStatus,
};
