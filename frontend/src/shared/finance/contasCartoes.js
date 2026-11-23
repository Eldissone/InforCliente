/**
 * T5 Contas Bancárias / Cartões — o `V.fcban` do protótipo: a lista, com
 * filtros (pesquisa, banco, tipo, ativas/inativas), o responsável em uso
 * (T6) e o saldo de tesouraria. «+ Nova Conta / Cartão» abre o registo.
 */

import { apiRequest } from "../../services/api.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, seg, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, erro: null, q: "", b: "", t: "", e: "A" };
const TIPO = { PREPAGO: "Fundo de maneio (pré-pago)", DEBITO: "Conta principal (débito)", CREDITO: "Cartão de crédito" };
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const all = S.d.items;
  const bancos = [...new Set(all.map((c) => c.bank || "Sem banco"))].sort((a, b) => a.localeCompare(b, "pt"));
  const q = norm(S.q).trim();
  const L = all.filter(
    (c) =>
      (S.e === "T" || (S.e === "A" ? c.active : !c.active)) &&
      (!S.b || (c.bank || "Sem banco") === S.b) &&
      (!S.t || c.type === S.t) &&
      (!q || norm([c.label, c.bank, c.lastDigits, c.holderName, c.responsible, c.fund?.name, c.project?.name].join(" ")).includes(q))
  );
  const cnt = (t) => all.filter((c) => c.active && c.type === t).length;
  el.innerHTML = `
    <div class="cp-filtros">
      <input type="search" class="finance-input" data-t5q placeholder="nome, n.º, banco, responsável…" value="${esc(S.q)}">
      <select class="finance-input" data-t5f="b"><option value="">Todos os bancos</option>${bancos.map((b) => `<option${S.b === b ? " selected" : ""}>${esc(b)}</option>`).join("")}</select>
      ${seg("t5", "e", S.e, [["A", "Ativas"], ["I", "Inativas"], ["T", "Todas"]])}
    </div>
    <div class="cp-filtros">${seg("t5", "t", S.t, [
      ["", `Todos (${all.filter((c) => c.active).length})`],
      ["DEBITO", `Conta Principal (${cnt("DEBITO")})`],
      ["PREPAGO", `Fundo de Maneio (${cnt("PREPAGO")})`],
      ["CREDITO", `Cartão de Crédito (${cnt("CREDITO")})`],
    ])}</div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Conta / Cartão</th><th>Banco</th><th>Tipo</th><th>N.º</th><th>Responsável</th><th>Obra / Fundo</th><th>Validade</th><th class="r">Saldo</th><th>Estado</th></tr></thead>
      <tbody>${L.map(
        (c) => `<tr${c.active ? "" : ' class="fx2-off"'}>
          <td><b>${esc(c.label)}</b>${c.holderName ? `<div class="fx2-mut">${esc(c.holderName)}</div>` : ""}</td>
          <td>${esc(c.bank || "—")}</td><td class="fx2-mut">${esc(TIPO[c.type] || c.type)}</td>
          <td>${c.lastDigits ? `•••• ${esc(c.lastDigits)}` : "—"}</td>
          <td>${esc(c.responsible || "—")}</td>
          <td class="fx2-mut">${esc([c.project ? [c.project.code, c.project.name].filter(Boolean).join(" · ") : "", c.fund?.name].filter(Boolean).join(" — "))}</td>
          <td>${c.expiresAt ? fmtData(c.expiresAt) : "—"}</td>
          <td class="r${c.balance < 0 ? " f0-neg" : ""}">${fmt(c.balance)} <small class="fx2-mut">${esc(c.fund?.currency || "AOA")}${c.estimated ? " ≈" : ""}</small></td>
          <td>${c.active ? '<span class="fcal-pill fcal-pill--blue">ativa</span>' : '<span class="fcal-pill fcal-pill--slate">inativa</span>'}</td></tr>`
      ).join("")}</tbody></table></div>`
        : vazio(all.length ? "Nada com estes filtros." : "Ainda não há contas nem cartões registados.")
    }
    <p class="fcal-nota">O responsável é o da alocação em uso (<a href="/Financeiro/alocacao-cartoes">T6 · Alocação de Cartões</a>).
      O saldo é o de tesouraria (último extrato ou acerto, mais os movimentos seguintes); ≈ = saldo do cartão, sem extrato.</p>`;
}

async function carregar() {
  try {
    S.d = await apiRequest("/finance/cards");
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  codigoNoCabecalho("T5");
  const acts = document.getElementById("financePageActions");
  if (acts && can("financeiro", "edit")) acts.innerHTML = `<a class="finance-btn finance-btn--primary" href="/registos/cartoes">+ Nova Conta / Cartão</a>`;
  const el = root();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-t5]");
    if (!b) return;
    const [k, v] = b.dataset.t5.split("|");
    S[k] = v;
    desenhar();
  });
  el.addEventListener("change", (e) => {
    const k = e.target.dataset.t5f;
    if (!k) return;
    S[k] = e.target.value;
    desenhar();
  });
  let tempo = null;
  el.addEventListener("input", (e) => {
    if (e.target.dataset.t5q === undefined) return;
    S.q = e.target.value;
    clearTimeout(tempo);
    tempo = setTimeout(() => {
      const pos = e.target.selectionStart;
      desenhar();
      const n = root().querySelector("[data-t5q]");
      if (n) {
        n.focus();
        n.setSelectionRange(pos, pos);
      }
    }, 250);
  });
  desenhar();
  await carregar();
}
