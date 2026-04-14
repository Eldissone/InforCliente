const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const multer = require("multer");
const { parseBudgetSheet } = require("../utils/budgetImport");
const { getTemplateForProjectType } = require("../utils/projectTemplates");
const path = require("path");
const fs = require("fs");
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const projectRoutes = express.Router();
projectRoutes.use(authRequired);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join("uploads", "projects", req.params.id);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});
const fileUpload = multer({ storage: fileStorage });

function getScopedClientId(req) {
  if (req.user?.role !== "cliente") return null;
  if (!req.user?.clientId) {
    const err = new Error("FORBIDDEN");
    err.status = 403;
    throw err;
  }
  return req.user.clientId;
}

async function ensureClientExists(clientId) {
  if (!clientId) return;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) {
    const err = new Error("CLIENT_NOT_FOUND");
    err.status = 404;
    throw err;
  }
}

async function ensureProjectReadable(req, projectId) {
  const scopedClientId = getScopedClientId(req);
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...(scopedClientId ? { clientId: scopedClientId } : {}),
    },
    include: {
      client: { select: { id: true, name: true, code: true } },
    },
  });

  if (!project) {
    const err = new Error("NOT_FOUND");
    err.status = 404;
    throw err;
  }

  return project;
}

async function generateProjectCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const entropy = Math.random().toString(36).slice(2, 6).toUpperCase();
    const code = `OBR-${timestamp}-${entropy}`;
    const exists = await prisma.project.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!exists) return code;
  }

  const err = new Error("PROJECT_CODE_GENERATION_FAILED");
  err.status = 500;
  throw err;
}

projectRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || "").trim();
    const status = req.query.status ? String(req.query.status) : "";
    const region = req.query.region ? String(req.query.region) : "";
    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
    const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;
    const sort = String(req.query.sort || "updatedAt_desc");
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));

    const whereClauses = [];
    const scopedClientId = getScopedClientId(req);

    if (scopedClientId) {
      whereClauses.push({ clientId: scopedClientId });
    }
    if (search) {
      whereClauses.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
        ],
      });
    }
    if (status) {
      whereClauses.push({ status });
    }
    if (region) {
      whereClauses.push({ region: { contains: region, mode: "insensitive" } });
    }
    if (dateFrom || dateTo) {
      whereClauses.push({
        OR: [
          {
            startDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          },
          {
            dueDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          },
        ],
      });
    }

    const where = whereClauses.length ? { AND: whereClauses } : {};

    const orderBy =
      sort === "progress_desc"
        ? { physicalProgressPct: "desc" }
        : sort === "budget_desc"
          ? { budgetTotal: "desc" }
          : { updatedAt: "desc" };

    const [total, items] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { client: { select: { id: true, name: true } } },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      total,
      items: items.map((p) => ({
        ...p,
        budgetTotal: String(p.budgetTotal),
        budgetAllocated: String(p.budgetAllocated),
        budgetConsumed: String(p.budgetConsumed),
        budgetCommitted: String(p.budgetCommitted),
        budgetAvailable: String(p.budgetAvailable),
      })),
    });
  })
);

