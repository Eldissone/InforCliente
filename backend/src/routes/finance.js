const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const financeRoutes = express.Router();

financeRoutes.use(authRequired);

const view = requirePermission("financeiro", "view");
const edit = requirePermission("financeiro", "edit");
const approve = requirePermission("financeiro", "approve");

// ─── Utilitários ────────────────────────────────────────────────────────────

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseOptionalDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Estado derivado da fatura (Em Aberto, Pago-Parcial, Pago-Total, Atrasado). */
function invoiceDerivedStatus(invoice) {
  const net = toNumber(invoice.netAmount ?? invoice.grossAmount);
  const received = toNumber(invoice.receivedAmount);
  if (net > 0 && received >= net - 0.005) return "PAGO_TOTAL";
  const overdue = invoice.dueDate && new Date(invoice.dueDate) < startOfToday();
  if (overdue && received < net - 0.005) return "ATRASADO";
  if (received > 0) return "PAGO_PARCIAL";
  return "EM_ABERTO";
}

function mapInvoice(invoice) {
  const net = toNumber(invoice.netAmount ?? invoice.grossAmount);
  const received = toNumber(invoice.receivedAmount);
  return {
    ...invoice,
    grossAmount: toNumber(invoice.grossAmount),
    withholdingAmount: toNumber(invoice.withholdingAmount),
    vatAmount: toNumber(invoice.vatAmount),
    carInsuranceAmount: toNumber(invoice.carInsuranceAmount),
    guaranteeAmount: toNumber(invoice.guaranteeAmount),
    netAmount: net,
    workPercent: invoice.workPercent === null ? null : toNumber(invoice.workPercent),
    receivedAmount: received,
    missingAmount: round2(net - received),
    status: invoiceDerivedStatus(invoice),
  };
}

/**
 * Cálculo automático dos valores da fatura a partir do V. Ilíquido e da
 * configuração de faturação da obra. O IVA cativo não é somado ao líquido.
 */
function computeInvoiceAmounts(raw, config = {}) {
  const gross = round2(raw.grossAmount);
  const isVatCativo = raw.flagVatCativo ?? Boolean(config.billingVatCativo);
  const vatPercent = raw.vatPercent ?? toNumber(config.billingVatPercent);
  const withholdingPercent = raw.withholdingPercent ?? toNumber(config.billingWithholdingPercent);
  const carPercent = raw.carPercent ?? toNumber(config.billingCarPercent);
  const guaranteePercent = raw.guaranteePercent ?? toNumber(config.billingGuaranteePercent);

  const vatAmount = isVatCativo ? 0 : round2((gross * vatPercent) / 100);
  const withholdingAmount = round2((gross * withholdingPercent) / 100);
  const carInsuranceAmount = round2((gross * carPercent) / 100);
  const guaranteeAmount = round2((gross * guaranteePercent) / 100);
  const netAmount = round2(gross + vatAmount - withholdingAmount - carInsuranceAmount - guaranteeAmount);

  return {
    grossAmount: gross,
    vatAmount,
    withholdingAmount,
    carInsuranceAmount,
    guaranteeAmount,
    netAmount,
    flagVatCativo: isVatCativo,
    flagRetention: withholdingPercent > 0,
    flagCar: carPercent > 0,
    flagGuarantee: guaranteePercent > 0,
  };
}

// ─── Opções (listas de apoio aos ecrãs) ──────────────────────────────────────

financeRoutes.get(
  "/options/projects",
  view,
  asyncHandler(async (_req, res) => {
    const projects = await prisma.project.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        budgetTotal: true,
        clientId: true,
        client: { select: { id: true, code: true, name: true } },
      },
      orderBy: { name: "asc" },
    });
    return res.json({
      items: projects.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        currency: p.currency,
        budgetTotal: toNumber(p.budgetTotal),
        clientId: p.clientId,
        clientName: p.client?.name || null,
      })),
    });
  })
);

financeRoutes.get(
  "/options/clients",
  view,
  asyncHandler(async (_req, res) => {
    const clients = await prisma.client.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });
    return res.json({ items: clients });
  })
);

// ─── Configuração de faturação da obra ───────────────────────────────────────

