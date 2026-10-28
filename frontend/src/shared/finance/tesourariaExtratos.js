import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { can } from "../permissions.js";
import { toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawComboChart, destroyCharts, TONES } from "./charts.js";
import { kpiCardsHtml, meterHtml as meter, num, skeletonHtml } from "./widgets.js";
import {
  MOVEMENT_TYPE,
  DOC_TYPE,
  money,
  dateOnly,
  isIncoming,
  needsCostAssignment,
  costStatusHtml,
  receiptStateHtml,
  parseStatementText,
  loadMovementOptions,
  openClassifyModal,
  openAssignCostModal,
} from "./movementsShared.js";

/**
 * Ecrã «Extratos Bancários» (Financeiro · Tesouraria).
 *
 *  - Lista: cada extrato com entradas, saídas, conferência dos saldos
 *    (saldo inicial + entradas − saídas = saldo final) e quanto falta tratar.
 *  - Detalhe: os movimentos do extrato. Cada movimento leva obra, nº e tipo de
 *    documento (Fatura / AF), fornecedor e tipo de movimento financeiro
 *    (transferência interna, PF, reembolso, operação anulada, recebimento…).
 *    Nas saídas, «Associar custo» abre o custo (produto, tipo, categoria,
 *    subcategoria; pagamentos múltiplos / ATM discriminados item a item).
 *    Mercadoria não leva custo direto: o custo nasce na saída de stock.
 *  - Importar: cabeçalho do extrato com os saldos e movimentos colados / CSV.
 */

const state = {
  options: null,
  statements: [],
  balances: null,
  detail: null,
  view: "all",
  query: "",
};

const DETAIL_VIEWS = [
  { key: "all", label: "Todos" },
  { key: "unclassified", label: "Por classificar", test: (m) => m.movementType === "OUTRO" && isIncoming(m) },
  { key: "toAssign", label: "Por associar custo", test: (m) => needsCostAssignment(m) && !m.isMerchandise && !m.costAssigned },
  { key: "stock", label: "Mercadoria", test: (m) => m.isMerchandise },
  { key: "in", label: "Entradas", test: (m) => isIncoming(m) },
  { key: "out", label: "Saídas", test: (m) => !isIncoming(m) },
];

function canEdit() {
  return can("financeiro", "edit") || can("financeiro", "manage");
}

/** Movimentos ainda por tratar: saídas sem custo e entradas sem tipo. */
function pendingOf(summary) {
  return num(summary?.toAssign) + num(summary?.unclassified);
}

function cardLabel(card) {
  if (!card) return "Sem conta";
  return `${card.label}${card.lastDigits ? ` ••${card.lastDigits}` : ""}`;
}

function reconcileChip(summary) {
  if (!summary || summary.difference === null || summary.difference === undefined) {
    return `<span class="finance-chip finance-chip--slate" title="Indique os saldos inicial e final do extrato para conferir">Sem saldos</span>`;
  }
  if (Math.abs(summary.difference) < 0.01) return `<span class="finance-chip finance-chip--emerald">Confere</span>`;
  return `<span class="finance-chip finance-chip--red" title="Saldo final do extrato − (inicial + entradas − saídas)">Diferença ${esc(compact(summary.difference))}</span>`;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `<div class="ov" id="stmtRoot"></div>`;
  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = canEdit()
      ? `<button id="stmtImport" type="button" class="finance-btn finance-btn--primary">
           <span class="material-symbols-outlined">upload_file</span><span>Importar extrato</span>
         </button>`
      : "";
    document.getElementById("stmtImport")?.addEventListener("click", openImportModal);
  }
}

/* ─── Lista de extratos ───────────────────────────────────────────────────── */

