import { apiRequest } from "../../services/api.js";
import { openModal, setButtonLoading, toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawBarChart, drawComboChart, destroyCharts, TONES } from "./charts.js";
import { agingBuckets, agingPanelHtml, agingSeries } from "./aging.js";
import { kpiCardsHtml, meterHtml, num, skeletonHtml, stripHtml } from "./widgets.js";
import { openReceiptModal } from "./receiptModal.js";

/**
 * Ecrã «Recebimentos» (Financeiro · Contas a Receber e a Pagar).
 *
 * Faturas emitidas com valor líquido em falta, pela data de vencimento (sem
 * vencimento conta a data do documento + 30 dias, marcado como estimado; sem
 * cliente na fatura vale o da obra). Serve para cobrar:
 * o que está vencido, o que vence a seguir, quem deve mais e quanto tempo os
 * clientes levam a pagar (prazo médio de recebimento).
 */

const VIEWS = {
  all: { label: "Por receber", test: () => true },
  overdue: { label: "Vencidas", test: (i) => i.daysLate > 0 },
  week: { label: "Vencem em 7 dias", test: (i) => i.daysLate !== null && i.daysLate <= 0 && i.daysLate >= -7 },
  month: { label: "Vencem em 30 dias", test: (i) => i.daysLate !== null && i.daysLate <= 0 && i.daysLate >= -30 },
  noDue: { label: "A completar", test: (i) => i.noDueDate || !i.client },
  partial: { label: "Recebidas em parte", test: (i) => num(i.receivedAmount) > 0 },
};

const state = { view: "all", group: "invoice", query: "", clientId: "", data: null, expanded: new Set() };

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function canEdit() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

