import {
  computeFiscalBreakdown,
  defaultFiscalFlagsFromSupplier,
  formatFiscalAmount,
  renderFiscalBreakdownHtml,
  resolveFiscalPercents,
} from "./supplierFiscal.js";

let _currentSupplier = null;
let _currentProduct = null;
let _currency = "AOA";

function getEl(id) {
  return document.getElementById(id);
}

function readFiscalOptions() {
  const inputMode = getEl("liqFiscalModeGross")?.checked ? "gross" : "base";
  return {
    inputMode,
    applyVat: Boolean(getEl("liqApplyVat")?.checked),
    applyWithholding: Boolean(getEl("liqApplyWithholding")?.checked),
    applyDiscount: Boolean(getEl("liqApplyDiscount")?.checked),
  };
}

function readInputAmounts() {
  const opts = readFiscalOptions();
  const baseAmount = Number(getEl("liqBaseAmount")?.value) || Number(getEl("liqCommitted")?.dataset?.raw) || 0;
  const grossAmount = Number(getEl("liqGrossAmount")?.value) || 0;
  return { ...opts, baseAmount, grossAmount };
}

export function computeCurrentLiquidationFiscal() {
  const opts = readInputAmounts();
  const hasFiscal = opts.applyVat || opts.applyWithholding || opts.applyDiscount;
  if (!hasFiscal) return null;
  return computeFiscalBreakdown({
    supplier: _currentSupplier,
    product: _currentProduct,
    ...opts,
  });
}

function syncPaidAmountFromFiscal() {
  const breakdown = computeCurrentLiquidationFiscal();
  const liqAmount = getEl("liqAmount");
  if (!liqAmount) return;
  if (breakdown) {
    liqAmount.value = breakdown.net;
    liqAmount.readOnly = true;
    liqAmount.classList.add("bg-slate-100", "cursor-not-allowed");
  } else {
    liqAmount.readOnly = false;
    liqAmount.classList.remove("bg-slate-100", "cursor-not-allowed");
  }
}

function renderBreakdownPanel() {
  const panel = getEl("liqFiscalBreakdown");
  if (!panel) return;

  const breakdown = computeCurrentLiquidationFiscal();
  if (!breakdown) {
    panel.innerHTML = `<p class="text-[10px] text-slate-400 font-semibold">Active IVA, retenção ou desconto para calcular automaticamente.</p>`;
    return;
  }

  panel.innerHTML = renderFiscalBreakdownHtml(breakdown, _currency);
}

function toggleInputMode() {
  const opts = readFiscalOptions();
  getEl("liqBaseInputWrap")?.classList.toggle("hidden", opts.inputMode === "gross");
  getEl("liqGrossInputWrap")?.classList.toggle("hidden", opts.inputMode !== "gross");
}

function refreshFiscalUi() {
  toggleInputMode();
  renderBreakdownPanel();
  syncPaidAmountFromFiscal();
}

export function initLiquidationFiscalHandlers() {
  ["liqFiscalModeBase", "liqFiscalModeGross", "liqApplyVat", "liqApplyWithholding", "liqApplyDiscount", "liqBaseAmount", "liqGrossAmount"].forEach(
    (id) => {
      getEl(id)?.addEventListener("input", refreshFiscalUi);
      getEl(id)?.addEventListener("change", refreshFiscalUi);
    }
  );
}

