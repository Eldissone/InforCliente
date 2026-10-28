import { apiRequest } from "../../services/api.js";
import { toast, setButtonLoading } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import {
  chartCardHtml,
  compactMoney as compact,
  drawComboChart,
  drawDonutChart,
  destroyCharts,
  TONES,
} from "./charts.js";
import { AGING_TONES } from "./aging.js";
import {
  drawKpiSparks,
  kpiCardsHtml,
  meterHtml as meter,
  num,
  skeletonHtml,
  stripHtml,
  toneOf,
} from "./widgets.js";

/**
 * Ecrã «Overview Financeiro».
 *
 * Painel do gestor financeiro, de cima para baixo:
 *  1. Indicadores principais — receita, custos das obras, resultado
 *     operacional e margem, cada um confrontado com o previsto.
 *  2. Faixa de posição — recebido, por receber, por faturar, comprometido,
 *     por confirmar e saldo de tesouraria (cada um leva ao ecrã onde se atua).
 *  3. Evolução mensal e o quadro «Previsto vs realizado».
 *  4. Antiguidade do que está por receber, custos por fonte e pontos de atenção.
 *  5. Resultado por obra, com pesquisa e ordenação.
 *
 * Todos os números vêm de `/finance/overview` — a mesma fonte do resto da área
 * financeira, para não haver valores diferentes entre ecrãs.
 */

/** Desvio de custo (acima do previsto) a partir do qual uma obra é sinalizada. */
const DEVIATION_ALERT_PCT = 5;
/** Obras visíveis na tabela antes de «Mostrar todas». */
const TABLE_PREVIEW = 10;

const LINKS = {
  received: "/Financeiro/tesouraria/recebimentos",
  receivable: "/Financeiro/contas?tab=receber",
  toInvoice: "/Financeiro/faturacao/prevista",
  committed: "/Financeiro/centro-pagamentos",
  pending: "/Financeiro/custos/registar",
  control: "/Financeiro/controlo",
  invoices: "/Financeiro/faturacao/registar",
};

const state = {
  months: 12,
  data: null,
  table: { query: "", scope: "active", sort: "revenue", dir: "desc", expanded: false },
};

function money(value) {
  return formatCurrency(Number(value) || 0, "AOA");
}

function pct(value, digits = 1) {
  const n = Number(value);
  return `${(Number.isFinite(n) ? n : 0).toFixed(digits)}%`;
}

function signedPp(value) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(1)} pp`;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  const skeleton = (n, variant) => skeletonHtml(n, variant.replace("ov-skeleton--", ""));

  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div id="ovKpis" class="ov-kpis">${skeleton(4, "ov-skeleton--kpi")}</div>
      <div id="ovStrip" class="ov-strip">${skeleton(6, "ov-skeleton--cell")}</div>

      <div class="ov-row ov-row--8-4">
        ${chartCardHtml({
          id: "ovChartFlow",
          title: "Evolução mensal",
          subtitle: "Faturação emitida e custos pagos por mês, com o resultado do mês",
          hint: "Custos = custos das obras + estrutura (centros gerais). Faturação pela data do documento; custos pela data do pagamento.",
          height: 300,
          actionsHtml: `
            <div class="finance-seg finance-seg--sm" id="ovRange">
              <button type="button" data-months="6">6M</button>
              <button type="button" data-months="12" class="active">12M</button>
            </div>`,
          beforeChartHtml: `<div id="ovFlowTotals" class="ov-flow-totals"></div>`,
        })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head">
            <h2 class="finance-chart-title">Previsto vs realizado</h2>
            <p class="finance-chart-subtitle">Orçamento das obras confrontado com o que já aconteceu</p>
          </header>
          <div id="ovPlan" class="ov-plan">${skeleton(4, "ov-skeleton--line")}</div>
        </section>
      </div>

      <div class="ov-row ov-row--3">
        <section class="finance-card ov-panel">
          <header class="finance-chart-head finance-chart-head--row">
            <div>
              <h2 class="finance-chart-title">Contas a receber</h2>
              <p class="finance-chart-subtitle">Valor em falta por antiguidade do vencimento</p>
            </div>
            <a class="ov-link" href="${LINKS.receivable}">Ver <span class="material-symbols-outlined">arrow_forward</span></a>
          </header>
          <div id="ovAging">${skeleton(3, "ov-skeleton--line")}</div>
        </section>
        ${chartCardHtml({
          id: "ovChartSources",
          title: "Custos por fonte",
          subtitle: "Realizado + comprometido, por origem",
          height: 260,
        })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head">
            <h2 class="finance-chart-title">Pontos de atenção</h2>
            <p class="finance-chart-subtitle">O que precisa de ação do financeiro</p>
          </header>
          <ul id="ovAlerts" class="ov-alerts">${skeleton(3, "ov-skeleton--line")}</ul>
        </section>
      </div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Resultado por obra</h2>
            <p class="finance-chart-subtitle">Execução da venda, consumo do orçamento de custo e margem de cada obra</p>
          </div>
          <div class="ov-table-tools">
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="ovSearch" type="search" placeholder="Obra, código ou cliente…" autocomplete="off" />
            </label>
            <div class="finance-seg finance-seg--sm" id="ovScope">
              <button type="button" data-scope="active" class="active">Ativas</button>
              <button type="button" data-scope="all">Todas</button>
            </div>
          </div>
        </header>
        <div id="ovProjects" class="finance-table-scroll"></div>
      </section>
    </div>`;

  wireControls();
}

