import { apiRequest, apiUpload } from "/services/api.js";
import { guardPageAccess, initPermissionLayer, can } from "/shared/permissions.js";
import { getSessionUser } from "/services/auth.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu } from "/shared/ui.js";
import { formatCurrency, formatDateBR } from "/shared/format.js";
import {
  initExtraRequestModal,
  openExtraRequestModalForEdit,
  openExtraRequestModal,
  wireExtraRequestButton,
} from "/shared/extraRequestModal.js";

import {
  loadAllCostCategories,
  buildCategoryPath,
  formatExtraCostLabel,
  formatCategoryDisplayName,
  getCachedCategories,
  costIdKey,
  sameCostId,
  normalizeCostLabel,
} from "/shared/costCategoryCascade.js";
import {
  buildCostCatalogSheetRows,
  applySheetFilters,
  sheetFilterOptions,
  groupCatalogSheetDisplayRows,
  catalogSheetGroupKey,
  classifyCategorySheetLevel,
  SHEET_LEVEL_LABELS,
  SHEET_TIPO1_FLAT,
} from "/shared/costCategorySheet.js";
import {
  renderBankCardHtml,
  normalizeBankKey,
  monthInputToExpiresAt,
  expiresAtToMonthInput,
  parseCardNumberInput,
} from "/shared/bankCardVisual.js";
import {
  bindNifLookup,
  normalizeNif,
  setNifLookupStatus,
} from "/shared/supplierNifLookup.js";

let costCategories = [];
let allProjects = [];
let allCards = [];
let centrosMainTab = "compras";

function switchCentrosMainTab(tab) {
  // Só existe painel para as abas presentes no HTML; evita esconder tudo.
  if (!document.getElementById(`centrosPanel${tab.charAt(0).toUpperCase()}${tab.slice(1)}`)) {
    tab = "compras";
  }
  centrosMainTab = tab;
  document.querySelectorAll("[data-centros-tab]").forEach((btn) => {
    const active = btn.dataset.centrosTab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.getElementById("centrosPanelExtras")?.classList.toggle("hidden", tab !== "extras");
  document.getElementById("centrosPanelCompras")?.classList.toggle("hidden", tab !== "compras");

  if (tab === "compras") {
    loadCCDashboard();
  }

  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url);
  } catch {
    /* ignore */
  }
}

function bindCentrosMainTabs() {
  document.querySelectorAll("[data-centros-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchCentrosMainTab(btn.dataset.centrosTab));
  });

  document.getElementById("btnOpenModalCartoes")?.addEventListener("click", () => {
    const m = document.getElementById("modalCartoes");
    if (m) m.classList.add("open");
    // load cards if not loaded yet
    if (managedCards.length === 0) loadCards();
  });

  document.getElementById("btnCloseModalCartoes")?.addEventListener("click", () => {
    document.getElementById("modalCartoes")?.classList.remove("open");
  });

  document.getElementById("btnOpenModalCatalogo")?.addEventListener("click", () => {
    const m = document.getElementById("modalCatalogo");
    if (m) m.classList.add("open");
    // load catalog if not loaded yet
    if (costCategories.length === 0) loadCostCategories();
  });

  document.getElementById("btnCloseModalCatalogo")?.addEventListener("click", () => {
    document.getElementById("modalCatalogo")?.classList.remove("open");
  });

  // Sidebar CC toggle (ocultar/expandir)
  document.getElementById("btnToggleCCSidebar")?.addEventListener("click", () => {
    const sidebar = document.getElementById("ccSidebar");
    const btn = document.getElementById("btnToggleCCSidebar");
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.toggle("collapsed");
    const icon = btn.querySelector(".material-symbols-outlined");
    if (icon) icon.textContent = isCollapsed ? "menu" : "menu_open";
    btn.setAttribute("aria-expanded", String(!isCollapsed));
    try { localStorage.setItem("ccSidebarCollapsed", isCollapsed ? "1" : "0"); } catch {}
  });

  // Restore sidebar state from localStorage
  try {
    const saved = localStorage.getItem("ccSidebarCollapsed");
    if (saved === "1") {
      const sidebar = document.getElementById("ccSidebar");
      const btn = document.getElementById("btnToggleCCSidebar");
      if (sidebar) sidebar.classList.add("collapsed");
      const icon = btn?.querySelector(".material-symbols-outlined");
      if (icon) icon.textContent = "menu";
      btn?.setAttribute("aria-expanded", "false");
    }
  } catch {}
}

function applyCentrosMainTabVisibility() {
  const hasCards = can("fundoManeio", "view");
  const hasPedidos = can("pedidosExtras", "view");
  // Assumindo permissão geral de compras ou admin (usando view genérico para testes/demonstração)
  const hasCompras = true; // Todo: usar uma permissão dedicada "centroCompras" quando existir

  const tabsEl = document.getElementById("centrosMainTabs");

  document.getElementById("btnOpenModalCartoes")?.classList.toggle("hidden", !hasCards);
  document.getElementById("btnOpenModalCatalogo")?.classList.toggle("hidden", !hasPedidos);
  document.getElementById("centrosTabBtnCompras")?.classList.toggle("hidden", !hasCompras);

  const validTabs = [];
  if (hasCompras) validTabs.push("compras");

  const urlTab = new URLSearchParams(window.location.search).get("tab");
  const initial = validTabs.includes(urlTab) ? urlTab : validTabs[0] || "compras";
  switchCentrosMainTab(initial);
}

function cardPreviewPayloadFromForm() {
  const bankSelect = document.getElementById("cardBank")?.value || "";
  const bankKey = normalizeBankKey(bankSelect) || bankSelect;
  const month = document.getElementById("cardExpiresAt")?.value || "";
  const expiresAt = month ? monthInputToExpiresAt(month) : null;
  const { cardNumberMasked, lastDigits } = parseCardNumberInput(
    document.getElementById("cardNumberMasked")?.value
  );
  return {
    id: "preview",
    label: document.getElementById("cardLabel")?.value.trim() || "NOME APELIDO",
    bank: bankKey || null,
    holderName: document.getElementById("cardHolderName")?.value.trim() || "",
    type: document.getElementById("cardType")?.value || "DEBITO",
    lastDigits,
    cardNumberMasked: cardNumberMasked || "",
    expiresAt,
  };
}

function updateCardFormPreview() {
  const host = document.getElementById("cardFormPreview");
  if (!host) return;
  host.innerHTML = renderBankCardHtml(cardPreviewPayloadFromForm(), { compact: true, asButton: false });
}

function renderCardScopeBadgeHtml(card) {
  const scope = cardScopeLabel(card);
  if (card.projectId) {
    return `<span class="debit-card__scope-pill">${escapeHtml(scope)}</span>`;
  }
  return `<span class="debit-card__scope-pill">Global</span>`;
}

function renderCardBalanceBadgeHtml(card) {
  const balance = Number(card.currentBalance || 0);
  return `<span class="debit-card__balance-pill">${escapeHtml(formatCurrency(balance, card.currency))}</span>`;
}

let managedCards = [];
let selectedCardId = null;
let selectedCardCache = null;
let selectedCostCategoryFilter = "";
let extrasCache = [];
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
  return [g.tipo1, g.grupo || null, g.tipo2].filter(Boolean).join(" › ");
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
  row.innerHTML = `<input type="text" class="cost-category-batch-name flex-1 h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none" placeholder="Nome do subcusto" maxlength="120" value="${escapeHtml(value)}">
    <button type="button" class="cost-catalog-batch-remove shrink-0 w-10 h-10 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600 flex items-center justify-center" aria-label="Remover linha">
      <span class="material-symbols-outlined text-lg">close</span>
    </button>`;
  wrap.appendChild(row);
}

function collectCostCategoryBatchNames() {
  return [...document.querySelectorAll(".cost-category-batch-name")]
    .map((el) => el.value.trim())
    .filter((n) => n.length >= 2);
}

function setCostCategoryModalTitles({ editId, sheetLevel }) {
  const title = document.getElementById("modalCostCategoryTitle");
  const sub = document.getElementById("modalCostCategorySubtitle");
  if (editId) {
    if (title) title.textContent = "Editar tipo de custo";
    if (sub) sub.textContent = SHEET_LEVEL_LABELS[sheetLevel] || "Entrada do catálogo";
  } else {
    if (title) title.textContent = "Adicionar tipo de custo";
    if (sub)
      sub.textContent = `Novo ${(SHEET_LEVEL_LABELS[sheetLevel] || "entrada").toLowerCase()} — preencha a classificação abaixo`;
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
      showToast("Estrutura criada. Veja na aba «Tipo 1 / Grupo».", "info");
      setCostCatalogTab("estrutura");
    } else {
      showToast("Tipo criado na base de dados. Recarregue a página se não aparecer na tabela.", "info");
    }
    return;
  }
  if (sameCostId(hit.tipo2Id, categoryId) && !hit.tipo3Id) {
    showToast("Tipo custo 2 adicionado. Clique na linha para gerir tipos custo 3.", "info");
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

  const tipo1Entries = [{ v: "", label: "Tipo custo 1 — todos" }, ...opts.tipo1.map((t) => ({ v: t, label: t }))];
  const grupoValues = opts.grupo;
  const grupoEntries = [{ v: "", label: "Grupo — todos" }];
  if (grupoValues.includes("")) grupoEntries.push({ v: "__EMPTY__", label: "(sem grupo)" });
  grupoValues.filter(Boolean).forEach((g) => grupoEntries.push({ v: g, label: g }));
  const tipo2Entries = [{ v: "", label: "Tipo custo 2 — todos" }, ...opts.tipo2.map((t) => ({ v: t, label: t }))];

  bar.innerHTML = `<div class="flex flex-nowrap items-end gap-2 mb-3 p-3 bg-slate-50/90 border border-slate-100 rounded-xl overflow-x-auto">
    ${mkSelect("filterSheetTipo1", "Tipo custo 1", tipo1Entries, catalogSheetFilters.tipo1)}
    ${mkSelect("filterSheetGrupo", "Grupo", grupoEntries, catalogSheetFilters.grupo)}
    ${mkSelect("filterSheetTipo2", "Tipo custo 2", tipo2Entries, catalogSheetFilters.tipo2)}
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
      if (!can("pedidosExtras", "create")) return;
      const group = getCatalogGroupByKey(row.dataset.groupKey);
      if (!group) return;
      const realTipo3 = (group.variants || []).filter((v) => v.tipo3 && v.tipo3 !== "—");
      if (realTipo3.length > 1) {
        openTipo3DrillModal(group);
        showToast("Escolha o tipo custo 3 no modal e use «Pedido extra».", "info");
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

  if (title) title.textContent = group.tipo2 || "—";
  if (path) path.textContent = catalogGroupPathLabel(group);
  const variants = getTipo3VariantsForGroup(group);
  const hasRealTipo3 = variants.some((v) => v.tipo3 && v.tipo3 !== "—");
  if (meta) {
    meta.textContent = hasRealTipo3
      ? `${variants.length} Subcustos${variants.length === 1 ? "" : "s"}`
      : "Sem subcustos — este tipo 2 é seleccionável directamente";
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
          const label = v.tipo3 && v.tipo3 !== "—" ? v.tipo3 : group.tipo2;
          const badge = v.tipo3 && v.tipo3 !== "—" ? "Subcusto" : "Tipo 2 (directo)";
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
                  ${
                    canDeleteCostCatalog()
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
    : `<p class="text-sm text-slate-400 text-center py-8">Nenhum tipo custo 3. Use «Adicionar tipo custo 3».</p>`;

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
      loadExtras();
      if (selectedCostCategoryFilter) {
        showToast("Filtro de pedidos de compra aplicado a este tipo de custo.", "info");
      }
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
    ? `<button type="button" class="cost-catalog-actions__item cost-catalog-actions__item--danger" data-delete-category="${g.tipo2Id}">Eliminar tipo 2</button>`
    : "";
  return `<div class="cost-catalog-actions relative inline-block text-left">
      <button type="button" class="cost-catalog-actions__btn">Acções <span class="material-symbols-outlined text-sm align-middle">expand_more</span></button>
      <div class="cost-catalog-actions__menu hidden">
        <button type="button" class="cost-catalog-actions__item" data-edit-category="${g.tipo2Id}">Editar tipo 2</button>
        <button type="button" class="cost-catalog-actions__item" data-add-child-category="${g.tipo2Id}">Adicionar tipo custo 3</button>
        <button type="button" class="cost-catalog-actions__item" data-open-tipo3-drill="${escapeHtml(catalogSheetGroupKey(g))}">Ver tipos custo 3</button>
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

const CARD_TYPE_LABELS = { PREPAGO: "Pré-pago", DEBITO: "Débito", CREDITO: "Crédito" };

const EXTRA_STATUS_LABELS = {
  PENDENTE: "Pendente",
  APROVADO: "A liquidar",
  PAGO: "Pago",
  REJEITADO: "Rejeitado",
  CANCELADO: "Cancelado",
};

const EXTRA_STATUS_STYLES = {
  PENDENTE: "bg-amber-100 text-amber-700",
  APROVADO: "bg-indigo-100 text-indigo-700",
  PAGO: "bg-emerald-100 text-emerald-700",
  REJEITADO: "bg-red-100 text-red-700",
  CANCELADO: "bg-slate-100 text-slate-600",
};

const EXTRA_SOURCE_LABELS = {
  CAIXA: "Caixa",
  BANCO: "Banco",
  FUNDO_MANEIO: "Cartão",
  SOLICITACAO_TRANSFERENCIA: "Solicitação de Transferência",
  TRANSFERENCIA_INTERNA_CARTAO: "Transferência interna (carregar cartão)",
};

function cardScopeLabel(card) {
  if (!card?.projectId) return "Global";
  const p = card.project || allProjects.find((pr) => pr.id === card.projectId);
  if (p) return `${p.name}${p.code ? ` (${p.code})` : ""}`;
  return "Obra";
}

function apiErrorMessage(err) {
  return err?.data?.message || err?.message || "Erro desconhecido";
}

function movementReferenceLabel(m) {
  const ex = m.extraRequest;
  if (!ex) return "—";
  if (ex.costCategory?.name) return formatExtraCostLabel(ex);
  if (ex.generalCostCenter?.name) return ex.generalCostCenter.name;
  if (ex.project) return `${ex.project.name}${ex.project.code ? ` (${ex.project.code})` : ""}`;
  return "Pedido extra";
}

function showToast(msg, type = "info") {
  let container = document.getElementById("toast");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast";
    document.body.appendChild(container);
  }
  if (container.parentElement !== document.body) {
    document.body.appendChild(container);
  }
  container.style.zIndex = "10000";
  const colors = {
    success: "bg-emerald-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-slate-800 text-white",
  };
  const icons = { success: "check_circle", error: "error", info: "info" };
  const el = document.createElement("div");
  el.className = `pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl text-sm font-bold ${colors[type]}`;
  el.style.position = "relative";
  el.style.zIndex = "10001";
  el.innerHTML = `<span class="material-symbols-outlined text-base">${icons[type]}</span>${msg}`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  }, 3500);
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
      ? `${displayRows.length} tipos custo 2 (${allSheet.length} linhas no catálogo)`
      : "Catálogo indisponível";
  }
  if (summaryEl) {
    summaryEl.textContent = displayRows.length
      ? `${displayRows.length} tipos custo 2`
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
          const parentPath = [g.tipo1, g.grupo || null].filter(Boolean).join(" › ");
          const countLabel =
            count > 0
              ? `${count} tipo${count === 1 ? "" : "s"} custo 3`
              : "Sem subcustos";
          const countBadge =
            count > 0
              ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-bold">${count} subcustos</span>`
              : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold">Directo</span>`;
          const actions = canManageCostCatalog()
            ? `<td class="px-3 py-2.5 text-right align-middle">${catalogRowActionsHtml(g)}</td>`
            : "";
          return `<tr class="cost-catalog-table__row cost-catalog-table__row--extrato${selected}" data-domain="${g.domain}" data-group-key="${escapeHtml(gkey)}" data-tipo2-id="${g.tipo2Id}" tabindex="0" title="Clique para ver tipos custo 3">
            ${catalogCheckboxCellHtml(g.tipo2Id)}
            <td class="px-4 py-3 align-middle">
              <div class="cost-catalog-desc-cell flex items-start gap-3">
                <span class="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 mt-0.5">
                  <span class="material-symbols-outlined text-lg">category</span>
                </span>
                <span class="min-w-0">
                  <span class="inline-flex items-center gap-2">
                    <span class="text-[10px] font-black uppercase tracking-widest text-emerald-700">Tipo custo 2</span>
                    ${countBadge}
                  </span>
                  <span class="block text-sm font-bold text-slate-900 mt-0.5">${escapeHtml(g.tipo2)}</span>
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
    : `<tr><td colspan="${colSpan}" class="px-4 py-10 text-center text-sm text-slate-400">Nenhum tipo custo 2 com estes filtros ou pesquisa.</td></tr>`;

  container.innerHTML = `
    <div class="cost-catalog-extrato-wrap overflow-x-auto border border-slate-200 rounded-xl bg-white max-h-[560px] overflow-y-auto">
      <table class="cost-catalog-table cost-catalog-table--extrato w-full text-left">
        <thead class="sticky top-0 z-[1]">
          <tr class="bg-slate-50 text-[10px] font-black uppercase text-slate-600 border-b border-slate-200">
            ${checkHead}
            <th class="px-4 py-3">Tipo custo 2</th>
            <th class="px-3 py-3 border-l border-slate-200 w-40">Tipo custo 3</th>
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
  renderCatalogFilterBar();
  if (tab === "tipos") renderCostCatalogTipos();
  if (tab === "estrutura") renderEstruturaCatalog();
  applyCatalogManageVisibility();
}

