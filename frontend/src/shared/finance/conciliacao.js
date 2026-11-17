/**
 * T2 — Conciliação Bancária (igual ao MBT, com o estilo do InfoCliente).
 * Cada movimento do extrato recebe um tipo e liga-se ao que o explica:
 * pedido do Centro de Pagamentos, fatura emitida, transferência entre contas,
 * encargos bancários (automático), devolução ou um motivo sem pedido.
 */
import {
  apiRequest,
  apiUpload,
  toast,
  esc,
  num,
  round2,
  money,
  compact,
  initials,
  parseMoney,
  fmtDate,
  monthLabel,
  todayKey,
  norm,
  icon,
  pill,
  emptyState,
  skeletonRows,
  openDrawer,
  ask,
  popMenu,
  popCard,
  closePopovers,
  fileZoneHtml,
  bindFileZones,
  bindMoney,
  setBusy,
  errMsg,
  fileUrl,
  pickFiles,
  loadXlsx,
} from "./fin.js";
import { openRequestForm, invoiceRowsEditor } from "./paymentRequestUi.js";
import { openInvoiceForm } from "./invoiceForm.js";
import { can } from "../permissions.js";

const BASE = "/finance/reconciliation";
const P1_URL = "/Financeiro/contas-pagar/centro-pagamentos";
const R1_URL = "/Financeiro/contas-receber/centro-recebimentos";
const NO_PROOF_TYPES = ["TRF INT", "ENC"];
const JOIN_DAYS = 45;

const S = {
  items: [],
  meta: { types: [], cards: [], rules: [], subtypes: [], noRequestReasons: [] },
  loading: true,
  error: null,
  f: { card: "", month: "", type: "", q: "", onlyOpen: false },
  selected: new Set(),
  invoiceTarget: null,
};
let root;
const canEdit = () => can("financeiro", "edit");

// ─── arranque ────────────────────────────────────────────────────────────────

export async function render() {
  root = document.getElementById("financeRoot");
  renderHeaderActions();
  root.innerHTML = `<div class="fo-root">
    <div data-banner></div>
    <div class="fo-overview" data-overview></div>
    <div class="fo-toolbar fo-conc-toolbar" data-toolbar></div>
    <div data-selbar></div>
    <div class="fo-card fo-table-card">
      <div class="fo-table-head" data-head></div>
      <div class="fo-table-scroll"><table class="fo-table fo-conc-table" data-table></table></div>
      <div class="fo-legend fo-flow" data-foot></div>
    </div>
    <div data-manual></div>
  </div>`;
  renderAll();
  bindEvents();
  await Promise.all([loadMeta(), loadMovements()]);
  const invId = new URLSearchParams(location.search).get("invoice");
  if (invId) await loadInvoiceTarget(invId);
  renderAll();
}

function renderHeaderActions() {
  const slot = document.getElementById("financePageActions");
  if (!slot) return;
  slot.innerHTML = `<div class="fo-actions">
    <span class="fo-hero-badge" data-hero-badge><span class="fo-hero-dot"></span><span>A preparar resumo…</span></span>
    ${canEdit() ? `<button type="button" class="fo-btn fo-btn--primary" data-import>${icon("upload")}Importar Extrato</button>` : ""}
    <button type="button" class="fo-btn fo-btn--ghost" data-rules>${icon("rule")}Regras de Classificação</button>
    <button type="button" class="fo-btn fo-btn--ghost" data-types>${icon("category")}Tipos e Subtipos</button>
  </div>`;
  slot.querySelector("[data-types]").addEventListener("click", openTypesDrawer);
  slot.querySelector("[data-rules]").addEventListener("click", openRulesDrawer);
  slot.querySelector("[data-import]")?.addEventListener("click", openImport);
}

async function loadMeta() {
  try {
    S.meta = await apiRequest(`${BASE}/meta`);
  } catch (err) {
    toast(errMsg(err, "Não foi possível carregar as contas."), { type: "error" });
  }
}

async function loadMovements() {
  S.loading = !S.items.length;
  try {
    const { items } = await apiRequest(`${BASE}/movements`);
    S.items = items || [];
    S.error = null;
  } catch (err) {
    S.error = errMsg(err, "Não foi possível carregar os movimentos.");
  }
  S.loading = false;
}

async function loadInvoiceTarget(id) {
  try {
    const { items } = await apiRequest("/finance/invoices");
    const inv = (items || []).find((i) => i.id === id);
    if (inv) {
      S.invoiceTarget = inv;
      S.f.onlyOpen = true;
      S.f.type = "";
    }
  } catch {
    /* ignore */
  }
}

async function refresh({ meta = false } = {}) {
  await Promise.all([loadMovements(), meta ? loadMeta() : null]);
  renderAll();
}

function upsert(item) {
  const i = S.items.findIndex((m) => m.id === item.id);
  if (i >= 0) S.items[i] = item;
  renderAll();
}

// ─── utilitários ─────────────────────────────────────────────────────────────

const cardOf = (id) => S.meta.cards.find((c) => c.id === id);
const cardName = (id) => cardOf(id)?.label || "—";
const typeOf = (code) => S.meta.types.find((t) => t.code === code);
const typeLabel = (code) => typeOf(code)?.label || code;
const typeShort = (code) => String(typeLabel(code)).split(" (")[0];
const subtypesOf = (code) => (S.meta.subtypes || []).filter((x) => x.typeCode === code);
const signedHtml = (m) => {
  const out = m.direction === "SAIDA";
  return `<span class="fo-num ${out ? "fo-amount-out" : "fo-amount-in"}">${out ? "−" : ""}${money(m.amount)}</span>`;
};
const daysApart = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

function inScope(m) {
  const f = S.f;
  if (f.card && m.cardId !== f.card) return false;
  if (f.month && m.movementDate.slice(0, 7) !== f.month) return false;
  return true;
}

/** Por conciliar: sem conciliação, ou conciliado mas a faltar o comprovativo. */
const isOpen = (m) => !m.reconciled || m.proofMissing;

