import { apiRequest } from "../services/api.js";

/**
 * Aprovações pendentes e aprovação em lote (Fase 4).
 *
 * - `fetchPendingApprovals()` devolve o que o utilizador pode decidir agora.
 * - `decideApproval(item, "approve"|"reject", reason)` chama a rota de cada
 *   módulo: as regras, a auditoria e as notificações são as de sempre.
 * - `openApprovals({ ids })` abre o modal com seleção múltipla.
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const KIND_ORDER = ["NEED_ANALYSIS", "EXTRA_REQUEST", "PURCHASE_ORDER", "REINFORCEMENT"];
const KIND_TITLE = {
  NEED_ANALYSIS: "Análises de necessidades",
  EXTRA_REQUEST: "Pedidos extra",
  PURCHASE_ORDER: "Requisições de compra",
  REINFORCEMENT: "Reforços de fundo",
};
/** O que acontece ao aprovar, dito antes de confirmar. */
const KIND_EFFECT = {
  NEED_ANALYSIS: "ficam prontas para enviar ao financeiro (o pagamento continua pendente)",
  EXTRA_REQUEST: "seguem para liquidação no financeiro",
  PURCHASE_ORDER: "passam para o plano de pagamentos",
  REINFORCEMENT: "o valor entra já no fundo da obra",
};

function money(value, currency = "AOA") {
  const n = Number(value);
  if (!Number.isFinite(n) || !n) return "";
  return `${n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "AOA" ? "Kz" : currency}`;
}

function totalsText(items) {
  const byCur = new Map();
  items.forEach((i) => i.amount && byCur.set(i.currency || "AOA", (byCur.get(i.currency || "AOA") || 0) + Number(i.amount)));
  return [...byCur].map(([cur, v]) => money(v, cur)).join(" + ");
}

// ── Dados ───────────────────────────────────────────────────────────────────

let cache = null;
let cacheAt = 0;
let inflight = null;

export async function fetchPendingApprovals({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < 15000) return cache;
  if (inflight) return inflight;
  inflight = apiRequest("/approvals/pending")
    .then((data) => {
      cache = data;
      cacheAt = Date.now();
      return data;
    })
    .finally(() => (inflight = null));
  return inflight;
}

export function invalidatePendingApprovals() {
  cache = null;
}

function changed() {
  invalidatePendingApprovals();
  window.dispatchEvent(new CustomEvent("inforcliente:notifications-changed"));
  window.dispatchEvent(new CustomEvent("inforcliente:approvals-changed"));
}

/** Executa uma decisão pela rota do próprio módulo. */
export async function decideApproval(item, decision, reason = "") {
  const id = encodeURIComponent(item.id);
  const approve = decision === "approve";
  const note = reason?.trim() || null;
  if (item.kind === "NEED_ANALYSIS") {
    if (!approve) throw new Error("A análise não se rejeita aqui: abra a necessidade para rever as cotações.");
    return apiRequest(`/quotes/need/${id}/approve-analysis`, { method: "PATCH" });
  }
  if (item.kind === "EXTRA_REQUEST") {
    return apiRequest(`/extra-requests/${id}/${approve ? "approve" : "reject"}`, {
      method: "PATCH",
      body: approve ? undefined : { reason: note },
    });
  }
  if (item.kind === "PURCHASE_ORDER") {
    return apiRequest(`/purchase-orders/${id}/approve`, {
      method: "POST",
      body: { decision: approve ? "APROVADO" : "NAO_APROVADO", observations: note },
    });
  }
  if (item.kind === "REINFORCEMENT") {
    return apiRequest(`/petty-cash/reinforcement-requests/${id}/${approve ? "approve" : "reject"}`, {
      method: "PATCH",
      body: approve ? undefined : { reason: note },
    });
  }
  throw new Error("Tipo de aprovação desconhecido.");
}

/**
 * Decide vários itens, um de cada vez (cada rota valida o seu). Devolve
 * `{ ok: [...], failed: [{ item, message }] }` e nunca pára a meio.
 */
