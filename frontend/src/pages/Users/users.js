import { apiRequest, getAssetUrl } from "../../services/api.js";
import { checkAuth, getSessionUser } from "../../services/auth.js";
import { openModal, toast, setButtonLoading, renderLoadingRow, initMobileMenu } from "../../shared/ui.js";
import { formatDateBR } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

checkAuth({ allowedRoles: ["admin"] });

function el(id) { return document.getElementById(id); }
function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── State ────────────────────────────────────────────────────
let allUsers = [];
let activeSection = "overview";

// ─── Role helpers ─────────────────────────────────────────────
const ROLE_STYLES = {
  admin: { cls: "bg-slate-900 text-[#2afc8d] border-slate-800", icon: "verified_user" },
  operador: { cls: "bg-blue-50 text-blue-700 border-blue-100", icon: "engineering" },
  tecnico: { cls: "bg-indigo-50 text-indigo-700 border-indigo-100", icon: "construction" },
  supervisor: { cls: "bg-purple-50 text-purple-700 border-purple-100", icon: "manage_accounts" },
  leitura: { cls: "bg-slate-50 text-slate-500 border-slate-200", icon: "visibility" },
  cliente: { cls: "bg-emerald-50 text-emerald-700 border-emerald-100", icon: "business" },
};
function roleBadge(role) {
  const s = ROLE_STYLES[role] || ROLE_STYLES.leitura;
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${s.cls}">
    <span class="material-symbols-outlined text-[12px]">${s.icon}</span>${role}
  </span>`;
}
// Avatar — inline styles evitam purge de classes dinâmicas pelo Tailwind
const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#059669", "#d97706", "#e11d48", "#4f46e5", "#0891b2", "#dc2626"];
function avatarEl(email, profilePic) {
  const initials = (email || "?")[0].toUpperCase();
  const bg = AVATAR_COLORS[(email || "").charCodeAt(0) % AVATAR_COLORS.length];

  const fallback = `<div style='width:2.25rem;height:2.25rem;border-radius:.75rem;background:${bg};display:flex;align-items:center;justify-content:center;color:#fff;font-size:.75rem;font-weight:900;flex-shrink:0'>${initials}</div>`;

  const raw = String(profilePic || "").trim();
  const isExternal = /^https?:\/\//i.test(raw);
  const isLocalUpload = raw.startsWith("uploads/") || raw.includes("/uploads/");
  if (raw && (isLocalUpload || !isExternal)) {
    const picUrl = getAssetUrl(raw);
    if (picUrl) {
      return `<img src="${esc(picUrl)}" alt="${initials}" style="width:2.25rem;height:2.25rem;border-radius:.75rem;object-fit:cover;flex-shrink:0" 
                onerror="this.outerHTML='${fallback.replace(/'/g, "\\'")}'"/>`;
    }
  }
  return fallback;
}

// ─── Section switching ─────────────────────────────────────────
const SECTION_LABELS = { overview: "Visão Geral", users: "Utilizadores", permissions: "Permissões" };

function switchSection(name) {
  activeSection = name;
  ["overview", "users", "permissions", "history"].forEach(s => {
    el(`section-${s}`)?.classList.toggle("hidden", s !== name);
  });
  // Update all sidebar links (desktop + mobile)
  document.querySelectorAll(".sidebar-link[data-section]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.section === name);
  });
  const lbl = el("breadcrumb-label");
  if (lbl) lbl.textContent = SECTION_LABELS[name] || name;
  // Scroll main content to top
  document.querySelector(".admin-main")?.scrollTo({ top: 0 });
  window.scrollTo({ top: 0, behavior: "instant" });
  if (name === "users") renderTable(filterUsers());
  if (name === "permissions") renderPermissions();
  if (name === "history") loadLogs();
}

// ─── Stats ────────────────────────────────────────────────────
function renderStats(users) {
  const total = users.length;
  const admins = users.filter(u => u.role === "admin").length;
  const supervisors = users.filter(u => u.role === "supervisor").length;
  const technicians = users.filter(u => u.role === "tecnico").length;
  const team = users.filter(u => ["operador", "leitura"].includes(u.role)).length;
  const clients = users.filter(u => u.role === "cliente").length;

  el("stat-total")?.textContent !== undefined && (el("stat-total").textContent = total);
  el("stat-admin")?.textContent !== undefined && (el("stat-admin").textContent = admins);
  el("stat-supervisor")?.textContent !== undefined && (el("stat-supervisor").textContent = supervisors);
  el("stat-technician")?.textContent !== undefined && (el("stat-technician").textContent = technicians);
  el("stat-team")?.textContent !== undefined && (el("stat-team").textContent = team);
  el("stat-clients")?.textContent !== undefined && (el("stat-clients").textContent = clients);
  el("sidebar-count") && (el("sidebar-count").textContent = total);
  el("users-count-label") && (el("users-count-label").textContent = filterUsers().length);
}

// ─── Recent users list (overview) ─────────────────────────────
function renderRecentUsers(users) {
  const host = el("recent-users-list");
  if (!host) return;
  const recent = [...users].slice(0, 6);
  if (!recent.length) {
    host.innerHTML = `<div class="px-7 py-8 text-sm text-slate-400">Nenhum utilizador registado.</div>`;
    return;
  }
  host.innerHTML = recent.map((u, i) => {
    const numStr = String(i + 1).padStart(2, '0');
    return `
    <div class="flex items-center gap-4 px-7 py-4 hover:bg-slate-50 transition-colors">
      <div class="relative">
        ${avatarEl(u.email, u.profilePic || u.client?.profilePic)}
        <span class="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-[8px] font-black shadow-sm border border-white">
          ${numStr}
        </span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-slate-900 truncate">${esc(u.email)}</div>
        <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID: ${u.id.slice(0, 8)}</div>
      </div>
      ${roleBadge(u.role)}
      <div class="text-[11px] text-slate-400 font-medium whitespace-nowrap hidden sm:block">${formatDateBR(u.createdAt)}</div>
      <button data-edit-user="${u.id}" class="h-8 px-3 rounded-lg border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-900 hover:text-[#2afc8d] hover:border-slate-900 transition-all">
        Editar
      </button>
    </div>
  `}).join("");
}

