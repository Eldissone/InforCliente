export function formatCurrency(value, currencyCode = "AOA") {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "-";
  
  const code = (currencyCode || "AOA").toUpperCase();
  
  if (code === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(num);
  }
  
  return new Intl.NumberFormat("pt-AO", {
    style: "currency",
    currency: "AOA",
    maximumFractionDigits: 2,
  }).format(num).replace('AOA', 'Kz').replace('kz', 'Kz');
}

export function formatCurrencyKZ(value) {
  return formatCurrency(value, "AOA");
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

export async function getExchangeRate() {
  try {
    const response = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    const data = await response.json();
    if (data && data.rates && data.rates.AOA) {
      return data.rates.AOA;
    }
    return 918;
  } catch (err) {
    console.error("Falha ao obter câmbio em tempo real:", err);
    return 918;
  }
}
