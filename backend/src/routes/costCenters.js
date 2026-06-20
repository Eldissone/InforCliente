const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const costCenterRoutes = express.Router();
costCenterRoutes.use(authRequired);

// ─── Centros de Custo ─────────────────────────────────────────────────────────

// GET /cost-centers/project/:projectId — Listar todos os CCs de uma obra
costCenterRoutes.get(
  "/project/:projectId",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const items = await prisma.costCenter.findMany({
      where: { projectId },
      orderBy: { code: "asc" },
      include: {
        _count: { select: { needs: true, payments: true } },
      },
    });
    return res.json({ items });
  })
);

// GET /cost-centers/project/:projectId/summary — Dashboard previsto × real por CC
costCenterRoutes.get(
  "/project/:projectId/summary",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);

    const centers = await prisma.costCenter.findMany({
      where: { projectId },
      orderBy: { code: "asc" },
    });

    // Agrupamento de pagamentos por costCenterId
    const payAgg = await prisma.costPayment.groupBy({
      by: ["costCenterId"],
      where: { projectId },
      _sum: { budgetedAmount: true, paidAmount: true },
    });

    const payMap = {};
    payAgg.forEach((p) => {
      payMap[p.costCenterId] = {
        budgeted: Number(p._sum?.budgetedAmount || 0),
        paid: Number(p._sum?.paidAmount || 0),
      };
    });

    // Adicionar Lançamentos Recentes (ProjectTransactions) aos totais
    const txAgg = await prisma.projectTransaction.findMany({
      where: { projectId, costCenterId: { not: null } },
      select: { costCenterId: true, amount: true, realizedAmount: true, status: true },
    });

    txAgg.forEach((t) => {
      const ccId = t.costCenterId;
      if (!payMap[ccId]) payMap[ccId] = { budgeted: 0, paid: 0 };
      
      payMap[ccId].budgeted += Number(t.amount || 0);
      if (t.status === "PAID") {
        payMap[ccId].paid += Number(t.realizedAmount || t.amount || 0);
      }
    });

    // Agrupamento de necessidades por CC e status
    const needsAgg = await prisma.workNeed.groupBy({
      by: ["costCenterId", "status"],
      where: { projectId },
      _count: { id: true },
    });

    const needsMap = {};
    needsAgg.forEach((n) => {
      if (!needsMap[n.costCenterId]) needsMap[n.costCenterId] = {};
      needsMap[n.costCenterId][n.status] = n._count.id;
    });

    // Totais agrupados por moeda
    const totalsByCurrency = {};

    const summary = centers.map((cc) => {
      const pay = payMap[cc.id] || { budgeted: 0, paid: 0 };
      const needs = needsMap[cc.id] || {};
      const saldo = pay.budgeted - pay.paid;
      const desvio = pay.budgeted > 0
        ? ((pay.paid - pay.budgeted) / pay.budgeted) * 100
        : 0;
      const pctExecutado = pay.budgeted > 0
        ? Math.min(100, (pay.paid / pay.budgeted) * 100)
        : 0;

      const currency = cc.currency || "AOA";
      if (!totalsByCurrency[currency]) {
        totalsByCurrency[currency] = { budgeted: 0, paid: 0 };
      }
      totalsByCurrency[currency].budgeted += pay.budgeted;
      totalsByCurrency[currency].paid += pay.paid;

      return {
        id: cc.id,
        code: cc.code,
        name: cc.name,
        currency,
        budgeted: pay.budgeted,
        paid: pay.paid,
        saldo,
        desvio,
        pctExecutado,
        overflow: pay.paid > pay.budgeted,
        needsCounts: {
          pending: needs.PENDING || 0,
          approved: needs.APPROVED || 0,
          rejected: needs.REJECTED || 0,
          paid: needs.PAID || 0,
        },
      };
    });

    Object.keys(totalsByCurrency).forEach(curr => {
      const t = totalsByCurrency[curr];
      t.saldo = t.budgeted - t.paid;
      t.pctExecutado = t.budgeted > 0 ? Math.min(100, (t.paid / t.budgeted) * 100) : 0;
    });

    return res.json({
      summary,
      totals: totalsByCurrency,
    });
  })
);

