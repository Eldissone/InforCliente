import { apiRequest, apiUpload } from "../services/api.js";
import { getSessionUser } from "../services/auth.js";
import { toast as uiToast } from "./ui.js";
import { refreshPedidoTotalsFromRows, formatPedidoTotalNumber } from "./supplierFiscal.js";
import { bindNifLookup, normalizeNif, setNifLookupStatus } from "./supplierNifLookup.js";
import {
  loadAllCostCategories,
  getCachedCategories,
  formatCategoryDisplayName,
  normalizeCostLabel,
  costIdKey,
  sameCostId,
} from "./costCategoryCascade.js";
import {
  buildCostCatalogSheetRows,
  groupCatalogSheetDisplayRows,
  uniqueCatalogTipo2Groups,
  catalogSheetGroupKey,
} from "./costCategorySheet.js";

// ══════════════════════════════════════════════════════════
// Formulário de Pedido de Compra (purchase-orders)
// Usado pela página Novo Pedido; opera sobre os ids ccPedido*/ccExtra*.
// ══════════════════════════════════════════════════════════

const cache = {
  costCategories: [],
  suppliers: [],
  tools: [],
};

let notify = (msg, type = "info") => uiToast(msg, { type });
let describeError = defaultDescribeError;

/**
 * Os seis tipos de requisição de pagamento da base de referência.
 *
 * `hasItems` diz quais se descrevem por linhas de item. Os outros três trazem o
 * valor nos seus próprios dados (`typeData`), que é de onde o servidor o lê:
 * impostos `{tipo, mes, rupe, limite, valor}`, pessoal `{sub, mes, linhas[]}` e
 * empréstimo `{por, modo, valor, iban, fim, prest}`.
 *
 * O ecrã confirma esta lista contra `GET /purchase-orders/payment/meta`, para a
 * lista do servidor continuar a ser a única que manda.
 */
const REQUEST_TYPES = [
  ["SEDE", "Pedido geral (sede)", true],
  ["OBRA", "Pedido para obra", true],
  ["FROTA", "Frota e equipamentos", true],
  ["IMPOSTOS", "Impostos", false],
  ["PESSOAL", "Pessoal", false],
  ["EMPRESTIMO", "Empréstimo", false],
];

function typeHasItems(type) {
  const hit = REQUEST_TYPES.find(([k]) => k === type);
  return hit ? hit[2] : true;
}

/** O tipo escolhido. «GERAL» era o valor antigo do ecrã e lê-se como sede. */
function currentRequestType() {
  const v = String(document.getElementById("ccPedidoType")?.value || "SEDE").toUpperCase();
  if (v === "GERAL") return "SEDE";
  return REQUEST_TYPES.some(([k]) => k === v) ? v : "SEDE";
}

function typeLabel(type) {
  const hit = REQUEST_TYPES.find(([k]) => k === type);
  return hit ? hit[1] : type;
}

