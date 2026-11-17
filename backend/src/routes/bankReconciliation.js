/**
 * Conciliação Bancária (T2).
 *
 * Cada movimento do extrato recebe um tipo (PF, RC, TRF INT, ENC, …) e liga-se
 * ao que o explica:
 *   · saída PF / TRF INT → requisição do Centro de Pagamentos (regista o
 *     pagamento se ainda não estava pago);
 *   · entrada RC → fatura(s) emitida(s) ao cliente (regista o recebimento);
 *   · TRF INT → a outra conta da empresa (casa com o movimento simétrico);
 *   · ENC (encargos bancários) → concilia-se sozinho (mapa mensal);
 *   · sem pedido → com o motivo (comissão, juros, reembolso, …).
 */
const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { deleteStoredFile } = require("../utils/storage");
const { syncInvoiceReceived, mapInvoice } = require("./finance");
const { serializePaymentRequest, refreshPaid, FULL_INCLUDE, num, round2, parseDay, dayKey, storeFile, actorName } = require("./paymentRequests");

const reconciliationRoutes = express.Router();
reconciliationRoutes.use(authRequired);

const view = requirePermission("financeiro", "view");
const edit = requirePermission("financeiro", "edit");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const DAY_MS = 24 * 60 * 60 * 1000;

// Os mesmos tipos (e pela mesma ordem) do extrato do MBT. Os marcados `soon`
// dependem de módulos que ainda não existem (Salários, Impostos, Financiamentos).
const MOVEMENT_TYPES = [
  { code: "PF", label: "Pagamento a Fornecedor", dir: "SAIDA" },
  { code: "RC", label: "Recebimento de Cliente", dir: "ENTRADA" },
  { code: "TRF INT", label: "Transferência Interna", dir: null },
  { code: "SL", label: "Salário", dir: "SAIDA", soon: true },
  { code: "AD SL", label: "Adiantamento de Salário", dir: "SAIDA", soon: true },
  { code: "PE", label: "Pagamento ao Estado", dir: "SAIDA", soon: true },
  { code: "EMP", label: "Empréstimo", dir: null, soon: true },
  { code: "CGM", label: "Amortização de Crédito", dir: "SAIDA", soon: true },
  { code: "CC", label: "Cartão de Crédito", dir: "SAIDA" },
  { code: "ENC", label: "Encargos Bancários (comissões, despesas, IVA, juros, imposto de selo)", dir: "SAIDA" },
  { code: "SC", label: "Sócios", dir: null },
  { code: "REEMB", label: "Devolução / Reembolso (pagamento devolvido, fundo de maneio ou fornecedor)", dir: null },
];
// OUTRO fica aceite só por compatibilidade com movimentos antigos.
const TYPE_CODES = [...MOVEMENT_TYPES.map((t) => t.code), "OUTRO"];
// Tipos que se concilian sozinhos (vão para o mapa mensal de encargos).
const AUTO_TYPES = ["ENC"];
// Saídas que não pedem comprovativo na conciliação.
const NO_PROOF_TYPES = ["TRF INT", "ENC"];
const NO_REQUEST_REASONS = ["Comissão bancária", "Juros / imposto de selo", "Transferência entre contas", "Pagamento ao Estado", "Reembolso", "Outro"];

// Regras de base (as mesmas do MBT). A primeira regra que corresponder ganha;
// «Repor as regras de base» volta a esta lista.
const DEFAULT_RULES = [
  { pattern: "IVA SOBRE COMISS", typeCode: "ENC", subtype: "IVA S/ COMISSÕES" },
  { pattern: "COMISS", typeCode: "ENC", subtype: "COMISSÃO — OUTRAS" },
  { pattern: "COM EMISS", typeCode: "ENC", subtype: "COMISSÃO — TRANSFERÊNCIA" },
  { pattern: "COM. REGUL", typeCode: "ENC", subtype: "COMISSÃO — OUTRAS" },
  { pattern: "MANUTENCAO CONTA", typeCode: "ENC", subtype: "COMISSÃO — MANUTENÇÃO DE CONTA" },
  { pattern: "JUROS", typeCode: "ENC", subtype: "JUROS DE CRÉDITO" },
  { pattern: "IMPOSTO DE SELO", typeCode: "ENC", subtype: "IMPOSTO DE SELO S/ JUROS" },
  { pattern: "AMORTIZA", typeCode: "CGM" },
  { pattern: "PAGAMENTOS AO ESTADO", typeCode: "PE" },
  { pattern: "TRF INT", typeCode: "TRF INT" },
  { pattern: "AC EMP", typeCode: "EMP" },
  { pattern: "AC QUAVI", typeCode: "EMP" },
  { pattern: "AD SL", typeCode: "AD SL" },
  { pattern: "SUBCONT", typeCode: "PF", direction: "SAIDA" },
  { pattern: "TRF KWIK PF", typeCode: "PF" },
  { pattern: "PF |", typeCode: "PF", direction: "SAIDA" },
  { pattern: "TRF KWIK SL", typeCode: "SL" },
  { pattern: "SL |", typeCode: "SL", direction: "SAIDA" },
  { pattern: "SC |", typeCode: "SC" },
  { pattern: "TPA-", typeCode: "PF", direction: "SAIDA" },
  { pattern: "PGTO SERVI", typeCode: "PF", direction: "SAIDA" },
  { pattern: "PAG. AUTOM", typeCode: "CC" },
  { pattern: "DESPESAS DE", typeCode: "ENC", direction: "SAIDA", subtype: "DESPESAS — OUTRAS" },
  { pattern: "SPTR DE", typeCode: "RC", direction: "ENTRADA" },
  { pattern: "TC STC", typeCode: "RC", direction: "ENTRADA" },
  { pattern: "TRF HBMB", typeCode: "PF", direction: "SAIDA" },
  { pattern: "MCX-LEV", typeCode: "PF", direction: "SAIDA" },
  { pattern: "OPE F/O", typeCode: "PF", direction: "SAIDA" },
  { pattern: "FRETE", typeCode: "PF", direction: "SAIDA" },
];

