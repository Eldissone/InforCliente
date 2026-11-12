import { apiRequest } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, toast, escapeHtml } from "../../shared/ui.js";
import { initPermissionLayer } from "../../shared/permissions.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

checkAuth();

function el(id) {
  return document.getElementById(id);
}

const TYPE_MAP = {
  MATERIAL: { label: "Material", pill: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  SERVICO: { label: "Serviço", pill: "bg-blue-50 text-blue-700 border-blue-100" },
  TRANSPORTADOR: { label: "Transportador", pill: "bg-amber-50 text-amber-700 border-amber-100" },
};

let allSuppliers = [];
let state = {
  page: 1,
  pageSize: 10,
  search: "",
  type: "",
  sort: "name_asc",
};

function renderTypeBadge(type) {
  const meta = TYPE_MAP[type] || { label: type || "Geral", pill: "bg-slate-50 text-slate-600 border-slate-200" };
  return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.pill}">
    ${escapeHtml(meta.label)}
  </span>`;
}

function renderRow(item) {
  return `
    <tr class="hover:bg-slate-50 transition-all duration-200 group border-b border-slate-50 last:border-0">
      <td class="px-8 py-4">
        <div class="flex items-center gap-4">
          <div class="h-10 w-10 rounded-2xl bg-slate-900 text-[#2afc8d] font-bold flex items-center justify-center shrink-0 shadow-sm text-sm">
            ${escapeHtml((item.name || "FO").slice(0, 2).toUpperCase())}
          </div>
          <div class="min-w-0">
            <p class="text-sm font-bold text-slate-900 group-hover:text-slate-700 truncate">${escapeHtml(item.name)}</p>
            ${item.category ? `<p class="text-xs text-slate-400 truncate">${escapeHtml(item.category)}</p>` : ""}
          </div>
        </div>
      </td>
      <td class="px-8 py-4">
        <p class="text-sm font-semibold text-slate-800 font-mono">${escapeHtml(item.nif || "—")}</p>
        ${item.agtStatus ? `<p class="text-[10px] text-slate-400 font-medium">AGT: ${escapeHtml(item.agtStatus)}</p>` : ""}
      </td>
      <td class="px-8 py-4 text-center">
        ${renderTypeBadge(item.type)}
      </td>
      <td class="px-8 py-4">
        <div class="text-xs">
          ${item.phone ? `<p class="font-semibold text-slate-700 flex items-center gap-1"><span class="material-symbols-outlined text-xs">phone</span>${escapeHtml(item.phone)}</p>` : ""}
          ${item.email ? `<p class="text-slate-400 truncate flex items-center gap-1"><span class="material-symbols-outlined text-xs">mail</span>${escapeHtml(item.email)}</p>` : ""}
          ${!item.phone && !item.email ? `<span class="text-slate-400">—</span>` : ""}
        </div>
      </td>
      <td class="px-8 py-4 text-xs font-mono text-slate-600">
        ${escapeHtml(item.iban || "—")}
      </td>
      <td class="px-8 py-4 text-right">
        <div class="flex items-center justify-end gap-1.5">
          <button type="button" data-edit="${item.id}"
            class="h-9 w-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-400 transition-all shadow-sm"
            title="Editar fornecedor">
            <span class="material-symbols-outlined text-lg">edit</span>
          </button>
          <button type="button" data-delete="${item.id}"
            class="h-9 w-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-red-500 hover:text-red-700 hover:border-red-300 hover:bg-red-50/50 transition-all shadow-sm"
            title="Eliminar fornecedor">
            <span class="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function getFilteredSuppliers() {
  let list = [...allSuppliers];

  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((item) =>
      String(item.name || "").toLowerCase().includes(q) ||
      String(item.nif || "").toLowerCase().includes(q) ||
      String(item.phone || "").toLowerCase().includes(q) ||
      String(item.email || "").toLowerCase().includes(q) ||
      String(item.iban || "").toLowerCase().includes(q)
    );
  }

  if (state.type) {
    list = list.filter((item) => item.type === state.type);
  }

  if (state.sort === "name_asc") {
    list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  } else if (state.sort === "name_desc") {
    list.sort((a, b) => String(b.name || "").localeCompare(String(a.name || "")));
  } else if (state.sort === "nif_asc") {
    list.sort((a, b) => String(a.nif || "").localeCompare(String(b.nif || "")));
  }

  return list;
}

function renderTable() {
  const tbody = el("suppliersTbody");
  if (!tbody) return;

  const filtered = getFilteredSuppliers();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * state.pageSize;
  const slice = filtered.slice(start, start + state.pageSize);

  if (!slice.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-8 py-16 text-center text-slate-400">
          <span class="material-symbols-outlined text-5xl opacity-40">local_shipping</span>
          <p class="text-sm font-semibold mt-2">Nenhum fornecedor encontrado.</p>
          <p class="text-xs text-slate-400 mt-1">Experimente ajustar o termo de pesquisa ou os filtros.</p>
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = slice.map(renderRow).join("");
  }

  const pagingText = el("suppliersPagingText");
  if (pagingText) {
    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(total, start + state.pageSize);
    pagingText.textContent = `Mostrando ${from}-${to} de ${total} fornecedores`;
  }

  renderPages(totalPages);
}

