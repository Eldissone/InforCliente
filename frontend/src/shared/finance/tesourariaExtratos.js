import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { MOVEMENT_TYPE } from "./movementsShared.js";
import { conciliado } from "./conciliacao.js";
import { abrirRegras, abrirTipos } from "./extratoRegras.js";
import {
  CAMPOS,
  tabelaDeTexto,
  linhaCabecalho,
  mapaAuto,
  movimentosDaTabela,
  contaDoFicheiro,
  saldoAnterior,
  saldoFinal,
  tipoPelasRegras,
  chaveMov,
} from "./extratoImportCore.js";

/**
 * T3 Extratos Bancários — o `V.fextr` do protótipo (versão 624).
 *
 *  1. Conta do extrato  →  2. «⬆ Escolher o Ficheiro do Extrato» (CSV, TXT,
 *     Excel). Abre a caixa «Importar Extrato»: a conta (o n.º escrito no
 *     ficheiro confirma-a), o saldo anterior como saldo inicial, as colunas
 *     (detetadas sozinhas), as primeiras linhas e «Importar N movimento(s)»,
 *     sem os que já estão importados nessa conta.
 *  - Resumo por conta / cartão: movimentos, último movimento importado e
 *    quantos estão por conciliar (abre a T2 Conciliação nessa conta).
 *  - «Importações de extrato»: cada ficheiro importado, com o período, os
 *    movimentos e os conciliados; mover para outra conta ou apagar.
 *  - «Regras de Classificação» (a descrição contém… → tipo) e «Tipos».
 * A classificação e a conciliação de cada movimento fazem-se na T2.
 */

const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const BANCOS = {
  BFA: "Banco de Fomento Angola",
  BAI: "Banco Angolano de Investimentos",
  BIC: "Banco BIC",
  BPC: "Banco de Poupança e Crédito",
  BCGA: "Banco Caixa Geral Angola",
  BMA: "Banco Millennium Atlântico",
  ATL: "Banco Millennium Atlântico",
  SOL: "Banco Sol",
  KEVE: "Banco Keve",
  BNI: "Banco de Negócios Internacional",
  SBA: "Standard Bank Angola",
  YETU: "Banco Yetu",
  BCI: "Banco de Comércio e Indústria",
  BVB: "Banco Valor",
};
const TIPO_CARTAO = { DEBITO: ["neu", "Débito"], CREDITO: ["warn", "Crédito"], PREPAGO: ["neu", "Pré-pago"] };

