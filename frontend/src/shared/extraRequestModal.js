import { apiRequest, apiUpload } from "../services/api.js";
import { can } from "./permissions.js";
import { formatCurrency } from "./format.js";
import { computeFiscalBreakdown, formatFiscalAmount } from "./supplierFiscal.js";
import {
  loadAllCostCategories,
  mountRubricFirstCascade,
  resetCostCategoryCascade,
  extraTypeToCostDomain,
  COST_CASCADE_IDS,
  DOMAIN_LABELS,
  isToolCostSelection,
  classifyObraCostCenterKind,
} from "./costCategoryCascade.js";

const EXTRA_MODAL_HTML = `
<div class="modal-overlay" id="modalExtra">
  <div class="modal-box" style="max-width:640px">
    <div class="flex items-center justify-between mb-6">
      <h2 id="modalExtraTitle" class="text-lg font-bold text-slate-900">Novo Pedido Extra</h2>
      <button type="button" id="btnCloseExtraModal" aria-label="Fechar"
        class="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-all">
        <span class="material-symbols-outlined text-base">close</span>
      </button>
    </div>
    <form id="formExtra" class="flex flex-col gap-4">
      <input type="hidden" id="extraEditId" value="">
      <div id="extraTypeRow">
        <label class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Tipo *</label>
        <div class="flex gap-2">
          <button type="button" id="btnTypeGeral" class="type-toggle-btn active flex-1">Geral</button>
          <button type="button" id="btnTypeObra" class="type-toggle-btn flex-1">Obra</button>
        </div>
        <input type="hidden" id="extraType" value="GERAL">
      </div>
      <div id="rowCostCategory" class="rounded-xl border border-slate-100 bg-slate-50/80 p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-bold text-slate-500 uppercase tracking-widest">Classificação do custo *</span>
          <span id="extraCostDomainBadge" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold"></span>
        </div>
        <p class="text-[11px] text-slate-500 leading-relaxed">Escolha Tipo 1 → Tipo 2 → Subcusto (tipo 3), se existir.</p>
        <p id="extraCostSelectionSummary" class="text-xs font-semibold text-slate-400 leading-relaxed min-h-[1.25rem]"></p>
        <div id="extraCostCategoryCascade" class="flex flex-col gap-3"></div>
        <input type="hidden" id="extraCostCategoryId" value="">
        <div id="rowCostDetailDescription" class="hidden">
          <label id="extraCostDetailLabel" for="extraCostDetailDescription" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 mt-1">Descrição custo *</label>
          <select id="extraToolSelect"
            class="hidden w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            <option value="">Seleccionar ferramenta...</option>
          </select>
          <input id="extraCostDetailDescription" type="text" placeholder="Ex.: nome da ferramenta ou material"
            class="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
          <p id="extraToolSelectHint" class="hidden text-[11px] text-slate-400 mt-1"></p>
        </div>
      </div>
      <div id="rowProject" class="hidden">
        <label for="extraProjectId" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Obra *</label>
        <select id="extraProjectId"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
          <option value="">Selecionar obra...</option>
        </select>
      </div>
      <div id="rowObraCostCenter" class="hidden">
        <label for="extraCostCenterId" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Centro de Custo da Obra *</label>
        <select id="extraCostCenterId"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
          <option value="">Seleccione primeiro a obra...</option>
        </select>
      </div>
      <div>
        <label id="extraDescLabel" for="extraDesc" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Descrição *</label>
        <select id="extraDescSelect"
          class="hidden w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
          <option value="">Seleccionar...</option>
        </select>
        <input id="extraDesc" type="text" required placeholder="Motivo do pedido extra"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
        <p id="extraDescSelectHint" class="hidden text-[11px] text-slate-400 mt-1"></p>
      </div>
      <div id="rowExtraQuantity" class="hidden">
        <label for="extraQuantity" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Quantidade *</label>
        <input id="extraQuantity" type="number" step="0.01" min="0.01" placeholder="Ex.: 1"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
        <p class="text-[11px] text-slate-400 mt-1">Indique quantas unidades de ferramenta/material pretende pedir.</p>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="extraAmount" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Valor *</label>
          <input id="extraAmount" type="number" step="0.01" min="0.01" required placeholder="0.00"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
        </div>
        <div>
          <label for="extraPaymentDueDate" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Data Prevista*</label>
          <input id="extraPaymentDueDate" type="date" required
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
        </div>
      </div>
      <div id="rowExtraFiscal" class="rounded-xl border border-slate-100 bg-slate-50/80 p-4 space-y-3">
        <p class="text-xs font-bold text-slate-500 uppercase tracking-widest">Impostos no valor</p>
        <div class="flex flex-wrap gap-3 text-sm font-semibold text-slate-700">
          <label class="inline-flex items-center gap-2 cursor-pointer">
            <input type="radio" name="extraFiscalMode" id="extraFiscalModeBase" value="base" checked class="accent-emerald-600">
            Valor base (sem impostos)
          </label>
          <label class="inline-flex items-center gap-2 cursor-pointer">
            <input type="radio" name="extraFiscalMode" id="extraFiscalModeGross" value="gross" class="accent-emerald-600">
            Já inclui IVA / impostos
          </label>
        </div>
        <div id="extraFiscalFlags" class="hidden space-y-3">
          <div class="flex flex-wrap gap-4 text-xs font-bold text-slate-700">
            <label class="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" id="extraFiscalApplyVat" class="accent-emerald-600" checked> IVA incluído</label>
            <label class="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" id="extraFiscalApplyWithholding" class="accent-emerald-600"> Retenção incluída</label>
            <label class="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" id="extraFiscalApplyDiscount" class="accent-emerald-600"> Desconto incluído</label>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div id="extraFiscalVatPctWrap" class="hidden">
              <label for="extraFiscalVatPercent" class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">IVA %</label>
              <input id="extraFiscalVatPercent" type="number" min="0.01" max="100" step="0.01" placeholder="Ex: 14"
                class="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            </div>
            <div id="extraFiscalWhPctWrap" class="hidden">
              <label for="extraFiscalWithholdingPercent" class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Retenção %</label>
              <input id="extraFiscalWithholdingPercent" type="number" min="0.01" max="100" step="0.01" placeholder="Ex: 6.5"
                class="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            </div>
            <div id="extraFiscalDiscPctWrap" class="hidden">
              <label for="extraFiscalDiscountPercent" class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Desconto %</label>
              <input id="extraFiscalDiscountPercent" type="number" min="0.01" max="100" step="0.01" placeholder="Ex: 5"
                class="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            </div>
          </div>
          <div id="extraFiscalPreview" class="hidden rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs text-slate-600 space-y-1"></div>
        </div>
        <p id="extraFiscalHint" class="text-[11px] text-slate-400">Na liquidação o cálculo fiscal usa esta indicação (base ou bruto).</p>
      </div>
      <div class="grid grid-cols-1 gap-4">
        <div>
          <label for="extraSource" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Origem do Pagamento</label>
          <select id="extraSource"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            <option value="FUNDO_MANEIO">Cartão (gasto)</option>
            <option value="TRANSFERENCIA_INTERNA_CARTAO">Transferência interna (carregar cartão)</option>
            <option value="SOLICITACAO_TRANSFERENCIA">Solicitação de Transferência</option>
          </select>
        </div>
      </div>
      <div id="extraCardRow" class="hidden">
        <input type="hidden" id="extraFundId" value="">
        <label for="extraCardId" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Cartão *</label>
        <select id="extraCardId"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
          <option value="">Selecionar cartão...</option>
        </select>
      </div>
      <div id="extraSupplierRow" class="hidden space-y-3">
        <div>
          <label for="extraSupplierId" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Fornecedor</label>
          <select id="extraSupplierId"
            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            <option value="">Seleccionar fornecedor registado...</option>
          </select>
          <p class="text-[11px] text-slate-400 mt-1">Ou preencha manualmente Nome, NIF e IBAN abaixo.</p>
        </div>
        <div class="grid grid-cols-1 gap-3">
          <div>
            <label for="extraSupplierName" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Nome do Fornecedor *</label>
            <input id="extraSupplierName" type="text" placeholder="Nome completo / razão social"
              class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="extraSupplierNif" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">NIF *</label>
              <input id="extraSupplierNif" type="text" placeholder="NIF"
                class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            </div>
            <div>
              <label for="extraSupplierIban" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">IBAN *</label>
              <input id="extraSupplierIban" type="text" placeholder="AO06..."
                class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            </div>
          </div>
        </div>
      </div>
      <div id="extraProformaRow" class="hidden">
        <label for="extraProforma" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Proforma *</label>
        <input id="extraProforma" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
          class="w-full text-sm font-semibold text-slate-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:font-bold hover:file:bg-emerald-100">
        <p class="text-[11px] text-slate-400 mt-1">Obrigatório para solicitação de transferência bancária (PDF ou imagem).</p>
        <p id="extraProformaBlockedHint" class="hidden text-[11px] text-amber-600 mt-1 font-semibold">Preencha o fornecedor (Nome, NIF e IBAN) antes de anexar o documento.</p>
        <p id="extraProformaHint" class="hidden text-[11px] text-emerald-600 mt-1 font-semibold">Proforma já anexada. Envie um novo ficheiro apenas para substituir.</p>
      </div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" id="btnCancelExtra"
          class="h-10 px-5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all">Cancelar</button>
        <button type="submit" id="extraSubmitBtn"
          class="h-10 px-6 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-all">Guardar Pedido</button>
      </div>
    </form>
  </div>
</div>`;

