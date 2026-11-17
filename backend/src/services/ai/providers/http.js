/** fetch com timeout + leitura segura do JSON, partilhado pelos adaptadores. */
async function fetchJson(url, { method = "GET", headers = {}, body, timeoutMs = 60_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json, text };
  } catch (error) {
    if (error?.name === "AbortError") {
      const err = new Error("O fornecedor de IA não respondeu a tempo.");
      err.code = "AI_TIMEOUT";
      err.retryable = true; // tenta o modelo seguinte (sem repetir o mesmo)
      throw err;
    }
    const err = new Error(`Não foi possível contactar o fornecedor de IA: ${error.message}`);
    err.code = "AI_UNREACHABLE";
    err.retryable = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseRetryAfter(json, message) {
  for (const d of json?.error?.details || []) {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(String(d?.retryDelay || ""));
    if (m) return Math.round(Number(m[1]) * 1000);
  }
  const m = /retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i.exec(String(message || ""));
  if (m && (m[1] || m[2] || m[3])) return Math.round(((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)) * 1000);
  return null;
}

function providerError(status, json, fallback) {
  const original = json?.error?.message || fallback || `HTTP ${status}`;
  const overloaded = status === 503 || status === 529 || /overloaded|high demand|unavailable/i.test(original);
  const message = overloaded
    ? "O fornecedor de IA está sobrecarregado neste momento. Tente novamente dentro de instantes."
    : status === 429
      ? "Foi atingido o limite de pedidos do fornecedor de IA. Tente novamente dentro de instantes."
      : original;
  const err = new Error(message);
  err.status = status;
  err.code =
    status === 401 || status === 403 || /api key/i.test(message)
      ? "AI_INVALID_KEY"
      : status === 404
        ? "AI_MODEL_NOT_FOUND"
        : status === 429
          ? "AI_RATE_LIMITED"
          : "AI_REQUEST_FAILED";
  // 404/429/5xx: vale a pena tentar o modelo seguinte da lista.
  err.retryable = status === 404 || status === 429 || status >= 500;
  // Quanto tempo o fornecedor pede para esperar (RetryInfo do Gemini ou "retry in 1h2m3s").
  err.retryAfterMs = parseRetryAfter(json, original);
  const quotaExhausted = status === 429 && (err.retryAfterMs > 60_000 || /per day|quota/i.test(original));
  if (quotaExhausted) {
    err.code = "AI_QUOTA_EXCEEDED";
    err.message = "A quota do fornecedor de IA para este modelo esgotou (ex.: limite diário do plano gratuito).";
  }
  // 429 momentâneo/5xx: vale a pena repetir o mesmo modelo após uma pausa; quota esgotada não.
  err.transient = (status === 429 && !quotaExhausted) || status >= 500;
  err.providerMessage = original;
  return err;
}

module.exports = { fetchJson, providerError, parseRetryAfter };
