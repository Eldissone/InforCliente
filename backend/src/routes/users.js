const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase } = require("../utils/storage");
const { serializeUser, USER_PUBLIC_SELECT, buildChatUserSearchWhere } = require("../services/chatService");

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("INVALID_IMAGE_TYPE"));
  },
});

const userRoutes = express.Router();
userRoutes.use(authRequired);
// Remoção da restrição global admin - agora é granulada por rota
// userRoutes.use(requireRole(["admin"]));

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

userRoutes.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        profilePic: true,
        createdAt: true,
        profile: { select: { phone: true, jobTitle: true, bio: true } },
        presence: { select: { status: true, lastSeenAt: true } },
      },
    });
    if (!user) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json(serializeUser(user));
  })
);

userRoutes.get(
  "/search",
  authRequired,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const requesterRole = (req.user?.role || "").toLowerCase();
    const whereClause = buildChatUserSearchWhere(req.user.sub, requesterRole, q);

    const items = await prisma.user.findMany({
      where: whereClause,
      take: 20,
      select: USER_PUBLIC_SELECT,
      orderBy: { name: "asc" },
    });

    return res.json({ items: items.map(serializeUser) });
  })
);

// Rota pública para listar destinatários (usada em transferências de stock/ativos)
userRoutes.get(
  "/receivers",
  asyncHandler(async (_req, res) => {
    const items = await prisma.user.findMany({
      where: {
        role: { in: ["admin", "operador"] }
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
    return res.json({ items });
  })
);

userRoutes.get(
  "/technicians",
  asyncHandler(async (_req, res) => {
    const items = await prisma.user.findMany({
      where: {
        role: { in: ["tecnico", "supervisor", "admin", "operador"] } // Permitimos que admins/operadores/supervisores também sejam marcados
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });
    return res.json({ items });
  })
);

userRoutes.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().optional().nullable(),
        password: z.string().min(6).optional(),
        profilePic: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        jobTitle: z.string().optional().nullable(),
        bio: z.string().optional().nullable(),
      })
      .parse(req.body);

    const data = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.profilePic !== undefined ? { profilePic: body.profilePic } : {}),
    };

    if (body.password) {
      data.passwordHash = await bcrypt.hash(body.password, 10);
    }

    const hasProfileFields =
      body.phone !== undefined || body.jobTitle !== undefined || body.bio !== undefined;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: req.user.sub },
        data,
      });

      if (hasProfileFields) {
        await tx.userProfile.upsert({
          where: { userId: req.user.sub },
          create: {
            userId: req.user.sub,
            phone: body.phone ?? null,
            jobTitle: body.jobTitle ?? null,
            bio: body.bio ?? null,
          },
          update: {
            ...(body.phone !== undefined ? { phone: body.phone } : {}),
            ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
            ...(body.bio !== undefined ? { bio: body.bio } : {}),
          },
        });
      }
    });

    const io = req.app.get("io");
    if (io) {
      io.emit("user:profile_updated", { userId: req.user.sub });
    }

    return res.json({ ok: true });
  })
);

userRoutes.post(
  "/me/avatar",
  avatarUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

    const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
    const storagePath = `avatars/${req.user.sub}${safeExt}`;

    const profilePic = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    await prisma.user.update({
      where: { id: req.user.sub },
      data: { profilePic },
    });

    const io = req.app.get("io");
    if (io) {
      io.emit("user:profile_updated", { userId: req.user.sub, profilePic });
    }

    return res.json({ profilePic });
  })
);

userRoutes.get(
  "/",
  requirePermission("sistema", "view"),
  asyncHandler(async (_req, res) => {
    const items = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        clientId: true,
        profilePic: true,
        createdAt: true,
        client: { select: { id: true, name: true, code: true, profilePic: true } },
        assignedProjects: { select: { id: true, name: true, code: true } },
      },
    });
    return res.json({ items });
  })
);

