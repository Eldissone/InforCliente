/**
 * Centro de Pagamentos (P1) — Requisições de Pagamento.
 *
 * Uma requisição (RPaa-nnnn) pede o pagamento a um terceiro (PF) ou uma
 * transferência para um cartão de fundo de maneio (TRF INT). Percorre:
 *   Em cotação → Por aprovar → Em aberto → (Em trânsito) → Pago parcial → Pago
 * e fica Atrasado quando passa o vencimento sem estar paga.
 *
 * As contas a pagar que já existem no InfoCliente (custos de obra, pedidos
 * extra, encomendas, lançamentos) entram aqui como requisições-espelho
 * (`sourceRef`), para que tudo o que há a pagar esteja num só sítio.
 */
const express = require("express");
const path = require("path");
const multer = require("multer");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase, deleteStoredFile } = require("../utils/storage");
const { buildAllPayables } = require("./finance");

const paymentRequestRoutes = express.Router();
paymentRequestRoutes.use(authRequired);

const view = requirePermission("financeiro", "view");
const edit = requirePermission("financeiro", "edit");
const approve = requirePermission("financeiro", "approve");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const DAY_MS = 24 * 60 * 60 * 1000;
const MIRROR_SOURCES = ["PAGAMENTO", "PEDIDO_EXTRA", "PEDIDO_COMPRA", "LANCAMENTO", "FRETE", "ATM"];
const DOC_KINDS = ["PROFORMA", "FATURA", "AF", "DSC", "COMPROVATIVO", "OUTRO"];
const KIND_LABELS = { GERAL: "Pedido Geral (Sede)", OBRA: "Pedido para Obra", FROTA: "Frota e Equipamentos" };
const TYPE_LABELS = { PF: "Pagamento a Fornecedor", "TRF INT": "Transferência Interna" };
const STATE_LABELS = {
  EM_COTACAO: "Em cotação",
  POR_APROVAR: "Por aprovar",
  EM_PAUSA: "Em pausa",
  REJEITADO: "Rejeitado",
};
const FLEET_NATURES = ["COMB", "MANUT", "PECAS", "SEGURO", "INSPECAO", "PORTAGENS", "ALUGUER", "OUTRO"];

// ─── utilitários ─────────────────────────────────────────────────────────────

function num(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(num(value) * 100) / 100;
}

/** «AAAA-MM-DD» → Date ao meio-dia UTC (evita que o fuso mude o dia). */
function parseDay(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(`${s}T12:00:00.000Z`);
}

