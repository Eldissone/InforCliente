import { apiUpload, getAssetUrl } from "../services/api.js";
import { dateInputToUtcNoonIso, toDateKey } from "./format.js";
import { renderQuotePriceTotalsHtml } from "./supplierFiscal.js";

import {

  downloadPurchaseOrderPdf,

  fetchCatalogSuggestions,

  generatePurchaseOrderPdf,

  uploadPurchaseOrderPdf,

} from "./quotePurchaseOrder.js";



function needWorkflowState(need) {
  const status = need?.status || "PENDING";
  return {
    isApproved: status === "APPROVED",
    isInAnalysis: status === "EM_ANALISE",
    isOrdered: status === "ORDERED",
    isPaid: status === "PAID",
    isLocked: status === "PAID" || ["APPROVED", "EM_ANALISE", "ORDERED"].includes(status),
  };
}

function needCostCenterId(need) {
  return need?.costCenterId || need?.costCenter?.id || null;
}

function renderAllocationSummary(allocation, need) {
  const el = document.getElementById("quoteAllocationSummary");
  if (!el) return;
  const required = Number(allocation?.required ?? need?.quantity) || 0;
  if (!required) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const unit = need?.unit || "un";
  const remClass = (allocation?.remaining ?? 0) > 0 ? "text-amber-700" : "text-emerald-700";
  el.innerHTML =
    `Necessário: <strong>${required.toLocaleString("pt-PT")} ${unit}</strong>` +
    ` · Alocado: <strong>${Number(allocation?.allocated || 0).toLocaleString("pt-PT")} ${unit}</strong>` +
    ` · Restante: <strong class="${remClass}">${Number(allocation?.remaining || 0).toLocaleString("pt-PT")} ${unit}</strong>` +
    (allocation?.weightedUnitPrice
      ? ` · P. médio: <strong>${Number(allocation.weightedUnitPrice).toLocaleString("pt-PT", { minimumFractionDigits: 2 })}</strong>`
      : "");
}

function updateQuoteQuantityHint(allocation, need) {
  const hint = document.getElementById("quoteQuantityHint");
  if (!hint) return;
  const req = Number(need?.quantity) || 0;
  if (!req) {
    hint.textContent = "Quantidade oferecida por este fornecedor.";
    return;
  }
  const rem = allocation?.remaining ?? req;
  hint.textContent =
    rem > 0
      ? `Restam ${rem.toLocaleString("pt-PT")} ${need.unit || "un"} por alocar.`
      : "Quantidade total alocada — ajuste nas linhas abaixo.";
}

let siteReceptionDirty = false;
let siteReceptionSaveTimer = null;

function formatSiteReceptionDateInput(isoOrDate) {
  return toDateKey(isoOrDate) || "";
}

function resolveQuoteToast(showToast) {
  return showToast || window.showQuoteToast;
}

function loadSiteReceptionFields(needMeta, { force = false } = {}) {
  const dateEl = document.getElementById("quoteSiteReceptionDate");
  const locEl = document.getElementById("quoteSiteReceptionLocation");
  const savedEl = document.getElementById("quoteSiteReceptionSaved");
  if (!dateEl || !locEl) return;
  if (!force && siteReceptionDirty) return;
  dateEl.value = formatSiteReceptionDateInput(needMeta?.siteReceptionPlannedAt);
  locEl.value = needMeta?.siteReceptionLocation || "";
  if (savedEl) savedEl.classList.add("hidden");
}

function wireQuoteSiteReception({ need, apiRequest, showToast }) {
  siteReceptionDirty = false;
  if (siteReceptionSaveTimer) {
    clearTimeout(siteReceptionSaveTimer);
    siteReceptionSaveTimer = null;
  }

  const dateEl = document.getElementById("quoteSiteReceptionDate");
  const locEl = document.getElementById("quoteSiteReceptionLocation");
  const saveSiteBtn = document.getElementById("btnSaveQuoteSiteReception");
  const toast = resolveQuoteToast(showToast);
  const save = () =>
    saveQuoteSiteReception({
      need: window.__quoteModalNeed || need,
      apiRequest,
      showToast: toast,
    });

  if (saveSiteBtn) saveSiteBtn.onclick = save;

  const markDirty = () => {
    siteReceptionDirty = true;
    document.getElementById("quoteSiteReceptionSaved")?.classList.add("hidden");
  };
  const scheduleAutoSave = () => {
    markDirty();
    clearTimeout(siteReceptionSaveTimer);
    siteReceptionSaveTimer = setTimeout(save, 700);
  };

  if (dateEl) {
    dateEl.disabled = false;
    dateEl.readOnly = false;
    dateEl.oninput = markDirty;
    dateEl.onchange = scheduleAutoSave;
  }
  if (locEl) {
    locEl.disabled = false;
    locEl.readOnly = false;
    locEl.oninput = markDirty;
    locEl.onchange = scheduleAutoSave;
  }
}

function canPlaceOrderOnQuote(need, quote) {
  if (!quote?.selected || quote.orderNumber != null) return false;
  if (["PAID", "APPROVED"].includes(need?.status)) return false;
  return ["IN_QUOTATION", "EM_ANALISE", "ORDERED", "PENDING"].includes(need?.status);
}

function formatOrderRef(orderNumber) {
  const n = Number(orderNumber);
  if (!Number.isFinite(n)) return "—";
  return `EF${String(n).padStart(3, "0")}`;
}

function quoteHasProforma(quote) {
  const url = quote?.proformaUrl;
  return typeof url === "string" && url.trim().length > 0;
}

function isQuoteActive(quote) {
  if (!quote) return false;
  if (quote.orderNumber != null) return true;
  return quote.selected === true || quote.selected === 1;
}

function buildQuoteProformaUpload(quote) {
  if (quoteHasProforma(quote) || !isQuoteActive(quote)) return "";
  return `
    <label class="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer shrink-0"
      style="background:#d97706; color:#fff;"
      title="Carregar proforma">
      <input type="file" class="hidden" data-proforma-input="${quote.id}" accept="image/*,.pdf,.png,.jpg,.jpeg,.webp">
      <span class="material-symbols-outlined text-[22px] leading-none">upload_file</span>
    </label>`;
}

