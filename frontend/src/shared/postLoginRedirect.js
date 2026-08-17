/** Destino da página inicial conforme perfil (síncrono — links de navegação). */
export function resolveHomePathByRole(role) {
  const r = (role || "").toLowerCase();
  if (r === "cliente") return "../Dashboard/clientDashboard.html";
  if (r === "tecnico") return "../Projectos/tecnicoPlanos.html";
  return "../Dashboard/index.html";
}

/**
 * Destino após login (assíncrono — inclui permissões efectivas).
 * Role financeiro → Perfil Financeiro; utilizadores só-financeiros (override) também.
 */
export async function resolvePostLoginPath(user) {
  const role = (user?.role || "").toLowerCase();
  
  // O cliente tem um dashboard isolado
  if (role === "cliente") return "../Dashboard/clientDashboard.html";
  
  // Especial: o Técnico tem um entrypoint específico fora do navbar
  if (role === "tecnico") return "../Projectos/tecnicoPlanos.html";

  const { loadUserPermissions, can } = await import("./permissions.js");
  await loadUserPermissions({ force: true });

  const priorityRoutes = [
    { action: "nav_dashboard", path: "../Dashboard/index.html" },
    { action: "nav_clientes", path: "../Clientes/clienteLista.html" },
    { action: "nav_obras", path: "../Projectos/ProjectGeral.html" },
    { action: "nav_logistica", path: "../Stock/index.html" },
    { action: "nav_planeamento", path: "../Projectos/centroCustos.html" },
    { action: "nav_financeiro", path: "../Financeiro/financeiro.html" },
    { action: "nav_cotacao", path: "../Projectos/Cotacao/index.html" },
    { action: "nav_centros_gerais", path: "../Financeiro/centroDeCompras.html" },
    { action: "nav_users", path: "../Users/index.html" },
  ];

  for (const route of priorityRoutes) {
    if (can("navlinks", route.action)) {
      return route.path;
    }
  }

  return "../Dashboard/index.html";
}
