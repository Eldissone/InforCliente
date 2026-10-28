import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawBarChart, drawComboChart, destroyCharts, TONES } from "./charts.js";
import { agingBuckets, agingPanelHtml, agingSeries } from "./aging.js";
import { kpiCardsHtml, meterHtml, num, skeletonHtml, stripHtml } from "./widgets.js";
import { dueChip } from "./contasRecebimentos.js";
import { canPayHere, openPayModal } from "./payModal.js";

/**
 * Ecrã «Pagamentos» (Financeiro · Contas a Receber e a Pagar).
 *
 * Contas a pagar = dinheiro que ainda vai sair do caixa, pelo valor do
 * documento (com IVA e retenção) e pela data de vencimento da prestação:
 * pagamentos aprovados, pedidos extra aprovados e lançamentos por liquidar.
 * Encomendas abertas, pedidos extra por aprovar e fretes por enviar ainda não
 * são dívida: aparecem à parte como compromissos.
 *
 * Cada conta pode ser paga aqui («Pagar»), pelo mesmo fluxo de liquidação dos
 * outros ecrãs; os compromissos abrem o ecrã onde são aprovados.
 */

/** Onde se tratam os compromissos (ainda não podem ser pagos). */
const COMMITMENT_LINK = {
  PEDIDO_COMPRA: { href: "/Financeiro/centrodecompras", label: "Compras" },
  PEDIDO_EXTRA: { href: "/Financeiro/centrodecompras", label: "Aprovar" },
  FRETE: { href: "/Financeiro/centrodecompras", label: "Compras" },
};

function canPay() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

function actionHtml(p) {
  if (p.stage === "A_PAGAR") {
    return canPay() && canPayHere(p)
      ? `<button type="button" class="cr-act cr-act--emerald" data-pay="${esc(p.id)}"><span class="material-symbols-outlined">payments</span><span>Pagar</span></button>`
      : "";
  }
  const link = COMMITMENT_LINK[p.source];
  return link ? `<a class="cr-act cr-act--slate" href="${link.href}"><span class="material-symbols-outlined">open_in_new</span>${esc(link.label)}</a>` : "";
}

function bindPay(root) {
  root.querySelectorAll("[data-pay]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = (state.data?.items || []).find((p) => p.id === btn.dataset.pay);
      if (item) openPayModal(item, { onSaved: load });
    });
  });
}

const VIEWS = {
  all: { label: "A pagar", test: (p) => p.stage === "A_PAGAR" },
  overdue: { label: "Vencidas", test: (p) => p.stage === "A_PAGAR" && p.daysLate > 0 },
  week: { label: "Vencem em 7 dias", test: (p) => p.stage === "A_PAGAR" && p.daysLate !== null && p.daysLate <= 0 && p.daysLate >= -7 },
  month: { label: "Vencem em 30 dias", test: (p) => p.stage === "A_PAGAR" && p.daysLate !== null && p.daysLate <= 0 && p.daysLate >= -30 },
  noDue: { label: "Sem vencimento", test: (p) => p.stage === "A_PAGAR" && p.daysLate === null },
  commitments: { label: "Compromissos", test: (p) => p.stage === "COMPROMISSO" },
};

const SOURCE_TONE = { PAGAMENTO: "blue", PEDIDO_EXTRA: "violet", LANCAMENTO: "amber", PEDIDO_COMPRA: "emerald", FRETE: "slate" };

const STATUS_LABEL = {
  PENDENTE: "Pendente",
  EM_ESPERA: "Em espera",
  APROVADO: "Aprovado",
  PENDING: "Por liquidar",
  LATE: "Atrasado",
  RASCUNHO: "Rascunho",
  PENDENTE_REQUISICAO: "Pend. requisição",
  PENDENTE_APROVACAO: "Pend. aprovação",
  EM_PAGAMENTO: "Em pagamento",
  EM_ANALISE: "Em análise",
};

