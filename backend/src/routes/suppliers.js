const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { syncSupplierBankAccounts, supplierInclude } = require("../services/supplierBankAccounts");
const { consultarNifAgt, normalizeNif } = require("../services/agtNifLookup");
const {
  normalizeSearchKey,
  withUppercaseProductName,
  productSearchWhere,
} = require("../utils/productName");

const bankAccountInput = z.object({
  bankName: z.string().min(1),
  iban: z.string().min(1),
  isPrimary: z.boolean().optional(),
});

const percentSchema = z.coerce.number().min(0).max(100).optional().nullable();

const supplierBodySchema = z.object({
  name: z.string().min(1),
  nif: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.string().email().optional().nullable()
  ),
  address: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  iban: z.string().optional().nullable(),
  paymentTerm: z.string().optional().nullable(),
  vatPercent: percentSchema,
  withholdingPercent: percentSchema,
  discountPercent: percentSchema,
  vatRegime: z.string().optional().nullable(),
  agtStatus: z.string().optional().nullable(),
  agtType: z.string().optional().nullable(),
  type: z.enum(["MATERIAL", "SERVICO", "TRANSPORTADOR"]).optional(),
  bankAccounts: z.array(bankAccountInput).optional(),
});

const nifBodySchema = z.object({
  nif: z.string().min(1),
  type: z.enum(["MATERIAL", "SERVICO", "TRANSPORTADOR"]).optional(),
  iban: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.string().email().optional().nullable()
  ),
});

async function findSupplierByNif(nif) {
  const digits = normalizeNif(nif);
  if (!digits) return null;

  const exact = await prisma.supplier.findFirst({
    where: { nif: digits },
    include: supplierInclude,
    orderBy: { updatedAt: "desc" },
  });
  if (exact) return exact;

  const rows = await prisma.$queryRaw`
    SELECT id FROM "Supplier"
    WHERE nif IS NOT NULL
      AND regexp_replace(nif, '[^0-9]', '', 'g') = ${digits}
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `;
  const id = rows?.[0]?.id;
  if (!id) return null;
  return prisma.supplier.findUnique({
    where: { id },
    include: supplierInclude,
  });
}

function duplicateNifResponse(existing) {
  return {
    error: "Já existe um fornecedor cadastrado com este NIF.",
    existingSupplier: existing,
  };
}

const catalogProductSelect = {
  id: true,
  name: true,
  sku: true,
  unit: true,
  category: true,
  aliases: { select: { id: true, alias: true }, orderBy: { alias: "asc" } },
};

const supplierProductInclude = {
  product: { select: { id: true, name: true, sku: true, unit: true, category: true } },
};

async function ensureCommercialAlias(product, commercialName) {
  const display = String(commercialName || "").replace(/\s+/g, " ").trim();
  if (!display || !product?.id) return;
  const key = normalizeSearchKey(display);
  if (!key || key === normalizeSearchKey(product.name)) return;
  const existing = await prisma.productAlias.findUnique({ where: { normalized: key } });
  if (existing) return;
  try {
    await prisma.productAlias.create({
      data: { productId: product.id, alias: display, normalized: key },
    });
  } catch (err) {
    if (err.code !== "P2002") throw err;
  }
}

function duplicateCatalogOfferResponse(existing) {
  return {
    error: "Este fornecedor já tem uma oferta para este material do catálogo da Logística.",
    existingProduct: existing,
  };
}

const supplierRoutes = express.Router();
supplierRoutes.use(authRequired);
// GET (listagem) acessível a todos os utilizadores autenticados (dados de referência)
// POST/PUT/DELETE requerem admin ou operador (aplicado em cada rota de escrita)

function resolveBankAccounts(body) {
  if (Array.isArray(body.bankAccounts) && body.bankAccounts.length) {
    return body.bankAccounts;
  }
  if (body.iban?.trim()) {
    return [{ bankName: "Principal", iban: body.iban.trim(), isPrimary: true }];
  }
  return [];
}

