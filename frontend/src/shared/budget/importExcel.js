// Importar Orçamento via Excel
import { apiRequest } from "/services/api.js";
import { formatCurrency } from "/shared/format.js";
import {
  CAT_PREFIX, loadCategoryOptions, optionGroupsHtml, matchSelectionByName, pendingCategories, resolveSelectionToCostCenterId,
} from "/shared/budget/categoryOptions.js";

let categoryOptions = [];

let _ctx = null;
const ctx = () => _ctx;

/** ctx: { getProject, getCostCenters, showToast(msg,type), onChanged() } */
export function initImportExcel(context) {
  _ctx = context;
}

const MODAL_HTML = `    <div class="modal-overlay" id="modalImportExcel">
        <div class="modal-box" style="max-width: 900px; max-height: 90vh; display: flex; flex-direction: column;">

            <!-- Header -->
            <div class="flex items-center justify-between mb-5 flex-shrink-0">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <span class="material-symbols-outlined text-emerald-600">table_view</span>
                    </div>
                    <div>
                        <h2 class="text-lg font-bold text-slate-900">Importar Orçamento via Excel</h2>
                        <p id="importModalSubtitle" class="text-xs text-slate-400 font-medium">Carrega a planilha Excel
                            com os itens de orçamento</p>
                    </div>
                </div>
                <button type="button" onclick="closeImportModal()" aria-label="Fechar"
                    class="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-all flex-shrink-0">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>

            <!-- Step Indicator -->
            <div class="flex items-center gap-3 mb-6 flex-shrink-0">
                <div id="stepDot1" class="flex items-center gap-2">
                    <div
                        class="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">
                        1</div>
                    <span class="text-xs font-bold text-emerald-700">Upload</span>
                </div>
                <div class="flex-1 h-px bg-slate-200" id="stepLine12"></div>
                <div id="stepDot2" class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xs font-bold"
                        id="stepNum2">2</div>
                    <span class="text-xs font-bold text-slate-400" id="stepLabel2">Mapeamento CCs</span>
                </div>
                <div class="flex-1 h-px bg-slate-200" id="stepLine23"></div>
                <div id="stepDot3" class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xs font-bold"
                        id="stepNum3">3</div>
                    <span class="text-xs font-bold text-slate-400" id="stepLabel3">Pré-visualização</span>
                </div>
            </div>

            <!-- Scrollable body -->
            <div class="flex-1 overflow-y-auto custom-scroll min-h-0">

                <!-- ── STEP 1: Upload ── -->
                <div class="import-step active" id="importStep1">
                    <div id="importDropZone"
                        class="flex flex-col items-center justify-center gap-4 py-16 px-8 text-center"
                        onclick="document.getElementById('importFileInput').click()"
                        ondragover="event.preventDefault(); this.classList.add('drag-over')"
                        ondragleave="this.classList.remove('drag-over')"
                        ondrop="event.preventDefault(); this.classList.remove('drag-over'); handleImportDrop(event)">
                        <div class="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
                            <span class="material-symbols-outlined text-4xl text-emerald-500">upload_file</span>
                        </div>
                        <div>
                            <p class="font-bold text-slate-800 text-base">Arrasta o ficheiro Excel aqui</p>
                            <p class="text-sm text-slate-400 mt-1">ou clica para selecionar · .xlsx, .xls</p>
                        </div>
                        <input type="file" id="importFileInput" accept=".xlsx,.xls" class="hidden"
                            onchange="handleImportFile(this.files[0])">
                        <div
                            class="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            <span class="flex items-center gap-1"><span
                                    class="material-symbols-outlined text-xs">check_circle</span> .xlsx</span>
                            <span class="flex items-center gap-1"><span
                                    class="material-symbols-outlined text-xs">check_circle</span> .xls</span>
                            <span class="flex items-center gap-1"><span
                                    class="material-symbols-outlined text-xs">check_circle</span> Até 20 MB</span>
                        </div>
                    </div>

                    <!-- Template hint -->
                    <div class="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                        <p class="text-xs font-bold text-blue-700 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">info</span>
                            Estrutura esperada da planilha
                        </p>
                        <p class="text-xs text-blue-600 mt-2 leading-relaxed">
                            A planilha deve ter colunas: <strong>TIPO</strong> (nome do Centro de Custo),
                            <strong>DESCRIÇÃO</strong>,
                            <strong>UN</strong> (unidade), <strong>QTD</strong> (quantidade), <strong>P. UNI</strong>
                            (preço unitário),
                            <strong>HF</strong> (horas/factor). As linhas de cabeçalho de grupo (ex: "Custo MATERIAL")
                            identificam os CCs.
                        </p>
                    </div>
                </div>

                <!-- ── STEP 2: CC Mapping ── -->
                <div class="import-step" id="importStep2">
                    <div class="mb-4 p-4 bg-amber-50 border border-amber-100 rounded-xl">
                        <p class="text-xs font-bold text-amber-700 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">account_tree</span>
                            Mapeia cada grupo da planilha para um Centro de Custo desta obra
                        </p>
                        <p class="text-xs text-amber-600 mt-1">Grupos sem mapeamento serão ignorados na importação.</p>
                    </div>
                    <div id="importCCMappingList" class="flex flex-col gap-3">
                        <!-- CC mapping rows rendered by JS -->
                    </div>
                </div>

                <!-- ── STEP 3: Preview ── -->
                <div class="import-step" id="importStep3">
                    <div id="importSummaryBar" class="grid grid-cols-3 gap-4 mb-5">
                        <!-- Summary KPIs rendered by JS -->
                    </div>
                    <div id="importPreviewGroups">
                        <!-- Groups rendered by JS -->
                    </div>
                </div>

                <!-- ── STEP 4: Importing (progress) ── -->
                <div class="import-step" id="importStep4">
                    <div class="flex flex-col items-center justify-center py-16 gap-6">
                        <div class="import-loading">
                            <div class="spinner" style="width:48px;height:48px;border-width:4px;"></div>
                        </div>
                        <div class="text-center">
                            <p class="font-bold text-slate-800 text-base" id="importProgressLabel">A importar itens...
                            </p>
                            <p class="text-xs text-slate-400 mt-1" id="importProgressSub">0 de 0 itens processados</p>
                        </div>
                        <div class="w-full max-w-sm">
                            <div class="import-progress-bar">
                                <div class="import-progress-fill" id="importProgressFill" style="width: 0%"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ── STEP 5: Done ── -->
                <div class="import-step" id="importStep5">
                    <div class="flex flex-col items-center justify-center py-14 gap-5 text-center">
                        <div class="w-20 h-20 rounded-3xl bg-emerald-100 flex items-center justify-center">
                            <span class="material-symbols-outlined text-4xl text-emerald-600">check_circle</span>
                        </div>
                        <div>
                            <p class="font-bold text-slate-900 text-xl" id="importDoneTitle">Importação concluída!</p>
                            <p class="text-sm text-slate-400 mt-2" id="importDoneSub">0 itens importados com sucesso.
                            </p>
                        </div>
                        <div id="importDoneErrors"
                            class="hidden w-full max-w-md p-4 bg-red-50 border border-red-100 rounded-xl text-left">
                            <p class="text-xs font-bold text-red-700 mb-2 flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">error</span>
                                Erros durante a importação
                            </p>
                            <ul id="importDoneErrorList" class="text-xs text-red-600 space-y-1 list-disc list-inside">
                            </ul>
                        </div>
                    </div>
                </div>

            </div><!-- /scrollable body -->

            <!-- Footer buttons -->
            <div class="flex items-center justify-between pt-5 mt-4 border-t border-slate-100 flex-shrink-0">
                <button type="button" id="importBtnBack" onclick="importGoBack()"
                    class="h-10 px-5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all hidden">
                    <span class="material-symbols-outlined text-base align-middle mr-1">arrow_back</span>
                    Voltar
                </button>
                <div class="ml-auto flex items-center gap-3">
                    <button type="button" onclick="closeImportModal()"
                        class="h-10 px-5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all"
                        id="importBtnCancel">
                        Cancelar
                    </button>
                    <button type="button" id="importBtnNext" onclick="importGoNext()" disabled
                        class="h-10 px-6 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-all shadow-md shadow-emerald-600/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                        <span id="importBtnNextIcon" class="material-symbols-outlined text-base">arrow_forward</span>
                        <span id="importBtnNextLabel">Continuar</span>
                    </button>
                </div>
            </div>

        </div>
    </div>`;