function filtered() {
  const f = S.f;
  const q = norm(f.q);
  return S.items.filter((m) => {
    if (!inScope(m)) return false;
    if (f.onlyOpen && !isOpen(m)) return false;
    if (f.type === "__blank" && m.typeCode) return false;
    if (f.type && f.type !== "__blank" && m.typeCode !== f.type) return false;
    if (S.invoiceTarget && m.direction !== "ENTRADA") return false;
    if (q) {
      const hay = norm([m.description, m.note, m.docNumber, m.cardLabel, m.typeCode, m.subtype, m.paymentRequest?.number, m.paymentRequest?.supplierName, ...(m.receipts || []).map((r) => `${r.invoiceNumber} ${r.client}`), money(m.amount), String(m.amount)].join(" "));
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

// ─── resumo ──────────────────────────────────────────────────────────────────

function summarize() {
  const scope = S.items.filter(inScope);
  const open = scope.filter(isOpen);
  const amt = (m) => Math.abs(num(m.amount));
  const sum = (arr, fn) => arr.reduce((acc, x) => acc + fn(x), 0);
  const noProof = open.filter((m) => m.proofMissing);
  const rest = open.filter((m) => !m.proofMissing);
  const trf = rest.filter((m) => m.typeCode === "TRF INT");
  const blank = rest.filter((m) => !m.typeCode);
  const other = rest.filter((m) => m.typeCode && m.typeCode !== "TRF INT");
  const inSum = sum(scope.filter((m) => m.direction === "ENTRADA"), amt);
  const outSum = sum(scope.filter((m) => m.direction === "SAIDA"), amt);
  const card = S.f.card ? cardOf(S.f.card) : null;
  const activeCards = S.meta.cards.filter((c) => c.active !== false);
  const balance = card ? num(card.balance) : sum(activeCards, (c) => num(c.balance));
  return { scope, open, noProof, trf, blank, other, inSum, outSum, card, activeCards, balance, sum, amt };
}

/** Faixa de resumo + badge do cabeçalho. */
function renderSummary() {
  if (S.loading) {
    renderOverview(null);
    renderHeroBadge(null);
    return;
  }
  const m = summarize();
  renderOverview(m);
  renderHeroBadge(m);
}

function renderHeroBadge(m) {
  const badge = document.querySelector("#financePageActions [data-hero-badge]");
  if (!badge) return;
  if (!m) {
    badge.innerHTML = S.error ? `<span class="fo-hero-dot is-alert"></span><span>Resumo indisponível</span>` : `<span class="fo-hero-dot"></span><span>A preparar resumo…</span>`;
    return;
  }
  if (!m.open.length) {
    badge.innerHTML = `<span class="fo-hero-dot is-ok"></span><span>Tudo conciliado${m.scope.length ? ` · ${m.scope.length} mov.` : ""}</span>`;
    return;
  }
  const pending = m.sum(m.open, m.amt);
  badge.innerHTML = `<span class="fo-hero-dot ${m.noProof.length ? "is-alert" : "is-ok"}</span><span><b>${m.open.length}</b> por conciliar</span><span class="fo-hero-sep"></span><span class="fo-num"><b>${compact(pending)}</b></span>${m.blank.length ? `<span class="fo-hero-warn">${m.blank.length} sem tipo</span>` : ""}`;
}

/** Faixa de resumo: o que falta conciliar + conta em foco. */
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
  const noProofV = m.sum(m.noProof, m.amt);
  const blankV = m.sum(m.blank, m.amt);
  const trfV = m.sum(m.trf, m.amt);
  const otherV = m.sum(m.other, m.amt);
  const total = noProofV + blankV + trfV + otherV;
  const pct = (v) => (total > 0 ? Math.max((v / total) * 100, v > 0 ? 1.5 : 0).toFixed(2) : 0);
  const seg = (cls, v, label) => (v > 0 ? `<span class="fo-seg ${cls}" style="width:${pct(v)}%" title="${esc(label)}: ${money(v)} AOA"></span>` : "");
  const legend = `<ul class="fo-overview-legend fo-overview-legend--4">
      <li><i class="fo-ol-dot is-late"></i><span>Falta comprovativo</span><b class="fo-num">${compact(noProofV)}</b><small>${m.noProof.length} mov.</small></li>
      <li><i class="fo-ol-dot is-soon"></i><span>Sem tipo</span><b class="fo-num">${compact(blankV)}</b><small>${m.blank.length} mov.</small></li>
      <li><i class="fo-ol-dot is-trf"></i><span>Transferências</span><b class="fo-num">${compact(trfV)}</b><small>${m.trf.length} mov.</small></li>
      <li><i class="fo-ol-dot is-later"></i><span>Outros</span><b class="fo-num">${compact(otherV)}</b><small>${m.other.length} mov.</small></li>
    </ul>`;
  const c = m.card;
  const accName = c ? c.label : `${m.activeCards.length} conta${m.activeCards.length === 1 ? "" : "s"} ativa${m.activeCards.length === 1 ? "" : "s"}`;
  const period = S.f.month ? monthLabel(S.f.month) : "Todos os meses";
  const cardHtml = `<div class="fo-overview-next">
      <div class="fo-next-head">
        <p class="fo-overview-kicker">${c ? "Conta em foco" : "Todas as contas"}</p>
        <span class="fo-next-when ${m.open.length ? (m.noProof.length ? "is-late" : "is-soon") : ""}">${m.open.length ? `${m.open.length} por conciliar` : "tudo conciliado"}</span>
      </div>
      <div class="fo-next-body">
        <span class="fo-next-mark">${c ? esc(initials(c.bank || c.label).slice(0, 2)) : icon("account_balance")}</span>
        <div class="fo-next-info">
          <b title="${esc(accName)}">${esc(accName)}</b>
          <small>${esc(period)} · ${m.scope.length} movimento${m.scope.length === 1 ? "" : "s"}</small>
        </div>
      </div>
      <div class="fo-next-foot">
        <div class="fo-next-amount"><small>Saldo${c ? " da conta" : " consolidado"}</small><b class="fo-num">${money(m.balance)} <small>${esc(c?.currency || "AOA")}</small></b></div>
        <button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-acc-open data-fo-keep-pop>${icon("swap_horiz")}${c ? "Trocar conta" : "Escolher conta"}</button>
      </div>
    </div>`;
  el.innerHTML = `<div class="fo-overview-main">
      <div class="fo-overview-head">
        <div>
          <p class="fo-overview-kicker">Composição</p>
          <h3 class="fo-overview-title">O que falta conciliar</h3>
        </div>
        <span class="fo-overview-total">${money(total)} <small>AOA</small></span>
      </div>
      ${
        total > 0
          ? `<div class="fo-overview-bar" role="img" aria-label="Valor por conciliar: ${esc(compact(noProofV))} com comprovativo em falta, ${esc(compact(blankV))} sem tipo, ${esc(compact(trfV))} em transferências, ${esc(compact(otherV))} outros">${seg("is-late", noProofV, "Falta comprovativo")}${seg("is-soon", blankV, "Sem tipo")}${seg("is-trf", trfV, "Transferências")}${seg("is-later", otherV, "Outros")}</div>${legend}`
          : `<div class="fo-overview-empty">${icon("check_circle")}<span>Nada por conciliar ${S.f.card ? "nesta conta" : "no período"}${m.scope.length ? ` — ${m.scope.length} movimento${m.scope.length === 1 ? "" : "s"} tratado${m.scope.length === 1 ? "" : "s"}` : ""}.</span></div>`
      }
    </div>${cardHtml}`;
}

// ─── blocos ──────────────────────────────────────────────────────────────────

function renderBanner() {
  const el = root.querySelector("[data-banner]");
  const inv = S.invoiceTarget;
  el.innerHTML = inv
    ? `<div class="fo-note fo-note--good" style="align-items:center">${icon("sync_alt")}<span style="flex:1">A registar o recebimento da fatura <b>${esc(inv.docNumber || "")}</b> · ${esc(inv.client?.name || "")} · falta <b class="fo-num">${money(inv.missingAmount)}</b>. Escolha a <b>entrada do extrato</b> e clique em <b>⇄</b>.</span><button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-drop-target>${icon("close")}Cancelar</button></div>`
    : "";
}

function accountButtonLabel() {
  return S.f.card ? cardName(S.f.card) : "Todas as contas";
}

function openAccountPanel(anchor) {
  const groups = [
    ["MAIN", "Contas Principais"],
    ["FM", "Fundo de Maneio"],
  ];
  const cards = S.meta.cards.filter((c) => c.active !== false || S.items.some((m) => m.cardId === c.id));
  const btn = (id, label, sub = "") => `<button type="button" class="fo-acc-opt ${S.f.card === id ? "is-on" : ""}" data-acc="${esc(id)}"><span>${esc(label)}</span>${sub ? `<small>${sub}</small>` : ""}</button>`;
  const html = `${groups
    .map(([g, title]) => {
      const list = cards.filter((c) => (c.group || "MAIN") === g);
      if (!list.length) return "";
      return `<div class="fo-acc-group"><div class="fo-acc-title">${title}</div><div class="fo-acc-list">${list
        .map((c) => {
          const open = S.items.filter((m) => m.cardId === c.id && isOpen(m)).length;
          return btn(c.id, c.label, `${money(c.balance || 0)} ${esc(c.currency || "AOA")}${open ? ` · <b class="fo-amber">${open}</b> por conciliar` : ""}`);
        })
        .join("")}</div></div>`;
    })
    .join("")}<div class="fo-acc-group"><div class="fo-acc-list">${btn("", "Todas as contas")}</div></div>`;
  const pop = popCard(anchor, `<div class="fo-acc-panel">${html}</div>`, { width: 380 });
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    S.f.card = b.dataset.acc;
    S.selected.clear();
    closePopovers();
    renderAll();
  });
}

function renderToolbar() {
  const f = S.f;
  const months = [...new Set(S.items.map((m) => m.movementDate.slice(0, 7)))].sort().reverse();
  const scope = S.items.filter((m) => !f.card || m.cardId === f.card);
  const blankMonth = scope.filter((m) => !m.typeCode && (!f.month || m.movementDate.startsWith(f.month))).length;
  const blank = S.items.filter((m) => !m.typeCode).length;
  const encPend = scope.filter((m) => m.typeCode === "ENC" && !m.reconciled);
  const slPend = scope.filter((m) => ["SL", "AD SL"].includes(m.typeCode) && !m.reconciled).length;
  const trfReady = S.items.filter((m) => m.typeCode === "TRF INT" && !m.reconciled && m.transferCardId).length;
  const c = f.card ? cardOf(f.card) : null;
  root.querySelector("[data-toolbar]").innerHTML = `
    <div class="fo-toolbar-row">
      <span class="fo-acc-lbl">Conta / cartão:</span>
      <button type="button" class="fo-acc-btn ${f.card ? "is-on" : ""}" data-acc-open data-fo-keep-pop>${icon(f.card ? "credit_card" : "account_balance")}<span>${esc(accountButtonLabel())}</span>${icon("expand_more")}</button>
      ${c ? `<span class="fo-acc-saldo">Saldo ${esc(c.label)}: <b class="fo-num">${money(c.balance || 0)}</b> ${esc(c.currency || "AOA")}</span>` : ""}
    </div>
    <div class="fo-toolbar-row">
      <select class="fo-select ${f.month ? "is-on" : ""}" data-month><option value="">Todos os meses</option>${months.map((m) => `<option value="${m}" ${f.month === m ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select>
      <select class="fo-select ${f.type ? "is-on" : ""}" data-type>
        <option value="">Todos os tipos</option>
        <option value="__blank" ${f.type === "__blank" ? "selected" : ""}>— Sem tipo (em branco) · ${blankMonth} —</option>
        ${S.meta.types.map((t) => `<option value="${esc(t.code)}" ${f.type === t.code ? "selected" : ""}>${esc(t.code)} — ${esc(t.label)}</option>`).join("")}
      </select>
      <label class="fo-search">${icon("search")}<input type="search" data-q value="${esc(f.q)}" placeholder="Pesquisar…"></label>
      <label class="fo-check ${f.onlyOpen ? "is-on" : ""}"><input type="checkbox" data-only ${f.onlyOpen ? "checked" : ""}>só por conciliar</label>
    </div>
    ${
      canEdit()
        ? `<div class="fo-toolbar-row fo-conc-actions">
      ${encPend.length ? `<button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-enc-all title="Concilia de uma só vez todos os encargos bancários (comissões, IVA, juros, despesas) por conciliar">${icon("sync_alt")}Conciliar todos os encargos bancários (${encPend.length})</button>` : ""}
      <button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-apply-rules title="Classifica os movimentos sem tipo e volta a classificar os que foram classificados por regras (nunca os escolhidos à mão nem os conciliados)">${icon("autorenew")}Aplicar regras${blank ? ` (${blank} sem tipo)` : ""}</button>
      ${slPend ? `<button type="button" class="fo-btn fo-btn--soft fo-btn--sm" disabled title="Em preparação — depende do módulo de Salários">${icon("done_all")}Conciliar Salários (${slPend}) <span class="fo-soon">em preparação</span></button>` : ""}
      <button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-auto-trf ${trfReady ? "" : "disabled"} title="Concilia de uma vez as transferências internas com saída e entrada encontradas">${icon("done_all")}Conciliar Transferências Internas (${trfReady})</button>
    </div>`
        : ""
    }`;
}

function renderSelBar() {
  const el = root.querySelector("[data-selbar]");
  const list = [...S.selected].map((id) => S.items.find((m) => m.id === id)).filter(Boolean);
  if (!list.length) {
    el.innerHTML = "";
    return;
  }
  const tot = list.reduce((a, m) => a + (m.direction === "SAIDA" ? -m.amount : m.amount), 0);
  el.innerHTML = `<div class="fo-selbar"><b>${list.length} movimento(s) selecionado(s)</b><span>total <b class="fo-num">${money(tot)}</b></span>
    ${canEdit() ? `<button type="button" class="fo-btn fo-btn--primary fo-btn--sm" data-conc-sel>${icon("sync_alt")}Conciliar juntos com um pedido</button>` : ""}
    <button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-clear-sel>Limpar seleção</button></div>`;
}

// ─── células ─────────────────────────────────────────────────────────────────

function typeCell(m) {
  const locked = m.reconciled && m.reconcileKind !== "AUTO";
  const code = m.typeCode;
  const subs = code ? subtypesOf(code) : [];
  const dis = locked || !canEdit();
  const subSel =
    subs.length || m.subtype
      ? `<select class="fo-sub-select ${m.subtype ? "" : "is-blank"}" data-subtype ${dis ? "disabled" : ""} title="Subtipo"><option value="">subtipo…</option>${subs.map((s) => `<option ${m.subtype === s.name ? "selected" : ""}>${esc(s.name)}</option>`).join("")}${m.subtype && !subs.some((s) => s.name === m.subtype) ? `<option selected>${esc(m.subtype)}</option>` : ""}</select>`
      : "";
  return `<div class="fo-type-cell"><button type="button" class="fo-type-select ${code ? "" : "is-blank"} ${m.typeAuto ? "is-auto" : ""}" data-type-btn data-fo-keep-pop ${dis ? "disabled" : ""} title="${esc(code ? `${code} — ${typeLabel(code)}${m.typeAuto ? " (pelas regras)" : ""}` : "Escolher o tipo")}${locked ? " — desfaça a conciliação para mudar" : ""}">${esc(code || "tipo…")}</button>${subSel}</div>`;
}

function accountCell(m) {
  const locked = (m.reconciled && m.reconcileKind !== "AUTO") || !canEdit();
  const cards = S.meta.cards.filter((c) => c.active !== false || c.id === m.cardId);
  return `<select class="fo-acc-select" data-card-sel ${locked ? "disabled" : ""} title="${locked && canEdit() ? "Desfaça a conciliação para trocar a conta" : "Trocar a conta / cartão deste movimento"}">${cards.map((c) => `<option value="${esc(c.id)}" ${c.id === m.cardId ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>`;
}

const undoBtn = (m, title = "Desfazer a conciliação") => (canEdit() ? `<button type="button" class="fo-undo" data-undo title="${title}">↺</button>` : "");

function cpBtn(m) {
  if (m.proofPath) return `<a class="fo-cp is-ok" href="${esc(fileUrl(m.proofPath))}" target="_blank" rel="noopener" title="Abrir o comprovativo${m.proofName ? ` (${esc(m.proofName)})` : ""}">✓ CP</a>`;
  return canEdit() ? `<button type="button" class="fo-cp is-miss" data-movcp title="Falta o comprovativo de pagamento — clique para anexar">CP!</button>` : "";
}

function concCell(m) {
  const out = m.direction === "SAIDA";
  // conciliado, mas sem comprovativo
  if (m.proofMissing) {
    const ref = m.paymentRequest?.number || (m.reconcileKind === "NONE" ? m.reconcileReason : "");
    return `<span class="fo-cpill is-bad" title="Esta saída só fica conciliada quando tiver o comprovativo de pagamento${m.paymentRequest ? ` (pode anexá-lo aqui ou no pedido ${esc(m.paymentRequest.number)})` : ""}.">Falta comprovativo${ref ? ` · ${esc(ref)}` : ""}</span>${canEdit() ? `<button type="button" class="fo-mini-btn" data-movcp>📎 Anexar CP</button>` : ""}${undoBtn(m)}`;
  }
  if (m.reconciled) {
    const by = `Conciliado${m.reconciledBy ? ` por ${m.reconciledBy}` : ""}${m.reconciledAt ? ` a ${fmtDate(String(m.reconciledAt).slice(0, 10))}` : ""}`;
    switch (m.reconcileKind) {
      case "AUTO":
        return `<span class="fo-cpill is-neu" title="Encargos bancários: conciliado automaticamente. Entra no Mapa Mensal de Encargos Bancários, sem comprovativo nem pedido.">auto · mapa mensal</span>`;
      case "TRANSFER": {
        const pair = m.transferPairId ? S.items.find((x) => x.id === m.transferPairId) : null;
        const tip = pair ? `Transferência entre contas: conciliada com o movimento oposto na outra conta (${fmtDate(pair.movementDate)} · ${pair.direction === "SAIDA" ? "−" : ""}${money(pair.amount)})` : "Transferência entre contas conciliada sem o movimento da outra conta (extrato ainda não importado)";
        return `<span class="fo-cpill is-good" title="${esc(tip)}">✓ ↔ ${esc(m.transferCardLabel || cardName(m.transferCardId))}</span>${undoBtn(m, "Não é esta a transferência — desfazer")}${out ? cpBtn(m) : ""}`;
      }
      case "REQUEST": {
        const pr = m.paymentRequest || {};
        const item = pr.firstItem ? pr.firstItem.toLowerCase().replace(/(^|\s)\S/g, (s) => s.toUpperCase()).slice(0, 26) : "";
        return `<span class="fo-conc-ok"><span class="fo-okdot" title="${esc(by)}">✓</span><a class="fo-ref" href="${P1_URL}?rp=${encodeURIComponent(pr.id || "")}" title="${esc(`${pr.number} · ${pr.supplierName || ""}`)}">${esc(pr.number || "pedido")}</a>${item ? `<span class="fo-conc-sub" title="${esc(pr.firstItem)}">${esc(item)}</span>` : ""}${pr.hasInvoice ? `<span class="fo-conc-sub" title="Fatura anexada no pedido">📎</span>` : `<span class="fo-conc-warn" title="Sem fatura anexada no pedido">sem FT</span>`}${out ? cpBtn(m) : ""}${canEdit() ? `<button type="button" class="fo-undo" data-edit-rp title="Editar o pedido ${esc(pr.number || "")}">✎</button>` : ""}${undoBtn(m)}</span>`;
      }
      case "INVOICE": {
        const r = m.receipts || [];
        const nums = r.map((x) => x.invoiceNumber).filter(Boolean).join(", ");
        const noPdf = r.some((x) => !x.invoiceHasPdf);
        return `<span class="fo-conc-ok"><span class="fo-okdot" title="${esc(by)}">✓</span><a class="fo-ref" href="${R1_URL}" title="${esc(`Fatura ${nums} · ${r[0]?.client || ""}`)}">Fatura ${esc(nums)}</a>${noPdf ? `<span class="fo-conc-warn" title="A fatura não tem o PDF">sem FT</span>` : `<span class="fo-conc-sub">📄</span>`}${m.proofPath ? `<a class="fo-cp is-ok" href="${esc(fileUrl(m.proofPath))}" target="_blank" rel="noopener" title="Comprovativo do recebimento">📎</a>` : `<span class="fo-conc-warn">sem RC</span>`}${undoBtn(m)}</span>`;
      }
      case "REFUND": {
        const o = m.refundOfId ? S.items.find((x) => x.id === m.refundOfId) : null;
        return `<span class="fo-cpill is-neu" title="${esc(m.reconcileReason || "")}">↩ devolução${o ? ` ↔ ${fmtDate(o.movementDate)}` : ""}</span>${undoBtn(m)}`;
      }
      case "NONE":
        return `<span class="fo-conc-ok"><span class="fo-okdot" title="${esc(by)}">✓</span><b class="fo-conc-sub" style="color:var(--fo-ink-2)" title="${esc(m.reconcileReason || "")}">${esc(m.reconcileReason || "Sem pedido")}</b>${out ? cpBtn(m) : ""}${undoBtn(m)}</span>`;
      default:
        return `<span class="fo-okdot" title="${esc(by)}">✓</span>${undoBtn(m)}`;
    }
  }
  if (!canEdit()) return '<span class="fo-faint">por conciliar</span>';
  if (m.typeCode === "REEMB" && !out) return `<button type="button" class="fo-mini-btn" data-devlink title="Escolher a saída (de qualquer conta ou cartão) a que esta devolução corresponde">↩ ligar à saída</button>`;
  if (m.typeCode === "TRF INT") {
    const msg = m.transferCardId ? `Por conciliar · falta o extrato do ${cardName(m.transferCardId)}` : `Por conciliar · indique a conta de ${out ? "destino" : "origem"}`;
    const tip = m.transferCardId ? `Ainda não foi encontrado o movimento correspondente (${out ? "entrada" : "saída"} de ${money(m.amount)}) no extrato do ${cardName(m.transferCardId)}. Importe esse extrato e a transferência fica conciliada sozinha — ou clique para conciliar já.` : `Escolha na linha a conta de ${out ? "destino" : "origem"} e importe o extrato dessa conta.`;
    return `<button type="button" class="fo-cpill is-warn" data-conc title="${esc(tip)}">${esc(msg)}</button>`;
  }
  return `<button type="button" class="fo-conc-btn" data-conc title="Conciliar com um pedido do centro de pagamentos">⇄</button>`;
}

function ccCell(m) {
  if (m.typeCode === "TRF INT") {
    const others = S.meta.cards.filter((c) => c.id !== m.cardId && (c.active !== false || c.id === m.transferCardId));
    const out = m.direction === "SAIDA";
    const dis = (m.reconciled && m.transferPairId) || !canEdit() ? "disabled" : "";
    return `<div class="fo-trfs" title="Transferência interna: ${out ? "saiu desta conta para outra conta da empresa" : "entrou nesta conta vinda de outra conta da empresa"}"><span>${out ? "Para →" : "De ←"}</span><select class="fo-acc-select ${m.transferCardId ? "" : "is-blank"}" data-trf-dest ${dis}><option value="">— conta —</option>${others.map((c) => `<option value="${esc(c.id)}" ${m.transferCardId === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>`;
  }
  if (m.paymentRequest) {
    const pr = m.paymentRequest;
    const cc = pr.costCenterCode || pr.projectCode;
    return cc ? `<span class="fo-tag">${esc(cc)}</span>` : `<span class="fo-faint">—</span>`;
  }
  if (m.receipts?.length) return `<span class="fo-muted" style="font-size:12px">Recebimento de cliente</span>`;
  if (m.ccCode) return `<span class="fo-tag" title="Pelas regras de classificação">${esc(m.ccCode)}</span>`;
  return '<span class="fo-faint">—</span>';
}

function rowHtml(m, showAcc) {
  const out = m.direction === "SAIDA";
  const sel = S.selected.has(m.id);
  const done = m.reconciled && !m.proofMissing;
  return `<tr class="${sel ? "is-selected" : ""} ${done ? "is-done" : ""} ${!done && !m.typeCode ? "is-untyped" : ""}" data-id="${esc(m.id)}">
    <td class="w-0"><input type="checkbox" class="fo-cb" data-sel ${sel ? "checked" : ""} ${m.reconciled ? "disabled" : ""}></td>
    <td>${typeCell(m)}</td>
    <td class="fo-num nowrap">${fmtDate(m.movementDate)}</td>
    <td><input type="date" class="fo-inline-input ${m.effectiveDate !== m.movementDate ? "is-set" : ""}" data-eff value="${esc(m.effectiveDate || m.movementDate)}" ${canEdit() ? "" : "disabled"} title="Dia em que o dinheiro saiu ou entrou de facto na conta"></td>
    ${showAcc ? `<td>${accountCell(m)}</td>` : ""}
    <td class="fo-conc-desc" title="${esc([m.docNumber ? `Ref. ${m.docNumber}` : "", m.statementName || ""].filter(Boolean).join(" · "))}">${esc(m.description || "—")}</td>
    <td class="ta-r nowrap">${signedHtml(m)}${out && m.refundedAmount ? `<span class="fo-cell-sub fo-green" title="Já devolvido">↩ ${money(m.refundedAmount)}</span>` : ""}</td>
    <td style="min-width:150px"><input class="fo-inline-input" data-note value="${esc(m.note || "")}" placeholder="nota interna" ${canEdit() ? "" : "disabled"}></td>
    <td class="fo-conc-cell">${concCell(m)}</td>
    <td class="w-0"></td>
    <td class="fo-cc-cell">${ccCell(m)}</td>
  </tr>`;
}

function renderTable() {
  const tbl = root.querySelector("[data-table]");
  const foot = root.querySelector("[data-foot]");
  const head = root.querySelector("[data-head]");
  const showAcc = true;
  const list = S.loading || S.error ? [] : filtered();
  const selectable = list.filter((m) => !m.reconciled);
  const allSel = selectable.length && selectable.every((m) => S.selected.has(m.id));
  const thead = `<thead><tr><th class="w-0" title="Selecione vários movimentos para os conciliar com o mesmo pedido"><input type="checkbox" class="fo-cb" data-sel-all ${allSel ? "checked" : ""}></th><th>Tipo</th><th>Data Mov.</th><th title="Dia em que o dinheiro saiu ou entrou de facto na conta">Data Efetiva</th>${showAcc ? "<th>Conta</th>" : ""}<th>Descrição</th><th class="ta-r">Valor</th><th title="Nota interna sobre o movimento">Nota</th><th>Conc.</th><th class="w-0"></th><th>Centro de Custo</th></tr></thead>`;
  foot.innerHTML = movementLegend();
  if (S.loading) {
    head.innerHTML = `<span class="fo-head-info"><span>A carregar movimentos…</span></span>`;
    tbl.innerHTML = `${thead}<tbody>${skeletonRows(11, 8)}</tbody>`;
    return;
  }
  if (S.error) {
    head.innerHTML = "";
    tbl.innerHTML = `<tbody><tr><td>${emptyState({ iconName: "cloud_off", title: "Não foi possível carregar", text: esc(S.error), action: `<button type="button" class="fo-btn fo-btn--ghost" data-retry>${icon("refresh")}Tentar de novo</button>` })}</td></tr></tbody>`;
    return;
  }
  const inSum = list.filter((m) => m.direction === "ENTRADA").reduce((a, m) => a + m.amount, 0);
  const outSum = list.filter((m) => m.direction === "SAIDA").reduce((a, m) => a + m.amount, 0);
  const openN = list.filter(isOpen).length;
  head.innerHTML = `<span class="fo-head-info"><span class="fo-head-count">${list.length}</span><span>${list.length === 1 ? "movimento" : "movimentos"}</span>${
    openN ? `<span class="fo-head-filter">${openN} por conciliar</span>` : list.length ? `<span class="fo-head-filter is-ok">${icon("check")}tudo conciliado</span>` : ""
  }</span><span class="fo-head-total"><span>Entradas</span><b class="fo-num fo-green">${money(inSum)}</b><span>Saídas</span><b class="fo-num fo-red">${money(outSum)}</b><span>Saldo</span><b class="fo-num">${money(inSum - outSum)}</b></span>`;
  if (!list.length) {
    const none = !S.items.length;
    tbl.innerHTML = `<tbody><tr><td>${emptyState({
      iconName: none ? "upload_file" : "task_alt",
      title: none ? "Ainda não há extratos importados" : S.f.onlyOpen ? "Nada por conciliar aqui" : "Nenhum movimento com estes filtros",
      text: none ? "Importe o extrato do banco (Excel ou CSV) — os movimentos aparecem aqui para classificar e conciliar." : S.f.onlyOpen ? "Desligue «só por conciliar» para ver o histórico." : "Experimente outro mês, conta ou tipo.",
      action: none && canEdit() ? `<button type="button" class="fo-btn fo-btn--primary" data-import-empty>${icon("upload")}Importar Extrato</button>` : "",
    })}</td></tr></tbody>`;
  } else {
    tbl.innerHTML = `${thead}<tbody>${list.map((m) => rowHtml(m, showAcc)).join("")}</tbody>`;
  }
}

function movementLegend() {
  return `<span class="fo-flow-label">${icon("route")}Fluxo</span>
    <span class="fo-flow-step is-warn">Por conciliar</span>${icon("chevron_right", "fo-flow-arrow")}
    <span class="fo-flow-step is-good">Conciliado</span>
    <span class="fo-flow-step is-info">Transferência</span>
    <span class="fo-flow-step is-nav">Auto · encargos</span>
    <span class="fo-flow-step is-bad">Falta comprovativo</span>
    <span class="fo-flow-note">↺ desfaz · clique no tipo para reclassificar</span>
    <span class="fo-flow-hint">Vermelho = saídas · verde = entradas — os movimentos não se apagam (só a importação inteira, em Tesouraria › Extratos Bancários).</span>`;
}

function renderManual() {
  const el = root.querySelector("[data-manual]");
  const c = S.f.card ? cardOf(S.f.card) : null;
  if (!c || !canEdit()) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<section class="fo-card fo-manual">
    <h3 class="fo-section-title">${icon("edit_note")}Lançamento Manual <span class="fo-faint" style="font-weight:500;font-size:12px">· ${esc(c.label)}</span></h3>
    <div class="fo-manual-row">
      <input type="date" class="fo-input" data-mv="date" value="${todayKey()}" style="max-width:160px">
      <input class="fo-input" data-mv="desc" placeholder="Descrição" style="flex:2 1 240px">
      <select class="fo-input" data-mv="dir" style="max-width:130px"><option value="SAIDA">Saída</option><option value="ENTRADA">Entrada</option></select>
      <input class="fo-input is-num" data-mv="val" data-money placeholder="Valor" style="max-width:170px">
      <select class="fo-input" data-mv="type" style="max-width:200px"><option value="">Tipo</option>${S.meta.types.filter((t) => !t.soon).map((t) => `<option value="${esc(t.code)}">${esc(t.code)} — ${esc(typeShort(t.code))}</option>`).join("")}</select>
      <button type="button" class="fo-btn fo-btn--primary" data-mv-add>${icon("add")}Lançar</button>
    </div></section>`;
  bindMoney(el);
}

function renderAll() {
  renderBanner();
  renderSummary();
  renderToolbar();
  renderSelBar();
  renderTable();
  renderManual();
}

// ─── edição em linha ─────────────────────────────────────────────────────────

async function patchMovement(m, body, { quiet = false } = {}) {
  try {
    const { item } = await apiRequest(`${BASE}/movements/${m.id}`, { method: "PATCH", body });
    if (!quiet) toast("Guardado.", { type: "success", timeoutMs: 1200 });
    upsert(item);
    return item;
  } catch (err) {
    toast(errMsg(err), { type: "error" });
    renderTable();
    return null;
  }
}

function openTypeMenu(anchor, m) {
  const dir = m.direction;
  const items = S.meta.types.map((t) =>
    t.soon
      ? { icon: "hourglass_empty", label: `${t.code} — ${t.label}`, hint: "em preparação", disabled: true }
      : {
          icon: t.code === m.typeCode ? "radio_button_checked" : "radio_button_unchecked",
          label: `${t.code} — ${t.label.split(" (")[0]}`,
          hint: t.code === "ENC" ? "Concilia-se sozinho (mapa mensal)" : t.dir && t.dir !== dir ? (t.dir === "SAIDA" ? "Normalmente é uma saída" : "Normalmente é uma entrada") : "",
          onClick: () => t.code !== m.typeCode && patchMovement(m, { typeCode: t.code }),
        }
  );
  if (m.typeCode) items.push("sep", { icon: "backspace", label: "Deixar sem tipo", onClick: () => patchMovement(m, { typeCode: null }) });
  popMenu(anchor, items, { title: `${m.direction === "SAIDA" ? "Saída" : "Entrada"} de ${money(m.amount)}`, width: 340 });
}

async function addManual(btn) {
  const el = root.querySelector("[data-manual]");
  const g = (k) => el.querySelector(`[data-mv="${k}"]`);
  const amount = parseMoney(g("val").value);
  const description = g("desc").value.trim();
  if (!g("date").value || !description || !(amount > 0)) {
    [g("date"), g("desc"), g("val")].forEach((i) => i.classList.toggle("is-invalid", !i.value.trim() || (i === g("val") && !(amount > 0))));
    return toast("Indique a data, a descrição e o valor.", { type: "error" });
  }
  setBusy(btn, true, "A lançar…");
  try {
    await apiRequest(`${BASE}/movements/manual`, { method: "POST", body: { cardId: S.f.card, date: g("date").value, description, direction: g("dir").value, amount, typeCode: g("type").value || null } });
    toast("Movimento lançado.", { type: "success" });
    await refresh({ meta: true });
  } catch (err) {
    setBusy(btn, false);
    toast(errMsg(err), { type: "error" });
  }
}

async function concileAllEnc(btn) {
  const list = S.items.filter((m) => m.typeCode === "ENC" && !m.reconciled && (!S.f.card || m.cardId === S.f.card));
  const ok = await ask(`Conciliar de uma só vez ${list.length} encargo(s) bancário(s) por conciliar? Ficam no mapa mensal de encargos, sem pedido nem comprovativo.`, { title: "Conciliar encargos bancários", ok: "Conciliar" });
  if (!ok) return;
  setBusy(btn, true, "A conciliar…");
  let n = 0;
  for (const m of list) {
    try {
      await apiRequest(`${BASE}/movements/${m.id}`, { method: "PATCH", body: { typeCode: "ENC" } });
      n += 1;
    } catch {
      /* segue */
    }
  }
  toast(`${n} encargo(s) conciliado(s).`, { type: "success" });
  refresh();
}

// ─── conciliar ───────────────────────────────────────────────────────────────

function soonSection(m) {
  const out = m.direction === "SAIDA";
  const sec = (title, text, fields) => `<section class="fo-section is-soon"><div class="fo-section-head"><h3 class="fo-section-title">${icon("hourglass_empty")}${title}</h3><span class="fo-soon">em preparação</span></div><p class="fo-section-hint">${text}</p>${fields}</section>`;
  const dis = (labels) => `<div class="fo-soon-fields">${labels.map((l) => `<label class="fo-field"><span class="fo-label">${l}</span><input class="fo-input" disabled placeholder="—"></label>`).join("")}<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" disabled>${icon("check")}Registar e conciliar</button></div>`;
  if (!out) {
    return sec("É um Empréstimo?", "Entrada de dinheiro de um empréstimo: regista-se aqui e vai diretamente para <b>Financiamento</b> (não passa pelo Centro de Pagamentos).", `<div style="display:flex;gap:.5rem;flex-wrap:wrap"><span class="fo-muted" style="font-size:13px;align-self:center">Tipo:</span><button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" disabled>Empréstimo Obtido (a empresa recebe)</button><button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" disabled>Devolução de um empréstimo concedido</button></div>`);
  }
  switch (m.typeCode) {
    case "SC":
      return sec("Pagamento a Sócio", "Indique o sócio que recebeu este valor. Distribuição de lucros e IAC ficam em <b>Financiamento › Sócios</b>; o empréstimo ao sócio fica no empréstimo com ata.", dis(["Sócio *", "Tipo *"]));
    case "SL":
    case "AD SL":
      return sec("Pagamento de Salários", "Concilia diretamente, sem pedido de pagamento. Fica em <b>Salários</b>.", dis(["Componente", "Mês de salário *"]));
    case "PE":
      return sec("Pagamento ao Estado", "Escolha o pagamento ao Estado (Impostos / Centro de Pagamentos) que este débito pagou. Se ainda não estiver no sistema, crie-o aqui.", `<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" disabled>${icon("add")}Criar o Imposto</button>`);
    case "EMP":
    case "CGM":
      return sec(m.typeCode === "EMP" ? "Empréstimo" : "Amortização de Crédito", "Regista-se em <b>Financiamento</b>, sem pedido de pagamento.", dis(["Empréstimo *"]));
    default:
      return "";
  }
}

function movementCardHtml(m, extra = []) {
  const out = m.direction === "SAIDA";
  const total = m.amount + extra.reduce((a, x) => a + x.amount, 0);
  return `<div class="fo-movement-card"><div><span class="fo-dir ${out ? "is-out" : ""}">${out ? "Saída" : "Entrada"}${extra.length ? ` · ${extra.length + 1} movimentos` : ""} · ${esc(m.cardLabel || "")}</span><b>${money(total)} <small style="font-size:.55em;color:#94a3b8">${esc(cardOf(m.cardId)?.currency || "AOA")}</small></b><small>${fmtDate(m.movementDate)} · ${esc(m.description || "—")}</small></div>${m.typeCode ? `<span class="fo-tag" style="background:rgba(255,255,255,.1);color:#fff">${esc(m.typeCode)}${m.subtype ? ` · ${esc(m.subtype)}` : ""}</span>` : ""}</div>`;
}

async function openReconcile(m) {
  if (m.reconciled) return;
  const out = m.direction === "SAIDA";
  const cur = cardOf(m.cardId)?.currency || "AOA";
  const drawer = openDrawer({ kicker: `Conciliar · ${esc(m.cardLabel || "")}`, title: `${out ? "Saída" : "Entrada"} de ${money(m.amount)} ${esc(cur)}`, subtitle: `${fmtDate(m.movementDate)} · ${esc(m.description || "—")}`, width: 1020 });
  const body = drawer.body;
  const st = { all: false, q: "", cands: null, chosen: null, reason: (S.meta.noRequestReasons || []).slice(-1)[0] || "", note: "", proofs: [], reasonProof: [] };

  async function loadCands() {
    st.cands = null;
    if (!st.chosen) renderPick();
    try {
      const res = await apiRequest(`${BASE}/movements/${m.id}/candidates${st.all ? "?all=1" : ""}`);
      st.cands = res.items || [];
    } catch (err) {
      st.cands = [];
      toast(errMsg(err), { type: "error" });
    }
    if (!st.chosen) renderPick();
    if (S.invoiceTarget && !out && !st.chosen) {
      const hit = st.cands.find((c) => c.id === S.invoiceTarget.id);
      if (hit) choose(hit);
    }
  }

  function candRowsHtml() {
    const cols = out ? 8 : 6;
    if (st.cands === null) return `<tr><td colspan="${cols}"><span class="fo-skel"></span></td></tr><tr><td colspan="${cols}"><span class="fo-skel"></span></td></tr>`;
    const q = norm(st.q);
    const list = st.cands.filter((c) => !q || norm(out ? `${c.number} ${c.supplierName} ${c.costCenterCode || ""} ${c.project?.code || ""} ${c.notes || ""} ${(c.items || []).map((i) => i.description).join(" ")} ${c.totalAmount}` : `${c.docNumber} ${c.client} ${c.project} ${c.netAmount}`).includes(q));
    if (!list.length) return `<tr><td colspan="${cols}" class="fo-empty-cell">Nada encontrado. Procure pelo número ou pelo nome${out && !st.all && m.typeCode ? ", ou mostre todos os tipos" : ""}.</td></tr>`;
    return list
      .map((c) => {
        if (out) {
          const eq = Math.abs(c.toReconcile - m.amount) < 0.5;
          return `<tr class="is-pick ${eq ? "is-match" : ""}" data-cand="${esc(c.id)}"><td><b class="fo-ref">${esc(c.number)}</b>${c.mode === "FM" ? ' <span class="fo-tag fo-tag--violet">FM</span>' : ""}${eq ? '<span class="fo-cell-sub fo-green" style="font-weight:700">valor igual</span>' : ""}</td><td class="${c.status === "Atrasado" ? "fo-red" : ""}">${fmtDate(c.nextDue)}</td><td><b style="color:var(--fo-ink)">${esc(c.supplierName || "—")}</b></td><td class="fo-muted fo-ellipsis" style="max-width:220px">${esc(c.items?.[0]?.description || c.notes || "")}</td><td class="ta-r fo-num"><b>${money(c.totalAmount)}</b></td><td class="ta-r fo-num fo-muted">${c.reconciledAmount ? money(c.reconciledAmount) : "—"}</td><td>${pill(c.status)}</td><td class="ta-r"><button type="button" class="fo-btn fo-btn--ghost fo-btn--xs">Selecionar</button></td></tr>`;
        }
        const eq = Math.abs(c.missingAmount - m.amount) < 0.5;
        return `<tr class="is-pick ${eq ? "is-match" : ""}" data-cand="${esc(c.id)}"><td><b class="fo-ref">${esc(c.docNumber || "s/ n.º")}</b>${eq ? '<span class="fo-cell-sub fo-green" style="font-weight:700">valor igual</span>' : ""}</td><td>${fmtDate(c.docDate)}</td><td><b style="color:var(--fo-ink)">${esc(c.client || "—")}</b><span class="fo-cell-sub">${esc(c.project || "")}</span></td><td class="ta-r fo-num"><b>${money(c.netAmount)}</b></td><td class="ta-r fo-num ${c.receivedAmount ? "fo-green" : "fo-muted"}">${money(c.receivedAmount || 0)}</td><td class="ta-r"><button type="button" class="fo-btn fo-btn--ghost fo-btn--xs">Selecionar</button></td></tr>`;
      })
      .join("");
  }

  const registerBlock = () => `<div class="fo-option-row"><div><b>Ainda não está no Centro de Pagamentos?</b><small>regista o pedido já pago e conciliado; só o comprovativo é obrigatório</small></div><button type="button" class="fo-btn fo-btn--brand fo-btn--sm" data-register>＋ Registar o Pagamento e Conciliar</button></div>`;

  function noRequestSection() {
    const reasons = S.meta.noRequestReasons || [];
    return `<section class="fo-section">
      <div class="fo-section-head"><h3 class="fo-section-title">${icon("do_not_disturb_on")}Sem Pedido de Pagamento</h3></div>
      <div class="fo-inline-form">
        <select class="fo-input" data-reason style="max-width:260px">${reasons.map((r) => `<option ${st.reason === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
        <input class="fo-input" data-reason-note value="${esc(st.note)}" placeholder="Nota (opcional)" style="flex:1 1 220px">
        <button type="button" class="fo-btn fo-btn--primary fo-btn--sm" data-none-go>${icon("check")}Conciliar sem pedido</button>
      </div>
      ${out ? `<div style="margin-top:.7rem"><span class="fo-label">Comprovativo de pagamento</span><div data-zone-reason>${fileZoneHtml("reasonProof", { label: "Anexar", accept: ".pdf,image/*", files: st.reasonProof })}</div></div>` : ""}
    </section>`;
  }

  function trfSection() {
    if (!(m.typeCode === "TRF INT" || !m.typeCode)) return "";
    const others = S.meta.cards.filter((c) => c.id !== m.cardId);
    return `<section class="fo-section"><div class="fo-section-head"><h3 class="fo-section-title">${icon("swap_horiz")}Transferência entre contas da empresa</h3></div>
      <div class="fo-inline-form"><span class="fo-muted" style="font-size:13px">${out ? "Para →" : "De ←"}</span>
        <select class="fo-input" data-trf-to style="max-width:300px"><option value="">— conta —</option>${others.map((c) => `<option value="${esc(c.id)}" ${m.transferCardId === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
        <button type="button" class="fo-btn fo-btn--primary fo-btn--sm" data-trf-go>${icon("check")}Conciliar transferência</button></div>
      <p class="fo-help" style="margin:.5rem 0 0">Procura na outra conta o movimento simétrico (mesmo valor, até 5 dias) e concilia os dois.</p></section>`;
  }

  function renderPick() {
    drawer.setFooter(`<div class="fo-foot-info"></div><div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--ghost" data-close>Fechar</button></div>`);
    const typeHint = m.typeCode ? `<b>${esc(m.typeCode)} — ${esc(typeShort(m.typeCode))}</b>` : "";
    body.innerHTML = out
      ? `${soonSection(m)}
      ${registerBlock()}
      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title">${icon("receipt_long")}Escolha o Pedido do Centro de Pagamentos</h3>
          <label class="fo-search" style="min-width:240px;flex:0 1 320px">${icon("search")}<input data-cq value="${esc(st.q)}" placeholder="Procurar por n.º (RP26-…), fornecedor, CC…"></label></div>
        ${m.typeCode ? `<p class="fo-section-hint">${st.all ? "Todos os pedidos por conciliar." : `Só pedidos ${typeHint} por conciliar`} · <button type="button" class="fo-link" data-toggle-all>${st.all ? "só deste tipo" : "mostrar todos os tipos"}</button></p>` : ""}
        <div class="fo-preview" style="max-height:340px"><table class="fo-mini-table">
          <thead><tr><th>Requisição</th><th>Venc.</th><th>Terceiro</th><th>Descrição</th><th class="ta-r">Valor</th><th class="ta-r">Já conciliado</th><th>Estado</th><th></th></tr></thead>
          <tbody data-cands>${candRowsHtml()}</tbody>
        </table></div>
        <p class="fo-help" style="margin:.55rem 0 0">Um pedido pode ser conciliado com vários movimentos: selecione-os juntos na tabela (caixas à esquerda) ou concilie cada um com o mesmo pedido.</p>
      </section>
      ${trfSection()}
      ${noRequestSection()}`
      : `<section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title">${icon("receipt")}A Fatura Ainda Não Está no Sistema?</h3></div>
        <p class="fo-section-hint">Registe aqui a fatura emitida ao cliente (n.º, cliente, valores). Ao gravar, volta a esta conciliação com a fatura pronta a escolher.</p>
        <div class="fo-inline-form"><button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-inv-import>📄 Importar a Fatura (PDF)</button><button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-inv-new>${icon("add")}Registar à Mão</button><span class="fo-muted" style="font-size:12.5px;margin-left:auto">recebido: <b class="fo-num">${money(m.amount)}</b> em ${fmtDate(m.movementDate)}</span></div>
      </section>
      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title">${icon("request_quote")}Escolha a Fatura Emitida ao Cliente</h3>
          <label class="fo-search" style="min-width:240px;flex:0 1 320px">${icon("search")}<input data-cq value="${esc(st.q)}" placeholder="Procurar por fatura, cliente, obra…"></label></div>
        <p class="fo-section-hint">${st.all ? "Todas as faturas." : "Faturas com valor por receber."} · <button type="button" class="fo-link" data-toggle-all>${st.all ? "só em aberto" : "mostrar todas"}</button></p>
        <div class="fo-preview" style="max-height:340px"><table class="fo-mini-table">
          <thead><tr><th>Fatura</th><th>Data</th><th>Cliente</th><th class="ta-r">Valor</th><th class="ta-r">Recebido</th><th></th></tr></thead>
          <tbody data-cands>${candRowsHtml()}</tbody>
        </table></div>
        <p class="fo-help" style="margin:.55rem 0 0">Uma fatura pode ser conciliada com vários movimentos: concilie cada um com a mesma fatura.</p>
      </section>
      ${trfSection()}
      ${noRequestSection()}
      ${soonSection(m)}`;
    const zr = body.querySelector("[data-zone-reason]");
    if (zr) bindFileZones(zr, st, () => renderPick());
  }

  function choose(c) {
    st.chosen = c;
    st.proofs = [];
    st.join = new Set([...S.selected].filter((id) => id !== m.id && S.items.find((x) => x.id === id && !x.reconciled && x.direction === m.direction)));
    st.register = out ? c.openAmount > 0.005 : true;
    st.invAmount = out ? 0 : round2(Math.min(c.missingAmount, m.amount));
    st.invEditor = out && !(c.docState?.invoices > 0) ? invoiceRowsEditor({ supplierName: c.supplierName || "", startEmpty: true }) : null;
    renderConfirm();
  }

  function joinable() {
    return S.items
      .filter((x) => x.id !== m.id && !x.reconciled && x.direction === m.direction && x.cardId === m.cardId && (daysApart(x.movementDate, m.movementDate) <= JOIN_DAYS || st.join.has(x.id)))
      .sort((a, b) => a.movementDate.localeCompare(b.movementDate));
  }

  function renderConfirm() {
    const c = st.chosen;
    const extra = [...st.join].map((id) => S.items.find((x) => x.id === id)).filter(Boolean);
    const movTotal = round2(m.amount + extra.reduce((a, x) => a + x.amount, 0));
    if (out) {
      const needProof = !NO_PROOF_TYPES.includes(m.typeCode || c.typeCode) && !c.docState?.proofs;
      const target = c.toReconcile ?? c.openAmount;
      const ok = Math.abs(movTotal - target) < 0.5;
      const cand = joinable();
      const payAmt = round2(Math.min(movTotal, c.openAmount || 0));
      body.innerHTML = `
        ${movementCardHtml(m, extra)}
        <section class="fo-section">
          <div class="fo-section-head"><h3 class="fo-section-title">${icon("fact_check")}Confirmar a Conciliação</h3></div>
          <p class="fo-confirm-text">O movimento de <b class="fo-num">${money(movTotal)}</b> com o pedido <b class="fo-ref">${esc(c.number)}</b> · ${esc(c.supplierName || "—")} · <b class="fo-num">${money(c.totalAmount)}</b> ${pill(c.status)}</p>
          ${c.paidAmount > 0 ? `<p class="fo-help" style="margin:.4rem 0 0">Já pago ${money(c.paidAmount)} · já conciliado ${money(c.reconciledAmount || 0)}.</p>` : ""}
          ${
            st.invEditor
              ? `<div class="fo-subbox"><div class="fo-subbox-head"><b>Este pedido ainda não tem fatura</b> <span class="fo-faint">(opcional)</span></div><p class="fo-help" style="margin:.2rem 0 .6rem">Se já a tiver, registe-a aqui e fica gravada no pedido ${esc(c.number)}. Se ainda não tem, <b>pode conciliar já</b> — junte a fatura depois no pedido.</p><div data-inv-editor></div></div>`
              : ""
          }
          <details class="fo-details" ${extra.length ? "open" : ""}>
            <summary><b>Juntar outros movimentos a este pedido</b> <span class="${ok ? "fo-sum-ok" : "fo-muted"}">(${st.join.size + 1} selecionado(s) · ${money(movTotal)} de ${money(target)} em falta${ok ? " ✓" : ""})</span></summary>
            <div class="fo-join-list">
              <label class="fo-join-item is-on"><input type="checkbox" checked disabled> ${fmtDate(m.movementDate)} · ${esc(m.description || "—")} · <b class="fo-num">${money(m.amount)}</b></label>
              ${cand.map((x) => `<label class="fo-join-item ${st.join.has(x.id) ? "is-on" : ""}"><input type="checkbox" data-join="${esc(x.id)}" ${st.join.has(x.id) ? "checked" : ""}> ${fmtDate(x.movementDate)} · ${esc(x.description || "—")} · <span class="fo-num">${money(x.amount)}</span></label>`).join("")}
            </div>
            <p class="fo-help" style="margin:.4rem 0 0">Movimentos por conciliar desta conta, até ${JOIN_DAYS} dias de diferença. Os selecionados ficam todos ligados ao pedido.</p>
          </details>
          ${
            c.openAmount > 0.005
              ? `<label class="fo-check ${st.register ? "is-on" : ""}" style="align-self:flex-start;margin-top:.6rem"><input type="checkbox" data-register-pay ${st.register ? "checked" : ""}>o pedido ainda não está pago: registar ${extra.length ? "estes movimentos" : "este movimento"} como pagamento</label>
                 ${st.register ? `<p class="fo-help" style="margin:.35rem 0 0">Fica registado um pagamento de <b class="fo-num">${money(payAmt)}</b>.</p>` : ""}`
              : `<div class="fo-note fo-note--good" style="margin-top:.6rem">${icon("verified")}<span>O pedido já está pago — a conciliação liga o pagamento ao banco.</span></div>`
          }
          <div style="margin-top:.85rem"><span class="fo-label">Comprovativos de pagamento ${needProof ? '<i class="fo-req">*</i>' : '<span class="fo-faint">(opcional)</span>'} <span class="fo-faint">(pode anexar vários)</span></span>
            <div data-zone-proofs>${fileZoneHtml("proofs", { label: "Anexar comprovativos", hint: "PDF ou imagem", multiple: true, accept: ".pdf,image/*", files: st.proofs })}</div></div>
          <p class="fo-help" style="margin:.75rem 0 0">Os dados do pedido não batem com o banco (valor, fornecedor, centro de custo)? <button type="button" class="fo-link" data-edit-req>✎ Editar o pedido ${esc(c.number)}</button> — a informação fica sempre no centro de pagamentos.</p>
        </section>
        <section class="fo-section">
          <div class="fo-section-head"><h3 class="fo-section-title">${icon("add_card")}Ainda Não Está no Centro de Pagamentos?</h3></div>
          <p class="fo-section-hint">Descreva o pagamento <b>como no Centro de Pagamentos</b>: tipo, fornecedor, produtos, centro de custo e documentos (faturas + comprovativo de pagamento). Fica registado no Centro de Pagamentos, já pago e conciliado com este movimento.</p>
          <button type="button" class="fo-btn fo-btn--brand fo-btn--sm" data-register>＋ Registar o Pagamento e Conciliar</button>
        </section>`;
      if (st.invEditor) body.querySelector("[data-inv-editor]").appendChild(st.invEditor.el);
    } else {
      const noPdf = !c.documentPath;
      body.innerHTML = `
        ${movementCardHtml(m)}
        <section class="fo-section">
          <div class="fo-section-head"><h3 class="fo-section-title">${icon("fact_check")}Confirmar a Conciliação</h3></div>
          <p class="fo-confirm-text">O movimento de <b class="fo-num">${money(m.amount)}</b> com a fatura <b class="fo-ref">${esc(c.docNumber || "")}</b> · ${esc(c.client || "—")}.</p>
          <label class="fo-check is-on" style="align-self:flex-start;margin-top:.5rem" title="A conciliação regista o recebimento na fatura"><input type="checkbox" checked disabled>registar como recebimento da fatura</label>
          <div class="fo-subbox" style="margin-top:.6rem">
            <div><b>Fatura ${esc(c.docNumber || "")}</b> · ${fmtDate(c.docDate)} · ${esc(c.client || "—")} · a receber <b class="fo-num">${money(c.missingAmount)}</b> ${noPdf ? '<span class="fo-conc-warn">sem PDF</span>' : `<a class="fo-link" href="${esc(fileUrl(c.documentPath))}" target="_blank" rel="noopener">📄 ver</a>`}</div>
            <div class="fo-grid" style="margin-top:.6rem"><label class="fo-field fo-col-4"><span class="fo-label">Valor recebido para esta fatura</span><input class="fo-input" data-money data-inv-amount value="${money(st.invAmount)}"></label>
              <div class="fo-col-8" style="display:flex;align-items:flex-end"><span class="fo-help">${m.amount > c.missingAmount + 0.5 ? `A entrada é maior do que o que falta (${money(c.missingAmount)}). O resto pode ser outra fatura — concilie de novo depois.` : "Normalmente é o valor do movimento."}</span></div></div>
          </div>
          <div style="margin-top:.85rem"><span class="fo-label">Comprovativo do recebimento (banco) <i class="fo-req">*</i> <span class="fo-faint">— um só para a fatura toda</span></span>
            <div data-zone-proofs>${fileZoneHtml("proofs", { label: "Anexar comprovativo", accept: ".pdf,image/*", files: st.proofs })}</div></div>
        </section>
        ${soonSection(m)}`;
      bindMoney(body);
    }
    const bindProofZone = () => {
      const z = body.querySelector("[data-zone-proofs]");
      if (!z) return;
      bindFileZones(z, st, () => {
        z.innerHTML = fileZoneHtml("proofs", { label: out ? "Anexar comprovativos" : "Anexar comprovativo", hint: out ? "PDF ou imagem" : "", multiple: out, accept: ".pdf,image/*", files: st.proofs });
        bindProofZone();
      });
    };
    bindProofZone();
    drawer.setFooter(`<div class="fo-foot-info"><span>${out ? `Pedido <b>${esc(c.number)}</b>` : `Fatura <b>${esc(c.docNumber || "")}</b>`}</span></div><div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--ghost" data-back>Escolher outro</button><button type="button" class="fo-btn fo-btn--brand" data-confirm>${icon("check")}Confirmar conciliação</button></div>`);
  }

  async function submit(payload, files, btn) {
    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    files.forEach((f) => fd.append("proofs", f));
    setBusy(btn, true, "A conciliar…");
    try {
      const { item } = await apiUpload(`${BASE}/movements/${m.id}/reconcile`, fd, "POST");
      return item;
    } catch (err) {
      setBusy(btn, false);
      toast(errMsg(err, "Não foi possível conciliar."), { type: "error" });
      return null;
    }
  }

  async function done(msg) {
    toast(msg, { type: "success" });
    drawer.close(true);
    S.selected.clear();
    if (S.invoiceTarget && !out) S.invoiceTarget = null;
    await refresh({ meta: true });
  }

  body.addEventListener("input", (e) => {
    if (e.target.matches("[data-cq]")) {
      st.q = e.target.value;
      body.querySelector("[data-cands]").innerHTML = candRowsHtml();
    } else if (e.target.matches("[data-reason-note]")) st.note = e.target.value;
    else if (e.target.matches("[data-inv-amount]")) st.invAmount = parseMoney(e.target.value);
  });

  body.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-register-pay]")) {
      st.register = t.checked;
      renderConfirm();
    } else if (t.matches("[data-reason]")) st.reason = t.value;
    else if (t.matches("[data-join]")) {
      if (t.checked) st.join.add(t.dataset.join);
      else st.join.delete(t.dataset.join);
      renderConfirm();
      body.querySelector(".fo-details")?.setAttribute("open", "");
    }
  });

  body.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-toggle-all]")) {
      st.all = !st.all;
      return loadCands();
    }
    const cr = t.closest("[data-cand]");
    if (cr) {
      const c = st.cands.find((x) => x.id === cr.dataset.cand);
      if (c) choose(c);
      return;
    }
    if (t.closest("[data-register]")) {
      const extra = [...S.selected].map((id) => S.items.find((x) => x.id === id)).filter((x) => x && x.id !== m.id && !x.reconciled && x.direction === "SAIDA");
      const movs = [m, ...extra];
      drawer.close(true);
      openRequestForm({ fromMovements: movs, onSaved: () => done("Pagamento registado e conciliado.") });
      return;
    }
    if (t.closest("[data-inv-new]") || t.closest("[data-inv-import]")) {
      let scanFile = null;
      if (t.closest("[data-inv-import]")) {
        [scanFile] = await pickFiles({ accept: ".pdf,application/pdf,image/*" });
        if (!scanFile) return;
      }
      openInvoiceForm({
        scanFile,
        prefill: { base: "", description: m.description || "" },
        onSaved: async (inv) => {
          await loadCands();
          const hit = st.cands.find((c) => c.id === inv.id);
          if (hit) choose(hit);
        },
      });
      return;
    }
    if (t.closest("[data-edit-req]")) {
      const { item } = await apiRequest(`/finance/payment-requests/${st.chosen.id}`);
      openRequestForm({
        item,
        onSaved: async (saved) => {
          st.chosen = { ...saved, reconciledAmount: st.chosen.reconciledAmount, toReconcile: round2(Math.max(saved.totalAmount - (st.chosen.reconciledAmount || 0), 0)) };
          renderConfirm();
        },
      });
      return;
    }
    const trfGo = t.closest("[data-trf-go]");
    if (trfGo) {
      const dest = body.querySelector("[data-trf-to]").value;
      if (!dest) return toast("Indique a outra conta da transferência.", { type: "error" });
      const item = await submit({ kind: "TRANSFER", transferCardId: dest }, [], trfGo);
      if (item) done(item.transferPairId ? "Transferência conciliada com o movimento da outra conta." : "Transferência conciliada (sem o movimento da outra conta — ainda não importado).");
      return;
    }
    const noneGo = t.closest("[data-none-go]");
    if (noneGo) {
      if (!st.reason) return toast("Escolha o motivo.", { type: "error" });
      const item = await submit({ kind: "NONE", reason: st.reason, note: st.note || null }, st.reasonProof, noneGo);
      if (item) done("Conciliado sem pedido de pagamento.");
    }
  });

  drawer.footer.addEventListener("click", async (e) => {
    if (e.target.closest("[data-back]")) {
      st.chosen = null;
      return renderPick();
    }
    const btn = e.target.closest("[data-confirm]");
    if (!btn) return;
    const c = st.chosen;
    if (out) {
      const needProof = !NO_PROOF_TYPES.includes(m.typeCode || c.typeCode) && !c.docState?.proofs;
      if (needProof && !st.proofs.length) {
        const z = body.querySelector("[data-zone-proofs] .fo-filezone");
        z?.classList.add("is-invalid");
        z?.scrollIntoView({ behavior: "smooth", block: "center" });
        return toast("Anexe o comprovativo de pagamento — é obrigatório na conciliação.", { type: "error" });
      }
      if (st.invEditor) {
        const invErrs = st.invEditor.validate();
        if (invErrs.length) return toast(`Fatura — falta: ${invErrs.join(", ")}.`, { type: "error" });
      }
      const item = await submit({ kind: "REQUEST", requestId: c.id, movementIds: [m.id, ...st.join], registerPayment: st.register }, st.proofs, btn);
      if (!item) return;
      if (st.invEditor?.hasRows()) {
        try {
          await st.invEditor.save(c.id);
        } catch (err) {
          toast(`Conciliado, mas a fatura não foi gravada: ${errMsg(err)}`, { type: "error" });
        }
      }
      done(`Conciliado com ${c.number}.`);
    } else {
      const amount = round2(st.invAmount);
      if (!(amount > 0)) return toast("Indique o valor recebido.", { type: "error" });
      if (amount > m.amount + 0.5) return toast("O valor não pode passar o da entrada do banco.", { type: "error" });
      if (!st.proofs.length) {
        const z = body.querySelector("[data-zone-proofs] .fo-filezone");
        z?.classList.add("is-invalid");
        z?.scrollIntoView({ behavior: "smooth", block: "center" });
        return toast("Anexe o comprovativo do recebimento (banco).", { type: "error" });
      }
      if (amount > c.missingAmount + 0.5) {
        const ok = await ask(`O valor (${money(amount)}) é maior do que o que falta receber da fatura (${money(c.missingAmount)}). Registar mesmo assim?`, { title: "Recebimento acima do em falta", ok: "Registar" });
        if (!ok) return;
      }
      const item = await submit({ kind: "INVOICE", invoices: [{ id: c.id, amount }] }, st.proofs, btn);
      if (item) done(`Conciliado com a fatura ${c.docNumber || ""}.`);
    }
  });

  renderPick();
  loadCands();
}

// ─── devolução (REEMB) ───────────────────────────────────────────────────────

function openDevlink(m) {
  const st = { card: "", q: "", pick: m.refundOfId || "", proofs: [] };
  const drawer = openDrawer({ kicker: "Devolução", title: `${money(m.amount)} · ${fmtDate(m.movementDate)} · Entrou em ${esc(m.cardLabel || "")}`, subtitle: "Escolha a saída a que esta devolução corresponde.", width: 920 });
  const body = drawer.body;
  const outs = () =>
    S.items
      .filter((x) => x.direction === "SAIDA" && (!st.card || x.cardId === st.card))
      .filter((x) => !st.q || norm(`${x.description} ${x.cardLabel} ${money(x.amount)} ${x.paymentRequest?.number || ""}`).includes(norm(st.q)))
      .sort((a, b) => Math.abs(a.amount - m.amount) - Math.abs(b.amount - m.amount) || b.movementDate.localeCompare(a.movementDate));
  const rows = () => {
    const list = outs();
    return list.length
      ? list
          .slice(0, 200)
          .map((x) => `<tr class="is-pick ${st.pick === x.id ? "is-match" : ""}" data-pick="${esc(x.id)}"><td class="w-0"><input type="radio" name="devout" ${st.pick === x.id ? "checked" : ""}></td><td>${fmtDate(x.movementDate)}</td><td>${esc(x.cardLabel || "")}</td><td class="fo-ellipsis" style="max-width:320px">${esc(x.description || "—")}${Math.abs(x.amount - m.amount) < 0.5 ? ' <span class="fo-green" style="font-weight:700;font-size:11px">valor igual</span>' : ""}</td><td class="ta-r">${signedHtml(x)}</td><td class="ta-r fo-num fo-muted">${x.refundedAmount ? money(x.refundedAmount) : "—"}</td></tr>`)
          .join("")
      : '<tr><td colspan="6" class="fo-empty-cell">Nenhuma saída com estes filtros.</td></tr>';
  };
  const draw = () => {
    body.innerHTML = `<section class="fo-section">
      <div class="fo-inline-form"><select class="fo-input" data-dcard style="max-width:240px"><option value="">Todas as contas</option>${S.meta.cards.map((c) => `<option value="${esc(c.id)}" ${st.card === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
        <label class="fo-search" style="flex:1 1 240px">${icon("search")}<input data-dq value="${esc(st.q)}" placeholder="Pesquisar…"></label><span class="fo-muted" style="font-size:12.5px" data-dn>${outs().length} saída(s)</span></div>
      <div class="fo-preview" style="max-height:380px;margin-top:.7rem"><table class="fo-mini-table"><thead><tr><th></th><th>Data</th><th>Conta</th><th>Descrição</th><th class="ta-r">Valor</th><th class="ta-r">Já devolvido</th></tr></thead><tbody data-drows>${rows()}</tbody></table></div>
    </section>
    <section class="fo-section"><span class="fo-label">Comprovativo da devolução ${m.proofPath ? '<span class="fo-faint">(já anexado — opcional)</span>' : '<i class="fo-req">*</i>'}</span><div data-zone>${fileZoneHtml("proofs", { label: "Anexar", accept: ".pdf,image/*", files: st.proofs })}</div></section>`;
    bindFileZones(body.querySelector("[data-zone]"), st, draw);
  };
  drawer.setFooter(`<div class="fo-foot-info"></div><div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--primary" data-link>${icon("link")}Ligar</button></div>`);
  body.addEventListener("input", (e) => {
    if (!e.target.matches("[data-dq]")) return;
    st.q = e.target.value;
    body.querySelector("[data-drows]").innerHTML = rows();
    body.querySelector("[data-dn]").textContent = `${outs().length} saída(s)`;
  });
  body.addEventListener("change", (e) => {
    if (e.target.matches("[data-dcard]")) {
      st.card = e.target.value;
      draw();
    }
  });
  body.addEventListener("click", (e) => {
    const r = e.target.closest("[data-pick]");
    if (!r) return;
    st.pick = r.dataset.pick;
    body.querySelector("[data-drows]").innerHTML = rows();
  });
  drawer.footer.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-link]");
    if (!btn) return;
    if (!st.pick) return toast("Escolha a saída a que esta devolução corresponde.", { type: "error" });
    if (!st.proofs.length && !m.proofPath) {
      body.querySelector("[data-zone] .fo-filezone")?.classList.add("is-invalid");
      return toast("Anexe o comprovativo da devolução.", { type: "error" });
    }
    const fd = new FormData();
    fd.append("payload", JSON.stringify({ refundOfId: st.pick }));
    if (st.proofs[0]) fd.append("proof", st.proofs[0]);
    setBusy(btn, true, "A ligar…");
    try {
      await apiUpload(`${BASE}/movements/${m.id}/refund`, fd, "POST");
      toast("Devolução ligada à saída.", { type: "success" });
      drawer.close(true);
      refresh();
    } catch (err) {
      setBusy(btn, false);
      toast(errMsg(err), { type: "error" });
    }
  });
  draw();
}

