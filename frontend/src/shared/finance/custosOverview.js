import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Overview Custos» (Financeiro · Custos).
 * Custos previstos vs realizados e respetivos desvios por obra.
 */

function money(value) {
  return formatCurrency(Number(value) || 0, "AOA");
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00%";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function deviationClass(value) {
  const n = Number(value) || 0;
  if (n > 0.005) return "finance-neg";
  if (n < -0.005) return "finance-pos";
  return "finance-muted";
}

function renderKpis(items) {
  const totals = items.reduce(
    (acc, r) => {
      acc.forecast += Number(r.forecast) || 0;
      acc.committed += Number(r.committed) || 0;
      acc.realized += Number(r.realized) || 0;
      acc.confirmed += Number(r.confirmed) || 0;
      acc.pending += Number(r.pending) || 0;
      acc.saleForecast += Number(r.saleForecast) || 0;
      acc.plannedMargin += Number(r.plannedMargin) || 0;
      return acc;
    },
    { forecast: 0, committed: 0, realized: 0, confirmed: 0, pending: 0, saleForecast: 0, plannedMargin: 0 }
  );
  const deviation = totals.realized - totals.forecast;
  const plannedMarginPct = totals.saleForecast > 0 ? (totals.plannedMargin / totals.saleForecast) * 100 : 0;
  const cards = [
    {
      label: "Custo Previsto",
      value: money(totals.forecast),
      sub: "Orçamento dos centros de custo",
      tone: "blue",
      icon: "target",
    },
    { label: "Custos Comprometidos", value: money(totals.committed), sub: "Ainda não gasto", tone: "slate", icon: "handshake" },
    { label: "Custos Realizados", value: money(totals.realized), sub: "Todas as fontes", tone: "emerald", icon: "payments" },
    {
      label: "Desvio",
      value: money(deviation),
      sub: deviation > 0 ? "Acima do previsto" : "Dentro do previsto",
      tone: deviation > 0 ? "red" : "emerald",
      icon: "trending_up",
    },
    {
      label: "Venda Prevista",
      value: money(totals.saleForecast),
      sub: "Tabela de quantidades / valor da obra",
      tone: "blue",
      icon: "request_quote",
    },
    {
      label: "Margem Prevista",
      value: money(totals.plannedMargin),
      sub: `${plannedMarginPct.toFixed(2)}% sobre a venda prevista`,
      tone: totals.plannedMargin >= 0 ? "emerald" : "red",
      icon: "percent",
    },
  ];
  document.getElementById("costOverviewKpis").innerHTML = cards
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

function renderTable(items) {
  const wrap = document.getElementById("costOverviewTable");
  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">analytics</span>Sem obras para apresentar.</div>`;
    return;
  }
  const body = items
    .map((r) => {
      const dev = Number(r.deviation) || 0;
      const cls = deviationClass(dev);
      return `
      <tr>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(r.project.name)}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(r.project.referencia || "—")}</div>
        </td>
        <td class="fin-num">${esc(money(r.forecast))}</td>
        <td class="fin-num">${esc(money(r.committed))}</td>
        <td class="fin-num" style="font-weight:800">${esc(money(r.realized))}</td>
        <td class="fin-num finance-pos">${esc(money(r.confirmed))}</td>
        <td class="fin-num finance-muted">${esc(money(r.pending))}</td>
        <td class="fin-num ${cls}" style="font-weight:800">${esc(money(dev))}</td>
        <td class="fin-num ${cls}">${esc(pct(r.deviationPct))}</td>
        <td class="fin-num">${esc(money(r.saleForecast))}</td>
        <td class="fin-num ${Number(r.plannedMargin) >= 0 ? "finance-pos" : "finance-neg"}" style="font-weight:700">${esc(money(r.plannedMargin))}</td>
        <td class="fin-num ${Number(r.plannedMargin) >= 0 ? "finance-pos" : "finance-neg"}">${esc(pct(r.plannedMarginPct))}</td>
      </tr>`;
    })
    .join("");

  const totals = items.reduce(
    (acc, r) => {
      acc.forecast += Number(r.forecast) || 0;
      acc.committed += Number(r.committed) || 0;
      acc.realized += Number(r.realized) || 0;
      acc.confirmed += Number(r.confirmed) || 0;
      acc.pending += Number(r.pending) || 0;
      acc.saleForecast += Number(r.saleForecast) || 0;
      acc.plannedMargin += Number(r.plannedMargin) || 0;
      return acc;
    },
    { forecast: 0, committed: 0, realized: 0, confirmed: 0, pending: 0, saleForecast: 0, plannedMargin: 0 }
  );
  const dev = totals.realized - totals.forecast;
  const devPct = totals.forecast > 0 ? (dev / totals.forecast) * 100 : 0;
  const plannedMarginPct = totals.saleForecast > 0 ? (totals.plannedMargin / totals.saleForecast) * 100 : 0;

  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1400px">
      <thead><tr>
        <th>Obra</th>
        <th style="text-align:right">Custo Previsto</th>
        <th style="text-align:right">Comprometido</th>
        <th style="text-align:right">Realizado</th>
        <th style="text-align:right">Confirmado</th>
        <th style="text-align:right">Por Confirmar</th>
        <th style="text-align:right">Desvio</th>
        <th style="text-align:right">Desvio %</th>
        <th style="text-align:right">Venda Prevista</th>
        <th style="text-align:right">Margem Prevista</th>
        <th style="text-align:right">% Margem</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais</td>
        <td class="fin-num">${esc(money(totals.forecast))}</td>
        <td class="fin-num">${esc(money(totals.committed))}</td>
        <td class="fin-num">${esc(money(totals.realized))}</td>
        <td class="fin-num">${esc(money(totals.confirmed))}</td>
        <td class="fin-num">${esc(money(totals.pending))}</td>
        <td class="fin-num ${deviationClass(dev)}">${esc(money(dev))}</td>
        <td class="fin-num ${deviationClass(dev)}">${esc(pct(devPct))}</td>
        <td class="fin-num">${esc(money(totals.saleForecast))}</td>
        <td class="fin-num">${esc(money(totals.plannedMargin))}</td>
        <td class="fin-num">${esc(pct(plannedMarginPct))}</td>
      </tr></tfoot>
    </table>`;
}

async function load() {
  const wrap = document.getElementById("costOverviewTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar overview de custos…</div>`;
  try {
    const data = await apiRequest("/finance/costs-overview");
    const items = data.items || [];
    renderKpis(items);
    renderTable(items);
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar overview de custos.", { type: "error" });
  }
}

export async function render() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="costOverviewKpis" class="finance-kpi-grid"></div>
    <section class="finance-card">
      <p class="finance-hint" style="margin-bottom:0.75rem">
        O custo previsto vem do orçamento dos centros de custo da obra (baseline aprovado) e a venda
        prevista da tabela de quantidades — os mesmos valores usados na Faturação Prevista.
      </p>
      <div id="costOverviewTable" class="finance-table-scroll"></div>
    </section>`;
  await load();
}
