import { apiRequest, apiUpload, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, toast, initMobileMenu, setButtonLoading } from "../../shared/ui.js";

checkAuth({ allowedRoles: ["admin", "operador"] });
import { formatCurrencyKZ } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

function el(id) {
  return document.getElementById(id);
}

function renderStatusPill(status) {
  if (status === "AT_RISK") {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-700 text-[10px] font-bold border border-red-100">
      <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span> EM RISCO
    </span>`;
  }
  if (status === "INACTIVE") {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-50 text-slate-600 text-[10px] font-bold border border-slate-100">
      <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> INATIVO
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">
    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> ATIVO
  </span>`;
}

function renderRow(c) {
  return `
    <tr class="hover:bg-slate-50 transition-all duration-200 group border-b border-slate-50 last:border-0">
      <td class="px-8 py-5">
        <div class="flex items-center gap-4">
          ${c.profilePic 
            ? `<div class="h-11 w-11 rounded-2xl overflow-hidden border border-slate-100 shadow-sm group-hover:scale-105 transition-transform duration-300">
                 <img src="${getAssetUrl(c.profilePic)}" alt="Perfil" class="w-full h-full object-cover" />
               </div>`
            : `<div class="h-11 w-11 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center font-bold text-[#2afc8d] shadow-lg shadow-black/10 group-hover:scale-105 transition-transform duration-300">
                 ${String(c.code || "ID").slice(0, 2)}
               </div>`
          }
          <div>
            <p class="text-sm font-bold text-slate-900 group-hover:text-slate-700 transition-colors">${c.name}</p>
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">ID: ${c.code}</p>
          </div>
        </div>
      </td>
      <td class="px-8 py-5 text-center">
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest">
          ${c.industry || "-"}
        </span>
      </td>
      <td class="px-8 py-5 text-sm font-semibold text-slate-600">${c.region || "-"}</td>
      <td class="px-8 py-5">${renderStatusPill(c.status)}</td>
      <td class="px-8 py-5 text-right">
        <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button data-view="${c.id}" class="h-9 px-4 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-900 hover:text-[#2afc8d] transition-all">ABRIR</button>
          <button data-edit="${c.id}" class="h-9 w-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-slate-900 hover:border-slate-400 transition-all">
            <span class="material-symbols-outlined text-xl">edit</span>
          </button>
        </div>
      </td>
    </tr>
  `;
}

let state = {
  page: 1,
  pageSize: 10,
  total: 0,
  search: "",
  status: "",
  industry: "",
  sort: "updatedAt_desc",
};

function setPagingText() {
  const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const end = Math.min(state.total, state.page * state.pageSize);
  el("clientsPagingText").textContent = `Mostrando ${start}-${end} de ${state.total} clientes`;
}

function renderPages() {
  const host = el("clientsPages");
  const prev = el("clientsPrev");
  const next = el("clientsNext");
  if (!host || !prev || !next) return;

  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  prev.disabled = state.page <= 1;
  next.disabled = state.page >= totalPages;

  const windowSize = 5;
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, state.page - half);
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  host.innerHTML = "";
  for (let p = start; p <= end; p++) {
    const btn = document.createElement("button");
    btn.className =
      p === state.page
        ? "flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-[11px] font-black uppercase text-[#2afc8d] shadow-lg"
        : "flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase text-slate-400 hover:text-slate-900 hover:border-slate-300 transition-all";
    btn.textContent = String(p);
    btn.addEventListener("click", () => {
      state.page = p;
      load();
    });
    host.appendChild(btn);
  }

  prev.onclick = () => {
    if (state.page > 1) {
      state.page -= 1;
      load();
    }
  };
  next.onclick = () => {
    if (state.page < totalPages) {
      state.page += 1;
      load();
    }
  };
}

async function loadIndustries(items) {
  const sel = el("clientsIndustry");
  if (!sel) return;
  const industries = Array.from(new Set(items.map((c) => c.industry).filter(Boolean))).sort();
  const current = state.industry;
  sel.innerHTML = `<option value="">Todas</option>` + industries.map((i) => `<option value="${i}">${i}</option>`).join("");
  sel.value = current;
}

