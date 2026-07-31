import { apiRequest } from "/services/api.js";
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
} from "/shared/costCategoryCascade.js";
import {
  buildCostCatalogSheetRows,
  applySheetFilters,
  sheetFilterOptions,
  sheetCellRowspan,
  groupCatalogSheetDisplayRows,
  catalogSheetGroupKey,
  resolveGroupActiveVariant,
  classifyCategorySheetLevel,
  SHEET_LEVEL_LABELS,
  SHEET_TIPO1_FLAT,
} from "/shared/costCategorySheet.js";

let costCategories = [];
let allProjects = [];
let allCards = [];
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

function focusCreatedCatalogItem(categoryId) {
  if (!categoryId) return;
  const sheet = getCatalogSheetRows();
  const hit =
    sheet.find((r) => r.pickCategoryId === categoryId) ||
    sheet.find((r) => r.tipo3Id === categoryId) ||
    sheet.find((r) => r.tipo2Id === categoryId);
  if (!hit) {
    const cat = costCategories.find((c) => c.id === categoryId);
    const lvl = cat ? classifyCategorySheetLevel(cat) : "";
    if (lvl === "TIPO1" || lvl === "GRUPO") {
      showToast("Estrutura criada. Veja na aba «Tipo 1 / Grupo».", "info");
      setCostCatalogTab("estrutura");
    } else {
      showToast("Tipo criado na base de dados. Recarregue a página se não aparecer na tabela.", "info");
    }
    return;
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
    document
      .querySelector(`#costCatalogTipos tr[data-pick-category="${hit.pickCategoryId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
  const tipo3Entries = [{ v: "", label: "Tipo custo 3 — todos" }, ...opts.tipo3.map((t) => ({ v: t, label: t }))];

  bar.innerHTML = `<div class="flex flex-nowrap items-end gap-2 mb-3 p-3 bg-slate-50/90 border border-slate-100 rounded-xl overflow-x-auto">
    ${mkSelect("filterSheetTipo1", "Tipo custo 1", tipo1Entries, catalogSheetFilters.tipo1)}
    ${mkSelect("filterSheetGrupo", "Grupo", grupoEntries, catalogSheetFilters.grupo)}
    ${mkSelect("filterSheetTipo2", "Tipo custo 2", tipo2Entries, catalogSheetFilters.tipo2)}
    ${mkSelect("filterSheetTipo3", "Tipo custo 3", tipo3Entries, catalogSheetFilters.tipo3)}
    <button type="button" id="btnClearSheetFilters" class="h-9 px-3 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 shrink-0 whitespace-nowrap">Limpar filtros</button>
  </div>`;
}

function readCatalogSheetFiltersFromDom() {
  catalogSheetFilters.tipo1 = document.getElementById("filterSheetTipo1")?.value || "";
  catalogSheetFilters.grupo = document.getElementById("filterSheetGrupo")?.value || "";
  catalogSheetFilters.tipo2 = document.getElementById("filterSheetTipo2")?.value || "";
  catalogSheetFilters.tipo3 = document.getElementById("filterSheetTipo3")?.value || "";
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
      const parent = items.find((c) => c.id === btn.dataset.addChildCategory);
      openCostCategoryModal({
        domain: parent?.domain || "GERAL",
        sheetLevel: "SUBCUSTO",
        parentId: btn.dataset.addChildCategory,
      });
    });
  });

  container.querySelectorAll(".cost-catalog-tipo3-select").forEach((sel) => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("mousedown", (e) => e.stopPropagation());
    sel.addEventListener("change", (e) => {
      e.stopPropagation();
      const gkey = sel.dataset.groupKey;
      if (gkey) catalogTipo3PickByGroup[gkey] = sel.value;
      renderCostCatalogTipos();
    });
  });

  container.querySelectorAll(".cost-catalog-table__row[data-pick-category]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (
        e.target.closest(
          "[data-edit-category], [data-delete-category], [data-add-child-category], .cost-catalog-tipo3-select"
        )
      )
        return;
      const id = row.dataset.pickCategory;
      selectedCostCategoryFilter = selectedCostCategoryFilter === id ? "" : id;
      document.getElementById("filterCostCategory").value = selectedCostCategoryFilter;
      renderCostCatalogViews();
      loadExtras();
    });
    row.addEventListener("dblclick", async (e) => {
      if (
        e.target.closest(
          "[data-edit-category], [data-delete-category], [data-add-child-category], .cost-catalog-tipo3-select"
        )
      )
        return;
      if (!can("pedidosExtras", "create")) return;
      const domain = row.dataset.domain;
      if (domain === "VIATURAS") {
        showToast("Custos de viaturas: em breve no pedido extra. Use filtro por agora.", "info");
        return;
      }
      await openExtraRequestModal({
        type: domain === "OBRA" ? "OBRA" : "GERAL",
        costCategoryId: row.dataset.pickCategory,
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

function canManageCostCatalog() {
  return can("pedidosExtras", "create");
}

function canDeleteCostCatalog() {
  return can("pedidosExtras", "delete");
}

function catalogManageActionsHtml(categoryId) {
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

function applyCatalogManageVisibility() {
  const show = canManageCostCatalog();
  document.getElementById("btnNewCostCategory")?.classList.toggle("hidden", true);
  document.getElementById("costCatalogCrudToolbar")?.classList.toggle("hidden", !show);
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
  const container = document.getElementById("toast");
  const colors = {
    success: "bg-emerald-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-slate-800 text-white",
  };
  const icons = { success: "check_circle", error: "error", info: "info" };
  const el = document.createElement("div");
  el.className = `pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl text-sm font-bold ${colors[type]}`;
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
  const items = costCategories.length ? costCategories : getCachedCategories();
  const allSheet = getCatalogSheetRows();
  const rows = applySheetFilters(allSheet, catalogSheetFilters);

  const displayRows = groupCatalogSheetDisplayRows(rows);

  if (meta) {
    meta.textContent = allSheet.length
      ? `${displayRows.length} tipos de custo (${allSheet.length} subcustos no catálogo)`
      : "Catálogo indisponível";
  }
  if (!container) return;

  const actionsHead = canManageCostCatalog()
    ? `<th class="px-3 py-2.5 text-center w-28 border-l border-slate-300">Acções</th>`
    : "";
  const colSpan = canManageCostCatalog() ? 6 : 5;

  const bodyRows = displayRows.length
    ? displayRows
        .map((g, i) => {
          const gkey = catalogSheetGroupKey(g);
          const preferred =
            catalogTipo3PickByGroup[gkey] ||
            (g.variants.some((v) => v.pickCategoryId === selectedCostCategoryFilter)
              ? selectedCostCategoryFilter
              : "");
          const active = resolveGroupActiveVariant(g, preferred);
          const pickId = active?.pickCategoryId || "";
          const selected =
            selectedCostCategoryFilter && selectedCostCategoryFilter === pickId
              ? " cost-catalog-table__row--selected"
              : "";
          const desc = active?.requiresDetailText ? "Preencher no pedido extra" : "—";
          const manageId = active?.tipo3Id || g.tipo2Id;
          const multiTipo3 = g.variants.length > 1;
          const tipo3Cell = multiTipo3
            ? `<select class="cost-catalog-tipo3-select" data-group-key="${escapeHtml(gkey)}" aria-label="Tipo custo 3">
                ${g.variants
                  .map(
                    (v) =>
                      `<option value="${v.pickCategoryId}"${
                        v.pickCategoryId === pickId ? " selected" : ""
                      }>${escapeHtml(v.tipo3)}</option>`
                  )
                  .join("")}
              </select>`
            : `<span class="text-[11px] text-slate-700">${escapeHtml(active?.tipo3 ?? "—")}</span>`;
          const actions = canManageCostCatalog()
            ? `<td class="px-3 py-2 text-center whitespace-nowrap border-l border-slate-200">
                ${catalogManageActionsHtml(manageId)}
                <button type="button" class="cost-catalog-action" data-add-child-category="${g.tipo2Id}" title="Adicionar tipo custo 3">
                  <span class="material-symbols-outlined">add</span>
                </button>
              </td>`
            : "";
          const span1 = sheetCellRowspan(displayRows, i, "tipo1");
          const spanG = sheetCellRowspan(displayRows, i, "grupo");
          const span2 = sheetCellRowspan(displayRows, i, "tipo2");
          const tipo1Cell =
            span1 > 0
              ? `<td rowspan="${span1}" class="px-3 py-2 text-[11px] text-slate-800 align-top border-r border-slate-100 bg-white">${escapeHtml(g.tipo1)}</td>`
              : "";
          const grupoCell =
            spanG > 0
              ? `<td rowspan="${spanG}" class="px-3 py-2 text-[11px] text-slate-600 align-top border-r border-slate-100">${g.grupo ? escapeHtml(g.grupo) : "—"}</td>`
              : "";
          const tipo2Cell =
            span2 > 0
              ? `<td rowspan="${span2}" class="px-3 py-2 text-[11px] font-semibold text-slate-900 align-top border-r border-slate-100">${escapeHtml(g.tipo2)}</td>`
              : "";
          return `<tr class="cost-catalog-table__row${selected}" data-pick-category="${pickId}" data-domain="${g.domain}" data-group-key="${escapeHtml(gkey)}" tabindex="0">
            ${tipo1Cell}
            ${grupoCell}
            ${tipo2Cell}
            <td class="px-3 py-2 border-r border-slate-100 align-middle">${tipo3Cell}</td>
            <td class="px-3 py-2 text-[11px] text-slate-500 italic cost-catalog-desc-cell">${desc}</td>
            ${actions}
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="${colSpan}" class="px-4 py-8 text-center text-xs text-slate-400">Nenhuma linha com estes filtros.</td></tr>`;

  container.innerHTML = `
    <div class="overflow-x-auto border border-slate-200 rounded-lg max-h-[560px] overflow-y-auto">
      <table class="cost-catalog-table cost-catalog-table--sheet w-full text-left">
        <thead class="sticky top-0 z-[1]">
          <tr class="bg-slate-200/95 text-[10px] font-black uppercase text-slate-700 border-b border-slate-300">
            <th class="px-3 py-2.5 border-r border-slate-300">Tipo custo 1</th>
            <th class="px-3 py-2.5 border-r border-slate-300 w-24">Grupo</th>
            <th class="px-3 py-2.5 border-r border-slate-300">Tipo custo 2</th>
            <th class="px-3 py-2.5 border-r border-slate-300">Tipo custo 3</th>
            <th class="px-3 py-2.5 border-r border-slate-300">Descrição custo</th>
            ${actionsHead}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;

  bindCatalogSheetRowEvents(container, items);
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
      classifyCategorySheetLevel(c) === level &&
      !(level === "TIPO1" && (c.code?.includes("_PRODUCAO") || String(c.name).toUpperCase().includes("PRODUÇÃO")))
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
          `<option value="${c.id}"${c.id === selectedId ? " selected" : ""}>${formatCategoryDisplayName(c.name)}</option>`
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
      c.parentId === tipo1Id &&
      classifyCategorySheetLevel(c) === "GRUPO"
  );
  select.innerHTML =
    `<option value="">— Directamente sob tipo 1 —</option>` +
    grupos
      .map(
        (c) =>
          `<option value="${c.id}"${c.id === selectedId ? " selected" : ""}>${formatCategoryDisplayName(c.name)}</option>`
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
      return `<option value="${c.id}"${c.id === selectedId ? " selected" : ""}>${path || formatCategoryDisplayName(c.name)}</option>`;
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
  const rows = applySheetFilters(getCatalogSheetRows(), catalogSheetFilters);
  return groupCatalogSheetDisplayRows(rows).find((g) => catalogSheetGroupKey(g) === gkey) || null;
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
          `<option value="${t.id}"${t.id === activeEditId ? " selected" : ""}>${escapeHtml(t.label)}</option>`
      )
      .join("");
    sel.disabled = targets.length <= 1;
  }
}

