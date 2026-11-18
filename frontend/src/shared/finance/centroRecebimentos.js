/**
 * R1 — Centro de Recebimentos.
 * Faturas emitidas aos clientes: o que falta receber, quando, e o que está
 * por faturar. Os recebimentos registam-se na Conciliação Bancária.
 */
import {
  apiRequest,
  apiUpload,
  toast,
  esc,
  num,
  money,
  compact,
  todayKey,
  addDays,
  endOfMonth,
  daysBetween,
  fmtDate,
  monthLabel,
  norm,
  initials,
  icon,
  pill,
  kpiCard,
  emptyState,
  skeletonRows,
  multiFilterHtml,
  openMultiFilter,
  popMenu,
  openDrawer,
  ask,
  exportXlsx,
  errMsg,
  bindShortcuts,
  pickFiles,
  fileUrl,
} from "./fin.js";
import { INVOICE_TYPES, invoiceTypeOf, invoiceTypeInfo, openInvoiceForm } from "./invoiceForm.js";
import { can } from "../permissions.js";

const STORE_KEY = "fo.r1.filters.v1";
const RECONCILE_URL = "/Financeiro/tesouraria/conciliacao-bancaria";
const STATES = [
  { v: "open", l: "Por receber" },
  { v: "late", l: "Atrasados" },
  { v: "EM_ABERTO", l: "Em aberto" },
  { v: "PAGO_PARCIAL", l: "Recebidos em parte" },
  { v: "PAGO_TOTAL", l: "Recebidos" },
  { v: "forecast", l: "Previstos" },
  { v: "cancelled", l: "Anuladas" },
  { v: "", l: "Todos" },
];
const DEFAULT_FILTERS = { q: "", types: [], clients: [], projects: [], state: "open", noPdf: false, until: "", kpi: "" };

const S = {
  items: [],
  forecast: [],
  forecastLoaded: false,
  loading: true,
  error: null,
  today: todayKey(),
  f: { ...DEFAULT_FILTERS },
  sort: { key: "due", dir: 1 },
};
let root;

// ─── estado de cada fatura ───────────────────────────────────────────────────

function statusOf(inv) {
  if (inv.forecast) return { key: "forecast", label: "Prevista", tone: "info" };
  if (inv.cancelledAt || inv.status === "ANULADA") return { key: "cancelled", label: "Anulada", tone: "bad" };
  if (inv.status === "PAGO_TOTAL") return { key: "PAGO_TOTAL", label: "Recebida", tone: "good" };
  if (inv.status === "ATRASADO") return { key: "ATRASADO", label: inv.receivedAmount > 0 ? "Atrasada · parcial" : "Atrasada", tone: "bad" };
  if (inv.status === "PAGO_PARCIAL") return { key: "PAGO_PARCIAL", label: "Recebida em parte", tone: "warn" };
  return { key: "EM_ABERTO", label: "Em aberto", tone: "neutral" };
}

const isOpenInv = (inv) => !inv.forecast && !inv.cancelledAt && inv.status !== "ANULADA" && num(inv.missingAmount) > 0.005;
const dueOf = (inv) => (inv.forecast ? null : String(inv.effectiveDueDate || inv.dueDate || "").slice(0, 10) || null);

// ─── arranque ────────────────────────────────────────────────────────────────

export async function render() {
  root = document.getElementById("financeRoot");
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved) S.f = { ...DEFAULT_FILTERS, ...saved, q: "", kpi: "" };
  } catch {
    /* ignore */
  }
  renderHeaderActions();
  root.innerHTML = `<div class="fo-root">
    <div class="fo-kpis" data-kpis></div>
    <div class="fo-overview" data-overview></div>
    <div class="fo-toolbar" data-toolbar></div>
    <div class="fo-card fo-table-card">
      <div class="fo-table-head" data-head></div>
      <div class="fo-table-scroll"><table class="fo-table" data-table></table></div>
      <div class="fo-legend fo-flow">
        <span class="fo-flow-label">${icon("route")}Fluxo</span>
        <span class="fo-flow-step is-nav">Em aberto</span>${icon("chevron_right", "fo-flow-arrow")}
        <span class="fo-flow-step is-warn">Recebida em parte</span>${icon("chevron_right", "fo-flow-arrow")}
        <span class="fo-flow-step is-good">Recebida</span>
        <span class="fo-flow-note">ou <b>Atrasada</b> depois da receção</span>
        <span class="fo-flow-hint">FT fatura · RC comprovativo — os recebimentos registam-se na <a class="fo-link" href="${RECONCILE_URL}">Conciliação Bancária</a></span>
      </div>
    </div>
  </div>`;
  renderAll();
  bindEvents();
  bindShortcuts({ "/": () => root.querySelector("[data-q]")?.focus(), n: () => newInvoice() });
  await load();
  renderAll();
  loadForecast().then(() => {
    renderSummary();
    if (S.f.state === "forecast" || S.f.types.includes("PREV") || S.f.kpi === "forecast" || !S.f.state) renderTable();
  });
}

function renderHeaderActions() {
  const slot = document.getElementById("financePageActions");
  if (!slot) return;
  const edit = can("financeiro", "edit");
  slot.innerHTML = `<div class="fo-actions">
    <span class="fo-hero-badge" data-hero-badge><span>A preparar resumo…</span></span>
    <button type="button" class="fo-btn fo-btn--ghost" data-export>${icon("download")}Exportar Excel</button>
    ${edit ? `<button type="button" class="fo-btn fo-btn--ghost" data-import>${icon("document_scanner")}Importar Faturas (PDF)</button>` : ""}
    ${edit ? `<button type="button" class="fo-btn fo-btn--primary" data-new>${icon("add")}Registar Fatura<span class="fo-kbd">N</span></button>` : ""}
  </div>`;
  slot.querySelector("[data-export]").addEventListener("click", exportList);
  slot.querySelector("[data-new]")?.addEventListener("click", newInvoice);
  slot.querySelector("[data-import]")?.addEventListener("click", importPdfs);
}

