/**
 * Requisições de Pagamento — janelas partilhadas pelo Centro de Pagamentos (P1)
 * e pela Conciliação Bancária (T2): formulário, detalhe, pagamento efetuado,
 * faturas e ações de estado.
 */
import {
  apiRequest,
  apiUpload,
  toast,
  esc,
  num,
  round2,
  money,
  parseMoney,
  todayKey,
  addDays,
  daysBetween,
  fmtDate,
  norm,
  icon,
  pill,
  openDrawer,
  openDialog,
  ask,
  popMenu,
  bindCombo,
  bindMoney,
  fileZoneHtml,
  bindFileZones,
  errorBox,
  setBusy,
  errMsg,
  fileUrl,
  openFile,
  pickFiles,
} from "./fin.js";
import { can } from "../permissions.js";
import { getSessionUser } from "../../services/auth.js";

export const BASE = "/finance/payment-requests";

export const FLEET_LABELS = {
  COMB: "Combustível",
  MANUT: "Manutenção / reparação",
  PECAS: "Peças e acessórios",
  SEGURO: "Seguro",
  INSPECAO: "Inspeção",
  PORTAGENS: "Portagens / parques",
  ALUGUER: "Aluguer de equipamento",
  OUTRO: "Outro",
};

/** Tipos de pagamento: só PF e TRF INT estão ligados; os outros dependem de módulos por fazer. */
export const PAY_TYPES = [
  { code: "PF", label: "PF — Pagamento a Fornecedor" },
  { code: "TRF INT", label: "TRF INT — Transferência Interna" },
  { code: "SL", label: "SL — Salários", soon: true },
  { code: "AD SL", label: "AD SL — Adiantamento de Salários", soon: true },
  { code: "PE", label: "PE — Pagamento ao Estado", soon: true },
  { code: "EMP", label: "EMP — Empréstimo", soon: true },
  { code: "SC", label: "SC — Sócios", soon: true },
];

const DOC_KIND_LABELS = { FATURA: "Fatura", AF: "Autofaturação", DSC: "Despesa sem Comprovativo" };
const UNITS = ["UN", "KG", "M", "M2", "M3", "L", "CX", "PAR", "VG", "H", "DIA", "MÊS", "SERV", "TON"];

// ─── opções (terceiros, produtos, obras, contas…) ─────────────────────────────

let optionsPromise = null;
export function loadOptions(force = false) {
  if (!optionsPromise || force) {
    optionsPromise = apiRequest(`${BASE}/options`).catch((err) => {
      optionsPromise = null;
      throw err;
    });
  }
  return optionsPromise;
}

export function cardLabel(c) {
  if (!c) return "—";
  return c.label || [c.bank, c.lastDigits ? `•••• ${c.lastDigits}` : null].filter(Boolean).join(" ") || "Conta";
}

export function ccLabel(code, opts) {
  if (!code) return "—";
  if (code === "CC-SEDE") return "Sede";
  if (code === "CC-FROTA") return "Frota";
  const cc = opts?.costCenters?.find((c) => c.code === code);
  if (cc?.type === "OBRA") return code.replace(/^CC-/, "");
  return cc?.name || code.replace(/^CC-/, "");
}

/** N.º de conta a partir do IBAN angolano (AO06 BBBB AAAA CCCCCCCCCCC KK). */
export function accountFromIban(iban) {
  const s = String(iban || "").replace(/\s+/g, "").toUpperCase();
  if (/^AO\d{23}$/.test(s)) return s.slice(12, 23);
  return null;
}

