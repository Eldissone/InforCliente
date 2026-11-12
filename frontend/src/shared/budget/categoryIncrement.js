// Ler Fatura (IA) / Incrementar Orçamento por Categoria
import { apiRequest, apiUpload } from "/services/api.js";
import { formatCurrency } from "/shared/format.js";

let _ctx = null;
const ctx = () => _ctx;
let currentSuppliers = [];
let cachedCategoryOverview = [];

/** ctx: { getProject, getCostCenters, showToast(msg,type), onChanged() } */
export function initCategoryIncrement(context) {
  _ctx = context;
}

const MODAL_HTML = `    <div class="modal-overlay" id="modalCategoryIncrement">
        <div class="modal-box" style="max-width: 980px; width: 96%;">
            <div class="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-slate-800">document_scanner</span>
                        <h2 class="text-lg font-bold text-slate-900">Registar / Incrementar Orçamento de Custo por Categoria</h2>
                    </div>
                    <p class="text-xs text-slate-500 mt-0.5">
                        Carregue uma fatura/proforma/cotação (PDF ou imagem) para leitura automática por IA ou adicione itens diretamente para incrementar o orçamento da obra por categoria.
                    </p>
                </div>
                <button type="button" onclick="document.getElementById('modalCategoryIncrement').classList.remove('open')"
                    aria-label="Fechar"
                    class="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-all">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>

            <div class="flex flex-col gap-4 max-h-[78vh] overflow-y-auto pr-1 custom-scroll">
                <!-- Bloco 1: Upload e Leitura de Fatura com IA -->
                <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div class="flex-1">
                            <label class="block text-xs font-extrabold uppercase tracking-wider text-slate-800 mb-1">
                                1. Leitura Automática de Fatura, Proforma ou Cotação (IA)
                            </label>
                            <p class="text-xs text-slate-500">
                                A IA extrai fornecedor, NIF, impostos, artigos, quantidades, preços unitários e classifica cada item na categoria correta da obra.
                            </p>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <input type="file" id="incInvoiceFile" accept=".pdf,image/*" class="hidden">
                            <button type="button" onclick="document.getElementById('incInvoiceFile').click()"
                                class="h-10 px-4 rounded-xl bg-[#212e3e] text-white text-xs font-bold flex items-center gap-2 hover:bg-slate-800 transition shadow-sm">
                                <span class="material-symbols-outlined text-base">upload_file</span>
                                Selecionar Fatura / Cotação (PDF/Img)
                            </button>
                            <button type="button" id="btnRunInvoiceScanIncrement" onclick="scanInvoiceForCategoryIncrement()"
                                class="h-10 px-3.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 hover:bg-slate-100 transition hidden">
                                <span class="material-symbols-outlined text-base">auto_awesome</span>
                                Reler com IA
                            </button>
                        </div>
                    </div>
                    <div id="incInvoiceScanStatus" class="hidden mt-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-700"></div>
                </div>

                <!-- Bloco 2: Modo de Incremento e Dados do Fornecedor / Fatura -->
                <div class="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                    <div class="md:col-span-2">
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Modo de Ação no Orçamento da Obra *</label>
                        <select id="incModeSelect" onchange="recalcCategoryIncrementPreview()"
                            class="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none">
                            <option value="PREVISTO_AND_REALIZADO">Incrementar Orçamento Previsto + Registar Realizado/Cotação (Recomendado)</option>
                            <option value="PREVISTO_ONLY">Incrementar Apenas Orçamento Previsto da Categoria</option>
                            <option value="REALIZADO_ONLY">Apenas Registar Cotação / Realizado (Sem alterar teto previsto)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Fornecedor (Extraído ou Selecionado)</label>
                        <select id="incSupplierSelect"
                            class="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none">
                            <option value="">Sem fornecedor / Apenas orçamento</option>
                        </select>
                        <input type="hidden" id="incSupplierNameRaw">
                        <input type="hidden" id="incSupplierNifRaw">
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">IVA %</label>
                            <input type="number" id="incVatPercent" step="0.01" min="0" max="100" placeholder="14"
                                class="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-center">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Nº Doc.</label>
                            <input type="text" id="incDocNumber" placeholder="FT / COT"
                                class="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold">
                        </div>
                    </div>
                </div>

                <!-- Bloco 3: Impacto em Tempo Real por Categoria da Obra -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                            Impacto no Orçamento da Obra por Categoria
                        </h3>
                        <span id="incTotalSummaryBadge" class="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg">
                            Incremento Total: 0,00 AOA
                        </span>
                    </div>
                    <div id="incCategoryCardsGrid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                        <!-- Preenchido via JS -->
                    </div>
                </div>

                <!-- Bloco 4: Linhas / Artigos a Incrementar -->
                <div class="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div class="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <span class="text-xs font-bold text-slate-700">Itens a Registar / Incrementar</span>
                        <button type="button" onclick="addCategoryIncrementRow()"
                            class="h-8 px-3 rounded-lg bg-slate-800 text-white text-xs font-bold hover:bg-slate-700 transition flex items-center gap-1">
                            <span class="material-symbols-outlined text-sm">add</span> Adicionar Item
                        </button>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse min-w-[780px]">
                            <thead>
                                <tr class="border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-slate-50/50">
                                    <th class="py-2 px-3">Categoria / Centro de Custo *</th>
                                    <th class="py-2 px-2">Descrição do Item / Serviço *</th>
                                    <th class="py-2 px-2 w-16 text-center">UN</th>
                                    <th class="py-2 px-2 w-20 text-center">Qtd.</th>
                                    <th class="py-2 px-2 w-32 text-right">Preço Unit.</th>
                                    <th class="py-2 px-3 w-32 text-right">Subtotal</th>
                                    <th class="py-2 px-2 w-10 text-center"></th>
                                </tr>
                            </thead>
                            <tbody id="incItemsTableBody">
                                <!-- Linhas via JS -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="flex items-center justify-between pt-4 mt-4 border-t border-slate-100">
                <p class="text-[11px] text-slate-400">
                    Se a categoria escolhida ainda não tiver Centro de Custo nesta obra, será criada automaticamente.
                </p>
                <div class="flex items-center gap-3">
                    <button type="button" onclick="document.getElementById('modalCategoryIncrement').classList.remove('open')"
                        class="h-10 px-5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 transition">
                        Cancelar
                    </button>
                    <button type="button" id="btnSubmitCategoryIncrement" onclick="submitCategoryIncrement()"
                        class="h-10 px-6 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1.5 shadow-md shadow-emerald-600/20">
                        <span class="material-symbols-outlined text-base">check_circle</span>
                        Confirmar e Atualizar Orçamento
                    </button>
                </div>
            </div>
        </div>
    </div>`;

