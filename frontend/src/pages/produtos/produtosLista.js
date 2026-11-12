import { apiRequest, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, toast, escapeHtml } from "../../shared/ui.js";
import { can, initPermissionLayer } from "../../shared/permissions.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

checkAuth();

function el(id) {
  return document.getElementById(id);
}

const CATEGORY_MAP = {
  MATERIAL: { label: "Produto", pill: "bg-emerald-50 text-emerald-700 border-emerald-100", icon: "inventory_2" },
  CONSUMABLE: { label: "Serviço", pill: "bg-blue-50 text-blue-700 border-blue-100", icon: "engineering" },
  TOOL: { label: "Ferramenta", pill: "bg-amber-50 text-amber-700 border-amber-100", icon: "handyman" },
  EQUIPMENT: { label: "Equipamento", pill: "bg-purple-50 text-purple-700 border-purple-100", icon: "agriculture" },
};

const UNIT_LABELS = {
  UN: "Unidade (UN)",
  KG: "Quilograma (KG)",
  M: "Metro (M)",
  L: "Litro (L)",
  CX: "Caixa (CX)",
  PAR: "Par (PAR)",
  MT2: "Metro ² (MT2)",
  MT3: "Metro ³ (MT3)",
};

let allProducts = [];
let state = {
  page: 1,
  pageSize: 10,
  search: "",
  category: "",
  unit: "",
  sort: "name_asc",
};

function renderTypeBadge(cat) {
  const meta = CATEGORY_MAP[cat] || { label: cat || "Outro", pill: "bg-slate-50 text-slate-600 border-slate-100" };
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold border ${meta.pill}">
    ${escapeHtml(meta.label)}
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
  const meta = CATEGORY_MAP[item.category] || { icon: "inventory_2" };
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
            <div class="flex items-center gap-2 mt-0.5">
              ${item.sku ? `<span class="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">SKU: ${escapeHtml(item.sku)}</span>` : ""}
              ${item.description ? `<span class="text-xs text-slate-400 truncate max-w-[280px]">· ${escapeHtml(item.description)}</span>` : ""}
            </div>
          </div>
        </div>
      </td>
      <td class="px-8 py-4 text-center">
        ${renderTypeBadge(item.category)}
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
            title="Editar item">
            <span class="material-symbols-outlined text-lg">edit</span>
          </button>
          <button type="button" data-delete="${item.id}"
            class="h-9 w-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-red-500 hover:text-red-700 hover:border-red-300 hover:bg-red-50/50 transition-all shadow-sm"
            title="Eliminar item">
            <span class="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function getFilteredProducts() {
  let list = [...allProducts];

  // Filtro de busca
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((item) =>
      String(item.name || "").toLowerCase().includes(q) ||
      String(item.sku || "").toLowerCase().includes(q) ||
      String(item.description || "").toLowerCase().includes(q)
    );
  }

  // Filtro de categoria
  if (state.category) {
    list = list.filter((item) => item.category === state.category);
  }

  // Filtro de unidade
  if (state.unit) {
    list = list.filter((item) => item.unit === state.unit);
  }

  // Ordenação
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
  const tbody = el("productsTbody");
  if (!tbody) return;

  const filtered = getFilteredProducts();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * state.pageSize;
  const slice = filtered.slice(start, start + state.pageSize);

  if (!slice.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="px-8 py-16 text-center text-slate-400">
          <span class="material-symbols-outlined text-5xl opacity-40">inventory_2</span>
          <p class="text-sm font-semibold mt-2">Nenhum produto ou serviço encontrado.</p>
          <p class="text-xs text-slate-400 mt-1">Experimente ajustar a busca ou os filtros aplicados.</p>
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = slice.map(renderRow).join("");
  }

  // Paginação texto
  const pagingText = el("productsPagingText");
  if (pagingText) {
    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(total, start + state.pageSize);
    pagingText.textContent = `Mostrando ${from}-${to} de ${total} itens`;
  }

  // Botões de página
  renderPages(totalPages);
}

