const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { createLog } = require("../services/logService");
const catalog = require("../services/ai/catalog");
const { listProviders, getProvider } = require("../services/ai/providers");
const { getAdminView, updateSettings, getSettings, resolveApiKey } = require("../services/ai/settingsService");
const { usageSummary } = require("../services/ai/usageService");

/**
 * Gestão da IA (separador "Inteligência Artificial" da Gestão do Sistema).
 * Só administradores, como as cópias de segurança.
 */
const aiRoutes = express.Router();
aiRoutes.use(authRequired);
const admin = requireRole("admin");

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM");
const idList = z.array(z.string().min(1).max(64)).max(500);
const modelName = z.string().trim().min(1).max(120).regex(/^[\w.:\-/]+$/, "Nome de modelo inválido");

const ruleSchema = z.object({
  digestType: z.enum(catalog.DIGEST_TYPES.map((d) => d.key)),
  group: z.enum(catalog.RECIPIENT_GROUPS.map((g) => g.key)),
  enabled: z.boolean(),
  channels: z.array(z.enum(catalog.CHANNELS)).min(1).max(catalog.CHANNELS.length),
  content: z.enum(catalog.CONTENT_TYPES.map((c) => c.key)),
  sendTime: timeOfDay,
  userIds: idList,
  projectIds: idList,
});

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(listProviders().map((p) => p.id)),
    model: modelName,
    fallbackModels: z.array(modelName).max(5),
    baseUrl: z.string().trim().url().max(300).nullable(),
    // string = nova chave; null = apagar a guardada; ausente = manter
    apiKey: z.string().trim().min(8).max(500).nullable(),
    features: z.object(Object.fromEntries(catalog.featureKeys().map((k) => [k, z.boolean()]))).partial(),
    dataCategories: z
      .object(Object.fromEntries(catalog.categoryKeys().map((k) => [k, z.enum(catalog.CATEGORY_MODES)])))
      .partial(),
    monthlyBudget: z.number().min(0).max(1_000_000).nullable(),
    budgetCurrency: z.string().trim().length(3).toUpperCase(),
    inputPricePerMTok: z.number().min(0).max(10_000).nullable(),
    outputPricePerMTok: z.number().min(0).max(10_000).nullable(),
    dailyRequestsPerUser: z.number().int().min(0).max(10_000),
    excludedProjectIds: idList,
    recipientRules: z.array(ruleSchema).max(catalog.DIGEST_TYPES.length * catalog.RECIPIENT_GROUPS.length),
  })
  .partial()
  .strict();

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

async function assertIdsExist(model, ids, label) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const found = await prisma[model].count({ where: { id: { in: unique } } });
  if (found !== unique.length) throw badRequest(`Há ${label} que não existem.`);
}

/** Resumo legível do que mudou, para o histórico (sem a chave). */
function describeChanges(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "apiKey") out.apiKey = value === null ? "apagada" : "alterada";
    else if (key === "recipientRules") out.recipientRules = `${value.length} regra(s)`;
    else out[key] = value;
  }
  return out;
}

aiRoutes.get(
  "/admin/settings",
  admin,
  asyncHandler(async (_req, res) => {
    const [settings, projects, users] = await Promise.all([
      getAdminView(),
      prisma.project.findMany({ select: { id: true, code: true, name: true, active: true }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
    ]);
    return res.json({
      settings,
      catalog: {
        features: catalog.FEATURES,
        dataCategories: catalog.DATA_CATEGORIES,
        digestTypes: catalog.DIGEST_TYPES,
        recipientGroups: catalog.RECIPIENT_GROUPS,
        contentTypes: catalog.CONTENT_TYPES,
        channels: catalog.CHANNELS,
        providers: listProviders(),
      },
      projects,
      users,
    });
  })
);

aiRoutes.put(
  "/admin/settings",
  admin,
  asyncHandler(async (req, res) => {
    const data = settingsSchema.parse(req.body || {});
    if (data.excludedProjectIds) await assertIdsExist("project", data.excludedProjectIds, "obras");
    if (data.recipientRules) {
      await assertIdsExist("user", data.recipientRules.flatMap((r) => r.userIds), "utilizadores");
      await assertIdsExist("project", data.recipientRules.flatMap((r) => r.projectIds), "obras");
    }
    if (data.fallbackModels) data.fallbackModels = [...new Set(data.fallbackModels)];

    // A chave guardada só segue para o fornecedor/endereço onde foi introduzida:
    // mudar um deles sem reintroduzir a chave apaga-a (evita desviá-la).
    const current = await getSettings({ fresh: true });
    const providerChanged = data.provider !== undefined && data.provider !== current.provider;
    const baseUrlChanged = data.baseUrl !== undefined && (data.baseUrl || null) !== (current.baseUrl || null);
    if ((providerChanged || baseUrlChanged) && data.apiKey === undefined && current.apiKeyWrapped) {
      data.apiKey = null;
    }

    const settings = await updateSettings(data, req.user.sub);
    await createLog({
      userId: req.user.sub,
      userName: req.user.name,
      userEmail: req.user.email,
      action: "Atualizou as definições de IA",
      module: "ia",
      status: "SUCCESS",
      details: describeChanges(data),
    });
    return res.json({ settings });
  })
);

/**
 * Testa a ligação. Aceita valores ainda não gravados (provider/model/baseUrl/apiKey);
 * o que faltar vem das definições guardadas.
 */
aiRoutes.post(
  "/admin/test",
  admin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        provider: z.enum(listProviders().map((p) => p.id)).optional(),
        model: modelName.optional(),
        baseUrl: z.string().trim().url().max(300).nullable().optional(),
        apiKey: z.string().trim().min(8).max(500).optional(),
      })
      .strict()
      .parse(req.body || {});

    const settings = await getSettings({ fresh: true });
    const providerId = body.provider || settings.provider;
    const provider = getProvider(providerId);
    const sameProvider = providerId === settings.provider;
    const baseUrl = body.baseUrl !== undefined ? body.baseUrl : sameProvider ? settings.baseUrl : null;
    const sameEndpoint = sameProvider && (baseUrl || null) === (settings.baseUrl || null);
    // A chave guardada nunca é enviada para um endereço diferente do gravado.
    const apiKey = body.apiKey || (sameEndpoint ? resolveApiKey(settings).apiKey : null);
    const model = body.model || (sameProvider ? settings.model : provider.defaultModel);

    if (!apiKey && providerId !== "openai_compatible") {
      return res.status(400).json({ ok: false, error: "Introduza a chave de API para testar." });
    }
    if (!model) return res.status(400).json({ ok: false, error: "Indique o modelo." });

    try {
      const info = await provider.testConnection({ apiKey, baseUrl: baseUrl || provider.defaultBaseUrl, model });
      return res.json({ ok: true, provider: providerId, model: info.model, label: info.label });
    } catch (error) {
      return res.json({ ok: false, error: error.message, code: error.code || null });
    }
  })
);

