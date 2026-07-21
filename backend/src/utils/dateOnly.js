/** Datas «só dia» (sem hora) — sempre UTC meio-dia para evitar desvios de fuso. */

function toDateKey(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateKeyToUtcNoon(dateKey) {
  if (!dateKey) return null;
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeDateOnly(value) {
  const key = toDateKey(value);
  return key ? dateKeyToUtcNoon(key) : null;
}

function todayDateKey(now = new Date()) {
  return toDateKey(now);
}

function compareDateKeys(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

module.exports = {
  toDateKey,
  dateKeyToUtcNoon,
  normalizeDateOnly,
  todayDateKey,
  compareDateKeys,
};