function hideCatalogLineContextUI() {
  activeCatalogLineForModal = null;
  document.getElementById("rowCostCategoryLineContext")?.classList.add("hidden");
}

function fillCostCategoryParentFields(item, level) {
  if (!item) return;
  if (level === "GRUPO" && item.parentId) {
    document.getElementById("costCategoryTipo1Id").value = item.parentId;
  }
  if (level === "TIPO2" && item.domain === "GERAL" && item.parentId) {
    const parent = costCategories.find((c) => c.id === item.parentId);
    if (parent && classifyCategorySheetLevel(parent) === "GRUPO") {
      document.getElementById("costCategoryGrupoId").value = parent.id;
      document.getElementById("costCategoryTipo1Id").value = parent.parentId || "";
    } else if (parent) {
      document.getElementById("costCategoryGrupoId").value = "";
      document.getElementById("costCategoryTipo1Id").value = parent.id;
    }
  }
  if (level === "SUBCUSTO" && item.parentId) {
    document.getElementById("costCategoryParentId").value = item.parentId;
    if (item.domain !== "GERAL") return;
    const tipo2 = costCategories.find((c) => c.id === item.parentId);
    if (!tipo2?.parentId) return;
    const p = costCategories.find((c) => c.id === tipo2.parentId);
    if (p && classifyCategorySheetLevel(p) === "GRUPO") {
      document.getElementById("costCategoryTipo1Id").value = p.parentId || "";
      document.getElementById("costCategoryGrupoId").value = p.id;
    } else if (p) {
      document.getElementById("costCategoryTipo1Id").value = p.id;
      document.getElementById("costCategoryGrupoId").value = "";
    }
  }
}