function renderActions() {
  const actions = document.getElementById("financePageActions");
  if (!actions) return;
  const at = state.data?.generatedAt ? new Date(state.data.generatedAt) : null;
  const time = at && !Number.isNaN(at.getTime())
    ? at.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })
    : "";
  actions.innerHTML = `
    ${time ? `<span class="ov-updated"><span class="material-symbols-outlined">schedule</span>Atualizado às ${esc(time)}</span>` : ""}
    <button id="ovRefresh" type="button" class="finance-btn finance-btn--ghost">
      <span class="material-symbols-outlined">refresh</span>Atualizar
    </button>
    <a class="finance-btn finance-btn--primary" href="${LINKS.control}">
      <span class="material-symbols-outlined">monitoring</span>Controlo financeiro
    </a>`;
  document.getElementById("ovRefresh")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    await load();
    setButtonLoading(btn, false);
  });
}

/* ─── Séries mensais ──────────────────────────────────────────────────────── */

function monthlySlice() {
  const monthly = state.data?.charts?.monthly || [];
  return monthly.slice(Math.max(0, monthly.length - state.months)).map((m) => {
    // Custo sem o IVA dedutível, como o faturado (o resultado compara os dois).
    const projectCost = num(m.costBase ?? m.cost);
    const cost = projectCost + num(m.generalCost);
    return {
      label: m.label,
      invoiced: num(m.invoiced),
      received: num(m.received),
      projectCost,
      cost,
      result: num(m.invoiced) - cost,
    };
  });
}

/* ─── 1. Indicadores principais ───────────────────────────────────────────── */