export function formatIban(iban) {
  return String(iban || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

const me = () => getSessionUser()?.name || getSessionUser()?.email || "—";
const canApprove = () => can("financeiro", "approve");
const canEdit = () => can("financeiro", "edit");

// ─── cálculos (iguais ao servidor) ────────────────────────────────────────────

export function lineBase(i) {
  return num(i.quantity) * num(i.unitPrice) * (1 - num(i.discountPercent) / 100);
}

export function computeTotals(items) {
  let base = 0;
  let vat = 0;
  let wh = 0;
  items.forEach((i) => {
    if (!String(i.description || "").trim()) return;
    const b = lineBase(i);
    base += b;
    vat += (b * num(i.vatPercent)) / 100;
    wh += (b * num(i.withholdingPercent)) / 100;
  });
  return { base: round2(base), vat: round2(vat), wh: round2(wh), total: round2(base + vat - wh) };
}

// ─── pagar a origem (requisições-espelho) ─────────────────────────────────────

const SOURCE_LABELS = {
  PAGAMENTO: "Custo de obra",
  PEDIDO_EXTRA: "Pedido extra",
  PEDIDO_COMPRA: "Encomenda de compra",
  LANCAMENTO: "Lançamento da obra",
  FRETE: "Frete",
  ATM: "Levantamento ATM",
};

export function sourceLabel(pr) {
  return pr.sourceMeta?.sourceLabel || SOURCE_LABELS[pr.sourceType] || pr.sourceType || "";
}

/** Pode registar-se aqui o pagamento de uma requisição-espelho? Devolve null ou o motivo. */
function mirrorBlock(pr) {
  if (!pr.sourceRef) return null;
  const m = pr.sourceMeta || {};
  if (pr.sourceType === "PAGAMENTO" && !m.costCenterId) return "Este custo não tem centro de custo: pague-o no ecrã da obra.";
  if (pr.sourceType === "PEDIDO_EXTRA" && m.status && m.status !== "APROVADO") return "O pedido extra ainda não está aprovado.";
  if (pr.sourceType === "PEDIDO_COMPRA" && m.status && !["APROVADO", "EM_PAGAMENTO"].includes(m.status)) return "A encomenda ainda não está aprovada para pagamento.";
  if (pr.sourceType === "LANCAMENTO" && !pr.projectId) return "O lançamento não tem obra.";
  if (["FRETE", "ATM"].includes(pr.sourceType)) return `Pague no ecrã de origem (${sourceLabel(pr)}).`;
  return null;
}

async function paySource(pr, { amount, date, proof }) {
  if (!pr.sourceRef) return;
  const id = encodeURIComponent(pr.sourceId);
  const noonIso = new Date(`${date}T12:00:00Z`).toISOString();
  if (pr.sourceType === "PAGAMENTO") {
    const fd = new FormData();
    fd.append("status", "CONFIRMADO");
    fd.append("paidAmount", String(round2(num(pr.paidAmount) + amount)));
    fd.append("confirmedAt", noonIso);
    fd.append("paymentMethod", "Transferência bancária");
    if (proof) fd.append("comprovativo", proof);
    await apiUpload(`/cost-centers/${encodeURIComponent(pr.sourceMeta.costCenterId)}/payments/${id}`, fd, "PATCH");
  } else if (pr.sourceType === "PEDIDO_EXTRA") {
    const fd = new FormData();
    fd.append("paidAmount", String(amount));
    if (proof) fd.append("comprovativo", proof);
    await apiUpload(`/extra-requests/${id}/pay`, fd, "POST");
  } else if (pr.sourceType === "PEDIDO_COMPRA") {
    const fd = new FormData();
    fd.append("paidAmount", String(amount));
    if (proof) fd.append("comprovativo", proof);
    await apiUpload(`/purchase-orders/${id}/pay`, fd, "POST");
  } else if (pr.sourceType === "LANCAMENTO") {
    await apiRequest(`/projects/${encodeURIComponent(pr.projectId)}/transactions/${id}/liquidate`, { method: "PATCH", body: { realizedAmount: amount } });
  }
}

// ─── ações de estado ─────────────────────────────────────────────────────────

async function runAction(pr, action, { reason, onDone } = {}) {
  try {
    const { item } = await apiRequest(`${BASE}/${pr.id}/action`, { method: "POST", body: { action, reason: reason ?? null } });
    const msg = {
      approve: `${pr.number} aprovada — passa a Em aberto.`,
      reject: `${pr.number} rejeitada.`,
      pause: `${pr.number} em pausa.`,
      resume: `${pr.number} retomada.`,
      transit: `${pr.number} em trânsito bancário.`,
      untransit: `${pr.number} saiu de «em trânsito».`,
      quoted: `${pr.number} submetida para aprovação.`,
    }[action];
    toast(msg, { type: "success" });
    onDone?.(item);
    return item;
  } catch (err) {
    toast(errMsg(err), { type: "error" });
    return null;
  }
}

/** Itens do menu ▾ do estado, conforme a fase da requisição. */
export function stateMenuItems(pr, { onDone, onOpen } = {}) {
  const items = [];
  const st = pr.status;
  const edit = canEdit();
  if (st === "Em cotação") {
    items.push({ icon: "request_quote", label: "Cotação concluída", hint: "Passa a Por aprovar", tone: "info", disabled: !edit, onClick: () => runAction(pr, "quoted", { onDone }) });
    items.push({ icon: "edit", label: "Editar a requisição", hint: "Completar terceiro e valores da cotação", disabled: !edit || !!pr.sourceRef, onClick: () => openRequestForm({ item: pr, onSaved: onDone }) });
  } else if (st === "Por aprovar") {
    items.push({ icon: "check_circle", label: "Aprovar", hint: "Passa a Em aberto", tone: "good", disabled: !canApprove(), onClick: () => runAction(pr, "approve", { onDone }) });
    items.push({
      icon: "cancel",
      label: "Rejeitar",
      hint: "Pede o motivo",
      tone: "bad",
      disabled: !canApprove(),
      onClick: async () => {
        const reason = await ask(`Porque rejeita a ${pr.number}?`, { title: "Rejeitar requisição", ok: "Rejeitar", danger: true, input: true, required: true, placeholder: "Motivo da rejeição (fica no histórico)" });
        if (reason) runAction(pr, "reject", { reason, onDone });
      },
    });
  } else if (st === "Rejeitado") {
    items.push({ icon: "edit", label: "Corrigir e submeter de novo", hint: pr.stateReason ? `Motivo: ${pr.stateReason}` : "", disabled: !edit || !!pr.sourceRef, onClick: () => openRequestForm({ item: pr, onSaved: onDone }) });
  } else if (st === "Em pausa") {
    items.push({ icon: "play_circle", label: "Retomar", hint: pr.stateReason ? `Em pausa: ${pr.stateReason}` : "Volta ao estado anterior", tone: "good", disabled: !canApprove(), onClick: () => runAction(pr, "resume", { onDone }) });
  } else if (st !== "Pago") {
    const block = mirrorBlock(pr);
    if (st === "Em trânsito") {
      items.push({ icon: "undo", label: "Retirar de «em trânsito»", hint: "O pagamento não chegou a sair", disabled: !edit, onClick: () => runAction(pr, "untransit", { onDone }) });
    } else {
      items.push({ icon: "sync_alt", label: "Em trânsito bancário", hint: "Pago no banco, à espera da aprovação do superior", tone: "info", disabled: !edit, onClick: () => runAction(pr, "transit", { onDone }) });
    }
    items.push({ icon: "task_alt", label: "Pagamento efetuado", hint: block || `Em falta ${money(pr.openAmount)} ${pr.currency}`, tone: "good", disabled: !edit || !!block, onClick: () => openPayDialog(pr, { onDone }) });
    items.push({ icon: "clock_loader_40", label: "Pagamento parcial", hint: block || "Regista só uma parte", tone: "warn", disabled: !edit || !!block, onClick: () => openPayDialog(pr, { partial: true, onDone }) });
    items.push({
      icon: "pause_circle",
      label: "Pôr em pausa",
      disabled: !edit,
      onClick: async () => {
        const reason = await ask(`Pôr a ${pr.number} em pausa?`, { title: "Pôr em pausa", ok: "Pôr em pausa", input: true, placeholder: "Motivo (opcional)" });
        if (reason !== null) runAction(pr, "pause", { reason, onDone });
      },
    });
  }
  if (onOpen) {
    items.push("sep");
    items.push({ icon: "open_in_new", label: "Ver detalhe", onClick: onOpen });
  }
  return items;
}

export function openStateMenu(anchor, pr, opts) {
  popMenu(anchor, stateMenuItems(pr, opts), { title: `${pr.number} · ${pr.status}`, width: 300 });
}

// ─── pagamento efetuado ──────────────────────────────────────────────────────

function payFormHtml(pr, opts, { partial = false } = {}) {
  const open = num(pr.openAmount);
  let suggested = open;
  if (partial && pr.condition === "PARCIAL" && pr.installments?.length) {
    let acc = 0;
    for (const p of pr.installments) {
      acc += p.amount;
      if (acc > num(pr.paidAmount) + 0.5) {
        suggested = Math.min(open, round2(acc - num(pr.paidAmount)));
        break;
      }
    }
  }
  const cards = opts?.cards || [];
  return `
    <div class="fo-grid">
      <label class="fo-field fo-col-6"><span class="fo-label">Data do pagamento <i class="fo-req">*</i></span>
        <input type="date" class="fo-input" data-p="paidAt" value="${todayKey()}" max="${todayKey()}"></label>
      <label class="fo-field fo-col-6"><span class="fo-label">Valor pago <i class="fo-req">*</i></span>
        <div class="fo-input-group"><input class="fo-input" data-money data-p="amount" value="${partial && suggested === open ? "" : money(suggested)}" placeholder="0,00"><span class="fo-addon">${esc(pr.currency || "AOA")}</span></div>
        ${partial ? `<span class="fo-help">Em falta ${money(open)} ${esc(pr.currency)}.</span>` : ""}</label>
      <label class="fo-field fo-col-6"><span class="fo-label">Conta de saída</span>
        <select class="fo-input" data-p="cardId"><option value="">— escolher —</option>${cards.map((c) => `<option value="${esc(c.id)}">${esc(cardLabel(c))}${c.fund && c.fund !== cardLabel(c) ? ` · ${esc(c.fund)}` : ""}</option>`).join("")}</select></label>
      <label class="fo-field fo-col-6"><span class="fo-label">Referência</span>
        <input class="fo-input" data-p="reference" placeholder="N.º da transferência / cheque"></label>
      <div class="fo-field fo-col-12"><span class="fo-label">Comprovativo de pagamento <span class="fo-faint">(${pr.sourceType === "PAGAMENTO" ? "obrigatório" : "opcional"} · só PDF)</span></span>
        <div data-pay-zone>${fileZoneHtml("proof", { label: "Anexar PDF", accept: ".pdf,application/pdf" })}</div></div>
    </div>
    <div class="fo-note fo-note--muted">${icon("info")}<span>Pode anexar já o comprovativo; se não o tiver agora, é pedido na <b>Conciliação Bancária</b>.</span></div>`;
}

/** Lê, valida e grava o formulário de pagamento. Devolve a requisição atualizada ou null. */
async function submitPay(root, pr, files, btn) {
  const get = (k) => root.querySelector(`[data-p="${k}"]`);
  const paidAt = get("paidAt").value;
  const amount = round2(parseMoney(get("amount").value));
  root.querySelectorAll(".is-invalid").forEach((e) => e.classList.remove("is-invalid"));
  const errs = [];
  if (!paidAt) {
    errs.push("data do pagamento");
    get("paidAt").classList.add("is-invalid");
  }
  if (!(amount > 0)) {
    errs.push("valor pago");
    get("amount").classList.add("is-invalid");
  }
  const proof = files.proof?.[0] || null;
  if (pr.sourceType === "PAGAMENTO" && !proof) errs.push("comprovativo (o custo de obra só fica pago com ele)");
  if (errs.length) {
    toast(`Falta: ${errs.join(", ")}.`, { type: "error" });
    return null;
  }
  if (amount > num(pr.openAmount) + 0.5) {
    const ok = await ask(`O valor (${money(amount)}) é maior do que o que falta pagar (${money(pr.openAmount)}). Registar mesmo assim?`, { title: "Valor acima do em falta", ok: "Registar" });
    if (!ok) return null;
  }
  setBusy(btn, true, "A registar…");
  try {
    await paySource(pr, { amount, date: paidAt, proof });
    const fd = new FormData();
    fd.append("paidAt", paidAt);
    fd.append("amount", String(amount));
    if (get("cardId").value) fd.append("cardId", get("cardId").value);
    if (get("reference").value.trim()) fd.append("reference", get("reference").value.trim());
    if (proof) fd.append("proof", proof);
    const { item } = await apiUpload(`${BASE}/${pr.id}/payments`, fd, "POST");
    toast(`Pagamento de ${money(amount)} ${pr.currency} registado em ${pr.number}.`, { type: "success" });
    return item;
  } catch (err) {
    toast(errMsg(err, "Não foi possível registar o pagamento."), { type: "error" });
    setBusy(btn, false);
    return null;
  }
}

export async function openPayDialog(pr, { partial = false, onDone } = {}) {
  const opts = await loadOptions().catch(() => ({ cards: [] }));
  const files = { proof: [] };
  const dlg = openDialog({
    title: `${esc(pr.number)} · ${partial ? "Pagamento parcial" : "Pagamento efetuado"}`,
    width: 560,
    contentHtml: `<p class="fo-muted" style="margin:-.35rem 0 0;font-size:13px">${esc(pr.supplierName || "—")} · em falta <b class="fo-num" style="color:var(--fo-ink)">${money(pr.openAmount)} ${esc(pr.currency)}</b></p>${payFormHtml(pr, opts, { partial })}`,
    actions: `<button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--brand" data-go>${icon("task_alt")}Confirmar pagamento</button>`,
  });
  const body = dlg.el;
  bindMoney(body);
  const zone = body.querySelector("[data-pay-zone]");
  const refreshZone = () => {
    zone.innerHTML = fileZoneHtml("proof", { label: "Anexar PDF", accept: ".pdf,application/pdf", files: files.proof });
    bindFileZones(zone, files, refreshZone);
  };
  bindFileZones(zone, files, refreshZone);
  setTimeout(() => body.querySelector('[data-p="amount"]').focus(), 40);
  body.querySelector("[data-go]").addEventListener("click", async (e) => {
    const item = await submitPay(body, pr, files, e.currentTarget);
    if (item) {
      dlg.close();
      onDone?.(item);
    }
  });
}

// ─── faturas (FT / AF / DSC) ─────────────────────────────────────────────────

/**
 * Editor de linhas de faturas. Usado no modal «Faturas» e na conciliação.
 * Devolve { el, rows, validate(), save(requestId), hasRows() }.
 */
export function invoiceRowsEditor({ supplierName = "", startEmpty = false } = {}) {
  const el = document.createElement("div");
  const rows = startEmpty ? [] : [newInvRow(supplierName)];
  const files = {};
  function newInvRow(sup) {
    return { key: Math.random().toString(36).slice(2), kind: "FATURA", number: "", supplierName: sup || "", docDate: todayKey(), amount: "" };
  }
  const render = () => {
    el.innerHTML = rows.length
      ? `<div class="fo-edit-scroll"><table class="fo-edit-table"><thead><tr><th>Documento <i class="fo-req">*</i></th><th>N.º <i class="fo-req">*</i></th><th>Fornecedor</th><th>Data</th><th class="ta-r">Valor c/ IVA</th><th>Ficheiro <i class="fo-req">*</i></th><th></th></tr></thead><tbody>${rows
          .map((r, i) => {
            const f = files[r.key]?.[0];
            return `<tr data-r="${i}">
              <td style="min-width:170px"><select class="fo-input" data-k="kind">${Object.entries(DOC_KIND_LABELS).map(([k, l]) => `<option value="${k}" ${r.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
              <td style="min-width:120px"><input class="fo-input" data-k="number" value="${esc(r.number)}" placeholder="${r.kind === "DSC" ? "opcional" : "FT 2026/123"}"></td>
              <td style="min-width:150px"><input class="fo-input" data-k="supplierName" value="${esc(r.supplierName)}"></td>
              <td><input type="date" class="fo-input" data-k="docDate" value="${esc(r.docDate)}"></td>
              <td style="min-width:120px"><input class="fo-input" data-money data-k="amount" value="${r.amount === "" ? "" : money(r.amount)}" placeholder="0,00"></td>
              <td style="min-width:150px">${
                r.kind === "DSC"
                  ? `<span class="fo-faint" style="font-size:12px">sem ficheiro</span>`
                  : f
                    ? `<span class="fo-doclink">${icon("picture_as_pdf")}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span><button type="button" class="fo-icon-btn fo-icon-btn--sm" data-unfile title="Retirar">${icon("close")}</button></span>`
                    : `<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-file>${icon("attach_file")}Anexar</button>`
              }</td>
              <td><button type="button" class="fo-icon-btn fo-icon-btn--sm" data-del title="Retirar linha">${icon("close")}</button></td>
            </tr>`;
          })
          .join("")}</tbody></table></div>`
      : "";
    el.insertAdjacentHTML("beforeend", `<div class="fo-add-row"><button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-add>${icon("add")}${rows.length ? "Outro documento" : "Adicionar fatura"}</button></div>`);
    bindMoney(el);
  };
  el.addEventListener("input", (e) => {
    const tr = e.target.closest("[data-r]");
    if (!tr) return;
    const r = rows[Number(tr.dataset.r)];
    const k = e.target.dataset.k;
    if (!k) return;
    r[k] = k === "amount" ? parseMoney(e.target.value) : e.target.value;
    e.target.classList.remove("is-invalid");
    el.dispatchEvent(new CustomEvent("rows-change"));
  });
  el.addEventListener("change", (e) => {
    if (e.target.dataset.k === "kind") render();
  });
  el.addEventListener("click", async (e) => {
    const tr = e.target.closest("[data-r]");
    if (e.target.closest("[data-add]")) {
      rows.push(newInvRow(supplierName));
      render();
      el.dispatchEvent(new CustomEvent("rows-change"));
      return;
    }
    if (!tr) return;
    const r = rows[Number(tr.dataset.r)];
    if (e.target.closest("[data-del]")) {
      rows.splice(Number(tr.dataset.r), 1);
      delete files[r.key];
      render();
      el.dispatchEvent(new CustomEvent("rows-change"));
    } else if (e.target.closest("[data-unfile]")) {
      delete files[r.key];
      render();
    } else if (e.target.closest("[data-file]")) {
      const picked = await pickFiles({ accept: ".pdf,image/*" });
      if (picked.length) {
        files[r.key] = picked;
        render();
      }
    }
  });
  render();
  const filled = () => rows.filter((r) => r.number || r.amount || files[r.key]?.length || r.kind === "DSC");
  return {
    el,
    rows,
    hasRows: () => filled().length > 0,
    sum: () => round2(filled().reduce((a, r) => a + num(r.amount), 0)),
    validate() {
      const errs = [];
      filled().forEach((r, i) => {
        const tr = el.querySelector(`[data-r="${rows.indexOf(r)}"]`);
        if (r.kind !== "DSC" && !String(r.number).trim()) {
          errs.push(`n.º do documento (linha ${i + 1})`);
          tr?.querySelector('[data-k="number"]')?.classList.add("is-invalid");
        }
        if (r.kind !== "DSC" && !files[r.key]?.length) errs.push(`ficheiro da ${DOC_KIND_LABELS[r.kind].toLowerCase()} (linha ${i + 1})`);
      });
      return errs;
    },
    async save(requestId) {
      let last = null;
      for (const r of filled()) {
        const fd = new FormData();
        fd.append("kind", r.kind);
        if (r.number) fd.append("number", r.number.trim());
        if (r.supplierName) fd.append("supplierName", r.supplierName.trim());
        if (r.docDate) fd.append("docDate", r.docDate);
        if (r.amount !== "" && r.amount !== null) fd.append("amount", String(num(r.amount)));
        if (files[r.key]?.[0]) fd.append("file", files[r.key][0]);
        last = (await apiUpload(`${BASE}/${requestId}/documents`, fd, "POST")).item;
      }
      return last;
    },
  };
}

export async function openInvoicesDialog(pr, { onDone } = {}) {
  const existing = (pr.documents || []).filter((d) => ["FATURA", "AF", "DSC"].includes(d.kind));
  const editor = invoiceRowsEditor({ supplierName: pr.supplierName || "", startEmpty: existing.length > 0 });
  const dlg = openDialog({
    title: `Faturas · ${esc(pr.number)}`,
    width: 980,
    contentHtml: `
      <div class="fo-note fo-note--muted">${icon("info")}<span>Pode haver mais do que uma fatura para o mesmo pagamento. O tipo e o n.º do documento são obrigatórios.</span></div>
      ${
        existing.length
          ? `<table class="fo-mini-table"><thead><tr><th>Documento</th><th>N.º</th><th>Fornecedor</th><th>Data</th><th class="ta-r">Valor c/ IVA</th><th>Ficheiro</th><th></th></tr></thead><tbody>${existing
              .map(
                (d) => `<tr><td>${esc(DOC_KIND_LABELS[d.kind] || d.kind)}</td><td><b>${esc(d.number || "—")}</b></td><td>${esc(d.supplierName || "—")}</td><td>${fmtDate(d.docDate)}</td><td class="ta-r fo-num">${d.amount === null ? "—" : money(d.amount)}</td>
              <td>${d.path ? `<a class="fo-link" href="${esc(fileUrl(d.path))}" target="_blank" rel="noopener">${icon("picture_as_pdf")} abrir</a>` : '<span class="fo-faint">—</span>'}</td>
              <td class="ta-r"><button type="button" class="fo-icon-btn fo-icon-btn--sm" data-rm-doc="${esc(d.id)}" title="Remover">${icon("delete")}</button></td></tr>`
              )
              .join("")}</tbody></table>`
          : ""
      }
      <div data-editor></div>
      <div class="fo-totals" style="width:100%;max-width:none"><div><span>Soma das faturas</span><b data-sum></b></div></div>`,
    actions: `<button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--primary" data-go>${icon("save")}Gravar faturas</button>`,
  });
  dlg.el.querySelector("[data-editor]").appendChild(editor.el);
  const existingSum = existing.reduce((a, d) => a + num(d.amount), 0);
  const updSum = () => {
    const s = round2(existingSum + editor.sum());
    const ok = Math.abs(s - num(pr.totalAmount)) < 0.5;
    dlg.el.querySelector("[data-sum]").innerHTML = `<span class="${ok ? "fo-sum-ok" : ""}">${money(s)}</span> <span class="fo-muted" style="font-weight:500">de ${money(pr.totalAmount)} do pedido ${ok ? "✓" : ""}</span>`;
  };
  updSum();
  editor.el.addEventListener("rows-change", updSum);
  let changed = false;
  dlg.el.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-rm-doc]");
    if (rm) {
      const ok = await ask("Remover este documento da requisição?", { title: "Remover documento", ok: "Remover", danger: true });
      if (!ok) return;
      try {
        const { item } = await apiRequest(`${BASE}/${pr.id}/documents/${rm.dataset.rmDoc}`, { method: "DELETE" });
        toast("Documento removido.", { type: "success" });
        dlg.close();
        onDone?.(item);
        openInvoicesDialog(item, { onDone });
      } catch (err) {
        toast(errMsg(err), { type: "error" });
      }
    }
  });
  dlg.el.querySelector("[data-go]").addEventListener("click", async (e) => {
    if (!editor.hasRows()) {
      dlg.close();
      return;
    }
    const errs = editor.validate();
    if (errs.length) return toast(`Falta: ${errs.join(", ")}.`, { type: "error" });
    setBusy(e.currentTarget, true);
    try {
      const item = await editor.save(pr.id);
      changed = true;
      toast("Faturas gravadas.", { type: "success" });
      dlg.close();
      onDone?.(item);
    } catch (err) {
      setBusy(e.currentTarget, false);
      toast(errMsg(err), { type: "error" });
    }
  });
  return changed;
}

