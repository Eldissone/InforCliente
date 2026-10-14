const { config } = require("../config");

/**
 * Leitura automática de faturas (Área Financeira) com o Google Gemini.
 *
 * O financeiro carrega o PDF/imagem da fatura física e a IA devolve os campos
 * já estruturados (nº do documento, datas, valores, IVA, retenção, fornecedor
 * e a obra provável). Nada é gravado aqui — o serviço apenas lê o documento.
 *
 * Requer `GEMINI_API_KEY` no .env. Sem chave, `isConfigured()` é falso e as
 * rotas respondem com um erro explícito em vez de rebentar a área financeira.
 */

const SUPPORTED_MIME_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

const MAX_INLINE_BYTES = 12 * 1024 * 1024; // 12MB — limite do payload inline do Gemini

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    documentType: {
      type: "string",
      enum: ["FATURA", "FATURA_RECIBO", "RECIBO", "NOTA_CREDITO", "NOTA_DEBITO", "ORCAMENTO", "OUTRO"],
    },
    docNumber: { type: "string" },
    docDate: { type: "string" },
    dueDate: { type: "string" },
    grossAmount: { type: "number" },
    vatAmount: { type: "number" },
    vatPercent: { type: "number" },
    withholdingAmount: { type: "number" },
    withholdingPercent: { type: "number" },
    carInsuranceAmount: { type: "number" },
    guaranteeAmount: { type: "number" },
    netAmount: { type: "number" },
    currency: { type: "string" },
    supplierName: { type: "string" },
    supplierNif: { type: "string" },
    clientName: { type: "string" },
    clientNif: { type: "string" },
    projectHint: { type: "string" },
    description: { type: "string" },
    notes: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["docNumber", "docDate", "grossAmount", "currency"],
};

const INSTRUCTION = `És um assistente de contabilidade de uma empresa de construção civil em Angola.
Recebes o PDF ou a fotografia de uma fatura/documento e tens de devolver APENAS um JSON com os dados lidos.

Regras:
- Valores sempre em número (1234.56), nunca em texto, sem símbolos de moeda e sem separador de milhares.
- Datas no formato AAAA-MM-DD. Se só existir mês/ano, usa o dia 1. Se não existir, devolve string vazia.
- "grossAmount" é o valor ilíquido (base tributável, SEM IVA). Se o documento só tiver o total com IVA, calcula o ilíquido removendo o IVA e explica-o em "notes".
- "vatAmount" é o valor do IVA e "vatPercent" a taxa aplicada (ex.: 14).
- "withholdingAmount"/"withholdingPercent" correspondem à retenção na fonte, quando existir.
- "netAmount" é o valor total a pagar/receber indicado no documento.
- "docNumber" é o número do documento (ex.: FT 2026/123).
- "supplierName"/"supplierNif" é o emitente; "clientName"/"clientNif" é o destinatário.
- "projectHint" é a referência à obra/projeto que aparece no documento (ex.: código ou nome da obra), ou string vazia.
- "confidence" é a tua confiança global (0 a 1) na leitura.
- Se um campo não existir no documento, devolve string vazia (texto) ou 0 (números). Nunca inventes.
- Não devolvas markdown nem explicações fora do JSON.`;

function isConfigured() {
  return Boolean(config.ai.geminiApiKey);
}

function normalizeMimeType(raw, fileName = "") {
  const mime = String(raw || "").toLowerCase().split(";")[0].trim();
  if (SUPPORTED_MIME_TYPES.has(mime)) return mime;
  const ext = String(fileName).toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return null;
}

