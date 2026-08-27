export function formatCurrency(value, currencyCode = "AOA") {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "-";

  const code = (currencyCode || "AOA").toUpperCase();

  if (code === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }

  // Número decimal (não currency AOA): o ISO do Kwanza pode arredondar a 0 casas.
  return `${num.toLocaleString("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Kz`;
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

/** Chave YYYY-MM-DD (UTC) para datas «só dia» — evita desvio de fuso no calendário. */
export function toDateKey(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Formata data «só dia» (recepção, entrega prevista) sem desvio de fuso. */
export function formatDateOnlyBR(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

/** ISO UTC meio-dia a partir de input type=date (YYYY-MM-DD). */
export function dateInputToUtcNoonIso(dateStr) {
  if (!dateStr?.trim()) return null;
  const key = toDateKey(dateStr.trim());
  return key ? new Date(`${key}T12:00:00.000Z`).toISOString() : null;
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