aiRoutes.get(
  "/admin/usage",
  admin,
  asyncHandler(async (_req, res) => {
    const [summary, settings] = await Promise.all([usageSummary(), getSettings()]);
    return res.json({
      ...summary,
      monthlyBudget: settings.monthlyBudget,
      budgetCurrency: settings.budgetCurrency,
      dailyRequestsPerUser: settings.dailyRequestsPerUser,
    });
  })
);

// ── Assistente da obra (qualquer utilizador interno) ────────────────────────

const { runAssistant, quickSuggestions } = require("../services/ai/assistant/engine");
const { resolveAccess } = require("../services/ai/assistant/access");
const { availableTools } = require("../services/ai/assistant/tools");
const { AiUnavailableError } = require("../services/ai/client");

const HISTORY_TURNS = 10;

function notCliente(req, res, next) {
  if (String(req.user?.role || "").toLowerCase() === "cliente") {
    return res.status(403).json({ error: "O assistente não está disponível no portal do cliente." });
  }
  return next();
}

async function ownConversation(req, id) {
  const conv = await prisma.aiConversation.findFirst({ where: { id: String(id), userId: req.user.sub } });
  if (!conv) {
    const err = new Error("Conversa não encontrada.");
    err.status = 404;
    throw err;
  }
  return conv;
}

/** Estado do assistente para este utilizador: ligado? que dados tem? sugestões. */
aiRoutes.get(
  "/assistant/status",
  notCliente,
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const { apiKey } = resolveApiKey(settings);
    const enabled = Boolean(settings.enabled && settings.features.assistant && (apiKey || settings.provider === "openai_compatible"));
    if (!enabled) {
      return res.json({
        enabled: false,
        canConfigure: String(req.user?.role || "").toLowerCase() === "admin",
        reason: !settings.enabled
          ? "A IA está desligada (interruptor geral). Um administrador pode ligá-la em Gestão → Inteligência Artificial."
          : !settings.features.assistant
            ? 'O assistente está desligado. Um administrador pode ligá-lo em Gestão → Inteligência Artificial → Funcionalidades e limites → "Assistente da obra".'
            : "Falta configurar o fornecedor de IA em Gestão → Inteligência Artificial.",
      });
    }
    const access = await resolveAccess([req.user.sub]);
    const tools = availableTools({ access, categories: settings.dataCategories });
    let projectExcluded = false;
    if (req.query.projectId) projectExcluded = !access.projectIds.has(String(req.query.projectId));
    return res.json({
      enabled: true,
      tools: tools.map((t) => t.label),
      suggestions: quickSuggestions(settings.dataCategories),
      projectExcluded,
    });
  })
);

aiRoutes.get(
  "/assistant/conversations",
  notCliente,
  asyncHandler(async (req, res) => {
    const where = { userId: req.user.sub };
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    const items = await prisma.aiConversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { id: true, title: true, projectId: true, updatedAt: true },
    });
    return res.json({ items });
  })
);

aiRoutes.get(
  "/assistant/conversations/:id",
  notCliente,
  asyncHandler(async (req, res) => {
    const conv = await ownConversation(req, req.params.id);
    const messages = await prisma.aiMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, sources: true, createdAt: true },
    });
    return res.json({ conversation: conv, messages });
  })
);

aiRoutes.delete(
  "/assistant/conversations/:id",
  notCliente,
  asyncHandler(async (req, res) => {
    const conv = await ownConversation(req, req.params.id);
    await prisma.aiConversation.delete({ where: { id: conv.id } });
    return res.json({ ok: true });
  })
);