async function load() {
  S.loading = !S.items.length;
  try {
    const { items } = await apiRequest("/finance/invoices");
    S.items = (items || [])
      .filter((i) => i.kind !== "NOTA_CREDITO")
      .map((i) => {
        const due = String(i.effectiveDueDate || i.dueDate || "").slice(0, 10);
        return { ...i, daysLate: due && due < S.today ? daysBetween(S.today, due) : 0 };
      });
    S.error = null;
  } catch (err) {
    S.error = errMsg(err, "Não foi possível carregar as faturas.");
  }
  S.loading = false;
}

async function loadForecast() {
  try {
    const { byProject } = await apiRequest("/finance/billing-forecast");
    S.forecast = (byProject || [])
      .filter((e) => num(e.toBill) > 0.5)
      .map((e) => ({
        id: `prev-${e.project.id}`,
        forecast: true,
        docNumber: null,
        project: { id: e.project.id, code: e.project.code, name: e.project.name },
        client: e.project.client || null,
        currency: e.project.currency || "AOA",
        description: `Por faturar da obra · faturado ${money(e.billed)} de ${money(e.forecast)}`,
        netAmount: num(e.toBill),
        receivedAmount: 0,
        missingAmount: num(e.toBill),
      }));
  } catch {
    S.forecast = [];
  }
  S.forecastLoaded = true;
}

function saveFilters() {
  const { q, kpi, ...rest } = S.f;
  localStorage.setItem(STORE_KEY, JSON.stringify(rest));
}

// ─── filtros ─────────────────────────────────────────────────────────────────

function allRows() {
  return [...S.items, ...S.forecast];
}

