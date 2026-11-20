/**
 * Orçamento — o documento (Comercial › Orçamento, ?id=).
 *
 * Um só ecrã com secções: parâmetros, as oito folhas de custo direto, os três
 * blocos de custos indiretos, a verificação dos cálculos, a análise ABC e os
 * baremes do orçamento. O cabeçalho mostra sempre custo total, preço de venda
 * e margem — é por isso que não se muda de página a cada folha.
 *
 * As tabelas são desenhadas a partir dos metadados de `GET /budgets/meta`; o
 * cálculo corre no espelho local a cada tecla e o servidor recalcula ao gravar.
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";
import { initComercialPage, canEdit } from "/shared/comercial/page.js";
import { calcBudget, CATS, SHEET_KEYS } from "/shared/comercial/budgetCalc.js";

const el = (id) => document.getElementById(id);
const esc = (v) => escapeHtml(String(v ?? ""));
const qs = new URLSearchParams(window.location.search);

const S = {
  id: qs.get("id"),
  meta: null,
  doc: null,
  head: null,
  R: null,
  view: qs.get("v") || "par",
  dirty: false,
  saving: false,
  readonly: false,
  baremes: null,
  terms: null,
  termsDirty: false,
};

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

// ───────────────────────── carregamento ─────────────────────────

async function load() {
  const [meta, b] = await Promise.all([apiRequest("/budgets/meta"), apiRequest(`/budgets/${S.id}`)]);
  S.meta = meta;
  setDoc(b);
}

function setDoc(b) {
  S.head = b;
  S.doc = { params: b.params, sheets: b.sheets, baremSnapshot: b.baremSnapshot, lists: b.lists, dispatch: b.dispatch };
  for (const k of SHEET_KEYS) if (!Array.isArray(S.doc.sheets[k])) S.doc.sheets[k] = [];
  S.dirty = false;
  recalc();
}

function recalc() {
  S.R = calcBudget(S.doc);
}

// ───────────────────────── opções das listas ─────────────────────────

function optionsFor(src) {
  if (!src) return [];
  const [kind, name] = src.split(".");
  if (kind === "fixed") return (S.meta.fixedLists[name] || []).map((v) => ({ v, l: v }));
  if (kind === "currencies") return (S.doc.params.currencies || []).map((c) => ({ v: c.moeda, l: c.moeda }));
  if (kind === "lists") {
    const list = (S.doc.lists || {})[name] || [];
    return list.map((v) => (typeof v === "object" ? { v: v.nome, l: v.nome } : { v, l: v }));
  }
  if (kind === "barem") {
    const items = (S.doc.baremSnapshot?.items || []).filter((i) => i.kind === name);
    const byName = {};
    for (const i of items) byName[i.name] = (byName[i.name] || 0) + 1;
    return items.map((i) => {
      // Nomes repetidos desambiguam-se pelo código, como no protótipo
      const v = byName[i.name] > 1 && i.code ? `${i.name} [${i.code}]` : i.name;
      return { v, l: i.code ? `${v} · ${i.code}` : v };
    });
  }
  return [];
}

// ───────────────────────── navegação ─────────────────────────

function sections() {
  const sheetItem = (k) => {
    const d = S.meta.sheets[k];
    const cat = CATS.find((c) => c[3] === k);
    return { id: k, tag: d.tag, label: d.title, total: cat ? S.R.C[cat[0]] : null };
  };
  return [
    {
      group: "Visão geral",
      items: [
        { id: "dash", tag: "01", label: "Dashboard" },
        { id: "par", tag: "16", label: "Parâmetros" },
      ],
    },
    // O mapa de quantidades é o lado da venda: fica num grupo só dele, para
    // ninguém o confundir com uma folha de custo.
    {
      group: "O que se vende",
      items: [{ id: "qt", tag: S.meta.sheets.qt?.tag || "00", label: S.meta.sheets.qt?.title || "Mapa de quantidades", total: S.R.QT || 0 }],
    },
    { group: "Custos diretos", items: ["mat", "rh", "eq", "vi", "fe", "sub", "log", "eng"].map(sheetItem) },
    { group: "Custos indiretos", items: ["ind", "fin", "ris"].map(sheetItem) },
    {
      group: "Financeiro da obra",
      items: [{ id: "fcond", tag: "T3", label: "Condições de pagamento" }],
    },
    {
      group: "Análise",
      items: [
        { id: "verif", tag: "02", label: "Verificação dos cálculos" },
        { id: "abc", tag: "17", label: "Análise ABC" },
        { id: "bar", tag: "14", label: "Baremes do orçamento" },
      ],
    },
  ];
}

function renderNav() {
  el("cmSideNav").innerHTML = sections()
    .map(
      (g) => `<div class="cm-sidenav-group">
        <div class="cm-sidenav-title">${esc(g.group)}</div>
        ${g.items
          .map(
            (it) => `<button type="button" class="cm-sidenav-link${S.view === it.id ? " is-on" : ""}" data-view="${it.id}">
              <span class="cm-sidenav-tag">${esc(it.tag)}</span>
              <span class="cm-sidenav-label">${esc(it.label)}</span>
              ${it.total !== null && it.total !== undefined ? `<span class="cm-sidenav-total">${fmt(it.total)}</span>` : ""}
            </button>`
          )
          .join("")}
      </div>`
    )
    .join("");
}

// ───────────────────────── cabeçalho ─────────────────────────

function renderHead() {
  const b = S.head;
  const R = S.R;
  const [cls, label] = MARGIN_STATE[R.mgEstado] || ["", R.mgEstado];
  const mb = S.doc.params.moedaBase || "AOA";

  el("cmBudgetHead").innerHTML = `
    <div class="cm-bh-left">
      <div class="cm-head-num">${esc(b.number)} · ${esc(b.revision)} · ${esc(b.client ? b.client.name : "sem cliente")}</div>
      <h1 class="cm-title" style="font-size:1.25rem">${esc(S.doc.params.obra || b.projectName)}</h1>
      <div class="cm-calc" style="font-size:.75rem">${esc(S.doc.params.local || "")} · CC ${esc(b.costCenterCode || "—")}</div>
    </div>
    <div class="cm-bh-kpis">
      <div><span>Custo total</span><b>${fmt(R.CT)}</b><small>${esc(mb)}</small></div>
      <div><span>Preço s/ IVA</span><b>${fmt(R.PVsi)}</b><small>${esc(mb)}</small></div>
      <div><span>Margem bruta</span><b class="cm-pill ${cls}">${pct(R.MBpct)}</b><small>${esc(label)}</small></div>
    </div>
    <div class="cm-bh-actions">
      <a class="cm-chip" href="/comercial/despacho?id=${esc(b.id)}">Folha de despacho ›</a>
      ${b.locked ? `<span class="cm-pill is-warn">Adjudicado — só consulta</span>` : ""}
      ${
        S.readonly || b.locked
          ? ""
          : `<span class="cm-pill ${S.dirty ? "is-warn" : "is-good"}">${S.dirty ? "Por guardar" : "Guardado"}</span>
             <button class="cm-chip${S.dirty ? " is-on" : ""}" type="button" id="bSave" ${S.saving ? "disabled" : ""}>
               ${S.saving ? "A guardar…" : "Guardar"}
             </button>`
      }
    </div>`;
}

// ───────────────────────── render principal ─────────────────────────

function render() {
  renderHead();
  renderNav();
  const body = el("cmContent");
  if (S.view === "par") body.innerHTML = viewParams();
  else if (S.view === "dash") body.innerHTML = viewDash();
  else if (S.view === "fcond") body.innerHTML = viewTerms();
  else if (S.view === "verif") body.innerHTML = viewVerif();
  else if (S.view === "abc") body.innerHTML = viewAbc();
  else if (S.view === "bar") body.innerHTML = viewBaremes();
  else body.innerHTML = viewSheet(S.view);
}

/** Metodologias de preço, pela ordem em que se oferecem. */
const METODOS = {
  MARGEM_SOBRE_VENDA: "Margem sobre a venda",
  MARKUP_SOBRE_CUSTO: "Markup sobre o custo",
  PRECO_DADO: "Preço dado pelo cliente",
};

/** O rótulo da metodologia em vigor. */
function metodoLabel() {
  return METODOS[S.doc.params.metodo] || S.doc.params.metodo || "—";
}

// ───────────────────────── catálogo de artigos ───────────────────────────

/*
 * O que a empresa já vendeu, e por quanto.
 *
 * As tabelas de quantidades das obras são, na prática, uma lista de preços
 * praticados. Ao escrever a descrição de uma linha do mapa, sugere-se o que já
 * foi vendido com esse nome, com o último preço, a obra e a data; ao escolher,
 * enchem-se a unidade e o preço.
 *
 * Mostra-se o preço **por moeda**, porque cinco obras estão em dólares e as
 * outras em kwanzas: juntá-los fazia um eléctrodo de terra valer entre 7 e
 * 24 189. Nada é convertido nem recomendado — a data está lá para quem decide
 * poder pesar a inflação.
 */