projectRoutes.post(
  "/",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        code: z.string().min(3).optional(),
        name: z.string().min(2),
        contact: z.string().optional().nullable(),
        location: z.string().optional().nullable(),
        region: z.string().optional().nullable(),
        status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED"]).optional(),
        startDate: z.string().datetime().optional().nullable(),
        dueDate: z.string().datetime().optional().nullable(),
        budgetTotal: z.union([z.number(), z.string()]),
        budgetAllocated: z.union([z.number(), z.string()]).optional(),
        budgetConsumed: z.union([z.number(), z.string()]).optional(),
        budgetCommitted: z.union([z.number(), z.string()]).optional(),
        budgetAvailable: z.union([z.number(), z.string()]).optional(),
        physicalProgressPct: z.number().int().min(0).max(100).optional(),
        phaseLabel: z.string().optional().nullable(),
        clientId: z.string().optional().nullable(),
        projectType: z.string().optional().nullable(),
        empreiteiro: z.string().optional().nullable(),
        subempreiteiro: z.string().optional().nullable(),
        directorObra: z.string().optional().nullable(),
        referencia: z.string().optional().nullable(),
        maoDeObraIndireta: z.any().optional().nullable(),
        maoDeObraDireta: z.any().optional().nullable(),
        equipamentos: z.any().optional().nullable(),
      })
      .parse(req.body);

    await ensureClientExists(body.clientId || null);
    const budgetTotal = String(body.budgetTotal);
    const budgetAllocated =
      body.budgetAllocated !== undefined ? String(body.budgetAllocated) : budgetTotal;
    const budgetConsumed =
      body.budgetConsumed !== undefined ? String(body.budgetConsumed) : "0";
    const budgetCommitted =
      body.budgetCommitted !== undefined ? String(body.budgetCommitted) : "0";
    const budgetAvailable =
      body.budgetAvailable !== undefined ? String(body.budgetAvailable) : budgetTotal;
    let code = body.code?.trim();
    if (code) {
      const existing = await prisma.project.findUnique({
        where: { code },
        select: { id: true },
      });
      if (existing) {
        return res.status(400).json({ error: "PROJECT_CODE_ALREADY_EXISTS" });
      }
    } else {
      code = await generateProjectCode();
    }

    const created = await prisma.project.create({
      data: {
        code,
        name: body.name,
        contact: body.contact || null,
        location: body.location || null,
        region: body.region || null,
        status: body.status || "ACTIVE",
        startDate: body.startDate ? new Date(body.startDate) : null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        budgetTotal,
        budgetAllocated,
        budgetConsumed,
        budgetCommitted,
        budgetAvailable,
        physicalProgressPct: body.physicalProgressPct ?? 0,
        phaseLabel: body.phaseLabel || null,
        clientId: body.clientId || null,
        projectType: body.projectType || null,
        empreiteiro: body.empreiteiro || null,
        subempreiteiro: body.subempreiteiro || null,
        directorObra: body.directorObra || null,
        referencia: body.referencia || null,
        maoDeObraIndireta: body.maoDeObraIndireta || null,
        maoDeObraDireta: body.maoDeObraDireta || null,
        equipamentos: body.equipamentos || null,
        progressTasks: body.projectType
          ? {
              create: getTemplateForProjectType(body.projectType).map((t) => ({
                itemGroup: body.projectType,
                order: t.order,
                description: t.description,
                expectedQty: t.expectedQty,
                unit: t.unit,
                executedQty: 0
              }))
            }
          : undefined,
      },
      select: { id: true },
    });

    return res.status(201).json({ id: created.id });
  })
);

projectRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const project = await ensureProjectReadable(req, id);

    // Aggregate Budget by Category
    const budgetAgg = await prisma.projectBudgetLine.groupBy({
      by: ["category"],
      where: { projectId: id },
      _sum: { total: true },
    });

    // Aggregate Transactions by Category
    const transAgg = await prisma.projectTransaction.groupBy({
      by: ["category"],
      where: { projectId: id },
      _sum: { amount: true, realizedAmount: true },
    });

    // Build CBS Summary Map
    const cbsSummary = {};
    
    // Initialize with all categories from the enum to ensure they exist
    const categories = [
      "MATERIAIS_INSUMOS", "SERVICOS_MAO_DE_OBRA", "GASTOS_PESSOAL", 
      "DESPESAS_OPERACIONAIS", "INVESTIMENTOS", "DEPRECIACAO", 
      "OUTRAS_DESPESAS", "DEDUCOES", "IMPOSTOS"
    ];
    
    categories.forEach(cat => {
      cbsSummary[cat] = { budgeted: 0, realized: 0 };
    });

    budgetAgg.forEach(b => {
      if (b.category && cbsSummary[b.category]) {
        cbsSummary[b.category].budgeted = Number(b._sum.total || 0);
      }
    });

    transAgg.forEach(t => {
      if (t.category && cbsSummary[t.category]) {
        // Use realizedAmount if available, otherwise amount
        cbsSummary[t.category].realized = Number(t._sum.realizedAmount || t._sum.amount || 0);
      }
    });

    // Aggregate Payments (confirmed)
    const paymentAgg = await prisma.projectPayment.aggregate({
      where: { projectId: id, status: "CONFIRMADO" },
      _sum: { valor: true },
      _count: { id: true },
    });
    const totalPago = Number(paymentAgg._sum.valor || 0);
    const budgetTotalNum = Number(project.budgetTotal || 0);
    const divida = budgetTotalNum - totalPago;
    const percentualPago = budgetTotalNum > 0
      ? Math.round((totalPago / budgetTotalNum) * 100)
      : 0;

    return res.json({
      project: {
        ...project,
        budgetTotal: String(project.budgetTotal),
        budgetAllocated: String(project.budgetAllocated),
        budgetConsumed: String(project.budgetConsumed),
        budgetCommitted: String(project.budgetCommitted),
        budgetAvailable: String(project.budgetAvailable),
        cbsSummary,
        totalPago,
        divida,
        percentualPago,
      },
    });
  })
);

