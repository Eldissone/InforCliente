import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { openInvoiceDocumentModal, invoiceHasDocument } from "./invoiceDocument.js";

/**
 * Ecrã «Faturação Prevista» (Financeiro · Faturação).
 *
 * Faturação emitida vs previsão, agora ligada à orçamentação da obra:
 *  - Previsão de venda  → tabela de quantidades (ou valor global da obra)
 *  - Custo previsto     → orçamento de custo dos centros de custo
 *  - Margem prevista    → venda prevista − custo previsto
 *  - Custo realizado    → todas as áreas (pagamentos, pedidos extra, stock…)
 *  - Margem realizada   → faturado − custo realizado
 */

const STATUS = {
  EM_ABERTO: { label: "Em Aberto", badge: "slate" },
  PAGO_PARCIAL: { label: "Pago Parcial", badge: "amber" },
  PAGO_TOTAL: { label: "Pago Total", badge: "emerald" },
  ATRASADO: { label: "Atrasado", badge: "red" },
};

const SALE_SOURCE = {
  TABELA_QUANTIDADES: "Tabela de quantidades da obra",
  VALOR_GLOBAL: "Valor global da obra",
  SEM_ORCAMENTO: "Sem orçamento de venda definido",
};

const state = {
  group: "project",
  filters: { clientId: "", projectId: "" },
  projects: [],
  clients: [],
  data: null,
  expanded: new Set(),
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00%";
  return `${n.toFixed(2)}%`;
}

