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
    catSel.innerHTML = `<option value="${escapeHtml(costIdKey(pick))}">Sem subcustos — este centro é a categoria</option>`;
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
  const cleanName = String(name || "").replace(/\s+/g, " ").trim();
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

export function hideAllItemSuggest() {
  document.querySelectorAll(".cc-item-suggest").forEach((el) => el.classList.add("hidden"));
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
  const box = tr.querySelector(".cc-item-suggest");
  if (!box) return;
  if (!isFerramentasCentro()) {
    box.classList.add("hidden");
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
    box.classList.add("hidden");
    return;
  }
  box.innerHTML = rows + createRow;
  box.classList.remove("hidden");
}

function bindItemDescSuggest(tr) {
  const input = tr.querySelector(".cc-item-desc");
  const box = tr.querySelector(".cc-item-suggest");
  if (!input || input.dataset.suggestBound === "1") return;
  input.dataset.suggestBound = "1";

  input.addEventListener("input", () => {
    delete tr.dataset.productId;
    if (!isFerramentasCentro()) {
      box?.classList.add("hidden");
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
      const product = (cache.tools || []).find((p) => p.id === hit.dataset.productId);
      applyToolToItemRow(tr, product);
      box.classList.add("hidden");
      return;
    }
    if (createBtn) {
      if (box.dataset.ensuring === "1") return;
      const name = createBtn.dataset.createName;
      const existing = findCachedTool(name);
      if (existing) {
        applyToolToItemRow(tr, existing);
        box.classList.add("hidden");
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
        input.value = name;
      } finally {
        delete box.dataset.ensuring;
      }
      box.classList.add("hidden");
    }
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
    <td style="position:relative">
      <input type="text" required autocomplete="off" class="cc-item-desc pf-cell-input"
        placeholder="${tools ? "Pesquisar no catálogo..." : "Item description"}">
      <div class="cc-item-suggest pf-suggest hidden"></div>
    </td>
    <td><input type="number" min="1" value="1" required class="cc-item-qty pf-cell-input pf-cell-input--right"></td>
    <td><input type="text" placeholder="un" required class="cc-item-unit pf-cell-input"></td>
    <td><input type="number" step="0.01" min="0" placeholder="0.00" class="cc-item-price pf-cell-input pf-cell-input--right"></td>
    <td><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-vat pf-cell-input pf-cell-input--right"></td>
    <td><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-wh pf-cell-input pf-cell-input--right"></td>
    <td><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-disc pf-cell-input pf-cell-input--right"></td>
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
    tr.remove();
    if (!tbody.querySelector(".cc-item-row")) addItemRow();
    refreshTotals();
  });
  refreshTotals();
  return tr;
}

export function refreshTotals() {
  refreshPedidoTotalsFromRows("ccPedido", "#ccItemsBody .cc-item-row");

  let retention = 0;
  document.querySelectorAll("#ccItemsBody .cc-item-row").forEach((row) => {
    const qty = parseFloat(row.querySelector(".cc-item-qty")?.value || "0") || 0;
    const price = parseFloat(row.querySelector(".cc-item-price")?.value || "0") || 0;
    const disc = parseFloat(row.querySelector(".cc-item-disc")?.value || "0") || 0;
    const vat = parseFloat(row.querySelector(".cc-item-vat")?.value || "0") || 0;
    const ret = parseFloat(row.querySelector(".cc-item-wh")?.value || "0") || 0;
    const liquido = qty * price * (1 - disc / 100);
    retention += (liquido * ret) / 100;
    const cell = row.querySelector(".cc-item-line-total");
    if (cell) cell.textContent = formatPedidoTotalNumber(liquido * (1 + vat / 100));
  });
  const retEl = document.getElementById("ccPedidoTotal_retencao");
  if (retEl) retEl.textContent = formatPedidoTotalNumber(retention);
}

export function fillItemRows(items) {
  const tbody = document.getElementById("ccItemsBody");
  if (!tbody) return;
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
    const tax = parseItemTax(it.notes);
    if (tax.vat) set(".cc-item-vat", tax.vat);
    if (tax.retention) set(".cc-item-wh", tax.retention);
    if (tax.discount) set(".cc-item-disc", tax.discount);
  });
  refreshTotals();
}

// ── Visibilidade condicional ────────────────────────────────

