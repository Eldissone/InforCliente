const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { encryptFile } = require("./crypto");
const { performRestore } = require("./restore");
const { findPgDump, dumpDatabase, buildZip, makeWorkDir, redact } = require("./archive");
const destinations = require("./destinations");
const {
  readSettings,
  applySettings,
  revealPassphrase,
  revealDestination,
  destinationReady,
  toPublic,
  pushRun,
  markSlot,
  fail,
} = require("./settings");

const PHASES = {
  dump: "A exportar a base de dados",
  pack: "A compactar os ficheiros do sistema",
  encrypt: "A cifrar o ficheiro",
  upload: "A enviar a cópia externa",
  retention: "A limpar cópias externas antigas",
  ready: "Pronto para download",
  done: "Concluído",
  decrypt: "A abrir o ficheiro",
  extract: "A ler a base de dados e os ficheiros",
  safety: "A guardar o estado actual",
  database: "A repor a base de dados",
  files: "A repor os ficheiros",
};

const jobs = new Map();
let locked = false;

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    phaseLabel: PHASES[job.phase] || job.phase,
    filename: job.filename,
    bytes: job.bytes,
    remoteOk: job.remoteOk,
    remoteError: job.remoteError,
    error: job.error,
    createdAt: job.createdAt,
  };
}

function createJob(source) {
  const job = {
    id: crypto.randomBytes(16).toString("hex"),
    status: "running",
    phase: "dump",
    source,
    filename: null,
    bytes: 0,
    remoteOk: false,
    remoteError: null,
    error: null,
    filePath: null,
    workDir: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  return job;
}

async function runJob(job, { keepFile, uploadRemote }) {
  const settings = readSettings();
  const passphrase = revealPassphrase(settings);
  const dest = revealDestination(settings);
  const work = makeWorkDir();
  job.workDir = work;
  const filename = `inforcliente-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.icbk`;

  try {
    const dumpPath = path.join(work, "database.dump");
    await dumpDatabase(dumpPath);
    job.phase = "pack";
    const zipPath = path.join(work, "plain.zip");
    await buildZip({ dumpPath, zipPath, createdAt: job.createdAt });
    fs.rmSync(dumpPath, { force: true });
    job.phase = "encrypt";
    const encPath = path.join(work, filename);
    await encryptFile(zipPath, encPath, passphrase);
    fs.rmSync(zipPath, { force: true });
    job.filename = filename;
    job.filePath = encPath;
    job.bytes = fs.statSync(encPath).size;

    if (uploadRemote) {
      job.phase = "upload";
      try {
        await destinations.putFile(dest, encPath, filename);
        job.remoteOk = true;
        job.phase = "retention";
        await destinations.applyRetention(dest, settings.retentionDays);
      } catch (error) {
        job.remoteOk = false;
        job.remoteError = redact(error.message);
        if (!keepFile) throw error;
      }
    }

    pushRun({
      at: job.createdAt,
      source: job.source,
      status: !uploadRemote || job.remoteOk ? "ok" : "partial",
      filename,
      bytes: job.bytes,
      remoteOk: job.remoteOk,
      error: job.remoteError,
    });

    if (keepFile) {
      job.status = "ready";
      job.phase = "ready";
      job.finishedAt = new Date().toISOString();
    } else {
      fs.rmSync(work, { recursive: true, force: true });
      job.filePath = null;
      job.workDir = null;
      job.status = "done";
      job.phase = "done";
      job.finishedAt = new Date().toISOString();
    }
    return job;
  } catch (error) {
    const message = redact(error.message || "Falha ao gerar a cópia.");
    job.status = "error";
    job.error = message;
    job.finishedAt = new Date().toISOString();
    pushRun({
      at: job.createdAt,
      source: job.source,
      status: "error",
      filename: job.filename,
      bytes: job.bytes || 0,
      remoteOk: false,
      error: message,
    });
    if (job.workDir) fs.rmSync(job.workDir, { recursive: true, force: true });
    job.filePath = null;
    job.workDir = null;
    throw error.status ? error : fail(503, message);
  }
}

function startManualBackup(input = {}) {
  if (locked) throw fail(409, "Já existe uma cópia de segurança em curso.");
  if (input.passphrase || input.destination || input.schedule) applySettings(input);
  const downloadLocal = Boolean(input.downloadLocal);
  const settings = readSettings();
  if (!revealPassphrase(settings)) {
    throw fail(400, "Defina a frase-passe de cifra antes de gerar a cópia.");
  }
  const uploadRemote = destinationReady(revealDestination(settings));
  if (!uploadRemote && !downloadLocal) {
    throw fail(400, "Configure o destino externo ou marque a descarga neste computador.");
  }
  locked = true;
  const job = createJob("manual");
  runJob(job, { keepFile: downloadLocal, uploadRemote })
    .catch((error) => {
      console.error("Cópia manual:", redact(error.message));
    })
    .finally(() => {
      locked = false;
    });
  return publicJob(job);
}

function startRestore({ filePath, passphrase, confirm }) {
  const removeUpload = () => {
    if (filePath) fs.rmSync(filePath, { force: true });
  };
  if (!filePath || !fs.existsSync(filePath)) throw fail(400, "Seleccione o ficheiro .icbk.");
  if (String(confirm || "").trim().toUpperCase() !== "REPOR") {
    removeUpload();
    throw fail(400, "Escreva REPOR para confirmar a substituição dos dados.");
  }
  if (!String(passphrase || "").trim()) {
    removeUpload();
    throw fail(400, "Indique a frase-passe da cópia.");
  }
  if (locked) {
    removeUpload();
    throw fail(409, "Já existe uma cópia ou reposição em curso.");
  }

  locked = true;
  const job = createJob("restore");
  performRestore({
    filePath,
    passphrase: String(passphrase),
    onPhase(phase) { job.phase = phase; },
  })
    .then(() => {
      job.status = "done";
      job.phase = "done";
      job.finishedAt = new Date().toISOString();
      pushRun({
        at: job.createdAt,
        source: "restore",
        status: "ok",
        filename: null,
        bytes: 0,
        remoteOk: false,
        error: null,
      });
    })
    .catch((error) => {
      const message = redact(error.message || "Falha ao repor os dados.");
      job.status = "error";
      job.error = message;
      job.finishedAt = new Date().toISOString();
      pushRun({
        at: job.createdAt,
        source: "restore",
        status: "error",
        filename: null,
        bytes: 0,
        remoteOk: false,
        error: message,
      });
      console.error("Reposição:", message);
    })
    .finally(() => {
      locked = false;
      removeUpload();
    });
  return publicJob(job);
}

function getJob(id) {
  return publicJob(jobs.get(String(id || "")));
}

function openJobFile(id) {
  const job = jobs.get(String(id || ""));
  if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
    throw fail(404, "O ficheiro desta cópia já foi descarregado ou expirou.");
  }
  if (job.status !== "ready") throw fail(409, "A cópia ainda está a ser preparada.");
  return {
    filePath: job.filePath,
    filename: job.filename,
    cleanup() {
      if (job.workDir) fs.rmSync(job.workDir, { recursive: true, force: true });
      job.filePath = null;
      job.workDir = null;
      job.status = "done";
      job.phase = "done";
      job.finishedAt = new Date().toISOString();
    },
  };
}

