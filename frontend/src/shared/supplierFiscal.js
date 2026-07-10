/** Percentagens fiscais/comerciais do fornecedor — apenas informativas; o orçamento base mantém-se inalterado. */

export function parsePercent(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function computeSupplierFiscalBreakdown(supplier, baseAmount) {
  const base = Number(baseAmount) || 0;
  if (!supplier || base <= 0) {
    return { base, discount: 0, vat: 0, withholding: 0, lines: [] };
  }

  const vatPct = parsePercent(supplier.vatPercent);
  const discPct = parsePercent(supplier.discountPercent);
  const whPct = parsePercent(supplier.withholdingPercent);

  const discount = discPct ? (base * discPct) / 100 : 0;
  const vat = vatPct ? (base * vatPct) / 100 : 0;
  const withholding = whPct ? (base * whPct) / 100 : 0;

  const lines = [];
  if (discPct) lines.push({ label: `Desconto (${discPct}%)`, amount: -discount, kind: "discount" });
  if (vatPct) lines.push({ label: `IVA (${vatPct}%)`, amount: vat, kind: "vat" });
  if (whPct) lines.push({ label: `Retenção (${whPct}%)`, amount: -withholding, kind: "withholding" });

  return { base, discount, vat, withholding, lines };
}

export function formatFiscalAmount(amount, currency = "AOA") {
  return `${Math.abs(amount).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} ${currency}`;
}

export function renderSupplierFiscalBreakdownHtml(supplier, baseAmount, currency = "AOA") {
  const { lines } = computeSupplierFiscalBreakdown(supplier, baseAmount);
  if (!lines.length) return "";

  const text = lines
    .map((line) => {
      const sign = line.amount >= 0 ? "+" : "−";
      return `${line.label}: ${sign}${formatFiscalAmount(line.amount, currency)}`;
    })
    .join(" · ");

  return `<div class="text-[10px] text-slate-400 mt-0.5">${text}</div>`;
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