projectRoutes.patch(
  "/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        name: z.string().min(2).optional(),
        contact: z.string().optional().nullable(),
        location: z.string().optional().nullable(),
        region: z.string().optional().nullable(),
        status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED"]).optional(),
        startDate: z.string().datetime().optional().nullable(),
        dueDate: z.string().datetime().optional().nullable(),
        budgetTotal: z.union([z.number(), z.string()]).optional(),
        budgetAllocated: z.union([z.number(), z.string()]).optional(),
        budgetConsumed: z.union([z.number(), z.string()]).optional(),
        budgetCommitted: z.union([z.number(), z.string()]).optional(),
        budgetAvailable: z.union([z.number(), z.string()]).optional(),
        physicalProgressPct: z.number().int().min(0).max(100).optional(),
        phaseLabel: z.string().optional().nullable(),
        clientId: z.string().optional().nullable(),
        projectType: z.string().optional().nullable(),
        empreiteiro: z.string().optional().nullable(),
        subempreiteiro: z.string().optional().nullable(),
        directorObra: z.string().optional().nullable(),
        referencia: z.string().optional().nullable(),
        maoDeObraIndireta: z.any().optional().nullable(),
        maoDeObraDireta: z.any().optional().nullable(),
        equipamentos: z.any().optional().nullable(),
      })
      .parse(req.body);

    await ensureClientExists(body.clientId || null);

    let extraFields = {};
    if (body.budgetTotal !== undefined) {
      // Auto-recalculate budgetAvailable whenever budgetTotal changes
      const current = await prisma.project.findUnique({
        where: { id },
        select: { budgetConsumed: true, budgetCommitted: true },
      });
      const consumed = Number(current?.budgetConsumed || 0);
      const committed = Number(current?.budgetCommitted || 0);
      const newTotal = Number(body.budgetTotal);
      extraFields = { budgetAvailable: String(newTotal - consumed - committed) };
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.contact !== undefined ? { contact: body.contact } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.region !== undefined ? { region: body.region } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.startDate !== undefined
          ? { startDate: body.startDate ? new Date(body.startDate) : null }
          : {}),
        ...(body.dueDate !== undefined
          ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
          : {}),
        ...(body.budgetTotal !== undefined ? { budgetTotal: String(body.budgetTotal) } : {}),
        ...(body.budgetAllocated !== undefined
          ? { budgetAllocated: String(body.budgetAllocated) }
          : {}),
        ...(body.budgetConsumed !== undefined ? { budgetConsumed: String(body.budgetConsumed) } : {}),
        ...(body.budgetCommitted !== undefined
          ? { budgetCommitted: String(body.budgetCommitted) }
          : {}),
        // If caller explicitly passed budgetAvailable, use that; otherwise auto-calc from budgetTotal change
        ...(body.budgetAvailable !== undefined
          ? { budgetAvailable: String(body.budgetAvailable) }
          : extraFields),
        ...(body.physicalProgressPct !== undefined
          ? { physicalProgressPct: body.physicalProgressPct }
          : {}),
        ...(body.phaseLabel !== undefined ? { phaseLabel: body.phaseLabel } : {}),
        ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
        ...(body.projectType !== undefined ? { projectType: body.projectType } : {}),
        ...(body.empreiteiro !== undefined ? { empreiteiro: body.empreiteiro } : {}),
        ...(body.subempreiteiro !== undefined ? { subempreiteiro: body.subempreiteiro } : {}),
        ...(body.directorObra !== undefined ? { directorObra: body.directorObra } : {}),
        ...(body.referencia !== undefined ? { referencia: body.referencia } : {}),
        ...(body.maoDeObraIndireta !== undefined ? { maoDeObraIndireta: body.maoDeObraIndireta } : {}),
        ...(body.maoDeObraDireta !== undefined ? { maoDeObraDireta: body.maoDeObraDireta } : {}),
        ...(body.equipamentos !== undefined ? { equipamentos: body.equipamentos } : {}),
      },
      select: { id: true },
    });

    if (body.projectType) {
      const existingTasks = await prisma.projectProgressTask.count({ where: { projectId: id } });
      if (existingTasks === 0) {
        const templates = getTemplateForProjectType(body.projectType);
        if (templates.length > 0) {
          await prisma.projectProgressTask.createMany({
            data: templates.map(t => ({
              projectId: id,
              itemGroup: body.projectType,
              order: t.order,
              description: t.description,
              expectedQty: t.expectedQty,
              executedQty: 0,
              unit: t.unit
            }))
          });
        }
      }
    }

    return res.json({ id: updated.id });
  })
);

projectRoutes.delete(
  "/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.project.delete({ where: { id } });
    return res.json({ ok: true });
  })
);

