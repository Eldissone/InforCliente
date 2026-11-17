const test = require("node:test");
const assert = require("node:assert/strict");
const gemini = require("../src/services/ai/providers/gemini");
const openai = require("../src/services/ai/providers/openaiCompatible");
const { getProvider, listProviders } = require("../src/services/ai/providers");
const catalog = require("../src/services/ai/catalog");

function mockFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { calls, restore: () => (global.fetch = original) };
}

const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

test("gemini.generate envia a chave no cabeçalho e lê texto e consumo", async () => {
  const m = mockFetch(() =>
    reply(200, {
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Olá" }, { text: " obra" }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, thoughtsTokenCount: 2 },
    })
  );
  try {
    const r = await gemini.generate({ apiKey: "k-123", model: "gemini-x", system: "S", prompt: "P", json: true });
    assert.equal(r.text, "Olá obra");
    assert.deepEqual(r.usage, { inputTokens: 12, outputTokens: 5 });
    assert.ok(m.calls[0].url.endsWith("/models/gemini-x:generateContent"));
    assert.ok(!m.calls[0].url.includes("k-123"), "a chave não vai no URL");
    assert.equal(m.calls[0].init.headers["x-goog-api-key"], "k-123");
    const body = JSON.parse(m.calls[0].init.body);
    assert.equal(body.systemInstruction.parts[0].text, "S");
    assert.equal(body.generationConfig.responseMimeType, "application/json");
  } finally {
    m.restore();
  }
});

test("erros do fornecedor: chave inválida não repete; 429/404/5xx podem repetir noutro modelo", async () => {
  let m = mockFetch(() => reply(400, { error: { message: "API key not valid" } }));
  try {
    await assert.rejects(gemini.generate({ apiKey: "x", model: "m", prompt: "p" }), (e) => e.code === "AI_INVALID_KEY" && !e.retryable);
  } finally {
    m.restore();
  }
  m = mockFetch(() => reply(429, { error: { message: "busy" } }));
  try {
    await assert.rejects(gemini.generate({ apiKey: "x", model: "m", prompt: "p" }), (e) => e.code === "AI_RATE_LIMITED" && e.retryable);
  } finally {
    m.restore();
  }
});

