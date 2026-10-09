const fs = require("fs");
const path = require("path");
const { config } = require("../../config");
const { wrapSecret, unwrapSecret } = require("./crypto");

const SETTINGS_FILE = process.env.BACKUP_SETTINGS_PATH
  ? path.resolve(process.env.BACKUP_SETTINGS_PATH)
  : path.join(path.resolve(__dirname, "..", "..", ".."), "var", "backup-settings.json");

function defaultSettings() {
  return {
    schedule: "off",
    scheduleHour: 2,
    scheduleMinute: 15,
    weekday: 1,
    retentionDays: 30,
    passphraseWrapped: null,
    lastSlot: null,
    destination: {
      type: "s3",
      s3: {
        endpoint: "",
        region: "eu-central-1",
        bucket: "",
        prefix: "inforcliente/",
        accessKeyId: "",
        secretWrapped: null,
      },
      sftp: {
        host: "",
        port: 22,
        username: "",
        remoteDir: "/backups/inforcliente",
        hostFingerprint: "",
        passwordWrapped: null,
        privateKeyWrapped: null,
      },
    },
    lastRun: null,
    runs: [],
  };
}

function readSettings() {
  const base = defaultSettings();
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...base,
      ...parsed,
      destination: {
        ...base.destination,
        ...(parsed.destination || {}),
        s3: { ...base.destination.s3, ...(parsed.destination?.s3 || {}) },
        sftp: { ...base.destination.sftp, ...(parsed.destination?.sftp || {}) },
      },
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") return base;
    if (error instanceof SyntaxError) return base;
    throw error;
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_FILE);
  try { fs.chmodSync(SETTINGS_FILE, 0o600); } catch { /* Windows ignora modos POSIX */ }
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanPrefix(prefix) {
  let value = String(prefix || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (value.split("/").includes("..")) throw fail(400, "O prefixo do destino não pode conter '..'.");
  if (value && !value.endsWith("/")) value += "/";
  return value || "inforcliente/";
}

function applySettings(input) {
  const current = readSettings();
  const body = input || {};

  if (body.schedule != null) {
    const schedule = String(body.schedule);
    if (!["off", "daily", "weekly"].includes(schedule)) {
      throw fail(400, "A frequência tem de ser desligada, diária ou semanal.");
    }
    current.schedule = schedule;
  }

  if (body.scheduleTime != null) {
    const match = String(body.scheduleTime).match(/^(\d{2}):(\d{2})$/);
    if (!match) throw fail(400, "A hora do agendamento é inválida.");
    current.scheduleHour = clampInt(Number(match[1]), 0, 23, 2);
    current.scheduleMinute = clampInt(Number(match[2]), 0, 59, 15);
  }

  if (body.weekday != null) current.weekday = clampInt(body.weekday, 0, 6, 1);
  if (body.retentionDays != null) current.retentionDays = clampInt(body.retentionDays, 1, 3650, 30);

  if (body.passphrase) {
    const passphrase = String(body.passphrase);
    if (passphrase.length < 12) {
      throw fail(400, "A frase-passe deve ter pelo menos 12 caracteres.");
    }
    current.passphraseWrapped = wrapSecret(passphrase, config.jwtSecret);
  }

  const dest = body.destination || {};
  if (dest.type != null) {
    if (!["s3", "sftp"].includes(dest.type)) throw fail(400, "O destino externo tem de ser S3 ou SFTP.");
    current.destination.type = dest.type;
  }

  if (dest.s3) {
    const s3 = dest.s3;
    if (s3.endpoint != null) current.destination.s3.endpoint = String(s3.endpoint).trim();
    if (s3.region != null) current.destination.s3.region = String(s3.region).trim() || "eu-central-1";
    if (s3.bucket != null) current.destination.s3.bucket = String(s3.bucket).trim();
    if (s3.prefix != null) current.destination.s3.prefix = cleanPrefix(s3.prefix);
    if (s3.accessKeyId != null) current.destination.s3.accessKeyId = String(s3.accessKeyId).trim();
    if (s3.secretAccessKey) {
      current.destination.s3.secretWrapped = wrapSecret(String(s3.secretAccessKey), config.jwtSecret);
    }
  }

  if (dest.sftp) {
    const sftp = dest.sftp;
    if (sftp.host != null) current.destination.sftp.host = String(sftp.host).trim();
    if (sftp.port != null) current.destination.sftp.port = clampInt(sftp.port, 1, 65535, 22);
    if (sftp.username != null) current.destination.sftp.username = String(sftp.username).trim();
    if (sftp.remoteDir != null) current.destination.sftp.remoteDir = String(sftp.remoteDir).trim() || "/";
    if (sftp.hostFingerprint != null) current.destination.sftp.hostFingerprint = String(sftp.hostFingerprint).trim();
    if (sftp.password) current.destination.sftp.passwordWrapped = wrapSecret(String(sftp.password), config.jwtSecret);
    if (sftp.privateKey) current.destination.sftp.privateKeyWrapped = wrapSecret(String(sftp.privateKey), config.jwtSecret);
  }

  writeSettings(current);
  return current;
}

function revealPassphrase(settings = readSettings()) {
  if (!settings.passphraseWrapped) return null;
  return unwrapSecret(settings.passphraseWrapped, config.jwtSecret);
}

function revealDestination(settings, override = null) {
  const merged = override ? applyOverlay(settings, override) : settings;
  const type = merged.destination.type;
  if (type === "s3") {
    const s3 = merged.destination.s3;
    const secret = s3.secretWrapped ? unwrapSecret(s3.secretWrapped, config.jwtSecret) : "";
    return {
      type,
      endpoint: s3.endpoint,
      region: s3.region || "eu-central-1",
      bucket: s3.bucket,
      prefix: cleanPrefix(s3.prefix),
      accessKeyId: s3.accessKeyId,
      secretAccessKey: secret,
    };
  }
  const sftp = merged.destination.sftp;
  return {
    type,
    host: sftp.host,
    port: Number(sftp.port) || 22,
    username: sftp.username,
    remoteDir: sftp.remoteDir || "/",
    hostFingerprint: sftp.hostFingerprint || "",
    password: sftp.passwordWrapped ? unwrapSecret(sftp.passwordWrapped, config.jwtSecret) : "",
    privateKey: sftp.privateKeyWrapped ? unwrapSecret(sftp.privateKeyWrapped, config.jwtSecret) : "",
  };
}

function applyOverlay(settings, input) {
  const copy = JSON.parse(JSON.stringify(settings));
  const dest = input?.destination || {};
  if (dest.type) copy.destination.type = dest.type;
  if (dest.s3) {
    const s3 = dest.s3;
    if (s3.endpoint != null) copy.destination.s3.endpoint = String(s3.endpoint).trim();
    if (s3.region != null) copy.destination.s3.region = String(s3.region).trim();
    if (s3.bucket != null) copy.destination.s3.bucket = String(s3.bucket).trim();
    if (s3.prefix != null) copy.destination.s3.prefix = cleanPrefix(s3.prefix);
    if (s3.accessKeyId != null) copy.destination.s3.accessKeyId = String(s3.accessKeyId).trim();
    if (s3.secretAccessKey) copy.destination.s3.secretWrapped = wrapSecret(String(s3.secretAccessKey), config.jwtSecret);
  }
  if (dest.sftp) {
    const sftp = dest.sftp;
    if (sftp.host != null) copy.destination.sftp.host = String(sftp.host).trim();
    if (sftp.port != null) copy.destination.sftp.port = clampInt(sftp.port, 1, 65535, 22);
    if (sftp.username != null) copy.destination.sftp.username = String(sftp.username).trim();
    if (sftp.remoteDir != null) copy.destination.sftp.remoteDir = String(sftp.remoteDir).trim();
    if (sftp.hostFingerprint != null) copy.destination.sftp.hostFingerprint = String(sftp.hostFingerprint).trim();
    if (sftp.password) copy.destination.sftp.passwordWrapped = wrapSecret(String(sftp.password), config.jwtSecret);
    if (sftp.privateKey) copy.destination.sftp.privateKeyWrapped = wrapSecret(String(sftp.privateKey), config.jwtSecret);
  }
  return copy;
}

function destinationReady(dest) {
  if (!dest) return false;
  if (dest.type === "s3") {
    return Boolean(dest.bucket && dest.accessKeyId && dest.secretAccessKey && dest.region);
  }
  if (dest.type === "sftp") {
    return Boolean(dest.host && dest.username && (dest.password || dest.privateKey));
  }
  return false;
}

function toPublic(settings = readSettings()) {
  const hour = String(settings.scheduleHour).padStart(2, "0");
  const minute = String(settings.scheduleMinute).padStart(2, "0");
  return {
    schedule: settings.schedule,
    scheduleTime: `${hour}:${minute}`,
    weekday: settings.weekday,
    retentionDays: settings.retentionDays,
    hasPassphrase: Boolean(settings.passphraseWrapped),
    destination: {
      type: settings.destination.type,
      s3: {
        endpoint: settings.destination.s3.endpoint,
        region: settings.destination.s3.region,
        bucket: settings.destination.s3.bucket,
        prefix: settings.destination.s3.prefix,
        accessKeyId: settings.destination.s3.accessKeyId,
        hasSecret: Boolean(settings.destination.s3.secretWrapped),
      },
      sftp: {
        host: settings.destination.sftp.host,
        port: settings.destination.sftp.port,
        username: settings.destination.sftp.username,
        remoteDir: settings.destination.sftp.remoteDir,
        hostFingerprint: settings.destination.sftp.hostFingerprint,
        hasPassword: Boolean(settings.destination.sftp.passwordWrapped),
        hasPrivateKey: Boolean(settings.destination.sftp.privateKeyWrapped),
      },
    },
    lastRun: settings.lastRun,
    runs: settings.runs || [],
  };
}

function pushRun(entry) {
  const settings = readSettings();
  settings.lastRun = entry;
  settings.runs = [entry, ...(settings.runs || [])].slice(0, 15);
  writeSettings(settings);
}

function markSlot(slot) {
  const settings = readSettings();
  settings.lastSlot = slot;
  writeSettings(settings);
}

module.exports = {
  SETTINGS_FILE,
  readSettings,
  writeSettings,
  applySettings,
  revealPassphrase,
  revealDestination,
  destinationReady,
  toPublic,
  pushRun,
  markSlot,
  fail,
  cleanPrefix,
};