function baseFiltered() {
  const f = S.f;
  const q = norm(f.q);
  return allRows().filter((inv) => {
    const type = inv.forecast ? "PREV" : invoiceTypeOf(inv);
    if (f.types.length && !f.types.includes(type)) return false;
    if (f.clients.length && !f.clients.includes(inv.client?.id)) return false;
    if (f.projects.length && !f.projects.includes(inv.project?.id)) return false;
    if (f.noPdf && (inv.forecast || inv.documentPath || inv.cancelledAt)) return false;
    if (f.until) {
      const d = dueOf(inv);
      if (!d || d > f.until) return false;
    }
    if (q) {
      const hay = norm([inv.docNumber, inv.client?.name, inv.project?.code, inv.project?.name, inv.description, inv.measurement?.reportNumber ? `auto ${inv.measurement.reportNumber}` : "", money(inv.netAmount), String(inv.netAmount)].join(" "));
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

function matchesState(inv) {
  const st = S.f.state;
  if (!st) return true;
  if (st === "forecast") return Boolean(inv.forecast);
  if (inv.forecast) return S.f.types.includes("PREV");
  if (st === "open") return isOpenInv(inv);
  if (st === "late") return inv.status === "ATRASADO" && !inv.cancelledAt;
  if (st === "cancelled") return Boolean(inv.cancelledAt) || inv.status === "ANULADA";
  if (inv.cancelledAt) return false;
  return inv.status === st;
}

function matchesKpi(inv) {
  const k = S.f.kpi;
  const t = S.today;
  if (k === "open") return isOpenInv(inv);
  if (k === "late") return isOpenInv(inv) && inv.status === "ATRASADO";
  if (k === "week") return isOpenInv(inv) && inv.status !== "ATRASADO" && dueOf(inv) && dueOf(inv) <= addDays(t, 7);
  if (k === "month") return !inv.forecast && (inv.receipts || []).some((r) => String(r.receivedDate).slice(0, 7) === t.slice(0, 7));
  if (k === "forecast") return Boolean(inv.forecast);
  return true;
}

function filtered() {
  const list = baseFiltered().filter((inv) => (S.f.kpi ? matchesKpi(inv) : matchesState(inv)));
  const { key, dir } = S.sort;
  const val = (inv) => {
    if (key === "number") return inv.docNumber || "";
    if (key === "date") return String(inv.docDate || "");
    if (key === "net") return num(inv.netAmount);
    if (key === "missing") return num(inv.missingAmount);
    if (key === "client") return norm(inv.client?.name);
    return dueOf(inv) || "9999";
  };
  return list.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });
}

// ─── indicadores ─────────────────────────────────────────────────────────────

function summarize() {
  const base = baseFiltered();
  const t = S.today;
  const sum = (arr, fn) => arr.reduce((acc, x) => acc + fn(x), 0);
  const open = base.filter(isOpenInv);
  const late = open.filter((i) => i.status === "ATRASADO");
  const week = open.filter((i) => i.status !== "ATRASADO" && dueOf(i) && dueOf(i) <= addDays(t, 7));
  const weekIds = new Set(week.map((i) => i.id));
  const lateIds = new Set(late.map((i) => i.id));
  const later = open.filter((i) => !weekIds.has(i.id) && !lateIds.has(i.id));
  let monthSum = 0;
  let monthN = 0;
  base.forEach((i) =>
    (i.receipts || []).forEach((r) => {
      if (String(r.receivedDate).slice(0, 7) === t.slice(0, 7)) {
        monthSum += num(r.amount);
        monthN += 1;
      }
    })
  );
  const forecast = base.filter((i) => i.forecast);
  const paid = base.filter((i) => i.status === "PAGO_TOTAL" && !i.cancelledAt);
  const next = open.slice().sort((a, b) => String(dueOf(a) || "9999-12-31").localeCompare(String(dueOf(b) || "9999-12-31")))[0] || null;
  return { base, t, open, late, week, later, forecast, paid, monthSum, monthN, next, sum };
}

/** Indicadores, resumo do topo e composição do que está por receber. */
function renderSummary() {
  const el = root.querySelector("[data-kpis]");
  if (S.loading) {
    el.innerHTML = Array.from({ length: 5 }, () => `<div class="fo-kpi" style="cursor:default"><span class="fo-skel" style="width:60%"></span><span class="fo-skel" style="width:80%;height:22px;margin-top:.4rem"></span><span class="fo-skel" style="width:40%"></span></div>`).join("");
    renderOverview(null);
    renderHeroBadge(null);
    return;
  }
  const m = summarize();
  const { open, late, week, forecast, sum } = m;
  const nf = (n) => `${n} fatura${n === 1 ? "" : "s"}`;
  const k = S.f.kpi;
  el.innerHTML = [
    kpiCard({ key: "open", label: "Por receber", iconName: "savings", value: compact(sum(open, (i) => i.missingAmount)), sub: nf(open.length), active: k === "open" }),
    kpiCard({ key: "late", label: "Em atraso", iconName: "warning", tone: "bad", value: compact(sum(late, (i) => i.missingAmount)), sub: nf(late.length), active: k === "late" }),
    kpiCard({ key: "week", label: "Recebe em 7 dias", iconName: "event_upcoming", tone: "warn", value: compact(sum(week, (i) => i.missingAmount)), sub: nf(week.length), active: k === "week" }),
    kpiCard({ key: "month", label: "Recebido este mês", iconName: "task_alt", tone: "good", value: compact(m.monthSum), sub: `${monthLabel(S.today)} · ${m.monthN} recebimento${m.monthN === 1 ? "" : "s"}`, active: k === "month" }),
    kpiCard({ key: "forecast", label: "Previsto (sem fatura)", iconName: "pending_actions", tone: "info", value: S.forecastLoaded ? compact(sum(forecast, (i) => i.missingAmount)) : '<span class="fo-skel" style="width:90px;height:20px;display:inline-block"></span>', sub: S.forecastLoaded ? `${forecast.length} obra${forecast.length === 1 ? "" : "s"} por faturar` : "a calcular…", active: k === "forecast" }),
  ].join("");
  renderOverview(m);
  renderHeroBadge(m);
}

/** Pequeno resumo vivo no cabeçalho da página. */
function renderHeroBadge(m) {
  const badge = document.querySelector("#financePageActions [data-hero-badge]");
  if (!badge) return;
  if (!m) {
    badge.innerHTML = S.error
      ? `<span>Resumo indisponível</span>`
      : `<span>A preparar resumo…</span>`;
    return;
  }
  const total = m.sum(m.open, (i) => i.missingAmount);
  if (!m.open.length) {
    badge.innerHTML = `<span>Nada por receber</span>`;
    return;
  }
  badge.innerHTML = `<span><b>${m.open.length}</b> por receber</span><span class="fo-hero-sep"></span><span class="fo-num"><b>${money(total)}</b> AOA</span>${m.late.length ? `<span class="fo-hero-late">${m.late.length} em atraso</span>` : ""}`;
}

/** Faixa de resumo: composição do que está por receber + próxima receção. */
function renderOverview(m) {
  const el = root.querySelector("[data-overview]");
  if (!el) return;
  if (S.error) {
    el.innerHTML = "";
    return;
  }
  if (!m) {
    el.innerHTML = `<div class="fo-overview-main is-loading"><span class="fo-skel" style="width:180px"></span><span class="fo-skel" style="width:70%;height:10px;margin-top:1.1rem"></span><span class="fo-skel" style="width:100%;height:38px;margin-top:1.1rem"></span></div><div class="fo-overview-next is-loading"><span class="fo-skel" style="width:120px"></span><span class="fo-skel" style="width:80%;height:34px;margin-top:.9rem"></span><span class="fo-skel" style="width:60%;height:14px;margin-top:.9rem"></span></div>`;
    return;
  }
  const lateV = m.sum(m.late, (i) => i.missingAmount);
  const weekV = m.sum(m.week, (i) => i.missingAmount);
  const laterV = m.sum(m.later, (i) => i.missingAmount);
  const total = lateV + weekV + laterV;
  const pct = (v) => (total > 0 ? Math.max((v / total) * 100, v > 0 ? 1.5 : 0).toFixed(2) : 0);
  const seg = (cls, v) => (v > 0 ? `<span class="fo-bar-seg ${cls}" style="width:${pct(v)}%" title="${esc(cls === "is-late" ? "Em atraso" : cls === "is-soon" ? "Recebe em 7 dias" : "Mais tarde")}: ${money(v)} AOA"></span>` : "");
  const legend = `<ul class="fo-overview-legend">
      <li><i class="fo-ol-dot is-late"></i><span>Em atraso</span><b class="fo-num">${compact(lateV)}</b><small>${m.late.length} fat.</small></li>
      <li><i class="fo-ol-dot is-soon"></i><span>Recebe em 7 dias</span><b class="fo-num">${compact(weekV)}</b><small>${m.week.length} fat.</small></li>
      <li><i class="fo-ol-dot is-later"></i><span>Mais tarde</span><b class="fo-num">${compact(laterV)}</b><small>${m.later.length} fat.</small></li>
    </ul>`;
  const nxt = m.next;
  let nextHtml;
  if (!nxt) {
    nextHtml = `<div class="fo-overview-next is-empty">
      <span class="fo-next-empty-icon">${icon("task_alt")}</span>
      <b>Tudo recebido</b>
      <span>Não há faturas em aberto${m.paid.length ? ` — ${m.paid.length} já recebida${m.paid.length === 1 ? "" : "s"}` : ""}.</span>
    </div>`;
  } else {
    const due = dueOf(nxt);
    const diff = due ? daysBetween(due, S.today) : null;
    const whenTxt = diff === null ? "sem data" : diff < 0 ? `${Math.abs(diff)} d de atraso` : diff === 0 ? "recebe hoje" : diff === 1 ? "recebe amanhã" : `recebe em ${diff} dias`;
    const whenTone = diff !== null && diff < 0 ? "is-late" : diff !== null && diff <= 3 ? "is-soon" : "";
    const type = invoiceTypeInfo(invoiceTypeOf(nxt));
    nextHtml = `<div class="fo-overview-next">
      <div class="fo-next-head">
        <p class="fo-overview-kicker">${diff !== null && diff < 0 ? "Receção mais atrasada" : "Próxima receção"}</p>
        <span class="fo-next-when ${whenTone}">${esc(whenTxt)}</span>
      </div>
      <div class="fo-next-body">
        <span class="fo-next-mark">${esc(initials(nxt.client?.name).slice(0, 2))}</span>
        <div class="fo-next-info">
          <b title="${esc(nxt.client?.name || "")}">${esc(nxt.client?.name || "Sem cliente")}</b>
          <small>${esc(nxt.docNumber || "s/ n.º")} · ${esc(type.short)} · ${fmtDate(due)}</small>
        </div>
      </div>
      <div class="fo-next-foot">
        <div class="fo-next-amount"><small>Falta receber</small><b class="fo-num">${money(nxt.missingAmount)}</b></div>
        <button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-next-open="${esc(nxt.id)}">${icon("arrow_forward")}Ver fatura</button>
      </div>
    </div>`;
  }
  el.innerHTML = `<div class="fo-overview-main">
      <div class="fo-overview-head">
        <div>
          <p class="fo-overview-kicker">Composição</p>
          <h3 class="fo-overview-title">O que está por receber</h3>
        </div>
        <span class="fo-overview-total">${money(total)} <small>AOA</small></span>
      </div>
      ${total > 0 ? `<div class="fo-overview-bar" role="img" aria-label="Composição do valor por receber: ${esc(compact(lateV))} em atraso, ${esc(compact(weekV))} a receber em 7 dias, ${esc(compact(laterV))} mais tarde">${seg("is-late", lateV)}${seg("is-soon", weekV)}${seg("is-later", laterV)}</div>${legend}` : `<div class="fo-overview-empty">${icon("check_circle")}<span>Sem valores por receber${m.paid.length ? ` — ${m.paid.length} fatura${m.paid.length === 1 ? "" : "s"} recebida${m.paid.length === 1 ? "" : "s"}` : ""}.</span></div>`}
    </div>${nextHtml}`;
}

// ─── barra de filtros ────────────────────────────────────────────────────────

const typeOptions = () => [...INVOICE_TYPES.map((t) => ({ value: t.code, label: `${t.short} — ${t.label}` })), { value: "PREV", label: "Previstos (ainda sem fatura)" }];

function clientOptions() {
  const m = new Map();
  allRows().forEach((i) => i.client && m.set(i.client.id, i.client.name));
  return [...m].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
}

function projectOptions() {
  const m = new Map();
  allRows().forEach((i) => i.project && m.set(i.project.id, `${i.project.code} · ${i.project.name}`));
  return [...m].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
}

function renderToolbar() {
  const f = S.f;
  const noPdfN = S.items.filter((i) => !i.documentPath && !i.cancelledAt).length;
  const any = f.q || f.types.length || f.clients.length || f.projects.length || f.noPdf || f.until || f.state !== "open" || f.kpi;
  root.querySelector("[data-toolbar]").innerHTML = `
    <div class="fo-toolbar-row">
      <label class="fo-search">${icon("search")}<input data-q value="${esc(f.q)}" placeholder="Pesquisar n.º, cliente, obra, auto, valor…"><span class="fo-kbd">/</span></label>
      ${multiFilterHtml("types", "Tipos", f.types, typeOptions(), { allLabel: "Todos os tipos" })}
      ${multiFilterHtml("clients", "Clientes", f.clients, clientOptions(), { allLabel: "Todos os clientes" })}
      ${multiFilterHtml("projects", "Obras", f.projects, projectOptions(), { allLabel: "Todas as obras" })}
      <select class="fo-select ${f.state !== "open" ? "is-on" : ""}" data-state title="Estado">${STATES.map((s) => `<option value="${s.v}" ${f.state === s.v ? "selected" : ""}>${s.l}</option>`).join("")}</select>
    </div>
    <div class="fo-toolbar-row">
      <label class="fo-check ${f.noPdf ? "is-on" : ""}"><input type="checkbox" data-nopdf ${f.noPdf ? "checked" : ""}>Faturas sem PDF <b>${noPdfN}</b></label>
      <span class="fo-toolbar-sep fo-hide-md"></span>
      <span class="fo-tool-label">Receção até</span>
      <input type="date" class="fo-select ${f.until ? "is-on" : ""}" data-until value="${esc(f.until)}" style="padding-right:.6rem">
      <button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-until-set="${S.today}">Hoje</button>
      <button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-until-set="${endOfMonth(S.today)}">Fim do mês</button>
      ${any ? `<button type="button" class="fo-clear" data-clear>${icon("filter_alt_off")}limpar filtros</button>` : ""}
    </div>`;
}

// ─── tabela ──────────────────────────────────────────────────────────────────

function rowHtml(inv) {
  const st = statusOf(inv);
  const due = dueOf(inv);
  const late = isOpenInv(inv) && inv.status === "ATRASADO";
  const type = inv.forecast ? { short: "PREV", label: "Previsto (sem fatura)" } : invoiceTypeInfo(invoiceTypeOf(inv));
  const auto = inv.measurement?.reportNumber ? `Auto n.º ${inv.measurement.reportNumber}` : "";
  const sub = [auto, inv.description].filter(Boolean).join(" · ");
  const receipts = inv.receipts || [];
  const withProof = receipts.filter((r) => r.proofPath);
  const dim = st.key === "cancelled" || inv.forecast;
  return `<tr class="is-row ${late ? "is-late" : ""} ${dim ? "is-dim" : ""}" data-id="${esc(inv.id)}">
    <td>${inv.forecast ? '<span class="fo-faint">—</span>' : `<button type="button" class="fo-link fo-ref" data-open>${esc(inv.docNumber || "s/ n.º")}</button>`}</td>
    <td class="fo-num">${inv.forecast ? "—" : fmtDate(String(inv.docDate).slice(0, 10))}</td>
    <td class="fo-num ${late ? "fo-red" : ""}" style="font-weight:${late ? 800 : 500}">${due ? fmtDate(due) : "—"}${late && inv.daysLate > 0 ? `<span class="fo-cell-sub fo-red">${inv.daysLate} d</span>` : ""}${inv.dueEstimated && !inv.forecast ? '<span class="fo-cell-sub" title="Sem vencimento na fatura — estimado pelo prazo da obra">estimada</span>' : ""}</td>
    <td><span class="fo-tag ${inv.forecast ? "fo-tag--blue" : type.short === "ADI" ? "fo-tag--violet" : "fo-tag--navy"}" title="${esc(type.label)}">${esc(type.short)}</span></td>
    <td><span class="fo-cell-main" style="max-width:150px">${esc(inv.project?.code || "—")}</span><span class="fo-cell-sub" style="max-width:150px" title="${esc(inv.project?.name || "")}">${esc(inv.project?.name || "")}</span></td>
    <td><div class="fo-supplier"><span class="fo-supplier-mark">${esc(initials(inv.client?.name).slice(0, 2))}</span><span class="fo-supplier-text"><span class="fo-cell-main" style="max-width:170px" title="${esc(inv.client?.name || "")}">${esc(inv.client?.name || "—")}</span><span class="fo-cell-sub" style="max-width:170px" title="${esc(sub)}">${esc(sub)}</span></span></div></td>
    <td class="ta-c"><span class="fo-tag">${esc(inv.currency || "AOA")}</span></td>
    <td class="ta-r fo-num"><b style="color:var(--fo-ink)">${money(inv.netAmount)}</b>${inv.currency && inv.currency !== "AOA" && inv.foreignAmount ? `<span class="fo-cell-sub">${money(inv.foreignAmount)} ${esc(inv.currency)} s/ IVA</span>` : ""}</td>
    <td class="ta-r fo-num ${inv.receivedAmount > 0 ? "fo-green" : "fo-faint"}">${inv.receivedAmount > 0 ? money(inv.receivedAmount) : "—"}</td>
    <td class="ta-r fo-num" style="font-weight:700;color:${num(inv.missingAmount) > 0.005 && st.key !== "cancelled" ? (late ? "var(--fo-bad)" : "var(--fo-ink)") : "var(--fo-faint)"}">${num(inv.missingAmount) > 0.005 && st.key !== "cancelled" ? money(inv.missingAmount) : "—"}</td>
    <td>${inv.forecast ? pill(st.label, st.tone) : `<button type="button" class="fo-state-btn" data-menu data-fo-keep-pop>${pill(st.label, st.tone)}${icon("expand_more")}</button>`}</td>
    <td class="ta-c">${inv.forecast ? "" : inv.documentPath ? `<button type="button" class="fo-doc is-ok" data-pdf title="Abrir o PDF">${icon("picture_as_pdf")}</button>` : st.key === "cancelled" ? "" : `<button type="button" class="fo-doc is-missing" data-attach title="Fatura sem PDF — anexar">${icon("priority_high")}</button>`}</td>
    <td class="ta-c">${receipts.length ? `<button type="button" class="fo-doc ${withProof.length === receipts.length ? "is-ok" : "is-missing"}" data-receipts title="${receipts.length} recebimento(s)${withProof.length < receipts.length ? " — falta comprovativo" : ""}">${icon("attach_file")}${receipts.length > 1 ? `<span class="fo-doc-count">${receipts.length}</span>` : ""}</button>` : '<span class="fo-faint">—</span>'}</td>
  </tr>`;
}

function thSort(key, label, cls = "") {
  const on = S.sort.key === key;
  return `<th class="is-sortable ${cls}" data-sort="${key}">${label}${on ? icon(S.sort.dir > 0 ? "arrow_upward" : "arrow_downward", "fo-sort") : ""}</th>`;
}

function renderTable() {
  const tbl = root.querySelector("[data-table]");
  const head = root.querySelector("[data-head]");
  const thead = `<thead><tr>${thSort("number", "Fatura")}${thSort("date", "Data")}${thSort("due", "Receção")}<th>Tipo</th><th>Obra / CC</th>${thSort("client", "Cliente / Auto")}<th class="ta-c">Moeda</th>${thSort("net", "V. a receber<span class='fo-th-sub'>líquido</span>", "ta-r")}<th class="ta-r">Recebido</th>${thSort("missing", "Falta", "ta-r")}<th>Estado</th><th class="ta-c" title="PDF da fatura">FT</th><th class="ta-c" title="Comprovativos de recebimento">RC</th></tr></thead>`;
  if (S.loading) {
    tbl.innerHTML = `${thead}<tbody>${skeletonRows(13, 7)}</tbody>`;
    head.innerHTML = "<span>A carregar faturas…</span>";
    return;
  }
  if (S.error) {
    tbl.innerHTML = `<tbody><tr><td>${emptyState({ iconName: "cloud_off", title: "Não foi possível carregar", text: esc(S.error), action: `<button type="button" class="fo-btn fo-btn--ghost" data-retry>${icon("refresh")}Tentar de novo</button>` })}</td></tr></tbody>`;
    head.innerHTML = "";
    return;
  }
  const list = filtered();
  const sum = (k) => list.reduce((a, i) => a + (i.cancelledAt ? 0 : num(i[k])), 0);
  head.innerHTML = `<span class="fo-head-info"><span class="fo-head-count">${list.length}</span><span>${list.length === 1 ? "fatura" : "faturas"} na lista</span>${S.f.kpi ? `<span class="fo-head-filter">${esc({ open: "Por receber", late: "Em atraso", week: "Recebe em 7 dias", month: "Recebido este mês", forecast: "Previstos" }[S.f.kpi])}<button type="button" class="fo-link fo-link--muted" data-kpi-off title="Tirar o filtro">${icon("close")}</button></span>` : ""}</span><span class="fo-head-total"><span>Falta receber</span><b class="fo-num">${money(sum("missingAmount"))}</b><small>AOA</small></span>`;
  if (!list.length) {
    const none = !S.items.length;
    tbl.innerHTML = `<tbody><tr><td>${emptyState({
      iconName: none ? "receipt" : "filter_alt_off",
      title: none ? "Ainda não há faturas emitidas" : "Nenhuma fatura com estes filtros",
      text: none ? "Registe a primeira fatura à mão ou importe o PDF — os campos são lidos automaticamente." : "Experimente outro estado ou limpe os filtros.",
      action: none && can("financeiro", "edit") ? `<button type="button" class="fo-btn fo-btn--primary" data-new-empty>${icon("add")}Registar Fatura</button>` : `<button type="button" class="fo-btn fo-btn--ghost" data-clear>${icon("filter_alt_off")}Limpar filtros</button>`,
    })}</td></tr></tbody>`;
    return;
  }
  tbl.innerHTML = `${thead}<tbody>${list.map(rowHtml).join("")}</tbody>
    <tfoot><tr><td colspan="7" style="text-align:right;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fo-muted)">Total</td><td class="ta-r fo-num">${money(sum("netAmount"))}</td><td class="ta-r fo-num fo-green">${money(sum("receivedAmount"))}</td><td class="ta-r fo-num">${money(sum("missingAmount"))}</td><td colspan="3"></td></tr></tfoot>`;
}

function renderAll() {
  renderSummary();
  renderToolbar();
  renderTable();
}

// ─── ações ───────────────────────────────────────────────────────────────────

async function refresh() {
  await load();
  renderAll();
}

function existingNumbers() {
  return S.items.map((i) => i.docNumber).filter(Boolean);
}

function newInvoice() {
  if (!can("financeiro", "edit")) return;
  openInvoiceForm({ existingNumbers: existingNumbers(), onSaved: refresh });
}

async function importPdfs() {
  const files = await pickFiles({ accept: ".pdf,application/pdf,image/*", multiple: true });
  if (!files.length) return;
  let i = 0;
  const next = () => {
    if (i >= files.length) return refresh();
    const file = files[i++];
    if (files.length > 1) toast(`Fatura ${i} de ${files.length}: ${file.name}`, { type: "info" });
    openInvoiceForm({
      scanFile: file,
      existingNumbers: existingNumbers(),
      onSaved: async () => {
        await refresh();
        next();
      },
    });
  };
  next();
}

function goReconcile(inv) {
  location.href = `${RECONCILE_URL}?invoice=${encodeURIComponent(inv.id)}`;
}

async function attachPdf(inv, onDone) {
  const [file] = await pickFiles({ accept: ".pdf,application/pdf,image/*" });
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    await apiUpload(`/finance/invoices/${inv.id}/document`, fd, "POST");
    toast("PDF anexado.", { type: "success" });
    await refresh();
    onDone?.();
  } catch (err) {
    toast(errMsg(err), { type: "error" });
  }
}

async function cancelInvoice(inv, onDone) {
  if (num(inv.receivedAmount) > 0.005) return toast("A fatura já tem recebimentos: desfaça-os primeiro na Conciliação Bancária.", { type: "error" });
  const reason = await ask(`Anular a fatura ${inv.docNumber || ""}? Deixa de contar como valor a receber.`, { title: "Anular a fatura", ok: "Anular", danger: true, input: true, required: true, placeholder: "Motivo (ex.: substituída pela FT …, nota de crédito …)" });
  if (!reason) return;
  try {
    await apiRequest(`/finance/invoices/${inv.id}/cancel`, { method: "POST", body: { reason } });
    toast(`Fatura ${inv.docNumber || ""} anulada.`, { type: "success" });
    await refresh();
    onDone?.();
  } catch (err) {
    toast(errMsg(err), { type: "error" });
  }
}

function menuItems(inv, { inDetail = false, close } = {}) {
  const st = statusOf(inv);
  const edit = can("financeiro", "edit");
  const cancelled = st.key === "cancelled";
  const items = [];
  if (!inDetail) items.push({ icon: "open_in_new", label: "Ver detalhe", onClick: () => openDetail(inv) });
  items.push({ icon: "edit", label: "Editar a fatura", disabled: !edit || cancelled, onClick: () => openInvoiceForm({ invoice: inv, existingNumbers: existingNumbers(), onSaved: () => (close?.(), refresh()) }) });
  if (inv.documentPath) items.push({ icon: "picture_as_pdf", label: "Abrir o PDF", onClick: () => window.open(fileUrl(inv.documentPath), "_blank", "noopener") });
  items.push({ icon: "attach_file", label: inv.documentPath ? "Substituir o PDF" : "Anexar o PDF", disabled: !edit, onClick: () => attachPdf(inv, close) });
  items.push("sep");
  items.push({ icon: "sync_alt", label: "Registar recebimento", hint: "Na Conciliação Bancária — entrada do extrato", tone: "good", disabled: cancelled || st.key === "PAGO_TOTAL", onClick: () => goReconcile(inv) });
  items.push("sep");
  items.push({ icon: "block", label: "Anular a fatura", hint: num(inv.receivedAmount) > 0.005 ? "Tem recebimentos — desfaça-os primeiro" : "Só sem recebimentos · pede o motivo", tone: "bad", disabled: !edit || cancelled || num(inv.receivedAmount) > 0.005, onClick: () => cancelInvoice(inv, close) });
  return items;
}

function openDetail(inv) {
  if (inv.forecast) return;
  const st = statusOf(inv);
  const type = invoiceTypeInfo(invoiceTypeOf(inv));
  const gross = num(inv.grossAmount);
  const total = gross + num(inv.vatAmount);
  const pct = num(inv.netAmount) > 0 ? Math.min(100, (num(inv.receivedAmount) / num(inv.netAmount)) * 100) : 0;
  const drawer = openDrawer({
    kicker: `${type.short} · ${esc(type.label)}`,
    title: `${esc(inv.docNumber || "Fatura")} ${pill(st.label, st.tone)}`,
    subtitle: `${esc(inv.client?.name || "—")} · ${esc(inv.project?.code || "")} ${esc(inv.project?.name || "")} · emitida a ${fmtDate(String(inv.docDate).slice(0, 10))}${inv.createdBy ? ` por ${esc(inv.createdBy)}` : ""}`,
    width: 900,
    headerActions: `${st.key !== "cancelled" && st.key !== "PAGO_TOTAL" ? `<button type="button" class="fo-btn fo-btn--brand fo-btn--sm" data-rec>${icon("sync_alt")}Registar recebimento</button>` : ""}<button type="button" class="fo-icon-btn" data-more data-fo-keep-pop title="Mais ações">${icon("more_vert")}</button>`,
  });
  const receipts = inv.receipts || [];
  drawer.body.innerHTML = `
    ${inv.cancelledAt ? `<div class="fo-note fo-note--warn">${icon("block")}<span><b>Anulada</b> a ${fmtDate(String(inv.cancelledAt).slice(0, 10))}${inv.cancelledBy ? ` por ${esc(inv.cancelledBy)}` : ""}: ${esc(inv.cancelReason || "")}</span></div>` : ""}
    <div class="fo-summary">
      <div><span>A receber (líquido)</span><b>${money(inv.netAmount)} <small class="fo-faint" style="font-size:.6em">AOA</small></b></div>
      <div><span>Recebido</span><b class="fo-green">${money(inv.receivedAmount)}</b><div class="fo-progress" style="margin-top:.5rem"><span style="width:${pct}%"></span></div></div>
      <div><span>Falta</span><b class="${st.key === "ATRASADO" ? "fo-red" : ""}">${money(inv.missingAmount)}</b><small class="fo-muted" style="font-size:12px">receção ${fmtDate(dueOf(inv))}${inv.daysLate > 0 && isOpenInv(inv) ? ` · <b class="fo-red">${inv.daysLate} dia(s) de atraso</b>` : ""}</small></div>
    </div>
    <dl class="fo-info-grid">
      <div><dt>Cliente</dt><dd>${esc(inv.client?.name || "—")}</dd></div>
      <div><dt>Obra</dt><dd>${esc(inv.project ? `${inv.project.code} · ${inv.project.name}` : "—")}</dd></div>
      <div><dt>Auto de medição</dt><dd>${inv.measurement ? `n.º ${esc(inv.measurement.reportNumber)}` : "—"}</dd></div>
      <div><dt>Moeda</dt><dd>${esc(inv.currency || "AOA")}${inv.foreignAmount ? ` · ${money(inv.foreignAmount)} × ${String(inv.exchangeRate).replace(".", ",")}` : ""}</dd></div>
      <div><dt>Data de emissão</dt><dd>${fmtDate(String(inv.docDate).slice(0, 10))}</dd></div>
      <div><dt>Receção prevista</dt><dd>${fmtDate(dueOf(inv))}${inv.dueEstimated ? ' <span class="fo-faint">(estimada)</span>' : ""}</dd></div>
      <div><dt>Descrição</dt><dd>${esc(inv.description || "—")}</dd></div>
      <div><dt>PDF</dt><dd>${inv.documentPath ? `<a class="fo-link" href="${esc(fileUrl(inv.documentPath))}" target="_blank" rel="noopener">${icon("picture_as_pdf")} abrir</a>` : '<span class="fo-red">em falta</span>'}</dd></div>
    </dl>
    <section class="fo-section">
      <div class="fo-section-head"><h3 class="fo-section-title">${icon("calculate")}Valores</h3></div>
      <div class="fo-totals" style="width:min(460px,100%);margin-left:0">
        <div><span>Valor s/ IVA</span><b>${money(gross)}</b></div>
        <div><span>IVA</span><b>${money(inv.vatAmount)}</b></div>
        <div><span>Total da fatura</span><b>${money(total)}</b></div>
        ${num(inv.vatCativoAmount) ? `<div class="is-neg"><span>IVA cativo (${inv.vatCativoPercent}%)</span><b>− ${money(inv.vatCativoAmount)}</b></div>` : ""}
        ${num(inv.withholdingAmount) ? `<div class="is-neg"><span>Retenção na fonte</span><b>− ${money(inv.withholdingAmount)}</b></div>` : ""}
        ${num(inv.carInsuranceAmount) ? `<div class="is-neg"><span>Seguro de construção</span><b>− ${money(inv.carInsuranceAmount)}</b></div>` : ""}
        ${num(inv.guaranteeAmount) ? `<div class="is-neg"><span>Garantia retida</span><b>− ${money(inv.guaranteeAmount)}</b></div>` : ""}
        <div class="is-big"><span>A receber</span><b>${money(inv.netAmount)}</b></div>
      </div>
    </section>
    <section class="fo-section">
      <div class="fo-section-head"><h3 class="fo-section-title">${icon("account_balance")}Recebimentos</h3></div>
      ${
        receipts.length
          ? `<table class="fo-mini-table"><thead><tr><th>Data</th><th>Meio</th><th class="ta-r">Valor</th><th>Comprovativo</th><th>Banco</th><th>Por</th></tr></thead><tbody>${receipts
              .map(
                (r) => `<tr><td>${fmtDate(String(r.receivedDate).slice(0, 10))}</td><td>${esc(r.method || "—")}</td><td class="ta-r fo-num"><b>${money(r.amount)}</b></td><td>${r.proofPath ? `<a class="fo-link" href="${esc(fileUrl(r.proofPath))}" target="_blank" rel="noopener">${icon("picture_as_pdf")} abrir</a>` : '<span class="fo-red" style="font-size:12px;font-weight:600">em falta</span>'}</td><td>${r.bankMovementId ? `<span class="fo-tag fo-tag--green">${icon("link")} conciliado</span>` : '<span class="fo-faint">—</span>'}</td><td class="fo-muted">${esc(r.createdBy || "—")}</td></tr>`
              )
              .join("")}</tbody></table>`
          : `<p class="fo-help" style="margin:0">Ainda sem recebimentos. Registe-os na <a class="fo-link" href="${RECONCILE_URL}?invoice=${encodeURIComponent(inv.id)}">Conciliação Bancária</a>, a partir da entrada do extrato.</p>`
      }
    </section>
    ${inv.notes ? `<div class="fo-note fo-note--muted">${icon("sticky_note_2")}<span>${esc(inv.notes)}</span></div>` : ""}`;
  drawer.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-rec]")) return goReconcile(inv);
    const more = e.target.closest("[data-more]");
    if (more) popMenu(more, menuItems(inv, { inDetail: true, close: () => drawer.close(true) }), { title: inv.docNumber || "Fatura", width: 290 });
  });
}