projectRoutes.get(
  "/:id/transactions",
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    await ensureProjectReadable(req, projectId);
    const search = String(req.query.search || "").trim();
    const status = req.query.status ? String(req.query.status) : "";
    const category = req.query.category ? String(req.query.category) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));

    const where = {
      projectId,
      ...(search ? { description: { contains: search, mode: "insensitive" } } : {}),
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.projectTransaction.count({ where }),
      prisma.projectTransaction.findMany({
        where,
        orderBy: { date: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return res.json({
      page,
      pageSize,
      total,
      items: items.map((t) => ({ ...t, amount: String(t.amount), realizedAmount: t.realizedAmount != null ? String(t.realizedAmount) : null })),
    });
  })
);

projectRoutes.post(
  "/:id/transactions",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const body = z
      .object({
        date: z.string().datetime().optional(),
        description: z.string().min(2),
        category: z.enum([
          "MATERIALS", "EQUIPMENT", "LABOR", "OTHER",
          "MATERIAIS_INSUMOS", "SERVICOS_MAO_DE_OBRA", "GASTOS_PESSOAL",
          "DESPESAS_OPERACIONAIS", "INVESTIMENTOS", "DEPRECIACAO",
          "OUTRAS_DESPESAS", "DEDUCOES", "IMPOSTOS"
        ]).optional(),
        ownerName: z.string().optional().nullable(),
        status: z.enum(["PAID", "PENDING", "LATE"]).optional(),
        amount: z.union([z.number(), z.string()]),
        budgetLineId: z.string().optional().nullable(),
      })
      .parse(req.body);

    const amount = Number(body.amount);
    const isPaid = body.status === "PAID";
    const isInvestment = body.category === "INVESTIMENTOS";
    // DEPRECIACAO is purely informational and never affects the budget
    const isInfoOnly = body.category === "DEPRECIACAO";

    const created = await prisma.$transaction(async (tx) => {
      // 1. Criar a transação
      const t = await tx.projectTransaction.create({
        data: {
          projectId,
          date: body.date ? new Date(body.date) : new Date(),
          description: body.description,
          category: body.category || "OTHER",
          ownerName: body.ownerName || null,
          status: body.status || "PENDING",
          amount: String(amount),
          budgetLineId: body.budgetLineId || null,
        },
        select: { id: true },
      });

      if (isInvestment || isInfoOnly) {
        // Investment and depreciation: no budget impact on creation (only on liquidation)
      } else {
        // Regular operational cost: affects consumed/committed/available
        await tx.project.update({
          where: { id: projectId },
          data: {
            budgetConsumed: { increment: isPaid ? amount : 0 },
            budgetCommitted: { increment: !isPaid ? amount : 0 },
            budgetAvailable: { decrement: amount },
          },
        });
      }

      return t;
    });

    return res.status(201).json({ id: created.id });
  })
);

projectRoutes.patch(
  "/:id/transactions/:txId/liquidate",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const txId = String(req.params.txId);

    const body = z.object({
      realizedAmount: z.union([z.number(), z.string()]).optional(),
    }).parse(req.body || {});

    const txRecord = await prisma.projectTransaction.findUnique({
      where: { id: txId, projectId },
    });

    if (!txRecord) return res.status(404).json({ error: "TRANSACTION_NOT_FOUND" });
    if (txRecord.status === "PAID") return res.status(400).json({ error: "ALREADY_PAID" });

    const isInvestment = txRecord.category === "INVESTIMENTOS";
    const isInfoOnly = txRecord.category === "DEPRECIACAO";

    const committedAmount = Number(txRecord.amount);
    const realizedAmount = body.realizedAmount != null ? Number(body.realizedAmount) : committedAmount;
    const diff = committedAmount - realizedAmount;

    const txOps = [
      prisma.projectTransaction.update({
        where: { id: txId },
        data: {
          status: "PAID",
          realizedAmount: String(realizedAmount),
        },
      }),
    ];

    if (!isInvestment && !isInfoOnly) {
      // Regular cost: normal liquidation flow
      txOps.push(
        prisma.project.update({
          where: { id: projectId },
          data: {
            budgetCommitted: { decrement: committedAmount },
            budgetConsumed: { increment: realizedAmount },
            budgetAvailable: { increment: diff },
          },
        })
      );
    }
    // INVESTIMENTOS and DEPRECIACAO: only update status, no budget impact
    // DEPRECIACAO: only update status, no budget impact

    await prisma.$transaction(txOps);

    return res.json({ ok: true });
  })
);