function renderCostCatalogViews() {
  renderCatalogFilterBar();
  if (activeCostCatalogTab === "tipos") renderCostCatalogTipos();
  if (activeCostCatalogTab === "estrutura") renderEstruturaCatalog();
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
    select.innerHTML = `<option value="">— Directamente sob tipo 1 —</option>`;
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
    `<option value="">— Directamente sob tipo 1 —</option>` +
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
  select.innerHTML = `<option value="">— Seleccione o tipo custo 2 —</option>${opts}`;
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
  push(group.tipo2Id, `Tipo custo 2 — ${group.tipo2}`);
  for (const v of group.variants || []) {
    if (v.tipo3 && v.tipo3 !== "—") {
      push(v.pickCategoryId, `Tipo custo 3 — ${v.tipo3}`);
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
  const parts = [group.tipo1, group.grupo || null, group.tipo2].filter(Boolean);
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
  document.getElementById("costCategoryName").value = item.name;
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
                        ? `<input type="checkbox" class="cost-catalog-check h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0" data-catalog-check="${costIdKey(g.id)}"${
                            catalogDeleteSelectionHas(g.id) ? " checked" : ""
                          } aria-label="Seleccionar grupo">`
                        : "";
                    const gActions = canManage
                      ? `<span class="inline-flex items-center gap-0.5 shrink-0">
                          <button type="button" class="cost-catalog-action" data-edit-category="${g.id}" title="Editar grupo">
                            <span class="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                          ${
                            canDeleteCostCatalog()
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
    : `<tr><td colspan="${colSpan}" class="px-4 py-8 text-center text-xs text-slate-400">Sem tipos 1. Use «Tipo 1» acima; o grupo é opcional e fica dentro de cada tipo 1.</td></tr>`;

  container.innerHTML = `
    <div class="overflow-x-auto border border-slate-200 rounded-lg">
      <table class="cost-catalog-table cost-catalog-table--sheet w-full text-left">
        <thead>
          <tr class="bg-slate-200/90 text-[10px] font-black uppercase text-slate-700">
            ${checkHead}
            <th class="px-3 py-2.5">Tipo custo 1</th>
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
  const name = document.getElementById("costCategoryName").value.trim();
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
    showToast("Seleccione tipo custo 1 ou grupo", "error");
    return;
  }
  if (editId && sheetLevel === "GRUPO" && !parentId) {
    showToast("Seleccione o tipo custo 1", "error");
    return;
  }
  if (editId && sheetLevel === "SUBCUSTO" && !parentId) {
    showToast("Seleccione o tipo custo 2", "error");
    return;
  }
  if (editId && sheetLevel === "TIPO2" && domain === "GERAL" && !parentId) {
    showToast("Seleccione tipo custo 1 ou grupo", "error");
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
        PARENT_TIPO1_REQUIRED: "Seleccione o tipo custo 1.",
        PARENT_TIPO2_REQUIRED: "Seleccione o tipo custo 2.",
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
      document.getElementById("filterCostCategory").value = "";
    }
    selectedCatalogDeleteIds.delete(costIdKey(id));
    await reloadCostCatalog();
    loadExtras();
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
    loadExtras();
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

  document.getElementById("costCatalogSearch")?.addEventListener("input", (e) => {
    catalogSearchQuery = e.target.value || "";
    if (activeCostCatalogTab === "tipos") renderCostCatalogTipos();
  });

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

  document.getElementById("modalCatalogo")?.addEventListener("change", (e) => {
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

  document.getElementById("modalCatalogo")?.addEventListener("click", (e) => {
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

function populateCostCategoryFilter() {
  const select = document.getElementById("filterCostCategory");
  if (!select) return;
  const leaves = costCategories.filter((c) => c.isSelectable);
  const opts = leaves
    .map((c) => {
      const path = buildCategoryPath(c.id, costCategories);
      return `<option value="${c.id}">${path || c.name}</option>`;
    })
    .join("");
  select.innerHTML = `<option value="">Todos os tipos de custo</option>${opts}`;
}

function populateProjectSelects() {
  const opts = allProjects
    .map((p) => `<option value="${p.id}">${p.name}${p.code ? ` (${p.code})` : ""}</option>`)
    .join("");
  const extraProjectEl = document.getElementById("extraProjectId");
  if (extraProjectEl) extraProjectEl.innerHTML = `<option value="">Selecionar obra...</option>${opts}`;
  
  const filterProjectEl = document.getElementById("filterProject");
  if (filterProjectEl) filterProjectEl.innerHTML = `<option value="">Todas as obras</option>${opts}`;
  
  const filterCardProjectEl = document.getElementById("filterCardProject");
  if (filterCardProjectEl) filterCardProjectEl.innerHTML = `<option value="">Todas as obras</option>${opts}`;
  
  const cardProjectEl = document.getElementById("cardProjectId");
  if (cardProjectEl) cardProjectEl.innerHTML = `<option value="">Selecionar obra...</option>${opts}`;
}

function escapeAttr(value) {
  return String(value || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

function renderIconBtn(icon, title, variant = "slate", { attrs = "", disabled = false } = {}) {
  const disabledAttr = disabled ? "disabled" : "";
  const mutedClass = disabled ? " fin-icon-btn--muted" : "";
  return `
    <button type="button" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}"
      class="fin-icon-btn fin-icon-btn--${variant}${mutedClass}" ${disabledAttr} ${attrs}>
      <span class="material-symbols-outlined text-base">${icon}</span>
    </button>`;
}

function extraReferenceLabel(it) {
  const costLabel = formatExtraCostLabel(it);
  if (it.type === "GERAL") {
    return costLabel !== "—" ? costLabel : "Geral";
  }
  const obra = it.project
    ? `${it.project.name}${it.project.code ? ` (${it.project.code})` : ""}`
    : "";
  const cc = it.costCenter
    ? `${it.costCenter.code ? `${it.costCenter.code} — ` : ""}${it.costCenter.name}`
    : "";
  const costPart = costLabel !== "—" ? costLabel : "";
  if (obra && cc && costPart) return `${obra} · ${cc} · ${costPart}`;
  if (obra && cc) return `${obra} · ${cc}`;
  if (obra && costPart) return `${obra} · ${costPart}`;
  return obra || cc || costPart || "—";
}

function renderExtraRow(it) {
  const sourceLabel =
    it.paymentSource === "FUNDO_MANEIO"
      ? `Cartão: ${it.card?.label || it.fund?.name || "—"}`
      : it.paymentSource === "TRANSFERENCIA_INTERNA_CARTAO"
        ? `Carregar: ${it.card?.label || "—"}`
        : EXTRA_SOURCE_LABELS[it.paymentSource] || it.paymentSource;
  const statusBadge = `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${EXTRA_STATUS_STYLES[it.status] || ""}">${EXTRA_STATUS_LABELS[it.status] || it.status}</span>`;
  const typeBadge =
    it.type === "GERAL"
      ? `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-violet-100 text-violet-700">Geral</span>`
      : `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-sky-100 text-sky-700">Obra</span>`;

  const actions = [];
  const canApprove = can("pedidosExtras", "approve");
  const canCreate = can("pedidosExtras", "create");
  const canDelete = can("pedidosExtras", "delete");
  const canEdit = canCreate && (it.status === "PENDENTE" || it.status === "APROVADO");

  if (canEdit) {
    actions.push(
      renderIconBtn("edit", "Editar pedido extra", "blue", {
        attrs: `data-action="edit" data-id="${it.id}"`,
      })
    );
  }
  if (it.status === "PENDENTE" && canApprove) {
    actions.push(
      renderIconBtn("check_circle", "Aprovar", "emerald", {
        attrs: `data-action="approve" data-id="${it.id}"`,
      }),
      renderIconBtn("block", "Rejeitar", "red", {
        attrs: `data-action="reject" data-id="${it.id}"`,
      })
    );
  }
  if ((it.status === "PENDENTE" || it.status === "APROVADO") && canCreate) {
    actions.push(
      renderIconBtn("cancel", "Cancelar pedido", "amber", {
        attrs: `data-action="cancel" data-id="${it.id}"`,
      })
    );
  }
  if (canDelete && it.status !== "PAGO" && it.status !== "APROVADO") {
    actions.push(
      renderIconBtn("delete", "Eliminar", "red", {
        attrs: `data-action="delete" data-id="${it.id}"`,
      })
    );
  }

  const actionsHtml = actions.length
    ? `<div class="fin-actions">${actions.join("")}</div>`
    : `<span class="text-slate-300">—</span>`;

  return `<tr class="border-t border-slate-50 hover:bg-slate-50/50">
    <td class="px-5 py-3 text-xs font-bold text-slate-800">${it.paymentDueDate ? formatDateBR(it.paymentDueDate) : "—"}</td>
    <td class="px-5 py-3 text-xs text-slate-500">${formatDateBR(it.createdAt)}</td>
    <td class="px-5 py-3">${typeBadge}</td>
    <td class="px-5 py-3 text-xs font-semibold text-slate-700 max-w-[180px] truncate">${extraReferenceLabel(it)}</td>
    <td class="px-5 py-3 text-xs font-semibold text-slate-700 max-w-[200px] truncate">${it.description}${
      it.quantity != null && it.quantity !== ""
        ? ` <span class="text-slate-400 font-bold">× ${escapeHtml(String(it.quantity))}</span>`
        : ""
    }</td>
    <td class="px-5 py-3 text-xs text-slate-500">${sourceLabel}</td>
    <td class="px-5 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(it.amount, it.currency)}</td>
    <td class="px-5 py-3">${statusBadge}</td>
    <td class="px-5 py-3 text-center">${actionsHtml}</td>
  </tr>`;
}

async function loadExtras() {
  const tbody = document.getElementById("extrasTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="9" class="text-center py-12"><div class="spinner mx-auto"></div></td></tr>`;

  const type = document.getElementById("filterType")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";
  const costCategoryId = document.getElementById("filterCostCategory")?.value || "";
  const projectId = document.getElementById("filterProject")?.value || "";

  const params = new URLSearchParams({ pageSize: "100" });
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  if (costCategoryId) params.set("costCategoryId", costCategoryId);
  if (projectId) params.set("projectId", projectId);

  try {
    const data = await apiRequest(`/extra-requests?${params.toString()}`);
    const items = data.items || [];
    extrasCache = items;
    const meta = document.getElementById("extrasSectionMeta");
    if (meta) {
      const pending = items.filter((it) => it.status === "PENDENTE").length;
      meta.textContent = items.length
        ? `${items.length} pedido(s) · ${pending} pendente(s)`
        : "Nenhum pedido extra encontrado";
    }
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10 text-slate-400 text-xs">Nenhum pedido extra encontrado</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(renderExtraRow).join("");
    bindTableActions();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

function bindTableActions() {
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "edit") {
        openExtraRequestModalForEdit(id);
      } else if (action === "approve") {
        if (!confirm("Aprovar este Pedido Extra?")) return;
        try {
          await apiRequest(`/extra-requests/${id}/approve`, { method: "PATCH" });
          showToast("Pedido aprovado", "success");
          loadExtras();
        } catch (err) {
          showToast("Erro: " + err.message, "error");
        }
      } else if (action === "reject") {
        const reason = prompt("Motivo da rejeição (opcional):") || "";
        try {
          await apiRequest(`/extra-requests/${id}/reject`, { method: "PATCH", body: { reason } });
          showToast("Pedido rejeitado", "success");
          loadExtras();
        } catch (err) {
          showToast("Erro: " + err.message, "error");
        }
      } else if (action === "cancel") {
        if (!confirm("Cancelar este Pedido Extra?")) return;
        try {
          await apiRequest(`/extra-requests/${id}/cancel`, { method: "PATCH" });
          showToast("Pedido cancelado", "success");
          loadExtras();
        } catch (err) {
          showToast("Erro: " + err.message, "error");
        }
      } else if (action === "delete") {
        if (!confirm("Eliminar permanentemente este Pedido Extra?")) return;
        try {
          await apiRequest(`/extra-requests/${id}`, { method: "DELETE" });
          showToast("Pedido eliminado", "success");
          loadExtras();
        } catch (err) {
          showToast("Erro: " + err.message, "error");
        }
      }
    });
  });
}

function bindEvents() {
  document.querySelectorAll("[data-cost-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setCostCatalogTab(btn.dataset.costTab));
  });

  wireExtraRequestButton("btnNewExtra", () => ({
    type: "GERAL",
    costCategoryId: selectedCostCategoryFilter || "",
  }));

  ["filterType", "filterStatus", "filterCostCategory", "filterProject"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (id === "filterCostCategory") {
        selectedCostCategoryFilter = document.getElementById("filterCostCategory").value;
      }
      loadExtras();
    });
  });

  bindCardEvents();
  bindCatalogCrudEvents();
  applyCatalogManageVisibility();
}

async function loadCostCategories() {
  await reloadCostCatalog();
  setCostCatalogTab("tipos");
}

// ── Gestão de Cartões ────────────────────────────────────────────────────────

function updateCardsSectionMeta() {
  const meta = document.getElementById("cardsSectionMeta");
  if (!meta) return;
  const cards = getFilteredManagedCards();
  if (!cards.length) {
    meta.textContent = "Nenhum cartão encontrado";
    return;
  }
  const totalBalance = cards.reduce((sum, c) => sum + Number(c.currentBalance || 0), 0);
  const currency = cards[0]?.currency || "AOA";
  meta.textContent = `${cards.length} cartão(ões) · ${formatCurrency(totalBalance, currency)} total visível`;
}

function isCardDetailOpen() {
  return document.getElementById("modalCardDetail")?.classList.contains("open");
}

function openCardDetailModal() {
  document.getElementById("modalCardDetail")?.classList.add("open");
}

function closeCardDetailModal() {
  document.getElementById("modalCardDetail")?.classList.remove("open");
  document.getElementById("cardDetailPreview").innerHTML = "";
  selectedCardId = null;
  selectedCardCache = null;
  renderCardsGrid();
}

function toggleSectionPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const collapsed = panel.classList.toggle("is-collapsed");
  const toggle = panel.querySelector("[data-section-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function bindSectionToggles() {
  document.querySelectorAll("[data-section-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleSectionPanel(btn.dataset.sectionToggle));
  });
}

function setSectionCollapsed(panelId, collapsed) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.classList.toggle("is-collapsed", collapsed);
  const toggle = panel.querySelector("[data-section-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function setCardScope(scope) {
  const isGlobal = scope === "global";
  document.getElementById("cardScope").value = scope;
  document.getElementById("btnCardScopeGlobal").classList.toggle("active", isGlobal);
  document.getElementById("btnCardScopeObra").classList.toggle("active", !isGlobal);
  document.getElementById("rowCardProject").classList.toggle("hidden", isGlobal);
  document.getElementById("cardProjectId").required = !isGlobal;
}

function getFilteredManagedCards() {
  const scope = document.getElementById("filterCardScope")?.value || "";
  const projectId = document.getElementById("filterCardProject")?.value || "";
  return managedCards.filter((c) => {
    if (scope === "global" && c.projectId) return false;
    if (scope === "obra" && !c.projectId) return false;
    if (projectId && c.projectId !== projectId) return false;
    return true;
  });
}

async function loadCards() {
  const grid = document.getElementById("cardsGrid");
  if (!grid) return;
  grid.innerHTML = `<div class="col-span-full flex justify-center py-8"><div class="spinner"></div></div>`;

  const projectId = document.getElementById("filterCardProject")?.value || "";
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);

  try {
    const data = await apiRequest(`/petty-cash/cards${params.toString() ? `?${params}` : ""}`);
    managedCards = data.items || [];
    allCards = managedCards;
    renderCardsGrid();
    updateCardsSectionMeta();
    if (selectedCardId && isCardDetailOpen()) {
      await selectCard(selectedCardId);
    }
  } catch (err) {
    grid.innerHTML = `<p class="text-center py-8 text-red-500 text-xs font-bold col-span-full">${err.message}</p>`;
  }
}