// Subtipos de base. No MBT os encargos tinham tipos próprios (COM, JUROS, DESP);
// aqui são um só tipo (ENC) e essa divisão passa para o subtipo.
const DEFAULT_SUBTYPES = {
  ENC: [
    "COMISSÃO — MANUTENÇÃO DE CONTA",
    "COMISSÃO — TRANSFERÊNCIA",
    "COMISSÃO — CARTÃO",
    "COMISSÃO — GARANTIA BANCÁRIA",
    "COMISSÃO — LEVANTAMENTO",
    "COMISSÃO — OUTRAS",
    "IVA S/ COMISSÕES",
    "JUROS DE CRÉDITO",
    "JUROS DE MORA / ATRASO",
    "JUROS DE DESCOBERTO",
    "IMPOSTO DE SELO S/ JUROS",
    "JUROS DE DEPÓSITO A PRAZO",
    "OUTROS JUROS",
    "DESPESAS — ANUIDADE DE CARTÃO",
    "DESPESAS — INTERNACIONAIS (OPE)",
    "DESPESAS — CORRESPONDENTE",
    "DESPESAS — OUTRAS",
  ],
  PE: ["IVA", "IRT", "IRT-B", "INSS", "RF", "IMPOSTO INDUSTRIAL", "IMPOSTO DE SELO", "IMPOSTO PREDIAL", "IVM — IMPOSTO SOBRE VEÍCULOS", "TAXAS E LICENÇAS", "TAXAS ADUANEIRAS", "IVA NA IMPORTAÇÃO", "DIREITOS ADUANEIROS", "EMOLUMENTOS ADUANEIROS", "PPP — PLANO DE PAGAMENTO", "OUTROS"],
  SC: ["DISTRIBUIÇÃO DE LUCROS", "SUPRIMENTOS"],
};

let defaultsReady = false;
/** Na primeira utilização cria as regras e os subtipos de base. */
async function ensureDefaults() {
  if (defaultsReady) return;
  const [nRules, nSubs] = await Promise.all([prisma.bankClassificationRule.count(), prisma.bankMovementSubtype.count()]);
  if (!nRules) await seedRules();
  if (!nSubs) {
    const data = [];
    Object.entries(DEFAULT_SUBTYPES).forEach(([typeCode, names]) => names.forEach((name, i) => data.push({ typeCode, name, sortOrder: i })));
    await prisma.bankMovementSubtype.createMany({ data, skipDuplicates: true });
  }
  defaultsReady = true;
}

async function seedRules(actor = null) {
  await prisma.bankClassificationRule.createMany({
    data: DEFAULT_RULES.map((r, i) => ({ pattern: r.pattern, typeCode: r.typeCode, direction: r.direction || null, subtype: r.subtype || null, ccCode: null, sortOrder: i, createdBy: actor })),
  });
}

