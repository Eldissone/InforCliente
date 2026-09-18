const { prisma } = require("../db");
const { dispatchNotification, CHANNELS } = require("./notifications/dispatcher");

function typeLabel(type) {
  return type === "DUVIDA" ? "Dúvida" : "Melhoria";
}

function adminInboxLink(ticketId) {
  return `/Users/index.html?section=ajuda&id=${encodeURIComponent(ticketId)}`;
}

function authorTicketLink(ticketId) {
  return `/Dashboard/index.html?helpTicket=${encodeURIComponent(ticketId)}`;
}

function previewMessage(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (text.length <= 160) return text;
  return `${text.slice(0, 157)}…`;
}

async function notifyAdminsNewHelpTicket(io, ticket, actor = {}) {
  if (!ticket?.id) return { sent: 0 };

  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    select: { id: true, email: true, profile: { select: { whatsapp: true } } },
  });

  const recipients = admins.filter((user) => user.id !== actor.sub && user.id !== actor.id);
  if (!recipients.length) return { sent: 0 };

  const kind = typeLabel(ticket.type);
  const authorName = ticket.createdBy?.name || ticket.createdBy?.email || "Um utilizador";
  const title = `Nova ${kind.toLowerCase()} no sistema`;
  const body = `${authorName}: ${previewMessage(ticket.message)}`;
  const link = adminInboxLink(ticket.id);
  const metadata = {
    helpTicketId: ticket.id,
    event: "HELP_TICKET_CREATED",
    type: ticket.type,
    pageUrl: ticket.pageUrl || null,
  };

  let sent = 0;
  for (const recipient of recipients) {
    await dispatchNotification({
      io,
      user: recipient,
      type: "SYSTEM",
      title,
      body,
      link,
      metadata,
      channels: [CHANNELS.IN_APP, CHANNELS.EMAIL],
    });
    sent += 1;
  }

  return { sent };
}

async function notifyAuthorHelpTicketUpdate(io, ticket, { replied = false, resolved = false } = {}) {
  if (!ticket?.id || !ticket.createdById) return { sent: 0 };
  if (!replied && !resolved) return { sent: 0 };

  const author = await prisma.user.findUnique({
    where: { id: ticket.createdById },
    select: { id: true, email: true, profile: { select: { whatsapp: true } } },
  });
  if (!author) return { sent: 0 };

  const kind = typeLabel(ticket.type);
  const title = resolved
    ? `${kind} marcada como resolvida`
    : `Resposta à sua ${kind.toLowerCase()}`;
  const body = resolved
    ? (ticket.adminReply ? previewMessage(ticket.adminReply) : "O pedido foi marcado como resolvido.")
    : previewMessage(ticket.adminReply || "Há uma nova resposta da administração.");

  await dispatchNotification({
    io,
    user: author,
    type: "SYSTEM",
    title,
    body,
    link: authorTicketLink(ticket.id),
    metadata: {
      helpTicketId: ticket.id,
      event: resolved ? "HELP_TICKET_RESOLVED" : "HELP_TICKET_REPLIED",
      type: ticket.type,
    },
    channels: [CHANNELS.IN_APP, CHANNELS.EMAIL],
  });

  return { sent: 1 };
}

module.exports = {
  notifyAdminsNewHelpTicket,
  notifyAuthorHelpTicketUpdate,
};
