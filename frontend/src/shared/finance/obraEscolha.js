/**
 * O selector de obra dos ecrãs de uma obra só (O3 Tesouraria, O4 Previsões).
 * A obra vive no endereço (`?obra=`), para se poder chegar a ela por um link
 * — o O1 e o O2 ligam para aqui.
 */

import { apiRequest } from "../../services/api.js";
import { esc } from "./f2Ui.js";

let cache = null;

export async function carregarObras() {
  if (!cache) cache = (await apiRequest("/finance/options/projects")).items || [];
  return cache;
}

export function obraDoEndereco() {
  return new URLSearchParams(window.location.search).get("obra") || "";
}

export function gravarObra(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("obra", id);
  else url.searchParams.delete("obra");
  window.history.replaceState({}, "", url);
}

export function obraSelect(obras, atual, attr) {
  return `<select class="fcal-ano fx3-obra" data-${attr}>
    <option value="">— escolher obra —</option>
    ${obras
      .map((o) => `<option value="${esc(o.id)}"${o.id === atual ? " selected" : ""}>${esc(`${o.code} · ${o.name}`)}</option>`)
      .join("")}
  </select>`;
}
