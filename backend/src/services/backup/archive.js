const { execFile, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ZipArchive } = require("archiver");
const { fail } = require("./settings");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const BACKEND_ROOT = path.join(REPO_ROOT, "backend");
const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_DIR || path.join(BACKEND_ROOT, "uploads"));

let cachedPgDump;

function findPgDump() {
  if (cachedPgDump !== undefined) return cachedPgDump;
  cachedPgDump = locatePgDump();
  return cachedPgDump;
}

function locatePgDump() {
  const fromEnv = process.env.PG_DUMP_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  try {
    const locator = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(locator, ["pg_dump"], { encoding: "utf8", windowsHide: true });
    const first = out.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch {
    /* segue para os caminhos habituais */
  }

  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (fs.existsSync(base)) {
      const versions = fs.readdirSync(base).sort().reverse();
      for (const version of versions) {
        const candidate = path.join(base, version, "bin", "pg_dump.exe");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  return null;
}

function databaseUrl() {
  const raw = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) throw fail(503, "DATABASE_URL não está definida.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw fail(503, "DATABASE_URL é inválida.");
  }
  url.searchParams.delete("schema");
  return url.toString();
}

function redact(text) {
  return String(text || "")
    .replace(/postgres(?:ql)?:\/\/[^@\s/]+@/gi, "postgresql://***@")
    .replace(/(password|secret)[=:]\s*\S+/gi, "$1=***");
}

function dumpDatabase(destFile) {
  const bin = findPgDump();
  if (!bin) {
    throw fail(
      503,
      "pg_dump não foi encontrado. Instale as ferramentas de cliente do PostgreSQL ou defina PG_DUMP_PATH."
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ["--format=custom", "--no-owner", "--no-acl", "--file", destFile, databaseUrl()],
      { windowsHide: true, timeout: 60 * 60 * 1000 },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = redact(stderr || error.message).trim();
          reject(fail(503, detail ? `Falha ao exportar a base de dados: ${detail}` : "Falha ao exportar a base de dados."));
          return;
        }
        resolve(destFile);
      }
    );
  });
}

function readme() {
  return [
    "Cópia de segurança do InforCliente",
    "",
    "Conteúdo:",
    "- database.dump    base de dados PostgreSQL (pg_dump -Fc)",
    "- uploads/         ficheiros carregados no sistema",
    "",
    "O código da aplicação não entra nesta cópia.",
    "",
    "Para repor estes dados, em Gestão > Cópias, carregue este ficheiro .icbk e a frase-passe.",
    "",
  ].join("\n");
}

function buildZip({ dumpPath, zipPath, createdAt }) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (!fs.existsSync(dumpPath)) throw fail(503, "A exportação da base de dados não foi criada.");

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (!error) {
        resolve();
        return;
      }
      try { output.destroy(); } catch { /* stream já encerrado */ }
      try { archive.destroy(); } catch { /* arquivo já encerrado */ }
      reject(error);
    };

    output.on("error", finish);
    archive.on("error", finish);
    archive.on("warning", (error) => {
      if (error.code !== "ENOENT") finish(error);
    });
    output.on("close", () => finish());
    archive.pipe(output);

    const manifest = {
      app: "InforCliente",
      createdAt,
      database: "postgresql custom (pg_dump -Fc)",
      contents: ["database.dump", "uploads/"],
    };

    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    archive.append(readme(), { name: "LEIA-ME.txt" });
    archive.file(dumpPath, { name: "database.dump" });
    if (fs.existsSync(UPLOADS_ROOT)) archive.directory(UPLOADS_ROOT, "uploads");
    archive.finalize();
  });
}

function makeWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inforcliente-backup-"));
}

function applicationDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw fail(503, "DATABASE_URL não está definida.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw fail(503, "DATABASE_URL é inválida.");
  }
  url.searchParams.delete("schema");
  return url.toString();
}

function findPgRestore() {
  const dumpBin = findPgDump();
  if (!dumpBin) return null;
  const name = process.platform === "win32" ? "pg_restore.exe" : "pg_restore";
  const candidate = path.join(path.dirname(dumpBin), name);
  return fs.existsSync(candidate) ? candidate : null;
}

function restoreDatabase(dumpFile) {
  const bin = findPgRestore();
  if (!bin) {
    throw fail(503, "pg_restore não foi encontrado. Instale as ferramentas de cliente do PostgreSQL ou defina PG_DUMP_PATH.");
  }
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ["--clean", "--if-exists", "--no-owner", "--no-acl", "--exit-on-error", "--dbname", applicationDatabaseUrl(), dumpFile],
      { windowsHide: true, timeout: 60 * 60 * 1000 },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = redact(stderr || error.message).trim();
          reject(fail(503, detail ? `Falha ao repor a base de dados: ${detail}` : "Falha ao repor a base de dados."));
          return;
        }
        resolve();
      }
    );
  });
}

module.exports = {
  UPLOADS_ROOT,
  findPgDump,
  dumpDatabase,
  restoreDatabase,
  buildZip,
  makeWorkDir,
  redact,
};
