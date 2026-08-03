const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { applyFundMovement, InsufficientBalanceError } = require("../services/pettyCashService");
const {
  notifyExtraRequestApproved,
  needsFinanceiroLiquidation,
} = require("../services/extraRequestNotificationService");
const {
  getEffectivePermissionsForUser,
  resolveAllowedFromMap,
} = require("../services/permissionResolver");
const { createLog } = require("../services/logService");
const { activeProjectRelationFilter } = require("../services/projectLifecycleService");
const { uploadToSupabase } = require("../utils/storage");
const multer = require("multer");
const { validateSelectableCategory } = require("../services/costCategoryService");

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const extraRequestRoutes = express.Router();
extraRequestRoutes.use(authRequired);

const EXTRA_PAYMENT_SOURCES = [
  "CAIXA",
  "BANCO",
  "FUNDO_MANEIO",
  "SOLICITACAO_TRANSFERENCIA",
  "TRANSFERENCIA_INTERNA_CARTAO",
];

async function logExtraAction(req, { action, extraRequestId, details }) {
  const u = req.user || {};
  await createLog({
    userId: u.sub || u.id || null,
    userName: u.name || null,
    userEmail: u.email || null,
    action,
    module: "extraRequests",
    status: "success",
    ipAddress: req.ip || null,
    userAgent: String(req.headers["user-agent"] || ""),
    details: { extraRequestId, ...(details || null) },
  });
}

function parseOptionalQuantity(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined; // invalid
  return String(n);
}

function mapExtra(item) {
  return {
    ...item,
    amount: String(item.amount),
    quantity: item.quantity != null ? String(item.quantity) : null,
  };
}

function parsePaymentDueDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

const paymentDueDateSchema = z
  .string()
  .min(1, "PAYMENT_DUE_DATE_REQUIRED")
  .refine((value) => Boolean(parsePaymentDueDate(value)), "INVALID_PAYMENT_DUE_DATE");

const EXTRA_INCLUDE = {
  project: { select: { id: true, name: true, code: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  generalCostCenter: { select: { id: true, code: true, name: true, description: true } },
  costCategory: { select: { id: true, code: true, name: true, domain: true, requiresDetailText: true } },
  fund: { select: { id: true, name: true, currentBalance: true, currency: true } },
  card: { select: { id: true, label: true } },
  supplierRef: {
    select: {
      id: true,
      name: true,
      nif: true,
      iban: true,
      bankAccounts: { select: { iban: true, isPrimary: true, bankName: true }, orderBy: { isPrimary: "desc" } },
    },
  },
};

const supplierFieldsSchema = {
  supplierId: z.string().optional().nullable(),
  supplierName: z.string().optional().nullable(),
  supplierNif: z.string().optional().nullable(),
  supplierIban: z.string().optional().nullable(),
};

function trimOrNull(value) {
  const s = String(value || "").trim();
  return s || null;
}

function primarySupplierIban(supplier) {
  if (!supplier) return null;
  const fromAccounts = (supplier.bankAccounts || []).find((a) => a.iban)?.iban;
  return trimOrNull(fromAccounts || supplier.iban);
}

/**
 * Resolve e valida dados do beneficiário para solicitação de transferência.
 * Aceita fornecedor registado (supplierId) ou preenchimento manual (nome + nif + iban).
 */
async function resolveTransferSupplierFields(input, { required = true } = {}) {
  const supplierId = trimOrNull(input.supplierId);
  let supplierName = trimOrNull(input.supplierName);
  let supplierNif = trimOrNull(input.supplierNif);
  let supplierIban = trimOrNull(input.supplierIban);

  if (supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        nif: true,
        iban: true,
        bankAccounts: { select: { iban: true, isPrimary: true }, orderBy: { isPrimary: "desc" } },
      },
    });
    if (!supplier) {
      const err = new Error("SUPPLIER_NOT_FOUND");
      err.status = 400;
      err.code = "SUPPLIER_NOT_FOUND";
      throw err;
    }
    supplierName = supplierName || trimOrNull(supplier.name);
    supplierNif = supplierNif || trimOrNull(supplier.nif);
    supplierIban = supplierIban || primarySupplierIban(supplier);
  }

  const hasCompleteManual = Boolean(supplierName && supplierNif && supplierIban);
  const hasSupplierLink = Boolean(supplierId);

  if (required && !hasSupplierLink && !hasCompleteManual) {
    const err = new Error(
      "Indique o fornecedor ou preencha Nome, NIF e IBAN antes de anexar a proforma."
    );
    err.status = 400;
    err.code = "TRANSFER_SUPPLIER_REQUIRED";
    throw err;
  }

  if (required && hasSupplierLink && (!supplierName || !supplierIban)) {
    const err = new Error(
      "O fornecedor seleccionado precisa de Nome e IBAN. Complete os dados em falta."
    );
    err.status = 400;
    err.code = "TRANSFER_SUPPLIER_INCOMPLETE";
    throw err;
  }

  if (required && hasSupplierLink && !supplierNif) {
    const err = new Error("Indique o NIF do fornecedor (em falta no registo).");
    err.status = 400;
    err.code = "TRANSFER_SUPPLIER_NIF_REQUIRED";
    throw err;
  }

  return {
    supplierId: hasSupplierLink ? supplierId : null,
    supplierName: supplierName || null,
    supplierNif: supplierNif || null,
    supplierIban: supplierIban || null,
  };
}

