import { apiRequest } from "../../services/api.js";
import { getSessionUser } from "../../services/auth.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtQ, fmtD, fmtPct, mLbl, estPill, margemTom, errMsg, clientes, fichaHtml, lerFicha } from "./orcUi.js";
import {
  CATS,
  TIPOS,
  TT_PROJ,
  MODOS,
  ESTADOS,
  N,
  cTot,
  cQd,
  qSum,
  distOk,
  weeks,
  totais,
  pricing,
  cond,
  cambio,
  recebimentos,
  mensal,
  distribuir,
  condTxt,
} from "./orcCore.js";

/**
 * Orçamentação de Obras › um orçamento (OR2 Resumo, OR3 Orçamento de Custo,
 * OR4 Orçamento de Venda, OR5 Estado e Adjudicação, Ficha do Orçamento), como
 * no protótipo v605–v624.
 *
 * As alterações ficam pendentes até «Gravar Alterações» (com «Anular Última»
 * e «Descartar Tudo»), como no protótipo; a venda e o estado gravam logo.
 */

const root = () => document.getElementById("financeRoot");
const VIEWS = [
  ["resumo", "Resumo", "OR2", "Resumo"],
  ["custo", "Custo", "OR3", "Orçamento de Custo"],
  ["venda", "Venda", "OR4", "Orçamento de Venda"],
  ["estado", "Estado e Adjudicação", "OR5", "Estado e Adjudicação"],
  ["ficha", "Ficha do Orçamento", "OR6", "Ficha do Orçamento"],
];
const S = {
  id: null,
  b: null,
  doc: null,
  stack: [],
  erro: null,
  v: "resumo",
  prods: [],
  aberto: new Set(CATS),
  fCat: "",
  fTipo: "",
  q: "",
  sem: true,
};
const CLN = (x) => JSON.parse(JSON.stringify(x));
const uid = () => Math.random().toString(36).slice(2, 10);
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const isAdmin = () => String(getSessionUser()?.role || "").toLowerCase() === "admin";
const podeEditar = () => can("comercial", "edit") && S.b && (S.b.status !== "Adjudicado" || isAdmin());
const prodById = (id) => S.prods.find((p) => p.id === id);
const prodByName = (n) => {
  const k = norm(n);
  return k ? S.prods.find((p) => norm(p.name) === k) : null;
};
const semProduto = () => (S.doc?.cost || []).filter((l) => l.desc && l.tipo !== "Barem" && !(l.productId && prodById(l.productId)));
const UNIDADE = (u) => {
  const t = norm(u);
  return { m: "M", metro: "M", m2: "MT2", "m²": "MT2", m3: "MT3", "m³": "MT3", kg: "KG", ton: "TON", t: "TON", l: "L", lt: "L", h: "H", hora: "H", dia: "DIA", dias: "DIA", mes: "MES", "mês": "MES", cx: "CX", par: "PAR" }[t] || "UN";
};

// ── Alterações pendentes ────────────────────────────────────

function mudar(msg, fn) {
  if (!podeEditar()) return toast(S.b?.status === "Adjudicado" ? "Orçamento adjudicado: só o Administrador altera." : "Sem permissão para alterar.", { type: "error" });
  const antes = CLN(S.doc);
  fn(S.doc);
  if (JSON.stringify(antes) === JSON.stringify(S.doc)) return;
  S.stack.push({ snap: antes, msg });
  desenhar();
}
function anular() {
  const e = S.stack.pop();
  if (!e) return;
  S.doc = e.snap;
  toast(`Anulado: ${e.msg}`, { type: "info" });
  desenhar();
}
function descartar() {
  if (!S.stack.length) return;
  S.doc = S.stack[0].snap;
  S.stack = [];
  toast("Alterações descartadas.", { type: "info" });
  desenhar();
}
async function gravar(extraMsgs = []) {
  const msgs = [...S.stack.map((e) => e.msg), ...extraMsgs];
  const d = S.doc;
  const b = await apiRequest(`/work-budgets/${encodeURIComponent(S.id)}`, {
    method: "PATCH",
    body: {
      name: d.name,
      clientId: d.clientId || null,
      clientName: d.clientName || null,
      ficha: d.ficha || {},
      currency: d.currency,
      exchangeRate: d.currency === "AOA" ? null : N(d.exchangeRate) || null,
      pricing: d.pricing,
      startDate: d.startDate ? String(d.startDate).slice(0, 10) : null,
      endDate: d.endDate ? String(d.endDate).slice(0, 10) : null,
      cost: d.cost,
      sale: d.sale || {},
      msgs,
    },
  });
  S.b = { ...b, project: S.b?.project || null };
  S.doc = CLN(b);
  S.stack = [];
  return b;
}
const barra = () => {
  if (!podeEditar()) return S.b?.status === "Adjudicado" ? '<div class="orc-pend orc-pend--ok">Orçamento adjudicado — só leitura (o Administrador pode alterar).</div>' : "";
  if (!S.stack.length) return '<div class="orc-pend orc-pend--ok">✓ Tudo gravado</div>';
  return `<div class="orc-pend"><b>● ${S.stack.length} alteração(ões) por gravar</b><span class="orc-pend-ult">Última: ${esc(S.stack[S.stack.length - 1].msg)}</span><span class="t3-sp"></span>
    <button type="button" class="finance-btn finance-btn--sm" data-op="undo" title="Anula só a última alteração">↶ Anular Última</button>
    <button type="button" class="finance-btn finance-btn--sm" data-op="disc">Descartar Tudo</button>
    <button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-op="save">Gravar Alterações</button></div>`;
};

// ── Cabeçalho ───────────────────────────────────────────────

function cabecalho() {
  const d = S.doc;
  const t = totais(d);
  const [, , cod, titulo] = VIEWS.find((x) => x[0] === S.v);
  const h1 = document.querySelector("#financePageHeader .finance-title");
  if (h1) h1.innerHTML = `<span class="orc-num">${cod}</span>${esc(titulo)} · ${esc(S.b.code)}`;
  document.title = `Info Gestor — ${titulo} · ${S.b.code}`;
  return `${barra()}
    <div class="orc-tabs">${VIEWS.map(([k, l]) => `<button type="button" class="${S.v === k ? "on" : ""}" data-ov="${k}">${l}</button>`).join("")}</div>
    <p class="orc-linha"><b>${esc(d.name)}</b> · ${esc(d.clientName || "sem cliente")} · ${estPill(S.b.status)} · Custo <b>${fmt(t.custo)} AOA</b> · Venda <b>${fmt(t.venda)} ${esc(d.currency)}</b> · Margem <b class="orc-m--${margemTom(t.mp, pricing(d))}">${t.vendaAOA ? fmtPct(t.mp) : "—"}</b>${
      S.b.project ? ` · obra <a class="t3-lnk" href="/Projectos/projectView?id=${encodeURIComponent(S.b.project.id)}">${esc(S.b.project.referencia || S.b.project.name)}</a>` : ""
    }</p>`;
}

const kpi = (tom, titulo, valor, nota = "", extra = "") => `<div class="orc-k orc-k--${tom || "neu"}"><span>${titulo}</span><b>${valor}</b>${nota ? `<small>${nota}</small>` : ""}${extra}</div>`;

