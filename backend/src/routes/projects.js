const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const multer = require("multer");
const { parseBudgetSheet } = require("../utils/budgetImport");

const projectRoutes = express.Router();
projectRoutes.use(authRequired);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

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

    const where = {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
      ...(region ? { region: { contains: region, mode: "insensitive" } } : {}),
      ...(dateFrom || dateTo
        ? {
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
          }
        : {}),
    };

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
        code: z.string().min(3),
        name: z.string().min(2),
        location: z.string().optional().nullable(),
        region: z.string().optional().nullable(),
        status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED"]).optional(),
        startDate: z.string().datetime().optional().nullable(),
        dueDate: z.string().datetime().optional().nullable(),
        budgetTotal: z.union([z.number(), z.string()]),
        budgetAllocated: z.union([z.number(), z.string()]),
        budgetConsumed: z.union([z.number(), z.string()]),
        budgetCommitted: z.union([z.number(), z.string()]),
        budgetAvailable: z.union([z.number(), z.string()]),
        physicalProgressPct: z.number().int().min(0).max(100).optional(),
        phaseLabel: z.string().optional().nullable(),
        clientId: z.string().optional().nullable(),
      })
      .parse(req.body);

    const created = await prisma.project.create({
      data: {
        code: body.code,
        name: body.name,
        location: body.location || null,
        region: body.region || null,
        status: body.status || "ACTIVE",
        startDate: body.startDate ? new Date(body.startDate) : null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        budgetTotal: String(body.budgetTotal),
        budgetAllocated: String(body.budgetAllocated),
        budgetConsumed: String(body.budgetConsumed),
        budgetCommitted: String(body.budgetCommitted),
        budgetAvailable: String(body.budgetAvailable),
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
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, code: true } },
      },
    });
    if (!project) return res.status(404).json({ error: "NOT_FOUND" });

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

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
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
        ...(body.budgetAvailable !== undefined
          ? { budgetAvailable: String(body.budgetAvailable) }
          : {}),
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
      items: items.map((t) => ({ ...t, amount: String(t.amount) })),
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
        category: z.enum(["MATERIALS", "EQUIPMENT", "LABOR", "OTHER"]).optional(),
        ownerName: z.string().optional().nullable(),
        status: z.enum(["PAID", "PENDING", "LATE"]).optional(),
        amount: z.union([z.number(), z.string()]),
      })
      .parse(req.body);

    const created = await prisma.projectTransaction.create({
      data: {
        projectId,
        date: body.date ? new Date(body.date) : new Date(),
        description: body.description,
        category: body.category || "OTHER",
        ownerName: body.ownerName || null,
        status: body.status || "PENDING",
        amount: String(body.amount),
      },
      select: { id: true },
    });

    return res.status(201).json({ id: created.id });
  })
);

projectRoutes.get(
  "/:id/budget/lines",
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const items = await prisma.projectBudgetLine.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return res.json({
      items: items.map((l) => ({
        ...l,
        quantity: l.quantity === null ? null : String(l.quantity),
        unitPrice: l.unitPrice === null ? null : String(l.unitPrice),
        total: String(l.total),
      })),
    });
  })
);

projectRoutes.post(
  "/:id/budget/upload",
  requireRole(["admin", "operador"]),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
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
      await tx.project.update({
        where: { id: projectId },
        data: {
          budgetAllocated: String(sum),
          budgetTotal: String(sum),
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

module.exports = { projectRoutes };