function renderCardsGrid() {
  const grid = document.getElementById("cardsGrid");
  if (!grid) return;
  const cards = getFilteredManagedCards();
  if (!cards.length) {
    grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-12 text-slate-400">
      <span class="material-symbols-outlined text-4xl mb-2">credit_card</span>
      <p class="text-sm font-semibold">Nenhum cartão encontrado</p>
      <p class="text-[11px] mt-1 max-w-sm text-center">Crie um cartão BAI, BFA ou Caixa Angola para ver o layout do banco.</p>
    </div>`;
    return;
  }
  grid.innerHTML = cards
    .map((c) =>
      renderBankCardHtml(c, {
        active: c.id === selectedCardId,
        balanceHtml: renderCardBalanceBadgeHtml(c),
        scopeBadgeHtml: renderCardScopeBadgeHtml(c),
      })
    )
    .join("");

  grid.querySelectorAll("[data-card-id]").forEach((btn) => {
    btn.addEventListener("click", () => selectCard(btn.dataset.cardId));
  });
}

async function selectCard(cardId) {
  selectedCardId = cardId;
  renderCardsGrid();
  openCardDetailModal();
  document.getElementById("cardMovementsBody").innerHTML =
    `<tr><td colspan="6" class="text-center py-8"><div class="spinner mx-auto"></div></td></tr>`;

  try {
    const data = await apiRequest(`/petty-cash/cards/${cardId}?pageSize=30`);
    const card = data.card;
    selectedCardCache = card;
    const balance = Number(card.currentBalance || 0);
    document.getElementById("cardDetailName").textContent =
      `${card.label}${card.lastDigits ? ` •••• ${card.lastDigits}` : ""} · ${formatCurrency(balance, card.currency)}`;
    document.getElementById("cardDetailScope").textContent =
      `${cardScopeLabel(card)} · Histórico de carregamentos e gastos`;

    const previewHost = document.getElementById("cardDetailPreview");
    if (previewHost) {
      previewHost.innerHTML = renderBankCardHtml(card, {
        compact: true,
        asButton: false,
        balanceHtml: renderCardBalanceBadgeHtml(card),
        scopeBadgeHtml: renderCardScopeBadgeHtml(card),
      });
    }

    const movements = data.movements.items || [];
    document.getElementById("cardMovementsBody").innerHTML =
      movements
        .map((m) => {
          const typeColor =
            m.type === "DEBITO" ? "text-red-600" : m.type === "CREDITO" ? "text-emerald-600" : "text-amber-600";
          const sign = m.type === "DEBITO" ? "-" : "+";
          return `<tr class="border-t border-slate-50">
            <td class="px-4 py-3 text-xs text-slate-500">${formatDateBR(m.createdAt)}</td>
            <td class="px-4 py-3 text-xs font-bold ${typeColor}">${m.type}</td>
            <td class="px-4 py-3 text-xs text-slate-700">${m.description}</td>
            <td class="px-4 py-3 text-xs text-slate-500">${movementReferenceLabel(m)}</td>
            <td class="px-4 py-3 text-xs font-bold ${typeColor} text-right">${sign}${formatCurrency(m.amount, card.currency)}</td>
            <td class="px-4 py-3 text-xs text-slate-500 text-right">${formatCurrency(m.balanceAfter, card.currency)}</td>
          </tr>`;
        })
        .join("") ||
      `<tr><td colspan="6" class="text-center py-8 text-slate-400 text-xs">Sem movimentações registadas</td></tr>`;

    updateCardActionButtons();
  } catch (err) {
    showToast("Erro ao carregar cartão: " + err.message, "error");
  }
}

function updateCardActionButtons() {
  const canCreate = can("fundoManeio", "create");
  const canManage = can("fundoManeio", "manage");
  const canEdit = can("fundoManeio", "edit") || canManage;
  document.getElementById("cardLoadBtn")?.classList.toggle("hidden", !canManage);
  document.getElementById("cardAdjustBtn")?.classList.toggle("hidden", !canManage);
  document.getElementById("cardEditBtn")?.classList.toggle("hidden", !canEdit);
  document.getElementById("cardDeleteBtn")?.classList.toggle("hidden", !canManage);
}

function resolveBankSelectValue(bank) {
  const key = normalizeBankKey(bank);
  if (key === "BAI" || key === "BFA" || key === "CAIXA") return key;
  return "";
}

function openCardFormModal(cardId = "") {
  document.getElementById("formCard").reset();
  document.getElementById("cardEditId").value = "";
  document.getElementById("cardCurrency").value = "AOA";
  document.getElementById("cardBank").value = "BAI";
  document.getElementById("cardType").value = "DEBITO";
  document.getElementById("modalCardFormTitle").textContent = "Novo Cartão";
  document.getElementById("cardFormSubmitBtn").textContent = "Criar Cartão";
  document.getElementById("cardInitialBalanceRow").classList.remove("hidden");
  document.getElementById("cardInitialBalance").disabled = false;
  setCardScope("global");

  const prefillProject = document.getElementById("filterCardProject")?.value || "";
  if (prefillProject) {
    setCardScope("obra");
    document.getElementById("cardProjectId").value = prefillProject;
  }

  if (cardId) {
    const card = selectedCardCache || managedCards.find((c) => c.id === cardId);
    if (!card) return;
    document.getElementById("cardEditId").value = card.id;
    document.getElementById("modalCardFormTitle").textContent = "Editar Cartão";
    document.getElementById("cardFormSubmitBtn").textContent = "Guardar";
    document.getElementById("cardInitialBalanceRow").classList.add("hidden");
    document.getElementById("cardLabel").value = card.label || "";
    document.getElementById("cardType").value = card.type || "DEBITO";
    document.getElementById("cardBank").value = resolveBankSelectValue(card.bank);
    if (card.cardNumberMasked) {
      document.getElementById("cardNumberMasked").value = card.cardNumberMasked;
    } else if (card.lastDigits) {
      document.getElementById("cardNumberMasked").value = `•••• •••• •••• ${card.lastDigits}`;
    } else {
      document.getElementById("cardNumberMasked").value = "";
    }
    document.getElementById("cardExpiresAt").value = expiresAtToMonthInput(card.expiresAt);
    document.getElementById("cardHolderName").value = card.holderName || "";
    document.getElementById("cardCurrency").value = card.currency || "AOA";
    if (card.projectId) {
      setCardScope("obra");
      document.getElementById("cardProjectId").value = card.projectId;
    } else {
      setCardScope("global");
    }
  }

  updateCardFormPreview();
  document.getElementById("modalCardForm").classList.add("open");
}

function closeCardFormModal() {
  document.getElementById("modalCardForm").classList.remove("open");
}

async function submitCardForm(e) {
  e.preventDefault();
  const cardId = document.getElementById("cardEditId").value;
  const scope = document.getElementById("cardScope").value;
  const projectId = scope === "obra" ? document.getElementById("cardProjectId").value || null : null;
  if (scope === "obra" && !projectId) {
    showToast("Seleccione a obra", "error");
    return;
  }
  const bankSelect = document.getElementById("cardBank").value;
  const monthVal = document.getElementById("cardExpiresAt").value;
  const { cardNumberMasked, lastDigits } = parseCardNumberInput(
    document.getElementById("cardNumberMasked").value
  );
  const body = {
    label: document.getElementById("cardLabel").value.trim(),
    type: document.getElementById("cardType").value,
    bank: bankSelect || null,
    lastDigits,
    cardNumberMasked,
    holderName: document.getElementById("cardHolderName").value.trim() || null,
    currency: document.getElementById("cardCurrency").value.trim() || "AOA",
    expiresAt: monthVal ? monthInputToExpiresAt(monthVal) : null,
    projectId,
  };
  if (!cardId) {
    body.initialBalance = parseFloat(document.getElementById("cardInitialBalance").value) || 0;
  }
  try {
    if (cardId) {
      await apiRequest(`/petty-cash/cards/${cardId}`, { method: "PATCH", body });
      showToast("Cartão actualizado", "success");
    } else {
      await apiRequest("/petty-cash/cards", { method: "POST", body });
      showToast("Cartão criado", "success");
    }
    closeCardFormModal();
    await loadCards();
  } catch (err) {
    showToast(apiErrorMessage(err), "error");
  }
}

function openCardMovementModal(type = "CREDITO") {
  if (!selectedCardId) {
    showToast("Selecciona um cartão primeiro", "error");
    return;
  }
  document.getElementById("formCardMovement").reset();
  document.getElementById("cardMovementCardId").value = selectedCardId;
  document.getElementById("cardMovementType").value = type;
  document.getElementById("modalCardMovementTitle").textContent =
    type === "AJUSTE" ? "Ajuste de Saldo" : "Carregar Cartão";
  document.getElementById("modalCardMovement").classList.add("open");
}

function closeCardMovementModal() {
  document.getElementById("modalCardMovement").classList.remove("open");
}

async function submitCardMovement(e) {
  e.preventDefault();
  const cardId = document.getElementById("cardMovementCardId").value;
  const body = {
    type: document.getElementById("cardMovementType").value || "CREDITO",
    amount: parseFloat(document.getElementById("cardMovementAmount").value) || 0,
    description: document.getElementById("cardMovementDesc").value.trim(),
  };
  try {
    await apiRequest(`/petty-cash/cards/${cardId}/movements`, { method: "POST", body });
    showToast(body.type === "AJUSTE" ? "Ajuste registado" : "Cartão carregado", "success");
    closeCardMovementModal();
    await loadCards();
    if (selectedCardId) await selectCard(selectedCardId);
  } catch (err) {
    showToast(apiErrorMessage(err), "error");
  }
}

async function deleteCardHandler() {
  if (!selectedCardId) return;
  const card = selectedCardCache || managedCards.find((c) => c.id === selectedCardId);
  const label = card?.label || "este cartão";
  if (
    !confirm(
      `Eliminar o cartão "${label}"?\n\nSó é possível se o saldo for zero e não houver movimentações.`
    )
  ) {
    return;
  }
  try {
    await apiRequest(`/petty-cash/cards/${selectedCardId}`, { method: "DELETE" });
    showToast("Cartão eliminado", "success");
    closeCardDetailModal();
    await loadCards();
  } catch (err) {
    showToast(apiErrorMessage(err), "error");
  }
}

function bindCardEvents() {
  document.getElementById("btnNewCard")?.addEventListener("click", () => {
    if (!can("fundoManeio", "create")) {
      showToast("Sem permissão para criar cartões", "error");
      return;
    }
    switchCentrosMainTab("cartoes");
    openCardFormModal();
  });
  document.getElementById("btnCardScopeGlobal")?.addEventListener("click", () => setCardScope("global"));
  document.getElementById("btnCardScopeObra")?.addEventListener("click", () => setCardScope("obra"));
  document.getElementById("formCard")?.addEventListener("submit", submitCardForm);
  document.getElementById("btnCloseCardFormModal")?.addEventListener("click", closeCardFormModal);
  document.getElementById("btnCancelCardForm")?.addEventListener("click", closeCardFormModal);
  document.getElementById("cardLoadBtn")?.addEventListener("click", () => openCardMovementModal("CREDITO"));
  document.getElementById("cardAdjustBtn")?.addEventListener("click", () => openCardMovementModal("AJUSTE"));
  document.getElementById("cardEditBtn")?.addEventListener("click", () => openCardFormModal(selectedCardId));
  document.getElementById("cardDeleteBtn")?.addEventListener("click", deleteCardHandler);
  document.getElementById("formCardMovement")?.addEventListener("submit", submitCardMovement);
  document.getElementById("btnCloseCardMovementModal")?.addEventListener("click", closeCardMovementModal);
  document.getElementById("btnCancelCardMovement")?.addEventListener("click", closeCardMovementModal);
  document.getElementById("btnCloseCardDetailModal")?.addEventListener("click", closeCardDetailModal);

  [
    "cardLabel",
    "cardBank",
    "cardType",
    "cardHolderName",
    "cardNumberMasked",
    "cardExpiresAt",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateCardFormPreview);
    document.getElementById(id)?.addEventListener("change", updateCardFormPreview);
  });

  ["filterCardScope", "filterCardProject"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (id === "filterCardProject") {
        const pid = document.getElementById("filterCardProject").value;
        if (pid) document.getElementById("filterCardScope").value = "obra";
        loadCards();
      } else {
        renderCardsGrid();
        updateCardsSectionMeta();
        if (selectedCardId && isCardDetailOpen()) {
          const stillVisible = getFilteredManagedCards().some((c) => c.id === selectedCardId);
          if (!stillVisible) closeCardDetailModal();
        }
      }
    });
  });

  ["modalCardForm", "modalCardMovement", "modalCardDetail"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) {
        if (id === "modalCardDetail") closeCardDetailModal();
        else e.currentTarget.classList.remove("open");
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isCardDetailOpen()) closeCardDetailModal();
  });
}

function applySectionVisibility() {
  const hasCards = can("fundoManeio", "view");
  const hasExtras = can("pedidosExtras", "view");
  document.getElementById("sectionCards")?.classList.toggle("hidden", !hasCards);
  document.getElementById("sectionGcc")?.classList.toggle("hidden", !hasExtras);
  document.getElementById("sectionExtras")?.classList.toggle("hidden", !hasExtras);
  if (!can("fundoManeio", "create")) {
    document.getElementById("btnNewCard")?.classList.add("hidden");
  }
  updateCardActionButtons();
}

async function guardCentrosGeraisAccess() {
  const user = getSessionUser();
  if (!user) return false;
  await initPermissionLayer();
  if ((user.role || "").toLowerCase() === "admin") return true;
  if (can("pedidosExtras", "view") || can("fundoManeio", "view")) return true;
  return guardPageAccess("pedidosExtras", "view");
}

async function loadInitialData() {
  const projectsData = await apiRequest("/projects?pageSize=200");
  allProjects = projectsData.items || projectsData.projects || [];
  populateProjectSelects();

  const urlParams = new URLSearchParams(window.location.search);
  const urlProjectId = urlParams.get("projectId");
  if (urlProjectId) {
    const cardProjectEl = document.getElementById("filterCardProject");
    if (cardProjectEl) cardProjectEl.value = urlProjectId;
    const cardScopeEl = document.getElementById("filterCardScope");
    if (cardScopeEl) cardScopeEl.value = "obra";
    const projectFilterEl = document.getElementById("filterProject");
    if (projectFilterEl) projectFilterEl.value = urlProjectId;
  }

  if (can("fundoManeio", "view")) {
    await loadCards();
  }
  if (can("pedidosExtras", "view")) {
    await loadCostCategories();
    await loadExtras();
  }
}

(async () => {
  const ok = await guardCentrosGeraisAccess();
  if (!ok) return;
  wireLogout();
  wireUsersNav();
  initMobileMenu();
  await initExtraRequestModal({
    showToast,
    onSuccess: () => loadExtras(),
    getEditItem: (id) => extrasCache.find((e) => e.id === id),
  });
  bindEvents();
  bindSectionToggles();
  bindCentrosMainTabs();
  applySectionVisibility();
  applyCentrosMainTabVisibility();
  initCentroCompras();

  // Catálogo: painéis expandidos na aba correspondente; cartões sempre expandidos na aba Cartões
  if (can("fundoManeio", "view")) {
    setSectionCollapsed("panelCards", false);
  }
  if (can("pedidosExtras", "view")) {
    setSectionCollapsed("panelGcc", false);
    setSectionCollapsed("panelExtras", false);
  }

  if (!can("pedidosExtras", "create")) {
    document.getElementById("btnNewExtra")?.classList.add("hidden");
  } else {
    applyCatalogManageVisibility();
  }

  try {
    await loadInitialData();
  } catch (err) {
    showToast("Erro ao carregar dados: " + err.message, "error");
  }
})();

/* ==========================================================================
   MÓDULO CENTRO DE COMPRAS
   ========================================================================== */

let ccCache = {
    pedidos: [],
    requisicoes: [],
    pagamentos: [],
    dashboard: null,
    pedidosPage: 1,
    pedidosTotal: 0,
    suppliers: [],
    tools: [],
};

// Configuração do Upload (Supabase via Backend)
async function uploadCCFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    // Supondo rota de upload partilhada ou na própria requisição
    const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + localStorage.getItem("token")
        },
        body: formData
    });
    if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Erro no upload");
    }
    const data = await res.json();
    return data.url; // Retorna URL do supabase
}

function openCCModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("active");
    el.classList.add("open");
}

function closeCCModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("open", "active");
}

function switchCCSubTab(tab) {
    document.querySelectorAll(".cc-sub-tab").forEach((b) => {
        const active = b.dataset.ccTab === tab;
        b.classList.toggle("active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".cc-panel").forEach((p) => p.classList.add("hidden"));
    const panelId = `ccPanel${tab.charAt(0).toUpperCase()}${tab.slice(1)}`;
    document.getElementById(panelId)?.classList.remove("hidden");

    if (tab === "dashboard") loadCCDashboard();
    if (tab === "pedidos") loadCCPedidos();
    if (tab === "requisicoes") loadCCRequisicoes();
    if (tab === "planoPagamentos") loadCCPagamentos();
}

function initCentroCompras() {
    document.querySelectorAll(".cc-sub-tab").forEach((btn) => {
        btn.addEventListener("click", () => switchCCSubTab(btn.dataset.ccTab));
    });

    document.getElementById("btnNovoPedido")?.addEventListener("click", async () => {
        const form = document.getElementById("formNovoPedido");
        form?.reset();
        const itemsBody = document.getElementById("ccItemsBody");
        if (itemsBody) itemsBody.innerHTML = "";
        addCCItemRow();
        const due = new Date();
        due.setDate(due.getDate() + 7);
        const desiredEl = document.getElementById("ccPedidoData");
        if (desiredEl) desiredEl.value = due.toISOString().slice(0, 10);
        const user = getSessionUser();
        const solicitante = document.getElementById("ccPedidoSolicitante");
        if (solicitante && !solicitante.value) solicitante.value = user?.name || user?.email || "";
        applyCCTypeVisibility();
        applyCCQuoteRequirementVisibility();
        ccCache.tools = [];
        openCCModal("modalNovoPedido");
        try { await ensureCCReferenceDataLoaded(); } catch { /* ignore */ }
    });
    document.getElementById("ccPedidoType")?.addEventListener("change", applyCCTypeVisibility);
    document.getElementById("ccPedidoRequerCotacao")?.addEventListener("change", applyCCQuoteRequirementVisibility);
    document.getElementById("ccExtraSource")?.addEventListener("change", applyCCPaymentSourceVisibility);
    bindCCSupplierNifLookup();
    bindCCReqSupplierNifLookup();
    document.addEventListener("click", (e) => {
        if (e.target.closest(".cc-item-desc") || e.target.closest(".cc-item-suggest")) return;
        hideAllCCItemSuggest();
    });
    document.getElementById("btnCloseNovoPedido")?.addEventListener("click", () => closeCCModal("modalNovoPedido"));
    document.getElementById("btnCancelNovoPedido")?.addEventListener("click", () => closeCCModal("modalNovoPedido"));
    document.getElementById("btnCCAddItem")?.addEventListener("click", addCCItemRow);
    document.getElementById("formNovoPedido")?.addEventListener("submit", submitNovoPedido);

    document.getElementById("btnCCVerTodos")?.addEventListener("click", () => switchCCSubTab("requisicoes"));

    document.getElementById("btnCloseReqDrawer")?.addEventListener("click", () => {
        document.getElementById("drawerRequisicao")?.classList.remove("open");
    });
    document.getElementById("formCCQuote")?.addEventListener("submit", submitCCQuote);

    document.getElementById("btnCCSubmitApproval")?.addEventListener("click", submitCCForApproval);
    document.getElementById("btnCCApprove")?.addEventListener("click", () => openCCAprovacaoModal("APROVAR"));
    document.getElementById("btnCCReject")?.addEventListener("click", () => openCCAprovacaoModal("REJEITAR"));
    document.getElementById("btnCCCreatePayment")?.addEventListener("click", openCCPlanoModal);

    document.getElementById("btnCancelAprov")?.addEventListener("click", () => closeCCModal("modalAprovacao"));
    document.getElementById("btnConfirmAprov")?.addEventListener("click", submitCCAprovacao);

    document.getElementById("btnClosePlano")?.addEventListener("click", () => closeCCModal("modalPlanoPagamento"));
    document.getElementById("btnCancelPlano")?.addEventListener("click", () => closeCCModal("modalPlanoPagamento"));
    document.getElementById("btnCCAddParcela")?.addEventListener("click", addCCParcelaRow);
    document.getElementById("formPlanoPagamento")?.addEventListener("submit", submitCCPlano);

    const bindFilter = (id, fn) => {
        document.getElementById(id)?.addEventListener("change", fn);
        document.getElementById(id)?.addEventListener("input", fn);
    };
    let pedidosSearchTimer = null;
    bindFilter("ccPedidosFilterStatus", () => { ccCache.pedidosPage = 1; loadCCPedidos(); });
    bindFilter("ccPedidosFilterPriority", () => { ccCache.pedidosPage = 1; loadCCPedidos(); });
    document.getElementById("ccPedidosSearch")?.addEventListener("input", () => {
        clearTimeout(pedidosSearchTimer);
        pedidosSearchTimer = setTimeout(() => { ccCache.pedidosPage = 1; loadCCPedidos(); }, 300);
    });
    let reqSearchTimer = null;
    bindFilter("ccReqFilterStatus", () => loadCCRequisicoes());
    document.getElementById("ccReqSearch")?.addEventListener("input", () => {
        clearTimeout(reqSearchTimer);
        reqSearchTimer = setTimeout(() => loadCCRequisicoes(), 300);
    });

    loadCCDashboard();
}

// ======================== API CALLS ========================

function ccApiError(err) {
    const e = err?.data?.error;
    if (e && typeof e === "object") {
        const fields = e.fieldErrors
            ? Object.entries(e.fieldErrors).flatMap(([k, msgs]) => (msgs || []).map((m) => `${k}: ${m}`))
            : [];
        const form = e.formErrors || [];
        const all = [...form, ...fields].filter(Boolean);
        if (all.length) return all.join(" · ");
    }
    if (typeof e === "string") {
        const map = {
            FORBIDDEN: "Sem permissão para esta acção",
            NOT_FOUND: "Pedido não encontrado",
            REQUISITION_REQUIRED: "Guarde a cotação antes de submeter para aprovação",
            ORDER_NOT_IN_REQUISITION_STATUS: "Este pedido já não está em requisição",
            CANNOT_SUBMIT_IN_CURRENT_STATUS: "Não é possível submeter neste estado",
            ORDER_NOT_PENDING_APPROVAL: "Pedido não está pendente de aprovação",
            ORDER_NOT_APPROVED: "Pedido ainda não está aprovado",
            FILE_REQUIRED: "Seleccione um ficheiro",
            UPLOAD_FAILED: "Falha no envio do ficheiro",
        };
        return map[e] || e;
    }
    return err?.data?.message || err?.message || "Erro desconhecido";
}

function ccOrderNumber(r) {
    return r?.number || r?.requisitionNumber || "—";
}

function ccRequestedBy(r) {
    return r?.requestedByName || r?.requestedBy || "—";
}

function ccOrderValue(r) {
    return r?.requisition?.quotedValue ?? r?.totalValue ?? 0;
}

function ccParseItemTax(notes) {
    const text = String(notes || "");
    const pick = (re) => {
        const m = text.match(re);
        return m ? Number(String(m[1]).replace(",", ".")) : 0;
    };
    return {
        vat: pick(/IVA\s+(\d+(?:[.,]\d+)?)\s*%/i),
        discount: pick(/Desc\.?\s+(\d+(?:[.,]\d+)?)\s*%/i),
    };
}

function ccItemGross(item) {
    const qty = Number(item?.quantity) || 0;
    const price = Number(item?.unitPrice) || 0;
    const base = qty && price ? qty * price : Number(item?.totalPrice) || 0;
    const { vat, discount } = ccParseItemTax(item?.notes);
    return Math.round((base - (base * discount) / 100 + (base * vat) / 100) * 100) / 100;
}

function ccOrderTotalWithTax(r) {
    if (r?.totalWithTax != null && r.totalWithTax !== "") return Number(r.totalWithTax) || 0;
    const items = r?.items || [];
    const fromItems = items.reduce((sum, item) => sum + ccItemGross(item), 0);
    if (fromItems > 0) return fromItems;
    return Number(ccOrderValue(r)) || 0;
}

function ccSupplierName(r) {
    return r?.requisition?.supplierName || r?.supplier?.name || r?.supplierName || "—";
}

function ccItemName(i) {
    return i?.name || i?.description || "—";
}

function ccPriorityHtml(priority) {
    if (priority === "URGENTE") return '<span class="text-red-600 font-bold">Urgente</span>';
    if (priority === "ALTA") return '<span class="text-orange-500 font-bold">Alta</span>';
    return '<span class="text-slate-500">Normal</span>';
}

function ccOpenDetailsBtn(id, label, extraClass = "") {
    return `<button type="button" onclick="openCCReqDrawer('${id}')" class="${extraClass}">${label}</button>`;
}

async function loadCCDashboard() {
    try {
        const data = await apiRequest("/purchase-orders/dashboard");
        const stats = data.kpis || {};
        const recents = data.recentes || [];

        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        setText("ccKpiPedidos", stats.pedidosPendentes || 0);
        setText("ccKpiReq", stats.requisicoesPendentes || 0);
        setText("ccKpiAprov", stats.aprovacoesPendentes || 0);
        setText("ccKpiPag", stats.pagamentosPendentes || 0);
        setText("ccKpiAndamento", stats.emAndamento || 0);
        setText("ccKpiValor", formatCurrency(stats.valorComprometido || 0));

        const badge = document.getElementById("ccKpiBadgeUrgent");
        if (badge) {
            if (stats.pedidosUrgentes > 0) {
                badge.textContent = `${stats.pedidosUrgentes} Urgente(s)`;
                badge.classList.remove("hidden");
            } else {
                badge.classList.add("hidden");
            }
        }

        const tbody = document.getElementById("ccRecentTable");
        if (!tbody) return;

        if (!recents.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-slate-400 text-xs">Sem processos recentes.</td></tr>`;
            return;
        }

        tbody.innerHTML = recents.map((r) => `
            <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                <td class="px-4 py-3 text-xs font-semibold text-slate-900">${escapeHtml(ccOrderNumber(r))}</td>
                <td class="px-4 py-3 text-xs text-slate-600 truncate max-w-[200px]">${escapeHtml(r.description || "—")}</td>
                <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccRequestedBy(r))}</td>
                <td class="px-4 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(ccOrderValue(r))}</td>
                <td class="px-4 py-3"><span class="${ccGetStatusClass(r.status)}">${ccFormatStatus(r.status)}</span></td>
                <td class="px-4 py-3 text-xs text-slate-500">${formatDateBR(r.createdAt)}</td>
                <td class="px-4 py-3 text-center">
                    ${ccOpenDetailsBtn(r.id, "Detalhes", "text-indigo-600 hover:text-indigo-800 text-xs font-bold underline")}
                </td>
            </tr>
        `).join("");
    } catch (err) {
        console.error(err);
        showToast("Erro ao carregar Dashboard de Compras: " + ccApiError(err), "error");
    }
}
window.loadCCDashboard = loadCCDashboard;