// ── OR2 Resumo ──────────────────────────────────────────────

function vResumo(ed) {
  const d = S.doc;
  const t = totais(d);
  const P = pricing(d);
  const m = d.currency || "AOA";
  const dis = ed ? "" : " disabled";
  const f2 = (label, ctl) => `<label class="t3-f"><span>${label}</span>${ctl}</label>`;
  // Custo por categoria › subcategoria do produto de cada linha.
  const G = new Map();
  for (const l of d.cost || []) {
    const p = l.productId ? prodById(l.productId) : null;
    const k = p ? `${p.catalogCategory?.name || "SEM CATEGORIA"}${p.catalogSubcategory?.name ? ` › ${p.catalogSubcategory.name}` : ""}` : "SEM PRODUTO (POR CRIAR)";
    const g = G.get(k) || { Compra: 0, Pessoal: 0, Barem: 0, tot: 0 };
    g[l.tipo || "Compra"] += cTot(l);
    g.tot += cTot(l);
    G.set(k, g);
  }
  const cats = [...G.entries()].sort((a, b) => b[1].tot - a[1].tot);
  const M = mensal(d);
  const hist = [...(S.b.history || [])].reverse();
  return `
    <div class="orc-kpis">
      ${kpi("blue", "Custo Total Previsto", `${fmt(t.custo)} AOA`, `${t.nLinhas} linha(s)${t.reserva ? ` · inclui ${fmt(t.reserva)} de reserva` : ""}`)}
      ${kpi(
        "neu",
        "Preço de Venda Sugerido",
        t.pv ? `${fmt(t.pv)} ${esc(m)}` : "—",
        `${P.metodo === "MARKUP" ? "markup" : "margem"} ${fmtPct(P.mObj)} ${P.metodo === "MARKUP" ? "sobre o custo" : "sobre a venda"}`,
        ed && t.pv ? `<button type="button" class="finance-btn finance-btn--sm orc-kbtn" data-op="usarpv">Usar como valor de venda</button>` : ""
      )}
      ${kpi("good", "Valor de Venda", t.venda ? `${fmt(t.venda)} ${esc(m)}` : "—", m !== "AOA" && t.vendaAOA ? `${fmt(t.vendaAOA)} AOA` : "")}
      ${kpi(margemTom(t.mp, P) || "neu", "Margem sobre a Venda", t.vendaAOA ? fmtPct(t.mp) : "—", t.vendaAOA ? `${fmt(t.margem)} AOA` : "falta o valor de venda")}
    </div>
    <div class="orc-2col">
      <section class="t3-sec"><h3>Moeda e Formação do Preço</h3><div class="t3-grid">
        ${f2("Moeda do Contrato", `<select class="finance-input" data-p="currency"${dis}>${["AOA", "USD", "EUR"].map((x) => `<option${x === m ? " selected" : ""}>${x}</option>`).join("")}</select>`)}
        ${m !== "AOA" ? f2(`Câmbio de Referência (AOA por 1 ${esc(m)})`, `<input class="finance-input" type="number" step="0.0001" data-p="exchangeRate" value="${esc(d.exchangeRate ?? "")}"${dis}>`) : ""}
        <label class="t3-f t3-w2"><span>Metodologia do Preço</span><select class="finance-input" data-p="metodo"${dis}><option value="MARGEM"${P.metodo === "MARGEM" ? " selected" : ""}>Margem sobre a venda — PV = Custo ÷ (1 − margem)</option><option value="MARKUP"${P.metodo === "MARKUP" ? " selected" : ""}>Markup sobre o custo — PV = Custo × (1 + markup)</option></select></label>
        ${f2("Margem Mínima (%)", `<input class="finance-input" type="number" step="0.1" data-p="mMin" value="${esc(P.mMin)}"${dis}>`)}
        ${f2("Margem Objetivo (%)", `<input class="finance-input" type="number" step="0.1" data-p="mObj" value="${esc(P.mObj)}"${dis}>`)}
        ${f2("Reserva para Imprevistos (%)", `<input class="finance-input" type="number" step="0.1" min="0" data-p="reserva" value="${esc(P.reserva)}"${dis}>`)}
        ${f2("Início Previsto (opcional)", `<input class="finance-input" type="date" data-p="startDate" value="${esc(String(d.startDate || "").slice(0, 10))}"${dis}>`)}
        ${f2("Fim Previsto (opcional)", `<input class="finance-input" type="date" data-p="endDate" value="${esc(String(d.endDate || "").slice(0, 10))}"${dis}>`)}
      </div>
      <p class="fx2-mut t3-small">O custo é sempre em AOA. Os preços entendem-se sem IVA (a MBT fatura sempre com IVA e retenção na fonte nos serviços). Os prazos definitivos fixam-se na adjudicação; aqui servem para a distribuição semanal do custo e para a previsão.</p></section>
      <section class="t3-sec"><h3>Como Ler</h3><p class="t3-small"><b>Preço de venda sugerido</b> = custo total ÷ (1 − margem objetivo) — ou custo × (1 + markup). <b>Margem sobre a venda</b> = (venda − custo) ÷ venda, em AOA. Abaixo da margem mínima fica a vermelho; entre a mínima e o objetivo, a laranja. O custo total inclui a reserva para imprevistos.</p></section>
    </div>
    <section class="t3-sec t3-flush"><h3 class="orc-h3pad">Custo por Categoria de Custo</h3>${
      cats.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Categoria › Subcategoria</th><th class="r">Compra</th><th class="r">Pessoal</th><th class="r">Barem</th><th class="r">Total (AOA)</th><th class="r">%</th></tr></thead><tbody>
        ${cats.map(([k, g]) => `<tr><td>${esc(k)}</td><td class="r">${g.Compra ? fmt(g.Compra) : "—"}</td><td class="r">${g.Pessoal ? fmt(g.Pessoal) : "—"}</td><td class="r">${g.Barem ? fmt(g.Barem) : "—"}</td><td class="r"><b>${fmt(g.tot)}</b></td><td class="r">${t.linhas ? fmtPct((g.tot / t.linhas) * 100) : "—"}</td></tr>`).join("")}
        </tbody><tfoot><tr><td>Subtotal</td><td class="r">${fmt(t.porTipo.Compra)}</td><td class="r">${fmt(t.porTipo.Pessoal)}</td><td class="r">${fmt(t.porTipo.Barem)}</td><td class="r">${fmt(t.linhas)}</td><td></td></tr>
        <tr><td>Reserva para imprevistos (${fmtPct(P.reserva)})</td><td></td><td></td><td></td><td class="r">${fmt(t.reserva)}</td><td></td></tr>
        <tr class="orc-tot"><td>Custo Total Orçamentado</td><td></td><td></td><td></td><td class="r">${fmt(t.custo)}</td><td></td></tr></tfoot></table></div>
        <p class="fx2-mut t3-small orc-pad">Categorias e subcategorias de Produtos e Serviços, tiradas do produto de cada linha. Compra vai para o planeamento de compras · Pessoal segue para o RH · Barem é custo interno.</p>`
        : '<p class="fx2-mut orc-pad">Sem custos.</p>'
    }</section>
    <section class="t3-sec t3-flush"><h3 class="orc-h3pad">Previsão Mensal (AOA)</h3>${
      M.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Mês</th><th class="r">Recebimentos Previstos</th><th class="r">Custo Previsto</th><th class="r">Saldo do Mês</th><th class="r">Saldo Acumulado</th></tr></thead><tbody>
        ${M.map((x) => `<tr><td>${mLbl(x.k)}</td><td class="r">${x.r ? fmt(x.r) : "—"}</td><td class="r">${x.c ? fmt(x.c) : "—"}</td><td class="r${x.s < 0 ? " fcal-out" : ""}">${fmt(x.s)}</td><td class="r${x.ac < 0 ? " fcal-out" : ""}"><b>${fmt(x.ac)}</b></td></tr>`).join("")}</tbody></table></div>
        <p class="fx2-mut t3-small orc-pad">Recebimentos = condições de pagamento do cliente (Venda). Custo = distribuição semanal do Orçamento de Custo. Saldo acumulado negativo = dinheiro que a MBT tem de adiantar à obra.</p>`
        : `<p class="fx2-mut orc-pad">${d.startDate && d.endDate ? "Sem custos distribuídos nem venda." : "Indique as datas de início e fim para ver a previsão."}</p>`
    }</section>
    <details class="t3-sec"><summary><b>Histórico de Alterações (${hist.length})</b></summary>
      <table class="fx2-t orc-hist"><tbody>${hist.map((h) => `<tr><td class="t3-nowrap fx2-mut">${new Date(h.d).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}</td><td class="t3-nowrap">${esc(h.u)}</td><td>${esc(h.t)}</td></tr>`).join("")}</tbody></table></details>`;
}

