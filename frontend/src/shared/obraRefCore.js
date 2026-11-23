/**
 * A troca do código interno da obra (OBR-XXXXXXXX-XXXX) pela referência, num
 * texto. Sem dependências do navegador (testável); usada por `obraRef.js`.
 */

const PADRAO = /OBR-[A-Z0-9]{6,}-[A-Z0-9]{3,}/g;

/** O texto com os códigos trocados pela referência (ou retirados, com o separador). */
export function trocarCodigos(texto, refs) {
  if (!texto || !refs || texto.indexOf("OBR-") < 0) return texto;
  let out = texto.replace(PADRAO, (cod) => (refs.has(cod) ? refs.get(cod) || "\u0000" : cod));
  if (out.indexOf("\u0000") < 0) return out;
  // Sem referência: tira o código e o separador que o ligava ao nome.
  out = out
    .replace(/\u0000\s*[·—–:|-]\s*/g, "")
    .replace(/\s*[·—–|-]\s*\u0000/g, "")
    .replace(/\u0000/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ");
  return out.trim() || "—";
}