function buildQuoteProformaStatus(quote) {
  if (!isQuoteActive(quote)) return "";
  if (!quoteHasProforma(quote)) return buildQuoteProformaUpload(quote);
  return `<button type="button" data-view-proforma="${getAssetUrl(quote.proformaUrl)}" title="Ver proforma"
    class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border border-emerald-300"
    style="background:#059669;color:#fff">
    <span class="material-symbols-outlined text-[22px] leading-none">description</span>
  </button>`;
}

function buildQuotePdfIcon(quote) {
  if (!quote?.purchaseOrderUrl) return "";
  return `<a href="${getAssetUrl(quote.purchaseOrderUrl)}" target="_blank" rel="noopener"
    class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
    style="background:#0f172a;color:#2afc8d"
    title="PDF encomenda">
    <span class="material-symbols-outlined text-[22px] leading-none">picture_as_pdf</span>
  </a>`;
}

function getSiteReceptionDateStr() {
  return document.getElementById("quoteSiteReceptionDate")?.value?.trim() || "";
}

function buildQuoteAllocActions({ quote, need, allocation, isLocked }) {
  if (quote.orderNumber != null) {
    const ref = formatOrderRef(quote.orderNumber);
    const proformaAction = buildQuoteProformaStatus(quote);
    const pdfIcon = buildQuotePdfIcon(quote);
    return `
      <div class="flex flex-col items-end gap-1.5 shrink-0">
        <span class="text-[10px] font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded whitespace-nowrap">${ref}</span>
        <div class="flex items-center gap-1.5">${proformaAction}${pdfIcon}</div>
      </div>`;
  }

  const required = Number(need?.quantity) || 0;
  const suggested = quote.selected
    ? Number(quote.quantity) || required || 1
    : allocation?.remaining > 0
      ? allocation.remaining
      : required || 1;

  const canOrder = canPlaceOrderOnQuote(need, quote);
  const canEditQty = quote.selected && !isLocked;

  if (quote.selected) {
    const proformaAction = buildQuoteProformaStatus(quote);
    const orderBtn = canOrder
      ? `<button type="button" data-place-order="${quote.id}" title="Gerar encomenda só para este fornecedor"
          class="h-8 px-2 rounded-lg bg-[#0f172a] text-white text-[10px] font-bold hover:bg-[#2afc8d] hover:text-[#0f172a] transition-all whitespace-nowrap flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">local_shipping</span>Encomendar</button>`
      : "";
    const removeBtn = canEditQty
      ? `<button type="button" data-deselect-quote="${quote.id}" title="Remover alocação"
          class="h-8 px-2 rounded-lg bg-red-50 text-red-600 text-[10px] font-bold hover:bg-red-100 whitespace-nowrap">Remover</button>`
      : "";
    return `
      <div class="flex flex-col items-end gap-1.5 shrink-0">
        <div class="flex items-center gap-1.5">${proformaAction}</div>
        ${canEditQty ? `<input type="number" step="0.01" min="0.01" data-update-quote-qty="${quote.id}" value="${suggested}"
          class="w-20 h-8 px-2 border border-slate-200 rounded-lg text-xs font-semibold text-center" title="Quantidade alocada">` : `<span class="text-xs font-bold text-slate-600">${suggested} un</span>`}
        <div class="flex items-center gap-1.5 flex-wrap justify-end">${orderBtn}${removeBtn}</div>
      </div>`;
  }

  if (isLocked) return "";

  return `
    <div class="flex items-center gap-1.5">
      <input type="number" step="0.01" min="0.01" data-for-quote="${quote.id}" value="${suggested}"
        class="w-20 h-8 px-2 border border-slate-200 rounded-lg text-xs font-semibold text-center" title="Quantidade a alocar">
      <button type="button" data-select-quote="${quote.id}"
        class="h-8 px-3 bg-[#0f172a] text-white text-[10px] font-bold rounded-lg hover:bg-[#2afc8d] hover:text-[#0f172a] transition-all whitespace-nowrap">Alocar</button>
    </div>`;
}

async function saveQuoteSiteReception({ need, apiRequest, showToast }) {
  const toast = resolveQuoteToast(showToast);
  if (!need?.id) {
    toast?.("Item não encontrado.", "error");
    return false;
  }
  const dateStr = document.getElementById("quoteSiteReceptionDate")?.value?.trim() || "";
  const location = document.getElementById("quoteSiteReceptionLocation")?.value?.trim() || null;
  const body = {
    siteReceptionLocation: location,
    siteReceptionPlannedAt: dateInputToUtcNoonIso(dateStr),
  };
  try {
    const result = await apiRequest(`/quotes/need/${need.id}/reception-plan`, { method: "PATCH", body });
    const saved = result?.need || {};
    siteReceptionDirty = false;
    window.__quoteModalNeed = {
      ...(window.__quoteModalNeed || need),
      siteReceptionPlannedAt: saved.siteReceptionPlannedAt ?? body.siteReceptionPlannedAt,
      siteReceptionLocation: saved.siteReceptionLocation ?? location,
      costCenterId: saved.costCenterId ?? needCostCenterId(need),
    };
    loadSiteReceptionFields(window.__quoteModalNeed, { force: true });
    const savedEl = document.getElementById("quoteSiteReceptionSaved");
    if (savedEl) {
      savedEl.textContent = "Recepção planeadas guardada.";
      savedEl.classList.remove("hidden");
    }
    toast?.("Recepção em obra guardada.", "success");
    return true;
  } catch (err) {
    toast?.("Erro ao guardar recepção: " + err.message, "error");
    return false;
  }
}

function quoteRank(q) {
  return (
    (q.orderNumber != null ? 8 : 0) +
    (q.selected ? 4 : 0) +
    (quoteHasProforma(q) ? 2 : 0) +
    (q.purchaseOrderUrl ? 1 : 0)
  );
}

