const { resolveProviderConfig, getExcludedProjectIds } = require("./settingsService");
const { checkQuota, logRequest } = require("./usageService");

/**
 * Cliente de IA único para todas as funcionalidades novas (assistente,
 * resumos, alertas…). Aplica, por esta ordem:
 *   1. IA ligada + funcionalidade ligada na Gestão do Sistema;
 *   2. categorias de dados permitidas (nenhuma "off") e obras não excluídas;
 *   3. limites (diário por utilizador, orçamento mensal);
 * e depois chama o fornecedor ativo, tentando os modelos de recurso, e
 * regista o pedido (o que foi enviado, tokens, custo).
 *
 * A anonimização ("anonymize") é responsabilidade de quem monta o prompt:
 * `getCategoryMode()` diz o modo de cada categoria.
 */

class AiUnavailableError extends Error {
  constructor(message, code = "AI_UNAVAILABLE", status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.feature - chave do catálogo (ex.: "assistant")
 * @param {string} [opts.userId]
 * @param {string[]} [opts.categories] - categorias de dados incluídas no prompt
 * @param {string[]} [opts.projectIds] - obras incluídas no prompt
 * @param {string} [opts.system]
 * @param {string} opts.prompt
 * @param {boolean} [opts.json]
 * @param {number} [opts.maxOutputTokens]
 * @param {import("socket.io").Server} [opts.io] - para o aviso de orçamento
 */
/**
 * Verifica as regras (IA/funcionalidade ligada, fornecedor, chave, categorias,
 * obras excluídas, limites) e devolve a configuração pronta a usar.
 * Lança AiUnavailableError (e regista o bloqueio) se algo falhar.
 */
async function prepare({ feature, userId, categories = [], projectIds = [], io }) {
  const cfg = await resolveProviderConfig();
  const { settings, provider } = cfg;
  const blocked = (message, code, status = 503) => {
    logRequest({ userId, feature, provider: settings.provider, categories, projectIds, status: "BLOCKED", errorMessage: message, io });
    return new AiUnavailableError(message, code, status);
  };

  if (!settings.enabled) throw blocked("A IA está desligada na Gestão do Sistema.", "AI_DISABLED");
  if (!settings.features[feature]) throw blocked("Esta funcionalidade de IA está desligada na Gestão do Sistema.", "AI_FEATURE_DISABLED");
  if (!provider) throw blocked(`Fornecedor de IA desconhecido: ${settings.provider}.`, "AI_PROVIDER_UNKNOWN");
  if (!cfg.apiKey && settings.provider !== "openai_compatible") {
    throw blocked("Falta configurar a chave do fornecedor de IA na Gestão do Sistema.", "AI_NOT_CONFIGURED");
  }

  const offCategories = categories.filter((c) => (settings.dataCategories[c] || "off") === "off");
  if (offCategories.length) {
    throw blocked(`Envio de dados não autorizado na Gestão do Sistema: ${offCategories.join(", ")}.`, "AI_CATEGORY_BLOCKED");
  }
  if (projectIds.length) {
    const excluded = new Set(await getExcludedProjectIds());
    if (projectIds.some((id) => excluded.has(id))) {
      throw blocked("Uma das obras está excluída do envio à IA.", "AI_PROJECT_EXCLUDED");
    }
  }

  const quota = await checkQuota(userId);
  if (!quota.ok) throw blocked(quota.reason, "AI_QUOTA", 429);
  return cfg;
}

/** Chama o fornecedor tentando os modelos de recurso. Não regista (quem chama regista). */
const RETRY_DELAYS_MS = [1_000, 3_000];
const BUSY_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Modelos indisponíveis há pouco (sobrecarga, sem resposta, quota esgotada):
 * são saltados até a pausa acabar, para não fazer o utilizador esperar por
 * eles em cada pedido nem em cada ronda de ferramentas.
 */
const cooldowns = new Map(); // `${provider}:${model}` -> timestamp até quando saltar

function coolDown(cfg, model, ms) {
  cooldowns.set(`${cfg.provider.id}:${model}`, Date.now() + Math.min(ms, MAX_COOLDOWN_MS));
}

function orderedModels(cfg) {
  const now = Date.now();
  const ready = cfg.models.filter((m) => (cooldowns.get(`${cfg.provider.id}:${m}`) || 0) <= now);
  const cooling = cfg.models.filter((m) => !ready.includes(m));
  // Se todos estão em pausa, tenta-os na mesma (pela ordem configurada).
  return ready.length ? ready : cooling;
}

async function callWithFallback(cfg, method, payload, { retryDelays = RETRY_DELAYS_MS } = {}) {
  let lastError = null;
  const models = orderedModels(cfg);
  models: for (const [index, model] of models.entries()) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await cfg.provider[method]({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model, ...payload });
        cooldowns.delete(`${cfg.provider.id}:${model}`);
        return { ...result, model };
      } catch (error) {
        lastError = error;
        const firstLine = String(error.providerMessage || error.message).split(/\r?\n/)[0];
        console.warn(`[ai] ${model} falhou (${error.status || error.code}): ${firstLine}`);
        // Sobrecarga/limite momentâneo: repete o mesmo modelo com pausa crescente.
        if (error.transient && attempt < retryDelays.length) {
          await sleep(retryDelays[attempt]);
          continue;
        }
        if (error.code === "AI_QUOTA_EXCEEDED") coolDown(cfg, model, error.retryAfterMs || 60 * 60 * 1000);
        else if (error.transient || error.code === "AI_TIMEOUT" || error.code === "AI_UNREACHABLE") coolDown(cfg, model, BUSY_COOLDOWN_MS);
        if (!error.retryable || index === models.length - 1) break models;
        break;
      }
    }
  }
  const err = new AiUnavailableError(lastError?.message || "Falha no pedido à IA.", lastError?.code || "AI_REQUEST_FAILED", 502);
  err.model = models[models.length - 1];
  throw err;
}

/**
 * @param {object} opts
 * @param {string} opts.feature - chave do catálogo (ex.: "digests")
 * @param {string} [opts.userId]
 * @param {string[]} [opts.categories] - categorias de dados incluídas no prompt
 * @param {string[]} [opts.projectIds] - obras incluídas no prompt
 * @param {string} [opts.system]
 * @param {string} opts.prompt
 * @param {boolean} [opts.json]
 * @param {number} [opts.maxOutputTokens]
 * @param {import("socket.io").Server} [opts.io] - para o aviso de orçamento
 */
async function generate({
  feature,
  userId,
  categories = [],
  projectIds = [],
  system,
  prompt,
  json = false,
  maxOutputTokens,
  timeoutMs = 60_000,
  attachments = [],
  io,
}) {
  const cfg = await prepare({ feature, userId, categories, projectIds, io });
  const base = { userId, feature, provider: cfg.provider.id, categories, projectIds, io };
  try {
    const result = await callWithFallback(cfg, "generate", { system, prompt, json, maxOutputTokens, timeoutMs, attachments });
    await logRequest({ ...base, model: result.model, usage: result.usage, status: "OK" });
    return { ...result, provider: cfg.provider.id };
  } catch (error) {
    await logRequest({ ...base, model: error.model, status: "ERROR", errorMessage: error.message });
    throw error;
  }
}

module.exports = { generate, prepare, callWithFallback, AiUnavailableError, _cooldowns: cooldowns };
