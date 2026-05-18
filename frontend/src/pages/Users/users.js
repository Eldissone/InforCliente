import { apiRequest, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
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
  
  // Usar aspas simples no HTML do fallback para não quebrar o atributo onerror
  const fallback = `<div style='width:2.25rem;height:2.25rem;border-radius:.75rem;background:${bg};display:flex;align-items:center;justify-content:center;color:#fff;font-size:.75rem;font-weight:900;flex-shrink:0'>${initials}</div>`;

  if (profilePic) {
    const picUrl = getAssetUrl(profilePic);
    return `<img src="${esc(picUrl)}" alt="${initials}" style="width:2.25rem;height:2.25rem;border-radius:.75rem;object-fit:cover;flex-shrink:0" 
              onerror="this.outerHTML='${fallback.replace(/'/g, "\\'")}'"/>`;
  }
  return fallback;
}

// ─── Section switching ─────────────────────────────────────────
const SECTION_LABELS = { overview: "Visão Geral", users: "Utilizadores", permissions: "Permissões" };

function switchSection(name) {
  activeSection = name;
  ["overview", "users", "permissions"].forEach(s => {
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
  host.innerHTML = recent.map(u => `
    <div class="flex items-center gap-4 px-7 py-4 hover:bg-slate-50 transition-colors">
      ${avatarEl(u.email, u.profilePic || u.client?.profilePic)}
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
  `).join("");
}

// ─── Users table ──────────────────────────────────────────────
function filterUsers() {
  const q = (el("searchInput")?.value || "").toLowerCase();
  const r = el("roleFilter")?.value || "";
  return allUsers.filter(u =>
    (!q || u.email.toLowerCase().includes(q)) &&
    (!r || u.role === r)
  );
}

function renderRow(u) {
  return `
    <tr class="hover:bg-slate-50 transition-colors group border-b border-slate-50 last:border-0">
      <td class="px-7 py-4">
        <div class="flex items-center gap-3">
          ${avatarEl(u.email, u.profilePic || u.client?.profilePic)}
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
          <button data-edit-user="${u.id}" class="h-8 px-3 rounded-lg border border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-900 hover:text-[#2afc8d] hover:border-slate-900 transition-all">
            Editar
          </button>
          <button data-delete-user="${u.id}" class="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all">
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
    ? users.map(renderRow).join("")
    : `<tr><td colspan="5" class="px-7 py-10 text-sm text-slate-400 text-center">Nenhum utilizador encontrado.</td></tr>`;
}

// ─── Permissions — dynamic from API ───────────────────────────

// How the DB rows map to display groups/rows
const PERM_DISPLAY_MAP = [
  {
    group: "Dashboard & Analytics",
    rows: [
      { label: "Dashboard Global",   module: "dashboard",  action: "view"      },
      { label: "Métricas e KPIs",    module: "analytics",  action: "view"      },
    ],
  },
  {
    group: "Gestão de Clientes",
    rows: [
      { label: "Ver clientes",        module: "clientes",   action: "view"      },
      { label: "Criar cliente",        module: "clientes",   action: "create"    },
      { label: "Editar cliente",       module: "clientes",   action: "edit"      },
      { label: "Excluir cliente",      module: "clientes",   action: "delete"    },
    ],
  },
  {
    group: "Gestão de Obras",
    rows: [
      { label: "Ver obras",            module: "obras",      action: "view"      },
      { label: "Criar obra",           module: "obras",      action: "create"    },
      { label: "Editar obra",          module: "obras",      action: "edit"      },
      { label: "Financeiro da obra",   module: "obras",      action: "financeiro" },
      { label: "Excluir obra",         module: "obras",      action: "delete"    },
    ],
  },
  {
    group: "Interações",
    rows: [
      { label: "Ver interações",        module: "interacoes", action: "view"      },
      { label: "Adicionar interação",   module: "interacoes", action: "create"    },
    ],
  },
  {
    group: "Administração do Sistema",
    rows: [
      { label: "Ver utilizadores",      module: "sistema",    action: "view"      },
      { label: "Criar utilizador",      module: "sistema",    action: "create"    },
      { label: "Editar utilizador",     module: "sistema",    action: "edit"      },
      { label: "Excluir utilizador",    module: "sistema",    action: "delete"    },
    ],
  },
  {
    group: "Portal do Cliente",
    rows: [
      { label: "Acesso ao portal",      module: "portal",     action: "view"      },
    ],
  },
];

// Cycle order for clicking: true → own → view → false → true
const ALLOWED_CYCLE = ["true", "own", "view", "false"];

// Build lookup key
function permKey(role, module, action) { return `${role}|${module}|${action}`; }

// In-memory map populated from API: key → allowed string
let permMap = {};
// Track which cells are currently saving
const savingCells = new Set();

function permIcon(allowed, { role, module: mod, action, clickable } = {}) {
  const val = allowed;
  let icon, cls, title;
  if (val === "true")  { icon = "check_circle"; cls = "perm-yes";  title = "Acesso total"; }
  else if (val === "own")  { icon = "check_circle"; cls = "perm-part"; title = "Apenas próprios"; }
  else if (val === "view") { icon = "check_circle"; cls = "perm-part"; title = "Apenas leitura"; }
  else                     { icon = "cancel";       cls = "perm-no";  title = "Sem acesso"; }

  const key = permKey(role, mod, action);
  const isSaving = savingCells.has(key);

  if (clickable) {
    const cursor = isSaving ? "cursor-wait" : "cursor-pointer";
    const pulse  = isSaving ? "animate-pulse" : "";
    return `<button
      class="perm-cell ${cursor} ${pulse} w-9 h-9 rounded-xl flex items-center justify-center mx-auto transition-all hover:scale-110 hover:shadow-md"
      data-role="${esc(role)}" data-module="${esc(mod)}" data-action="${esc(action)}"
      title="${title} — clique para alterar"
      ${isSaving ? "disabled" : ""}>
      <span class="material-symbols-outlined ${cls}">${icon}</span>
    </button>`;
  }
  return `<span class="material-symbols-outlined ${cls}" title="${title}">${icon}</span>`;
}

async function savePermission(role, mod, action, newAllowed) {
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
    `button.perm-cell[data-role="${role}"][data-module="${mod}"][data-action="${action}"]`
  );
  if (!cell) return;
  const key = permKey(role, mod, action);
  const allowed = permMap[key] || "false";
  cell.outerHTML = permIcon(allowed, { role, module: mod, action, clickable: true });
}

async function loadPermissions() {
  const tbody = el("permTableBody");
  if (!tbody) return;
  // Loading state
  tbody.innerHTML = `<tr><td colspan="7" class="px-7 py-10 text-center">
    <div class="inline-flex items-center gap-3 text-sm text-slate-400 font-medium">
      <span class="material-symbols-outlined animate-spin text-lg">progress_activity</span>A carregar permissões…
    </div></td></tr>`;
  try {
    const data = await apiRequest("/permissions");
    // Build lookup map
    permMap = {};
    (data.items || []).forEach(r => { permMap[permKey(r.role, r.module, r.action)] = r.allowed; });
  } catch {
    tbody.innerHTML = `<tr><td colspan="7" class="px-7 py-8 text-center text-sm text-red-400">Erro ao carregar permissões.</td></tr>`;
    return;
  }
  renderPermissionsTable();
}

function renderPermissionsTable() {
  const tbody = el("permTableBody");
  if (!tbody) return;
  const ROLES = ["admin", "operador", "tecnico", "supervisor", "leitura", "cliente"];
  let html = "";
  PERM_DISPLAY_MAP.forEach(group => {
    html += `<tr class="bg-slate-50/40 border-b border-slate-100">
      <td colspan="7" class="px-7 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-400">${group.group}</td>
    </tr>`;
    group.rows.forEach(({ label, module: mod, action }) => {
      html += `<tr class="hover:bg-slate-50/50 transition-colors border-b border-slate-50 last:border-0">
        <td class="px-7 py-3.5 text-sm font-medium text-slate-700">${label}</td>`;
      ROLES.forEach(role => {
        const key = permKey(role, mod, action);
        const val = permMap[key] ?? "false";
        // admin system cells are locked
        const locked = role === "admin" && mod === "sistema";
        html += `<td class="px-4 py-3.5 text-center">${permIcon(val, { role, module: mod, action, clickable: !locked })}</td>`;
      });
      html += "</tr>";
    });
  });
  tbody.innerHTML = html;
}

// Expose so switchSection can call it
function renderPermissions() { loadPermissions(); }

// Wire click delegation for permission cells
function wirePermissionClicks() {
  document.addEventListener("click", async e => {
    const btn = e.target?.closest?.("button.perm-cell");
    if (!btn) return;
    const { role, module: mod, action } = btn.dataset;
    const key = permKey(role, mod, action);
    if (savingCells.has(key)) return; // ignore while saving
    const current = permMap[key] ?? "false";
    const nextIdx = (ALLOWED_CYCLE.indexOf(current) + 1) % ALLOWED_CYCLE.length;
    await savePermission(role, mod, action, ALLOWED_CYCLE[nextIdx]);
  });
}

// ─── Load data ────────────────────────────────────────────────
async function loadUsers() {
  const tbody = el("usersTbody");
  if (tbody) tbody.innerHTML = renderLoadingRow(5);
  const data = await apiRequest("/users");
  allUsers = data.items || [];
  console.log("Users data loaded:", allUsers);
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
            assignedProjectIds: ["operador", "leitura", "cliente", "tecnico", "supervisor"].includes(role) ? assignedProjectIds : []
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

// ─── Reset permissions button ──────────────────────────────────
function wireResetPerms() {
  el("resetPermsBtn")?.addEventListener("click", async () => {
    if (!window.confirm("Repor todas as permissões para os valores por defeito? Esta acção é irreversível.")) return;
    try {
      await apiRequest("/permissions/reset", { method: "POST" });
      toast("Permissões repostas com sucesso.", { type: "success" });
      await loadPermissions();
    } catch (err) {
      toast(err.message || "Erro ao repor permissões.", { type: "error" });
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  initMobileMenu();
  wireLogout();
  wireUsersNav();
  wireEvents();
  wirePermissionClicks();
  wireResetPerms();
  await loadUsers();
}

init().catch((err) => toast(err.message || "Falha ao carregar. Verifique login/API.", { type: "error" }));
