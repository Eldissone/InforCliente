/**
 * Área Compras e Stock — os ecrãs do `NAV_COMP` do protótipo que a app ainda
 * não tinha:
 *   GET /compras-stock/comparisons        C2 Mapas Comparativos
 *   GET /compras-stock/prices             C3 Base de Preços
 *   GET /compras-stock/commitments        C5 Compromissos Pendentes
 *   GET /compras-stock/supplier-accounts  C6 Conta Corrente de Fornecedores
 *        (?fornecedor=<chave> devolve o extrato desse fornecedor)
 *   GET /compras-stock/stock              S3 Stock por Armazém
 *   GET /compras-stock/movements          S4 Movimentos de Armazém
 *
 * Os restantes (cotações, fornecedores, requisições, entregas, armazéns,
 * ferramentas) já têm ecrã e API próprios.
 */

const express = require("express");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requireAnyPermission } = require("../middlewares/auth");
const {
  buildPayables,
  loadGeneralPurchasePayables,
  loadGeneralExtraPayables,
  loadRecentPayments,
} = require("./finance");
const { z } = require("zod");
const PT = require("../services/purchase/purchaseTotals");
const A = require("../services/compras/aggregates");

const SUPPLIER_NOTES_KEY = "fornecedores.notas_saldos";

async function readSupplierNotes() {
  const row = await prisma.companySetting.findUnique({ where: { key: SUPPLIER_NOTES_KEY } }).catch(() => null);
  return Array.isArray(row?.value) ? row.value : [];
}

async function writeSupplierNotes(list) {
  await prisma.companySetting.upsert({
    where: { key: SUPPLIER_NOTES_KEY },
    create: { key: SUPPLIER_NOTES_KEY, value: list, label: "Conta Corrente Fornecedores — Notas e Saldos Iniciais" },
    update: { value: list },
  });
}

const comprasStockRoutes = express.Router();
comprasStockRoutes.use(authRequired);

const viewStock = requireAnyPermission([
  ["stock", "view"],
  ["logistica", "view"],
  ["financeiro", "view"],
]);
const viewPurchases = requireAnyPermission([
  ["stock", "view"],
  ["logistica", "view"],
  ["financeiro", "view"],
]);

async function allPayables() {
  const [p, gp, ge] = await Promise.all([buildPayables(), loadGeneralPurchasePayables(), loadGeneralExtraPayables()]);
  return [...p, ...gp, ...ge];
}

comprasStockRoutes.get(
  "/comparisons",
  viewPurchases,
  asyncHandler(async (req, res) => {
    const desde = new Date();
    desde.setMonth(desde.getMonth() - Math.min(36, Math.max(1, Number(req.query.meses) || 12)));
    const needs = await prisma.workNeed.findMany({
      where: { quotes: { some: {} }, status: { not: "REJECTED" }, date: { gte: desde } },
      orderBy: { date: "desc" },
      take: 500,
      select: {
        id: true,
        description: true,
        quantity: true,
        unit: true,
        status: true,
        date: true,
        createdAt: true,
        project: { select: { code: true, name: true } },
        costCenter: { select: { name: true } },
        quotes: {
          select: {
            id: true,
            supplierId: true,
            quotedPrice: true,
            quantity: true,
            totalValue: true,
            netTotal: true,
            currency: true,
            creditTermDays: true,
            expectedReceiptDate: true,
            selected: true,
            proformaUrl: true,
            supplier: { select: { name: true } },
          },
        },
      },
    });
    return res.json(A.buildComparisons(needs));
  })
);

