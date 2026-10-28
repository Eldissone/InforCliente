import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { openInvoiceDocumentModal, invoiceHasDocument } from "./invoiceDocument.js";
import {
  chartCardHtml,
  compactMoney as compact,
  drawBarChart,
  drawComboChart,
  destroyCharts,
  TONES,
} from "./charts.js";
import { AGING_TONES } from "./aging.js";
import { kpiCardsHtml, meterHtml as meter, num, skeletonHtml, stripHtml, toneOf } from "./widgets.js";

/**
 * Ecrã «Faturação Prevista» (Financeiro · Faturação).
 *
 * Faturação emitida vs previsão, ligada à orçamentação da obra:
 *  - Previsão de venda  → tabela de quantidades (ou valor global da obra)
 *  - Custo previsto     → orçamento de custo dos centros de custo
 *  - Margem prevista    → venda prevista − custo previsto
 *  - Custo realizado    → todas as áreas (pagamentos, pedidos extra, stock…)
 *  - Margem realizada   → faturado − custo realizado
 *
 * A faturação de obras sem venda prevista não conta para a execução da
 * previsão; aparece à parte como «faturado sem previsão».
 */

const STATUS = {
  EM_ABERTO: { label: "Em Aberto", badge: "slate" },
  PAGO_PARCIAL: { label: "Pago Parcial", badge: "amber" },
  PAGO_TOTAL: { label: "Pago Total", badge: "emerald" },
  ATRASADO: { label: "Atrasado", badge: "red" },
};

const SALE_SOURCE = {
  TABELA_QUANTIDADES: "Tabela de quantidades da obra",
  VALOR_GLOBAL: "Valor global da obra",
  SEM_ORCAMENTO: "Sem orçamento de venda definido",
};

