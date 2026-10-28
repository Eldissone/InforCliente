import { toDateKey } from "../format.js";
import { TONES } from "./charts.js";

/**
 * Antiguidade de valores em falta (aging), partilhada pelas Contas a
 * Pagar/Receber, pelo Centro de Pagamentos e pelo Controlo.
 *
 * Os escalões são os usados em cobrança: o que ainda não venceu, o que venceu
 * nos últimos 30 dias e depois por trimestre, até mais de 90 dias de atraso.
 */

export const AGING_COLUMNS = [
  { key: "a_vencer", label: "A vencer" },
  { key: "d0_30", label: "0–30 dias" },
  { key: "d31_60", label: "31–60 dias" },
  { key: "d61_90", label: "61–90 dias" },
  { key: "d90_mais", label: "+90 dias" },
];

/** Do verde (no prazo) ao vermelho escuro (muito atrasado). */
export const AGING_TONES = [TONES.emerald, TONES.amber, "#f97316", TONES.red, "#991b1b"];

/** Dias de atraso face a hoje (negativo quando ainda falta para vencer). */
export function daysLate(value) {
  const key = toDateKey(value);
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  const due = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - due) / 86400000);
}

export function emptyAging() {
  return { a_vencer: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_mais: 0 };
}

/** Coluna de aging correspondente a uma data de vencimento. */
export function agingColumnOf(value) {
  const days = daysLate(value);
  if (days === null || days <= 0) return "a_vencer";
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_mais";
}

/** Soma os valores em falta pelos escalões de antiguidade. */
export function agingBuckets(rows, { amountKey, dateKey }) {
  const buckets = emptyAging();
  (rows || []).forEach((row) => {
    const amount = Number(row[amountKey]) || 0;
    if (amount <= 0) return;
    buckets[agingColumnOf(row[dateKey])] += amount;
  });
  return buckets;
}

/** Converte os totais por escalão na série que os gráficos consomem. */
export function agingSeries(buckets) {
  return AGING_COLUMNS.map((c) => ({ key: c.key, label: c.label, value: Number(buckets[c.key]) || 0 }));
}

/** Soma o que já está vencido (tudo exceto «a vencer»). */
export function overdueTotal(buckets) {
  return buckets.d0_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90_mais;
}
