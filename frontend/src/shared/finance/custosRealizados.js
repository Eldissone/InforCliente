import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Custos Realizados» (Financeiro · Custos).
 * Totais de custos realizados por obra, por centro de custo e por cliente.
 */

const state = {
  group: "project",
  filters: { projectId: "", status: "" },
  projects: [],
  items: [],
};

function money(value) {
  return formatCurrency(Number(value) || 0, "AOA");
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="realKpis" class="finance-kpi-grid"></div>
    <section class="finance-card">
      <div class="fin-toolbar" style="margin-bottom:1rem">
        <div class="finance-seg" id="realGroup">
          <button type="button" data-group="project" class="active">
            <span class="material-symbols-outlined">apartment</span>Por Obra
          </button>
          <button type="button" data-group="costCenter">
            <span class="material-symbols-outlined">account_tree</span>Por Centro de Custo
          </button>
          <button type="button" data-group="client">
            <span class="material-symbols-outlined">groups</span>Por Cliente
          </button>
        </div>
        <div class="fin-toolbar-filters">
          <select id="realProject" class="finance-select fin-proj-filter"></select>
          <select id="realStatus" class="finance-select">
            <option value="">Todas as confirmações</option>
            <option value="CONFIRMADO">Confirmados</option>
            <option value="POR_CONFIRMAR">Por confirmar</option>
          </select>
        </div>
      </div>
      <div id="realTable" class="finance-table-scroll"></div>
    </section>`;

  const projectSel = document.getElementById("realProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.referencia ? `${p.referencia} — ${p.name}` : p.name)}</option>`).join("");

  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    load();
  });
  document.getElementById("realStatus").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    load();
  });
  document.querySelectorAll("#realGroup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.group = btn.dataset.group;
      document.querySelectorAll("#realGroup button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });
}

function groupKey(item, group) {
  if (group === "costCenter") return { key: item.costCenter?.id || "__none__", label: item.costCenter?.name || "Sem centro de custo", sub: item.costCenter?.code || "" };
  if (group === "client") return { key: item.project?.client?.id || "__none__", label: item.project?.client?.name || "Sem cliente", sub: "" };
  return { key: item.project?.id || "__none__", label: item.project?.name || "Sem obra", sub: item.project?.referencia || "" };
}

function aggregate() {
  const buckets = new Map();
  state.items.forEach((item) => {
    const { key, label, sub } = groupKey(item, state.group);
    if (!buckets.has(key)) buckets.set(key, { key, label, sub, count: 0, paid: 0, confirmed: 0, pending: 0 });
    const b = buckets.get(key);
    const paid = Number(item.paidAmount) || 0;
    b.count += 1;
    b.paid += paid;
    if (item.confirmationStatus === "CONFIRMADO") b.confirmed += paid;
    else b.pending += paid;
  });
  return [...buckets.values()].sort((a, b) => b.paid - a.paid);
}

function renderKpis() {
  const totals = state.items.reduce(
    (acc, i) => {
      const paid = Number(i.paidAmount) || 0;
      acc.paid += paid;
      if (i.confirmationStatus === "CONFIRMADO") acc.confirmed += paid;
      else acc.pending += paid;
      return acc;
    },
    { paid: 0, confirmed: 0, pending: 0 }
  );
  const cards = [
    { label: "Custos Realizados", value: money(totals.paid), sub: "Total pago no filtro", tone: "blue", icon: "payments" },
    { label: "Confirmados", value: money(totals.confirmed), sub: "Custos confirmados", tone: "emerald", icon: "verified" },
    { label: "Por Confirmar", value: money(totals.pending), sub: "Aguarda confirmação", tone: "amber", icon: "pending_actions" },
    { label: "Lançamentos", value: String(state.items.length), sub: "Registos considerados", tone: "slate", icon: "list_alt" },
  ];
  document.getElementById("realKpis").innerHTML = cards
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
  const wrap = document.getElementById("realTable");
  const buckets = aggregate();
  const label = state.group === "costCenter" ? "Centro de Custo" : state.group === "client" ? "Cliente" : "Obra";

  if (!buckets.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">payments</span>Sem custos realizados para os filtros selecionados.</div>`;
    return;
  }

  const body = buckets
    .map(
      (b) => `
      <tr>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(b.label)}</div>
          ${b.sub ? `<div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(b.sub)}</div>` : ""}
        </td>
        <td class="fin-num">${esc(String(b.count))}</td>
        <td class="fin-num" style="font-weight:800">${esc(money(b.paid))}</td>
        <td class="fin-num finance-pos">${esc(money(b.confirmed))}</td>
        <td class="fin-num finance-muted">${esc(money(b.pending))}</td>
      </tr>`
    )
    .join("");

  const totals = buckets.reduce(
    (acc, b) => {
      acc.count += b.count;
      acc.paid += b.paid;
      acc.confirmed += b.confirmed;
      acc.pending += b.pending;
      return acc;
    },
    { count: 0, paid: 0, confirmed: 0, pending: 0 }
  );

  wrap.innerHTML = `
    <table class="fin-table">
      <thead><tr>
        <th>${label}</th>
        <th style="text-align:right">Lançamentos</th>
        <th style="text-align:right">V. Pago</th>
        <th style="text-align:right">Confirmado</th>
        <th style="text-align:right">Por Confirmar</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais (${buckets.length})</td>
        <td class="fin-num">${esc(String(totals.count))}</td>
        <td class="fin-num">${esc(money(totals.paid))}</td>
        <td class="fin-num">${esc(money(totals.confirmed))}</td>
        <td class="fin-num">${esc(money(totals.pending))}</td>
      </tr></tfoot>
    </table>`;
}

async function load() {
  const wrap = document.getElementById("realTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar custos realizados…</div>`;
  const params = new URLSearchParams();
  Object.entries(state.filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  try {
    const data = await apiRequest(`/finance/costs?${params.toString()}`);
    state.items = data.items || [];
    renderKpis();
    renderTable();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar custos realizados.", { type: "error" });
  }
}

export async function render() {
  try {
    const projects = await apiRequest("/finance/options/projects");
    state.projects = projects.items || [];
  } catch (err) {
    toast(err.message || "Falha ao carregar obras.", { type: "error" });
  }
  renderShell();
  await load();
}