financeRoutes.get(
  "/projects/:id/billing",
  view,
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        budgetTotal: true,
        clientId: true,
        billingVatCativo: true,
        billingVatPercent: true,
        billingWithholdingPercent: true,
        billingCarPercent: true,
        billingGuaranteePercent: true,
        client: { select: { id: true, name: true, code: true } },
      },
    });
    if (!project) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    return res.json({ project });
  })
);

financeRoutes.patch(
  "/projects/:id/billing",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        billingVatCativo: z.boolean().optional(),
        billingVatPercent: z.number().min(0).max(100).nullable().optional(),
        billingWithholdingPercent: z.number().min(0).max(100).nullable().optional(),
        billingCarPercent: z.number().min(0).max(100).nullable().optional(),
        billingGuaranteePercent: z.number().min(0).max(100).nullable().optional(),
      })
      .parse(req.body);

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: body,
    });
    return res.json({ project });
  })
);

/** Autos de medição em aberto para faturação (sem fatura associada). */
financeRoutes.get(
  "/projects/:id/open-measurements",
  view,
  asyncHandler(async (req, res) => {
    const reports = await prisma.measurementReport.findMany({
      where: { projectId: req.params.id, status: "APPROVED", invoices: { none: {} } },
      orderBy: { reportDate: "asc" },
    });
    return res.json({
      items: reports.map((r) => ({
        id: r.id,
        reportNumber: r.reportNumber,
        reportDate: r.reportDate,
        periodValTotal: toNumber(r.periodValTotal),
      })),
    });
  })
);

// ─── Faturas ────────────────────────────────────────────────────────────────

financeRoutes.get(
  "/invoices",
  view,
  asyncHandler(async (req, res) => {
    const { month, status, clientId, projectId } = req.query;
    const where = {};
    if (projectId) where.projectId = String(projectId);
    if (clientId) where.clientId = String(clientId);
    if (month) {
      const [y, m] = String(month).split("-").map(Number);
      if (y && m) {
        where.docDate = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
      }
    }

    const rows = await prisma.invoice.findMany({
      where,
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    });

    const items = rows.map(mapInvoice);
    const filtered = status ? items.filter((i) => i.status === status) : items;

    const totals = filtered.reduce(
      (acc, i) => {
        acc.gross += i.grossAmount;
        acc.vat += i.vatAmount;
        acc.withholding += i.withholdingAmount;
        acc.car += i.carInsuranceAmount;
        acc.guarantee += i.guaranteeAmount;
        acc.net += i.netAmount;
        acc.received += i.receivedAmount;
        acc.missing += i.missingAmount;
        return acc;
      },
      { gross: 0, vat: 0, withholding: 0, car: 0, guarantee: 0, net: 0, received: 0, missing: 0 }
    );
    Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));

    return res.json({ items: filtered, totals });
  })
);