/** Chip de prazo: vencida há N dias, vence hoje / em N dias (e «estimado» sem data registada). */
export function dueChip(days, { estimated = false } = {}) {
  const est = estimated
    ? `<span class="inv-due inv-due--est" title="Sem vencimento registado: data do documento + 30 dias">estimado</span>`
    : "";
  if (days === null || days === undefined) return est;
  if (estimated) return `<span class="inv-due-chips">${dueChip(days)}${est}</span>`;
  if (days > 0) return `<span class="inv-due inv-due--late">há ${days} d</span>`;
  if (days === 0) return `<span class="inv-due inv-due--today">hoje</span>`;
  if (days >= -7) return `<span class="inv-due inv-due--soon">em ${Math.abs(days)} d</span>`;
  return `<span class="ac-due-ok">em ${Math.abs(days)} d</span>`;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div id="rcKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>
      <div id="rcStrip" class="ov-strip">${skeletonHtml(6, "cell")}</div>

      <div class="ov-row ov-row--8-4">
        ${chartCardHtml({
          id: "rcChartMonthly",
          title: "Recebido mês a mês",
          subtitle: "Recebimentos de clientes registados nas faturas",
          height: 260,
          beforeChartHtml: `<div id="rcFlowTotals" class="ov-flow-totals"></div>`,
        })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head">
            <h2 class="finance-chart-title">Antiguidade</h2>
            <p class="finance-chart-subtitle">Em falta pela data de vencimento</p>
          </header>
          <div id="rcAging">${skeletonHtml(3, "line")}</div>
        </section>
      </div>

      <div class="ov-row ov-row--6-6">
        ${chartCardHtml({ id: "rcChartClients", title: "Quem deve mais", subtitle: "Em falta por cliente · vencido e a vencer", height: 260 })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head finance-chart-head--row">
            <div>
              <h2 class="finance-chart-title">Últimos recebimentos</h2>
              <p class="finance-chart-subtitle">Entradas registadas nas faturas</p>
            </div>
            <a class="ov-link" href="/Financeiro/faturacao/registar">Faturas <span class="material-symbols-outlined">arrow_forward</span></a>
          </header>
          <div id="rcRecent">${skeletonHtml(4, "line")}</div>
        </section>
      </div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title" id="rcTitle">Por receber</h2>
            <p class="finance-chart-subtitle" id="rcHint">—</p>
          </div>
          <div class="ov-table-tools">
            <div class="finance-seg finance-seg--sm" id="rcGroup">
              <button type="button" data-group="invoice" class="active"><span class="material-symbols-outlined">receipt_long</span>Por fatura</button>
              <button type="button" data-group="client"><span class="material-symbols-outlined">groups</span>Por cliente</button>
            </div>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="rcSearch" type="search" placeholder="Nº fatura, cliente ou obra…" autocomplete="off" />
            </label>
            <select id="rcClient" class="finance-select inv-filter" title="Cliente"><option value="">Todos os clientes</option></select>
          </div>
        </header>
        <div id="rcTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  document.querySelectorAll("#rcGroup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.group = btn.dataset.group;
      document.querySelectorAll("#rcGroup button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });
  document.getElementById("rcClient").addEventListener("change", (e) => {
    state.clientId = e.target.value;
    renderTable();
  });
  let timer = null;
  document.getElementById("rcSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      renderTable();
    }, 150);
  });
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis() {
  const t = state.data?.totals || {};
  const items = state.data?.items || [];
  const total = num(t.receivable);
  const overduePct = total > 0 ? (num(t.overdue) / total) * 100 : 0;
  const overdueItems = items.filter((i) => i.daysLate > 0);
  const maxLate = overdueItems.reduce((a, i) => Math.max(a, i.daysLate), 0);
  const cards = [
    {
      key: "receivable",
      label: "Por receber",
      icon: "south_west",
      tone: "blue",
      value: money(total),
      badge: `${items.length} fatura${items.length === 1 ? "" : "s"}`,
      badgeTone: "blue",
      body: `
        ${meterHtml([{ value: overduePct, tone: "red" }, { value: 100 - overduePct, tone: "emerald" }])}
        <p class="ov-kpi-compare">
          <span class="ov-legend"><i class="ov-dot ov-dot--red"></i>Vencido</span>
          <span class="ov-legend" style="margin-left:0.6rem"><i class="ov-dot ov-dot--emerald"></i>A vencer</span>
        </p>`,
    },
    {
      key: "overdue",
      label: "Vencido",
      icon: "warning",
      tone: num(t.overdue) > 0 ? "red" : "emerald",
      value: money(t.overdue),
      badge: pct(overduePct),
      badgeTone: num(t.overdue) > 0 ? "red" : "emerald",
      body: `<p class="ov-kpi-compare">${
        overdueItems.length
          ? `<strong>${overdueItems.length}</strong> fatura${overdueItems.length === 1 ? "" : "s"} · maior atraso <strong class="ov-neg">${maxLate} dias</strong>`
          : "Nenhuma fatura vencida."
      }</p>`,
    },
    {
      key: "next30",
      label: "Vence em 30 dias",
      icon: "event_upcoming",
      tone: "amber",
      value: money(t.next30),
      badge: total > 0 ? pct((num(t.next30) / total) * 100) : "—",
      badgeTone: "amber",
      body: `<p class="ov-kpi-compare">${
        num(t.noDueDate) > 0 ? `<span class="ov-warn">${esc(compact(t.noDueDate))} com vencimento estimado</span>` : "Entradas previstas no próximo mês."
      }</p>`,
    },
    {
      key: "received",
      label: "Recebido · 30 dias",
      icon: "savings",
      tone: "emerald",
      value: money(t.received30),
      badge: t.dso === null || t.dso === undefined ? "sem histórico" : `prazo médio ${t.dso} d`,
      badgeTone: "emerald",
      body: `<p class="ov-kpi-compare">Dias, em média, entre a fatura e o recebimento.</p>`,
    },
  ];
  document.getElementById("rcKpis").innerHTML = kpiCardsHtml(cards, "rc");
}

function renderStrip() {
  const items = state.data?.items || [];
  const sumOf = (key) => items.filter(VIEWS[key].test).reduce((a, i) => a + num(i.missingAmount), 0);
  const countOf = (key) => items.filter(VIEWS[key].test).length;
  const cell = (key, icon, tone) => ({
    label: VIEWS[key].label,
    icon,
    value: compact(sumOf(key)),
    valueTone: tone && countOf(key) ? tone : null,
    sub: `${countOf(key)} fatura${countOf(key) === 1 ? "" : "s"}`,
    action: key,
    active: state.view === key,
  });
  const wrap = document.getElementById("rcStrip");
  wrap.innerHTML = stripHtml([
    cell("all", "list_alt"),
    cell("overdue", "warning", "neg"),
    cell("week", "today", "warn"),
    cell("month", "date_range"),
    cell("noDue", "edit_note", "warn"),
    cell("partial", "incomplete_circle"),
  ]);
  wrap.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = state.view === btn.dataset.action ? "all" : btn.dataset.action;
      renderStrip();
      renderTable();
    });
  });
}