async function loadCCPedidos() {
    try {
        const page = ccCache.pedidosPage || 1;
        const params = new URLSearchParams({ page: String(page), pageSize: "20" });
        const status = document.getElementById("ccPedidosFilterStatus")?.value || "";
        const priority = document.getElementById("ccPedidosFilterPriority")?.value || "";
        const search = document.getElementById("ccPedidosSearch")?.value?.trim() || "";
        if (status) params.set("status", status);
        if (priority) params.set("priority", priority);
        if (search) params.set("search", search);

        const res = await apiRequest(`/purchase-orders?${params.toString()}`);
        const data = res.items || [];
        ccCache.pedidos = data;
        ccCache.pedidosTotal = res.total || data.length;
        renderCCPedidos(data);
        renderCCPedidosPagination(res.page || page, res.pageSize || 20, ccCache.pedidosTotal);
    } catch (err) {
        showToast("Erro ao carregar Pedidos: " + ccApiError(err), "error");
        const tbody = document.getElementById("ccPedidosTableBody");
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-red-500 text-xs">${escapeHtml(ccApiError(err))}</td></tr>`;
        }
    }
}

function renderCCPedidosPagination(page, pageSize, total) {
    const el = document.getElementById("ccPedidosPagination");
    if (!el) return;
    const pages = Math.max(1, Math.ceil((total || 0) / pageSize));
    const meta = document.getElementById("ccPedidosMeta");
    if (meta) {
        meta.textContent = total
            ? `${total} pedido${total === 1 ? "" : "s"}`
            : "Nenhum pedido encontrado";
    }
    if (!total) {
        el.innerHTML = "";
        return;
    }
    el.innerHTML = `
        <span>${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} de ${total}</span>
        <span class="flex gap-2">
            <button type="button" class="h-8 px-3 rounded-lg border border-slate-200 bg-white disabled:opacity-40" data-cc-page="prev" ${page <= 1 ? "disabled" : ""}>Anterior</button>
            <button type="button" class="h-8 px-3 rounded-lg border border-slate-200 bg-white disabled:opacity-40" data-cc-page="next" ${page >= pages ? "disabled" : ""}>Seguinte</button>
        </span>`;
    el.querySelector("[data-cc-page='prev']")?.addEventListener("click", () => {
        if (ccCache.pedidosPage > 1) {
            ccCache.pedidosPage -= 1;
            loadCCPedidos();
        }
    });
    el.querySelector("[data-cc-page='next']")?.addEventListener("click", () => {
        ccCache.pedidosPage += 1;
        loadCCPedidos();
    });
}

