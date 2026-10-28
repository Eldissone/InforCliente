import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawBarChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";
import { drawKpiSparks, kpiCardsHtml, meterHtml, num, skeletonHtml, stripHtml } from "./widgets.js";
import { COST_TYPES } from "./costForm.js";

/**
 * Ecrã «Custos Realizados» (Financeiro · Custos).
 *
 * Só o que já é custo da obra: dinheiro que saiu (pagamentos, pedidos extra
 * pagos, lançamentos liquidados, ATM) e mercadoria consumida na obra. A
 * mercadoria paga ainda em armazém e o comprometido ficam de fora.
 *
 * Agrupa por obra, centro de custo, cliente, fornecedor, tipo de custo ou
 * fonte, com período, peso no total, confirmação e — por obra — a execução
 * do orçamento de custo. Cada grupo abre os lançamentos e tudo exporta para CSV.
 */

const GROUPS = {
  project: { label: "Obra", icon: "apartment" },
  costCenter: { label: "Centro de custo", icon: "account_tree" },
  client: { label: "Cliente", icon: "groups" },
  supplier: { label: "Fornecedor", icon: "local_shipping" },
  category: { label: "Tipo de custo", icon: "category" },
  source: { label: "Fonte", icon: "hub" },
};

const PERIODS = {
  month: "Este mês",
  quarter: "3 meses",
  "12m": "12 meses",
  ytd: "Este ano",
  all: "Tudo",
};

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const state = {
  group: "project",
  period: "12m",
  query: "",
  filters: { projectId: "", status: "" },
  projects: [],
  items: [],
  budgets: new Map(),
  expanded: new Set(),
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** Início do período escolhido (ou null para «Tudo»). */
function periodStart(period) {
  const now = new Date();
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "quarter") return new Date(now.getFullYear(), now.getMonth() - 2, 1);
  if (period === "12m") return new Date(now.getFullYear(), now.getMonth() - 11, 1);
  if (period === "ytd") return new Date(now.getFullYear(), 0, 1);
  return null;
}

/** Meses do período, para o gráfico (no máximo 12 em «Tudo»). */
function periodMonths(period) {
  const now = new Date();
  const count = { month: 1, quarter: 3, "12m": 12, ytd: now.getMonth() + 1, all: 12 }[period] || 12;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      confirmed: 0,
      pending: 0,
    };
  });
}

function groupOf(item) {
  switch (state.group) {
    case "costCenter":
      return {
        key: item.costCenter?.id || "__none__",
        label: item.costCenter ? `${item.costCenter.code ? `${item.costCenter.code} · ` : ""}${item.costCenter.name}` : "Sem centro de custo",
        sub: item.project?.name || "",
      };
    case "client":
      return { key: item.project?.client?.id || "__none__", label: item.project?.client?.name || "Sem cliente", sub: "" };
    case "supplier": {
      const name = item.supplierRef?.name || item.supplier;
      return { key: item.supplierRef?.id || name || "__none__", label: name || "Sem fornecedor", sub: "" };
    }
    case "category":
      return { key: item.category || "__none__", label: COST_TYPES[item.category] || "Sem tipo", sub: "" };
    case "source":
      return { key: item.source, label: item.sourceLabel || item.source, sub: "" };
    default:
      return {
        key: item.project?.id || "__none__",
        label: item.project?.name || "Sem obra",
        sub: [item.project?.code, item.project?.client?.name].filter(Boolean).join(" · "),
        projectId: item.project?.id || null,
      };
  }
}

/** Lançamentos realizados dentro do período e dos filtros. */
function visibleItems() {
  const start = periodStart(state.period);
  const q = state.query.trim().toLowerCase();
  return state.items.filter((c) => {
    if (start && (!c.date || new Date(c.date) < start)) return false;
    if (state.filters.status && c.confirmationStatus !== state.filters.status) return false;
    if (!q) return true;
    return [c.description, c.docNumber, c.supplierRef?.name, c.supplier, c.project?.name, c.project?.code, c.costCenter?.name]
      .some((v) => String(v || "").toLowerCase().includes(q));
  });
}