// ── OR3 Orçamento de Custo ──────────────────────────────────

function vCusto(ed) {
  const d = S.doc;
  const L = d.cost || [];
  const W = S.sem ? weeks(d) : [];
  const q = norm(S.q);
  const vis = (l) => (!S.fCat || l.cat === S.fCat) && (!S.fTipo || (l.tipo || "Compra") === S.fTipo) && (!q || norm(`${l.desc} ${l.un}`).includes(q));
  const falta = semProduto();
  const dis = ed ? "" : " disabled";
  const wCols = W.map((w) => `<th class="r orc-w">SEM ${String(w.i).padStart(2, "0")}<br><small>${w.ini.slice(8, 10)}/${w.ini.slice(5, 7)}–${w.fim.slice(8, 10)}/${w.fim.slice(5, 7)}</small></th>`).join("");
  const semT = (ls) => W.map((w) => ls.reduce((s, l) => s + N((l.q || {})[w.i]) * N(l.pu), 0));
  let corpo = "";
  CATS.forEach((cat, ci) => {
    const ls = L.filter((l) => l.cat === cat);
    const lv = ls.filter(vis);
    if (S.fCat && S.fCat !== cat) return;
    if ((S.fTipo || q) && !lv.length) return;
    const aberto = S.aberto.has(cat);
    const tot = ls.reduce((s, l) => s + cTot(l), 0);
    corpo += `<tr class="orc-cat"><td colspan="8"><button type="button" class="orc-tog" data-tog="${esc(cat)}">${aberto ? "▾" : "▸"} ${ci + 1}. ${esc(cat.toUpperCase())}</button> <span class="fx2-mut">${ls.length} linha(s)</span>${ed ? ` <button type="button" class="finance-btn finance-btn--sm" data-addl="${esc(cat)}">+ Linha</button>` : ""}<span class="orc-cat-tot">${fmt(tot)}</span></td>${semT(ls)
      .map((v) => `<td class="r"><b>${v ? fmt(v) : ""}</b></td>`)
      .join("")}<td></td></tr>`;
    if (!aberto) return;
    lv.forEach((l) => {
      const n = `${ci + 1}.${ls.indexOf(l) + 1}`;
      const p = l.productId ? prodById(l.productId) : null;
      const semP = l.desc && l.tipo !== "Barem" && !p;
      const ok = cQd(l) && distOk(l);
      const parecido = semP ? S.prods.find((x) => norm(x.name).includes(norm(l.desc).slice(0, 12)) && norm(l.desc).length >= 6) : null;
      corpo += `<tr data-row="${esc(l.id)}">
        <td class="fx2-mut">${n}</td>
        <td><input class="finance-input orc-in orc-desc${semP ? " orc-bad" : ""}" list="orcProds" data-l="${esc(l.id)}|desc" value="${esc(l.desc || "")}" placeholder="produto…"${dis} title="${semP ? "Este produto não existe em Produtos e Serviços" : esc(p?.sku || "")}"></td>
        <td><select class="finance-input orc-in orc-tipo" data-l="${esc(l.id)}|tipo"${dis}>${TIPOS.map((x) => `<option${(l.tipo || "Compra") === x ? " selected" : ""}>${x}</option>`).join("")}</select></td>
        <td><input class="finance-input orc-in orc-un" data-l="${esc(l.id)}|un" value="${esc(l.un || "")}"${dis}></td>
        <td><input class="finance-input orc-in orc-n" type="number" step="any" data-l="${esc(l.id)}|qt" value="${esc(l.qt ?? "")}"${dis}></td>
        <td><input class="finance-input orc-in orc-pu" type="number" step="any" data-l="${esc(l.id)}|pu" value="${esc(l.pu ?? "")}"${dis}></td>
        <td><input class="finance-input orc-in orc-n" type="number" step="any" data-l="${esc(l.id)}|hrs" value="${esc(l.hrs ?? "")}" placeholder="—"${dis}></td>
        <td class="r t3-nowrap"><b>${fmt(cTot(l))}</b>${W.length && cQd(l) ? (ok ? ' <span class="orc-ok" title="Quantidade toda distribuída">✓</span>' : ` <span class="orc-warn" title="Distribuído ${fmtQ(qSum(l))} de ${fmtQ(cQd(l))}">●</span>`) : ""}</td>
        ${W.map((w) => `<td><input class="finance-input orc-in orc-q" type="number" step="any" data-l="${esc(l.id)}|q|${w.i}" value="${esc((l.q || {})[w.i] ?? "")}" title="T = ${fmt(N((l.q || {})[w.i]) * N(l.pu))}"${dis}></td>`).join("")}
        <td class="t3-nowrap">${
          ed
            ? `${semP ? `<button type="button" class="t2-mini" data-mkp="${esc(l.id)}" title="Criar o produto «${esc(l.desc)}» em Produtos e Serviços">＋P</button>` : ""}${
                parecido ? `<button type="button" class="t2-mini" data-sim="${esc(l.id)}|${esc(parecido.id)}" title="Usar o produto parecido que já existe: «${esc(parecido.name)}»">≈</button>` : ""
              }${W.length ? `<button type="button" class="t2-mini" data-dist="${esc(l.id)}" title="Distribuir igualmente por todas as semanas">⇢</button>` : ""}<button type="button" class="t2-mini" data-del="${esc(l.id)}" title="Apagar a linha">×</button>`
            : ""
        }</td></tr>`;
    });
  });
  const t = totais(d);
  const nCat = (c) => L.filter((l) => l.cat === c).length;
  const nTipo = (k) => L.filter((l) => (l.tipo || "Compra") === k).length;
  return `
    ${
      falta.length
        ? `<div class="orc-aviso"><span><b>${falta.length} linha(s) com produtos que não existem</b> em Produtos e Serviços (campos a vermelho). Crie-os com ＋P ou escolha o parecido com ≈ — enquanto houver, o orçamento não pode ser adjudicado.</span>${ed ? `<button type="button" class="finance-btn finance-btn--primary" data-op="criarp">Criar Produtos em Falta (${falta.length})</button>` : ""}</div>`
        : ""
    }
    <div class="t3-bar">
      <input type="search" class="finance-input orc-q" data-cq placeholder="Procurar linha…" value="${esc(S.q)}">
      <span class="t3-small">Categoria:</span><span class="orc-chips">${[["", `Todas (${L.length})`], ...CATS.map((c) => [c, `${c} (${nCat(c)})`])].map(([k, l]) => `<button type="button" class="${S.fCat === k ? "on" : ""}" data-fcat="${esc(k)}">${esc(l)}</button>`).join("")}</span>
    </div>
    <div class="t3-bar">
      <span class="t3-small">Tipo:</span><span class="orc-chips">${[["", `Todos (${L.length})`], ...TIPOS.map((k) => [k, `${k} (${nTipo(k)})`])].map(([k, l]) => `<button type="button" class="${S.fTipo === k ? "on" : ""}" data-ftipo="${esc(k)}">${esc(l)}</button>`).join("")}</span>
      <span class="t3-sp"></span>
      <label class="t3-small t2-lbl"><input type="checkbox" data-sem${S.sem ? " checked" : ""}> Distribuição semanal</label>
      <button type="button" class="finance-btn finance-btn--sm" data-op="abrir">Abrir Todas</button>
      <button type="button" class="finance-btn finance-btn--sm" data-op="fechar">Fechar Todas</button>
      ${ed ? '<button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-addl="">+ Linha</button>' : ""}
    </div>
    ${S.sem && !W.length ? '<p class="fx2-mut t3-small">Para a distribuição semanal, indique o início e o fim previstos no Resumo.</p>' : ""}
    <datalist id="orcProds">${S.prods.map((p) => `<option value="${esc(p.name)}">`).join("")}</datalist>
    <section class="t3-sec t3-flush"><div class="fx2-tw orc-tw"><table class="fx2-t orc-custo">
      <thead><tr><th>Nº</th><th>Descrição (Produto)</th><th>Tipo</th><th>UN</th><th class="r">QTDE</th><th class="r">P. Unit.</th><th class="r">HRS</th><th class="r">Total</th>${wCols}<th></th></tr></thead>
      <tbody>${corpo || `<tr><td colspan="${9 + W.length}" class="fx2-mut">Sem linhas.</td></tr>`}</tbody>
      <tfoot><tr class="orc-tot"><td colspan="7">TOTAL DO CUSTO${t.reserva ? ` <span class="fx2-mut">(+ reserva ${fmt(t.reserva)} = ${fmt(t.custo)})</span>` : ""}</td><td class="r">${fmt(t.linhas)}</td>${semT(L).map((v) => `<td class="r">${fmt(v)}</td>`).join("")}<td></td></tr></tfoot>
    </table></div></section>
    <p class="fx2-mut t3-small">Total = QTDE × P. Unit. × HRS (HRS vazio conta 1). Em cada semana indique a quantidade (Q); o valor da semana (T = Q × P. Unit.) aparece ao passar o rato e nas linhas de total. ✓ = quantidade toda distribuída · ⇢ distribui igualmente · Campo a vermelho = produto que não existe em Produtos e Serviços: ＋P cria-o, ≈ usa o produto parecido que já existe. Nada é gravado sem carregar em Gravar Alterações.</p>`;
}

