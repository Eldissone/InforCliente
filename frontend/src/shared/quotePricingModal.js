import { apiUpload, getAssetUrl } from "../services/api.js";
import { renderSupplierFiscalBreakdownHtml } from "./supplierFiscal.js";

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

function dedupeQuotes(quotes) {
  const map = new Map();
  for (const q of quotes) {
    const key = `${q.supplierId}:${q.supplierProductId || ""}:${Number(q.quotedPrice)}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, q);
      continue;
    }
    if (q.selected && !existing.selected) {
      map.set(key, q);
      continue;
    }
    if (!q.selected && existing.selected) continue;
    const qTime = new Date(q.createdAt || 0).getTime();
    const eTime = new Date(existing.createdAt || 0).getTime();
    if (qTime >= eTime) map.set(key, q);
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

          Carregue a proposta/proforma para submeter o item à análise (preço realizado, pagamento pendente).

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



  const total = Number(selectedQuote.totalValue ?? selectedQuote.quotedPrice ?? 0)
    .toLocaleString("pt-PT", { minimumFractionDigits: 2 });



  const banner = document.createElement("div");

  banner.id = "quoteReadyBanner";

  banner.className = "mb-4 p-4 rounded-xl border border-[#2afc8d]/40 bg-[#2afc8d]/10";

  banner.innerHTML = `

    <div class="flex flex-col sm:flex-row sm:items-center gap-3">

      <div class="flex-1">

        <p class="text-xs font-black uppercase tracking-widest text-emerald-700 mb-1">Fornecedor seleccionado</p>

        <p class="text-sm text-slate-700 font-medium">

          <strong>${selectedQuote.supplier?.name || "—"}</strong> — ${total} ${selectedQuote.currency || "AOA"}.

          Pode trocar de fornecedor, submeter proposta ou confirmar encomenda.

        </p>

      </div>

      <div class="flex flex-col gap-2 shrink-0 sm:min-w-[280px]">

        <input type="file" id="readyProposalInput" accept="image/*,.pdf"

          class="w-full h-10 px-3 bg-white border border-emerald-200 rounded-lg text-xs font-semibold file:mr-3 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-emerald-100 file:text-emerald-800">

        <button type="button" id="btnSubmitProposal"

          class="h-10 w-full rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition-all flex items-center justify-center gap-2">

          <span class="material-symbols-outlined text-base">upload_file</span>

          Submeter Proposta p/ Análise

        </button>

        <div class="flex items-center gap-2">

        <button type="button" id="btnCancelSelection"

          class="h-10 px-4 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all">

          Cancelar Selecção

        </button>

        <button type="button" id="btnPlaceOrder"

          class="h-10 px-4 rounded-lg bg-[#0f172a] text-white text-xs font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2 whitespace-nowrap">

          <span class="material-symbols-outlined text-base">local_shipping</span>

          Encomendar

        </button>

        </div>

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

  document.getElementById("quoteInvoiceBanner")?.remove();

  document.getElementById("quoteCreditInfo")?.remove();

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



// Fornecedor a Crédito: só depois de confirmar a fatura o prazo começa a
// contar e o plano de parcelas é gerado automaticamente (ver Fase 3 do plano).
function renderInvoiceConfirmationBanner(selectedQuote) {

  const existing = document.getElementById("quoteInvoiceBanner");

  if (existing) existing.remove();

  if (!selectedQuote) return;



  const banner = document.createElement("div");

  banner.id = "quoteInvoiceBanner";

  banner.className = "mb-4 p-4 rounded-xl border border-sky-200 bg-sky-50";

  banner.innerHTML = `

    <p class="text-xs font-black uppercase tracking-widest text-sky-700 mb-2">Fornecedor a Crédito — Confirmar Fatura</p>

    <p class="text-xs text-sky-900 mb-3">O prazo de crédito só começa a contar após a confirmação da fatura. Ao confirmar, o plano de parcelas é gerado automaticamente.</p>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">

      <label class="text-[10px] font-bold text-sky-800 uppercase block">

        Prazo de crédito (dias)

        <input type="number" min="0" id="invoiceCreditTermDays" placeholder="Ex: 30"

          class="mt-1 w-full h-9 px-2 bg-white border border-sky-200 rounded-lg text-xs font-semibold text-slate-800">

      </label>

      <label class="text-[10px] font-bold text-sky-800 uppercase block">

        Receção prevista do material

        <input type="date" id="invoiceExpectedReceiptDate" required

          class="mt-1 w-full h-9 px-2 bg-white border border-sky-200 rounded-lg text-xs font-semibold text-slate-800">

      </label>

      <label class="text-[10px] font-bold text-sky-800 uppercase block">

        Nº de parcelas

        <input type="number" min="1" max="60" value="1" id="invoiceInstallmentsCount"

          class="mt-1 w-full h-9 px-2 bg-white border border-sky-200 rounded-lg text-xs font-semibold text-slate-800">

      </label>

    </div>

    <button type="button" id="btnConfirmInvoice"

      class="h-9 px-4 rounded-lg bg-sky-700 text-white text-xs font-bold hover:bg-sky-800 transition-all flex items-center justify-center gap-2">

      <span class="material-symbols-outlined text-base">fact_check</span>

      Confirmar Fatura

    </button>`;



  const panel = document.getElementById("quotePresentedPanel");

  panel?.insertBefore(banner, panel.firstChild);

}



function renderCreditScheduleInfo(selectedQuote) {

  const existing = document.getElementById("quoteCreditInfo");

  if (existing) existing.remove();

  if (!selectedQuote?.invoiceConfirmedAt) return;



  const confirmedDate = new Date(selectedQuote.invoiceConfirmedAt).toLocaleDateString("pt-PT");

  const receiptDate = selectedQuote.expectedReceiptDate

    ? new Date(selectedQuote.expectedReceiptDate).toLocaleDateString("pt-PT")

    : "—";



  const banner = document.createElement("div");

  banner.id = "quoteCreditInfo";

  banner.className = "mb-4 p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-600";

  banner.innerHTML = `

    <span class="material-symbols-outlined text-sm align-middle mr-1 text-emerald-600">verified</span>

    Fatura confirmada em <strong>${confirmedDate}</strong> por <strong>${selectedQuote.invoiceConfirmedBy || "—"}</strong>.

    Receção prevista: <strong>${receiptDate}</strong> · Plano gerado em <strong>${selectedQuote.installmentsPlanned || 1}</strong> parcela(s).`;



  const panel = document.getElementById("quotePresentedPanel");

  panel?.insertBefore(banner, panel.firstChild);

}



async function confirmInvoiceAction(quoteId, needId, ctx) {

  const { apiRequest, showToast, onApproved, need, suppliers, openProformaViewer } = ctx;

  const creditTermDaysRaw = document.getElementById("invoiceCreditTermDays")?.value;

  const expectedReceiptDate = document.getElementById("invoiceExpectedReceiptDate")?.value;

  const installmentsCount = document.getElementById("invoiceInstallmentsCount")?.value || "1";



  if (!expectedReceiptDate) {

    showToast?.("Indique a data prevista de receção do material.", "error");

    return;

  }

  if (!confirm(`Confirmar a fatura? Será gerado um plano de ${installmentsCount} parcela(s) a partir de ${expectedReceiptDate}.`)) return;



  try {

    await apiRequest(`/quotes/${quoteId}/confirm-invoice`, {

      method: "PATCH",

      body: {

        creditTermDays: creditTermDaysRaw ? Number(creditTermDaysRaw) : null,

        expectedReceiptDate: new Date(expectedReceiptDate).toISOString(),

        installmentsCount: Number(installmentsCount),

      },

    });

    showToast?.("Fatura confirmada — plano de pagamento gerado automaticamente.", "success");

    await loadPresentedPrices({ needId, need, suppliers, apiRequest, openProformaViewer });

    onApproved?.();

  } catch (err) {

    showToast?.("Erro: " + err.message, "error");

  }

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

  totalLine,

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

      <div class="text-sm font-black text-slate-900 sm:text-right sm:w-36">${totalLine}</div>

      <div class="flex items-center gap-2 sm:w-48 sm:justify-end">${actionsHtml}</div>

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

    const selectedQuote = quotes.find((q) => q.selected) || null;
    window.__quoteModalSelectedQuote = selectedQuote;



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

    } else if (isOrdered && selectedQuote && !selectedQuote.proformaUrl) {

      renderOrderedBanner(selectedQuote);

      document.getElementById("btnUploadOrderedProforma")?.addEventListener("click", async () => {

        await uploadOrderedProforma({

          quoteId: selectedQuote.id,

          needId,

          need,

          suppliers,

          apiRequest,

          openProformaViewer,

          showToast: window.showQuoteToast,

          onApproved: window.onQuoteApproved,

        });

      });

    } else if (!isLocked && selectedQuote) {

      renderReadyToOrderBanner(selectedQuote);

      document.getElementById("btnSubmitProposal")?.addEventListener("click", async () => {

        const input = document.getElementById("readyProposalInput");

        if (!input?.files?.[0]) {

          window.showQuoteToast?.("Seleccione o ficheiro da proposta.", "error");

          return;

        }

        await uploadOrderedProforma({

          quoteId: selectedQuote.id,

          needId,

          need,

          suppliers,

          apiRequest,

          openProformaViewer,

          showToast: window.showQuoteToast,

          onApproved: window.onQuoteApproved,

          fileInput: input,

        });

      });

      document.getElementById("btnPlaceOrder")?.addEventListener("click", async () => {

        await placeOrderWithPdf(selectedQuote.id, needId, {

          apiRequest,

          showToast: window.showQuoteToast,

          onApproved: window.onQuoteApproved,

          need,

        });

      });

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



    const isCreditSupplier = selectedQuote?.supplier?.paymentTerm === "CREDITO";

    if (selectedQuote && (isOrdered || isApproved) && isCreditSupplier) {

      if (!selectedQuote.invoiceConfirmedAt) {

        renderInvoiceConfirmationBanner(selectedQuote);

        document.getElementById("btnConfirmInvoice")?.addEventListener("click", () => {

          confirmInvoiceAction(selectedQuote.id, needId, {

            apiRequest,

            showToast: window.showQuoteToast,

            onApproved: window.onQuoteApproved,

            need,

            suppliers,

            openProformaViewer,

          });

        });

      } else {

        renderCreditScheduleInfo(selectedQuote);

      }

    }



    const quotedKeys = new Set(

      quotes.map((q) => `${q.supplierId}:${q.supplierProductId || ""}:${Number(q.quotedPrice)}`)

    );



    const filteredSuggestions = suggestions.filter((s) => {

      const key = `${s.supplier.id}:${s.product.id}:${Number(s.product.price)}`;

      return !quotedKeys.has(key);

    });



    if (!quotes.length && !filteredSuggestions.length) {

      list.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm font-medium">Nenhum preço apresentado. Adicione uma cotação ou aguarde sugestões do catálogo.</div>`;

      return;

    }



    const entries = [];



    quotes.forEach((q) => {

      const qty = Number(q.quantity ?? need.quantity ?? 1);

      const totalValue = Number(q.totalValue ?? qty * Number(q.quotedPrice || 0));

      const price = Number(q.quotedPrice).toLocaleString("pt-PT", { minimumFractionDigits: 2 });

      const total = totalValue.toLocaleString("pt-PT", { minimumFractionDigits: 2 });

      const displayQty = q.quantity ?? need.quantity ?? "—";



      const selectBtn = !isLocked && !q.selected

        ? `<button type="button" data-select-quote="${q.id}" class="h-8 px-3 bg-[#0f172a] text-white text-[10px] font-bold rounded-lg hover:bg-[#2afc8d] hover:text-[#0f172a] transition-all whitespace-nowrap">Selecionar Fornecedor</button>`

        : "";



      let winnerBadge = "";

      if (q.selected && isApproved) {

        winnerBadge = `<span class="bg-[#2afc8d]/20 text-green-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest"><span class="material-symbols-outlined text-[10px] align-middle mr-1">verified</span>Aprovado</span>`;

      } else if (q.selected && need?.status === "EM_ANALISE") {

        winnerBadge = `<span class="bg-sky-100 text-sky-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest"><span class="material-symbols-outlined text-[10px] align-middle mr-1">fact_check</span>Em Análise</span>`;

      } else if (q.selected && isOrdered) {

        winnerBadge = `<span class="bg-amber-100 text-amber-800 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest"><span class="material-symbols-outlined text-[10px] align-middle mr-1">local_shipping</span>Encomenda</span>`;

      } else if (q.selected) {

        winnerBadge = `<span class="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest"><span class="material-symbols-outlined text-[10px] align-middle mr-1">check_circle</span>Seleccionado</span>`;

      }



      const deleteBtn = !isLocked && !q.selected

        ? `<button type="button" data-delete-quote="${q.id}" class="text-slate-300 hover:text-red-500 transition-colors" title="Remover"><span class="material-symbols-outlined text-sm">close</span></button>`

        : "";



      const proformaBtn = q.proformaUrl

        ? `<button type="button" data-view-proforma="${getAssetUrl(q.proformaUrl)}" class="text-blue-500 hover:text-blue-700 transition-colors" title="Ver Proforma"><span class="material-symbols-outlined text-sm">description</span></button>`

        : "";



      const orderBtn = q.purchaseOrderUrl

        ? `<a href="${getAssetUrl(q.purchaseOrderUrl)}" target="_blank" class="text-emerald-600 hover:text-emerald-800 transition-colors" title="PDF Encomenda"><span class="material-symbols-outlined text-sm">picture_as_pdf</span></a>`

        : "";



      entries.push({

        sortTotal: totalValue,

        html: renderPriceRow({

          kind: "quote",

          supplierName: q.supplier?.name || "Fornecedor",

          supplierBadges: `${paymentTermBadge(q.supplier)} ${winnerBadge}`,

          productName: q.supplierProduct?.name ? `(${q.supplierProduct.name})` : "",

          detailLine: `${displayQty} uni × ${price} ${q.currency}`,

          totalLine: `${total} ${q.currency}`,

          fiscalBreakdownHtml: renderSupplierFiscalBreakdownHtml(q.supplier, totalValue, q.currency || "AOA"),

          highlighted: Boolean(q.selected),

          actionsHtml: `${selectBtn}${proformaBtn}${orderBtn}${deleteBtn}`,

        }),

      });

    });



    filteredSuggestions.forEach((s) => {

      const qty = Number(need.quantity || 1);

      const totalValue = Number(s.product.price) * qty;

      const price = Number(s.product.price).toLocaleString("pt-PT", { minimumFractionDigits: 2 });

      const total = totalValue.toLocaleString("pt-PT", { minimumFractionDigits: 2 });



      entries.push({

        sortTotal: totalValue,

        html: renderPriceRow({

          kind: "suggestion",

          supplierName: s.supplier.name,

          supplierBadges: paymentTermBadge(s.supplier),

          productName: s.product.name,

          detailLine: `${qty} ${need.unit || "uni"} × ${price} ${s.product.currency} / ${s.product.unit || "uni"}`,

          totalLine: `${total} ${s.product.currency}`,

          fiscalBreakdownHtml: renderSupplierFiscalBreakdownHtml(s.supplier, totalValue, s.product.currency || "AOA"),

          actionsHtml: !isLocked

            ? `<button type="button" data-select-suggestion="${s.supplier.id}|${s.product.id}|${s.product.price}|${s.product.currency}" class="h-8 px-3 bg-blue-600 text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 transition-all whitespace-nowrap">Selecionar Fornecedor</button>`

            : "",

        }),

      });

    });



    entries.sort((a, b) => a.sortTotal - b.sortTotal);



    list.innerHTML = `<div class="flex flex-col divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">${entries.map((e) => e.html).join("")}</div>`;



    list.querySelectorAll("[data-select-quote]").forEach((btn) => {

      btn.addEventListener("click", async (e) => {

        e.stopPropagation();

        await selectQuoteWithOrder(btn.dataset.selectQuote, needId, {

          apiRequest,

          showToast: window.showQuoteToast,

          onApproved: window.onQuoteApproved,

          openProformaViewer,

          need,

          suppliers,

        });

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



    list.querySelectorAll("[data-select-suggestion]").forEach((btn) => {

      btn.addEventListener("click", async (e) => {

        e.stopPropagation();

        const [supplierId, productId, price, currency] = btn.dataset.selectSuggestion.split("|");

        await selectSuggestionWithOrder({

          needId,

          need,

          supplierId,

          productId,

          price,

          currency,

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

  needId,

  need,

  suppliers,

  apiRequest,

  openProformaViewer,

  showToast,

  onApproved,

  fileInput,

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
    const selectedQuote = window.__quoteModalSelectedQuote;
    const real = Number(selectedQuote?.quotedPrice) || 0;
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



    showToast?.("Proposta submetida — item em análise (realizado registado, pagamento pendente).", "success");



    if (result.need) {

      window.__quoteModalNeed = { ...need, ...result.need, status: "EM_ANALISE" };

    }



    if (result.quote?.proformaUrl) {

      setTimeout(() => {

        if (confirm("Proforma carregada com sucesso. Deseja visualizar agora?")) {

          openProformaViewer?.(getAssetUrl(result.quote.proformaUrl));

        }

      }, 200);

    }



    document.getElementById("modalQuote")?.classList.remove("open");

    await onApproved?.();

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
      if (need.quantity) form.append("quantity", String(need.quantity));
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

    });

  } catch (err) {

    showToast?.("Erro: " + err.message, "error");

  }

}



// Marca apenas o fornecedor vencedor da cotação. Não gera PDF nem avança
// o estado do item — isso só acontece em placeOrderWithPdf(), quando o
// utilizador confirma explicitamente a encomenda.
export async function selectQuoteWithOrder(quoteId, needId, { apiRequest, showToast, onApproved, openProformaViewer, need, suppliers = [], skipConfirm = false }) {

  if (!quoteId) return;

  if (!skipConfirm && !confirm("Selecionar este fornecedor para o item? Pode confirmar a encomenda a seguir.")) return;



  try {

    await apiRequest(`/quotes/${quoteId}/select`, { method: "PATCH" });



    showToast?.("Fornecedor seleccionado. Confirme para gerar a encomenda.", "success");



    await loadPresentedPrices({ needId, need, suppliers, apiRequest, openProformaViewer });

    await onApproved?.();

  } catch (err) {

    showToast?.("Erro: " + err.message, "error");

  }

}



// Confirma a encomenda ao fornecedor já seleccionado: atribui o número de
// encomenda, gera o PDF, faz upload e só então o item passa a "Encomenda".
export async function placeOrderWithPdf(quoteId, needId, { apiRequest, showToast, onApproved, need }) {

  if (!quoteId) return;

  if (!confirm("Confirmar encomenda a este fornecedor? Será gerado o PDF e o item passará a 'Encomenda' até carregar a proforma.")) return;



  try {

    const result = await apiRequest(`/quotes/${quoteId}/place-order`, { method: "PATCH" });

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



    showToast?.("Encomenda gerada — carregue a proforma para aprovar no orçamento.", "success");

    document.getElementById("modalQuote")?.classList.remove("open");



    await onApproved?.();

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


