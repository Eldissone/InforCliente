const express = require("express");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermissionOrLegacyRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { isClienteRole } = require("../services/scopeService");
const { uploadToSupabase } = require("../utils/storage");
const { createLog } = require("../services/logService");
const {
  notifyAdminsNewHelpTicket,
  notifyAuthorHelpTicketUpdate,
} = require("../services/helpTicketNotificationService");

const STAFF_ROLES = ["admin", "operador", "financeiro", "tecnico", "supervisor", "leitura"];
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const AUTHOR_SELECT = { id: true, name: true, email: true, role: true, profilePic: true };

const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
    const err = new Error("INVALID_IMAGE_TYPE");
    err.status = 400;
    return cb(err);
  },
});

const createBodySchema = z.object({
  type: z.enum(["MELHORIA", "DUVIDA"]),
  message: z.string().trim().min(1).max(5000),
  pageUrl: z.string().trim().min(1).max(2000),
  pageTitle: z.string().trim().max(500).optional().or(z.literal("")),
});

const patchBodySchema = z.object({
  status: z.enum(["ABERTO", "EM_ANALISE", "RESOLVIDO"]).optional(),
  adminReply: z.string().trim().max(5000).optional(),
});

const helpTicketRoutes = express.Router();
helpTicketRoutes.use(authRequired);

function handleScreenshotUpload(req, res, next) {
  screenshotUpload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "A captura não pode exceder 5 MB." });
    }
    if (err.message === "INVALID_IMAGE_TYPE") {
      return res.status(400).json({ error: "Apenas imagens PNG, JPEG, WebP ou GIF." });
    }
    return next(err);
  });
}

function forbidCliente(req, res, next) {
  if (isClienteRole(req)) return res.status(403).json({ error: "FORBIDDEN" });
  return next();
}

helpTicketRoutes.use(forbidCliente);

