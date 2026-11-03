const { config } = require("../config");

/**
 * Leitura automática de faturas, proformas e cotações com o Google Gemini.
 *
 * Carrega o PDF/imagem do documento e a IA devolve os campos estruturados
 * (nº do documento, datas, valores, IVA, retenção, descontos, fornecedor,
 * obra provável, centro de custo / categoria sugerida e linhas/itens detalhados).
 * Nada é gravado aqui — o serviço apenas lê o documento.
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
const GEMINI_PER_MODEL_TIMEOUT_MS = 90_000;
const GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-3.6-flash"];

const CATEGORY_ENUM = [
  "MATERIAIS_INSUMOS",
  "SERVICOS_MAO_DE_OBRA",
  "EQUIPAMENTO",
  "TRANSPORTE",
  "GASTOS_PESSOAL",
  "DESPESAS_OPERACIONAIS",
  "INVESTIMENTOS",
  "IMPOSTOS",
  "OUTRAS_DESPESAS",
];

const CategoryKeySet = new Set(CATEGORY_ENUM);

const INVOICE_CATEGORY_META = {
  MATERIAIS_INSUMOS: {
    key: "MATERIAIS_INSUMOS",
    code: "MAT",
    name: "Materiais e Insumos",
    cbsCategory: "MATERIAIS_INSUMOS",
  },
  SERVICOS_MAO_DE_OBRA: {
    key: "SERVICOS_MAO_DE_OBRA",
    code: "MDO",
    name: "Serviços e Mão de Obra",
    cbsCategory: "SERVICOS_MAO_DE_OBRA",
  },
  EQUIPAMENTO: {
    key: "EQUIPAMENTO",
    code: "EQP",
    name: "Equipamentos e Ferramentas",
    cbsCategory: "DESPESAS_OPERACIONAIS",
  },
  TRANSPORTE: {
    key: "TRANSPORTE",
    code: "TRP",
    name: "Transporte e Logística",
    cbsCategory: "DESPESAS_OPERACIONAIS",
  },
  GASTOS_PESSOAL: {
    key: "GASTOS_PESSOAL",
    code: "PES",
    name: "Gastos com Pessoal",
    cbsCategory: "GASTOS_PESSOAL",
  },
  DESPESAS_OPERACIONAIS: {
    key: "DESPESAS_OPERACIONAIS",
    code: "OPE",
    name: "Despesas Operacionais",
    cbsCategory: "DESPESAS_OPERACIONAIS",
  },
  INVESTIMENTOS: {
    key: "INVESTIMENTOS",
    code: "INV",
    name: "Investimentos",
    cbsCategory: "INVESTIMENTOS",
  },
  IMPOSTOS: {
    key: "IMPOSTOS",
    code: "IMP",
    name: "Impostos e Taxas",
    cbsCategory: "IMPOSTOS",
  },
  OUTRAS_DESPESAS: {
    key: "OUTRAS_DESPESAS",
    code: "OUT",
    name: "Outras Despesas",
    cbsCategory: "DESPESAS_OPERACIONAIS",
  },
};

function inferCostCategoryFromText(rawText, fallback = "MATERIAIS_INSUMOS") {
  const upper = String(rawText || "").toUpperCase().trim();
  if (CategoryKeySet.has(upper)) return upper;

  const t = String(rawText || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!t) return INVOICE_CATEGORY_META[fallback] ? fallback : "MATERIAIS_INSUMOS";

  if (
    /(mao de obra|subempreitad|empreitad|servic|instalac|montagem|manutenc|reparac|consultor|projecto|projeto|fiscalizac|ensaio|topograf|carpintari|serralhari|pintura|canalizac|electricist|pedreiro)/.test(
      t
    )
  ) {
    return "SERVICOS_MAO_DE_OBRA";
  }
  if (
    /(aluguer|equipament|maquin|gerador|grua|betoneir|andaim|ferrament|escavador|retroescavador|compactador|martelo|compressor|bomba de betao)/.test(
      t
    )
  ) {
    return "EQUIPAMENTO";
  }
  if (
    /(transport|frete|logistic|combustiv|gasoleo|gasolina|deslocac|viatura|camiao|reboque|portagem)/.test(
      t
    )
  ) {
    return "TRANSPORTE";
  }
  if (
    /(pessoal|salari|ordenad|alimentac|refeic|fardament|epi|bota|capacete|seguro de trabalho|subsidi)/.test(
      t
    )
  ) {
    return "GASTOS_PESSOAL";
  }
  if (/(impost|taxa|licenc|iva|irt|inss|aduaneir|alfandeg|emolument)/.test(t)) {
    return "IMPOSTOS";
  }
  if (/(investiment|aquisicao de viatura|imovel|terreno|activo fixo|ativo fixo)/.test(t)) {
    return "INVESTIMENTOS";
  }
  if (
    /(operacion|agua|energia|electricidad|internet|comunicac|expedient|limpez|seguranc|vigilanc|escritorio|consumiveis de escritorio|renda|alojamento)/.test(
      t
    )
  ) {
    return "DESPESAS_OPERACIONAIS";
  }
  if (
    /(material|materiais|insumo|cimento|ferro|aco|areia|brita|tijolo|bloco|tinta|tubo|cabo|madeira|ceramica|telha|gesso|argamassa|parafuso|valvula|bomba|disjuntor|quadro|lampada|vidro|aluminio|pvc|betum|impermeabiliz)/.test(
      t
    )
  ) {
    return "MATERIAIS_INSUMOS";
  }
  return INVOICE_CATEGORY_META[fallback] ? fallback : "MATERIAIS_INSUMOS";
}

// Schema enxuto para evitar atraso de compilação de gramática no Gemini
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
    grossAmount: { type: ["number", "null"] },
    discountAmount: { type: ["number", "null"] },
    discountPercent: { type: ["number", "null"] },
    vatAmount: { type: ["number", "null"] },
    vatPercent: { type: ["number", "null"] },
    withholdingAmount: { type: ["number", "null"] },
    withholdingPercent: { type: ["number", "null"] },
    carInsuranceAmount: { type: ["number", "null"] },
    guaranteeAmount: { type: ["number", "null"] },
    netAmount: { type: ["number", "null"] },
    currency: { type: "string" },
    supplierName: { type: "string" },
    supplierNif: { type: "string" },
    supplierPhone: { type: "string" },
    supplierEmail: { type: "string" },
    supplierIban: { type: "string" },
    clientName: { type: "string" },
    clientNif: { type: "string" },
    projectHint: { type: "string" },
    suggestedCategory: { type: "string" },
    description: { type: "string" },
    notes: { type: "string" },
    confidence: { type: ["number", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          unit: { type: "string" },
          quantity: { type: ["number", "null"] },
          unitPrice: { type: ["number", "null"] },
          total: { type: ["number", "null"] },
          costCenterHint: { type: "string" },
        },
        required: ["description", "unit", "quantity", "unitPrice", "total", "costCenterHint"],
      },
    },
  },
  required: [
    "documentType",
    "docNumber",
    "docDate",
    "dueDate",
    "grossAmount",
    "vatAmount",
    "vatPercent",
    "withholdingAmount",
    "withholdingPercent",
    "netAmount",
    "currency",
    "supplierName",
    "supplierNif",
    "projectHint",
    "description",
    "notes",
    "confidence",
    "items",
  ],
};

const INSTRUCTION = `És um assistente de contabilidade e orçamentação de construção civil em Angola.
Recebes o PDF ou imagem de uma fatura, proforma ou cotação e devolves APENAS um JSON com os dados lidos.

Regras:
- Valores sempre em número (1234.56), sem símbolos de moeda.
- Datas no formato AAAA-MM-DD (ou string vazia se não existir).
- "grossAmount": valor ilíquido (base tributável SEM IVA).
- "vatAmount" / "vatPercent": valor e taxa do IVA (ex.: 14).
- "withholdingAmount" / "withholdingPercent": retenção na fonte, quando existir.
- "discountAmount" / "discountPercent": desconto global, quando existir.
- "netAmount": valor total a pagar indicado no documento.
- "supplierName" / "supplierNif": nome e NIF do fornecedor emitente.
- "items": lista de linhas/artigos discriminados no documento (até 40 itens):
  - "description": designação do material/serviço.
  - "unit": unidade ("un", "m2", "m3", "kg", "saco", "vg", "h", "m").
  - "quantity": quantidade numérica (1 se não explícita).
  - "unitPrice": preço unitário sem IVA.
  - "total": subtotal ilíquido da linha.
  - "costCenterHint": código do Centro de Custo da obra mais adequado (se a lista de Centros de Custo foi indicada) ou categoria (MATERIAIS_INSUMOS, SERVICOS_MAO_DE_OBRA, EQUIPAMENTO, TRANSPORTE, GASTOS_PESSOAL, DESPESAS_OPERACIONAIS).
- Se um campo não existir, devolve string vazia (texto) ou null (números).`;

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

function translateInvoiceNote(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (/^VAT assumed to be 0 as no VAT details were provided and subtotal equals total\.?$/i.test(text)) {
    return "IVA considerado 0, pois não foram indicados detalhes de IVA e o subtotal é igual ao total.";
  }
  return text;
}

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

function normalizeInvoiceItems(rawItems, fallbackContext = {}) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  const defaultCategory = inferCostCategoryFromText(
    fallbackContext.suggestedCategory || fallbackContext.description || "",
    "MATERIAIS_INSUMOS"
  );
  const normalized = [];

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const description = cleanText(raw.description, 300);
    const qtyRaw = parseNumberValue(raw.quantity);
    const quantity = qtyRaw && qtyRaw > 0 ? round2(qtyRaw) : 1;
    let unitPrice = round2(parseNumberValue(raw.unitPrice));
    let total = round2(parseNumberValue(raw.total));
    const discountPercent = clampPercent(raw.discountPercent) ?? fallbackContext.discountPercent ?? 0;
    const vatPercent = clampPercent(raw.vatPercent) ?? fallbackContext.vatPercent ?? null;

    if (unitPrice === null && total !== null && quantity > 0) {
      unitPrice = round2(total / quantity);
    }
    if (total === null && unitPrice !== null) {
      const discFactor = discountPercent ? Math.max(0, 1 - discountPercent / 100) : 1;
      total = round2(quantity * unitPrice * discFactor);
    }
    if (!description && total === null && unitPrice === null) continue;

    const hintStr = cleanText(raw.costCenterHint, 80) || "";
    const categoryKey = inferCostCategoryFromText(
      raw.category || (CategoryKeySet.has(hintStr.toUpperCase()) ? hintStr : description),
      defaultCategory
    );
    const catMeta = INVOICE_CATEGORY_META[categoryKey] || INVOICE_CATEGORY_META.MATERIAIS_INSUMOS;

    normalized.push({
      description: description || "Artigo / Serviço de Fatura",
      unit: cleanText(raw.unit, 20) || "un",
      quantity,
      unitPrice: unitPrice ?? 0,
      discountPercent,
      vatPercent,
      total: total ?? round2(quantity * (unitPrice ?? 0)) ?? 0,
      category: catMeta.key,
      categoryCode: catMeta.code,
      categoryName: catMeta.name,
      cbsCategory: catMeta.cbsCategory,
      costCenterHint: hintStr || null,
    });
  }

  if (!normalized.length) {
    const baseTotal = fallbackContext.grossAmount ?? fallbackContext.netAmount ?? null;
    if (baseTotal !== null && baseTotal > 0) {
      const catMeta =
        INVOICE_CATEGORY_META[defaultCategory] || INVOICE_CATEGORY_META.MATERIAIS_INSUMOS;
      normalized.push({
        description:
          fallbackContext.description ||
          (fallbackContext.supplierName
            ? `Fornecimento / Serviço — ${fallbackContext.supplierName}`
            : "Item de Fatura / Cotação"),
        unit: "vg",
        quantity: 1,
        unitPrice: baseTotal,
        discountPercent: fallbackContext.discountPercent ?? 0,
        vatPercent: fallbackContext.vatPercent ?? null,
        total: baseTotal,
        category: catMeta.key,
        categoryCode: catMeta.code,
        categoryName: catMeta.name,
        cbsCategory: catMeta.cbsCategory,
        costCenterHint: null,
      });
    }
  }

  return normalized;
}

function buildThinkingConfigForModel(modelName) {
  const m = String(modelName || "").toLowerCase();
  if (m.includes("gemini-3")) {
    return { thinkingLevel: "MINIMAL" };
  }
  if (m.includes("gemini-2.5")) {
    return { thinkingBudget: 0 };
  }
  return undefined;
}

async function callGemini({ mimeType, base64Data, projects, costCenters = [] }) {
  const baseUrl = config.ai.geminiBaseUrl.replace(/\/$/, "");

  const projectList = (projects || [])
    .slice(0, 80)
    .map((p) => `- ${p.code || "—"} | ${p.name}`)
    .join("\n");
  const ccList = (costCenters || [])
    .map((cc) => `- ${cc.code} | ${cc.name}`)
    .join("\n");

  const promptParts = [INSTRUCTION];
  if (ccList) {
    promptParts.push(
      `Centros de Custo (Categorias) desta obra (indica o código mais adequado em "costCenterHint" de cada item):\n${ccList}`
    );
  }
  if (projectList) {
    promptParts.push(
      `Obras existentes no sistema (usa a mais provável em "projectHint"):\n${projectList}`
    );
  }

  const models = [...new Set([config.ai.geminiModel, ...GEMINI_FALLBACK_MODELS])];
  let lastResult = null;
  let lastError = null;

  for (const [index, model] of models.entries()) {
    const thinkingConfig = buildThinkingConfigForModel(model);
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
        ...(thinkingConfig ? { thinkingConfig } : {}),
        responseFormat: {
          text: {
            mimeType: "APPLICATION_JSON",
            schema: RESPONSE_SCHEMA,
          },
        },
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_PER_MODEL_TIMEOUT_MS);
    try {
      const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
      const response = await fetch(`${url}?key=${encodeURIComponent(config.ai.geminiApiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payloadText = await response.text();
      lastResult = { response, payloadText, model };

      if (response.ok) {
        return lastResult;
      }

      // Se o modelo rejeitar thinkingConfig ou estiver sobrecarregado (503/429/404), tenta o próximo modelo
      if (
        (response.status === 503 || response.status === 429 || response.status === 404 || response.status === 400) &&
        index < models.length - 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      return lastResult;
    } catch (err) {
      lastError = err;
      // Se excedeu o tempo neste modelo e há outro modelo de fallback (ex.: gemini-2.5-flash), tenta o próximo
      if (index < models.length - 1) {
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastResult) return lastResult;
  throw lastError || new Error("Gemini request failed");
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
 * @param {{ buffer: Buffer, mimeType: string, fileName?: string, projects?: Array, costCenters?: Array }} input
 */