/** Carrega um documento solto (proforma, comprovativo…) para a requisição. */
export async function uploadRequestDoc(pr, kind, { accept = ".pdf,image/*", onDone } = {}) {
  const [file] = await pickFiles({ accept });
  if (!file) return;
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file);
  try {
    const { item } = await apiUpload(`${BASE}/${pr.id}/documents`, fd, "POST");
    toast(`${kind === "PROFORMA" ? "Proforma" : "Documento"} anexad${kind === "PROFORMA" ? "a" : "o"}.`, { type: "success" });
    onDone?.(item);
  } catch (err) {
    toast(errMsg(err), { type: "error" });
  }
}

// ─── formulário (nova / editar / registar a partir do banco) ──────────────────

function emptyItem(defaults = {}) {
  return { productId: null, code: "", description: "", unit: "UN", quantity: 1, unitPrice: 0, vatPercent: 14, withholdingPercent: 0, discountPercent: 0, notes: "", supplierId: null, supplierName: "", showNote: false, ...defaults };
}

function stateFromItem(pr) {
  const splits = pr.splits?.length
    ? pr.splits.map((s) => ({ costCenterCode: s.costCenterCode, projectId: s.projectId, label: s.label, percent: s.percent }))
    : [{ costCenterCode: pr.costCenterCode || (pr.kind === "FROTA" ? "CC-FROTA" : "CC-SEDE"), projectId: pr.projectId, percent: 100 }];
  return {
    id: pr.id,
    number: pr.number,
    tab: pr.kind === "FROTA" ? "FROTA" : "GERAL",
    requestDate: pr.requestDate || todayKey(),
    mode: pr.mode || "FORN",
    requiresQuote: pr.requiresQuote,
    currency: pr.currency || "AOA",
    supplierId: pr.supplierId,
    supplierName: pr.supplierName || "",
    supplierNif: pr.supplierNif || "",
    supplierIban: pr.supplierIban || "",
    supplierBank: pr.supplierBank || "",
    supplierEmail: pr.supplierEmail || "",
    fundCardId: pr.fundCardId || "",
    vehicle: pr.vehicle || "",
    fleetNature: pr.fleetNature || "",
    mileage: pr.mileage ?? "",
    items: pr.items?.length ? pr.items.map((i) => emptyItem({ ...i, showNote: Boolean(i.notes) })) : [emptyItem()],
    showRf: (pr.items || []).some((i) => num(i.withholdingPercent) || num(i.discountPercent)),
    notes: pr.notes || "",
    splits,
    condition: pr.condition || "PRONTO",
    dueDate: pr.dueDate || "",
    creditDays: pr.creditDays ?? "",
    installments: (pr.installments || []).map((p) => ({ dueDate: p.dueDate, amount: p.amount })),
    noInvoice: Boolean(pr.noInvoice),
    files: { docs: [] },
  };
}

/**
 * Abre o formulário da requisição.
 *  - `item`: editar uma requisição existente
 *  - `fromMovements`: [{id, amount, movementDate, description, cardLabel}] — registar já paga e conciliada
 *  - `prefill`: valores iniciais
 */
