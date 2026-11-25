/**
 * T2 Conciliação Bancária — o `V.fext` do protótipo (versão 624).
 *
 * Topo: «⬆ Importar Extrato» (a importação faz-se nos Extratos, T3), «Regras
 * de Classificação» e «Tipos». Conta / cartão (com quantos estão por
 * conciliar em cada uma, ou ✓). Filtros: mês, tipo (com «sem tipo» e o total
 * por conciliar), pesquisa (texto ou valor), «só por conciliar», «⟳ Aplicar
 * regras» e o saldo da conta escolhida.
 *
 * Tabela (como no protótipo): ☐ · Tipo · Data Mov. · Data Efetiva · Conta ·
 * Descrição · Valor · Nota · Conc. · Centro de Custo. O tipo e a nota editam-se
 * na linha; numa transferência interna, o Centro de Custo é a outra conta
 * («De ←» numa entrada, «Para →» numa saída). Rodapé com entradas, saídas e
 * total; 100 por página. Vários selecionados: mudar o tipo de uma vez. Com
 * uma conta escolhida, «Lançamento Manual».
 *
 * Conciliado:
 *  - **transferência interna**: quando se indicou a outra conta, ou quando o
 *    movimento oposto (mesmo valor, outra conta, até 5 dias) a casa sozinho;
 *  - outra **saída**: quando tem o custo associado (ou é mercadoria, que entra
 *    em stock), ou quando não leva custo (operação anulada); o levantamento
 *    ATM leva custo, discriminado item a item;
 *  - outra **entrada**: quando está classificada e, se for um recebimento de
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
import { abrirRegras, abrirTipos, aplicarRegras } from "./extratoRegras.js";
import { abrirConciliarSaida } from "./conciliarSaida.js";

const root = () => document.getElementById("financeRoot");
const S = {
  itens: null,
  options: null,
  erro: null,
  cards: [],
  saldos: new Map(),
  regras: [],
  conta: "",
  mes: null,
  tipo: "",
  q: "",
  so: false,
  pg: 0,
  sel: new Set(),
};
const POR_PAGINA = 100;
const TRF = "TRANSFERENCIA_INTERNA";

const cardId = (m) => m.card?.id || m.cardId || "";
const dia = (m) => String(m.movementDate || "").slice(0, 10);

// ── Transferências internas: o par na outra conta ───────────

let PARES = new Map();

/**
 * Casa as transferências internas sem conta indicada com o movimento oposto
 * noutra conta da MBT: o mesmo valor, sentido contrário, até 5 dias, de tipo
 * transferência interna ou ainda sem tipo. Um par por movimento (o mais
 * próximo na data). Chamar sempre que a lista muda (T2 e T3).
 */
export function prepararPares(itens) {
  const M = new Map();
  const T = (itens || []).filter((m) => m.movementType === TRF && !m.transferCardId);
  const cand = (itens || []).filter((x) => x.movementType === TRF || x.movementType === "OUTRO");
  const E = [];
  for (const m of T) {
    for (const x of cand) {
      if (x.id === m.id || cardId(x) === cardId(m) || x.direction === m.direction) continue;
      if (Math.abs(Number(x.amount) - Number(m.amount)) >= 0.5) continue;
      if (x.transferCardId && x.transferCardId !== cardId(m)) continue;
      const dd = Math.abs((new Date(dia(x)) - new Date(dia(m))) / 86400000);
      if (dd > 5) continue;
      E.push([dd * 10 + (x.movementType === TRF ? 0 : 3), m, x]);
    }
  }
  E.sort((a, b) => a[0] - b[0]).forEach(([, m, x]) => {
    if (M.has(m.id) || M.has(x.id)) return;
    M.set(m.id, x);
    M.set(x.id, m);
  });
  PARES = M;
  return M;
}

/** Conciliado? — a mesma leitura nos Extratos (T3). */
export function conciliado(m) {
  if (m.movementType === TRF) return Boolean(m.transferCardId) || PARES.has(m.id);
  if (!isIncoming(m) && m.reparticao?.partial) return false;
  if (!isIncoming(m) && m.purchaseOrderId) return true; // pago por um pedido do Centro de Pagamentos
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
const contaCod = (c) => (c ? [c.bank, c.label].filter(Boolean).join(" ") + (c.lastDigits ? ` •${c.lastDigits}` : "") : "Sem conta");
/** O nome antigo do filtro (vindo de links): «BFA C8 •0008». */
const contaT2 = (c) => [c.bank, c.label, c.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" ");
const mesLbl = (k) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-PT", { month: "short", year: "numeric" });
};
const contaDeId = (id) => S.cards.find((c) => c.id === id);

