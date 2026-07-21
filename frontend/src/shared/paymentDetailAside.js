import { apiRequest, apiUpload, getAssetUrl } from "/services/api.js";
import { formatCurrency, formatDateBR } from "./format.js";
import { appendFiscalFieldsToFormData, computeFiscalBreakdown, resolveFiscalPercents } from "./supplierFiscal.js";
import {
  initLiquidationFiscalHandlers,
  setupLiquidationFiscalModal,
  getLiquidationFiscalFormDataExtras,
} from "./liquidationFiscal.js";
import { openDocumentViewer, closeDocumentViewer } from "./documentViewer.js";

let liqAlreadyConfirmed = false;
let _notificationRecipientsCache = null;
let _onLiquidated = null;
let _showToast = null;

async function fetchNotificationRecipients() {
  if (_notificationRecipientsCache) return _notificationRecipientsCache;
  try {
    const data = await apiRequest("/users/notification-recipients");
    _notificationRecipientsCache = data.items || [];
  } catch {
    _notificationRecipientsCache = [];
  }
  return _notificationRecipientsCache;
}

async function renderLiqRecipients(preSelectedIds) {
  const list = document.getElementById("liqRecipientsList");
  if (!list) return;
  list.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">A carregar utilizadores...</p>`;

  const users = await fetchNotificationRecipients();
  if (!users.length) {
    list.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">Sem utilizadores disponíveis.</p>`;
    return;
  }

  const preSelected = new Set(
    preSelectedIds?.length
      ? preSelectedIds
      : users.filter((u) => u.isFinancialReceiver).map((u) => u.id)
  );

  list.innerHTML = users
    .map((u) => {
      const checked = preSelected.has(u.id) ? "checked" : "";
      const label = u.name || u.email || "Utilizador";
      const badge = u.isFinancialReceiver
        ? `<span class="text-[9px] font-black uppercase tracking-wide text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Receptor</span>`
        : "";
      return `
      <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white cursor-pointer transition-colors">
        <input type="checkbox" class="liq-recipient-checkbox w-4 h-4 rounded accent-emerald-600" value="${u.id}" ${checked} />
        <span class="text-xs font-semibold text-slate-700 flex-1 truncate">${label}</span>
        ${badge}
      </label>`;
    })
    .join("");
}

function getSelectedLiqRecipientIds() {
  return Array.from(document.querySelectorAll(".liq-recipient-checkbox:checked")).map((el) => el.value);
}

function renderAsidePaymentType(data) {
  const typeEl = document.getElementById("asidePaymentType");
  const creditSection = document.getElementById("asideCreditTermSection");
  const creditTermEl = document.getElementById("asideCreditTerm");
  const creditInstallmentEl = document.getElementById("asideCreditInstallment");
  if (!typeEl) return;

  const paymentType = data.paymentType || "PRONTO_PAGAMENTO";
  const isCredit = paymentType === "CREDITO";
  const badgeClass = isCredit
    ? "bg-sky-50 text-sky-700 border border-sky-100"
    : "bg-red-50 text-red-700 border border-red-200";
  const shortLabel = isCredit ? "C" : "PP";
  const fullLabel = isCredit ? "Crédito" : "Pronto Pagamento";

  typeEl.innerHTML = `<span class="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${badgeClass}">${shortLabel} · ${fullLabel}</span>`;

  if (creditSection) {
    if (isCredit) {
      creditSection.classList.remove("hidden");
      const days = data.creditTermDays;
      if (creditTermEl) {
        creditTermEl.textContent =
          days != null && Number.isFinite(Number(days)) ? `${Number(days)} dias` : "—";
      }
      if (creditInstallmentEl) {
        const num = data.installmentNumber;
        const total = data.installmentsPlanned;
        const row = document.getElementById("asideCreditInstallmentRow");
        if (num != null && total != null && Number(total) > 1) {
          creditInstallmentEl.textContent = `Parcela ${num} de ${total}`;
          row?.classList.remove("hidden");
        } else {
          row?.classList.add("hidden");
        }
      }
    } else {
      creditSection.classList.add("hidden");
    }
  }
}


function formatAsideQuantity(value, unit = "un", { compact = false } = {}) {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num) || num <= 0) return "—";
  const formatted = Number.isInteger(num)
    ? String(num)
    : num.toLocaleString("pt-AO", { maximumFractionDigits: 4 });
  if (compact) return formatted;
  return unit ? `${formatted} ${unit}`.trim() : formatted;
}

