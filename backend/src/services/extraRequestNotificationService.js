const { prisma } = require("../db");
const { dispatchNotification, CHANNELS } = require("./notifications/dispatcher");
const { resolveApprovedForPaymentRecipients } = require("./paymentNotificationService");

function formatMoney(value, currency = "AOA") {
  const n = Number(value);
  if (!Number.isFinite(n)) return `0,00 ${currency}`;
  return `${n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** Todos os pedidos extra aprovados liquidam-se no Perfil Financeiro. */
function needsFinanceiroLiquidation(extra) {
  return Boolean(extra?.id);
}

function buildExtraLink(extra) {
  const params = new URLSearchParams({ extraRequestId: extra.id });
  if (extra.projectId) params.set("projectId", extra.projectId);
  return `/Financeiro/financeiro.html?${params}`;
}

function buildExtraNotificationContent(extra) {
  const cur = extra.currency || "AOA";
  const amount = formatMoney(extra.amount, cur);
  const projectName = extra.project?.name || (extra.type === "GERAL" ? "Geral" : "Obra");
  const solicitante = extra.requestedBy || "—";
  const title = `Pedido Extra aprovado · ${projectName}`;
  const body = `${solicitante} · ${extra.description} · ${amount}`;
  return { title, body, solicitante, amount };
}

async function notifyExtraRequestApproved(io, extra, actor = {}) {
  if (!extra?.id || extra.status !== "APROVADO") return { sent: 0 };
  if (!needsFinanceiroLiquidation(extra)) return { sent: 0 };

  const recipientIds = await resolveApprovedForPaymentRecipients();
  const filteredIds = recipientIds.filter((userId) => !(actor.sub && userId === actor.sub));
  if (!filteredIds.length) return { sent: 0 };

  const { title, body, solicitante, amount } = buildExtraNotificationContent(extra);
  const link = buildExtraLink(extra);
  const metadata = {
    extraRequestId: extra.id,
    event: "EXTRA_APPROVED",
    projectId: extra.projectId || null,
    costCenterId: extra.costCenterId || null,
    requestedBy: solicitante,
    description: extra.description,
    amount: String(extra.amount),
    currency: extra.currency || "AOA",
    paymentSource: extra.paymentSource,
  };

  const recipients = await prisma.user.findMany({
    where: { id: { in: filteredIds } },
    select: { id: true, email: true, profile: { select: { whatsapp: true } } },
  });

  let sent = 0;
  for (const recipient of recipients) {
    await dispatchNotification({
      io,
      user: recipient,
      type: "PAYMENT",
      title,
      body,
      link,
      metadata,
      channels: [CHANNELS.IN_APP],
    });
    sent += 1;
  }

  return { sent };
}

async function loadExtraForNotification(extraId) {
  return prisma.extraRequest.findUnique({
    where: { id: extraId },
    include: {
      project: { select: { id: true, name: true, code: true } },
      costCenter: { select: { id: true, code: true, name: true } },
    },
  });
}

module.exports = {
  notifyExtraRequestApproved,
  loadExtraForNotification,
  needsFinanceiroLiquidation,
};
