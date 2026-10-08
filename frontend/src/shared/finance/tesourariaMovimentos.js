import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import {
  money,
  dateOnly,
  movementChip,
  directionChip,
  loadMovementOptions,
  openClassifyModal,
  openAssignCostModal,
} from "./movementsShared.js";

/**
 * Ecrã genérico de movimentos da Tesouraria:
 *  - Recebimentos do Cliente
 *  - Transferências Internas
 *  - Levantamentos ATM
 *  - Pagamentos a Fornecedor
 * A diferença entre eles é o filtro aplicado aos movimentos bancários.
 */

const PAGE_CONFIG = {
  "tesouraria-recebimentos": {
    type: "RECEBIMENTO_CLIENTE",
    label: "Recebimentos do Cliente",
    hint: "Entradas de valores recebidas do cliente e a sua associação à fatura.",
  },
  "tesouraria-transferencias": {
    type: "TRANSFERENCIA_INTERNA",
    label: "Transferências Internas",
    hint: "Requisições de fundo e carregamento de cartões de obra (entram no cash flow da obra).",
  },
  "tesouraria-atm": {
    type: "LEVANTAMENTO_ATM",
    label: "Levantamentos ATM",
    hint: "Saídas de valores em cartões de obra e respetiva separação de custos.",
  },
  "tesouraria-pagamentos": {
    type: null,
    label: "Pagamentos a Fornecedor",
    hint: "Pagamentos a fornecedor por cartão de obra e cartão geral (crédito vs pronto pagamento).",
    supplierPayments: true,
  },
};

const HIDDEN_FOR_PAYMENTS = ["LEVANTAMENTO_ATM", "RECEBIMENTO_CLIENTE", "TRANSFERENCIA_INTERNA"];

const state = {
  options: null,
  items: [],
  filters: { projectId: "", pendingOnly: false },
};

function config() {
  return PAGE_CONFIG[document.body.dataset.financePage] || PAGE_CONFIG["tesouraria-pagamentos"];
}

function renderShell() {
  const cfg = config();
  document.getElementById("financeRoot").innerHTML = `
    <div id="mvKpis" class="finance-kpi-grid"></div>
    <section class="finance-card">
      <div class="fin-toolbar" style="margin-bottom:1rem">
        <div class="finance-filters">
          <select id="mvProject" class="finance-select fin-proj-filter"></select>
          <label class="finance-check">
            <input id="mvPending" type="checkbox" />
            Só por associar
          </label>
        </div>
      </div>
      <p class="finance-hint">${esc(cfg.hint)}</p>
      <div id="mvTable" class="finance-table-scroll"></div>
    </section>`;

  const projectSel = document.getElementById("mvProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.options.projects
      .map((p) => `<option value="${esc(p.id)}">${esc(p.code ? `${p.code} — ${p.name}` : p.name)}</option>`)
      .join("");
  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    load();
  });
  document.getElementById("mvPending").addEventListener("change", (e) => {
    state.filters.pendingOnly = e.target.checked;
    renderTable();
  });
}

function filtered() {
  const cfg = config();
  return state.items.filter((m) => {
    if (state.filters.projectId && m.projectId !== state.filters.projectId) return false;
    if (state.filters.pendingOnly && m.costAssigned) return false;
    if (cfg.supplierPayments) {
      if (m.direction !== "SAIDA") return false;
      if (HIDDEN_FOR_PAYMENTS.includes(m.movementType)) return false;
    }
    return true;
  });
}

function renderKpis() {
  const rows = filtered();
  const totals = rows.reduce(
    (acc, m) => {
      const amount = Number(m.amount) || 0;
      if (m.direction === "ENTRADA") acc.inflow += amount;
      else acc.outflow += amount;
      if (!m.costAssigned) acc.pending += 1;
      return acc;
    },
    { inflow: 0, outflow: 0, pending: 0 }
  );
  const cards = [
    { label: "Movimentos", value: String(rows.length), sub: "No filtro actual", tone: "slate", icon: "swap_vert" },
    { label: "Entradas", value: money(totals.inflow), sub: "Total a crédito", tone: "emerald", icon: "south_west" },
    { label: "Saídas", value: money(totals.outflow), sub: "Total a débito", tone: "red", icon: "north_east" },
    { label: "Por Associar", value: String(totals.pending), sub: "Movimentos sem custo", tone: "amber", icon: "link_off" },
  ];
  document.getElementById("mvKpis").innerHTML = cards
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
  const wrap = document.getElementById("mvTable");
  const rows = filtered();
  if (!rows.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">account_balance</span>Sem movimentos para os filtros selecionados.</div>`;
    return;
  }
  const body = rows
    .map(
      (m) => `
      <tr data-id="${esc(m.id)}">
        <td>${esc(dateOnly(m.movementDate))}</td>
        <td>${esc(m.card?.label || "—")}</td>
        <td>${esc(m.project?.name || "—")}</td>
        <td>${esc(m.supplier?.name || "—")}</td>
        <td>${m.docType ? `${esc(m.docType)} ${esc(m.docNumber || "")}` : esc(m.docNumber || "—")}</td>
        <td>${movementChip(m.movementType)}</td>
        <td>${directionChip(m.direction)}</td>
        <td class="fin-num ${m.direction === "ENTRADA" ? "finance-pos" : "finance-neg"}">${esc(money(m.amount))}</td>
        <td>${
          m.costAssigned
            ? `<span class="finance-badge finance-badge--emerald">Associado</span>`
            : `<span class="finance-badge finance-badge--slate">Por associar</span>`
        }</td>
        <td>
          <div class="fin-actions">
            <button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Classificar" data-action="classify">
              <span class="material-symbols-outlined" style="font-size:17px">edit_note</span>
            </button>
            <button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Associar Custo" data-action="assign">
              <span class="material-symbols-outlined" style="font-size:17px">link</span>
            </button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1200px">
      <thead><tr>
        <th>Data</th><th>Cartão</th><th>Obra</th><th>Fornecedor</th><th>Documento</th>
        <th>Tipo</th><th>Direção</th><th style="text-align:right">Valor</th><th>Custo</th>
        <th style="text-align:center">Ações</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  wrap.querySelectorAll("tbody tr").forEach((tr) => {
    const m = state.items.find((x) => x.id === tr.dataset.id);
    if (!m) return;
    tr.querySelector('[data-action="classify"]')?.addEventListener("click", () =>
      openClassifyModal(m, { options: state.options, onSaved: load })
    );
    tr.querySelector('[data-action="assign"]')?.addEventListener("click", () =>
      openAssignCostModal(m, { options: state.options, onSaved: load })
    );
  });
}

async function load() {
  const cfg = config();
  const wrap = document.getElementById("mvTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar movimentos…</div>`;
  const params = new URLSearchParams();
  if (cfg.type) params.set("movementType", cfg.type);
  try {
    const data = await apiRequest(`/finance/bank-movements?${params.toString()}`);
    state.items = data.items || [];
    renderKpis();
    renderTable();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar movimentos.", { type: "error" });
  }
}

export async function render() {
  try {
    state.options = await loadMovementOptions();
  } catch (err) {
    toast(err.message || "Falha ao carregar opções.", { type: "error" });
    state.options = { projects: [], suppliers: [], categories: [], cards: [] };
  }
  renderShell();
  await load();
}
