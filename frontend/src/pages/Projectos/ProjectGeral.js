import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading, renderLoadingRow } from "../../shared/ui.js";
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
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter bg-secondary-fixed text-on-secondary-fixed"><span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>andamento</span>`;
  }
  if (status === "COMPLETED") {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter bg-primary-fixed text-on-primary-fixed"><span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span>Completed</span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter bg-tertiary-fixed text-on-tertiary-fixed"><span class="w-1.5 h-1.5 rounded-full bg-[#2afc8d] shadow-[0_0_8px_#2afc8d]"></span>Active</span>`;
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
  return `
    <tr class="hover:bg-surface-container-low/50 transition-all group">
      <td class="px-6 py-6">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-lg bg-surface-container-high flex items-center justify-center">
            <span class="material-symbols-outlined text-primary-container">${iconFor(p.name)}</span>
          </div>
          <div>
            <h4 class="font-bold text-on-surface">${p.name}</h4>
            <p class="text-xs text-on-surface-variant">ID: ${p.code} • ${p.location || p.region || "-"}</p>
          </div>
        </div>
      </td>
      <td class="px-6 py-6">
        <div>
          <span class="block text-sm font-semibold text-on-surface">${p.client?.name || "-"}</span>
          <span class="text-xs text-on-surface-variant">${p.contact || (p.client ? "Cliente vinculado" : "Sem cliente")}</span>
        </div>
      </td>
      <td class="px-6 py-6">
        <div class="flex flex-col gap-1">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-on-surface-variant">Orçamento:</span>
            <span class="font-bold">${formatCurrencyKZ(p.budgetTotal || 0)}</span>
          </div>
          <div class="flex justify-between text-xs">
            <span class="text-on-surface-variant">Morada:</span>
            <span class="font-medium text-on-surface">${p.location || p.region || "-"}</span>
          </div>
        </div>
      </td>
      <td class="px-6 py-6 min-w-[200px]">
        <div class="flex items-center gap-3">
          <div class="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
            <div class="h-full ${p.status === "ON_HOLD" ? "bg-secondary" : "bg-[#2afc8d]"} rounded-full" style="width: ${progress}%;"></div>
          </div>
          <span class="text-xs font-bold text-on-surface">${formatPercent(progress, { digits: 0 })}</span>
        </div>
      </td>
      <td class="px-6 py-6">${renderStatusPill(p.status)}</td>
      <td class="px-6 py-6 text-right">
        <div class="flex items-center justify-end gap-2">
          <button data-view-project="${p.id}" title="Visualizar Detalhes" class="material-symbols-outlined text-slate-400 hover:text-primary p-2 rounded-md hover:bg-primary/5 transition-all">visibility</button>
          <button data-edit-project="${p.id}" title="Editar Obra" class="material-symbols-outlined text-slate-400 hover:text-primary-container p-2 rounded-md hover:bg-primary-container/10 transition-all">edit</button>
          <button data-delete-project="${p.id}" data-name="${escapeHtml(p.name)}" title="Excluir Obra" class="material-symbols-outlined text-slate-400 hover:text-error p-2 rounded-md hover:bg-error/10 transition-all">delete</button>
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
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome da obra</label><input id="p_name" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.name)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente</label><select id="p_client" class="w-full rounded-lg border-slate-300">${clientOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Contato</label><input id="p_contact" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.contact)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Local da obra</label><input id="p_region" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.region)}" /></div>
        <div class="md:col-span-2"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Morada</label><input id="p_location" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.location)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Orçamento Total (kz)</label><input id="p_total" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="${p.budgetTotal}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Progresso Físico (%)</label><input id="p_prog" type="number" min="0" max="100" class="w-full rounded-lg border-slate-300" value="${p.physicalProgressPct}" /></div>
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

  openModal({
    title: "Cadastrar nova obra",
    primaryLabel: "Criar",
    contentHtml: `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome da obra</label><input id="p_name" class="w-full rounded-lg border-slate-300" placeholder="Condomínio Alpha" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente</label><select id="p_client" class="w-full rounded-lg border-slate-300">${clientOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Contato</label><input id="p_contact" class="w-full rounded-lg border-slate-300" placeholder="Telefone" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Local da obra</label><input id="p_region" class="w-full rounded-lg border-slate-300" placeholder="Luanda" /></div>
        <div class="md:col-span-2"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Morada</label><input id="p_location" class="w-full rounded-lg border-slate-300" placeholder="Rua, bairro, município" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Orçamento</label><input id="p_total" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" /></div>
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
  wireLogout();
  wireUsersNav();
  wireFilters();
  wireActions();
  await load();
}

init().catch(() => toast("Falha ao carregar Gestão de Obras. Verifique login/API.", { type: "error" }));