function renderKpis() {
  const c = state.data.cards || {};
  const months = monthlySlice();
  const period = `${state.months} meses`;
  const sum = (key) => months.reduce((a, m) => a + m[key], 0);

  const executed = num(c.executedPct);
  const consumed = num(c.costConsumedPct);
  const committedPct = num(c.costBudget) > 0 ? (num(c.costCommitted) / num(c.costBudget)) * 100 : 0;
  const overBudget = consumed + committedPct > 100;
  const marginDiff = num(c.margin) - num(c.plannedMarginPct);

  const cards = [
    {
      key: "revenue",
      label: "Receita faturada",
      icon: "receipt_long",
      tone: "blue",
      value: money(c.revenue),
      badge: `${pct(executed)} executado`,
      badgeTone: "blue",
      body: `
        ${meter([{ value: executed, tone: "blue" }])}
        <p class="ov-kpi-compare">de <strong>${esc(compact(c.forecast))}</strong> de venda prevista · faltam ${esc(compact(c.toInvoice))}</p>`,
      spark: { data: months.map((m) => m.invoiced), color: TONES.blue },
      foot: `${period}: ${compact(sum("invoiced"))}`,
    },
    {
      key: "cost",
      label: "Custos das obras",
      icon: "payments",
      tone: overBudget ? "red" : "amber",
      value: money(c.cost),
      badge: `${pct(consumed)} do previsto`,
      badgeTone: overBudget ? "red" : "amber",
      body: `
        ${meter([{ value: consumed, tone: "red" }, { value: committedPct, tone: "amber-soft" }])}
        <p class="ov-kpi-compare">de <strong>${esc(compact(c.costBudget))}</strong> previstos · + ${esc(compact(c.costCommitted))} comprometido</p>${
          num(c.costVat) > 0
            ? `<p class="ov-kpi-compare">Sem IVA · pago com IVA ${esc(compact(c.costPaid))}</p>`
            : ""
        }`,
      spark: { data: months.map((m) => m.projectCost), color: TONES.red },
      foot: `${period}: ${compact(sum("projectCost"))}`,
    },
    {
      key: "operating",
      label: "Resultado operacional",
      icon: "account_balance",
      tone: num(c.operatingResult) >= 0 ? "emerald" : "red",
      value: money(c.operatingResult),
      badge: `Margem ${pct(c.operatingMargin)}`,
      badgeTone: num(c.operatingResult) >= 0 ? "emerald" : "red",
      body: `
        <dl class="ov-kpi-split">
          <div><dt>Resultado das obras</dt><dd class="ov-${toneOf(c.result)}">${esc(compact(c.result))}</dd></div>
          <div><dt>Estrutura (centros gerais)</dt><dd class="ov-neg">− ${esc(compact(c.generalCost))}</dd></div>
        </dl>`,
      spark: { data: months.map((m) => m.result), color: TONES.emerald },
      foot: `${period}: ${compact(sum("result"))}`,
    },
    {
      key: "margin",
      label: "Margem realizada",
      icon: "percent",
      tone: marginDiff >= 0 ? "emerald" : "red",
      value: pct(c.margin),
      badge: `${signedPp(marginDiff)} vs prevista`,
      badgeTone: marginDiff >= 0 ? "emerald" : "red",
      body: `
        <div class="ov-margin-bars">
          <div class="ov-margin-bar">
            <span>Prevista</span>
            ${meter([{ value: c.plannedMarginPct, tone: "slate" }])}
            <strong>${esc(pct(c.plannedMarginPct))}</strong>
          </div>
          <div class="ov-margin-bar">
            <span>Realizada</span>
            ${meter([{ value: c.margin, tone: num(c.margin) >= 0 ? "emerald" : "red" }])}
            <strong>${esc(pct(c.margin))}</strong>
          </div>
        </div>`,
      foot: "Resultado das obras sobre o faturado",
    },
  ];

  document.getElementById("ovKpis").innerHTML = kpiCardsHtml(cards, "ov");
  drawKpiSparks(cards, "ov");
}

/* ─── 2. Faixa de posição ─────────────────────────────────────────────────── */

function renderStrip() {
  const d = state.data;
  const c = d.cards || {};
  const aging = d.aging || {};
  const cash = d.cashFlow || {};

  const cells = [
    { label: "Recebido", value: c.received, sub: "Entradas do cliente", href: LINKS.received, icon: "savings" },
    {
      label: "Por receber",
      value: c.receivable,
      sub: num(aging.vencidas) > 0 ? `${compact(aging.vencidas)} vencido` : "Nada vencido",
      subTone: num(aging.vencidas) > 0 ? "neg" : "pos",
      href: LINKS.receivable,
      icon: "schedule",
    },
    { label: "Por faturar", value: c.toInvoice, sub: "Venda prevista em falta", href: LINKS.toInvoice, icon: "hourglass_top" },
    {
      label: "Comprometido",
      value: num(c.costCommitted) + num(c.generalCommitted),
      sub: "Assumido, ainda por pagar",
      href: LINKS.committed,
      icon: "handshake",
    },
    {
      label: "Custos por confirmar",
      value: c.costPending,
      sub: num(c.costPending) > 0 ? "Aguarda o financeiro" : "Tudo confirmado",
      subTone: num(c.costPending) > 0 ? "warn" : "pos",
      href: LINKS.pending,
      icon: "pending_actions",
    },
    {
      label: "Saldo de tesouraria",
      value: cash.net,
      valueTone: toneOf(cash.net),
      sub: "Recebido − pago",
      href: LINKS.control,
      icon: "account_balance_wallet",
    },
  ];

  document.getElementById("ovStrip").innerHTML = stripHtml(
    cells.map((cell) => ({ ...cell, title: money(cell.value), value: compact(cell.value) }))
  );
}

