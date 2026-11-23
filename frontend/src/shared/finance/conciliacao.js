/**
 * T2 Conciliação Bancária — o `V.fext` do protótipo, como ecrã próprio.
 *
 * Todos os movimentos dos extratos (de todas as contas e cartões), com o
 * estado da conciliação:
 *  - uma **saída** está conciliada quando tem o custo associado (ou é
 *    mercadoria, que entra em stock), ou quando não leva custo (transferência
 *    interna, levantamento ATM, operação anulada);
 *  - uma **entrada** está conciliada quando está classificada e, se for um
 *    recebimento de cliente, ligada às faturas.
 * As ações são as dos Extratos (T3): classificar e associar custo. Os
 * extratos importam-se em T3.
 */

import { apiRequest } from "../../services/api.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, seg, kpis, vazio, erro } from "./f2Ui.js";
import {
  movementChip,
  isIncoming,
  needsCostAssignment,
  isReceiptLinked,
  receiptStateHtml,
  costStatusHtml,
  loadMovementOptions,
  openClassifyModal,
  openAssignCostModal,
} from "./movementsShared.js";

const root = () => document.getElementById("financeRoot");
const S = { itens: null, options: null, erro: null, conta: "", mes: "", est: "por", dir: "", q: "" };

/** Conciliado? — a mesma leitura dos Extratos. */
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

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.itens) return (el.innerHTML = vazio("A carregar…"));
  const contaDe = (m) => (m.card ? [m.card.bank, m.card.label, m.card.lastDigits ? `•${m.card.lastDigits}` : ""].filter(Boolean).join(" ") : "Sem conta");
  const contas = [...new Set(S.itens.map(contaDe))].sort((a, b) => a.localeCompare(b, "pt"));
  const meses = [...new Set(S.itens.map((m) => String(m.movementDate || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const q = norm(S.q).trim();
  const base = S.itens.filter(
    (m) =>
      (!S.conta || contaDe(m) === S.conta) &&
      (!S.mes || String(m.movementDate || "").startsWith(S.mes)) &&
      (!S.dir || m.direction === S.dir) &&
      (!q || norm([m.description, m.docNumber, m.supplier?.name, m.project?.name, m.statement?.name, m.amount].join(" ")).includes(q))
  );
  const por = base.filter((m) => !conciliado(m));
  const L = S.est === "por" ? por : S.est === "ok" ? base.filter(conciliado) : base;
  const soma = (X, d) => X.filter((m) => m.direction === d).reduce((s, m) => s + Number(m.amount || 0), 0);
  const edita = can("financeiro", "edit");

  el.innerHTML = `
    ${kpis([
      { tom: por.length ? "bad" : "good", titulo: "Por Conciliar", valor: String(por.length), nota: `${fmt(soma(por, "SAIDA"))} saídas · ${fmt(soma(por, "ENTRADA"))} entradas` },
      { tom: "good", titulo: "Conciliados", valor: String(base.length - por.length), nota: `de ${base.length} movimento(s)` },
      { tom: "neu", titulo: "Entradas", valor: fmt(soma(base, "ENTRADA")), nota: "no filtro" },
      { tom: "warn", titulo: "Saídas", valor: fmt(soma(base, "SAIDA")), nota: "no filtro" },
    ])}
    <div class="cp-filtros">
      <input type="search" class="finance-input" data-t2q placeholder="descrição, n.º, fornecedor, obra, valor…" value="${esc(S.q)}">
      <select class="finance-input" data-t2f="conta"><option value="">Todas as contas e cartões</option>${contas.map((c) => `<option${S.conta === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select class="finance-input" data-t2f="mes"><option value="">Todos os meses</option>${meses.map((m) => `<option${S.mes === m ? " selected" : ""}>${m}</option>`).join("")}</select>
      ${seg("t2", "est", S.est, [["por", "Por conciliar"], ["ok", "Conciliados"], ["", "Todos"]])}
      ${seg("t2", "dir", S.dir, [["", "Entradas e saídas"], ["ENTRADA", "Entradas"], ["SAIDA", "Saídas"]])}
      <a class="finance-btn" href="/Financeiro/tesouraria/extratos">Extratos (importar)</a>
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Data</th><th>Conta / Cartão</th><th>Tipo</th><th>Descrição</th><th>Obra · Fornecedor</th><th class="r">Entrada</th><th class="r">Saída</th><th>Conciliação</th><th></th></tr></thead>
      <tbody>${L.map((m) => {
        const ent = isIncoming(m);
        const ok = conciliado(m);
        const acoes = edita
          ? `${!ok && (m.movementType === "OUTRO" || ent) ? `<button type="button" class="finance-btn finance-btn--sm" data-t2cl="${esc(m.id)}">Classificar</button>` : ""}
             ${!ent && needsCostAssignment(m) && !m.costAssigned && !m.isMerchandise ? `<button type="button" class="finance-btn finance-btn--sm" data-t2as="${esc(m.id)}">Associar custo</button>` : ""}`
          : "";
        return `<tr>
          <td>${fmtData(m.movementDate)}</td>
          <td class="fx2-mut">${esc(contaDe(m))}<div>${esc(m.statement?.name || "")}</div></td>
          <td>${movementChip(m.movementType)}</td>
          <td>${esc(m.description || "")}${m.docNumber ? ` <span class="fx2-mut">${esc(m.docNumber)}</span>` : ""}</td>
          <td class="fx2-mut">${esc([m.project?.name, m.supplier?.name].filter(Boolean).join(" · "))}</td>
          <td class="r fcal-in">${ent ? fmt(m.amount) : ""}</td><td class="r fcal-out">${ent ? "" : fmt(m.amount)}</td>
          <td>${ok ? '<span class="fcal-pill fcal-pill--good">Conciliado</span>' : '<span class="fcal-pill fcal-pill--warn">Por conciliar</span>'}
            <div>${ent ? (m.movementType === "RECEBIMENTO_CLIENTE" ? receiptStateHtml(m) : "") : costStatusHtml(m)}</div></td>
          <td class="g1-acts">${acoes}</td></tr>`;
      }).join("")}</tbody></table></div>`
        : vazio(S.itens.length ? "Nada com estes filtros." : "Ainda não há movimentos bancários. Importe os extratos em T3 · Extratos Bancários.")
    }
    <p class="fcal-nota">Uma saída fica conciliada quando tem o custo associado (ou é mercadoria, que entra em stock), ou quando não leva custo
      (transferência interna, levantamento ATM, operação anulada). Uma entrada fica conciliada quando está classificada e, se for recebimento de
      cliente, ligada às faturas.</p>`;
}

async function carregar() {
  try {
    const r = await apiRequest("/finance/bank-movements");
    S.itens = r.items || [];
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  codigoNoCabecalho("T2");
  const el = root();
  el.addEventListener("click", (e) => {
    const t = e.target;
    const b = t.closest("[data-t2]");
    if (b) {
      const [k, v] = b.dataset.t2.split("|");
      S[k] = v;
      return desenhar();
    }
    const cl = t.closest("[data-t2cl]");
    if (cl) return openClassifyModal(S.itens.find((m) => m.id === cl.dataset.t2cl), { options: S.options, onSaved: carregar });
    const as = t.closest("[data-t2as]");
    if (as) return openAssignCostModal(S.itens.find((m) => m.id === as.dataset.t2as), { options: S.options, onSaved: carregar });
  });
  el.addEventListener("change", (e) => {
    const k = e.target.dataset.t2f;
    if (!k) return;
    S[k] = e.target.value;
    desenhar();
  });
  let tempo = null;
  el.addEventListener("input", (e) => {
    if (e.target.dataset.t2q === undefined) return;
    S.q = e.target.value;
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
}