function serializeTicket(ticket) {
  if (!ticket) return null;
  return {
    id: ticket.id,
    type: ticket.type,
    status: ticket.status,
    message: ticket.message,
    pageUrl: ticket.pageUrl,
    pageTitle: ticket.pageTitle || null,
    screenshotUrl: ticket.screenshotUrl || null,
    adminReply: ticket.adminReply || null,
    createdById: ticket.createdById,
    createdBy: ticket.createdBy || null,
    resolvedAt: ticket.resolvedAt || null,
    resolvedById: ticket.resolvedById || null,
    resolvedBy: ticket.resolvedBy || null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

async function logHelpAction(req, { action, helpTicketId, details }) {
  const u = req.user || {};
  await createLog({
    userId: u.sub || u.id || null,
    userName: u.name || null,
    userEmail: u.email || null,
    action,
    module: "ajuda",
    status: "success",
    ipAddress: req.ip || null,
    userAgent: String(req.headers["user-agent"] || ""),
    details: { helpTicketId, ...(details || null) },
  });
}

function isAdminRole(req) {
  return String(req.user?.role || "").toLowerCase() === "admin";
}

async function uploadScreenshot(ticketId, file) {
  if (!file) return null;
  const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
  const safeExt = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext) ? ext : ".png";
  const hash = crypto.randomBytes(8).toString("hex");
  const storagePath = `help/${ticketId}/${Date.now()}_${hash}${safeExt}`;
  return uploadToSupabase(storagePath, file.buffer, file.mimetype);
}

helpTicketRoutes.post(
  "/",
  requirePermissionOrLegacyRole("ajuda", "create", STAFF_ROLES),
  handleScreenshotUpload,
  asyncHandler(async (req, res) => {
    const body = createBodySchema.parse({
      type: req.body?.type,
      message: req.body?.message,
      pageUrl: req.body?.pageUrl,
      pageTitle: req.body?.pageTitle,
    });

    const created = await prisma.helpTicket.create({
      data: {
        type: body.type,
        message: body.message,
        pageUrl: body.pageUrl,
        pageTitle: body.pageTitle || null,
        createdById: req.user.sub,
      },
      include: { createdBy: { select: AUTHOR_SELECT } },
    });

    let ticket = created;
    if (req.file) {
      const screenshotUrl = await uploadScreenshot(created.id, req.file);
      ticket = await prisma.helpTicket.update({
        where: { id: created.id },
        data: { screenshotUrl },
        include: { createdBy: { select: AUTHOR_SELECT } },
      });
    }

    await logHelpAction(req, {
      action: "HELP_TICKET_CREATE",
      helpTicketId: ticket.id,
      details: { type: ticket.type, pageUrl: ticket.pageUrl },
    });

    notifyAdminsNewHelpTicket(req.app.get("io"), ticket, req.user).catch((err) => {
      console.error("[ajuda] falha a notificar admins:", err);
    });

    return res.status(201).json(serializeTicket(ticket));
  })
);

helpTicketRoutes.get(
  "/mine",
  requirePermissionOrLegacyRole("ajuda", "create", STAFF_ROLES),
  asyncHandler(async (req, res) => {
    const items = await prisma.helpTicket.findMany({
      where: { createdById: req.user.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        createdBy: { select: AUTHOR_SELECT },
        resolvedBy: { select: AUTHOR_SELECT },
      },
    });
    return res.json({ items: items.map(serializeTicket) });
  })
);

helpTicketRoutes.get(
  "/",
  requirePermissionOrLegacyRole("ajuda", "view", ["admin"]),
  asyncHandler(async (req, res) => {
    const type = ["MELHORIA", "DUVIDA"].includes(String(req.query.type || ""))
      ? String(req.query.type)
      : undefined;
    const status = ["ABERTO", "EM_ANALISE", "RESOLVIDO"].includes(String(req.query.status || ""))
      ? String(req.query.status)
      : undefined;
    const search = String(req.query.search || "").trim();
    const take = Math.min(100, Math.max(1, Number(req.query.take) || 50));
    const skip = Math.max(0, Number(req.query.skip) || 0);

    const where = {
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { message: { contains: search, mode: "insensitive" } },
              { pageTitle: { contains: search, mode: "insensitive" } },
              { pageUrl: { contains: search, mode: "insensitive" } },
              { createdBy: { name: { contains: search, mode: "insensitive" } } },
              { createdBy: { email: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [total, openCount, items] = await Promise.all([
      prisma.helpTicket.count({ where }),
      prisma.helpTicket.count({ where: { status: { in: ["ABERTO", "EM_ANALISE"] } } }),
      prisma.helpTicket.findMany({
        where,
        skip,
        take,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        include: {
          createdBy: { select: AUTHOR_SELECT },
          resolvedBy: { select: AUTHOR_SELECT },
        },
      }),
    ]);

    return res.json({
      total,
      openCount,
      items: items.map(serializeTicket),
    });
  })
);

helpTicketRoutes.get(
  "/:id",
  requirePermissionOrLegacyRole("ajuda", "create", STAFF_ROLES),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    const ticket = await prisma.helpTicket.findUnique({
      where: { id },
      include: {
        createdBy: { select: AUTHOR_SELECT },
        resolvedBy: { select: AUTHOR_SELECT },
      },
    });
    if (!ticket) return res.status(404).json({ error: "NOT_FOUND" });

    const isAuthor = ticket.createdById === req.user.sub;
    if (!isAdminRole(req) && !isAuthor) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    return res.json(serializeTicket(ticket));
  })
);

helpTicketRoutes.patch(
  "/:id",
  requirePermissionOrLegacyRole("ajuda", "reply", ["admin"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    const body = patchBodySchema.parse(req.body || {});
    if (!body.status && body.adminReply === undefined) {
      return res.status(400).json({ error: "NO_CHANGES" });
    }

    const existing = await prisma.helpTicket.findUnique({
      where: { id },
      include: { createdBy: { select: AUTHOR_SELECT } },
    });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

    const data = {};
    if (body.adminReply !== undefined) data.adminReply = body.adminReply || null;

    let nextStatus = body.status;
    if (!nextStatus && body.adminReply && existing.status === "ABERTO") {
      nextStatus = "EM_ANALISE";
    }
    if (nextStatus) data.status = nextStatus;

    if (nextStatus === "RESOLVIDO" && existing.status !== "RESOLVIDO") {
      data.resolvedAt = new Date();
      data.resolvedById = req.user.sub;
    }
    if (nextStatus && nextStatus !== "RESOLVIDO" && existing.status === "RESOLVIDO") {
      data.resolvedAt = null;
      data.resolvedById = null;
    }

    const ticket = await prisma.helpTicket.update({
      where: { id },
      data,
      include: {
        createdBy: { select: AUTHOR_SELECT },
        resolvedBy: { select: AUTHOR_SELECT },
      },
    });

    await logHelpAction(req, {
      action: "HELP_TICKET_UPDATE",
      helpTicketId: ticket.id,
      details: { status: ticket.status, replied: body.adminReply !== undefined },
    });

    const replied = body.adminReply !== undefined && body.adminReply !== (existing.adminReply || "");
    const resolved = nextStatus === "RESOLVIDO" && existing.status !== "RESOLVIDO";
    notifyAuthorHelpTicketUpdate(req.app.get("io"), ticket, { replied, resolved }).catch((err) => {
      console.error("[ajuda] falha a notificar autor:", err);
    });

    return res.json(serializeTicket(ticket));
  })
);

module.exports = { helpTicketRoutes };
