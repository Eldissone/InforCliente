/**
 * Requisições de material (Fase 4).
 *
 * UM documento para os dois pedidos que o protótipo separava:
 *   destino ARMAZEM → o armazém atende do stock (era o `sreq`)
 *   destino COMPRA  → segue para compra (era o `oreq`)
 *
 * Fluxo: Rascunho → Submetida → Aprovada → Entregar (do stock) / Pedir compra / Recusar.
 * A entrega pode ser parcial; «Pedir compra» cria um `PurchaseOrder`, reutilizando a
 * cadeia de compra que já existe em vez de duplicá-la.
 *
 * O custo: material que entra no armazém não é custo. O custo nasce na **saída**,
 * ao custo médio do armazém (ver `services/stock/stockCost.js`).
 */

const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { checkUserPermission } = require("../services/permissionResolver");
const { applyMovement, readStock, warehouseValue } = require("../services/stock/stockCost");

const requisitionRoutes = express.Router();
requisitionRoutes.use(authRequired);

/** O módulo de permissões: as requisições são de obra/logística, não do Comercial. */
const MODULE = "stock";
/** Quem pede pode ser de qualquer obra: a leitura usa o módulo das obras. */
const READ_MODULE = "obras";

const DESTINATIONS = ["ARMAZEM", "COMPRA"];
const STATUSES = ["RASCUNHO", "SUBMETIDA", "APROVADA", "PARCIAL", "ATENDIDA", "EM_COMPRA", "RECUSADA", "CANCELADA"];

/** Estados em que o documento ainda está em jogo. */
const OPEN_STATUSES = ["SUBMETIDA", "APROVADA", "PARCIAL", "EM_COMPRA"];

/** Categorias de custo, as mesmas do orçamento. */
const COST_CATEGORIES = [
  ["MAT", "Materiais"],
  ["FE", "Ferramentas e consumíveis"],
  ["EQ", "Equipamentos"],
  ["VI", "Viaturas"],
  ["LOG", "Logística e estaleiro"],
  ["RH", "Recursos humanos"],
  ["SUB", "Subempreitadas"],
  ["IND", "Estrutura e sede"],
];

/** Os passos do fluxo, para o ecrã os mostrar no topo. */
const FLOW = [
  "Quem precisa pede",
  "O responsável aprova",
  "O armazém entrega do stock",
  "Sem stock, vai a compra",
  "Quem pediu confirma a receção",
];

const num = (v) => (v === null || v === undefined ? null : Number(v));
const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round4 = (v) => Math.round(N(v) * 1e4) / 1e4;

