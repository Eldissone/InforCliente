import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Resumo Faturas vs Previsão» (Financeiro · Faturação).
 * % da obra com AM faturados, sem AM e % executada / por executar.
 */

function money(value) {
  return formatCurrency(Number(value) || 0, "AOA");
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00%";
  return `${n.toFixed(2)}%`;
}

function bar(percent, tone = "") {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="finance-bar-wrap">
      <div class="finance-bar"><div class="finance-bar-fill ${tone}" style="width:${value}%"></div></div>
      <span class="finance-bar-label">${esc(pct(percent))}</span>
    </div>`;
}

function renderKpis(items, totals) {
  const weighted = totals.budget > 0 ? (totals.executedWeighted / totals.budget) : 0;
  const cards = [
    { label: "Obras", value: String(items.length), sub: "No âmbito financeiro", tone: "slate", icon: "apartment" },
    { label: "AM com Fatura", value: money(totals.withAmValue), sub: `${totals.withAmCount} autos faturados`, tone: "emerald", icon: "task_alt" },
    { label: "AM sem Fatura", value: money(totals.withoutAmValue), sub: `${totals.withoutAmCount} autos por faturar`, tone: "amber", icon: "pending_actions" },
    { label: "% Executada", value: pct(weighted), sub: "Faturado / previsão de venda", tone: "blue", icon: "percent" },
  ];
  document.getElementById("summaryKpis").innerHTML = cards
    .map(
      (c) => `
      <div class="finance-kpi finance-kpi--${c.tone}">
        <span class="finance-kpi-label">
          <span class="material-symbols-outlined" style="font-size:15px">${c.icon}</span>${esc(c.label)}
        </span>
        <span class="finance-kpi-value">${esc(c.value)}</span>
        <span class="finance-kpi-sub">${esc(c.sub)}</span>
      </div>`
    )
    .join("");
}

function renderTable(items, totals) {
  const wrap = document.getElementById("summaryTable");
  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">summarize</span>Sem obras para apresentar.</div>`;
    return;
  }
  const body = items
    .map(
      (row) => `
      <tr>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(row.project.name)}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(row.project.referencia || "—")}</div>
        </td>
        <td class="fin-num">${esc(money(row.forecastValue ?? row.project?.budgetTotal))}</td>
        <td class="fin-num">${esc(money(row.billedValue))}</td>
        <td class="fin-num">${esc(String(row.withAmCount))}</td>
        <td class="fin-num">${esc(money(row.withAmValue))}</td>
        <td class="fin-num">${esc(String(row.withoutAmCount))}</td>
        <td class="fin-num">${esc(money(row.withoutAmValue))}</td>
        <td>${bar(row.executedPct, "finance-bar-fill--blue")}</td>
        <td>${bar(row.remainingPct, "finance-bar-fill--amber")}</td>
      </tr>`
    )
    .join("");

  const weighted = totals.budget > 0 ? totals.executedWeighted / totals.budget : 0;
  wrap.innerHTML = `
    <table class="fin-table">
      <thead>
        <tr>
          <th>Obra</th>
          <th style="text-align:right">Previsão de Venda</th>
          <th style="text-align:right">Faturado</th>
          <th style="text-align:right">AM c/ Fatura</th>
          <th style="text-align:right">Valor</th>
          <th style="text-align:right">AM s/ Fatura</th>
          <th style="text-align:right">Valor</th>
          <th>% Executada</th>
          <th>% Por Executar</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr>
          <td>Totais (${items.length} obras)</td>
          <td class="fin-num">${esc(money(totals.forecast))}</td>
          <td class="fin-num">${esc(money(totals.billed))}</td>
          <td class="fin-num" colspan="2">${esc(money(totals.withAmValue))}</td>
          <td class="fin-num" colspan="2">${esc(money(totals.withoutAmValue))}</td>
          <td>${bar(weighted, "finance-bar-fill--blue")}</td>
          <td>${bar(Math.max(100 - weighted, 0), "finance-bar-fill--amber")}</td>
        </tr>
      </tfoot>
    </table>`;
}

async function load() {
  const wrap = document.getElementById("summaryTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar resumo de faturação…</div>`;
  try {
    const data = await apiRequest("/finance/billing-summary");
    const items = data.items || [];
    const totals = items.reduce(
      (acc, r) => {
        acc.withAmCount += r.withAmCount;
        acc.withAmValue += Number(r.withAmValue) || 0;
        acc.withoutAmCount += r.withoutAmCount;
        acc.withoutAmValue += Number(r.withoutAmValue) || 0;
        // A previsão de venda vem da tabela de quantidades (fallback: valor da obra).
        const budget = Number(r.forecastValue ?? r.project?.budgetTotal) || 0;
        acc.budget += budget;
        acc.forecast += budget;
        acc.billed += Number(r.billedValue) || 0;
        acc.executedWeighted += ((Number(r.executedPct) || 0) / 100) * budget;
        return acc;
      },
      {
        withAmCount: 0,
        withAmValue: 0,
        withoutAmCount: 0,
        withoutAmValue: 0,
        budget: 0,
        forecast: 0,
        billed: 0,
        executedWeighted: 0,
      }
    );
    renderKpis(items, totals);
    renderTable(items, totals);
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o resumo de faturação.", { type: "error" });
  }
}

export async function render() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="summaryKpis" class="finance-kpi-grid"></div>
    <section class="finance-card">
      <div id="summaryTable" class="finance-table-scroll"></div>
    </section>`;
  await load();
}
