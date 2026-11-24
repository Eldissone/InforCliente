/**
 * RG9 Bancos (protótipo): sigla, nome, código do banco no IBAN (os 4
 * algarismos depois de «AO06») e os outros nomes com que o banco aparece nos
 * extratos e documentos. «Contas / Financ.» conta as contas e cartões da MBT
 * e os financiamentos desse banco.
 */
const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");

const bankRoutes = express.Router();
bankRoutes.use(authRequired);

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/** Um texto (banco de um cartão, entidade de um financiamento) é deste banco? */
function eDoBanco(texto, b) {
  const t = norm(texto);
  if (!t) return false;
  const nomes = [b.code, b.name, ...(b.aliases || [])].map(norm).filter(Boolean);
  return nomes.some((n) => t === n || (n.length >= 4 && t.includes(n)) || t.split(/[\s\-·/]+/).includes(n));
}

const bankSchema = z.object({
  code: z.string().trim().min(2).max(12),
  name: z.string().trim().min(2).max(120),
  ibanCode: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "O código no IBAN tem 4 algarismos")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  aliases: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  active: z.boolean().optional(),
});

bankRoutes.get(
  "/",
  requirePermission("financeiro", "view"),
  asyncHandler(async (_req, res) => {
    const [banks, cards, fins] = await Promise.all([
      prisma.bank.findMany({ orderBy: [{ ibanCode: { sort: "asc", nulls: "last" } }, { code: "asc" }] }),
      prisma.pettyCashCard.findMany({ where: { active: true }, select: { bank: true } }),
      prisma.financing.findMany({ select: { entity: true } }).catch(() => []),
    ]);
    const items = banks.map((b) => {
      const contas = cards.filter((c) => eDoBanco(c.bank, b)).length;
      const financiamentos = fins.filter((f) => eDoBanco(f.entity, b)).length;
      return { ...b, contas, financiamentos };
    });
    return res.json({ items });
  })
);

bankRoutes.post(
  "/",
  requirePermission("financeiro", "edit"),
  asyncHandler(async (req, res) => {
    const body = bankSchema.parse(req.body);
    const code = norm(body.code).replace(/\s+/g, "");
    if (await prisma.bank.findUnique({ where: { code } })) return res.status(409).json({ error: `Já existe o banco ${code}.` });
    const created = await prisma.bank.create({
      data: { code, name: body.name, ibanCode: body.ibanCode || null, aliases: (body.aliases || []).map(norm), active: body.active ?? true },
    });
    return res.status(201).json(created);
  })
);

bankRoutes.patch(
  "/:id",
  requirePermission("financeiro", "edit"),
  asyncHandler(async (req, res) => {
    const body = bankSchema.partial().parse(req.body);
    const atual = await prisma.bank.findUnique({ where: { id: req.params.id } });
    if (!atual) return res.status(404).json({ error: "Banco não encontrado." });
    const data = {};
    if (body.code) {
      const code = norm(body.code).replace(/\s+/g, "");
      const outro = await prisma.bank.findUnique({ where: { code } });
      if (outro && outro.id !== atual.id) return res.status(409).json({ error: `Já existe o banco ${code}.` });
      data.code = code;
    }
    if (body.name) data.name = body.name;
    if (body.ibanCode !== undefined) data.ibanCode = body.ibanCode || null;
    if (body.aliases) data.aliases = body.aliases.map(norm);
    if (body.active !== undefined) data.active = body.active;
    const updated = await prisma.bank.update({ where: { id: atual.id }, data });
    return res.json(updated);
  })
);

module.exports = { bankRoutes, eDoBanco };