userRoutes.post(
  "/",
  requirePermission("sistema", "create"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        name: z.string().optional().nullable(),
        password: z.string().min(6),
        role: z.enum(["admin", "operador", "tecnico", "supervisor", "leitura", "cliente"]).default("leitura"),
        clientId: z.string().optional().nullable(),
        profilePic: z.string().optional().nullable(),
        assignedProjectIds: z.array(z.string()).optional(),
      })
      .parse(req.body);

    const normalizedRole = (body.role || "").toUpperCase();
    const clientId = normalizedRole === "CLIENT" || normalizedRole === "CLIENTE" ? body.clientId || null : null;
    
    if ((normalizedRole === "CLIENT" || normalizedRole === "CLIENTE") && !clientId) {
      return res.status(400).json({ error: "CLIENT_ID_REQUIRED" });
    }

    await ensureClientExists(clientId);

    const existing = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    });
    if (existing) {
      return res.status(400).json({ error: "EMAIL_ALREADY_EXISTS" });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: body.email,
          name: body.name || null,
          role: body.role,
          passwordHash,
          clientId,
          profilePic: body.profilePic || null,
          assignedProjects: body.assignedProjectIds ? { connect: body.assignedProjectIds.map(id => ({ id })) } : undefined,
        },
        select: { id: true },
      });

      if (clientId) {
        await tx.userClient.create({
          data: {
            userId: user.id,
            clientId: clientId,
            role: body.role,
          }
        });
      }
      return user;
    });

    return res.status(201).json({ id: created.id });
  })
);

userRoutes.patch(
  "/:id",
  requirePermission("sistema", "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        role: z.enum(["admin", "operador", "tecnico", "supervisor", "leitura", "cliente"]).optional(),
        name: z.string().optional().nullable(),
        email: z.string().email().optional(),
        clientId: z.string().optional().nullable(),
        profilePic: z.string().optional().nullable(),
        assignedProjectIds: z.array(z.string()).optional(),
      })
      .parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id },
      select: { role: true, clientId: true },
    });
    if (!user) return res.status(404).json({ error: "NOT_FOUND" });

    const roleChanged = body.role && body.role !== user.role;

    const rawRole = body.role || user.role;
    const nextRole = rawRole.toUpperCase();
    const isClientRole = nextRole === "CLIENT" || nextRole === "CLIENTE";
    const nextClientId = isClientRole ? (body.clientId !== undefined ? body.clientId || null : user.clientId) : null;

    if (isClientRole && !nextClientId) {
      return res.status(400).json({ error: "CLIENT_ID_REQUIRED" });
    }

    await ensureClientExists(nextClientId);

    if (body.email) {
      const existing = await prisma.user.findFirst({
        where: { email: body.email, NOT: { id } },
        select: { id: true },
      });
      if (existing) {
        return res.status(400).json({ error: "EMAIL_ALREADY_EXISTS" });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          ...(body.role ? { role: body.role } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.email ? { email: body.email } : {}),
          ...(body.profilePic !== undefined ? { profilePic: body.profilePic } : {}),
          client: nextClientId ? { connect: { id: nextClientId } } : { disconnect: true },
          assignedProjects: body.assignedProjectIds ? { set: body.assignedProjectIds.map(id => ({ id })) } : undefined,
        },
        select: { id: true },
      });

      // Sync UserClient join table so GET /clients/:id can find the linked user
      if (nextClientId) {
        await tx.userClient.upsert({
          where: { userId_clientId: { userId: user.id, clientId: nextClientId } },
          create: { userId: user.id, clientId: nextClientId, role: rawRole },
          update: { role: rawRole },
        });
      } else {
        // Remove any existing UserClient entries for this user (unlinking)
        await tx.userClient.deleteMany({ where: { userId: user.id } });
      }

      return user;
    });

    if (roleChanged) {
      await prisma.userPermission.deleteMany({ where: { userId: id } });
    }

    return res.json({ id: updated.id });
  })
);

userRoutes.post(
  "/:id/reset-password",
  requirePermission("sistema", "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z.object({ password: z.string().min(6) }).parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 10);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    return res.json({ ok: true });
  })
);

userRoutes.delete(
  "/:id",
  requirePermission("sistema", "delete"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.user.delete({ where: { id } });
    return res.json({ ok: true });
  })
);

module.exports = { userRoutes };
