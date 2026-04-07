import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../../shared/ui.js";
import { formatCurrencyBRL } from "../../shared/format.js";

function el(id) {
  return document.getElementById(id);
}

function statusBadge(status) {
  if (status === "AT_RISK") return { label: "Em Risco", cls: "border-error/30 bg-error/10 text-error" };
  if (status === "INACTIVE")
    return { label: "Inativo", cls: "border-outline/30 bg-surface-container-high text-on-surface-variant" };
  return { label: "Ativo", cls: "border-tertiary/30 bg-tertiary/10 text-tertiary" };
}

function renderRow(c) {
  const badge = statusBadge(c.status);
  return `
    <tr class="hover:bg-surface-container-low transition-colors group">
      <td class="px-6 py-5">
        <div class="flex items-center gap-4">
          <div class="size-10 flex-shrink-0 rounded border border-outline-variant bg-white p-1 flex items-center justify-center font-black text-primary">
            ${String(c.code || "ID").slice(0, 2)}
          </div>
          <div>
            <p class="text-sm font-bold leading-tight text-secondary">${c.name}</p>
            <p class="text-[10px] font-bold text-outline uppercase tracking-tighter">ID: ${c.code}</p>
          </div>
        </div>
      </td>
      <td class="px-6 py-5">
        <span class="rounded bg-surface-container-high px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-secondary">
          ${c.industry || "-"}
        </span>
      </td>
      <td class="px-6 py-5 text-sm font-semibold text-secondary">${c.region || "-"}</td>
      <td class="px-6 py-5 text-right text-sm font-black text-secondary">${formatCurrencyBRL(c.ltvTotal)}</td>
      <td class="px-6 py-5">
        <div class="flex items-center gap-3">
          <div class="h-1.5 w-24 overflow-hidden rounded-full bg-surface-container-high">
            <div class="h-full ${c.status === "AT_RISK" ? "bg-primary" : "bg-tertiary"}" style="width: ${Math.max(
              0,
              Math.min(100, Number(c.healthScore || 0))
            )}%;"></div>
          </div>
          <span class="text-xs font-bold ${c.status === "AT_RISK" ? "text-primary" : "text-tertiary"}">${
            c.healthScore ?? "-"
          }</span>
        </div>
      </td>
      <td class="px-6 py-5">
        <div class="flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase w-fit ${badge.cls}">
          <span class="size-1.5 rounded-full ${c.status === "AT_RISK" ? "bg-error" : c.status === "INACTIVE" ? "bg-outline" : "bg-tertiary"}"></span>
          ${badge.label}
        </div>
      </td>
      <td class="px-6 py-5">
        <div class="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button data-view="${c.id}" class="flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-[10px] font-bold uppercase text-white hover:opacity-90">Visualizar 360</button>
          <button data-edit="${c.id}" class="flex h-8 w-8 items-center justify-center rounded border border-outline-variant hover:bg-surface-container-high text-secondary">
            <span class="material-symbols-outlined text-[18px]">edit</span>
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
  sort: "ltv_desc",
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
        ? "flex h-8 w-8 items-center justify-center rounded bg-primary text-[11px] font-black uppercase text-white"
        : "flex h-8 w-8 items-center justify-center rounded border border-outline-variant text-[11px] font-black uppercase text-secondary hover:bg-surface-container-high";
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

  const addBtn = Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.toLowerCase?.().includes("adicionar novo cliente")
  );
  addBtn?.addEventListener("click", () => openCreate());
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
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">LTV Total (R$)</label><input id="f_ltv" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Health (0-100)</label><input id="f_health" type="number" min="0" max="100" class="w-full rounded-lg border-slate-300" value="50" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Risco churn (%)</label><input id="f_churn" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Potencial 24m (R$)</label><input id="f_potential" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" /></div>
      </div>
    `,
    onPrimary: async ({ close, panel }) => {
      const v = (id) => panel.querySelector(`#${id}`)?.value?.trim?.();
      await apiRequest("/clients", {
        method: "POST",
        body: {
          code: v("f_code"),
          name: v("f_name"),
          industry: v("f_industry") || null,
          region: v("f_region") || null,
          ltvTotal: Number(v("f_ltv") || 0),
          healthScore: Number(v("f_health") || 50),
          churnRisk: Number(v("f_churn") || 0),
          ltvPotential: Number(v("f_potential") || 0),
        },
      });
      toast("Cliente criado", { type: "success" });
      close();
      state.page = 1;
      await load();
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
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">LTV Total (R$)</label><input id="e_ltv" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="${Number(
          c.ltvTotal || 0
        )}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Health (0-100)</label><input id="e_health" type="number" min="0" max="100" class="w-full rounded-lg border-slate-300" value="${Number(
          c.healthScore || 50
        )}" /></div>
      </div>
    `,
    onPrimary: async ({ close, panel }) => {
      const v = (id2) => panel.querySelector(`#${id2}`)?.value?.trim?.();
      await apiRequest(`/clients/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: {
          name: v("e_name"),
          status: v("e_status"),
          industry: v("e_industry") || null,
          region: v("e_region") || null,
          ltvTotal: Number(v("e_ltv") || 0),
          healthScore: Number(v("e_health") || 50),
        },
      });
      toast("Cliente atualizado", { type: "success" });
      close();
      await load();
    },
  });
}

async function init() {
  wireFilters();
  wireActions();
  await load();
}

init().catch(() => toast("Falha ao carregar clientes. Verifique login/API.", { type: "error" }));

