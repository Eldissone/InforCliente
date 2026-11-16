const { fetchJson, providerError } = require("./http");

/** Adaptador Google Gemini (API generativelanguage v1beta). */
const id = "gemini";
const label = "Google Gemini";
const defaultBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
const defaultModel = "gemini-3.8-flash";
// Usados quando o administrador não indicou modelos de recurso (ex.: modelo principal sobrecarregado).
const defaultFallbackModels = ["gemini-3.5-flash", "gemini-2.5-flash"];

function base(baseUrl) {
  return String(baseUrl || defaultBaseUrl).replace(/\/$/, "");
}

/** Confirma a chave e o modelo sem gastar tokens (lê os metadados do modelo). */
async function testConnection({ apiKey, baseUrl, model }) {
  const res = await fetchJson(`${base(baseUrl)}/models/${encodeURIComponent(model)}`, {
    headers: { "x-goog-api-key": apiKey },
    timeoutMs: 15_000,
  });
  if (!res.ok) throw providerError(res.status, res.json, "Falha ao validar a chave/modelo.");
  return { model: res.json?.name?.replace(/^models\//, "") || model, label: res.json?.displayName || null };
}

/**
 * @param {{apiKey:string, baseUrl?:string, model:string, system?:string, prompt:string,
 *          json?:boolean, maxOutputTokens?:number, timeoutMs?:number,
 *          attachments?:{mimeType:string, base64:string}[]}} opts
 */
async function generate({ apiKey, baseUrl, model, system, prompt, json = false, maxOutputTokens, timeoutMs, attachments = [] }) {
  // attachments: [{ mimeType, base64 }] (ex.: áudio gravado no navegador)
  const media = attachments.map((a) => ({ inline_data: { mime_type: a.mimeType, data: a.base64 } }));
  const body = {
    contents: [{ role: "user", parts: [...media, { text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
  const res = await fetchJson(`${base(baseUrl)}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey },
    body,
    timeoutMs,
  });
  if (!res.ok) throw providerError(res.status, res.json);
  const candidate = res.json?.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
  const usage = res.json?.usageMetadata || {};
  return {
    text,
    finishReason: candidate?.finishReason || null,
    usage: {
      inputTokens: usage.promptTokenCount ?? null,
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) || null,
    },
  };
}

/**
 * Conversa com ferramentas (function calling).
 * Histórico normalizado: {role:"user",text} | {role:"assistant",text,toolCalls,raw} | {role:"tool",results:[{id,name,result}]}.
 * `raw` guarda as partes originais do modelo (inclui thoughtSignature, que o Gemini exige de volta).
 */
async function chat({ apiKey, baseUrl, model, system, messages, tools = [], timeoutMs }) {
  const contents = messages.map((m) => {
    if (m.role === "user") return { role: "user", parts: [{ text: m.text }] };
    if (m.role === "assistant") {
      if (Array.isArray(m.raw) && m.raw.length) return { role: "model", parts: m.raw };
      const parts = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.toolCalls || []) parts.push({ functionCall: { name: c.name, args: c.args || {} } });
      return { role: "model", parts };
    }
    return {
      role: "user",
      parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { result: r.result } } })),
    };
  });

  const declarations = tools.map((t) => {
    const hasParams = t.parameters && Object.keys(t.parameters.properties || {}).length > 0;
    return { name: t.name, description: t.description, ...(hasParams ? { parameters: t.parameters } : {}) };
  });

  const body = {
    contents,
    generationConfig: { temperature: 0.2 },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
  };
  const res = await fetchJson(`${base(baseUrl)}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey },
    body,
    timeoutMs,
  });
  if (!res.ok) throw providerError(res.status, res.json);
  const candidate = res.json?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const usage = res.json?.usageMetadata || {};
  return {
    text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(""),
    toolCalls: parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({ id: p.functionCall.id || `call_${i}`, name: p.functionCall.name, args: p.functionCall.args || {} })),
    raw: parts,
    finishReason: candidate?.finishReason || null,
    usage: {
      inputTokens: usage.promptTokenCount ?? null,
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) || null,
    },
  };
}

module.exports = { id, label, defaultBaseUrl, defaultModel, defaultFallbackModels, testConnection, generate, chat };
