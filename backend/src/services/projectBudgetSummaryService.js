const { prisma } = require("../db");
const {
  needLineTotal,
  needRealizadoUnitPrice,
  needPrevistoUnitPrice,
} = require("./needBudgetService");

/**
 * Regra de negócio (reunião BG / Jul 2026):
 * - Previsto: baseline aprovado (originalUnitPrice × qty)
 * - Realizado: preço comprometido — inclui «Em análise» com proposta/preço, ainda não pago
 * - Liquidado: apenas pagamentos CONFIRMADO (comprovativo)
 */

function isPrevistoApproved(need) {
  return need.status !== "PENDING" && need.status !== "REJECTED";
}

function calcPrevistoTotal(need) {
  if (!isPrevistoApproved(need)) return 0;
  return needLineTotal(need, "previsto");
}

/** Realizado: tem preço de mercado (EM_ANALISE, APPROVED c/ cotação, ORDERED, PAID). */
function calcRealizadoTotal(need) {
  if (needRealizadoUnitPrice(need) == null) return 0;
  return needLineTotal(need, "realizado");
}

function pctDesvio(from, to) {
  const base = Number(from) || 0;
  const target = Number(to) || 0;
  if (base <= 0) return target > 0 ? 100 : 0;
  return ((target - base) / base) * 100;
}

async function computeProjectBudgetSummary(projectId) {
  const [centers, needs, payments, extras] = await Promise.all([
    prisma.costCenter.findMany({
      where: { projectId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, currency: true },
    }),
    prisma.workNeed.findMany({
      where: { projectId },
      select: {
        costCenterId: true,
        status: true,
        quantity: true,
        unitPrice: true,
        originalUnitPrice: true,
        hours: true,
        scheduled: true,
        priceExceptionReason: true,
      },
    }),
    prisma.costPayment.findMany({
      where: { projectId },
      select: {
        costCenterId: true,
        status: true,
        budgetedAmount: true,
        paidAmount: true,
      },
    }),
    prisma.extraRequest.findMany({
      where: {
        projectId,
        type: "OBRA",
        status: { notIn: ["REJEITADO", "CANCELADO"] },
      },
      select: { costCenterId: true, amount: true, status: true, currency: true },
    }),
  ]);

  const byCc = {};
  centers.forEach((cc) => {
    byCc[cc.id] = {
      costCenterId: cc.id,
      code: cc.code,
      name: cc.name,
      currency: cc.currency || "AOA",
      previsto: 0,
      realizado: 0,
      liquidado: 0,
    };
  });

  needs.forEach((need) => {
    const ccId = need.costCenterId;
    if (!byCc[ccId]) return;
    byCc[ccId].previsto += calcPrevistoTotal(need);
    byCc[ccId].realizado += calcRealizadoTotal(need);
  });

  payments.forEach((p) => {
    const ccId = p.costCenterId;
    if (!byCc[ccId]) return;
    if (p.status === "CONFIRMADO") {
      byCc[ccId].liquidado += Number(p.paidAmount || p.budgetedAmount || 0);
    }
  });

  extras.forEach((er) => {
    if (er.status !== "PAGO" || !er.costCenterId || !byCc[er.costCenterId]) return;
    byCc[er.costCenterId].liquidado += Number(er.amount || 0);
  });

  const totalsByCurrency = {};
  const costCenters = Object.values(byCc).map((row) => {
    const desvioPrevistoRealizado = pctDesvio(row.previsto, row.realizado);
    const desvioRealizadoLiquidado = pctDesvio(row.realizado, row.liquidado);
    const cur = row.currency || "AOA";
    if (!totalsByCurrency[cur]) {
      totalsByCurrency[cur] = {
        previsto: 0,
        realizado: 0,
        liquidado: 0,
        desvioPrevistoRealizado: 0,
        desvioRealizadoLiquidado: 0,
        pctLiquidadoSobrePrevisto: 0,
      };
    }
    totalsByCurrency[cur].previsto += row.previsto;
    totalsByCurrency[cur].realizado += row.realizado;
    totalsByCurrency[cur].liquidado += row.liquidado;

    return {
      ...row,
      desvioPrevistoRealizado,
      desvioRealizadoLiquidado,
    };
  });

  Object.keys(totalsByCurrency).forEach((cur) => {
    const t = totalsByCurrency[cur];
    t.desvioPrevistoRealizado = pctDesvio(t.previsto, t.realizado);
    t.desvioRealizadoLiquidado = pctDesvio(t.realizado, t.liquidado);
    t.pctLiquidadoSobrePrevisto =
      t.previsto > 0 ? Math.min(100, (t.liquidado / t.previsto) * 100) : 0;
  });

  return {
    projectId,
    rule: {
      previsto: "Baseline aprovado (originalUnitPrice)",
      realizado: "Preço comprometido — inclui Em análise com proposta, ainda não pago",
      liquidado: "Apenas CostPayment CONFIRMADO e extras PAGO",
    },
    costCenters,
    totalsByCurrency,
  };
}

module.exports = {
  calcPrevistoTotal,
  calcRealizadoTotal,
  computeProjectBudgetSummary,
};