const S = { cards: [], statements: [], movs: [], regras: [], conta: "", imp: null, erro: null, carregado: false };
const root = () => document.getElementById("financeRoot");
const fmt = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (iso) => {
  const s = String(iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
};
const contaCod = (c) => (c ? [c.bank, c.label].filter(Boolean).join(" ") + (c.lastDigits ? ` •${c.lastDigits}` : "") : "Sem conta");
const bancoLbl = (b) => {
  const k = String(b || "").toUpperCase().trim();
  return BANCOS[k] ? `${k} — ${BANCOS[k]}` : b || "—";
};
const edita = () => can("financeiro", "edit");

// ── Desenho ─────────────────────────────────────────────────

function caixaImportar() {
  const I = S.imp;
  if (!I) return "";
  const rows = I.rows;
  const keys = new Set(S.movs.filter((m) => m.card?.id === I.contaId || m.cardId === I.contaId).map((m) => chaveMov(String(m.movementDate).slice(0, 10), m.direction === "SAIDA" ? -m.amount : Number(m.amount), m.description)));
  const dup = I.contaId ? rows.filter((m) => keys.has(chaveMov(m.data, m.valor, m.desc))).length : 0;
  const novos = I.contaId ? rows.length - dup : 0;
  const ic = S.cards.find((c) => c.id === I.contaId);
  const D = I.det || {};
  const difer = D.conta && I.contaId && D.conta.id !== I.contaId;
  const cab = I.hi >= 0 ? I.tabela[I.hi] || [] : [];
  const cols = Math.max(...I.tabela.slice(Math.max(0, I.hi), I.hi + 30).map((r) => r.length), 1);
  const opt = (k) =>
    `<select class="finance-input" data-impmap="${k}"><option value="-1">—</option>${Array.from({ length: cols }, (_, j) => `<option value="${j}"${I.map[k] === j ? " selected" : ""}>${esc(String(cab[j] || `Coluna ${j + 1}`).slice(0, 28))}</option>`).join("")}</select>`;
  const ent = rows.filter((m) => m.valor > 0).reduce((s, m) => s + m.valor, 0);
  const sai = -rows.filter((m) => m.valor < 0).reduce((s, m) => s + m.valor, 0);
  return `<section class="t3-sec t3-imp">
    <h3>Importar Extrato “${esc(I.nome)}”</h3>
    <div class="t3-grid">
      <label class="t3-f t3-w2"><span>Conta deste extrato <b class="t3-req">*</b></span>
        <select class="finance-input" data-impconta="1"><option value="">— escolha a conta —</option>${S.cards.map((c) => `<option value="${esc(c.id)}"${c.id === I.contaId ? " selected" : ""}>${esc(contaCod(c))}</option>`).join("")}</select></label>
      <div class="t3-w2 t3-det">${
        D.conta
          ? `<span class="t3-good">✓ O ficheiro indica a conta <b>${esc(D.num)}</b> → <b>${esc(contaCod(D.conta))}</b></span>`
          : D.num
            ? `<span class="t3-warn">O ficheiro indica a conta <b>${esc(D.num)}</b>, que não está registada em Contas e Cartões. Confirme a conta à mão.</span>`
            : `<span class="fx2-mut">O ficheiro não indica o n.º da conta. Escolha a conta com atenção.</span>`
      }</div>
    </div>
    ${difer ? `<p class="t3-bad">⚠ Atenção: o ficheiro é da conta ${esc(contaCod(D.conta))}, mas escolheu ${esc(contaCod(ic))}.</p>` : ""}
    ${I.saldoAnt && ic ? `<label class="t3-chk"><input type="checkbox" data-impsi="1"${I.usarSI ? " checked" : ""}> Usar o saldo ${I.saldoAnt.calculado ? "antes do 1.º movimento (calculado do extrato)" : "anterior do extrato"} (<b>${fmt(I.saldoAnt.valor)}</b>) como saldo inicial deste extrato</label>` : ""}
    ${I.saldoFim !== null ? `<p class="fx2-mut t3-small">Saldo final do extrato: <b>${fmt(I.saldoFim)}</b> — passa a ser o saldo da conta nessa data.</p>` : ""}
    <details class="t3-cols"><summary>Colunas do ficheiro (detetadas automaticamente — abra só se algo estiver errado)</summary>
      <p class="fx2-mut t3-small">Confirme que coluna corresponde a cada campo. Valor com sinal numa só coluna, ou Débito e Crédito em duas.</p>
      <div class="t3-grid">${CAMPOS.map(([k, l]) => `<label class="t3-f"><span>${esc(l)}</span>${opt(k)}</label>`).join("")}
        <label class="t3-f"><span>Linha de cabeçalho</span><input class="finance-input" type="number" min="0" data-impmap="hi" value="${I.hi + 1}"></label></div>
    </details>
    <div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Data</th><th>Descrição</th><th class="r">Valor</th><th>Tipo</th><th>Doc.</th></tr></thead><tbody>
      ${rows
        .slice(0, 8)
        .map((m) => `<tr><td>${fmtD(m.data)}</td><td>${esc(m.desc)}</td><td class="r${m.valor < 0 ? " fcal-out" : ""}">${fmt(m.valor)}</td><td>${esc(MOVEMENT_TYPE[tipoDe(m)]?.label || "")}</td><td>${esc(m.docn || m.ref || "")}</td></tr>`)
        .join("")}
      ${rows.length > 8 ? `<tr><td colspan="5" class="fx2-mut">… mais ${rows.length - 8} linhas</td></tr>` : ""}
      ${rows.length ? "" : `<tr><td colspan="5" class="fx2-mut">Nenhuma linha com data e valor. Confira as colunas acima.</td></tr>`}
    </tbody></table></div>
    <div class="t3-acts">
      <button type="button" class="finance-btn finance-btn--primary" data-t3="impgo"${novos > 0 && edita() ? "" : " disabled"}>Importar ${Math.max(0, novos)} movimento(s)</button>
      <button type="button" class="finance-btn" data-t3="impcancel">Cancelar</button>
      <span class="fx2-mut t3-small">${rows.length} linhas válidas · entradas ${fmt(ent)} · saídas ${fmt(sai)}${dup ? ` · ${dup} já importadas (ignoradas)` : ""}${I.contaId ? "" : ' · <b class="t3-bad">escolha a conta do extrato</b>'}</span>
    </div>
  </section>`;
}

function resumo() {
  const C = S.cards.filter((c) => c.active !== false).sort((a, b) => contaCod(a).localeCompare(contaCod(b), "pt", { numeric: true }));
  if (!C.length) return "";
  return `<section class="t3-sec t3-flush"><div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Conta / Cartão</th><th>Banco</th><th>Tipo</th><th class="r">Movimentos</th><th>Último movimento importado</th><th class="r">Por conciliar</th></tr></thead><tbody>
    ${C.map((c) => {
      const M = S.movs.filter((m) => (m.card?.id || m.cardId) === c.id);
      const u = M.reduce((a, m) => (String(m.movementDate).slice(0, 10) > a ? String(m.movementDate).slice(0, 10) : a), "");
      const p = M.filter((m) => !conciliado(m)).length;
      const [tom, tipo] = TIPO_CARTAO[c.type] || ["neu", c.type || "—"];
      return `<tr><td><b>${esc(contaCod(c))}</b></td><td class="fx2-mut">${esc(bancoLbl(c.bank))}</td><td><span class="fcal-pill fcal-pill--${tom === "warn" ? "warn" : "slate"}">${esc(tipo)}</span></td>
        <td class="r">${M.length}</td><td>${u ? fmtD(u) : '<span class="fx2-mut">sem extratos</span>'}</td>
        <td class="r">${p ? `<a class="t3-lnk" href="/Financeiro/conciliacao?conta=${encodeURIComponent(c.id)}"><b class="t3-warn">${p}</b> ›</a>` : '<span class="fx2-mut">0</span>'}</td></tr>`;
    }).join("")}</tbody></table></div></section>`;
}

function importacoes() {
  const L = [...S.statements].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!L.length) return "";
  const ed = edita();
  return `<details class="t3-sec t3-lotes" open><summary><b>Importações de extrato</b> (${L.length}) — mover para outra conta ou apagar uma importação feita por engano</summary>
    <div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Ficheiro</th><th>Importado em</th><th>Período</th><th class="r">Movimentos</th><th class="r">Conciliados</th><th>Mover para</th><th></th></tr></thead><tbody>
    ${L.map((st) => {
      const M = S.movs.filter((m) => m.statement?.id === st.id);
      const ds = M.map((m) => String(m.movementDate).slice(0, 10)).sort();
      const ini = st.periodStart ? String(st.periodStart).slice(0, 10) : ds[0];
      const fim = st.periodEnd ? String(st.periodEnd).slice(0, 10) : ds[ds.length - 1];
      const nc = M.filter(conciliado).length;
      return `<tr><td><b>${esc(st.fileName || st.name)}</b><div class="fx2-mut">${esc(contaCod(st.card))}</div></td>
        <td class="fx2-mut">${new Date(st.createdAt).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}</td>
        <td class="fx2-mut">${ini ? `${fmtD(ini)} – ${fmtD(fim)}` : ""}</td>
        <td class="r">${st.summary?.count ?? M.length}</td><td class="r">${nc || "—"}</td>
        <td class="t3-nowrap">${ed ? `<select class="finance-input t3-auto" data-lotemv="${esc(st.id)}"><option value="">— conta —</option>${S.cards.filter((c) => c.id !== st.card?.id).map((c) => `<option value="${esc(c.id)}">${esc(contaCod(c))}</option>`).join("")}</select> <button type="button" class="finance-btn finance-btn--sm" data-t3="lotemv|${esc(st.id)}">Mover</button>` : ""}</td>
        <td>${ed ? `<button type="button" class="finance-btn finance-btn--sm t3-danger" data-t3="lotedel|${esc(st.id)}">Apagar importação</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>
    <p class="fx2-mut t3-small">Mover mantém os movimentos e as classificações, só muda a conta. Apagar remove todos os movimentos dessa importação (incluindo as conciliações já feitas).</p>
  </details>`;
}

function desenhar() {
  const el = root();
  if (!el) return;
  if (S.erro) {
    el.innerHTML = `<div class="finance-empty">Não foi possível carregar: ${esc(S.erro)}</div>`;
    return;
  }
  if (!S.carregado) {
    el.innerHTML = `<div class="finance-empty">A carregar…</div>`;
    return;
  }
  const C = S.cards.filter((c) => c.active !== false).sort((a, b) => contaCod(a).localeCompare(contaCod(b), "pt", { numeric: true }));
  if (!C.length) {
    el.innerHTML = `<section class="t3-sec"><p class="fx2-mut">Crie primeiro as contas em <b>Tesouraria › Contas e Cartões</b>.</p><a class="finance-btn finance-btn--primary" href="/Financeiro/contas-cartoes">+ Nova conta / cartão</a></section>`;
    return;
  }
  const ed = edita();
  el.innerHTML = `
    <div class="t3-bar">
      <span class="t3-small"><b>1.</b> Conta do extrato:</span>
      <select class="finance-input t3-conta${S.conta ? "" : " t3-falta"}" data-t3conta="1"><option value="">— escolher a conta —</option>${C.map((c) => `<option value="${esc(c.id)}"${c.id === S.conta ? " selected" : ""}>${esc(contaCod(c))} · ${esc(BANCOS[String(c.bank || "").toUpperCase()] || c.bank || "")}</option>`).join("")}</select>
      <span class="t3-small"><b>2.</b></span>
      ${
        S.conta && ed
          ? `<label class="finance-btn finance-btn--primary">⬆ Escolher o Ficheiro do Extrato<input type="file" hidden accept=".csv,.txt,.xlsx,.xls" data-t3file="1"></label>`
          : `<button type="button" class="finance-btn" disabled title="${ed ? "Escolha primeiro a conta" : "Sem permissão para importar"}">⬆ Escolher o Ficheiro do Extrato</button>`
      }
      <span class="t3-sp"></span>
      <button type="button" class="finance-btn finance-btn--sm" data-t3="regras">Regras de Classificação</button>
      <button type="button" class="finance-btn finance-btn--sm" data-t3="tipos">Tipos</button>
    </div>
    ${caixaImportar()}
    ${resumo()}
    ${importacoes()}
    ${S.movs.length ? "" : '<p class="fx2-mut t3-small">Ainda não há extratos importados.</p>'}
    <p class="fx2-mut t3-small">A classificação e a conciliação de cada movimento fazem-se em <a class="t3-lnk" href="/Financeiro/conciliacao">T2 · Conciliação Bancária</a>.</p>`;
}

// ── Importação ──────────────────────────────────────────────

function tipoDe(m) {
  return tipoPelasRegras(m.desc, S.regras) || (m.valor > 0 ? "OUTRO" : "OUTRO");
}

function recalcular() {
  const I = S.imp;
  I.rows = movimentosDaTabela(I.tabela, I.map, I.hi);
  I.saldoAnt = saldoAnterior(I.tabela, I.hi, I.rows);
  I.saldoFim = saldoFinal(I.rows);
}

async function lerFicheiro(file) {
  const nome = file.name || "extrato";
  let tabela;
  if (/\.(xlsx|xls)$/i.test(nome)) {
    if (!window.XLSX) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = SHEETJS;
        s.onload = res;
        s.onerror = () => rej(new Error("não foi possível carregar o leitor de Excel"));
        document.head.appendChild(s);
      });
    }
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    tabela = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }).map((r) => r.map((c) => (c instanceof Date ? c : c)));
  } else {
    const buf = await file.arrayBuffer();
    let texto = new TextDecoder("utf-8").decode(buf);
    if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
    tabela = tabelaDeTexto(texto);
  }
  const hi = linhaCabecalho(tabela);
  const det = contaDoFicheiro(tabela, hi, S.cards);
  S.imp = { nome, tabela, hi, map: mapaAuto(tabela, hi), det, contaId: S.conta || det.conta?.id || "", usarSI: true };
  recalcular();
  if (!S.imp.saldoAnt) S.imp.usarSI = false;
  desenhar();
  document.querySelector(".t3-imp")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function importar(btn) {
  const I = S.imp;
  if (!I?.contaId) return toast("Escolha a conta do extrato.", { type: "error" });
  const keys = new Set(S.movs.filter((m) => (m.card?.id || m.cardId) === I.contaId).map((m) => chaveMov(String(m.movementDate).slice(0, 10), m.direction === "SAIDA" ? -m.amount : Number(m.amount), m.description)));
  const novos = I.rows.filter((m) => !keys.has(chaveMov(m.data, m.valor, m.desc)));
  if (!novos.length) return toast("Não há movimentos novos neste ficheiro.", { type: "info" });
  const D = I.det || {};
  if (D.conta && D.conta.id !== I.contaId && !window.confirm(`O ficheiro é da conta ${contaCod(D.conta)}. Importar mesmo assim para ${contaCod(S.cards.find((c) => c.id === I.contaId))}?`)) return;
  const datas = novos.map((m) => m.data).sort();
  btn.disabled = true;
  try {
    await apiRequest("/finance/bank-statements", {
      method: "POST",
      body: {
        cardId: I.contaId,
        name: I.nome.replace(/\.[^.]+$/, ""),
        fileName: I.nome,
        periodStart: datas[0],
        periodEnd: datas[datas.length - 1],
        openingBalance: I.usarSI && I.saldoAnt ? I.saldoAnt.valor : null,
        closingBalance: I.saldoFim,
        movements: novos.map((m) => ({
          movementDate: m.data,
          description: m.desc || null,
          direction: m.valor < 0 ? "SAIDA" : "ENTRADA",
          amount: Math.abs(m.valor),
          docNumber: m.docn || m.ref || null,
          movementType: tipoPelasRegras(m.desc, S.regras) || "OUTRO",
        })),
      },
    });
    toast(`Importados ${novos.length} movimento(s)${I.rows.length - novos.length ? ` · ${I.rows.length - novos.length} já existiam` : ""}.`, { type: "success" });
    S.imp = null;
    await carregar();
  } catch (err) {
    btn.disabled = false;
    toast(err.message || "Falha ao importar o extrato.", { type: "error" });
  }
}

