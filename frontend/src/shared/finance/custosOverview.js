import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawBarChart, drawComboChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";
import { AGING_TONES } from "./aging.js";
import { drawKpiSparks, kpiCardsHtml, meterHtml as meter, num, skeletonHtml, stripHtml, toneOf } from "./widgets.js";
import { COST_TYPES } from "./costForm.js";

/**
 * Ecrã «Overview Custos» (Financeiro · Custos).
 *
 *  - Previsto   → orçamento de custo dos centros de custo da obra (baseline)
 *  - Realizado  → dinheiro que saiu + mercadoria consumida na obra
 *  - Comprometido → assumido e ainda por pagar (pagamentos abertos, pedidos
 *    extra aprovados, encomendas, fretes)
 *  - Projeção   → realizado + comprometido; o desvio projetado compara-a com
 *    o previsto (positivo = a obra vai gastar acima do orçamento)
 *
 * A mercadoria paga e ainda em armazém não é custo da obra: aparece à parte.
 */

const state = {
  months: 12,
  query: "",
  scope: "active",
  sort: "projected",
  data: null,
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

function signed(value) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${compact(n)}`;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div id="coKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>
      <div id="coStrip" class="ov-strip">${skeletonHtml(6, "cell")}</div>

      <div class="ov-row ov-row--8-4">
        ${chartCardHtml({
          id: "coChartMonthly",
          title: "Custo realizado vs comprometido",
          subtitle: "Por mês, pela data do custo",
          hint: "Comprometido é o que já está assumido (pagamentos abertos, pedidos extra aprovados, encomendas) e ainda não saiu do caixa.",
          height: 280,
          actionsHtml: `
            <div class="finance-seg finance-seg--sm" id="coRange">
              <button type="button" data-months="6">6M</button>
              <button type="button" data-months="12" class="active">12M</button>
            </div>`,
          beforeChartHtml: `<div id="coFlowTotals" class="ov-flow-totals"></div>`,
        })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head finance-chart-head--row">
            <div>
              <h2 class="finance-chart-title">Por pagar</h2>
              <p class="finance-chart-subtitle">Comprometido por antiguidade da data do custo</p>
            </div>
            <a class="ov-link" href="/Financeiro/custos/registar?view=committed">Custos <span class="material-symbols-outlined">arrow_forward</span></a>
          </header>
          <div id="coAging">${skeletonHtml(3, "line")}</div>
        </section>
      </div>

      <div class="ov-row ov-row--6-6">
        ${chartCardHtml({
          id: "coChartProjects",
          title: "Previsto vs projeção por obra",
          subtitle: "Realizado + comprometido face ao orçamento de custo · 8 maiores obras",
          height: 300,
        })}
        ${chartCardHtml({ id: "coChartType", title: "Realizado por tipo de custo", subtitle: "Serviço, material, mão de obra…", height: 300 })}
      </div>

      <div class="ov-row ov-row--6-6">
        ${chartCardHtml({ id: "coChartSources", title: "Custo por fonte", subtitle: "Realizado e comprometido por área de origem", height: 280 })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head finance-chart-head--row">
            <div>
              <h2 class="finance-chart-title">Maiores centros de custo</h2>
              <p class="finance-chart-subtitle">Realizado acumulado por centro de custo da obra</p>
            </div>
            <a class="ov-link" href="/Financeiro/custos/realizados">Realizados <span class="material-symbols-outlined">arrow_forward</span></a>
          </header>
          <div id="coCenters">${skeletonHtml(4, "line")}</div>
        </section>
      </div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Custos por obra</h2>
            <p class="finance-chart-subtitle" id="coHint">—</p>
          </div>
          <div class="ov-table-tools">
            <div class="finance-seg finance-seg--sm" id="coScope" title="Obras com orçamento ou custos">
              <button type="button" data-scope="active" class="active">Com movimento</button>
              <button type="button" data-scope="all">Todas</button>
            </div>
            <select id="coSort" class="finance-select inv-filter" title="Ordenar">
              <option value="projected">Maior projeção</option>
              <option value="deviation">Maior desvio projetado</option>
              <option value="forecast">Maior orçamento</option>
              <option value="pending">Mais por confirmar</option>
            </select>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="coSearch" type="search" placeholder="Obra ou código…" autocomplete="off" />
            </label>
          </div>
        </header>
        <div id="coTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  document.querySelectorAll("#coRange button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.months = Number(btn.dataset.months);
      document.querySelectorAll("#coRange button").forEach((b) => b.classList.toggle("active", b === btn));
      renderMonthly();
    });
  });
  document.querySelectorAll("#coScope button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scope = btn.dataset.scope;
      document.querySelectorAll("#coScope button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });
  document.getElementById("coSort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderTable();
  });
  let timer = null;
  document.getElementById("coSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      renderTable();
    }, 150);
  });
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis() {
  const t = state.data?.totals || {};
  const projects = state.data?.items || [];
  const monthly = state.data?.charts?.monthly || [];
  const forecast = num(t.forecast);
  const realized = num(t.realized);
  const committed = num(t.committed);
  const projected = num(t.projected) || realized + committed;
  const realizedPct = forecast > 0 ? (realized / forecast) * 100 : 0;
  const committedPct = forecast > 0 ? (committed / forecast) * 100 : 0;
  const projectedPct = forecast > 0 ? (projected / forecast) * 100 : 0;
  const deviation = projected - forecast;
  const over = projects.filter((p) => num(p.forecast) > 0 && num(p.realized) + num(p.committed) > num(p.forecast)).length;
  const withBudget = projects.filter((p) => num(p.forecast) > 0).length;
  const confirmedPct = realized > 0 ? (num(t.confirmed) / realized) * 100 : 0;

  const cards = [
    {
      key: "forecast",
      label: "Custo previsto",
      icon: "target",
      tone: "violet",
      value: money(forecast),
      badge: `${withBudget}/${projects.length} obras`,
      badgeTone: "violet",
      body: `
        <dl class="ov-kpi-split">
          <div><dt>Venda prevista</dt><dd>${esc(compact(t.saleForecast))}</dd></div>
          <div><dt>Margem prevista</dt><dd class="ov-${toneOf(t.plannedMargin)}">${esc(compact(t.plannedMargin))} · ${esc(pct(t.plannedMarginPct))}</dd></div>
        </dl>`,
    },
    {
      key: "realized",
      label: "Custo realizado",
      icon: "payments",
      tone: "blue",
      value: money(realized),
      badge: forecast > 0 ? `${pct(realizedPct)} do previsto` : "sem previsto",
      badgeTone: realizedPct > 100 ? "red" : "blue",
      body: `
        ${meter([{ value: realizedPct, tone: realizedPct > 100 ? "red" : "blue" }], { marker: forecast > 0 ? 100 : null })}
        <p class="ov-kpi-compare"><strong class="${confirmedPct < 100 ? "ov-warn" : "ov-pos"}">${esc(pct(confirmedPct, 0))}</strong> confirmado pelo financeiro</p>`,
      spark: monthly.length > 1 ? { data: monthly.map((m) => num(m.cost)), color: TONES.blue } : null,
    },
    {
      key: "committed",
      label: "Comprometido",
      icon: "lock_clock",
      tone: "amber",
      value: money(committed),
      badge: `projeção ${compact(projected)}`,
      badgeTone: "amber",
      body: `
        ${meter(
          [
            { value: realizedPct, tone: "blue" },
            { value: committedPct, tone: "amber-soft" },
          ],
          { marker: forecast > 0 ? 100 : null, title: "Realizado + comprometido face ao previsto" }
        )}
        <p class="ov-kpi-compare">
          <span class="ov-legend"><i class="ov-dot ov-dot--blue"></i>Realizado</span>
          <span class="ov-legend" style="margin-left:0.6rem"><i class="ov-dot ov-dot--amber"></i>Comprometido</span>
        </p>`,
    },
    {
      key: "deviation",
      label: "Desvio projetado",
      icon: deviation > 0 ? "trending_up" : "trending_down",
      tone: deviation > 0 ? "red" : "emerald",
      value: forecast > 0 ? money(deviation) : "—",
      badge: forecast > 0 ? pct(projectedPct - 100) : "",
      badgeTone: deviation > 0 ? "red" : "emerald",
      body: `<p class="ov-kpi-compare">${
        forecast > 0
          ? over
            ? `<strong class="ov-neg">${over} obra${over === 1 ? "" : "s"}</strong> vão gastar acima do orçamento`
            : `<strong class="ov-pos">Todas as obras</strong> dentro do orçamento de custo`
          : "Defina o orçamento dos centros de custo para medir o desvio."
      }</p>`,
    },
  ];
  document.getElementById("coKpis").innerHTML = kpiCardsHtml(cards, "co");
  drawKpiSparks(cards, "co");
}

function renderStrip() {
  const t = state.data?.totals || {};
  const a = state.data?.actions || {};
  const g = state.data?.general || {};
  document.getElementById("coStrip").innerHTML = stripHtml([
    {
      label: "A tratar",
      icon: "pending_actions",
      value: String(num(a.count)),
      valueTone: num(a.count) ? "warn" : null,
      sub: num(a.count) ? `${compact(a.value)} por confirmar` : "tudo confirmado",
      href: "/Financeiro/custos/registar?view=action",
    },
    {
      label: "Sem nº fatura",
      icon: "receipt_long",
      value: String(num(a.missingDoc)),
      valueTone: num(a.missingDoc) ? "warn" : null,
      sub: "registar o documento",
      href: "/Financeiro/custos/registar?view=missingDoc",
    },
    {
      label: "ATM por discriminar",
      icon: "atm",
      value: String(num(a.toDiscriminate)),
      valueTone: num(a.toDiscriminate) ? "neg" : null,
      sub: num(a.toDiscriminate) ? "itens por fornecedor e categoria" : "tudo discriminado",
      href: "/Financeiro/custos/registar?view=atm",
    },
    {
      label: "Mercadoria em stock",
      icon: "inventory_2",
      value: compact(t.stockPurchases),
      sub: "paga, ainda não consumida",
      href: "/Financeiro/custos/registar?view=stock",
    },
    {
      label: "Consumo de stock",
      icon: "conveyor_belt",
      value: compact(t.stockConsumption),
      sub: num(a.noUnitCost) ? `${num(a.noUnitCost)} saídas sem custo unitário` : "custo médio das entradas",
      subTone: num(a.noUnitCost) ? "warn" : null,
    },
    {
      label: "Estrutura geral",
      icon: "domain",
      value: compact(g.realized),
      sub: num(g.committed) ? `${compact(g.committed)} comprometido` : "centros de custo gerais",
    },
  ]);
}

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

async function emptyChart(id, icon, message) {
  await drawBarChart(id, {});
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">${icon}</span>${esc(message)}</div>`;
}

