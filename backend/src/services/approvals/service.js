const { prisma } = require("../../db");
const { checkUserPermission } = require("../permissionResolver");

/**
 * Aprovações pendentes (Fase 4 — aprovações em lote).
 *
 * Junta numa única lista o que o utilizador pode decidir agora:
 *  - NEED_ANALYSIS  → necessidades «Em análise» (proformas carregadas);
 *  - EXTRA_REQUEST  → pedidos extra pendentes;
 *  - PURCHASE_ORDER → requisições de compra a aguardar aprovação;
 *  - REINFORCEMENT  → pedidos de reforço de fundo de maneio.
 *
 * Só lista. A decisão continua a passar pelas rotas de cada módulo (o
 * frontend chama-as uma a uma), por isso as regras, a auditoria e as
 * notificações de cada fluxo mantêm-se exatamente iguais.
 */

const KIND_LABEL = {
  NEED_ANALYSIS: "Análise de necessidade",
  EXTRA_REQUEST: "Pedido extra",
  PURCHASE_ORDER: "Requisição de compra",
  REINFORCEMENT: "Reforço de fundo",
};

const PURCHASE_APPROVER_ROLES = ["admin", "financeiro", "supervisor"];
const MAX_PER_KIND = 100;

const num = (v) => (v == null ? null : Number(v));
const projectRef = (p) => (p ? { id: p.id, code: p.code || null, name: p.name || null } : null);

/**
 * Espelha `requirePermission` / `requirePermissionOrLegacyRole` para uma
 * escrita: devolve "all", "own" ou null (sem acesso).
 */
async function writeScope(user, moduleName, action, legacyRoles = [], method = "PATCH") {
  const role = String(user.role || "").toLowerCase();
  const { allowed } = await checkUserPermission(user.sub, role, moduleName, action, method);
  if (allowed === "true") return "all";
  if (allowed === "own") return "own";
  if (legacyRoles.includes(role)) return "all";
  return null;
}

/** Filtro de obra para escopo «own» (obras atribuídas ao utilizador). */
function ownProjects(user) {
  return { project: { assignedUsers: { some: { id: user.sub } } } };
}

async function extraRequests(user) {
  if (String(user.role).toLowerCase() === "cliente") return [];
  const scope = await writeScope(user, "pedidosExtras", "approve", ["admin", "supervisor"]);
  if (!scope) return [];
  const rejectScope = await writeScope(user, "pedidosExtras", "reject", ["admin", "supervisor"]);
  const rows = await prisma.extraRequest.findMany({
    where: { status: "PENDENTE", ...(scope === "own" ? ownProjects(user) : {}) },
    orderBy: { requestedAt: "asc" },
    take: MAX_PER_KIND,
    include: { project: { select: { id: true, code: true, name: true } } },
  });
  return rows.map((r) => {
    let blocker = null;
    if (r.paymentSource === "SOLICITACAO_TRANSFERENCIA") {
      if (!r.supplierName || !r.supplierNif || !r.supplierIban) blocker = "Falta o fornecedor (nome, NIF e IBAN).";
      else if (!r.proformaUrl) blocker = "Falta a proforma.";
    }
    const params = new URLSearchParams({ extraRequestId: r.id });
    if (r.projectId) params.set("projectId", r.projectId);
    return {
      kind: "EXTRA_REQUEST",
      id: r.id,
      title: r.description,
      subtitle: r.paymentSource === "SOLICITACAO_TRANSFERENCIA" ? "Transferência bancária" : r.paymentSource === "CAIXA" ? "Caixa" : String(r.paymentSource || ""),
      amount: num(r.amount),
      currency: r.currency || "AOA",
      priority: r.priority === "URGENTE" || r.priority === "ALTA" ? r.priority : null,
      project: projectRef(r.project),
      requestedBy: r.requestedBy || null,
      createdAt: r.requestedAt || r.createdAt,
      blocker,
      canReject: Boolean(rejectScope && (rejectScope === "all" || r.projectId)),
      href: `/Financeiro/centroDeCompras.html?${params}`,
    };
  });
}

async function purchaseOrders(user) {
  const role = String(user.role || "").toLowerCase();
  if (!PURCHASE_APPROVER_ROLES.includes(role)) return [];
  const scope = await writeScope(user, "pedidosExtras", "approve", PURCHASE_APPROVER_ROLES, "POST");
  if (!scope) return [];
  const rows = await prisma.purchaseOrder.findMany({
    where: { status: "PENDENTE_APROVACAO" },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_KIND,
    include: { project: { select: { id: true, code: true, name: true } } },
  });
  return rows.map((r) => ({
    kind: "PURCHASE_ORDER",
    id: r.id,
    title: `${r.number} · ${r.description}`,
    subtitle: r.supplierName || r.department || "",
    amount: num(r.totalValue),
    currency: r.currency || "AOA",
    priority: r.priority === "URGENTE" || r.priority === "ALTA" ? r.priority : null,
    project: projectRef(r.project),
    requestedBy: r.requestedByName || null,
    createdAt: r.createdAt,
    blocker: null,
    canReject: true,
    href: "/Financeiro/centroDeCompras.html?tab=compras",
  }));
}