aiRoutes.post(
  "/assistant/ask",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        message: z.string().trim().min(1).max(2000),
        conversationId: z.string().min(1).max(64).optional(),
        projectId: z.string().min(1).max(64).optional(),
      })
      .strict()
      .parse(req.body || {});

    let conv = body.conversationId ? await ownConversation(req, body.conversationId) : null;
    const projectId = conv ? conv.projectId : body.projectId || null;
    if (projectId && !conv) {
      const exists = await prisma.project.count({ where: { id: projectId } });
      if (!exists) return res.status(400).json({ error: "Obra inválida." });
    }

    const previous = conv
      ? await prisma.aiMessage.findMany({
          where: { conversationId: conv.id },
          orderBy: { createdAt: "desc" },
          take: HISTORY_TURNS * 2,
          select: { role: true, content: true },
        })
      : [];

    let answer;
    try {
      answer = await runAssistant({
        feature: "assistant",
        askerId: req.user.sub,
        question: body.message,
        history: previous.reverse().map((m) => ({ role: m.role, text: m.content })),
        projectId,
        io: req.app.get("io"),
      });
    } catch (error) {
      if (error instanceof AiUnavailableError) {
        return res.status(error.status || 503).json({ error: error.message, code: error.code });
      }
      throw error;
    }

    if (!conv) {
      conv = await prisma.aiConversation.create({
        data: { userId: req.user.sub, projectId, title: body.message.slice(0, 80) },
      });
    }
    const askedAt = new Date();
    await prisma.aiMessage.createMany({
      data: [
        { conversationId: conv.id, role: "user", content: body.message, createdAt: askedAt },
        // +1 ms: mantém a ordem pergunta → resposta ao ordenar por data.
        { conversationId: conv.id, role: "assistant", content: answer.text, sources: answer.sources, createdAt: new Date(+askedAt + 1) },
      ],
    });
    await prisma.aiConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });

    return res.json({
      conversationId: conv.id,
      message: { role: "assistant", content: answer.text, sources: answer.sources, categories: answer.categories },
    });
  })
);

// ── Resumos diários/semanais (Fase 3.1) ─────────────────────────────────────

const digests = require("../services/ai/digests/service");
const alerts = require("../services/ai/alerts/service");
const { KIND_LABEL, KIND_SECTION } = require("../services/ai/alerts/detectors");
const { sectionsFor } = require("../services/ai/digests/facts");
const { userAccess } = require("../services/ai/assistant/access");

function publicAlert(a) {
  return {
    id: a.id,
    kind: a.kind,
    kindLabel: KIND_LABEL[a.kind] || "Alerta",
    severity: a.severity,
    status: a.status,
    title: a.title,
    body: a.body,
    aiExplanation: a.aiExplanation,
    projectId: a.projectId,
    metadata: a.metadata,
    createdAt: a.createdAt,
    lastSeenAt: a.lastSeenAt,
  };
}

const digestRuleBody = z
  .object({ rule: ruleSchema, userId: z.string().min(1).max(64).optional() })
  .strict();

/** Pré-visualiza o resumo de uma regra (mesmo não gravada) para um destinatário, sem gravar nem enviar. */
aiRoutes.post(
  "/admin/digests/preview",
  admin,
  asyncHandler(async (req, res) => {
    const { rule, userId } = digestRuleBody.parse(req.body || {});
    const recipients = await digests.resolveRecipients(rule);
    const users = await prisma.user.findMany({
      where: { id: { in: recipients.map((r) => r.userId) } },
      select: { id: true, name: true, email: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name || u.email]));
    const list = recipients.map((r) => ({ id: r.userId, name: names.get(r.userId) || r.userId, projects: r.projectIds.length }));
    const target = recipients.find((r) => r.userId === userId) || recipients[0];
    if (!target) return res.json({ recipients: list, digest: null });
    if (["PREDICTIVE_ALERTS", "URGENT_ALERTS"].includes(rule.digestType)) {
      // Alertas: os que estão abertos agora e que este destinatário receberia.
      const open = await alerts.openAlertsFor(rule, target);
      const shown = rule.digestType === "URGENT_ALERTS" ? open.filter((a) => a.severity === "HIGH") : open;
      return res.json({ recipients: list, userId: target.userId, alerts: shown.map(publicAlert), text: alerts.alertsText(shown, { full: true }) });
    }
    const digest = await digests.buildDigest({
      userId: target.userId,
      digestType: rule.digestType,
      content: rule.content,
      projectIds: target.projectIds,
      modules: target.modules,
      io: req.app.get("io"),
    });
    return res.json({
      recipients: list,
      userId: target.userId,
      digest: { title: digest.title, text: digest.text, aiUsed: digest.aiUsed, content: digest.content },
    });
  })
);

/** Envia já o resumo de uma regra gravada (reenvia mesmo que o período já tenha sido enviado). */
aiRoutes.post(
  "/admin/digests/send",
  admin,
  asyncHandler(async (req, res) => {
    const { digestType, group } = z
      .object({ digestType: z.enum(["DAILY_SUMMARY", "WEEKLY_SUMMARY", "PREDICTIVE_ALERTS"]), group: z.enum(catalog.RECIPIENT_GROUPS.map((g) => g.key)) })
      .strict()
      .parse(req.body || {});
    const rule = await prisma.digestRecipientRule.findUnique({ where: { digestType_group: { digestType, group } } });
    if (!rule) return res.status(400).json({ error: "Guarde primeiro as definições deste envio." });
    const results =
      digestType === "PREDICTIVE_ALERTS"
        ? await alerts.runPredictiveRule(rule, { io: req.app.get("io") })
        : await digests.runRule(rule, { io: req.app.get("io"), force: true });
    await createLog({
      userId: req.user.sub,
      userName: req.user.name,
      userEmail: req.user.email,
      action: "Enviou um resumo de IA manualmente",
      module: "ia",
      status: "SUCCESS",
      details: { digestType, group, sent: results.filter((r) => r.status === "SENT").length, total: results.length },
    });
    return res.json({
      sent: results.filter((r) => r.status === "SENT").length,
      failed: results.filter((r) => r.status === "FAILED").length,
      total: results.length,
    });
  })
);

