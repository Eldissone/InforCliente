import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, drawAreaChart, drawBarChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";
import {
  MOVEMENT_TYPE,
  money,
  dateOnly,
  movementChip,
  directionChip,
  isIncoming,
  needsCostAssignment,
  movementStatusCell,
  loadMovementOptions,
  openClassifyModal,
  openAssignCostModal,
} from "./movementsShared.js";

/**
 * Movimentos da Tesouraria (Financeiro · Tesouraria):
 *  - Recebimentos do Cliente
 *  - Transferências Internas
 *  - Levantamentos ATM
 *  - Pagamentos a Fornecedor
 *
 * Regra de negócio: **«Associar Custo» só se aplica a saídas**. Numa entrada não
 * existe custo a associar — o que existe é um recebimento a ligar à fatura do
 * cliente (é isso que faz o valor entrar nas contas a receber) ou uma
 * transferência interna entre cartões/contas.
 */

const PAGE_CONFIG = {
  "tesouraria-recebimentos": {
    type: "RECEBIMENTO_CLIENTE",
    label: "Recebimentos do Cliente",
    hint:
      "Entradas de dinheiro do cliente. Um recebimento só fica registado na fatura quando é ligado a ela — " +
      "use «Registar na fatura» para abater o valor em falta.",
  },
  "tesouraria-transferencias": {
    type: "TRANSFERENCIA_INTERNA",
    label: "Transferências Internas",
    hint:
      "Requisições de fundo e carregamento de cartões de obra. Movem dinheiro dentro da empresa, " +
      "por isso não entram no resultado nem nas contas a pagar.",
  },
  "tesouraria-atm": {
    type: "LEVANTAMENTO_ATM",
    label: "Levantamentos ATM",
    hint:
      "Saídas de valores em cartões de obra. O custo é separado depois, por fornecedor e tipo, " +
      "com «Associar Custo» — a mercadoria entra sempre pela saída de stock.",
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

    <div class="finance-chart-grid">
      ${chartCardHtml({
        id: "mvChartMonthly",
        title: "Movimentos mês a mês",
        subtitle: "Entradas e saídas nos últimos 12 meses",
        span: 2,
        height: 300,
      })}
      ${chartCardHtml({
        id: "mvChartTypes",
        title: "Por tipo de movimento",
        subtitle: "Peso de cada tipo no movimento actual",
        height: 290,
      })}
      ${chartCardHtml({
        id: "mvChartProjects",
        title: cfg.supplierPayments ? "Pagamentos por fornecedor" : "Movimentos por obra",
        subtitle: cfg.supplierPayments ? "Os 8 fornecedores com mais valor pago" : "As 8 obras com maior volume",
        span: 2,
        height: 320,
      })}
    </div>

    <section class="finance-card">
      <div class="fin-toolbar" style="margin-bottom:1rem">
        <div class="finance-filters">
          <select id="mvProject" class="finance-select fin-proj-filter"></select>
          <label class="finance-check">
            <input id="mvPending" type="checkbox" />
            Só por tratar
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
    renderKpis();
  });
}

function filtered() {
  const cfg = config();
  return state.items.filter((m) => {
    if (state.filters.projectId && m.projectId !== state.filters.projectId) return false;
    if (state.filters.pendingOnly && needsCostAssignment(m) && m.costAssigned) return false;
    if (cfg.supplierPayments) {
      if (m.direction !== "SAIDA") return false;
      if (HIDDEN_FOR_PAYMENTS.includes(m.movementType)) return false;
    }
    return true;
  });
}

function totalsOf(rows) {
  return rows.reduce(
    (acc, m) => {
      const amount = Number(m.amount) || 0;
      if (m.direction === "ENTRADA") acc.inflow += amount;
      else acc.outflow += amount;
      if (needsCostAssignment(m) && !m.costAssigned) acc.pending += 1;
      return acc;
    },
    { inflow: 0, outflow: 0, pending: 0 }
  );
}

