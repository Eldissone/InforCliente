import { apiRequest, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, toast, escapeHtml } from "../../shared/ui.js";
import { initPermissionLayer } from "../../shared/permissions.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

checkAuth();

function el(id) {
  return document.getElementById(id);
}

function detectEquipmentKind(item) {
  const desc = String(item.description || "").toLowerCase();
  const name = String(item.name || "").toLowerCase();
  if (desc.includes("viatura") || name.includes("viatura") || name.includes("carrinha") || name.includes("camião")) return "Viatura";
  if (desc.includes("maquinaria") || name.includes("retroescavadora") || name.includes("giratória") || name.includes("trator")) return "Maquinaria";
  if (item.category === "TOOL" || desc.includes("ferramenta")) return "Ferramenta";
  return "Equipamento";
}

const KIND_META = {
  Equipamento: { pill: "bg-purple-50 text-purple-700 border-purple-100", icon: "precision_manufacturing" },
  Maquinaria: { pill: "bg-amber-50 text-amber-700 border-amber-100", icon: "agriculture" },
  Viatura: { pill: "bg-blue-50 text-blue-700 border-blue-100", icon: "directions_car" },
  Ferramenta: { pill: "bg-emerald-50 text-emerald-700 border-emerald-100", icon: "handyman" },
};

let allEquipments = [];
let state = {
  page: 1,
  pageSize: 10,
  search: "",
  kind: "",
  sort: "name_asc",
};

function renderKindBadge(kind) {
  const meta = KIND_META[kind] || { pill: "bg-slate-50 text-slate-600 border-slate-200" };
  return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.pill}">
    ${escapeHtml(kind)}
  </span>`;
}

function renderStatusBadge(active) {
  if (active === false) {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-50 text-slate-500 text-[10px] font-bold border border-slate-200">
      <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Inativo
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">
    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Ativo
  </span>`;
}

