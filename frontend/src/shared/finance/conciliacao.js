/**
 * T2 Conciliação Bancária — o `V.fext` do protótipo (versão 624).
 *
 * Topo: «⬆ Importar Extrato» (a importação faz-se nos Extratos, T3), «Regras
 * de Classificação» e «Tipos». Conta / cartão (com quantos estão por
 * conciliar em cada uma, ou ✓). Filtros: mês, tipo (com «sem tipo»),
 * pesquisa (texto ou valor), «só por conciliar», «⟳ Aplicar regras» e o saldo
 * da conta escolhida. Tabela: tipo e nota editáveis na linha, valor com sinal
 * (saídas a vermelho) e a conciliação: ⇄ conciliar ou ✓ conciliado. Rodapé
 * com entradas, saídas e total; 100 por página. Com uma conta escolhida,
 * «Lançamento Manual».
 *
 * Conciliado:
 *  - uma **saída** quando tem o custo associado (ou é mercadoria, que entra em
 *    stock), ou quando não leva custo (transferência interna, operação
 *    anulada); o levantamento ATM leva custo, discriminado item a item;
 *  - uma **entrada** quando está classificada e, se for um recebimento de
 *    cliente, ligada às faturas.
 */

import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmtData, codigoNoCabecalho } from "./f2Ui.js";
import {
  MOVEMENT_TYPE,
  isIncoming,
  needsCostAssignment,
  isReceiptLinked,
  receiptStateHtml,
  costStatusHtml,
  loadMovementOptions,
  openClassifyModal,
  openAssignCostModal,
} from "./movementsShared.js";
import { abrirRegras, abrirTipos } from "./extratoRegras.js";
import { tipoPelasRegras } from "./extratoImportCore.js";

const root = () => document.getElementById("financeRoot");
const S = { itens: null, options: null, erro: null, cards: [], saldos: new Map(), regras: [], conta: "", mes: "", tipo: "", q: "", so: false, pg: 0 };
const POR_PAGINA = 100;
const SEM_CUSTO = new Set(["TRANSFERENCIA_INTERNA", "OPERACAO_ANULADA"]);

/** Conciliado? — a mesma leitura nos Extratos (T3). */
export function conciliado(m) {
  if (isIncoming(m)) {
    if (m.movementType === "OUTRO") return false;
    if (m.movementType === "RECEBIMENTO_CLIENTE") return isReceiptLinked(m);
    return true;
  }
  if (m.isMerchandise || m.costAssigned) return true;
  return !needsCostAssignment(m);
}

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const fmt = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sinal = (m) => (isIncoming(m) ? 1 : -1) * (Number(m.amount) || 0);
const cardId = (m) => m.card?.id || m.cardId || "";
const contaCod = (c) => (c ? [c.bank, c.label].filter(Boolean).join(" ") + (c.lastDigits ? ` •${c.lastDigits}` : "") : "Sem conta");
/** O nome antigo do filtro (vindo de links): «BFA C8 •0008». */
const contaT2 = (c) => [c.bank, c.label, c.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" ");
const mesLbl = (k) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
};