function renderCCPedidos(data) {
    const tbody = document.getElementById("ccPedidosTableBody");
    if (!tbody) return;

    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-slate-400 text-xs">Nenhum pedido encontrado.</td></tr>`;
        return;
    }
    tbody.innerHTML = data.map((r) => `
        <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
            <td class="px-4 py-3 text-xs font-semibold text-slate-900">${escapeHtml(ccOrderNumber(r))}</td>
            <td class="px-4 py-3 text-xs text-slate-600 max-w-[200px] truncate">${escapeHtml(r.description || "—")}</td>
            <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccRequestedBy(r))}</td>
            <td class="px-4 py-3 text-xs text-slate-500 text-right">${formatCurrency(ccOrderValue(r))}</td>
            <td class="px-4 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(ccOrderTotalWithTax(r))}</td>
            <td class="px-4 py-3 text-xs">${ccPriorityHtml(r.priority)}</td>
            <td class="px-4 py-3"><span class="${ccGetStatusClass(r.status)}">${ccFormatStatus(r.status)}</span></td>
            <td class="px-4 py-3 text-center">
                ${ccOpenDetailsBtn(r.id, `<span class="material-symbols-outlined text-sm">visibility</span>`, "w-8 h-8 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-indigo-600 inline-flex items-center justify-center transition-colors")}
            </td>
        </tr>
    `).join("");
}

async function loadCCRequisicoes() {
    try {
        const params = new URLSearchParams({ pageSize: "50" });
        const status = document.getElementById("ccReqFilterStatus")?.value || "";
        const search = document.getElementById("ccReqSearch")?.value?.trim() || "";
        if (status) params.set("status", status);
        if (search) params.set("search", search);

        const res = await apiRequest(`/purchase-orders?${params.toString()}`);
        let data = res.items || [];
        if (!status) {
            data = data.filter((r) =>
                ["PENDENTE_REQUISICAO", "PENDENTE_APROVACAO", "NAO_APROVADO"].includes(r.status)
            );
        }
        ccCache.requisicoes = data;
        const meta = document.getElementById("ccReqMeta");
        if (meta) {
            meta.textContent = data.length
                ? `${data.length} requisição${data.length === 1 ? "" : "ões"}`
                : "Nenhuma requisição encontrada";
        }
        renderCCRequisicoes(data);
    } catch (err) {
        showToast("Erro ao carregar Requisições: " + ccApiError(err), "error");
    }
}

function renderCCRequisicoes(data) {
    const tbody = document.getElementById("ccReqTableBody");
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-slate-400 text-xs">Nenhuma requisição encontrada.</td></tr>`;
        return;
    }
    tbody.innerHTML = data.map((r) => `
        <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
            <td class="px-4 py-3 text-xs font-bold text-indigo-600">${escapeHtml(ccOrderNumber(r))}</td>
            <td class="px-4 py-3 text-xs text-slate-600 truncate max-w-[150px]">${escapeHtml(r.description || "—")}</td>
            <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccRequestedBy(r))}</td>
            <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccSupplierName(r))}</td>
            <td class="px-4 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(ccOrderValue(r))}</td>
            <td class="px-4 py-3"><span class="${ccGetStatusClass(r.status)}">${ccFormatStatus(r.status)}</span></td>
            <td class="px-4 py-3 text-xs text-slate-500">${formatDateBR(r.createdAt)}</td>
            <td class="px-4 py-3 text-center">
                ${ccOpenDetailsBtn(r.id, "Tratar", "h-8 px-3 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 transition-colors")}
            </td>
        </tr>
    `).join("");
}

async function loadCCPagamentos() {
    try {
        const res = await apiRequest("/purchase-orders?status=EM_PAGAMENTO&pageSize=50");
        const data = res.items || [];
        ccCache.pagamentos = data;
        const tbody = document.getElementById("ccPagTableBody") || document.getElementById("planTableBody");
        if (!tbody) return;
        if (!data.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-slate-400 text-xs">Nenhum pagamento pendente.</td></tr>`;
            return;
        }
        tbody.innerHTML = data.map((r) => `
            <tr class="border-b border-slate-50 hover:bg-slate-50/50">
                <td class="px-4 py-3 text-xs font-bold text-emerald-600">${escapeHtml(ccOrderNumber(r))}</td>
                <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(r.description || "—")}</td>
                <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccSupplierName(r))}</td>
                <td class="px-4 py-3 text-xs font-black text-slate-900 text-right">${formatCurrency(ccOrderValue(r))}</td>
                <td class="px-4 py-3"><span class="${ccGetStatusClass(r.status)}">${ccFormatStatus(r.status)}</span></td>
                <td class="px-4 py-3 text-center">
                    ${ccOpenDetailsBtn(r.id, "Gerir Planos", "h-8 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100")}
                </td>
            </tr>
        `).join("");
    } catch (err) {
        showToast("Erro ao carregar Pagamentos: " + ccApiError(err), "error");
    }
}

// ======================== MODAL NOVO PEDIDO ========================