financeRoutes.post(
  "/invoices",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        clientId: z.string().nullable().optional(),
        measurementId: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
        docDate: z.string(),
        dueDate: z.string().nullable().optional(),
        grossAmount: z.number().positive(),
        vatPercent: z.number().min(0).max(100).nullable().optional(),
        withholdingPercent: z.number().min(0).max(100).nullable().optional(),
        carPercent: z.number().min(0).max(100).nullable().optional(),
        guaranteePercent: z.number().min(0).max(100).nullable().optional(),
        flagVatCativo: z.boolean().optional(),
        receivedAmount: z.number().min(0).optional(),
        receivedDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(req.body);

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: {
        id: true,
        clientId: true,
        budgetTotal: true,
        billingVatCativo: true,
        billingVatPercent: true,
        billingWithholdingPercent: true,
        billingCarPercent: true,
        billingGuaranteePercent: true,
      },
    });
    if (!project) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });

    const amounts = computeInvoiceAmounts(body, project);

    // % Obra = valor ilíquido faturado / valor total da obra.
    const budgetTotal = toNumber(project.budgetTotal);
    const workPercent = budgetTotal > 0 ? round2((amounts.grossAmount / budgetTotal) * 100) : null;

    const receivedAmount = round2(body.receivedAmount || 0);

    const invoice = await prisma.invoice.create({
      data: {
        projectId: body.projectId,
        clientId: body.clientId ?? project.clientId ?? null,
        measurementId: body.measurementId || null,
        docNumber: body.docNumber || null,
        docDate: new Date(body.docDate),
        dueDate: parseOptionalDate(body.dueDate),
        grossAmount: amounts.grossAmount,
        vatAmount: amounts.vatAmount,
        withholdingAmount: amounts.withholdingAmount,
        carInsuranceAmount: amounts.carInsuranceAmount,
        guaranteeAmount: amounts.guaranteeAmount,
        netAmount: amounts.netAmount,
        workPercent,
        flagVatCativo: amounts.flagVatCativo,
        flagRetention: amounts.flagRetention,
        flagCar: amounts.flagCar,
        flagGuarantee: amounts.flagGuarantee,
        status: "EM_ABERTO",
        receivedAmount,
        receivedDate: parseOptionalDate(body.receivedDate),
        notes: body.notes || null,
        createdBy: req.user?.name || req.user?.email || null,
      },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
    });

    if (receivedAmount > 0) {
      await prisma.invoiceReceipt.create({
        data: {
          invoiceId: invoice.id,
          amount: receivedAmount,
          receivedDate: parseOptionalDate(body.receivedDate) || new Date(),
          createdBy: req.user?.name || req.user?.email || null,
        },
      });
    }

    return res.status(201).json({ invoice: mapInvoice(invoice) });
  })
);

financeRoutes.get(
  "/invoices/:id",
  view,
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
        receipts: { orderBy: { receivedDate: "desc" } },
      },
    });
    if (!invoice) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
    return res.json({ invoice: mapInvoice(invoice) });
  })
);

financeRoutes.patch(
  "/invoices/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        clientId: z.string().nullable().optional(),
        measurementId: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
        docDate: z.string().optional(),
        dueDate: z.string().nullable().optional(),
        grossAmount: z.number().positive().optional(),
        vatPercent: z.number().min(0).max(100).nullable().optional(),
        withholdingPercent: z.number().min(0).max(100).nullable().optional(),
        carPercent: z.number().min(0).max(100).nullable().optional(),
        guaranteePercent: z.number().min(0).max(100).nullable().optional(),
        flagVatCativo: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(req.body);

    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });

    const project = await prisma.project.findUnique({
      where: { id: existing.projectId },
      select: {
        budgetTotal: true,
        billingVatCativo: true,
        billingVatPercent: true,
        billingWithholdingPercent: true,
        billingCarPercent: true,
        billingGuaranteePercent: true,
      },
    });

    // Percentagem implícita da fatura guardada — preserva as deduções quando
    // apenas o V. Ilíquido é alterado (o cliente só envia as % que mudam).
    const existingBase = toNumber(existing.grossAmount);
    const derivedPct = (amount) =>
      existingBase > 0 ? round2((toNumber(amount) / existingBase) * 100) : null;

    const amounts = computeInvoiceAmounts(
      {
        grossAmount: body.grossAmount ?? existingBase,
        vatPercent: body.vatPercent ?? derivedPct(existing.vatAmount),
        withholdingPercent: body.withholdingPercent ?? derivedPct(existing.withholdingAmount),
        carPercent: body.carPercent ?? derivedPct(existing.carInsuranceAmount),
        guaranteePercent: body.guaranteePercent ?? derivedPct(existing.guaranteeAmount),
        flagVatCativo: body.flagVatCativo ?? existing.flagVatCativo,
      },
      project || {}
    );

    const budgetTotal = toNumber(project?.budgetTotal);
    const workPercent = budgetTotal > 0 ? round2((amounts.grossAmount / budgetTotal) * 100) : null;

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
        ...(body.measurementId !== undefined ? { measurementId: body.measurementId } : {}),
        ...(body.docNumber !== undefined ? { docNumber: body.docNumber } : {}),
        ...(body.docDate ? { docDate: new Date(body.docDate) } : {}),
        ...(body.dueDate !== undefined ? { dueDate: parseOptionalDate(body.dueDate) } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        grossAmount: amounts.grossAmount,
        vatAmount: amounts.vatAmount,
        withholdingAmount: amounts.withholdingAmount,
        carInsuranceAmount: amounts.carInsuranceAmount,
        guaranteeAmount: amounts.guaranteeAmount,
        netAmount: amounts.netAmount,
        workPercent,
        flagVatCativo: amounts.flagVatCativo,
        flagRetention: amounts.flagRetention,
        flagCar: amounts.flagCar,
        flagGuarantee: amounts.flagGuarantee,
      },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
    });
    return res.json({ invoice: mapInvoice(invoice) });
  })
);

