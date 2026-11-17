const { prisma } = require("../../db");
const { dispatchNotification, CHANNELS } = require("../notifications/dispatcher");
const { writeScope, KIND_LABEL } = require("./service");

/**
 * Avisa quem pode decidir que há uma aprovação à espera (Fase 4).
 * A notificação leva `metadata.approval = { kind, ids }`, e o sino mostra
 * logo os botões Aprovar / Rejeitar enquanto o item continuar pendente.
 */

const PURCHASE_APPROVER_ROLES = ["admin", "financeiro", "supervisor"];

/** Mesmas regras que `pendingApprovals` usa para listar. */
async function canDecide(user, kind, projectId) {
  const role = String(user.role || "").toLowerCase();
  if (role === "cliente") return false;
  if (kind === "NEED_ANALYSIS") return ["admin", "operador"].includes(role);
  if (kind === "PURCHASE_ORDER") {
    if (!PURCHASE_APPROVER_ROLES.includes(role)) return false;
    return Boolean(await writeScope(user, "pedidosExtras", "approve", PURCHASE_APPROVER_ROLES, "POST"));
  }
  if (kind === "REINFORCEMENT") return Boolean(await writeScope(user, "financeiro", "approve", ["admin", "financeiro"]));
  if (kind === "EXTRA_REQUEST") {
    const scope = await writeScope(user, "pedidosExtras", "approve", ["admin", "supervisor"]);
    if (scope === "all") return true;
    if (scope !== "own" || !projectId) return false;
    const assigned = await prisma.project.count({
      where: { id: projectId, assignedUsers: { some: { id: user.sub } } },
    });
    return assigned > 0;
  }
  return false;
}

async function approversFor(kind, projectId, actorId) {
  const users = await prisma.user.findMany({
    where: { role: { not: "cliente" }, ...(actorId ? { id: { not: actorId } } : {}) },
    select: { id: true, email: true, role: true, profile: { select: { whatsapp: true } } },
  });
  const out = [];
  for (const u of users) {
    if (await canDecide({ sub: u.id, role: u.role }, kind, projectId)) out.push(u);
  }
  return out;
}

function money(value, currency = "AOA") {
  const n = Number(value);
  if (!Number.isFinite(n) || !n) return "";
  return `${n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/**
 * @param {object} p
 * @param {"NEED_ANALYSIS"|"EXTRA_REQUEST"|"PURCHASE_ORDER"|"REINFORCEMENT"} p.kind
 * @param {string[]} p.ids
 * @param {string|null} [p.projectId]
 * @param {string} p.title
 * @param {string} [p.body]
 * @param {string} [p.link]
 * @param {boolean} [p.urgent]
 */
async function notifyApprovalRequested(io, p, actor = {}) {
  const ids = (p.ids || []).filter(Boolean);
  if (!ids.length) return { sent: 0 };
  const recipients = await approversFor(p.kind, p.projectId || null, actor.sub || null);
  for (const user of recipients) {
    await dispatchNotification({
      io,
      user,
      type: "APPROVAL",
      title: p.title,
      body: p.body || "",
      link: p.link || null,
      priority: p.urgent ? "HIGH" : "NORMAL",
      projectId: p.projectId || null,
      metadata: {
        event: "APPROVAL_REQUESTED",
        approval: { kind: p.kind, ids },
        projectId: p.projectId || null,
        kindLabel: KIND_LABEL[p.kind],
      },
      channels: [CHANNELS.IN_APP],
    });
  }
  return { sent: recipients.length };
}

/** Atalho «dispara e esquece» para as rotas: nunca rebenta o pedido original. */
function fireApprovalRequested(req, payload) {
  const io = req.app?.get?.("io");
  notifyApprovalRequested(io, payload, req.user || {}).catch((e) => console.error("notifyApprovalRequested:", e));
}

module.exports = { notifyApprovalRequested, fireApprovalRequested, canDecide, money };