const optText = (max) =>
  z
    .union([z.string().trim().max(max), z.null(), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

const optDate = z
  .union([z.string().trim(), z.null(), z.literal("")])
  .optional()
  .transform((v) => {
    if (!v) return null;
    const d = new Date(String(v).length <= 10 ? `${v}T00:00:00Z` : v);
    if (Number.isNaN(d.getTime())) throw new Error("DATA_INVALIDA");
    return d;
  });

const itemSchema = z.object({
  id: optText(60),
  productId: optText(60),
  description: z.string().trim().min(2).max(500),
  unit: optText(30),
  quantity: z.coerce.number().positive(),
  estimatedUnitPrice: z.union([z.coerce.number(), z.null()]).optional(),
  notes: optText(500),
});

const INCLUDE = {
  items: { orderBy: { order: "asc" }, include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
  project: { select: { id: true, code: true, name: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  sourceWarehouse: { select: { id: true, name: true, type: true } },
  targetWarehouse: { select: { id: true, name: true, type: true } },
  purchaseOrder: { select: { id: true, number: true, status: true } },
  movements: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      quantity: true,
      unitCost: true,
      totalValue: true,
      createdAt: true,
      warehouse: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
    },
  },
};

// ───────────────────────── numeração ─────────────────────────

/** RM-2026-0001, sequencial por ano, atómico como os outros documentos. */
async function allocateNumber(client) {
  const db = client || prisma;
  const year = new Date().getUTCFullYear();
  const rows = await db.$queryRaw`
    INSERT INTO "DocumentCounter" ("kind", "year", "last", "updatedAt")
    VALUES ('RM', ${year}, 1, NOW())
    ON CONFLICT ("kind", "year")
    DO UPDATE SET "last" = "DocumentCounter"."last" + 1, "updatedAt" = NOW()
    RETURNING "last"
  `;
  return `RM-${year}-${String(Number(rows[0].last)).padStart(4, "0")}`;
}

// ───────────────────────── serialização ─────────────────────────

function serialize(row) {
  const items = (row.items || []).map((i) => ({
    id: i.id,
    productId: i.productId,
    product: i.product || null,
    description: i.description,
    unit: i.unit,
    quantity: num(i.quantity),
    fulfilledQuantity: num(i.fulfilledQuantity),
    remaining: round4(N(i.quantity) - N(i.fulfilledQuantity)),
    estimatedUnitPrice: num(i.estimatedUnitPrice),
    estimatedTotal: i.estimatedUnitPrice ? round4(N(i.quantity) * N(i.estimatedUnitPrice)) : null,
    notes: i.notes,
  }));

  const requested = items.reduce((s, i) => s + N(i.quantity), 0);
  const fulfilled = items.reduce((s, i) => s + N(i.fulfilledQuantity), 0);

  return {
    id: row.id,
    number: row.number,
    destination: row.destination,
    status: row.status,
    project: row.project || null,
    department: row.department,
    costCenter: row.costCenter || null,
    costCategory: row.costCategory,
    requestedByName: row.requestedByName,
    requestedById: row.requestedById,
    neededBy: row.neededBy ? row.neededBy.toISOString().slice(0, 10) : null,
    justification: row.justification,
    sourceWarehouse: row.sourceWarehouse || null,
    targetWarehouse: row.targetWarehouse || null,
    approvedByName: row.approvedByName,
    approvedAt: row.approvedAt,
    refusalReason: row.refusalReason,
    deliveredAt: row.deliveredAt,
    purchaseOrder: row.purchaseOrder || null,
    notes: row.notes,
    history: Array.isArray(row.history) ? row.history : [],
    items,
    totals: {
      lines: items.length,
      requested: round4(requested),
      fulfilled: round4(fulfilled),
      remaining: round4(requested - fulfilled),
      estimatedValue: items.reduce((s, i) => s + N(i.estimatedTotal), 0),
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    movements: (row.movements || []).map((m) => ({
      id: m.id,
      type: m.type,
      quantity: num(m.quantity),
      unitCost: num(m.unitCost),
      totalValue: num(m.totalValue),
      createdAt: m.createdAt,
      warehouse: m.warehouse,
      product: m.product,
    })),
  };
}

/** Acrescenta uma linha ao histórico do documento. */
function pushHistory(row, req, action, detail) {
  const h = Array.isArray(row.history) ? row.history : [];
  return [
    ...h,
    {
      at: new Date().toISOString(),
      by: req.user.name || req.user.email || null,
      action,
      detail: detail || null,
    },
  ];
}

/** Quem pode decidir (aprovar/recusar) requisições. */
async function canDecide(req) {
  const { allowed } = await checkUserPermission(
    req.user.sub,
    String(req.user.role || "").toLowerCase(),
    "obras",
    "approve",
    "POST"
  );
  return allowed === "true";
}

/** Quem pode atender (entregar do stock, converter em compra). */
async function canFulfil(req) {
  const { allowed } = await checkUserPermission(
    req.user.sub,
    String(req.user.role || "").toLowerCase(),
    "stock",
    "manage",
    "POST"
  );
  return allowed === "true";
}

/** Verificações antes de entregar ou mandar comprar. */
function buildChecklist(r, stockByItem) {
  const out = [
    { label: "Tem pelo menos um item com quantidade", ok: r.items.length > 0 && r.items.every((i) => N(i.quantity) > 0), required: true },
    { label: "Está aprovada", ok: ["APROVADA", "PARCIAL"].includes(r.status), required: true },
    { label: "Armazém de origem escolhido", ok: Boolean(r.sourceWarehouse), required: r.destination === "ARMAZEM" },
    {
      label: "Destino do material escolhido",
      ok: Boolean(r.targetWarehouse) || !r.project,
      required: r.destination === "ARMAZEM" && Boolean(r.project),
    },
    { label: "Todos os itens ligados a um produto do catálogo", ok: r.items.every((i) => i.productId), required: r.destination === "ARMAZEM" },
    { label: "Categoria de custo indicada", ok: Boolean(r.costCategory), required: false },
    { label: "Data em que é preciso", ok: Boolean(r.neededBy), required: false },
  ];
  if (stockByItem) {
    const semStock = r.items.filter((i) => {
      const s = stockByItem[i.id];
      return s && N(s.quantity) < N(i.remaining);
    });
    out.push({
      label: semStock.length ? `Stock suficiente (faltam ${semStock.length} item(ns))` : "Stock suficiente",
      ok: semStock.length === 0,
      required: false,
    });
  }
  return out;
}

// ───────────────────────── metadados ─────────────────────────

requisitionRoutes.get(
  "/meta",
  requirePermission(READ_MODULE, "view"),
  asyncHandler(async (req, res) => {
    const [warehouses, projects, decide, fulfil] = await Promise.all([
      prisma.warehouse.findMany({
        where: { active: true },
        select: { id: true, name: true, type: true, projectId: true },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      }),
      prisma.project.findMany({
        where: { active: true },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
        take: 300,
      }),
      canDecide(req),
      canFulfil(req),
    ]);
    res.json({
      destinations: DESTINATIONS,
      statuses: STATUSES,
      costCategories: COST_CATEGORIES,
      flow: FLOW,
      warehouses,
      projects,
      can: { decide, fulfil },
      me: req.user.name || req.user.email || "",
    });
  })
);

// ───────────────────────── lista ─────────────────────────

requisitionRoutes.get(
  "/",
  requirePermission(READ_MODULE, "view"),
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || "").toUpperCase();
    const destination = String(req.query.destination || "").toUpperCase();
    const q = String(req.query.q || "").trim();
    /** Aba por papel, não por área (ver o plano, §S2). */
    const role = String(req.query.role || "").toLowerCase();

    const where = {};
    if (STATUSES.includes(status)) where.status = status;
    else if (String(req.query.open || "") === "1") where.status = { in: OPEN_STATUSES };
    if (DESTINATIONS.includes(destination)) where.destination = destination;
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (q) {
      where.OR = [
        { number: { contains: q, mode: "insensitive" } },
        { requestedByName: { contains: q, mode: "insensitive" } },
        { department: { contains: q, mode: "insensitive" } },
        { justification: { contains: q, mode: "insensitive" } },
        { project: { name: { contains: q, mode: "insensitive" } } },
        { project: { code: { contains: q, mode: "insensitive" } } },
        { items: { some: { description: { contains: q, mode: "insensitive" } } } },
      ];
    }

    // As abas: o mesmo ecrã, filtrado pelo papel de quem olha
    if (role === "minhas") where.requestedById = req.user.sub;
    else if (role === "decidir") where.status = "SUBMETIDA";
    else if (role === "entregar") {
      where.status = { in: ["APROVADA", "PARCIAL"] };
      where.destination = "ARMAZEM";
    } else if (role === "comprar") where.destination = "COMPRA";
    else if (role === "receber") where.status = { in: ["ATENDIDA", "PARCIAL"] };

    const [rows, grouped, byRole] = await Promise.all([
      prisma.materialRequisition.findMany({ where, orderBy: { createdAt: "desc" }, take: 400, include: INCLUDE }),
      prisma.materialRequisition.groupBy({ by: ["status"], _count: { _all: true } }),
      Promise.all([
        prisma.materialRequisition.count({ where: { requestedById: req.user.sub } }),
        prisma.materialRequisition.count({ where: { status: "SUBMETIDA" } }),
        prisma.materialRequisition.count({ where: { status: { in: ["APROVADA", "PARCIAL"] }, destination: "ARMAZEM" } }),
        prisma.materialRequisition.count({ where: { destination: "COMPRA" } }),
        prisma.materialRequisition.count({ where: { status: { in: ["ATENDIDA", "PARCIAL"] } } }),
      ]),
    ]);

    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const g of grouped) counts[g.status] = g._count._all;

    res.json({
      items: rows.map(serialize),
      counts,
      roleCounts: { minhas: byRole[0], decidir: byRole[1], entregar: byRole[2], comprar: byRole[3], receber: byRole[4] },
      total: rows.length,
    });
  })
);