function renderList() {
  const root = document.getElementById("stmtRoot");
  destroyCharts(root);
  const list = state.statements;
  const sum = (key) => list.reduce((a, s) => a + num(s.summary?.[key]), 0);
  const pending = list.reduce((a, s) => a + pendingOf(s.summary), 0);
  const unreconciled = list.filter((s) => s.summary?.difference !== null && Math.abs(num(s.summary?.difference)) >= 0.01).length;
  const noBalances = list.filter((s) => s.summary?.difference === null).length;
  const bal = state.balances || {};

  const cards = [
    {
      key: "balance",
      label: "Saldo bancário",
      icon: "account_balance",
      tone: num(bal.total) < 0 ? "red" : "blue",
      value: compact(bal.total),
      foot: bal.estimated ? "Inclui saldos de cartão sem extrato" : bal.asOf ? `Pelos extratos · ${dateOnly(bal.asOf)}` : "Sem contas ativas",
    },
    { key: "in", label: "Entradas", icon: "south_west", tone: "emerald", value: compact(sum("inflow")), foot: `${list.length} extrato${list.length === 1 ? "" : "s"} importado${list.length === 1 ? "" : "s"}` },
    { key: "out", label: "Saídas", icon: "north_east", tone: "red", value: compact(sum("outflow")), foot: `${sum("count")} movimentos no total` },
    {
      key: "pending",
      label: "Por tratar",
      icon: "pending_actions",
      tone: pending ? "amber" : "emerald",
      value: String(pending),
      badge: unreconciled ? `${unreconciled} não confere${unreconciled === 1 ? "" : "m"}` : null,
      badgeTone: "red",
      foot: pending ? `${sum("toAssign")} saídas sem custo · ${sum("unclassified")} entradas sem tipo` : "Tudo classificado e associado",
    },
  ];

  if (!list.length) {
    root.innerHTML = `
      <div class="ov-kpis">${kpiCardsHtml(cards, "st")}</div>
      <section class="finance-card ov-panel">
        <div class="ov-empty ov-empty--lg">
          <span class="material-symbols-outlined">account_balance</span>
          Ainda não há extratos bancários importados.
          ${canEdit() ? `<button type="button" class="cr-act cr-act--emerald" id="stmtImportEmpty"><span class="material-symbols-outlined">upload_file</span><span>Importar o primeiro extrato</span></button>` : ""}
        </div>
      </section>`;
    document.getElementById("stmtImportEmpty")?.addEventListener("click", openImportModal);
    return;
  }

  const rows = list
    .map((s) => {
      const sm = s.summary || {};
      const pend = pendingOf(sm);
      const done = sm.count ? ((sm.count - pend) / sm.count) * 100 : 100;
      return `
      <tr data-open="${esc(s.id)}" class="tz-click">
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(s.name)}</span>
            <span class="ov-project-meta">${esc([s.fileName, `importado ${dateOnly(s.createdAt)}`].filter(Boolean).join(" · "))}</span>
          </div>
        </td>
        <td>${esc(cardLabel(s.card))}${s.card?.bank ? `<div class="ov-project-meta">${esc(s.card.bank)}</div>` : ""}</td>
        <td class="tz-date">${s.periodStart || s.periodEnd ? `${esc(dateOnly(s.periodStart))} – ${esc(dateOnly(s.periodEnd))}` : `<span class="ov-muted">—</span>`}</td>
        <td class="fin-num ov-pos">+${esc(compact(sm.inflow))}</td>
        <td class="fin-num ov-neg">−${esc(compact(sm.outflow))}</td>
        <td class="fin-num">${sm.closing !== null && sm.closing !== undefined ? esc(money(sm.closing)) : `<span class="ov-muted">—</span>`}</td>
        <td>${reconcileChip(sm)}</td>
        <td>
          <div class="ov-cell-bar tz-progress">
            <span class="${pend ? "ov-warn" : "ov-pos"}">${pend ? `${pend} por tratar` : "Tratado"}</span>
            ${meter([{ value: done, tone: pend ? "amber" : "emerald" }])}
            <small>${sm.count || 0} movimentos</small>
          </div>
        </td>
        <td><span class="material-symbols-outlined tz-go">chevron_right</span></td>
      </tr>`;
    })
    .join("");

  root.innerHTML = `
    <div class="ov-kpis">${kpiCardsHtml(cards, "st")}</div>
    ${
      noBalances
        ? `<p class="pay-note"><span class="material-symbols-outlined">info</span><span>${noBalances} extrato${noBalances === 1 ? "" : "s"} sem saldo inicial/final: sem eles não é possível conferir se faltam movimentos nem atualizar o saldo bancário.</span></p>`
        : ""
    }
    <section class="finance-card ov-panel">
      <header class="finance-chart-head">
        <div>
          <h2 class="finance-chart-title">Extratos importados</h2>
          <p class="finance-chart-subtitle">Conferência = saldo inicial + entradas − saídas contra o saldo final do extrato</p>
        </div>
      </header>
      <div class="finance-table-scroll">
        <table class="fin-table tz-table">
          <thead><tr>
            <th>Extrato</th><th>Conta / cartão</th><th>Período</th>
            <th style="text-align:right">Entradas</th><th style="text-align:right">Saídas</th>
            <th style="text-align:right">Saldo final</th><th>Conferência</th><th>Tratamento</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;

  root.querySelectorAll("[data-open]").forEach((tr) => tr.addEventListener("click", () => openDetail(tr.dataset.open)));
}

/* ─── Detalhe do extrato ──────────────────────────────────────────────────── */

async function openDetail(statementId) {
  const root = document.getElementById("stmtRoot");
  root.innerHTML = `<div class="ov-kpis">${skeletonHtml(4, "kpi")}</div>`;
  try {
    const data = await apiRequest(`/finance/bank-statements/${statementId}`);
    state.detail = data.statement;
    renderDetail();
  } catch (err) {
    root.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar o extrato: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar extrato.", { type: "error" });
  }
}

async function reloadDetail() {
  if (!state.detail) return;
  const data = await apiRequest(`/finance/bank-statements/${state.detail.id}`);
  state.detail = data.statement;
  renderDetailBody();
}

function renderDetail() {
  const s = state.detail;
  const root = document.getElementById("stmtRoot");
  destroyCharts(root);
  root.innerHTML = `
    <div class="tz-back">
      <button id="stmtBack" type="button" class="finance-btn finance-btn--ghost">
        <span class="material-symbols-outlined">arrow_back</span><span>Extratos</span>
      </button>
      <div>
        <strong>${esc(s.name)}</strong>
        <small>${esc([cardLabel(s.card), s.card?.bank, s.periodStart || s.periodEnd ? `${dateOnly(s.periodStart)} – ${dateOnly(s.periodEnd)}` : null].filter(Boolean).join(" · "))}</small>
      </div>
    </div>
    <div id="stmtKpis" class="ov-kpis"></div>
    <div class="ov-row ov-row--8-4">
      ${chartCardHtml({ id: "stmtChart", title: "Movimento diário", subtitle: "Entradas e saídas do extrato · linha = saldo", height: 260 })}
      <section class="finance-card ov-panel">
        <header class="finance-chart-head">
          <div>
            <h2 class="finance-chart-title">Conferência</h2>
            <p class="finance-chart-subtitle">Os movimentos importados batem com o extrato?</p>
          </div>
        </header>
        <div id="stmtCheck"></div>
      </section>
    </div>
    <section class="finance-card ov-panel">
      <header class="finance-chart-head finance-chart-head--row">
        <div>
          <h2 class="finance-chart-title">Movimentos</h2>
          <p class="finance-chart-subtitle" id="stmtHint">—</p>
        </div>
        <div class="ov-table-tools">
          <label class="ov-search">
            <span class="material-symbols-outlined">search</span>
            <input id="stmtSearch" type="search" placeholder="Descrição, doc, obra…" autocomplete="off" value="${esc(state.query)}" />
          </label>
        </div>
      </header>
      <div class="finance-seg tz-views" id="stmtViews"></div>
      <div id="stmtTable" class="finance-table-scroll"></div>
    </section>`;

  document.getElementById("stmtBack").addEventListener("click", async () => {
    state.detail = null;
    state.view = "all";
    state.query = "";
    await loadStatements();
  });
  document.getElementById("stmtSearch").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderMovements();
  });
  renderDetailBody();
}

function renderDetailBody() {
  const s = state.detail;
  const sm = s.summary || {};
  const pend = pendingOf(sm);
  const movements = s.movements || [];
  const assigned = movements.filter((m) => m.costAssigned).length;
  const costOut = movements.filter((m) => needsCostAssignment(m) || m.costAssigned).length;

  document.getElementById("stmtKpis").innerHTML = kpiCardsHtml(
    [
      {
        key: "closing",
        label: "Saldo final",
        icon: "account_balance",
        tone: "blue",
        value: sm.closing !== null && sm.closing !== undefined ? compact(sm.closing) : sm.computedClosing !== null ? compact(sm.computedClosing) : "—",
        foot: sm.opening !== null && sm.opening !== undefined ? `Saldo inicial ${compact(sm.opening)}` : "Sem saldo inicial",
      },
      { key: "in", label: "Entradas", icon: "south_west", tone: "emerald", value: compact(sm.inflow), foot: `${movements.filter(isIncoming).length} movimentos a crédito` },
      { key: "out", label: "Saídas", icon: "north_east", tone: "red", value: compact(sm.outflow), foot: `${movements.filter((m) => !isIncoming(m)).length} movimentos a débito` },
      {
        key: "pending",
        label: "Por tratar",
        icon: "pending_actions",
        tone: pend ? "amber" : "emerald",
        value: String(pend),
        body: costOut ? meter([{ value: (assigned / costOut) * 100, tone: "emerald" }], { title: "Saídas com custo associado" }) : "",
        foot: costOut ? `${assigned} de ${costOut} saídas com custo${sm.merchandise ? ` · ${sm.merchandise} mercadoria` : ""}` : "Sem saídas com custo",
      },
    ],
    "sd"
  );

  renderCheck();
  renderDetailChart();
  renderMovements();
}

function renderCheck() {
  const sm = state.detail.summary || {};
  const line = (label, value, cls = "") =>
    `<div class="tz-recon-row"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
  const hasOpening = sm.opening !== null && sm.opening !== undefined;
  const hasClosing = sm.closing !== null && sm.closing !== undefined;
  const ok = sm.difference !== null && Math.abs(num(sm.difference)) < 0.01;
  document.getElementById("stmtCheck").innerHTML = `
    <div class="tz-recon">
      ${line("Saldo inicial", hasOpening ? esc(money(sm.opening)) : `<span class="ov-muted">não indicado</span>`)}
      ${line("+ Entradas", esc(money(sm.inflow)), "ov-pos")}
      ${line("− Saídas", esc(money(sm.outflow)), "ov-neg")}
      <div class="tz-recon-sep"></div>
      ${line("= Saldo calculado", sm.computedClosing !== null ? esc(money(sm.computedClosing)) : "—")}
      ${line("Saldo final do extrato", hasClosing ? esc(money(sm.closing)) : `<span class="ov-muted">não indicado</span>`)}
    </div>
    <div class="tz-check ${sm.difference === null ? "tz-check--muted" : ok ? "tz-check--ok" : "tz-check--bad"}">
      <span class="material-symbols-outlined">${sm.difference === null ? "help" : ok ? "verified" : "error"}</span>
      <span>${
        sm.difference === null
          ? "Sem os dois saldos não é possível conferir o extrato."
          : ok
            ? "Confere: não faltam movimentos."
            : `Diferença de ${esc(money(sm.difference))}: ${num(sm.difference) > 0 ? "faltam entradas ou há saídas a mais" : "faltam saídas ou há entradas a mais"} na importação.`
      }</span>
    </div>`;
}

