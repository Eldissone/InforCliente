import { destroyCharts } from "./charts.js";
import { renderPainelF0 } from "./painelF0.js";

/**
 * Ecrã «Painel Financeiro» (F0).
 */
export async function render() {
  destroyCharts();
  const root = document.getElementById("financeRoot");
  if (!root) return;
  root.innerHTML = `<div id="f0Painel" class="f0"></div>`;
  await renderPainelF0(document.getElementById("f0Painel"));
}