async function needAnalyses(user) {
  const role = String(user.role || "").toLowerCase();
  if (!["admin", "operador"].includes(role)) return [];
  const rows = await prisma.workNeed.findMany({
    where: { status: "EM_ANALISE" },
    orderBy: { updatedAt: "asc" },
    take: MAX_PER_KIND,
    include: {
      project: { select: { id: true, code: true, name: true } },
      costCenter: { select: { id: true, code: true, name: true } },
      quotes: {
        where: { selected: true },
        select: { proformaUrl: true, totalValue: true, quotedPrice: true, quantity: true, currency: true, supplier: { select: { name: true } } },
      },
    },
  });
  return rows.map((n) => {
    const quotes = n.quotes || [];
    let blocker = null;
    if (!quotes.length) blocker = "Sem cotação selecionada.";
    else {
      const missing = quotes.filter((q) => !q.proformaUrl).length;
      if (missing) blocker = `Falta a proforma de ${missing} fornecedor${missing > 1 ? "es" : ""}.`;
    }
    const total = quotes.reduce((sum, q) => {
      const t = q.totalValue != null ? Number(q.totalValue) : Number(q.quotedPrice || 0) * Number(q.quantity ?? n.quantity ?? 0);
      return sum + (Number.isFinite(t) ? t : 0);
    }, 0);
    const qty = n.quantity != null ? `${Number(n.quantity)} ${n.unit || ""}`.trim() : "";
    const suppliers = [...new Set(quotes.map((q) => q.supplier?.name).filter(Boolean))].join(", ");
    const params = new URLSearchParams({ tab: "plano_financeiro", sub: "cronograma", needId: n.id });
    if (n.projectId) params.set("id", n.projectId);
    return {
      kind: "NEED_ANALYSIS",
      id: n.id,
      title: n.description,
      subtitle: [qty, suppliers, n.costCenter?.code || n.costCenter?.name].filter(Boolean).join(" · "),
      amount: total || null,
      currency: quotes[0]?.currency || "AOA",
      priority: n.priority === "ALTA" ? "ALTA" : null,
      project: projectRef(n.project),
      requestedBy: n.responsible || null,
      createdAt: n.updatedAt,
      blocker,
      canReject: false,
      href: n.projectId ? `/Projectos/projectView.html?${params}` : null,
    };
  });
}

async function reinforcements(user) {
  if (String(user.role).toLowerCase() === "cliente") return [];
  const scope = await writeScope(user, "financeiro", "approve", ["admin", "financeiro"]);
  if (!scope) return [];
  const rows = await prisma.pettyCashReinforcementRequest.findMany({
    where: { status: "PENDENTE" },
    orderBy: { requestedAt: "asc" },
    take: MAX_PER_KIND,
    include: {
      fund: { select: { name: true, currency: true, project: { select: { id: true, code: true, name: true } } } },
      card: { select: { label: true } },
    },
  });
  return rows.map((r) => ({
    kind: "REINFORCEMENT",
    id: r.id,
    title: r.reason,
    subtitle: [r.fund?.name, r.card?.label ? `cartão ${r.card.label}` : null].filter(Boolean).join(" · "),
    amount: num(r.amount),
    currency: r.fund?.currency || "AOA",
    priority: null,
    project: projectRef(r.fund?.project),
    requestedBy: r.requestedBy || null,
    createdAt: r.requestedAt || r.createdAt,
    blocker: null,
    canReject: true,
    href: "/Financeiro/financeiro.html",
  }));
}

/** Lista de aprovações pendentes do utilizador, mais antigas primeiro. */
async function pendingApprovals(user) {
  const groups = await Promise.all([needAnalyses(user), extraRequests(user), purchaseOrders(user), reinforcements(user)]);
  const items = groups
    .flat()
    .map((i) => ({ ...i, kindLabel: KIND_LABEL[i.kind] }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const counts = {};
  items.forEach((i) => (counts[i.kind] = (counts[i.kind] || 0) + 1));
  return { items, counts, total: items.length };
}

module.exports = { pendingApprovals, KIND_LABEL, writeScope };
