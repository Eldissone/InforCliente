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
          profilePic: true,
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

dashboardRoutes.get(
  "/client-summary",
  asyncHandler(async (req, res) => {
    const clientId = getScopedClientId(req);
    if (!clientId) return res.status(403).json({ error: "CLIENT_SCOPE_REQUIRED" });

    const { start, end } = req.query;
    const dateStart = start ? new Date(start) : null;
    const dateEnd = end ? new Date(end) : null;

    const paymentFilter = {
      status: "CONFIRMADO",
      ...(dateStart || dateEnd
        ? {
            dataPagamento: {
              ...(dateStart ? { gte: dateStart } : {}),
              ...(dateEnd ? { lte: dateEnd } : {}),
            },
          }
        : {}),
    };

    // 1. Buscar todos os projetos do cliente
    const projects = await prisma.project.findMany({
      where: { clientId },
      include: {
        payments: { where: paymentFilter },
      },
    });

    // 2. Cálculo Financeiro e Projetos
    let totalContract = 0;
    let totalPaid = 0;
    let totalProgressSum = 0;

    const projectMetrics = projects.map((p) => {
      const budget = Number(p.budgetTotal || 0);
      const paid = p.payments.reduce((acc, pay) => acc + Number(pay.valor || 0), 0);
      const progress = Number(p.physicalProgressPct || 0);

      totalContract += budget;
      totalPaid += paid;
      totalProgressSum += progress;

      return {
        id: p.id,
        name: p.name,
        budget,
        paid,
        debt: budget - paid,
        progress,
        currency: p.currency,
        director: {
          name: p.directorObra,
          photo: p.directorPhoto,
          phone: p.directorPhone,
          email: p.directorEmail,
        },
        technicians: p.technicians,
        lastAccidentDate: p.lastAccidentDate,
        activeStaffCount: p.activeStaffCount,
        safetyHistory: p.safetyHistory,
      };
    });

    const overallProgress = projects.length > 0 ? Math.round(totalProgressSum / projects.length) : 0;

    // 3. Resumo de Armazém do Cliente (Agregação via Movements)
    // Buscamos movimentos onde o batch seja "Armazém do Cliente" ou similar
    const movements = await prisma.stockMovement.findMany({
      where: {
        projectId: { in: projects.map((p) => p.id) },
        batch: "Armazém do Cliente",
        auditStatus: "APROVADO",
      },
      include: { material: true },
    });

    const stockMap = {};
    movements.forEach((m) => {
      const mId = m.materialId;
      if (!stockMap[mId]) {
        stockMap[mId] = {
          id: mId,
          name: m.material.name,
          unit: m.material.unit,
          qty: 0,
          totalIn: 0,
          totalOut: 0,
          lastActivity: m.dataMovimento,
          state: m.auditStatus === "APROVADO" ? "Bom Estado" : "Pendente",
        };
      }
      
      const val = Number(m.quantityGood || 0);
      if (m.type === "SAIDA") {
        stockMap[mId].totalOut += val;
        stockMap[mId].qty -= val;
      } else if (m.type === "ENTRADA") {
        stockMap[mId].totalIn += val;
        stockMap[mId].qty += val;
      }
      
      if (new Date(m.dataMovimento) > new Date(stockMap[mId].lastActivity)) {
        stockMap[mId].lastActivity = m.dataMovimento;
      }
    });

    const stockSummary = Object.values(stockMap);

    return res.json({
      clientId,
      financials: {
        totalContract,
        totalPaid,
        totalDebt: totalContract - totalPaid,
      },
      overallProgress,
      projects: projectMetrics,
      stock: stockSummary,
    });
  })
);

module.exports = { dashboardRoutes };
