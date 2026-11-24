/** Destino da página inicial conforme perfil (síncrono — links de navegação). */
export function resolveHomePathByRole(role) {
  const r = (role || "").toLowerCase();
  if (r === "cliente") return "/Dashboard/clientDashboard";
  if (r === "tecnico") return "/Projectos/tecnicoPlanos";
  return "/Dashboard";
}

export function getSafeNextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return null;

  const normalizedNext = next.startsWith("/") ? next : `/${next}`;
  const target = new URL(normalizedNext, window.location.origin);
  if (target.origin !== window.location.origin) return null;

  const targetPath = target.pathname.replace(/\/+$/, "").toLowerCase();
  if (targetPath === "/login" || targetPath.startsWith("/auth/")) return null;

  return `${target.pathname}${target.search}${target.hash}`;
}

/**
 * Destino após login (assíncrono — inclui permissões efectivas).
 * Redireciona para a primeira rota em que o utilizador tem permissão de navegação e de módulo.
 */
export async function resolvePostLoginPath(user) {
  const role = (user?.role || "").toLowerCase();

  // O cliente tem um dashboard isolado
  if (role === "cliente") return "/Dashboard/clientDashboard";

  const { loadUserPermissions, resolveFirstAccessiblePath } = await import("./permissions.js");
  const map = await loadUserPermissions({ force: true });

  return resolveFirstAccessiblePath(map, role).replace(/\/index\.html$/, "").replace(/\.html$/, "");
}
