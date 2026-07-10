const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
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
  bankAccounts: z.array(bankAccountInput).optional(),
});

const supplierRoutes = express.Router();
supplierRoutes.use(authRequired);
supplierRoutes.use(requireRole(["admin", "operador"]));

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
  asyncHandler(async (req, res) => {
    const items = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
      include: supplierInclude,
    });
    res.json({ items });
  })
);

supplierRoutes.post(
  "/",
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
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.supplier.delete({ where: { id } });
    res.json({ ok: true });
  })
);

// --- CRUD PRODUTOS POR FORNECEDOR ---

supplierRoutes.get(
  "/:id/products",
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
      },
    });
    res.status(201).json(created);
  })
);

supplierRoutes.patch(
  "/:id/products/:pId",
  asyncHandler(async (req, res) => {
    const id = String(req.params.pId);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        unit: z.string().optional().nullable(),
        price: z.coerce.number().min(0).optional(),
        currency: z.string().optional(),
        validUntil: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const data = { ...body };
    if (body.validUntil !== undefined) {
      data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
    }

    const updated = await prisma.supplierProduct.update({
      where: { id },
      data,
    });
    res.json(updated);
  })
);

supplierRoutes.delete(
  "/:id/products/:pId",
  asyncHandler(async (req, res) => {
    const id = String(req.params.pId);
    await prisma.supplierProduct.delete({ where: { id } });
    res.json({ ok: true });
  })
);

module.exports = { supplierRoutes };