test("openai_compatible: chat completions, Bearer e verificação do modelo", async () => {
  let m = mockFetch(() =>
    reply(200, { choices: [{ message: { content: "{\"ok\":1}" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 4 } })
  );
  try {
    const r = await openai.generate({ apiKey: "sk", baseUrl: "https://llm.example/v1/", model: "m1", prompt: "p", json: true });
    assert.equal(r.text, "{\"ok\":1}");
    assert.deepEqual(r.usage, { inputTokens: 7, outputTokens: 4 });
    assert.equal(m.calls[0].url, "https://llm.example/v1/chat/completions");
    assert.equal(m.calls[0].init.headers.Authorization, "Bearer sk");
  } finally {
    m.restore();
  }
  m = mockFetch(() => reply(200, { data: [{ id: "outro" }] }));
  try {
    await assert.rejects(openai.testConnection({ apiKey: "sk", model: "m1" }), (e) => e.code === "AI_MODEL_NOT_FOUND");
  } finally {
    m.restore();
  }
});

test("registo de fornecedores e catálogo", () => {
  assert.deepEqual(listProviders().map((p) => p.id).sort(), ["gemini", "openai_compatible"]);
  assert.equal(getProvider("nao-existe"), null);
  const cats = catalog.defaultCategories();
  // Por omissão nada é enviado, exceto documentos (a leitura de faturas já os enviava).
  assert.equal(Object.entries(cats).filter(([, v]) => v !== "off").map(([k]) => k).join(), "documents");
  assert.equal(catalog.defaultFeatures().invoice_scan, true);
  assert.equal(catalog.defaultFeatures().assistant, false);
});

test("validação do PUT das definições de IA", () => {
  const { settingsSchema } = require("../src/routes/ai");
  const ok = settingsSchema.parse({
    provider: "gemini",
    model: "gemini-3.8-flash",
    dataCategories: { suppliers: "anonymize", budget: "on" },
    features: { assistant: true },
    budgetCurrency: "usd",
    recipientRules: [
      { digestType: "DAILY_SUMMARY", group: "DIRECTION", enabled: true, channels: ["in_app", "email"], content: "FULL", sendTime: "07:30", userIds: ["u1"], projectIds: [] },
    ],
  });
  assert.equal(ok.budgetCurrency, "USD");
  assert.throws(() => settingsSchema.parse({ provider: "outro" }));
  assert.throws(() => settingsSchema.parse({ dataCategories: { budget: "tudo" } }));
  assert.throws(() => settingsSchema.parse({ campoDesconhecido: 1 }), "campos desconhecidos são rejeitados");
  assert.throws(() => settingsSchema.parse({ model: "modelo com espaços" }));
  assert.throws(() =>
    settingsSchema.parse({ recipientRules: [{ digestType: "DAILY_SUMMARY", group: "DIRECTION", enabled: true, channels: [], content: "FULL", sendTime: "07:30", userIds: [], projectIds: [] }] })
  );
});

test("callWithFallback: repete o mesmo modelo em 503 e depois passa ao seguinte", async () => {
  const { callWithFallback, _cooldowns } = require("../src/services/ai/client");
  _cooldowns.clear();
  const { providerError } = require("../src/services/ai/providers/http");
  const seen = [];
  const provider = {
    async chat({ model }) {
      seen.push(model);
      if (model === "a") throw providerError(503, { error: { message: "This model is currently experiencing high demand." } });
      return { text: "ok" };
    },
  };
  const res = await callWithFallback({ provider, models: ["a", "b"] }, "chat", {}, { retryDelays: [0, 0] });
  assert.deepEqual(seen, ["a", "a", "a", "b"]);
  assert.equal(res.model, "b");

  // "a" fica em pausa: o pedido seguinte vai direto ao "b".
  seen.length = 0;
  await callWithFallback({ provider, models: ["a", "b"] }, "chat", {}, { retryDelays: [0, 0] });
  assert.deepEqual(seen, ["b"]);
  _cooldowns.clear();

  seen.length = 0;
  await assert.rejects(
    callWithFallback({ provider, models: ["a"] }, "chat", {}, { retryDelays: [0] }),
    (err) => /sobrecarregado/.test(err.message)
  );
  assert.deepEqual(seen, ["a", "a"]);

  seen.length = 0;
  _cooldowns.clear();
  const bad = { async chat({ model }) { seen.push(model); throw providerError(401, { error: { message: "API key not valid" } }); } };
  await assert.rejects(callWithFallback({ provider: bad, models: ["a", "b"] }, "chat", {}, { retryDelays: [0, 0] }));
  assert.deepEqual(seen, ["a"], "chave inválida não repete nem muda de modelo");
});

test("callWithFallback: quota diária esgotada não repete e põe o modelo em pausa", async () => {
  const { callWithFallback, _cooldowns } = require("../src/services/ai/client");
  const { providerError } = require("../src/services/ai/providers/http");
  _cooldowns.clear();
  const seen = [];
  const provider = {
    id: "gemini",
    async chat({ model }) {
      seen.push(model);
      if (model === "a") throw providerError(429, { error: { message: "Quota exceeded per day. Please retry in 18h33m47.6s." } });
      return { text: "ok" };
    },
  };
  const res = await callWithFallback({ provider, models: ["a", "b"] }, "chat", {}, { retryDelays: [0, 0] });
  assert.deepEqual(seen, ["a", "b"], "sem repetir o modelo sem quota");
  assert.equal(res.model, "b");
  assert.ok(_cooldowns.get("gemini:a") > Date.now() + 18 * 3600 * 1000);
  _cooldowns.clear();
});
