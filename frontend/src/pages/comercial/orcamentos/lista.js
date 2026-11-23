/**
 * Orçamentos — lista e assistente de criação (Comercial › Orçamentos).
 *
 * O assistente é obrigatório antes de entrar no orçamento, como no protótipo:
 * quatro blocos num só ecrã, com os números automáticos à vista antes de criar.
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";
import { initComercialPage, canEdit } from "/shared/comercial/page.js";
import { abrirImportacao, wireImportacao } from "/shared/comercial/importarExcel.js";

const el = (id) => document.getElementById(id);
const esc = (v) => escapeHtml(String(v ?? ""));

const STATUS_LABELS = {
  EM_ELABORACAO: "Em elaboração",
  EM_ANALISE: "Em análise",
  APROVADO: "Aprovado",
  PROPOSTA_ENVIADA: "Proposta enviada",
  ADJUDICADO: "Adjudicado",
  PERDIDO: "Perdido",
  CANCELADO: "Cancelado",
};

const MARGIN_PILL = { good: "is-good", warn: "is-warn", bad: "is-bad" };

const S = { items: [], counts: {}, status: "", q: "", readonly: false, nov: null };

const fmt = (v, d = 0) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(1)}%`);
const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—");

// ───────────────────────── lista ─────────────────────────

async function load() {
  const qs = new URLSearchParams();
  if (S.q) qs.set("q", S.q);
  if (S.status) qs.set("status", S.status);
  const data = await apiRequest(`/budgets${qs.toString() ? `?${qs}` : ""}`);
  S.items = data.items || [];
  S.counts = data.counts || {};
}

function render() {
  el("cmHeadActions").innerHTML = `
    <input id="oqSearch" class="cell-list" style="min-width:260px" type="search"
           placeholder="Procurar por número, obra, cliente ou responsável…" value="${esc(S.q)}" aria-label="Procurar orçamentos">
    ${
      S.readonly
        ? ""
        : `<button class="cm-chip" type="button" id="oqImport" data-cm-write="1" title="A IA lê a folha e mostra as linhas para rever">✦ Importar Excel</button>
           <button class="cm-chip is-on" type="button" id="oqNew" data-cm-write="1">+ Novo orçamento</button>`
    }`;

  const total = Object.values(S.counts).reduce((a, b) => a + b, 0);
  const chip = (k, l) =>
    `<button type="button" class="cm-chip${S.status === k ? " is-on" : ""}" data-status="${k}">
      <span>${esc(l)}</span><b>${k ? S.counts[k] || 0 : total}</b>
    </button>`;

  el("cmContent").innerHTML = `
    <div class="cm-chips">
      ${chip("", "Todos")}
      ${Object.entries(STATUS_LABELS)
        .filter(([k]) => k !== "CANCELADO" || S.counts.CANCELADO)
        .map(([k, l]) => chip(k, l))
        .join("")}
    </div>
    <div class="cm-table-wrap">
      <table class="cm-table">
        <thead><tr>
          <th>N.º</th><th>Rev.</th><th>Cliente</th><th>Obra</th><th>Local</th>
          <th class="num">Custo total</th><th class="num">Preço s/ IVA</th><th class="num">Margem</th>
          <th>Estado</th><th>Responsável</th><th>Data</th><th></th>
        </tr></thead>
        <tbody>${
          S.items.length
            ? S.items.map(rowHtml).join("")
            : `<tr><td colspan="12" style="padding:1.25rem;color:var(--cm-muted)">
                 ${S.q || S.status ? "Nenhum orçamento corresponde ao filtro." : "Ainda não há orçamentos."}
                 ${S.readonly ? "" : " Use «+ Novo orçamento»."}
               </td></tr>`
        }</tbody>
      </table>
    </div>`;
}

function rowHtml(b) {
  const pill = MARGIN_PILL[b.marginState] || "";
  return `<tr>
    <td><a href="/comercial/orcamento?id=${esc(b.id)}"><b>${esc(b.number)}</b></a></td>
    <td>${esc(b.revision)}</td>
    <td>${esc(b.client ? b.client.name : "—")}</td>
    <td style="min-width:14rem">${esc(b.projectName)}</td>
    <td>${esc(b.location)}</td>
    <td class="num">${fmt(b.totalCost)}</td>
    <td class="num">${fmt(b.salePriceExVat)}</td>
    <td class="num">${pill ? `<span class="cm-pill ${pill}">${pct(b.grossMarginPct)}</span>` : pct(b.grossMarginPct)}</td>
    <td><span class="cm-pill${b.status === "ADJUDICADO" ? " is-good" : b.status === "PERDIDO" || b.status === "CANCELADO" ? " is-bad" : ""}">${esc(STATUS_LABELS[b.status] || b.status)}</span></td>
    <td>${esc(b.responsibleName)}</td>
    <td>${fmtDate(b.date)}</td>
    <td><a class="cm-chip" href="/comercial/orcamento?id=${esc(b.id)}">Abrir</a></td>
  </tr>`;
}

// ───────────────────────── assistente ─────────────────────────

async function openNew() {
  el("cmDrawer").innerHTML = `<div class="cm-wizard-backdrop"><div class="cm-panel cm-wizard"><p class="cm-lead">A preparar…</p></div></div>`;
  try {
    const d = await apiRequest("/budgets/new-defaults");
    S.nov = {
      d,
      form: {
        clientId: "",
        newClient: { name: "", industry: "", region: "" },
        projectName: "",
        location: "",
        responsibleName: d.responsibleName || "",
        projectDirName: "",
        startDate: "",
        endDate: "",
        priceBaseDate: d.today,
        validityDays: d.params.validade || 30,
        currencyBase: d.params.moedaBase || "AOA",
        currencyRef: d.params.moedaRef || "",
        method: d.params.metodo || "MARGEM_SOBRE_VENDA",
        marginMin: d.params.margemMin,
        marginTarget: d.params.margemObj,
        vatRate: d.params.iva,
        baremSource: "empresa",
      },
      errors: {},
    };
    drawNew();
  } catch (err) {
    el("cmDrawer").innerHTML = "";
    toast(err?.message || "Não foi possível abrir o assistente.", { type: "error" });
  }
}

function drawNew() {
  const { d, form: F, errors: E } = S.nov;
  const moedas = (d.currencies || []).map((c) => c.moeda).filter(Boolean);

  const field = (k, label, { ty = "text", required = false, options = null, ph = "", span = 1, help = "" } = {}) => {
    const v = F[k];
    let input;
    if (options) {
      input = `<select class="cell-list${E[k] ? " cm-invalid" : ""}" data-nv="${k}">
        ${options.map((o) => `<option value="${esc(o.v)}"${String(v) === String(o.v) ? " selected" : ""}>${esc(o.l)}</option>`).join("")}
      </select>`;
    } else if (ty === "pct") {
      const shown = v === null || v === undefined || v === "" ? "" : Number((Number(v) * 100).toFixed(6));
      input = `<div style="display:flex;align-items:center;gap:.25rem">
        <input class="cell-manual${E[k] ? " cm-invalid" : ""}" type="number" step="any" data-nv="${k}" data-pct="1" value="${shown}">
        <span class="cm-calc">%</span></div>`;
    } else {
      input = `<input class="cell-manual${E[k] ? " cm-invalid" : ""}" type="${ty}" data-nv="${k}" value="${esc(v)}" placeholder="${esc(ph)}">`;
    }
    return `<label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted);grid-column:span ${span}">
      <span>${label}${required ? ' <b style="color:var(--cm-bad-fg)">*</b>' : ""}</span>
      ${input}
      ${E[k] ? `<small style="color:var(--cm-bad-fg)">${esc(E[k])}</small>` : help ? `<small>${esc(help)}</small>` : ""}
    </label>`;
  };

  el("cmDrawer").innerHTML = `
    <div class="cm-wizard-backdrop">
    <div class="cm-panel cm-wizard">
      <div class="cm-head" style="margin-bottom:.5rem">
        <div>
          <div class="cm-head-num">Novo orçamento</div>
          <h2 class="cm-title" style="font-size:1.25rem">Dados do orçamento</h2>
        </div>
        <button class="cm-chip" type="button" data-nvx="cancel">Cancelar</button>
      </div>
      <p class="cm-lead" style="margin:0 0 .875rem">
        Preencha os dados. Só depois de carregar em <b>Criar orçamento</b> entra nas folhas de custo.
        Os campos com <b style="color:var(--cm-bad-fg)">*</b> são obrigatórios.
      </p>

      <div class="cm-codechain">
        <span><small>Código do orçamento</small><b>${esc(d.number)}</b></span>
        <span><small>Revisão</small><b>${esc(d.revision)}</b></span>
        <span><small>Data</small><b>${fmtDate(d.today)}</b></span>
        <span><small>Centro de custo</small><b>${esc(d.costCenterCode)}</b></span>
        <span class="cm-calc" style="border:0">números automáticos, atribuídos ao criar</span>
      </div>

      ${
        d.baremCount
          ? ""
          : `<div class="cm-note is-bad">Ainda não há baremes na biblioteca da empresa. Sem eles as folhas de custo ficam a zero — carregue-os primeiro em <a href="/comercial/base/baremes">Base › Baremes</a>.</div>`
      }

      <h3 class="cm-panel-title" style="font-size:.9375rem;margin:1rem 0 .5rem">1. Cliente e obra</h3>
      <div class="cm-wizard-grid">
        ${field("clientId", "Cliente", {
          span: 2,
          options: [
            { v: "", l: "— escolher da base de clientes —" },
            ...(d.clients || []).map((c) => ({ v: c.id, l: `${c.name}${c.code ? ` · ${c.code}` : ""}` })),
            { v: "__new", l: "+ Novo cliente…" },
          ],
        })}
        ${
          F.clientId === "__new"
            ? `<div class="cm-note" style="grid-column:span 2;margin:0">
                 <b class="small">Novo cliente — fica gravado na base de clientes</b>
                 <div class="cm-wizard-grid" style="margin-top:.5rem">
                   <label style="display:grid;gap:.25rem;font-size:.8125rem">
                     <span>Nome <b style="color:var(--cm-bad-fg)">*</b></span>
                     <input class="cell-manual${E.newClientName ? " cm-invalid" : ""}" data-nc="name" value="${esc(F.newClient.name)}">
                     ${E.newClientName ? `<small style="color:var(--cm-bad-fg)">${esc(E.newClientName)}</small>` : ""}
                   </label>
                   <label style="display:grid;gap:.25rem;font-size:.8125rem"><span>Setor</span>
                     <input class="cell-manual" data-nc="industry" value="${esc(F.newClient.industry)}"></label>
                   <label style="display:grid;gap:.25rem;font-size:.8125rem"><span>Província / região</span>
                     <input class="cell-manual" data-nc="region" value="${esc(F.newClient.region)}"></label>
                 </div>
               </div>`
            : ""
        }
        ${field("projectName", "Nome da obra / projeto", { required: true, span: 2, ph: "Ex.: Rede MT 30 kV e 2 PT — Huambo" })}
        ${field("location", "Localização", { required: true, ph: "Município, província" })}
        ${field("responsibleName", "Responsável pelo orçamento", { required: true })}
        ${field("projectDirName", "Diretor / responsável do projeto")}
      </div>

      <h3 class="cm-panel-title" style="font-size:.9375rem;margin:1rem 0 .5rem">2. Prazos</h3>
      <div class="cm-wizard-grid">
        ${field("startDate", "Data prevista de início", { ty: "date", required: true })}
        ${field("endDate", "Data prevista de conclusão", { ty: "date", required: true })}
        ${field("validityDays", "Validade da proposta (dias)", { ty: "number", required: true })}
        ${field("priceBaseDate", "Data-base dos preços", { ty: "date" })}
      </div>

      <h3 class="cm-panel-title" style="font-size:.9375rem;margin:1rem 0 .5rem">3. Moeda e formação do preço</h3>
      <div class="cm-wizard-grid">
        ${field("currencyBase", "Moeda-base", { required: true, options: moedas.map((m) => ({ v: m, l: m })) })}
        ${field("currencyRef", "Moeda de referência", { options: [{ v: "", l: "—" }, ...moedas.map((m) => ({ v: m, l: m }))] })}
        ${field("method", "Metodologia de preço", {
          span: 2,
          options: [
            { v: "MARGEM_SOBRE_VENDA", l: "Margem sobre a venda — PV = Custo ÷ (1 − Margem)" },
            { v: "MARKUP_SOBRE_CUSTO", l: "Markup sobre o custo — PV = Custo × (1 + Markup)" },
          ],
        })}
        ${field("marginMin", "Margem mínima aceitável", { ty: "pct" })}
        ${field("marginTarget", "Margem objetivo", { ty: "pct" })}
        ${field("vatRate", "IVA", { ty: "pct" })}
      </div>

      <h3 class="cm-panel-title" style="font-size:.9375rem;margin:1rem 0 .5rem">4. Baremes a usar</h3>
      <div class="cm-wizard-grid">
        ${field("baremSource", "Custos internos (salários, equipamentos, viaturas…)", {
          span: 2,
          options: [
            { v: "empresa", l: `Baremes padrão da empresa (${d.baremCount} linhas)` },
            ...S.items.slice(0, 15).map((b) => ({ v: `orcamento:${b.id}`, l: `Os mesmos do orçamento ${b.number} — ${b.projectName}` })),
          ],
          help: "O orçamento guarda a sua própria cópia dos baremes, como no ficheiro Excel.",
        })}
      </div>

      <div class="cm-head-actions" style="margin-top:1.25rem;justify-content:flex-end">
        <span id="nvMsg" class="cm-lead" style="margin:0;flex:1">${
          Object.keys(E).length ? "Faltam dados obrigatórios (assinalados a vermelho)." : ""
        }</span>
        <button class="cm-chip" type="button" data-nvx="cancel">Cancelar</button>
        <button class="cm-chip is-on" type="button" data-nvx="ok">Criar orçamento →</button>
      </div>
    </div></div>`;

  const first = el("cmDrawer").querySelector('[data-nv="projectName"]');
  if (first && !F.projectName) first.focus();
}

function readNew(e) {
  const t = e.target;
  const F = S.nov?.form;
  if (!F) return;
  if (t.dataset?.nv) {
    const k = t.dataset.nv;
    let v = t.value;
    if (t.dataset.pct) v = v === "" ? null : Number(v) / 100;
    else if (t.type === "number") v = v === "" ? null : Number(v);
    F[k] = v;
    delete S.nov.errors[k];
    if (k === "clientId") drawNew();
    return;
  }
  if (t.dataset?.nc) {
    F.newClient[t.dataset.nc] = t.value;
    delete S.nov.errors.newClientName;
  }
}

function validateNew() {
  const { form: F } = S.nov;
  const E = {};
  if (!F.clientId) E.clientId = "Escolha o cliente ou crie um novo.";
  if (F.clientId === "__new" && !String(F.newClient.name).trim()) {
    E.clientId = "Indique o nome do novo cliente.";
    E.newClientName = "Obrigatório.";
  }
  for (const [k, l] of [
    ["projectName", "Indique o nome da obra."],
    ["location", "Indique a localização."],
    ["responsibleName", "Indique o responsável."],
    ["startDate", "Indique a data de início."],
    ["endDate", "Indique a data de conclusão."],
    ["currencyBase", "Escolha a moeda-base."],
  ]) {
    if (!String(F[k] || "").trim()) E[k] = l;
  }
  if (!(Number(F.validityDays) > 0)) E.validityDays = "Indique os dias de validade.";
  if (F.startDate && F.endDate && F.endDate < F.startDate) {
    E.endDate = "A conclusão tem de ser depois do início.";
  }
  S.nov.errors = E;
  return !Object.keys(E).length;
}

async function createNew(btn) {
  if (!validateNew()) {
    drawNew();
    const bad = el("cmDrawer").querySelector(".cm-invalid");
    if (bad) {
      bad.scrollIntoView({ block: "center" });
      bad.focus();
    }
    return;
  }
  const { form: F } = S.nov;
  btn.disabled = true;
  btn.textContent = "A criar…";
  const msg = el("nvMsg");

  const body = {
    clientId: F.clientId === "__new" ? null : F.clientId,
    newClient: F.clientId === "__new" ? F.newClient : null,
    projectName: F.projectName.trim(),
    location: F.location.trim(),
    responsibleName: F.responsibleName.trim(),
    projectDirName: F.projectDirName || null,
    startDate: F.startDate || null,
    endDate: F.endDate || null,
    priceBaseDate: F.priceBaseDate || null,
    validityDays: Number(F.validityDays),
    currencyBase: F.currencyBase,
    currencyRef: F.currencyRef || null,
    method: F.method,
    marginMin: F.marginMin,
    marginTarget: F.marginTarget,
    vatRate: F.vatRate,
    baremSource: F.baremSource,
  };

  try {
    const created = await apiRequest("/budgets", { method: "POST", body });
    window.location.href = `/comercial/orcamento?id=${encodeURIComponent(created.id)}`;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Criar orçamento →";
    const errs = err?.payload?.errors;
    msg.textContent = errs?.length ? errs.join(" ") : err?.message || "Não foi possível criar o orçamento.";
  }
}

// ───────────────────────── eventos ─────────────────────────

function wire() {
  wireImportacao();
  document.addEventListener("input", (e) => {
    if (e.target?.dataset?.nv || e.target?.dataset?.nc) return readNew(e);
    if (e.target?.id === "oqSearch") {
      S.q = e.target.value;
      clearTimeout(wire._t);
      wire._t = setTimeout(async () => {
        await load();
        render();
        const again = el("oqSearch");
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      }, 300);
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target?.dataset?.nv || e.target?.dataset?.nc) readNew(e);
  });
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-status],[data-nvx],#oqNew,#oqImport");
    if (!t) return;
    if (t.id === "oqImport") {
      abrirImportacao({
        onCriado: async () => {
          await load();
          render();
        },
      });
      return;
    }
    if (t.dataset.status !== undefined) {
      S.status = t.dataset.status;
      await load();
      render();
      return;
    }
    if (t.id === "oqNew") return openNew();
    if (t.dataset.nvx === "cancel") {
      el("cmDrawer").innerHTML = "";
      S.nov = null;
      return;
    }
    if (t.dataset.nvx === "ok") return createNew(t);
  });
}

// ───────────────────────── arranque ─────────────────────────

initComercialPage({
  perm: "tab_orcamentos",
  onReady: async () => {
    S.readonly = !canEdit();
    el("cmContent").innerHTML = `<p class="cm-lead">A carregar orçamentos…</p>`;
    try {
      await load();
      wire();
      render();
    } catch (err) {
      el("cmContent").innerHTML = `<div class="cm-note is-bad">Não foi possível carregar os orçamentos: ${esc(
        err?.message || err
      )}</div>`;
    }
  },
});
