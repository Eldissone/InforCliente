import { apiRequest, getAssetUrl } from "../../services/api.js";
import { checkAuth, getSessionUser } from "../../services/auth.js";
import { openModal, toast, setButtonLoading, renderLoadingRow, initMobileMenu } from "../../shared/ui.js";
import { formatDateBR } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";
import { fetchHelpTickets, fetchHelpTicket, updateHelpTicket } from "../../services/helpApi.js";
import { initBackupPanel, loadBackupPanel } from "./backups.js";
import { ROLE_DEFS, roleDef, roleOptionsHtml, isProjectScopedRole } from "./roles.js";
import { openDrawer, clearFieldErrors, setFieldError } from "./drawer.js";

checkAuth({ allowedRoles: ["admin"] });

function el(id) { return document.getElementById(id); }
function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── State ────────────────────────────────────────────────────
let allUsers = [];
const selectedUserIds = new Set();
let activeSection = "overview";

// ─── Role helpers ─────────────────────────────────────────────
function roleBadge(role) {
  const d = roleDef(role);
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${d.cls}">
    <span class="material-symbols-outlined text-[13px]">${d.icon}</span>${d.short}
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
const SECTION_LABELS = { overview: "Visão Geral", users: "Utilizadores", permissions: "Permissões", ajuda: "Ajuda", history: "Histórico", backups: "Cópias de segurança" };

function switchSection(name) {
  activeSection = name;
  ["overview", "users", "permissions", "ajuda", "history", "backups"].forEach(s => {
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
  updatePermBulkBar();
  if (name === "ajuda") loadHelpInbox();
  if (name === "history") loadLogs();
  if (name === "backups") loadBackupPanel();
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

function renderRow(u) {
  const sel = selectedUserIds.has(u.id);
  const projectsCount = (u.assignedProjects || []).length;
  const overrides = u._count?.permissions ?? 0;
  const link = u.client
    ? `<div class="min-w-0"><div class="text-sm font-semibold text-slate-700 truncate">${esc(u.client.name)}</div>
         <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${esc(u.client.code)}</div></div>`
    : u.role === "admin"
      ? `<span class="text-xs font-semibold text-slate-500">Todas as obras</span>`
      : projectsCount
        ? `<span class="inline-flex items-center gap-1 text-xs font-semibold text-slate-600"><span class="material-symbols-outlined text-sm text-slate-400">apartment</span>${projectsCount} obra${projectsCount === 1 ? "" : "s"}</span>`
        : `<span class="text-xs text-slate-400">Sem obras</span>`;
  const perms = overrides
    ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-50 text-violet-700 text-[10px] font-black uppercase tracking-wide" title="${overrides} permissões individuais"><span class="material-symbols-outlined text-sm">tune</span>${overrides}</span>`
    : `<span class="text-xs text-slate-400">Padrão do perfil</span>`;
  const iconBtn = (attr, icon, title, tone = "") =>
    `<button type="button" ${attr} title="${title}" aria-label="${title}" class="user-row-action ${tone}"><span class="material-symbols-outlined">${icon}</span></button>`;
  return `
    <tr class="hover:bg-slate-50/70 transition-colors border-b border-slate-50 last:border-0${sel ? " bg-violet-50/40" : ""}">
      <td class="pl-6 pr-2 py-3.5 w-10"><input type="checkbox" class="user-sel-cb h-4 w-4 rounded border-slate-300 accent-[#0d3fd1] cursor-pointer" data-user-sel="${u.id}" ${sel ? "checked" : ""} aria-label="Selecionar utilizador"></td>
      <td class="px-4 py-3.5">
        <div class="flex items-center gap-3 min-w-0">
          ${avatarEl(u.email, u.profilePic || u.client?.profilePic)}
          <div class="min-w-0">
            <div class="text-sm font-bold text-slate-900 truncate">${esc(u.name || u.email)}</div>
            ${u.name ? `<div class="text-xs text-slate-400 font-medium truncate">${esc(u.email)}</div>` : ""}
          </div>
        </div>
      </td>
      <td class="px-4 py-3.5">${roleBadge(u.role)}</td>
      <td class="px-4 py-3.5 hidden md:table-cell">${link}</td>
      <td class="px-4 py-3.5 hidden lg:table-cell">${perms}</td>
      <td class="px-4 py-3.5 text-xs text-slate-500 font-medium whitespace-nowrap hidden xl:table-cell">${formatDateBR(u.createdAt)}</td>
      <td class="px-4 py-3.5 pr-6 text-right">
        <div class="inline-flex items-center gap-1">
          ${iconBtn(`data-user-perms="${u.id}"`, "shield_person", "Permissões individuais", "user-row-action--violet")}
          ${iconBtn(`data-user-copy="${u.id}"`, "content_copy", "Copiar permissões de outro utilizador")}
          ${iconBtn(`data-edit-user="${u.id}"`, "edit", "Editar utilizador")}
          ${iconBtn(`data-delete-user="${u.id}"`, "delete", "Eliminar utilizador", "user-row-action--danger")}
        </div>
      </td>
    </tr>`;
}

function renderTable(users) {
  const tbody = el("usersTbody");
  if (!tbody) return;
  el("users-count-label") && (el("users-count-label").textContent = users.length);
  tbody.innerHTML = users.length
    ? users.map((u) => renderRow(u)).join("")
    : `<tr><td colspan="7" class="px-7 py-14 text-center">
        <span class="material-symbols-outlined text-4xl text-slate-300">group_off</span>
        <p class="mt-2 text-sm font-semibold text-slate-500">Nenhum utilizador encontrado.</p>
        <p class="text-xs text-slate-400">Ajuste a pesquisa ou o filtro de perfil.</p>
      </td></tr>`;
  syncUsersBulkBar();
}

// ─── Permissions — catálogo dinâmico (API) ──────────────────────

const ROLES = ["admin", "operador", "financeiro", "tecnico", "supervisor", "leitura", "cliente"];

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

// Ciclo ao clicar: negado → só ver → só os meus → permitido
const ALLOWED_CYCLE = ["false", "view", "own", "true"];

const LEVEL_LABELS = { true: "Permitido", own: "Só os meus registos", view: "Só leitura", false: "Negado" };
const LEVEL_BUTTONS = [
  { value: "true", label: "Permitido" },
  { value: "own", label: "Só os meus" },
  { value: "view", label: "Só ver" },
  { value: "false", label: "Negado" },
];

// Build lookup key
function permKey(role, module, action) { return `${role}|${module}|${action}`; }

// In-memory map populated from API: key → allowed string (valores já guardados)
let permMap = {};

// Alterações ainda não guardadas (perfis) e células selecionadas para alterar em lote
const rolePending = new Map(); // key → novo valor
const roleSelected = new Set(); // keys
let roleLastSelectedKey = null;
let roleSaving = false;

function roleCurrentValue(key) {
  return rolePending.has(key) ? rolePending.get(key) : (permMap[key] ?? "false");
}

function stageRoleValue(key, value) {
  const saved = permMap[key] ?? "false";
  if (value === saved) rolePending.delete(key);
  else rolePending.set(key, value);
}

function permIcon(allowed, { role, module: mod, action, clickable } = {}) {
  const key = permKey(role, mod, action);
  const val = clickable ? roleCurrentValue(key) : allowed;
  const actionLabel = permActionLabels[action] || action;
  let icon, cls;
  if (val === "true") { icon = "check_circle"; cls = "perm-yes"; }
  else if (val === "own" || val === "view") { icon = "check_circle"; cls = "perm-part"; }
  else { icon = "cancel"; cls = "perm-no"; }
  const title = `${actionLabel}: ${LEVEL_LABELS[val] || "Negado"}`;

  if (!clickable) {
    return `<span class="material-symbols-outlined ${cls}" title="${title} (bloqueado)">${icon}</span>`;
  }
  const pending = rolePending.has(key);
  const ring = pending ? " ring-2 ring-amber-400 ring-offset-1" : "";
  const checked = roleSelected.has(key) ? " checked" : "";
  const badge = val === "own" ? "P" : val === "view" ? "V" : "";
  return `<div class="perm-cell-wrap">
    <input type="checkbox" class="perm-sel-cb" data-perm-sel="${esc(key)}"${checked} aria-label="Selecionar para alterar em lote">
    <button type="button"
      class="role-perm-cell w-9 h-9 rounded-xl flex items-center justify-center mx-auto transition-all hover:shadow-md${ring}"
      data-perm-role="${esc(role)}" data-perm-module="${esc(mod)}" data-perm-action="${esc(action)}"
      title="${title}${pending ? " — alteração pendente" : ""} — clique para alterar">
      <span class="material-symbols-outlined ${cls}">${icon}</span>${badge ? `<span class="perm-badge">${badge}</span>` : ""}
    </button>
  </div>`;
}

function refreshPermCell(role, mod, action) {
  const btn = document.querySelector(
    `button.role-perm-cell[data-perm-role="${role}"][data-perm-module="${mod}"][data-perm-action="${action}"]`
  );
  const wrap = btn?.closest(".perm-cell-wrap");
  if (!wrap) return;
  wrap.outerHTML = permIcon(permMap[permKey(role, mod, action)] || "false", { role, module: mod, action, clickable: true });
}

// ── Selecção múltipla + barra de acções ───────────────────────────────────────
function roleCellCheckboxes() {
  return [...document.querySelectorAll("#permTableBody input[data-perm-sel]")].filter(
    (cb) => !cb.closest("tr")?.classList.contains("is-hidden-row")
  );
}

function setRoleSelection(keys, on) {
  keys.forEach((k) => (on ? roleSelected.add(k) : roleSelected.delete(k)));
  roleCellCheckboxes().forEach((cb) => { cb.checked = roleSelected.has(cb.dataset.permSel); });
  syncRoleGroupCheckboxes();
  updatePermBulkBar();
}

function syncRoleGroupCheckboxes() {
  const cbs = roleCellCheckboxes();
  const apply = (input, subset) => {
    if (!input) return;
    const n = subset.filter((cb) => cb.checked).length;
    input.checked = subset.length > 0 && n === subset.length;
    input.indeterminate = n > 0 && n < subset.length;
  };
  document.querySelectorAll("[data-perm-sel-row]").forEach((input) => {
    const tr = input.closest("tr");
    apply(input, [...(tr?.querySelectorAll("input[data-perm-sel]") || [])]);
  });
  document.querySelectorAll("[data-perm-sel-module]").forEach((input) => {
    const mod = input.dataset.permSelModule;
    apply(input, cbs.filter((cb) => cb.closest("tr")?.dataset.parentModule === mod));
  });
  document.querySelectorAll("[data-perm-sel-col]").forEach((input) => {
    const role = input.dataset.permSelCol;
    apply(input, cbs.filter((cb) => cb.dataset.permSel.startsWith(`${role}|`)));
  });
}

function injectRoleColumnSelectors() {
  const ths = document.querySelectorAll(".perm-table-wrap thead tr th");
  ROLES.forEach((role, i) => {
    const th = ths[i + 1];
    if (!th || th.querySelector("[data-perm-sel-col]")) return;
    const holder = th.querySelector("div") || th;
    holder.insertAdjacentHTML(
      "beforeend",
      `<label class="perm-col-sel" title="Selecionar toda a coluna (${esc(role)})"><input type="checkbox" data-perm-sel-col="${esc(role)}" aria-label="Selecionar coluna"> <span>todos</span></label>`
    );
  });
}

function ensurePermBulkBar() {
  let bar = document.getElementById("permBulkBar");
  if (bar) return bar;
  bar = document.createElement("div");
  bar.id = "permBulkBar";
  bar.className = "perm-bulk-bar hidden";
  bar.innerHTML = `
    <div class="flex items-center gap-2 flex-wrap" data-bar-sel>
      <span class="text-xs font-bold"><span data-bar-sel-count>0</span> selecionadas</span>
      <span class="text-[10px] uppercase tracking-widest text-white/50">definir como</span>
      ${LEVEL_BUTTONS.map((b) => `<button type="button" class="perm-bulk-btn" data-bar-set="${b.value}">${b.label}</button>`).join("")}
      <button type="button" class="perm-bulk-btn perm-bulk-btn--ghost" data-bar-clear-sel>Limpar seleção</button>
    </div>
    <div class="flex items-center gap-2 pl-3 border-l border-white/20" data-bar-pend>
      <span class="text-xs font-bold"><span data-bar-pend-count>0</span> alterações pendentes</span>
      <button type="button" class="perm-bulk-btn perm-bulk-btn--ghost" data-bar-discard>Descartar</button>
      <button type="button" class="perm-bulk-btn perm-bulk-btn--primary" data-bar-save>Guardar alterações</button>
    </div>`;
  document.body.appendChild(bar);

  bar.addEventListener("click", async (e) => {
    const set = e.target.closest("[data-bar-set]");
    if (set) {
      const value = set.dataset.barSet;
      const locked = (key) => {
        const [role, mod, action] = key.split("|");
        return (role === "admin" && mod === "sistema" && ["view", "full_access"].includes(action)) ||
          (role === "admin" && mod === "permissoes" && action === "manage_permissions");
      };
      roleSelected.forEach((key) => { if (!locked(key)) stageRoleValue(key, value); });
      roleSelected.clear();
      renderPermissionsTable();
      updatePermBulkBar();
      return;
    }
    if (e.target.closest("[data-bar-clear-sel]")) { setRoleSelection([...roleSelected], false); return; }
    if (e.target.closest("[data-bar-discard]")) {
      if (rolePending.size && !window.confirm(`Descartar ${rolePending.size} alterações pendentes?`)) return;
      rolePending.clear();
      renderPermissionsTable();
      updatePermBulkBar();
      return;
    }
    if (e.target.closest("[data-bar-save]")) await saveRolePending();
  });
  return bar;
}

function updatePermBulkBar() {
  const bar = ensurePermBulkBar();
  const visible = activeSection === "permissions" && (roleSelected.size > 0 || rolePending.size > 0);
  bar.classList.toggle("hidden", !visible);
  document.body.classList.toggle("perm-has-selection", activeSection === "permissions" && roleSelected.size > 0);
  bar.querySelector("[data-bar-sel]")?.classList.toggle("hidden", roleSelected.size === 0);
  bar.querySelector("[data-bar-pend]")?.classList.toggle("hidden", rolePending.size === 0);
  bar.querySelector("[data-bar-sel]")?.nextElementSibling?.classList.toggle("border-l", roleSelected.size > 0);
  const sc = bar.querySelector("[data-bar-sel-count]");
  if (sc) sc.textContent = String(roleSelected.size);
  const pc = bar.querySelector("[data-bar-pend-count]");
  if (pc) pc.textContent = String(rolePending.size);
  const save = bar.querySelector("[data-bar-save]");
  if (save) { save.disabled = roleSaving; save.textContent = roleSaving ? "A guardar…" : "Guardar alterações"; }
}

async function saveRolePending() {
  if (!rolePending.size || roleSaving) return;
  const byRole = {};
  rolePending.forEach((value, key) => {
    const [role, mod, action] = key.split("|");
    (byRole[role] ||= []).push({ module: mod, action, allowed: value });
  });
  roleSaving = true;
  updatePermBulkBar();
  const results = await Promise.allSettled(
    Object.entries(byRole).map(([role, items]) =>
      apiRequest(`/permissions/roles/${encodeURIComponent(role)}/bulk`, { method: "PUT", body: { items } })
        .then((res) => ({ role, items, res }))
    )
  );
  let applied = 0;
  const problems = [];
  results.forEach((r, i) => {
    const role = Object.keys(byRole)[i];
    if (r.status === "fulfilled") {
      const rejected = new Set((r.value.res.rejected || []).map((x) => `${x.module}|${x.action}`));
      r.value.items.forEach((it) => {
        const key = permKey(role, it.module, it.action);
        if (rejected.has(`${it.module}|${it.action}`)) { problems.push(`${role}/${it.module}/${it.action}`); return; }
        permMap[key] = it.allowed;
        rolePending.delete(key);
      });
      applied += r.value.res.applied || 0;
    } else {
      problems.push(`${role}: ${r.reason?.message || "erro"}`);
    }
  });
  roleSaving = false;
  const { clearPermissionCache } = await import("../../shared/permissions.js");
  clearPermissionCache();
  renderPermissionsTable();
  updatePermBulkBar();
  if (problems.length) toast(`${applied} guardadas; ${problems.length} não foram aplicadas (${problems.slice(0, 2).join(", ")}…)`, { type: "error" });
  else toast(`${applied} permissões guardadas.`, { type: "success" });
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
  tbody.innerHTML = `<tr><td colspan="8" class="px-7 py-10 text-center">
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
    tbody.innerHTML = `<tr><td colspan="8" class="px-7 py-8 text-center text-sm text-red-400">Erro ao carregar permissões.</td></tr>`;
    permDisplayCatalog = PERM_DISPLAY_FALLBACK;
    return;
  }
  renderPermissionsTable();
  loadPermAudit();
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
        <input type="checkbox" class="perm-sel-row" data-perm-sel-row="${esc(mod)}|${esc(action)}" aria-label="Selecionar linha">
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
    tbody.innerHTML = `<tr><td colspan="8" class="px-7 py-8 text-center text-sm text-slate-400">Nenhuma permissão corresponde ao filtro.</td></tr>`;
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
      <td colspan="8">
        <div class="flex items-center">
        <label class="perm-module-sel" title="Selecionar todas as células do módulo"><input type="checkbox" data-perm-sel-module="${esc(group.module)}" aria-label="Selecionar módulo"></label>
        <button type="button" class="perm-module-toggle flex-1" data-perm-toggle="${esc(group.module)}"
          aria-expanded="${expanded ? "true" : "false"}"
          aria-controls="perm-block-${esc(group.module)}">
          <span class="material-symbols-outlined perm-chevron">expand_more</span>
          <span class="material-symbols-outlined text-base text-[#0d3fd1]">${esc(group.icon || "folder")}</span>
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-700">${esc(group.group)}</span>
          <span class="perm-module-badge">${tabCount ? `${tabCount} abas · ` : ""}${actionCount} acções · ${granted}/${total} activas</span>
        </button>
        </div>
      </td>
    </tr>`;

    if ((group.pages || []).length) {
      html += `<tr class="perm-pages-panel${hiddenCls}" data-parent-module="${esc(group.module)}" id="perm-pages-${esc(group.module)}">
        <td colspan="8">
          ${(group.pages || []).map((p) => `
            <span class="perm-page-chip" title="${esc(p.route || "")}">
              <span class="material-symbols-outlined text-[14px]">web</span>${esc(p.label)}
            </span>`).join("")}
        </td>
      </tr>`;
    }

    if ((group.tabs || []).length) {
      html += `<tr class="perm-tabs-header${hiddenCls}" data-parent-module="${esc(group.module)}">
        <td colspan="8" class="px-7 py-2 pl-12 bg-violet-50/40 border-b border-violet-100">
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
            <input type="checkbox" class="perm-sel-row" data-perm-sel-row="${esc(mod)}|${esc(action)}" aria-label="Selecionar linha">
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
  injectRoleColumnSelectors();
  syncRoleGroupCheckboxes();
  updatePermBulkBar();
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

// ─── Permissões por utilizador individual (selecção múltipla + guardar em lote) ───

const USER_PERM_CYCLE = ["inherit", "false", "view", "own", "true"];
let activeUserPermState = null;

function upEntries(state) {
  const catalog = normalizeDisplayCatalog(state.catalog?.groups ? { groups: state.catalog.groups } : null);
  const out = [];
  catalog.forEach((group) => {
    (group.tabs || []).forEach((tab) =>
      out.push({ group, kind: "tab", label: tab.label, sub: `${tab.pageLabel || ""} · ${tab.module} · ${tab.action}`, module: tab.module, action: tab.action })
    );
    group.rows.forEach((r) =>
      out.push({ group, kind: "row", label: r.label, sub: `${r.module} · ${r.action}`, module: r.module, action: r.action })
    );
  });
  out.forEach((e) => { e.key = `${e.module}:${e.action}`; });
  return out;
}

/** Estado apresentado de uma permissão, já com as alterações pendentes. */
function upDisplay(state, key) {
  const roleVal = state.roleMap[key] ?? "false";
  const hasPending = state.pending.has(key);
  const next = state.pending.get(key);
  const isOverride = hasPending ? next !== "inherit" : state.overrideKeys.includes(key);
  const effective = hasPending ? (next === "inherit" ? roleVal : next) : (state.effectiveMap[key] ?? "false");
  return { roleVal, isOverride, effective, hasPending };
}

function upVisibleEntries(state) {
  const q = state.filter.q.trim().toLowerCase();
  return upEntries(state).filter((e) => {
    if (state.filter.onlyCustom && !upDisplay(state, e.key).isOverride) return false;
    if (!q) return true;
    return `${e.label} ${e.sub} ${e.group.group}`.toLowerCase().includes(q);
  });
}

function stageUserValue(state, key, next) {
  const savedToken = state.overrideKeys.includes(key) ? (state.effectiveMap[key] ?? "false") : "inherit";
  if (next === savedToken) state.pending.delete(key);
  else state.pending.set(key, next);
}

function upNextToken(state, key) {
  const d = upDisplay(state, key);
  const current = d.isOverride ? d.effective : "inherit";
  let idx = USER_PERM_CYCLE.indexOf(current);
  for (let i = 0; i < USER_PERM_CYCLE.length; i++) {
    idx = (idx + 1) % USER_PERM_CYCLE.length;
    const next = USER_PERM_CYCLE[idx];
    if (next === "inherit") return "inherit";
    if (current === "inherit" && next === d.roleVal) continue; // igual ao perfil: não é uma personalização
    return next;
  }
  return "view";
}

function upIcon(val) {
  if (val === "true") return { icon: "check_circle", cls: "perm-yes" };
  if (val === "own" || val === "view") return { icon: "check_circle", cls: "perm-part" };
  return { icon: "cancel", cls: "perm-no" };
}

function upCellHtml(state, e) {
  const d = upDisplay(state, e.key);
  const { icon, cls } = upIcon(d.effective);
  const ring = d.hasPending
    ? " ring-2 ring-amber-400 ring-offset-1"
    : d.isOverride
      ? " ring-2 ring-violet-400 ring-offset-1"
      : " ring-1 ring-dashed ring-slate-300 ring-offset-1";
  const state_ = d.hasPending ? "alteração pendente" : d.isOverride ? "personalizado" : "herda do perfil";
  const badge = d.effective === "own" ? "P" : d.effective === "view" ? "V" : "";
  return `<button type="button" class="user-perm-cell w-9 h-9 rounded-xl flex items-center justify-center mx-auto transition-all${ring}"
    data-up-cell="${esc(e.key)}" title="${esc(LEVEL_LABELS[d.effective] || "Negado")} (${state_}) — clique para alterar">
    <span class="material-symbols-outlined ${cls}">${icon}</span>${badge ? `<span class="perm-badge">${badge}</span>` : ""}
  </button>`;
}

function renderUserPermTable(state) {
  const wrap = state.panel?.querySelector("#upTableWrap");
  if (!wrap) return;
  const scrollTop = wrap.scrollTop;
  const entries = upVisibleEntries(state);
  if (!entries.length) {
    wrap.innerHTML = `<p class="px-4 py-10 text-center text-sm text-slate-400">${
      state.filter.onlyCustom ? "Este utilizador não tem permissões personalizadas." : "Nenhuma permissão corresponde à pesquisa."
    }</p>`;
    wrap.scrollTop = scrollTop;
    return;
  }
  const allSelected = entries.length > 0 && entries.every((e) => state.selected.has(e.key));
  const someSelected = entries.some((e) => state.selected.has(e.key));
  let html = `<table class="w-full text-left text-sm">
    <thead class="bg-slate-50 sticky top-0 z-10">
      <tr class="text-[9px] font-black uppercase tracking-widest text-slate-400">
        <th class="px-3 py-3 w-10"><input type="checkbox" id="upSelAll" ${allSelected ? "checked" : ""} data-indeterminate="${someSelected && !allSelected}" aria-label="Selecionar todas as visíveis"></th>
        <th class="px-3 py-3">Acção</th>
        <th class="px-3 py-3 text-center w-24">Perfil</th>
        <th class="px-3 py-3 text-center w-24">Efectivo</th>
      </tr>
    </thead><tbody>`;
  let lastGroup = null;
  entries.forEach((e) => {
    if (lastGroup !== e.group.module) {
      lastGroup = e.group.module;
      const inGroup = entries.filter((x) => x.group.module === e.group.module);
      const all = inGroup.every((x) => state.selected.has(x.key));
      html += `<tr class="bg-slate-50/80"><td class="px-3 py-2"><input type="checkbox" data-up-sel-module="${esc(e.group.module)}" ${all ? "checked" : ""} aria-label="Selecionar módulo"></td>
        <td colspan="3" class="px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
          <span class="material-symbols-outlined text-sm align-middle text-[#0d3fd1]">${esc(e.group.icon || "folder")}</span> ${esc(e.group.group)}
          <span class="ml-1 font-medium normal-case tracking-normal text-slate-400">${inGroup.length}</span>
        </td></tr>`;
    }
    const d = upDisplay(state, e.key);
    html += `<tr class="border-t border-slate-50 hover:bg-slate-50/50${state.selected.has(e.key) ? " bg-violet-50/40" : ""}">
      <td class="px-3 py-2"><input type="checkbox" data-up-sel="${esc(e.key)}" ${state.selected.has(e.key) ? "checked" : ""} aria-label="Selecionar"></td>
      <td class="px-3 py-2 ${e.kind === "tab" ? "pl-6" : ""}">
        <div class="font-medium text-slate-700 text-sm">${e.kind === "tab" ? `<span class="material-symbols-outlined text-violet-500 text-sm align-middle mr-1">tab</span>` : ""}${esc(e.label)}</div>
        <div class="text-[9px] font-mono text-slate-400">${esc(e.sub)}</div>
      </td>
      <td class="px-3 py-2 text-center">${rolePermIconHtml(d.roleVal)}</td>
      <td class="px-3 py-2 text-center">${upCellHtml(state, e)}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
  const all = wrap.querySelector("#upSelAll");
  if (all) all.indeterminate = all.dataset.indeterminate === "true";
  wrap.scrollTop = scrollTop;
}

function rolePermIconHtml(roleVal) {
  const { icon, cls } = upIcon(roleVal);
  return `<span class="material-symbols-outlined ${cls} opacity-60 text-lg" title="Valor do perfil: ${esc(LEVEL_LABELS[roleVal] || "Negado")}">${icon}</span>`;
}

function updateUserPermBar(state) {
  const panel = state.panel;
  if (!panel) return;
  const overrides = new Set(state.overrideKeys);
  state.pending.forEach((next, key) => { if (next === "inherit") overrides.delete(key); else overrides.add(key); });
  const setText = (id, v) => { const n = panel.querySelector(id); if (n) n.textContent = String(v); };
  setText("#upOverrideCount", overrides.size);
  setText("#upSelCount", state.selected.size);
  setText("#upPendCount", state.pending.size);
  panel.querySelector("#upSelBar")?.classList.toggle("hidden", state.selected.size === 0);
  panel.querySelector("#upPendInfo")?.classList.toggle("hidden", state.pending.size === 0);
  const primary = panel.querySelector("[data-primary]");
  if (primary) {
    primary.disabled = state.pending.size === 0 || state.saving;
    primary.classList.toggle("opacity-40", primary.disabled);
    primary.textContent = state.saving ? "A guardar…" : state.pending.size ? `Guardar alterações (${state.pending.size})` : "Guardar alterações";
  }
}

function refreshUserPermView(state) {
  renderUserPermTable(state);
  updateUserPermBar(state);
}

function buildUserPermBodyHtml(state) {
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-3 p-4 rounded-xl bg-slate-50 border border-slate-100">
      <div>
        <div class="text-sm font-bold text-slate-900">${esc(state.user.name || state.user.email)}</div>
        <div class="text-[10px] text-slate-500 mt-0.5">Perfil base: ${roleBadge(state.user.role)}</div>
      </div>
      <div class="text-[10px] font-black uppercase tracking-widest text-violet-600"><span id="upOverrideCount">0</span> personalizações</div>
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[11px] text-slate-500 font-medium">
      <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded ring-2 ring-violet-400"></span>Personalizado</span>
      <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded ring-1 ring-slate-300"></span>Herda do perfil</span>
      <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded ring-2 ring-amber-400"></span>Alteração pendente</span>
      <span><strong>P</strong> só os meus · <strong>V</strong> só ver</span>
    </div>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <div class="relative flex-1 min-w-[200px]">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg pointer-events-none">search</span>
        <input id="upSearch" type="search" placeholder="Pesquisar permissão, módulo ou acção…" class="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 font-medium">
      </div>
      <label class="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 px-3 py-2.5 rounded-xl border border-slate-200 bg-white cursor-pointer">
        <input type="checkbox" id="upOnlyCustom"> Só personalizadas
      </label>
      <button type="button" id="upCopyFrom" class="px-3 py-2.5 rounded-xl border border-violet-200 bg-violet-50 text-xs font-bold text-violet-700 hover:bg-violet-100 transition-colors inline-flex items-center gap-1.5"><span class="material-symbols-outlined text-base">content_copy</span>Copiar de outro utilizador…</button>
      <button type="button" id="upInheritAll" class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors">Remover todas as personalizações</button>
    </div>
    <div id="upSelBar" class="hidden flex flex-wrap items-center gap-2 mb-3 p-3 rounded-xl bg-violet-50 border border-violet-100">
      <span class="text-xs font-bold text-violet-800"><span id="upSelCount">0</span> selecionadas</span>
      <span class="text-[10px] uppercase tracking-widest text-violet-500">definir como</span>
      <button type="button" data-up-set="inherit" class="px-3 py-1.5 rounded-lg bg-white border border-violet-200 text-xs font-bold text-violet-700 hover:bg-violet-100">Herdar do perfil</button>
      ${LEVEL_BUTTONS.map((b) => `<button type="button" data-up-set="${b.value}" class="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100">${b.label}</button>`).join("")}
      <button type="button" id="upClearSel" class="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-white">Limpar seleção</button>
    </div>
    <p id="upPendInfo" class="hidden mb-3 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
      <span id="upPendCount">0</span> alterações pendentes — clique em «Guardar alterações» para aplicar.
    </p>
    <div id="upTableWrap" class="max-h-[48vh] overflow-y-auto border border-slate-100 rounded-xl"></div>`;
}

async function refreshSessionIfSelf(userId) {
  const me = getSessionUser();
  if (me?.id !== userId) return;
  const { clearPermissionCache, loadUserPermissions } = await import("../../shared/permissions.js");
  clearPermissionCache();
  await loadUserPermissions({ force: true });
}

async function saveUserPending(state) {
  if (!state.pending.size || state.saving) return;
  const items = [...state.pending].map(([key, allowed]) => {
    const [module, action] = key.split(":");
    return { module, action, allowed };
  });
  state.saving = true;
  updateUserPermBar(state);
  try {
    const res = await apiRequest(`/permissions/users/${encodeURIComponent(state.userId)}/bulk`, { method: "PUT", body: { items } });
    const fresh = await apiRequest(`/permissions/users/${encodeURIComponent(state.userId)}`);
    state.effectiveMap = { ...fresh.effectiveMap };
    state.roleMap = { ...fresh.roleMap };
    state.overrideKeys = [...(fresh.overrideKeys || [])];
    state.pending.clear();
    state.selected.clear();
    toast(`${res.applied ?? items.length} permissões actualizadas.`, { type: "success" });
    await refreshSessionIfSelf(state.userId);
  } catch (err) {
    toast(err.message || "Erro ao guardar.", { type: "error" });
  } finally {
    state.saving = false;
    refreshUserPermView(state);
  }
}

function wireUserPermPanel(state) {
  const panel = state.panel;
  let lastKey = null;

  panel.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-up-cell]");
    if (cell) {
      const key = cell.dataset.upCell;
      stageUserValue(state, key, upNextToken(state, key));
      refreshUserPermView(state);
      return;
    }
    const setBtn = e.target.closest("[data-up-set]");
    if (setBtn) {
      state.selected.forEach((key) => stageUserValue(state, key, setBtn.dataset.upSet));
      state.selected.clear();
      refreshUserPermView(state);
      return;
    }
    if (e.target.closest("#upCopyFrom")) { openCopyIntoUserPerms(state); return; }
    if (e.target.closest("#upClearSel")) { state.selected.clear(); refreshUserPermView(state); return; }
    if (e.target.closest("#upInheritAll")) {
      if (!state.overrideKeys.length && ![...state.pending.values()].some((v) => v !== "inherit")) {
        toast("Este utilizador não tem personalizações.", { type: "info" });
        return;
      }
      state.overrideKeys.forEach((key) => stageUserValue(state, key, "inherit"));
      state.pending.forEach((v, key) => { if (v !== "inherit") stageUserValue(state, key, "inherit"); });
      refreshUserPermView(state);
      return;
    }

    const cb = e.target.closest("input[data-up-sel]");
    if (cb) {
      const visible = upVisibleEntries(state).map((x) => x.key);
      const key = cb.dataset.upSel;
      if (e.shiftKey && lastKey && visible.includes(lastKey)) {
        const [a, b] = [visible.indexOf(lastKey), visible.indexOf(key)].sort((x, y) => x - y);
        visible.slice(a, b + 1).forEach((k) => (cb.checked ? state.selected.add(k) : state.selected.delete(k)));
      } else if (cb.checked) state.selected.add(key);
      else state.selected.delete(key);
      lastKey = key;
      refreshUserPermView(state);
      return;
    }
    const mod = e.target.closest("input[data-up-sel-module]");
    if (mod) {
      upVisibleEntries(state)
        .filter((x) => x.group.module === mod.dataset.upSelModule)
        .forEach((x) => (mod.checked ? state.selected.add(x.key) : state.selected.delete(x.key)));
      refreshUserPermView(state);
      return;
    }
    if (e.target.closest("#upSelAll")) {
      const on = e.target.closest("#upSelAll").checked;
      upVisibleEntries(state).forEach((x) => (on ? state.selected.add(x.key) : state.selected.delete(x.key)));
      refreshUserPermView(state);
    }
  });

  let t;
  panel.querySelector("#upSearch")?.addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.filter.q = e.target.value; renderUserPermTable(state); }, 150);
  });
  panel.querySelector("#upOnlyCustom")?.addEventListener("change", (e) => {
    state.filter.onlyCustom = e.target.checked;
    renderUserPermTable(state);
  });
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
      pending: new Map(),
      selected: new Set(),
      filter: { q: "", onlyCustom: false },
      saving: false,
    };
    activeUserPermState = state;

    const modal = openModal({
      title: "Permissões individuais",
      primaryLabel: "Guardar alterações",
      secondaryLabel: "Fechar",
      contentHtml: buildUserPermBodyHtml(state),
      onPrimary: async () => { await saveUserPending(state); },
      onSecondary: async ({ close }) => {
        if (state.pending.size && !window.confirm(`Tem ${state.pending.size} alterações por guardar. Fechar e descartar?`)) return;
        activeUserPermState = null;
        close();
      },
      onRender: ({ panel }) => {
        state.panel = panel;
        panel.classList.remove("max-w-[640px]");
        panel.classList.add("max-w-[980px]");
        panel.querySelector("[data-close]")?.addEventListener("click", () => { activeUserPermState = null; }, { once: true });
        wireUserPermPanel(state);
        refreshUserPermView(state);
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

// Wire click delegation for permission cells (matriz por perfil): alterar = pendente, guardar em lote
function wirePermissionClicks() {
  ensurePermBulkBar();
  window.addEventListener("beforeunload", (e) => {
    if (rolePending.size) { e.preventDefault(); e.returnValue = ""; }
  });

  document.addEventListener("click", (e) => {
    if (activeUserPermState) return;
    if (e.target?.closest?.("[data-perm-toggle]")) return;

    const cb = e.target?.closest?.("#permTableBody input[data-perm-sel]");
    if (cb) {
      const keys = roleCellCheckboxes().map((x) => x.dataset.permSel);
      const key = cb.dataset.permSel;
      if (e.shiftKey && roleLastSelectedKey && keys.includes(roleLastSelectedKey)) {
        const [a, b] = [keys.indexOf(roleLastSelectedKey), keys.indexOf(key)].sort((x, y) => x - y);
        setRoleSelection(keys.slice(a, b + 1), cb.checked);
      } else {
        setRoleSelection([key], cb.checked);
      }
      roleLastSelectedKey = key;
      return;
    }
    const rowCb = e.target?.closest?.("input[data-perm-sel-row]");
    if (rowCb) {
      const keys = [...(rowCb.closest("tr")?.querySelectorAll("input[data-perm-sel]") || [])].map((x) => x.dataset.permSel);
      setRoleSelection(keys, rowCb.checked);
      return;
    }
    const modCb = e.target?.closest?.("input[data-perm-sel-module]");
    if (modCb) {
      const keys = roleCellCheckboxes()
        .filter((x) => x.closest("tr")?.dataset.parentModule === modCb.dataset.permSelModule)
        .map((x) => x.dataset.permSel);
      setRoleSelection(keys, modCb.checked);
      return;
    }
    const colCb = e.target?.closest?.("input[data-perm-sel-col]");
    if (colCb) {
      const role = colCb.dataset.permSelCol;
      const keys = roleCellCheckboxes().map((x) => x.dataset.permSel).filter((k) => k.startsWith(`${role}|`));
      setRoleSelection(keys, colCb.checked);
      return;
    }

    const btn = e.target?.closest?.("button.role-perm-cell");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const role = btn.getAttribute("data-perm-role");
    const mod = btn.getAttribute("data-perm-module");
    const action = btn.getAttribute("data-perm-action");
    if (!role || !mod || !action) return;
    const key = permKey(role, mod, action);
    const current = roleCurrentValue(key);
    const nextIdx = (ALLOWED_CYCLE.indexOf(current) + 1) % ALLOWED_CYCLE.length;
    stageRoleValue(key, ALLOWED_CYCLE[nextIdx]);
    refreshPermCell(role, mod, action);
    syncRoleGroupCheckboxes();
    updatePermBulkBar();
  });
}

// ─── Load data ────────────────────────────────────────────────
async function loadUsers() {
  const tbody = el("usersTbody");
  if (tbody) tbody.innerHTML = renderLoadingRow(7);
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
    const isAllowedRole = ["operador", "financeiro", "leitura", "cliente", "tecnico", "supervisor"].includes(role);
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
// ─── Copiar permissões entre utilizadores ─────────────────────────────────────

const COPY_MODES = [
  { value: "overrides", label: "Só as personalizações", hint: "Copia as permissões individuais do utilizador de origem." },
  { value: "effective", label: "Igualar permissões efectivas", hint: "O destino fica com as mesmas permissões finais do origem, mesmo que tenham perfis diferentes." },
  { value: "role_and_overrides", label: "Perfil + personalizações", hint: "O destino passa a ter o mesmo perfil e as mesmas personalizações. Não se aplica a clientes." },
];

function copyUserOptionsHtml(excludeIds = [], selected = "") {
  const ex = new Set(excludeIds);
  return allUsers
    .filter((u) => !ex.has(u.id))
    .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), "pt"))
    .map((u) => `<option value="${esc(u.id)}" ${u.id === selected ? "selected" : ""}>${esc(u.name || u.email)} — ${esc(u.role)}</option>`)
    .join("");
}

function copyModeRadiosHtml(modes) {
  return modes.map((m, i) => `
    <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer hover:bg-slate-50">
      <input type="radio" name="cpMode" value="${m.value}" ${i === 0 ? "checked" : ""} class="mt-1">
      <span><span class="block text-sm font-bold text-slate-800">${esc(m.label)}</span>
      <span class="block text-xs text-slate-500">${esc(m.hint)}</span></span>
    </label>`).join("");
}

function describeRoleChange(rc) {
  return rc ? `perfil ${esc(rc.from)} → <strong>${esc(rc.to)}</strong>` : "";
}

/** Dentro do modal de permissões individuais: calcula o que seria copiado e deixa as alterações PENDENTES para rever. */
function openCopyIntoUserPerms(state) {
  const others = allUsers.filter((u) => u.id !== state.userId);
  if (!others.length) { toast("Não há outros utilizadores.", { type: "info" }); return; }
  openModal({
    title: "Copiar permissões de outro utilizador",
    primaryLabel: "Preencher alterações",
    secondaryLabel: "Cancelar",
    contentHtml: `
      <div class="space-y-4">
        <label class="block">
          <span class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Copiar de</span>
          <select id="cpSource" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 font-semibold">${copyUserOptionsHtml([state.userId])}</select>
        </label>
        <div class="space-y-2">${copyModeRadiosHtml(COPY_MODES.slice(0, 2))}</div>
        <label class="block" id="cpStrategyWrap">
          <span class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">As personalizações actuais deste utilizador</span>
          <select id="cpStrategy" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 font-semibold">
            <option value="merge">Manter e juntar as copiadas</option>
            <option value="replace">Substituir pelas copiadas</option>
          </select>
        </label>
        <p class="text-[11px] text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">Nada é gravado agora: as alterações ficam <strong>pendentes</strong> na matriz para as rever e guardar.</p>
      </div>`,
    onRender: ({ panel }) => {
      const sync = () => {
        const mode = panel.querySelector('input[name="cpMode"]:checked')?.value;
        panel.querySelector("#cpStrategyWrap")?.classList.toggle("hidden", mode !== "overrides");
      };
      panel.addEventListener("change", sync);
      sync();
    },
    onPrimary: async ({ close, btn, panel }) => {
      const sourceId = panel.querySelector("#cpSource")?.value;
      const mode = panel.querySelector('input[name="cpMode"]:checked')?.value || "overrides";
      const strategy = panel.querySelector("#cpStrategy")?.value || "merge";
      if (!sourceId) { toast("Escolha o utilizador de origem.", { type: "error" }); return; }
      try {
        setButtonLoading(btn, true);
        const res = await apiRequest(`/permissions/users/${encodeURIComponent(state.userId)}/copy-from/${encodeURIComponent(sourceId)}`, {
          method: "POST",
          body: { mode, strategy, dryRun: true },
        });
        // fica pendente na matriz; "replace"/"effective" já vêm com as remoções (herdar)
        state.pending.clear();
        (res.changes || []).forEach((c) => stageUserValue(state, `${c.module}:${c.action}`, c.after));
        state.selected.clear();
        refreshUserPermView(state);
        close();
        toast((res.changes || []).length
          ? `${res.changes.length} alterações prontas para rever. Clique em «Guardar alterações» para aplicar.`
          : "O utilizador já tem estas permissões — nada a alterar.", { type: "info" });
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Não foi possível calcular a cópia.", { type: "error" });
      }
    },
  });
}

/** Da lista de utilizadores: aplica as permissões de um utilizador a vários, com pré-visualização. */
function openCopyToUsersModal(targetIds) {
  const targets = allUsers.filter((u) => targetIds.includes(u.id));
  if (!targets.length) return;
  let previewed = false;
  openModal({
    title: `Copiar permissões para ${targets.length} utilizador${targets.length === 1 ? "" : "es"}`,
    primaryLabel: "Pré-visualizar",
    secondaryLabel: "Cancelar",
    width: 640,
    contentHtml: `
      <div class="space-y-4">
        <div class="text-xs text-slate-500">Destino: ${targets.slice(0, 6).map((u) => `<strong>${esc(u.name || u.email)}</strong>`).join(", ")}${targets.length > 6 ? ` e mais ${targets.length - 6}` : ""}</div>
        <label class="block">
          <span class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Copiar de</span>
          <select id="cpSource" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 font-semibold">${copyUserOptionsHtml(targetIds)}</select>
        </label>
        <div class="space-y-2">${copyModeRadiosHtml(COPY_MODES)}</div>
        <label class="block" id="cpStrategyWrap">
          <span class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">As personalizações actuais dos destinos</span>
          <select id="cpStrategy" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 font-semibold">
            <option value="merge">Manter e juntar as copiadas</option>
            <option value="replace">Substituir pelas copiadas</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
          <input type="checkbox" id="cpProjects"> Copiar também as obras atribuídas
        </label>
        <div id="cpPreview"></div>
      </div>`,
    onRender: ({ panel }) => {
      const prim = panel.querySelector("[data-primary]");
      const reset = () => {
        previewed = false;
        if (prim) prim.textContent = "Pré-visualizar";
        const mode = panel.querySelector('input[name="cpMode"]:checked')?.value;
        panel.querySelector("#cpStrategyWrap")?.classList.toggle("hidden", mode !== "overrides");
        const pv = panel.querySelector("#cpPreview");
        if (pv) pv.innerHTML = "";
      };
      panel.addEventListener("change", reset);
      reset();
    },
    onPrimary: async ({ close, btn, panel }) => {
      const sourceId = panel.querySelector("#cpSource")?.value;
      const mode = panel.querySelector('input[name="cpMode"]:checked')?.value || "overrides";
      const strategy = panel.querySelector("#cpStrategy")?.value || "merge";
      const copyProjects = Boolean(panel.querySelector("#cpProjects")?.checked);
      if (!sourceId) { toast("Escolha o utilizador de origem.", { type: "error" }); return; }
      const dryRun = !previewed;
      try {
        setButtonLoading(btn, true);
        const res = await apiRequest("/permissions/copy", {
          method: "POST",
          body: { sourceId, targetIds, mode, strategy, copyProjects, dryRun },
        });
        setButtonLoading(btn, false);
        if (dryRun) {
          const rows = res.results.map((r) => {
            const t = targets.find((u) => u.id === r.targetId);
            const name = esc(r.targetName || t?.name || t?.email || r.targetId);
            if (!r.ok) return `<li class="flex justify-between gap-3 text-red-600"><span>${name}</span><span>${esc(r.error)}</span></li>`;
            const parts = [`${r.changes} alteraç${r.changes === 1 ? "ão" : "ões"}`];
            if (r.roleChange) parts.push(describeRoleChange(r.roleChange));
            return `<li class="flex justify-between gap-3"><span class="font-semibold text-slate-700">${name}</span><span class="text-slate-500">${parts.join(" · ")}</span></li>`;
          }).join("");
          const pv = panel.querySelector("#cpPreview");
          if (pv) pv.innerHTML = `<div class="rounded-xl border border-slate-200 bg-slate-50 p-3"><div class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Pré-visualização</div><ul class="space-y-1 text-xs max-h-48 overflow-y-auto">${rows}</ul></div>`;
          previewed = true;
          const prim = panel.querySelector("[data-primary]");
          if (prim) prim.textContent = "Aplicar";
          return;
        }
        const okCount = res.results.filter((r) => r.ok).length;
        const failed = res.results.length - okCount;
        toast(failed ? `Copiado para ${okCount}; ${failed} falharam.` : `Permissões copiadas para ${okCount} utilizador${okCount === 1 ? "" : "es"}.`, { type: failed ? "error" : "success" });
        selectedUserIds.clear();
        close();
        await loadUsers();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao copiar permissões.", { type: "error" });
      }
    },
  });
}

// ── Selecção de utilizadores na lista ─────────────────────────
function syncUsersBulkBar() {
  const bar = el("usersBulkBar");
  if (!bar) return;
  bar.classList.toggle("hidden", selectedUserIds.size === 0);
  const c = el("usersBulkCount");
  if (c) c.textContent = String(selectedUserIds.size);
  const all = el("usersSelectAll");
  if (all) {
    const ids = filterUsers().map((u) => u.id);
    const n = ids.filter((id) => selectedUserIds.has(id)).length;
    all.checked = ids.length > 0 && n === ids.length;
    all.indeterminate = n > 0 && n < ids.length;
  }
}


// ─── Formulário de utilizador (drawer por secções) ─────────────────────────────

const F_INPUT = "w-full h-11 rounded-xl border border-slate-200 px-4 text-sm bg-white font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 transition";
const F_LABEL = "block text-xs font-bold text-slate-600 mb-1.5";
const F_HELP = "mt-1 text-[11px] text-slate-400 font-medium";

function formField(label, inputHtml, help = "") {
  return `<div><label class="${F_LABEL}">${label}</label>${inputHtml}${help ? `<p class="${F_HELP}">${help}</p>` : ""}</div>`;
}

function toggleRow(id, label, hint, checked) {
  return `<label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer hover:bg-slate-50 transition-colors">
    <input id="${id}" type="checkbox" ${checked ? "checked" : ""} class="mt-0.5 w-4 h-4 rounded border-slate-300 accent-slate-900">
    <span><span class="block text-sm font-bold text-slate-800">${label}</span><span class="block text-xs text-slate-500">${hint}</span></span>
  </label>`;
}

function projectPickerHtml(projects, selectedIds = []) {
  if (!projects.length) return `<p class="text-sm text-slate-400 italic">Nenhuma obra registada.</p>`;
  const sel = new Set(selectedIds);
  return `<div data-proj-picker>
    <div class="flex gap-2 mb-3">
      <div class="relative flex-1">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg pointer-events-none">search</span>
        <input data-proj-search type="search" placeholder="Pesquisar obra…" class="${F_INPUT} pl-10">
      </div>
      <button type="button" data-proj-all class="px-3 h-11 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50">Todas</button>
      <button type="button" data-proj-none class="px-3 h-11 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50">Nenhuma</button>
    </div>
    <p class="text-[11px] font-semibold text-slate-500 mb-2"><span data-proj-count>${selectedIds.length}</span> de ${projects.length} obras selecionadas</p>
    <div class="space-y-1 max-h-[44vh] overflow-y-auto border border-slate-200 rounded-xl p-2 bg-white" data-proj-list>
      ${projects.map((p) => `
        <label data-proj-item data-text="${esc(`${p.name} ${p.code}`.toLowerCase())}" class="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
          <input type="checkbox" name="assignedProjects" value="${esc(p.id)}" ${sel.has(p.id) ? "checked" : ""} class="w-4 h-4 rounded border-slate-300 accent-slate-900">
          <span class="min-w-0"><span class="block text-sm font-semibold text-slate-800 truncate">${esc(p.name)}</span>
          <span class="block text-[10px] font-black text-slate-400 uppercase tracking-widest">${esc(p.code)}</span></span>
        </label>`).join("")}
    </div>
  </div>`;
}

function wireProjectPicker(panel, drawer) {
  const picker = panel.querySelector("[data-proj-picker]");
  if (!picker) return;
  const items = () => [...picker.querySelectorAll("[data-proj-item]")];
  const update = () => {
    const n = picker.querySelectorAll('input[name="assignedProjects"]:checked').length;
    const c = picker.querySelector("[data-proj-count]");
    if (c) c.textContent = String(n);
    drawer.setBadge("obras", n ? String(n) : "");
  };
  picker.querySelector("[data-proj-search]")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    items().forEach((it) => it.classList.toggle("hidden", Boolean(q) && !it.dataset.text.includes(q)));
  });
  const setVisible = (on) => {
    items().filter((it) => !it.classList.contains("hidden")).forEach((it) => { it.querySelector("input").checked = on; });
    update();
    panel.dispatchEvent(new Event("change"));
  };
  picker.querySelector("[data-proj-all]")?.addEventListener("click", () => setVisible(true));
  picker.querySelector("[data-proj-none]")?.addEventListener("click", () => setVisible(false));
  picker.addEventListener("change", update);
  update();
}

function userDrawerSections(mode, u, clients, projects) {
  const edit = mode === "edit";
  const role0 = u?.role || "leitura";
  const selectedIds = (u?.assignedProjects || []).map((p) => p.id);

  const dados = `
    <div class="space-y-4">
      ${formField("Nome completo", `<input id="f_name" type="text" class="${F_INPUT}" value="${esc(u?.name || "")}" placeholder="Nome do utilizador">`)}
      ${formField("Email *", `<input id="f_email" type="email" class="${F_INPUT}" value="${esc(u?.email || "")}" placeholder="utilizador@empresa.com" autocomplete="off">`)}
      ${edit ? `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          ${formField("Telefone", `<input id="f_phone" type="tel" class="${F_INPUT}" value="${esc(u?.profile?.phone || "")}" placeholder="+244 …">`)}
          ${formField("WhatsApp", `<input id="f_whatsapp" type="tel" class="${F_INPUT}" value="${esc(u?.profile?.whatsapp || "")}" placeholder="+244 …">`)}
        </div>
        <div class="pt-2">
          <p class="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Funções e notificações</p>
          <div class="space-y-2">
            ${toggleRow("f_fin_receiver", "Receptor financeiro", "Recebe as notificações de pagamentos.", u?.profile?.isFinancialReceiver)}
            ${toggleRow("f_approver", "Aprovador", "Pode ser indicado como aprovador de pedidos.", u?.profile?.isApprover)}
            ${toggleRow("f_proj_resp", "Responsável pela obra", "Aparece como responsável nas obras.", u?.profile?.isProjectResponsible)}
          </div>
        </div>` : ""}
    </div>`;

  const acesso = `
    <div class="space-y-4">
      ${formField("Perfil de acesso", `<select id="f_role" class="${F_INPUT} font-semibold">${roleOptionsHtml(role0)}</select><p id="f_role_hint" class="${F_HELP}"></p>`)}
      <div id="f_cli_wrap" class="hidden">
        ${formField("Cliente vinculado *", `<select id="f_client" class="${F_INPUT}">${renderClientOptions(clients, u?.clientId || "")}</select>`)}
      </div>
      ${edit
        ? `<div class="pt-4 border-t border-slate-100">
            <label class="${F_LABEL}">Redefinir palavra-passe</label>
            <div class="flex gap-2">
              <input id="f_reset_pass" type="password" class="${F_INPUT}" placeholder="Nova palavra-passe (mín. 6 caracteres)" autocomplete="new-password">
              <button type="button" id="f_reset_btn" class="px-4 h-11 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-700 transition-colors shrink-0">Redefinir</button>
            </div>
          </div>`
        : formField("Palavra-passe *", `<input id="f_pass" type="password" class="${F_INPUT}" placeholder="Mínimo 6 caracteres" autocomplete="new-password">`)}
    </div>`;

  const obras = `
    <div id="f_obras_note" class="hidden p-4 rounded-xl bg-slate-50 border border-slate-100 text-sm text-slate-600">
      Este perfil tem acesso a todas as obras — não é necessário atribuí-las.
    </div>
    <div id="f_obras_body">
      <p class="text-xs text-slate-500 mb-3">Obras que este utilizador poderá ver e gerir.</p>
      ${projectPickerHtml(projects, selectedIds)}
    </div>`;

  const overrideCount = u?._count?.permissions ?? 0;
  const permissoes = edit
    ? `<div class="space-y-4">
        <div class="p-4 rounded-xl bg-violet-50 border border-violet-100">
          <div class="text-sm font-bold text-violet-900">${overrideCount ? `${overrideCount} permiss${overrideCount === 1 ? "ão personalizada" : "ões personalizadas"}` : "Usa só as permissões do perfil"}</div>
          <p class="text-xs text-violet-700/80 mt-0.5">As permissões individuais acrescentam ou retiram acessos ao perfil, só para este utilizador.</p>
        </div>
        <div class="flex flex-col sm:flex-row gap-2">
          <button type="button" id="f_open_perms" class="flex-1 h-11 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-2"><span class="material-symbols-outlined text-base">shield_person</span>Ver e editar permissões</button>
          <button type="button" id="f_copy_perms" class="flex-1 h-11 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-2"><span class="material-symbols-outlined text-base">content_copy</span>Copiar de outro utilizador…</button>
        </div>
      </div>`
    : `<div class="space-y-4">
        <p class="text-xs text-slate-500">Por omissão, o novo utilizador fica só com as permissões do perfil escolhido.</p>
        ${formField("Copiar permissões de (opcional)", `<select id="f_copy_from" class="${F_INPUT} font-semibold"><option value="">— Só as do perfil —</option>${copyUserOptionsHtml([])}</select>`,
          "Fica com as mesmas permissões finais do utilizador escolhido. Depois pode ajustá-las uma a uma.")}
      </div>`;

  return [
    { id: "dados", label: "Dados", icon: "badge", html: dados },
    { id: "acesso", label: "Acesso", icon: "key", html: acesso },
    { id: "obras", label: "Obras", icon: "apartment", html: obras, badge: selectedIds.length ? String(selectedIds.length) : "" },
    { id: "permissoes", label: "Permissões", icon: "shield_person", html: permissoes },
  ];
}

async function openUserDrawer(mode, id = null) {
  const edit = mode === "edit";
  let clients, projects, u = null;
  try {
    const [c, p, data] = await Promise.all([loadClients(), loadAllProjects(), edit ? apiRequest("/users") : Promise.resolve(null)]);
    clients = c; projects = p;
    if (edit) {
      u = (data.items || []).find((x) => x.id === id);
      if (!u) { toast("Utilizador não encontrado.", { type: "error" }); return; }
    }
  } catch (err) {
    toast(err.message || "Não foi possível abrir o formulário.", { type: "error" });
    return;
  }

  const headerHtml = edit
    ? `<div class="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
        ${avatarEl(u.email, u.profilePic || u.client?.profilePic)}
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold text-slate-900 truncate">${esc(u.name || u.email)}</div>
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID ${esc(u.id.slice(0, 8))} · desde ${esc(formatDateBR(u.createdAt))}</div>
        </div>
        ${roleBadge(u.role)}
      </div>`
    : "";

  openDrawer({
    title: edit ? "Editar utilizador" : "Novo utilizador",
    subtitle: edit ? "" : "Crie a conta e defina o acesso.",
    headerHtml,
    sections: userDrawerSections(mode, u, clients, projects),
    primaryLabel: edit ? "Guardar alterações" : "Criar conta",
    dangerLabel: edit ? "Excluir conta" : "",
    onRender: (drawer) => {
      const { panel } = drawer;
      const roleEl = panel.querySelector("#f_role");
      const syncRole = () => {
        const role = roleEl.value;
        panel.querySelector("#f_cli_wrap")?.classList.toggle("hidden", role !== "cliente");
        const hint = panel.querySelector("#f_role_hint");
        if (hint) hint.textContent = roleDef(role).hint;
        const scoped = isProjectScopedRole(role);
        panel.querySelector("#f_obras_note")?.classList.toggle("hidden", scoped);
        panel.querySelector("#f_obras_body")?.classList.toggle("hidden", !scoped);
      };
      roleEl.addEventListener("change", syncRole);
      syncRole();
      wireProjectPicker(panel, drawer);

      panel.querySelector("#f_open_perms")?.addEventListener("click", () => openUserPermissions(id));
      panel.querySelector("#f_copy_perms")?.addEventListener("click", () => openCopyToUsersModal([id]));
      panel.querySelector("#f_reset_btn")?.addEventListener("click", async () => {
        const input = panel.querySelector("#f_reset_pass");
        const pass = input?.value?.trim();
        clearFieldErrors(panel);
        if (!pass || pass.length < 6) { setFieldError(panel, "#f_reset_pass", "Mínimo 6 caracteres.", drawer.showSection); return; }
        const btn = panel.querySelector("#f_reset_btn");
        try {
          setButtonLoading(btn, true);
          await apiRequest(`/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: { password: pass } });
          input.value = "";
          toast("Palavra-passe redefinida com sucesso.", { type: "success" });
        } catch (err) {
          toast(err.message || "Erro ao redefinir.", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
        }
      });
    },
    onPrimary: async ({ btn, close, panel, showSection }) => {
      const v = (sel) => panel.querySelector(sel)?.value?.trim?.() ?? "";
      const role = v("#f_role");
      const email = v("#f_email");
      const clientId = v("#f_client") || null;

      let invalid = false;
      if (!/^\S+@\S+\.\S+$/.test(email)) { setFieldError(panel, "#f_email", "Indique um email válido.", showSection); invalid = true; }
      if (!edit && v("#f_pass").length < 6) { setFieldError(panel, "#f_pass", "A palavra-passe deve ter pelo menos 6 caracteres.", showSection); invalid = true; }
      if (role === "cliente" && !clientId) { setFieldError(panel, "#f_client", "Selecione o cliente vinculado.", showSection); invalid = true; }
      if (invalid) return;

      const assignedProjectIds = isProjectScopedRole(role)
        ? Array.from(panel.querySelectorAll('input[name="assignedProjects"]:checked')).map((i) => i.value)
        : [];

      if (!edit) {
        try {
          setButtonLoading(btn, true);
          const created = await apiRequest("/users", {
            method: "POST",
            body: { email, name: v("#f_name") || null, password: v("#f_pass"), role, clientId, assignedProjectIds },
          });
          const copyFrom = v("#f_copy_from");
          if (copyFrom && created?.id) {
            try {
              const r = await apiRequest(`/permissions/users/${encodeURIComponent(created.id)}/copy-from/${encodeURIComponent(copyFrom)}`, {
                method: "POST", body: { mode: "effective" },
              });
              toast(`Utilizador criado com ${r.applied || 0} permissões copiadas.`, { type: "success" });
            } catch (err) {
              toast("Utilizador criado, mas não foi possível copiar as permissões: " + (err.message || ""), { type: "error" });
            }
          } else {
            toast("Utilizador criado com sucesso.", { type: "success" });
          }
          close();
          await loadUsers();
        } catch (err) {
          setButtonLoading(btn, false);
          if (/EMAIL_ALREADY_EXISTS/.test(err.message || "")) setFieldError(panel, "#f_email", "Já existe uma conta com este email.", showSection);
          else toast(err.message || "Erro ao criar utilizador.", { type: "error" });
        }
        return;
      }

      // Mudança de perfil com permissões individuais: perguntar se se mantêm ou se limpam
      let permissionOverrides;
      if (role !== u.role) {
        try {
          const perms = await apiRequest(`/permissions/users/${encodeURIComponent(id)}`);
          const count = (perms.overrideKeys || []).length;
          if (count > 0) {
            const choice = await askKeepOrClearOverrides(count, u.role, role);
            if (!choice) return;
            permissionOverrides = choice;
          }
        } catch { /* sem acesso às permissões: segue sem alterar as personalizações */ }
      }

      try {
        setButtonLoading(btn, true);
        await apiRequest(`/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: {
            ...(permissionOverrides ? { permissionOverrides } : {}),
            email,
            name: v("#f_name") || null,
            role,
            clientId,
            assignedProjectIds,
            phone: v("#f_phone") || null,
            whatsapp: v("#f_whatsapp") || null,
            isFinancialReceiver: panel.querySelector("#f_fin_receiver")?.checked || false,
            isApprover: panel.querySelector("#f_approver")?.checked || false,
            isProjectResponsible: panel.querySelector("#f_proj_resp")?.checked || false,
          },
        });
        toast("Utilizador atualizado.", { type: "success" });
        close();
        await loadUsers();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao atualizar.", { type: "error" });
      }
    },
    onDanger: async ({ btn, close }) => {
      if (!window.confirm(`Excluir ${u.name || u.email}? Esta ação é irreversível.`)) return;
      try {
        setButtonLoading(btn, true);
        await apiRequest(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Utilizador excluído.", { type: "success" });
        close();
        await loadUsers();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao excluir.", { type: "error" });
      }
    },
  });
}

function openCreate() { return openUserDrawer("create"); }
function openEdit(id) { return openUserDrawer("edit", id); }

function askKeepOrClearOverrides(count, fromRole, toRole) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value, close) => {
      if (done) return;
      done = true;
      close?.();
      resolve(value);
    };
    const modal = openModal({
      title: "Permissões individuais",
      primaryLabel: "Manter personalizações",
      secondaryLabel: "Limpar personalizações",
      contentHtml: `<p class="text-sm text-slate-600">Este utilizador tem <strong>${count}</strong> permiss${count === 1 ? "ão personalizada" : "ões personalizadas"}.
        Ao mudar o perfil de <strong>${esc(fromRole)}</strong> para <strong>${esc(toRole)}</strong>, quer manter essas personalizações ou voltar a herdar apenas o novo perfil?</p>`,
      onPrimary: async ({ close }) => finish("keep", close),
      onSecondary: async ({ close }) => finish("clear", close),
    });
    modal.panel.querySelector("[data-close]")?.addEventListener("click", () => finish(null));
    modal.overlay.addEventListener("click", (e) => { if (e.target === modal.overlay) finish(null); });
  });
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
  el("m-ajuda")?.addEventListener("click", () => { closeMobileSidebar(); switchSection("ajuda"); });

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
    const copyId = e.target?.closest?.("[data-user-copy]")?.getAttribute?.("data-user-copy");
    if (copyId) { openCopyToUsersModal([copyId]); return; }
    const permsId = e.target?.closest?.("[data-user-perms]")?.getAttribute?.("data-user-perms");
    if (permsId) { openUserPermissions(permsId); return; }
    const editId = e.target?.closest?.("[data-edit-user]")?.getAttribute?.("data-edit-user");
    if (editId) { openEdit(editId); return; }
    const delId = e.target?.closest?.("[data-delete-user]")?.getAttribute?.("data-delete-user");
    if (delId) { deleteUser(delId); return; }
  });

  // Seleccionar utilizadores (copiar permissões em lote)
  document.addEventListener("change", (e) => {
    const cb = e.target?.closest?.("input[data-user-sel]");
    if (cb) {
      if (cb.checked) selectedUserIds.add(cb.dataset.userSel);
      else selectedUserIds.delete(cb.dataset.userSel);
      cb.closest("tr")?.classList.toggle("bg-violet-50/40", cb.checked);
      syncUsersBulkBar();
      return;
    }
    if (e.target?.id === "usersSelectAll") {
      const on = e.target.checked;
      filterUsers().forEach((u) => (on ? selectedUserIds.add(u.id) : selectedUserIds.delete(u.id)));
      renderTable(filterUsers());
    }
  });
  el("usersBulkCopy")?.addEventListener("click", () => openCopyToUsersModal([...selectedUserIds]));
  el("usersBulkClear")?.addEventListener("click", () => { selectedUserIds.clear(); renderTable(filterUsers()); });

  // Filtro de perfis a partir da fonte única
  const rf = el("roleFilter");
  if (rf) rf.innerHTML = roleOptionsHtml("", { all: true });

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
  el("resetPermsBtn")?.addEventListener("click", () => {
    const labelOf = (r) => r.charAt(0).toUpperCase() + r.slice(1);
    openModal({
      title: "Repor permissões padrão",
      primaryLabel: "Repor",
      contentHtml: `
        <div class="space-y-4">
          <p class="text-sm text-slate-600">Repõe os valores padrão do catálogo para os perfis. As permissões <strong>individuais</strong> dos utilizadores não são alteradas. A acção fica registada na auditoria.</p>
          <label class="block">
            <span class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Âmbito</span>
            <select id="resetScope" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 font-semibold">
              <option value="">Todos os perfis</option>
              ${ROLES.map((r) => `<option value="${r}">${labelOf(r)}</option>`).join("")}
            </select>
          </label>
          <label class="block">
            <span class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Escreva REPOR para confirmar</span>
            <input id="resetConfirm" type="text" autocomplete="off" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 font-semibold" placeholder="REPOR">
          </label>
        </div>`,
      onPrimary: async ({ close, btn, panel }) => {
        if (panel.querySelector("#resetConfirm")?.value?.trim().toUpperCase() !== "REPOR") {
          toast("Escreva REPOR para confirmar.", { type: "error" });
          return;
        }
        const role = panel.querySelector("#resetScope")?.value || undefined;
        try {
          setButtonLoading(btn, true);
          await apiRequest("/permissions/reset", { method: "POST", body: role ? { role } : {} });
          toast(role ? `Permissões do perfil «${role}» repostas.` : "Permissões repostas com sucesso.", { type: "success" });
          const { clearPermissionCache } = await import("../../shared/permissions.js");
          clearPermissionCache();
          rolePending.clear();
          roleSelected.clear();
          close();
          await loadPermissions();
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message || "Erro ao repor permissões.", { type: "error" });
        }
      },
    });
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

  el("permAuditRefresh")?.addEventListener("click", () => loadPermAudit());
  el("permAuditMore")?.addEventListener("click", () => loadPermAudit({ append: true }));

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

// ─── Auditoria de permissões ───────────────────────────────────
let permAuditItems = [];
let permAuditTotal = 0;
const PERM_AUDIT_PAGE = 20;

function auditValueLabel(v) {
  if (v === "inherit") return "herdar";
  if (v === null || v === undefined || v === "") return "—";
  return LEVEL_LABELS[v] || String(v);
}

function renderPermAudit() {
  const list = el("permAuditList");
  if (!list) return;
  if (!permAuditItems.length) {
    list.innerHTML = `<p class="px-6 py-8 text-center text-sm text-slate-400">Ainda não há alterações registadas.</p>`;
  } else {
    list.innerHTML = permAuditItems.map((l) => {
      const actor = l.actorUser?.name || l.actorUser?.email || "—";
      const target = l.targetType === "role"
        ? (l.targetId === "*" ? "Todos os perfis" : `Perfil ${esc(l.targetId || l.role || "")}`)
        : esc(l.targetUser?.name || l.targetUser?.email || l.targetId || "Utilizador");
      const changes = l.context?.changes;
      let summary;
      if ((l.action === "bulk" || l.action === "copy") && Array.isArray(changes)) {
        const head = l.action === "copy" ? `${esc(l.reason || "Cópia de permissões")} · ` : "";
        summary = `<details class="mt-1"><summary class="text-xs font-semibold text-slate-600 cursor-pointer">${head}${changes.length} alteraç${changes.length === 1 ? "ão" : "ões"}${l.action === "copy" ? "" : " em lote"}</summary>
          <ul class="mt-1 text-[11px] text-slate-500 space-y-0.5 max-h-40 overflow-y-auto">${changes.map((c) =>
            `<li><span class="font-mono">${esc(c.module)}·${esc(c.action)}</span>: ${esc(auditValueLabel(c.before))} → <strong>${esc(auditValueLabel(c.after))}</strong></li>`).join("")}</ul></details>`;
      } else if (l.action === "reset") {
        summary = `<div class="text-xs text-slate-600">${esc(l.reason || "Reposição de permissões")}</div>`;
      } else {
        summary = `<div class="text-xs text-slate-600"><span class="font-mono">${esc(l.module || "")}·${esc(l.action || "")}</span>: ${esc(auditValueLabel(l.beforeValue))} → <strong>${esc(auditValueLabel(l.afterValue))}</strong></div>`;
      }
      const when = new Date(l.createdAt).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
      return `<div class="px-6 py-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="text-sm font-bold text-slate-800">${target}</div>
          <div class="text-[11px] text-slate-400 font-medium">${esc(actor)} · ${esc(when)}</div>
        </div>${summary}</div>`;
    }).join("");
  }
  el("permAuditMore")?.classList.toggle("hidden", permAuditItems.length >= permAuditTotal);
}

async function loadPermAudit({ append = false } = {}) {
  try {
    const skip = append ? permAuditItems.length : 0;
    const data = await apiRequest(`/permissions/audit?take=${PERM_AUDIT_PAGE}&skip=${skip}`);
    permAuditTotal = data.total || 0;
    permAuditItems = append ? permAuditItems.concat(data.items || []) : (data.items || []);
    renderPermAudit();
  } catch {
    const list = el("permAuditList");
    if (list) list.innerHTML = `<p class="px-6 py-8 text-center text-sm text-red-400">Não foi possível carregar a auditoria.</p>`;
  }
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

// ─── Ajuda inbox ──────────────────────────────────────────────
let helpTickets = [];
let helpSelectedId = null;
let helpSearchTimer = null;

function helpTypeLabel(type) {
  return type === "DUVIDA" ? "Dúvida" : "Melhoria";
}

function helpStatusLabel(status) {
  if (status === "RESOLVIDO") return "Resolvido";
  if (status === "EM_ANALISE") return "Em análise";
  return "Aberto";
}

function helpStatusClass(status) {
  if (status === "RESOLVIDO") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (status === "EM_ANALISE") return "bg-amber-50 text-amber-700 border-amber-100";
  return "bg-sky-50 text-sky-700 border-sky-100";
}

function updateHelpBadge(openCount) {
  const badge = el("sidebar-help-count");
  if (!badge) return;
  const n = Number(openCount) || 0;
  badge.textContent = String(n);
  badge.classList.toggle("hidden", n === 0);
}

function renderHelpList() {
  const list = el("helpTicketsList");
  if (!list) return;
  if (!helpTickets.length) {
    list.innerHTML = `<div class="p-8 text-center text-sm text-slate-400 font-semibold">Nenhum pedido encontrado.</div>`;
    return;
  }
  list.innerHTML = helpTickets.map((t) => {
    const active = t.id === helpSelectedId ? "bg-slate-50" : "bg-white hover:bg-slate-50";
    return `
      <button type="button" data-help-id="${esc(t.id)}" class="w-full text-left px-5 py-4 ${active} transition-colors">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="text-[10px] font-black uppercase tracking-widest ${t.type === "DUVIDA" ? "text-sky-700" : "text-slate-700"}">${esc(helpTypeLabel(t.type))}</span>
          <span class="px-2 py-0.5 rounded-lg border text-[9px] font-black uppercase tracking-widest ${helpStatusClass(t.status)}">${esc(helpStatusLabel(t.status))}</span>
        </div>
        <p class="text-sm font-semibold text-slate-800 line-clamp-2">${esc(t.message)}</p>
        <p class="text-[11px] text-slate-400 mt-1">${esc(t.createdBy?.name || t.createdBy?.email || "—")} · ${esc(formatDateBR(t.createdAt))}</p>
      </button>`;
  }).join("");
  list.querySelectorAll("[data-help-id]").forEach((btn) => {
    btn.addEventListener("click", () => selectHelpTicket(btn.getAttribute("data-help-id")));
  });
}

function renderHelpDetail(ticket) {
  const box = el("helpTicketDetail");
  if (!box) return;
  if (!ticket) {
    box.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-slate-400 gap-2 py-16">
        <span class="material-symbols-outlined text-5xl">help</span>
        <p class="text-sm font-semibold">Seleccione um pedido para ver o detalhe.</p>
      </div>`;
    return;
  }
  const shot = ticket.screenshotUrl ? getAssetUrl(ticket.screenshotUrl) : null;
  box.innerHTML = `
    <div class="flex flex-col gap-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">${esc(helpTypeLabel(ticket.type))}</div>
          <h2 class="text-xl font-bold text-slate-900">${esc(ticket.createdBy?.name || ticket.createdBy?.email || "Utilizador")}</h2>
          <p class="text-sm text-slate-500">${esc(ticket.createdBy?.email || "")} · ${esc(formatDateBR(ticket.createdAt))}</p>
        </div>
        <span class="px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest ${helpStatusClass(ticket.status)}">${esc(helpStatusLabel(ticket.status))}</span>
      </div>
      ${shot ? `<a href="${esc(shot)}" target="_blank" rel="noopener" class="rounded-2xl overflow-hidden border border-slate-100 block">
        <img src="${esc(shot)}" alt="Captura de ecrã" class="w-full max-h-80 object-contain bg-slate-50" />
      </a>` : ""}
      <p class="text-[11px] text-slate-400 font-medium break-all">
        <span class="material-symbols-outlined text-sm align-middle">location_on</span>
        ${esc(ticket.pageTitle || "")} ${ticket.pageTitle && ticket.pageUrl ? "·" : ""} ${esc(ticket.pageUrl || "")}
      </p>
      <div>
        <div class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Mensagem</div>
        <p class="text-sm text-slate-800 font-medium whitespace-pre-wrap">${esc(ticket.message)}</p>
      </div>
      <div>
        <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Resposta</label>
        <textarea id="helpAdminReply" rows="4" class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800">${esc(ticket.adminReply || "")}</textarea>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" id="helpSaveReply" class="h-10 px-4 rounded-xl bg-slate-900 text-[#2afc8d] text-[10px] font-black uppercase tracking-widest">Guardar resposta</button>
        ${ticket.status === "ABERTO" ? `<button type="button" data-help-status="EM_ANALISE" class="h-10 px-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-widest">Em análise</button>` : ""}
        ${ticket.status !== "RESOLVIDO" ? `<button type="button" data-help-status="RESOLVIDO" class="h-10 px-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-widest">Resolver</button>` : `<button type="button" data-help-status="ABERTO" class="h-10 px-4 rounded-xl border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest">Reabrir</button>`}
      </div>
    </div>
  `;
  el("helpSaveReply")?.addEventListener("click", () => saveHelpReply(ticket.id));
  box.querySelectorAll("[data-help-status]").forEach((btn) => {
    btn.addEventListener("click", () => changeHelpStatus(ticket.id, btn.getAttribute("data-help-status")));
  });
}

async function loadHelpInbox({ keepSelection = true } = {}) {
  const type = el("helpTypeFilter")?.value || "";
  const status = el("helpStatusFilter")?.value || "";
  const search = el("helpSearchInput")?.value?.trim() || "";
  const list = el("helpTicketsList");
  if (list) list.innerHTML = `<div class="p-8 text-center text-sm text-slate-400 font-semibold">A carregar…</div>`;
  try {
    const data = await fetchHelpTickets({ type, status, search, take: 80 });
    helpTickets = data.items || [];
    updateHelpBadge(data.openCount);
    if (!keepSelection) {
      helpSelectedId = helpTickets[0]?.id || null;
    } else if (!helpSelectedId) {
      helpSelectedId = helpTickets[0]?.id || null;
    }
    renderHelpList();
    if (helpSelectedId) {
      await selectHelpTicket(helpSelectedId, { silentList: true });
    } else {
      renderHelpDetail(null);
    }
  } catch (err) {
    toast(err.message || "Falha ao carregar pedidos de ajuda.", { type: "error" });
    helpTickets = [];
    renderHelpList();
  }
}

async function selectHelpTicket(id, { silentList = false } = {}) {
  helpSelectedId = id;
  if (!silentList) renderHelpList();
  try {
    const ticket = await fetchHelpTicket(id);
    const idx = helpTickets.findIndex((t) => t.id === id);
    if (idx >= 0) helpTickets[idx] = ticket;
    else helpTickets.unshift(ticket);
    renderHelpList();
    renderHelpDetail(ticket);
  } catch (err) {
    toast(err.message || "Falha ao abrir o pedido.", { type: "error" });
  }
}

async function saveHelpReply(id) {
  const adminReply = String(el("helpAdminReply")?.value || "").trim();
  try {
    const ticket = await updateHelpTicket(id, { adminReply });
    const idx = helpTickets.findIndex((t) => t.id === id);
    if (idx >= 0) helpTickets[idx] = ticket;
    renderHelpList();
    renderHelpDetail(ticket);
    toast("Resposta guardada.", { type: "success" });
  } catch (err) {
    toast(err.message || "Falha ao guardar a resposta.", { type: "error" });
  }
}

async function changeHelpStatus(id, status) {
  try {
    const body = { status };
    const reply = String(el("helpAdminReply")?.value || "").trim();
    if (reply) body.adminReply = reply;
    const ticket = await updateHelpTicket(id, body);
    const idx = helpTickets.findIndex((t) => t.id === id);
    if (idx >= 0) helpTickets[idx] = ticket;
    await loadHelpInbox({ keepSelection: true });
    renderHelpDetail(ticket);
    toast(status === "RESOLVIDO" ? "Pedido resolvido." : "Estado actualizado.", { type: "success" });
  } catch (err) {
    toast(err.message || "Falha ao actualizar o estado.", { type: "error" });
  }
}

function wireHelpEvents() {
  el("helpTypeFilter")?.addEventListener("change", () => loadHelpInbox({ keepSelection: false }));
  el("helpStatusFilter")?.addEventListener("change", () => loadHelpInbox({ keepSelection: false }));
  el("helpSearchInput")?.addEventListener("input", () => {
    clearTimeout(helpSearchTimer);
    helpSearchTimer = setTimeout(() => loadHelpInbox({ keepSelection: false }), 250);
  });
}

function applyHelpDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("section");
  const id = params.get("id");
  if (section !== "ajuda") return false;
  helpSelectedId = id || null;
  switchSection("ajuda");
  return true;
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  initMobileMenu();
  wireLogout();
  wireUsersNav();
  wireEvents();
  wirePermissionClicks();
  wirePermissionCollapse();
  wireResetPerms();
  wireLogEvents();
  wireHelpEvents();
  initBackupPanel();
  await loadUsers();
  if (!applyHelpDeepLink()) {
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "backups") switchSection("backups");
    else fetchHelpTickets({ take: 1 }).then((data) => updateHelpBadge(data.openCount)).catch(() => {});
  }
}

init().catch((err) => toast(err.message || "Falha ao carregar. Verifique login/API.", { type: "error" }));
