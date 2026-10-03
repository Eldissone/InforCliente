const crypto = require("crypto");
const { uploadToSupabase } = require("../utils/storage");

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_MIME_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
};

/** Nome normalizado para unicidade (sem acentos, minúsculas, espaços únicos). */
function normalizeNameKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanText(value, { max = 500 } = {}) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, max);
}

/**
 * Descodifica uma foto em data URL (como era guardada no localStorage).
 * Devolve { buffer, ext } ou lança Error com `code`.
 */
function decodePhotoDataUrl(dataUrl) {
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (!match) {
    const err = new Error("INVALID_IMAGE_TYPE");
    err.code = "INVALID_IMAGE_TYPE";
    throw err;
  }
  const mime = match[1].toLowerCase();
  const ext = PHOTO_MIME_EXT[mime];
  if (!ext) {
    const err = new Error("INVALID_IMAGE_TYPE");
    err.code = "INVALID_IMAGE_TYPE";
    throw err;
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    const err = new Error("INVALID_IMAGE_TYPE");
    err.code = "INVALID_IMAGE_TYPE";
    throw err;
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    const err = new Error("IMAGE_TOO_LARGE");
    err.code = "IMAGE_TOO_LARGE";
    throw err;
  }
  return { buffer, ext, mime };
}

/** Grava a foto de um registo de cadastro e devolve o caminho `uploads/...`. */
async function storeRegistryPhoto(dir, recordId, buffer, ext) {
  const hash = crypto.randomBytes(6).toString("hex");
  const storagePath = `registry/${dir}/${recordId}/photo-${Date.now()}-${hash}${ext}`;
  return uploadToSupabase(storagePath, buffer);
}

function extFromMime(mime, fallback = ".jpg") {
  return PHOTO_MIME_EXT[String(mime || "").toLowerCase()] || fallback;
}

module.exports = {
  MAX_PHOTO_BYTES,
  PHOTO_MIME_EXT,
  normalizeNameKey,
  cleanText,
  decodePhotoDataUrl,
  storeRegistryPhoto,
  extFromMime,
};
