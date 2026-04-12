import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading, renderLoadingRow, initMobileMenu } from "../../shared/ui.js";
import { formatCurrencyKZ, formatPercent } from "../../shared/format.js";
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

function toIsoDate(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

async function loadClients() {
  const data = await apiRequest("/clients?page=1&pageSize=100&sort=updatedAt_desc");
  return data.items || [];
}

let state = {
  page: 1,
  pageSize: 10,
  total: 0,
  search: "",
  status: "",
  region: "",
  dateFrom: "",
};

function renderStatusPill(status) {
  if (status === "ON_HOLD") {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-orange-50 text-orange-700 border border-orange-100">
      <span class="w-1.5 h-1.5 rounded-full bg-orange-500"></span> ANDAMENTO
    </span>`;
  }
  if (status === "COMPLETED") {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100">
      <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span> CONCLUÍDO
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> ATIVO
  </span>`;
}

function iconFor(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("condom")) return "apartment";
  if (n.includes("industrial")) return "precision_manufacturing";
  if (n.includes("ponte") || n.includes("road")) return "road";
  return "engineering";
}

function renderRow(p) {
  const progress = Math.max(0, Math.min(100, Number(p.physicalProgressPct || 0)));
  const barColor = p.status === "ON_HOLD" ? "bg-orange-500" : (p.status === "COMPLETED" ? "bg-blue-500" : "bg-emerald-500");
  
  return `
    <tr class="hover:bg-slate-50 transition-all duration-200 group border-b border-slate-50 last:border-0">
      <td class="px-8 py-5">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center shadow-lg shadow-black/10 group-hover:scale-105 transition-transform duration-300">
            <span class="material-symbols-outlined text-[#2afc8d]">${iconFor(p.name)}</span>
          </div>
          <div>
            <h4 class="font-bold text-slate-900 text-sm capitalize">${p.name.toLowerCase()}</h4>
            <div class="flex items-center gap-2 mt-0.5">
               <span class="text-[10px] font-black bg-slate-100 text-slate-500 px-1.5 rounded tracking-widest">${p.code}</span>
               <span class="text-[11px] font-medium text-slate-400">${p.region || "-"}</span>
            </div>
          </div>
        </div>
      </td>
      <td class="px-8 py-5">
        <div class="flex flex-col">
          <span class="text-sm font-bold text-slate-700">${p.client?.name || "-"}</span>
          <span class="text-[11px] text-slate-400 font-medium">${p.contact || "Sem contato"}</span>
        </div>
      </td>
      <td class="px-8 py-5 text-right font-bold text-sm text-slate-900">
        ${formatCurrencyKZ(p.budgetTotal || 0)}
      </td>
      <td class="px-8 py-5 min-w-[180px]">
        <div class="flex items-center gap-3">
          <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div class="h-full ${barColor} transition-all duration-1000" style="width: ${progress}%;"></div>
          </div>
          <span class="text-xs font-bold text-slate-700">${formatPercent(progress, { digits: 0 })}</span>
        </div>
      </td>
      <td class="px-8 py-5">${renderStatusPill(p.status)}</td>
      <td class="px-8 py-5 text-right">
        <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button data-view-project="${p.id}" class="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all">
            <span class="material-symbols-outlined text-xl">visibility</span>
          </button>
          <button data-edit-project="${p.id}" class="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all">
            <span class="material-symbols-outlined text-xl">edit</span>
          </button>
          <button data-delete-project="${p.id}" data-name="${escapeHtml(p.name)}" class="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-600 transition-all">
            <span class="material-symbols-outlined text-xl">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `;
}

async function load() {
  const tbody = el("projectsTbody");
  if (!tbody) return;
  tbody.innerHTML = renderLoadingRow(6);

  const qs = new URLSearchParams({
    search: state.search,
    status: state.status,
    region: state.region,
    ...(state.dateFrom ? { dateFrom: new Date(state.dateFrom).toISOString() } : {}),
    page: String(state.page),
    pageSize: String(state.pageSize),
  });

  const data = await apiRequest(`/projects?${qs.toString()}`);
  state.total = data.total || 0;

  if (!data.items?.length) {
    tbody.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="6">Nenhuma obra encontrada.</td></tr>`;
    return;
  }

  // preencher regiões a partir dos itens
  const regions = Array.from(new Set(data.items.map((p) => p.region).filter(Boolean))).sort();
  const sel = el("projectsRegion");
  if (sel && sel.options.length <= 1) {
    const cur = state.region;
    sel.innerHTML = `<option value="">Todas</option>` + regions.map((r) => `<option value="${r}">${r}</option>`).join("");
    sel.value = cur;
  }

  tbody.innerHTML = data.items.map(renderRow).join("");
}

function wireFilters() {
  let t = null;
  el("projectsSearch")?.addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    state.page = 1;
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => load().catch(() => toast("Erro ao carregar Gestão de Obras", { type: "error" })), 250);
  });
  el("projectsStatus")?.addEventListener("change", (e) => {
    state.status = e.target.value;
    state.page = 1;
    load().catch(() => toast("Erro ao carregar Gestão de Obras", { type: "error" }));
  });
  el("projectsRegion")?.addEventListener("change", (e) => {
    state.region = e.target.value;
    state.page = 1;
    load().catch(() => toast("Erro ao carregar Gestão de Obras", { type: "error" }));
  });
  el("projectsDateFrom")?.addEventListener("change", (e) => {
    state.dateFrom = e.target.value.trim();
    state.page = 1;
    load().catch(() => toast("Erro ao carregar Gestão de Obras", { type: "error" }));
  });
}

function wireActions() {
  document.addEventListener("click", (e) => {
    const viewId = e.target?.closest?.("[data-view-project]")?.getAttribute?.("data-view-project");
    if (viewId) {
      window.location.href = `./projectView.html?id=${encodeURIComponent(viewId)}`;
      return;
    }

    const editId = e.target?.closest?.("[data-edit-project]")?.getAttribute?.("data-edit-project");
    if (editId) {
      openEdit(editId);
      return;
    }

    const deleteBtn = e.target?.closest?.("[data-delete-project]");
    if (deleteBtn) {
      const id = deleteBtn.getAttribute("data-delete-project");
      const name = deleteBtn.getAttribute("data-name");
      if (confirm(`Deseja mesmo eliminar permanentemente a obra "${name}"?`)) {
        apiRequest(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" })
          .then(() => {
            toast("Obra eliminada");
            load();
          })
          .catch(() => toast("Erro ao eliminar obra", { type: "error" }));
      }
      return;
    }
  });

  el("addProjectBtn")?.addEventListener("click", () => openCreate());
}

async function openEdit(id) {
  const [data, clients] = await Promise.all([
    apiRequest(`/projects/${encodeURIComponent(id)}`),
    loadClients()
  ]);
  const p = data.project;

  const clientOptions = [
    `<option value="">Sem cliente vinculado</option>`,
    ...clients.map(c => `<option value="${c.id}" ${p.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
  ].join("");

  const statusOptions = [
    { v: "ACTIVE", l: "Ativo" },
    { v: "ON_HOLD", l: "Em andamento" },
    { v: "COMPLETED", l: "Concluído" }
  ].map(s => `<option value="${s.v}" ${p.status === s.v ? 'selected' : ''}>${s.l}</option>`).join("");

  const projectTypesOptions = [
    "MÉDIA TENSÃO",
    "POSTO DE TRANSFORMAÇÃO 160KVA",
    "POSTO DE TRANSFORMAÇÃO 250KVA",
    "BAIXA TENSÃO",
    "ABERTURA E FECHAMENTO DE VALA",
    "RAMAL SUBTERRÂNEO DE MÉDIA TENSÃO",
    "BAIXA TENSÃO E TERRAS",
    "OBRA COMPLEXA"
  ].map(t => `<option value="${t}" ${p.projectType === t ? 'selected' : ''}>${t}</option>`).join("");

  openModal({
    title: `Editar Obra: ${p.code}`,
    primaryLabel: "Salvar Alterações",
    dangerLabel: "Excluir Obra",
    onDanger: async ({ close }) => {
      if (!confirm(`Tem certeza que deseja excluir a obra "${p.name}"? Esta ação não pode ser desfeita.`)) return;
      await apiRequest(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("Obra excluída", { type: "info" });
      close();
      await load();
    },
    contentHtml: `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-2">
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome da obra</label><input id="p_name" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.name)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Tipo de Obra</label><select id="p_type" class="w-full rounded-lg border-slate-300"><option value="">Selecione...</option>${projectTypesOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente</label><select id="p_client" class="w-full rounded-lg border-slate-300">${clientOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Contato</label><input id="p_contact" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.contact)}" /></div>
        
        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Contratos e Referências</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Empreiteiro</label><input id="p_empreiteiro" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.empreiteiro)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Sub-Empreiteiro</label><input id="p_subempreiteiro" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.subempreiteiro)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Director de Obra</label><input id="p_director" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.directorObra)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Referências</label><input id="p_referencia" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.referencia)}" /></div>

        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Localização e Orçamento</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Local da obra / Região</label><input id="p_region" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.region)}" /></div>
        <div class="md:col-span-1"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Morada</label><input id="p_location" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.location)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Orçamento Total (kz)</label><input id="p_total" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="${p.budgetTotal}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Progresso (%)</label><input id="p_prog" type="number" min="0" max="100" class="w-full rounded-lg border-slate-300" value="${p.physicalProgressPct}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Status</label><select id="p_status" class="w-full rounded-lg border-slate-300">${statusOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Fase (Etiqueta)</label><input id="p_phase" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.phaseLabel)}" placeholder="FASE 01 - Nome" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Início</label><input id="p_start" type="date" class="w-full rounded-lg border-slate-300" value="${p.startDate ? p.startDate.split('T')[0] : ''}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Previsão Fim</label><input id="p_due" type="date" class="w-full rounded-lg border-slate-300" value="${p.dueDate ? p.dueDate.split('T')[0] : ''}" /></div>
      </div>
    `,
    onPrimary: async ({ close, panel }) => {
      const v = (id) => panel.querySelector(`#${id}`)?.value?.trim?.();
      const btn = panel.querySelector("[data-primary]");
      try {
        setButtonLoading(btn, true);
        await apiRequest(`/projects/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: {
            name: v("p_name"),
            clientId: v("p_client") || null,
            contact: v("p_contact") || null,
            region: v("p_region") || null,
            location: v("p_location") || null,
            budgetTotal: Number(v("p_total") || 0),
            physicalProgressPct: Number(v("p_prog") || 0),
            status: v("p_status"),
            phaseLabel: v("p_phase") || null,
            startDate: toIsoDate(v("p_start")),
            dueDate: toIsoDate(v("p_due")),
            projectType: v("p_type") || null,
            empreiteiro: v("p_empreiteiro") || null,
            subempreiteiro: v("p_subempreiteiro") || null,
            directorObra: v("p_director") || null,
            referencia: v("p_referencia") || null,
          },
        });
        toast("Obra atualizada com sucesso", { type: "success" });
        close();
        await load();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao atualizar obra", { type: "error" });
      }
    },
  });
}

async function openCreate() {
  const clients = await loadClients();
  const clientOptions = [
    `<option value="">Sem cliente vinculado</option>`,
    ...clients.map(
      (client) =>
        `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)} (${escapeHtml(client.code)})</option>`
    ),
  ].join("");

  const projectTypesOptions = [
    "MÉDIA TENSÃO",
    "POSTO DE TRANSFORMAÇÃO 160KVA",
    "POSTO DE TRANSFORMAÇÃO 250KVA",
    "BAIXA TENSÃO",
    "ABERTURA E FECHAMENTO DE VALA",
    "RAMAL SUBTERRÂNEO DE MÉDIA TENSÃO",
    "BAIXA TENSÃO E TERRAS",
    "OBRA COMPLEXA"
  ].map(t => `<option value="${t}">${t}</option>`).join("");

  openModal({
    title: "Cadastrar nova obra",
    primaryLabel: "Criar",
    contentHtml: `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-2">
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome da obra</label><input id="p_name" class="w-full rounded-lg border-slate-300" placeholder="Condomínio Alpha" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Tipo de Obra</label><select id="p_type" class="w-full rounded-lg border-slate-300"><option value="">Selecione...</option>${projectTypesOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente</label><select id="p_client" class="w-full rounded-lg border-slate-300">${clientOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Contato</label><input id="p_contact" class="w-full rounded-lg border-slate-300" placeholder="Telefone" /></div>
        
        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Contratos e Referências</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Empreiteiro</label><input id="p_empreiteiro" class="w-full rounded-lg border-slate-300" placeholder="Ex: ProRedes Utilities Ltd" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Sub-Empreiteiro</label><input id="p_subempreiteiro" class="w-full rounded-lg border-slate-300" placeholder="Ex: MBT ENERGIA" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Director de Obra</label><input id="p_director" class="w-full rounded-lg border-slate-300" placeholder="Ex: LUCAS ZANGUEU" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Referências</label><input id="p_referencia" class="w-full rounded-lg border-slate-300" placeholder="Ex: NM/ADM/PROREDES/003/2025" /></div>

        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Localização e Orçamento</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Local da obra / Região</label><input id="p_region" class="w-full rounded-lg border-slate-300" placeholder="Ex: Luanda" /></div>
        <div class="md:col-span-1"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Morada</label><input id="p_location" class="w-full rounded-lg border-slate-300" placeholder="Ex: Rua, Bairro" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Orçamento Total</label><input id="p_total" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Progresso inicial (%)</label><input id="p_prog" type="number" min="0" max="100" class="w-full rounded-lg border-slate-300" value="0" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Início</label><input id="p_start" type="date" class="w-full rounded-lg border-slate-300" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Fim</label><input id="p_due" type="date" class="w-full rounded-lg border-slate-300" /></div>
      </div> 
    `,
    onPrimary: async ({ close, panel }) => {
      const v = (id) => panel.querySelector(`#${id}`)?.value?.trim?.();
      const btn = panel.querySelector("[data-primary]");
      try {
        setButtonLoading(btn, true);
        await apiRequest("/projects", {
          method: "POST",
          body: {
            name: v("p_name"),
            clientId: v("p_client") || null,
            contact: v("p_contact") || null,
            region: v("p_region") || null,
            location: v("p_location") || null,
            budgetTotal: Number(v("p_total") || 0),
            physicalProgressPct: Number(v("p_prog") || 0),
            startDate: toIsoDate(v("p_start")),
            dueDate: toIsoDate(v("p_due")),
            projectType: v("p_type") || null,
            empreiteiro: v("p_empreiteiro") || null,
            subempreiteiro: v("p_subempreiteiro") || null,
            directorObra: v("p_director") || null,
            referencia: v("p_referencia") || null,
          },
        });
        toast("Obra criada", { type: "success" });
        close();
        state.page = 1;
        await load();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao criar obra", { type: "error" });
      }
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

init().catch(() => toast("Falha ao carregar Gestão de Obras. Verifique login/API.", { type: "error" }));
