import { apiRequest } from "/services/api.js";
import {
  buildCostCatalogSheetRows,
  sheetFilterOptions,
  applySheetFilters,
  groupCatalogSheetDisplayRows,
} from "/shared/costCategorySheet.js";

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

/** Rubricas seleccionáveis (folha) por domínio — tipos custo 2. */
export function sheetRubricsForDomain(domain, items = categoriesCache || []) {
  const rows = buildCostCatalogSheetRows(items).filter((r) => r.domain === domain);
  const groups = groupCatalogSheetDisplayRows(rows);
  return groups
    .map((g) => ({
      id: g.tipo2Id,
      name: g.tipo2,
      tipo1: g.tipo1,
      grupo: g.grupo,
      sortOrder: 0,
      isSelectable: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt"));
}

function emptyCascadeHint() {
  return "Seleccione tipo 1, tipo 2 e, se existir, o subcusto (tipo 3).";
}

function makeCascadeSelect({ label, placeholder, options, value = "", disabled = false, onChange }) {
  const wrap = document.createElement("div");
  wrap.className = "cost-cascade-field";
  const lab = document.createElement("label");
  lab.className = "cost-cascade-field__label";
  lab.textContent = label;
  const sel = document.createElement("select");
  sel.className = "cost-cascade-field__select";
  sel.disabled = disabled;
  sel.innerHTML =
    `<option value="">${placeholder}</option>` +
    options.map((o) => `<option value="${escapeAttr(o.value)}">${escapeAttr(o.label)}</option>`).join("");
  if (value) sel.value = String(value);
  sel.addEventListener("change", () => onChange?.(sel.value));
  wrap.appendChild(lab);
  wrap.appendChild(sel);
  return { wrap, sel };
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Fluxo pedido extra (GERAL / OBRA): Tipo 1 → Grupo → Tipo 2 → Subcusto (tipo 3).
 * Usa a mesma folha do catálogo CENTRO COMPRAS.
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

  const allRows = buildCostCatalogSheetRows(items).filter((r) => r.domain === domain);
  if (!allRows.length) {
    container.innerHTML = `<p class="text-xs text-slate-400">Sem tipos de custo para este domínio.</p>`;
    if (hidden) hidden.value = "";
    return;
  }

  const state = {
    tipo1: "",
    grupo: "",
    tipo2: "",
    tipo2Id: "",
    tipo3PickId: "",
  };

  const refs = {
    tipo1: null,
    grupo: null,
    tipo2: null,
    tipo3: null,
  };

  function syncDetailField(categoryId, requiresDetail = null) {
    if (!detailRow || !detailInput) return;
    const cat = items.find((c) => sameCostId(c.id, categoryId));
    const show =
      requiresDetail != null ? Boolean(requiresDetail) : Boolean(cat?.requiresDetailText);
    detailRow.classList.toggle("hidden", !show);
    detailInput.required = show;
    if (!show) detailInput.value = "";
  }

  function updateSummary(categoryId) {
    if (!summary) return;
    if (!categoryId) {
      summary.textContent = emptyCascadeHint();
      summary.classList.add("text-slate-400");
      summary.classList.remove("text-emerald-700");
      return;
    }
    summary.textContent = buildCategoryPath(categoryId, items);
    summary.classList.remove("text-slate-400");
    summary.classList.add("text-emerald-700");
  }

  function setPick(categoryId, requiresDetail = null) {
    if (hidden) hidden.value = categoryId ? costIdKey(categoryId) : "";
    syncDetailField(categoryId, requiresDetail);
    updateSummary(categoryId);
    onChange(categoryId ? items.find((c) => sameCostId(c.id, categoryId)) : null);
  }

  function currentFilters() {
    return {
      domain,
      tipo1: state.tipo1,
      grupo: state.grupo,
      tipo2: state.tipo2,
    };
  }

  function removeField(key) {
    refs[key]?.wrap?.remove();
    refs[key] = null;
  }

  function resolvePickFromTipo2() {
    const groups = groupCatalogSheetDisplayRows(
      applySheetFilters(allRows, {
        domain,
        tipo1: state.tipo1,
        grupo: state.grupo,
        tipo2: state.tipo2,
      })
    );
    const group =
      groups.find((g) => sameCostId(g.tipo2Id, state.tipo2Id)) ||
      groups.find((g) => g.tipo2 === state.tipo2) ||
      groups[0];
    if (!group) {
      setPick("");
      return null;
    }
    const realTipo3 = (group.variants || []).filter((v) => v.tipo3 && v.tipo3 !== "—");
    return { group, realTipo3 };
  }

  function renderTipo3(presetPickId = "") {
    removeField("tipo3");
    const resolved = resolvePickFromTipo2();
    if (!resolved) return;

    const { group, realTipo3 } = resolved;
    if (!realTipo3.length) {
      const direct = group.variants[0];
      state.tipo3PickId = direct?.pickCategoryId || group.tipo2Id;
      setPick(state.tipo3PickId, direct?.requiresDetailText);
      return;
    }

    const { wrap, sel } = makeCascadeSelect({
      label: "Subcusto (tipo 3)",
      placeholder: "Seleccionar subcusto...",
      disabled,
      value: presetPickId,
      options: realTipo3.map((v) => ({
        value: costIdKey(v.pickCategoryId),
        label: v.tipo3,
      })),
      onChange: (val) => {
        state.tipo3PickId = val;
        const hit = realTipo3.find((v) => sameCostId(v.pickCategoryId, val));
        setPick(val || "", hit?.requiresDetailText);
      },
    });
    refs.tipo3 = { wrap, sel };
    container.appendChild(wrap);

    if (presetPickId && realTipo3.some((v) => sameCostId(v.pickCategoryId, presetPickId))) {
      sel.value = costIdKey(presetPickId);
      state.tipo3PickId = costIdKey(presetPickId);
      const hit = realTipo3.find((v) => sameCostId(v.pickCategoryId, presetPickId));
      setPick(presetPickId, hit?.requiresDetailText);
    } else {
      state.tipo3PickId = "";
      setPick("");
    }
  }

  function renderTipo2(presetTipo2 = "", presetPickId = "") {
    removeField("tipo3");
    removeField("tipo2");
    state.tipo2 = "";
    state.tipo2Id = "";
    state.tipo3PickId = "";

    const opts = sheetFilterOptions(allRows, currentFilters());
    const tipo2Names = opts.tipo2 || [];
    const { wrap, sel } = makeCascadeSelect({
      label: "Tipo custo 2",
      placeholder: "Seleccionar tipo custo 2...",
      disabled,
      value: presetTipo2,
      options: tipo2Names.map((name) => ({ value: name, label: name })),
      onChange: (val) => {
        state.tipo2 = val;
        const row = applySheetFilters(allRows, {
          domain,
          tipo1: state.tipo1,
          grupo: state.grupo,
          tipo2: val,
        })[0];
        state.tipo2Id = row?.tipo2Id || "";
        if (!val) {
          removeField("tipo3");
          setPick("");
          return;
        }
        renderTipo3();
      },
    });
    refs.tipo2 = { wrap, sel };
    container.appendChild(wrap);

    if (presetTipo2 && tipo2Names.includes(presetTipo2)) {
      sel.value = presetTipo2;
      state.tipo2 = presetTipo2;
      const row = applySheetFilters(allRows, {
        domain,
        tipo1: state.tipo1,
        grupo: state.grupo,
        tipo2: presetTipo2,
      })[0];
      state.tipo2Id = row?.tipo2Id || "";
      renderTipo3(presetPickId);
    } else {
      setPick("");
    }
  }

  function renderGrupo(presetGrupo = "", presetTipo2 = "", presetPickId = "") {
    removeField("tipo3");
    removeField("tipo2");
    removeField("grupo");
    state.grupo = "";
    state.tipo2 = "";
    state.tipo2Id = "";
    state.tipo3PickId = "";

    const opts = sheetFilterOptions(allRows, { domain, tipo1: state.tipo1 });
    const grupos = (opts.grupo || []).filter(Boolean);
    const hasEmptyGrupo = applySheetFilters(allRows, { domain, tipo1: state.tipo1 }).some(
      (r) => !r.grupo
    );

    if (!grupos.length) {
      state.grupo = "";
      renderTipo2(presetTipo2, presetPickId);
      return;
    }

    const options = [];
    if (hasEmptyGrupo) options.push({ value: "__EMPTY__", label: "Sem grupo" });
    grupos.forEach((g) => options.push({ value: g, label: g }));

    const presetGrupoValue =
      presetGrupo && presetGrupo !== "__EMPTY__"
        ? presetGrupo
        : presetTipo2 && !presetGrupo && hasEmptyGrupo
          ? "__EMPTY__"
          : presetGrupo || "";

    const { wrap, sel } = makeCascadeSelect({
      label: "Grupo",
      placeholder: "Seleccionar grupo...",
      disabled,
      value: presetGrupoValue,
      options,
      onChange: (val) => {
        state.grupo = val; // pode ser nome, "__EMPTY__" ou ""
        if (!val) {
          removeField("tipo2");
          removeField("tipo3");
          setPick("");
          return;
        }
        renderTipo2();
      },
    });
    refs.grupo = { wrap, sel };
    container.appendChild(wrap);

    if (presetGrupoValue && (presetGrupoValue === "__EMPTY__" || grupos.includes(presetGrupoValue))) {
      sel.value = presetGrupoValue;
      state.grupo = presetGrupoValue;
      renderTipo2(presetTipo2, presetPickId);
    } else {
      setPick("");
    }
  }

  function renderTipo1(preset = null) {
    container.innerHTML = "";
    refs.tipo1 = refs.grupo = refs.tipo2 = refs.tipo3 = null;

    const tipo1Opts = sheetFilterOptions(allRows, { domain }).tipo1 || [];
    const hideTipo1 = tipo1Opts.length <= 1;

    if (hideTipo1) {
      state.tipo1 = tipo1Opts[0] || "";
      renderGrupo(preset?.grupo || "", preset?.tipo2 || "", preset?.pickId || "");
      return;
    }

    const { wrap, sel } = makeCascadeSelect({
      label: "Tipo custo 1",
      placeholder: "Seleccionar tipo custo 1...",
      disabled,
      value: preset?.tipo1 || "",
      options: tipo1Opts.map((name) => ({ value: name, label: name })),
      onChange: (val) => {
        state.tipo1 = val;
        if (!val) {
          removeField("grupo");
          removeField("tipo2");
          removeField("tipo3");
          setPick("");
          return;
        }
        renderGrupo();
      },
    });
    refs.tipo1 = { wrap, sel };
    container.appendChild(wrap);

    if (preset?.tipo1 && tipo1Opts.includes(preset.tipo1)) {
      sel.value = preset.tipo1;
      state.tipo1 = preset.tipo1;
      renderGrupo(preset.grupo || "", preset.tipo2 || "", preset.pickId || "");
    } else {
      setPick("");
    }
  }

  let preset = null;
  if (initialCategoryId) {
    const hit =
      allRows.find((r) => sameCostId(r.pickCategoryId, initialCategoryId)) ||
      allRows.find((r) => sameCostId(r.tipo2Id, initialCategoryId));
    if (hit) {
      preset = {
        tipo1: hit.tipo1,
        grupo: hit.grupo || "",
        tipo2: hit.tipo2,
        pickId: costIdKey(hit.pickCategoryId),
      };
    }
  }

  renderTipo1(preset);
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
    summary.textContent = emptyCascadeHint();
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