function aggregate(items) {
  const buckets = new Map();
  items.forEach((item) => {
    const g = groupOf(item);
    if (!buckets.has(g.key)) buckets.set(g.key, { ...g, items: [], paid: 0, confirmed: 0, pending: 0, missingDoc: 0 });
    const b = buckets.get(g.key);
    const paid = num(item.paidAmount);
    b.items.push(item);
    b.paid += paid;
    if (item.confirmationStatus === "CONFIRMADO") b.confirmed += paid;
    else b.pending += paid;
    if (!item.docNumber) b.missingDoc += 1;
  });
  return [...buckets.values()].sort((a, b) => b.paid - a.paid);
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div class="rl-bar">
        <div class="finance-seg finance-seg--sm" id="rlPeriod">
          ${Object.entries(PERIODS)
            .map(([k, v]) => `<button type="button" data-period="${k}" class="${state.period === k ? "active" : ""}">${esc(v)}</button>`)
            .join("")}
        </div>
        <span class="rl-bar-note" id="rlPeriodNote">—</span>
      </div>
      <div id="rlKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>
      <div id="rlStrip" class="ov-strip">${skeletonHtml(6, "cell")}</div>

      <div class="ov-row ov-row--8-4">
        ${chartCardHtml({
          id: "rlChartMonthly",
          title: "Realizado mês a mês",
          subtitle: "Confirmado e por confirmar pela data do custo",
          height: 280,
        })}
        ${chartCardHtml({ id: "rlChartType", title: "Por tipo de custo", subtitle: "Serviço, material, mão de obra…", height: 280 })}
      </div>

      ${chartCardHtml({ id: "rlChartTop", title: "Maiores grupos", subtitle: "—", height: 300 })}

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Custos realizados por <span id="rlGroupName">obra</span></h2>
            <p class="finance-chart-subtitle" id="rlHint">—</p>
          </div>
          <div class="ov-table-tools">
            <select id="rlGroup" class="finance-select inv-filter" title="Agrupar por">
              ${Object.entries(GROUPS).map(([k, g]) => `<option value="${k}">Por ${esc(g.label.toLowerCase())}</option>`).join("")}
            </select>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="rlSearch" type="search" placeholder="Descrição, nº fatura, fornecedor…" autocomplete="off" />
            </label>
            <select id="rlProject" class="finance-select inv-filter" title="Obra"></select>
            <select id="rlStatus" class="finance-select inv-filter" title="Confirmação">
              <option value="">Todos os estados</option>
              <option value="CONFIRMADO">Confirmados</option>
              <option value="POR_CONFIRMAR">Por confirmar</option>
            </select>
          </div>
        </header>
        <div id="rlTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  const projectSel = document.getElementById("rlProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
<<<<<<< HEAD
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.referencia ? `${p.referencia} — ${p.name}` : p.name)}</option>`).join("");
=======
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.code ? `${p.code} — ${p.name}` : p.name)}</option>`).join("");
  projectSel.value = state.filters.projectId;
  document.getElementById("rlGroup").value = state.group;
>>>>>>> origin/dev-leite

  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    load();
  });
  document.getElementById("rlStatus").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    renderAll();
  });
  document.getElementById("rlGroup").addEventListener("change", (e) => {
    state.group = e.target.value;
    state.expanded = new Set();
    renderAll();
  });
  document.querySelectorAll("#rlPeriod button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.period = btn.dataset.period;
      document.querySelectorAll("#rlPeriod button").forEach((b) => b.classList.toggle("active", b === btn));
      renderAll();
    });
  });
<<<<<<< HEAD
}

function groupKey(item, group) {
  if (group === "costCenter") return { key: item.costCenter?.id || "__none__", label: item.costCenter?.name || "Sem centro de custo", sub: item.costCenter?.code || "" };
  if (group === "client") return { key: item.project?.client?.id || "__none__", label: item.project?.client?.name || "Sem cliente", sub: "" };
  return { key: item.project?.id || "__none__", label: item.project?.name || "Sem obra", sub: item.project?.referencia || "" };
}