const state = {
  group: "project",
  filters: { clientId: "", projectId: "" },
  query: "",
  scope: "active",
  months: 12,
  projects: [],
  clients: [],
  data: null,
  expanded: new Set(),
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function badge(status) {
  const s = STATUS[status] || { label: status, badge: "slate" };
  return `<span class="finance-badge finance-badge--${s.badge}">${esc(s.label)}</span>`;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div id="fpKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>
      <div id="fpStrip" class="ov-strip">${skeletonHtml(6, "cell")}</div>

      <div class="ov-row ov-row--8-4">
        ${chartCardHtml({
          id: "fpChartMonthly",
          title: "Faturação emitida vs recebida",
          subtitle: "Faturado pela data do documento e recebido pela data do recebimento",
          hint: "A recebida segue a data do último recebimento registado em cada fatura.",
          height: 280,
          actionsHtml: `
            <div class="finance-seg finance-seg--sm" id="fpRange">
              <button type="button" data-months="6">6M</button>
              <button type="button" data-months="12" class="active">12M</button>
            </div>`,
          beforeChartHtml: `<div id="fpFlowTotals" class="ov-flow-totals"></div>`,
        })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head finance-chart-head--row">
            <div>
              <h2 class="finance-chart-title">Por receber</h2>
              <p class="finance-chart-subtitle">Valor em falta por antiguidade do vencimento</p>
            </div>
            <a class="ov-link" href="/Financeiro/faturacao/registar">Faturas <span class="material-symbols-outlined">arrow_forward</span></a>
          </header>
          <div id="fpAging">${skeletonHtml(3, "line")}</div>
        </section>
      </div>

      <div class="ov-row ov-row--6-6">
        ${chartCardHtml({
          id: "fpChartPipeline",
          title: "Execução da venda prevista",
          subtitle: "Faturado e por faturar nas 8 obras com maior previsão",
          height: 300,
        })}
        ${chartCardHtml({
          id: "fpChartMargin",
          title: "Margem prevista vs realizada",
          subtitle: "Nas mesmas obras · realizada = faturado − custo realizado",
          height: 300,
        })}
      </div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Prevista vs realizada</h2>
            <p class="finance-chart-subtitle" id="fpHint">—</p>
          </div>
          <div class="ov-table-tools">
            <div class="finance-seg finance-seg--sm" id="fpGroup">
              <button type="button" data-group="project" class="active">
                <span class="material-symbols-outlined">apartment</span>Por Obra
              </button>
              <button type="button" data-group="client">
                <span class="material-symbols-outlined">groups</span>Por Cliente
              </button>
            </div>
            <div class="finance-seg finance-seg--sm" id="fpScope" title="Obras com venda prevista, faturas ou custos">
              <button type="button" data-scope="active" class="active">Com movimento</button>
              <button type="button" data-scope="all">Todas</button>
            </div>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="fpSearch" type="search" placeholder="Obra, código ou cliente…" autocomplete="off" />
            </label>
            <select id="fpClient" class="finance-select inv-filter" title="Cliente"></select>
            <select id="fpProject" class="finance-select inv-filter" title="Obra"></select>
          </div>
        </header>
        <div id="fpTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  const clientSel = document.getElementById("fpClient");
  clientSel.innerHTML =
    `<option value="">Todos os clientes</option>` +
    state.clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  const projectSel = document.getElementById("fpProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.referencia ? `${p.referencia} — ${p.name}` : p.name)}</option>`).join("");

  clientSel.addEventListener("change", () => {
    state.filters.clientId = clientSel.value;
    load();
  });
  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    load();
  });

  document.querySelectorAll("#fpGroup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.group = btn.dataset.group;
      document.querySelectorAll("#fpGroup button").forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("fpScope").hidden = state.group === "client";
      renderTable();
    });
  });

  document.querySelectorAll("#fpScope button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scope = btn.dataset.scope;
      document.querySelectorAll("#fpScope button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });

  document.querySelectorAll("#fpRange button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.months = Number(btn.dataset.months);
      document.querySelectorAll("#fpRange button").forEach((b) => b.classList.toggle("active", b === btn));
      renderMonthly();
    });
  });

  let timer = null;
  document.getElementById("fpSearch").addEventListener("input", (e) => {
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
  const projects = state.data?.byProject || [];
  const withForecast = projects.filter((p) => num(p.forecast) > 0).length;
  const billedInForecast = Math.max(num(t.forecast) - num(t.toBill), 0);
  const noForecast = num(t.billedWithoutForecast);
  const marginGap = num(t.realizedMarginPct) - num(t.plannedMarginPct);

  const cards = [
    {
      key: "forecast",
      label: "Venda prevista",
      icon: "target",
      tone: "violet",
      value: money(t.forecast),
      badge: `${withForecast}/${projects.length} obras`,
      badgeTone: "blue",
      body: `
        <dl class="ov-kpi-split">
          <div><dt>Custo previsto</dt><dd>${esc(compact(t.costBudget))}</dd></div>
          <div><dt>Margem prevista</dt><dd class="ov-${toneOf(t.plannedMargin)}">${esc(compact(t.plannedMargin))} · ${esc(pct(t.plannedMarginPct))}</dd></div>
        </dl>`,
    },
    {
      key: "billed",
      label: "Faturado",
      icon: "receipt_long",
      tone: "blue",
      value: money(t.billed),
      badge: `${pct(t.executedPct)} da previsão`,
      badgeTone: "blue",
      body: `
        ${meter([{ value: t.executedPct, tone: "blue" }])}
        <p class="ov-kpi-compare">${
          noForecast > 0
            ? `<strong class="ov-warn">${esc(compact(noForecast))}</strong> faturados em obras sem venda prevista`
            : `<strong>${esc(compact(billedInForecast))}</strong> faturados contra a previsão`
        }</p>`,
    },
    {
      key: "toBill",
      label: "Por faturar",
      icon: "hourglass_bottom",
      tone: "amber",
      value: money(t.toBill),
      badge: `${pct(100 - num(t.executedPct))} da previsão`,
      badgeTone: "amber",
      body: `
        ${meter([
          { value: t.executedPct, tone: "blue" },
          { value: 100 - num(t.executedPct), tone: "amber-soft" },
        ])}
        <p class="ov-kpi-compare">
          <span class="ov-legend"><i class="ov-dot ov-dot--blue"></i>Faturado</span>
          <span class="ov-legend" style="margin-left:0.6rem"><i class="ov-dot ov-dot--amber"></i>Por faturar</span>
        </p>`,
    },
    {
      key: "margin",
      label: "Margem realizada",
      icon: "trending_up",
      tone: num(t.realizedMargin) >= 0 ? "emerald" : "red",
      value: money(t.realizedMargin),
      badge: pct(t.realizedMarginPct),
      badgeTone: num(t.realizedMargin) >= 0 ? "emerald" : "red",
      body: `
        ${meter([{ value: t.realizedMarginPct, tone: marginGap >= 0 ? "emerald" : "red" }], { marker: t.plannedMarginPct })}
        <p class="ov-kpi-compare">
          <strong class="ov-${marginGap >= 0 ? "pos" : "neg"}">${marginGap >= 0 ? "+" : ""}${esc(marginGap.toFixed(1))} pp</strong>
          face à prevista (${esc(pct(t.plannedMarginPct))})
        </p>`,
    },
  ];
  document.getElementById("fpKpis").innerHTML = kpiCardsHtml(cards, "fp");
}

function renderStrip() {
  const t = state.data?.totals || {};
  const net = num(t.received) + num(t.missing);
  const costScale = num(t.costBudget);
  document.getElementById("fpStrip").innerHTML = stripHtml([
    {
      label: "Recebido",
      icon: "savings",
      value: compact(t.received),
      sub: net > 0 ? `${pct((num(t.received) / net) * 100)} do líquido` : "Sem faturas",
    },
    {
      label: "Em falta",
      icon: "pending_actions",
      value: compact(t.missing),
      valueTone: num(t.missing) > 0 ? "warn" : null,
      sub: "por receber dos clientes",
      href: "/Financeiro/faturacao/registar",
    },
    {
      label: "Custo previsto",
      icon: "request_quote",
      value: compact(t.costBudget),
      sub: "baseline dos centros de custo",
    },
    {
      label: "Custo realizado",
      icon: "payments",
      value: compact(t.costRealized),
      sub: costScale > 0 ? `${pct((num(t.costRealized) / costScale) * 100)} do previsto` : "sem custo previsto",
    },
    {
      label: "Comprometido",
      icon: "lock_clock",
      value: compact(t.costCommitted),
      sub: "custos assumidos por pagar",
    },
    {
      label: "Sem previsão",
      icon: "report",
      value: compact(t.billedWithoutForecast),
      valueTone: num(t.billedWithoutForecast) > 0 ? "warn" : null,
      sub: "faturado em obras sem venda prevista",
    },
  ]);
}

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

function renderMonthly() {
  const all = state.data?.charts?.monthly || [];
  const months = all.slice(-state.months);
  const billed = months.reduce((a, m) => a + num(m.billed), 0);
  const received = months.reduce((a, m) => a + num(m.received), 0);

  document.getElementById("fpFlowTotals").innerHTML = [
    { label: "Faturado", value: compact(billed), dot: TONES.blue },
    { label: "Recebido", value: compact(received), dot: TONES.emerald },
    { label: "Diferença", value: compact(billed - received), dot: TONES.amber },
    { label: "Taxa de recebimento", value: billed > 0 ? pct((received / billed) * 100) : "—", dot: TONES.slate },
  ]
    .map(
      (t) => `
      <div class="ov-flow-total">
        <span><i style="background:${t.dot}"></i>${esc(t.label)}</span>
        <strong>${esc(t.value)}</strong>
      </div>`
    )
    .join("");

  return drawComboChart("fpChartMonthly", {
    categories: months.map((m) => m.label),
    series: [
      { name: "Faturado", type: "column", data: months.map((m) => num(m.billed)), color: TONES.blue },
      { name: "Recebido", type: "line", data: months.map((m) => num(m.received)), color: TONES.emerald },
    ],
    height: 280,
  });
}

function renderAging() {
  const columns = state.data?.charts?.receivablesAging || [];
  const total = columns.reduce((a, col) => a + num(col.value), 0);
  const wrap = document.getElementById("fpAging");
  if (total <= 0) {
    wrap.innerHTML = `<div class="ov-empty"><span class="material-symbols-outlined">task_alt</span>Sem faturas por receber.</div>`;
    return;
  }
  const invoices = (state.data.byProject || []).flatMap((p) => p.rows || []);
  const open = invoices.filter((i) => num(i.missingAmount) > 0).length;
  const overdue = invoices.filter((i) => i.status === "ATRASADO").length;
  wrap.innerHTML = `
    <div class="ov-aging-total">
      <strong>${esc(money(total))}</strong>
      <span>${open} faturas em aberto · ${overdue} vencidas</span>
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

function renderCharts() {
  renderMonthly();
  renderAging();

  const top = [...(state.data?.byProject || [])]
    .filter((p) => num(p.forecast) > 0)
    .sort((a, b) => num(b.forecast) - num(a.forecast))
    .slice(0, 8);
  const label = (p) => p.project.code || p.project.name;
  // Barras com espessura constante: a altura acompanha o número de obras.
  const height = Math.max(200, top.length * 46 + 90);

  if (!top.length) {
    ["fpChartPipeline", "fpChartMargin"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">target</span>Nenhuma obra tem venda prevista. Defina a tabela de quantidades ou o valor da obra.</div>`;
      }
    });
    return;
  }

  drawBarChart("fpChartPipeline", {
    categories: top.map(label),
    series: [
      { name: "Faturado", data: top.map((p) => Math.min(num(p.billed), num(p.forecast))), color: TONES.blue },
      { name: "Por faturar", data: top.map((p) => num(p.toBill)), color: "#fcd34d" },
    ],
    stacked: true,
    horizontal: true,
    height,
  });

  drawBarChart("fpChartMargin", {
    categories: top.map(label),
    series: [
      { name: "Margem prevista", data: top.map((p) => num(p.plannedMargin)), color: "#c4b5fd" },
      { name: "Margem realizada", data: top.map((p) => num(p.realizedMargin)), color: TONES.emerald },
    ],
    horizontal: true,
    height,
  });
}

