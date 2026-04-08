const express = require("express");
const { prisma } = require("../db");
const { authRequired } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const dashboardRoutes = express.Router();

dashboardRoutes.use(authRequired);

function getScopedClientId(req) {
  if (req.user?.role !== "cliente") return null;
  if (!req.user?.clientId) {
    const err = new Error("FORBIDDEN");
    err.status = 403;
    throw err;
  }
  return req.user.clientId;
}

dashboardRoutes.get(
  "/metrics",
  asyncHandler(async (req, res) => {
    const scopedClientId = getScopedClientId(req);

    if (scopedClientId) {
      const client = await prisma.client.findUnique({
        where: { id: scopedClientId },
        select: { healthScore: true, ltvTotal: true },
      });

      return res.json({
        totalClients: client ? 1 : 0,
        portfolioValue: client?.ltvTotal ? String(client.ltvTotal) : "0",
        avgHealth: client?.healthScore ?? 0,
      });
    }

    const [totalClients, avgHealthAgg, portfolioValueAgg] = await Promise.all([
      prisma.client.count(),
      prisma.client.aggregate({ _avg: { healthScore: true } }),
      prisma.client.aggregate({ _sum: { ltvTotal: true } }),
    ]);

    return res.json({
      totalClients,
      portfolioValue: portfolioValueAgg._sum.ltvTotal ? String(portfolioValueAgg._sum.ltvTotal) : "0",
      avgHealth: avgHealthAgg._avg.healthScore ? Math.round(avgHealthAgg._avg.healthScore) : 0,
    });
  })
);

dashboardRoutes.get(
  "/clients",
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || "").trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)));
    const scopedClientId = getScopedClientId(req);
    const whereClauses = [];

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

    const where = whereClauses.length ? { AND: whereClauses } : {};

    const [total, items] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          code: true,
          name: true,
          industry: true,
          status: true,
          region: true,
          healthScore: true,
          ltvTotal: true,
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
      })),
    });
  })
);

dashboardRoutes.get(
  "/alerts",
  asyncHandler(async (req, res) => {
    const scopedClientId = getScopedClientId(req);
    const where = scopedClientId
      ? {
          status: "OPEN",
          OR: [{ clientId: scopedClientId }, { project: { is: { clientId: scopedClientId } } }],
        }
      : { status: "OPEN" };

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: {
        id: true,
        severity: true,
        title: true,
        body: true,
        createdAt: true,
        clientId: true,
        projectId: true,
      },
    });
    return res.json({ items: alerts });
  })
);

module.exports = { dashboardRoutes };
