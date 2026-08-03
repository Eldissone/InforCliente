import { apiRequest } from "/services/api.js";
import {
  buildCostCatalogSheetRows,
  applySheetFilters,
  groupCatalogSheetDisplayRows,
  classifyCategorySheetLevel,
  uniqueSorted,
} from "/shared/costCategorySheet.js";

const DOMAIN_BY_EXTRA_TYPE = {
  GERAL: "GERAL",
  OBRA: "OBRA",
};

let categoriesCache = null;

export function extraTypeToCostDomain(extraType) {
  return DOMAIN_BY_EXTRA_TYPE[extraType] || "GERAL";
}

/**
 * Tipos custo 1 disponíveis no domínio.
 * Em GERAL vem dos FAMs cadastrados (estrutura), não só das linhas com tipo 2.
 */
export function listTipo1NamesForDomain(domain, items = categoriesCache || [], sheetRows = null) {
  const rows =
    sheetRows ||
    buildCostCatalogSheetRows(items).filter((r) => !domain || r.domain === domain);
  const fromRows = rows.filter((r) => !domain || r.domain === domain).map((r) => r.tipo1);

  if (domain === "GERAL") {
    const fromFams = items
      .filter(
        (c) =>
          c.domain === "GERAL" &&
          c.active !== false &&
          !c.parentId &&
          classifyCategorySheetLevel(c) === "TIPO1"
      )
      .map((c) => c.name);
    return uniqueSorted([...fromRows, ...fromFams]);
  }

  return uniqueSorted(fromRows);
}

