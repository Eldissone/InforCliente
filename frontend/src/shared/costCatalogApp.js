import { apiRequest } from "/services/api.js";
import { can, initPermissionLayer } from "/shared/permissions.js";
import { checkAuth } from "/services/auth.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, toast } from "/shared/ui.js";
import { initExtraRequestModal, openExtraRequestModal } from "/shared/extraRequestModal.js";
import {
  loadAllCostCategories,
  buildCategoryPath,
  formatCategoryDisplayName,
  getCachedCategories,
  costIdKey,
  sameCostId,
} from "/shared/costCategoryCascade.js";
import {
  buildCostCatalogSheetRows,
  applySheetFilters,
  sheetFilterOptions,
  groupCatalogSheetDisplayRows,
  uniqueCatalogTipo2Groups,
  catalogSheetGroupKey,
  classifyCategorySheetLevel,
  SHEET_LEVEL_LABELS,
  SHEET_TIPO1_FLAT,
} from "/shared/costCategorySheet.js";

function showToast(msg, type = "info") {
  toast(msg, { type: type === "success" || type === "error" ? type : "info" });
}

let costCategories = [];
let selectedCostCategoryFilter = "";

let activeCostCatalogTab = "tipos";
let catalogSheetFilters = {
  tipo1: "",
  grupo: "",
  tipo2: "",
  tipo3: "",
};
/** pickCategoryId escolhido no select de tipo custo 3, por grupo (tipo custo 2). */
let catalogTipo3PickByGroup = {};
/** Grupo da tabela ao editar a partir de uma linha (modal). */
let activeCatalogLineForModal = null;
let catalogSearchQuery = "";
/** IDs seleccionados para eliminação em massa (chaves string). */
let selectedCatalogDeleteIds = new Set();
/** Modo de selecção para eliminar — checkboxes só neste estado. */
let catalogDeleteSelectMode = false;

function catalogDeleteSelectionHas(id) {
  return selectedCatalogDeleteIds.has(costIdKey(id));
}

function setCatalogDeleteSelected(id, on) {
  const key = costIdKey(id);
  if (!key) return;
  if (on) selectedCatalogDeleteIds.add(key);
  else selectedCatalogDeleteIds.delete(key);
}

function setCatalogDeleteSelectMode(on) {
  catalogDeleteSelectMode = Boolean(on);
  if (!catalogDeleteSelectMode) selectedCatalogDeleteIds.clear();
  updateCatalogBulkDeleteButton();
  renderCostCatalogViews();
}

function clearCatalogDeleteSelection() {
  selectedCatalogDeleteIds.clear();
  updateCatalogBulkDeleteButton();
}

function updateCatalogBulkDeleteButton() {
  const selectBtn = document.getElementById("btnCostCatalogSelectDelete");
  const cancelBtn = document.getElementById("btnCostCatalogCancelSelect");
  const deleteBtn = document.getElementById("btnCostCatalogBulkDelete");
  const label = document.getElementById("btnCostCatalogBulkDeleteLabel");
  const canDel = canDeleteCostCatalog();
  const n = selectedCatalogDeleteIds.size;

  selectBtn?.classList.toggle("hidden", !canDel || catalogDeleteSelectMode);
  cancelBtn?.classList.toggle("hidden", !canDel || !catalogDeleteSelectMode);
  deleteBtn?.classList.toggle("hidden", !canDel || !catalogDeleteSelectMode || n === 0);
  if (label) {
    label.textContent =
      n === 1 ? "Eliminar 1 seleccionado" : `Eliminar ${n} seleccionados`;
  }
}

function catalogCheckboxCellHtml(id) {
  if (!canDeleteCostCatalog() || !catalogDeleteSelectMode) return "";
  const checked = catalogDeleteSelectionHas(id) ? " checked" : "";
  return `<td class="px-3 py-3 align-middle w-10" onclick="event.stopPropagation()">
    <input type="checkbox" class="cost-catalog-check h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" data-catalog-check="${costIdKey(id)}"${checked} aria-label="Seleccionar">
  </td>`;
}

function catalogSelectAllHeadHtml(ids) {
  if (!canDeleteCostCatalog() || !catalogDeleteSelectMode) return "";
  const list = (ids || []).map(costIdKey).filter(Boolean);
  const allOn = list.length > 0 && list.every((id) => selectedCatalogDeleteIds.has(id));
  const checked = allOn ? " checked" : "";
  return `<th class="px-3 py-3 w-10">
    <input type="checkbox" id="costCatalogSelectAll" class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"${checked} title="Seleccionar todos" aria-label="Seleccionar todos">
  </th>`;
}

function bindCatalogCheckboxEvents(container, visibleIds) {
  if (!container || !canDeleteCostCatalog() || !catalogDeleteSelectMode) return;
  container.querySelectorAll("[data-catalog-check]").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      setCatalogDeleteSelected(cb.dataset.catalogCheck, cb.checked);
      updateCatalogBulkDeleteButton();
      const selectAll = container.querySelector("#costCatalogSelectAll");
      if (selectAll) {
        const ids = (visibleIds || []).map(costIdKey);
        selectAll.checked = ids.length > 0 && ids.every((id) => selectedCatalogDeleteIds.has(id));
      }
    });
  });
  const selectAll = container.querySelector("#costCatalogSelectAll");
  selectAll?.addEventListener("change", () => {
    const ids = (visibleIds || []).map(costIdKey).filter(Boolean);
    ids.forEach((id) => setCatalogDeleteSelected(id, selectAll.checked));
    container.querySelectorAll("[data-catalog-check]").forEach((cb) => {
      cb.checked = selectAll.checked;
    });
    updateCatalogBulkDeleteButton();
  });
}

function catalogGroupPathLabel(g) {
  return [g.tipo1, g.grupo || null, g.tipo2]
    .filter(Boolean)
    .map((part) => formatCategoryDisplayName(part))
    .join(" › ");
}