function addCCItemRow() {
    const tbody = document.getElementById("ccItemsBody");
    if (!tbody) return;
    const tr = document.createElement("tr");
    tr.className = "cc-item-row";
    const tools = ccIsFerramentasCentro();
    tr.innerHTML = `
        <td class="py-2 pr-2 relative">
            <input type="text" required autocomplete="off"
                class="cc-item-desc w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"
                placeholder="${tools ? "Pesquisar no catálogo..." : ""}">
            <div class="cc-item-suggest hidden absolute z-40 left-0 right-0 top-full mt-1 max-h-48 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg text-xs"></div>
        </td>
        <td class="py-2 pr-2"><input type="number" min="1" value="1" required class="cc-item-qty w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
        <td class="py-2 pr-2"><input type="text" placeholder="un, kg, cx" required class="cc-item-unit w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
        <td class="py-2 pr-2"><input type="number" step="0.01" min="0" placeholder="0.00" class="cc-item-price w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
        <td class="py-2 pr-2"><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-vat w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
        <td class="py-2 pr-2"><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-wh w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
        <td class="py-2 pr-2"><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-disc w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
        <td class="py-2 text-right">
            <button type="button" onclick="this.closest('tr').remove()" class="w-8 h-8 rounded bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center">
                <span class="material-symbols-outlined text-sm">delete</span>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    bindCCItemDescSuggest(tr);
}
window.addCCItemRow = addCCItemRow;

function ccIsFerramentasCentro() {
    const key = document.getElementById("ccCentroGeralId")?.value || "";
    const group = ccTipo2Groups().find((g) => catalogSheetGroupKey(g) === key);
    if (group && normalizeCostLabel(group.tipo2).includes("ferrament")) return true;
    const label = document.getElementById("ccCentroGeralId")?.selectedOptions?.[0]?.textContent || "";
    return normalizeCostLabel(label).includes("ferrament");
}

function ccNormalizeToolName(value) {
    return normalizeCostLabel(value).replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function ccFindCachedTool(name) {
    const key = ccNormalizeToolName(name);
    if (!key) return null;
    return (ccCache.tools || []).find((p) => ccNormalizeToolName(p.name) === key) || null;
}

function ccUpsertCachedTool(product) {
    if (!product?.id) return;
    const list = ccCache.tools || [];
    const idx = list.findIndex((p) => p.id === product.id);
    if (idx >= 0) list[idx] = product;
    else {
        const dup = list.findIndex((p) => ccNormalizeToolName(p.name) === ccNormalizeToolName(product.name));
        if (dup >= 0) list[dup] = product;
        else list.push(product);
    }
    ccCache.tools = list;
}

const ccToolEnsureInflight = new Map();

async function ensureCCToolProduct(name, unit) {
    const cleanName = String(name || "").replace(/\s+/g, " ").trim();
    const key = ccNormalizeToolName(cleanName);
    if (!key) return null;
    const cached = ccFindCachedTool(cleanName);
    if (cached) return { ...cached, created: false };
    if (ccToolEnsureInflight.has(key)) return ccToolEnsureInflight.get(key);
    const pending = apiRequest("/products/ensure-tool", {
        method: "POST",
        body: { name: cleanName, unit },
    }).then((product) => {
        ccUpsertCachedTool(product);
        return product;
    }).finally(() => {
        ccToolEnsureInflight.delete(key);
    });
    ccToolEnsureInflight.set(key, pending);
    return pending;
}

async function loadCCToolCatalog() {
    if (ccCache.tools?.length) return ccCache.tools;
    try {
        const data = await apiRequest("/products/tools");
        const seen = new Map();
        for (const p of data.items || []) {
            const key = ccNormalizeToolName(p.name);
            if (!key || seen.has(key)) continue;
            seen.set(key, p);
        }
        ccCache.tools = [...seen.values()];
    } catch {
        ccCache.tools = [];
    }
    return ccCache.tools;
}

function hideAllCCItemSuggest() {
    document.querySelectorAll(".cc-item-suggest").forEach((el) => el.classList.add("hidden"));
}

function applyCCToolToItemRow(tr, product, { created = false } = {}) {
    if (!tr || !product) return;
    tr.dataset.productId = product.id || "";
    const desc = tr.querySelector(".cc-item-desc");
    const unit = tr.querySelector(".cc-item-unit");
    if (desc) desc.value = product.name || desc.value;
    if (unit && product.unit) unit.value = String(product.unit).toLowerCase();
}

function renderCCItemSuggest(tr, query) {
    const box = tr.querySelector(".cc-item-suggest");
    if (!box) return;
    if (!ccIsFerramentasCentro()) {
        box.classList.add("hidden");
        return;
    }
    const q = ccNormalizeToolName(query);
    const tools = ccCache.tools || [];
    const matches = q
        ? tools.filter((p) => ccNormalizeToolName(p.name).includes(q) || ccNormalizeToolName(p.sku || "").includes(q)).slice(0, 8)
        : tools.slice(0, 8);
    const exact = ccFindCachedTool(query);
    const rows = matches.map((p) => `
        <button type="button" data-product-id="${escapeHtml(p.id)}"
            class="cc-suggest-hit w-full text-left px-3 py-2 hover:bg-emerald-50 flex items-center justify-between gap-2">
            <span class="font-semibold text-slate-800">${escapeHtml(p.name)}</span>
            <span class="text-[10px] text-slate-400 uppercase">${escapeHtml(p.unit || "un")}${p.sku ? " · " + escapeHtml(p.sku) : ""}</span>
        </button>
    `).join("");
    const createRow = query.trim().length >= 2 && !exact
        ? `<button type="button" data-create-name="${escapeHtml(query.trim())}"
                class="cc-suggest-create w-full text-left px-3 py-2 hover:bg-amber-50 border-t border-slate-100 text-amber-800 font-semibold">
                Criar e adicionar ao catálogo: “${escapeHtml(query.trim())}”
           </button>`
        : "";
    if (!rows && !createRow) {
        box.classList.add("hidden");
        return;
    }
    box.innerHTML = rows + createRow;
    box.classList.remove("hidden");
}

function bindCCItemDescSuggest(tr) {
    const input = tr.querySelector(".cc-item-desc");
    const box = tr.querySelector(".cc-item-suggest");
    if (!input || input.dataset.suggestBound === "1") return;
    input.dataset.suggestBound = "1";

    input.addEventListener("input", () => {
        delete tr.dataset.productId;
        if (!ccIsFerramentasCentro()) {
            box?.classList.add("hidden");
            return;
        }
        renderCCItemSuggest(tr, input.value);
    });
    input.addEventListener("focus", async () => {
        if (!ccIsFerramentasCentro()) return;
        await loadCCToolCatalog();
        renderCCItemSuggest(tr, input.value);
    });
    input.addEventListener("blur", () => {
        if (!ccIsFerramentasCentro()) return;
        const existing = ccFindCachedTool(input.value);
        if (existing) applyCCToolToItemRow(tr, existing);
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && box && !box.classList.contains("hidden")) {
            const first = box.querySelector("button");
            if (first) {
                e.preventDefault();
                first.click();
            }
        }
        if (e.key === "Escape") box?.classList.add("hidden");
    });
    box?.addEventListener("mousedown", (e) => e.preventDefault());
    box?.addEventListener("click", async (e) => {
        const hit = e.target.closest("[data-product-id]");
        const createBtn = e.target.closest("[data-create-name]");
        if (hit) {
            const product = (ccCache.tools || []).find((p) => p.id === hit.dataset.productId);
            applyCCToolToItemRow(tr, product);
            box.classList.add("hidden");
            return;
        }
        if (createBtn) {
            if (box.dataset.ensuring === "1") return;
            const name = createBtn.dataset.createName;
            const existing = ccFindCachedTool(name);
            if (existing) {
                applyCCToolToItemRow(tr, existing);
                box.classList.add("hidden");
                return;
            }
            const unit = tr.querySelector(".cc-item-unit")?.value || "UN";
            box.dataset.ensuring = "1";
            try {
                const product = await ensureCCToolProduct(name, unit);
                if (product?.id) {
                    applyCCToolToItemRow(tr, product, { created: true });
                    showToast(
                        product.created
                            ? `Ferramenta “${product.name}” adicionada ao catálogo`
                            : `Ferramenta “${product.name}” já existia no catálogo`,
                        "success"
                    );
                }
            } catch (err) {
                showToast(ccApiError(err), "error");
                input.value = name;
            } finally {
                delete box.dataset.ensuring;
            }
            box.classList.add("hidden");
        }
    });
}

async function syncCCItemToolSuggest() {
    const tools = ccIsFerramentasCentro();
    document.getElementById("ccItemsToolHint")?.classList.toggle("hidden", !tools);
    document.querySelectorAll(".cc-item-desc").forEach((input) => {
        input.placeholder = tools ? "Pesquisar no catálogo..." : "";
        input.autocomplete = "off";
    });
    if (tools) await loadCCToolCatalog();
    else hideAllCCItemSuggest();
}

async function ensureCCToolsInCatalog(itemRows) {
    if (!ccIsFerramentasCentro()) return;
    await loadCCToolCatalog();
    const byKey = new Map();
    for (const tr of itemRows) {
        const name = tr.querySelector(".cc-item-desc")?.value?.trim() || "";
        if (!name) continue;
        const key = ccNormalizeToolName(name);
        if (!key) continue;
        if (!byKey.has(key)) {
            byKey.set(key, {
                name,
                unit: tr.querySelector(".cc-item-unit")?.value || "UN",
                rows: [],
            });
        }
        byKey.get(key).rows.push(tr);
    }
    for (const group of byKey.values()) {
        const product = ccFindCachedTool(group.name) || await ensureCCToolProduct(group.name, group.unit);
        if (!product?.id) continue;
        group.rows.forEach((tr) => applyCCToolToItemRow(tr, product));
    }
}

function applyCCTypeVisibility() {
    const type = (document.getElementById("ccPedidoType")?.value || "GERAL").toUpperCase();
    const obraProj = document.getElementById("cc_rowObraProject");
    const obraCent = document.getElementById("cc_rowObraCenter");
    if (obraProj) obraProj.classList.toggle("hidden", type !== "OBRA");
    if (obraCent) obraCent.classList.toggle("hidden", type !== "OBRA");
    populateCCCentrosGerais();
}

function applyCCQuoteRequirementVisibility() {
    const requiresQuote = Boolean(document.getElementById("ccPedidoRequerCotacao")?.checked);
    document.getElementById("cc_extraSupplierBlock")?.classList.toggle("hidden", requiresQuote);
    document.getElementById("cc_extraPaymentBlock")?.classList.toggle("hidden", requiresQuote);
    if (!requiresQuote) applyCCPaymentSourceVisibility();
}

function applyCCPaymentSourceVisibility() {
    const src = document.getElementById("ccExtraSource")?.value || "SOLICITACAO_TRANSFERENCIA";
    const isCard = src === "CARTAO";
    document.getElementById("ccCardRow")?.classList.toggle("hidden", !isCard);
    document.getElementById("ccIbanRow")?.classList.toggle("hidden", isCard);
    document.getElementById("ccSupplierRow")?.classList.remove("hidden");
    document.getElementById("ccProformaRow")?.classList.toggle("hidden", isCard);
}

function upsertCCSupplierOption(supplier) {
    const sel = document.getElementById("ccExtraSupplierId");
    if (!sel || !supplier?.id) return;
    let opt = [...sel.options].find((o) => o.value === supplier.id);
    const label = (supplier.name || supplier.id) + (supplier.nif ? " (" + supplier.nif + ")" : "");
    if (!opt) {
        opt = document.createElement("option");
        opt.value = supplier.id;
        sel.appendChild(opt);
    }
    opt.textContent = label;
    sel.value = supplier.id;
}

function fillCCSupplierFields(supplier) {
    if (!supplier) return;
    const nameEl = document.getElementById("ccExtraSupplierName");
    const nifEl = document.getElementById("ccExtraSupplierNif");
    const ibanEl = document.getElementById("ccExtraSupplierIban");
    if (nameEl) nameEl.value = supplier.name || "";
    if (nifEl) {
        nifEl.value = supplier.nif || "";
        nifEl.dataset.validatedNif = normalizeNif(supplier.nif);
    }
    if (ibanEl) ibanEl.value = supplier.iban || supplier.bankAccounts?.[0]?.iban || ibanEl.value || "";
}

function bindCCSupplierNifLookup() {
    bindNifLookup({
        nifInput: "ccExtraSupplierNif",
        button: "btnCcConsultarNif",
        statusEl: "ccExtraSupplierNifStatus",
        register: true,
        extraBody: () => ({
            iban: document.getElementById("ccExtraSupplierIban")?.value?.trim() || null,
        }),
        onResult: ({ ok, agt, supplier }) => {
            if (!ok) return;
            if (supplier) {
                ccCache.suppliers = ccCache.suppliers || [];
                const idx = ccCache.suppliers.findIndex((s) => s.id === supplier.id);
                if (idx >= 0) ccCache.suppliers[idx] = supplier;
                else ccCache.suppliers.push(supplier);
                upsertCCSupplierOption(supplier);
                fillCCSupplierFields(supplier);
                return;
            }
            if (agt?.nome) {
                const nameEl = document.getElementById("ccExtraSupplierName");
                if (nameEl) nameEl.value = agt.nome;
            }
        },
    });
    document.getElementById("ccExtraSupplierNif")?.addEventListener("input", () => {
        const el = document.getElementById("ccExtraSupplierNif");
        if (el?.dataset?.validatedNif && el.dataset.validatedNif !== normalizeNif(el.value)) {
            delete el.dataset.validatedNif;
        }
    });
}

function upsertCCReqSupplierOption(supplier) {
    const sel = document.getElementById("ccReqSupplierId");
    if (!sel || !supplier?.id) return;
    let opt = [...sel.options].find((o) => o.value === supplier.id);
    const label = (supplier.name || supplier.id) + (supplier.nif ? " (" + supplier.nif + ")" : "");
    if (!opt) {
        opt = document.createElement("option");
        opt.value = supplier.id;
        sel.appendChild(opt);
    }
    opt.textContent = label;
    sel.value = supplier.id;
}

function bindCCReqSupplierNifLookup() {
    bindNifLookup({
        nifInput: "ccReqSupplierNif",
        button: "btnCcReqConsultarNif",
        statusEl: "ccReqSupplierNifStatus",
        register: true,
        onResult: ({ ok, agt, supplier }) => {
            if (!ok) return;
            const nameEl = document.getElementById("ccReqFornecedor");
            if (supplier) {
                ccCache.suppliers = ccCache.suppliers || [];
                const idx = ccCache.suppliers.findIndex((s) => s.id === supplier.id);
                if (idx >= 0) ccCache.suppliers[idx] = supplier;
                else ccCache.suppliers.push(supplier);
                upsertCCReqSupplierOption(supplier);
                upsertCCSupplierOption(supplier);
                if (nameEl) nameEl.value = supplier.name || "";
                const nifEl = document.getElementById("ccReqSupplierNif");
                if (nifEl) {
                    nifEl.value = supplier.nif || "";
                    nifEl.dataset.validatedNif = normalizeNif(supplier.nif);
                }
                return;
            }
            if (agt?.nome && nameEl) nameEl.value = agt.nome;
        },
    });
}

function ccPedidoDomain() {
    const type = (document.getElementById("ccPedidoType")?.value || "GERAL").toUpperCase();
    return type === "OBRA" ? "OBRA" : "GERAL";
}

function ccTipo2Groups() {
    const rows = getCatalogSheetRows().filter((r) => r.domain === ccPedidoDomain());
    return groupCatalogSheetDisplayRows(rows);
}

function ccSyncCostDetail(categoryId, requiresDetail) {
    const hidden = document.getElementById("ccExtraCostCategorySelectedId");
    if (hidden) hidden.value = categoryId || "";
    const detailRow = document.getElementById("cc_rowCostDetailDesc");
    if (!detailRow) return;
    let show = Boolean(requiresDetail);
    if (requiresDetail == null && categoryId) {
        const cat = (costCategories.length ? costCategories : getCachedCategories())
            .find((c) => sameCostId(c.id, categoryId));
        show = Boolean(cat?.requiresDetailText);
    }
    detailRow.classList.toggle("hidden", !show);
    if (!show) {
        const ta = document.getElementById("ccExtraCostDetailDesc");
        if (ta) ta.value = "";
    }
}

function populateCCSubcustos() {
    const centroSel = document.getElementById("ccCentroGeralId");
    const catSel = document.getElementById("ccExtraCostCategoryId");
    if (!catSel) return;
    const key = centroSel?.value || "";
    const group = ccTipo2Groups().find((g) => catalogSheetGroupKey(g) === key);
    const prev = catSel.value;
    const realTipo3 = (group?.variants || []).filter((v) => v.tipo3 && v.tipo3 !== "—");

    if (!group) {
        catSel.disabled = true;
        catSel.innerHTML = `<option value="">Seleccione primeiro o centro geral</option>`;
        ccSyncCostDetail("");
        syncCCItemToolSuggest();
        return;
    }

    if (!realTipo3.length) {
        const pick = group.variants?.[0]?.pickCategoryId || group.tipo2Id;
        catSel.disabled = true;
        catSel.innerHTML = `<option value="${escapeHtml(costIdKey(pick))}">Sem subcustos — este centro é a categoria</option>`;
        catSel.value = costIdKey(pick);
        ccSyncCostDetail(pick, group.variants?.[0]?.requiresDetailText);
        syncCCItemToolSuggest();
        return;
    }

    catSel.disabled = false;
    catSel.innerHTML =
        `<option value="">Seleccione categoria...</option>` +
        realTipo3
            .map((v) => `<option value="${escapeHtml(costIdKey(v.pickCategoryId))}">${escapeHtml(formatCategoryDisplayName(v.tipo3))}</option>`)
            .join("");
    if (prev && realTipo3.some((v) => sameCostId(v.pickCategoryId, prev))) {
        catSel.value = prev;
    }
    const pick = catSel.value;
    const hit = realTipo3.find((v) => sameCostId(v.pickCategoryId, pick));
    ccSyncCostDetail(pick, hit?.requiresDetailText);
    syncCCItemToolSuggest();
}

function populateCCCentrosGerais() {
    const sel = document.getElementById("ccCentroGeralId");
    if (!sel) return;
    const prev = sel.value;
    const groups = ccTipo2Groups();
    const nameCount = groups.reduce((acc, g) => {
        acc[g.tipo2] = (acc[g.tipo2] || 0) + 1;
        return acc;
    }, {});
    sel.innerHTML =
        `<option value="">${groups.length ? "Seleccione centro geral..." : "Sem tipos de custo 2 no catálogo"}</option>` +
        groups
            .map((g) => {
                const key = catalogSheetGroupKey(g);
                const base = formatCategoryDisplayName(g.tipo2);
                const label =
                    nameCount[g.tipo2] > 1 && g.grupo
                        ? `${base} (${formatCategoryDisplayName(g.grupo)})`
                        : base;
                return `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
            })
            .join("");
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    populateCCSubcustos();
}

