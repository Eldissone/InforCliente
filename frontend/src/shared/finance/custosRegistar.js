import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawComboChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";
import { AGING_TONES } from "./aging.js";
import { kpiCardsHtml, meterHtml, num, skeletonHtml, stripHtml } from "./widgets.js";
import { COST_TYPES, loadCostFormOptions, openConfirmCostModal, openCostForm } from "./costForm.js";

/**
 * Ecrã «Registar Custos» (Financeiro · Custos).
 *
 * Lista TODOS os custos da plataforma numa só tabela, com a área de origem:
 * pagamentos/cotações, pedidos extra, lançamentos de obra, pedidos de compra,
 * fretes, consumo de stock da obra e levantamentos ATM.
 *
 * O trabalho do financeiro é a faixa de ações:
 *  - registar o nº da fatura e confirmar o custo (pagamentos e consumos);
 *  - discriminar os levantamentos ATM por fornecedor/produto/categoria;
 *  - acompanhar a mercadoria paga que ainda está em stock (não é custo da obra
 *    até sair para a obra).
 */

const SOURCE_TONE = {
  PAGAMENTO: "blue",
  PEDIDO_EXTRA: "violet",
  LANCAMENTO: "amber",
  PEDIDO_COMPRA: "emerald",
  FRETE: "slate",
  CONSUMO_STOCK: "emerald",
  ATM: "red",
};

const SOURCE_COLOR = {
  PAGAMENTO: TONES.blue,
  PEDIDO_EXTRA: TONES.violet,
  LANCAMENTO: TONES.amber,
  PEDIDO_COMPRA: "#0ea5e9",
  FRETE: TONES.slate,
  CONSUMO_STOCK: TONES.emerald,
  ATM: TONES.red,
};

const DETAIL = {
  MERCADORIA_STOCK: "Mercadoria em stock",
  PAGAMENTO_DIRETO: "Pagamento direto",
  MOVIMENTO_BANCARIO: "Movimento bancário",
  ATM: "ATM",
  MANUAL: "Manual",
  SAIDA_OBRA: "Saída para a obra",
};

const VIEWS = {
  all: { label: "Todos", test: (c) => c.kind !== "STOCK" },
  action: { label: "Por confirmar", test: (c) => c.action === "CONFIRMAR" || c.action === "REGISTAR_FATURA" },
  missingDoc: { label: "Sem nº fatura", test: (c) => c.action === "REGISTAR_FATURA" },
  atm: { label: "ATM por discriminar", test: (c) => c.action === "DISCRIMINAR" },
  confirmed: { label: "Confirmados", test: (c) => c.confirmationStatus === "CONFIRMADO" && c.kind !== "STOCK" },
  committed: { label: "Comprometidos", test: (c) => num(c.remaining) > 0 },
  stock: { label: "Mercadoria em stock", test: (c) => c.kind === "STOCK" },
};

