import { destroyCharts } from "./charts.js";
import { renderCustosEmpresa } from "./custosEmpresa.js";

/**
 * Ecrã «Custos da Empresa» (A1).
 */
export async function render() {
  destroyCharts();
  const root = document.getElementById("financeRoot");
  if (!root) return;
  root.innerHTML = `<div id="a1Painel" class="f0"></div>`;
  await renderCustosEmpresa(document.getElementById("a1Painel"));
}
