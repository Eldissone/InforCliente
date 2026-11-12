// Categorias de custo de obra (Registos) ↔ Centros de Custo da obra.
// Um Centro de Custo da obra é a instância de uma Categoria registada em Registos → Categorias de Custo.
// Aqui só se escolhe; a gestão (criar/editar/eliminar categorias) fica em Registos.
import { apiRequest } from "/services/api.js";

export const CAT_PREFIX = "__CAT__:";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").trim();

/** Categorias de obra registadas, com o centro de custo da obra que já as representa (ou null). */
export async function loadCategoryOptions(projectId) {
  try {
    const data = await apiRequest(`/cost-centers/project/${encodeURIComponent(projectId)}/category-options`);
    return data?.items || [];
  } catch {
    return [];
  }
}

/** Devolve (criando se for preciso) o centro de custo da obra para uma categoria registada. */
export async function ensureCostCenterFromCategory(projectId, categoryId) {
  return apiRequest(`/cost-centers/project/${encodeURIComponent(projectId)}/from-category`, {
    method: "POST",
    body: { categoryId: Number(categoryId) },
  });
}

/** Categorias registadas que ainda não têm centro de custo nesta obra. */
export function pendingCategories(options, costCenters = []) {
  const codes = new Set(costCenters.map((c) => String(c.code || "").toUpperCase()));
  return (options || []).filter((o) => !o.costCenterId && !codes.has(String(o.code || "").toUpperCase()));
}

/** Rótulo curto (sem o prefixo técnico do código). */
export function ccLabel(cc) {
  return cc?.name || cc?.code || "";
}

/**
 * <optgroup>s para um <select>: centros de custo já ativos na obra + categorias registadas a criar ao usar.
 * Valor: id do centro de custo, ou `__CAT__:<categoryId>`.
 */
export function optionGroupsHtml({ costCenters = [], options = [], selected = "" }) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const existing = costCenters
    .map(
      (cc) =>
        `<option value="${esc(cc.id)}" data-cc-id="${esc(cc.id)}" ${cc.id === selected ? "selected" : ""}>${esc(ccLabel(cc))}</option>`
    )
    .join("");
  const pending = pendingCategories(options, costCenters)
    .map((o) => {
      const v = `${CAT_PREFIX}${o.categoryId}`;
      return `<option value="${v}" data-cc-id="" ${v === selected ? "selected" : ""}>+ ${esc(o.name)}</option>`;
    })
    .join("");
  return (
    (existing ? `<optgroup label="Centros de custo da obra">${existing}</optgroup>` : "") +
    (pending ? `<optgroup label="Categorias registadas (criar ao usar)">${pending}</optgroup>` : "")
  );
}

/** Melhor valor de seleção para um nome livre (ex.: grupo do Excel, categoria sugerida pela IA). */
export function matchSelectionByName(name, costCenters = [], options = []) {
  const n = norm(name);
  if (!n) return "";
  const candidates = [
    ...costCenters.map((cc) => ({ value: cc.id, label: norm(cc.name), code: norm(cc.code) })),
    ...pendingCategories(options, costCenters).map((o) => ({ value: `${CAT_PREFIX}${o.categoryId}`, label: norm(o.name), code: norm(o.code) })),
  ];
  const exact = candidates.find((c) => c.label === n || c.code === n);
  if (exact) return exact.value;
  const contains = candidates.find((c) => c.label && (n.includes(c.label) || c.label.includes(n)));
  if (contains) return contains.value;
  const words = n.split(/\s+/).filter((w) => w.length > 3);
  const byWord = candidates.find((c) => words.some((w) => c.label.includes(w)));
  return byWord ? byWord.value : "";
}

/** Resolve um valor de seleção em id de centro de custo (criando-o a partir da categoria, se necessário). */
export async function resolveSelectionToCostCenterId(projectId, value, cache = new Map()) {
  if (!value) return null;
  if (!String(value).startsWith(CAT_PREFIX)) return value;
  if (cache.has(value)) return cache.get(value);
  const created = await ensureCostCenterFromCategory(projectId, String(value).slice(CAT_PREFIX.length));
  cache.set(value, created.id);
  return created.id;
}