/* ─── Tabelas ─────────────────────────────────────────────────────────────── */

function matchesQuery(...values) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return values.some((v) => String(v || "").toLowerCase().includes(q));
}

/** Célula «valor + % + barra» com o faturado sobre a venda prevista. */
function executionCell(billed, forecast, cur) {
  if (!(num(forecast) > 0)) {
    return `
      <div class="ov-cell-bar">
        <span>${esc(money(billed, cur))}</span>
        <small class="${num(billed) > 0 ? "ov-warn" : ""}">${num(billed) > 0 ? "sem venda prevista" : "—"}</small>
      </div>`;
  }
  const p = (num(billed) / num(forecast)) * 100;
  return `
    <div class="ov-cell-bar">
      <span>${esc(money(billed, cur))}</span>
      ${meter([{ value: p, tone: p > 100 ? "red" : "blue" }])}
      <small class="${p > 100 ? "ov-neg" : ""}">${esc(pct(p))} da previsão</small>
    </div>`;
}

function marginCell(value, percent, cur, show = true) {
  if (!show) return `<span class="ov-muted">—</span>`;
  return `
    <div class="ov-margin-cell">
      <strong class="ov-${toneOf(value)}">${esc(money(value, cur))}</strong>
      <small class="ov-${toneOf(value)}">${esc(pct(percent))}</small>
    </div>`;
}