// ───────────────────────── criar ─────────────────────────

const createSchema = z.object({
  destination: z.enum(DESTINATIONS).default("ARMAZEM"),
  projectId: optText(60),
  department: optText(120),
  costCenterId: optText(60),
  costCategory: optText(20),
  neededBy: optDate,
  justification: optText(1000),
  sourceWarehouseId: optText(60),
  targetWarehouseId: optText(60),
  notes: optText(1000),
  items: z.array(itemSchema).min(1),
  submit: z.boolean().optional(),
});

requisitionRoutes.post(
  "/",
  requirePermission(READ_MODULE, "create"),
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = createSchema.parse(req.body || {});
    } catch (err) {
      if (err instanceof Error && err.message === "DATA_INVALIDA") return res.status(400).json({ error: "DATA_INVALIDA" });
      throw err;
    }

    const errors = [];
    if (!body.projectId && !body.department) {
      errors.push("Diga para onde é o material: uma obra ou um departamento.");
    }
    if (errors.length) return res.status(400).json({ error: "REQUISICAO_INVALIDA", errors });

    // O armazém da obra é o destino natural do material pedido por uma obra
    let targetWarehouseId = body.targetWarehouseId;
    if (!targetWarehouseId && body.projectId && body.destination === "ARMAZEM") {
      const own = await prisma.warehouse.findFirst({
        where: { projectId: body.projectId, active: true },
        select: { id: true },
      });
      if (own) targetWarehouseId = own.id;
    }

    const number = await allocateNumber();
    const row = await prisma.materialRequisition.create({
      data: {
        number,
        destination: body.destination,
        status: body.submit ? "SUBMETIDA" : "RASCUNHO",
        projectId: body.projectId,
        department: body.department,
        costCenterId: body.costCenterId,
        costCategory: body.costCategory,
        requestedById: req.user.sub,
        requestedByName: req.user.name || req.user.email || "—",
        neededBy: body.neededBy,
        justification: body.justification,
        sourceWarehouseId: body.sourceWarehouseId,
        targetWarehouseId,
        notes: body.notes,
        history: [
          {
            at: new Date().toISOString(),
            by: req.user.name || req.user.email || null,
            action: body.submit ? "Criada e submetida" : "Criada como rascunho",
            detail: `${body.items.length} item(ns)`,
          },
        ],
        items: {
          create: body.items.map((i, idx) => ({
            productId: i.productId,
            description: i.description,
            unit: i.unit,
            quantity: i.quantity,
            estimatedUnitPrice: i.estimatedUnitPrice ?? null,
            notes: i.notes,
            order: idx,
          })),
        },
      },
      include: INCLUDE,
    });

    res.status(201).json(serialize(row));
  })
);