// ─── Users table ──────────────────────────────────────────────
function filterUsers() {
  const q = (el("searchInput")?.value || "").toLowerCase();
  const r = el("roleFilter")?.value || "";
  return allUsers.filter(u =>
    (!q || u.email.toLowerCase().includes(q) || (u.name && u.name.toLowerCase().includes(q))) &&
    (!r || u.role === r)
  ).sort((a, b) => {
    const nameA = (a.name || a.email || "").toLowerCase();
    const nameB = (b.name || b.email || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

function renderRow(u, idx = 1) {
  const numStr = String(idx).padStart(2, '0');
  return `
    <tr class="hover:bg-slate-50 transition-colors group border-b border-slate-50 last:border-0">
      <td class="px-7 py-4">
        <div class="flex items-center gap-3">
          <div class="relative">
            ${avatarEl(u.email, u.profilePic || u.client?.profilePic)}
            <span class="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-[8px] font-black shadow-sm border border-white">
              ${numStr}
            </span>
          </div>
          <div>
            <div class="text-sm font-bold text-slate-900">${esc(u.name || u.email)}</div>
            ${u.name ? `<div class="text-[10px] text-slate-400 font-medium">${esc(u.email)}</div>` : ''}
            <div class="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">ID: ${u.id.slice(0, 8)}</div>
          </div>
        </div>
      </td>
      <td class="px-7 py-4">${roleBadge(u.role)}</td>
      <td class="px-7 py-4 hidden md:table-cell">
        ${u.client
      ? `<div class="flex flex-col"><span class="text-sm font-semibold text-slate-700">${esc(u.client.name)}</span>
             <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">${esc(u.client.code)}</span></div>`
      : `<span class="text-slate-400 text-sm">—</span>`}
      </td>
      <td class="px-7 py-4 text-sm text-slate-500 font-medium whitespace-nowrap hidden lg:table-cell">${formatDateBR(u.createdAt)}</td>
      <td class="px-7 py-4 text-right">
        <div class="flex items-center justify-end gap-2">
          <button type="button" data-user-perms="${u.id}" class="h-8 px-2.5 md:px-3 rounded-lg border border-violet-200 bg-violet-50 text-[9px] font-black uppercase tracking-widest text-violet-700 hover:bg-violet-100 transition-all flex items-center gap-1" title="Permissões individuais">
            <span class="material-symbols-outlined text-base">shield_person</span>
            <span class="hidden sm:inline">Permissões</span>
          </button>
          <button type="button" data-edit-user="${u.id}" class="h-8 px-3 rounded-lg border border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-900 hover:text-[#2afc8d] hover:border-slate-900 transition-all">
            Editar
          </button>
          <button type="button" data-delete-user="${u.id}" class="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      </td>
    </tr>`;
}

function renderTable(users) {
  const tbody = el("usersTbody");
  if (!tbody) return;
  el("users-count-label") && (el("users-count-label").textContent = users.length);
  tbody.innerHTML = users.length
    ? users.map((u, i) => renderRow(u, i + 1)).join("")
    : `<tr><td colspan="5" class="px-7 py-10 text-sm text-slate-400 text-center">Nenhum utilizador encontrado.</td></tr>`;
}

// ─── Permissions — catálogo dinâmico (API) ──────────────────────

const ROLES = ["admin", "operador", "tecnico", "supervisor", "leitura", "cliente"];

/** Fallback se API do catálogo falhar */
const PERM_DISPLAY_FALLBACK = [
  { group: "Dashboard", module: "dashboard", rows: [{ label: "Visualizar", module: "dashboard", action: "view" }] },
  { group: "Clientes", module: "clientes", rows: [{ label: "Visualizar", module: "clientes", action: "view" }] },
  { group: "Obras", module: "obras", rows: [{ label: "Visualizar", module: "obras", action: "view" }] },
  { group: "Stock", module: "stock", rows: [{ label: "Visualizar", module: "stock", action: "view" }] },
  { group: "Utilizadores", module: "sistema", rows: [{ label: "Visualizar", module: "sistema", action: "view" }] },
];

let permDisplayCatalog = [];
let permActionLabels = {};
let permFilterModule = "";
let permFilterQuery = "";
/** Módulos recolhidos (Set de module id) */
const permCollapsedModules = new Set();
const PERM_COLLAPSE_STORAGE_KEY = "InfoCliente.permCollapsedModules";

function loadPermCollapsedState() {
  try {
    const raw = sessionStorage.getItem(PERM_COLLAPSE_STORAGE_KEY);
    if (!raw) return;
    JSON.parse(raw).forEach((m) => permCollapsedModules.add(m));
  } catch { /* ignore */ }
}

function savePermCollapsedState() {
  sessionStorage.setItem(PERM_COLLAPSE_STORAGE_KEY, JSON.stringify([...permCollapsedModules]));
}

function isPermFilterActive() {
  return Boolean(permFilterQuery.trim() || permFilterModule.trim());
}

function isModuleExpanded(moduleId) {
  if (isPermFilterActive()) return true;
  return !permCollapsedModules.has(moduleId);
}

function setModuleExpanded(moduleId, expanded) {
  if (expanded) permCollapsedModules.delete(moduleId);
  else permCollapsedModules.add(moduleId);
  savePermCollapsedState();
}

function toggleModuleExpanded(moduleId) {
  setModuleExpanded(moduleId, !isModuleExpanded(moduleId));
}

loadPermCollapsedState();

// Ciclo ao clicar: sem acesso → leitura restrita → próprios → total
const ALLOWED_CYCLE = ["false", "view", "own", "true"];

// Build lookup key
function permKey(role, module, action) { return `${role}|${module}|${action}`; }

// In-memory map populated from API: key → allowed string
let permMap = {};
// Track which cells are currently saving
const savingCells = new Set();

function permIcon(allowed, { role, module: mod, action, clickable } = {}) {
  const val = allowed;
  const actionLabel = permActionLabels[action] || action;
  let icon, cls, title;
  if (val === "true")  { icon = "check_circle"; cls = "perm-yes";  title = `${actionLabel}: Acesso total`; }
  else if (val === "own")  { icon = "check_circle"; cls = "perm-part"; title = `${actionLabel}: Apenas registos próprios`; }
  else if (val === "view") { icon = "check_circle"; cls = "perm-part"; title = `${actionLabel}: Apenas leitura (GET)`; }
  else                     { icon = "cancel";       cls = "perm-no";  title = `${actionLabel}: Sem acesso`; }

  const key = permKey(role, mod, action);
  const isSaving = savingCells.has(key);

  if (clickable) {
    const cursor = isSaving ? "cursor-wait" : "cursor-pointer";
    const pulse  = isSaving ? "animate-pulse" : "";
    return `<button type="button"
      class="role-perm-cell ${cursor} ${pulse} w-9 h-9 rounded-xl flex items-center justify-center mx-auto transition-all hover:scale-110 hover:shadow-md"
      data-perm-role="${esc(role)}" data-perm-module="${esc(mod)}" data-perm-action="${esc(action)}"
      title="${title} — clique para alterar"
      ${isSaving ? "disabled" : ""}>
      <span class="material-symbols-outlined ${cls}">${icon}</span>
    </button>`;
  }
  return `<span class="material-symbols-outlined ${cls}" title="${title}">${icon}</span>`;
}

async function savePermission(role, mod, action, newAllowed) {
  if (!role || !mod || !action) {
    console.warn("savePermission: parâmetros inválidos", { role, mod, action });
    return;
  }
  const key = permKey(role, mod, action);
  savingCells.add(key);
  refreshPermCell(role, mod, action);
  try {
    await apiRequest(`/permissions/${encodeURIComponent(role)}/${encodeURIComponent(mod)}/${encodeURIComponent(action)}`,
      { method: "PUT", body: { allowed: newAllowed } });
    permMap[key] = newAllowed;
    toast(`Permissão actualizada: ${role} / ${mod} / ${action}`, { type: "success" });
  } catch (err) {
    toast(err.message || "Erro ao guardar permissão.", { type: "error" });
  } finally {
    savingCells.delete(key);
    refreshPermCell(role, mod, action);
  }
}

function refreshPermCell(role, mod, action) {
  const cell = document.querySelector(
    `button.role-perm-cell[data-perm-role="${role}"][data-perm-module="${mod}"][data-perm-action="${action}"]`
  );
  if (!cell) return;
  const key = permKey(role, mod, action);
  const allowed = permMap[key] || "false";
  cell.outerHTML = permIcon(allowed, { role, module: mod, action, clickable: true });
}

function normalizeDisplayCatalog(catalog) {
  if (!catalog?.groups?.length) return PERM_DISPLAY_FALLBACK;
  return catalog.groups.map((g) => ({
    group: g.group,
    module: g.module,
    icon: g.icon,
    pages: g.pages || [],
    tabs: (g.tabs || []).map((t) => ({
      label: t.label,
      module: t.module,
      action: t.action,
      pageLabel: t.pageLabel,
      route: t.route,
    })),
    rows: (g.rows || []).map((r) => ({
      label: r.label,
      module: r.module,
      action: r.action,
    })),
  }));
}

function filterDisplayCatalog(catalog) {
  const q = permFilterQuery.trim().toLowerCase();
  const mod = permFilterModule.trim().toLowerCase();
  return catalog
    .filter((g) => !mod || g.module === mod || g.group.toLowerCase().includes(mod))
    .map((g) => {
      const rows = g.rows.filter((r) => {
        if (!q) return true;
        return (
          r.label.toLowerCase().includes(q) ||
          r.action.toLowerCase().includes(q) ||
          g.group.toLowerCase().includes(q) ||
          (g.pages || []).some((p) => p.label?.toLowerCase().includes(q))
        );
      });
      const tabs = (g.tabs || []).filter((t) => {
        if (!q) return true;
        return (
          t.label.toLowerCase().includes(q) ||
          t.action.toLowerCase().includes(q) ||
          (t.pageLabel || "").toLowerCase().includes(q) ||
          g.group.toLowerCase().includes(q)
        );
      });
      return { ...g, rows, tabs };
    })
    .filter((g) => g.rows.length > 0 || (g.tabs || []).length > 0);
}

async function loadPermissions() {
  const tbody = el("permTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="px-7 py-10 text-center">
    <div class="inline-flex items-center gap-3 text-sm text-slate-400 font-medium">
      <span class="material-symbols-outlined animate-spin text-lg">progress_activity</span>A carregar permissões…
    </div></td></tr>`;
  try {
    const data = await apiRequest("/permissions");
    permMap = {};
    (data.items || []).forEach((r) => { permMap[permKey(r.role, r.module, r.action)] = r.allowed; });
    permActionLabels = data.catalog?.actionLabels || {};
    permDisplayCatalog = normalizeDisplayCatalog(data.catalog);
    initDefaultPermCollapse(permDisplayCatalog);
    populatePermModuleFilter(permDisplayCatalog);
  } catch {
    tbody.innerHTML = `<tr><td colspan="7" class="px-7 py-8 text-center text-sm text-red-400">Erro ao carregar permissões.</td></tr>`;
    permDisplayCatalog = PERM_DISPLAY_FALLBACK;
    return;
  }
  renderPermissionsTable();
}

/** Primeira visita: só módulos principais abertos para reduzir ruído visual */
function initDefaultPermCollapse(catalog) {
  if (permCollapsedModules.size > 0 || sessionStorage.getItem(PERM_COLLAPSE_STORAGE_KEY)) return;
  const openByDefault = new Set(["dashboard", "clientes", "obras", "stock", "sistema"]);
  catalog.forEach((g) => {
    if (!openByDefault.has(g.module)) permCollapsedModules.add(g.module);
  });
  savePermCollapsedState();
}

function populatePermModuleFilter(catalog) {
  const sel = el("permModuleFilter");
  if (!sel) return;
  const mods = [...new Set(catalog.map((g) => g.module))];
  sel.innerHTML = `<option value="">Todos os módulos</option>${mods.map((m) => {
    const label = catalog.find((g) => g.module === m)?.group || m;
    return `<option value="${esc(m)}">${esc(label)}</option>`;
  }).join("")}`;
}

function countModuleGranted(group) {
  let granted = 0;
  let total = 0;
  const entries = [
    ...group.rows.map((r) => ({ module: r.module, action: r.action })),
    ...(group.tabs || []).map((t) => ({ module: t.module, action: t.action })),
  ];
  entries.forEach(({ module: mod, action }) => {
    ROLES.forEach((role) => {
      total++;
      const v = permMap[permKey(role, mod, action)] ?? "false";
      if (v === "true" || v === "own" || v === "view") granted++;
    });
  });
  return { granted, total };
}

function renderPermTabRow(tab, groupModule, hiddenCls) {
  const { label, module: mod, action, pageLabel, route } = tab;
  let html = `<tr class="hover:bg-violet-50/30 transition-colors border-b border-slate-50 perm-tab-row${hiddenCls}"
    data-parent-module="${esc(groupModule)}" data-module="${esc(mod)}" data-action="${esc(action)}">
    <td class="px-7 py-3 pl-12">
      <div class="flex items-center gap-2">
        <span class="w-1 h-8 rounded-full bg-violet-300 shrink-0"></span>
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="material-symbols-outlined text-violet-500 text-base">tab</span>
            <div class="text-sm font-semibold text-slate-800">${esc(label)}</div>
            <span class="perm-tab-page-badge" title="${esc(route || "")}">${esc(pageLabel || "Página")}</span>
          </div>
          <div class="text-[9px] font-mono text-violet-500/80 mt-0.5">${esc(mod)} · ${esc(action)}</div>
        </div>
      </div>
    </td>`;
  ROLES.forEach((role) => {
    const key = permKey(role, mod, action);
    const val = permMap[key] ?? "false";
    html += `<td class="px-4 py-3 text-center">${permIcon(val, { role, module: mod, action, clickable: true })}</td>`;
  });
  html += "</tr>";
  return html;
}

function renderPermissionsTable() {
  const tbody = el("permTableBody");
  if (!tbody) return;
  const catalog = filterDisplayCatalog(permDisplayCatalog);
  if (!catalog.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-7 py-8 text-center text-sm text-slate-400">Nenhuma permissão corresponde ao filtro.</td></tr>`;
    return;
  }

  let html = "";
  let rowCount = 0;

  catalog.forEach((group) => {
    const expanded = isModuleExpanded(group.module);
    const collapsedCls = expanded ? "" : " is-collapsed";
    const hiddenCls = expanded ? "" : " is-hidden-row";
    const { granted, total } = countModuleGranted(group);
    const tabCount = (group.tabs || []).length;
    const actionCount = group.rows.length;

    html += `<tr class="bg-slate-50/40 border-b border-slate-100 perm-module-row${collapsedCls}" data-module="${esc(group.module)}">
      <td colspan="7">
        <button type="button" class="perm-module-toggle" data-perm-toggle="${esc(group.module)}"
          aria-expanded="${expanded ? "true" : "false"}"
          aria-controls="perm-block-${esc(group.module)}">
          <span class="material-symbols-outlined perm-chevron">expand_more</span>
          <span class="material-symbols-outlined text-base text-[#0d3fd1]">${esc(group.icon || "folder")}</span>
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-700">${esc(group.group)}</span>
          <span class="perm-module-badge">${tabCount ? `${tabCount} abas · ` : ""}${actionCount} acções · ${granted}/${total} activas</span>
        </button>
      </td>
    </tr>`;

    if ((group.pages || []).length) {
      html += `<tr class="perm-pages-panel${hiddenCls}" data-parent-module="${esc(group.module)}" id="perm-pages-${esc(group.module)}">
        <td colspan="7">
          ${(group.pages || []).map((p) => `
            <span class="perm-page-chip" title="${esc(p.route || "")}">
              <span class="material-symbols-outlined text-[14px]">web</span>${esc(p.label)}
            </span>`).join("")}
        </td>
      </tr>`;
    }

    if ((group.tabs || []).length) {
      html += `<tr class="perm-tabs-header${hiddenCls}" data-parent-module="${esc(group.module)}">
        <td colspan="7" class="px-7 py-2 pl-12 bg-violet-50/40 border-b border-violet-100">
          <span class="text-[9px] font-black uppercase tracking-widest text-violet-700">Abas visíveis na interface</span>
          <span class="text-[9px] font-medium text-violet-500/80 ml-2">— clique nas células para mostrar ou ocultar cada aba</span>
        </td>
      </tr>`;
      group.tabs.forEach((tab) => {
        rowCount++;
        html += renderPermTabRow(tab, group.module, hiddenCls);
      });
    }

    group.rows.forEach(({ label, module: mod, action }) => {
      rowCount++;
      html += `<tr class="hover:bg-slate-50/50 transition-colors border-b border-slate-50 perm-action-row${hiddenCls}"
        data-parent-module="${esc(group.module)}" data-module="${esc(mod)}" data-action="${esc(action)}">
        <td class="px-7 py-3.5 pl-12">
          <div class="flex items-center gap-2">
            <span class="w-1 h-8 rounded-full bg-slate-200 shrink-0"></span>
            <div>
              <div class="text-sm font-medium text-slate-700">${esc(label)}</div>
              <div class="text-[9px] font-mono text-slate-400 mt-0.5">${esc(mod)} · ${esc(action)}</div>
            </div>
          </div>
        </td>`;
      ROLES.forEach((role) => {
        const key = permKey(role, mod, action);
        const val = permMap[key] ?? "false";
        const locked =
          (role === "admin" && mod === "sistema" && ["view", "full_access"].includes(action)) ||
          (role === "admin" && mod === "permissoes" && action === "manage_permissions");
        html += `<td class="px-4 py-3.5 text-center">${permIcon(val, { role, module: mod, action, clickable: !locked })}</td>`;
      });
      html += "</tr>";
    });
  });

  const expandedCount = catalog.filter((g) => isModuleExpanded(g.module)).length;
  el("permRowCount") && (el("permRowCount").textContent = `${rowCount} acções · ${expandedCount}/${catalog.length} módulos abertos`);
  const wrap = document.querySelector(".perm-table-wrap");
  const scrollTop = wrap?.scrollTop ?? 0;
  tbody.innerHTML = html;
  if (wrap) wrap.scrollTop = scrollTop;
}

function updateModuleCollapseUI(moduleId) {
  const expanded = isModuleExpanded(moduleId);
  const hiddenCls = expanded ? "" : " is-hidden-row";
  const moduleRow = document.querySelector(`.perm-module-row[data-module="${moduleId}"]`);
  if (moduleRow) {
    moduleRow.classList.toggle("is-collapsed", !expanded);
    const btn = moduleRow.querySelector("[data-perm-toggle]");
    if (btn) btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
  document.querySelectorAll(`[data-parent-module="${moduleId}"]`).forEach((row) => {
    row.classList.toggle("is-hidden-row", !expanded);
  });
}

function expandAllPermModules() {
  permCollapsedModules.clear();
  savePermCollapsedState();
  renderPermissionsTable();
}

function collapseAllPermModules() {
  const catalog = filterDisplayCatalog(permDisplayCatalog);
  catalog.forEach((g) => permCollapsedModules.add(g.module));
  savePermCollapsedState();
  renderPermissionsTable();
}

// ─── Permissões por utilizador individual ───────────────────────

const USER_PERM_CYCLE = ["inherit", "false", "view", "own", "true"];
let activeUserPermState = null;
const userPermSaving = new Set();

function userPermStateKey(userId, mod, action) {
  return `${userId}|${mod}|${action}`;
}

function userPermIconHtml(effective, roleVal, isOverride, { userId, module: mod, action }) {
  const actionLabel = permActionLabels[action] || action;
  let icon, cls, title;
  if (effective === "true") { icon = "check_circle"; cls = "perm-yes"; title = `${actionLabel}: Acesso total`; }
  else if (effective === "own") { icon = "check_circle"; cls = "perm-part"; title = `${actionLabel}: Apenas próprios`; }
  else if (effective === "view") { icon = "check_circle"; cls = "perm-part"; title = `${actionLabel}: Só leitura`; }
  else { icon = "cancel"; cls = "perm-no"; title = `${actionLabel}: Sem acesso`; }

  const inheritHint = isOverride ? " (personalizado)" : " (herda do perfil)";
  const ring = isOverride
    ? " ring-2 ring-violet-400 ring-offset-1"
    : " ring-2 ring-dashed ring-slate-300 ring-offset-1";
  const key = userPermStateKey(userId, mod, action);
  const saving = userPermSaving.has(key);

  return `<button type="button"
    class="user-perm-cell ${saving ? "cursor-wait animate-pulse" : "cursor-pointer"} w-9 h-9 rounded-xl flex items-center justify-center mx-auto transition-all hover:scale-110${ring}"
    data-user-id="${esc(userId)}" data-perm-module="${esc(mod)}" data-perm-action="${esc(action)}"
    title="${title}${inheritHint} — clique para alterar"
    ${saving ? "disabled" : ""}>
    <span class="material-symbols-outlined ${cls}">${icon}</span>
  </button>`;
}

function rolePermIconHtml(roleVal) {
  let icon, cls;
  if (roleVal === "true") { icon = "check_circle"; cls = "perm-yes opacity-50"; }
  else if (roleVal === "own" || roleVal === "view") { icon = "check_circle"; cls = "perm-part opacity-50"; }
  else { icon = "cancel"; cls = "perm-no"; }
  return `<span class="material-symbols-outlined ${cls} text-lg" title="Valor do perfil">${icon}</span>`;
}

function buildUserPermTableHtml(state) {
  const catalog = normalizeDisplayCatalog(state.catalog?.groups ? { groups: state.catalog.groups } : null);
  const { userId, effectiveMap, roleMap, overrideKeys } = state;
  let overrideCount = overrideKeys.length;
  let html = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
      <div>
        <div class="text-sm font-bold text-slate-900">${esc(state.user.name || state.user.email)}</div>
        <div class="text-[10px] text-slate-500 mt-0.5">Perfil base: ${roleBadge(state.user.role)}</div>
      </div>
      <div class="text-[10px] font-black uppercase tracking-widest text-violet-600">
        <span id="userPermOverrideCount">${overrideCount}</span> personalizações
      </div>
    </div>
    <p class="text-[11px] text-slate-500 mb-4">Clique na coluna <strong>Efectivo</strong> para personalizar. Ciclo: herdar perfil → negar → leitura → próprios → total.</p>
    <div class="max-h-[55vh] overflow-y-auto border border-slate-100 rounded-xl">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 sticky top-0 z-10">
          <tr class="text-[9px] font-black uppercase tracking-widest text-slate-400">
            <th class="px-4 py-3 w-[40%]">Acção</th>
            <th class="px-3 py-3 text-center w-[20%]">Perfil</th>
            <th class="px-3 py-3 text-center w-[20%]">Efectivo</th>
          </tr>
        </thead>
        <tbody>`;

  catalog.forEach((group) => {
    html += `<tr class="bg-slate-50/80"><td colspan="3" class="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
      <span class="material-symbols-outlined text-sm align-middle text-[#0d3fd1]">${esc(group.icon || "folder")}</span> ${esc(group.group)}
    </td></tr>`;
    if ((group.tabs || []).length) {
      html += `<tr class="bg-violet-50/40"><td colspan="3" class="px-4 py-1.5 pl-8 text-[9px] font-black uppercase tracking-widest text-violet-600">Abas</td></tr>`;
      group.tabs.forEach((tab) => {
        const key = `${tab.module}:${tab.action}`;
        const effective = effectiveMap[key] ?? "false";
        const roleVal = roleMap[key] ?? "false";
        const isOverride = overrideKeys.includes(key);
        html += `<tr class="border-t border-violet-50 hover:bg-violet-50/30" data-user-perm-row data-perm-key="${esc(key)}">
          <td class="px-4 py-2 pl-10">
            <div class="font-medium text-slate-700 text-sm">${esc(tab.label)}</div>
            <div class="text-[9px] text-violet-600/80">${esc(tab.pageLabel || "")} · ${esc(tab.module)} · ${esc(tab.action)}</div>
          </td>
          <td class="px-3 py-2 text-center">${rolePermIconHtml(roleVal)}</td>
          <td class="px-3 py-2 text-center">${userPermIconHtml(effective, roleVal, isOverride, { userId, module: tab.module, action: tab.action })}</td>
        </tr>`;
      });
    }
    group.rows.forEach(({ label, module: mod, action }) => {
      const key = `${mod}:${action}`;
      const effective = effectiveMap[key] ?? "false";
      const roleVal = roleMap[key] ?? "false";
      const isOverride = overrideKeys.includes(key);
      html += `<tr class="border-t border-slate-50 hover:bg-slate-50/50" data-user-perm-row data-perm-key="${esc(key)}">
        <td class="px-4 py-2.5 pl-6">
          <div class="font-medium text-slate-700">${esc(label)}</div>
          <div class="text-[9px] font-mono text-slate-400">${esc(mod)} · ${esc(action)}</div>
        </td>
        <td class="px-3 py-2.5 text-center">${rolePermIconHtml(roleVal)}</td>
        <td class="px-3 py-2.5 text-center">${userPermIconHtml(effective, roleVal, isOverride, { userId, module: mod, action })}</td>
      </tr>`;
    });
  });

  html += `</tbody></table></div>`;
  return html;
}

function resolveNextUserPermAllowed(state, mapKey) {
  const roleVal = state.roleMap[mapKey] ?? "false";
  const isOverride = state.overrideKeys.includes(mapKey);
  const current = isOverride ? (state.effectiveMap[mapKey] ?? "false") : "inherit";
  let idx = USER_PERM_CYCLE.indexOf(current);
  for (let i = 0; i < USER_PERM_CYCLE.length; i++) {
    idx = (idx + 1) % USER_PERM_CYCLE.length;
    const next = USER_PERM_CYCLE[idx];
    if (next === "inherit") return "inherit";
    if (current === "inherit" && next === roleVal) continue;
    return next;
  }
  return "view";
}

function refreshUserPermModalUI(state) {
  const body = state.panel?.querySelector("[data-body]");
  if (!body) return;
  const scrollTop = body.scrollTop;
  body.innerHTML = buildUserPermTableHtml(state);
  body.scrollTop = scrollTop;
  const countEl = document.getElementById("userPermOverrideCount");
  if (countEl) countEl.textContent = String(state.overrideKeys.length);
  activeUserPermState = state;
}

function refreshUserPermCell(userId, mod, action, state) {
  const mapKey = `${mod}:${action}`;
  const row = state.panel?.querySelector(`[data-user-perm-row][data-perm-key="${CSS.escape(mapKey)}"]`);
  if (!row) {
    refreshUserPermModalUI(state);
    return;
  }
  const effective = state.effectiveMap[mapKey] ?? "false";
  const roleVal = state.roleMap[mapKey] ?? "false";
  const isOverride = state.overrideKeys.includes(mapKey);
  const cells = row.querySelectorAll("td");
  if (cells[1]) cells[1].innerHTML = rolePermIconHtml(roleVal);
  if (cells[2]) {
    cells[2].innerHTML = userPermIconHtml(effective, roleVal, isOverride, { userId, module: mod, action });
  }
  const countEl = document.getElementById("userPermOverrideCount");
  if (countEl) countEl.textContent = String(state.overrideKeys.length);
  activeUserPermState = state;
}

async function saveUserPermission(userId, mod, action, nextAllowed, state) {
  const key = userPermStateKey(userId, mod, action);
  const mapKey = `${mod}:${action}`;
  userPermSaving.add(key);
  refreshUserPermCell(userId, mod, action, state);
  try {
    const res = await apiRequest(
      `/permissions/users/${encodeURIComponent(userId)}/${encodeURIComponent(mod)}/${encodeURIComponent(action)}`,
      { method: "PUT", body: { allowed: nextAllowed } }
    );
    state.effectiveMap[mapKey] = res.allowed ?? state.effectiveMap[mapKey];
    if (res.inherited || res.source === "role") {
      state.overrideKeys = state.overrideKeys.filter((k) => k !== mapKey);
    } else if (!state.overrideKeys.includes(mapKey)) {
      state.overrideKeys.push(mapKey);
    }

    const me = getSessionUser();
    if (me?.id === userId) {
      const { clearPermissionCache, loadUserPermissions } = await import("../../shared/permissions.js");
      clearPermissionCache();
      await loadUserPermissions({ force: true });
    }
    toast("Permissão do utilizador actualizada.", { type: "success" });
  } catch (err) {
    toast(err.message || "Erro ao guardar.", { type: "error" });
  } finally {
    userPermSaving.delete(key);
    refreshUserPermCell(userId, mod, action, state);
  }
}

function wireUserPermClicks() {
  if (wireUserPermClicks._done) return;
  wireUserPermClicks._done = true;

  document.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("button.user-perm-cell");
    if (!btn) return;

    const state = activeUserPermState;
    if (!state) return;

    const userId = btn.getAttribute("data-user-id") || state.userId;
    const mod = btn.getAttribute("data-perm-module");
    const action = btn.getAttribute("data-perm-action");
    if (!userId || !mod || !action) return;

    if (userPermSaving.has(userPermStateKey(userId, mod, action))) return;

    e.preventDefault();
    e.stopPropagation();

    const mapKey = `${mod}:${action}`;
    const next = resolveNextUserPermAllowed(state, mapKey);
    await saveUserPermission(userId, mod, action, next, state);
  }, true);
}

async function openUserPermissions(userId) {
  try {
    const data = await apiRequest(`/permissions/users/${encodeURIComponent(userId)}`);
    permActionLabels = { ...permActionLabels, ...(data.catalog?.actionLabels || {}) };
    const state = {
      userId,
      user: data.user,
      effectiveMap: { ...data.effectiveMap },
      roleMap: { ...data.roleMap },
      overrideKeys: [...(data.overrideKeys || [])],
      catalog: data.catalog,
    };
    activeUserPermState = state;

    const modal = openModal({
      title: "Permissões individuais",
      primaryLabel: "Fechar",
      secondaryLabel: "Limpar personalizações",
      contentHtml: buildUserPermTableHtml(state),
      onPrimary: async ({ close }) => { activeUserPermState = null; close(); },
      onSecondary: async ({ close, panel }) => {
        if (!window.confirm("Remover todas as permissões personalizadas deste utilizador? Voltará a herdar apenas o perfil.")) return;
        const btn = panel.querySelector("[data-secondary]");
        try {
          setButtonLoading(btn, true);
          await apiRequest(`/permissions/users/${encodeURIComponent(userId)}/overrides`, { method: "DELETE" });
          toast("Personalizações removidas.", { type: "success" });
          const fresh = await apiRequest(`/permissions/users/${encodeURIComponent(userId)}`);
          state.effectiveMap = { ...fresh.effectiveMap };
          state.roleMap = { ...fresh.roleMap };
          state.overrideKeys = [];
          refreshUserPermModalUI(state);
          const me = getSessionUser();
          if (me?.id === userId) {
            const { clearPermissionCache, loadUserPermissions } = await import("../../shared/permissions.js");
            clearPermissionCache();
            await loadUserPermissions({ force: true });
          }
        } catch (err) {
          toast(err.message || "Erro ao limpar.", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
        }
      },
      onRender: ({ panel }) => {
        state.panel = panel;
        activeUserPermState = state;
        panel.classList.remove("max-w-[640px]");
        panel.classList.add("max-w-[920px]");
        panel.querySelector("[data-close]")?.addEventListener("click", () => {
          activeUserPermState = null;
        }, { once: true });
      },
    });
    return modal;
  } catch (err) {
    toast(err.message || "Erro ao carregar permissões do utilizador.", { type: "error" });
  }
}

// Expose so switchSection can call it
function renderPermissions() { loadPermissions(); }

function wirePermissionCollapse() {
  document.getElementById("permTableBody")?.addEventListener("click", (e) => {
    const toggle = e.target?.closest?.("[data-perm-toggle]");
    if (!toggle) return;
    e.preventDefault();
    const moduleId = toggle.getAttribute("data-perm-toggle");
    if (!moduleId) return;
    toggleModuleExpanded(moduleId);
    updateModuleCollapseUI(moduleId);
    const catalog = filterDisplayCatalog(permDisplayCatalog);
    const expandedCount = catalog.filter((g) => isModuleExpanded(g.module)).length;
    el("permRowCount") && (el("permRowCount").textContent =
      `${catalog.reduce((n, g) => n + g.rows.length, 0)} acções · ${expandedCount}/${catalog.length} módulos abertos`);
  });

  el("permExpandAll")?.addEventListener("click", expandAllPermModules);
  el("permCollapseAll")?.addEventListener("click", collapseAllPermModules);
}

// Wire click delegation for permission cells (matriz por perfil)
function wirePermissionClicks() {
  document.addEventListener("click", async (e) => {
    if (activeUserPermState) return;
    if (e.target?.closest?.("[data-perm-toggle]")) return;
    if (e.target?.closest?.("button.user-perm-cell")) return;
    if (e.target?.closest?.("[data-user-perms]")) return;
    const btn = e.target?.closest?.("button.role-perm-cell");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const role = btn.getAttribute("data-perm-role");
    const mod = btn.getAttribute("data-perm-module");
    const action = btn.getAttribute("data-perm-action");
    if (!role || !mod || !action) return;
    const key = permKey(role, mod, action);
    if (savingCells.has(key)) return;
    const current = permMap[key] ?? "false";
    const nextIdx = (ALLOWED_CYCLE.indexOf(current) + 1) % ALLOWED_CYCLE.length;
    await savePermission(role, mod, action, ALLOWED_CYCLE[nextIdx]);
    const { clearPermissionCache } = await import("../../shared/permissions.js");
    clearPermissionCache();
  });
}

// ─── Load data ────────────────────────────────────────────────
async function loadUsers() {
  const tbody = el("usersTbody");
  if (tbody) tbody.innerHTML = renderLoadingRow(5);
  const data = await apiRequest("/users");
  allUsers = data.items || [];
  renderStats(allUsers);
  renderRecentUsers(allUsers);
  if (activeSection === "users") renderTable(filterUsers());
}

// ─── Project helpers ──────────────────────────────────────────
async function loadAllProjects() {
  const data = await apiRequest("/projects?page=1&pageSize=1000");
  return data.items || [];
}

function renderProjectCheckboxes(projects, selectedIds = []) {
  if (!projects.length) return `<p class="text-xs text-slate-400 italic">Nenhuma obra cadastrada.</p>`;
  return `
    <div class="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto p-3 bg-white border border-slate-200 rounded-xl">
      ${projects.map(p => {
    const checked = selectedIds.includes(p.id) ? "checked" : "";
    return `
          <label class="flex items-center gap-3 cursor-pointer hover:bg-slate-50 p-2 rounded-lg transition-colors group">
            <input type="checkbox" name="assignedProjects" value="${p.id}" ${checked} class="w-4 h-4 rounded text-slate-900 border-slate-300 focus:ring-slate-900" />
            <div class="flex flex-col">
              <span class="text-xs font-bold text-slate-700 group-hover:text-slate-900">${esc(p.name)}</span>
              <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">${esc(p.code)}</span>
            </div>
          </label>
        `;
  }).join("")}
    </div>
  `;
}

function wireProjectSelector(panel, roleId, wrapId) {
  const roleEl = panel.querySelector(`#${roleId}`);
  const wrapEl = panel.querySelector(`#${wrapId}`);
  const sync = () => {
    const role = roleEl?.value;
    const isAllowedRole = ["operador", "leitura", "cliente", "tecnico", "supervisor"].includes(role);
    wrapEl?.classList.toggle("hidden", !isAllowedRole);
  };
  roleEl?.addEventListener("change", sync);
  sync();
}

async function loadClients() {
  const data = await apiRequest("/clients?page=1&pageSize=200");
  return data.items || [];
}

function renderClientOptions(clients, selectedId = "") {
  return [`<option value="">— Selecione um cliente —</option>`,
    ...clients.map(c => `<option value="${esc(c.id)}" ${c.id === selectedId ? "selected" : ""}>${esc(c.name)} (${esc(c.code)})</option>`)
  ].join("");
}

function wireClientSelector(panel, roleId, wrapId) {
  const roleEl = panel.querySelector(`#${roleId}`);
  const wrapEl = panel.querySelector(`#${wrapId}`);
  const sync = () => wrapEl?.classList.toggle("hidden", roleEl?.value !== "cliente");
  roleEl?.addEventListener("change", sync);
  sync();
}

// ─── Create modal ─────────────────────────────────────────────
async function openCreate() {
  const [clients, projects] = await Promise.all([loadClients(), loadAllProjects()]);
  const modal = openModal({
    title: "Novo Utilizador",
    primaryLabel: "Criar Conta",
    contentHtml: `
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="md:col-span-2">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome Completo</label>
          <input id="u_name" type="text" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50" placeholder="Nome do utilizador..." />
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email</label>
          <input id="u_email" type="email" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50" placeholder="utilizador@empresa.com" />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Senha</label>
          <input id="u_pass" type="password" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50" placeholder="mínimo 6 caracteres" />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Perfil de Acesso</label>
          <select id="u_role" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 font-semibold">
            <option value="leitura">Leitura</option>
            <option value="operador">Operador</option>
            <option value="tecnico">Técnico de Obra</option>
            <option value="supervisor">Supervisor de Obra</option>
            <option value="admin">Administrador</option>
            <option value="cliente">Cliente</option>
          </select>
        </div>
        <div id="u_cli_wrap" class="md:col-span-2 hidden">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente Vinculado</label>
          <select id="u_client" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50">${renderClientOptions(clients)}</select>
        </div>
        <div id="u_proj_wrap" class="md:col-span-2 hidden">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Obras Atribuídas</label>
          <p class="text-[10px] text-slate-400 mb-2 font-medium">Selecione as obras que este utilizador poderá gerir/visualizar.</p>
          ${renderProjectCheckboxes(projects)}
        </div>
      </div>`,
    onPrimary: async ({ close, panel }) => {
      const v = id => panel.querySelector(`#${id}`)?.value?.trim?.();
      const btn = panel.querySelector("[data-primary]");
      const role = v("u_role");
      const clientId = v("u_client") || null;
      if (role === "cliente" && !clientId) { toast("Selecione o cliente vinculado.", { type: "error" }); return; }

      const assignedProjectIds = Array.from(panel.querySelectorAll('input[name="assignedProjects"]:checked')).map(i => i.value);

      try {
        setButtonLoading(btn, true);
        await apiRequest("/users", {
          method: "POST",
          body: {
            email: v("u_email"),
            name: v("u_name") || null,
            password: v("u_pass"),
            role,
            clientId,
            assignedProjectIds: ["operador", "leitura", "cliente", "tecnico", "supervisor"].includes(role) ? assignedProjectIds : []
          }
        });
        toast("Utilizador criado com sucesso.", { type: "success" });
        close(); await loadUsers();
      } catch (err) { setButtonLoading(btn, false); toast(err.message || "Erro ao criar utilizador.", { type: "error" }); }
    },
  });
  wireClientSelector(modal.panel, "u_role", "u_cli_wrap");
  wireProjectSelector(modal.panel, "u_role", "u_proj_wrap");
}

// ─── Edit modal ───────────────────────────────────────────────
async function openEdit(id) {
  const [data, clients, projects] = await Promise.all([apiRequest("/users"), loadClients(), loadAllProjects()]);
  const u = (data.items || []).find(x => x.id === id);
  if (!u) return;

  const modal = openModal({
    title: "Editar Utilizador",
    primaryLabel: "Guardar",
    secondaryLabel: "Excluir conta",
    contentHtml: `
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="md:col-span-2 flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
          ${avatarEl(u.email, u.profilePic || u.client?.profilePic)}
          <div>
            <div class="text-sm font-bold text-slate-900">${esc(u.email)}</div>
            <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">ID: ${u.id.slice(0, 8)}</div>
          </div>
          ${roleBadge(u.role)}
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome Completo</label>
          <input id="e_name" type="text" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50" value="${esc(u.name || '')}" placeholder="Nome do utilizador..." />
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email</label>
          <input id="e_email" type="email" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50" value="${esc(u.email)}" />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Telefone</label>
          <input id="e_phone" type="tel" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50" value="${esc(u.profile?.phone || '')}" placeholder="+244 ..." />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">WhatsApp</label>
          <input id="e_whatsapp" type="tel" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50" value="${esc(u.profile?.whatsapp || '')}" placeholder="+244 ..." />
        </div>
        <div class="md:col-span-2 border border-slate-100 rounded-xl p-4 bg-slate-50/60 space-y-3">
          <p class="text-xs font-black uppercase tracking-widest text-slate-500">Notificações Financeiras</p>
          <label class="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input id="e_fin_receiver" type="checkbox" ${u.profile?.isFinancialReceiver ? "checked" : ""} class="w-4 h-4 rounded border-slate-300" />
            Receptor financeiro
          </label>
          <label class="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input id="e_approver" type="checkbox" ${u.profile?.isApprover ? "checked" : ""} class="w-4 h-4 rounded border-slate-300" />
            Aprovador
          </label>
          <label class="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input id="e_proj_resp" type="checkbox" ${u.profile?.isProjectResponsible ? "checked" : ""} class="w-4 h-4 rounded border-slate-300" />
            Responsável pela obra
          </label>
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Perfil de Acesso</label>
          <select id="e_role" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 font-semibold">
            <option value="leitura" ${u.role === "leitura" ? "selected" : ""}>Leitura</option>
            <option value="operador" ${u.role === "operador" ? "selected" : ""}>Operador</option>
            <option value="tecnico" ${u.role === "tecnico" ? "selected" : ""}>Técnico de Obra</option>
            <option value="supervisor" ${u.role === "supervisor" ? "selected" : ""}>Supervisor de Obra</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrador</option>
            <option value="cliente" ${u.role === "cliente" ? "selected" : ""}>Cliente</option>
          </select>
        </div>
        <div id="e_cli_wrap" class="${u.role === "cliente" ? "" : "hidden"}">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente Vinculado</label>
          <select id="e_client" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50">${renderClientOptions(clients, u.clientId || "")}</select>
        </div>
        <div id="e_proj_wrap" class="${["operador", "leitura", "cliente", "tecnico", "supervisor"].includes(u.role) ? "" : "hidden"} md:col-span-2">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Obras Atribuídas</label>
          <p class="text-[10px] text-slate-400 mb-2 font-medium">Selecione as obras que este utilizador poderá gerir/visualizar.</p>
          ${renderProjectCheckboxes(projects, (u.assignedProjects || []).map(p => p.id))}
        </div>
        <div class="md:col-span-2 border-t border-slate-100 pt-4">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Redefinir Senha</label>
          <div class="flex gap-2">
            <input id="e_pass" type="password" class="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50" placeholder="nova senha (mín. 6 caracteres)" />
            <button id="resetBtn" class="px-4 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-700 transition-colors">Redefinir</button>
          </div>
        </div>
      </div>`,
    onPrimary: async ({ close, panel }) => {
      const v = id2 => panel.querySelector(`#${id2}`)?.value?.trim?.();
      const btn = panel.querySelector("[data-primary]");
      const role = v("e_role");
      const clientId = v("e_client") || null;
      if (role === "cliente" && !clientId) { toast("Selecione o cliente vinculado.", { type: "error" }); return; }

      const assignedProjectIds = Array.from(panel.querySelectorAll('input[name="assignedProjects"]:checked')).map(i => i.value);

      try {
        setButtonLoading(btn, true);
        await apiRequest(`/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: {
            email: v("e_email"),
            name: v("e_name") || null,
            role,
            clientId,
            assignedProjectIds: ["operador", "leitura", "cliente", "tecnico", "supervisor"].includes(role) ? assignedProjectIds : [],
            phone: v("e_phone") || null,
            whatsapp: v("e_whatsapp") || null,
            isFinancialReceiver: panel.querySelector("#e_fin_receiver")?.checked || false,
            isApprover: panel.querySelector("#e_approver")?.checked || false,
            isProjectResponsible: panel.querySelector("#e_proj_resp")?.checked || false,
          }
        });
        toast("Utilizador atualizado.", { type: "success" });
        close(); await loadUsers();
      } catch (err) { setButtonLoading(btn, false); toast(err.message || "Erro ao atualizar.", { type: "error" }); }
    },
    onSecondary: async ({ close, panel }) => {
      if (!window.confirm("Excluir este utilizador? Esta ação é irreversível.")) return;
      const btn = panel.querySelector("[data-secondary]");
      try {
        setButtonLoading(btn, true);
        await apiRequest(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Utilizador excluído.", { type: "success" });
        close(); await loadUsers();
      } catch (err) { setButtonLoading(btn, false); toast(err.message || "Erro ao excluir.", { type: "error" }); }
    },
  });

  wireClientSelector(modal.panel, "e_role", "e_cli_wrap");
  wireProjectSelector(modal.panel, "e_role", "e_proj_wrap");

  setTimeout(() => {
    document.getElementById("resetBtn")?.addEventListener("click", async () => {
      const pass = document.getElementById("e_pass")?.value?.trim();
      if (!pass || pass.length < 6) { toast("Senha inválida (mín. 6 caracteres).", { type: "error" }); return; }
      const btn = document.getElementById("resetBtn");
      try {
        setButtonLoading(btn, true);
        await apiRequest(`/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: { password: pass } });
        setButtonLoading(btn, false);
        document.getElementById("e_pass").value = "";
        toast("Senha redefinida com sucesso.", { type: "success" });
      } catch (err) { setButtonLoading(btn, false); toast(err.message || "Erro ao redefinir.", { type: "error" }); }
    });
  }, 0);
}

// ─── Delete shortcut ──────────────────────────────────────────
async function deleteUser(id) {
  if (!window.confirm("Excluir este utilizador? Esta ação é irreversível.")) return;
  try {
    await apiRequest(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Utilizador excluído.", { type: "success" });
    await loadUsers();
  } catch (err) { toast(err.message || "Erro ao excluir.", { type: "error" }); }
}

// ─── Mobile sidebar ────────────────────────────────────────────
function openMobileSidebar() {
  document.getElementById("mobileSidebar")?.classList.add("open");
  document.getElementById("mobileSidebarOverlay")?.classList.add("open");
}
function closeMobileSidebar() {
  document.getElementById("mobileSidebar")?.classList.remove("open");
  document.getElementById("mobileSidebarOverlay")?.classList.remove("open");
}

// ─── Wire events ──────────────────────────────────────────────
function wireEvents() {
  // Mobile sidebar toggle
  el("sidebarToggleBtn")?.addEventListener("click", openMobileSidebar);
  document.getElementById("mobileSidebarOverlay")?.addEventListener("click", closeMobileSidebar);
  el("mSidebarAddUser")?.addEventListener("click", () => { closeMobileSidebar(); openCreate(); });

  // Sidebar section switching (desktop + mobile buttons)
  document.querySelectorAll(".sidebar-link[data-section]").forEach(btn => {
    btn.addEventListener("click", () => { closeMobileSidebar(); switchSection(btn.dataset.section); });
  });
  
  // History tab click from mobile
  el("m-history")?.addEventListener("click", () => { closeMobileSidebar(); switchSection("history"); });

  // "Ver todos" link on overview
  document.querySelectorAll("[data-section-goto]").forEach(btn => {
    btn.addEventListener("click", () => switchSection(btn.dataset.sectionGoto));
  });

  // Add user buttons
  ["addUserBtn", "addUserBtn2", "sidebarAddUser"].forEach(id => {
    el(id)?.addEventListener("click", openCreate);
  });

  // Edit / delete via delegation
  document.addEventListener("click", e => {
    const permsId = e.target?.closest?.("[data-user-perms]")?.getAttribute?.("data-user-perms");
    if (permsId) { openUserPermissions(permsId); return; }
    const editId = e.target?.closest?.("[data-edit-user]")?.getAttribute?.("data-edit-user");
    if (editId) { openEdit(editId); return; }
    const delId = e.target?.closest?.("[data-delete-user]")?.getAttribute?.("data-delete-user");
    if (delId) { deleteUser(delId); return; }
  });

  // Search & filter
  let debounce;
  el("searchInput")?.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderTable(filterUsers()), 200);
  });
  el("roleFilter")?.addEventListener("change", () => renderTable(filterUsers()));
}

