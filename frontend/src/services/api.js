import { getToken, logout } from "./auth.js";
import { config } from "./config.js";

const DEFAULT_BASE_URL = config.API_BASE_URL;

export function getApiBaseUrl() {
  return localStorage.getItem("InfoCliente.apiBaseUrl") || DEFAULT_BASE_URL;
}

export function setApiBaseUrl(url) {
  localStorage.setItem("InfoCliente.apiBaseUrl", url);
}

export function getAssetUrl(path) {
  if (path == null) return null;
  const trimmed = String(path).trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  let rel = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  if (!rel.startsWith("uploads/")) rel = `uploads/${rel}`;
  const baseUrl = getApiBaseUrl().replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const origin = window.location.origin.replace(/\/$/, "");
    // Dev: frontend em :5173 com proxy /uploads → mesmo origin
    if (origin === baseUrl || /localhost:5173|127\.0\.0\.1:5173/.test(origin)) {
      return `/${rel}`;
    }
  }
  return `${baseUrl}/${rel}`;
}

/** URL da imagem do produto (catálogo, evidência de movimento ou item). */
export function resolveProductImageUrl(productOrPath) {
  if (!productOrPath) return null;
  const raw = (
    typeof productOrPath === "string"
      ? productOrPath
      : productOrPath?.image || productOrPath?.imageUrl || productOrPath?.evidenceUrl || ""
  )
    .toString()
    .trim();
  if (!raw || raw === "null" || raw === "undefined") return null;
  return getAssetUrl(raw);
}

async function parseJsonSafe(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const API_ERROR_MESSAGES = {
  COMPROVATIVO_REQUIRED: "Comprovativo de pagamento é obrigatório para liquidar.",
  FINANCEIRO_ONLY: "Liquidação apenas no Perfil Financeiro.",
  PAYMENT_NOT_FOUND: "Lançamento não encontrado.",
  NEED_PAID_LOCKED: "Item pago — alteração apenas com permissão de gestão de obras.",
  NEED_NOT_IN_ANALYSIS: "Só é possível aprovar análise de itens com estado «Em Análise».",
  PROPOSAL_REQUIRED: "Carregue a proposta/proforma antes de continuar.",
};

function resolveApiErrorMessage(data, status) {
  if (data?.message) return data.message;
  if (data?.error && API_ERROR_MESSAGES[data.error]) return API_ERROR_MESSAGES[data.error];
  if (status === 403 || String(data?.error || "").includes("FORBIDDEN")) {
    return "Acesso negado: você não tem permissão para realizar esta ação.";
  }
  return data?.error || `HTTP_${status}`;
}

export async function apiRequest(path, { method = "GET", body, headers } = {}) {
  const token = getToken();
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    console.error("apiRequest: 401 Unauthorized em", path, { hasToken: !!token });
    logout();
    const here = window.location.pathname.split("/").slice(-2).join("/");
    const loginUrl = `/Auth/login.html?next=${encodeURIComponent(here)}`;
    window.location.href = loginUrl;
    throw new Error("UNAUTHORIZED");
  }

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const errorMsg = resolveApiErrorMessage(data, res.status);
    const err = new Error(errorMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function apiUpload(path, dataOrOptions, method = "POST") {
  const token = getToken();
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  let form;
  let finalMethod = method;

  if (dataOrOptions instanceof FormData) {
    form = dataOrOptions;
  } else {
    const { file, fieldName = "file", extraFields, method: optionsMethod } = dataOrOptions || {};
    if (optionsMethod) finalMethod = optionsMethod;

    form = new FormData();
    if (file) form.append(fieldName, file);
    if (extraFields) {
      Object.entries(extraFields).forEach(([k, v]) => form.append(k, String(v)));
    }
  }

  const res = await fetch(url, {
    method: finalMethod,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });

  if (res.status === 401) {
    logout();
    const here = window.location.pathname.split("/").slice(-2).join("/");
    const loginUrl = `/Auth/login.html?next=${encodeURIComponent(here)}`;
    window.location.href = loginUrl;
    throw new Error("UNAUTHORIZED");
  }

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const errorMsg = resolveApiErrorMessage(data, res.status);
    const err = new Error(errorMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
