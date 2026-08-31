import { apiRequest, apiUpload } from "../services/api.js";
import { getSessionUser } from "../services/auth.js";
import { can } from "./permissions.js";
import { formatCurrency } from "./format.js";
import { computeFiscalBreakdown, formatFiscalAmount, pedidoTotalsPanelMarkup, refreshPedidoTotalsFromRows } from "./supplierFiscal.js";
import {
  bindNifLookup,
} from "./supplierNifLookup.js";
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

const EXTRA_BTN_CLASS =
  "h-9 px-4 rounded-xl bg-[#2afc8d] text-[#0F172A] text-xs font-black flex items-center gap-2 hover:opacity-90 transition-all shadow-md shadow-[#2afc8d]/20 shrink-0";

const EXTRA_MODAL_HTML = `
<div class="modal-overlay" id="modalExtra">
  <div class="modal-box modal-box--wide" style="max-width:760px">
    <div class="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
      <h2 id="modalExtraTitle" class="text-lg font-bold text-slate-900">Novo Pedido de Compra</h2>
      <button type="button" id="btnCloseExtraModal" aria-label="Fechar"
        class="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-all">
        <span class="material-symbols-outlined text-base">close</span>
      </button>
    </div>
    <form id="formExtra" class="flex flex-col gap-4">
      <input type="hidden" id="extraEditId" value="">
      <input type="hidden" id="extraAmount" value="">
      <input type="hidden" id="extraPaymentDueDate" value="">
      <input type="hidden" id="extraFiscalModeBase" name="extraFiscalMode" value="base">
      <div class="hidden">
        <button type="button" id="btnTypeGeral" tabindex="-1"></button>
        <button type="button" id="btnTypeObra" tabindex="-1"></button>
        <input type="radio" name="extraFiscalMode" id="extraFiscalModeGross" value="gross">
        <input type="checkbox" id="extraFiscalApplyVat">
        <input type="checkbox" id="extraFiscalApplyWithholding">
        <input type="checkbox" id="extraFiscalApplyDiscount">
        <input id="extraFiscalVatPercent" type="number">
        <input id="extraFiscalWithholdingPercent" type="number">
        <input id="extraFiscalDiscountPercent" type="number">
        <div id="extraFiscalFlags"></div>
        <div id="extraFiscalVatPctWrap"></div>
        <div id="extraFiscalWhPctWrap"></div>
        <div id="extraFiscalDiscPctWrap"></div>
        <div id="extraFiscalPreview"></div>
        <p id="extraFiscalHint"></p>
      </div>
      <div id="extraTypeRow" class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label for="extraType" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Tipo *</label>
          <select id="extraType"
            class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            <option value="GERAL">Geral</option>
            <option value="OBRA">Obra</option>
          </select>
        </div>
        <div>
          <label for="extraPriority" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Prioridade *</label>
          <select id="extraPriority"
            class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            <option value="NORMAL">Normal</option>
            <option value="ALTA">Alta</option>
            <option value="URGENTE">Urgente</option>
          </select>
        </div>
        <div>
          <label for="extraRequestedBy" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Solicitante *</label>
          <input id="extraRequestedBy" type="text" required
            class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
        </div>
        <div>
          <label for="extraDesiredDate" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Data Desejada</label>
          <input id="extraDesiredDate" type="date"
            class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label id="extraDescLabel" for="extraDesc" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Resumo / Descrição do Pedido *</label>
          <select id="extraDescSelect"
            class="hidden w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
            <option value="">Seleccionar...</option>
          </select>
          <input id="extraDesc" type="text" required placeholder="Ex: Aquisição de material de escritório"
            class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
          <p id="extraDescSelectHint" class="hidden text-[11px] text-slate-400 mt-1"></p>
        </div>
        <div>
          <label for="extraNotes" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Justificação</label>
          <input id="extraNotes" type="text" placeholder="Motivo da compra"
            class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
        </div>
      </div>
      <div id="rowCostCategory" class="mt-2 p-4 rounded-xl border bg-slate-50/70 border-slate-200">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p class="text-[10px] font-black uppercase text-slate-500 tracking-widest">Classificação de Custo</p>
          <span id="extraCostDomainBadge" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold"></span>
        </div>
        <p id="extraCostSelectionSummary" class="text-xs font-semibold text-slate-400 leading-relaxed min-h-[1.25rem] mb-3"></p>
        <div id="extraCostCategoryCascade" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
        <input type="hidden" id="extraCostCategoryId" value="">
        <div id="rowProject" class="hidden mt-4">
          <label for="extraProjectId" class="block text-xs font-semibold text-slate-600 mb-1">Projecto (Obra) *</label>
          <select id="extraProjectId"
            class="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold">
            <option value="">Seleccione projecto...</option>
          </select>
        </div>
        <div id="rowObraCostCenter" class="hidden mt-4">
          <label for="extraCostCenterId" class="block text-xs font-semibold text-slate-600 mb-1">Centro de Custo (Obra) *</label>
          <select id="extraCostCenterId"
            class="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold">
            <option value="">Seleccione primeiro a obra...</option>
          </select>
        </div>
        <div id="rowCostDetailDescription" class="hidden mt-4">
          <label id="extraCostDetailLabel" for="extraCostDetailDescription" class="block text-xs font-semibold text-slate-600 mb-1">Descrição Detalhe *</label>
          <select id="extraToolSelect"
            class="hidden w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold">
            <option value="">Seleccionar ferramenta...</option>
          </select>
          <input id="extraCostDetailDescription" type="text" placeholder="Detalhe adicional..."
            class="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold">
          <p id="extraToolSelectHint" class="hidden text-[11px] text-slate-400 mt-1"></p>
        </div>
      </div>
      <div id="rowExtraQuantity" class="hidden">
        <label for="extraQuantity" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Quantidade *</label>
        <input id="extraQuantity" type="number" step="0.01" min="0.01" placeholder="Ex.: 1"
          class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
      </div>
      <div class="mt-2 p-4 bg-slate-50 rounded-xl border border-slate-200">
        <div class="flex justify-between items-center mb-3">
          <p class="text-[10px] font-black uppercase text-slate-500 tracking-widest">Itens do Pedido *</p>
          <button type="button" id="btnExtraAddItem"
            class="h-8 px-3 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold inline-flex items-center gap-1 hover:bg-emerald-200">
            <span class="material-symbols-outlined text-sm">add</span> Adicionar Item
          </button>
        </div>
        <div class="overflow-visible">
          <table class="w-full text-left" id="extraItemsTable">
            <thead>
              <tr class="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200">
                <th class="pb-2 min-w-[10rem]">Descrição</th>
                <th class="pb-2 w-16">Qtd</th>
                <th class="pb-2 w-16">Un.</th>
                <th class="pb-2 w-24">Preço Unit.</th>
                <th class="pb-2 w-20">IVA %</th>
                <th class="pb-2 w-20">Ret. %</th>
                <th class="pb-2 w-20">Desc. %</th>
                <th class="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody id="extraItemsBody" class="divide-y divide-slate-100"></tbody>
          </table>
        </div>
        ${pedidoTotalsPanelMarkup("extra")}
      </div>
      <div class="flex flex-col gap-1">
        <label class="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
          <input id="extraRequiresQuote" type="checkbox" checked
            class="rounded border-slate-300 w-4 h-4 text-emerald-600 focus:ring-emerald-500">
          Pedido requer cotação (Requisição formal com proforma)
        </label>
        <p class="text-[11px] text-slate-500 pl-6">
          Se marcado, o fornecedor e a origem de pagamento são preenchidos na requisição.
          Caso contrário, preencha-os neste pedido.
        </p>
      </div>
      <div id="extraSupplierPaymentWrap" class="hidden space-y-4">
        <div id="extraSupplierRow" class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl border bg-slate-50/70 border-slate-200">
          <div class="md:col-span-2">
            <p class="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2">Fornecedor / Proforma</p>
          </div>
          <div class="md:col-span-2">
            <label for="extraSupplierId" class="block text-xs font-semibold text-slate-600 mb-1">Fornecedor Registado</label>
            <select id="extraSupplierId"
              class="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold">
              <option value="">Fornecedor não cadastrado (consultar NIF)...</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label for="extraSupplierNif" class="block text-xs font-semibold text-slate-600 mb-1">NIF</label>
            <div class="flex gap-2">
              <input id="extraSupplierNif" type="text" inputmode="numeric" autocomplete="off"
                class="flex-1 h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold"
                placeholder="Preencha o NIF primeiro...">
              <button type="button" id="btnExtraConsultarNif"
                class="h-10 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 whitespace-nowrap">
                Consultar NIF
              </button>
            </div>
            <p id="extraSupplierNifStatus" class="hidden mt-1 text-[11px] font-semibold"></p>
          </div>
          <div class="md:col-span-2">
            <label for="extraSupplierName" class="block text-xs font-semibold text-slate-600 mb-1">Nome do Fornecedor</label>
            <input id="extraSupplierName" type="text" placeholder="Preenchido após consulta do NIF"
              class="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold">
          </div>
          <div id="extraProformaRow" class="md:col-span-2">
            <label for="extraProforma" class="block text-xs font-semibold text-slate-600 mb-1">Anexar Proforma / Documento</label>
            <input id="extraProforma" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
              class="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
            <p id="extraProformaBlockedHint" class="hidden text-[11px] text-amber-600 mt-1 font-semibold">Preencha o fornecedor (Nome, NIF e IBAN) antes de anexar o documento.</p>
            <p id="extraProformaHint" class="hidden text-[11px] text-emerald-600 mt-1 font-semibold">Proforma já anexada. Envie um novo ficheiro apenas para substituir.</p>
          </div>
        </div>
        <div id="extraPaymentBlock" class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl border bg-slate-50/70 border-slate-200">
          <div class="md:col-span-2">
            <p class="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2">Origem do Pagamento</p>
            <select id="extraSource"
              class="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold">
              <option value="SOLICITACAO_TRANSFERENCIA">Transferência para o fornecedor</option>
              <option value="FUNDO_MANEIO">Cartão multibanco</option>
            </select>
          </div>
          <div id="extraIbanRow" class="md:col-span-2">
            <label for="extraSupplierIban" class="block text-xs font-semibold text-slate-600 mb-1">IBAN do fornecedor *</label>
            <input id="extraSupplierIban" type="text" placeholder="AO06 ..."
              class="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold">
          </div>
          <div id="extraCardRow" class="hidden md:col-span-2">
            <input type="hidden" id="extraFundId" value="">
            <label for="extraCardId" class="block text-xs font-semibold text-slate-600 mb-1">Cartão multibanco *</label>
            <select id="extraCardId"
              class="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold">
              <option value="">Seleccione o cartão...</option>
            </select>
          </div>
        </div>
      </div>
      <div class="flex gap-3 justify-end pt-4 border-t border-slate-100 mt-2">
        <button type="button" id="btnCancelExtra"
          class="h-10 px-5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all">Cancelar</button>
        <button type="button" id="btnExtraReject"
          class="hidden h-10 px-5 rounded-xl bg-red-50 text-red-600 text-sm font-bold hover:bg-red-100 border border-red-200">Não Aprovar</button>
        <button type="button" id="btnExtraApprove"
          class="hidden h-10 px-5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700">Aprovar</button>
        <button type="submit" id="extraSubmitBtn"
          class="h-10 px-6 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-all">Salvar Pedido</button>
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
    ensureExtraTotalsPanel();
    return;
  }
  const root = document.createElement("div");
  root.id = "extraRequestModalRoot";
  root.innerHTML = EXTRA_MODAL_HTML;
  document.body.appendChild(root);
}

function ensureExtraTotalsPanel() {
  if (document.getElementById("extraTotalsPanel")) return;
  const table = document.getElementById("extraItemsTable");
  const wrap = table?.parentElement;
  if (!wrap) return;
  wrap.insertAdjacentHTML("afterend", pedidoTotalsPanelMarkup("extra"));
}

function refreshExtraPedidoTotals() {
  refreshPedidoTotalsFromRows("extra", "#extraItemsBody .extra-item-row");
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
    `<option value="">Fornecedor não cadastrado (consultar NIF)...</option>` +
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
    const seenId = new Set();
    const seenLabel = new Set();
    const items = (data.items || []).filter((cc) => {
      if (cc.active === false) return false;
      const id = String(cc.id || "");
      if (!id || seenId.has(id)) return false;
      seenId.add(id);
      const labelKey = `${cc.code || ""} ${cc.name || ""}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      if (labelKey && seenLabel.has(labelKey)) return false;
      if (labelKey) seenLabel.add(labelKey);
      return true;
    });
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
  const typeSel = document.getElementById("extraType");
  if (typeSel) typeSel.disabled = locked;
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
      ? "Indique as percentagens já incluídas neste valor."
      : "Valor sem impostos. Os impostos do pedido aplicam-se no total.";
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
  document.getElementById("modalExtraTitle").textContent = "Novo Pedido de Compra";
  document.getElementById("extraSubmitBtn").textContent = "Salvar Pedido";
  document.getElementById("extraSubmitBtn")?.classList.remove("hidden");
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
  const quoteEl = document.getElementById("extraRequiresQuote");
  if (quoteEl) quoteEl.checked = true;
  applyExtraQuoteRequirementVisibility();
  const tbody = document.getElementById("extraItemsBody");
  if (tbody) tbody.innerHTML = "";
  syncExtraApprovalButtons(null);
}