async function load() {
  const tbody = el("clientsTbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="7">Carregando...</td></tr>`;

  const qs = new URLSearchParams({
    search: state.search,
    status: state.status,
    industry: state.industry,
    sort: state.sort,
    page: String(state.page),
    pageSize: String(state.pageSize),
  });

  const data = await apiRequest(`/clients?${qs.toString()}`);
  state.total = data.total || 0;

  if (!data.items?.length) {
    tbody.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="7">Nenhum cliente encontrado.</td></tr>`;
    el("clientsPagingText").textContent = "Mostrando 0-0 de 0 clientes";
    renderPages();
    return;
  }

  tbody.innerHTML = data.items.map(renderRow).join("");
  setPagingText();
  renderPages();
  await loadIndustries(data.items);
}

function wireFilters() {
  const search = el("clientsSearch");
  const status = el("clientsStatus");
  const industry = el("clientsIndustry");
  const sort = el("clientsSort");

  let t = null;
  search?.addEventListener("input", () => {
    state.search = search.value.trim();
    state.page = 1;
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => load().catch(() => toast("Erro ao carregar clientes", { type: "error" })), 250);
  });
  status?.addEventListener("change", () => {
    state.status = status.value;
    state.page = 1;
    load().catch(() => toast("Erro ao carregar clientes", { type: "error" }));
  });
  industry?.addEventListener("change", () => {
    state.industry = industry.value;
    state.page = 1;
    load().catch(() => toast("Erro ao carregar clientes", { type: "error" }));
  });
  sort?.addEventListener("change", () => {
    state.sort = sort.value;
    state.page = 1;
    load().catch(() => toast("Erro ao carregar clientes", { type: "error" }));
  });
}

function wireActions() {
  document.addEventListener("click", (e) => {
    const view = e.target?.closest?.("[data-view]")?.getAttribute?.("data-view");
    if (view) {
      window.location.href = `../ClienteDetalhe/client.html?id=${encodeURIComponent(view)}`;
      return;
    }
    const edit = e.target?.closest?.("[data-edit]")?.getAttribute?.("data-edit");
    if (edit) {
      openEdit(edit);
    }
  });

  el("addClientBtn")?.addEventListener("click", () => openCreate());
}

async function openCreate() {
  openModal({
    title: "Adicionar novo cliente",
    primaryLabel: "Criar",
    contentHtml: `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Código</label><input id="f_code" class="w-full rounded-lg border-slate-300" placeholder="NX-90210" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome</label><input id="f_name" class="w-full rounded-lg border-slate-300" placeholder="Empresa X" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Indústria</label><input id="f_industry" class="w-full rounded-lg border-slate-300" placeholder="Tecnologia (SaaS)" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Região</label><input id="f_region" class="w-full rounded-lg border-slate-300" placeholder="Sudeste" /></div>
        <div class="md:col-span-2"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Foto de Perfil</label><input id="f_profilePicFile" type="file" accept="image/*" class="w-full rounded-lg border-slate-300 bg-white" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email de Acesso</label><input id="f_email" type="email" class="w-full rounded-lg border-slate-300" placeholder="gestor@empresa.com" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Senha Inicial</label><input id="f_password" type="password" class="w-full rounded-lg border-slate-300" placeholder="******" /></div>
      </div>
    `,
    onPrimary: async ({ btn, close, panel }) => {
      try {
        setButtonLoading(btn, true);
        const v = (id) => panel.querySelector(`#${id}`)?.value?.trim?.();
        const created = await apiRequest("/clients", {
          method: "POST",
          body: {
            code: v("f_code"),
            name: v("f_name"),
            industry: v("f_industry") || null,
            region: v("f_region") || null,
            email: v("f_email"),
            password: v("f_password"),
          },
        });
        
        const fileInput = panel.querySelector("#f_profilePicFile");
        if (fileInput && fileInput.files.length > 0) {
          await apiUpload(`/clients/${created.id}/avatar`, {
            file: fileInput.files[0]
          });
        }
        
        toast("Cliente criado", { type: "success" });
        close();
        state.page = 1;
        await load();
      } catch (err) {
        toast(err.message, { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

async function openEdit(id) {
  const data = await apiRequest(`/clients/${encodeURIComponent(id)}`);
  const c = data.client;
  openModal({
    title: "Editar cliente",
    primaryLabel: "Salvar",
    contentHtml: `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome</label><input id="e_name" class="w-full rounded-lg border-slate-300" value="${c.name || ""}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Status</label>
          <select id="e_status" class="w-full rounded-lg border-slate-300">
            <option value="ACTIVE" ${c.status === "ACTIVE" ? "selected" : ""}>Ativo</option>
            <option value="AT_RISK" ${c.status === "AT_RISK" ? "selected" : ""}>Em Risco</option>
            <option value="INACTIVE" ${c.status === "INACTIVE" ? "selected" : ""}>Inativo</option>
          </select>
        </div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Indústria</label><input id="e_industry" class="w-full rounded-lg border-slate-300" value="${c.industry || ""}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Região</label><input id="e_region" class="w-full rounded-lg border-slate-300" value="${c.region || ""}" /></div>
        <div class="md:col-span-2"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Atualizar Foto de Perfil</label><input id="e_profilePicFile" type="file" accept="image/*" class="w-full rounded-lg border-slate-300 bg-white" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email de Acesso</label><input id="e_email" type="email" class="w-full rounded-lg border-slate-300" value="${c.accountEmail || ""}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nova Senha (opcional)</label><input id="e_password" type="password" class="w-full rounded-lg border-slate-300" placeholder="Deixe em branco para manter" /></div>
      </div>
    `,
    onPrimary: async ({ btn, close, panel }) => {
      try {
        setButtonLoading(btn, true);
        const v = (id2) => panel.querySelector(`#${id2}`)?.value?.trim?.();
        await apiRequest(`/clients/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: {
            name: v("e_name"),
            status: v("e_status"),
            industry: v("e_industry") || null,
            region: v("e_region") || null,
            email: v("e_email"),
            password: v("e_password") || undefined,
          },
        });

        const fileInput = panel.querySelector("#e_profilePicFile");
        if (fileInput && fileInput.files.length > 0) {
          await apiUpload(`/clients/${id}/avatar`, {
            file: fileInput.files[0]
          });
        }

        toast("Cliente atualizado", { type: "success" });
        close();
        await load();
      } catch (err) {
        toast(err.message, { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
    secondaryLabel: "Excluir",
    onSecondary: async ({ close }) => {
      if (!window.confirm("Excluir este cliente? Essa ação não pode ser desfeita.")) return;
      await apiRequest(`/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("Cliente excluído", { type: "success" });
      close();
      state.page = 1;
      await load();
    },
  });
}

async function init() {
  initMobileMenu();
  wireLogout();
  wireUsersNav();
  wireFilters();
  wireActions();
  await load();
}

init().catch(() => toast("Falha ao carregar clientes. Verifique login/API.", { type: "error" }));