function renderDetailChart() {
  const s = state.detail;
  const sm = s.summary || {};
  const days = new Map();
  (s.movements || []).forEach((m) => {
    const k = toDateKey(m.movementDate);
    if (!days.has(k)) days.set(k, { in: 0, out: 0 });
    days.get(k)[isIncoming(m) ? "in" : "out"] += num(m.amount);
  });
  const keys = [...days.keys()].sort();
  let running = num(sm.opening);
  drawComboChart("stmtChart", {
    categories: keys.map((k) => k.split("-").reverse().slice(0, 2).join("/")),
    height: 260,
    series: [
      { name: "Entradas", type: "column", data: keys.map((k) => days.get(k).in), color: TONES.emerald },
      { name: "Saídas", type: "column", data: keys.map((k) => days.get(k).out), color: TONES.red },
      {
        name: sm.opening !== null && sm.opening !== undefined ? "Saldo" : "Saldo (desde 0)",
        type: "line",
        data: keys.map((k) => {
          running += days.get(k).in - days.get(k).out;
          return Math.round(running);
        }),
        color: TONES.blue,
      },
    ],
  });
}

function filteredMovements() {
  const q = state.query.trim().toLowerCase();
  return (state.detail?.movements || []).filter((m) => {
    if (!q) return true;
    return [m.description, m.docNumber, m.project?.name, m.supplier?.name].filter(Boolean).join(" ").toLowerCase().includes(q);
  });
}

