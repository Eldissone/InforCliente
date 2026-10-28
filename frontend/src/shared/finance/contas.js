import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, drawBarChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";
import { AGING_TONES, agingBuckets, agingSeries, daysLate, overdueTotal } from "./aging.js";

/**
 * Ecrã «Contas a Pagar / Receber».
 *
 * O gestor financeiro vê o que tem a receber dos clientes e o que tem a pagar a
 * fornecedores, com a antiguidade de cada lado (para saber o que já está em
 * atraso) e um confronto por obra, que mostra onde a obra está a financiar a
 * operação e onde está a ser financiada.
 *
 * A pagar  = tudo o que está comprometido e ainda não saiu do caixa
 *            (pagamentos pendentes, pedidos extra aprovados, pedidos de compra
 *            abertos e fretes por enviar ao financeiro).
 * A receber = faturas emitidas ao cliente com valor líquido ainda em falta.
 */

const INVOICE_STATUS = {
  EM_ABERTO: { label: "Em Aberto", badge: "slate" },
  PAGO_PARCIAL: { label: "Pago Parcial", badge: "amber" },
  PAGO_TOTAL: { label: "Pago Total", badge: "emerald" },
  ATRASADO: { label: "Atrasado", badge: "red" },
};

const COST_STATUS = {
  PENDENTE: { label: "Pendente", badge: "amber" },
  EM_ESPERA: { label: "Em Espera", badge: "slate" },
  CONFIRMADO: { label: "Confirmado", badge: "emerald" },
  CANCELADO: { label: "Cancelado", badge: "red" },
  // Pedido Extra
  APROVADO: { label: "Aprovado", badge: "blue" },
  PAGO: { label: "Pago", badge: "emerald" },
  // Pedido de Compra
  RASCUNHO: { label: "Rascunho", badge: "slate" },
  PENDENTE_REQUISICAO: { label: "Pend. requisição", badge: "amber" },
  PENDENTE_APROVACAO: { label: "Pend. aprovação", badge: "amber" },
  NAO_APROVADO: { label: "Não aprovado", badge: "red" },
  EM_PAGAMENTO: { label: "Em pagamento", badge: "blue" },
  CONCLUIDO: { label: "Concluído", badge: "emerald" },
  // Frete
  EM_ANALISE: { label: "Em análise", badge: "amber" },
  APPROVED: { label: "Aprovado", badge: "blue" },
};

const state = { tab: "pagar", payables: null, receivables: null };

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function lateCell(value) {
  const days = daysLate(value);
  if (days === null) return `<span class="fin-empty-cell">—</span>`;
  if (days > 0) return `<span class="finance-badge finance-badge--red">${days} d</span>`;
  return `<span class="finance-badge finance-badge--slate">${Math.abs(days)} d</span>`;
}

