import {
  computeFiscalBreakdown,
  defaultFiscalFlagsFromSupplier,
  formatFiscalAmount,
  renderFiscalBreakdownHtml,
  resolveFiscalPercents,
} from "./supplierFiscal.js";

const DEFAULT_FIELDS = {
  section: "liqFiscalSection",
  committed: "liqCommitted",
  baseAmount: "liqBaseAmount",
  grossAmount: "liqGrossAmount",
  baseWrap: "liqBaseInputWrap",
  grossWrap: "liqGrossInputWrap",
  applyVat: "liqApplyVat",
  applyWithholding: "liqApplyWithholding",
  applyDiscount: "liqApplyDiscount",
  modeBase: "liqFiscalModeBase",
  modeGross: "liqFiscalModeGross",
  breakdown: "liqFiscalBreakdown",
  supplierHint: "liqFiscalSupplierHint",
  amount: "liqAmount",
};

let _fields = { ...DEFAULT_FIELDS };
let _currentSupplier = null;
let _currentProduct = null;
let _currency = "AOA";
let _fiscalFrozen = false;
const _boundRoots = new Set();

function getEl(key) {
  const id = _fields[key];
  return id ? document.getElementById(id) : null;
}

export function configureLiquidationFiscalFields(overrides = {}) {
  _fields = { ...DEFAULT_FIELDS, ...overrides };
}

export function renderFiscalSectionHtml(prefix = "liq") {
  const p = (name) => `${prefix}${name}`;
  return `
    <div id="${p("FiscalSection")}" class="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-3" data-fiscal-root="${prefix}">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-black uppercase tracking-widest text-slate-500">Cálculo fiscal</p>
        <div class="flex items-center gap-3 text-[11px] font-bold text-slate-600">
          <label class="inline-flex items-center gap-1 cursor-pointer">
            <input type="radio" name="${p("FiscalMode")}" id="${p("FiscalModeBase")}" value="base" checked class="accent-emerald-600" />
            Base
          </label>
          <label class="inline-flex items-center gap-1 cursor-pointer">
            <input type="radio" name="${p("FiscalMode")}" id="${p("FiscalModeGross")}" value="gross" class="accent-emerald-600" />
            Bruto
          </label>
        </div>
      </div>
      <p id="${p("FiscalSupplierHint")}" class="text-[10px] text-slate-400 font-semibold"></p>
      <div class="flex flex-wrap gap-4 text-xs font-bold text-slate-700">
        <label class="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" id="${p("ApplyVat")}" class="accent-emerald-600" /> Tem IVA</label>
        <label class="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" id="${p("ApplyWithholding")}" class="accent-emerald-600" /> Retenção na fonte</label>
        <label class="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" id="${p("ApplyDiscount")}" class="accent-emerald-600" /> Desconto</label>
      </div>
      <div id="${p("BaseInputWrap")}">
        <label for="${p("BaseAmount")}" class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Valor base</label>
        <input id="${p("BaseAmount")}" type="number" min="0" step="0.01" class="w-full px-4 h-11 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
      </div>
      <div id="${p("GrossInputWrap")}" class="hidden">
        <label for="${p("GrossAmount")}" class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Valor bruto (fatura)</label>
        <input id="${p("GrossAmount")}" type="number" min="0" step="0.01" class="w-full px-4 h-11 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
      </div>
      <div id="${p("FiscalBreakdown")}" class="pt-1"></div>
    </div>`;
}

function readFiscalOptions() {
  const inputMode = getEl("modeGross")?.checked ? "gross" : "base";
  return {
    inputMode,
    applyVat: Boolean(getEl("applyVat")?.checked),
    applyWithholding: Boolean(getEl("applyWithholding")?.checked),
    applyDiscount: Boolean(getEl("applyDiscount")?.checked),
  };
}

function readInputAmounts() {
  const opts = readFiscalOptions();
  const baseAmount = Number(getEl("baseAmount")?.value) || Number(getEl("committed")?.dataset?.raw) || 0;
  const grossAmount = Number(getEl("grossAmount")?.value) || 0;
  return { ...opts, baseAmount, grossAmount };
}

export function computeCurrentLiquidationFiscal() {
  const opts = readInputAmounts();
  return computeFiscalBreakdown({
    supplier: _currentSupplier,
    product: _currentProduct,
    ...opts,
  });
}

function syncCrossAmountFields(breakdown) {
  if (!breakdown || _fiscalFrozen) return;
  const baseEl = getEl("baseAmount");
  const grossEl = getEl("grossAmount");
  const opts = readFiscalOptions();
  if (opts.inputMode === "gross") {
    if (baseEl && document.activeElement !== baseEl) baseEl.value = breakdown.base;
  } else if (grossEl && document.activeElement !== grossEl) {
    grossEl.value = breakdown.gross;
  }
}