const state = { view: "all", group: "item", query: "", data: null };

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div id="pgKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>
      <div id="pgStrip" class="ov-strip">${skeletonHtml(6, "cell")}</div>

      <div class="ov-row ov-row--8-4">
        ${chartCardHtml({
          id: "pgChartMonthly",
          title: "Pago mês a mês",
          subtitle: "Dinheiro que saiu para fornecedores, pela data do pagamento",
          height: 260,
          beforeChartHtml: `<div id="pgFlowTotals" class="ov-flow-totals"></div>`,
        })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head">
            <h2 class="finance-chart-title">Antiguidade</h2>
            <p class="finance-chart-subtitle">A pagar pela data de vencimento</p>
          </header>
          <div id="pgAging">${skeletonHtml(3, "line")}</div>
        </section>
      </div>

      <div class="ov-row ov-row--6-6">
        ${chartCardHtml({ id: "pgChartSuppliers", title: "A quem devemos mais", subtitle: "A pagar por fornecedor · vencido e a vencer", height: 260 })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head finance-chart-head--row">
            <div>
              <h2 class="finance-chart-title">Próximos vencimentos</h2>
              <p class="finance-chart-subtitle">O que tem de sair do caixa a seguir</p>
            </div>
            <a class="ov-link" href="/Financeiro/centro-pagamentos">Centro de Pagamentos <span class="material-symbols-outlined">arrow_forward</span></a>
          </header>
          <div id="pgNext">${skeletonHtml(4, "line")}</div>
        </section>
      </div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title" id="pgTitle">A pagar</h2>
            <p class="finance-chart-subtitle" id="pgHint">—</p>
          </div>
          <div class="ov-table-tools">
            <div class="finance-seg finance-seg--sm" id="pgGroup">
              <button type="button" data-group="item" class="active"><span class="material-symbols-outlined">list_alt</span>Por conta</button>
              <button type="button" data-group="supplier"><span class="material-symbols-outlined">local_shipping</span>Por fornecedor</button>
            </div>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="pgSearch" type="search" placeholder="Fornecedor, descrição ou obra…" autocomplete="off" />
            </label>
          </div>
        </header>
        <div id="pgTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  document.querySelectorAll("#pgGroup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.group = btn.dataset.group;
      document.querySelectorAll("#pgGroup button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });
  let timer = null;
  document.getElementById("pgSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      renderTable();
    }, 150);
  });
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function dueItems() {
  return (state.data?.items || []).filter((p) => p.stage === "A_PAGAR");
}

function renderKpis() {
  const t = state.data?.totals || {};
  const items = dueItems();
  const total = num(t.payable);
  const overduePct = total > 0 ? (num(t.overdue) / total) * 100 : 0;
  const overdueItems = items.filter((p) => p.daysLate > 0);
  const maxLate = overdueItems.reduce((a, p) => Math.max(a, p.daysLate), 0);
  const commitments = (state.data?.items || []).filter((p) => p.stage === "COMPROMISSO");
  const cards = [
    {
      key: "payable",
      label: "A pagar",
      icon: "north_east",
      tone: "blue",
      value: money(total),
      badge: `${items.length} conta${items.length === 1 ? "" : "s"}`,
      badgeTone: "blue",
      body: `
        ${meterHtml([{ value: overduePct, tone: "red" }, { value: 100 - overduePct, tone: "amber-soft" }])}
        <p class="ov-kpi-compare">Valor dos documentos, com IVA e retenção.</p>`,
    },
    {
      key: "overdue",
      label: "Vencido",
      icon: "warning",
      tone: num(t.overdue) > 0 ? "red" : "emerald",
      value: money(t.overdue),
      badge: pct(overduePct),
      badgeTone: num(t.overdue) > 0 ? "red" : "emerald",
      body: `<p class="ov-kpi-compare">${
        overdueItems.length
          ? `<strong>${overdueItems.length}</strong> conta${overdueItems.length === 1 ? "" : "s"} · maior atraso <strong class="ov-neg">${maxLate} dias</strong>`
          : "Nada em atraso com fornecedores."
      }</p>`,
    },
    {
      key: "next30",
      label: "Vence em 30 dias",
      icon: "event_upcoming",
      tone: "amber",
      value: money(t.next30),
      badge: total > 0 ? pct((num(t.next30) / total) * 100) : "—",
      badgeTone: "amber",
      body: `<p class="ov-kpi-compare">${num(t.noDueDate) > 0 ? `<span class="ov-warn">${esc(compact(t.noDueDate))} sem data de vencimento</span>` : "Saídas previstas no próximo mês."}</p>`,
    },
    {
      key: "commitments",
      label: "Compromissos",
      icon: "lock_clock",
      tone: "violet",
      value: money(t.commitments),
      badge: `${commitments.length} em curso`,
      badgeTone: "violet",
      body: `<p class="ov-kpi-compare">Encomendas e pedidos por aprovar: ainda não são dívida.</p>`,
    },
  ];
  document.getElementById("pgKpis").innerHTML = kpiCardsHtml(cards, "pg");
}