comprasStockRoutes.get(
  "/prices",
  viewPurchases,
  asyncHandler(async (_req, res) => {
    const [supplierProducts, quotes] = await Promise.all([
      prisma.supplierProduct.findMany({
        include: {
          supplier: { select: { id: true, name: true } },
          product: { select: { sku: true, name: true, unit: true, category: true } },
        },
      }),
      prisma.needQuote.findMany({
        where: { selected: true },
        orderBy: { updatedAt: "desc" },
        take: 2000,
        select: {
          id: true,
          supplierId: true,
          quotedPrice: true,
          quantity: true,
          totalValue: true,
          currency: true,
          vatPercent: true,
          creditTermDays: true,
          createdAt: true,
          updatedAt: true,
          supplier: { select: { id: true, name: true } },
          supplierProduct: { select: { name: true, unit: true } },
          need: {
            select: { description: true, unit: true, quantity: true, project: { select: { code: true } } },
          },
        },
      }),
    ]);
    return res.json(A.buildPriceBase({ supplierProducts, quotes }));
  })
);

comprasStockRoutes.get(
  "/commitments",
  viewPurchases,
  asyncHandler(async (_req, res) => {
    const [requisitions, payables] = await Promise.all([
      prisma.materialRequisition.findMany({
        where: { status: { in: ["SUBMETIDA", "APROVADA", "PARCIAL"] }, purchaseOrderId: null },
        select: {
          id: true,
          number: true,
          status: true,
          createdAt: true,
          projectId: true,
          justification: true,
          purchaseOrderId: true,
          project: { select: { code: true, name: true } },
          items: {
            select: { description: true, quantity: true, fulfilledQuantity: true, estimatedUnitPrice: true },
          },
        },
      }),
      allPayables(),
    ]);
    return res.json(A.buildCommitments({ requisitions, payables }));
  })
);

const editFinance = requireAnyPermission([
  ["financeiro", "edit"],
  ["fornecedores", "edit"],
]);

comprasStockRoutes.get(
  "/supplier-accounts",
  viewPurchases,
  asyncHandler(async (req, res) => {
    const moeda = String(req.query.moeda || "AOA").toUpperCase();
    const [payables, payments, suppliers, rawOrders, notes] = await Promise.all([
      allPayables(),
      loadRecentPayments(365),
      prisma.supplier.findMany({ select: { id: true, name: true, nif: true, profile: true } }),
      prisma.purchaseOrder.findMany({
        where: { deletedAt: null, type: "PEDIDO", status: { in: ["APROVADO", "EM_PAGAMENTO", "CONCLUIDO"] } },
        select: {
          id: true,
          number: true,
          description: true,
          currency: true,
          supplierId: true,
          supplierName: true,
          requestType: true,
          typeData: true,
          createdAt: true,
          dueDate: true,
          items: true,
          project: { select: { code: true, name: true } },
          requisition: { select: { quotedValue: true, attachments: { select: { fileName: true } } } },
          paymentPlan: { select: { installments: { select: { id: true, amount: true, paidAt: true, status: true, notes: true } } } },
        },
      }),
      readSupplierNotes(),
    ]);
    const orders = rawOrders.map((o) => {
      const t = PT.orderTotals(o);
      return {
        ...o,
        base: t.base,
        vat: t.vat,
        withheld: t.withheld,
        total: t.total,
        installments: o.paymentPlan?.installments || [],
      };
    });
    const input = { payables, payments, suppliers, orders, notes };
    if (req.query.fornecedor) {
      const ext = A.supplierStatement(input, String(req.query.fornecedor), moeda);
      if (!ext) return res.status(404).json({ error: "FORNECEDOR_SEM_MOVIMENTOS" });
      return res.json(ext);
    }
    return res.json({ ...A.buildSupplierAccounts(input, moeda), suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, nif: s.nif })) });
  })
);