function renderPages(totalPages) {
  const host = el("productsPages");
  const prev = el("productsPrev");
  const next = el("productsNext");
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

async function loadProducts() {
  try {
    const res = await apiRequest("/products?includeInactive=true");
    allProducts = Array.isArray(res?.items) ? res.items : [];
    renderTable();
  } catch (error) {
    toast(error?.message || "Erro ao carregar catálogo de produtos e serviços.", { type: "error" });
    const tbody = el("productsTbody");
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-8 py-12 text-center text-red-500 font-semibold text-sm">
            Não foi possível carregar os produtos. Tente recarregar a página.
          </td>
        </tr>
      `;
    }
  }
}

function handleEdit(productId) {
  const product = allProducts.find((p) => p.id === productId);
  if (!product) return;

  const contentHtml = `
    <form id="editProductForm" class="flex flex-col gap-4 text-left">
      <div>
        <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Nome do Item *</label>
        <input name="name" type="text" required value="${escapeHtml(product.name)}"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Código SKU</label>
          <input name="sku" type="text" value="${escapeHtml(product.sku || "")}" placeholder="Ex: MAT-001"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Tipo / Categoria *</label>
          <select name="category" required
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">
            <option value="MATERIAL" ${product.category === "MATERIAL" ? "selected" : ""}>Produto (Material)</option>
            <option value="CONSUMABLE" ${product.category === "CONSUMABLE" ? "selected" : ""}>Serviço (Consumível)</option>
            <option value="TOOL" ${product.category === "TOOL" ? "selected" : ""}>Ferramenta</option>
            <option value="EQUIPMENT" ${product.category === "EQUIPMENT" ? "selected" : ""}>Equipamento</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Unidade de Medida</label>
          <select name="unit"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">
            ${Object.entries(UNIT_LABELS).map(([val, label]) => `
              <option value="${val}" ${product.unit === val ? "selected" : ""}>${label}</option>
            `).join("")}
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Estado</label>
          <select name="active"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">
            <option value="true" ${product.active !== false ? "selected" : ""}>Ativo</option>
            <option value="false" ${product.active === false ? "selected" : ""}>Inativo</option>
          </select>
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Descrição / Notas</label>
        <textarea name="description" rows="2" placeholder="Especificações ou detalhes opcionais"
          class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">${escapeHtml(product.description || "")}</textarea>
      </div>
    </form>
  `;

  openModal({
    title: "Editar Produto / Serviço",
    contentHtml,
    primaryLabel: "Guardar Alterações",
    onPrimary: async ({ panel, close }) => {
      const form = panel.querySelector("#editProductForm");
      if (!form) return;
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      if (!name) {
        toast("O nome é obrigatório.", { type: "error" });
        return;
      }
      const sku = String(data.get("sku") || "").trim() || null;
      const category = data.get("category");
      const unit = data.get("unit");
      const description = String(data.get("description") || "").trim() || null;

      try {
        await apiRequest(`/products/${product.id}`, {
          method: "PATCH",
          body: {
            name,
            sku,
            category,
            unit,
            description,
          },
        });
        toast("Item atualizado com sucesso!", { type: "success" });
        close();
        await loadProducts();
      } catch (err) {
        toast(err?.message || "Erro ao atualizar item.", { type: "error" });
      }
    },
  });
}

function handleDelete(productId) {
  const product = allProducts.find((p) => p.id === productId);
  if (!product) return;

  const contentHtml = `
    <div class="py-2 text-slate-600 text-sm">
      <p class="mb-2">Tem a certeza que deseja eliminar o item <strong class="text-slate-900">${escapeHtml(product.name)}</strong>?</p>
      <p class="text-xs text-slate-400">Se o item já possuir histórico em obras ou requisições, ele será arquivado/desativado com segurança sem perda de dados.</p>
    </div>
  `;

  openModal({
    title: "Confirmar Eliminação",
    contentHtml,
    primaryLabel: "Sim, Eliminar",
    secondaryLabel: "Cancelar",
    onPrimary: async ({ close }) => {
      try {
        await apiRequest(`/products/${product.id}`, { method: "DELETE" });
        toast("Item removido com sucesso!", { type: "success" });
        close();
        await loadProducts();
      } catch (err) {
        toast(err?.message || "Erro ao eliminar item.", { type: "error" });
      }
    },
  });
}

function bindEvents() {
  el("productsSearch")?.addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    state.page = 1;
    renderTable();
  });

  el("productsCategory")?.addEventListener("change", (e) => {
    state.category = e.target.value;
    state.page = 1;
    renderTable();
  });

  el("productsUnit")?.addEventListener("change", (e) => {
    state.unit = e.target.value;
    state.page = 1;
    renderTable();
  });

  el("productsSort")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderTable();
  });

  el("productsPrev")?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      renderTable();
    }
  });

  el("productsNext")?.addEventListener("click", () => {
    state.page += 1;
    renderTable();
  });

  // Ações de editar e eliminar
  el("productsTbody")?.addEventListener("click", (e) => {
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
  await loadProducts();
}

init();