function marginTone(value) {
  return Number(value) >= 0 ? "finance-pos" : "finance-neg";
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function badge(status) {
  const s = STATUS[status] || { label: status, badge: "slate" };
  return `<span class="finance-badge finance-badge--${s.badge}">${esc(s.label)}</span>`;
}

function bar(percent, tone = "") {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="finance-bar-wrap">
      <div class="finance-bar"><div class="finance-bar-fill ${tone}" style="width:${value}%"></div></div>
      <span class="finance-bar-label">${esc(pct(percent))}</span>
    </div>`;
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="forecastKpis" class="finance-kpi-grid"></div>
    <section class="finance-card">
      <div class="fin-toolbar" style="margin-bottom:1rem">
        <div class="finance-seg" id="forecastGroup">
          <button type="button" data-group="project" class="active">
            <span class="material-symbols-outlined">apartment</span>Por Obra
          </button>
          <button type="button" data-group="client">
            <span class="material-symbols-outlined">groups</span>Por Cliente
          </button>
        </div>
        <div class="fin-toolbar-filters">
          <select id="forecastClient" class="finance-select fin-proj-filter"></select>
          <select id="forecastProject" class="finance-select fin-proj-filter"></select>
        </div>
      </div>
      <p class="finance-hint" id="forecastHint"></p>
      <div id="forecastTable" class="finance-table-scroll"></div>
    </section>`;

  const clientSel = document.getElementById("forecastClient");
  clientSel.innerHTML =
    `<option value="">Todos os clientes</option>` +
    state.clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  const projectSel = document.getElementById("forecastProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.referencia ? `${p.referencia} — ${p.name}` : p.name)}</option>`).join("");

  clientSel.addEventListener("change", () => {
    state.filters.clientId = clientSel.value;
    load();
  });
  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    load();
  });

  document.querySelectorAll("#forecastGroup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.group = btn.dataset.group;
      document.querySelectorAll("#forecastGroup button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });
}

function renderKpis() {
  const t = state.data?.totals || {};
  const cards = [
    {
      label: "Previsão de Venda",
      value: money(t.forecast),
      sub: "Tabela de quantidades / valor da obra",
      tone: "blue",
      icon: "target",
    },
    {
      label: "Orçamento de Custo",
      value: money(t.costBudget),
      sub: "Baseline dos centros de custo",
      tone: "slate",
      icon: "receipt_long",
    },
    {
      label: "Margem Prevista",
      value: money(t.plannedMargin),
      sub: `${pct(t.plannedMarginPct)} sobre a venda prevista`,
      tone: Number(t.plannedMargin) >= 0 ? "emerald" : "red",
      icon: "percent",
    },
    {
      label: "Faturado",
      value: money(t.billed),
      sub: `${pct(t.executedPct)} da previsão de venda`,
      tone: "emerald",
      icon: "check_circle",
    },
    {
      label: "Por Faturar",
      value: money(t.toBill),
      sub: "Previsão ainda não faturada",
      tone: "amber",
      icon: "hourglass_bottom",
    },
    {
      label: "Custo Realizado",
      value: money(t.costRealized),
      sub: "Todas as áreas (pagamentos, extras, stock)",
      tone: "amber",
      icon: "payments",
    },
    {
      label: "Margem Realizada",
      value: money(t.realizedMargin),
      sub: pct(t.realizedMarginPct) + " sobre o faturado",
      tone: Number(t.realizedMargin) >= 0 ? "emerald" : "red",
      icon: "trending_up",
    },
  ];
  document.getElementById("forecastKpis").innerHTML = cards
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

function renderByClient(data) {
  const hint = document.getElementById("forecastHint");
  hint.textContent =
    "Previsão de venda pela tabela de quantidades de cada obra e custo previsto pelo orçamento dos centros de custo.";

  const rows = (data.byClient || []).filter((c) => {
    if (!state.filters.clientId) return true;
    return (c.client?.id || null) === state.filters.clientId;
  });
  if (!rows.length) {
    document.getElementById("forecastTable").innerHTML =
      `<div class="finance-empty"><span class="material-symbols-outlined">groups</span>Sem dados para os filtros selecionados.</div>`;
    return;
  }

  const body = rows
    .map((c) => {
      const fp = Number(c.forecast);
      const billed = Number(c.billed);
      const costBudget = Number(c.costBudget);
      const margin = Number(c.plannedMargin);
      return `
      <tr>
        <td style="font-weight:700;color:#0f172a">${esc(c.client?.name || "Sem cliente")}</td>
        <td class="fin-num">${esc(money(fp))}</td>
        <td class="fin-num">${esc(money(costBudget))}</td>
        <td class="fin-num ${marginTone(margin)}" style="font-weight:700">${esc(money(margin))}</td>
        <td class="fin-num ${marginTone(margin)}">${esc(pct(c.plannedMarginPct))}</td>
        <td class="fin-num">${esc(money(billed))}</td>
        <td class="fin-num">${esc(money(Math.max(fp - billed, 0)))}</td>
        <td>${bar(fp > 0 ? (billed / fp) * 100 : 0, "finance-bar-fill--blue")}</td>
      </tr>`;
    })
    .join("");

  const t = data.totals || {};
  document.getElementById("forecastTable").innerHTML = `
    <table class="fin-table" style="min-width:1150px">
      <thead><tr>
        <th>Cliente</th><th style="text-align:right">Venda Prevista</th>
        <th style="text-align:right">Custo Previsto</th><th style="text-align:right">Margem Prevista</th>
        <th style="text-align:right">% Margem</th>
        <th style="text-align:right">Faturado</th><th style="text-align:right">Por Faturar</th>
        <th>% Faturado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais</td>
        <td class="fin-num">${esc(money(t.forecast))}</td>
        <td class="fin-num">${esc(money(t.costBudget))}</td>
        <td class="fin-num ${marginTone(t.plannedMargin)}">${esc(money(t.plannedMargin))}</td>
        <td class="fin-num ${marginTone(t.plannedMargin)}">${esc(pct(t.plannedMarginPct))}</td>
        <td class="fin-num">${esc(money(t.billed))}</td>
        <td class="fin-num">${esc(money(t.toBill))}</td>
        <td>${bar(t.executedPct, "finance-bar-fill--blue")}</td>
      </tr></tfoot>
    </table>`;
}

function renderInvoiceRows(entry, cur) {
  const invoices = entry.rows || [];
  if (!invoices.length) {
    return `<span class="finance-hint">Sem faturas emitidas para esta obra.</span>`;
  }
  const rows = invoices
    .map(
      (inv) => `
      <tr>
        <td>${esc(inv.docNumber || "—")}</td>
        <td>${esc(dateOnly(inv.docDate))}</td>
        <td>${inv.measurement ? esc(inv.measurement.reportNumber || "AM") : "—"}</td>
        <td class="fin-num">${esc(money(inv.grossAmount, cur))}</td>
        <td class="fin-num">${esc(money(inv.receivedAmount, cur))}</td>
        <td class="fin-num">${esc(money(inv.missingAmount, cur))}</td>
        <td>${badge(inv.status)}</td>
        <td>
          ${
            invoiceHasDocument(inv)
              ? `<button type="button" class="finance-btn finance-btn--ghost" data-doc="${esc(inv.id)}" style="padding:0.25rem 0.6rem">
                   <span class="material-symbols-outlined" style="font-size:16px">receipt</span>Ver fatura
                 </button>`
              : `<span class="fin-empty-cell" title="Sem fatura física anexada">—</span>`
          }
        </td>
      </tr>`
    )
    .join("");

  return `
    <table class="finance-subtable">
      <thead><tr>
        <th>Nº Doc</th><th>Data</th><th>AM</th>
        <th style="text-align:right">V. Ilíquido</th>
        <th style="text-align:right">Recebido</th>
        <th style="text-align:right">Em Falta</th>
        <th>Estado</th><th>Fatura física</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderByProject(data) {
  const hint = document.getElementById("forecastHint");
  hint.textContent = "Clique numa obra para ver as faturas emitidas e a respetiva fatura física.";

  const rows = (data.byProject || []).filter((p) => {
    if (state.filters.projectId && p.project.id !== state.filters.projectId) return false;
    if (state.filters.clientId && (p.project.client?.id || null) !== state.filters.clientId) return false;
    return true;
  });

  if (!rows.length) {
    document.getElementById("forecastTable").innerHTML =
      `<div class="finance-empty"><span class="material-symbols-outlined">apartment</span>Sem dados para os filtros selecionados.</div>`;
    return;
  }

  const body = rows
    .map((entry) => {
      const cur = entry.project.currency || "AOA";
      const open = state.expanded.has(entry.project.id);
      const source = SALE_SOURCE[entry.forecastSource] || "";
      return `
      <tr class="fin-row--clickable" data-project="${esc(entry.project.id)}">
        <td>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <button type="button" class="finance-row-toggle ${open ? "open" : ""}" data-toggle="${esc(entry.project.id)}">
              <span class="material-symbols-outlined">chevron_right</span>
            </button>
            <div>
              <div style="font-weight:700;color:#0f172a">${esc(entry.project.name)}</div>
              <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(entry.project.referencia || "—")}</div>
            </div>
          </div>
        </td>
        <td>${esc(entry.project.client?.name || "—")}</td>
        <td class="fin-num" title="${esc(source)}">${esc(money(entry.forecast, cur))}</td>
        <td class="fin-num">${esc(money(entry.costBudget, cur))}</td>
        <td class="fin-num ${marginTone(entry.plannedMargin)}" style="font-weight:700">${esc(money(entry.plannedMargin, cur))}</td>
        <td class="fin-num ${marginTone(entry.plannedMargin)}">${esc(pct(entry.plannedMarginPct))}</td>
        <td class="fin-num">${esc(money(entry.billed, cur))}</td>
        <td class="fin-num">${esc(money(entry.toBill, cur))}</td>
        <td class="fin-num">${esc(money(entry.costRealized, cur))}</td>
        <td class="fin-num ${marginTone(entry.realizedMargin)}">${esc(money(entry.realizedMargin, cur))}</td>
        <td>${bar(entry.executedPct, "finance-bar-fill--blue")}</td>
      </tr>
      <tr class="fin-subrow" data-subrow="${esc(entry.project.id)}" ${open ? "" : "hidden"}>
        <td colspan="11">
          ${renderInvoiceRows(entry, cur)}
        </td>
      </tr>`;
    })
    .join("");

  const t = data.totals || {};
  document.getElementById("forecastTable").innerHTML = `
    <table class="fin-table" style="min-width:1500px">
      <thead><tr>
        <th>Obra</th><th>Cliente</th>
        <th style="text-align:right">Venda Prevista</th>
        <th style="text-align:right">Custo Previsto</th>
        <th style="text-align:right">Margem Prevista</th>
        <th style="text-align:right">% Margem</th>
        <th style="text-align:right">Faturado</th>
        <th style="text-align:right">Por Faturar</th>
        <th style="text-align:right">Custo Realizado</th>
        <th style="text-align:right">Margem Realizada</th>
        <th>% Faturado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="2">Totais</td>
        <td class="fin-num">${esc(money(t.forecast))}</td>
        <td class="fin-num">${esc(money(t.costBudget))}</td>
        <td class="fin-num ${marginTone(t.plannedMargin)}">${esc(money(t.plannedMargin))}</td>
        <td class="fin-num ${marginTone(t.plannedMargin)}">${esc(pct(t.plannedMarginPct))}</td>
        <td class="fin-num">${esc(money(t.billed))}</td>
        <td class="fin-num">${esc(money(t.toBill))}</td>
        <td class="fin-num">${esc(money(t.costRealized))}</td>
        <td class="fin-num ${marginTone(t.realizedMargin)}">${esc(money(t.realizedMargin))}</td>
        <td>${bar(t.executedPct, "finance-bar-fill--blue")}</td>
      </tr></tfoot>
    </table>`;

  const wrap = document.getElementById("forecastTable");
  wrap.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle(btn.dataset.toggle);
    });
  });
  wrap.querySelectorAll("tr.fin-row--clickable").forEach((tr) => {
    tr.addEventListener("click", () => toggle(tr.dataset.project));
  });
  wrap.querySelectorAll("[data-doc]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.doc;
      for (const entry of data.byProject || []) {
        const invoice = (entry.rows || []).find((i) => i.id === id);
        if (invoice) {
          openInvoiceDocumentModal(invoice, { context: { projectName: entry.project.name } });
          return;
        }
      }
    });
  });
}

function renderTable() {
  const data = state.data;
  if (!data) return;
  if (state.group === "client") return renderByClient(data);
  return renderByProject(data);
}

function toggle(projectId) {
  if (state.expanded.has(projectId)) state.expanded.delete(projectId);
  else state.expanded.add(projectId);
  renderTable();
}

async function load() {
  const wrap = document.getElementById("forecastTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar faturação prevista…</div>`;
  const params = new URLSearchParams();
  if (state.filters.clientId) params.set("clientId", state.filters.clientId);
  if (state.filters.projectId) params.set("projectId", state.filters.projectId);
  try {
    state.data = await apiRequest(`/finance/billing-forecast?${params.toString()}`);
    renderKpis();
    renderTable();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar faturação prevista.", { type: "error" });
  }
}

export async function render() {
  try {
    const [projects, clients] = await Promise.all([
      apiRequest("/finance/options/projects"),
      apiRequest("/finance/options/clients"),
    ]);
    state.projects = projects.items || [];
    state.clients = clients.items || [];
  } catch (err) {
    toast(err.message || "Falha ao carregar obras e clientes.", { type: "error" });
  }
  renderShell();
  await load();
}