// POST /cost-centers/project/:projectId — Criar Centro de Custo
costCenterRoutes.post(
  "/project/:projectId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const body = z.object({
      code: z.string().min(1).max(20),
      name: z.string().min(2),
      currency: z.string().optional(),
    }).parse(req.body);

    const existing = await prisma.costCenter.findUnique({
      where: { projectId_code: { projectId, code: body.code } },
    });
    if (existing) {
      return res.status(400).json({ error: "COST_CENTER_CODE_ALREADY_EXISTS" });
    }

    const created = await prisma.costCenter.create({
      data: { projectId, code: body.code, name: body.name, currency: body.currency || "AOA" },
    });
    return res.status(201).json({ id: created.id });
  })
);

// POST /cost-centers/project/:projectId/seed — Criar CCs pré-definidos
costCenterRoutes.post(
  "/project/:projectId/seed",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);

    const defaults = [
      { code: "CC001", name: "Material" },
      { code: "CC002", name: "Ferramentas" },
      { code: "CC003", name: "Maquinaria" },
      { code: "CC004", name: "EPIs" },
      { code: "CC005", name: "Mão de obra" },
      { code: "CC006", name: "Combustivel" },
    ];

    const created = [];
    for (const cc of defaults) {
      try {
        const item = await prisma.costCenter.create({ data: { projectId, ...cc } });
        created.push(item);
      } catch {
        // ignora duplicados
      }
    }

    return res.status(201).json({ created: created.length });
  })
);

// PATCH /cost-centers/:id — Editar Centro de Custo
costCenterRoutes.patch(
  "/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z.object({
      name: z.string().min(2).optional(),
      code: z.string().min(1).max(20).optional(),
      currency: z.string().optional(),
      active: z.boolean().optional(),
    }).parse(req.body);

    const updated = await prisma.costCenter.update({
      where: { id },
      data: { ...body },
      select: { id: true },
    });
    return res.json({ id: updated.id });
  })
);

// DELETE /cost-centers/:id — Eliminar Centro de Custo
costCenterRoutes.delete(
  "/:id",
  requireRole(["admin"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.costCenter.delete({ where: { id } });
    return res.json({ ok: true });
  })
);

// ─── Necessidades da Obra ──────────────────────────────────────────────────────

// GET /cost-centers/:id/needs — Listar necessidades de um CC
costCenterRoutes.get(
  "/:id/needs",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const costCenterId = String(req.params.id);
    const status = req.query.status ? String(req.query.status) : "";
    const priority = req.query.priority ? String(req.query.priority) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const where = {
      costCenterId,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.workNeed.count({ where }),
      prisma.workNeed.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          costCenter: { select: { code: true, name: true, currency: true } },
          _count: { select: { payments: true } },
        },
      }),
    ]);

    return res.json({
      page, pageSize, total,
      items: items.map((n) => ({
        ...n,
        quantity: n.quantity != null ? String(n.quantity) : null,
      })),
    });
  })
);

// GET /cost-centers/project/:projectId/needs — Listar TODAS as necessidades da obra
costCenterRoutes.get(
  "/project/:projectId/needs",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const status = req.query.status ? String(req.query.status) : "";
    const priority = req.query.priority ? String(req.query.priority) : "";
    const ccId = req.query.costCenterId ? String(req.query.costCenterId) : "";
    const scheduled = req.query.scheduled ? (req.query.scheduled === "true") : undefined;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const where = {
      projectId,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(ccId ? { costCenterId: ccId } : {}),
      ...(scheduled !== undefined ? { scheduled } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.workNeed.count({ where }),
      prisma.workNeed.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          costCenter: { select: { code: true, name: true, currency: true } },
        },
      }),
    ]);

    return res.json({
      page, pageSize, total,
      items: items.map((n) => ({
        ...n,
        quantity: n.quantity != null ? String(n.quantity) : null,
      })),
    });
  })
);