function excelSerialToDate(serial) {
  const days = Number(serial);
  if (!Number.isFinite(days) || days < 1 || days > 60000) return null;
  const ms = Math.round((days - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return excelSerialToDate(raw);
  const text = String(raw).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const dmy = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const d = new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateToKey(date) {
  if (!date) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseNumberValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let text = String(raw).trim();
  if (!text) return null;
  // "1.234,56" (pt) vs "1,234.56" (en)
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (hasComma) {
    text = text.replace(",", ".");
  }
  text = text.replace(/[^\d.\-]/g, "");
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  if (value === null || value === undefined) return null;
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function clampPercent(value) {
  const n = parseNumberValue(value);
  if (n === null) return null;
  if (n < 0 || n > 100) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function cleanText(value, maxLength = 200) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text || /^(n\/a|na|null|undefined|-)$/i.test(text)) return null;
  return text.slice(0, maxLength);
}

/** Confiança 0–1 vem como fração ou percentagem, conforme o modelo. */
function normalizeConfidence(value) {
  const n = parseNumberValue(value);
  if (n === null) return null;
  const pct = n <= 1 ? n * 100 : n;
  if (pct < 0 || pct > 100) return null;
  return Math.round((pct + Number.EPSILON) * 100) / 100;
}

function extractJsonBlock(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Sugere a obra a partir do texto lido (código exato → nome → conteúdo). */
function matchProject(projects, hint) {
  const text = String(hint || "").trim().toLowerCase();
  if (!text || !projects?.length) return null;
  const normalize = (v) => String(v || "").trim().toLowerCase();

  const byCode = projects.find((p) => p.code && normalize(p.code) === text);
  if (byCode) return byCode;
  const byName = projects.find((p) => normalize(p.name) === text);
  if (byName) return byName;

  const contains = projects.filter((p) => {
    const code = normalize(p.code);
    const name = normalize(p.name);
    return (code && text.includes(code)) || (name.length > 3 && text.includes(name));
  });
  if (contains.length) {
    return contains.sort((a, b) => normalize(b.name).length - normalize(a.name).length)[0];
  }
  const reversed = projects.filter((p) => {
    const name = normalize(p.name);
    const code = normalize(p.code);
    return (name.length > 5 && name.includes(text)) || (code && code.includes(text));
  });
  return reversed[0] || null;
}

async function callGemini({ mimeType, base64Data, projects }) {
  const url = `${config.ai.geminiBaseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(
    config.ai.geminiModel
  )}:generateContent`;

  const projectList = (projects || [])
    .slice(0, 200)
    .map((p) => `- ${p.code || "—"} | ${p.name}`)
    .join("\n");
  const clientList = (projects || [])
    .filter((p) => p.clientName)
    .map((p) => `- ${p.clientName}`)
    .slice(0, 200)
    .join("\n");

  const promptParts = [INSTRUCTION];
  if (projectList) {
    promptParts.push(
      `Obras existentes no sistema (usa a mais provável em "projectHint"):\n${projectList}`
    );
  }
  if (clientList) {
    promptParts.push(`Clientes existentes no sistema:\n${clientList}`);
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: promptParts.join("\n\n") },
          { inline_data: { mime_type: mimeType, data: base64Data } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const attempt = async () =>
    fetch(`${url}?key=${encodeURIComponent(config.ai.geminiApiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  let response = await attempt();
  if ([429, 500, 503].includes(response.status)) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    response = await attempt();
  }
  return response;
}

function buildHttpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Lê um documento (PDF/imagem) e devolve os campos normalizados da fatura.
 *
 * @param {{ buffer: Buffer, mimeType: string, fileName?: string, projects?: Array }} input
 */
async function readInvoiceDocument({ buffer, mimeType, fileName, projects = [] }) {
  if (!isConfigured()) {
    throw buildHttpError(
      503,
      "Leitura automática de faturas indisponível: falta configurar GEMINI_API_KEY no .env do servidor.",
      "INVOICE_AI_NOT_CONFIGURED"
    );
  }
  if (!buffer || !buffer.length) {
    throw buildHttpError(400, "Nenhum ficheiro recebido para leitura.", "NO_FILE_UPLOADED");
  }
  if (buffer.length > MAX_INLINE_BYTES) {
    throw buildHttpError(
      413,
      `Ficheiro demasiado grande para leitura com IA (máx. ${Math.round(MAX_INLINE_BYTES / 1024 / 1024)}MB).`,
      "FILE_TOO_LARGE"
    );
  }

  const resolvedMime = normalizeMimeType(mimeType, fileName);
  if (!resolvedMime) {
    throw buildHttpError(
      415,
      "Formato não suportado. Carregue a fatura em PDF, JPG, PNG ou WEBP.",
      "UNSUPPORTED_FILE_TYPE"
    );
  }

  let response;
  try {
    response = await callGemini({
      mimeType: resolvedMime,
      base64Data: buffer.toString("base64"),
      projects,
    });
  } catch (error) {
    console.error("Gemini invoice scan failed:", error);
    throw buildHttpError(
      503,
      "Não foi possível contactar o serviço de leitura de faturas. Verifique a ligação à internet e tente novamente.",
      "AI_UNAVAILABLE"
    );
  }

  const payloadText = await response.text();
  let payload;
  try {
    payload = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const apiMessage = payload?.error?.message || "";
    if (response.status === 400 && /API key not valid/i.test(apiMessage)) {
      throw buildHttpError(
        503,
        "A chave GEMINI_API_KEY configurada não é válida. Atualize-a no .env do servidor.",
        "AI_INVALID_KEY"
      );
    }
    if (response.status === 403) {
      throw buildHttpError(
        503,
        "A chave GEMINI_API_KEY não tem permissão para este modelo. Confirme o acesso no Google AI Studio.",
        "AI_FORBIDDEN"
      );
    }
    if (response.status === 404) {
      throw buildHttpError(
        503,
        `O modelo de IA configurado (${config.ai.geminiModel}) não está disponível. Ajuste GEMINI_MODEL no .env.`,
        "AI_MODEL_NOT_FOUND"
      );
    }
    if (response.status === 429) {
      throw buildHttpError(
        429,
        "O serviço de leitura de faturas está ocupado. Aguarde alguns segundos e tente novamente.",
        "AI_RATE_LIMITED"
      );
    }
    console.error("Gemini invoice scan HTTP", response.status, apiMessage || payloadText.slice(0, 400));
    throw buildHttpError(
      502,
      `Falha na leitura da fatura (HTTP ${response.status}). Tente novamente.`,
      "AI_REQUEST_FAILED"
    );
  }

  const candidate = payload?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const text = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
  const parsed = extractJsonBlock(text);
  if (!parsed) {
    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
      throw buildHttpError(
        422,
        "O documento foi bloqueado pelo filtro de segurança da IA. Introduza os dados manualmente.",
        "AI_BLOCKED"
      );
    }
    throw buildHttpError(
      422,
      "A IA não conseguiu ler os dados da fatura. Tente uma digitalização de melhor qualidade ou introduza os valores manualmente.",
      "AI_UNREADABLE"
    );
  }

  const grossAmount = round2(parseNumberValue(parsed.grossAmount));
  const vatAmount = round2(parseNumberValue(parsed.vatAmount));
  const vatPercent = clampPercent(parsed.vatPercent);
  const withholdingAmount = round2(parseNumberValue(parsed.withholdingAmount));
  const withholdingPercent = clampPercent(parsed.withholdingPercent);
  const carInsuranceAmount = round2(parseNumberValue(parsed.carInsuranceAmount));
  const guaranteeAmount = round2(parseNumberValue(parsed.guaranteeAmount));
  const netAmount = round2(parseNumberValue(parsed.netAmount));

  const docDate = parseDateValue(parsed.docDate);
  const dueDate = parseDateValue(parsed.dueDate);

  const suggestedProject = matchProject(projects, parsed.projectHint);

  return {
    documentType: cleanText(parsed.documentType, 40) || "OUTRO",
    docNumber: cleanText(parsed.docNumber, 60),
    docDate: dateToKey(docDate),
    dueDate: dateToKey(dueDate),
    grossAmount,
    vatAmount,
    vatPercent,
    withholdingAmount,
    withholdingPercent,
    carInsuranceAmount,
    guaranteeAmount,
    netAmount,
    currency: cleanText(parsed.currency, 8) || "AOA",
    supplierName: cleanText(parsed.supplierName, 120),
    supplierNif: cleanText(parsed.supplierNif, 30),
    clientName: cleanText(parsed.clientName, 120),
    clientNif: cleanText(parsed.clientNif, 30),
    projectHint: cleanText(parsed.projectHint, 120),
    suggestedProjectId: suggestedProject?.id || null,
    suggestedProjectLabel: suggestedProject ? `${suggestedProject.code || ""} — ${suggestedProject.name}`.trim() : null,
    description: cleanText(parsed.description, 400),
    notes: cleanText(parsed.notes, 800),
    confidence: normalizeConfidence(parsed.confidence),
    model: config.ai.geminiModel,
    raw: parsed,
  };
}

module.exports = {
  isConfigured,
  readInvoiceDocument,
  normalizeMimeType,
  parseDateValue,
  parseNumberValue,
  matchProject,
  SUPPORTED_MIME_TYPES,
  MAX_INLINE_BYTES,
};