function setExtraType(type) {
  const isGeral = type === "GERAL";
  const typeSel = document.getElementById("extraType");
  if (typeSel) typeSel.value = type;
  document.getElementById("btnTypeGeral")?.classList.toggle("active", isGeral);
  document.getElementById("btnTypeObra")?.classList.toggle("active", !isGeral);
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
      ? "Novo Pedido de Compra Geral"
      : "Novo Pedido de Compra da Obra";
  }
  ensureCardsLoadedForExtra(type);
  if (!isGeral) {
    syncObraDescPickerFromCostCenter({ preserveValue: false });
  }
}

function extraRequiresQuote() {
  return Boolean(document.getElementById("extraRequiresQuote")?.checked ?? true);
}

function applyExtraQuoteRequirementVisibility() {
  const requiresQuote = extraRequiresQuote();
  document.getElementById("extraSupplierPaymentWrap")?.classList.toggle("hidden", requiresQuote);
  if (!requiresQuote) toggleExtraPaymentFields();
}

function toggleExtraPaymentFields() {
  if (extraRequiresQuote()) {
    document.getElementById("extraSupplierPaymentWrap")?.classList.add("hidden");
    const cardSelect = document.getElementById("extraCardId");
    if (cardSelect) cardSelect.required = false;
    return;
  }
  document.getElementById("extraSupplierPaymentWrap")?.classList.remove("hidden");
  const source = document.getElementById("extraSource").value;
  const isTransfer = source === "SOLICITACAO_TRANSFERENCIA";
  const isCard = isExtraCardSource(source);
  document.getElementById("extraCardRow")?.classList.toggle("hidden", !isCard);
  document.getElementById("extraIbanRow")?.classList.toggle("hidden", !isTransfer);
  const cardSelect = document.getElementById("extraCardId");
  if (cardSelect) cardSelect.required = isCard;
  document.getElementById("extraProformaRow")?.classList.toggle("hidden", !isTransfer);
  if (!isTransfer) {
    const proformaInput = document.getElementById("extraProforma");
    if (proformaInput) {
      proformaInput.required = false;
      proformaInput.disabled = false;
    }
    document.getElementById("extraProformaHint")?.classList.add("hidden");
    document.getElementById("extraProformaBlockedHint")?.classList.add("hidden");
    return;
  }
  syncExtraProformaAvailability();
  const isEdit = Boolean(document.getElementById("extraEditId").value);
  const editing = isEdit ? editingItemCache : null;
  const proformaHint = document.getElementById("extraProformaHint");
  if (proformaHint) {
    proformaHint.classList.toggle("hidden", !(isTransfer && editing?.proformaUrl));
  }
}