function catalogGroupMatchesSearch(g, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    g.tipo1,
    g.grupo,
    g.tipo2,
    ...g.variants.map((v) => v.tipo3),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function clearCostCategoryBatchLines() {
  const wrap = document.getElementById("costCategoryBatchLines");
  if (wrap) wrap.innerHTML = "";
}

function addCostCategoryBatchLine(value = "") {
  const wrap = document.getElementById("costCategoryBatchLines");
  if (!wrap) return;
  const row = document.createElement("div");
  row.className = "flex gap-2 items-center cost-catalog-batch-line";
  row.innerHTML = `<input type="text" class="cost-category-batch-name flex-1 h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none" placeholder="Nome da subcategoria" maxlength="120" value="${escapeHtml(value)}">
    <button type="button" class="cost-catalog-batch-remove shrink-0 w-10 h-10 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600 flex items-center justify-center" aria-label="Remover linha">
      <span class="material-symbols-outlined text-lg">close</span>
    </button>`;
  wrap.appendChild(row);
}

function collectCostCategoryBatchNames() {
  return [...document.querySelectorAll(".cost-category-batch-name")]
    .map((el) => formatCategoryDisplayName(el.value.trim()))
    .filter((n) => n.length >= 2);
}

function setCostCategoryModalTitles({ editId, sheetLevel }) {
  const title = document.getElementById("modalCostCategoryTitle");
  const sub = document.getElementById("modalCostCategorySubtitle");
  const article = sheetLevel === "TIPO2" || sheetLevel === "SUBCUSTO" ? "Nova" : "Novo";
  const label = SHEET_LEVEL_LABELS[sheetLevel] || "entrada";
  if (editId) {
    if (title) title.textContent = "Editar tipo de custo";
    if (sub) sub.textContent = label;
  } else {
    if (title) title.textContent = "Adicionar tipo de custo";
    if (sub) sub.textContent = `${article} ${label.toLowerCase()} — preencha a classificação abaixo`;
  }
}

function focusCreatedCatalogItem(categoryId) {
  if (!categoryId) return;
  const sheet = getCatalogSheetRows();
  const hit =
    sheet.find((r) => sameCostId(r.pickCategoryId, categoryId)) ||
    sheet.find((r) => sameCostId(r.tipo3Id, categoryId)) ||
    sheet.find((r) => sameCostId(r.tipo2Id, categoryId));
  if (!hit) {
    const cat = costCategories.find((c) => sameCostId(c.id, categoryId));
    const lvl = cat ? classifyCategorySheetLevel(cat) : "";
    if (lvl === "TIPO1" || lvl === "GRUPO") {
      showToast("Estrutura criada. Veja na aba «Centros de custo».", "info");
      setCostCatalogTab("estrutura");
    } else {
      showToast("Tipo criado na base de dados. Recarregue a página se não aparecer na tabela.", "info");
    }
    return;
  }
  if (sameCostId(hit.tipo2Id, categoryId) && !hit.tipo3Id) {
    showToast("Categoria adicionada. Clique na linha para gerir subcategorias.", "info");
  }
  catalogSheetFilters = { tipo1: "", grupo: "", tipo2: "", tipo3: "" };
  const gkey = catalogSheetGroupKey({
    domain: hit.domain,
    tipo1: hit.tipo1,
    grupo: hit.grupo,
    tipo2: hit.tipo2,
  });
  catalogTipo3PickByGroup[gkey] = hit.pickCategoryId;
  selectedCostCategoryFilter = hit.pickCategoryId;
  renderCostCatalogViews();
  requestAnimationFrame(() => {
    const rowEl = [...document.querySelectorAll("#costCatalogTipos tr[data-group-key]")].find(
      (tr) => tr.dataset.groupKey === gkey
    );
    rowEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const group = getCatalogGroupByKey(gkey);
    if (group && (hit.tipo3Id || !sameCostId(hit.pickCategoryId, hit.tipo2Id))) {
      openTipo3DrillModal(group);
    }
  });
}

function inferDomainFromCatalogContext() {
  const t1 = catalogSheetFilters.tipo1;
  if (t1 === SHEET_TIPO1_FLAT.OBRA) return "OBRA";
  if (t1 === SHEET_TIPO1_FLAT.VIATURAS) return "VIATURAS";
  return "GERAL";
}

function getCostCategoryDomainValue() {
  return document.getElementById("costCategoryDomain")?.value || "GERAL";
}

function setCostCategoryDomainValue(domain) {
  const el = document.getElementById("costCategoryDomain");
  if (el) el.value = domain;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
function getCatalogSheetRows() {
  const items = costCategories.length ? costCategories : getCachedCategories();
  return buildCostCatalogSheetRows(items);
}

function renderCatalogFilterBar() {
  const bar = document.getElementById("costCatalogFilters");
  if (!bar) return;
  const allRows = getCatalogSheetRows();
  const opts = sheetFilterOptions(allRows, catalogSheetFilters);

  const mkSelect = (id, title, entries, value) => {
    const options = entries
      .map(
        ({ v, label }) =>
          `<option value="${escapeHtml(v)}"${value === v ? " selected" : ""}>${escapeHtml(label)}</option>`
      )
      .join("");
    return `<label class="flex flex-col gap-0.5 min-w-[9.5rem] flex-1 shrink-0">
      <span class="text-[9px] font-black uppercase tracking-wide text-slate-400 truncate">${title}</span>
      <select id="${id}" class="cost-sheet-filter h-9 px-2 bg-white border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200 w-full min-w-0">${options}</select>
    </label>`;
  };

  const tipo1Entries = [
    { v: "", label: "Centro custo — todos" },
    ...opts.tipo1.map((t) => ({ v: t, label: formatCategoryDisplayName(t) })),
  ];
  const grupoValues = opts.grupo;
  const grupoEntries = [{ v: "", label: "Grupo — todos" }];
  if (grupoValues.includes("")) grupoEntries.push({ v: "__EMPTY__", label: "(sem grupo)" });
  grupoValues
    .filter(Boolean)
    .forEach((g) => grupoEntries.push({ v: g, label: formatCategoryDisplayName(g) }));
  const tipo2Entries = [
    { v: "", label: "Categoria — todas" },
    ...opts.tipo2.map((t) => ({ v: t, label: formatCategoryDisplayName(t) })),
  ];

  bar.innerHTML = `<div class="flex flex-nowrap items-end gap-2 mb-3 p-3 bg-slate-50/90 border border-slate-100 rounded-xl overflow-x-auto">
    ${mkSelect("filterSheetTipo1", "Centro custo", tipo1Entries, catalogSheetFilters.tipo1)}
    ${mkSelect("filterSheetGrupo", "Grupo", grupoEntries, catalogSheetFilters.grupo)}
    ${mkSelect("filterSheetTipo2", "Categoria", tipo2Entries, catalogSheetFilters.tipo2)}
    <button type="button" id="btnClearSheetFilters" class="h-9 px-3 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 shrink-0 whitespace-nowrap">Limpar filtros</button>
  </div>`;
}

function readCatalogSheetFiltersFromDom() {
  catalogSheetFilters.tipo1 = document.getElementById("filterSheetTipo1")?.value || "";
  catalogSheetFilters.grupo = document.getElementById("filterSheetGrupo")?.value || "";
  catalogSheetFilters.tipo2 = document.getElementById("filterSheetTipo2")?.value || "";
  catalogSheetFilters.tipo3 = "";
}

function resetCatalogSheetFiltersCascade(fromKey) {
  if (fromKey === "tipo1") {
    catalogSheetFilters.grupo = "";
    catalogSheetFilters.tipo2 = "";
    catalogSheetFilters.tipo3 = "";
  } else if (fromKey === "grupo") {
    catalogSheetFilters.tipo2 = "";
    catalogSheetFilters.tipo3 = "";
  } else if (fromKey === "tipo2") {
    catalogSheetFilters.tipo3 = "";
  }
}

function bindCatalogSheetRowEvents(container, items) {
  container.querySelectorAll("[data-add-child-category]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const parent = items.find((c) => sameCostId(c.id, btn.dataset.addChildCategory));
      openCostCategoryModal({
        domain: parent?.domain || "GERAL",
        sheetLevel: "SUBCUSTO",
        parentId: btn.dataset.addChildCategory,
      });
    });
  });

  container.querySelectorAll(".cost-catalog-table__row[data-group-key]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (
        e.target.closest(
          "[data-edit-category], [data-delete-category], [data-add-child-category], .cost-catalog-actions"
        )
      )
        return;
      if (catalogMode() === "tipos") return;
      const group = getCatalogGroupByKey(row.dataset.groupKey);
      if (group) openTipo3DrillModal(group);
    });
    row.addEventListener("dblclick", async (e) => {
      if (
        e.target.closest(
          "[data-edit-category], [data-delete-category], [data-add-child-category], .cost-catalog-actions"
        )
      )
        return;
      if (catalogMode() === "tipos") return;
      if (!can("pedidosExtras", "create")) return;
      const group = getCatalogGroupByKey(row.dataset.groupKey);
      if (!group) return;
      const realTipo3 = (group.variants || []).filter((v) => v.tipo3 && v.tipo3 !== "—");
      if (realTipo3.length > 1) {
        openTipo3DrillModal(group);
        showToast("Escolha a subcategoria no modal e use «Pedido extra».", "info");
        return;
      }
      const pickId =
        realTipo3[0]?.pickCategoryId ||
        group.variants?.[0]?.pickCategoryId ||
        group.tipo2Id;
      const domain = group.domain;
      if (domain === "VIATURAS") {
        showToast("Custos de viaturas: em breve no pedido extra. Use filtro por agora.", "info");
        return;
      }
      await openExtraRequestModal({
        type: domain === "OBRA" ? "OBRA" : "GERAL",
        costCategoryId: pickId,
      });
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        row.click();
      }
    });
  });
}

let activeTipo3DrillGroup = null;

function getTipo3VariantsForGroup(group) {
  if (!group) return [];
  const variants = group.variants || [];
  const withTipo3 = variants.filter((v) => v.tipo3 && v.tipo3 !== "—");
  if (withTipo3.length) return withTipo3;
  return variants.length ? variants : [];
}

function openTipo3DrillModal(group) {
  if (!group) return;
  activeTipo3DrillGroup = group;
  const modal = document.getElementById("modalTipo3Drill");
  const title = document.getElementById("tipo3DrillTitle");
  const path = document.getElementById("tipo3DrillPath");
  const meta = document.getElementById("tipo3DrillMeta");
  const list = document.getElementById("tipo3DrillList");
  const addBtn = document.getElementById("btnTipo3DrillAdd");
  if (!modal || !list) return;

  if (title) title.textContent = formatCategoryDisplayName(group.tipo2) || "—";
  if (path) path.textContent = catalogGroupPathLabel(group);
  const variants = getTipo3VariantsForGroup(group);
  const hasRealTipo3 = variants.some((v) => v.tipo3 && v.tipo3 !== "—");
  if (meta) {
    meta.textContent = hasRealTipo3
      ? `${variants.length} subcategoria${variants.length === 1 ? "" : "s"}`
      : "Sem subcategorias — esta categoria é seleccionável directamente";
  }
  if (addBtn) {
    addBtn.classList.toggle("hidden", !canManageCostCatalog());
    addBtn.dataset.tipo2Id = group.tipo2Id || "";
    addBtn.dataset.domain = group.domain || "GERAL";
  }

  const canCreateExtra = can("pedidosExtras", "create");
  list.innerHTML = variants.length
    ? variants
      .map((v) => {
        const label =
          v.tipo3 && v.tipo3 !== "—"
            ? formatCategoryDisplayName(v.tipo3)
            : formatCategoryDisplayName(group.tipo2);
        const badge = v.tipo3 && v.tipo3 !== "—" ? "Subcategoria" : "Categoria (directo)";
        const desc = v.requiresDetailText ? "Descrição obrigatória no pedido" : "Sem descrição extra";
        const selected =
          sameCostId(selectedCostCategoryFilter, v.pickCategoryId)
            ? " cost-catalog-drill-item--selected"
            : "";
        const manage =
          canManageCostCatalog()
            ? `<div class="flex items-center gap-1 shrink-0 cost-catalog-drill-manage">
                  <button type="button" class="cost-catalog-action" data-edit-category="${v.pickCategoryId}" title="Editar">
                    <span class="material-symbols-outlined">edit</span>
                  </button>
                  ${canDeleteCostCatalog()
              ? `<button type="button" class="cost-catalog-action cost-catalog-action--danger" data-delete-category="${v.pickCategoryId}" title="Eliminar">
                          <span class="material-symbols-outlined">delete</span>
                        </button>`
              : ""
            }
                </div>`
            : "";
        const extraBtn = canCreateExtra
          ? `<button type="button" class="cost-catalog-drill-extra h-8 px-2.5 rounded-lg bg-indigo-50 text-indigo-700 text-[11px] font-bold hover:bg-indigo-100 shrink-0 whitespace-nowrap" data-extra-category="${v.pickCategoryId}" data-domain="${group.domain}">Pedido extra</button>`
          : "";
        return `<div role="button" tabindex="0" class="cost-catalog-drill-item${selected} w-full text-left flex flex-nowrap items-center gap-3 px-3 py-3 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/40 transition-all cursor-pointer" data-pick-category="${v.pickCategoryId}">
            <span class="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-lg">subdirectory_arrow_right</span>
            </span>
            <span class="min-w-0 flex-1 overflow-hidden">
              <span class="block text-sm font-bold text-slate-900 truncate">${escapeHtml(label)}</span>
              <span class="block text-[11px] text-slate-500 mt-0.5 truncate">${escapeHtml(badge)} · ${escapeHtml(desc)}</span>
            </span>
            <span class="flex items-center gap-2 shrink-0 ml-auto">
              ${extraBtn}
              ${manage}
            </span>
          </div>`;
      })
      .join("")
    : `<p class="text-sm text-slate-400 text-center py-8">Nenhuma subcategoria. Use «Adicionar subcategoria».</p>`;

  modal.classList.add("open");
  bindTipo3DrillListEvents(list, group);
}

