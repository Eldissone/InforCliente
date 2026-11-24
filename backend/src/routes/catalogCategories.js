/**
 * RG2 Categorias de produtos e serviços (protótipo): as categorias e
 * subcategorias que se escolhem ao criar um produto ou um serviço. Cada
 * categoria é de produtos ou de serviços; as subcategorias herdam o tipo.
 */
const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");

const catalogCategoryRoutes = express.Router();
catalogCategoryRoutes.use(authRequired);

const nome = (v) => String(v || "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-PT");
const chave = (v) =>
  nome(v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Todas, em árvore, com quantos produtos usam cada uma. */
catalogCategoryRoutes.get(
  "/",
  requirePermission("materiais", "view"),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.catalogCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { productsCategory: true, productsSub: true } } },
    });
    const items = rows
      .filter((r) => !r.parentId)
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        examples: c.examples,
        active: c.active,
        produtos: c._count.productsCategory,
        subs: rows
          .filter((s) => s.parentId === c.id)
          .map((s) => ({ id: s.id, name: s.name, examples: s.examples, active: s.active, produtos: s._count.productsSub })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt"));
    return res.json({ items });
  })
);

/** Nova categoria (sem parentId) ou subcategoria (com parentId). */
catalogCategoryRoutes.post(
  "/",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        kind: z.enum(["PRODUTO", "SERVICO"]).optional(),
        parentId: z.string().nullable().optional(),
        examples: z.string().max(300).nullable().optional(),
      })
      .parse(req.body);
    let kind = body.kind || "PRODUTO";
    if (body.parentId) {
      const pai = await prisma.catalogCategory.findUnique({ where: { id: body.parentId } });
      if (!pai || pai.parentId) return res.status(400).json({ error: "A categoria-mãe não existe." });
      kind = pai.kind;
    }
    const irmas = await prisma.catalogCategory.findMany({ where: { parentId: body.parentId || null }, select: { name: true } });
    if (irmas.some((x) => chave(x.name) === chave(body.name))) {
      return res.status(409).json({ error: body.parentId ? "Esta categoria já tem uma subcategoria com este nome." : "Já existe uma categoria com este nome." });
    }
    const created = await prisma.catalogCategory.create({
      data: { name: nome(body.name), kind, parentId: body.parentId || null, examples: body.examples || null },
    });
    return res.status(201).json(created);
  })
);

/** Mudar o nome, o tipo (só categorias) ou desativar. */
catalogCategoryRoutes.patch(
  "/:id",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        kind: z.enum(["PRODUTO", "SERVICO"]).optional(),
        examples: z.string().max(300).nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const atual = await prisma.catalogCategory.findUnique({ where: { id: req.params.id } });
    if (!atual) return res.status(404).json({ error: "Categoria não encontrada." });
    if (body.name) {
      const irmas = await prisma.catalogCategory.findMany({ where: { parentId: atual.parentId, id: { not: atual.id } }, select: { name: true } });
      if (irmas.some((x) => chave(x.name) === chave(body.name))) return res.status(409).json({ error: "Já existe outra com este nome." });
      body.name = nome(body.name);
    }
    if (atual.parentId) delete body.kind; // a subcategoria tem o tipo da categoria
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.catalogCategory.update({ where: { id: atual.id }, data: body });
      if (body.kind && !atual.parentId) await tx.catalogCategory.updateMany({ where: { parentId: atual.id }, data: { kind: body.kind } });
      return u;
    });
    return res.json(updated);
  })
);

/** Apagar: os produtos que a usavam ficam sem categoria / subcategoria. */
catalogCategoryRoutes.delete(
  "/:id",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const c = await prisma.catalogCategory.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { productsCategory: true, productsSub: true, children: true } } },
    });
    if (!c) return res.status(404).json({ error: "Categoria não encontrada." });
    await prisma.$transaction(async (tx) => {
      if (!c.parentId) {
        const subs = await tx.catalogCategory.findMany({ where: { parentId: c.id }, select: { id: true } });
        await tx.product.updateMany({ where: { catalogSubcategoryId: { in: subs.map((x) => x.id) } }, data: { catalogSubcategoryId: null } });
      }
      await tx.catalogCategory.delete({ where: { id: c.id } });
    });
    return res.json({ ok: true, produtos: c._count.productsCategory + c._count.productsSub });
  })
);

module.exports = { catalogCategoryRoutes };
