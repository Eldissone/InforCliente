const { prisma } = require("../../db");
const { getSettings, invalidateCache } = require("./settingsService");

/**
 * Consumo da IA: regista cada pedido (o que foi enviado, tokens, custo),
 * aplica os limites (diário por utilizador, mensal global) e avisa os
 * administradores quando o gasto do mês passa os 80 % do orçamento.
 */

const BUDGET_ALERT_RATIO = 0.8;

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function estimateCost(settings, { inputTokens, outputTokens }) {
  const inPrice = settings.inputPricePerMTok;
  const outPrice = settings.outputPricePerMTok;
  if (inPrice == null && outPrice == null) return null;
  return ((inputTokens || 0) * (inPrice || 0) + (outputTokens || 0) * (outPrice || 0)) / 1_000_000;
}

async function monthSpend(date = new Date()) {
  const agg = await prisma.aiRequestLog.aggregate({
    where: { createdAt: { gte: startOfMonth(date) } },
    _sum: { estimatedCost: true },
  });
  return Number(agg._sum.estimatedCost || 0);
}

/**
 * Verifica os limites antes de um pedido. Devolve `{ ok, reason }`.
 * A leitura de faturas também conta, para o orçamento ser real.
 */
async function checkQuota(userId) {
  const settings = await getSettings();
  if (userId && settings.dailyRequestsPerUser > 0) {
    const today = await prisma.aiRequestLog.count({
      where: { userId, status: "OK", createdAt: { gte: startOfDay() } },
    });
    if (today >= settings.dailyRequestsPerUser) {
      return { ok: false, reason: `Atingiu o limite diário de ${settings.dailyRequestsPerUser} pedidos à IA.` };
    }
  }
  if (settings.monthlyBudget != null && settings.monthlyBudget > 0) {
    const spent = await monthSpend();
    if (spent >= settings.monthlyBudget) {
      return { ok: false, reason: "O orçamento mensal da IA foi atingido. Fale com o administrador." };
    }
  }
  return { ok: true };
}

async function logRequest({
  userId,
  feature,
  provider,
  model,
  categories = [],
  projectIds = [],
  usage = {},
  status,
  errorMessage,
  io,
}) {
  try {
    const settings = await getSettings();
    const estimatedCost = status === "OK" ? estimateCost(settings, usage) : null;
    await prisma.aiRequestLog.create({
      data: {
        userId: userId || null,
        feature,
        provider,
        model: model || null,
        categories,
        projectIds,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        estimatedCost,
        status,
        errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : null,
      },
    });
    if (estimatedCost) await maybeAlertBudget(settings, io);
  } catch (error) {
    // O registo nunca deve partir a funcionalidade que usou a IA.
    console.error("[ai] falha ao registar o pedido:", error.message);
  }
}

async function maybeAlertBudget(settings, io) {
  if (!settings.monthlyBudget) return;
  const month = monthKey();
  if (settings.budgetAlertMonth === month) return;
  const spent = await monthSpend();
  if (spent < settings.monthlyBudget * BUDGET_ALERT_RATIO) return;

  await prisma.aiSettings.update({ where: { id: "default" }, data: { budgetAlertMonth: month } });
  invalidateCache();

  const { dispatchNotification } = require("../notifications/dispatcher");
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
  const pct = Math.round((spent / settings.monthlyBudget) * 100);
  await Promise.all(
    admins.map((user) =>
      dispatchNotification({
        io,
        user,
        type: "SYSTEM",
        priority: "HIGH",
        title: `IA: ${pct}% do orçamento mensal gasto`,
        body: `Gasto estimado ${spent.toFixed(2)} de ${settings.monthlyBudget.toFixed(2)} ${settings.budgetCurrency} este mês.`,
        link: "/Users?section=ai",
        metadata: { event: "AI_BUDGET_ALERT", month },
      })
    )
  );
}

/** Resumo para o painel de consumo (mês corrente). */
async function usageSummary(date = new Date()) {
  const since = startOfMonth(date);
  const where = { createdAt: { gte: since } };
  const [byFeature, byUser, totals, recent] = await Promise.all([
    prisma.aiRequestLog.groupBy({
      by: ["feature"],
      where,
      _count: { _all: true },
      _sum: { estimatedCost: true, inputTokens: true, outputTokens: true },
    }),
    prisma.aiRequestLog.groupBy({
      by: ["userId"],
      where,
      _count: { _all: true },
      _sum: { estimatedCost: true },
      orderBy: { _count: { userId: "desc" } },
      take: 10,
    }),
    prisma.aiRequestLog.aggregate({
      where,
      _count: { _all: true },
      _sum: { estimatedCost: true, inputTokens: true, outputTokens: true },
    }),
    prisma.aiRequestLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const userIds = byUser.map((u) => u.userId).filter(Boolean);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
  const userName = new Map(users.map((u) => [u.id, u.name || u.email]));

  // Consumo por obra: os pedidos guardam a lista de obras enviadas.
  const projectCounts = new Map();
  const monthRows = await prisma.aiRequestLog.findMany({ where, select: { projectIds: true } });
  for (const row of monthRows) {
    for (const pid of Array.isArray(row.projectIds) ? row.projectIds : []) {
      projectCounts.set(pid, (projectCounts.get(pid) || 0) + 1);
    }
  }
  const projects = await prisma.project.findMany({
    where: { id: { in: [...projectCounts.keys()] } },
    select: { id: true, code: true, name: true },
  });

  return {
    month: monthKey(date),
    requests: totals._count._all,
    inputTokens: totals._sum.inputTokens || 0,
    outputTokens: totals._sum.outputTokens || 0,
    estimatedCost: Number(totals._sum.estimatedCost || 0),
    byFeature: byFeature.map((f) => ({
      feature: f.feature,
      requests: f._count._all,
      estimatedCost: Number(f._sum.estimatedCost || 0),
    })),
    byUser: byUser.map((u) => ({
      userId: u.userId,
      name: u.userId ? userName.get(u.userId) || "—" : "Sistema",
      requests: u._count._all,
      estimatedCost: Number(u._sum.estimatedCost || 0),
    })),
    byProject: projects
      .map((p) => ({ ...p, requests: projectCounts.get(p.id) || 0 }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 10),
    recent: recent.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      user: r.user ? r.user.name || r.user.email : "Sistema",
      feature: r.feature,
      provider: r.provider,
      model: r.model,
      categories: r.categories,
      projectCount: Array.isArray(r.projectIds) ? r.projectIds.length : 0,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      estimatedCost: r.estimatedCost == null ? null : Number(r.estimatedCost),
      status: r.status,
      errorMessage: r.errorMessage,
    })),
  };
}

module.exports = { checkQuota, logRequest, usageSummary, estimateCost, monthSpend };
