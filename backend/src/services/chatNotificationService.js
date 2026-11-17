const { dispatchNotification, CHANNELS } = require("./notifications/dispatcher");

const PREVIEW_MAX = 140;

/** Texto curto da mensagem para a notificação (menções `@[Nome](id)` → `@Nome`). */
function buildPreview(body, attachments) {
  const text = String(body || "")
    .replace(/@\[([^\]]+)\]\([^)]+\)/g, "@$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
  return attachments?.length ? "📎 Anexo" : null;
}

/**
 * Notifica os destinatários de uma mensagem de chat através do dispatcher
 * (grava a notificação e emite `notification:new` na sala do utilizador).
 *
 * - Cada destinatário recebe UMA notificação: MENTION se foi mencionado,
 *   senão NEW_MESSAGE.
 * - Mensagens seguidas do mesmo remetente na mesma conversa são agrupadas
 *   ("3 novas mensagens de Ana") enquanto não forem lidas.
 */
async function notifyChatMessage({ io, conversationId, message, senderId, senderName, recipientIds, mentionIds }) {
  const name = senderName || "Utilizador";
  const preview = buildPreview(message?.body, message?.attachments);
  const link = `/chat?conversation=${conversationId}`;
  const mentioned = new Set((mentionIds || []).filter((id) => id && id !== senderId));
  const targets = [...new Set([...(recipientIds || []), ...mentioned])].filter((id) => id && id !== senderId);

  await Promise.all(
    targets.map((userId) => {
      const isMention = mentioned.has(userId);
      return dispatchNotification({
        io,
        user: { id: userId },
        type: isMention ? "MENTION" : "NEW_MESSAGE",
        title: isMention ? `${name} mencionou-o` : `Nova mensagem de ${name}`,
        body: preview,
        link,
        metadata: { conversationId, messageId: message?.id || null, senderId },
        priority: isMention ? "HIGH" : "NORMAL",
        groupKey: isMention ? null : `chat:${conversationId}:${senderId}`,
        groupTitle: isMention ? null : `{count} novas mensagens de ${name}`,
        channels: [CHANNELS.IN_APP],
      });
    })
  );

  return { notified: targets.length };
}

module.exports = { notifyChatMessage, buildPreview };