function closeTipo3DrillModal() {
  document.getElementById("modalTipo3Drill")?.classList.remove("open");
  activeTipo3DrillGroup = null;
}

function bindTipo3DrillListEvents(list, group) {
  list.querySelectorAll(".cost-catalog-drill-manage").forEach((wrap) => {
    wrap.addEventListener("click", (e) => e.stopPropagation());
  });
  list.querySelectorAll(".cost-catalog-drill-item[data-pick-category]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-edit-category], [data-delete-category], .cost-catalog-drill-extra")) return;
      const id = row.dataset.pickCategory;
      selectedCostCategoryFilter = sameCostId(selectedCostCategoryFilter, id) ? "" : id;
      const filterEl = document.getElementById("filterCostCategory");
      if (filterEl) filterEl.value = selectedCostCategoryFilter;
      openTipo3DrillModal(group);
      
      
    });
    row.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      row.click();
    });
  });
  list.querySelectorAll(".cost-catalog-drill-extra").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const domain = btn.dataset.domain;
      if (domain === "VIATURAS") {
        showToast("Custos de viaturas: em breve no pedido extra.", "info");
        return;
      }
      closeTipo3DrillModal();
      await openExtraRequestModal({
        type: domain === "OBRA" ? "OBRA" : "GERAL",
        costCategoryId: btn.dataset.extraCategory,
      });
    });
  });
  list.querySelectorAll("[data-edit-category]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCostCategoryModal({
        editId: btn.dataset.editCategory,
        catalogLine: group,
      });
    });
  });
  list.querySelectorAll("[data-delete-category]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCostCategory(btn.dataset.deleteCategory);
    });
  });
}

function bindCatalogActionsMenus(container) {
  if (!container) return;
  container.querySelectorAll(".cost-catalog-actions__btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wrap = btn.closest(".cost-catalog-actions");
      const menu = wrap?.querySelector(".cost-catalog-actions__menu");
      if (!menu) return;
      document.querySelectorAll(".cost-catalog-actions__menu").forEach((m) => {
        if (m !== menu) m.classList.add("hidden");
      });
      menu.classList.toggle("hidden");
    });
  });
}

function canManageCostCatalog() {
  return can("pedidosExtras", "create");
}

function canDeleteCostCatalog() {
  return can("pedidosExtras", "delete");
}

function catalogEstruturaActionsHtml(categoryId) {
  if (!canManageCostCatalog()) return "";
  const del = canDeleteCostCatalog()
    ? `<button type="button" class="cost-catalog-action cost-catalog-action--danger" data-delete-category="${categoryId}" title="Eliminar">
        <span class="material-symbols-outlined">delete</span>
      </button>`
    : "";
  return `<button type="button" class="cost-catalog-action" data-edit-category="${categoryId}" title="Editar">
      <span class="material-symbols-outlined">edit</span>
    </button>${del}`;
}

function catalogRowActionsHtml(g) {
  if (!canManageCostCatalog()) return "";
  const del = canDeleteCostCatalog()
    ? `<button type="button" class="cost-catalog-actions__item cost-catalog-actions__item--danger" data-delete-category="${g.tipo2Id}">Eliminar categoria</button>`
    : "";
  const subActions = catalogMode() === "tipos"
    ? ""
    : `<button type="button" class="cost-catalog-actions__item" data-add-child-category="${g.tipo2Id}">Adicionar subcategoria</button>
        <button type="button" class="cost-catalog-actions__item" data-open-tipo3-drill="${escapeHtml(catalogSheetGroupKey(g))}">Ver subcategorias</button>`;
  return `<div class="cost-catalog-actions relative inline-block text-left">
      <button type="button" class="cost-catalog-actions__btn">Acções <span class="material-symbols-outlined text-sm align-middle">expand_more</span></button>
      <div class="cost-catalog-actions__menu hidden">
        <button type="button" class="cost-catalog-actions__item" data-edit-category="${g.tipo2Id}">Editar categoria</button>
        ${subActions}
        ${del}
      </div>
    </div>`;
}