// GET /extra-requests — Listar pedidos extra (Obra ou Geral)
extraRequestRoutes.get(
  "/",
  requirePermission("pedidosExtras", "view"),
  asyncHandler(async (req, res) => {
    const type = req.query.type ? String(req.query.type) : "";
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const generalCostCenterId = req.query.generalCostCenterId ? String(req.query.generalCostCenterId) : "";
    const costCategoryId = req.query.costCategoryId
      ? Number(req.query.costCategoryId)
      : null;
    const costCategoryFilter =
      costCategoryId != null && Number.isInteger(costCategoryId) && costCategoryId > 0
        ? { costCategoryId }
        : {};
    const status = req.query.status ? String(req.query.status) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const where = {
      ...(type ? { type } : {}),
      ...(projectId ? { projectId } : {}),
      ...(generalCostCenterId ? { generalCostCenterId } : {}),
      ...costCategoryFilter,
      ...(status ? { status } : {}),
      ...(!projectId ? { OR: [{ projectId: null }, { project: activeProjectRelationFilter() }] } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.extraRequest.count({ where }),
      prisma.extraRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: EXTRA_INCLUDE,
      }),
    ]);

    return res.json({ page, pageSize, total, items: items.map(mapExtra) });
  })
);

// GET /extra-requests/pending-finance-payment — Fila de pedidos extra a liquidar (Perfil Financeiro)
extraRequestRoutes.get(
  "/pending-finance-payment",
  requirePermission("financeiro", "view"),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const items = await prisma.extraRequest.findMany({
      where: {
        status: "APROVADO",
        ...(projectId ? { projectId } : { OR: [{ projectId: null }, { project: activeProjectRelationFilter() }] }),
      },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      include: EXTRA_INCLUDE,
    });
    return res.json({ total: items.length, items: items.map(mapExtra) });
  })
);

