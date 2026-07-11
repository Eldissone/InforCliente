import { apiRequest, apiUpload, getAssetUrl } from "/services/api.js";
import { formatCurrency, formatDateBR } from "./format.js";
import { computeSupplierFiscalBreakdown, formatFiscalAmount } from "./supplierFiscal.js";

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

function renderAsideFiscalSection(data) {
  const section = document.getElementById("asideFiscalSection");
  const container = document.getElementById("asideFiscalBreakdown");
  if (!section || !container) return;

  const supplier = data?.supplierRef || null;
  const base = Number(data.budgetedAmount ?? data.amount ?? 0);
  const currency = data.currency || data.costCenter?.currency || "AOA";
  const { lines } = computeSupplierFiscalBreakdown(supplier, base);

  if (!lines.length) {
    section.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  container.innerHTML = lines
    .map((line) => {
      const sign = line.amount >= 0 ? "+" : "−";
      const color = line.amount >= 0 ? "text-emerald-600" : "text-red-600";
      return `<div class="flex justify-between items-center text-xs">
        <span class="text-slate-500 font-medium">${line.label}</span>
        <span class="font-bold tabular-nums ${color}">${sign}${formatFiscalAmount(line.amount, currency)}</span>
      </div>`;
    })
    .join("");
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
        <img src="${assetUrl}" alt="${title}" class="w-full h-auto object-contain max-h-full rounded-lg shadow-sm border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity" onclick="window.open('${assetUrl}','_blank')">
        <button type="button" onclick="window.open('${assetUrl}','_blank')" class="absolute top-2 right-2 w-8 h-8 bg-white/80 backdrop-blur-md border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white hover:text-emerald-600 transition-all shadow-sm" title="Expandir Imagem">
          <span class="material-symbols-outlined text-[16px]">open_in_new</span>
        </button>
      </div>`;
  }
  return `
    <div class="relative w-full h-full min-h-[300px]">
      <iframe src="${assetUrl}" class="w-full h-full rounded-lg shadow-sm border border-slate-200"></iframe>
      <button type="button" onclick="window.open('${assetUrl}','_blank')" class="absolute top-2 right-2 w-8 h-8 bg-white/80 backdrop-blur-md border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white hover:text-emerald-600 transition-all shadow-sm" title="Expandir Documento">
        <span class="material-symbols-outlined text-[16px]">open_in_new</span>
      </button>
    </div>`;
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
  document.getElementById("liqAmount").value = amount;

  let ccInput = document.getElementById("liqCcId");
  if (!ccInput) {
    ccInput = document.createElement("input");
    ccInput.type = "hidden";
    ccInput.id = "liqCcId";
    document.getElementById("formLiq").appendChild(ccInput);
  }
  ccInput.value = data.costCenterId;

  const compInput = document.getElementById("liqComprovativo");
  const compLabel = document.getElementById("liqComprovativoLabel");
  const compHint = document.getElementById("liqComprovativoHint");
  const title = document.getElementById("liqModalTitle");
  const subtitle = document.getElementById("liqModalSubtitle");
  const submitBtn = document.getElementById("liqSubmitBtn");
  const recipientsSection = document.getElementById("liqRecipientsSection");

  if (compInput) compInput.value = "";
  const fatInput = document.getElementById("liqFatura");
  if (fatInput) fatInput.value = "";

  if (liqAlreadyConfirmed) {
    compInput?.removeAttribute("required");
    if (compLabel) compLabel.textContent = "Comprovativo (substituir, opcional)";
    compHint?.classList.remove("hidden");
    if (title) title.textContent = data.faturaUrl ? "Editar Liquidação" : "Anexar Fatura";
    if (subtitle) {
      subtitle.textContent = data.faturaUrl
        ? "Atualiza documentos da liquidação"
        : "Ainda não há fatura final — podes anexá-la agora";
    }
    if (submitBtn) submitBtn.textContent = "Guardar";
    recipientsSection?.classList.add("hidden");
    const recipientsList = document.getElementById("liqRecipientsList");
    if (recipientsList) recipientsList.innerHTML = "";
  } else {
    compInput?.setAttribute("required", "required");
    if (compLabel) compLabel.textContent = "Comprovativo*";
    compHint?.classList.add("hidden");
    if (title) title.textContent = "Liquidar Lançamento";
    if (subtitle) subtitle.textContent = "Confirma o valor final pago";
    if (submitBtn) submitBtn.textContent = "Confirmar Liquidação";
    recipientsSection?.classList.remove("hidden");
    renderLiqRecipients(data.notifiedRecipientIds);
  }

  document.getElementById("modalLiq").classList.add("open");
}

async function submitLiquidation(e) {
  e.preventDefault();
  const txId = document.getElementById("liqTxId").value;
  const ccId = document.getElementById("liqCcId").value;
  const realizedAmount = document.getElementById("liqAmount").value;

  if (!realizedAmount) return _showToast?.("Valor é obrigatório", "error");

  const compInput = document.getElementById("liqComprovativo");
  if (!liqAlreadyConfirmed && (!compInput || !compInput.files[0])) {
    return _showToast?.("Comprovativo de pagamento é obrigatório", "error");
  }

  const fd = new FormData();
  fd.append("paidAmount", realizedAmount);
  if (!liqAlreadyConfirmed) fd.append("status", "CONFIRMADO");
  if (compInput?.files[0]) fd.append("comprovativo", compInput.files[0]);

  const fatInput = document.getElementById("liqFatura");
  if (fatInput?.files[0]) fd.append("fatura", fatInput.files[0]);

  const recipientIds = getSelectedLiqRecipientIds();
  if (recipientIds.length) fd.append("recipientIds", JSON.stringify(recipientIds));

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

    if (compInput) compInput.value = "";
    if (fatInput) fatInput.value = "";

    await _onLiquidated?.();
  } catch (err) {
    const btn = e.target.querySelector("button[type='submit']");
    btn.innerHTML = liqAlreadyConfirmed ? "Guardar" : "Confirmar Liquidação";
    btn.disabled = false;
    _showToast?.("Erro: " + err.message, "error");
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
      badge.textContent = "Liquidado";
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
  document.getElementById("asideDate").textContent = data.paymentDate
    ? formatDateBR(data.paymentDate)
    : data.date
      ? formatDateBR(data.date)
      : "—";
  document.getElementById("asideSupplier").textContent = data.supplier || "—";
  document.getElementById("asideCategory").textContent = data.category || "—";
  document.getElementById("asideNIF").textContent = data.supplierNif || data.nif || "—";
  document.getElementById("asideIBAN").textContent = data.supplierIban || data.iban || "—";
  document.getElementById("asideSupplierDetails")?.classList.remove("hidden");

  const amount = data.paidAmount ?? data.budgetedAmount ?? data.amount ?? 0;
  const currency = data.currency || data.costCenter?.currency || "AOA";
  document.getElementById("asideAmount").textContent = formatCurrency(amount, currency);
  renderAsideFiscalSection(data);

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

  document.getElementById("formLiq")?.addEventListener("submit", submitLiquidation);
}