/* ─── Gráficos e painéis ──────────────────────────────────────────────────── */

async function emptyChart(id, icon, message) {
  await drawBarChart(id, {});
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">${icon}</span>${esc(message)}</div>`;
}

function clientRows() {
  const map = new Map();
  (state.data?.items || []).forEach((i) => {
    const key = i.client?.id || "__none__";
    if (!map.has(key)) map.set(key, { key, name: i.client?.name || "Sem cliente", items: [], missing: 0, overdue: 0, maxLate: 0 });
    const c = map.get(key);
    c.items.push(i);
    c.missing += num(i.missingAmount);
    if (i.daysLate > 0) {
      c.overdue += num(i.missingAmount);
      c.maxLate = Math.max(c.maxLate, i.daysLate);
    }
  });
  return [...map.values()].sort((a, b) => b.missing - a.missing);
}

function renderCharts() {
  const monthly = state.data?.monthly || [];
  const received = monthly.reduce((a, m) => a + num(m.received), 0);
  const active = monthly.filter((m) => num(m.received) > 0).length;
  document.getElementById("rcFlowTotals").innerHTML = [
    { label: "Recebido em 12 meses", value: compact(received), dot: TONES.emerald },
    { label: "Média por mês", value: compact(received / Math.max(monthly.length, 1)), dot: TONES.slate },
    { label: "Meses com entradas", value: `${active}/${monthly.length}`, dot: TONES.blue },
  ]
    .map((t) => `<div class="ov-flow-total"><span><i style="background:${t.dot}"></i>${esc(t.label)}</span><strong>${esc(t.value)}</strong></div>`)
    .join("");
  drawComboChart("rcChartMonthly", {
    categories: monthly.map((m) => m.label),
    series: [{ name: "Recebido", type: "column", data: monthly.map((m) => num(m.received)), color: TONES.emerald }],
    height: 260,
  });

  document.getElementById("rcAging").innerHTML = agingPanelHtml(
    agingSeries(agingBuckets(state.data?.items || [], { amountKey: "missingAmount", dateKey: "effectiveDue" })),
    { caption: "em falta de clientes", formatMoney: money, formatCompact: compact, escape: esc, emptyText: "Sem faturas por receber." }
  );

  const top = clientRows().slice(0, 8);
  if (!top.length) {
    emptyChart("rcChartClients", "groups", "Nenhum cliente com valores em falta.");
  } else {
    drawBarChart("rcChartClients", {
      categories: top.map((c) => (c.name.length > 30 ? `${c.name.slice(0, 28)}…` : c.name)),
      series: [
        { name: "Vencido", data: top.map((c) => c.overdue), color: TONES.red },
        { name: "A vencer", data: top.map((c) => c.missing - c.overdue), color: "#6ee7b7" },
      ],
      stacked: true,
      horizontal: true,
      height: Math.max(200, top.length * 44 + 80),
    });
  }

  const recent = state.data?.recentReceipts || [];
  document.getElementById("rcRecent").innerHTML = recent.length
    ? `<ul class="ac-feed">
        ${recent
          .map(
            (r) => `
          <li>
            <span class="ac-feed-icon ac-feed-icon--in"><span class="material-symbols-outlined">south_west</span></span>
            <div>
              <strong>${esc(r.invoice?.docNumber ? `Fatura ${r.invoice.docNumber}` : "Fatura")}</strong>
              <small>${esc([r.invoice?.client?.name, r.invoice?.project?.name, r.method].filter(Boolean).join(" · "))}</small>
            </div>
            <div class="ac-feed-value">
              <strong class="ov-pos">+ ${esc(compact(r.amount))}</strong>
              <small>${esc(dateOnly(r.receivedDate))}</small>
            </div>
          </li>`
          )
          .join("")}
      </ul>`
    : `<div class="ov-empty"><span class="material-symbols-outlined">savings</span>Ainda não há recebimentos registados.</div>`;
}