// GET /extra-requests/tool-options — Ferramentas/materiais para descrição
extraRequestRoutes.get(
  "/tool-options",
  requirePermission("pedidosExtras", "view"),
  asyncHandler(async (req, res) => {
    const scope = String(req.query.scope || "GERAL").toUpperCase();
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const costCenterId = req.query.costCenterId ? String(req.query.costCenterId) : "";
    const kind = String(req.query.kind || "tools").toLowerCase();
    const resolvedKind = kind === "materials" ? "materials" : "tools";

    function normalizeLabel(value) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    }

    if (scope === "OBRA") {
      if (!projectId) {
        return res.status(400).json({
          error: "PROJECT_REQUIRED",
          message: "Seleccione a obra para listar itens do orçamento.",
        });
      }

      // 1) Necessidades do centro de custo (orçamento / planificação financeira da obra)
      let costCenterIds = [];
      if (costCenterId) {
        const cc = await prisma.costCenter.findFirst({
          where: { id: costCenterId, projectId },
          select: { id: true },
        });
        if (cc) costCenterIds = [cc.id];
      } else {
        const centers = await prisma.costCenter.findMany({
          where: { projectId, active: true },
          select: { id: true, code: true, name: true },
        });
        const needle = resolvedKind === "materials" ? "material" : "ferrament";
        costCenterIds = centers
          .filter((cc) => normalizeLabel(`${cc.code} ${cc.name}`).includes(needle))
          .map((cc) => cc.id);
      }

      let items = [];
      if (costCenterIds.length) {
        const needs = await prisma.workNeed.findMany({
          where: {
            projectId,
            costCenterId: { in: costCenterIds },
            status: { not: "REJECTED" },
          },
          select: {
            id: true,
            description: true,
            quantity: true,
            unit: true,
            status: true,
          },
          orderBy: { description: "asc" },
        });

        const seen = new Set();
        for (const n of needs) {
          const name = String(n.description || "").trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({
            id: n.id,
            name,
            sku: null,
            category: resolvedKind === "materials" ? "MATERIAL" : "TOOL",
            unit: n.unit || null,
            plannedQty: n.quantity != null ? Number(n.quantity) : null,
            source: "workNeed",
          });
        }
      }

      // 2) Fallback: plano de stock da obra (ProjectMaterialPlan)
      if (!items.length) {
        const categories =
          resolvedKind === "materials" ? ["MATERIAL", "CONSUMABLE"] : ["TOOL", "EQUIPMENT"];
        const plans = await prisma.projectMaterialPlan.findMany({
          where: {
            projectId,
            product: { active: true, category: { in: categories } },
          },
          include: {
            product: { select: { id: true, name: true, sku: true, category: true, unit: true } },
          },
          orderBy: { product: { name: "asc" } },
        });
        items = plans.map((p) => ({
          id: p.product.id,
          name: p.product.name,
          sku: p.product.sku,
          category: p.product.category,
          unit: p.product.unit,
          plannedQty: Number(p.plannedQty || 0),
          source: "materialPlan",
        }));
      }

      return res.json({
        scope: "OBRA",
        kind: resolvedKind,
        items,
      });
    }

    const products = await prisma.product.findMany({
      where: {
        active: true,
        category: { in: ["TOOL", "EQUIPMENT"] },
      },
      select: { id: true, name: true, sku: true, category: true, unit: true },
      orderBy: { name: "asc" },
    });
    return res.json({
      scope: "GERAL",
      items: products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        unit: p.unit,
        source: "catalog",
      })),
    });
  })
);

async function assertCanPayExtraRequest(req) {
  const role = (req.user?.role || "").toLowerCase();
  if (role === "admin") return;

  const userId = req.user?.sub;
  if (!userId) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }

  const perms = await getEffectivePermissionsForUser(userId);
  const finEdit = resolveAllowedFromMap(perms?.effectiveMap || {}, "financeiro", "edit");
  const finView = resolveAllowedFromMap(perms?.effectiveMap || {}, "financeiro", "view");
  if (finEdit === "true" || finView === "true") return;

  const err = new Error("FINANCEIRO_ONLY");
  err.status = 403;
  err.message = "Liquidação apenas no Perfil Financeiro.";
  throw err;
}

// GET /extra-requests/:id — Detalhe (deep link / notificações)
extraRequestRoutes.get(
  "/:id",
  requirePermission("pedidosExtras", "view"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const item = await prisma.extraRequest.findUnique({
      where: { id },
      include: EXTRA_INCLUDE,
    });
    if (!item) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    return res.json(mapExtra(item));
  })
);