// --- CRUD FORNECEDORES ---

supplierRoutes.get(
  "/",
  requirePermission("fornecedores", "view"),
  asyncHandler(async (req, res) => {
    const type = req.query.type ? String(req.query.type) : "";
    const items = await prisma.supplier.findMany({
      where: {
        ...(type ? { type } : {}),
      },
      orderBy: { name: "asc" },
      include: supplierInclude,
    });
    res.json({ items });
  })
);

supplierRoutes.get(
  "/nomenclature",
  requirePermission("fornecedores", "view"),
  asyncHandler(async (req, res) => {
    const search = req.query.search ? String(req.query.search) : "";
    const take = Math.min(Number(req.query.limit) || (search ? 40 : 200), 300);
    const items = await prisma.product.findMany({
      where: {
        active: true,
        ...productSearchWhere(search),
      },
      select: catalogProductSelect,
      orderBy: { name: "asc" },
      take,
    });
    res.json({ items: items.map(withUppercaseProductName) });
  })
);

supplierRoutes.get(
  "/material-catalog",
  requirePermission("fornecedores", "view"),
  asyncHandler(async (req, res) => {
    const search = req.query.search ? String(req.query.search) : "";
    const items = await prisma.product.findMany({
      where: {
        active: true,
        ...productSearchWhere(search),
      },
      select: {
        ...catalogProductSelect,
        supplierProducts: {
          select: {
            id: true,
            name: true,
            price: true,
            currency: true,
            unit: true,
            validUntil: true,
            supplier: { select: { id: true, name: true, active: true } },
          },
          orderBy: { price: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json({
      items: items.map((item) => {
        const offers = item.supplierProducts || [];
        const { supplierProducts, ...product } = item;
        const prices = offers
          .map((o) => Number(o.price))
          .filter((n) => Number.isFinite(n));
        return {
          ...withUppercaseProductName(product),
          offers,
          supplierCount: offers.length,
          bestPrice: prices.length ? Math.min(...prices) : null,
          bestCurrency: offers[0]?.currency || "AOA",
        };
      }),
    });
  })
);

supplierRoutes.post(
  "/",
  requirePermission("fornecedores", "manage"),
  asyncHandler(async (req, res) => {
    const body = supplierBodySchema.parse(req.body);
    const { bankAccounts, ...supplierData } = body;
    const nif = supplierData.nif ? normalizeNif(supplierData.nif) : null;

    if (nif) {
      const existing = await findSupplierByNif(nif);
      if (existing) {
        return res.status(409).json(duplicateNifResponse(existing));
      }
    }

    const created = await prisma.supplier.create({
      data: {
        ...supplierData,
        nif,
        iban: null,
      },
    });

    await syncSupplierBankAccounts(created.id, resolveBankAccounts(body));

    const full = await prisma.supplier.findUnique({
      where: { id: created.id },
      include: supplierInclude,
    });
    res.status(201).json(full);
  })
);

supplierRoutes.post(
  "/lookup-nif",
  requirePermission("fornecedores", "view"),
  asyncHandler(async (req, res) => {
    const { nif: rawNif } = nifBodySchema.pick({ nif: true }).parse(req.body);
    const nif = normalizeNif(rawNif);
    const existing = await findSupplierByNif(nif);
    const agt = await consultarNifAgt(nif);
    res.json({
      success: true,
      found: Boolean(agt.found),
      alreadyRegistered: Boolean(existing),
      data: agt,
      existingSupplier: existing,
    });
  })
);

supplierRoutes.post(
  "/from-nif",
  requirePermission("fornecedores", "create"),
  asyncHandler(async (req, res) => {
    const body = nifBodySchema.parse(req.body);
    const nif = normalizeNif(body.nif);
    const existing = await findSupplierByNif(nif);
    let agt;
    try {
      agt = await consultarNifAgt(nif);
    } catch (err) {
      if (existing) {
        return res.json({
          success: true,
          created: false,
          alreadyRegistered: true,
          found: false,
          data: { found: false, nif },
          supplier: existing,
          existingSupplier: existing,
        });
      }
      throw err;
    }

    if (existing) {
      return res.json({
        success: true,
        created: false,
        alreadyRegistered: true,
        found: Boolean(agt.found),
        data: agt,
        supplier: existing,
        existingSupplier: existing,
      });
    }

    if (!agt.found) {
      return res.status(404).json({
        error: "NIF não encontrado no Portal da AGT. Confirme o número e tente novamente.",
        found: false,
        data: agt,
        existingSupplier: null,
      });
    }

    const created = await prisma.supplier.create({
      data: {
        name: agt.nome,
        nif,
        type: body.type || "MATERIAL",
        phone: body.phone || null,
        email: body.email || null,
        vatRegime: agt.regimeIva,
        agtStatus: agt.estado,
        agtType: agt.tipo,
        vatPercent: agt.vatPercent,
        iban: null,
      },
    });

    if (body.iban?.trim()) {
      await syncSupplierBankAccounts(created.id, [
        { bankName: "Principal", iban: body.iban.trim(), isPrimary: true },
      ]);
    }

    const full = await prisma.supplier.findUnique({
      where: { id: created.id },
      include: supplierInclude,
    });

    res.status(201).json({
      success: true,
      created: true,
      data: agt,
      supplier: full,
    });
  })
);

supplierRoutes.get(
  "/:id",
  requirePermission("fornecedores", "view"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const item = await prisma.supplier.findUnique({
      where: { id },
      include: supplierInclude,
    });
    if (!item) return res.status(404).json({ error: "Fornecedor não encontrado." });
    res.json(item);
  })
);

supplierRoutes.patch(
  "/:id",
  requirePermission("fornecedores", "manage"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = supplierBodySchema.partial().extend({
      active: z.boolean().optional(),
    }).parse(req.body);

    const { bankAccounts, ...supplierData } = body;
    if (supplierData.nif != null && supplierData.nif !== "") {
      supplierData.nif = normalizeNif(supplierData.nif);
      const existing = await findSupplierByNif(supplierData.nif);
      if (existing && existing.id !== id) {
        return res.status(409).json(duplicateNifResponse(existing));
      }
    }

    if (Object.keys(supplierData).length) {
      await prisma.supplier.update({
        where: { id },
        data: supplierData,
      });
    }

  if (bankAccounts !== undefined) {
      await syncSupplierBankAccounts(id, bankAccounts);
    }

    const full = await prisma.supplier.findUnique({
      where: { id },
      include: supplierInclude,
    });
    res.json(full);
  })
);

supplierRoutes.delete(
  "/:id",
  requirePermission("fornecedores", "manage"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.supplier.delete({ where: { id } });
    res.json({ ok: true });
  })
);

// --- CRUD PRODUTOS POR FORNECEDOR ---

supplierRoutes.get(
  "/:id/products",
  requirePermission("fornecedores", "view"),
  asyncHandler(async (req, res) => {
    const supplierId = String(req.params.id);
    const items = await prisma.supplierProduct.findMany({
      where: { supplierId },
      include: supplierProductInclude,
      orderBy: { name: "asc" },
    });
    res.json({ items });
  })
);

supplierRoutes.post(
  "/:id/products",
  requirePermission("fornecedores", "manage"),
  asyncHandler(async (req, res) => {
    const supplierId = String(req.params.id);
    const body = z
      .object({
        productId: z.string().min(1),
        name: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        unit: z.string().optional().nullable(),
        price: z.coerce.number().min(0),
        currency: z.string().default("AOA"),
        validUntil: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        vatPercent: z.coerce.number().min(0).max(100).optional().nullable(),
        withholdingPercent: z.coerce.number().min(0).max(100).optional().nullable(),
        discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
      })
      .parse(req.body);

    const catalogProduct = await prisma.product.findFirst({
      where: { id: body.productId, active: true },
    });
    if (!catalogProduct) {
      return res.status(400).json({
        error: "Seleccione um material do Catálogo. Se não existir, adicione-o primeiro em Logística → Catálogo.",
      });
    }

    const duplicate = await prisma.supplierProduct.findFirst({
      where: { supplierId, productId: catalogProduct.id },
    });
    if (duplicate) {
      return res.status(409).json(duplicateCatalogOfferResponse(duplicate));
    }

    const commercialName = String(body.name || "").replace(/\s+/g, " ").trim() || catalogProduct.name;

    try {
      const created = await prisma.supplierProduct.create({
        data: {
          supplierId,
          productId: catalogProduct.id,
          name: commercialName,
          description: body.description,
          unit: body.unit || catalogProduct.unit,
          price: body.price,
          currency: body.currency,
          validUntil: body.validUntil ? new Date(body.validUntil) : null,
          notes: body.notes,
          vatPercent: body.vatPercent ?? null,
          withholdingPercent: body.withholdingPercent ?? null,
          discountPercent: body.discountPercent ?? null,
        },
        include: supplierProductInclude,
      });
      await ensureCommercialAlias(catalogProduct, commercialName);
      res.status(201).json(created);
    } catch (err) {
      if (err.code === "P2002") {
        return res.status(409).json(duplicateCatalogOfferResponse(null));
      }
      throw err;
    }
  })
);

supplierRoutes.patch(
  "/:id/products/:productId",
  requirePermission("fornecedores", "manage"),
  asyncHandler(async (req, res) => {
    const supplierId = String(req.params.id);
    const id = String(req.params.productId);
    const body = z
      .object({
        productId: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        unit: z.string().optional().nullable(),
        price: z.coerce.number().min(0).optional(),
        currency: z.string().optional(),
        validUntil: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        vatPercent: z.coerce.number().min(0).max(100).optional().nullable(),
        withholdingPercent: z.coerce.number().min(0).max(100).optional().nullable(),
        discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
      })
      .parse(req.body);

    const current = await prisma.supplierProduct.findFirst({
      where: { id, supplierId },
      include: supplierProductInclude,
    });
    if (!current) return res.status(404).json({ error: "Produto do fornecedor não encontrado." });

    const data = { ...body };
    delete data.productId;
    if (body.validUntil !== undefined) {
      data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
    }
    if (body.vatPercent === null) data.vatPercent = null;
    if (body.withholdingPercent === null) data.withholdingPercent = null;
    if (body.discountPercent === null) data.discountPercent = null;

    let catalogProduct = current.product;
    if (body.productId && body.productId !== current.productId) {
      catalogProduct = await prisma.product.findFirst({
        where: { id: body.productId, active: true },
      });
      if (!catalogProduct) {
        return res.status(400).json({
          error: "Seleccione um material do Catálogo.",
        });
      }
      const duplicate = await prisma.supplierProduct.findFirst({
        where: { supplierId, productId: catalogProduct.id, id: { not: id } },
      });
      if (duplicate) {
        return res.status(409).json(duplicateCatalogOfferResponse(duplicate));
      }
      data.productId = catalogProduct.id;
      if (!body.name) data.name = catalogProduct.name;
      if (body.unit === undefined) data.unit = catalogProduct.unit;
    }

    try {
      const updated = await prisma.supplierProduct.update({
        where: { id },
        data,
        include: supplierProductInclude,
      });
      await ensureCommercialAlias(catalogProduct || updated.product, updated.name);
      res.json(updated);
    } catch (err) {
      if (err.code === "P2002") {
        return res.status(409).json(duplicateCatalogOfferResponse(null));
      }
      throw err;
    }
  })
);

supplierRoutes.delete(
  "/:id/products/:productId",
  requirePermission("fornecedores", "manage"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.productId);
    await prisma.supplierProduct.delete({ where: { id } });
    res.json({ ok: true });
  })
);

module.exports = { supplierRoutes };