export function isExtraCardSource(source) {
  return source === "FUNDO_MANEIO" || source === "TRANSFERENCIA_INTERNA_CARTAO";
}

let allProjects = [];
let allCards = [];
let allSuppliers = [];
let costCategoriesLoaded = false;
let modalOptions = { showToast: defaultToast, onSuccess: null, getEditItem: null };
let eventsBound = false;
let editingItemCache = null;
let supplierManualOverride = false;
let lastCascadeMeta = { domain: "GERAL", grupo: "", tipo2: "" };
let toolPickerActive = false;
let obraDescPickerKind = null; // 'tools' | 'materials' | 'budget' | null
let obraDescOtherMode = false;
let toolOptionsCache = [];
let toolOptionsLoadToken = 0;
let obraDescOptionsCache = [];
let obraDescLoadToken = 0;

function defaultToast(msg, type = "info") {
  console.log(`[extra] ${type}: ${msg}`);
}

function ensureModalMounted() {
  if (document.getElementById("modalExtra")) {
    // Migração suave se o modal antigo ainda estiver no DOM sem o select de ferramentas
    const detailRow = document.getElementById("rowCostDetailDescription");
    if (detailRow && !document.getElementById("extraToolSelect")) {
      const input = document.getElementById("extraCostDetailDescription");
      const label = detailRow.querySelector("label");
      if (label) {
        label.id = "extraCostDetailLabel";
        label.setAttribute("for", "extraCostDetailDescription");
      }
      const select = document.createElement("select");
      select.id = "extraToolSelect";
      select.className =
        "hidden w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none";
      select.innerHTML = `<option value="">Seleccionar ferramenta...</option>`;
      input?.before(select);
      const hint = document.createElement("p");
      hint.id = "extraToolSelectHint";
      hint.className = "hidden text-[11px] text-slate-400 mt-1";
      input?.after(hint);
    }
    const descInput = document.getElementById("extraDesc");
    if (descInput && !document.getElementById("extraDescSelect")) {
      const wrap = descInput.parentElement;
      const label = wrap?.querySelector("label");
      if (label) {
        label.id = "extraDescLabel";
        label.setAttribute("for", "extraDesc");
      }
      const select = document.createElement("select");
      select.id = "extraDescSelect";
      select.className =
        "hidden w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none";
      select.innerHTML = `<option value="">Seleccionar...</option>`;
      descInput.before(select);
      const hint = document.createElement("p");
      hint.id = "extraDescSelectHint";
      hint.className = "hidden text-[11px] text-slate-400 mt-1";
      descInput.after(hint);
    }
    if (!document.getElementById("rowExtraQuantity")) {
      const amountLabel = document.querySelector('label[for="extraAmount"]');
      const amountGrid = amountLabel?.closest(".grid");
      const qtyRow = document.createElement("div");
      qtyRow.id = "rowExtraQuantity";
      qtyRow.className = "hidden";
      qtyRow.innerHTML = `<label for="extraQuantity" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Quantidade *</label>
        <input id="extraQuantity" type="number" step="0.01" min="0.01" placeholder="Ex.: 1"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
        <p class="text-[11px] text-slate-400 mt-1">Indique quantas unidades de ferramenta/material pretende pedir.</p>`;
      amountGrid?.before(qtyRow);
    }
    // Cartão: nunca required enquanto a linha estiver oculta (evita "not focusable")
    const cardSelect = document.getElementById("extraCardId");
    if (cardSelect) {
      const cardRowHidden = document.getElementById("extraCardRow")?.classList.contains("hidden");
      cardSelect.required = !cardRowHidden && isExtraCardSource(document.getElementById("extraSource")?.value);
    }
    return;
  }
  const root = document.createElement("div");
  root.id = "extraRequestModalRoot";
  root.innerHTML = EXTRA_MODAL_HTML;
  document.body.appendChild(root);
}