function norm(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function signed(m) {
  return m.direction === "SAIDA" ? -num(m.amount) : num(m.amount);
}

function cardLabel(c) {
  if (!c) return null;
  return c.label || [c.bank, c.lastDigits ? `•••• ${c.lastDigits}` : null].filter(Boolean).join(" ");
}

const MOVEMENT_INCLUDE = {
  card: { select: { id: true, label: true, bank: true, lastDigits: true } },
  statement: { select: { id: true, name: true } },
  paymentRequest: {
    select: {
      id: true,
      number: true,
      supplierName: true,
      typeCode: true,
      totalAmount: true,
      paidAmount: true,
      state: true,
      costCenterCode: true,
      project: { select: { code: true } },
      items: { select: { description: true }, orderBy: { order: "asc" }, take: 1 },
      documents: { select: { kind: true } },
    },
  },
  receipts: { select: { id: true, amount: true, invoice: { select: { id: true, docNumber: true, documentPath: true, client: { select: { name: true } } } } } },
};

function serializeMovement(m, cardsById, refunds = null) {
  const transferCard = m.transferCardId ? cardsById.get(m.transferCardId) : null;
  const needsProof = m.direction === "SAIDA" && !NO_PROOF_TYPES.includes(m.typeCode || "");
  const pr = m.paymentRequest;
  return {
    id: m.id,
    statementId: m.statementId,
    statementName: m.statement?.name || null,
    cardId: m.cardId,
    cardLabel: cardLabel(m.card),
    movementDate: dayKey(m.movementDate),
    effectiveDate: dayKey(m.effectiveDate || m.movementDate),
    description: m.description,
    docNumber: m.docNumber,
    direction: m.direction,
    amount: num(m.amount),
    signedAmount: signed(m),
    typeCode: m.typeCode || null,
    subtype: m.subtype || null,
    typeAuto: Boolean(m.typeAuto),
    ccCode: m.ccCode || null,
    refundOfId: m.refundOfId || null,
    refundedAmount: refunds ? round2(refunds.get(m.id) || 0) : 0,
    note: m.note || "",
    transferCardId: m.transferCardId,
    transferCardLabel: cardLabel(transferCard),
    transferPairId: m.transferPairId,
    reconcileKind: m.reconcileKind,
    reconcileReason: m.reconcileReason,
    reconciledAt: m.reconciledAt,
    reconciledBy: m.reconciledBy,
    reconciled: Boolean(m.reconciledAt),
    proofPath: m.proofPath,
    proofName: m.proofName,
    proofMissing: Boolean(m.reconciledAt) && needsProof && !m.proofPath && m.reconcileKind !== "AUTO",
    paymentRequest: pr
      ? {
          id: pr.id,
          number: pr.number,
          supplierName: pr.supplierName,
          typeCode: pr.typeCode,
          totalAmount: num(pr.totalAmount),
          paidAmount: num(pr.paidAmount),
          state: pr.state,
          costCenterCode: pr.costCenterCode || null,
          projectCode: pr.project?.code || null,
          firstItem: pr.items?.[0]?.description || null,
          hasInvoice: (pr.documents || []).some((d) => ["FATURA", "AF", "DSC"].includes(d.kind)),
        }
      : null,
    receipts: (m.receipts || []).map((r) => ({
      id: r.id,
      amount: num(r.amount),
      invoiceId: r.invoice?.id,
      invoiceNumber: r.invoice?.docNumber,
      invoiceHasPdf: Boolean(r.invoice?.documentPath),
      client: r.invoice?.client?.name || null,
    })),
  };
}

async function loadCards() {
  const cards = await prisma.pettyCashCard.findMany({
    select: { id: true, label: true, bank: true, lastDigits: true, type: true, active: true, fund: { select: { name: true, currency: true, projectId: true } } },
    orderBy: { label: "asc" },
  });
  return { cards, byId: new Map(cards.map((c) => [c.id, c])) };
}

/**
 * Saldo de cada conta: o último saldo registado (extrato ou acerto) mais os
 * movimentos posteriores; sem saldo registado, a soma dos movimentos.
 */
async function cardBalances(cards) {
  const [snaps, sums] = await Promise.all([
    prisma.bankBalance.findMany({ orderBy: [{ balanceDate: "desc" }, { createdAt: "desc" }], select: { cardId: true, balance: true, balanceDate: true } }),
    prisma.bankMovement.groupBy({ by: ["cardId", "direction"], _sum: { amount: true } }),
  ]);
  const latest = new Map();
  snaps.forEach((s) => !latest.has(s.cardId) && latest.set(s.cardId, s));
  const out = new Map();
  for (const c of cards) {
    const snap = latest.get(c.id);
    if (snap) {
      const after = await prisma.bankMovement.groupBy({ by: ["direction"], where: { cardId: c.id, movementDate: { gt: snap.balanceDate } }, _sum: { amount: true } });
      const d = after.reduce((a, g) => a + (g.direction === "ENTRADA" ? 1 : -1) * num(g._sum.amount), 0);
      out.set(c.id, round2(num(snap.balance) + d));
    } else {
      const d = sums.filter((g) => g.cardId === c.id).reduce((a, g) => a + (g.direction === "ENTRADA" ? 1 : -1) * num(g._sum.amount), 0);
      out.set(c.id, round2(d));
    }
  }
  return out;
}

async function loadMovement(id) {
  return prisma.bankMovement.findUnique({ where: { id }, include: MOVEMENT_INCLUDE });
}

// ─── listas ──────────────────────────────────────────────────────────────────

reconciliationRoutes.get(
  "/meta",
  view,
  asyncHandler(async (_req, res) => {
    await ensureDefaults();
    const { cards } = await loadCards();
    const [rules, subtypes, subCounts] = await Promise.all([
      prisma.bankClassificationRule.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      prisma.bankMovementSubtype.findMany({ orderBy: [{ typeCode: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
      prisma.bankMovement.groupBy({ by: ["typeCode", "subtype"], where: { subtype: { not: null } }, _count: { _all: true } }),
    ]);
    const counts = new Map(subCounts.map((g) => [`${g.typeCode}|${g.subtype}`, g._count._all]));
    const balances = await cardBalances(cards);
    return res.json({
      types: MOVEMENT_TYPES,
      noRequestReasons: NO_REQUEST_REASONS,
      cards: cards.map((c) => ({ id: c.id, label: cardLabel(c), bank: c.bank, lastDigits: c.lastDigits, type: c.type, active: c.active, currency: c.fund?.currency || "AOA", fund: c.fund?.name || null, group: c.fund?.projectId || c.type === "PREPAGO" ? "FM" : "MAIN", balance: balances.get(c.id) ?? 0 })),
      rules,
      subtypes: subtypes.map((x) => ({ ...x, movements: counts.get(`${x.typeCode}|${x.name}`) || 0 })),
    });
  })
);

reconciliationRoutes.get(
  "/movements",
  view,
  asyncHandler(async (_req, res) => {
    const [{ byId }, rows] = await Promise.all([
      loadCards(),
      prisma.bankMovement.findMany({ include: MOVEMENT_INCLUDE, orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }] }),
    ]);
    // Quanto de cada saída já foi devolvido (REEMB ligados).
    const refunds = new Map();
    rows.forEach((m) => {
      if (m.refundOfId) refunds.set(m.refundOfId, (refunds.get(m.refundOfId) || 0) + num(m.amount));
    });
    return res.json({ items: rows.map((m) => serializeMovement(m, byId, refunds)) });
  })
);

// ─── tipo, nota, data-valor e conta de destino ────────────────────────────────

reconciliationRoutes.patch(
  "/movements/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        typeCode: z.string().nullable().optional(),
        subtype: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
        effectiveDate: z.string().nullable().optional(),
        transferCardId: z.string().nullable().optional(),
        cardId: z.string().min(1).optional(),
      })
      .parse(req.body);
    const m = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: "NOT_FOUND" });
    const data = {};

    // Trocar a conta / cartão do movimento (ex.: importado na conta errada).
    if (body.cardId !== undefined && body.cardId !== m.cardId) {
      if (m.reconciledAt && m.reconcileKind !== "AUTO") {
        return res.status(409).json({ error: "RECONCILED", message: "O movimento está conciliado. Desfaça a conciliação antes de trocar a conta." });
      }
      const card = await prisma.pettyCashCard.findUnique({ where: { id: body.cardId }, select: { id: true } });
      if (!card) return res.status(404).json({ error: "CARD", message: "Conta não encontrada." });
      data.cardId = card.id;
      if (m.transferCardId === card.id) data.transferCardId = null;
    }
    const actor = actorName(req);

    if (body.typeCode !== undefined) {
      const code = body.typeCode ? String(body.typeCode).trim().toUpperCase() : null;
      if (code && !TYPE_CODES.includes(code)) return res.status(400).json({ error: "TYPE", message: `Tipo desconhecido: ${code}.` });
      if (m.reconciledAt && m.reconcileKind !== "AUTO" && code !== m.typeCode) {
        return res.status(409).json({ error: "RECONCILED", message: "O movimento está conciliado. Desfaça a conciliação antes de mudar o tipo." });
      }
      data.typeCode = code;
      // Escolhido à mão: as regras deixam de o reclassificar.
      data.typeAuto = false;
      if (code !== m.typeCode) data.subtype = null;
      if (code && AUTO_TYPES.includes(code)) {
        Object.assign(data, { reconcileKind: "AUTO", reconciledAt: new Date(), reconciledBy: actor, reconcileReason: "Encargos bancários — mapa mensal" });
      } else if (m.reconcileKind === "AUTO") {
        Object.assign(data, { reconcileKind: null, reconciledAt: null, reconciledBy: null, reconcileReason: null });
      }
      if (code !== "TRF INT" && m.transferCardId && !m.transferPairId) data.transferCardId = null;
    }
    if (body.subtype !== undefined) data.subtype = body.subtype ? String(body.subtype).trim() : null;
    if (body.note !== undefined) data.note = body.note || null;
    if (body.effectiveDate !== undefined) data.effectiveDate = parseDay(body.effectiveDate);
    if (body.transferCardId !== undefined) {
      if (body.transferCardId && body.transferCardId === m.cardId) return res.status(400).json({ error: "SAME_ACCOUNT", message: "A conta de destino tem de ser outra." });
      data.transferCardId = body.transferCardId || null;
    }
    await prisma.bankMovement.update({ where: { id: m.id }, data });
    const { byId } = await loadCards();
    return res.json({ item: serializeMovement(await loadMovement(m.id), byId) });
  })
);

