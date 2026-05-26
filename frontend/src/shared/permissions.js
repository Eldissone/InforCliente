import { apiRequest } from "../services/api.js";
import { getSessionUser } from "../services/auth.js";

const PERMS_KEY = "InfoCliente.permissions";
const PERMS_TS_KEY = "InfoCliente.permissionsAt";
const CACHE_TTL_MS = 5 * 60 * 1000;

let memoryMap = null;

export function getCachedPermissionMap() {
  if (memoryMap) return memoryMap;
  try {
    const raw = localStorage.getItem(PERMS_KEY);
    if (!raw) return null;
    const ts = Number(localStorage.getItem(PERMS_TS_KEY) || 0);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCachedPermissionMap(map) {
  memoryMap = map;
  localStorage.setItem(PERMS_KEY, JSON.stringify(map));
  localStorage.setItem(PERMS_TS_KEY, String(Date.now()));
}

export function clearPermissionCache() {
  memoryMap = null;
  localStorage.removeItem(PERMS_KEY);
  localStorage.removeItem(PERMS_TS_KEY);
}

/** Carrega permissões do perfil via JWT (/permissions/me) */
export async function loadUserPermissions({ force = false } = {}) {
  const user = getSessionUser();
  if (!user?.role) return {};
  if (!force) {
    const cached = getCachedPermissionMap();
    if (cached) return cached;
  }
  try {
    const data = await apiRequest("/permissions/me");
    const map = data.map || {};
    setCachedPermissionMap(map);
    return map;
  } catch {
    return {};
  }
}

export function canPermission(map, module, action, { method = "GET" } = {}) {
  const role = (getSessionUser()?.role || "").toLowerCase();
  if (role === "admin") return true;

  const full = map[`${module}:full_access`];
  if (full === "true") return true;

  const val = map[`${module}:${action}`];
  if (val === "true") return true;
  if (val === "own") return true;
  if (val === "view" && method === "GET") return true;

  const manage = map[`${module}:manage`];
  if (manage === "true" && ["create", "edit", "delete", "approve", "manage"].includes(action)) return true;

  if (action === "read") {
    const view = map[`${module}:view`];
    if (view === "true" || view === "own" || (view === "view" && method === "GET")) return true;
  }

  return false;
}

export function can(module, action, opts) {
  const map = getCachedPermissionMap() || {};
  return canPermission(map, module, action, opts);
}

/** Bloqueia menus/elementos com data-perm="modulo:acao" */
export function applyPermissionVisibility(map) {
  document.querySelectorAll("[data-perm]").forEach((el) => {
    const spec = String(el.getAttribute("data-perm") || "");
    const [module, action = "view"] = spec.split(":").map((s) => s.trim());
    if (!module) return;
    if (canPermission(map, module, action)) {
      el.classList.remove("hidden");
      el.removeAttribute("aria-hidden");
    } else {
      el.classList.add("hidden");
      el.setAttribute("aria-hidden", "true");
    }
  });

  document.querySelectorAll("[data-nav-perm]").forEach((el) => {
    const spec = String(el.getAttribute("data-nav-perm") || "");
    const [module, action = "view"] = spec.split(":").map((s) => s.trim());
    if (!module) return;
    if (!canPermission(map, module, action)) {
      el.classList.add("hidden");
      if (el.tagName === "A") {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          window.location.href = "/Dashboard/index.html?msg=access_denied";
        });
      }
    } else {
      el.classList.remove("hidden");
    }
  });
}

/** Guarda de rota por página (chamar no início de cada página protegida) */
export async function guardPageAccess(module, action = "view") {
  const user = getSessionUser();
  if (!user) return false;
  if ((user.role || "").toLowerCase() === "admin") return true;

  const map = await loadUserPermissions();
  if (canPermission(map, module, action)) return true;

  const here = window.location.pathname;
  let target = "/Dashboard/index.html";
  const role = (user.role || "").toLowerCase();
  if (role === "cliente") target = "/Dashboard/clientDashboard.html";
  else if (role === "tecnico") target = "/Projectos/tecnicoPlanos.html";

  if (!here.includes(target)) {
    window.location.href = `${target}?msg=access_denied`;
  }
  return false;
}

export async function initPermissionLayer() {
  const map = await loadUserPermissions();
  applyPermissionVisibility(map);
  return map;
}
