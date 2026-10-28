import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import {
  chartCardHtml,
  drawAreaChart,
  drawBarChart,
  drawDonutChart,
  drawRadialChart,
  destroyCharts,
  TONES,
} from "./charts.js";

/**
 * Ecrã «Overview Financeiro».
 *
 * Painel do gestor financeiro: faixa de resumo com receita, custo, resultado e
 * margem; indicadores de previsão (venda, custo, margem); gráficos de evolução
 * mensal, composição de custos por fonte, antiguidade de recebimentos e
 * receita/custo por obra; e as tabelas de resultado por obra, cash flow e
 * contas a receber.
 *
 * Todos os números vêm de `/finance/overview` — a mesma fonte do resto da área
 * financeira, para não haver valores diferentes entre ecrãs.
 */

const INVOICE_STATUS_LABELS = {
  EM_ABERTO: "Em aberto",
  PAGO_PARCIAL: "Pago parcial",
  PAGO_TOTAL: "Pago total",
  ATRASADO: "Atrasado",
};

const state = {
  months: 12,
  data: null,
};

function money(value) {
  return formatCurrency(Number(value) || 0, "AOA");
}

function compact(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B Kz`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M Kz`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K Kz`;
  return `${n.toFixed(0)} Kz`;
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00%";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function pctPlain(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00%";
  return `${n.toFixed(2)}%`;
}

function marginTone(value) {
  return (Number(value) || 0) >= 0 ? "finance-pos" : "finance-neg";
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <section id="ovHero" class="finance-hero"></section>
    <div id="ovCards" class="finance-kpi-grid"></div>

    <div class="finance-chart-grid">
      ${chartCardHtml({
        id: "ovChartFlow",
        title: "Evolução mensal",
        subtitle: "Faturação emitida, recebimentos e custos realizados",
        hint: "A faturação segue a data do documento, os recebimentos a data do recebimento e os custos a data do pagamento.",
        span: 2,
        height: 320,
        actionsHtml: `
          <div class="finance-seg" id="ovRange">
            <button type="button" data-months="6">6 meses</button>
            <button type="button" data-months="12" class="active">12 meses</button>
          </div>`,
      })}
      ${chartCardHtml({
        id: "ovChartCostSources",
        title: "Custos por fonte",
        subtitle: "De onde vem cada custo realizado",
        hint: "Pagamentos, pedidos extra, lançamentos de obra, pedidos de compra e fretes.",
        height: 300,
      })}
      ${chartCardHtml({
        id: "ovChartAging",
        title: "Por receber por antiguidade",
        subtitle: "Valor em falta agrupado pela data de vencimento",
        hint: "Quanto mais à direita, mais tempo o cliente está em atraso.",
        height: 300,
      })}
      ${chartCardHtml({
        id: "ovChartProjects",
        title: "Receita vs custo por obra",
        subtitle: "As 8 obras com maior volume financeiro",
        span: 2,
        height: 320,
      })}
      ${chartCardHtml({
        id: "ovChartStatus",
        title: "Estado da faturação",
        subtitle: "Valor faturado por estado de cobrança",
        height: 300,
      })}
    </div>

    <section class="finance-card" style="margin-bottom:1.5rem">
      <div class="finance-chart-head">
        <h2 class="finance-chart-title">Resultado por obra</h2>
        <p class="finance-chart-subtitle">
          Venda prevista (tabela de quantidades) e custo previsto (orçamento dos centros de custo) confrontados
          com o faturado e o custo realizado.
        </p>
      </div>
      <div id="ovProjects" class="finance-table-scroll"></div>
    </section>

    <div id="ovBottom" class="finance-overview-detail-grid">
      <section class="finance-card finance-overview-detail-card">
        <div class="finance-chart-head">
          <h2 class="finance-chart-title">Fluxo de tesouraria</h2>
          <p class="finance-chart-subtitle">Entradas recebidas do cliente contra custos já pagos.</p>
        </div>
        <div id="ovCash"></div>
      </section>
      <section class="finance-card finance-overview-detail-card">
        <div class="finance-chart-head">
          <h2 class="finance-chart-title">Contas a receber</h2>
          <p class="finance-chart-subtitle">Faturas em aberto, vencidas e a vencer.</p>
        </div>
        <div id="ovAging"></div>
      </section>
    </div>`;
}