export function setupLiquidationFiscalModal(payment) {
  _currentSupplier = payment?.supplierRef || null;
  _currentProduct = payment?.fiscalProductRef || null;
  _currency = payment?.currency || payment?.costCenter?.currency || "AOA";

  const section = getEl("liqFiscalSection");
  if (!section) return;

  const flags = defaultFiscalFlagsFromSupplier(_currentSupplier, _currentProduct);
  const stored = payment?.fiscalApplyVat || payment?.fiscalApplyWithholding || payment?.fiscalApplyDiscount;

  const applyVat = stored ? Boolean(payment?.fiscalApplyVat) : flags.applyVat;
  const applyWithholding = stored ? Boolean(payment?.fiscalApplyWithholding) : flags.applyWithholding;
  const applyDiscount = stored ? Boolean(payment?.fiscalApplyDiscount) : flags.applyDiscount;
  const inputMode = payment?.fiscalInputMode === "gross" ? "gross" : "base";

  const base = Number(payment?.budgetedAmount ?? payment?.amount ?? 0);
  const gross = Number(payment?.grossAmount ?? base);

  const committed = getEl("liqCommitted");
  if (committed) {
    committed.dataset.raw = String(base);
    committed.value = formatFiscalAmount(base, _currency);
  }

  const baseInput = getEl("liqBaseAmount");
  if (baseInput) baseInput.value = base;

  const grossInput = getEl("liqGrossAmount");
  if (grossInput) grossInput.value = gross;

  if (getEl("liqApplyVat")) getEl("liqApplyVat").checked = applyVat;
  if (getEl("liqApplyWithholding")) getEl("liqApplyWithholding").checked = applyWithholding;
  if (getEl("liqApplyDiscount")) getEl("liqApplyDiscount").checked = applyDiscount;
  if (getEl("liqFiscalModeBase")) getEl("liqFiscalModeBase").checked = inputMode === "base";
  if (getEl("liqFiscalModeGross")) getEl("liqFiscalModeGross").checked = inputMode === "gross";

  const hint = getEl("liqFiscalSupplierHint");
  if (hint) {
    const pct = resolveFiscalPercents({ product: _currentProduct, supplier: _currentSupplier });
    const parts = [];
    if (pct.vatPercent) parts.push(`IVA ${pct.vatPercent}%`);
    if (pct.withholdingPercent) parts.push(`Ret. ${pct.withholdingPercent}%`);
    if (pct.discountPercent) parts.push(`Desc. ${pct.discountPercent}%`);
    const source = _currentProduct?.vatPercent || _currentProduct?.withholdingPercent || _currentProduct?.discountPercent
      ? "produto"
      : "fornecedor";
    hint.textContent = parts.length
      ? `Regime do ${source}: ${parts.join(" · ")}`
      : "Sem percentagens fiscais no produto/fornecedor — pode activar manualmente.";
  }

  section.classList.remove("hidden");
  refreshFiscalUi();
}

export function getLiquidationFiscalFormDataExtras() {
  const opts = readFiscalOptions();
  const hasFiscal = opts.applyVat || opts.applyWithholding || opts.applyDiscount;
  if (!hasFiscal) return null;

  const breakdown = computeCurrentLiquidationFiscal();
  return {
    ...opts,
    grossAmount: opts.inputMode === "gross" ? Number(getEl("liqGrossAmount")?.value) || 0 : breakdown?.gross,
    netAmount: breakdown?.net,
    baseAmount: breakdown?.base,
  };
}

export function renderAsideFiscalFromPayment(data) {
  const section = document.getElementById("asideFiscalSection");
  const container = document.getElementById("asideFiscalBreakdown");
  if (!section || !container) return;

  const currency = data.currency || data.costCenter?.currency || "AOA";
  const hasStored =
    data.fiscalApplyVat || data.fiscalApplyWithholding || data.fiscalApplyDiscount || data.netAmount;

  if (hasStored) {
    const breakdown = computeFiscalBreakdown({
      supplier: data.supplierRef,
      product: data.fiscalProductRef,
      baseAmount: data.budgetedAmount,
      grossAmount: data.grossAmount,
      inputMode: data.fiscalInputMode || "base",
      applyVat: Boolean(data.fiscalApplyVat),
      applyWithholding: Boolean(data.fiscalApplyWithholding),
      applyDiscount: Boolean(data.fiscalApplyDiscount),
    });
    section.classList.remove("hidden");
    container.innerHTML =
      `<div class="text-[10px] text-slate-400 font-semibold mb-2">Base orçamental: ${formatFiscalAmount(breakdown.base, currency)}</div>` +
      renderFiscalBreakdownHtml(breakdown, currency);
    return;
  }

  const supplier = data?.supplierRef || null;
  const product = data?.fiscalProductRef || null;
  const base = Number(data.budgetedAmount ?? data.amount ?? 0);
  const pct = resolveFiscalPercents({ product, supplier });
  const breakdown = computeFiscalBreakdown({
    supplier,
    product,
    baseAmount: base,
    applyVat: pct.vatPercent > 0,
    applyWithholding: pct.withholdingPercent > 0,
    applyDiscount: pct.discountPercent > 0,
  });

  if (!breakdown.lines.length) {
    section.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  container.innerHTML = renderFiscalBreakdownHtml(breakdown, currency);
}
