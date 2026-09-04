const { prisma } = require("../db");

const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  profilePic: true,
  client: { select: { profilePic: true } },
  profile: {
    select: {
      jobTitle: true,
      phone: true,
      whatsapp: true,
      isFinancialReceiver: true,
      isApprover: true,
      isProjectResponsible: true,
    },
  },
  presence: { select: { status: true, lastSeenAt: true } },
};

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    profilePic: user.profilePic || user.client?.profilePic || null,
    createdAt: user.createdAt || null,
    jobTitle: user.profile?.jobTitle || null,
    phone: user.profile?.phone || null,
    whatsapp: user.profile?.whatsapp || null,
    isFinancialReceiver: Boolean(user.profile?.isFinancialReceiver),
    isApprover: Boolean(user.profile?.isApprover),
    isProjectResponsible: Boolean(user.profile?.isProjectResponsible),
    bio: user.profile?.bio || null,
    presence: user.presence
      ? { status: user.presence.status, lastSeenAt: user.presence.lastSeenAt }
      : { status: "OFFLINE", lastSeenAt: null },
  };
}

function serializeMessage(message) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    status: message.status,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    sender: serializeUser(message.sender),
    mentions: (message.mentions || []).map((m) => ({
      id: m.id,
      userId: m.mentionedUserId,
      user: serializeUser(m.mentionedUser),
    })),
    attachments: message.attachments || [],
  };
}

async function assertParticipant(userId, conversationId) {
  const row = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!row) {
    const err = new Error("CONVERSATION_FORBIDDEN");
    err.status = 403;
    throw err;
  }
  return row;
}

function isClienteRole(role) {
  return String(role || "").toLowerCase() === "cliente";
}

async function assertClientChatPolicy(requesterId, otherUserIds) {
  const requester = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { role: true },
  });
  if (!isClienteRole(requester?.role)) return;

  const ids = [...new Set((otherUserIds || []).filter(Boolean))];
  if (!ids.length) return;

  const blocked = await prisma.user.findFirst({
    where: { id: { in: ids }, role: "cliente" },
    select: { id: true },
  });
  if (blocked) {
    const err = new Error("CLIENT_TO_CLIENT_CHAT_FORBIDDEN");
    err.status = 403;
    throw err;
  }
}

async function assertConversationAccess(userId, conversationId) {
  await assertParticipant(userId, conversationId);

  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!isClienteRole(requester?.role)) return;

  const others = await prisma.conversationParticipant.findMany({
    where: { conversationId, userId: { not: userId } },
    include: { user: { select: { role: true } } },
  });

  if (others.some((p) => isClienteRole(p.user?.role))) {
    const err = new Error("CLIENT_TO_CLIENT_CHAT_FORBIDDEN");
    err.status = 403;
    throw err;
  }
}

function buildChatUserSearchWhere(requesterId, requesterRole, q) {
  const whereClause = { NOT: { id: requesterId } };

  if (isClienteRole(requesterRole)) {
    whereClause.role = { not: "cliente" };
  }

  if (q.length > 0) {
    whereClause.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  return whereClause;
}

async function findOrCreateDirectConversation(userId, otherUserId) {
  if (userId === otherUserId) {
    const err = new Error("INVALID_PARTICIPANT");
    err.status = 400;
    throw err;
  }

  await assertClientChatPolicy(userId, [otherUserId]);

  const existing = await prisma.conversation.findFirst({
    where: {
      type: "DIRECT",
      AND: [
        { participants: { some: { userId } } },
        { participants: { some: { userId: otherUserId } } },
      ],
    },
    include: {
      participants: { include: { user: { select: USER_PUBLIC_SELECT } } },
    },
  });

  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      type: "DIRECT",
      participants: {
        create: [{ userId }, { userId: otherUserId }],
      },
    },
    include: {
      participants: { include: { user: { select: USER_PUBLIC_SELECT } } },
    },
  });
}

async function listConversationsForUser(userId) {
  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  const rows = await prisma.conversationParticipant.findMany({
    where: { userId },
    include: {
      conversation: {
        include: {
          participants: { include: { user: { select: USER_PUBLIC_SELECT } } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              sender: { select: USER_PUBLIC_SELECT },
              mentions: { include: { mentionedUser: { select: USER_PUBLIC_SELECT } } },
              attachments: true,
            },
          },
        },
      },
    },
    orderBy: { conversation: { updatedAt: "desc" } },
  });

  const items = await Promise.all(
    rows.map(async (row) => {
      const conv = row.conversation;
      const lastMessage = conv.messages[0] || null;
      const unreadCount = await prisma.message.count({
        where: {
          conversationId: conv.id,
          senderId: { not: userId },
          NOT: { reads: { some: { userId } } },
        },
      });

      const others = conv.participants
        .filter((p) => p.userId !== userId)
        .map((p) => serializeUser(p.user));

      return {
        id: conv.id,
        type: conv.type,
        title: conv.title || others.map((o) => o.name || o.email).join(", ") || "Conversa",
        updatedAt: conv.updatedAt,
        participants: conv.participants.map((p) => serializeUser(p.user)),
        lastMessage: lastMessage ? serializeMessage(lastMessage) : null,
        unreadCount,
      };
    })
  );

  if (isClienteRole(requester?.role)) {
    return items.filter((conv) => {
      const others = (conv.participants || []).filter((p) => p.id !== userId);
      return !others.some((p) => isClienteRole(p.role));
    });
  }

  return items;
}