financeRoutes.delete(
  "/invoices/:id",
  edit,
  asyncHandler(async (req, res) => {
    await prisma.invoice.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  })
);

/** Regista um recebimento e recalcula o valor recebido/em falta. */
financeRoutes.post(
  "/invoices/:id/receipts",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        amount: z.number().positive(),
        receivedDate: z.string(),
        method: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(req.body);

    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });

    const receivedAmount = round2(toNumber(invoice.receivedAmount) + body.amount);
    const net = toNumber(invoice.netAmount ?? invoice.grossAmount);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoiceReceipt.create({
        data: {
          invoiceId: invoice.id,
          amount: round2(body.amount),
          receivedDate: new Date(body.receivedDate),
          method: body.method || null,
          notes: body.notes || null,
          createdBy: req.user?.name || req.user?.email || null,
        },
      });
      return tx.invoice.update({
        where: { id: invoice.id },
        data: {
          receivedAmount,
          receivedDate: new Date(body.receivedDate),
          status: net > 0 && receivedAmount >= net - 0.005 ? "PAGO_TOTAL" : "PAGO_PARCIAL",
        },
        include: {
          project: { select: { id: true, code: true, name: true, currency: true } },
          client: { select: { id: true, name: true, code: true } },
          measurement: { select: { id: true, reportNumber: true, reportDate: true } },
        },
      });
    });

    return res.status(201).json({ invoice: mapInvoice(updated) });
  })
);

// ─── Faturação prevista / resumos ────────────────────────────────────────────

financeRoutes.get(
  "/billing-forecast",
  view,
  asyncHandler(async (req, res) => {
    const { projectId, clientId } = req.query;
    const projectWhere = {};
    if (projectId) projectWhere.id = String(projectId);
    if (clientId) projectWhere.clientId = String(clientId);

    const projects = await prisma.project.findMany({
      where: projectWhere,
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        budgetTotal: true,
        client: { select: { id: true, name: true, code: true } },
      },
      orderBy: { name: "asc" },
    });

    const projectIds = projects.map((p) => p.id);
    const invoices = await prisma.invoice.findMany({
      where: projectIds.length ? { projectId: { in: projectIds } } : {},
      include: { measurement: { select: { reportNumber: true, reportDate: true } } },
    });

    const byProject = projects.map((project) => {
      const list = invoices.filter((i) => i.projectId === project.id).map(mapInvoice);
      const billed = round2(list.reduce((a, i) => a + i.grossAmount, 0));
      const forecast = toNumber(project.budgetTotal);
      return {
        project,
        forecast: round2(forecast),
        billed,
        toBill: round2(Math.max(forecast - billed, 0)),
        rows: list,
      };
    });

    const byClientMap = new Map();
    byProject.forEach((entry) => {
      const key = entry.project.client?.id || "__sem_cliente__";
      if (!byClientMap.has(key)) {
        byClientMap.set(key, {
          client: entry.project.client || { id: null, name: "Sem cliente" },
          forecast: 0,
          billed: 0,
        });
      }
      const bucket = byClientMap.get(key);
      bucket.forecast = round2(bucket.forecast + entry.forecast);
      bucket.billed = round2(bucket.billed + entry.billed);
    });

    const totals = byProject.reduce(
      (acc, e) => {
        acc.forecast += e.forecast;
        acc.billed += e.billed;
        acc.toBill += e.toBill;
        return acc;
      },
      { forecast: 0, billed: 0, toBill: 0 }
    );
    Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));

    return res.json({ byProject, byClient: [...byClientMap.values()], totals });
  })
);