export async function openRequestForm({ item = null, fromMovements = null, prefill = {}, focus = null, onSaved } = {}) {
  if (item?.sourceRef) {
    toast(`Esta requisição vem de ${sourceLabel(item)}: altere-a na origem.`, { type: "error" });
    return;
  }
  let opts;
  try {
    opts = await loadOptions();
  } catch (err) {
    toast(errMsg(err, "Não foi possível carregar os terceiros e as obras."), { type: "error" });
    return;
  }
  const fromBank = Array.isArray(fromMovements) && fromMovements.length > 0;
  const bankTotal = fromBank ? round2(fromMovements.reduce((a, m) => a + num(m.amount), 0)) : 0;
  const f = item
    ? stateFromItem(item)
    : {
        ...stateFromItem({ kind: "GERAL", mode: "FORN", requiresQuote: null, items: [], splits: [], condition: "PRONTO" }),
        id: null,
        requiresQuote: fromBank ? false : null,
        ...prefill,
      };
  if (fromBank && !prefill.items) {
    f.items = [emptyItem({ description: fromMovements[0].description || "", unitPrice: bankTotal, vatPercent: 0 })];
    f.requestDate = fromMovements[0].movementDate || todayKey();
    f.dueDate = f.requestDate;
  }
  f.proof = [];
  let dirty = false;
  let triedSubmit = false;

  const mode = item ? "edit" : fromBank ? "bank" : "new";
  const title = mode === "edit" ? `Editar ${esc(item.number)}` : "Requisição de Pagamento";
  const subtitle =
    mode === "edit"
      ? `${esc(item.kindLabel || "")} · pedido por ${esc(item.requestedBy || "—")} em ${fmtDate(item.requestDate)}`
      : `N.º <b>RP${todayKey().slice(2, 4)}-····</b> (atribuído ao submeter) · pedido por <b>${esc(me())}</b>`;
  const drawer = openDrawer({
    kicker: mode === "bank" ? "Registar o pagamento e conciliar" : mode === "edit" ? "Requisição de pagamento" : "Nova requisição de pagamento",
    title,
    subtitle,
    width: 1120,
    onClose: async () => (dirty ? ask("Há alterações por gravar. Fechar e perder as alterações?", { title: "Fechar o formulário", ok: "Fechar sem gravar", danger: true }) : true),
  });
  const body = drawer.body;

  const totals = () => computeTotals(f.items);
  const ccOptions = () =>
    (opts.costCenters || []).map((c) => ({ value: c.code, label: c.code === "CC-SEDE" ? "Sede (custos gerais)" : c.code === "CC-FROTA" ? "Frota e equipamentos" : c.name, projectId: c.projectId || null, type: c.type }));
  const fundCards = opts.cards || [];

  // ── secções ──
  const secHead = (n, t, extra = "") => `<div class="fo-section-head"><h3 class="fo-section-title"><span class="fo-step">${n}</span>${t}</h3>${extra}</div>`;

  function tabsHtml() {
    return `<div class="fo-section" style="padding:.6rem .9rem">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
        <div class="fo-seg">
          <button type="button" data-tab="GERAL" class="${f.tab === "GERAL" ? "is-on" : ""}">${icon("apartment")}Geral / Obra</button>
          <button type="button" data-tab="FROTA" class="${f.tab === "FROTA" ? "is-on" : ""}">${icon("local_shipping")}Frota e Equipamentos</button>
          <button type="button" disabled title="Depende do módulo de empréstimos">${icon("account_balance")}Empréstimo <span class="fo-soon">em preparação</span></button>
        </div>
        <label class="fo-field" style="flex-direction:row;align-items:center;gap:.5rem"><span class="fo-label" style="white-space:nowrap">Data do pedido</span><input type="date" class="fo-input fo-input--sm" data-f="requestDate" value="${esc(f.requestDate)}" style="width:150px" ${fromBank ? "disabled" : ""}></label>
      </div>
    </div>`;
  }

  function dadosHtml() {
    const fm = f.mode === "FM";
    const typeChoice = (code, ic, label, sub) =>
      `<button type="button" class="fo-choice ${f.mode === code ? "is-on" : ""}" data-mode="${code}">${icon(ic)}<span><b>${label}</b><small>${sub}</small></span></button>`;
    const quoteSeg = fromBank
      ? ""
      : `<div class="fo-field fo-col-4"><span class="fo-label">Requer cotação? <i class="fo-req">*</i></span>
          <div class="fo-seg fo-seg--full" data-quote-seg>
            <button type="button" data-quote="0" class="${f.requiresQuote === false ? "is-on" : ""}" ${mode === "edit" ? "disabled" : ""}>Não</button>
            <button type="button" data-quote="1" class="${f.requiresQuote === true ? "is-on" : ""}" ${mode === "edit" ? "disabled" : ""}>Sim — enviar às Compras</button>
          </div></div>`;
    return `<section class="fo-section" data-sec="dados">
      ${secHead(1, "Dados da Requisição")}
      <div class="fo-grid">
        <div class="fo-field fo-col-12"><span class="fo-label">Tipo de pagamento</span>
          <div class="fo-choices">
            ${typeChoice("FORN", "storefront", "PF — Pagamento a Fornecedor", "Paga-se a um terceiro por transferência")}
            ${typeChoice("FM", "swap_horiz", "TRF INT — Fundo de Maneio", "Transferência para um cartão / conta da empresa")}
          </div>
          <span class="fo-help">${PAY_TYPES.filter((t) => t.soon).map((t) => `<span class="fo-tag" style="margin-right:4px;opacity:.7" title="Depende de um módulo em preparação">${esc(t.code)}</span>`).join("")} em preparação</span>
        </div>
        ${quoteSeg}
        <label class="fo-field fo-col-2"><span class="fo-label">Moeda</span>
          <select class="fo-input" data-f="currency">${["AOA", "USD", "EUR"].map((c) => `<option ${f.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        ${
          fm
            ? `<label class="fo-field fo-col-6"><span class="fo-label">Conta do fundo de maneio <i class="fo-req">*</i></span>
                <select class="fo-input" data-f="fundCardId" data-req="fundCardId"><option value="">— escolher —</option>${fundCards.map((c) => `<option value="${esc(c.id)}" ${f.fundCardId === c.id ? "selected" : ""}>${esc(cardLabel(c))}${c.holder ? ` · ${esc(c.holder)}` : ""}${c.fund && c.fund !== cardLabel(c) ? ` · ${esc(c.fund)}` : ""}</option>`).join("")}</select>
                <span class="fo-help">${fundCards.length ? "Cartão / conta que recebe a transferência." : "Ainda não há contas: crie-a em Tesouraria › Contas e saldos."}</span></label>
              <div class="fo-col-12"><div class="fo-note">${icon("credit_card")}<span>Sem IBAN — paga-se com o cartão. Feita a transferência, cada item passa a pagamento a fornecedor já pago.</span></div></div>`
            : `<div class="fo-field fo-col-6"><span class="fo-label">Terceiro ${f.requiresQuote === true ? '<span class="fo-faint">(opcional em cotação)</span>' : '<i class="fo-req">*</i>'}</span>
                <input class="fo-input" data-f="supplierName" data-req="supplierName" data-combo="supplier" value="${esc(f.supplierName)}" placeholder="Pesquisar na base de terceiros…">
                <span class="fo-help" data-supplier-hint>${f.supplierName && !f.supplierId ? `${icon("person_add")} Terceiro novo — fica criado ao submeter.` : ""}</span></div>
              <label class="fo-field fo-col-3"><span class="fo-label">NIF</span><input class="fo-input" data-f="supplierNif" value="${esc(f.supplierNif)}"></label>
              <label class="fo-field fo-col-3"><span class="fo-label">Banco do terceiro</span><input class="fo-input" data-f="supplierBank" value="${esc(f.supplierBank)}"></label>
              <label class="fo-field fo-col-6"><span class="fo-label">IBAN do terceiro</span><input class="fo-input fo-mono" data-f="supplierIban" value="${esc(formatIban(f.supplierIban))}" placeholder="AO06 …"></label>`
        }
        ${
          f.tab === "FROTA"
            ? `<label class="fo-field fo-col-5"><span class="fo-label">Viatura / equipamento <i class="fo-req">*</i></span><input class="fo-input" data-f="vehicle" data-req="vehicle" value="${esc(f.vehicle)}" placeholder="Matrícula ou código do equipamento"></label>
               <label class="fo-field fo-col-4"><span class="fo-label">Natureza do custo de frota <i class="fo-req">*</i></span><select class="fo-input" data-f="fleetNature" data-req="fleetNature"><option value="">— escolher —</option>${(opts.fleetNatures || Object.keys(FLEET_LABELS)).map((k) => `<option value="${k}" ${f.fleetNature === k ? "selected" : ""}>${esc(FLEET_LABELS[k] || k)}</option>`).join("")}</select></label>
               <label class="fo-field fo-col-3"><span class="fo-label">Km / horas</span><input class="fo-input is-num" data-f="mileage" value="${esc(f.mileage)}" inputmode="decimal"></label>`
            : ""
        }
      </div>
    </section>`;
  }

  function itemsHtml() {
    const fm = f.mode === "FM";
    const rf = f.showRf;
    const t = totals();
    const rows = f.items
      .map(
        (it, i) => `<tr data-it="${i}">
        <td style="width:90px"><input class="fo-input" data-k="code" value="${esc(it.code || "")}" placeholder="—"></td>
        <td style="min-width:240px"><input class="fo-input" data-k="description" data-req-item="${i}" data-combo="product" value="${esc(it.description)}" placeholder="Pesquisar produto / serviço…"></td>
        ${fm ? `<td style="min-width:180px"><input class="fo-input" data-k="supplierName" data-combo="itemSupplier" value="${esc(it.supplierName || "")}" placeholder="Fornecedor *"></td>` : ""}
        <td style="width:74px"><input class="fo-input" data-k="unit" list="foUnits" value="${esc(it.unit || "UN")}"></td>
        <td style="width:74px"><input class="fo-input is-num" data-k="quantity" data-dec value="${esc(String(it.quantity).replace(".", ","))}"></td>
        <td style="width:130px"><input class="fo-input" data-money data-k="unitPrice" value="${it.unitPrice ? money(it.unitPrice) : ""}" placeholder="0,00"></td>
        <td style="width:66px"><input class="fo-input is-num" data-k="vatPercent" data-dec value="${esc(String(it.vatPercent).replace(".", ","))}"></td>
        ${rf ? `<td style="width:66px"><input class="fo-input is-num" data-k="withholdingPercent" data-dec value="${esc(String(it.withholdingPercent).replace(".", ","))}"></td><td style="width:66px"><input class="fo-input is-num" data-k="discountPercent" data-dec value="${esc(String(it.discountPercent).replace(".", ","))}"></td>` : ""}
        <td class="fo-cell-total" data-line="${i}">${money(lineBase(it))}</td>
        <td style="width:64px;white-space:nowrap"><button type="button" class="fo-icon-btn fo-icon-btn--sm" data-note title="Observação do item" style="${it.notes ? "color:var(--fo-brand)" : ""}">${icon("edit_note")}</button><button type="button" class="fo-icon-btn fo-icon-btn--sm" data-rm-item title="Retirar item" ${f.items.length === 1 ? "disabled" : ""}>${icon("close")}</button></td>
      </tr>${it.showNote ? `<tr class="fo-row-note" data-it="${i}"><td></td><td colspan="${(fm ? 8 : 7) + (rf ? 2 : 0)}"><input class="fo-input" data-k="notes" value="${esc(it.notes || "")}" placeholder="Observação do item (aparece no detalhe)"></td></tr>` : ""}`
      )
      .join("");
    return `<section class="fo-section" data-sec="items">
      ${secHead(2, "Itens a Requisitar", `<label class="fo-check ${rf ? "is-on" : ""}" style="height:32px"><input type="checkbox" data-toggle-rf ${rf ? "checked" : ""}>mostrar RF e desconto</label>`)}
      <div class="fo-edit-scroll"><table class="fo-edit-table">
        <thead><tr><th>Código</th><th>Descrição <i class="fo-req">*</i></th>${fm ? "<th>Fornecedor <i class='fo-req'>*</i></th>" : ""}<th>Un.</th><th class="ta-r">Qtd.</th><th class="ta-r">V. unit.</th><th class="ta-r">IVA %</th>${rf ? '<th class="ta-r">RF %</th><th class="ta-r">Desc. %</th>' : ""}<th class="ta-r">Total s/ IVA</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <datalist id="foUnits">${UNITS.map((u) => `<option value="${u}">`).join("")}</datalist>
      <div class="fo-add-row">
        <button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-add-item>${icon("add")}Adicionar item</button>
        <button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-new-product>${icon("inventory_2")}Criar produto / serviço</button>
      </div>
      <div class="fo-grid" style="margin-top:1rem;align-items:start">
        <label class="fo-field fo-col-6"><span class="fo-label">Observações do pedido</span><textarea class="fo-input" rows="4" data-f="notes" placeholder="Contexto para quem aprova e para quem paga…">${esc(f.notes)}</textarea></label>
        <div class="fo-col-6">
          <div class="fo-totals" data-totals>${totalsInner(t)}</div>
          <p class="fo-help" style="text-align:right;margin:.4rem 0 0">IVA e RF vêm do produto / fornecedor e podem ser alterados.</p>
        </div>
      </div>
    </section>`;
  }

  function totalsInner(t) {
    return `<div><span>Total s/ IVA</span><b>${money(t.base)}</b></div><div><span>IVA</span><b>${money(t.vat)}</b></div>${t.wh ? `<div class="is-neg"><span>Retenção na fonte</span><b>− ${money(t.wh)}</b></div>` : ""}<div class="is-big"><span>Total a pagar</span><b>${money(t.total)} <small style="font-size:.6em;color:var(--fo-faint)">${esc(f.currency)}</small></b></div>${fromBank ? `<div><span>Valor do banco</span><b class="${Math.abs(t.total - bankTotal) < 0.5 ? "fo-green" : "fo-amber"}">${money(bankTotal)}</b></div>` : ""}`;
  }

  function ccHtml() {
    const t = totals();
    const sum = round2(f.splits.reduce((a, s) => a + num(s.percent), 0));
    const ok = Math.abs(sum - 100) < 0.01;
    const options = ccOptions();
    return `<section class="fo-section" data-sec="cc">
      ${secHead(3, "Centros de Custo", `<span class="fo-help">${f.splits.length > 1 ? "Repartição do custo" : "Onde fica o custo — escolha a obra para o associar"}</span>`)}
      <table class="fo-edit-table" style="max-width:760px">
        <thead><tr><th>Centro de custo</th><th class="ta-r">%</th><th class="ta-r">Valor</th><th></th></tr></thead>
        <tbody>${f.splits
          .map(
            (s, i) => `<tr data-sp="${i}">
            <td style="min-width:300px"><select class="fo-input" data-k="costCenterCode">${["SEDE", "FROTA", "OUTRO", "OBRA"]
              .map((type) => {
                const group = options.filter((o) => o.type === type);
                if (!group.length) return "";
                const lbl = { SEDE: "Estrutura", FROTA: "Frota", OUTRO: "Centros gerais", OBRA: "Obras" }[type];
                return `<optgroup label="${lbl}">${group.map((o) => `<option value="${esc(o.value)}" ${s.costCenterCode === o.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</optgroup>`;
              })
              .join("")}</select></td>
            <td style="width:100px"><input class="fo-input is-num" data-k="percent" data-dec value="${esc(String(round2(s.percent)).replace(".", ","))}"></td>
            <td style="width:150px"><input class="fo-input" data-money data-k="value" value="${money((t.total * num(s.percent)) / 100)}"></td>
            <td style="width:40px"><button type="button" class="fo-icon-btn fo-icon-btn--sm" data-rm-sp ${f.splits.length === 1 ? "disabled" : ""}>${icon("close")}</button></td>
          </tr>`
          )
          .join("")}</tbody>
        <tfoot><tr><td><button type="button" class="fo-btn fo-btn--soft fo-btn--sm" data-add-sp>${icon("add")}Centro de custo</button></td><td class="ta-r" style="padding-right:.6rem"><span class="${ok ? "fo-sum-ok" : "fo-sum-bad"}" data-sp-sum>${String(sum.toFixed(1)).replace(".", ",")} % ${ok ? "✓" : ""}</span></td><td class="ta-r fo-num" style="padding-right:.6rem;font-weight:700" data-sp-total>${money(t.total)}</td><td></td></tr></tfoot>
      </table>
    </section>`;
  }

  function condHtml() {
    if (fromBank) {
      return `<section class="fo-section" data-sec="cond">${secHead(4, "Pagamento")}
        <div class="fo-note fo-note--good">${icon("verified")}<span>Pago a <b>${fmtDate(fromMovements[0].movementDate)}</b>${fromMovements[0].cardLabel ? ` pela conta <b>${esc(fromMovements[0].cardLabel)}</b>` : ""} · já sai do banco, fica <b>pago e conciliado</b>.</span></div></section>`;
    }
    const c = f.condition;
    const choice = (code, ic, label, sub) => `<button type="button" class="fo-choice ${c === code ? "is-on" : ""}" data-cond="${code}">${icon(ic)}<span><b>${label}</b><small>${sub}</small></span></button>`;
    let detail = "";
    if (c === "PRONTO") {
      detail = `<div class="fo-grid" style="margin-top:.9rem"><label class="fo-field fo-col-4"><span class="fo-label">Data de pagamento pretendida</span><input type="date" class="fo-input" data-f="dueDate" value="${esc(f.dueDate)}"></label></div>`;
    } else if (c === "CREDITO") {
      detail = `<div class="fo-grid" style="margin-top:.9rem">
        <label class="fo-field fo-col-3"><span class="fo-label">Prazo de crédito (dias)</span><input class="fo-input is-num" data-f="creditDays" inputmode="numeric" value="${esc(f.creditDays)}" placeholder="30"></label>
        <label class="fo-field fo-col-4"><span class="fo-label">Data de vencimento do crédito <i class="fo-req">*</i></span><input type="date" class="fo-input" data-f="dueDate" data-req="dueDate" value="${esc(f.dueDate)}"></label></div>`;
    } else {
      const t = totals();
      const sum = round2(f.installments.reduce((a, p) => a + num(p.amount), 0));
      const ok = Math.abs(sum - t.total) < 0.5 && f.installments.length >= 2;
      detail = `<div style="margin-top:.9rem;display:flex;gap:1rem;align-items:flex-end;flex-wrap:wrap">
          <label class="fo-field" style="width:200px"><span class="fo-label">N.º de parcelas acordadas</span><input class="fo-input is-num" data-n-inst inputmode="numeric" value="${f.installments.length || ""}" placeholder="2"></label>
          <button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-split-equal>${icon("calculate")}Repartir em partes iguais</button>
        </div>
        ${
          f.installments.length
            ? `<table class="fo-edit-table" style="max-width:560px;margin-top:.75rem"><thead><tr><th>Parcela</th><th>Data de pagamento <i class="fo-req">*</i></th><th class="ta-r">Valor</th></tr></thead><tbody>${f.installments
                .map((p, i) => `<tr data-in="${i}"><td style="width:80px;font-weight:700">${i + 1}.ª</td><td><input type="date" class="fo-input" data-k="dueDate" value="${esc(p.dueDate || "")}"></td><td style="width:170px"><input class="fo-input" data-money data-k="amount" value="${p.amount ? money(p.amount) : ""}" placeholder="0,00"></td></tr>`)
                .join("")}</tbody><tfoot><tr><td colspan="2" class="ta-r" style="font-size:12px;color:var(--fo-muted);padding-right:.6rem">Total das parcelas</td><td class="ta-r" style="padding-right:.6rem"><span data-in-sum class="${ok ? "fo-sum-ok" : "fo-sum-bad"}">${money(sum)} de ${money(t.total)} ${ok ? "✓" : ""}</span></td></tr></tfoot></table>`
            : ""
        }`;
    }
    return `<section class="fo-section" data-sec="cond">
      ${secHead(4, "Condições de Pagamento")}
      <div class="fo-choices">
        ${choice("PRONTO", "bolt", "Pronto Pagamento", "Paga-se logo que aprovado")}
        ${choice("CREDITO", "event", "Crédito Total", "Paga-se tudo no vencimento")}
        ${choice("PARCIAL", "calendar_view_week", "Crédito em Parcelas", "Datas e valores acordados")}
      </div>
      ${detail}
    </section>`;
  }

  function docsHtml() {
    if (fromBank) {
      return `<section class="fo-section" data-sec="docs">${secHead(5, "Comprovativo")}
        <p class="fo-section-hint">Só o comprovativo de pagamento é obrigatório. A fatura pode juntar-se depois no Centro de Pagamentos.</p>
        <div data-zone-proof>${fileZoneHtml("proof", { label: "Comprovativo de pagamento", required: true, accept: ".pdf,image/*", files: f.proof })}</div></section>`;
    }
    return `<section class="fo-section" data-sec="docs">
      ${secHead(5, "Documentos")}
      <p class="fo-section-hint">Nesta fase anexa-se só a <b>proforma / orçamento</b> do fornecedor (opcional). A fatura e o comprovativo anexam-se depois do pagamento.</p>
      <div data-zone-docs>${fileZoneHtml("docs", { label: "Anexar documentos", multiple: true, accept: ".pdf,image/*", files: f.files.docs })}</div>
      ${
        mode === "edit" && item.docState?.proforma
          ? `<div class="fo-doclink" style="margin-top:.6rem">${icon("description")}<a href="${esc(fileUrl(item.docState.proforma.path))}" target="_blank" rel="noopener">${esc(item.docState.proforma.name || "Proforma")}</a><span class="fo-faint">já anexada</span></div>`
          : ""
      }
    </section>`;
  }

  function renderAll() {
    body.innerHTML = `<div data-errors></div>${tabsHtml()}${dadosHtml()}${itemsHtml()}${ccHtml()}${condHtml()}${docsHtml()}`;
    afterRender();
  }

  function rerender(sec) {
    const map = { dados: dadosHtml, items: itemsHtml, cc: ccHtml, cond: condHtml, docs: docsHtml };
    const old = body.querySelector(`[data-sec="${sec}"]`);
    if (!old) return renderAll();
    const tmp = document.createElement("div");
    tmp.innerHTML = map[sec]();
    old.replaceWith(tmp.firstElementChild);
    afterRender();
  }

  function afterRender() {
    bindMoney(body);
    bindCombos();
    const zDocs = body.querySelector("[data-zone-docs]");
    if (zDocs) bindFileZones(zDocs, f.files, () => rerender("docs"));
    const zProof = body.querySelector("[data-zone-proof]");
    if (zProof) bindFileZones(zProof, f, () => rerender("docs"));
    renderFooter();
    if (triedSubmit) showErrors(validate(), false);
  }

  function bindCombos() {
    body.querySelectorAll('[data-combo="supplier"]:not([data-bound])').forEach((inp) => {
      inp.dataset.bound = "1";
      bindCombo(inp, {
        items: () => (opts.suppliers || []).map((s) => ({ value: s.id, label: s.name, sub: [s.nif ? `NIF ${s.nif}` : null, s.bank].filter(Boolean).join(" · "), data: s })),
        onPick: (it) => {
          const s = it.data;
          Object.assign(f, { supplierId: s.id, supplierName: s.name, supplierNif: s.nif || "", supplierIban: s.iban || "", supplierBank: s.bank || "", supplierEmail: s.email || "" });
          if (s.withholdingPercent || s.vatPercent !== null) {
            f.items.forEach((i) => {
              if (!num(i.unitPrice)) {
                if (s.vatPercent !== null && s.vatPercent !== undefined) i.vatPercent = s.vatPercent;
                if (s.withholdingPercent) i.withholdingPercent = s.withholdingPercent;
              }
            });
            if (s.withholdingPercent) f.showRf = true;
          }
          dirty = true;
          rerender("dados");
          rerender("items");
        },
        onCreate: (text) => {
          Object.assign(f, { supplierId: null, supplierName: text });
          dirty = true;
          rerender("dados");
          body.querySelector('[data-f="supplierNif"]')?.focus();
        },
        createLabel: (t) => `Criar terceiro «${t}»`,
      });
    });
    body.querySelectorAll('[data-combo="product"]:not([data-bound])').forEach((inp) => {
      inp.dataset.bound = "1";
      const idx = Number(inp.closest("[data-it]").dataset.it);
      bindCombo(inp, {
        items: () => (opts.products || []).map((p) => ({ value: p.id, label: p.name, sub: [p.code, p.unit, p.category].filter(Boolean).join(" · "), data: p })),
        onPick: (it) => {
          const p = it.data;
          Object.assign(f.items[idx], { productId: p.id, code: p.code || "", description: p.name, unit: p.unit || f.items[idx].unit });
          dirty = true;
          rerender("items");
          body.querySelector(`[data-it="${idx}"] [data-k="unitPrice"]`)?.focus();
        },
        onCreate: (text) => openNewProduct(idx, text),
        createLabel: (t) => `Criar produto «${t}»`,
      });
    });
    body.querySelectorAll('[data-combo="itemSupplier"]:not([data-bound])').forEach((inp) => {
      inp.dataset.bound = "1";
      const idx = Number(inp.closest("[data-it]").dataset.it);
      bindCombo(inp, {
        items: () => (opts.suppliers || []).map((s) => ({ value: s.id, label: s.name, sub: s.nif ? `NIF ${s.nif}` : "" })),
        onPick: (it) => {
          Object.assign(f.items[idx], { supplierId: it.value, supplierName: it.label });
          inp.value = it.label;
          dirty = true;
        },
      });
    });
  }

  async function openNewProduct(idx = null, name = "") {
    const dlg = openDialog({
      title: "Criar produto / serviço",
      width: 520,
      contentHtml: `<div class="fo-grid">
        <label class="fo-field fo-col-12"><span class="fo-label">Nome <i class="fo-req">*</i></span><input class="fo-input" data-np="name" value="${esc(name)}"></label>
        <label class="fo-field fo-col-6"><span class="fo-label">Código</span><input class="fo-input" data-np="sku" placeholder="opcional"></label>
        <label class="fo-field fo-col-3"><span class="fo-label">Unidade</span><select class="fo-input" data-np="unit">${["UN", "KG", "M", "L", "CX", "PAR", "MT2", "MT3"].map((u) => `<option>${u}</option>`).join("")}</select></label>
        <label class="fo-field fo-col-3"><span class="fo-label">Categoria</span><select class="fo-input" data-np="category"><option value="MATERIAL">Material</option><option value="CONSUMABLE">Consumível</option><option value="EQUIPMENT">Equipamento</option><option value="TOOL">Ferramenta</option></select></label>
      </div><p class="fo-help" style="margin:0">Fica no catálogo de produtos do InfoCliente. Serviços sem catálogo podem ser escritos diretamente na descrição do item.</p>`,
      actions: `<button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--primary" data-go>${icon("add")}Criar</button>`,
    });
    const g = (k) => dlg.el.querySelector(`[data-np="${k}"]`);
    setTimeout(() => g("name").focus(), 40);
    dlg.el.querySelector("[data-go]").addEventListener("click", async (e) => {
      const nm = g("name").value.trim();
      if (nm.length < 2) return g("name").classList.add("is-invalid");
      setBusy(e.currentTarget, true, "A criar…");
      try {
        const p = await apiRequest("/products", { method: "POST", body: { name: nm, sku: g("sku").value.trim() || null, unit: g("unit").value, category: g("category").value, minStock: 0 } });
        opts.products = [...(opts.products || []), { id: p.id, code: p.sku, name: p.name, unit: p.unit, category: p.category }];
        const target = idx === null ? f.items.findIndex((i) => !String(i.description).trim()) : idx;
        const at = target >= 0 ? target : f.items.push(emptyItem()) - 1;
        Object.assign(f.items[at], { productId: p.id, code: p.sku || "", description: p.name, unit: p.unit });
        toast(`Produto «${p.name}» criado.`, { type: "success" });
        dlg.close();
        dirty = true;
        rerender("items");
      } catch (err) {
        setBusy(e.currentTarget, false);
        if (err.status === 403) {
          toast("Sem permissão para criar produtos no catálogo — o item fica com a descrição escrita.", { type: "error" });
          if (idx !== null) {
            f.items[idx].description = nm;
            dlg.close();
            rerender("items");
          }
        } else toast(errMsg(err), { type: "error" });
      }
    });
  }

  // ── validação (mesma ordem e textos do servidor) ──
  function validate() {
    const errs = [];
    const items = f.items.filter((i) => String(i.description || "").trim());
    const t = totals();
    const quoting = mode === "new" && f.requiresQuote === true;
    const mark = [];
    if (mode === "new" && f.requiresQuote !== true && f.requiresQuote !== false) {
      errs.push("requer cotação? (sim / não)");
      mark.push("[data-quote-seg]");
    }
    if (f.tab === "FROTA") {
      if (!String(f.vehicle).trim()) {
        errs.push("viatura / equipamento");
        mark.push('[data-req="vehicle"]');
      }
      if (!f.fleetNature) {
        errs.push("natureza do custo de frota");
        mark.push('[data-req="fleetNature"]');
      }
    }
    if (f.mode === "FORN" && !quoting && !String(f.supplierName).trim()) {
      errs.push("terceiro");
      mark.push('[data-req="supplierName"]');
    }
    if (f.mode === "FM") {
      if (!f.fundCardId && fundCards.length) {
        errs.push("conta do fundo de maneio");
        mark.push('[data-req="fundCardId"]');
      }
      if (items.some((i) => !String(i.supplierName || "").trim())) errs.push("fornecedor de cada item");
    }
    if (!items.length) {
      errs.push("descrição de pelo menos um item");
      mark.push('[data-req-item="0"]');
    }
    if (!(t.total > 0) && !quoting) errs.push("valores dos itens");
    if (fromBank && t.total > bankTotal + 0.5) errs.push(`total do pedido não pode passar o valor do banco (${money(bankTotal)})`);
    if (!fromBank && f.condition === "CREDITO" && !f.dueDate) {
      errs.push("data de vencimento do crédito");
      mark.push('[data-req="dueDate"]');
    }
    if (!fromBank && f.condition === "PARCIAL") {
      if (f.installments.length < 2) errs.push("pelo menos duas parcelas");
      if (f.installments.some((p) => !p.dueDate)) errs.push("data de cada parcela");
      const sum = f.installments.reduce((a, p) => a + num(p.amount), 0);
      if (Math.abs(sum - t.total) > 0.5) errs.push(`soma das parcelas igual ao total (${money(t.total)})`);
    }
    const sp = f.splits.reduce((a, s) => a + num(s.percent), 0);
    if (Math.abs(sp - 100) > 0.01) errs.push("centros de custo a somar 100%");
    if (fromBank && !f.proof.length) {
      errs.push("comprovativo de pagamento");
      mark.push("[data-zone-proof] .fo-filezone");
    }
    return { errs, mark };
  }

  function showErrors({ errs, mark }, scroll = true) {
    body.querySelectorAll(".is-invalid").forEach((e) => e.classList.remove("is-invalid"));
    mark.forEach((sel) => body.querySelector(sel)?.classList.add("is-invalid"));
    const box = body.querySelector("[data-errors]");
    box.innerHTML = errorBox(errs);
    if (scroll && errs.length) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function submitLabel() {
    if (mode === "edit") return `${icon("save")}Gravar alterações`;
    if (mode === "bank") return `${icon("task_alt")}Registar pago e conciliar`;
    if (f.requiresQuote === true) return `${icon("request_quote")}Enviar às Compras para cotação`;
    return `${icon("send")}Submeter para aprovação`;
  }

  function renderFooter() {
    const t = totals();
    drawer.setFooter(`<div class="fo-foot-info"><span>Total a pagar <b>${money(t.total)}</b> ${esc(f.currency)}</span><span>${f.items.filter((i) => String(i.description).trim()).length} item(s)</span></div>
      <div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--ghost" data-cancel>Cancelar</button><button type="button" class="fo-btn ${mode === "bank" ? "fo-btn--brand" : "fo-btn--primary"}" data-submit>${submitLabel()}</button></div>`);
  }

  function refreshTotals() {
    const t = totals();
    const tb = body.querySelector("[data-totals]");
    if (tb) tb.innerHTML = totalsInner(t);
    f.items.forEach((it, i) => {
      const c = body.querySelector(`[data-line="${i}"]`);
      if (c) c.textContent = money(lineBase(it));
    });
    // valores dos centros de custo
    body.querySelectorAll("[data-sp]").forEach((tr) => {
      const s = f.splits[Number(tr.dataset.sp)];
      const v = tr.querySelector('[data-k="value"]');
      if (v && document.activeElement !== v) v.value = money((t.total * num(s.percent)) / 100);
    });
    const spt = body.querySelector("[data-sp-total]");
    if (spt) spt.textContent = money(t.total);
    refreshInstSum();
    const fi = drawer.footer.querySelector(".fo-foot-info");
    if (fi) fi.innerHTML = `<span>Total a pagar <b>${money(t.total)}</b> ${esc(f.currency)}</span><span>${f.items.filter((i) => String(i.description).trim()).length} item(s)</span>`;
  }

  function refreshSpSum() {
    const sum = round2(f.splits.reduce((a, s) => a + num(s.percent), 0));
    const ok = Math.abs(sum - 100) < 0.01;
    const el = body.querySelector("[data-sp-sum]");
    if (el) {
      el.className = ok ? "fo-sum-ok" : "fo-sum-bad";
      el.textContent = `${sum.toFixed(1).replace(".", ",")} % ${ok ? "✓" : ""}`;
    }
  }

  function refreshInstSum() {
    const el = body.querySelector("[data-in-sum]");
    if (!el) return;
    const t = totals();
    const sum = round2(f.installments.reduce((a, p) => a + num(p.amount), 0));
    const ok = Math.abs(sum - t.total) < 0.5 && f.installments.length >= 2;
    el.className = ok ? "fo-sum-ok" : "fo-sum-bad";
    el.textContent = `${money(sum)} de ${money(t.total)} ${ok ? "✓" : ""}`;
  }

  function splitEqual() {
    const t = totals().total;
    const n = f.installments.length;
    if (!n) return;
    const part = Math.floor((t / n) * 100) / 100;
    f.installments.forEach((p, i) => (p.amount = i === n - 1 ? round2(t - part * (n - 1)) : part));
    rerender("cond");
  }

  // ── eventos ──
  body.addEventListener("input", (e) => {
    const el = e.target;
    dirty = true;
    el.classList.remove("is-invalid");
    if (el.dataset.f) {
      const k = el.dataset.f;
      f[k] = el.value;
      if (k === "supplierName") {
        f.supplierId = null;
        const h = body.querySelector("[data-supplier-hint]");
        if (h) h.innerHTML = el.value.trim() ? `${icon("person_add")} Terceiro novo — fica criado ao submeter.` : "";
      }
      if (k === "supplierIban") f.supplierIban = el.value.replace(/\s+/g, "").toUpperCase();
      if (k === "creditDays" && num(el.value) > 0) {
        f.dueDate = addDays(f.requestDate || todayKey(), Math.round(num(el.value)));
        const d = body.querySelector('[data-f="dueDate"]');
        if (d) d.value = f.dueDate;
      }
      if (k === "dueDate" && f.condition === "CREDITO" && el.value) {
        f.creditDays = Math.max(daysBetween(el.value, f.requestDate || todayKey()), 0);
        const d = body.querySelector('[data-f="creditDays"]');
        if (d) d.value = f.creditDays;
      }
      if (k === "currency") refreshTotals();
      return;
    }
    const itr = el.closest("[data-it]");
    if (itr && el.dataset.k) {
      const it = f.items[Number(itr.dataset.it)];
      const k = el.dataset.k;
      if (["quantity", "unitPrice", "vatPercent", "withholdingPercent", "discountPercent"].includes(k)) it[k] = parseMoney(el.value);
      else it[k] = el.value;
      if (k === "description") {
        it.productId = null;
      }
      if (k === "supplierName") it.supplierId = null;
      refreshTotals();
      return;
    }
    const spr = el.closest("[data-sp]");
    if (spr && el.dataset.k) {
      const s = f.splits[Number(spr.dataset.sp)];
      if (el.dataset.k === "percent") {
        s.percent = parseMoney(el.value);
        const v = spr.querySelector('[data-k="value"]');
        if (v) v.value = money((totals().total * s.percent) / 100);
      } else if (el.dataset.k === "value") {
        const tot = totals().total;
        s.percent = tot > 0 ? round2((parseMoney(el.value) / tot) * 100 * 100) / 100 : 0;
        const p = spr.querySelector('[data-k="percent"]');
        if (p) p.value = String(round2(s.percent)).replace(".", ",");
      }
      refreshSpSum();
      return;
    }
    const inr = el.closest("[data-in]");
    if (inr && el.dataset.k) {
      const p = f.installments[Number(inr.dataset.in)];
      p[el.dataset.k] = el.dataset.k === "amount" ? parseMoney(el.value) : el.value;
      refreshInstSum();
      return;
    }
    if (el.matches("[data-n-inst]")) {
      const n = Math.min(Math.max(Math.round(num(el.value)), 0), 36);
      if (!n) return;
      const base = f.requestDate || todayKey();
      while (f.installments.length < n) f.installments.push({ dueDate: addDays(base, 30 * (f.installments.length + 1)), amount: 0 });
      f.installments.length = n;
      const t = totals().total;
      if (f.installments.every((p) => !num(p.amount)) && t > 0) splitEqual();
      else rerender("cond");
      setTimeout(() => {
        const inp = body.querySelector("[data-n-inst]");
        if (inp) {
          inp.focus();
          inp.setSelectionRange(inp.value.length, inp.value.length);
        }
      }, 0);
    }
  });

  body.addEventListener("change", (e) => {
    const el = e.target;
    const spr = el.closest("[data-sp]");
    if (spr && el.dataset.k === "costCenterCode") {
      const s = f.splits[Number(spr.dataset.sp)];
      const o = ccOptions().find((x) => x.value === el.value);
      s.costCenterCode = el.value;
      s.projectId = o?.projectId || null;
      s.label = o?.label || null;
      dirty = true;
    }
    if (el.matches("[data-toggle-rf]")) {
      f.showRf = el.checked;
      rerender("items");
    }
    if (el.dataset.f === "requestDate" && f.condition === "CREDITO" && num(f.creditDays) > 0) {
      f.dueDate = addDays(f.requestDate, Math.round(num(f.creditDays)));
      rerender("cond");
    }
  });

  body.addEventListener("click", (e) => {
    const t = e.target;
    const tab = t.closest("[data-tab]");
    if (tab) {
      f.tab = tab.dataset.tab;
      if (f.tab === "FROTA" && f.splits.length === 1 && f.splits[0].costCenterCode === "CC-SEDE") f.splits = [{ costCenterCode: "CC-FROTA", projectId: null, percent: 100 }];
      if (f.tab === "GERAL" && f.splits.length === 1 && f.splits[0].costCenterCode === "CC-FROTA") f.splits = [{ costCenterCode: "CC-SEDE", projectId: null, percent: 100 }];
      dirty = true;
      body.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("is-on", b === tab));
      rerender("dados");
      rerender("cc");
      return;
    }
    const md = t.closest("[data-mode]");
    if (md) {
      f.mode = md.dataset.mode;
      dirty = true;
      rerender("dados");
      rerender("items");
      return;
    }
    const q = t.closest("[data-quote]");
    if (q) {
      f.requiresQuote = q.dataset.quote === "1";
      dirty = true;
      rerender("dados");
      renderFooter();
      return;
    }
    const cond = t.closest("[data-cond]");
    if (cond) {
      f.condition = cond.dataset.cond;
      if (f.condition === "PARCIAL" && f.installments.length < 2) {
        const base = f.requestDate || todayKey();
        f.installments = [
          { dueDate: addDays(base, 30), amount: 0 },
          { dueDate: addDays(base, 60), amount: 0 },
        ];
        dirty = true;
        return splitEqual();
      }
      if (f.condition === "CREDITO" && !f.dueDate) {
        f.creditDays = f.creditDays || 30;
        f.dueDate = addDays(f.requestDate || todayKey(), num(f.creditDays));
      }
      dirty = true;
      rerender("cond");
      return;
    }
    if (t.closest("[data-split-equal]")) return splitEqual();
    if (t.closest("[data-add-item]")) {
      const last = f.items[f.items.length - 1] || {};
      f.items.push(emptyItem({ vatPercent: last.vatPercent ?? 14, withholdingPercent: last.withholdingPercent ?? 0 }));
      rerender("items");
      setTimeout(() => body.querySelector(`[data-it="${f.items.length - 1}"] [data-k="description"]`)?.focus(), 0);
      return;
    }
    if (t.closest("[data-new-product]")) return openNewProduct(null, "");
    const itr = t.closest("[data-it]");
    if (itr && t.closest("[data-rm-item]")) {
      f.items.splice(Number(itr.dataset.it), 1);
      dirty = true;
      rerender("items");
      refreshTotals();
      return;
    }
    if (itr && t.closest("[data-note]")) {
      const it = f.items[Number(itr.dataset.it)];
      it.showNote = !it.showNote;
      rerender("items");
      if (it.showNote) setTimeout(() => body.querySelector(`.fo-row-note[data-it="${itr.dataset.it}"] input`)?.focus(), 0);
      return;
    }
    if (t.closest("[data-add-sp]")) {
      const sum = f.splits.reduce((a, s) => a + num(s.percent), 0);
      f.splits.push({ costCenterCode: "CC-SEDE", projectId: null, percent: Math.max(round2(100 - sum), 0) });
      dirty = true;
      rerender("cc");
      return;
    }
    const spr = t.closest("[data-sp]");
    if (spr && t.closest("[data-rm-sp]")) {
      f.splits.splice(Number(spr.dataset.sp), 1);
      if (f.splits.length === 1) f.splits[0].percent = 100;
      dirty = true;
      rerender("cc");
    }
  });

  drawer.footer.addEventListener("click", async (e) => {
    if (e.target.closest("[data-cancel]")) return drawer.close();
    const btn = e.target.closest("[data-submit]");
    if (!btn) return;
    triedSubmit = true;
    const v = validate();
    showErrors(v);
    if (v.errs.length) return;
    const items = f.items.filter((i) => String(i.description || "").trim());
    const kind = f.tab === "FROTA" ? "FROTA" : f.splits.some((s) => s.projectId) ? "OBRA" : "GERAL";
    const payload = {
      kind,
      mode: f.mode,
      requestDate: f.requestDate || todayKey(),
      currency: f.currency,
      requiresQuote: mode === "new" ? f.requiresQuote : undefined,
      supplierId: f.mode === "FORN" ? f.supplierId || null : null,
      supplierName: f.mode === "FORN" ? f.supplierName.trim() || null : cardLabel(fundCards.find((c) => c.id === f.fundCardId)) || "Fundo de maneio",
      supplierNif: f.mode === "FORN" ? f.supplierNif || null : null,
      supplierIban: f.mode === "FORN" ? (f.supplierIban || "").replace(/\s+/g, "") || null : null,
      supplierBank: f.mode === "FORN" ? f.supplierBank || null : null,
      supplierEmail: f.mode === "FORN" ? f.supplierEmail || null : null,
      fundCardId: f.mode === "FM" ? f.fundCardId || null : null,
      projectId: f.splits.slice().sort((a, b) => num(b.percent) - num(a.percent)).find((s) => s.projectId)?.projectId || null,
      vehicle: f.tab === "FROTA" ? f.vehicle : null,
      fleetNature: f.tab === "FROTA" ? f.fleetNature : null,
      mileage: f.tab === "FROTA" && String(f.mileage).trim() ? parseMoney(f.mileage) : null,
      condition: fromBank ? "PRONTO" : f.condition,
      creditDays: f.condition === "CREDITO" && f.creditDays !== "" ? Math.round(num(f.creditDays)) : null,
      dueDate: fromBank ? f.requestDate : f.condition === "PARCIAL" ? null : f.dueDate || null,
      notes: f.notes || null,
      noInvoice: f.noInvoice,
      items: items.map((i) => ({
        productId: i.productId || null,
        code: i.code || null,
        description: i.description.trim(),
        unit: i.unit || "UN",
        quantity: num(i.quantity),
        unitPrice: num(i.unitPrice),
        vatPercent: num(i.vatPercent),
        withholdingPercent: f.showRf ? num(i.withholdingPercent) : 0,
        discountPercent: f.showRf ? num(i.discountPercent) : 0,
        notes: i.notes || null,
        supplierId: f.mode === "FM" ? i.supplierId || null : null,
        supplierName: f.mode === "FM" ? i.supplierName || null : null,
      })),
      splits: f.splits.map((s) => ({ costCenterCode: s.costCenterCode, projectId: s.projectId || null, label: s.label || null, percent: num(s.percent) })),
      installments: f.condition === "PARCIAL" && !fromBank ? f.installments.map((p) => ({ dueDate: p.dueDate, amount: num(p.amount) })) : [],
      ...(fromBank ? { fromMovementIds: fromMovements.map((m) => m.id) } : {}),
    };
    if (payload.requiresQuote === undefined) delete payload.requiresQuote;
    setBusy(btn, true, mode === "edit" ? "A gravar…" : "A submeter…");
    try {
      const res = mode === "edit" ? await apiRequest(`${BASE}/${f.id}`, { method: "PATCH", body: payload }) : await apiRequest(BASE, { method: "POST", body: payload });
      let saved = res.item;
      for (const file of f.files.docs) {
        const fd = new FormData();
        fd.append("kind", "PROFORMA");
        fd.append("file", file);
        saved = (await apiUpload(`${BASE}/${saved.id}/documents`, fd, "POST")).item;
      }
      if (fromBank && f.proof[0]) {
        for (const m of fromMovements) {
          const fd = new FormData();
          fd.append("file", f.proof[0]);
          await apiUpload(`/finance/reconciliation/movements/${m.id}/proof`, fd, "POST");
        }
        saved = (await apiRequest(`${BASE}/${saved.id}`)).item;
      }
      dirty = false;
      if (mode === "edit") toast(`${saved.number} gravada.`, { type: "success" });
      else if (mode === "bank") toast(`${saved.number} registada — paga e conciliada.`, { type: "success" });
      else if (saved.state === "EM_COTACAO") toast(`Requisição ${saved.number} enviada às Compras para cotação.`, { type: "success" });
      else toast(`Requisição ${saved.number} submetida para aprovação.`, { type: "success" });
      drawer.close(true);
      onSaved?.(saved);
    } catch (err) {
      setBusy(btn, false);
      if (err?.data?.errors?.length) showErrors({ errs: err.data.errors, mark: [] });
      toast(errMsg(err, "Não foi possível gravar a requisição."), { type: "error" });
    }
  });

  renderAll();
  if (focus === "cc") setTimeout(() => body.querySelector('[data-sec="cc"]')?.scrollIntoView({ behavior: "smooth" }), 80);
  else if (mode === "new") setTimeout(() => body.querySelector('[data-quote="0"]')?.focus(), 80);
}

// ─── detalhe ─────────────────────────────────────────────────────────────────

export async function openRequestDetail(idOrItem, { onChange } = {}) {
  const id = typeof idOrItem === "string" ? idOrItem : idOrItem.id;
  let pr = typeof idOrItem === "string" ? null : idOrItem;
  const opts = await loadOptions().catch(() => ({ cards: [], costCenters: [] }));
  const drawer = openDrawer({ kicker: pr ? `${pr.number} · ${pr.kindLabel || ""}` : "Requisição", title: pr ? esc(pr.supplierName || "—") : "A carregar…", width: 1000 });
  const body = drawer.body;
  let payOpen = false;

  const changed = (item) => {
    pr = item;
    onChange?.(item);
    render();
  };

  async function reload() {
    try {
      const { item } = await apiRequest(`${BASE}/${id}`);
      pr = item;
      render();
    } catch (err) {
      body.innerHTML = `<div class="fo-errors">${icon("error")}<div>${esc(errMsg(err))}</div></div>`;
    }
  }

  function headerActions() {
    const btns = [];
    const st = pr.status;
    if (st === "Por aprovar" && canApprove()) {
      btns.push(`<button type="button" class="fo-btn fo-btn--danger-ghost fo-btn--sm" data-act="reject">${icon("close")}Rejeitar</button>`);
      btns.push(`<button type="button" class="fo-btn fo-btn--brand fo-btn--sm" data-act="approve">${icon("check")}Aprovar</button>`);
    }
    if (st === "Em pausa") btns.push(`<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-act="resume" ${canApprove() ? "" : "disabled"}>${icon("play_arrow")}Retomar</button>`);
    else if (!["Pago", "Rejeitado", "Por aprovar", "Em cotação"].includes(st)) btns.push(`<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-act="pause">${icon("pause")}Pôr em pausa</button>`);
    if (!pr.sourceRef && canEdit()) {
      btns.push(`<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-act="edit">${icon("edit")}Editar</button>`);
      if (pr.kind !== "OBRA") btns.push(`<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-act="cc">${icon("domain_add")}Associar custo a uma obra</button>`);
    }
    btns.push(`<button type="button" class="fo-icon-btn" data-act="menu" title="Mais ações" data-fo-keep-pop>${icon("more_vert")}</button>`);
    return btns.join("");
  }

  function render() {
    if (!pr) return;
    drawer.setHeader({
      kicker: `${esc(pr.number)} · ${esc((pr.kindLabel || "").toUpperCase())}`,
      title: `${esc(pr.supplierName || "—")} ${pill(pr.status)}`,
      subtitle: `Pedido por <b>${esc(pr.requestedBy || "—")}</b> em ${fmtDate(pr.requestDate)}${pr.approvedBy ? ` · aprovado por <b>${esc(pr.approvedBy)}</b>` : ""}`,
      actions: headerActions(),
    });
    const pct = pr.totalAmount > 0 ? Math.min(100, (pr.paidAmount / pr.totalAmount) * 100) : 0;
    const card = opts.cards?.find((c) => c.id === pr.fundCardId);
    const projectLabel = pr.project ? `${pr.project.code} · ${pr.project.name}` : "—";
    const condLabel = { PRONTO: "Pronto pagamento", CREDITO: `Crédito${pr.creditDays ? ` ${pr.creditDays} dias` : ""}`, PARCIAL: `${pr.installments.length} parcelas` }[pr.condition] || "—";
    const invoices = pr.documents.filter((d) => ["FATURA", "AF", "DSC"].includes(d.kind));
    const proformas = pr.documents.filter((d) => ["PROFORMA", "OUTRO"].includes(d.kind) && d.path);
    const proofs = [
      ...pr.payments.filter((p) => p.proofPath).map((p) => ({ path: p.proofPath, name: p.proofName || `Comprovativo ${fmtDate(p.paidAt)}` })),
      ...pr.documents.filter((d) => d.kind === "COMPROVATIVO" && d.path),
    ];
    const canPay = !["Pago", "Por aprovar", "Em cotação", "Rejeitado", "Em pausa"].includes(pr.status) && canEdit();
    const block = mirrorBlock(pr);
    const rf = pr.items.some((i) => i.withholdingPercent || i.discountPercent);

    body.innerHTML = `
      ${pr.stateReason && ["Rejeitado", "Em pausa"].includes(pr.status) ? `<div class="fo-note fo-note--warn">${icon("report")}<span><b>${pr.status === "Rejeitado" ? "Rejeitada" : "Em pausa"}:</b> ${esc(pr.stateReason)}</span></div>` : ""}
      ${pr.sourceRef ? `<div class="fo-note fo-note--muted">${icon("link")}<span>Vem de <b>${esc(sourceLabel(pr))}</b>${pr.sourceMeta?.docNumber ? ` (${esc(pr.sourceMeta.docNumber)})` : ""}${pr.sourceMeta?.costCenterName ? ` · ${esc(pr.sourceMeta.costCenterName)}` : ""}. Os dados alteram-se na origem; o pagamento pode registar-se aqui.</span></div>` : ""}
      <div class="fo-summary">
        <div><span>Total a pagar</span><b>${money(pr.totalAmount)} <small class="fo-faint" style="font-size:.6em">${esc(pr.currency)}</small></b></div>
        <div><span>Pago</span><b class="fo-green">${money(pr.paidAmount)}</b><div class="fo-progress" style="margin-top:.5rem"><span style="width:${pct}%"></span></div></div>
        <div><span>Em dívida</span><b class="${pr.openAmount > 0 && pr.status === "Atrasado" ? "fo-red" : ""}">${money(pr.openAmount)}</b>${pr.nextDue && pr.openAmount > 0 ? `<small class="fo-muted" style="font-size:12px">vence ${fmtDate(pr.nextDue)}${pr.daysLate > 0 ? ` · <b class="fo-red">${pr.daysLate} dia(s) de atraso</b>` : ""}</small>` : ""}</div>
      </div>
      <dl class="fo-info-grid">
        <div><dt>Centro de custo</dt><dd>${esc(ccLabel(pr.costCenterCode, opts))}${pr.splits.length > 1 ? ` <span class="fo-faint">+${pr.splits.length - 1}</span>` : ""}</dd></div>
        <div><dt>Obra</dt><dd>${esc(projectLabel)}</dd></div>
        <div><dt>Modo</dt><dd>${pr.mode === "FM" ? `TRF INT · ${esc(cardLabel(card))}` : "PF · Transferência"}</dd></div>
        <div><dt>NIF</dt><dd>${esc(pr.supplierNif || "—")}</dd></div>
        <div><dt>IBAN</dt><dd class="fo-mono">${pr.supplierIban ? esc(formatIban(pr.supplierIban)) : "—"}</dd></div>
        <div><dt>Requer cotação</dt><dd>${pr.requiresQuote ? "Sim" : "Não"}</dd></div>
        <div><dt>Condição</dt><dd>${esc(condLabel)}</dd></div>
        <div><dt>Vencimento</dt><dd class="${pr.status === "Atrasado" ? "fo-red" : ""}">${fmtDate(pr.nextDue || pr.dueDate)}</dd></div>
        ${pr.kind === "FROTA" ? `<div><dt>Viatura</dt><dd>${esc(pr.vehicle || "—")}</dd></div><div><dt>Natureza</dt><dd>${esc(FLEET_LABELS[pr.fleetNature] || pr.fleetNature || "—")}</dd></div><div><dt>Km / horas</dt><dd>${pr.mileage ?? "—"}</dd></div><div><dt>Moeda</dt><dd>${esc(pr.currency)}</dd></div>` : ""}
      </dl>

      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title">${icon("list_alt")}Itens</h3></div>
        <div class="fo-edit-scroll"><table class="fo-mini-table">
          <thead><tr><th>Código</th><th>Descrição</th>${pr.mode === "FM" ? "<th>Fornecedor</th>" : ""}<th>Un.</th><th>Obs.</th><th class="ta-r">Qtd.</th><th class="ta-r">V. unit.</th><th class="ta-r">IVA %</th>${rf ? '<th class="ta-r">RF %</th><th class="ta-r">Desc. %</th>' : ""}<th class="ta-r">Total s/ IVA</th></tr></thead>
          <tbody>${pr.items
            .map(
              (i) => `<tr><td class="fo-faint">${esc(i.code || "—")}</td><td><b style="color:var(--fo-ink)">${esc(i.description)}</b></td>${pr.mode === "FM" ? `<td>${esc(i.supplierName || "—")}</td>` : ""}<td>${esc(i.unit)}</td><td class="fo-muted">${esc(i.notes || "")}</td><td class="ta-r fo-num">${String(i.quantity).replace(".", ",")}</td><td class="ta-r fo-num">${money(i.unitPrice)}</td><td class="ta-r fo-num">${i.vatPercent}</td>${rf ? `<td class="ta-r fo-num">${i.withholdingPercent}</td><td class="ta-r fo-num">${i.discountPercent}</td>` : ""}<td class="ta-r fo-num"><b>${money(i.total)}</b></td></tr>`
            )
            .join("")}</tbody>
        </table></div>
        <div class="fo-totals" style="margin-top:.85rem">
          <div><span>Total s/ IVA</span><b>${money(pr.baseAmount)}</b></div>
          <div><span>IVA</span><b>${money(pr.vatAmount)}</b></div>
          ${pr.withholdingAmount ? `<div class="is-neg"><span>Retenção na fonte</span><b>− ${money(pr.withholdingAmount)}</b></div>` : ""}
          <div class="is-big"><span>Total a pagar</span><b>${money(pr.totalAmount)}</b></div>
          <div><span>Pago</span><b class="fo-green">${money(pr.paidAmount)}</b></div>
          <div><span>Em dívida</span><b>${money(pr.openAmount)}</b></div>
        </div>
        ${pr.notes ? `<div class="fo-note fo-note--muted" style="margin-top:.85rem">${icon("sticky_note_2")}<span>${esc(pr.notes)}</span></div>` : ""}
        ${pr.splits.length > 1 ? `<p class="fo-help" style="margin:.75rem 0 0">Repartição: ${pr.splits.map((s) => `${esc(ccLabel(s.costCenterCode, opts))} ${String(s.percent).replace(".", ",")}%`).join(" · ")}</p>` : ""}
        ${pr.condition === "PARCIAL" && pr.installments.length ? `<p class="fo-help" style="margin:.4rem 0 0">Parcelas: ${pr.installments.map((p) => `${p.number}.ª ${fmtDate(p.dueDate)} · ${money(p.amount)}`).join(" | ")}</p>` : ""}
      </section>

      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title">${icon("folder_open")}Documentos</h3></div>
        <div class="fo-docs">
          <div class="fo-docbox ${proformas.length ? "is-ok" : pr.docState.proformaNeeded ? "is-missing" : ""}">
            <div class="fo-docbox-head"><b>${icon("request_quote")}Proforma</b><button type="button" class="fo-btn fo-btn--ghost fo-btn--xs" data-up="PROFORMA">${icon("upload")}Carregar</button></div>
            ${proformas.map((d) => `<div class="fo-doclink">${icon("description")}<a href="${esc(fileUrl(d.path))}" target="_blank" rel="noopener">${esc(d.name || "Proforma")}</a></div>`).join("") || `<span class="fo-help">${pr.docState.proformaNeeded ? "Em falta — o pedido requer cotação." : "Opcional."}</span>`}
          </div>
          <div class="fo-docbox ${invoices.length ? "is-ok" : pr.docState.invoiceNeeded && pr.paidAmount > 0 ? "is-missing" : ""}">
            <div class="fo-docbox-head"><b>${icon("receipt_long")}Faturas</b><button type="button" class="fo-btn fo-btn--ghost fo-btn--xs" data-invoices>${icon("add")}Anexar fatura</button></div>
            ${invoices.map((d) => `<div class="fo-doclink">${icon(d.kind === "DSC" ? "money_off" : "receipt")}${d.path ? `<a href="${esc(fileUrl(d.path))}" target="_blank" rel="noopener">${esc(DOC_KIND_LABELS[d.kind])} ${esc(d.number || "")}</a>` : `<span style="flex:1">${esc(DOC_KIND_LABELS[d.kind])}</span>`}<span class="fo-num fo-muted">${d.amount !== null ? money(d.amount) : ""}</span></div>`).join("") || `<span class="fo-help">${pr.docState.invoiceNeeded && pr.paidAmount > 0 ? "Em falta — pago sem fatura." : "Anexa-se depois do pagamento."}</span>`}
          </div>
          <div class="fo-docbox ${proofs.length ? "is-ok" : pr.paidAmount > 0 ? "is-missing" : ""}">
            <div class="fo-docbox-head"><b>${icon("verified")}Comprovativo</b><button type="button" class="fo-btn fo-btn--ghost fo-btn--xs" data-up="COMPROVATIVO">${icon("upload")}Anexar</button></div>
            ${proofs.map((d) => `<div class="fo-doclink">${icon("picture_as_pdf")}<a href="${esc(fileUrl(d.path))}" target="_blank" rel="noopener">${esc(d.name || "Comprovativo")}</a></div>`).join("") || `<span class="fo-help">${pr.paidAmount > 0 ? "Em falta — anexa-se na conciliação." : "Anexa-se na conciliação."}</span>`}
          </div>
        </div>
      </section>

      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title">${icon("payments")}Pagamentos</h3>
          ${canPay ? `<button type="button" class="fo-btn ${payOpen ? "fo-btn--ghost" : "fo-btn--brand"} fo-btn--sm" data-toggle-pay ${block ? `disabled title="${esc(block)}"` : ""}>${icon(payOpen ? "close" : "add")}${payOpen ? "Fechar" : "Registar pagamento"}</button>` : ""}</div>
        ${
          pr.payments.length
            ? `<table class="fo-mini-table"><thead><tr><th>Data</th><th>Conta</th><th>Referência</th><th class="ta-r">Valor</th><th>Comprovativo</th><th>Por</th><th></th></tr></thead><tbody>${pr.payments
                .map((p) => {
                  const c = opts.cards?.find((x) => x.id === p.cardId);
                  return `<tr><td>${fmtDate(p.paidAt)}</td><td>${c ? esc(cardLabel(c)) : '<span class="fo-faint">—</span>'}</td><td>${esc(p.reference || "—")}</td><td class="ta-r fo-num"><b>${money(p.amount)}</b></td>
                  <td>${p.proofPath ? `<a class="fo-link" href="${esc(fileUrl(p.proofPath))}" target="_blank" rel="noopener">${icon("picture_as_pdf")} abrir</a>` : '<span class="fo-red" style="font-size:12px;font-weight:600">em falta</span>'}${p.bankMovementId ? ` <span class="fo-tag fo-tag--green" title="Conciliado com o banco">${icon("link")} banco</span>` : ""}</td>
                  <td class="fo-muted">${esc(p.createdBy || "—")}</td>
                  <td class="ta-r">${!p.bankMovementId && canEdit() && !pr.sourceRef ? `<button type="button" class="fo-icon-btn fo-icon-btn--sm" data-rm-pay="${esc(p.id)}" title="Anular este pagamento">${icon("delete")}</button>` : ""}</td></tr>`;
                })
                .join("")}</tbody></table>`
            : `<p class="fo-help" style="margin:0">${pr.paidAmount > 0 ? `Pago na origem (${esc(sourceLabel(pr))}).` : "Ainda sem pagamentos."}</p>`
        }
        ${payOpen ? `<div class="fo-section" style="margin-top:.85rem;background:var(--fo-bg)" data-pay-inline>${payFormHtml(pr, opts)}<div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:.85rem"><button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-toggle-pay>Cancelar</button><button type="button" class="fo-btn fo-btn--brand fo-btn--sm" data-pay-go>${icon("task_alt")}Confirmar pagamento</button></div></div>` : ""}
      </section>

      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title">${icon("history")}Histórico</h3></div>
        <ul class="fo-timeline">${pr.history.map((h) => `<li>${esc(h.text)}<small>${esc(h.by || "—")} · ${new Date(h.at).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}</small></li>`).join("") || '<li class="fo-muted">Sem registos.</li>'}</ul>
      </section>`;

    if (payOpen) {
      const inline = body.querySelector("[data-pay-inline]");
      const files = { proof: [] };
      bindMoney(inline);
      const zone = inline.querySelector("[data-pay-zone]");
      const rz = () => {
        zone.innerHTML = fileZoneHtml("proof", { label: "Anexar PDF", accept: ".pdf,application/pdf", files: files.proof });
        bindFileZones(zone, files, rz);
      };
      bindFileZones(zone, files, rz);
      inline.querySelector("[data-pay-go]").addEventListener("click", async (e) => {
        const item = await submitPay(inline, pr, files, e.currentTarget);
        if (item) {
          payOpen = false;
          changed(item);
        }
      });
    }
  }

  drawer.el.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]");
    if (act && pr) {
      const a = act.dataset.act;
      if (a === "approve") return runAction(pr, "approve", { onDone: changed });
      if (a === "resume") return runAction(pr, "resume", { onDone: changed });
      if (a === "reject") {
        const reason = await ask(`Porque rejeita a ${pr.number}?`, { title: "Rejeitar requisição", ok: "Rejeitar", danger: true, input: true, required: true, placeholder: "Motivo da rejeição" });
        if (reason) runAction(pr, "reject", { reason, onDone: changed });
        return;
      }
      if (a === "pause") {
        const reason = await ask(`Pôr a ${pr.number} em pausa?`, { title: "Pôr em pausa", ok: "Pôr em pausa", input: true, placeholder: "Motivo (opcional)" });
        if (reason !== null) runAction(pr, "pause", { reason, onDone: changed });
        return;
      }
      if (a === "edit") return openRequestForm({ item: pr, onSaved: changed });
      if (a === "cc") return openRequestForm({ item: pr, focus: "cc", onSaved: changed });
      if (a === "menu") {
        const items = stateMenuItems(pr, { onDone: changed });
        if (!pr.sourceRef && getSessionUser()?.role === "admin") {
          items.push("sep", {
            icon: "delete",
            label: "Eliminar a requisição",
            tone: "bad",
            onClick: async () => {
              const ok = await ask(`Eliminar a ${pr.number}? Os documentos anexados também são apagados. Não se pode desfazer.`, { title: "Eliminar requisição", ok: "Eliminar", danger: true });
              if (!ok) return;
              try {
                await apiRequest(`${BASE}/${pr.id}`, { method: "DELETE" });
                toast(`${pr.number} eliminada.`, { type: "success" });
                drawer.close(true);
                onChange?.(null, pr.id);
              } catch (err) {
                toast(errMsg(err), { type: "error" });
              }
            },
          });
        }
        popMenu(act, items, { title: `${pr.number} · ${pr.status}`, width: 300 });
      }
      return;
    }
    if (e.target.closest("[data-toggle-pay]")) {
      payOpen = !payOpen;
      render();
      if (payOpen) setTimeout(() => body.querySelector("[data-pay-inline]")?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
      return;
    }
    const up = e.target.closest("[data-up]");
    if (up) return uploadRequestDoc(pr, up.dataset.up, { accept: up.dataset.up === "COMPROVATIVO" ? ".pdf,application/pdf" : ".pdf,image/*", onDone: changed });
    if (e.target.closest("[data-invoices]")) return openInvoicesDialog(pr, { onDone: changed });
    const rmp = e.target.closest("[data-rm-pay]");
    if (rmp) {
      const ok = await ask("Anular este pagamento? O valor volta a ficar em dívida.", { title: "Anular pagamento", ok: "Anular", danger: true });
      if (!ok) return;
      try {
        const { item } = await apiRequest(`${BASE}/${pr.id}/payments/${rmp.dataset.rmPay}`, { method: "DELETE" });
        toast("Pagamento anulado.", { type: "success" });
        changed(item);
      } catch (err) {
        toast(errMsg(err), { type: "error" });
      }
    }
  });

  if (pr) render();
  else body.innerHTML = `<div class="fo-empty"><span class="fo-spin" style="margin:0 auto;width:24px;height:24px;color:var(--fo-faint)"></span></div>`;
  reload();
  return drawer;
}

export { openFile, norm };