// POST /cost-centers/:id/needs — Criar necessidade
costCenterRoutes.post(
  "/:id/needs",
  requireRole(["admin", "operador", "supervisor"]),
  asyncHandler(async (req, res) => {
    const costCenterId = String(req.params.id);
    const cc = await prisma.costCenter.findUnique({
      where: { id: costCenterId },
      select: { projectId: true },
    });
    if (!cc) return res.status(404).json({ error: "COST_CENTER_NOT_FOUND" });

    const body = z.object({
      date: z.string().datetime().optional(),
      description: z.string().min(2),
      quantity: z.union([z.number(), z.string()]).optional().nullable(),
      unit: z.string().optional().nullable(),
      unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
      hours: z.union([z.number(), z.string()]).optional().nullable(),
      priority: z.enum(["ALTA", "MEDIA", "BAIXA"]).optional(),
      responsible: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    const created = await prisma.workNeed.create({
      data: {
        projectId: cc.projectId,
        costCenterId,
        date: body.date ? new Date(body.date) : new Date(),
        description: body.description,
        quantity: body.quantity != null ? String(body.quantity) : null,
        unit: body.unit || null,
        unitPrice: body.unitPrice != null ? String(body.unitPrice) : null,
        hours: body.hours != null ? String(body.hours) : null,
        priority: body.priority || "MEDIA",
        responsible: body.responsible || null,
        notes: body.notes || null,
      },
      select: { id: true },
    });
    return res.status(201).json({ id: created.id });
  })
);

// PATCH /cost-centers/:id/needs/:needId — Editar necessidade
costCenterRoutes.patch(
  "/:id/needs/:needId",
  requireRole(["admin", "operador", "supervisor"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const body = z.object({
      description: z.string().min(2).optional(),
      quantity: z.union([z.number(), z.string()]).optional().nullable(),
      unit: z.string().optional().nullable(),
      unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
      hours: z.union([z.number(), z.string()]).optional().nullable(),
      priority: z.enum(["ALTA", "MEDIA", "BAIXA"]).optional(),
      status: z.enum(["PENDING", "IN_QUOTATION", "APPROVED", "REJECTED", "PAID"]).optional(),
      responsible: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    const updated = await prisma.workNeed.update({
      where: { id: needId },
      data: {
        ...(body.description ? { description: body.description } : {}),
        ...(body.quantity !== undefined ? { quantity: body.quantity != null ? String(body.quantity) : null } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.unitPrice !== undefined ? { unitPrice: body.unitPrice != null ? String(body.unitPrice) : null } : {}),
        ...(body.hours !== undefined ? { hours: body.hours != null ? String(body.hours) : null } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.responsible !== undefined ? { responsible: body.responsible } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
      select: { id: true },
    });
    return res.json({ id: updated.id });
  })
);

// DELETE /cost-centers/:id/needs/:needId — Eliminar necessidade
costCenterRoutes.delete(
  "/:id/needs/:needId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    await prisma.workNeed.delete({ where: { id: needId } });
    return res.json({ ok: true });
  })
);

// ─── Cronograma de Pagamentos ──────────────────────────────────────────────────

// POST /cost-centers/project/:projectId/needs/schedule-bulk — Marcar múltiplas necessidades como agendadas
costCenterRoutes.post(
  "/project/:projectId/needs/schedule-bulk",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const body = z.object({
      needIds: z.array(z.string()),
    }).parse(req.body);

    await prisma.workNeed.updateMany({
      where: { id: { in: body.needIds }, projectId },
      data: { scheduled: true },
    });

    return res.json({ ok: true });
  })
);

// POST /cost-centers/:ccId/needs/:needId/schedule — Marcar uma necessidade como agendada
costCenterRoutes.post(
  "/:ccId/needs/:needId/schedule",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    await prisma.workNeed.update({
      where: { id: needId },
      data: { scheduled: true },
    });
    return res.json({ ok: true });
  })
);

// POST /cost-centers/:ccId/needs/:needId/generate-installments — Gerar parcelas (CostPayment) para uma necessidade
costCenterRoutes.post(
  "/:ccId/needs/:needId/generate-installments",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const ccId = String(req.params.ccId);
    
    const body = z.object({
      paymentType: z.string().optional().default("PRONTO_PAGAMENTO"),
      installments: z.array(z.object({
        paymentDate: z.string(),
        amount: z.union([z.number(), z.string()]),
        installment: z.number().int().min(1),
      })),
    }).parse(req.body);

    const need = await prisma.workNeed.findUnique({
      where: { id: needId },
      include: { 
        costCenter: true,
        quotes: {
          where: { selected: true },
          include: { supplier: true }
        }
      },
    });
    if (!need) return res.status(404).json({ error: "NEED_NOT_FOUND" });

    let supplierName = null;
    if (need.quotes && need.quotes.length > 0 && need.quotes[0].supplier) {
      supplierName = need.quotes[0].supplier.name;
    }

    // Create the installments
    const createdPayments = [];
    for (const inst of body.installments) {
      const payment = await prisma.costPayment.create({
        data: {
          projectId: need.projectId,
          costCenterId: ccId,
          needId,
          docNumber: null,
          paymentDate: new Date(inst.paymentDate),
          supplier: supplierName,
          category: "OUTRO",
          description: `Parcela ${inst.installment} - ${need.description}`,
          budgetedAmount: String(inst.amount),
          paidAmount: "0",
          paymentMethod: null,
          paymentType: body.paymentType,
          week: null,
          installment: inst.installment,
          status: "PENDENTE",
          notes: null,
        },
      });
      createdPayments.push(payment);
    }

    // Scheduling creates pending payments; it should not mark the need as paid.
    await prisma.workNeed.update({
      where: { id: needId },
      data: { status: "APPROVED", scheduled: true },
    });

    return res.json({ ok: true, payments: createdPayments.map(p => p.id) });
  })
);

