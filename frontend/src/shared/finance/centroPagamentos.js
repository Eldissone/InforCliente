/**
 * P1 — Centro de Pagamentos.
 * Lista das requisições de pagamento (próprias e as que vêm do resto do
 * InfoCliente), com filtros, indicadores, ações de estado e documentos.
 */
import {
  apiRequest,
  toast,
  esc,
  num,
  money,
  compact,
  todayKey,
  addDays,
  fmtDate,
  monthLabel,
  daysBetween,
  norm,
  initials,
  icon,
  pill,
  kpiCard,
  emptyState,
  skeletonRows,
  multiFilterHtml,
  openMultiFilter,
  popCard,
  copyText,
  exportXlsx,
  errMsg,
  bindShortcuts,
  closePopovers,
  fileUrl,
} from "./fin.js";
import {
  BASE,
  loadOptions,
  cardLabel,
  ccLabel,
  accountFromIban,
  formatIban,
  openStateMenu,
  openRequestForm,
  openRequestDetail,
  openInvoicesDialog,
  uploadRequestDoc,
  PAY_TYPES,
} from "./paymentRequestUi.js";
import { can } from "../permissions.js";

const STORE_KEY = "fo.p1.filters.v1";
const STATES = ["Por pagar", "Pago", "Em aberto", "Em cotação", "Por aprovar", "Atrasado", "Em trânsito", "Em pausa", "Pago parcial", "Rejeitado"];
const OPEN_STATES = ["Em aberto", "Atrasado", "Em trânsito", "Pago parcial", "Por aprovar", "Em pausa", "Em cotação"];

const DEFAULT_FILTERS = { q: "", types: [], cards: [], state: "Por pagar", ref: "due", month: "", from: "", to: "", ccs: [], cond: "", noInvoice: false, noProof: false, kpi: "" };

const S = {
  items: [],
  today: todayKey(),
  opts: { cards: [], costCenters: [], projects: [] },
  loading: true,
  error: null,
  f: { ...DEFAULT_FILTERS },
  sort: { key: "due", dir: 1 },
  expanded: new Set(),
};