function toDateInputValue(value) {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function needsItemQuantity() {
  return toolPickerActive || obraDescPickerKind === "tools" || obraDescPickerKind === "materials";
}

function syncQuantityFieldVisibility() {
  const row = document.getElementById("rowExtraQuantity");
  const input = document.getElementById("extraQuantity");
  const show = needsItemQuantity();
  row?.classList.toggle("hidden", !show);
  if (input) {
    input.required = show;
    if (!show) input.value = "";
  }
}

function setToolPickerMode(active) {
  toolPickerActive = active;
  const input = document.getElementById("extraCostDetailDescription");
  const select = document.getElementById("extraToolSelect");
  const hint = document.getElementById("extraToolSelectHint");
  const label = document.getElementById("extraCostDetailLabel");
  const row = document.getElementById("rowCostDetailDescription");

  if (!active) {
    select?.classList.add("hidden");
    if (select) {
      select.required = false;
      select.innerHTML = `<option value="">Seleccionar ferramenta...</option>`;
    }
    input?.classList.remove("hidden");
    hint?.classList.add("hidden");
    if (label) {
      label.textContent = "Descrição custo *";
      label.setAttribute("for", "extraCostDetailDescription");
    }
    toolOptionsCache = [];
    syncQuantityFieldVisibility();
    return;
  }

  row?.classList.remove("hidden");
  input?.classList.add("hidden");
  if (input) input.required = false;
  select?.classList.remove("hidden");
  if (select) select.required = true;
  if (label) {
    label.setAttribute("for", "extraToolSelect");
  }
  syncQuantityFieldVisibility();
}

function syncDetailFromToolSelect() {
  const select = document.getElementById("extraToolSelect");
  const input = document.getElementById("extraCostDetailDescription");
  if (!select || !input || !toolPickerActive) return;
  const opt = select.options[select.selectedIndex];
  input.value = opt?.dataset?.name || opt?.textContent?.trim() || "";
  input.required = false;
}

function renderToolSelectOptions(items, preferredName = "") {
  const select = document.getElementById("extraToolSelect");
  if (!select) return;
  const type = document.getElementById("extraType")?.value || "GERAL";
  const placeholder =
    type === "OBRA"
      ? "Seleccionar ferramenta do orçamento..."
      : "Seleccionar ferramenta do catálogo...";

  select.innerHTML =
    `<option value="">${placeholder}</option>` +
    items
      .map((t) => {
        const qty =
          type === "OBRA" && t.plannedQty != null
            ? ` (prev. ${t.plannedQty})`
            : t.sku
              ? ` · ${t.sku}`
              : "";
        return `<option value="${escapeHtml(t.id)}" data-name="${escapeHtml(t.name)}">${escapeHtml(
          t.name
        )}${escapeHtml(qty)}</option>`;
      })
      .join("");

  if (preferredName) {
    const hit = items.find(
      (t) => String(t.name).trim().toLowerCase() === String(preferredName).trim().toLowerCase()
    );
    if (hit) {
      select.value = hit.id;
    } else {
      // Mantém valor legado no input se a ferramenta já não estiver na lista
      const input = document.getElementById("extraCostDetailDescription");
      if (input && !input.value) input.value = preferredName;
    }
  }
  syncDetailFromToolSelect();
}

async function loadToolOptionsForPicker({ preserveValue = true } = {}) {
  const type = document.getElementById("extraType")?.value || "GERAL";
  const projectId = document.getElementById("extraProjectId")?.value || "";
  const select = document.getElementById("extraToolSelect");
  const hint = document.getElementById("extraToolSelectHint");
  const label = document.getElementById("extraCostDetailLabel");
  const preferredName = preserveValue
    ? document.getElementById("extraCostDetailDescription")?.value || ""
    : "";

  if (type === "OBRA" && !projectId) {
    if (select) {
      select.innerHTML = `<option value="">Seleccione primeiro a obra...</option>`;
      select.required = true;
    }
    if (hint) {
      hint.textContent = "Escolha a obra para carregar as ferramentas planeadas no orçamento.";
      hint.classList.remove("hidden");
    }
    if (label) label.textContent = "Ferramenta (orçamento) *";
    toolOptionsCache = [];
    return;
  }

  const token = ++toolOptionsLoadToken;
  if (select) select.innerHTML = `<option value="">A carregar ferramentas...</option>`;
  if (hint) {
    hint.textContent =
      type === "OBRA"
        ? "Ferramentas presentes no orçamento / planificação da obra."
        : "Ferramentas do catálogo de logística.";
    hint.classList.remove("hidden");
  }
  if (label) {
    label.textContent =
      type === "OBRA" ? "Ferramenta (orçamento) *" : "Ferramenta (catálogo logística) *";
  }

  try {
    const params = new URLSearchParams({ scope: type });
    if (type === "OBRA") params.set("projectId", projectId);
    const data = await apiRequest(`/extra-requests/tool-options?${params.toString()}`);
    if (token !== toolOptionsLoadToken) return;
    toolOptionsCache = data.items || [];
    renderToolSelectOptions(toolOptionsCache, preferredName);
    if (hint) {
      if (!toolOptionsCache.length) {
        hint.textContent =
          type === "OBRA"
            ? "Não há ferramentas planeadas nesta obra. Defina-as na planificação de stock."
            : "Catálogo de ferramentas vazio na logística.";
      }
    }
  } catch (err) {
    if (token !== toolOptionsLoadToken) return;
    toolOptionsCache = [];
    if (select) select.innerHTML = `<option value="">Erro ao carregar ferramentas</option>`;
    if (hint) {
      hint.textContent = err.message || "Não foi possível carregar as ferramentas.";
      hint.classList.remove("hidden");
    }
  }
}

function setObraDescPickerMode(kind) {
  obraDescPickerKind = kind;
  obraDescOtherMode = false;
  const input = document.getElementById("extraDesc");
  const select = document.getElementById("extraDescSelect");
  const hint = document.getElementById("extraDescSelectHint");
  const label = document.getElementById("extraDescLabel");

  if (!kind) {
    select?.classList.add("hidden");
    if (select) {
      select.required = false;
      select.innerHTML = `<option value="">Seleccionar...</option>`;
    }
    input?.classList.remove("hidden");
    if (input) {
      input.required = true;
      input.placeholder = "Motivo do pedido extra";
    }
    hint?.classList.add("hidden");
    if (label) {
      label.textContent = "Descrição *";
      label.setAttribute("for", "extraDesc");
    }
    obraDescOptionsCache = [];
    syncQuantityFieldVisibility();
    return;
  }

  select?.classList.remove("hidden");
  if (select) select.required = true;
  input?.classList.add("hidden");
  if (input) input.required = false;
  if (label) {
    label.textContent =
      kind === "materials"
        ? "Material (orçamento) *"
        : kind === "tools"
          ? "Ferramenta (orçamento) *"
          : "Item do orçamento *";
    label.setAttribute("for", "extraDescSelect");
  }
  syncQuantityFieldVisibility();
}

function applyObraOtherMode(enabled, { clearValue = false } = {}) {
  obraDescOtherMode = enabled;
  const input = document.getElementById("extraDesc");
  if (!input) return;
  if (enabled) {
    input.classList.remove("hidden");
    input.required = true;
    input.placeholder = "Descreva o item que não está no orçamento";
    if (clearValue) input.value = "";
    input.focus();
  } else {
    input.classList.add("hidden");
    input.required = false;
    input.placeholder = "Motivo do pedido extra";
  }
}

function syncDescFromObraSelect() {
  const select = document.getElementById("extraDescSelect");
  const input = document.getElementById("extraDesc");
  if (!select || !input || !obraDescPickerKind) return;
  const val = select.value;
  if (val === "__OTHER__") {
    applyObraOtherMode(true, { clearValue: !input.value || !obraDescOtherMode });
    return;
  }
  applyObraOtherMode(false);
  const opt = select.options[select.selectedIndex];
  input.value = opt?.dataset?.name || "";
}

function renderObraDescOptions(items, preferredName = "") {
  const select = document.getElementById("extraDescSelect");
  if (!select) return;
  const placeholder =
    obraDescPickerKind === "materials"
      ? "Seleccionar material do orçamento..."
      : obraDescPickerKind === "tools"
        ? "Seleccionar ferramenta do orçamento..."
        : "Seleccionar item do orçamento...";

  select.innerHTML =
    `<option value="">${placeholder}</option>` +
    items
      .map((t) => {
        const qty = t.plannedQty != null ? ` (prev. ${t.plannedQty})` : "";
        return `<option value="${escapeHtml(t.id)}" data-name="${escapeHtml(t.name)}">${escapeHtml(
          t.name
        )}${escapeHtml(qty)}</option>`;
      })
      .join("") +
    `<option value="__OTHER__">Outro (não está no orçamento)…</option>`;

  if (preferredName) {
    const hit = items.find(
      (t) => String(t.name).trim().toLowerCase() === String(preferredName).trim().toLowerCase()
    );
    if (hit) {
      select.value = hit.id;
      applyObraOtherMode(false);
      syncDescFromObraSelect();
      return;
    }
    // Nome livre → modo Outro
    select.value = "__OTHER__";
    applyObraOtherMode(true);
    inputKeepPreferred(preferredName);
    return;
  }
  syncDescFromObraSelect();
}

function inputKeepPreferred(preferredName) {
  const input = document.getElementById("extraDesc");
  if (input) input.value = preferredName || "";
}

async function loadObraDescOptions({ preserveValue = true } = {}) {
  const projectId = document.getElementById("extraProjectId")?.value || "";
  const costCenterId = document.getElementById("extraCostCenterId")?.value || "";
  const select = document.getElementById("extraDescSelect");
  const hint = document.getElementById("extraDescSelectHint");
  const preferredName = preserveValue ? document.getElementById("extraDesc")?.value || "" : "";

  if (!projectId || !costCenterId) {
    setObraDescPickerMode(null);
    return;
  }

  const token = ++obraDescLoadToken;
  if (select) {
    select.classList.remove("hidden");
    select.innerHTML = `<option value="">A carregar itens do orçamento...</option>`;
  }
  if (hint) {
    hint.textContent = "A carregar itens orçamentados deste centro de custo…";
    hint.classList.remove("hidden");
  }

  try {
    const params = new URLSearchParams({
      scope: "OBRA",
      projectId,
      costCenterId,
      kind: "budget",
    });
    const data = await apiRequest(`/extra-requests/tool-options?${params.toString()}`);
    if (token !== obraDescLoadToken) return;
    const items = data.items || [];
    const kind = data.kind || classifyObraCostCenterKind(
      document.getElementById("extraCostCenterId")?.selectedOptions?.[0]?.dataset?.code || "",
      document.getElementById("extraCostCenterId")?.selectedOptions?.[0]?.dataset?.name || ""
    ) || "budget";

    if (!items.length) {
      // Sem itens orçamentados → descrição livre
      setObraDescPickerMode(null);
      if (hint) {
        hint.textContent = "Este centro de custo não tem itens orçamentados — use descrição livre.";
        hint.classList.remove("hidden");
        setTimeout(() => hint.classList.add("hidden"), 4000);
      }
      return;
    }

    setObraDescPickerMode(kind);
    obraDescOptionsCache = items;
    renderObraDescOptions(items, preferredName);
    if (hint) {
      hint.textContent =
        "Seleccione um item do orçamento ou «Outro» para um item que não exista na planificação.";
      hint.classList.remove("hidden");
    }
  } catch (err) {
    if (token !== obraDescLoadToken) return;
    obraDescOptionsCache = [];
    setObraDescPickerMode(null);
    if (hint) {
      hint.textContent = err.message || "Não foi possível carregar o orçamento deste centro.";
      hint.classList.remove("hidden");
    }
  }
}

async function syncObraDescPickerFromCostCenter({ preserveValue = true } = {}) {
  const type = document.getElementById("extraType")?.value || "GERAL";
  if (type !== "OBRA") {
    setObraDescPickerMode(null);
    return;
  }
  const costCenterId = document.getElementById("extraCostCenterId")?.value || "";
  const projectId = document.getElementById("extraProjectId")?.value || "";
  if (!costCenterId || !projectId) {
    setObraDescPickerMode(null);
    return;
  }
  await loadObraDescOptions({ preserveValue });
}

function applyCostDetailPicker(category, meta) {
  lastCascadeMeta = meta || lastCascadeMeta;
  const type = document.getElementById("extraType")?.value || "GERAL";
  // Em OBRA o menu de descrição vem do centro de custo, não da cascata
  if (type === "OBRA") {
    setToolPickerMode(false);
    return;
  }
  const useTools = Boolean(category) && isToolCostSelection(meta || {});
  if (useTools) {
    setToolPickerMode(true);
    loadToolOptionsForPicker({ preserveValue: true });
    return;
  }
  setToolPickerMode(false);
}

function refreshExtraCostCascade({ initialCategoryId = "", disabled = false } = {}) {
  const type = document.getElementById("extraType")?.value || "GERAL";
  const domain = extraTypeToCostDomain(type);
  const badge = document.getElementById("extraCostDomainBadge");
  if (badge) badge.textContent = DOMAIN_LABELS[domain] || domain;

  const row = document.getElementById("rowCostCategory");
  if (row && badge) {
    badge.className =
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold " +
      (domain === "OBRA" ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800");
  }

  const container = document.getElementById(COST_CASCADE_IDS.container);
  mountRubricFirstCascade({
    container,
    summaryEl: COST_CASCADE_IDS.summary,
    hiddenInputId: COST_CASCADE_IDS.hidden,
    detailRowId: COST_CASCADE_IDS.detailRow,
    detailInputId: COST_CASCADE_IDS.detailInput,
    domain,
    initialCategoryId,
    disabled,
    onChange: (category, meta) => applyCostDetailPicker(category, meta),
  });
}

function populateProjectSelects() {
  const opts = allProjects
    .map((p) => `<option value="${p.id}">${p.name}${p.code ? ` (${p.code})` : ""}</option>`)
    .join("");
  const projectSelect = document.getElementById("extraProjectId");
  if (projectSelect) {
    projectSelect.innerHTML = `<option value="">Selecionar obra...</option>${opts}`;
  }
}

async function loadReferenceData() {
  const [projectsData, , suppliersResult] = await Promise.all([
    apiRequest("/projects?pageSize=200"),
    loadAllCostCategories().then(() => {
      costCategoriesLoaded = true;
    }),
    apiRequest("/suppliers").catch((err) => {
      console.warn("Não foi possível carregar fornecedores:", err);
      return { items: [] };
    }),
  ]);
  allProjects = projectsData.items || projectsData.projects || [];
  allSuppliers = (suppliersResult.items || []).filter((s) => s.active !== false);
  populateProjectSelects();
  populateExtraSupplierSelect();
}

function primarySupplierIban(supplier) {
  if (!supplier) return "";
  const fromAccounts = (supplier.bankAccounts || []).find((a) => a.iban)?.iban;
  return String(fromAccounts || supplier.iban || "").trim();
}

function populateExtraSupplierSelect(selectedId = "") {
  const select = document.getElementById("extraSupplierId");
  if (!select) return;
  select.innerHTML =
    `<option value="">Seleccionar fornecedor registado...</option>` +
    allSuppliers
      .map((s) => {
        const nif = s.nif ? ` · NIF ${s.nif}` : "";
        return `<option value="${s.id}">${s.name}${nif}</option>`;
      })
      .join("");
  if (selectedId) select.value = selectedId;
}

function getExtraSupplierFormData() {
  return {
    supplierId: document.getElementById("extraSupplierId")?.value || null,
    supplierName: document.getElementById("extraSupplierName")?.value.trim() || null,
    supplierNif: document.getElementById("extraSupplierNif")?.value.trim() || null,
    supplierIban: document.getElementById("extraSupplierIban")?.value.trim() || null,
  };
}

function hasCompleteTransferSupplier(data = getExtraSupplierFormData()) {
  return Boolean(data.supplierName && data.supplierNif && data.supplierIban);
}

function applySupplierToForm(supplier) {
  if (!supplier) return;
  document.getElementById("extraSupplierName").value = supplier.name || "";
  document.getElementById("extraSupplierNif").value = supplier.nif || "";
  document.getElementById("extraSupplierIban").value = primarySupplierIban(supplier);
  supplierManualOverride = false;
}

function onExtraSupplierSelectChange() {
  const id = document.getElementById("extraSupplierId")?.value || "";
  if (!id) {
    if (!supplierManualOverride) {
      document.getElementById("extraSupplierName").value = "";
      document.getElementById("extraSupplierNif").value = "";
      document.getElementById("extraSupplierIban").value = "";
    }
    syncExtraProformaAvailability();
    return;
  }
  const supplier = allSuppliers.find((s) => s.id === id);
  applySupplierToForm(supplier);
  syncExtraProformaAvailability();
}

function onExtraSupplierManualInput() {
  supplierManualOverride = true;
  // Se o utilizador editar manualmente e deixar de coincidir com o seleccionado, limpa o select
  const selectedId = document.getElementById("extraSupplierId")?.value || "";
  if (selectedId) {
    const supplier = allSuppliers.find((s) => s.id === selectedId);
    const data = getExtraSupplierFormData();
    const matches =
      supplier &&
      (data.supplierName || "").toLowerCase() === (supplier.name || "").toLowerCase() &&
      (data.supplierNif || "") === (supplier.nif || "") &&
      (data.supplierIban || "") === primarySupplierIban(supplier);
    if (!matches) {
      // Mantém o ID se o nome ainda corresponder; só limpa se o nome divergir totalmente
      if ((data.supplierName || "").toLowerCase() !== (supplier?.name || "").toLowerCase()) {
        document.getElementById("extraSupplierId").value = "";
      }
    }
  }
  syncExtraProformaAvailability();
}

function syncExtraProformaAvailability() {
  const source = document.getElementById("extraSource")?.value;
  const isTransfer = source === "SOLICITACAO_TRANSFERENCIA";
  const isEdit = Boolean(document.getElementById("extraEditId")?.value);
  const editing = isEdit ? editingItemCache : null;
  const complete = hasCompleteTransferSupplier();
  const proformaInput = document.getElementById("extraProforma");
  const blockedHint = document.getElementById("extraProformaBlockedHint");

  if (!isTransfer) {
    if (proformaInput) {
      proformaInput.disabled = false;
      proformaInput.required = false;
    }
    blockedHint?.classList.add("hidden");
    return;
  }

  if (proformaInput) {
    proformaInput.disabled = !complete;
    proformaInput.required = complete && !isEdit && !editing?.proformaUrl;
    if (!complete) proformaInput.value = "";
  }
  blockedHint?.classList.toggle("hidden", complete);
}

function clearExtraSupplierFields() {
  const idEl = document.getElementById("extraSupplierId");
  const nameEl = document.getElementById("extraSupplierName");
  const nifEl = document.getElementById("extraSupplierNif");
  const ibanEl = document.getElementById("extraSupplierIban");
  if (idEl) idEl.value = "";
  if (nameEl) nameEl.value = "";
  if (nifEl) nifEl.value = "";
  if (ibanEl) ibanEl.value = "";
  supplierManualOverride = false;
}

async function loadCostCentersForExtra(projectId, selectedId = "") {
  const select = document.getElementById("extraCostCenterId");
  if (!select) return;
  if (!projectId) {
    select.innerHTML = `<option value="">Seleccione primeiro a obra...</option>`;
    select.value = "";
    await syncObraDescPickerFromCostCenter({ preserveValue: false });
    return;
  }
  select.innerHTML = `<option value="">A carregar...</option>`;
  try {
    const data = await apiRequest(`/cost-centers/project/${projectId}`);
    const items = (data.items || []).filter((cc) => cc.active !== false);
    select.innerHTML =
      `<option value="">Selecionar centro de custo...</option>` +
      items
        .map(
          (cc) =>
            `<option value="${cc.id}" data-code="${escapeHtml(cc.code || "")}" data-name="${escapeHtml(
              cc.name || ""
            )}">${escapeHtml(cc.code)} — ${escapeHtml(cc.name)}${
              cc.currency ? ` (${escapeHtml(cc.currency)})` : ""
            }</option>`
        )
        .join("");
    if (selectedId) select.value = selectedId;
    await syncObraDescPickerFromCostCenter({ preserveValue: Boolean(selectedId) });
  } catch (err) {
    select.innerHTML = `<option value="">Erro ao carregar centros</option>`;
    modalOptions.showToast("Erro ao carregar centros de custo: " + err.message, "error");
    await syncObraDescPickerFromCostCenter({ preserveValue: false });
  }
}

async function ensureCardsLoadedForExtra(type) {
  try {
    const projectId = document.getElementById("extraProjectId")?.value || "";
    const params = new URLSearchParams();
    if (type === "OBRA" && projectId) params.set("projectId", projectId);
    const data = await apiRequest(`/petty-cash/cards${params.toString() ? `?${params}` : ""}`);
    allCards = data.items || [];
  } catch (err) {
    console.error("Erro ao carregar cartões:", err);
    allCards = [];
  }
  populateExtraCardSelect();
}

function populateExtraCardSelect() {
  const cardSelect = document.getElementById("extraCardId");
  if (!cardSelect) return;
  const type = document.getElementById("extraType").value || "GERAL";
  const projectId = document.getElementById("extraProjectId")?.value || "";
  let cards = allCards.filter((c) => c.active !== false);
  if (type === "OBRA" && projectId) {
    cards = cards.filter((c) => !c.projectId || c.projectId === projectId);
  }
  cardSelect.innerHTML =
    `<option value="">Selecionar cartão...</option>` +
    cards
      .map(
        (c) =>
          `<option value="${c.id}" data-fund-id="${c.fundId}">${c.label} (${formatCurrency(c.currentBalance, c.currency)})</option>`
      )
      .join("");
  syncExtraFundFromCard();
}

function syncExtraFundFromCard() {
  const cardSelect = document.getElementById("extraCardId");
  const fundInput = document.getElementById("extraFundId");
  if (!cardSelect || !fundInput) return;
  const selected = cardSelect.options[cardSelect.selectedIndex];
  fundInput.value = selected?.dataset?.fundId || "";
}

function setExtraFormLocked(locked) {
  document.getElementById("btnTypeGeral").disabled = locked;
  document.getElementById("btnTypeObra").disabled = locked;
  document.getElementById("extraProjectId").disabled = locked;
  document.getElementById("extraCostCenterId").disabled = locked;
  document.getElementById("rowCostCategory")?.querySelectorAll("select").forEach((el) => {
    el.disabled = locked;
  });
  const toolSelect = document.getElementById("extraToolSelect");
  if (toolSelect) toolSelect.disabled = locked;
  const descSelect = document.getElementById("extraDescSelect");
  if (descSelect) descSelect.disabled = locked;
  const qtyInput = document.getElementById("extraQuantity");
  if (qtyInput) qtyInput.disabled = locked;
  document.getElementById("extraTypeRow")?.classList.toggle("opacity-60", locked);
}

function parseExtraPercentInput(id) {
  const raw = document.getElementById(id)?.value;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getExtraFiscalFormData() {
  const mode = document.getElementById("extraFiscalModeGross")?.checked ? "gross" : "base";
  if (mode !== "gross") {
    return {
      fiscalInputMode: "base",
      fiscalApplyVat: false,
      fiscalApplyWithholding: false,
      fiscalApplyDiscount: false,
      fiscalVatPercent: null,
      fiscalWithholdingPercent: null,
      fiscalDiscountPercent: null,
    };
  }
  const applyVat = Boolean(document.getElementById("extraFiscalApplyVat")?.checked);
  const applyWithholding = Boolean(document.getElementById("extraFiscalApplyWithholding")?.checked);
  const applyDiscount = Boolean(document.getElementById("extraFiscalApplyDiscount")?.checked);
  return {
    fiscalInputMode: "gross",
    fiscalApplyVat: applyVat,
    fiscalApplyWithholding: applyWithholding,
    fiscalApplyDiscount: applyDiscount,
    fiscalVatPercent: applyVat ? parseExtraPercentInput("extraFiscalVatPercent") : null,
    fiscalWithholdingPercent: applyWithholding
      ? parseExtraPercentInput("extraFiscalWithholdingPercent")
      : null,
    fiscalDiscountPercent: applyDiscount ? parseExtraPercentInput("extraFiscalDiscountPercent") : null,
  };
}

function syncExtraFiscalPercentVisibility() {
  const isGross = document.getElementById("extraFiscalModeGross")?.checked;
  const applyVat = Boolean(document.getElementById("extraFiscalApplyVat")?.checked);
  const applyWh = Boolean(document.getElementById("extraFiscalApplyWithholding")?.checked);
  const applyDisc = Boolean(document.getElementById("extraFiscalApplyDiscount")?.checked);
  document.getElementById("extraFiscalVatPctWrap")?.classList.toggle("hidden", !isGross || !applyVat);
  document.getElementById("extraFiscalWhPctWrap")?.classList.toggle("hidden", !isGross || !applyWh);
  document.getElementById("extraFiscalDiscPctWrap")?.classList.toggle("hidden", !isGross || !applyDisc);
}

function refreshExtraFiscalPreview() {
  const preview = document.getElementById("extraFiscalPreview");
  if (!preview) return;
  const fiscal = getExtraFiscalFormData();
  const amount = parseFloat(document.getElementById("extraAmount")?.value) || 0;
  if (fiscal.fiscalInputMode !== "gross") {
    preview.classList.add("hidden");
    preview.innerHTML = "";
    return;
  }
  const hasPct =
    (fiscal.fiscalApplyVat && Number(fiscal.fiscalVatPercent) > 0) ||
    (fiscal.fiscalApplyWithholding && Number(fiscal.fiscalWithholdingPercent) > 0) ||
    (fiscal.fiscalApplyDiscount && Number(fiscal.fiscalDiscountPercent) > 0);
  if (!amount || !hasPct) {
    preview.classList.remove("hidden");
    preview.innerHTML =
      '<p class="text-slate-400 font-semibold">Indique as percentagens para calcular o valor base.</p>';
    return;
  }
  const breakdown = computeFiscalBreakdown({
    fiscalPercents: {
      vatPercent: Number(fiscal.fiscalVatPercent) || 0,
      withholdingPercent: Number(fiscal.fiscalWithholdingPercent) || 0,
      discountPercent: Number(fiscal.fiscalDiscountPercent) || 0,
    },
    grossAmount: amount,
    inputMode: "gross",
    applyVat: fiscal.fiscalApplyVat,
    applyWithholding: fiscal.fiscalApplyWithholding,
    applyDiscount: fiscal.fiscalApplyDiscount,
  });
  preview.classList.remove("hidden");
  preview.innerHTML = `
    <div class="flex justify-between gap-2"><span class="font-semibold text-slate-500">Valor bruto</span><span class="font-bold tabular-nums">${formatFiscalAmount(amount)}</span></div>
    <div class="flex justify-between gap-2"><span class="font-semibold text-slate-500">Valor base</span><span class="font-black tabular-nums text-emerald-700">${formatFiscalAmount(breakdown.base)}</span></div>
    ${breakdown.lines
      .map(
        (line) =>
          `<div class="flex justify-between gap-2"><span class="text-slate-500">${line.label}</span><span class="font-semibold tabular-nums">${formatFiscalAmount(line.amount)}</span></div>`
      )
      .join("")}
    <div class="flex justify-between gap-2 pt-1 border-t border-slate-100"><span class="font-black uppercase tracking-wide text-[10px] text-slate-700">Líquido estimado</span><span class="font-black tabular-nums">${formatFiscalAmount(breakdown.net)}</span></div>
  `;
}

function toggleExtraFiscalFlags() {
  const isGross = document.getElementById("extraFiscalModeGross")?.checked;
  const flags = document.getElementById("extraFiscalFlags");
  const hint = document.getElementById("extraFiscalHint");
  flags?.classList.toggle("hidden", !isGross);
  if (hint) {
    hint.textContent = isGross
      ? "Indique as % incluídas no valor para obter a base na liquidação."
      : "Na liquidação o cálculo fiscal usa esta indicação (base ou bruto).";
  }
  if (isGross) {
    const vat = document.getElementById("extraFiscalApplyVat");
    const wh = document.getElementById("extraFiscalApplyWithholding");
    const disc = document.getElementById("extraFiscalApplyDiscount");
    if (vat && !vat.checked && !wh?.checked && !disc?.checked) vat.checked = true;
  }
  syncExtraFiscalPercentVisibility();
  refreshExtraFiscalPreview();
}

function applyExtraFiscalToForm(item = {}) {
  const isGross = item.fiscalInputMode === "gross";
  const baseRadio = document.getElementById("extraFiscalModeBase");
  const grossRadio = document.getElementById("extraFiscalModeGross");
  if (baseRadio) baseRadio.checked = !isGross;
  if (grossRadio) grossRadio.checked = isGross;
  const vat = document.getElementById("extraFiscalApplyVat");
  const wh = document.getElementById("extraFiscalApplyWithholding");
  const disc = document.getElementById("extraFiscalApplyDiscount");
  if (vat) vat.checked = isGross ? Boolean(item.fiscalApplyVat ?? true) : false;
  if (wh) wh.checked = isGross ? Boolean(item.fiscalApplyWithholding) : false;
  if (disc) disc.checked = isGross ? Boolean(item.fiscalApplyDiscount) : false;
  const vatPct = document.getElementById("extraFiscalVatPercent");
  const whPct = document.getElementById("extraFiscalWithholdingPercent");
  const discPct = document.getElementById("extraFiscalDiscountPercent");
  if (vatPct) {
    vatPct.value =
      item.fiscalVatPercent != null && item.fiscalVatPercent !== ""
        ? String(item.fiscalVatPercent)
        : "";
  }
  if (whPct) {
    whPct.value =
      item.fiscalWithholdingPercent != null && item.fiscalWithholdingPercent !== ""
        ? String(item.fiscalWithholdingPercent)
        : "";
  }
  if (discPct) {
    discPct.value =
      item.fiscalDiscountPercent != null && item.fiscalDiscountPercent !== ""
        ? String(item.fiscalDiscountPercent)
        : "";
  }
  toggleExtraFiscalFlags();
}

function resetExtraFormState() {
  document.getElementById("extraEditId").value = "";
  document.getElementById("modalExtraTitle").textContent = "Novo Pedido Extra";
  document.getElementById("extraSubmitBtn").textContent = "Guardar Pedido";
  document.getElementById("extraProformaHint")?.classList.add("hidden");
  document.getElementById("extraProformaBlockedHint")?.classList.add("hidden");
  clearExtraSupplierFields();
  setExtraFormLocked(false);
  document.getElementById("extraProjectId").disabled = false;
  editingItemCache = null;
  lastCascadeMeta = { domain: "GERAL", grupo: "", tipo2: "" };
  setToolPickerMode(false);
  setObraDescPickerMode(null);
  obraDescOtherMode = false;
  syncQuantityFieldVisibility();
  applyExtraFiscalToForm({ fiscalInputMode: "base" });
}

function setExtraType(type) {
  const isGeral = type === "GERAL";
  document.getElementById("extraType").value = type;
  document.getElementById("btnTypeGeral").classList.toggle("active", isGeral);
  document.getElementById("btnTypeObra").classList.toggle("active", !isGeral);
  document.getElementById("rowGeneralCc")?.classList.add("hidden");
  document.getElementById("rowCostCategory")?.classList.remove("hidden");
  document.getElementById("rowProject").classList.toggle("hidden", isGeral);
  document.getElementById("rowObraCostCenter").classList.toggle("hidden", isGeral);
  document.getElementById("extraProjectId").required = !isGeral;
  document.getElementById("extraCostCenterId").required = !isGeral;
  if (isGeral) {
    document.getElementById("extraCostCenterId").value = "";
    setObraDescPickerMode(null);
  }
  refreshExtraCostCascade();
  const isEdit = Boolean(document.getElementById("extraEditId").value);
  if (!isEdit) {
    document.getElementById("modalExtraTitle").textContent = isGeral
      ? "Novo Pedido Extra Geral"
      : "Novo Pedido Extra da Obra";
  }
  ensureCardsLoadedForExtra(type);
  if (!isGeral) {
    syncObraDescPickerFromCostCenter({ preserveValue: false });
  }
}

function toggleExtraPaymentFields() {
  const source = document.getElementById("extraSource").value;
  const isEdit = Boolean(document.getElementById("extraEditId").value);
  const editing = isEdit ? editingItemCache : null;
  const isTransfer = source === "SOLICITACAO_TRANSFERENCIA";
  const isCard = isExtraCardSource(source);
  document.getElementById("extraCardRow").classList.toggle("hidden", !isCard);
  const cardSelect = document.getElementById("extraCardId");
  if (cardSelect) cardSelect.required = isCard;
  document.getElementById("extraSupplierRow")?.classList.toggle("hidden", !isTransfer);
  document.getElementById("extraProformaRow").classList.toggle("hidden", !isTransfer);
  if (!isTransfer) {
    clearExtraSupplierFields();
    const proformaInput = document.getElementById("extraProforma");
    if (proformaInput) {
      proformaInput.required = false;
      proformaInput.disabled = false;
      proformaInput.value = "";
    }
    document.getElementById("extraProformaHint")?.classList.add("hidden");
    document.getElementById("extraProformaBlockedHint")?.classList.add("hidden");
    return;
  }
  syncExtraProformaAvailability();
  const proformaHint = document.getElementById("extraProformaHint");
  if (proformaHint) {
    proformaHint.classList.toggle("hidden", !(isTransfer && editing?.proformaUrl));
  }
}

function closeExtraModal() {
  document.getElementById("modalExtra")?.classList.remove("open");
  resetExtraFormState();
}

export async function openExtraRequestModal({
  type = "GERAL",
  projectId = "",
  costCenterId = "",
  costCategoryId = "",
  generalCostCenterId = "",
  lockType = false,
  lockProject = false,
} = {}) {
  ensureModalMounted();
  document.getElementById("formExtra").reset();
  resetExtraFormState();
  if (!costCategoriesLoaded) await loadAllCostCategories();
  setExtraType(type);

  if (type === "OBRA" && projectId) {
    document.getElementById("extraProjectId").value = projectId;
    await loadCostCentersForExtra(projectId, costCenterId || "");
  }
  const presetCategory = costCategoryId || generalCostCenterId;
  if (presetCategory) {
    refreshExtraCostCascade({ initialCategoryId: presetCategory });
  }

  if (lockType) {
    document.getElementById("btnTypeGeral").disabled = true;
    document.getElementById("btnTypeObra").disabled = true;
  }
  if (lockProject && type === "OBRA") {
    document.getElementById("extraProjectId").disabled = true;
  }

  const dueInput = document.getElementById("extraPaymentDueDate");
  if (dueInput) dueInput.value = new Date().toISOString().slice(0, 10);
  toggleExtraPaymentFields();
  document.getElementById("modalExtra").classList.add("open");
}

function collectCCItems() {
  const rows = document.querySelectorAll(".cc-item-row");
  if (!rows || rows.length === 0) return [];
  const items = [];
  rows.forEach((row) => {
    const desc = row.querySelector(".cc-item-desc")?.value?.trim() || "";
    const qtyRaw = row.querySelector(".cc-item-qty")?.value;
    const unit = row.querySelector(".cc-item-unit")?.value?.trim() || "";
    const priceRaw = row.querySelector(".cc-item-price")?.value;
    if (!desc) return;
    const qty = parseFloat(qtyRaw || "0");
    const price =
      priceRaw !== undefined && priceRaw !== null && String(priceRaw).trim() !== ""
        ? parseFloat(String(priceRaw))
        : null;
    if (!Number.isFinite(qty) || qty <= 0) return;
    items.push({
      description: desc,
      quantity: Number.isFinite(qty) ? qty : 1,
      unit: unit || null,
      unitPrice: Number.isFinite(price) ? price : null,
    });
  });
  return items;
}

function repopulateCCItems(items) {
  const tbody = document.getElementById("ccItemsBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!items || items.length === 0) return;
  items.forEach((it) => {
    if (typeof window.addCCItemRow === "function") {
      window.addCCItemRow();
    } else {
      const tr = document.createElement("tr");
      tr.className = "cc-item-row";
      tr.innerHTML =
        '<td class="py-2"><input type="text" class="cc-item-desc w-full px-2 py-1 bg-white border border-slate-200 rounded text-sm font-semibold" placeholder="Descrição..."></td>' +
        '<td class="py-2"><input type="number" step="0.01" min="0" class="cc-item-qty w-full px-2 py-1 bg-white border border-slate-200 rounded text-sm font-semibold" value="1"></td>' +
        '<td class="py-2"><input type="text" class="cc-item-unit w-full px-2 py-1 bg-white border border-slate-200 rounded text-sm font-semibold" placeholder="un."></td>' +
        '<td class="py-2"><input type="number" step="0.01" min="0" class="cc-item-price w-full px-2 py-1 bg-white border border-slate-200 rounded text-sm font-semibold" placeholder="0.00"></td>' +
        '<td class="py-2"><button type="button" class="cc-item-del w-8 h-8 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 inline-flex items-center justify-center"><span class="material-symbols-outlined text-sm">delete</span></button></td>';
      tbody.appendChild(tr);
      tr.querySelector(".cc-item-del")?.addEventListener("click", () => tr.remove());
    }
    const rows = tbody.querySelectorAll(".cc-item-row");
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      const descEl = lastRow.querySelector(".cc-item-desc");
      const qtyEl = lastRow.querySelector(".cc-item-qty");
      const unitEl = lastRow.querySelector(".cc-item-unit");
      const priceEl = lastRow.querySelector(".cc-item-price");
      if (descEl) descEl.value = it.description || "";
      if (qtyEl) qtyEl.value = it.quantity != null ? String(it.quantity) : "1";
      if (unitEl) unitEl.value = it.unit || "";
      if (priceEl) priceEl.value = it.unitPrice != null ? String(it.unitPrice) : "";
    }
  });
}

export async function openExtraRequestModalForEdit(id) {
  ensureModalMounted();
  let item = modalOptions.getEditItem?.(id);
  if (!item) {
    try {
      item = await apiRequest(`/extra-requests/${id}`);
    } catch (err) {
      modalOptions.showToast("Pedido extra não encontrado", "error");
      return;
    }
  }
  if (item.status !== "PENDENTE" && item.status !== "APROVADO") {
    modalOptions.showToast("Só é possível editar pedidos não liquidados", "error");
    return;
  }

  editingItemCache = item;
  document.getElementById("formExtra").reset();
  document.getElementById("extraEditId").value = item.id;
  document.getElementById("modalExtraTitle").textContent = "Editar Pedido Extra";
  document.getElementById("extraSubmitBtn").textContent = "Guardar alterações";

  if (!costCategoriesLoaded) await loadAllCostCategories();
  setExtraType(item.type);
  setExtraFormLocked(true);

  refreshExtraCostCascade({
    initialCategoryId: item.costCategoryId || item.generalCostCenterId || "",
    disabled: true,
  });
  if (item.costDetailDescription) {
    document.getElementById("extraCostDetailDescription").value = item.costDetailDescription;
  }
  if (toolPickerActive) {
    await loadToolOptionsForPicker({ preserveValue: true });
  }
  if (item.type === "OBRA") {
    document.getElementById("extraProjectId").value = item.projectId || "";
    document.getElementById("extraDesc").value = item.description || "";
    await loadCostCentersForExtra(item.projectId, item.costCenterId || "");
    if (obraDescPickerKind) {
      await loadObraDescOptions({ preserveValue: true });
    }
  }
  if (isExtraCardSource(item.paymentSource)) {
    await ensureCardsLoadedForExtra(item.type);
  }

  if (item.type !== "OBRA" || !obraDescPickerKind) {
    document.getElementById("extraDesc").value = item.description || "";
  }
  document.getElementById("extraQuantity").value =
    item.quantity != null && item.quantity !== "" ? String(item.quantity) : "";
  syncQuantityFieldVisibility();
  document.getElementById("extraAmount").value = item.amount || "";
  applyExtraFiscalToForm(item);
  document.getElementById("extraPaymentDueDate").value = toDateInputValue(item.paymentDueDate);
  document.getElementById("extraSource").value = item.paymentSource || "SOLICITACAO_TRANSFERENCIA";

  populateExtraSupplierSelect(item.supplierId || "");
  document.getElementById("extraSupplierName").value = item.supplierName || item.supplierRef?.name || "";
  document.getElementById("extraSupplierNif").value = item.supplierNif || item.supplierRef?.nif || "";
  document.getElementById("extraSupplierIban").value =
    item.supplierIban || primarySupplierIban(item.supplierRef) || "";
  supplierManualOverride = !item.supplierId;

  toggleExtraPaymentFields();

  if (item.cardId) document.getElementById("extraCardId").value = item.cardId;
  syncExtraFundFromCard();
  if (!document.getElementById("extraFundId").value && item.fundId) {
    document.getElementById("extraFundId").value = item.fundId;
  }

  const proformaInput = document.getElementById("extraProforma");
  if (proformaInput) proformaInput.required = false;
  syncExtraProformaAvailability();

  if (document.getElementById("extraPriority")) {
    document.getElementById("extraPriority").value = item.priority || "NORMAL";
  }
  if (document.getElementById("ccPedidoPriority")) {
    document.getElementById("ccPedidoPriority").value = item.priority || "NORMAL";
  }
  if (document.getElementById("extraRequestedBy")) {
    document.getElementById("extraRequestedBy").value = item.requestedBy || "";
  }
  if (document.getElementById("ccPedidoSolicitante")) {
    document.getElementById("ccPedidoSolicitante").value = item.requestedBy || "";
  }
  if (document.getElementById("extraDesiredDate")) {
    document.getElementById("extraDesiredDate").value = toDateInputValue(item.desiredDate || item.paymentDueDate);
  }
  if (document.getElementById("ccPedidoData")) {
    document.getElementById("ccPedidoData").value = toDateInputValue(item.desiredDate || item.paymentDueDate);
  }
  if (document.getElementById("extraRequiresQuote")) {
    document.getElementById("extraRequiresQuote").checked = Boolean(item.requiresQuote ?? true);
  }
  if (document.getElementById("ccPedidoRequerCotacao")) {
    document.getElementById("ccPedidoRequerCotacao").checked = Boolean(item.requiresQuote ?? true);
  }
  repopulateCCItems(item.items || []);

  document.getElementById("modalExtra").classList.add("open");
}

async function submitExtra(e) {
  e.preventDefault();
  const editId = document.getElementById("extraEditId").value;
  const type = document.getElementById("extraType").value || "GERAL";
  const source = document.getElementById("extraSource").value;
  const supplierData = getExtraSupplierFormData();
  const items = collectCCItems();
  const body = {
    type,
    projectId: type === "OBRA" ? document.getElementById("extraProjectId").value || null : null,
    costCenterId: type === "OBRA" ? document.getElementById("extraCostCenterId").value || null : null,
    generalCostCenterId:
      type === "GERAL"
        ? document.getElementById("extraGeneralCostCenterId")?.value || null
        : null,
    costCategoryId: document.getElementById("extraCostCategoryId").value || null,
    costDetailDescription:
      document.getElementById("extraCostDetailDescription")?.value.trim() || null,
    description: document.getElementById("extraDesc").value.trim(),
    quantity: (() => {
      const raw = document.getElementById("extraQuantity")?.value;
      if (!needsItemQuantity()) return null;
      if (raw === undefined || raw === null || String(raw).trim() === "") return null;
      return parseFloat(raw);
    })(),
    amount: parseFloat(document.getElementById("extraAmount").value) || 0,
    ...getExtraFiscalFormData(),
    paymentDueDate: document.getElementById("extraPaymentDueDate").value,
    paymentSource: source,
    fundId: isExtraCardSource(source) ? document.getElementById("extraFundId").value || null : null,
    cardId: isExtraCardSource(source) ? document.getElementById("extraCardId").value || null : null,
    supplierId: source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierId : null,
    supplierName: source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierName : null,
    supplierNif: source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierNif : null,
    supplierIban: source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierIban : null,
    priority:
      document.getElementById("extraPriority")?.value ||
      document.getElementById("ccPedidoPriority")?.value ||
      undefined,
    requestedBy:
      document.getElementById("extraRequestedBy")?.value?.trim() ||
      document.getElementById("ccPedidoSolicitante")?.value?.trim() ||
      undefined,
    desiredDate:
      document.getElementById("extraDesiredDate")?.value ||
      document.getElementById("ccPedidoData")?.value ||
      document.getElementById("extraPaymentDueDate")?.value ||
      undefined,
    requiresQuote:
      document.getElementById("extraRequiresQuote") !== null
        ? Boolean(document.getElementById("extraRequiresQuote")?.checked)
        : document.getElementById("ccPedidoRequerCotacao") !== null
        ? Boolean(document.getElementById("ccPedidoRequerCotacao")?.checked)
        : true,
    items: items && items.length ? items : undefined,
  };

  if (!editId) {
    if (type === "GERAL" && !body.costCategoryId) {
      modalOptions.showToast("Seleccione o tipo de custo até ao subcusto (tipo 3), se existir", "error");
      return;
    }
    const detailEl = document.getElementById("extraCostDetailDescription");
    if (toolPickerActive) {
      syncDetailFromToolSelect();
      body.costDetailDescription = detailEl?.value.trim() || null;
      if (!document.getElementById("extraToolSelect")?.value || !body.costDetailDescription) {
        modalOptions.showToast("Seleccione a ferramenta na lista", "error");
        return;
      }
    } else if (detailEl?.required && !body.costDetailDescription) {
      modalOptions.showToast("Indique o detalhe do custo", "error");
      return;
    }
    if (type === "OBRA" && !body.projectId) {
      modalOptions.showToast("Seleccione a obra", "error");
      return;
    }
    if (type === "OBRA" && !body.costCenterId) {
      modalOptions.showToast("Seleccione o centro de custo da obra", "error");
      return;
    }
    if (obraDescPickerKind) {
      const descSelect = document.getElementById("extraDescSelect");
      syncDescFromObraSelect();
      body.description = document.getElementById("extraDesc")?.value.trim() || "";
      if (!descSelect?.value) {
        modalOptions.showToast("Seleccione um item do orçamento ou «Outro»", "error");
        return;
      }
      if (descSelect.value === "__OTHER__" && !body.description) {
        modalOptions.showToast("Descreva o item que não está no orçamento", "error");
        return;
      }
      if (descSelect.value !== "__OTHER__" && !body.description) {
        modalOptions.showToast("Seleccione um item do orçamento", "error");
        return;
      }
    } else if (!body.description) {
      modalOptions.showToast("Indique a descrição", "error");
      return;
    }
    if (needsItemQuantity()) {
      const qty = Number(body.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        modalOptions.showToast("Indique a quantidade (maior que zero)", "error");
        return;
      }
    }
  }

  if (!body.paymentDueDate) {
    modalOptions.showToast("Indique a data prevista de liquidação", "error");
    return;
  }

  if (body.fiscalInputMode === "gross") {
    if (!body.fiscalApplyVat && !body.fiscalApplyWithholding && !body.fiscalApplyDiscount) {
      modalOptions.showToast("Indique quais impostos já estão incluídos no valor", "error");
      return;
    }
    if (body.fiscalApplyVat && !(Number(body.fiscalVatPercent) > 0)) {
      modalOptions.showToast("Indique a percentagem de IVA incluída", "error");
      return;
    }
    if (body.fiscalApplyWithholding && !(Number(body.fiscalWithholdingPercent) > 0)) {
      modalOptions.showToast("Indique a percentagem de retenção incluída", "error");
      return;
    }
    if (body.fiscalApplyDiscount && !(Number(body.fiscalDiscountPercent) > 0)) {
      modalOptions.showToast("Indique a percentagem de desconto incluída", "error");
      return;
    }
  }

  if (isExtraCardSource(source) && !body.cardId) {
    modalOptions.showToast("Seleccione o cartão", "error");
    return;
  }

  const editing = editingItemCache;
  const proformaFile = document.getElementById("extraProforma")?.files?.[0];
  const needsProforma = source === "SOLICITACAO_TRANSFERENCIA";
  const hasExistingProforma = Boolean(editing?.proformaUrl);

  if (needsProforma && !hasCompleteTransferSupplier(supplierData)) {
    modalOptions.showToast(
      "Seleccione o fornecedor ou preencha Nome, NIF e IBAN antes de anexar a proforma",
      "error"
    );
    return;
  }

  if (needsProforma && !editId && !proformaFile) {
    modalOptions.showToast("Anexe a proforma para transferência bancária", "error");
    return;
  }
  if (needsProforma && editId && !hasExistingProforma && !proformaFile) {
    modalOptions.showToast("Anexe a proforma para transferência bancária", "error");
    return;
  }

  try {
    if (editId) {
      const patchBody = {
        description: body.description,
        amount: body.amount,
        fiscalInputMode: body.fiscalInputMode,
        fiscalApplyVat: body.fiscalApplyVat,
        fiscalApplyWithholding: body.fiscalApplyWithholding,
        fiscalApplyDiscount: body.fiscalApplyDiscount,
        fiscalVatPercent: body.fiscalVatPercent,
        fiscalWithholdingPercent: body.fiscalWithholdingPercent,
        fiscalDiscountPercent: body.fiscalDiscountPercent,
        paymentDueDate: body.paymentDueDate,
        paymentSource: body.paymentSource,
        fundId: body.fundId,
        cardId: body.cardId,
        supplierId: body.supplierId,
        supplierName: body.supplierName,
        supplierNif: body.supplierNif,
        supplierIban: body.supplierIban,
        projectId: body.projectId,
        costCenterId: body.costCenterId,
        generalCostCenterId: body.generalCostCenterId,
        costCategoryId: body.costCategoryId,
        costDetailDescription: body.costDetailDescription,
        priority: body.priority,
        requestedBy: body.requestedBy,
        desiredDate: body.desiredDate,
        requiresQuote: body.requiresQuote,
        items: body.items,
      };
      if (needsItemQuantity()) {
        const qty = Number(body.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          modalOptions.showToast("Indique a quantidade (maior que zero)", "error");
          return;
        }
        patchBody.quantity = qty;
      } else {
        patchBody.quantity = null;
      }
      await apiRequest(`/extra-requests/${editId}`, { method: "PATCH", body: patchBody });
      if (needsProforma && proformaFile) {
        const fd = new FormData();
        fd.append("proforma", proformaFile);
        await apiUpload(`/extra-requests/${editId}/proforma`, fd);
      }
      modalOptions.showToast("Pedido Extra actualizado", "success");
    } else {
      const created = await apiRequest("/extra-requests", { method: "POST", body });
      if (needsProforma && proformaFile) {
        const fd = new FormData();
        fd.append("proforma", proformaFile);
        await apiUpload(`/extra-requests/${created.id}/proforma`, fd);
      }
      modalOptions.showToast("Pedido Extra criado", "success");
    }
    closeExtraModal();
    await modalOptions.onSuccess?.();
  } catch (err) {
    modalOptions.showToast(err?.data?.message || err.message || "Erro ao guardar pedido", "error");
  }
}

function bindModalEvents() {
  if (eventsBound) return;
  eventsBound = true;

  document.getElementById("btnTypeGeral")?.addEventListener("click", () => setExtraType("GERAL"));
  document.getElementById("btnTypeObra")?.addEventListener("click", () => setExtraType("OBRA"));
  document.getElementById("extraSource")?.addEventListener("change", async () => {
    toggleExtraPaymentFields();
    const source = document.getElementById("extraSource").value;
    if (isExtraCardSource(source)) {
      const t = document.getElementById("extraType").value || "GERAL";
      await ensureCardsLoadedForExtra(t);
    }
  });
  document.getElementById("extraCardId")?.addEventListener("change", syncExtraFundFromCard);
  document.getElementById("extraSupplierId")?.addEventListener("change", onExtraSupplierSelectChange);
  ["extraSupplierName", "extraSupplierNif", "extraSupplierIban"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", onExtraSupplierManualInput);
  });
  document.getElementById("extraProforma")?.addEventListener("click", (e) => {
    if (document.getElementById("extraSource")?.value !== "SOLICITACAO_TRANSFERENCIA") return;
    if (hasCompleteTransferSupplier()) return;
    e.preventDefault();
    modalOptions.showToast(
      "Seleccione o fornecedor ou preencha Nome, NIF e IBAN antes de anexar o documento",
      "error"
    );
  });
  document.getElementById("formExtra")?.addEventListener("change", (e) => {
    if (e.target?.id === "extraToolSelect") syncDetailFromToolSelect();
    if (e.target?.id === "extraDescSelect") syncDescFromObraSelect();
    if (e.target?.id === "extraCostCenterId") {
      syncObraDescPickerFromCostCenter({ preserveValue: false });
    }
  });
  document.getElementById("extraProjectId")?.addEventListener("change", async () => {
    if (document.getElementById("extraType").value === "OBRA") {
      const projectId = document.getElementById("extraProjectId").value;
      await loadCostCentersForExtra(projectId);
      await ensureCardsLoadedForExtra("OBRA");
    }
  });
  document.getElementById("formExtra")?.addEventListener("submit", submitExtra);
  document.getElementById("extraFiscalModeBase")?.addEventListener("change", toggleExtraFiscalFlags);
  document.getElementById("extraFiscalModeGross")?.addEventListener("change", toggleExtraFiscalFlags);
  ["extraFiscalApplyVat", "extraFiscalApplyWithholding", "extraFiscalApplyDiscount"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncExtraFiscalPercentVisibility();
      refreshExtraFiscalPreview();
    });
  });
  ["extraFiscalVatPercent", "extraFiscalWithholdingPercent", "extraFiscalDiscountPercent", "extraAmount"].forEach(
    (id) => {
      document.getElementById(id)?.addEventListener("input", refreshExtraFiscalPreview);
    }
  );
  document.getElementById("btnCloseExtraModal")?.addEventListener("click", closeExtraModal);
  document.getElementById("btnCancelExtra")?.addEventListener("click", closeExtraModal);
  document.getElementById("modalExtra")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeExtraModal();
  });
}

export async function initExtraRequestModal(options = {}) {
  modalOptions = {
    showToast: options.showToast || defaultToast,
    onSuccess: options.onSuccess || null,
    getEditItem: options.getEditItem || null,
  };
  ensureModalMounted();
  bindModalEvents();
  try {
    await loadReferenceData();
  } catch (err) {
    modalOptions.showToast("Erro ao carregar dados do formulário: " + err.message, "error");
  }
}

export function wireExtraRequestButton(buttonId, getOpenOptions = () => ({})) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  if (!can("pedidosExtras", "create")) {
    btn.classList.add("hidden");
    return;
  }
  btn.addEventListener("click", async () => {
    if (!can("pedidosExtras", "create")) {
      modalOptions.showToast("Sem permissão para criar pedidos extra", "error");
      return;
    }
    const opts = typeof getOpenOptions === "function" ? getOpenOptions() : {};
    if (opts === false) return;
    if (opts?.errorMessage) {
      modalOptions.showToast(opts.errorMessage, "error");
      return;
    }
    await openExtraRequestModal(opts);
  });
}