function getSettingsView() {
  return {
    ...toPublic(),
    pgDumpAvailable: Boolean(findPgDump()),
    pgDumpPath: findPgDump(),
    running: locked,
  };
}

function saveSettings(input) {
  applySettings(input);
  return getSettingsView();
}

async function testConnection(input) {
  const dest = revealDestination(readSettings(), input);
  if (!destinationReady(dest)) {
    throw fail(400, "Preencha o destino externo antes de testar a ligação.");
  }
  return destinations.testDestination(dest);
}

async function listRemote() {
  const dest = revealDestination(readSettings());
  if (!destinationReady(dest)) return [];
  return destinations.listFiles(dest);
}

async function openRemote(filename) {
  const dest = revealDestination(readSettings());
  if (!destinationReady(dest)) throw fail(400, "O destino externo não está configurado.");
  return destinations.openFile(dest, filename);
}

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function tick() {
  if (locked) return;
  const settings = readSettings();
  if (settings.schedule === "off") return;
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesAt = Number(settings.scheduleHour) * 60 + Number(settings.scheduleMinute);
  if (minutesNow < minutesAt) return;
  if (settings.schedule === "weekly" && now.getDay() !== Number(settings.weekday)) return;
  const today = localDateKey(now);
  if (settings.lastSlot === today) return;

  markSlot(today);
  if (!revealPassphrase(settings) || !destinationReady(revealDestination(settings))) {
    pushRun({
      at: new Date().toISOString(),
      source: "schedule",
      status: "error",
      filename: null,
      bytes: 0,
      remoteOk: false,
      error: "Agendamento ignorado: falta a frase-passe ou o destino externo.",
    });
    return;
  }

  locked = true;
  const job = createJob("schedule");
  try {
    await runJob(job, { keepFile: false, uploadRemote: true });
  } catch (error) {
    console.error("Cópia agendada:", redact(error.message));
  } finally {
    locked = false;
  }
}

function purgeOldJobs() {
  const limit = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.status === "running") continue;
    const mark = new Date(job.finishedAt || job.createdAt).getTime();
    if (mark > limit) continue;
    if (job.workDir) fs.rmSync(job.workDir, { recursive: true, force: true });
    jobs.delete(id);
  }
}

function startBackupScheduler() {
  const timer = setInterval(() => {
    tick().catch((error) => console.error("Agendamento de cópias:", error.message));
  }, 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  const purge = setInterval(purgeOldJobs, 10 * 60 * 1000);
  if (typeof purge.unref === "function") purge.unref();
}

module.exports = {
  startManualBackup,
  startRestore,
  getJob,
  openJobFile,
  getSettingsView,
  saveSettings,
  testConnection,
  listRemote,
  openRemote,
  startBackupScheduler,
};
