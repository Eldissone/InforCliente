const { prisma } = require("../../../db");

/**
 * Contexto de tarefas da obra (tarefas WBS folha e tarefas dos planos diários
 * abertos). Usado pela análise de fotos para associar a foto à tarefa.
 * (O registo de execução por texto ou voz, que também o usava, foi retirado.)
 */

const DAY = 24 * 60 * 60 * 1000;
const OPEN_PLAN_STATUSES = ["DRAFT", "IN_PROGRESS", "PENDING_VALIDATION"];
const MAX_TASKS = 400;

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const round = (v, d = 4) => Math.round(Number(v) * 10 ** d) / 10 ** d;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Tarefas WBS folha (onde se regista execução) e tarefas dos planos abertos. */
async function loadContext(projectId, now = new Date()) {
  const all = await prisma.projectProgressTask.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { id: true, parentId: true, wbsCode: true, itemGroup: true, description: true, unit: true, expectedQty: true, executedQty: true },
  });
  const byId = new Map(all.map((t) => [t.id, t]));
  const hasChildren = new Set(all.map((t) => t.parentId).filter(Boolean));
  const path = (t) => {
    const names = [];
    for (let p = t.parentId && byId.get(t.parentId); p && names.length < 4; p = p.parentId && byId.get(p.parentId)) names.unshift(p.description);
    return names.join(" > ");
  };
  const leaves = all.filter((t) => !hasChildren.has(t.id)).slice(0, MAX_TASKS);
  const tasks = leaves.map((t, i) => ({
    ref: `T${i + 1}`,
    id: t.id,
    wbsCode: t.wbsCode,
    group: t.itemGroup,
    path: path(t),
    description: t.description,
    unit: t.unit,
    expectedQty: round(num(t.expectedQty)),
    executedQty: round(num(t.executedQty)),
  }));
  const taskRef = new Map(tasks.map((t) => [t.id, t.ref]));

  const planRows = await prisma.dailyPlanTask.findMany({
    where: {
      dailyPlan: { projectId, status: { in: OPEN_PLAN_STATUSES }, date: { gte: new Date(+now - 7 * DAY), lte: new Date(+now + DAY) } },
    },
    include: { dailyPlan: { select: { id: true, date: true, description: true, status: true } } },
    take: 200,
  });
  const planTasks = planRows
    .filter((p) => taskRef.has(p.progressTaskId))
    .sort((a, b) => new Date(b.dailyPlan.date) - new Date(a.dailyPlan.date))
    .map((p, i) => ({
      ref: `P${i + 1}`,
      id: p.id,
      taskRef: taskRef.get(p.progressTaskId),
      taskId: p.progressTaskId,
      planId: p.dailyPlan.id,
      planDate: iso(p.dailyPlan.date),
      planDescription: p.dailyPlan.description || `Plano de ${iso(p.dailyPlan.date)}`,
      planStatus: p.dailyPlan.status,
      plannedQty: round(num(p.plannedQty)),
      reportedQty: round(num(p.executedQty)),
    }));
  return { tasks, planTasks };
}

module.exports = { loadContext, OPEN_PLAN_STATUSES };
