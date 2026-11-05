import { apiRequest, apiUpload } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { openInvoiceDocumentModal, invoiceHasDocument } from "./invoiceDocument.js";
import { compactMoney as compact } from "./charts.js";
import { daysLate } from "./aging.js";
import { openReceiptModal, RECEIPT_METHODS } from "./receiptModal.js";
import { kpiCardsHtml, meterHtml, num, skeletonHtml, stripHtml } from "./widgets.js";
import { bindMoneyInputs, readMoney, setMoney } from "./moneyInput.js";
import { creditableGross, openCreditNoteModal, openGuaranteesModal, openStatementModal } from "./invoiceExtras.js";

/**
 * Ecrã «Registar Faturas» (Financeiro · Faturação).
 *
 *  - Indicadores do filtro actual (faturado, recebido, em falta, atrasadas).
 *  - Faixa de estados que também serve de filtro rápido.
 *  - Tabela com o essencial de cada fatura; as deduções abrem no detalhe.
 *  - Formulário em duas colunas: dados da fatura à esquerda e, à direita, o
 *    documento físico (leitura com IA) e o resumo dos valores calculados.
 */

const STATUS = {
  EM_ABERTO: { label: "Em Aberto", badge: "slate" },
  PAGO_PARCIAL: { label: "Pago Parcial", badge: "amber" },
  PAGO_TOTAL: { label: "Pago Total", badge: "emerald" },
  ATRASADO: { label: "Atrasado", badge: "red" },
  ANULADA: { label: "Anulada", badge: "slate" },
  NOTA_CREDITO: { label: "Nota de crédito", badge: "violet" },
};

const state = {
  filters: { month: "", status: "", clientId: "", projectId: "" },
  query: "",
  projects: [],
  clients: [],
  items: [],
  totals: null,
  expanded: new Set(),
  // Estado da leitura automática de faturas (Gemini).
  ai: { configured: false, model: null, loaded: false },
};

/**
 * Metadados da última leitura com IA feita no formulário aberto — guardados
 * com a fatura para se saber que foi lida automaticamente e por que modelo.
 */
let lastScan = null;

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

/** Valor numa célula da tabela: sem «Kz» (a moeda está no subtítulo); outras moedas mostram o código. */
function amount(value, currency) {
  const cur = currency || "AOA";
  return cur === "AOA" ? formatCurrency(Number(value) || 0, "AOA").replace(/\s*Kz$/, "") : money(value, cur);
}

function pct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function canEdit() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

function canApprove() {
  return can("financeiro", "approve") || can("financeiro", "manage");
}

function projectById(id) {
  return state.projects.find((p) => p.id === id) || null;
}

/** Data «só dia» (docDate/dueDate vêm em ISO) — evita desvio de fuso. */
function formatDateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function addDays(dateKey, days) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  if (!y || !m || !d) return "";
  return toDateKey(new Date(Date.UTC(y, m - 1, d + days)));
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  const root = document.getElementById("financeRoot");
  root.innerHTML = `
    <div class="ov">
      <div id="invoiceKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>
      <div id="invoiceStrip" class="ov-strip ov-strip--5">${skeletonHtml(5, "cell")}</div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Faturas emitidas</h2>
            <p class="finance-chart-subtitle" id="invCount">—</p>
          </div>
          <div class="ov-table-tools">
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="invSearch" type="search" placeholder="Nº doc, obra ou cliente…" autocomplete="off" />
            </label>
            <input id="invFilterMonth" class="finance-input inv-filter" type="month" title="Mês do documento" />
            <select id="invFilterClient" class="finance-select inv-filter" title="Cliente">
              <option value="">Todos os clientes</option>
            </select>
            <select id="invFilterProject" class="finance-select inv-filter" title="Obra">
              <option value="">Todas as obras</option>
            </select>
            <button id="invFilterClear" type="button" class="finance-btn finance-btn--ghost inv-filter-clear" title="Limpar filtros">
              <span class="material-symbols-outlined">filter_alt_off</span>
            </button>
          </div>
        </header>
        <div id="invoiceTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  const clientSel = document.getElementById("invFilterClient");
  clientSel.innerHTML =
    `<option value="">Todos os clientes</option>` +
    state.clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

  const projectSel = document.getElementById("invFilterProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.code ? `${p.code} — ${p.name}` : p.name)}</option>`).join("");

  clientSel.value = state.filters.clientId;
  projectSel.value = state.filters.projectId;
  document.getElementById("invFilterMonth").value = state.filters.month;

  clientSel.addEventListener("change", () => {
    state.filters.clientId = clientSel.value;
    loadInvoices();
  });
  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    loadInvoices();
  });
  document.getElementById("invFilterMonth").addEventListener("change", (e) => {
    state.filters.month = e.target.value;
    loadInvoices();
  });
  document.getElementById("invFilterClear").addEventListener("click", () => {
    state.filters = { month: "", status: "", clientId: "", projectId: "" };
    state.query = "";
    document.getElementById("invFilterMonth").value = "";
    document.getElementById("invSearch").value = "";
    clientSel.value = "";
    projectSel.value = "";
    loadInvoices();
  });

  let timer = null;
  document.getElementById("invSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      renderAll();
    }, 150);
  });

  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = `
      <button id="invGuarantees" type="button" class="finance-btn finance-btn--ghost" title="Garantias retidas e devoluções">
        <span class="material-symbols-outlined">verified_user</span>Garantias
      </button>
      <button id="invStatement" type="button" class="finance-btn finance-btn--ghost" title="Extrato de conta corrente do cliente">
        <span class="material-symbols-outlined">description</span>Extrato de cliente
      </button>
      ${
        canEdit()
          ? `<button id="invNew" type="button" class="finance-btn finance-btn--primary">
               <span class="material-symbols-outlined">add</span>Nova Fatura
             </button>`
          : ""
      }`;
    document.getElementById("invNew")?.addEventListener("click", () => openInvoiceModal(null));
    document.getElementById("invGuarantees")?.addEventListener("click", () =>
      openGuaranteesModal({
        projectId: state.filters.projectId,
        clientId: state.filters.clientId,
        canEdit: canEdit(),
        canApprove: canApprove(),
      })
    );
    document.getElementById("invStatement")?.addEventListener("click", () =>
      openStatementModal({ clients: state.clients, clientId: state.filters.clientId })
    );
  }
}

/** Faturas do filtro do servidor, já com a pesquisa local aplicada. */
function searched() {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.items;
  return state.items.filter((inv) =>
    [inv.docNumber, inv.project?.name, inv.project?.code, inv.client?.name, inv.measurement?.reportNumber].some((v) =>
      String(v || "").toLowerCase().includes(q)
    )
  );
}

