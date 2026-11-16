const { prisma } = require("../../db");
const { config } = require("../../config");
const { wrapSecret, unwrapSecret } = require("../backup/crypto");
const { getProvider } = require("./providers");
const {
  FEATURES,
  DATA_CATEGORIES,
  DIGEST_TYPES,
  RECIPIENT_GROUPS,
  defaultFeatures,
  defaultCategories,
} = require("./catalog");

/**
 * Definições da IA geridas na Gestão do Sistema.
 *
 * - Linha única `AiSettings` ("default"). Enquanto o admin nunca gravou nada,
 *   valem os valores por omissão + o GEMINI_API_KEY/GEMINI_MODEL do .env,
 *   para a leitura de faturas continuar a funcionar como antes.
 * - A chave de API é guardada cifrada e nunca é devolvida ao browser.
 */

const SETTINGS_ID = "default";
const CACHE_MS = 30_000;
let cache = null;
let cacheAt = 0;

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mergeFeatures(stored) {
  const base = defaultFeatures();
  const src = stored && typeof stored === "object" ? stored : {};
  for (const f of FEATURES) if (typeof src[f.key] === "boolean") base[f.key] = src[f.key];
  return base;
}

function mergeCategories(stored) {
  const base = defaultCategories();
  const src = stored && typeof stored === "object" ? stored : {};
  for (const c of DATA_CATEGORIES) {
    const mode = src[c.key];
    if (mode === "off" || mode === "on" || (mode === "anonymize" && c.anonymizable)) base[c.key] = mode;
  }
  return base;
}

function defaultsRow() {
  return {
    id: SETTINGS_ID,
    enabled: true,
    provider: "gemini",
    model: config.ai.geminiModel,
    fallbackModels: [],
    baseUrl: null,
    apiKeyWrapped: null,
    features: {},
    dataCategories: {},
    monthlyBudget: null,
    budgetCurrency: "USD",
    inputPricePerMTok: null,
    outputPricePerMTok: null,
    dailyRequestsPerUser: 50,
    budgetAlertMonth: null,
    updatedAt: null,
    updatedById: null,
    persisted: false,
  };
}

/** Definições normalizadas (com cache curta). Inclui a chave cifrada — uso interno. */
async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const row = await prisma.aiSettings.findUnique({ where: { id: SETTINGS_ID } });
  const src = row ? { ...row, persisted: true } : defaultsRow();
  cache = {
    ...src,
    fallbackModels: Array.isArray(src.fallbackModels) ? src.fallbackModels.filter(Boolean) : [],
    features: mergeFeatures(src.features),
    dataCategories: mergeCategories(src.dataCategories),
    monthlyBudget: toNumber(src.monthlyBudget),
    inputPricePerMTok: toNumber(src.inputPricePerMTok),
    outputPricePerMTok: toNumber(src.outputPricePerMTok),
  };
  cacheAt = Date.now();
  return cache;
}

/** Devolve a chave em claro: a guardada, ou a do .env para o Gemini. */
function resolveApiKey(settings) {
  if (settings.apiKeyWrapped) {
    try {
      return { apiKey: unwrapSecret(settings.apiKeyWrapped, config.jwtSecret), source: "stored" };
    } catch {
      return { apiKey: null, source: "unreadable" };
    }
  }
  // A chave do .env só é usada com o endereço oficial do Gemini (ou o do .env).
  const officialBase = !settings.baseUrl || settings.baseUrl.replace(/\/$/, "") === config.ai.geminiBaseUrl.replace(/\/$/, "");
  if (settings.provider === "gemini" && config.ai.geminiApiKey && officialBase) {
    return { apiKey: config.ai.geminiApiKey, source: "env" };
  }
  return { apiKey: null, source: "none" };
}