// ── OR4 Orçamento de Venda ──────────────────────────────────

function vVenda(ed) {
  const d = S.doc;
  const t = totais(d);
  const m = d.currency || "AOA";
  const c = cambio(d);
  const rep = d.sale?.rep || {};
  const TT = Object.keys(rep).filter((k) => N(rep[k]));
  const sR = TT.reduce((s, k) => s + N(rep[k]), 0);
  const R = recebimentos(d);
  let ac = 0;
  return `
    <div class="orc-kpis">
      ${kpi("neu", "Valor de Venda (s/ IVA)", `${fmt(t.venda)} ${esc(m)}`, d.sale?.valor ? "" : "ainda não confirmado — carregue em Editar Venda")}
      ${m !== "AOA" ? kpi(c ? "neu" : "bad", "Câmbio da Venda", c ? fmt(c) : "por indicar", `AOA por 1 ${esc(m)}`) : ""}
      ${kpi("good", "Venda em AOA", c ? fmt(t.vendaAOA) : "—")}
      ${kpi(margemTom(t.mp, pricing(d)) || "neu", "Margem sobre a Venda", t.vendaAOA ? fmtPct(t.mp) : "—", t.vendaAOA ? `${fmt(t.margem)} AOA` : "")}
    </div>
    <div class="t3-bar">${ed ? '<button type="button" class="finance-btn finance-btn--primary" data-op="venda">Editar Venda</button>' : ""}<span class="fx2-mut t3-small">Valor, moeda e câmbio, repartição por tipo de trabalho e condições de pagamento do cliente — tudo num só formulário.</span></div>
    <div class="orc-2col">
      <section class="t3-sec"><h3>Venda por Tipo de Trabalho</h3>${
        TT.length
          ? `<table class="fx2-t"><thead><tr><th>Tipo de trabalho</th><th class="r">Valor (${esc(m)})</th><th class="r">%</th></tr></thead><tbody>${TT.map((k) => `<tr><td>${esc(k)}</td><td class="r">${fmt(rep[k])}</td><td class="r">${t.venda ? fmtPct((N(rep[k]) / t.venda) * 100) : "—"}</td></tr>`).join("")}</tbody>
            <tfoot><tr class="orc-tot"><td>Total</td><td class="r">${fmt(sR)}</td><td class="r${Math.abs(sR - t.venda) > 0.5 ? " fcal-out" : ""}">${Math.abs(sR - t.venda) > 0.5 ? `falta ${fmt(t.venda - sR)}` : "✓"}</td></tr></tfoot></table>`
          : '<p class="t3-small fx2-mut">Ainda sem repartição. Em Editar Venda indique quanto do contrato é de cada tipo de trabalho (média tensão, baixa tensão, PT, iluminação pública, ligações).</p>'
      }</section>
      <section class="t3-sec"><h3>Condições de Pagamento do Cliente</h3><p class="t3-small"><b>${esc(condTxt(d))}</b></p>
        <p class="fx2-mut t3-small">Adiantamento, autos, prazos de aprovação e pagamento e retenção de garantia. Delas sai a previsão de recebimentos.</p></section>
    </div>
    <section class="t3-sec t3-flush"><h3 class="orc-h3pad">Recebimentos Previstos</h3>${
      R.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Data Prevista</th><th>Descrição</th><th class="r">Valor (${esc(m)})</th><th class="r">Acumulado (${esc(m)})</th></tr></thead><tbody>
        ${R.map((r) => {
          ac += r.v;
          return `<tr><td>${fmtD(r.d)}</td><td>${esc(r.desc)}</td><td class="r">${fmt(r.v)}</td><td class="r">${fmt(ac)}</td></tr>`;
        }).join("")}</tbody></table></div>`
        : `<p class="fx2-mut orc-pad">${!t.venda ? "Indique o valor de venda." : "Indique as datas de início e fim previstas (no Resumo)."}</p>`
    }</section>
    <p class="fx2-mut t3-small">Os preços entendem-se sem IVA.</p>`;
}

function editarVenda() {
  const d = S.doc;
  const c = cond(d);
  const rep = d.sale?.rep || {};
  const tipos = d.ficha?.tipos?.length ? d.ficha.tipos : TT_PROJ;
  const f2 = (label, ctl, cls = "") => `<label class="t3-f ${cls}"><span>${label}</span>${ctl}</label>`;
  const marcos = (c.marcos || []).length ? c.marcos : [{ pct: "", data: "", desc: "" }];
  const marcoRow = (x = {}) => `<div class="t3-grid orc-marco" data-marco>${f2("%", `<input class="finance-input" type="number" step="any" data-mk="pct" value="${esc(x.pct ?? "")}">`)}${f2("Data", `<input class="finance-input" type="date" data-mk="data" value="${esc(x.data || "")}">`)}${f2("Descrição", `<input class="finance-input" data-mk="desc" value="${esc(x.desc || "")}">`, "t3-w2")}</div>`;
  openModal({
    title: `<span class="rg-kick">VENDA · ${esc(S.b.code)}</span><br>Editar Venda`,
    width: 980,
    contentHtml: `<p class="fx2-mut t3-small">Valor do contrato, câmbio, repartição por tipo de trabalho e condições de pagamento do cliente.</p>
      <section class="t3-sec"><h3>Valor de Venda</h3><div class="t3-grid">
        ${f2("Moeda do contrato", `<select class="finance-input" id="evMoeda">${["AOA", "USD", "EUR"].map((x) => `<option${x === d.currency ? " selected" : ""}>${x}</option>`).join("")}</select>`)}
        ${f2(`Valor de venda s/ IVA <b class="t3-req">*</b>`, `<input class="finance-input" type="number" step="0.01" min="0" id="evValor" value="${esc(d.sale?.valor ?? "")}">`)}
        ${f2("Câmbio (AOA por 1 da moeda)", `<input class="finance-input" type="number" step="0.0001" id="evCambio" value="${esc(d.exchangeRate ?? "")}">`)}
        <div class="t3-f"><span>Venda em AOA</span><b id="evAoa">—</b></div>
      </div></section>
      <section class="t3-sec"><h3>Venda por Tipo de Trabalho</h3><p class="fx2-mut t3-small">Quanto do contrato é de cada tipo de trabalho (os tipos vêm da ficha do orçamento). Opcional, mas se indicar tem de somar o valor de venda.</p>
        <div class="t3-grid">${tipos.map((k) => f2(esc(k), `<input class="finance-input" type="number" step="0.01" min="0" data-rep="${esc(k)}" value="${esc(rep[k] ?? "")}">`)).join("")}</div>
        <p class="t3-small">Repartido: <b id="evRep">0,00</b> de <span id="evTot">0,00</span></p></section>
      <section class="t3-sec"><h3>Condições de Pagamento do Cliente</h3><div class="t3-grid">
        ${f2("Como é que o cliente paga", `<select class="finance-input" id="evModo">${MODOS.map(([k, l]) => `<option value="${k}"${c.modo === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`, "t3-w2")}
        ${f2("Autos de medição", `<select class="finance-input" id="evPer">${["Mensal", "Quinzenal", "Semanal"].map((x) => `<option value="${x}"${c.per === x ? " selected" : ""}>${x === "Mensal" ? "Mensais" : x === "Quinzenal" ? "Quinzenais" : "Semanais"}</option>`).join("")}</select>`)}
        ${f2("Dias até o cliente aprovar o auto", `<input class="finance-input" type="number" min="0" id="evAprov" value="${esc(c.aprov)}">`)}
        ${f2("Pagamento: dias após a aprovação", `<input class="finance-input" type="number" min="0" id="evPag" value="${esc(c.pag)}">`)}
        ${f2("Retenção de garantia (% de cada auto)", `<input class="finance-input" type="number" step="any" min="0" id="evRet" value="${esc(c.ret)}">`)}
        ${f2("Retenção devolvida ao fim de (anos)", `<input class="finance-input" type="number" min="1" id="evRetAnos" value="${esc(c.retAnos)}">`)}
        <span data-ad>${f2("Adiantamento (%)", `<input class="finance-input" type="number" step="any" min="0" id="evAdPct" value="${esc(c.adPct)}">`)}</span>
        <span data-ad>${f2("Data do adiantamento", `<input class="finance-input" type="date" id="evAdData" value="${esc(c.adData || "")}">`)}</span>
      </div>
      <div data-marcos><p class="t3-small"><b>Marcos</b> (percentagem do valor e data)</p><div id="evMarcos">${marcos.map(marcoRow).join("")}</div><button type="button" class="finance-btn finance-btn--sm" id="evMarcoAdd">+ Marco</button></div></section>`,
    primaryLabel: "Gravar",
    secondaryLabel: "Cancelar",
    onRender: ({ panel }) => {
      const b = panel.querySelector("[data-body]");
      const upd = () => {
        const v = N(b.querySelector("#evValor").value);
        const m = b.querySelector("#evMoeda").value;
        const cb = m === "AOA" ? 1 : N(b.querySelector("#evCambio").value);
        b.querySelector("#evAoa").textContent = v && cb ? fmt(v * cb) : "—";
        b.querySelector("#evCambio").closest("label").style.display = m === "AOA" ? "none" : "";
        const s = [...b.querySelectorAll("[data-rep]")].reduce((a, i) => a + N(i.value), 0);
        b.querySelector("#evRep").textContent = fmt(s);
        b.querySelector("#evTot").textContent = `${fmt(v)} ${m}`;
        const modo = b.querySelector("#evModo").value;
        b.querySelectorAll("[data-ad]").forEach((x) => (x.style.display = ["amort", "inicial"].includes(modo) ? "" : "none"));
        b.querySelector("[data-marcos]").style.display = modo === "marcos" ? "" : "none";
      };
      b.addEventListener("input", upd);
      b.addEventListener("change", upd);
      b.querySelector("#evMarcoAdd").addEventListener("click", () => b.querySelector("#evMarcos").insertAdjacentHTML("beforeend", marcoRow()));
      upd();
    },
    onPrimary: async ({ body, close, btn }) => {
      const g = (id) => body.querySelector(id)?.value ?? "";
      const valor = N(g("#evValor"));
      const moeda = g("#evMoeda");
      if (!(valor > 0)) return toast("Indique o valor de venda.", { type: "error" });
      if (moeda !== "AOA" && !(N(g("#evCambio")) > 0)) return toast("Indique o câmbio.", { type: "error" });
      const rep = Object.fromEntries([...body.querySelectorAll("[data-rep]")].filter((i) => N(i.value)).map((i) => [i.dataset.rep, N(i.value)]));
      const sR = Object.values(rep).reduce((a, x) => a + x, 0);
      if (sR && Math.abs(sR - valor) > 0.5) return toast(`A repartição soma ${fmt(sR)} e o valor de venda é ${fmt(valor)}.`, { type: "error" });
      const modo = g("#evModo");
      const marcos = [...body.querySelectorAll("[data-marco]")].map((r) => Object.fromEntries([...r.querySelectorAll("[data-mk]")].map((i) => [i.dataset.mk, i.dataset.mk === "pct" ? N(i.value) : i.value]))).filter((x) => x.pct > 0);
      if (modo === "marcos" && Math.abs(marcos.reduce((a, x) => a + x.pct, 0) - 100) > 0.01) return toast("Os marcos têm de somar 100 %.", { type: "error" });
      const novo = {
        valor,
        rep,
        cond: { modo, per: g("#evPer"), aprov: N(g("#evAprov")), pag: N(g("#evPag")), ret: g("#evRet") === "" ? "" : N(g("#evRet")), retAnos: N(g("#evRetAnos")) || 1, adPct: g("#evAdPct") === "" ? "" : N(g("#evAdPct")), adData: g("#evAdData"), marcos },
      };
      const antes = totais(S.doc).venda;
      btn.disabled = true;
      try {
        S.doc.currency = moeda;
        S.doc.exchangeRate = moeda === "AOA" ? null : N(g("#evCambio"));
        S.doc.sale = novo;
        await gravar([`Venda: ${fmt(valor)} ${moeda} (antes ${fmt(antes)}) · ${condTxt(S.doc)}`]);
        toast("Venda gravada.", { type: "success" });
        close();
        desenhar();
      } catch (e) {
        btn.disabled = false;
        toast(errMsg(e), { type: "error" });
      }
    },
  });
}

