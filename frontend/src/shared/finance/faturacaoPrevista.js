import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Faturação Prevista» (Financeiro · Faturação).
 * Faturação emitida vs previsão, agrupada por obra ou por cliente.
 */

const STATUS = {
  EM_ABERTO: { label: "Em Aberto", badge: "slate" },
  PAGO_PARCIAL: { label: "Pago Parcial", badge: "amber" },
  PAGO_TOTAL: { label: "Pago Total", badge: "emerald" },
  ATRASADO: { label: "Atrasado", badge: "red" },
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
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.code ? `${p.code} — ${p.name}` : p.name)}</option>`).join("");

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
  const percent = Number(t.forecast) > 0 ? (Number(t.billed) / Number(t.forecast)) * 100 : 0;
  const cards = [
    { label: "Previsão Total", value: money(t.forecast), sub: "Valor total das obras", tone: "blue", icon: "target" },
    { label: "Faturado", value: money(t.billed), sub: "% executada acumulada", tone: "emerald", icon: "receipt_long" },
    { label: "Por Faturar", value: money(t.toBill), sub: "Previsão ainda não faturada", tone: "amber", icon: "hourglass_bottom" },
    { label: "% Faturado", value: pct(percent), sub: "Do valor total das obras", tone: "slate", icon: "percent" },
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

function renderTable() {
  const wrap = document.getElementById("forecastTable");
  const hint = document.getElementById("forecastHint");
  if (!wrap) return;
  const data = state.data;
  if (!data) return;

  if (state.group === "client") {
    hint.textContent = "";
    const rows = (data.byClient || []).filter((c) => {
      if (!state.filters.clientId) return true;
      return (c.client?.id || null) === state.filters.clientId;
    });
    if (!rows.length) {
      wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">groups</span>Sem dados para os filtros selecionados.</div>`;
      return;
    }
    const body = rows
      .map((c) => {
        const fp = Number(c.forecast);
        const percent = fp > 0 ? (Number(c.billed) / fp) * 100 : 0;
        return `
        <tr>
          <td style="font-weight:700;color:#0f172a">${esc(c.client?.name || "Sem cliente")}</td>
          <td class="fin-num">${esc(money(c.forecast))}</td>
          <td class="fin-num">${esc(money(c.billed))}</td>
          <td class="fin-num">${esc(money(Math.max(fp - Number(c.billed), 0)))}</td>
          <td>${bar(percent, "finance-bar-fill--blue")}</td>
        </tr>`;
      })
      .join("");
    wrap.innerHTML = `
      <table class="fin-table">
        <thead><tr>
          <th>Cliente</th><th style="text-align:right">Previsão</th>
          <th style="text-align:right">Faturado</th><th style="text-align:right">Por Faturar</th>
          <th>% Faturado</th>
        </tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr>
          <td>Totais</td>
          <td class="fin-num">${esc(money(data.totals.forecast))}</td>
          <td class="fin-num">${esc(money(data.totals.billed))}</td>
          <td class="fin-num">${esc(money(data.totals.toBill))}</td>
          <td>${bar(Number(data.totals.forecast) > 0 ? (data.totals.billed / data.totals.forecast) * 100 : 0, "finance-bar-fill--blue")}</td>
        </tr></tfoot>
      </table>`;
    return;
  }

  hint.textContent = "Clique numa obra para ver as faturas emitidas.";
  const rows = (data.byProject || []).filter((p) => {
    if (state.filters.projectId && p.project.id !== state.filters.projectId) return false;
    if (state.filters.clientId && (p.project.client?.id || null) !== state.filters.clientId) return false;
    return true;
  });
  if (!rows.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">apartment</span>Sem dados para os filtros selecionados.</div>`;
    return;
  }

  const body = rows
    .map((entry) => {
      const cur = entry.project.currency || "AOA";
      const percent = Number(entry.forecast) > 0 ? (Number(entry.billed) / Number(entry.forecast)) * 100 : 0;
      const open = state.expanded.has(entry.project.id);
      const invoices = (entry.rows || [])
        .map(
          (inv) => `
          <tr>
            <td>${esc(inv.docNumber || "—")}</td>
            <td>${esc(dateOnly(inv.docDate))}</td>
            <td>${inv.measurement ? esc(inv.measurement.reportNumber || "AM") : "—"}</td>
            <td class="fin-num">${esc(money(inv.grossAmount, cur))}</td>
            <td>${badge(inv.status)}</td>
          </tr>`
        )
        .join("");
      return `
      <tr class="fin-row--clickable" data-project="${esc(entry.project.id)}">
        <td>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <button type="button" class="finance-row-toggle ${open ? "open" : ""}" data-toggle="${esc(entry.project.id)}">
              <span class="material-symbols-outlined">chevron_right</span>
            </button>
            <div>
              <div style="font-weight:700;color:#0f172a">${esc(entry.project.name)}</div>
              <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(entry.project.code || "")}</div>
            </div>
          </div>
        </td>
        <td>${esc(entry.project.client?.name || "—")}</td>
        <td class="fin-num">${esc(money(entry.forecast, cur))}</td>
        <td class="fin-num">${esc(money(entry.billed, cur))}</td>
        <td class="fin-num">${esc(money(entry.toBill, cur))}</td>
        <td>${bar(percent, "finance-bar-fill--blue")}</td>
      </tr>
      <tr class="fin-subrow" data-subrow="${esc(entry.project.id)}" ${open ? "" : "hidden"}>
        <td colspan="6">
          ${
            invoices
              ? `<table class="finance-subtable">
                   <thead><tr>
                     <th>Nº Doc</th><th>Data</th><th>AM</th>
                     <th style="text-align:right">V. Ilíquido</th><th>Estado</th>
                   </tr></thead>
                   <tbody>${invoices}</tbody>
                 </table>`
              : `<span class="finance-hint">Sem faturas emitidas para esta obra.</span>`
          }
        </td>
      </tr>`;
    })
    .join("");

  wrap.innerHTML = `
    <table class="fin-table">
      <thead><tr>
        <th>Obra</th><th>Cliente</th>
        <th style="text-align:right">Previsão</th><th style="text-align:right">Faturado</th>
        <th style="text-align:right">Por Faturar</th><th>% Faturado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="2">Totais</td>
        <td class="fin-num">${esc(money(data.totals.forecast))}</td>
        <td class="fin-num">${esc(money(data.totals.billed))}</td>
        <td class="fin-num">${esc(money(data.totals.toBill))}</td>
        <td>${bar(Number(data.totals.forecast) > 0 ? (data.totals.billed / data.totals.forecast) * 100 : 0, "finance-bar-fill--blue")}</td>
      </tr></tfoot>
    </table>`;

  wrap.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle(btn.dataset.toggle);
    });
  });
  wrap.querySelectorAll("tr.fin-row--clickable").forEach((tr) => {
    tr.addEventListener("click", () => toggle(tr.dataset.project));
  });
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