/** O que diz a coluna «Conc.». */
function concCell(m, ed) {
  const ok = conciliado(m);
  const t = m.movementType;
  if (ok) {
    let lbl;
    if (isIncoming(m)) lbl = t === "RECEBIMENTO_CLIENTE" ? receiptStateHtml(m) : `<span class="t2-pill">auto · ${esc(MOVEMENT_TYPE[t]?.label || t)}</span>`;
    else if (m.isMerchandise) lbl = '<span class="t2-pill">mercadoria · stock</span>';
    else if (SEM_CUSTO.has(t)) lbl = `<span class="t2-pill t2-ok">✓ ${esc(MOVEMENT_TYPE[t]?.label || t)}</span>`;
    else lbl = costStatusHtml(m);
    return `<div class="t2-conc">${lbl}${ed ? ` <button type="button" class="t2-mini" data-t2cl="${esc(m.id)}" title="Ver ou alterar a classificação (obra, documento, fornecedor)">✎</button>` : ""}</div>`;
  }
  if (!ed) return '<span class="fcal-pill fcal-pill--warn">por conciliar</span>';
  // Saída que leva custo: associar o custo. Entrada (ou saída sem tipo útil): classificar.
  const custo = !isIncoming(m) && needsCostAssignment(m) && !m.costAssigned && !m.isMerchandise;
  return `<div class="t2-conc"><button type="button" class="t2-concbtn" data-${custo ? "t2as" : "t2cl"}="${esc(m.id)}" title="${custo ? "Conciliar: associar o custo desta saída" : "Conciliar: classificar este movimento"}">⇄</button>
    ${isIncoming(m) && t === "RECEBIMENTO_CLIENTE" ? receiptStateHtml(m) : ""}</div>`;
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = `<div class="finance-empty">Não foi possível carregar: ${esc(S.erro)}</div>`);
  if (!S.itens) return (el.innerHTML = '<div class="finance-empty">A carregar…</div>');
  const ed = can("financeiro", "edit");
  const C = S.cards.filter((c) => c.active !== false).sort((a, b) => contaCod(a).localeCompare(contaCod(b), "pt", { numeric: true }));
  const all = !S.conta;
  const conta = C.find((c) => c.id === S.conta);
  const M0 = S.itens.filter((m) => all || cardId(m) === S.conta);
  const meses = [...new Set(M0.map((m) => String(m.movementDate || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const q = norm(S.q).trim();
  const qNum = /^[-+]?[\d\s.,]+$/.test(S.q || "") && String(S.q).replace(/\D/g, "").length >= 2 ? String(S.q).replace(/\D/g, "") : "";
  const L = M0.filter(
    (m) =>
      (!S.mes || String(m.movementDate || "").startsWith(S.mes)) &&
      (!S.so || !conciliado(m)) &&
      (!S.tipo || (S.tipo === "__sem" ? m.movementType === "OUTRO" : m.movementType === S.tipo)) &&
      (!q ||
        norm([m.description, m.notes, m.docNumber, m.supplier?.name, m.project?.name, m.project?.referencia, m.statement?.name].join(" ")).includes(q) ||
        (qNum && Math.abs(Number(m.amount)).toFixed(2).replace(/\D/g, "").includes(qNum)))
  );
  const np = Math.ceil(L.length / POR_PAGINA) || 1;
  const pg = Math.min(S.pg, np - 1);
  const P = L.slice(pg * POR_PAGINA, pg * POR_PAGINA + POR_PAGINA);
  const pend = (id) => S.itens.filter((m) => (!id || cardId(m) === id) && !conciliado(m)).length;
  const semTipo = M0.filter((m) => m.movementType === "OUTRO" && !conciliado(m)).length;
  const ent = L.filter(isIncoming).reduce((s, m) => s + Number(m.amount || 0), 0);
  const sai = L.filter((m) => !isIncoming(m)).reduce((s, m) => s + Number(m.amount || 0), 0);
  const tot = `Entradas <b class="fcal-in">${fmt(ent)}</b> · Saídas <b class="fcal-out">${fmt(sai)}</b> · Total <b>${fmt(ent - sai)}</b>`;
  const saldo = conta ? S.saldos.get(conta.id) : null;
  const tipoOpts = Object.entries(MOVEMENT_TYPE);

  el.innerHTML = `
    <div class="t3-bar">
      <a class="finance-btn" href="/Financeiro/tesouraria/extratos">⬆ Importar Extrato</a>
      <span class="fx2-mut t3-small">a importação faz-se em Extratos Bancários</span>
      <span class="t3-sp"></span>
      <button type="button" class="finance-btn finance-btn--sm" data-t2a="regras">Regras de Classificação</button>
      <button type="button" class="finance-btn finance-btn--sm" data-t2a="tipos">Tipos</button>
    </div>
    <div class="t3-bar"><label class="t3-small t2-lbl"><b>Conta / cartão:</b>
      <select class="finance-input t2-conta" data-t2f="conta">${C.map((c) => {
        const n = pend(c.id);
        return `<option value="${esc(c.id)}"${S.conta === c.id ? " selected" : ""}>${esc(contaCod(c))}${n ? ` · ${n} por conciliar` : " · ✓"}</option>`;
      }).join("")}<option value=""${all ? " selected" : ""}>Todas as contas${pend("") ? ` · ${pend("")} por conciliar` : " · ✓"}</option></select></label></div>
    <div class="t3-bar t2-filtros">
      <select class="finance-input" data-t2f="mes"><option value="">Todos os meses</option>${meses.map((k) => `<option value="${k}"${S.mes === k ? " selected" : ""}>${esc(mesLbl(k))}</option>`).join("")}</select>
      <select class="finance-input" data-t2f="tipo"><option value="">Todos os tipos</option><option value="__sem"${S.tipo === "__sem" ? " selected" : ""}>— Sem tipo (pagamento / outro) · ${M0.filter((m) => m.movementType === "OUTRO" && (!S.mes || String(m.movementDate).startsWith(S.mes))).length} —</option>${tipoOpts
        .filter(([k]) => k !== "OUTRO")
        .map(([k, t]) => `<option value="${k}"${S.tipo === k ? " selected" : ""}>${esc(t.label)}</option>`)
        .join("")}</select>
      <input type="search" class="finance-input t2-q" data-t2q placeholder="Pesquisar… (texto ou valor)" value="${esc(S.q)}">
      <label class="t3-small t2-lbl"><input type="checkbox" data-t2f="so"${S.so ? " checked" : ""}> só por conciliar</label>
      ${ed ? `<button type="button" class="finance-btn finance-btn--sm" data-t2a="regrasaplicar" title="Classifica pelas regras os movimentos por conciliar ainda sem tipo (nunca os conciliados nem os já classificados)">⟳ Aplicar regras${semTipo ? ` (${semTipo} sem tipo)` : ""}</button>` : ""}
      ${conta ? `<b class="t2-saldo">Saldo ${esc(contaCod(conta))}: ${saldo != null ? fmt(saldo) : "—"} ${esc(conta.currency || "AOA")}</b>` : ""}
    </div>
    <section class="t3-sec t3-flush">${
      P.length
        ? `<div class="fx2-tw"><table class="fx2-t t2-t"><thead><tr><th>Tipo</th><th>Data Mov.</th>${all ? "<th>Conta</th>" : ""}<th>Descrição</th><th class="r">Valor</th><th>Obra · Fornecedor · Doc.</th><th title="Nota interna sobre o movimento">Nota</th><th>Conc.</th></tr></thead>
        <tbody>${P.map((m) => {
          const v = sinal(m);
          const ok = conciliado(m);
          return `<tr class="${ok ? "t2-ok-row" : ""}">
            <td>${
              ed
                ? `<select class="finance-input t2-in t2-tipo" data-mvtipo="${esc(m.id)}">${tipoOpts.map(([k, t]) => `<option value="${k}"${m.movementType === k ? " selected" : ""}>${esc(k === "OUTRO" ? "—" : t.label)}</option>`).join("")}</select>`
                : esc(MOVEMENT_TYPE[m.movementType]?.label || "")
            }</td>
            <td class="t3-nowrap">${fmtData(m.movementDate)}</td>
            ${all ? `<td class="t3-nowrap"><b>${esc(contaCod(m.card))}</b></td>` : ""}
            <td class="t2-desc" title="${esc(m.statement?.name || "")}">${esc(m.description || "")}</td>
            <td class="r t3-nowrap${v < 0 ? " fcal-out" : ""}"><b>${fmt(v)}</b></td>
            <td class="fx2-mut t2-cc">${esc([m.project?.referencia || m.project?.name, m.supplier?.name, m.docNumber].filter(Boolean).join(" · ")) || '<span class="fx2-mut">—</span>'}</td>
            <td>${ed ? `<input class="finance-input t2-in t2-nota" data-mvnota="${esc(m.id)}" value="${esc(m.notes || "")}" placeholder="nota interna">` : esc(m.notes || "")}</td>
            <td>${concCell(m, ed)}</td></tr>`;
        }).join("")}</tbody></table></div>
        ${
          np > 1
            ? `<div class="t3-acts t2-pag"><button type="button" class="finance-btn finance-btn--sm" data-t2pg="${pg - 1}"${pg <= 0 ? " disabled" : ""}>‹ Anteriores</button><span class="fx2-mut t3-small">Página ${pg + 1} de ${np} · ${L.length} movimentos · ${tot}</span><button type="button" class="finance-btn finance-btn--sm" data-t2pg="${pg + 1}"${pg >= np - 1 ? " disabled" : ""}>Seguintes ›</button></div>`
            : `<p class="fx2-mut t3-small t2-pag">${L.length} movimento(s) · ${tot}</p>`
        }`
        : `<p class="fx2-mut" style="padding:14px">Sem movimentos${S.mes || S.so || S.q || S.tipo ? " com estes filtros" : ""}. Importe o extrato${all ? "" : " desta conta"} ou lance um movimento abaixo.</p>`
    }</section>
    <p class="fx2-mut t3-small">⇄ conciliar · ✓ conciliado (✎ ver ou alterar) · Valores a <b class="fcal-out">vermelho</b> = saídas · a preto = entradas · <b>⇄</b> numa saída = associar o custo (obra, categoria, fornecedor); numa entrada = classificar e, se for recebimento de cliente, ligar às faturas · transferências internas e operações anuladas ficam conciliadas sozinhas (o levantamento ATM leva custo, item a item) · os movimentos do extrato não se apagam (só a importação inteira, em Tesouraria › Extratos Bancários).</p>
    ${
      conta && ed
        ? `<section class="t3-sec"><h3>Lançamento Manual</h3><div class="t3-acts">
        <input class="finance-input t2-auto" type="date" id="t2MvD" value="${new Date().toISOString().slice(0, 10)}">
        <input class="finance-input t2-w3" id="t2MvT" placeholder="Descrição">
        <select class="finance-input t2-auto" id="t2MvS"><option value="S">Saída</option><option value="E">Entrada</option></select>
        <input class="finance-input t2-auto" type="number" step="any" min="0" id="t2MvV" placeholder="Valor">
        <select class="finance-input t2-auto" id="t2MvTp">${tipoOpts.map(([k, t]) => `<option value="${k}"${k === "OUTRO" ? " selected" : ""}>${esc(k === "OUTRO" ? "Tipo…" : t.label)}</option>`).join("")}</select>
        <button type="button" class="finance-btn" data-t2a="movadd">Lançar</button></div></section>`
        : ""
    }`;
}

async function carregar() {
  try {
    const [r, cards, bal, regras] = await Promise.all([
      apiRequest("/finance/bank-movements?limit=20000"),
      apiRequest("/finance/options/cards"),
      apiRequest("/finance/treasury/balances").catch(() => null),
      apiRequest("/finance/bank-rules").catch(() => ({ items: [] })),
    ]);
    S.itens = r.items || [];
    S.cards = cards.items || [];
    S.saldos = new Map((bal?.items || []).filter((b) => b.card?.id).map((b) => [b.card.id, Number(b.balance) || 0]));
    S.regras = regras.items || [];
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

async function aplicarRegras(btn) {
  if (!S.regras.length) return toast("Ainda não há regras. Crie-as em «Regras de Classificação».", { type: "info" });
  const alvo = S.itens
    .filter((m) => (!S.conta || cardId(m) === S.conta) && m.movementType === "OUTRO" && !conciliado(m))
    .map((m) => [m, tipoPelasRegras(m.description, S.regras)])
    .filter(([m, t]) => t && t !== "OUTRO" && !(t === "RECEBIMENTO_CLIENTE" && !isIncoming(m)));
  if (!alvo.length) return toast("Nenhum movimento sem tipo casa com as regras.", { type: "info" });
  btn.disabled = true;
  let ok = 0;
  for (const [m, t] of alvo) {
    try {
      await apiRequest(`/finance/bank-movements/${encodeURIComponent(m.id)}`, { method: "PATCH", body: { movementType: t } });
      ok++;
    } catch {
      /* segue com os outros */
    }
  }
  toast(`${ok} movimento(s) classificado(s) pelas regras${ok < alvo.length ? ` · ${alvo.length - ok} falharam` : ""}.`, { type: ok ? "success" : "error" });
  await carregar();
}

async function lancarManual(btn) {
  const conta = S.cards.find((c) => c.id === S.conta);
  const d = document.getElementById("t2MvD").value;
  const desc = document.getElementById("t2MvT").value.trim();
  const v = Number(document.getElementById("t2MvV").value);
  const sai = document.getElementById("t2MvS").value === "S";
  const tipo = document.getElementById("t2MvTp").value;
  if (!conta || !d || !desc || !(v > 0)) return toast("Indique a data, a descrição e o valor.", { type: "error" });
  if (tipo === "RECEBIMENTO_CLIENTE" && sai) return toast("Um recebimento do cliente tem de ser uma entrada.", { type: "error" });
  btn.disabled = true;
  try {
    await apiRequest("/finance/bank-statements", {
      method: "POST",
      body: {
        cardId: conta.id,
        name: `Lançamento manual · ${contaCod(conta)}`,
        periodStart: d,
        periodEnd: d,
        notes: "Lançamento manual na Conciliação Bancária",
        movements: [{ movementDate: d, description: desc, direction: sai ? "SAIDA" : "ENTRADA", amount: v, movementType: tipo }],
      },
    });
    toast("Movimento lançado.", { type: "success" });
    await carregar();
  } catch (e) {
    btn.disabled = false;
    toast(e.message || "Falha ao lançar.", { type: "error" });
  }
}

async function gravarCampo(id, body, el) {
  try {
    const r = await apiRequest(`/finance/bank-movements/${encodeURIComponent(id)}`, { method: "PATCH", body });
    const m = S.itens.find((x) => x.id === id);
    if (m && r.movement) Object.assign(m, { movementType: r.movement.movementType, notes: r.movement.notes });
    el?.classList.add("t2-gravado");
    setTimeout(() => el?.classList.remove("t2-gravado"), 900);
    if (body.movementType) desenhar();
  } catch (e) {
    toast(e.data?.message || e.message || "Falha ao gravar.", { type: "error" });
    desenhar();
  }
}

export async function render() {
  codigoNoCabecalho("T2");
  // Vindo dos Extratos (T3) › «Por conciliar» de uma conta (id, ou o nome antigo).
  const q = new URLSearchParams(location.search);
  const pedida = q.get("conta") || "";
  const el = root();
  el.addEventListener("click", (e) => {
    const t = e.target;
    const a = t.closest("[data-t2a]");
    if (a) {
      const k = a.dataset.t2a;
      if (k === "regras") return abrirRegras({ regras: S.regras, onSaved: (r) => ((S.regras = r), desenhar()) });
      if (k === "tipos") return abrirTipos();
      if (k === "regrasaplicar") return aplicarRegras(a);
      if (k === "movadd") return lancarManual(a);
    }
    const p = t.closest("[data-t2pg]");
    if (p && !p.disabled) {
      S.pg = Math.max(0, Number(p.dataset.t2pg));
      return desenhar();
    }
    const cl = t.closest("[data-t2cl]");
    if (cl) return openClassifyModal(S.itens.find((m) => m.id === cl.dataset.t2cl), { options: S.options, onSaved: carregar });
    const as = t.closest("[data-t2as]");
    if (as) return openAssignCostModal(S.itens.find((m) => m.id === as.dataset.t2as), { options: S.options, onSaved: carregar });
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.mvtipo) return gravarCampo(t.dataset.mvtipo, { movementType: t.value }, t);
    if (t.dataset.mvnota) return gravarCampo(t.dataset.mvnota, { notes: t.value.trim() || null }, t);
    const k = t.dataset.t2f;
    if (!k) return;
    S[k] = t.type === "checkbox" ? t.checked : t.value;
    S.pg = 0;
    desenhar();
  });
  let tempo = null;
  el.addEventListener("input", (e) => {
    if (e.target.dataset.t2q === undefined) return;
    S.q = e.target.value;
    S.pg = 0;
    clearTimeout(tempo);
    tempo = setTimeout(() => {
      const pos = e.target.selectionStart;
      desenhar();
      const n = root().querySelector("[data-t2q]");
      if (n) {
        n.focus();
        n.setSelectionRange(pos, pos);
      }
    }, 250);
  });
  desenhar();
  try {
    S.options = await loadMovementOptions();
  } catch {
    S.options = { projects: [], suppliers: [], categories: [], cards: [] };
  }
  await carregar();
  if (pedida) {
    const c = S.cards.find((x) => x.id === pedida || contaT2(x) === pedida);
    if (c) {
      S.conta = c.id;
      S.so = true;
      desenhar();
    }
  }
}