function renderPages(totalPages) {
  const host = el("suppliersPages");
  const prev = el("suppliersPrev");
  const next = el("suppliersNext");
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

async function loadSuppliers() {
  try {
    const res = await apiRequest("/suppliers");
    allSuppliers = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
    renderTable();
  } catch (error) {
    toast(error?.message || "Erro ao carregar fornecedores.", { type: "error" });
    const tbody = el("suppliersTbody");
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-8 py-12 text-center text-red-500 font-semibold text-sm">
            Não foi possível carregar os fornecedores.
          </td>
        </tr>
      `;
    }
  }
}

function handleEdit(supplierId) {
  const supplier = allSuppliers.find((s) => s.id === supplierId);
  if (!supplier) return;

  const contentHtml = `
    <form id="editSupplierForm" class="flex flex-col gap-4 text-left">
      <div>
        <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Nome / Razão Social *</label>
        <input name="name" type="text" required value="${escapeHtml(supplier.name)}"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">NIF</label>
          <input name="nif" type="text" value="${escapeHtml(supplier.nif || "")}" placeholder="Ex: 5410000000"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Tipo</label>
          <select name="type"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">
            <option value="MATERIAL" ${supplier.type === "MATERIAL" ? "selected" : ""}>Material</option>
            <option value="SERVICO" ${supplier.type === "SERVICO" ? "selected" : ""}>Serviço</option>
            <option value="TRANSPORTADOR" ${supplier.type === "TRANSPORTADOR" ? "selected" : ""}>Transportador</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Telefone</label>
          <input name="phone" type="text" value="${escapeHtml(supplier.phone || "")}" placeholder="+244 9..."
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email</label>
          <input name="email" type="email" value="${escapeHtml(supplier.email || "")}" placeholder="fornecedor@empresa.ao"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">IBAN</label>
          <input name="iban" type="text" value="${escapeHtml(supplier.iban || "")}" placeholder="AO06..."
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Categoria / Atividade</label>
          <input name="category" type="text" value="${escapeHtml(supplier.category || "")}" placeholder="Ex: Materiais elétricos"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Morada / Endereço</label>
        <textarea name="address" rows="2" placeholder="Localização do fornecedor"
          class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:border-slate-400 focus:outline-none transition-all">${escapeHtml(supplier.address || "")}</textarea>
      </div>
    </form>
  `;

  openModal({
    title: "Editar Fornecedor",
    contentHtml,
    primaryLabel: "Guardar Alterações",
    onPrimary: async ({ panel, close }) => {
      const form = panel.querySelector("#editSupplierForm");
      if (!form) return;
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      if (!name) {
        toast("O nome é obrigatório.", { type: "error" });
        return;
      }
      const nif = String(data.get("nif") || "").trim() || null;
      const type = data.get("type");
      const phone = String(data.get("phone") || "").trim() || null;
      const email = String(data.get("email") || "").trim() || null;
      const iban = String(data.get("iban") || "").trim() || null;
      const category = String(data.get("category") || "").trim() || null;
      const address = String(data.get("address") || "").trim() || null;

      try {
        await apiRequest(`/suppliers/${supplier.id}`, {
          method: "PATCH",
          body: {
            name,
            nif,
            type,
            phone,
            email,
            iban,
            category,
            address,
          },
        });
        toast("Fornecedor atualizado com sucesso!", { type: "success" });
        close();
        await loadSuppliers();
      } catch (err) {
        toast(err?.message || "Erro ao atualizar fornecedor.", { type: "error" });
      }
    },
  });
}

function handleDelete(supplierId) {
  const supplier = allSuppliers.find((s) => s.id === supplierId);
  if (!supplier) return;

  const contentHtml = `
    <div class="py-2 text-slate-600 text-sm">
      <p class="mb-2">Tem a certeza que deseja eliminar o fornecedor <strong class="text-slate-900">${escapeHtml(supplier.name)}</strong>?</p>
      <p class="text-xs text-slate-400">Se existirem faturas ou pedidos de compra associados, a remoção será validada pelo sistema.</p>
    </div>
  `;

  openModal({
    title: "Confirmar Eliminação",
    contentHtml,
    primaryLabel: "Sim, Eliminar",
    secondaryLabel: "Cancelar",
    onPrimary: async ({ close }) => {
      try {
        await apiRequest(`/suppliers/${supplier.id}`, { method: "DELETE" });
        toast("Fornecedor removido com sucesso!", { type: "success" });
        close();
        await loadSuppliers();
      } catch (err) {
        toast(err?.message || "Erro ao eliminar fornecedor.", { type: "error" });
      }
    },
  });
}

function bindEvents() {
  el("suppliersSearch")?.addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    state.page = 1;
    renderTable();
  });

  el("suppliersType")?.addEventListener("change", (e) => {
    state.type = e.target.value;
    state.page = 1;
    renderTable();
  });

  el("suppliersSort")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderTable();
  });

  el("suppliersPrev")?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      renderTable();
    }
  });

  el("suppliersNext")?.addEventListener("click", () => {
    state.page += 1;
    renderTable();
  });

  el("suppliersTbody")?.addEventListener("click", (e) => {
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
  await loadSuppliers();
}

init();

