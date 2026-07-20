const { prisma } = require("../db");
const { startOfDay, addDays } = require("./paymentTimelineService");
const { dispatchNotification, CHANNELS } = require("./notifications/dispatcher");

const EVENT_LABELS = {
  PAYMENT_CREATED: "Pagamento criado",
  PAYMENT_CONFIRMED: "Pagamento confirmado",
  PAYMENT_DUE: "Pagamento a vencer amanhã",
  PAYMENT_OVERDUE: "Pagamento em atraso",
};

function formatMoney(value, currency = "AOA") {
  const n = Number(value);
  if (!Number.isFinite(n)) return `0,00 ${currency}`;
  return `${n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

async function alreadyNotified(userId, paymentId, event) {
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: "PAYMENT",
      AND: [
        { metadata: { path: ["paymentId"], equals: paymentId } },
        { metadata: { path: ["event"], equals: event } },
      ],
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function resolveFinancialReceiverIds() {
  const profiles = await prisma.userProfile.findMany({
    where: { isFinancialReceiver: true },
    select: { userId: true },
  });
  return profiles.map((p) => p.userId).filter(Boolean);
}

/** Admin e perfil Financeiro — recebem todas as notificações operacionais. */
async function resolveFinanceStaffIds() {
  const users = await prisma.user.findMany({
    where: { role: { in: ["admin", "financeiro"] } },
    select: { id: true },
  });
  return users.map((u) => u.id).filter(Boolean);
}

/** Receptores externos: só liquidados (comprovativo) e itens aprovados para pagamento. */
const RECEIVER_PAYMENT_EVENTS = new Set(["PAYMENT_CONFIRMED"]);

async function resolvePaymentNotificationRecipients(event, { explicitRecipientIds = [] } = {}) {
  const financeStaff = await resolveFinanceStaffIds();
  const explicit = explicitRecipientIds.filter(Boolean);

  if (RECEIVER_PAYMENT_EVENTS.has(event)) {
    const receivers = await resolveFinancialReceiverIds();
    return [...new Set([...financeStaff, ...receivers, ...explicit])];
  }

  return [...new Set([...financeStaff, ...explicit])];
}

async function resolveApprovedForPaymentRecipients({ explicitRecipientIds = [] } = {}) {
  const financeStaff = await resolveFinanceStaffIds();
  const receivers = await resolveFinancialReceiverIds();
  return [...new Set([...financeStaff, ...receivers, ...explicitRecipientIds.filter(Boolean)])];
}

function buildPaymentLink(payment, event) {
  const params = new URLSearchParams({ paymentId: payment.id });
  if (payment.projectId) params.set("projectId", payment.projectId);
  if (event === "PAYMENT_CONFIRMED" && payment.comprovativoUrl) {
    params.set("focus", "comprovativo");
  }
  return `/Financeiro/financeiro.html?${params}`;
}

function buildNotificationContent(payment, event) {
  const cur = payment.costCenter?.currency || "AOA";
  const amount = formatMoney(payment.paidAmount || payment.budgetedAmount, cur);
  const projectName = payment.project?.name || "Obra";
  const supplier = payment.supplier || "—";
  const title = `${EVENT_LABELS[event] || "Pagamento"} · ${projectName}`;
  const body = `${payment.description} · ${supplier} · ${amount}`;
  return { title, body };
}

async function notifyPaymentEvent(io, payment, event, actor = {}, options = {}) {
  if (!payment?.id) return { sent: 0 };

  // Além dos destinatários resolvidos automaticamente (perfil/atribuição à obra),
  // permite que quem confirma o pagamento indique explicitamente quem deve
  // receber o comprovativo (ex.: escolhido no momento da liquidação).
  const explicitRecipientIds = Array.isArray(options.explicitRecipientIds)
    ? options.explicitRecipientIds.filter(Boolean)
    : [];
  const recipientIds = await resolvePaymentNotificationRecipients(event, { explicitRecipientIds });
  const explicitSet = new Set(explicitRecipientIds);
  // Quem liquida o pagamento não recebe notificações automáticas (evita ruído),
  // mas se foi explicitamente seleccionado em "Notificar / Enviar comprovativo a"
  // deve receber — escolheu activamente receber o comprovativo.
  const filteredIds = recipientIds.filter(
    (userId) => explicitSet.has(userId) || !(actor.sub && userId === actor.sub)
  );
  if (!filteredIds.length) return { sent: 0 };

  const dedupeEvents = new Set(["PAYMENT_DUE", "PAYMENT_OVERDUE"]);
  const { title, body } = buildNotificationContent(payment, event);
  const link = buildPaymentLink(payment, event);
  const metadata = {
    paymentId: payment.id,
    event,
    projectId: payment.projectId,
    costCenterId: payment.costCenterId,
    comprovativoUrl: payment.comprovativoUrl || null,
    amount: String(payment.paidAmount || payment.budgetedAmount),
    supplier: payment.supplier || null,
    actorId: actor.sub || null,
    actorName: actor.name || null,
  };

  // O comprovativo em PDF só existe a partir da confirmação do pagamento;
  // é o momento certo (definido no plano) para tentar canais adicionais
  // (WhatsApp/email) além da notificação in-app.
  const attachments =
    event === "PAYMENT_CONFIRMED" && payment.comprovativoUrl
      ? [{ url: payment.comprovativoUrl, filename: "comprovativo.pdf" }]
      : undefined;

  const recipients = await prisma.user.findMany({
    where: { id: { in: filteredIds } },
    select: {
      id: true,
      email: true,
      profile: { select: { whatsapp: true, isFinancialReceiver: true } },
    },
  });

  let sent = 0;
  for (const recipient of recipients) {
    if (dedupeEvents.has(event) && (await alreadyNotified(recipient.id, payment.id, event))) continue;

    // O canal WhatsApp é pedido para quem está marcado como receptor
    // financeiro OU foi explicitamente escolhido ao liquidar o pagamento,
    // desde que tenha número preenchido; hoje fica "SKIPPED" enquanto não
    // houver um fornecedor configurado (ver services/notifications).
    const channels = [CHANNELS.IN_APP];
    const wantsWhatsapp =
      event === "PAYMENT_CONFIRMED" &&
      recipient.profile?.whatsapp &&
      (recipient.profile?.isFinancialReceiver || explicitSet.has(recipient.id));
    if (wantsWhatsapp) {
      channels.push(CHANNELS.WHATSAPP);
    }

    await dispatchNotification({
      io,
      user: recipient,
      type: "PAYMENT",
      title,
      body,
      link,
      metadata,
      channels,
      attachments,
    });
    sent += 1;
  }

  return { sent };
}

async function notifyPaymentBatchCreated(io, payments, actor = {}) {
  if (!payments?.length) return;
  const first = payments[0];
  const full = await prisma.costPayment.findFirst({
    where: { id: first.id },
    include: {
      project: { select: { id: true, name: true } },
      costCenter: { select: { code: true, name: true, currency: true } },
    },
  });
  if (!full) return;

  const recipientIds = await resolveFinanceStaffIds();
  const filteredIds = recipientIds.filter((userId) => !(actor.sub && userId === actor.sub));
  if (!filteredIds.length) return;

  const { title, body } = buildNotificationContent(full, "PAYMENT_CREATED");
  const batchTitle = `${title} (${payments.length} parcela(s))`;
  const link = buildPaymentLink(full, "PAYMENT_CREATED");
  const metadata = {
    paymentId: full.id,
    event: "PAYMENT_CREATED",
    batchCount: payments.length,
    projectId: full.projectId,
  };

  const recipients = await prisma.user.findMany({
    where: { id: { in: filteredIds } },
    select: { id: true, email: true, profile: { select: { whatsapp: true } } },
  });

  for (const recipient of recipients) {
    await dispatchNotification({
      io,
      user: recipient,
      type: "PAYMENT",
      title: batchTitle,
      body,
      link,
      metadata,
      channels: [CHANNELS.IN_APP],
    });
  }
}

function buildNeedFinanceLink(need) {
  const params = new URLSearchParams({
    projectId: need.projectId,
    tab: "cronograma",
    needId: need.id,
  });
  return `/Projectos/centroCustos.html?${params}`;
}

async function notifyNeedSentToFinance(io, payload, actor = {}) {
  const { need, quote, amount, currency } = payload;
  if (!need?.id) return { sent: 0 };

  const recipientIds = await resolveFinanceStaffIds();
  const filteredIds = recipientIds.filter((userId) => !(actor.sub && userId === actor.sub));
  if (!filteredIds.length) return { sent: 0 };

  const projectName = need.project?.name || "Obra";
  const supplier = quote?.supplier?.name || "—";
  const money = formatMoney(amount, currency);
  const title = `Agendar pagamento · ${projectName}`;
  const body = `${need.description} · ${supplier} · ${money} — aguarda cronograma`;
  const link = buildNeedFinanceLink(need);
  const metadata = {
    event: "NEED_SENT_TO_FINANCE",
    needId: need.id,
    projectId: need.projectId,
    costCenterId: need.costCenterId,
    quoteId: quote?.id || null,
    proformaUrl: quote?.proformaUrl || null,
    amount: String(amount),
    supplier,
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

async function scanDueAndOverduePayments(io) {
  const today = startOfDay(new Date());
  const pending = await prisma.costPayment.findMany({
    where: { status: "PENDENTE" },
    include: {
      project: { select: { id: true, name: true } },
      costCenter: { select: { code: true, name: true, currency: true } },
    },
  });

  let sent = 0;
  for (const payment of pending) {
    const due = startOfDay(payment.paymentDate);
    const visibility = addDays(due, -1);

    if (due < today) {
      const r = await notifyPaymentEvent(io, payment, "PAYMENT_OVERDUE", {});
      sent += r.sent;
    } else if (visibility.getTime() === today.getTime()) {
      const r = await notifyPaymentEvent(io, payment, "PAYMENT_DUE", {});
      sent += r.sent;
    }
  }
  return { sent };
}

async function loadPaymentForNotification(paymentId) {
  return prisma.costPayment.findUnique({
    where: { id: paymentId },
    include: {
      project: { select: { id: true, name: true } },
      costCenter: { select: { code: true, name: true, currency: true } },
    },
  });
}

module.exports = {
  notifyPaymentEvent,
  notifyPaymentBatchCreated,
  notifyNeedSentToFinance,
  scanDueAndOverduePayments,
  loadPaymentForNotification,
  resolveFinanceStaffIds,
  resolveFinancialReceiverIds,
  resolveApprovedForPaymentRecipients,
};
