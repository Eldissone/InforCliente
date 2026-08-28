const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermissionOrLegacyRole, requirePermission } = require("../middlewares/auth");
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

/** Percentagem fiscal opcional (0–100). null limpa; undefined = inválida. */
function parseOptionalFiscalPercent(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return String(n);
}

/**
 * Aplica filtro de scope à cláusula where de listagem de ExtraRequest.
 * - scope "own" : utilizador interno vê só projetos onde está atribuído; cliente
 *                 vê só obras do seu cliente. Permissões totais continuam sem
 *                 restrição adicional.
 * - scope "view": semanticamente igual para listagem, mas as ações de escrita
 *                bloqueiam separadamente por assertExtraRequestAuthorized.
 */
async function applyExtraRequestScopeWhere(where, req) {
  const scope = req.permissionScope;
  if (scope !== "own" && scope !== "view") return where;

  const userId = req.user?.sub;
  const role = (req.user?.role || "").toLowerCase();

  if (role === "cliente") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { clientId: true, clients: { select: { clientId: true } } },
    });
    const clientIds = new Set([user?.clientId, ...(user?.clients?.map((c) => c.clientId) || [])].filter(Boolean));
    if (clientIds.size === 0) {
      // Fallback seguro: sem clientIds conhecidos, bloqueia.
      return { ...where, id: null };
    }
    // Adiciona filtro por projetos pertencentes aos clientes do utilizador
    return {
      AND: [
        where,
        {
          project: {
            is: { clientId: { in: [...clientIds] } },
          },
        },
      ],
    };
  }

  // scope own/view para utilizadores internos: restringe a projetos onde está
  // atribuído (assignedUsers). Para pedidos GERAL (sem projectId), mantemos
  // visível apenas se o utilizador for criador, mas hoje o modelo não tem
  // userId; nesse caso permitimos o GERAL cair no fallback por role legado.
  const userProjects = await prisma.project.findMany({
    where: { assignedUsers: { some: { id: userId } } },
    select: { id: true },
  });
  const projectIds = new Set(userProjects.map((p) => p.id));
  const projectFilter = projectIds.size
    ? { OR: [{ projectId: null }, { projectId: { in: [...projectIds] } }] }
    : { projectId: null };

  return { AND: [where, projectFilter] };
}

/**
 * Valida autorização de ações sobre um ExtraRequest quando a permissão é own
 * ou view. Para "view" bloqueia qualquer escrita; para "own" exige que o
 * pedido pertença aos projetos atribuídos (internos) ou ao cliente.
 */
async function assertExtraRequestAuthorized(item, req, options = {}) {
  const scope = req.permissionScope;
  if (scope !== "own" && scope !== "view") return true;

  const writeOperation = options.write !== false;
  if (scope === "view" && writeOperation) {
    const err = new Error("VIEW_ONLY_CANNOT_WRITE");
    err.status = 403;
    throw err;
  }

  const userId = req.user?.sub;
  const role = (req.user?.role || "").toLowerCase();

  if (!item.projectId) {
    // Pedido GERAL: sem owner implícito no modelo atual, só permite escrita
    // se scope não for own (cairia em role fallback; se chegou aqui por own,
    // bloqueamos por segurança, mas permitimos explicitamente para admin e
    // fallback antigo. Como o requirePermissionOrLegacyRole já deu passagem
    // por role quando a permissão central é "false", aqui usamos a flag de
    // _permissionPassedByRole que o helper define mais tarde.
    if (scope === "own" && req._permissionPassedByRole !== true && writeOperation) {
      // Sem scope de obra para "own" em GERAL: só permitido se escreve o
      // próprio requester; hoje o modelo não tem userId, bloqueamos escrita
      // de users sem atribuição para evitar abusos. Permitimos só se a
      // permissão realmente passou por role fallback.
      const allowGenericWrite = req._permissionPassedByRole === true || role === "admin";
      if (!allowGenericWrite) {
        const err = new Error("GENERAL_SCOPE_NOT_OWNED");
        err.status = 403;
        throw err;
      }
    }
    return true;
  }

  // Pedido com projeto: valida ownership.
  if (role === "cliente") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { clientId: true, clients: { select: { clientId: true } } },
    });
    const clientIds = new Set([user?.clientId, ...(user?.clients?.map((c) => c.clientId) || [])].filter(Boolean));
    const project = await prisma.project.findUnique({
      where: { id: item.projectId },
      select: { clientId: true },
    });
    if (!project?.clientId || !clientIds.has(project.clientId)) {
      const err = new Error("PROJECT_NOT_OWNED");
      err.status = 403;
      throw err;
    }
    return true;
  }

  const assigned = await prisma.project.count({
    where: { id: item.projectId, assignedUsers: { some: { id: userId } } },
  });
  if (!assigned) {
    // Fallback amigável: se a permissão foi concedida por role legado, deixa
    // passar (igual ao comportamento antigo). Senão, bloqueia.
    if (req._permissionPassedByRole === true || role === "admin") return true;
    const err = new Error("PROJECT_NOT_ASSIGNED");
    err.status = 403;
    throw err;
  }
  return true;
}