// ─── comprovativo do movimento ───────────────────────────────────────────────

function openMovCp(m) {
  const st = { proofs: [] };
  const pr = m.paymentRequest;
  const drawer = openDrawer({ kicker: "Comprovativo de pagamento", title: `${money(m.amount)} · ${fmtDate(m.movementDate)}`, subtitle: [esc(m.description || ""), pr ? `${esc(pr.number)} · ${esc(pr.supplierName || "")}` : ""].filter(Boolean).join(" · "), width: 640 });
  const draw = () => {
    drawer.body.innerHTML = `<section class="fo-section">
      ${m.proofPath ? `<div class="fo-note fo-note--good">${icon("verified")}<span>Já tem comprovativo: <a class="fo-link" href="${esc(fileUrl(m.proofPath))}" target="_blank" rel="noopener">${esc(m.proofName || "abrir")}</a>. Anexar outro substitui-o.</span></div>` : ""}
      <span class="fo-label">Comprovativo(s) <i class="fo-req">*</i></span><div data-zone>${fileZoneHtml("proofs", { label: "Anexar", accept: ".pdf,image/*", files: st.proofs })}</div>
      <p class="fo-help" style="margin:.6rem 0 0">Fica ligado a este movimento${pr ? " e ao pagamento do pedido" : ""}.</p></section>`;
    bindFileZones(drawer.body.querySelector("[data-zone]"), st, draw);
  };
  drawer.setFooter(`<div class="fo-foot-info"></div><div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--primary" data-save>${icon("save")}Gravar</button></div>`);
  drawer.footer.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-save]");
    if (!btn) return;
    if (!st.proofs.length) {
      drawer.body.querySelector("[data-zone] .fo-filezone")?.classList.add("is-invalid");
      return toast("Anexe o comprovativo.", { type: "error" });
    }
    const fd = new FormData();
    fd.append("file", st.proofs[0]);
    setBusy(btn, true, "A gravar…");
    try {
      const { item } = await apiUpload(`${BASE}/movements/${m.id}/proof`, fd, "POST");
      toast("Comprovativo anexado.", { type: "success" });
      drawer.close(true);
      upsert(item);
    } catch (err) {
      setBusy(btn, false);
      toast(errMsg(err), { type: "error" });
    }
  });
  draw();
}