function dedupeQuotes(quotes) {
  const map = new Map();
  for (const q of quotes) {
    const key = `${q.supplierId}:${q.supplierProductId || ""}:${Number(q.quotedPrice)}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, q);
      continue;
    }
    map.set(key, quoteRank(q) >= quoteRank(existing) ? q : existing);
  }
  return Array.from(map.values());
}



function setQuoteNewPanelVisible(visible) {

  const panel = document.getElementById("quoteNewPanel");

  const btn = document.getElementById("btnShowNewQuote");

  if (panel) panel.classList.toggle("hidden", !visible);

  if (btn) {

    btn.innerHTML = visible

      ? `<span class="material-symbols-outlined text-base">close</span> Cancelar`

      : `<span class="material-symbols-outlined text-base">add</span> Novo`;

    btn.classList.toggle("bg-slate-200", visible);

    btn.classList.toggle("text-slate-700", visible);

    btn.classList.toggle("hover:bg-slate-300", visible);

    btn.classList.toggle("bg-amber-500", !visible);

    btn.classList.toggle("text-white", !visible);

    btn.classList.toggle("hover:bg-amber-600", !visible);

  }

}



function wireQuoteNewToggle(need) {

  const btn = document.getElementById("btnShowNewQuote");

  if (!btn) return;



  const { isLocked } = needWorkflowState(need);

  setQuoteNewPanelVisible(false);

  btn.classList.toggle("hidden", isLocked);



  btn.onclick = () => {

    const panel = document.getElementById("quoteNewPanel");

    const isOpen = panel && !panel.classList.contains("hidden");

    setQuoteNewPanelVisible(!isOpen);

  };

}



function renderOrderedBanner(selectedQuote) {

  const existing = document.getElementById("quoteOrderedBanner");

  if (existing) existing.remove();

  if (!selectedQuote) return;



  const banner = document.createElement("div");

  banner.id = "quoteOrderedBanner";

  banner.className = "mb-4 p-4 rounded-xl border border-amber-200 bg-amber-50";

  banner.innerHTML = `

    <div class="flex flex-col sm:flex-row sm:items-center gap-3">

      <div class="flex-1">

        <p class="text-xs font-black uppercase tracking-widest text-amber-700 mb-1">Encomenda gerada</p>

        <p class="text-sm text-amber-900 font-medium">

          Fornecedor <strong>${selectedQuote.supplier?.name || "—"}</strong> seleccionado.

          Carregue a proforma de cada fornecedor — documento de suporte à selecção e consulta do financeiro.

        </p>

      </div>

      <div class="flex flex-col gap-2 sm:w-72 shrink-0">

        <input type="file" id="orderedProformaInput" accept="image/*,.pdf"

          class="w-full h-10 px-3 bg-white border border-amber-300 rounded-lg text-xs font-semibold file:mr-3 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-amber-100 file:text-amber-800 hover:file:bg-amber-200">

        <button type="button" id="btnUploadOrderedProforma"

          class="h-10 w-full rounded-lg bg-[#0f172a] text-white text-xs font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2">

          <span class="material-symbols-outlined text-base">upload_file</span>

          Submeter Proposta

        </button>

      </div>

    </div>`;



  const panel = document.getElementById("quotePresentedPanel");

  panel?.insertBefore(banner, panel.firstChild);

}



function renderReadyToOrderBanner(selectedQuote) {

  const existing = document.getElementById("quoteReadyBanner");

  if (existing) existing.remove();

  if (!selectedQuote) return;

  const base = Number(selectedQuote.totalValue ?? selectedQuote.quotedPrice ?? 0);
  const net = Number(selectedQuote.netTotal);
  const currency = selectedQuote.currency || "AOA";
  const priceTotals = renderQuotePriceTotalsHtml(
    selectedQuote.supplier,
    base,
    currency,
    selectedQuote.supplierProduct
  );
  const payableLabel =
    Number.isFinite(net) && net > 0 && Math.abs(net - base) > 0.05
      ? `<strong>Líquido a pagar: ${net.toLocaleString("pt-PT", { minimumFractionDigits: 2 })} ${currency}</strong> (base: ${base.toLocaleString("pt-PT", { minimumFractionDigits: 2 })} ${currency})`
      : `<strong>${base.toLocaleString("pt-PT", { minimumFractionDigits: 2 })} ${currency}</strong>`;

  const banner = document.createElement("div");

  banner.id = "quoteReadyBanner";

  banner.className = "mb-4 p-4 rounded-xl border border-[#2afc8d]/40 bg-[#2afc8d]/10";

  banner.innerHTML = `

    <div class="flex flex-col sm:flex-row sm:items-center gap-3">

      <div class="flex-1">

        <p class="text-xs font-black uppercase tracking-widest text-emerald-700 mb-1">Fornecedor seleccionado</p>

        <p class="text-sm text-slate-700 font-medium">

          <strong>${selectedQuote.supplier?.name || "—"}</strong> — ${payableLabel}.

          Pode trocar de fornecedor, carregar proforma ou encomendar na linha do fornecedor abaixo.

        </p>

        ${priceTotals.fiscalBreakdownHtml || ""}

      </div>

      <div class="flex flex-col gap-2 shrink-0 sm:min-w-[200px]">
        <button type="button" id="btnCancelSelection"

          class="h-10 px-4 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all whitespace-nowrap">

          Cancelar Selecção

        </button>

      </div>

    </div>`;



  const panel = document.getElementById("quotePresentedPanel");

  panel?.insertBefore(banner, panel.firstChild);

}



function renderApprovedBanner(selectedQuote, need) {
  const existing = document.getElementById("quoteApprovedBanner");
  if (existing) existing.remove();
  if (!selectedQuote || need?.scheduled) return;

  const total = Number(selectedQuote.totalValue ?? selectedQuote.quotedPrice ?? 0)
    .toLocaleString("pt-PT", { minimumFractionDigits: 2 });

  const banner = document.createElement("div");
  banner.id = "quoteApprovedBanner";
  banner.className = "mb-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50";
  banner.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center gap-3">
      <div class="flex-1">
        <p class="text-xs font-black uppercase tracking-widest text-emerald-700 mb-1">Aprovado</p>
        <p class="text-sm text-emerald-900 font-medium">
          <strong>${selectedQuote.supplier?.name || "—"}</strong> — ${total} ${selectedQuote.currency || "AOA"}.
          Envie ao financeiro para agendar o pagamento.
        </p>
      </div>
      <button type="button" id="btnSendToFinance"
        class="h-10 px-4 rounded-lg bg-[#0f172a] text-white text-xs font-bold hover:bg-slate-800 transition-all inline-flex items-center gap-2 shrink-0">
        <span class="material-symbols-outlined text-base">forward_to_inbox</span>
        Enviar ao Financeiro
      </button>
    </div>`;

  const panel = document.getElementById("quotePresentedPanel");
  panel?.insertBefore(banner, panel.firstChild);
}

function clearOrderedBanner() {

  document.getElementById("quoteOrderedBanner")?.remove();

  document.getElementById("quoteReadyBanner")?.remove();

  document.getElementById("quoteAnalysisBanner")?.remove();

  document.getElementById("quoteApprovedBanner")?.remove();

  document.getElementById("quoteMultiOrderBanner")?.remove();

}



function renderInAnalysisBanner(selectedQuote, need) {

  const existing = document.getElementById("quoteAnalysisBanner");

  if (existing) existing.remove();

  if (!selectedQuote) return;

  const total = Number(selectedQuote.totalValue ?? selectedQuote.quotedPrice ?? 0)
    .toLocaleString("pt-PT", { minimumFractionDigits: 2 });

  const banner = document.createElement("div");

  banner.id = "quoteAnalysisBanner";

  banner.className = "mb-4 p-4 rounded-xl border border-sky-200 bg-sky-50";

  banner.innerHTML = `

    <div class="flex flex-col sm:flex-row sm:items-center gap-3">

      <div class="flex-1">

        <p class="text-xs font-black uppercase tracking-widest text-sky-700 mb-1">Em análise</p>

        <p class="text-sm text-sky-900 font-medium">

          Proposta de <strong>${selectedQuote.supplier?.name || "—"}</strong> (${total} ${selectedQuote.currency || "AOA"})

          registada no orçamento realizado. Pagamento ainda <strong>pendente</strong> — confirme ou rejeite a análise.

        </p>

      </div>

      <div class="flex items-center gap-2 shrink-0">

        <button type="button" id="btnRejectAnalysis"

          class="h-10 px-4 rounded-lg bg-white border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 transition-all">

          Rejeitar

        </button>

        <button type="button" id="btnApproveAnalysis"

          class="h-10 px-4 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-all flex items-center gap-2">

          <span class="material-symbols-outlined text-base">check_circle</span>

          Aprovar Análise

        </button>

      </div>

    </div>`;

  const panel = document.getElementById("quotePresentedPanel");

  panel?.insertBefore(banner, panel.firstChild);

}



function paymentTermBadge(supplier) {

  if (supplier?.paymentTerm === "CREDITO") {

    return `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">Crédito</span>`;

  }

  if (supplier?.paymentTerm === "PRONTO_PAGAMENTO") {

    return `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">PP</span>`;

  }

  return "";

}



function renderPriceRow({

  kind,

  supplierName,

  supplierBadges = "",

  productName = "",

  detailLine,

  totalHtml,

  fiscalBreakdownHtml = "",

  actionsHtml,

  highlighted = false,

}) {

  const kindBadge = kind === "suggestion"

    ? `<span class="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-blue-50 text-blue-700">Sugestão</span>`

    : `<span class="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-slate-100 text-slate-600">Cotação</span>`;



  return `

    <div class="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 ${highlighted ? "bg-[#2afc8d]/5 border-l-4 border-[#2afc8d]" : "hover:bg-slate-50"} transition-colors">

      <div class="flex-1 min-w-0">

        <div class="flex flex-wrap items-center gap-2 mb-1">

          ${kindBadge}

          <h4 class="font-bold text-slate-800 text-sm truncate">${supplierName}</h4>

          ${supplierBadges}

          ${productName ? `<span class="text-xs text-slate-400 font-medium truncate">${productName}</span>` : ""}

        </div>

        <div class="text-xs text-slate-500">${detailLine}</div>

        ${fiscalBreakdownHtml}

      </div>

      <div class="sm:text-right sm:w-44 shrink-0">${totalHtml}</div>

      <div class="flex flex-col gap-1.5 sm:w-40 shrink-0">${actionsHtml}</div>

    </div>`;

}



export async function loadPresentedPrices({

  needId,

  need,

  suppliers,

  apiRequest,

  openProformaViewer,

}) {

  const list = document.getElementById("quotesList");

  if (!list) return;

  list.innerHTML = `<div class="spinner mx-auto my-6"></div>`;



  const { isApproved, isInAnalysis, isOrdered, isLocked } = needWorkflowState(need);

  clearOrderedBanner();



  try {

    const [quotesData, suggestions] = await Promise.all([

      apiRequest(`/quotes/need/${needId}`),

      isLocked ? Promise.resolve([]) : fetchCatalogSuggestions(need.description, suppliers, apiRequest),

    ]);



    const quotes = dedupeQuotes(quotesData.items || []);
    const needMeta = { ...(need || {}), ...(quotesData.need || {}) };
    const allocation = quotesData.allocation || null;
    window.__quoteModalNeed = needMeta;
    window.__quoteModalAllocation = allocation;

    renderAllocationSummary(allocation, needMeta);
    updateQuoteQuantityHint(allocation, needMeta);
    loadSiteReceptionFields(needMeta);

    const selectedQuotes = quotes.filter((q) => q.selected);
    const selectedQuote = selectedQuotes[0] || null;
    window.__quoteModalSelectedQuote = selectedQuote;
    window.__quoteModalSelectedQuotes = selectedQuotes;

    if (isInAnalysis && selectedQuote) {

      renderInAnalysisBanner(selectedQuote, need);

      document.getElementById("btnApproveAnalysis")?.addEventListener("click", async () => {

        await approveNeedAnalysis({ needId, need, apiRequest, showToast: window.showQuoteToast, onApproved: window.onQuoteApproved, suppliers, openProformaViewer });

      });

      document.getElementById("btnRejectAnalysis")?.addEventListener("click", async () => {

        await rejectNeedAnalysis({ needId, need, apiRequest, showToast: window.showQuoteToast, onApproved: window.onQuoteApproved, suppliers, openProformaViewer });

      });

    } else if (isApproved && selectedQuote && !need.scheduled) {

      renderApprovedBanner(selectedQuote, need);

      document.getElementById("btnSendToFinance")?.addEventListener("click", async () => {

        await sendNeedToFinanceFromModal({ needId, need, ccId: need.costCenterId, apiRequest, showToast: window.showQuoteToast, onApproved: window.onQuoteApproved, suppliers, openProformaViewer });

      });

    } else if (!isLocked && selectedQuote && selectedQuotes.length === 1) {

      renderReadyToOrderBanner(selectedQuote);

      document.getElementById("btnCancelSelection")?.addEventListener("click", async () => {

        try {

          await apiRequest(`/quotes/${selectedQuote.id}/deselect`, { method: "PATCH" });

          window.showQuoteToast?.("Selecção cancelada", "info");

          await loadPresentedPrices({ needId, need, suppliers, apiRequest, openProformaViewer });

        } catch (err) {

          window.showQuoteToast?.("Erro: " + err.message, "error");

        }

      });

    }



    const quotedKeys = new Set(

      quotes.map((q) => `${q.supplierId}:${q.supplierProductId || ""}:${Number(q.quotedPrice)}`)

    );



    const filteredSuggestions = suggestions.filter((s) => {

      const key = `${s.supplier.id}:${s.product.id}:${Number(s.product.price)}`;

      return !quotedKeys.has(key);

    });



    if (!quotes.length && !filteredSuggestions.length) {

      renderAllocationSummary(allocation, needMeta);
      updateQuoteQuantityHint(allocation, needMeta);
      loadSiteReceptionFields(needMeta);

      list.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm font-medium">Nenhum preço apresentado. Adicione uma cotação ou aguarde sugestões do catálogo.</div>`;

      return;

    }



    const entries = [];



    quotes.forEach((q) => {

      const qty = Number(q.quantity ?? need.quantity ?? 1);

      const totalValue = Number(q.totalValue ?? qty * Number(q.quotedPrice || 0));

      const price = Number(q.quotedPrice).toLocaleString("pt-PT", { minimumFractionDigits: 2 });

      const displayQty = q.quantity ?? need.quantity ?? "—";
      const currency = q.currency || "AOA";
      const priceTotals = renderQuotePriceTotalsHtml(q.supplier, totalValue, currency, q.supplierProduct);



      const allocActions = buildQuoteAllocActions({ quote: q, need: needMeta, allocation, isLocked });

      let winnerBadge = "";

      if (q.selected && isApproved) {

        winnerBadge = `<span class="bg-[#2afc8d]/20 text-green-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest"><span class="material-symbols-outlined text-[10px] align-middle mr-1">verified</span>Aprovado</span>`;

      } else if (q.selected && need?.status === "EM_ANALISE") {

        winnerBadge = `<span class="bg-sky-100 text-sky-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest"><span class="material-symbols-outlined text-[10px] align-middle mr-1">fact_check</span>Em Análise</span>`;

      } else if (q.selected && isOrdered && !q.orderNumber) {

        winnerBadge = `<span class="bg-amber-100 text-amber-800 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest"><span class="material-symbols-outlined text-[10px] align-middle mr-1">local_shipping</span>Encomenda</span>`;

      } else if (q.selected) {

        winnerBadge = `<span class="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest"><span class="material-symbols-outlined text-[10px] align-middle mr-1">check_circle</span>Seleccionado</span>`;

      }



      const deleteBtn = !isLocked && !q.selected

        ? `<button type="button" data-delete-quote="${q.id}" class="text-slate-300 hover:text-red-500 transition-colors" title="Remover"><span class="material-symbols-outlined text-sm">close</span></button>`

        : "";

      const orderBtn =
        q.purchaseOrderUrl && q.orderNumber == null
          ? buildQuotePdfIcon(q)
          : "";

      entries.push({

        sortTotal: priceTotals.sortTotal,

        html: renderPriceRow({

          kind: "quote",

          supplierName: q.supplier?.name || "Fornecedor",

          supplierBadges: `${paymentTermBadge(q.supplier)} ${winnerBadge}`,

          productName: q.supplierProduct?.name ? `(${q.supplierProduct.name})` : "",

          detailLine: `${displayQty} uni × ${price} ${currency}`,

          totalHtml: priceTotals.totalHtml,

          fiscalBreakdownHtml: priceTotals.fiscalBreakdownHtml,

          highlighted: Boolean(q.selected),

          actionsHtml: `${allocActions}${orderBtn}${deleteBtn}`,

        }),

      });

    });



    filteredSuggestions.forEach((s) => {

      const suggestedQty =
        allocation?.remaining > 0
          ? allocation.remaining
          : Number(needMeta.quantity || need.quantity || 1);
      const qty = suggestedQty;
      const totalValue = Number(s.product.price) * qty;

      const price = Number(s.product.price).toLocaleString("pt-PT", { minimumFractionDigits: 2 });

      const currency = s.product.currency || "AOA";
      const priceTotals = renderQuotePriceTotalsHtml(s.supplier, totalValue, currency, s.product);
      const sugKey = `${s.supplier.id}|${s.product.id}|${s.product.price}|${currency}`;

      entries.push({

        sortTotal: priceTotals.sortTotal,

        html: renderPriceRow({

          kind: "suggestion",

          supplierName: s.supplier.name,

          supplierBadges: paymentTermBadge(s.supplier),

          productName: s.product.name,

          detailLine: `${qty} ${need.unit || "uni"} × ${price} ${currency} / ${s.product.unit || "uni"}`,

          totalHtml: priceTotals.totalHtml,

          fiscalBreakdownHtml: priceTotals.fiscalBreakdownHtml,

          actionsHtml: !isLocked
            ? `<div class="flex items-center gap-1.5">
                <input type="number" step="0.01" min="0.01" data-for-suggestion="${sugKey}" value="${qty}"
                  class="w-20 h-8 px-2 border border-slate-200 rounded-lg text-xs font-semibold text-center">
                <button type="button" data-select-suggestion="${sugKey}"
                  class="h-8 px-3 bg-blue-600 text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 transition-all whitespace-nowrap">Alocar</button>
              </div>`
            : "",

        }),

      });

    });



    entries.sort((a, b) => a.sortTotal - b.sortTotal);



    list.innerHTML = `<div class="flex flex-col divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">${entries.map((e) => e.html).join("")}</div>`;



    list.querySelectorAll("[data-place-order]").forEach((btn) => {

      btn.addEventListener("click", async (e) => {

        e.stopPropagation();

        const pendingCount = quotes.filter((q) => q.selected && !q.orderNumber).length;

        await placeOrderWithPdf(btn.dataset.placeOrder, needId, {

          apiRequest,

          showToast: window.showQuoteToast,

          onApproved: window.onQuoteApproved,

          need,

          suppliers,

          openProformaViewer,

          keepModalOpen: pendingCount > 1,

        });

      });

    });



    list.querySelectorAll("[data-select-quote]").forEach((btn) => {

      btn.addEventListener("click", async (e) => {

        e.stopPropagation();

        const qtyInput = list.querySelector(`[data-for-quote="${btn.dataset.selectQuote}"]`);
        const quantity = qtyInput ? Number(qtyInput.value) : undefined;

        await selectQuoteWithOrder(btn.dataset.selectQuote, needId, {

          apiRequest,

          showToast: window.showQuoteToast,

          onApproved: window.onQuoteApproved,

          openProformaViewer,

          need,

          suppliers,

          quantity,

        });

      });

    });

    list.querySelectorAll("[data-deselect-quote]").forEach((btn) => {

      btn.addEventListener("click", async (e) => {

        e.stopPropagation();

        await apiRequest(`/quotes/${btn.dataset.deselectQuote}/deselect`, { method: "PATCH" });

        window.showQuoteToast?.("Alocação removida", "success");

        await loadPresentedPrices({ needId, need, suppliers, apiRequest, openProformaViewer });

        window.onQuoteApproved?.();

      });

    });

    list.querySelectorAll("[data-update-quote-qty]").forEach((input) => {

      let timer;

      input.addEventListener("change", async () => {

        clearTimeout(timer);

        timer = setTimeout(async () => {

          const qty = Number(input.value);

          if (!Number.isFinite(qty) || qty <= 0) return;

          try {

            await apiRequest(`/quotes/${input.dataset.updateQuoteQty}/quantity`, {

              method: "PATCH",

              body: { quantity: qty },

            });

            await loadPresentedPrices({ needId, need, suppliers, apiRequest, openProformaViewer });

            window.onQuoteApproved?.();

          } catch (err) {

            window.showQuoteToast?.("Erro: " + err.message, "error");

          }

        }, 400);

      });

    });



    list.querySelectorAll("[data-delete-quote]").forEach((btn) => {

      btn.addEventListener("click", async (e) => {

        e.stopPropagation();

        if (!confirm("Remover esta cotação?")) return;

        await apiRequest(`/quotes/${btn.dataset.deleteQuote}`, { method: "DELETE" });

        window.showQuoteToast?.("Cotação removida", "success");

        await loadPresentedPrices({ needId, need, suppliers, apiRequest, openProformaViewer });

        window.onQuoteApproved?.();

      });

    });



    list.querySelectorAll("[data-view-proforma]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openProformaViewer?.(btn.dataset.viewProforma);
      });
    });

    list.querySelectorAll("[data-proforma-input]").forEach((input) => {
      input.addEventListener("change", async () => {
        if (!input.files?.[0]) return;
        const quoteId = input.dataset.proformaInput;
        const quoteRow = quotes.find((q) => q.id === quoteId);
        await uploadOrderedProforma({
          quoteId,
          quote: quoteRow,
          needId,
          need: needMeta,
          suppliers,
          apiRequest,
          openProformaViewer,
          showToast: window.showQuoteToast,
          onApproved: window.onQuoteApproved,
          fileInput: input,
          keepModalOpen: true,
        });
      });
    });

    list.querySelectorAll("[data-select-suggestion]").forEach((btn) => {

      btn.addEventListener("click", async (e) => {

        e.stopPropagation();

        const [supplierId, productId, price, currency] = btn.dataset.selectSuggestion.split("|");

        const qtyInput = list.querySelector(`[data-for-suggestion="${btn.dataset.selectSuggestion}"]`);

        const quantity = qtyInput ? Number(qtyInput.value) : undefined;

        await selectSuggestionWithOrder({

          needId,

          need,

          supplierId,

          productId,

          price,

          currency,

          quantity,

          apiRequest,

          showToast: window.showQuoteToast,

          onApproved: window.onQuoteApproved,

          suppliers,

          openProformaViewer,

        });

      });

    });

  } catch (err) {

    list.innerHTML = `<div class="p-6 text-red-500 text-sm">Erro: ${err.message}</div>`;

  }

}



