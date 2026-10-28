import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, drawBarChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";
import { AGING_TONES, agingBuckets, agingSeries, daysLate, overdueTotal } from "./aging.js";

/**
 * Ecrã «Centro de Pagamentos».
 *
 * É a fila de trabalho do financeiro: o que está comprometido e por pagar,
 * ordenado pelo que vence primeiro (com o que já está vencido em destaque), e
 * as ligações aos módulos onde o pagamento é efetivamente executado.
 *
 * A pagar = tudo o que está comprometido e ainda não saiu do caixa
 * (pagamentos pendentes, pedidos extra aprovados, pedidos de compra abertos e
 * fretes por enviar ao financeiro).
 */

const LINKS = [
  { label: "Centro de Compras", href: "/Financeiro/centrodecompras", icon: "shopping_cart", desc: "Pedidos, proformas e liquidações" },
  { label: "Centros Gerais", href: "/Financeiro/centrosGerais", icon: "account_balance", desc: "Custos não afetos a obra" },
  { label: "Novo Pedido", href: "/Financeiro/novoPedido", icon: "playlist_add", desc: "Registar um novo pedido de compra" },
  { label: "Registar Custo", href: "/Financeiro/custos/registar", icon: "add_card", desc: "Lançar um custo direto no financeiro" },
];

const COST_STATUS_LABEL = {
  PENDENTE: "Pendente",
  EM_ESPERA: "Em espera",
  APROVADO: "Aprovado",
  EM_PAGAMENTO: "Em pagamento",
  RASCUNHO: "Rascunho",
  PENDENTE_REQUISICAO: "Pend. requisição",
  PENDENTE_APROVACAO: "Pend. aprovação",
  EM_ANALISE: "Em análise",
};