/** Faturas visíveis na tabela (pesquisa + estado escolhido na faixa). */
function visibleItems() {
  const items = searched();
  return state.filters.status ? items.filter((i) => i.status === state.filters.status) : items;
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis() {
  const items = visibleItems();
  const sum = (key) => items.reduce((a, i) => a + num(i[key]), 0);
  const gross = sum("grossAmount");
  const net = sum("netAmount");
  const received = sum("receivedAmount");
  const missing = sum("missingAmount");
  const vat = sum("vatAmount");
  const guarantee = sum("guaranteeAmount");
  const deductions = sum("vatCativoAmount") + sum("withholdingAmount") + sum("carInsuranceAmount");
  const overdue = items.filter((i) => i.status === "ATRASADO");
  const overdueValue = overdue.reduce((a, i) => a + num(i.missingAmount), 0);
  const credited = items.filter((i) => i.kind === "NOTA_CREDITO").reduce((a, i) => a - num(i.netAmount), 0);
  const advanceOutstanding = Math.max(
    items.filter((i) => i.kind === "ADIANTAMENTO").reduce((a, i) => a + num(i.grossAmount), 0) -
      items.reduce((a, i) => a + num(i.advanceDeductionAmount), 0),
    0
  );
  // Recebido sobre o líquido a receber: o líquido já vem abatido das notas de
  // crédito (entram a negativo), que é o que o cliente efetivamente paga.
  const receivedPct = net > 0 ? (received / net) * 100 : 0;
  const oldest = overdue.reduce((max, i) => Math.max(max, daysLate(i.dueDate || i.effectiveDueDate) || 0), 0);

  const cards = [
    {
      key: "gross",
      label: "Total faturado",
      icon: "receipt_long",
      tone: "blue",
      value: money(gross),
      badge: `${items.length} documento${items.length === 1 ? "" : "s"}`,
      badgeTone: "blue",
      body: `
        <dl class="ov-kpi-split">
          <div><dt>IVA</dt><dd>+ ${esc(compact(vat))}</dd></div>
          <div><dt>IVA cativo, retenção e CAR</dt><dd class="ov-neg">− ${esc(compact(deductions))}</dd></div>
          <div><dt title="Retida pelo cliente até à receção da obra">Garantia retida (a recuperar)</dt><dd class="ov-neg">− ${esc(compact(guarantee))}</dd></div>
          <div><dt>Valor líquido a receber</dt><dd>${esc(compact(net))}</dd></div>
          ${credited > 0 ? `<div><dt>Inclui notas de crédito</dt><dd class="ov-neg">− ${esc(compact(credited))}</dd></div>` : ""}
          ${advanceOutstanding > 0 ? `<div><dt title="Adiantamentos faturados ainda não descontados nas faturas de trabalhos">Adiantamento por amortizar</dt><dd class="ov-warn">${esc(compact(advanceOutstanding))}</dd></div>` : ""}
        </dl>`,
    },
    {
      key: "received",
      label: "Total recebido",
      icon: "savings",
      tone: "emerald",
      value: money(received),
      badge: `${pct(receivedPct, 1)} do líquido`,
      badgeTone: "emerald",
      body: `
        ${meterHtml([{ value: receivedPct, tone: "emerald" }])}
        <p class="ov-kpi-compare">de <strong>${esc(compact(net))}</strong> a receber em valor líquido</p>`,
    },
    {
      key: "missing",
      label: "Em falta",
      icon: "pending_actions",
      tone: "amber",
      value: money(missing),
      badge: overdueValue > 0 ? `${compact(overdueValue)} vencido` : "Nada vencido",
      badgeTone: overdueValue > 0 ? "red" : "emerald",
      body: `
        ${meterHtml([
          { value: missing > 0 ? (overdueValue / missing) * 100 : 0, tone: "red" },
          { value: missing > 0 ? ((missing - overdueValue) / missing) * 100 : 0, tone: "amber-soft" },
        ])}
        <p class="ov-kpi-compare">
          <span class="ov-legend"><i class="ov-dot ov-dot--red"></i>Vencido</span>
          <span class="ov-legend" style="margin-left:0.6rem"><i class="ov-dot ov-dot--amber"></i>A vencer</span>
        </p>`,
    },
    {
      key: "overdue",
      label: "Faturas atrasadas",
      icon: "event_busy",
      tone: overdue.length ? "red" : "emerald",
      value: String(overdue.length),
      badge: overdue.length ? `${compact(overdueValue)} em atraso` : "Em dia",
      badgeTone: overdue.length ? "red" : "emerald",
      body: `<p class="ov-kpi-compare">${
        overdue.length
          ? `A mais antiga está vencida há <strong>${oldest} dias</strong>. Use «Registar recebimento» quando o cliente pagar.`
          : "Nenhuma fatura passou da data de vencimento."
      }</p>`,
    },
  ];

  document.getElementById("invoiceKpis").innerHTML = kpiCardsHtml(cards, "inv");
}

/** Faixa de estados: mostra contagem e valor e filtra a tabela ao clicar. */
function renderStrip() {
  const items = searched();
  const of = (status) => items.filter((i) => !status || i.status === status);
  const value = (list, key) => list.reduce((a, i) => a + num(i[key]), 0);
  const cells = [
    { status: "", label: "Todas", icon: "list_alt", list: of(""), key: "grossAmount", sub: "faturado" },
    { status: "EM_ABERTO", label: "Em aberto", icon: "schedule", list: of("EM_ABERTO"), key: "missingAmount", sub: "por receber" },
    { status: "PAGO_PARCIAL", label: "Pago parcial", icon: "hourglass_bottom", list: of("PAGO_PARCIAL"), key: "missingAmount", sub: "em falta" },
    { status: "PAGO_TOTAL", label: "Pago total", icon: "task_alt", list: of("PAGO_TOTAL"), key: "receivedAmount", sub: "recebido" },
    { status: "ATRASADO", label: "Atrasado", icon: "event_busy", list: of("ATRASADO"), key: "missingAmount", sub: "vencido", tone: "neg" },
  ];

  const wrap = document.getElementById("invoiceStrip");
  wrap.innerHTML = stripHtml(
    cells.map((c) => ({
      label: c.label,
      icon: c.icon,
      value: String(c.list.length),
      valueTone: c.tone && c.list.length ? c.tone : null,
      sub: `${compact(value(c.list, c.key))} ${c.sub}`,
      action: c.status || "ALL",
      active: (state.filters.status || "") === c.status,
    }))
  );
  wrap.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filters.status = btn.dataset.action === "ALL" ? "" : btn.dataset.action;
      renderAll();
    });
  });
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function statusBadge(status) {
  const s = STATUS[status] || { label: status, badge: "slate" };
  return `<span class="finance-badge finance-badge--${s.badge}">${esc(s.label)}</span>`;
}

function dueChip(inv) {
  const due = inv.dueDate || inv.effectiveDueDate;
  if (!due || num(inv.missingAmount) <= 0) return "";
  const days = daysLate(due);
  if (days === null) return "";
  if (days > 0) return `<span class="inv-due inv-due--late">há ${days} d</span>`;
  if (days === 0) return `<span class="inv-due inv-due--today">hoje</span>`;
  if (days >= -7) return `<span class="inv-due inv-due--soon">em ${Math.abs(days)} d</span>`;
  return "";
}

function detailRow(inv, cur) {
  const item = (label, value, cls = "") => `
    <div class="inv-detail-item">
      <span>${esc(label)}</span>
      <strong class="${cls}">${value}</strong>
    </div>`;
  if (inv.kind === "NOTA_CREDITO") {
    return `
    <div class="inv-detail">
      ${item("Corrige a fatura", esc(inv.creditedInvoice?.docNumber || "—"))}
      ${item("V. Ilíquido anulado", esc(money(-num(inv.grossAmount), cur)))}
      ${item("IVA anulado", esc(money(-num(inv.vatAmount), cur)))}
      ${item("Líquido anulado", esc(money(-num(inv.netAmount), cur)), "ov-neg")}
      ${inv.notes ? `<div class="inv-detail-item inv-detail-item--wide"><span>Motivo</span><strong>${esc(inv.notes)}</strong></div>` : ""}
    </div>`;
  }
  const credits = (inv.creditNotes || []).length
    ? `<div class="inv-detail-item inv-detail-item--wide">
        <span>Notas de crédito (${inv.creditNotes.length})</span>
        <ul class="inv-receipts">${inv.creditNotes
          .map(
            (n) => `<li><span>${esc(formatDateOnly(n.docDate))}</span><strong>${esc(n.docNumber || "NC")}</strong><span class="ov-neg">− ${esc(money(-num(n.netAmount), cur))}</span><span class="ov-muted">${esc(n.notes || "")}</span></li>`
          )
          .join("")}</ul>
      </div>`
    : "";
  return `
    <div class="inv-detail">
      ${num(inv.advanceDeductionAmount) > 0 ? item("Valor dos trabalhos", esc(money(inv.workValue, cur))) : ""}
      ${num(inv.advanceDeductionAmount) > 0 ? item("Amortização do adiantamento", `− ${esc(money(inv.advanceDeductionAmount, cur))}`, "ov-neg") : ""}
      ${item("Retenção na fonte", `− ${esc(money(inv.withholdingAmount, cur))}`, "ov-neg")}
      ${item("IVA", `+ ${esc(money(inv.vatAmount, cur))}`)}
      ${num(inv.vatCativoPercent) > 0 ? item(`IVA cativo (${num(inv.vatCativoPercent)}%)`, `− ${esc(money(inv.vatCativoAmount, cur))}`, "ov-neg") : ""}
      ${item("Seguro CAR", `− ${esc(money(inv.carInsuranceAmount, cur))}`, "ov-neg")}
      ${item("Garantia", `− ${esc(money(inv.guaranteeAmount, cur))}`, "ov-neg")}
      ${item("% da obra", inv.workPercent === null ? "—" : esc(pct(inv.workPercent)))}
      ${item("Último recebimento", esc(formatDateOnly(inv.receivedDate)))}
      ${inv.notes ? `<div class="inv-detail-item inv-detail-item--wide"><span>Notas</span><strong>${esc(inv.notes)}</strong></div>` : ""}
      ${receiptsHtml(inv, cur)}
      ${credits}
    </div>`;
}

/** Etiqueta do tipo de documento (as faturas de trabalhos não levam etiqueta). */
function kindChip(inv) {
  if (inv.kind === "ADIANTAMENTO") return ` <span class="finance-chip finance-chip--amber">Adiantamento</span>`;
  if (inv.kind === "NOTA_CREDITO") {
    return ` <span class="finance-chip finance-chip--violet">NC${inv.creditedInvoice?.docNumber ? ` · ${esc(inv.creditedInvoice.docNumber)}` : ""}</span>`;
  }
  if (num(inv.advanceDeductionAmount) > 0) return ` <span class="finance-chip finance-chip--slate" title="Amortiza adiantamento">− adiant.</span>`;
  return "";
}

/** Recebimentos registados na fatura; quem aprova pode anular um lançado por engano. */
function receiptsHtml(inv, cur) {
  const receipts = inv.receipts || [];
  if (!receipts.length) {
    return `<div class="inv-detail-item inv-detail-item--wide"><span>Recebimentos</span><strong class="ov-muted">Nenhum recebimento registado</strong></div>`;
  }
  const undo = canApprove();
  return `
    <div class="inv-detail-item inv-detail-item--wide">
      <span>Recebimentos (${receipts.length})</span>
      <ul class="inv-receipts">
        ${receipts
          .map(
            (r) => `
          <li>
            <span>${esc(formatDateOnly(r.receivedDate))}</span>
            <strong>${esc(money(r.amount, cur))}</strong>
            <span class="ov-muted">${esc([r.method, r.bankMovementId ? "ligado ao extrato" : null].filter(Boolean).join(" · ") || "—")}</span>
            ${
              undo
                ? `<button type="button" class="inv-link-btn inv-link-btn--danger" data-undo-receipt="${esc(r.id)}" data-invoice="${esc(inv.id)}">
                     <span class="material-symbols-outlined">undo</span>Anular
                   </button>`
                : ""
            }
          </li>`
          )
          .join("")}
      </ul>
    </div>`;
}