function formatAsideSignedAmount(value, currency, { positive = true } = {}) {
  const num = Math.abs(Number(value));
  if (!Number.isFinite(num) || num <= 0) return "—";
  const fmt = formatCurrency(num, currency);
  return positive ? `+${fmt}` : `−${fmt}`;
}

function resolveAsideFiscalBreakdown(data) {
  const supplier = data.supplierRef || null;
  const product = data.fiscalProductRef || null;
  const baseAmount = Number(data.budgetedAmount ?? data.amount ?? 0);
  const pct = resolveFiscalPercents({ product, supplier });
  const hasStored =
    data.fiscalApplyVat || data.fiscalApplyWithholding || data.fiscalApplyDiscount || data.netAmount;

  return computeFiscalBreakdown({
    supplier,
    product,
    baseAmount,
    grossAmount: data.grossAmount,
    inputMode: data.fiscalInputMode || "base",
    applyVat: hasStored ? Boolean(data.fiscalApplyVat) : pct.vatPercent > 0,
    applyWithholding: hasStored ? Boolean(data.fiscalApplyWithholding) : pct.withholdingPercent > 0,
    applyDiscount: hasStored ? Boolean(data.fiscalApplyDiscount) : pct.discountPercent > 0,
  });
}

export function renderAsideProductSection(data) {
  const section = document.getElementById("asideProductSection");
  if (!section) return;

  const productName = data.productName;
  if (!productName) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  const nameEl = document.getElementById("asideProductName");
  if (nameEl) nameEl.textContent = productName;
}

export function renderAsideAccountingLine(data) {
  const section = document.getElementById("asideAccountingSection");
  if (!section) return;

  const currency = data.quoteCurrency || data.currency || data.costCenter?.currency || "AOA";
  const unit = data.needUnit || "un";
  const qty = data.quoteQuantity;
  const unitPrice = data.quoteUnitPrice;
  const baseAmount = Number(data.budgetedAmount ?? data.paidAmount ?? data.amount ?? 0);
  const breakdown = resolveAsideFiscalBreakdown(data);

  const qtyEl = document.getElementById("asideAcctQty");
  if (qtyEl) {
    const hasQty = qty != null && qty !== "" && Number(qty) > 0;
    qtyEl.textContent = hasQty ? formatAsideQuantity(qty, unit, { compact: true }) : "—";
  }

  const unitPriceEl = document.getElementById("asideAcctUnitPrice");
  if (unitPriceEl) {
    const hasUnitPrice = unitPrice != null && unitPrice !== "" && Number(unitPrice) > 0;
    unitPriceEl.textContent = hasUnitPrice ? formatCurrency(unitPrice, currency) : "—";
  }

  const vatEl = document.getElementById("asideAcctVat");
  if (vatEl) vatEl.textContent = formatAsideSignedAmount(breakdown.vat, currency, { positive: true });

  const descEl = document.getElementById("asideAcctDesc");
  if (descEl) descEl.textContent = formatAsideSignedAmount(breakdown.discount, currency, { positive: false });

  const retEl = document.getElementById("asideAcctRet");
  if (retEl) retEl.textContent = formatAsideSignedAmount(breakdown.withholding, currency, { positive: false });

  const baseEl = document.getElementById("asideAcctBase");
  if (baseEl) {
    baseEl.textContent = Number.isFinite(baseAmount) && baseAmount > 0 ? formatCurrency(baseAmount, currency) : "—";
  }

  section.classList.remove("hidden");
}

function renderAsideDocument(url, title = "Documento") {
  if (!url) {
    return `
      <div class="py-8 text-center text-slate-300">
        <span class="material-symbols-outlined text-4xl mb-2">description</span>
        <p class="text-xs font-semibold text-slate-500">Sem ${title.toLowerCase()} disponível.</p>
      </div>`;
  }
  const assetUrl = getAssetUrl(url);
  const isImage = url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i);
  if (isImage) {
    return `
      <div class="relative w-full h-full flex flex-col items-center justify-center">
        <img src="${assetUrl}" alt="${title}" class="w-full h-auto object-contain max-h-full rounded-lg shadow-sm border border-slate-200">
      </div>`;
  }
  return `
    <div class="relative w-full h-full min-h-[300px]">
      <iframe src="${assetUrl}" class="w-full h-full min-h-[70vh] rounded-lg shadow-sm border border-slate-200" title="${title}"></iframe>
    </div>`;
}

function openDocumentAside(url, title = "Documento") {
  openDocumentViewer(url, title);
}