// ─── Reset / sync / filtros permissões ─────────────────────────
function wireResetPerms() {
  el("resetPermsBtn")?.addEventListener("click", async () => {
    if (!window.confirm("Repor todas as permissões para os valores por defeito? Esta acção é irreversível.")) return;
    try {
      await apiRequest("/permissions/reset", { method: "POST" });
      toast("Permissões repostas com sucesso.", { type: "success" });
      const { clearPermissionCache } = await import("../../shared/permissions.js");
      clearPermissionCache();
      await loadPermissions();
    } catch (err) {
      toast(err.message || "Erro ao repor permissões.", { type: "error" });
    }
  });

  el("syncPermsBtn")?.addEventListener("click", async () => {
    try {
      const res = await apiRequest("/permissions/sync", { method: "POST" });
      toast(`Catálogo sincronizado (${res.total || "—"} entradas).`, { type: "success" });
      const { clearPermissionCache } = await import("../../shared/permissions.js");
      clearPermissionCache();
      await loadPermissions();
    } catch (err) {
      toast(err.message || "Erro ao sincronizar.", { type: "error" });
    }
  });

  let debouncePerm;
  el("permSearch")?.addEventListener("input", () => {
    permFilterQuery = el("permSearch")?.value || "";
    clearTimeout(debouncePerm);
    debouncePerm = setTimeout(() => renderPermissionsTable(), 150);
  });
  el("permModuleFilter")?.addEventListener("change", () => {
    permFilterModule = el("permModuleFilter")?.value || "";
    renderPermissionsTable();
  });
}