function applyCatalogManageVisibility() {
  const show = canManageCostCatalog();
  document.getElementById("btnNewCostCategory")?.classList.toggle("hidden", true);
  document.getElementById("costCatalogCrudToolbar")?.classList.toggle("hidden", true);
  document.getElementById("costCatalogNovaWrap")?.classList.toggle("hidden", true);
  const onTipos = activeCostCatalogTab === "tipos";
  const onEstrutura = activeCostCatalogTab === "estrutura";
  document.getElementById("btnCostCatalogNova")?.classList.toggle("hidden", !(show && onTipos));
  document.getElementById("costCatalogEstruturaNova")?.classList.toggle("hidden", !(show && onEstrutura));
  document.getElementById("costCatalogSearch")?.closest(".relative")?.classList.toggle("hidden", onEstrutura);
  updateCatalogBulkDeleteButton();
}
function renderCostCatalogTipos() {
  const container = document.getElementById("costCatalogTipos");
  const meta = document.getElementById("gccSectionMeta");
  const summaryEl = document.getElementById("costCatalogSummary");
  const items = costCategories.length ? costCategories : getCachedCategories();
  const allSheet = getCatalogSheetRows();
  const rows = applySheetFilters(allSheet, { ...catalogSheetFilters, tipo3: "" });
  let displayRows = groupCatalogSheetDisplayRows(rows);
  displayRows = displayRows.filter((g) => catalogGroupMatchesSearch(g, catalogSearchQuery));

  if (meta) {
    meta.textContent = allSheet.length
      ? `${displayRows.length} categoria${displayRows.length === 1 ? "" : "s"} (${allSheet.length} linhas no catálogo)`
      : "Catálogo indisponível";
  }
  if (summaryEl) {
    summaryEl.textContent = displayRows.length
      ? `${displayRows.length} categoria${displayRows.length === 1 ? "" : "s"}`
      : catalogSearchQuery.trim()
        ? "Nenhum resultado"
        : "";
  }
  if (!container) return;

  const canDelete = canDeleteCostCatalog() && catalogDeleteSelectMode;
  const checkHead = catalogSelectAllHeadHtml(displayRows.map((g) => g.tipo2Id));
  const actionsHead = canManageCostCatalog()
    ? `<th class="px-3 py-2.5 text-right w-28">Acções</th>`
    : "";
  const colSpan = (canDelete ? 1 : 0) + 3 + (canManageCostCatalog() ? 1 : 0);

  const bodyRows = displayRows.length
    ? displayRows
      .map((g) => {
        const gkey = catalogSheetGroupKey(g);
        const realTipo3 = (g.variants || []).filter((v) => v.tipo3 && v.tipo3 !== "—");
        const count = realTipo3.length;
        const selected =
          selectedCostCategoryFilter &&
            (g.variants || []).some((v) => sameCostId(v.pickCategoryId, selectedCostCategoryFilter))
            ? " cost-catalog-table__row--selected"
            : "";
        const parentPath = [g.tipo1, g.grupo || null]
          .filter(Boolean)
          .map((part) => formatCategoryDisplayName(part))
          .join(" › ");
        const countLabel =
          count > 0
            ? `${count} subcategoria${count === 1 ? "" : "s"}`
            : "Sem subcategorias";
        const countBadge =
          count > 0
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-bold">${count} subcategoria${count === 1 ? "" : "s"}</span>`
            : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold">Directo</span>`;
        const actions = canManageCostCatalog()
          ? `<td class="px-3 py-2.5 text-right align-middle">${catalogRowActionsHtml(g)}</td>`
          : "";
        return `<tr class="cost-catalog-table__row cost-catalog-table__row--extrato${selected}" data-domain="${g.domain}" data-group-key="${escapeHtml(gkey)}" data-tipo2-id="${g.tipo2Id}" tabindex="0" title="${catalogMode() === "tipos" ? "Categoria" : "Clique para ver subcategorias"}">
            ${catalogCheckboxCellHtml(g.tipo2Id)}
            <td class="px-4 py-3 align-middle">
              <div class="cost-catalog-desc-cell flex items-start gap-3">
                <span class="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 mt-0.5">
                  <span class="material-symbols-outlined text-lg">category</span>
                </span>
                <span class="min-w-0">
                  <span class="inline-flex items-center gap-2">
                    <span class="text-[10px] font-black uppercase tracking-widest text-emerald-700">Categoria</span>
                    ${countBadge}
                  </span>
                  <span class="block text-sm font-bold text-slate-900 mt-0.5">${escapeHtml(formatCategoryDisplayName(g.tipo2))}</span>
                  <span class="block text-xs text-slate-500 mt-0.5">${escapeHtml(parentPath || "—")}</span>
                </span>
              </div>
            </td>
            <td class="px-3 py-3 text-xs font-semibold text-slate-600 align-middle border-l border-slate-100">${escapeHtml(countLabel)}</td>
            <td class="px-3 py-3 align-middle border-l border-slate-100">
              <span class="inline-flex px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 text-[10px] font-bold uppercase">Activo</span>
            </td>
            ${actions}
          </tr>`;
      })
      .join("")
    : `<tr><td colspan="${colSpan}" class="px-4 py-10 text-center text-sm text-slate-400">Nenhuma categoria com estes filtros ou pesquisa.</td></tr>`;

  container.innerHTML = `
    <div class="cost-catalog-extrato-wrap overflow-x-auto border border-slate-200 rounded-xl bg-white">
      <table class="cost-catalog-table cost-catalog-table--extrato w-full text-left">
        <thead>
          <tr class="bg-slate-50 text-[10px] font-black uppercase text-slate-600 border-b border-slate-200">
            ${checkHead}
            <th class="px-4 py-3">Categoria</th>
            <th class="px-3 py-3 border-l border-slate-200 w-40">Subcategoria</th>
            <th class="px-3 py-3 border-l border-slate-200 w-24">Estado</th>
            ${actionsHead}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;

  bindCatalogSheetRowEvents(container, items);
  bindCatalogActionsMenus(container);
  bindCatalogCheckboxEvents(
    container,
    displayRows.map((g) => g.tipo2Id)
  );
  updateCatalogBulkDeleteButton();
}

function setCostCatalogTab(tab) {
  activeCostCatalogTab = tab;
  document.querySelectorAll(".cost-catalog-tab").forEach((btn) => {
    const active = btn.dataset.costTab === tab;
    btn.classList.toggle("bg-slate-900", active);
    btn.classList.toggle("text-white", active);
    btn.classList.toggle("bg-slate-100", !active);
    btn.classList.toggle("text-slate-600", !active);
  });
  document.getElementById("costCatalogTipos")?.classList.toggle("hidden", tab !== "tipos");
  document.getElementById("costCatalogTiposHelp")?.classList.toggle("hidden", tab !== "tipos");
  document.getElementById("costCatalogEstrutura")?.classList.toggle("hidden", tab !== "estrutura");
  document.getElementById("costCatalogEstruturaHelp")?.classList.toggle("hidden", tab !== "estrutura");
  document.getElementById("costCatalogSubcustos")?.classList.toggle("hidden", tab !== "subcustos");
  document.getElementById("costCatalogFilters")?.classList.toggle("hidden", tab === "subcustos");
  renderCatalogFilterBar();
  if (tab === "tipos") renderCostCatalogTipos();
  if (tab === "estrutura") renderEstruturaCatalog();
  if (tab === "subcustos") renderSubcustosCatalog();
  applyCatalogManageVisibility();
}

function renderCostCatalogViews() {
  renderCatalogFilterBar();
  if (activeCostCatalogTab === "tipos") renderCostCatalogTipos();
  if (activeCostCatalogTab === "estrutura") renderEstruturaCatalog();
  if (activeCostCatalogTab === "subcustos") renderSubcustosCatalog();
  fillRegistryAddSelects();
}

function categoriesBySheetLevel(domain, level) {
  return costCategories.filter(
    (c) =>
      c.domain === domain &&
      c.active !== false &&
      classifyCategorySheetLevel(c) === level
  );
}

function populateCostCategoryTipo1Select(domain, selectedId = "") {
  const select = document.getElementById("costCategoryTipo1Id");
  if (!select) return;
  const items = categoriesBySheetLevel(domain, "TIPO1");
  select.innerHTML =
    `<option value="">— Seleccione —</option>` +
    items
      .map(
        (c) =>
          `<option value="${c.id}"${sameCostId(c.id, selectedId) ? " selected" : ""}>${formatCategoryDisplayName(c.name)}</option>`
      )
      .join("");
}

function populateCostCategoryGrupoSelect(domain, tipo1Id, selectedId = "") {
  const select = document.getElementById("costCategoryGrupoId");
  if (!select) return;
  if (!tipo1Id) {
    select.innerHTML = `<option value="">— Directamente sob o centro de custo —</option>`;
    return;
  }
  const grupos = costCategories.filter(
    (c) =>
      c.domain === domain &&
      c.active !== false &&
      sameCostId(c.parentId, tipo1Id) &&
      classifyCategorySheetLevel(c) === "GRUPO"
  );
  select.innerHTML =
    `<option value="">— Directamente sob o centro de custo —</option>` +
    grupos
      .map(
        (c) =>
          `<option value="${c.id}"${sameCostId(c.id, selectedId) ? " selected" : ""}>${formatCategoryDisplayName(c.name)}</option>`
      )
      .join("");
}

function populateCostCategoryTipo2ParentSelect(domain, selectedId = "") {
  const select = document.getElementById("costCategoryParentId");
  if (!select) return;
  const items = costCategories.filter((c) => {
    if (c.domain !== domain || c.active === false) return false;
    const lvl = classifyCategorySheetLevel(c);
    return lvl === "TIPO2" || (domain !== "GERAL" && !c.parentId && lvl === "TIPO2");
  });
  const opts = items
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt"))
    .map((c) => {
      const path = buildCategoryPath(c.id, costCategories);
      return `<option value="${c.id}"${sameCostId(c.id, selectedId) ? " selected" : ""}>${path || formatCategoryDisplayName(c.name)}</option>`;
    })
    .join("");
  select.innerHTML = `<option value="">— Seleccione a categoria —</option>${opts}`;
}

function syncCostCategoryFormForLevel() {
  const level = document.getElementById("costCategorySheetLevel")?.value || "TIPO2";
  const editId = document.getElementById("costCategoryEditId")?.value;
  if (!editId) {
    const domain =
      level === "TIPO1" || level === "GRUPO" ? "GERAL" : inferDomainFromCatalogContext();
    setCostCategoryDomainValue(domain);
  }
  const domain = getCostCategoryDomainValue();
  const showTipo1GrupoForSub = level === "SUBCUSTO" && domain === "GERAL" && Boolean(editId);

  document.getElementById("rowCostCategoryTipo1")?.classList.toggle(
    "hidden",
    !showTipo1GrupoForSub && level !== "GRUPO" && level !== "TIPO2"
  );
  document.getElementById("rowCostCategoryGrupo")?.classList.toggle(
    "hidden",
    !showTipo1GrupoForSub && (level !== "TIPO2" || domain !== "GERAL")
  );
  document.getElementById("rowCostCategoryParent")?.classList.toggle("hidden", level !== "SUBCUSTO");
  document.getElementById("rowCostCategorySelectable")?.classList.toggle("hidden", level === "TIPO1" || level === "GRUPO");

  const tipo1Sel = document.getElementById("costCategoryTipo1Id");
  const grupoSel = document.getElementById("costCategoryGrupoId");
  if (tipo1Sel) tipo1Sel.disabled = showTipo1GrupoForSub;
  if (grupoSel) grupoSel.disabled = showTipo1GrupoForSub;

  if (level === "GRUPO" || (level === "TIPO2" && domain === "GERAL") || showTipo1GrupoForSub) {
    populateCostCategoryTipo1Select(domain, tipo1Sel?.value);
  }
  if ((level === "TIPO2" && domain === "GERAL") || showTipo1GrupoForSub) {
    const t1 = tipo1Sel?.value;
    populateCostCategoryGrupoSelect(domain, t1, grupoSel?.value);
  }
  if (level === "SUBCUSTO") {
    populateCostCategoryTipo2ParentSelect(domain, document.getElementById("costCategoryParentId")?.value);
  }

  const showBatch = level === "SUBCUSTO" && !editId;
  document.getElementById("rowCostCategoryBatch")?.classList.toggle("hidden", !showBatch);
  if (!showBatch) clearCostCategoryBatchLines();
  setCostCategoryModalTitles({ editId: editId || "", sheetLevel: level });
}

function resolveCostCategoryParentIdForSubmit(sheetLevel, domain) {
  if (sheetLevel === "TIPO1") return null;
  if (sheetLevel === "GRUPO") {
    return document.getElementById("costCategoryTipo1Id")?.value || null;
  }
  if (sheetLevel === "TIPO2") {
    if (domain === "GERAL") {
      const g = document.getElementById("costCategoryGrupoId")?.value;
      const t1 = document.getElementById("costCategoryTipo1Id")?.value;
      return g || t1 || null;
    }
    return null;
  }
  if (sheetLevel === "SUBCUSTO") {
    return document.getElementById("costCategoryParentId")?.value || null;
  }
  return null;
}

function getCatalogGroupByKey(gkey) {
  if (!gkey) return null;
  const all = groupCatalogSheetDisplayRows(getCatalogSheetRows());
  const hit = all.find((g) => catalogSheetGroupKey(g) === gkey);
  if (hit) return hit;
  const filtered = applySheetFilters(getCatalogSheetRows(), catalogSheetFilters);
  return groupCatalogSheetDisplayRows(filtered).find((g) => catalogSheetGroupKey(g) === gkey) || null;
}

function refreshTipo3DrillIfOpen() {
  if (!activeTipo3DrillGroup) return;
  const gkey = catalogSheetGroupKey(activeTipo3DrillGroup);
  const fresh = getCatalogGroupByKey(gkey);
  if (fresh) openTipo3DrillModal(fresh);
  else closeTipo3DrillModal();
}

function catalogLineEditTargets(group) {
  if (!group) return [];
  const seen = new Set();
  const targets = [];
  const push = (id, label) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    targets.push({ id, label });
  };
  push(group.tipo2Id, `Categoria — ${formatCategoryDisplayName(group.tipo2)}`);
  for (const v of group.variants || []) {
    if (v.tipo3 && v.tipo3 !== "—") {
      push(v.pickCategoryId, `Subcategoria — ${formatCategoryDisplayName(v.tipo3)}`);
    }
  }
  return targets;
}

function populateCatalogLineContextUI(group, activeEditId) {
  const block = document.getElementById("rowCostCategoryLineContext");
  const bc = document.getElementById("costCategoryLineBreadcrumb");
  const sel = document.getElementById("costCategoryLineTarget");
  if (!block || !group) {
    block?.classList.add("hidden");
    return;
  }
  activeCatalogLineForModal = group;
  block.classList.remove("hidden");
  const parts = [group.tipo1, group.grupo || null, group.tipo2]
    .filter(Boolean)
    .map((part) => formatCategoryDisplayName(part));
  if (bc) bc.textContent = parts.join(" › ");
  const targets = catalogLineEditTargets(group);
  if (sel) {
    sel.innerHTML = targets
      .map(
        (t) =>
          `<option value="${t.id}"${sameCostId(t.id, activeEditId) ? " selected" : ""}>${escapeHtml(t.label)}</option>`
      )
      .join("");
    sel.disabled = targets.length <= 1;
  }
}

function hideCatalogLineContextUI() {
  activeCatalogLineForModal = null;
  document.getElementById("rowCostCategoryLineContext")?.classList.add("hidden");
}

function resolveParentFieldIds(item, level) {
  const out = { tipo1Id: "", grupoId: "", parentId: "" };
  if (!item) return out;
  if (level === "GRUPO" && item.parentId) {
    out.tipo1Id = costIdKey(item.parentId);
  }
  if (level === "TIPO2" && item.domain === "GERAL" && item.parentId) {
    const parent = costCategories.find((c) => sameCostId(c.id, item.parentId));
    if (parent && classifyCategorySheetLevel(parent) === "GRUPO") {
      out.grupoId = costIdKey(parent.id);
      out.tipo1Id = costIdKey(parent.parentId || "");
    } else if (parent) {
      out.tipo1Id = costIdKey(parent.id);
    }
  }
  if (level === "SUBCUSTO" && item.parentId) {
    out.parentId = costIdKey(item.parentId);
    if (item.domain === "GERAL") {
      const tipo2 = costCategories.find((c) => sameCostId(c.id, item.parentId));
      if (tipo2?.parentId) {
        const p = costCategories.find((c) => sameCostId(c.id, tipo2.parentId));
        if (p && classifyCategorySheetLevel(p) === "GRUPO") {
          out.tipo1Id = costIdKey(p.parentId || "");
          out.grupoId = costIdKey(p.id);
        } else if (p) {
          out.tipo1Id = costIdKey(p.id);
        }
      }
    }
  }
  return out;
}

function fillCostCategoryParentFields(item, level) {
  if (!item) return;
  const parents = resolveParentFieldIds(item, level);
  const domain = item.domain || getCostCategoryDomainValue();

  if (level === "GRUPO" || (level === "TIPO2" && domain === "GERAL") || level === "SUBCUSTO") {
    populateCostCategoryTipo1Select(domain, parents.tipo1Id);
  }
  if ((level === "TIPO2" && domain === "GERAL") || level === "SUBCUSTO") {
    populateCostCategoryGrupoSelect(domain, parents.tipo1Id, parents.grupoId);
  }
  if (level === "SUBCUSTO") {
    populateCostCategoryTipo2ParentSelect(domain, parents.parentId);
  }
}

function loadCostCategoryEditFields(item) {
  if (!item) return;
  const level = classifyCategorySheetLevel(item);
  document.getElementById("costCategoryEditId").value = costIdKey(item.id);
  setCostCategoryDomainValue(item.domain);
  document.getElementById("costCategorySheetLevel").value = level;
  document.getElementById("costCategoryName").value = formatCategoryDisplayName(item.name);
  document.getElementById("costCategorySelectable").checked = item.isSelectable !== false;
  document.getElementById("costCategoryRequiresDetail").checked = Boolean(item.requiresDetailText);
  document.getElementById("costCategorySortOrder").value = item.sortOrder ?? "";
  setCostCategoryModalTitles({ editId: item.id, sheetLevel: level });
  // Visibilidade das linhas primeiro; depois preencher selects com o pai correcto
  syncCostCategoryFormForLevel();
  fillCostCategoryParentFields(item, level);
}

function renderEstruturaCatalog() {
  const container = document.getElementById("estruturaCatalog");
  if (!container) return;
  const domain = "GERAL";
  const tipo1s = categoriesBySheetLevel(domain, "TIPO1");
  const grupos = categoriesBySheetLevel(domain, "GRUPO");
  const canDelete = canDeleteCostCatalog() && catalogDeleteSelectMode;
  const canManage = canManageCostCatalog();
  const actionsHead = canManage
    ? `<th class="px-3 py-2.5 text-center w-36">Acções</th>`
    : "";

  const visibleIds = [];
  tipo1s.forEach((t1) => {
    visibleIds.push(t1.id);
    grupos.filter((g) => sameCostId(g.parentId, t1.id)).forEach((g) => visibleIds.push(g.id));
  });
  const checkHead = catalogSelectAllHeadHtml(visibleIds);
  const colSpan = (canDelete ? 1 : 0) + 2 + (canManage ? 1 : 0);

  const body = tipo1s.length
    ? tipo1s
      .map((t1) => {
        const kids = grupos
          .filter((g) => sameCostId(g.parentId, t1.id))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt"));
        const gruposHtml = kids.length
          ? `<ul class="cost-catalog-grupos-list space-y-1.5 m-0 p-0 list-none">
                ${kids
            .map((g) => {
              const check =
                canDelete
                  ? `<input type="checkbox" class="cost-catalog-check h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0" data-catalog-check="${costIdKey(g.id)}"${catalogDeleteSelectionHas(g.id) ? " checked" : ""
                  } aria-label="Seleccionar grupo">`
                  : "";
              const gActions = canManage
                ? `<span class="inline-flex items-center gap-0.5 shrink-0">
                          <button type="button" class="cost-catalog-action" data-edit-category="${g.id}" title="Editar grupo">
                            <span class="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                          ${canDeleteCostCatalog()
                  ? `<button type="button" class="cost-catalog-action cost-catalog-action--danger" data-delete-category="${g.id}" title="Eliminar grupo">
                                  <span class="material-symbols-outlined text-[16px]">delete</span>
                                </button>`
                  : ""
                }
                        </span>`
                : "";
              return `<li class="flex items-center gap-2 min-w-0">
                      ${check}
                      <span class="inline-flex items-center gap-1.5 min-w-0 flex-1 px-2 py-1 rounded-md bg-slate-50 border border-slate-100">
                        <span class="text-[12px] font-semibold text-slate-800 truncate">${formatCategoryDisplayName(g.name)}</span>
                        ${gActions}
                      </span>
                    </li>`;
            })
            .join("")}
              </ul>`
          : `<span class="text-[11px] text-slate-400">Sem grupo (opcional)</span>`;
        const addGrupo = canManage
          ? `<button type="button" class="mt-2 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-0.5" data-add-grupo-under="${t1.id}">
                <span class="material-symbols-outlined text-sm">add</span>
                Adicionar grupo
              </button>`
          : "";
        const actions = canManage
          ? `<td class="px-3 py-2.5 text-center align-top">${catalogEstruturaActionsHtml(t1.id)}</td>`
          : "";
        return `<tr class="cost-catalog-table__row" data-pick-category="${t1.id}">
            ${catalogCheckboxCellHtml(t1.id)}
            <td class="px-3 py-2.5 align-top">
              <span class="block text-sm font-bold text-slate-900">${formatCategoryDisplayName(t1.name)}</span>
            </td>
            <td class="px-3 py-2.5 align-top border-l border-slate-100">
              ${gruposHtml}
              ${addGrupo}
            </td>
            ${actions}
          </tr>`;
      })
      .join("")
    : `<tr><td colspan="${colSpan}" class="px-4 py-8 text-center text-xs text-slate-400">Sem centros de custo. Use «Centro custo» acima; o grupo é opcional e fica dentro de cada centro.</td></tr>`;

  container.innerHTML = `
    <div class="overflow-x-auto border border-slate-200 rounded-lg">
      <table class="cost-catalog-table cost-catalog-table--sheet w-full text-left">
        <thead>
          <tr class="bg-slate-200/90 text-[10px] font-black uppercase text-slate-700">
            ${checkHead}
            <th class="px-3 py-2.5">Centro custo</th>
            <th class="px-3 py-2.5">Grupos <span class="font-semibold normal-case text-slate-500">(opcional)</span></th>
            ${actionsHead}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  bindCatalogCheckboxEvents(container, visibleIds);
  container.querySelectorAll("[data-add-grupo-under]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCostCategoryModal({
        domain: "GERAL",
        sheetLevel: "GRUPO",
        tipo1Id: btn.dataset.addGrupoUnder,
      });
    });
  });
  updateCatalogBulkDeleteButton();
}

