const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase } = require("../utils/storage");
const { createLog } = require("../services/logService");
const { buildInstallmentPlan } = require("../services/creditPaymentService");
const { notifyPaymentBatchCreated } = require("../services/paymentNotificationService");
const multer = require("multer");
const path = require("path");

async function logQuoteAction(req, { action, needId, quoteId, details }) {
  const u = req.user || {};
  await createLog({
    userId: u.sub || u.id || null,
    userName: u.name || null,
    userEmail: u.email || null,
    action,
    module: "quotes",
    status: "success",
    ipAddress: req.ip || null,
    userAgent: String(req.headers["user-agent"] || ""),
    details: { needId, quoteId, ...(details || null) },
  });
}

const fileUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const quoteRoutes = express.Router();
quoteRoutes.use(authRequired);
quoteRoutes.use(requireRole(["admin", "operador"]));

// Listar todos os itens Pendentes / Em Cotação da obra
quoteRoutes.get(
  "/project/:projectId/needs",
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const { status } = req.query;
    
    // Default: mostrar PENDING, IN_QUOTATION e ORDERED (aguardam proforma)
    const statuses = status ? [status] : ["PENDING", "IN_QUOTATION", "ORDERED"];

    const items = await prisma.workNeed.findMany({
      where: {
        projectId,
        status: { in: statuses },
      },
      include: {
        costCenter: { select: { name: true, code: true } },
        quotes: {
          include: {
            supplier: { select: { name: true } },
          },
          orderBy: { quotedPrice: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    
    res.json({ items });
  })
);

// Obter as cotações de um item específico
quoteRoutes.get(
  "/need/:needId",
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const items = await prisma.needQuote.findMany({
      where: { needId },
      include: {
        supplier: {
          select: {
            name: true,
            contact: true,
            nif: true,
            phone: true,
            email: true,
            address: true,
            iban: true,
            paymentTerm: true,
            bankAccounts: {
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            },
          },
        },
        supplierProduct: { select: { name: true, notes: true } },
      },
      orderBy: { quotedPrice: "asc" },
    });
    res.json({ items });
  })
);

// Obter o plano de parcelas (crédito) já gerado para uma necessidade
quoteRoutes.get(
  "/need/:needId/installments",
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const items = await prisma.paymentInstallment.findMany({
      where: { needId },
      orderBy: { number: "asc" },
      include: { costPayment: { select: { status: true, comprovativoUrl: true, faturaUrl: true } } },
    });
    res.json({
      items: items.map((i) => ({
        ...i,
        amount: String(i.amount),
      })),
    });
  })
);

// Criar cotação
quoteRoutes.post(
  "/need/:needId",
  fileUpload.single("proforma"),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const body = z
      .object({
        supplierId: z.string(),
        supplierProductId: z.string().optional().nullable(),
        quotedPrice: z.coerce.number().min(0),
        quantity: z.coerce.number().min(0).optional().nullable(),
        currency: z.string().default("AOA"),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const totalValue = body.quantity ? body.quantity * body.quotedPrice : body.quotedPrice;

    // Upload proforma if exists
    let proformaUrl = null;
    if (req.file) {
      const extension = path.extname(req.file.originalname).toLowerCase();
      const storagePath = `quotes/${needId}/proforma-${Date.now()}${extension}`;
      proformaUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
    }

    const existing = await prisma.needQuote.findFirst({
      where: {
        needId,
        supplierId: body.supplierId,
        supplierProductId: body.supplierProductId ?? null,
        quotedPrice: body.quotedPrice,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      const updated = await prisma.needQuote.update({
        where: { id: existing.id },
        data: {
          quantity: body.quantity,
          totalValue,
          currency: body.currency,
          notes: body.notes,
          ...(proformaUrl ? { proformaUrl } : {}),
        },
      });
      return res.status(200).json(updated);
    }

    // Se é a primeira cotação, mudar o status do need para IN_QUOTATION se estiver PENDING
    const need = await prisma.workNeed.findUnique({ where: { id: needId } });
    if (need && need.status === "PENDING") {
      await prisma.workNeed.update({
        where: { id: needId },
        data: { status: "IN_QUOTATION" }
      });
    }

    const created = await prisma.needQuote.create({
      data: {
        needId,
        supplierId: body.supplierId,
        supplierProductId: body.supplierProductId,
        quotedPrice: body.quotedPrice,
        quantity: body.quantity,
        totalValue,
        currency: body.currency,
        notes: body.notes,
        proformaUrl,
      },
    });

    res.status(201).json(created);
  })
);

// Apagar cotação
quoteRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.needQuote.delete({ where: { id } });
    res.json({ ok: true });
  })
);