/** A outra conta de uma transferência interna (indicada ou casada). */
function outraConta(m) {
  if (m.transferCardId) return { conta: contaDeId(m.transferCardId), auto: false };
  const p = PARES.get(m.id);
  return p ? { conta: p.card || contaDeId(cardId(p)), auto: true, par: p } : null;
}

/** A coluna «Conc.». */
function concCell(m, ed) {
  const ok = conciliado(m);
  const t = m.movementType;
  const editar = ed ? ` <button type="button" class="t2-mini" data-t2cl="${esc(m.id)}" title="Ver ou alterar a classificação (obra, documento, fornecedor)">✎</button>` : "";
  if (t === TRF) {
    const o = outraConta(m);
    if (o?.conta) {
      const tit = o.auto ? `Casada sozinha com o movimento oposto em ${contaCod(o.conta)} (${fmtData(o.par.movementDate)} · ${fmt(o.par.amount)})` : "Conta indicada à mão";
      return `<div class="t2-conc"><span class="t2-pill t2-ok" title="${esc(tit)}">✓ ↔ ${esc(contaCod(o.conta))}</span>${o.auto ? '<span class="t2-auto">auto</span>' : ""}</div>`;
    }
    return `<span class="t2-pill t2-warnp">Por conciliar · indique a conta de ${isIncoming(m) ? "origem" : "destino"}</span>`;
  }
  if (!isIncoming(m) && m.purchaseOrderId) {
    if (m.reparticao?.partial) {
      const resumo = (m.reparticao.pedidos || []).map((p) => `${p.number}: ${fmt(p.amount)}`).join(" · ");
      return `<div class="t2-conc" style="flex-wrap:wrap;gap:4px">
        <span class="t2-pill t2-warnp" title="${esc(resumo)}">Parcial · falta ${fmt(m.reparticao.falta)}</span>
        <span class="t3-small fx2-mut">${esc((m.reparticao.pedidos || []).map((p) => p.number).join(" · "))}</span>
        ${ed ? `<button type="button" class="finance-btn finance-btn--sm" data-t2as="${esc(m.id)}" title="Conciliar o valor restante deste movimento">＋ Conciliar o Resto</button>` : ""}
        ${ed ? `<button type="button" class="t2-mini" data-t2unlink="${esc(m.id)}" title="Desfazer a conciliação (os pagamentos registados nos pedidos ficam)">↺</button>` : ""}
      </div>`;
    }
    if (m.reparticao && (m.reparticao.pedidos || []).length > 1) {
      const resumo = m.reparticao.pedidos.map((p) => `${p.number} (${fmt(p.amount)})`).join(" · ");
      return `<div class="t2-conc">
        <span class="t2-pill t2-ok" title="${esc(resumo)}">✓ ${esc(m.reparticao.pedidos.map((p) => p.number).join(" + "))}</span>
        ${ed ? ` <button type="button" class="t2-mini" data-t2unlink="${esc(m.id)}" title="Desfazer a conciliação">↺</button>` : ""}
      </div>`;
    }
    const p = m.pedido || {};
    return `<div class="t2-conc"><span class="t2-pill t2-ok" title="${esc([p.supplierName, p.description].filter(Boolean).join(" · "))}">✓ ${esc(p.number || "pedido")}</span>${p.supplierName ? ` <b class="t3-small">${esc(p.supplierName)}</b>` : ""}${
      ed ? ` <button type="button" class="t2-mini" data-t2unlink="${esc(m.id)}" title="Desfazer a conciliação (o pagamento registado no pedido fica)">↺</button>` : ""
    }</div>`;
  }
  if (ok) {
    let lbl;
    if (isIncoming(m)) lbl = t === "RECEBIMENTO_CLIENTE" ? receiptStateHtml(m) : `<span class="t2-pill">auto · ${esc(MOVEMENT_TYPE[t]?.label || t)}</span>`;
    else if (m.isMerchandise) lbl = '<span class="t2-pill">mercadoria · stock</span>';
    else if (t === "OPERACAO_ANULADA") lbl = '<span class="t2-pill t2-ok">✓ operação anulada</span>';
    else lbl = costStatusHtml(m);
    return `<div class="t2-conc">${lbl}${editar}</div>`;
  }
  if (!ed) return '<span class="t2-pill t2-warnp">Por conciliar</span>';
  const custo = !isIncoming(m) && needsCostAssignment(m) && !m.costAssigned && !m.isMerchandise;
  return `<div class="t2-conc"><button type="button" class="t2-concbtn" data-${custo ? "t2as" : "t2cl"}="${esc(m.id)}" title="${custo ? "Conciliar: associar o custo desta saída" : "Conciliar: classificar este movimento"}">⇄</button>
    ${isIncoming(m) && t === "RECEBIMENTO_CLIENTE" ? receiptStateHtml(m) : ""}</div>`;
}

