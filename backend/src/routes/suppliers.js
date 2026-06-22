const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const supplierRoutes = express.Router();
supplierRoutes.use(authRequired);
supplierRoutes.use(requireRole(["admin", "operador"]));

// --- CRUD FORNECEDORES ---

supplierRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true } },
      },
    });
    res.json({ items });
  })
);

supplierRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1),
        nif: z.string().optional().nullable(),
        contact: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        email: z.string().email().optional().nullable(),
        address: z.string().optional().nullable(),
        category: z.string().optional().nullable(),
        iban: z.string().optional().nullable(),
        paymentTerm: z.string().optional().nullable(),
      })
      .parse(req.body);

    const created = await prisma.supplier.create({
      data: body,
    });
    res.status(201).json(created);
  })
);

supplierRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        nif: z.string().optional().nullable(),
        contact: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        email: z.string().email().optional().nullable(),
        address: z.string().optional().nullable(),
        category: z.string().optional().nullable(),
        iban: z.string().optional().nullable(),
        paymentTerm: z.string().optional().nullable(),
        active: z.boolean().optional(),
      })
      .parse(req.body);

    const updated = await prisma.supplier.update({
      where: { id },
      data: body,
    });
    res.json(updated);
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