// Seleccionar cotação vencedora — apenas marca o fornecedor escolhido.
// NÃO gera encomenda nem altera o estado do item (ver /:id/place-order).
quoteRoutes.patch(
  "/:id/select",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: { need: { select: { id: true, status: true } } },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (quote.need.status === "ORDERED" || quote.need.status === "APPROVED") {
      return res.status(400).json({ error: "NEED_ALREADY_ORDERED" });
    }

    await prisma.needQuote.updateMany({
      where: { needId: quote.needId },
      data: { selected: false },
    });

    const updatedQuote = await prisma.needQuote.update({
      where: { id },
      data: { selected: true },
      include: {
        supplier: { include: { bankAccounts: true } },
        supplierProduct: true,
        need: {
          include: {
            costCenter: { select: { name: true, code: true, currency: true } },
            project: { select: { id: true, name: true, code: true, location: true, region: true } },
          },
        },
      },
    });

    await logQuoteAction(req, {
      action: "quote_select",
      needId: quote.needId,
      quoteId: id,
      details: { supplierId: updatedQuote.supplierId, quotedPrice: String(updatedQuote.quotedPrice) },
    });

    res.json({
      ok: true,
      quote: {
        ...updatedQuote,
        quotedPrice: String(updatedQuote.quotedPrice),
        quantity: updatedQuote.quantity != null ? String(updatedQuote.quantity) : null,
        totalValue: updatedQuote.totalValue != null ? String(updatedQuote.totalValue) : null,
      },
    });
  })
);

// Cancelar a selecção de fornecedor — só permitido antes de encomendar.
quoteRoutes.patch(
  "/:id/deselect",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: { need: { select: { id: true, status: true } } },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (quote.need.status === "ORDERED" || quote.need.status === "APPROVED") {
      return res.status(400).json({ error: "NEED_ALREADY_ORDERED" });
    }

    const updatedQuote = await prisma.needQuote.update({
      where: { id },
      data: { selected: false },
    });

    await logQuoteAction(req, {
      action: "quote_deselect",
      needId: quote.needId,
      quoteId: id,
    });

    res.json({
      ok: true,
      quote: {
        ...updatedQuote,
        quotedPrice: String(updatedQuote.quotedPrice),
        quantity: updatedQuote.quantity != null ? String(updatedQuote.quantity) : null,
        totalValue: updatedQuote.totalValue != null ? String(updatedQuote.totalValue) : null,
      },
    });
  })
);

// Encomendar ao fornecedor seleccionado — só aqui o item passa a ORDERED
// e é atribuído o número sequencial de encomenda (EF001, EF002, ...).
quoteRoutes.patch(
  "/:id/place-order",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: {
        supplier: { include: { bankAccounts: true } },
        supplierProduct: true,
        need: {
          include: {
            costCenter: { select: { name: true, code: true, currency: true } },
            project: { select: { id: true, name: true, code: true, location: true, region: true } },
          },
        },
      },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (!quote.selected) return res.status(400).json({ error: "QUOTE_NOT_SELECTED" });
    if (quote.need.status === "ORDERED" || quote.need.status === "APPROVED") {
      return res.status(400).json({ error: "NEED_ALREADY_ORDERED" });
    }

    let orderNumber = quote.orderNumber;
    if (!orderNumber) {
      const seqResult = await prisma.$queryRawUnsafe(
        `SELECT nextval('"NeedQuote_orderNumber_seq"') AS val`
      );
      orderNumber = Number(seqResult[0].val);
    }

    const updatedQuote = await prisma.needQuote.update({
      where: { id },
      data: { orderNumber },
      include: {
        supplier: { include: { bankAccounts: true } },
        supplierProduct: true,
        need: {
          include: {
            costCenter: { select: { name: true, code: true, currency: true } },
            project: { select: { id: true, name: true, code: true, location: true, region: true } },
          },
        },
      },
    });

    const updatedNeed = await prisma.workNeed.update({
      where: { id: quote.needId },
      data: {
        status: "ORDERED",
      },
      include: {
        costCenter: { select: { name: true, code: true, currency: true } },
        project: { select: { id: true, name: true, code: true, location: true, region: true } },
      },
    });

    await logQuoteAction(req, {
      action: "quote_place_order",
      needId: quote.needId,
      quoteId: id,
      details: { orderNumber, supplierId: updatedQuote.supplierId },
    });

    res.json({
      ok: true,
      quote: {
        ...updatedQuote,
        quotedPrice: String(updatedQuote.quotedPrice),
        quantity: updatedQuote.quantity != null ? String(updatedQuote.quantity) : null,
        totalValue: updatedQuote.totalValue != null ? String(updatedQuote.totalValue) : null,
      },
      need: {
        ...updatedNeed,
        quantity: updatedNeed.quantity != null ? String(updatedNeed.quantity) : null,
        unitPrice: updatedNeed.unitPrice != null ? String(updatedNeed.unitPrice) : null,
      },
    });
  })
);