// POST /extra-requests — Criar Pedido Extra (Obra ou Geral)
extraRequestRoutes.post(
  "/",
  requireRole(["admin", "operador", "supervisor", "tecnico"]),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        type: z.enum(["OBRA", "GERAL"]).optional().default("OBRA"),
        projectId: z.string().optional().nullable(),
        costCenterId: z.string().optional().nullable(),
        generalCostCenterId: z.string().optional().nullable(),
        costCategoryId: z.coerce.number().int().positive().optional().nullable(),
        costDetailDescription: z.string().max(500).optional().nullable(),
        description: z.string().min(2),
        quantity: z.union([z.number(), z.string()]).optional().nullable(),
        amount: z.union([z.number(), z.string()]),
        currency: z.string().optional().default("AOA"),
        // CAIXA/BANCO mantidos apenas para compatibilidade com pedidos antigos.
        paymentSource: z.enum(EXTRA_PAYMENT_SOURCES).optional().default("SOLICITACAO_TRANSFERENCIA"),
        fundId: z.string().optional().nullable(),
        cardId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        paymentDueDate: paymentDueDateSchema,
        ...supplierFieldsSchema,
      })
      .parse(req.body);

    if (body.type === "OBRA" && !body.projectId) {
      return res.status(400).json({ error: "PROJECT_REQUIRED_FOR_OBRA" });
    }
    if (body.type === "OBRA" && !body.costCenterId) {
      return res.status(400).json({ error: "COST_CENTER_REQUIRED_FOR_OBRA" });
    }
    if (body.type === "GERAL" && !body.costCategoryId && !body.generalCostCenterId) {
      return res.status(400).json({ error: "COST_CATEGORY_REQUIRED" });
    }

    let validatedCostCategory = null;
    if (body.costCategoryId) {
      const expectedDomain = body.type === "GERAL" ? "GERAL" : "OBRA";
      const check = await validateSelectableCategory(body.costCategoryId, expectedDomain);
      if (!check.ok) return res.status(400).json({ error: check.error });
      validatedCostCategory = check.category;
      if (validatedCostCategory.requiresDetailText && !trimOrNull(body.costDetailDescription)) {
        return res.status(400).json({ error: "COST_DETAIL_DESCRIPTION_REQUIRED" });
      }
    } else if (body.type === "GERAL" && body.generalCostCenterId) {
      // Pedidos legados: centro geral plano sem taxonomia
    } else if (body.type === "GERAL") {
      return res.status(400).json({ error: "COST_CATEGORY_REQUIRED" });
    }
    if (body.type === "GERAL" && body.projectId) {
      return res.status(400).json({ error: "PROJECT_NOT_ALLOWED_FOR_GERAL" });
    }
    if (body.paymentSource === "FUNDO_MANEIO" && !body.fundId) {
      return res.status(400).json({ error: "FUND_REQUIRED_FOR_FUNDO_MANEIO" });
    }
    if (body.paymentSource === "TRANSFERENCIA_INTERNA_CARTAO" && !body.cardId) {
      return res.status(400).json({ error: "CARD_REQUIRED_FOR_INTERNAL_TRANSFER" });
    }
    if (body.paymentSource === "TRANSFERENCIA_INTERNA_CARTAO" && body.cardId && !body.fundId) {
      const card = await prisma.pettyCashCard.findUnique({
        where: { id: body.cardId },
        select: { fundId: true },
      });
      if (!card) return res.status(400).json({ error: "CARD_NOT_FOUND" });
      body.fundId = card.fundId;
    }
    if (body.type === "OBRA") {
      const cc = await prisma.costCenter.findFirst({
        where: { id: body.costCenterId, projectId: body.projectId },
      });
      if (!cc) return res.status(400).json({ error: "COST_CENTER_NOT_IN_PROJECT" });
    }

    const quantityParsed = parseOptionalQuantity(body.quantity);
    if (body.quantity !== undefined && body.quantity !== null && body.quantity !== "" && quantityParsed === undefined) {
      return res.status(400).json({ error: "INVALID_QUANTITY", message: "Quantidade inválida." });
    }

    let supplierData = {
      supplierId: null,
      supplierName: null,
      supplierNif: null,
      supplierIban: null,
    };
    if (body.paymentSource === "SOLICITACAO_TRANSFERENCIA") {
      try {
        supplierData = await resolveTransferSupplierFields(body, { required: true });
      } catch (err) {
        return res.status(err.status || 400).json({
          error: err.code || "TRANSFER_SUPPLIER_REQUIRED",
          message: err.message,
        });
      }
    }

    const u = req.user || {};
    const created = await prisma.extraRequest.create({
      data: {
        type: body.type,
        projectId: body.type === "OBRA" ? body.projectId || null : null,
        costCenterId: body.type === "OBRA" ? body.costCenterId || null : null,
        generalCostCenterId:
          body.type === "GERAL" && !body.costCategoryId ? body.generalCostCenterId || null : null,
        costCategoryId: body.costCategoryId || null,
        costDetailDescription: trimOrNull(body.costDetailDescription),
        description: body.description,
        quantity: quantityParsed,
        amount: String(body.amount),
        currency: body.currency || "AOA",
        paymentSource: body.paymentSource,
        fundId: body.fundId || null,
        cardId: body.cardId || null,
        notes: body.notes || null,
        paymentDueDate: parsePaymentDueDate(body.paymentDueDate),
        requestedBy: u.name || u.email || u.sub || null,
        supplierId: supplierData.supplierId,
        supplierName: supplierData.supplierName,
        supplierNif: supplierData.supplierNif,
        supplierIban: supplierData.supplierIban,
      },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, {
      action: "extra_request_create",
      extraRequestId: created.id,
      details: { type: created.type, amount: String(created.amount), paymentSource: created.paymentSource },
    });

    return res.status(201).json(mapExtra(created));
  })
);