// ─── candidatos ──────────────────────────────────────────────────────────────

reconciliationRoutes.get(
  "/movements/:id/candidates",
  view,
  asyncHandler(async (req, res) => {
    const m = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: "NOT_FOUND" });
    const all = req.query.all === "1";

    if (m.direction === "ENTRADA") {
      const invoices = await prisma.invoice.findMany({
        where: { kind: { not: "NOTA_CREDITO" }, cancelledAt: null },
        include: {
          project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
          client: { select: { id: true, name: true, code: true } },
          measurement: { select: { id: true, reportNumber: true, reportDate: true } },
        },
        orderBy: [{ docDate: "asc" }],
      });
      const open = invoices
        .map(mapInvoice)
        .filter((i) => all || i.missingAmount > 0.005)
        .map((i) => ({
          id: i.id,
          docNumber: i.docNumber,
          docDate: dayKey(i.docDate),
          dueDate: dayKey(i.effectiveDueDate),
          client: i.client?.name || null,
          project: i.project ? `${i.project.code} · ${i.project.name}` : null,
          netAmount: i.netAmount,
          receivedAmount: i.receivedAmount,
          missingAmount: i.missingAmount,
          documentPath: i.documentPath,
          documentName: i.documentName,
        }));
      return res.json({ kind: "INVOICE", items: open });
    }

    const where = { state: { notIn: ["REJEITADO"] } };
    if (!all && m.typeCode) where.typeCode = m.typeCode;
    const rows = await prisma.paymentRequest.findMany({ where, include: FULL_INCLUDE, orderBy: [{ dueDate: "asc" }] });
    const items = rows
      .map((r) => serializePaymentRequest(r))
      .map((r) => {
        const reconciled = round2(r.reconciledMovements.reduce((a, x) => a + x.amount, 0));
        return { ...r, reconciledAmount: reconciled, toReconcile: round2(Math.max(r.totalAmount - reconciled, 0)) };
      })
      .filter((r) => all || r.toReconcile > 0.5)
      // Primeiro os de valor igual ao movimento, depois por vencimento.
      .sort((a, b) => {
        const da = Math.abs(a.toReconcile - num(m.amount));
        const db = Math.abs(b.toReconcile - num(m.amount));
        if ((da < 0.5) !== (db < 0.5)) return da < 0.5 ? -1 : 1;
        return String(a.nextDue || "9").localeCompare(String(b.nextDue || "9"));
      });
    return res.json({ kind: "REQUEST", items });
  })
);

// ─── conciliar ───────────────────────────────────────────────────────────────