/** Resumos recebidos pelo próprio utilizador. */
aiRoutes.get(
  "/digests",
  asyncHandler(async (req, res) => {
    const items = await prisma.aiDigest.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, digestType: true, periodKey: true, title: true, summary: true, aiUsed: true, createdAt: true },
    });
    return res.json({ items });
  })
);

aiRoutes.get(
  "/digests/:id",
  asyncHandler(async (req, res) => {
    const digest = await prisma.aiDigest.findFirst({ where: { id: String(req.params.id), userId: req.user.sub } });
    if (!digest) return res.status(404).json({ error: "Resumo não encontrado." });
    return res.json({ digest });
  })
);

// ── Alertas preditivos (Fase 3.2) ───────────────────────────────────────────

/** Onde o utilizador pode ver alertas: obras que vê e secções dos módulos a que tem acesso. */
async function alertScope(userId) {
  const access = await userAccess(userId);
  const ok = (v) => Boolean(v) && v !== "false";
  const modules = { obras: ok(access.modules.obras), stock: ok(access.modules.stock), financeiro: ok(access.modules.financeiro) };
  const sections = new Set(sectionsFor("FULL", modules));
  const kinds = Object.entries(KIND_SECTION).filter(([, s]) => sections.has(s)).map(([k]) => k);
  return { projectIds: access.projectIds, kinds };
}

/** Alertas das obras do utilizador (abertos e vistos, ou os indicados em `ids`). */
aiRoutes.get(
  "/alerts",
  notCliente,
  asyncHandler(async (req, res) => {
    const scope = await alertScope(req.user.sub);
    const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
    const where = { kind: { in: scope.kinds }, projectId: { in: scope.projectIds }, internal: true };
    if (ids.length) where.id = { in: ids };
    else where.status = { in: ["OPEN", "ACK"] };
    if (req.query.projectId) where.projectId = { in: scope.projectIds.filter((id) => id === String(req.query.projectId)) };
    const rows = await prisma.alert.findMany({
      where,
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: { project: { select: { code: true, name: true } } },
    });
    return res.json({ items: rows.map((a) => ({ ...publicAlert(a), project: a.project })) });
  })
);

/** Marca um alerta como visto (sai da lista diária; fecha sozinho quando a situação acabar). */
aiRoutes.post(
  "/alerts/:id/ack",
  notCliente,
  asyncHandler(async (req, res) => {
    const scope = await alertScope(req.user.sub);
    const alert = await prisma.alert.findFirst({
      where: { id: String(req.params.id), kind: { in: scope.kinds }, projectId: { in: scope.projectIds } },
    });
    if (!alert) return res.status(404).json({ error: "Alerta não encontrado." });
    if (alert.status === "OPEN") await prisma.alert.update({ where: { id: alert.id }, data: { status: "ACK" } });
    await createLog({
      userId: req.user.sub,
      userName: req.user.name,
      userEmail: req.user.email,
      action: "Marcou um alerta como visto",
      module: "ia",
      status: "SUCCESS",
      details: { alertId: alert.id, title: alert.title },
    });
    return res.json({ ok: true });
  })
);

/** Verifica já todas as obras (sem esperar pelos 30 min). */
aiRoutes.post(
  "/admin/alerts/scan",
  admin,
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    if (!settings.features.alerts) {
      return res.status(400).json({ error: 'Ligue primeiro "Alertas preditivos" em Funcionalidades e limites.' });
    }
    const result = await alerts.runScan({ io: req.app.get("io") });
    await createLog({
      userId: req.user.sub,
      userName: req.user.name,
      userEmail: req.user.email,
      action: "Verificou os alertas das obras manualmente",
      module: "ia",
      status: "SUCCESS",
      details: result,
    });
    return res.json(result);
  })
);

// ── Registo de execução por texto ou voz (Fase 3.3) ─────────────────────────

const progressAi = require("../services/ai/progress/service");
const { checkUserPermission } = require("../services/permissionResolver");

const AUDIO_MIME = /^audio\/(webm|ogg|mpeg|mp3|mp4|aac|wav|x-wav|flac|aiff|m4a|x-m4a)(;.*)?$/i;
const MAX_AUDIO_BASE64 = 8 * 1024 * 1024; // ~6 MB de áudio (vários minutos)

/** O que o utilizador pode fazer nesta obra: ver, reportar em planos, registar diretamente. */
async function progressRights(req, projectId) {
  const access = await userAccess(req.user.sub);
  const role = String(req.user?.role || "").toLowerCase();
  const visible = access.projectIds.includes(String(projectId)) && access.modules.obras && access.modules.obras !== "false";
  const { allowed } = await checkUserPermission(req.user.sub, role, "obras", "manage", "POST");
  const canReport = visible && Boolean(allowed) && allowed !== "false";
  // O registo direto no progresso segue a mesma regra da edição manual das tarefas.
  return { visible, canReport, allowDirect: canReport && ["admin", "operador"].includes(role) };
}

async function voiceStatus(req, projectId) {
  const settings = await getSettings();
  const { apiKey } = resolveApiKey(settings);
  if (!settings.enabled || !settings.features.voice || !(apiKey || settings.provider === "openai_compatible")) {
    return { enabled: false, reason: 'O registo por texto ou voz está desligado. Um administrador pode ligá-lo em Gestão → Inteligência Artificial → "Registo de execução por texto ou voz".' };
  }
  if ((settings.dataCategories.progress || "off") === "off") {
    return { enabled: false, reason: 'A Gestão não autoriza o envio de "Progresso e planeamento" à IA.' };
  }
  const excluded = new Set(await require("../services/ai/settingsService").getExcludedProjectIds());
  if (excluded.has(String(projectId))) return { enabled: false, reason: "Esta obra está excluída do envio à IA." };
  const rights = await progressRights(req, projectId);
  if (!rights.canReport) return { enabled: false, reason: "Sem permissão para registar execução nesta obra." };
  return { enabled: true, audio: settings.provider === "gemini", allowDirect: rights.allowDirect };
}