function renderRow(item) {
  const kind = detectEquipmentKind(item);
  const meta = KIND_META[kind] || { icon: "agriculture" };
  const hasImage = Boolean(item.image);

  return `
    <tr class="hover:bg-slate-50 transition-all duration-200 group border-b border-slate-50 last:border-0">
      <td class="px-8 py-4">
        <div class="flex items-center gap-4">
          ${hasImage
            ? `<div class="h-11 w-11 rounded-2xl overflow-hidden border border-slate-100 shadow-sm shrink-0">
                 <img src="${getAssetUrl(item.image)}" alt="${escapeHtml(item.name)}" class="w-full h-full object-cover" />
               </div>`
            : `<div class="h-11 w-11 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center shrink-0">
                 <span class="material-symbols-outlined text-xl">${meta.icon}</span>
               </div>`
          }
          <div class="min-w-0">
            <p class="text-sm font-bold text-slate-900 group-hover:text-slate-700 truncate">${escapeHtml(item.name)}</p>
            ${item.description ? `<p class="text-xs text-slate-400 truncate max-w-[320px]">${escapeHtml(item.description)}</p>` : ""}
          </div>
        </div>
      </td>
      <td class="px-8 py-4 text-center">
        ${renderKindBadge(kind)}
      </td>
      <td class="px-8 py-4 text-center font-mono text-sm font-semibold text-slate-700">
        ${escapeHtml(item.sku || "—")}
      </td>
      <td class="px-8 py-4 text-center text-sm font-semibold text-slate-600">
        ${escapeHtml(item.unit || "UN")}
      </td>
      <td class="px-8 py-4 text-center">
        ${renderStatusBadge(item.active)}
      </td>
      <td class="px-8 py-4 text-right">
        <div class="flex items-center justify-end gap-1.5">
          <button type="button" data-edit="${item.id}"
            class="h-9 w-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-400 transition-all shadow-sm"
            title="Editar equipamento">
            <span class="material-symbols-outlined text-lg">edit</span>
          </button>
          <button type="button" data-delete="${item.id}"
            class="h-9 w-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-red-500 hover:text-red-700 hover:border-red-300 hover:bg-red-50/50 transition-all shadow-sm"
            title="Eliminar equipamento">
            <span class="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function getFilteredEquipments() {
  let list = [...allEquipments];

  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((item) =>
      String(item.name || "").toLowerCase().includes(q) ||
      String(item.sku || "").toLowerCase().includes(q) ||
      String(item.description || "").toLowerCase().includes(q)
    );
  }

  if (state.kind) {
    list = list.filter((item) => detectEquipmentKind(item) === state.kind);
  }

  if (state.sort === "name_asc") {
    list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  } else if (state.sort === "name_desc") {
    list.sort((a, b) => String(b.name || "").localeCompare(String(a.name || "")));
  } else if (state.sort === "sku_asc") {
    list.sort((a, b) => String(a.sku || "").localeCompare(String(b.sku || "")));
  }

  return list;
}

function renderTable() {
  const tbody = el("equipmentsTbody");
  if (!tbody) return;

  const filtered = getFilteredEquipments();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * state.pageSize;
  const slice = filtered.slice(start, start + state.pageSize);

  if (!slice.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-8 py-16 text-center text-slate-400">
          <span class="material-symbols-outlined text-5xl opacity-40">agriculture</span>
          <p class="text-sm font-semibold mt-2">Nenhum equipamento ou viatura encontrado.</p>
          <p class="text-xs text-slate-400 mt-1">Experimente ajustar os filtros ou a pesquisa.</p>
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = slice.map(renderRow).join("");
  }

  const pagingText = el("equipmentsPagingText");
  if (pagingText) {
    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(total, start + state.pageSize);
    pagingText.textContent = `Mostrando ${from}-${to} de ${total} equipamentos`;
  }

  renderPages(totalPages);
}

function renderPages(totalPages) {
  const host = el("equipmentsPages");
  const prev = el("equipmentsPrev");
  const next = el("equipmentsNext");
  if (!host || !prev || !next) return;

  prev.disabled = state.page <= 1;
  next.disabled = state.page >= totalPages;

  const windowSize = 5;
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, state.page - half);
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  host.innerHTML = "";
  for (let i = start; i <= end; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(i);
    btn.className = i === state.page
      ? "h-9 w-9 rounded-xl bg-slate-900 text-white font-bold text-xs"
      : "h-9 w-9 rounded-xl border border-slate-200 bg-white text-slate-600 font-bold text-xs hover:border-slate-400 transition-all";
    btn.addEventListener("click", () => {
      state.page = i;
      renderTable();
    });
    host.appendChild(btn);
  }
}

async function loadEquipments() {
  try {
    const res = await apiRequest("/products?includeInactive=true");
    const rawItems = Array.isArray(res?.items) ? res.items : [];
    // Filtra apenas TOOL e EQUIPMENT
    allEquipments = rawItems.filter((item) => item.category === "EQUIPMENT" || item.category === "TOOL");
    renderTable();
  } catch (error) {
    toast(error?.message || "Erro ao carregar equipamentos.", { type: "error" });
    const tbody = el("equipmentsTbody");
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-8 py-12 text-center text-red-500 font-semibold text-sm">
            Não foi possível carregar os equipamentos.
          </td>
        </tr>
      `;
    }
  }
}