function renderMonthly() {
  const months = (state.data?.charts?.monthly || []).slice(-state.months);
  const cost = months.reduce((a, m) => a + num(m.cost), 0);
  const committed = months.reduce((a, m) => a + num(m.committed), 0);
  const invoiced = months.reduce((a, m) => a + num(m.invoiced), 0);
  document.getElementById("coFlowTotals").innerHTML = [
    { label: "Realizado", value: compact(cost), dot: TONES.blue },
    { label: "Comprometido", value: compact(committed), dot: TONES.amber },
    { label: "Faturado no período", value: compact(invoiced), dot: TONES.emerald },
    { label: "Custo / faturado", value: invoiced > 0 ? pct((cost / invoiced) * 100, 0) : "—", dot: TONES.slate },
  ]
    .map((t) => `<div class="ov-flow-total"><span><i style="background:${t.dot}"></i>${esc(t.label)}</span><strong>${esc(t.value)}</strong></div>`)
    .join("");
  drawComboChart("coChartMonthly", {
    categories: months.map((m) => m.label),
    series: [
      { name: "Realizado", type: "column", data: months.map((m) => num(m.cost)), color: TONES.blue },
      { name: "Comprometido", type: "line", data: months.map((m) => num(m.committed)), color: TONES.amber },
    ],
    height: 280,
  });
}