aiRoutes.get(
  "/progress/status",
  notCliente,
  asyncHandler(async (req, res) => {
    const projectId = z.string().min(1).max(64).parse(req.query.projectId);
    const status = await voiceStatus(req, projectId);
    return res.json({ ...status, canConfigure: String(req.user?.role || "").toLowerCase() === "admin" });
  })
);

aiRoutes.post(
  "/progress/interpret",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().min(1).max(64),
        text: z.string().trim().min(3).max(2000).optional(),
        audio: z
          .object({ mimeType: z.string().regex(AUDIO_MIME, "Formato de áudio não suportado"), base64: z.string().min(100).max(MAX_AUDIO_BASE64) })
          .strict()
          .optional(),
      })
      .strict()
      .refine((b) => Boolean(b.text) !== Boolean(b.audio), "Envie o texto ou o áudio.")
      .parse(req.body || {});
    const status = await voiceStatus(req, body.projectId);
    if (!status.enabled) return res.status(403).json({ error: status.reason });
    if (body.audio && !status.audio) return res.status(400).json({ error: "O fornecedor de IA configurado não aceita áudio. Escreva o texto." });
    try {
      const result = await progressAi.interpret({
        projectId: body.projectId,
        userId: req.user.sub,
        text: body.text,
        // O tipo do navegador traz o codec (ex.: "audio/webm;codecs=opus"); a IA só quer o tipo.
        audio: body.audio ? { mimeType: body.audio.mimeType.split(";")[0].toLowerCase(), base64: body.audio.base64 } : undefined,
        io: req.app.get("io"),
      });
      return res.json({ ...result, allowDirect: status.allowDirect });
    } catch (error) {
      if (error instanceof AiUnavailableError) return res.status(error.status || 503).json({ error: error.message, code: error.code });
      throw error;
    }
  })
);

aiRoutes.post(
  "/progress/confirm",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().min(1).max(64),
        source: z.enum(["text", "voice"]),
        transcript: z.string().max(2000).optional(),
        entries: z
          .array(
            z
              .object({
                taskId: z.string().min(1).max(64),
                dailyPlanTaskId: z.string().min(1).max(64).nullable().optional(),
                quantity: z.number().positive().max(1e9),
                note: z.string().max(300).optional(),
              })
              .strict()
          )
          .min(1)
          .max(10),
      })
      .strict()
      .parse(req.body || {});
    const rights = await progressRights(req, body.projectId);
    if (!rights.canReport) return res.status(403).json({ error: "Sem permissão para registar execução nesta obra." });

    const result = await progressAi.confirm({
      projectId: body.projectId,
      entries: body.entries,
      user: { id: req.user.sub, name: req.user.name || req.user.email },
      allowDirect: rights.allowDirect,
      source: body.source,
    });
    const { recalculateTaskRollup } = require("./projects");
    for (const parentId of result.parentsToRecalc) await recalculateTaskRollup(parentId, body.projectId);

    await createLog({
      userId: req.user.sub,
      userName: req.user.name,
      userEmail: req.user.email,
      action: body.source === "voice" ? "Registou execução por voz (IA)" : "Registou execução por texto (IA)",
      module: "obras",
      status: "SUCCESS",
      details: { projectId: body.projectId, transcript: body.transcript || null, saved: result.saved },
    });
    return res.json({ saved: result.saved });
  })
);

// ── Necessidades assistidas (Fase 3.4) ──────────────────────────────────────

const needsAi = require("../services/ai/needs/service");

const IMAGE_MIME = /^image\/(jpeg|png|webp|heic|heif)$/i;
const MAX_IMAGE_BASE64 = 9 * 1024 * 1024;
const NEED_ROLES = ["admin", "operador", "supervisor"]; // as mesmas do formulário manual

async function needsStatus(req, projectId) {
  const settings = await getSettings();
  const { apiKey } = resolveApiKey(settings);
  const role = String(req.user?.role || "").toLowerCase();
  if (!settings.enabled || !settings.features.needs_assist || !(apiKey || settings.provider === "openai_compatible")) {
    return { enabled: false, reason: 'As necessidades assistidas estão desligadas. Um administrador pode ligá-las em Gestão → Inteligência Artificial → "Necessidades assistidas (texto ou foto)".' };
  }
  if ((settings.dataCategories.needs || "off") === "off") return { enabled: false, reason: 'A Gestão não autoriza o envio de "Necessidades e cotações" à IA.' };
  const excluded = new Set(await require("../services/ai/settingsService").getExcludedProjectIds());
  if (excluded.has(String(projectId))) return { enabled: false, reason: "Esta obra está excluída do envio à IA." };
  const access = await userAccess(req.user.sub);
  if (!NEED_ROLES.includes(role) || !access.projectIds.includes(String(projectId))) {
    return { enabled: false, reason: "Sem permissão para criar necessidades nesta obra." };
  }
  const costCenters = await prisma.costCenter.findMany({
    where: { projectId: String(projectId), active: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, currency: true },
  });
  return {
    enabled: true,
    // Foto: precisa de um fornecedor com imagens e de "Documentos e faturas" autorizado.
    photo: settings.provider === "gemini" && (settings.dataCategories.documents || "off") !== "off",
    costCenters,
  };
}