// ── Mover / apagar importação ───────────────────────────────

async function moverLote(id) {
  const sel = root().querySelector(`[data-lotemv="${CSS.escape(id)}"]`);
  const destino = sel?.value;
  if (!destino) return toast("Escolha a conta para onde mover.", { type: "error" });
  const st = S.statements.find((x) => x.id === id);
  if (!window.confirm(`Mover «${st?.fileName || st?.name}» para ${contaCod(S.cards.find((c) => c.id === destino))}?`)) return;
  try {
    await apiRequest(`/finance/bank-statements/${encodeURIComponent(id)}`, { method: "PATCH", body: { cardId: destino } });
    toast("Importação movida.", { type: "success" });
    await carregar();
  } catch (err) {
    toast(err.message || "Falha ao mover.", { type: "error" });
  }
}

async function apagarLote(id) {
  const st = S.statements.find((x) => x.id === id);
  const n = st?.summary?.count ?? 0;
  if (!window.confirm(`Apagar a importação «${st?.fileName || st?.name}» e os seus ${n} movimento(s)? As conciliações já feitas perdem-se. Não se pode desfazer.`)) return;
  try {
    await apiRequest(`/finance/bank-statements/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Importação apagada.", { type: "success" });
    await carregar();
  } catch (err) {
    toast(err.message || "Falha ao apagar.", { type: "error" });
  }
}

// ── Carregamento e eventos ──────────────────────────────────

async function carregar() {
  try {
    const [cards, sts, movs, regras] = await Promise.all([
      apiRequest("/finance/options/cards"),
      apiRequest("/finance/bank-statements"),
      apiRequest("/finance/bank-movements?limit=20000"),
      apiRequest("/finance/bank-rules").catch(() => ({ items: [] })),
    ]);
    S.cards = cards.items || [];
    S.statements = sts.items || [];
    S.movs = movs.items || [];
    S.regras = regras.items || [];
    S.erro = null;
  } catch (err) {
    S.erro = err.message || String(err);
  }
  S.carregado = true;
  desenhar();
}

function ligar() {
  const el = root();
  if (!el || el.dataset.t3) return;
  el.dataset.t3 = "1";
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-t3]");
    if (!b || b.disabled) return;
    const [a, id] = b.dataset.t3.split("|");
    if (a === "impcancel") {
      S.imp = null;
      desenhar();
    } else if (a === "impgo") importar(b);
    else if (a === "regras") abrirRegras({ regras: S.regras, onSaved: (r) => ((S.regras = r), S.imp && desenhar()) });
    else if (a === "tipos") abrirTipos();
    else if (a === "lotemv") moverLote(id);
    else if (a === "lotedel") apagarLote(id);
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.t3conta) {
      S.conta = t.value;
      if (S.imp && t.value) S.imp.contaId = t.value;
      desenhar();
    } else if (t.dataset.t3file && t.files?.[0]) {
      lerFicheiro(t.files[0]).catch((err) => toast(`Não foi possível ler o ficheiro: ${err.message || err}`, { type: "error" }));
    } else if (t.dataset.impconta !== undefined) {
      S.imp.contaId = t.value;
      desenhar();
    } else if (t.dataset.impsi) {
      S.imp.usarSI = t.checked;
    } else if (t.dataset.impmap) {
      const k = t.dataset.impmap;
      if (k === "hi") S.imp.hi = Math.max(-1, Number(t.value) - 1);
      else S.imp.map[k] = Number(t.value);
      recalcular();
      desenhar();
      const d = root().querySelector(".t3-cols");
      if (d) d.open = true;
    }
  });
}

export async function render() {
  Object.assign(S, { cards: [], statements: [], movs: [], regras: [], imp: null, erro: null, carregado: false });
  ligar();
  desenhar();
  await carregar();
}