let catTimer = null;
let catBox = null;
let catAlvo = null;

function catalogoFechar() {
  catBox?.remove();
  catBox = null;
  catAlvo = null;
}

function catalogoMoeda(a) {
  const base = S.doc.params.moedaBase || "AOA";
  return a.moedas.find((m) => m.cur === base) || a.moedas[0] || null;
}

function catalogoLinha(a, n) {
  const m = catalogoMoeda(a);
  const data = m?.ultimo?.data ? String(m.ultimo.data).slice(0, 10).split("-").reverse().join("/") : "";
  const outras = a.moedas.filter((x) => x !== m);
  return `<button type="button" class="cm-cat-item" data-cat="${n}">
    <span class="cm-cat-desc">${esc(a.desc)}</span>
    <span class="cm-cat-meta">
      <span class="cm-cat-un">${esc(a.un || "—")}</span>
      <span>${a.obras} obra${a.obras === 1 ? "" : "s"}</span>
      ${m ? `<b>${esc(m.cur)} ${fmt(m.ultimo.preco)}</b><span>${esc(m.ultimo.obra || "")}${data ? ` · ${data}` : ""}</span>` : `<span>sem preço</span>`}
      ${m && m.usos > 1 ? `<span class="cm-cat-faixa">${fmt(m.min)} – ${fmt(m.max)}</span>` : ""}
      ${outras.length ? `<span class="cm-cat-faixa">também em ${outras.map((x) => esc(x.cur)).join(", ")}</span>` : ""}
    </span>
  </button>`;
}

async function catalogoAbrir(input) {
  const q = input.value.trim();
  if (q.length < 2) return catalogoFechar();

  const [sheet, i] = input.dataset.artigo.split("|");
  const un = S.doc.sheets[sheet]?.[Number(i)]?.un || "";

  let r;
  try {
    r = await apiRequest(
      `/budgets/articles?q=${encodeURIComponent(q)}&limit=8&history=0${un ? `&un=${encodeURIComponent(un)}` : ""}`
    );
  } catch {
    return catalogoFechar(); // o catálogo é um extra: se falhar, escreve-se à mão
  }
  if (document.activeElement !== input) return;

  const itens = r.items || [];
  if (!itens.length) return catalogoFechar();

  catalogoFechar();
  catAlvo = { input, sheet, i: Number(i), itens };
  catBox = document.createElement("div");
  catBox.className = "cm-cat";
  catBox.innerHTML =
    itens.map(catalogoLinha).join("") +
    `<div class="cm-cat-foot">Preços já praticados, por moeda e com a data. Não são convertidos nem recomendados.</div>`;

  const r0 = input.getBoundingClientRect();
  catBox.style.left = `${Math.round(r0.left + window.scrollX)}px`;
  catBox.style.top = `${Math.round(r0.bottom + window.scrollY + 2)}px`;
  catBox.style.minWidth = `${Math.round(r0.width)}px`;
  document.body.appendChild(catBox);
}

function catalogoEscolher(n) {
  if (!catAlvo) return;
  const a = catAlvo.itens[n];
  const linha = S.doc.sheets[catAlvo.sheet]?.[catAlvo.i];
  if (!a || !linha) return catalogoFechar();

  const m = catalogoMoeda(a);
  linha.desc = a.desc;
  if (a.un) linha.un = a.un;
  if (m?.ultimo?.preco) linha.pu = m.ultimo.preco;

  const base = S.doc.params.moedaBase || "AOA";
  catalogoFechar();
  markDirty();
  render();

  if (m && m.cur !== base) {
    // `persist` em vez de "warn" (que o toast não conhece): um preço noutra
    // moeda dentro do orçamento é coisa para não passar despercebida.
    toast(`O preço veio em ${m.cur} (obra ${m.ultimo.obra}). Converta antes de usar — o orçamento é em ${base}.`, {
      type: "info",
      persist: true,
    });
  } else if (m) {
    const data = m.ultimo.data ? String(m.ultimo.data).slice(0, 10).split("-").reverse().join("/") : "";
    toast(`${fmt(m.ultimo.preco)} — praticado em ${m.ultimo.obra}${data ? ` a ${data}` : ""}.`, { type: "info" });
  }
}

// ─────────────── importar o mapa de quantidades de uma obra ───────────────

/**
 * Traz a tabela de quantidades de uma obra para o mapa, sem lhe mexer nos
 * valores. Mostra primeiro o que vai acontecer — quantas linhas, que total,
 * que unidades mudam de grafia — e só grava depois de confirmado.
 */
