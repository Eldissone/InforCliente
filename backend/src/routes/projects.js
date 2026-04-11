const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const multer = require("multer");
const { parseBudgetSheet } = require("../utils/budgetImport");
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

    return res.json({
      project: {
        ...project,
        budgetTotal: String(project.budgetTotal),
        budgetAllocated: String(project.budgetAllocated),
        budgetConsumed: String(project.budgetConsumed),
        budgetCommitted: String(project.budgetCommitted),
        budgetAvailable: String(project.budgetAvailable),
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
      },
      select: { id: true },
    });

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

    if (isInvestment) {
      // Investment liquidated: capital injection reflected now.
      // budgetTotal grows by the realized amount (new capital added to the project).
      // budgetConsumed also grows by realized (the capital is now deployed/spent).
      // Net effect on budgetAvailable = 0 (total up, consumed up equally).
      txOps.push(
        prisma.project.update({
          where: { id: projectId },
          data: {
            budgetTotal: { increment: realizedAmount },
            budgetConsumed: { increment: realizedAmount },
          },
        })
      );
    } else if (!isInfoOnly) {
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
  requireRole(["admin", "operador"]),
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

projectRoutes.delete(
  "/:id/files/:fileId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id, fileId } = req.params;

    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
    });

    if (!file || file.projectId !== id) {
      const err = new Error("FILE_NOT_FOUND");
      err.status = 404;
      throw err;
    }

    // Remove from DB
    await prisma.projectFile.delete({
      where: { id: fileId },
    });

    // Remove physical file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    res.json({ ok: true });
  })
);

// -----------------------------------------------------------------------------
// FOLDERS
// -----------------------------------------------------------------------------

projectRoutes.get(
  "/:id/folders",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await ensureProjectReadable(req, id);

    const folders = await prisma.projectFolder.findMany({
      where: { projectId: id },
      orderBy: { name: "asc" },
    });

    res.json({ items: folders });
  })
);

projectRoutes.post(
  "/:id/folders",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) throw new Error("FOLDER_NAME_REQUIRED");

    await ensureProjectReadable(req, id);

    const folder = await prisma.projectFolder.create({
      data: {
        projectId: id,
        name,
      },
    });

    res.status(201).json(folder);
  })
);

projectRoutes.delete(
  "/:id/folders/:folderId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id, folderId } = req.params;

    const folder = await prisma.projectFolder.findUnique({
      where: { id: folderId },
      include: { files: true },
    });

    if (!folder || folder.projectId !== id) {
      const err = new Error("FOLDER_NOT_FOUND");
      err.status = 404;
      throw err;
    }

    // Delete all files physically
    for (const f of folder.files) {
      if (fs.existsSync(f.path)) {
        fs.unlinkSync(f.path);
      }
    }

    // Prisma onDelete: Cascade will handle files in DB
    await prisma.projectFolder.delete({
      where: { id: folderId },
    });

    res.json({ ok: true });
  })
);

module.exports = { projectRoutes };