async function undoReceipt(invoiceId, receiptId) {
  const inv = state.items.find((i) => i.id === invoiceId);
  const receipt = inv?.receipts?.find((r) => r.id === receiptId);
  if (!receipt) return;
  const cur = inv.project?.currency || "AOA";
  if (!window.confirm(`Anular o recebimento de ${money(receipt.amount, cur)} de ${formatDateOnly(receipt.receivedDate)}? O valor volta a ficar em falta na fatura.`)) return;
  try {
    await apiRequest(`/finance/invoices/${invoiceId}/receipts/${receiptId}`, { method: "DELETE" });
    toast("Recebimento anulado.", { type: "success" });
    await loadInvoices();
  } catch (err) {
    toast(err.message || "Falha ao anular o recebimento.", { type: "error" });
  }
}

function renderTable() {
  const wrap = document.getElementById("invoiceTable");
  if (!wrap) return;
  const items = visibleItems();
  const count = document.getElementById("invCount");
  if (count) {
    count.textContent = `${items.length} de ${state.items.length} documentos · valores em Kz · clique numa linha para ver deduções e recebimentos`;
  }

  if (!items.length) {
    wrap.innerHTML = `
      <div class="ov-empty ov-empty--lg">
        <span class="material-symbols-outlined">receipt_long</span>
        ${state.items.length ? "Nenhuma fatura corresponde aos filtros." : "Ainda não há faturas registadas."}
      </div>`;
    return;
  }

  const editable = canEdit();
  const rows = items
    .map((inv) => {
      const cur = inv.project?.currency || "AOA";
      const open = state.expanded.has(inv.id);
      const receivedPct = num(inv.netAmount) > 0 ? (num(inv.receivedAmount) / num(inv.netAmount)) * 100 : 0;
      return `
      <tr data-id="${esc(inv.id)}" class="fin-row--clickable ${inv.status === "ATRASADO" ? "fin-row--overdue" : ""} ${inv.kind === "NOTA_CREDITO" ? "inv-row--credit" : ""}">
        <td>
          <div class="inv-doc">
            <span class="material-symbols-outlined inv-toggle ${open ? "open" : ""}">chevron_right</span>
            <div>
              <div class="inv-doc-number">
                ${esc(inv.docNumber || "Sem nº")}
                ${invoiceHasDocument(inv) ? `<span class="material-symbols-outlined inv-doc-icon" title="Fatura física anexada">attach_file</span>` : ""}
                ${inv.scanSource === "IA" ? `<span class="finance-chip finance-chip--violet" title="Lida automaticamente com IA${inv.scanModel ? ` (${esc(inv.scanModel)})` : ""}">IA</span>` : ""}
              </div>
              <div class="ov-project-meta">${esc(formatDateOnly(inv.docDate))}${inv.measurement ? ` · ${esc(inv.measurement.reportNumber || "AM")}` : ""}${kindChip(inv)}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(inv.project?.name || "—")}</span>
            <span class="ov-project-meta">${esc(inv.client?.name || inv.project?.code || "")}</span>
          </div>
        </td>
        <td>
          <div class="inv-due-cell">${esc(formatDateOnly(inv.dueDate || inv.effectiveDueDate))}${
            inv.dueEstimated ? `<span class="inv-due inv-due--est" title="Sem vencimento registado: data do documento + 30 dias">estimado</span>` : ""
          }${dueChip(inv)}</div>
        </td>
        <td class="fin-num">${esc(amount(inv.grossAmount, cur))}</td>
        <td class="fin-num"><strong>${esc(amount(inv.netAmount, cur))}</strong></td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span>${esc(amount(inv.receivedAmount, cur))}</span>
            ${meterHtml([{ value: receivedPct, tone: "emerald" }])}
          </div>
        </td>
        <td class="fin-num">
          <div class="inv-missing">
            <strong class="${num(inv.missingAmount) > 0 ? "ov-neg" : "ov-pos"}">${esc(amount(inv.missingAmount, cur))}</strong>
            ${statusBadge(inv.status)}
          </div>
        </td>
        <td>
          <div class="fin-actions">
            ${
              invoiceHasDocument(inv)
                ? `<button type="button" class="fin-icon-btn" title="Ver fatura física" data-action="document">
                     <span class="material-symbols-outlined" style="font-size:17px">receipt</span>
                   </button>`
                : ""
            }
            ${
              editable
                ? `${
                    num(inv.missingAmount) > 0
                      ? `<button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Registar recebimento" data-action="receipt">
                           <span class="material-symbols-outlined" style="font-size:17px">payments</span>
                         </button>`
                      : ""
                  }${
                    canApprove() && inv.kind !== "NOTA_CREDITO" && creditableGross(inv) > 0.005
                      ? `<button type="button" class="fin-icon-btn fin-icon-btn--violet" title="Emitir nota de crédito" data-action="credit">
                           <span class="material-symbols-outlined" style="font-size:17px">assignment_return</span>
                         </button>`
                      : ""
                  }${
                    inv.kind === "NOTA_CREDITO"
                      ? ""
                      : `<button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Editar" data-action="edit">
                           <span class="material-symbols-outlined" style="font-size:17px">edit</span>
                         </button>`
                  }
                   <button type="button" class="fin-icon-btn fin-icon-btn--red" title="Eliminar" data-action="delete">
                     <span class="material-symbols-outlined" style="font-size:17px">delete</span>
                   </button>`
                : ""
            }
          </div>
        </td>
      </tr>
      <tr class="fin-subrow" ${open ? "" : "hidden"}>
        <td colspan="8">${detailRow(inv, cur)}</td>
      </tr>`;
    })
    .join("");

  const sum = (key) => items.reduce((a, i) => a + num(i[key]), 0);
  wrap.innerHTML = `
    <table class="fin-table inv-table">
      <thead>
        <tr>
          <th>Documento</th><th>Obra · Cliente</th><th>Vencimento</th>
          <th style="text-align:right">V. Ilíquido</th>
          <th style="text-align:right">V. Líquido</th>
          <th style="text-align:right">Recebido</th>
          <th style="text-align:right">Em falta · estado</th>
          <th style="text-align:center">Ações</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3">Totais (${items.length} documentos)</td>
          <td class="fin-num">${esc(amount(sum("grossAmount")))}</td>
          <td class="fin-num">${esc(amount(sum("netAmount")))}</td>
          <td class="fin-num">${esc(amount(sum("receivedAmount")))}</td>
          <td class="fin-num">${esc(amount(sum("missingAmount")))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;

  wrap.querySelectorAll("[data-undo-receipt]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      undoReceipt(btn.dataset.invoice, btn.dataset.undoReceipt);
    })
  );

  wrap.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    const inv = state.items.find((i) => i.id === tr.dataset.id);
    if (!inv) return;
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      if (state.expanded.has(inv.id)) state.expanded.delete(inv.id);
      else state.expanded.add(inv.id);
      renderTable();
    });
    tr.querySelector('[data-action="edit"]')?.addEventListener("click", () => openInvoiceModal(inv));
    tr.querySelector('[data-action="receipt"]')?.addEventListener("click", () => openReceiptModal(inv, { onSaved: loadInvoices }));
    tr.querySelector('[data-action="credit"]')?.addEventListener("click", () => openCreditNoteModal(inv, { onSaved: loadInvoices }));
    tr.querySelector('[data-action="delete"]')?.addEventListener("click", () => removeInvoice(inv));
    tr.querySelector('[data-action="document"]')?.addEventListener("click", () =>
      openInvoiceDocumentModal(inv, { context: { projectName: inv.project?.name } })
    );
  });
}

function renderAll() {
  renderKpis();
  renderStrip();
  renderTable();
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function loadOptions() {
  const [projects, clients] = await Promise.all([
    apiRequest("/finance/options/projects"),
    apiRequest("/finance/options/clients"),
  ]);
  state.projects = projects.items || [];
  state.clients = clients.items || [];
}

async function loadInvoices() {
  const wrap = document.getElementById("invoiceTable");
  if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">A carregar faturas…</div>`;
  const params = new URLSearchParams();
  // O estado filtra-se localmente (faixa de estados), o resto no servidor.
  ["month", "clientId", "projectId"].forEach((k) => {
    if (state.filters[k]) params.set(k, state.filters[k]);
  });
  try {
    const data = await apiRequest(`/finance/invoices?${params.toString()}`);
    state.items = data.items || [];
    state.totals = data.totals || null;
    renderAll();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar faturas: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar faturas.", { type: "error" });
  }
}

/* ─── Formulário de fatura ────────────────────────────────────────────────── */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Valores da fatura — o mesmo cálculo e arredondamentos do servidor
 * (invoiceAmountsService): líquido = ilíquido + IVA − IVA cativo − retenção − CAR − garantia.
 */
function buildPreview(draft) {
  const workValue = round2(draft.grossAmount);
  const amort = round2(Math.max(Number(draft.advanceDeductionAmount) || 0, 0));
  const g = round2(workValue - amort);
  const vat = round2((g * (Number(draft.vatPercent) || 0)) / 100);
  const cativoPct = Number(draft.vatCativoPercent) || 0;
  const vatCativo = round2((vat * cativoPct) / 100);
  const withholding = round2((g * (Number(draft.withholdingPercent) || 0)) / 100);
  const car = round2((g * (Number(draft.carPercent) || 0)) / 100);
  const guarantee = round2((g * (Number(draft.guaranteePercent) || 0)) / 100);
  const net = round2(g + vat - vatCativo - withholding - car - guarantee);
  const budget = Number(draft.saleBudget) || 0;
  const workPercent = budget > 0 ? (g / budget) * 100 : null;
  return { workValue, amort, gross: g, vat, cativoPct, vatCativo, withholding, car, guarantee, net, workPercent };
}

/** Cativação do IVA: 0, 50 ou 100%. */
const CATIVO_OPTIONS = [
  [0, "0%"],
  [50, "50%"],
  [100, "100%"],
];