reconciliationRoutes.post(
  "/movements/:id/reconcile",
  edit,
  upload.array("proofs", 10),
  asyncHandler(async (req, res) => {
    const raw = typeof req.body.payload === "string" ? JSON.parse(req.body.payload) : req.body;
    const body = z
      .object({
        kind: z.enum(["REQUEST", "INVOICE", "NONE", "TRANSFER"]),
        requestId: z.string().nullable().optional(),
        movementIds: z.array(z.string()).optional(),
        registerPayment: z.boolean().optional(),
        invoices: z.array(z.object({ id: z.string(), amount: z.coerce.number().positive() })).optional(),
        reason: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
        transferCardId: z.string().nullable().optional(),
      })
      .parse(raw);
    const m = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: "NOT_FOUND" });
    if (m.reconciledAt) return res.status(409).json({ error: "ALREADY", message: "Este movimento já está conciliado." });
    const actor = actorName(req);
    const files = req.files || [];
    const stored = [];
    for (const f of files) stored.push(await storeFile(`bank-movements/${m.id}`, f));
    const proof = stored[0] || null;
    const now = new Date();

    if (body.kind === "REQUEST") {
      if (!body.requestId) return res.status(400).json({ error: "REQUEST", message: "Escolha o pedido do Centro de Pagamentos." });
      const pr = await prisma.paymentRequest.findUnique({ where: { id: body.requestId }, include: { payments: true } });
      if (!pr) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
      const ids = [...new Set([m.id, ...(body.movementIds || [])])];
      const movs = await prisma.bankMovement.findMany({ where: { id: { in: ids } }, orderBy: { movementDate: "asc" } });
      if (movs.some((x) => x.reconciledAt)) return res.status(409).json({ error: "ALREADY", message: "Há movimentos selecionados que já estão conciliados." });
      if (movs.some((x) => x.direction !== m.direction)) return res.status(400).json({ error: "DIRECTION", message: "Junte só movimentos do mesmo sentido (saídas com saídas)." });
      const needsProof = m.direction === "SAIDA" && !NO_PROOF_TYPES.includes(m.typeCode || pr.typeCode);
      const existingProof = pr.payments.some((p) => p.proofPath) || (await prisma.paymentRequestDocument.count({ where: { requestId: pr.id, kind: "COMPROVATIVO" } })) > 0;
      if (needsProof && !proof && !existingProof) {
        return res.status(400).json({ error: "PROOF", message: "Anexe o comprovativo de pagamento — é obrigatório na conciliação." });
      }
      await prisma.$transaction(async (tx) => {
        const paidBefore = round2(pr.payments.reduce((a, p) => a + num(p.amount), 0));
        let missing = round2(Math.max(num(pr.totalAmount) - paidBefore, 0));
        // Pagamentos já registados sem banco: liga-os pelo valor.
        const loose = pr.payments.filter((p) => !p.bankMovementId);
        for (const x of movs) {
          const match = loose.find((p) => Math.abs(num(p.amount) - num(x.amount)) < 0.5);
          if (match) {
            loose.splice(loose.indexOf(match), 1);
            await tx.paymentRequestPayment.update({
              where: { id: match.id },
              data: { bankMovementId: x.id, cardId: match.cardId || x.cardId, proofPath: match.proofPath || proof?.path || null, proofName: match.proofName || proof?.name || null },
            });
          } else if (body.registerPayment !== false && missing > 0.005) {
            const amount = round2(Math.min(num(x.amount), missing));
            missing = round2(missing - amount);
            await tx.paymentRequestPayment.create({
              data: {
                requestId: pr.id,
                paidAt: x.movementDate,
                amount,
                cardId: x.cardId,
                reference: x.docNumber || null,
                bankMovementId: x.id,
                proofPath: proof?.path || null,
                proofName: proof?.name || null,
                createdBy: actor,
              },
            });
          }
          await tx.bankMovement.update({
            where: { id: x.id },
            data: {
              paymentRequestId: pr.id,
              reconcileKind: "REQUEST",
              reconciledAt: now,
              reconciledBy: actor,
              typeCode: x.typeCode || pr.typeCode,
              note: body.note ?? x.note,
              proofPath: proof?.path || x.proofPath,
              proofName: proof?.name || x.proofName,
            },
          });
        }
        for (const extra of stored.slice(1)) {
          await tx.paymentRequestDocument.create({ data: { requestId: pr.id, kind: "COMPROVATIVO", path: extra.path, name: extra.name, mimeType: extra.mimeType, size: extra.size, createdBy: actor } });
        }
        const total = round2(movs.reduce((a, x) => a + num(x.amount), 0));
        await tx.paymentRequest.update({
          where: { id: pr.id },
          data: { inTransit: false, history: { create: [{ by: actor, text: `Conciliado com ${movs.length} movimento(s) do banco (${total.toFixed(2)})` }] } },
        });
        await refreshPaid(tx, pr.id);
      });
    } else if (body.kind === "INVOICE") {
      const list = body.invoices || [];
      if (!list.length) return res.status(400).json({ error: "INVOICE", message: "Escolha a fatura emitida ao cliente." });
      if (!proof) return res.status(400).json({ error: "PROOF", message: "Anexe o comprovativo do recebimento (banco)." });
      const sum = round2(list.reduce((a, i) => a + num(i.amount), 0));
      if (sum > num(m.amount) + 0.5) return res.status(400).json({ error: "AMOUNT", message: "A soma dos recebimentos é maior do que o movimento." });
      await prisma.$transaction(async (tx) => {
        for (const i of list) {
          await tx.invoiceReceipt.create({
            data: {
              invoiceId: i.id,
              amount: round2(i.amount),
              receivedDate: m.movementDate,
              method: "Transferência bancária",
              bankMovementId: m.id,
              proofPath: proof.path,
              proofName: proof.name,
              createdBy: actor,
            },
          });
          await syncInvoiceReceived(tx, i.id);
        }
        await tx.bankMovement.update({
          where: { id: m.id },
          data: { typeCode: m.typeCode || "RC", reconcileKind: "INVOICE", reconciledAt: now, reconciledBy: actor, note: body.note ?? m.note, proofPath: proof.path, proofName: proof.name },
        });
      });
    } else if (body.kind === "TRANSFER") {
      const dest = body.transferCardId || m.transferCardId;
      if (!dest) return res.status(400).json({ error: "DEST", message: "Indique a outra conta da transferência." });
      if (dest === m.cardId) return res.status(400).json({ error: "SAME_ACCOUNT", message: "A conta de destino tem de ser outra." });
      const pair = await findTransferPair(m, dest);
      await prisma.$transaction(async (tx) => {
        await tx.bankMovement.update({
          where: { id: m.id },
          data: { typeCode: "TRF INT", transferCardId: dest, transferPairId: pair?.id || null, reconcileKind: "TRANSFER", reconciledAt: now, reconciledBy: actor },
        });
        if (pair) {
          await tx.bankMovement.update({
            where: { id: pair.id },
            data: { typeCode: "TRF INT", transferCardId: m.cardId, transferPairId: m.id, reconcileKind: "TRANSFER", reconciledAt: now, reconciledBy: actor },
          });
        }
      });
    } else {
      if (!String(body.reason || "").trim()) return res.status(400).json({ error: "REASON", message: "Escolha o motivo." });
      await prisma.bankMovement.update({
        where: { id: m.id },
        data: { reconcileKind: "NONE", reconcileReason: body.reason.trim(), reconciledAt: now, reconciledBy: actor, note: body.note ?? m.note, proofPath: proof?.path || m.proofPath, proofName: proof?.name || m.proofName },
      });
    }

    const { byId } = await loadCards();
    return res.json({ item: serializeMovement(await loadMovement(m.id), byId) });
  })
);

