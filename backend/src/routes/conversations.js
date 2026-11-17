const express = require("express");
const { z } = require("zod");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const { prisma } = require("../db");
const { uploadToSupabase } = require("../utils/storage");
const { notifyChatMessage } = require("../services/chatNotificationService");
const { handleAiMention } = require("../services/ai/assistant/chatMention");
const {
  findOrCreateDirectConversation,
  listConversationsForUser,
  getMessages,
  sendMessage,
  markConversationRead,
  emitMessagesRead,
  assertClientChatPolicy,
  assertConversationAccess,
  parseMentionIds,
  serializeUser,
  USER_PUBLIC_SELECT,
} = require("../services/chatService");

const conversationRoutes = express.Router();
conversationRoutes.use(authRequired);

conversationRoutes.get(
  "/",
  requirePermission("chat", "view"),
  asyncHandler(async (req, res) => {
    const items = await listConversationsForUser(req.user.sub);
    return res.json({ items });
  })
);

conversationRoutes.post(
  "/",
  requirePermission("chat", "send"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        participantIds: z.array(z.string()).min(1),
        title: z.string().optional().nullable(),
        type: z.enum(["DIRECT", "GROUP"]).optional(),
      })
      .parse(req.body);

    const uniqueIds = [...new Set(body.participantIds.filter((id) => id !== req.user.sub))];
    if (!uniqueIds.length) {
      return res.status(400).json({ error: "PARTICIPANTS_REQUIRED" });
    }

    await assertClientChatPolicy(req.user.sub, uniqueIds);

    if ((body.type || "DIRECT") === "DIRECT" && uniqueIds.length === 1) {
      const conversation = await findOrCreateDirectConversation(req.user.sub, uniqueIds[0]);
      return res.status(201).json({
        conversation: {
          id: conversation.id,
          type: conversation.type,
          title: conversation.title,
          participants: conversation.participants.map((p) => serializeUser(p.user)),
        },
      });
    }

    const conversation = await prisma.conversation.create({
      data: {
        type: "GROUP",
        title: body.title || null,
        participants: {
          create: [{ userId: req.user.sub }, ...uniqueIds.map((userId) => ({ userId }))],
        },
      },
      include: {
        participants: { include: { user: { select: USER_PUBLIC_SELECT } } },
      },
    });

    return res.status(201).json({
      conversation: {
        id: conversation.id,
        type: conversation.type,
        title: conversation.title,
        participants: conversation.participants.map((p) => serializeUser(p.user)),
      },
    });
  })
);

conversationRoutes.get(
  "/:id/messages",
  requirePermission("chat", "view"),
  asyncHandler(async (req, res) => {
    const conversationId = String(req.params.id);
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const data = await getMessages(conversationId, req.user.sub, { cursor, limit });
    return res.json(data);
  })
);

conversationRoutes.post(
  "/:id/messages",
  requirePermission("chat", "send"),
  asyncHandler(async (req, res) => {
    const conversationId = String(req.params.id);
    const body = z
      .object({
        body: z.string().min(1).max(4000),
        mentionIds: z.array(z.string()).optional(),
      })
      .parse(req.body);

    const message = await sendMessage({
      conversationId,
      senderId: req.user.sub,
      body: body.body,
      mentionIds: body.mentionIds,
    });

    // Mesmo comportamento do envio por socket: tempo real + notificações.
    const io = req.app.get("io");
    io?.to(`conversation:${conversationId}`).emit("message:new", message);
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    await notifyChatMessage({
      io,
      conversationId,
      message,
      senderId: req.user.sub,
      senderName: req.user.name || (req.user.email ? req.user.email.split("@")[0] : null),
      recipientIds: participants.map((p) => p.userId),
      mentionIds: parseMentionIds(body.body, body.mentionIds),
    });
    handleAiMention({ io, conversationId, askerId: req.user.sub, message }).catch((err) =>
      console.error("[ai] @IA:", err.message)
    );

    return res.status(201).json({ message });
  })
);

conversationRoutes.patch(
  "/:id/read",
  requirePermission("chat", "view"),
  asyncHandler(async (req, res) => {
    const conversationId = String(req.params.id);
    const result = await markConversationRead(conversationId, req.user.sub);
    emitMessagesRead(req.app.get("io"), {
      conversationId,
      messageIds: result.messageIds || [],
      userId: req.user.sub,
    });
    // Ler a conversa também dá como lidas as notificações dela (sino).
    await prisma.notification.updateMany({
      where: {
        userId: req.user.sub,
        read: false,
        type: { in: ["NEW_MESSAGE", "MENTION"] },
        metadata: { path: ["conversationId"], equals: conversationId },
      },
      data: { read: true },
    });
    return res.json(result);
  })
);
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

conversationRoutes.post(
  "/:id/attachments",
  requirePermission("chat", "send"),
  attachmentUpload.single("file"),
  asyncHandler(async (req, res) => {
    const conversationId = String(req.params.id);
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

    await assertConversationAccess(req.user.sub, conversationId);

    const ext = path.extname(req.file.originalname).toLowerCase();
    const hash = crypto.randomBytes(8).toString("hex");
    const storagePath = `chat/${conversationId}/${Date.now()}_${hash}${ext}`;

    const uploadedUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    return res.status(201).json({
      fileName: req.file.originalname || "attachment",
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: storagePath,
      url: uploadedUrl
    });
  })
);

module.exports = { conversationRoutes };