const state = {
  view: "all",
  query: "",
  filters: { projectId: "", source: "" },
  months: 12,
  projects: [],
  sources: [],
  items: [],
  totals: null,
  charts: null,
  expanded: new Set(),
  formOptions: null,
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

function canEdit() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

function canApprove() {
  return can("financeiro", "approve") || can("financeiro", "manage");
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function sourceChip(c) {
  const tone = SOURCE_TONE[c.source] || "slate";
  const detail = c.isMerchandise ? DETAIL.MERCADORIA_STOCK : c.source === "CONSUMO_STOCK" ? null : DETAIL[c.detail];
  return `
    <div class="cr-source">
      <span class="finance-chip finance-chip--${tone}">${esc(c.sourceLabel || c.source)}</span>
      ${detail ? `<small>${esc(detail)}</small>` : ""}
    </div>`;
}

function stateCell(c) {
  if (c.kind === "STOCK") return `<span class="finance-badge finance-badge--slate" title="Paga, ainda em armazém">Em stock</span>`;
  if (c.action === "DISCRIMINAR") return `<span class="finance-badge finance-badge--red">Por discriminar</span>`;
  if (c.action === "REGISTAR_FATURA") return `<span class="finance-badge finance-badge--amber">Sem nº fatura</span>`;
  if (c.confirmationStatus === "CONFIRMADO") return `<span class="finance-badge finance-badge--emerald">Confirmado</span>`;
  if (c.kind === "COMPROMETIDO") return `<span class="finance-badge finance-badge--slate">Comprometido</span>`;
  if (c.source === "CONSUMO_STOCK" && !c.hasUnitCost) return `<span class="finance-badge finance-badge--amber" title="Não há entradas valorizadas deste produto">Sem custo unitário</span>`;
  if (c.confirmable) return `<span class="finance-badge finance-badge--amber">Por confirmar</span>`;
  return `<span class="finance-badge finance-badge--slate" title="Gerido na área de origem">Na origem</span>`;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div id="crKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>
      <div id="crStrip" class="ov-strip">${skeletonHtml(6, "cell")}</div>

      ${chartCardHtml({
        id: "crChartMonthly",
        title: "Custos mês a mês",
        subtitle: "Custo realizado e valor comprometido (por pagar) pela data do custo",
        hint: "Realizado é dinheiro que já saiu (ou material consumido na obra); comprometido é o que está assumido e ainda não foi pago.",
        height: 280,
        actionsHtml: `
          <div class="finance-seg finance-seg--sm" id="crRange">
            <button type="button" data-months="6">6M</button>
            <button type="button" data-months="12" class="active">12M</button>
          </div>`,
        beforeChartHtml: `<div id="crFlowTotals" class="ov-flow-totals"></div>`,
      })}

      <div class="ov-row ov-row--6-6">
        <section class="finance-card ov-panel">
          <header class="finance-chart-head">
            <h2 class="finance-chart-title">Por pagar</h2>
            <p class="finance-chart-subtitle">Valor comprometido por antiguidade da data do custo</p>
          </header>
          <div id="crAging">${skeletonHtml(3, "line")}</div>
        </section>
        ${chartCardHtml({ id: "crChartSources", title: "Realizado por fonte", subtitle: "Área da plataforma de onde vem cada custo", height: 280 })}
      </div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title" id="crTitle">Custos</h2>
            <p class="finance-chart-subtitle" id="crCount">—</p>
          </div>
          <div class="ov-table-tools">
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="crSearch" type="search" placeholder="Descrição, nº fatura, fornecedor…" autocomplete="off" />
            </label>
            <select id="crProject" class="finance-select inv-filter" title="Obra"></select>
            <select id="crSource" class="finance-select inv-filter" title="Fonte"></select>
            <button id="crClear" type="button" class="finance-btn finance-btn--ghost inv-filter-clear" title="Limpar filtros">
              <span class="material-symbols-outlined">filter_alt_off</span>
            </button>
          </div>
        </header>
        <div id="crTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  const projectSel = document.getElementById("crProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.code ? `${p.code} — ${p.name}` : p.name)}</option>`).join("");
  projectSel.value = state.filters.projectId;
  fillSources();

  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    load();
  });
  document.getElementById("crSource").addEventListener("change", (e) => {
    state.filters.source = e.target.value;
    renderAll();
  });
  document.getElementById("crClear").addEventListener("click", () => {
    const reload = Boolean(state.filters.projectId);
    state.filters = { projectId: "", source: "" };
    state.query = "";
    state.view = "all";
    projectSel.value = "";
    document.getElementById("crSource").value = "";
    document.getElementById("crSearch").value = "";
    if (reload) load();
    else renderAll();
  });

  let timer = null;
  document.getElementById("crSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      renderTable();
    }, 150);
  });

  document.querySelectorAll("#crRange button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.months = Number(btn.dataset.months);
      document.querySelectorAll("#crRange button").forEach((b) => b.classList.toggle("active", b === btn));
      renderMonthly();
    });
  });

  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = canEdit()
      ? `<button id="crNew" type="button" class="finance-btn finance-btn--primary">
           <span class="material-symbols-outlined">add</span>Novo Custo
         </button>`
      : "";
    document.getElementById("crNew")?.addEventListener("click", () => openForm());
  }
}

function fillSources() {
  const sel = document.getElementById("crSource");
  if (!sel) return;
  sel.innerHTML =
    `<option value="">Todas as fontes</option>` +
    state.sources.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join("");
  sel.value = state.filters.source;
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis() {
  const t = state.totals || {};
  const realized = num(t.realized);
  const confirmedPct = realized > 0 ? (num(t.confirmed) / realized) * 100 : 0;
  const stockConsumed = num(t.bySource?.CONSUMO_STOCK);
  const cards = [
    {
      key: "realized",
      label: "Custo realizado",
      icon: "payments",
      tone: "blue",
      value: money(realized),
      badge: `${pct(confirmedPct)} confirmado`,
      badgeTone: confirmedPct >= 100 ? "emerald" : "amber",
      body: `
        ${meterHtml([
          { value: confirmedPct, tone: "emerald" },
          { value: 100 - confirmedPct, tone: "amber-soft" },
        ])}
        <p class="ov-kpi-compare">
          <span class="ov-legend"><i class="ov-dot ov-dot--emerald"></i>Confirmado ${esc(compact(t.confirmed))}</span>
          <span class="ov-legend" style="margin-left:0.6rem"><i class="ov-dot ov-dot--amber"></i>Por confirmar ${esc(compact(t.pending))}</span>
        </p>`,
    },
    {
      key: "action",
      label: "A tratar pelo financeiro",
      icon: "task_alt",
      tone: num(t.actionCount) > 0 ? "amber" : "emerald",
      value: String(num(t.actionCount)),
      badge: compact(t.actionValue),
      badgeTone: num(t.actionCount) > 0 ? "amber" : "emerald",
      body: `
        <dl class="ov-kpi-split">
          <div><dt>Sem nº fatura</dt><dd class="${num(t.missingDocCount) ? "ov-warn" : ""}">${num(t.missingDocCount)}</dd></div>
          <div><dt>ATM por discriminar</dt><dd class="${num(t.toDiscriminateCount) ? "ov-neg" : ""}">${num(t.toDiscriminateCount)}</dd></div>
        </dl>`,
    },
    {
      key: "committed",
      label: "Comprometido",
      icon: "lock_clock",
      tone: "slate",
      value: money(t.committed),
      badge: "por pagar",
      badgeTone: "blue",
      body: `<p class="ov-kpi-compare">Assumido em pagamentos, pedidos e encomendas ainda abertos · projeção <strong>${esc(compact(realized + num(t.committed)))}</strong></p>`,
    },
    {
      key: "stock",
      label: "Mercadoria",
      icon: "inventory_2",
      tone: "emerald",
      value: money(stockConsumed),
      badge: "consumida",
      badgeTone: "emerald",
      body: `
        <dl class="ov-kpi-split">
          <div><dt>Paga, em stock</dt><dd>${esc(compact(t.stock))}</dd></div>
          <div><dt>Saídas sem custo</dt><dd class="${num(t.noUnitCostCount) ? "ov-warn" : ""}">${num(t.noUnitCostCount)}</dd></div>
        </dl>`,
    },
  ];
  document.getElementById("crKpis").innerHTML = kpiCardsHtml(cards, "cr");
}

function viewCount(key) {
  return state.items.filter((c) => VIEWS[key].test(c)).length;
}

function viewValue(key, field = "paidAmount") {
  return state.items.filter((c) => VIEWS[key].test(c)).reduce((a, c) => a + num(c[field]), 0);
}

function renderStrip() {
  const cell = (key, icon, { value, sub, tone } = {}) => ({
    label: VIEWS[key].label,
    icon,
    value: value ?? String(viewCount(key)),
    valueTone: tone || null,
    sub,
    action: key,
    active: state.view === key,
  });
  const actionN = viewCount("action");
  const missingN = viewCount("missingDoc");
  const atmN = viewCount("atm");
  const wrap = document.getElementById("crStrip");
  wrap.innerHTML = stripHtml([
    cell("all", "list_alt", { sub: compact(viewValue("all")) + " realizados" }),
    cell("action", "pending_actions", { tone: actionN ? "warn" : null, sub: compact(viewValue("action")) + " a confirmar" }),
    cell("missingDoc", "receipt_long", { tone: missingN ? "warn" : null, sub: "registar o nº da fatura" }),
    cell("atm", "atm", { tone: atmN ? "neg" : null, sub: atmN ? compact(viewValue("atm")) + " por discriminar" : "tudo discriminado" }),
    cell("confirmed", "verified", { sub: compact(viewValue("confirmed")) + " confirmados" }),
    cell("stock", "inventory_2", { sub: compact(viewValue("stock", "stockValue")) + " pagos em armazém" }),
  ]);
  wrap.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = state.view === btn.dataset.action && btn.dataset.action !== "all" ? "all" : btn.dataset.action;
      renderStrip();
      renderTable();
    });
  });
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter((c) => {
    if (!VIEWS[state.view].test(c)) return false;
    if (state.filters.source && c.source !== state.filters.source) return false;
    if (!q) return true;
    return [c.description, c.docNumber, c.supplierRef?.name, c.supplier, c.project?.name, c.project?.code, c.costCenter?.name]
      .some((v) => String(v || "").toLowerCase().includes(q));
  });
}

function detailRow(c, cur) {
  const item = (label, value, cls = "") => `
    <div class="inv-detail-item">
      <span>${esc(label)}</span>
      <strong class="${cls}">${value}</strong>
    </div>`;
  const cat = c.costCategory ? [c.costCategory.parentName, c.costCategory.name].filter(Boolean).join(" › ") : null;
  const parts = [
    item("Centro de custo", esc(c.costCenter ? `${c.costCenter.code || ""} ${c.costCenter.name}`.trim() : "—")),
    item("Tipo custo", esc(COST_TYPES[c.category] || c.category || "—")),
    item("Categoria / subcategoria", esc(cat || "—")),
    item("Valor do custo", esc(money(c.amount, cur))),
  ];
  if (c.source === "CONSUMO_STOCK") {
    parts.push(
      item("Quantidade", esc(String(c.quantity ?? "—"))),
      item("Custo médio unitário", c.hasUnitCost ? esc(money(c.unitCost, cur)) : "Sem entradas valorizadas", c.hasUnitCost ? "" : "ov-warn")
    );
  }
  if (c.kind === "STOCK") parts.push(item("Pago, em stock", esc(money(c.stockValue, cur))));
  parts.push(
    item("Responsável", esc(c.responsible || "—")),
    item("Estado na origem", esc(c.status || "—")),
    item("Movimento bancário", c.bankMovementId ? "Ligado ao extrato" : "—", c.bankMovementId ? "ov-pos" : "")
  );
  return `<div class="inv-detail">${parts.join("")}</div>`;
}

function actionButtons(c) {
  if (!canEdit()) return "";
  if (c.action === "DISCRIMINAR") {
    return `<button type="button" class="cr-act cr-act--red" data-act="split"><span class="material-symbols-outlined">call_split</span>Discriminar</button>`;
  }
  if (c.action === "REGISTAR_FATURA") {
    return `<button type="button" class="cr-act cr-act--amber" data-act="confirm"><span class="material-symbols-outlined">receipt_long</span>Nº fatura</button>`;
  }
  if (c.action === "CONFIRMAR") {
    return canApprove()
      ? `<button type="button" class="cr-act cr-act--emerald" data-act="confirm"><span class="material-symbols-outlined">done</span>Confirmar</button>`
      : `<span class="finance-badge finance-badge--amber" title="Aguarda aprovação do financeiro">Por confirmar</span>`;
  }
  if (c.confirmable && c.confirmationStatus === "CONFIRMADO") {
    return `<div class="cr-state">${stateCell(c)}<button type="button" class="fin-icon-btn" data-act="edit" title="Corrigir nº da fatura"><span class="material-symbols-outlined" style="font-size:16px">edit</span></button></div>`;
  }
  return "";
}

function renderTable() {
  const wrap = document.getElementById("crTable");
  if (!wrap) return;
  const items = visibleItems();
  document.getElementById("crTitle").textContent = state.view === "all" ? "Custos" : VIEWS[state.view].label;
  document.getElementById("crCount").textContent =
    `${items.length} de ${state.items.length} lançamentos · clique numa linha para ver centro de custo, categoria e responsável`;

  if (!items.length) {
    wrap.innerHTML = `
      <div class="ov-empty ov-empty--lg">
        <span class="material-symbols-outlined">${state.view === "all" ? "request_quote" : "task_alt"}</span>
        ${state.items.length ? (state.view === "all" ? "Nenhum custo corresponde aos filtros." : "Nada a tratar nesta vista.") : "Ainda não há custos registados."}
      </div>`;
    return;
  }

  const rows = items
    .map((c) => {
      const cur = c.currency || c.project?.currency || "AOA";
      const open = state.expanded.has(c.id);
      const supplier = c.supplierRef?.name || c.supplier;
      const value = c.kind === "STOCK" ? c.stockValue : c.paidAmount;
      return `
      <tr data-id="${esc(c.id)}" class="fin-row--clickable ${c.action === "DISCRIMINAR" ? "fin-row--overdue" : ""}">
        <td>
          <div class="inv-doc">
            <span class="material-symbols-outlined inv-toggle ${open ? "open" : ""}">chevron_right</span>
            <div class="cr-desc">
              <span class="cr-desc-title">${esc(c.description || "—")}</span>
              <span class="ov-project-meta">${c.docNumber ? `<strong class="cr-doc">${esc(c.docNumber)}</strong> · ` : ""}${esc(dateOnly(c.date))}${supplier ? ` · ${esc(supplier)}` : ""}</span>
            </div>
          </div>
        </td>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(c.project?.name || "—")}</span>
            <span class="ov-project-meta">${esc(c.costCenter?.name || c.project?.code || "")}</span>
          </div>
        </td>
        <td>${sourceChip(c)}</td>
        <td class="fin-num ${c.kind === "STOCK" ? "ov-muted" : ""}"><strong>${esc(money(value, cur))}</strong></td>
        <td class="fin-num ${num(c.remaining) > 0 ? "ov-warn" : "ov-muted"}">${num(c.remaining) > 0 ? esc(money(c.remaining, cur)) : "—"}</td>
        <td>${actionButtons(c) || stateCell(c)}</td>
      </tr>
      <tr class="fin-subrow" ${open ? "" : "hidden"}>
        <td colspan="6">${detailRow(c, cur)}</td>
      </tr>`;
    })
    .join("");

  const paid = items.filter((c) => c.kind !== "STOCK").reduce((a, c) => a + num(c.paidAmount), 0);
  const remaining = items.reduce((a, c) => a + num(c.remaining), 0);
  wrap.innerHTML = `
    <table class="fin-table cr-table">
      <thead>
        <tr>
          <th>Custo · Nº fatura</th><th>Obra · Centro</th><th>Fonte</th>
          <th style="text-align:right">Realizado</th>
          <th style="text-align:right">Por pagar</th>
          <th>Estado · Ação</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3">Totais (${items.length} lançamentos)</td>
          <td class="fin-num">${esc(money(paid))}</td>
          <td class="fin-num">${esc(money(remaining))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;

  wrap.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    const cost = state.items.find((c) => c.id === tr.dataset.id);
    if (!cost) return;
    tr.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === "split") return openSplit(cost);
        return openConfirmCostModal(cost, { canApprove: act.dataset.act === "confirm" && canApprove(), onSaved: load });
      }
      if (state.expanded.has(cost.id)) state.expanded.delete(cost.id);
      else state.expanded.add(cost.id);
      renderTable();
    });
  });
}

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

