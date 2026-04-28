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
  const team = users.filter(u => u.role === "operador" || u.role === "leitura").length;
  const clients = users.filter(u => u.role === "cliente").length;

  el("stat-total")?.textContent !== undefined && (el("stat-total").textContent = total);
  el("stat-admin")?.textContent !== undefined && (el("stat-admin").textContent = admins);
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
            <div class="text-sm font-bold text-slate-900">${esc(u.email)}</div>
            <div class="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">ID: ${u.id.slice(0, 8)}</div>
          </div>
        </div>
      </td>
      <td class="px-7 py-4">${roleBadge(u.role)}</td>
      <td class="px-7 py-4">
        ${u.client
      ? `<div class="flex flex-col"><span class="text-sm font-semibold text-slate-700">${esc(u.client.name)}</span>
             <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">${esc(u.client.code)}</span></div>`
      : `<span class="text-slate-400 text-sm">—</span>`}
      </td>
      <td class="px-7 py-4 text-sm text-slate-500 font-medium whitespace-nowrap">${formatDateBR(u.createdAt)}</td>
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

// ─── Permissions Map ──────────────────────────────────────────
const PERMISSIONS = [
  {
    group: "Dashboard & Analytics", rows: [
      { label: "Dashboard Global", admin: true, op: true, read: true, cli: false },
      { label: "Métricas e KPIs", admin: true, op: true, read: true, cli: false },
    ]
  },
  {
    group: "Gestão de Clientes", rows: [
      { label: "Ver lista de clientes", admin: true, op: true, read: true, cli: "own" },
      { label: "Ver detalhe de cliente", admin: true, op: true, read: true, cli: "own" },
      { label: "Criar cliente", admin: true, op: true, read: false, cli: false },
      { label: "Editar cliente", admin: true, op: true, read: false, cli: false },
      { label: "Excluir cliente", admin: true, op: false, read: false, cli: false },
    ]
  },
  {
    group: "Gestão de Obras", rows: [
      { label: "Ver lista de obras", admin: true, op: true, read: true, cli: "own" },
      { label: "Criar / Editar obra", admin: true, op: true, read: false, cli: false },
      { label: "Progresso físico", admin: true, op: true, read: true, cli: "own" },
      { label: "Financeiro da obra", admin: true, op: true, read: "view", cli: "own" },
      { label: "Ficheiros da obra", admin: true, op: true, read: true, cli: "own" },
      { label: "Excluir obra", admin: true, op: false, read: false, cli: false },
    ]
  },
  {
    group: "Interações", rows: [
      { label: "Ver interações", admin: true, op: true, read: true, cli: "own" },
      { label: "Adicionar interação", admin: true, op: true, read: false, cli: false },
    ]
  },
  {
    group: "Administração do Sistema", rows: [
      { label: "Gerir utilizadores", admin: true, op: false, read: false, cli: false },
      { label: "Criar utilizador", admin: true, op: false, read: false, cli: false },
      { label: "Resetar senha", admin: true, op: false, read: false, cli: false },
      { label: "Excluir utilizador", admin: true, op: false, read: false, cli: false },
    ]
  },
  {
    group: "Portal do Cliente", rows: [
      { label: "Dashboard do cliente", admin: false, op: false, read: false, cli: true },
      { label: "Ver obras vinculadas", admin: false, op: false, read: false, cli: true },
      { label: "Ver interações próprias", admin: false, op: false, read: false, cli: true },
    ]
  },
];

function permIcon(val) {
  if (val === true) return `<span class="material-symbols-outlined perm-yes">check_circle</span>`;
  if (val === false) return `<span class="material-symbols-outlined perm-no">cancel</span>`;
  return `<span class="material-symbols-outlined perm-part" title="${esc(String(val))}">check_circle</span>`;
}

function renderPermissions() {
  const tbody = el("permTableBody");
  if (!tbody) return;
  let html = "";
  PERMISSIONS.forEach(group => {
    html += `<tr class="bg-slate-50/40 border-b border-slate-100">
      <td colspan="5" class="px-7 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-400">${group.group}</td>
    </tr>`;
    group.rows.forEach(row => {
      html += `<tr class="hover:bg-slate-50/50 transition-colors border-b border-slate-50 last:border-0">
        <td class="px-7 py-3.5 text-sm font-medium text-slate-700">${row.label}</td>
        <td class="px-4 py-3.5 text-center">${permIcon(row.admin)}</td>
        <td class="px-4 py-3.5 text-center">${permIcon(row.op)}</td>
        <td class="px-4 py-3.5 text-center">${permIcon(row.read)}</td>
        <td class="px-4 py-3.5 text-center">${permIcon(row.cli)}</td>
      </tr>`;
    });
  });
  tbody.innerHTML = html;
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
  const clients = await loadClients();
  const modal = openModal({
    title: "Novo Utilizador",
    primaryLabel: "Criar Conta",
    contentHtml: `
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            <option value="admin">Administrador</option>
            <option value="cliente">Cliente</option>
          </select>
        </div>
        <div id="u_cli_wrap" class="md:col-span-2 hidden">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente Vinculado</label>
          <select id="u_client" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50">${renderClientOptions(clients)}</select>
        </div>
      </div>`,
    onPrimary: async ({ close, panel }) => {
      const v = id => panel.querySelector(`#${id}`)?.value?.trim?.();
      const btn = panel.querySelector("[data-primary]");
      const role = v("u_role");
      const clientId = v("u_client") || null;
      if (role === "cliente" && !clientId) { toast("Selecione o cliente vinculado.", { type: "error" }); return; }
      try {
        setButtonLoading(btn, true);
        await apiRequest("/users", { method: "POST", body: { email: v("u_email"), password: v("u_pass"), role, clientId } });
        toast("Utilizador criado com sucesso.", { type: "success" });
        close(); await loadUsers();
      } catch (err) { setButtonLoading(btn, false); toast(err.message || "Erro ao criar utilizador.", { type: "error" }); }
    },
  });
  wireClientSelector(modal.panel, "u_role", "u_cli_wrap");
}

// ─── Edit modal ───────────────────────────────────────────────
async function openEdit(id) {
  const [data, clients] = await Promise.all([apiRequest("/users"), loadClients()]);
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
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email</label>
          <input id="e_email" type="email" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50" value="${esc(u.email)}" />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Perfil de Acesso</label>
          <select id="e_role" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 font-semibold">
            <option value="leitura" ${u.role === "leitura" ? "selected" : ""}>Leitura</option>
            <option value="operador" ${u.role === "operador" ? "selected" : ""}>Operador</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrador</option>
            <option value="cliente" ${u.role === "cliente" ? "selected" : ""}>Cliente</option>
          </select>
        </div>
        <div id="e_cli_wrap" class="${u.role === "cliente" ? "" : "hidden"}">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente Vinculado</label>
          <select id="e_client" class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50">${renderClientOptions(clients, u.clientId || "")}</select>
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
      try {
        setButtonLoading(btn, true);
        await apiRequest(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body: { email: v("e_email"), role, clientId } });
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

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  initMobileMenu();
  wireLogout();
  wireUsersNav();
  wireEvents();
  await loadUsers();
  renderPermissions();
}

init().catch(() => toast("Falha ao carregar. Verifique login/API.", { type: "error" }));