function ensureIncrementModal() {
  if (document.getElementById("modalCategoryIncrement")) return;
  document.body.insertAdjacentHTML("beforeend", MODAL_HTML);
}

async function ensureSuppliers() {
  if (currentSuppliers.length) return;
  try {
    const data = await apiRequest("/suppliers");
    currentSuppliers = data.items || [];
  } catch { /* fornecedor é opcional */ }
}

const STANDARD_COST_CATEGORIES = [
  { key: "MATERIAIS_INSUMOS", code: "MAT", name: "Materiais e Insumos", icon: "inventory_2" },
  { key: "SERVICOS_MAO_DE_OBRA", code: "MDO", name: "Serviços e Mão de Obra", icon: "engineering" },
  { key: "EQUIPAMENTO", code: "EQP", name: "Equipamentos e Ferramentas", icon: "construction" },
  { key: "TRANSPORTE", code: "TRP", name: "Transporte e Logística", icon: "local_shipping" },
  { key: "GASTOS_PESSOAL", code: "PES", name: "Gastos com Pessoal", icon: "groups" },
  { key: "DESPESAS_OPERACIONAIS", code: "OPE", name: "Despesas Operacionais", icon: "Bolt" },
  { key: "INVESTIMENTOS", code: "INV", name: "Investimentos", icon: "trending_up" },
  { key: "IMPOSTOS", code: "IMP", name: "Impostos e Taxas", icon: "receipt_long" },
  { key: "OUTRAS_DESPESAS", code: "OUT", name: "Outras Despesas", icon: "category" },
];