projectRoutes.get(
  "/:id/budget/lines",
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    await ensureProjectReadable(req, projectId);
    const items = await prisma.projectBudgetLine.findMany({
      where: { projectId },
      include: {
        transactions: {
          select: { amount: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return res.json({
      items: items.map((l) => {
        const consumed = l.transactions.reduce((acc, t) => acc + Number(t.amount), 0);
        return {
          ...l,
          quantity: l.quantity === null ? null : String(l.quantity),
          unitPrice: l.unitPrice === null ? null : String(l.unitPrice),
          total: String(l.total),
          consumed: String(consumed),
        };
      }),
    });
  })
);

projectRoutes.post(
  "/:id/budget/upload",
  requireRole(["admin", "operador"]),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    await ensureProjectReadable(req, projectId);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "MISSING_FILE" });

    const name = String(file.originalname || "budget.xlsx");
    const lower = name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) {
      return res.status(400).json({ error: "UNSUPPORTED_FILE_TYPE" });
    }

    const { lines, warnings } = parseBudgetSheet(file.buffer, name);
    if (!lines.length) {
      return res.status(400).json({ error: "NO_LINES_IMPORTED", warnings });
    }

    // Estratégia MVP: substituir orçamento anterior (apaga linhas antigas e insere novas)
    await prisma.$transaction(async (tx) => {
      await tx.projectBudgetLine.deleteMany({ where: { projectId } });
      await tx.projectBudgetLine.createMany({
        data: lines.map((l) => ({
          projectId,
          rowNumber: l.rowNumber,
          sourceFile: l.sourceFile,
          category: l.category,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity === null ? null : String(l.quantity),
          unitPrice: l.unitPrice === null ? null : String(l.unitPrice),
          total: String(l.total),
        })),
      });

      const sum = lines.reduce((acc, l) => acc + (Number(l.total) || 0), 0);
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { budgetConsumed: true } });
      const consumed = Number(project?.budgetConsumed || 0);

      await tx.project.update({
        where: { id: projectId },
        data: {
          budgetAllocated: String(sum),
          budgetTotal: String(sum),
          budgetAvailable: String(sum - consumed),
        },
      });
    });

    const total = lines.reduce((acc, l) => acc + (Number(l.total) || 0), 0);
    return res.json({
      imported: lines.length,
      total: String(total.toFixed(2)),
      warnings,
    });
  })
);

// -----------------------------------------------------------------------------
// FILE MANAGEMENT
// -----------------------------------------------------------------------------

projectRoutes.get(
  "/:id/files",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { folderId } = req.query;
    await ensureProjectReadable(req, id);

    const files = await prisma.projectFile.findMany({
      where: {
        projectId: id,
        folderId: folderId === "root" ? null : (folderId || undefined),
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ items: files });
  })
);

projectRoutes.post(
  "/:id/files",
  requireRole(["admin", "operador", "cliente"]),
  fileUpload.single("file"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!req.file) throw new Error("FILE_REQUIRED");
    await ensureProjectReadable(req, id);

    const fileRecord = await prisma.projectFile.create({
      data: {
        projectId: id,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path.replace(/\\/g, "/"),
        category: req.body.category || "OUTROS",
        folderId: req.body.folderId || null,
      },
    });

    res.status(201).json(fileRecord);
  })
);

// PATCH — renomear ficheiro ou mover para outra pasta
projectRoutes.patch(
  "/:id/files/:fileId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id, fileId } = req.params;
    const body = z.object({
      originalName: z.string().min(1).optional(),
      folderId: z.string().nullable().optional(),
      category: z.string().optional(),
    }).parse(req.body);

    const file = await prisma.projectFile.findUnique({ where: { id: fileId } });
    if (!file || file.projectId !== id) {
      return res.status(404).json({ error: "FILE_NOT_FOUND" });
    }

    const updated = await prisma.projectFile.update({
      where: { id: fileId },
      data: {
        ...(body.originalName !== undefined ? { originalName: body.originalName } : {}),
        ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
      },
    });

    res.json(updated);
  })
);

projectRoutes.delete(
  "/:id/files/:fileId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id, fileId } = req.params;

    const file = await prisma.projectFile.findUnique({ where: { id: fileId } });
    if (!file || file.projectId !== id) {
      return res.status(404).json({ error: "FILE_NOT_FOUND" });
    }

    await prisma.projectFile.delete({ where: { id: fileId } });
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

    res.json({ ok: true });
  })
);

// -----------------------------------------------------------------------------
// FOLDERS
// -----------------------------------------------------------------------------

// Helper: apagar pasta e todos os seus descendentes recursivamente
async function deleteFolderRecursive(folderId, projectId) {
  const folder = await prisma.projectFolder.findUnique({
    where: { id: folderId },
    include: {
      files: true,
      children: true,
    },
  });
  if (!folder || folder.projectId !== projectId) return;

  // Recursivamente apagar subpastas
  for (const child of folder.children) {
    await deleteFolderRecursive(child.id, projectId);
  }

  // Apagar ficheiros físicos desta pasta
  for (const f of folder.files) {
    if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
  }

  // Apagar pasta (files apagados em cascata pelo DB)
  await prisma.projectFolder.delete({ where: { id: folderId } });
}