const numOrNull = (value) => {
  const n = parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function defaultDescribeError(err) {
  const e = err?.data?.error;
  if (e && typeof e === "object") {
    const fields = e.fieldErrors
      ? Object.entries(e.fieldErrors).flatMap(([k, msgs]) => (msgs || []).map((m) => `${k}: ${m}`))
      : [];
    const all = [...(e.formErrors || []), ...fields].filter(Boolean);
    if (all.length) return all.join(" · ");
  }
  if (typeof e === "string") {
    const map = {
      FORBIDDEN: "Sem permissão para esta acção",
      NOT_FOUND: "Pedido não encontrado",
      CANNOT_EDIT_IN_CURRENT_STATUS: "Este pedido já não pode ser editado neste estado",
      FILE_REQUIRED: "Seleccione um ficheiro",
      UPLOAD_FAILED: "Falha no envio do ficheiro",
    };
    return map[e] || e;
  }
  return err?.data?.message || err?.message || "Erro desconhecido";
}

export function parseItemTax(notes) {
  const text = String(notes || "");
  const pick = (re) => {
    const m = text.match(re);
    return m ? Number(String(m[1]).replace(",", ".")) : 0;
  };
  return {
    vat: pick(/IVA\s+(\d+(?:[.,]\d+)?)\s*%/i),
    retention: pick(/Ret\.?\s+(\d+(?:[.,]\d+)?)\s*%/i),
    discount: pick(/Desc\.?\s+(\d+(?:[.,]\d+)?)\s*%/i),
  };
}

export function toDateInput(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// ── Catálogo de custos ──────────────────────────────────────

function getCatalogSheetRows() {
  const items = cache.costCategories.length ? cache.costCategories : getCachedCategories();
  return buildCostCatalogSheetRows(items);
}

function tipo2Groups() {
  const rows = getCatalogSheetRows().filter((r) => r.domain === "GERAL");
  return uniqueCatalogTipo2Groups(groupCatalogSheetDisplayRows(rows));
}

function syncCostDetail(categoryId, requiresDetail) {
  const hidden = document.getElementById("ccExtraCostCategorySelectedId");
  if (hidden) hidden.value = categoryId || "";
  const detailRow = document.getElementById("cc_rowCostDetailDesc");
  if (!detailRow) return;
  let show = Boolean(requiresDetail);
  if (requiresDetail == null && categoryId) {
    const cat = (cache.costCategories.length ? cache.costCategories : getCachedCategories())
      .find((c) => sameCostId(c.id, categoryId));
    show = Boolean(cat?.requiresDetailText);
  }
  detailRow.classList.toggle("hidden", !show);
  if (!show) {
    const ta = document.getElementById("ccExtraCostDetailDesc");
    if (ta) ta.value = "";
  }
}

function populateSubcustos() {
  const centroSel = document.getElementById("ccCentroGeralId");
  const catSel = document.getElementById("ccExtraCostCategoryId");
  if (!catSel) return;
  const key = centroSel?.value || "";
  const group = tipo2Groups().find((g) => catalogSheetGroupKey(g) === key);
  const prev = catSel.value;
  const realTipo3 = (group?.variants || []).filter((v) => v.tipo3 && v.tipo3 !== "—");

  if (!group) {
    catSel.disabled = true;
    catSel.innerHTML = `<option value="">selecione primeiro o centro geral</option>`;
    syncCostDetail("");
    syncItemToolSuggest();
    return;
  }

  if (!realTipo3.length) {
    const pick = group.variants?.[0]?.pickCategoryId || group.tipo2Id;
    catSel.disabled = true;
    catSel.innerHTML = `<option value="${escapeHtml(costIdKey(pick))}">Sem subcategorias — esta categoria é seleccionável directamente</option>`;
    catSel.value = costIdKey(pick);
    syncCostDetail(pick, group.variants?.[0]?.requiresDetailText);
    syncItemToolSuggest();
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
  syncCostDetail(pick, hit?.requiresDetailText);
  syncItemToolSuggest();
}

function populateCentrosGerais() {
  const sel = document.getElementById("ccCentroGeralId");
  if (!sel) return;
  const prev = sel.value;
  const seen = new Set();
  const options = [];
  for (const g of tipo2Groups()) {
    const label = formatCategoryDisplayName(g.tipo2).replace(/\s+/g, " ").trim();
    const labelKey = String(label)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    if (!labelKey || seen.has(labelKey)) continue;
    seen.add(labelKey);
    options.push(`<option value="${escapeHtml(catalogSheetGroupKey(g))}">${escapeHtml(label)}</option>`);
  }
  sel.innerHTML =
    `<option value="">${options.length ? "selecione centro geral" : "Sem tipos de custo 2 no catálogo"}</option>` +
    options.join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  populateSubcustos();
}

// ── Catálogo de ferramentas ─────────────────────────────────

function isFerramentasCentro() {
  const key = document.getElementById("ccCentroGeralId")?.value || "";
  const group = tipo2Groups().find((g) => catalogSheetGroupKey(g) === key);
  if (group && normalizeCostLabel(group.tipo2).includes("ferrament")) return true;
  const label = document.getElementById("ccCentroGeralId")?.selectedOptions?.[0]?.textContent || "";
  return normalizeCostLabel(label).includes("ferrament");
}

function normalizeToolName(value) {
  return normalizeCostLabel(value).replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function findCachedTool(name) {
  const key = normalizeToolName(name);
  if (!key) return null;
  return (cache.tools || []).find((p) => normalizeToolName(p.name) === key) || null;
}

function upsertCachedTool(product) {
  if (!product?.id) return;
  const list = cache.tools || [];
  const idx = list.findIndex((p) => p.id === product.id);
  if (idx >= 0) list[idx] = product;
  else {
    const dup = list.findIndex((p) => normalizeToolName(p.name) === normalizeToolName(product.name));
    if (dup >= 0) list[dup] = product;
    else list.push(product);
  }
  cache.tools = list;
}

const toolEnsureInflight = new Map();

async function ensureToolProduct(name, unit) {
  const cleanName = String(name || "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-PT");
  const key = normalizeToolName(cleanName);
  if (!key) return null;
  const cached = findCachedTool(cleanName);
  if (cached) return { ...cached, created: false };
  if (toolEnsureInflight.has(key)) return toolEnsureInflight.get(key);
  const pending = apiRequest("/products/ensure-tool", {
    method: "POST",
    body: { name: cleanName, unit },
  }).then((product) => {
    upsertCachedTool(product);
    return product;
  }).finally(() => {
    toolEnsureInflight.delete(key);
  });
  toolEnsureInflight.set(key, pending);
  return pending;
}

async function loadToolCatalog() {
  if (cache.tools?.length) return cache.tools;
  try {
    const data = await apiRequest("/products/tools");
    const seen = new Map();
    for (const p of data.items || []) {
      const key = normalizeToolName(p.name);
      if (!key || seen.has(key)) continue;
      seen.set(key, p);
    }
    cache.tools = [...seen.values()];
  } catch {
    cache.tools = [];
  }
  return cache.tools;
}

let activeSuggestRow = null;
let suggestPortalBound = false;

function getItemSuggestBox() {
  let box = document.getElementById("ccItemSuggestPortal");
  if (box) return box;
  box = document.createElement("div");
  box.id = "ccItemSuggestPortal";
  box.className = "cc-item-suggest pf-suggest hidden";
  box.setAttribute("role", "listbox");
  document.body.appendChild(box);
  bindItemSuggestPortal(box);
  return box;
}

export function hideAllItemSuggest() {
  activeSuggestRow = null;
  const box = document.getElementById("ccItemSuggestPortal");
  if (box) box.classList.add("hidden");
  document.querySelectorAll(".cc-item-suggest").forEach((el) => el.classList.add("hidden"));
}

function positionItemSuggest(input) {
  const box = getItemSuggestBox();
  if (!input || box.classList.contains("hidden")) return;
  const rect = input.getBoundingClientRect();
  const gutter = 12;
  const width = Math.min(Math.max(rect.width, 280), window.innerWidth - gutter * 2);
  let left = rect.left;
  if (left + width > window.innerWidth - gutter) left = window.innerWidth - gutter - width;
  if (left < gutter) left = gutter;
  const spaceBelow = window.innerHeight - rect.bottom - gutter;
  const spaceAbove = rect.top - gutter;
  const preferUp = spaceBelow < 180 && spaceAbove > spaceBelow;
  box.style.left = `${Math.round(left)}px`;
  box.style.width = `${Math.round(width)}px`;
  box.style.right = "auto";
  if (preferUp) {
    box.style.top = "auto";
    box.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`;
    box.style.maxHeight = `${Math.round(Math.min(280, spaceAbove))}px`;
  } else {
    box.style.bottom = "auto";
    box.style.top = `${Math.round(rect.bottom + 4)}px`;
    box.style.maxHeight = `${Math.round(Math.min(280, Math.max(120, spaceBelow)))}px`;
  }
}

function onItemSuggestReposition() {
  if (!activeSuggestRow) return;
  const input = activeSuggestRow.querySelector(".cc-item-desc");
  const box = document.getElementById("ccItemSuggestPortal");
  if (!input || !box || box.classList.contains("hidden")) return;
  positionItemSuggest(input);
}

function bindItemSuggestPortal(box) {
  if (suggestPortalBound) return;
  suggestPortalBound = true;
  box.addEventListener("mousedown", (e) => e.preventDefault());
  box.addEventListener("click", async (e) => {
    const tr = activeSuggestRow;
    if (!tr) return;
    const input = tr.querySelector(".cc-item-desc");
    const hit = e.target.closest("[data-product-id]");
    const createBtn = e.target.closest("[data-create-name]");
    if (hit) {
      const product = (cache.tools || []).find((p) => p.id === hit.dataset.productId);
      applyToolToItemRow(tr, product);
      hideAllItemSuggest();
      return;
    }
    if (!createBtn) return;
    if (box.dataset.ensuring === "1") return;
    const name = createBtn.dataset.createName;
    const existing = findCachedTool(name);
    if (existing) {
      applyToolToItemRow(tr, existing);
      hideAllItemSuggest();
      return;
    }
    const unit = tr.querySelector(".cc-item-unit")?.value || "UN";
    box.dataset.ensuring = "1";
    try {
      const product = await ensureToolProduct(name, unit);
      if (product?.id) {
        applyToolToItemRow(tr, product);
        notify(
          product.created
            ? `Ferramenta “${product.name}” adicionada ao catálogo`
            : `Ferramenta “${product.name}” já existia no catálogo`,
          "success"
        );
      }
    } catch (err) {
      notify(describeError(err), "error");
      if (input) input.value = name;
    } finally {
      delete box.dataset.ensuring;
    }
    hideAllItemSuggest();
  });
  window.addEventListener("resize", onItemSuggestReposition);
  document.addEventListener("scroll", onItemSuggestReposition, true);
}

function applyToolToItemRow(tr, product) {
  if (!tr || !product) return;
  tr.dataset.productId = product.id || "";
  const desc = tr.querySelector(".cc-item-desc");
  const unit = tr.querySelector(".cc-item-unit");
  if (desc) desc.value = product.name || desc.value;
  if (unit && product.unit) unit.value = String(product.unit).toLowerCase();
}

function renderItemSuggest(tr, query) {
  const box = getItemSuggestBox();
  if (!isFerramentasCentro()) {
    hideAllItemSuggest();
    return;
  }
  const q = normalizeToolName(query);
  const tools = cache.tools || [];
  const matches = q
    ? tools.filter((p) => normalizeToolName(p.name).includes(q) || normalizeToolName(p.sku || "").includes(q)).slice(0, 8)
    : tools.slice(0, 8);
  const exact = findCachedTool(query);
  const rows = matches.map((p) => `
    <button type="button" data-product-id="${escapeHtml(p.id)}"
      class="cc-suggest-hit w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 flex items-center justify-between gap-2">
      <span class="font-semibold text-slate-800">${escapeHtml(p.name)}</span>
      <span class="text-[10px] text-slate-400 uppercase">${escapeHtml(p.unit || "un")}${p.sku ? " · " + escapeHtml(p.sku) : ""}</span>
    </button>
  `).join("");
  const createRow = query.trim().length >= 2 && !exact
    ? `<button type="button" data-create-name="${escapeHtml(query.trim())}"
        class="cc-suggest-create w-full text-left px-3 py-2 text-xs hover:bg-amber-50 border-t border-slate-100 text-amber-800 font-semibold">
        Criar e adicionar ao catálogo: “${escapeHtml(query.trim())}”
       </button>`
    : "";
  if (!rows && !createRow) {
    hideAllItemSuggest();
    return;
  }
  activeSuggestRow = tr;
  box.innerHTML = rows + createRow;
  box.classList.remove("hidden");
  positionItemSuggest(tr.querySelector(".cc-item-desc"));
}

function bindItemDescSuggest(tr) {
  const input = tr.querySelector(".cc-item-desc");
  if (!input || input.dataset.suggestBound === "1") return;
  input.dataset.suggestBound = "1";
  getItemSuggestBox();

  input.addEventListener("input", () => {
    delete tr.dataset.productId;
    if (!isFerramentasCentro()) {
      hideAllItemSuggest();
      return;
    }
    renderItemSuggest(tr, input.value);
  });
  input.addEventListener("focus", async () => {
    if (!isFerramentasCentro()) return;
    await loadToolCatalog();
    renderItemSuggest(tr, input.value);
  });
  input.addEventListener("blur", () => {
    if (!isFerramentasCentro()) return;
    const existing = findCachedTool(input.value);
    if (existing) applyToolToItemRow(tr, existing);
  });
  input.addEventListener("keydown", (e) => {
    const box = document.getElementById("ccItemSuggestPortal");
    if (e.key === "Enter" && box && !box.classList.contains("hidden") && activeSuggestRow === tr) {
      const first = box.querySelector("button");
      if (first) {
        e.preventDefault();
        first.click();
      }
    }
    if (e.key === "Escape") hideAllItemSuggest();
  });
}

async function syncItemToolSuggest() {
  const tools = isFerramentasCentro();
  document.getElementById("ccItemsToolHint")?.classList.toggle("hidden", !tools);
  document.querySelectorAll(".cc-item-desc").forEach((input) => {
    input.placeholder = tools ? "Pesquisar no catálogo..." : "Item description";
    input.autocomplete = "off";
  });
  if (tools) await loadToolCatalog();
  else hideAllItemSuggest();
}

async function ensureToolsInCatalog(itemRows) {
  if (!isFerramentasCentro()) return;
  await loadToolCatalog();
  const byKey = new Map();
  for (const tr of itemRows) {
    const name = tr.querySelector(".cc-item-desc")?.value?.trim() || "";
    if (!name) continue;
    const key = normalizeToolName(name);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, { name, unit: tr.querySelector(".cc-item-unit")?.value || "UN", rows: [] });
    }
    byKey.get(key).rows.push(tr);
  }
  for (const group of byKey.values()) {
    const product = findCachedTool(group.name) || await ensureToolProduct(group.name, group.unit);
    if (!product?.id) continue;
    group.rows.forEach((tr) => applyToolToItemRow(tr, product));
  }
}

// ── Linhas de itens e totais ────────────────────────────────

export function addItemRow() {
  const tbody = document.getElementById("ccItemsBody");
  if (!tbody) return;
  const tr = document.createElement("tr");
  tr.className = "cc-item-row";
  const tools = isFerramentasCentro();
  tr.innerHTML = `
    <td>
      <input type="text" required autocomplete="off" class="cc-item-desc pf-cell-input"
        placeholder="${tools ? "Pesquisar no catálogo..." : "Item description"}">
    </td>
    <td><input type="number" min="1" value="1" required class="cc-item-qty pf-cell-input pf-cell-input--right"></td>
    <td><input type="text" placeholder="un" required class="cc-item-unit pf-cell-input"></td>
    <td><input type="number" step="0.01" min="0" placeholder="0.00" class="cc-item-price pf-cell-input pf-cell-input--right"></td>
    <td><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-vat pf-cell-input pf-cell-input--right"></td>
    <td><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-wh pf-cell-input pf-cell-input--right"></td>
    <td><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-disc pf-cell-input pf-cell-input--right"></td>
    <td><input type="text" placeholder="observações" class="cc-item-obs pf-cell-input"></td>
    <td>
      <select class="cc-item-doc pf-cell-input" title="Excepção ao documento fiscal">
        <option value="">Fatura</option>
        <option value="DSC">Sem comprovativo</option>
        <option value="AF">Autofaturação</option>
      </select>
    </td>
    <td class="cc-item-line-total pf-cell-total">0.00</td>
    <td style="width:44px">
      <button type="button" class="cc-item-del pf-row-remove" aria-label="Remover item">
        <span class="material-symbols-outlined">delete</span>
      </button>
    </td>
  `;
  tbody.appendChild(tr);
  bindItemDescSuggest(tr);
  tr.querySelector(".cc-item-del")?.addEventListener("click", () => {
    if (activeSuggestRow === tr) hideAllItemSuggest();
    tr.remove();
    if (!tbody.querySelector(".cc-item-row")) addItemRow();
    refreshTotals();
  });
  refreshTotals();
  return tr;
}

export function refreshTotals() {
  // O painel (incluindo a retenção) vem do `computePedidoItemsTotals`, que é a
  // mesma conta do servidor. Aqui só se escreve o total de cada linha.
  refreshPedidoTotalsFromRows("ccPedido", "#ccItemsBody .cc-item-row");

  document.querySelectorAll("#ccItemsBody .cc-item-row").forEach((row) => {
    const qty = parseFloat(row.querySelector(".cc-item-qty")?.value || "0") || 0;
    const price = parseFloat(row.querySelector(".cc-item-price")?.value || "0") || 0;
    const disc = parseFloat(row.querySelector(".cc-item-disc")?.value || "0") || 0;
    const vat = parseFloat(row.querySelector(".cc-item-vat")?.value || "0") || 0;
    const ret = parseFloat(row.querySelector(".cc-item-wh")?.value || "0") || 0;
    const liquido = qty * price * (1 - disc / 100);
    const retLinha = (liquido * ret) / 100;
    const cell = row.querySelector(".cc-item-line-total");
    // O total da linha é o que o fornecedor recebe: base + IVA − retenção.
    // A retenção fica retida e é entregue ao Estado, por isso não se paga.
    if (cell) cell.textContent = formatPedidoTotalNumber(liquido * (1 + vat / 100) - retLinha);
  });
}

export function fillItemRows(items) {
  const tbody = document.getElementById("ccItemsBody");
  if (!tbody) return;
  hideAllItemSuggest();
  tbody.innerHTML = "";
  const list = items && items.length ? items : [{}];
  list.forEach((it) => {
    const row = addItemRow();
    if (!row) return;
    const set = (sel, value) => {
      const el = row.querySelector(sel);
      if (el && value != null && value !== "") el.value = String(value);
    };
    set(".cc-item-desc", it.name || it.description || "");
    set(".cc-item-qty", it.quantity != null ? it.quantity : 1);
    set(".cc-item-unit", it.unit || "");
    set(".cc-item-price", it.unitPrice);
    // A fiscalidade vem dos campos; o texto das notas e so para os pedidos
    // antigos, criados quando as percentagens eram escritas la dentro.
    const legacy = parseItemTax(it.notes);
    const rate = (field, fallback) => (it[field] != null ? it[field] : fallback || null);
    set(".cc-item-vat", rate("vatPercent", legacy.vat));
    set(".cc-item-wh", rate("withholdingPercent", legacy.retention));
    set(".cc-item-disc", rate("discountPercent", legacy.discount));
    set(".cc-item-obs", it.notes || "");
    set(".cc-item-doc", it.docException || "");
  });
  refreshTotals();
}

// ── Visibilidade condicional ────────────────────────────────

const show = (id, on) => document.getElementById(id)?.classList.toggle("hidden", !on);

export function applyTypeVisibility() {
  const type = currentRequestType();

  show("cc_rowObraProject", type === "OBRA");
  show("cc_rowObraCenter", type === "OBRA");
  show("cc_rowFrota", type === "FROTA");
  show("cc_blockImpostos", type === "IMPOSTOS");
  show("cc_blockPessoal", type === "PESSOAL");
  show("cc_blockEmprestimo", type === "EMPRESTIMO");

  // Impostos, pessoal e empréstimo não se descrevem por itens: o valor está nos
  // dados do tipo. Mostrar uma tabela de itens vazia convidava a escrevê-lo duas
  // vezes e o servidor só leria uma.
  const comItens = typeHasItems(type);
  show("ccItemsSection", comItens);
  show("ccTotalsWrap", comItens);

  if (type === "IMPOSTOS") {
    // O beneficiário é a AGT e não há cotação a pedir a ninguém.
    const cot = document.getElementById("ccPedidoRequerCotacao");
    if (cot?.checked) {
      cot.checked = false;
      applyQuoteRequirementVisibility();
    }
    const nome = document.getElementById("ccExtraSupplierName");
    if (nome && !nome.value.trim()) nome.value = "AGT";
  }
  if (type === "PESSOAL" && !document.querySelector("#ccPessoalBody .cc-pes-row")) addPersonRow();

  populateCentrosGerais();
}

/** Fundo de maneio: o dinheiro sai do fundo, não há transferência ao fornecedor. */
export function applyPaymentModeVisibility() {
  const fm = (document.getElementById("ccPedidoModo")?.value || "FORN") === "FM";
  show("cc_rowFundo", fm);
  applyQuoteRequirementVisibility();
}

/** Pronto / crédito / prestações, como na base de referência. */
export function applyPaymentTermVisibility() {
  const term = document.getElementById("ccPedidoCondicao")?.value || "PRONTO";
  // No parcial a data pretendida é a da primeira prestação, por isso fica à vista.
  show("cc_rowPronto", term !== "CREDITO");
  show("cc_rowCredito", term === "CREDITO");
  show("cc_rowParcial", term === "PARCIAL");
  updateDueDateHint();
}

/** A data de vencimento que os dias de crédito dão, escrita por extenso. */
function updateDueDateHint() {
  const hint = document.getElementById("ccPedidoVencimentoHint");
  if (!hint) return;
  const days = numOrNull(document.getElementById("ccPedidoDiasCredito")?.value);
  if (days === null || days < 0) {
    hint.textContent = "";
    return;
  }
  hint.textContent = `Vence a ${creditDueDate(days)}.`;
}

/** Hoje + dias de crédito, em AAAA-MM-DD. */
function creditDueDate(days) {
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  return new Date(base.getTime() + Math.round(days) * 86400000).toISOString().slice(0, 10);
}

// ── Pessoal: uma linha por colaborador ──────────────────────

export function addPersonRow(data = {}) {
  const tbody = document.getElementById("ccPessoalBody");
  if (!tbody) return null;
  const tr = document.createElement("tr");
  tr.className = "cc-pes-row";
  tr.innerHTML = `
    <td><input type="text" class="cc-pes-nome pf-cell-input" placeholder="Nome do colaborador"></td>
    <td><input type="text" class="cc-pes-iban pf-cell-input" placeholder="AO06 ..."></td>
    <td><input type="number" step="0.01" min="0" class="cc-pes-valor pf-cell-input pf-cell-input--right" placeholder="0.00"></td>
    <td style="width:44px">
      <button type="button" class="cc-pes-del pf-row-remove" aria-label="Remover colaborador">
        <span class="material-symbols-outlined">delete</span>
      </button>
    </td>
  `;
  tbody.appendChild(tr);
  const set = (sel, value) => {
    const el = tr.querySelector(sel);
    if (el && value != null && value !== "") el.value = String(value);
  };
  set(".cc-pes-nome", data.nome);
  set(".cc-pes-iban", data.iban);
  set(".cc-pes-valor", data.valor);
  tr.querySelector(".cc-pes-del")?.addEventListener("click", () => {
    tr.remove();
    if (!tbody.querySelector(".cc-pes-row")) addPersonRow();
    refreshPessoalTotal();
  });
  refreshPessoalTotal();
  return tr;
}

export function refreshPessoalTotal() {
  const el = document.getElementById("ccPessoalTotal");
  if (!el) return;
  let total = 0;
  document.querySelectorAll("#ccPessoalBody .cc-pes-row").forEach((tr) => {
    total += numOrNull(tr.querySelector(".cc-pes-valor")?.value) || 0;
  });
  el.textContent = formatPedidoTotalNumber(total);
}

function collectPessoalRows() {
  return Array.from(document.querySelectorAll("#ccPessoalBody .cc-pes-row"))
    .map((tr) => ({
      nome: tr.querySelector(".cc-pes-nome")?.value?.trim() || "",
      iban: tr.querySelector(".cc-pes-iban")?.value?.trim() || "",
      valor: numOrNull(tr.querySelector(".cc-pes-valor")?.value) || 0,
    }))
    .filter((l) => l.nome && l.valor > 0);
}

// ── Dados próprios de cada tipo ─────────────────────────────

/** O que vai em `typeData`, com os nomes que o servidor lê. */
function collectTypeData(type) {
  const val = (id) => document.getElementById(id)?.value?.trim() || "";
  if (type === "FROTA") {
    const viatura = val("ccPedidoViatura");
    return viatura ? { viatura } : {};
  }
  if (type === "IMPOSTOS") {
    return {
      tipo: val("ccImpTipo"),
      mes: val("ccImpMes"),
      rupe: val("ccImpRupe"),
      limite: val("ccImpLimite"),
      valor: numOrNull(val("ccImpValor")) || 0,
    };
  }
  if (type === "PESSOAL") {
    return { sub: val("ccPesSub"), mes: val("ccPesMes"), linhas: collectPessoalRows() };
  }
  if (type === "EMPRESTIMO") {
    return {
      por: val("ccEmpPor"),
      modo: val("ccEmpModo"),
      valor: numOrNull(val("ccEmpValor")) || 0,
      iban: val("ccEmpIban"),
      fim: val("ccEmpFim"),
      prest: numOrNull(val("ccEmpPrest")) || 1,
    };
  }
  return {};
}

/** O que falta nos dados do tipo, em palavras, ou null se estiver tudo. */
function missingTypeData(type, d) {
  if (type === "IMPOSTOS") {
    if (!d.mes) return "Indique o mês de referência do imposto.";
    if (!(d.valor > 0)) return "Indique o valor do imposto.";
  }
  if (type === "PESSOAL") {
    if (!d.mes) return "Indique o mês do pedido de pessoal.";
    if (!d.linhas.length) return "Acrescente pelo menos um colaborador, com nome e valor.";
  }
  if (type === "EMPRESTIMO") {
    if (!d.por) return "Indique quem pede o empréstimo.";
    if (!(d.valor > 0)) return "Indique o valor do empréstimo.";
  }
  return null;
}

/** Repõe no ecrã os dados próprios de um pedido já gravado. */
function fillTypeData(order) {
  const type = order.requestType || (order.projectId ? "OBRA" : "SEDE");
  const d = order.typeData || {};
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? "" : String(value);
  };
  if (type === "FROTA") set("ccPedidoViatura", d.viatura || "");
  if (type === "IMPOSTOS") {
    set("ccImpTipo", d.tipo || "IVA");
    set("ccImpMes", d.mes || "");
    set("ccImpRupe", d.rupe || "");
    set("ccImpLimite", toDateInput(d.limite));
    set("ccImpValor", d.valor != null ? d.valor : "");
  }
  if (type === "PESSOAL") {
    set("ccPesSub", d.sub || "Salários");
    set("ccPesMes", d.mes || "");
    const tbody = document.getElementById("ccPessoalBody");
    if (tbody) tbody.innerHTML = "";
    const linhas = Array.isArray(d.linhas) && d.linhas.length ? d.linhas : [{}];
    linhas.forEach((l) => addPersonRow(l));
  }
  if (type === "EMPRESTIMO") {
    set("ccEmpPor", d.por || "");
    set("ccEmpModo", d.modo || "TRANSFERENCIA");
    set("ccEmpValor", d.valor != null ? d.valor : "");
    set("ccEmpIban", d.iban || "");
    set("ccEmpFim", d.fim || "");
    set("ccEmpPrest", d.prest != null ? d.prest : "");
  }
}

function selectCostCategory(categoryId) {
  if (!categoryId) return;
  const group = tipo2Groups().find((g) => {
    if (sameCostId(g.tipo2Id, categoryId)) return true;
    return (g.variants || []).some(
      (v) => sameCostId(v.pickCategoryId, categoryId) || sameCostId(v.tipo2Id, categoryId)
    );
  });
  if (!group) return;
  const centroSel = document.getElementById("ccCentroGeralId");
  if (centroSel) centroSel.value = catalogSheetGroupKey(group);
  populateSubcustos();
  const catSel = document.getElementById("ccExtraCostCategoryId");
  if (!catSel) return;
  const match = [...catSel.options].find((o) => o.value && sameCostId(o.value, categoryId));
  if (match) catSel.value = match.value;
  const hiddenSel = document.getElementById("ccExtraCostCategorySelectedId");
  if (hiddenSel) hiddenSel.value = catSel.value || costIdKey(categoryId);
  const hit = (group.variants || []).find((x) => sameCostId(x.pickCategoryId, catSel.value || categoryId));
  syncCostDetail(catSel.value || categoryId, hit?.requiresDetailText);
}

/** Aplica valores iniciais vindos de outra página (tipo, obra, categoria). */
export async function applyPedidoPresets({
  type,
  projectId,
  costCenterId,
  costCategoryId,
  lockType,
  lockProject,
} = {}) {
  const typeSel = document.getElementById("ccPedidoType");
  if (type && typeSel) {
    const wanted = String(type).toUpperCase() === "GERAL" ? "SEDE" : String(type).toUpperCase();
    typeSel.value = REQUEST_TYPES.some(([k]) => k === wanted) ? wanted : "SEDE";
  }
  if (lockType && typeSel) typeSel.disabled = true;
  applyTypeVisibility();

  if (costCategoryId) selectCostCategory(costCategoryId);

  if (projectId) {
    const projSel = document.getElementById("ccExtraProjectId");
    if (projSel) {
      projSel.value = projectId;
      if (lockProject) projSel.disabled = true;
    }
    await loadCostCentersForProject(projectId, costCenterId || "");
  }
}

export function applyQuoteRequirementVisibility() {
  const requiresQuote = Boolean(document.getElementById("ccPedidoRequerCotacao")?.checked);
  const fm = (document.getElementById("ccPedidoModo")?.value || "FORN") === "FM";
  document.getElementById("cc_extraSupplierBlock")?.classList.toggle("hidden", requiresQuote);
  // Com fundo de maneio não se pergunta como se transfere ao fornecedor.
  document.getElementById("cc_extraPaymentBlock")?.classList.toggle("hidden", requiresQuote || fm);
  // A proforma é entregue na requisição, por isso os anexos só fazem sentido aqui
  // quando o pedido dispensa cotação.
  document.getElementById("ccAttachmentsCard")?.classList.toggle("hidden", requiresQuote);
  if (!requiresQuote) applyPaymentSourceVisibility();
}

export function applyPaymentSourceVisibility() {
  const src = document.getElementById("ccExtraSource")?.value || "SOLICITACAO_TRANSFERENCIA";
  const isCard = src === "CARTAO";
  document.getElementById("ccCardRow")?.classList.toggle("hidden", !isCard);
  document.getElementById("ccIbanRow")?.classList.toggle("hidden", isCard);
  document.getElementById("ccSupplierRow")?.classList.remove("hidden");
}

// ── Fornecedores ────────────────────────────────────────────

export function upsertSupplierOption(supplier) {
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

function fillSupplierFields(supplier) {
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

function bindSupplierNifLookup() {
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
        const idx = cache.suppliers.findIndex((s) => s.id === supplier.id);
        if (idx >= 0) cache.suppliers[idx] = supplier;
        else cache.suppliers.push(supplier);
        upsertSupplierOption(supplier);
        fillSupplierFields(supplier);
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

// ── Centros de custo por obra ───────────────────────────────

function uniqueCostCenterOptions(items = []) {
  const seenId = new Set();
  const seenLabel = new Set();
  const out = [];
  for (const cc of items) {
    const id = String(cc?.id || "");
    if (!id || seenId.has(id)) continue;
    seenId.add(id);
    const labelKey = `${cc.code || ""} ${cc.name || ""}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    if (labelKey && seenLabel.has(labelKey)) continue;
    if (labelKey) seenLabel.add(labelKey);
    out.push(cc);
  }
  return out;
}

export async function loadCostCentersForProject(projectId, selectedId = "") {
  const sel = document.getElementById("ccExtraCostCenterId");
  if (!sel) return;
  if (!projectId) {
    sel.innerHTML = `<option value="">Seleccione primeiro o projecto...</option>`;
    return;
  }
  sel.innerHTML = `<option value="">A carregar...</option>`;
  try {
    let arr = [];
    try {
      const data = await apiRequest(`/cost-centers/project/${encodeURIComponent(projectId)}`);
      arr = data?.items || data?.data || [];
    } catch {
      const ccs = await apiRequest("/cost-centers?limit=1000");
      const all = Array.isArray(ccs) ? ccs : (ccs?.items || ccs?.data || []);
      arr = all.filter((cc) => cc.projectId === projectId || cc.project?.id === projectId);
    }
    const items = uniqueCostCenterOptions(arr.filter((cc) => cc.active !== false));
    sel.innerHTML =
      `<option value="">${items.length ? "Seleccione centro..." : "Sem centros nesta obra"}</option>` +
      items
        .map((cc) => {
          const label = (cc.code ? `${cc.code} — ` : "") + (cc.name || cc.id);
          return `<option value="${escapeHtml(cc.id)}">${escapeHtml(label)}</option>`;
        })
        .join("");
    if (selectedId && [...sel.options].some((o) => o.value === selectedId)) sel.value = selectedId;
  } catch {
    sel.innerHTML = `<option value="">Erro ao carregar centros</option>`;
  }
}

// ── Dados de referência ─────────────────────────────────────

export async function ensureReferenceDataLoaded() {
  const projSel = document.getElementById("ccExtraProjectId");
  if (projSel && projSel.options.length <= 1) {
    try {
      const projs = await apiRequest("/projects?limit=500");
      const arr = Array.isArray(projs) ? projs : (projs?.items || projs?.data || []);
      arr.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = (p.code ? p.code + " — " : "") + (p.name || p.id);
        projSel.appendChild(opt);
      });
    } catch { /* ignore */ }
  }

  const supSel = document.getElementById("ccExtraSupplierId");
  if (supSel && supSel.options.length <= 1) {
    try {
      const sups = await apiRequest("/suppliers?limit=500");
      const arr = Array.isArray(sups) ? sups : (sups?.items || sups?.data || []);
      cache.suppliers = arr;
      arr.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = (s.name || s.id) + (s.nif ? " (" + s.nif + ")" : "");
        supSel.appendChild(opt);
      });
    } catch { /* ignore */ }
    supSel?.addEventListener("change", () => {
      const v = supSel.value;
      const nifEl = document.getElementById("ccExtraSupplierNif");
      if (!v) {
        if (nifEl) delete nifEl.dataset.validatedNif;
        setNifLookupStatus(document.getElementById("ccExtraSupplierNifStatus"), "");
        return;
      }
      const cached = cache.suppliers.find((s) => s.id === v);
      if (cached) {
        fillSupplierFields(cached);
        return;
      }
      apiRequest(`/suppliers/${encodeURIComponent(v)}`).then(fillSupplierFields).catch(() => {});
    });
  }

  // Os tipos, as condições e os fundos de maneio vêm do servidor: a lista do
  // ecrã é só o que se vê antes da resposta chegar.
  const fundSel = document.getElementById("ccPedidoFundId");
  const typeSel = document.getElementById("ccPedidoType");
  if (fundSel && !fundSel.dataset.ccLoaded) {
    try {
      const meta = await apiRequest("/purchase-orders/payment/meta");
      fundSel.dataset.ccLoaded = "1";
      (meta?.funds || []).forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.name || f.id;
        fundSel.appendChild(opt);
      });
      const tipos = meta?.requestTypes || [];
      if (typeSel && tipos.length) {
        const prev = typeSel.value;
        typeSel.innerHTML = tipos
          .map((t) => `<option value="${escapeHtml(t.k)}">${escapeHtml(t.label)}</option>`)
          .join("");
        if ([...typeSel.options].some((o) => o.value === prev)) typeSel.value = prev;
      }
    } catch { /* fica a lista do ecrã */ }
  }

  const cardSel = document.getElementById("ccExtraCardId");
  if (cardSel && cardSel.options.length <= 1) {
    try {
      const cards = await apiRequest("/petty-cash/cards?limit=500");
      const arr = Array.isArray(cards) ? cards : (cards?.items || cards?.data || []);
      arr.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.label || c.name || c.id;
        cardSel.appendChild(opt);
      });
    } catch { /* ignore */ }
  }

  if (projSel && !projSel.dataset.ccCcWired) {
    projSel.dataset.ccCcWired = "1";
    projSel.addEventListener("change", () => loadCostCentersForProject(projSel.value));
  }
  await loadCostCentersForProject(projSel?.value || "");

  const gccSel = document.getElementById("ccCentroGeralId");
  if (gccSel && !gccSel.dataset.ccWired) {
    gccSel.dataset.ccWired = "1";
    gccSel.addEventListener("change", populateSubcustos);
  }

  if (!cache.costCategories.length) {
    try {
      cache.costCategories = await loadAllCostCategories("", { includeInactive: true });
    } catch {
      cache.costCategories = getCachedCategories();
    }
  }

  const catSel = document.getElementById("ccExtraCostCategoryId");
  if (catSel && !catSel.dataset.ccWired) {
    catSel.dataset.ccWired = "1";
    catSel.addEventListener("change", () => {
      const v = catSel.value;
      const hiddenSel = document.getElementById("ccExtraCostCategorySelectedId");
      if (hiddenSel) hiddenSel.value = v;
      const centroKey = document.getElementById("ccCentroGeralId")?.value || "";
      const group = tipo2Groups().find((g) => catalogSheetGroupKey(g) === centroKey);
      const hit = (group?.variants || []).find((x) => sameCostId(x.pickCategoryId, v));
      syncCostDetail(v, hit?.requiresDetailText);
    });
  }

  populateCentrosGerais();
}

