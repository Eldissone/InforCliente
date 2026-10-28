import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { can } from "../permissions.js";
import { toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawBarChart, drawComboChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";
import { kpiCardsHtml, meterHtml as meter, num, skeletonHtml } from "./widgets.js";
import {
  money,
  dateOnly,
  movementChip,
  isIncoming,
  needsCostAssignment,
  isReceiptLinked,
  receiptFree,
  receiptStateHtml,
  costStatusHtml,
  loadMovementOptions,
  openClassifyModal,
  openAssignCostModal,
} from "./movementsShared.js";

/**
 * Movimentos da Tesouraria (Financeiro · Tesouraria), um ecrã por natureza:
 *  - Recebimentos do Cliente  → entrada de valores; liga-se à fatura do cliente;
 *  - Transferências Internas  → entrada de valores nos cartões de obra, com
 *    origem nas requisições de fundo (requisição → cash flow da obra →
 *    pagamento a fornecedor);
 *  - Levantamentos ATM        → saída de valores; o custo separa-se por
 *    fornecedor e tipo de custo («Separar custos»);
 *  - Pagamentos a Fornecedor  → saída de valores; crédito (liquida um custo já
 *    registado) ou pronto pagamento (o custo nasce no pagamento), material ou
 *    serviço. Mercadoria entra em stock: o custo vem da saída de stock.
 *
 * «Associar Custo» só existe nas saídas.
 */

const PERIODS = [
  { key: "30", label: "30 dias", days: 30 },
  { key: "90", label: "90 dias", days: 90 },
  { key: "365", label: "12 meses", days: 365 },
  { key: "all", label: "Tudo", days: null },
];

/** Saída que ainda precisa de custo (a mercadoria não: o custo vem da saída de stock). */
function toAssign(m) {
  return needsCostAssignment(m) && !m.isMerchandise && !m.costAssigned;
}

const NOT_SUPPLIER_PAYMENT = ["LEVANTAMENTO_ATM", "RECEBIMENTO_CLIENTE", "TRANSFERENCIA_INTERNA", "OPERACAO_ANULADA"];

const SETTLEMENT = {
  CREDITO: { label: "Crédito", tone: "violet", hint: "Liquida um custo registado a crédito" },
  PRONTO: { label: "Pronto pagamento", tone: "blue", hint: "O custo nasce no pagamento" },
};

const NATURE = {
  MATERIAL: { label: "Material", tone: "amber" },
  SERVICO: { label: "Serviço", tone: "emerald" },
  MISTO: { label: "Misto", tone: "slate" },
};

const FUND_STATUS = {
  PENDENTE: { label: "Por aprovar", tone: "amber" },
  APROVADO: { label: "Aprovada", tone: "emerald" },
  REJEITADO: { label: "Rejeitada", tone: "red" },
  CANCELADO: { label: "Cancelada", tone: "slate" },
};

/* ─── Configuração por ecrã ───────────────────────────────────────────────── */

const PAGES = {
  "tesouraria-recebimentos": {
    query: { movementType: "RECEBIMENTO_CLIENTE" },
    noun: "recebimento",
    groupBy: "project",
    views: [
      { key: "all", label: "Todos" },
      { key: "toLink", label: "Por ligar à fatura", test: (m) => !isReceiptLinked(m) },
      { key: "linked", label: "Ligados", test: (m) => isReceiptLinked(m) },
    ],
  },
  "tesouraria-transferencias": {
    query: { movementType: "TRANSFERENCIA_INTERNA" },
    noun: "transferência",
    groupBy: "card",
    fundRequests: true,
    views: [
      { key: "all", label: "Todas" },
      { key: "in", label: "Entradas no cartão", test: (m) => isIncoming(m) },
      { key: "out", label: "Saídas da conta", test: (m) => !isIncoming(m) },
    ],
  },
  "tesouraria-atm": {
    query: { movementType: "LEVANTAMENTO_ATM" },
    noun: "levantamento",
    groupBy: "supplier",
    views: [
      { key: "all", label: "Todos" },
      { key: "pending", label: "Por separar", test: toAssign },
      { key: "done", label: "Separados", test: (m) => m.costAssigned },
    ],
  },
  "tesouraria-pagamentos": {
    query: { direction: "SAIDA" },
    filter: (m) => !NOT_SUPPLIER_PAYMENT.includes(m.movementType),
    noun: "pagamento",
    groupBy: "supplier",
    views: [
      { key: "all", label: "Todos" },
      { key: "pending", label: "Por associar", test: toAssign },
      { key: "credit", label: "Crédito", test: (m) => m.costSummary?.settlement === "CREDITO" },
      { key: "prompt", label: "Pronto pagamento", test: (m) => m.costSummary?.settlement === "PRONTO" },
      { key: "stock", label: "Mercadoria", test: (m) => m.isMerchandise },
    ],
  },
};

const state = {
  options: null,
  items: [],
  fundRequests: [],
  period: "365",
  view: "all",
  projectId: "",
  query: "",
};

function page() {
  return document.body.dataset.financePage;
}

function cfg() {
  return PAGES[page()] || PAGES["tesouraria-pagamentos"];
}

function canEdit() {
  return can("financeiro", "edit") || can("financeiro", "manage");
}

function sumOf(rows) {
  return rows.reduce((a, m) => a + num(m.amount), 0);
}

/** Movimentos do ecrã, já filtrados por período, obra e pesquisa (sem a vista). */
function scoped() {
  const c = cfg();
  const days = PERIODS.find((p) => p.key === state.period)?.days;
  const since = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  const q = state.query.trim().toLowerCase();
  return state.items.filter((m) => {
    if (c.filter && !c.filter(m)) return false;
    if (since && new Date(m.movementDate).getTime() < since) return false;
    if (state.projectId && m.projectId !== state.projectId) return false;
    if (q) {
      const hay = [m.description, m.docNumber, m.project?.name, m.supplier?.name, m.card?.label, ...(m.costSummary?.suppliers || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function visible() {
  const view = cfg().views.find((v) => v.key === state.view);
  const rows = scoped();
  return view?.test ? rows.filter(view.test) : rows;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  const c = cfg();
  const isPayments = page() === "tesouraria-pagamentos";
  const side = c.fundRequests
    ? `
      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Requisições de fundo</h2>
            <p class="finance-chart-subtitle">Pedidos de reforço dos cartões de obra · 180 dias</p>
          </div>
          <a class="ov-link" href="/Financeiro/centro-pagamentos">Aprovar <span class="material-symbols-outlined">arrow_forward</span></a>
        </header>
        <div id="tzFunds">${skeletonHtml(3, "line")}</div>
      </section>`
    : chartCardHtml({
        id: "tzChartSplit",
        title: isPayments ? "Crédito vs pronto pagamento" : page() === "tesouraria-atm" ? "Separação por fornecedor" : "Por obra",
        subtitle: isPayments
          ? "Valor pago no período, pelos custos associados"
          : page() === "tesouraria-atm"
            ? "Custos discriminados nos levantamentos do período"
            : "Valor recebido no período",
        height: 280,
      });

  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      ${flowHtml()}
      <div id="tzKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>

      <div class="ov-row ov-row--8-4">
        ${chartCardHtml({
          id: "tzChartMonthly",
          title: "Mês a mês",
          subtitle: "Valor por mês, pela data do movimento",
          height: 280,
        })}
        ${side}
      </div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Movimentos</h2>
            <p class="finance-chart-subtitle" id="tzHint">—</p>
          </div>
          <div class="ov-table-tools">
            <div class="finance-seg finance-seg--sm" id="tzPeriod">
              ${PERIODS.map((p) => `<button type="button" data-period="${p.key}" class="${p.key === state.period ? "active" : ""}"><span>${p.label}</span></button>`).join("")}
            </div>
            <select id="tzProject" class="finance-select inv-filter" title="Obra">
              <option value="">Todas as obras</option>
              ${(state.options?.projects || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
            </select>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="tzSearch" type="search" placeholder="Descrição, doc, fornecedor…" autocomplete="off" />
            </label>
          </div>
        </header>
        <div class="finance-seg tz-views" id="tzViews"></div>
        <div id="tzTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  document.querySelectorAll("#tzPeriod button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.period = btn.dataset.period;
      document.querySelectorAll("#tzPeriod button").forEach((b) => b.classList.toggle("active", b === btn));
      renderAll();
    })
  );
  document.getElementById("tzProject").addEventListener("change", (e) => {
    state.projectId = e.target.value;
    renderAll();
  });
  document.getElementById("tzSearch").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderViews();
    renderTable();
  });
}

/** Faixa com o circuito do dinheiro em cada ecrã (regras de negócio à vista). */
function flowHtml() {
  const steps = {
    "tesouraria-recebimentos": [
      { icon: "receipt_long", title: "Fatura emitida", text: "Contas a receber" },
      { icon: "south_west", title: "Entrada no banco", text: "Movimento do extrato" },
      { icon: "link", title: "Registar na fatura", text: "Abate o valor em falta" },
    ],
    "tesouraria-transferencias": [
      { icon: "request_page", title: "Requisição de fundo", text: "Pedido de reforço do cartão" },
      { icon: "swap_horiz", title: "Transferência interna", text: "Entra no cash flow da obra" },
      { icon: "north_east", title: "Pagamento a fornecedor", text: "Sai do cartão da obra" },
    ],
    "tesouraria-atm": [
      { icon: "local_atm", title: "Levantamento", text: "Saída de valores do cartão" },
      { icon: "call_split", title: "Separar por fornecedor", text: "E por tipo de custo" },
      { icon: "price_check", title: "Custo da obra", text: "Um custo por item" },
    ],
    "tesouraria-pagamentos": [
      { icon: "credit_score", title: "Crédito", text: "Custo registado antes · o pagamento salda-o" },
      { icon: "bolt", title: "Pronto pagamento", text: "O custo nasce no pagamento" },
      { icon: "inventory_2", title: "Mercadoria", text: "Entra em stock · custo na saída para a obra" },
    ],
  }[page()];
  if (!steps) return "";
  return `
    <ol class="tz-flow">
      ${steps
        .map(
          (s, i) => `
        <li>
          <span class="tz-flow-icon"><span class="material-symbols-outlined">${s.icon}</span></span>
          <div><strong>${esc(s.title)}</strong><small>${esc(s.text)}</small></div>
          ${i < steps.length - 1 && page() !== "tesouraria-pagamentos" ? `<span class="material-symbols-outlined tz-flow-arrow">arrow_forward</span>` : ""}
        </li>`
        )
        .join("")}
    </ol>`;
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis() {
  const rows = scoped();
  const total = sumOf(rows);
  const periodLabel = PERIODS.find((p) => p.key === state.period)?.label.toLowerCase();
  const cards = [];

  if (page() === "tesouraria-recebimentos") {
    const linkedValue = rows.reduce((a, m) => a + num(m.receiptLink?.linked), 0);
    const toLink = rows.filter((m) => !isReceiptLinked(m));
    const linked = rows.filter(isReceiptLinked);
    const clients = new Set(rows.map((m) => m.projectId).filter(Boolean)).size;
    cards.push(
      { key: "in", label: "Recebido", icon: "south_west", tone: "emerald", value: compact(total), foot: `${rows.length} recebimento${rows.length === 1 ? "" : "s"} · ${periodLabel}` },
      {
        key: "linked",
        label: "Ligado a faturas",
        icon: "link",
        tone: "blue",
        value: compact(linkedValue),
        badge: total > 0 ? `${Math.round((linkedValue / total) * 100)}%` : null,
        body: meter([{ value: total > 0 ? (linkedValue / total) * 100 : 0, tone: "blue" }]),
        foot: `${linked.length} de ${rows.length} movimentos`,
      },
      {
        key: "toLink",
        label: "Por ligar",
        icon: "link_off",
        tone: toLink.length ? "amber" : "slate",
        value: compact(toLink.reduce((a, m) => a + receiptFree(m), 0)),
        foot: toLink.length ? "A fatura continua em falta até ser ligada" : "Tudo ligado às faturas",
      },
      { key: "projects", label: "Obras com recebimentos", icon: "apartment", tone: "violet", value: String(clients), foot: "No período" }
    );
  } else if (page() === "tesouraria-transferencias") {
    const incoming = rows.filter(isIncoming);
    const pending = state.fundRequests.filter((r) => r.status === "PENDENTE");
    const approved = state.fundRequests.filter((r) => r.status === "APROVADO");
    cards.push(
      { key: "in", label: "Entrou nos cartões", icon: "south_west", tone: "emerald", value: compact(sumOf(incoming)), foot: `${incoming.length} transferência${incoming.length === 1 ? "" : "s"} · ${periodLabel}` },
      { key: "out", label: "Saiu da conta", icon: "north_east", tone: "blue", value: compact(sumOf(rows.filter((m) => !isIncoming(m)))), foot: "Não é custo: dinheiro dentro da empresa" },
      {
        key: "pending",
        label: "Requisições por aprovar",
        icon: "pending_actions",
        tone: pending.length ? "amber" : "slate",
        value: compact(sumOf(pending)),
        foot: `${pending.length} pedido${pending.length === 1 ? "" : "s"} de reforço`,
      },
      { key: "approved", label: "Requisições aprovadas", icon: "task_alt", tone: "violet", value: compact(sumOf(approved)), foot: `${approved.length} nos últimos 180 dias` }
    );
  } else if (page() === "tesouraria-atm") {
    const pending = rows.filter(toAssign);
    const done = rows.filter((m) => m.costAssigned);
    const suppliers = new Set(rows.flatMap((m) => m.costSummary?.suppliers || [])).size;
    cards.push(
      { key: "out", label: "Levantado", icon: "local_atm", tone: "red", value: compact(total), foot: `${rows.length} levantamento${rows.length === 1 ? "" : "s"} · ${periodLabel}` },
      {
        key: "pending",
        label: "Por separar",
        icon: "call_split",
        tone: pending.length ? "amber" : "slate",
        value: compact(sumOf(pending)),
        foot: pending.length ? `${pending.length} sem custos discriminados` : "Tudo separado",
      },
      {
        key: "done",
        label: "Separado em custos",
        icon: "price_check",
        tone: "emerald",
        value: compact(sumOf(done)),
        badge: total > 0 ? `${Math.round((sumOf(done) / total) * 100)}%` : null,
        body: meter([{ value: total > 0 ? (sumOf(done) / total) * 100 : 0, tone: "emerald" }]),
        foot: `${done.reduce((a, m) => a + num(m.costSummary?.count), 0)} custos criados`,
      },
      { key: "suppliers", label: "Fornecedores pagos", icon: "storefront", tone: "violet", value: String(suppliers), foot: "Nos levantamentos separados" }
    );
  } else {
    const pending = rows.filter(toAssign);
    const credit = rows.filter((m) => m.costSummary?.settlement === "CREDITO");
    const prompt = rows.filter((m) => m.costSummary?.settlement === "PRONTO");
    const stock = rows.filter((m) => m.isMerchandise);
    cards.push(
      { key: "out", label: "Pago a fornecedores", icon: "north_east", tone: "red", value: compact(total), foot: `${rows.length} pagamento${rows.length === 1 ? "" : "s"} · ${periodLabel}` },
      {
        key: "split",
        label: "Crédito / pronto pagamento",
        icon: "credit_score",
        tone: "violet",
        value: `${compact(sumOf(credit))} / ${compact(sumOf(prompt))}`,
        body: meter([
          { value: total > 0 ? (sumOf(credit) / total) * 100 : 0, tone: "violet" },
          { value: total > 0 ? (sumOf(prompt) / total) * 100 : 0, tone: "blue" },
        ]),
        foot: `${credit.length} crédito · ${prompt.length} pronto`,
      },
      { key: "stock", label: "Mercadoria (stock)", icon: "inventory_2", tone: "amber", value: compact(sumOf(stock)), foot: "Custo na saída de stock para a obra" },
      {
        key: "pending",
        label: "Por associar",
        icon: "link_off",
        tone: pending.length ? "amber" : "slate",
        value: compact(sumOf(pending)),
        foot: pending.length ? `${pending.length} pagamento${pending.length === 1 ? "" : "s"} sem custo` : "Todos associados",
      }
    );
  }
  document.getElementById("tzKpis").innerHTML = kpiCardsHtml(cards, "tz");
}

function renderViews() {
  const rows = scoped();
  document.getElementById("tzViews").innerHTML = cfg()
    .views.map((v) => {
      const count = v.test ? rows.filter(v.test).length : rows.length;
      return `<button type="button" data-view="${v.key}" class="${v.key === state.view ? "active" : ""}"><span>${esc(v.label)}</span><em>${count}</em></button>`;
    })
    .join("");
  document.querySelectorAll("#tzViews button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      renderViews();
      renderTable();
    })
  );
}

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthKeys(rows) {
  const count = state.period === "30" ? 2 : state.period === "90" ? 4 : 12;
  const now = new Date();
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  if (state.period === "all") {
    rows.forEach((m) => {
      const k = toDateKey(m.movementDate)?.slice(0, 7);
      if (k && !keys.includes(k)) keys.push(k);
    });
    keys.sort();
  }
  return keys;
}

function renderCharts() {
  const rows = scoped();
  const keys = monthKeys(rows);
  const index = new Map(keys.map((k, i) => [k, i]));
  const value = keys.map(() => 0);
  rows.forEach((m) => {
    const i = index.get(toDateKey(m.movementDate)?.slice(0, 7));
    if (i === undefined) return;
    value[i] += num(m.amount);
  });
  const incoming = page() === "tesouraria-recebimentos" || page() === "tesouraria-transferencias";
  drawComboChart("tzChartMonthly", {
    categories: keys.map((k) => {
      const [y, m] = k.split("-").map(Number);
      return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
    }),
    height: 280,
    series: [
      { name: "Valor", type: "column", data: value, color: incoming ? TONES.emerald : TONES.red },
    ],
  });

  if (cfg().fundRequests) return renderFundRequests();

  if (page() === "tesouraria-pagamentos") {
    const groups = [
      { label: "Crédito", value: sumOf(rows.filter((m) => m.costSummary?.settlement === "CREDITO")), color: TONES.violet },
      { label: "Pronto pagamento", value: sumOf(rows.filter((m) => m.costSummary?.settlement === "PRONTO")), color: TONES.blue },
      { label: "Mercadoria (stock)", value: sumOf(rows.filter((m) => m.isMerchandise)), color: TONES.amber },
      { label: "Por associar", value: sumOf(rows.filter(toAssign)), color: TONES.slate },
    ].filter((g) => g.value > 0);
    drawDonutChart("tzChartSplit", {
      labels: groups.map((g) => g.label),
      series: groups.map((g) => g.value),
      colors: groups.map((g) => g.color),
      totalLabel: "Pago",
      height: 280,
    });
    return;
  }

  // ATM: custos separados por fornecedor; recebimentos: valor por obra.
  const map = new Map();
  rows.forEach((m) => {
    if (page() === "tesouraria-atm") {
      (m.costSummary?.items || []).forEach((it) => {
        const k = it.supplier || "Sem fornecedor";
        map.set(k, (map.get(k) || 0) + num(it.amount));
      });
      if (toAssign(m)) map.set("Por separar", (map.get("Por separar") || 0) + num(m.amount));
    } else {
      const k = m.project?.name || "Sem obra";
      map.set(k, (map.get(k) || 0) + num(m.amount));
    }
  });
  const top = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  drawBarChart("tzChartSplit", {
    categories: top.map(([k]) => (k.length > 22 ? `${k.slice(0, 21)}…` : k)),
    horizontal: true,
    height: Math.max(220, top.length * 40 + 70),
    series: [{ name: "Valor", data: top.map(([, v]) => v), color: incoming ? TONES.emerald : TONES.red }],
  });
}

function renderFundRequests() {
  const wrap = document.getElementById("tzFunds");
  const rows = state.fundRequests;
  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty"><span class="material-symbols-outlined">request_page</span>Sem requisições de fundo nos últimos 180 dias.</div>`;
    return;
  }
  const sorted = [...rows].sort((a, b) => (a.status === "PENDENTE" ? -1 : 0) - (b.status === "PENDENTE" ? -1 : 0));
  wrap.innerHTML = `
    <ul class="ac-feed">
      ${sorted
        .slice(0, 6)
        .map((r) => {
          const st = FUND_STATUS[r.status] || { label: r.status, tone: "slate" };
          return `
        <li>
          <span class="ac-feed-icon ${r.status === "PENDENTE" ? "ac-feed-icon--late" : "ac-feed-icon--in"}"><span class="material-symbols-outlined">request_page</span></span>
          <div>
            <strong>${esc(r.fund?.project?.name || r.fund?.name || "Fundo de maneio")}</strong>
            <small>${esc([r.card?.label, dateOnly(r.requestedAt), r.requestedBy].filter(Boolean).join(" · "))}</small>
          </div>
          <div class="ac-feed-value">
            <strong>${esc(money(r.amount, r.fund?.currency))}</strong>
            <span class="finance-chip finance-chip--${st.tone}">${esc(st.label)}</span>
          </div>
        </li>`;
        })
        .join("")}
    </ul>
    ${rows.length > 6 ? `<p class="ov-table-more">+${rows.length - 6} requisições</p>` : ""}`;
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function docText(m) {
  const doc = m.docNumber ? (/^(af|ft|fatura)/i.test(m.docNumber) ? m.docNumber : `${m.docType === "AF" ? "AF" : "Fatura"} ${m.docNumber}`) : m.docType ? (m.docType === "AF" ? "Auto de fatura" : "Fatura") : null;
  return doc || null;
}

function stateCell(m) {
  if (page() === "tesouraria-recebimentos") {
    return receiptStateHtml(m);
  }
  if (page() === "tesouraria-transferencias") {
    return `<span class="finance-chip finance-chip--slate">${isIncoming(m) ? "Entrada no cartão" : "Saída da conta"}</span>`;
  }
  const chips = [];
  const cs = m.costSummary || {};
  if (cs.settlement) chips.push(`<span class="finance-chip finance-chip--${SETTLEMENT[cs.settlement].tone}" title="${esc(SETTLEMENT[cs.settlement].hint)}">${SETTLEMENT[cs.settlement].label}</span>`);
  if (cs.nature && NATURE[cs.nature]) chips.push(`<span class="finance-chip finance-chip--${NATURE[cs.nature].tone}">${NATURE[cs.nature].label}</span>`);
  return `<div class="tz-state">${costStatusHtml(m)}${chips.length ? `<div class="tz-chips">${chips.join("")}</div>` : ""}</div>`;
}

function actionsCell(m) {
  if (!canEdit()) return "";
  const btns = [];
  if (page() === "tesouraria-recebimentos" && !isReceiptLinked(m)) {
    btns.push(`<button type="button" class="cr-act cr-act--emerald" data-action="receipt"><span class="material-symbols-outlined">receipt_long</span><span>Registar na fatura</span></button>`);
  }
  if (toAssign(m)) {
    btns.push(
      page() === "tesouraria-atm"
        ? `<button type="button" class="cr-act cr-act--amber" data-action="assign"><span class="material-symbols-outlined">call_split</span><span>Separar custos</span></button>`
        : `<button type="button" class="cr-act cr-act--amber" data-action="assign"><span class="material-symbols-outlined">link</span><span>Associar custo</span></button>`
    );
  }
  btns.push(`<button type="button" class="fin-icon-btn fin-icon-btn--slate" title="Classificar" data-action="classify"><span class="material-symbols-outlined" style="font-size:17px">edit_note</span></button>`);
  return `<div class="ac-actions">${btns.join("")}</div>`;
}

function partyCell(m) {
  const cs = m.costSummary || {};
  if (page() === "tesouraria-atm" && cs.items?.length) {
    return `
      <div class="ov-project">
        <span class="ov-project-name">${esc(cs.suppliers.length ? cs.suppliers.slice(0, 2).join(", ") : "Sem fornecedor")}${cs.suppliers.length > 2 ? ` +${cs.suppliers.length - 2}` : ""}</span>
        <span class="ov-project-meta">${cs.items.length} custo${cs.items.length === 1 ? "" : "s"} separado${cs.items.length === 1 ? "" : "s"}</span>
      </div>`;
  }
  const name = m.supplier?.name || cs.suppliers?.[0];
  if (page() === "tesouraria-recebimentos" || page() === "tesouraria-transferencias") {
    return `<span>${esc(m.card ? `${m.card.label}${m.card.lastDigits ? ` ••${m.card.lastDigits}` : ""}` : "—")}</span>`;
  }
  return name ? `<span>${esc(name)}</span>` : `<span class="ov-warn">Sem fornecedor</span>`;
}

function renderTable() {
  const wrap = document.getElementById("tzTable");
  const rows = visible();
  const total = sumOf(rows);
  const party = page() === "tesouraria-recebimentos" || page() === "tesouraria-transferencias" ? "Cartão / conta" : "Fornecedor";
  document.getElementById("tzHint").textContent = `${rows.length} ${cfg().noun}${rows.length === 1 ? "" : "s"} · ${compact(total)}`;

  if (!rows.length) {
    wrap.innerHTML = `
      <div class="ov-empty ov-empty--lg">
        <span class="material-symbols-outlined">account_balance</span>
        ${state.items.length ? "Sem movimentos para os filtros." : "Ainda não há movimentos. Importe um extrato em Extratos Bancários e classifique os movimentos."}
        ${state.items.length ? "" : `<a class="ov-link" href="/Financeiro/tesouraria/extratos">Extratos Bancários <span class="material-symbols-outlined">arrow_forward</span></a>`}
      </div>`;
    return;
  }

  const body = rows
    .map((m) => {
      const incoming = isIncoming(m);
      const doc = docText(m);
      return `
      <tr data-id="${esc(m.id)}">
        <td class="tz-date">${esc(dateOnly(m.movementDate))}</td>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(m.description || (page() === "tesouraria-pagamentos" ? "Pagamento" : "Movimento"))}</span>
            <span class="ov-project-meta">${esc([doc, m.statement?.name].filter(Boolean).join(" · ") || "—")}</span>
          </div>
        </td>
        <td>${m.project ? esc(m.project.name) : `<span class="${needsCostAssignment(m) || page() === "tesouraria-recebimentos" ? "ov-warn" : "ov-muted"}">Sem obra</span>`}</td>
        <td>${partyCell(m)}</td>
        ${page() === "tesouraria-pagamentos" ? `<td>${movementChip(m.movementType)}</td>` : ""}
        <td class="fin-num"><strong class="${incoming ? "ov-pos" : "ov-neg"}">${incoming ? "+" : "−"}${esc(money(m.amount))}</strong></td>
        <td>${stateCell(m)}</td>
        <td>${actionsCell(m)}</td>
      </tr>`;
    })
    .join("");

  wrap.innerHTML = `
    <table class="fin-table tz-table">
      <thead><tr>
        <th>Data</th>
        <th>Movimento</th>
        <th>Obra</th>
        <th>${party}</th>
        ${page() === "tesouraria-pagamentos" ? "<th>Tipo</th>" : ""}
        <th style="text-align:right">Valor</th>
        <th>Estado</th>
        <th></th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  wrap.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    const m = state.items.find((x) => x.id === tr.dataset.id);
    if (!m) return;
    tr.querySelector('[data-action="classify"]')?.addEventListener("click", () => openClassifyModal(m, { options: state.options, onSaved: load }));
    tr.querySelector('[data-action="assign"]')?.addEventListener("click", () => openAssignCostModal(m, { options: state.options, onSaved: load }));
    tr.querySelector('[data-action="receipt"]')?.addEventListener("click", () => openReceiptLinkModal(m));
  });
}

function renderAll() {
  renderKpis();
  renderViews();
  renderTable();
  renderCharts();
}

/* ─── Ligar um recebimento à fatura do cliente ────────────────────────────── */

/**
 * Fecha o ciclo do recebimento: escolhe-se a fatura em aberto, regista-se o
 * recebimento (o mesmo endpoint usado no ecrã das faturas, para os valores
 * ficarem iguais em todo o lado) e guarda-se a referência no movimento.
 */
async function openReceiptLinkModal(movement) {
  let receivables = [];
  try {
    const data = await apiRequest("/finance/receivables");
    receivables = (data.items || []).filter((r) => Number(r.missingAmount) > 0);
  } catch (err) {
    toast(err.message || "Falha ao carregar faturas em aberto.", { type: "error" });
    return;
  }
  const candidates = movement.projectId ? receivables.filter((r) => r.projectId === movement.projectId) : receivables;
  const list = candidates.length ? candidates : receivables;
  if (!list.length) {
    toast("Não há faturas em aberto para ligar a este recebimento.", { type: "error" });
    return;
  }

  const amount = receiptFree(movement);
  if (amount <= 0) {
    toast("Este recebimento já está todo ligado a faturas.", { type: "error" });
    return;
  }
  // Sugere a fatura com o valor em falta mais próximo do recebido.
  const defaultInvoice = [...list].sort(
    (a, b) => Math.abs(num(a.missingAmount) - amount) - Math.abs(num(b.missingAmount) - amount)
  )[0];

  openModal({
    title: "Registar recebimento na fatura",
    width: 620,
    contentHtml: `
      <div class="pay-head">
        <div class="pay-head-main">
          <span class="finance-chip finance-chip--emerald">Recebimento</span>
          <strong>${esc(movement.description || "Entrada no banco")}</strong>
          <small>${esc([dateOnly(movement.movementDate), movement.project?.name, movement.card?.label].filter(Boolean).join(" · "))}</small>
        </div>
        <div class="pay-head-amount">
          <span>${amount < num(movement.amount) ? "Falta ligar" : "Entrou"}</span>
          <strong>${esc(money(amount))}</strong>
          ${amount < num(movement.amount) ? `<small>de ${esc(money(movement.amount))}</small>` : ""}
        </div>
      </div>
      <p class="pay-note"><span class="material-symbols-outlined">info</span><span>
        O valor em falta da fatura é reduzido e o recebimento passa a contar na Faturação, no Overview e nas Contas a Receber.
        ${candidates.length ? "" : " <strong>Não há faturas em aberto desta obra</strong> — mostram-se todas."}
      </span></p>
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field" style="grid-column: 1 / -1">
          <label class="finance-label" for="rl_invoice">Fatura em aberto <span class="inv-req">*</span></label>
          <select id="rl_invoice" class="finance-select">
            ${list
              .map(
                (r) =>
                  `<option value="${esc(r.id)}" data-missing="${num(r.missingAmount)}" ${r.id === defaultInvoice.id ? "selected" : ""}>${esc(
                    `${r.docNumber || "sem nº"} · ${r.project?.name || ""} · em falta ${money(r.missingAmount, r.project?.currency)}`
                  )}</option>`
              )
              .join("")}
          </select>
          <small class="pay-hint" id="rl_hint"></small>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rl_amount">Valor recebido <span class="inv-req">*</span></label>
          <input id="rl_amount" class="finance-input" type="number" min="0.01" max="${amount}" step="0.01" value="${Math.min(amount, num(defaultInvoice.missingAmount))}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rl_date">Data do recebimento</label>
          <input id="rl_date" class="finance-input" type="date" value="${esc(toDateKey(movement.movementDate) || "")}" />
        </div>
        <div class="finance-field" style="grid-column: 1 / -1">
          <label class="finance-label" for="rl_notes">Notas</label>
          <input id="rl_notes" class="finance-input" type="text" value="${esc(movement.description || "")}" />
        </div>
      </div>`,
    primaryLabel: "Registar recebimento",
    onRender: ({ panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const refresh = () => {
        const missing = Number($("rl_invoice").selectedOptions[0]?.dataset.missing || 0);
        const value = Number($("rl_amount").value) || 0;
        const rest = missing - value;
        const bad = rest < -0.005 || value > amount + 0.005;
        $("rl_hint").textContent =
          value > amount + 0.005
            ? `Só há ${money(amount)} deste movimento por ligar.`
            : rest < -0.005
              ? `A fatura só tem ${money(missing)} em falta: o resto (${money(-rest)}) liga-se a outra fatura.`
              : `Em falta ${money(missing)} → ficam ${money(Math.max(rest, 0))} por receber${amount - value > 0.005 ? ` · sobram ${money(amount - value)} do movimento para outra fatura` : ""}.`;
        $("rl_hint").classList.toggle("ov-neg", bad);
      };
      $("rl_invoice").addEventListener("change", () => {
        const missing = Number($("rl_invoice").selectedOptions[0]?.dataset.missing || 0);
        $("rl_amount").value = String(Math.min(amount, missing));
        refresh();
      });
      $("rl_amount").addEventListener("input", refresh);
      refresh();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const invoiceId = $("rl_invoice").value;
      const value = Number($("rl_amount").value);
      if (!value || value <= 0) return toast("Indique o valor recebido.", { type: "error" });
      if (value > amount + 0.005) return toast(`Só há ${money(amount)} deste movimento por ligar.`, { type: "error" });
      const missing = Number($("rl_invoice").selectedOptions[0]?.dataset.missing || 0);
      if (value > missing + 0.005) return toast(`A fatura só tem ${money(missing)} em falta.`, { type: "error" });
      if (!$("rl_date").value) return toast("Indique a data do recebimento.", { type: "error" });
      const notes = $("rl_notes").value.trim();

      setButtonLoading(btn, true);
      try {
        await apiRequest(`/finance/invoices/${invoiceId}/receipts`, {
          method: "POST",
          body: {
            amount: value,
            receivedDate: $("rl_date").value,
            method: "Transferência bancária",
            notes: notes || null,
            bankMovementId: movement.id,
          },
        });
        toast(value < amount - 0.005 ? `Ligado. Ainda faltam ${money(amount - value)} deste movimento.` : "Recebimento registado e ligado à fatura.", { type: "success" });
        close();
        await load();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Falha ao registar o recebimento.", { type: "error" });
      }
    },
  });
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  const c = cfg();
  try {
    const params = new URLSearchParams(c.query);
    const [movements, funds] = await Promise.all([
      apiRequest(`/finance/bank-movements?${params.toString()}`),
      c.fundRequests ? apiRequest("/finance/treasury/fund-requests") : Promise.resolve({ items: [] }),
    ]);
    state.items = movements.items || [];
    state.fundRequests = funds.items || [];
    renderAll();
  } catch (err) {
    const wrap = document.getElementById("tzTable");
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar movimentos.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  Object.assign(state, { items: [], fundRequests: [], period: "365", view: "all", projectId: "", query: "" });
  try {
    state.options = await loadMovementOptions();
  } catch (err) {
    toast(err.message || "Falha ao carregar opções.", { type: "error" });
    state.options = { projects: [], suppliers: [], categories: [], cards: [] };
  }
  renderShell();
  await load();
}
