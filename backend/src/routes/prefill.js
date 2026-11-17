const express = require("express");
const { z } = require("zod");
const { authRequired } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { purchasePrefill } = require("../services/prefill/service");
const { userAccess } = require("../services/ai/assistant/access");

/** Pré-preenchimento de formulários a partir do histórico (Fase 4). Só leitura. */
const prefillRoutes = express.Router();
prefillRoutes.use(authRequired);

prefillRoutes.get(
  "/purchase",
  asyncHandler(async (req, res) => {
    if (String(req.user?.role || "").toLowerCase() === "cliente") return res.json({ suggestion: null });
    const q = z
      .object({
        description: z.string().trim().min(3).max(300),
        projectId: z.string().max(64).optional(),
      })
      .parse(req.query || {});
    const access = await userAccess(req.user.sub);
    const projectId = q.projectId && access.projectIds.includes(q.projectId) ? q.projectId : null;
    return res.json(await purchasePrefill({ description: q.description, projectId, projectIds: access.projectIds }));
  })
);

module.exports = { prefillRoutes };