function closeExtraModal() {
  document.getElementById("modalExtra")?.classList.remove("open");
  resetExtraFormState();
}

export const NOVO_PEDIDO_PATH = "/Financeiro/novoPedido";
const DEFAULT_RETURN_TO = "/Financeiro/centroDeCompras";

export function currentAppPath() {
  return `${window.location.pathname}${window.location.search}`;
}

export function sanitizeReturnTo(raw) {
  if (!raw) return DEFAULT_RETURN_TO;
  let value = String(raw);
  try {
    value = decodeURIComponent(value);
  } catch { /* keep raw */ }
  if (!value.startsWith("/") || value.startsWith("//") || /:\/\//.test(value)) {
    return DEFAULT_RETURN_TO;
  }
  const pathOnly = value.split("?")[0].replace(/\.html$/i, "");
  if (pathOnly === NOVO_PEDIDO_PATH || pathOnly.endsWith("/novoPedido")) {
    return DEFAULT_RETURN_TO;
  }
  return value;
}

export function novoPedidoHref({
  id,
  type,
  projectId,
  costCenterId,
  costCategoryId,
  generalCostCenterId,
  lockType,
  lockProject,
  returnTo,
} = {}) {
  const params = new URLSearchParams();
  if (id) params.set("id", id);
  if (type) params.set("type", type);
  if (projectId) params.set("projectId", projectId);
  if (costCenterId) params.set("costCenterId", costCenterId);
  const category = costCategoryId || generalCostCenterId;
  if (category) params.set("costCategoryId", category);
  if (lockType) params.set("lockType", "1");
  if (lockProject) params.set("lockProject", "1");
  params.set("returnTo", returnTo || currentAppPath());
  return `${NOVO_PEDIDO_PATH}?${params.toString()}`;
}