function renderByClient(data) {
  document.getElementById("fpHint").textContent =
    "Venda prevista pela tabela de quantidades de cada obra e custo previsto pelo orçamento dos centros de custo.";
  const projects = data.byProject || [];
  const rows = (data.byClient || []).filter((c) => {
    if (state.filters.clientId && (c.client?.id || null) !== state.filters.clientId) return false;
    return matchesQuery(c.client?.name);
  });
  const wrap = document.getElementById("fpTable");
  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">groups</span>Sem dados para os filtros selecionados.</div>`;
    return;
  }

  const body = rows
    .map((c) => {
      const count = projects.filter((p) => (p.project.client?.id || null) === (c.client?.id || null)).length;
      const realized = num(c.billed) - num(c.costRealized);
      return `
      <tr>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(c.client?.name || "Sem cliente")}</span>
            <span class="ov-project-meta">${count} obra${count === 1 ? "" : "s"}</span>
          </div>
        </td>
        <td class="fin-num">${esc(money(c.forecast))}</td>
        <td class="fin-num">${executionCell(num(c.billed) - num(c.billedWithoutForecast), c.forecast)}${
          num(c.billedWithoutForecast) > 0
            ? `<div class="fp-extra ov-warn">+ ${esc(compact(c.billedWithoutForecast))} sem previsão</div>`
            : ""
        }</td>
        <td class="fin-num ov-warn"><strong>${esc(money(c.toBill))}</strong></td>
        <td class="fin-num">${esc(money(c.costBudget))}</td>
        <td class="fin-num">${marginCell(c.plannedMargin, c.plannedMarginPct, undefined, num(c.forecast) > 0)}</td>
        <td class="fin-num">${esc(money(c.costRealized))}</td>
        <td class="fin-num">${marginCell(realized, num(c.billed) > 0 ? (realized / num(c.billed)) * 100 : 0, undefined, num(c.billed) > 0)}</td>
      </tr>`;
    })
    .join("");

  const t = data.totals || {};
  wrap.innerHTML = `
    <table class="fin-table fp-table">
      <thead><tr>
        <th>Cliente</th>
        <th style="text-align:right">Venda prevista</th>
        <th style="text-align:right">Faturado</th>
        <th style="text-align:right">Por faturar</th>
        <th style="text-align:right">Custo previsto</th>
        <th style="text-align:right">Margem prevista</th>
        <th style="text-align:right">Custo realizado</th>
        <th style="text-align:right">Margem realizada</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais</td>
        <td class="fin-num">${esc(money(t.forecast))}</td>
        <td class="fin-num">${esc(money(t.billed))}</td>
        <td class="fin-num">${esc(money(t.toBill))}</td>
        <td class="fin-num">${esc(money(t.costBudget))}</td>
        <td class="fin-num">${esc(money(t.plannedMargin))}</td>
        <td class="fin-num">${esc(money(t.costRealized))}</td>
        <td class="fin-num">${esc(money(t.realizedMargin))}</td>
      </tr></tfoot>
    </table>`;
}

