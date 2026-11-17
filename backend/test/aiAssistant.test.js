const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
const r = (p) => require.resolve(path.join(SRC, p));

/** Substitui um módulo no cache do require (antes de carregar quem o usa). */
function stubModule(p, exports) {
  const id = r(p);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

function mockFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return handler(String(url), init);
  };
  return { calls, restore: () => (global.fetch = original) };
}
const reply = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

test("anonimizador: etiquetas estáveis por tipo e modos on/anonymize/off", () => {
  const { createAnonymizer, applyMode } = require("../src/services/ai/assistant/anonymizer");
  const a = createAnonymizer();
  assert.equal(applyMode("anonymize", a, "Fornecedor", "Cimentos SA"), "Fornecedor A");
  assert.equal(applyMode("anonymize", a, "Fornecedor", "Ferro Lda"), "Fornecedor B");
  assert.equal(applyMode("anonymize", a, "Fornecedor", " cimentos sa "), "Fornecedor A");
  assert.equal(applyMode("anonymize", a, "Pessoa", "João"), "Pessoa 1");
  assert.equal(applyMode("on", a, "Pessoa", "João"), "João");
  assert.equal(applyMode("off", a, "Pessoa", "João"), null);
});

test("gemini.chat: devolve as partes originais (thoughtSignature) e envia functionResponse", async () => {
  const gemini = require("../src/services/ai/providers/gemini");
  const raw = [{ functionCall: { name: "list_projects", args: {} }, thoughtSignature: "sig-1" }];
  let m = mockFetch(() => reply({ candidates: [{ content: { parts: raw } }], usageMetadata: { promptTokenCount: 5 } }));
  let first;
  try {
    first = await gemini.chat({
      apiKey: "k",
      model: "g",
      system: "S",
      messages: [{ role: "user", text: "Olá" }],
      tools: [{ name: "list_projects", description: "d", parameters: { type: "object", properties: {} } }],
    });
    const body = m.calls[0].body;
    assert.deepEqual(body.tools[0].functionDeclarations[0], { name: "list_projects", description: "d" }, "sem parâmetros vazios");
    assert.equal(first.toolCalls[0].name, "list_projects");
    assert.deepEqual(first.raw, raw);
  } finally {
    m.restore();
  }
  m = mockFetch(() => reply({ candidates: [{ content: { parts: [{ text: "Tem 2 obras." }] } }] }));
  try {
    const second = await gemini.chat({
      apiKey: "k",
      model: "g",
      messages: [
        { role: "user", text: "Olá" },
        { role: "assistant", text: "", toolCalls: first.toolCalls, raw: first.raw },
        { role: "tool", results: [{ id: "call_0", name: "list_projects", result: [{ code: "OB-1" }] }] },
      ],
    });
    const contents = m.calls[0].body.contents;
    assert.equal(contents[1].role, "model");
    assert.equal(contents[1].parts[0].thoughtSignature, "sig-1");
    assert.deepEqual(contents[2].parts[0].functionResponse, { name: "list_projects", response: { result: [{ code: "OB-1" }] } });
    assert.equal(second.text, "Tem 2 obras.");
    assert.equal(second.toolCalls.length, 0);
  } finally {
    m.restore();
  }
});

test("openai_compatible.chat: tool_calls e mensagens role=tool", async () => {
  const openai = require("../src/services/ai/providers/openaiCompatible");
  const m = mockFetch(() =>
    reply({
      choices: [{ message: { content: null, tool_calls: [{ id: "c1", function: { name: "get_stock", arguments: JSON.stringify({ project: "OB-1" }) } }] } }],
    })
  );
  try {
    const res = await openai.chat({
      apiKey: "k",
      model: "m",
      messages: [
        { role: "user", text: "stock?" },
        { role: "assistant", text: "", toolCalls: [{ id: "c0", name: "list_projects", args: {} }] },
        { role: "tool", results: [{ id: "c0", name: "list_projects", result: [] }] },
      ],
      tools: [{ name: "get_stock", description: "d", parameters: { type: "object", properties: {} } }],
    });
    const msgs = m.calls[0].body.messages;
    assert.equal(msgs[1].tool_calls[0].function.name, "list_projects");
    assert.deepEqual(msgs[2], { role: "tool", tool_call_id: "c0", content: "[]" });
    assert.deepEqual(res.toolCalls[0], { id: "c1", name: "get_stock", args: { project: "OB-1" } });
  } finally {
    m.restore();
  }
});

