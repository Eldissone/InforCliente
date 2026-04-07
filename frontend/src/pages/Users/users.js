import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../../shared/ui.js";
import { formatDateBR } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

function el(id) {
  return document.getElementById(id);
}

function renderRow(u) {
  return `
    <tr class="hover:bg-slate-50">
      <td class="px-6 py-4 font-bold text-slate-900">${u.email}</td>
      <td class="px-6 py-4">
        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
          u.role === "admin"
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : u.role === "operador"
              ? "bg-blue-50 text-blue-700 border border-blue-200"
              : "bg-slate-100 text-slate-700 border border-slate-200"
        }">${u.role}</span>
      </td>
      <td class="px-6 py-4 text-slate-700">${formatDateBR(u.createdAt)}</td>
      <td class="px-6 py-4 text-right">
        <button data-edit-user="${u.id}" class="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-white">Editar</button>
      </td>
    </tr>
  `;
}

async function load() {
  const tbody = el("usersTbody");
  tbody.innerHTML = `<tr><td class="px-6 py-6 text-slate-500" colspan="4">Carregando...</td></tr>`;
  const data = await apiRequest("/users");
  tbody.innerHTML = (data.items || []).map(renderRow).join("") || `<tr><td class="px-6 py-6 text-slate-500" colspan="4">Sem utilizadores.</td></tr>`;
}

function openCreate() {
  openModal({
    title: "Novo utilizador",
    primaryLabel: "Criar",
    contentHtml: `
      <div class="grid grid-cols-1 gap-4">
        <div>
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
          </select>
        </div>
      </div>
    `,
    onPrimary: async ({ close, panel }) => {
      const v = (id) => panel.querySelector(`#${id}`)?.value?.trim?.();
      await apiRequest("/users", {
        method: "POST",
        body: { email: v("u_email"), password: v("u_password"), role: v("u_role") },
      });
      toast("Utilizador criado", { type: "success" });
      close();
      await load();
    },
  });
}

async function openEdit(id) {
  const data = await apiRequest("/users");
  const u = (data.items || []).find((x) => x.id === id);
  if (!u) return;

  openModal({
    title: "Editar utilizador",
    primaryLabel: "Salvar",
    secondaryLabel: "Excluir",
    contentHtml: `
      <div class="grid grid-cols-1 gap-4">
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email</label>
          <input id="e_email" type="email" class="w-full rounded-lg border-slate-300" value="${u.email}" />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Role</label>
          <select id="e_role" class="w-full rounded-lg border-slate-300">
            <option value="leitura" ${u.role === "leitura" ? "selected" : ""}>leitura</option>
            <option value="operador" ${u.role === "operador" ? "selected" : ""}>operador</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
          </select>
        </div>
        <div class="border-t pt-4">
          <div class="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Reset senha</div>
          <div class="flex gap-3">
            <input id="e_password" type="password" class="flex-1 rounded-lg border-slate-300" placeholder="nova senha (min 6)" />
            <button id="resetBtn" class="px-4 py-2 rounded-lg bg-slate-900 text-white font-bold">Reset</button>
          </div>
        </div>
      </div>
    `,
    onPrimary: async ({ close, panel }) => {
      const v = (id2) => panel.querySelector(`#${id2}`)?.value?.trim?.();
      await apiRequest(`/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { email: v("e_email"), role: v("e_role") },
      });
      toast("Utilizador atualizado", { type: "success" });
      close();
      await load();
    },
    onSecondary: async ({ close }) => {
      if (!window.confirm("Excluir este utilizador?")) return;
      await apiRequest(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("Utilizador excluído", { type: "success" });
      close();
      await load();
    },
  });

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
      await apiRequest(`/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: { password: pass } });
      toast("Senha atualizada", { type: "success" });
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
  wireLogout();
  wireUsersNav();
  wireActions();
  await load();
}

init().catch(() => toast("Falha ao carregar utilizadores (apenas admin).", { type: "error" }));