// ─── Lançamentos de Pagamento ─────────────────────────────────────────────────

// GET /cost-centers/project/:projectId/payments — Listar TODOS os lançamentos da obra
costCenterRoutes.get(
  "/project/:projectId/payments",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const ccId = req.query.costCenterId ? String(req.query.costCenterId) : "";
    const status = req.query.status ? String(req.query.status) : "";
    const week = req.query.week ? String(req.query.week) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const where = {
      projectId,
      ...(ccId ? { costCenterId: ccId } : {}),
      ...(status ? { status } : {}),
      ...(week ? { week } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.costPayment.count({ where }),
      prisma.costPayment.findMany({
        where,
        orderBy: { paymentDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          costCenter: { select: { code: true, name: true, currency: true } },
          need: { 
            select: { 
              description: true,
              quotes: {
                where: { selected: true },
                select: { proformaUrl: true }
              }
            } 
          },
        },
      }),
    ]);

    const supplierNames = [...new Set(items.map((p) => p.supplier).filter(Boolean))];
    const supplierMap = {};
    if (supplierNames.length > 0) {
      const suppliers = await prisma.supplier.findMany({
        where: { name: { in: supplierNames } },
        select: { name: true, nif: true, iban: true },
      });
      suppliers.forEach((s) => {
        supplierMap[s.name] = s;
      });
    }

    return res.json({
      page, pageSize, total,
      items: items.map((p) => {
        const sup = supplierMap[p.supplier] || {};
        let proformaUrl = null;
        if (p.need && p.need.quotes && p.need.quotes.length > 0) {
          proformaUrl = p.need.quotes[0].proformaUrl;
        }

        return {
          ...p,
          nif: sup.nif || null,
          iban: sup.iban || null,
          proformaUrl: proformaUrl,
          budgetedAmount: String(p.budgetedAmount),
          paidAmount: String(p.paidAmount),
        };
      }),
    });
  })
);

// POST /cost-centers/:id/payments — Criar lançamento
costCenterRoutes.post(
  "/:id/payments",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const costCenterId = String(req.params.id);
    const cc = await prisma.costCenter.findUnique({
      where: { id: costCenterId },
      select: { projectId: true },
    });
    if (!cc) return res.status(404).json({ error: "COST_CENTER_NOT_FOUND" });

    const body = z.object({
      docNumber: z.string().optional().nullable(),
      paymentDate: z.string().datetime(),
      supplier: z.string().optional().nullable(),
      category: z.enum(["MATERIAL", "SERVICO", "MAO_DE_OBRA", "EQUIPAMENTO", "TRANSPORTE", "ADMINISTRATIVO", "OUTRO"]).optional(),
      description: z.string().min(2),
      budgetedAmount: z.union([z.number(), z.string()]),
      paidAmount: z.union([z.number(), z.string()]),
      paymentMethod: z.string().optional().nullable(),
      paymentType: z.string().optional().default("PRONTO_PAGAMENTO"),
      week: z.string().optional().nullable(),
      status: z.enum(["PENDENTE", "CONFIRMADO", "CANCELADO"]).optional(),
      needId: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    const created = await prisma.costPayment.create({
      data: {
        projectId: cc.projectId,
        costCenterId,
        docNumber: body.docNumber || null,
        paymentDate: new Date(body.paymentDate),
        supplier: body.supplier || null,
        category: body.category || "MATERIAL",
        description: body.description,
        budgetedAmount: String(body.budgetedAmount),
        paidAmount: String(body.paidAmount),
        paymentMethod: body.paymentMethod || null,
        paymentType: body.paymentType,
        week: body.week || null,
        status: body.status || "PENDENTE",
        needId: body.needId || null,
        notes: body.notes || null,
      },
      select: { id: true },
    });
    return res.status(201).json({ id: created.id });
  })
);