function renderKpis() {
  const rows = filtered();
  const totals = totalsOf(rows);
  const net = totals.inflow - totals.outflow;
  const cards = [
    { label: "Movimentos", value: String(rows.length), sub: "No filtro actual", tone: "slate", icon: "swap_vert" },
    { label: "Entradas", value: money(totals.inflow), sub: "Total a crédito", tone: "emerald", icon: "south_west" },
    { label: "Saídas", value: money(totals.outflow), sub: "Total a débito", tone: "red", icon: "north_east" },
    {
      label: "Saldo",
      value: money(net),
      sub: net >= 0 ? "Entradas acima das saídas" : "Saídas acima das entradas",
      tone: net >= 0 ? "blue" : "red",
      icon: "balance",
    },
    {
      label: "Saídas por associar",
      value: String(totals.pending),
      sub: "Sem custo associado",
      tone: totals.pending ? "amber" : "emerald",
      icon: "link_off",
    },
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

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

function lastMonthKeys(count = 12) {
  const now = new Date();
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthKeyOf(value) {
  const key = toDateKey(value);
  return key ? key.slice(0, 7) : null;
}

function monthLabelOf(key) {
  const [y, m] = String(key).split("-").map(Number);
  if (!y || !m) return String(key);
  return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
}

function renderCharts() {
  const rows = filtered();
  const keys = lastMonthKeys();
  const index = new Map(keys.map((k, i) => [k, i]));
  const inflow = keys.map(() => 0);
  const outflow = keys.map(() => 0);

  rows.forEach((m) => {
    const i = index.get(monthKeyOf(m.movementDate));
    if (i === undefined) return;
    const amount = Number(m.amount) || 0;
    if (m.direction === "ENTRADA") inflow[i] += amount;
    else outflow[i] += amount;
  });

  drawAreaChart("mvChartMonthly", {
    categories: keys.map(monthLabelOf),
    series: [
      { name: "Entradas", key: "received", color: TONES.emerald, data: inflow },
      { name: "Saídas", key: "cost", color: TONES.red, data: outflow },
    ],
    height: 300,
  });

  const byType = new Map();
  rows.forEach((m) => {
    const label = MOVEMENT_TYPE[m.movementType]?.label || m.movementType || "Outro";
    const amount = Number(m.amount) || 0;
    byType.set(label, (byType.get(label) || 0) + amount);
  });
  const typeRows = [...byType.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  drawDonutChart("mvChartTypes", {
    labels: typeRows.map(([label]) => label),
    series: typeRows.map(([, value]) => value),
    totalLabel: "Movimento",
    height: 290,
  });

  const cfg = config();
  const groupMap = new Map();
  rows.forEach((m) => {
    const label = cfg.supplierPayments
      ? m.supplier?.name || "Sem fornecedor"
      : m.project?.name || "Sem obra";
    if (!groupMap.has(label)) groupMap.set(label, { inflow: 0, outflow: 0 });
    const bucket = groupMap.get(label);
    const amount = Number(m.amount) || 0;
    if (m.direction === "ENTRADA") bucket.inflow += amount;
    else bucket.outflow += amount;
  });
  const groups = [...groupMap.entries()]
    .map(([label, v]) => ({ label, ...v, total: v.inflow + v.outflow }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  drawBarChart("mvChartProjects", {
    categories: groups.map((g) => g.label),
    series: [
      { name: "Entradas", data: groups.map((g) => g.inflow), color: TONES.emerald },
      { name: "Saídas", data: groups.map((g) => g.outflow), color: TONES.red },
    ],
    height: 320,
  });
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function renderTable() {
  const wrap = document.getElementById("mvTable");
  const rows = filtered();
  if (!rows.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">account_balance</span>Sem movimentos para os filtros selecionados.</div>`;
    return;
  }
  const body = rows
    .map((m) => {
      const incoming = isIncoming(m);
      const isClientReceipt = m.movementType === "RECEBIMENTO_CLIENTE";
      return `
      <tr data-id="${esc(m.id)}">
        <td>${esc(dateOnly(m.movementDate))}</td>
        <td>${esc(m.card?.label || "—")}</td>
        <td>${esc(m.project?.name || "—")}</td>
        <td>${esc(m.supplier?.name || "—")}</td>
        <td>${m.docType ? `${esc(m.docType)} ${esc(m.docNumber || "")}` : esc(m.docNumber || "—")}</td>
        <td>${movementChip(m.movementType)}</td>
        <td>${directionChip(m.direction)}</td>
        <td class="fin-num ${incoming ? "finance-pos" : "finance-neg"}">${esc(money(m.amount))}</td>
        <td>${movementStatusCell(m)}</td>
        <td>
          <div class="fin-actions">
            ${
              isClientReceipt
                ? `<button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Registar na fatura do cliente" data-action="receipt">
                     <span class="material-symbols-outlined" style="font-size:17px">receipt_long</span>
                   </button>`
                : ""
            }
            <button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Classificar" data-action="classify">
              <span class="material-symbols-outlined" style="font-size:17px">edit_note</span>
            </button>
            ${
              needsCostAssignment(m)
                ? `<button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Associar Custo" data-action="assign">
                     <span class="material-symbols-outlined" style="font-size:17px">link</span>
                   </button>`
                : ""
            }
          </div>
        </td>
      </tr>`;
    })
    .join("");

  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1250px">
      <thead><tr>
        <th>Data</th><th>Cartão</th><th>Obra</th><th>Fornecedor</th><th>Documento</th>
        <th>Tipo</th><th>Direção</th><th style="text-align:right">Valor</th><th>Estado</th>
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
    tr.querySelector('[data-action="receipt"]')?.addEventListener("click", () => openReceiptLinkModal(m));
  });
}

/* ─── Ligar um recebimento à fatura do cliente ────────────────────────────── */

/**
 * Fecha o ciclo do recebimento: escolhe-se a fatura em aberto, regista-se o
 * recebimento (o mesmo endpoint usado no ecrã das faturas, para os valores
 * ficarem iguais em todo o lado) e guarda-se a referência no movimento.
 */
async function openReceiptLinkModal(movement) {
  let receivables = [];
  try {
    const data = await apiRequest("/finance/receivables");
    receivables = (data.items || []).filter((r) => Number(r.missingAmount) > 0);
  } catch (err) {
    toast(err.message || "Falha ao carregar faturas em aberto.", { type: "error" });
    return;
  }
  const candidates = movement.projectId
    ? receivables.filter((r) => r.projectId === movement.projectId)
    : receivables;
  const list = candidates.length ? candidates : receivables;
  if (!list.length) {
    toast("Não há faturas em aberto para ligar a este recebimento.", { type: "error" });
    return;
  }

  const amount = Number(movement.amount) || 0;
  const defaultInvoice = list.find((r) => Number(r.missingAmount) >= amount) || list[0];

  openModal({
    title: "Registar recebimento na fatura",
    contentHtml: `
      <p class="finance-note" style="margin-bottom:1rem">
        Este movimento entrou no banco por ${esc(money(amount))} em ${esc(dateOnly(movement.movementDate))}.
        Escolha a fatura que ele paga: o valor em falta da fatura é reduzido e o recebimento passa a contar
        na Faturação, no Overview e nas Contas a Receber.
      </p>
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field finance-field--full">
          <label class="finance-label" for="rl_invoice">Fatura em aberto <span style="color:#dc2626">*</span></label>
          <select id="rl_invoice" class="finance-select" required>
            ${list
              .map(
                (r) =>
                  `<option value="${esc(r.id)}" data-missing="${Number(r.missingAmount) || 0}" ${
                    r.id === defaultInvoice.id ? "selected" : ""
                  }>${esc(
                    `${r.project?.name || ""} · ${r.docNumber || "sem nº"} · venc. ${dateOnly(r.dueDate)} · em falta ${money(
                      r.missingAmount,
                      r.project?.currency
                    )}`
                  )}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rl_amount">Valor recebido <span style="color:#dc2626">*</span></label>
          <input id="rl_amount" class="finance-input" type="number" min="0" step="0.01" required value="${amount}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rl_date">Data do recebimento</label>
          <input id="rl_date" class="finance-input" type="date" value="${esc(toDateKey(movement.movementDate) || "")}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rl_method">Meio</label>
          <input id="rl_method" class="finance-input" type="text" value="Transferência bancária" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rl_notes">Notas</label>
          <input id="rl_notes" class="finance-input" type="text" value="${esc(movement.description || "")}" />
        </div>
      </div>
      <p class="finance-note" id="rl_hint" style="margin-top:0.75rem"></p>`,
    primaryLabel: "Registar recebimento",
    onRender: ({ panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const refresh = () => {
        const missing = Number($("rl_invoice").selectedOptions[0]?.dataset.missing || 0);
        const value = Number($("rl_amount").value) || 0;
        $("rl_hint").textContent =
          missing > 0
            ? `Esta fatura tem ${money(missing)} em falta. Recebendo ${money(value)}, ficam ${money(
                Math.max(missing - value, 0)
              )} por receber.`
            : "";
      };
      $("rl_invoice").addEventListener("change", refresh);
      $("rl_amount").addEventListener("input", refresh);
      refresh();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const invoiceId = $("rl_invoice").value;
      const value = Number($("rl_amount").value);
      if (!value || value <= 0) return toast("Indique o valor recebido.", { type: "error" });
      const notes = $("rl_notes").value.trim();
      const reference = `Recebimento em banco ligado à fatura (${
        $("rl_invoice").selectedOptions[0]?.textContent?.split("·")[1]?.trim() || "fatura"
      })`;

      setButtonLoading(btn, true);
      try {
        await apiRequest(`/finance/invoices/${invoiceId}/receipts`, {
          method: "POST",
          body: {
            amount: value,
            receivedDate: $("rl_date").value || toDateKey(movement.movementDate),
            method: $("rl_method").value.trim() || null,
            notes: notes || null,
          },
        });
        // Guarda a ligação no movimento para se saber que já foi tratado.
        await apiRequest(`/finance/bank-movements/${movement.id}`, {
          method: "PATCH",
          body: { notes: movement.notes ? `${movement.notes} · ${reference}` : reference },
        });
        toast("Recebimento registado e ligado à fatura.", { type: "success" });
        close();
        await load();
      } catch (err) {
        toast(err.message || "Falha ao registar o recebimento.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

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
    renderCharts();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar movimentos.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  state.filters = { projectId: "", pendingOnly: false };
  try {
    state.options = await loadMovementOptions();
  } catch (err) {
    toast(err.message || "Falha ao carregar opções.", { type: "error" });
    state.options = { projects: [], suppliers: [], categories: [], cards: [] };
  }
  renderShell();
  await load();
}