/** Configuração pronta a usar pelo cliente de IA (fornecedor ativo). */
async function resolveProviderConfig() {
  const settings = await getSettings();
  const provider = getProvider(settings.provider);
  const { apiKey, source } = resolveApiKey(settings);
  return {
    settings,
    provider,
    apiKey,
    keySource: source,
    baseUrl: settings.baseUrl || provider?.defaultBaseUrl || null,
    models: [
      ...new Set(
        [
          settings.model,
          ...(settings.fallbackModels.length ? settings.fallbackModels : provider?.defaultFallbackModels || []),
        ].filter(Boolean)
      ),
    ],
  };
}

async function isFeatureEnabled(feature) {
  const settings = await getSettings();
  return Boolean(settings.enabled && settings.features[feature]);
}

async function getCategoryMode(category) {
  const settings = await getSettings();
  return settings.dataCategories[category] || "off";
}

async function getExcludedProjectIds() {
  const rows = await prisma.aiDataExclusion.findMany({ select: { projectId: true } });
  return rows.map((r) => r.projectId);
}

/**
 * Configuração para a leitura de faturas (precisa de Gemini: envia PDFs/imagens).
 * Devolve `{ available, reason, apiKey, model, baseUrl, fallbackModels }`.
 * Sem configuração gravada, comporta-se como antes (só .env).
 */
async function resolveInvoiceAiConfig() {
  let settings;
  try {
    settings = await getSettings();
  } catch (error) {
    // Base de dados indisponível: não bloqueia a leitura se o .env tiver chave.
    console.warn("[ai] definições indisponíveis, a usar o .env:", error.message);
    settings = { ...defaultsRow(), features: defaultFeatures(), dataCategories: defaultCategories() };
  }

  if (!settings.enabled) return { available: false, reason: "A IA está desligada na Gestão do Sistema." };
  if (!settings.features.invoice_scan) {
    return { available: false, reason: "A leitura de faturas com IA está desligada na Gestão do Sistema." };
  }
  if (settings.dataCategories.documents === "off") {
    return {
      available: false,
      reason: "O envio de documentos e faturas à IA está desligado na Gestão do Sistema.",
    };
  }

  // A leitura usa sempre o Gemini (aceita PDF/imagem inline). Se o fornecedor
  // ativo for outro, usa a chave Gemini do .env como reserva.
  if (settings.provider === "gemini") {
    const { apiKey, source } = resolveApiKey(settings);
    if (!apiKey) {
      return {
        available: false,
        reason:
          source === "unreadable"
            ? "A chave de IA guardada não pode ser lida (o JWT_SECRET mudou?). Volte a introduzi-la na Gestão do Sistema."
            : "Falta configurar a chave do Gemini na Gestão do Sistema (ou GEMINI_API_KEY no .env).",
      };
    }
    return {
      available: true,
      excludedProjectIds: await getExcludedProjectIds().catch(() => []),
      apiKey,
      model: settings.model || config.ai.geminiModel,
      baseUrl: settings.baseUrl || config.ai.geminiBaseUrl,
      fallbackModels: settings.fallbackModels,
      provider: "gemini",
    };
  }
  if (config.ai.geminiApiKey) {
    return {
      available: true,
      excludedProjectIds: await getExcludedProjectIds().catch(() => []),
      apiKey: config.ai.geminiApiKey,
      model: config.ai.geminiModel,
      baseUrl: config.ai.geminiBaseUrl,
      fallbackModels: [],
      provider: "gemini",
    };
  }
  return {
    available: false,
    reason: "A leitura de faturas precisa do Gemini. Escolha o Gemini como fornecedor ou defina GEMINI_API_KEY no .env.",
  };
}

// ── Vista e alterações do administrador ─────────────────────────────────────

function keyHint(apiKey) {
  if (!apiKey) return null;
  const tail = String(apiKey).slice(-4);
  return `••••${tail}`;
}