async function readInvoiceDocument({ buffer, mimeType, fileName, projects = [], costCenters = [] }) {
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
  let payloadText;
  let model = config.ai.geminiModel;
  try {
    const result = await callGemini({
      mimeType: resolvedMime,
      base64Data: buffer.toString("base64"),
      projects,
      costCenters,
    });
    response = result.response;
    payloadText = result.payloadText;
    model = result.model;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw buildHttpError(
        504,
        "A leitura da fatura excedeu o tempo limite. Tente novamente com uma imagem mais pequena ou uma digitalização mais leve.",
        "AI_TIMEOUT"
      );
    }
    console.error("Gemini invoice scan failed:", error);
    throw buildHttpError(
      503,
      "Não foi possível contactar o serviço de leitura de faturas. Verifique a ligação à internet e tente novamente.",
      "AI_UNAVAILABLE"
    );
  }

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
    if (response.status === 503) {
      throw buildHttpError(
        503,
        "Os modelos Gemini estão temporariamente sobrecarregados. Foram tentados modelos alternativos; aguarde um pouco e tente novamente.",
        "AI_TEMPORARILY_BUSY"
      );
    }
    throw buildHttpError(
      502,
      response.status === 400
        ? `O Gemini rejeitou a configuração da leitura (HTTP 400): ${apiMessage || "pedido inválido"}`
        : `Falha na leitura da fatura (HTTP ${response.status}). Tente novamente.`,
      "AI_REQUEST_FAILED"
    );
  }

  const candidate = payload?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const text = (candidate?.content?.parts || []).map((p) => p.text || "").filter(Boolean).join("");
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = extractJsonBlock(text);
  }
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
  const discountAmount = round2(parseNumberValue(parsed.discountAmount));
  const discountPercent = clampPercent(parsed.discountPercent);
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
  const description = cleanText(parsed.description, 400);
  const supplierName = cleanText(parsed.supplierName, 120);
  const suggestedCategory = inferCostCategoryFromText(
    parsed.suggestedCategory || description || "",
    "MATERIAIS_INSUMOS"
  );
  const categoryMeta =
    INVOICE_CATEGORY_META[suggestedCategory] || INVOICE_CATEGORY_META.MATERIAIS_INSUMOS;

  const items = normalizeInvoiceItems(parsed.items, {
    grossAmount,
    netAmount,
    vatPercent,
    discountPercent,
    description,
    supplierName,
    suggestedCategory,
  });

  return {
    documentType: cleanText(parsed.documentType, 40) || "OUTRO",
    docNumber: cleanText(parsed.docNumber, 60),
    docDate: dateToKey(docDate),
    dueDate: dateToKey(dueDate),
    grossAmount,
    discountAmount,
    discountPercent,
    vatAmount,
    vatPercent,
    withholdingAmount,
    withholdingPercent,
    carInsuranceAmount,
    guaranteeAmount,
    netAmount,
    currency: cleanText(parsed.currency, 8) || "AOA",
    supplierName,
    supplierNif: cleanText(parsed.supplierNif, 30),
    supplierPhone: cleanText(parsed.supplierPhone, 40),
    supplierEmail: cleanText(parsed.supplierEmail, 120),
    supplierIban: cleanText(parsed.supplierIban, 50),
    clientName: cleanText(parsed.clientName, 120),
    clientNif: cleanText(parsed.clientNif, 30),
    projectHint: cleanText(parsed.projectHint, 120),
    suggestedProjectId: suggestedProject?.id || null,
    suggestedProjectLabel: suggestedProject ? `${suggestedProject.code || ""} — ${suggestedProject.name}`.trim() : null,
    suggestedCategory: categoryMeta.key,
    suggestedCategoryCode: categoryMeta.code,
    suggestedCategoryName: categoryMeta.name,
    description,
    notes: cleanText(translateInvoiceNote(parsed.notes), 800),
    confidence: normalizeConfidence(parsed.confidence),
    items,
    model,
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
  inferCostCategoryFromText,
  INVOICE_CATEGORY_META,
  CATEGORY_ENUM,
  SUPPORTED_MIME_TYPES,
  MAX_INLINE_BYTES,
};