// PATCH /extra-requests/:id — Editar pedido não liquidado (PENDENTE ou A liquidar)
extraRequestRoutes.patch(
  "/:id",
  requireRole(["admin", "operador", "supervisor", "tecnico"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE" && existing.status !== "APROVADO") {
      return res.status(409).json({ error: "ONLY_UNLIQUIDATED_CAN_BE_EDITED" });
    }

    const body = z
      .object({
        description: z.string().min(2).optional(),
        quantity: z.union([z.number(), z.string()]).optional().nullable(),
        amount: z.union([z.number(), z.string()]).optional(),
        paymentSource: z.enum(EXTRA_PAYMENT_SOURCES).optional(),
        fundId: z.string().optional().nullable(),
        cardId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        paymentDueDate: paymentDueDateSchema.optional(),
        ...supplierFieldsSchema,
      })
      .parse(req.body);

    const paymentDueDate =
      body.paymentDueDate !== undefined ? parsePaymentDueDate(body.paymentDueDate) : undefined;

    let quantityPatch = {};
    if (body.quantity !== undefined) {
      if (body.quantity === null || body.quantity === "") {
        quantityPatch = { quantity: null };
      } else {
        const quantityParsed = parseOptionalQuantity(body.quantity);
        if (quantityParsed === undefined) {
          return res.status(400).json({ error: "INVALID_QUANTITY", message: "Quantidade inválida." });
        }
        quantityPatch = { quantity: quantityParsed };
      }
    }

    const nextSource = body.paymentSource !== undefined ? body.paymentSource : existing.paymentSource;
    const supplierTouched =
      body.supplierId !== undefined ||
      body.supplierName !== undefined ||
      body.supplierNif !== undefined ||
      body.supplierIban !== undefined ||
      body.paymentSource !== undefined;

    let supplierPatch = {};
    if (nextSource === "SOLICITACAO_TRANSFERENCIA" && supplierTouched) {
      try {
        const resolved = await resolveTransferSupplierFields(
          {
            supplierId: body.supplierId !== undefined ? body.supplierId : existing.supplierId,
            supplierName: body.supplierName !== undefined ? body.supplierName : existing.supplierName,
            supplierNif: body.supplierNif !== undefined ? body.supplierNif : existing.supplierNif,
            supplierIban: body.supplierIban !== undefined ? body.supplierIban : existing.supplierIban,
          },
          { required: true }
        );
        supplierPatch = resolved;
      } catch (err) {
        return res.status(err.status || 400).json({
          error: err.code || "TRANSFER_SUPPLIER_REQUIRED",
          message: err.message,
        });
      }
    } else if (nextSource !== "SOLICITACAO_TRANSFERENCIA" && body.paymentSource !== undefined) {
      supplierPatch = {
        supplierId: null,
        supplierName: null,
        supplierNif: null,
        supplierIban: null,
      };
    }

    const updated = await prisma.extraRequest.update({
      where: { id },
      data: {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...quantityPatch,
        ...(body.amount !== undefined ? { amount: String(body.amount) } : {}),
        ...(body.paymentSource !== undefined ? { paymentSource: body.paymentSource } : {}),
        ...(body.fundId !== undefined ? { fundId: body.fundId || null } : {}),
        ...(body.cardId !== undefined ? { cardId: body.cardId || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(paymentDueDate !== undefined ? { paymentDueDate } : {}),
        ...supplierPatch,
      },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, { action: "extra_request_update", extraRequestId: id, details: body });
    return res.json(mapExtra(updated));
  })
);

// PATCH /extra-requests/:id/approve — Aprovar pedido
extraRequestRoutes.patch(
  "/:id/approve",
  requireRole(["admin", "supervisor"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE") {
      return res.status(409).json({ error: "ONLY_PENDING_CAN_BE_APPROVED" });
    }
    if (existing.paymentSource === "SOLICITACAO_TRANSFERENCIA") {
      if (!existing.supplierName || !existing.supplierNif || !existing.supplierIban) {
        return res.status(409).json({
          error: "TRANSFER_SUPPLIER_REQUIRED",
          message: "Indique o fornecedor (Nome, NIF e IBAN) antes de aprovar.",
        });
      }
      if (!existing.proformaUrl) {
        return res.status(409).json({ error: "PROFORMA_REQUIRED" });
      }
    }

    const u = req.user || {};
    const updated = await prisma.extraRequest.update({
      where: { id },
      data: { status: "APROVADO", approvedBy: u.name || u.email || u.sub || null, approvedAt: new Date() },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, { action: "extra_request_approve", extraRequestId: id });

    const io = req.app.get("io");
    if (io) {
      notifyExtraRequestApproved(io, updated, req.user || {}).catch((e) =>
        console.error("notifyExtraRequestApproved:", e)
      );
    }

    return res.json(mapExtra(updated));
  })
);

// PATCH /extra-requests/:id/reject — Rejeitar pedido
extraRequestRoutes.patch(
  "/:id/reject",
  requireRole(["admin", "supervisor"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body || {});
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE") {
      return res.status(409).json({ error: "ONLY_PENDING_CAN_BE_REJECTED" });
    }

    const updated = await prisma.extraRequest.update({
      where: { id },
      data: { status: "REJEITADO", rejectedReason: body.reason || null },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, { action: "extra_request_reject", extraRequestId: id, details: { reason: body.reason } });
    return res.json(mapExtra(updated));
  })
);

// PATCH /extra-requests/:id/cancel — Cancelar pedido (antes de pago)
extraRequestRoutes.patch(
  "/:id/cancel",
  requireRole(["admin", "operador", "supervisor"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status === "PAGO" || existing.status === "CANCELADO") {
      return res.status(409).json({ error: "CANNOT_CANCEL_IN_CURRENT_STATUS" });
    }

    const updated = await prisma.extraRequest.update({
      where: { id },
      data: { status: "CANCELADO" },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, { action: "extra_request_cancel", extraRequestId: id });
    return res.json(mapExtra(updated));
  })
);

// POST /extra-requests/:id/proforma — Anexar proforma (transferência bancária, enquanto PENDENTE)
extraRequestRoutes.post(
  "/:id/proforma",
  requireRole(["admin", "operador", "supervisor", "tecnico"]),
  fileUpload.single("proforma"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.paymentSource !== "SOLICITACAO_TRANSFERENCIA") {
      return res.status(400).json({ error: "PROFORMA_ONLY_FOR_TRANSFER" });
    }
    if (existing.status !== "PENDENTE" && existing.status !== "APROVADO") {
      return res.status(409).json({ error: "ONLY_UNLIQUIDATED_CAN_UPLOAD_PROFORMA" });
    }
    if (!existing.supplierName || !existing.supplierNif || !existing.supplierIban) {
      return res.status(400).json({
        error: "TRANSFER_SUPPLIER_REQUIRED",
        message: "Indique o fornecedor ou preencha Nome, NIF e IBAN antes de anexar a proforma.",
      });
    }
    if (!req.file) return res.status(400).json({ error: "PROFORMA_REQUIRED" });

    const ext = (req.file.originalname || "").split(".").pop() || "pdf";
    const storagePath = `extra-requests/${id}/proforma-${Date.now()}.${ext}`;
    const proformaUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    const updated = await prisma.extraRequest.update({
      where: { id },
      data: { proformaUrl },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, {
      action: "extra_request_proforma_upload",
      extraRequestId: id,
      details: { proformaUrl },
    });

    return res.json(mapExtra(updated));
  })
);