function openReceiptsMenu(anchor, inv) {
  const items = (inv.receipts || []).map((r) => ({
    icon: r.proofPath ? "picture_as_pdf" : "error",
    label: `${fmtDate(String(r.receivedDate).slice(0, 10))} · ${money(r.amount)}`,
    hint: r.proofPath ? "Abrir o comprovativo" : "Sem comprovativo — anexe na Conciliação",
    tone: r.proofPath ? "" : "bad",
    onClick: () => (r.proofPath ? window.open(fileUrl(r.proofPath), "_blank", "noopener") : goReconcile(inv)),
  }));
  popMenu(anchor, items, { title: "Recebimentos", width: 300 });
}

// ─── eventos ─────────────────────────────────────────────────────────────────

function bindEvents() {
  root.addEventListener("click", (e) => {
    const t = e.target;
    const kpi = t.closest("[data-kpi]");
    if (kpi) {
      S.f.kpi = S.f.kpi === kpi.dataset.kpi ? "" : kpi.dataset.kpi;
      return renderAll();
    }
    if (t.closest("[data-kpi-off]")) {
      S.f.kpi = "";
      return renderAll();
    }
    if (t.closest("[data-retry]")) {
      S.loading = true;
      renderAll();
      return refresh();
    }
    if (t.closest("[data-new-empty]")) return newInvoice();
    if (t.closest("[data-clear]")) {
      S.f = { ...DEFAULT_FILTERS };
      saveFilters();
      return renderAll();
    }
    const us = t.closest("[data-until-set]");
    if (us) {
      S.f.until = S.f.until === us.dataset.untilSet ? "" : us.dataset.untilSet;
      saveFilters();
      return renderAll();
    }
    const mf = t.closest("[data-mf]");
    if (mf) {
      const key = mf.dataset.mf;
      const conf = {
        types: { title: "Tipo de fatura", options: typeOptions(), allLabel: "Todos os tipos" },
        clients: { title: "Cliente", options: clientOptions(), allLabel: "Todos os clientes" },
        projects: { title: "Obra", options: projectOptions(), allLabel: "Todas as obras" },
      }[key];
      openMultiFilter(mf, {
        ...conf,
        values: S.f[key],
        onChange: (v) => {
          S.f[key] = v;
          saveFilters();
          renderSummary();
          renderTable();
          const btn = root.querySelector(`[data-mf="${key}"]`);
          if (btn) {
            const tmp = document.createElement("div");
            tmp.innerHTML = multiFilterHtml(key, conf.title, v, conf.options, { allLabel: conf.allLabel });
            btn.replaceWith(tmp.firstElementChild);
          }
        },
      });
      return;
    }
    const nextBtn = t.closest("[data-next-open]");
    if (nextBtn) {
      const nextInv = allRows().find((i) => i.id === nextBtn.dataset.nextOpen);
      if (nextInv) openDetail(nextInv);
      return;
    }
    const th = t.closest("[data-sort]");
    if (th) {
      const k = th.dataset.sort;
      S.sort = S.sort.key === k ? { key: k, dir: -S.sort.dir } : { key: k, dir: ["net", "missing", "date"].includes(k) ? -1 : 1 };
      return renderTable();
    }
    const tr = t.closest("tr[data-id]");
    if (!tr) return;
    const inv = allRows().find((i) => i.id === tr.dataset.id);
    if (!inv) return;
    if (t.closest("[data-menu]")) return popMenu(t.closest("[data-menu]"), menuItems(inv), { title: inv.docNumber || "Fatura", width: 290 });
    if (t.closest("[data-pdf]")) return window.open(fileUrl(inv.documentPath), "_blank", "noopener");
    if (t.closest("[data-attach]")) return attachPdf(inv);
    if (t.closest("[data-receipts]")) return openReceiptsMenu(t.closest("[data-receipts]"), inv);
    if (t.closest("[data-open]")) return openDetail(inv);
    if (t.closest("button, a, input, select")) return;
    if (inv.forecast) return toast("Previsto: ainda não há fatura. Registe-a quando for emitida.", { type: "info" });
    openDetail(inv);
  });

  let qTimer = null;
  root.addEventListener("input", (e) => {
    if (!e.target.matches("[data-q]")) return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      S.f.q = e.target.value;
      renderSummary();
      renderTable();
    }, 120);
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-state]")) {
      S.f.state = t.value;
      S.f.kpi = "";
    } else if (t.matches("[data-nopdf]")) S.f.noPdf = t.checked;
    else if (t.matches("[data-until]")) S.f.until = t.value;
    else return;
    saveFilters();
    renderAll();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !document.querySelector(".fo-drawer-root, .fo-dialog-root")) refresh();
  });
}

