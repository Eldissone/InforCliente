/** Destino da página inicial conforme perfil (síncrono — links de navegação). */
export function resolveHomePathByRole(role) {
  const r = (role || "").toLowerCase();
  if (r === "cliente") return "/Dashboard/clientDashboard";
  if (r === "tecnico") return "/Projectos/tecnicoPlanos";
  return "/Dashboard";
}

/**
 * Destino após login (assíncrono — inclui permissões efectivas).
 * Role financeiro → Perfil Financeiro; utilizadores só-financeiros (override) também.
 */
export async function resolvePostLoginPath(user) {
  const role = (user?.role || "").toLowerCase();
  
  // O cliente tem um dashboard isolado
  if (role === "cliente") return "/Dashboard/clientDashboard";
  
  // Especial: o Técnico tem um entrypoint específico fora do navbar
  if (role === "tecnico") return "/Projectos/tecnicoPlanos";

  const { loadUserPermissions, can } = await import("./permissions.js");
  await loadUserPermissions({ force: true });

  const priorityRoutes = [
    { action: "nav_dashboard", path: "/Dashboard" },
    { action: "nav_clientes", path: "/Clientes/clienteLista" },
    { action: "nav_obras", path: "/Projectos/ProjectGeral" },
    { action: "nav_logistica", path: "/Stock" },
    { action: "nav_planeamento", path: "/Projectos/centroCustos" },
    { action: "nav_financeiro", path: "/Financeiro/centroDeCompras" },
    { action: "nav_cotacao", path: "/Projectos/Cotacao" },
    { action: "nav_centros_gerais", path: "/Financeiro/centroDeCompras" },
    { action: "nav_users", path: "/Users" },
  ];

  for (const route of priorityRoutes) {
    if (can("navlinks", route.action)) {
      return route.path;
    }
  }

  return "/Dashboard";
}