// ─── desfazer ────────────────────────────────────────────────────────────────

async function undo(m) {
  const what = m.reconcileKind === "REQUEST" ? "O pagamento registado por esta conciliação é anulado." : m.reconcileKind === "INVOICE" ? "O recebimento registado na fatura é anulado." : m.reconcileKind === "TRANSFER" ? "O movimento da outra conta também volta a ficar por conciliar." : m.reconcileKind === "REFUND" ? "A devolução deixa de estar ligada à saída." : "";
  const ok = await ask(`Desfazer a conciliação deste movimento de ${money(m.amount)}? ${what}`, { title: "Desfazer a conciliação", ok: "Desfazer", danger: true });
  if (!ok) return;
  try {
    await apiRequest(`${BASE}/movements/${m.id}/unreconcile`, { method: "POST" });
    toast("Conciliação desfeita.", { type: "success" });
    refresh({ meta: true });
  } catch (err) {
    toast(errMsg(err), { type: "error" });
  }
}

async function editRequest(m) {
  try {
    const { item } = await apiRequest(`/finance/payment-requests/${m.paymentRequest.id}`);
    openRequestForm({ item, onSaved: () => refresh() });
  } catch (err) {
    toast(errMsg(err), { type: "error" });
  }
}

// ─── tipos e subtipos ────────────────────────────────────────────────────────