window.openCategoryIncrementModal = async function (preselectCategory = "", autoPromptFile = false) {
  if (!ctx().getProject()?.id) {
    ctx().showToast("Selecione uma obra primeiro", "warning");
    return;
  }

  ensureIncrementModal();
  await ensureSuppliers();
  const modal = document.getElementById("modalCategoryIncrement");
  if (!modal) return;

  // Preencher fornecedores
  const supSel = document.getElementById("incSupplierSelect");
  if (supSel) {
    supSel.innerHTML =
      `<option value="">Sem fornecedor / Apenas orçamento</option>` +
      (currentSuppliers || [])
        .map((s) => `<option value="${s.id}">${s.name}${s.nif ? ` (${s.nif})` : ""}</option>`)
        .join("");
  }

  const fileInput = document.getElementById("incInvoiceFile");
  if (fileInput) {
    fileInput.value = "";
    fileInput.onchange = () => {
      if (fileInput.files?.[0]) {
        window.scanInvoiceForCategoryIncrement(fileInput.files[0]);
      }
    };
  }

  document.getElementById("btnRunInvoiceScanIncrement")?.classList.add("hidden");
  const statusEl = document.getElementById("incInvoiceScanStatus");
  if (statusEl) {
    statusEl.innerHTML = "";
    statusEl.classList.add("hidden");
  }
  const vatEl = document.getElementById("incVatPercent");
  const docEl = document.getElementById("incDocNumber");
  const supNameRaw = document.getElementById("incSupplierNameRaw");
  const supNifRaw = document.getElementById("incSupplierNifRaw");
  if (vatEl) vatEl.value = "";
  if (docEl) docEl.value = "";
  if (supNameRaw) supNameRaw.value = "";
  if (supNifRaw) supNifRaw.value = "";

  // Carrega resumo de Centros de Custo atual da obra
  try {
    const data = await apiRequest(`/cost-centers/project/${ctx().getProject().id}/categories-overview`);
    cachedCategoryOverview = data?.categories || [];
  } catch {
    cachedCategoryOverview = (ctx().getCostCenters() || []).map((cc) => ({
      category: cc.id,
      costCenterId: cc.id,
      code: cc.code,
      name: cc.name,
      currency: cc.currency || "AOA",
      currentPrevisto: Number(cc.budget || 0),
      currentRealizado: 0,
    }));
  }

  const defaultCC =
    preselectCategory ||
    ctx().getCostCenters()[0]?.id ||
    cachedCategoryOverview[0]?.costCenterId ||
    cachedCategoryOverview[0]?.category ||
    "MATERIAIS_INSUMOS";

  const tbody = document.getElementById("incItemsTableBody");
  if (tbody) {
    tbody.innerHTML = "";
    window.addCategoryIncrementRow(null, defaultCC);
  }

  window.recalcCategoryIncrementPreview();
  modal.classList.add("open");

  if (autoPromptFile && fileInput) {
    setTimeout(() => fileInput.click(), 150);
  }
};

