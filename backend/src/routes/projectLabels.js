/**
 * O código interno de cada obra (OBR-XXXXXXXX-XXXX) e a sua referência
 * (contrato, ex.: INF/MBT03/2026). Os ecrãs mostram a referência no lugar do
 * código (`frontend/src/shared/obraRef.js`). Só o par código → referência:
 * sem nomes nem valores.
 */
const express = require("express");
const { prisma } = require("../db");
const { authRequired } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const projectLabelRoutes = express.Router();
projectLabelRoutes.use(authRequired);

projectLabelRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.project.findMany({ select: { code: true, referencia: true } });
    res.json({ items: rows.filter((p) => p.code).map((p) => ({ code: p.code, ref: p.referencia ? String(p.referencia).trim() : null })) });
  })
);

module.exports = { projectLabelRoutes };
