const fs = require("fs");
const path = require("path");
const yauzl = require("yauzl");
const { decryptFile } = require("./crypto");
const {
  UPLOADS_ROOT,
  dumpDatabase,
  restoreDatabase,
  makeWorkDir,
  redact,
} = require("./archive");
const { fail } = require("./settings");

function classifyEntry(name) {
  let normalized = String(name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return { action: "reject" };
  const directory = normalized.endsWith("/");
  if (directory) normalized = normalized.replace(/\/+$/, "");
  const parts = normalized.split("/");
  if (!normalized || parts.some((part) => part === ".." || part === "")) return { action: "reject" };

  let action = "reject";
  if (normalized === "database.dump" || normalized === "manifest.json" || normalized === "LEIA-ME.txt") action = "keep";
  else if (normalized === "uploads" || normalized.startsWith("uploads/")) action = "keep";
  else if (normalized === "source" || normalized.startsWith("source/") || normalized === "backend.env") action = "skip";
  return { action, normalized, directory };
}

function safeDestination(root, normalized) {
  const target = path.resolve(root, ...normalized.split("/"));
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null;
  return target;
}

function extractDataZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, zipfile) => {
      if (error) {
        reject(fail(400, "Não foi possível ler a cópia. Confirme a frase-passe e o ficheiro."));
        return;
      }

      let hasDump = false;
      let failed = false;
      const failOnce = (err) => {
        if (failed) return;
        failed = true;
        try { zipfile.close(); } catch { /* arquivo já fechado */ }
        reject(err.status ? err : fail(400, err.message || "Falha ao ler a cópia."));
      };

      zipfile.on("error", failOnce);
      zipfile.on("entry", (entry) => {
        if (failed) return;
        const decision = classifyEntry(entry.fileName);
        if (decision.action === "reject") {
          failOnce(fail(400, `O ficheiro não é uma cópia de dados do InforCliente (${entry.fileName}).`));
          return;
        }
        const isDir = decision.directory || /[/\\]$/.test(entry.fileName);
        if (decision.action === "skip" || isDir) {
          if (decision.action === "keep" && isDir) {
            const dest = safeDestination(destDir, decision.normalized);
            if (!dest) return failOnce(fail(400, "Caminho inválido dentro da cópia."));
            fs.mkdirSync(dest, { recursive: true });
          }
          zipfile.readEntry();
          return;
        }

        const dest = safeDestination(destDir, decision.normalized);
        if (!dest) return failOnce(fail(400, "Caminho inválido dentro da cópia."));
        if (decision.normalized === "database.dump") hasDump = true;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError) return failOnce(streamError);
          const output = fs.createWriteStream(dest, { mode: 0o600 });
          stream.on("error", failOnce);
          output.on("error", failOnce);
          output.on("finish", () => zipfile.readEntry());
          stream.pipe(output);
        });
      });
      zipfile.on("end", () => {
        if (failed) return;
        if (!hasDump) failOnce(fail(400, "Esta cópia não contém a base de dados."));
        else resolve();
      });
      zipfile.readEntry();
    });
  });
}

function stageUploads(incomingDir) {
  const previous = `${UPLOADS_ROOT}.previous`;
  fs.rmSync(previous, { recursive: true, force: true });
  const hadPrevious = fs.existsSync(UPLOADS_ROOT);
  if (hadPrevious) {
    try {
      fs.renameSync(UPLOADS_ROOT, previous);
    } catch {
      throw fail(503, "Não foi possível substituir os ficheiros actuais. Feche o que estiver a usar a pasta de uploads e tente de novo.");
    }
  }
  try {
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
    if (fs.existsSync(incomingDir)) fs.cpSync(incomingDir, UPLOADS_ROOT, { recursive: true });
  } catch {
    fs.rmSync(UPLOADS_ROOT, { recursive: true, force: true });
    if (hadPrevious && fs.existsSync(previous)) fs.renameSync(previous, UPLOADS_ROOT);
    throw fail(503, "Não foi possível copiar os ficheiros da cópia.");
  }

  let committed = false;
  return {
    commit() {
      committed = true;
      fs.rmSync(previous, { recursive: true, force: true });
    },
    rollback() {
      if (committed) return;
      fs.rmSync(UPLOADS_ROOT, { recursive: true, force: true });
      if (hadPrevious && fs.existsSync(previous)) fs.renameSync(previous, UPLOADS_ROOT);
    },
  };
}

async function releaseDatabase() {
  const { prisma } = require("../../db");
  try {
    await prisma.$queryRawUnsafe(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"
    );
  } catch {
    /* sem permissão para terminar outras sessões */
  }
  await prisma.$disconnect();
}

async function reconnectDatabase() {
  try {
    const { prisma } = require("../../db");
    await prisma.$connect();
  } catch (error) {
    console.error("Ligação à base após reposição:", redact(error.message));
  }
}

async function performRestore({ filePath, passphrase, onPhase }) {
  const work = makeWorkDir();
  let staged = null;
  try {
    onPhase("decrypt");
    const zipPath = path.join(work, "plain.zip");
    await decryptFile(filePath, zipPath, passphrase);

    onPhase("extract");
    const extracted = path.join(work, "extracted");
    fs.mkdirSync(extracted);
    await extractDataZip(zipPath, extracted);

    onPhase("safety");
    const safetyDump = path.join(work, "safety.dump");
    await dumpDatabase(safetyDump);
    staged = stageUploads(path.join(extracted, "uploads"));

    onPhase("database");
    await releaseDatabase();
    try {
      await restoreDatabase(path.join(extracted, "database.dump"));
    } catch (error) {
      if (staged) staged.rollback();
      staged = null;
      try {
        await restoreDatabase(safetyDump);
      } catch (rollbackError) {
        throw fail(503, `${error.message} Os dados anteriores não foram recuperados: ${rollbackError.message}`);
      }
      throw error;
    }

    onPhase("files");
    try { staged.commit(); } catch { /* a pasta anterior pode permanecer como uploads.previous */ }
    staged = null;
    await reconnectDatabase();
  } catch (error) {
    if (staged) {
      try { staged.rollback(); } catch { /* a pasta anterior mantém-se se a troca falhar */ }
    }
    await reconnectDatabase();
    throw error;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { performRestore };