const state = { tab: "prioridade", payables: null, receivables: null };

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function dueCell(value) {
  const days = daysLate(value);
  if (days === null) return `<span class="finance-badge finance-badge--slate">Sem data</span>`;
  if (days > 0) return `<span class="finance-badge finance-badge--red">Vencido há ${days} d</span>`;
  if (days === 0) return `<span class="finance-badge finance-badge--amber">Vence hoje</span>`;
  return `<span class="finance-badge finance-badge--slate">Faltam ${Math.abs(days)} d</span>`;
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="cpKpis" class="finance-kpi-grid"></div>

    <div class="finance-chart-grid">
      ${chartCardHtml({
        id: "cpChartAging",
        title: "A pagar por antiguidade",
        subtitle: "Valor por liquidar pela data do custo",
        hint: "O que está nos escalões da direita já devia ter saído do caixa.",
        height: 300,
      })}
      ${chartCardHtml({
        id: "cpChartProjects",
        title: "Quem espera por pagamento",
        subtitle: "As 8 obras com mais valor por liquidar",
        hint: "Vencido vs ainda dentro do prazo, por obra.",
        height: 300,
      })}
      ${chartCardHtml({
        id: "cpChartSources",
        title: "A pagar por fonte",
        subtitle: "De que área vem cada compromisso",
        span: 2,
        height: 300,
      })}
    </div>

    <section class="finance-card" style="margin-bottom:1.5rem">
      <div class="finance-chart-head">
        <h2 class="finance-chart-title">Executar o pagamento</h2>
        <p class="finance-chart-subtitle">
          O Centro de Pagamentos mostra a fila; o pagamento executa-se no módulo de origem.
        </p>
      </div>
      <div id="cpLinks" style="display:flex;flex-wrap:wrap;gap:0.75rem"></div>
    </section>

    <section class="finance-card">
      <div class="fin-toolbar" style="margin-bottom:1rem">
        <div class="finance-seg" id="cpSeg">
          <button type="button" data-tab="prioridade" class="active">
            <span class="material-symbols-outlined">flag</span>Por prioridade
          </button>
          <button type="button" data-tab="fornecedor">
            <span class="material-symbols-outlined">store</span>Por fornecedor
          </button>
          <button type="button" data-tab="obra">
            <span class="material-symbols-outlined">apartment</span>Por obra
          </button>
        </div>
      </div>
      <p class="finance-hint" id="cpHint"></p>
      <div id="cpTable" class="finance-table-scroll"></div>
    </section>`;

  document.getElementById("cpLinks").innerHTML = LINKS.map(
    (l) => `
    <a class="finance-btn finance-btn--ghost" href="${esc(l.href)}" title="${esc(l.desc)}">
      <span class="material-symbols-outlined">${l.icon}</span>${esc(l.label)}
    </a>`
  ).join("");

  document.querySelectorAll("#cpSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      document.querySelectorAll("#cpSeg button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis() {
  const payables = state.payables?.items || [];
  const receivables = state.receivables?.items || [];
  const totalPay = payables.reduce((a, p) => a + (Number(p.remaining) || 0), 0);
  const totalReceive = receivables.reduce((a, r) => a + (Number(r.missingAmount) || 0), 0);

  const payAging = agingBuckets(payables, { amountKey: "remaining", dateKey: "date" });
  const overdue = overdueTotal(payAging);
  const next30 = payAging.d0_30 + payAging.a_vencer;

  const cards = [
    {
      label: "A Pagar",
      value: money(totalPay),
      sub: `${payables.length} compromissos por liquidar`,
      tone: "amber",
      icon: "pending_actions",
    },
    {
      label: "Já Vencido",
      value: money(overdue),
      sub: overdue > 0 ? "Precisa de pagamento imediato" : "Nada em atraso",
      tone: overdue > 0 ? "red" : "emerald",
      icon: "warning",
    },
    {
      label: "A Vencer",
      value: money(next30),
      sub: "A vencer nos próximos 30 dias",
      tone: "blue",
      icon: "event",
    },
    {
      label: "A Receber",
      value: money(totalReceive),
      sub: `${receivables.length} faturas em aberto`,
      tone: "emerald",
      icon: "south_west",
    },
    {
      label: "Saldo Previsto",
      value: money(totalReceive - totalPay),
      sub: totalReceive - totalPay >= 0 ? "A receber > a pagar" : "A pagar > a receber",
      tone: totalReceive - totalPay >= 0 ? "blue" : "red",
      icon: "balance",
    },
  ];

  document.getElementById("cpKpis").innerHTML = cards
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

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

function renderCharts() {
  const payables = state.payables?.items || [];
  const aging = agingSeries(agingBuckets(payables, { amountKey: "remaining", dateKey: "date" }));
  drawDonutChart("cpChartAging", {
    labels: aging.map((a) => a.label),
    series: aging.map((a) => a.value),
    colors: AGING_TONES,
    totalLabel: "A pagar",
    height: 300,
  });

  const byProject = new Map();
  payables.forEach((p) => {
    const name = p.project?.name || "Sem obra";
    if (!byProject.has(name)) byProject.set(name, { overdue: 0, onTime: 0 });
    const bucket = byProject.get(name);
    const value = Number(p.remaining) || 0;
    const days = daysLate(p.date);
    if (days !== null && days > 0) bucket.overdue += value;
    else bucket.onTime += value;
  });
  const groups = [...byProject.entries()]
    .map(([name, v]) => ({ name, ...v, total: v.overdue + v.onTime }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  drawBarChart("cpChartProjects", {
    categories: groups.map((g) => g.name),
    series: [
      { name: "Vencido", data: groups.map((g) => g.overdue), color: TONES.red },
      { name: "Dentro do prazo", data: groups.map((g) => g.onTime), color: TONES.slate },
    ],
    height: 300,
  });

  const bySource = new Map();
  payables.forEach((p) => {
    const label = p.sourceLabel || p.source || "Outro";
    bySource.set(label, (bySource.get(label) || 0) + (Number(p.remaining) || 0));
  });
  const sources = [...bySource.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  drawDonutChart("cpChartSources", {
    labels: sources.map(([label]) => label),
    series: sources.map(([, value]) => value),
    totalLabel: "A pagar",
    height: 300,
  });
}

/* ─── Tabelas ─────────────────────────────────────────────────────────────── */

/** Ordena pelo que vence primeiro, com os vencidos à cabeça. */
function byPriority(items) {
  return [...items].sort((a, b) => {
    const da = daysLate(a.date);
    const db = daysLate(b.date);
    const keyA = da === null ? -Infinity : da;
    const keyB = db === null ? -Infinity : db;
    return keyB - keyA;
  });
}

function renderTable() {
  const wrap = document.getElementById("cpTable");
  const hint = document.getElementById("cpHint");
  const items = state.payables?.items || [];

  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">task_alt</span>Sem pagamentos por liquidar.</div>`;
    hint.textContent = "";
    return;
  }

  if (state.tab === "prioridade") {
    hint.textContent =
      "Ordenado pelo que vence primeiro. Os vencidos aparecem no topo — é por aqui que o pagamento deve começar.";
    return renderPriority(wrap, byPriority(items));
  }
  if (state.tab === "fornecedor") {
    hint.textContent = "Agrupado por fornecedor, para negociar ou preparar lotes de pagamento.";
    return renderGrouped(wrap, items, (p) => p.supplierRef?.name || p.supplier || "Sem fornecedor", "Fornecedor");
  }
  hint.textContent = "Agrupado por obra, para ver quanto cada obra deve e o que já está vencido.";
  return renderGrouped(wrap, items, (p) => p.project?.name || "Sem obra", "Obra");
}