function badge(map, status) {
  const s = map[status] || { label: status || "—", badge: "slate" };
  return `<span class="finance-badge finance-badge--${s.badge}">${esc(s.label)}</span>`;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="contasKpis" class="finance-kpi-grid"></div>

    <div class="finance-chart-grid">
      ${chartCardHtml({
        id: "ctChartReceivables",
        title: "A receber por antiguidade",
        subtitle: "Faturas em aberto pela data de vencimento",
        hint: "Quanto mais à direita, mais tempo o cliente está em atraso.",
        height: 290,
      })}
      ${chartCardHtml({
        id: "ctChartPayables",
        title: "A pagar por antiguidade",
        subtitle: "Valor por liquidar pela data do custo",
        hint: "Identifica o que já devia ter saído do caixa.",
        height: 290,
      })}
      ${chartCardHtml({
        id: "ctChartProjects",
        title: "A receber vs a pagar por obra",
        subtitle: "As 8 obras com maior exposição",
        hint: "Saldo negativo significa que já pagámos mais do que recebemos nessa obra.",
        span: 2,
        height: 320,
      })}
    </div>

    <section class="finance-card">
      <div class="fin-toolbar" style="margin-bottom:1rem">
        <div class="finance-seg" id="contasSeg">
          <button type="button" data-tab="pagar" class="active">
            <span class="material-symbols-outlined">north_east</span>A Pagar
          </button>
          <button type="button" data-tab="receber">
            <span class="material-symbols-outlined">south_west</span>A Receber
          </button>
          <button type="button" data-tab="confronto">
            <span class="material-symbols-outlined">balance</span>Por Obra
          </button>
        </div>
      </div>
      <div id="contasTable" class="finance-table-scroll"></div>
    </section>`;

  document.querySelectorAll("#contasSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      document.querySelectorAll("#contasSeg button").forEach((b) => b.classList.toggle("active", b === btn));
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
  const balance = totalReceive - totalPay;

  const payAging = agingBuckets(payables, { amountKey: "remaining", dateKey: "date" });
  const recAging = agingBuckets(receivables, { amountKey: "missingAmount", dateKey: "dueDate" });
  const overduePay = overdueTotal(payAging);
  const overdueRec = overdueTotal(recAging);

  const cards = [
    {
      label: "Contas a Pagar",
      value: money(totalPay),
      sub: `${payables.length} registos · ${money(overduePay)} vencidos`,
      tone: overduePay > 0 ? "red" : "amber",
      icon: "north_east",
    },
    {
      label: "Contas a Receber",
      value: money(totalReceive),
      sub: `${receivables.length} faturas · ${money(overdueRec)} vencidas`,
      tone: overdueRec > 0 ? "red" : "emerald",
      icon: "south_west",
    },
    {
      label: "Saldo",
      value: money(balance),
      sub: balance >= 0 ? "A receber > a pagar" : "A pagar > a receber",
      tone: balance >= 0 ? "blue" : "red",
      icon: "balance",
    },
    {
      label: "Exposição vencida",
      value: money(overduePay + overdueRec),
      sub: `${money(overdueRec)} de clientes · ${money(overduePay)} a fornecedores`,
      tone: overduePay + overdueRec > 0 ? "red" : "emerald",
      icon: "warning",
    },
  ];

  document.getElementById("contasKpis").innerHTML = cards
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
  const receivables = state.receivables?.items || [];

  const recAging = agingSeries(agingBuckets(receivables, { amountKey: "missingAmount", dateKey: "dueDate" }));
  const payAging = agingSeries(agingBuckets(payables, { amountKey: "remaining", dateKey: "date" }));

  drawDonutChart("ctChartReceivables", {
    labels: recAging.map((a) => a.label),
    series: recAging.map((a) => a.value),
    colors: AGING_TONES,
    totalLabel: "A receber",
  });

  drawDonutChart("ctChartPayables", {
    labels: payAging.map((a) => a.label),
    series: payAging.map((a) => a.value),
    colors: AGING_TONES,
    totalLabel: "A pagar",
  });

  const byProject = projectComparison().slice(0, 8);
  drawBarChart("ctChartProjects", {
    categories: byProject.map((p) => p.name),
    series: [
      { name: "A receber", data: byProject.map((p) => p.receive), color: TONES.emerald },
      { name: "A pagar", data: byProject.map((p) => p.pay), color: TONES.red },
      { name: "Saldo", data: byProject.map((p) => p.balance), color: TONES.blue },
    ],
    height: 320,
  });
}

/* ─── Confronto por obra ──────────────────────────────────────────────────── */

function projectComparison() {
  const map = new Map();
  const ensure = (project) => {
    const key = project?.id || "__sem_obra__";
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        name: project?.name || "Sem obra",
        code: project?.code || "",
        receive: 0,
        pay: 0,
        balance: 0,
        receiveCount: 0,
        payCount: 0,
      });
    }
    return map.get(key);
  };

  (state.receivables?.items || []).forEach((r) => {
    const bucket = ensure(r.project);
    const value = Number(r.missingAmount) || 0;
    if (value <= 0) return;
    bucket.receive += value;
    bucket.receiveCount += 1;
  });

  (state.payables?.items || []).forEach((p) => {
    const bucket = ensure(p.project);
    const value = Number(p.remaining) || 0;
    if (value <= 0) return;
    bucket.pay += value;
    bucket.payCount += 1;
  });

  return [...map.values()]
    .map((b) => ({ ...b, balance: b.receive - b.pay }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

function renderConfronto(wrap) {
  const rows = projectComparison();
  if (!rows.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">balance</span>Sem valores em aberto por obra.</div>`;
    return;
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.receive += r.receive;
      acc.pay += r.pay;
      acc.balance += r.balance;
      return acc;
    },
    { receive: 0, pay: 0, balance: 0 }
  );

  const body = rows
    .map(
      (r) => `
      <tr>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(r.name)}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(r.code)}</div>
        </td>
        <td class="fin-num finance-pos">${esc(money(r.receive))}</td>
        <td class="fin-num">${esc(String(r.receiveCount))}</td>
        <td class="fin-num finance-neg">${esc(money(r.pay))}</td>
        <td class="fin-num">${esc(String(r.payCount))}</td>
        <td class="fin-num ${r.balance >= 0 ? "finance-pos" : "finance-neg"}" style="font-weight:800">${esc(money(r.balance))}</td>
      </tr>`
    )
    .join("");

  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1000px">
      <thead><tr>
        <th>Obra</th>
        <th style="text-align:right">A Receber</th>
        <th style="text-align:right">Faturas</th>
        <th style="text-align:right">A Pagar</th>
        <th style="text-align:right">Registos</th>
        <th style="text-align:right">Saldo</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais (${rows.length} obras)</td>
        <td class="fin-num">${esc(money(totals.receive))}</td>
        <td></td>
        <td class="fin-num">${esc(money(totals.pay))}</td>
        <td></td>
        <td class="fin-num ${totals.balance >= 0 ? "finance-pos" : "finance-neg"}">${esc(money(totals.balance))}</td>
      </tr></tfoot>
    </table>`;
}

/* ─── Tabelas ─────────────────────────────────────────────────────────────── */

function renderTable() {
  const wrap = document.getElementById("contasTable");
  if (!wrap) return;
  if (state.tab === "pagar") return renderPayables(wrap);
  if (state.tab === "receber") return renderReceivables(wrap);
  return renderConfronto(wrap);
}

function renderPayables(wrap) {
  const items = state.payables?.items || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">payments</span>Sem contas a pagar pendentes.</div>`;
    return;
  }
  const body = items
    .map((p) => {
      const cur = p.currency || p.project?.currency || "AOA";
      return `
      <tr>
        <td>${esc(dateOnly(p.date))}</td>
        <td>${lateCell(p.date)}</td>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(p.project?.name || "—")}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(p.project?.code || "")}</div>
        </td>
        <td>${esc(p.sourceLabel || p.source || "—")}</td>
        <td>${esc(p.costCenter?.name || "—")}</td>
        <td>${esc(p.supplierRef?.name || p.supplier || "—")}</td>
        <td style="max-width:280px">${esc(p.description || "—")}</td>
        <td class="fin-num">${esc(money(p.amount, cur))}</td>
        <td class="fin-num">${esc(money(p.paidAmount, cur))}</td>
        <td class="fin-num" style="font-weight:800">${esc(money(p.remaining, cur))}</td>
        <td>${badge(COST_STATUS, p.status)}</td>
      </tr>`;
    })
    .join("");

  const total = items.reduce((a, p) => a + (Number(p.remaining) || 0), 0);
  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1450px">
      <thead><tr>
        <th>Data</th><th>Atraso</th><th>Obra</th><th>Fonte</th><th>Centro de Custo</th><th>Fornecedor</th>
        <th>Descrição</th><th style="text-align:right">Valor</th><th style="text-align:right">Já Pago</th>
        <th style="text-align:right">Por Pagar</th><th>Estado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="9">Total a pagar (${items.length})</td>
        <td class="fin-num">${esc(money(total))}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

