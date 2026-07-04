const { prisma } = require("../db");

async function createNotification({ userId, type, title, body, link, metadata }) {
  return prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body: body || null,
      link: link || null,
      metadata: metadata || undefined,
    },
  });
}

async function notifyNewMessage({ recipientIds, senderName, conversationId, messageId }) {
  const title = `Nova mensagem de ${senderName || "Utilizador"}`;
  const link = `/chat?conversation=${conversationId}`;

  await Promise.all(
    recipientIds.map((userId) =>
      createNotification({
        userId,
        type: "NEW_MESSAGE",
        title,
        body: null,
        link,
        metadata: { conversationId, messageId },
      })
    )
  );
}

async function notifyMentions({ mentionIds, senderName, conversationId, messageId, bodyPreview }) {
  const title = `${senderName || "Alguém"} mencionou-o`;
  const link = `/chat?conversation=${conversationId}`;

  await Promise.all(
    mentionIds.map((userId) =>
      createNotification({
        userId,
        type: "MENTION",
        title,
        body: bodyPreview?.slice(0, 200) || null,
        link,
        metadata: { conversationId, messageId },
      })
    )
  );
}

async function listNotifications(userId, { unreadOnly = false, limit = 30 } = {}) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(limit) || 30, 100),
  });
}

async function countUnread(userId) {
  return prisma.notification.count({ where: { userId, read: false } });
}

async function markRead(notificationId, userId) {
  const row = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!row) {
    const err = new Error("NOTIFICATION_NOT_FOUND");
    err.status = 404;
    throw err;
  }
  return prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
  });
}

async function markAllRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
  return { marked: result.count };
}

module.exports = {
  createNotification,
  notifyNewMessage,
  notifyMentions,
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
};
