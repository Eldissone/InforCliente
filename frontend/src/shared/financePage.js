import { ligarAcoesEcra, VOLTAR_HTML, ACOES_HTML } from "./acoesEcra.js";
import { canPermission, guardPageAccess, initPermissionLayer } from "./permissions.js";
import { wireLogout, wireUsersNav } from "./session.js";
import { initMobileMenu } from "./ui.js";

export function escapeFinanceHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPageHeader({ kicker, title, subtitle, code }) {
  const slot = document.getElementById("financePageHeader");
  if (!slot) return;
  // Como no protótipo: «← Voltar» por cima, o código do ecrã (F0, P1, R1…) por
  // cima do título, e à direita Dúvidas · PDF · Word.
  slot.innerHTML = `
    ${VOLTAR_HTML}
    <header class="finance-page-header">
      <div>
        <h1 class="finance-title">${escapeFinanceHtml(title || "Financeiro")}</h1>
        ${subtitle ? `<p class="finance-subtitle">${escapeFinanceHtml(subtitle)}</p>` : ""}
      </div>
      <div class="finance-page-side">
        ${ACOES_HTML}
        <div id="financePageActions" class="finance-page-actions"></div>
      </div>
    </header>`;
  ligarAcoesEcra({
    info: () => ({
      codigo: slot.querySelector("[data-fcal-num]")?.textContent?.trim() || "",
      titulo: slot.querySelector(".finance-title")?.textContent?.trim() || title || "Financeiro",
      lead: slot.querySelector(".finance-subtitle")?.textContent?.trim() || subtitle || "",
      area: "Financeiro",
    }),
    raiz: () => document.getElementById("financeRoot") || document.body,
  });
}

/**
 * Bootstrap partilhado das páginas da Área Financeira.
 * Devolve `false` quando o acesso é negado (o utilizador já foi redirecionado).
 */
export async function initFinancePage({ kicker = "Financeiro", title = "Financeiro", subtitle = "", code = "", guards = null } = {}) {
  const map = await initPermissionLayer();
  // `guards`: lista de [módulo, ação] — basta uma (ecrãs partilhados por duas
  // áreas, como os da área Compras e Stock). Sem lista, é o Financeiro.
  const list = guards?.length ? guards : [["financeiro", "view"]];
  const any = list.slice(0, -1).some(([m, a]) => canPermission(map, m, a));
  const ok = any || (await guardPageAccess(...list[list.length - 1]));
  if (!ok) return false;
  wireLogout();
  wireUsersNav();
  initMobileMenu();
  renderPageHeader({ kicker, title, subtitle, code });
  return true;
}

/** Placeholder usado enquanto um ecrã ainda não está implementado. */
export function renderFinancePlaceholder(slot, title, items = []) {
  const target = typeof slot === "string" ? document.getElementById(slot) : slot;
  if (!target) return;
  const list = items.length
    ? `<ul class="finance-placeholder-list">${items
        .map((item) => `<li><span class="material-symbols-outlined">check_small</span>${escapeFinanceHtml(item)}</li>`)
        .join("")}</ul>`
    : "";
  target.innerHTML = `
    <section class="finance-card finance-placeholder">
      <span class="material-symbols-outlined finance-placeholder-icon">construction</span>
      <h2>${escapeFinanceHtml(title)}</h2>
      <p>Este ecrã faz parte da Área Financeira e está em construção.</p>
      ${list}
    </section>`;
}
