const express = require("express");
const { authRequired } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { pendingApprovals } = require("../services/approvals/service");

/**
 * Aprovações pendentes (Fase 4). Só leitura: a decisão é feita nas rotas de
 * cada módulo, com as regras e a auditoria de sempre.
 */
const approvalRoutes = express.Router();
approvalRoutes.use(authRequired);

approvalRoutes.get(
  "/pending",
  asyncHandler(async (req, res) => {
    if (String(req.user?.role || "").toLowerCase() === "cliente") {
      return res.json({ items: [], counts: {}, total: 0 });
    }
    return res.json(await pendingApprovals(req.user));
  })
);

module.exports = { approvalRoutes };