let root;

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
        <span class="fo-flow-step is-violet">Em cotação</span>${icon("chevron_right", "fo-flow-arrow")}
        <span class="fo-flow-step is-warn">Por aprovar</span>${icon("chevron_right", "fo-flow-arrow")}
        <span class="fo-flow-step is-nav">Em aberto</span>${icon("chevron_right", "fo-flow-arrow")}
        <span class="fo-flow-step is-info">Em trânsito</span>${icon("chevron_right", "fo-flow-arrow")}
        <span class="fo-flow-step is-good">Pago</span>
        <span class="fo-flow-note">ou <b>Atrasado</b> depois do vencimento</span>
        <span class="fo-flow-hint">PP proforma · CP comprovativo · FT fatura — clique numa linha para ver o detalhe</span>
      </div>
    </div>
  </div>`;
  renderAll();
  bindEvents();
  bindShortcuts({
    "/": () => root.querySelector("[data-q]")?.focus(),
    n: () => newRequest(),
  });
  await Promise.all([load(), loadOptions().then((o) => (S.opts = o)).catch(() => null)]);
  renderAll();
  // Abrir uma requisição por ligação direta (?rp=<id ou número>)
  const rp = new URLSearchParams(location.search).get("rp");
  if (rp) {
    const hit = S.items.find((i) => i.id === rp || i.number === rp);
    if (hit) openDetail(hit);
  }
}

function renderHeaderActions() {
  const slot = document.getElementById("financePageActions");
  if (!slot) return;
  slot.innerHTML = `<div class="fo-actions">
    <span class="fo-hero-badge" data-hero-badge><span class="fo-hero-dot"></span><span>A preparar resumo…</span></span>
    <button type="button" class="fo-btn fo-btn--ghost" data-export>${icon("download")}Exportar Excel</button>
    ${can("financeiro", "edit") ? `<button type="button" class="fo-btn fo-btn--primary" data-new>${icon("add")}Nova Requisição de Pagamento<span class="fo-kbd">N</span></button>` : ""}
  </div>`;
  slot.querySelector("[data-new]")?.addEventListener("click", newRequest);
  slot.querySelector("[data-export]").addEventListener("click", exportList);
}

async function load() {
  S.loading = !S.items.length;
  try {
    const data = await apiRequest(BASE);
    S.items = data.items || [];
    S.today = data.today || todayKey();
    S.error = null;
  } catch (err) {
    S.error = errMsg(err, "Não foi possível carregar as requisições.");
  }
  S.loading = false;
}

function saveFilters() {
  const { q, kpi, ...rest } = S.f;
  localStorage.setItem(STORE_KEY, JSON.stringify(rest));
}

// ─── filtros ─────────────────────────────────────────────────────────────────

function refDate(pr) {
  if (S.f.ref === "request") return pr.requestDate;
  if (S.f.ref === "paid") return pr.payments?.length ? pr.payments[pr.payments.length - 1].paidAt : null;
  return pr.nextDue || pr.dueDate;
}

function isOpen(pr) {
  return pr.status !== "Pago" && pr.status !== "Rejeitado";
}

/** Tudo menos o estado e o KPI (para os indicadores). */
function baseFiltered() {
  const f = S.f;
  const q = norm(f.q);
  return S.items.filter((pr) => {
    if (f.types.length && !f.types.includes(pr.typeCode)) return false;
    if (f.cards.length && !(f.cards.includes(pr.fundCardId) || (pr.payments || []).some((p) => f.cards.includes(p.cardId)))) return false;
    if (f.ccs.length && !(f.ccs.includes(pr.costCenterCode) || (pr.splits || []).some((s) => f.ccs.includes(s.costCenterCode)))) return false;
    if (f.cond === "PRONTO" && pr.condition !== "PRONTO") return false;
    if (f.cond === "CREDITO" && pr.condition === "PRONTO") return false;
    if (f.noInvoice && !(pr.paidAmount > 0 && pr.docState.invoiceNeeded && !pr.docState.invoices)) return false;
    if (f.noProof && !(pr.paidAmount > 0 && !pr.docState.proofs)) return false;
    if (f.month || (f.from && f.to)) {
      const d = refDate(pr);
      if (!d) return false;
      if (f.month && f.month !== "range" && d.slice(0, 7) !== f.month) return false;
      if (f.month === "range" && (d < f.from || d > f.to)) return false;
    }
    if (q) {
      const hay = norm(
        [pr.number, pr.supplierName, pr.supplierNif, pr.notes, pr.typeCode, pr.project?.code, pr.project?.name, pr.vehicle, ...(pr.items || []).map((i) => `${i.description} ${i.code || ""}`), money(pr.totalAmount), String(pr.totalAmount), pr.sourceMeta?.docNumber].join(" ")
      );
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

function matchesState(pr) {
  const st = S.f.state;
  if (!st) return true;
  if (st === "Por pagar") return isOpen(pr);
  return pr.status === st;
}

function matchesKpi(pr) {
  const k = S.f.kpi;
  if (!k) return true;
  const t = S.today;
  const due = pr.nextDue;
  if (k === "open") return isOpen(pr);
  if (k === "late") return pr.status === "Atrasado";
  if (k === "week") return isOpen(pr) && pr.status !== "Atrasado" && due && due >= t && due <= addDays(t, 7);
  if (k === "credit") return isOpen(pr) && pr.condition !== "PRONTO";
  if (k === "paid") return pr.status === "Pago";
  return true;
}

function filtered() {
  const list = baseFiltered().filter((pr) => (S.f.kpi ? matchesKpi(pr) : matchesState(pr)));
  const { key, dir } = S.sort;
  const val = (pr) => {
    if (key === "number") return pr.number;
    if (key === "amount") return pr.totalAmount;
    if (key === "status") return pr.status;
    if (key === "supplier") return norm(pr.supplierName);
    return pr.nextDue || "9999";
  };
  return list.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return b.number.localeCompare(a.number);
  });
}

// ─── indicadores ─────────────────────────────────────────────────────────────

function summarize() {
  const base = baseFiltered();
  const t = S.today;
  const sum = (arr, fn) => arr.reduce((acc, x) => acc + fn(x), 0);
  const open = base.filter(isOpen);
  const late = base.filter((p) => p.status === "Atrasado");
  const week = open.filter((p) => p.status !== "Atrasado" && p.nextDue && p.nextDue >= t && p.nextDue <= addDays(t, 7));
  const weekIds = new Set(week.map((p) => p.id));
  const lateIds = new Set(late.map((p) => p.id));
  const later = open.filter((p) => !weekIds.has(p.id) && !lateIds.has(p.id));
  const credit = open.filter((p) => p.condition !== "PRONTO");
  const paid = base.filter((p) => p.status === "Pago");
  const next = open.slice().sort((a, b) => String(a.nextDue || "9999-12-31").localeCompare(String(b.nextDue || "9999-12-31")))[0] || null;
  return { base, t, open, late, week, later, credit, paid, next, sum };
}

/** Indicadores, resumo do topo e composição do que está por pagar. */
function renderSummary() {
  const el = root.querySelector("[data-kpis]");
  if (S.loading) {
    el.innerHTML = Array.from({ length: 5 }, () => `<div class="fo-kpi" style="cursor:default"><span class="fo-skel" style="width:60%"></span><span class="fo-skel" style="width:80%;height:22px;margin-top:.4rem"></span><span class="fo-skel" style="width:40%"></span></div>`).join("");
    renderOverview(null);
    renderHeroBadge(null);
    return;
  }
  const m = summarize();
  const { open, late, week, credit, paid, sum } = m;
  const n = (arr) => `${arr.length} pagamento${arr.length === 1 ? "" : "s"}`;
  const k = S.f.kpi;
  el.innerHTML = [
    kpiCard({ key: "open", label: "Por pagar", iconName: "account_balance_wallet", value: compact(sum(open, (p) => p.openAmount)), sub: n(open), active: k === "open" }),
    kpiCard({ key: "late", label: "Em atraso", iconName: "warning", tone: "bad", value: compact(sum(late, (p) => p.openAmount)), sub: n(late), active: k === "late" }),
    kpiCard({ key: "week", label: "Vence em 7 dias", iconName: "event_upcoming", tone: "warn", value: compact(sum(week, (p) => p.openAmount)), sub: n(week), active: k === "week" }),
    kpiCard({ key: "credit", label: "A crédito", iconName: "credit_score", tone: "info", value: compact(sum(credit, (p) => p.openAmount)), sub: n(credit), active: k === "credit" }),
    kpiCard({ key: "paid", label: "Pago", iconName: "task_alt", tone: "good", value: compact(sum(paid, (p) => p.paidAmount)), sub: n(paid), active: k === "paid" }),
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
      ? `<span class="fo-hero-dot is-alert"></span><span>Resumo indisponível</span>`
      : `<span class="fo-hero-dot"></span><span>A preparar resumo…</span>`;
    return;
  }
  const total = m.sum(m.open, (p) => p.openAmount);
  if (!m.open.length) {
    badge.innerHTML = `<span class="fo-hero-dot is-ok"></span><span>Nada por pagar</span>`;
    return;
  }
  badge.innerHTML = `<span class="fo-hero-dot ${m.late.length ? "is-alert" : "is-ok"}"></span><span><b>${m.open.length}</b> por pagar</span><span class="fo-hero-sep"></span><span class="fo-num"><b>${compact(total)}</b> AOA</span>${m.late.length ? `<span class="fo-hero-late">${m.late.length} em atraso</span>` : ""}`;
}

/** Faixa de resumo: composição do que está por pagar + próximo vencimento. */
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
  const lateV = m.sum(m.late, (p) => p.openAmount);
  const weekV = m.sum(m.week, (p) => p.openAmount);
  const laterV = m.sum(m.later, (p) => p.openAmount);
  const total = lateV + weekV + laterV;
  const pct = (v) => (total > 0 ? Math.max((v / total) * 100, v > 0 ? 1.5 : 0).toFixed(2) : 0);
  const seg = (cls, v) => (v > 0 ? `<span class="fo-seg ${cls}" style="width:${pct(v)}%" title="${esc(cls === "is-late" ? "Em atraso" : cls === "is-soon" ? "Vence em 7 dias" : "Mais tarde")}: ${money(v)} AOA"></span>` : "");
  const legend = `<ul class="fo-overview-legend">
      <li><i class="fo-ol-dot is-late"></i><span>Em atraso</span><b class="fo-num">${compact(lateV)}</b><small>${m.late.length} ped.</small></li>
      <li><i class="fo-ol-dot is-soon"></i><span>Vence em 7 dias</span><b class="fo-num">${compact(weekV)}</b><small>${m.week.length} ped.</small></li>
      <li><i class="fo-ol-dot is-later"></i><span>Mais tarde</span><b class="fo-num">${compact(laterV)}</b><small>${m.later.length} ped.</small></li>
    </ul>`;
  const nxt = m.next;
  let nextHtml;
  if (!nxt) {
    nextHtml = `<div class="fo-overview-next is-empty">
      <span class="fo-next-empty-icon">${icon("task_alt")}</span>
      <b>Tudo em dia</b>
      <span>Não há pagamentos pendentes${m.paid.length ? ` — ${m.paid.length} já pago${m.paid.length === 1 ? "" : "s"}` : ""}.</span>
    </div>`;
  } else {
    const diff = nxt.nextDue ? daysBetween(nxt.nextDue, S.today) : null;
    const whenTxt = diff === null ? "sem data" : diff < 0 ? `${Math.abs(diff)} d de atraso` : diff === 0 ? "vence hoje" : diff === 1 ? "vence amanhã" : `vence em ${diff} dias`;
    const whenTone = diff !== null && diff < 0 ? "is-late" : diff !== null && diff <= 3 ? "is-soon" : "";
    nextHtml = `<div class="fo-overview-next">
      <div class="fo-next-head">
        <p class="fo-overview-kicker">${diff !== null && diff < 0 ? "Mais atrasado" : "Próximo vencimento"}</p>
        <span class="fo-next-when ${whenTone}">${esc(whenTxt)}</span>
      </div>
      <div class="fo-next-body">
        <span class="fo-next-mark">${esc(nxt.supplierName ? initials(nxt.supplierName).slice(0, 2) : "—")}</span>
        <div class="fo-next-info">
          <b title="${esc(nxt.supplierName || "")}">${esc(nxt.supplierName || "Sem terceiro")}</b>
          <small>${esc(nxt.number)} · ${esc(nxt.typeLabel || nxt.typeCode)} · ${esc(fmtDate(nxt.nextDue))}</small>
        </div>
      </div>
      <div class="fo-next-foot">
        <div class="fo-next-amount"><small>Em aberto</small><b class="fo-num">${money(nxt.openAmount)}</b></div>
        <button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-next-open="${esc(nxt.id)}">${icon("arrow_forward")}Ver pedido</button>
      </div>
    </div>`;
  }
  el.innerHTML = `<div class="fo-overview-main">
      <div class="fo-overview-head">
        <div>
          <p class="fo-overview-kicker">Composição</p>
          <h3 class="fo-overview-title">O que está por pagar</h3>
        </div>
        <span class="fo-overview-total">${money(total)} <small>AOA</small></span>
      </div>
      ${total > 0 ? `<div class="fo-overview-bar" role="img" aria-label="Composição do valor por pagar: ${esc(compact(lateV))} em atraso, ${esc(compact(weekV))} a vencer em 7 dias, ${esc(compact(laterV))} mais tarde">${seg("is-late", lateV)}${seg("is-soon", weekV)}${seg("is-later", laterV)}</div>${legend}` : `<div class="fo-overview-empty">${icon("check_circle")}<span>Sem valores em aberto${m.paid.length ? ` — ${m.paid.length} pagamento${m.paid.length === 1 ? "" : "s"} concluído${m.paid.length === 1 ? "" : "s"}` : ""}.</span></div>`}
    </div>${nextHtml}`;
}

// ─── barra de filtros ────────────────────────────────────────────────────────

function monthOptions() {
  const set = new Set();
  S.items.forEach((pr) => {
    const d = refDate(pr);
    if (d) set.add(d.slice(0, 7));
  });
  set.add(S.today.slice(0, 7));
  return [...set].sort().reverse().slice(0, 24);
}

function typeOptions() {
  return PAY_TYPES.map((t) => ({ value: t.code, label: t.label, hint: t.soon ? "em preparação" : "", disabled: t.soon }));
}

function cardOptions() {
  return (S.opts.cards || []).map((c) => ({ value: c.id, label: cardLabel(c), hint: c.fund || "" }));
}

function ccOptionsList() {
  return (S.opts.costCenters || []).map((c) => ({ value: c.code, label: c.code === "CC-SEDE" ? "Sede (custos gerais)" : c.code === "CC-FROTA" ? "Frota e equipamentos" : c.name, group: { SEDE: "Estrutura", FROTA: "Estrutura", OUTRO: "Centros gerais", OBRA: "Obras" }[c.type] }));
}

function renderToolbar() {
  const f = S.f;
  const el = root.querySelector("[data-toolbar]");
  const months = monthOptions();
  const pendN = {
    inv: S.items.filter((p) => p.paidAmount > 0 && p.docState.invoiceNeeded && !p.docState.invoices).length,
    proof: S.items.filter((p) => p.paidAmount > 0 && !p.docState.proofs).length,
  };
  const anyFilter = f.q || f.types.length || f.cards.length || f.ccs.length || f.cond || f.noInvoice || f.noProof || f.month || f.state !== "Por pagar" || f.kpi;
  el.innerHTML = `
    <div class="fo-toolbar-row">
      <label class="fo-search">${icon("search")}<input data-q value="${esc(f.q)}" placeholder="Pesquisar n.º, terceiro, descrição, valor…"><span class="fo-kbd">/</span></label>
      ${multiFilterHtml("types", "Tipos", f.types, typeOptions(), { allLabel: "Todos os tipos" })}
      ${multiFilterHtml("cards", "Contas", f.cards, cardOptions(), { allLabel: "Todas as contas" })}
      <select class="fo-select ${f.state !== "Por pagar" && f.state ? "is-on" : ""}" data-state title="Estado">
        <option value="">Todos os estados</option>
        ${STATES.map((s) => `<option value="${esc(s)}" ${f.state === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
      </select>
      ${multiFilterHtml("ccs", "Centros de custo", f.ccs, ccOptionsList(), { allLabel: "Centros de custo" })}
      <select class="fo-select ${f.cond ? "is-on" : ""}" data-cond title="Condição de pagamento">
        <option value="">Todas as condições</option>
        <option value="PRONTO" ${f.cond === "PRONTO" ? "selected" : ""}>Pronto Pagamento</option>
        <option value="CREDITO" ${f.cond === "CREDITO" ? "selected" : ""}>A Crédito</option>
      </select>
    </div>
    <div class="fo-toolbar-row">
      <span class="fo-tool-label">Período</span>
      <select class="fo-select" data-ref title="Data de referência do período">
        <option value="due" ${f.ref === "due" ? "selected" : ""}>Por vencimento</option>
        <option value="request" ${f.ref === "request" ? "selected" : ""}>Por data do pedido</option>
        <option value="paid" ${f.ref === "paid" ? "selected" : ""}>Por data de pagamento</option>
      </select>
      <select class="fo-select ${f.month ? "is-on" : ""}" data-month title="Período">
        <option value="">Todos os meses</option>
        ${months.map((m) => `<option value="${m}" ${f.month === m ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}
        <option value="range" ${f.month === "range" ? "selected" : ""}>Intervalo de datas…</option>
      </select>
      ${f.month === "range" ? `<input type="date" class="fo-select" data-from value="${esc(f.from)}" style="padding-right:.6rem"><span class="fo-faint">até</span><input type="date" class="fo-select" data-to value="${esc(f.to)}" style="padding-right:.6rem">` : ""}
      <span class="fo-toolbar-sep fo-hide-md"></span>
      <span class="fo-tool-label">Pendências</span>
      <label class="fo-check ${f.noInvoice ? "is-on" : ""}"><input type="checkbox" data-noinv ${f.noInvoice ? "checked" : ""}>Pagos sem fatura <b>${pendN.inv}</b></label>
      <label class="fo-check ${f.noProof ? "is-on" : ""}"><input type="checkbox" data-noproof ${f.noProof ? "checked" : ""}>Pagos sem comprovativo <b>${pendN.proof}</b></label>
      ${anyFilter ? `<button type="button" class="fo-clear" data-clear>${icon("filter_alt_off")}limpar filtros</button>` : ""}
    </div>`;
}

// ─── tabela ──────────────────────────────────────────────────────────────────

function docCell(kind, pr) {
  const ds = pr.docState;
  if (kind === "PP") {
    if (pr.mode === "FM") return `<span class="fo-doc is-na" title="Não se aplica">${icon("remove")}</span>`;
    if (ds.proforma) return `<button type="button" class="fo-doc is-ok" data-doc="pp-open" title="Abrir a proforma">${icon("description")}</button>`;
    if (ds.proformaNeeded) return `<button type="button" class="fo-doc is-missing" data-doc="pp-up" title="Proforma em falta — carregar">${icon("priority_high")}</button>`;
    return `<button type="button" class="fo-doc" data-doc="pp-up" title="Carregar proforma (opcional)">${icon("add")}</button>`;
  }
  if (kind === "CP") {
    if (ds.proof) return `<button type="button" class="fo-doc is-ok" data-doc="cp-open" title="Abrir o comprovativo${ds.proofs > 1 ? ` (${ds.proofs})` : ""}">${icon("verified")}${ds.proofs > 1 ? `<span class="fo-doc-count">${ds.proofs}</span>` : ""}</button>`;
    if (pr.paidAmount > 0) return `<button type="button" class="fo-doc is-missing" data-doc="cp-up" title="Pago sem comprovativo — anexa-se na Conciliação Bancária (ou clique para anexar)">${icon("priority_high")}</button>`;
    return `<span class="fo-doc is-na" title="Anexa-se na conciliação">—</span>`;
  }
  // FT
  if (ds.invoices) return `<button type="button" class="fo-doc is-ok" data-doc="ft" title="${ds.invoiceDsc ? "Despesa sem comprovativo" : `${ds.invoices} fatura(s)`}">${icon(ds.invoiceDsc ? "money_off" : "receipt_long")}${ds.invoices > 1 ? `<span class="fo-doc-count">${ds.invoices}</span>` : ""}</button>`;
  if (ds.invoiceNeeded && pr.paidAmount > 0) return `<button type="button" class="fo-doc is-missing" data-doc="ft" title="Pago sem fatura — anexar">${icon("priority_high")}</button>`;
  if (["Por aprovar", "Em cotação", "Rejeitado"].includes(pr.status)) return `<span class="fo-doc is-na" title="Depois do pagamento">—</span>`;
  return `<button type="button" class="fo-doc" data-doc="ft" title="Anexar fatura">${icon("add")}</button>`;
}

function rowHtml(pr) {
  const late = pr.status === "Atrasado";
  const multi = (pr.items || []).length > 1;
  const open = S.expanded.has(pr.id);
  const ccTxt = ccLabel(pr.costCenterCode, S.opts);
  const desc = pr.notes || (pr.sourceRef ? `${pr.sourceMeta?.sourceLabel || ""}${pr.sourceMeta?.docNumber ? ` · ${pr.sourceMeta.docNumber}` : ""}` : pr.kindLabel);
  const first = pr.items?.[0];
  const cur = pr.currency !== "AOA" ? ` <small class="fo-faint">${esc(pr.currency)}</small>` : "";
  const partial = pr.paidAmount > 0 && pr.openAmount > 0;
  const issued = `Abrir a requisição · emitida a ${fmtDate(pr.requestDate)} por ${pr.requestedBy || "—"}`;
  let html = `<tr class="is-row ${late ? "is-late" : ""} ${pr.status === "Rejeitado" ? "is-dim" : ""}" data-id="${esc(pr.id)}">
    <td><button type="button" class="fo-link fo-ref" data-open title="${esc(issued)}">${esc(pr.number)}</button>${pr.sourceRef ? `<span class="fo-cell-sub" title="Vem de outro ecrã do InfoCliente">${icon("link")} ${esc(pr.sourceMeta?.sourceLabel || pr.sourceType)}</span>` : ""}</td>
    <td class="fo-num ${late ? "fo-red" : ""}" style="font-weight:${late ? 800 : 500}">${fmtDate(pr.nextDue)}${late && pr.daysLate > 0 ? `<span class="fo-cell-sub fo-red">${pr.daysLate} d de atraso</span>` : ""}</td>
    <td><span class="fo-tag ${pr.typeCode === "PF" ? "fo-tag--navy" : "fo-tag--violet"}" title="${esc(pr.kindLabel)} · ${esc(pr.typeLabel)}">${esc(pr.typeCode)}</span></td>
    <td><span class="fo-tag" title="${esc(pr.costCenterCode || "")}">${esc(ccTxt)}</span>${pr.splits?.length > 1 ? `<span class="fo-cell-sub">+${pr.splits.length - 1} CC</span>` : ""}</td>
    <td><div class="fo-supplier"><span class="fo-supplier-mark">${esc(pr.supplierName ? initials(pr.supplierName).slice(0, 2) : "—")}</span><span class="fo-supplier-text"><span class="fo-cell-main" title="${esc(pr.supplierName || "")}">${esc(pr.supplierName || "—")}</span><span class="fo-cell-sub" title="${esc(desc || "")}">${esc(desc || "")}</span></span></div></td>
    <td class="ta-c"><button type="button" class="fo-doc ${pr.supplierIban || pr.fundCardId ? "is-ok" : ""}" data-dest title="Dados para pagamento" data-fo-keep-pop>${icon(pr.mode === "FM" ? "credit_card" : "account_balance")}</button></td>
    <td>${
      multi
        ? `<button type="button" class="fo-link fo-link--muted" data-expand>${icon(open ? "expand_more" : "chevron_right")} Ver detalhe · ${pr.items.length} produtos</button>`
        : `<span class="fo-cell-main" style="font-weight:500;max-width:220px" title="${esc(first?.description || "")}">${esc(first?.description || "—")}</span>${first && first.quantity !== 1 ? `<span class="fo-cell-sub">${String(first.quantity).replace(".", ",")} ${esc(first.unit)}</span>` : ""}`
    }</td>
    <td class="ta-r fo-num"><b style="color:var(--fo-ink)">${money(pr.totalAmount)}</b>${cur}${partial ? `<span class="fo-cell-sub fo-amber" style="font-weight:700">falta ${money(pr.openAmount)}</span>` : ""}</td>
    <td><button type="button" class="fo-state-btn" data-state-menu data-fo-keep-pop title="Mudar o estado">${pill(pr.status)}${icon("expand_more")}</button></td>
    <td class="ta-c">${docCell("PP", pr)}</td>
    <td class="ta-c">${docCell("CP", pr)}</td>
    <td class="ta-c">${docCell("FT", pr)}</td>
    <td class="ta-c"><span class="fo-avatar" title="${esc(pr.requestedBy || "")}">${esc(initials(pr.requestedBy))}</span></td>
  </tr>`;
  if (multi && open) {
    html += pr.items
      .map(
        (i) => `<tr class="is-sub"><td></td><td colspan="5" class="fo-faint" style="text-align:right">${esc(i.code || "")}</td><td><b style="color:var(--fo-ink-2)">${esc(i.description)}</b>${i.notes ? `<span class="fo-cell-sub">${esc(i.notes)}</span>` : ""}</td><td class="ta-r fo-num">${String(i.quantity).replace(".", ",")} ${esc(i.unit)} × ${money(i.unitPrice)}<span class="fo-cell-sub">${money(i.total)} s/ IVA · IVA ${i.vatPercent}%</span></td><td colspan="5"></td></tr>`
      )
      .join("");
  }
  return html;
}

function thSort(key, label, cls = "") {
  const on = S.sort.key === key;
  return `<th class="is-sortable ${cls}" data-sort="${key}">${label}${on ? icon(S.sort.dir > 0 ? "arrow_upward" : "arrow_downward", "fo-sort") : ""}</th>`;
}

function renderTable() {
  const tbl = root.querySelector("[data-table]");
  const head = root.querySelector("[data-head]");
  const thead = `<thead><tr>${thSort("number", "Requisição")}${thSort("due", "Venc.")}<th>Tipo</th><th>CC</th>${thSort("supplier", "Terceiro / Descrição")}<th class="ta-c">Destino</th><th>Produto</th>${thSort("amount", "V. a pagar <span class='fo-faint' style='text-transform:none;letter-spacing:0'>c/IVA s/RF</span>", "ta-r")}${thSort("status", "Estado")}<th class="ta-c" title="Proforma">PP</th><th class="ta-c" title="Comprovativo de pagamento">CP</th><th class="ta-c" title="Fatura">FT</th><th class="ta-c">Util.</th></tr></thead>`;
  if (S.loading) {
    tbl.innerHTML = `${thead}<tbody>${skeletonRows(13, 7)}</tbody>`;
    head.innerHTML = `<span>A carregar requisições…</span>`;
    return;
  }
  if (S.error) {
    tbl.innerHTML = `<tbody><tr><td>${emptyState({ iconName: "cloud_off", title: "Não foi possível carregar", text: esc(S.error), action: `<button type="button" class="fo-btn fo-btn--ghost" data-retry>${icon("refresh")}Tentar de novo</button>` })}</td></tr></tbody>`;
    head.innerHTML = "";
    return;
  }
  const list = filtered();
  const total = list.reduce((a, p) => a + (isOpen(p) ? p.openAmount : p.totalAmount), 0);
  head.innerHTML = `<span class="fo-head-info"><span class="fo-head-count">${list.length}</span><span>${list.length === 1 ? "pedido" : "pedidos"} na lista</span>${S.f.kpi ? `<span class="fo-head-filter">${esc({ open: "Por pagar", late: "Em atraso", week: "Vence em 7 dias", credit: "A crédito", paid: "Pago" }[S.f.kpi])}<button type="button" class="fo-link fo-link--muted" data-kpi-off title="Tirar o filtro">${icon("close")}</button></span>` : ""}</span><span class="fo-head-total"><span>Valor</span><b class="fo-num">${money(total)}</b><small>AOA</small>${list.some((p) => p.currency !== "AOA") ? '<span class="fo-faint">+ divisas</span>' : ""}</span>`;
  if (!list.length) {
    const none = !S.items.length;
    tbl.innerHTML = `<tbody><tr><td>${emptyState({
      iconName: none ? "receipt_long" : "filter_alt_off",
      title: none ? "Ainda não há requisições de pagamento" : "Nenhum pedido com estes filtros",
      text: none ? "Crie a primeira requisição — ou aguarde que os custos das obras e as compras aprovadas apareçam aqui." : "Experimente outro estado ou limpe os filtros.",
      action: none ? (can("financeiro", "edit") ? `<button type="button" class="fo-btn fo-btn--primary" data-new-empty>${icon("add")}Nova Requisição de Pagamento</button>` : "") : `<button type="button" class="fo-btn fo-btn--ghost" data-clear>${icon("filter_alt_off")}Limpar filtros</button>`,
    })}</td></tr></tbody>`;
    return;
  }
  tbl.innerHTML = `${thead}<tbody>${list.map(rowHtml).join("")}</tbody>`;
}

function renderAll() {
  renderSummary();
  renderToolbar();
  renderTable();
}

// ─── ações ───────────────────────────────────────────────────────────────────

function upsert(item, removedId) {
  if (removedId) S.items = S.items.filter((i) => i.id !== removedId);
  if (item) {
    const i = S.items.findIndex((x) => x.id === item.id);
    if (i >= 0) S.items[i] = item;
    else S.items.unshift(item);
  }
  renderSummary();
  renderToolbar();
  renderTable();
}

function newRequest() {
  if (!can("financeiro", "edit")) return;
  openRequestForm({ onSaved: (item) => upsert(item) });
}

function openDetail(pr) {
  openRequestDetail(pr, { onChange: (item, removedId) => upsert(item, removedId) });
}

function showDestination(anchor, pr) {
  const card = S.opts.cards?.find((c) => c.id === pr.fundCardId);
  const rows =
    pr.mode === "FM"
      ? [
          ["Beneficiário", card ? cardLabel(card) : pr.supplierName || "Fundo de maneio"],
          ["Titular", card?.holder || null],
          ["Banco", card?.bank || null],
          ["Cartão", card?.lastDigits ? `•••• ${card.lastDigits}` : null],
        ]
      : [
          ["Beneficiário", pr.supplierName],
          ["NIF", pr.supplierNif],
          ["Banco", pr.supplierBank],
          ["IBAN", pr.supplierIban ? formatIban(pr.supplierIban) : null],
          ["N.º de conta", accountFromIban(pr.supplierIban)],
        ];
  const html = `<div class="fo-paydata">
    <h4>${esc(pr.number)} · dados para pagamento</h4>
    <dl>${rows
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ? `<button type="button" data-copy="${esc(String(v).replace(/\s+/g, k === "IBAN" ? "" : " "))}" data-label="${esc(k)}">${esc(v)}</button>` : '<span class="fo-faint" style="display:block;padding:.4rem .5rem">—</span>'}</dd>`)
      .join("")}
      <dt>Valor a pagar</dt><dd><button type="button" data-copy="${pr.openAmount.toFixed(2)}" data-label="Valor"><b style="font-size:15px">${money(pr.openAmount)} ${esc(pr.currency)}</b></button></dd>
    </dl>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.6rem;gap:.5rem">
      <p class="fo-paydata-hint" style="margin:0">Clique em qualquer dado para o copiar.</p>
      <button type="button" class="fo-btn fo-btn--ghost fo-btn--xs" data-copy="${pr.openAmount.toFixed(2)}" data-label="Valor">${icon("content_copy")}Copiar valor</button>
    </div>
    ${pr.mode === "FORN" && !pr.supplierIban ? `<div class="fo-note fo-note--warn" style="margin-top:.6rem">${icon("warning")}<span>Sem IBAN — complete os dados do terceiro (Editar).</span></div>` : ""}
  </div>`;
  const el = popCard(anchor, html, { width: 360 });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (b) copyText(b.dataset.copy, `${b.dataset.label} copiado`);
  });
}