// POST /extra-requests/:id/pay — Liquidar pedido (Fundo de Maneio no CC; transferências só Financeiro)
extraRequestRoutes.post(
  "/:id/pay",
  fileUpload.single("comprovativo"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "APROVADO") {
      return res.status(409).json({ error: "ONLY_APPROVED_CAN_BE_PAID" });
    }

    try {
      await assertCanPayExtraRequest(req);
    } catch (err) {
      if (err.status === 403) {
        return res.status(403).json({
          error: err.message === "FINANCEIRO_ONLY" ? "FINANCEIRO_ONLY" : "FORBIDDEN",
          message: err.message || "Sem permissão para liquidar este pedido.",
        });
      }
      if (err.status === 401) return res.status(401).json({ error: "UNAUTHORIZED" });
      throw err;
    }

    const u = req.user || {};
    const paidAmount =
      req.body?.paidAmount != null && req.body.paidAmount !== ""
        ? String(req.body.paidAmount)
        : String(existing.amount);

    try {
      if (existing.paymentSource === "SOLICITACAO_TRANSFERENCIA" && !req.file) {
        return res.status(400).json({ error: "COMPROVATIVO_REQUIRED" });
      }

      let comprovativoUrl = null;
      if (req.file) {
        const ext = (req.file.originalname || "").split(".").pop() || "pdf";
        const storagePath = `extra-requests/${id}/comprovativo-${Date.now()}.${ext}`;
        comprovativoUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
      }

      if (existing.paymentSource === "FUNDO_MANEIO") {
        if (!existing.fundId) return res.status(400).json({ error: "FUND_REQUIRED" });
        await applyFundMovement({
          fundId: existing.fundId,
          cardId: existing.cardId || null,
          type: "DEBITO",
          amount: paidAmount,
          description: `Pedido Extra: ${existing.description}`,
          extraRequestId: id,
          createdBy: u.name || u.email || u.sub || null,
        });
      }

      if (existing.paymentSource === "TRANSFERENCIA_INTERNA_CARTAO") {
        if (!existing.cardId || !existing.fundId) {
          return res.status(400).json({ error: "CARD_REQUIRED_FOR_INTERNAL_TRANSFER" });
        }
        await applyFundMovement({
          fundId: existing.fundId,
          cardId: existing.cardId,
          type: "CREDITO",
          amount: paidAmount,
          description: `Transferência interna (carregamento): ${existing.description}`,
          extraRequestId: id,
          createdBy: u.name || u.email || u.sub || null,
        });
      }

      const updated = await prisma.extraRequest.update({
        where: { id },
        data: {
          status: "PAGO",
          amount: paidAmount,
          paidBy: u.name || u.email || u.sub || null,
          paidAt: new Date(),
          ...(comprovativoUrl ? { comprovativoUrl } : {}),
        },
        include: EXTRA_INCLUDE,
      });

      await logExtraAction(req, {
        action: "extra_request_pay",
        extraRequestId: id,
        details: { paymentSource: existing.paymentSource, amount: paidAmount },
      });

      return res.json(mapExtra(updated));
    } catch (err) {
      if (err instanceof InsufficientBalanceError) return res.status(422).json({ error: "SALDO_INSUFICIENTE" });
      if (err.message === "FUND_NOT_FOUND") return res.status(404).json({ error: "FUND_NOT_FOUND" });
      throw err;
    }
  })
);

// DELETE /extra-requests/:id — Eliminar pedido (apenas estados finais ou pendentes não liquidados)
extraRequestRoutes.delete(
  "/:id",
  requirePermission("pedidosExtras", "delete"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status === "PAGO" || existing.status === "APROVADO") {
      return res.status(409).json({ error: "CANNOT_DELETE_IN_CURRENT_STATUS" });
    }

    await prisma.extraRequest.delete({ where: { id } });
    await logExtraAction(req, { action: "extra_request_delete", extraRequestId: id });
    return res.json({ ok: true });
  })
);

module.exports = { extraRequestRoutes };