// ───────────────────────── ler um ─────────────────────────

requisitionRoutes.get(
  "/:id",
  requirePermission(READ_MODULE, "view"),
  asyncHandler(async (req, res) => {
    const row = await prisma.materialRequisition.findUnique({ where: { id: String(req.params.id) }, include: INCLUDE });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });

    const out = serialize(row);

    // Stock disponível para cada item, no armazém de origem
    const stockByItem = {};
    if (row.sourceWarehouseId) {
      for (const it of out.items) {
        if (!it.productId) continue;
        stockByItem[it.id] = await readStock(row.sourceWarehouseId, it.productId);
      }
    }
    out.stock = stockByItem;
    out.checklist = buildChecklist(out, row.sourceWarehouseId ? stockByItem : null);
    out.can = { decide: await canDecide(req), fulfil: await canFulfil(req) };
    res.json(out);
  })
);

// ───────────────────────── alterar o rascunho ─────────────────────────

requisitionRoutes.patch(
  "/:id",
  requirePermission(READ_MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.materialRequisition.findUnique({ where: { id }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (!["RASCUNHO", "RECUSADA"].includes(existing.status)) {
      return res.status(409).json({
        error: "REQUISICAO_EM_CURSO",
        errors: [`A requisição está em «${existing.status}»: só se altera em rascunho ou depois de recusada.`],
      });
    }

    let body;
    try {
      body = createSchema.partial().parse(req.body || {});
    } catch (err) {
      if (err instanceof Error && err.message === "DATA_INVALIDA") return res.status(400).json({ error: "DATA_INVALIDA" });
      throw err;
    }

    const data = {};
    for (const k of ["destination", "projectId", "department", "costCenterId", "costCategory", "justification", "sourceWarehouseId", "targetWarehouseId", "notes"]) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.neededBy !== undefined) data.neededBy = body.neededBy;

    const updated = await prisma.$transaction(async (tx) => {
      if (body.items) {
        await tx.materialRequisitionItem.deleteMany({ where: { requisitionId: id } });
        await tx.materialRequisitionItem.createMany({
          data: body.items.map((i, idx) => ({
            requisitionId: id,
            productId: i.productId,
            description: i.description,
            unit: i.unit,
            quantity: i.quantity,
            estimatedUnitPrice: i.estimatedUnitPrice ?? null,
            notes: i.notes,
            order: idx,
          })),
        });
      }
      return tx.materialRequisition.update({ where: { id }, data, include: INCLUDE });
    });

    res.json(serialize(updated));
  })
);

// ───────────────────────── submeter ─────────────────────────