/* ─── Faixa de resumo ─────────────────────────────────────────────────────── */

function renderHero(data) {
  const c = data.cards || {};
  const forecast = Number(c.forecast) || 0;
  const revenue = Number(c.revenue) || 0;
  const executedPct = forecast > 0 ? (revenue / forecast) * 100 : 0;

  const items = [
    {
      label: "Receita faturada",
      icon: "receipt_long",
      value: money(c.revenue),
      sub: `${pctPlain(executedPct)} da venda prevista`,
      bar: executedPct,
    },
    {
      label: "Custos realizados",
      icon: "payments",
      value: money(c.cost),
      sub: `Por confirmar: ${money(c.costPending)}`,
    },
    {
      label: "Resultado",
      icon: "trending_up",
      value: money(c.result),
      sub: `Margem ${pct(c.margin)}`,
    },
    {
      label: "Por receber",
      icon: "hourglass_bottom",
      value: money(c.receivable),
      sub: `Por faturar: ${money(c.toInvoice)}`,
    },
  ];

  document.getElementById("ovHero").innerHTML = `
    <div class="finance-hero-grid">
      ${items
        .map(
          (item) => `
        <div class="finance-hero-item">
          <span class="finance-hero-label">
            <span class="material-symbols-outlined">${item.icon}</span>${esc(item.label)}
          </span>
          <div class="finance-hero-value">${esc(item.value)}</div>
          <span class="finance-hero-sub">${esc(item.sub)}</span>
          ${
            item.bar !== undefined
              ? `<div class="finance-hero-bar"><span style="width:${Math.max(0, Math.min(100, item.bar)).toFixed(1)}%"></span></div>`
              : ""
          }
        </div>`
        )
        .join("")}
    </div>`;
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderCards(data) {
  const c = data.cards || {};
  const agingTotal = Number(data.aging?.vencidas || 0) + Number(data.aging?.a_vencer || 0);

  const cards = [
    {
      label: "Venda Prevista",
      value: money(c.forecast),
      sub: "Tabela de quantidades das obras",
      tone: "blue",
      icon: "target",
    },
    {
      label: "Custo Previsto",
      value: money(c.costBudget),
      sub: "Orçamento dos centros de custo",
      tone: "slate",
      icon: "request_quote",
    },
    {
      label: "Margem Prevista",
      value: money(c.plannedMargin),
      sub: `${pct(c.plannedMarginPct)} sobre a venda prevista`,
      tone: Number(c.plannedMargin) >= 0 ? "emerald" : "red",
      icon: "percent",
    },
    {
      label: "Custos Comprometidos",
      value: money(c.costCommitted),
      sub: "Assumido e ainda por pagar",
      tone: "amber",
      icon: "handshake",
    },
    {
      label: "Recebido",
      value: money(c.received),
      sub: "Entradas do cliente já registadas",
      tone: "emerald",
      icon: "savings",
    },
    { label: "Por Receber", value: money(agingTotal), sub: "Faturas em aberto", tone: "amber", icon: "schedule" },
    {
      label: "Por Faturar",
      value: money(c.toInvoice),
      sub: "Previsão ainda não faturada",
      tone: "blue",
      icon: "hourglass_top",
    },
    {
      label: "Custos por Confirmar",
      value: money(c.costPending),
      sub: "Aguarda confirmação do financeiro",
      tone: Number(c.costPending) > 0 ? "red" : "emerald",
      icon: "pending_actions",
    },
  ];

  document.getElementById("ovCards").innerHTML = cards
    .map(
      (card) => `
      <div class="finance-kpi finance-kpi--${card.tone}">
        <span class="finance-kpi-label">
          <span class="material-symbols-outlined" style="font-size:15px">${card.icon}</span>${esc(card.label)}
        </span>
        <span class="finance-kpi-value">${esc(card.value)}</span>
        <span class="finance-kpi-sub">${esc(card.sub)}</span>
      </div>`
    )
    .join("");
}

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

function renderFlowChart() {
  const monthly = state.data?.charts?.monthly || [];
  const slice = monthly.slice(Math.max(0, monthly.length - state.months));
  return drawAreaChart("ovChartFlow", {
    categories: slice.map((m) => m.label),
    series: [
      { name: "Faturação", key: "invoiced", data: slice.map((m) => Number(m.invoiced) || 0) },
      { name: "Recebimentos", key: "received", data: slice.map((m) => Number(m.received) || 0) },
      { name: "Custos pagos", key: "cost", data: slice.map((m) => Number(m.cost) || 0) },
    ],
  });
}

function renderCostSourcesChart() {
  const rows = (state.data?.charts?.costBySource || []).filter((s) => Number(s.total) > 0);
  if (!rows.length) return drawDonutChart("ovChartCostSources", { labels: [], series: [] });
  return drawDonutChart("ovChartCostSources", {
    labels: rows.map((r) => r.label || r.source),
    series: rows.map((r) => Number(r.total) || 0),
    totalLabel: "Custo total",
  });
}

function renderAgingChart() {
  const aging = state.data?.charts?.aging?.receivables || [];
  const rows = aging.filter((a) => Number(a.value) > 0);
  if (!rows.length) return drawDonutChart("ovChartAging", { labels: [], series: [] });
  return drawDonutChart("ovChartAging", {
    labels: rows.map((a) => a.label),
    series: rows.map((a) => Number(a.value) || 0),
    colors: [TONES.emerald, TONES.amber, "#f97316", TONES.red, "#991b1b"],
    totalLabel: "Por receber",
  });
}

function renderProjectsChart() {
  const items = (state.data?.byProject || [])
    .filter((p) => Number(p.revenue) || Number(p.cost))
    .sort((a, b) => (Number(b.revenue) || 0) + (Number(b.cost) || 0) - ((Number(a.revenue) || 0) + (Number(a.cost) || 0)))
    .slice(0, 8);
  if (!items.length) return drawBarChart("ovChartProjects", { categories: [], series: [] });
  return drawBarChart("ovChartProjects", {
    categories: items.map((p) => p.project.name),
    series: [
      { name: "Receita", data: items.map((p) => Number(p.revenue) || 0), color: TONES.blue },
      { name: "Custo", data: items.map((p) => Number(p.cost) || 0), color: TONES.red },
      { name: "Resultado", data: items.map((p) => Number(p.result) || 0), color: TONES.emerald },
    ],
    height: 320,
  });
}

function renderStatusChart() {
  const rows = (state.data?.charts?.statusMix || []).filter((r) => Number(r.value) > 0);
  if (!rows.length) return drawDonutChart("ovChartStatus", { labels: [], series: [] });
  const tone = {
    EM_ABERTO: TONES.slate,
    PAGO_PARCIAL: TONES.amber,
    PAGO_TOTAL: TONES.emerald,
    ATRASADO: TONES.red,
  };
  return drawDonutChart("ovChartStatus", {
    labels: rows.map((r) => INVOICE_STATUS_LABELS[r.status] || r.status),
    series: rows.map((r) => Number(r.value) || 0),
    colors: rows.map((r) => tone[r.status] || TONES.slate),
    totalLabel: "Faturado",
  });
}

async function renderCharts() {
  await Promise.all([
    renderFlowChart(),
    renderCostSourcesChart(),
    renderAgingChart(),
    renderProjectsChart(),
    renderStatusChart(),
  ]);
}

/* ─── Tabelas ─────────────────────────────────────────────────────────────── */

function renderProjects(data) {
  const wrap = document.getElementById("ovProjects");
  const items = (data.byProject || []).filter((p) => p.revenue || p.cost || p.forecast || p.costBudget);
  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">analytics</span>Sem dados financeiros por obra.</div>`;
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
        <td class="fin-num">${esc(money(p.forecast))}</td>
        <td class="fin-num">${esc(money(p.costBudget))}</td>
        <td class="fin-num ${marginTone(p.plannedMargin)}" style="font-weight:700">${esc(money(p.plannedMargin))}</td>
        <td class="fin-num ${marginTone(p.plannedMarginPct)}">${esc(pct(p.plannedMarginPct))}</td>
        <td class="fin-num">${esc(money(p.revenue))}</td>
        <td class="fin-num finance-pos">${esc(money(p.received))}</td>
        <td class="fin-num">${esc(money(p.cost))}</td>
        <td class="fin-num ${marginTone(p.result)}" style="font-weight:800">${esc(money(p.result))}</td>
        <td class="fin-num ${marginTone(p.margin)}">${esc(pct(p.margin))}</td>
      </tr>`
    )
    .join("");

  const totals = items.reduce(
    (acc, p) => {
      acc.forecast += Number(p.forecast) || 0;
      acc.costBudget += Number(p.costBudget) || 0;
      acc.plannedMargin += Number(p.plannedMargin) || 0;
      acc.revenue += Number(p.revenue) || 0;
      acc.received += Number(p.received) || 0;
      acc.cost += Number(p.cost) || 0;
      acc.result += Number(p.result) || 0;
      return acc;
    },
    { forecast: 0, costBudget: 0, plannedMargin: 0, revenue: 0, received: 0, cost: 0, result: 0 }
  );
  const margin = totals.revenue > 0 ? (totals.result / totals.revenue) * 100 : 0;
  const plannedMarginPct = totals.forecast > 0 ? (totals.plannedMargin / totals.forecast) * 100 : 0;

  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1350px">
      <thead><tr>
        <th>Obra</th>
        <th style="text-align:right">Venda Prevista</th>
        <th style="text-align:right">Custo Previsto</th>
        <th style="text-align:right">Margem Prevista</th>
        <th style="text-align:right">% Margem Prev.</th>
        <th style="text-align:right">Receita</th>
        <th style="text-align:right">Recebido</th>
        <th style="text-align:right">Custo Realizado</th>
        <th style="text-align:right">Resultado</th>
        <th style="text-align:right">Margem</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais</td>
        <td class="fin-num">${esc(money(totals.forecast))}</td>
        <td class="fin-num">${esc(money(totals.costBudget))}</td>
        <td class="fin-num ${marginTone(totals.plannedMargin)}">${esc(money(totals.plannedMargin))}</td>
        <td class="fin-num ${marginTone(plannedMarginPct)}">${esc(pct(plannedMarginPct))}</td>
        <td class="fin-num">${esc(money(totals.revenue))}</td>
        <td class="fin-num">${esc(money(totals.received))}</td>
        <td class="fin-num">${esc(money(totals.cost))}</td>
        <td class="fin-num ${marginTone(totals.result)}">${esc(money(totals.result))}</td>
        <td class="fin-num ${marginTone(margin)}">${esc(pct(margin))}</td>
      </tr></tfoot>
    </table>`;
}

function renderCash(data) {
  const flow = data.cashFlow || {};
  const inflow = Number(flow.inflow) || 0;
  const outflow = Number(flow.outflow) || 0;
  const max = Math.max(inflow, outflow, 1);
  document.getElementById("ovCash").innerHTML = `
    <div class="finance-stat-row" style="margin-bottom:0.85rem">
      <div class="finance-stat finance-stat--emerald">
        <span class="finance-stat-label">Entradas recebidas</span>
        <span class="finance-stat-value">${esc(money(inflow))}</span>
      </div>
      <div class="finance-stat finance-stat--red">
        <span class="finance-stat-label">Saídas (custos pagos)</span>
        <span class="finance-stat-value">${esc(money(outflow))}</span>
      </div>
      <div class="finance-stat ${Number(flow.net) >= 0 ? "finance-stat--emerald" : "finance-stat--red"}">
        <span class="finance-stat-label">Saldo de tesouraria</span>
        <span class="finance-stat-value">${esc(money(flow.net))}</span>
      </div>
    </div>
    <div class="finance-aging-bars">
      <div class="finance-aging-row">
        <span>Entradas</span>
        <div class="finance-aging-track"><span style="width:${((inflow / max) * 100).toFixed(1)}%;background:#059669"></span></div>
        <span class="finance-aging-value">${esc(compact(inflow))}</span>
      </div>
      <div class="finance-aging-row">
        <span>Saídas</span>
        <div class="finance-aging-track"><span style="width:${((outflow / max) * 100).toFixed(1)}%;background:#ed3237"></span></div>
        <span class="finance-aging-value">${esc(compact(outflow))}</span>
      </div>
    </div>
    <div style="margin-top:1rem" id="ovCashRadial"></div>`;
  drawRadialChart("ovCashRadial", {
    value: inflow > 0 ? (Number(flow.net) / inflow) * 100 : 0,
    label: "Saldo sobre entradas",
    color: Number(flow.net) >= 0 ? TONES.emerald : TONES.red,
    height: 220,
  });
}

function renderAging(data) {
  const aging = data.aging || {};
  const columns = data.charts?.aging?.receivables || [];
  const total = Number(aging.vencidas || 0) + Number(aging.a_vencer || 0);
  const max = Math.max(...columns.map((c) => Number(c.value) || 0), total, 1);

  document.getElementById("ovAging").innerHTML = `
    <div class="finance-stat-row" style="margin-bottom:0.85rem">
      <div class="finance-stat finance-stat--red">
        <span class="finance-stat-label">Vencidas</span>
        <span class="finance-stat-value">${esc(money(aging.vencidas))}</span>
      </div>
      <div class="finance-stat finance-stat--amber">
        <span class="finance-stat-label">A vencer</span>
        <span class="finance-stat-value">${esc(money(aging.a_vencer))}</span>
      </div>
      <div class="finance-stat finance-stat--blue">
        <span class="finance-stat-label">Total por receber</span>
        <span class="finance-stat-value">${esc(money(total))}</span>
      </div>
    </div>
    <div class="finance-aging-bars">
      ${columns
        .map((c) => {
          const value = Number(c.value) || 0;
          const late = c.key === "d61_90" || c.key === "d90_mais";
          const warn = c.key === "d0_30" || c.key === "d31_60";
          return `
          <div class="finance-aging-row ${late ? "finance-aging-row--late" : warn ? "finance-aging-row--warn" : ""}">
            <span>${esc(c.label)}</span>
            <div class="finance-aging-track"><span style="width:${((value / max) * 100).toFixed(1)}%"></span></div>
            <span class="finance-aging-value">${esc(compact(value))}</span>
          </div>`;
        })
        .join("")}
    </div>`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  const wrap = document.getElementById("ovProjects");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar overview…</div>`;
  try {
    const data = await apiRequest("/finance/overview");
    state.data = data;
    renderHero(data);
    renderCards(data);
    renderProjects(data);
    renderCash(data);
    renderAging(data);
    await renderCharts();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o overview financeiro.", { type: "error" });
  }
}

/** Seletor 6 / 12 meses do gráfico de evolução. */
function wireRangeToggle() {
  const seg = document.getElementById("ovRange");
  if (!seg) return;
  seg.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const months = Number(btn.dataset.months) || 12;
      if (months === state.months) return;
      state.months = months;
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      renderFlowChart();
    });
  });
}

export async function render() {
  destroyCharts();
  state.months = 12;
  renderShell();
  wireRangeToggle();
  await load();
}
