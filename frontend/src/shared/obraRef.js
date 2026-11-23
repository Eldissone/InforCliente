/**
 * Mostra a referência da obra (ex.: «INF/MBT03/2026») no lugar do código
 * interno («OBR-MP5N7CKS-MV21») em todas as páginas.
 *
 * O código continua a ser o dado (ligações, filtros, pedidos ao servidor);
 * só o texto mostrado muda: o texto das páginas, as opções das listas e as
 * dicas (`title`). Sem referência, o código sai e fica o nome da obra:
 *   «OBR-… · Projecto X» → «INF/MBT03/2026 · Projecto X» (ou «Projecto X»).
 *
 * As referências vêm de `/project-labels` e ficam 10 minutos em memória da
 * sessão do navegador.
 */

import { apiRequest } from "../services/api.js";
import { trocarCodigos as trocar } from "./obraRefCore.js";

const CHAVE = "mbt_obra_refs";
const VALIDADE_MS = 10 * 60 * 1000;
let mapa = null;

function tratar(no) {
  if (!mapa) return;
  if (no.nodeType === Node.TEXT_NODE) {
    const t = no.nodeValue;
    if (t && t.indexOf("OBR-") >= 0) {
      const n = trocar(t, mapa);
      if (n !== t) no.nodeValue = n;
    }
    return;
  }
  if (no.nodeType !== Node.ELEMENT_NODE) return;
  if (no.closest?.("script, style, textarea, [contenteditable='true']")) return;
  for (const el of [no, ...no.querySelectorAll("[title*='OBR-']")]) {
    const ti = el.getAttribute?.("title");
    if (ti && ti.indexOf("OBR-") >= 0) el.setAttribute("title", trocar(ti, mapa));
  }
  if (!(no.textContent || "").includes("OBR-")) return;
  const w = document.createTreeWalker(no, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.indexOf("OBR-") >= 0 && !n.parentElement?.closest("script, style, textarea") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nos = [];
  while (w.nextNode()) nos.push(w.currentNode);
  for (const t of nos) tratar(t);
}

async function carregar() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CHAVE) || "null");
    if (c && Date.now() - c.em < VALIDADE_MS) return new Map(c.items.map((x) => [x.code, x.ref]));
  } catch {
    /* sem cache */
  }
  const r = await apiRequest("/project-labels");
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify({ em: Date.now(), items: r.items }));
  } catch {
    /* sessão cheia: segue sem cache */
  }
  return new Map((r.items || []).map((x) => [x.code, x.ref]));
}

/** Liga a troca à página (uma vez). */
export async function ligarReferenciasObra() {
  if (window.__obraRef) return;
  window.__obraRef = true;
  try {
    mapa = await carregar();
  } catch {
    return; // sem sessão ou sem rede: fica o código
  }
  tratar(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") tratar(m.target);
      else if (m.type === "attributes") tratar(m.target);
      else for (const n of m.addedNodes) tratar(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title"] });
}