requisitionRoutes.post(
  "/:id/submit",
  requirePermission(READ_MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.materialRequisition.findUnique({ where: { id }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (!["RASCUNHO", "RECUSADA"].includes(existing.status)) {
      return res.status(409).json({ error: "JA_SUBMETIDA", errors: [`A requisição está em «${existing.status}».`] });
    }
    if (!existing.items.length) {
      return res.status(400).json({ error: "SEM_ITENS", errors: ["Acrescente pelo menos um item antes de submeter."] });
    }

    const updated = await prisma.materialRequisition.update({
      where: { id },
      data: {
        status: "SUBMETIDA",
        refusalReason: null,
        history: pushHistory(existing, req, existing.status === "RECUSADA" ? "Reenviada" : "Submetida para aprovação"),
      },
      include: INCLUDE,
    });
    res.json(serialize(updated));
  })
);

// ───────────────────────── aprovar / recusar ─────────────────────────

requisitionRoutes.post(
  "/:id/decision",
  requirePermission(READ_MODULE, "view"),
  asyncHandler(async (req, res) => {
    if (!(await canDecide(req))) {
      return res.status(403).json({
        error: "SEM_PERMISSAO_PARA_APROVAR",
        errors: ["Não tem permissão para aprovar requisições."],
      });
    }

    const id = String(req.params.id);
    const input = z.object({ decision: z.enum(["APROVAR", "RECUSAR"]), reason: optText(500) }).parse(req.body || {});
    const existing = await prisma.materialRequisition.findUnique({ where: { id }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (existing.status !== "SUBMETIDA") {
      return res.status(409).json({
        error: "NAO_ESTA_SUBMETIDA",
        errors: [`Só se decide uma requisição submetida; esta está em «${existing.status}».`],
      });
    }
    if (input.decision === "RECUSAR" && !input.reason) {
      return res.status(400).json({ error: "FALTA_MOTIVO", errors: ["Escreva o motivo da recusa."] });
    }

    const approving = input.decision === "APROVAR";
    const updated = await prisma.materialRequisition.update({
      where: { id },
      data: {
        status: approving ? "APROVADA" : "RECUSADA",
        approvedById: approving ? req.user.sub : null,
        approvedByName: approving ? req.user.name || req.user.email || null : null,
        approvedAt: approving ? new Date() : null,
        refusalReason: approving ? null : input.reason,
        history: pushHistory(existing, req, approving ? "Aprovada" : "Recusada", input.reason),
      },
      include: INCLUDE,
    });
    res.json(serialize(updated));
  })
);

// ───────────────────────── entregar do stock ─────────────────────────

const deliverSchema = z.object({
  sourceWarehouseId: optText(60),
  targetWarehouseId: optText(60),
  /** Se o material é para consumir já (sem passar pelo armazém da obra) */
  consume: z.boolean().optional(),
  lines: z.array(z.object({ itemId: z.string().trim().min(1), quantity: z.coerce.number().positive() })).min(1),
  notes: optText(500),
});

requisitionRoutes.post(
  "/:id/deliver",
  requirePermission(MODULE, "manage"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const input = deliverSchema.parse(req.body || {});
    const existing = await prisma.materialRequisition.findUnique({ where: { id }, include: INCLUDE });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (!["APROVADA", "PARCIAL"].includes(existing.status)) {
      return res.status(409).json({
        error: "NAO_APROVADA",
        errors: [`Só se entrega material de uma requisição aprovada; esta está em «${existing.status}».`],
      });
    }

    const sourceId = input.sourceWarehouseId || existing.sourceWarehouseId;
    if (!sourceId) {
      return res.status(400).json({ error: "SEM_ARMAZEM", errors: ["Escolha o armazém de onde sai o material."] });
    }
    const targetId = input.targetWarehouseId || existing.targetWarehouseId;
    const consume = Boolean(input.consume) || !targetId;

    const byId = new Map(existing.items.map((i) => [i.id, i]));
    const errors = [];
    for (const l of input.lines) {
      const it = byId.get(l.itemId);
      if (!it) {
        errors.push("Linha desconhecida na requisição.");
        continue;
      }
      if (!it.productId) {
        errors.push(`«${it.description}» não está ligado a um produto do catálogo: ligue-o antes de entregar.`);
        continue;
      }
      const remaining = N(it.quantity) - N(it.fulfilledQuantity);
      if (N(l.quantity) > remaining + 1e-6) {
        errors.push(`«${it.description}»: só faltam ${remaining}, não se podem entregar ${l.quantity}.`);
      }
    }
    if (errors.length) return res.status(400).json({ error: "ENTREGA_INVALIDA", errors });

    const warnings = [];
    const result = await prisma.$transaction(async (tx) => {
      for (const l of input.lines) {
        const it = byId.get(l.itemId);
        const qty = N(l.quantity);

        // Saída do armazém de origem: é aqui que nasce o custo
        const out = await applyMovement({
          warehouseId: sourceId,
          productId: it.productId,
          type: consume ? "EXIT" : "TRANSFER_OUT",
          quantity: qty,
          client: tx,
        });
        if (out.warning) warnings.push(`${it.description}: ${out.warning}`);

        await tx.stockMovement.create({
          data: {
            type: consume ? "EXIT" : "TRANSFER_OUT",
            quantity: qty,
            productId: it.productId,
            warehouseId: sourceId,
            projectId: existing.projectId,
            userId: req.user.sub,
            reference: existing.number,
            requisitionId: existing.id,
            unitCost: out.unitCost,
            totalValue: out.totalValue,
            notes: input.notes || `Requisição ${existing.number}`,
          },
        });

        // Entrada no armazém da obra: continua a ser stock, ainda não é custo
        if (!consume && targetId) {
          const into = await applyMovement({
            warehouseId: targetId,
            productId: it.productId,
            type: "TRANSFER_IN",
            quantity: qty,
            unitCost: out.unitCost,
            client: tx,
          });
          await tx.stockMovement.create({
            data: {
              type: "TRANSFER_IN",
              quantity: qty,
              productId: it.productId,
              warehouseId: targetId,
              projectId: existing.projectId,
              userId: req.user.sub,
              reference: existing.number,
              requisitionId: existing.id,
              unitCost: into.unitCost,
              totalValue: into.totalValue,
              notes: input.notes || `Requisição ${existing.number}`,
            },
          });
        }

        await tx.materialRequisitionItem.update({
          where: { id: it.id },
          data: { fulfilledQuantity: round4(N(it.fulfilledQuantity) + qty) },
        });
      }

      const after = await tx.materialRequisitionItem.findMany({ where: { requisitionId: id } });
      const done = after.every((i) => N(i.fulfilledQuantity) >= N(i.quantity) - 1e-6);
      const detail = consume
        ? `Consumo direto de ${input.lines.length} item(ns)`
        : `Entrega de ${input.lines.length} item(ns) no armazém da obra`;

      return tx.materialRequisition.update({
        where: { id },
        data: {
          status: done ? "ATENDIDA" : "PARCIAL",
          sourceWarehouseId: sourceId,
          targetWarehouseId: consume ? null : targetId,
          deliveredAt: done ? new Date() : existing.deliveredAt,
          history: pushHistory(existing, req, done ? "Atendida" : "Entrega parcial", detail),
        },
        include: INCLUDE,
      });
    });

    res.json({ ...serialize(result), warnings });
  })
);

// ───────────────────────── mandar comprar ─────────────────────────

requisitionRoutes.post(
  "/:id/to-purchase",
  requirePermission(MODULE, "manage"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const input = z.object({ reason: optText(500), requiresQuote: z.boolean().optional() }).parse(req.body || {});
    const existing = await prisma.materialRequisition.findUnique({ where: { id }, include: INCLUDE });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (!["APROVADA", "PARCIAL"].includes(existing.status)) {
      return res.status(409).json({
        error: "NAO_APROVADA",
        errors: [`Só se manda comprar uma requisição aprovada; esta está em «${existing.status}».`],
      });
    }
    if (existing.purchaseOrderId) {
      return res.status(409).json({
        error: "JA_TEM_PEDIDO",
        errors: [`Esta requisição já deu origem ao pedido ${existing.purchaseOrder?.number || ""}.`],
      });
    }

    const pending = existing.items
      .map((i) => ({ ...i, remaining: N(i.quantity) - N(i.fulfilledQuantity) }))
      .filter((i) => i.remaining > 1e-6);
    if (!pending.length) {
      return res.status(400).json({ error: "NADA_POR_ENTREGAR", errors: ["Já não falta material nesta requisição."] });
    }

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        INSERT INTO "DocumentCounter" ("kind", "year", "last", "updatedAt")
        VALUES ('PC', ${new Date().getUTCFullYear()}, 1, NOW())
        ON CONFLICT ("kind", "year")
        DO UPDATE SET "last" = "DocumentCounter"."last" + 1, "updatedAt" = NOW()
        RETURNING "last"
      `;
      const poNumber = `PC-${new Date().getUTCFullYear()}-${String(Number(rows[0].last)).padStart(4, "0")}`;

      const po = await tx.purchaseOrder.create({
        data: {
          number: poNumber,
          type: "PEDIDO",
          status: input.requiresQuote === false ? "PENDENTE_APROVACAO" : "PENDENTE_REQUISICAO",
          priority: "NORMAL",
          department: existing.department || existing.project?.name || null,
          requestedById: existing.requestedById,
          requestedByName: existing.requestedByName,
          description: `Material da requisição ${existing.number}`,
          justification: existing.justification,
          needDate: existing.neededBy,
          requiresQuote: input.requiresQuote !== false,
          projectId: existing.projectId,
          costCenterId: existing.costCenterId,
          notes: input.reason || `Sem stock no armazém. Requisição ${existing.number}.`,
          totalValue: pending.reduce((s, i) => s + N(i.estimatedUnitPrice) * i.remaining, 0) || null,
          items: {
            create: pending.map((i, idx) => ({
              name: i.description,
              quantity: i.remaining,
              unit: i.unit,
              unitPrice: i.estimatedUnitPrice ?? null,
              totalPrice: i.estimatedUnitPrice ? N(i.estimatedUnitPrice) * i.remaining : null,
              notes: i.notes,
              order: idx,
            })),
          },
        },
      });

      const updated = await tx.materialRequisition.update({
        where: { id },
        data: {
          destination: "COMPRA",
          status: "EM_COMPRA",
          purchaseOrderId: po.id,
          history: pushHistory(
            existing,
            req,
            "Enviada para compra",
            `${pending.length} item(ns) sem stock · pedido ${poNumber}${input.reason ? ` · ${input.reason}` : ""}`
          ),
        },
        include: INCLUDE,
      });
      return { updated, po };
    });

    res.status(201).json({
      ...serialize(result.updated),
      purchaseOrder: { id: result.po.id, number: result.po.number, status: result.po.status },
    });
  })
);

// ───────────────────────── cancelar ─────────────────────────

requisitionRoutes.post(
  "/:id/cancel",
  requirePermission(READ_MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const input = z.object({ reason: optText(500) }).parse(req.body || {});
    const existing = await prisma.materialRequisition.findUnique({ where: { id }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (["ATENDIDA", "CANCELADA"].includes(existing.status)) {
      return res.status(409).json({ error: "NAO_CANCELAVEL", errors: [`A requisição está em «${existing.status}».`] });
    }
    const delivered = existing.items.some((i) => N(i.fulfilledQuantity) > 0);
    if (delivered) {
      return res.status(409).json({
        error: "JA_TEM_ENTREGAS",
        errors: ["Já houve entregas nesta requisição: não se cancela. O material entregue tem de ser devolvido no armazém da obra."],
      });
    }

    const updated = await prisma.materialRequisition.update({
      where: { id },
      data: { status: "CANCELADA", history: pushHistory(existing, req, "Cancelada", input.reason) },
      include: INCLUDE,
    });
    res.json(serialize(updated));
  })
);

// ───────────────────────── armazém da obra ─────────────────────────

/** Stock, valor e últimos movimentos do armazém de uma obra. */
requisitionRoutes.get(
  "/warehouse/:warehouseId/summary",
  requirePermission(MODULE, "view"),
  asyncHandler(async (req, res) => {
    const warehouseId = String(req.params.warehouseId);
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: { project: { select: { id: true, code: true, name: true } } },
    });
    if (!warehouse) return res.status(404).json({ error: "NOT_FOUND" });

    const [stock, movements, value] = await Promise.all([
      prisma.warehouseStock.findMany({
        where: { warehouseId, quantity: { gt: 0 } },
        include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        orderBy: { product: { name: "asc" } },
      }),
      prisma.stockMovement.findMany({
        where: { warehouseId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { product: { select: { id: true, name: true } } },
      }),
      warehouseValue(warehouseId),
    ]);

    res.json({
      warehouse: { id: warehouse.id, name: warehouse.name, type: warehouse.type, project: warehouse.project || null },
      value,
      stock: stock.map((s) => ({
        productId: s.productId,
        product: s.product,
        quantity: num(s.quantity),
        avgCost: num(s.avgCost),
        value: s.avgCost ? Math.round(N(s.quantity) * N(s.avgCost) * 100) / 100 : null,
      })),
      movements: movements.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: num(m.quantity),
        unitCost: num(m.unitCost),
        totalValue: num(m.totalValue),
        product: m.product,
        reference: m.reference,
        notes: m.notes,
        createdAt: m.createdAt,
      })),
    });
  })
);

/**
 * Movimento no armazém da obra: dar baixa (consumo → custo da obra),
 * devolver ao armazém geral, ou acertar por perda/contagem.
 */
const movementSchema = z.object({
  kind: z.enum(["BAIXA", "DEVOLUCAO", "PERDA", "ACERTO"]),
  productId: z.string().trim().min(1),
  quantity: z.coerce.number(),
  /** Para a devolução: para onde volta */
  targetWarehouseId: optText(60),
  reason: optText(500),
});

requisitionRoutes.post(
  "/warehouse/:warehouseId/movement",
  requirePermission(MODULE, "manage"),
  asyncHandler(async (req, res) => {
    const warehouseId = String(req.params.warehouseId);
    const input = movementSchema.parse(req.body || {});
    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, projectId: true } });
    if (!warehouse) return res.status(404).json({ error: "NOT_FOUND" });

    if (input.kind !== "ACERTO" && !(input.quantity > 0)) {
      return res.status(400).json({ error: "QUANTIDADE_INVALIDA", errors: ["A quantidade tem de ser maior que zero."] });
    }
    if (input.kind === "DEVOLUCAO" && !input.targetWarehouseId) {
      return res.status(400).json({ error: "SEM_DESTINO", errors: ["Escolha o armazém para onde o material volta."] });
    }
    if ((input.kind === "PERDA" || input.kind === "ACERTO") && !input.reason) {
      return res.status(400).json({ error: "FALTA_MOTIVO", errors: ["Perdas e acertos de contagem precisam de motivo."] });
    }

    const TYPE = { BAIXA: "EXIT", DEVOLUCAO: "TRANSFER_OUT", PERDA: "LOSS", ACERTO: "ADJUSTMENT" };
    const LABEL = {
      BAIXA: "Baixa (consumo na obra)",
      DEVOLUCAO: "Devolução ao armazém geral",
      PERDA: "Perda ou roubo",
      ACERTO: "Acerto de contagem",
    };

    const warnings = [];
    const out = await prisma.$transaction(async (tx) => {
      const moved = await applyMovement({
        warehouseId,
        productId: input.productId,
        type: TYPE[input.kind],
        quantity: Math.abs(input.quantity) * (input.kind === "ACERTO" && input.quantity < 0 ? -1 : 1),
        client: tx,
      });
      if (moved.warning) warnings.push(moved.warning);

      const movement = await tx.stockMovement.create({
        data: {
          type: TYPE[input.kind],
          quantity: Math.abs(input.quantity),
          productId: input.productId,
          warehouseId,
          projectId: warehouse.projectId,
          userId: req.user.sub,
          notes: `${LABEL[input.kind]}${input.reason ? ` — ${input.reason}` : ""}`,
          unitCost: moved.unitCost,
          totalValue: moved.totalValue,
        },
      });

      // A devolução entra no armazém de destino ao mesmo custo
      if (input.kind === "DEVOLUCAO") {
        const into = await applyMovement({
          warehouseId: input.targetWarehouseId,
          productId: input.productId,
          type: "TRANSFER_IN",
          quantity: Math.abs(input.quantity),
          unitCost: moved.unitCost,
          client: tx,
        });
        await tx.stockMovement.create({
          data: {
            type: "TRANSFER_IN",
            quantity: Math.abs(input.quantity),
            productId: input.productId,
            warehouseId: input.targetWarehouseId,
            userId: req.user.sub,
            notes: `Devolução do armazém da obra${input.reason ? ` — ${input.reason}` : ""}`,
            unitCost: into.unitCost,
            totalValue: into.totalValue,
          },
        });
      }

      return { movement, moved };
    });

    res.status(201).json({
      ok: true,
      kind: input.kind,
      label: LABEL[input.kind],
      movementId: out.movement.id,
      unitCost: out.moved.unitCost,
      totalValue: out.moved.totalValue,
      quantityAfter: out.moved.quantityAfter,
      avgCostAfter: out.moved.avgCostAfter,
      /** A baixa é o que passa a custo da obra; as outras não. */
      becameProjectCost: input.kind === "BAIXA" || input.kind === "PERDA",
      warnings,
    });
  })
);

module.exports = { requisitionRoutes, COST_CATEGORIES, FLOW, STATUSES, DESTINATIONS, buildChecklist };