function loadCostCategoryEditFields(item) {
  if (!item) return;
  const level = classifyCategorySheetLevel(item);
  document.getElementById("costCategoryEditId").value = item.id;
  setCostCategoryDomainValue(item.domain);
  document.getElementById("costCategorySheetLevel").value = level;
  document.getElementById("costCategoryName").value = item.name;
  document.getElementById("costCategorySelectable").checked = item.isSelectable !== false;
  document.getElementById("costCategoryRequiresDetail").checked = Boolean(item.requiresDetailText);
  document.getElementById("costCategorySortOrder").value = item.sortOrder ?? "";
  fillCostCategoryParentFields(item, level);
  document.getElementById("modalCostCategoryTitle").textContent = `Editar ${SHEET_LEVEL_LABELS[level] || "entrada"}`;
  syncCostCategoryFormForLevel();
}

function renderEstruturaCatalog() {
  const container = document.getElementById("estruturaCatalog");
  if (!container) return;
  const domain = "GERAL";
  const tipo1s = categoriesBySheetLevel(domain, "TIPO1");
  const grupos = categoriesBySheetLevel(domain, "GRUPO");
  const actionsHead = canManageCostCatalog()
    ? `<th class="px-3 py-2.5 text-center w-28">Acções</th>`
    : "";
  const colSpan = canManageCostCatalog() ? 4 : 3;

  const rows = [];
  tipo1s.forEach((t1) => {
    rows.push({ kind: "TIPO1", tipo1: t1, grupo: null });
    grupos
      .filter((g) => g.parentId === t1.id)
      .forEach((g) => rows.push({ kind: "GRUPO", tipo1: t1, grupo: g }));
  });

  const body = rows.length
    ? rows
        .map(({ kind, tipo1, grupo }) => {
          const cat = kind === "TIPO1" ? tipo1 : grupo;
          const actions = canManageCostCatalog() ? `<td class="px-3 py-2 text-center">${catalogManageActionsHtml(cat.id)}</td>` : "";
          return `<tr class="cost-catalog-table__row" data-pick-category="${cat.id}" tabindex="0">
            <td class="px-3 py-2 text-[11px] font-semibold">${formatCategoryDisplayName(tipo1.name)}</td>
            <td class="px-3 py-2 text-[11px]">${grupo ? formatCategoryDisplayName(grupo.name) : "—"}</td>
            <td class="px-3 py-2 text-[10px] uppercase text-slate-500">${SHEET_LEVEL_LABELS[kind]}</td>
            ${actions}
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="${colSpan}" class="px-4 py-8 text-center text-xs text-slate-400">Sem tipos 1 / grupos neste domínio. Use + Tipo 1 ou + Grupo.</td></tr>`;

  container.innerHTML = `
    <div class="overflow-x-auto border border-slate-200 rounded-lg">
      <table class="cost-catalog-table cost-catalog-table--sheet w-full text-left">
        <thead>
          <tr class="bg-slate-200/90 text-[10px] font-black uppercase text-slate-700">
            <th class="px-3 py-2.5">Tipo custo 1</th>
            <th class="px-3 py-2.5">Grupo</th>
            <th class="px-3 py-2.5">Nível</th>
            ${actionsHead}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
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
  document.getElementById("costCategoryEditId").value = "";
  document.getElementById("costCategorySheetLevel").disabled = false;
  document.getElementById("costCategoryTipo1Id").disabled = false;
  document.getElementById("costCategoryGrupoId").disabled = false;

  if (editId) {
    document.getElementById("costCategoryEditId").value = editId;
    document.getElementById("costCategorySheetLevel").disabled = true;
    const item = costCategories.find((c) => c.id === editId);
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
    document.getElementById("modalCostCategoryTitle").textContent = `Novo ${SHEET_LEVEL_LABELS[sheetLevel] || "entrada"}`;
    if (parentId) document.getElementById("costCategoryParentId").value = parentId;
    if (tipo1Id) document.getElementById("costCategoryTipo1Id").value = tipo1Id;
    if (grupoId) document.getElementById("costCategoryGrupoId").value = grupoId;
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
      const created = await apiRequest("/cost-categories", {
        method: "POST",
        body: {
          domain,
          parentId,
          name,
          sheetLevel,
          isSelectable: sheetLevel === "TIPO1" || sheetLevel === "GRUPO" ? false : isSelectable,
          requiresDetailText,
          ...(sortOrder !== undefined && !Number.isNaN(sortOrder) ? { sortOrder } : {}),
        },
      });
      showToast("Entrada criada", "success");
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
      ({ PARENT_TIPO1_REQUIRED: "Seleccione o tipo custo 1.", PARENT_TIPO2_REQUIRED: "Seleccione o tipo custo 2." }[
        err?.data?.error
      ] ||
        err?.data?.message ||
        err.message ||
        "Erro ao guardar");
    showToast(msg, "error");
  }
}

async function deleteCostCategory(id) {
  const item = costCategories.find((c) => c.id === id);
  const label = item ? formatCategoryDisplayName(item.name) : "esta entrada";
  if (!confirm(`Eliminar ou desactivar «${label}»?`)) return;
  try {
    const res = await apiRequest(`/cost-categories/${id}`, { method: "DELETE" });
    if (res.softDeleted) {
      showToast("Desactivada (existem pedidos que a usam)", "info");
    } else {
      showToast("Eliminada", "success");
    }
    if (selectedCostCategoryFilter === id) {
      selectedCostCategoryFilter = "";
      document.getElementById("filterCostCategory").value = "";
    }
    await reloadCostCatalog();
    loadExtras();
  } catch (err) {
    showToast(err?.data?.message || err.message || "Não foi possível eliminar", "error");
  }
}

async function reloadCostCatalog() {
  costCategories = await loadAllCostCategories("", { includeInactive: true });
  populateCostCategoryFilter();
  renderCostCatalogViews();
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
    const item = costCategories.find((c) => c.id === id);
    if (item) loadCostCategoryEditFields(item);
  });

  document.getElementById("panelGcc")?.addEventListener("change", (e) => {
    const sel = e.target.closest(".cost-sheet-filter");
    if (!sel) return;
    const cascadeFrom = {
      filterSheetTipo1: "tipo1",
      filterSheetGrupo: "grupo",
      filterSheetTipo2: "tipo2",
      filterSheetTipo3: "tipo3",
    }[sel.id];
    if (!cascadeFrom) return;
    readCatalogSheetFiltersFromDom();
    resetCatalogSheetFiltersCascade(cascadeFrom);
    renderCostCatalogViews();
  });

  document.getElementById("panelGcc")?.addEventListener("click", (e) => {
    if (e.target.closest("#btnClearSheetFilters")) {
      catalogSheetFilters = { tipo1: "", grupo: "", tipo2: "", tipo3: "" };
      renderCostCatalogViews();
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
  document.getElementById("extraProjectId").innerHTML =
    `<option value="">Selecionar obra...</option>${opts}`;
  document.getElementById("filterProject").innerHTML =
    `<option value="">Todas as obras</option>${opts}`;
  document.getElementById("filterCardProject").innerHTML =
    `<option value="">Todas as obras</option>${opts}`;
  document.getElementById("cardProjectId").innerHTML =
    `<option value="">Selecionar obra...</option>${opts}`;
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
    <td class="px-5 py-3 text-xs font-semibold text-slate-700 max-w-[200px] truncate">${it.description}</td>
    <td class="px-5 py-3 text-xs text-slate-500">${sourceLabel}</td>
    <td class="px-5 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(it.amount, it.currency)}</td>
    <td class="px-5 py-3">${statusBadge}</td>
    <td class="px-5 py-3 text-center">${actionsHtml}</td>
  </tr>`;
}

async function loadExtras() {
  const tbody = document.getElementById("extrasTableBody");
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
  const cards = getFilteredManagedCards();
  if (!cards.length) {
    grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-12 text-slate-400">
      <span class="material-symbols-outlined text-4xl mb-2">credit_card</span>
      <p class="text-sm font-semibold">Nenhum cartão encontrado</p>
    </div>`;
    return;
  }
  grid.innerHTML = cards
    .map((c) => {
      const active = c.id === selectedCardId;
      const balance = Number(c.currentBalance || 0);
      const scope = cardScopeLabel(c);
      const scopeBadge = c.projectId
        ? `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-sky-100 text-sky-700">${scope}</span>`
        : `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-violet-100 text-violet-700">Global</span>`;
      const meta = [c.bank, c.holderName, CARD_TYPE_LABELS[c.type] || c.type].filter(Boolean).join(" · ");
      return `<button type="button" data-card-id="${c.id}"
        class="card-item ${active ? "card-item--active" : ""}">
        <div class="flex items-start justify-between gap-2 mb-2">${scopeBadge}</div>
        <p class="text-xs font-bold text-slate-400 uppercase tracking-wide truncate">${c.label}${c.lastDigits ? ` •••• ${c.lastDigits}` : ""}</p>
        <p class="text-2xl font-bold text-slate-900 mt-1">${formatCurrency(balance, c.currency)}</p>
        <p class="text-[11px] text-slate-400 mt-1">${meta || "Cartão"}</p>
        <span class="fund-card__hint"><span class="material-symbols-outlined text-sm">open_in_new</span> Ver detalhes</span>
      </button>`;
    })
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

function openCardFormModal(cardId = "") {
  document.getElementById("formCard").reset();
  document.getElementById("cardEditId").value = "";
  document.getElementById("cardCurrency").value = "AOA";
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
    document.getElementById("cardType").value = card.type || "PREPAGO";
    document.getElementById("cardBank").value = card.bank || "";
    document.getElementById("cardLastDigits").value = card.lastDigits || "";
    document.getElementById("cardHolderName").value = card.holderName || "";
    document.getElementById("cardCurrency").value = card.currency || "AOA";
    if (card.projectId) {
      setCardScope("obra");
      document.getElementById("cardProjectId").value = card.projectId;
    } else {
      setCardScope("global");
    }
  }

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
  const body = {
    label: document.getElementById("cardLabel").value.trim(),
    type: document.getElementById("cardType").value,
    bank: document.getElementById("cardBank").value.trim() || null,
    lastDigits: document.getElementById("cardLastDigits").value.trim() || null,
    holderName: document.getElementById("cardHolderName").value.trim() || null,
    currency: document.getElementById("cardCurrency").value.trim() || "AOA",
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
    document.getElementById("filterCardProject").value = urlProjectId;
    document.getElementById("filterCardScope").value = "obra";
    document.getElementById("filterProject").value = urlProjectId;
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
  applySectionVisibility();

  // Por defeito: cartões expandidos; restantes colapsados (se visíveis)
  if (can("fundoManeio", "view")) {
    setSectionCollapsed("panelGcc", true);
    setSectionCollapsed("panelExtras", true);
  } else {
    setSectionCollapsed("panelCards", true);
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