function syncPaidAmountFromFiscal() {
  const breakdown = computeCurrentLiquidationFiscal();
  const amountEl = getEl("amount");
  if (!amountEl) return;

  const opts = readFiscalOptions();
  const hasFiscal = opts.applyVat || opts.applyWithholding || opts.applyDiscount;

  if (hasFiscal && breakdown) {
    amountEl.value = breakdown.net;
    amountEl.readOnly = true;
    amountEl.classList.add("bg-slate-100", "cursor-not-allowed");
    syncCrossAmountFields(breakdown);
    return;
  }

  if (_fiscalFrozen) return;

  amountEl.readOnly = false;
  amountEl.classList.remove("bg-slate-100", "cursor-not-allowed");
  const base = Number(getEl("baseAmount")?.value) || Number(getEl("committed")?.dataset?.raw) || 0;
  if (document.activeElement !== amountEl) {
    amountEl.value = base;
  }
}

function renderBreakdownPanel() {
  const panel = getEl("breakdown");
  if (!panel) return;

  const opts = readFiscalOptions();
  const hasFiscal = opts.applyVat || opts.applyWithholding || opts.applyDiscount;
  const breakdown = computeCurrentLiquidationFiscal();

  if (!hasFiscal) {
    const base = Number(getEl("baseAmount")?.value) || Number(getEl("committed")?.dataset?.raw) || 0;
    panel.innerHTML = `<p class="text-[10px] text-slate-400 font-semibold">Sem impostos activos — valor líquido igual ao valor base (${formatFiscalAmount(base, _currency)}).</p>`;
    return;
  }

  if (!breakdown.lines.length) {
    panel.innerHTML = `<p class="text-[10px] text-slate-400 font-semibold">Active IVA, retenção ou desconto para calcular automaticamente.</p>`;
    return;
  }

  panel.innerHTML = renderFiscalBreakdownHtml(breakdown, _currency);
}

function toggleInputMode() {
  const opts = readFiscalOptions();
  getEl("baseWrap")?.classList.toggle("hidden", opts.inputMode === "gross");
  getEl("grossWrap")?.classList.toggle("hidden", opts.inputMode !== "gross");
}

function refreshFiscalUi() {
  toggleInputMode();
  renderBreakdownPanel();
  syncPaidAmountFromFiscal();
}

export function initLiquidationFiscalHandlers(prefixOrFields = null) {
  const rootId =
    typeof prefixOrFields === "string"
      ? `${prefixOrFields}FiscalSection`
      : _fields.section;
  if (_boundRoots.has(rootId)) return;

  const root = document.getElementById(rootId);
  if (!root) return;

  _boundRoots.add(rootId);

  root.addEventListener("input", () => refreshFiscalUi());
  root.addEventListener("change", () => refreshFiscalUi());
}

