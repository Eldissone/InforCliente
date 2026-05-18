const express = require("express");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const dashboardRoutes = express.Router();

dashboardRoutes.use(authRequired);

function getScopedClientId(req) {
  const role = (req.user?.role || "").toLowerCase();
  if (role !== "cliente") return null;
  return req.user.clientId || null;
}

async function getExchangeRates() {
  const rates = { USD: 918, EUR: 990 }; // Robust fallbacks, matching format.js 918
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD", { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (data?.rates) {
      if (data.rates.AOA) rates.USD = Number(data.rates.AOA);
      if (data.rates.EUR) {
        rates.EUR = rates.USD / Number(data.rates.EUR);
      }
    }
  } catch (e) {
    // Keep fallbacks
  }
  return rates;
}

dashboardRoutes.get(
  "/metrics",
  requirePermission("dashboard", "view"),
  asyncHandler(async (req, res) => {
    const scopedClientId = getScopedClientId(req);
    const userRole = (req.user?.role || "").toLowerCase();

    const exchangeRates = await getExchangeRates();
    const rateUSD = exchangeRates.USD;
    const rateEUR = exchangeRates.EUR;

    const getMultiplier = (currency) => {
      const cur = String(currency || "AOA").toUpperCase();
      if (cur === "USD") return rateUSD;
      if (cur === "EUR") return rateEUR;
      return 1;
    };

    if (userRole === "cliente") {
      if (scopedClientId) {
        const client = await prisma.client.findUnique({
          where: { id: scopedClientId },
          select: { healthScore: true, status: true },
        });

        const projects = await prisma.project.findMany({
          where: {
            clientId: scopedClientId,
            active: true
          },
          select: {
            id: true,
            status: true,
            budgetTotal: true,
            currency: true,
            payments: {
              where: { status: "CONFIRMADO" },
              select: { valor: true }
            }
          }
        });

        const projectIds = projects.map(p => p.id);
        const dailyPlans = await prisma.dailyPlan.findMany({
          where: { projectId: { in: projectIds } },
          select: { status: true }
        });

        const obras = { total: projects.length, ativas: 0, concluidas: 0, pausadas: 0 };
        let portfolioValue = 0;
        let faturacaoEstimada = 0;

        projects.forEach(p => {
          if (p.status === "ACTIVE") obras.ativas++;
          if (p.status === "COMPLETED") obras.concluidas++;
          if (p.status === "ON_HOLD") obras.pausadas++;

          const mul = getMultiplier(p.currency);
          faturacaoEstimada += (Number(p.budgetTotal) || 0) * mul;
          if (p.payments) {
            p.payments.forEach(pay => {
              portfolioValue += (Number(pay.valor) || 0) * mul;
            });
          }
        });

        const tarefas = { total: dailyPlans.length, pendentes: 0, em_curso: 0, executadas: 0 };
        dailyPlans.forEach(dp => {
          if (dp.status === "DRAFT" || dp.status === "PENDING_MATERIAL") {
            tarefas.pendentes++;
          } else if (dp.status === "IN_PROGRESS") {
            tarefas.em_curso++;
          } else if (dp.status === "COMPLETED" || dp.status === "PENDING_VALIDATION") {
            tarefas.executadas++;
          }
        });

        const clientesStatus = { ativas: 0, em_risco: 0, inativas: 0 };
        if (client) {
          if (client.status === "ACTIVE") clientesStatus.ativas = 1;
          if (client.status === "AT_RISK") clientesStatus.em_risco = 1;
          if (client.status === "INACTIVE") clientesStatus.inativas = 1;
        }

        return res.json({
          totalClients: client ? 1 : 0,
          portfolioValue: String(portfolioValue),
          faturacaoEstimada: String(faturacaoEstimada),
          avgHealth: client?.healthScore ?? 0,
          obras,
          tarefas,
          clientesStatus
        });
      } else {
        // Cliente sem clientId vinculado
        return res.json({
          totalClients: 0,
          portfolioValue: "0",
          faturacaoEstimada: "0",
          avgHealth: 0,
          obras: { total: 0, ativas: 0, concluidas: 0, pausadas: 0 },
          tarefas: { total: 0, pendentes: 0, em_curso: 0, executadas: 0 },
          clientesStatus: { ativas: 0, em_risco: 0, inativas: 0 }
        });
      }
    }

    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const projectStatus = String(req.query.projectStatus || "").trim();
    const taskStatus = String(req.query.taskStatus || "").trim();

    const clientWhereClauses = [];
    const projectWhereClauses = [{ active: true }];

    if (search) {
      clientWhereClauses.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
        ],
      });
      projectWhereClauses.push({
        client: {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
          ],
        }
      });
    }

    if (status) {
      clientWhereClauses.push({ status });
      projectWhereClauses.push({ client: { status } });
    }

    if (projectStatus) {
      clientWhereClauses.push({
        projects: {
          some: { status: projectStatus, active: true }
        }
      });
      projectWhereClauses.push({ status: projectStatus });
    }

    if (taskStatus) {
      let dailyPlanStatusFilter = [];
      if (taskStatus === "PENDING") {
        dailyPlanStatusFilter = ["DRAFT", "PENDING_MATERIAL"];
      } else if (taskStatus === "IN_PROGRESS") {
        dailyPlanStatusFilter = ["IN_PROGRESS"];
      } else if (taskStatus === "COMPLETED") {
        dailyPlanStatusFilter = ["COMPLETED", "PENDING_VALIDATION"];
      }

      if (dailyPlanStatusFilter.length > 0) {
        clientWhereClauses.push({
          projects: {
            some: {
              active: true,
              dailyPlans: {
                some: { status: { in: dailyPlanStatusFilter } }
              }
            }
          }
        });
        projectWhereClauses.push({
          dailyPlans: {
            some: { status: { in: dailyPlanStatusFilter } }
          }
        });
      }
    }

    const clientWhere = clientWhereClauses.length ? { AND: clientWhereClauses } : {};
    const projectWhere = { AND: projectWhereClauses };

    const [
      totalClients,
      avgHealthAgg,
      paymentsList,
      projectsList,
      obrasStatusCounts,
      tarefasCounts,
      clientesStatusCounts
    ] = await Promise.all([
      prisma.client.count({ where: clientWhere }),
      prisma.client.aggregate({ where: clientWhere, _avg: { healthScore: true } }),
      prisma.projectPayment.findMany({
        where: { status: "CONFIRMADO", project: projectWhere },
        select: { valor: true, project: { select: { currency: true } } }
      }),
      prisma.project.findMany({
        where: projectWhere,
        select: { budgetTotal: true, currency: true }
      }),
      prisma.project.groupBy({
        where: projectWhere,
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.dailyPlan.groupBy({
        where: { project: projectWhere },
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.client.groupBy({
        where: clientWhere,
        by: ["status"],
        _count: { _all: true },
      }),
    ]);

    const obras = { total: 0, ativas: 0, concluidas: 0, pausadas: 0 };
    obrasStatusCounts.forEach(item => {
      const cnt = item._count._all || 0;
      obras.total += cnt;
      if (item.status === "ACTIVE") obras.ativas = cnt;
      if (item.status === "COMPLETED") obras.concluidas = cnt;
      if (item.status === "ON_HOLD") obras.pausadas = cnt;
    });

    const tarefas = { total: 0, pendentes: 0, em_curso: 0, executadas: 0 };
    tarefasCounts.forEach(item => {
      const cnt = item._count._all || 0;
      tarefas.total += cnt;
      if (item.status === "DRAFT" || item.status === "PENDING_MATERIAL") {
        tarefas.pendentes += cnt;
      } else if (item.status === "IN_PROGRESS") {
        tarefas.em_curso += cnt;
      } else if (item.status === "COMPLETED" || item.status === "PENDING_VALIDATION") {
        tarefas.executadas += cnt;
      }
    });

    const clientesStatus = { ativas: 0, em_risco: 0, inativas: 0 };
    clientesStatusCounts.forEach(item => {
      const cnt = item._count._all || 0;
      if (item.status === "ACTIVE") clientesStatus.ativas = cnt;
      if (item.status === "AT_RISK") clientesStatus.em_risco = cnt;
      if (item.status === "INACTIVE") clientesStatus.inativas = cnt;
    });

    let portfolioValue = 0;
    paymentsList.forEach(pay => {
      const mul = getMultiplier(pay.project?.currency);
      portfolioValue += (Number(pay.valor) || 0) * mul;
    });

    let faturacaoEstimada = 0;
    projectsList.forEach(p => {
      const mul = getMultiplier(p.currency);
      faturacaoEstimada += (Number(p.budgetTotal) || 0) * mul;
    });

    return res.json({
      totalClients,
      portfolioValue: String(portfolioValue),
      faturacaoEstimada: String(faturacaoEstimada),
      avgHealth: avgHealthAgg._avg.healthScore ? Math.round(avgHealthAgg._avg.healthScore) : 0,
      obras,
      tarefas,
      clientesStatus
    });
  })
);

dashboardRoutes.get(
  "/clients",
  requirePermission("clientes", "view"),
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const projectStatus = String(req.query.projectStatus || "").trim();
    const taskStatus = String(req.query.taskStatus || "").trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)));
    const scopedClientId = getScopedClientId(req);
    const userRole = (req.user?.role || "").toLowerCase();
    const whereClauses = [];

    if (userRole === "cliente") {
      if (scopedClientId) {
        whereClauses.push({ id: scopedClientId });
      } else {
        // Se é cliente mas não tem clientId, não deve ver nenhum cliente na lista
        whereClauses.push({ id: "none" }); 
      }
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

    if (projectStatus) {
      whereClauses.push({
        projects: {
          some: { status: projectStatus, active: true }
        }
      });
    }

    if (taskStatus) {
      let dailyPlanStatusFilter = [];
      if (taskStatus === "PENDING") {
        dailyPlanStatusFilter = ["DRAFT", "PENDING_MATERIAL"];
      } else if (taskStatus === "IN_PROGRESS") {
        dailyPlanStatusFilter = ["IN_PROGRESS"];
      } else if (taskStatus === "COMPLETED") {
        dailyPlanStatusFilter = ["COMPLETED", "PENDING_VALIDATION"];
      }

      if (dailyPlanStatusFilter.length > 0) {
        whereClauses.push({
          projects: {
            some: {
              active: true,
              dailyPlans: {
                some: { status: { in: dailyPlanStatusFilter } }
              }
            }
          }
        });
      }
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
          projects: {
            where: { active: true },
            select: {
              budgetTotal: true,
              currency: true,
              payments: {
                where: { status: "CONFIRMADO" },
                select: { valor: true }
              }
            }
          }
        },
      }),
    ]);

    const exchangeRates = await getExchangeRates();
    const rateUSD = exchangeRates.USD;
    const rateEUR = exchangeRates.EUR;

    const getMultiplier = (currency) => {
      const cur = String(currency || "AOA").toUpperCase();
      if (cur === "USD") return rateUSD;
      if (cur === "EUR") return rateEUR;
      return 1;
    };

    return res.json({
      page,
      pageSize,
      total,
      items: items.map((c) => {
        let ltvTotal = 0;
        if (c.projects) {
          c.projects.forEach((p) => {
            const mul = getMultiplier(p.currency);
            if (p.payments) {
              p.payments.forEach((pay) => {
                ltvTotal += (Number(pay.valor) || 0) * mul;
              });
            }
          });
        }
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          industry: c.industry,
          status: c.status,
          region: c.region,
          profilePic: c.profilePic,
          healthScore: c.healthScore,
          ltvTotal: String(ltvTotal),
        };
      }),
    });
  })
);