export async function openExtraRequestModal(opts = {}) {
  window.location.href = novoPedidoHref(opts);
}

function collectCCItems() {
  const rows = document.querySelectorAll("#formExtra .extra-item-row");
  if (!rows || rows.length === 0) return [];
  const items = [];
  rows.forEach((row) => {
    const desc = row.querySelector(".cc-item-desc")?.value?.trim() || "";
    const qtyRaw = row.querySelector(".cc-item-qty")?.value;
    const unit = row.querySelector(".cc-item-unit")?.value?.trim() || "";
    const priceRaw = row.querySelector(".cc-item-price")?.value;
    const vat = parseFloat(row.querySelector(".cc-item-vat")?.value || "");
    const wh = parseFloat(row.querySelector(".cc-item-wh")?.value || "");
    const disc = parseFloat(row.querySelector(".cc-item-disc")?.value || "");
    if (!desc) return;
    const qty = parseFloat(qtyRaw || "0");
    const price =
      priceRaw !== undefined && priceRaw !== null && String(priceRaw).trim() === ""
        ? null
        : parseFloat(String(priceRaw));
    if (!Number.isFinite(qty) || qty <= 0) return;
    const taxBits = [];
    if (Number.isFinite(vat) && vat > 0) taxBits.push(`IVA ${vat}%`);
    if (Number.isFinite(wh) && wh > 0) taxBits.push(`Ret. ${wh}%`);
    if (Number.isFinite(disc) && disc > 0) taxBits.push(`Desc. ${disc}%`);
    items.push({
      description: desc,
      quantity: Number.isFinite(qty) ? qty : 1,
      unit: unit || null,
      unitPrice: Number.isFinite(price) && price >= 0 ? price : null,
      notes: taxBits.length ? taxBits.join(" · ") : null,
    });
  });
  return items;
}