function handleEdit(equipmentId) {
  const item = allEquipments.find((e) => e.id === equipmentId);
  if (!item) return;

  const currentKind = detectEquipmentKind(item);

  const contentHtml = `
    <form id="editEquipmentForm" class="flex flex-col gap-4 text-left">
      <div>
        <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Nome do Ativo *</label>
        <input name="name" type="text" required value="${escapeHtml(item.name)}"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Tipo</label>
          <select name="kind"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">
            <option value="Equipamento" ${currentKind === "Equipamento" ? "selected" : ""}>Equipamento</option>
            <option value="Maquinaria" ${currentKind === "Maquinaria" ? "selected" : ""}>Maquinaria</option>
            <option value="Viatura" ${currentKind === "Viatura" ? "selected" : ""}>Viatura</option>
            <option value="Ferramenta" ${currentKind === "Ferramenta" ? "selected" : ""}>Ferramenta</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Matrícula / N.º Série</label>
          <input name="sku" type="text" value="${escapeHtml(item.sku || "")}" placeholder="Ex: LD-00-00-AA"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Unidade</label>
          <select name="unit"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">
            <option value="UN" ${item.unit === "UN" ? "selected" : ""}>Unidade (UN)</option>
            <option value="M" ${item.unit === "M" ? "selected" : ""}>Metro (M)</option>
            <option value="CX" ${item.unit === "CX" ? "selected" : ""}>Caixa (CX)</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Estado</label>
          <select name="active"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">
            <option value="true" ${item.active !== false ? "selected" : ""}>Ativo</option>
            <option value="false" ${item.active === false ? "selected" : ""}>Inativo</option>
          </select>
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Descrição / Características</label>
        <textarea name="description" rows="2" placeholder="Notas operacionais ou especificações"
          class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">${escapeHtml(item.description || "")}</textarea>
      </div>
    </form>
  `;

  openModal({
    title: "Editar Equipamento / Viatura",
    contentHtml,
    primaryLabel: "Guardar Alterações",
    onPrimary: async ({ panel, close }) => {
      const form = panel.querySelector("#editEquipmentForm");
      if (!form) return;
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      if (!name) {
        toast("O nome é obrigatório.", { type: "error" });
        return;
      }
      const kind = data.get("kind");
      const sku = String(data.get("sku") || "").trim() || null;
      const unit = data.get("unit") || "UN";
      const description = String(data.get("description") || "").trim() || null;
      const category = kind === "Ferramenta" ? "TOOL" : "EQUIPMENT";

      try {
        await apiRequest(`/products/${item.id}`, {
          method: "PATCH",
          body: {
            name,
            sku,
            unit,
            category,
            description,
          },
        });
        toast("Equipamento atualizado com sucesso!", { type: "success" });
        close();
        await loadEquipments();
      } catch (err) {
        toast(err?.message || "Erro ao atualizar equipamento.", { type: "error" });
      }
    },
  });
}

function handleDelete(equipmentId) {
  const item = allEquipments.find((e) => e.id === equipmentId);
  if (!item) return;

  const contentHtml = `
    <div class="py-2 text-slate-600 text-sm">
      <p class="mb-2">Tem a certeza que deseja eliminar <strong class="text-slate-900">${escapeHtml(item.name)}</strong>?</p>
      <p class="text-xs text-slate-400">Caso o ativo já possua alocações a obras ou histórico de saídas, será arquivado com segurança.</p>
    </div>
  `;

  openModal({
    title: "Confirmar Eliminação",
    contentHtml,
    primaryLabel: "Sim, Eliminar",
    secondaryLabel: "Cancelar",
    onPrimary: async ({ close }) => {
      try {
        await apiRequest(`/products/${item.id}`, { method: "DELETE" });
        toast("Equipamento removido com sucesso!", { type: "success" });
        close();
        await loadEquipments();
      } catch (err) {
        toast(err?.message || "Erro ao eliminar equipamento.", { type: "error" });
      }
    },
  });
}

function bindEvents() {
  el("equipmentsSearch")?.addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    state.page = 1;
    renderTable();
  });

  el("equipmentsKind")?.addEventListener("change", (e) => {
    state.kind = e.target.value;
    state.page = 1;
    renderTable();
  });

  el("equipmentsSort")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderTable();
  });

  el("equipmentsPrev")?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      renderTable();
    }
  });

  el("equipmentsNext")?.addEventListener("click", () => {
    state.page += 1;
    renderTable();
  });

  el("equipmentsTbody")?.addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      handleEdit(editBtn.dataset.edit);
      return;
    }

    const deleteBtn = e.target.closest("[data-delete]");
    if (deleteBtn) {
      handleDelete(deleteBtn.dataset.delete);
    }
  });
}

async function init() {
  await initPermissionLayer();
  wireLogout();
  wireUsersNav();
  bindEvents();
  await loadEquipments();
}

init();