async function ensureCCReferenceDataLoaded() {
    const projSel = document.getElementById("ccExtraProjectId");
    if (projSel && projSel.options.length <= 1) {
        try {
            const projs = await apiRequest("/projects?limit=500");
            const arr = Array.isArray(projs) ? projs : (projs?.items || projs?.data || []);
            arr.forEach(p => {
                const opt = document.createElement("option");
                opt.value = p.id;
                opt.textContent = (p.code ? p.code + " — " : "") + (p.name || p.id);
                projSel.appendChild(opt);
            });
        } catch (_) { /* ignore */ }
    }
    const supSel = document.getElementById("ccExtraSupplierId");
    if (supSel && supSel.options.length <= 1) {
        try {
            const sups = await apiRequest("/suppliers?limit=500");
            const arr = Array.isArray(sups) ? sups : (sups?.items || sups?.data || []);
            ccCache.suppliers = arr;
            arr.forEach(s => {
                const opt = document.createElement("option");
                opt.value = s.id;
                opt.textContent = (s.name || s.id) + (s.nif ? " (" + s.nif + ")" : "");
                supSel.appendChild(opt);
                upsertCCReqSupplierOption(s);
            });
        } catch (_) { /* ignore */ }
        supSel?.addEventListener("change", function () {
            const v = supSel.value;
            const nifEl = document.getElementById("ccExtraSupplierNif");
            if (!v) {
                if (nifEl) delete nifEl.dataset.validatedNif;
                setNifLookupStatus(document.getElementById("ccExtraSupplierNifStatus"), "");
                return;
            }
            const cached = (ccCache.suppliers || []).find((s) => s.id === v);
            if (cached) {
                fillCCSupplierFields(cached);
                return;
            }
            apiRequest(`/suppliers/${encodeURIComponent(v)}`).then((s) => {
                fillCCSupplierFields(s);
            }).catch(() => { });
        });
    }
    const cardSel = document.getElementById("ccExtraCardId");
    if (cardSel && cardSel.options.length <= 1) {
        try {
            const cards = await apiRequest("/petty-cash/cards?limit=500");
            const arr = Array.isArray(cards) ? cards : (cards?.items || cards?.data || []);
            arr.forEach(c => {
                const opt = document.createElement("option");
                opt.value = c.id;
                opt.textContent = (c.label || c.name || c.id);
                cardSel.appendChild(opt);
            });
        } catch (_) { /* ignore */ }
    }
    const ccSel = document.getElementById("ccExtraCostCenterId");
    if (ccSel && ccSel.options.length <= 1) {
        try {
            const ccs = await apiRequest("/cost-centers?limit=1000");
            const arr = Array.isArray(ccs) ? ccs : (ccs?.items || ccs?.data || []);
            arr.forEach(cc => {
                const opt = document.createElement("option");
                opt.value = cc.id;
                opt.textContent = (cc.code ? cc.code + " — " : "") + (cc.name || cc.id);
                ccSel.appendChild(opt);
            });
        } catch (_) { /* ignore */ }
    }
    const gccSel = document.getElementById("ccCentroGeralId");
    if (gccSel && !gccSel.dataset.ccWired) {
        gccSel.dataset.ccWired = "1";
        gccSel.addEventListener("change", populateCCSubcustos);
    }
    if (!costCategories.length) {
        try {
            costCategories = await loadAllCostCategories("", { includeInactive: true });
        } catch (_) {
            costCategories = getCachedCategories();
        }
    }
    const catSel = document.getElementById("ccExtraCostCategoryId");
    if (catSel && !catSel.dataset.ccWired) {
        catSel.dataset.ccWired = "1";
        catSel.addEventListener("change", function () {
            const v = catSel.value;
            const hiddenSel = document.getElementById("ccExtraCostCategorySelectedId");
            if (hiddenSel) hiddenSel.value = v;
            const centroKey = document.getElementById("ccCentroGeralId")?.value || "";
            const group = ccTipo2Groups().find((g) => catalogSheetGroupKey(g) === centroKey);
            const hit = (group?.variants || []).find((x) => sameCostId(x.pickCategoryId, v));
            ccSyncCostDetail(v, hit?.requiresDetailText);
        });
    }
    populateCCCentrosGerais();
}

async function submitNovoPedido(e) {
    e.preventDefault();
    const requestedByName = document.getElementById("ccPedidoSolicitante")?.value?.trim() || "";
    if (!requestedByName) {
        showToast("Indique o solicitante", "error");
        return;
    }

    const description = document.getElementById("ccPedidoDesc")?.value?.trim() || "";
    if (!description) {
        showToast("Indique a descrição do pedido", "error");
        return;
    }

    const items = Array.from(document.querySelectorAll(".cc-item-row")).map((tr) => {
        const name = tr.querySelector(".cc-item-desc")?.value?.trim() || "";
        const quantity = parseFloat(tr.querySelector(".cc-item-qty")?.value || "0");
        const unit = tr.querySelector(".cc-item-unit")?.value?.trim() || null;
        const priceRaw = tr.querySelector(".cc-item-price")?.value;
        const unitPrice =
            priceRaw === undefined || priceRaw === null || String(priceRaw).trim() === ""
                ? null
                : parseFloat(String(priceRaw));
        const vat = parseFloat(tr.querySelector(".cc-item-vat")?.value || "");
        const wh = parseFloat(tr.querySelector(".cc-item-wh")?.value || "");
        const disc = parseFloat(tr.querySelector(".cc-item-disc")?.value || "");
        const taxBits = [];
        if (Number.isFinite(vat) && vat > 0) taxBits.push(`IVA ${vat}%`);
        if (Number.isFinite(wh) && wh > 0) taxBits.push(`Ret. ${wh}%`);
        if (Number.isFinite(disc) && disc > 0) taxBits.push(`Desc. ${disc}%`);
        return {
            name,
            quantity,
            unit,
            unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : null,
            notes: taxBits.length ? taxBits.join(" · ") : null,
        };
    }).filter((it) => it.name && Number.isFinite(it.quantity) && it.quantity > 0);

    if (!items.length) {
        showToast("Adicione pelo menos um item ao pedido", "error");
        return;
    }

    if (ccIsFerramentasCentro()) {
        try {
            await ensureCCToolsInCatalog(document.querySelectorAll(".cc-item-row"));
        } catch (err) {
            showToast("Não foi possível actualizar o catálogo de ferramentas: " + ccApiError(err), "error");
            return;
        }
    }

    const requiresQuote = Boolean(document.getElementById("ccPedidoRequerCotacao")?.checked ?? true);
    if (!requiresQuote) {
        const supplierId = document.getElementById("ccExtraSupplierId")?.value || "";
        const nif = normalizeNif(document.getElementById("ccExtraSupplierNif")?.value);
        const validated = document.getElementById("ccExtraSupplierNif")?.dataset?.validatedNif || "";
        const name = document.getElementById("ccExtraSupplierName")?.value?.trim() || "";
        if (!supplierId && !nif) {
            showToast("Indique o fornecedor registado ou consulte o NIF para cadastrar um novo.", "error");
            return;
        }
        if (!supplierId && nif && validated !== nif) {
            showToast("Consulte o NIF na AGT antes de gravar o pedido.", "error");
            return;
        }
        if (!name) {
            showToast("O nome do fornecedor é obrigatório. Consulte o NIF para o preencher.", "error");
            return;
        }
        const src = document.getElementById("ccExtraSource")?.value || "SOLICITACAO_TRANSFERENCIA";
        if (src === "SOLICITACAO_TRANSFERENCIA") {
            const iban = document.getElementById("ccExtraSupplierIban")?.value?.trim() || "";
            if (!iban) {
                showToast("Indique o IBAN do fornecedor para a transferência.", "error");
                return;
            }
        }
        if (src === "CARTAO") {
            const cardId = document.getElementById("ccExtraCardId")?.value || "";
            if (!cardId) {
                showToast("Seleccione o cartão multibanco.", "error");
                return;
            }
        }
    }

    const centroSel = document.getElementById("ccCentroGeralId");
    const group = ccTipo2Groups().find((g) => catalogSheetGroupKey(g) === (centroSel?.value || ""));
    if (!group) {
        showToast("Seleccione o centro geral", "error");
        return;
    }
    const realTipo3 = (group.variants || []).filter((v) => v.tipo3 && v.tipo3 !== "—");
    const categoryId =
        document.getElementById("ccExtraCostCategoryId")?.value ||
        document.getElementById("ccExtraCostCategorySelectedId")?.value ||
        "";
    if (realTipo3.length && !categoryId) {
        showToast("Seleccione a categoria de custo", "error");
        return;
    }

    const classification = (document.getElementById("ccPedidoType")?.value || "GERAL").toUpperCase();
    const extraNotes = [
        document.getElementById("ccPedidoJust")?.value?.trim() || "",
        classification === "OBRA"
            ? `Classificação: Obra${document.getElementById("ccExtraProjectId")?.selectedOptions?.[0]?.textContent ? " · " + document.getElementById("ccExtraProjectId").selectedOptions[0].textContent : ""}`
            : "Classificação: Geral",
        `Centro geral: ${centroSel?.selectedOptions?.[0]?.textContent || group.tipo2}`,
        realTipo3.length
            ? `Categoria: ${document.getElementById("ccExtraCostCategoryId")?.selectedOptions?.[0]?.textContent || ""}`
            : null,
        document.getElementById("ccExtraCostDetailDesc")?.value?.trim() || null,
        !Boolean(document.getElementById("ccPedidoRequerCotacao")?.checked)
            ? [
                `Origem pagamento: ${document.getElementById("ccExtraSource")?.selectedOptions?.[0]?.textContent || document.getElementById("ccExtraSource")?.value || ""}`,
                document.getElementById("ccExtraSource")?.value === "CARTAO"
                    ? `Cartão: ${document.getElementById("ccExtraCardId")?.selectedOptions?.[0]?.textContent || ""}`
                    : `IBAN fornecedor: ${document.getElementById("ccExtraSupplierIban")?.value?.trim() || ""}`,
              ].filter(Boolean).join("\n")
            : null,
    ].filter(Boolean).join("\n");

    const user = getSessionUser();
    const payload = {
        type: "PEDIDO",
        priority: document.getElementById("ccPedidoPriority")?.value || "NORMAL",
        requestedByName,
        requestedById: user?.id || user?.sub || null,
        description,
        justification: document.getElementById("ccPedidoJust")?.value?.trim() || null,
        needDate: document.getElementById("ccPedidoData")?.value || null,
        requiresQuote: Boolean(document.getElementById("ccPedidoRequerCotacao")?.checked ?? true),
        supplierId: requiresQuote ? null : (document.getElementById("ccExtraSupplierId")?.value || null),
        supplierName: requiresQuote ? null : (document.getElementById("ccExtraSupplierName")?.value?.trim() || null),
        currency: "AOA",
        notes: extraNotes || null,
        items,
    };

    const btn = document.getElementById("btnSubmitNovoPedido");
    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = "A salvar...";
        }

        const created = await apiRequest("/purchase-orders", { method: "POST", body: payload });
        showToast(`Pedido ${created?.number || ""} criado com sucesso`, "success");
        closeCCModal("modalNovoPedido");

        const activeTab = document.querySelector(".cc-sub-tab.active")?.dataset?.ccTab;
        loadCCDashboard();
        loadCCPedidos();
        if (activeTab === "requisicoes") loadCCRequisicoes();
    } catch (err) {
        showToast(ccApiError(err), "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "Salvar Pedido";
        }
    }
}

