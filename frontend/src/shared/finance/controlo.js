import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Controlo Financeiro» (Financeiro).
 * Previsto vs realizado, resultado e margem, desvios de custo e cash flow.
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

function tone(value) {
  const n = Number(value) || 0;
  if (n > 0.005) return "finance-neg";
  if (n < -0.005) return "finance-pos";
  return "finance-muted";
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="ctrlKpis" class="finance-kpi-grid"></div>

    <section class="finance-card" style="margin-bottom:1.5rem">
      <h2 style="font-size:1rem;font-weight:800;color:#0f172a;margin:0 0 1rem">Previsto vs Realizado por Obra</h2>
      <div id="ctrlProjects" class="finance-table-scroll"></div>
    </section>

    <section class="finance-card">
      <h2 style="font-size:1rem;font-weight:800;color:#0f172a;margin:0 0 1rem">Cash Flow</h2>
      <div id="ctrlCash" class="finance-table-scroll"></div>
    </section>`;
}

function renderKpis(data) {
  const t = data.totals || {};
  const cards = [
    { label: "Custo Previsto", value: money(t.forecastCost), sub: "Valor total das obras", tone: "blue", icon: "target" },
    { label: "Custo Realizado", value: money(t.realizedCost), sub: "Custos pagos", tone: "amber", icon: "payments" },
    { label: "Receita", value: money(t.revenue), sub: "Faturação emitida", tone: "emerald", icon: "receipt_long" },
    { label: "Resultado", value: money(t.result), sub: `Margem ${pct(t.margin)}`, tone: t.result >= 0 ? "emerald" : "red", icon: "trending_up" },
  ];
  document.getElementById("ctrlKpis").innerHTML = cards
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

function renderProjects(data) {
  const wrap = document.getElementById("ctrlProjects");
  const items = data.byProject || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">analytics</span>Sem obras para apresentar.</div>`;
    return;
  }
  const body = items
    .map(
      (p) => `
      <tr>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(p.project.name)}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(p.project.code || "")}</div>
        </td>
        <td class="fin-num">${esc(money(p.forecastCost))}</td>
        <td class="fin-num">${esc(money(p.realizedCost))}</td>
        <td class="fin-num ${tone(p.costDeviation)}" style="font-weight:800">${esc(money(p.costDeviation))}</td>
        <td class="fin-num">${esc(money(p.revenue))}</td>
        <td class="fin-num ${tone(-p.result)}" style="font-weight:800">${esc(money(p.result))}</td>
        <td class="fin-num ${tone(-p.margin)}">${esc(pct(p.margin))}</td>
      </tr>`
    )
    .join("");
  const t = data.totals || {};
  const dev = (Number(t.realizedCost) || 0) - (Number(t.forecastCost) || 0);
  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1150px">
      <thead><tr>
        <th>Obra</th>
        <th style="text-align:right">Custo Previsto</th>
        <th style="text-align:right">Custo Realizado</th>
        <th style="text-align:right">Desvio de Custo</th>
        <th style="text-align:right">Receita</th>
        <th style="text-align:right">Resultado</th>
        <th style="text-align:right">Margem</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais</td>
        <td class="fin-num">${esc(money(t.forecastCost))}</td>
        <td class="fin-num">${esc(money(t.realizedCost))}</td>
        <td class="fin-num ${tone(dev)}">${esc(money(dev))}</td>
        <td class="fin-num">${esc(money(t.revenue))}</td>
        <td class="fin-num ${tone(-(t.result || 0))}">${esc(money(t.result))}</td>
        <td class="fin-num ${tone(-(t.margin || 0))}">${esc(pct(t.margin))}</td>
      </tr></tfoot>
    </table>`;
}

function renderCash(data) {
  const flow = data.cashFlow || {};
  document.getElementById("ctrlCash").innerHTML = `
    <table class="fin-table">
      <tbody>
        <tr><td>Entradas (recebimentos)</td><td class="fin-num finance-pos">${esc(money(flow.inflow))}</td></tr>
        <tr><td>Saídas (custos realizados)</td><td class="fin-num finance-neg">${esc(money(flow.outflow))}</td></tr>
        <tr><td style="font-weight:800">Saldo</td>
            <td class="fin-num ${Number(flow.net) >= 0 ? "finance-pos" : "finance-neg"}" style="font-weight:800">${esc(money(flow.net))}</td></tr>
      </tbody>
    </table>`;
}

async function load() {
  const wrap = document.getElementById("ctrlProjects");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar controlo financeiro…</div>`;
  try {
    const data = await apiRequest("/finance/control");
    renderKpis(data);
    renderProjects(data);
    renderCash(data);
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o controlo financeiro.", { type: "error" });
  }
}

export async function render() {
  renderShell();
  await load();
}
