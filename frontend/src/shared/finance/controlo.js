import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, drawAreaChart, drawBarChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";

/**
 * Ecrã «Controlo Financeiro».
 *
 * Fecha o ciclo do gestor financeiro: confronta o previsto com o realizado,
 * mostra o onde se está a ganhar ou a perder margem e o dinheiro que entrou e
 * saiu. A parte de cima é o resumo; o «Controlo por obra» abaixo é onde se
 * atua, com o desvio de custo e a margem de cada obra.
 */

/** Desvio de custo (acima do previsto) a partir do qual se avisa. */
const DEVIATION_ALERT_PCT = 5;

function money(value) {
  return formatCurrency(Number(value) || 0, "AOA");
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00%";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function deviationTone(value) {
  const n = Number(value) || 0;
  if (n > 0.005) return "finance-neg";
  if (n < -0.005) return "finance-pos";
  return "finance-muted";
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="ctrlKpis" class="finance-kpi-grid"></div>

    <div class="finance-chart-grid">
      ${chartCardHtml({
        id: "ctrlChartCash",
        title: "Entradas e saídas de dinheiro",
        subtitle: "Recebimentos do cliente contra custos pagos, nos últimos 12 meses",
        hint: "Uma barra de saídas acima das entradas no mesmo mês significa que a tesouraria está a ser consumida.",
        span: 2,
        height: 320,
      })}
      ${chartCardHtml({
        id: "ctrlChartDeviation",
        title: "Desvio de custo por obra",
        subtitle: "Realizado menos previsto (positivo = acima do orçamento)",
        height: 320,
      })}
      ${chartCardHtml({
        id: "ctrlChartMargins",
        title: "Margem prevista vs realizada",
        subtitle: "As 8 obras com maior venda prevista",
        span: 2,
        height: 320,
      })}
      ${chartCardHtml({
        id: "ctrlChartSources",
        title: "Custos por fonte",
        subtitle: "Onde está o dinheiro a ser gasto",
        height: 300,
      })}
    </div>

    <section id="ctrlAlerts" class="finance-card" style="margin-bottom:1.5rem"></section>

    <section class="finance-card" style="margin-bottom:1.5rem">
      <div class="finance-chart-head">
        <h2 class="finance-chart-title">Previsto vs realizado por obra</h2>
        <p class="finance-chart-subtitle">
          Custo previsto = orçamento dos centros de custo. Venda prevista = tabela de quantidades da obra.
        </p>
      </div>
      <div id="ctrlProjects" class="finance-table-scroll"></div>
    </section>

    <section class="finance-card">
      <div class="finance-chart-head">
        <h2 class="finance-chart-title">Fluxo de tesouraria</h2>
        <p class="finance-chart-subtitle">Entradas recebidas contra custos já pagos no total do período.</p>
      </div>
      <div id="ctrlCash"></div>
    </section>`;
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis(data) {
  const t = data.totals || {};
  const cards = [
    { label: "Custo Previsto", value: money(t.forecastCost), sub: "Orçamento dos centros de custo", tone: "blue", icon: "target" },
    { label: "Custo Realizado", value: money(t.realizedCost), sub: "Todas as fontes de custo", tone: "amber", icon: "payments" },
    { label: "Venda Prevista", value: money(t.saleForecast), sub: "Tabela de quantidades da obra", tone: "slate", icon: "request_quote" },
    {
      label: "Margem Prevista",
      value: money(t.plannedMargin),
      sub: `${pct(t.plannedMarginPct)} sobre a venda prevista`,
      tone: Number(t.plannedMargin) >= 0 ? "emerald" : "red",
      icon: "percent",
    },
    { label: "Receita", value: money(t.revenue), sub: "Faturação emitida", tone: "emerald", icon: "receipt_long" },
    {
      label: "Resultado",
      value: money(t.result),
      sub: `Margem ${pct(t.margin)}`,
      tone: Number(t.result) >= 0 ? "emerald" : "red",
      icon: "trending_up",
    },
    {
      label: "Desvio de Custo",
      value: money(t.costDeviation),
      sub: Number(t.costDeviation) > 0 ? "Acima do orçamento previsto" : "Dentro do orçamento previsto",
      tone: Number(t.costDeviation) > 0 ? "red" : "emerald",
      icon: "monitor_heart",
    },
    { label: "Por Faturar", value: money(t.toInvoice), sub: "Venda prevista ainda não faturada", tone: "blue", icon: "hourglass_top" },
  ];
  document.getElementById("ctrlKpis").innerHTML = cards
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

/* ─── Alertas de controlo ─────────────────────────────────────────────────── */

function renderAlerts(data) {
  const items = data.byProject || [];
  const overBudget = items
    .filter((p) => Number(p.costDeviationPct) > DEVIATION_ALERT_PCT && Number(p.realizedCost) > 0)
    .sort((a, b) => Number(b.costDeviationPct) - Number(a.costDeviationPct));

  const marginDrop = items
    .filter(
      (p) =>
        Number(p.saleForecast) > 0 &&
        Number(p.revenue) > 0 &&
        Number(p.margin) < Number(p.plannedMarginPct) - DEVIATION_ALERT_PCT
    )
    .sort((a, b) => Number(a.margin) - Number(b.margin));

  const negative = items.filter((p) => Number(p.result) < 0 && Number(p.revenue) > 0);

  const wrap = document.getElementById("ctrlAlerts");
  const none = !overBudget.length && !marginDrop.length && !negative.length;

  if (none) {
    wrap.innerHTML = `
      <div class="finance-chart-head" style="margin-bottom:0.5rem">
        <h2 class="finance-chart-title">Alertas de controlo</h2>
        <p class="finance-chart-subtitle">Só aparecem aqui as obras que precisam de atenção.</p>
      </div>
      <div class="finance-empty" style="padding:1.25rem">
        <span class="material-symbols-outlined">verified</span>
        Sem alertas: nenhuma obra está acima do orçamento de custo nem com margem abaixo da prevista.
      </div>`;
    return;
  }

  const block = (title, icon, rows, render) =>
    !rows.length
      ? ""
      : `
      <div style="margin-bottom:1rem">
        <p class="finance-chart-title" style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.5rem">
          <span class="material-symbols-outlined" style="font-size:17px;color:#dc2626">${icon}</span>${esc(title)}
        </p>
        <div class="finance-table-scroll">
          <table class="fin-table" style="min-width:720px">
            <thead><tr><th>Obra</th>${render.header}</tr></thead>
            <tbody>${rows.map(render.row).join("")}</tbody>
          </table>
        </div>
      </div>`;

  wrap.innerHTML = `
    <div class="finance-chart-head">
      <h2 class="finance-chart-title">Alertas de controlo</h2>
      <p class="finance-chart-subtitle">
        Obras que precisam de atenção: desvio de custo acima de ${DEVIATION_ALERT_PCT}%, margem realizada
        abaixo da prevista, ou resultado negativo.
      </p>
    </div>
    ${block("Custo acima do orçamento", "trending_up", overBudget, {
      header: `<th style="text-align:right">Custo Previsto</th><th style="text-align:right">Realizado</th><th style="text-align:right">Desvio</th><th style="text-align:right">Desvio %</th>`,
      row: (p) => `
        <tr>
          <td><div style="font-weight:700;color:#0f172a">${esc(p.project.name)}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(p.project.code || "")}</div></td>
          <td class="fin-num">${esc(money(p.forecastCost))}</td>
          <td class="fin-num">${esc(money(p.realizedCost))}</td>
          <td class="fin-num finance-neg" style="font-weight:800">${esc(money(p.costDeviation))}</td>
          <td class="fin-num finance-neg">${esc(pct(p.costDeviationPct))}</td>
        </tr>`,
    })}
    ${block("Margem abaixo da prevista", "percent", marginDrop, {
      header: `<th style="text-align:right">Margem Prev.</th><th style="text-align:right">Margem Realiz.</th><th style="text-align:right">Diferença</th>`,
      row: (p) => `
        <tr>
          <td><div style="font-weight:700;color:#0f172a">${esc(p.project.name)}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(p.project.code || "")}</div></td>
          <td class="fin-num">${esc(pct(p.plannedMarginPct))}</td>
          <td class="fin-num finance-neg" style="font-weight:700">${esc(pct(p.margin))}</td>
          <td class="fin-num finance-neg">${esc(pct(Number(p.margin) - Number(p.plannedMarginPct)))}</td>
        </tr>`,
    })}
    ${block("Resultado negativo", "warning", negative, {
      header: `<th style="text-align:right">Receita</th><th style="text-align:right">Custo</th><th style="text-align:right">Resultado</th>`,
      row: (p) => `
        <tr>
          <td><div style="font-weight:700;color:#0f172a">${esc(p.project.name)}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(p.project.code || "")}</div></td>
          <td class="fin-num">${esc(money(p.revenue))}</td>
          <td class="fin-num">${esc(money(p.realizedCost))}</td>
          <td class="fin-num finance-neg" style="font-weight:800">${esc(money(p.result))}</td>
        </tr>`,
    })}`;
}

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

function renderCharts(data) {
  const monthly = data.charts?.monthly || [];
  drawAreaChart("ctrlChartCash", {
    categories: monthly.map((m) => m.label),
    series: [
      { name: "Recebimentos", key: "received", color: TONES.emerald, data: monthly.map((m) => Number(m.received) || 0) },
      { name: "Custos pagos", key: "cost", color: TONES.red, data: monthly.map((m) => Number(m.cost) || 0) },
    ],
    height: 320,
  });

  const deviations = [...(data.byProject || [])]
    .filter((p) => Number(p.forecastCost) || Number(p.realizedCost))
    .sort((a, b) => Number(b.costDeviationPct) - Number(a.costDeviationPct))
    .slice(0, 8);
  drawBarChart("ctrlChartDeviation", {
    categories: deviations.map((p) => p.project.name),
    series: [
      {
        name: "Desvio de custo",
        data: deviations.map((p) => Number(p.costDeviation) || 0),
        color: TONES.red,
      },
    ],
    height: 320,
  });

  const top = [...(data.byProject || [])]
    .sort((a, b) => (Number(b.saleForecast) || 0) - (Number(a.saleForecast) || 0))
    .slice(0, 8);
  drawBarChart("ctrlChartMargins", {
    categories: top.map((p) => p.project.name),
    series: [
      { name: "Margem prevista", data: top.map((p) => Number(p.plannedMargin) || 0), color: TONES.violet },
      { name: "Margem realizada", data: top.map((p) => Number(p.result) || 0), color: TONES.emerald },
    ],
    height: 320,
  });

  const sources = (data.charts?.costBySource || []).filter((s) => Number(s.total) > 0);
  drawDonutChart("ctrlChartSources", {
    labels: sources.map((s) => s.label || s.source),
    series: sources.map((s) => Number(s.total) || 0),
    totalLabel: "Custo total",
    height: 300,
  });
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function renderProjects(data) {
  const wrap = document.getElementById("ctrlProjects");
  const items = data.byProject || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">analytics</span>Sem obras para apresentar.</div>`;
    return;
  }
  const body = items
    .map(
      (p) => `
      <tr>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(p.project.name)}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(p.project.code || "")}</div>
        </td>
        <td class="fin-num">${esc(money(p.forecastCost))}</td>
        <td class="fin-num">${esc(money(p.realizedCost))}</td>
        <td class="fin-num ${deviationTone(p.costDeviation)}" style="font-weight:800">${esc(money(p.costDeviation))}</td>
        <td class="fin-num ${deviationTone(p.costDeviation)}">${esc(pct(p.costDeviationPct))}</td>
        <td class="fin-num">${esc(money(p.saleForecast))}</td>
        <td class="fin-num ${Number(p.plannedMargin) >= 0 ? "finance-pos" : "finance-neg"}" style="font-weight:700">${esc(money(p.plannedMargin))}</td>
        <td class="fin-num ${Number(p.plannedMargin) >= 0 ? "finance-pos" : "finance-neg"}">${esc(pct(p.plannedMarginPct))}</td>
        <td class="fin-num">${esc(money(p.revenue))}</td>
        <td class="fin-num ${Number(p.result) >= 0 ? "finance-pos" : "finance-neg"}" style="font-weight:800">${esc(money(p.result))}</td>
        <td class="fin-num ${Number(p.margin) >= 0 ? "finance-pos" : "finance-neg"}">${esc(pct(p.margin))}</td>
      </tr>`
    )
    .join("");

  const t = data.totals || {};
  const dev = (Number(t.realizedCost) || 0) - (Number(t.forecastCost) || 0);
  const devPct = Number(t.forecastCost) > 0 ? (dev / Number(t.forecastCost)) * 100 : 0;
  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1550px">
      <thead><tr>
        <th>Obra</th>
        <th style="text-align:right">Custo Previsto</th>
        <th style="text-align:right">Custo Realizado</th>
        <th style="text-align:right">Desvio</th>
        <th style="text-align:right">Desvio %</th>
        <th style="text-align:right">Venda Prevista</th>
        <th style="text-align:right">Margem Prevista</th>
        <th style="text-align:right">% Margem Prev.</th>
        <th style="text-align:right">Receita</th>
        <th style="text-align:right">Resultado</th>
        <th style="text-align:right">Margem Realiz.</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais</td>
        <td class="fin-num">${esc(money(t.forecastCost))}</td>
        <td class="fin-num">${esc(money(t.realizedCost))}</td>
        <td class="fin-num ${deviationTone(dev)}">${esc(money(dev))}</td>
        <td class="fin-num ${deviationTone(dev)}">${esc(pct(devPct))}</td>
        <td class="fin-num">${esc(money(t.saleForecast))}</td>
        <td class="fin-num">${esc(money(t.plannedMargin))}</td>
        <td class="fin-num">${esc(pct(t.plannedMarginPct))}</td>
        <td class="fin-num">${esc(money(t.revenue))}</td>
        <td class="fin-num ${Number(t.result) >= 0 ? "finance-pos" : "finance-neg"}">${esc(money(t.result))}</td>
        <td class="fin-num ${Number(t.margin) >= 0 ? "finance-pos" : "finance-neg"}">${esc(pct(t.margin))}</td>
      </tr></tfoot>
    </table>`;
}

function renderCash(data) {
  const flow = data.cashFlow || {};
  const inflow = Number(flow.inflow) || 0;
  const outflow = Number(flow.outflow) || 0;
  const max = Math.max(inflow, outflow, 1);
  document.getElementById("ctrlCash").innerHTML = `
    <div class="finance-stat-row" style="margin-bottom:0.85rem">
      <div class="finance-stat finance-stat--emerald">
        <span class="finance-stat-label">Entradas recebidas</span>
        <span class="finance-stat-value">${esc(money(inflow))}</span>
      </div>
      <div class="finance-stat finance-stat--red">
        <span class="finance-stat-label">Saídas pagas</span>
        <span class="finance-stat-value">${esc(money(outflow))}</span>
      </div>
      <div class="finance-stat ${Number(flow.net) >= 0 ? "finance-stat--emerald" : "finance-stat--red"}">
        <span class="finance-stat-label">Saldo</span>
        <span class="finance-stat-value">${esc(money(flow.net))}</span>
      </div>
    </div>
    <div class="finance-aging-bars">
      <div class="finance-aging-row">
        <span>Entradas</span>
        <div class="finance-aging-track"><span style="width:${((inflow / max) * 100).toFixed(1)}%;background:#059669"></span></div>
        <span class="finance-aging-value">${esc(money(inflow))}</span>
      </div>
      <div class="finance-aging-row">
        <span>Saídas</span>
        <div class="finance-aging-track"><span style="width:${((outflow / max) * 100).toFixed(1)}%;background:#ed3237"></span></div>
        <span class="finance-aging-value">${esc(money(outflow))}</span>
      </div>
    </div>`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  const wrap = document.getElementById("ctrlProjects");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar controlo financeiro…</div>`;
  try {
    const data = await apiRequest("/finance/control");
    renderKpis(data);
    renderAlerts(data);
    renderProjects(data);
    renderCash(data);
    renderCharts(data);
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o controlo financeiro.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  renderShell();
  await load();
}
