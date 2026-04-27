const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase } = require("../utils/storage");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for avatars
});

const clientRoutes = express.Router();
clientRoutes.use(authRequired);

function getScopedClientId(req) {
  if (req.user?.role !== "cliente") return null;
  if (!req.user?.clientId) {
    const err = new Error("FORBIDDEN");
    err.status = 403;
    throw err;
  }
  return req.user.clientId;
}

function assertClientAccess(req, clientId) {
  const scopedClientId = getScopedClientId(req);
  if (!scopedClientId) return;
  if (scopedClientId !== clientId) {
    const err = new Error("FORBIDDEN");
    err.status = 403;
    throw err;
  }
}

clientRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || "").trim();
    const status = req.query.status ? String(req.query.status) : "";
    const industry = req.query.industry ? String(req.query.industry) : "";
    const sort = String(req.query.sort || "updatedAt_desc");
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));

    const whereClauses = [];
    const scopedClientId = getScopedClientId(req);

    if (scopedClientId) {
      whereClauses.push({ id: scopedClientId });
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
    if (industry) {
      whereClauses.push({ industry: { equals: industry, mode: "insensitive" } });
    }

    const where = whereClauses.length ? { AND: whereClauses } : {};

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
          profilePic: true,
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
        ltvTotal: c.ltvTotal ? String(c.ltvTotal) : "0",
        churnRisk: c.churnRisk ? String(c.churnRisk) : "0",
        ltvPotential: c.ltvPotential ? String(c.ltvPotential) : "0",
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
        profilePic: z.string().optional().nullable(),
        healthScore: z.number().int().min(0).max(100).optional(),
        ltvTotal: z.union([z.number(), z.string()]).default(0),
        churnRisk: z.union([z.number(), z.string()]).default(0),
        ltvPotential: z.union([z.number(), z.string()]).default(0),
        tags: z.array(z.string().min(1)).optional().default([]),
        // Novos campos para automação de acesso
        email: z.string().email(),
        password: z.string().min(6),
      })
      .parse(req.body);

    const passwordHash = await bcrypt.hash(body.password, 10);

    // Uniqueness checks
    const [existingEmail, existingCode] = await Promise.all([
      prisma.user.findUnique({
        where: { email: body.email },
        select: { id: true },
      }),
      prisma.client.findUnique({
        where: { code: body.code },
        select: { id: true },
      }),
    ]);

    if (existingEmail) {
      return res.status(400).json({ error: "EMAIL_ALREADY_EXISTS" });
    }
    if (existingCode) {
      return res.status(400).json({ error: "CLIENT_CODE_ALREADY_EXISTS" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          code: body.code,
          name: body.name,
          industry: body.industry || null,
          region: body.region || null,
          tier: body.tier || null,
          status: body.status || "ACTIVE",
          profilePic: body.profilePic || null,
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

      await tx.user.create({
        data: {
          email: body.email,
          passwordHash,
          role: "cliente",
          clientId: client.id,
        },
      });

      return client;
    });

    return res.status(201).json({ id: result.id });
  })
);

clientRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    assertClientAccess(req, id);
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        tags: { select: { tag: true } },
        users: { 
          select: { 
            user: { select: { email: true } } 
          }, 
          take: 1 
        },
        projects: {
          select: {
            id: true,
            code: true,
            name: true,
            contact: true,
            location: true,
            status: true,
            physicalProgressPct: true,
            startDate: true,
            dueDate: true,
            budgetTotal: true,
            currency: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 20,
        },
      },
    });
    if (!client) return res.status(404).json({ error: "NOT_FOUND" });

    return res.json({
      client: {
        ...client,
        ltvTotal: client.ltvTotal ? String(client.ltvTotal) : "0",
        churnRisk: client.churnRisk ? String(client.churnRisk) : "0",
        ltvPotential: client.ltvPotential ? String(client.ltvPotential) : "0",
        tags: client.tags.map((t) => t.tag),
        accountEmail: client.users?.[0]?.email || null,
        projects: client.projects.map((project) => ({
          ...project,
          budgetTotal: String(project.budgetTotal),
        })),
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
        code: z.string().min(2).optional(),
        name: z.string().min(2).optional(),
        industry: z.string().optional().nullable(),
        region: z.string().optional().nullable(),
        tier: z.string().optional().nullable(),
        status: z.enum(["ACTIVE", "AT_RISK", "INACTIVE"]).optional(),
        profilePic: z.string().optional().nullable(),
        healthScore: z.number().int().min(0).max(100).optional(),
        ltvTotal: z.union([z.number(), z.string()]).optional(),
        churnRisk: z.union([z.number(), z.string()]).optional(),
        ltvPotential: z.union([z.number(), z.string()]).optional(),
        email: z.string().email().optional(),
        password: z.string().min(6).optional(),
      })
      .parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      // Uniqueness checks
      if (body.code) {
        const existing = await tx.client.findFirst({
          where: { code: body.code, id: { not: id } },
        });
        if (existing) {
          const err = new Error("CLIENT_CODE_ALREADY_EXISTS");
          err.status = 400;
          throw err;
        }
      }

      const updateData = {
        ...(body.code ? { code: body.code } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.industry !== undefined ? { industry: body.industry } : {}),
        ...(body.region !== undefined ? { region: body.region } : {}),
        ...(body.tier !== undefined ? { tier: body.tier } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.profilePic !== undefined ? { profilePic: body.profilePic } : {}),
        ...(body.healthScore !== undefined ? { healthScore: body.healthScore } : {}),
        ...(body.ltvTotal !== undefined ? { ltvTotal: String(body.ltvTotal) } : {}),
        ...(body.churnRisk !== undefined ? { churnRisk: String(body.churnRisk) } : {}),
        ...(body.ltvPotential !== undefined ? { ltvPotential: String(body.ltvPotential) } : {}),
      };

      const updated = await tx.client.update({
        where: { id },
        data: updateData,
        select: { id: true },
      });

      if (body.email || body.password) {
        const user = await tx.user.findFirst({
          where: { clientId: id, role: "cliente" },
          select: { id: true, email: true },
        });

        if (user) {
          if (body.email && body.email !== user.email) {
            const emailExists = await tx.user.findFirst({
              where: { email: body.email, id: { not: user.id } },
            });
            if (emailExists) {
              const err = new Error("EMAIL_ALREADY_EXISTS");
              err.status = 400;
              throw err;
            }
          }

          const userUpdateData = {};
          if (body.email) userUpdateData.email = body.email;
          if (body.password) {
            userUpdateData.passwordHash = await bcrypt.hash(body.password, 10);
          }

          await tx.user.update({
            where: { id: user.id },
            data: userUpdateData,
          });
        }
      }

      return updated;
    });

    return res.json({ id: result.id });
  })
);

clientRoutes.delete(
  "/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.client.delete({ where: { id } });
    return res.json({ ok: true });
  })
);

clientRoutes.get(
  "/:id/interactions",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    assertClientAccess(req, id);
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
  asyncHandler(async (req, res) => {
    const clientId = String(req.params.id);
    assertClientAccess(req, clientId);
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

clientRoutes.post(
  "/:id/avatar",
  requireRole(["admin", "operador"]),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const clientId = String(req.params.id);
    assertClientAccess(req, clientId);
    if (!req.file) throw new Error("FILE_REQUIRED");

    const extension = path.extname(req.file.originalname).toLowerCase();
    const fileName = `${Date.now()}${extension}`;
    const storagePath = `clients/${clientId}/${fileName}`;

    const publicUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    await prisma.client.update({
      where: { id: clientId },
      data: { profilePic: publicUrl }
    });

    return res.status(201).json({ profilePic: publicUrl });
  })
);

module.exports = { clientRoutes };