// ─── exportar ────────────────────────────────────────────────────────────────

function exportList() {
  const list = filtered();
  if (!list.length) return toast("Não há faturas na lista para exportar.", { type: "error" });
  const header = ["Fatura", "Data", "Receção", "Tipo", "Obra", "Cliente", "Auto", "Descrição", "Moeda", "Valor s/ IVA", "IVA", "IVA cativo", "Retenção", "Seguro", "Garantia", "V. a receber", "Recebido", "Falta", "Estado", "PDF"];
  const rows = list.map((i) => [
    i.docNumber || (i.forecast ? "Previsto" : ""),
    i.forecast ? "" : String(i.docDate).slice(0, 10),
    dueOf(i) || "",
    i.forecast ? "PREV" : invoiceTypeInfo(invoiceTypeOf(i)).short,
    i.project ? `${i.project.code} · ${i.project.name}` : "",
    i.client?.name || "",
    i.measurement?.reportNumber || "",
    i.description || "",
    i.currency || "AOA",
    num(i.grossAmount),
    num(i.vatAmount),
    num(i.vatCativoAmount),
    num(i.withholdingAmount),
    num(i.carInsuranceAmount),
    num(i.guaranteeAmount),
    num(i.netAmount),
    num(i.receivedAmount),
    num(i.missingAmount),
    statusOf(i).label,
    i.documentPath ? "Sim" : "Não",
  ]);
  exportXlsx(`centro-recebimentos-${S.today}.xlsx`, "Centro de Recebimentos", header, rows, [14, 11, 11, 6, 30, 28, 8, 30, 6, 14, 12, 12, 12, 12, 12, 14, 14, 14, 16, 6]);
}
