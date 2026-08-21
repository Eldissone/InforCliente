const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { syncSupplierBankAccounts, supplierInclude } = require("../services/supplierBankAccounts");
const { consultarNifAgt, normalizeNif } = require("../services/agtNifLookup");

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
        name: z.string().min(1),
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

    const created = await prisma.supplierProduct.create({
      data: {
        supplierId,
        name: body.name,
        description: body.description,
        unit: body.unit,
        price: body.price,
        currency: body.currency,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        notes: body.notes,
        vatPercent: body.vatPercent ?? null,
        withholdingPercent: body.withholdingPercent ?? null,
        discountPercent: body.discountPercent ?? null,
      },
    });
    res.status(201).json(created);
  })
);

supplierRoutes.patch(
  "/:id/products/:productId",
  requirePermission("fornecedores", "manage"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.productId);
    const body = z
      .object({
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

    const data = { ...body };
    if (body.validUntil !== undefined) {
      data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
    }
    if (body.vatPercent === null) data.vatPercent = null;
    if (body.withholdingPercent === null) data.withholdingPercent = null;
    if (body.discountPercent === null) data.discountPercent = null;

    const updated = await prisma.supplierProduct.update({
      where: { id },
      data,
    });
    res.json(updated);
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