/** Definições para o ecrã de gestão: nunca inclui a chave, só uma pista. */
async function getAdminView() {
  const settings = await getSettings({ fresh: true });
  const { apiKey, source } = resolveApiKey(settings);
  const [exclusions, rules] = await Promise.all([
    prisma.aiDataExclusion.findMany({
      include: { project: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.digestRecipientRule.findMany(),
  ]);

  return {
    enabled: settings.enabled,
    provider: settings.provider,
    model: settings.model,
    fallbackModels: settings.fallbackModels,
    baseUrl: settings.baseUrl,
    apiKey: { configured: Boolean(apiKey), source, hint: source === "stored" ? keyHint(apiKey) : null },
    features: settings.features,
    dataCategories: settings.dataCategories,
    monthlyBudget: settings.monthlyBudget,
    budgetCurrency: settings.budgetCurrency,
    inputPricePerMTok: settings.inputPricePerMTok,
    outputPricePerMTok: settings.outputPricePerMTok,
    dailyRequestsPerUser: settings.dailyRequestsPerUser,
    updatedAt: settings.updatedAt,
    persisted: settings.persisted,
    excludedProjects: exclusions.map((e) => e.project).filter(Boolean),
    recipientRules: buildRuleMatrix(rules),
  };
}

/** Todas as combinações tipo × grupo, preenchidas com o que estiver gravado. */
function buildRuleMatrix(rows) {
  const byKey = new Map(rows.map((r) => [`${r.digestType}:${r.group}`, r]));
  const out = [];
  for (const d of DIGEST_TYPES) {
    for (const g of RECIPIENT_GROUPS) {
      const row = byKey.get(`${d.key}:${g.key}`);
      out.push({
        digestType: d.key,
        group: g.key,
        enabled: row ? row.enabled : false,
        channels: Array.isArray(row?.channels) ? row.channels : ["in_app"],
        content: row?.content || g.defaultContent,
        sendTime: row?.sendTime || (d.key === "WEEKLY_SUMMARY" ? "08:00" : "07:30"),
        userIds: Array.isArray(row?.userIds) ? row.userIds : [],
        projectIds: Array.isArray(row?.projectIds) ? row.projectIds : [],
      });
    }
  }
  return out;
}

/**
 * Grava as definições (dados já validados pela rota).
 * `apiKey`: string nova → cifra e guarda; `null` → apaga a guardada; ausente → mantém.
 */
async function updateSettings(data, actorId) {
  const {
    apiKey,
    excludedProjectIds,
    recipientRules,
    features,
    dataCategories,
    ...scalars
  } = data;

  const current = await getSettings({ fresh: true });
  const patch = { ...scalars, updatedById: actorId || null };
  if (features) patch.features = { ...current.features, ...features };
  if (dataCategories) patch.dataCategories = mergeCategories({ ...current.dataCategories, ...dataCategories });
  if (apiKey === null) patch.apiKeyWrapped = null;
  else if (typeof apiKey === "string" && apiKey.trim()) patch.apiKeyWrapped = wrapSecret(apiKey.trim(), config.jwtSecret);

  await prisma.$transaction(async (tx) => {
    await tx.aiSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        enabled: current.enabled,
        provider: current.provider,
        model: current.model,
        fallbackModels: current.fallbackModels,
        features: current.features,
        dataCategories: current.dataCategories,
        ...patch,
      },
      update: patch,
    });

    if (Array.isArray(excludedProjectIds)) {
      await tx.aiDataExclusion.deleteMany({ where: { projectId: { notIn: excludedProjectIds } } });
      for (const projectId of excludedProjectIds) {
        await tx.aiDataExclusion.upsert({
          where: { projectId },
          create: { projectId, createdById: actorId || null },
          update: {},
        });
      }
    }

    if (Array.isArray(recipientRules)) {
      for (const rule of recipientRules) {
        const { digestType, group, ...rest } = rule;
        await tx.digestRecipientRule.upsert({
          where: { digestType_group: { digestType, group } },
          create: { digestType, group, ...rest },
          update: rest,
        });
      }
    }
  });

  invalidateCache();
  return getAdminView();
}

module.exports = {
  getSettings,
  invalidateCache,
  resolveProviderConfig,
  resolveInvoiceAiConfig,
  isFeatureEnabled,
  getCategoryMode,
  getExcludedProjectIds,
  getAdminView,
  updateSettings,
  resolveApiKey,
};
