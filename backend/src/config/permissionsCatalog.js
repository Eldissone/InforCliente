/**
 * Catálogo central de permissões — fonte única para defaults, UI e sincronização.
 * Valores allowed: "true" | "own" | "view" | "false"
 */

const ROLES = ["admin", "operador", "tecnico", "supervisor", "leitura", "cliente"];

const ROLE_LABELS = {
  admin: "Admin",
  operador: "Operador",
  tecnico: "Técnico",
  supervisor: "Supervisor",
  leitura: "Leitura",
  cliente: "Cliente",
};

/** Herança conceptual: perfis baseiam-se nesta ordem de precedência para documentação/UI */
const ROLE_INHERITANCE_CHAIN = ["leitura", "cliente", "tecnico", "operador", "supervisor", "admin"];

const ALLOWED_LEVELS = ["true", "own", "view", "false"];

const ACTION_LABELS = {
  view: "Visualizar",
  create: "Criar",
  edit: "Editar",
  delete: "Eliminar",
  approve: "Aprovar",
  export: "Exportar",
  manage_permissions: "Gerir permissões",
  full_access: "Acesso total",
  // Legado (rotas existentes)
  read: "Visualizar (leitura)",
  manage: "Gerir / operar",
  financeiro: "Módulo financeiro",
};

/** Grupos para o mapa de permissões (módulo → páginas → acções) */
const PERMISSION_GROUPS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    pages: [
      { id: "dashboard.main", label: "Dashboard Geral", route: "/Dashboard/index.html" },
      { id: "dashboard.cliente", label: "Dashboard Cliente", route: "/Dashboard/clientDashboard.html" },
    ],
    actions: ["view", "export", "full_access"],
  },
  {
    id: "analytics",
    label: "Analytics & KPIs",
    icon: "monitoring",
    pages: [{ id: "analytics.kpi", label: "Métricas e indicadores", route: "/Dashboard/index.html" }],
    actions: ["view", "export"],
  },
  {
    id: "clientes",
    label: "Clientes",
    icon: "group",
    pages: [
      { id: "clientes.list", label: "Lista de clientes", route: "/Clientes/clienteLista.html" },
      { id: "clientes.detail", label: "Detalhe do cliente", route: "/ClienteDetalhe/client.html" },
    ],
    actions: ["view", "create", "edit", "delete", "export", "full_access"],
  },
  {
    id: "interacoes",
    label: "Interações",
    icon: "forum",
    pages: [{ id: "interacoes.main", label: "Histórico de interações", route: "/ClienteDetalhe/client.html" }],
    actions: ["view", "create", "edit", "delete"],
  },
  {
    id: "obras",
    label: "Obras",
    icon: "construction",
    pages: [
      { id: "obras.list", label: "Lista de obras", route: "/Projectos/ProjectGeral.html" },
      { id: "obras.view", label: "Vista da obra", route: "/Projectos/projectView.html" },
      { id: "obras.tecnico", label: "Planos (técnico)", route: "/Projectos/tecnicoPlanos.html" },
      { id: "obras.planos", label: "Planos diários / tarefas", route: "/Projectos/projectView.html" },
    ],
    actions: ["view", "read", "create", "edit", "delete", "approve", "export", "manage", "financeiro", "full_access"],
  },
  {
    id: "logistica",
    label: "Logística",
    icon: "local_shipping",
    pages: [{ id: "logistica.hub", label: "Hub logístico", route: "/Stock/index.html" }],
    actions: ["view", "export", "full_access"],
  },
  {
    id: "stock",
    label: "Stock & Armazéns",
    icon: "inventory_2",
    pages: [
      { id: "stock.main", label: "Logística & Stock", route: "/Stock/index.html" },
      { id: "stock.armazens", label: "Armazéns", route: "/Stock/index.html" },
      { id: "stock.movimentos", label: "Movimentos de stock", route: "/Stock/index.html" },
      { id: "stock.inventario", label: "Inventário", route: "/Stock/index.html" },
    ],
    actions: ["view", "create", "edit", "delete", "approve", "export", "manage", "full_access"],
  },
  {
    id: "materiais",
    label: "Materiais & Catálogo",
    icon: "category",
    pages: [
      { id: "materiais.catalogo", label: "Catálogo de produtos", route: "/Stock/index.html" },
      { id: "materiais.consumo", label: "Material de consumo", route: "/Stock/index.html" },
    ],
    actions: ["view", "create", "edit", "delete", "export", "manage", "full_access"],
  },
  {
    id: "ferramentas",
    label: "Ferramentas",
    icon: "handyman",
    pages: [{ id: "ferramentas.gestao", label: "Ferramentas e equipamentos", route: "/Stock/index.html" }],
    actions: ["view", "create", "edit", "delete", "manage", "export"],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    icon: "payments",
    pages: [
      { id: "financeiro.obras", label: "Financeiro por obra", route: "/Projectos/projectView.html" },
      { id: "financeiro.relatorios", label: "Resumos financeiros", route: "/Projectos/projectView.html" },
    ],
    actions: ["view", "edit", "export", "approve", "full_access"],
  },
  {
    id: "relatorios",
    label: "Relatórios",
    icon: "description",
    pages: [
      { id: "relatorios.geral", label: "Relatórios gerais", route: "/Dashboard/index.html" },
      { id: "relatorios.stock", label: "Relatórios de stock", route: "/Stock/index.html" },
      { id: "relatorios.obras", label: "Relatórios de obras", route: "/Projectos/ProjectGeral.html" },
    ],
    actions: ["view", "export", "full_access"],
  },
  {
    id: "sistema",
    label: "Utilizadores",
    icon: "manage_accounts",
    pages: [{ id: "sistema.users", label: "Gestão de utilizadores", route: "/Users/index.html" }],
    actions: ["view", "create", "edit", "delete", "export", "full_access"],
  },
  {
    id: "permissoes",
    label: "Permissões",
    icon: "security",
    pages: [{ id: "permissoes.mapa", label: "Mapa de permissões", route: "/Users/index.html" }],
    actions: ["view", "edit", "manage_permissions", "full_access"],
  },
  {
    id: "configuracoes",
    label: "Configurações",
    icon: "settings",
    pages: [{ id: "configuracoes.geral", label: "Configurações do sistema", route: "/Users/index.html" }],
    actions: ["view", "edit", "full_access"],
  },
  {
    id: "portal",
    label: "Portal do Cliente",
    icon: "business",
    pages: [{ id: "portal.main", label: "Portal cliente", route: "/Dashboard/clientDashboard.html" }],
    actions: ["view", "export", "full_access"],
  },
];

