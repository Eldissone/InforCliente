import { guardPageAccess, initPermissionLayer } from "./permissions.js";
import { wireLogout, wireUsersNav } from "./session.js";
import { initMobileMenu } from "./ui.js";

export function escapeFinanceHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPageHeader({ kicker, title, subtitle }) {
  const slot = document.getElementById("financePageHeader");
  if (!slot) return;
  slot.innerHTML = `
    <header class="finance-page-header">
      <div>
        <p class="finance-kicker">${escapeFinanceHtml(kicker || "Financeiro")}</p>
        <h1 class="finance-title">${escapeFinanceHtml(title || "Financeiro")}</h1>
        ${subtitle ? `<p class="finance-subtitle">${escapeFinanceHtml(subtitle)}</p>` : ""}
      </div>
      <div id="financePageActions" class="finance-page-actions"></div>
    </header>`;
}

/**
 * Bootstrap partilhado das páginas da Área Financeira.
 * Devolve `false` quando o acesso é negado (o utilizador já foi redirecionado).
 */
export async function initFinancePage({ kicker = "Financeiro", title = "Financeiro", subtitle = "" } = {}) {
  await initPermissionLayer();
  const ok = await guardPageAccess("financeiro", "view");
  if (!ok) return false;
  wireLogout();
  wireUsersNav();
  initMobileMenu();
  renderPageHeader({ kicker, title, subtitle });
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
