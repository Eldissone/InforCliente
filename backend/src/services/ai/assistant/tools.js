const { prisma } = require("../../../db");
const { computeProjectBudgetSummary } = require("../../projectBudgetSummaryService");
const { applyMode } = require("./anonymizer");

/**
 * Ferramentas SÓ DE LEITURA que o assistente pode chamar.
 *
 * Cada ferramenta declara:
 *  - `category`: categoria de dados (Gestão do Sistema → IA). Categoria "off"
 *    → a ferramenta nem é oferecida ao modelo.
 *  - `module`: módulo de permissões necessário ("obras" | "stock" | "financeiro").
 * Os números vêm sempre da base de dados; a IA só os explica.
 */

const DAY = 24 * 60 * 60 * 1000;

function num(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function day(date) {
  return date ? new Date(date).toISOString().slice(0, 10) : null;
}

function mode(ctx, category) {
  return ctx.categories[category] || "off";
}

function allows(ctx, category) {
  return mode(ctx, category) !== "off";
}

/** Resolve a obra (id ou código), validando acesso e exclusões. */
async function resolveProject(ctx, ref) {
  const value = String(ref || ctx.defaultProjectId || "").trim();
  if (!value) return { error: "Indique a obra (código ou nome). Use list_projects para ver as obras." };
  const project = await prisma.project.findFirst({
    where: { OR: [{ id: value }, { code: { equals: value, mode: "insensitive" } }, { name: { equals: value, mode: "insensitive" } }] },
    select: { id: true, code: true, name: true },
  });
  if (!project || !ctx.access.projectIds.has(project.id)) {
    return { error: "Obra não encontrada, sem acesso para este utilizador, ou excluída do envio à IA." };
  }
  ctx.touchedProjects.add(project.id);
  return { project };
}

const projectParam = {
  type: "string",
  description: "Código ou id da obra. Pode omitir se a conversa já é sobre uma obra.",
};

const TOOLS = [
  {
    name: "list_projects",
    label: "Lista de obras",
    category: "progress",
    module: "obras",
    description: "Lista as obras a que o utilizador tem acesso, com estado, avanço físico e datas.",
    parameters: { type: "object", properties: {} },
    async run(ctx) {
      const rows = await prisma.project.findMany({
        where: { id: { in: [...ctx.access.projectIds] } },
        select: { code: true, name: true, status: true, physicalProgressPct: true, startDate: true, dueDate: true, location: true },
        orderBy: { name: "asc" },
        take: 100,
      });
      return rows.map((p) => ({
        code: p.code,
        name: p.name,
        status: p.status,
        physicalProgressPct: num(p.physicalProgressPct),
        startDate: day(p.startDate),
        dueDate: day(p.dueDate),
        location: p.location,
      }));
    },
  },
  {
    name: "get_project_summary",
    label: "Resumo da obra",
    category: "progress",
    module: "obras",
    description:
      "Resumo de uma obra: estado, datas, avanço físico, pessoal, paragens, planos diários atrasados e necessidades pendentes (e orçamento, se autorizado).",
    parameters: { type: "object", properties: { project: projectParam } },
    async run(ctx, args) {
      const { project, error } = await resolveProject(ctx, args.project);
      if (error) return { error };
      const now = new Date();
      const [p, latePlans, pendingNeeds, pauses] = await Promise.all([
        prisma.project.findUnique({ where: { id: project.id } }),
        prisma.dailyPlan.count({ where: { projectId: project.id, status: { not: "COMPLETED" }, plannedEndDate: { lt: now } } }),
        prisma.workNeed.count({ where: { projectId: project.id, status: { in: ["PENDING", "EM_ANALISE", "IN_QUOTATION"] } } }),
        prisma.projectPause.findMany({ where: { projectId: project.id }, orderBy: { startDate: "desc" }, take: 5 }),
      ]);
      const out = {
        code: p.code,
        name: p.name,
        status: p.status,
        phase: p.phaseLabel,
        location: p.location,
        startDate: day(p.startDate),
        dueDate: day(p.dueDate),
        actualEndDate: day(p.actualEndDate),
        daysToDue: p.dueDate ? Math.ceil((new Date(p.dueDate) - now) / DAY) : null,
        physicalProgressPct: num(p.physicalProgressPct),
        activeStaffCount: p.activeStaffCount,
        lastAccidentDate: day(p.lastAccidentDate),
        lateDailyPlans: latePlans,
        pendingNeeds,
        pauses: pauses.map((x) => ({ from: day(x.startDate), to: day(x.endDate), reason: x.reason })),
      };
      if (allows(ctx, "budget") && ctx.access.modules.financeiro) {
        ctx.usedCategories.add("budget");
        out.budget = {
          currency: p.currency,
          total: num(p.budgetTotal),
          consumed: num(p.budgetConsumed),
          committed: num(p.budgetCommitted),
          available: num(p.budgetAvailable),
        };
      }
      return out;
    },
  },
  {
    name: "get_progress",
    label: "Avanço físico (WBS)",
    category: "progress",
    module: "obras",
    description: "Avanço físico por item da WBS (quantidade prevista vs executada) e os últimos registos de execução.",
    parameters: { type: "object", properties: { project: projectParam } },
    async run(ctx, args) {
      const { project, error } = await resolveProject(ctx, args.project);
      if (error) return { error };
      const [tasks, history] = await Promise.all([
        prisma.projectProgressTask.findMany({
          where: { projectId: project.id },
          orderBy: [{ itemGroup: "asc" }, { order: "asc" }],
          take: 80,
          select: { wbsCode: true, itemGroup: true, description: true, unit: true, expectedQty: true, executedQty: true, parentId: true },
        }),
        prisma.projectProgressHistory.findMany({
          where: { projectId: project.id },
          orderBy: { date: "desc" },
          take: 10,
          include: { task: { select: { description: true, unit: true } } },
        }),
      ]);
      const namesMode = mode(ctx, "personnel_names");
      if (namesMode !== "off") ctx.usedCategories.add("personnel_names");
      return {
        items: tasks.map((t) => {
          const expected = Number(t.expectedQty) || 0;
          const executed = Number(t.executedQty) || 0;
          return {
            wbs: t.wbsCode,
            group: t.itemGroup,
            description: t.description,
            unit: t.unit,
            expected: num(expected),
            executed: num(executed),
            pct: expected > 0 ? num((executed / expected) * 100) : null,
            isSubItem: Boolean(t.parentId),
          };
        }),
        recentEntries: history.map((h) => ({
          date: day(h.date),
          task: h.task?.description,
          qty: num(h.executedQty),
          unit: h.task?.unit,
          technician: applyMode(namesMode, ctx.anonymizer, "Pessoa", h.technicianName),
          notes: h.notes,
        })),
      };
    },
  },
  {
    name: "get_daily_plans",
    label: "Planos diários",
    category: "progress",
    module: "obras",
    description: "Planos diários da obra (estado, datas, atraso, nº de tarefas e materiais). Pode filtrar só os atrasados.",
    parameters: {
      type: "object",
      properties: {
        project: projectParam,
        onlyLate: { type: "boolean", description: "Só os planos atrasados (fim previsto já passou e não concluídos)." },
      },
    },
    async run(ctx, args) {
      const { project, error } = await resolveProject(ctx, args.project);
      if (error) return { error };
      const now = new Date();
      const where = { projectId: project.id };
      if (args.onlyLate) Object.assign(where, { status: { not: "COMPLETED" }, plannedEndDate: { lt: now } });
      const plans = await prisma.dailyPlan.findMany({
        where,
        orderBy: { date: "desc" },
        take: 30,
        include: { _count: { select: { tasks: true, materials: true } } },
      });
      return plans.map((p) => ({
        date: day(p.date),
        plannedEnd: day(p.plannedEndDate),
        status: p.status,
        description: p.description,
        tasks: p._count.tasks,
        materials: p._count.materials,
        late: p.status !== "COMPLETED" && p.plannedEndDate ? new Date(p.plannedEndDate) < now : false,
        daysLate:
          p.status !== "COMPLETED" && p.plannedEndDate && new Date(p.plannedEndDate) < now
            ? Math.floor((now - new Date(p.plannedEndDate)) / DAY)
            : 0,
      }));
    },
  },
  {
    name: "get_work_needs",
    label: "Necessidades da obra",
    category: "needs",
    module: "obras",
    description: "Necessidades (pedidos de material/serviço) da obra, com estado, prioridade e há quantos dias estão abertas.",
    parameters: {
      type: "object",
      properties: {
        project: projectParam,
        status: {
          type: "string",
          enum: ["PENDING", "IN_QUOTATION", "EM_ANALISE", "APPROVED", "ORDERED", "REJECTED", "PAID"],
          description: "Filtrar por estado (opcional).",
        },
      },
    },
    async run(ctx, args) {
      const { project, error } = await resolveProject(ctx, args.project);
      if (error) return { error };
      const needs = await prisma.workNeed.findMany({
        where: { projectId: project.id, ...(args.status ? { status: args.status } : {}) },
        orderBy: { date: "desc" },
        take: 50,
      });
      const now = new Date();
      const showPrices = allows(ctx, "budget") && ctx.access.modules.financeiro;
      if (showPrices) ctx.usedCategories.add("budget");
      const namesMode = mode(ctx, "personnel_names");
      if (namesMode !== "off") ctx.usedCategories.add("personnel_names");
      return needs.map((n) => ({
        date: day(n.date),
        description: n.description,
        quantity: num(n.quantity),
        unit: n.unit,
        status: n.status,
        priority: n.priority,
        daysOpen: Math.floor((now - new Date(n.date)) / DAY),
        receivedOnSite: Boolean(n.siteReceivedAt),
        plannedReception: day(n.siteReceptionPlannedAt),
        responsible: applyMode(namesMode, ctx.anonymizer, "Pessoa", n.responsible),
        ...(showPrices ? { unitPrice: num(n.unitPrice) } : {}),
      }));
    },
  },
  {
    name: "get_stock",
    label: "Stock da obra",
    category: "stock",
    module: "stock",
    description:
      "Stock nos armazéns da obra (quantidade vs mínimo) e materiais pedidos nos planos diários dos próximos 7 dias que não têm stock suficiente.",
    parameters: { type: "object", properties: { project: projectParam } },
    async run(ctx, args) {
      const { project, error } = await resolveProject(ctx, args.project);
      if (error) return { error };
      const warehouses = await prisma.warehouse.findMany({ where: { projectId: project.id, active: true }, select: { id: true, name: true } });
      const whIds = warehouses.map((w) => w.id);
      const stock = whIds.length
        ? await prisma.warehouseStock.findMany({
            where: { warehouseId: { in: whIds } },
            include: { product: { select: { id: true, name: true, unit: true, minStock: true } } },
            take: 300,
          })
        : [];
      const byProduct = new Map();
      for (const s of stock) {
        const cur = byProduct.get(s.productId) || { product: s.product, qty: 0 };
        cur.qty += Number(s.quantity) || 0;
        byProduct.set(s.productId, cur);
      }

      const now = new Date();
      const upcoming = await prisma.dailyPlanMaterial.findMany({
        where: {
          dailyPlan: { projectId: project.id, status: { not: "COMPLETED" }, date: { gte: new Date(now - DAY), lte: new Date(+now + 7 * DAY) } },
        },
        include: { product: { select: { id: true, name: true, unit: true } }, dailyPlan: { select: { date: true } } },
        take: 300,
      });
      const needed = new Map();
      for (const m of upcoming) {
        const cur = needed.get(m.productId) || { product: m.product, qty: 0, firstDate: m.dailyPlan.date };
        cur.qty += Math.max(0, (Number(m.requestedQty) || 0) - (Number(m.providedQty) || 0));
        if (m.dailyPlan.date < cur.firstDate) cur.firstDate = m.dailyPlan.date;
        needed.set(m.productId, cur);
      }

      return {
        warehouses: warehouses.map((w) => w.name),
        items: [...byProduct.values()]
          .map(({ product, qty }) => ({
            product: product.name,
            unit: product.unit,
            qty: num(qty),
            minStock: num(product.minStock),
            belowMin: Number(product.minStock) > 0 && qty < Number(product.minStock),
          }))
          .sort((a, b) => Number(b.belowMin) - Number(a.belowMin))
          .slice(0, 120),
        shortagesNext7Days: [...needed.entries()]
          .map(([productId, n]) => {
            const have = byProduct.get(productId)?.qty || 0;
            return { product: n.product.name, unit: n.product.unit, needed: num(n.qty), inStock: num(have), missing: num(Math.max(0, n.qty - have)), firstNeededOn: day(n.firstDate) };
          })
          .filter((x) => x.missing > 0),
      };
    },
  },
  {
    name: "get_budget_status",
    label: "Orçamento por centro de custo",
    category: "budget",
    module: "financeiro",
    description: "Orçamento da obra por centro de custo: previsto (baseline), realizado (comprometido) e liquidado (pago), com desvios.",
    parameters: { type: "object", properties: { project: projectParam } },
    async run(ctx, args) {
      const { project, error } = await resolveProject(ctx, args.project);
      if (error) return { error };
      const summary = await computeProjectBudgetSummary(project.id);
      return {
        rule: summary.rule,
        totalsByCurrency: Object.fromEntries(
          Object.entries(summary.totalsByCurrency).map(([cur, t]) => [
            cur,
            Object.fromEntries(Object.entries(t).map(([k, v]) => [k, num(v)])),
          ])
        ),
        costCenters: summary.costCenters.slice(0, 60).map((c) => ({
          code: c.code,
          name: c.name,
          currency: c.currency,
          previsto: num(c.previsto),
          realizado: num(c.realizado),
          liquidado: num(c.liquidado),
          desvioPrevistoRealizadoPct: num(c.desvioPrevistoRealizado),
        })),
      };
    },
  },
  {
    name: "get_payments",
    label: "Pagamentos da obra",
    category: "payments",
    module: "financeiro",
    description: "Pagamentos/custos da obra: valor, data, estado e se estão em atraso.",
    parameters: {
      type: "object",
      properties: {
        project: projectParam,
        status: { type: "string", enum: ["PENDENTE", "EM_ESPERA", "CONFIRMADO", "CANCELADO"], description: "Filtrar por estado (opcional)." },
      },
    },
    async run(ctx, args) {
      const { project, error } = await resolveProject(ctx, args.project);
      if (error) return { error };
      const rows = await prisma.costPayment.findMany({
        where: { projectId: project.id, ...(args.status ? { status: args.status } : {}) },
        orderBy: { paymentDate: "desc" },
        take: 40,
        include: { costCenter: { select: { code: true, currency: true } }, supplierRef: { select: { name: true } } },
      });
      const now = new Date();
      const supplierMode = mode(ctx, "suppliers");
      if (supplierMode !== "off") ctx.usedCategories.add("suppliers");
      return rows.map((p) => ({
        date: day(p.paymentDate),
        description: p.description,
        costCenter: p.costCenter?.code,
        currency: p.costCenter?.currency,
        budgeted: num(p.budgetedAmount),
        paid: num(p.paidAmount),
        status: p.status,
        overdue: p.status === "PENDENTE" && new Date(p.paymentDate) < now,
        supplier: applyMode(supplierMode, ctx.anonymizer, "Fornecedor", p.supplierRef?.name || p.supplier),
      }));
    },
  },
  {
    name: "get_measurement_reports",
    label: "Autos de medição",
    category: "progress",
    module: "obras",
    description: "Últimos autos de medição da obra (número, data, estado e totais do período).",
    parameters: { type: "object", properties: { project: projectParam } },
    async run(ctx, args) {
      const { project, error } = await resolveProject(ctx, args.project);
      if (error) return { error };
      const rows = await prisma.measurementReport.findMany({
        where: { projectId: project.id },
        orderBy: { reportDate: "desc" },
        take: 10,
      });
      const showValues = allows(ctx, "budget") && ctx.access.modules.financeiro;
      if (showValues) ctx.usedCategories.add("budget");
      return rows.map((r) => ({
        number: r.reportNumber,
        date: day(r.reportDate),
        status: r.status,
        periodQty: num(r.periodQtyTotal),
        ...(showValues ? { periodValue: num(r.periodValTotal) } : {}),
      }));
    },
  },
  {
    name: "get_project_photos",
    label: "Fotos da obra",
    category: "photos",
    module: "obras",
    description:
      "Fotos mais recentes da galeria da obra (data, descrição, tarefa associada). As imagens aparecem automaticamente ao utilizador por baixo da resposta: não escrevas endereços nem links, refere-as por F1, F2…",
    parameters: {
      type: "object",
      properties: {
        project: projectParam,
        limit: { type: "integer", description: "Quantas fotos (1 a 12). Por omissão 3." },
      },
    },
    async run(ctx, args) {
      const { project, error } = await resolveProject(ctx, args.project);
      if (error) return { error };
      const limit = Math.min(12, Math.max(1, Number.parseInt(args.limit, 10) || 3));
      const rows = await prisma.projectPhoto.findMany({
        where: { projectId: project.id },
        orderBy: [{ takenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: limit,
        select: { id: true, path: true, description: true, takenAt: true, createdAt: true, progressTaskId: true, aiAnalysis: true },
      });
      const taskIds = rows.map((r) => r.progressTaskId).filter(Boolean);
      const tasks = taskIds.length
        ? await prisma.projectProgressTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, wbsCode: true, description: true } })
        : [];
      const taskById = new Map(tasks.map((t) => [t.id, `${t.wbsCode ? `${t.wbsCode} · ` : ""}${t.description}`]));
      // As imagens vão só para o ecrã (nunca para a IA); a IA recebe a descrição e a data.
      ctx.photos = ctx.photos || [];
      const out = rows.map((r, i) => {
        if (!ctx.photos.some((p) => p.id === r.id)) {
          ctx.photos.push({ id: r.id, projectId: project.id, projectCode: project.code, path: r.path, description: r.description, date: day(r.takenAt || r.createdAt) });
        }
        return {
          ref: `F${i + 1}`,
          date: day(r.takenAt || r.createdAt),
          description: r.description || null,
          aiCaption: r.aiAnalysis?.caption || null,
          task: r.progressTaskId ? taskById.get(r.progressTaskId) || null : null,
        };
      });
      return { project: project.code, count: out.length, photos: out };
    },
  },
];

/** Ferramentas oferecidas ao modelo para este utilizador e estas definições. */
function availableTools(ctx) {
  return TOOLS.filter((t) => allows(ctx, t.category) && ctx.access.modules[t.module]);
}

/** Todas as ferramentas, para o ecrã saber o que está indisponível e porquê. */
function describeTools() {
  return TOOLS.map(({ name, label, category, module }) => ({ name, label, category, module }));
}

module.exports = { TOOLS, availableTools, describeTools };
