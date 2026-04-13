const express = require("express");
const { z } = require("zod");
const { PrismaClient } = require("@prisma/client");
const { asyncHandler } = require("../utils/http");
const { authRequired, requireRole } = require("../middlewares/auth");

const prisma = new PrismaClient();
const stockRoutes = express.Router();

// Todas as rotas de stock exigem autenticação
stockRoutes.use(authRequired);

// Helper para verificar se o projeto existe e é acessível
async function ensureProject(projectId) {
  const p = await prisma.project.findUnique({ where: { id: projectId } });
  if (!p) throw new Error("PROJECT_NOT_FOUND");
  return p;
}

// GET — Saldo consolidado de stock da obra
stockRoutes.get(
  "/:id/summary",
  requireRole(["admin", "operador", "leitura", "cliente"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    await ensureProject(projectId);

    const stock = await prisma.projectStock.findMany({
      where: { projectId },
      include: { material: true },
    });

    return res.json({ items: stock });
  })
);

// GET — Histórico de movimentações (com filtros)
stockRoutes.get(
  "/:id/movements",
  requireRole(["admin", "operador", "leitura", "cliente"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const { auditStatus, type, category } = req.query;

    const movements = await prisma.stockMovement.findMany({
      where: {
        projectId,
        ...(auditStatus && { auditStatus }),
        ...(type && { type }),
        ...(category && { material: { category } }),
      },
      include: {
        material: true,
        auditLogs: { orderBy: { createdAt: "desc" } },
        photos: true,
      },
      orderBy: { dateEntry: "desc" },
    });

    return res.json({ items: movements });
  })
);

// POST — Criar lançamento de stock (Técnico/Operador)
stockRoutes.post(
  "/:id/movements",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const body = z.object({
      materialId: z.string(),
      type: z.enum(["ENTRADA", "SAIDA", "TRANSFERENCIA", "AJUSTE"]),
      quantity: z.number().optional(), // Legado
      quantityGood: z.number().default(0),
      quantityDamaged: z.number().default(0),
      condition: z.enum(["BOA", "DANIFICADA"]).default("BOA"), // Legado
      entryType: z.string().optional(),
      driverName: z.string().optional(),
      vehiclePlate: z.string().optional(),
      vehicleBrand: z.string().optional(),
      dateEntry: z.string().datetime().optional(),
      movementStatus: z.enum(["EM_TRANSITO", "RECEBIDO", "APLICADO"]).default("RECEBIDO"),
      technicianName: z.string().optional(),
      batch: z.string().optional(),
      notes: z.string().optional(),
    }).parse(req.body);

    const { movement, projectStock } = await prisma.$transaction(async (tx) => {
      const move = await tx.stockMovement.create({
        data: {
          ...body,
          quantityGood: body.quantityGood,
          quantityDamaged: body.quantityDamaged,
          quantity: body.quantityGood + body.quantityDamaged, 
          projectId,
          auditStatus: body.type === "AJUSTE" ? "APROVADO" : "PENDENTE",
          dateEntry: body.dateEntry ? new Date(body.dateEntry) : new Date(),
        },
        include: { material: true },
      });

      // AJUSTE: Atualiza ambos os saldos imediatamente
      if (body.type === "AJUSTE") {
        await tx.projectStock.upsert({
          where: { projectId_materialId: { projectId, materialId: body.materialId } },
          update: { 
            quantityGood: { increment: body.quantityGood },
            quantityDamaged: { increment: body.quantityDamaged }
          },
          create: { 
            projectId, 
            materialId: body.materialId, 
            quantityGood: body.quantityGood,
            quantityDamaged: body.quantityDamaged
          },
        });
      } else {
        // ENTRADA/SAIDA/TRANSF: Se houver danificadas, atualizar imediatamente (boa espera aprovação)
        if (body.quantityDamaged > 0) {
          const sign = body.type === "ENTRADA" ? 1 : -1;
          await tx.projectStock.upsert({
            where: { projectId_materialId: { projectId, materialId: body.materialId } },
            update: { quantityDamaged: { increment: body.quantityDamaged * sign } },
            create: { 
              projectId, 
              materialId: body.materialId, 
              quantityGood: 0,
              quantityDamaged: body.quantityDamaged * sign
            },
          });
        }
      }

      await tx.stockAuditLog.create({
        data: {
          movementId: move.id,
          fromStatus: "PENDENTE",
          toStatus: body.type === "AJUSTE" ? "APROVADO" : "PENDENTE",
          changedBy: req.user.email,
          notes: body.type === "AJUSTE" ? "Ajuste manual de stock realizado pelo administrador." : "Lançamento inicial registrado pelo técnico.",
        },
      });

      return { movement: move };
    });

    return res.status(201).json(movement);
  })
);