// ── OR5 Estado e Adjudicação ────────────────────────────────

function vEstado(ed) {
  const b = S.b;
  const adj = b.adjudication;
  return `<div class="orc-2col">
    <section class="t3-sec"><h3>Estado do Orçamento</h3><p class="t3-small">Estado atual: ${estPill(b.status)}</p>
      ${
        b.status === "Adjudicado"
          ? '<p class="fx2-mut t3-small">Adjudicado: o estado já não muda aqui.</p>'
          : ed
            ? `<div class="t3-bar"><select class="finance-input orc-auto" id="stSel">${ESTADOS.filter((e) => e !== "Adjudicado").map((e) => `<option${e === b.status ? " selected" : ""}>${esc(e)}</option>`).join("")}</select>
          <input class="finance-input" id="stNota" placeholder="nota (opcional: motivo, contacto…)"><button type="button" class="finance-btn" data-op="estado">Mudar Estado</button></div>`
            : ""
      }</section>
    <section class="t3-sec"><h3>Adjudicação</h3>${
      adj
        ? `<p class="t3-small">Adjudicado em <b>${fmtD(adj.data)}</b> · ${adj.igual === "Não" ? `valor negociado <b>${fmt(adj.valorAdj)}</b> (proposto ${fmt(adj.valorProposto)})` : `valor proposto <b>${fmt(adj.valorAdj)}</b>`} ${esc(b.currency)} · custo orçado ${fmt(adj.custo)} AOA${adj.contrato ? ` · contrato ${esc(adj.contrato)}` : ""} · prazo ${fmtD(adj.inicio)} a ${fmtD(adj.fimPrev)}.</p>
          ${b.project ? `<p class="t3-small">Obra: <a class="t3-lnk" href="/Projectos/projectView?id=${encodeURIComponent(b.project.id)}"><b>${esc(b.project.referencia || b.project.name)}</b></a> — veja em Obras.</p>` : ""}`
        : `<p class="t3-small">Quando o cliente adjudicar, carregue em <b>Adjudicar</b>: indica se o valor foi o proposto ou negociado, as datas da obra e o contrato. O programa <b>cria a obra</b> com o custo orçado, o valor final de venda e a margem prevista.</p>
          ${ed ? '<button type="button" class="finance-btn finance-btn--primary" data-op="adjudicar">Adjudicar…</button>' : ""}`
    }</section></div>
    ${
      ed && b.status !== "Adjudicado"
        ? `<section class="t3-sec orc-perigo"><h3>Apagar Orçamento</h3><p class="t3-small">Para orçamentos repetidos ou feitos por engano. Fica no arquivo (pode ser reposto pelo Administrador).</p><button type="button" class="finance-btn orc-btn-perigo" data-op="apagar">Apagar Este Orçamento</button></section>`
        : ""
    }`;
}