function addExtraItemRow() {
  const tbody = document.getElementById("extraItemsBody");
  if (!tbody) return;
  const tr = document.createElement("tr");
  tr.className = "extra-item-row";
  tr.innerHTML = `
    <td class="py-2 pr-2"><input type="text" required class="cc-item-desc w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none" placeholder="Descrição..."></td>
    <td class="py-2 pr-2"><input type="number" min="0" step="0.01" value="1" required class="cc-item-qty w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
    <td class="py-2 pr-2"><input type="text" class="cc-item-unit w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none" placeholder="un, kg"></td>
    <td class="py-2 pr-2"><input type="number" step="0.01" min="0" placeholder="0.00" class="cc-item-price w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
    <td class="py-2 pr-2"><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-vat w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
    <td class="py-2 pr-2"><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-wh w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
    <td class="py-2 pr-2"><input type="number" min="0" max="100" step="0.01" placeholder="0" class="cc-item-disc w-full h-8 px-2 bg-white border border-slate-200 rounded text-xs focus:outline-none"></td>
    <td class="py-2 text-right">
      <button type="button" class="extra-item-del w-8 h-8 rounded bg-red-50 text-red-500 hover:bg-red-100 inline-flex items-center justify-center">
        <span class="material-symbols-outlined text-sm">delete</span>
      </button>
    </td>`;
  tbody.appendChild(tr);
  tr.querySelector(".extra-item-del")?.addEventListener("click", () => {
    if (tbody.querySelectorAll(".extra-item-row").length > 1) tr.remove();
    refreshExtraPedidoTotals();
  });
  refreshExtraPedidoTotals();
}