const CONC_WITH = {
  PF: "Pedido do Centro de Pagamentos",
  RC: "Fatura emitida (Centro de Recebimentos)",
  "TRF INT": "Outra conta da empresa (casa com o movimento oposto)",
  ENC: "Automático — mapa mensal de encargos bancários",
  CC: "Pedido do Centro de Pagamentos ou sem pedido",
  SC: "Pagamento a sócio (Financiamento › Sócios)",
  REEMB: "A saída que foi devolvida (↩ ligar à saída)",
};

function openTypesDrawer() {
  const drawer = openDrawer({ kicker: "Classificação", title: "Tipos e Subtipos", subtitle: "Os tipos são fixos. Os subtipos de cada tipo podem ser acrescentados, renomeados ou apagados aqui; aparecem no extrato, nas regras e nos filtros. Os subtipos do PE são também os tipos de imposto.", width: 860 });
  const body = drawer.body;
  const withSubs = () => S.meta.types.filter((t) => subtypesOf(t.code).length || ["PE", "ENC", "SC"].includes(t.code));
  let tab = withSubs()[0]?.code || S.meta.types[0]?.code;
  drawer.setFooter(`<div class="fo-foot-info"></div><div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--primary" data-close>Fechar</button></div>`);

  const draw = () => {
    const t = typeOf(tab);
    const subs = subtypesOf(tab);
    body.innerHTML = `<div class="fo-type-tabs">${S.meta.types
      .map((x) => `<button type="button" class="${x.code === tab ? "is-on" : ""} ${x.soon ? "is-soon" : ""}" data-tab="${esc(x.code)}"><b>${esc(x.code)}</b><span>${esc(x.label.split(" (")[0])}</span>${subtypesOf(x.code).length ? `<i>${subtypesOf(x.code).length}</i>` : ""}</button>`)
      .join("")}</div>
      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title">Subtipos de ${esc(tab)} — ${esc(t?.label || "")}</h3>${t?.soon ? '<span class="fo-soon">em preparação</span>' : ""}</div>
        <p class="fo-section-hint">${t?.dir === "SAIDA" ? "Saída" : t?.dir === "ENTRADA" ? "Entrada" : "Saída ou entrada"} · concilia com: ${esc(CONC_WITH[tab] || (t?.soon ? "módulo em preparação" : "—"))}</p>
        <table class="fo-mini-table"><thead><tr><th>Subtipo</th><th class="ta-r">Movimentos</th><th></th></tr></thead><tbody>
        ${
          subs
            .map(
              (s) => `<tr data-sub="${esc(s.id)}"><td><input class="fo-input fo-input--sm" data-sub-name value="${esc(s.name)}" ${canEdit() ? "" : "disabled"}></td><td class="ta-r fo-num">${s.movements || 0}</td><td class="ta-r nowrap">${
                canEdit() ? `<button type="button" class="fo-btn fo-btn--ghost fo-btn--xs" data-sub-save>Gravar nome</button> <button type="button" class="fo-btn fo-btn--ghost fo-btn--xs fo-red" data-sub-del>Apagar</button>` : ""
              }</td></tr>`
            )
            .join("") || '<tr><td colspan="3" class="fo-empty-cell">Este tipo ainda não tem subtipos.</td></tr>'
        }
        </tbody></table>
        ${canEdit() ? `<div class="fo-inline-form" style="margin-top:.8rem"><label class="fo-field" style="flex:1 1 260px"><span class="fo-label">Novo subtipo</span><input class="fo-input" data-sub-new placeholder="Ex.: COMISSÃO DE TRANSFERÊNCIA"></label><button type="button" class="fo-btn fo-btn--primary" data-sub-add style="align-self:flex-end">${icon("add")}Adicionar</button></div>` : ""}
      </section>`;
  };

  body.addEventListener("click", async (e) => {
    const t = e.target;
    const tb = t.closest("[data-tab]");
    if (tb) {
      tab = tb.dataset.tab;
      return draw();
    }
    const row = t.closest("[data-sub]");
    try {
      if (t.closest("[data-sub-add]")) {
        const inp = body.querySelector("[data-sub-new]");
        const name = inp.value.trim();
        if (!name) return inp.classList.add("is-invalid");
        await apiRequest(`${BASE}/subtypes`, { method: "POST", body: { typeCode: tab, name } });
        toast("Subtipo acrescentado.", { type: "success" });
      } else if (row && t.closest("[data-sub-save]")) {
        const name = row.querySelector("[data-sub-name]").value.trim();
        if (!name) return;
        await apiRequest(`${BASE}/subtypes/${row.dataset.sub}`, { method: "PATCH", body: { name } });
        toast("Nome gravado (também nos movimentos e nas regras).", { type: "success" });
      } else if (row && t.closest("[data-sub-del]")) {
        const s = subtypesOf(tab).find((x) => x.id === row.dataset.sub);
        const ok = await ask(`Apagar o subtipo «${s?.name}»?${s?.movements ? ` ${s.movements} movimento(s) ficam sem subtipo.` : ""}`, { title: "Apagar subtipo", ok: "Apagar", danger: true });
        if (!ok) return;
        await apiRequest(`${BASE}/subtypes/${row.dataset.sub}`, { method: "DELETE" });
        toast("Subtipo apagado.", { type: "success" });
      } else return;
      await loadMeta();
      draw();
      loadMovements().then(renderAll);
    } catch (err) {
      toast(errMsg(err), { type: "error" });
    }
  });
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-sub-new]")) body.querySelector("[data-sub-add]")?.click();
  });
  draw();
}