function openCostCategoryModal({
  editId = "",
  domain = "GERAL",
  sheetLevel = "TIPO2",
  parentId = "",
  tipo1Id = "",
  grupoId = "",
  catalogLine = null,
} = {}) {
  document.getElementById("formCostCategory").reset();
  hideCatalogLineContextUI();
  clearCostCategoryBatchLines();
  document.getElementById("costCategoryEditId").value = "";
  document.getElementById("costCategorySheetLevel").disabled = true;
  document.getElementById("costCategoryTipo1Id").disabled = false;
  document.getElementById("costCategoryGrupoId").disabled = false;

  if (editId) {
    document.getElementById("costCategoryEditId").value = costIdKey(editId);
    const item = costCategories.find((c) => sameCostId(c.id, editId));
    if (item) {
      loadCostCategoryEditFields(item);
      if (catalogLine) populateCatalogLineContextUI(catalogLine, editId);
      else {
        const path = buildCategoryPath(editId, costCategories);
        if (path) {
          activeCatalogLineForModal = null;
          const block = document.getElementById("rowCostCategoryLineContext");
          const bc = document.getElementById("costCategoryLineBreadcrumb");
          block?.classList.remove("hidden");
          if (bc) bc.textContent = path;
          document.getElementById("costCategoryLineTarget")?.classList.add("hidden");
          document.querySelector("#rowCostCategoryLineContext label[for='costCategoryLineTarget']")?.classList.add("hidden");
        }
      }
    } else {
      showToast("Registo não encontrado. A recarregar catálogo…", "error");
      reloadCostCatalog();
      return;
    }
  } else {
    setCostCategoryDomainValue(domain);
    document.getElementById("costCategorySheetLevel").value = sheetLevel;
    if (parentId) document.getElementById("costCategoryParentId").value = costIdKey(parentId);
    if (tipo1Id) document.getElementById("costCategoryTipo1Id").value = costIdKey(tipo1Id);
    if (grupoId) document.getElementById("costCategoryGrupoId").value = costIdKey(grupoId);
    syncCostCategoryFormForLevel();
  }

  document.getElementById("modalCostCategory").classList.add("open");
}