function closeDocumentAside() {
  closeDocumentViewer();
}

function renderLiqDocRow({ kind = "comprovativo", required = false, removable = true } = {}) {
  const removeBtn = removable
    ? `<button type="button" class="liq-doc-remove w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors flex items-center justify-center" title="Remover">
        <span class="material-symbols-outlined text-base">delete</span>
      </button>`
    : "";
  return `
    <div class="liq-doc-row p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <select class="liq-doc-kind flex-1 h-10 px-3 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700">
          <option value="comprovativo" ${kind === "comprovativo" ? "selected" : ""}>Comprovativo</option>
          <option value="fatura" ${kind === "fatura" ? "selected" : ""}>Fatura / Recibo</option>
          <option value="outro" ${kind === "outro" ? "selected" : ""}>Outro documento</option>
        </select>
        ${removeBtn}
      </div>
      <input type="file" class="liq-doc-file w-full h-11 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 focus:outline-none file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#0f172a] file:text-white hover:file:bg-slate-800 transition-all cursor-pointer" accept="image/*,.pdf" ${required ? "required" : ""} />
      <input type="text" class="liq-doc-desc w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-700" placeholder="Descrição (opcional)" />
    </div>`;
}

function resetLiqDocuments() {
  const list = document.getElementById("liqDocsList");
  if (!list) return;
  list.innerHTML = renderLiqDocRow({ kind: "comprovativo", required: !liqAlreadyConfirmed, removable: false });
  bindLiqDocRowEvents(list);
}

function bindLiqDocRowEvents(scope = document) {
  scope.querySelectorAll(".liq-doc-remove").forEach((btn) => {
    btn.onclick = () => btn.closest(".liq-doc-row")?.remove();
  });
}

function openLiquidateModal(payment) {
  const data =
    payment && typeof payment === "object"
      ? payment
      : { id: arguments[0], description: arguments[1], budgetedAmount: arguments[2], costCenterId: arguments[3] };

  const amount = data.paidAmount ?? data.budgetedAmount ?? data.amount ?? 0;
  liqAlreadyConfirmed = data.status === "CONFIRMADO" || data.status === "PAID";

  document.getElementById("liqTxId").value = data.id;
  document.getElementById("liqDesc").textContent = data.description || "";
  document.getElementById("liqCommitted").value = formatCurrency(data.budgetedAmount ?? amount, "AOA");
  document.getElementById("liqAmount").value = data.netAmount ?? amount;
  setupLiquidationFiscalModal(data);

  let ccInput = document.getElementById("liqCcId");
  if (!ccInput) {
    ccInput = document.createElement("input");
    ccInput.type = "hidden";
    ccInput.id = "liqCcId";
    document.getElementById("formLiq").appendChild(ccInput);
  }
  ccInput.value = data.costCenterId;

  const title = document.getElementById("liqModalTitle");
  const subtitle = document.getElementById("liqModalSubtitle");
  const submitBtn = document.getElementById("liqSubmitBtn");
  const recipientsSection = document.getElementById("liqRecipientsSection");
  const docsHint = document.getElementById("liqDocsHint");

  if (liqAlreadyConfirmed) {
    if (title) title.textContent = data.faturaUrl ? "Editar documentos" : "Anexar documentos";
    if (subtitle) {
      subtitle.textContent = data.faturaUrl
        ? "Actualiza os documentos da liquidação"
        : "Anexe fatura ou outros documentos complementares";
    }
    if (submitBtn) submitBtn.textContent = "Guardar";
    recipientsSection?.classList.add("hidden");
    const recipientsList = document.getElementById("liqRecipientsList");
    if (recipientsList) recipientsList.innerHTML = "";
    docsHint?.classList.remove("hidden");
    resetLiqDocuments();
    const firstRow = document.querySelector("#liqDocsList .liq-doc-row");
    firstRow?.querySelector(".liq-doc-file")?.removeAttribute("required");
  } else {
    if (title) title.textContent = "Liquidar lançamento";
    if (subtitle) subtitle.textContent = "Anexe o comprovativo e outros documentos";
    if (submitBtn) submitBtn.textContent = "Confirmar liquidação";
    recipientsSection?.classList.remove("hidden");
    renderLiqRecipients(data.notifiedRecipientIds);
    docsHint?.classList.remove("hidden");
    resetLiqDocuments();
  }

  document.getElementById("modalLiq").classList.add("open");
}