dashboardRoutes.get(
  "/alerts",
  requirePermission("dashboard", "view"),
  asyncHandler(async (req, res) => {
    const scopedClientId = getScopedClientId(req);
    const userRole = (req.user?.role || "").toLowerCase();
    let where = { status: "OPEN" };
    if (userRole === "cliente") {
      where.OR = [
        ...(scopedClientId ? [{ clientId: scopedClientId }] : []),
        ...(scopedClientId ? [{ project: { is: { clientId: scopedClientId } } }] : []),
        { project: { is: { assignedUsers: { some: { id: req.user.sub } } } } }
      ];
    }

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
    // Obter o clientId do token. Pode ser null se a obra não tiver cliente vinculado.
    const userRole = (req.user?.role || "").toLowerCase();
    if (userRole !== "cliente") return res.status(403).json({ error: "CLIENT_ROLE_REQUIRED" });

    const clientId = req.user.clientId; // Pode ser null

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
      where: {
        OR: [
          ...(clientId ? [{ clientId }] : []),
          { assignedUsers: { some: { id: req.user.sub } } }
        ]
      },
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
    const movements = await prisma.stockMovement.findMany({
      where: {
        projectId: { in: projects.map((p) => p.id) },
      },
      include: { product: true },
    });

    const stockMap = {};
    movements.forEach((m) => {
      const pId = m.productId;
      if (!stockMap[pId]) {
        stockMap[pId] = {
          id: pId,
          name: m.product.name,
          unit: m.product.unit,
          qty: 0,
          totalIn: 0,
          totalOut: 0,
          lastActivity: m.createdAt,
          state: "Bom Estado",
        };
      }
      
      const val = Number(m.quantity || 0);
      if (m.type === "SAIDA" || m.type === "TRANSFER_OUT") {
        stockMap[pId].totalOut += val;
        stockMap[pId].qty -= val;
      } else if (m.type === "ENTRADA" || m.type === "TRANSFER_IN") {
        stockMap[pId].totalIn += val;
        stockMap[pId].qty += val;
      }
      
      if (new Date(m.createdAt) > new Date(stockMap[pId].lastActivity)) {
        stockMap[pId].lastActivity = m.createdAt;
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
