const express = require("express");
const fs = require("fs");
const os = require("os");
const multer = require("multer");
const { authRequired, authRequiredAllowQuery, requireRole } = require("../middlewares/auth");
const backup = require("../services/backup/service");
const { fail } = require("../services/backup/settings");

const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, _file, cb) => cb(null, `inforcliente-restore-${Date.now()}.icbk`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!String(file.originalname || "").toLowerCase().endsWith(".icbk")) {
      cb(fail(400, "Envie o ficheiro .icbk gerado nas cópias de segurança."));
      return;
    }
    cb(null, true);
  },
});

const router = express.Router();
const admin = requireRole("admin");

function sendDownload(res, { stream, filePath, filename, size, cleanup }) {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  if (size) res.setHeader("Content-Length", String(size));

  const done = () => {
    if (typeof cleanup === "function") cleanup();
  };

  if (filePath) {
    res.download(filePath, filename, (error) => {
      if (error && !res.headersSent) {
        res.status(500).json({ error: "Não foi possível descarregar a cópia." });
      }
      done();
    });
    return;
  }

  stream.on("error", () => {
    if (!res.headersSent) res.status(503).json({ error: "A ligação ao destino externo falhou durante o download." });
    else res.destroy();
    done();
  });
  res.on("close", done);
  stream.pipe(res);
}

router.get("/jobs/:id/download", authRequiredAllowQuery, admin, (req, res, next) => {
  try {
    const file = backup.openJobFile(req.params.id);
    sendDownload(res, { filePath: file.filePath, filename: file.filename, cleanup: file.cleanup });
  } catch (error) {
    next(error);
  }
});

router.get("/remote/:name/download", authRequiredAllowQuery, admin, async (req, res, next) => {
  try {
    const opened = await backup.openRemote(req.params.name);
    sendDownload(res, {
      stream: opened.stream,
      filename: req.params.name,
      size: opened.size,
      cleanup: opened.close,
    });
  } catch (error) {
    next(error);
  }
});

router.use(authRequired, admin);

router.get("/settings", (_req, res) => {
  res.json(backup.getSettingsView());
});

router.put("/settings", (req, res, next) => {
  try {
    res.json(backup.saveSettings(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req, res, next) => {
  try {
    const result = await backup.testConnection(req.body || {});
    res.json({ ok: true, message: "Ligação ao destino externo confirmada.", fingerprint: result.fingerprint || null });
  } catch (error) {
    next(error);
  }
});

router.post("/run", (req, res, next) => {
  try {
    res.status(202).json(backup.startManualBackup(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/restore", (req, res, next) => {
  restoreUpload.single("file")(req, res, (error) => {
    if (error) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      if (error.code === "LIMIT_FILE_SIZE") {
        next(fail(400, "O ficheiro excede o limite de 4 GB."));
        return;
      }
      next(error.status ? error : fail(400, error.message || "Não foi possível receber o ficheiro."));
      return;
    }
    try {
      res.status(202).json(backup.startRestore({
        filePath: req.file?.path,
        passphrase: req.body?.passphrase,
        confirm: req.body?.confirm,
      }));
    } catch (startError) {
      next(startError);
    }
  });
});

router.get("/jobs/:id", (req, res) => {
  const job = backup.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Cópia não encontrada." });
  return res.json(job);
});

router.get("/remote", async (_req, res, next) => {
  try {
    const files = await backup.listRemote();
    res.json({ files });
  } catch (error) {
    next(error);
  }
});

module.exports = { backupRoutes: router };