function renderInvoiceRows(entry, cur) {
  const invoices = entry.rows || [];
  if (!invoices.length) {
    return `<div class="ov-empty"><span class="material-symbols-outlined">receipt_long</span>Sem faturas emitidas para esta obra.</div>`;
  }
  const billed = invoices.reduce((a, i) => a + num(i.grossAmount), 0);
  const rows = invoices
    .map((inv) => {
      const net = num(inv.netAmount);
      const paidPct = net > 0 ? (num(inv.receivedAmount) / net) * 100 : 0;
      return `
      <tr class="${inv.status === "ATRASADO" ? "fin-row--overdue" : ""}">
        <td><strong>${esc(inv.docNumber || "—")}</strong></td>
        <td>${inv.measurement ? esc(inv.measurement.reportNumber || "AM") : `<span class="ov-muted">—</span>`}</td>
        <td>${esc(dateOnly(inv.docDate))}</td>
        <td>${esc(dateOnly(inv.dueDate))}</td>
        <td class="fin-num">${esc(money(inv.grossAmount, cur))}</td>
        <td class="fin-num" title="Peso desta fatura na venda prevista da obra">${inv.workPercent === null || inv.workPercent === undefined ? "—" : esc(pct(inv.workPercent, 2))}</td>
        <td class="fin-num" title="Peso desta fatura no total faturado da obra">${billed > 0 ? esc(pct((num(inv.grossAmount) / billed) * 100)) : "—"}</td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span>${esc(money(inv.receivedAmount, cur))}</span>
            ${meter([{ value: paidPct, tone: "emerald" }])}
          </div>
        </td>
        <td class="fin-num ${num(inv.missingAmount) > 0 ? "ov-warn" : ""}">${esc(money(inv.missingAmount, cur))}</td>
        <td>${badge(inv.status)}</td>
        <td style="text-align:center">
          ${
            invoiceHasDocument(inv)
              ? `<button type="button" class="fin-icon-btn" data-doc="${esc(inv.id)}" title="Ver fatura física">
                   <span class="material-symbols-outlined" style="font-size:17px">receipt</span>
                 </button>`
              : `<span class="ov-muted" title="Sem fatura física anexada">—</span>`
          }
        </td>
      </tr>`;
    })
    .join("");

  return `
    <table class="finance-subtable fp-subtable">
      <thead><tr>
        <th>Nº Doc</th><th>Auto-medição</th><th>Data emissão</th><th>Vencimento</th>
        <th style="text-align:right">V. Ilíquido</th>
        <th style="text-align:right">% Obra</th>
        <th style="text-align:right">% Fatura</th>
        <th style="text-align:right">Recebido</th>
        <th style="text-align:right">Em falta</th>
        <th>Estado</th><th style="text-align:center">Doc.</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Obra com algo para mostrar: venda/custo previsto, faturas ou custos. */
function hasMovement(p) {
  return [p.forecast, p.costBudget, p.billed, p.costRealized, p.costCommitted].some((v) => num(v) > 0) || (p.rows || []).length > 0;
}

function renderByProject(data) {
  document.getElementById("fpHint").textContent =
    "Clique numa obra para ver as faturas emitidas, com a % da obra e o peso de cada fatura.";

  const rows = (data.byProject || []).filter((p) => {
    if (state.filters.projectId && p.project.id !== state.filters.projectId) return false;
    if (state.filters.clientId && (p.project.client?.id || null) !== state.filters.clientId) return false;
    if (state.scope === "active" && !hasMovement(p)) return false;
    return matchesQuery(p.project.name, p.project.code, p.project.client?.name);
  });

  const wrap = document.getElementById("fpTable");
  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">apartment</span>Sem dados para os filtros selecionados.</div>`;
    return;
  }

  const body = rows
    .map((entry) => {
      const cur = entry.project.currency || "AOA";
      const open = state.expanded.has(entry.project.id);
      const hasForecast = num(entry.forecast) > 0;
      const count = (entry.rows || []).length;
      return `
      <tr class="fin-row--clickable" data-project="${esc(entry.project.id)}">
        <td>
          <div class="inv-doc">
            <span class="material-symbols-outlined inv-toggle ${open ? "open" : ""}">chevron_right</span>
            <div class="ov-project">
              <span class="ov-project-name">${esc(entry.project.name)}</span>
              <span class="ov-project-meta">${esc([entry.project.referencia || entry.project.code, entry.project.client?.name].filter(Boolean).join(" · "))} · ${count} fatura${count === 1 ? "" : "s"}</span>
            </div>
          </div>
        </td>
        <td class="fin-num" title="${esc(SALE_SOURCE[entry.forecastSource] || "")}">
          ${hasForecast ? esc(money(entry.forecast, cur)) : `<span class="ov-muted">Sem previsão</span>`}
        </td>
        <td class="fin-num">${executionCell(entry.billed, entry.forecast, cur)}</td>
        <td class="fin-num ${num(entry.toBill) > 0 ? "ov-warn" : ""}"><strong>${hasForecast ? esc(money(entry.toBill, cur)) : "—"}</strong></td>
        <td class="fin-num">${marginCell(entry.plannedMargin, entry.plannedMarginPct, cur, hasForecast)}</td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span>${esc(money(entry.costRealized, cur))}</span>
            ${num(entry.costBudget) > 0 ? meter([{ value: (num(entry.costRealized) / num(entry.costBudget)) * 100, tone: num(entry.costRealized) > num(entry.costBudget) ? "red" : "slate" }]) : ""}
            <small>${num(entry.costBudget) > 0 ? `de ${esc(compact(entry.costBudget))} previstos` : "sem custo previsto"}</small>
          </div>
        </td>
        <td class="fin-num">${marginCell(entry.realizedMargin, entry.realizedMarginPct, cur, num(entry.billed) > 0)}</td>
      </tr>
      <tr class="fin-subrow" ${open ? "" : "hidden"}>
        <td colspan="7"><div class="fp-subwrap">${renderInvoiceRows(entry, cur)}</div></td>
      </tr>`;
    })
    .join("");

  const t = data.totals || {};
  wrap.innerHTML = `
    <table class="fin-table fp-table">
      <thead><tr>
        <th>Obra</th>
        <th style="text-align:right">Venda prevista</th>
        <th style="text-align:right">Faturado</th>
        <th style="text-align:right">Por faturar</th>
        <th style="text-align:right">Margem prevista</th>
        <th style="text-align:right">Custo realizado</th>
        <th style="text-align:right">Margem realizada</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais (todas as obras do filtro)</td>
        <td class="fin-num">${esc(money(t.forecast))}</td>
        <td class="fin-num">${esc(money(t.billed))}</td>
        <td class="fin-num">${esc(money(t.toBill))}</td>
        <td class="fin-num">${esc(money(t.plannedMargin))}</td>
        <td class="fin-num">${esc(money(t.costRealized))}</td>
        <td class="fin-num">${esc(money(t.realizedMargin))}</td>
      </tr></tfoot>
    </table>`;

  wrap.querySelectorAll("tr[data-project]").forEach((tr) => {
    tr.addEventListener("click", () => toggle(tr.dataset.project));
  });
  wrap.querySelectorAll("[data-doc]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      for (const entry of data.byProject || []) {
        const invoice = (entry.rows || []).find((i) => i.id === btn.dataset.doc);
        if (invoice) {
          openInvoiceDocumentModal(invoice, { context: { projectName: entry.project.name } });
          return;
        }
      }
    });
  });
}

function renderTable() {
  const data = state.data;
  if (!data) return;
  if (state.group === "client") return renderByClient(data);
  return renderByProject(data);
}

function toggle(projectId) {
  if (state.expanded.has(projectId)) state.expanded.delete(projectId);
  else state.expanded.add(projectId);
  renderTable();
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  const wrap = document.getElementById("fpTable");
  if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">A carregar faturação prevista…</div>`;
  const params = new URLSearchParams();
  if (state.filters.clientId) params.set("clientId", state.filters.clientId);
  if (state.filters.projectId) params.set("projectId", state.filters.projectId);
  try {
    state.data = await apiRequest(`/finance/billing-forecast?${params.toString()}`);
    renderKpis();
    renderStrip();
    renderTable();
    renderCharts();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar faturação prevista.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  state.expanded = new Set();
  try {
    const [projects, clients] = await Promise.all([
      apiRequest("/finance/options/projects"),
      apiRequest("/finance/options/clients"),
    ]);
    state.projects = projects.items || [];
    state.clients = clients.items || [];
  } catch (err) {
    toast(err.message || "Falha ao carregar obras e clientes.", { type: "error" });
  }
  renderShell();
  await load();
}
