import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawBarChart, drawComboChart, destroyCharts, TONES } from "./charts.js";
import { kpiCardsHtml, meterHtml as meter, num, skeletonHtml, stripHtml, toneOf } from "./widgets.js";

/**
 * Ecrã «Controlo Financeiro».
 *
 * Confronta o previsto com o realizado tendo em conta o avanço da obra:
 *  - custo esperado à data = orçamento de custo × avanço (físico; sem ele, a
 *    tabela de quantidades; em último caso, a faturação);
 *  - desvio à data = realizado − esperado (positivo = gasta acima do que devia
 *    para o que já está feito). Obras sem avanço não entram no desvio à data;
 *  - custo final previsto = realizado + comprometido, nunca abaixo do orçamento;
 *  - resultado = faturado − custo realizado, ambos sem IVA (o IVA dedutível
 *    dos pagamentos sai do custo).
 */

/** Desvio (em % do esperado / do orçamento) a partir do qual se avisa. */
const DEVIATION_ALERT_PCT = 5;
/** Margem realizada abaixo da prevista, em pontos percentuais, que gera aviso. */
const MARGIN_GAP_ALERT = 5;

const PROGRESS_SOURCE = {
  FISICO: "avanço físico",
  QUANTIDADES: "pelas quantidades",
  FATURACAO: "pela faturação",
  SEM_AVANCO: "sem avanço",
};