// ─── regras de classificação ─────────────────────────────────────────────────

function openRulesDrawer() {
  const edit = canEdit();
  let rules = (S.meta.rules || []).map((r) => ({ pattern: r.pattern, direction: r.direction || "", typeCode: r.typeCode, subtype: r.subtype || "", ccCode: r.ccCode || "" }));
  const drawer = openDrawer({ kicker: "Tesouraria", title: "Regras de Classificação Automática", subtitle: "O tipo do movimento (PF, RC, TRF INT, ENC…) é proposto a partir da descrição do extrato. A primeira regra que corresponder ganha.", width: 1060 });
  const body = drawer.body;
  const typeOpts = (sel) => S.meta.types.map((t) => `<option value="${esc(t.code)}" ${t.code === sel ? "selected" : ""}>${esc(t.code)}</option>`).join("");
  const subOpts = (code, sel) => `<option value="">—</option>${subtypesOf(code).map((s) => `<option ${s.name === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("")}${sel && !subtypesOf(code).some((s) => s.name === sel) ? `<option selected>${esc(sel)}</option>` : ""}`;
  const dis = edit ? "" : "disabled";

  const draw = () => {
    body.innerHTML = `<section class="fo-section">
      <div class="fo-preview" style="max-height:none"><table class="fo-mini-table fo-rules-table"><thead><tr><th>A descrição contém</th><th>Sinal</th><th>Tipo</th><th>Subtipo (opcional)</th><th>Obra / CC (opcional)</th><th></th></tr></thead><tbody>
      ${rules
        .map(
          (r, i) => `<tr data-r="${i}">
          <td><input class="fo-input fo-input--sm" data-k="pattern" value="${esc(r.pattern)}" ${dis}></td>
          <td><select class="fo-input fo-input--sm" data-k="direction" ${dis}><option value="" ${!r.direction ? "selected" : ""}>qualquer</option><option value="SAIDA" ${r.direction === "SAIDA" ? "selected" : ""}>saída</option><option value="ENTRADA" ${r.direction === "ENTRADA" ? "selected" : ""}>entrada</option></select></td>
          <td><select class="fo-input fo-input--sm" data-k="typeCode" ${dis}>${typeOpts(r.typeCode)}</select></td>
          <td><select class="fo-input fo-input--sm" data-k="subtype" ${dis}>${subOpts(r.typeCode, r.subtype)}</select></td>
          <td><input class="fo-input fo-input--sm" data-k="ccCode" value="${esc(r.ccCode)}" placeholder="—" ${dis}></td>
          <td class="ta-r">${edit ? `<button type="button" class="fo-icon-btn fo-icon-btn--sm" data-rm title="Retirar a regra">${icon("close")}</button>` : ""}</td></tr>`
        )
        .join("") || '<tr><td colspan="6" class="fo-empty-cell">Sem regras.</td></tr>'}
      </tbody></table></div>
      ${edit ? `<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-add style="margin-top:.7rem">${icon("add")}Nova regra</button>` : ""}
      <p class="fo-help" style="margin:.8rem 0 0">As regras aplicam-se ao importar e no botão «⟳ Aplicar regras»: classificam os movimentos sem tipo e voltam a classificar os que foram classificados por regras. Nunca alteram um tipo escolhido à mão nem movimentos já conciliados.</p>
    </section>`;
  };
  drawer.setFooter(
    edit
      ? `<div class="fo-foot-info"><button type="button" class="fo-btn fo-btn--ghost" data-reset>${icon("restart_alt")}Repor as regras de base</button></div><div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--primary" data-save>${icon("save")}Gravar regras</button></div>`
      : `<div class="fo-foot-info"></div><div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--primary" data-close>Fechar</button></div>`
  );
  const readRow = (tr) => {
    const r = rules[Number(tr.dataset.r)];
    tr.querySelectorAll("[data-k]").forEach((el) => (r[el.dataset.k] = el.value));
    return r;
  };
  body.addEventListener("input", (e) => {
    const tr = e.target.closest("[data-r]");
    if (tr) readRow(tr);
  });
  body.addEventListener("change", (e) => {
    const tr = e.target.closest("[data-r]");
    if (!tr) return;
    const r = readRow(tr);
    if (e.target.dataset.k === "typeCode") {
      r.subtype = "";
      tr.querySelector('[data-k="subtype"]').innerHTML = subOpts(r.typeCode, "");
    }
  });
  body.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) {
      rules.push({ pattern: "", direction: "", typeCode: "PF", subtype: "", ccCode: "" });
      draw();
      body.querySelector(`[data-r="${rules.length - 1}"] [data-k="pattern"]`)?.focus();
      return;
    }
    const rm = e.target.closest("[data-rm]");
    if (rm) {
      rules.splice(Number(rm.closest("[data-r]").dataset.r), 1);
      draw();
    }
  });
  drawer.footer.addEventListener("click", async (e) => {
    const reset = e.target.closest("[data-reset]");
    if (reset) {
      const ok = await ask("Repor as regras de base? As regras atuais são substituídas.", { title: "Repor as regras de base", ok: "Repor", danger: true });
      if (!ok) return;
      try {
        const res = await apiRequest(`${BASE}/rules/reset`, { method: "POST" });
        S.meta.rules = res.rules;
        rules = res.rules.map((r) => ({ pattern: r.pattern, direction: r.direction || "", typeCode: r.typeCode, subtype: r.subtype || "", ccCode: r.ccCode || "" }));
        draw();
        toast("Regras de base repostas.", { type: "success" });
      } catch (err) {
        toast(errMsg(err), { type: "error" });
      }
      return;
    }
    const btn = e.target.closest("[data-save]");
    if (!btn) return;
    const list = rules.filter((r) => r.pattern.trim());
    setBusy(btn, true, "A gravar…");
    try {
      const res = await apiRequest(`${BASE}/rules`, { method: "PUT", body: { rules: list.map((r) => ({ pattern: r.pattern.trim(), direction: r.direction || null, typeCode: r.typeCode, subtype: r.subtype || null, ccCode: r.ccCode || null })) } });
      S.meta.rules = res.rules;
      toast(`${res.rules.length} regra(s) gravada(s).`, { type: "success" });
      drawer.close(true);
      renderToolbar();
    } catch (err) {
      setBusy(btn, false);
      toast(errMsg(err), { type: "error" });
    }
  });
  draw();
}