function renderStrip() {
  const items = state.data?.items || [];
  const list = (key) => items.filter(VIEWS[key].test);
  const cell = (key, icon, tone) => {
    const rows = list(key);
    return {
      label: VIEWS[key].label,
      icon,
      value: compact(rows.reduce((a, p) => a + num(p.payable), 0)),
      valueTone: tone && rows.length ? tone : null,
      sub: `${rows.length} conta${rows.length === 1 ? "" : "s"}`,
      action: key,
      active: state.view === key,
    };
  };
  const wrap = document.getElementById("pgStrip");
  wrap.innerHTML = stripHtml([
    cell("all", "list_alt"),
    cell("overdue", "warning", "neg"),
    cell("week", "today", "warn"),
    cell("month", "date_range"),
    cell("noDue", "event_busy", "warn"),
    cell("commitments", "lock_clock"),
  ]);
  wrap.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = state.view === btn.dataset.action ? "all" : btn.dataset.action;
      renderStrip();
      renderTable();
    });
  });
}

/* ─── Gráficos e painéis ──────────────────────────────────────────────────── */

async function emptyChart(id, icon, message) {
  await drawBarChart(id, {});
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">${icon}</span>${esc(message)}</div>`;
}

function supplierRows(items) {
  const map = new Map();
  items.forEach((p) => {
    const key = p.supplierId || p.supplier || "__none__";
    if (!map.has(key)) map.set(key, { key, name: p.supplier || "Sem fornecedor", items: [], payable: 0, overdue: 0, next: null });
    const s = map.get(key);
    s.items.push(p);
    s.payable += num(p.payable);
    if (p.daysLate > 0) s.overdue += num(p.payable);
    if (p.dueDate && (!s.next || new Date(p.dueDate) < new Date(s.next))) s.next = p.dueDate;
  });
  return [...map.values()].sort((a, b) => b.payable - a.payable);
}