// ── Recolha e validação do payload ──────────────────────────

function collectItems() {
  return Array.from(document.querySelectorAll(".cc-item-row")).map((tr) => {
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
    const pct = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
    // A fiscalidade vai em campos próprios. Antes era escrita no texto das notas
    // ("IVA 14% · Ret. 6,5%") e lida de volta por expressão regular no servidor,
    // onde a retenção se perdia; o campo `notes` fica para notas de facto.
    return {
      name,
      quantity,
      unit,
      unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : null,
      vatPercent: pct(vat),
      withholdingPercent: pct(wh),
      discountPercent: pct(disc),
      notes: tr.querySelector(".cc-item-obs")?.value?.trim() || null,
      // DSC (despesa sem comprovativo) e AF (autofaturação) dispensam a fatura
      // nesta linha — é o controlo documental da base de referência.
      docException: tr.querySelector(".cc-item-doc")?.value || null,
    };
  }).filter((it) => it.name && Number.isFinite(it.quantity) && it.quantity > 0);
}

/**
 * Valida o formulário e devolve o payload para /purchase-orders,
 * ou null se alguma validação falhar (o erro já foi mostrado).
 */
async function buildPedidoPayload() {
  const requestedByName = document.getElementById("ccPedidoSolicitante")?.value?.trim() || "";
  if (!requestedByName) {
    notify("Indique o solicitante", "error");
    return null;
  }

  const description = document.getElementById("ccPedidoDesc")?.value?.trim() || "";
  if (!description) {
    notify("Indique a descrição do pedido", "error");
    return null;
  }

  const type = currentRequestType();
  const comItens = typeHasItems(type);

  const items = comItens ? collectItems() : [];
  if (comItens && !items.length) {
    notify("Adicione pelo menos um item ao pedido", "error");
    return null;
  }

  const typeData = collectTypeData(type);
  const falta = missingTypeData(type, typeData);
  if (falta) {
    notify(falta, "error");
    return null;
  }

  if (isFerramentasCentro()) {
    try {
      await ensureToolsInCatalog(document.querySelectorAll(".cc-item-row"));
    } catch (err) {
      notify("Não foi possível actualizar o catálogo de ferramentas: " + describeError(err), "error");
      return null;
    }
  }

  const requiresQuote = Boolean(document.getElementById("ccPedidoRequerCotacao")?.checked ?? true);
  const paymentMode = document.getElementById("ccPedidoModo")?.value === "FM" ? "FM" : "FORN";
  const pettyCashFundId = paymentMode === "FM" ? (document.getElementById("ccPedidoFundId")?.value || "") : "";
  if (paymentMode === "FM" && !pettyCashFundId) {
    notify("Seleccione o fundo de maneio de onde sai o dinheiro.", "error");
    return null;
  }

  // Impostos, pessoal e empréstimo não têm fornecedor a cotar nem IBAN de
  // fornecedor a validar: o beneficiário está nos dados do tipo.
  if (!requiresQuote && comItens && paymentMode === "FORN") {
    const supplierId = document.getElementById("ccExtraSupplierId")?.value || "";
    const nif = normalizeNif(document.getElementById("ccExtraSupplierNif")?.value);
    const validated = document.getElementById("ccExtraSupplierNif")?.dataset?.validatedNif || "";
    const name = document.getElementById("ccExtraSupplierName")?.value?.trim() || "";
    if (!supplierId && !nif) {
      notify("Indique o fornecedor registado ou consulte o NIF para cadastrar um novo.", "error");
      return null;
    }
    if (!supplierId && nif && validated !== nif) {
      notify("Consulte o NIF na AGT antes de gravar o pedido.", "error");
      return null;
    }
    if (!name) {
      notify("O nome do fornecedor é obrigatório. Consulte o NIF para o preencher.", "error");
      return null;
    }
    const src = document.getElementById("ccExtraSource")?.value || "SOLICITACAO_TRANSFERENCIA";
    if (src === "SOLICITACAO_TRANSFERENCIA" && !(document.getElementById("ccExtraSupplierIban")?.value?.trim() || "")) {
      notify("Indique o IBAN do fornecedor para a transferência.", "error");
      return null;
    }
    if (src === "CARTAO" && !(document.getElementById("ccExtraCardId")?.value || "")) {
      notify("Seleccione o cartão multibanco.", "error");
      return null;
    }
  }

  const centroSel = document.getElementById("ccCentroGeralId");
  const group = tipo2Groups().find((g) => catalogSheetGroupKey(g) === (centroSel?.value || ""));
  if (!group) {
    notify("Seleccione o centro geral", "error");
    return null;
  }
  const realTipo3 = (group.variants || []).filter((v) => v.tipo3 && v.tipo3 !== "—");
  const categoryId =
    document.getElementById("ccExtraCostCategoryId")?.value ||
    document.getElementById("ccExtraCostCategorySelectedId")?.value ||
    "";
  if (realTipo3.length && !categoryId) {
    notify("Seleccione a categoria de custo", "error");
    return null;
  }

  const classification = type;
  const projectId = classification === "OBRA" ? (document.getElementById("ccExtraProjectId")?.value || null) : null;
  const costCenterId = classification === "OBRA" ? (document.getElementById("ccExtraCostCenterId")?.value || null) : null;
  if (classification === "OBRA") {
    if (!projectId) {
      notify("Seleccione o projecto (obra)", "error");
      return null;
    }
    if (!costCenterId) {
      notify("Seleccione o centro de custo da obra", "error");
      return null;
    }
  }

  const projectLabel = document.getElementById("ccExtraProjectId")?.selectedOptions?.[0]?.textContent || "";
  const notes = [
    document.getElementById("ccPedidoJust")?.value?.trim() || "",
    classification === "OBRA"
      ? `Classificação: Obra${projectLabel ? " · " + projectLabel : ""}`
      : `Classificação: ${typeLabel(type)}`,
    `Centro geral: ${centroSel?.selectedOptions?.[0]?.textContent || group.tipo2}`,
    realTipo3.length
      ? `Categoria: ${document.getElementById("ccExtraCostCategoryId")?.selectedOptions?.[0]?.textContent || ""}`
      : null,
    document.getElementById("ccExtraCostDetailDesc")?.value?.trim() || null,
    !requiresQuote && paymentMode === "FORN"
      ? [
          `Origem pagamento: ${document.getElementById("ccExtraSource")?.selectedOptions?.[0]?.textContent || document.getElementById("ccExtraSource")?.value || ""}`,
          document.getElementById("ccExtraSource")?.value === "CARTAO"
            ? `Cartão: ${document.getElementById("ccExtraCardId")?.selectedOptions?.[0]?.textContent || ""}`
            : `IBAN fornecedor: ${document.getElementById("ccExtraSupplierIban")?.value?.trim() || ""}`,
        ].filter(Boolean).join("\n")
      : null,
  ].filter(Boolean).join("\n");

  // Condição de pagamento: pronto com data pretendida, crédito com dias (que
  // dão o vencimento) e prestações a partir da data pretendida.
  const paymentTerm = document.getElementById("ccPedidoCondicao")?.value || "PRONTO";
  const creditDaysRaw = numOrNull(document.getElementById("ccPedidoDiasCredito")?.value);
  if (paymentTerm === "CREDITO" && (creditDaysRaw === null || creditDaysRaw < 0)) {
    notify("Indique os dias de crédito.", "error");
    return null;
  }
  const wantedDate = document.getElementById("ccPedidoDataPretendida")?.value || null;
  const installments = numOrNull(document.getElementById("ccPedidoPrestacoes")?.value);
  if (paymentTerm === "PARCIAL" && (installments === null || installments < 2)) {
    notify("Indique em quantas prestações se paga (pelo menos 2).", "error");
    return null;
  }
  const dueDate = paymentTerm === "CREDITO" ? creditDueDate(creditDaysRaw) : wantedDate;

  const user = getSessionUser();
  return {
    type: "PEDIDO",
    priority: document.getElementById("ccPedidoPriority")?.value || "NORMAL",
    requestedByName,
    requestedById: user?.id || user?.sub || null,
    description,
    justification: document.getElementById("ccPedidoJust")?.value?.trim() || null,
    needDate: document.getElementById("ccPedidoData")?.value || null,
    requiresQuote,
    projectId,
    costCenterId,
    supplierId: requiresQuote ? null : (document.getElementById("ccExtraSupplierId")?.value || null),
    supplierName: requiresQuote ? null : (document.getElementById("ccExtraSupplierName")?.value?.trim() || null),
    currency: "AOA",
    notes: notes || null,
    items,

    // ─── Requisição de pagamento ───
    requestType: type,
    paymentMode,
    pettyCashFundId: pettyCashFundId || null,
    typeData,
    paymentTerm,
    creditDays: paymentTerm === "CREDITO" ? Math.round(creditDaysRaw) : null,
    dueDate,
    /** Não vai para o servidor: serve para dividir o plano depois de gravar. */
    _installments: paymentTerm === "PARCIAL" ? Math.round(installments) : null,
  };
}