async function openImportQt() {
  if (S.dirty && !window.confirm("Há alterações por gravar que se perdem ao importar. Continuar?")) return;

  let obras;
  try {
    const r = await apiRequest("/budgets/quantity-sources");
    obras = r.items || [];
  } catch (err) {
    return toast(err.message || "Não foi possível ler as obras.", { type: "error" });
  }
  if (!obras.length) return toast("Nenhuma obra tem tabela de quantidades.", { type: "info" });

  const temMapa = (S.doc.sheets.qt || []).length > 0;
  const wrap = document.createElement("div");
  wrap.className = "cm-modal-back";
  wrap.innerHTML = `
    <div class="cm-modal" role="dialog" aria-modal="true" aria-labelledby="qtImpTitle">
      <h3 id="qtImpTitle" class="cm-panel-title">Importar mapa de quantidades</h3>
      <p class="cm-lead">Os valores entram como estão na obra. As unidades passam para a grafia do orçamento e o original fica guardado.</p>
      <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
        <span>Obra</span>
        <select id="qtObra" class="cell-list">
          <option value="">Escolher…</option>
          ${obras
            .map(
              (o) =>
                `<option value="${esc(o.id)}">${esc(o.code || "")} · ${esc(o.name)} — ${o.lines} linha(s), ${fmt(o.total)}</option>`
            )
            .join("")}
        </select>
      </label>
      ${
        temMapa
          ? `<label style="display:flex;gap:.5rem;align-items:center;font-size:.8125rem;margin-top:.625rem">
               <input type="checkbox" id="qtAppend"> Acrescentar às ${(S.doc.sheets.qt || []).length} linha(s) que já lá estão
               <span class="cm-calc">(por omissão substitui tudo)</span>
             </label>`
          : ""
      }
      <div id="qtPrev" style="margin-top:.75rem"></div>
      <div class="cm-modal-actions">
        <button type="button" class="cm-chip" id="qtCancel">Cancelar</button>
        <button type="button" class="cm-chip is-on" id="qtOk" disabled>Importar</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const fechar = () => wrap.remove();
  const sel = wrap.querySelector("#qtObra");
  const prev = wrap.querySelector("#qtPrev");
  const ok = wrap.querySelector("#qtOk");
  let resumo = null;

  wrap.querySelector("#qtCancel").addEventListener("click", fechar);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) fechar();
  });

  sel.addEventListener("change", async () => {
    resumo = null;
    ok.disabled = true;
    if (!sel.value) return (prev.innerHTML = "");
    prev.innerHTML = `<p class="cm-calc">A ler a obra…</p>`;
    try {
      resumo = await apiRequest(`/budgets/${encodeURIComponent(S.id)}/import-quantities?preview=1`, {
        method: "POST",
        body: { projectId: sel.value },
      });
    } catch (err) {
      prev.innerHTML = `<div class="cm-note is-bad">${esc((err.errors && err.errors[0]) || err.message || "Não foi possível ler a tabela.")}</div>`;
      return;
    }
    const mudam = resumo.unidadesAlteradas || [];
    const desconhecidas = resumo.unidadesPorReconhecer || [];
    prev.innerHTML = `
      <div class="cm-note">
        <b>${resumo.linhas}</b> linha(s), total <b>${fmt(resumo.total)}</b> ${esc(resumo.obra.currency)}.
        ${resumo.comTotalEscrito ? `<br>${resumo.comTotalEscrito} linha(s) trazem o total fechado do contrato.` : ""}
        ${resumo.semPreco ? `<br><b>${resumo.semPreco}</b> linha(s) sem preço — entram a zero.` : ""}
      </div>
      ${
        mudam.length
          ? `<div class="cm-note is-warn" style="margin-top:.5rem">Unidades que mudam de grafia:
               ${mudam.map((u) => `<b>${esc(u.original)}</b>→${esc(u.unit)} (${u.count})`).join(", ")}</div>`
          : ""
      }
      ${
        desconhecidas.length
          ? `<div class="cm-note is-warn" style="margin-top:.5rem">Unidades por reconhecer, entram tal como estão:
               ${desconhecidas.map((u) => `<b>${esc(u.original)}</b> (${u.count})`).join(", ")}</div>`
          : ""
      }`;
    ok.disabled = false;
  });

  ok.addEventListener("click", async () => {
    if (!resumo) return;
    const append = wrap.querySelector("#qtAppend")?.checked === true;
    ok.disabled = true;
    ok.textContent = "A importar…";
    try {
      const r = await apiRequest(`/budgets/${encodeURIComponent(S.id)}/import-quantities`, {
        method: "POST",
        body: { projectId: sel.value, mode: append ? "append" : "replace", version: S.head.version },
      });
      setDoc(r);
      S.dirty = false;
      fechar();
      render();
      toast(`${r.importado.linhas} linha(s) importadas · ${fmt(r.importado.total)}`, { type: "success" });
      if (S.doc.params.metodo !== "PRECO_DADO") {
        toast("Para o mapa mandar no preço, escolha «Preço dado pelo cliente» nos parâmetros.", { type: "info" });
      }
    } catch (err) {
      ok.disabled = false;
      ok.textContent = "Importar";
      toast((err.errors && err.errors[0]) || err.message || "Não foi possível importar.", { type: "error" });
    }
  });
}

// ───────────────────────── folhas ─────────────────────────

function viewSheet(key) {
  const def = S.meta.sheets[key];
  if (!def) return `<div class="cm-note is-bad">Folha desconhecida.</div>`;
  const rows = S.doc.sheets[key] || [];
  const res = S.R[key] || [];
  const cat = CATS.find((c) => c[3] === key);
  const venda = Boolean(def.sale);
  const total = venda ? S.R.QT || 0 : cat ? S.R.C[cat[0]] : 0;
  const pvTotal = cat ? S.R.PVbyCat[cat[0]] : 0;
  const editable = !S.readonly && !S.head.locked;

  const head = `<tr>
    ${def.cols.map((c) => `<th class="${c.calc ? "num" : c.ty === "num" || c.ty === "pct" ? "num" : ""}" title="${esc(c.help || "")}">${esc(c.l)}</th>`).join("")}
    ${editable ? "<th></th>" : ""}
  </tr>`;

  const body = rows.length
    ? rows
        .map((r, i) => {
          const x = res[i] || {};
          return `<tr data-i="${i}">
            ${def.cols.map((c) => `<td class="${c.calc || c.ty === "num" || c.ty === "pct" ? "num" : ""}">${c.calc ? calcCell(x, c) : editCell(key, i, c, r, editable)}</td>`).join("")}
            ${editable ? `<td><button class="cm-chip" type="button" data-delrow="${key}|${i}" title="Remover linha" aria-label="Remover linha">×</button></td>` : ""}
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="${def.cols.length + 1}" style="padding:1.25rem;color:var(--cm-muted)">
         Sem linhas.${editable ? " Use «+ Adicionar linha»." : ""}
       </td></tr>`;

  const foot = rows.length
    ? `<tr class="cm-total">
        ${def.cols
          .map((c, j) =>
            j === 0
              ? "<td>Total</td>"
              : c.calc === "total"
                ? `<td class="num">${fmt(total)}</td>`
                : c.calc === "ct"
                ? `<td class="num">${fmt(total)}</td>`
                : c.calc === "pv"
                  ? `<td class="num">${fmt(pvTotal)}</td>`
                  : c.calc === "mv"
                    ? `<td class="num">${fmt(pvTotal - total)}</td>`
                    : "<td></td>"
          )
          .join("")}
        ${editable ? "<td></td>" : ""}
      </tr>`
    : "";

  return `
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">${esc(def.tag)}</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">${esc(def.title)}</h2>
        <p class="cm-lead" style="margin-top:.25rem">${esc(def.lead)}</p>
      </div>
      <div class="cm-head-actions">
        ${
          venda
            ? `<span class="cm-chip"><span>Total do mapa</span><b>${fmt(total)}</b></span>
               ${S.R.precoDado ? `<span class="cm-pill is-good">É o preço de venda</span>` : `<span class="cm-pill">Não é o preço de venda</span>`}
               ${editable ? `<button class="cm-chip is-on" type="button" id="bImportQt">Importar de uma obra</button>` : ""}`
            : `<span class="cm-chip"><span>Custo</span><b>${fmt(total)}</b></span>
               ${cat && !["FIN", "IND", "RIS"].includes(cat[0]) ? `<span class="cm-chip"><span>Preço de venda</span><b>${fmt(pvTotal)}</b></span>` : ""}`
        }
      </div>
    </div>
    ${
      venda && !S.R.precoDado && (S.R.QT || 0) > 0
        ? `<div class="cm-note is-warn" style="margin-bottom:.625rem">
             O mapa tem ${S.R.qtLinhas} linha(s), mas a metodologia de preço é
             «${esc(metodoLabel())}»: o preço de venda está a sair do custo e das margens, não daqui.
             Para o mapa mandar no preço, escolha <b>Preço dado pelo cliente</b> nos parâmetros.
           </div>`
        : ""
    }
    ${
      venda && (S.R.QT || 0) > 0
        ? `<div class="cm-grupos">${S.R.qtGrupos
            .map(
              (g) => `<span class="cm-chip"><span>${esc(g.nome)}</span><b>${fmt(g.total)}</b><i>${(g.pct * 100).toFixed(1)}%</i></span>`
            )
            .join("")}</div>`
        : ""
    }
    <div class="cm-legend">
      <span><i class="manual"></i>Escreve-se à mão</span>
      <span><i class="list"></i>Escolhe-se de uma lista</span>
      <span><i class="auto"></i>Calculado — não se mexe</span>
    </div>
    <div class="cm-table-wrap"><table class="cm-table"><thead>${head}</thead><tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ""}</table></div>
    ${def.cols
      .filter((c) => c.ty === "combo")
      .map(
        (c) => `<datalist id="dl-${key}-${c.k}">${optionsFor(c.src)
          .map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`)
          .join("")}</datalist>`
      )
      .join("")}
    ${editable ? `<button class="cm-chip is-on" type="button" data-addrow="${key}" style="margin-top:.625rem">+ Adicionar linha</button>` : ""}`;
}

function calcCell(x, c) {
  const v = x[c.calc];
  if (c.f === "txt") return `<span class="cm-calc">${esc(v || "—")}</span>`;
  if (c.f === "pill") {
    const cls = v === "ALTO" ? "is-bad" : v === "MÉDIO" ? "is-warn" : v ? "is-good" : "";
    return v ? `<span class="cm-pill ${cls}">${esc(v)}</span>` : `<span class="cm-calc">—</span>`;
  }
  if (c.f === "pct") return `<span class="cell-auto">${pct(v)}</span>`;
  const d = c.f === "n2" ? 2 : c.f === "n1" ? 1 : 0;
  return `<span class="cell-auto">${fmt(v, d)}</span>`;
}

function editCell(sheet, i, c, row, editable) {
  const id = `${sheet}|${i}|${c.k}`;
  const v = row[c.k];
  const dis = editable ? "" : "disabled";
  if (c.ty === "sel") {
    const opts = optionsFor(c.src);
    const known = opts.some((o) => String(o.v) === String(v ?? ""));
    return `<select class="cell-list" data-cell="${id}" ${dis}>
      <option value=""></option>
      ${opts.map((o) => `<option value="${esc(o.v)}"${String(v ?? "") === String(o.v) ? " selected" : ""}>${esc(o.l)}</option>`).join("")}
      ${v && !known ? `<option value="${esc(v)}" selected>${esc(v)} (fora da lista)</option>` : ""}
    </select>`;
  }
  if (c.ty === "combo") {
    // Lista com escrita livre: o item pode não existir no barém e levar custo manual
    const listId = `dl-${sheet}-${c.k}`;
    return `<input class="cell-list" list="${listId}" data-cell="${id}" value="${esc(v)}"
            style="min-width:${(c.w || 1) * 7}rem" placeholder="Do barém ou escreva um item novo" ${dis}>`;
  }
  if (c.ty === "artigo") {
    // Escreve-se à mão, mas sugere o que a casa já vendeu (ver `catalogoAbrir`).
    return `<input class="cell-manual" data-cell="${id}" data-artigo="${sheet}|${i}" value="${esc(v)}"
            style="min-width:${(c.w || 1) * 7}rem" autocomplete="off"
            placeholder="Escreva e escolha do catálogo" ${dis}>`;
  }
  if (c.ty === "pct") {
    const shown = v === null || v === undefined || v === "" ? "" : Number((Number(v) * 100).toFixed(6));
    return `<input class="cell-manual" type="number" step="any" data-cell="${id}" data-pct="1" value="${shown}" ${dis}>`;
  }
  if (c.ty === "num") {
    return `<input class="cell-manual" type="number" step="any" data-cell="${id}" value="${v ?? ""}" ${dis}>`;
  }
  if (c.ty === "date") {
    return `<input class="cell-manual" type="date" data-cell="${id}" value="${esc(v ? String(v).slice(0, 10) : "")}" ${dis}>`;
  }
  return `<input class="cell-manual" data-cell="${id}" value="${esc(v)}" style="min-width:${(c.w || 1) * 7}rem" ${dis}>`;
}

