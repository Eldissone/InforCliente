/**
 * Peças comuns dos ecrãs da área Compras e Stock. Reaproveitam os estilos dos
 * ecrãs do Financeiro alinhados com o protótipo (`fx2-*`, `fcal-*`) e os
 * poucos próprios (`cs-*`), em `financeiro.css`.
 */

export { esc, fmt, fmt0, fmtData, kpis, vazio, erro, moedaSeg } from "../finance/f2Ui.js";
import { esc } from "../finance/f2Ui.js";

export const root = () => document.getElementById("financeRoot");

export const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const fmtQ = (v) => Number(v || 0).toLocaleString("pt-PT", { maximumFractionDigits: 2 });

/** Botão de filtro rápido (como os `fcpchip` do protótipo). */
export function chip(chave, valor, atual, label, n, extra = "") {
  return `<button type="button" class="fx2-chip${String(atual) === String(valor) ? " on" : ""}" data-chip="${esc(chave)}|${esc(valor)}"><span>${esc(label)}</span><b>${esc(n)}</b>${extra}</button>`;
}

export function select(chave, atual, opcoes, todos) {
  return `<select class="cs-sel" data-f="${esc(chave)}">${todos ? `<option value="">${esc(todos)}</option>` : ""}${opcoes
    .map(([v, l]) => `<option value="${esc(v)}"${String(atual) === String(v) ? " selected" : ""}>${esc(l)}</option>`)
    .join("")}</select>`;
}

/**
 * Liga a pesquisa (`data-q`) sem perder o foco ao redesenhar, os `<select>`
 * com `data-f="chave"` e os chips com `data-chip="chave|valor"`.
 */
export function ligar(S, desenhar, { onChange } = {}) {
  const el = root();
  el.addEventListener("input", (e) => {
    if (e.target.dataset.q === undefined) return;
    S.q = e.target.value;
    const pos = e.target.selectionStart;
    desenhar();
    const n = root().querySelector("[data-q]");
    if (n) {
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });
  el.addEventListener("change", (e) => {
    const k = e.target.dataset.f;
    if (!k) return;
    S[k] = e.target.value;
    if (onChange) onChange(k);
    else desenhar();
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    const [k, v] = b.dataset.chip.split("|");
    S[k] = v;
    if (onChange) onChange(k);
    else desenhar();
  });
}

export const pesquisa = (S, ph) =>
  `<input type="search" class="fcal-q" data-q placeholder="${esc(ph)}" value="${esc(S.q || "")}">`;