/** Rotas → permissão mínima para aceder à página */
const PAGE_ROUTE_GUARDS = [
  { route: "/Dashboard/index.html", module: "dashboard", action: "view", roles: ["admin", "operador", "supervisor", "leitura", "tecnico"] },
  { route: "/Dashboard/clientDashboard.html", module: "portal", action: "view", roles: ["cliente"] },
  { route: "/Clientes/clienteLista.html", module: "clientes", action: "view" },
  { route: "/ClienteDetalhe/client.html", module: "clientes", action: "view" },
  { route: "/Projectos/ProjectGeral.html", module: "obras", action: "view" },
  { route: "/Projectos/projectView.html", module: "obras", action: "view" },
  { route: "/Projectos/tecnicoPlanos.html", module: "obras", action: "view", roles: ["tecnico", "admin", "supervisor", "operador"] },
  { route: "/Stock/index.html", module: "stock", action: "view" },
  { route: "/Users/index.html", module: "sistema", action: "view", roles: ["admin"] },
];

/**
 * Matriz por defeito por perfil (herança aplicada via overrides explícitos).
 * Retorna "true" | "own" | "view" | "false"
 */
function defaultAllowedFor(role, module, action) {
  if (role === "admin") {
    if (module === "portal" && action === "view") return "false";
    if (module === "permissoes" || action === "manage_permissions") return "true";
    return "true";
  }

  if (role === "supervisor") {
    const map = {
      dashboard: { view: "true", export: "true", full_access: "false" },
      analytics: { view: "true", export: "true" },
      clientes: { view: "true", create: "false", edit: "true", delete: "false", export: "true", full_access: "false" },
      interacoes: { view: "true", create: "true", edit: "true", delete: "false" },
      obras: {
        view: "true", read: "true", create: "true", edit: "true", delete: "false",
        approve: "true", export: "true", manage: "true", financeiro: "view", full_access: "false",
      },
      logistica: { view: "true", export: "true", full_access: "false" },
      stock: {
        view: "true", create: "true", edit: "true", delete: "false", approve: "true",
        export: "true", manage: "true", full_access: "false",
      },
      materiais: { view: "true", create: "false", edit: "false", delete: "false", export: "true", manage: "false", full_access: "false" },
      ferramentas: { view: "true", create: "false", edit: "false", delete: "false", manage: "false", export: "true" },
      financeiro: { view: "view", edit: "false", export: "true", approve: "false", full_access: "false" },
      relatorios: { view: "true", export: "true", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "view", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
    };
    return map[module]?.[action] ?? "false";
  }

  if (role === "operador") {
    const map = {
      dashboard: { view: "true", export: "true", full_access: "false" },
      analytics: { view: "true", export: "true" },
      clientes: { view: "true", create: "true", edit: "true", delete: "false", export: "true", full_access: "false" },
      interacoes: { view: "true", create: "true", edit: "true", delete: "false" },
      obras: {
        view: "true", read: "true", create: "true", edit: "true", delete: "false",
        approve: "true", export: "true", manage: "true", financeiro: "true", full_access: "false",
      },
      logistica: { view: "true", export: "true", full_access: "false" },
      stock: {
        view: "true", create: "true", edit: "true", delete: "false", approve: "true",
        export: "true", manage: "true", full_access: "false",
      },
      materiais: { view: "true", create: "false", edit: "false", delete: "false", export: "true", manage: "false", full_access: "false" },
      ferramentas: { view: "true", create: "false", edit: "false", delete: "false", manage: "false", export: "true" },
      financeiro: { view: "true", edit: "true", export: "true", approve: "false", full_access: "false" },
      relatorios: { view: "true", export: "true", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "false", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
    };
    return map[module]?.[action] ?? "false";
  }

  if (role === "tecnico") {
    const map = {
      dashboard: { view: "false", export: "false", full_access: "false" },
      analytics: { view: "false", export: "false" },
      clientes: { view: "view", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      interacoes: { view: "view", create: "false", edit: "false", delete: "false" },
      obras: {
        view: "true", read: "true", create: "false", edit: "true", delete: "false",
        approve: "false", export: "view", manage: "true", financeiro: "false", full_access: "false",
      },
      logistica: { view: "view", export: "false", full_access: "false" },
      stock: {
        view: "true", create: "false", edit: "false", delete: "false", approve: "false",
        export: "false", manage: "false", full_access: "false",
      },
      materiais: { view: "true", create: "false", edit: "false", delete: "false", export: "false", manage: "false", full_access: "false" },
      ferramentas: { view: "true", create: "false", edit: "false", delete: "false", manage: "false", export: "false" },
      financeiro: { view: "false", edit: "false", export: "false", approve: "false", full_access: "false" },
      relatorios: { view: "view", export: "false", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "false", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
    };
    return map[module]?.[action] ?? "false";
  }

  if (role === "leitura") {
    const readOnly = ["view", "read", "export"];
    if (module === "portal") return "false";
    if (module === "sistema" || module === "permissoes" || module === "configuracoes") return "false";
    if (action === "full_access" || action === "manage_permissions") return "false";
    if (readOnly.includes(action)) {
      if (module === "obras" && action === "financeiro") return "view";
      return "true";
    }
    if (action === "manage") return "false";
    return "false";
  }

  if (role === "cliente") {
    if (module === "portal") {
      if (["view", "export", "full_access"].includes(action)) return action === "full_access" ? "false" : "true";
    }
    const ownModules = ["clientes", "obras", "stock", "logistica", "interacoes", "relatorios"];
    if (ownModules.includes(module)) {
      if (["view", "read", "export"].includes(action)) return "own";
      if (module === "obras" && action === "financeiro") return "own";
    }
    return "false";
  }

  return "false";
}

/** Linhas planas para seed / reset */
function buildDefaultPermissions() {
  const rows = [];
  const seen = new Set();

  for (const group of PERMISSION_GROUPS) {
    for (const action of group.actions) {
      for (const role of ROLES) {
        const key = `${role}|${group.id}|${action}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          role,
          module: group.id,
          action,
          allowed: defaultAllowedFor(role, group.id, action),
        });
      }
    }
  }
  return rows;
}

/** Estrutura para renderização no frontend */
function buildDisplayCatalog() {
  return PERMISSION_GROUPS.map((group) => ({
    group: group.label,
    module: group.id,
    icon: group.icon,
    pages: group.pages,
    rows: group.actions.map((action) => ({
      label: ACTION_LABELS[action] || action,
      module: group.id,
      action,
      actionId: action,
    })),
  }));
}

function permKey(role, module, action) {
  return `${role}|${module}|${action}`;
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  ROLE_INHERITANCE_CHAIN,
  ALLOWED_LEVELS,
  ACTION_LABELS,
  PERMISSION_GROUPS,
  PAGE_ROUTE_GUARDS,
  defaultAllowedFor,
  buildDefaultPermissions,
  buildDisplayCatalog,
  permKey,
};
