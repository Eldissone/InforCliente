import { getToken, logout } from "./auth.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:4000" || "https://backend-infocliente.onrender.com";

export function getApiBaseUrl() {
  return localStorage.getItem("InfoCliente.apiBaseUrl") || DEFAULT_BASE_URL;
}

export function setApiBaseUrl(url) {
  localStorage.setItem("InfoCliente.apiBaseUrl", url);
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
    logout();
    const here = window.location.pathname.split("/").slice(-2).join("/");
    const loginUrl = `/Auth/login.html?next=${encodeURIComponent(here)}`;
    window.location.href = loginUrl;
    throw new Error("UNAUTHORIZED");
  }

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function apiUpload(path, { file, fieldName = "file", extraFields } = {}) {
  const token = getToken();
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const form = new FormData();
  form.append(fieldName, file);
  if (extraFields) {
    Object.entries(extraFields).forEach(([k, v]) => form.append(k, String(v)));
  }

  const res = await fetch(url, {
    method: "POST",
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
    const err = new Error(data?.error || `HTTP_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