async function applyRules(btn) {
  setBusy(btn, true, "A aplicar…");
  try {
    const { changed, remaining } = await apiRequest(`${BASE}/rules/apply`, { method: "POST", body: {} });
    toast(changed ? `${changed} movimento(s) classificado(s) · ${remaining} continuam sem tipo.` : "Nenhuma regra se aplica aos movimentos sem tipo.", { type: changed ? "success" : "info" });
    await refresh();
  } catch (err) {
    toast(errMsg(err), { type: "error" });
  } finally {
    setBusy(btn, false);
  }
}

async function autoTransfers(btn) {
  setBusy(btn, true, "A conciliar…");
  try {
    const { reconciled, paired } = await apiRequest(`${BASE}/transfers/auto`, { method: "POST" });
    toast(`${reconciled} transferência(s) conciliada(s) · ${paired} com o movimento da outra conta.`, { type: "success" });
    await refresh();
  } catch (err) {
    toast(errMsg(err), { type: "error" });
  } finally {
    setBusy(btn, false);
  }
}

// ─── importar extrato ────────────────────────────────────────────────────────

const GUESS = {
  date: /^(data( (mov|movimento|opera[cç][aã]o|lan[cç]amento))?|date|dt)\b/i,
  value: /data.?(valor|efetiva)|value.?date/i,
  desc: /descri|hist[oó]rico|movimento|narrat|detalhe|description/i,
  debit: /d[eé]bito|debit|sa[ií]da|levantamento/i,
  credit: /cr[eé]dito|credit|entrada|dep[oó]sito/i,
  amount: /^(montante|valor|amount|import[aâ]ncia)$/i,
  ref: /refer|ref\b/i,
  balance: /saldo|balance/i,
  type: /^tipo\b|^type$/i,
  cc: /obra|centro.?de.?custo|^cc$/i,
  doc: /^doc|n\.?[ºo°]? ?doc|documento/i,
  party: /fornecedor|cliente|benefici|ordenante|terceiro/i,
};

function toDateKey(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function numCell(v) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^-/.test(s.replace(/\s/g, ""));
  const n = parseMoney(s.replace(/[()]/g, ""));
  return neg ? -Math.abs(n) : n;
}

/** Proposta de tipo pelas regras (igual ao servidor: a primeira que corresponder ganha). */
function classify(desc, direction) {
  const d = norm(desc);
  const r = (S.meta.rules || []).find((x) => x.active !== false && x.pattern && d.includes(norm(x.pattern)) && (!x.direction || x.direction === direction));
  return r ? { typeCode: r.typeCode, subtype: r.subtype || "", ccCode: r.ccCode || "" } : null;
}

/** Procura no cabeçalho do ficheiro o n.º de conta / IBAN e a conta correspondente. */
function detectAccount(rows, headerIdx) {
  const text = rows
    .slice(0, Math.max(headerIdx, 1))
    .flat()
    .map((c) => String(c ?? ""))
    .join(" ");
  const nums = [...text.replace(/[.\s-]/g, (x) => (x === " " ? " " : "")).matchAll(/(?:AO06)?\d{8,25}/gi)].map((x) => x[0]);
  const acc = nums.sort((a, b) => b.length - a.length)[0] || "";
  if (!acc) return null;
  const hit = S.meta.cards.find((c) => c.lastDigits && String(c.lastDigits).length >= 3 && acc.endsWith(String(c.lastDigits)));
  return { number: acc, card: hit || null };
}