aiRoutes.get(
  "/needs/status",
  notCliente,
  asyncHandler(async (req, res) => {
    const projectId = z.string().min(1).max(64).parse(req.query.projectId);
    const status = await needsStatus(req, projectId);
    return res.json({ ...status, canConfigure: String(req.user?.role || "").toLowerCase() === "admin" });
  })
);

aiRoutes.post(
  "/needs/interpret",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().min(1).max(64),
        text: z.string().trim().min(2).max(4000).optional(),
        image: z
          .object({ mimeType: z.string().regex(IMAGE_MIME, "Formato de imagem não suportado (JPG, PNG, WEBP)"), base64: z.string().min(100).max(MAX_IMAGE_BASE64) })
          .strict()
          .optional(),
      })
      .strict()
      .refine((b) => Boolean(b.text) !== Boolean(b.image), "Envie o texto ou a foto.")
      .parse(req.body || {});
    const status = await needsStatus(req, body.projectId);
    if (!status.enabled) return res.status(403).json({ error: status.reason });
    if (body.image && !status.photo) {
      return res.status(400).json({ error: 'Para ler fotos é preciso o Google Gemini e "Documentos e faturas" autorizado na Gestão.' });
    }
    try {
      const result = await needsAi.interpret({
        projectId: body.projectId,
        userId: req.user.sub,
        text: body.text,
        image: body.image ? { mimeType: body.image.mimeType.toLowerCase(), base64: body.image.base64 } : undefined,
        io: req.app.get("io"),
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof AiUnavailableError) return res.status(error.status || 503).json({ error: error.message, code: error.code });
      throw error;
    }
  })
);

aiRoutes.post(
  "/needs/confirm",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().min(1).max(64),
        costCenterId: z.string().min(1).max(64),
        source: z.enum(["text", "photo"]),
        items: z
          .array(
            z
              .object({
                description: z.string().trim().min(2).max(200),
                quantity: z.number().positive().max(1e9).nullable(),
                unit: z.string().trim().max(20).nullable(),
                unitPrice: z.number().min(0).max(1e12).nullable(),
                priority: z.enum(["ALTA", "MEDIA", "BAIXA"]),
                notes: z.string().max(300).nullable().optional(),
              })
              .strict()
          )
          .min(1)
          .max(30),
      })
      .strict()
      .parse(req.body || {});
    const role = String(req.user?.role || "").toLowerCase();
    const access = await userAccess(req.user.sub);
    if (!NEED_ROLES.includes(role) || !access.projectIds.includes(body.projectId)) {
      return res.status(403).json({ error: "Sem permissão para criar necessidades nesta obra." });
    }
    const result = await needsAi.createNeeds({
      projectId: body.projectId,
      costCenterId: body.costCenterId,
      items: body.items.map((it) => ({ ...it, source: body.source })),
      user: { id: req.user.sub, name: req.user.name || req.user.email },
    });
    await createLog({
      userId: req.user.sub,
      userName: req.user.name,
      userEmail: req.user.email,
      action: body.source === "photo" ? "Criou necessidades a partir de foto (IA)" : "Criou necessidades a partir de texto (IA)",
      module: "obras",
      status: "SUCCESS",
      details: { projectId: body.projectId, costCenter: result.costCenter.code, needs: result.created.map((n) => n.description) },
    });
    return res.json({ created: result.created });
  })
);

// ── Fotos da obra e histórico de segurança (Fase 3.5) ───────────────────────

const photosAi = require("../services/ai/photos/service");
const PHOTO_ROLES = ["admin", "operador"]; // as mesmas do carregamento de fotos

async function photoRights(req, projectId) {
  const access = await userAccess(req.user.sub);
  const role = String(req.user?.role || "").toLowerCase();
  const visible = access.projectIds.includes(String(projectId)) && access.modules.obras && access.modules.obras !== "false";
  return { visible, canManage: visible && PHOTO_ROLES.includes(role) };
}

async function photosStatus(req, projectId) {
  const settings = await getSettings();
  const { apiKey } = resolveApiKey(settings);
  const rights = await photoRights(req, projectId);
  const base = { canReview: rights.canManage, canView: rights.visible };
  if (!settings.enabled || !settings.features.photos || !apiKey || settings.provider !== "gemini") {
    return { ...base, enabled: false, reason: 'A análise de fotos está desligada (precisa do Google Gemini e de "Análise de fotos" ligada em Gestão → Inteligência Artificial).' };
  }
  if ((settings.dataCategories.photos || "off") === "off") return { ...base, enabled: false, reason: 'A Gestão não autoriza o envio de "Fotos da obra" à IA.' };
  const excluded = new Set(await require("../services/ai/settingsService").getExcludedProjectIds());
  if (excluded.has(String(projectId))) return { ...base, enabled: false, reason: "Esta obra está excluída do envio à IA." };
  if (!rights.canManage) return { ...base, enabled: false, reason: "Sem permissão para analisar fotos desta obra." };
  return { ...base, enabled: true, withTasks: (settings.dataCategories.progress || "off") !== "off" };
}

async function findPhoto(photoId) {
  const photo = await prisma.projectPhoto.findUnique({ where: { id: String(photoId) } });
  if (!photo) throw Object.assign(new Error("Foto não encontrada."), { status: 404 });
  return photo;
}