async function getMessages(conversationId, userId, { cursor, limit = 50 } = {}) {
  await assertConversationAccess(userId, conversationId);

  const messages = await prisma.message.findMany({
    where: { conversationId },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(limit) || 50, 100),
    include: {
      sender: { select: USER_PUBLIC_SELECT },
      mentions: { include: { mentionedUser: { select: USER_PUBLIC_SELECT } } },
      reads: { where: { userId }, select: { readAt: true } },
      attachments: true,
    },
  });

  return {
    items: messages.reverse().map(serializeMessage),
    nextCursor: messages.length ? messages[0].id : null,
  };
}

function parseMentionIds(body, mentionIds = []) {
  const ids = new Set(Array.isArray(mentionIds) ? mentionIds.filter(Boolean) : []);
  const regex = /@\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    ids.add(match[2]);
  }
  return [...ids];
}

async function sendMessage({ conversationId, senderId, body, mentionIds = [], attachments = [] }) {
  await assertConversationAccess(senderId, conversationId);

  const trimmed = String(body || "").trim();
  if (!trimmed && !attachments.length) {
    const err = new Error("EMPTY_MESSAGE");
    err.status = 400;
    throw err;
  }
  if (trimmed.length > 4000) {
    const err = new Error("MESSAGE_TOO_LONG");
    err.status = 400;
    throw err;
  }

  const parsedMentionIds = parseMentionIds(trimmed, mentionIds);

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        senderId,
        body: trimmed,
        status: "SENT",
        ...(parsedMentionIds.length
          ? {
              mentions: {
                create: parsedMentionIds.map((mentionedUserId) => ({ mentionedUserId })),
              },
            }
          : {}),
        ...(attachments.length
          ? {
              attachments: {
                create: attachments.map(a => ({
                  fileName: a.fileName,
                  mimeType: a.mimeType,
                  size: a.size,
                  path: a.path
                })),
              }
            }
          : {}),
      },
      include: {
        sender: { select: USER_PUBLIC_SELECT },
        mentions: { include: { mentionedUser: { select: USER_PUBLIC_SELECT } } },
        attachments: true,
      },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return created;
  });

  return serializeMessage(message);
}

async function markConversationRead(conversationId, userId) {
  await assertConversationAccess(userId, conversationId);

  const unread = await prisma.message.findMany({
    where: {
      conversationId,
      senderId: { not: userId },
      NOT: { reads: { some: { userId } } },
    },
    select: { id: true },
  });

  if (!unread.length) {
    return { marked: 0 };
  }

  await prisma.$transaction([
    prisma.messageRead.createMany({
      data: unread.map((m) => ({ messageId: m.id, userId })),
      skipDuplicates: true,
    }),
    prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    }),
    prisma.message.updateMany({
      where: { id: { in: unread.map((m) => m.id) } },
      data: { status: "READ" },
    }),
  ]);

  return { marked: unread.length, messageIds: unread.map((m) => m.id), conversationId };
}

async function markMessageRead(messageId, userId) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, senderId: true },
  });
  if (!message) {
    const err = new Error("NOT_FOUND");
    err.status = 404;
    throw err;
  }

  await assertConversationAccess(userId, message.conversationId);

  if (message.senderId === userId) {
    return { marked: 0, messageIds: [], conversationId: message.conversationId };
  }

  await prisma.$transaction([
    prisma.messageRead.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId },
      update: { readAt: new Date() },
    }),
    prisma.message.update({
      where: { id: messageId },
      data: { status: "READ" },
    }),
    prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: message.conversationId, userId } },
      data: { lastReadAt: new Date() },
    }),
  ]);

  return { marked: 1, messageIds: [message.id], conversationId: message.conversationId };
}

function emitMessagesRead(io, { conversationId, messageIds, userId }) {
  if (!io || !conversationId || !messageIds?.length) return;
  for (const id of messageIds) {
    io.to(`conversation:${conversationId}`).emit("message:status", {
      messageId: id,
      conversationId,
      userId,
      status: "READ",
    });
  }
}

module.exports = {
  USER_PUBLIC_SELECT,
  serializeUser,
  serializeMessage,
  assertParticipant,
  assertConversationAccess,
  assertClientChatPolicy,
  buildChatUserSearchWhere,
  isClienteRole,
  findOrCreateDirectConversation,
  listConversationsForUser,
  getMessages,
  sendMessage,
  markConversationRead,
  markMessageRead,
  emitMessagesRead,
  parseMentionIds,
};
