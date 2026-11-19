/**
 * Bootstrap comum a todas as páginas do módulo Comercial / Orçamentação.
 *
 * Cada página faz apenas:
 *   import { initComercialPage } from "/shared/comercial/page.js";
 *   initComercialPage({ perm: "tab_baremes" });
 *
 * Responsabilidades:
 *  - sessão válida (checkAuth);
 *  - guarda de acesso à página (comercial:<perm>);
 *  - cabeçalho, menu lateral e camada de permissões (via session.js / permissions.js);
 *  - marcar a página como só-leitura quando o utilizador não pode editar.
 */

import { checkAuth } from "/services/auth.js";
import { guardPageAccess, initPermissionLayer, can } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu } from "/shared/ui.js";

checkAuth();

/** Módulo de permissões do Comercial. */
export const COMERCIAL_MODULE = "comercial";

/**
 * @param {object} options
 * @param {string} options.perm   Acção exigida para abrir a página (ex.: "tab_baremes").
 * @param {Function} [options.onReady]  Executado depois das permissões aplicadas.
 * @returns {Promise<boolean>} false se o acesso foi negado (a página já redirecionou).
 */
export async function initComercialPage({ perm = "view", onReady } = {}) {
  const allowed = await guardPageAccess(COMERCIAL_MODULE, perm);
  if (!allowed) return false;

  initMobileMenu();
  wireLogout();
  wireUsersNav();
  await initPermissionLayer();

  // Só-leitura: esconde as acções de escrita marcadas com data-cm-write
  if (!canEdit()) {
    document.body.dataset.cmReadonly = "1";
    document.querySelectorAll("[data-cm-write]").forEach((el) => el.classList.add("hidden"));
  }

  if (typeof onReady === "function") await onReady();
  return true;
}

/** O utilizador pode criar/alterar no módulo Comercial? */
export function canEdit() {
  return can(COMERCIAL_MODULE, "edit") || can(COMERCIAL_MODULE, "create");
}

/** O utilizador pode aprovar (despacho, proposta)? */
export function canApprove() {
  return can(COMERCIAL_MODULE, "approve");
}

/** O utilizador pode adjudicar (criar a obra a partir do orçamento)? */
export function canAward() {
  return can(COMERCIAL_MODULE, "adjudicar");
}
