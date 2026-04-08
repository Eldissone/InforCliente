const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { prisma } = require("../db");
const { config } = require("../config");
const { asyncHandler } = require("../utils/http");
const { authRequired } = require("../middlewares/auth");

const authRoutes = express.Router();

authRoutes.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, clientId: user.clientId || null },
      config.jwtSecret,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, clientId: user.clientId || null },
    });
  })
);

authRoutes.get(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        email: true,
        role: true,
        clientId: true,
        createdAt: true,
        client: { select: { id: true, code: true, name: true } },
      },
    });
    if (!user) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({ user });
  })
);

module.exports = { authRoutes };
