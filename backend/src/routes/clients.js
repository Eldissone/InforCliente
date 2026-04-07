const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const clientRoutes = express.Router();
clientRoutes.use(authRequired);

clientRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || "").trim();
    const status = req.query.status ? String(req.query.status) : "";
    const industry = req.query.industry ? String(req.query.industry) : "";
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
      ...(industry ? { industry: { equals: industry, mode: "insensitive" } } : {}),
    };

    const orderBy =
      sort === "ltv_desc"
        ? { ltvTotal: "desc" }
        : sort === "health_desc"
          ? { healthScore: "desc" }
          : { updatedAt: "desc" };

    const [total, items] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          code: true,
          name: true,
          industry: true,
          region: true,
          tier: true,
          status: true,
          healthScore: true,
          ltvTotal: true,
          churnRisk: true,
          ltvPotential: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      total,
      items: items.map((c) => ({
        ...c,
        ltvTotal: String(c.ltvTotal),
        churnRisk: String(c.churnRisk),
        ltvPotential: String(c.ltvPotential),
      })),
    });
  })
);

clientRoutes.post(
  "/",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        code: z.string().min(2),
        name: z.string().min(2),
        industry: z.string().optional().nullable(),
        region: z.string().optional().nullable(),
        tier: z.string().optional().nullable(),
        status: z.enum(["ACTIVE", "AT_RISK", "INACTIVE"]).optional(),
        healthScore: z.number().int().min(0).max(100).optional(),
        ltvTotal: z.union([z.number(), z.string()]),
        churnRisk: z.union([z.number(), z.string()]),
        ltvPotential: z.union([z.number(), z.string()]),
        tags: z.array(z.string().min(1)).optional(),
      })
      .parse(req.body);

    const created = await prisma.client.create({
      data: {
        code: body.code,
        name: body.name,
        industry: body.industry || null,
        region: body.region || null,
        tier: body.tier || null,
        status: body.status || "ACTIVE",
        healthScore: body.healthScore ?? 50,
        ltvTotal: String(body.ltvTotal),
        churnRisk: String(body.churnRisk),
        ltvPotential: String(body.ltvPotential),
        tags: body.tags?.length
          ? { create: body.tags.map((t) => ({ tag: t })) }
          : undefined,
      },
      select: { id: true },
    });

    return res.status(201).json({ id: created.id });
  })
);

clientRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        tags: { select: { tag: true } },
        projects: {
          select: { id: true, code: true, name: true, status: true, physicalProgressPct: true },
          orderBy: { updatedAt: "desc" },
          take: 20,
        },
      },
    });
    if (!client) return res.status(404).json({ error: "NOT_FOUND" });

    return res.json({
      client: {
        ...client,
        ltvTotal: String(client.ltvTotal),
        churnRisk: String(client.churnRisk),
        ltvPotential: String(client.ltvPotential),
        tags: client.tags.map((t) => t.tag),
      },
    });
  })
);

clientRoutes.patch(
  "/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        name: z.string().min(2).optional(),
        industry: z.string().optional().nullable(),
        region: z.string().optional().nullable(),
        tier: z.string().optional().nullable(),
        status: z.enum(["ACTIVE", "AT_RISK", "INACTIVE"]).optional(),
        healthScore: z.number().int().min(0).max(100).optional(),
        ltvTotal: z.union([z.number(), z.string()]).optional(),
        churnRisk: z.union([z.number(), z.string()]).optional(),
        ltvPotential: z.union([z.number(), z.string()]).optional(),
      })
      .parse(req.body);

    const updated = await prisma.client.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.industry !== undefined ? { industry: body.industry } : {}),
        ...(body.region !== undefined ? { region: body.region } : {}),
        ...(body.tier !== undefined ? { tier: body.tier } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.healthScore !== undefined ? { healthScore: body.healthScore } : {}),
        ...(body.ltvTotal !== undefined ? { ltvTotal: String(body.ltvTotal) } : {}),
        ...(body.churnRisk !== undefined ? { churnRisk: String(body.churnRisk) } : {}),
        ...(body.ltvPotential !== undefined ? { ltvPotential: String(body.ltvPotential) } : {}),
      },
      select: { id: true },
    });

    return res.json({ id: updated.id });
  })
);

clientRoutes.get(
  "/:id/interactions",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const items = await prisma.interactionEvent.findMany({
      where: { clientId: id },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
    return res.json({ items });
  })
);

clientRoutes.post(
  "/:id/interactions",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const clientId = String(req.params.id);
    const body = z
      .object({
        type: z.string().min(1),
        title: z.string().min(2),
        description: z.string().optional().nullable(),
        occurredAt: z.string().datetime().optional(),
        leadName: z.string().optional().nullable(),
      })
      .parse(req.body);

    const created = await prisma.interactionEvent.create({
      data: {
        clientId,
        type: body.type,
        title: body.title,
        description: body.description || null,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        leadName: body.leadName || null,
      },
      select: { id: true },
    });

    return res.status(201).json({ id: created.id });
  })
);

module.exports = { clientRoutes };