function dayKey(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function todayKey() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysKey(key, days) {
  const d = parseDay(key);
  if (!d) return null;
  return dayKey(new Date(d.getTime() + days * DAY_MS));
}

function actorName(req) {
  return req.user?.name || req.user?.email || "Utilizador";
}

function isAdmin(req) {
  return String(req.user?.role || "").toLowerCase() === "admin";
}

function safeFileName(rawName) {
  const base = path
    .basename(String(rawName || "documento"))
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return base || "documento";
}

async function storeFile(folder, file) {
  if (!file) return null;
  const storagePath = `finance/${folder}/${Date.now()}-${safeFileName(file.originalname)}`;
  const stored = await uploadToSupabase(storagePath, file.buffer, file.mimetype);
  return { path: stored, name: file.originalname || null, mimeType: file.mimetype || null, size: file.size || null };
}

// ─── cálculos ────────────────────────────────────────────────────────────────

/** Valores de uma linha: base (com desconto), IVA e retenção na fonte. */
function lineAmounts(item) {
  const base = num(item.quantity) * num(item.unitPrice) * (1 - num(item.discountPercent) / 100);
  return {
    base,
    vat: (base * num(item.vatPercent)) / 100,
    withholding: (base * num(item.withholdingPercent)) / 100,
  };
}

function computeTotals(items) {
  let base = 0;
  let vat = 0;
  let withholding = 0;
  (items || []).forEach((i) => {
    const l = lineAmounts(i);
    base += l.base;
    vat += l.vat;
    withholding += l.withholding;
  });
  return {
    baseAmount: round2(base),
    vatAmount: round2(vat),
    withholdingAmount: round2(withholding),
    totalAmount: round2(base + vat - withholding),
  };
}

function paidOf(pr) {
  const own = (pr.payments || []).reduce((a, p) => a + num(p.amount), 0);
  // Espelhos: a origem pode ter sido paga noutro ecrã do InfoCliente.
  return round2(Math.max(own, pr.sourceRef ? num(pr.paidAmount) : 0));
}

/** Próximo vencimento: em parcelas, a primeira ainda não coberta pelo pago. */
function nextDue(pr, paid) {
  const inst = (pr.installments || []).slice().sort((a, b) => a.number - b.number);
  if (pr.condition === "PARCIAL" && inst.length) {
    let acc = 0;
    for (const p of inst) {
      acc += num(p.amount);
      if (acc > paid + 0.5) return dayKey(p.dueDate);
    }
    return dayKey(inst[inst.length - 1].dueDate);
  }
  return dayKey(pr.dueDate);
}

/** Estado mostrado ao utilizador (como no programa de orçamentação). */
function displayStatus(pr, paid, due, today = todayKey()) {
  if (STATE_LABELS[pr.state]) return STATE_LABELS[pr.state];
  const total = num(pr.totalAmount);
  if (total > 0 && paid >= total - 0.5) return "Pago";
  if (pr.inTransit) return "Em trânsito";
  if (due && due < today) return "Atrasado";
  return paid > 0 ? "Pago parcial" : "Em aberto";
}

function serialize(pr, { today = todayKey() } = {}) {
  const paid = paidOf(pr);
  const due = nextDue(pr, paid);
  const status = displayStatus(pr, paid, due, today);
  const total = num(pr.totalAmount);
  const docs = pr.documents || [];
  const invoices = docs.filter((d) => ["FATURA", "AF", "DSC"].includes(d.kind));
  const proofs = [
    ...docs.filter((d) => d.kind === "COMPROVATIVO" && d.path),
    ...(pr.payments || []).filter((p) => p.proofPath).map((p) => ({ id: p.id, kind: "COMPROVATIVO", path: p.proofPath, name: p.proofName })),
  ];
  const proforma = docs.find((d) => d.kind === "PROFORMA" && d.path) || docs.find((d) => d.kind === "OUTRO" && d.path) || null;
  const items = (pr.items || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((i) => ({
      id: i.id,
      productId: i.productId,
      code: i.code,
      description: i.description,
      unit: i.unit,
      quantity: num(i.quantity),
      unitPrice: num(i.unitPrice),
      vatPercent: num(i.vatPercent),
      withholdingPercent: num(i.withholdingPercent),
      discountPercent: num(i.discountPercent),
      notes: i.notes,
      supplierId: i.supplierId,
      supplierName: i.supplierName,
      total: round2(lineAmounts(i).base),
    }));
  const isPaid = status === "Pago";
  const needsInvoice = !pr.noInvoice && !["Por aprovar", "Em cotação", "Rejeitado"].includes(status) && !invoices.some((d) => d.kind === "DSC" || d.kind === "AF");
  return {
    id: pr.id,
    number: pr.number,
    kind: pr.kind,
    kindLabel: KIND_LABELS[pr.kind] || pr.kind,
    mode: pr.mode,
    typeCode: pr.typeCode,
    typeLabel: TYPE_LABELS[pr.typeCode] || pr.typeCode,
    requestDate: dayKey(pr.requestDate),
    currency: pr.currency,
    requiresQuote: pr.requiresQuote,
    supplierId: pr.supplierId,
    supplierName: pr.supplierName,
    supplierNif: pr.supplierNif,
    supplierIban: pr.supplierIban,
    supplierBank: pr.supplierBank,
    supplierEmail: pr.supplierEmail,
    fundCardId: pr.fundCardId,
    projectId: pr.projectId,
    project: pr.project ? { id: pr.project.id, code: pr.project.code, name: pr.project.name } : null,
    costCenterCode: pr.costCenterCode,
    vehicle: pr.vehicle,
    fleetNature: pr.fleetNature,
    mileage: pr.mileage === null || pr.mileage === undefined ? null : num(pr.mileage),
    condition: pr.condition,
    creditDays: pr.creditDays,
    dueDate: dayKey(pr.dueDate),
    nextDue: due,
    daysLate: due && !isPaid ? Math.round((parseDay(today) - parseDay(due)) / DAY_MS) : null,
    notes: pr.notes,
    state: pr.state,
    status,
    inTransit: pr.inTransit,
    stateReason: pr.stateReason,
    approvedBy: pr.approvedBy,
    approvedAt: pr.approvedAt,
    requestedBy: pr.requestedBy,
    requestedById: pr.requestedById,
    baseAmount: num(pr.baseAmount),
    vatAmount: num(pr.vatAmount),
    withholdingAmount: num(pr.withholdingAmount),
    totalAmount: total,
    paidAmount: paid,
    openAmount: round2(Math.max(total - paid, 0)),
    noInvoice: pr.noInvoice,
    sourceType: pr.sourceType,
    sourceId: pr.sourceId,
    sourceRef: pr.sourceRef,
    sourceMeta: pr.sourceMeta || null,
    items,
    splits: (pr.splits || []).map((s) => ({ id: s.id, projectId: s.projectId, costCenterCode: s.costCenterCode, label: s.label, percent: num(s.percent) })),
    installments: (pr.installments || [])
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((p) => ({ id: p.id, number: p.number, dueDate: dayKey(p.dueDate), amount: num(p.amount) })),
    payments: (pr.payments || [])
      .slice()
      .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt))
      .map((p) => ({
        id: p.id,
        paidAt: dayKey(p.paidAt),
        amount: num(p.amount),
        cardId: p.cardId,
        reference: p.reference,
        proofPath: p.proofPath,
        proofName: p.proofName,
        bankMovementId: p.bankMovementId,
        createdBy: p.createdBy,
      })),
    documents: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      number: d.number,
      supplierName: d.supplierName,
      docDate: dayKey(d.docDate),
      amount: d.amount === null ? null : num(d.amount),
      path: d.path,
      name: d.name,
      createdBy: d.createdBy,
      createdAt: d.createdAt,
    })),
    history: (pr.history || [])
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((h) => ({ id: h.id, text: h.text, by: h.by, at: h.createdAt })),
    reconciledMovements: (pr.bankMovements || []).map((m) => ({
      id: m.id,
      amount: num(m.amount),
      movementDate: dayKey(m.movementDate),
      description: m.description,
      cardId: m.cardId,
    })),
    docState: {
      proforma: proforma ? { path: proforma.path, name: proforma.name } : null,
      proformaNeeded: pr.mode !== "FM" && pr.requiresQuote,
      invoices: invoices.length,
      invoiceNeeded: needsInvoice,
      invoiceDsc: invoices.some((d) => d.kind === "DSC"),
      proofs: proofs.length,
      proof: proofs[0] ? { path: proofs[0].path, name: proofs[0].name } : null,
      proofNeeded: paid > 0,
    },
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
  };
}

const FULL_INCLUDE = {
  project: { select: { id: true, code: true, name: true } },
  items: true,
  splits: true,
  installments: true,
  payments: true,
  documents: { orderBy: { createdAt: "asc" } },
  history: true,
  bankMovements: { select: { id: true, amount: true, movementDate: true, description: true, cardId: true } },
};