/** Grupos cadastrados sob um tipo custo 1 (estrutura), mesmo sem tipo 2 ainda. */
export function listGrupoNamesForTipo1(domain, tipo1Name, items = categoriesCache || []) {
  if (domain !== "GERAL" || !tipo1Name) return [];
  const fam = items.find(
    (c) =>
      c.domain === "GERAL" &&
      c.active !== false &&
      !c.parentId &&
      classifyCategorySheetLevel(c) === "TIPO1" &&
      c.name === tipo1Name
  );
  if (!fam) return [];
  return uniqueSorted(
    items
      .filter(
        (c) =>
          c.domain === "GERAL" &&
          c.active !== false &&
          sameCostId(c.parentId, fam.id) &&
          classifyCategorySheetLevel(c) === "GRUPO"
      )
      .map((c) => c.name)
  );
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

/** Normaliza rótulos da folha para comparações (ex.: Produto / Ferramentas). */
export function normalizeCostLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Grupo «Produto» + tipo «Ferramentas» — só para pedidos GERAL (catálogo logística).
 * Em OBRA o menu depende do Centro de Custo da Obra.
 */
export function isToolCostSelection({ domain = "", grupo = "", tipo2 = "" } = {}) {
  if (String(domain).toUpperCase() === "OBRA") return false;
  const t2 = normalizeCostLabel(tipo2);
  if (!t2.includes("ferrament")) return false;
  const g = normalizeCostLabel(grupo === "__EMPTY__" ? "" : grupo);
  return g.includes("produto");
}

/** Classifica centro de custo da obra para menu de descrição. */
export function classifyObraCostCenterKind(code = "", name = "") {
  const text = normalizeCostLabel(`${code} ${name}`);
  if (text.includes("ferrament")) return "tools";
  if (text.includes("material")) return "materials";
  return null;
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
 * Fluxo pedido extra (GERAL / OBRA): Tipo 1 → Tipo 2 → Subcusto (tipo 3).
 * O grupo do catálogo fica implícito (não é passo de selecção).
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

  function getSelectionMeta() {
    return {
      domain,
      tipo1: state.tipo1,
      grupo: state.grupo === "__EMPTY__" ? "" : state.grupo,
      tipo2: state.tipo2,
      tipo2Id: state.tipo2Id,
    };
  }

  function syncDetailField(categoryId, requiresDetail = null) {
    if (!detailRow || !detailInput) return;
    const cat = items.find((c) => sameCostId(c.id, categoryId));
    const forceTool = isToolCostSelection(getSelectionMeta()) && Boolean(categoryId);
    const show =
      forceTool ||
      (requiresDetail != null ? Boolean(requiresDetail) : Boolean(cat?.requiresDetailText));
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
    const meta = getSelectionMeta();
    syncDetailField(categoryId, requiresDetail);
    updateSummary(categoryId);
    onChange(categoryId ? items.find((c) => sameCostId(c.id, categoryId)) : null, meta);
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
    if (group.grupo) state.grupo = group.grupo;
    else state.grupo = "";
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
    removeField("grupo");
    document.getElementById("extraCascadeEmptyTipo2")?.remove();
    state.grupo = "";
    state.tipo2 = "";
    state.tipo2Id = "";
    state.tipo3PickId = "";

    const filtered = applySheetFilters(allRows, { domain, tipo1: state.tipo1 });
    const groups = groupCatalogSheetDisplayRows(filtered);
    if (!groups.length) {
      setPick("");
      const empty = document.createElement("p");
      empty.className =
        "text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2";
      empty.id = "extraCascadeEmptyTipo2";
      empty.textContent =
        "Este tipo custo 1 ainda não tem tipo custo 2 cadastrado. Cadastre na aba «Tipos de custo».";
      container.appendChild(empty);
      return;
    }

    // Mesmo nome de tipo 2 em grupos diferentes → desambiguar no rótulo.
    const nameCount = groups.reduce((acc, g) => {
      acc[g.tipo2] = (acc[g.tipo2] || 0) + 1;
      return acc;
    }, {});

    const options = groups.map((g) => {
      const base = formatCategoryDisplayName(g.tipo2);
      const label =
        nameCount[g.tipo2] > 1 && g.grupo
          ? `${base} (${formatCategoryDisplayName(g.grupo)})`
          : base;
      return { value: costIdKey(g.tipo2Id), label, tipo2: g.tipo2, grupo: g.grupo || "" };
    });

    const presetValue = presetPickId
      ? ""
      : presetTipo2
        ? costIdKey(
            groups.find((g) => g.tipo2 === presetTipo2 && (!state.grupo || g.grupo === state.grupo))
              ?.tipo2Id || groups.find((g) => g.tipo2 === presetTipo2)?.tipo2Id
          )
        : "";

    const { wrap, sel } = makeCascadeSelect({
      label: "Tipo custo 2",
      placeholder: "Seleccionar tipo custo 2...",
      disabled,
      value: presetValue,
      options: options.map((o) => ({ value: o.value, label: o.label })),
      onChange: (val) => {
        const hit = options.find((o) => o.value === val);
        state.tipo2 = hit?.tipo2 || "";
        state.tipo2Id = val || "";
        state.grupo = hit?.grupo || "";
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

    let selectedId = "";
    if (presetPickId) {
      const byPick = filtered.find((r) => sameCostId(r.pickCategoryId, presetPickId));
      if (byPick) selectedId = costIdKey(byPick.tipo2Id);
    }
    if (!selectedId && presetTipo2) {
      selectedId = costIdKey(
        groups.find((g) => g.tipo2 === presetTipo2)?.tipo2Id
      );
    }
    if (selectedId && options.some((o) => o.value === selectedId)) {
      sel.value = selectedId;
      const hit = options.find((o) => o.value === selectedId);
      state.tipo2 = hit?.tipo2 || "";
      state.tipo2Id = selectedId;
      state.grupo = hit?.grupo || "";
      renderTipo3(presetPickId);
    } else {
      setPick("");
    }
  }

  function renderTipo1(preset = null) {
    container.innerHTML = "";
    refs.tipo1 = refs.grupo = refs.tipo2 = refs.tipo3 = null;
    document.getElementById("extraCascadeEmptyTipo2")?.remove();

    const tipo1Opts = listTipo1NamesForDomain(domain, items, allRows);
    if (!tipo1Opts.length) {
      container.innerHTML = `<p class="text-xs text-slate-400">Sem tipo custo 1 para este domínio.</p>`;
      setPick("");
      return;
    }

    const { wrap, sel } = makeCascadeSelect({
      label: "Tipo custo 1",
      placeholder: "Seleccionar tipo custo 1...",
      disabled,
      value: preset?.tipo1 || "",
      options: tipo1Opts.map((name) => ({
        value: name,
        label: formatCategoryDisplayName(name),
      })),
      onChange: (val) => {
        state.tipo1 = val;
        if (!val) {
          removeField("grupo");
          removeField("tipo2");
          removeField("tipo3");
          document.getElementById("extraCascadeEmptyTipo2")?.remove();
          setPick("");
          return;
        }
        renderTipo2();
      },
    });
    refs.tipo1 = { wrap, sel };
    container.appendChild(wrap);

    if (preset?.tipo1 && tipo1Opts.includes(preset.tipo1)) {
      sel.value = preset.tipo1;
      state.tipo1 = preset.tipo1;
      if (preset.grupo) state.grupo = preset.grupo;
      renderTipo2(preset.tipo2 || "", preset.pickId || "");
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