financeRoutes.get(
  "/billing-summary",
  view,
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const where = projectId ? { id: String(projectId) } : {};
    const projects = await prisma.project.findMany({
      where,
      select: { id: true, code: true, name: true, currency: true, budgetTotal: true },
      orderBy: { name: "asc" },
    });

    const result = [];
    for (const project of projects) {
      const [reports, invoices] = await Promise.all([
        prisma.measurementReport.findMany({
          where: { projectId: project.id },
          select: { id: true, status: true, periodValTotal: true, invoices: { select: { id: true } } },
        }),
        prisma.invoice.findMany({
          where: { projectId: project.id },
          select: { grossAmount: true },
        }),
      ]);

      const withAm = reports.filter((r) => r.invoices.length > 0);
      const withoutAm = reports.filter((r) => r.invoices.length === 0);
      const billedValue = round2(invoices.reduce((a, i) => a + toNumber(i.grossAmount), 0));
      const budgetTotal = toNumber(project.budgetTotal);
      const executedPct = budgetTotal > 0 ? round2((billedValue / budgetTotal) * 100) : 0;

      result.push({
        project,
        withAmCount: withAm.length,
        withAmValue: round2(withAm.reduce((a, r) => a + toNumber(r.periodValTotal), 0)),
        withoutAmCount: withoutAm.length,
        withoutAmValue: round2(withoutAm.reduce((a, r) => a + toNumber(r.periodValTotal), 0)),
        executedPct,
        remainingPct: round2(Math.max(100 - executedPct, 0)),
      });
    }

    return res.json({ items: result });
  })
);

// ─── Custos ─────────────────────────────────────────────────────────────────

financeRoutes.get(
  "/costs",
  view,
  asyncHandler(async (req, res) => {
    const { projectId, status, sourceType } = req.query;
    const where = {};
    if (projectId) where.projectId = String(projectId);
    if (status) where.confirmationStatus = String(status);
    if (sourceType) where.sourceType = String(sourceType);

    const rows = await prisma.costPayment.findMany({
      where,
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
        costCenter: { select: { id: true, code: true, name: true } },
        supplierRef: { select: { id: true, name: true, nif: true } },
      },
      orderBy: [{ paymentDate: "desc" }],
      take: 500,
    });

    const totals = rows.reduce(
      (acc, r) => {
        const paid = toNumber(r.paidAmount);
        acc.paid += paid;
        if (r.confirmationStatus === "CONFIRMADO") acc.confirmed += paid;
        else acc.pending += paid;
        return acc;
      },
      { paid: 0, confirmed: 0, pending: 0 }
    );
    Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));

    return res.json({ items: rows, totals });
  })
);

financeRoutes.patch(
  "/costs/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        docNumber: z.string().nullable().optional(),
        responsible: z.string().nullable().optional(),
        confirmationStatus: z.enum(["POR_CONFIRMAR", "CONFIRMADO"]).optional(),
      })
      .parse(req.body);

    const data = { ...body };
    if (body.confirmationStatus === "CONFIRMADO") data.confirmedAt = new Date();

    const cost = await prisma.costPayment.update({ where: { id: req.params.id }, data });
    return res.json({ cost });
  })
);

financeRoutes.post(
  "/costs/:id/confirm",
  approve,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        responsible: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
      })
      .parse(req.body || {});

    const cost = await prisma.costPayment.update({
      where: { id: req.params.id },
      data: {
        confirmationStatus: "CONFIRMADO",
        confirmedAt: new Date(),
        ...(body.responsible !== undefined ? { responsible: body.responsible } : {}),
        ...(body.docNumber !== undefined ? { docNumber: body.docNumber } : {}),
      },
    });
    return res.json({ cost });
  })
);