async function submitLiquidation(e) {
  e.preventDefault();
  const txId = document.getElementById("liqTxId").value;
  const ccId = document.getElementById("liqCcId").value;
  const realizedAmount = document.getElementById("liqAmount").value;

  if (!realizedAmount) return _showToast?.("Valor é obrigatório", "error");

  const docRows = Array.from(document.querySelectorAll("#liqDocsList .liq-doc-row"));
  const fd = new FormData();
  fd.append("paidAmount", realizedAmount);
  if (!liqAlreadyConfirmed) fd.append("status", "CONFIRMADO");

  let hasComprovativo = liqAlreadyConfirmed;
  const anexoDescricoes = [];

  docRows.forEach((row) => {
    const file = row.querySelector(".liq-doc-file")?.files?.[0];
    if (!file) return;
    const kind = row.querySelector(".liq-doc-kind")?.value || "outro";
    const desc = row.querySelector(".liq-doc-desc")?.value?.trim() || file.name;

    if (kind === "comprovativo" && !fd.has("comprovativo")) {
      fd.append("comprovativo", file);
      hasComprovativo = true;
      return;
    }
    if (kind === "fatura" && !fd.has("fatura")) {
      fd.append("fatura", file);
      return;
    }
    fd.append("anexos", file);
    anexoDescricoes.push(desc);
  });

  if (!liqAlreadyConfirmed && !hasComprovativo) {
    return _showToast?.("Comprovativo de pagamento é obrigatório", "error");
  }

  if (anexoDescricoes.length) {
    fd.append("anexoDescricoes", JSON.stringify(anexoDescricoes));
  }

  const fiscalExtras = getLiquidationFiscalFormDataExtras();
  if (fiscalExtras) {
    appendFiscalFieldsToFormData(fd, fiscalExtras);
  }

  const recipientIds = getSelectedLiqRecipientIds();
  if (!liqAlreadyConfirmed && !recipientIds.length) {
    const users = await fetchNotificationRecipients();
    const fallbackIds = users.filter((u) => u.isFinancialReceiver).map((u) => u.id);
    if (fallbackIds.length) {
      fd.append("recipientIds", JSON.stringify(fallbackIds));
    }
  } else if (recipientIds.length) {
    fd.append("recipientIds", JSON.stringify(recipientIds));
  }

  try {
    const btn = e.target.querySelector("button[type='submit']");
    const oldText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner w-4 h-4 mr-2 inline-block align-middle border-white"></span> A guardar...`;
    btn.disabled = true;

    const result = await apiUpload(`/cost-centers/${ccId}/payments/${txId}`, fd, "PATCH");

    btn.innerHTML = oldText;
    btn.disabled = false;

    const sent = Number(result?.notificationsSent ?? 0);
    let toastMsg = liqAlreadyConfirmed ? "Lançamento atualizado com sucesso!" : "Lançamento liquidado com sucesso!";
    if (!liqAlreadyConfirmed && recipientIds.length) {
      toastMsg += sent
        ? ` Notificação enviada a ${sent} destinatário(s) (in-app).`
        : " Nenhuma notificação foi entregue — confirma que o backend foi reiniciado e que estás com sessão aberta.";
    }
    _showToast?.(toastMsg, sent || liqAlreadyConfirmed ? "success" : "info");
    document.getElementById("modalLiq").classList.remove("open");
    resetLiqDocuments();

    await _onLiquidated?.();
  } catch (err) {
    const btn = e.target.querySelector("button[type='submit']");
    btn.innerHTML = liqAlreadyConfirmed ? "Guardar" : "Confirmar liquidação";
    btn.disabled = false;
    _showToast?.(err.message || "Erro ao liquidar lançamento.", "error");
  }
}