// ─── History Logs ─────────────────────────────────────────────
let logPagination = { skip: 0, take: 20, total: 0 };
let currentLogs = [];

function getLogStatusBadge(status) {
  if (status === "SUCCESS") return `<span class="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold tracking-widest uppercase border border-emerald-100">Sucesso</span>`;
  if (status === "ERROR") return `<span class="px-2 py-1 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold tracking-widest uppercase border border-red-100">Erro</span>`;
  return `<span class="px-2 py-1 bg-slate-50 text-slate-500 rounded-lg text-[10px] font-bold tracking-widest uppercase border border-slate-200">${esc(status)}</span>`;
}

async function loadLogs() {
  const tbody = el("logsTbody");
  if (!tbody) return;
  tbody.innerHTML = renderLoadingRow(6);
  
  const search = el("logSearchInput")?.value || "";
  const module = el("logModuleFilter")?.value || "";
  const startDate = el("logStartDate")?.value || "";
  const endDate = el("logEndDate")?.value || "";
  
  const query = new URLSearchParams({
    skip: logPagination.skip,
    take: logPagination.take
  });
  
  if (search) query.append("search", search);
  if (module) query.append("module", module);
  if (startDate) query.append("startDate", startDate);
  if (endDate) query.append("endDate", endDate);
  
  try {
    const res = await apiRequest(`/logs?${query.toString()}`);
    logPagination.total = res.total || 0;
    currentLogs = res.logs || [];
    renderLogs();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-7 py-8 text-center text-sm text-red-400">Erro ao carregar logs.</td></tr>`;
    toast("Erro ao carregar histórico.", { type: "error" });
  }
}