/** Movimento simétrico na outra conta: sentido oposto, mesmo valor, até 5 dias de diferença. */
async function findTransferPair(m, destCardId) {
  const from = new Date(new Date(m.movementDate).getTime() - 5 * DAY_MS);
  const to = new Date(new Date(m.movementDate).getTime() + 5 * DAY_MS);
  const cands = await prisma.bankMovement.findMany({
    where: {
      cardId: destCardId,
      direction: m.direction === "SAIDA" ? "ENTRADA" : "SAIDA",
      amount: m.amount,
      reconciledAt: null,
      movementDate: { gte: from, lte: to },
      id: { not: m.id },
    },
    orderBy: { movementDate: "asc" },
  });
  return cands.sort((a, b) => Math.abs(a.movementDate - m.movementDate) - Math.abs(b.movementDate - m.movementDate))[0] || null;
}

/** Concilia todas as TRF INT com a outra conta indicada (casando os pares). */
reconciliationRoutes.post(
  "/transfers/auto",
  edit,
  asyncHandler(async (req, res) => {
    const actor = actorName(req);
    const pending = await prisma.bankMovement.findMany({
      where: { typeCode: "TRF INT", reconciledAt: null, transferCardId: { not: null } },
      orderBy: { movementDate: "asc" },
    });
    let done = 0;
    let paired = 0;
    for (const m of pending) {
      const fresh = await prisma.bankMovement.findUnique({ where: { id: m.id } });
      if (!fresh || fresh.reconciledAt) continue;
      const pair = await findTransferPair(fresh, fresh.transferCardId);
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.bankMovement.update({ where: { id: m.id }, data: { transferPairId: pair?.id || null, reconcileKind: "TRANSFER", reconciledAt: now, reconciledBy: actor } });
        if (pair) {
          await tx.bankMovement.update({
            where: { id: pair.id },
            data: { typeCode: "TRF INT", transferCardId: m.cardId, transferPairId: m.id, reconcileKind: "TRANSFER", reconciledAt: now, reconciledBy: actor },
          });
        }
      });
      done += 1;
      if (pair) paired += 1;
    }
    return res.json({ reconciled: done, paired });
  })
);

/** Desfaz a conciliação (e o pagamento / recebimento que ela registou). */
reconciliationRoutes.post(
  "/movements/:id/unreconcile",
  edit,
  asyncHandler(async (req, res) => {
    const m = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: "NOT_FOUND" });
    if (!m.reconciledAt) return res.status(409).json({ error: "NOT_RECONCILED" });
    const actor = actorName(req);
    const clear = { reconcileKind: null, reconcileReason: null, reconciledAt: null, reconciledBy: null };
    const removedFiles = [];
    await prisma.$transaction(async (tx) => {
      if (m.reconcileKind === "REQUEST" && m.paymentRequestId) {
        const pays = await tx.paymentRequestPayment.findMany({ where: { bankMovementId: m.id } });
        for (const p of pays) {
          await tx.paymentRequestPayment.delete({ where: { id: p.id } });
        }
        await tx.paymentRequest.update({
          where: { id: m.paymentRequestId },
          data: { history: { create: [{ by: actor, text: `Conciliação desfeita (movimento de ${num(m.amount).toFixed(2)}) — o pagamento registado foi anulado` }] } },
        });
        await tx.bankMovement.update({ where: { id: m.id }, data: { ...clear, paymentRequestId: null } });
        await refreshPaid(tx, m.paymentRequestId);
      } else if (m.reconcileKind === "INVOICE") {
        const recs = await tx.invoiceReceipt.findMany({ where: { bankMovementId: m.id } });
        for (const r of recs) {
          await tx.invoiceReceipt.delete({ where: { id: r.id } });
          await syncInvoiceReceived(tx, r.invoiceId);
        }
        await tx.bankMovement.update({ where: { id: m.id }, data: clear });
      } else if (m.reconcileKind === "REFUND") {
        await tx.bankMovement.update({ where: { id: m.id }, data: { ...clear, refundOfId: null } });
      } else if (m.reconcileKind === "TRANSFER") {
        if (m.transferPairId) {
          await tx.bankMovement.update({ where: { id: m.transferPairId }, data: { ...clear, transferPairId: null } });
        }
        await tx.bankMovement.update({ where: { id: m.id }, data: { ...clear, transferPairId: null } });
      } else {
        await tx.bankMovement.update({ where: { id: m.id }, data: clear });
      }
    });
    removedFiles.forEach((p) => deleteStoredFile(p).catch(() => null));
    const { byId } = await loadCards();
    return res.json({ item: serializeMovement(await loadMovement(m.id), byId) });
  })
);

