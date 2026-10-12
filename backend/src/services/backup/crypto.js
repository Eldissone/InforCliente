const crypto = require("crypto");
const fs = require("fs");

const MAGIC = Buffer.from("ICBK");
const VERSION = 1;
const HEADER_LEN = 4 + 1 + 16 + 12;
const TAG_LEN = 16;
const WRAP_SALT = "inforcliente-backup-wrap-v1";

function wrapKey(jwtSecret) {
  return crypto.scryptSync(String(jwtSecret), WRAP_SALT, 32);
}

function wrapSecret(plain, jwtSecret) {
  const key = wrapKey(jwtSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function unwrapSecret(wrapped, jwtSecret) {
  const buf = Buffer.from(String(wrapped), "base64");
  if (buf.length < 28) throw new Error("Segredo de cópia ilegível.");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", wrapKey(jwtSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function encryptFile(src, dest, passphrase) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(String(passphrase), salt, 32);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const out = fs.createWriteStream(dest, { mode: 0o600 });
    const input = fs.createReadStream(src);
    let failed = false;

    const fail = (err) => {
      if (failed) return;
      failed = true;
      input.destroy();
      cipher.destroy();
      out.destroy();
      reject(err);
    };

    out.on("error", fail);
    input.on("error", fail);
    cipher.on("error", fail);

    out.write(Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv]), (err) => {
      if (err) return fail(err);
      input.pipe(cipher);
      cipher.on("data", (chunk) => {
        if (!out.write(chunk)) {
          cipher.pause();
          out.once("drain", () => cipher.resume());
        }
      });
      cipher.on("end", () => {
        if (failed) return;
        out.end(cipher.getAuthTag(), () => resolve());
      });
    });
  });
}

function decryptFile(src, dest, passphrase) {
  return new Promise((resolve, reject) => {
    let fd;
    try {
      fd = fs.openSync(src, "r");
      const size = fs.fstatSync(fd).size;
      if (size < HEADER_LEN + TAG_LEN + 1) {
        throw new Error("Ficheiro de cópia inválido.");
      }
      const header = Buffer.alloc(HEADER_LEN);
      fs.readSync(fd, header, 0, HEADER_LEN, 0);
      if (!header.subarray(0, 4).equals(MAGIC) || header[4] !== VERSION) {
        throw new Error("Ficheiro de cópia não reconhecido.");
      }
      const salt = header.subarray(5, 21);
      const iv = header.subarray(21, 33);
      const tag = Buffer.alloc(TAG_LEN);
      fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
      fs.closeSync(fd);
      fd = null;

      const key = crypto.scryptSync(String(passphrase), salt, 32);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const input = fs.createReadStream(src, { start: HEADER_LEN, end: size - TAG_LEN - 1 });
      const out = fs.createWriteStream(dest, { mode: 0o600 });
      let failed = false;
      const fail = (err) => {
        if (failed) return;
        failed = true;
        input.destroy();
        decipher.destroy();
        out.destroy();
        const authFailed = /unable to authenticate|Unsupported state/i.test(String(err?.message || ""));
        reject(authFailed ? new Error("Frase-passe incorrecta ou ficheiro alterado.") : err);
      };
      input.on("error", fail);
      decipher.on("error", fail);
      out.on("error", fail);
      out.on("finish", () => {
        if (!failed) resolve();
      });
      input.pipe(decipher).pipe(out);
    } catch (error) {
      if (fd != null) {
        try { fs.closeSync(fd); } catch { /* já fechado */ }
      }
      reject(error);
    }
  });
}

module.exports = {
  wrapSecret,
  unwrapSecret,
  encryptFile,
  decryptFile,
};
