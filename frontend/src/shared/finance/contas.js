import { destroyCharts } from "./charts.js";

/**
 * Ecrã «Contas a Receber / Pagar»: uma só página com três separadores —
 * Recebimentos, Pagamentos e Cash Flow. Cada separador é um módulo próprio que
 * desenha em #financeRoot; aqui só se escolhe qual e se guarda em `?tab=`.
 */

const TABS = {
  receber: { label: "Recebimentos", icon: "south_west", load: () => import("./contasRecebimentos.js") },
  pagar: { label: "Pagamentos", icon: "north_east", load: () => import("./contasPagamentos.js") },
  cashflow: { label: "Cash Flow", icon: "waterfall_chart", load: () => import("./contasCashflow.js") },
};

let current = null;

function renderTabs() {
  const actions = document.getElementById("financePageActions");
  if (!actions) return;
  actions.innerHTML = `
    <div class="finance-seg ac-tabs" role="tablist">
      ${Object.entries(TABS)
        .map(
          ([key, t]) => `
        <button type="button" role="tab" data-tab="${key}" class="${key === current ? "active" : ""}" aria-selected="${key === current}">
          <span class="material-symbols-outlined">${t.icon}</span><span>${t.label}</span>
        </button>`
        )
        .join("")}
    </div>`;
  actions.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab !== current) openTab(btn.dataset.tab);
    });
  });
}

async function openTab(key) {
  current = TABS[key] ? key : "receber";
  const url = new URL(window.location.href);
  url.searchParams.set("tab", current);
  // O filtro rápido (?view=) é de cada separador: não passa para o seguinte.
  if (key !== new URLSearchParams(window.location.search).get("tab")) url.searchParams.delete("view");
  window.history.replaceState({}, "", url);
  renderTabs();
  destroyCharts();
  const mod = await TABS[current].load();
  await mod.render();
}

export async function render() {
  const params = new URLSearchParams(window.location.search);
  current = TABS[params.get("tab")] ? params.get("tab") : "receber";
  renderTabs();
  const mod = await TABS[current].load();
  await mod.render();
}
