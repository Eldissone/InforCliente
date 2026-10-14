import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Contas a Pagar / Receber» (Financeiro).
 * Confronto entre contas a pagar (custos pendentes) e a receber (faturas).
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

function badge(map, status) {
  const s = map[status] || { label: status || "—", badge: "slate" };
  return `<span class="finance-badge finance-badge--${s.badge}">${esc(s.label)}</span>`;
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="contasKpis" class="finance-kpi-grid"></div>
    <section class="finance-card">
      <div class="fin-toolbar" style="margin-bottom:1rem">
        <div class="finance-seg" id="contasSeg">
          <button type="button" data-tab="pagar" class="active">
            <span class="material-symbols-outlined">north_east</span>A Pagar
          </button>
          <button type="button" data-tab="receber">
            <span class="material-symbols-outlined">south_west</span>A Receber
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

function renderKpis() {
  const payables = state.payables?.items || [];
  const receivables = state.receivables?.items || [];
  const totalPay = payables.reduce((a, p) => a + (Number(p.remaining) || 0), 0);
  const totalReceive = receivables.reduce((a, r) => a + (Number(r.missingAmount) || 0), 0);
  const balance = totalReceive - totalPay;
  const cards = [
    { label: "Contas a Pagar", value: money(totalPay), sub: `${payables.length} registos pendentes`, tone: "amber", icon: "north_east" },
    { label: "Contas a Receber", value: money(totalReceive), sub: `${receivables.length} faturas em aberto`, tone: "emerald", icon: "south_west" },
    {
      label: "Saldo",
      value: money(balance),
      sub: balance >= 0 ? "A receber > a pagar" : "A pagar > a receber",
      tone: balance >= 0 ? "blue" : "red",
      icon: "balance",
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

function renderTable() {
  const wrap = document.getElementById("contasTable");
  if (state.tab === "pagar") return renderPayables(wrap);
  return renderReceivables(wrap);
}

function renderPayables(wrap) {
  const items = state.payables?.items || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">payments</span>Sem contas a pagar pendentes.</div>`;
    return;
  }
  // Inclui pagamentos pendentes, pedidos extra aprovados e pedidos de compra abertos.
  const body = items
    .map((p) => {
      const cur = p.currency || p.project?.currency || "AOA";
      return `
      <tr>
        <td>${esc(dateOnly(p.date))}</td>
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
    <table class="fin-table" style="min-width:1300px">
      <thead><tr>
        <th>Data</th><th>Obra</th><th>Fonte</th><th>Centro de Custo</th><th>Fornecedor</th><th>Descrição</th>
        <th style="text-align:right">Valor</th><th style="text-align:right">Já Pago</th>
        <th style="text-align:right">Por Pagar</th><th>Estado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="8">Total a pagar (${items.length})</td>
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
        <td>${esc(dateOnly(r.dueDate))}</td>
        <td class="fin-num">${esc(money(r.netAmount, cur))}</td>
        <td class="fin-num finance-pos">${esc(money(r.receivedAmount, cur))}</td>
        <td class="fin-num ${Number(r.missingAmount) > 0 ? "finance-neg" : "finance-pos"}">${esc(money(r.missingAmount, cur))}</td>
        <td>${badge(INVOICE_STATUS, r.status)}</td>
      </tr>`;
    })
    .join("");
  const total = items.reduce((a, r) => a + (Number(r.missingAmount) || 0), 0);
  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1100px">
      <thead><tr>
        <th>Obra</th><th>Cliente</th><th>Nº Doc</th><th>Vencimento</th>
        <th style="text-align:right">V. Líquido</th><th style="text-align:right">Recebido</th>
        <th style="text-align:right">Em Falta</th><th>Estado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="6">Total a receber (${items.length})</td>
        <td class="fin-num">${esc(money(total))}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

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
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar contas.", { type: "error" });
  }
}

export async function render() {
  renderShell();
  await load();
}