function renderLogs() {
  const tbody = el("logsTbody");
  if (!tbody) return;
  
  if (!currentLogs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-7 py-10 text-sm text-slate-400 text-center">Nenhum registo encontrado.</td></tr>`;
  } else {
    tbody.innerHTML = currentLogs.map(log => {
      const email = log.userEmail || (log.user?.email) || "Sistema";
      const name = log.userName || (log.user?.name) || email;
      const date = new Date(log.createdAt);
      
      return `
      <tr class="hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 group">
        <td class="px-5 py-3">
          <div class="flex items-center gap-3">
            ${avatarEl(email, null)}
            <div class="flex flex-col">
              <span class="text-sm font-bold text-slate-900">${esc(name)}</span>
              <span class="text-[9px] text-slate-400 font-medium">${esc(email)}</span>
            </div>
          </div>
        </td>
        <td class="px-5 py-3">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs font-bold text-slate-700">${esc(log.action)}</span>
            <span class="text-[9px] font-black uppercase tracking-widest text-slate-400">${esc(log.module)}</span>
          </div>
        </td>
        <td class="px-5 py-3 hidden md:table-cell">
          <div class="text-[10px] text-slate-500 max-w-[200px] truncate" title="${esc(JSON.stringify(log.details))}">
            ${log.details?.path ? esc(log.details.path) : "Sem detalhes"}
          </div>
        </td>
        <td class="px-5 py-3">
          <div class="text-xs font-medium text-slate-600">${formatDateBR(log.createdAt)}</div>
          <div class="text-[9px] text-slate-400">${date.toLocaleTimeString("pt-BR")}</div>
        </td>
        <td class="px-5 py-3 text-center">
          ${getLogStatusBadge(log.status)}
        </td>
      </tr>
      `;
    }).join("");
  }
  
  // Pagination UI
  const total = logPagination.total;
  const start = total === 0 ? 0 : logPagination.skip + 1;
  const end = Math.min(logPagination.skip + logPagination.take, total);
  
  if (el("logTotalCount")) el("logTotalCount").textContent = total;
  if (el("logRangeStart")) el("logRangeStart").textContent = start;
  if (el("logRangeEnd")) el("logRangeEnd").textContent = end;
  
  if (el("logPrevPage")) el("logPrevPage").disabled = logPagination.skip === 0;
  if (el("logNextPage")) el("logNextPage").disabled = end >= total;
}