/* ─── Completar fatura (cliente e vencimento) ─────────────────────────────── */

let clientOptions = null;

async function openCompleteModal(invoice) {
  if (!clientOptions) {
    try {
      clientOptions = (await apiRequest("/finance/options/clients")).items || [];
    } catch {
      clientOptions = [];
    }
  }
  const docKey = toDateKey(invoice.docDate);
  const plusDays = (days) => {
    const [y, m, d] = docKey.split("-").map(Number);
    return toDateKey(new Date(Date.UTC(y, m - 1, d + days)));
  };
  openModal({
    title: `Completar fatura · ${invoice.docNumber || "sem nº"}`,
    width: 560,
    contentHtml: `
      <p class="pay-note"><span class="material-symbols-outlined">info</span><span>
        Sem vencimento a fatura conta como paga a 30 dias da data do documento
        (${esc(dateOnly(invoice.docDate))}). Indique o prazo acordado e o cliente para a cobrança e o cash flow ficarem certos.
      </span></p>
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field">
          <label class="finance-label" for="cmp_client">Cliente</label>
          <select id="cmp_client" class="finance-select">
            <option value="">— Sem cliente —</option>
            ${clientOptions.map((c) => `<option value="${esc(c.id)}" ${c.id === invoice.client?.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select>
          ${invoice.clientFromProject ? `<small class="pay-hint">Hoje vem da obra «${esc(invoice.project?.name || "")}».</small>` : ""}
        </div>
        <div class="finance-field">
          <label class="finance-label" for="cmp_due">Vencimento <span class="inv-req">*</span></label>
          <input id="cmp_due" class="finance-input" type="date" min="${docKey}" value="${esc(invoice.dueDate ? toDateKey(invoice.dueDate) : toDateKey(invoice.effectiveDue))}" />
          <div class="inv-quick">
            ${[0, 30, 60, 90].map((d) => `<button type="button" data-days="${d}">${d ? `+${d} dias` : "Pronto pagamento"}</button>`).join("")}
          </div>
        </div>
      </div>`,
    primaryLabel: "Guardar",
    onRender: ({ panel }) => {
      panel.querySelectorAll("[data-days]").forEach((btn) => {
        btn.addEventListener("click", () => {
          panel.querySelector("#cmp_due").value = plusDays(Number(btn.dataset.days));
        });
      });
    },
    onPrimary: async ({ btn, close, panel }) => {
      const dueDate = panel.querySelector("#cmp_due").value;
      if (!dueDate) return toast("Indique a data de vencimento.", { type: "error" });
      if (dueDate < docKey) return toast("O vencimento não pode ser anterior à data da fatura.", { type: "error" });
      const clientId = panel.querySelector("#cmp_client").value || null;
      setButtonLoading(btn, true);
      try {
        await apiRequest(`/finance/invoices/${encodeURIComponent(invoice.id)}`, {
          method: "PATCH",
          body: { dueDate, ...(clientId !== (invoice.clientFromProject ? null : invoice.client?.id || null) ? { clientId } : {}) },
        });
        toast("Fatura atualizada.", { type: "success" });
        close();
        await load();
      } catch (err) {
        toast(err.message || "Não foi possível atualizar a fatura.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return (state.data?.items || []).filter((i) => {
    if (!VIEWS[state.view].test(i)) return false;
    if (state.clientId && (i.client?.id || "") !== state.clientId) return false;
    if (!q) return true;
    return [i.docNumber, i.client?.name, i.project?.name, i.project?.code].some((v) => String(v || "").toLowerCase().includes(q));
  });
}

function renderByInvoice(wrap, items) {
  const editable = canEdit();
  const rows = items
    .map((i) => {
      const cur = i.project?.currency || "AOA";
      const receivedPct = num(i.netAmount) > 0 ? (num(i.receivedAmount) / num(i.netAmount)) * 100 : 0;
      return `
      <tr data-id="${esc(i.id)}" class="${i.daysLate > 0 ? "fin-row--overdue" : ""}">
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(i.docNumber || "Sem nº")}</span>
            <span class="ov-project-meta">${esc(dateOnly(i.docDate))}${i.measurement ? ` · ${esc(i.measurement.reportNumber || "AM")}` : ""}</span>
          </div>
        </td>
        <td>
          <div class="ov-project">
            <span class="ov-project-name ${i.client ? "" : "ov-warn"}">${esc(i.client?.name || "Sem cliente")}</span>
            <span class="ov-project-meta">${esc(i.project?.name || "—")}${i.clientFromProject ? " · cliente da obra" : ""}</span>
          </div>
        </td>
        <td><div class="inv-due-cell">${esc(dateOnly(i.effectiveDue))}${dueChip(i.daysLate, { estimated: i.noDueDate })}</div></td>
        <td class="fin-num">${esc(money(i.netAmount, cur))}</td>
        <td class="fin-num">
          <div class="ov-cell-bar">
            <span>${esc(money(i.receivedAmount, cur))}</span>
            ${meterHtml([{ value: receivedPct, tone: "emerald" }])}
          </div>
        </td>
        <td class="fin-num ${i.daysLate > 0 ? "ov-neg" : "ov-warn"}"><strong>${esc(money(i.missingAmount, cur))}</strong></td>
        <td>${
          editable
            ? `<div class="ac-actions">
                ${
                  i.noDueDate || !i.client
                    ? `<button type="button" class="cr-act cr-act--amber" data-complete title="Definir cliente e vencimento"><span class="material-symbols-outlined">edit_note</span><span>Completar</span></button>`
                    : ""
                }
                <button type="button" class="cr-act cr-act--emerald" data-receipt><span class="material-symbols-outlined">payments</span><span>Receber</span></button>
              </div>`
            : ""
        }</td>
      </tr>`;
    })
    .join("");
  const sum = (key) => items.reduce((a, i) => a + num(i[key]), 0);
  wrap.innerHTML = `
    <table class="fin-table ac-table">
      <thead><tr>
        <th>Fatura</th><th>Cliente · Obra</th><th>Vencimento</th>
        <th style="text-align:right">V. Líquido</th>
        <th style="text-align:right">Recebido</th>
        <th style="text-align:right">Em falta</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="3">Totais (${items.length} faturas)</td>
        <td class="fin-num">${esc(money(sum("netAmount")))}</td>
        <td class="fin-num">${esc(money(sum("receivedAmount")))}</td>
        <td class="fin-num">${esc(money(sum("missingAmount")))}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
  wrap.querySelectorAll("[data-complete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const invoice = items.find((i) => i.id === btn.closest("tr").dataset.id);
      if (invoice) openCompleteModal(invoice);
    });
  });
  wrap.querySelectorAll("[data-receipt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const invoice = items.find((i) => i.id === btn.closest("tr").dataset.id);
      if (invoice) openReceiptModal(invoice, { onSaved: load });
    });
  });
}