async function adjudicar() {
  if (S.stack.length) return toast("Grave primeiro as alterações (Gravar Alterações).", { type: "error" });
  const d = S.doc;
  const falta = semProduto();
  if (falta.length) return toast(`Não é possível adjudicar: ${falta.length} linha(s) do orçamento de custo têm produtos que não existem em Produtos e Serviços. No Orçamento de Custo use «Criar Produtos em Falta».`, { type: "error" });
  const t = totais(d);
  if (!t.venda) return toast("Indique primeiro o valor de venda (Venda › Editar Venda).", { type: "error" });
  const m = d.currency || "AOA";
  const hoje = new Date().toISOString().slice(0, 10);
  const f2 = (label, ctl, cls = "") => `<label class="t3-f ${cls}"><span>${label}</span>${ctl}</label>`;
  openModal({
    title: `<span class="rg-kick">ADJUDICAÇÃO · ${esc(S.b.code)}</span><br>Adjudicar Orçamento`,
    width: 860,
    contentHtml: `<p class="fx2-mut t3-small">${esc(d.name)}</p>
      <section class="t3-sec"><h3>Valor</h3><p class="t3-small">Valor proposto: <b>${fmt(t.venda)} ${esc(m)}</b>${m !== "AOA" && cambio(d) ? ` = ${fmt(t.vendaAOA)} AOA` : ""}</p><div class="t3-grid">
        ${f2("O valor adjudicado foi o proposto?", `<select class="finance-input" id="adIgual"><option value="Sim">Sim, o valor proposto</option><option value="Não">Não, houve negociação</option></select>`, "t3-w2")}
        <span data-neg style="display:none">${f2(`Valor adjudicado s/ IVA (${esc(m)}) <b class="t3-req">*</b>`, `<input class="finance-input" type="number" step="0.01" id="adValor" value="${esc(t.venda)}">`)}</span>
        <span data-neg style="display:none" class="t3-w2">${f2("O que foi negociado", '<input class="finance-input" id="adNotas">')}</span>
        ${m !== "AOA" ? f2(`Câmbio do contrato (AOA por 1 ${esc(m)}) <b class="t3-req">*</b>`, `<input class="finance-input" type="number" step="0.0001" id="adCambio" value="${esc(d.exchangeRate ?? "")}">`) : ""}
      </div></section>
      <section class="t3-sec"><h3>Contrato e Prazos</h3><div class="t3-grid">
        ${f2('Data da adjudicação <b class="t3-req">*</b>', `<input class="finance-input" type="date" id="adData" value="${hoje}">`)}
        ${f2("N.º do contrato", '<input class="finance-input" id="adContrato">')}
        ${f2('Início da obra <b class="t3-req">*</b>', `<input class="finance-input" type="date" id="adIni" value="${esc(String(d.startDate || "").slice(0, 10))}">`)}
        ${f2('Conclusão prevista <b class="t3-req">*</b>', `<input class="finance-input" type="date" id="adFim" value="${esc(String(d.endDate || "").slice(0, 10))}">`)}
        ${f2('Código / sigla da obra <b class="t3-req">*</b>', `<input class="finance-input" id="adCod" value="${esc(d.ficha?.sigla || "")}" maxlength="16" placeholder="fica como referência e centro de custo da obra">`)}
      </div></section>
      <p class="fx2-mut t3-small">Ao confirmar, o programa cria a obra em Obras com o custo orçado, o valor de venda final e a margem prevista.</p>`,
    primaryLabel: "Confirmar Adjudicação",
    secondaryLabel: "Cancelar",
    onRender: ({ panel }) => {
      const b = panel.querySelector("[data-body]");
      b.querySelector("#adIgual").addEventListener("change", (e) => b.querySelectorAll("[data-neg]").forEach((x) => (x.style.display = e.target.value === "Não" ? "" : "none")));
    },
    onPrimary: async ({ body, close, btn }) => {
      const g = (id) => body.querySelector(id)?.value?.trim() ?? "";
      const igual = g("#adIgual");
      const vA = igual === "Não" ? N(g("#adValor")) : t.venda;
      const E = [];
      if (!(vA > 0)) E.push("valor adjudicado");
      if (m !== "AOA" && !(N(g("#adCambio")) > 0)) E.push("câmbio do contrato");
      if (!g("#adData")) E.push("data da adjudicação");
      if (!g("#adIni") || !g("#adFim")) E.push("datas de início e de conclusão");
      else if (g("#adFim") < g("#adIni")) E.push("a conclusão é antes do início");
      const cod = g("#adCod").toUpperCase().replace(/\s+/g, "-");
      if (!cod) E.push("código / sigla da obra");
      else if (!/^[A-Z0-9][A-Z0-9/.-]{1,15}$/.test(cod)) E.push("código só com letras, números, / . e hífen");
      if (E.length) return toast(`Falta / corrigir: ${E.join(" · ")}.`, { type: "error" });
      btn.disabled = true;
      try {
        const proj = await apiRequest("/projects", {
          method: "POST",
          body: {
            name: d.name,
            clientId: d.clientId || null,
            region: d.ficha?.provincia || null,
            location: d.ficha?.local || null,
            startDate: g("#adIni"),
            dueDate: g("#adFim"),
            budgetTotal: t.custo,
            currency: m,
            referencia: cod,
            subempreiteiro: d.ficha?.temSub === "Sim" ? "Sim" : null,
          },
        });
        const projectId = proj?.id || proj?.project?.id;
        const b = await apiRequest(`/work-budgets/${encodeURIComponent(S.id)}/adjudicate`, {
          method: "POST",
          body: {
            projectId,
            data: g("#adData"),
            igual,
            valorProposto: t.venda,
            valorAdj: vA,
            notas: g("#adNotas") || null,
            contrato: g("#adContrato") || null,
            cambio: m === "AOA" ? null : N(g("#adCambio")),
            inicio: g("#adIni"),
            fimPrev: g("#adFim"),
          },
        });
        toast(`Adjudicado — obra ${cod} criada.`, { type: "success" });
        close();
        S.b = { ...b, project: { id: projectId, referencia: cod, name: d.name } };
        S.doc = CLN(b);
        desenhar();
      } catch (e) {
        btn.disabled = false;
        toast(errMsg(e), { type: "error" });
      }
    },
  });
}