function wireLogEvents() {
  let debounce;
  const triggerSearch = () => {
    logPagination.skip = 0;
    clearTimeout(debounce);
    debounce = setTimeout(() => loadLogs(), 300);
  };
  
  el("logSearchInput")?.addEventListener("input", triggerSearch);
  el("logModuleFilter")?.addEventListener("change", triggerSearch);
  el("logStartDate")?.addEventListener("change", triggerSearch);
  el("logEndDate")?.addEventListener("change", triggerSearch);
  
  el("logPrevPage")?.addEventListener("click", () => {
    if (logPagination.skip > 0) {
      logPagination.skip = Math.max(0, logPagination.skip - logPagination.take);
      loadLogs();
    }
  });
  
  el("logNextPage")?.addEventListener("click", () => {
    if (logPagination.skip + logPagination.take < logPagination.total) {
      logPagination.skip += logPagination.take;
      loadLogs();
    }
  });
  
  // Exports
  el("exportCsvBtn")?.addEventListener("click", () => exportLogs("csv"));
  el("exportExcelBtn")?.addEventListener("click", () => exportLogs("excel"));
  el("exportPdfBtn")?.addEventListener("click", () => exportLogs("pdf"));

  // Clear Actions
  el("clearLogsBtn")?.addEventListener("click", async () => {
    if (!window.confirm("ATENÇÃO: Deseja apagar TODO o histórico de auditoria do sistema? Esta ação não pode ser desfeita.")) return;
    try {
      const btn = el("clearLogsBtn");
      setButtonLoading(btn, true);
      await apiRequest("/logs", { method: "DELETE" });
      toast("Histórico apagado com sucesso.", { type: "success" });
      logPagination.skip = 0;
      await loadLogs();
      setButtonLoading(btn, false);
    } catch (error) {
      toast("Erro ao apagar histórico: " + error.message, { type: "error" });
      setButtonLoading(el("clearLogsBtn"), false);
    }
  });

  el("clearCacheBtn")?.addEventListener("click", () => {
    if (!window.confirm("Deseja limpar os dados locais e encerrar a sessão? Terá de fazer login novamente.")) return;
    localStorage.clear();
    sessionStorage.clear();
    
    // Clear cookies
    document.cookie.split(";").forEach(function(c) {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    
    window.location.href = "/";
  });
}

async function fetchAllLogsForExport() {
  // Fetch a larger chunk for export, up to 1000 items
  const search = el("logSearchInput")?.value || "";
  const module = el("logModuleFilter")?.value || "";
  const startDate = el("logStartDate")?.value || "";
  const endDate = el("logEndDate")?.value || "";
  
  const query = new URLSearchParams({ skip: 0, take: 1000 });
  if (search) query.append("search", search);
  if (module) query.append("module", module);
  if (startDate) query.append("startDate", startDate);
  if (endDate) query.append("endDate", endDate);
  
  try {
    const res = await apiRequest(`/logs?${query.toString()}`);
    return res.logs || [];
  } catch (e) {
    toast("Erro ao obter dados para exportação.", { type: "error" });
    return [];
  }
}

async function exportLogs(type) {
  const data = await fetchAllLogsForExport();
  if (!data.length) {
    toast("Sem dados para exportar.", { type: "warning" });
    return;
  }
  
  const exportData = data.map(log => ({
    "Data/Hora": formatDateBR(log.createdAt) + " " + new Date(log.createdAt).toLocaleTimeString("pt-BR"),
    "Utilizador": log.userName || (log.user?.name) || "Sistema",
    "Email": log.userEmail || (log.user?.email) || "",
    "Módulo": log.module,
    "Ação": log.action,
    "Status": log.status
  }));
  
  if (type === "csv") {
    const headers = Object.keys(exportData[0]).join(",");
    const rows = exportData.map(obj => Object.values(obj).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers, ...rows].join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `historico_logs_${new Date().getTime()}.csv`;
    link.click();
  } else if (type === "excel") {
    if (typeof XLSX !== "undefined") {
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Logs");
      XLSX.writeFile(wb, `historico_logs_${new Date().getTime()}.xlsx`);
    } else {
      toast("Biblioteca Excel não encontrada.", { type: "error" });
    }
  } else if (type === "pdf") {
    if (typeof window.jspdf !== "undefined") {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF("landscape");
      
      doc.text("Histórico de Auditoria - Info Gestor", 14, 15);
      
      const columns = ["Data/Hora", "Utilizador", "Email", "Módulo", "Ação", "Status", "IP"];
      const rows = exportData.map(obj => [obj["Data/Hora"], obj["Utilizador"], obj["Email"], obj["Módulo"], obj["Ação"], obj["Status"], obj["IP"]]);
      
      doc.autoTable({
        head: [columns],
        body: rows,
        startY: 20,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [15, 23, 42] }
      });
      
      doc.save(`historico_logs_${new Date().getTime()}.pdf`);
    } else {
      toast("Biblioteca PDF não encontrada.", { type: "error" });
    }
  }
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  initMobileMenu();
  wireLogout();
  wireUsersNav();
  wireEvents();
  wirePermissionClicks();
  wireUserPermClicks();
  wirePermissionCollapse();
  wireResetPerms();
  wireLogEvents();
  await loadUsers();
}

init().catch((err) => toast(err.message || "Falha ao carregar. Verifique login/API.", { type: "error" }));