/** Resumo legível do que a IA leu, para o financeiro confirmar antes de gravar. */
function buildScanSummary(fields, warnings) {
  const parts = [];
  if (fields.docNumber) parts.push(`Nº ${fields.docNumber}`);
  if (fields.docDate) parts.push(`Data ${fields.docDate}`);
  if (fields.supplierName) parts.push(`Fornecedor ${fields.supplierName}`);
  if (fields.supplierNif) parts.push(`NIF ${fields.supplierNif}`);
  if (fields.documentType) parts.push(fields.documentType.replace(/_/g, " "));
  if (fields.confidence != null) parts.push(`confiança ${fields.confidence}%`);
  const summary = parts.join(" · ");
  const list = warnings?.length ? ` A confirmar: ${warnings.join(" ")}` : "";
  return `${summary || "Campos lidos preenchidos abaixo."}${list} Revise e corrija antes de guardar.`;
}

/**
 * Lê o PDF/fotografia da fatura com IA e devolve os campos sugeridos.
 * Devolve também o `File` para ser anexado depois de a fatura existir.
 */
async function scanInvoiceFile(file) {
  const data = await apiUpload("/finance/invoices/scan", { file, fieldName: "file" });
  return { fields: data.fields || {}, warnings: data.warnings || [] };
}

async function lookupScannedInvoiceNif(fields, noteEl, scanSummary) {
  const nif = String(fields.clientNif || fields.supplierNif || "").replace(/\D/g, "");
  if (nif.length < 9) return;
  const party = fields.clientNif ? "destinatário" : "emitente";
  noteEl.textContent = `${scanSummary} A confirmar o NIF do ${party} no Portal da AGT…`;
  try {
    const result = await apiRequest("/finance/invoices/lookup-nif", {
      method: "POST",
      body: { nif },
    });
    const agt = result?.data || {};
    const companyDetails = [agt.nome, agt.tipo, agt.estado, agt.regimeIva]
      .filter(Boolean)
      .join(" · ");
    noteEl.textContent = result?.found && companyDetails
      ? `${scanSummary} Dados AGT (${nif}): ${companyDetails}.`
      : `${scanSummary} A AGT não encontrou dados para o NIF ${nif}.`;
  } catch (error) {
    noteEl.textContent = `${scanSummary} Não foi possível confirmar o NIF na AGT: ${error.message || "serviço indisponível"}`;
  }
}

/** Linha de dedução/imposto: % editável e o valor calculado automaticamente. */
function deductionRowHtml({ id, label, value, hint, sign = "−", extra = "" }) {
  return `
    <div class="inv-ded-row">
      <div class="inv-ded-label">
        <span>${esc(label)}</span>
        <small>${esc(hint)}</small>
      </div>
      <div class="inv-pct-input">
        <input id="${id}" class="finance-input" type="number" min="0" max="100" step="0.01" value="${esc(value)}" />
        <span>%</span>
      </div>
      <div class="inv-ded-amount" id="${id}_amount">${sign} —</div>
      ${extra}
    </div>`;
}

function stepTitle(n, title, sub = "") {
  return `
    <div class="inv-step">
      <span class="inv-step-n">${n}</span>
      <div>
        <p class="inv-step-title">${esc(title)}</p>
        ${sub ? `<p class="inv-step-sub">${esc(sub)}</p>` : ""}
      </div>
    </div>`;
}

