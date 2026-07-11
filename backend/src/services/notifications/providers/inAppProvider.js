const { createNotification } = require("../../notificationService");
const { CHANNELS, DELIVERY_STATUS } = require("../channels");

/**
 * Provider do canal in-app: grava a notificação na tabela `Notification` e
 * emite em tempo real via Socket.IO quando existir uma instância `io`
 * disponível. É o único canal que hoje entrega de facto — os restantes
 * (email/whatsapp) ficam preparados mas inativos até haver credenciais.
 */
async function send({ io, user, type, title, body, link, metadata }) {
  const notification = await createNotification({
    userId: user.id,
    type,
    title,
    body,
    link,
    metadata,
  });

  if (io) {
    io.to(`user:${user.id}`).emit("notification:new", {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      metadata: notification.metadata || null,
      createdAt: notification.createdAt,
    });
  }

  return { channel: CHANNELS.IN_APP, status: DELIVERY_STATUS.SENT, notificationId: notification.id };
}

function isConfigured() {
  return true;
}

module.exports = { send, isConfigured };
