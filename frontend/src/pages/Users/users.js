import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading, renderLoadingRow, initMobileMenu } from "../../shared/ui.js";
import { formatDateBR } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderClientOptions(clients, selectedClientId = "") {
  return [
    `<option value="">Selecione um cliente</option>`,
    ...clients.map(
      (client) =>
        `<option value="${escapeHtml(client.id)}" ${client.id === selectedClientId ? "selected" : ""}>${escapeHtml(
          client.name
        )} (${escapeHtml(client.code)})</option>`
    ),
  ].join("");
}

async function loadClients() {
  const data = await apiRequest("/clients?page=1&pageSize=100&sort=updatedAt_desc");
  return data.items || [];
}

function wireClientSelector(panel, { roleSelectorId, clientWrapId }) {
  const roleSelect = panel.querySelector(`#${roleSelectorId}`);
  const clientWrap = panel.querySelector(`#${clientWrapId}`);

  function syncVisibility() {
    const shouldShow = roleSelect?.value === "cliente";
    if (shouldShow) {
      clientWrap?.classList.remove("hidden");
    } else {
      clientWrap?.classList.add("hidden");
    }
  }

  roleSelect?.addEventListener("change", syncVisibility);
  syncVisibility();
}

function renderRow(u) {
  const roleStyles = {
    admin: "bg-slate-900 text-[#2afc8d] border-slate-800",
    operador: "bg-blue-50 text-blue-700 border-blue-100",
    cliente: "bg-emerald-50 text-emerald-700 border-emerald-100",
    leitura: "bg-slate-50 text-slate-500 border-slate-200"
  };
  const currentRoleStyle = roleStyles[u.role] || roleStyles.leitura;

  return `
    <tr class="hover:bg-slate-50 transition-all duration-200 group border-b border-slate-50 last:border-0">
      <td class="px-8 py-5">
        <div class="flex flex-col">
          <span class="text-sm font-bold text-slate-900">${u.email}</span>
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">ID: ${u.id.slice(0, 8)}</span>
        </div>
      </td>
      <td class="px-8 py-5">
        <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${currentRoleStyle}">
          ${u.role}
        </span>
      </td>
      <td class="px-8 py-5">
        <div class="flex flex-col">
          <span class="text-sm font-medium text-slate-600">${u.client ? u.client.name : "—"}</span>
          ${u.client ? `<span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Código: ${u.client.code}</span>` : ""}
        </div>
      </td>
      <td class="px-8 py-5 text-sm font-medium text-slate-500">${formatDateBR(u.createdAt)}</td>
      <td class="px-8 py-5 text-right">
        <div class="flex items-center justify-end gap-1 transition-opacity duration-200">
          <button data-edit-user="${u.id}" class="h-9 px-4 rounded-xl border border-slate-200 bg-white text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-900 hover:text-[#2afc8d] hover:border-slate-900 transition-all">
            GERENCIAR
          </button>
        </div>
      </td>
    </tr>
  `;
}

async function load() {
  const tbody = el("usersTbody");
  tbody.innerHTML = renderLoadingRow(5);
  const data = await apiRequest("/users");
  tbody.innerHTML = (data.items || []).map(renderRow).join("") || `<tr><td class="px-6 py-6 text-slate-500" colspan="5">Sem utilizadores.</td></tr>`;
}

async function openCreate() {
  const clients = await loadClients();
  const modal = openModal({
    title: "Novo utilizador",
    primaryLabel: "Criar",
    contentHtml: `
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="md:col-span-2">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email</label>
          <input id="u_email" type="email" class="w-full rounded-lg border-slate-300" placeholder="user@empresa.com" />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Senha</label>
          <input id="u_password" type="password" class="w-full rounded-lg border-slate-300" placeholder="mínimo 6 caracteres" />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Role</label>
          <select id="u_role" class="w-full rounded-lg border-slate-300">
            <option value="leitura">leitura</option>
            <option value="operador">operador</option>
            <option value="admin">admin</option>
            <option value="cliente">cliente</option>
          </select>
        </div>
        <div id="u_client_wrap" class="md:col-span-2 hidden">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente vinculado</label>
          <select id="u_client" class="w-full rounded-lg border-slate-300">
            ${renderClientOptions(clients)}
          </select>
        </div>
      </div>
    `,
    onPrimary: async ({ close, panel }) => {
      const v = (id) => panel.querySelector(`#${id}`)?.value?.trim?.();
      const btn = panel.querySelector("[data-primary]");
      const role = v("u_role");
      const clientId = v("u_client") || null;
      if (role === "cliente" && !clientId) {
        toast("Selecione o cliente vinculado para este acesso.", { type: "error" });
        return;
      }
      try {
        setButtonLoading(btn, true);
        await apiRequest("/users", {
          method: "POST",
          body: { email: v("u_email"), password: v("u_password"), role, clientId },
        });
        toast("Utilizador criado", { type: "success" });
        close();
        await load();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao criar utilizador", { type: "error" });
      }
    },
  });
  wireClientSelector(modal.panel, { roleSelectorId: "u_role", clientWrapId: "u_client_wrap" });
}