function typeCell(m) {
  if (!canEdit()) return `<span class="finance-chip">${esc(MOVEMENT_TYPE[m.movementType]?.label || m.movementType)}</span>`;
  const allowed = Object.entries(MOVEMENT_TYPE).filter(([k]) =>
    isIncoming(m) ? ["RECEBIMENTO_CLIENTE", "TRANSFERENCIA_INTERNA", "REEMBOLSO", "OPERACAO_ANULADA", "OUTRO"].includes(k) : k !== "RECEBIMENTO_CLIENTE"
  );
  return `
    <select class="finance-select tz-type ${m.movementType === "OUTRO" && isIncoming(m) ? "tz-type--todo" : ""}" data-type="${esc(m.id)}" ${m.costAssigned ? "disabled title=\"Já tem custo associado\"" : ""}>
      ${allowed.map(([k, v]) => `<option value="${k}" ${k === m.movementType ? "selected" : ""}>${esc(k === "OUTRO" && isIncoming(m) ? "Outro (por classificar)" : v.label)}</option>`).join("")}
    </select>`;
}

function movementState(m) {
  if (m.movementType === "RECEBIMENTO_CLIENTE") {
    return m.receiptLink?.state === "LIGADO"
      ? receiptStateHtml(m)
      : `<a href="/Financeiro/tesouraria/recebimentos" title="Ligar em Recebimentos do Cliente">${receiptStateHtml(m)}</a>`;
  }
  if (isIncoming(m)) return `<span class="finance-chip finance-chip--slate">${m.movementType === "OUTRO" ? "Indicar tipo" : "Entrada"}</span>`;
  return costStatusHtml(m);
}