// GET — listar pastas de um nível (raiz ou dentro de outra pasta)
projectRoutes.get(
  "/:id/folders",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { parentId } = req.query;
    await ensureProjectReadable(req, id);

    const folders = await prisma.projectFolder.findMany({
      where: {
        projectId: id,
        parentId: parentId === "root" || !parentId ? null : parentId,
      },
      orderBy: { name: "asc" },
    });

    res.json({ items: folders });
  })
);

// POST — criar pasta (com parentId opcional para subpastas)
projectRoutes.post(
  "/:id/folders",
  requireRole(["admin", "operador", "cliente"]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = z.object({
      name: z.string().min(1),
      parentId: z.string().nullable().optional(),
    }).parse(req.body);

    await ensureProjectReadable(req, id);

    // Validar que o parentId existe e pertence ao projeto
    if (body.parentId) {
      const parent = await prisma.projectFolder.findUnique({ where: { id: body.parentId } });
      if (!parent || parent.projectId !== id) {
        return res.status(400).json({ error: "INVALID_PARENT_FOLDER" });
      }
    }

    const folder = await prisma.projectFolder.create({
      data: {
        projectId: id,
        name: body.name,
        parentId: body.parentId || null,
      },
    });

    res.status(201).json(folder);
  })
);

// PATCH — renomear pasta
projectRoutes.patch(
  "/:id/folders/:folderId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id, folderId } = req.params;
    const body = z.object({
      name: z.string().min(1),
    }).parse(req.body);

    const folder = await prisma.projectFolder.findUnique({ where: { id: folderId } });
    if (!folder || folder.projectId !== id) {
      return res.status(404).json({ error: "FOLDER_NOT_FOUND" });
    }

    const updated = await prisma.projectFolder.update({
      where: { id: folderId },
      data: { name: body.name },
    });

    res.json(updated);
  })
);

// DELETE — apagar pasta e subpastas/ficheiros em cascata
projectRoutes.delete(
  "/:id/folders/:folderId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id, folderId } = req.params;

    const folder = await prisma.projectFolder.findUnique({ where: { id: folderId } });
    if (!folder || folder.projectId !== id) {
      return res.status(404).json({ error: "FOLDER_NOT_FOUND" });
    }

    await deleteFolderRecursive(folderId, id);

    res.json({ ok: true });
  })
);

// -----------------------------------------------------------------------------
// PAGAMENTOS DO CLIENTE
// -----------------------------------------------------------------------------

// GET — lista de pagamentos + resumo financeiro
projectRoutes.get(
  "/:id/payments",
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    await ensureProjectReadable(req, projectId);

    const status = req.query.status ? String(req.query.status) : "";

    const where = {
      projectId,
      ...(status ? { status } : {}),
    };

    const [items, agg] = await Promise.all([
      prisma.projectPayment.findMany({
        where,
        orderBy: { dataPagamento: "desc" },
      }),
      prisma.projectPayment.aggregate({
        where: { projectId, status: "CONFIRMADO" },
        _sum: { valor: true },
        _count: { id: true },
      }),
    ]);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { budgetTotal: true },
    });

    const totalPago = Number(agg._sum.valor || 0);
    const budgetTotal = Number(project?.budgetTotal || 0);
    const divida = budgetTotal - totalPago;
    const percentualPago = budgetTotal > 0
      ? Math.round((totalPago / budgetTotal) * 100)
      : 0;

    return res.json({
      items: items.map((p) => ({ ...p, valor: String(p.valor) })),
      totalPago,
      divida,
      percentualPago,
      totalConfirmados: agg._count?.id || 0,
    });
  })
);

// POST — registar novo pagamento
projectRoutes.post(
  "/:id/payments",
  requireRole(["admin", "operador"]),
  fileUpload.single("comprovativo"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    await ensureProjectReadable(req, projectId);

    const body = z.object({
      valor: z.union([z.number(), z.string()]),
      dataPagamento: z.string().datetime(),
      metodo: z.string().optional().nullable(),
      referencia: z.string().optional().nullable(),
      status: z.enum(["CONFIRMADO", "PENDENTE"]).optional(),
    }).parse(req.body);

    const valor = Number(body.valor);
    if (valor <= 0) {
      return res.status(400).json({ error: "VALOR_INVALIDO" });
    }

    const payment = await prisma.projectPayment.create({
      data: {
        projectId,
        valor: String(valor),
        dataPagamento: new Date(body.dataPagamento),
        metodo: body.metodo || null,
        referencia: body.referencia || null,
        comprovativoPath: req.file ? req.file.path.replace(/\\/g, "/") : null,
        criadoPor: req.user?.email || null,
        status: body.status || "PENDENTE",
      },
    });

    return res.status(201).json({ ...payment, valor: String(payment.valor) });
  })
);