async function loadFull(id) {
  return prisma.paymentRequest.findUnique({ where: { id }, include: FULL_INCLUDE });
}

/** Recalcula o pago em cache a partir dos pagamentos. */
async function refreshPaid(tx, id) {
  const pr = await tx.paymentRequest.findUnique({ where: { id }, include: { payments: true } });
  if (!pr) return null;
  const own = round2(pr.payments.reduce((a, p) => a + num(p.amount), 0));
  const paidAmount = pr.sourceRef ? Math.max(own, num(pr.paidAmount)) : own;
  return tx.paymentRequest.update({ where: { id }, data: { paidAmount } });
}

// ─── numeração ───────────────────────────────────────────────────────────────

async function nextNumber(tx, date = new Date()) {
  const yy = String(date.getFullYear()).slice(2);
  const prefix = `RP${yy}-`;
  const last = await tx.paymentRequest.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = last ? Number(last.number.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(4, "0")}`;
}

/** Cria com número sequencial; repete se outro pedido levou o mesmo número. */
async function createWithNumber(build) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const number = await nextNumber(tx);
        return build(tx, number);
      });
    } catch (err) {
      if (err?.code === "P2002" && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error("NUMBER_ALLOCATION_FAILED");
}

// ─── requisições-espelho (ligação ao resto do InfoCliente) ────────────────────

let syncRunning = null;

/**
 * Traz para o Centro de Pagamentos as contas a pagar do InfoCliente que ainda
 * não estão cá (custos de obra, pedidos extra, encomendas, lançamentos) e
 * atualiza o pago das que já estão. O que desapareceu do ledger foi liquidado
 * na origem e fica pago.
 */
async function syncMirrors() {
  if (syncRunning) return syncRunning;
  syncRunning = (async () => {
    const payables = (await buildAllPayables()).filter((p) => p.stage === "A_PAGAR" && MIRROR_SOURCES.includes(p.source));
    const existing = await prisma.paymentRequest.findMany({
      where: { sourceRef: { not: null } },
      select: { id: true, sourceRef: true, totalAmount: true, paidAmount: true, dueDate: true, sourceMeta: true },
    });
    const byRef = new Map(existing.map((e) => [e.sourceRef, e]));
    const seen = new Set();

    for (const p of payables) {
      seen.add(p.id);
      const total = round2(p.amount);
      const paid = round2(p.paidAmount);
      const meta = {
        source: p.source,
        sourceLabel: p.sourceLabel,
        detail: p.detail,
        status: p.status,
        costCenterId: p.costCenterId,
        costCenterName: p.costCenter?.name || null,
        docNumber: p.docNumber,
      };
      const prev = byRef.get(p.id);
      if (prev) {
        if (Math.abs(num(prev.totalAmount) - total) > 0.005 || Math.abs(num(prev.paidAmount) - paid) > 0.005 || dayKey(prev.dueDate) !== dayKey(p.dueDate)) {
          await prisma.paymentRequest.update({
            where: { id: prev.id },
            data: { totalAmount: total, baseAmount: total, paidAmount: Math.max(paid, num(prev.paidAmount)), dueDate: p.dueDate ? new Date(p.dueDate) : null, sourceMeta: meta },
          });
        }
        continue;
      }
      await createWithNumber((tx, number) =>
        tx.paymentRequest.create({
          data: {
            number,
            kind: p.projectId ? "OBRA" : "GERAL",
            mode: "FORN",
            typeCode: "PF",
            requestDate: p.date ? new Date(p.date) : new Date(),
            currency: p.currency || "AOA",
            requiresQuote: false,
            supplierId: p.supplierId || null,
            supplierName: p.supplier || null,
            projectId: p.projectId || null,
            costCenterCode: p.project?.code ? `CC-${p.project.code}` : "CC-SEDE",
            condition: p.dueDate ? "CREDITO" : "PRONTO",
            dueDate: p.dueDate ? new Date(p.dueDate) : null,
            state: "APROVADO",
            approvedBy: "InfoCliente",
            approvedAt: new Date(),
            requestedBy: p.sourceLabel || "InfoCliente",
            baseAmount: total,
            totalAmount: total,
            paidAmount: paid,
            sourceType: p.source,
            sourceId: p.sourceId,
            sourceRef: p.id,
            sourceMeta: meta,
            items: { create: [{ order: 0, description: p.description || p.sourceLabel || "Pagamento", unit: "UN", quantity: 1, unitPrice: total }] },
            history: { create: [{ text: `Criada a partir de ${p.sourceLabel || p.source}${p.docNumber ? ` (${p.docNumber})` : ""}`, by: "InfoCliente" }] },
          },
        })
      );
    }

    // Saíram do ledger: liquidadas na origem.
    for (const e of existing) {
      if (seen.has(e.sourceRef)) continue;
      if (num(e.paidAmount) >= num(e.totalAmount) - 0.005) continue;
      await prisma.paymentRequest.update({ where: { id: e.id }, data: { paidAmount: e.totalAmount } });
    }
  })().finally(() => {
    syncRunning = null;
  });
  return syncRunning;
}

// ─── validação ───────────────────────────────────────────────────────────────

const itemSchema = z.object({
  productId: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  description: z.string().default(""),
  unit: z.string().nullable().optional(),
  quantity: z.coerce.number().default(1),
  unitPrice: z.coerce.number().default(0),
  vatPercent: z.coerce.number().min(0).max(100).default(0),
  withholdingPercent: z.coerce.number().min(0).max(100).default(0),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  supplierName: z.string().nullable().optional(),
});

const requestSchema = z.object({
  kind: z.enum(["GERAL", "OBRA", "FROTA"]).default("GERAL"),
  mode: z.enum(["FORN", "FM"]).default("FORN"),
  requestDate: z.string().nullable().optional(),
  currency: z.enum(["AOA", "USD", "EUR"]).default("AOA"),
  requiresQuote: z.boolean().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  supplierNif: z.string().nullable().optional(),
  supplierIban: z.string().nullable().optional(),
  supplierBank: z.string().nullable().optional(),
  supplierEmail: z.string().nullable().optional(),
  fundCardId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  vehicle: z.string().nullable().optional(),
  fleetNature: z.string().nullable().optional(),
  mileage: z.coerce.number().nullable().optional(),
  condition: z.enum(["PRONTO", "CREDITO", "PARCIAL"]).default("PRONTO"),
  creditDays: z.coerce.number().int().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  noInvoice: z.boolean().optional(),
  items: z.array(itemSchema).default([]),
  splits: z
    .array(
      z.object({
        projectId: z.string().nullable().optional(),
        costCenterCode: z.string().min(1),
        label: z.string().nullable().optional(),
        percent: z.coerce.number(),
      })
    )
    .default([]),
  installments: z.array(z.object({ dueDate: z.string().nullable().optional(), amount: z.coerce.number() })).default([]),
  // Registar a partir de movimentos do banco (já pago e conciliado).
  fromMovementIds: z.array(z.string()).optional(),
});

/** Erros de preenchimento, pela ordem do formulário (iguais ao programa de orçamentação). */
function validateRequest(data, { isNew, hasFundCards }) {
  const errors = [];
  const items = (data.items || []).filter((i) => String(i.description || "").trim());
  const totals = computeTotals(items);
  const quoting = isNew && data.requiresQuote === true;
  const fromBank = Array.isArray(data.fromMovementIds) && data.fromMovementIds.length > 0;

  if (isNew && !fromBank && (data.requiresQuote === null || data.requiresQuote === undefined)) errors.push("requer cotação? (sim / não)");
  if (data.kind === "OBRA" && !data.projectId && !(data.splits || []).some((s) => s.projectId)) errors.push("obra");
  if (data.kind === "FROTA") {
    if (!String(data.vehicle || "").trim()) errors.push("viatura / equipamento");
    if (!data.fleetNature) errors.push("natureza do custo de frota");
  }
  if (data.mode === "FORN" && !quoting && !String(data.supplierName || "").trim()) errors.push("terceiro");
  if (data.mode === "FM") {
    if (!data.fundCardId && hasFundCards) errors.push("conta do fundo de maneio");
    if (items.some((i) => !String(i.supplierName || "").trim())) errors.push("fornecedor de cada item");
  }
  if (!items.length) errors.push("descrição de pelo menos um item");
  if (!(totals.totalAmount > 0) && !quoting) errors.push("valores dos itens");
  if (data.condition === "CREDITO" && !data.dueDate && !data.creditDays) errors.push("data de vencimento do crédito");
  if (data.condition === "PARCIAL") {
    const inst = data.installments || [];
    if (inst.length < 2) errors.push("pelo menos duas parcelas");
    if (inst.some((p) => !p.dueDate)) errors.push("data de cada parcela");
    const sum = inst.reduce((a, p) => a + num(p.amount), 0);
    if (Math.abs(sum - totals.totalAmount) > 0.5) errors.push(`soma das parcelas igual ao total (${totals.totalAmount.toFixed(2)})`);
  }
  if ((data.splits || []).length) {
    const sum = data.splits.reduce((a, s) => a + num(s.percent), 0);
    if (Math.abs(sum - 100) > 0.01) errors.push("centros de custo a somar 100%");
  }
  return { errors, items, totals };
}

/** Centro de custo principal (o de maior %; obra → CC-<código>). */
async function resolveCostCenter(data) {
  if ((data.splits || []).length) {
    const top = data.splits.slice().sort((a, b) => num(b.percent) - num(a.percent))[0];
    return { code: top.costCenterCode, projectId: data.projectId || top.projectId || null };
  }
  if (data.kind === "FROTA") return { code: "CC-FROTA", projectId: data.projectId || null };
  if (data.projectId) {
    const p = await prisma.project.findUnique({ where: { id: data.projectId }, select: { code: true } });
    return { code: p ? `CC-${p.code}` : "CC-SEDE", projectId: data.projectId };
  }
  return { code: "CC-SEDE", projectId: null };
}

/** Terceiro: cria o fornecedor se ainda não existe e completa dados em falta. */
async function ensureSupplier(data) {
  if (data.mode !== "FORN") return data.supplierId || null;
  const name = String(data.supplierName || "").trim();
  if (!name) return null;
  if (data.supplierId) {
    const s = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
    if (s) {
      const patch = {};
      if (data.supplierNif && !s.nif) patch.nif = data.supplierNif;
      if (data.supplierIban && !s.iban) patch.iban = data.supplierIban;
      if (data.supplierEmail && !s.email) patch.email = data.supplierEmail;
      if (Object.keys(patch).length) await prisma.supplier.update({ where: { id: s.id }, data: patch });
      return s.id;
    }
  }
  const found = await prisma.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (found) return found.id;
  const created = await prisma.supplier.create({
    data: { name, nif: data.supplierNif || null, iban: data.supplierIban || null, email: data.supplierEmail || null, type: "MATERIAL" },
  });
  return created.id;
}

function buildRelations(items, data) {
  return {
    items: items.map((i, idx) => ({
      order: idx,
      productId: i.productId || null,
      code: i.code || null,
      description: String(i.description).trim(),
      unit: i.unit || "UN",
      quantity: num(i.quantity) || 0,
      unitPrice: num(i.unitPrice),
      vatPercent: num(i.vatPercent),
      withholdingPercent: num(i.withholdingPercent),
      discountPercent: num(i.discountPercent),
      notes: i.notes || null,
      supplierId: i.supplierId || null,
      supplierName: i.supplierName || null,
    })),
    splits: (data.splits || []).map((s) => ({
      projectId: s.projectId || null,
      costCenterCode: s.costCenterCode,
      label: s.label || null,
      percent: num(s.percent),
    })),
    installments:
      data.condition === "PARCIAL"
        ? (data.installments || []).map((p, idx) => ({ number: idx + 1, dueDate: parseDay(p.dueDate), amount: round2(p.amount) }))
        : [],
  };
}

function dueDateFor(data) {
  const reqDay = dayKey(parseDay(data.requestDate) || new Date());
  if (data.condition === "PARCIAL") {
    const inst = (data.installments || []).filter((p) => p.dueDate).map((p) => dayKey(parseDay(p.dueDate))).sort();
    return parseDay(inst[inst.length - 1] || reqDay);
  }
  if (data.condition === "CREDITO") {
    if (data.dueDate) return parseDay(data.dueDate);
    return parseDay(addDaysKey(reqDay, num(data.creditDays) || 30));
  }
  return parseDay(data.dueDate || reqDay);
}

// ─── rotas ───────────────────────────────────────────────────────────────────

/** Listas para o formulário: terceiros, produtos, obras, contas e cartões. */
paymentRequestRoutes.get(
  "/options",
  view,
  asyncHandler(async (_req, res) => {
    const [suppliers, products, projects, cards, generalCostCenters] = await Promise.all([
      prisma.supplier.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          nif: true,
          iban: true,
          email: true,
          vatPercent: true,
          withholdingPercent: true,
          bankAccounts: { select: { bankName: true, iban: true, isPrimary: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.product.findMany({
        where: { active: true },
        select: { id: true, sku: true, name: true, unit: true, category: true },
        orderBy: { name: "asc" },
      }),
      prisma.project.findMany({
        where: { active: true },
        select: { id: true, code: true, name: true, status: true },
        orderBy: { code: "asc" },
      }),
      prisma.pettyCashCard.findMany({
        where: { active: true },
        select: {
          id: true,
          label: true,
          bank: true,
          lastDigits: true,
          type: true,
          holderName: true,
          fund: { select: { name: true, currency: true, project: { select: { code: true } } } },
        },
        orderBy: { label: "asc" },
      }),
      prisma.generalCostCenter.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    ]);
    return res.json({
      suppliers: suppliers.map((s) => {
        const primary = s.bankAccounts.find((b) => b.isPrimary) || s.bankAccounts[0] || null;
        return {
          id: s.id,
          name: s.name,
          nif: s.nif,
          iban: s.iban || primary?.iban || null,
          bank: primary?.bankName || null,
          email: s.email,
          vatPercent: s.vatPercent === null ? null : num(s.vatPercent),
          withholdingPercent: s.withholdingPercent === null ? null : num(s.withholdingPercent),
        };
      }),
      products: products.map((p) => ({ id: p.id, code: p.sku, name: p.name, unit: p.unit, category: p.category })),
      projects,
      cards: cards.map((c) => ({
        id: c.id,
        label: c.label,
        bank: c.bank,
        lastDigits: c.lastDigits,
        type: c.type,
        holder: c.holderName,
        fund: c.fund?.name || null,
        currency: c.fund?.currency || "AOA",
        projectCode: c.fund?.project?.code || null,
      })),
      costCenters: [
        { code: "CC-SEDE", name: "Sede / estrutura", type: "SEDE" },
        { code: "CC-FROTA", name: "Frota e maquinaria", type: "FROTA" },
        ...generalCostCenters.filter((g) => !["CC-SEDE", "CC-FROTA"].includes(g.code)).map((g) => ({ code: g.code, name: g.name, type: "OUTRO" })),
        ...projects.map((p) => ({ code: `CC-${p.code}`, name: `${p.code} · ${p.name}`, type: "OBRA", projectId: p.id })),
      ],
      fleetNatures: FLEET_NATURES,
      user: { name: null },
    });
  })
);

paymentRequestRoutes.get(
  "/",
  view,
  asyncHandler(async (req, res) => {
    if (req.query.sync !== "0") {
      try {
        await syncMirrors();
      } catch (err) {
        console.error("payment-requests: sync falhou", err);
      }
    }
    const rows = await prisma.paymentRequest.findMany({ include: FULL_INCLUDE, orderBy: [{ createdAt: "desc" }] });
    const today = todayKey();
    return res.json({ today, items: rows.map((r) => serialize(r, { today })) });
  })
);

paymentRequestRoutes.get(
  "/:id",
  view,
  asyncHandler(async (req, res) => {
    const pr = await loadFull(req.params.id);
    if (!pr) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({ item: serialize(pr) });
  })
);

paymentRequestRoutes.post(
  "/",
  edit,
  asyncHandler(async (req, res) => {
    const data = requestSchema.parse(req.body);
    const hasFundCards = (await prisma.pettyCashCard.count({ where: { active: true } })) > 0;
    const { errors, items, totals } = validateRequest(data, { isNew: true, hasFundCards });
    const fromIds = data.fromMovementIds || [];
    let movements = [];
    if (fromIds.length) {
      movements = await prisma.bankMovement.findMany({ where: { id: { in: fromIds } } });
      if (movements.length !== fromIds.length) errors.push("movimentos do banco");
      if (movements.some((m) => m.paymentRequestId || m.reconciledAt)) errors.push("movimentos ainda por conciliar");
      const movTotal = round2(movements.reduce((a, m) => a + num(m.amount), 0));
      if (totals.totalAmount > movTotal + 0.5) errors.push(`o total do pedido (${totals.totalAmount.toFixed(2)}) é maior do que o valor do banco (${movTotal.toFixed(2)})`);
    }
    if (errors.length) return res.status(400).json({ error: "VALIDATION", errors, message: `Falta: ${errors.join(", ")}.` });

    const supplierId = await ensureSupplier(data);
    const cc = await resolveCostCenter(data);
    const rel = buildRelations(items, data);
    const actor = actorName(req);
    const fromBank = movements.length > 0;
    const requiresQuote = !fromBank && data.requiresQuote === true;
    const state = fromBank ? "APROVADO" : requiresQuote ? "EM_COTACAO" : "POR_APROVAR";

    const created = await createWithNumber(async (tx, number) => {
      const pr = await tx.paymentRequest.create({
        data: {
          number,
          kind: data.kind,
          mode: data.mode,
          typeCode: data.mode === "FM" ? "TRF INT" : "PF",
          requestDate: parseDay(data.requestDate) || new Date(),
          currency: data.currency,
          requiresQuote,
          supplierId,
          supplierName: data.mode === "FM" ? data.supplierName || "Fundo de maneio" : data.supplierName || null,
          supplierNif: data.supplierNif || null,
          supplierIban: data.supplierIban || null,
          supplierBank: data.supplierBank || null,
          supplierEmail: data.supplierEmail || null,
          fundCardId: data.mode === "FM" ? data.fundCardId || null : null,
          projectId: cc.projectId,
          costCenterCode: cc.code,
          vehicle: data.kind === "FROTA" ? data.vehicle || null : null,
          fleetNature: data.kind === "FROTA" ? data.fleetNature || null : null,
          mileage: data.kind === "FROTA" && data.mileage ? data.mileage : null,
          condition: fromBank ? "PRONTO" : data.condition,
          creditDays: data.condition === "CREDITO" ? data.creditDays || null : null,
          dueDate: fromBank ? movements[0].movementDate : dueDateFor(data),
          notes: data.notes || null,
          state,
          approvedBy: fromBank ? actor : null,
          approvedAt: fromBank ? new Date() : null,
          requestedBy: actor,
          requestedById: req.user?.sub || null,
          ...totals,
          noInvoice: Boolean(data.noInvoice),
          items: { create: rel.items },
          splits: { create: rel.splits },
          installments: { create: fromBank ? [] : rel.installments },
          history: {
            create: [
              {
                by: actor,
                text: fromBank
                  ? "Registada a partir do banco — já paga e conciliada"
                  : requiresQuote
                    ? "Requisição criada e enviada às Compras para cotação"
                    : "Requisição criada e submetida para aprovação",
              },
            ],
          },
        },
      });
      if (fromBank) {
        let left = totals.totalAmount;
        for (const m of movements) {
          const amount = round2(Math.min(num(m.amount), left));
          left = round2(left - amount);
          await tx.paymentRequestPayment.create({
            data: { requestId: pr.id, paidAt: m.movementDate, amount, cardId: m.cardId, reference: m.docNumber || null, bankMovementId: m.id, createdBy: actor },
          });
          await tx.bankMovement.update({
            where: { id: m.id },
            data: { paymentRequestId: pr.id, reconcileKind: "REQUEST", reconciledAt: new Date(), reconciledBy: actor, typeCode: m.typeCode || pr.typeCode },
          });
        }
        await refreshPaid(tx, pr.id);
      }
      return pr;
    });

    return res.status(201).json({ item: serialize(await loadFull(created.id)) });
  })
);

paymentRequestRoutes.patch(
  "/:id",
  edit,
  asyncHandler(async (req, res) => {
    const prev = await prisma.paymentRequest.findUnique({ where: { id: req.params.id }, include: { payments: true } });
    if (!prev) return res.status(404).json({ error: "NOT_FOUND" });
    const data = requestSchema.parse(req.body);
    const hasFundCards = (await prisma.pettyCashCard.count({ where: { active: true } })) > 0;
    const { errors, items, totals } = validateRequest(data, { isNew: false, hasFundCards });
    const paid = round2(prev.payments.reduce((a, p) => a + num(p.amount), 0));
    if (paid > totals.totalAmount + 0.5) errors.push(`o total (${totals.totalAmount.toFixed(2)}) não pode ser menor do que o já pago (${paid.toFixed(2)})`);
    if (errors.length) return res.status(400).json({ error: "VALIDATION", errors, message: `Falta: ${errors.join(", ")}.` });

    const supplierId = await ensureSupplier(data);
    const cc = await resolveCostCenter(data);
    const rel = buildRelations(items, data);
    const actor = actorName(req);
    // Corrigir uma requisição rejeitada volta a submetê-la.
    const state = prev.state === "REJEITADO" ? "POR_APROVAR" : prev.state;

    await prisma.$transaction(async (tx) => {
      await tx.paymentRequestItem.deleteMany({ where: { requestId: prev.id } });
      await tx.paymentRequestSplit.deleteMany({ where: { requestId: prev.id } });
      await tx.paymentRequestInstallment.deleteMany({ where: { requestId: prev.id } });
      await tx.paymentRequest.update({
        where: { id: prev.id },
        data: {
          kind: data.kind,
          mode: data.mode,
          typeCode: data.mode === "FM" ? "TRF INT" : "PF",
          requestDate: parseDay(data.requestDate) || prev.requestDate,
          currency: data.currency,
          supplierId,
          supplierName: data.mode === "FM" ? data.supplierName || "Fundo de maneio" : data.supplierName || null,
          supplierNif: data.supplierNif || null,
          supplierIban: data.supplierIban || null,
          supplierBank: data.supplierBank || null,
          supplierEmail: data.supplierEmail || null,
          fundCardId: data.mode === "FM" ? data.fundCardId || null : null,
          projectId: cc.projectId,
          costCenterCode: cc.code,
          vehicle: data.kind === "FROTA" ? data.vehicle || null : null,
          fleetNature: data.kind === "FROTA" ? data.fleetNature || null : null,
          mileage: data.kind === "FROTA" && data.mileage ? data.mileage : null,
          condition: data.condition,
          creditDays: data.condition === "CREDITO" ? data.creditDays || null : null,
          dueDate: dueDateFor(data),
          notes: data.notes || null,
          noInvoice: Boolean(data.noInvoice),
          state,
          stateReason: state !== prev.state ? null : prev.stateReason,
          ...totals,
          items: { create: rel.items },
          splits: { create: rel.splits },
          installments: { create: rel.installments },
          history: { create: [{ by: actor, text: prev.state === "REJEITADO" ? "Requisição corrigida e submetida de novo" : "Requisição alterada" }] },
        },
      });
    });
    return res.json({ item: serialize(await loadFull(prev.id)) });
  })
);

const ACTIONS = ["approve", "reject", "pause", "resume", "transit", "untransit", "quoted"];

paymentRequestRoutes.post(
  "/:id/action",
  edit,
  asyncHandler(async (req, res, next) => {
    const { action, reason } = z.object({ action: z.enum(ACTIONS), reason: z.string().nullable().optional() }).parse(req.body);
    // Aprovar, rejeitar, pausar e retomar são da Direção / administração.
    if (["approve", "reject", "resume"].includes(action)) {
      return approve(req, res, () => next());
    }
    return next();
  }),
  asyncHandler(async (req, res) => {
    const { action, reason } = req.body;
    const pr = await prisma.paymentRequest.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: "NOT_FOUND" });
    const actor = actorName(req);
    const data = {};
    let text = "";
    if (action === "approve") {
      if (pr.state !== "POR_APROVAR") return res.status(409).json({ error: "STATE", message: "Só se aprova uma requisição por aprovar." });
      Object.assign(data, { state: "APROVADO", approvedBy: actor, approvedAt: new Date(), stateReason: null });
      text = "Aprovada";
    } else if (action === "reject") {
      if (!String(reason || "").trim()) return res.status(400).json({ error: "REASON", message: "Indique o motivo da rejeição." });
      Object.assign(data, { state: "REJEITADO", stateReason: reason.trim() });
      text = `Rejeitada: ${reason.trim()}`;
    } else if (action === "pause") {
      Object.assign(data, { state: "EM_PAUSA", stateReason: reason ? String(reason).trim() : null });
      text = `Posta em pausa${reason ? `: ${String(reason).trim()}` : ""}`;
    } else if (action === "resume") {
      Object.assign(data, { state: pr.approvedAt ? "APROVADO" : "POR_APROVAR", stateReason: null });
      text = "Retomada";
    } else if (action === "transit") {
      Object.assign(data, { inTransit: true });
      text = "Em trânsito bancário — pago no banco, à espera da aprovação do superior";
    } else if (action === "untransit") {
      Object.assign(data, { inTransit: false });
      text = "Saiu de «em trânsito»";
    } else if (action === "quoted") {
      if (pr.state !== "EM_COTACAO") return res.status(409).json({ error: "STATE", message: "A requisição não está em cotação." });
      Object.assign(data, { state: "POR_APROVAR" });
      text = "Cotação concluída — submetida para aprovação";
    }
    await prisma.paymentRequest.update({ where: { id: pr.id }, data: { ...data, history: { create: [{ by: actor, text }] } } });
    return res.json({ item: serialize(await loadFull(pr.id)) });
  })
);

paymentRequestRoutes.delete(
  "/:id",
  edit,
  asyncHandler(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "FORBIDDEN", message: "Só a administração pode eliminar requisições." });
    const pr = await prisma.paymentRequest.findUnique({ where: { id: req.params.id }, include: { payments: true, documents: true } });
    if (!pr) return res.status(404).json({ error: "NOT_FOUND" });
    if (pr.sourceRef) return res.status(409).json({ error: "MIRROR", message: "Esta requisição vem de outro ecrã do InfoCliente; anule-a na origem." });
    if (pr.payments.some((p) => p.bankMovementId)) {
      return res.status(409).json({ error: "RECONCILED", message: "A requisição tem pagamentos conciliados com o banco. Desfaça primeiro a conciliação." });
    }
    await prisma.bankMovement.updateMany({ where: { paymentRequestId: pr.id }, data: { paymentRequestId: null, reconcileKind: null, reconciledAt: null, reconciledBy: null } });
    await prisma.paymentRequest.delete({ where: { id: pr.id } });
    await Promise.all(
      [...pr.documents.map((d) => d.path), ...pr.payments.map((p) => p.proofPath)].filter(Boolean).map((p) => deleteStoredFile(p).catch(() => null))
    );
    return res.json({ ok: true });
  })
);

/** Pagamento efetuado (total ou parcial). O comprovativo é opcional — pede-se na conciliação. */
paymentRequestRoutes.post(
  "/:id/payments",
  edit,
  upload.single("proof"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        paidAt: z.string().min(1),
        amount: z.coerce.number().positive(),
        cardId: z.string().nullable().optional(),
        reference: z.string().nullable().optional(),
      })
      .parse(req.body);
    const pr = await prisma.paymentRequest.findUnique({ where: { id: req.params.id }, include: { payments: true } });
    if (!pr) return res.status(404).json({ error: "NOT_FOUND" });
    if (["POR_APROVAR", "EM_COTACAO", "REJEITADO"].includes(pr.state)) {
      return res.status(409).json({ error: "NOT_APPROVED", message: "A requisição ainda não está aprovada." });
    }
    if (req.file && !/pdf/i.test(req.file.mimetype || "") && !/\.pdf$/i.test(req.file.originalname || "")) {
      return res.status(415).json({ error: "PDF_ONLY", message: "O comprovativo tem de ser um PDF." });
    }
    const stored = await storeFile(`payment-requests/${pr.id}`, req.file);
    const actor = actorName(req);
    const paidBefore = paidOf(pr);
    const total = num(pr.totalAmount);
    const isFinal = paidBefore + body.amount >= total - 0.5;
    await prisma.$transaction(async (tx) => {
      await tx.paymentRequestPayment.create({
        data: {
          requestId: pr.id,
          paidAt: parseDay(body.paidAt),
          amount: round2(body.amount),
          cardId: body.cardId || null,
          reference: body.reference || null,
          proofPath: stored?.path || null,
          proofName: stored?.name || null,
          createdBy: actor,
        },
      });
      await tx.paymentRequest.update({
        where: { id: pr.id },
        data: {
          inTransit: false,
          history: { create: [{ by: actor, text: `${isFinal ? "Pagamento final" : "Pagamento parcial"} de ${round2(body.amount).toFixed(2)}${body.reference ? ` (ref. ${body.reference})` : ""}` }] },
        },
      });
      await refreshPaid(tx, pr.id);
    });
    return res.status(201).json({ item: serialize(await loadFull(pr.id)) });
  })
);

paymentRequestRoutes.delete(
  "/:id/payments/:paymentId",
  edit,
  asyncHandler(async (req, res) => {
    const pay = await prisma.paymentRequestPayment.findFirst({ where: { id: req.params.paymentId, requestId: req.params.id } });
    if (!pay) return res.status(404).json({ error: "NOT_FOUND" });
    if (pay.bankMovementId) return res.status(409).json({ error: "RECONCILED", message: "Este pagamento está conciliado com o banco. Desfaça a conciliação." });
    const actor = actorName(req);
    await prisma.$transaction(async (tx) => {
      await tx.paymentRequestPayment.delete({ where: { id: pay.id } });
      await tx.paymentRequestHistory.create({ data: { requestId: req.params.id, by: actor, text: `Pagamento de ${num(pay.amount).toFixed(2)} anulado` } });
      await refreshPaid(tx, req.params.id);
    });
    if (pay.proofPath) await deleteStoredFile(pay.proofPath).catch(() => null);
    return res.json({ item: serialize(await loadFull(req.params.id)) });
  })
);

/** Documentos: proforma, faturas (FT/AF/DSC), comprovativos, outros. */
paymentRequestRoutes.post(
  "/:id/documents",
  edit,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        kind: z.enum(DOC_KINDS),
        number: z.string().nullable().optional(),
        supplierName: z.string().nullable().optional(),
        docDate: z.string().nullable().optional(),
        amount: z.coerce.number().nullable().optional(),
      })
      .parse(req.body);
    const pr = await prisma.paymentRequest.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: "NOT_FOUND" });
    if (["FATURA", "AF"].includes(body.kind) && !String(body.number || "").trim()) {
      return res.status(400).json({ error: "NUMBER", message: "O n.º do documento é obrigatório." });
    }
    if (body.kind !== "DSC" && !req.file) return res.status(400).json({ error: "FILE", message: "Anexe o ficheiro do documento." });
    const stored = await storeFile(`payment-requests/${pr.id}`, req.file);
    const actor = actorName(req);
    const LABEL = { PROFORMA: "Proforma", FATURA: "Fatura", AF: "Autofaturação", DSC: "Despesa sem comprovativo", COMPROVATIVO: "Comprovativo", OUTRO: "Documento" };
    await prisma.paymentRequestDocument.create({
      data: {
        requestId: pr.id,
        kind: body.kind,
        number: body.number || null,
        supplierName: body.supplierName || null,
        docDate: parseDay(body.docDate),
        amount: body.amount === null || body.amount === undefined ? null : round2(body.amount),
        path: stored?.path || null,
        name: stored?.name || null,
        mimeType: stored?.mimeType || null,
        size: stored?.size || null,
        createdBy: actor,
      },
    });
    await prisma.paymentRequestHistory.create({
      data: { requestId: pr.id, by: actor, text: `${LABEL[body.kind]} anexad${body.kind === "COMPROVATIVO" || body.kind === "DOCUMENTO" ? "o" : "a"}${body.number ? ` (${body.number})` : ""}` },
    });
    return res.status(201).json({ item: serialize(await loadFull(pr.id)) });
  })
);

paymentRequestRoutes.delete(
  "/:id/documents/:docId",
  edit,
  asyncHandler(async (req, res) => {
    const doc = await prisma.paymentRequestDocument.findFirst({ where: { id: req.params.docId, requestId: req.params.id } });
    if (!doc) return res.status(404).json({ error: "NOT_FOUND" });
    await prisma.paymentRequestDocument.delete({ where: { id: doc.id } });
    await prisma.paymentRequestHistory.create({ data: { requestId: req.params.id, by: actorName(req), text: `Documento removido${doc.number ? ` (${doc.number})` : ""}` } });
    if (doc.path) await deleteStoredFile(doc.path).catch(() => null);
    return res.json({ item: serialize(await loadFull(req.params.id)) });
  })
);

module.exports = { paymentRequestRoutes, syncMirrors, serializePaymentRequest: serialize, refreshPaid, FULL_INCLUDE, num, round2, parseDay, dayKey, todayKey, storeFile, actorName };