financeRoutes.get(
  "/costs-overview",
  view,
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        budgetTotal: true,
        budgetConsumed: true,
        budgetCommitted: true,
        budgetAvailable: true,
      },
      orderBy: { name: "asc" },
    });

    const grouped = await prisma.costPayment.groupBy({
      by: ["projectId", "confirmationStatus"],
      _sum: { paidAmount: true },
    });

    const items = projects.map((project) => {
      const rows = grouped.filter((g) => g.projectId === project.id);
      const realized = round2(rows.reduce((a, r) => a + toNumber(r._sum.paidAmount), 0));
      const confirmed = round2(
        rows.filter((r) => r.confirmationStatus === "CONFIRMADO").reduce((a, r) => a + toNumber(r._sum.paidAmount), 0)
      );
      const pending = round2(realized - confirmed);
      const forecast = toNumber(project.budgetTotal);
      return {
        project,
        forecast,
        committed: toNumber(project.budgetCommitted),
        realized,
        confirmed,
        pending,
        deviation: round2(realized - forecast),
        deviationPct: forecast > 0 ? round2(((realized - forecast) / forecast) * 100) : 0,
      };
    });

    return res.json({ items });
  })
);

// ─── Contas a pagar / receber ────────────────────────────────────────────────

financeRoutes.get(
  "/payables",
  view,
  asyncHandler(async (req, res) => {
    const rows = await prisma.costPayment.findMany({
      where: { status: { in: ["PENDENTE", "EM_ESPERA"] } },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
        costCenter: { select: { id: true, code: true, name: true } },
        supplierRef: { select: { id: true, name: true, nif: true } },
      },
      orderBy: [{ paymentDate: "asc" }],
      take: 500,
    });
    const total = round2(rows.reduce((a, r) => a + toNumber(r.budgetedAmount), 0));
    return res.json({ items: rows, total });
  })
);

financeRoutes.get(
  "/receivables",
  view,
  asyncHandler(async (req, res) => {
    const rows = await prisma.invoice.findMany({
      where: { status: { in: ["EM_ABERTO", "PAGO_PARCIAL", "ATRASADO"] } },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
        client: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ dueDate: "asc" }],
      take: 500,
    });
    const items = rows.map(mapInvoice);
    const total = round2(items.reduce((a, i) => a + i.missingAmount, 0));
    return res.json({ items, total });
  })
);

// ─── Tesouraria: extratos e movimentos ───────────────────────────────────────

financeRoutes.get(
  "/bank-statements",
  view,
  asyncHandler(async (req, res) => {
    const statements = await prisma.bankStatement.findMany({
      include: {
        card: { select: { id: true, label: true, lastDigits: true, bank: true } },
        _count: { select: { movements: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return res.json({ items: statements });
  })
);

financeRoutes.post(
  "/bank-statements",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        cardId: z.string().nullable().optional(),
        name: z.string().min(1),
        periodStart: z.string().nullable().optional(),
        periodEnd: z.string().nullable().optional(),
        fileName: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        movements: z
          .array(
            z.object({
              projectId: z.string().nullable().optional(),
              docNumber: z.string().nullable().optional(),
              docType: z.enum(["FATURA", "AF"]).nullable().optional(),
              supplierId: z.string().nullable().optional(),
              movementType: z
                .enum([
                  "TRANSFERENCIA_INTERNA",
                  "PF",
                  "REEMBOLSO",
                  "OPERACAO_ANULADA",
                  "RECEBIMENTO_CLIENTE",
                  "LEVANTAMENTO_ATM",
                  "OUTRO",
                ])
                .optional(),
              costCategoryId: z.string().nullable().optional(),
              subcategoryId: z.string().nullable().optional(),
              direction: z.enum(["ENTRADA", "SAIDA"]),
              amount: z.number(),
              movementDate: z.string(),
              description: z.string().nullable().optional(),
              isMerchandise: z.boolean().optional(),
            })
          )
          .optional(),
      })
      .parse(req.body);

    const statement = await prisma.bankStatement.create({
      data: {
        cardId: body.cardId || null,
        name: body.name,
        periodStart: parseOptionalDate(body.periodStart),
        periodEnd: parseOptionalDate(body.periodEnd),
        fileName: body.fileName || null,
        notes: body.notes || null,
        createdBy: req.user?.name || req.user?.email || null,
        movements: {
          create: (body.movements || []).map((m) => ({
            cardId: body.cardId || null,
            projectId: m.projectId || null,
            docNumber: m.docNumber || null,
            docType: m.docType || null,
            supplierId: m.supplierId || null,
            movementType: m.movementType || "OUTRO",
            costCategoryId: m.costCategoryId || null,
            subcategoryId: m.subcategoryId || null,
            direction: m.direction,
            amount: round2(m.amount),
            movementDate: new Date(m.movementDate),
            description: m.description || null,
            isMerchandise: Boolean(m.isMerchandise),
          })),
        },
      },
      include: { movements: true },
    });

    return res.status(201).json({ statement });
  })
);

financeRoutes.get(
  "/bank-statements/:id",
  view,
  asyncHandler(async (req, res) => {
    const statement = await prisma.bankStatement.findUnique({
      where: { id: req.params.id },
      include: {
        card: { select: { id: true, label: true, lastDigits: true, bank: true } },
        movements: {
          include: {
            project: { select: { id: true, code: true, name: true } },
            supplier: { select: { id: true, name: true, nif: true } },
          },
          orderBy: { movementDate: "asc" },
        },
      },
    });
    if (!statement) return res.status(404).json({ error: "STATEMENT_NOT_FOUND" });
    return res.json({ statement });
  })
);

financeRoutes.get(
  "/bank-movements",
  view,
  asyncHandler(async (req, res) => {
    const { movementType, projectId, costAssigned } = req.query;
    const where = {};
    if (movementType) where.movementType = String(movementType);
    if (projectId) where.projectId = String(projectId);
    if (costAssigned === "true") where.costAssigned = true;
    if (costAssigned === "false") where.costAssigned = false;

    const items = await prisma.bankMovement.findMany({
      where,
      include: {
        project: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, name: true, nif: true } },
        card: { select: { id: true, label: true, lastDigits: true } },
      },
      orderBy: [{ movementDate: "desc" }],
      take: 500,
    });
    return res.json({ items });
  })
);

