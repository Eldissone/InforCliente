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
  vatPercent: "liqVatPercent",
  withholdingPercent: "liqWithholdingPercent",
  discountPercent: "liqDiscountPercent",
  vatPctWrap: "liqVatPctWrap",
  whPctWrap: "liqWhPctWrap",
  discPctWrap: "liqDiscPctWrap",
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
      <div class="grid grid-cols-3 gap-2">
        <div id="${p("VatPctWrap")}" class="hidden">
          <label for="${p("VatPercent")}" class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">IVA %</label>
          <input id="${p("VatPercent")}" type="number" min="0" max="100" step="0.01" placeholder="Ex: 14" class="w-full px-3 h-10 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
        </div>
        <div id="${p("WhPctWrap")}" class="hidden">
          <label for="${p("WithholdingPercent")}" class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Retenção %</label>
          <input id="${p("WithholdingPercent")}" type="number" min="0" max="100" step="0.01" placeholder="Ex: 6.5" class="w-full px-3 h-10 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
        </div>
        <div id="${p("DiscPctWrap")}" class="hidden">
          <label for="${p("DiscountPercent")}" class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Desconto %</label>
          <input id="${p("DiscountPercent")}" type="number" min="0" max="100" step="0.01" placeholder="Ex: 5" class="w-full px-3 h-10 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
        </div>
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

function readFiscalPercentsFromInputs() {
  const read = (key) => {
    const raw = getEl(key)?.value;
    if (raw === undefined || raw === null || String(raw).trim() === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    vatPercent: read("vatPercent"),
    withholdingPercent: read("withholdingPercent"),
    discountPercent: read("discountPercent"),
  };
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
  return { ...opts, baseAmount, grossAmount, fiscalPercents: readFiscalPercentsFromInputs() };
}

export function computeCurrentLiquidationFiscal() {
  const opts = readInputAmounts();
  return computeFiscalBreakdown({
    supplier: _currentSupplier,
    product: _currentProduct,
    ...opts,
  });
}

function syncPercentInputVisibility() {
  const opts = readFiscalOptions();
  getEl("vatPctWrap")?.classList.toggle("hidden", !opts.applyVat);
  getEl("whPctWrap")?.classList.toggle("hidden", !opts.applyWithholding);
  getEl("discPctWrap")?.classList.toggle("hidden", !opts.applyDiscount);
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
  syncPercentInputVisibility();
  toggleInputMode();
  renderBreakdownPanel();
  syncPaidAmountFromFiscal();
}

export function initLiquidationFiscalHandlers(prefixOrFields = null) {
  const rootId =
    typeof prefixOrFields === "string"
      ? `${prefixOrFields}FiscalSection`
      : _fields.section;
  const root = document.getElementById(rootId);
  if (!root) return;
  // Rebind when o HTML do modal é recriado (novo nó sem o marcador).
  if (root.dataset.fiscalHandlersBound === "1") return;
  root.dataset.fiscalHandlersBound = "1";
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
      vatPercent: `${options.prefix}VatPercent`,
      withholdingPercent: `${options.prefix}WithholdingPercent`,
      discountPercent: `${options.prefix}DiscountPercent`,
      vatPctWrap: `${options.prefix}VatPctWrap`,
      whPctWrap: `${options.prefix}WhPctWrap`,
      discPctWrap: `${options.prefix}DiscPctWrap`,
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

  const resolvedPct = resolveFiscalPercents({ product: _currentProduct, supplier: _currentSupplier });
  const vatPct =
    Number(payment?.fiscalVatPercent) > 0
      ? Number(payment.fiscalVatPercent)
      : resolvedPct.vatPercent;
  const whPct =
    Number(payment?.fiscalWithholdingPercent) > 0
      ? Number(payment.fiscalWithholdingPercent)
      : resolvedPct.withholdingPercent;
  const discPct =
    Number(payment?.fiscalDiscountPercent) > 0
      ? Number(payment.fiscalDiscountPercent)
      : resolvedPct.discountPercent;

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
  if (getEl("vatPercent")) getEl("vatPercent").value = vatPct > 0 ? String(vatPct) : "";
  if (getEl("withholdingPercent")) getEl("withholdingPercent").value = whPct > 0 ? String(whPct) : "";
  if (getEl("discountPercent")) getEl("discountPercent").value = discPct > 0 ? String(discPct) : "";

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
    } else if (
      payment?.fiscalVatPercent ||
      payment?.fiscalWithholdingPercent ||
      payment?.fiscalDiscountPercent
    ) {
      const parts = [];
      if (vatPct) parts.push(`IVA ${vatPct}%`);
      if (whPct) parts.push(`Ret. ${whPct}%`);
      if (discPct) parts.push(`Desc. ${discPct}%`);
      hint.textContent = parts.length
        ? `Percentagens do pedido: ${parts.join(" · ")}`
        : "Indique as percentagens para calcular automaticamente.";
    } else {
      const parts = [];
      if (resolvedPct.vatPercent) parts.push(`IVA ${resolvedPct.vatPercent}%`);
      if (resolvedPct.withholdingPercent) parts.push(`Ret. ${resolvedPct.withholdingPercent}%`);
      if (resolvedPct.discountPercent) parts.push(`Desc. ${resolvedPct.discountPercent}%`);
      const source =
        _currentProduct?.vatPercent ||
        _currentProduct?.withholdingPercent ||
        _currentProduct?.discountPercent
          ? "produto"
          : "fornecedor";
      hint.textContent = parts.length
        ? `Regime do ${source}: ${parts.join(" · ")}`
        : "Sem percentagens fiscais no produto/fornecedor — indique manualmente.";
    }
  }

  ["applyVat", "applyWithholding", "applyDiscount", "modeBase", "modeGross", "baseAmount", "grossAmount", "vatPercent", "withholdingPercent", "discountPercent"].forEach(
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