aiRoutes.get(
  "/photos/status",
  notCliente,
  asyncHandler(async (req, res) => {
    const projectId = z.string().min(1).max(64).parse(req.query.projectId);
    const status = await photosStatus(req, projectId);
    return res.json({ ...status, canConfigure: String(req.user?.role || "").toLowerCase() === "admin", categories: photosAi.CATEGORIES });
  })
);

aiRoutes.post(
  "/photos/:photoId/analyze",
  notCliente,
  asyncHandler(async (req, res) => {
    const photo = await findPhoto(req.params.photoId);
    const status = await photosStatus(req, photo.projectId);
    if (!status.enabled) return res.status(403).json({ error: status.reason });
    const { loadProjectPhotoAsset } = require("./projects");
    let asset;
    try {
      asset = await loadProjectPhotoAsset(photo.path);
    } catch (error) {
      return res.status(error.status || 500).json({ error: "Não foi possível abrir o ficheiro da foto." });
    }
    try {
      const result = await photosAi.analyzePhoto({ photo, asset, userId: req.user.sub, io: req.app.get("io") });
      return res.json(result);
    } catch (error) {
      if (error instanceof AiUnavailableError) return res.status(error.status || 503).json({ error: error.message, code: error.code });
      throw error;
    }
  })
);

aiRoutes.post(
  "/photos/:photoId/apply",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ caption: z.string().max(500).nullable().optional(), progressTaskId: z.string().min(1).max(64).nullable().optional() })
      .strict()
      .parse(req.body || {});
    const photo = await findPhoto(req.params.photoId);
    const rights = await photoRights(req, photo.projectId);
    if (!rights.canManage) return res.status(403).json({ error: "Sem permissão para alterar fotos desta obra." });
    const updated = await photosAi.applyToPhoto({ photo, ...body });
    return res.json({ photo: { id: updated.id, description: updated.description, progressTaskId: updated.progressTaskId } });
  })
);

/** Histórico de segurança da obra (interno: nunca no portal do cliente). */
aiRoutes.get(
  "/safety",
  notCliente,
  asyncHandler(async (req, res) => {
    const projectId = z.string().min(1).max(64).parse(req.query.projectId);
    const rights = await photoRights(req, projectId);
    if (!rights.visible) return res.status(403).json({ error: "Sem acesso a esta obra." });
    const status = req.query.status ? z.enum(["SUGGESTED", "CONFIRMED", "DISMISSED", "RESOLVED"]).parse(req.query.status) : null;
    const items = await prisma.safetyObservation.findMany({
      where: { projectId, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: "desc" }],
      take: 300,
      include: { photo: { select: { id: true, path: true, description: true, createdAt: true } } },
    });
    return res.json({ items, categories: photosAi.CATEGORIES, canReview: rights.canManage });
  })
);

/** Registo manual de uma observação de segurança (já confirmada). */
aiRoutes.post(
  "/safety",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().min(1).max(64),
        category: z.enum(Object.keys(photosAi.CATEGORIES)),
        severity: z.enum(photosAi.SEVERITIES),
        description: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(req.body || {});
    const rights = await photoRights(req, body.projectId);
    if (!rights.canManage) return res.status(403).json({ error: "Sem permissão para registar observações nesta obra." });
    const item = await prisma.safetyObservation.create({
      data: { ...body, source: "MANUAL", status: "CONFIRMED", reviewedById: req.user.sub, reviewedByName: req.user.name || req.user.email, reviewedAt: new Date() },
    });
    await createLog({
      userId: req.user.sub,
      userName: req.user.name,
      userEmail: req.user.email,
      action: "Registou uma observação de segurança",
      module: "obras",
      status: "SUCCESS",
      details: { projectId: body.projectId, category: body.category, severity: body.severity },
    });
    return res.status(201).json({ item });
  })
);

aiRoutes.post(
  "/safety/:id/review",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ decision: z.enum(["CONFIRMED", "DISMISSED", "RESOLVED"]), notes: z.string().max(500).optional() })
      .strict()
      .parse(req.body || {});
    const observation = await prisma.safetyObservation.findUnique({ where: { id: String(req.params.id) } });
    if (!observation) return res.status(404).json({ error: "Observação não encontrada." });
    const rights = await photoRights(req, observation.projectId);
    if (!rights.canManage) return res.status(403).json({ error: "Sem permissão para rever observações desta obra." });
    const item = await photosAi.reviewObservation({ observation, ...body, user: { id: req.user.sub, name: req.user.name || req.user.email } });
    await createLog({
      userId: req.user.sub,
      userName: req.user.name,
      userEmail: req.user.email,
      action: { CONFIRMED: "Confirmou um risco de segurança", DISMISSED: "Descartou um risco de segurança sugerido", RESOLVED: "Marcou um risco de segurança como resolvido" }[body.decision],
      module: "obras",
      status: "SUCCESS",
      details: { observationId: item.id, projectId: item.projectId, category: item.category, notes: body.notes || null },
    });
    return res.json({ item });
  })
);

// ── Rascunhos de documentos (Fase 3.6) ──────────────────────────────────────

const docsAi = require("../services/ai/documents/service");
const DOC_ROLES = ["admin", "operador"]; // as mesmas da gestão dos autos