function parseTaxNote(notes, label) {
  const m = String(notes || "").match(new RegExp(`${label}\\s+(\\d+(?:[.,]\\d+)?)\\s*%`, "i"));
  return m ? String(m[1]).replace(",", ".") : "";
}

function repopulateCCItems(items) {
  const tbody = document.getElementById("extraItemsBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const list = items && items.length ? items : [{}];
  list.forEach((it) => {
    addExtraItemRow();
    const lastRow = tbody.querySelector(".extra-item-row:last-child");
    if (!lastRow) return;
    const descEl = lastRow.querySelector(".cc-item-desc");
    const qtyEl = lastRow.querySelector(".cc-item-qty");
    const unitEl = lastRow.querySelector(".cc-item-unit");
    const priceEl = lastRow.querySelector(".cc-item-price");
    const vatEl = lastRow.querySelector(".cc-item-vat");
    const whEl = lastRow.querySelector(".cc-item-wh");
    const discEl = lastRow.querySelector(".cc-item-disc");
    if (descEl) descEl.value = it.description || "";
    if (qtyEl) qtyEl.value = it.quantity != null ? String(it.quantity) : "1";
    if (unitEl) unitEl.value = it.unit || "";
    if (priceEl) priceEl.value = it.unitPrice != null ? String(it.unitPrice) : "";
    if (vatEl) vatEl.value = parseTaxNote(it.notes, "IVA");
    if (whEl) whEl.value = parseTaxNote(it.notes, "Ret\\.?");
    if (discEl) discEl.value = parseTaxNote(it.notes, "Desc\\.?");
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
  const canEdit = item.status === "PENDENTE" || item.status === "APROVADO" || item.status === "REJEITADO";

  editingItemCache = item;
  document.getElementById("formExtra").reset();
  document.getElementById("extraEditId").value = item.id;
  document.getElementById("modalExtraTitle").textContent = canEdit
    ? "Editar Pedido de Compra"
    : "Pedido de Compra";
  document.getElementById("extraSubmitBtn").textContent = "Guardar alterações";
  document.getElementById("extraSubmitBtn")?.classList.toggle("hidden", !canEdit);

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
  document.getElementById("extraSource").value =
    item.paymentSource === "FUNDO_MANEIO" || item.paymentSource === "TRANSFERENCIA_INTERNA_CARTAO"
      ? "FUNDO_MANEIO"
      : "SOLICITACAO_TRANSFERENCIA";

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
  if (document.getElementById("extraNotes")) {
    document.getElementById("extraNotes").value = item.notes || "";
  }
  if (document.getElementById("extraRequiresQuote")) {
    document.getElementById("extraRequiresQuote").checked = Boolean(item.requiresQuote ?? true);
  }
  if (document.getElementById("ccPedidoRequerCotacao")) {
    document.getElementById("ccPedidoRequerCotacao").checked = Boolean(item.requiresQuote ?? true);
  }
  repopulateCCItems(item.items || []);
  applyExtraQuoteRequirementVisibility();
  syncExtraApprovalButtons(item);
  refreshExtraPedidoTotals();

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
    notes: document.getElementById("extraNotes")?.value?.trim() || null,
    quantity: items[0]?.quantity || (() => {
      const raw = document.getElementById("extraQuantity")?.value;
      if (!needsItemQuantity()) return null;
      if (raw === undefined || raw === null || String(raw).trim() === "") return null;
      return parseFloat(raw);
    })(),
    amount: items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0),
    ...getExtraFiscalFormData(),
    paymentDueDate:
      document.getElementById("extraDesiredDate")?.value ||
      document.getElementById("extraPaymentDueDate").value,
    paymentSource: extraRequiresQuote() ? "SOLICITACAO_TRANSFERENCIA" : source,
    fundId: !extraRequiresQuote() && isExtraCardSource(source) ? document.getElementById("extraFundId").value || null : null,
    cardId: !extraRequiresQuote() && isExtraCardSource(source) ? document.getElementById("extraCardId").value || null : null,
    supplierId: !extraRequiresQuote() && source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierId : null,
    supplierName: !extraRequiresQuote() && source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierName : null,
    supplierNif: !extraRequiresQuote() && source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierNif : null,
    supplierIban: !extraRequiresQuote() && source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierIban : null,
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

  if (!items.length) {
    modalOptions.showToast("Adicione pelo menos um item ao pedido", "error");
    return;
  }
  if (!body.requestedBy) {
    modalOptions.showToast("Indique o solicitante", "error");
    return;
  }

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
    if (needsItemQuantity() && !(Number(body.quantity) > 0)) {
      body.quantity = items[0]?.quantity || null;
    }
  }

  if (!body.paymentDueDate) {
    modalOptions.showToast("Indique a data desejada", "error");
    return;
  }

  if (!extraRequiresQuote() && isExtraCardSource(source) && !body.cardId) {
    modalOptions.showToast("Seleccione o cartão multibanco", "error");
    return;
  }

  const editing = editingItemCache;
  const proformaFile = document.getElementById("extraProforma")?.files?.[0];
  const needsProforma = !extraRequiresQuote() && source === "SOLICITACAO_TRANSFERENCIA";
  const hasExistingProforma = Boolean(editing?.proformaUrl);

  if (needsProforma && !hasCompleteTransferSupplier(supplierData)) {
    modalOptions.showToast(
      "Seleccione o fornecedor ou consulte o NIF e indique o IBAN",
      "error"
    );
    return;
  }

  if (needsProforma && source === "SOLICITACAO_TRANSFERENCIA" && !supplierData.supplierIban) {
    modalOptions.showToast("Indique o IBAN do fornecedor para a transferência.", "error");
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
        notes: body.notes,
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
      modalOptions.showToast(
        extraRequiresQuote()
          ? "Pedido criado. Aparece em Pedidos de Compra e na Cotação."
          : "Pedido criado. Aparece em Pedidos de Compra até ser aprovado.",
        "success"
      );
    }
    closeExtraModal();
    await modalOptions.onSuccess?.();
  } catch (err) {
    modalOptions.showToast(err?.data?.message || err.message || "Erro ao guardar pedido", "error");
  }
}