function aggregate() {
  const buckets = new Map();
  state.items.forEach((item) => {
    const { key, label, sub } = groupKey(item, state.group);
    if (!buckets.has(key)) buckets.set(key, { key, label, sub, count: 0, paid: 0, confirmed: 0, pending: 0 });
    const b = buckets.get(key);
    const paid = Number(item.paidAmount) || 0;
    b.count += 1;
    b.paid += paid;
    if (item.confirmationStatus === "CONFIRMADO") b.confirmed += paid;
    else b.pending += paid;
=======
  let timer = null;
  document.getElementById("rlSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      renderAll();
    }, 150);
>>>>>>> origin/dev-leite
  });

  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = `
      <button id="rlExport" type="button" class="finance-btn finance-btn--ghost">
        <span class="material-symbols-outlined">download</span>Exportar CSV
      </button>`;
    document.getElementById("rlExport").addEventListener("click", exportCsv);
  }
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis(items, buckets, months) {
  const paid = items.reduce((a, c) => a + num(c.paidAmount), 0);
  const confirmed = items.filter((c) => c.confirmationStatus === "CONFIRMADO").reduce((a, c) => a + num(c.paidAmount), 0);
  const confirmedPct = paid > 0 ? (confirmed / paid) * 100 : 0;
  const withDoc = items.filter((c) => c.docNumber).length;
  const docPct = items.length ? (withDoc / items.length) * 100 : 0;
  const avg = months.length ? paid / months.length : 0;
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const lastValue = last ? last.confirmed + last.pending : 0;
  const prevValue = prev ? prev.confirmed + prev.pending : 0;
  const trend = prevValue > 0 ? ((lastValue - prevValue) / prevValue) * 100 : null;

  // Execução do orçamento de custo (acumulado, obras do filtro).
  const budgetRows = [...state.budgets.values()].filter((b) => !state.filters.projectId || b.id === state.filters.projectId);
  const forecast = budgetRows.reduce((a, b) => a + num(b.forecast), 0);
  const realizedAll = budgetRows.reduce((a, b) => a + num(b.realized), 0);
  const execPct = forecast > 0 ? (realizedAll / forecast) * 100 : 0;

  const top = buckets[0];
  const topShare = top && paid > 0 ? (top.paid / paid) * 100 : 0;

  const cards = [
    {
      key: "paid",
      label: "Custo realizado",
      icon: "payments",
      tone: "blue",
      value: money(paid),
      badge: `${items.length} lançamentos`,
      badgeTone: "blue",
      body: `<p class="ov-kpi-compare">Média mensal <strong>${esc(compact(avg))}</strong>${
        trend === null ? "" : ` · último mês <strong class="ov-${trend > 0 ? "neg" : "pos"}">${trend > 0 ? "+" : ""}${esc(trend.toFixed(0))}%</strong>`
      }</p>`,
      spark: months.length > 1 ? { data: months.map((m) => m.confirmed + m.pending), color: TONES.blue } : null,
    },
    {
      key: "confirmed",
      label: "Confirmado",
      icon: "verified",
      tone: confirmedPct >= 100 ? "emerald" : "amber",
      value: money(confirmed),
      badge: pct(confirmedPct, 0),
      badgeTone: confirmedPct >= 100 ? "emerald" : "amber",
      body: `
        ${meterHtml([{ value: confirmedPct, tone: "emerald" }, { value: 100 - confirmedPct, tone: "amber-soft" }])}
        <p class="ov-kpi-compare">Com nº de fatura: <strong class="${docPct < 100 ? "ov-warn" : "ov-pos"}">${withDoc}/${items.length}</strong> (${esc(pct(docPct, 0))})</p>`,
    },
    {
      key: "budget",
      label: "Orçamento executado",
      icon: "target",
      tone: execPct > 100 ? "red" : "violet",
      value: forecast > 0 ? pct(execPct) : "—",
      badge: "acumulado",
      badgeTone: "violet",
      body: forecast > 0
        ? `${meterHtml([{ value: execPct, tone: execPct > 100 ? "red" : "violet" }], { marker: 100 })}
           <p class="ov-kpi-compare"><strong>${esc(compact(realizedAll))}</strong> de ${esc(compact(forecast))} previstos nos centros de custo</p>`
        : `<p class="ov-kpi-compare">Sem orçamento de custo definido nas obras do filtro.</p>`,
    },
    {
      key: "top",
      label: `Maior ${GROUPS[state.group].label.toLowerCase()}`,
      icon: GROUPS[state.group].icon,
      tone: "slate",
      value: top ? compact(top.paid) : "—",
      badge: top ? `${pct(topShare, 0)} do total` : "",
      badgeTone: topShare > 50 ? "amber" : "blue",
      body: `<p class="ov-kpi-compare ov-kpi-ellipsis" title="${esc(top?.label || "")}"><strong>${esc(top?.label || "Sem dados")}</strong></p>`,
    },
  ];
  document.getElementById("rlKpis").innerHTML = kpiCardsHtml(cards, "rl");
  drawKpiSparks(cards, "rl");
}

