import { apiRequest } from "../services/api.js";
import { getSessionUser } from "../services/auth.js";

const PERMS_KEY = "InfoCliente.permissions";
const PERMS_TS_KEY = "InfoCliente.permissionsAt";
const TAB_FB_KEY = "InfoCliente.tabFallbacks";
const CACHE_TTL_MS = 5 * 60 * 1000;

let memoryMap = null;
let memoryTabFallbacks = null;
let pendingLoadPromise = null;

export function getCachedPermissionMap() {
  if (memoryMap) return memoryMap;
  try {
    const raw = localStorage.getItem(PERMS_KEY);
    if (!raw) return null;
    const ts = Number(localStorage.getItem(PERMS_TS_KEY) || 0);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    memoryMap = JSON.parse(raw);
    return memoryMap;
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
  pendingLoadPromise = null;
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
    if (pendingLoadPromise) return pendingLoadPromise;
  }
  pendingLoadPromise = (async () => {
    try {
      const data = await apiRequest("/permissions/me");
      const map = data.map || {};
      setCachedPermissionMap(map);
      setTabFallbacks(data.tabFallbacks || {});
      return map;
    } catch {
      return getCachedPermissionMap() || {};
    } finally {
      pendingLoadPromise = null;
    }
  })();
  return pendingLoadPromise;
}

function evaluateAllowedValue(val, method = "GET") {
  if (val === "true" || val === true) return true;
  if (val === "own") return true;
  if (val === "view" && method === "GET") return true;
  return false;
}

