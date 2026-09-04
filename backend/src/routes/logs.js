const express = require("express");
const { getLogs } = require("../services/logService");
const { authRequired, requirePermissionOrLegacyRole } = require("../middlewares/auth");
const router = express.Router();

router.use(authRequired);

router.get(
  "/",
  requirePermissionOrLegacyRole("sistema", "view", ["admin"]),
  async (req, res, next) => {
    try {
      const { skip, take, search, userId, action, module, status, startDate, endDate } = req.query;

      const result = await getLogs({
        skip: skip ? parseInt(skip) : 0,
        take: take ? parseInt(take) : 50,
        filters: {
          search,
          userId,
          action,
          module,
          status,
          startDate,
          endDate
        }
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/",
  requirePermissionOrLegacyRole("sistema", "delete", ["admin"]),
  async (req, res, next) => {
    try {
      const { clearAllLogs } = require("../services/logService");
      await clearAllLogs();
      res.json({ success: true, message: "Logs cleared successfully" });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = { logRoutes: router };