function bindEvents() {
  root.addEventListener("click", (e) => {
    const t = e.target;
    const kpi = t.closest("[data-kpi]");
    if (kpi) {
      S.f.kpi = S.f.kpi === kpi.dataset.kpi ? "" : kpi.dataset.kpi;
      renderSummary();
      renderToolbar();
      renderTable();
      return;
    }
    if (t.closest("[data-kpi-off]")) {
      S.f.kpi = "";
      return renderAll();
    }
    if (t.closest("[data-retry]")) {
      S.loading = true;
      renderAll();
      return load().then(renderAll);
    }
    if (t.closest("[data-new-empty]")) return newRequest();
    if (t.closest("[data-clear]")) {
      S.f = { ...DEFAULT_FILTERS };
      saveFilters();
      return renderAll();
    }
    const mf = t.closest("[data-mf]");
    if (mf) {
      const key = mf.dataset.mf;
      const conf = {
        types: { title: "Tipo de pagamento", options: typeOptions(), allLabel: "Todos os tipos" },
        cards: { title: "Conta / cartão", options: cardOptions(), allLabel: "Todas as contas" },
        ccs: { title: "Centro de custo", options: ccOptionsList(), allLabel: "Todos os centros de custo" },
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
      const nextPr = S.items.find((i) => i.id === nextBtn.dataset.nextOpen);
      if (nextPr) openDetail(nextPr);
      return;
    }
    const th = t.closest("[data-sort]");
    if (th) {
      const k = th.dataset.sort;
      S.sort = S.sort.key === k ? { key: k, dir: -S.sort.dir } : { key: k, dir: k === "amount" ? -1 : 1 };
      return renderTable();
    }
    const tr = t.closest("tr[data-id]");
    if (!tr) return;
    const pr = S.items.find((i) => i.id === tr.dataset.id);
    if (!pr) return;
    if (t.closest("[data-expand]")) {
      if (S.expanded.has(pr.id)) S.expanded.delete(pr.id);
      else S.expanded.add(pr.id);
      return renderTable();
    }
    if (t.closest("[data-dest]")) return showDestination(t.closest("[data-dest]"), pr);
    if (t.closest("[data-state-menu]")) return openStateMenu(t.closest("[data-state-menu]"), pr, { onDone: (item) => upsert(item), onOpen: () => openDetail(pr) });
    const doc = t.closest("[data-doc]");
    if (doc) {
      const d = doc.dataset.doc;
      if (d === "pp-open") return window.open(fileUrl(pr.docState.proforma.path), "_blank", "noopener");
      if (d === "cp-open") return window.open(fileUrl(pr.docState.proof.path), "_blank", "noopener");
      if (d === "pp-up") return uploadRequestDoc(pr, "PROFORMA", { onDone: (item) => upsert(item) });
      if (d === "cp-up") return uploadRequestDoc(pr, "COMPROVATIVO", { accept: ".pdf,application/pdf", onDone: (item) => upsert(item) });
      if (d === "ft") return openInvoicesDialog(pr, { onDone: (item) => upsert(item) });
      return;
    }
    if (t.closest("[data-open]")) return openDetail(pr);
    if (t.closest("button, a, input, select")) return;
    openDetail(pr);
  });

  let qTimer = null;
  root.addEventListener("input", (e) => {
    if (e.target.matches("[data-q]")) {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        S.f.q = e.target.value;
        renderSummary();
        renderTable();
      }, 120);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.matches("[data-q]") && e.key === "Escape" && e.target.value) {
      e.target.value = "";
      S.f.q = "";
      renderSummary();
      renderTable();
    }
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-state]")) {
      S.f.state = t.value;
      S.f.kpi = "";
    } else if (t.matches("[data-cond]")) S.f.cond = t.value;
    else if (t.matches("[data-ref]")) S.f.ref = t.value;
    else if (t.matches("[data-month]")) {
      S.f.month = t.value;
      if (t.value === "range" && !S.f.from) {
        S.f.from = `${S.today.slice(0, 7)}-01`;
        S.f.to = addDays(S.today, 30);
      }
    } else if (t.matches("[data-from]")) S.f.from = t.value;
    else if (t.matches("[data-to]")) S.f.to = t.value;
    else if (t.matches("[data-noinv]")) S.f.noInvoice = t.checked;
    else if (t.matches("[data-noproof]")) S.f.noProof = t.checked;
    else return;
    saveFilters();
    renderAll();
  });

  // Atualiza ao voltar à página (pagamentos feitos noutro separador / ecrã).
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || document.querySelector(".fo-drawer-root, .fo-dialog-root")) return;
    await load();
    closePopovers();
    renderAll();
  });
}