function ensureImportModal() {
  if (document.getElementById("modalImportExcel")) return;
  document.body.insertAdjacentHTML("beforeend", MODAL_HTML);
}

let importCurrentStep = 1;
let importParsedGroups = []; // [{ sheetGroupName, items: [] }]
let importMapping = {};      // sheetGroupName -> ccId or ""

// Column name aliases (handles different spellings from the spreadsheet)
const COL_ALIASES = {
  tipo: ["tipo", "type", "categoria"],
  desc: ["descri\u00e7\u00e3o", "descricao", "description", "desc", "item", "material", "servi\u00e7o"],
  unit: ["un", "und", "unit", "unidade", "un.", "und."],
  qty: ["qtd", "qtde", "qty", "quantidade", "quant"],
  price: ["p. uni", "p.uni", "preco unit", "pre\u00e7o unit\u00e1rio", "unit price", "p_uni", "p uni", "pu", "valor unit\u00e1rio"],
  hours: ["hf", "hrs", "horas", "factor", "h/f", "h.f", "hours"],
};

function resolveCol(headers) {
  const idx = {};
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  headers.forEach((h, i) => {
    const hn = norm(h);
    for (const [key, aliases] of Object.entries(COL_ALIASES)) {
      if (!idx[key] && aliases.some(a => hn.includes(a))) {
        idx[key] = i;
      }
    }
  });
  return idx;
}