window.addCategoryIncrementRow = function (item = null, defaultCategory = "") {
  const tbody = document.getElementById("incItemsTableBody");
  if (!tbody) return;

  const selectedVal =
    item?.costCenterId ||
    item?.category ||
    defaultCategory ||
    ctx().getCostCenters()[0]?.id ||
    "MATERIAIS_INSUMOS";

  const existingCCOpts = (ctx().getCostCenters() || [])
    .map((cc) => {
      const isSel = cc.id === selectedVal || String(cc.code).toUpperCase() === String(selectedVal).toUpperCase();
      return `<option value="${cc.id}" data-cc-id="${cc.id}" ${isSel ? "selected" : ""}>${cc.code} — ${cc.name}</option>`;
    })
    .join("");

  const existingCodes = new Set((ctx().getCostCenters() || []).map((c) => String(c.code || "").toUpperCase()));
  const newCatOpts = STANDARD_COST_CATEGORIES.filter((sc) => !existingCodes.has(sc.code))
    .map((sc) => {
      const isSel = !ctx().getCostCenters().some((c) => c.id === selectedVal) && sc.key === selectedVal;
      return `<option value="__NEW__:${sc.key}" data-cc-id="" ${isSel ? "selected" : ""}>+ Criar CC: ${sc.code} — ${sc.name}</option>`;
    })
    .join("");

  const selectHtml =
    (existingCCOpts
      ? `<optgroup label="Centros de Custo da Obra">${existingCCOpts}</optgroup>`
      : "") +
    (newCatOpts
      ? `<optgroup label="Criar Novo Centro de Custo">${newCatOpts}</optgroup>`
      : "");

  const tr = document.createElement("tr");
  tr.className = "border-b border-slate-100 inc-item-row";
  tr.innerHTML = `
    <td class="py-2 px-3">
      <select class="inc-row-cat w-full h-9 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none" onchange="recalcCategoryIncrementPreview()">
        ${selectHtml}
      </select>
    </td>
    <td class="py-2 px-2">
      <input type="text" required placeholder="Ex: Cimento Portland 42.5 / Serviço de Pintura"
        value="${(item?.description || "").replace(/"/g, "&quot;")}"
        class="inc-row-desc w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none">
    </td>
    <td class="py-2 px-2">
      <input type="text" placeholder="un" value="${(item?.unit || "un").replace(/"/g, "&quot;")}"
        class="inc-row-unit w-full h-9 px-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-center text-slate-700 focus:outline-none">
    </td>
    <td class="py-2 px-2">
      <input type="number" step="0.01" min="0.01" value="${item?.quantity ?? 1}"
        oninput="recalcCategoryIncrementPreview()"
        class="inc-row-qty w-full h-9 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-center text-slate-800 focus:outline-none">
    </td>
    <td class="py-2 px-2">
      <input type="number" step="0.01" min="0" placeholder="0,00" value="${item?.unitPrice ?? ""}"
        oninput="recalcCategoryIncrementPreview()"
        class="inc-row-price w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-right text-slate-900 focus:outline-none">
    </td>
    <td class="py-2 px-3 text-right text-xs font-extrabold text-slate-800 tabular-nums inc-row-subtotal">
      0,00 AOA
    </td>
    <td class="py-2 px-2 text-center">
      <button type="button" onclick="this.closest('tr').remove(); recalcCategoryIncrementPreview();"
        class="w-7 h-7 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 inline-flex items-center justify-center transition">
        <span class="material-symbols-outlined text-sm">close</span>
      </button>
    </td>
  `;
  tbody.appendChild(tr);
  window.recalcCategoryIncrementPreview();
};

window.recalcCategoryIncrementPreview = function () {
  const rows = document.querySelectorAll("#incItemsTableBody .inc-item-row");
  const incrementsByKey = {};
  let grandTotal = 0;

  rows.forEach((tr) => {
    const sel = tr.querySelector(".inc-row-cat");
    const rawVal = sel?.value || "";
    const ccId = sel?.selectedOptions?.[0]?.dataset?.ccId || "";
    const key = ccId || rawVal.replace(/^__NEW__:/, "");
    const qty = parseFloat(tr.querySelector(".inc-row-qty")?.value || "0") || 0;
    const price = parseFloat(tr.querySelector(".inc-row-price")?.value || "0") || 0;
    const lineTotal = Math.round((qty * price + Number.EPSILON) * 100) / 100;

    const subEl = tr.querySelector(".inc-row-subtotal");
    if (subEl) subEl.textContent = formatCurrency(lineTotal, "AOA");

    if (lineTotal > 0 && key) {
      incrementsByKey[key] = (incrementsByKey[key] || 0) + lineTotal;
      grandTotal += lineTotal;
    }
  });

  const badge = document.getElementById("incTotalSummaryBadge");
  if (badge) {
    badge.textContent = `Incremento Total: ${formatCurrency(grandTotal, "AOA")}`;
  }

  const grid = document.getElementById("incCategoryCardsGrid");
  if (!grid) return;

  const baseList =
    cachedCategoryOverview.length > 0
      ? cachedCategoryOverview.slice()
      : (ctx().getCostCenters() || []).map((cc) => ({
          category: cc.id,
          costCenterId: cc.id,
          code: cc.code,
          name: cc.name,
          currentPrevisto: Number(cc.budget || 0),
        }));

  // Se o utilizador escolheu criar um novo Centro de Custo que ainda não está na baseList, mostra o cartão dele também
  for (const [incKey, incVal] of Object.entries(incrementsByKey)) {
    if (
      incVal > 0 &&
      !baseList.some((c) => c.costCenterId === incKey || c.category === incKey)
    ) {
      const std = STANDARD_COST_CATEGORIES.find((sc) => sc.key === incKey);
      if (std) {
        baseList.push({
          category: std.key,
          costCenterId: null,
          code: std.code,
          name: `${std.name} (Novo CC)`,
          currentPrevisto: 0,
        });
      }
    }
  }

  grid.innerHTML = baseList
    .map((c) => {
      const k = c.costCenterId || c.category;
      const current = Number(c.currentPrevisto) || 0;
      const inc = incrementsByKey[k] || incrementsByKey[c.category] || 0;
      const next = current + inc;
      const isActive = inc > 0;
      const cur = c.currency || "AOA";
      return `
        <div class="rounded-xl border ${isActive ? "border-emerald-400 bg-emerald-50/60 shadow-xs" : "border-slate-200 bg-white"} p-2.5 text-xs transition">
          <div class="flex items-center justify-between mb-1">
            <span class="font-extrabold text-[10px] uppercase px-1.5 py-0.5 rounded ${isActive ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}">${c.code}</span>
            ${isActive ? `<span class="text-[11px] font-extrabold text-emerald-700">+${formatCurrency(inc, cur)}</span>` : ""}
          </div>
          <p class="font-bold text-slate-800 truncate mb-1" title="${c.name}">${c.name}</p>
          <div class="text-[11px] text-slate-500 flex justify-between">
            <span>Atual:</span>
            <span class="tabular-nums font-semibold">${formatCurrency(current, cur)}</span>
          </div>
          <div class="text-[11px] ${isActive ? "text-emerald-900 font-extrabold" : "text-slate-600 font-semibold"} flex justify-between border-t border-slate-100 pt-1 mt-1">
            <span>Novo Total:</span>
            <span class="tabular-nums">${formatCurrency(next, cur)}</span>
          </div>
        </div>
      `;
    })
    .join("");
};