const state = {
  months: 12,
  query: "",
  scope: "active",
  sort: "deviation",
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

function signedPct(value) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${pct(n)}`;
}

/** Custo acima do esperado é mau (vermelho); abaixo é bom (verde). */
function costTone(value) {
  const n = num(value);
  if (n > 0.005) return "neg";
  if (n < -0.005) return "pos";
  return "muted";
}

function hasMovement(p) {
  return [p.forecastCost, p.realizedCost, p.committedCost, p.saleForecast, p.revenue].some((v) => num(v) > 0);
}

function isTracked(p) {
  return p.deviationToDate !== null && p.deviationToDate !== undefined && num(p.forecastCost) > 0;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div id="ctrlKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>
      <div id="ctrlStrip" class="ov-strip">${skeletonHtml(6, "cell")}</div>

      <div class="ov-row ov-row--8-4">
        ${chartCardHtml({
          id: "ctrlChartMonthly",
          title: "Faturado, recebido e custo",
          subtitle: "Por mês · a linha é o resultado acumulado (faturado − custo)",
          hint: "Custo pela data do custo, com IVA (como saiu do caixa). O resultado dos cartões de cima é sem IVA.",
          height: 280,
          actionsHtml: `
            <div class="finance-seg finance-seg--sm" id="ctrlRange">
              <button type="button" data-months="6">6M</button>
              <button type="button" data-months="12" class="active">12M</button>
            </div>`,
          beforeChartHtml: `<div id="ctrlFlowTotals" class="ov-flow-totals"></div>`,
        })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head">
            <div>
              <h2 class="finance-chart-title">Onde atuar</h2>
              <p class="finance-chart-subtitle">Obras com desvio, margem abaixo da prevista ou dados em falta</p>
            </div>
          </header>
          <ul id="ctrlAlerts" class="ov-alerts">${skeletonHtml(3, "line")}</ul>
        </section>
      </div>

      <div class="ov-row ov-row--6-6">
        ${chartCardHtml({
          id: "ctrlChartDeviation",
          title: "Desvio de custo à data",
          subtitle: "Realizado − esperado para o avanço de cada obra",
          hint: "Só obras com orçamento de custo e avanço conhecido.",
          height: 300,
        })}
        ${chartCardHtml({
          id: "ctrlChartMargins",
          title: "Margem prevista vs realizada",
          subtitle: "Em % da venda · obras com faturação",
          hint: "Prevista = venda prevista − orçamento de custo. Realizada = faturado − custo realizado, sem IVA.",
          height: 300,
        })}
      </div>

      <section class="finance-card ov-panel" id="ctrlTableCard">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Controlo por obra</h2>
            <p class="finance-chart-subtitle" id="ctrlHint">—</p>
          </div>
          <div class="ov-table-tools">
            <div class="finance-seg finance-seg--sm" id="ctrlScope">
              <button type="button" data-scope="active" class="active"><span>Com movimento</span></button>
              <button type="button" data-scope="all"><span>Todas</span></button>
            </div>
            <select id="ctrlSort" class="finance-select inv-filter" title="Ordenar">
              <option value="deviation">Maior desvio à data</option>
              <option value="eac">Maior derrapagem final</option>
              <option value="margin">Menor margem</option>
              <option value="sale">Maior venda prevista</option>
            </select>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="ctrlSearch" type="search" placeholder="Obra ou código…" autocomplete="off" />
            </label>
          </div>
        </header>
        <div id="ctrlTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  document.querySelectorAll("#ctrlRange button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.months = Number(btn.dataset.months);
      document.querySelectorAll("#ctrlRange button").forEach((b) => b.classList.toggle("active", b === btn));
      renderMonthly();
    });
  });
  document.querySelectorAll("#ctrlScope button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scope = btn.dataset.scope;
      document.querySelectorAll("#ctrlScope button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });
  document.getElementById("ctrlSort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderTable();
  });
  document.getElementById("ctrlSearch").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderTable();
  });
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis() {
  const t = state.data.totals || {};
  const items = state.data.byProject || [];
  const tracked = items.filter(isTracked);
  const untracked = items.filter((p) => !isTracked(p) && num(p.realizedCost) > 0).length;
  const marginGap = num(t.marginBase) - num(t.plannedMarginPct);
  const cashNet = num(t.received) - num(t.realizedCost);
  // Só as obras com avanço: realizado delas = esperado + desvio.
  const trackedRealized = num(t.expectedCost) + num(t.deviationToDate);
  const realizedVsExpected = num(t.expectedCost) > 0 ? (trackedRealized / num(t.expectedCost)) * 100 : 0;

  const cards = [
    {
      key: "result",
      label: "Resultado (sem IVA)",
      icon: "trending_up",
      tone: num(t.resultBase) >= 0 ? "emerald" : "red",
      value: compact(t.resultBase),
      badge: pct(t.marginBase),
      badgeTone: marginGap >= 0 ? "emerald" : "amber",
      body: `
        <div class="ov-kpi-compare">
          <span>Faturado ${esc(compact(t.revenue))} − custo ${esc(compact(t.realizedCostBase))}</span>
        </div>`,
      foot: `Margem prevista ${pct(t.plannedMarginPct)}`,
    },
    {
      key: "deviation",
      label: "Desvio de custo à data",
      icon: "rule",
      tone: num(t.deviationToDate) > 0 ? "red" : "emerald",
      value: tracked.length ? signed(t.deviationToDate) : "—",
      badge: tracked.length ? signedPct(t.deviationToDatePct) : null,
      badgeTone: num(t.deviationToDatePct) > DEVIATION_ALERT_PCT ? "red" : num(t.deviationToDate) > 0 ? "amber" : "emerald",
      body: tracked.length
        ? meter([{ value: Math.min(realizedVsExpected, 100), tone: num(t.deviationToDate) > 0 ? "red" : "blue" }], { marker: 100 / Math.max(realizedVsExpected / 100, 1), title: "Realizado face ao esperado" })
        : `<div class="ov-kpi-compare"><span>Nenhuma obra com avanço registado</span></div>`,
      foot: tracked.length
        ? `Gasto ${compact(trackedRealized)} de ${compact(t.expectedCost)} esperado · ${tracked.length} obra${tracked.length === 1 ? "" : "s"}${untracked ? ` · ${untracked} sem avanço` : ""}`
        : "Registe o avanço físico nas obras",
    },
    {
      key: "eac",
      label: "Custo final previsto",
      icon: "flag",
      tone: num(t.eacDeviation) > 0 ? "amber" : "blue",
      value: compact(t.eac),
      badge: num(t.eacDeviation) > 0 ? signedPct(t.eacDeviationPct) : "No orçamento",
      badgeTone: num(t.eacDeviation) > 0 ? "red" : "emerald",
      body: `
        <div class="ov-kpi-compare">
          <span>Orçamento de custo ${esc(compact(t.forecastCost))}</span>
        </div>`,
      foot: num(t.eacDeviation) > 0 ? `${signed(t.eacDeviation)} acima do orçamento` : "Realizado + comprometido dentro do orçamento",
    },
    {
      key: "cash",
      label: "Caixa das obras",
      icon: "account_balance_wallet",
      tone: cashNet >= 0 ? "violet" : "red",
      value: signed(cashNet),
      body: `
        <div class="ov-kpi-compare">
          <span>Recebido ${esc(compact(t.received))} − pago ${esc(compact(t.realizedCost))}</span>
        </div>`,
      foot: num(t.revenue) > 0 ? `${pct((num(t.received) / num(t.revenue)) * 100)} do faturado recebido` : "Sem faturação",
    },
  ];
  document.getElementById("ctrlKpis").innerHTML = kpiCardsHtml(cards, "ctrl");
}

function renderStrip() {
  const t = state.data.totals || {};
  const executed = num(t.saleForecast) > 0 ? (num(t.revenue) / num(t.saleForecast)) * 100 : 0;
  const consumed = num(t.forecastCost) > 0 ? ((num(t.realizedCost) + num(t.committedCost)) / num(t.forecastCost)) * 100 : 0;
  document.getElementById("ctrlStrip").innerHTML = stripHtml([
    { label: "Venda prevista", icon: "request_quote", value: compact(t.saleForecast), sub: "Tabela de quantidades", title: money(t.saleForecast) },
    { label: "Faturado", icon: "receipt_long", value: compact(t.revenue), sub: `${pct(executed)} da venda`, href: "/Financeiro/faturacao", title: money(t.revenue) },
    { label: "Por faturar", icon: "pending_actions", value: compact(t.toInvoice), sub: "Venda ainda por faturar", subTone: num(t.toInvoice) > 0 ? "warn" : null, title: money(t.toInvoice) },
    { label: "Orçamento de custo", icon: "account_tree", value: compact(t.forecastCost), sub: "Centros de custo", title: money(t.forecastCost) },
    { label: "Custo realizado", icon: "payments", value: compact(t.realizedCost), sub: `IVA dedutível ${compact(num(t.realizedCost) - num(t.realizedCostBase))}`, href: "/Financeiro/custos/realizados", title: money(t.realizedCost) },
    { label: "Comprometido", icon: "hourglass_top", value: compact(t.committedCost), sub: `${pct(consumed)} do orçamento usado`, subTone: consumed > 100 ? "neg" : null, href: "/Financeiro/contas?tab=pagar", title: money(t.committedCost) },
  ]);
}

/* ─── Alertas ─────────────────────────────────────────────────────────────── */

function buildAlerts() {
  const alerts = [];
  (state.data.byProject || []).forEach((p) => {
    const name = p.project.name;
    if (isTracked(p) && num(p.deviationToDatePct) > DEVIATION_ALERT_PCT) {
      alerts.push({
        tone: "red",
        icon: "trending_up",
        weight: num(p.deviationToDate),
        title: `${name}: custo acima do avanço`,
        text: `${signed(p.deviationToDate)} (${signedPct(p.deviationToDatePct)}) face ao esperado para ${pct(p.progressPct, 0)} de avanço`,
        project: name,
      });
    }
    if (num(p.eacDeviation) > 0 && num(p.eacDeviationPct) > DEVIATION_ALERT_PCT) {
      alerts.push({
        tone: "red",
        icon: "flag",
        weight: num(p.eacDeviation),
        title: `${name}: vai ultrapassar o orçamento`,
        text: `Realizado + comprometido ${compact(p.eac)} · ${signed(p.eacDeviation)} acima`,
        project: name,
      });
    }
    if (num(p.revenue) > 0 && num(p.saleForecast) > 0 && num(p.plannedMarginPct) - num(p.marginBase) > MARGIN_GAP_ALERT) {
      alerts.push({
        tone: "amber",
        icon: "percent",
        weight: num(p.revenue),
        title: `${name}: margem abaixo da prevista`,
        text: `Realizada ${pct(p.marginBase)} contra ${pct(p.plannedMarginPct)} prevista`,
        project: name,
      });
    }
    if (num(p.realizedCost) > 0 && num(p.forecastCost) <= 0) {
      alerts.push({
        tone: "amber",
        icon: "account_tree",
        weight: num(p.realizedCost),
        title: `${name}: custos sem orçamento`,
        text: `${compact(p.realizedCost)} gastos sem orçamento de custo nos centros de custo`,
        project: name,
      });
    } else if (num(p.realizedCost) > 0 && p.progressSource === "SEM_AVANCO") {
      alerts.push({
        tone: "amber",
        icon: "construction",
        weight: num(p.realizedCost) / 2,
        title: `${name}: sem avanço registado`,
        text: `${compact(p.realizedCost)} gastos — registe o avanço físico para medir o desvio`,
        project: name,
      });
    }
    if (num(p.revenue) > 0 && num(p.saleForecast) <= 0) {
      alerts.push({
        tone: "amber",
        icon: "request_quote",
        weight: num(p.revenue) / 4,
        title: `${name}: faturação sem venda prevista`,
        text: `${compact(p.revenue)} faturados sem tabela de quantidades nem valor global`,
        project: name,
      });
    }
  });
  return alerts.sort((a, b) => (a.tone === b.tone ? b.weight - a.weight : a.tone === "red" ? -1 : 1));
}

function renderAlerts() {
  const alerts = buildAlerts();
  const list = document.getElementById("ctrlAlerts");
  if (!alerts.length) {
    list.innerHTML = `<li class="ov-empty"><span class="material-symbols-outlined">verified</span>Tudo dentro do previsto.</li>`;
    return;
  }
  const shown = alerts.slice(0, 5);
  list.innerHTML =
    shown
      .map(
        (a) => `
      <li>
        <a class="ov-alert ov-alert--${a.tone}" href="#ctrlTableCard" data-project="${esc(a.project)}">
          <span class="ov-alert-icon"><span class="material-symbols-outlined">${a.icon}</span></span>
          <span class="ov-alert-text">
            <strong>${esc(a.title)}</strong>
            <span title="${esc(a.text)}">${esc(a.text)}</span>
          </span>
          <span class="material-symbols-outlined ov-alert-go">chevron_right</span>
        </a>
      </li>`
      )
      .join("") +
    (alerts.length > shown.length ? `<li class="ov-table-more">+${alerts.length - shown.length} avisos na tabela abaixo</li>` : "");

  list.querySelectorAll("[data-project]").forEach((a) =>
    a.addEventListener("click", () => {
      state.query = a.dataset.project;
      state.scope = "all";
      document.getElementById("ctrlSearch").value = state.query;
      document.querySelectorAll("#ctrlScope button").forEach((b) => b.classList.toggle("active", b.dataset.scope === "all"));
      renderTable();
    })
  );
}

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

function renderMonthly() {
  const monthly = (state.data.charts?.monthly || []).slice(-state.months);
  const sum = (key) => monthly.reduce((a, m) => a + num(m[key]), 0);
  const invoiced = sum("invoiced");
  const received = sum("received");
  const cost = sum("cost");
  document.getElementById("ctrlFlowTotals").innerHTML = [
    { label: "Faturado", value: invoiced, tone: "blue" },
    { label: "Recebido", value: received, tone: "emerald" },
    { label: "Custo", value: cost, tone: "red" },
    { label: "Resultado", value: invoiced - cost, tone: invoiced - cost >= 0 ? "emerald" : "red" },
  ]
    .map(
      (c) => `
      <div class="ov-flow-total">
        <span><i class="ov-dot ov-dot--${c.tone}"></i>${c.label}</span>
        <strong class="${c.label === "Resultado" ? `ov-${toneOf(c.value)}` : ""}">${esc(compact(c.value))}</strong>
      </div>`
    )
    .join("");

  let running = 0;
  drawComboChart("ctrlChartMonthly", {
    categories: monthly.map((m) => m.label),
    height: 280,
    series: [
      { name: "Faturado", type: "column", data: monthly.map((m) => num(m.invoiced)), color: TONES.blue },
      { name: "Recebido", type: "column", data: monthly.map((m) => num(m.received)), color: TONES.emerald },
      { name: "Custo", type: "column", data: monthly.map((m) => num(m.cost)), color: TONES.red },
      {
        name: "Resultado acumulado",
        type: "line",
        data: monthly.map((m) => {
          running += num(m.invoiced) - num(m.cost);
          return Math.round(running);
        }),
        color: TONES.violet,
      },
    ],
  });
}

function shortName(p) {
  const name = p.project.name || p.project.code || "—";
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

function renderCharts() {
  renderMonthly();

  const tracked = (state.data.byProject || [])
    .filter(isTracked)
    .sort((a, b) => Math.abs(num(b.deviationToDate)) - Math.abs(num(a.deviationToDate)))
    .slice(0, 8);
  drawBarChart("ctrlChartDeviation", {
    categories: tracked.map(shortName),
    horizontal: true,
    stacked: true,
    height: Math.max(220, tracked.length * 44 + 90),
    series: [
      { name: "Acima do esperado", data: tracked.map((p) => Math.max(num(p.deviationToDate), 0)), color: TONES.red },
      { name: "Abaixo do esperado", data: tracked.map((p) => Math.min(num(p.deviationToDate), 0)), color: TONES.emerald },
    ],
  });

  const billed = (state.data.byProject || [])
    .filter((p) => num(p.revenue) > 0 || num(p.saleForecast) > 0)
    .sort((a, b) => num(b.saleForecast) + num(b.revenue) - (num(a.saleForecast) + num(a.revenue)))
    .slice(0, 8);
  drawBarChart("ctrlChartMargins", {
    categories: billed.map(shortName),
    height: 300,
    percent: true,
    series: [
      { name: "Margem prevista", data: billed.map((p) => (num(p.saleForecast) > 0 ? num(p.plannedMarginPct) : 0)), color: "#c4b5fd" },
      { name: "Margem realizada", data: billed.map((p) => (num(p.revenue) > 0 ? num(p.marginBase) : 0)), color: TONES.violet },
    ],
  });
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function sortValue(p) {
  if (state.sort === "eac") return num(p.eacDeviation);
  if (state.sort === "margin") return num(p.revenue) > 0 ? -num(p.marginBase) : -Infinity;
  if (state.sort === "sale") return num(p.saleForecast);
  return isTracked(p) ? num(p.deviationToDate) : -Infinity;
}

function progressCell(p) {
  if (p.progressSource === "SEM_AVANCO") return `<span class="ov-muted">Sem avanço</span>`;
  return `
    <div class="ov-cell-bar">
      <span>${esc(pct(p.progressPct, 0))}</span>
      ${meter([{ value: p.progressPct, tone: "violet" }])}
      <small>${esc(PROGRESS_SOURCE[p.progressSource] || "")}</small>
    </div>`;
}

function realizedCell(p, cur) {
  const budget = num(p.forecastCost);
  const realized = num(p.realizedCost);
  const committed = num(p.committedCost);
  if (budget <= 0) {
    return realized > 0 ? `<span>${esc(money(realized, cur))}</span>` : `<span class="ov-muted">—</span>`;
  }
  const rPct = (realized / budget) * 100;
  const over = isTracked(p) && num(p.deviationToDate) > 0;
  return `
    <div class="ov-cell-bar">
      <span>${esc(money(realized, cur))}</span>
      ${meter(
        [
          { value: rPct, tone: over ? "red" : "blue" },
          { value: (committed / budget) * 100, tone: "amber-soft" },
        ],
        { marker: isTracked(p) ? p.progressPct : null, title: "Marcador = avanço da obra (onde o realizado devia estar)" }
      )}
      <small>${esc(pct(rPct))} de ${esc(compact(budget))}${committed > 0 ? ` · +${esc(compact(committed))} compr.` : ""}</small>
    </div>`;
}

function deviationCell(p) {
  if (!isTracked(p)) return `<span class="ov-muted">—</span>`;
  const tone = costTone(p.deviationToDate);
  return `
    <div class="co-dev">
      <strong class="ov-${tone}">${esc(signed(p.deviationToDate))}</strong>
      <small class="ov-${tone}">${esc(signedPct(p.deviationToDatePct))} · esperado ${esc(compact(p.expectedCost))}</small>
    </div>`;
}

function eacCell(p, cur) {
  if (num(p.forecastCost) <= 0) return `<span class="ov-muted">Sem orçamento</span>`;
  const over = num(p.eacDeviation) > 0;
  return `
    <div class="co-dev">
      <strong>${esc(money(p.eac, cur))}</strong>
      <small class="ov-${over ? "neg" : "muted"}">${over ? `${esc(signed(p.eacDeviation))} · ${esc(signedPct(p.eacDeviationPct))}` : `de ${esc(compact(p.forecastCost))}`}</small>
    </div>`;
}

function revenueCell(p, cur) {
  const sale = num(p.saleForecast);
  const revenue = num(p.revenue);
  if (sale <= 0 && revenue <= 0) return `<span class="ov-muted">—</span>`;
  if (sale <= 0) {
    return `<div class="co-dev"><strong>${esc(money(revenue, cur))}</strong><small class="ov-warn">sem venda prevista</small></div>`;
  }
  const iPct = (revenue / sale) * 100;
  return `
    <div class="ov-cell-bar">
      <span>${esc(money(revenue, cur))}</span>
      ${meter(
        [
          { value: (num(p.received) / sale) * 100, tone: "emerald" },
          { value: iPct - (num(p.received) / sale) * 100, tone: "blue" },
        ],
        { title: "Verde = recebido · azul = faturado por receber" }
      )}
      <small>${esc(pct(iPct))} de ${esc(compact(sale))}</small>
    </div>`;
}

function marginCell(p) {
  const hasRevenue = num(p.revenue) > 0;
  const hasPlan = num(p.saleForecast) > 0;
  if (!hasRevenue && !hasPlan) return `<span class="ov-muted">—</span>`;
  if (!hasRevenue) {
    return `<div class="co-dev"><span class="ov-muted">Sem faturação</span><small>prevista ${esc(pct(p.plannedMarginPct))}</small></div>`;
  }
  const below = hasPlan && num(p.plannedMarginPct) - num(p.marginBase) > MARGIN_GAP_ALERT;
  return `
    <div class="co-dev">
      <strong class="ov-${toneOf(p.resultBase)}">${esc(compact(p.resultBase))} · ${esc(pct(p.marginBase))}</strong>
      <small class="${below ? "ov-warn" : "ov-muted"}">${hasPlan ? `prevista ${esc(pct(p.plannedMarginPct))}` : "sem margem prevista"}</small>
    </div>`;
}

function renderTable() {
  const wrap = document.getElementById("ctrlTable");
  const q = state.query.trim().toLowerCase();
  const rows = (state.data?.byProject || [])
    .filter((p) => (state.scope === "active" ? hasMovement(p) : true))
    .filter((p) => !q || [p.project.name, p.project.code, p.project.client?.name].some((v) => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => sortValue(b) - sortValue(a));

  document.getElementById("ctrlHint").textContent =
    `${rows.length} obras · esperado = orçamento de custo × avanço · resultado sem IVA`;

  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">apartment</span>Sem obras para os filtros.</div>`;
    return;
  }

  const body = rows
    .map((p) => {
      const cur = p.project.currency || "AOA";
      return `
      <tr>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(p.project.name)}</span>
            <span class="ov-project-meta">${esc([p.project.code, p.project.client?.name].filter(Boolean).join(" · "))}</span>
          </div>
        </td>
        <td>${progressCell(p)}</td>
        <td class="fin-num">${realizedCell(p, cur)}</td>
        <td class="fin-num">${deviationCell(p)}</td>
        <td class="fin-num">${eacCell(p, cur)}</td>
        <td class="fin-num">${revenueCell(p, cur)}</td>
        <td class="fin-num">${marginCell(p)}</td>
      </tr>`;
    })
    .join("");

  const sum = (fn) => rows.reduce((a, p) => a + fn(p), 0);
  const tDev = sum((p) => (isTracked(p) ? num(p.deviationToDate) : 0));
  const tRevenue = sum((p) => num(p.revenue));
  const tResult = sum((p) => num(p.resultBase));
  wrap.innerHTML = `
    <table class="fin-table co-table ctrl-table">
      <thead><tr>
        <th>Obra</th>
        <th>Avanço</th>
        <th style="text-align:right">Realizado</th>
        <th style="text-align:right" title="Realizado − orçamento × avanço">Desvio à data</th>
        <th style="text-align:right" title="Realizado + comprometido, nunca abaixo do orçamento">Custo final previsto</th>
        <th style="text-align:right">Faturado</th>
        <th style="text-align:right" title="Faturado − custo realizado, sem IVA">Resultado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais (${rows.length} obras)</td>
        <td></td>
        <td class="fin-num">${esc(compact(sum((p) => num(p.realizedCost))))}</td>
        <td class="fin-num ov-${costTone(tDev)}">${esc(signed(tDev))}</td>
        <td class="fin-num">${esc(compact(sum((p) => num(p.eac))))}</td>
        <td class="fin-num">${esc(compact(tRevenue))}</td>
        <td class="fin-num ov-${toneOf(tResult)}">${esc(compact(tResult))}${tRevenue > 0 ? ` · ${esc(pct((tResult / tRevenue) * 100))}` : ""}</td>
      </tr></tfoot>
    </table>`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  try {
    state.data = await apiRequest("/finance/control");
    renderKpis();
    renderStrip();
    renderAlerts();
    renderTable();
    renderCharts();
  } catch (err) {
    const wrap = document.getElementById("ctrlTable");
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o controlo financeiro.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  renderShell();
  await load();
}
