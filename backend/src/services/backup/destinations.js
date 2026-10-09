const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");
const { fail } = require("./settings");

const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const FILE_NAME = /^inforcliente-\d{8}T\d{6}Z\.icbk$/;

function assertFileName(name) {
  if (!FILE_NAME.test(String(name || ""))) throw fail(400, "Nome de cópia inválido.");
  return name;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function signingKey(secret, dateStamp, region) {
  const kDate = crypto.createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
  return crypto.createHmac("sha256", kService).update("aws4_request").digest();
}

function amzDates(now = new Date()) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function buildTarget(dest, key, query) {
  const encodedKey = String(key || "")
    .split("/")
    .filter((part) => part.length > 0)
    .map(encodeRfc3986)
    .join("/");
  const queryString = query
    ? Object.keys(query)
        .sort()
        .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name])}`)
        .join("&")
    : "";

  if (!dest.endpoint) {
    return {
      protocol: "https:",
      host: `${dest.bucket}.s3.${dest.region}.amazonaws.com`,
      path: `/${encodedKey}`,
      queryString,
    };
  }

  const endpoint = dest.endpoint.includes("://") ? dest.endpoint : `https://${dest.endpoint}`;
  const url = new URL(endpoint);
  const base = url.pathname.replace(/\/$/, "");
  const bucket = encodeRfc3986(dest.bucket);
  return {
    protocol: url.protocol === "http:" ? "http:" : "https:",
    host: url.host,
    path: `${base}/${bucket}${encodedKey ? `/${encodedKey}` : ""}`,
    queryString,
  };
}

function s3Error(body, statusCode) {
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body || "");
  const message = (text.match(/<Message>([^<]*)<\/Message>/) || [])[1];
  const code = (text.match(/<Code>([^<]*)<\/Code>/) || [])[1];
  const detail = message || code || `HTTP ${statusCode}`;
  return fail(503, `Destino S3 recusou a operação: ${detail}`);
}