/** Estado vazio no lugar de um gráfico (liberta primeiro o gráfico anterior). */
async function emptyChart(id, icon, message) {
  await drawComboChart(id, {});
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">${icon}</span>${esc(message)}</div>`;
}

function renderMonthly() {
  const months = (state.charts?.monthly || []).slice(-state.months);
  const cost = months.reduce((a, m) => a + num(m.cost), 0);
  const committed = months.reduce((a, m) => a + num(m.committed), 0);
  const avg = months.length ? cost / months.length : 0;
  document.getElementById("crFlowTotals").innerHTML = [
    { label: "Realizado", value: compact(cost), dot: TONES.blue },
    { label: "Comprometido", value: compact(committed), dot: TONES.amber },
    { label: "Média mensal", value: compact(avg), dot: TONES.slate },
  ]
    .map((t) => `<div class="ov-flow-total"><span><i style="background:${t.dot}"></i>${esc(t.label)}</span><strong>${esc(t.value)}</strong></div>`)
    .join("");
  drawComboChart("crChartMonthly", {
    categories: months.map((m) => m.label),
    series: [
      { name: "Realizado", type: "column", data: months.map((m) => num(m.cost)), color: TONES.blue },
      { name: "Comprometido", type: "line", data: months.map((m) => num(m.committed)), color: TONES.amber },
    ],
    height: 280,
  });
}

