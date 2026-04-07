const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const userRoutes = express.Router();
userRoutes.use(authRequired);
userRoutes.use(requireRole(["admin"]));

userRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    const items = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, createdAt: true },
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
        role: z.enum(["admin", "operador", "leitura"]).default("leitura"),
      })
      .parse(req.body);

    const passwordHash = await bcrypt.hash(body.password, 10);
    const created = await prisma.user.create({
      data: { email: body.email, role: body.role, passwordHash },
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
        role: z.enum(["admin", "operador", "leitura"]).optional(),
        email: z.string().email().optional(),
      })
      .parse(req.body);

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(body.role ? { role: body.role } : {}),
        ...(body.email ? { email: body.email } : {}),
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