export async function openImportModal() {
  ensureImportModal();
  if (!ctx().getProject()) { ctx().showToast("Seleciona uma Obra primeiro", "error"); return; }

  importCurrentStep = 1;
  importParsedGroups = [];
  importMapping = {};
  categoryOptions = await loadCategoryOptions(ctx().getProject().id);

  // Reset file input
  const fi = document.getElementById("importFileInput");
  if (fi) fi.value = "";

  // Reset drop zone appearance
  const dz = document.getElementById("importDropZone");
  if (dz) {
    dz.innerHTML = `
      <div class="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
        <span class="material-symbols-outlined text-4xl text-emerald-500">upload_file</span>
      </div>
      <div>
        <p class="font-bold text-slate-800 text-base">Arrasta o ficheiro Excel aqui</p>
        <p class="text-sm text-slate-400 mt-1">ou clica para selecionar · .xlsx, .xls</p>
      </div>
      <input type="file" id="importFileInput" accept=".xlsx,.xls" class="hidden"
        onchange="handleImportFile(this.files[0])">
      <div class="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">check_circle</span> .xlsx</span>
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">check_circle</span> .xls</span>
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">check_circle</span> Até 20 MB</span>
      </div>`;
  }

  updateImportStepUI(1);
  document.getElementById("modalImportExcel").classList.add("open");
}

window.closeImportModal = function () {
  document.getElementById("modalImportExcel").classList.remove("open");
};

// ── File handling ─────────────────────────────────────────────────────────────
window.handleImportDrop = function (event) {
  const file = event.dataTransfer.files[0];
  if (file) handleImportFile(file);
};

window.handleImportFile = function (file) {
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["xlsx", "xls"].includes(ext)) {
    ctx().showToast("Formato inválido. Use .xlsx ou .xls", "error");
    return;
  }

  // Show loading in drop zone
  const dz = document.getElementById("importDropZone");
  dz.innerHTML = `
    <div class="spinner"></div>
    <p class="text-sm font-semibold text-slate-500">A processar <strong>${file.name}</strong>...</p>`;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      // Try to find the most relevant sheet (first one with data, or the one with budget keywords)
      const sheetNames = workbook.SheetNames;
      let targetSheet = sheetNames[0];
      for (const sn of sheetNames) {
        const lower = sn.toLowerCase();
        if (lower.includes("custo") || lower.includes("or") || lower.includes("tp") || lower.includes("budget")) {
          targetSheet = sn;
          break;
        }
      }

      const ws = workbook.Sheets[targetSheet];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      importParsedGroups = parseSheetRows(rows);

      if (importParsedGroups.length === 0) {
        dz.innerHTML = `
          <div class="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
            <span class="material-symbols-outlined text-4xl text-red-400">error</span>
          </div>
          <p class="font-bold text-red-700">Não foram encontrados itens válidos</p>
          <p class="text-sm text-slate-400">Verifica se a planilha tem o formato correcto.</p>`;
        return;
      }

      const totalItems = importParsedGroups.reduce((s, g) => s + g.items.length, 0);

      // Show success in drop zone
      dz.innerHTML = `
        <div class="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
          <span class="material-symbols-outlined text-4xl text-emerald-500">check_circle</span>
        </div>
        <div>
          <p class="font-bold text-slate-800 text-base">${file.name}</p>
          <p class="text-sm text-emerald-600 font-semibold mt-1">
            ${importParsedGroups.length} grupo(s) detectado(s) · ${totalItems} itens
          </p>
        </div>
        <button type="button"
          onclick="document.getElementById('importFileInput').click()"
          class="h-8 px-4 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-all">
          Trocar ficheiro
        </button>
        <input type="file" id="importFileInput" accept=".xlsx,.xls" class="hidden"
          onchange="handleImportFile(this.files[0])">`;

      // Enable Next button
      document.getElementById("importBtnNext").disabled = false;

    } catch (err) {
      console.error("Import parse error:", err);
      dz.innerHTML = `
        <div class="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
          <span class="material-symbols-outlined text-4xl text-red-400">error</span>
        </div>
        <p class="font-bold text-red-700">Erro ao ler o ficheiro</p>
        <p class="text-sm text-slate-400">${err.message}</p>`;
    }
  };
  reader.readAsArrayBuffer(file);
};