async function sendNeedToFinanceFromModal({ needId, need, ccId, apiRequest, showToast, onApproved, suppliers, openProformaViewer }) {
  if (!confirm("Enviar este item ao financeiro para agendamento de pagamento?")) return;
  try {
    await apiRequest(`/cost-centers/${ccId}/needs/${needId}/send-to-finance`, { method: "POST" });
    showToast?.("Item enviado ao financeiro.", "success");
    window.__quoteModalNeed = { ...need, scheduled: true };
    await onApproved?.();
    document.getElementById("modalQuote")?.classList.remove("open");
  } catch (err) {
    showToast?.("Erro: " + err.message, "error");
  }
}

async function approveNeedAnalysis({ needId, need, apiRequest, showToast, onApproved, suppliers, openProformaViewer }) {
  if (need?.status === "APPROVED") {
    showToast?.("Análise já aprovada — pode enviar ao financeiro.", "info");
    return;
  }
  if (need?.status !== "EM_ANALISE") {
    showToast?.("Este item não está em análise.", "error");
    return;
  }
  if (!confirm("Confirmar aprovação desta análise? O item ficará pronto para envio ao financeiro (pagamento continua pendente).")) return;
  try {
    const result = await apiRequest(`/quotes/need/${needId}/approve-analysis`, { method: "PATCH" });
    const updated = { ...need, ...result.need, status: result.need?.status || "APPROVED" };
    showToast?.("Análise aprovada — item pronto para envio ao financeiro.", "success");
    window.__quoteModalNeed = updated;
    await onApproved?.();
    await loadPresentedPrices({
      needId,
      need: updated,
      suppliers,
      apiRequest,
      openProformaViewer,
    });
  } catch (err) {
    showToast?.("Erro: " + err.message, "error");
  }
}

