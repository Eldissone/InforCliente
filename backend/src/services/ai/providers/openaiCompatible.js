const { fetchJson, providerError } = require("./http");

/**
 * Adaptador genérico para APIs compatíveis com "chat completions"
 * (OpenAI, Mistral, DeepSeek, Groq, Ollama/LM Studio locais, etc.).
 * Serve de alternativa ao Gemini sem mexer nos casos de uso.
 */
const id = "openai_compatible";
const label = "API compatível com OpenAI";
const defaultBaseUrl = "https://api.openai.com/v1";
const defaultModel = "";

function base(baseUrl) {
  return String(baseUrl || defaultBaseUrl).replace(/\/$/, "");
}

function authHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function testConnection({ apiKey, baseUrl, model }) {
  const res = await fetchJson(`${base(baseUrl)}/models`, { headers: authHeaders(apiKey), timeoutMs: 15_000 });
  if (!res.ok) throw providerError(res.status, res.json, "Falha ao validar a chave.");
  const ids = Array.isArray(res.json?.data) ? res.json.data.map((m) => m.id) : [];
  if (model && ids.length && !ids.includes(model)) {
    const err = new Error(`A chave é válida, mas o modelo "${model}" não aparece na lista do fornecedor.`);
    err.code = "AI_MODEL_NOT_FOUND";
    throw err;
  }
  return { model, label: null };
}

async function generate({ apiKey, baseUrl, model, system, prompt, json = false, maxOutputTokens, timeoutMs, attachments = [] }) {
  if (attachments.length) {
    const err = new Error("Este fornecedor de IA não aceita áudio. Escreva o texto ou mude para o Google Gemini na Gestão.");
    err.code = "AI_UNSUPPORTED";
    err.status = 400;
    throw err;
  }
  const body = {
    model,
    temperature: 0.2,
    messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
    ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
  const res = await fetchJson(`${base(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body,
    timeoutMs,
  });
  if (!res.ok) throw providerError(res.status, res.json);
  const choice = res.json?.choices?.[0];
  return {
    text: choice?.message?.content || "",
    finishReason: choice?.finish_reason || null,
    usage: {
      inputTokens: res.json?.usage?.prompt_tokens ?? null,
      outputTokens: res.json?.usage?.completion_tokens ?? null,
    },
  };
}

/** Conversa com ferramentas (ver gemini.chat para o formato normalizado). */
async function chat({ apiKey, baseUrl, model, system, messages, tools = [], timeoutMs }) {
  const out = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
              })),
            }
          : {}),
      });
    } else {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(r.result) });
    }
  }
  const body = {
    model,
    temperature: 0.2,
    messages: out,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters || { type: "object", properties: {} } },
          })),
        }
      : {}),
  };
  const res = await fetchJson(`${base(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body,
    timeoutMs,
  });
  if (!res.ok) throw providerError(res.status, res.json);
  const msg = res.json?.choices?.[0]?.message || {};
  return {
    text: msg.content || "",
    toolCalls: (msg.tool_calls || []).map((c) => {
      let args = {};
      try {
        args = JSON.parse(c.function?.arguments || "{}");
      } catch {
        args = {};
      }
      return { id: c.id, name: c.function?.name, args };
    }),
    raw: null,
    finishReason: res.json?.choices?.[0]?.finish_reason || null,
    usage: {
      inputTokens: res.json?.usage?.prompt_tokens ?? null,
      outputTokens: res.json?.usage?.completion_tokens ?? null,
    },
  };
}

module.exports = { id, label, defaultBaseUrl, defaultModel, testConnection, generate, chat };