// PATCH — actualizar pagamento (confirmar exige admin)
projectRoutes.patch(
  "/:id/payments/:pid",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const pid = String(req.params.pid);

    const body = z.object({
      valor: z.union([z.number(), z.string()]).optional(),
      dataPagamento: z.string().datetime().optional(),
      metodo: z.string().optional().nullable(),
      referencia: z.string().optional().nullable(),
      status: z.enum(["CONFIRMADO", "PENDENTE"]).optional(),
    }).parse(req.body);

    // Apenas admin pode confirmar pagamento
    if (body.status === "CONFIRMADO" && req.user?.role !== "admin") {
      return res.status(403).json({ error: "APENAS_ADMIN_PODE_CONFIRMAR" });
    }

    if (body.valor !== undefined && Number(body.valor) <= 0) {
      return res.status(400).json({ error: "VALOR_INVALIDO" });
    }

    const existing = await prisma.projectPayment.findUnique({ where: { id: pid } });
    if (!existing || existing.projectId !== projectId) {
      return res.status(404).json({ error: "PAYMENT_NOT_FOUND" });
    }

    const updated = await prisma.projectPayment.update({
      where: { id: pid },
      data: {
        ...(body.valor !== undefined ? { valor: String(Number(body.valor)) } : {}),
        ...(body.dataPagamento !== undefined ? { dataPagamento: new Date(body.dataPagamento) } : {}),
        ...(body.metodo !== undefined ? { metodo: body.metodo } : {}),
        ...(body.referencia !== undefined ? { referencia: body.referencia } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });

    return res.json({ ...updated, valor: String(updated.valor) });
  })
);

// DELETE — apagar pagamento (apenas admin)
projectRoutes.delete(
  "/:id/payments/:pid",
  requireRole(["admin"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const pid = String(req.params.pid);

    const existing = await prisma.projectPayment.findUnique({ where: { id: pid } });
    if (!existing || existing.projectId !== projectId) {
      return res.status(404).json({ error: "PAYMENT_NOT_FOUND" });
    }

    await prisma.projectPayment.delete({ where: { id: pid } });
    return res.json({ ok: true });
  })
);
projectRoutes.get(
  "/:id/photos",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await ensureProjectReadable(req, id);
    const photos = await prisma.projectPhoto.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "desc" },
      include: {
        movement: {
          include: { material: true }
        }
      }
    });
    return res.json({ items: photos });
  })
);

module.exports = { projectRoutes };

// -----------------------------------------------------------------------------
// PROGRESS TASKS HELPERS
// -----------------------------------------------------------------------------

async function recalculateTaskRollup(parentId, projectId) {
  if (!parentId) return;

  // Buscar todos os filhos
  const children = await prisma.projectProgressTask.findMany({
    where: { parentId, projectId },
  });

  let sumTotal = 0;
  let sumMaterial = 0;
  let sumService = 0;

  children.forEach(c => {
    // Se o filho já tem um totalValue (pode ser um pai também ou item terminal com valor)
    sumTotal += Number(c.totalValue || 0);
    sumMaterial += Number(c.unitValueMaterial || 0) * Number(c.expectedQty || 0);
    sumService += Number(c.unitValueService || 0) * Number(c.expectedQty || 0);
  });

  // Atualizar o pai
  const parent = await prisma.projectProgressTask.update({
    where: { id: parentId },
    data: {
      totalValue: sumTotal,
      // Opcional: atualizar unitValue do pai se unit for 'un' ou global
      // Mas por agora focamos no totalValue que é o que compõe o orçamento
    }
  });

  // Subir na hierarquia se o pai também tiver um pai
  if (parent.parentId) {
    await recalculateTaskRollup(parent.parentId, projectId);
  }
}

// Progress Tasks Routes
projectRoutes.get(
  "/:id/progress-tasks",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await ensureProjectReadable(req, id);
    const tasks = await prisma.projectProgressTask.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
    });
    return res.json({ tasks });
  })
);

