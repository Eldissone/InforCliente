const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const userRoutes = express.Router();
userRoutes.use(authRequired);
userRoutes.use(requireRole(["admin"]));

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
  "/",
  asyncHandler(async (_req, res) => {
    const items = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        clientId: true,
        createdAt: true,
        client: { select: { id: true, name: true, code: true } },
      },
    });
    return res.json({ items });
  })
);

userRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        role: z.enum(["admin", "operador", "leitura", "cliente"]).default("leitura"),
        clientId: z.string().optional().nullable(),
      })
      .parse(req.body);

    const clientId = body.role === "cliente" ? body.clientId || null : null;
    if (body.role === "cliente" && !clientId) {
      return res.status(400).json({ error: "CLIENT_REQUIRED" });
    }

    await ensureClientExists(clientId);

    const passwordHash = await bcrypt.hash(body.password, 10);
    const created = await prisma.user.create({
      data: { email: body.email, role: body.role, passwordHash, clientId },
      select: { id: true },
    });
    return res.status(201).json({ id: created.id });
  })
);

userRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        role: z.enum(["admin", "operador", "leitura", "cliente"]).optional(),
        email: z.string().email().optional(),
        clientId: z.string().optional().nullable(),
      })
      .parse(req.body);

    const current = await prisma.user.findUnique({
      where: { id },
      select: { role: true, clientId: true },
    });
    if (!current) return res.status(404).json({ error: "NOT_FOUND" });

    const nextRole = body.role || current.role;
    const nextClientId =
      nextRole === "cliente"
        ? body.clientId !== undefined
          ? body.clientId || null
          : current.clientId || null
        : null;

    if (nextRole === "cliente" && !nextClientId) {
      return res.status(400).json({ error: "CLIENT_REQUIRED" });
    }

    await ensureClientExists(nextClientId);

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(body.role ? { role: body.role } : {}),
        ...(body.email ? { email: body.email } : {}),
        clientId: nextClientId,
      },
      select: { id: true },
    });
    return res.json({ id: updated.id });
  })
);

userRoutes.post(
  "/:id/reset-password",
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
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.user.delete({ where: { id } });
    return res.json({ ok: true });
  })
);

module.exports = { userRoutes };