/* ─── 3. Evolução mensal e previsto vs realizado ──────────────────────────── */

function renderFlow() {
  const months = monthlySlice();
  const total = (key) => months.reduce((a, m) => a + m[key], 0);
  const result = total("result");

  document.getElementById("ovFlowTotals").innerHTML = [
    { label: "Faturado", value: total("invoiced"), dot: TONES.blue },
    { label: "Recebido", value: total("received"), dot: TONES.sky },
    { label: "Custos", value: total("cost"), dot: TONES.red },
    { label: "Resultado", value: result, dot: TONES.emerald, tone: toneOf(result) },
  ]
    .map(
      (t) => `
      <div class="ov-flow-total">
        <span><i style="background:${t.dot}"></i>${esc(t.label)}</span>
        <strong class="${t.tone ? `ov-${t.tone}` : ""}">${esc(compact(t.value))}</strong>
      </div>`
    )
    .join("");

  return drawComboChart("ovChartFlow", {
    categories: months.map((m) => m.label),
    series: [
      { name: "Faturação", type: "column", data: months.map((m) => m.invoiced), color: TONES.blue },
      { name: "Custos", type: "column", data: months.map((m) => m.cost), color: "#fca5a5" },
      { name: "Resultado", type: "line", data: months.map((m) => m.result), color: TONES.emerald },
    ],
    height: 300,
  });
}

function renderPlan() {
  const c = state.data.cards || {};
  const items = state.data.byProject || [];
  // Resultado que o faturado já devia ter gerado à margem prevista de cada obra.
  const expected = items.reduce((a, p) => a + (num(p.revenue) * num(p.plannedMarginPct)) / 100, 0);
  const realizedAndCommitted = num(c.cost) + num(c.costCommitted);
  const costScale = Math.max(num(c.costBudget), realizedAndCommitted, 1);
  const resultScale = Math.max(Math.abs(expected), Math.abs(num(c.result)), 1);
  const deviation = num(c.costDeviation);

  const row = ({ label, left, right, bar, note = "" }) => `
    <div class="ov-plan-row">
      <div class="ov-plan-head">
        <span class="ov-plan-label">${esc(label)}</span>
        <span class="ov-plan-values">${left}<span class="ov-plan-sep">/</span>${right}</span>
      </div>
      ${bar}
      ${note ? `<p class="ov-plan-note">${note}</p>` : ""}
    </div>`;

  document.getElementById("ovPlan").innerHTML = `
    ${row({
      label: "Venda",
      left: `<strong title="Faturado">${esc(compact(c.revenue))}</strong>`,
      right: `<span title="Venda prevista">${esc(compact(c.forecast))}</span>`,
      bar: meter([{ value: c.executedPct, tone: "blue" }]),
      note: `${esc(pct(c.executedPct))} da venda prevista já faturada`,
    })}
    ${row({
      label: "Custo",
      left: `<strong title="Realizado">${esc(compact(c.cost))}</strong>`,
      right: `<span title="Custo previsto">${esc(compact(c.costBudget))}</span>`,
      bar: meter(
        [
          { value: (num(c.cost) / costScale) * 100, tone: "red" },
          { value: (num(c.costCommitted) / costScale) * 100, tone: "amber-soft" },
        ],
        { marker: (num(c.costBudget) / costScale) * 100 }
      ),
      note: `<span class="ov-legend"><i class="ov-dot ov-dot--red"></i>Realizado</span>
             <span class="ov-legend"><i class="ov-dot ov-dot--amber"></i>Comprometido</span>
             <span class="ov-legend"><i class="ov-marker-key"></i>Previsto</span>`,
    })}
    ${row({
      label: "Resultado",
      left: `<strong class="ov-${toneOf(c.result)}" title="Realizado">${esc(compact(c.result))}</strong>`,
      right: `<span title="Esperado à margem prevista">${esc(compact(expected))}</span>`,
      bar: meter([{ value: (Math.max(num(c.result), 0) / resultScale) * 100, tone: "emerald" }], {
        marker: (Math.max(expected, 0) / resultScale) * 100,
      }),
      note: "Esperado = faturado de cada obra × a sua margem prevista",
    })}
    ${row({
      label: "Margem",
      left: `<strong class="ov-${num(c.margin) >= num(c.plannedMarginPct) ? "pos" : "neg"}" title="Realizada">${esc(pct(c.margin))}</strong>`,
      right: `<span title="Prevista">${esc(pct(c.plannedMarginPct))}</span>`,
      bar: meter([{ value: c.margin, tone: num(c.margin) >= num(c.plannedMarginPct) ? "emerald" : "red" }], {
        marker: c.plannedMarginPct,
      }),
      note: `${esc(signedPp(num(c.margin) - num(c.plannedMarginPct)))} face à margem prevista`,
    })}
    <div class="ov-plan-foot">
      <div>
        <span>Desvio de custo</span>
        <strong class="ov-${deviation > 0 ? "neg" : "pos"}">${deviation > 0 ? "+" : ""}${esc(compact(deviation))}</strong>
      </div>
      <div>
        <span>Margem prevista</span>
        <strong>${esc(compact(c.plannedMargin))} · ${esc(pct(c.plannedMarginPct))}</strong>
      </div>
    </div>`;
}