function renderAging() {
  const columns = state.data?.charts?.payablesAging || [];
  const total = columns.reduce((a, col) => a + num(col.value), 0);
  const wrap = document.getElementById("coAging");
  if (total <= 0) {
    wrap.innerHTML = `<div class="ov-empty"><span class="material-symbols-outlined">task_alt</span>Sem valores por pagar.</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="ov-aging-total">
      <strong>${esc(money(total))}</strong>
      <span>comprometido por pagar</span>
    </div>
    <div class="ov-stack">
      ${columns
        .map((col, i) =>
          num(col.value) > 0
            ? `<span style="width:${((num(col.value) / total) * 100).toFixed(2)}%;background:${AGING_TONES[i]}" title="${esc(col.label)}: ${esc(money(col.value))}"></span>`
            : ""
        )
        .join("")}
    </div>
    <ul class="ov-aging-list">
      ${columns
        .map(
          (col, i) => `
        <li>
          <span><i class="ov-dot" style="background:${AGING_TONES[i]}"></i>${esc(col.label)}</span>
          <span class="ov-aging-pct">${esc(pct((num(col.value) / total) * 100, 0))}</span>
          <strong>${esc(compact(col.value))}</strong>
        </li>`
        )
        .join("")}
    </ul>`;
}

function renderCenters() {
  const centers = state.data?.byCenter || [];
  const wrap = document.getElementById("coCenters");
  if (!centers.length) {
    wrap.innerHTML = `<div class="ov-empty"><span class="material-symbols-outlined">account_tree</span>Sem custo realizado por centro de custo.</div>`;
    return;
  }
  const max = Math.max(...centers.map((c) => num(c.realized)), 1);
  wrap.innerHTML = `
    <ul class="co-centers">
      ${centers
        .slice(0, 8)
        .map(
          (c) => `
        <li>
          <div class="co-center-head">
            <span class="co-center-name" title="${esc(c.name)}">${esc(c.code ? `${c.code} · ${c.name}` : c.name)}</span>
            <strong>${esc(compact(c.realized))}</strong>
          </div>
          ${meter([{ value: (num(c.realized) / max) * 100, tone: "blue" }])}
          <small>${esc(c.project?.name || "Estrutura geral")}</small>
        </li>`
        )
        .join("")}
    </ul>`;
}

function renderCharts() {
  renderMonthly();
  renderAging();
  renderCenters();

  const top = [...(state.data?.items || [])]
    .filter((p) => num(p.forecast) > 0 || num(p.realized) + num(p.committed) > 0)
    .sort((a, b) => Math.max(num(b.forecast), num(b.realized) + num(b.committed)) - Math.max(num(a.forecast), num(a.realized) + num(a.committed)))
    .slice(0, 8);
  if (!top.length) {
    emptyChart("coChartProjects", "target", "Sem orçamento de custo nem custos nas obras.");
  } else {
    drawBarChart("coChartProjects", {
      categories: top.map((p) => p.project.code || p.project.name),
      series: [
        { name: "Previsto", data: top.map((p) => num(p.forecast)), color: "#c4b5fd" },
        { name: "Realizado", data: top.map((p) => num(p.realized)), color: TONES.blue },
        { name: "Comprometido", data: top.map((p) => num(p.committed)), color: "#fcd34d" },
      ],
      horizontal: true,
      height: Math.max(220, top.length * 58 + 90),
    });
  }

  const types = (state.data?.byCategory || []).filter((c) => num(c.value) > 0);
  if (!types.length) {
    emptyChart("coChartType", "donut_large", "Sem custo realizado.");
  } else {
    drawDonutChart("coChartType", {
      labels: types.map((c) => COST_TYPES[c.category] || c.category || "Sem tipo"),
      series: types.map((c) => num(c.value)),
      totalLabel: "Realizado",
      height: 300,
    });
  }

  const sources = (state.data?.charts?.costBySource || []).filter((s) => num(s.total) > 0);
  if (!sources.length) {
    emptyChart("coChartSources", "hub", "Sem custos registados.");
  } else {
    drawBarChart("coChartSources", {
      categories: sources.map((s) => s.label || s.source),
      series: [
        { name: "Realizado", data: sources.map((s) => num(s.realized)), color: TONES.blue },
        { name: "Comprometido", data: sources.map((s) => num(s.committed)), color: "#fcd34d" },
      ],
      stacked: true,
      horizontal: true,
      height: Math.max(200, sources.length * 46 + 80),
    });
  }
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function hasMovement(p) {
  return [p.forecast, p.realized, p.committed, p.stockPurchases].some((v) => num(v) > 0);
}

function sortValue(p) {
  if (state.sort === "deviation") return num(p.realized) + num(p.committed) - num(p.forecast);
  if (state.sort === "forecast") return num(p.forecast);
  if (state.sort === "pending") return num(p.pending);
  return num(p.realized) + num(p.committed);
}

function renderTable() {
  const wrap = document.getElementById("coTable");
  const q = state.query.trim().toLowerCase();
  const rows = (state.data?.items || [])
    .filter((p) => (state.scope === "active" ? hasMovement(p) : true))
    .filter((p) => !q || [p.project.name, p.project.code].some((v) => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => sortValue(b) - sortValue(a));

  document.getElementById("coHint").textContent =
    `${rows.length} obras · previsto = orçamento dos centros de custo · projeção = realizado + comprometido`;

  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">apartment</span>Sem obras para os filtros.</div>`;
    return;
  }

  const body = rows
    .map((p) => {
      const cur = p.project.currency || "AOA";
      const forecast = num(p.forecast);
      const realized = num(p.realized);
      const committed = num(p.committed);
      const projected = realized + committed;
      const dev = projected - forecast;
      const rPct = forecast > 0 ? (realized / forecast) * 100 : 0;
      const cPct = forecast > 0 ? (committed / forecast) * 100 : 0;
      const confirmedPct = realized > 0 ? (num(p.confirmed) / realized) * 100 : 0;
      return `
      <tr>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(p.project.name)}</span>
            <span class="ov-project-meta">${esc([p.project.code, p.project.client?.name].filter(Boolean).join(" · "))}</span>
          </div>
        </td>
        <td class="fin-num">${forecast > 0 ? esc(money(forecast, cur)) : `<span class="ov-muted">Sem orçamento</span>`}</td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span>${esc(money(realized, cur))}</span>
            ${forecast > 0 ? meter([{ value: rPct, tone: "blue" }, { value: cPct, tone: "amber-soft" }], { marker: 100 }) : ""}
            <small>${forecast > 0 ? `${esc(pct(rPct))} do previsto` : num(p.stockOutValue) > 0 ? `${esc(compact(p.stockOutValue))} de stock` : "—"}</small>
          </div>
        </td>
        <td class="fin-num ${committed > 0 ? "ov-warn" : "ov-muted"}">${committed > 0 ? esc(money(committed, cur)) : "—"}</td>
        <td class="fin-num">
          ${
            forecast > 0
              ? `<div class="co-dev">
                   <strong class="ov-${dev > 0 ? "neg" : "pos"}">${esc(signed(dev))}</strong>
                   <small class="ov-${dev > 0 ? "neg" : "pos"}">${esc(pct((projected / forecast) * 100 - 100))}</small>
                 </div>`
              : `<span class="ov-muted">—</span>`
          }
        </td>
        <td class="fin-num">
          ${
            realized > 0
              ? `<div class="ov-cell-bar">
                   <span class="${confirmedPct < 100 ? "ov-warn" : "ov-pos"}">${esc(pct(confirmedPct, 0))}</span>
                   ${meter([{ value: confirmedPct, tone: "emerald" }])}
                 </div>`
              : `<span class="ov-muted">—</span>`
          }
        </td>
        <td class="fin-num">${
          num(p.saleForecast) > 0
            ? `<div class="co-dev"><strong class="ov-${toneOf(p.plannedMargin)}">${esc(compact(p.plannedMargin))}</strong><small class="ov-${toneOf(p.plannedMargin)}">${esc(pct(p.plannedMarginPct))}</small></div>`
            : `<span class="ov-muted">—</span>`
        }</td>
      </tr>`;
    })
    .join("");

  const sum = (fn) => rows.reduce((a, p) => a + fn(p), 0);
  const tForecast = sum((p) => num(p.forecast));
  const tRealized = sum((p) => num(p.realized));
  const tCommitted = sum((p) => num(p.committed));
  const tDev = tRealized + tCommitted - tForecast;
  wrap.innerHTML = `
    <table class="fin-table co-table">
      <thead><tr>
        <th>Obra</th>
        <th style="text-align:right">Previsto</th>
        <th style="text-align:right">Realizado</th>
        <th style="text-align:right">Comprometido</th>
        <th style="text-align:right" title="(Realizado + comprometido) − previsto">Desvio projetado</th>
        <th style="text-align:right">Confirmado</th>
        <th style="text-align:right">Margem prevista</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais (${rows.length} obras)</td>
        <td class="fin-num">${esc(money(tForecast))}</td>
        <td class="fin-num">${esc(money(tRealized))}</td>
        <td class="fin-num">${esc(money(tCommitted))}</td>
        <td class="fin-num ov-${tDev > 0 ? "neg" : "pos"}">${esc(money(tDev))}</td>
        <td></td><td></td>
      </tr></tfoot>
    </table>`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  try {
    state.data = await apiRequest("/finance/costs-overview");
    renderKpis();
    renderStrip();
    renderTable();
    renderCharts();
  } catch (err) {
    const wrap = document.getElementById("coTable");
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar overview de custos.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  renderShell();
  await load();
}
