const { prisma } = require("../db");
const { activeProjectRelationFilter } = require("./projectLifecycleService");
const { mapNeedBudgetFields } = require("./needBudgetService");
const { quoteAllocatedQty } = require("./quoteAllocationService");

function quoteLineTotal(quote, need) {
  const stored = Number(quote?.totalValue);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const qty = quoteAllocatedQty(quote, Number(need?.quantity) || 0);
  const price = Number(quote?.quotedPrice) || 0;
  const hours = Number(need?.hours) || 1;
  return qty * price * hours;
}

async function quoteHasPaymentPlan({ quoteId, needId, supplierId }) {
  const instCount = await prisma.paymentInstallment.count({ where: { quoteId } });
  if (instCount > 0) return true;
  if (!needId) return false;
  const payCount = await prisma.costPayment.count({
    where: {
      needId,
      ...(supplierId ? { supplierId } : {}),
      status: { not: "CANCELADO" },
    },
  });
  return payCount > 0;
}

async function listQuotesAwaitingInstallments({ projectId, needId } = {}) {
  const needs = await prisma.workNeed.findMany({
    where: {
      scheduled: true,
      status: { in: ["EM_ANALISE", "APPROVED", "ORDERED"] },
      ...(needId ? { id: needId } : {}),
      ...(projectId ? { projectId } : { project: activeProjectRelationFilter() }),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: needId ? 1 : 200,
    include: {
      costCenter: { select: { id: true, code: true, name: true, currency: true } },
      project: { select: { id: true, name: true, code: true } },
      quotes: {
        where: { selected: true },
        include: {
          supplier: { select: { id: true, name: true, paymentTerm: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const rows = [];
  for (const need of needs) {
    const selected = need.quotes || [];
    if (!selected.length) {
      const hasPayments = await prisma.costPayment.count({
        where: { needId: need.id, status: { not: "CANCELADO" } },
      });
      if (!hasPayments) {
        rows.push({ need, quote: null, legacy: true });
      }
      continue;
    }

    for (const quote of selected) {
      const planned = await quoteHasPaymentPlan({
        quoteId: quote.id,
        needId: need.id,
        supplierId: quote.supplierId,
      });
      if (!planned) {
        rows.push({ need, quote, legacy: false });
      }
    }
  }

  return rows;
}

function mapPendingInstallmentRow({ need, quote, legacy }) {
  const mapped = mapNeedBudgetFields(need);
  const currency = need.costCenter?.currency || "AOA";
  const amount = quote ? quoteLineTotal(quote, need) : Number(mapped.realizadoTotal) || 0;
  const supplier = quote?.supplier || null;

  return {
    id: need.id,
    quoteId: quote?.id || null,
    costCenterId: need.costCenterId,
    projectId: need.projectId,
    description: need.description,
    supplierLabel: supplier?.name || null,
    displayDescription: supplier
      ? `${need.description} — ${supplier.name}`
      : need.description,
    status: need.status,
    scheduled: need.scheduled,
    amount,
    currency,
    project: need.project,
    costCenter: need.costCenter,
    supplier,
    proformaUrl: quote?.proformaUrl || null,
    quotedPrice: quote ? String(quote.quotedPrice) : null,
    paymentTerm: supplier?.paymentTerm || null,
    sentAt: need.updatedAt,
    legacy: Boolean(legacy),
  };
}

async function listPendingFinanceScheduling({ projectId } = {}) {
  const rows = await listQuotesAwaitingInstallments({ projectId });
  return rows.map(mapPendingInstallmentRow);
}

module.exports = {
  quoteLineTotal,
  quoteHasPaymentPlan,
  listQuotesAwaitingInstallments,
  listPendingFinanceScheduling,
  mapPendingInstallmentRow,
};