async function openInvoiceModal(invoice) {
  const isEdit = Boolean(invoice);
  const hasDoc = invoiceHasDocument(invoice);
  const aiReady = state.ai.configured;
  lastScan = null;
  const today = toDateKey(new Date());

  const content = `
    <div class="inv-form">
      <div class="inv-form-main">

        <section class="inv-section">
          ${stepTitle(1, "Identificação", "Tipo de documento, obra, terceiro e auto de medição a faturar")}
          <input id="inv_kind" type="hidden" value="${esc(invoice?.kind || "FATURA")}" />
          ${
            isEdit
              ? ""
              : `<div class="inv-kind" id="inv_kindChoice">
                   <button type="button" data-kind="FATURA" class="active">
                     <span class="material-symbols-outlined">receipt_long</span>
                     <span><strong>Fatura de trabalhos</strong><small>Trabalhos executados (com ou sem auto de medição)</small></span>
                   </button>
                   <button type="button" data-kind="ADIANTAMENTO">
                     <span class="material-symbols-outlined">forward</span>
                     <span><strong>Fatura de adiantamento</strong><small>Adiantamento do cliente, descontado nas faturas seguintes</small></span>
                   </button>
                 </div>`
          }
          <div class="finance-form-grid finance-form-grid--2">
            <div class="finance-field finance-field--full">
              <label class="finance-label" for="inv_project">Obra <span class="inv-req">*</span></label>
              <select id="inv_project" class="finance-select" required ${isEdit ? "disabled" : ""}>
                <option value="">Selecionar obra…</option>
                ${state.projects
                  .map((p) => `<option value="${esc(p.id)}" ${invoice?.projectId === p.id ? "selected" : ""}>${esc(p.code ? `${p.code} — ${p.name}` : p.name)}</option>`)
                  .join("")}
              </select>
            </div>
            <div class="finance-field">
              <label class="finance-label" for="inv_client">Terceiro (cliente)</label>
              <div class="inv-readonly">
                <span class="material-symbols-outlined">link</span>
                <input id="inv_client" type="text" value="${esc(invoice?.client?.name || "")}" readonly placeholder="Associado automaticamente à obra" />
              </div>
            </div>
            <div class="finance-field">
              <label class="finance-label">Moeda</label>
              <div class="inv-readonly">
                <span class="material-symbols-outlined">payments</span>
                <input id="inv_currency" type="text" value="${esc(invoice?.project?.currency || "AOA")}" readonly />
              </div>
            </div>
          </div>
          <div id="inv_context" class="inv-context" hidden></div>
          <div class="finance-field" style="margin-top:0.9rem" id="inv_amField" ${invoice?.kind === "ADIANTAMENTO" ? "hidden" : ""}>
            <span class="finance-label">Auto de medição em aberto</span>
            <input id="inv_measurement" type="hidden" value="" />
            <div id="inv_amList" class="inv-am-list">
              ${
                isEdit
                  ? `<div class="inv-am inv-am--static">
                       <span class="material-symbols-outlined">${invoice.measurement ? "fact_check" : "remove"}</span>
                       <span>${esc(invoice.measurement ? `${invoice.measurement.reportNumber || "AM"} · ${formatDateOnly(invoice.measurement.reportDate)}` : "Sem auto de medição associado")}</span>
                     </div>`
                  : `<p class="inv-am-empty">Escolha a obra para ver os autos de medição aprovados por faturar.</p>`
              }
            </div>
          </div>
        </section>

        <section class="inv-section">
          ${stepTitle(2, "Documento")}
          <div class="finance-form-grid finance-form-grid--3">
            <div class="finance-field">
              <label class="finance-label" for="inv_docNumber">Nº documento</label>
              <input id="inv_docNumber" class="finance-input" type="text" placeholder="FT 2026/001" value="${esc(invoice?.docNumber || "")}" />
            </div>
            <div class="finance-field">
              <label class="finance-label" for="inv_docDate">Data doc. <span class="inv-req">*</span></label>
              <input id="inv_docDate" class="finance-input" type="date" required max="${today}" value="${invoice?.docDate ? esc(toDateKey(invoice.docDate)) : today}" />
            </div>
            <div class="finance-field">
              <label class="finance-label" for="inv_dueDate">Vencimento</label>
              <input id="inv_dueDate" class="finance-input" type="date" value="${invoice?.dueDate ? esc(toDateKey(invoice.dueDate)) : ""}" />
              <div class="inv-quick" id="inv_dueQuick">
                ${[30, 60, 90].map((d) => `<button type="button" data-days="${d}">+${d} dias</button>`).join("")}
              </div>
              <small class="pay-hint">Se ficar vazio, vence 30 dias após a data do documento.</small>
            </div>
          </div>
        </section>

        <section class="inv-section">
          ${stepTitle(3, "Valores", "Retenção, IVA, seguro CAR e garantia são calculados a partir da configuração da obra")}
          <div class="finance-field">
            <label class="finance-label" for="inv_gross" id="inv_grossLabel">Valor ilíquido <span class="inv-req">*</span></label>
            <div class="inv-money-input">
              <input id="inv_gross" class="finance-input" data-money required placeholder="0,00" value="${invoice ? Number(invoice.grossAmount) : ""}" />
              <span id="inv_grossCur">${esc(invoice?.project?.currency || "AOA")}</span>
            </div>
            <p id="inv_amWarning" class="inv-am-warning" hidden></p>
          </div>
          <div class="inv-amort" id="inv_amortRow" hidden>
            <div class="inv-ded-label">
              <span>Amortização do adiantamento</span>
              <small id="inv_amortHint">Parte do adiantamento descontada nesta fatura</small>
            </div>
            <div class="inv-amort-input">
              <div class="inv-money-input">
                <input id="inv_amort" class="finance-input" data-money placeholder="0,00" value="${num(invoice?.advanceDeductionAmount) > 0 ? num(invoice.advanceDeductionAmount) : ""}" />
                <span>${esc(invoice?.project?.currency || "AOA")}</span>
              </div>
              <div class="inv-quick" id="inv_amortQuick">
                <button type="button" data-amort="prop">Proporcional</button>
                <button type="button" data-amort="all">Tudo</button>
                <button type="button" data-amort="none">Nada</button>
              </div>
            </div>
          </div>
          <div class="inv-ded">
            ${deductionRowHtml({ id: "inv_withholding", label: "Retenção na fonte", value: numOr(invoice?.withholdingPercent, ""), hint: "Automático · configuração da obra" })}
            ${deductionRowHtml({
              id: "inv_vat",
              label: "IVA",
              value: numOr(invoice?.vatPercent, ""),
              hint: "Automático · configuração da obra",
              sign: "+",
            })}
            <div class="inv-ded-row">
              <div class="inv-ded-label">
                <span>IVA cativo</span>
                <small>Parte do IVA que o cliente entrega diretamente ao Estado</small>
              </div>
              <select id="inv_vatCativo" class="finance-select inv-cativo-select" title="Percentagem do IVA cativo pelo cliente">
                ${CATIVO_OPTIONS.map(
                  ([value, label]) =>
                    `<option value="${value}" ${num(invoice?.vatCativoPercent) === value ? "selected" : ""}>${label}</option>`
                ).join("")}
              </select>
              <div class="inv-ded-amount" id="inv_vatCativo_amount">− —</div>
            </div>
            ${deductionRowHtml({ id: "inv_car", label: "Seguro CAR", value: numOr(invoice?.carPercent, ""), hint: "Automático · contrato da obra" })}
            ${deductionRowHtml({ id: "inv_guarantee", label: "Garantia", value: numOr(invoice?.guaranteePercent, ""), hint: "Automático · contrato da obra" })}
          </div>
          <button id="inv_saveConfig" type="button" class="inv-link-btn">
            <span class="material-symbols-outlined">save</span>Guardar estas percentagens na configuração da obra
          </button>
        </section>

        <section class="inv-section">
          ${stepTitle(4, "Recebimento do cliente", "Como entra esta fatura na tesouraria?")}
          <div class="finance-choice-grid" id="rcv_choice" ${isEdit ? "hidden" : ""}>
            <button type="button" class="finance-choice" data-mode="aberto">
              <span class="finance-choice-icon"><span class="material-symbols-outlined">schedule</span></span>
              <span>
                <span class="finance-choice-title">Fica em aberto</span>
                <span class="finance-choice-desc">Ainda não recebi. Entra nas contas a receber e na antiguidade.</span>
              </span>
            </button>
            <button type="button" class="finance-choice" data-mode="recebido">
              <span class="finance-choice-icon"><span class="material-symbols-outlined">savings</span></span>
              <span>
                <span class="finance-choice-title">Já recebi do cliente</span>
                <span class="finance-choice-desc">Registo agora a entrada, total ou parcial.</span>
              </span>
            </button>
          </div>
          ${
            isEdit
              ? `<p class="finance-note">Os recebimentos desta fatura registam-se na lista, com o botão «Registar recebimento».</p>`
              : ""
          }
          <div id="rcv_fields" class="finance-form-grid finance-form-grid--3" style="margin-top:0.75rem">
            <div class="finance-field">
              <label class="finance-label" for="inv_receivedDate">Data recebimento <span class="inv-req">*</span></label>
              <input id="inv_receivedDate" class="finance-input" type="date" value="${invoice?.receivedDate ? esc(toDateKey(invoice.receivedDate)) : today}" ${isEdit ? "disabled" : ""} />
            </div>
            <div class="finance-field">
              <label class="finance-label" for="inv_received">Valor recebido <span class="inv-req">*</span></label>
              <input id="inv_received" class="finance-input" data-money placeholder="0,00" value="${invoice ? Number(invoice.receivedAmount) : ""}" ${isEdit ? "disabled" : ""} />
            </div>
            <div class="finance-field">
              <label class="finance-label" for="inv_receivedMethod">Meio</label>
              <select id="inv_receivedMethod" class="finance-select" ${isEdit ? "disabled" : ""}>
                <option value="">—</option>
                ${RECEIPT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("")}
              </select>
            </div>
          </div>
        </section>

        <section class="inv-section">
          ${stepTitle(5, "Notas do processo")}
          <textarea id="inv_notes" class="finance-textarea" rows="3" placeholder="Referência ao auto de medição, condições de pagamento, observações do cliente…">${esc(invoice?.notes || "")}</textarea>
        </section>
      </div>

      <aside class="inv-form-aside">
        <div class="finance-scan" id="inv_scanPanel">
          <div class="finance-scan-head">
            <span class="finance-scan-icon"><span class="material-symbols-outlined">document_scanner</span></span>
            <div style="min-width:0">
              <p class="finance-scan-title">Fatura física</p>
              <p class="finance-scan-file" id="inv_docFile">${hasDoc ? esc(invoice.documentName || "Documento anexado") : "PDF ou fotografia"}</p>
            </div>
          </div>
          <input id="inv_docFileInput" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden />
          <div class="finance-scan-actions">
            <button id="inv_pickBtn" type="button" class="finance-btn finance-btn--ghost">
              <span class="material-symbols-outlined">upload_file</span>Escolher
            </button>
            <button id="inv_scanBtn" type="button" class="finance-btn finance-btn--primary" ${aiReady ? "" : "disabled"}>
              <span class="material-symbols-outlined">auto_awesome</span>Ler com IA
            </button>
            ${
              hasDoc
                ? `<button id="inv_viewDoc" type="button" class="finance-btn finance-btn--ghost" title="Ver fatura física">
                     <span class="material-symbols-outlined">visibility</span>
                   </button>
                   <button id="inv_removeDoc" type="button" class="finance-btn finance-btn--ghost" title="Remover documento">
                     <span class="material-symbols-outlined">delete</span>
                   </button>`
                : ""
            }
          </div>
          <p class="finance-scan-status" id="inv_docNote">${
            aiReady
              ? '<span class="material-symbols-outlined">info</span>Escolha o ficheiro e use «Ler com IA» para preencher os campos. Confira sempre os valores.'
              : '<span class="material-symbols-outlined">info</span>Leitura automática indisponível (falta GEMINI_API_KEY). Anexe o ficheiro e preencha à mão.'
          }</p>
        </div>

        <div class="inv-summary">
          <p class="inv-summary-title">Resumo da fatura</p>
          <dl class="inv-summary-lines">
            <div id="pv_workRow" hidden><dt>Valor dos trabalhos</dt><dd id="pv_workValue">—</dd></div>
            <div id="pv_amortRow" hidden><dt>Amortização adiant.</dt><dd id="pv_amort" class="ov-neg">—</dd></div>
            <div><dt>V. Ilíquido</dt><dd id="pv_gross">—</dd></div>
            <div><dt>IVA</dt><dd id="pv_vat">—</dd></div>
            <div id="pv_cativoRow" hidden><dt>IVA cativo</dt><dd id="pv_cativo" class="ov-neg">—</dd></div>
            <div><dt>Retenção na fonte</dt><dd id="pv_withholding" class="ov-neg">—</dd></div>
            <div><dt>Seguro CAR</dt><dd id="pv_car" class="ov-neg">—</dd></div>
            <div><dt>Garantia</dt><dd id="pv_guarantee" class="ov-neg">—</dd></div>
          </dl>
          <div class="inv-summary-net">
            <span>V. Líquido a receber</span>
            <strong id="pv_net">—</strong>
          </div>
          <div class="inv-summary-work">
            <div class="inv-summary-work-head">
              <span>% da obra</span>
              <strong id="pv_work">—</strong>
            </div>
            <div id="pv_workBar"></div>
            <p id="pv_workNote" class="inv-summary-note">Escolha a obra para comparar com a venda prevista.</p>
          </div>
          <div class="inv-summary-receipt">
            <div><span>Recebido agora</span><strong id="rcv_sum_received" class="ov-pos">—</strong></div>
            <div><span>Fica em falta</span><strong id="rcv_sum_missing" class="ov-warn">—</strong></div>
          </div>
          <p id="pv_warning" class="inv-summary-warning" hidden></p>
        </div>
      </aside>
    </div>`;

  openModal({
    title: isEdit ? `Editar fatura ${invoice.docNumber || ""}` : "Registar fatura emitida",
    contentHtml: content,
    primaryLabel: isEdit ? "Guardar alterações" : "Guardar fatura",
    width: 1120,
    onRender: ({ panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      bindMoneyInputs(panel);
      const projectSel = $("inv_project");
      const amHidden = $("inv_measurement");
      const amList = $("inv_amList");
      let currentProject = projectById(invoice?.projectId || projectSel.value) || null;

      const cur = () => currentProject?.currency || invoice?.project?.currency || "AOA";
      const kind = () => $("inv_kind").value || "FATURA";
      // Adiantamento por amortizar disponível para esta fatura (em edição, inclui o que ela já amortiza).
      const advanceAvailable = () =>
        round2((Number(currentProject?.advanceOutstanding) || 0) + (isEdit ? num(invoice.advanceDeductionAmount) : 0));
      const amortActive = () => kind() === "FATURA" && !$("inv_amortRow").hidden;

      // ── Recebimento: as duas opções e o que cada uma implica ──
      const rcvChoice = $("rcv_choice");
      const rcvFields = $("rcv_fields");
      const rcvAmount = $("inv_received");
      const rcvDate = $("inv_receivedDate");
      const rcvMethod = $("inv_receivedMethod");
      let rcvMode = isEdit ? "recebido" : "aberto";

      const draftPreview = () =>
        buildPreview({
          grossAmount: readMoney($("inv_gross")),
          advanceDeductionAmount: amortActive() ? readMoney($("inv_amort")) || 0 : 0,
          vatPercent: $("inv_vat").value,
          withholdingPercent: $("inv_withholding").value,
          carPercent: $("inv_car").value,
          guaranteePercent: $("inv_guarantee").value,
          vatCativoPercent: Number($("inv_vatCativo").value) || 0,
          saleBudget: currentProject?.saleBudget ?? currentProject?.budgetTotal,
        });

      function refreshReceipt() {
        const pv = draftPreview();
        rcvChoice?.querySelectorAll(".finance-choice").forEach((btn) => {
          btn.classList.toggle("active", !isEdit && btn.dataset.mode === rcvMode);
        });
        if (!isEdit) {
          const paying = rcvMode === "recebido";
          if (rcvFields) rcvFields.hidden = !paying;
          if (rcvAmount) rcvAmount.disabled = !paying;
          if (rcvDate) rcvDate.disabled = !paying;
          if (rcvMethod) rcvMethod.disabled = !paying;
        }
        const received = isEdit
          ? Number(invoice.receivedAmount) || 0
          : rcvMode === "recebido"
            ? readMoney(rcvAmount) || 0
            : 0;
        $("rcv_sum_received").textContent = money(received, cur());
        $("rcv_sum_missing").textContent = money(Math.max(pv.net - received, 0), cur());
      }

      const refreshPreview = () => {
        const c = cur();
        // Amortização: só em faturas de trabalhos de obras com adiantamento por amortizar.
        const showAmort = kind() === "FATURA" && advanceAvailable() > 0.005;
        $("inv_amortRow").hidden = !showAmort;
        const pv = draftPreview();
        if (showAmort) {
          $("inv_amortHint").textContent = `Por amortizar nesta obra: ${money(advanceAvailable(), c)}`;
        }
        $("pv_workRow").hidden = !(pv.amort > 0);
        $("pv_amortRow").hidden = !(pv.amort > 0);
        $("pv_workValue").textContent = money(pv.workValue, c);
        $("pv_amort").textContent = `− ${money(pv.amort, c)}`;
        $("inv_grossLabel").innerHTML = `${showAmort ? "Valor dos trabalhos (ilíquido)" : kind() === "ADIANTAMENTO" ? "Valor do adiantamento (ilíquido)" : "Valor ilíquido"} <span class="inv-req">*</span>`;
        // Aviso: valor diferente do auto de medição escolhido.
        const amBtn = amList.querySelector("[data-am].active");
        const amTotal = Number(amBtn?.dataset.total || 0);
        const amWarn = $("inv_amWarning");
        const diff = round2(pv.workValue - amTotal);
        amWarn.hidden = !(amBtn && amBtn.dataset.am && amTotal > 0 && Math.abs(diff) > 0.5);
        if (!amWarn.hidden) {
          amWarn.textContent = `O valor difere do auto ${amBtn.querySelector("strong")?.textContent || ""} (${money(amTotal, c)}) em ${diff > 0 ? "+" : "−"}${money(Math.abs(diff), c)}. Confirme se foi combinado com o cliente.`;
        }
        $("pv_gross").textContent = money(pv.gross, c);
        $("pv_vat").textContent = `+ ${money(pv.vat, c)}`;
        $("pv_cativoRow").hidden = !(pv.cativoPct > 0);
        $("pv_cativo").textContent = `− ${money(pv.vatCativo, c)}`;
        $("inv_vatCativo_amount").textContent = pv.cativoPct > 0 ? `− ${money(pv.vatCativo, c)}` : "—";
        $("pv_withholding").textContent = `− ${money(pv.withholding, c)}`;
        $("pv_car").textContent = `− ${money(pv.car, c)}`;
        $("pv_guarantee").textContent = `− ${money(pv.guarantee, c)}`;
        $("pv_net").textContent = money(pv.net, c);
        $("inv_withholding_amount").textContent = `− ${money(pv.withholding, c)}`;
        $("inv_vat_amount").textContent = `+ ${money(pv.vat, c)}`;
        $("inv_car_amount").textContent = `− ${money(pv.car, c)}`;
        $("inv_guarantee_amount").textContent = `− ${money(pv.guarantee, c)}`;
        $("inv_grossCur").textContent = c;

        // % da obra: o que já foi faturado + esta fatura sobre a venda prevista.
        const sale = Number(currentProject?.saleBudget ?? currentProject?.budgetTotal) || 0;
        const already = Math.max((Number(currentProject?.alreadyBilled) || 0) - (isEdit ? Number(invoice.grossAmount) || 0 : 0), 0);
        const warning = $("pv_warning");
        if (sale > 0) {
          const alreadyPct = (already / sale) * 100;
          const thisPct = (pv.gross / sale) * 100;
          $("pv_work").textContent = `${thisPct.toFixed(2)}%`;
          $("pv_workBar").innerHTML = meterHtml([
            { value: alreadyPct, tone: "blue" },
            { value: thisPct, tone: "violet" },
          ]);
          $("pv_workNote").innerHTML = `
            <span class="ov-legend"><i class="ov-dot ov-dot--blue"></i>Já faturado ${esc(alreadyPct.toFixed(1))}%</span>
            <span class="ov-legend"><i class="ov-dot ov-dot--violet"></i>Esta fatura</span>
            <span class="ov-legend">Venda prevista ${esc(compact(sale))}</span>`;
          const over = already + pv.gross - sale;
          warning.hidden = over <= 0.005;
          if (over > 0.005) warning.textContent = `Com esta fatura o faturado excede a venda prevista em ${money(over, c)}.`;
        } else {
          $("pv_work").textContent = "—";
          $("pv_workBar").innerHTML = "";
          $("pv_workNote").textContent = currentProject
            ? "Esta obra não tem venda prevista: a % da obra não é calculada."
            : "Escolha a obra para comparar com a venda prevista.";
          warning.hidden = true;
        }
        refreshReceipt();
      };

      rcvChoice?.querySelectorAll(".finance-choice").forEach((btn) => {
        btn.addEventListener("click", () => {
          rcvMode = btn.dataset.mode;
          if (rcvMode === "aberto" && rcvAmount) rcvAmount.value = "";
          // Ao escolher «Já recebi», sugere o líquido (o utilizador pode alterar ou apagar).
          if (rcvMode === "recebido" && rcvAmount && !readMoney(rcvAmount)) {
            const net = draftPreview().net;
            if (net > 0) setMoney(rcvAmount, Math.round(net * 100) / 100);
          }
          refreshPreview();
          if (rcvMode === "recebido") rcvAmount?.focus();
        });
      });

      // Escrever um valor também passa a opção para «Já recebi do cliente».
      rcvAmount?.addEventListener("input", () => {
        if (readMoney(rcvAmount) > 0 && rcvMode !== "recebido") rcvMode = "recebido";
        refreshReceipt();
      });

      const applyBillingConfig = (cfg) => {
        if (cfg.billingVatPercent !== null && cfg.billingVatPercent !== undefined) $("inv_vat").value = Number(cfg.billingVatPercent);
        if (cfg.billingWithholdingPercent !== null && cfg.billingWithholdingPercent !== undefined) $("inv_withholding").value = Number(cfg.billingWithholdingPercent);
        if (cfg.billingCarPercent !== null && cfg.billingCarPercent !== undefined) $("inv_car").value = Number(cfg.billingCarPercent);
        if (cfg.billingGuaranteePercent !== null && cfg.billingGuaranteePercent !== undefined) $("inv_guarantee").value = Number(cfg.billingGuaranteePercent);
        const cativo =
          cfg.billingVatCativoPercent !== null && cfg.billingVatCativoPercent !== undefined
            ? Number(cfg.billingVatCativoPercent)
            : cfg.billingVatCativo
              ? 100
              : 0;
        $("inv_vatCativo").value = String([0, 50, 100].includes(cativo) ? cativo : 0);
      };

      const renderContext = () => {
        const ctx = $("inv_context");
        if (!currentProject || currentProject.saleBudget === undefined) {
          ctx.hidden = true;
          return;
        }
        const c = cur();
        const hasSale = Number(currentProject.saleBudget) > 0;
        ctx.hidden = false;
        ctx.innerHTML = `
          <div><span>Venda prevista</span><strong class="${hasSale ? "" : "ov-warn"}">${hasSale ? esc(money(currentProject.saleBudget, c)) : "Sem venda prevista"}</strong></div>
          <div><span>Já faturado</span><strong>${esc(money(currentProject.alreadyBilled, c))}</strong></div>
          <div><span>Por faturar</span><strong class="ov-warn">${hasSale ? esc(money(currentProject.toInvoice, c)) : "—"}</strong></div>
          ${Number(currentProject.advanceOutstanding) > 0 ? `<div><span>Adiantamento por amortizar</span><strong class="ov-warn">${esc(money(currentProject.advanceOutstanding, c))}</strong></div>` : ""}`;
      };

      const selectAm = (id) => {
        amHidden.value = id || "";
        amList.querySelectorAll("[data-am]").forEach((el) => el.classList.toggle("active", el.dataset.am === (id || "")));
      };

      const renderAmList = (reports) => {
        if (!reports.length) {
          amList.innerHTML = `<p class="inv-am-empty">Esta obra não tem autos de medição aprovados por faturar. A fatura fica sem AM associado.</p>`;
          amHidden.value = "";
          return;
        }
        amList.innerHTML = [
          `<button type="button" class="inv-am" data-am="">
             <span class="material-symbols-outlined">remove</span>
             <span class="inv-am-text"><strong>Sem AM</strong><small>Fatura avulsa</small></span>
           </button>`,
          ...reports.map(
            (r) => `
            <button type="button" class="inv-am" data-am="${esc(r.id)}" data-total="${Number(r.periodValTotal) || 0}">
              <span class="material-symbols-outlined">fact_check</span>
              <span class="inv-am-text">
                <strong>${esc(r.reportNumber || "AM")}</strong>
                <small>${esc(formatDateOnly(r.reportDate))}</small>
              </span>
              <span class="inv-am-value">${esc(money(r.periodValTotal, cur()))}</span>
            </button>`
          ),
        ].join("");
        amList.querySelectorAll("[data-am]").forEach((btn) => {
          btn.addEventListener("click", () => {
            selectAm(btn.dataset.am);
            const total = Number(btn.dataset.total || 0);
            if (total > 0) setMoney($("inv_gross"), total);
            refreshPreview();
          });
        });
        selectAm("");
      };

      const loadProjectContext = async () => {
        const id = projectSel.value || invoice?.projectId;
        currentProject = projectById(id);
        $("inv_client").value = currentProject?.clientName || invoice?.client?.name || "";
        $("inv_currency").value = cur();
        if (!id) {
          if (!isEdit) {
            amList.innerHTML = `<p class="inv-am-empty">Escolha a obra para ver os autos de medição aprovados por faturar.</p>`;
          }
          renderContext();
          refreshPreview();
          return;
        }
        try {
          const [billing, open] = await Promise.all([
            apiRequest(`/finance/projects/${id}/billing`),
            isEdit ? Promise.resolve(null) : apiRequest(`/finance/projects/${id}/open-measurements`),
          ]);
          if (!isEdit) applyBillingConfig(billing.project || {});
          currentProject = { ...(currentProject || {}), ...(billing.project || {}) };
          if (billing.project?.client?.name) $("inv_client").value = billing.project.client.name;
          if (!$("inv_client").value) $("inv_client").placeholder = "Obra sem cliente associado";
          if (open) renderAmList(open.items || []);
        } catch (err) {
          toast(err.message || "Falha ao carregar dados da obra.", { type: "error" });
        }
        renderContext();
        refreshPreview();
      };

      // Tipo de documento (só ao criar).
      $("inv_kindChoice")?.querySelectorAll("[data-kind]").forEach((btn) =>
        btn.addEventListener("click", () => {
          $("inv_kind").value = btn.dataset.kind;
          $("inv_kindChoice").querySelectorAll("[data-kind]").forEach((b) => b.classList.toggle("active", b === btn));
          const advance = btn.dataset.kind === "ADIANTAMENTO";
          $("inv_amField").hidden = advance;
          if (advance) {
            selectAm("");
            // O adiantamento normalmente não tem garantia de boa execução.
            $("inv_guarantee").value = 0;
            setMoney($("inv_amort"), 0);
          } else if (currentProject?.billingGuaranteePercent !== null && currentProject?.billingGuaranteePercent !== undefined) {
            $("inv_guarantee").value = Number(currentProject.billingGuaranteePercent);
          }
          refreshPreview();
        })
      );

      // Amortização: atalhos.
      $("inv_amortQuick").querySelectorAll("[data-amort]").forEach((btn) =>
        btn.addEventListener("click", () => {
          const work = readMoney($("inv_gross")) || 0;
          const available = advanceAvailable();
          let value = 0;
          if (btn.dataset.amort === "all") value = Math.min(available, work);
          if (btn.dataset.amort === "prop") {
            // Proporcional: % do adiantamento sobre a venda prevista, aplicada ao valor dos trabalhos.
            const sale = Number(currentProject?.saleBudget) || 0;
            const advRatio = sale > 0 ? (Number(currentProject?.advancesBilled) || 0) / sale : 0;
            value = Math.min(round2(work * advRatio), available, work);
          }
          setMoney($("inv_amort"), value);
          refreshPreview();
        })
      );
      $("inv_amort").addEventListener("input", refreshPreview);

      // Pré-enche os campos com a fatura existente (modo edição).
      if (isEdit) {
        setMoney($("inv_gross"), num(invoice.workValue) || num(invoice.grossAmount));
        $("inv_withholding").value = pctValue(invoice.withholdingAmount, invoice.grossAmount);
        $("inv_vat").value = pctValue(invoice.vatAmount, invoice.grossAmount);
        $("inv_car").value = pctValue(invoice.carInsuranceAmount, invoice.grossAmount);
        $("inv_guarantee").value = pctValue(invoice.guaranteeAmount, invoice.grossAmount);
      }

      projectSel.addEventListener("change", loadProjectContext);
      ["inv_gross", "inv_vat", "inv_withholding", "inv_car", "inv_guarantee"].forEach((id) =>
        $(id).addEventListener("input", refreshPreview)
      );
      $("inv_vatCativo").addEventListener("change", refreshPreview);

      $("inv_dueQuick").querySelectorAll("[data-days]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const base = $("inv_docDate").value || today;
          $("inv_dueDate").value = addDays(base, Number(btn.dataset.days));
        });
      });

      $("inv_saveConfig").addEventListener("click", async (e) => {
        const id = projectSel.value || invoice?.projectId;
        if (!id) return toast("Escolha a obra primeiro.", { type: "error" });
        const btn = e.currentTarget;
        setButtonLoading(btn, true);
        try {
          await apiRequest(`/finance/projects/${id}/billing`, {
            method: "PATCH",
            body: {
              billingVatCativoPercent: Number($("inv_vatCativo").value) || 0,
              billingVatPercent: numOrNull($("inv_vat").value),
              billingWithholdingPercent: numOrNull($("inv_withholding").value),
              billingCarPercent: numOrNull($("inv_car").value),
              billingGuaranteePercent: numOrNull($("inv_guarantee").value),
            },
          });
          toast("Configuração de faturação guardada na obra.", { type: "success" });
        } catch (err) {
          toast(err.message || "Falha ao guardar configuração.", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
        }
      });

      // ── Fatura física: escolha do ficheiro e leitura com IA ──
      const docFileInput = $("inv_docFileInput");
      const docFileName = $("inv_docFile");
      const docNote = $("inv_docNote");
      const scanBtn = $("inv_scanBtn");
      const scanPanel = $("inv_scanPanel");

      const setScanState = (mode, html) => {
        if (scanPanel) {
          scanPanel.classList.toggle("finance-scan--ready", mode === "ready");
          scanPanel.classList.toggle("finance-scan--busy", mode === "busy");
        }
        if (html !== undefined && docNote) docNote.innerHTML = html;
      };

      $("inv_pickBtn")?.addEventListener("click", () => docFileInput?.click());

      if (docFileInput) {
        scanBtn.disabled = !aiReady;
        docFileInput.addEventListener("change", () => {
          const file = docFileInput.files?.[0] || null;
          scanBtn.disabled = !file || !aiReady;
          if (docFileName) {
            docFileName.textContent = file
              ? `${file.name} · ${Math.max(1, Math.round((file.size || 0) / 1024))} KB`
              : "PDF ou fotografia";
          }
          if (file) {
            setScanState(
              aiReady ? "ready" : "idle",
              aiReady
                ? `<span class="material-symbols-outlined">task_alt</span>Ficheiro pronto. Use «Ler com IA» para preencher os campos automaticamente.`
                : `<span class="material-symbols-outlined">info</span>Leitura automática indisponível (falta GEMINI_API_KEY). O ficheiro é anexado ao guardar.`
            );
          }
        });
      }

      scanBtn?.addEventListener("click", async () => {
        const file = docFileInput?.files?.[0];
        if (!file) return toast("Escolha primeiro o PDF ou a fotografia da fatura.", { type: "error" });
        setButtonLoading(scanBtn, true);
        setScanState(
          "busy",
          `<span class="material-symbols-outlined">hourglass_top</span>A ler a fatura com IA… os campos lidos são sugeridos e devem ser confirmados.`
        );
        try {
          const { fields, warnings } = await scanInvoiceFile(file);

          // Só preenche o que ainda está vazio (ou o que veio do próprio scan),
          // para não apagar valores que o financeiro já tenha escrito à mão.
          const fill = (id, value, { onlyEmpty = true } = {}) => {
            const el = $(id);
            if (!el) return;
            const isEmpty =
              value === null ||
              value === undefined ||
              value === "" ||
              (typeof value === "number" && !Number.isFinite(value));
            if (isEmpty) return;
            if (onlyEmpty && String(el.value ?? "").trim()) return;
            el.value = typeof value === "number" ? String(value) : value;
          };

          fill("inv_docNumber", fields.docNumber);
          fill("inv_docDate", fields.docDate, { onlyEmpty: isEdit });
          fill("inv_dueDate", fields.dueDate);
          fill("inv_gross", Number(fields.grossAmount) > 0 ? fields.grossAmount : null, { onlyEmpty: isEdit });
          fill("inv_vat", fields.vatPercent ?? pctValue(fields.vatAmount, fields.grossAmount));
          fill(
            "inv_withholding",
            fields.withholdingPercent ?? pctValue(fields.withholdingAmount, fields.grossAmount)
          );
          fill("inv_car", pctValue(fields.carInsuranceAmount, fields.grossAmount));
          fill("inv_guarantee", pctValue(fields.guaranteeAmount, fields.grossAmount));
          // IVA cativo: só existe 0 / 50 / 100 % (do IVA).
          const cativoRead = fields.vatCativoPercent ?? pctValue(fields.vatCativoAmount, fields.vatAmount);
          if (Number(cativoRead) > 0 && $("inv_vatCativo")) {
            const snapped = [50, 100].reduce((best, v) => (Math.abs(v - cativoRead) < Math.abs(best - cativoRead) ? v : best), 50);
            $("inv_vatCativo").value = String(snapped);
          }
          fill("inv_notes", fields.notes || fields.description, { onlyEmpty: false });
          // O valor lido entra como número simples: mostra-o formatado.
          if ($("inv_gross").value) setMoney($("inv_gross"), readMoney($("inv_gross")));

          if (fields.suggestedProjectId && !projectSel.disabled && fields.suggestedProjectId !== projectSel.value) {
            projectSel.value = fields.suggestedProjectId;
            await loadProjectContext();
          }

          refreshPreview();
          // Guarda a origem da leitura para ficar ligada à fatura criada.
          lastScan = { source: "IA", model: fields.model || null, raw: fields.raw || null };
          const scanSummary = buildScanSummary(fields, warnings);
          setScanState("ready", `<span class="material-symbols-outlined">task_alt</span>${esc(scanSummary)}`);
          toast("Fatura lida. Confirme os valores antes de guardar.", { type: "success" });
          // The AGT portal can be slow, so its lookup runs after the form fields
          // have been populated and does not keep the scan button spinning.
          void lookupScannedInvoiceNif(fields, docNote, scanSummary);
        } catch (err) {
          setScanState(
            "idle",
            `<span class="material-symbols-outlined">error</span>${esc(err.message || "Falha ao ler a fatura.")}`
          );
          toast(err.message || "Falha ao ler a fatura.", { type: "error" });
        } finally {
          setButtonLoading(scanBtn, false);
          if (scanBtn && !docFileInput?.files?.length) scanBtn.disabled = true;
          else if (scanBtn) scanBtn.disabled = !aiReady;
        }
      });

      $("inv_viewDoc")?.addEventListener("click", () =>
        openInvoiceDocumentModal(invoice, { context: { projectName: invoice?.project?.name } })
      );

      $("inv_removeDoc")?.addEventListener("click", async (e) => {
        if (!window.confirm("Remover a fatura física anexada a esta fatura?")) return;
        const btn = e.currentTarget;
        setButtonLoading(btn, true);
        try {
          await apiRequest(`/finance/invoices/${invoice.id}/document`, { method: "DELETE" });
          toast("Documento removido.", { type: "success" });
          btn.hidden = true;
          const viewBtn = $("inv_viewDoc");
          if (viewBtn) viewBtn.hidden = true;
          docFileName.textContent = "PDF ou fotografia";
          docNote.textContent = "Sem fatura física anexada.";
        } catch (err) {
          toast(err.message || "Falha ao remover o documento.", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
        }
      });

      if (projectSel.value || isEdit) loadProjectContext();
      else refreshPreview();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const raw = {
        docNumber: $("inv_docNumber").value.trim() || null,
        docDate: $("inv_docDate").value,
        // Sem vencimento indicado, aplica-se o prazo padrão de 30 dias.
        dueDate: $("inv_dueDate").value || ($("inv_docDate").value ? addDays($("inv_docDate").value, 30) || null : null),
        grossAmount: readMoney($("inv_gross")),
        advanceDeductionAmount: $("inv_amortRow").hidden ? (isEdit && num(invoice.advanceDeductionAmount) > 0 ? 0 : null) : readMoney($("inv_amort")) || 0,
        vatPercent: numOrNull($("inv_vat").value),
        withholdingPercent: numOrNull($("inv_withholding").value),
        carPercent: numOrNull($("inv_car").value),
        guaranteePercent: numOrNull($("inv_guarantee").value),
        vatCativoPercent: Number($("inv_vatCativo").value) || 0,
        notes: $("inv_notes").value.trim() || null,
      };
      const today = toDateKey(new Date());
      if (!isEdit && !$("inv_project").value) {
        $("inv_project").focus();
        return toast("Selecione a obra.", { type: "error" });
      }
      if (!raw.docDate) {
        $("inv_docDate").focus();
        return toast("Indique a data da fatura.", { type: "error" });
      }
      if (raw.docDate > today) {
        $("inv_docDate").focus();
        return toast("A data da fatura não pode ser futura.", { type: "error" });
      }
      if (!raw.grossAmount || raw.grossAmount <= 0) {
        $("inv_gross").focus();
        return toast("Indique o valor ilíquido.", { type: "error" });
      }
      if (raw.advanceDeductionAmount > 0) {
        if (raw.advanceDeductionAmount >= raw.grossAmount) {
          $("inv_amort").focus();
          return toast("A amortização tem de ser menor do que o valor dos trabalhos.", { type: "error" });
        }
      }
      if (raw.dueDate && raw.docDate && raw.dueDate < raw.docDate) {
        $("inv_dueDate").focus();
        return toast("O vencimento não pode ser anterior à data do documento.", { type: "error" });
      }

      const percentageFields = [
        ["vatPercent", "inv_vat", "IVA"],
        ["withholdingPercent", "inv_withholding", "retenção na fonte"],
        ["carPercent", "inv_car", "Seguro CAR"],
        ["guaranteePercent", "inv_guarantee", "garantia"],
      ];
      const invalidPercent = percentageFields.find(([key]) =>
        raw[key] !== null && (raw[key] < 0 || raw[key] > 100)
      );
      if (invalidPercent) {
        const [key, inputId, label] = invalidPercent;
        $(inputId)?.focus();
        toast(
          `${label}: indique uma percentagem entre 0% e 100% (valor atual: ${raw[key]}%). Se pretendia indicar um valor em dinheiro, converta-o para percentagem do V. Ilíquido.`,
          { type: "error" }
        );
        return;
      }

      // Sem a opção «Já recebi», a fatura fica em aberto (nada entrou no caixa).
      const receiving =
        !isEdit && $("rcv_choice")?.querySelector(".finance-choice.active")?.dataset.mode === "recebido";
      const receivedAmount = receiving ? readMoney($("inv_received")) || 0 : 0;
      if (receiving) {
        const preview = buildPreview({ ...raw, saleBudget: 0 });
        const receivedDate = $("inv_receivedDate").value;
        if (receivedAmount <= 0) {
          $("inv_received").focus();
          return toast("Indique o valor recebido, ou escolha «Fica em aberto».", { type: "error" });
        }
        if (receivedAmount > preview.net + 0.005) {
          $("inv_received").focus();
          return toast(`O valor recebido não pode ser maior do que o líquido da fatura (${money(preview.net)}).`, { type: "error" });
        }
        if (!receivedDate) {
          $("inv_receivedDate").focus();
          return toast("Indique a data do recebimento.", { type: "error" });
        }
        if (receivedDate < raw.docDate || receivedDate > today) {
          $("inv_receivedDate").focus();
          return toast("A data do recebimento tem de estar entre a data da fatura e hoje.", { type: "error" });
        }
      }

      setButtonLoading(btn, true);
      try {
        const file = $("inv_docFileInput")?.files?.[0] || null;
        let targetId = invoice?.id || null;
        let result = null;

        if (isEdit) {
          result = await apiRequest(`/finance/invoices/${invoice.id}`, { method: "PATCH", body: raw });
          toast("Fatura actualizada.", { type: "success" });
        } else {
          const projectId = $("inv_project").value;
          result = await apiRequest("/finance/invoices", {
            method: "POST",
            body: {
              ...raw,
              kind: $("inv_kind").value || "FATURA",
              projectId,
              measurementId: $("inv_measurement").value || null,
              receivedAmount,
              receivedDate: receivedAmount > 0 ? $("inv_receivedDate").value || null : null,
              receivedMethod: receivedAmount > 0 ? $("inv_receivedMethod").value || null : null,
              scanSource: lastScan?.source || null,
              scanModel: lastScan?.model || null,
              scanRaw: lastScan?.raw || null,
            },
          });
          targetId = result?.invoice?.id || null;
          toast("Fatura registada.", { type: "success" });
        }
        (result?.warnings || []).forEach((w) => toast(w.message, { type: "info", timeoutMs: 7000 }));

        // Anexa a fatura física escolhida (PDF/fotografia).
        if (file && targetId) {
          try {
            await apiUpload(`/finance/invoices/${targetId}/document`, { file, fieldName: "file" });
          } catch (err) {
            toast(`Fatura guardada, mas o ficheiro não foi anexado: ${err.message}`, { type: "error" });
          }
        }

        close();
        await loadInvoices();
      } catch (err) {
        toast(err.message || "Falha ao guardar a fatura.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

function numOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value) {
  return numOr(value, null);
}

/** Percentagem implícita (valor / base × 100) para pré-encher em edição. */
function pctValue(amount, base) {
  const a = Number(amount) || 0;
  const b = Number(base) || 0;
  if (b <= 0) return "";
  return Math.round((a / b) * 10000) / 100;
}

/* ─── Recebimento ─────────────────────────────────────────────────────────── */

/* ─── Eliminar ────────────────────────────────────────────────────────────── */

async function removeInvoice(invoice) {
  const label = invoice.docNumber || invoice.project?.name || "esta fatura";
  if (!window.confirm(`Eliminar a fatura ${label}? Esta ação não pode ser revertida.`)) return;
  try {
    await apiRequest(`/finance/invoices/${invoice.id}`, { method: "DELETE" });
    toast("Fatura eliminada.", { type: "success" });
    await loadInvoices();
  } catch (err) {
    toast(err.message || "Falha ao eliminar fatura.", { type: "error" });
  }
}

/* ─── Entrada ─────────────────────────────────────────────────────────────── */

async function loadAiStatus() {
  try {
    const ai = await apiRequest("/finance/ai-status");
    state.ai = { configured: Boolean(ai?.configured), model: ai?.model || null, loaded: true };
  } catch {
    state.ai = { configured: false, model: null, loaded: true };
  }
}

export async function render() {
  state.expanded = new Set();
  const params = new URLSearchParams(window.location.search);
  if (params.get("projectId")) state.filters.projectId = params.get("projectId");
  if (params.get("clientId")) state.filters.clientId = params.get("clientId");
  try {
    await Promise.all([loadOptions(), loadAiStatus()]);
  } catch (err) {
    toast(err.message || "Falha ao carregar obras e clientes.", { type: "error" });
  }
  renderShell();
  await loadInvoices();
}