async function rejectNeedAnalysis({ needId, need, apiRequest, showToast, onApproved, suppliers, openProformaViewer }) {
  const reason = prompt("Motivo da rejeição (opcional):") || "";
  if (reason === null) return;
  try {
    const result = await apiRequest(`/quotes/need/${needId}/reject-analysis`, {
      method: "PATCH",
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    });
    showToast?.("Análise rejeitada — item voltou a cotação.", "info");
    window.__quoteModalNeed = { ...need, ...result.need, status: "IN_QUOTATION" };
    await onApproved?.();
    await loadPresentedPrices({
      needId,
      need: { ...need, ...result.need, status: "IN_QUOTATION" },
      suppliers,
      apiRequest,
      openProformaViewer,
    });
  } catch (err) {
    showToast?.("Erro: " + err.message, "error");
  }
}

async function uploadOrderedProforma({
  quoteId,
  quote,
  needId,
  need,
  suppliers,
  apiRequest,
  openProformaViewer,
  showToast,
  onApproved,
  fileInput,
  keepModalOpen = true,
}) {
  const input = fileInput || document.getElementById("orderedProformaInput");
  if (!input?.files?.[0]) {
    showToast?.("Seleccione o ficheiro da proposta.", "error");
    return;
  }

  try {
    const form = new FormData();
    form.append("proforma", input.files[0]);

    const previsto = Number(need?.originalUnitPrice ?? need?.unitPrice ?? need?.previstoUnitPrice) || 0;
    const quoteForPrice =
      quote ||
      window.__quoteModalSelectedQuotes?.find((q) => q.id === quoteId) ||
      window.__quoteModalSelectedQuote;
    const real = Number(quoteForPrice?.quotedPrice) || 0;
    if (real > previsto + 0.000001) {
      const reason = prompt(
        `O preço da cotação (${real.toLocaleString("pt-PT")}) excede o previsto (${previsto.toLocaleString("pt-PT")}).\n\nIndique a justificação da excepção:`
      );
      if (!reason?.trim()) {
        showToast?.("Submissão cancelada — é obrigatória uma justificação quando o preço excede o previsto.", "error");
        return;
      }
      form.append("priceExceptionReason", reason.trim());
    }

    const result = await apiUpload(`/quotes/${quoteId}/proforma`, form, "POST");
    input.value = "";

    const updatedNeed = result.need ? { ...need, ...result.need } : need;
    const selectedQuotes = window.__quoteModalSelectedQuotes || [];
    const allHaveProforma =
      selectedQuotes.length > 0 &&
      selectedQuotes.every((q) => (q.id === quoteId ? true : Boolean(q.proformaUrl)));
    const wentToAnalysis = result.need?.status === "EM_ANALISE";

    showToast?.(
      wentToAnalysis
        ? "Proformas completas — item em análise. O financeiro consultará estes documentos."
        : "Proforma carregada — documento disponível para o financeiro.",
      "success"
    );

    if (result.need) {
      window.__quoteModalNeed = updatedNeed;
    }

    if (result.quote?.proformaUrl) {
      setTimeout(() => {
        if (confirm("Proforma carregada com sucesso. Deseja visualizar agora?")) {
          openProformaViewer?.(getAssetUrl(result.quote.proformaUrl));
        }
      }, 200);
    }

    const shouldKeepOpen = keepModalOpen || !allHaveProforma || !wentToAnalysis;
    if (shouldKeepOpen) {
      await loadPresentedPrices({
        needId,
        need: updatedNeed,
        suppliers,
        apiRequest,
        openProformaViewer,
      });
      await onApproved?.();
    } else {
      document.getElementById("modalQuote")?.classList.remove("open");
      await onApproved?.();
    }
  } catch (err) {
    showToast?.("Erro: " + err.message, "error");
  }
}