function resolveImportPrevistoStatus(unitPrice) {
  if (unitPrice == null || unitPrice === "") return "PENDING";
  const n = Number(unitPrice);
  return Number.isFinite(n) ? "APPROVED" : "PENDING";
}

// ── Parser ────────────────────────────────────────────────────────────────────
function parseSheetRows(rows) {
  if (!rows || rows.length < 2) return [];

  // Find header row (contains column names like TIPO, DESCRIÇÃO, UN, QTD, etc.)
  let headerRowIdx = -1;
  let colIdx = {};

  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i];
    const candidate = resolveCol(r);
    // Need at least desc column to be a valid header
    if (candidate.desc !== undefined) {
      colIdx = candidate;
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) return [];

  // Parse data rows below header
  const groups = {};
  let currentGroup = "GERAL";

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];

    // Skip completely empty rows
    const allEmpty = row.every(c => String(c).trim() === "");
    if (allEmpty) continue;

    const tipo = String(row[colIdx.tipo] ?? "").trim();
    const desc = String(row[colIdx.desc] ?? "").trim();
    const unit = String(row[colIdx.unit] ?? "").trim();
    const qtyRaw = row[colIdx.qty] ?? "";
    const priceRaw = row[colIdx.price] ?? "";
    const hoursRaw = row[colIdx.hours] ?? "";

    const qty = parseFloat(String(qtyRaw).replace(",", ".")) || 0;
    const priceStr = String(priceRaw ?? "").trim();
    const hasUnitPrice = priceStr !== "" && Number.isFinite(parseFloat(priceStr.replace(",", ".")));
    const price = hasUnitPrice ? parseFloat(priceStr.replace(",", ".")) : null;
    const hours = parseFloat(String(hoursRaw).replace(",", ".")) || 1;

    if (tipo) {
      currentGroup = tipo.toUpperCase();
    }

    // Must have description to be a valid item
    if (!desc) continue;

    // Ignore summary or empty-ish rows that might be mistaken as items
    if (desc.toLowerCase().includes("total") && qty === 0 && !hasUnitPrice) continue;

    if (!groups[currentGroup]) {
      groups[currentGroup] = { sheetGroupName: currentGroup, items: [] };
    }

    groups[currentGroup].items.push({
      description: desc,
      unit: unit || null,
      quantity: qty || null,
      unitPrice: price,
      hours: hours !== 1 ? hours : null,
      priority: "MEDIA",
      status: resolveImportPrevistoStatus(price),
      _totalObra: qty * (price ?? 0) * hours,
    });
  }

  return Object.values(groups).filter(g => g.items.length > 0);
}

