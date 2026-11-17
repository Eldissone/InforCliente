const express = require("express");
const { z } = require("zod");
const { authRequired } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const {
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
  getPreferences,
  updatePreferences,
} = require("../services/notificationService");

const NOTIFICATION_TYPES = [
  "NEW_MESSAGE",
  "MENTION",
  "REQUEST",
  "APPROVAL",
  "SYSTEM",
  "PAYMENT",
  "DAILY_PLAN",
  "STOCK",
  "DEADLINE",
  "AI_INSIGHT",
];

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM");

const preferencesSchema = z
  .object({
    soundEnabled: z.boolean(),
    volume: z.number().min(0).max(1),
    desktopEnabled: z.boolean(),
    dndEnabled: z.boolean(),
    dndFrom: timeOfDay,
    dndTo: timeOfDay,
    mutedTypes: z.array(z.enum(NOTIFICATION_TYPES)).max(NOTIFICATION_TYPES.length),
    mutedProjectIds: z.array(z.string().min(1).max(64)).max(500),
  })
  .partial()
  .strict();

const notificationRoutes = express.Router();
notificationRoutes.use(authRequired);

notificationRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const unreadOnly = req.query.unreadOnly === "true";
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const types = String(req.query.types || "")
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter((t) => NOTIFICATION_TYPES.includes(t));
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
    const items = await listNotifications(req.user.sub, { unreadOnly, limit, types, projectId });
    const unreadCount = await countUnread(req.user.sub);
    return res.json({ items, unreadCount });
  })
);

notificationRoutes.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const unreadCount = await countUnread(req.user.sub);
    return res.json({ unreadCount });
  })
);

notificationRoutes.get(
  "/preferences",
  asyncHandler(async (req, res) => {
    return res.json({ preferences: await getPreferences(req.user.sub) });
  })
);

notificationRoutes.put(
  "/preferences",
  asyncHandler(async (req, res) => {
    const data = preferencesSchema.parse(req.body || {});
    if (data.mutedTypes) data.mutedTypes = [...new Set(data.mutedTypes)];
    if (data.mutedProjectIds) data.mutedProjectIds = [...new Set(data.mutedProjectIds)];
    return res.json({ preferences: await updatePreferences(req.user.sub, data) });
  })
);

notificationRoutes.patch(
  "/read-all",
  asyncHandler(async (req, res) => {
    const result = await markAllRead(req.user.sub);
    return res.json(result);
  })
);

notificationRoutes.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const notification = await markRead(String(req.params.id), req.user.sub);
    return res.json({ notification });
  })
);

module.exports = { notificationRoutes, NOTIFICATION_TYPES };