/** Substitui / anexa o comprovativo de um movimento já conciliado. */
reconciliationRoutes.post(
  "/movements/:id/proof",
  edit,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const m = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: "NOT_FOUND" });
    if (!req.file) return res.status(400).json({ error: "FILE", message: "Escolha o ficheiro." });
    const stored = await storeFile(`bank-movements/${m.id}`, req.file);
    await prisma.$transaction(async (tx) => {
      await tx.bankMovement.update({ where: { id: m.id }, data: { proofPath: stored.path, proofName: stored.name } });
      await tx.paymentRequestPayment.updateMany({ where: { bankMovementId: m.id }, data: { proofPath: stored.path, proofName: stored.name } });
      await tx.invoiceReceipt.updateMany({ where: { bankMovementId: m.id }, data: { proofPath: stored.path, proofName: stored.name } });
    });
    const { byId } = await loadCards();
    return res.json({ item: serializeMovement(await loadMovement(m.id), byId) });
  })
);

// ─── regras de classificação ─────────────────────────────────────────────────

const ruleSchema = z.object({
  pattern: z.string().trim().min(1),
  typeCode: z.string().trim().min(1),
  direction: z.enum(["ENTRADA", "SAIDA"]).nullable().optional(),
  subtype: z.string().nullable().optional(),
  ccCode: z.string().nullable().optional(),
});

/** Grava a lista inteira de regras (pela ordem dada: a primeira que corresponder ganha). */
reconciliationRoutes.put(
  "/rules",
  edit,
  asyncHandler(async (req, res) => {
    const { rules } = z.object({ rules: z.array(ruleSchema) }).parse(req.body);
    const bad = rules.find((r) => !TYPE_CODES.includes(r.typeCode.toUpperCase()));
    if (bad) return res.status(400).json({ error: "TYPE", message: `Tipo desconhecido na regra «${bad.pattern}»: ${bad.typeCode}.` });
    const actor = actorName(req);
    await prisma.$transaction([
      prisma.bankClassificationRule.deleteMany({}),
      prisma.bankClassificationRule.createMany({
        data: rules.map((r, i) => ({
          pattern: r.pattern.trim().toUpperCase(),
          typeCode: r.typeCode.toUpperCase(),
          direction: r.direction || null,
          subtype: r.subtype ? r.subtype.trim() : null,
          ccCode: r.ccCode ? r.ccCode.trim().toUpperCase() : null,
          sortOrder: i,
          createdBy: actor,
        })),
      }),
    ]);
    const saved = await prisma.bankClassificationRule.findMany({ orderBy: { sortOrder: "asc" } });
    return res.json({ rules: saved });
  })
);

/** Repõe as regras de base. */
reconciliationRoutes.post(
  "/rules/reset",
  edit,
  asyncHandler(async (req, res) => {
    await prisma.bankClassificationRule.deleteMany({});
    await seedRules(actorName(req));
    const saved = await prisma.bankClassificationRule.findMany({ orderBy: { sortOrder: "asc" } });
    return res.json({ rules: saved });
  })
);

/**
 * Classifica os movimentos sem tipo e volta a classificar os que foram
 * classificados por regras. Nunca altera um tipo escolhido à mão nem movimentos
 * conciliados (os encargos, conciliados sozinhos, podem mudar).
 */
reconciliationRoutes.post(
  "/rules/apply",
  edit,
  asyncHandler(async (req, res) => {
    await ensureDefaults();
    const actor = actorName(req);
    const { cardId } = z.object({ cardId: z.string().nullable().optional() }).parse(req.body || {});
    const rules = (await prisma.bankClassificationRule.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })).map((r) => ({ ...r, key: norm(r.pattern) }));
    const where = {
      AND: [{ OR: [{ typeCode: null }, { typeCode: "" }, { typeAuto: true }] }, { OR: [{ reconciledAt: null }, { reconcileKind: "AUTO" }] }],
    };
    if (cardId) where.cardId = cardId;
    const list = await prisma.bankMovement.findMany({ where, select: { id: true, description: true, direction: true, typeCode: true, subtype: true, ccCode: true, reconcileKind: true } });
    let changed = 0;
    for (const m of list) {
      const d = norm(m.description);
      const rule = rules.find((r) => r.key && d.includes(r.key) && (!r.direction || r.direction === m.direction));
      if (!rule) continue;
      if (rule.typeCode === m.typeCode && (rule.subtype || null) === (m.subtype || null) && (rule.ccCode || null) === (m.ccCode || null)) continue;
      const data = { typeCode: rule.typeCode, subtype: rule.subtype || null, ccCode: rule.ccCode || null, typeAuto: true };
      if (AUTO_TYPES.includes(rule.typeCode) && m.direction === "SAIDA") {
        Object.assign(data, { reconcileKind: "AUTO", reconciledAt: new Date(), reconciledBy: actor, reconcileReason: "Encargos bancários — mapa mensal" });
      } else if (m.reconcileKind === "AUTO") {
        Object.assign(data, { reconcileKind: null, reconciledAt: null, reconciledBy: null, reconcileReason: null });
      }
      await prisma.bankMovement.update({ where: { id: m.id }, data });
      changed += 1;
    }
    const remaining = await prisma.bankMovement.count({ where: { OR: [{ typeCode: null }, { typeCode: "" }], ...(cardId ? { cardId } : {}) } });
    return res.json({ changed, remaining });
  })
);

// ─── subtipos ────────────────────────────────────────────────────────────────

