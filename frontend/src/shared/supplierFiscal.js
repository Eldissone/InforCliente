/** Percentagens fiscais/comerciais do fornecedor — orçamento base mantém-se sem IVA/retenção. */

export function parsePercent(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Produto tem prioridade; fornecedor é fallback. */
export function resolveFiscalPercents({ product = null, supplier = null } = {}) {
  const pick = (productVal, supplierVal) => {
    const p = parsePercent(productVal);
    if (p > 0) return p;
    return parsePercent(supplierVal);
  };
  return {
    vatPercent: pick(product?.vatPercent, supplier?.vatPercent),
    withholdingPercent: pick(product?.withholdingPercent, supplier?.withholdingPercent),
    discountPercent: pick(product?.discountPercent, supplier?.discountPercent),
  };
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Cálculo fiscal bidireccional.
 * @param {object} options
 * @param {object|null} [options.supplier]
 * @param {number|string} [options.baseAmount]
 * @param {number|string} [options.grossAmount]
 * @param {"base"|"gross"} [options.inputMode]
 * @param {boolean} [options.applyVat]
 * @param {boolean} [options.applyWithholding]
 * @param {boolean} [options.applyDiscount]
 */
export function computeFiscalBreakdown({
  supplier = null,
  product = null,
  fiscalPercents = null,
  baseAmount = 0,
  grossAmount = 0,
  inputMode = "base",
  applyVat = false,
  applyWithholding = false,
  applyDiscount = false,
} = {}) {
  const pct = fiscalPercents || resolveFiscalPercents({ product, supplier });
  const vatPct = applyVat ? pct.vatPercent : 0;
  const whPct = applyWithholding ? pct.withholdingPercent : 0;
  const discPct = applyDiscount ? pct.discountPercent : 0;

  const factor = 1 - discPct / 100 + vatPct / 100;

  let base = 0;
  if (inputMode === "gross") {
    const grossIn = Number(grossAmount) || 0;
    base = factor > 0 ? grossIn / factor : 0;
  } else {
    base = Number(baseAmount) || 0;
  }

  const discount = discPct ? (base * discPct) / 100 : 0;
  const vat = vatPct ? (base * vatPct) / 100 : 0;
  const withholding = whPct ? (base * whPct) / 100 : 0;
  const gross = base - discount + vat;
  const net = gross - withholding;

  const lines = [];
  if (discPct) lines.push({ label: `Desconto (${discPct}%)`, amount: -discount, kind: "discount" });
  if (vatPct) lines.push({ label: `IVA (${vatPct}%)`, amount: vat, kind: "vat" });
  if (whPct) lines.push({ label: `Retenção (${whPct}%)`, amount: -withholding, kind: "withholding" });

  return {
    base: roundMoney(base),
    discount: roundMoney(discount),
    vat: roundMoney(vat),
    withholding: roundMoney(withholding),
    gross: roundMoney(gross),
    net: roundMoney(net),
    lines,
  };
}

/** Compatibilidade: calcula breakdown informativo a partir da base e % do produto/fornecedor. */
export function computeSupplierFiscalBreakdown(supplier, baseAmount, product = null) {
  const pct = resolveFiscalPercents({ product, supplier });
  return computeFiscalBreakdown({
    supplier,
    product,
    fiscalPercents: pct,
    baseAmount,
    applyVat: pct.vatPercent > 0,
    applyWithholding: pct.withholdingPercent > 0,
    applyDiscount: pct.discountPercent > 0,
  });
}

export function formatFiscalAmount(amount, currency = "AOA") {
  return `${Math.abs(amount).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} ${currency}`;
}

/** Valor efectivo a pagar (líquido quando fiscal já aplicado no orçamento). */
export function paymentPayableAmount(payment) {
  if (!payment) return 0;
  if (payment.status === "CONFIRMADO" || payment.status === "PAID") {
    const paid = Number(payment.paidAmount);
    if (Number.isFinite(paid) && paid > 0) return paid;
  }
  const net = Number(payment.netAmount ?? payment.payableAmount);
  if (Number.isFinite(net) && net > 0) return net;
  return Number(payment.budgetedAmount ?? payment.amount ?? 0) || 0;
}

export function renderSupplierFiscalBreakdownHtml(supplier, baseAmount, currency = "AOA", product = null) {
  const { lines } = computeSupplierFiscalBreakdown(supplier, baseAmount, product);
  if (!lines.length) return "";

  const text = lines
    .map((line) => {
      const sign = line.amount >= 0 ? "+" : "−";
      return `${line.label}: ${sign}${formatFiscalAmount(line.amount, currency)}`;
    })
    .join(" · ");

  return `<div class="text-[10px] text-slate-400 mt-0.5">${text}</div>`;
}

/** Totais para linha de cotação: base + líquido (quando há fiscal) e valor para ordenação. */
export function renderQuotePriceTotalsHtml(supplier, baseAmount, currency = "AOA", product = null) {
  const breakdown = computeSupplierFiscalBreakdown(supplier, baseAmount, product);
  const baseFmt = formatFiscalAmount(baseAmount, currency);
  const fiscalBreakdownHtml = renderSupplierFiscalBreakdownHtml(supplier, baseAmount, currency, product);

  if (!breakdown.lines.length) {
    return {
      totalHtml: `<div class="text-sm font-black text-slate-900 tabular-nums">${baseFmt}</div>`,
      fiscalBreakdownHtml: "",
      sortTotal: baseAmount,
    };
  }

  const netFmt = formatFiscalAmount(breakdown.net, currency);
  return {
    totalHtml: `
      <div class="space-y-1 sm:text-right">
        <div>
          <div class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Base</div>
          <div class="text-xs font-semibold text-slate-500 tabular-nums">${baseFmt}</div>
        </div>
        <div>
          <div class="text-[9px] font-bold text-emerald-700 uppercase tracking-widest">Líquido</div>
          <div class="text-sm font-black text-[#0f172a] tabular-nums">${netFmt}</div>
        </div>
      </div>
    `,
    fiscalBreakdownHtml,
    sortTotal: breakdown.net,
  };
}

export function renderFiscalBreakdownHtml(breakdown, currency = "AOA", { showNet = true } = {}) {
  if (!breakdown?.lines?.length && !showNet) return "";

  const rows = (breakdown.lines || [])
    .map((line) => {
      const sign = line.amount >= 0 ? "+" : "−";
      const color = line.amount >= 0 ? "text-emerald-600" : "text-red-600";
      return `<div class="flex justify-between items-center text-xs">
        <span class="text-slate-500 font-medium">${line.label}</span>
        <span class="font-bold tabular-nums ${color}">${sign}${formatFiscalAmount(line.amount, currency)}</span>
      </div>`;
    })
    .join("");

  const netRow = showNet
    ? `<div class="flex justify-between items-center text-xs pt-1.5 mt-1.5 border-t border-slate-200">
        <span class="text-slate-700 font-black uppercase tracking-wide text-[10px]">Valor líquido a pagar</span>
        <span class="font-black tabular-nums text-[#0f172a]">${formatFiscalAmount(breakdown.net, currency)}</span>
      </div>`
    : "";

  return rows + netRow;
}

export function formatSupplierFiscalSummary(supplier) {
  if (!supplier) return "—";
  const parts = [];
  const vat = parsePercent(supplier.vatPercent);
  const wh = parsePercent(supplier.withholdingPercent);
  const disc = parsePercent(supplier.discountPercent);
  if (vat) parts.push(`IVA ${vat}%`);
  if (wh) parts.push(`Ret. ${wh}%`);
  if (disc) parts.push(`Desc. ${disc}%`);
  return parts.length ? parts.join(" · ") : "—";
}

export function defaultFiscalFlagsFromSupplier(supplier, product = null) {
  const pct = resolveFiscalPercents({ product, supplier });
  return {
    applyVat: pct.vatPercent > 0,
    applyWithholding: pct.withholdingPercent > 0,
    applyDiscount: pct.discountPercent > 0,
  };
}

export function appendFiscalFieldsToFormData(fd, { inputMode, applyVat, applyWithholding, applyDiscount, grossAmount }) {
  fd.append("fiscalInputMode", inputMode || "base");
  fd.append("fiscalApplyVat", applyVat ? "true" : "false");
  fd.append("fiscalApplyWithholding", applyWithholding ? "true" : "false");
  fd.append("fiscalApplyDiscount", applyDiscount ? "true" : "false");
  if (inputMode === "gross" && grossAmount != null) {
    fd.append("grossAmount", String(grossAmount));
  }
}