/* ─── 4. Antiguidade, fontes e alertas ────────────────────────────────────── */

function renderAging() {
  const columns = state.data.charts?.aging?.receivables || [];
  const aging = state.data.aging || {};
  const total = columns.reduce((a, col) => a + num(col.value), 0);
  const wrap = document.getElementById("ovAging");

  if (total <= 0) {
    wrap.innerHTML = `<div class="ov-empty"><span class="material-symbols-outlined">task_alt</span>Sem faturas por receber.</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="ov-aging-total">
      <strong>${esc(money(total))}</strong>
      <span>${esc(String(aging.openCount || 0))} faturas em aberto · ${esc(String(aging.overdueCount || 0))} vencidas</span>
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

function renderSources() {
  const rows = (state.data.charts?.costBySource || []).filter((s) => num(s.total) > 0);
  return drawDonutChart("ovChartSources", {
    labels: rows.map((r) => r.label || r.source),
    series: rows.map((r) => num(r.total)),
    totalLabel: "Custo total",
    height: 260,
  });
}

function renderAlerts() {
  const d = state.data;
  const c = d.cards || {};
  const aging = d.aging || {};
  const items = d.byProject || [];

  const overBudget = items.filter((p) => num(p.costBudget) > 0 && num(p.costDeviationPct) > DEVIATION_ALERT_PCT);
  const negative = items.filter((p) => num(p.revenue) > 0 && num(p.result) < 0);
  const alerts = [];

  if (num(aging.overdueCount) > 0) {
    alerts.push({
      tone: "red",
      icon: "event_busy",
      title: `${aging.overdueCount} fatura(s) vencida(s)`,
      text: `${compact(aging.vencidas)} por cobrar a clientes`,
      href: LINKS.receivable,
    });
  }
  if (overBudget.length) {
    alerts.push({
      tone: "red",
      icon: "trending_up",
      title: `${overBudget.length} obra(s) acima do custo previsto`,
      text: overBudget
        .sort((a, b) => num(b.costDeviationPct) - num(a.costDeviationPct))
        .slice(0, 2)
        .map((p) => `${p.project.name} (+${num(p.costDeviationPct).toFixed(0)}%)`)
        .join(", "),
      href: LINKS.control,
    });
  }
  if (negative.length) {
    alerts.push({
      tone: "red",
      icon: "warning",
      title: `${negative.length} obra(s) com resultado negativo`,
      text: negative.slice(0, 2).map((p) => p.project.name).join(", "),
      href: LINKS.control,
    });
  }
  if (num(c.costPending) > 0) {
    alerts.push({
      tone: "amber",
      icon: "pending_actions",
      title: "Custos por confirmar",
      text: `${compact(c.costPending)} aguarda nº de fatura e confirmação`,
      href: LINKS.pending,
    });
  }
  if (num(d.cashFlow?.net) < 0) {
    alerts.push({
      tone: "amber",
      icon: "account_balance_wallet",
      title: "Tesouraria negativa",
      text: `Pagou-se mais ${compact(Math.abs(num(d.cashFlow.net)))} do que se recebeu`,
      href: LINKS.control,
    });
  }

  const wrap = document.getElementById("ovAlerts");
  if (!alerts.length) {
    wrap.innerHTML = `<li class="ov-empty"><span class="material-symbols-outlined">verified</span>Tudo em ordem: sem faturas vencidas, desvios ou custos por confirmar.</li>`;
    return;
  }
  wrap.innerHTML = alerts
    .map(
      (a) => `
      <li>
        <a class="ov-alert ov-alert--${a.tone}" href="${a.href}">
          <span class="ov-alert-icon"><span class="material-symbols-outlined">${a.icon}</span></span>
          <span class="ov-alert-text">
            <strong>${esc(a.title)}</strong>
            <span>${esc(a.text)}</span>
          </span>
          <span class="material-symbols-outlined ov-alert-go">chevron_right</span>
        </a>
      </li>`
    )
    .join("");
}

/* ─── 5. Resultado por obra ───────────────────────────────────────────────── */

const SORTERS = {
  name: (p) => (p.project.name || "").toLowerCase(),
  forecast: (p) => num(p.forecast),
  revenue: (p) => num(p.revenue),
  cost: (p) => num(p.cost),
  result: (p) => num(p.result),
  margin: (p) => num(p.margin),
  receivable: (p) => num(p.receivable),
};

function tableRows() {
  const { query, scope, sort, dir } = state.table;
  const q = query.trim().toLowerCase();
  const rows = (state.data?.byProject || []).filter((p) => {
    if (!(num(p.revenue) || num(p.cost) || num(p.forecast) || num(p.costBudget))) return false;
    if (scope === "active" && p.project.active === false) return false;
    if (!q) return true;
    return [p.project.name, p.project.code, p.project.client?.name].some((v) => String(v || "").toLowerCase().includes(q));
  });
  const key = SORTERS[sort] || SORTERS.revenue;
  const factor = dir === "asc" ? 1 : -1;
  return rows.sort((a, b) => {
    const va = key(a);
    const vb = key(b);
    if (va < vb) return -1 * factor;
    if (va > vb) return 1 * factor;
    return 0;
  });
}

function renderProjects() {
  const wrap = document.getElementById("ovProjects");
  const rows = tableRows();

  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">apartment</span>${
      state.table.query ? "Nenhuma obra corresponde à pesquisa." : "Sem dados financeiros por obra."
    }</div>`;
    return;
  }

  const visible = state.table.expanded ? rows : rows.slice(0, TABLE_PREVIEW);
  const th = (key, label, align = "right") => {
    const active = state.table.sort === key;
    const arrow = active ? (state.table.dir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more";
    return `<th style="text-align:${align}">
      <button type="button" class="ov-sort ${active ? "active" : ""}" data-sort="${key}">
        ${esc(label)}<span class="material-symbols-outlined">${arrow}</span>
      </button>
    </th>`;
  };

  const body = visible
    .map((p) => {
      const executed = num(p.executedPct);
      const consumed = num(p.costBudget) > 0 ? (num(p.cost) / num(p.costBudget)) * 100 : 0;
      const marginDiff = num(p.margin) - num(p.plannedMarginPct);
      const hasRevenue = num(p.revenue) > 0;
      const hasForecast = num(p.forecast) > 0;
      return `
      <tr>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(p.project.name)}</span>
            <span class="ov-project-meta">${esc([p.project.referencia || p.project.code, p.project.client?.name].filter(Boolean).join(" · "))}</span>
          </div>
        </td>
        <td class="fin-num">${esc(compact(p.forecast))}</td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span>${esc(compact(p.revenue))}</span>
            ${meter([{ value: executed, tone: "blue" }])}
            <small>${esc(pct(executed, 0))} da venda</small>
          </div>
        </td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span>${esc(compact(p.cost))}</span>
            ${meter([{ value: consumed, tone: consumed > 100 ? "red" : "amber" }])}
            <small class="${consumed > 100 ? "ov-neg" : ""}">${num(p.costBudget) > 0 ? `${esc(pct(consumed, 0))} do previsto` : "sem orçamento"}</small>
          </div>
        </td>
        <td class="fin-num"><strong class="ov-${toneOf(p.result)}">${esc(compact(p.result))}</strong></td>
        <td class="fin-num">
          ${
            hasRevenue
              ? `<div class="ov-margin-cell">
                   <span class="ov-badge ov-badge--${toneOf(p.margin) === "pos" ? "emerald" : "red"}">${esc(pct(p.margin))}</span>
                   ${
                     hasForecast
                       ? `<small class="ov-${marginDiff >= 0 ? "pos" : "neg"}">${esc(signedPp(marginDiff))} vs ${esc(pct(p.plannedMarginPct, 0))}</small>`
                       : `<small class="ov-muted">sem venda prevista</small>`
                   }
                 </div>`
              : hasForecast
                ? `<small class="ov-muted">Prevista ${esc(pct(p.plannedMarginPct, 0))}</small>`
                : `<span class="ov-muted">—</span>`
          }
        </td>
        <td class="fin-num">${num(p.receivable) > 0 ? esc(compact(p.receivable)) : '<span class="ov-muted">—</span>'}</td>
      </tr>`;
    })
    .join("");

  const totals = rows.reduce(
    (acc, p) => {
      acc.forecast += num(p.forecast);
      acc.revenue += num(p.revenue);
      acc.cost += num(p.cost);
      acc.result += num(p.result);
      acc.receivable += num(p.receivable);
      return acc;
    },
    { forecast: 0, revenue: 0, cost: 0, result: 0, receivable: 0 }
  );
  const margin = totals.revenue > 0 ? (totals.result / totals.revenue) * 100 : 0;

  wrap.innerHTML = `
    <table class="fin-table ov-table">
      <thead><tr>
        ${th("name", "Obra", "left")}
        ${th("forecast", "Venda prevista")}
        ${th("revenue", "Faturado")}
        ${th("cost", "Custo realizado")}
        ${th("result", "Resultado")}
        ${th("margin", "Margem")}
        ${th("receivable", "Por receber")}
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Total (${rows.length} obras)</td>
        <td class="fin-num">${esc(compact(totals.forecast))}</td>
        <td class="fin-num">${esc(compact(totals.revenue))}</td>
        <td class="fin-num">${esc(compact(totals.cost))}</td>
        <td class="fin-num ov-${toneOf(totals.result)}">${esc(compact(totals.result))}</td>
        <td class="fin-num">${esc(pct(margin))}</td>
        <td class="fin-num">${esc(compact(totals.receivable))}</td>
      </tr></tfoot>
    </table>
    ${
      rows.length > TABLE_PREVIEW
        ? `<div class="ov-table-more">
             <button type="button" id="ovMore" class="finance-btn finance-btn--ghost">
               <span class="material-symbols-outlined">${state.table.expanded ? "expand_less" : "expand_more"}</span>
               ${state.table.expanded ? "Mostrar menos" : `Mostrar todas (${rows.length})`}
             </button>
           </div>`
        : ""
    }`;

  wrap.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort;
      if (state.table.sort === key) state.table.dir = state.table.dir === "asc" ? "desc" : "asc";
      else {
        state.table.sort = key;
        state.table.dir = key === "name" ? "asc" : "desc";
      }
      renderProjects();
    });
  });
  document.getElementById("ovMore")?.addEventListener("click", () => {
    state.table.expanded = !state.table.expanded;
    renderProjects();
  });
}

/* ─── Controlos e carregamento ────────────────────────────────────────────── */

function wireControls() {
  const range = document.getElementById("ovRange");
  range?.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const months = Number(btn.dataset.months) || 12;
      if (months === state.months || !state.data) return;
      state.months = months;
      range.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      renderFlow();
      renderKpis();
    });
  });

  const scope = document.getElementById("ovScope");
  scope?.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.table.scope = btn.dataset.scope;
      scope.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      if (state.data) renderProjects();
    });
  });

  let timer = null;
  document.getElementById("ovSearch")?.addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.table.query = e.target.value;
      state.table.expanded = false;
      if (state.data) renderProjects();
    }, 150);
  });
}

async function load() {
  try {
    state.data = await apiRequest("/finance/overview");
    renderActions();
    renderKpis();
    renderStrip();
    renderPlan();
    renderAging();
    renderAlerts();
    renderProjects();
    await Promise.all([renderFlow(), renderSources()]);
  } catch (err) {
    const wrap = document.getElementById("ovProjects");
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o overview financeiro.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  state.months = 12;
  state.table = { query: "", scope: "active", sort: "revenue", dir: "desc", expanded: false };
  renderShell();
  await load();
}
