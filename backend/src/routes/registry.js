/**
 * Cadastros persistentes — contactos, setores e pessoal (Fase 1, D-002/D-012).
 *
 * Substitui os registos que viviam em localStorage no Frontend. Contrato em
 * docs/agents/CONTRACTS.md ("Cadastros persistentes"). Os três recursos partilham
 * a mesma forma de API; as diferenças (campos, filtros, validações) estão nas
 * definições abaixo.
 */
const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { createLog } = require("../services/logService");
const {
  MAX_PHOTO_BYTES,
  PHOTO_MIME_EXT,
  normalizeNameKey,
  cleanText,
  decodePhotoDataUrl,
  storeRegistryPhoto,
  extFromMime,
} = require("../services/registryImport");

const MODULE = "cadastros";
const MAX_IMPORT_ITEMS = 500;
const PROJECT_SELECT = { id: true, name: true, code: true };

// `undefined` tem de continuar `undefined` para o PATCH não anular campos omitidos.
const emptyToNull = (v) => (v === undefined ? undefined : v === null ? null : String(v).trim() || null);

const optionalText = (max = 200) => z.preprocess(emptyToNull, z.string().max(max).nullable().optional());

const optionalEmail = z.preprocess(emptyToNull, z.string().email().max(200).nullable().optional());

const legacyIdSchema = optionalText(120);

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (PHOTO_MIME_EXT[String(file.mimetype || "").toLowerCase()]) return cb(null, true);
    const err = new Error("INVALID_IMAGE_TYPE");
    err.code = "INVALID_IMAGE_TYPE";
    return cb(err);
  },
});

function handlePhotoUpload(req, res, next) {
  photoUpload.single("photo")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "IMAGE_TOO_LARGE" });
    if (err.code === "INVALID_IMAGE_TYPE") return res.status(400).json({ error: "INVALID_IMAGE_TYPE" });
    return next(err);
  });
}

async function logRegistry(req, action, details) {
  const u = req.user || {};
  await createLog({
    userId: u.sub || null,
    userName: u.name || null,
    userEmail: u.email || null,
    action,
    module: MODULE,
    status: "success",
    ipAddress: req.ip || null,
    userAgent: String(req.headers["user-agent"] || ""),
    details: details || null,
  });
}

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function activeWhere(query) {
  const raw = String(query.active ?? "true").toLowerCase();
  if (raw === "all") return {};
  if (raw === "false") return { active: false };
  return { active: true };
}

async function projectExists(projectId) {
  if (!projectId) return false;
  const found = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  return Boolean(found);
}

// ─── Definições por recurso ──────────────────────────────────────────────────