function renderPriority(wrap, items) {
  const body = items
    .slice(0, 60)
    .map((p) => {
      const cur = p.currency || p.project?.currency || "AOA";
      const overdue = (daysLate(p.date) || 0) > 0;
      return `
      <tr class="${overdue ? "fin-row--overdue" : ""}">
        <td>${esc(dateOnly(p.date))}</td>
        <td>${dueCell(p.date)}</td>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(p.supplierRef?.name || p.supplier || "—")}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(p.sourceLabel || p.source || "")}</div>
        </td>
        <td>${esc(p.project?.name || "—")}</td>
        <td>${esc(p.costCenter?.name || "—")}</td>
        <td style="max-width:260px">${esc(p.description || "—")}</td>
        <td class="fin-num">${esc(money(p.amount, cur))}</td>
        <td class="fin-num">${esc(money(p.paidAmount, cur))}</td>
        <td class="fin-num" style="font-weight:800">${esc(money(p.remaining, cur))}</td>
        <td><span class="finance-badge finance-badge--slate">${esc(COST_STATUS_LABEL[p.status] || p.status || "—")}</span></td>
      </tr>`;
    })
    .join("");

  const total = items.slice(0, 60).reduce((a, p) => a + (Number(p.remaining) || 0), 0);
  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1400px">
      <thead><tr>
        <th>Data</th><th>Vencimento</th><th>Fornecedor / Fonte</th><th>Obra</th><th>Centro de Custo</th>
        <th>Descrição</th><th style="text-align:right">Valor</th><th style="text-align:right">Já Pago</th>
        <th style="text-align:right">Por Pagar</th><th>Estado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="8">Total por liquidar (${Math.min(items.length, 60)} de ${items.length})</td>
        <td class="fin-num">${esc(money(total))}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

function renderGrouped(wrap, items, keyFn, label) {
  const groups = new Map();
  items.forEach((p) => {
    const key = keyFn(p);
    if (!groups.has(key)) groups.set(key, { count: 0, remaining: 0, overdue: 0 });
    const bucket = groups.get(key);
    const value = Number(p.remaining) || 0;
    const days = daysLate(p.date);
    bucket.count += 1;
    bucket.remaining += value;
    if (days !== null && days > 0) bucket.overdue += value;
  });

  const rows = [...groups.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.remaining - a.remaining);

  const body = rows
    .map(
      (r) => `
      <tr>
        <td style="font-weight:700;color:#0f172a">${esc(r.label)}</td>
        <td class="fin-num">${esc(String(r.count))}</td>
        <td class="fin-num" style="font-weight:800">${esc(money(r.remaining))}</td>
        <td class="fin-num ${r.overdue > 0 ? "finance-neg" : "finance-muted"}">${esc(money(r.overdue))}</td>
        <td class="fin-num">${esc(money(r.remaining - r.overdue))}</td>
      </tr>`
    )
    .join("");

  const totals = rows.reduce(
    (acc, r) => {
      acc.count += r.count;
      acc.remaining += r.remaining;
      acc.overdue += r.overdue;
      return acc;
    },
    { count: 0, remaining: 0, overdue: 0 }
  );

  wrap.innerHTML = `
    <table class="fin-table" style="min-width:900px">
      <thead><tr>
        <th>${esc(label)}</th>
        <th style="text-align:right">Registos</th>
        <th style="text-align:right">Por Pagar</th>
        <th style="text-align:right">Vencido</th>
        <th style="text-align:right">Dentro do Prazo</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais (${rows.length})</td>
        <td class="fin-num">${esc(String(totals.count))}</td>
        <td class="fin-num">${esc(money(totals.remaining))}</td>
        <td class="fin-num finance-neg">${esc(money(totals.overdue))}</td>
        <td class="fin-num">${esc(money(totals.remaining - totals.overdue))}</td>
      </tr></tfoot>
    </table>`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  const wrap = document.getElementById("cpTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar pagamentos…</div>`;
  try {
    const [payables, receivables] = await Promise.all([
      apiRequest("/finance/payables"),
      apiRequest("/finance/receivables"),
    ]);
    state.payables = payables;
    state.receivables = receivables;
    renderKpis();
    renderTable();
    renderCharts();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o Centro de Pagamentos.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  state.tab = "prioridade";
  renderShell();
  await load();
}