async function openImport() {
  const cards = S.meta.cards.filter((c) => c.active !== false);
  const st = { cardId: S.f.card || "", file: null, rows: [], headerIdx: 0, map: {}, name: "", opening: "", closing: "", useOpening: true, detected: null };
  const drawer = openDrawer({ kicker: "Tesouraria", title: "Importar Extrato", subtitle: "Excel (.xlsx / .xls) ou CSV exportado do banco.", width: 1080 });
  const body = drawer.body;

  function headers() {
    return (st.rows[st.headerIdx] || []).map((h, i) => ({ i, h: String(h ?? "").trim() || `Coluna ${i + 1}` }));
  }

  function guess() {
    const hs = headers();
    const find = (re, not) => hs.find((x) => re.test(x.h) && !(not && not.test(x.h)))?.i ?? "";
    st.map = {
      date: find(GUESS.date, GUESS.value),
      value: find(GUESS.value),
      desc: find(GUESS.desc, /data/i),
      debit: find(GUESS.debit),
      credit: find(GUESS.credit),
      amount: find(GUESS.amount),
      ref: find(GUESS.ref),
      balance: find(GUESS.balance),
      type: find(GUESS.type),
      cc: find(GUESS.cc),
      doc: find(GUESS.doc, GUESS.ref),
      party: find(GUESS.party),
    };
    if (st.map.date === "") st.map.date = 0;
  }

  const cell = (row, k) => (st.map[k] !== "" && st.map[k] !== undefined ? String(row[st.map[k]] ?? "").trim() : "");

  function parsed() {
    const mp = st.map;
    const out = [];
    const codes = new Set(S.meta.types.map((t) => t.code));
    for (let r = st.headerIdx + 1; r < st.rows.length; r++) {
      const row = st.rows[r] || [];
      const date = toDateKey(row[mp.date]);
      if (!date) continue;
      let amount = 0;
      if (mp.debit !== "" || mp.credit !== "") {
        const d = mp.debit !== "" ? Math.abs(numCell(row[mp.debit])) : 0;
        const c = mp.credit !== "" ? Math.abs(numCell(row[mp.credit])) : 0;
        amount = c - d;
      } else if (mp.amount !== "") amount = numCell(row[mp.amount]);
      if (!amount) continue;
      const direction = amount < 0 ? "SAIDA" : "ENTRADA";
      const description = cell(row, "desc");
      const fileType = cell(row, "type").toUpperCase();
      const auto = classify(description, direction);
      const typeCode = codes.has(fileType) ? fileType : auto?.typeCode || "";
      out.push({
        movementDate: date,
        effectiveDate: mp.value !== "" ? toDateKey(row[mp.value]) : null,
        direction,
        amount: round2(Math.abs(amount)),
        description,
        docNumber: cell(row, "doc") || cell(row, "ref") || null,
        balance: mp.balance !== "" ? numCell(row[mp.balance]) : null,
        typeCode,
        typeFromRule: !codes.has(fileType) && Boolean(auto),
        ccCode: cell(row, "cc") || auto?.ccCode || "",
        party: cell(row, "party"),
      });
    }
    const seen = new Set(S.items.filter((m) => m.cardId === st.cardId).map((m) => `${m.movementDate}|${m.direction}|${m.amount.toFixed(2)}|${norm(m.description)}`));
    out.forEach((x) => (x.dup = seen.has(`${x.movementDate}|${x.direction}|${x.amount.toFixed(2)}|${norm(x.description)}`)));
    return out;
  }

  function draw() {
    const hs = headers();
    const sel = (k, label, opt = true) => `<label class="fo-field"><span class="fo-label">${label}</span><select class="fo-input fo-input--sm" data-map="${k}">${opt ? '<option value="">—</option>' : ""}${hs.map((x) => `<option value="${x.i}" ${String(st.map[k]) === String(x.i) ? "selected" : ""}>${esc(x.h)}</option>`).join("")}</select></label>`;
    const list = st.rows.length ? parsed() : [];
    const fresh = list.filter((x) => !x.dup);
    const dates = fresh.map((x) => x.movementDate).sort();
    const card = cards.find((c) => c.id === st.cardId);
    if (!st.name && card && dates.length) st.name = `Extrato ${card.label} ${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`;
    const inSum = fresh.filter((x) => x.direction === "ENTRADA").reduce((a, x) => a + x.amount, 0);
    const outSum = fresh.filter((x) => x.direction === "SAIDA").reduce((a, x) => a + x.amount, 0);
    const det = st.detected;
    const detHtml = det
      ? det.card
        ? det.card.id === st.cardId
          ? `<p class="fo-help fo-green" style="margin:.35rem 0 0">✓ O ficheiro indica a conta ${esc(det.number)} → ${esc(det.card.label)}</p>`
          : `<p class="fo-help fo-amber" style="margin:.35rem 0 0">⚠ O ficheiro indica a conta ${esc(det.number)} (${esc(det.card.label)}), mas escolheu ${esc(card?.label || "outra")}.</p>`
        : `<p class="fo-help fo-amber" style="margin:.35rem 0 0">⚠ O ficheiro indica a conta ${esc(det.number)}, que não corresponde a nenhuma conta registada — confirme a escolha.</p>`
      : "";
    body.innerHTML = `
      <section class="fo-section"><div class="fo-section-head"><h3 class="fo-section-title"><span class="fo-step ${st.cardId ? "is-done" : ""}">1</span>Conta do extrato</h3></div>
        <div class="fo-grid">
          <label class="fo-field fo-col-5"><span class="fo-label">Conta / cartão <i class="fo-req">*</i></span><select class="fo-input ${st.cardId ? "" : "is-warn"}" data-card-sel><option value="">— escolher a conta —</option>${cards.map((c) => `<option value="${esc(c.id)}" ${st.cardId === c.id ? "selected" : ""}>${esc(c.label)}${c.bank ? ` · ${esc(c.bank)}` : ""}</option>`).join("")}</select>
            ${cards.length ? detHtml : '<span class="fo-help">Ainda não há contas: crie-as em Tesouraria › Contas e cartões.</span>'}</label>
          <div class="fo-field fo-col-7"><span class="fo-label"><span class="fo-step" style="margin-right:.3rem">2</span>Ficheiro do extrato <i class="fo-req">*</i></span>
            <div class="fo-filezone ${st.file ? "has-files" : ""}" data-pick><div class="fo-filezone-drop">${icon("upload_file")}<span><b>${st.file ? esc(st.file.name) : "⬆ Escolher o Ficheiro do Extrato"}</b><small>${st.file ? `${list.length} movimento(s) lidos · clique para trocar` : "Excel ou CSV — arraste para aqui ou clique"}</small></span></div></div></div>
        </div></section>
      ${
        st.rows.length
          ? `<details class="fo-details fo-section">
              <summary><b>Colunas do ficheiro</b> <span class="fo-muted">(detetadas automaticamente — abra só se algo estiver errado)</span></summary>
              <div style="display:flex;justify-content:flex-end;margin:.6rem 0"><label class="fo-field" style="flex-direction:row;align-items:center;gap:.5rem"><span class="fo-label">Linha dos títulos</span><input class="fo-input fo-input--sm is-num" data-hdr value="${st.headerIdx + 1}" style="width:70px" inputmode="numeric"></label></div>
              <div class="fo-map-grid">${sel("date", "Data do movimento *", false)}${sel("value", "Data efetiva")}${sel("desc", "Descrição")}${sel("debit", "Débito (saídas)")}${sel("credit", "Crédito (entradas)")}${sel("amount", "Valor (com sinal)")}${sel("type", "Tipo")}${sel("cc", "Obra / CC")}${sel("doc", "Doc.")}${sel("ref", "Referência")}${sel("party", "Fornecedor / cliente")}${sel("balance", "Saldo")}</div>
              <p class="fo-help" style="margin:.6rem 0 0">Use Débito + Crédito, ou uma só coluna de Valor com sinal (negativo = saída).</p></details>
          <section class="fo-section"><div class="fo-section-head"><h3 class="fo-section-title"><span class="fo-step">3</span>Pré-visualização</h3>
              <span class="fo-muted" style="font-size:12.5px"><b>${fresh.length}</b> linha(s) válida(s)${list.length - fresh.length ? ` · <b class="fo-amber">${list.length - fresh.length}</b> já importada(s), ignoradas` : ""} · entradas <b class="fo-green">${money(inSum)}</b> · saídas <b class="fo-red">${money(outSum)}</b></span></div>
            <div class="fo-preview" style="max-height:340px"><table class="fo-mini-table"><thead><tr><th>Data</th><th>Descrição</th><th class="ta-r">Valor</th><th>Tipo</th><th>Obra/CC</th><th>Doc.</th><th>Fornecedor/cliente</th><th>Conta</th></tr></thead><tbody>
              ${
                list
                  .slice(0, 300)
                  .map(
                    (x) =>
                      `<tr style="${x.dup ? "opacity:.45;text-decoration:line-through" : ""}"><td class="nowrap">${fmtDate(x.movementDate)}</td><td>${esc(x.description)}</td><td class="ta-r nowrap"><span class="fo-num ${x.direction === "SAIDA" ? "fo-amount-out" : "fo-amount-in"}">${x.direction === "SAIDA" ? "−" : ""}${money(x.amount)}</span></td><td>${x.typeCode ? `<span class="fo-tag ${x.typeFromRule ? "" : "fo-tag--navy"}" title="${x.typeFromRule ? "Proposto pelas regras" : "Do ficheiro"}">${esc(x.typeCode)}</span>` : '<span class="fo-faint">—</span>'}</td><td class="fo-muted">${esc(x.ccCode || "")}</td><td class="fo-muted">${esc(x.docNumber || "")}</td><td class="fo-muted">${esc(x.party || "")}</td><td class="fo-muted nowrap">${esc(card?.label || "—")}</td></tr>`
                  )
                  .join("") || '<tr><td colspan="8" class="fo-empty-cell">Nenhum movimento reconhecido — confira as colunas e a linha dos títulos.</td></tr>'
              }
            </tbody></table></div>
            ${
              st.opening !== "" && card
                ? `<label class="fo-check ${st.useOpening ? "is-on" : ""}" style="margin-top:.8rem;align-self:flex-start"><input type="checkbox" data-use-open ${st.useOpening ? "checked" : ""}>Usar o saldo antes do 1.º movimento (calculado do extrato) (<b class="fo-num">${money(st.opening)}</b>) como saldo inicial de ${esc(card.label)}</label>`
                : ""
            }
            <div class="fo-grid" style="margin-top:.9rem">
              <label class="fo-field fo-col-6"><span class="fo-label">Nome do extrato</span><input class="fo-input" data-name value="${esc(st.name)}"></label>
              <label class="fo-field fo-col-3"><span class="fo-label">Saldo inicial</span><input class="fo-input" data-money data-open value="${st.opening === "" ? "" : money(st.opening)}" placeholder="opcional"></label>
              <label class="fo-field fo-col-3"><span class="fo-label">Saldo final</span><input class="fo-input" data-money data-close value="${st.closing === "" ? "" : money(st.closing)}" placeholder="opcional"></label>
            </div></section>`
          : ""
      }`;
    bindMoney(body);
    drawer.setFooter(`<div class="fo-foot-info"><span>${fresh.length ? `<b>${fresh.length}</b> linha(s) válida(s) · entradas <b class="fo-green">${money(inSum)}</b> · saídas <b class="fo-red">${money(outSum)}</b>` : "Escolha a conta e o ficheiro"}</span></div><div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--ghost" data-cancel>Cancelar</button><button type="button" class="fo-btn fo-btn--primary" data-go ${fresh.length && st.cardId ? "" : "disabled"}>${icon("upload")}Importar ${fresh.length || ""} movimento(s)</button></div>`);
  }

  async function readFile(file) {
    try {
      const XLSX = await loadXlsx();
      const buf = await file.arrayBuffer();
      let wb;
      if (/\.(csv|txt)$/i.test(file.name) || /csv|text\/plain/i.test(file.type)) {
        // CSV: lê o texto em UTF-8 (ou Windows-1252, o dos bancos antigos) e mantém
        // as células como texto — «01/11/2026» não pode virar 11 de janeiro.
        let text;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        } catch {
          text = new TextDecoder("windows-1252").decode(buf);
        }
        wb = XLSX.read(text.replace(/^﻿/, ""), { type: "string", raw: true });
      } else {
        wb = XLSX.read(buf, { type: "array", cellDates: true, raw: false, dateNF: "yyyy-mm-dd" });
      }
      const ws = wb.Sheets[wb.SheetNames[0]];
      st.rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      st.file = file;
      // linha dos títulos: a primeira com 3+ células de texto e uma «data»
      st.headerIdx = Math.max(0, st.rows.findIndex((r) => r.filter((c) => String(c).trim()).length >= 3 && r.some((c) => /data|date/i.test(String(c)))));
      st.detected = detectAccount(st.rows, st.headerIdx);
      if (st.detected?.card && !st.cardId) st.cardId = st.detected.card.id;
      guess();
      const p = parsed();
      const withBal = p.filter((x) => x.balance !== null && x.balance !== 0);
      st.opening = st.closing = "";
      if (withBal.length) {
        // o extrato pode vir do mais recente para o mais antigo
        const asc = p[0] && p[p.length - 1] && p[0].movementDate > p[p.length - 1].movementDate ? [...withBal].reverse() : withBal;
        st.closing = asc[asc.length - 1].balance;
        const first = asc[0];
        st.opening = round2(first.balance - (first.direction === "ENTRADA" ? first.amount : -first.amount));
      }
      st.name = "";
      draw();
    } catch (err) {
      console.error(err);
      toast("Não foi possível ler o ficheiro. Exporte o extrato em Excel ou CSV.", { type: "error" });
    }
  }

  body.addEventListener("click", async (e) => {
    if (e.target.closest("[data-pick]")) {
      const [file] = await pickFiles({ accept: ".xlsx,.xls,.csv,.txt" });
      if (file) readFile(file);
    }
  });
  body.addEventListener("dragover", (e) => {
    if (e.target.closest("[data-pick]")) e.preventDefault();
  });
  body.addEventListener("drop", (e) => {
    if (!e.target.closest("[data-pick]")) return;
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) readFile(f);
  });
  body.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-card-sel]")) {
      st.cardId = t.value;
      st.name = "";
      draw();
    } else if (t.matches("[data-map]")) {
      st.map[t.dataset.map] = t.value === "" ? "" : Number(t.value);
      if (t.dataset.map === "amount" && t.value !== "") st.map.debit = st.map.credit = "";
      if ((t.dataset.map === "debit" || t.dataset.map === "credit") && t.value !== "") st.map.amount = "";
      draw();
      body.querySelector(".fo-details")?.setAttribute("open", "");
    } else if (t.matches("[data-hdr]")) {
      st.headerIdx = Math.max(0, Math.min(st.rows.length - 1, Math.round(num(t.value)) - 1));
      guess();
      draw();
      body.querySelector(".fo-details")?.setAttribute("open", "");
    } else if (t.matches("[data-use-open]")) {
      st.useOpening = t.checked;
      t.closest(".fo-check").classList.toggle("is-on", t.checked);
    }
  });
  body.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches("[data-name]")) st.name = t.value;
    else if (t.matches("[data-open]")) st.opening = t.value === "" ? "" : parseMoney(t.value);
    else if (t.matches("[data-close]")) st.closing = t.value === "" ? "" : parseMoney(t.value);
  });
  drawer.footer.addEventListener("click", async (e) => {
    if (e.target.closest("[data-cancel]")) return drawer.close();
    const btn = e.target.closest("[data-go]");
    if (!btn) return;
    const fresh = parsed().filter((x) => !x.dup);
    if (!st.cardId || !fresh.length) return;
    if (st.detected?.card && st.detected.card.id !== st.cardId) {
      const ok = await ask(`O ficheiro indica a conta ${st.detected.number} (${st.detected.card.label}), mas escolheu ${cardName(st.cardId)}. Importar mesmo assim?`, { title: "Conta diferente", ok: "Importar" });
      if (!ok) return;
    }
    const dates = fresh.map((x) => x.movementDate).sort();
    setBusy(btn, true, "A importar…");
    try {
      await apiRequest("/finance/bank-statements", {
        method: "POST",
        body: {
          cardId: st.cardId,
          name: st.name || `Extrato ${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`,
          periodStart: `${dates[0]}T12:00:00.000Z`,
          periodEnd: `${dates[dates.length - 1]}T12:00:00.000Z`,
          openingBalance: st.opening === "" ? null : num(st.opening),
          closingBalance: st.closing === "" ? null : num(st.closing),
          openingAsBalance: st.opening !== "" && st.useOpening,
          fileName: st.file?.name || null,
          movements: fresh.map((x) => ({
            direction: x.direction,
            amount: x.amount,
            movementDate: `${x.movementDate}T12:00:00.000Z`,
            effectiveDate: x.effectiveDate ? `${x.effectiveDate}T12:00:00.000Z` : null,
            description: x.description || null,
            docNumber: x.docNumber,
            movementType: "OUTRO",
            typeCode: x.typeFromRule ? null : x.typeCode || null,
            ccCode: x.ccCode || null,
            note: x.party || null,
          })),
        },
      });
      let classified = 0;
      try {
        classified = (await apiRequest(`${BASE}/rules/apply`, { method: "POST", body: { cardId: st.cardId } })).changed || 0;
      } catch {
        /* as regras são um extra */
      }
      toast(`${fresh.length} movimento(s) importado(s)${classified ? ` · ${classified} classificado(s) pelas regras` : ""}.`, { type: "success" });
      drawer.close(true);
      S.f.card = st.cardId;
      await refresh({ meta: true });
    } catch (err) {
      setBusy(btn, false);
      toast(errMsg(err, "Não foi possível importar o extrato."), { type: "error" });
    }
  });
  draw();
}

// ─── eventos ─────────────────────────────────────────────────────────────────

function bindEvents() {
  root.addEventListener("click", async (e) => {
    const t = e.target;
    const accOpen = t.closest("[data-acc-open]");
    if (accOpen) return openAccountPanel(accOpen);
    if (t.closest("[data-drop-target]")) {
      S.invoiceTarget = null;
      history.replaceState(null, "", location.pathname);
      return renderAll();
    }
    if (t.closest("[data-retry]")) return refresh();
    if (t.closest("[data-import-empty]")) return openImport();
    if (t.closest("[data-clear-sel]")) {
      S.selected.clear();
      return renderAll();
    }
    if (t.closest("[data-conc-sel]")) {
      const list = [...S.selected].map((id) => S.items.find((m) => m.id === id)).filter((m) => m && !m.reconciled);
      if (!list.length) return;
      if (new Set(list.map((m) => m.direction)).size > 1) return toast("Junte só movimentos do mesmo sentido (saídas com saídas, entradas com entradas).", { type: "error" });
      return openReconcile(list.sort((a, b) => a.movementDate.localeCompare(b.movementDate))[0]);
    }
    const mvAdd = t.closest("[data-mv-add]");
    if (mvAdd) return addManual(mvAdd);
    const enc = t.closest("[data-enc-all]");
    if (enc) return concileAllEnc(enc);
    const ar = t.closest("[data-apply-rules]");
    if (ar) return applyRules(ar);
    const at = t.closest("[data-auto-trf]");
    if (at) {
      const ok = await ask("Conciliar todas as transferências internas que já têm a conta de destino indicada? Os pares (saída numa conta, entrada na outra) são ligados automaticamente.", { title: "Conciliar Transferências Internas", ok: "Conciliar" });
      if (ok) autoTransfers(at);
      return;
    }
    if (t.matches("[data-sel-all]")) {
      const vis = filtered().filter((m) => !m.reconciled);
      if (t.checked) vis.forEach((m) => S.selected.add(m.id));
      else vis.forEach((m) => S.selected.delete(m.id));
      renderSelBar();
      return renderTable();
    }
    const tr = t.closest("tr[data-id]");
    if (!tr) return;
    const m = S.items.find((x) => x.id === tr.dataset.id);
    if (!m) return;
    if (t.matches("[data-sel]")) {
      if (t.checked) S.selected.add(m.id);
      else S.selected.delete(m.id);
      tr.classList.toggle("is-selected", t.checked);
      return renderSelBar();
    }
    if (t.closest("[data-type-btn]")) return openTypeMenu(t.closest("[data-type-btn]"), m);
    if (t.closest("[data-conc]")) return openReconcile(m);
    if (t.closest("[data-devlink]")) return openDevlink(m);
    if (t.closest("[data-movcp]")) return openMovCp(m);
    if (t.closest("[data-edit-rp]")) return editRequest(m);
    if (t.closest("[data-undo]")) return undo(m);
  });

  let qTimer = null;
  root.addEventListener("input", (e) => {
    if (!e.target.matches("[data-q]")) return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      S.f.q = e.target.value;
      renderTable();
    }, 120);
  });

  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-month]")) S.f.month = t.value;
    else if (t.matches("[data-type]")) S.f.type = t.value;
    else if (t.matches("[data-only]")) S.f.onlyOpen = t.checked;
    else {
      const tr = t.closest("tr[data-id]");
      const m = tr && S.items.find((x) => x.id === tr.dataset.id);
      if (!m) return;
      if (t.matches("[data-eff]") && t.value && t.value !== m.effectiveDate) patchMovement(m, { effectiveDate: t.value });
      else if (t.matches("[data-note]") && t.value !== (m.note || "")) patchMovement(m, { note: t.value }, { quiet: true });
      else if (t.matches("[data-trf-dest]")) patchMovement(m, { transferCardId: t.value || null });
      else if (t.matches("[data-subtype]")) patchMovement(m, { subtype: t.value || null }, { quiet: true });
      else if (t.matches("[data-card-sel]") && t.value !== m.cardId) {
        patchMovement(m, { cardId: t.value }).then((item) => {
          if (item) {
            toast(`Movimento passado para ${cardName(t.value)}.`, { type: "success" });
            loadMeta().then(renderToolbar);
          }
        });
      }
      return;
    }
    renderAll();
  });

  root.addEventListener("keydown", (e) => {
    if (e.target.matches("[data-note]") && e.key === "Enter") e.target.blur();
    if (e.target.closest("[data-manual]") && e.key === "Enter" && e.target.matches("input")) root.querySelector("[data-mv-add]")?.click();
  });
}
