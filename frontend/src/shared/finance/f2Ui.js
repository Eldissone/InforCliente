/**
 * Peças comuns dos ecrãs do Financeiro alinhados com o protótipo (fase F-2):
 * números, o código do ecrã no cabeçalho, segmentos de filtro, cartões de
 * indicadores e o selector de moeda.
 *
 * Os estilos estão em `financeiro.css` (classes `fx2-*`, e as do calendário,
 * `fcal-*`, que estes ecrãs reutilizam).
 */

import { escapeFinanceHtml as esc } from "../financePage.js";

export { esc };

export const fmt = (v) =>
  Number(v || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt0 = (v) => Number(v || 0).toLocaleString("pt-PT", { maximumFractionDigits: 0 });
export const fmtPct = (v) => `${(Number(v || 0) * 100).toLocaleString("pt-PT", { maximumFractionDigits: 0 })}%`;
export const fmtData = (k) => (k ? String(k).slice(0, 10).split("-").reverse().join("/") : "—");

// Os códigos do protótipo (F2, R4, T1…) deixaram de aparecer nos cabeçalhos.
export function codigoNoCabecalho() {}

/**
 * Botões de segmento. `attr` é o atributo `data-*` que o ecrã escuta;
 * o valor de cada botão vai como `chave|valor`.
 */
export function seg(attr, chave, atual, opcoes) {
  return `<span class="finance-seg">${opcoes
    .map(
      ([v, l]) =>
        `<button type="button" class="${String(atual) === v ? "active" : ""}" data-${attr}="${chave}|${esc(v)}">${esc(l)}</button>`
    )
    .join("")}</span>`;
}

/** O selector de moeda: só aparece quando há mais de uma. */
export function moedaSeg(attr, atual, moedas) {
  if (!moedas || moedas.length < 2) return "";
  return seg(attr, "moeda", atual, moedas.map((m) => [m, m]));
}

/**
 * Cartões de indicadores, como os `fxk` do protótipo.
 * `cards`: `[{ tom: good|bad|warn|neu|blue, titulo, valor, nota, acao? }]`
 */
export function kpis(cards) {
  return `<div class="fx2-kpis">${cards
    .filter(Boolean)
    .map((c) => {
      const inner = `<span class="fx2-kt">${esc(c.titulo)}</span><b class="fx2-kv">${c.valor}</b><span class="fx2-kn">${c.nota || "&nbsp;"}</span>`;
      return c.acao
        ? `<a class="fx2-k fx2-k--${c.tom || "neu"}" href="${esc(c.acao)}">${inner}</a>`
        : `<div class="fx2-k fx2-k--${c.tom || "neu"}">${inner}</div>`;
    })
    .join("")}</div>`;
}

export function vazio(texto) {
  return `<div class="finance-empty">${esc(texto)}</div>`;
}

export function erro(texto) {
  return `<div class="finance-empty">Não foi possível carregar: ${esc(texto)}</div>`;
}