// PATCH — Aprovar/Rejeitar lançamento (Apenas ADMIN)
stockRoutes.patch(
  "/:id/movements/:moveId/audit",
  requireRole(["admin"]),
  asyncHandler(async (req, res) => {
    const { moveId } = req.params;
    const { status, notes } = z.object({
      status: z.enum(["VALIDACAO", "APROVADO", "REJEITADO"]),
      notes: z.string().optional(),
    }).parse(req.body);

    const oldMove = await prisma.stockMovement.findUnique({
      where: { id: moveId },
      include: { material: true },
    });

    if (!oldMove) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    if (oldMove.auditStatus === "APROVADO") return res.status(400).json({ error: "ALREADY_APPROVED" });

    const updated = await prisma.$transaction(async (tx) => {
      const move = await tx.stockMovement.update({
        where: { id: moveId },
        data: { auditStatus: status },
      });

      await tx.stockAuditLog.create({
        data: {
          movementId: moveId,
          fromStatus: oldMove.auditStatus,
          toStatus: status,
          changedBy: req.user.email,
          notes,
        },
      });

      // Se APROVADO: Atualizar apenas QUANTIDADE BOA (Danificada já foi feita no POST)
      if (status === "APROVADO") {
        const sign = move.type === "ENTRADA" ? 1 : -1;
        await tx.projectStock.upsert({
          where: {
            projectId_materialId: { projectId: move.projectId, materialId: move.materialId },
          },
          update: {
            quantityGood: { increment: Number(move.quantityGood || 0) * sign },
          },
          create: {
            projectId: move.projectId,
            materialId: move.materialId,
            quantityGood: Number(move.quantityGood || 0) * sign,
            quantityDamaged: 0,
          },
        });
      }

      // Se REJEITADO: Reverter QUANTIDADE DANIFICADA (que foi feita no POST)
      if (status === "REJEITADO" && Number(move.quantityDamaged) > 0) {
        const sign = move.type === "ENTRADA" ? -1 : 1; // Reversão: inverte o sinal original
        await tx.projectStock.update({
          where: {
            projectId_materialId: { projectId: move.projectId, materialId: move.materialId },
          },
          data: {
            quantityDamaged: { increment: Number(move.quantityDamaged) * sign },
          },
        });
      }

      return move;
    });

    return res.json(updated);
  })
);

// DELETE — Eliminar movimento e REVERTER SALDO (Apenas ADMIN)
stockRoutes.delete(
  "/:id/movements/:moveId",
  requireRole(["admin"]),
  asyncHandler(async (req, res) => {
    const { moveId } = req.params;

    const move = await prisma.stockMovement.findUnique({
      where: { id: moveId }
    });

    if (!move) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });

    await prisma.$transaction(async (tx) => {
      // Reverter impacto no saldo se estivesse aprovado ou se fosse ajuste/danificado
      // Regra: Revertemos tudo o que já "entrou" no saldo.
      const sign = (move.type === "ENTRADA" || move.type === "AJUSTE") ? -1 : 1;

      // Reverter Quantidade Boa (apenas se aprovada ou se for ajuste)
      if (move.auditStatus === "APROVADO" || move.type === "AJUSTE") {
        await tx.projectStock.update({
          where: { projectId_materialId: { projectId: move.projectId, materialId: move.materialId } },
          data: { quantityGood: { increment: Number(move.quantityGood || 0) * sign } }
        });
      }

      // Reverter Quantidade Danificada (sempre revertida pois entra no saldo no POST)
      await tx.projectStock.update({
        where: { projectId_materialId: { projectId: move.projectId, materialId: move.materialId } },
        data: { quantityDamaged: { increment: Number(move.quantityDamaged || 0) * sign } }
      });

      // Apagar o movimento (e fotos/logs por cascade se configurado, ou manualmente)
      await tx.stockMovement.delete({ where: { id: moveId } });
    });

    return res.json({ ok: true });
  })
);

// GET — Catálogo de Materiais
stockRoutes.get(
  "/materials",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const materials = await prisma.material.findMany({
      orderBy: { name: "asc" },
    });
    return res.json({ items: materials });
  })
);

// POST — Inicializar catálogo básico (Apenas para setup)
stockRoutes.post(
  "/init-catalog",
  requireRole(["admin"]),
  asyncHandler(async (req, res) => {
    const materials = [
      { code: "POSTE-MT-12M", name: "Poste de Betão 12M (MT)", category: "MT", unit: "un" },
      { code: "CABO-MT-50MM", name: "Cabo Alumínio 50mm2 (MT)", category: "MT", unit: "mts" },
      { code: "TRANSF-250KVA", name: "Transformador 250kVA", category: "MT", unit: "un" },
      { code: "CONEX-BT-ABC", name: "Conetor de Perfuração ABC", category: "BT", unit: "un" },
      { code: "LAMP-LED-150W", name: "Luminária LED 150W (IP)", category: "IP", unit: "un" },
      { code: "BRACO-IP-2M", name: "Braço Galvanizado 2M (IP)", category: "IP", unit: "un" },
    ];

    for (const m of materials) {
      await prisma.material.upsert({
        where: { code: m.code },
        update: {},
        create: m,
      });
    }

    return res.json({ ok: true, message: "Catálogo inicializado" });
  })
);

// Configuração Multer para fotos de campo
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { id } = req.params;
    const dir = `uploads/projects/${id}/stock`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// POST — Upload de Foto Georreferenciada
stockRoutes.post(
  "/:id/photos",
  requireRole(["admin", "operador"]),
  upload.single("file"), // apiUpload envia as "file"
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const { movementId, materialId, lat, lng } = req.body;

    if (!req.file) throw new Error("FILE_REQUIRED");

    const photo = await prisma.projectPhoto.create({
      data: {
        projectId,
        movementId: movementId || null,
        materialId: materialId || null,
        path: req.file.path.replace(/\\/g, "/"),
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
        condition: req.body.condition || null,
        takenAt: new Date(),
      },
    });

    return res.status(201).json(photo);
  })
);

module.exports = { stockRoutes };