comprasStockRoutes.post(
  "/supplier-notes",
  editFinance,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        tipo: z.enum(["NC", "ND", "SI"]),
        sentido: z.enum(["DIVIDA_FORN", "CREDITO_NOSSO"]).optional(),
        fornecedorId: z.string().nullable().optional(),
        fornecedor: z.string().trim().min(1),
        num: z.string().trim().nullable().optional(),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        venc: z.string().nullable().optional(),
        valor: z.number().positive(),
        moeda: z.string().default("AOA"),
        motivo: z.string().trim().nullable().optional(),
        pedidoNum: z.string().trim().nullable().optional(),
      })
      .parse(req.body);
    const list = await readSupplierNotes();
    const item = {
      id: `ncf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      ...body,
      moeda: String(body.moeda || "AOA").toUpperCase(),
      createdAt: new Date().toISOString(),
      createdBy: req.user?.name || req.user?.email || null,
    };
    list.push(item);
    await writeSupplierNotes(list);
    return res.status(201).json({ item });
  })
);

comprasStockRoutes.delete(
  "/supplier-notes/:id",
  editFinance,
  asyncHandler(async (req, res) => {
    const list = await readSupplierNotes();
    const next = list.filter((x) => x.id !== req.params.id);
    await writeSupplierNotes(next);
    return res.json({ ok: true });
  })
);

comprasStockRoutes.get(
  "/stock",
  viewStock,
  asyncHandler(async (_req, res) => {
    const [rows, warehouses] = await Promise.all([
      prisma.warehouseStock.findMany({
        where: { quantity: { gt: 0 } },
        include: {
          product: { select: { sku: true, name: true, category: true, unit: true, minStock: true } },
          warehouse: { select: { id: true, name: true, type: true, active: true, project: { select: { code: true } } } },
        },
      }),
      prisma.warehouse.findMany({
        where: { active: true },
        select: { id: true, name: true, type: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return res.json({ ...A.buildStockByWarehouse(rows), armazens: warehouses });
  })
);

const MOVE_TYPES = ["ENTRY", "EXIT", "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT", "LOSS", "ALLOCATION", "RETURN"];

comprasStockRoutes.get(
  "/movements",
  viewStock,
  asyncHandler(async (req, res) => {
    const where = {};
    const tipo = String(req.query.tipo || "").toUpperCase();
    if (MOVE_TYPES.includes(tipo)) where.type = tipo;
    if (req.query.armazem) where.warehouseId = String(req.query.armazem);
    const mes = String(req.query.mes || "");
    if (/^\d{4}-\d{2}$/.test(mes)) {
      const [y, m] = mes.split("-").map(Number);
      where.createdAt = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    }
    const q = String(req.query.q || "").trim();
    if (q) {
      where.OR = [
        { product: { name: { contains: q, mode: "insensitive" } } },
        { product: { sku: { contains: q, mode: "insensitive" } } },
        { reference: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
        { costDocNumber: { contains: q, mode: "insensitive" } },
      ];
    }
    const limit = Math.min(1000, Math.max(50, Number(req.query.limit) || 300));
    const [rows, warehouses] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        select: {
          id: true,
          type: true,
          quantity: true,
          notes: true,
          reference: true,
          createdAt: true,
          unitCost: true,
          totalValue: true,
          costDocNumber: true,
          userId: true,
          ownerId: true,
          product: { select: { sku: true, name: true, unit: true } },
          warehouse: { select: { id: true, name: true, type: true } },
          project: { select: { code: true, name: true } },
          requisition: { select: { number: true } },
        },
      }),
      prisma.warehouse.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    const more = rows.length > limit;
    const list = rows.slice(0, limit);
    const userIds = [...new Set(list.map((m) => m.userId).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userName = new Map(users.map((u) => [u.id, u.name || u.email]));
    const items = list.map((m) => {
      const q = Number(m.quantity || 0);
      const v = m.totalValue != null ? Number(m.totalValue) : m.unitCost != null ? q * Number(m.unitCost) : null;
      return {
        id: m.id,
        data: m.createdAt,
        tipo: m.type,
        produto: m.product?.name || "—",
        codigo: m.product?.sku || null,
        un: m.product?.unit ? String(m.product.unit).toLowerCase() : "",
        quantidade: q,
        armazem: m.warehouse?.name || "—",
        armazemId: m.warehouse?.id || null,
        obra: m.project?.code || null,
        referencia: m.reference || m.requisition?.number || m.costDocNumber || null,
        notas: m.notes || null,
        valor: v != null ? Math.round(v * 100) / 100 : null,
        por: userName.get(m.userId) || null,
      };
    });
    return res.json({ items, mais: more, limite: limit, armazens: warehouses });
  })
);

module.exports = { comprasStockRoutes };