// ─── exportar ────────────────────────────────────────────────────────────────

function exportList() {
  const list = filtered();
  if (!list.length) return toast("Não há pedidos na lista para exportar.", { type: "error" });
  const header = ["Requisição", "Data do pedido", "Vencimento", "Tipo", "Centro de custo", "Obra", "Terceiro", "NIF", "IBAN", "Descrição", "Produtos", "Moeda", "Total s/ IVA", "IVA", "Retenção", "Total a pagar", "Pago", "Em dívida", "Estado", "Condição", "Proforma", "Comprovativo", "Faturas", "Pedido por", "Origem"];
  const rows = list.map((pr) => [
    pr.number,
    pr.requestDate,
    pr.nextDue || "",
    pr.typeCode,
    pr.costCenterCode || "",
    pr.project ? `${pr.project.code} · ${pr.project.name}` : "",
    pr.supplierName || "",
    pr.supplierNif || "",
    pr.supplierIban || "",
    pr.notes || "",
    (pr.items || []).map((i) => `${i.description} (${i.quantity} ${i.unit})`).join("; "),
    pr.currency,
    pr.baseAmount,
    pr.vatAmount,
    pr.withholdingAmount,
    pr.totalAmount,
    pr.paidAmount,
    pr.openAmount,
    pr.status,
    { PRONTO: "Pronto pagamento", CREDITO: "Crédito", PARCIAL: "Parcelas" }[pr.condition] || "",
    pr.docState.proforma ? "Sim" : "Não",
    pr.docState.proofs ? "Sim" : "Não",
    pr.docState.invoices,
    pr.requestedBy || "",
    pr.sourceRef ? pr.sourceMeta?.sourceLabel || pr.sourceType : "",
  ]);
  exportXlsx(`centro-pagamentos-${S.today}.xlsx`, "Centro de Pagamentos", header, rows, [12, 11, 11, 7, 12, 22, 28, 12, 28, 30, 40, 6, 14, 12, 12, 14, 14, 14, 12, 14, 9, 11, 8, 18, 18]);
}