// Confirmar a fatura de uma encomenda a crédito — só a partir daqui o prazo de
// crédito começa a contar e o plano de parcelas é gerado automaticamente.
quoteRoutes.patch(
  "/:id/confirm-invoice",
  requirePermission("financeiro", "confirm_invoice"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        creditTermDays: z.coerce.number().int().min(0).optional().nullable(),
        expectedReceiptDate: z.string(),
        installmentsCount: z.coerce.number().int().min(1).max(60),
      })
      .parse(req.body);

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: {
        supplier: true,
        need: { select: { id: true, status: true, description: true, projectId: true, costCenterId: true } },
      },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (!quote.selected) return res.status(400).json({ error: "QUOTE_NOT_SELECTED" });
    if (!["ORDERED", "APPROVED"].includes(quote.need.status)) {
      return res.status(400).json({ error: "NEED_NOT_ORDERED" });
    }
    if (quote.invoiceConfirmedAt) {
      return res.status(400).json({ error: "INVOICE_ALREADY_CONFIRMED" });
    }

    const expectedReceiptDate = new Date(body.expectedReceiptDate);
    if (Number.isNaN(expectedReceiptDate.getTime())) {
      return res.status(400).json({ error: "INVALID_DATE" });
    }

    const totalAmount = Number(quote.totalValue ?? (Number(quote.quantity || 0) * Number(quote.quotedPrice || 0)) ?? quote.quotedPrice);
    const plan = buildInstallmentPlan({
      totalAmount,
      expectedReceiptDate,
      installmentsCount: body.installmentsCount,
    });

    const actorName = req.user?.name || req.user?.email || null;

    const { updatedQuote, installments } = await prisma.$transaction(async (tx) => {
      const updatedQuote = await tx.needQuote.update({
        where: { id },
        data: {
          creditTermDays: body.creditTermDays ?? null,
          expectedReceiptDate,
          installmentsPlanned: body.installmentsCount,
          invoiceConfirmedAt: new Date(),
          invoiceConfirmedBy: actorName,
        },
      });

      const installments = [];
      for (const item of plan) {
        const costPayment = await tx.costPayment.create({
          data: {
            projectId: quote.need.projectId,
            costCenterId: quote.need.costCenterId,
            needId: quote.needId,
            supplierId: quote.supplierId || null,
            docNumber: quote.orderNumber ? `EF${String(quote.orderNumber).padStart(3, "0")}` : null,
            paymentDate: item.dueDate,
            supplier: quote.supplier?.name || null,
            category: "MATERIAL",
            description: `Parcela ${item.number}/${plan.length} - ${quote.need.description}`,
            budgetedAmount: String(item.amount),
            paidAmount: "0",
            paymentMethod: null,
            paymentType: "CREDITO",
            week: null,
            installment: item.number,
            status: "PENDENTE",
            notes: null,
          },
        });

        const installment = await tx.paymentInstallment.create({
          data: {
            quoteId: id,
            needId: quote.needId,
            costPaymentId: costPayment.id,
            number: item.number,
            amount: String(item.amount),
            currency: quote.currency || "AOA",
            dueDate: item.dueDate,
            status: "PENDENTE",
          },
        });

        await tx.paymentInstallmentHistory.create({
          data: {
            installmentId: installment.id,
            action: "created",
            toValue: `PENDENTE:${item.amount}:${item.dueDate.toISOString()}`,
            userId: req.user?.sub || null,
            userName: actorName,
          },
        });

        installments.push(installment);
      }

      return { updatedQuote, installments };
    });

    await logQuoteAction(req, {
      action: "quote_confirm_invoice",
      needId: quote.needId,
      quoteId: id,
      details: {
        creditTermDays: body.creditTermDays ?? null,
        expectedReceiptDate: expectedReceiptDate.toISOString(),
        installmentsCount: body.installmentsCount,
        totalAmount,
      },
    });

    setImmediate(() => {
      notifyPaymentBatchCreated(
        req.app.get("io"),
        installments.map((i) => ({ id: i.costPaymentId })).filter((x) => x.id),
        req.user
      ).catch((e) => console.error("notifyPaymentBatchCreated credit:", e));
    });

    res.json({
      ok: true,
      quote: {
        ...updatedQuote,
        quotedPrice: String(updatedQuote.quotedPrice),
        quantity: updatedQuote.quantity != null ? String(updatedQuote.quantity) : null,
        totalValue: updatedQuote.totalValue != null ? String(updatedQuote.totalValue) : null,
      },
      installments: installments.map((i) => ({
        ...i,
        amount: String(i.amount),
      })),
    });
  })
);

