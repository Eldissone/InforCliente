/** Destino da página inicial conforme perfil (síncrono — links de navegação). */
export function resolveHomePathByRole(role) {
  const r = (role || "").toLowerCase();
  if (r === "cliente") return "../Dashboard/clientDashboard.html";
  if (r === "tecnico") return "../Projectos/tecnicoPlanos.html";
  if (r === "financeiro") return "../Financeiro/financeiro.html";
  return "../Dashboard/index.html";
}

/**
 * Destino após login (assíncrono — inclui permissões efectivas).
 * Role financeiro → Perfil Financeiro; utilizadores só-financeiros (override) também.
 */
export async function resolvePostLoginPath(user) {
  const role = (user?.role || "").toLowerCase();
  if (role === "cliente") return "../Dashboard/clientDashboard.html";
  if (role === "tecnico") return "../Projectos/tecnicoPlanos.html";
  if (role === "financeiro") return "../Financeiro/financeiro.html";

  const { loadUserPermissions, can } = await import("./permissions.js");
  await loadUserPermissions({ force: true });
  if (can("financeiro", "edit") && !can("obras", "edit")) {
    return "../Financeiro/financeiro.html";
  }
  return "../Dashboard/index.html";
}