function openPaymentAside(data, type, options = {}) {
  const aside = document.getElementById("paymentAside");
  const overlay = document.getElementById("paymentAsideOverlay");

  const badge = document.getElementById("asideStatusBadge");
  if (badge) {
    badge.classList.remove(
      "hidden",
      "bg-emerald-100",
      "text-emerald-700",
      "bg-amber-100",
      "text-amber-700",
      "bg-red-100",
      "text-red-700"
    );
    if (data.status === "CONFIRMADO" || data.status === "PAID") {
      badge.textContent = "Pago";
      badge.classList.add("bg-emerald-100", "text-emerald-700");
    } else if (data.status === "CANCELADO") {
      badge.textContent = "Cancelado";
      badge.classList.add("bg-red-100", "text-red-700");
    } else {
      badge.textContent = "Pendente";
      badge.classList.add("bg-amber-100", "text-amber-700");
    }
  }

  document.getElementById("asideDesc").textContent = data.description || "—";
  renderAsideProductSection(data);
  document.getElementById("asideDate").textContent = data.paymentDate
    ? formatDateBR(data.paymentDate)
    : data.date
      ? formatDateBR(data.date)
      : "—";
  document.getElementById("asideSupplier").textContent = data.supplier || "—";
  document.getElementById("asideCategory").textContent = data.category || "—";
  renderAsidePaymentType(data);
  document.getElementById("asideNIF").textContent = data.supplierNif || data.nif || "—";
  document.getElementById("asideIBAN").textContent = data.supplierIban || data.iban || "—";
  document.getElementById("asideSupplierDetails")?.classList.remove("hidden");

  renderAsideAccountingLine(data);

  document.getElementById("asideProformaContainer").innerHTML = renderAsideDocument(
    data.proformaUrl,
    "Documento"
  );

  const compSection = document.getElementById("asideComprovativoSection");
  const compContainer = document.getElementById("asideComprovativoContainer");
  const faturaSection = document.getElementById("asideFaturaSection");
  const faturaContainer = document.getElementById("asideFaturaContainer");

  if (data.status === "CONFIRMADO" || data.status === "PAID") {
    if (data.comprovativoUrl) {
      compSection?.classList.remove("hidden");
      if (compContainer) compContainer.innerHTML = renderAsideDocument(data.comprovativoUrl, "Comprovativo");
    } else {
      compSection?.classList.add("hidden");
    }
    if (data.faturaUrl) {
      faturaSection?.classList.remove("hidden");
      if (faturaContainer) faturaContainer.innerHTML = renderAsideDocument(data.faturaUrl, "Fatura");
    } else {
      faturaSection?.classList.add("hidden");
    }
  } else {
    compSection?.classList.add("hidden");
    faturaSection?.classList.add("hidden");
  }

  const actionBtn = document.getElementById("asideActionBtn");

  if (type === "VIEW") {
    actionBtn?.classList.add("hidden");
  } else {
    actionBtn?.classList.remove("hidden");
    actionBtn.innerHTML = `<span class="material-symbols-outlined text-base">payments</span> Confirmar & Pagar`;
    actionBtn.onclick = () => {
      if (type === "PAYMENT" || type === "TRANSACTION") {
        openLiquidateModal(data);
      }
      closePaymentAside();
    };
  }

  overlay?.classList.remove("hidden");
  void overlay?.offsetWidth;
  overlay?.classList.remove("opacity-0");
  aside?.classList.remove("translate-x-full");

  if (options.focus === "fatura" && faturaSection && !faturaSection.classList.contains("hidden")) {
    requestAnimationFrame(() => {
      faturaSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } else if (options.focus === "comprovativo" && compSection && !compSection.classList.contains("hidden")) {
    requestAnimationFrame(() => {
      compSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function closePaymentAside() {
  const aside = document.getElementById("paymentAside");
  const overlay = document.getElementById("paymentAsideOverlay");
  aside?.classList.add("translate-x-full");
  overlay?.classList.add("opacity-0");
  setTimeout(() => overlay?.classList.add("hidden"), 300);
}

/** Inicializa aside + modal de liquidação (requer HTML correspondente na página). */
export function initPaymentDetailAside({ onLiquidated, showToast } = {}) {
  _onLiquidated = onLiquidated;
  _showToast = showToast;

  window.openPaymentAsideHandler = function (btn) {
    try {
      const payload = JSON.parse(btn.getAttribute("data-payload"));
      const type = btn.getAttribute("data-type") || "PAYMENT";
      const focus = btn.getAttribute("data-focus") || undefined;
      openPaymentAside(payload, type, { focus });
    } catch (err) {
      console.error("Erro ao abrir aside de pagamento:", err);
    }
  };

  window.openPaymentAside = openPaymentAside;
  window.closePaymentAside = closePaymentAside;
  window.openLiquidateModal = openLiquidateModal;
  window.openDocumentAside = openDocumentAside;
  window.closeDocumentAside = closeDocumentAside;

  document.getElementById("formLiq")?.addEventListener("submit", submitLiquidation);
  initLiquidationFiscalHandlers();
  document.getElementById("liqAddDocBtn")?.addEventListener("click", () => {
    const list = document.getElementById("liqDocsList");
    if (!list) return;
    list.insertAdjacentHTML("beforeend", renderLiqDocRow({ kind: "outro", removable: true }));
    bindLiqDocRowEvents(list);
  });
}