function signedRequest(dest, { method, key, query, payloadHash, contentType, contentLength, stream }) {
  const target = buildTarget(dest, key, query);
  const { amzDate, dateStamp } = amzDates();
  const hash = payloadHash || EMPTY_HASH;
  const headerMap = {
    host: target.host,
    "x-amz-content-sha256": hash,
    "x-amz-date": amzDate,
  };
  if (contentType) headerMap["content-type"] = contentType;
  const names = Object.keys(headerMap).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headerMap[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [method, target.path, target.queryString, canonicalHeaders, signedHeaders, hash].join("\n");
  const scope = `${dateStamp}/${dest.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signature = crypto.createHmac("sha256", signingKey(dest.secretAccessKey, dateStamp, dest.region))
    .update(stringToSign)
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${dest.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const transport = target.protocol === "http:" ? http : https;
  const pathWithQuery = target.queryString ? `${target.path}?${target.queryString}` : target.path;
  const headers = {
    Host: headerMap.host,
    "x-amz-content-sha256": hash,
    "x-amz-date": amzDate,
    Authorization: authorization,
  };
  if (contentType) headers["Content-Type"] = contentType;
  if (contentLength != null) headers["Content-Length"] = String(contentLength);

  return { transport, protocol: target.protocol, pathWithQuery, headers, host: target.host };
}

function requestBuffer(dest, options) {
  const signed = signedRequest(dest, options);
  return new Promise((resolve, reject) => {
    const req = signed.transport.request(
      {
        protocol: signed.protocol,
        host: signed.host,
        method: options.method,
        path: signed.pathWithQuery,
        headers: signed.headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(s3Error(body, res.statusCode));
        });
      }
    );
    req.on("error", (error) => reject(fail(503, `Não foi possível contactar o destino S3: ${error.message}`)));
    if (options.body) req.end(options.body);
    else req.end();
  });
}

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function parseList(xml) {
  const items = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match = re.exec(xml);
  while (match) {
    const block = match[1];
    const key = (block.match(/<Key>([^<]*)<\/Key>/) || [])[1];
    const size = Number((block.match(/<Size>([^<]*)<\/Size>/) || [])[1] || 0);
    const modified = (block.match(/<LastModified>([^<]*)<\/LastModified>/) || [])[1];
    if (key) items.push({ key: decodeXml(key), size, modifiedAt: modified || null });
    match = re.exec(xml);
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const token = (xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/) || [])[1] || null;
  return { items, truncated, token: token ? decodeXml(token) : null };
}

async function listS3(dest) {
  const items = [];
  let token = null;
  do {
    const query = { "list-type": "2", prefix: dest.prefix, "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const body = await requestBuffer(dest, { method: "GET", key: "", query, payloadHash: EMPTY_HASH });
    const page = parseList(body.toString("utf8"));
    items.push(...page.items);
    token = page.truncated ? page.token : null;
  } while (token);
  return items;
}

async function putS3(dest, localPath, filename) {
  const key = `${dest.prefix}${filename}`;
  const size = fs.statSync(localPath).size;
  const payloadHash = await hashFile(localPath);
  const signed = signedRequest(dest, {
    method: "PUT",
    key,
    payloadHash,
    contentType: "application/octet-stream",
    contentLength: size,
  });
  await new Promise((resolve, reject) => {
    const req = signed.transport.request(
      {
        protocol: signed.protocol,
        host: signed.host,
        method: "PUT",
        path: signed.pathWithQuery,
        headers: signed.headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(s3Error(body, res.statusCode));
        });
      }
    );
    req.on("error", (error) => reject(fail(503, `Não foi possível enviar a cópia para o S3: ${error.message}`)));
    fs.createReadStream(localPath).on("error", reject).pipe(req);
  });
}

function openS3(dest, filename) {
  const key = `${dest.prefix}${assertFileName(filename)}`;
  const signed = signedRequest(dest, { method: "GET", key, payloadHash: EMPTY_HASH });
  return new Promise((resolve, reject) => {
    const req = signed.transport.request(
      {
        protocol: signed.protocol,
        host: signed.host,
        method: "GET",
        path: signed.pathWithQuery,
        headers: signed.headers,
      },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ stream: res, size: Number(res.headers["content-length"]) || null });
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => reject(s3Error(Buffer.concat(chunks), res.statusCode)));
      }
    );
    req.on("error", (error) => reject(fail(503, `Não foi possível obter a cópia no S3: ${error.message}`)));
    req.end();
  });
}

async function deleteS3(dest, key) {
  await requestBuffer(dest, { method: "DELETE", key, payloadHash: EMPTY_HASH });
}

function normalizeFingerprint(value) {
  return String(value || "").trim().replace(/^SHA256:/i, "").replace(/=+$/, "");
}

function remotePath(dest, filename) {
  const base = String(dest.remoteDir || "/").replace(/\\/g, "/").replace(/\/+$/, "");
  return `${base}/${assertFileName(filename)}`;
}

function connectSftp(dest) {
  let Client;
  try {
    Client = require("ssh2").Client;
  } catch {
    throw fail(503, "O suporte SFTP não está instalado no servidor.");
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let fingerprint = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    conn.on("ready", () => {
      conn.sftp((error, sftp) => {
        if (error) {
          conn.end();
          finish(fail(503, `SFTP recusou a sessão: ${error.message}`));
          return;
        }
        finish(null, {
          sftp,
          fingerprint,
          close() {
            try { conn.end(); } catch { /* sessão já encerrada */ }
          },
        });
      });
    });
    conn.on("error", (error) => finish(fail(503, `Não foi possível ligar ao SFTP: ${error.message}`)));

    const options = {
      host: dest.host,
      port: Number(dest.port) || 22,
      username: dest.username,
      readyTimeout: 20000,
      hostHash: "sha256",
      hostVerifier(hashedKey) {
        fingerprint = `SHA256:${normalizeFingerprint(hashedKey)}`;
        if (!dest.hostFingerprint) return true;
        return normalizeFingerprint(hashedKey) === normalizeFingerprint(dest.hostFingerprint);
      },
    };
    if (dest.privateKey) options.privateKey = dest.privateKey;
    else options.password = dest.password;
    conn.connect(options);
  });
}

function withSftp(dest, fn) {
  return connectSftp(dest).then(async (session) => {
    try {
      return await fn(session.sftp, session.fingerprint);
    } finally {
      session.close();
    }
  });
}

function ensureRemoteDir(sftp, dir) {
  const normalized = String(dir || "/").replace(/\\/g, "/");
  const absolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);
  let current = absolute ? "" : ".";

  const step = (index) => new Promise((resolve, reject) => {
    if (index >= parts.length) return resolve();
    current += `/${parts[index]}`;
    sftp.mkdir(current, () => {
      sftp.stat(current, (statError, stat) => {
        if (statError || !stat.isDirectory()) {
          reject(fail(503, `Não foi possível criar a pasta remota ${current}.`));
          return;
        }
        step(index + 1).then(resolve, reject);
      });
    });
  });

  return step(0);
}

async function putSftp(dest, localPath, filename) {
  await withSftp(dest, async (sftp) => {
    await ensureRemoteDir(sftp, dest.remoteDir);
    await new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath(dest, filename), (error) => {
        if (error) reject(fail(503, `Não foi possível enviar a cópia por SFTP: ${error.message}`));
        else resolve();
      });
    });
  });
}

async function listSftp(dest) {
  return withSftp(dest, (sftp) => new Promise((resolve, reject) => {
    sftp.readdir(dest.remoteDir, (error, list) => {
      if (error) {
        reject(fail(503, `Não foi possível listar o destino SFTP: ${error.message}`));
        return;
      }
      resolve((list || []).map((entry) => ({
        key: entry.filename,
        size: Number(entry.attrs?.size || 0),
        modifiedAt: entry.attrs?.mtime ? new Date(entry.attrs.mtime * 1000).toISOString() : null,
      })));
    });
  }));
}

async function openSftp(dest, filename) {
  const session = await connectSftp(dest);
  const remote = remotePath(dest, filename);
  try {
    const stat = await new Promise((resolve, reject) => {
      session.sftp.stat(remote, (error, found) => {
        if (error) reject(fail(404, "Essa cópia já não está no destino externo."));
        else resolve(found);
      });
    });
    const stream = session.sftp.createReadStream(remote);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      session.close();
    };
    stream.on("close", close);
    stream.on("error", close);
    return { stream, size: Number(stat.size) || null, close };
  } catch (error) {
    session.close();
    throw error;
  }
}

async function deleteSftp(dest, filename) {
  await withSftp(dest, (sftp) => new Promise((resolve, reject) => {
    sftp.unlink(remotePath(dest, filename), (error) => {
      if (error) reject(fail(503, `Não foi possível apagar a cópia antiga: ${error.message}`));
      else resolve();
    });
  }));
}

function fileStampFromName(name) {
  const match = String(name).match(/^inforcliente-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.icbk$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

function toPublicItem(entry) {
  const name = path.posix.basename(String(entry.key || ""));
  if (!FILE_NAME.test(name)) return null;
  return { name, size: entry.size || 0, modifiedAt: entry.modifiedAt };
}

async function putFile(dest, localPath, filename) {
  assertFileName(filename);
  if (dest.type === "s3") return putS3(dest, localPath, filename);
  if (dest.type === "sftp") return putSftp(dest, localPath, filename);
  throw fail(400, "Destino externo não configurado.");
}

async function listFiles(dest) {
  const raw = dest.type === "s3" ? await listS3(dest) : await listSftp(dest);
  return raw.map(toPublicItem).filter(Boolean).sort((a, b) => String(b.name).localeCompare(String(a.name)));
}

async function openFile(dest, filename) {
  assertFileName(filename);
  if (dest.type === "s3") return openS3(dest, filename);
  if (dest.type === "sftp") return openSftp(dest, filename);
  throw fail(400, "Destino externo não configurado.");
}

async function applyRetention(dest, retentionDays) {
  const files = await listFiles(dest);
  const limit = Date.now() - Number(retentionDays) * 24 * 60 * 60 * 1000;
  const doomed = files.filter((file) => {
    const stamp = fileStampFromName(file.name);
    return stamp != null && stamp < limit;
  });
  const keep = files.find((file) => !doomed.includes(file)) || doomed[0];
  for (const file of doomed) {
    if (file === keep) continue;
    if (dest.type === "s3") await deleteS3(dest, `${dest.prefix}${file.name}`);
    else await deleteSftp(dest, file.name);
  }
}

async function testDestination(dest) {
  if (dest.type === "sftp") {
    const fingerprint = await withSftp(dest, async (_sftp, fp) => fp);
    return { ok: true, fingerprint };
  }
  await listS3(dest);
  return { ok: true };
}

module.exports = {
  FILE_NAME,
  assertFileName,
  putFile,
  listFiles,
  openFile,
  applyRetention,
  testDestination,
};
