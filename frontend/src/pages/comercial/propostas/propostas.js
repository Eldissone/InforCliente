/**
 * Propostas (Comercial › 19).
 *
 * Sem `?id=` é o registo de propostas; com `?id=` é a proposta aberta.
 * A proposta guarda a fotografia dos totais do orçamento: se o orçamento mudar
 * depois, a proposta que foi ao cliente não muda sozinha.
 *
 * Enviar ao cliente exige `comercial:approve`.
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";
import { initComercialPage, canEdit, canApprove } from "/shared/comercial/page.js";

const el = (id) => document.getElementById(id);
const esc = (v) => escapeHtml(String(v ?? ""));
const qs = new URLSearchParams(window.location.search);

const S = {
  id: qs.get("id"),
  items: [],
  counts: {},
  status: "",
  q: "",
  prop: null,
  terms: null,
  dirty: false,
  readonly: false,
  canApprove: false,
};

const STATUS = {
  RASCUNHO: ["", "Rascunho"],
  ENVIADA: ["is-warn", "Enviada"],
  ACEITE: ["is-good", "Aceite"],
  RECUSADA: ["is-bad", "Recusada"],
};

const MODE_LABELS = {
  amort: "Adiantamento diluído nos autos",
  inicial: "Adiantamento inicial, restante em autos",
  autos: "Só autos de medição",
  marcos: "Pagamentos por marcos",
};

const fmt = (v, d = 0) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(d)}%`);
const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—");

// ───────────────────────── registo ─────────────────────────

async function loadList() {
  const p = new URLSearchParams();
  if (S.q) p.set("q", S.q);
  if (S.status) p.set("status", S.status);
  const data = await apiRequest(`/proposals${p.toString() ? `?${p}` : ""}`);
  S.items = data.items || [];
  S.counts = data.counts || {};
}

function renderList() {
  const total = Object.values(S.counts).reduce((a, b) => a + b, 0);
  const chip = (k, l) =>
    `<button type="button" class="cm-chip${S.status === k ? " is-on" : ""}" data-status="${k}">
      <span>${esc(l)}</span><b>${k ? S.counts[k] || 0 : total}</b></button>`;

  el("cmHeadActions").innerHTML = `
    <input id="pqSearch" class="cell-list" style="min-width:250px" type="search"
           placeholder="Procurar por proposta, orçamento, obra ou cliente…" value="${esc(S.q)}" aria-label="Procurar propostas">
    <a class="cm-chip" href="/comercial/despacho">Gerar a partir de um orçamento</a>`;

  el("cmContent").innerHTML = `
    <div class="cm-chips">${chip("", "Todas")}${Object.entries(STATUS).map(([k, v]) => chip(k, v[1])).join("")}</div>
    <div class="cm-table-wrap"><table class="cm-table">
      <thead><tr><th>Proposta</th><th>Orçamento</th><th>Cliente</th><th>Obra</th>
        <th class="num">Valor s/ IVA</th><th>Validade</th><th>Enviada</th><th>Estado</th><th></th></tr></thead>
      <tbody>${
        S.items.length
          ? S.items
              .map((p) => {
                const [cls, label] = STATUS[p.status] || ["", p.status];
                const expired = p.status === "ENVIADA" && p.validUntil && p.validUntil < new Date().toISOString().slice(0, 10);
                return `<tr>
                  <td><a href="/comercial/propostas?id=${esc(p.id)}"><b>${esc(p.number)}</b></a></td>
                  <td>${esc(p.budget ? `${p.budget.number} ${p.budget.revision}` : "—")}</td>
                  <td>${esc(p.budget?.client ? p.budget.client.name : "—")}</td>
                  <td style="min-width:13rem">${esc(p.budget ? p.budget.projectName : "—")}</td>
                  <td class="num">${fmt(p.totalExVat)}</td>
                  <td>${fmtDate(p.validUntil)}${expired ? ` <span class="cm-pill is-bad">caducada</span>` : ""}</td>
                  <td>${fmtDate(p.sentAt)}</td>
                  <td><span class="cm-pill ${cls}">${esc(label)}</span></td>
                  <td><a class="cm-chip" href="/comercial/propostas?id=${esc(p.id)}">Abrir</a></td>
                </tr>`;
              })
              .join("")
          : `<tr><td colspan="9" style="padding:1.25rem;color:var(--cm-muted)">
               ${S.q || S.status ? "Nenhuma proposta corresponde ao filtro." : "Ainda não há propostas."}
               A proposta nasce de um orçamento com a folha de despacho aprovada —
               <a href="/comercial/despacho">ver as folhas de despacho ›</a>
             </td></tr>`
      }</tbody>
    </table></div>`;
}

// ───────────────────────── proposta aberta ─────────────────────────

async function loadOne() {
  S.prop = await apiRequest(`/proposals/${S.id}`);
  S.terms = S.prop.paymentTerms || {};
  S.dirty = false;
}

function render() {
  const p = S.prop;
  const [cls, label] = STATUS[p.status] || ["", p.status];
  const editable = !S.readonly && !["ACEITE", "RECUSADA"].includes(p.status);
  const dis = editable ? "" : "disabled";
  const sched = p.schedule || { rows: [], totals: {}, retention: {} };

  el("cmHeadActions").innerHTML = `
    <a class="cm-chip" href="/comercial/propostas">‹ Todas as propostas</a>
    ${p.budget ? `<a class="cm-chip" href="/comercial/orcamento?id=${esc(p.budget.id)}">Abrir o orçamento</a>` : ""}
    ${editable ? `<button class="cm-chip${S.dirty ? " is-on" : ""}" type="button" id="pSave">${S.dirty ? "Guardar" : "Guardado"}</button>` : ""}
    <button class="cm-chip" type="button" id="pPrint">Imprimir / PDF</button>`;

  const area = (k, l, rows = 3, help = "") => `
    <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
      <span>${esc(l)}</span>
      <textarea class="cell-manual" rows="${rows}" data-body="${k}" ${dis}>${esc((p.body || {})[k])}</textarea>
      ${help ? `<small>${esc(help)}</small>` : ""}
    </label>`;

  el("cmContent").innerHTML = `
    <section class="cm-panel">
      <div class="cm-head" style="margin-bottom:.5rem">
        <div>
          <div class="cm-head-num">${esc(p.number)}</div>
          <h2 class="cm-panel-title" style="font-size:1.0625rem">${esc(p.budget ? p.budget.projectName : "Proposta")}</h2>
          <p class="cm-lead" style="margin-top:.25rem">
            ${esc(p.budget?.client ? p.budget.client.name : "sem cliente")} ·
            orçamento ${esc(p.budget ? `${p.budget.number} ${p.budget.revision}` : "—")}
          </p>
        </div>
        <div class="cm-head-actions"><span class="cm-pill ${cls}">${esc(label)}</span></div>
      </div>
      <div class="cm-bh-kpis">
        <div><span>Valor s/ IVA</span><b>${fmt(p.totalExVat)}</b><small>${esc(p.currency)}</small></div>
        <div><span>IVA (${pct(p.vatRate, 0)})</span><b>${fmt((Number(p.totalInVat) || 0) - (Number(p.totalExVat) || 0))}</b><small>${esc(p.currency)}</small></div>
        <div><span>Valor c/ IVA</span><b>${fmt(p.totalInVat)}</b><small>${esc(p.currency)}</small></div>
      </div>
      ${
        p.sentAt
          ? `<p class="cm-lead" style="margin-top:.75rem">Enviada em ${fmtDate(p.sentAt)}${p.sentBy ? ` por ${esc(p.sentBy)}` : ""}.
             ${p.decidedAt ? ` Decisão do cliente em ${fmtDate(p.decidedAt)}: <b>${esc(label)}</b>.` : ""}
             ${p.decisionNotes ? ` «${esc(p.decisionNotes)}»` : ""}</p>`
          : ""
      }
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">Texto da proposta</h3>
      <p class="cm-panel-sub">É isto que o cliente lê. Os valores vêm do orçamento e não se escrevem aqui.</p>
      <div style="display:grid;gap:.75rem">
        ${area("objeto", "Objeto", 2)}
        ${area("prazo", "Prazo de execução", 2)}
        ${area("condicoesPagamento", "Condições de pagamento", 3, "Preenchidas a partir das condições abaixo; pode reescrever.")}
        ${area("garantia", "Garantia", 2)}
        ${area("validade", "Validade", 2)}
        ${area("exclusoes", "Exclusões", 3)}
        ${area("notas", "Notas", 2)}
        <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted);max-width:16rem">
          <span>Válida até</span>
          <input class="cell-manual" type="date" id="pValid" value="${esc(p.validUntil || "")}" ${dis}>
        </label>
      </div>
    </section>

    ${renderTerms(editable)}

    <section class="cm-panel">
      <h3 class="cm-panel-title">Calendário de recebimentos</h3>
      <p class="cm-panel-sub">
        ${esc(p.termsDescription || "")}
      </p>
      <div class="cm-note is-warn">
        Estimativa com <b>progresso linear</b> ao longo da obra. A curva real depende do
        planeamento de produção; os marcos, esses, são exatos.
      </div>
      <div class="cm-table-wrap"><table class="cm-table">
        <thead><tr><th class="num">#</th><th>Recebimento</th><th>Data</th>
          <th class="num">Bruto</th><th class="num">Amortiza</th><th class="num">Retenção</th><th class="num">Líquido</th>
          <th>Aprovação</th><th>Recebe em</th></tr></thead>
        <tbody>${
          sched.rows.length
            ? sched.rows
                .map(
                  (r) => `<tr>
                    <td class="num cm-calc">${r.n}</td>
                    <td>${esc(r.desc)}</td>
                    <td>${fmtDate(r.date)}</td>
                    <td class="num">${fmt(r.gross)}</td>
                    <td class="num">${r.amortised ? fmt(r.amortised) : "—"}</td>
                    <td class="num">${r.retained ? fmt(r.retained) : "—"}</td>
                    <td class="num"><b>${fmt(r.net)}</b></td>
                    <td>${fmtDate(r.approvalDate)}</td>
                    <td>${fmtDate(r.receiptDate)}</td>
                  </tr>`
                )
                .join("") +
              `<tr class="cm-total"><td></td><td>Total</td><td></td>
                <td class="num">${fmt(sched.totals.gross)}</td>
                <td class="num">${fmt(sched.totals.amortised)}</td>
                <td class="num">${fmt(sched.totals.retained)}</td>
                <td class="num">${fmt(sched.totals.net)}</td><td></td><td></td></tr>`
            : `<tr><td colspan="9" style="padding:1rem;color:var(--cm-muted)">
                 Sem datas de início e conclusão no orçamento não há calendário.
               </td></tr>`
        }</tbody>
      </table></div>
      ${
        sched.retention?.value
          ? `<p class="cm-lead" style="margin-top:.75rem">
               Retenção de garantia: <b>${fmt(sched.retention.value)}</b> (${pct(sched.retention.pct)}),
               libertada em ${fmtDate(sched.retention.releaseDate)} — ${sched.retention.years} ano(s) depois da conclusão.
             </p>`
          : ""
      }
      ${(sched.warnings || []).map((w) => `<div class="cm-note is-warn" style="margin-top:.5rem">${esc(w)}</div>`).join("")}
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">Decisão</h3>
      <div class="cm-flow">
        <span class="cm-flow-step is-done"><b>1</b> Rascunho</span><span class="cm-flow-sep">›</span>
        <span class="cm-flow-step ${p.status === "RASCUNHO" ? "is-current" : "is-done"}"><b>2</b> Enviada ao cliente</span><span class="cm-flow-sep">›</span>
        <span class="cm-flow-step ${["ACEITE", "RECUSADA"].includes(p.status) ? "is-done" : ""}"><b>3</b> Decisão do cliente</span>
      </div>
      <div class="cm-head-actions">
        ${
          p.status === "RASCUNHO"
            ? S.canApprove
              ? `<button class="cm-chip is-on" type="button" id="pSend">Enviar ao cliente</button>`
              : `<span class="cm-lead" style="margin:0">Não tem permissão para enviar a proposta. Quem aprova no módulo Comercial é que a envia.</span>`
            : ""
        }
        ${
          p.status === "ENVIADA" && !S.readonly
            ? `<button class="cm-chip is-on" type="button" data-dec="ACEITE">Cliente aceitou</button>
               <button class="cm-chip" type="button" data-dec="RECUSADA">Cliente recusou</button>`
            : ""
        }
        ${
          p.status === "ACEITE" && p.budget && !p.budget.locked
            ? `<a class="cm-chip is-on" href="/comercial/despacho?id=${esc(p.budget.id)}">Adjudicar na folha de despacho ›</a>`
            : ""
        }
        ${p.budget?.locked ? `<span class="cm-pill is-good">Orçamento adjudicado</span>` : ""}
      </div>
      <span id="pMsg" class="cm-lead" style="margin:.5rem 0 0;display:block"></span>
    </section>`;
}

function renderTerms(editable) {
  const t = S.terms || {};
  const dis = editable ? "" : "disabled";
  const isMarcos = t.modo === "marcos";
  const f = (k, l, ty = "num", help = "") => {
    const v = t[k];
    const input =
      ty === "pct"
        ? `<div style="display:flex;align-items:center;gap:.25rem">
             <input class="cell-manual" type="number" step="any" data-term="${k}" data-pct="1"
               value="${v === null || v === undefined || v === "" ? "" : Number((Number(v) * 100).toFixed(6))}" ${dis}>
             <span class="cm-calc">%</span></div>`
        : ty === "date"
          ? `<input class="cell-manual" type="date" data-term="${k}" value="${esc(v ? String(v).slice(0, 10) : "")}" ${dis}>`
          : `<input class="cell-manual" type="number" step="any" data-term="${k}" value="${v ?? ""}" ${dis}>`;
    return `<label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
      <span>${esc(l)}</span>${input}${help ? `<small>${esc(help)}</small>` : ""}</label>`;
  };

  return `
    <section class="cm-panel">
      <h3 class="cm-panel-title">Condições de pagamento</h3>
      <p class="cm-panel-sub">Como o cliente paga esta obra. Mudar aqui refaz o calendário abaixo.</p>
      <div style="display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))">
        <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted);grid-column:span 2">
          <span>Modo</span>
          <select class="cell-list" data-term="modo" ${dis}>
            ${Object.entries(MODE_LABELS)
              .map(([k, l]) => `<option value="${k}"${t.modo === k ? " selected" : ""}>${esc(l)}</option>`)
              .join("")}
          </select>
        </label>
        ${isMarcos ? "" : f("adPct", "Adiantamento", "pct", "Em percentagem do preço de venda.")}
        ${isMarcos || t.modo === "autos" ? "" : f("amort", "Amortização por auto", "pct", "Vazio = proporcional ao adiantamento.")}
        ${isMarcos ? "" : periodField(t, dis)}
        ${f("aprov", "Dias até à aprovação do auto")}
        ${f("pag", "Dias de pagamento depois da aprovação")}
        ${f("ret", "Retenção de garantia", "pct")}
        ${f("retAnos", "Durante quantos anos")}
        ${isMarcos ? f("matData", "Data prevista de entrega do material", "date") : ""}
      </div>

      ${isMarcos ? renderMilestones(t, editable) : ""}
    </section>`;
}

function periodField(t, dis) {
  return `<label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
    <span>Periodicidade dos autos</span>
    <select class="cell-list" data-term="per" ${dis}>
      ${["Mensal", "Quinzenal", "Semanal"].map((x) => `<option${t.per === x ? " selected" : ""}>${x}</option>`).join("")}
    </select></label>`;
}

function renderMilestones(t, editable) {
  const rows = t.marcos || [];
  const total = rows.reduce((s, m) => s + (Number(m.pct) || 0), 0);
  const ok = Math.abs(total - 1) < 1e-6;
  const dis = editable ? "" : "disabled";
  const EV = [
    ["adj", "Na adjudicação / assinatura"],
    ["mat", "Com a entrega do material"],
    ["pct", "Ao atingir uma % de execução"],
    ["fim", "Na conclusão da obra"],
    ["data", "Numa data"],
  ];

  return `
    <h4 class="cm-panel-title" style="font-size:.875rem;margin:1rem 0 .5rem">Marcos de pagamento</h4>
    <div class="cm-table-wrap"><table class="cm-table">
      <thead><tr><th>Marco</th><th class="num">%</th><th class="num">Valor s/ IVA</th><th>Quando</th><th>Data / % execução</th>${editable ? "<th></th>" : ""}</tr></thead>
      <tbody>${rows
        .map(
          (m, i) => `<tr>
            <td><input class="cell-manual" style="min-width:12rem" data-mil="${i}|desc" value="${esc(m.desc)}" ${dis}></td>
            <td class="num"><input class="cell-manual" type="number" step="any" data-mil="${i}|pct" data-pct="1"
              value="${m.pct === null || m.pct === undefined ? "" : Number((Number(m.pct) * 100).toFixed(6))}" ${dis}></td>
            <td class="num"><span class="cell-auto">${fmt((Number(S.prop.totalExVat) || 0) * (Number(m.pct) || 0))}</span></td>
            <td><select class="cell-list" data-mil="${i}|ev" ${dis}>
              ${EV.map(([k, l]) => `<option value="${k}"${m.ev === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
            </select></td>
            <td>${
              m.ev === "data"
                ? `<input class="cell-manual" type="date" data-mil="${i}|data" value="${esc(m.data || "")}" ${dis}>`
                : m.ev === "pct"
                  ? `<input class="cell-manual" type="number" step="any" data-mil="${i}|exec" data-pct="1"
                       value="${m.exec === null || m.exec === undefined ? "" : Number((Number(m.exec) * 100).toFixed(6))}" ${dis}>`
                  : `<span class="cm-calc">automático</span>`
            }</td>
            ${editable ? `<td><button class="cm-chip" type="button" data-milx="del|${i}">×</button></td>` : ""}
          </tr>`
        )
        .join("")}
        <tr class="cm-total">
          <td>Total</td>
          <td class="num"><b${ok ? "" : ' class="cm-neg"'}>${pct(total)}</b></td>
          <td class="num">${fmt((Number(S.prop.totalExVat) || 0) * total)}</td>
          <td colspan="${editable ? 3 : 2}">${ok ? "" : `<span class="cm-pill is-bad">os marcos têm de somar 100%</span>`}</td>
        </tr>
      </tbody>
    </table></div>
    ${editable ? `<button class="cm-chip" type="button" data-milx="add" style="margin-top:.625rem">+ Marco</button>` : ""}`;
}

// ───────────────────────── edição ─────────────────────────

function markDirty() {
  S.dirty = true;
  const b = el("pSave");
  if (b) {
    b.classList.add("is-on");
    b.textContent = "Guardar";
  }
}

function wire() {
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset?.body) {
      S.prop.body = { ...(S.prop.body || {}), [t.dataset.body]: t.value };
      return markDirty();
    }
    if (t.id === "pValid") {
      S.prop.validUntil = t.value || null;
      return markDirty();
    }
    if (t.dataset?.term) {
      let v = t.value;
      if (t.dataset.pct) v = v === "" ? null : Number(v) / 100;
      else if (t.type === "number") v = v === "" ? null : Number(v);
      else if (v === "") v = null;
      S.terms = { ...S.terms, [t.dataset.term]: v };
      return markDirty();
    }
    if (t.dataset?.mil) {
      const [i, k] = t.dataset.mil.split("|");
      let v = t.value;
      if (t.dataset.pct) v = v === "" ? null : Number(v) / 100;
      S.terms.marcos[Number(i)][k] = v || (k === "desc" ? "" : null);
      markDirty();
      if (k === "pct") render();
      return;
    }
    if (t.id === "pqSearch") {
      S.q = t.value;
      clearTimeout(wire._t);
      wire._t = setTimeout(async () => {
        await loadList();
        renderList();
        const again = el("pqSearch");
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      }, 300);
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset?.term) {
      S.terms = { ...S.terms, [t.dataset.term]: t.value };
      markDirty();
      render();
      return;
    }
    if (t.dataset?.mil) {
      const [i, k] = t.dataset.mil.split("|");
      S.terms.marcos[Number(i)][k] = t.value;
      markDirty();
      render();
    }
  });

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-status],[data-dec],[data-milx],#pSave,#pSend,#pPrint");
    if (!t) return;
    if (t.dataset.status !== undefined) {
      S.status = t.dataset.status;
      await loadList();
      renderList();
      return;
    }
    if (t.dataset.milx) {
      const [a, i] = t.dataset.milx.split("|");
      if (a === "add") S.terms.marcos.push({ desc: "Novo marco", pct: null, ev: "data", data: null });
      else S.terms.marcos.splice(Number(i), 1);
      markDirty();
      render();
      return;
    }
    if (t.id === "pSave") return save();
    if (t.id === "pSend") return send();
    if (t.id === "pPrint") return window.print();
    if (t.dataset.dec) return decide(t.dataset.dec);
  });

  window.addEventListener("beforeunload", (e) => {
    if (S.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

async function save() {
  const msg = el("pMsg");
  try {
    S.prop = await apiRequest(`/proposals/${S.id}`, {
      method: "PATCH",
      body: { body: S.prop.body, validUntil: S.prop.validUntil, paymentTerms: S.terms },
    });
    S.terms = S.prop.paymentTerms;
    S.dirty = false;
    render();
    toast("Proposta guardada.", { type: "success" });
  } catch (err) {
    const p = err?.payload;
    if (msg) msg.textContent = p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível guardar.";
    else toast(err?.message || "Não foi possível guardar.", { type: "error" });
  }
}

async function send() {
  const msg = el("pMsg");
  if (!window.confirm("Marcar a proposta como enviada ao cliente? Depois disto o texto já não se altera.")) return;
  msg.textContent = "A registar o envio…";
  try {
    if (S.dirty) await save();
    S.prop = await apiRequest(`/proposals/${S.id}/send`, { method: "POST", body: {} });
    S.terms = S.prop.paymentTerms;
    render();
    toast("Proposta marcada como enviada.", { type: "success" });
  } catch (err) {
    const p = err?.payload;
    msg.textContent = p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível enviar.";
  }
}

async function decide(status) {
  const msg = el("pMsg");
  const notes = window.prompt(
    status === "ACEITE" ? "Notas da aceitação (opcional):" : "Motivo da recusa (opcional):",
    ""
  );
  if (notes === null) return;
  msg.textContent = "A registar a decisão…";
  try {
    S.prop = await apiRequest(`/proposals/${S.id}/decision`, { method: "POST", body: { status, notes: notes || null } });
    S.terms = S.prop.paymentTerms;
    render();
    toast(status === "ACEITE" ? "Aceitação registada. Pode adjudicar." : "Recusa registada.", { type: "success" });
  } catch (err) {
    const p = err?.payload;
    msg.textContent = p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível registar a decisão.";
  }
}

// ───────────────────────── arranque ─────────────────────────

initComercialPage({
  perm: "tab_propostas",
  onReady: async () => {
    S.readonly = !canEdit();
    S.canApprove = canApprove();
    el("cmContent").innerHTML = `<p class="cm-lead">A carregar…</p>`;
    try {
      wire();
      if (S.id) {
        await loadOne();
        render();
      } else {
        await loadList();
        renderList();
      }
    } catch (err) {
      el("cmContent").innerHTML = `<div class="cm-note is-bad">Não foi possível carregar: ${esc(
        err?.message || err
      )} <a href="/comercial/propostas">Voltar ao registo ›</a></div>`;
    }
  },
});