function closeCostCategoryModal() {
  document.getElementById("modalCostCategory")?.classList.remove("open");
  document.getElementById("costCategorySheetLevel").disabled = false;
  document.getElementById("costCategoryTipo1Id").disabled = false;
  document.getElementById("costCategoryGrupoId").disabled = false;
  document.getElementById("costCategoryLineTarget")?.classList.remove("hidden");
  document
    .querySelector("#rowCostCategoryLineContext label[for='costCategoryLineTarget']")
    ?.classList.remove("hidden");
  hideCatalogLineContextUI();
}

async function submitCostCategory(e) {
  e.preventDefault();
  const editId = (document.getElementById("costCategoryEditId").value || "").trim();
  const domain = getCostCategoryDomainValue();
  const sheetLevel = document.getElementById("costCategorySheetLevel").value;
  const name = formatCategoryDisplayName(document.getElementById("costCategoryName").value);
  const isSelectable = document.getElementById("costCategorySelectable").checked;
  const requiresDetailText = document.getElementById("costCategoryRequiresDetail").checked;
  const sortRaw = document.getElementById("costCategorySortOrder").value;
  const sortOrder = sortRaw === "" ? undefined : Number(sortRaw);
  const parentId = resolveCostCategoryParentIdForSubmit(sheetLevel, domain);

  if (!name) {
    showToast("Indique o nome", "error");
    return;
  }
  if (name.length < 2) {
    showToast("O nome deve ter pelo menos 2 caracteres", "error");
    return;
  }
  if (!editId && sheetLevel !== "TIPO1" && sheetLevel !== "TIPO2" && !parentId) {
    showToast("Seleccione o registo pai", "error");
    return;
  }
  if (!editId && sheetLevel === "TIPO2" && domain === "GERAL" && !parentId) {
    showToast("Seleccione o centro de custo ou o grupo", "error");
    return;
  }
  if (editId && sheetLevel === "GRUPO" && !parentId) {
    showToast("Seleccione o centro de custo", "error");
    return;
  }
  if (editId && sheetLevel === "SUBCUSTO" && !parentId) {
    showToast("Seleccione a categoria", "error");
    return;
  }
  if (editId && sheetLevel === "TIPO2" && domain === "GERAL" && !parentId) {
    showToast("Seleccione o centro de custo ou o grupo", "error");
    return;
  }

  try {
    if (editId) {
      const body = {
        name,
        isSelectable,
        requiresDetailText,
        ...(sortOrder !== undefined && !Number.isNaN(sortOrder) ? { sortOrder } : {}),
      };
      const canReparent =
        sheetLevel === "GRUPO" ||
        sheetLevel === "SUBCUSTO" ||
        (sheetLevel === "TIPO2" && domain === "GERAL");
      if (canReparent) body.parentId = parentId;
      await apiRequest(`/cost-categories/${editId}`, {
        method: "PATCH",
        body,
      });
      showToast("Entrada actualizada", "success");
    } else {
      const postPayload = (entryName) => ({
        domain,
        parentId,
        name: entryName,
        sheetLevel,
        isSelectable: sheetLevel === "TIPO1" || sheetLevel === "GRUPO" ? false : isSelectable,
        requiresDetailText,
        ...(sortOrder !== undefined && !Number.isNaN(sortOrder) ? { sortOrder } : {}),
      });
      const batchNames = collectCostCategoryBatchNames();
      const created = await apiRequest("/cost-categories", {
        method: "POST",
        body: postPayload(name),
      });
      for (const extraName of batchNames) {
        await apiRequest("/cost-categories", { method: "POST", body: postPayload(extraName) });
      }
      const total = 1 + batchNames.length;
      showToast(total > 1 ? `${total} entradas criadas` : "Entrada criada", "success");
      closeCostCategoryModal();
      await reloadCostCatalog();
      focusCreatedCatalogItem(created?.id);
      return;
    }
    closeCostCategoryModal();
    await reloadCostCatalog();
  } catch (err) {
    const msg =
      err?.data?.message ||
      ({
        PARENT_TIPO1_REQUIRED: "Seleccione o centro de custo.",
        PARENT_TIPO2_REQUIRED: "Seleccione a categoria.",
        COST_CATEGORY_DUPLICATE_NAME: "Já existe um tipo com este nome neste nível.",
      }[err?.data?.error] ||
        err?.data?.message ||
        err.message ||
        "Erro ao guardar");
    showToast(msg, "error");
  }
}

async function deleteCostCategory(id) {
  const item = costCategories.find((c) => sameCostId(c.id, id));
  const label = item ? formatCategoryDisplayName(item.name) : "esta entrada";
  if (!confirm(`Eliminar ou desactivar «${label}»?`)) return;
  try {
    const res = await apiRequest(`/cost-categories/${id}`, { method: "DELETE" });
    if (res.softDeleted) {
      showToast("Desactivada (existem pedidos que a usam)", "info");
    } else {
      showToast("Eliminada", "success");
    }
    if (sameCostId(selectedCostCategoryFilter, id)) {
      selectedCostCategoryFilter = "";
      const filterEl = document.getElementById("filterCostCategory");
      if (filterEl) filterEl.value = "";
    }
    selectedCatalogDeleteIds.delete(costIdKey(id));
    await reloadCostCatalog();
    
  } catch (err) {
    showToast(err?.data?.message || err.message || "Não foi possível eliminar", "error");
  }
}