// ── Step Navigation ───────────────────────────────────────────────────────────
function updateImportStepUI(step) {
  importCurrentStep = step;

  // Hide all steps
  document.querySelectorAll(".import-step").forEach(el => el.classList.remove("active"));

  // Show current
  const stepIds = ["", "importStep1", "importStep2", "importStep3", "importStep4", "importStep5"];
  if (stepIds[step]) document.getElementById(stepIds[step])?.classList.add("active");

  // Step indicator dots
  [1, 2, 3].forEach(n => {
    const numEl = document.getElementById(n === 1 ? null : `stepNum${n}`);
    const lblEl = document.getElementById(n === 1 ? null : `stepLabel${n}`);
    if (numEl) numEl.className = `w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${n <= step ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500"}`;
    if (lblEl) lblEl.className = `text-xs font-bold ${n <= step ? "text-emerald-700" : "text-slate-400"}`;
  });

  // Connector lines
  const l12 = document.getElementById("stepLine12");
  const l23 = document.getElementById("stepLine23");
  if (l12) l12.style.background = step >= 2 ? "#2afc8d" : "#e2e8f0";
  if (l23) l23.style.background = step >= 3 ? "#2afc8d" : "#e2e8f0";

  // Step 1 dot (always active in step 1+)
  const dot1 = document.querySelector("#stepDot1 > div");
  if (dot1) dot1.className = `w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold`;

  // Back button
  const backBtn = document.getElementById("importBtnBack");
  if (backBtn) backBtn.classList.toggle("hidden", step <= 1 || step >= 4);

  // Next button
  const nextBtn = document.getElementById("importBtnNext");
  const nextIcon = document.getElementById("importBtnNextIcon");
  const nextLabel = document.getElementById("importBtnNextLabel");
  const cancelBtn = document.getElementById("importBtnCancel");

  if (step === 1) {
    nextBtn.disabled = importParsedGroups.length === 0;
    nextIcon.textContent = "arrow_forward";
    nextLabel.textContent = "Continuar";
    nextBtn.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
  } else if (step === 2) {
    nextBtn.disabled = false;
    nextIcon.textContent = "visibility";
    nextLabel.textContent = "Pré-visualizar";
    nextBtn.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
  } else if (step === 3) {
    nextBtn.disabled = false;
    nextIcon.textContent = "upload";
    nextLabel.textContent = "Confirmar Importação";
    nextBtn.style.background = "";
    nextBtn.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
  } else if (step === 4) {
    nextBtn.classList.add("hidden");
    cancelBtn.classList.add("hidden");
    backBtn.classList.add("hidden");
  } else if (step === 5) {
    nextBtn.classList.add("hidden");
    cancelBtn.textContent = "Fechar";
    cancelBtn.classList.remove("hidden");
  }
}

window.importGoNext = function () {
  if (importCurrentStep === 1) {
    renderCCMappingStep();
    updateImportStepUI(2);
  } else if (importCurrentStep === 2) {
    collectCCMapping();
    renderPreviewStep();
    updateImportStepUI(3);
  } else if (importCurrentStep === 3) {
    runImport();
  }
};

window.importGoBack = function () {
  if (importCurrentStep === 2) updateImportStepUI(1);
  else if (importCurrentStep === 3) updateImportStepUI(2);
};