export async function selectSuggestionWithOrder({

  needId,

  need,

  supplierId,

  productId,

  price,

  currency,

  quantity,

  apiRequest,

  showToast,

  onApproved,

  suppliers,

  openProformaViewer,

}) {

  try {
    const quotesData = await apiRequest(`/quotes/need/${needId}`);
    const existing = (quotesData.items || []).find(
      (q) =>
        q.supplierId === supplierId &&
        q.supplierProductId === productId &&
        Number(q.quotedPrice) === Number(price)
    );

    let quoteId = existing?.id;
    if (!quoteId) {
      const form = new FormData();
      form.append("supplierId", supplierId);
      form.append("supplierProductId", productId);
      form.append("quotedPrice", price);
      const qty = quantity ?? need.quantity;
      if (qty) form.append("quantity", String(qty));
      form.append("currency", currency);
      const created = await apiUpload(`/quotes/need/${needId}`, form, "POST");
      quoteId = created.id;
    }

    await selectQuoteWithOrder(quoteId, needId, {

      apiRequest,

      showToast,

      onApproved,

      openProformaViewer,

      need,

      suppliers,

      skipConfirm: true,

      quantity,

    });

  } catch (err) {

    showToast?.("Erro: " + err.message, "error");

  }

}



// Marca apenas o fornecedor vencedor da cotação. Não gera PDF nem avança
// o estado do item — isso só acontece em placeOrderWithPdf(), quando o
// utilizador confirma explicitamente a encomenda.
export async function selectQuoteWithOrder(quoteId, needId, { apiRequest, showToast, onApproved, openProformaViewer, need, suppliers = [], skipConfirm = false, quantity }) {

  if (!quoteId) return;

  if (!skipConfirm && !confirm("Alocar quantidade deste fornecedor ao item? Pode adicionar outros fornecedores para o remanescente.")) return;



  try {

    const body = quantity != null && Number.isFinite(Number(quantity)) ? { quantity: Number(quantity) } : {};

    await apiRequest(`/quotes/${quoteId}/select`, { method: "PATCH", body });



    showToast?.("Fornecedor alocado. Ajuste quantidades ou confirme a encomenda.", "success");



    await loadPresentedPrices({ needId, need, suppliers, apiRequest, openProformaViewer });

    await onApproved?.();

  } catch (err) {

    showToast?.("Erro: " + err.message, "error");

  }

}