// ───────────────────────── parâmetros ─────────────────────────

function viewParams() {
  const P = S.doc.params;
  const R = S.R;
  const editable = !S.readonly && !S.head.locked;
  const dis = editable ? "" : "disabled";
  const f = (k, l, ty = "text", help = "") => {
    const v = P[k];
    let input;
    if (ty === "pct") {
      const shown = v === null || v === undefined || v === "" ? "" : Number((Number(v) * 100).toFixed(6));
      input = `<div style="display:flex;align-items:center;gap:.25rem"><input class="cell-manual" type="number" step="any" data-par="${k}" data-pct="1" value="${shown}" ${dis}><span class="cm-calc">%</span></div>`;
    } else if (ty === "num") {
      input = `<input class="cell-manual" type="number" step="any" data-par="${k}" value="${v ?? ""}" ${dis}>`;
    } else if (ty === "date") {
      input = `<input class="cell-manual" type="date" data-par="${k}" value="${esc(v ? String(v).slice(0, 10) : "")}" ${dis}>`;
    } else if (ty === "metodo") {
      input = `<select class="cell-list" data-par="${k}" ${dis}>
        ${Object.entries(METODOS)
          .map(([mk, ml]) => `<option value="${mk}"${v === mk ? " selected" : ""}>${esc(ml)}</option>`)
          .join("")}
      </select>`;
    } else {
      input = `<input class="cell-manual" data-par="${k}" value="${esc(v)}" ${dis}>`;
    }
    return `<label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
      <span>${esc(l)}</span>${input}${help ? `<small>${esc(help)}</small>` : ""}</label>`;
  };
  const ro = (l, v, help = "") =>
    `<label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
      <span>${esc(l)}</span><span class="cell-auto" style="text-align:left">${v}</span>
      ${help ? `<small>${esc(help)}</small>` : ""}</label>`;

  const grid = (inner) => `<div style="display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))">${inner}</div>`;

  return `
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">16</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Parâmetros do orçamento</h2>
        <p class="cm-lead" style="margin-top:.25rem">
          Começaram como cópia dos parâmetros da empresa. A partir daqui só valem para este orçamento:
          alterá-los não mexe nos outros.
        </p>
      </div>
    </div>

    <section class="cm-panel">
      <h3 class="cm-panel-title">A. Identificação</h3>
      ${grid(`
        ${ro("Código do orçamento", `<b>${esc(S.head.number)}</b>`, "Automático e sequencial; não muda nas revisões.")}
        ${ro("Revisão", `<b>${esc(S.head.revision)}</b>`)}
        ${ro("Centro de custo", `<b>${esc(S.head.costCenterCode || "—")}</b>`, "Acompanha o número do orçamento.")}
        ${ro("Cliente", esc(S.head.client ? S.head.client.name : "—"))}
        ${f("obra", "Nome da obra / projeto")}
        ${f("local", "Localização")}
        ${f("respOrc", "Responsável pelo orçamento")}
        ${f("dirProj", "Diretor / responsável do projeto")}
        ${f("data", "Data", "date")}
        ${f("inicio", "Início previsto", "date")}
        ${f("fim", "Conclusão prevista", "date")}
        ${ro("Duração prevista", `${fmt(R.durDias)} dias · ${fmt(R.durMeses, 2)} meses`)}
        ${f("dataBase", "Data-base dos preços", "date")}
        ${f("validade", "Validade da proposta (dias)", "num")}
        ${ro("Proposta válida até", fmtDate(R.validaAte))}
      `)}
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">B. Formação do preço</h3>
      <p class="cm-panel-sub">As margens por categoria definem-se na folha de despacho; aqui ficam as regras.</p>
      ${grid(`
        ${f("metodo", "Metodologia de preço", "metodo")}
        ${f("margemMin", "Margem mínima aceitável", "pct", "Abaixo deste valor o orçamento fica em alerta.")}
        ${f("margemObj", "Margem objetivo", "pct")}
        ${f("iva", "IVA", "pct")}
        ${f("ajuste", "Ajuste comercial / arredondamento", "num", "Desconto ou arredondamento final sobre o preço calculado.")}
      `)}
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">C. Parâmetros de cálculo</h3>
      <p class="cm-panel-sub">Comandam as fórmulas dos baremes: mudar aqui muda os custos de todas as folhas.</p>
      ${grid(`
        ${f("diasMes", "Dias úteis por mês", "num")}
        ${f("horasDia", "Horas de trabalho por dia", "num")}
        ${f("horasAnoEquip", "Horas de utilização por ano (equipamentos)", "num")}
        ${ro("Preço do gasóleo em vigor", fmt(R.gasoleo, 2), "Vem do barém de combustíveis deste orçamento.")}
        ${ro("Preço da gasolina em vigor", fmt(R.gasolina, 2))}
      `)}
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">D. Controlo e alertas</h3>
      ${grid(`
        ${f("validadeBarem", "Validade máxima dos baremes (dias)", "num")}
        ${f("validadeCambio", "Validade máxima do câmbio (dias)", "num")}
        ${f("validadeComb", "Validade máxima do preço dos combustíveis (dias)", "num")}
        ${f("contMin", "Contingência mínima (% do custo direto)", "pct")}
        ${f("abcA", "Análise ABC — limite da classe A", "pct")}
        ${f("abcB", "Análise ABC — limite da classe B", "pct")}
      `)}
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">E. Parâmetros financeiros</h3>
      ${grid(`
        ${f("taxaJuro", "Taxa de juro / custo do capital (anual)", "pct")}
        ${f("pmr", "Prazo médio de recebimento (dias)", "num")}
        ${f("pmp", "Prazo médio de pagamento (dias)", "num")}
        ${ro("Necessidade de fundo de maneio", fmt(R.NFM), "Custo mensal × (PMR − PMP) ÷ 30.")}
      `)}
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">Tabela de câmbios deste orçamento</h3>
      <p class="cm-panel-sub">Cópia da tabela da empresa no momento da criação. Moeda-base: <b>${esc(P.moedaBase)}</b>.</p>
      <div class="cm-table-wrap"><table class="cm-table">
        <thead><tr><th>Moeda</th><th>Descrição</th><th class="num">Câmbio</th><th>Data</th><th>Estado</th></tr></thead>
        <tbody>${(P.currencies || [])
          .map((c, i) => {
            const st = (R.currencies.find((x) => x.moeda === c.moeda) || {}).estado;
            const cls = st === "OK" || st === "BASE" ? "is-good" : st === "SEM_CAMBIO" ? "is-bad" : "is-warn";
            const lbl = { OK: "Atualizado", BASE: "Moeda-base", SEM_CAMBIO: "Sem câmbio", SEM_DATA: "Sem data", DESATUALIZADO: "Desatualizado" }[st] || st;
            return `<tr>
              <td><b>${esc(c.moeda)}</b></td>
              <td>${esc(c.desc)}</td>
              <td class="num"><input class="cell-manual" type="number" step="any" data-cur="${i}|cambio" value="${c.cambio ?? ""}" ${c.moeda === P.moedaBase || !editable ? "disabled" : ""}></td>
              <td><input class="cell-manual" type="date" data-cur="${i}|data" value="${esc(c.data ? String(c.data).slice(0, 10) : "")}" ${c.moeda === P.moedaBase || !editable ? "disabled" : ""}></td>
              <td><span class="cm-pill ${cls}">${esc(lbl)}</span></td>
            </tr>`;
          })
          .join("")}</tbody>
      </table></div>
    </section>`;
}

// ───────────────────────── dashboard ─────────────────────────