export async function savePedido() {
  const payload = await buildPedidoPayload();
  if (!payload) return null;

  const extraId = document.getElementById("ccPedidoExtraId")?.value || "";
  if (extraId) {
    const items = (payload.items || []).map((it) => ({
      description: it.name,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      notes: it.notes,
    }));
    const amount = items.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
      0
    );
    const saved = await apiRequest(`/extra-requests/${extraId}`, {
      method: "PATCH",
      body: {
        description: payload.description,
        notes: payload.justification,
        amount,
        priority: payload.priority,
        requestedBy: payload.requestedByName,
        desiredDate: payload.needDate,
        paymentDueDate: payload.needDate,
        requiresQuote: payload.requiresQuote,
        supplierId: payload.supplierId,
        supplierName: payload.supplierName,
        items,
      },
    });
    return { saved, isEdit: true, requiresQuote: payload.requiresQuote };
  }

  const editId = document.getElementById("ccPedidoEditId")?.value || "";
  const { _installments: parcelas, ...body } = payload;
  const saved = editId
    ? await apiRequest(`/purchase-orders/${editId}`, { method: "PATCH", body })
    : await apiRequest("/purchase-orders", { method: "POST", body });

  // O plano de prestações é outro documento e precisa do pedido já gravado.
  // Quem pede não tem sempre a permissão de pagamentos: se não puder, diz-se
  // onde se faz em vez de se perder o pedido.
  let plan = null;
  if (parcelas && saved?.id) {
    try {
      plan = await apiRequest(`/purchase-orders/${saved.id}/payment-plan/split`, {
        method: "POST",
        body: { count: parcelas, firstDate: body.dueDate || null },
      });
    } catch {
      notify(
        `O pedido ficou gravado, mas as ${parcelas} prestações têm de ser criadas no Centro de Pagamentos.`,
        "info"
      );
    }
  }

  return { saved, isEdit: Boolean(editId), requiresQuote: payload.requiresQuote, plan };
}