// Confirma a encomenda ao fornecedor já seleccionado: atribui o número de
// encomenda, gera o PDF, faz upload e só então o item passa a "Encomenda".
export async function placeOrderWithPdf(quoteId, needId, { apiRequest, showToast, onApproved, need, suppliers = [], openProformaViewer, keepModalOpen = false }) {

  if (!quoteId) return;

  const confirmMsg = keepModalOpen
    ? "Confirmar encomenda a este fornecedor? Será gerado o PDF. Pode encomendar os restantes fornecedores a seguir."
    : "Confirmar encomenda a este fornecedor? Será gerado o PDF e o item passará a 'Encomenda' quando todos estiverem encomendados.";

  if (!confirm(confirmMsg)) return;



  try {

    const siteDate = getSiteReceptionDateStr();
    const orderBody = siteDate
      ? { expectedReceiptDate: dateInputToUtcNoonIso(siteDate) }
      : {};

    const result = await apiRequest(`/quotes/${quoteId}/place-order`, { method: "PATCH", body: orderBody });

    const quote = result.quote;

    const needData = result.need || need;

    const supplier = quote.supplier;

    const project = needData.project || quote.need?.project;



    const { doc, orderNo, documentId, issuedAt, issuedBy } = await generatePurchaseOrderPdf({

      quote,

      need: needData,

      supplier,

      project,

    });



    downloadPurchaseOrderPdf(doc, orderNo);



    try {

      await uploadPurchaseOrderPdf(quoteId, doc, orderNo, { documentId, issuedAt, issuedBy });

    } catch (uploadErr) {

      console.warn("Upload da encomenda falhou:", uploadErr);

    }



    showToast?.(
      keepModalOpen
        ? "Encomenda gerada. Encomende os restantes fornecedores ou carregue as proformas."
        : "Encomenda gerada — carregue a proforma para aprovar no orçamento.",
      "success"
    );

    if (keepModalOpen) {
      await loadPresentedPrices({ needId, need, suppliers, apiRequest, openProformaViewer });
      window.onQuoteApproved?.();
    } else {
      document.getElementById("modalQuote")?.classList.remove("open");
      await onApproved?.();
    }

  } catch (err) {

    showToast?.("Erro: " + err.message, "error");

  }

}