window.scanInvoiceForCategoryIncrement = async function (fileOverride = null) {
  if (!ctx().getProject()?.id) return;
  const fileInput = document.getElementById("incInvoiceFile");
  const file = fileOverride || fileInput?.files?.[0];
  if (!file) {
    ctx().showToast("Selecione um ficheiro PDF ou imagem da fatura/cotação.", "warning");
    fileInput?.click();
    return;
  }

  const statusEl = document.getElementById("incInvoiceScanStatus");
  const rerunBtn = document.getElementById("btnRunInvoiceScanIncrement");
  if (rerunBtn) rerunBtn.classList.remove("hidden");

  if (statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.className = "mt-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-700";
    statusEl.innerHTML = `<span class="material-symbols-outlined text-sm align-middle animate-spin mr-1">progress_activity</span> A ler fatura com Inteligência Artificial e a associar itens aos Centros de Custo da obra...`;
  }

  try {
    const fd = new FormData();
    fd.append("file", file);

    const res = await apiUpload(
      `/cost-centers/project/${ctx().getProject().id}/scan-invoice`,
      fd,
      "POST"
    );

    const fields = res?.fields || {};
    const supplier = res?.supplier || null;
    const items = res?.items || [];
    if (Array.isArray(res?.categories) && res.categories.length) {
      cachedCategoryOverview = res.categories;
    }

    // Atualizar fornecedor
    const supSel = document.getElementById("incSupplierSelect");
    if (supplier && supSel) {
      if (!currentSuppliers.some((s) => s.id === supplier.id)) {
        currentSuppliers.push(supplier);
      }
      let opt = supSel.querySelector(`option[value="${supplier.id}"]`);
      if (!opt) {
        opt = document.createElement("option");
        opt.value = supplier.id;
        opt.textContent = `${supplier.name}${supplier.nif ? ` (${supplier.nif})` : ""}`;
        supSel.appendChild(opt);
      }
      supSel.value = supplier.id;
    }

    const supNameRaw = document.getElementById("incSupplierNameRaw");
    const supNifRaw = document.getElementById("incSupplierNifRaw");
    if (supNameRaw) supNameRaw.value = fields.supplierName || "";
    if (supNifRaw) supNifRaw.value = fields.supplierNif || "";

    const vatEl = document.getElementById("incVatPercent");
    const docEl = document.getElementById("incDocNumber");
    if (vatEl && fields.vatPercent != null) vatEl.value = fields.vatPercent;
    if (docEl && fields.docNumber) docEl.value = fields.docNumber;

    // Preencher tabela de linhas extraídas associadas ao Centro de Custo correspondente
    const tbody = document.getElementById("incItemsTableBody");
    if (tbody && items.length > 0) {
      tbody.innerHTML = "";
      items.forEach((it) =>
        window.addCategoryIncrementRow(it, it.costCenterId || it.category)
      );
    }

    window.recalcCategoryIncrementPreview();

    if (statusEl) {
      statusEl.className = "mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900";
      statusEl.innerHTML = `
        <div class="font-bold text-emerald-800 mb-0.5">
          <span class="material-symbols-outlined text-sm align-middle mr-1">check_circle</span>
          Fatura lida com sucesso! (${items.length} ${items.length === 1 ? "item extraído" : "itens extraídos"})
        </div>
        <div>
          Fornecedor: <strong>${supplier?.name || fields.supplierName || "Não identificado"}</strong>
          ${fields.supplierNif ? ` · NIF: <strong>${fields.supplierNif}</strong>` : ""}
          ${fields.docNumber ? ` · Doc: <strong>${fields.docNumber}</strong>` : ""}
          · Centro de Custo: <strong>${fields.suggestedCategoryName || "Associado automaticamente"}</strong>
        </div>
      `;
    }

    ctx().showToast("Fatura lida e associada aos Centros de Custo da obra!", "success");
  } catch (err) {
    if (statusEl) {
      statusEl.className = "mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800";
      statusEl.innerHTML = `<span class="material-symbols-outlined text-sm align-middle mr-1">error</span> ${err.message || "Não foi possível ler a fatura."}`;
    }
    ctx().showToast("Erro na leitura da fatura: " + (err.message || ""), "error");
  }
};