export function setupLiquidationFiscalModal(payment, options = {}) {
  if (options.prefix) {
    configureLiquidationFiscalFields({
      section: `${options.prefix}FiscalSection`,
      baseAmount: `${options.prefix}BaseAmount`,
      grossAmount: `${options.prefix}GrossAmount`,
      baseWrap: `${options.prefix}BaseInputWrap`,
      grossWrap: `${options.prefix}GrossInputWrap`,
      applyVat: `${options.prefix}ApplyVat`,
      applyWithholding: `${options.prefix}ApplyWithholding`,
      applyDiscount: `${options.prefix}ApplyDiscount`,
      modeBase: `${options.prefix}FiscalModeBase`,
      modeGross: `${options.prefix}FiscalModeGross`,
      breakdown: `${options.prefix}FiscalBreakdown`,
      supplierHint: `${options.prefix}FiscalSupplierHint`,
      amount: options.amountField || "liqAmount",
      committed: options.committedField || "liqCommitted",
    });
    initLiquidationFiscalHandlers(options.prefix);
  } else {
    configureLiquidationFiscalFields(options.fields || {});
    initLiquidationFiscalHandlers("liq");
  }

  _currentSupplier = payment?.supplierRef || payment?.supplier || null;
  _currentProduct = payment?.fiscalProductRef || null;
  _currency = payment?.currency || payment?.costCenter?.currency || "AOA";

  const section = getEl("section");
  if (!section) return;

  // Só bloqueia edição fiscal quando explicitamente pedido (ex.: modo só-leitura).
  // Pagamentos com netAmount/IVA já planeados (parcelas) devem continuar editáveis na liquidação.
  _fiscalFrozen = options.lockFiscal === true;

  const flags = defaultFiscalFlagsFromSupplier(_currentSupplier, _currentProduct);
  const stored = payment?.fiscalApplyVat || payment?.fiscalApplyWithholding || payment?.fiscalApplyDiscount;

  const applyVat = stored ? Boolean(payment?.fiscalApplyVat) : flags.applyVat;
  const applyWithholding = stored ? Boolean(payment?.fiscalApplyWithholding) : flags.applyWithholding;
  const applyDiscount = stored ? Boolean(payment?.fiscalApplyDiscount) : flags.applyDiscount;
  const inputMode = payment?.fiscalInputMode === "gross" ? "gross" : "base";

  const base = Number(payment?.budgetedAmount ?? payment?.amount ?? 0);
  const gross = Number(payment?.grossAmount ?? base);
  const net = Number(payment?.netAmount ?? payment?.paidAmount ?? base);

  const committed = getEl("committed");
  if (committed) {
    committed.dataset.raw = String(base);
    committed.value = formatFiscalAmount(base, _currency);
  }

  const baseInput = getEl("baseAmount");
  if (baseInput) baseInput.value = base;

  const grossInput = getEl("grossAmount");
  if (grossInput) grossInput.value = gross;

  if (getEl("applyVat")) getEl("applyVat").checked = applyVat;
  if (getEl("applyWithholding")) getEl("applyWithholding").checked = applyWithholding;
  if (getEl("applyDiscount")) getEl("applyDiscount").checked = applyDiscount;
  if (getEl("modeBase")) getEl("modeBase").checked = inputMode === "base";
  if (getEl("modeGross")) getEl("modeGross").checked = inputMode === "gross";

  const hint = getEl("supplierHint");
  if (hint) {
    if (_fiscalFrozen) {
      hint.textContent =
        "Impostos definidos no orçamento realizado — valor a pagar já inclui IVA/retenção/desconto.";
    } else if (
      payment?.netAmount &&
      (payment?.fiscalApplyVat || payment?.fiscalApplyWithholding || payment?.fiscalApplyDiscount)
    ) {
      hint.textContent =
        "Valores sugeridos pelo orçamento — pode ajustar IVA, retenção, desconto e base antes de liquidar.";
    } else {
      const pct = resolveFiscalPercents({ product: _currentProduct, supplier: _currentSupplier });
      const parts = [];
      if (pct.vatPercent) parts.push(`IVA ${pct.vatPercent}%`);
      if (pct.withholdingPercent) parts.push(`Ret. ${pct.withholdingPercent}%`);
      if (pct.discountPercent) parts.push(`Desc. ${pct.discountPercent}%`);
      const source =
        _currentProduct?.vatPercent ||
        _currentProduct?.withholdingPercent ||
        _currentProduct?.discountPercent
          ? "produto"
          : "fornecedor";
      hint.textContent = parts.length
        ? `Regime do ${source}: ${parts.join(" · ")}`
        : "Sem percentagens fiscais no produto/fornecedor — pode activar manualmente.";
    }
  }

  ["applyVat", "applyWithholding", "applyDiscount", "modeBase", "modeGross", "baseAmount", "grossAmount"].forEach(
    (key) => {
      const el = getEl(key);
      if (el) el.disabled = _fiscalFrozen;
    }
  );

  section.classList.remove("hidden");
  refreshFiscalUi();

  const amountEl = getEl("amount");
  if (amountEl && _fiscalFrozen && Number.isFinite(net) && net > 0) {
    amountEl.value = net;
    amountEl.readOnly = true;
    amountEl.classList.add("bg-slate-100", "cursor-not-allowed");
  }
}

export function getLiquidationFiscalFormDataExtras() {
  const opts = readFiscalOptions();
  const hasFiscal = opts.applyVat || opts.applyWithholding || opts.applyDiscount;
  const breakdown = computeCurrentLiquidationFiscal();

  if (hasFiscal && breakdown) {
    return {
      ...opts,
      grossAmount: opts.inputMode === "gross" ? Number(getEl("grossAmount")?.value) || 0 : breakdown.gross,
      netAmount: breakdown.net,
      baseAmount: breakdown.base,
    };
  }

  const base = Number(getEl("baseAmount")?.value) || Number(getEl("committed")?.dataset?.raw) || 0;
  if (base > 0) {
    return { ...opts, baseAmount: base, netAmount: Number(getEl("amount")?.value) || base };
  }

  return null;
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