export function applyTypeVisibility() {
  const type = (document.getElementById("ccPedidoType")?.value || "GERAL").toUpperCase();
  const obraProj = document.getElementById("cc_rowObraProject");
  const obraCent = document.getElementById("cc_rowObraCenter");
  if (obraProj) obraProj.classList.toggle("hidden", type !== "OBRA");
  if (obraCent) obraCent.classList.toggle("hidden", type !== "OBRA");
  populateCentrosGerais();
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
    typeSel.value = String(type).toUpperCase() === "OBRA" ? "OBRA" : "GERAL";
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
  document.getElementById("cc_extraSupplierBlock")?.classList.toggle("hidden", requiresQuote);
  document.getElementById("cc_extraPaymentBlock")?.classList.toggle("hidden", requiresQuote);
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

  const items = collectItems();
  if (!items.length) {
    notify("Adicione pelo menos um item ao pedido", "error");
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
  if (!requiresQuote) {
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

  const classification = (document.getElementById("ccPedidoType")?.value || "GERAL").toUpperCase();
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
      : "Classificação: Geral",
    `Centro geral: ${centroSel?.selectedOptions?.[0]?.textContent || group.tipo2}`,
    realTipo3.length
      ? `Categoria: ${document.getElementById("ccExtraCostCategoryId")?.selectedOptions?.[0]?.textContent || ""}`
      : null,
    document.getElementById("ccExtraCostDetailDesc")?.value?.trim() || null,
    !requiresQuote
      ? [
          `Origem pagamento: ${document.getElementById("ccExtraSource")?.selectedOptions?.[0]?.textContent || document.getElementById("ccExtraSource")?.value || ""}`,
          document.getElementById("ccExtraSource")?.value === "CARTAO"
            ? `Cartão: ${document.getElementById("ccExtraCardId")?.selectedOptions?.[0]?.textContent || ""}`
            : `IBAN fornecedor: ${document.getElementById("ccExtraSupplierIban")?.value?.trim() || ""}`,
        ].filter(Boolean).join("\n")
      : null,
  ].filter(Boolean).join("\n");

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
  };
}

export async function savePedido() {
  const payload = await buildPedidoPayload();
  if (!payload) return null;

  const editId = document.getElementById("ccPedidoEditId")?.value || "";
  const saved = editId
    ? await apiRequest(`/purchase-orders/${editId}`, { method: "PATCH", body: payload })
    : await apiRequest("/purchase-orders", { method: "POST", body: payload });

  return { saved, isEdit: Boolean(editId), requiresQuote: payload.requiresQuote };
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
  const itemsBody = document.getElementById("ccItemsBody");
  if (itemsBody) itemsBody.innerHTML = "";
}

/** Preenche o formulário com um pedido existente. Devolve o pedido carregado. */
export async function fillPedidoForm(order) {
  document.getElementById("ccPedidoEditId").value = order.id;
  document.getElementById("ccPedidoPriority").value = order.priority || "NORMAL";
  document.getElementById("ccPedidoSolicitante").value = order.requestedByName || "";
  document.getElementById("ccPedidoData").value = toDateInput(order.needDate);
  document.getElementById("ccPedidoDesc").value = order.description || "";
  document.getElementById("ccPedidoJust").value = order.justification || "";
  document.getElementById("ccPedidoRequerCotacao").checked = Boolean(order.requiresQuote ?? true);
  document.getElementById("ccPedidoType").value = order.projectId ? "OBRA" : "GERAL";
  applyTypeVisibility();
  applyQuoteRequirementVisibility();
  fillItemRows(order.items || []);

  await ensureReferenceDataLoaded();

  if (order.projectId) {
    const projSel = document.getElementById("ccExtraProjectId");
    if (projSel) projSel.value = order.projectId;
    await loadCostCentersForProject(order.projectId, order.costCenterId || "");
  }
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
  document.getElementById("btnCCAddItem")?.addEventListener("click", () => addItemRow());
  document.getElementById("ccItemsTable")?.addEventListener("input", refreshTotals);
  document.getElementById("ccItemsTable")?.addEventListener("change", refreshTotals);
  bindSupplierNifLookup();

  document.addEventListener("click", (e) => {
    if (e.target.closest(".cc-item-desc") || e.target.closest(".cc-item-suggest")) return;
    hideAllItemSuggest();
  });
}