// PATCH /cost-centers/:id/payments/:payId — Editar lançamento
costCenterRoutes.patch(
  "/:id/payments/:payId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const payId = String(req.params.payId);
    const body = z.object({
      docNumber: z.string().optional().nullable(),
      paymentDate: z.string().datetime().optional(),
      supplier: z.string().optional().nullable(),
      category: z.enum(["MATERIAL", "SERVICO", "MAO_DE_OBRA", "EQUIPAMENTO", "TRANSPORTE", "ADMINISTRATIVO", "OUTRO"]).optional(),
      description: z.string().min(2).optional(),
      budgetedAmount: z.union([z.number(), z.string()]).optional(),
      paidAmount: z.union([z.number(), z.string()]).optional(),
      paymentMethod: z.string().optional().nullable(),
      paymentType: z.string().optional(),
      week: z.string().optional().nullable(),
      status: z.enum(["PENDENTE", "CONFIRMADO", "CANCELADO"]).optional(),
      needId: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    const updated = await prisma.costPayment.update({
      where: { id: payId },
      data: {
        ...(body.docNumber !== undefined ? { docNumber: body.docNumber } : {}),
        ...(body.paymentDate ? { paymentDate: new Date(body.paymentDate) } : {}),
        ...(body.supplier !== undefined ? { supplier: body.supplier } : {}),
        ...(body.category ? { category: body.category } : {}),
        ...(body.description ? { description: body.description } : {}),
        ...(body.budgetedAmount !== undefined ? { budgetedAmount: String(body.budgetedAmount) } : {}),
        ...(body.paidAmount !== undefined ? { paidAmount: String(body.paidAmount) } : {}),
        ...(body.paymentMethod !== undefined ? { paymentMethod: body.paymentMethod } : {}),
        ...(body.paymentType !== undefined ? { paymentType: body.paymentType } : {}),
        ...(body.week !== undefined ? { week: body.week } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.needId !== undefined ? { needId: body.needId } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
      select: { id: true },
    });
    return res.json({ id: updated.id });
  })
);

// DELETE /cost-centers/:id/payments/:payId — Eliminar lançamento
costCenterRoutes.delete(
  "/:id/payments/:payId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const payId = String(req.params.payId);
    await prisma.costPayment.delete({ where: { id: payId } });
    return res.json({ ok: true });
  })
);

// ─── Dashboard: Pagamentos por Semana ────────────────────────────────────────

// GET /cost-centers/project/:projectId/weekly-summary — Agrupamento por semana
costCenterRoutes.get(
  "/project/:projectId/weekly-summary",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);

    const payments = await prisma.costPayment.findMany({
      where: { projectId, week: { not: null } },
      select: {
        week: true,
        paidAmount: true,
        costCenter: { select: { currency: true } },
      },
    });

    const weekMap = {};
    payments.forEach((p) => {
      const w = p.week;
      if (!weekMap[w]) weekMap[w] = { week: w, paid: 0, currency: p.costCenter?.currency || "AOA" };
      weekMap[w].paid += Number(p.paidAmount || 0);
    });

    const weekOrder = ["SEM 0","SEM 1","SEM 2","SEM 3","SEM 4","SEM 5","SEM 6","SEM 7","SEM 8","SEM 9","SEM 10"];
    const weeks = weekOrder.filter((w) => weekMap[w]).map((w) => weekMap[w]);

    return res.json({ weeks });
  })
);

// GET /cost-centers/project/:projectId/top-expenses — Top N maiores despesas confirmadas
costCenterRoutes.get(
  "/project/:projectId/top-expenses",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 5)));

    const items = await prisma.costPayment.findMany({
      where: { projectId, status: "CONFIRMADO" },
      orderBy: { paidAmount: "desc" },
      take: limit,
      include: {
        costCenter: { select: { code: true, name: true, currency: true } },
      },
    });

    return res.json({
      items: items.map((p) => ({
        ...p,
        budgetedAmount: String(p.budgetedAmount),
        paidAmount: String(p.paidAmount),
      })),
    });
  })
);

module.exports = { costCenterRoutes };


