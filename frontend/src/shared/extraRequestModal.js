import { apiRequest, apiUpload } from "../services/api.js";
import { can } from "./permissions.js";
import { formatCurrency } from "./format.js";

const EXTRA_MODAL_HTML = `
<div class="modal-overlay" id="modalExtra">
  <div class="modal-box" style="max-width:560px">
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
      <div id="rowGeneralCc">
        <label for="extraGeneralCcId" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Centro de Custo Geral *</label>
        <select id="extraGeneralCcId" required
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
          <option value="">Selecionar centro geral...</option>
        </select>
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
        <label for="extraDesc" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Descrição *</label>
        <input id="extraDesc" type="text" required placeholder="Motivo do pedido extra"
          class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
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
        <select id="extraCardId" required
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
      <div>
        <label for="extraNotes" class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Observações</label>
        <textarea id="extraNotes" rows="2"
          class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none resize-none"></textarea>
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
let generalCenters = [];
let modalOptions = { showToast: defaultToast, onSuccess: null, getEditItem: null };
let eventsBound = false;
let editingItemCache = null;
let supplierManualOverride = false;

function defaultToast(msg, type = "info") {
  console.log(`[extra] ${type}: ${msg}`);
}

function ensureModalMounted() {
  if (document.getElementById("modalExtra")) return;
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

function populateGeneralCcSelects() {
  const opts = generalCenters.map((cc) => `<option value="${cc.id}">${cc.name}</option>`).join("");
  const select = document.getElementById("extraGeneralCcId");
  if (select) {
    select.innerHTML = `<option value="">Selecionar centro geral...</option>${opts}`;
  }
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
  const [projectsData, gccData, suppliersResult] = await Promise.all([
    apiRequest("/projects?pageSize=200"),
    apiRequest("/general-cost-centers"),
    apiRequest("/suppliers").catch((err) => {
      console.warn("Não foi possível carregar fornecedores:", err);
      return { items: [] };
    }),
  ]);
  allProjects = projectsData.items || projectsData.projects || [];
  generalCenters = gccData.items || [];
  allSuppliers = (suppliersResult.items || []).filter((s) => s.active !== false);
  populateProjectSelects();
  populateGeneralCcSelects();
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
            `<option value="${cc.id}">${cc.code} — ${cc.name}${cc.currency ? ` (${cc.currency})` : ""}</option>`
        )
        .join("");
    if (selectedId) select.value = selectedId;
  } catch (err) {
    select.innerHTML = `<option value="">Erro ao carregar centros</option>`;
    modalOptions.showToast("Erro ao carregar centros de custo: " + err.message, "error");
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
  document.getElementById("extraGeneralCcId").disabled = locked;
  document.getElementById("extraProjectId").disabled = locked;
  document.getElementById("extraCostCenterId").disabled = locked;
  document.getElementById("extraTypeRow")?.classList.toggle("opacity-60", locked);
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
}

function setExtraType(type) {
  const isGeral = type === "GERAL";
  document.getElementById("extraType").value = type;
  document.getElementById("btnTypeGeral").classList.toggle("active", isGeral);
  document.getElementById("btnTypeObra").classList.toggle("active", !isGeral);
  document.getElementById("rowGeneralCc").classList.toggle("hidden", !isGeral);
  document.getElementById("rowProject").classList.toggle("hidden", isGeral);
  document.getElementById("rowObraCostCenter").classList.toggle("hidden", isGeral);
  document.getElementById("extraGeneralCcId").required = isGeral;
  document.getElementById("extraProjectId").required = !isGeral;
  document.getElementById("extraCostCenterId").required = !isGeral;
  if (isGeral) {
    document.getElementById("extraCostCenterId").value = "";
  }
  const isEdit = Boolean(document.getElementById("extraEditId").value);
  if (!isEdit) {
    document.getElementById("modalExtraTitle").textContent = isGeral
      ? "Novo Pedido Extra Geral"
      : "Novo Pedido Extra da Obra";
  }
  ensureCardsLoadedForExtra(type);
}

function toggleExtraPaymentFields() {
  const source = document.getElementById("extraSource").value;
  const isEdit = Boolean(document.getElementById("extraEditId").value);
  const editing = isEdit ? editingItemCache : null;
  const isTransfer = source === "SOLICITACAO_TRANSFERENCIA";
  document.getElementById("extraCardRow").classList.toggle("hidden", !isExtraCardSource(source));
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
  generalCostCenterId = "",
  lockType = false,
  lockProject = false,
} = {}) {
  ensureModalMounted();
  document.getElementById("formExtra").reset();
  resetExtraFormState();
  setExtraType(type);

  if (type === "OBRA" && projectId) {
    document.getElementById("extraProjectId").value = projectId;
    await loadCostCentersForExtra(projectId, costCenterId || "");
  }
  if (type === "GERAL" && generalCostCenterId) {
    document.getElementById("extraGeneralCcId").value = generalCostCenterId;
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

  setExtraType(item.type);
  setExtraFormLocked(true);

  if (item.type === "GERAL") {
    document.getElementById("extraGeneralCcId").value = item.generalCostCenterId || "";
    if (isExtraCardSource(item.paymentSource)) {
      await ensureCardsLoadedForExtra(item.type);
    }
  } else {
    document.getElementById("extraProjectId").value = item.projectId || "";
    await loadCostCentersForExtra(item.projectId, item.costCenterId || "");
    await ensureCardsLoadedForExtra("OBRA");
  }

  document.getElementById("extraDesc").value = item.description || "";
  document.getElementById("extraAmount").value = item.amount || "";
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

  document.getElementById("extraNotes").value = item.notes || "";
  const proformaInput = document.getElementById("extraProforma");
  if (proformaInput) proformaInput.required = false;
  syncExtraProformaAvailability();

  document.getElementById("modalExtra").classList.add("open");
}

async function submitExtra(e) {
  e.preventDefault();
  const editId = document.getElementById("extraEditId").value;
  const type = document.getElementById("extraType").value || "GERAL";
  const source = document.getElementById("extraSource").value;
  const supplierData = getExtraSupplierFormData();
  const body = {
    type,
    projectId: type === "OBRA" ? document.getElementById("extraProjectId").value || null : null,
    costCenterId: type === "OBRA" ? document.getElementById("extraCostCenterId").value || null : null,
    generalCostCenterId: type === "GERAL" ? document.getElementById("extraGeneralCcId").value || null : null,
    description: document.getElementById("extraDesc").value.trim(),
    amount: parseFloat(document.getElementById("extraAmount").value) || 0,
    paymentDueDate: document.getElementById("extraPaymentDueDate").value,
    paymentSource: source,
    fundId: isExtraCardSource(source) ? document.getElementById("extraFundId").value || null : null,
    cardId: isExtraCardSource(source) ? document.getElementById("extraCardId").value || null : null,
    notes: document.getElementById("extraNotes").value.trim() || null,
    supplierId: source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierId : null,
    supplierName: source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierName : null,
    supplierNif: source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierNif : null,
    supplierIban: source === "SOLICITACAO_TRANSFERENCIA" ? supplierData.supplierIban : null,
  };

  if (!editId) {
    if (type === "GERAL" && !body.generalCostCenterId) {
      modalOptions.showToast("Seleccione o centro de custo geral", "error");
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
  }

  if (!body.paymentDueDate) {
    modalOptions.showToast("Indique a data prevista de liquidação", "error");
    return;
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
        paymentDueDate: body.paymentDueDate,
        paymentSource: body.paymentSource,
        fundId: body.fundId,
        cardId: body.cardId,
        notes: body.notes,
        supplierId: body.supplierId,
        supplierName: body.supplierName,
        supplierNif: body.supplierNif,
        supplierIban: body.supplierIban,
      };
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
  document.getElementById("extraProjectId")?.addEventListener("change", async () => {
    if (document.getElementById("extraType").value === "OBRA") {
      const projectId = document.getElementById("extraProjectId").value;
      await loadCostCentersForExtra(projectId);
      await ensureCardsLoadedForExtra("OBRA");
    }
  });
  document.getElementById("formExtra")?.addEventListener("submit", submitExtra);
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