// ── Ficha ───────────────────────────────────────────────────

async function vFicha(ed) {
  const L = await clientes();
  return `<div data-ficha>${fichaHtml(S.doc, L, { comPreco: false })}</div>
    ${ed ? '<div class="t3-bar"><button type="button" class="finance-btn finance-btn--primary" data-op="ficha">Aplicar à ficha</button><span class="fx2-mut t3-small">Depois carregue em Gravar Alterações.</span></div>' : ""}
    <p class="fx2-mut t3-small">A moeda e a formação do preço estão no Resumo.</p>`;
}

// ── Desenho e eventos ───────────────────────────────────────

async function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = `<div class="finance-empty">Não foi possível abrir o orçamento: ${esc(S.erro)}</div>`);
  if (!S.doc) return (el.innerHTML = '<div class="finance-empty">A carregar…</div>');
  const ed = podeEditar();
  const corpo = S.v === "custo" ? vCusto(ed) : S.v === "venda" ? vVenda(ed) : S.v === "estado" ? vEstado(ed) : S.v === "ficha" ? await vFicha(ed) : vResumo(ed);
  const y = window.scrollY;
  el.innerHTML = cabecalho() + corpo;
  window.scrollTo(0, y);
}

const linha = (id) => (S.doc.cost || []).find((l) => l.id === id);

async function criarProduto(l) {
  const kind = l.tipo === "Pessoal" ? "SERVICO" : "PRODUTO";
  const p = await apiRequest("/products", {
    method: "POST",
    body: { name: l.desc, unit: UNIDADE(l.un), kind, conditions: ["COMERCIAL", "COMPRA"], vatPercent: 14, minStock: 0 },
  });
  S.prods.push(p);
  return p;
}

async function criarEmFalta() {
  const L = semProduto();
  let criados = 0;
  let ligados = 0;
  const erros = [];
  const antes = CLN(S.doc);
  for (const l of L) {
    const ex = prodByName(l.desc);
    if (ex) {
      l.productId = ex.id;
      ligados++;
      continue;
    }
    try {
      const p = await criarProduto(l);
      l.productId = p.id;
      criados++;
    } catch (e) {
      erros.push(`${l.desc}: ${errMsg(e)}`);
    }
  }
  if (criados || ligados) S.stack.push({ snap: antes, msg: `Produtos em falta: ${criados} criado(s), ${ligados} ligado(s) a produtos existentes` });
  toast(`${criados} produto(s) criado(s)${ligados ? ` · ${ligados} ligado(s) a existentes` : ""}${erros.length ? ` · ${erros.length} com erro: ${erros.slice(0, 2).join("; ")}` : ""}.`, { type: erros.length ? "info" : "success" });
  desenhar();
}