financeRoutes.patch(
  "/bank-movements/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
        docType: z.enum(["FATURA", "AF"]).nullable().optional(),
        supplierId: z.string().nullable().optional(),
        movementType: z
          .enum([
            "TRANSFERENCIA_INTERNA",
            "PF",
            "REEMBOLSO",
            "OPERACAO_ANULADA",
            "RECEBIMENTO_CLIENTE",
            "LEVANTAMENTO_ATM",
            "OUTRO",
          ])
          .optional(),
        costCategoryId: z.string().nullable().optional(),
        subcategoryId: z.string().nullable().optional(),
        isMerchandise: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(req.body);

    const movement = await prisma.bankMovement.update({ where: { id: req.params.id }, data: body });
    return res.json({ movement });
  })
);

/** "Associar Custo": classifica o produto/tipo/categoria do movimento. */
financeRoutes.post(
  "/bank-movements/:id/assign-cost",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        costCategoryId: z.string().nullable().optional(),
        subcategoryId: z.string().nullable().optional(),
        supplierId: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
        docType: z.enum(["FATURA", "AF"]).nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .parse(req.body || {});

    const existing = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    if (existing.isMerchandise) {
      return res.status(400).json({
        error: "MERCHANDISE_COST_VIA_STOCK",
        message: "Compra de mercadorias: o custo é gerado pela saída de stock, não por associação direta.",
      });
    }

    const movement = await prisma.bankMovement.update({
      where: { id: req.params.id },
      data: { ...body, costAssigned: true },
    });
    return res.json({ movement });
  })
);

// ─── Overview e Controlo Financeiro ──────────────────────────────────────────

