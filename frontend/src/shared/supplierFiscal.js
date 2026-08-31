/** Percentagens fiscais/comerciais do fornecedor — orçamento base mantém-se sem IVA/retenção. */

export function parsePercent(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Produto tem prioridade sobre o fornecedor; o item cotado tem prioridade sobre ambos. */
export function resolveFiscalPercents({ product = null, supplier = null, quote = null } = {}) {
  const pick = (quoteVal, productVal, supplierVal) => {
    if (quoteVal != null && quoteVal !== "") return parsePercent(quoteVal);
    const p = parsePercent(productVal);
    if (p > 0) return p;
    return parsePercent(supplierVal);
  };
  return {
    vatPercent: pick(quote?.vatPercent, product?.vatPercent, supplier?.vatPercent),
    withholdingPercent: pick(quote?.withholdingPercent, product?.withholdingPercent, supplier?.withholdingPercent),
    discountPercent: pick(quote?.discountPercent, product?.discountPercent, supplier?.discountPercent),
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
  quote = null,
  fiscalPercents = null,
  baseAmount = 0,
  grossAmount = 0,
  inputMode = "base",
  applyVat = false,
  applyWithholding = false,
  applyDiscount = false,
} = {}) {
  const pct = fiscalPercents || resolveFiscalPercents({ product, supplier, quote });
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

export function resolveQuoteLinePercents(quote, product = null) {
  const prod = product || quote?.supplierProduct || null;
  const pick = (quoteVal, productVal) => {
    if (quoteVal != null && quoteVal !== "") return parsePercent(quoteVal);
    return parsePercent(productVal);
  };
  return {
    vatPercent: pick(quote?.vatPercent, prod?.vatPercent),
    withholdingPercent: pick(quote?.withholdingPercent, prod?.withholdingPercent),
    discountPercent: pick(quote?.discountPercent, prod?.discountPercent),
  };
}

export function computeQuoteLineFiscalBreakdown(quote, baseAmount, product = null) {
  const pct = resolveQuoteLinePercents(quote, product);
  return computeFiscalBreakdown({
    fiscalPercents: pct,
    baseAmount,
    applyVat: pct.vatPercent > 0,
    applyWithholding: pct.withholdingPercent > 0,
    applyDiscount: pct.discountPercent > 0,
  });
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
  const n = Number(amount) || 0;
  const formatted = Math.abs(n).toLocaleString("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const suffix = currency === "AOA" ? "Kz" : currency;
  return `${n < 0 ? "−" : ""}${formatted} ${suffix}`;
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

/** Totais para linha de cotação: impostos do item, não do fornecedor. */
export function renderQuotePriceTotalsHtml(supplier, baseAmount, currency = "AOA", product = null, quote = null) {
  const breakdown = computeQuoteLineFiscalBreakdown(quote || {}, baseAmount, product);
  const baseFmt = formatFiscalAmount(baseAmount, currency);
  const fiscalBreakdownHtml = breakdown.lines.length
    ? renderFiscalBreakdownHtml(breakdown, currency, { showNet: false })
    : "";

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

/** Totais de um pedido de compra (IVA sobre o líquido, após desconto). */
export function computePedidoItemsTotals(lines = []) {
  let iliquido = 0;
  let descontos = 0;
  let iva = 0;
  for (const line of lines) {
    const qty = Number(line.quantity) || 0;
    const price = Number(line.unitPrice) || 0;
    const discPct = Number(line.discountPercent) || 0;
    const vatPct = Number(line.vatPercent) || 0;
    const base = qty * price;
    const discount = (base * discPct) / 100;
    const liquidoLinha = base - discount;
    iliquido += base;
    descontos += discount;
    iva += (liquidoLinha * vatPct) / 100;
  }
  const liquido = iliquido - descontos;
  return {
    iliquido,
    descontos,
    liquido,
    iva,
    doc: liquido + iva,
  };
}

export function formatPedidoTotalNumber(value) {
  return (Number(value) || 0).toLocaleString("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function pedidoTotalsPanelMarkup(idPrefix) {
  const rows = [
    ["iliquido", "Total Iliquido:"],
    ["descontos", "Total Descontos:"],
    ["liquido", "Total Liquido:"],
    ["iva", "Total IVA:"],
    ["doc", "Total Doc.:"],
  ];
  return `
  <div id="${idPrefix}TotalsPanel" class="mt-4 pt-1">
    <p class="text-sm font-black uppercase text-slate-900 tracking-wide pb-2 mb-3 border-b-2 border-slate-800">Totais</p>
    <div class="w-full max-w-[300px] ml-auto space-y-2.5">
      ${rows
        .map(
          ([key, label]) => `
        <div class="grid grid-cols-[1fr_8.5rem] items-baseline gap-3">
          <span class="text-sm font-bold text-slate-800 text-right">${label}</span>
          <span id="${idPrefix}Total_${key}" class="text-sm font-bold text-slate-900 text-right tabular-nums border-b border-slate-300 pb-0.5">0.00</span>
        </div>`
        )
        .join("")}
    </div>
  </div>`;
}

export function collectPedidoTotalsFromItemRows(rowSelector) {
  const lines = [];
  document.querySelectorAll(rowSelector).forEach((row) => {
    lines.push({
      quantity: parseFloat(row.querySelector(".cc-item-qty")?.value || "0"),
      unitPrice: parseFloat(row.querySelector(".cc-item-price")?.value || "0"),
      vatPercent: parseFloat(row.querySelector(".cc-item-vat")?.value || "0"),
      discountPercent: parseFloat(row.querySelector(".cc-item-disc")?.value || "0"),
    });
  });
  return computePedidoItemsTotals(lines);
}

export function renderPedidoTotalsPanel(idPrefix, totals) {
  const map = {
    iliquido: totals.iliquido,
    descontos: totals.descontos,
    liquido: totals.liquido,
    iva: totals.iva,
    doc: totals.doc,
  };
  Object.entries(map).forEach(([key, val]) => {
    const el = document.getElementById(`${idPrefix}Total_${key}`);
    if (el) el.textContent = formatPedidoTotalNumber(val);
  });
}

export function refreshPedidoTotalsFromRows(idPrefix, rowSelector) {
  renderPedidoTotalsPanel(idPrefix, collectPedidoTotalsFromItemRows(rowSelector));
}

export function appendFiscalFieldsToFormData(fd, { inputMode, applyVat, applyWithholding, applyDiscount, grossAmount, baseAmount }) {
  fd.append("fiscalInputMode", inputMode || "base");
  fd.append("fiscalApplyVat", applyVat ? "true" : "false");
  fd.append("fiscalApplyWithholding", applyWithholding ? "true" : "false");
  fd.append("fiscalApplyDiscount", applyDiscount ? "true" : "false");
  if (inputMode === "gross" && grossAmount != null) {
    fd.append("grossAmount", String(grossAmount));
  }
  if (baseAmount != null) {
    fd.append("budgetedAmount", String(baseAmount));
  }
}