// ── Anexos ──────────────────────────────────────────────────

export async function uploadPedidoAttachment(orderId, file) {
  return apiUpload(`/purchase-orders/${orderId}/requisition/upload`, { file, fieldName: "file" });
}

// ── Ciclo de vida ───────────────────────────────────────────

export function resetPedidoForm() {
  document.getElementById("formNovoPedido")?.reset();
  const editId = document.getElementById("ccPedidoEditId");
  if (editId) editId.value = "";
  const extraId = document.getElementById("ccPedidoExtraId");
  if (extraId) extraId.value = "";
  hideAllItemSuggest();
  const itemsBody = document.getElementById("ccItemsBody");
  if (itemsBody) itemsBody.innerHTML = "";
  const pessoalBody = document.getElementById("ccPessoalBody");
  if (pessoalBody) pessoalBody.innerHTML = "";
  applyTypeVisibility();
  applyPaymentModeVisibility();
  applyPaymentTermVisibility();
}

/** Preenche o formulário com um pedido existente. Devolve o pedido carregado. */
export async function fillPedidoForm(order, { extra = false } = {}) {
  const extraEl = document.getElementById("ccPedidoExtraId");
  const editEl = document.getElementById("ccPedidoEditId");
  if (extra) {
    if (extraEl) extraEl.value = order.id || "";
    if (editEl) editEl.value = "";
  } else {
    if (editEl) editEl.value = order.id || "";
    if (extraEl) extraEl.value = "";
  }
  document.getElementById("ccPedidoPriority").value = order.priority || "NORMAL";
  document.getElementById("ccPedidoSolicitante").value = order.requestedByName || "";
  document.getElementById("ccPedidoData").value = toDateInput(order.needDate);
  document.getElementById("ccPedidoDesc").value = order.description || "";
  document.getElementById("ccPedidoJust").value = order.justification || "";
  document.getElementById("ccPedidoRequerCotacao").checked = Boolean(order.requiresQuote ?? true);

  const typeSel = document.getElementById("ccPedidoType");
  typeSel.value = order.requestType || (order.projectId ? "OBRA" : "SEDE");
  if (extra) {
    // Um pedido extra da obra grava-se noutra rota, que só conhece itens.
    [...typeSel.options].forEach((o) => {
      o.hidden = !typeHasItems(o.value);
    });
    if (!typeHasItems(typeSel.value)) typeSel.value = "OBRA";
  }

  document.getElementById("ccPedidoModo").value = order.paymentMode === "FM" ? "FM" : "FORN";
  document.getElementById("ccPedidoCondicao").value = order.paymentTerm || "PRONTO";
  document.getElementById("ccPedidoDiasCredito").value = order.creditDays != null ? order.creditDays : "";
  document.getElementById("ccPedidoDataPretendida").value =
    order.paymentTerm === "CREDITO" ? "" : toDateInput(order.dueDate);
  const parcelas = (order.paymentPlan?.installments || []).length;
  document.getElementById("ccPedidoPrestacoes").value = parcelas >= 2 ? parcelas : "";

  fillTypeData(order);
  applyTypeVisibility();
  applyPaymentModeVisibility();
  applyPaymentTermVisibility();
  applyQuoteRequirementVisibility();
  fillItemRows(order.items || []);

  await ensureReferenceDataLoaded();

  if (order.projectId) {
    const projSel = document.getElementById("ccExtraProjectId");
    if (projSel) projSel.value = order.projectId;
    await loadCostCentersForProject(order.projectId, order.costCenterId || "");
  }
  const fundSel = document.getElementById("ccPedidoFundId");
  if (fundSel && order.pettyCashFundId) fundSel.value = order.pettyCashFundId;

  if (!order.requiresQuote && (order.supplierId || order.supplierName)) {
    if (order.supplierId) {
      upsertSupplierOption(order.supplier || { id: order.supplierId, name: order.supplierName });
    }
    const nameEl = document.getElementById("ccExtraSupplierName");
    if (nameEl) nameEl.value = order.supplierName || order.supplier?.name || "";
  }
  return order;
}

