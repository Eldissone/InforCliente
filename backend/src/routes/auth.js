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

    // Verificar contas vinculadas
    const accounts = await prisma.userClient.findMany({
      where: { userId: user.id },
      include: {
        client: {
          select: { id: true, code: true, name: true, profilePic: true }
        }
      }
    });

    // Buscar se existem obras no sistema (para Admin)
    const projectsCount = (user.role === 'admin' || user.role === 'operador')
      ? await prisma.project.count()
      : accounts.length;

    // Buscar informações do cliente para o nome da empresa
    const primaryClient = user.clientId ? await prisma.client.findUnique({ where: { id: user.clientId }, select: { name: true } }) : null;

    if (projectsCount > 0) {
      // Forçar redirecionamento para tela de boas-vindas com seleção de obra
      return res.json({
        status: "MULTI_ACCOUNT",
        user: { 
          id: user.id, 
          email: user.email, 
          name: user.name, 
          clientName: primaryClient?.name || null,
          role: user.role 
        },
        accounts: accounts.map(a => ({
          id: a.client.id,
          name: a.client.name,
          code: a.client.code,
          role: a.role,
          profilePic: a.client.profilePic
        }))
      });
    }

    // Se tiver apenas uma ou nenhuma (caso de admin sem client)
    const activeClientId = accounts.length === 1 ? accounts[0].clientId : (user.clientId || null);
    const activeRole = accounts.length === 1 ? accounts[0].role : user.role;

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: activeRole, clientId: activeClientId },
      config.jwtSecret,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: activeRole, clientId: activeClientId },
    });
  })
);

authRoutes.post(
  "/select-account",
  asyncHandler(async (req, res) => {
    const { userId, clientId } = z.object({
      userId: z.string(),
      clientId: z.string()
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    let activeRole = user.role;

    // Se não for admin, validar se tem acesso a este cliente
    if (user.role !== 'admin' && user.role !== 'operador') {
        const link = await prisma.userClient.findUnique({
          where: {
            userId_clientId: { userId, clientId }
          }
        });
        if (!link) return res.status(403).json({ error: "UNAUTHORIZED_ACCESS" });
        activeRole = link.role;
    }

    // Atualizar o clientId padrão
    await prisma.user.update({
      where: { id: userId },
      data: { clientId }
    });

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: activeRole, clientId: clientId },
      config.jwtSecret,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: activeRole, clientId: clientId },
    });
  })
);

authRoutes.get(
  "/available-projects",
  asyncHandler(async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "USER_ID_REQUIRED" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    let where = {};

    if (user.role !== 'admin' && user.role !== 'operador') {
        const links = await prisma.userClient.findMany({
            where: { userId },
            select: { clientId: true }
        });
        const clientIds = links.map(l => l.clientId);
        where = { clientId: { in: clientIds } };
    }

    const projects = await prisma.project.findMany({
      where,
      select: {
          id: true,
          name: true,
          code: true,
          status: true,
          location: true,
          client: { select: { id: true, name: true, profilePic: true } }
      },
      orderBy: { name: "asc" }
    });

    return res.json({ items: projects });
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
