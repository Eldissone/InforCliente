import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Centro de Pagamentos» (Financeiro).
 * Resume as contas a pagar/receber e liga às funções de pagamento já
 * existentes (Centro de Compras, Pedidos Extra, Cartões e centros gerais).
 */

const LINKS = [
  { label: "Centro de Compras", href: "/Financeiro/centrodecompras", icon: "shopping_cart", desc: "Pedidos, proformas e liquidações" },
  { label: "Centros Gerais", href: "/Financeiro/centrosGerais", icon: "account_balance", desc: "Custos não afetos a obra" },
  { label: "Novo Pedido", href: "/Financeiro/novoPedido", icon: "playlist_add", desc: "Registar um novo pedido de compra" },
];

function money(value) {
  return formatCurrency(Number(value) || 0, "AOA");
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="cpKpis" class="finance-kpi-grid"></div>

    <section class="finance-card" style="margin-bottom:1.5rem">
      <h2 style="font-size:1rem;font-weight:800;color:#0f172a;margin:0 0 0.25rem">Ligações às funções existentes</h2>
      <p class="finance-hint">O Centro de Pagamentos centraliza os pedidos pendentes e liga ao módulo financeiro já existente.</p>
      <div id="cpLinks" style="display:flex;flex-wrap:wrap;gap:0.75rem"></div>
    </section>

    <section class="finance-card">
      <h2 style="font-size:1rem;font-weight:800;color:#0f172a;margin:0 0 0.25rem">Pagamentos pendentes</h2>
      <p class="finance-hint">Valores previstos de custos com estado Pendente ou Em Espera.</p>
      <div id="cpTable" class="finance-table-scroll"></div>
    </section>`;

  document.getElementById("cpLinks").innerHTML = LINKS.map(
    (l) => `
    <a class="finance-btn finance-btn--ghost" href="${esc(l.href)}" title="${esc(l.desc)}">
      <span class="material-symbols-outlined">${l.icon}</span>${esc(l.label)}
    </a>`
  ).join("");
}

function renderKpis(payables, receivables) {
  const totalPay = payables.reduce((a, p) => a + (Number(p.budgetedAmount) || 0), 0);
  const totalReceive = receivables.reduce((a, r) => a + (Number(r.missingAmount) || 0), 0);
  const balance = totalReceive - totalPay;
  const cards = [
    { label: "Pagamentos Pendentes", value: String(payables.length), sub: money(totalPay), tone: "amber", icon: "pending_actions" },
    { label: "Contas a Receber", value: money(totalReceive), sub: `${receivables.length} faturas em aberto`, tone: "emerald", icon: "south_west" },
    {
      label: "Saldo Previsto",
      value: money(balance),
      sub: balance >= 0 ? "A receber > a pagar" : "A pagar > a receber",
      tone: balance >= 0 ? "blue" : "red",
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

function renderTable(payables) {
  const wrap = document.getElementById("cpTable");
  if (!payables.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">task_alt</span>Sem pagamentos pendentes.</div>`;
    return;
  }
  const body = payables
    .slice(0, 50)
    .map(
      (p) => `
      <tr>
        <td>${esc(dateOnly(p.paymentDate))}</td>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(p.project?.name || "—")}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(p.project?.referencia || "—")}</div>
        </td>
        <td>${esc(p.supplierRef?.name || p.supplier || "—")}</td>
        <td style="max-width:280px">${esc(p.description || "—")}</td>
        <td class="fin-num">${esc(money(p.budgetedAmount))}</td>
        <td>${
          p.status === "EM_ESPERA"
            ? `<span class="finance-badge finance-badge--slate">Em Espera</span>`
            : `<span class="finance-badge finance-badge--amber">Pendente</span>`
        }</td>
      </tr>`
    )
    .join("");
  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1000px">
      <thead><tr>
        <th>Data</th><th>Obra</th><th>Fornecedor</th><th>Descrição</th>
        <th style="text-align:right">Valor Previsto</th><th>Estado</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

async function load() {
  const wrap = document.getElementById("cpTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar pagamentos…</div>`;
  try {
    const [payables, receivables] = await Promise.all([
      apiRequest("/finance/payables"),
      apiRequest("/finance/receivables"),
    ]);
    const payItems = payables.items || [];
    renderKpis(payItems, receivables.items || []);
    renderTable(payItems);
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o Centro de Pagamentos.", { type: "error" });
  }
}

export async function render() {
  renderShell();
  await load();
}
