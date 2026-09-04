const path = require("path");
const fs = require("fs");

const UPLOADS_ROOT = path.resolve("uploads");

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".zip": "application/zip",
};

function contentTypeForKey(objectKey) {
  const ext = path.extname(objectKey || "").toLowerCase();
  if (ext === ".svg") return "application/octet-stream";
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function toStoredPath(storagePath) {
  const key = parseStoredObjectKey(storagePath);
  if (!key) {
    const cleaned = String(storagePath || "")
      .replace(/^\/+/, "")
      .replace(/^uploads\//, "");
    return `uploads/${cleaned}`;
  }
  return `uploads/${key}`;
}

/**
 * Extrai a chave do ficheiro a partir de caminho relativo, URL /uploads
 * ou URL antiga do bucket Supabase (registos legados na BD).
 */
function parseStoredObjectKey(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const supabaseMatch = u.pathname.match(
        /\/storage\/v1\/object\/(?:public|sign|authenticated)\/infor-cliente\/(.+)$/i
      );
      if (supabaseMatch) return decodeURIComponent(supabaseMatch[1]);
      const uploadsMatch = u.pathname.match(/\/uploads\/(.+)$/);
      if (uploadsMatch) return decodeURIComponent(uploadsMatch[1]);
    } catch {
      return null;
    }
    return null;
  }

  let rel = trimmed.replace(/^\/+/, "");
  if (rel.startsWith("uploads/")) rel = rel.slice("uploads/".length);
  if (!rel || rel.includes("\0") || rel.split(/[/\\]/).includes("..")) return null;
  return rel;
}

function safeLocalPath(objectKey) {
  const key = parseStoredObjectKey(objectKey);
  if (!key) return null;
  const resolved = path.resolve(UPLOADS_ROOT, key);
  const root = UPLOADS_ROOT.endsWith(path.sep) ? UPLOADS_ROOT : `${UPLOADS_ROOT}${path.sep}`;
  if (resolved !== UPLOADS_ROOT && !resolved.startsWith(root)) return null;
  return resolved;
}

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_ROOT)) {
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
  }
}

/**
 * Grava o ficheiro em disco (`uploads/` na VPS).
 * Devolve sempre um caminho relativo `uploads/...` — nunca uma URL pública.
 * O nome `uploadToSupabase` mantém-se porque as rotas já o importam.
 */
async function uploadToSupabase(storagePath, fileBuffer) {
  const objectKey =
    parseStoredObjectKey(storagePath) ||
    String(storagePath || "")
      .replace(/^\/+/, "")
      .replace(/^uploads\//, "");
  if (!objectKey || objectKey.split(/[/\\]/).includes("..")) {
    throw new Error("INVALID_STORAGE_PATH");
  }

  ensureUploadsDir();
  const fullPath = safeLocalPath(objectKey);
  if (!fullPath) throw new Error("INVALID_STORAGE_PATH");
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, fileBuffer);
  return toStoredPath(objectKey);
}

async function readStoredFile(rawPath) {
  const objectKey = parseStoredObjectKey(rawPath);
  if (!objectKey) return null;

  const localPath = safeLocalPath(objectKey);
  if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
    return {
      buffer: fs.readFileSync(localPath),
      contentType: contentTypeForKey(objectKey),
      filename: path.basename(objectKey),
    };
  }

  return null;
}

async function streamStoredFile(res, rawPath) {
  const objectKey = parseStoredObjectKey(rawPath);
  if (!objectKey) {
    res.status(400).json({ error: "INVALID_PATH" });
    return;
  }

  const localPath = safeLocalPath(objectKey);
  if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Type", contentTypeForKey(objectKey));
    await new Promise((resolve, reject) => {
      res.sendFile(localPath, (err) => (err ? reject(err) : resolve()));
    });
    return;
  }

  res.status(404).json({ error: "FILE_NOT_FOUND" });
}

module.exports = {
  uploadToSupabase,
  parseStoredObjectKey,
  toStoredPath,
  readStoredFile,
  streamStoredFile,
  ensureUploadsDir,
};