function renderCharts() {
  const monthly = state.data?.monthly || [];
  const paid = monthly.reduce((a, m) => a + num(m.paid), 0);
  document.getElementById("pgFlowTotals").innerHTML = [
    { label: "Pago em 12 meses", value: compact(paid), dot: TONES.blue },
    { label: "Média por mês", value: compact(paid / Math.max(monthly.length, 1)), dot: TONES.slate },
    { label: "Por pagar", value: compact(state.data?.totals?.payable), dot: TONES.amber },
  ]
    .map((t) => `<div class="ov-flow-total"><span><i style="background:${t.dot}"></i>${esc(t.label)}</span><strong>${esc(t.value)}</strong></div>`)
    .join("");
  drawComboChart("pgChartMonthly", {
    categories: monthly.map((m) => m.label),
    series: [{ name: "Pago", type: "column", data: monthly.map((m) => num(m.paid)), color: TONES.blue }],
    height: 260,
  });

  document.getElementById("pgAging").innerHTML = agingPanelHtml(
    agingSeries(agingBuckets(dueItems(), { amountKey: "payable", dateKey: "dueDate" })),
    { caption: "em dívida a fornecedores", formatMoney: money, formatCompact: compact, escape: esc, emptyText: "Sem contas a pagar." }
  );

  const top = supplierRows(dueItems()).slice(0, 8);
  if (!top.length) {
    emptyChart("pgChartSuppliers", "local_shipping", "Sem dívidas a fornecedores.");
  } else {
    drawBarChart("pgChartSuppliers", {
      categories: top.map((s) => (s.name.length > 30 ? `${s.name.slice(0, 28)}…` : s.name)),
      series: [
        { name: "Vencido", data: top.map((s) => s.overdue), color: TONES.red },
        { name: "A vencer", data: top.map((s) => s.payable - s.overdue), color: "#fcd34d" },
      ],
      stacked: true,
      horizontal: true,
      height: Math.max(200, top.length * 44 + 80),
    });
  }

  // Próximos vencimentos: primeiro o que está vencido, depois por data.
  const next = dueItems()
    .filter((p) => p.dueDate)
    .slice(0, 7);
  document.getElementById("pgNext").innerHTML = next.length
    ? `<ul class="ac-feed">
        ${next
          .map(
            (p) => `
          <li>
            <span class="ac-feed-icon ${p.daysLate > 0 ? "ac-feed-icon--late" : "ac-feed-icon--out"}"><span class="material-symbols-outlined">${p.daysLate > 0 ? "priority_high" : "north_east"}</span></span>
            <div>
              <strong>${esc(p.supplier || p.description || "—")}</strong>
              <small>${esc([p.description !== p.supplier ? p.description : null, p.project?.name].filter(Boolean).join(" · "))}</small>
            </div>
            <div class="ac-feed-value">
              <strong>${esc(compact(p.payable))}</strong>
              <small>${esc(dateOnly(p.dueDate))} ${dueChip(p.daysLate)}</small>
            </div>
            ${canPay() && canPayHere(p) ? `<button type="button" class="ac-feed-pay" data-pay="${esc(p.id)}" title="Pagar"><span class="material-symbols-outlined">payments</span></button>` : ""}
          </li>`
          )
          .join("")}
      </ul>`
    : `<div class="ov-empty"><span class="material-symbols-outlined">event_available</span>Sem vencimentos agendados.</div>`;
  bindPay(document.getElementById("pgNext"));
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return (state.data?.items || []).filter((p) => {
    if (!VIEWS[state.view].test(p)) return false;
    if (!q) return true;
    return [p.supplier, p.description, p.docNumber, p.project?.name, p.project?.code].some((v) => String(v || "").toLowerCase().includes(q));
  });
}

function renderByItem(wrap, items) {
  const rows = items
    .map((p) => {
      const cur = p.currency || p.project?.currency || "AOA";
      const paidPct = num(p.amount) > 0 ? (num(p.paidAmount) / num(p.amount)) * 100 : 0;
      return `
      <tr class="${p.daysLate > 0 && p.stage === "A_PAGAR" ? "fin-row--overdue" : ""}">
        <td><div class="inv-due-cell">${esc(p.dueDate ? dateOnly(p.dueDate) : "—")}${p.stage === "A_PAGAR" ? dueChip(p.daysLate) : ""}</div></td>
        <td>
          <div class="ov-project cr-desc">
            <span class="ov-project-name cr-desc-title">${esc(p.supplier || "Sem fornecedor")}</span>
            <span class="ov-project-meta">${esc([p.docNumber, p.description].filter(Boolean).join(" · "))}</span>
          </div>
        </td>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(p.project?.name || "—")}</span>
            <span class="ov-project-meta">${esc(p.costCenter?.name || p.project?.code || "")}</span>
          </div>
        </td>
        <td><span class="finance-chip finance-chip--${SOURCE_TONE[p.source] || "slate"}">${esc(p.sourceLabel || p.source)}</span></td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span>${esc(money(p.amount, cur))}</span>
            ${num(p.paidAmount) > 0 ? meterHtml([{ value: paidPct, tone: "emerald" }]) : ""}
            ${num(p.paidAmount) > 0 ? `<small>${esc(compact(p.paidAmount))} pago</small>` : ""}
          </div>
        </td>
        <td class="fin-num ${p.daysLate > 0 && p.stage === "A_PAGAR" ? "ov-neg" : "ov-warn"}"><strong>${esc(money(p.payable, cur))}</strong></td>
        <td><span class="finance-badge finance-badge--${p.stage === "COMPROMISSO" ? "violet" : "slate"}">${esc(STATUS_LABEL[p.status] || p.status || "—")}</span></td>
        <td>${actionHtml(p)}</td>
      </tr>`;
    })
    .join("");
  wrap.innerHTML = `
    <table class="fin-table ac-table">
      <thead><tr>
        <th>Vencimento</th><th>Fornecedor · Documento</th><th>Obra · Centro</th><th>Fonte</th>
        <th style="text-align:right">Valor</th>
        <th style="text-align:right">Por pagar</th>
        <th>Estado</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="4">Totais (${items.length})</td>
        <td class="fin-num">${esc(money(items.reduce((a, p) => a + num(p.amount), 0)))}</td>
        <td class="fin-num">${esc(money(items.reduce((a, p) => a + num(p.payable), 0)))}</td>
        <td colspan="2"></td>
      </tr></tfoot>
    </table>`;
  bindPay(wrap);
}