window.submitCategoryIncrement = async function () {
  if (!ctx().getProject()?.id) return;

  const rows = Array.from(document.querySelectorAll("#incItemsTableBody .inc-item-row"));
  const items = [];
  for (const tr of rows) {
    const catSelect = tr.querySelector(".inc-row-cat");
    const rawVal = catSelect?.value || "";
    const costCenterId = catSelect?.selectedOptions?.[0]?.dataset?.ccId || null;
    const category = costCenterId || rawVal.replace(/^__NEW__:/, "") || "MATERIAIS_INSUMOS";
    const description = tr.querySelector(".inc-row-desc")?.value?.trim() || "";
    const unit = tr.querySelector(".inc-row-unit")?.value?.trim() || "un";
    const quantity = parseFloat(tr.querySelector(".inc-row-qty")?.value || "1") || 1;
    const unitPrice = parseFloat(tr.querySelector(".inc-row-price")?.value || "0") || 0;

    if (!description) continue;
    items.push({
      category,
      costCenterId: costCenterId || null,
      description,
      unit,
      quantity,
      unitPrice,
      previstoUnitPrice: unitPrice,
    });
  }

  if (items.length === 0) {
    ctx().showToast("Adicione pelo menos um item com descrição e preço.", "error");
    return;
  }

  const mode = document.getElementById("incModeSelect")?.value || "PREVISTO_AND_REALIZADO";
  const supplierId = document.getElementById("incSupplierSelect")?.value || null;
  const supplierName = document.getElementById("incSupplierNameRaw")?.value || null;
  const supplierNif = document.getElementById("incSupplierNifRaw")?.value || null;
  const vatPercentRaw = document.getElementById("incVatPercent")?.value;
  const docNumber = document.getElementById("incDocNumber")?.value?.trim() || null;
  const fileInput = document.getElementById("incInvoiceFile");

  const btn = document.getElementById("btnSubmitCategoryIncrement");
  const prevHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined text-base animate-spin">progress_activity</span> A atualizar orçamento...`;
  }

  try {
    const fd = new FormData();
    if (fileInput?.files?.[0]) {
      fd.append("file", fileInput.files[0]);
    }
    fd.append(
      "payload",
      JSON.stringify({
        mode,
        supplierId,
        supplierName,
        supplierNif,
        vatPercent: vatPercentRaw !== "" ? Number(vatPercentRaw) : null,
        docNumber,
        currency: "AOA",
        items,
      })
    );

    const res = await apiUpload(
      `/cost-centers/project/${ctx().getProject().id}/apply-category-increment`,
      fd,
      "POST"
    );

    document.getElementById("modalCategoryIncrement")?.classList.remove("open");
    ctx().showToast(
      `Orçamento atualizado! ${res.createdNeedsCount || items.length} item(ns) registado(s) no Centro de Custo.`,
      "success"
    );

    await ctx().onChanged();
  } catch (err) {
    ctx().showToast("Erro ao atualizar orçamento: " + (err.message || ""), "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = prevHtml;
    }
  }
};