/**
 * Liga os eventos do formulário. Chamar uma única vez por página.
 * @param {object} deps
 * @param {(msg: string, type?: string) => void} [deps.showToast]
 * @param {(err: unknown) => string} [deps.apiError]
 */
export function initPurchaseOrderForm({ showToast, apiError } = {}) {
  if (showToast) notify = showToast;
  if (apiError) describeError = apiError;

  document.getElementById("ccPedidoType")?.addEventListener("change", applyTypeVisibility);
  document.getElementById("ccPedidoRequerCotacao")?.addEventListener("change", applyQuoteRequirementVisibility);
  document.getElementById("ccExtraSource")?.addEventListener("change", applyPaymentSourceVisibility);
  document.getElementById("ccPedidoModo")?.addEventListener("change", applyPaymentModeVisibility);
  document.getElementById("ccPedidoCondicao")?.addEventListener("change", applyPaymentTermVisibility);
  document.getElementById("ccPedidoDiasCredito")?.addEventListener("input", updateDueDateHint);
  document.getElementById("btnCCAddPessoa")?.addEventListener("click", () => addPersonRow());
  document.getElementById("ccPessoalTable")?.addEventListener("input", refreshPessoalTotal);
  document.getElementById("btnCCAddItem")?.addEventListener("click", () => addItemRow());
  document.getElementById("ccItemsTable")?.addEventListener("input", refreshTotals);
  document.getElementById("ccItemsTable")?.addEventListener("change", refreshTotals);
  bindSupplierNifLookup();

  document.addEventListener("click", (e) => {
    if (e.target.closest(".cc-item-desc") || e.target.closest(".cc-item-suggest")) return;
    hideAllItemSuggest();
  });
}
