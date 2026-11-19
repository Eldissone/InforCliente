/**
 * Baremes — biblioteca de custos internos padrão (Comercial › Base › Baremes).
 *
 * Seis abas (combustíveis, RH, equipamentos, viaturas, ferramentas, logística).
 * Cada linha calcula o custo em tempo real pelo espelho das fórmulas
 * (`/shared/comercial/baremFormulas.js`); o servidor recalcula e materializa ao gravar.
 *
 * Convenção de cor das células: amarelo = escreve-se, azul = escolhe-se, cinzento = calculado.
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";
import { initComercialPage, canEdit } from "/shared/comercial/page.js";
import { computeBaremCost, computeBaremStatus, buildFuelPrices } from "/shared/comercial/baremFormulas.js";

const el = (id) => document.getElementById(id);
const esc = (v) => escapeHtml(String(v ?? ""));

/** Estado do ecrã. */
const S = {
  meta: null,
  items: [],
  kind: "COMBUSTIVEL",
  q: "",
  includeInactive: false,
  ctx: {},
  /** id → linha em edição (cópia de trabalho) */
  draft: new Map(),
  saving: new Set(),
  readonly: false,
};

const fmt = (v, digits = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtPct = (v) => (v === null || v === undefined || v === "" ? "—" : `${(Number(v) * 100).toFixed(1).replace(".0", "")}%`);
const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—");
const toDateInput = (v) => (v ? String(v).slice(0, 10) : "");

// ───────────────────────── carregamento ─────────────────────────

async function loadMeta() {
  S.meta = await apiRequest("/baremes/meta");
  S.ctx = { ...S.meta.ctx };
}

async function loadItems() {
  const qs = new URLSearchParams();
  if (S.q) qs.set("q", S.q);
  if (S.includeInactive) qs.set("includeInactive", "1");
  const data = await apiRequest(`/baremes${qs.toString() ? `?${qs}` : ""}`);
  S.items = data.items || [];
  S.ctx = { ...data.ctx, fuelPrices: buildFuelPrices(S.items) };
  S.counts = data.counts || {};
  S.stale = data.stale || 0;
}

// ───────────────────────── cálculo local ─────────────────────────

/** A linha como está no ecrã (rascunho, se houver), já com custo e estado locais. */
function viewRow(row) {
  const d = S.draft.get(row.id);
  const merged = d ? { ...row, ...d, fields: { ...(row.fields || {}), ...(d.fields || {}) } } : row;
  let computed = { computedCost: 0, detail: {} };
  try {
    computed = computeBaremCost(merged.kind, merged, S.ctx);
  } catch {
    /* tipo desconhecido: fica a zero */
  }
  const status = computeBaremStatus(merged.kind, merged, S.ctx);
  return { ...merged, ...computed, status: status.code, statusLabel: status.label, statusSeverity: status.severity, dirty: !!d };
}

function rowsOfKind() {
  return S.items.filter((r) => r.kind === S.kind).map(viewRow);
}

function fieldsFor(kind) {
  return S.meta.fields[kind] || [];
}

/** Unidades já usadas neste tipo, para sugerir no campo de unidade. */
function unitSuggestions(kind) {
  return [...new Set(S.items.filter((r) => r.kind === kind && r.unit).map((r) => r.unit))].sort();
}

/** Um campo só aparece quando a condição `when` da sua definição se verifica. */
function fieldVisible(f, row) {
  if (!f.when) return true;
  return Object.entries(f.when).every(([k, v]) => (row[k] || "") === v);
}

// ───────────────────────── render ─────────────────────────

function render() {
  renderTabs();
  renderTable();
}

function renderTabs() {
  const kinds = S.meta.kinds || [];
  el("cmHeadActions").innerHTML = `
    <input id="bqSearch" class="cell-list" style="min-width:230px" type="search"
           placeholder="Procurar por nome, código ou nota…" value="${esc(S.q)}" aria-label="Procurar baremes">
    <label class="cm-chip" style="cursor:pointer">
      <input id="bqInactive" type="checkbox" ${S.includeInactive ? "checked" : ""}> Incluir arquivados
    </label>
    ${S.readonly ? "" : `<button id="bqNew" class="cm-chip" type="button" data-cm-write="1">+ Novo barém</button>`}
    ${S.readonly || S.items.length ? "" : `<button id="bqSeed" class="cm-chip is-on" type="button" data-cm-write="1">Carregar baremes de referência</button>`}
  `;

  el("cmTabs").innerHTML = kinds
    .map(
      (k) => `<button type="button" class="cm-chip${S.kind === k.kind ? " is-on" : ""}" data-kind="${k.kind}">
        <span>${esc(k.tag)} · ${esc(k.label)}</span><b>${(S.counts && S.counts[k.kind]) || 0}</b>
      </button>`
    )
    .join("");
}

function statusPill(r) {
  const cls = r.statusSeverity === "good" ? "is-good" : r.statusSeverity === "bad" ? "is-bad" : "is-warn";
  return `<span class="cm-pill ${cls}">${esc(r.statusLabel)}</span>`;
}

function cellInput(row, f) {
  const v = (row.fields || {})[f.k];
  const id = `f|${row.id}|${f.k}`;
  if (f.ty === "sel" || f.ty === "fuel") {
    const opts = f.ty === "fuel" ? S.meta.options.fuels : f.options || [];
    return `<select class="cell-list" data-cell="${id}" ${S.readonly ? "disabled" : ""}>
      <option value=""></option>
      ${opts.map((o) => `<option value="${esc(o)}"${String(v || "") === String(o) ? " selected" : ""}>${esc(o)}</option>`).join("")}
    </select>`;
  }
  if (f.ty === "text") {
    return `<input class="cell-manual" data-cell="${id}" value="${esc(v)}" ${S.readonly ? "disabled" : ""}>`;
  }
  if (f.ty === "pct") {
    const shown = v === null || v === undefined || v === "" ? "" : Number(v) * 100;
    return `<input class="cell-manual" type="number" step="any" data-cell="${id}" data-pct="1"
            value="${shown}" ${S.readonly ? "disabled" : ""}>`;
  }
  return `<input class="cell-manual" type="number" step="any" data-cell="${id}" value="${v ?? ""}" ${S.readonly ? "disabled" : ""}>`;
}

function headCell(row, key, label) {
  const id = `c|${row.id}|${key}`;
  return `<input class="cell-manual" data-cell="${id}" value="${esc(row[key])}" aria-label="${esc(label)}" ${S.readonly ? "disabled" : ""}>`;
}

function unitCell(row) {
  const kind = row.kind;
  if (S.meta.fixedUnit[kind]) return `<span class="cm-calc">${esc(S.meta.fixedUnit[kind])}</span>`;
  if (kind === "RH" || kind === "EQUIPAMENTO" || kind === "VIATURA") return `<span class="cm-calc">—</span>`;
  const id = `c|${row.id}|unit`;
  if (kind === "FERRAMENTA") {
    return `<select class="cell-list" data-cell="${id}" ${S.readonly ? "disabled" : ""}>
      ${S.meta.options.feCostUnits
        .map((o) => `<option value="${esc(o)}"${row.unit === o ? " selected" : ""}>${esc(o)}</option>`)
        .join("")}
    </select>`;
  }
  return `<input class="cell-manual" style="min-width:5rem" list="dl-unidades" data-cell="${id}"
          value="${esc(row.unit)}" aria-label="Unidade" ${S.readonly ? "disabled" : ""}>`;
}

function ownershipCell(row) {
  if (row.kind !== "EQUIPAMENTO") return "";
  const id = `c|${row.id}|ownership`;
  return `<td><select class="cell-list" data-cell="${id}" ${S.readonly ? "disabled" : ""}>
    ${S.meta.options.ownership.map((o) => `<option value="${esc(o)}"${row.ownership === o ? " selected" : ""}>${esc(o)}</option>`).join("")}
  </select></td>`;
}

function renderTable() {
  const rows = rowsOfKind();
  const fields = fieldsFor(S.kind);
  const derived = (S.meta.derived[S.kind] || []).filter((d) => d.headline);
  const kindMeta = (S.meta.kinds || []).find((k) => k.kind === S.kind) || {};

  const header = `
    <tr>
      <th>Código</th>
      <th>Nome</th>
      ${S.kind === "EQUIPAMENTO" ? "<th>Próprio / Alugado</th>" : ""}
      <th>Un.</th>
      ${fields.map((f) => `<th class="num">${esc(f.l)}</th>`).join("")}
      ${derived.map((d) => `<th class="num">${esc(d.l)}</th>`).join("")}
      <th>Data do preço</th>
      <th>Estado</th>
      <th></th>
    </tr>`;

  const body = rows.length
    ? rows
        .map((r) => {
          const headline = derived.map((d) => `<td class="num"><span class="cell-auto">${fmt(r.detail[d.k])}</span></td>`).join("");
          return `<tr data-row="${r.id}"${r.active === false ? ' style="opacity:.5"' : ""}>
        <td style="min-width:6rem">${headCell(r, "code", "Código")}</td>
        <td style="min-width:14rem">${headCell(r, "name", "Nome")}</td>
        ${ownershipCell(r)}
        <td style="min-width:5rem">${unitCell(r)}</td>
        ${fields
          .map((f) =>
            fieldVisible(f, r)
              ? `<td class="num">${cellInput(r, f)}</td>`
              : `<td class="num"><span class="cm-calc" title="Não se aplica a ${esc(r.ownership || r.unit || "")}">—</span></td>`
          )
          .join("")}
        ${headline}
        <td><input class="cell-manual" type="date" data-cell="c|${r.id}|priceDate" value="${toDateInput(r.priceDate)}" ${S.readonly ? "disabled" : ""}></td>
        <td>${statusPill(r)}</td>
        <td style="white-space:nowrap">
          ${r.dirty && !S.readonly ? `<button class="cm-chip is-on" type="button" data-save="${r.id}">Guardar</button>` : ""}
          <button class="cm-chip" type="button" data-history="${r.id}" title="Histórico de preços">Histórico</button>
          ${S.readonly ? "" : `<button class="cm-chip" type="button" data-del="${r.id}" title="Arquivar">Arquivar</button>`}
        </td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="20" style="padding:1.25rem;color:var(--cm-muted)">
        Ainda não há baremes de ${esc((kindMeta.label || "").toLowerCase())}.
        ${S.readonly ? "" : 'Use «+ Novo barém»' + (S.items.length ? "." : ' ou «Carregar baremes de referência».')}
      </td></tr>`;

  const dirtyCount = rows.filter((r) => r.dirty).length;

  el("cmContent").innerHTML = `
    <div class="cm-legend">
      <span><i class="manual"></i>Escreve-se à mão</span>
      <span><i class="list"></i>Escolhe-se de uma lista</span>
      <span><i class="auto"></i>Calculado — não se mexe</span>
    </div>
    ${formulaNote()}
    ${S.stale ? `<div class="cm-note is-warn"><b>${S.stale}</b> barém(s) por confirmar: sem data de preço, desatualizados ou com custo zero. Confirme o valor e ponha a data.</div>` : ""}
    ${dirtyCount ? `<div class="cm-note"><b>${dirtyCount}</b> linha(s) com alterações por guardar nesta aba. <button class="cm-chip is-on" type="button" id="bqSaveAll">Guardar todas</button></div>` : ""}
    <div class="cm-table-wrap">
      <table class="cm-table">
        <thead>${header}</thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <datalist id="dl-unidades">
      ${unitSuggestions(S.kind).map((u) => `<option value="${esc(u)}"></option>`).join("")}
    </datalist>
    <p class="cm-lead" style="margin-top:.75rem">
      Parâmetros de cálculo em vigor: <b>${S.ctx.diasMes}</b> dias úteis/mês, <b>${S.ctx.horasDia}</b> h/dia,
      <b>${fmt(S.ctx.horasAnoEquip, 0)}</b> h/ano nos equipamentos, validade de <b>${S.ctx.validadeBarem}</b> dias
      (<b>${S.ctx.validadeComb}</b> nos combustíveis).
      <a href="/comercial/base/parametros">Alterar em Parâmetros ›</a>
    </p>`;
}

/** A fórmula de cada aba, escrita por palavras — como no protótipo. */
function formulaNote() {
  const N = {
    COMBUSTIVEL:
      "O preço por litro alimenta automaticamente os equipamentos, as viaturas e a logística. Validade própria, mais curta que a dos outros baremes.",
    RH:
      "Custo diário = Mensal ÷ dias úteis/mês. Custo real diário = Diário × (1 + encargos) + seguro + alimentação + alojamento + transporte + outros. O custo/hora com encargos (usado na folha de recursos humanos) exclui alimentação, alojamento e transporte, que entram por dia.",
    EQUIPAMENTO:
      "Próprio: depreciação/h + manutenção/h + lubrificantes/h + pneus/h + seguro anual ÷ horas/ano + combustível/h + operador/h + outros/h. Alugado: aluguer por dia ÷ horas/dia (ou por hora) + combustível/h + operador/h + outros/h. Equipamento próprio nunca pode ficar com custo zero.",
    VIATURA:
      "Custo/km = consumo ÷ 100 × preço do combustível + manutenção/km + pneus/km. Custo/dia = (seguro anual ÷ 12 + depreciação mensal + motorista + outros) ÷ dias úteis/mês. Só indique o motorista se ele não estiver na folha de recursos humanos.",
    FERRAMENTA:
      "Unidade «dia»: aquisição ÷ vida útil + manutenção/dia + consumíveis/dia. Unidade «un»: o preço por unidade. Os kits de equipa dão o custo por equipa e por dia.",
    LOGISTICA:
      "Custo unitário por unidade (dia, mês, viagem, verba, litro). As linhas ligadas a um combustível seguem sempre a tabela de combustíveis e ignoram o custo escrito.",
  };
  return `<div class="cm-note">${esc(N[S.kind] || "")}</div>`;
}

// ───────────────────────── edição ─────────────────────────

function draftOf(id) {
  if (!S.draft.has(id)) S.draft.set(id, { fields: {} });
  return S.draft.get(id);
}

function onCellInput(e) {
  const t = e.target;
  const spec = t.dataset && t.dataset.cell;
  if (!spec) return;
  const [scope, id, key] = spec.split("|");
  const d = draftOf(id);
  let value = t.value;

  if (t.dataset.pct) value = value === "" ? null : Number(value) / 100;
  else if (t.type === "number") value = value === "" ? null : Number(value);

  if (scope === "f") d.fields[key] = value;
  else d[key] = value === "" ? null : value;

  // Combustível alterado → o custo de equipamentos/viaturas/logística muda já no ecrã
  if (S.kind === "COMBUSTIVEL") {
    const merged = S.items.map(viewRow);
    S.ctx = { ...S.ctx, fuelPrices: buildFuelPrices(merged) };
  }

  refreshRow(id);
}

/** Atualiza só os valores calculados e o estado da linha, sem perder o foco. */
function refreshRow(id) {
  const row = S.items.find((r) => r.id === id);
  if (!row) return;
  const r = viewRow(row);
  const tr = document.querySelector(`tr[data-row="${id}"]`);
  if (!tr) return;

  const derived = (S.meta.derived[S.kind] || []).filter((d) => d.headline);
  const autos = tr.querySelectorAll(".cell-auto");
  derived.forEach((d, i) => {
    if (autos[i]) autos[i].textContent = fmt(r.detail[d.k]);
  });

  const pill = tr.querySelector(".cm-pill");
  if (pill) {
    pill.className = `cm-pill ${r.statusSeverity === "good" ? "is-good" : r.statusSeverity === "bad" ? "is-bad" : "is-warn"}`;
    pill.textContent = r.statusLabel;
  }

  // Mostra o botão Guardar sem redesenhar a tabela
  const actions = tr.lastElementChild;
  if (actions && !S.readonly && !actions.querySelector("[data-save]")) {
    actions.insertAdjacentHTML("afterbegin", `<button class="cm-chip is-on" type="button" data-save="${id}">Guardar</button>`);
  }
}

async function saveRow(id) {
  if (S.saving.has(id)) return;
  const row = S.items.find((r) => r.id === id);
  const d = S.draft.get(id);
  if (!row || !d) return;

  const merged = viewRow(row);
  const payload = {
    code: merged.code,
    name: merged.name,
    unit: merged.unit,
    ownership: merged.ownership,
    fields: merged.fields,
    priceDate: merged.priceDate ? toDateInput(merged.priceDate) : null,
  };

  S.saving.add(id);
  try {
    const saved = await apiRequest(`/baremes/${id}`, { method: "PATCH", body: payload });
    const i = S.items.findIndex((r) => r.id === id);
    if (i >= 0) S.items[i] = saved;
    S.draft.delete(id);
    if (saved.recalculated) {
      toast(`Barém guardado. ${saved.recalculated} barém(s) dependentes do combustível recalculados.`, { type: "success" });
      await loadItems();
    } else {
      toast("Barém guardado.", { type: "success" });
    }
    render();
  } catch (err) {
    const errs = err?.payload?.errors;
    toast(errs?.length ? errs.join(" ") : err?.message || "Não foi possível guardar o barém.", { type: "error" });
  } finally {
    S.saving.delete(id);
  }
}

async function saveAll() {
  const ids = rowsOfKind()
    .filter((r) => r.dirty)
    .map((r) => r.id);
  for (const id of ids) await saveRow(id);
}

// ───────────────────────── novo barém ─────────────────────────

function openNew() {
  const kindMeta = (S.meta.kinds || []).find((k) => k.kind === S.kind) || {};
  const fields = fieldsFor(S.kind);
  const host = el("cmDrawer");
  host.innerHTML = `
    <div class="cm-panel" style="position:fixed;right:1rem;top:5rem;width:min(520px,calc(100% - 2rem));max-height:calc(100vh - 7rem);overflow:auto;z-index:60;box-shadow:0 20px 50px rgba(0,0,0,.25)">
      <div class="cm-head" style="margin-bottom:.75rem">
        <div>
          <div class="cm-head-num">Novo barém</div>
          <h2 class="cm-panel-title">${esc(kindMeta.label || S.kind)}</h2>
        </div>
        <button class="cm-chip" type="button" data-newclose="1">Fechar</button>
      </div>
      <div style="display:grid;gap:.625rem">
        <label>Código <input id="nbCode" class="cell-manual" placeholder="ex.: RH-14"></label>
        <label>Nome <b style="color:var(--cm-bad-fg)">*</b> <input id="nbName" class="cell-manual"></label>
        ${S.kind === "EQUIPAMENTO" ? `<label>Próprio / Alugado <select id="nbOwnership" class="cell-list">${S.meta.options.ownership.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>` : ""}
        ${unitFieldForNew()}
        ${fields
          .map((f) => {
            if (f.ty === "sel" || f.ty === "fuel") {
              const opts = f.ty === "fuel" ? S.meta.options.fuels : f.options || [];
              return `<label>${esc(f.l)} <select id="nb_${f.k}" class="cell-list"><option value=""></option>${opts.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`;
            }
            if (f.ty === "text") return `<label>${esc(f.l)} <input id="nb_${f.k}" class="cell-manual"></label>`;
            return `<label>${esc(f.l)}${f.ty === "pct" ? " (%)" : ""} <input id="nb_${f.k}" class="cell-manual" type="number" step="any"${f.ty === "pct" ? ' data-pct="1"' : ""}></label>`;
          })
          .join("")}
        <label>Data do preço <input id="nbDate" class="cell-manual" type="date"></label>
        <label>Observações <input id="nbNotes" class="cell-manual"></label>
      </div>
      <div class="cm-head-actions" style="margin-top:1rem">
        <button class="cm-chip is-on" type="button" id="nbSave">Criar barém</button>
        <span id="nbMsg" class="cm-lead" style="margin:0"></span>
      </div>
    </div>`;

  el("nbSave").addEventListener("click", createNew);
  host.querySelector("[data-newclose]").addEventListener("click", () => (host.innerHTML = ""));
  el("nbName").focus();
}

function unitFieldForNew() {
  if (S.meta.fixedUnit[S.kind]) return "";
  if (["RH", "EQUIPAMENTO", "VIATURA"].includes(S.kind)) return "";
  if (S.kind === "FERRAMENTA") {
    return `<label>Unidade de custo <select id="nbUnit" class="cell-list">${S.meta.options.feCostUnits
      .map((o) => `<option>${esc(o)}</option>`)
      .join("")}</select></label>`;
  }
  return `<label>Unidade <input id="nbUnit" class="cell-manual" placeholder="dia, mês, viagem, vg, L…"></label>`;
}

async function createNew() {
  const fields = {};
  for (const f of fieldsFor(S.kind)) {
    const input = el(`nb_${f.k}`);
    if (!input) continue;
    let v = input.value;
    if (v === "") continue;
    if (input.dataset.pct) v = Number(v) / 100;
    else if (input.type === "number") v = Number(v);
    fields[f.k] = v;
  }
  const body = {
    kind: S.kind,
    code: el("nbCode").value.trim() || null,
    name: el("nbName").value.trim(),
    unit: el("nbUnit") ? el("nbUnit").value : null,
    ownership: el("nbOwnership") ? el("nbOwnership").value : null,
    fields,
    priceDate: el("nbDate").value || null,
    notes: el("nbNotes").value.trim() || null,
  };

  const msg = el("nbMsg");
  msg.textContent = "A criar…";
  try {
    await apiRequest("/baremes", { method: "POST", body });
    el("cmDrawer").innerHTML = "";
    await loadItems();
    render();
    toast("Barém criado.", { type: "success" });
  } catch (err) {
    const p = err?.payload;
    if (p?.error === "BAREM_JA_EXISTE") msg.textContent = "Já existe um barém com este nome neste tipo.";
    else msg.textContent = p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível criar.";
  }
}

// ───────────────────────── histórico ─────────────────────────

async function openHistory(id) {
  const row = S.items.find((r) => r.id === id);
  const host = el("cmDrawer");
  host.innerHTML = `<div class="cm-panel" style="position:fixed;right:1rem;top:5rem;width:min(620px,calc(100% - 2rem));max-height:calc(100vh - 7rem);overflow:auto;z-index:60;box-shadow:0 20px 50px rgba(0,0,0,.25)"><p class="cm-lead">A carregar histórico…</p></div>`;
  try {
    const data = await apiRequest(`/baremes/${id}/history`);
    const items = data.items || [];
    host.innerHTML = `
      <div class="cm-panel" style="position:fixed;right:1rem;top:5rem;width:min(620px,calc(100% - 2rem));max-height:calc(100vh - 7rem);overflow:auto;z-index:60;box-shadow:0 20px 50px rgba(0,0,0,.25)">
        <div class="cm-head" style="margin-bottom:.75rem">
          <div>
            <div class="cm-head-num">Histórico de preços</div>
            <h2 class="cm-panel-title">${esc(row?.name || "")}</h2>
          </div>
          <button class="cm-chip" type="button" data-newclose="1">Fechar</button>
        </div>
        ${
          items.length
            ? `<div class="cm-table-wrap"><table class="cm-table"><thead><tr>
                 <th>Quando</th><th>Data do preço</th><th class="num">Custo calculado</th><th>Por</th>
               </tr></thead><tbody>
               ${items
                 .map(
                   (h) => `<tr>
                     <td>${fmtDate(h.changedAt)}</td>
                     <td>${fmtDate(h.priceDate)}</td>
                     <td class="num">${fmt(h.computedCost)}</td>
                     <td>${esc(h.changedBy || "—")}</td>
                   </tr>`
                 )
                 .join("")}
               </tbody></table></div>
               <p class="cm-lead" style="margin-top:.75rem">Responde a «porque é que este custo subiu»: cada alteração de preço fica registada.</p>`
            : `<p class="cm-lead">Sem alterações de preço registadas.</p>`
        }
      </div>`;
    host.querySelector("[data-newclose]").addEventListener("click", () => (host.innerHTML = ""));
  } catch (err) {
    host.innerHTML = "";
    toast(err?.message || "Não foi possível carregar o histórico.", { type: "error" });
  }
}

// ───────────────────────── ações ─────────────────────────

async function archive(id) {
  const row = S.items.find((r) => r.id === id);
  if (!row) return;
  if (!window.confirm(`Arquivar o barém «${row.name}»? Deixa de aparecer nas folhas de custo, mas o histórico fica.`)) return;
  try {
    await apiRequest(`/baremes/${id}`, { method: "DELETE" });
    await loadItems();
    render();
    toast("Barém arquivado.", { type: "success" });
  } catch (err) {
    toast(err?.message || "Não foi possível arquivar.", { type: "error" });
  }
}

async function seedDefaults() {
  const btn = el("bqSeed");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "A carregar…";
  }
  try {
    const r = await apiRequest("/baremes/seed-defaults", { method: "POST", body: {} });
    await loadItems();
    render();
    toast(`${r.created} baremes de referência carregados. Confirme os preços e ponha a data em cada um.`, {
      type: "success",
      timeoutMs: 6000,
    });
  } catch (err) {
    if (err?.payload?.error === "BAREMES_JA_EXISTEM") toast("Já existem baremes gravados.", { type: "info" });
    else toast(err?.message || "Não foi possível carregar os baremes de referência.", { type: "error" });
    render();
  }
}

function wire() {
  document.addEventListener("input", (e) => {
    if (e.target?.dataset?.cell) onCellInput(e);
  });
  document.addEventListener("change", (e) => {
    if (e.target?.dataset?.cell) onCellInput(e);
    if (e.target?.id === "bqInactive") {
      S.includeInactive = e.target.checked;
      reload();
    }
  });
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-kind],[data-save],[data-history],[data-del],#bqNew,#bqSeed,#bqSaveAll");
    if (!t) return;
    if (t.dataset.kind) {
      S.kind = t.dataset.kind;
      render();
      return;
    }
    if (t.dataset.save) return saveRow(t.dataset.save);
    if (t.dataset.history) return openHistory(t.dataset.history);
    if (t.dataset.del) return archive(t.dataset.del);
    if (t.id === "bqNew") return openNew();
    if (t.id === "bqSeed") return seedDefaults();
    if (t.id === "bqSaveAll") return saveAll();
  });

  let timer = null;
  document.addEventListener("input", (e) => {
    if (e.target?.id !== "bqSearch") return;
    S.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => reload({ keepFocus: "bqSearch" }), 300);
  });

  // Avisa ao sair com alterações por guardar
  window.addEventListener("beforeunload", (e) => {
    if (S.draft.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

async function reload({ keepFocus } = {}) {
  await loadItems();
  render();
  if (keepFocus) {
    const node = el(keepFocus);
    if (node) {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    }
  }
}

// ───────────────────────── arranque ─────────────────────────

initComercialPage({
  perm: "tab_baremes",
  onReady: async () => {
    S.readonly = !canEdit();
    el("cmContent").innerHTML = `<p class="cm-lead">A carregar baremes…</p>`;
    try {
      await loadMeta();

      await loadItems();
      wire();
      render();
    } catch (err) {
      el("cmContent").innerHTML = `<div class="cm-note is-bad">Não foi possível carregar os baremes: ${esc(
        err?.message || err
      )}</div>`;
    }
  },
});
