import { apiRequest } from "../services/api.js";
import { getSessionUser } from "../services/auth.js";

const PERMS_KEY = "InfoCliente.permissions";
const PERMS_TS_KEY = "InfoCliente.permissionsAt";
const TAB_FB_KEY = "InfoCliente.tabFallbacks";
const CACHE_TTL_MS = 5 * 60 * 1000;

let memoryMap = null;
let memoryTabFallbacks = null;

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
  memoryTabFallbacks = null;
  localStorage.removeItem(PERMS_KEY);
  localStorage.removeItem(PERMS_TS_KEY);
  localStorage.removeItem(TAB_FB_KEY);
}

function getTabFallbacks() {
  if (memoryTabFallbacks) return memoryTabFallbacks;
  try {
    const raw = localStorage.getItem(TAB_FB_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setTabFallbacks(fb) {
  memoryTabFallbacks = fb || {};
  localStorage.setItem(TAB_FB_KEY, JSON.stringify(memoryTabFallbacks));
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
    setTabFallbacks(data.tabFallbacks || {});
    return map;
  } catch {
    return {};
  }
}

function evaluateAllowedValue(val, method = "GET") {
  if (val === "true" || val === true) return true;
  if (val === "own") return true;
  if (val === "view" && method === "GET") return true;
  return false;
}

export function canPermission(map, module, action, { method = "GET" } = {}) {
  const role = (getSessionUser()?.role || "").toLowerCase();
  if (role === "admin") return true;

  const full = map[`${module}:full_access`];
  if (full === "true" || full === true) return true;

  const mapKey = `${module}:${action}`;

  if (action.startsWith("tab_")) {
    if (Object.prototype.hasOwnProperty.call(map, mapKey)) {
      return evaluateAllowedValue(map[mapKey], method);
    }
    const fb = getTabFallbacks()[mapKey];
    if (fb?.module && fb?.action) {
      return canPermission(map, fb.module, fb.action, { method });
    }
    return canPermission(map, module, "view", { method });
  }

  const val = map[mapKey];
  if (evaluateAllowedValue(val, method)) return true;

  const manage = map[`${module}:manage`];
  if ((manage === "true" || manage === true) && ["create", "edit", "delete", "approve", "manage"].includes(action)) return true;

  if (action === "read") {
    const view = map[`${module}:view`];
    if (view === "true" || view === true || view === "own" || (view === "view" && method === "GET")) return true;
  }

  if (action === "financeiro") {
    const fin = map[`${module}:financeiro`];
    if (fin === "true" || fin === true || fin === "own") return true;
    if (fin === "view" && method === "GET") return true;
  }

  return false;
}

export function can(module, action, opts) {
  const map = getCachedPermissionMap() || {};
  return canPermission(map, module, action, opts);
}

function parsePermSpec(spec) {
  const [module, action = "view"] = String(spec || "").split(":").map((s) => s.trim());
  return { module, action };
}

function setElementPermissionDenied(el, denied) {
  if (denied) {
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
    el.dataset.permDenied = "true";
    if (el.tagName === "BUTTON") el.style.display = "none";
  } else {
    el.classList.remove("hidden");
    el.removeAttribute("aria-hidden");
    delete el.dataset.permDenied;
    if (el.tagName === "BUTTON" && !el.hasAttribute("data-role-visible")) {
      el.style.display = "";
    }
  }
}

export function isElementPermissionAllowed(el, map) {
  const spec = el.getAttribute("data-perm");
  if (!spec) return true;
  const { module, action } = parsePermSpec(spec);
  if (!module) return true;
  return canPermission(map, module, action);
}

/** Bloqueia menus/elementos com data-perm="modulo:acao" */
export function applyPermissionVisibility(map) {
  document.querySelectorAll("[data-perm]").forEach((el) => {
    const spec = el.getAttribute("data-perm") || "";
    const { module, action } = parsePermSpec(spec);
    if (!module) return;
    setElementPermissionDenied(el, !canPermission(map, module, action));
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

/**
 * Oculta abas com data-perm e painéis associados (data-tab-trigger → #tab_*).
 * Chamar após applyPermissionVisibility.
 */
export function applyTabPermissions(map) {
  const triggers = document.querySelectorAll(
    "[data-tab-trigger][data-perm], [data-tab][data-perm], [data-stock-subtab][data-perm]"
  );
  triggers.forEach((el) => {
    const { module, action } = parsePermSpec(el.getAttribute("data-perm"));
    if (!module) return;
    setElementPermissionDenied(el, !canPermission(map, module, action));
  });

  document.querySelectorAll("[data-tab-trigger]").forEach((trigger) => {
    const tabId = trigger.getAttribute("data-tab-trigger");
    if (!tabId) return;
    const panel =
      document.getElementById(`tab_${tabId}`) ||
      document.getElementById(`tab-${tabId}`);
    if (!panel) return;
    const denied =
      trigger.dataset.permDenied === "true" || trigger.classList.contains("hidden");
    if (denied) panel.classList.add("hidden");
  });
}

export function activateFirstVisibleStockSubtab() {
  const tabs = [...document.querySelectorAll("[data-stock-subtab]")].filter(
    (el) => el.dataset.permDenied !== "true" && !el.classList.contains("hidden")
  );
  if (!tabs.length) return null;
  const current = tabs.find((t) => t.classList.contains("border-slate-900"));
  const target = current || tabs[0];
  target.click();
  return target.getAttribute("data-stock-subtab");
}

export function getVisibleTabTriggers(selector = "[data-tab-trigger]") {
  return [...document.querySelectorAll(selector)].filter(
    (el) => el.dataset.permDenied !== "true" && !el.classList.contains("hidden")
  );
}

export function getVisibleStockTabs(selector = ".tab-btn[data-tab]") {
  return [...document.querySelectorAll(selector)].filter(
    (el) => el.dataset.permDenied !== "true" && !el.classList.contains("hidden")
  );
}

/** Activa a primeira aba visível (projectView). */
export function activateFirstVisibleProjectTab() {
  const triggers = getVisibleTabTriggers("[data-tab-trigger]");
  if (!triggers.length) return null;
  const current = triggers.find((t) => t.classList.contains("border-slate-900"));
  const target = current || triggers[0];
  target.click();
  return target.getAttribute("data-tab-trigger");
}

/** Activa a primeira aba visível (Stock). */
export function activateFirstVisibleStockTab() {
  const tabs = getVisibleStockTabs(".tab-btn[data-tab]");
  if (!tabs.length) return null;
  tabs[0].click();
  return tabs[0].dataset.tab;
}

/** Guarda de rota por página (chamar no início de cada página protegida) */
export async function guardPageAccess(module, action = "view") {
  const user = getSessionUser();
  if (!user) return false;
  if ((user.role || "").toLowerCase() === "admin") return true;

  const map = await loadUserPermissions();
  if (canPermission(map, module, action)) return true;

  const here = window.location.pathname;
  const role = (user.role || "").toLowerCase();

  // Percorre a lista de rotas por prioridade para encontrar a primeira acessível
  const priorityRoutes = [
    { key: "navlinks:nav_dashboard", path: "/Dashboard/index.html" },
    { key: "navlinks:nav_clientes", path: "/Clientes/clienteLista.html" },
    { key: "navlinks:nav_obras", path: "/Projectos/ProjectGeral.html" },
    { key: "navlinks:nav_logistica", path: "/Stock/index.html" },
    { key: "navlinks:nav_planeamento", path: "/Projectos/centroCustos.html" },
    { key: "navlinks:nav_financeiro", path: "/Financeiro/financeiro.html" },
    { key: "navlinks:nav_cotacao", path: "/Projectos/Cotacao/index.html" },
    { key: "navlinks:nav_centros_gerais", path: "/Financeiro/centrosGerais.html" },
    { key: "navlinks:nav_users", path: "/Users/index.html" },
  ];

  let target = "/Dashboard/index.html";
  if (role === "cliente") {
    target = "/Dashboard/clientDashboard.html";
  } else if (role === "tecnico") {
    target = "/Projectos/tecnicoPlanos.html";
  } else {
    for (const route of priorityRoutes) {
      const val = map[route.key];
      if (val === "true" || val === true) {
        target = route.path;
        break;
      }
    }
  }

  if (!here.includes(target)) {
    window.location.href = `${target}?msg=access_denied`;
  }
  return false;
}

export async function initPermissionLayer() {
  const map = await loadUserPermissions();
  applyPermissionVisibility(map);
  applyTabPermissions(map);
  return map;
}