export async function decideMany(items, decision, reason, onProgress) {
  const ok = [];
  const failed = [];
  for (let i = 0; i < items.length; i += 1) {
    onProgress?.(i, items.length);
    try {
      await decideApproval(items[i], decision, reason);
      ok.push(items[i]);
    } catch (error) {
      failed.push({ item: items[i], message: error?.data?.message || error.message || "Erro" });
    }
  }
  if (ok.length) changed();
  return { ok, failed };
}

// ── Modal ───────────────────────────────────────────────────────────────────

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .ap-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px}
    .ap-modal{background:#fff;border-radius:18px;max-width:760px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.3);overflow:hidden;color:#0f172a;font-size:14px}
    .ap-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px;background:#0f172a;color:#fff}
    .ap-head h2{font-size:17px;font-weight:700;margin:0}
    .ap-head p{font-size:12px;color:#cbd5e1;margin:4px 0 0}
    .ap-x{margin-left:auto;background:none;border:0;color:#fff;cursor:pointer;padding:4px}
    .ap-body{padding:12px 20px 16px;overflow:auto;flex:1;min-height:0}
    .ap-group{margin:10px 0 4px;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.04em}
    .ap-group label{display:flex;align-items:center;gap:8px;cursor:pointer}
    .ap-item{display:flex;gap:10px;align-items:flex-start;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin:0 0 8px}
    .ap-item.blocked{background:#f8fafc}
    .ap-item.done{opacity:.55}
    .ap-item input{margin-top:3px;width:16px;height:16px;flex:none}
    .ap-main{flex:1;min-width:0}
    .ap-title{font-weight:700;margin:0;line-height:1.3;overflow-wrap:anywhere}
    .ap-sub{margin:2px 0 0;color:#64748b;font-size:12px;overflow-wrap:anywhere}
    .ap-side{text-align:right;flex:none;max-width:40%}
    .ap-amount{font-weight:700;white-space:nowrap}
    .ap-chip{display:inline-block;font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;background:#f1f5f9;color:#475569;margin:4px 4px 0 0}
    .ap-chip.warn{background:#fef3c7;color:#92400e}
    .ap-chip.hot{background:#fee2e2;color:#b91c1c}
    .ap-chip.ok{background:#dcfce7;color:#166534}
    .ap-chip.err{background:#fee2e2;color:#b91c1c}
    .ap-link{font-size:12px;font-weight:600;color:#0d3fd1;text-decoration:none}
    .ap-foot{border-top:1px solid #e2e8f0;padding:12px 20px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    .ap-sum{flex:1;min-width:180px;font-size:12px;color:#475569}
    .ap-btn{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;border-radius:10px;padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer}
    .ap-btn.primary{background:#059669;border-color:#059669;color:#fff}
    .ap-btn.danger{color:#b91c1c;border-color:#fecaca}
    .ap-btn[disabled]{opacity:.45;cursor:default}
    .ap-empty{color:#64748b;text-align:center;padding:28px 8px}
    .ap-confirm{border:1px solid #e2e8f0;background:#f8fafc;border-radius:12px;padding:12px;margin:8px 0 0;width:100%}
    .ap-confirm p{margin:0 0 8px;font-size:13px;line-height:1.45}
    .ap-confirm textarea{width:100%;min-height:60px;border:1px solid #cbd5e1;border-radius:10px;padding:8px;font:inherit;font-size:13px;box-sizing:border-box}
    @media (max-width:560px){.ap-item{flex-wrap:wrap}.ap-side{max-width:none;text-align:left;width:100%;padding-left:26px}}
  `;
  document.head.appendChild(style);
}

function itemHtml(i, st) {
  const res = st.results.get(i.id);
  const blocked = Boolean(i.blocker);
  const checked = st.selected.has(i.id);
  const project = i.project ? [i.project.code, i.project.name].filter(Boolean).join(" · ") : "";
  return `<div class="ap-item${blocked ? " blocked" : ""}${res?.ok ? " done" : ""}">
    <input type="checkbox" data-ap-pick="${esc(i.id)}" ${checked ? "checked" : ""} ${blocked || res?.ok ? "disabled" : ""} aria-label="Selecionar ${esc(i.title)}">
    <div class="ap-main">
      <p class="ap-title">${esc(i.title)}</p>
      ${i.subtitle ? `<p class="ap-sub">${esc(i.subtitle)}</p>` : ""}
      <div>
        ${project ? `<span class="ap-chip">${esc(project)}</span>` : ""}
        ${i.requestedBy ? `<span class="ap-chip">${esc(i.requestedBy)}</span>` : ""}
        ${i.priority ? `<span class="ap-chip hot">${i.priority === "URGENTE" ? "Urgente" : "Prioridade alta"}</span>` : ""}
        ${blocked ? `<span class="ap-chip warn">${esc(i.blocker)}</span>` : ""}
        ${res?.ok ? `<span class="ap-chip ok">${res.decision === "reject" ? "Rejeitado" : "Aprovado"}</span>` : ""}
        ${res && !res.ok ? `<span class="ap-chip err">${esc(res.message)}</span>` : ""}
      </div>
    </div>
    <div class="ap-side">
      ${i.amount ? `<div class="ap-amount">${esc(money(i.amount, i.currency))}</div>` : ""}
      ${i.href ? `<a class="ap-link" href="${esc(i.href)}">Abrir</a>` : ""}
    </div>
  </div>`;
}

function render(overlay, st) {
  const body = overlay.querySelector(".ap-body");
  const foot = overlay.querySelector(".ap-foot");
  if (st.loading) {
    body.innerHTML = '<p class="ap-empty">A carregar…</p>';
    foot.innerHTML = "";
    return;
  }
  if (st.error) {
    body.innerHTML = `<p class="ap-empty">${esc(st.error)}</p>`;
    foot.innerHTML = "";
    return;
  }
  const items = st.items;
  if (!items.length) {
    body.innerHTML = `<p class="ap-empty">${st.ids?.length ? "Estas aprovações já foram decididas." : "Não há aprovações à sua espera."}</p>`;
    foot.innerHTML = "";
    return;
  }
  body.innerHTML = KIND_ORDER.filter((k) => items.some((i) => i.kind === k))
    .map((k) => {
      const list = items.filter((i) => i.kind === k);
      const pickable = list.filter((i) => !i.blocker && !st.results.get(i.id)?.ok);
      const all = pickable.length && pickable.every((i) => st.selected.has(i.id));
      return `<div class="ap-group"><label><input type="checkbox" data-ap-all="${k}" ${all ? "checked" : ""} ${pickable.length ? "" : "disabled"}>
          ${esc(KIND_TITLE[k])} (${list.length})</label></div>
        ${list.map((i) => itemHtml(i, st)).join("")}`;
    })
    .join("");

  const chosen = items.filter((i) => st.selected.has(i.id));
  const canReject = chosen.length && chosen.every((i) => i.canReject);
  const sum = chosen.length
    ? `${chosen.length} selecionad${chosen.length > 1 ? "as" : "a"}${totalsText(chosen) ? ` · ${totalsText(chosen)}` : ""}`
    : "Selecione os itens a decidir.";

  if (st.confirm) {
    const n = chosen.length;
    const approve = st.confirm === "approve";
    const kinds = [...new Set(chosen.map((i) => i.kind))];
    foot.innerHTML = `<div class="ap-confirm">
      <p><strong>${approve ? "Aprovar" : "Rejeitar"} ${n} ite${n > 1 ? "ns" : "m"}${totalsText(chosen) ? ` (${esc(totalsText(chosen))})` : ""}?</strong>
      ${approve ? kinds.map((k) => `<br>${esc(KIND_TITLE[k])}: ${esc(KIND_EFFECT[k])}.`).join("") : "<br>Quem pediu fica a saber que foi rejeitado."}</p>
      ${approve ? "" : '<textarea data-ap-reason placeholder="Motivo (fica registado em todos os itens rejeitados)"></textarea>'}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap">
        <span class="ap-sum" data-ap-progress></span>
        <button type="button" class="ap-btn" data-ap-cancel>Voltar</button>
        <button type="button" class="ap-btn ${approve ? "primary" : "danger"}" data-ap-go>${approve ? "Confirmar aprovação" : "Confirmar rejeição"}</button>
      </div></div>`;
    return;
  }
  foot.innerHTML = `<span class="ap-sum">${esc(sum)}</span>
    <button type="button" class="ap-btn danger" data-ap-reject ${canReject ? "" : "disabled"} title="${chosen.length && !canReject ? "Há itens que não se rejeitam aqui" : ""}">Rejeitar</button>
    <button type="button" class="ap-btn primary" data-ap-approve ${chosen.length ? "" : "disabled"}>Aprovar selecionadas</button>`;
}

function close(overlay) {
  overlay.remove();
  document.removeEventListener("keydown", overlay._onKey);
}

/**
 * Abre o modal de aprovações. Com `ids`, mostra só esses itens (vindos de
 * uma notificação) e deixa-os já selecionados.
 */
export async function openApprovals({ ids = [] } = {}) {
  injectStyles();
  const st = { loading: true, error: "", items: [], ids, selected: new Set(), results: new Map(), confirm: null, busy: false };
  const overlay = document.createElement("div");
  overlay.className = "ap-overlay";
  overlay.innerHTML = `<div class="ap-modal" role="dialog" aria-modal="true" aria-label="Aprovações pendentes">
    <div class="ap-head"><div><h2>Aprovações pendentes</h2><p>Selecione vários itens e decida de uma vez. Cada item passa pelas mesmas regras de quando é aprovado no próprio ecrã.</p></div>
    <button type="button" class="ap-x" aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="ap-body"></div><div class="ap-foot"></div></div>`;

  const load = async () => {
    st.loading = true;
    render(overlay, st);
    try {
      const data = await fetchPendingApprovals({ force: true });
      st.items = ids.length ? data.items.filter((i) => ids.includes(i.id)) : data.items;
      if (ids.length) st.items.filter((i) => !i.blocker).forEach((i) => st.selected.add(i.id));
      st.error = "";
    } catch (error) {
      st.error = error.message || "Não foi possível carregar as aprovações.";
    }
    st.loading = false;
    render(overlay, st);
  };

  overlay.addEventListener("change", (e) => {
    const pick = e.target.closest("[data-ap-pick]");
    const all = e.target.closest("[data-ap-all]");
    if (pick) {
      if (pick.checked) st.selected.add(pick.dataset.apPick);
      else st.selected.delete(pick.dataset.apPick);
    } else if (all) {
      st.items
        .filter((i) => i.kind === all.dataset.apAll && !i.blocker && !st.results.get(i.id)?.ok)
        .forEach((i) => (all.checked ? st.selected.add(i.id) : st.selected.delete(i.id)));
    } else return;
    render(overlay, st);
  });

  overlay.addEventListener("click", async (e) => {
    if (st.busy) return;
    if (e.target === overlay || e.target.closest(".ap-x")) return close(overlay);
    if (e.target.closest("[data-ap-approve]")) st.confirm = "approve";
    else if (e.target.closest("[data-ap-reject]")) st.confirm = "reject";
    else if (e.target.closest("[data-ap-cancel]")) st.confirm = null;
    else if (e.target.closest("[data-ap-go]")) {
      const decision = st.confirm;
      const reason = overlay.querySelector("[data-ap-reason]")?.value || "";
      const chosen = st.items.filter((i) => st.selected.has(i.id));
      st.busy = true;
      overlay.querySelectorAll(".ap-foot button").forEach((b) => (b.disabled = true));
      const progress = overlay.querySelector("[data-ap-progress]");
      const { ok, failed } = await decideMany(chosen, decision, reason, (i, n) => {
        if (progress) progress.textContent = `A tratar ${i + 1} de ${n}…`;
      });
      ok.forEach((i) => {
        st.results.set(i.id, { ok: true, decision });
        st.selected.delete(i.id);
      });
      failed.forEach(({ item, message }) => st.results.set(item.id, { ok: false, message }));
      st.busy = false;
      st.confirm = null;
      render(overlay, st);
      const { toast } = await import("./ui.js");
      if (ok.length) toast(`${ok.length} ite${ok.length > 1 ? "ns" : "m"} ${decision === "reject" ? "rejeitado" : "aprovado"}${ok.length > 1 ? "s" : ""}.`, { type: "success" });
      if (failed.length) toast(`${failed.length} não foram tratados — veja o motivo em cada um.`, { type: "error", timeoutMs: 6000 });
      return;
    } else return;
    render(overlay, st);
  });

  overlay._onKey = (e) => e.key === "Escape" && !st.busy && close(overlay);
  document.addEventListener("keydown", overlay._onKey);
  document.body.appendChild(overlay);
  await load();
}