function renderByClient(wrap, items) {
  const ids = new Set(items.map((i) => i.id));
  const rows = clientRows()
    .map((c) => ({ ...c, items: c.items.filter((i) => ids.has(i.id)) }))
    .filter((c) => c.items.length);
  const total = rows.reduce((a, c) => a + c.missing, 0);
  wrap.innerHTML = `
    <table class="fin-table ac-table">
      <thead><tr>
        <th>Cliente</th>
        <th style="text-align:right">Em falta</th>
        <th style="text-align:right">Peso</th>
        <th style="text-align:right">Vencido</th>
        <th style="text-align:right">Maior atraso</th>
      </tr></thead>
      <tbody>${rows
        .map((c) => {
          const share = total > 0 ? (c.missing / total) * 100 : 0;
          const overduePct = c.missing > 0 ? (c.overdue / c.missing) * 100 : 0;
          return `
          <tr>
            <td>
              <div class="ov-project">
                <span class="ov-project-name">${esc(c.name)}</span>
                <span class="ov-project-meta">${c.items.length} fatura${c.items.length === 1 ? "" : "s"} · ${esc([...new Set(c.items.map((i) => i.project?.name).filter(Boolean))].slice(0, 2).join(", "))}</span>
              </div>
            </td>
            <td class="fin-num"><strong>${esc(money(c.missing))}</strong></td>
            <td class="fin-num"><div class="ov-cell-bar"><span>${esc(pct(share))}</span>${meterHtml([{ value: share, tone: "blue" }])}</div></td>
            <td class="fin-num"><div class="ov-cell-bar"><span class="${c.overdue > 0 ? "ov-neg" : ""}">${esc(money(c.overdue))}</span>${meterHtml([{ value: overduePct, tone: "red" }])}</div></td>
            <td class="fin-num ${c.maxLate > 0 ? "ov-neg" : "ov-muted"}">${c.maxLate > 0 ? `${c.maxLate} dias` : "—"}</td>
          </tr>`;
        })
        .join("")}</tbody>
      <tfoot><tr>
        <td>Totais (${rows.length} clientes)</td>
        <td class="fin-num">${esc(money(total))}</td>
        <td class="fin-num">100%</td>
        <td class="fin-num">${esc(money(rows.reduce((a, c) => a + c.overdue, 0)))}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

function renderTable() {
  const wrap = document.getElementById("rcTable");
  const items = visibleItems();
  document.getElementById("rcTitle").textContent = VIEWS[state.view].label;
  document.getElementById("rcHint").textContent =
    `${items.length} de ${(state.data?.items || []).length} faturas · ordenadas pelo vencimento`;
  if (!items.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">task_alt</span>${
      (state.data?.items || []).length ? "Nenhuma fatura nesta vista." : "Não há faturas por receber."
    }</div>`;
    return;
  }
  if (state.group === "client") return renderByClient(wrap, items);
  return renderByInvoice(wrap, items);
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  try {
    state.data = await apiRequest("/finance/receivables");
    const clients = clientRows().filter((c) => c.key !== "__none__");
    const sel = document.getElementById("rcClient");
    sel.innerHTML =
      `<option value="">Todos os clientes</option>` + clients.map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join("");
    sel.value = state.clientId;
    renderKpis();
    renderStrip();
    renderTable();
    renderCharts();
  } catch (err) {
    const wrap = document.getElementById("rcTable");
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar contas a receber.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  const view = new URLSearchParams(window.location.search).get("view");
  if (view && VIEWS[view]) state.view = view;
  renderShell();
  await load();
}