function renderBySupplier(wrap, items) {
  const rows = supplierRows(items);
  const total = rows.reduce((a, s) => a + s.payable, 0);
  wrap.innerHTML = `
    <table class="fin-table ac-table">
      <thead><tr>
        <th>Fornecedor</th>
        <th style="text-align:right">Por pagar</th>
        <th style="text-align:right">Peso</th>
        <th style="text-align:right">Vencido</th>
        <th>Próximo vencimento</th>
      </tr></thead>
      <tbody>${rows
        .map((s) => {
          const share = total > 0 ? (s.payable / total) * 100 : 0;
          return `
          <tr>
            <td>
              <div class="ov-project">
                <span class="ov-project-name">${esc(s.name)}</span>
                <span class="ov-project-meta">${s.items.length} conta${s.items.length === 1 ? "" : "s"} · ${esc([...new Set(s.items.map((p) => p.project?.name).filter(Boolean))].slice(0, 2).join(", "))}</span>
              </div>
            </td>
            <td class="fin-num"><strong>${esc(money(s.payable))}</strong></td>
            <td class="fin-num"><div class="ov-cell-bar"><span>${esc(pct(share))}</span>${meterHtml([{ value: share, tone: "blue" }])}</div></td>
            <td class="fin-num ${s.overdue > 0 ? "ov-neg" : "ov-muted"}">${s.overdue > 0 ? esc(money(s.overdue)) : "—"}</td>
            <td>${s.next ? `<div class="inv-due-cell">${esc(dateOnly(s.next))}</div>` : `<span class="ov-muted">—</span>`}</td>
          </tr>`;
        })
        .join("")}</tbody>
      <tfoot><tr>
        <td>Totais (${rows.length} fornecedores)</td>
        <td class="fin-num">${esc(money(total))}</td>
        <td class="fin-num">100%</td>
        <td class="fin-num">${esc(money(rows.reduce((a, s) => a + s.overdue, 0)))}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

function renderTable() {
  const wrap = document.getElementById("pgTable");
  const items = visibleItems();
  document.getElementById("pgTitle").textContent = VIEWS[state.view].label;
  document.getElementById("pgHint").textContent =
    state.view === "commitments"
      ? `${items.length} compromissos · passam a conta a pagar quando forem aprovados ou faturados`
      : `${items.length} contas · ordenadas pelo vencimento · «Pagar» confirma o pagamento com o comprovativo`;
  if (!items.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">task_alt</span>Nada nesta vista.</div>`;
    return;
  }
  if (state.group === "supplier") return renderBySupplier(wrap, items);
  return renderByItem(wrap, items);
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  try {
    state.data = await apiRequest("/finance/payables");
    renderKpis();
    renderStrip();
    renderTable();
    renderCharts();
  } catch (err) {
    const wrap = document.getElementById("pgTable");
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar contas a pagar.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  const view = new URLSearchParams(window.location.search).get("view");
  if (view && VIEWS[view]) state.view = view;
  renderShell();
  await load();
}