const contactDef = {
  resource: "CONTACTS",
  model: "contact",
  logPrefix: "CONTACT",
  photoDir: "contacts",
  hasPhoto: true,
  include: undefined,
  orderBy: [{ name: "asc" }],
  createSchema: z.object({
    name: z.string().trim().min(2).max(200),
    role: z.string().trim().min(2).max(200),
    phone: optionalText(60),
    email: optionalEmail,
    legacyId: legacyIdSchema,
  }),
  patchSchema: z.object({
    name: z.string().trim().min(2).max(200).optional(),
    role: z.string().trim().min(2).max(200).optional(),
    phone: optionalText(60),
    email: optionalEmail,
    active: z.boolean().optional(),
  }),
  searchWhere(q) {
    return {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { role: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ],
    };
  },
  extraWhere() {
    return {};
  },
  async toCreateData(body) {
    return { data: { ...body }, warnings: [] };
  },
  async toPatchData(body) {
    return { data: { ...body } };
  },
  /** Registo local do browser → payload da API. */
  fromLegacy(item) {
    return {
      body: {
        name: cleanText(item.nome ?? item.name, { max: 200 }) || "",
        role: cleanText(item.funcao ?? item.role, { max: 200 }) || "",
        phone: cleanText(item.telefone ?? item.phone, { max: 60 }),
        email: cleanText(item.email, { max: 200 }),
        legacyId: cleanText(item.id ?? item.legacyId, { max: 120 }),
      },
      photoDataUrl: item.foto || item.photoDataUrl || null,
    };
  },
  serialize(row) {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      phone: row.phone,
      email: row.email,
      photoUrl: row.photoUrl,
      active: row.active,
      legacyId: row.legacyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
};

const sectorDef = {
  resource: "SECTORS",
  model: "sector",
  logPrefix: "SECTOR",
  hasPhoto: false,
  include: undefined,
  orderBy: [{ name: "asc" }],
  createSchema: z.object({
    name: z.string().trim().min(2).max(120),
    legacyId: legacyIdSchema,
  }),
  patchSchema: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    active: z.boolean().optional(),
  }),
  searchWhere(q) {
    return { name: { contains: q, mode: "insensitive" } };
  },
  extraWhere() {
    return {};
  },
  async toCreateData(body) {
    const nameKey = normalizeNameKey(body.name);
    const existing = await prisma.sector.findUnique({ where: { nameKey } });
    if (existing) {
      const err = new Error("SECTOR_ALREADY_EXISTS");
      err.status = 409;
      err.payload = { error: "SECTOR_ALREADY_EXISTS", existing: sectorDef.serialize(existing) };
      throw err;
    }
    return { data: { ...body, nameKey }, warnings: [] };
  },
  async toPatchData(body, { id }) {
    const data = { ...body };
    if (body.name !== undefined) {
      const nameKey = normalizeNameKey(body.name);
      const existing = await prisma.sector.findUnique({ where: { nameKey } });
      if (existing && existing.id !== id) {
        const err = new Error("SECTOR_ALREADY_EXISTS");
        err.status = 409;
        err.payload = { error: "SECTOR_ALREADY_EXISTS", existing: sectorDef.serialize(existing) };
        throw err;
      }
      data.nameKey = nameKey;
    }
    return { data };
  },
  fromLegacy(item) {
    return {
      body: {
        name: cleanText(item.nome ?? item.name, { max: 120 }) || "",
        legacyId: cleanText(item.id ?? item.legacyId, { max: 120 }),
      },
      photoDataUrl: null,
    };
  },
  serialize(row) {
    return {
      id: row.id,
      name: row.name,
      active: row.active,
      legacyId: row.legacyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
};

const PERSONNEL_TYPES = ["INTERNO", "SUBCONTRATADO"];
const LEGACY_PERSONNEL_TYPE = { interno: "INTERNO", subcontratado: "SUBCONTRATADO" };

const personnelDef = {
  resource: "PERSONNEL",
  model: "personnel",
  logPrefix: "PERSONNEL",
  photoDir: "personnel",
  hasPhoto: true,
  include: { project: { select: PROJECT_SELECT } },
  orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  createSchema: z.object({
    firstName: z.string().trim().min(2).max(120),
    lastName: optionalText(120),
    email: optionalEmail,
    phone: optionalText(60),
    type: z.preprocess((v) => (v === "" ? null : v), z.enum(PERSONNEL_TYPES).nullable().optional()),
    role: z.string().trim().min(2).max(200),
    projectId: optionalText(120),
    employeeCode: optionalText(60),
    category: optionalText(120),
    legacyId: legacyIdSchema,
  }),
  patchSchema: z.object({
    firstName: z.string().trim().min(2).max(120).optional(),
    lastName: optionalText(120),
    email: optionalEmail,
    phone: optionalText(60),
    type: z.preprocess((v) => (v === "" ? null : v), z.enum(PERSONNEL_TYPES).nullable().optional()),
    role: z.string().trim().min(2).max(200).optional(),
    projectId: optionalText(120),
    employeeCode: optionalText(60),
    category: optionalText(120),
    active: z.boolean().optional(),
  }),
  searchWhere(q) {
    return {
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { role: { contains: q, mode: "insensitive" } },
        { employeeCode: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { project: { name: { contains: q, mode: "insensitive" } } },
      ],
    };
  },
  extraWhere(query) {
    const where = {};
    const type = String(query.type || "").toUpperCase();
    if (PERSONNEL_TYPES.includes(type)) where.type = type;
    if (query.projectId) where.projectId = String(query.projectId);
    return where;
  },
  async toCreateData(body) {
    const data = { ...body };
    if (data.projectId && !(await projectExists(data.projectId))) {
      const err = new Error("PROJECT_NOT_FOUND");
      err.status = 400;
      err.payload = { error: "PROJECT_NOT_FOUND" };
      throw err;
    }
    return { data, warnings: [] };
  },
  async toPatchData(body) {
    const data = { ...body };
    if (data.projectId && !(await projectExists(data.projectId))) {
      const err = new Error("PROJECT_NOT_FOUND");
      err.status = 400;
      err.payload = { error: "PROJECT_NOT_FOUND" };
      throw err;
    }
    return { data };
  },
  fromLegacy(item) {
    const rawType = String(item.tipo ?? item.type ?? "").trim().toLowerCase();
    const type = LEGACY_PERSONNEL_TYPE[rawType] || (PERSONNEL_TYPES.includes(rawType.toUpperCase()) ? rawType.toUpperCase() : null);
    return {
      body: {
        firstName: cleanText(item.nome ?? item.firstName, { max: 120 }) || "",
        lastName: cleanText(item.apelido ?? item.lastName, { max: 120 }),
        email: cleanText(item.email, { max: 200 }),
        phone: cleanText(item.telefone ?? item.phone, { max: 60 }),
        type,
        role: cleanText(item.funcao ?? item.role, { max: 200 }) || "",
        projectId: cleanText(item.obraId ?? item.projectId, { max: 120 }),
        employeeCode: cleanText(item.idFuncionario ?? item.employeeCode, { max: 60 }),
        category: cleanText(item.categoria ?? item.category, { max: 120 }),
        legacyId: cleanText(item.id ?? item.legacyId, { max: 120 }),
      },
      photoDataUrl: item.foto || item.photoDataUrl || null,
    };
  },
  /** Na importação, obra inexistente não bloqueia: fica null e é reportada. */
  async relaxLegacy(body, warnings) {
    if (body.projectId && !(await projectExists(body.projectId))) {
      warnings.push(`Obra "${body.projectId}" não existe; registo importado sem obra alocada.`);
      return { ...body, projectId: null };
    }
    return body;
  },
  serialize(row) {
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      type: row.type,
      role: row.role,
      projectId: row.projectId,
      project: row.project ? { id: row.project.id, name: row.project.name, code: row.project.code } : null,
      employeeCode: row.employeeCode,
      category: row.category,
      photoUrl: row.photoUrl,
      active: row.active,
      legacyId: row.legacyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
};

// ─── Fábrica de router ───────────────────────────────────────────────────────

function sendKnownError(res, err) {
  if (err && err.payload && typeof err.status === "number") {
    res.status(err.status).json(err.payload);
    return true;
  }
  return false;
}

function createRegistryRouter(def) {
  const router = express.Router();
  const delegate = () => prisma[def.model];
  router.use(authRequired);

  const importBodySchema = z.object({
    sourceKey: z.string().trim().min(1).max(200),
    deviceLabel: optionalText(200),
    items: z.array(z.record(z.any())).min(1).max(MAX_IMPORT_ITEMS),
  });

  // Rotas fixas antes de /:id.

  router.get(
    "/",
    requirePermission(MODULE, "view"),
    asyncHandler(async (req, res) => {
      const { page, pageSize, skip, take } = parsePagination(req.query);
      const q = String(req.query.q || "").trim();
      const where = {
        ...activeWhere(req.query),
        ...def.extraWhere(req.query),
        ...(q ? def.searchWhere(q) : {}),
      };
      const [total, rows] = await Promise.all([
        delegate().count({ where }),
        delegate().findMany({ where, skip, take, orderBy: def.orderBy, include: def.include }),
      ]);
      res.json({ page, pageSize, total, items: rows.map(def.serialize) });
    })
  );

  router.post(
    "/",
    requirePermission(MODULE, "create"),
    asyncHandler(async (req, res) => {
      const body = def.createSchema.parse(req.body || {});
      let prepared;
      try {
        prepared = await def.toCreateData(body);
      } catch (err) {
        if (sendKnownError(res, err)) return;
        throw err;
      }
      if (prepared.data.legacyId) {
        const dup = await delegate().findUnique({ where: { legacyId: prepared.data.legacyId } });
        if (dup) {
          return res.status(409).json({ error: "LEGACY_ID_ALREADY_IMPORTED", existing: def.serialize(dup) });
        }
      }
      const created = await delegate().create({
        data: { ...prepared.data, createdById: req.user.sub },
        include: def.include,
      });
      await logRegistry(req, `${def.logPrefix}_CREATE`, { id: created.id });
      res.status(201).json(def.serialize(created));
    })
  );

  router.post(
    "/import",
    requirePermission(MODULE, "manage"),
    asyncHandler(async (req, res) => {
      const body = importBodySchema.parse(req.body || {});
      const batch = await prisma.registryImportBatch.create({
        data: {
          resource: def.resource,
          sourceKey: body.sourceKey,
          deviceLabel: body.deviceLabel || null,
          requested: body.items.length,
          created: 0,
          skipped: 0,
          failed: 0,
          createdById: req.user.sub,
        },
      });

      const result = { created: 0, skipped: 0, failed: 0, warnings: [], errors: [] };

      for (const item of body.items) {
        const { body: mapped, photoDataUrl } = def.fromLegacy(item || {});
        const legacyId = mapped.legacyId;
        if (!legacyId) {
          result.failed += 1;
          result.errors.push({ legacyId: null, message: "Registo local sem id; não é possível importar de forma idempotente." });
          continue;
        }

        const existing = await delegate().findUnique({ where: { legacyId } });
        if (existing) {
          result.skipped += 1;
          continue;
        }

        const parsed = def.createSchema.safeParse(mapped);
        if (!parsed.success) {
          result.failed += 1;
          result.errors.push({
            legacyId,
            message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          });
          continue;
        }

        const itemWarnings = [];
        let payload = parsed.data;
        if (def.relaxLegacy) payload = await def.relaxLegacy(payload, itemWarnings);

        let prepared;
        try {
          prepared = await def.toCreateData(payload);
        } catch (err) {
          if (err.payload?.error === "SECTOR_ALREADY_EXISTS") {
            result.skipped += 1;
            result.warnings.push({ legacyId, message: `Já existe um setor com o nome "${payload.name}"; registo local ignorado.` });
            continue;
          }
          result.failed += 1;
          result.errors.push({ legacyId, message: err.payload?.error || err.message || "Falha ao preparar registo." });
          continue;
        }

        let created;
        try {
          created = await delegate().create({
            data: { ...prepared.data, importBatchId: batch.id, createdById: req.user.sub },
          });
        } catch (err) {
          result.failed += 1;
          result.errors.push({ legacyId, message: err.code === "P2002" ? "Registo duplicado." : "Falha ao gravar registo." });
          continue;
        }
        result.created += 1;

        if (def.hasPhoto && photoDataUrl) {
          try {
            const { buffer, ext } = decodePhotoDataUrl(photoDataUrl);
            const photoUrl = await storeRegistryPhoto(def.photoDir, created.id, buffer, ext);
            await delegate().update({ where: { id: created.id }, data: { photoUrl } });
          } catch (err) {
            itemWarnings.push(
              err.code === "IMAGE_TOO_LARGE"
                ? "Foto excede 2 MB; registo importado sem foto."
                : "Foto inválida; registo importado sem foto."
            );
          }
        }
        for (const message of itemWarnings) result.warnings.push({ legacyId, message });
      }

      await prisma.registryImportBatch.update({
        where: { id: batch.id },
        data: {
          created: result.created,
          skipped: result.skipped,
          failed: result.failed,
          details: { warnings: result.warnings, errors: result.errors },
        },
      });
      await logRegistry(req, "REGISTRY_IMPORT", {
        batchId: batch.id,
        resource: def.resource,
        sourceKey: body.sourceKey,
        requested: body.items.length,
        ...result,
        warnings: result.warnings.length,
        errors: result.errors.length,
      });

      res.status(201).json({
        batchId: batch.id,
        requested: body.items.length,
        created: result.created,
        skipped: result.skipped,
        failed: result.failed,
        warnings: result.warnings,
        errors: result.errors,
      });
    })
  );

  router.get(
    "/import/:batchId",
    requirePermission(MODULE, "manage"),
    asyncHandler(async (req, res) => {
      const batch = await prisma.registryImportBatch.findFirst({
        where: { id: String(req.params.batchId), resource: def.resource },
      });
      if (!batch) return res.status(404).json({ error: "IMPORT_BATCH_NOT_FOUND" });
      res.json(batch);
    })
  );

  router.post(
    "/import/:batchId/rollback",
    requirePermission(MODULE, "manage"),
    asyncHandler(async (req, res) => {
      const batch = await prisma.registryImportBatch.findFirst({
        where: { id: String(req.params.batchId), resource: def.resource },
      });
      if (!batch) return res.status(404).json({ error: "IMPORT_BATCH_NOT_FOUND" });
      if (batch.rolledBackAt) return res.status(409).json({ error: "IMPORT_ALREADY_ROLLED_BACK" });

      const removed = await prisma.$transaction(async (tx) => {
        const deleted = await tx[def.model].deleteMany({ where: { importBatchId: batch.id } });
        await tx.registryImportBatch.update({
          where: { id: batch.id },
          data: { rolledBackAt: new Date() },
        });
        return deleted.count;
      });
      await logRegistry(req, "REGISTRY_IMPORT_ROLLBACK", { batchId: batch.id, resource: def.resource, removed });
      res.json({ ok: true, removed });
    })
  );

  router.get(
    "/:id",
    requirePermission(MODULE, "view"),
    asyncHandler(async (req, res) => {
      const row = await delegate().findUnique({ where: { id: String(req.params.id) }, include: def.include });
      if (!row) return res.status(404).json({ error: "NOT_FOUND" });
      res.json(def.serialize(row));
    })
  );

  router.patch(
    "/:id",
    requirePermission(MODULE, "edit"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const body = def.patchSchema.parse(req.body || {});
      const existing = await delegate().findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
      let prepared;
      try {
        prepared = await def.toPatchData(body, { id });
      } catch (err) {
        if (sendKnownError(res, err)) return;
        throw err;
      }
      const updated = await delegate().update({ where: { id }, data: prepared.data, include: def.include });
      await logRegistry(req, `${def.logPrefix}_UPDATE`, { id, fields: Object.keys(prepared.data) });
      res.json(def.serialize(updated));
    })
  );

  router.delete(
    "/:id",
    requirePermission(MODULE, "delete"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const existing = await delegate().findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
      await delegate().update({ where: { id }, data: { active: false } });
      await logRegistry(req, `${def.logPrefix}_ARCHIVE`, { id });
      res.json({ ok: true, archived: true });
    })
  );

  if (def.hasPhoto) {
    router.post(
      "/:id/photo",
      requirePermission(MODULE, "edit"),
      handlePhotoUpload,
      asyncHandler(async (req, res) => {
        const id = String(req.params.id);
        if (!req.file) return res.status(400).json({ error: "NO_FILE_UPLOADED" });
        const existing = await delegate().findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
        const ext = extFromMime(req.file.mimetype);
        const photoUrl = await storeRegistryPhoto(def.photoDir, id, req.file.buffer, ext);
        await delegate().update({ where: { id }, data: { photoUrl } });
        await logRegistry(req, `${def.logPrefix}_PHOTO`, { id });
        res.json({ id, photoUrl });
      })
    );
  }

  return router;
}

const contactRoutes = createRegistryRouter(contactDef);
const sectorRoutes = createRegistryRouter(sectorDef);
const personnelRoutes = createRegistryRouter(personnelDef);

module.exports = { contactRoutes, sectorRoutes, personnelRoutes };