function mapExtra(item) {
  return {
    ...item,
    amount: String(item.amount),
    quantity: item.quantity != null ? String(item.quantity) : null,
    fiscalVatPercent: item.fiscalVatPercent != null ? String(item.fiscalVatPercent) : null,
    fiscalWithholdingPercent:
      item.fiscalWithholdingPercent != null ? String(item.fiscalWithholdingPercent) : null,
    fiscalDiscountPercent:
      item.fiscalDiscountPercent != null ? String(item.fiscalDiscountPercent) : null,
    desiredDate:
      item.desiredDate != null
        ? (typeof item.desiredDate.toISOString === "function"
            ? item.desiredDate.toISOString().slice(0, 10)
            : String(item.desiredDate).slice(0, 10))
        : null,
    items: (item.items || []).map((i) => ({
      ...i,
      quantity: String(i.quantity),
      unitPrice: i.unitPrice != null ? String(i.unitPrice) : null,
      totalPrice: i.totalPrice != null ? String(i.totalPrice) : null,
    })),
  };
}

function resolveFiscalPercentFields(body, { requireGrossFlags = false } = {}) {
  const mode = body.fiscalInputMode === "gross" ? "gross" : "base";
  if (mode !== "gross") {
    return {
      fiscalInputMode: "base",
      fiscalApplyVat: false,
      fiscalApplyWithholding: false,
      fiscalApplyDiscount: false,
      fiscalVatPercent: null,
      fiscalWithholdingPercent: null,
      fiscalDiscountPercent: null,
    };
  }

  const applyVat = Boolean(body.fiscalApplyVat);
  const applyWithholding = Boolean(body.fiscalApplyWithholding);
  const applyDiscount = Boolean(body.fiscalApplyDiscount);

  const vat = applyVat ? parseOptionalFiscalPercent(body.fiscalVatPercent) : null;
  const wh = applyWithholding ? parseOptionalFiscalPercent(body.fiscalWithholdingPercent) : null;
  const disc = applyDiscount ? parseOptionalFiscalPercent(body.fiscalDiscountPercent) : null;

  if (vat === undefined || wh === undefined || disc === undefined) {
    return { error: "INVALID_FISCAL_PERCENT" };
  }
  if (requireGrossFlags && !applyVat && !applyWithholding && !applyDiscount) {
    return { error: "FISCAL_FLAGS_REQUIRED" };
  }
  if (applyVat && !(Number(vat) > 0)) {
    return { error: "VAT_PERCENT_REQUIRED", message: "Indique a percentagem de IVA." };
  }
  if (applyWithholding && !(Number(wh) > 0)) {
    return { error: "WITHHOLDING_PERCENT_REQUIRED", message: "Indique a percentagem de retenção." };
  }
  if (applyDiscount && !(Number(disc) > 0)) {
    return { error: "DISCOUNT_PERCENT_REQUIRED", message: "Indique a percentagem de desconto." };
  }

  return {
    fiscalInputMode: "gross",
    fiscalApplyVat: applyVat,
    fiscalApplyWithholding: applyWithholding,
    fiscalApplyDiscount: applyDiscount,
    fiscalVatPercent: applyVat ? vat : null,
    fiscalWithholdingPercent: applyWithholding ? wh : null,
    fiscalDiscountPercent: applyDiscount ? disc : null,
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

function parseDesiredDate(value) {
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

const extraItemSchema = z.object({
  description: z.string().min(1, "DESCRIPTION_REQUIRED"),
  quantity: z.union([z.number(), z.string()]),
  unit: z.string().optional().nullable(),
  unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
  notes: z.string().optional().nullable(),
});

function normalizeItemsInput(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.map((raw, idx) => {
    const qty = Number(raw.quantity);
    const price = raw.unitPrice != null && raw.unitPrice !== "" ? Number(raw.unitPrice) : null;
    const qtySafe = Number.isFinite(qty) && qty > 0 ? qty : 1;
    const priceSafe = Number.isFinite(price) && price >= 0 ? price : null;
    return {
      description: String(raw.description || "").trim(),
      quantity: String(qtySafe),
      unit: raw.unit ? String(raw.unit).trim() || null : null,
      unitPrice: priceSafe != null ? String(priceSafe) : null,
      totalPrice:
        priceSafe != null && Number.isFinite(priceSafe)
          ? String(qtySafe * priceSafe)
          : null,
      notes: raw.notes ? String(raw.notes).trim() || null : null,
      order: idx,
    };
  });
}

function computeAmountFromItems(items, fallback) {
  const normalized = normalizeItemsInput(items);
  if (!normalized) return fallback != null ? String(fallback) : "0";
  let total = 0;
  let hasAnyPrice = false;
  for (const i of normalized) {
    if (i.unitPrice != null) {
      hasAnyPrice = true;
      total += Number(i.quantity) * Number(i.unitPrice);
    }
  }
  if (!hasAnyPrice) return fallback != null ? String(fallback) : "0";
  return String(total);
}

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
  items: { orderBy: { order: "asc" } },
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

    const baseWhere = {
      ...(type ? { type } : {}),
      ...(projectId ? { projectId } : {}),
      ...(generalCostCenterId ? { generalCostCenterId } : {}),
      ...costCategoryFilter,
      ...(status ? { status } : {}),
      ...(!projectId ? { OR: [{ projectId: null }, { project: activeProjectRelationFilter() }] } : {}),
    };
    const where = await applyExtraRequestScopeWhere(baseWhere, req);

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
    const baseWhere = {
      status: "APROVADO",
      ...(projectId ? { projectId } : { OR: [{ projectId: null }, { project: activeProjectRelationFilter() }] }),
    };
    const where = await applyExtraRequestScopeWhere(baseWhere, req);
    const items = await prisma.extraRequest.findMany({
      where,
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

      // Necessidades do centro de custo (orçamento / planificação)
      let costCenterIds = [];
      let costCenterMeta = null;
      if (costCenterId) {
        const cc = await prisma.costCenter.findFirst({
          where: { id: costCenterId, projectId },
          select: { id: true, code: true, name: true },
        });
        if (cc) {
          costCenterIds = [cc.id];
          costCenterMeta = cc;
        }
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
            category: null,
            unit: n.unit || null,
            plannedQty: n.quantity != null ? Number(n.quantity) : null,
            source: "workNeed",
          });
        }
      }

      // Fallback stock só sem CC concreto e quando se pediu tools/materials
      if (!items.length && !costCenterId) {
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

      let responseKind = "budget";
      if (costCenterMeta) {
        const text = normalizeLabel(`${costCenterMeta.code} ${costCenterMeta.name}`);
        if (text.includes("ferrament")) responseKind = "tools";
        else if (text.includes("material")) responseKind = "materials";
      } else {
        responseKind = resolvedKind;
      }

      return res.json({
        scope: "OBRA",
        kind: responseKind,
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
  requirePermissionOrLegacyRole("pedidosExtras", "create", ["admin", "operador", "supervisor", "tecnico"]),
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
        amount: z.union([z.number(), z.string()]).optional(),
        fiscalInputMode: z.enum(["base", "gross"]).optional().default("base"),
        fiscalApplyVat: z.boolean().optional().default(false),
        fiscalApplyWithholding: z.boolean().optional().default(false),
        fiscalApplyDiscount: z.boolean().optional().default(false),
        fiscalVatPercent: z.union([z.number(), z.string()]).optional().nullable(),
        fiscalWithholdingPercent: z.union([z.number(), z.string()]).optional().nullable(),
        fiscalDiscountPercent: z.union([z.number(), z.string()]).optional().nullable(),
        currency: z.string().optional().default("AOA"),
        // CAIXA/BANCO mantidos apenas para compatibilidade com pedidos antigos.
        paymentSource: z.enum(EXTRA_PAYMENT_SOURCES).optional().default("SOLICITACAO_TRANSFERENCIA"),
        fundId: z.string().optional().nullable(),
        cardId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        paymentDueDate: paymentDueDateSchema,
        priority: z.enum(["NORMAL", "ALTA", "URGENTE"]).optional().default("NORMAL"),
        requestedBy: z.string().optional().nullable(),
        desiredDate: z.string().optional().nullable(),
        requiresQuote: z.boolean().optional().default(true),
        items: z.array(extraItemSchema).optional().nullable(),
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
    if (body.paymentSource === "SOLICITACAO_TRANSFERENCIA" && !body.requiresQuote) {
      try {
        supplierData = await resolveTransferSupplierFields(body, { required: true });
      } catch (err) {
        return res.status(err.status || 400).json({
          error: err.code || "TRANSFER_SUPPLIER_REQUIRED",
          message: err.message,
        });
      }
    }

    const fiscalFields = resolveFiscalPercentFields(body, { requireGrossFlags: true });
    if (fiscalFields.error) {
      return res.status(400).json({
        error: fiscalFields.error,
        message: fiscalFields.message || "Dados fiscais inválidos.",
      });
    }

    const u = req.user || {};
    const normalizedItems = normalizeItemsInput(body.items);
    const finalAmount = computeAmountFromItems(body.items, body.amount);
    const finalRequestedBy =
      trimOrNull(body.requestedBy) || u.name || u.email || u.sub || null;
    const finalDesiredDate = parseDesiredDate(body.desiredDate);

    const createData = {
      type: body.type,
      projectId: body.type === "OBRA" ? body.projectId || null : null,
      costCenterId: body.type === "OBRA" ? body.costCenterId || null : null,
      generalCostCenterId:
        body.type === "GERAL" && !body.costCategoryId ? body.generalCostCenterId || null : null,
      costCategoryId: body.costCategoryId || null,
      costDetailDescription: trimOrNull(body.costDetailDescription),
      description: body.description,
      quantity: quantityParsed,
      amount: finalAmount,
      ...fiscalFields,
      currency: body.currency || "AOA",
      paymentSource: body.paymentSource,
      fundId: body.fundId || null,
      cardId: body.cardId || null,
      status: "PENDENTE",
      requestedBy: finalRequestedBy,
      paymentDueDate: parsePaymentDueDate(body.paymentDueDate),
      priority: body.priority || "NORMAL",
      desiredDate: finalDesiredDate,
      requiresQuote: Boolean(body.requiresQuote),
      notes: body.notes || null,
      supplierId: supplierData.supplierId,
      supplierName: supplierData.supplierName,
      supplierNif: supplierData.supplierNif,
      supplierIban: supplierData.supplierIban,
    };
    if (normalizedItems) {
      createData.items = { create: normalizedItems };
    }

    const created = await prisma.extraRequest.create({
      data: createData,
      include: EXTRA_INCLUDE,
    });

    if (created.requiresQuote && (created.type === "GERAL" || (created.projectId && created.costCenterId))) {
      const { ensureQuotationNeedsFromPedido } = require("../services/quotationNeedService");
      await ensureQuotationNeedsFromPedido(prisma, {
        projectId: created.type === "GERAL" ? null : created.projectId,
        costCenterId: created.type === "GERAL" ? null : created.costCenterId,
        description: created.description,
        items: created.items,
        extraRequestId: created.id,
        priority: created.priority,
        responsible: created.requestedBy,
        notes: created.notes,
      });
    }

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
  requirePermissionOrLegacyRole("pedidosExtras", "edit", ["admin", "operador", "supervisor", "tecnico"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE" && existing.status !== "APROVADO" && existing.status !== "REJEITADO") {
      return res.status(409).json({ error: "ONLY_UNLIQUIDATED_CAN_BE_EDITED" });
    }

    const body = z
      .object({
        description: z.string().min(2).optional(),
        quantity: z.union([z.number(), z.string()]).optional().nullable(),
        amount: z.union([z.number(), z.string()]).optional(),
        fiscalInputMode: z.enum(["base", "gross"]).optional(),
        fiscalApplyVat: z.boolean().optional(),
        fiscalApplyWithholding: z.boolean().optional(),
        fiscalApplyDiscount: z.boolean().optional(),
        fiscalVatPercent: z.union([z.number(), z.string()]).optional().nullable(),
        fiscalWithholdingPercent: z.union([z.number(), z.string()]).optional().nullable(),
        fiscalDiscountPercent: z.union([z.number(), z.string()]).optional().nullable(),
        paymentSource: z.enum(EXTRA_PAYMENT_SOURCES).optional(),
        fundId: z.string().optional().nullable(),
        cardId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        paymentDueDate: paymentDueDateSchema.optional(),
        priority: z.enum(["NORMAL", "ALTA", "URGENTE"]).optional(),
        requestedBy: z.string().optional().nullable(),
        desiredDate: z.string().optional().nullable(),
        requiresQuote: z.boolean().optional(),
        items: z.array(extraItemSchema).optional().nullable(),
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

    const nextRequiresQuote = body.requiresQuote !== undefined ? Boolean(body.requiresQuote) : existing.requiresQuote;
    let supplierPatch = {};
    if (nextSource === "SOLICITACAO_TRANSFERENCIA" && supplierTouched && !nextRequiresQuote) {
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

    let fiscalPatch = {};
    const fiscalTouched =
      body.fiscalInputMode !== undefined ||
      body.fiscalApplyVat !== undefined ||
      body.fiscalApplyWithholding !== undefined ||
      body.fiscalApplyDiscount !== undefined ||
      body.fiscalVatPercent !== undefined ||
      body.fiscalWithholdingPercent !== undefined ||
      body.fiscalDiscountPercent !== undefined;
    if (fiscalTouched) {
      const fiscalFields = resolveFiscalPercentFields(
        {
          fiscalInputMode: body.fiscalInputMode ?? existing.fiscalInputMode ?? "base",
          fiscalApplyVat: body.fiscalApplyVat ?? existing.fiscalApplyVat,
          fiscalApplyWithholding: body.fiscalApplyWithholding ?? existing.fiscalApplyWithholding,
          fiscalApplyDiscount: body.fiscalApplyDiscount ?? existing.fiscalApplyDiscount,
          fiscalVatPercent:
            body.fiscalVatPercent !== undefined ? body.fiscalVatPercent : existing.fiscalVatPercent,
          fiscalWithholdingPercent:
            body.fiscalWithholdingPercent !== undefined
              ? body.fiscalWithholdingPercent
              : existing.fiscalWithholdingPercent,
          fiscalDiscountPercent:
            body.fiscalDiscountPercent !== undefined
              ? body.fiscalDiscountPercent
              : existing.fiscalDiscountPercent,
        },
        { requireGrossFlags: true }
      );
      if (fiscalFields.error) {
        return res.status(400).json({
          error: fiscalFields.error,
          message: fiscalFields.message || "Dados fiscais inválidos.",
        });
      }
      fiscalPatch = fiscalFields;
    }

    const desiredDatePatch =
      body.desiredDate !== undefined
        ? body.desiredDate === null || body.desiredDate === ""
          ? { desiredDate: null }
          : { desiredDate: parseDesiredDate(body.desiredDate) }
        : undefined;

    const amountFallback =
      body.amount !== undefined ? String(body.amount) : String(existing.amount);
    const finalAmount =
      body.items !== undefined
        ? computeAmountFromItems(body.items, amountFallback)
        : amountFallback;

    const baseData = {
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...quantityPatch,
      amount: finalAmount,
      ...fiscalPatch,
      ...(body.paymentSource !== undefined ? { paymentSource: body.paymentSource } : {}),
      ...(body.fundId !== undefined ? { fundId: body.fundId || null } : {}),
      ...(body.cardId !== undefined ? { cardId: body.cardId || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(paymentDueDate !== undefined ? { paymentDueDate } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.requestedBy !== undefined ? { requestedBy: trimOrNull(body.requestedBy) } : {}),
      ...(desiredDatePatch || {}),
      ...(body.requiresQuote !== undefined ? { requiresQuote: Boolean(body.requiresQuote) } : {}),
      ...supplierPatch,
      ...(existing.status === "REJEITADO" ? { status: "PENDENTE", rejectedReason: null } : {}),
    };

    let updated;
    if (body.items !== undefined) {
      const normalizedItems = normalizeItemsInput(body.items);
      updated = await prisma.$transaction(async (tx) => {
        await tx.extraRequestItem.deleteMany({ where: { extraRequestId: id } });
        const patchPayload = { ...baseData };
        if (normalizedItems) {
          patchPayload.items = { create: normalizedItems };
        }
        return tx.extraRequest.update({
          where: { id },
          data: patchPayload,
          include: EXTRA_INCLUDE,
        });
      });
    } else {
      updated = await prisma.extraRequest.update({
        where: { id },
        data: baseData,
        include: EXTRA_INCLUDE,
      });
    }

    if (updated.requiresQuote && (updated.type === "GERAL" || (updated.projectId && updated.costCenterId))) {
      const { ensureQuotationNeedsFromPedido } = require("../services/quotationNeedService");
      await ensureQuotationNeedsFromPedido(prisma, {
        projectId: updated.type === "GERAL" ? null : updated.projectId,
        costCenterId: updated.type === "GERAL" ? null : updated.costCenterId,
        description: updated.description,
        items: updated.items,
        extraRequestId: updated.id,
        priority: updated.priority,
        responsible: updated.requestedBy,
        notes: updated.notes,
      });
    }

    await logExtraAction(req, { action: "extra_request_update", extraRequestId: id, details: body });
    return res.json(mapExtra(updated));
  })
);

// PATCH /extra-requests/:id/approve — Aprovar pedido
extraRequestRoutes.patch(
  "/:id/approve",
  requirePermissionOrLegacyRole("pedidosExtras", "approve", ["admin", "supervisor"]),
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
  requirePermissionOrLegacyRole("pedidosExtras", "reject", ["admin", "supervisor"]),
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
  requirePermissionOrLegacyRole("pedidosExtras", "cancel", ["admin", "operador", "supervisor"]),
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
  requirePermissionOrLegacyRole("pedidosExtras", "edit", ["admin", "operador", "supervisor", "tecnico"]),
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