async function openEdit(id) {
  const [data, clients] = await Promise.all([apiRequest("/users"), loadClients()]);
  const u = (data.items || []).find((x) => x.id === id);
  if (!u) return;

  const modal = openModal({
    title: "Editar utilizador",
    primaryLabel: "Salvar",
    secondaryLabel: "Excluir",
    contentHtml: `
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="md:col-span-2">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email</label>
          <input id="e_email" type="email" class="w-full rounded-lg border-slate-300" value="${escapeHtml(u.email)}" />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Role</label>
          <select id="e_role" class="w-full rounded-lg border-slate-300">
            <option value="leitura" ${u.role === "leitura" ? "selected" : ""}>leitura</option>
            <option value="operador" ${u.role === "operador" ? "selected" : ""}>operador</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
            <option value="cliente" ${u.role === "cliente" ? "selected" : ""}>cliente</option>
          </select>
        </div>
        <div id="e_client_wrap" class="${u.role === "cliente" ? "" : "hidden"}">
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente vinculado</label>
          <select id="e_client" class="w-full rounded-lg border-slate-300">
            ${renderClientOptions(clients, u.clientId || "")}
          </select>
        </div>
        <div class="md:col-span-2 border-t pt-4">
          <div class="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Reset senha</div>
          <div class="flex flex-col gap-3 sm:flex-row">
            <input id="e_password" type="password" class="min-w-0 flex-1 rounded-lg border-slate-300" placeholder="nova senha (min 6)" />
            <button id="resetBtn" class="px-4 py-2 rounded-lg bg-slate-900 text-white font-bold hover:bg-slate-800 transition-colors sm:w-auto">Reset</button>
          </div>
        </div>
      </div>
    `,
    onPrimary: async ({ close, panel }) => {
      const v = (id2) => panel.querySelector(`#${id2}`)?.value?.trim?.();
      const btn = panel.querySelector("[data-primary]");
      const role = v("e_role");
      const clientId = v("e_client") || null;
      if (role === "cliente" && !clientId) {
        toast("Selecione o cliente vinculado para este acesso.", { type: "error" });
        return;
      }
      try {
        setButtonLoading(btn, true);
        await apiRequest(`/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { email: v("e_email"), role, clientId },
        });
        toast("Utilizador atualizado", { type: "success" });
        close();
        await load();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao atualizar utilizador", { type: "error" });
      }
    },
    onSecondary: async ({ close, panel }) => {
      if (!window.confirm("Excluir este utilizador?")) return;
      const btn = panel.querySelector("[data-secondary]");
      try {
        setButtonLoading(btn, true);
        await apiRequest(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Utilizador excluído", { type: "success" });
        close();
        await load();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao excluir utilizador", { type: "error" });
      }
    },
  });
  wireClientSelector(modal.panel, { roleSelectorId: "e_role", clientWrapId: "e_client_wrap" });

  // bind reset password (modal already in DOM)
  window.setTimeout(() => {
    const resetBtn = document.getElementById("resetBtn");
    resetBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      const pass = document.getElementById("e_password")?.value?.trim?.();
      if (!pass || pass.length < 6) {
        toast("Senha inválida (mín. 6).", { type: "error" });
        return;
      }
      try {
        setButtonLoading(resetBtn, true);
        await apiRequest(`/users/${encodeURIComponent(id)}/reset-password`, {
          method: "POST",
          body: { password: pass },
        });
        setButtonLoading(resetBtn, false);
        toast("Senha atualizada", { type: "success" });
      } catch (err) {
        setButtonLoading(resetBtn, false);
        toast(err.message || "Erro ao resetar senha", { type: "error" });
      }
    });
  }, 0);
}

function wireActions() {
  el("addUserBtn")?.addEventListener("click", openCreate);
  document.addEventListener("click", (e) => {
    const id = e.target?.closest?.("[data-edit-user]")?.getAttribute?.("data-edit-user");
    if (id) openEdit(id);
  });
}

async function init() {
  initMobileMenu();
  wireLogout();
  wireUsersNav();
  wireActions();
  await load();
}

init().catch(() => toast("Falha ao carregar utilizadores (apenas admin).", { type: "error" }));