projectRoutes.post(
  "/:id/progress-tasks",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await ensureProjectReadable(req, id);
    const body = z
      .object({
        itemGroup: z.string().optional().nullable(),
        description: z.string().min(1),
        expectedQty: z.union([z.number(), z.string()]),
        executedQty: z.union([z.number(), z.string()]).optional(),
        unit: z.string(),
        unitValue: z.union([z.number(), z.string()]).optional().nullable(),
        unitValueMaterial: z.union([z.number(), z.string()]).optional().nullable(),
        unitValueService: z.union([z.number(), z.string()]).optional().nullable(),
        totalValue: z.union([z.number(), z.string()]).optional().nullable(),
        currency: z.string().optional().nullable(),
        parentId: z.string().optional().nullable()
      })
      .parse(req.body);

    const task = await prisma.projectProgressTask.create({
      data: {
        projectId: id,
        itemGroup: body.itemGroup || null,
        description: body.description,
        expectedQty: body.expectedQty,
        executedQty: body.executedQty || 0,
        unit: (body.unit || "un").toLowerCase().trim(),
        unitValue: body.unitValue !== null && body.unitValue !== undefined ? Number(body.unitValue) : null,
        unitValueMaterial: body.unitValueMaterial !== null && body.unitValueMaterial !== undefined ? Number(body.unitValueMaterial) : null,
        unitValueService: body.unitValueService !== null && body.unitValueService !== undefined ? Number(body.unitValueService) : null,
        totalValue: body.totalValue !== null && body.totalValue !== undefined ? Number(body.totalValue) : null,
        currency: body.currency || "AOA",
        parentId: body.parentId || null
      },
    });

    if (task.parentId) {
      await recalculateTaskRollup(task.parentId, id);
      // Recarregar para devolver o estado atualizado do pai (se necessário) ou apenas a task
    }

    return res.status(201).json({ task });
  })
);

projectRoutes.patch(
  "/:id/progress-tasks/:taskId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id, taskId } = req.params;
    await ensureProjectReadable(req, id);
    const body = z
      .object({
        executedQty: z.union([z.number(), z.string()]).optional(),
        expectedQty: z.union([z.number(), z.string()]).optional(),
        unit: z.string().optional(),
        unitValue: z.union([z.number(), z.string()]).optional().nullable(),
        unitValueMaterial: z.union([z.number(), z.string()]).optional().nullable(),
        unitValueService: z.union([z.number(), z.string()]).optional().nullable(),
        totalValue: z.union([z.number(), z.string()]).optional().nullable(),
        currency: z.string().optional().nullable()
      })
      .parse(req.body);

    const data = {};
    if (body.executedQty !== undefined) data.executedQty = body.executedQty;
    if (body.expectedQty !== undefined) data.expectedQty = body.expectedQty;
    if (body.unit !== undefined) data.unit = body.unit.toLowerCase().trim();
    if (body.unitValue !== undefined) data.unitValue = body.unitValue !== null ? Number(body.unitValue) : null;
    if (body.unitValueMaterial !== undefined) data.unitValueMaterial = body.unitValueMaterial !== null ? Number(body.unitValueMaterial) : null;
    if (body.unitValueService !== undefined) data.unitValueService = body.unitValueService !== null ? Number(body.unitValueService) : null;
    if (body.totalValue !== undefined) data.totalValue = body.totalValue !== null ? Number(body.totalValue) : null;
    if (body.currency !== undefined) data.currency = body.currency || "AOA";

    const task = await prisma.projectProgressTask.update({
      where: { id: taskId, projectId: id },
      data,
    });

    if (task.parentId) {
      await recalculateTaskRollup(task.parentId, id);
    }

    return res.json({ task });
  })
);

projectRoutes.post(
  "/:id/progress-tasks/import-template",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await ensureProjectReadable(req, id);
    const { templateType } = z.object({ templateType: z.string() }).parse(req.body);

    const { projectTemplates, getTemplateForProjectType } = require("../utils/projectTemplates");
    const template = getTemplateForProjectType(templateType);

    if (!template || template.length === 0) {
      return res.status(400).json({ error: "Modelo não encontrado ou vazio" });
    }

    // Get current max order to append
    const lastTask = await prisma.projectProgressTask.findFirst({
      where: { projectId: id },
      orderBy: { order: "desc" },
    });
    let currentOrder = (lastTask?.order || 0) + 1;

    async function createRecursive(items, pId = null, group = null) {
      let count = 0;
      for (const t of items) {
        const created = await prisma.projectProgressTask.create({
          data: {
            projectId: id,
            itemGroup: group || templateType.toUpperCase(),
            description: t.description,
            expectedQty: t.expectedQty || 0,
            executedQty: 0,
            unit: t.unit || "un",
            order: currentOrder++,
            parentId: pId
          }
        });
        count++;
        if (t.subItems && t.subItems.length > 0) {
           count += await createRecursive(t.subItems, created.id, group || templateType.toUpperCase());
        }
      }
      return count;
    }

    const totalCreated = await createRecursive(template);

    return res.json({ success: true, count: totalCreated });
  })
);

projectRoutes.delete(
  "/:id/progress-tasks/:taskId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id, taskId } = req.params;
    await ensureProjectReadable(req, id);
    const existing = await prisma.projectProgressTask.findUnique({
      where: { id: taskId, projectId: id }
    });

    await prisma.projectProgressTask.delete({
      where: { id: taskId, projectId: id },
    });

    if (existing && existing.parentId) {
      await recalculateTaskRollup(existing.parentId, id);
    }

    return res.json({ success: true });
  })
);