financeRoutes.get(
  "/overview",
  view,
  asyncHandler(async (req, res) => {
    const [projects, invoiceRows, costRows] = await Promise.all([
      prisma.project.findMany({
        select: { id: true, code: true, name: true, currency: true, budgetTotal: true },
      }),
      prisma.invoice.findMany({ select: { projectId: true, grossAmount: true, netAmount: true, receivedAmount: true, dueDate: true } }),
      prisma.costPayment.findMany({ select: { projectId: true, paidAmount: true, confirmationStatus: true } }),
    ]);

    const invoiced = invoiceRows.map(mapInvoice);
    const revenue = round2(invoiced.reduce((a, i) => a + i.grossAmount, 0));
    const received = round2(invoiced.reduce((a, i) => a + i.receivedAmount, 0));
    const costRealized = round2(costRows.reduce((a, c) => a + toNumber(c.paidAmount), 0));
    const costPending = round2(
      costRows.filter((c) => c.confirmationStatus === "POR_CONFIRMAR").reduce((a, c) => a + toNumber(c.paidAmount), 0)
    );
    const forecast = round2(projects.reduce((a, p) => a + toNumber(p.budgetTotal), 0));
    const result = round2(revenue - costRealized);
    const margin = revenue > 0 ? round2((result / revenue) * 100) : 0;

    const byProject = projects.map((project) => {
      const inv = invoiced.filter((i) => i.projectId === project.id);
      const pRevenue = round2(inv.reduce((a, i) => a + i.grossAmount, 0));
      const pReceived = round2(inv.reduce((a, i) => a + i.receivedAmount, 0));
      const pCost = round2(
        costRows.filter((c) => c.projectId === project.id).reduce((a, c) => a + toNumber(c.paidAmount), 0)
      );
      return {
        project,
        revenue: pRevenue,
        received: pReceived,
        cost: pCost,
        result: round2(pRevenue - pCost),
        margin: pRevenue > 0 ? round2(((pRevenue - pCost) / pRevenue) * 100) : 0,
        forecast: toNumber(project.budgetTotal),
      };
    });

    const aging = { vencidas: 0, a_vencer: 0 };
    invoiced.forEach((i) => {
      if (i.missingAmount <= 0) return;
      const overdue = i.dueDate && new Date(i.dueDate) < startOfToday();
      if (overdue) aging.vencidas = round2(aging.vencidas + i.missingAmount);
      else aging.a_vencer = round2(aging.a_vencer + i.missingAmount);
    });

    return res.json({
      cards: {
        revenue,
        cost: costRealized,
        costPending,
        result,
        margin,
        forecast,
        received,
        receivables: round2(received === 0 && revenue ? 0 : revenue - received),
      },
      byProject,
      aging,
      cashFlow: {
        inflow: received,
        outflow: costRealized,
        net: round2(received - costRealized),
      },
    });
  })
);

financeRoutes.get(
  "/control",
  view,
  asyncHandler(async (req, res) => {
    const [projects, costRows, invoiceRows] = await Promise.all([
      prisma.project.findMany({
        select: { id: true, code: true, name: true, currency: true, budgetTotal: true },
      }),
      prisma.costPayment.findMany({ select: { projectId: true, paidAmount: true } }),
      prisma.invoice.findMany({ select: { projectId: true, grossAmount: true, receivedAmount: true, dueDate: true, netAmount: true } }),
    ]);

    const invoiced = invoiceRows.map(mapInvoice);
    const totals = { forecastCost: 0, realizedCost: 0, revenue: 0, result: 0 };
    const byProject = projects.map((project) => {
      const forecastCost = toNumber(project.budgetTotal);
      const realizedCost = round2(
        costRows.filter((c) => c.projectId === project.id).reduce((a, c) => a + toNumber(c.paidAmount), 0)
      );
      const revenue = round2(
        invoiced.filter((i) => i.projectId === project.id).reduce((a, i) => a + i.grossAmount, 0)
      );
      const result = round2(revenue - realizedCost);
      totals.forecastCost += forecastCost;
      totals.realizedCost += realizedCost;
      totals.revenue += revenue;
      totals.result += result;
      return {
        project,
        forecastCost,
        realizedCost,
        costDeviation: round2(realizedCost - forecastCost),
        revenue,
        result,
        margin: revenue > 0 ? round2((result / revenue) * 100) : 0,
      };
    });
    Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));
    totals.margin = totals.revenue > 0 ? round2((totals.result / totals.revenue) * 100) : 0;

    const cashFlow = {
      inflow: round2(invoiced.reduce((a, i) => a + i.receivedAmount, 0)),
      outflow: totals.realizedCost,
    };
    cashFlow.net = round2(cashFlow.inflow - cashFlow.outflow);

    return res.json({ totals, byProject, cashFlow });
  })
);

module.exports = { financeRoutes };