function viewDash() {
  const R = S.R;
  const P = S.doc.params;
  const mb = P.moedaBase || "AOA";
  const [cls, label] = MARGIN_STATE[R.mgEstado] || ["", R.mgEstado];

  const comp = [
    ["Custos diretos", R.CD],
    ["Estrutura e sede", R.C.IND],
    ["Garantias e financiamento", R.C.FIN],
    ["Contingência", R.C.RIS],
  ].filter(([, v]) => v > 0);
  const diretos = R.cat.filter((c) => c.tipo === "Direto" && c.c > 0).sort((a, b) => b.c - a.c);
  const maxD = Math.max(1, ...diretos.map((c) => c.c));
  const ganho = R.cat.filter((c) => Math.abs(c.mv) > 0.5).sort((a, b) => b.mv - a.mv);
  const maxG = Math.max(1, ...ganho.map((c) => Math.abs(c.mv)));
  const alerts = R.alerts.filter((a) => a.n > 0);

  const bar = (nome, valor, max, total, extra = "") => `
    <div class="cm-bar">
      <div class="cm-bar-label">${esc(nome)}${extra}</div>
      <div class="cm-bar-track"><div class="cm-bar-fill${valor < 0 ? " is-neg" : ""}" style="width:${Math.max(1, (Math.abs(valor) / max) * 100)}%"></div></div>
      <div class="cm-bar-value${valor < 0 ? " cm-neg" : ""}">${fmt(valor)}${total ? ` <small>${pct(valor / total)}</small>` : ""}</div>
    </div>`;

  return `
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">01</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Dashboard do orçamento</h2>
        <p class="cm-lead" style="margin-top:.25rem">
          Onde está o dinheiro deste orçamento e se a margem chega. Em ${esc(mb)}, sem IVA.
        </p>
      </div>
    </div>

    <div class="cm-chips">
      <span class="cm-chip"><span>Custo total</span><b>${fmt(R.CT)}</b></span>
      <span class="cm-chip"><span>Preço s/ IVA</span><b>${fmt(R.PVsi)}</b></span>
      <span class="cm-chip"><span>Margem bruta</span><b>${fmt(R.MB)}</b></span>
      <span class="cm-chip"><span>Margem %</span><b>${pct(R.MBpct, 2)}</b></span>
      <span class="cm-chip"><span>Duração</span><b>${fmt(R.durDias)}</b></span>
    </div>

    <div class="cm-note${cls === "is-good" ? "" : cls === "is-bad" ? " is-bad" : " is-warn"}">
      <b>${esc(label)}.</b>
      Margem mínima ${pct(P.margemMin, 0)}, objetivo ${pct(P.margemObj, 0)}; este orçamento está a ${pct(R.MBpct, 2)}.
      ${R.MBpct < Number(P.margemObj) ? ` Para chegar ao objetivo faltam ${fmt(R.CT / (1 - Number(P.margemObj)) - R.PVsi)} de preço.` : ""}
      <a href="/comercial/despacho?id=${esc(S.head.id)}">Decidir na folha de despacho ›</a>
    </div>

    <div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(21rem,1fr))">
      <section class="cm-panel">
        <h3 class="cm-panel-title">Composição do custo</h3>
        ${comp.length ? comp.map(([n, v]) => bar(n, v, R.CT || 1, R.CT)).join("") : `<p class="cm-lead">Ainda sem custos lançados.</p>`}
      </section>

      <section class="cm-panel">
        <h3 class="cm-panel-title">Custos diretos por categoria</h3>
        ${
          diretos.length
            ? diretos.map((c) => bar(c.nome, c.c, maxD, R.CD)).join("")
            : `<p class="cm-lead">Ainda sem custos diretos. Comece pelas folhas 03 a 10.</p>`
        }
      </section>

      <section class="cm-panel">
        <h3 class="cm-panel-title">Onde está a margem</h3>
        <p class="cm-panel-sub">Quanto cada categoria contribui para a margem, em valor.</p>
        ${
          ganho.length
            ? ganho.map((c) => bar(c.nome, c.mv, maxG, 0, ` <small class="cm-calc">${pct(c.mg, 0)}</small>`)).join("")
            : `<p class="cm-lead">Sem margens definidas. Defina-as na folha de despacho.</p>`
        }
      </section>

      <section class="cm-panel">
        <h3 class="cm-panel-title">Alertas</h3>
        ${
          alerts.length
            ? `<ul class="cm-check">${alerts
                .map(
                  (a) => `<li class="${a.estado === "CRÍTICO" ? "required" : "advised"}">
                    ${esc(a.t)} — <b>${a.n}</b>
                    ${a.go && S.meta.sheets[a.go] ? ` <button type="button" class="cm-chip" data-view="${esc(a.go)}">ver</button>` : ""}
                  </li>`
                )
                .join("")}</ul>`
            : `<p class="cm-lead">Sem alertas: nada por rever.</p>`
        }
        <p class="cm-lead" style="margin-top:.75rem">
          <a href="/comercial/orcamento?id=${esc(S.head.id)}&v=verif">Ver a verificação dos cálculos ›</a>
        </p>
      </section>
    </div>`;
}

// ───────────────────────── condições de pagamento ─────────────────────────

const TERM_MODES = {
  amort: "Adiantamento diluído nos autos (amortizado em cada auto)",
  inicial: "Adiantamento inicial sem diluição; o restante em autos de medição",
  autos: "Só autos de medição, sem adiantamento",
  marcos: "Pagamentos por marcos",
};