function renderAging() {
  const columns = state.charts?.payablesAging || [];
  const total = columns.reduce((a, col) => a + num(col.value), 0);
  const wrap = document.getElementById("crAging");
  if (total <= 0) {
    wrap.innerHTML = `<div class="ov-empty"><span class="material-symbols-outlined">task_alt</span>Sem valores por pagar.</div>`;
    return;
  }
  const open = state.items.filter((c) => num(c.remaining) > 0).length;
  wrap.innerHTML = `
    <div class="ov-aging-total">
      <strong>${esc(money(total))}</strong>
      <span>${open} custos com valor por pagar</span>
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
          <span class="ov-aging-pct">${esc(pct((num(col.value) / total) * 100))}</span>
          <strong>${esc(compact(col.value))}</strong>
        </li>`
        )
        .join("")}
    </ul>`;
}

function renderCharts() {
  renderMonthly();
  renderAging();
  const sources = (state.charts?.costBySource || []).filter((s) => num(s.realized) > 0);
  if (!sources.length) return emptyChart("crChartSources", "donut_large", "Sem custo realizado no filtro.");
  drawDonutChart("crChartSources", {
    labels: sources.map((s) => s.label),
    series: sources.map((s) => num(s.realized)),
    colors: sources.map((s) => SOURCE_COLOR[s.source] || TONES.slate),
    height: 280,
  });
}

/* ─── Ações ───────────────────────────────────────────────────────────────── */

async function formOptions() {
  if (!state.formOptions) state.formOptions = await loadCostFormOptions();
  return state.formOptions;
}

async function openForm(movement = null) {
  try {
    const options = await formOptions();
    openCostForm({
      movement,
      options,
      onSaved: () => {
        state.formOptions = null;
        load();
      },
    });
  } catch (err) {
    toast(err.message || "Falha ao abrir o formulário.", { type: "error" });
  }
}

async function openSplit(cost) {
  try {
    const options = await loadCostFormOptions({ withMovements: true });
    const movement = options.movements.find((m) => m.id === cost.sourceId);
    if (!movement) return toast("Este levantamento já foi discriminado.", { type: "info" });
    openCostForm({
      movement,
      options,
      onSaved: () => {
        state.formOptions = null;
        load();
      },
    });
  } catch (err) {
    toast(err.message || "Falha ao abrir o levantamento.", { type: "error" });
  }
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

function renderAll() {
  renderKpis();
  renderStrip();
  renderTable();
}

async function load() {
  const wrap = document.getElementById("crTable");
  if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">A carregar custos…</div>`;
  const params = new URLSearchParams();
  if (state.filters.projectId) params.set("projectId", state.filters.projectId);
  try {
    const data = await apiRequest(`/finance/costs?${params.toString()}`);
    state.items = data.items || [];
    state.totals = data.totals || null;
    state.charts = data.charts || null;
    const sources = data.sources || {};
    state.sources = Array.isArray(sources) ? sources : Object.entries(sources).map(([key, label]) => ({ key, label }));
    fillSources();
    renderAll();
    renderCharts();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar custos: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar custos.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  state.expanded = new Set();
  state.formOptions = null;
  // Atalho vindo da Overview: /Financeiro/custos/registar?view=atm
  const view = new URLSearchParams(window.location.search).get("view");
  if (view && VIEWS[view]) state.view = view;
  try {
    const projects = await apiRequest("/finance/options/projects");
    state.projects = projects.items || [];
  } catch (err) {
    toast(err.message || "Falha ao carregar obras.", { type: "error" });
  }
  renderShell();
  await load();
}
