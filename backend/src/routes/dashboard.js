const express = require("express");
const { prisma } = require("../db");
const { authRequired } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const dashboardRoutes = express.Router();

dashboardRoutes.use(authRequired);

dashboardRoutes.get(
  "/metrics",
  asyncHandler(async (_req, res) => {
    const [totalClients, avgHealthAgg] = await Promise.all([
      prisma.client.count(),
      prisma.client.aggregate({ _avg: { healthScore: true } }),
    ]);

    const portfolioValueAgg = await prisma.client.aggregate({
      _sum: { ltvTotal: true },
    });

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

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};

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
  asyncHandler(async (_req, res) => {
    const alerts = await prisma.alert.findMany({
      where: { status: "OPEN" },
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