async function documentsStatus(req, projectId) {
  const settings = await getSettings();
  const { apiKey } = resolveApiKey(settings);
  const role = String(req.user?.role || "").toLowerCase();
  const access = await userAccess(req.user.sub);
  const on = (c) => (settings.dataCategories[c] || "off") !== "off";
  if (!settings.enabled || !settings.features.documents_draft || !(apiKey || settings.provider === "openai_compatible")) {
    return { enabled: false, reason: 'Os rascunhos de documentos estão desligados. Um administrador pode ligá-los em Gestão → Inteligência Artificial → "Rascunhos de documentos".' };
  }
  if (!on("progress")) return { enabled: false, reason: 'A Gestão não autoriza o envio de "Progresso e planeamento" à IA.' };
  const excluded = new Set(await require("../services/ai/settingsService").getExcludedProjectIds());
  if (excluded.has(String(projectId))) return { enabled: false, reason: "Esta obra está excluída do envio à IA." };
  if (!DOC_ROLES.includes(role) || !access.projectIds.includes(String(projectId))) {
    return { enabled: false, reason: "Sem permissão para preparar documentos desta obra." };
  }
  const financeiro = access.modules.financeiro && access.modules.financeiro !== "false";
  return { enabled: true, withValues: on("budget") && Boolean(financeiro), withPhotos: on("photos") };
}

function docCategories(status, extra = []) {
  return ["progress", ...(status.withValues ? ["budget"] : []), ...extra];
}

aiRoutes.get(
  "/documents/status",
  notCliente,
  asyncHandler(async (req, res) => {
    const projectId = z.string().min(1).max(64).parse(req.query.projectId);
    const status = await documentsStatus(req, projectId);
    return res.json({ ...status, canConfigure: String(req.user?.role || "").toLowerCase() === "admin" });
  })
);

aiRoutes.post(
  "/documents/measurement-text",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z.object({ projectId: z.string().min(1).max(64), reportId: z.string().min(1).max(64) }).strict().parse(req.body || {});
    const status = await documentsStatus(req, body.projectId);
    if (!status.enabled) return res.status(403).json({ error: status.reason });
    const [report, project] = await Promise.all([
      prisma.measurementReport.findFirst({ where: { id: body.reportId, projectId: body.projectId } }),
      prisma.project.findUnique({ where: { id: body.projectId }, select: { code: true, name: true } }),
    ]);
    if (!report) return res.status(404).json({ error: "Auto não encontrado." });
    if (!report.snapshotData) return res.status(400).json({ error: "Este auto não tem mapa de quantidades gravado." });
    const facts = docsAi.measurementFacts(report, project, { withValues: status.withValues });
    try {
      const out = await docsAi.draft({ kind: "measurement", facts, categories: docCategories(status), projectId: body.projectId, userId: req.user.sub, io: req.app.get("io") });
      return res.json({ ...out, withValues: status.withValues, reportStatus: report.status });
    } catch (error) {
      if (error instanceof AiUnavailableError) return res.status(error.status || 503).json({ error: error.message, code: error.code });
      throw error;
    }
  })
);

aiRoutes.post(
  "/documents/monthly-report",
  notCliente,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ projectId: z.string().min(1).max(64), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM") })
      .strict()
      .parse(req.body || {});
    const status = await documentsStatus(req, body.projectId);
    if (!status.enabled) return res.status(403).json({ error: status.reason });
    const facts = await docsAi.monthlyFacts(body.projectId, body.month, status);
    const photoCats = facts.fotos?.exemplos?.length ? ["photos"] : [];
    try {
      const out = await docsAi.draft({ kind: "monthly", facts, categories: docCategories(status, photoCats), projectId: body.projectId, userId: req.user.sub, io: req.app.get("io") });
      return res.json({ ...out, withValues: status.withValues, empty: !facts.trabalhosExecutadosNoMes.length && !facts.autosDeMedicao.length });
    } catch (error) {
      if (error instanceof AiUnavailableError) return res.status(error.status || 503).json({ error: error.message, code: error.code });
      throw error;
    }
  })
);

// ─── Paleta de comandos (Fase 4) ───────────────────────────────────────────
const commandAi = require("../services/ai/command/service");

async function commandAiAvailable() {
  const settings = await getSettings();
  const { apiKey } = resolveApiKey(settings);
  return Boolean(settings.enabled && settings.features.command && (apiKey || settings.provider === "openai_compatible"));
}

/** Obras a que o utilizador tem acesso que correspondem ao texto. */
aiRoutes.get(
  "/command/projects",
  notCliente,
  asyncHandler(async (req, res) => {
    const q = z.string().trim().max(120).parse(String(req.query.q || ""));
    if (q.length < 2) return res.json({ projects: [] });
    const access = await userAccess(req.user.sub);
    return res.json({ projects: await commandAi.findProjects(q, access.projectIds) });
  })
);

aiRoutes.get(
  "/command/status",
  notCliente,
  asyncHandler(async (req, res) => res.json({ ai: await commandAiAvailable() }))
);

/**
 * Interpreta uma frase. Devolve a intenção e as obras candidatas; o browser
 * executa (abre ecrãs e formulários). Nada é gravado.
 */
aiRoutes.post(
  "/command",
  notCliente,
  asyncHandler(async (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(2).max(500) }).strict().parse(req.body || {});
    const ai = await commandAiAvailable();
    let intent = commandAi.parseLocal(text);
    let source = "local";
    let aiError = null;
    if (!intent) {
      if (ai) {
        try {
          ({ intent } = await commandAi.interpretWithAi({ text, userId: req.user.sub, io: req.app.get("io") }));
          source = "ai";
        } catch (error) {
          aiError = error.message || "A IA não respondeu.";
        }
      }
      if (!intent) intent = { action: "ask", question: text };
    }
    let projects = [];
    if (intent.project) {
      const access = await userAccess(req.user.sub);
      projects = await commandAi.findProjects(intent.project, access.projectIds);
    }
    return res.json({ intent, projects, source, ai, aiError });
  })
);

module.exports = { aiRoutes, settingsSchema };