function viewTerms() {
  if (!S.terms) {
    loadTerms();
    return `<p class="cm-lead">A carregar as condições de pagamento…</p>`;
  }
  const T = S.terms;
  const t = T.previstas || {};
  const editable = !S.readonly && !S.head.locked;
  const dis = editable ? "" : "disabled";
  const isMarcos = t.modo === "marcos";
  const sched = T.schedule || { rows: [], totals: {}, retention: {} };
  const PV = Number(T.salePriceExVat) || 0;

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

  const marcos = t.marcos || [];
  const totalPct = marcos.reduce((a, m) => a + (Number(m.pct) || 0), 0);
  const okPct = Math.abs(totalPct - 1) < 1e-6;

  return `
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">T3</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Condições de pagamento</h2>
        <p class="cm-lead" style="margin-top:.25rem">
          Como é que o cliente paga esta obra. Estas são as <b>condições previstas</b> na proposta;
          quando o orçamento for adjudicado, o contrato pode trazer outras e ficam registadas as duas.
        </p>
      </div>
      <div class="cm-head-actions">
        ${editable ? `<button class="cm-chip${S.termsDirty ? " is-on" : ""}" type="button" id="tSave">${S.termsDirty ? "Guardar condições" : "Guardado"}</button>` : ""}
      </div>
    </div>

    ${
      T.aprovadas
        ? `<div class="cm-note${T.diferem ? " is-warn" : ""}">
             <b>Condições aprovadas no contrato</b> (as que valem nesta obra).<br>
             Previsto na proposta: ${esc(T.descricao)}.<br>
             ${T.diferem ? `<b>Aprovado:</b> ${esc(T.descricaoAprovada)}.` : "Igual ao previsto."}
           </div>`
        : `<div class="cm-note">${esc(T.descricao)}</div>`
    }

    <section class="cm-panel">
      <h3 class="cm-panel-title">Regras</h3>
      <div style="display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))">
        <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted);grid-column:span 2">
          <span>Modo</span>
          <select class="cell-list" data-term="modo" ${dis}>
            ${Object.entries(TERM_MODES).map(([k, l]) => `<option value="${k}"${t.modo === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
          </select>
        </label>
        ${isMarcos ? "" : f("adPct", "Adiantamento", "pct", "Em percentagem do preço de venda.")}
        ${isMarcos || t.modo === "autos" ? "" : f("amort", "Amortização por auto", "pct", "Vazio = proporcional ao adiantamento.")}
        ${
          isMarcos
            ? ""
            : `<label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
                 <span>Periodicidade dos autos</span>
                 <select class="cell-list" data-term="per" ${dis}>
                   ${["Mensal", "Quinzenal", "Semanal"].map((x) => `<option${t.per === x ? " selected" : ""}>${x}</option>`).join("")}
                 </select></label>`
        }
        ${f("aprov", "Dias até à aprovação do auto")}
        ${f("pag", "Dias de pagamento depois da aprovação")}
        ${f("ret", "Retenção de garantia", "pct")}
        ${f("retAnos", "Durante quantos anos")}
        ${isMarcos ? f("matData", "Data prevista de entrega do material", "date") : ""}
      </div>

      ${
        isMarcos
          ? `<h4 class="cm-panel-title" style="font-size:.875rem;margin:1rem 0 .5rem">Marcos de pagamento</h4>
             <div class="cm-table-wrap"><table class="cm-table">
               <thead><tr><th>Marco</th><th class="num">%</th><th class="num">Valor s/ IVA</th><th>Quando</th><th>Data / % execução</th>${editable ? "<th></th>" : ""}</tr></thead>
               <tbody>${marcos
                 .map(
                   (m, i) => `<tr>
                     <td><input class="cell-manual" style="min-width:12rem" data-mil="${i}|desc" value="${esc(m.desc)}" ${dis}></td>
                     <td class="num"><input class="cell-manual" type="number" step="any" data-mil="${i}|pct" data-pct="1"
                       value="${m.pct === null || m.pct === undefined ? "" : Number((Number(m.pct) * 100).toFixed(6))}" ${dis}></td>
                     <td class="num"><span class="cell-auto">${fmt(PV * (Number(m.pct) || 0))}</span></td>
                     <td><select class="cell-list" data-mil="${i}|ev" ${dis}>
                       ${(T.options?.milestoneEvents || []).map(([k, l]) => `<option value="${k}"${m.ev === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
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
                 <tr class="cm-total"><td>Total</td>
                   <td class="num"><b${okPct ? "" : ' class="cm-neg"'}>${pct(totalPct)}</b></td>
                   <td class="num">${fmt(PV * totalPct)}</td>
                   <td colspan="${editable ? 3 : 2}">${okPct ? "" : `<span class="cm-pill is-bad">os marcos têm de somar 100%</span>`}</td>
                 </tr>
               </tbody></table></div>
             ${editable ? `<button class="cm-chip" type="button" data-milx="add" style="margin-top:.625rem">+ Marco</button>` : ""}`
          : ""
      }
      <span id="tMsg" class="cm-lead" style="margin:.75rem 0 0;display:block"></span>
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">Calendário de recebimentos</h3>
      <div class="cm-note is-warn">
        Estimativa com <b>progresso linear</b> ao longo da obra. A curva real depende do planeamento
        de produção; os marcos, esses, são exatos.
      </div>
      <div class="cm-table-wrap"><table class="cm-table">
        <thead><tr><th class="num">#</th><th>Recebimento</th><th>Data</th>
          <th class="num">Bruto</th><th class="num">Amortiza</th><th class="num">Retenção</th><th class="num">Líquido</th>
          <th>Recebe em</th></tr></thead>
        <tbody>${
          sched.rows.length
            ? sched.rows
                .map(
                  (r) => `<tr>
                    <td class="num cm-calc">${r.n}</td><td>${esc(r.desc)}</td><td>${fmtDate(r.date)}</td>
                    <td class="num">${fmt(r.gross)}</td>
                    <td class="num">${r.amortised ? fmt(r.amortised) : "—"}</td>
                    <td class="num">${r.retained ? fmt(r.retained) : "—"}</td>
                    <td class="num"><b>${fmt(r.net)}</b></td><td>${fmtDate(r.receiptDate)}</td>
                  </tr>`
                )
                .join("") +
              `<tr class="cm-total"><td></td><td>Total</td><td></td>
                 <td class="num">${fmt(sched.totals.gross)}</td><td class="num">${fmt(sched.totals.amortised)}</td>
                 <td class="num">${fmt(sched.totals.retained)}</td><td class="num">${fmt(sched.totals.net)}</td><td></td></tr>`
            : `<tr><td colspan="8" style="padding:1rem;color:var(--cm-muted)">Sem datas de início e conclusão não há calendário.</td></tr>`
        }</tbody>
      </table></div>
      ${(sched.warnings || []).map((w) => `<div class="cm-note is-warn" style="margin-top:.5rem">${esc(w)}</div>`).join("")}
    </section>`;
}

async function loadTerms() {
  try {
    S.terms = await apiRequest(`/budgets/${S.id}/payment-terms`);
    S.termsDirty = false;
    if (S.view === "fcond") render();
  } catch (err) {
    toast(err?.message || "Não foi possível carregar as condições de pagamento.", { type: "error" });
  }
}

async function saveTerms() {
  const msg = el("tMsg");
  if (msg) msg.textContent = "A guardar…";
  try {
    const r = await apiRequest(`/budgets/${S.id}/payment-terms`, {
      method: "PUT",
      body: { terms: S.terms.previstas },
    });
    S.terms = { ...S.terms, previstas: r.previstas, descricao: r.descricao, schedule: r.schedule };
    S.head = { ...S.head, version: r.version };
    S.termsDirty = false;
    render();
    toast("Condições de pagamento guardadas.", { type: "success" });
  } catch (err) {
    const p = err?.payload;
    if (msg) msg.textContent = p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível guardar.";
  }
}

// ───────────────────────── verificação ─────────────────────────

function viewVerif() {
  const R = S.R;
  const P = S.doc.params;
  const mb = P.moedaBase || "AOA";
  const step = (l, v, formula, d = 0) =>
    `<tr><td>${esc(l)}</td><td class="num"><b>${fmt(v, d)}</b></td><td class="cm-calc" style="white-space:normal">${esc(formula)}</td></tr>`;

  const alerts = R.alerts.filter((a) => a.n > 0);
  return `
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">02</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Verificação dos cálculos</h2>
        <p class="cm-lead" style="margin-top:.25rem">
          Cada número do orçamento com a conta que o produziu, de cima a baixo. Serve para confirmar
          antes de decidir a margem.
        </p>
      </div>
    </div>

    ${
      alerts.length
        ? `<div class="cm-note ${alerts.some((a) => a.estado === "CRÍTICO") ? "is-bad" : "is-warn"}">
             <b>${alerts.length} ponto(s) a rever:</b>
             <ul style="margin:.5rem 0 0;padding-left:1.1rem">
               ${alerts.map((a) => `<li>${esc(a.t)} — <b>${a.n}</b> ${a.estado === "CRÍTICO" ? "(crítico)" : ""}</li>`).join("")}
             </ul>
           </div>`
        : `<div class="cm-note" style="background:var(--cm-good-bg);color:var(--cm-good-fg);border-color:#bfe6cd">Sem alertas: nada por rever.</div>`
    }

    <section class="cm-panel">
      <h3 class="cm-panel-title">Do custo ao preço (${esc(mb)})</h3>
      <div class="cm-table-wrap"><table class="cm-table">
        <thead><tr><th>Passo</th><th class="num">Valor</th><th>Como se calcula</th></tr></thead>
        <tbody>
          ${CATS.filter((c) => c[2] === "Direto")
            .map(([k, nome, , sheet]) =>
              step(nome, R.C[k], `soma da folha ${S.meta.sheets[sheet].tag} (${(S.doc.sheets[sheet] || []).length} linha(s))`)
            )
            .join("")}
          ${step("= Custo direto", R.CD, "soma das oito folhas de custo direto")}
          ${step("Estrutura e sede", R.C.IND, "percentagem da base de incidência ou valor fixo, folha 12")}
          ${step("Garantias e financiamento", R.C.FIN, "folha 11; comissões sobre o contrato estimado e juros do fundo de maneio")}
          ${step("Riscos e contingências", R.C.RIS, "folha 13; probabilidade × valor potencial, ou o valor aplicado")}
          ${step("= CUSTO TOTAL", R.CT, "custo direto + estrutura + financeiros + contingência")}
          ${step("Preço de venda calculado", R.PVcalc, P.metodo === "MARKUP_SOBRE_CUSTO" ? "soma de custo × (1 + markup) por categoria" : "soma de custo ÷ (1 − margem) por categoria")}
          ${step("Ajuste comercial", R.PVsi - R.PVcalc, "desconto ou arredondamento escrito nos parâmetros")}
          ${step("= PREÇO DE VENDA S/ IVA", R.PVsi, "preço calculado + ajuste comercial")}
          ${step(`IVA (${pct(P.iva, 0)})`, R.imp, "preço s/ IVA × taxa de IVA")}
          ${step("= PREÇO DE VENDA C/ IVA", R.PVfinal, "preço s/ IVA + IVA")}
          ${step("Margem bruta", R.MB, "preço s/ IVA − custo total")}
          ${step("Margem bruta %", R.MBpct * 100, "margem bruta ÷ preço s/ IVA", 2)}
        </tbody>
      </table></div>
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">Por categoria</h3>
      <div class="cm-table-wrap"><table class="cm-table">
        <thead><tr><th>Categoria</th><th>Tipo</th><th class="num">Custo</th><th class="num">% do total</th>
          <th class="num">Margem</th><th class="num">Preço de venda</th><th class="num">Margem em valor</th></tr></thead>
        <tbody>
          ${R.cat
            .map(
              (c) => `<tr>
                <td>${esc(c.nome)}</td><td class="cm-calc">${esc(c.tipo)}</td>
                <td class="num">${fmt(c.c)}</td><td class="num">${pct(c.pct)}</td>
                <td class="num">${pct(c.mg)}</td><td class="num">${fmt(c.pv)}</td>
                <td class="num${c.mv < 0 ? " cm-neg" : ""}">${fmt(c.mv)}</td>
              </tr>`
            )
            .join("")}
          <tr class="cm-total"><td>TOTAL</td><td></td><td class="num">${fmt(R.CT)}</td><td class="num">100,0%</td>
            <td></td><td class="num">${fmt(R.PVcalc)}</td><td class="num">${fmt(R.catTot.mv)}</td></tr>
        </tbody>
      </table></div>
    </section>

    <section class="cm-panel">
      <h3 class="cm-panel-title">Contingência</h3>
      <div class="cm-table-wrap"><table class="cm-table"><tbody>
        ${step("Contingência recomendada", R.contRec, "soma de probabilidade × valor potencial, folha 13")}
        ${step("Contingência considerada", R.C.RIS, "o valor aplicado em cada risco, ou a recomendada")}
        ${step(`Contingência mínima (${pct(P.contMin, 0)} do custo direto)`, R.contMinVal, "custo direto × contingência mínima dos parâmetros")}
        <tr><td>Estado</td><td colspan="2"><span class="cm-pill ${R.contEstado === "ADEQUADA" ? "is-good" : "is-warn"}">${esc(R.contEstado)}</span></td></tr>
      </tbody></table></div>
    </section>`;
}

// ───────────────────────── ABC ─────────────────────────

function viewAbc() {
  const R = S.R;
  const P = S.doc.params;
  return `
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">17</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Análise ABC</h2>
        <p class="cm-lead" style="margin-top:.25rem">
          Pareto dos componentes de custo direto: A = maior impacto (até ${pct(P.abcA, 0)} acumulado),
          B = intermédio (até ${pct(P.abcB, 0)}), C = o resto. É nos itens A que vale a pena negociar.
        </p>
      </div>
    </div>
    <div class="cm-chips">
      <span class="cm-chip"><span>Classe A</span><b>${R.abcA.n}</b></span>
      <span class="cm-chip"><span>% do custo (classe A)</span><b>${pct(R.abcA.pct)}</b></span>
      <span class="cm-chip"><span>Classe B</span><b>${R.abcB}</b></span>
      <span class="cm-chip"><span>Classe C</span><b>${R.abcC}</b></span>
      <span class="cm-chip"><span>Custo direto analisado</span><b>${fmt(R.abcTot)}</b></span>
    </div>
    <div class="cm-table-wrap"><table class="cm-table">
      <thead><tr><th>#</th><th>Classe</th><th>Categoria</th><th>Item</th>
        <th class="num">Custo</th><th class="num">% do total</th><th class="num">% acumulada</th></tr></thead>
      <tbody>${
        R.abc.length
          ? R.abc
              .map(
                (x, i) => `<tr>
                  <td class="cm-calc">${i + 1}</td>
                  <td><span class="cm-pill ${x.cls === "A" ? "is-bad" : x.cls === "B" ? "is-warn" : ""}">${x.cls}</span></td>
                  <td class="cm-calc">${esc(x.cat)}</td>
                  <td>${esc(x.item)}</td>
                  <td class="num">${fmt(x.c)}</td>
                  <td class="num">${pct(x.pct)}</td>
                  <td class="num">${pct(x.acc)}</td>
                </tr>`
              )
              .join("")
          : `<tr><td colspan="7" style="padding:1.25rem;color:var(--cm-muted)">Ainda não há custos diretos lançados.</td></tr>`
      }</tbody>
    </table></div>`;
}

// ───────────────────────── baremes do orçamento ─────────────────────────

function viewBaremes() {
  if (!S.baremes) {
    loadBaremes();
    return `<p class="cm-lead">A carregar os baremes do orçamento…</p>`;
  }
  const B = S.baremes;
  const editable = !S.readonly && !S.head.locked;
  const byKind = {};
  for (const it of B.items) (byKind[it.kind] = byKind[it.kind] || []).push(it);

  return `
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">14</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Baremes deste orçamento</h2>
        <p class="cm-lead" style="margin-top:.25rem">
          Cópia dos baremes da empresa no momento em que o orçamento foi criado, como no ficheiro Excel.
          Mexer na biblioteca da empresa não mexe aqui — e ao contrário.
        </p>
      </div>
      ${editable ? `<div class="cm-head-actions"><button class="cm-chip" type="button" id="bApply">Trazer os baremes padrão da empresa</button></div>` : ""}
    </div>

    <div class="cm-chips">
      <span class="cm-chip"><span>Linhas no orçamento</span><b>${B.items.length}</b></span>
      <span class="cm-chip"><span>Na biblioteca da empresa</span><b>${B.libraryCount}</b></span>
      <span class="cm-chip"><span>Diferenças</span><b>${B.diff.length}</b></span>
      ${B.takenAt ? `<span class="cm-chip"><span>Cópia feita em</span><b>${fmtDate(B.takenAt)}</b></span>` : ""}
    </div>

    ${
      B.diff.length
        ? `<section class="cm-panel">
             <h3 class="cm-panel-title">Diferenças face à biblioteca da empresa</h3>
             <p class="cm-panel-sub">Trazer os baremes padrão substitui a cópia deste orçamento e recalcula todas as folhas.</p>
             <div class="cm-table-wrap"><table class="cm-table">
               <thead><tr><th>Tipo</th><th>Barém</th><th>O que mudou</th></tr></thead>
               <tbody>${B.diff
                 .slice(0, 100)
                 .map(
                   (d) => `<tr>
                     <td class="cm-calc">${esc(d.kind)}</td>
                     <td><b>${esc(d.name)}</b></td>
                     <td><span class="cm-pill ${d.type === "nova" ? "is-good" : d.type === "apagada" ? "is-bad" : "is-warn"}">${esc(d.type)}</span></td>
                   </tr>`
                 )
                 .join("")}</tbody>
             </table></div>
             ${B.diff.length > 100 ? `<p class="cm-lead">… e mais ${B.diff.length - 100}.</p>` : ""}
           </section>`
        : `<div class="cm-note">Os baremes deste orçamento estão iguais aos da biblioteca da empresa.</div>`
    }

    ${Object.entries(byKind)
      .map(
        ([kind, items]) => `<section class="cm-panel">
          <h3 class="cm-panel-title">${esc(kind)}</h3>
          <div class="cm-table-wrap"><table class="cm-table">
            <thead><tr><th>Código</th><th>Nome</th><th>Un.</th><th class="num">Custo unitário</th><th>Data do preço</th><th>Estado</th></tr></thead>
            <tbody>${items
              .map(
                (i) => `<tr>
                  <td class="cm-calc">${esc(i.code)}</td>
                  <td>${esc(i.name)}</td>
                  <td class="cm-calc">${esc(i.unit || i.ownership || "—")}</td>
                  <td class="num">${fmt(i.computedCost, 2)}</td>
                  <td>${fmtDate(i.priceDate)}</td>
                  <td><span class="cm-pill ${i.statusSeverity === "good" ? "is-good" : i.statusSeverity === "bad" ? "is-bad" : "is-warn"}">${esc(i.statusLabel)}</span></td>
                </tr>`
              )
              .join("")}</tbody>
          </table></div>
        </section>`
      )
      .join("")}`;
}

async function loadBaremes() {
  try {
    S.baremes = await apiRequest(`/budgets/${S.id}/baremes`);
    if (S.view === "bar") render();
  } catch (err) {
    toast(err?.message || "Não foi possível carregar os baremes do orçamento.", { type: "error" });
  }
}

// ───────────────────────── edição ─────────────────────────

function markDirty() {
  S.dirty = true;
  recalc();
}

function onCell(e) {
  const t = e.target;

  if (t.dataset?.cell) {
    const [sheet, i, key] = t.dataset.cell.split("|");
    let v = t.value;
    if (t.dataset.pct) v = v === "" ? null : Number(v) / 100;
    else if (t.type === "number") v = v === "" ? null : Number(v);
    else if (v === "") v = null;
    S.doc.sheets[sheet][Number(i)][key] = v;
    markDirty();
    refreshSheetRow(sheet, Number(i));
    return;
  }

  if (t.dataset?.par !== undefined) {
    let v = t.value;
    if (t.dataset.pct) v = v === "" ? null : Number(v) / 100;
    else if (t.type === "number") v = v === "" ? null : Number(v);
    S.doc.params[t.dataset.par] = v;
    markDirty();
    renderHead();
    return;
  }

  if (t.dataset?.term) {
    let v = t.value;
    if (t.dataset.pct) v = v === "" ? null : Number(v) / 100;
    else if (t.type === "number") v = v === "" ? null : Number(v);
    else if (v === "") v = null;
    S.terms.previstas = { ...S.terms.previstas, [t.dataset.term]: v };
    S.termsDirty = true;
    const btn = el("tSave");
    if (btn) {
      btn.classList.add("is-on");
      btn.textContent = "Guardar condições";
    }
    return;
  }

  if (t.dataset?.mil) {
    const [mi, mk] = t.dataset.mil.split("|");
    let mv = t.value;
    if (t.dataset.pct) mv = mv === "" ? null : Number(mv) / 100;
    S.terms.previstas.marcos[Number(mi)][mk] = mv || (mk === "desc" ? "" : null);
    S.termsDirty = true;
    if (mk === "pct") render();
    return;
  }

  if (t.dataset?.cur) {
    const [i, k] = t.dataset.cur.split("|");
    let v = t.value;
    if (k === "cambio") v = v === "" ? null : Number(v);
    S.doc.params.currencies[Number(i)][k] = v || null;
    markDirty();
    renderHead();
  }
}

/** Atualiza só as células calculadas da linha, para não perder o foco. */
function refreshSheetRow(sheet, i) {
  if (S.view !== sheet) {
    renderHead();
    renderNav();
    return;
  }
  const def = S.meta.sheets[sheet];
  const x = (S.R[sheet] || [])[i] || {};
  const tr = document.querySelector(`tr[data-i="${i}"]`);
  if (tr) {
    const calcCols = def.cols.filter((c) => c.calc);
    const tds = [...tr.children];
    let j = 0;
    def.cols.forEach((c, idx) => {
      if (!c.calc) return;
      const td = tds[idx];
      if (td) td.innerHTML = calcCell(x, c);
      j += 1;
    });
    void calcCols;
    void j;
  }
  // Totais da folha e do cabeçalho
  const cat = CATS.find((c) => c[3] === sheet);
  const foot = document.querySelector("tfoot tr.cm-total");
  if (foot && cat) {
    const total = S.R.C[cat[0]];
    const pvTotal = S.R.PVbyCat[cat[0]];
    def.cols.forEach((c, idx) => {
      const td = foot.children[idx];
      if (!td) return;
      if (c.calc === "ct") td.textContent = fmt(total);
      else if (c.calc === "pv") td.textContent = fmt(pvTotal);
      else if (c.calc === "mv") td.textContent = fmt(pvTotal - total);
    });
  }
  renderHead();
  renderNav();
}

function addRow(sheet) {
  S.doc.sheets[sheet].push({});
  markDirty();
  render();
  const inputs = document.querySelectorAll(`tr[data-i="${S.doc.sheets[sheet].length - 1}"] [data-cell]`);
  if (inputs[0]) inputs[0].focus();
}

function delRow(sheet, i) {
  S.doc.sheets[sheet].splice(i, 1);
  markDirty();
  render();
}

// ───────────────────────── gravação ─────────────────────────

async function save() {
  if (S.saving) return;
  S.saving = true;
  renderHead();
  try {
    const saved = await apiRequest(`/budgets/${S.id}`, {
      method: "PATCH",
      body: {
        version: S.head.version,
        params: S.doc.params,
        sheets: S.doc.sheets,
        lists: S.doc.lists,
        dispatch: S.doc.dispatch,
      },
    });
    setDoc(saved);
    toast("Orçamento guardado.", { type: "success" });
    render();
  } catch (err) {
    const p = err?.payload;
    if (p?.error === "VERSAO_DESATUALIZADA") {
      showConflict(p);
    } else if (p?.error === "ORCAMENTO_BLOQUEADO") {
      toast("O orçamento está adjudicado: já não se altera.", { type: "error" });
    } else {
      toast(p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível guardar.", { type: "error" });
    }
  } finally {
    S.saving = false;
    renderHead();
  }
}

/** Alguém gravou entretanto: mostra o que mudou e deixa o utilizador decidir. */
function showConflict(p) {
  const theirs = p.current;
  const mine = S.R;
  const row = (l, a, b) =>
    `<tr><td>${esc(l)}</td><td class="num">${fmt(a)}</td><td class="num">${fmt(b)}</td></tr>`;
  el("cmDrawer").innerHTML = `
    <div class="cm-wizard-backdrop"><div class="cm-panel cm-wizard" style="max-width:640px">
      <div class="cm-head" style="margin-bottom:.5rem">
        <div>
          <div class="cm-head-num">Conflito ao guardar</div>
          <h2 class="cm-panel-title" style="font-size:1.0625rem">Outra pessoa gravou este orçamento</h2>
        </div>
        <button class="cm-chip" type="button" data-cfx="close">Fechar</button>
      </div>
      <div class="cm-note is-warn">${esc((p.errors || []).join(" "))}</div>
      <div class="cm-table-wrap"><table class="cm-table">
        <thead><tr><th></th><th class="num">As suas alterações</th><th class="num">O que está gravado</th></tr></thead>
        <tbody>
          ${row("Custo direto", mine.CD, theirs.calc.CD)}
          ${row("Custo total", mine.CT, theirs.calc.CT)}
          ${row("Preço s/ IVA", mine.PVsi, theirs.calc.PVsi)}
        </tbody>
      </table></div>
      <p class="cm-lead">
        Recarregar deita fora o que escreveu desde a última gravação. Se precisa do que tem no ecrã,
        copie os valores antes de recarregar.
      </p>
      <div class="cm-head-actions" style="justify-content:flex-end">
        <button class="cm-chip" type="button" data-cfx="close">Continuar a editar</button>
        <button class="cm-chip is-on" type="button" data-cfx="reload">Recarregar a versão gravada</button>
      </div>
    </div></div>`;
}

// ───────────────────────── eventos ─────────────────────────

function wire() {
  document.addEventListener("input", onCell);

  // Catálogo de artigos no mapa de quantidades.
  document.addEventListener("input", (e) => {
    if (!e.target?.dataset?.artigo) return;
    clearTimeout(catTimer);
    catTimer = setTimeout(() => catalogoAbrir(e.target), 220);
  });
  document.addEventListener("mousedown", (e) => {
    const pick = e.target.closest?.("[data-cat]");
    if (pick) {
      e.preventDefault(); // não tira o foco da célula antes de escolher
      return catalogoEscolher(Number(pick.dataset.cat));
    }
    if (!e.target.closest?.("[data-artigo]")) catalogoFechar();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") catalogoFechar();
  });
  window.addEventListener("scroll", catalogoFechar, { passive: true });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t?.dataset?.term) {
      S.terms.previstas = { ...S.terms.previstas, [t.dataset.term]: t.value };
      S.termsDirty = true;
      render();
      return;
    }
    if (t?.dataset?.mil) {
      const [i, k] = t.dataset.mil.split("|");
      S.terms.previstas.marcos[Number(i)][k] = t.value;
      S.termsDirty = true;
      render();
      return;
    }
    if (t?.dataset?.cell || t?.dataset?.par !== undefined || t?.dataset?.cur) onCell(e);
  });

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-view],[data-addrow],[data-delrow],[data-cfx],[data-milx],#bSave,#bApply,#tSave,#bImportQt");
    if (!t) return;
    if (t.id === "tSave") return saveTerms();
    if (t.id === "bImportQt") return openImportQt();
    if (t.dataset.milx) {
      const [a, i] = t.dataset.milx.split("|");
      if (a === "add") S.terms.previstas.marcos.push({ desc: "Novo marco", pct: null, ev: "data", data: null });
      else S.terms.previstas.marcos.splice(Number(i), 1);
      S.termsDirty = true;
      render();
      return;
    }
    if (t.dataset.view) {
      S.view = t.dataset.view;
      const u = new URL(window.location.href);
      u.searchParams.set("v", S.view);
      window.history.replaceState({}, "", u);
      render();
      return;
    }
    if (t.dataset.addrow) return addRow(t.dataset.addrow);
    if (t.dataset.delrow) {
      const [sheet, i] = t.dataset.delrow.split("|");
      return delRow(sheet, Number(i));
    }
    if (t.id === "bSave") return save();
    if (t.id === "bApply") return applyBaremes();
    if (t.dataset.cfx === "close") {
      el("cmDrawer").innerHTML = "";
      return;
    }
    if (t.dataset.cfx === "reload") {
      el("cmDrawer").innerHTML = "";
      setDoc(await apiRequest(`/budgets/${S.id}`));
      S.baremes = null;
      render();
      toast("Versão gravada recarregada.", { type: "info" });
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (S.dirty || S.termsDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

async function applyBaremes() {
  if (S.dirty && !window.confirm("Tem alterações por guardar. Trazer os baremes padrão grava uma nova versão; as alterações por guardar perdem-se. Continuar?")) {
    return;
  }
  try {
    const saved = await apiRequest(`/budgets/${S.id}/apply-baremes`, { method: "POST", body: { version: S.head.version } });
    setDoc(saved);
    S.baremes = null;
    render();
    toast("Baremes padrão aplicados e folhas recalculadas.", { type: "success" });
  } catch (err) {
    const p = err?.payload;
    if (p?.error === "VERSAO_DESATUALIZADA") showConflict({ errors: ["Alguém gravou entretanto."], current: p.current });
    else toast(err?.message || "Não foi possível aplicar os baremes.", { type: "error" });
  }
}

// ───────────────────────── arranque ─────────────────────────

initComercialPage({
  perm: "tab_orcamentos",
  onReady: async () => {
    S.readonly = !canEdit();
    if (!S.id) {
      el("cmContent").innerHTML = `<div class="cm-note is-bad">Falta o orçamento no endereço. <a href="/comercial/orcamentos">Voltar à lista</a>.</div>`;
      return;
    }
    el("cmContent").innerHTML = `<p class="cm-lead">A carregar o orçamento…</p>`;
    try {
      await load();
      wire();
      render();
    } catch (err) {
      el("cmContent").innerHTML = `<div class="cm-note is-bad">Não foi possível carregar o orçamento: ${esc(
        err?.message || err
      )} <a href="/comercial/orcamentos">Voltar à lista</a>.</div>`;
    }
  },
});