test("motor: chama a ferramenta, recusa as desconhecidas, devolve fontes e regista categorias/obras", async () => {
  const logs = [];
  const toolCalls = [];
  let round = 0;
  const fakeProvider = {
    id: "gemini",
    async chat({ messages, tools }) {
      round += 1;
      if (round === 1) {
        assert.ok(tools.some((t) => t.name === "get_stock"));
        return {
          text: "",
          toolCalls: [
            { id: "c1", name: "get_stock", args: { project: "OB-1" } },
            { id: "c2", name: "hack_db", args: {} },
          ],
          raw: null,
          usage: { inputTokens: 10, outputTokens: 2 },
        };
      }
      const toolMsg = messages[messages.length - 1];
      assert.equal(toolMsg.role, "tool");
      assert.match(toolMsg.results[1].result.error, /indisponível/);
      return { text: "Faltam **3 sacos** de cimento.", toolCalls: [], raw: null, usage: { inputTokens: 20, outputTokens: 8 } };
    },
  };

  stubModule("services/ai/settingsService.js", {
    getSettings: async () => ({ dataCategories: { stock: "on", progress: "off" } }),
  });
  stubModule("services/ai/client.js", {
    prepare: async () => ({ provider: fakeProvider, models: ["g"] }),
    callWithFallback: async (cfg, method, payload) => ({ ...(await cfg.provider[method](payload)), model: "g" }),
    AiUnavailableError: class extends Error {},
  });
  stubModule("services/ai/usageService.js", { logRequest: async (e) => logs.push(e) });
  stubModule("services/ai/assistant/access.js", {
    resolveAccess: async () => ({ modules: { obras: true, stock: true, financeiro: false }, projectIds: new Set(["p1"]) }),
  });
  stubModule("services/ai/assistant/tools.js", {
    availableTools: () => [
      {
        name: "get_stock",
        label: "Stock da obra",
        category: "stock",
        async run(ctx, args) {
          toolCalls.push(args);
          ctx.touchedProjects.add("p1");
          return { shortages: [{ product: "Cimento", missing: 3 }] };
        },
      },
    ],
  });
  stubModule("db.js", {
    prisma: {
      project: {
        findUnique: async () => null,
        findMany: async () => [{ code: "OB-1", name: "Obra 1" }],
      },
    },
  });

  const { runAssistant } = require("../src/services/ai/assistant/engine");
  const out = await runAssistant({ feature: "assistant", askerId: "u1", question: "Que materiais faltam?" });
  assert.equal(out.text, "Faltam **3 sacos** de cimento.");
  assert.deepEqual(toolCalls, [{ project: "OB-1" }]);
  assert.deepEqual(out.sources, [{ name: "get_stock", label: "Stock da obra", projects: ["OB-1"] }]);
  const ok = logs.find((l) => l.status === "OK");
  assert.deepEqual(ok.categories, ["stock"]);
  assert.deepEqual(ok.projectIds, ["p1"]);
  assert.deepEqual(ok.usage, { inputTokens: 30, outputTokens: 10 });
});

test("prompt do sistema: lista dados autorizados/negados e regra de não inventar", () => {
  const { buildSystemPrompt } = require("../src/services/ai/assistant/engine");
  const p = buildSystemPrompt({ project: { code: "OB-1", name: "Obra" }, categories: { stock: "on" }, tools: [{}], chatMode: false });
  assert.match(p, /Nunca inventes/);
  assert.match(p, /OB-1/);
  assert.match(p, /Dados autorizados para a IA: Stock e materiais\./);
  assert.match(p, /NÃO autorizados.*Valores de orçamento/);
});

test("@IA: deteção da menção", () => {
  const AI_MENTION = /(^|\s)@IA\b/i;
  assert.ok(AI_MENTION.test("@IA como está a obra?"));
  assert.ok(AI_MENTION.test("olá @ia, ajuda"));
  assert.ok(!AI_MENTION.test("email@IA.com"));
  assert.ok(!AI_MENTION.test("@IAN olá"));
});