function ligar() {
  const el = root();
  el.addEventListener("click", async (e) => {
    const t = e.target;
    const tab = t.closest("[data-ov]");
    if (tab) {
      S.v = tab.dataset.ov;
      history.replaceState(null, "", `?id=${encodeURIComponent(S.id)}&v=${S.v}`);
      return desenhar();
    }
    const op = t.closest("[data-op]")?.dataset.op;
    if (op === "undo") return anular();
    if (op === "disc") return descartar();
    if (op === "save") {
      try {
        const n = S.stack.length;
        await gravar();
        toast(`Alterações gravadas (${n}).`, { type: "success" });
        return desenhar();
      } catch (err) {
        return toast(errMsg(err), { type: "error" });
      }
    }
    if (op === "abrir") {
      CATS.forEach((c) => S.aberto.add(c));
      return desenhar();
    }
    if (op === "fechar") {
      S.aberto.clear();
      return desenhar();
    }
    if (op === "venda") return editarVenda();
    if (op === "adjudicar") return adjudicar();
    if (op === "criarp") return criarEmFalta();
    if (op === "usarpv") {
      const v = totais(S.doc).pv;
      return mudar(`Venda: valor sugerido pela margem objetivo ${fmt(v)} ${S.doc.currency}`, (d) => (d.sale = { ...(d.sale || {}), valor: v }));
    }
    if (op === "ficha") {
      const L = await clientes();
      const f = lerFicha(el.querySelector("[data-ficha]"), L, S.doc);
      if (f.erro) return toast(f.erro, { type: "error" });
      return mudar("Ficha do orçamento alterada", (d) => Object.assign(d, f));
    }
    if (op === "estado") {
      const st = el.querySelector("#stSel").value;
      if (st === S.b.status) return;
      try {
        const b = await apiRequest(`/work-budgets/${encodeURIComponent(S.id)}/status`, { method: "POST", body: { status: st, nota: el.querySelector("#stNota").value.trim() || null } });
        S.b = { ...S.b, status: b.status, history: b.history };
        toast("Estado mudado.", { type: "success" });
        return desenhar();
      } catch (err) {
        return toast(errMsg(err), { type: "error" });
      }
    }
    if (op === "apagar") {
      if (!window.confirm(`Apagar o orçamento ${S.b.code}?`)) return;
      try {
        await apiRequest(`/work-budgets/${encodeURIComponent(S.id)}`, { method: "DELETE" });
        toast("Orçamento apagado.", { type: "success" });
        location.href = "/orcamentacao/";
      } catch (err) {
        toast(errMsg(err), { type: "error" });
      }
      return;
    }
    const tog = t.closest("[data-tog]");
    if (tog) {
      const c = tog.dataset.tog;
      if (S.aberto.has(c)) S.aberto.delete(c);
      else S.aberto.add(c);
      return desenhar();
    }
    const fc = t.closest("[data-fcat]");
    if (fc) {
      S.fCat = fc.dataset.fcat;
      return desenhar();
    }
    const ft = t.closest("[data-ftipo]");
    if (ft) {
      S.fTipo = ft.dataset.ftipo;
      return desenhar();
    }
    const add = t.closest("[data-addl]");
    if (add) {
      const cat = add.dataset.addl || S.fCat || "Material";
      S.aberto.add(cat);
      return mudar(`Nova linha em ${cat}`, (d) => (d.cost = [...(d.cost || []), { id: uid(), cat, tipo: cat === "Mão de Obra" ? "Pessoal" : "Compra", desc: "", un: "", qt: "", pu: "", hrs: "", q: {} }]));
    }
    const del = t.closest("[data-del]");
    if (del) {
      const l = linha(del.dataset.del);
      return mudar(`Linha apagada: ${l?.desc || "(sem descrição)"}`, (d) => (d.cost = d.cost.filter((x) => x.id !== del.dataset.del)));
    }
    const dist = t.closest("[data-dist]");
    if (dist) {
      const l = linha(dist.dataset.dist);
      return mudar(`${l.desc || "Linha"}: distribuída igualmente por ${weeks(S.doc).length} semana(s)`, () => (l.q = distribuir(l, weeks(S.doc))));
    }
    const mkp = t.closest("[data-mkp]");
    if (mkp) {
      const l = linha(mkp.dataset.mkp);
      try {
        const antes = CLN(S.doc);
        const p = await criarProduto(l);
        l.productId = p.id;
        S.stack.push({ snap: antes, msg: `Produto criado: ${p.name}` });
        toast(`Produto «${p.name}» criado em Produtos e Serviços.`, { type: "success" });
        return desenhar();
      } catch (err) {
        return toast(errMsg(err), { type: "error" });
      }
    }
    const sim = t.closest("[data-sim]");
    if (sim) {
      const [lid, pid] = sim.dataset.sim.split("|");
      const p = prodById(pid);
      return mudar(`Linha ligada ao produto existente ${p?.name}`, () => {
        const l = linha(lid);
        l.productId = pid;
        l.desc = p.name;
        if (!l.un && p.unit) l.un = p.unit;
      });
    }
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.sem !== undefined) {
      S.sem = t.checked;
      return desenhar();
    }
    if (t.dataset.p) {
      const k = t.dataset.p;
      const v = t.value;
      const nomes = { currency: "moeda", exchangeRate: "câmbio", metodo: "metodologia", mMin: "margem mínima", mObj: "margem objetivo", reserva: "reserva para imprevistos", startDate: "início previsto", endDate: "fim previsto" };
      return mudar(`Resumo: ${nomes[k]} → ${v || "—"}`, (d) => {
        if (["metodo", "mMin", "mObj", "reserva"].includes(k)) d.pricing = { ...pricing(d), [k]: k === "metodo" ? v : N(v) };
        else if (k === "exchangeRate") d.exchangeRate = N(v) || null;
        else d[k] = v || null;
      });
    }
    if (t.dataset.l) {
      const [id, campo, w] = t.dataset.l.split("|");
      const l = linha(id);
      if (!l) return;
      const v = t.value;
      if (campo === "q") return mudar(`${l.desc || "Linha"}: semana ${w} → ${v || 0}`, () => {
        l.q = { ...(l.q || {}) };
        if (v === "" || N(v) === 0) delete l.q[w];
        else l.q[w] = N(v);
      });
      if (campo === "desc") {
        return mudar(`Linha: produto → ${v || "—"}`, () => {
          l.desc = v.trim().toUpperCase();
          const p = prodByName(l.desc);
          l.productId = p?.id || null;
          if (p) {
            l.desc = p.name;
            if (!l.un && p.unit) l.un = p.unit;
            if (!N(l.pu) && p.precoRef?.valor) l.pu = p.precoRef.valor;
          }
        });
      }
      return mudar(`${l.desc || "Linha"}: ${campo === "qt" ? "QTDE" : campo === "pu" ? "P. Unit." : campo === "hrs" ? "HRS" : campo === "un" ? "UN" : "tipo"} → ${v || "—"}`, () => {
        l[campo] = ["qt", "pu", "hrs"].includes(campo) ? (v === "" ? "" : N(v)) : v;
      });
    }
  });
  let tempo = null;
  el.addEventListener("input", (e) => {
    if (e.target.dataset.cq === undefined) return;
    S.q = e.target.value;
    clearTimeout(tempo);
    tempo = setTimeout(async () => {
      await desenhar();
      const n = root().querySelector("[data-cq]");
      n?.focus();
      n?.setSelectionRange(n.value.length, n.value.length);
    }, 300);
  });
  window.addEventListener("beforeunload", (e) => {
    if (S.stack.length) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

export async function render() {
  const q = new URLSearchParams(location.search);
  S.id = q.get("id");
  S.v = VIEWS.some((x) => x[0] === q.get("v")) ? q.get("v") : "resumo";
  ligar();
  desenhar();
  if (!S.id) {
    S.erro = "falta o orçamento";
    return desenhar();
  }
  try {
    const [b, prods] = await Promise.all([apiRequest(`/work-budgets/${encodeURIComponent(S.id)}`), apiRequest("/products").catch(() => ({ items: [] }))]);
    S.b = b;
    S.doc = CLN(b);
    S.prods = (prods.items || []).filter((p) => p.active !== false);
  } catch (e) {
    S.erro = errMsg(e);
  }
  desenhar();
}
