import { apiRequest } from "/services/api.js";

const DOMAIN_BY_EXTRA_TYPE = {
  GERAL: "GERAL",
  OBRA: "OBRA",
};

let categoriesCache = null;

export function extraTypeToCostDomain(extraType) {
  return DOMAIN_BY_EXTRA_TYPE[extraType] || "GERAL";
}

export async function loadAllCostCategories(domain = "", { includeInactive = false } = {}) {
  const params = new URLSearchParams({ all: "true" });
  if (domain) params.set("domain", domain);
  if (includeInactive) params.set("includeInactive", "true");
  const data = await apiRequest(`/cost-categories?${params.toString()}`);
  categoriesCache = data.items || [];
  return categoriesCache;
}

export function getCachedCategories() {
  return categoriesCache || [];
}

/** Normaliza id de CostCategory (int na API, string em data-*). */
export function costIdKey(id) {
  if (id == null || id === "") return "";
  return String(id);
}

export function sameCostId(a, b) {
  const ka = costIdKey(a);
  const kb = costIdKey(b);
  return Boolean(ka) && ka === kb;
}

export function formatCategoryDisplayName(name) {
  if (!name) return "";
  const s = String(name).trim();
  if (!s) return "";
  // Não usar \b — em JS só [A-Z0-9_] conta como "palavra", logo acentos (í, ç, ã…) geram maiúsculas a meio termo.
  return s
    .toLocaleLowerCase("pt-PT")
    .replace(/(^|[\s/(-]+)(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase("pt-PT"));
}

export function buildCategoryPath(categoryId, items = categoriesCache || []) {
  if (!categoryId || !items.length) return "";
  const byId = new Map(items.map((c) => [costIdKey(c.id), c]));
  const parts = [];
  let cur = byId.get(costIdKey(categoryId));
  while (cur) {
    parts.push(formatCategoryDisplayName(cur.name));
    cur = cur.parentId ? byId.get(costIdKey(cur.parentId)) : null;
  }
  parts.reverse();
  return parts.join(" › ");
}

export function formatExtraCostLabel(extra) {
  if (extra?.costCategory?.name) {
    const path = buildCategoryPath(extra.costCategory.id);
    const detail = extra.costDetailDescription?.trim();
    if (detail) return `${path || formatCategoryDisplayName(extra.costCategory.name)} — ${detail}`;
    return path || formatCategoryDisplayName(extra.costCategory.name);
  }
  if (extra?.generalCostCenter?.name) return extra.generalCostCenter.name;
  return "—";
}

function childrenOf(parentId, domain, items) {
  return items
    .filter((c) => c.domain === domain && costIdKey(c.parentId || "") === costIdKey(parentId || ""))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt"));
}

function hasChildren(id, domain, items) {
  return items.some((c) => c.domain === domain && sameCostId(c.parentId, id));
}

/** Rubricas de 1.º nível (folha TIPO CUSTOS) por domínio. */
export function sheetRubricsForDomain(domain, items = categoriesCache || []) {
  return items
    .filter(
      (c) =>
        c.domain === domain &&
        c.parentId === null &&
        !c.code.includes("_FAM_") &&
        !c.code.includes("_GRP_") &&
        c.isSelectable
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt"));
}

/** Onde continuar a cascata depois de escolher a rubrica (ex.: empréstimos sob família Outros). */
function subcascadeEntryParentIds(rubric, domain, items) {
  const direct = childrenOf(rubric.id, domain, items);
  if (direct.length) return [{ parentId: rubric.id, label: "Detalhe" }];

  const sameNameNodes = items.filter(
    (c) =>
      c.domain === domain &&
      !sameCostId(c.id, rubric.id) &&
      c.name.toUpperCase() === rubric.name.toUpperCase()
  );
  const entries = [];
  sameNameNodes.forEach((node) => {
    const kids = childrenOf(node.id, domain, items);
    if (kids.length) entries.push({ parentId: node.id, label: "Tipo custo 3" });
  });
  return entries;
}

function resolveLeafFromSelects(selects, domain, items, hidden) {
  for (let i = selects.length - 1; i >= 0; i -= 1) {
    const val = selects[i]?.value;
    if (!val) continue;
    const node = items.find((c) => sameCostId(c.id, val));
    if (node && node.isSelectable && !hasChildren(node.id, domain, items)) {
      hidden.value = costIdKey(node.id);
      return;
    }
  }
  const rubricVal = selects[0]?.value;
  if (rubricVal) {
    const rubric = items.find((c) => sameCostId(c.id, rubricVal));
    if (rubric?.isSelectable && !hasChildren(rubric.id, domain, items)) {
      hidden.value = costIdKey(rubric.id);
      return;
    }
  }
  hidden.value = "";
}

/**
 * Fluxo pedido extra: Tipo custo 2 → Tipo custo 3 (cascata).
 */
export function mountRubricFirstCascade({
  container,
  summaryEl,
  hiddenInputId,
  detailRowId,
  detailInputId,
  domain,
  initialCategoryId = "",
  disabled = false,
  onChange = () => {},
}) {
  if (!container) return;
  const items = getCachedCategories();
  container.innerHTML = "";

  const hidden = document.getElementById(hiddenInputId);
  const detailRow = detailRowId ? document.getElementById(detailRowId) : null;
  const detailInput = detailInputId ? document.getElementById(detailInputId) : null;
  const summary = typeof summaryEl === "string" ? document.getElementById(summaryEl) : summaryEl;

  if (!items.length) {
    container.innerHTML = `<p class="text-xs text-slate-400">Catálogo indisponível.</p>`;
    if (hidden) hidden.value = "";
    return;
  }

  const rubrics = sheetRubricsForDomain(domain, items);
  const subSelects = [];

  function syncDetailField(categoryId) {
    if (!detailRow || !detailInput) return;
    const cat = items.find((c) => sameCostId(c.id, categoryId));
    const show = Boolean(cat?.requiresDetailText);
    detailRow.classList.toggle("hidden", !show);
    detailInput.required = show;
    if (!show) detailInput.value = "";
  }

  function updateSummary(categoryId) {
    if (!summary) return;
    if (!categoryId) {
      summary.textContent = "Seleccione o tipo custo 2 e, se existir, o tipo custo 3.";
      summary.classList.add("text-slate-400");
      summary.classList.remove("text-emerald-700");
      return;
    }
    summary.textContent = buildCategoryPath(categoryId, items);
    summary.classList.remove("text-slate-400");
    summary.classList.add("text-emerald-700");
  }

  function clearSubSelects() {
    while (subSelects.length) {
      const el = subSelects.pop();
      el.parentElement?.remove();
    }
  }

  function refreshHidden() {
    resolveLeafFromSelects([rubricSelect, ...subSelects], domain, items, hidden);
    const leafId = hidden.value;
    syncDetailField(leafId);
    updateSummary(leafId);
    onChange(leafId ? items.find((c) => sameCostId(c.id, leafId)) : null);
  }

  function appendSubSelect(parentId, label, options, selectedId = "") {
    const wrap = document.createElement("div");
    wrap.className = "cost-cascade-field";
    const lab = document.createElement("label");
    lab.className = "cost-cascade-field__label";
    lab.textContent = label;
    const sel = document.createElement("select");
    sel.className = "cost-cascade-field__select";
    sel.disabled = disabled;
    sel.innerHTML =
      `<option value="">Seleccionar...</option>` +
      options
        .map(
          (o) =>
            `<option value="${o.id}">${formatCategoryDisplayName(o.name)}${
              o.isSelectable && !hasChildren(o.id, domain, items) ? "" : ""
            }</option>`
        )
        .join("");
    if (selectedId) sel.value = costIdKey(selectedId);

    sel.addEventListener("change", () => {
      while (subSelects.length > subSelects.indexOf(sel) + 1) {
        const removed = subSelects.pop();
        removed.parentElement?.remove();
      }
      const id = sel.value;
      if (id && hasChildren(id, domain, items)) {
        appendSubSelect(id, "Tipo custo 3", childrenOf(id, domain, items));
      }
      refreshHidden();
    });

    wrap.appendChild(lab);
    wrap.appendChild(sel);
    container.appendChild(wrap);
    subSelects.push(sel);
  }

  function onRubricChange(presetSubPath = []) {
    clearSubSelects();
    if (!rubricSelect.value) {
      refreshHidden();
      return;
    }
    const rubric = items.find((c) => sameCostId(c.id, rubricSelect.value));
    const entries = subcascadeEntryParentIds(rubric, domain, items);

    if (entries.length === 1) {
      appendSubSelect(
        entries[0].parentId,
        entries[0].label,
        childrenOf(entries[0].parentId, domain, items)
      );
    } else if (entries.length > 1) {
      appendSubSelect(
        entries[0].parentId,
        "Tipo custo 3",
        childrenOf(entries[0].parentId, domain, items)
      );
    }

    if (presetSubPath.length) {
      presetSubPath.forEach((id, idx) => {
        if (subSelects[idx]) {
          subSelects[idx].value = costIdKey(id);
          subSelects[idx].dispatchEvent(new Event("change"));
        }
      });
    } else {
      refreshHidden();
    }
  }

  const rubricWrap = document.createElement("div");
  rubricWrap.className = "cost-cascade-field";
  const rubricLabel = document.createElement("label");
  rubricLabel.className = "cost-cascade-field__label";
  rubricLabel.textContent = "Tipo custo 2";
  const rubricSelect = document.createElement("select");
  rubricSelect.className = "cost-cascade-field__select";
  rubricSelect.disabled = disabled;
  rubricSelect.innerHTML =
    `<option value="">Seleccionar tipo custo 2...</option>` +
    rubrics.map((r) => `<option value="${r.id}">${formatCategoryDisplayName(r.name)}</option>`).join("");
  rubricSelect.addEventListener("change", () => onRubricChange());
  rubricWrap.appendChild(rubricLabel);
  rubricWrap.appendChild(rubricSelect);
  container.appendChild(rubricWrap);

  if (initialCategoryId) {
    const path = [];
    let cur = items.find((c) => sameCostId(c.id, initialCategoryId));
    while (cur) {
      path.unshift(costIdKey(cur.id));
      cur = cur.parentId ? items.find((c) => sameCostId(c.id, cur.parentId)) : null;
    }
    const rubricInPath = path.find((id) => rubrics.some((r) => sameCostId(r.id, id)));
    if (rubricInPath) {
      rubricSelect.value = costIdKey(rubricInPath);
      const subPath = path.slice(path.indexOf(rubricInPath) + 1);
      onRubricChange(subPath);
      hidden.value = costIdKey(initialCategoryId);
      syncDetailField(initialCategoryId);
      updateSummary(initialCategoryId);
    }
  } else {
    updateSummary("");
  }
}

export function resetCostCategoryCascade(container, hiddenInputId, detailRowId, detailInputId) {
  if (container) container.innerHTML = "";
  const hidden = document.getElementById(hiddenInputId);
  if (hidden) hidden.value = "";
  const detailRow = detailRowId ? document.getElementById(detailRowId) : null;
  const detailInput = detailInputId ? document.getElementById(detailInputId) : null;
  detailRow?.classList.add("hidden");
  if (detailInput) {
    detailInput.value = "";
    detailInput.required = false;
  }
  const summary = document.getElementById("extraCostSelectionSummary");
  if (summary) {
    summary.textContent = "Seleccione o tipo custo 2 e, se existir, o tipo custo 3.";
    summary.classList.add("text-slate-400");
    summary.classList.remove("text-emerald-700");
  }
}

export const COST_CASCADE_IDS = {
  container: "extraCostCategoryCascade",
  hidden: "extraCostCategoryId",
  detailRow: "rowCostDetailDescription",
  detailInput: "extraCostDetailDescription",
  summary: "extraCostSelectionSummary",
};

export const DOMAIN_LABELS = {
  GERAL: "Custo gerais",
  OBRA: "Custos de obra",
  VIATURAS: "Viaturas e equipamentos",
};

export const DOMAIN_META = {
  GERAL: { icon: "account_balance_wallet", accent: "emerald" },
  OBRA: { icon: "construction", accent: "sky" },
  VIATURAS: { icon: "local_shipping", accent: "amber" },
};

/** @deprecated use mountRubricFirstCascade */
export function mountCostCategoryCascade(opts) {
  mountRubricFirstCascade(opts);
}