export async function openQuotePricingModal({
  need,
  suppliers,
  apiRequest,
  openProformaViewer,
  showToast,
}) {
  if (!need) return;

  if (need.status === "PAID") {
    showToast?.("Item pago — cotação bloqueada.", { type: "info" });
    return;
  }



  window.__quoteModalNeed = need;

  document.getElementById("quoteNeedId").value = need.id;

  document.getElementById("quoteItemDesc").textContent = `${need.description} (${need.quantity || "0"} ${need.unit || ""})`;



  const { isApproved, isOrdered } = needWorkflowState(need);

  const modalTitle = document.querySelector("#modalQuote h2");

  if (modalTitle) {

    if (isOrdered) modalTitle.textContent = "Encomenda — Aguarda Proforma";

    else if (isApproved) modalTitle.textContent = "Cotação Aprovada";

    else modalTitle.textContent = "Precificar Item";

  }



  const sel = document.getElementById("quoteSupplier");

  if (sel) {

    sel.innerHTML = `<option value="">Selecionar...</option>` +

      suppliers.map((s) => {

        const termStr = s.paymentTerm === "CREDITO" ? " (Crédito)" : s.paymentTerm === "PRONTO_PAGAMENTO" ? " (PP)" : "";

        return `<option value="${s.id}">${s.name}${termStr}</option>`;

      }).join("");

  }



  document.getElementById("quotePrice").value = "";

  document.getElementById("quoteQuantity").value = need.quantity || "";

  wireQuoteSiteReception({ need, apiRequest, showToast });

  const proformaInput = document.getElementById("quoteProforma");

  if (proformaInput) proformaInput.value = "";

  document.getElementById("quoteProductRow").style.display = "none";

  document.getElementById("quoteSupplierProduct").innerHTML = `<option value="">Selecionar produto...</option>`;



  const supplierSel = document.getElementById("quoteSupplier");

  supplierSel.onchange = async function () {

    const sid = this.value;

    const productRow = document.getElementById("quoteProductRow");

    const productSel = document.getElementById("quoteSupplierProduct");

    productSel.innerHTML = `<option value="">Selecionar produto...</option>`;

    document.getElementById("quotePrice").value = "";

    if (!sid) {

      productRow.style.display = "none";

      return;

    }

    try {

      const data = await apiRequest(`/suppliers/${sid}/products`);

      const products = data.items || [];

      if (products.length > 0) {

        productRow.style.display = "block";

        productSel.innerHTML = `<option value="">Selecionar produto...</option>` +

          products.map((p) => `<option value="${p.id}" data-price="${p.price}" data-currency="${p.currency}">${p.name} — ${Number(p.price).toLocaleString("pt-PT")} ${p.currency} / ${p.unit || "uni"}</option>`).join("");

        productSel.onchange = function () {

          const opt = this.options[this.selectedIndex];

          if (opt.value) {

            document.getElementById("quotePrice").value = opt.dataset.price;

            document.getElementById("quoteCurrency").value = opt.dataset.currency;

          }

        };

      } else {

        productRow.style.display = "none";

      }

    } catch {

      productRow.style.display = "none";

    }

  };



  document.getElementById("modalQuote").classList.add("open");

  wireQuoteNewToggle(need);



  await loadPresentedPrices({

    needId: need.id,

    need,

    suppliers,

    apiRequest,

    openProformaViewer,

  });

}



export async function submitQuoteForm(e, { apiRequest, apiUpload, showToast, suppliers, openProformaViewer }) {

  e.preventDefault();

  const needId = document.getElementById("quoteNeedId").value;

  const need = window.__quoteModalNeed || { id: needId };

  const { isLocked } = needWorkflowState(need);

  if (isLocked) {

    showToast?.("Item em encomenda ou já aprovado — não é possível adicionar novas cotações.", "error");

    return;

  }



  const spId = document.getElementById("quoteSupplierProduct")?.value || null;



  const form = new FormData();

  form.append("supplierId", document.getElementById("quoteSupplier").value);

  if (spId) form.append("supplierProductId", spId);

  form.append("quotedPrice", document.getElementById("quotePrice").value);

  const qty = document.getElementById("quoteQuantity").value;

  if (qty) form.append("quantity", qty);

  form.append("currency", document.getElementById("quoteCurrency").value);



  const proformaInput = document.getElementById("quoteProforma");

  if (proformaInput?.files[0]) form.append("proforma", proformaInput.files[0]);



  try {

    await apiUpload(`/quotes/need/${needId}`, form, "POST");

    showToast?.("Preço adicionado à lista", "success");

    document.getElementById("quotePrice").value = "";

    document.getElementById("quoteSupplierProduct").innerHTML = `<option value="">Selecionar produto...</option>`;

    document.getElementById("quoteProductRow").style.display = "none";

    document.getElementById("quoteSupplier").value = "";

    if (proformaInput) proformaInput.value = "";

    setQuoteNewPanelVisible(false);



    await loadPresentedPrices({

      needId,

      need,

      suppliers,

      apiRequest,

      openProformaViewer,

    });

    window.onQuoteApproved?.();

  } catch (err) {

    showToast?.("Erro: " + err.message, "error");

  }

}