// ── Step 2: CC Mapping ────────────────────────────────────────────────────────
function renderCCMappingStep() {
  const container = document.getElementById("importCCMappingList");
  if (!container) return;

  const ccs = ctx().getCostCenters() || [];
  const hasAnyTarget = ccs.length > 0 || pendingCategories(categoryOptions, ccs).length > 0;

  const hint = hasAnyTarget ? "" : `
    <div class="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4 text-xs font-semibold text-amber-700 flex items-center gap-2">
      <span class="material-symbols-outlined text-sm">info</span>
      Ainda não há categorias de custo de obra registadas.
      <a href="/registos/categorias-custo" target="_blank" class="underline">Criar em Registos</a>
    </div>`;

  container.innerHTML = hint + importParsedGroups.map((group, idx) => {
    const autoValue = matchSelectionByName(group.sheetGroupName, ccs, categoryOptions);

    return `
      <div class="import-cc-group">
        <div class="import-cc-header">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0 text-xs font-bold text-slate-600">
              ${group.items.length}
            </div>
            <div class="min-w-0">
              <p class="text-xs font-bold text-slate-800 truncate">${group.sheetGroupName}</p>
              <p class="text-[10px] text-slate-400">${group.items.length} item(s) · Total: ${formatCurrency(
      group.items.reduce((s, it) => s + (it._totalObra || 0), 0), "AOA")}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            ${autoValue
              ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Auto-mapeado</span>`
              : `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Escolher categoria</span>`}
            <select data-group-idx="${idx}" id="ccMapSelect_${idx}"
              class="h-9 px-3 bg-white border ${autoValue ? "border-emerald-300" : "border-slate-200"} rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40 min-w-[220px]">
              <option value="">— Ignorar grupo —</option>
              ${optionGroupsHtml({ costCenters: ccs, options: categoryOptions, selected: autoValue })}
            </select>
          </div>
        </div>
        <div class="px-4 py-2 text-[10px] text-slate-400 font-semibold">
          ${group.items.slice(0, 3).map(it => `<span class="inline-block mr-3">${it.description.substring(0, 40)}</span>`).join("")}
          ${group.items.length > 3 ? `<span class="text-slate-300">+${group.items.length - 3} mais...</span>` : ""}
        </div>
      </div>`;
  }).join("");
}

function collectCCMapping() {
  importMapping = {};
  importParsedGroups.forEach((group, idx) => {
    const sel = document.getElementById(`ccMapSelect_${idx}`);
    if (sel && sel.value) {
      importMapping[group.sheetGroupName] = sel.value;
    }
  });
}

// ── Step 3: Preview ───────────────────────────────────────────────────────────
function renderPreviewStep() {
  const summaryBar = document.getElementById("importSummaryBar");
  const previewGroups = document.getElementById("importPreviewGroups");

  // Only include mapped groups
  const mappedGroups = importParsedGroups.filter(g => importMapping[g.sheetGroupName]);
  const totalItems = mappedGroups.reduce((s, g) => s + g.items.length, 0);
  const totalValue = mappedGroups.reduce((s, g) =>
    s + g.items.reduce((gs, it) => gs + (it._totalObra || 0), 0), 0);
  const ignoredGroups = importParsedGroups.length - mappedGroups.length;

  summaryBar.innerHTML = `
    <div class="kpi-card">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Grupos Mapeados</p>
      <p class="text-xl font-bold text-emerald-600">${mappedGroups.length}</p>
    </div>
    <div class="kpi-card">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total de Itens</p>
      <p class="text-xl font-bold text-slate-900">${totalItems}</p>
    </div>
    <div class="kpi-card">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Valor Total Estimado</p>
      <p class="text-xl font-bold text-slate-900">${formatCurrency(totalValue, "AOA")}</p>
    </div>`;

  if (mappedGroups.length === 0) {
    previewGroups.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined text-3xl">warning</span>
        <p class="text-sm font-semibold">Nenhum grupo mapeado</p>
        <p class="text-xs text-slate-400">Volta ao passo anterior e mapeia pelo menos um Centro de Custo.</p>
      </div>`;
    document.getElementById("importBtnNext").disabled = true;
    return;
  }

  document.getElementById("importBtnNext").disabled = false;

  if (ignoredGroups > 0) {
    previewGroups.innerHTML = `
      <div class="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4 text-xs font-semibold text-amber-700 flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">info</span>
        ${ignoredGroups} grupo(s) sem mapeamento serão ignorados.
      </div>`;
  } else {
    previewGroups.innerHTML = "";
  }

  mappedGroups.forEach(group => {
    let ccName = "";
    let ccCode = "";
    let isNew = false;
    let cur = ctx().getProject()?.currency || "AOA";
    const mapped = importMapping[group.sheetGroupName];
    if (String(mapped).startsWith(CAT_PREFIX)) {
      const opt = categoryOptions.find((o) => `${CAT_PREFIX}${o.categoryId}` === mapped);
      ccName = opt?.name || "Categoria";
      isNew = true;
    } else {
      const cc = ctx().getCostCenters().find(c => c.id === mapped);
      if (cc) {
        ccName = cc.name;
        ccCode = cc.code;
        cur = cc.currency || "AOA";
      }
    }
    const groupTotal = group.items.reduce((s, it) => s + (it._totalObra || 0), 0);

    previewGroups.innerHTML += `
      <div class="import-cc-group">
        <div class="import-cc-header">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">${group.sheetGroupName}</span>
            <span class="material-symbols-outlined text-sm text-emerald-500">arrow_forward</span>
            <span class="text-xs font-bold ${isNew ? 'text-blue-600' : 'text-slate-900'}">${isNew ? '✨ ' : ''}${ccName}${isNew ? ' (nova na obra)' : ''}</span>
          </div>
          <span class="text-xs font-bold text-slate-600">${group.items.length} itens · ${formatCurrency(groupTotal, cur)}</span>
        </div>
        <div class="overflow-x-auto custom-scroll">
          <table class="w-full import-preview-table">
            <thead>
              <tr>
                <th class="text-left">Descrição</th>
                <th class="text-center">UN</th>
                <th class="text-right">Qtd</th>
                <th class="text-right">P. Unit.</th>
                <th class="text-right">Hrs</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${group.items.map(it => `
                <tr>
                  <td class="font-medium text-slate-800 max-w-xs" style="max-width:280px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${(it.description || "").replace(/"/g, "&quot;")}">${it.description}</td>
                  <td class="text-center text-slate-500">${it.unit || "—"}</td>
                  <td class="text-right text-slate-700">${it.quantity ? Number(it.quantity).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—"}</td>
                  <td class="text-right text-slate-700">${it.unitPrice ? Number(it.unitPrice).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—"}</td>
                  <td class="text-right text-slate-500">${it.hours ? Number(it.hours).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—"}</td>
                  <td class="text-right font-bold text-slate-900">${formatCurrency(it._totalObra || 0, cur)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  });
}

// ── Step 4: Run Import ────────────────────────────────────────────────────────
async function runImport() {
  updateImportStepUI(4);
  const progressFill = document.getElementById("importProgressFill");
  const progressLabel = document.getElementById("importProgressLabel");
  const progressSub = document.getElementById("importProgressSub");
  let done = 0;
  const errors = [];

  // Criar (via rápida) os centros de custo das categorias registadas escolhidas
  progressLabel.textContent = "A preparar centros de custo...";
  const ccCache = new Map();
  for (const group of importParsedGroups) {
    const mapped = importMapping[group.sheetGroupName];
    if (!String(mapped).startsWith(CAT_PREFIX)) continue;
    try {
      importMapping[group.sheetGroupName] = await resolveSelectionToCostCenterId(ctx().getProject().id, mapped, ccCache);
    } catch (err) {
      errors.push(`Erro ao criar centro de custo para ${group.sheetGroupName}: ${err.message}`);
      importMapping[group.sheetGroupName] = null;
    }
  }

  // Build list of items to import
  const toImport = [];
  for (const group of importParsedGroups) {
    let ccId = importMapping[group.sheetGroupName];
    if (!ccId || String(ccId).startsWith(CAT_PREFIX)) continue; // ignorado ou falhou a criação
    // Just to ensure ccId is a string, if api returned an object fallback
    if (typeof ccId === "object" && ccId.id) ccId = ccId.id;

    for (const item of group.items) {
      toImport.push({ ccId, ...item });
    }
  }

  if (toImport.length === 0 && errors.length === 0) {
    ctx().showToast("Nenhum item para importar", "warning");
    updateImportStepUI(1);
    return;
  }

  // Get responsible name — use the first available user or a fallback
  let responsibleName = null;
  try {
    const ud = await apiRequest("/users/receivers");
    if (ud.items && ud.items.length > 0) responsibleName = ud.items[0].name || ud.items[0].email;
  } catch { /* ignore — responsible is optional */ }

  for (const item of toImport) {
    try {
      const body = {
        costCenterId: item.ccId,
        description: item.description,
        unit: item.unit || null,
        quantity: item.quantity || null,
        unitPrice: item.unitPrice != null ? item.unitPrice : null,
        hours: item.hours || null,
        priority: item.priority || "MEDIA",
        status: resolveImportPrevistoStatus(item.unitPrice),
        responsible: responsibleName || null,
      };
      await apiRequest(`/cost-centers/${item.ccId}/needs`, { method: "POST", body });
      done++;
    } catch (err) {
      errors.push(`"${item.description.substring(0, 40)}": ${err.message}`);
    }

    // Update progress
    const pct = Math.round((done / toImport.length) * 100);
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressLabel) progressLabel.textContent = `A importar itens... (${pct}%)`;
    if (progressSub) progressSub.textContent = `${done} de ${toImport.length} itens processados`;
  }

  // Step 5: Done
  updateImportStepUI(5);
  document.getElementById("importDoneTitle").textContent =
    done > 0 ? "Importação concluída!" : "Sem itens importados";
  document.getElementById("importDoneSub").textContent =
    `${done} de ${toImport.length} itens importados com sucesso.`;

  if (errors.length > 0) {
    const errDiv = document.getElementById("importDoneErrors");
    const errList = document.getElementById("importDoneErrorList");
    errDiv.classList.remove("hidden");
    errList.innerHTML = errors.slice(0, 10).map(e => `<li>${e}</li>`).join("");
    if (errors.length > 10) errList.innerHTML += `<li>...e mais ${errors.length - 10} erros.</li>`;
  }

  // Refresh data
  if (done > 0) {
    ctx().showToast(`${done} itens importados com sucesso!`, "success");
    await ctx().onChanged();
  }
}