reconciliationRoutes.post(
  "/subtypes",
  edit,
  asyncHandler(async (req, res) => {
    const body = z.object({ typeCode: z.string().trim().min(1), name: z.string().trim().min(1) }).parse(req.body);
    const name = body.name.toUpperCase();
    const typeCode = body.typeCode.toUpperCase();
    if (!TYPE_CODES.includes(typeCode)) return res.status(400).json({ error: "TYPE" });
    const exists = await prisma.bankMovementSubtype.findFirst({ where: { typeCode, name } });
    if (exists) return res.status(409).json({ error: "EXISTS", message: `O subtipo «${name}» já existe.` });
    const last = await prisma.bankMovementSubtype.findFirst({ where: { typeCode }, orderBy: { sortOrder: "desc" } });
    const item = await prisma.bankMovementSubtype.create({ data: { typeCode, name, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    return res.status(201).json({ item });
  })
);

/** Muda o nome do subtipo — também nos movimentos e nas regras que o usam. */
reconciliationRoutes.patch(
  "/subtypes/:id",
  edit,
  asyncHandler(async (req, res) => {
    const { name: raw } = z.object({ name: z.string().trim().min(1) }).parse(req.body);
    const sub = await prisma.bankMovementSubtype.findUnique({ where: { id: req.params.id } });
    if (!sub) return res.status(404).json({ error: "NOT_FOUND" });
    const name = raw.toUpperCase();
    if (name === sub.name) return res.json({ item: sub });
    const clash = await prisma.bankMovementSubtype.findFirst({ where: { typeCode: sub.typeCode, name } });
    if (clash) return res.status(409).json({ error: "EXISTS", message: `O subtipo «${name}» já existe.` });
    const [item] = await prisma.$transaction([
      prisma.bankMovementSubtype.update({ where: { id: sub.id }, data: { name } }),
      prisma.bankMovement.updateMany({ where: { typeCode: sub.typeCode, subtype: sub.name }, data: { subtype: name } }),
      prisma.bankClassificationRule.updateMany({ where: { typeCode: sub.typeCode, subtype: sub.name }, data: { subtype: name } }),
    ]);
    return res.json({ item });
  })
);

reconciliationRoutes.delete(
  "/subtypes/:id",
  edit,
  asyncHandler(async (req, res) => {
    const sub = await prisma.bankMovementSubtype.findUnique({ where: { id: req.params.id } });
    if (!sub) return res.json({ ok: true });
    await prisma.$transaction([
      prisma.bankMovement.updateMany({ where: { typeCode: sub.typeCode, subtype: sub.name }, data: { subtype: null } }),
      prisma.bankClassificationRule.updateMany({ where: { typeCode: sub.typeCode, subtype: sub.name }, data: { subtype: null } }),
      prisma.bankMovementSubtype.delete({ where: { id: sub.id } }),
    ]);
    return res.json({ ok: true });
  })
);

// ─── devoluções (REEMB) ──────────────────────────────────────────────────────

/** Liga uma devolução (entrada) à saída a que corresponde, com o comprovativo. */
reconciliationRoutes.post(
  "/movements/:id/refund",
  edit,
  upload.single("proof"),
  asyncHandler(async (req, res) => {
    const raw = typeof req.body.payload === "string" ? JSON.parse(req.body.payload) : req.body;
    const { refundOfId } = z.object({ refundOfId: z.string().min(1) }).parse(raw);
    const m = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: "NOT_FOUND" });
    if (m.reconciledAt) return res.status(409).json({ error: "ALREADY", message: "Este movimento já está conciliado." });
    const out = await prisma.bankMovement.findUnique({ where: { id: refundOfId } });
    if (!out || out.direction !== "SAIDA") return res.status(400).json({ error: "OUT", message: "Escolha a saída a que esta devolução corresponde." });
    if (!req.file && !m.proofPath) return res.status(400).json({ error: "PROOF", message: "Anexe o comprovativo da devolução." });
    const stored = req.file ? await storeFile(`bank-movements/${m.id}`, req.file) : null;
    await prisma.bankMovement.update({
      where: { id: m.id },
      data: {
        typeCode: m.typeCode || "REEMB",
        refundOfId: out.id,
        reconcileKind: "REFUND",
        reconcileReason: `Devolução da saída de ${dayKey(out.movementDate)} · ${out.description || ""}`.trim(),
        reconciledAt: new Date(),
        reconciledBy: actorName(req),
        proofPath: stored?.path || m.proofPath,
        proofName: stored?.name || m.proofName,
      },
    });
    const { byId } = await loadCards();
    return res.json({ item: serializeMovement(await loadMovement(m.id), byId) });
  })
);

// ─── lançamento manual ───────────────────────────────────────────────────────

/** Movimento lançado à mão numa conta (fica no extrato «Lançamentos manuais» dessa conta). */
reconciliationRoutes.post(
  "/movements/manual",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        cardId: z.string().min(1),
        date: z.string().min(8),
        description: z.string().trim().min(1),
        direction: z.enum(["ENTRADA", "SAIDA"]),
        amount: z.coerce.number().positive(),
        typeCode: z.string().nullable().optional(),
      })
      .parse(req.body);
    const card = await prisma.pettyCashCard.findUnique({ where: { id: body.cardId } });
    if (!card) return res.status(404).json({ error: "CARD" });
    const code = body.typeCode ? body.typeCode.trim().toUpperCase() : null;
    if (code && !TYPE_CODES.includes(code)) return res.status(400).json({ error: "TYPE", message: `Tipo desconhecido: ${code}.` });
    const actor = actorName(req);
    let st = await prisma.bankStatement.findFirst({ where: { cardId: card.id, name: "Lançamentos manuais" } });
    if (!st) st = await prisma.bankStatement.create({ data: { cardId: card.id, name: "Lançamentos manuais", createdBy: actor } });
    const data = {
      statementId: st.id,
      cardId: card.id,
      direction: body.direction,
      amount: round2(body.amount),
      movementDate: parseDay(body.date),
      description: body.description.toUpperCase(),
      typeCode: code,
    };
    if (code && AUTO_TYPES.includes(code) && body.direction === "SAIDA") {
      Object.assign(data, { reconcileKind: "AUTO", reconciledAt: new Date(), reconciledBy: actor, reconcileReason: "Encargos bancários — mapa mensal" });
    }
    const created = await prisma.bankMovement.create({ data });
    const { byId } = await loadCards();
    return res.status(201).json({ item: serializeMovement(await loadMovement(created.id), byId) });
  })
);

module.exports = { reconciliationRoutes };
