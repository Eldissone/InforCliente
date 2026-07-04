const express = require("express");
const { z } = require("zod");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { prisma } = require("../db");
const {
  findOrCreateDirectConversation,
  listConversationsForUser,
  getMessages,
  sendMessage,
  markConversationRead,
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

    return res.status(201).json({ message });
  })
);

conversationRoutes.patch(
  "/:id/read",
  requirePermission("chat", "view"),
  asyncHandler(async (req, res) => {
    const conversationId = String(req.params.id);
    const result = await markConversationRead(conversationId, req.user.sub);
    return res.json(result);
  })
);

module.exports = { conversationRoutes };
