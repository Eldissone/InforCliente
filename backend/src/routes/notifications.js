const express = require("express");
const { authRequired } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const {
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
} = require("../services/notificationService");

const notificationRoutes = express.Router();
notificationRoutes.use(authRequired);

notificationRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const unreadOnly = req.query.unreadOnly === "true";
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const items = await listNotifications(req.user.sub, { unreadOnly, limit });
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

module.exports = { notificationRoutes };