function renderStrip(items) {
  const bySource = (key) => items.filter((c) => c.source === key).reduce((a, c) => a + num(c.paidAmount), 0);
  const total = items.reduce((a, c) => a + num(c.paidAmount), 0);
  const share = (v) => (total > 0 ? `${pct((v / total) * 100, 0)} do realizado` : "—");
  const payments = bySource("PAGAMENTO");
  const extra = bySource("PEDIDO_EXTRA");
  const journal = bySource("LANCAMENTO");
  const stock = bySource("CONSUMO_STOCK");
  const atm = bySource("ATM");
  const general = items.filter((c) => !c.project?.id).reduce((a, c) => a + num(c.paidAmount), 0);
  const noDoc = items.filter((c) => !c.docNumber);
  document.getElementById("rlStrip").innerHTML = stripHtml([
    { label: "Pagamentos", icon: "shopping_cart", value: compact(payments), sub: share(payments) },
    { label: "Pedidos extra", icon: "request_quote", value: compact(extra), sub: share(extra) },
    { label: "Lançamentos de obra", icon: "receipt_long", value: compact(journal), sub: share(journal) },
    { label: "Consumo de stock", icon: "inventory_2", value: compact(stock), sub: share(stock) },
    { label: "ATM", icon: "atm", value: compact(atm), sub: general > 0 ? `${compact(general)} em estrutura` : share(atm) },
    {
      label: "Sem nº fatura",
      icon: "report",
      value: String(noDoc.length),
      valueTone: noDoc.length ? "warn" : null,
      sub: noDoc.length ? `${compact(noDoc.reduce((a, c) => a + num(c.paidAmount), 0))} sem documento` : "tudo documentado",
      href: "/Financeiro/custos/registar?view=missingDoc",
    },
  ]);
}

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

/** Estado vazio no lugar de um gráfico (liberta primeiro o gráfico anterior). */
async function emptyChart(id, icon, message) {
  await drawBarChart(id, {});
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">${icon}</span>${esc(message)}</div>`;
}

function monthlyBuckets(items) {
  const months = periodMonths(state.period);
  const byKey = new Map(months.map((m) => [m.key, m]));
  items.forEach((c) => {
    const key = toDateKey(c.date)?.slice(0, 7);
    const m = key && byKey.get(key);
    if (!m) return;
    if (c.confirmationStatus === "CONFIRMADO") m.confirmed += num(c.paidAmount);
    else m.pending += num(c.paidAmount);
  });
  return months;
}