async function deleteSelectedCostCategories() {
  const ids = [...selectedCatalogDeleteIds].map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return;
  if (
    !confirm(
      `Eliminar ${ids.length} tipo${ids.length === 1 ? "" : "s"} de custo seleccionado${ids.length === 1 ? "" : "s"}?\n\nTambém serão removidos os subníveis (filhos). Entradas usadas em pedidos serão só desactivadas.`
    )
  ) {
    return;
  }
  try {
    const res = await apiRequest("/cost-categories/bulk-delete", {
      method: "POST",
      body: { ids },
    });
    const parts = [];
    if (res.deleted) parts.push(`${res.deleted} eliminado${res.deleted === 1 ? "" : "s"}`);
    if (res.softDeleted) {
      parts.push(`${res.softDeleted} desactivado${res.softDeleted === 1 ? "" : "s"}`);
    }
    showToast(parts.length ? parts.join(" · ") : "Nada a eliminar", parts.length ? "success" : "info");
    if (
      selectedCostCategoryFilter &&
      ids.some((id) => sameCostId(id, selectedCostCategoryFilter))
    ) {
      selectedCostCategoryFilter = "";
      const filterEl = document.getElementById("filterCostCategory");
      if (filterEl) filterEl.value = "";
    }
    clearCatalogDeleteSelection();
    catalogDeleteSelectMode = false;
    updateCatalogBulkDeleteButton();
    await reloadCostCatalog();
    
  } catch (err) {
    showToast(err?.data?.message || err.message || "Não foi possível eliminar em massa", "error");
  }
}

async function reloadCostCatalog() {
  costCategories = await loadAllCostCategories("", { includeInactive: true });
  const valid = new Set(costCategories.map((c) => costIdKey(c.id)));
  selectedCatalogDeleteIds = new Set(
    [...selectedCatalogDeleteIds].filter((id) => valid.has(id))
  );
  populateCostCategoryFilter();
  renderCostCatalogViews();
  refreshTipo3DrillIfOpen();
  updateCatalogBulkDeleteButton();
}

function sheetRowPresetsForCatalogFilters(sheetLevel) {
  const sheet = getCatalogSheetRows();
  const presets = {};
  if (catalogSheetFilters.tipo1) {
    const rowT1 = sheet.find((r) => r.tipo1 === catalogSheetFilters.tipo1);
    if (rowT1?.tipo1CategoryId) presets.tipo1Id = rowT1.tipo1CategoryId;
  }
  if (
    catalogSheetFilters.grupo &&
    catalogSheetFilters.grupo !== "__EMPTY__" &&
    (sheetLevel === "TIPO2" || sheetLevel === "GRUPO")
  ) {
    const rowG = sheet.find(
      (r) => r.tipo1 === catalogSheetFilters.tipo1 && r.grupo === catalogSheetFilters.grupo
    );
    if (rowG?.grupoCategoryId) presets.grupoId = rowG.grupoCategoryId;
  }
  if (sheetLevel === "SUBCUSTO" && catalogSheetFilters.tipo2) {
    const row2 = sheet.find(
      (r) =>
        (!catalogSheetFilters.tipo1 || r.tipo1 === catalogSheetFilters.tipo1) &&
        r.tipo2 === catalogSheetFilters.tipo2
    );
    if (row2?.tipo2Id) presets.parentId = row2.tipo2Id;
  }
  return presets;
}

function bindCatalogCrudEvents() {
  document.querySelectorAll("[data-add-sheet-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sheetLevel = btn.dataset.addSheetLevel;
      const domain =
        sheetLevel === "TIPO1" || sheetLevel === "GRUPO" ? "GERAL" : inferDomainFromCatalogContext();
      const presets = { domain, sheetLevel, ...sheetRowPresetsForCatalogFilters(sheetLevel) };
      openCostCategoryModal(presets);
    });
  });

  const search = document.getElementById("costCatalogSearch");
  if (search) {
    search.autocomplete = "off";
    search.value = "";
    catalogSearchQuery = "";
    search.addEventListener("input", (e) => {
      catalogSearchQuery = e.target.value || "";
      renderCostCatalogViews();
    });
  }

  document.getElementById("btnCostCatalogSelectDelete")?.addEventListener("click", () => {
    setCatalogDeleteSelectMode(true);
  });
  document.getElementById("btnCostCatalogCancelSelect")?.addEventListener("click", () => {
    setCatalogDeleteSelectMode(false);
  });
  document.getElementById("btnCostCatalogBulkDelete")?.addEventListener("click", () => {
    deleteSelectedCostCategories();
  });

  document.getElementById("btnAddCostCategoryBatchLine")?.addEventListener("click", () => {
    addCostCategoryBatchLine();
  });

  document.getElementById("formCostCategory")?.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".cost-catalog-batch-remove");
    if (removeBtn) removeBtn.closest(".cost-catalog-batch-line")?.remove();
  });

  document.getElementById("btnCloseTipo3Drill")?.addEventListener("click", closeTipo3DrillModal);
  document.getElementById("btnCancelTipo3Drill")?.addEventListener("click", closeTipo3DrillModal);
  document.getElementById("btnTipo3DrillAdd")?.addEventListener("click", () => {
    const btn = document.getElementById("btnTipo3DrillAdd");
    openCostCategoryModal({
      domain: btn?.dataset.domain || "GERAL",
      sheetLevel: "SUBCUSTO",
      parentId: btn?.dataset.tipo2Id || "",
    });
  });
  document.getElementById("modalTipo3Drill")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeTipo3DrillModal();
  });

  document.getElementById("formCostCategory")?.addEventListener("submit", submitCostCategory);
  document.getElementById("btnCloseCostCategoryModal")?.addEventListener("click", closeCostCategoryModal);
  document.getElementById("btnCancelCostCategory")?.addEventListener("click", closeCostCategoryModal);
  document.getElementById("costCategorySheetLevel")?.addEventListener("change", syncCostCategoryFormForLevel);
  document.getElementById("costCategoryTipo1Id")?.addEventListener("change", () => {
    const domain = getCostCategoryDomainValue();
    populateCostCategoryGrupoSelect(domain, document.getElementById("costCategoryTipo1Id").value);
  });
  document.getElementById("costCategoryLineTarget")?.addEventListener("change", () => {
    const id = document.getElementById("costCategoryLineTarget")?.value;
    if (!id) return;
    const item = costCategories.find((c) => sameCostId(c.id, id));
    if (item) loadCostCategoryEditFields(item);
  });

  document.getElementById("costCatalogRoot")?.addEventListener("change", (e) => {
    const sel = e.target.closest(".cost-sheet-filter");
    if (!sel) return;
    const cascadeFrom = {
      filterSheetTipo1: "tipo1",
      filterSheetGrupo: "grupo",
      filterSheetTipo2: "tipo2",
    }[sel.id];
    if (!cascadeFrom) return;
    readCatalogSheetFiltersFromDom();
    resetCatalogSheetFiltersCascade(cascadeFrom);
    renderCostCatalogViews();
  });

  document.getElementById("costCatalogRoot")?.addEventListener("click", (e) => {
    if (!e.target.closest(".cost-catalog-actions")) {
      document.querySelectorAll(".cost-catalog-actions__menu").forEach((m) => m.classList.add("hidden"));
    }
    if (e.target.closest("#btnClearSheetFilters")) {
      catalogSheetFilters = { tipo1: "", grupo: "", tipo2: "", tipo3: "" };
      renderCostCatalogViews();
      return;
    }
    const openDrill = e.target.closest("[data-open-tipo3-drill]");
    if (openDrill) {
      e.stopPropagation();
      e.preventDefault();
      const group = getCatalogGroupByKey(openDrill.dataset.openTipo3Drill);
      if (group) openTipo3DrillModal(group);
      return;
    }
    const editBtn = e.target.closest("[data-edit-category]");
    if (editBtn) {
      e.stopPropagation();
      e.preventDefault();
      const row = editBtn.closest("tr[data-group-key]");
      const catalogLine = row?.dataset.groupKey ? getCatalogGroupByKey(row.dataset.groupKey) : null;
      openCostCategoryModal({
        editId: editBtn.dataset.editCategory,
        catalogLine,
      });
      return;
    }
    const delBtn = e.target.closest("[data-delete-category]");
    if (delBtn) {
      e.stopPropagation();
      e.preventDefault();
      deleteCostCategory(delBtn.dataset.deleteCategory);
    }
  });
}

function catalogMode() {
  const mode = document.body.dataset.costCatalog;
  if (mode === "estrutura" || mode === "subcustos") return mode;
  return "tipos";
}