function renderMovements() {
  const all = filteredMovements();
  document.getElementById("stmtViews").innerHTML = DETAIL_VIEWS.map((v) => {
    const count = v.test ? all.filter(v.test).length : all.length;
    return `<button type="button" data-view="${v.key}" class="${v.key === state.view ? "active" : ""}"><span>${esc(v.label)}</span><em>${count}</em></button>`;
  }).join("");
  document.querySelectorAll("#stmtViews button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      renderMovements();
    })
  );

  const view = DETAIL_VIEWS.find((v) => v.key === state.view);
  const rows = view?.test ? all.filter(view.test) : all;
  document.getElementById("stmtHint").textContent = `${rows.length} movimento${rows.length === 1 ? "" : "s"} · escolha o tipo de movimento financeiro e associe o custo às saídas`;
  const wrap = document.getElementById("stmtTable");
  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">task_alt</span>Nada nesta vista.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="fin-table tz-table">
      <thead><tr>
        <th>Data</th><th>Movimento</th><th>Obra</th><th>Fornecedor</th><th>Tipo de movimento</th>
        <th style="text-align:right">Valor</th><th>Custo</th><th></th>
      </tr></thead>
      <tbody>
        ${rows
          .map((m) => {
            const incoming = isIncoming(m);
            const doc = [m.docType ? DOC_TYPE[m.docType] : null, m.docNumber].filter(Boolean).join(" ");
            const canAssign = canEdit() && needsCostAssignment(m) && !m.isMerchandise && !m.costAssigned;
            return `
          <tr data-id="${esc(m.id)}">
            <td class="tz-date">${esc(dateOnly(m.movementDate))}</td>
            <td>
              <div class="ov-project">
                <span class="ov-project-name">${esc(m.description || "—")}</span>
                <span class="ov-project-meta">${esc(doc || "Sem documento")}${m.isMerchandise ? " · mercadoria" : ""}</span>
              </div>
            </td>
            <td>${m.project ? esc(m.project.name) : `<span class="${needsCostAssignment(m) ? "ov-warn" : "ov-muted"}">—</span>`}</td>
            <td>${m.supplier ? esc(m.supplier.name) : m.costSummary?.suppliers?.length ? esc(m.costSummary.suppliers.join(", ")) : `<span class="ov-muted">—</span>`}</td>
            <td>${typeCell(m)}</td>
            <td class="fin-num"><strong class="${incoming ? "ov-pos" : "ov-neg"}">${incoming ? "+" : "−"}${esc(money(m.amount))}</strong></td>
            <td>${movementState(m)}</td>
            <td>
              <div class="ac-actions">
                ${canAssign ? `<button type="button" class="cr-act cr-act--amber" data-action="assign"><span class="material-symbols-outlined">${m.movementType === "LEVANTAMENTO_ATM" ? "call_split" : "link"}</span><span>${m.movementType === "LEVANTAMENTO_ATM" ? "Separar custos" : "Associar custo"}</span></button>` : ""}
                ${canEdit() ? `<button type="button" class="fin-icon-btn fin-icon-btn--slate" title="Classificar (obra, fornecedor, documento, categoria)" data-action="classify"><span class="material-symbols-outlined" style="font-size:17px">edit_note</span></button>` : ""}
              </div>
            </td>
          </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;

  wrap.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    const m = state.detail.movements.find((x) => x.id === tr.dataset.id);
    if (!m) return;
    tr.querySelector('[data-action="classify"]')?.addEventListener("click", () => openClassifyModal(m, { options: state.options, onSaved: reloadDetail }));
    tr.querySelector('[data-action="assign"]')?.addEventListener("click", () => openAssignCostModal(m, { options: state.options, onSaved: reloadDetail }));
  });
  wrap.querySelectorAll("[data-type]").forEach((sel) =>
    sel.addEventListener("change", async () => {
      sel.disabled = true;
      try {
        await apiRequest(`/finance/bank-movements/${sel.dataset.type}`, { method: "PATCH", body: { movementType: sel.value } });
        await reloadDetail();
      } catch (err) {
        sel.disabled = false;
        toast(err.message || "Não foi possível mudar o tipo.", { type: "error" });
      }
    })
  );
}

/* ─── Importar extrato ────────────────────────────────────────────────────── */

function optionList(items, valueKey = "id", labelKey = "name") {
  return items.map((it) => `<option value="${esc(it[valueKey])}">${esc(it[labelKey])}</option>`).join("");
}

function movementRowHtml() {
  const { projects, suppliers } = state.options;
  return `
    <tr data-row>
      <td><input class="finance-input" type="date" data-f="movementDate" /></td>
      <td><input class="finance-input" type="text" data-f="description" placeholder="Descrição do banco" /></td>
      <td>
        <select class="finance-select" data-f="direction">
          <option value="SAIDA">Saída</option>
          <option value="ENTRADA">Entrada</option>
        </select>
      </td>
      <td><input class="finance-input" type="number" min="0" step="0.01" data-f="amount" /></td>
      <td>
        <select class="finance-select" data-f="movementType">
          ${Object.entries(MOVEMENT_TYPE).map(([k, v]) => `<option value="${k}" ${k === "OUTRO" ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
        </select>
      </td>
      <td><select class="finance-select" data-f="projectId"><option value="">—</option>${optionList(projects)}</select></td>
      <td><select class="finance-select" data-f="supplierId"><option value="">—</option>${optionList(suppliers)}</select></td>
      <td>
        <div class="tz-doc">
          <select class="finance-select" data-f="docType"><option value="">—</option>${Object.entries(DOC_TYPE).map(([k, v]) => `<option value="${k}">${esc(k === "AF" ? "AF" : v)}</option>`).join("")}</select>
          <input class="finance-input" type="text" data-f="docNumber" placeholder="Nº" />
        </div>
      </td>
      <td style="text-align:center"><input type="checkbox" data-f="isMerchandise" title="Mercadoria: o custo vem da saída de stock" /></td>
      <td><button type="button" class="fin-icon-btn fin-icon-btn--red" data-remove title="Remover"><span class="material-symbols-outlined" style="font-size:17px">close</span></button></td>
    </tr>`;
}

function openImportModal() {
  const { cards } = state.options;
  openModal({
    title: "Importar extrato bancário",
    width: 1180,
    contentHtml: `
      <div class="finance-form-grid finance-form-grid--3">
        <div class="finance-field">
          <label class="finance-label" for="st_name">Nome do extrato <span class="inv-req">*</span></label>
          <input id="st_name" class="finance-input" type="text" placeholder="Ex.: BFA · Outubro 2026" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_card">Conta / cartão <span class="inv-req">*</span></label>
          <select id="st_card" class="finance-select">
            <option value="">—</option>
            ${cards.map((c) => `<option value="${esc(c.id)}">${esc(cardLabel(c))}${c.bank ? ` · ${esc(c.bank)}` : ""}</option>`).join("")}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_file">Ficheiro / referência</label>
          <input id="st_file" class="finance-input" type="text" placeholder="extrato-outubro.pdf" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_start">Período</label>
          <div class="tz-doc">
            <input id="st_start" class="finance-input" type="date" />
            <input id="st_end" class="finance-input" type="date" />
          </div>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_open">Saldo inicial</label>
          <input id="st_open" class="finance-input" type="number" step="0.01" placeholder="Como no extrato" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_close">Saldo final</label>
          <input id="st_close" class="finance-input" type="number" step="0.01" placeholder="Atualiza o saldo da conta" />
        </div>
      </div>

      <details class="tz-paste">
        <summary><span class="material-symbols-outlined">content_paste</span>Colar do extrato ou carregar CSV</summary>
        <textarea id="st_paste" class="finance-textarea" rows="4"
          placeholder="2026-10-01; Pagamento fornecedor X; -150000&#10;03/10/2026; Recebimento do cliente; 250.000,00"></textarea>
        <div class="tz-paste-actions">
          <button type="button" id="st_parse" class="finance-btn finance-btn--ghost"><span class="material-symbols-outlined">playlist_add</span><span>Preencher movimentos</span></button>
          <button type="button" id="st_csvBtn" class="finance-btn finance-btn--ghost"><span class="material-symbols-outlined">upload_file</span><span>Carregar CSV</span></button>
          <input id="st_csv" type="file" accept=".csv,text/csv,text/plain" hidden />
          <small id="st_pasteNote">Uma linha por movimento: data; descrição; valor. Negativo = saída.</small>
        </div>
      </details>

      <div class="finance-table-scroll tz-import">
        <table class="fin-table">
          <thead><tr>
            <th>Data</th><th>Descrição</th><th>Direção</th><th>Valor</th><th>Tipo de movimento</th>
            <th>Obra</th><th>Fornecedor</th><th>Documento</th><th title="Mercadoria">Merc.</th><th></th>
          </tr></thead>
          <tbody id="importRows"></tbody>
        </table>
      </div>
      <div class="tz-import-foot">
        <button type="button" id="importAddRow" class="finance-btn finance-btn--ghost"><span class="material-symbols-outlined">add</span><span>Adicionar movimento</span></button>
        <div id="st_check" class="tz-check tz-check--muted"></div>
      </div>`,
    primaryLabel: "Importar",
    onRender: ({ panel }) => {
      const rows = panel.querySelector("#importRows");
      const pasteNote = panel.querySelector("#st_pasteNote");
      const $ = (id) => panel.querySelector(`#${id}`);

      // Conferência ao vivo: saldo inicial + entradas − saídas contra o saldo final.
      const check = () => {
        let inflow = 0;
        let outflow = 0;
        let count = 0;
        rows.querySelectorAll("[data-row]").forEach((r) => {
          const v = Number(r.querySelector('[data-f="amount"]').value) || 0;
          if (!v) return;
          count += 1;
          if (r.querySelector('[data-f="direction"]').value === "ENTRADA") inflow += v;
          else outflow += v;
        });
        const box = $("st_check");
        const open = $("st_open").value;
        const close = $("st_close").value;
        const base = `${count} movimentos · +${compact(inflow)} / −${compact(outflow)}`;
        if (open === "" || close === "") {
          box.className = "tz-check tz-check--muted";
          box.innerHTML = `<span class="material-symbols-outlined">help</span><span>${esc(base)} · indique os saldos para conferir</span>`;
          return;
        }
        const diff = Number(close) - (Number(open) + inflow - outflow);
        const ok = Math.abs(diff) < 0.01;
        box.className = `tz-check ${ok ? "tz-check--ok" : "tz-check--bad"}`;
        box.innerHTML = `<span class="material-symbols-outlined">${ok ? "verified" : "error"}</span><span>${esc(base)} · ${
          ok ? "confere com o saldo final" : `diferença de ${esc(money(diff))}`
        }</span>`;
      };

      const addRow = (prefill = null) => {
        rows.insertAdjacentHTML("beforeend", movementRowHtml());
        const rowEl = rows.lastElementChild;
        if (prefill) {
          rowEl.querySelector('[data-f="movementDate"]').value = prefill.movementDate || "";
          rowEl.querySelector('[data-f="amount"]').value = prefill.amount ?? "";
          rowEl.querySelector('[data-f="direction"]').value = prefill.direction || "SAIDA";
          rowEl.querySelector('[data-f="description"]').value = prefill.description || "";
          // Sugere o tipo pela descrição do banco.
          const d = String(prefill.description || "").toLowerCase();
          const type = /atm|levant/.test(d)
            ? "LEVANTAMENTO_ATM"
            : /transf.*(intern|cart)|carregamento/.test(d)
              ? "TRANSFERENCIA_INTERNA"
              : /anula|estorno/.test(d)
                ? "OPERACAO_ANULADA"
                : /reembolso/.test(d)
                  ? "REEMBOLSO"
                  : prefill.direction === "ENTRADA" && /receb|cliente|pagamento de/.test(d)
                    ? "RECEBIMENTO_CLIENTE"
                    : "OUTRO";
          rowEl.querySelector('[data-f="movementType"]').value = type;
        }
      };
      addRow();
      $("importAddRow").addEventListener("click", () => addRow());
      rows.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-remove]");
        if (btn) {
          btn.closest("[data-row]").remove();
          check();
        }
      });
      rows.addEventListener("input", check);
      rows.addEventListener("change", check);
      $("st_open").addEventListener("input", check);
      $("st_close").addEventListener("input", check);

      const fillFromText = (text) => {
        const parsed = parseStatementText(text);
        if (!parsed.length) {
          pasteNote.textContent = "Não foi possível ler nenhum movimento. Use «data; descrição; valor», uma linha por movimento.";
          return;
        }
        const onlyPlaceholder = rows.children.length === 1 && !rows.querySelector('[data-f="amount"]')?.value;
        if (onlyPlaceholder) rows.innerHTML = "";
        parsed.forEach((movement) => addRow(movement));
        const dates = parsed.map((p) => p.movementDate).sort();
        if (!$("st_start").value) $("st_start").value = dates[0];
        if (!$("st_end").value) $("st_end").value = dates[dates.length - 1];
        pasteNote.textContent = `${parsed.length} movimento(s) lido(s). Confirme o tipo, a obra e o fornecedor antes de importar.`;
        check();
      };
      $("st_parse").addEventListener("click", () => fillFromText($("st_paste").value));
      const csvInput = $("st_csv");
      $("st_csvBtn").addEventListener("click", () => csvInput.click());
      csvInput.addEventListener("change", async () => {
        const file = csvInput.files?.[0];
        if (!file) return;
        if (!$("st_file").value) $("st_file").value = file.name;
        try {
          fillFromText(await file.text());
        } catch (err) {
          pasteNote.textContent = err.message || "Falha ao ler o ficheiro.";
        }
      });
      check();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const name = $("st_name").value.trim();
      if (!name) return toast("Indique o nome do extrato.", { type: "error" });
      if (!$("st_card").value) return toast("Escolha a conta / cartão do extrato.", { type: "error" });
      if ($("st_start").value && $("st_end").value && $("st_end").value < $("st_start").value) {
        return toast("O fim do período é anterior ao início.", { type: "error" });
      }

      const movements = [];
      for (const row of panel.querySelectorAll("#importRows [data-row]")) {
        const val = (f) => row.querySelector(`[data-f="${f}"]`)?.value?.trim() ?? "";
        const amount = Number(val("amount"));
        const date = val("movementDate");
        if (!date || !amount) continue;
        const direction = val("direction");
        const movementType = val("movementType") || "OUTRO";
        if (direction === "SAIDA" && movementType === "RECEBIMENTO_CLIENTE") {
          return toast(`Movimento de ${dateOnly(date)}: um recebimento do cliente tem de ser uma entrada.`, { type: "error" });
        }
        movements.push({
          projectId: val("projectId") || null,
          supplierId: val("supplierId") || null,
          docType: val("docType") || null,
          docNumber: val("docNumber") || null,
          movementType,
          direction,
          amount: Math.abs(amount),
          movementDate: date,
          description: val("description") || null,
          isMerchandise: direction === "SAIDA" && row.querySelector('[data-f="isMerchandise"]').checked,
        });
      }
      if (!movements.length) return toast("Adicione pelo menos um movimento com data e valor.", { type: "error" });

      const opening = $("st_open").value === "" ? null : Number($("st_open").value);
      const closing = $("st_close").value === "" ? null : Number($("st_close").value);
      if (opening !== null && closing !== null) {
        const inflow = movements.filter((m) => m.direction === "ENTRADA").reduce((a, m) => a + m.amount, 0);
        const outflow = movements.filter((m) => m.direction === "SAIDA").reduce((a, m) => a + m.amount, 0);
        const diff = closing - (opening + inflow - outflow);
        if (Math.abs(diff) >= 0.01 && !window.confirm(`Os movimentos não conferem com o saldo final (diferença de ${money(diff)}). Importar mesmo assim?`)) return;
      }

      setButtonLoading(btn, true);
      try {
        const res = await apiRequest("/finance/bank-statements", {
          method: "POST",
          body: {
            name,
            cardId: $("st_card").value,
            fileName: $("st_file").value.trim() || null,
            periodStart: $("st_start").value || null,
            periodEnd: $("st_end").value || null,
            openingBalance: opening,
            closingBalance: closing,
            movements,
          },
        });
        toast(`Extrato importado com ${movements.length} movimentos.`, { type: "success" });
        close();
        await loadStatements();
        if (res.statement?.id) await openDetail(res.statement.id);
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Falha ao importar extrato.", { type: "error" });
      }
    },
  });
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function loadStatements() {
  const root = document.getElementById("stmtRoot");
  if (root && !state.statements.length) root.innerHTML = `<div class="ov-kpis">${skeletonHtml(4, "kpi")}</div>`;
  try {
    const [data, balances] = await Promise.all([
      apiRequest("/finance/bank-statements"),
      apiRequest("/finance/treasury/balances").catch(() => null),
    ]);
    state.statements = data.items || [];
    state.balances = balances?.balances || balances || null;
    renderList();
  } catch (err) {
    if (root) root.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar extratos.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  Object.assign(state, { statements: [], detail: null, view: "all", query: "" });
  try {
    state.options = await loadMovementOptions();
  } catch (err) {
    toast(err.message || "Falha ao carregar opções.", { type: "error" });
    state.options = { projects: [], suppliers: [], categories: [], cards: [] };
  }
  renderShell();
  await loadStatements();
}