function renderCharts(items, buckets, months) {
  drawBarChart("rlChartMonthly", {
    categories: months.map((m) => m.label),
    series: [
      { name: "Confirmado", data: months.map((m) => m.confirmed), color: TONES.emerald },
      { name: "Por confirmar", data: months.map((m) => m.pending), color: "#fcd34d" },
    ],
    stacked: true,
    height: 280,
  });

  const types = new Map();
  items.forEach((c) => types.set(c.category || "OUTRO", (types.get(c.category || "OUTRO") || 0) + num(c.paidAmount)));
  const typeRows = [...types.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!typeRows.length) {
    emptyChart("rlChartType", "donut_large", "Sem custo realizado no período.");
  } else {
    drawDonutChart("rlChartType", {
      labels: typeRows.map(([k]) => COST_TYPES[k] || k),
      series: typeRows.map(([, v]) => v),
      totalLabel: "Realizado",
      height: 280,
    });
  }

  const top = buckets.slice(0, 8);
  const card = document.getElementById("rlChartTop")?.closest(".finance-card");
  const subtitle = card?.querySelector(".finance-chart-subtitle");
  if (subtitle) subtitle.textContent = `${top.length === 1 ? "Único grupo" : `Os ${top.length} maiores`} por ${GROUPS[state.group].label.toLowerCase()} no período · confirmado e por confirmar`;
  if (!top.length) return emptyChart("rlChartTop", "bar_chart", "Sem custo realizado no período.");
  drawBarChart("rlChartTop", {
    categories: top.map((b) => (b.label.length > 34 ? `${b.label.slice(0, 32)}…` : b.label)),
    series: [
      { name: "Confirmado", data: top.map((b) => b.confirmed), color: TONES.emerald },
      { name: "Por confirmar", data: top.map((b) => b.pending), color: "#fcd34d" },
    ],
    stacked: true,
    horizontal: true,
    height: Math.max(200, top.length * 42 + 80),
  });
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function itemsTable(list) {
  const rows = [...list]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .map(
      (c) => `
      <tr>
        <td>${esc(dateOnly(c.date))}</td>
        <td><strong>${esc(c.description || "—")}</strong></td>
        <td>${esc(state.group === "project" ? c.costCenter?.name || "—" : c.project?.name || "—")}</td>
        <td>${esc(c.supplierRef?.name || c.supplier || "—")}</td>
        <td>${c.docNumber ? esc(c.docNumber) : `<span class="ov-warn">Sem nº</span>`}</td>
        <td>${esc(c.sourceLabel || c.source)}</td>
        <td class="fin-num"><strong>${esc(money(c.paidAmount, c.currency))}</strong></td>
        <td>${
          c.confirmationStatus === "CONFIRMADO"
            ? `<span class="finance-badge finance-badge--emerald">Confirmado</span>`
            : `<span class="finance-badge finance-badge--amber">Por confirmar</span>`
        }</td>
      </tr>`
    )
    .join("");
  return `
    <table class="finance-subtable rl-subtable">
      <thead><tr>
        <th>Data</th><th>Descrição</th><th>${state.group === "project" ? "Centro de custo" : "Obra"}</th>
        <th>Fornecedor</th><th>Nº fatura</th><th>Fonte</th>
        <th style="text-align:right">Valor</th><th>Estado</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTable(items, buckets) {
  const wrap = document.getElementById("rlTable");
  const group = GROUPS[state.group];
  document.getElementById("rlGroupName").textContent = group.label.toLowerCase();
  document.getElementById("rlHint").textContent =
    `${buckets.length} ${buckets.length === 1 ? "grupo" : "grupos"} · ${items.length} lançamentos · clique numa linha para ver os lançamentos`;

  if (!buckets.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">payments</span>Sem custos realizados para o período e filtros.</div>`;
    return;
  }

  const total = buckets.reduce((a, b) => a + b.paid, 0);
  const showBudget = state.group === "project";
  const body = buckets
    .map((b) => {
      const open = state.expanded.has(b.key);
      const share = total > 0 ? (b.paid / total) * 100 : 0;
      const confirmedPct = b.paid > 0 ? (b.confirmed / b.paid) * 100 : 0;
      const budget = showBudget && b.projectId ? state.budgets.get(b.projectId) : null;
      const exec = budget && num(budget.forecast) > 0 ? (num(budget.realized) / num(budget.forecast)) * 100 : null;
      return `
      <tr class="fin-row--clickable" data-key="${esc(b.key)}">
        <td>
          <div class="inv-doc">
            <span class="material-symbols-outlined inv-toggle ${open ? "open" : ""}">chevron_right</span>
            <div class="ov-project">
              <span class="ov-project-name">${esc(b.label)}</span>
              <span class="ov-project-meta">${esc([b.sub, `${b.items.length} lançamento${b.items.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "))}</span>
            </div>
          </div>
        </td>
        <td class="fin-num"><strong>${esc(money(b.paid))}</strong></td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span>${esc(pct(share))}</span>
            ${meterHtml([{ value: share, tone: "blue" }])}
          </div>
        </td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span class="ov-pos">${esc(money(b.confirmed))}</span>
            ${meterHtml([{ value: confirmedPct, tone: "emerald" }, { value: 100 - confirmedPct, tone: "amber-soft" }])}
            <small class="${b.pending > 0 ? "ov-warn" : ""}">${b.pending > 0 ? `${esc(compact(b.pending))} por confirmar` : "tudo confirmado"}</small>
          </div>
        </td>
        <td class="fin-num ${b.missingDoc ? "ov-warn" : "ov-muted"}">${b.missingDoc || "—"}</td>
        ${
          showBudget
            ? `<td class="fin-num">${
                exec === null
                  ? `<span class="ov-muted">Sem orçamento</span>`
                  : `<div class="ov-cell-bar">
                       <span class="${exec > 100 ? "ov-neg" : ""}">${esc(pct(exec))}</span>
                       ${meterHtml([{ value: exec, tone: exec > 100 ? "red" : "violet" }], { marker: 100 })}
                       <small>${esc(compact(budget.realized))} de ${esc(compact(budget.forecast))}</small>
                     </div>`
              }</td>`
            : ""
        }
      </tr>
      <tr class="fin-subrow" ${open ? "" : "hidden"}>
        <td colspan="${showBudget ? 6 : 5}"><div class="fp-subwrap">${open ? itemsTable(b.items) : ""}</div></td>
      </tr>`;
    })
    .join("");

  const confirmed = buckets.reduce((a, b) => a + b.confirmed, 0);
  const missing = buckets.reduce((a, b) => a + b.missingDoc, 0);
  wrap.innerHTML = `
    <table class="fin-table rl-table">
      <thead><tr>
        <th>${esc(group.label)}</th>
        <th style="text-align:right">Realizado</th>
        <th style="text-align:right">Peso</th>
        <th style="text-align:right">Confirmado</th>
        <th style="text-align:right" title="Lançamentos sem nº de fatura">Sem nº</th>
        ${showBudget ? `<th style="text-align:right" title="Custo realizado acumulado sobre o custo previsto da obra">Orçamento executado</th>` : ""}
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais (${buckets.length})</td>
        <td class="fin-num">${esc(money(total))}</td>
        <td class="fin-num">100%</td>
        <td class="fin-num">${esc(money(confirmed))}</td>
        <td class="fin-num">${missing}</td>
        ${showBudget ? "<td></td>" : ""}
      </tr></tfoot>
    </table>`;

  wrap.querySelectorAll("tr[data-key]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const key = tr.dataset.key;
      if (state.expanded.has(key)) state.expanded.delete(key);
      else state.expanded.add(key);
      renderTable(items, buckets);
    });
  });
}

/* ─── Exportação ──────────────────────────────────────────────────────────── */

function exportCsv() {
  const items = visibleItems();
  if (!items.length) return toast("Sem lançamentos para exportar.", { type: "info" });
  const cell = (v) => {
    const s = String(v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Data", "Obra", "Código obra", "Cliente", "Centro de custo", "Fornecedor", "Descrição", "Tipo custo", "Fonte", "Nº fatura", "Valor", "Confirmação", "Responsável"];
  const lines = items.map((c) =>
    [
      toDateKey(c.date) || "",
      c.project?.name,
      c.project?.code,
      c.project?.client?.name,
      c.costCenter?.name,
      c.supplierRef?.name || c.supplier,
      c.description,
      COST_TYPES[c.category] || c.category,
      c.sourceLabel || c.source,
      c.docNumber,
      num(c.paidAmount).toFixed(2).replace(".", ","),
      c.confirmationStatus === "CONFIRMADO" ? "Confirmado" : "Por confirmar",
      c.responsible,
    ]
      .map(cell)
      .join(";")
  );
  // BOM para o Excel abrir os acentos corretamente.
  const blob = new Blob([`﻿${header.join(";")}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `custos-realizados-${state.period}-${toDateKey(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

function renderAll() {
  const items = visibleItems();
  const buckets = aggregate(items);
  const months = monthlyBuckets(items);
  const start = periodStart(state.period);
  document.getElementById("rlPeriodNote").textContent = start
    ? `De ${dateOnly(start)} até hoje · só custos já realizados (pagos ou consumidos na obra)`
    : "Todo o histórico · só custos já realizados (pagos ou consumidos na obra)";
  renderKpis(items, buckets, months);
  renderStrip(items);
  renderTable(items, buckets);
  renderCharts(items, buckets, months);
}

async function load() {
  const wrap = document.getElementById("rlTable");
  if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">A carregar custos realizados…</div>`;
  const params = new URLSearchParams();
  if (state.filters.projectId) params.set("projectId", state.filters.projectId);
  try {
    const [costs, overview] = await Promise.all([
      apiRequest(`/finance/costs?${params.toString()}`),
      apiRequest("/finance/costs-overview").catch(() => ({ items: [] })),
    ]);
    // Realizado = valor já pago ou consumido; mercadoria em stock e comprometido ficam de fora.
    state.items = (costs.items || []).filter((c) => c.kind === "REALIZADO" && num(c.paidAmount) > 0);
    state.budgets = new Map(
      (overview.items || []).map((r) => [r.project.id, { id: r.project.id, forecast: r.forecast, realized: r.realized }])
    );
    state.expanded = new Set();
    renderAll();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar custos realizados.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  try {
    const projects = await apiRequest("/finance/options/projects");
    state.projects = projects.items || [];
  } catch (err) {
    toast(err.message || "Falha ao carregar obras.", { type: "error" });
  }
  renderShell();
  await load();
}