// ======================== DRAWER REQUISIÇÃO E WORKFLOW ========================

async function openCCReqDrawer(id) {
    const drawer = document.getElementById("drawerRequisicao");
    if (!drawer) return;
    drawer.classList.add("open");
    const titleEl = document.getElementById("ccReqDrawerTitle");
    if (titleEl) titleEl.textContent = "A carregar...";

    try {
        const order = await apiRequest(`/purchase-orders/${id}`);
        ccCache.currentOrder = order;
        if (titleEl) titleEl.textContent = ccOrderNumber(order);
        const sub = document.getElementById("ccReqDrawerSub");
        if (sub) sub.textContent = order.description || "";

        const setText = (elId, val) => {
            const el = document.getElementById(elId);
            if (el) el.textContent = val;
        };
        setText("ccReqStatusText", ccFormatStatus(order.status));
        setText("ccReqDetailSol", ccRequestedBy(order));
        setText("ccReqDetailPri", order.priority || "NORMAL");
        setText("ccReqDetailJust", order.justification || "Nenhuma justificação");

        const itemsEl = document.getElementById("ccReqDetailItems");
        if (itemsEl) {
            const items = order.items || [];
            itemsEl.innerHTML = items.length
                ? items.map((i) => `
                    <li class="flex justify-between items-center py-1 border-b border-slate-50 last:border-0">
                        <span>${escapeHtml(String(i.quantity))} ${escapeHtml(i.unit || "")} — ${escapeHtml(ccItemName(i))}</span>
                        <span class="font-bold text-slate-900">${formatCurrency(i.totalWithTax ?? ccItemGross(i))}</span>
                    </li>`).join("")
                : `<li class="text-xs text-slate-400">Sem itens</li>`;
        }

        const orderIdEl = document.getElementById("ccReqOrderId");
        if (orderIdEl) orderIdEl.value = order.id;

        const quoteForm = document.getElementById("ccReqQuoteSection");
        const actions = document.getElementById("ccReqFooterActions");
        actions?.querySelectorAll("button").forEach((b) => b.classList.add("hidden"));
        quoteForm?.classList.add("hidden");

        const forn = document.getElementById("ccReqFornecedor");
        const valor = document.getElementById("ccReqValorCotado");
        const nifEl = document.getElementById("ccReqSupplierNif");
        const reqSel = document.getElementById("ccReqSupplierId");
        try { await ensureCCReferenceDataLoaded(); } catch { /* ignore */ }
        if (reqSel && reqSel.options.length <= 1) {
            (ccCache.suppliers || []).forEach((s) => upsertCCReqSupplierOption(s));
        }
        if (reqSel && !reqSel.dataset.ccWired) {
            reqSel.dataset.ccWired = "1";
            reqSel.addEventListener("change", () => {
                const v = reqSel.value;
                const cached = (ccCache.suppliers || []).find((s) => s.id === v);
                if (!cached) return;
                if (forn) forn.value = cached.name || "";
                if (nifEl) {
                    nifEl.value = cached.nif || "";
                    nifEl.dataset.validatedNif = normalizeNif(cached.nif);
                }
            });
        }
        if (reqSel) reqSel.value = order.requisition?.supplierId || order.supplierId || "";
        if (forn) forn.value = ccSupplierName(order) === "—" ? "" : ccSupplierName(order);
        if (nifEl) {
            nifEl.value = order.supplier?.nif || order.requisition?.supplier?.nif || "";
            if (nifEl.value) nifEl.dataset.validatedNif = normalizeNif(nifEl.value);
            else delete nifEl.dataset.validatedNif;
        }
        setNifLookupStatus(document.getElementById("ccReqSupplierNifStatus"), "");
        if (valor) valor.value = order.requisition?.quotedValue || order.totalValue || "";

        if (order.status === "PENDENTE_REQUISICAO") {
            quoteForm?.classList.remove("hidden");
            document.getElementById("btnCCSubmitApproval")?.classList.remove("hidden");
        } else if (order.status === "PENDENTE_APROVACAO") {
            document.getElementById("btnCCApprove")?.classList.remove("hidden");
            document.getElementById("btnCCReject")?.classList.remove("hidden");
        } else if (order.status === "APROVADO") {
            document.getElementById("btnCCCreatePayment")?.classList.remove("hidden");
        } else if (order.status === "NAO_APROVADO") {
            quoteForm?.classList.remove("hidden");
            document.getElementById("btnCCSubmitApproval")?.classList.remove("hidden");
        }

        const attachWrap = document.getElementById("ccReqAttachments");
        const atts = order.requisition?.attachments || [];
        if (attachWrap) {
            attachWrap.innerHTML = atts.length
                ? atts.map((a) => `<a class="block text-xs text-indigo-600 underline truncate" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.fileName)}</a>`).join("")
                : "";
        }

        const timeline = document.getElementById("ccReqTimeline");
        if (timeline) {
            const history = [...(order.history || [])].reverse();
            timeline.innerHTML = history.length
                ? history.map((h, i) => {
                    let c = i === 0 ? "active" : "";
                    if (h.toStatus === "APROVADO") c = "success";
                    if (h.toStatus === "NAO_APROVADO" || h.toStatus === "CANCELADO") c = "error";
                    const label = h.toStatus ? ccFormatStatus(h.toStatus) : (h.action || "Evento");
                    const who = h.userName || "Sistema";
                    return `
                    <div class="cc-timeline-item ${c}">
                        <div class="cc-timeline-dot"></div>
                        <div class="cc-timeline-content">
                            <p class="text-xs font-bold text-slate-900">${escapeHtml(label)}</p>
                            <p class="text-[10px] text-slate-500">${formatDateBR(h.createdAt)} — ${escapeHtml(who)}</p>
                            ${h.notes ? `<p class="text-xs text-slate-600 mt-1 bg-slate-50 p-2 rounded">${escapeHtml(h.notes)}</p>` : ""}
                        </div>
                    </div>`;
                }).join("")
                : `<p class="text-xs text-slate-500">Sem histórico registado.</p>`;
        }
    } catch (err) {
        showToast("Erro ao carregar detalhes: " + ccApiError(err), "error");
        drawer.classList.remove("open");
    }
}
window.openCCReqDrawer = openCCReqDrawer;

async function submitCCQuote(e) {
    e.preventDefault();
    const id = document.getElementById("ccReqOrderId")?.value;
    if (!id) return;
    const fornecedor = document.getElementById("ccReqFornecedor")?.value?.trim() || "";
    const supplierId = document.getElementById("ccReqSupplierId")?.value || null;
    const nif = normalizeNif(document.getElementById("ccReqSupplierNif")?.value);
    const validated = document.getElementById("ccReqSupplierNif")?.dataset?.validatedNif || "";
    if (!supplierId && nif && validated !== nif) {
        showToast("Consulte o NIF na AGT antes de gravar a cotação.", "error");
        return;
    }
    if (!supplierId && !fornecedor) {
        showToast("Indique o fornecedor ou consulte o NIF para cadastrar.", "error");
        return;
    }
    const valRaw = document.getElementById("ccReqValorCotado")?.value;
    const val = valRaw === "" || valRaw == null ? null : parseFloat(valRaw);
    const fileInput = document.getElementById("ccReqFile");

    try {
        await apiRequest(`/purchase-orders/${id}/requisition`, {
            method: "POST",
            body: {
                supplierId: supplierId || null,
                supplierName: fornecedor || null,
                quotedValue: Number.isFinite(val) ? val : null,
            },
        });

        const file = fileInput?.files?.[0];
        if (file) {
            showToast("A anexar proforma...", "info");
            await apiUpload(`/purchase-orders/${id}/requisition/upload`, { file, fieldName: "file" });
        }

        showToast("Cotação guardada", "success");
        if (fileInput) fileInput.value = "";
        await openCCReqDrawer(id);
        loadCCRequisicoes();
        loadCCDashboard();
    } catch (err) {
        showToast(ccApiError(err), "error");
    }
}

async function submitCCForApproval() {
    const id = document.getElementById("ccReqOrderId")?.value;
    if (!id) return;
    try {
        await apiRequest(`/purchase-orders/${id}/submit-for-approval`, { method: "POST" });
        showToast("Submetido para aprovação", "success");
        await openCCReqDrawer(id);
        loadCCDashboard();
        loadCCRequisicoes();
        loadCCPedidos();
    } catch (err) {
        showToast(ccApiError(err), "error");
    }
}

function openCCAprovacaoModal(decision) {
    const id = document.getElementById("ccReqOrderId")?.value;
    if (!id) return;
    document.getElementById("ccAprovOrderId").value = id;
    document.getElementById("ccAprovDecision").value = decision;
    document.getElementById("ccAprovObs").value = "";

    const title = document.getElementById("modalAprovacaoTitle");
    const btn = document.getElementById("btnConfirmAprov");
    if (decision === "APROVAR") {
        if (title) title.textContent = "Aprovar Requisição";
        if (btn) {
            btn.className = "h-10 px-5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700";
            btn.textContent = "Aprovar";
        }
    } else {
        if (title) title.textContent = "Rejeitar Requisição";
        if (btn) {
            btn.className = "h-10 px-5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700";
            btn.textContent = "Rejeitar";
        }
    }
    openCCModal("modalAprovacao");
}
window.openCCAprovacaoModal = openCCAprovacaoModal;

async function submitCCAprovacao() {
    const id = document.getElementById("ccAprovOrderId")?.value;
    const uiDecision = document.getElementById("ccAprovDecision")?.value;
    const observations = document.getElementById("ccAprovObs")?.value?.trim() || null;
    if (!id) return;
    const decision = uiDecision === "APROVAR" ? "APROVADO" : "NAO_APROVADO";
    try {
        await apiRequest(`/purchase-orders/${id}/approve`, {
            method: "POST",
            body: { decision, observations },
        });
        closeCCModal("modalAprovacao");
        showToast(decision === "APROVADO" ? "Requisição aprovada" : "Requisição rejeitada", "success");
        await openCCReqDrawer(id);
        loadCCDashboard();
        loadCCRequisicoes();
        loadCCPedidos();
    } catch (err) {
        showToast(ccApiError(err), "error");
    }
}

function openCCPlanoModal() {
    const id = document.getElementById("ccReqOrderId")?.value;
    if (!id) return;
    document.getElementById("ccPlanoOrderId").value = id;
    const cached = ccCache.currentOrder;
    const currentVal =
        document.getElementById("ccReqValorCotado")?.value ||
        cached?.requisition?.quotedValue ||
        cached?.totalValue ||
        "";
    const totalEl = document.getElementById("ccPlanoTotal");
    if (totalEl) totalEl.value = currentVal || "";
    const container = document.getElementById("ccParcelasContainer");
    if (container) container.innerHTML = "";
    addCCParcelaRow();
    openCCModal("modalPlanoPagamento");
}
window.openCCPlanoModal = openCCPlanoModal;

function addCCParcelaRow() {
    const container = document.getElementById("ccParcelasContainer");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "flex items-center gap-2 cc-parcela-row";
    div.innerHTML = `
        <input type="date" required class="cc-parc-date h-9 px-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none flex-1">
        <input type="number" step="0.01" required placeholder="Valor" class="cc-parc-val h-9 px-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none w-32">
        <button type="button" onclick="this.closest('.cc-parcela-row').remove()" class="w-8 h-9 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-sm">close</span>
        </button>
    `;
    container.appendChild(div);
}

async function submitCCPlano(e) {
    e.preventDefault();
    const id = document.getElementById("ccPlanoOrderId")?.value;
    const total = parseFloat(document.getElementById("ccPlanoTotal")?.value);
    if (!id || !Number.isFinite(total) || total <= 0) {
        showToast("Indique o valor total do plano", "error");
        return;
    }

    const parcelas = Array.from(document.querySelectorAll(".cc-parcela-row")).map((row, idx) => ({
        number: idx + 1,
        dueDate: row.querySelector(".cc-parc-date")?.value,
        amount: parseFloat(row.querySelector(".cc-parc-val")?.value),
    }));

    if (!parcelas.length || parcelas.some((p) => !p.dueDate || !Number.isFinite(p.amount) || p.amount <= 0)) {
        showToast("Preencha data e valor de todas as parcelas", "error");
        return;
    }

    const sum = parcelas.reduce((a, b) => a + b.amount, 0);
    if (Math.abs(sum - total) > 0.01) {
        showToast(`Soma das parcelas (${sum}) não bate com o total (${total})`, "error");
        return;
    }

    try {
        await apiRequest(`/purchase-orders/${id}/payment-plan`, {
            method: "POST",
            body: { totalValue: total, currency: "AOA", installments: parcelas },
        });
        closeCCModal("modalPlanoPagamento");
        showToast("Plano de pagamento criado", "success");
        await openCCReqDrawer(id);
        loadCCPagamentos();
        loadCCDashboard();
        loadCCPedidos();
    } catch (err) {
        showToast(ccApiError(err), "error");
    }
}

// Helpers
function ccFormatStatus(s) {
    const map = {
        'RASCUNHO': 'Rascunho',
        'PENDENTE_REQUISICAO': 'Aguard. Requisição',
        'PENDENTE_APROVACAO': 'Pendente Aprovação',
        'APROVADO': 'Aprovado',
        'NAO_APROVADO': 'Não Aprovado',
        'EM_PAGAMENTO': 'Em Pagamento',
        'CONCLUIDO': 'Concluído',
        'CANCELADO': 'Cancelado'
    };
    return map[s] || s;
}

function ccGetStatusClass(s) {
    const base = "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ";
    if (s === 'PENDENTE_REQUISICAO') return base + "bg-blue-50 text-blue-700";
    if (s === 'PENDENTE_APROVACAO') return base + "bg-amber-50 text-amber-700";
    if (s === 'APROVADO') return base + "bg-emerald-50 text-emerald-700";
    if (s === 'NAO_APROVADO' || s === 'CANCELADO') return base + "bg-red-50 text-red-700";
    if (s === 'EM_PAGAMENTO') return base + "bg-indigo-50 text-indigo-700";
    if (s === 'CONCLUIDO') return base + "bg-slate-100 text-slate-700";
    return base + "bg-slate-100 text-slate-600";
}

