const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { syncSupplierBankAccounts, supplierInclude } = require("../services/supplierBankAccounts");

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
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  iban: z.string().optional().nullable(),
  paymentTerm: z.string().optional().nullable(),
  vatPercent: percentSchema,
  withholdingPercent: percentSchema,
  discountPercent: percentSchema,
  type: z.enum(["MATERIAL", "SERVICO", "TRANSPORTADOR"]).optional(),
  bankAccounts: z.array(bankAccountInput).optional(),
});

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

    const created = await prisma.supplier.create({
      data: {
        ...supplierData,
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

supplierRoutes.patch(
  "/:id",
  requirePermission("fornecedores", "manage"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = supplierBodySchema.partial().extend({
      active: z.boolean().optional(),
    }).parse(req.body);

    const { bankAccounts, ...supplierData } = body;

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
