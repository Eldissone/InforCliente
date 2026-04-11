export function formatCurrencyKZ(value) {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "-";
  return new Intl.NumberFormat("pt-AO", {
    style: "currency",
    currency: "AOA",
    maximumFractionDigits: 2,
  }).format(num).replace('AOA', 'kz').replace('Kz', 'kz');
}

export function formatCompactNumber(value) {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "-";
  return new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(num);
}

export function formatPercent(value, { digits = 1 } = {}) {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "-";
  return `${num.toFixed(digits)}%`;
}

export function formatDateBR(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(d);
}