/** A coluna «Centro de Custo»: a obra; numa transferência interna, a outra conta. */
function ccCell(m, ed) {
  if (m.movementType === TRF) {
    const ent = isIncoming(m);
    const o = outraConta(m);
    const atual = m.transferCardId || "";
    const opts = S.cards
      .filter((c) => c.id !== cardId(m) && c.active !== false)
      .map((c) => `<option value="${esc(c.id)}"${c.id === atual ? " selected" : ""}>${esc(contaCod(c))}</option>`)
      .join("");
    const sel = ed
      ? `<select class="finance-input t2-in t2-trf" data-mvtrf="${esc(m.id)}"><option value="">${o?.auto ? `${esc(contaCod(o.conta))} (auto)` : "— conta —"}</option>${opts}</select>`
      : esc(o?.conta ? contaCod(o.conta) : "—");
    return `<span class="t2-trfcell"><span class="fx2-mut">${ent ? "De ←" : "Para →"}</span>${sel}</span>`;
  }
  const obra = m.project ? m.project.referencia || m.project.name : "";
  const extra = [m.supplier?.name, m.docNumber].filter(Boolean).join(" · ");
  if (!obra && !extra) return '<span class="fx2-mut">—</span>';
  return `${obra ? `<b>${esc(obra)}</b>` : ""}${extra ? `<div class="fx2-mut t2-sub">${esc(extra)}</div>` : ""}`;
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
  const meses = [...new Set(M0.map((m) => dia(m).slice(0, 7)).filter(Boolean))].sort().reverse();
  // Muitos movimentos: começa no mês mais recente (como no protótipo).
  if (S.mes === null) S.mes = M0.length > 300 ? meses[0] || "" : "";
  const q = norm(S.q).trim();
  const rawQ = String(S.q || "").trim();
  const isNumQ = /^[-+]?[\d\s.,]+$/.test(rawQ) && rawQ.replace(/\D/g, "").length >= 2;
  const qDigits = isNumQ ? rawQ.replace(/\D/g, "") : "";
  const qVal = isNumQ ? Math.abs(Number(rawQ.replace(/\s+/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."))) : NaN;
  const matchValor = (amt) => {
    if (!isNumQ) return false;
    const abs = Math.abs(Number(amt) || 0);
    if (Number.isFinite(qVal) && Math.abs(abs - qVal) < 0.01) return true;
    return abs.toFixed(2).replace(/\D/g, "").includes(qDigits) || String(Math.round(abs)).includes(qDigits);
  };
  const noMes = (m) => !S.mes || dia(m).startsWith(S.mes);
  const L = M0.filter(
    (m) =>
      noMes(m) &&
      (!S.so || !conciliado(m)) &&
      (!S.tipo || (S.tipo === "__sem" ? m.movementType === "OUTRO" : m.movementType === S.tipo)) &&
      (!q ||
        norm([m.description, m.notes, m.docNumber, m.supplier?.name, m.project?.name, m.project?.referencia, m.statement?.name, m.pedido?.number].join(" ")).includes(q) ||
        matchValor(m.amount))
  );
  const np = Math.ceil(L.length / POR_PAGINA) || 1;
  const pg = Math.min(S.pg, np - 1);
  const P = L.slice(pg * POR_PAGINA, pg * POR_PAGINA + POR_PAGINA);
  const pend = (id) => S.itens.filter((m) => (!id || cardId(m) === id) && !conciliado(m)).length;
  const pendMes = M0.filter((m) => noMes(m) && !conciliado(m)).length;
  const semTipo = M0.filter((m) => (m.movementType === "OUTRO" || m.typeAuto) && !conciliado(m)).length;
  const ent = L.filter(isIncoming).reduce((s, m) => s + Number(m.amount || 0), 0);
  const sai = L.filter((m) => !isIncoming(m)).reduce((s, m) => s + Number(m.amount || 0), 0);
  const tot = `Entradas <b class="fcal-in">${fmt(ent)}</b> · Saídas <b class="fcal-out">${fmt(sai)}</b> · Total <b>${fmt(ent - sai)}</b>`;
  const saldo = conta ? S.saldos.get(conta.id) : null;
  const tipoOpts = Object.entries(MOVEMENT_TYPE);
  for (const id of [...S.sel]) if (!S.itens.some((m) => m.id === id && !conciliado(m))) S.sel.delete(id);
  const selL = S.itens.filter((m) => S.sel.has(m.id));
  const selT = selL.reduce((s, m) => s + sinal(m), 0);

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
      <select class="finance-input" data-t2f="tipo"><option value="">Todos os tipos (${pendMes} por conciliar)</option><option value="__sem"${S.tipo === "__sem" ? " selected" : ""}>— Sem tipo (em branco) · ${M0.filter((m) => m.movementType === "OUTRO" && noMes(m)).length} —</option>${tipoOpts
        .filter(([k]) => k !== "OUTRO")
        .map(([k, t]) => `<option value="${k}"${S.tipo === k ? " selected" : ""}>${esc(t.label)}</option>`)
        .join("")}</select>
      <input type="search" class="finance-input t2-q" data-t2q placeholder="Pesquisar…" value="${esc(S.q)}">
      <label class="t3-small t2-lbl"><input type="checkbox" data-t2f="so"${S.so ? " checked" : ""}> só por conciliar</label>
      ${ed ? `<button type="button" class="finance-btn finance-btn--sm" data-t2a="regrasaplicar" title="Classifica os movimentos sem tipo e volta a classificar os que foram classificados por regras (nunca os escolhidos à mão nem os conciliados)">⟳ Aplicar regras${semTipo ? ` (${semTipo} sem tipo)` : ""}</button>` : ""}
      ${conta ? `<b class="t2-saldo">Saldo ${esc(contaCod(conta))}: ${saldo != null ? fmt(saldo) : "—"} ${esc(conta.currency || "AOA")}</b>` : ""}
    </div>
    ${
      S.sel.size && ed
        ? `<div class="t2-selbar"><b>${S.sel.size} movimento(s) selecionado(s)</b><span>total ${fmt(selT)}</span>
        <select class="finance-input t2-in t2-auto" id="t2SelTipo">${tipoOpts.map(([k, t]) => `<option value="${k}">${esc(k === "OUTRO" ? "— sem tipo —" : t.label)}</option>`).join("")}</select>
        <button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-t2a="seltipo">Mudar o tipo dos selecionados</button>
        <button type="button" class="finance-btn finance-btn--sm" data-t2a="selclr">Limpar seleção</button></div>`
        : ""
    }
    <section class="t3-sec t3-flush">${
      P.length
        ? `<div class="fx2-tw"><table class="fx2-t t2-t"><thead><tr><th title="Selecione vários movimentos por conciliar"></th><th>Tipo</th><th>Data Mov.</th><th title="Dia em que o dinheiro saiu ou entrou de facto na conta">Data Efetiva</th>${all ? "<th>Conta</th>" : ""}<th>Descrição</th><th class="r">Valor</th><th title="Nota interna sobre o movimento">Nota</th><th>Conc.</th><th>Centro de Custo</th></tr></thead>
        <tbody>${P.map((m) => {
          const v = sinal(m);
          const ok = conciliado(m);
          const ef = m.effectiveDate ? String(m.effectiveDate).slice(0, 10) : "";
          return `<tr class="${ok ? "t2-ok-row" : ""}${S.sel.has(m.id) ? " t2-sel" : ""}">
            <td>${!ok && ed ? `<input type="checkbox" data-msel="${esc(m.id)}"${S.sel.has(m.id) ? " checked" : ""}>` : ""}</td>
            <td>${
              ed
                ? `<select class="finance-input t2-in t2-tipo${m.typeAuto ? " t2-tipoauto" : ""}" data-mvtipo="${esc(m.id)}" title="${m.typeAuto ? "Classificado pelas regras" : esc(MOVEMENT_TYPE[m.movementType]?.label || "")}">${tipoOpts.map(([k, t]) => `<option value="${k}"${m.movementType === k ? " selected" : ""}>${esc(k === "OUTRO" ? "" : t.label)}</option>`).join("")}</select>`
                : esc(MOVEMENT_TYPE[m.movementType]?.label || "")
            }</td>
            <td class="t3-nowrap">${fmtData(m.movementDate)}</td>
            <td class="t3-nowrap${ef && ef !== dia(m) ? "" : " fx2-mut"}">${fmtData(ef || m.movementDate)}</td>
            ${all ? `<td class="t3-nowrap"><b>${esc(contaCod(m.card))}</b></td>` : ""}
            <td class="t2-desc" title="${esc(m.statement?.name || "")}">${esc(m.description || "")}</td>
            <td class="r t3-nowrap${v < 0 ? " fcal-out" : ""}"><b>${fmt(v)}</b></td>
            <td>${ed ? `<input class="finance-input t2-in t2-nota" data-mvnota="${esc(m.id)}" value="${esc(m.notes || "")}" placeholder="nota interna">` : esc(m.notes || "")}</td>
            <td>${concCell(m, ed)}</td>
            <td class="t2-cc">${ccCell(m, ed)}</td></tr>`;
        }).join("")}</tbody></table></div>
        ${
          np > 1
            ? `<div class="t3-acts t2-pag"><button type="button" class="finance-btn finance-btn--sm" data-t2pg="${pg - 1}"${pg <= 0 ? " disabled" : ""}>‹ Anteriores</button><span class="fx2-mut t3-small">Página ${pg + 1} de ${np} · ${L.length} movimentos · ${tot}</span><button type="button" class="finance-btn finance-btn--sm" data-t2pg="${pg + 1}"${pg >= np - 1 ? " disabled" : ""}>Seguintes ›</button></div>`
            : `<p class="fx2-mut t3-small t2-pag">${L.length} movimento(s) · ${tot}</p>`
        }`
        : `<p class="fx2-mut" style="padding:14px">Sem movimentos${S.mes || S.so || S.q || S.tipo ? " com estes filtros" : ""}. Importe o extrato${all ? "" : " desta conta"} ou lance um movimento abaixo.</p>`
    }</section>
    <p class="fx2-mut t3-small">⇄ conciliar · ✓ conciliado (✎ ver ou alterar) · Valores a <b class="fcal-out">vermelho</b> = saídas · a preto = entradas · <b>⇄</b> numa saída = associar o custo (obra, categoria, fornecedor); numa entrada = classificar e, se for recebimento de cliente, ligar às faturas · ↔ transferência entre contas da MBT: indique a outra conta em «Centro de Custo», ou fica casada sozinha com o movimento oposto na outra conta · operações anuladas ficam conciliadas sozinhas (o levantamento ATM leva custo, item a item) · os movimentos do extrato não se apagam (só a importação inteira, em Tesouraria › Extratos Bancários).</p>
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
    prepararPares(S.itens);
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

async function aplicar(btn) {
  btn.disabled = true;
  try {
    const r = await aplicarRegras(S.conta || null);
    toast(
      r.classificados || r.desfeitos
        ? `${r.classificados} movimento(s) classificado(s) pelas regras${r.desfeitos ? ` · ${r.desfeitos} voltaram a «sem tipo»` : ""}.`
        : "Nenhum movimento sem tipo corresponde às regras.",
      { type: r.classificados ? "success" : "info" }
    );
    await carregar();
  } catch (e) {
    btn.disabled = false;
    toast(e.data?.message || e.message || "Falha ao aplicar as regras.", { type: "error" });
  }
}

async function mudarTipoSel(btn) {
  const tipo = document.getElementById("t2SelTipo")?.value;
  const L = S.itens.filter((m) => S.sel.has(m.id));
  if (!tipo || !L.length) return;
  btn.disabled = true;
  let ok = 0;
  const falhas = [];
  for (const m of L) {
    if (tipo === "RECEBIMENTO_CLIENTE" && !isIncoming(m)) {
      falhas.push("uma saída não pode ser recebimento de cliente");
      continue;
    }
    try {
      await apiRequest(`/finance/bank-movements/${encodeURIComponent(m.id)}`, { method: "PATCH", body: { movementType: tipo } });
      ok++;
    } catch (e) {
      falhas.push(e.data?.message || e.message);
    }
  }
  toast(`${ok} movimento(s) com o tipo mudado${falhas.length ? ` · ${falhas.length} não: ${[...new Set(falhas)].join("; ")}` : ""}.`, { type: ok ? "success" : "error" });
  S.sel.clear();
  await carregar();
}

async function desfazerPedido(m) {
  if (!m?.purchaseOrderId) return;
  if (!window.confirm(`Desfazer a conciliação com ${m.pedido?.number || "o pedido"}? O pagamento registado no pedido fica; só se desliga o movimento.`)) return;
  try {
    await apiRequest(`/purchase-orders/${encodeURIComponent(m.purchaseOrderId)}/bank-link/${encodeURIComponent(m.id)}`, { method: "DELETE" });
    toast("Conciliação desfeita.", { type: "success" });
    await carregar();
  } catch (e) {
    toast(e.data?.message || e.message || "Falha ao desfazer.", { type: "error" });
  }
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
    if (m && r.movement) {
      Object.assign(m, {
        movementType: r.movement.movementType,
        notes: r.movement.notes,
        typeAuto: r.movement.typeAuto,
        transferCardId: r.movement.transferCardId,
      });
    }
    el?.classList.add("t2-gravado");
    setTimeout(() => el?.classList.remove("t2-gravado"), 900);
    if (body.movementType !== undefined || body.transferCardId !== undefined) {
      prepararPares(S.itens);
      desenhar();
    }
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
    if (a && !a.disabled) {
      const k = a.dataset.t2a;
      if (k === "regras") return abrirRegras({ regras: S.regras, cardId: S.conta || null, onSaved: (r) => (S.regras = r), onApplied: carregar });
      if (k === "tipos") return abrirTipos();
      if (k === "regrasaplicar") return aplicar(a);
      if (k === "movadd") return lancarManual(a);
      if (k === "seltipo") return mudarTipoSel(a);
      if (k === "selclr") {
        S.sel.clear();
        return desenhar();
      }
    }
    const p = t.closest("[data-t2pg]");
    if (p && !p.disabled) {
      S.pg = Math.max(0, Number(p.dataset.t2pg));
      return desenhar();
    }
    const cl = t.closest("[data-t2cl]");
    if (cl) return openClassifyModal(S.itens.find((m) => m.id === cl.dataset.t2cl), { options: S.options, onSaved: carregar });
    const as = t.closest("[data-t2as]");
    if (as) {
      const mov = S.itens.find((m) => m.id === as.dataset.t2as);
      return abrirConciliarSaida(mov, {
        onSaved: carregar,
        onCusto: () => openAssignCostModal(mov, { options: S.options, onSaved: carregar }),
        returnTo: location.pathname + location.search,
      });
    }
    const un = t.closest("[data-t2unlink]");
    if (un) return desfazerPedido(S.itens.find((m) => m.id === un.dataset.t2unlink));
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.msel) {
      if (t.checked) S.sel.add(t.dataset.msel);
      else S.sel.delete(t.dataset.msel);
      return desenhar();
    }
    if (t.dataset.mvtipo) return gravarCampo(t.dataset.mvtipo, { movementType: t.value }, t);
    if (t.dataset.mvnota) return gravarCampo(t.dataset.mvnota, { notes: t.value.trim() || null }, t);
    if (t.dataset.mvtrf) return gravarCampo(t.dataset.mvtrf, { transferCardId: t.value || null }, t);
    const k = t.dataset.t2f;
    if (!k) return;
    S[k] = t.type === "checkbox" ? t.checked : t.value;
    S.pg = 0;
    if (k === "conta") S.mes = null;
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
      S.mes = null;
      desenhar();
    }
  }
}