function syncExtraApprovalButtons(item) {
  const show = Boolean(item && item.status === "PENDENTE" && can("pedidosExtras", "approve"));
  document.getElementById("btnExtraApprove")?.classList.toggle("hidden", !show);
  document.getElementById("btnExtraReject")?.classList.toggle("hidden", !show);
}

async function approveExtraFromModal() {
  const id = document.getElementById("extraEditId")?.value;
  if (!id) return;
  if (!confirm("Aprovar este pedido? Depois segue para o plano de pagamentos.")) return;
  try {
    await apiRequest(`/extra-requests/${id}/approve`, { method: "PATCH" });
    closeExtraModal();
    modalOptions.showToast("Pedido aprovado — disponível no plano de pagamentos", "success");
    await modalOptions.onSuccess?.();
  } catch (err) {
    modalOptions.showToast(err?.data?.message || err.message || "Erro ao aprovar pedido", "error");
  }
}

async function rejectExtraFromModal() {
  const id = document.getElementById("extraEditId")?.value;
  if (!id) return;
  const reason = prompt("Motivo da rejeição (opcional):") || "";
  try {
    await apiRequest(`/extra-requests/${id}/reject`, { method: "PATCH", body: { reason } });
    closeExtraModal();
    modalOptions.showToast("Pedido rejeitado", "success");
    await modalOptions.onSuccess?.();
  } catch (err) {
    modalOptions.showToast(err?.data?.message || err.message || "Erro ao rejeitar pedido", "error");
  }
}

