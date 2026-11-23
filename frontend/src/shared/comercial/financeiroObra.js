/**
 * Orçamento › Financeiro da obra — T1 Cronograma Previsto do Cliente e T2
 * Tesouraria Prevista (o `V.pfinc` e o `V.pfin` do protótipo). As contas estão
 * em `cronogramaFin.js`; as condições de pagamento do cliente são as da T3.
 */

import { escapeHtml, toast } from "/shared/ui.js";
import * as F from "/shared/comercial/cronogramaFin.js";
import { planear } from "/shared/comercial/producaoCore.js";

const esc = (v) => escapeHtml(String(v ?? ""));
const fmt = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (v) => `${((Number(v) || 0) * 100).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;
const dt = (k) => (k ? String(k).slice(0, 10).split("-").reverse().join("/") : "—");
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesLbl = (k) => `${MES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

export const FIN_OBRA = [
  ["pfinc", "T1", "Cronograma do cliente"],
  ["pfin", "T2", "Tesouraria interna"],
];

let C = null;

const head = (tag, titulo, lead, acoes = "") => `<div class="cm-head" style="margin-bottom:.5rem">
  <div><div class="cm-head-num">${tag}</div><h2 class="cm-panel-title" style="font-size:1.0625rem">${esc(titulo)}</h2>
  <p class="cm-lead" style="margin-top:.25rem">${esc(lead)}</p></div><div class="cm-head-actions">${acoes}</div></div>`;

function calc() {
  const S = C.S;
  const prod = S.doc.production || {};
  const plano = (prod.tarefas || []).length ? planear(prod) : null;
  const P = { ...S.doc.params, inicio: S.doc.params.inicio || S.head?.startDate, fim: S.doc.params.fim || S.head?.endDate };
  return F.calcular({ P, R: S.R, mat: S.doc.sheets.mat, plano, terms: S.terms?.previstas, fin: prod.fin });
}

function semDatas(tag, titulo) {
  return `${head(tag, titulo, "")}<p class="cm-lead">Crie as tarefas em <b>Produção › Planeamento de tarefas</b>, ou preencha as datas de início e de conclusão da obra em <b>Parâmetros</b>, para ver o cronograma financeiro.</p>`;
}

function baseNota(o) {
  return o.basis === "producao"
    ? `<p class="cm-calc">O ritmo da produção vem do planeamento das tarefas (P1).</p>`
    : `<div class="cm-note is-warn">Sem tarefas planeadas: a produção distribui-se por igual entre ${dt(o.a)} e ${dt(o.b)}. Planeie as tarefas em P1 para o ritmo real.</div>`;
}

function barras(meses, campo, cor) {
  if (!meses.length) return "";
  const mx = Math.max(1, ...meses.map((m) => m[campo]));
  return `<div class="fo-bars">${meses
    .map((m) => `<div class="fo-bar" title="${esc(mesLbl(m.k))}: ${fmt(m[campo])}"><i style="height:${Math.max(2, (m[campo] / mx) * 100)}%;background:${cor}"></i><span>${esc(mesLbl(m.k).replace(/ \d{2}(\d{2})$/, " $1"))}</span></div>`)
    .join("")}</div>`;
}

export function viewT1(ctx) {
  C = ctx;
  if (!C.S.terms) {
    C.loadTerms();
    return `<p class="cm-lead">A carregar as condições de pagamento…</p>`;
  }
  const o = calc();
  if (!o) return semDatas("T1", "Cronograma Previsto do Cliente");
  const iva = Number(C.S.doc.params.iva) || 0;
  const K = F.cliente(o, iva);
  const T = (k) => K.linhas.reduce((s, r) => s + (r[k] || 0), 0);
  const mb = esc(C.S.doc.params.moedaBase || "AOA");
  return `${head(
    "T1",
    "Cronograma Previsto do Cliente",
    "Documento para o cliente: quando prevemos fazer cada auto, o valor previsto e quando prevemos receber. Os valores saem do cronograma de execução e das condições de pagamento (T3).",
    `<button class="cm-chip" type="button" data-fo="xlsx1">Excel</button><button class="cm-chip" type="button" data-view="fcond">Condições de pagamento (T3) ›</button>`
  )}
  ${baseNota(o)}
  <div class="cm-grupos">
    <span class="cm-chip"><span>Valor da obra (s/ IVA)</span><b>${fmt(o.PV)}</b></span>
    <span class="cm-chip"><span>Adiantamento</span><b>${fmt(o.A)}</b></span>
    <span class="cm-chip"><span>Autos</span><b>${o.autos.length}</b></span>
    <span class="cm-chip"><span>A receber c/ IVA</span><b>${fmt(T("tot"))}</b></span>
    <span class="cm-chip"><span>Retenção</span><b>${fmt(T("rt"))}</b></span>
  </div>
  <section class="cm-panel fo-panel"><h3 class="cm-panel-title">Recebimentos previstos por mês (c/ IVA) · ${mb}</h3>${barras(K.meses, "tot", "#1fa36a")}</section>
  <div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>Documento</th><th>Período</th><th>Data</th><th class="num">Valor</th><th class="num">% obra</th><th class="num">% acum.</th><th class="num">Amortização</th><th class="num">Retenção</th><th class="num">Líquido</th><th class="num">IVA</th><th class="num">Total</th><th>Aprovação</th><th>Recebimento</th></tr></thead>
  <tbody>${K.linhas
    .map(
      (r) => `<tr><td><b>${esc(r.tipo)}</b></td><td class="cm-calc">${r.de ? `${dt(r.de).slice(0, 5)} → ${dt(r.d)}` : ""}</td><td>${dt(r.d)}</td>
      <td class="num">${r.v ? fmt(r.v) : ""}</td><td class="num">${r.pct ? pct(r.pct) : ""}</td><td class="num">${r.pa ? pct(r.pa) : ""}</td>
      <td class="num">${r.am ? fmt(-r.am) : ""}</td><td class="num">${r.rt ? fmt(-r.rt) : ""}</td><td class="num"><b>${fmt(r.liq)}</b></td>
      <td class="num">${fmt(r.iva)}</td><td class="num"><b>${fmt(r.tot)}</b></td><td>${dt(r.ap)}</td><td>${dt(r.rc)}</td></tr>`
    )
    .join("")}</tbody>
  <tfoot><tr><td colspan="3">Total</td><td class="num">${fmt(T("v"))}</td><td></td><td></td><td class="num">${fmt(-T("am"))}</td><td class="num">${fmt(-T("rt"))}</td><td class="num">${fmt(T("liq"))}</td><td class="num">${fmt(T("iva"))}</td><td class="num">${fmt(T("tot"))}</td><td colspan="2"></td></tr></tfoot></table></div>
  <div class="cm-table-wrap"><table class="cm-table fo-mes"><thead><tr><th>Mês</th><th class="num">Líquido</th><th class="num">Total c/ IVA</th><th class="num">Acumulado</th></tr></thead>
  <tbody>${K.meses.map((m) => `<tr><td>${esc(mesLbl(m.k))}</td><td class="num">${fmt(m.liq)}</td><td class="num">${fmt(m.tot)}</td><td class="num">${fmt(m.ac)}</td></tr>`).join("")}</tbody></table></div>
  <p class="cm-calc">A retenção de garantia é devolvida no fim do prazo de garantia (T3). O IVA é o dos parâmetros (${pct(iva)}).</p>`;
}

export function viewT2(ctx) {
  C = ctx;
  if (!C.S.terms) {
    C.loadTerms();
    return `<p class="cm-lead">A carregar as condições de pagamento…</p>`;
  }
  const o = calc();
  if (!o) return semDatas("T2", "Tesouraria Prevista");
  const f = o.f;
  const T = F.tesouraria(o, f.per);
  const ed = C.editable;
  const dis = ed ? "" : "disabled";
  const rot = (k) => (f.per === "S" ? `${dt(k).slice(0, 5)}` : mesLbl(k));
  return `${head(
    "T2",
    "Tesouraria Prevista",
    "Uso interno: quanto entra (adiantamento e autos) e quanto sai (materiais, salários, meios e outros custos) em cada período, para saber se a obra fica a crédito ou a débito. Os materiais pagam-se pela condição e pelo prazo de entrega escolhidos em Materiais. Valores sem IVA.",
    `<button class="cm-chip" type="button" data-fo="xlsx2">Excel</button>`
  )}
  ${baseNota(o)}
  <div class="cm-grupos">
    <span class="cm-chip"><span>Valor da obra (s/ IVA)</span><b>${fmt(o.PV)}</b></span>
    <span class="cm-chip"><span>Maior défice de tesouraria</span><b class="${T.minB < 0 ? "fo-neg" : ""}">${T.minB < 0 ? fmt(-T.minB) : "Sem défice"}</b></span>
    <span class="cm-chip"><span>O adiantamento paga a obra até</span><b>${!o.A ? "—" : !T.negativoEm ? "ao fim" : T.cobre ? rot(T.cobre) : `não chega (${rot(T.negativoEm)})`}</b></span>
    <span class="cm-chip"><span>Autos</span><b>${o.autos.length}</b></span>
  </div>
  <section class="cm-panel fo-regras">
    <b>Regras de pagamento</b>
    <label>Período <select class="cell-list" data-fof="per" ${dis}><option value="M"${f.per === "M" ? " selected" : ""}>Mensal</option><option value="S"${f.per === "S" ? " selected" : ""}>Semanal</option></select></label>
    <label>Salários <select class="cell-list" data-fof="sal" ${dis}>${[["fim", "No fim do mês"], ["5", "Dia 5 do mês seguinte"], ["10", "Dia 10 do mês seguinte"]].map(([v, l]) => `<option value="${v}"${String(f.sal) === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <label>Meios (dias após o fim do mês) <input type="number" min="0" class="cell-manual fo-n" data-fof="meios" value="${esc(f.meios)}" ${dis}></label>
    <label>Outros custos (dias) <input type="number" min="0" class="cell-manual fo-n" data-fof="outros" value="${esc(f.outros)}" ${dis}></label>
    <label>Encomenda antes da necessidade (dias) <input type="number" min="0" class="cell-manual fo-n" data-fof="antec" value="${esc(f.antec)}" ${dis}></label>
    <label>Saldo inicial <input type="number" step="any" class="cell-manual fo-n" data-fof="saldo0" value="${esc(f.saldo0)}" ${dis}></label>
  </section>
  <div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>${f.per === "S" ? "Semana" : "Mês"}</th><th class="num">Entradas</th><th class="num">Materiais</th><th class="num">Salários</th><th class="num">Meios</th><th class="num">Outros</th><th class="num">Saídas</th><th class="num">Saldo do período</th><th class="num">Acumulado</th></tr></thead>
  <tbody>${T.linhas
    .map(
      (x) => `<tr><td>${esc(rot(x.k))}</td><td class="num fo-pos">${x.ent ? fmt(x.ent) : ""}</td><td class="num">${x.mat ? fmt(x.mat) : ""}</td><td class="num">${x.sal ? fmt(x.sal) : ""}</td>
      <td class="num">${x.mei ? fmt(x.mei) : ""}</td><td class="num">${x.out ? fmt(x.out) : ""}</td><td class="num">${fmt(x.sai)}</td>
      <td class="num${x.saldo < 0 ? " fo-neg" : ""}">${fmt(x.saldo)}</td><td class="num${x.acum < 0 ? " fo-neg" : ""}"><b>${fmt(x.acum)}</b></td></tr>`
    )
    .join("")}</tbody>
  <tfoot><tr><td>Total</td><td class="num">${fmt(T.total.ent)}</td><td colspan="4"></td><td class="num">${fmt(T.total.sai)}</td><td class="num">${fmt(T.total.ent - T.total.sai)}</td><td></td></tr></tfoot></table></div>
  <p class="cm-calc">Produção = valor executado a preço de venda, ao ritmo dos custos do cronograma. A contingência entra como custo (cenário prudente). As entradas são os líquidos dos autos (sem a retenção).</p>
  <h3 class="cm-panel-title" style="margin-top:1rem">Autos de medição</h3>
  <div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>Auto</th><th>Data</th><th class="num">Valor</th><th class="num">Amortização</th><th class="num">Retenção</th><th class="num">Líquido</th><th>Recebimento</th></tr></thead>
  <tbody>${o.autos.map((x) => `<tr><td>${esc(x.desc || `Auto ${x.n}`)}</td><td>${dt(x.d)}</td><td class="num">${fmt(x.v)}</td><td class="num">${x.am ? fmt(-x.am) : ""}</td><td class="num">${x.rt ? fmt(-x.rt) : ""}</td><td class="num"><b>${fmt(x.liq)}</b></td><td>${dt(x.rc)}</td></tr>`).join("")}</tbody></table></div>
  <h3 class="cm-panel-title" style="margin-top:1rem">Plano de compras de materiais</h3>
  <p class="cm-calc">Fornecedor, condição de pagamento e prazo de entrega vêm da folha Materiais.</p>
  ${
    o.compras.length
      ? `<div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>Material</th><th>Fornecedor</th><th>Condição de pagamento</th><th>Primeira encomenda</th><th>Primeira necessidade em obra</th><th class="num">Valor</th><th>Pagamentos</th></tr></thead>
      <tbody>${o.compras
        .sort((x, y) => (x.enc < y.enc ? -1 : 1))
        .map((c) => `<tr><td>${esc(c.desc)}</td><td>${esc(c.forn || "—")}</td><td>${esc(c.cond)}</td><td>${dt(c.enc)}</td><td>${dt(c.nec)}</td><td class="num">${fmt(c.ct)}</td><td>${c.p1 === c.pN ? dt(c.p1) : `${dt(c.p1).slice(0, 5)} → ${dt(c.pN)}`}${c.faseado ? ' <span class="cm-calc">(faseado com a obra)</span>' : ""}</td></tr>`)
        .join("")}</tbody></table></div>`
      : `<p class="cm-lead">Sem materiais com custo.</p>`
  }`;
}

async function excel(qual) {
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = SHEETJS;
      s.onload = res;
      s.onerror = () => rej(new Error("não foi possível carregar o Excel"));
      document.head.appendChild(s);
    });
  }
  const o = calc();
  if (!o) return;
  let linhas;
  let nome;
  if (qual === "xlsx1") {
    const K = F.cliente(o, Number(C.S.doc.params.iva) || 0);
    linhas = [["Documento", "Data", "Valor", "Amortização", "Retenção", "Líquido", "IVA", "Total", "Aprovação", "Recebimento"], ...K.linhas.map((r) => [r.tipo, r.d, r.v, r.am, r.rt, r.liq, r.iva, r.tot, r.ap, r.rc])];
    nome = "Cronograma do cliente";
  } else {
    const T = F.tesouraria(o, o.f.per);
    linhas = [["Período", "Entradas", "Materiais", "Salários", "Meios", "Outros", "Saídas", "Saldo", "Acumulado"], ...T.linhas.map((x) => [x.k, x.ent, x.mat, x.sal, x.mei, x.out, x.sai, x.saldo, x.acum])];
    nome = "Tesouraria prevista";
  }
  const ws = window.XLSX.utils.aoa_to_sheet(linhas);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, nome.slice(0, 30));
  window.XLSX.writeFile(wb, `${nome} ${C.S.head?.number || ""}.xlsx`);
}

export function wireFinObra(getCtx) {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fo]");
    if (!b || !document.getElementById("cmContent")?.contains(b)) return;
    C = getCtx();
    excel(b.dataset.fo).catch((err) => toast(err.message || "Falha ao exportar.", { type: "error" }));
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!t.dataset?.fof || !document.getElementById("cmContent")?.contains(t)) return;
    C = getCtx();
    const S = C.S;
    if (!S.doc.production || typeof S.doc.production !== "object") S.doc.production = {};
    const fin = (S.doc.production.fin = S.doc.production.fin || {});
    const k = t.dataset.fof;
    fin[k] = k === "per" || k === "sal" ? t.value : Number(t.value) || 0;
    C.markDirty();
    C.render();
  });
}
