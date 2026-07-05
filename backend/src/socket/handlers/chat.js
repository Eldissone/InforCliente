const { prisma } = require("../../db");
const {
  sendMessage,
  markConversationRead,
  assertConversationAccess,
  parseMentionIds,
} = require("../../services/chatService");
const { notifyNewMessage, notifyMentions } = require("../../services/notificationService");

function registerChatHandlers(io, socket) {
  const userId = socket.user.id;

  socket.on("conversation:join", async ({ conversationId }, ack) => {
    try {
      await assertConversationAccess(userId, conversationId);
      socket.join(`conversation:${conversationId}`);
      if (typeof ack === "function") ack({ ok: true });
    } catch (err) {
      if (typeof ack === "function") ack({ ok: false, error: err.message });
    }
  });

  socket.on("conversation:leave", ({ conversationId }) => {
    if (conversationId) socket.leave(`conversation:${conversationId}`);
  });

  socket.on("message:send", async ({ conversationId, body, mentionIds, attachments, userName }, ack) => {
    try {
      const message = await sendMessage({ conversationId, senderId: userId, body, mentionIds, attachments });

      await prisma.message.update({
        where: { id: message.id },
        data: { status: "DELIVERED" },
      });
      message.status = "DELIVERED";

      io.to(`conversation:${conversationId}`).emit("message:new", message);

      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      const recipientIds = participants
        .map((p) => p.userId)
        .filter((id) => id !== userId);

      const parsedMentions = parseMentionIds(body, mentionIds).filter((id) => id !== userId);

      const computedSenderName = userName || socket.user.name || (socket.user.email ? socket.user.email.split('@')[0] : "Utilizador");

      await notifyNewMessage({
        recipientIds,
        senderName: computedSenderName,
        conversationId,
        messageId: message.id,
      });

      if (parsedMentions.length) {
        await notifyMentions({
          mentionIds: parsedMentions,
          senderName: computedSenderName,
          conversationId,
          messageId: message.id,
          bodyPreview: body,
        });
      }

      for (const recipientId of [...new Set([...recipientIds, ...parsedMentions])]) {
        io.to(`user:${recipientId}`).emit("notification:new", {
          type: parsedMentions.includes(recipientId) ? "MENTION" : "NEW_MESSAGE",
          conversationId,
          messageId: message.id,
        });
      }

      if (typeof ack === "function") ack({ ok: true, message });
    } catch (err) {
      if (typeof ack === "function") ack({ ok: false, error: err.message });
    }
  });

  socket.on("message:read", async ({ conversationId, messageId }, ack) => {
    try {
      if (messageId) {
        await prisma.messageRead.upsert({
          where: { messageId_userId: { messageId, userId } },
          create: { messageId, userId },
          update: { readAt: new Date() },
        });
        io.to(`conversation:${conversationId}`).emit("message:status", {
          messageId,
          userId,
          status: "READ",
        });
      } else if (conversationId) {
        await markConversationRead(conversationId, userId);
      }
      if (typeof ack === "function") ack({ ok: true });
    } catch (err) {
      if (typeof ack === "function") ack({ ok: false, error: err.message });
    }
  });

  const typingTimers = new Map();

  socket.on("typing:start", ({ conversationId, userName }) => {
    if (!conversationId) return;
    const computedSenderName = userName || socket.user.name || (socket.user.email ? socket.user.email.split('@')[0] : "Utilizador");
    socket.to(`conversation:${conversationId}`).emit("typing:update", {
      conversationId,
      userId,
      isTyping: true,
      userName: computedSenderName,
    });
    clearTimeout(typingTimers.get(conversationId));
    typingTimers.set(
      conversationId,
      setTimeout(() => {
        socket.to(`conversation:${conversationId}`).emit("typing:update", {
          conversationId,
          userId,
          isTyping: false,
        });
      }, 3000)
    );
  });

  socket.on("typing:stop", ({ conversationId }) => {
    if (!conversationId) return;
    clearTimeout(typingTimers.get(conversationId));
    socket.to(`conversation:${conversationId}`).emit("typing:update", {
      conversationId,
      userId,
      isTyping: false,
    });
  });
}

module.exports = { registerChatHandlers };