export function canPermission(map, module, action = "view", { method = "GET" } = {}) {
  const role = (getSessionUser()?.role || "").toLowerCase();
  if (role === "admin") return true;
  if (!map || typeof map !== "object") return false;

  // Suporta especificação composta "mod1:act1|mod2:act2" passada no 2.º argumento
  if (typeof module === "string" && (module.includes("|") || (module.includes(":") && action === "view"))) {
    return canPermSpec(map, module, { method });
  }

  if (module === "navlinks" && action === "nav_registos") {
    if (Object.prototype.hasOwnProperty.call(map, "navlinks:nav_registos")) {
      return evaluateAllowedValue(map["navlinks:nav_registos"], method);
    }
    return role !== "cliente";
  }

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
  if ((manage === "true" || manage === true) && ["create", "edit", "delete", "approve", "manage", "view", "read"].includes(action)) return true;

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

/**
 * Avalia uma expressão de permissão simples ("obras:view"), alternativa ("stock:view|logistica:view")
 * ou cumulativa ("navlinks:nav_financeiro&financeiro:view").
 */
export function canPermSpec(map, spec, opts = {}) {
  const raw = String(spec || "").trim();
  if (!raw) return true;
  const role = (getSessionUser()?.role || "").toLowerCase();
  if (role === "admin") return true;

  // Or-clauses separated by "|"
  const orParts = raw.split("|").map((s) => s.trim()).filter(Boolean);
  if (!orParts.length) return true;

  return orParts.some((orPart) => {
    const andParts = orPart.split("&").map((s) => s.trim()).filter(Boolean);
    return andParts.every((atom) => {
      const { module, action } = parsePermSpec(atom);
      if (!module) return true;
      return canPermission(map, module, action, opts);
    });
  });
}

/**
 * Determina se um item ou grupo do menu (APP_MENU) pode ser acedido pelo utilizador atual.
 * Respeita tanto a permissão do menu/área (`navPerm`) como a permissão funcional do módulo (`perm`).
 */
export function canAccessMenuEntry(entry, map = getCachedPermissionMap()) {
  const user = getSessionUser();
  const role = (user?.role || "").toLowerCase();
  if (!role || role === "cliente") return false;
  if (role === "admin") return true;
  if (!entry) return false;

  // Se o mapa ainda não foi carregado, evita exibir itens restritos indevidamente
  if (!map || !Object.keys(map).length) return false;

  if (entry.navPerm && !canPermSpec(map, entry.navPerm)) {
    return false;
  }
  if (entry.perm && !canPermSpec(map, entry.perm)) {
    return false;
  }
  return true;
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
  return canPermSpec(map, spec);
}

/** Bloqueia menus/elementos com data-perm="modulo:acao" ou "mod1:act1|mod2:act2" */
export function applyPermissionVisibility(map) {
  document.querySelectorAll("[data-perm]").forEach((el) => {
    const spec = el.getAttribute("data-perm") || "";
    if (!spec.trim()) return;
    setElementPermissionDenied(el, !canPermSpec(map, spec));
  });

  document.querySelectorAll("[data-nav-perm]").forEach((el) => {
    const spec = String(el.getAttribute("data-nav-perm") || "").trim();
    if (!spec) return;
    if (!canPermSpec(map, spec)) {
      el.classList.add("hidden");
      if (el.tagName === "A" && !el.dataset.navDeniedBound) {
        el.dataset.navDeniedBound = "1";
        el.addEventListener("click", (e) => {
          if (!el.classList.contains("hidden")) return;
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
    const spec = el.getAttribute("data-perm") || "";
    if (!spec.trim()) return;
    setElementPermissionDenied(el, !canPermSpec(map, spec));
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

  document.querySelectorAll("[data-tab-group]").forEach((group) => {
    const items = [...group.querySelectorAll("[data-tab-trigger], [data-tab], [data-stock-subtab]")];
    const anyVisible = items.some(
      (el) => el.dataset.permDenied !== "true" && !el.classList.contains("hidden")
    );
    group.classList.toggle("hidden", items.length > 0 && !anyVisible);
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
  const current = triggers.find(
    (t) => t.classList.contains("border-slate-900") || t.classList.contains("is-active")
  );
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

/** Lista ordenada de rotas candidatas para redirecionamento quando o acesso é negado ou pós-login */
export const ACCESSIBLE_FALLBACK_ROUTES = [
  { spec: "navlinks:nav_dashboard&dashboard:view", path: "/Dashboard/index.html" },
  { spec: "navlinks:nav_obras&obras:view", path: "/Projectos/ProjectGeral.html" },
  { spec: "navlinks:nav_clientes&clientes:view", path: "/Clientes/clienteLista.html" },
  { spec: "navlinks:nav_logistica&stock:view", path: "/Stock/index.html" },
  { spec: "navlinks:nav_logistica&logistica:view", path: "/Stock/index.html" },
  { spec: "navlinks:nav_financeiro&financeiro:view", path: "/Financeiro/overview" },
  { spec: "navlinks:nav_comercial&comercial:tab_orcamentos", path: "/comercial/orcamentos" },
  { spec: "navlinks:nav_comercial&comercial:view", path: "/comercial/orcamentos" },
  { spec: "navlinks:nav_cotacao&obras:view", path: "/Projectos/Cotacao/index.html" },
  { spec: "navlinks:nav_centros_gerais&pedidosExtras:view", path: "/Financeiro/centro-pagamentos" },
  { spec: "navlinks:nav_frota&frota:view", path: "/frota/painel" },
  { spec: "navlinks:nav_registos&cadastros:view", path: "/registos/contactos" },
  { spec: "navlinks:nav_registos&materiais:view", path: "/registos/produtos" },
  { spec: "navlinks:nav_registos&ferramentas:view", path: "/registos/equipamentos" },
  { spec: "navlinks:nav_users&sistema:view", path: "/Users/index.html" },
  { spec: "navlinks:nav_users&permissoes:view", path: "/Users/index.html" },
  { spec: "navlinks:nav_users&permissoes:manage_permissions", path: "/Users/index.html" },
  { spec: "dashboard:view", path: "/Dashboard/index.html" },
  { spec: "obras:view", path: "/Projectos/ProjectGeral.html" },
  { spec: "clientes:view", path: "/Clientes/clienteLista.html" },
  { spec: "stock:view|logistica:view", path: "/Stock/index.html" },
  { spec: "financeiro:view", path: "/Financeiro/overview" },
  { spec: "comercial:tab_orcamentos|comercial:view", path: "/comercial/orcamentos" },
  { spec: "cadastros:view", path: "/registos/contactos" },
  { spec: "sistema:view|permissoes:view|permissoes:manage_permissions", path: "/Users/index.html" },
];

export function resolveFirstAccessiblePath(map, role = (getSessionUser()?.role || "").toLowerCase()) {
  if (role === "cliente") return "/Dashboard/clientDashboard.html";
  if (role === "tecnico" && canPermSpec(map, "obras:view")) return "/Projectos/tecnicoPlanos.html";

  for (const route of ACCESSIBLE_FALLBACK_ROUTES) {
    if (canPermSpec(map, route.spec)) {
      return route.path;
    }
  }
  return role === "tecnico" ? "/Projectos/tecnicoPlanos.html" : "/Dashboard/index.html";
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
  const target = resolveFirstAccessiblePath(map, role);

  if (!here.includes(target.replace(/\.html$/, ""))) {
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
