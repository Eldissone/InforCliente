/**
 * Folha de despacho (Comercial › 18).
 *
 * É aqui que se decide a margem de cada categoria e se aprova o preço de venda.
 * Sem `?id=` mostra a lista de orçamentos à espera de decisão; com `?id=` mostra
 * a folha do orçamento.
 *
 * Aprovar exige `comercial:approve`. Quem não tem essa permissão pode preparar a
 * folha e deixá-la «em análise».
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";
import { initComercialPage, canEdit, canApprove, canAward } from "/shared/comercial/page.js";
import { calcBudget, CATS } from "/shared/comercial/budgetCalc.js";

const el = (id) => document.getElementById(id);
const esc = (v) => escapeHtml(String(v ?? ""));
const qs = new URLSearchParams(window.location.search);

const S = {
  id: qs.get("id"),
  head: null,
  doc: null,
  R: null,
  dirty: false,
  readonly: false,
  canApprove: false,
  canAward: false,
  awardCheck: null,
};

const DECISIONS = ["Em análise", "Aprovado", "Aprovado com alterações", "Não aprovado"];

const fmt = (v, d = 0) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(d)}%`);
const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—");

const MARGIN_STATE = {
  SEM_CUSTO: ["is-muted", "Falta lançar o custo"],
  OBJETIVO_ATINGIDO: ["is-good", "Objetivo atingido"],
  ENTRE_MINIMO_E_OBJETIVO: ["is-warn", "Entre o mínimo e o objetivo"],
  ABAIXO_DO_MINIMO: ["is-bad", "Abaixo do mínimo"],
  MARGEM_NEGATIVA: ["is-bad", "Margem negativa"],
};

const STATUS_LABELS = {
  EM_ELABORACAO: "Em elaboração",
  EM_ANALISE: "Em análise",
  APROVADO: "Aprovado",
  PROPOSTA_ENVIADA: "Proposta enviada",
  ADJUDICADO: "Adjudicado",
  PERDIDO: "Perdido",
  CANCELADO: "Cancelado",
};

// ───────────────────────── carregamento ─────────────────────────

async function loadPicker() {
  const data = await apiRequest("/budgets");
  return (data.items || []).filter((b) => !["CANCELADO", "PERDIDO"].includes(b.status));
}

async function loadBudget() {
  const b = await apiRequest(`/budgets/${S.id}`);
  setDoc(b);
  if (S.canAward) {
    try {
      S.awardCheck = await apiRequest(`/budgets/${S.id}/award-check`);
    } catch {
      S.awardCheck = null;
    }
  }
}

function setDoc(b) {
  S.head = b;
  S.doc = { params: b.params, sheets: b.sheets, baremSnapshot: b.baremSnapshot, lists: b.lists, dispatch: b.dispatch };
  if (!S.doc.dispatch.margens) S.doc.dispatch.margens = {};
  S.dirty = false;
  S.R = calcBudget(S.doc);
}

// ───────────────────────── seletor ─────────────────────────

async function renderPicker() {
  el("cmHeadActions").innerHTML = "";
  el("cmContent").innerHTML = `<p class="cm-lead">A carregar orçamentos…</p>`;
  const items = await loadPicker();
  el("cmContent").innerHTML = `
    <p class="cm-lead" style="margin-bottom:1rem">
      Escolha o orçamento cuja margem quer decidir. A folha de despacho mostra todos os custos,
      deixa definir a margem de cada categoria e registra a decisão.
    </p>
    <div class="cm-table-wrap"><table class="cm-table">
      <thead><tr><th>N.º</th><th>Rev.</th><th>Cliente</th><th>Obra</th>
        <th class="num">Custo total</th><th class="num">Preço s/ IVA</th><th class="num">Margem</th>
        <th>Despacho</th><th>Estado</th><th></th></tr></thead>
      <tbody>${
        items.length
          ? items
              .map((b) => {
                const d = (b.dispatch || {}).estado || "Em análise";
                return `<tr>
                  <td><b>${esc(b.number)}</b></td>
                  <td>${esc(b.revision)}</td>
                  <td>${esc(b.client ? b.client.name : "—")}</td>
                  <td style="min-width:14rem">${esc(b.projectName)}</td>
                  <td class="num">${fmt(b.totalCost)}</td>
                  <td class="num">${fmt(b.salePriceExVat)}</td>
                  <td class="num">${pct(b.grossMarginPct)}</td>
                  <td><span class="cm-pill ${d.startsWith("Aprovado") ? "is-good" : d === "Não aprovado" ? "is-bad" : "is-warn"}">${esc(d)}</span></td>
                  <td><span class="cm-pill">${esc(STATUS_LABELS[b.status] || b.status)}</span></td>
                  <td><a class="cm-chip" href="/comercial/despacho?id=${esc(b.id)}">Abrir folha</a></td>
                </tr>`;
              })
              .join("")
          : `<tr><td colspan="10" style="padding:1.25rem;color:var(--cm-muted)">
               Ainda não há orçamentos. <a href="/comercial/orcamentos">Criar o primeiro ›</a>
             </td></tr>`
      }</tbody>
    </table></div>`;
}

// ───────────────────────── folha ─────────────────────────

function render() {
  const b = S.head;
  const R = S.R;
  const D = S.doc.dispatch;
  const P = S.doc.params;
  const [cls, label] = MARGIN_STATE[R.mgEstado] || ["", R.mgEstado];
  const editable = !S.readonly && !b.locked;
  const approved = String(D.estado || "").startsWith("Aprovado");

  el("cmHeadActions").innerHTML = `
    <a class="cm-chip" href="/comercial/despacho">‹ Outros orçamentos</a>
    <a class="cm-chip" href="/comercial/orcamento?id=${esc(b.id)}">Abrir o orçamento</a>
    ${editable ? `<button class="cm-chip${S.dirty ? " is-on" : ""}" type="button" id="dSave">${S.dirty ? "Guardar margens" : "Guardado"}</button>` : ""}`;

  el("cmContent").innerHTML = `
    ${b.locked ? `<div class="cm-note is-warn">Orçamento adjudicado (obra ${esc(P.codObra || "—")}): a folha é só para consulta.</div>` : ""}

    <section class="cm-panel">
      <div style="display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))">
        ${kv("Orçamento", `<b>${esc(b.number)} · ${esc(b.revision)}</b>`)}
        ${kv("Cliente", esc(b.client ? b.client.name : "—"))}
        ${kv("Obra", esc(P.obra || b.projectName))}
        ${kv("Localização", esc(P.local || "—"))}
        ${kv("Prazo", `${fmtDate(P.inicio)} → ${fmtDate(P.fim)} (${fmt(R.durDias)} dias)`)}
        ${kv("Responsável", esc(P.respOrc || "—"))}
        ${kv("Metodologia", P.metodo === "MARKUP_SOBRE_CUSTO" ? "Markup sobre o custo" : "Margem sobre a venda")}
        ${kv("Proposta", esc(P.proposta || "— ainda não gerada"))}
      </div>
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">1. Resumo de custos e margens</h3>
      <p class="cm-panel-sub">
        Os custos vêm sozinhos de cada folha. Preencha a margem de cada categoria (célula amarela);
        o preço de venda calcula-se logo.
      </p>
      <div class="cm-legend">
        <span><i class="manual"></i>Escreve-se à mão</span>
        <span><i class="auto"></i>Calculado — não se mexe</span>
      </div>
      <div class="cm-table-wrap"><table class="cm-table">
        <thead><tr>
          <th class="num">N.º</th><th>Categoria</th><th class="num">Custo</th><th class="num">% do custo total</th>
          <th class="num">Margem</th><th class="num">Preço de venda</th><th class="num">Margem em valor</th>
          <th class="num">Margem % s/ venda</th>
        </tr></thead>
        <tbody>${R.cat
          .map((c, i) => {
            const shown = D.margens[c.k] === null || D.margens[c.k] === undefined ? "" : Number((Number(D.margens[c.k]) * 100).toFixed(6));
            return `<tr>
              <td class="num cm-calc">${i + 1}</td>
              <td><a href="/comercial/orcamento?id=${esc(b.id)}&v=${esc(CATS.find((x) => x[0] === c.k)[3])}">${esc(c.nome)}</a></td>
              <td class="num"><span class="cell-auto">${fmt(c.c)}</span></td>
              <td class="num"><span class="cell-auto">${pct(c.pct)}</span></td>
              <td class="num"><input class="cell-manual" type="number" step="any" data-mg="${c.k}" value="${shown}" ${editable ? "" : "disabled"}></td>
              <td class="num"><span class="cell-auto">${fmt(c.pv)}</span></td>
              <td class="num"><span class="cell-auto${c.mv < 0 ? " cm-neg" : ""}">${fmt(c.mv)}</span></td>
              <td class="num"><span class="cell-auto">${pct(c.mgPct)}</span></td>
            </tr>`;
          })
          .join("")}
          <tr class="cm-total">
            <td></td><td>TOTAL</td>
            <td class="num">${fmt(R.CT)}</td><td class="num">100,0%</td><td></td>
            <td class="num">${fmt(R.PVcalc)}</td><td class="num">${fmt(R.catTot.mv)}</td><td class="num">${pct(R.catTot.mgPct)}</td>
          </tr>
        </tbody>
      </table></div>
      ${
        R.precoDado
          ? `<div class="cm-note is-warn" style="margin-top:.625rem">
               O preço desta obra é o que o cliente fixou: <b>${fmt(R.PVsi)}</b>, o total do mapa de
               quantidades. As margens desta tabela <b>não o determinam</b> — servem para comparar o que
               se cobraria a montar o preço de raiz (${fmt(R.PVcalc)}) com o que está contratado.
               A margem que conta é a de baixo: preço menos custo total.
             </div>`
          : ""
      }
    </section>

    <div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(22rem,1fr))">
      <section class="cm-panel">
        <h3 class="cm-panel-title">2. Preço de venda</h3>
        <div class="cm-table-wrap"><table class="cm-table"><tbody>
          ${row("Custo direto", fmt(R.CD))}
          ${row("Indiretos, financeiros e contingência", fmt(R.C.IND + R.C.FIN + R.C.RIS))}
          ${row("CUSTO TOTAL DA OBRA", fmt(R.CT), true)}
          ${
            R.precoDado
              ? `${row("Total do mapa de quantidades", fmt(R.QT))}
                 ${row("Custo + margens, só para comparar", fmt(R.PVcalc))}`
              : row("Preço de venda calculado", fmt(R.PVcalc))
          }
          ${rowInput("Ajuste comercial / arredondamento", "ajuste", P.ajuste, editable)}
          ${row("PREÇO DE VENDA SEM IVA", fmt(R.PVsi), true)}
          ${row(`IVA (${pct(P.iva, 0)})`, fmt(R.imp))}
          ${row("PREÇO DE VENDA COM IVA", fmt(R.PVfinal), true)}
          ${row("Margem bruta (valor)", fmt(R.MB))}
          ${row("Margem bruta % s/ venda", pct(R.MBpct, 2))}
          ${row("Margem mínima / objetivo", `${pct(P.margemMin, 0)} / ${pct(P.margemObj, 0)}`)}
          <tr><td><b>Estado da margem</b></td><td class="num"><span class="cm-pill ${cls}">${esc(label)}</span></td></tr>
        </tbody></table></div>
        ${
          R.alerts.filter((a) => a.n > 0 && a.estado === "CRÍTICO").length
            ? `<div class="cm-note is-bad" style="margin-top:.75rem">
                 <b>Pontos críticos antes de aprovar:</b>
                 <ul style="margin:.5rem 0 0;padding-left:1.1rem">
                   ${R.alerts.filter((a) => a.n > 0 && a.estado === "CRÍTICO").map((a) => `<li>${esc(a.t)} — <b>${a.n}</b></li>`).join("")}
                 </ul>
                 <a href="/comercial/orcamento?id=${esc(b.id)}&v=verif">Ver a verificação dos cálculos ›</a>
               </div>`
            : ""
        }
      </section>

      <section class="cm-panel">
        <h3 class="cm-panel-title">3. Decisão</h3>
        <p class="cm-panel-sub">
          ${
            S.canApprove
              ? "Aprovar fixa a margem e deixa o orçamento pronto para proposta."
              : "Não tem permissão para aprovar. Pode preparar a folha e deixá-la em análise."
          }
        </p>
        <div style="display:grid;gap:.75rem">
          <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
            <span>Decisão</span>
            <select class="cell-list" id="dEstado" ${editable ? "" : "disabled"}>
              ${DECISIONS.map(
                (d) =>
                  `<option value="${esc(d)}"${(D.estado || "Em análise") === d ? " selected" : ""}${
                    d.startsWith("Aprovado") && !S.canApprove ? " disabled" : ""
                  }>${esc(d)}${d.startsWith("Aprovado") && !S.canApprove ? " (precisa de permissão)" : ""}</option>`
              ).join("")}
            </select>
          </label>
          <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
            <span>Preparado por</span>
            <input class="cell-manual" id="dPrep" value="${esc(D.prep || P.respOrc || "")}" ${editable ? "" : "disabled"}>
          </label>
          <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
            <span>Observações</span>
            <input class="cell-manual" id="dObs" value="${esc(D.obs || "")}" ${editable ? "" : "disabled"}>
          </label>
          ${
            D.aprov
              ? `<div class="cm-note" style="margin:0">Aprovado por <b>${esc(D.aprov)}</b> em ${fmtDate(D.data)}${
                  D.decididoCom
                    ? ` · na altura: custo ${fmt(D.decididoCom.custoTotal)}, preço ${fmt(D.decididoCom.precoSemIva)}, margem ${pct(D.decididoCom.margemPct)}`
                    : ""
                }</div>`
              : ""
          }
          ${
            approved && D.decididoCom && Math.abs(Number(D.decididoCom.precoSemIva) - R.PVsi) > 0.5
              ? `<div class="cm-note is-warn" style="margin:0">
                   O orçamento mudou desde a aprovação: o preço era ${fmt(D.decididoCom.precoSemIva)} e agora é ${fmt(R.PVsi)}.
                   Volte a aprovar para fixar o preço novo.
                 </div>`
              : ""
          }
          ${editable ? `<button class="cm-chip is-on" type="button" id="dDecide">Registar decisão</button>` : ""}
          <span id="dMsg" class="cm-lead" style="margin:0"></span>
        </div>
      </section>
    </div>

    ${renderNext()}`;
}

function kv(l, v) {
  return `<div style="display:grid;gap:.125rem;font-size:.8125rem">
    <span style="color:var(--cm-muted)">${esc(l)}</span><span>${v}</span></div>`;
}
function row(l, v, strong) {
  return `<tr><td>${strong ? `<b>${esc(l)}</b>` : esc(l)}</td><td class="num">${strong ? `<b>${v}</b>` : v}</td></tr>`;
}
function rowInput(l, key, v, editable) {
  return `<tr><td>${esc(l)}</td><td class="num">
    <input class="cell-manual" type="number" step="any" data-par="${key}" value="${v ?? ""}" ${editable ? "" : "disabled"}>
  </td></tr>`;
}

/** O que se faz a seguir: proposta e adjudicação. */
function renderNext() {
  const b = S.head;
  const D = S.doc.dispatch;
  const approved = String(D.estado || "").startsWith("Aprovado");
  if (!approved) {
    return `<section class="cm-panel">
      <h3 class="cm-panel-title">4. A seguir</h3>
      <p class="cm-panel-sub">Depois de aprovar a margem, é daqui que se gera a proposta ao cliente e, se ele aceitar, se adjudica a obra.</p>
    </section>`;
  }

  const A = S.awardCheck;
  return `<section class="cm-panel">
    <h3 class="cm-panel-title">4. A seguir</h3>
    <div class="cm-flow">
      <span class="cm-flow-step is-done"><b>1</b> Margem aprovada</span><span class="cm-flow-sep">›</span>
      <span class="cm-flow-step ${b.status === "PROPOSTA_ENVIADA" || b.status === "ADJUDICADO" ? "is-done" : "is-current"}"><b>2</b> Proposta ao cliente</span><span class="cm-flow-sep">›</span>
      <span class="cm-flow-step ${b.status === "ADJUDICADO" ? "is-done" : ""}"><b>3</b> Adjudicação e obra</span>
    </div>
    <div class="cm-head-actions">
      ${
        b.locked
          ? `<span class="cm-pill is-good">Adjudicado — obra ${esc((b.params || {}).codObra || "")}</span>`
          : `<button class="cm-chip is-on" type="button" id="dProp">Gerar proposta</button>
             ${
               S.canAward
                 ? `<button class="cm-chip" type="button" id="dAward" ${A && !A.ok ? "disabled" : ""}>Adjudicar e criar a obra</button>`
                 : `<span class="cm-lead" style="margin:0">A adjudicação é feita por quem tem essa permissão.</span>`
             }`
      }
    </div>
    ${
      S.canAward && A && !A.ok && !b.locked
        ? `<div class="cm-note is-warn" style="margin-top:.75rem"><b>Antes de adjudicar:</b>
             <ul style="margin:.5rem 0 0;padding-left:1.1rem">${A.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
           </div>`
        : ""
    }
  </section>`;
}

// ───────────────────────── edição ─────────────────────────

function wire() {
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset?.mg !== undefined) {
      const v = t.value === "" ? null : Number(t.value) / 100;
      S.doc.dispatch.margens[t.dataset.mg] = v;
      S.dirty = true;
      S.R = calcBudget(S.doc);
      refreshNumbers();
      return;
    }
    if (t.dataset?.par) {
      S.doc.params[t.dataset.par] = t.value === "" ? null : Number(t.value);
      S.dirty = true;
      S.R = calcBudget(S.doc);
      refreshNumbers();
    }
  });

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("#dSave,#dDecide,#dProp,#dAward");
    if (!t) return;
    if (t.id === "dSave") return save();
    if (t.id === "dDecide") return decide();
    if (t.id === "dProp") return createProposal();
    if (t.id === "dAward") return openAward();
  });

  window.addEventListener("beforeunload", (e) => {
    if (S.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

/** Redesenha e devolve o foco à célula onde se estava a escrever. */
function refreshNumbers() {
  const focused = document.activeElement;
  const key = focused?.dataset?.mg || focused?.dataset?.par;
  const isMargin = Boolean(focused?.dataset?.mg);
  render();
  if (!key) return;
  const again = document.querySelector(isMargin ? `[data-mg="${key}"]` : `[data-par="${key}"]`);
  if (again) {
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  }
}

async function save() {
  try {
    const saved = await apiRequest(`/budgets/${S.id}`, {
      method: "PATCH",
      body: { version: S.head.version, params: S.doc.params, dispatch: S.doc.dispatch },
    });
    setDoc(saved);
    render();
    toast("Margens guardadas.", { type: "success" });
  } catch (err) {
    const p = err?.payload;
    if (p?.error === "VERSAO_DESATUALIZADA") {
      toast("Alguém gravou este orçamento entretanto. Recarregue a página antes de guardar.", { type: "error", timeoutMs: 7000 });
    } else {
      toast(p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível guardar.", { type: "error" });
    }
  }
}

async function decide() {
  const msg = el("dMsg");
  msg.textContent = "A registar…";
  try {
    if (S.dirty) await save();
    const saved = await apiRequest(`/budgets/${S.id}/dispatch`, {
      method: "POST",
      body: {
        estado: el("dEstado").value,
        prep: el("dPrep").value.trim() || null,
        obs: el("dObs").value.trim() || null,
        version: S.head.version,
      },
    });
    setDoc(saved);
    if (S.canAward) {
      try {
        S.awardCheck = await apiRequest(`/budgets/${S.id}/award-check`);
      } catch {
        S.awardCheck = null;
      }
    }
    render();
    toast("Decisão registada.", { type: "success" });
  } catch (err) {
    const p = err?.payload;
    msg.textContent = p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível registar a decisão.";
  }
}

async function createProposal() {
  try {
    const prop = await apiRequest("/proposals", { method: "POST", body: { budgetId: S.id } });
    window.location.href = `/comercial/propostas?id=${encodeURIComponent(prop.id)}`;
  } catch (err) {
    const p = err?.payload;
    toast(p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível criar a proposta.", { type: "error" });
  }
}

// ───────────────────────── adjudicação ─────────────────────────

function openAward() {
  const A = S.awardCheck || {};
  const R = S.R;
  el("cmDrawer").innerHTML = `
    <div class="cm-wizard-backdrop"><div class="cm-panel cm-wizard" style="max-width:620px">
      <div class="cm-head" style="margin-bottom:.5rem">
        <div>
          <div class="cm-head-num">Adjudicação</div>
          <h2 class="cm-panel-title" style="font-size:1.0625rem">Adjudicar e criar a obra</h2>
        </div>
        <button class="cm-chip" type="button" data-awx="close">Cancelar</button>
      </div>
      <p class="cm-lead">
        O cliente aceitou. O programa cria a obra <b>${esc(A.projectCode || "")}</b> com uma cópia de tudo o que
        foi previsto (${esc(fmt(R.CT))} de custo em linhas de orçamento), o centro de custo
        <b>${esc(A.costCenterCode || "")}</b>, e o orçamento fica só para consulta.
        <b>Isto não se desfaz.</b>
      </p>
      <div class="cm-wizard-grid">
        <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
          <span>Valor final do contrato (s/ IVA) <b style="color:var(--cm-bad-fg)">*</b></span>
          <input class="cell-manual" type="number" step="any" id="awV" value="${A.suggestedValue ?? Math.round(R.PVsi)}">
          <small>Preço da proposta: ${fmt(R.PVsi)}</small>
        </label>
        <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
          <span>Data de adjudicação</span>
          <input class="cell-manual" type="date" id="awD" value="${new Date().toISOString().slice(0, 10)}">
        </label>
        <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
          <span>N.º do contrato</span><input class="cell-manual" id="awC">
        </label>
        <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
          <span>Data real de início</span>
          <input class="cell-manual" type="date" id="awI" value="${esc(A.suggestedStart || "")}">
        </label>
      </div>
      <div class="cm-head-actions" style="margin-top:1rem;justify-content:flex-end">
        <span id="awMsg" class="cm-lead" style="margin:0;flex:1"></span>
        <button class="cm-chip" type="button" data-awx="close">Cancelar</button>
        <button class="cm-chip is-on" type="button" data-awx="ok">Adjudicar e criar a obra</button>
      </div>
    </div></div>`;

  el("cmDrawer").addEventListener("click", async (e) => {
    const t = e.target.closest("[data-awx]");
    if (!t) return;
    if (t.dataset.awx === "close") {
      el("cmDrawer").innerHTML = "";
      return;
    }
    const msg = el("awMsg");
    const value = Number(el("awV").value);
    if (!(value > 0)) {
      msg.textContent = "Indique o valor do contrato.";
      return;
    }
    t.disabled = true;
    msg.textContent = "A criar a obra…";
    try {
      const r = await apiRequest(`/budgets/${S.id}/award`, {
        method: "POST",
        body: {
          contractValue: value,
          awardDate: el("awD").value || null,
          contractNumber: el("awC").value.trim() || null,
          actualStartDate: el("awI").value || null,
        },
      });
      el("cmDrawer").innerHTML = "";
      setDoc(r.budget);
      render();
      toast(`Obra ${r.project.code} criada com ${r.lines} linhas de previsto. O orçamento ficou só para consulta.`, {
        type: "success",
        persist: true,
        link: `/Projectos/projectView?id=${r.project.id}`,
      });
    } catch (err) {
      t.disabled = false;
      const p = err?.payload;
      msg.textContent = p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível adjudicar.";
    }
  });
}

// ───────────────────────── arranque ─────────────────────────

initComercialPage({
  perm: "tab_despacho",
  onReady: async () => {
    S.readonly = !canEdit();
    S.canApprove = canApprove();
    S.canAward = canAward();
    try {
      if (!S.id) return renderPicker();
      el("cmContent").innerHTML = `<p class="cm-lead">A carregar a folha de despacho…</p>`;
      await loadBudget();
      wire();
      render();
    } catch (err) {
      el("cmContent").innerHTML = `<div class="cm-note is-bad">Não foi possível carregar: ${esc(
        err?.message || err
      )} <a href="/comercial/despacho">Voltar ›</a></div>`;
    }
  },
});