function bindModalEvents() {
  if (eventsBound) return;
  eventsBound = true;

  document.getElementById("btnTypeGeral")?.addEventListener("click", () => setExtraType("GERAL"));
  document.getElementById("btnTypeObra")?.addEventListener("click", () => setExtraType("OBRA"));
  document.getElementById("extraType")?.addEventListener("change", (e) => setExtraType(e.target.value));
  document.getElementById("extraRequiresQuote")?.addEventListener("change", applyExtraQuoteRequirementVisibility);
  document.getElementById("btnExtraAddItem")?.addEventListener("click", addExtraItemRow);
  document.getElementById("extraItemsTable")?.addEventListener("input", refreshExtraPedidoTotals);
  document.getElementById("extraItemsTable")?.addEventListener("change", refreshExtraPedidoTotals);
  document.getElementById("extraDesiredDate")?.addEventListener("change", () => {
    const due = document.getElementById("extraPaymentDueDate");
    if (due) due.value = document.getElementById("extraDesiredDate")?.value || "";
  });
  bindNifLookup({
    nifInput: "extraSupplierNif",
    button: "btnExtraConsultarNif",
    statusEl: "extraSupplierNifStatus",
    register: true,
    extraBody: () => ({
      iban: document.getElementById("extraSupplierIban")?.value?.trim() || null,
    }),
    onResult: ({ ok, supplier, agt }) => {
      if (!ok) return;
      if (supplier) {
        const idx = allSuppliers.findIndex((s) => s.id === supplier.id);
        if (idx >= 0) allSuppliers[idx] = supplier;
        else allSuppliers.push(supplier);
        populateExtraSupplierSelect(supplier.id);
        applySupplierToForm(supplier);
        return;
      }
      if (agt?.nome) {
        const nameEl = document.getElementById("extraSupplierName");
        if (nameEl) nameEl.value = agt.nome;
      }
    },
  });
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
  document.getElementById("btnExtraApprove")?.addEventListener("click", approveExtraFromModal);
  document.getElementById("btnExtraReject")?.addEventListener("click", rejectExtraFromModal);
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
  btn.className = EXTRA_BTN_CLASS;
  btn.innerHTML = `<span class="material-symbols-outlined text-base">add</span> Novo Pedido`;
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
