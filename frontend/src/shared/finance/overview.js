import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Overview Financeiro» (Financeiro).
 * Visão consolidada de receita, custos, resultado, margem, contas a receber,
 * cash flow e ligação ao Centro de Pagamentos.
 */

function money(value) {
  return formatCurrency(Number(value) || 0, "AOA");
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00%";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function marginTone(value) {
  const n = Number(value) || 0;
  return n >= 0 ? "finance-pos" : "finance-neg";
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="ovCards" class="finance-kpi-grid"></div>
    <div id="ovCards2" class="finance-kpi-grid"></div>

    <section class="finance-card" style="margin-bottom:1.5rem">
      <h2 style="font-size:1rem;font-weight:800;color:#0f172a;margin:0 0 1rem">Resultado por Obra</h2>
      <div id="ovProjects" class="finance-table-scroll"></div>
    </section>

    <div style="display:grid;grid-template-columns:1fr;gap:1.5rem" id="ovBottom">
      <section class="finance-card">
        <h2 style="font-size:1rem;font-weight:800;color:#0f172a;margin:0 0 1rem">Cash Flow</h2>
        <div id="ovCash" class="finance-table-scroll"></div>
      </section>
      <section class="finance-card">
        <h2 style="font-size:1rem;font-weight:800;color:#0f172a;margin:0 0 1rem">Contas a Receber (Aging)</h2>
        <div id="ovAging" class="finance-table-scroll"></div>
      </section>
    </div>`;
}

function renderCards(data) {
  const c = data.cards || {};
  const primary = [
    { label: "Receita", value: money(c.revenue), sub: "Faturação emitida", tone: "blue", icon: "receipt_long" },
    { label: "Custos", value: money(c.cost), sub: "Custos realizados", tone: "amber", icon: "payments" },
    { label: "Resultado", value: money(c.result), sub: "Receita − custos", tone: c.result >= 0 ? "emerald" : "red", icon: "trending_up" },
    { label: "Margem", value: pct(c.margin), sub: "Resultado / receita", tone: c.margin >= 0 ? "emerald" : "red", icon: "percent" },
  ];
  const agingTotal = Number(data.aging?.vencidas || 0) + Number(data.aging?.a_vencer || 0);
  const secondary = [
    { label: "Previsão", value: money(c.forecast), sub: "Valor total das obras", tone: "slate", icon: "target" },
    { label: "Recebido", value: money(c.received), sub: "Entradas de cliente", tone: "emerald", icon: "savings" },
    { label: "Por Receber", value: money(agingTotal), sub: "Faturas em aberto", tone: "amber", icon: "hourglass_bottom" },
    { label: "Custos por Confirmar", value: money(c.costPending), sub: "Aguarda confirmação", tone: "red", icon: "pending_actions" },
  ];
  const cardHtml = (cards) =>
    cards
      .map(
        (card) => `
      <div class="finance-kpi finance-kpi--${card.tone}">
        <span class="finance-kpi-label">
          <span class="material-symbols-outlined" style="font-size:15px">${card.icon}</span>${esc(card.label)}
        </span>
        <span class="finance-kpi-value">${esc(card.value)}</span>
        <span class="finance-kpi-sub">${esc(card.sub)}</span>
      </div>`
      )
      .join("");
  document.getElementById("ovCards").innerHTML = cardHtml(primary);
  document.getElementById("ovCards2").innerHTML = cardHtml(secondary);
}

function renderProjects(data) {
  const wrap = document.getElementById("ovProjects");
  const items = (data.byProject || []).filter((p) => p.revenue || p.cost || p.forecast);
  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">analytics</span>Sem dados financeiros por obra.</div>`;
    return;
  }
  const body = items
    .map(
      (p) => `
      <tr>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(p.project.name)}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(p.project.referencia || "—")}</div>
        </td>
        <td class="fin-num">${esc(money(p.forecast))}</td>
        <td class="fin-num">${esc(money(p.revenue))}</td>
        <td class="fin-num finance-pos">${esc(money(p.received))}</td>
        <td class="fin-num">${esc(money(p.cost))}</td>
        <td class="fin-num ${marginTone(p.result)}" style="font-weight:800">${esc(money(p.result))}</td>
        <td class="fin-num ${marginTone(p.margin)}">${esc(pct(p.margin))}</td>
      </tr>`
    )
    .join("");
  const totals = items.reduce(
    (acc, p) => {
      acc.forecast += Number(p.forecast) || 0;
      acc.revenue += Number(p.revenue) || 0;
      acc.received += Number(p.received) || 0;
      acc.cost += Number(p.cost) || 0;
      acc.result += Number(p.result) || 0;
      return acc;
    },
    { forecast: 0, revenue: 0, received: 0, cost: 0, result: 0 }
  );
  const margin = totals.revenue > 0 ? (totals.result / totals.revenue) * 100 : 0;
  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1050px">
      <thead><tr>
        <th>Obra</th>
        <th style="text-align:right">Previsão</th>
        <th style="text-align:right">Receita</th>
        <th style="text-align:right">Recebido</th>
        <th style="text-align:right">Custo</th>
        <th style="text-align:right">Resultado</th>
        <th style="text-align:right">Margem</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais</td>
        <td class="fin-num">${esc(money(totals.forecast))}</td>
        <td class="fin-num">${esc(money(totals.revenue))}</td>
        <td class="fin-num">${esc(money(totals.received))}</td>
        <td class="fin-num">${esc(money(totals.cost))}</td>
        <td class="fin-num ${marginTone(totals.result)}">${esc(money(totals.result))}</td>
        <td class="fin-num ${marginTone(margin)}">${esc(pct(margin))}</td>
      </tr></tfoot>
    </table>`;
}

function renderCash(data) {
  const flow = data.cashFlow || {};
  document.getElementById("ovCash").innerHTML = `
    <table class="fin-table">
      <tbody>
        <tr><td>Entradas (recebimentos)</td><td class="fin-num finance-pos">${esc(money(flow.inflow))}</td></tr>
        <tr><td>Saídas (custos realizados)</td><td class="fin-num finance-neg">${esc(money(flow.outflow))}</td></tr>
        <tr><td style="font-weight:800">Saldo de tesouraria</td>
            <td class="fin-num ${Number(flow.net) >= 0 ? "finance-pos" : "finance-neg"}" style="font-weight:800">${esc(money(flow.net))}</td></tr>
      </tbody>
    </table>`;
}

function renderAging(data) {
  const aging = data.aging || {};
  const total = Number(aging.vencidas || 0) + Number(aging.a_vencer || 0);
  document.getElementById("ovAging").innerHTML = `
    <table class="fin-table">
      <tbody>
        <tr><td>Vencidas</td><td class="fin-num finance-neg">${esc(money(aging.vencidas))}</td></tr>
        <tr><td>A vencer</td><td class="fin-num">${esc(money(aging.a_vencer))}</td></tr>
        <tr><td style="font-weight:800">Total por receber</td><td class="fin-num" style="font-weight:800">${esc(money(total))}</td></tr>
      </tbody>
    </table>`;
}

async function load() {
  const wrap = document.getElementById("ovProjects");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar overview…</div>`;
  try {
    const data = await apiRequest("/finance/overview");
    renderCards(data);
    renderProjects(data);
    renderCash(data);
    renderAging(data);
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o overview financeiro.", { type: "error" });
  }
}

export async function render() {
  renderShell();
  await load();
}
