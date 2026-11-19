/**
 * Parâmetros — valores padrão da empresa para a orçamentação
 * (Comercial › Base › Parâmetros).
 *
 * Três secções: parâmetros (4 blocos), tabela de câmbios e listas de validação.
 * Cada orçamento novo recebe uma cópia destes valores; a partir daí é independente.
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";
import { initComercialPage, canEdit } from "/shared/comercial/page.js";

const el = (id) => document.getElementById(id);
const esc = (v) => escapeHtml(String(v ?? ""));

const S = {
  meta: null,
  params: {},
  defaults: {},
  lists: {},
  listLabels: {},
  currencies: [],
  validadeCambio: 15,
  moedaBase: "AOA",
  dirty: { params: false, lists: false, currencies: false },
  readonly: false,
};

const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—");
const toDateInput = (v) => (v ? String(v).slice(0, 10) : "");

function daysSince(v) {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// ───────────────────────── carregamento ─────────────────────────

async function loadAll() {
  const [meta, p, l, c] = await Promise.all([
    apiRequest("/company-settings/meta"),
    apiRequest("/company-settings/budget-params"),
    apiRequest("/company-settings/budget-lists"),
    apiRequest("/company-settings/currencies"),
  ]);
  S.meta = meta;
  S.params = { ...p.params };
  S.defaults = p.defaults || {};
  S.paramsStored = p.stored;
  S.paramsUpdatedAt = p.updatedAt;
  S.lists = { ...l.lists };
  S.listLabels = l.labels || {};
  S.currencies = (c.currencies || []).map((x) => ({ ...x }));
  S.validadeCambio = c.validadeCambio;
  S.moedaBase = c.moedaBase;
}

// ───────────────────────── render ─────────────────────────

function render() {
  el("cmHeadActions").innerHTML = S.readonly
    ? `<span class="cm-pill">Só consulta</span>`
    : `<button class="cm-chip${S.dirty.params || S.dirty.lists || S.dirty.currencies ? " is-on" : ""}" type="button" id="pSaveAll">Guardar alterações</button>`;

  el("cmContent").innerHTML = `
    ${
      S.paramsStored
        ? `<div class="cm-note">Parâmetros gravados${S.paramsUpdatedAt ? ` em ${fmtDate(S.paramsUpdatedAt)}` : ""}. Os orçamentos criados a partir de agora partem destes valores; os que já existem não mudam.</div>`
        : `<div class="cm-note is-warn">Ainda a usar os valores de origem do programa. Reveja-os e grave para que fiquem como padrão da empresa.</div>`
    }
    <div class="cm-legend">
      <span><i class="manual"></i>Escreve-se à mão</span>
      <span><i class="list"></i>Escolhe-se de uma lista</span>
      <span><i class="auto"></i>Calculado — não se mexe</span>
    </div>
    ${(S.meta.paramGroups || []).map(renderParamGroup).join("")}
    ${renderCurrencies()}
    ${renderLists()}`;
}

function renderParamGroup(g) {
  return `
    <section class="cm-panel">
      <h3 class="cm-panel-title">${esc(g.label)}</h3>
      ${g.help ? `<p class="cm-panel-sub">${esc(g.help)}</p>` : ""}
      <div style="display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))">
        ${g.fields.map(renderParamField).join("")}
      </div>
    </section>`;
}

function renderParamField(f) {
  const v = S.params[f.k];
  const def = S.defaults[f.k];
  const differs = def !== undefined && String(v) !== String(def);
  const dis = S.readonly ? "disabled" : "";

  let input;
  if (f.ty === "sel") {
    input = `<select class="cell-list" data-p="${f.k}" ${dis}>
      ${(f.options || [])
        .map((o) => `<option value="${esc(o)}"${String(v) === String(o) ? " selected" : ""}>${esc((f.optionLabels || {})[o] || o)}</option>`)
        .join("")}
    </select>`;
  } else if (f.ty === "pct") {
    const shown = v === null || v === undefined || v === "" ? "" : Number((Number(v) * 100).toFixed(6));
    input = `<div style="display:flex;align-items:center;gap:.25rem">
      <input class="cell-manual" type="number" step="any" data-p="${f.k}" data-pct="1" value="${shown}" ${dis}>
      <span class="cm-calc">%</span></div>`;
  } else {
    input = `<input class="cell-manual" type="number" step="any" data-p="${f.k}" value="${v ?? ""}" ${dis}>`;
  }

  return `<label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
    <span>${esc(f.l)}${differs ? ` <span class="cm-pill is-warn" title="Diferente do valor de origem (${esc(formatDefault(f, def))})">alterado</span>` : ""}</span>
    ${input}
    ${f.help ? `<small style="color:var(--cm-muted)">${esc(f.help)}</small>` : ""}
  </label>`;
}

function formatDefault(f, def) {
  if (f.ty === "pct") return `${Number(def) * 100}%`;
  return String(def);
}

function renderCurrencies() {
  const dis = S.readonly ? "disabled" : "";
  return `
    <section class="cm-panel">
      <h3 class="cm-panel-title">Tabela de câmbios</h3>
      <p class="cm-panel-sub">
        Quanto vale <b>uma unidade</b> de cada moeda em ${esc(S.moedaBase)}. A moeda-base tem sempre câmbio 1.
        Passados <b>${esc(S.validadeCambio)}</b> dias o câmbio fica desatualizado. Atualizar com a taxa oficial do BNA.
      </p>
      <div class="cm-table-wrap">
        <table class="cm-table">
          <thead><tr>
            <th>Moeda</th><th>Descrição</th><th class="num">Câmbio (${esc(S.moedaBase)} por 1 unidade)</th>
            <th>Data</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody>
            ${
              S.currencies.length
                ? S.currencies
                    .map((c, i) => {
                      const isBase = c.moeda === S.moedaBase;
                      const age = daysSince(c.data);
                      const state = isBase
                        ? `<span class="cm-pill">moeda-base</span>`
                        : c.cambio === null || c.cambio === undefined || c.cambio === ""
                          ? `<span class="cm-pill is-bad">Sem câmbio</span>`
                          : age === null
                            ? `<span class="cm-pill is-warn">Sem data</span>`
                            : age > Number(S.validadeCambio)
                              ? `<span class="cm-pill is-warn">Desatualizado (${age} dias)</span>`
                              : `<span class="cm-pill is-good">Atualizado</span>`;
                      return `<tr>
                        <td><input class="cell-manual" style="width:5rem;text-transform:uppercase" data-cur="${i}|moeda" value="${esc(c.moeda)}" ${dis}></td>
                        <td><input class="cell-manual" data-cur="${i}|desc" value="${esc(c.desc)}" ${dis}></td>
                        <td class="num"><input class="cell-manual" type="number" step="any" data-cur="${i}|cambio" value="${c.cambio ?? ""}" ${isBase || S.readonly ? "disabled" : ""}></td>
                        <td><input class="cell-manual" type="date" data-cur="${i}|data" value="${toDateInput(c.data)}" ${isBase || S.readonly ? "disabled" : ""}></td>
                        <td>${state}</td>
                        <td>${isBase || S.readonly ? "" : `<button class="cm-chip" type="button" data-curdel="${i}">×</button>`}</td>
                      </tr>`;
                    })
                    .join("")
                : `<tr><td colspan="6" style="padding:1rem;color:var(--cm-muted)">Sem moedas.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      ${S.readonly ? "" : `<button class="cm-chip" type="button" id="curAdd" style="margin-top:.625rem">+ Moeda</button>`}
    </section>`;
}

function renderLists() {
  const keys = Object.keys(S.listLabels);
  return `
    <section class="cm-panel">
      <h3 class="cm-panel-title">Listas de validação</h3>
      <p class="cm-panel-sub">
        As opções que aparecem nas listas suspensas do módulo. As funções do barém de recursos humanos
        e as unidades são as que mais se usam. A metodologia de preço e as unidades de tempo não estão
        aqui porque comandam fórmulas.
      </p>
      <div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))">
        ${keys.map(renderList).join("")}
      </div>
    </section>`;
}

function renderList(key) {
  const items = S.lists[key] || [];
  const dis = S.readonly ? "disabled" : "";
  return `
    <div>
      <div style="font-size:.8125rem;font-weight:700;margin-bottom:.375rem">
        ${esc(S.listLabels[key])} <span class="cm-calc">(${items.length})</span>
      </div>
      <div style="display:grid;gap:.25rem;max-height:14rem;overflow:auto;padding-right:.25rem">
        ${items
          .map(
            (v, i) => `<div style="display:flex;gap:.25rem">
              <input class="cell-manual" data-list="${esc(key)}|${i}" value="${esc(v)}" ${dis}>
              ${S.readonly ? "" : `<button class="cm-chip" type="button" data-listdel="${esc(key)}|${i}" aria-label="Retirar">×</button>`}
            </div>`
          )
          .join("") || `<p class="cm-calc" style="font-size:.8125rem">Lista vazia.</p>`}
      </div>
      ${
        S.readonly
          ? ""
          : `<div style="display:flex;gap:.25rem;margin-top:.375rem">
               <input class="cell-list" data-listnew="${esc(key)}" placeholder="Novo item…">
               <button class="cm-chip" type="button" data-listadd="${esc(key)}">+</button>
             </div>`
      }
    </div>`;
}

// ───────────────────────── edição ─────────────────────────

function markDirty(which) {
  S.dirty[which] = true;
  const btn = el("pSaveAll");
  if (btn) btn.classList.add("is-on");
}

function wire() {
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset?.p !== undefined) {
      let v = t.value;
      if (t.dataset.pct) v = v === "" ? null : Number(v) / 100;
      else if (t.type === "number") v = v === "" ? null : Number(v);
      S.params[t.dataset.p] = v;
      markDirty("params");
      return;
    }
    if (t.dataset?.cur) {
      const [i, k] = t.dataset.cur.split("|");
      let v = t.value;
      if (k === "moeda") v = v.toUpperCase();
      if (k === "cambio") v = v === "" ? null : Number(v);
      if (k === "data") v = v || null;
      S.currencies[Number(i)][k] = v;
      markDirty("currencies");
      return;
    }
    if (t.dataset?.list) {
      const [key, i] = t.dataset.list.split("|");
      S.lists[key][Number(i)] = t.value;
      markDirty("lists");
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset?.p !== undefined && t.tagName === "SELECT") {
      S.params[t.dataset.p] = t.value;
      markDirty("params");
      render();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const t = e.target;
    if (t.dataset?.listnew) {
      e.preventDefault();
      addListItem(t.dataset.listnew);
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-listadd],[data-listdel],[data-curdel],#curAdd,#pSaveAll");
    if (!t) return;
    if (t.dataset.listadd) return addListItem(t.dataset.listadd);
    if (t.dataset.listdel) {
      const [key, i] = t.dataset.listdel.split("|");
      S.lists[key].splice(Number(i), 1);
      markDirty("lists");
      return render();
    }
    if (t.dataset.curdel) {
      S.currencies.splice(Number(t.dataset.curdel), 1);
      markDirty("currencies");
      return render();
    }
    if (t.id === "curAdd") {
      S.currencies.push({ moeda: "", desc: null, cambio: null, data: null });
      markDirty("currencies");
      return render();
    }
    if (t.id === "pSaveAll") return saveAll();
  });

  window.addEventListener("beforeunload", (e) => {
    if (S.dirty.params || S.dirty.lists || S.dirty.currencies) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

function addListItem(key) {
  const input = document.querySelector(`[data-listnew="${key}"]`);
  const v = (input?.value || "").trim();
  if (!v) return;
  S.lists[key] = S.lists[key] || [];
  if (S.lists[key].includes(v)) {
    toast("Esse item já está na lista.", { type: "info" });
    return;
  }
  S.lists[key].push(v);
  markDirty("lists");
  render();
  const again = document.querySelector(`[data-listnew="${key}"]`);
  if (again) again.focus();
}

// ───────────────────────── gravação ─────────────────────────

async function saveAll() {
  const btn = el("pSaveAll");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "A guardar…";
  }

  const problems = [];
  try {
    if (S.dirty.params) {
      try {
        const r = await apiRequest("/company-settings/budget-params", { method: "PUT", body: { params: S.params } });
        S.params = r.params;
        S.paramsStored = true;
        S.dirty.params = false;
      } catch (err) {
        problems.push(...(err?.payload?.errors || [err?.message || "Parâmetros: não foi possível guardar."]));
      }
    }
    if (S.dirty.currencies) {
      try {
        const r = await apiRequest("/company-settings/currencies", { method: "PUT", body: { currencies: S.currencies } });
        S.currencies = r.currencies;
        S.dirty.currencies = false;
      } catch (err) {
        problems.push(...(err?.payload?.errors || [err?.message || "Câmbios: não foi possível guardar."]));
      }
    }
    if (S.dirty.lists) {
      try {
        const r = await apiRequest("/company-settings/budget-lists", { method: "PUT", body: { lists: S.lists } });
        S.lists = r.lists;
        S.dirty.lists = false;
      } catch (err) {
        problems.push(...(err?.payload?.errors || [err?.message || "Listas: não foi possível guardar."]));
      }
    }

    if (problems.length) {
      toast(problems.join(" "), { type: "error", timeoutMs: 8000 });
    } else {
      // Os parâmetros de cálculo mudam os custos de todos os baremes
      try {
        const r = await apiRequest("/baremes/recalc", { method: "POST", body: {} });
        toast(
          r.recalculated
            ? `Parâmetros guardados. ${r.recalculated} barém(s) recalculados.`
            : "Parâmetros guardados.",
          { type: "success" }
        );
      } catch {
        toast("Parâmetros guardados.", { type: "success" });
      }
    }
  } finally {
    await loadAll();
    render();
  }
}

// ───────────────────────── arranque ─────────────────────────

initComercialPage({
  perm: "tab_parametros",
  onReady: async () => {
    S.readonly = !canEdit();
    el("cmContent").innerHTML = `<p class="cm-lead">A carregar parâmetros…</p>`;
    try {
      await loadAll();
      wire();
      render();
    } catch (err) {
      el("cmContent").innerHTML = `<div class="cm-note is-bad">Não foi possível carregar os parâmetros: ${esc(
        err?.message || err
      )}</div>`;
    }
  },
});