function optionList(items, placeholder, selected = "") {
  const opts = items
    .map((item) => {
      const value = item.id;
      const label = item.label || formatCategoryDisplayName(item.name);
      return `<option value="${value}"${sameCostId(value, selected) ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return `<option value="">${escapeHtml(placeholder)}</option>${opts}`;
}

function fillRegistryAddSelects() {
  const form = document.getElementById("registryCostAdd");
  if (!form) return;
  const tipo1 = form.querySelector("[name=tipo1]");
  const grupo = form.querySelector("[name=grupo]");
  const parent = form.querySelector("[name=parent]");
  if (tipo1) {
    const current = tipo1.value;
    tipo1.innerHTML = optionList(categoriesBySheetLevel("GERAL", "TIPO1"), "Sem centro de custo", current);
  }
  if (grupo) {
    const parentId = tipo1?.value || "";
    const grupos = parentId
      ? costCategories.filter(
        (item) =>
          item.active !== false &&
          classifyCategorySheetLevel(item) === "GRUPO" &&
          sameCostId(item.parentId, parentId)
      )
      : [];
    grupo.innerHTML = optionList(grupos, "Grupo opcional", grupo.value);
    grupo.disabled = !parentId;
  }
  if (parent) {
    const categorias = costCategories
      .filter((item) => item.active !== false && classifyCategorySheetLevel(item) === "TIPO2")
      .map((item) => ({
        id: item.id,
        label: buildCategoryPath(item.id, costCategories) || formatCategoryDisplayName(item.name),
      }));
    parent.innerHTML = optionList(categorias, "Seleccionar categoria", parent.value);
  }
}

function mountRegistryAddForm() {
  if (document.getElementById("registryCostAdd")) return;
  const mode = catalogMode();
  const form = document.createElement("form");
  form.id = "registryCostAdd";
  form.className = "mb-6 rounded-2xl border border-slate-200 bg-white p-4 flex flex-col gap-3";
  const field = "mt-1 w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-800";
  if (mode === "estrutura") {
    form.innerHTML = `
      <p class="text-[11px] font-black uppercase tracking-widest text-slate-500">Adicionar tipo de custo</p>
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex-1 min-w-[220px] text-xs font-bold text-slate-500 uppercase tracking-widest">Nome
          <input name="nome" required minlength="2" maxlength="120" class="${field}" placeholder="Nome do tipo">
        </label>
        <button type="submit" class="h-10 px-4 rounded-lg bg-slate-900 text-white text-xs font-bold">Adicionar tipo</button>
      </div>`;
  } else if (mode === "subcustos") {
    form.innerHTML = `
      <p class="text-[11px] font-black uppercase tracking-widest text-slate-500">Adicionar subcategoria</p>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs font-bold text-slate-500 uppercase tracking-widest">Categoria
          <select name="parent" required class="${field}"></select>
        </label>
        <label class="text-xs font-bold text-slate-500 uppercase tracking-widest">Nome
          <input name="nome" required minlength="2" maxlength="120" class="${field}" placeholder="Nome da subcategoria">
        </label>
      </div>
      <div class="flex justify-end">
        <button type="submit" class="h-10 px-4 rounded-lg bg-slate-900 text-white text-xs font-bold">Adicionar subcategoria</button>
      </div>`;
  } else {
    form.innerHTML = `
      <p class="text-[11px] font-black uppercase tracking-widest text-slate-500">Adicionar categoria</p>
      <div class="grid gap-3 sm:grid-cols-3">
        <label class="text-xs font-bold text-slate-500 uppercase tracking-widest">Centro de custo
          <select name="tipo1" class="${field}"></select>
        </label>
        <label class="text-xs font-bold text-slate-500 uppercase tracking-widest">Grupo
          <select name="grupo" class="${field}"></select>
        </label>
        <label class="text-xs font-bold text-slate-500 uppercase tracking-widest">Nome
          <input name="nome" required minlength="2" maxlength="120" class="${field}" placeholder="Nome da categoria">
        </label>
      </div>
      <p class="text-[11px] text-slate-400">Sem centro de custo, a categoria fica em custos de obra.</p>
      <div class="flex justify-end">
        <button type="submit" class="h-10 px-4 rounded-lg bg-slate-900 text-white text-xs font-bold">Adicionar categoria</button>
      </div>`;
  }
  document.getElementById("costCatalogToolbar")?.before(form);
  form.addEventListener("submit", submitRegistryAdd);
  form.querySelector("[name=tipo1]")?.addEventListener("change", fillRegistryAddSelects);
}

async function submitRegistryAdd(event) {
  event.preventDefault();
  if (!canManageCostCatalog()) {
    showToast("Sem permissão para criar este registo.", "error");
    return;
  }
  const form = event.currentTarget;
  const name = formatCategoryDisplayName(form.nome.value);
  if (!name || name.length < 2) {
    showToast("Indique o nome.", "error");
    return;
  }
  const mode = catalogMode();
  let body;
  if (mode === "estrutura") {
    body = { domain: "GERAL", sheetLevel: "TIPO1", name, parentId: null, isSelectable: false, requiresDetailText: false };
  } else if (mode === "subcustos") {
    const parentId = Number(form.parent.value);
    const parent = costCategories.find((item) => sameCostId(item.id, parentId));
    if (!parent) {
      showToast("Seleccione a categoria.", "error");
      return;
    }
    body = {
      domain: parent.domain || "GERAL",
      sheetLevel: "SUBCUSTO",
      name,
      parentId,
      isSelectable: true,
      requiresDetailText: false,
    };
  } else {
    const grupo = form.grupo?.value || "";
    const tipo1 = form.tipo1?.value || "";
    body = grupo || tipo1
      ? { domain: "GERAL", sheetLevel: "TIPO2", name, parentId: Number(grupo || tipo1), isSelectable: true, requiresDetailText: false }
      : { domain: "OBRA", sheetLevel: "TIPO2", name, parentId: null, isSelectable: true, requiresDetailText: false };
  }
  const button = form.querySelector("[type=submit]");
  if (button) button.disabled = true;
  try {
    await apiRequest("/cost-categories", { method: "POST", body });
    showToast("Registo criado.", "success");
    form.nome.value = "";
    await reloadCostCatalog();
  } catch (err) {
    showToast(err?.data?.message || err.message || "Não foi possível guardar.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function renderSubcustosCatalog() {
  let container = document.getElementById("costCatalogSubcustos");
  if (!container) {
    container = document.createElement("div");
    container.id = "costCatalogSubcustos";
    document.getElementById("costCatalogEstrutura")?.after(container);
  }
  const query = catalogSearchQuery.trim().toLocaleLowerCase("pt-PT");
  const rows = costCategories
    .filter((item) => item.active !== false && classifyCategorySheetLevel(item) === "SUBCUSTO")
    .map((item) => {
      const parent = costCategories.find((entry) => sameCostId(entry.id, item.parentId));
      return { item, parent };
    })
    .filter(({ item, parent }) => {
      if (!query) return true;
      return `${item.name} ${parent?.name || ""}`.toLocaleLowerCase("pt-PT").includes(query);
    })
    .sort((a, b) => a.item.name.localeCompare(b.item.name, "pt"));

  const summaryEl = document.getElementById("costCatalogSummary");
  if (summaryEl) {
    summaryEl.textContent = rows.length
      ? `${rows.length} subcategoria${rows.length === 1 ? "" : "s"}`
      : query
        ? "Nenhum resultado"
        : "";
  }
  const body = rows.length
    ? rows.map(({ item, parent }) => `
        <tr class="border-t border-slate-100">
          <td class="px-4 py-3 text-sm font-bold text-slate-900">${escapeHtml(formatCategoryDisplayName(item.name))}</td>
          <td class="px-4 py-3 text-xs font-semibold text-slate-500">${escapeHtml(parent ? (buildCategoryPath(parent.id, costCategories) || formatCategoryDisplayName(parent.name)) : "—")}</td>
        </tr>`).join("")
    : `<tr><td colspan="2" class="px-4 py-8 text-center text-sm text-slate-400">Nenhuma subcategoria registada.</td></tr>`;
  container.innerHTML = `
    <div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-[11px] font-black uppercase tracking-widest text-slate-400">
          <tr><th class="px-4 py-3">Subcategoria</th><th class="px-4 py-3">Categoria</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function lockCostCatalogTab() {
  const locked = catalogMode();
  document.querySelectorAll("[data-cost-tab]").forEach((btn) => {
    btn.hidden = true;
  });
  const tabs = document.querySelector("[data-cost-tabs]");
  if (tabs) tabs.classList.add("hidden");
  return locked;
}

async function bootCostCatalog() {
  checkAuth();
  wireUsersNav();
  wireLogout();
  initMobileMenu();
  await initPermissionLayer();
  await initExtraRequestModal({ showToast });
  document.querySelectorAll("[data-cost-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setCostCatalogTab(btn.dataset.costTab));
  });
  bindCatalogCrudEvents();
  mountRegistryAddForm();
  const locked = lockCostCatalogTab();
  await reloadCostCatalog();
  setCostCatalogTab(locked);
  fillRegistryAddSelects();
}

if (document.body?.dataset.costCatalog) {
  bootCostCatalog();
}