// Upload proforma da cotação seleccionada — aprova o item no orçamento se estiver em encomenda
quoteRoutes.post(
  "/:id/proforma",
  fileUpload.single("proforma"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: {
        need: {
          include: {
            costCenter: { select: { name: true, code: true, currency: true } },
            project: { select: { id: true, name: true, code: true, location: true, region: true } },
          },
        },
      },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (!quote.selected) return res.status(400).json({ error: "QUOTE_NOT_SELECTED" });
    if (quote.need.status !== "ORDERED") {
      return res.status(400).json({ error: "NEED_NOT_ORDERED" });
    }

    const extension = path.extname(req.file.originalname).toLowerCase();
    const storagePath = `quotes/${quote.needId}/proforma-${Date.now()}${extension}`;
    const proformaUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    const updatedQuote = await prisma.needQuote.update({
      where: { id },
      data: { proformaUrl },
      include: {
        supplier: { include: { bankAccounts: true } },
        supplierProduct: { select: { name: true, notes: true } },
      },
    });

    const updatedNeed = await prisma.workNeed.update({
      where: { id: quote.needId },
      data: {
        status: "APPROVED",
        unitPrice: quote.quotedPrice,
      },
      include: {
        costCenter: { select: { name: true, code: true, currency: true } },
        project: { select: { id: true, name: true, code: true, location: true, region: true } },
      },
    });

    await logQuoteAction(req, {
      action: "quote_proforma_upload",
      needId: quote.needId,
      quoteId: id,
      details: { proformaUrl },
    });

    res.json({
      ok: true,
      approved: true,
      quote: {
        ...updatedQuote,
        quotedPrice: String(updatedQuote.quotedPrice),
        quantity: updatedQuote.quantity != null ? String(updatedQuote.quantity) : null,
        totalValue: updatedQuote.totalValue != null ? String(updatedQuote.totalValue) : null,
      },
      need: {
        ...updatedNeed,
        quantity: updatedNeed.quantity != null ? String(updatedNeed.quantity) : null,
        unitPrice: updatedNeed.unitPrice != null ? String(updatedNeed.unitPrice) : null,
      },
    });
  })
);

// Upload PDF de encomenda gerado após seleção
quoteRoutes.post(
  "/:id/purchase-order",
  fileUpload.single("file"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const quote = await prisma.needQuote.findUnique({ where: { id } });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

    const extension = path.extname(req.file.originalname).toLowerCase() || ".pdf";
    const storagePath = `quotes/${quote.needId}/purchase-order-${Date.now()}${extension}`;
    const purchaseOrderUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    const { documentId, issuedBy, issuedAt } = req.body || {};

    await prisma.needQuote.update({
      where: { id },
      data: {
        purchaseOrderUrl,
        poDocumentId: documentId || null,
        poIssuedBy: issuedBy || null,
        poIssuedAt: issuedAt ? new Date(issuedAt) : null,
      },
    });

    await logQuoteAction(req, {
      action: "quote_purchase_order_pdf",
      needId: quote.needId,
      quoteId: id,
      details: { purchaseOrderUrl, documentId: documentId || null, issuedBy: issuedBy || null },
    });

    res.json({ purchaseOrderUrl, documentId: documentId || null });
  })
);

module.exports = { quoteRoutes };