function renderReceivables(wrap) {
  const items = state.receivables?.items || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">request_quote</span>Sem contas a receber em aberto.</div>`;
    return;
  }
  const body = items
    .map((r) => {
      const cur = r.project?.currency || "AOA";
      return `
      <tr class="${r.status === "ATRASADO" ? "fin-row--overdue" : ""}">
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(r.project?.name || "—")}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(r.project?.code || "")}</div>
        </td>
        <td>${esc(r.client?.name || "—")}</td>
        <td>${esc(r.docNumber || "—")}</td>
        <td>${esc(dateOnly(r.docDate))}</td>
        <td>${esc(dateOnly(r.dueDate))}</td>
        <td>${lateCell(r.dueDate)}</td>
        <td class="fin-num">${esc(money(r.netAmount, cur))}</td>
        <td class="fin-num finance-pos">${esc(money(r.receivedAmount, cur))}</td>
        <td class="fin-num ${Number(r.missingAmount) > 0 ? "finance-neg" : "finance-pos"}">${esc(money(r.missingAmount, cur))}</td>
        <td>${badge(INVOICE_STATUS, r.status)}</td>
      </tr>`;
    })
    .join("");

  const total = items.reduce((a, r) => a + (Number(r.missingAmount) || 0), 0);
  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1250px">
      <thead><tr>
        <th>Obra</th><th>Cliente</th><th>Nº Doc</th><th>Data Doc</th><th>Vencimento</th><th>Atraso</th>
        <th style="text-align:right">V. Líquido</th><th style="text-align:right">Recebido</th>
        <th style="text-align:right">Em Falta</th><th>Estado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="8">Total a receber (${items.length})</td>
        <td class="fin-num">${esc(money(total))}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  const wrap = document.getElementById("contasTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar contas…</div>`;
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
    toast(err.message || "Falha ao carregar contas.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  state.tab = "pagar";
  renderShell();
  await load();
}
