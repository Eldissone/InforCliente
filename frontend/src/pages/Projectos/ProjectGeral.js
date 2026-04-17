import { apiRequest, apiUpload, getApiBaseUrl } from "../../services/api.js";
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
    <tr data-view-project="${p.id}" class="hover:bg-slate-50 transition-all duration-200 group border-b border-slate-50 last:border-0 cursor-pointer">
      <td class="px-8 py-5">
        <div class="flex items-center gap-4">
          <div class="min-w-[40px] h-[40px] rounded-xl bg-slate-900 flex items-center justify-center shadow-lg shadow-black/5 group-hover:bg-[#2afc8d] group-hover:text-slate-900 transition-colors duration-300">
            <span class="material-symbols-outlined text-[#2afc8d] group-hover:text-slate-900 text-lg">${iconFor(p.name)}</span>
          </div>
          <div>
            <h4 class="font-bold text-slate-900 text-xs uppercase tracking-tight">${p.name}</h4>
            <span class="text-[9px] font-black bg-slate-100 text-slate-500 px-1.5 rounded tracking-widest">${p.code}</span>
          </div>
        </div>
      </td>
      <td class="px-8 py-5">
        <span class="text-xs font-bold text-slate-700">${p.client?.name || "-"}</span>
      </td>
      <td class="px-8 py-5">
        <span class="text-[11px] text-slate-400 font-medium">${p.contact || "-"}</span>
      </td>
      <td class="px-8 py-5">
        <div class="max-w-[150px] truncate text-[11px] text-slate-500 font-medium" title="${escapeHtml(p.location)}">${p.location || "-"}</div>
      </td>
      <td class="px-8 py-5 text-right font-black text-xs text-slate-900">
        ${formatCurrencyKZ(p.budgetTotal || 0)}
      </td>
      <td class="px-8 py-5 min-w-[140px]">
        <div class="flex items-center gap-3">
          <div class="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div class="h-full ${barColor} transition-all duration-1000" style="width: ${progress}%;"></div>
          </div>
          <span class="text-[10px] font-black text-slate-900">${progress}%</span>
        </div>
      </td>
      <td class="px-8 py-5 text-center">${renderStatusPill(p.status)}</td>
      <td class="px-8 py-5 text-right">
        <div class="flex items-center justify-end gap-1">
          <button data-view-project="${p.id}" class="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-900 transition-all">
            <span class="material-symbols-outlined text-lg">visibility</span>
          </button>
          <button data-edit-project="${p.id}" class="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-900 transition-all">
            <span class="material-symbols-outlined text-lg">edit</span>
          </button>
          <button data-delete-project="${p.id}" data-name="${escapeHtml(p.name)}" class="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-all">
            <span class="material-symbols-outlined text-lg">delete</span>
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
    // 1. Edit?
    const editId = e.target?.closest?.("[data-edit-project]")?.getAttribute?.("data-edit-project");
    if (editId) {
      openEdit(editId);
      return;
    }

    // 2. Delete?
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

    // 3. View? (Row Click)
    const viewId = e.target?.closest?.("[data-view-project]")?.getAttribute?.("data-view-project");
    if (viewId) {
      window.location.href = `./projectView.html?id=${encodeURIComponent(viewId)}`;
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
  let currentTechnicians = Array.isArray(p.technicians) ? p.technicians : [];

  const clientOptions = [
    `<option value="">Sem cliente vinculado</option>`,
    ...clients.map(c => `<option value="${c.id}" ${p.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
  ].join("");

  const statusOptions = [
    { v: "ACTIVE", l: "Ativo" },
    { v: "ON_HOLD", l: "Suspender" },
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
        
        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Contratos e Direcção</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Empreiteiro</label><input id="p_empreiteiro" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.empreiteiro)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Sub-Empreiteiro</label><input id="p_subempreiteiro" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.subempreiteiro)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Director de Obra</label><input id="p_director" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.directorObra)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Telefone do Dir.</label><input id="p_dir_phone" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.directorPhone)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email do Dir.</label><input id="p_dir_email" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.directorEmail)}" /></div>
        
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Foto do Director</label>
          <div class="flex items-center gap-4 p-3 bg-slate-50 rounded-xl border border-dashed border-slate-300">
             <div class="w-12 h-12 rounded-full overflow-hidden bg-slate-200 border-2 border-white shadow-sm flex-shrink-0">
                <img id="p_dir_photo_preview" src="${p.directorPhoto ? getApiBaseUrl() + '/' + p.directorPhoto : '/assets/images/placeholder-user.png'}" class="w-full h-full object-cover"/>
             </div>
             <div class="flex-1">
                <input type="file" id="p_dir_photo_file" class="hidden" accept="image/*" />
                <button type="button" id="p_dir_photo_btn" class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-colors">${p.directorPhoto ? 'Alterar Foto' : 'Selecionar Foto'}</button>
                <div id="p_dir_photo_status" class="text-[9px] font-bold text-slate-400 mt-1">PNG ou JPG (Max 5MB)</div>
                <input type="hidden" id="p_dir_photo_path" value="${escapeHtml(p.directorPhoto)}" />
             </div>
          </div>
        </div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Referências</label><input id="p_referencia" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.referencia)}" /></div>

        <div class="col-span-1 md:col-span-2 mt-2">
          <div class="flex justify-between items-center border-b border-outline-variant/20 pb-2 mb-2">
            <h3 class="text-xs font-bold text-primary uppercase tracking-widest">Equipa Técnica Adicional</h3>
            <button type="button" id="add_technician_btn" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 transition-colors rounded text-[10px] font-bold text-slate-600">+ Adicionar Técnico</button>
          </div>
          <div id="technicians_list" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
        </div>

        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Localização e Orçamento</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Local da obra / Região</label><input id="p_region" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.region)}" /></div>
        <div class="md:col-span-1"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Morada</label><input id="p_location" class="w-full rounded-lg border-slate-300" value="${escapeHtml(p.location)}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Orçamento Total (kz)</label><input id="p_total" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="${p.budgetTotal}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Progresso (%)</label><input id="p_prog" type="number" min="0" max="100" class="w-full rounded-lg border-slate-300" value="${p.physicalProgressPct}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Status</label><select id="p_status" class="w-full rounded-lg border-slate-300">${statusOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Início</label><input id="p_start" type="date" class="w-full rounded-lg border-slate-300" value="${p.startDate ? p.startDate.split('T')[0] : ''}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Previsão Fim</label><input id="p_due" type="date" class="w-full rounded-lg border-slate-300" value="${p.dueDate ? p.dueDate.split('T')[0] : ''}" /></div>

        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Segurança e Pessoal (HSE)</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nº Funcionários Ativos</label><input id="p_staff" type="number" class="w-full rounded-lg border-slate-300" value="${p.activeStaffCount || 0}" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Último Acidente</label><input id="p_last_accident" type="date" class="w-full rounded-lg border-slate-300" value="${p.lastAccidentDate ? p.lastAccidentDate.split('T')[0] : ''}" /></div>
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
            startDate: toIsoDate(v("p_start")),
            dueDate: toIsoDate(v("p_due")),
            projectType: v("p_type") || null,
            empreiteiro: v("p_empreiteiro") || null,
            subempreiteiro: v("p_subempreiteiro") || null,
            directorObra: v("p_director") || null,
            directorPhone: v("p_dir_phone") || null,
            directorEmail: v("p_dir_email") || null,
            directorPhoto: v("p_dir_photo_path") || null,
            referencia: v("p_referencia") || null,
            technicians: currentTechnicians,
            activeStaffCount: Number(v("p_staff") || 0),
            lastAccidentDate: toIsoDate(v("p_last_accident")),
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
    // Listen for file changes
    onRender: ({ panel }) => {
      const fileInput = panel.querySelector("#p_dir_photo_file");
      const btn = panel.querySelector("#p_dir_photo_btn");
      const preview = panel.querySelector("#p_dir_photo_preview");
      const status = panel.querySelector("#p_dir_photo_status");
      const pathInput = panel.querySelector("#p_dir_photo_path");

      btn?.addEventListener("click", () => fileInput?.click());

      fileInput?.addEventListener("change", async () => {
        if (!fileInput.files.length) return;
        const file = fileInput.files[0];

        try {
          status.textContent = "A carregar...";
          status.className = "text-[9px] font-black text-blue-600 mt-1 animate-pulse";

          const result = await apiUpload(`/projects/${encodeURIComponent(id)}/director-photo`, {
            file,
            fieldName: "photo"
          });

          pathInput.value = result.photo;
          preview.src = `${getApiBaseUrl()}/${result.photo}?t=${Date.now()}`;
          status.textContent = "Foto atualizada!";
          status.className = "text-[9px] font-black text-emerald-600 mt-1";
          toast("Foto do director atualizada", { type: "success" });
        } catch (err) {
          status.textContent = "Erro no upload";
          status.className = "text-[9px] font-black text-red-600 mt-1";
          toast("Erro ao carregar foto", { type: "error" });
        }
      });

      // Render Technicians
      const list = panel.querySelector("#technicians_list");
      const renderTechnicians = () => {
        list.innerHTML = currentTechnicians.map((t, i) => `
          <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl relative group">
            <button type="button" data-remove-tech="${i}" class="absolute top-2 right-2 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity material-symbols-outlined text-sm">delete</button>
            <div class="flex items-start gap-3">
              <div class="flex-shrink-0 flex flex-col items-center gap-2">
                <div class="w-10 h-10 rounded-full bg-slate-200 border border-white shadow-sm overflow-hidden flex-shrink-0">
                  <img src="${t.photo ? getApiBaseUrl()+'/'+t.photo : '/assets/images/placeholder-user.png'}" class="w-full h-full object-cover">
                </div>
                <input type="file" class="hidden" data-tech-photo-file="${i}" accept="image/*">
                <button type="button" data-tech-photo-btn="${i}" class="text-[9px] bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-500 hover:bg-slate-100">Foto</button>
              </div>
              <div class="flex-1 space-y-2">
                <div><input type="text" data-tech-field="name" data-tech-idx="${i}" value="${escapeHtml(t.name)}" placeholder="Nome" class="w-full text-xs font-bold rounded border-slate-200 p-1.5 focus:ring-1 focus:ring-blue-500"/></div>
                <div><input type="text" data-tech-field="role" data-tech-idx="${i}" value="${escapeHtml(t.role)}" placeholder="Função (ex: Eng. Eletrotécnico)" class="w-full text-[10px] rounded border-slate-200 p-1.5"/></div>
                <div class="grid grid-cols-2 gap-2">
                  <input type="text" data-tech-field="phone" data-tech-idx="${i}" value="${escapeHtml(t.phone)}" placeholder="Telefone" class="w-full text-[10px] rounded border-slate-200 p-1.5"/>
                  <input type="text" data-tech-field="email" data-tech-idx="${i}" value="${escapeHtml(t.email)}" placeholder="Email" class="w-full text-[10px] rounded border-slate-200 p-1.5"/>
                </div>
              </div>
            </div>
          </div>
        `).join("");
      };

      panel.querySelector("#add_technician_btn").addEventListener("click", () => {
        currentTechnicians.push({ name: "", role: "", phone: "", email: "", photo: "" });
        renderTechnicians();
      });

      list.addEventListener("input", (e) => {
        if (e.target.matches("[data-tech-field]")) {
          const idx = e.target.getAttribute("data-tech-idx");
          const field = e.target.getAttribute("data-tech-field");
          currentTechnicians[idx][field] = e.target.value;
        }
      });

      list.addEventListener("click", (e) => {
        if (e.target.matches("[data-remove-tech]")) {
          const idx = e.target.getAttribute("data-remove-tech");
          currentTechnicians.splice(idx, 1);
          renderTechnicians();
        }
        if (e.target.matches("[data-tech-photo-btn]")) {
          const idx = e.target.getAttribute("data-tech-photo-btn");
          list.querySelector(`[data-tech-photo-file="${idx}"]`).click();
        }
      });

      list.addEventListener("change", async (e) => {
        if (e.target.matches("[data-tech-photo-file]")) {
          const idx = e.target.getAttribute("data-tech-photo-file");
          if (!e.target.files.length) return;
          try {
            toast("A carregar foto do técnico...", { type: "info" });
            const result = await apiUpload(`/projects/${encodeURIComponent(id)}/technician-photo`, {
              file: e.target.files[0],
              fieldName: "photo"
            });
            currentTechnicians[idx].photo = result.photo;
            renderTechnicians();
            toast("Foto do técnico atualizada", { type: "success" });
          } catch (err) {
            toast("Erro ao carregar foto", { type: "error" });
          }
        }
      });

      renderTechnicians();
    }
  });
}

async function openCreate() {
  const clients = await loadClients();
  const clientOptions = [
    `< option value = "" > Sem cliente vinculado</option > `,
    ...clients.map(
      (client) =>
        `< option value = "${escapeHtml(client.id)}" > ${escapeHtml(client.name)
        } (${escapeHtml(client.code)})</option > `
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
  ].map(t => `< option value = "${t}" > ${t}</option > `).join("");

  let currentTechnicians = [];

  openModal({
    title: "Cadastrar nova obra",
    primaryLabel: "Criar",
    contentHtml: `
    < div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-2" >
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome da obra</label><input id="p_name" class="w-full rounded-lg border-slate-300" placeholder="Condomínio Alpha" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Tipo de Obra</label><select id="p_type" class="w-full rounded-lg border-slate-300"><option value="">Selecione...</option>${projectTypesOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Cliente</label><select id="p_client" class="w-full rounded-lg border-slate-300">${clientOptions}</select></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Contato</label><input id="p_contact" class="w-full rounded-lg border-slate-300" placeholder="Telefone" /></div>
        
        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Contratos e Direcção</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Empreiteiro</label><input id="p_empreiteiro" class="w-full rounded-lg border-slate-300" placeholder="Ex: ProRedes Utilities Ltd" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Sub-Empreiteiro</label><input id="p_subempreiteiro" class="w-full rounded-lg border-slate-300" placeholder="Ex: MBT ENERGIA" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Director de Obra</label><input id="p_director" class="w-full rounded-lg border-slate-300" placeholder="Ex: LUCAS ZANGUEU" /></div>
        
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Foto do Director</label>
          <div class="flex items-center gap-4 p-3 bg-slate-50 rounded-xl border border-dashed border-slate-300">
             <div class="w-12 h-12 rounded-full overflow-hidden bg-slate-200 border-2 border-white shadow-sm flex-shrink-0">
                <img id="p_dir_photo_preview_create" src="/assets/images/placeholder-user.png" class="w-full h-full object-cover"/>
             </div>
             <div class="flex-1">
                <input type="file" id="p_dir_photo_file_create" class="hidden" accept="image/*" />
                <button type="button" id="p_dir_photo_btn_create" class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-colors">Selecionar Foto</button>
                <div id="p_dir_photo_status_create" class="text-[9px] font-bold text-slate-400 mt-1">PNG ou JPG (Max 5MB)</div>
             </div>
          </div>
        </div>

        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Telefone do Dir.</label><input id="p_dir_phone" class="w-full rounded-lg border-slate-300" placeholder="9xxxxxxxx" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Email do Dir.</label><input id="p_dir_email" class="w-full rounded-lg border-slate-300" placeholder="email@exemplo.com" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Referências</label><input id="p_referencia" class="w-full rounded-lg border-slate-300" placeholder="Ex: NM/ADM/PROREDES/003/2025" /></div>

        <div class="col-span-1 md:col-span-2 mt-2">
          <div class="flex justify-between items-center border-b border-outline-variant/20 pb-2 mb-2">
            <h3 class="text-xs font-bold text-primary uppercase tracking-widest">Equipa Técnica Adicional</h3>
            <button type="button" id="add_technician_btn_create" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 transition-colors rounded text-[10px] font-bold text-slate-600">+ Adicionar Técnico</button>
          </div>
          <div id="technicians_list_create" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
        </div>

        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Localização e Orçamento</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Local da obra / Região</label><input id="p_region" class="w-full rounded-lg border-slate-300" placeholder="Ex: Luanda" /></div>
        <div class="md:col-span-1"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Morada</label><input id="p_location" class="w-full rounded-lg border-slate-300" placeholder="Ex: Rua, Bairro" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Orçamento Total</label><input id="p_total" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Progresso inicial (%)</label><input id="p_prog" type="number" min="0" max="100" class="w-full rounded-lg border-slate-300" value="0" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Início</label><input id="p_start" type="date" class="w-full rounded-lg border-slate-300" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Fim</label><input id="p_due" type="date" class="w-full rounded-lg border-slate-300" /></div>

        <div class="col-span-1 md:col-span-2 mt-2"><h3 class="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/20 pb-2 mb-2">Segurança e Pessoal (HSE)</h3></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nº Funcionários Ativos</label><input id="p_staff" type="number" class="w-full rounded-lg border-slate-300" value="0" /></div>
        <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Último Acidente</label><input id="p_last_accident" type="date" class="w-full rounded-lg border-slate-300" /></div>
      </div >
    `,
    onPrimary: async ({ close, panel }) => {
      const v = (id) => panel.querySelector(`#${id} `)?.value?.trim?.();
      const btn = panel.querySelector("[data-primary]");
      try {
        setButtonLoading(btn, true);
        const res = await apiRequest("/projects", {
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
            directorPhone: v("p_dir_phone") || null,
            directorEmail: v("p_dir_email") || null,
            referencia: v("p_referencia") || null,
            technicians: currentTechnicians.map(t => ({ name: t.name, role: t.role, phone: t.phone, email: t.email, photo: "" })),
            activeStaffCount: Number(v("p_staff") || 0),
            lastAccidentDate: toIsoDate(v("p_last_accident")),
          },
        });

        // 2. Upload photo if selected
        const fileInput = panel.querySelector("#p_dir_photo_file_create");
        if (fileInput?.files?.length) {
          try {
            toast("A carregar foto do director...", { type: "info" });
            await apiUpload(`/ projects / ${encodeURIComponent(res.id)}/director-photo`, {
              file: fileInput.files[0],
              fieldName: "photo"
            });
          } catch (err) {
            console.error("Erro no upload inicial da foto:", err);
            toast("Obra criada, mas houve erro no upload da foto.", { type: "warning" });
          }
        }

        // 3. Upload technician photos if any
        let techUpdated = false;
        for (let i = 0; i < currentTechnicians.length; i++) {
          if (currentTechnicians[i].fileObj) {
            try {
              const r = await apiUpload(`/projects/${encodeURIComponent(res.id)}/technician-photo`, {
                file: currentTechnicians[i].fileObj,
                fieldName: "photo"
              });
              currentTechnicians[i].photo = r.photo;
              techUpdated = true;
            } catch (e) {
              console.error("Erro no upload da foto do tecnico", e);
            }
          }
        }

        if (techUpdated) {
          const cleanTechs = currentTechnicians.map(t => ({ name: t.name, role: t.role, phone: t.phone, email: t.email, photo: t.photo }));
          await apiRequest(`/projects/${encodeURIComponent(res.id)}`, { method: "PATCH", body: { technicians: cleanTechs } });
        }

        toast("Obra criada com sucesso", { type: "success" });
        close();
        state.page = 1;
        await load();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao criar obra", { type: "error" });
      }
    },
    onRender: ({ panel }) => {
      const fileInput = panel.querySelector("#p_dir_photo_file_create");
      const btn = panel.querySelector("#p_dir_photo_btn_create");
      const preview = panel.querySelector("#p_dir_photo_preview_create");
      const status = panel.querySelector("#p_dir_photo_status_create");

      btn?.addEventListener("click", () => fileInput?.click());

      fileInput?.addEventListener("change", () => {
        if (!fileInput.files.length) return;
        const file = fileInput.files[0];

        // Local preview only
        const reader = new FileReader();
        reader.onload = (e) => {
          preview.src = e.target.result;
          status.textContent = "Foto selecionada";
          status.className = "text-[9px] font-black text-blue-600 mt-1";
        };
        reader.readAsDataURL(file);
      });

      // Render Technicians
      const list = panel.querySelector("#technicians_list_create");
      const renderTechnicians = () => {
        list.innerHTML = currentTechnicians.map((t, i) => `
          <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl relative group">
            <button type="button" data-remove-tech="${i}" class="absolute top-2 right-2 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity material-symbols-outlined text-sm">delete</button>
            <div class="flex items-start gap-3">
              <div class="flex-shrink-0 flex flex-col items-center gap-2">
                <div class="w-10 h-10 rounded-full bg-slate-200 border border-white shadow-sm overflow-hidden flex-shrink-0">
                  <img src="${t.previewUrl ? t.previewUrl : '/assets/images/placeholder-user.png'}" class="w-full h-full object-cover">
                </div>
                <input type="file" class="hidden" data-tech-photo-file="${i}" accept="image/*">
                <button type="button" data-tech-photo-btn="${i}" class="text-[9px] bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-500 hover:bg-slate-100">Foto</button>
              </div>
              <div class="flex-1 space-y-2">
                <div><input type="text" data-tech-field="name" data-tech-idx="${i}" value="${escapeHtml(t.name)}" placeholder="Nome" class="w-full text-xs font-bold rounded border-slate-200 p-1.5 focus:ring-1 focus:ring-blue-500"/></div>
                <div><input type="text" data-tech-field="role" data-tech-idx="${i}" value="${escapeHtml(t.role)}" placeholder="Função (ex: Eng. Eletrotécnico)" class="w-full text-[10px] rounded border-slate-200 p-1.5"/></div>
                <div class="grid grid-cols-2 gap-2">
                  <input type="text" data-tech-field="phone" data-tech-idx="${i}" value="${escapeHtml(t.phone)}" placeholder="Telefone" class="w-full text-[10px] rounded border-slate-200 p-1.5"/>
                  <input type="text" data-tech-field="email" data-tech-idx="${i}" value="${escapeHtml(t.email)}" placeholder="Email" class="w-full text-[10px] rounded border-slate-200 p-1.5"/>
                </div>
              </div>
            </div>
          </div>
        `).join("");
      };

      panel.querySelector("#add_technician_btn_create").addEventListener("click", () => {
        currentTechnicians.push({ name: "", role: "", phone: "", email: "", photo: "", fileObj: null, previewUrl: null });
        renderTechnicians();
      });

      list.addEventListener("input", (e) => {
        if (e.target.matches("[data-tech-field]")) {
          const idx = e.target.getAttribute("data-tech-idx");
          const field = e.target.getAttribute("data-tech-field");
          currentTechnicians[idx][field] = e.target.value;
        }
      });

      list.addEventListener("click", (e) => {
        if (e.target.matches("[data-remove-tech]")) {
          const idx = e.target.getAttribute("data-remove-tech");
          if (currentTechnicians[idx].previewUrl) URL.revokeObjectURL(currentTechnicians[idx].previewUrl);
          currentTechnicians.splice(idx, 1);
          renderTechnicians();
        }
        if (e.target.matches("[data-tech-photo-btn]")) {
          const idx = e.target.getAttribute("data-tech-photo-btn");
          list.querySelector(`[data-tech-photo-file="${idx}"]`).click();
        }
      });

      list.addEventListener("change", (e) => {
        if (e.target.matches("[data-tech-photo-file]")) {
          const idx = e.target.getAttribute("data-tech-photo-file");
          if (!e.target.files.length) return;
          const file = e.target.files[0];
          currentTechnicians[idx].fileObj = file;

          if (currentTechnicians[idx].previewUrl) URL.revokeObjectURL(currentTechnicians[idx].previewUrl);
          currentTechnicians[idx].previewUrl = URL.createObjectURL(file);
          renderTechnicians();
        }
      });

      renderTechnicians();
    }
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
