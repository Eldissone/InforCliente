/**
 * Catálogo central de permissões — fonte única para defaults, UI e sincronização.
 * Valores allowed: "true" | "own" | "view" | "false"
 */

const ROLES = ["admin", "operador", "financeiro", "tecnico", "supervisor", "leitura", "cliente"];

const ROLE_LABELS = {
  admin: "Admin",
  operador: "Operador",
  financeiro: "Financeiro",
  tecnico: "Técnico",
  supervisor: "Supervisor",
  leitura: "Leitura",
  cliente: "Cliente",
};

/** Herança conceptual: perfis baseiam-se nesta ordem de precedência para documentação/UI */
const ROLE_INHERITANCE_CHAIN = ["leitura", "cliente", "tecnico", "financeiro", "operador", "supervisor", "admin"];

const ALLOWED_LEVELS = ["true", "own", "view", "false"];

const ACTION_LABELS = {
  view: "Visualizar",
  create: "Criar",
  edit: "Editar",
  delete: "Eliminar",
  approve: "Aprovar",
  reject: "Rejeitar",
  cancel: "Cancelar",
  export: "Exportar",
  download_gallery: "Descarregar fotos da galeria",
  manage_permissions: "Gerir permissões",
  full_access: "Acesso total",
  confirm_invoice: "Confirmar fatura (crédito)",
  pay: "Executar pagamento",
  // Legado (rotas existentes)
  read: "Visualizar (leitura)",
  manage: "Gerir / operar",
  financeiro: "Módulo financeiro",
  tab_inventory: "Aba: Inventário geral",
  tab_catalog: "Aba: Catálogo",
  tab_tools: "Aba: Ferramentas",
  tab_warehouses: "Aba: Armazéns",
  tab_stock_requests: "Aba: Pedidos de obra (Stock)",
  tab_returns: "Aba: Devoluções",
  tab_movements: "Aba: Histórico de movimentos",
  tab_deliveries: "Aba: Calendário de entregas",
  tab_dashboard: "Aba: Dashboard financeiro (obra)",
  tab_progress: "Aba: Avanço físico (obra)",
  tab_measurements: "Aba: Autos de medição (obra)",
  tab_daily_plans: "Aba: Planos diários (obra)",
  tab_files: "Aba: Gestão de arquivos (obra)",
  tab_project_stock: "Aba: Gestão de armazém (obra)",
  tab_project_stock_inventory: "Sub-aba: Stock/Armazém (obra)",
  tab_project_stock_requests: "Sub-aba: Pedidos de obra (armazém na obra)",
  tab_project_stock_history: "Sub-aba: Diário de armazém (obra)",
  tab_gallery: "Aba: Galeria da obra",
  tab_executive_summary: "Aba: Resumo executivo (portal)",
  tab_portal_arquivos: "Aba: Arquivos (portal)",
  tab_portal_obra_info: "Aba: Informação da obra (portal)",
  tab_portal_armazem: "Aba: Armazém (portal)",
  tab_portal_galeria: "Aba: Galeria da obra (portal)",
  tab_portal_contactos: "Aba: Contactos (portal)",
  tab_portal_stock_inventory: "Sub-aba: Inventário (portal)",
  tab_portal_stock_history: "Sub-aba: Diário (portal)",
  // Navlinks
  nav_cotacao: "Link nav: Cotação",
  nav_financeiro: "Link nav: Financeiro",
  nav_centros_gerais: "Link nav: Centro de Compras",
};

/**
 * Abas configuráveis por página — groupModule = módulo no mapa de permissões onde aparece.
 */
const PAGE_TABS = [
  { groupModule: "stock", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Inventário Geral", module: "stock", action: "tab_inventory" },
  { groupModule: "materiais", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Catálogo", module: "materiais", action: "tab_catalog" },
  { groupModule: "ferramentas", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Ferramentas", module: "ferramentas", action: "tab_tools" },
  { groupModule: "stock", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Armazéns", module: "stock", action: "tab_warehouses" },
  { groupModule: "obras", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Pedidos de Obra", module: "obras", action: "tab_stock_requests" },
  { groupModule: "stock", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Devoluções", module: "stock", action: "tab_returns" },
  { groupModule: "stock", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Histórico", module: "stock", action: "tab_movements" },
  { groupModule: "logistica", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Entregas", module: "logistica", action: "tab_deliveries" },
  { groupModule: "obras", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Dashboard financeiro", module: "obras", action: "tab_dashboard", fallbackAction: "financeiro" },
  { groupModule: "obras", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Avanço físico", module: "obras", action: "tab_progress" },
  { groupModule: "obras", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Autos de medição", module: "obras", action: "tab_measurements", fallbackAction: "tab_progress" },
  { groupModule: "obras", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Planos diários", module: "obras", action: "tab_daily_plans" },
  { groupModule: "obras", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Gestão de arquivos", module: "obras", action: "tab_files" },
  { groupModule: "stock", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Gestão de armazém", module: "stock", action: "tab_project_stock" },
  { groupModule: "obras", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Galeria da obra", module: "obras", action: "tab_gallery" },
  { groupModule: "stock", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Stock/Armazém (sub-aba)", module: "stock", action: "tab_project_stock_inventory", fallbackAction: "view" },
  { groupModule: "obras", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Pedidos de obra (sub-aba armazém)", module: "obras", action: "tab_project_stock_requests", fallbackAction: "view" },
  { groupModule: "stock", pageLabel: "Vista da obra", route: "/Projectos/projectView.html", label: "Diário de armazém (sub-aba)", module: "stock", action: "tab_project_stock_history", fallbackAction: "view" },
  { groupModule: "portal", pageLabel: "Portal do cliente", route: "/Dashboard/clientDashboard.html", label: "Resumo executivo", module: "portal", action: "tab_executive_summary" },
  { groupModule: "portal", pageLabel: "Portal do cliente", route: "/Dashboard/clientDashboard.html", label: "Gestão de arquivos", module: "portal", action: "tab_portal_arquivos" },
  { groupModule: "portal", pageLabel: "Portal do cliente", route: "/Dashboard/clientDashboard.html", label: "Informação da obra", module: "portal", action: "tab_portal_obra_info" },
  { groupModule: "portal", pageLabel: "Portal do cliente", route: "/Dashboard/clientDashboard.html", label: "Armazém", module: "portal", action: "tab_portal_armazem" },
  { groupModule: "portal", pageLabel: "Portal do cliente", route: "/Dashboard/clientDashboard.html", label: "Galeria da obra", module: "portal", action: "tab_portal_galeria" },
  { groupModule: "portal", pageLabel: "Portal do cliente", route: "/Dashboard/clientDashboard.html", label: "Contactos", module: "portal", action: "tab_portal_contactos" },
  { groupModule: "portal", pageLabel: "Portal do cliente", route: "/Dashboard/clientDashboard.html", label: "Inventário (sub-aba armazém)", module: "portal", action: "tab_portal_stock_inventory" },
  { groupModule: "portal", pageLabel: "Portal do cliente", route: "/Dashboard/clientDashboard.html", label: "Diário de armazém (sub-aba)", module: "portal", action: "tab_portal_stock_history" },
];

/** Herança quando a permissão da aba não está definida explicitamente */
const TAB_PERMISSION_FALLBACKS = Object.fromEntries(
  PAGE_TABS.map((t) => {
    const key = `${t.module}:${t.action}`;
    const fallbackAction = t.fallbackAction || "view";
    return [key, { module: t.module, action: fallbackAction }];
  })
);

function getTabsForGroup(groupModule) {
  return PAGE_TABS.filter((t) => t.groupModule === groupModule);
}

function defaultAllowedForTab(role, tab) {
  const fallbackAction = tab.fallbackAction || "view";
  return defaultAllowedFor(role, tab.module, fallbackAction);
}

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
    id: "chat",
    label: "Chat & Mensagens",
    icon: "chat",
    pages: [{ id: "chat.panel", label: "Painel de chat (global)", route: "*" }],
    actions: ["view", "send", "create_group"],
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
    actions: ["view", "read", "create", "edit", "delete", "approve", "export", "download_gallery", "manage", "financeiro", "full_access"],
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
      { id: "financeiro.perfil", label: "Perfil Financeiro", route: "/Financeiro/financeiro.html" },
      { id: "financeiro.centrosGerais", label: "Centro de Compras e Pedidos Extra", route: "/Financeiro/centroDeCompras.html" },
      { id: "financeiro.obras", label: "Financeiro por obra", route: "/Projectos/projectView.html" },
      { id: "financeiro.relatorios", label: "Resumos financeiros", route: "/Projectos/projectView.html" },
    ],
    actions: ["view", "edit", "export", "approve", "confirm_invoice", "certify_expense", "full_access"],
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
    actions: ["view", "export", "download_gallery", "full_access"],
  },
  {
    id: "fundoManeio",
    label: "Gestão de Cartões",
    icon: "credit_card",
    pages: [{ id: "fundoManeio.main", label: "Gestão de Cartões", route: "/Financeiro/centroDeCompras.html" }],
    actions: ["view", "create", "edit", "manage", "full_access"],
  },
  {
    id: "pedidosExtras",
    label: "Pedidos Extras",
    icon: "request_quote",
    pages: [{ id: "pedidosExtras.main", label: "Centro de Compras e Pedidos Extra", route: "/Financeiro/centroDeCompras.html" }],
    actions: ["view", "create", "edit", "approve", "pay", "delete", "reject", "cancel", "full_access"],
  },
  {
    id: "fornecedores",
    label: "Fornecedores",
    icon: "local_shipping",
    pages: [{ id: "fornecedores.main", label: "Fornecedores", route: "/Financeiro/centroDeCompras.html" }],
    actions: ["view", "create", "edit", "delete", "manage", "full_access"],
  },
  {
    id: "navlinks",
    label: "Links de Navegação (Header)",
    icon: "link",
    pages: [
      { id: "navlinks.dashboard", label: "Link: Dashboard", route: "/Dashboard/index.html" },
      { id: "navlinks.clientes", label: "Link: Clientes", route: "/Clientes/clienteLista.html" },
      { id: "navlinks.obras", label: "Link: Obras", route: "/Projectos/ProjectGeral.html" },
      { id: "navlinks.logistica", label: "Link: Logística", route: "/Stock/index.html" },
      { id: "navlinks.planeamento", label: "Link: Planeamento", route: "/Projectos/centroCustos.html" },
      { id: "navlinks.cotacao", label: "Link: Cotação", route: "/Projectos/Cotacao/index.html" },
      { id: "navlinks.financeiro", label: "Link: Financeiro", route: "/Financeiro/financeiro.html" },
      { id: "navlinks.centros_gerais", label: "Link: Centro de Compras", route: "/Financeiro/centroDeCompras.html" },
      { id: "navlinks.users", label: "Link: Gestão", route: "/Users/index.html" },
    ],
    actions: ["nav_dashboard", "nav_clientes", "nav_obras", "nav_logistica", "nav_planeamento", "nav_cotacao", "nav_financeiro", "nav_centros_gerais", "nav_users"],
  },
];

/** Rotas → permissão mínima para aceder à página */
const PAGE_ROUTE_GUARDS = [
  { route: "/Dashboard/index.html", module: "dashboard", action: "view", roles: ["admin", "operador", "financeiro", "supervisor", "leitura", "tecnico"] },
  { route: "/Dashboard/clientDashboard.html", module: "portal", action: "view", roles: ["cliente"] },
  { route: "/Clientes/clienteLista.html", module: "clientes", action: "view" },
  { route: "/ClienteDetalhe/client.html", module: "clientes", action: "view" },
  { route: "/Projectos/ProjectGeral.html", module: "obras", action: "view" },
  { route: "/Projectos/projectView.html", module: "obras", action: "view" },
  { route: "/Projectos/tecnicoPlanos.html", module: "obras", action: "view", roles: ["tecnico", "admin", "supervisor", "operador"] },
  { route: "/Stock/index.html", module: "stock", action: "view" },
  { route: "/Financeiro/financeiro.html", module: "financeiro", action: "view", roles: ["admin", "operador", "financeiro", "supervisor"] },
  { route: "/Financeiro/centroDeCompras.html", module: "pedidosExtras", action: "view", roles: ["admin", "operador", "financeiro", "supervisor", "tecnico"] },
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
      chat: { view: "true", send: "true", create_group: "true" },
      obras: {
        view: "true", read: "true", create: "true", edit: "true", delete: "false",
        approve: "true", export: "true", download_gallery: "true", manage: "true", financeiro: "view", full_access: "false",
      },
      logistica: { view: "true", export: "true", full_access: "false" },
      stock: {
        view: "true", create: "true", edit: "true", delete: "false", approve: "true",
        export: "true", manage: "true", full_access: "false",
      },
      materiais: { view: "true", create: "false", edit: "false", delete: "false", export: "true", manage: "false", full_access: "false" },
      ferramentas: { view: "true", create: "false", edit: "false", delete: "false", manage: "false", export: "true" },
      financeiro: { view: "view", edit: "false", export: "true", approve: "false", confirm_invoice: "false", certify_expense: "false", full_access: "false" },
      relatorios: { view: "true", export: "true", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "view", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
      fundoManeio: { view: "true", create: "true", edit: "true", manage: "true", full_access: "false" },
      pedidosExtras: { view: "true", create: "true", edit: "own", approve: "true", reject: "true", cancel: "true", pay: "false", delete: "true", full_access: "false" },
      navlinks: { nav_dashboard: "true", nav_clientes: "true", nav_obras: "true", nav_logistica: "true", nav_planeamento: "true", nav_cotacao: "true", nav_financeiro: "true", nav_centros_gerais: "true", nav_users: "false" },
    };
    return map[module]?.[action] ?? "false";
  }

  if (role === "operador") {
    const map = {
      dashboard: { view: "true", export: "true", full_access: "false" },
      analytics: { view: "true", export: "true" },
      clientes: { view: "true", create: "true", edit: "true", delete: "false", export: "true", full_access: "false" },
      interacoes: { view: "true", create: "true", edit: "true", delete: "false" },
      chat: { view: "true", send: "true", create_group: "true" },
      obras: {
        view: "true", read: "true", create: "true", edit: "true", delete: "false",
        approve: "true", export: "true", download_gallery: "true", manage: "true", financeiro: "true", full_access: "false",
      },
      logistica: { view: "true", export: "true", full_access: "false" },
      stock: {
        view: "true", create: "true", edit: "true", delete: "false", approve: "true",
        export: "true", manage: "true", full_access: "false",
      },
      materiais: { view: "true", create: "false", edit: "false", delete: "false", export: "true", manage: "false", full_access: "false" },
      ferramentas: { view: "true", create: "false", edit: "false", delete: "false", manage: "false", export: "true" },
      financeiro: { view: "true", edit: "true", export: "true", approve: "false", confirm_invoice: "false", certify_expense: "true", full_access: "false" },
      relatorios: { view: "true", export: "true", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "false", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
      fundoManeio: { view: "true", create: "true", edit: "true", manage: "true", full_access: "false" },
      pedidosExtras: { view: "true", create: "true", edit: "own", approve: "false", reject: "false", cancel: "true", pay: "true", delete: "false", full_access: "false" },
      navlinks: { nav_dashboard: "true", nav_clientes: "true", nav_obras: "true", nav_logistica: "true", nav_planeamento: "true", nav_cotacao: "false", nav_financeiro: "true", nav_centros_gerais: "true", nav_users: "false" },
    };
    return map[module]?.[action] ?? "false";
  }

  if (role === "financeiro") {
    const map = {
      dashboard: { view: "true", export: "true", full_access: "false" },
      analytics: { view: "true", export: "true" },
      clientes: { view: "view", create: "false", edit: "false", delete: "false", export: "true", full_access: "false" },
      interacoes: { view: "false", create: "false", edit: "false", delete: "false" },
      chat: { view: "true", send: "true", create_group: "false" },
      obras: {
        view: "view", read: "view", create: "false", edit: "false", delete: "false",
        approve: "false", export: "view", download_gallery: "false", manage: "false", financeiro: "true", full_access: "false",
      },
      logistica: { view: "false", export: "false", full_access: "false" },
      stock: {
        view: "false", create: "false", edit: "false", delete: "false", approve: "false",
        export: "false", manage: "false", full_access: "false",
      },
      materiais: { view: "false", create: "false", edit: "false", delete: "false", export: "false", manage: "false", full_access: "false" },
      ferramentas: { view: "false", create: "false", edit: "false", delete: "false", manage: "false", export: "false" },
      financeiro: {
        view: "true", edit: "true", export: "true", approve: "true",
        confirm_invoice: "true", certify_expense: "true", full_access: "false",
      },
      relatorios: { view: "true", export: "true", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "false", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
      fundoManeio: { view: "view", create: "false", edit: "false", manage: "false", full_access: "false" },
      pedidosExtras: { view: "true", create: "false", edit: "false", approve: "false", reject: "false", cancel: "false", pay: "true", delete: "false", full_access: "false" },
      navlinks: { nav_dashboard: "true", nav_clientes: "false", nav_obras: "true", nav_logistica: "false", nav_planeamento: "false", nav_cotacao: "false", nav_financeiro: "true", nav_centros_gerais: "true", nav_users: "false" },
    };
    return map[module]?.[action] ?? "false";
  }

  if (role === "tecnico") {
    const map = {
      dashboard: { view: "false", export: "false", full_access: "false" },
      analytics: { view: "false", export: "false" },
      clientes: { view: "view", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      interacoes: { view: "view", create: "false", edit: "false", delete: "false" },
      chat: { view: "true", send: "true", create_group: "false" },
      obras: {
        view: "true", read: "true", create: "false", edit: "true", delete: "false",
        approve: "false", export: "view", download_gallery: "true", manage: "true", financeiro: "false", full_access: "false",
      },
      logistica: { view: "view", export: "false", full_access: "false" },
      stock: {
        view: "true", create: "false", edit: "false", delete: "false", approve: "false",
        export: "false", manage: "false", full_access: "false",
      },
      materiais: { view: "true", create: "false", edit: "false", delete: "false", export: "false", manage: "false", full_access: "false" },
      ferramentas: { view: "true", create: "false", edit: "false", delete: "false", manage: "false", export: "false" },
      financeiro: { view: "false", edit: "false", export: "false", approve: "false", confirm_invoice: "false", certify_expense: "false", full_access: "false" },
      relatorios: { view: "view", export: "false", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "false", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
      fundoManeio: { view: "false", create: "false", edit: "false", manage: "false", full_access: "false" },
      pedidosExtras: { view: "true", create: "true", edit: "own", approve: "false", reject: "false", cancel: "false", pay: "false", delete: "false", full_access: "false" },
      navlinks: { nav_dashboard: "true", nav_clientes: "false", nav_obras: "true", nav_logistica: "false", nav_planeamento: "true", nav_cotacao: "false", nav_financeiro: "false", nav_centros_gerais: "true", nav_users: "false" },
    };
    return map[module]?.[action] ?? "false";
  }

  if (role === "leitura") {
    const readOnly = ["view", "read", "export"];
    if (module === "portal") return "false";
    if (module === "sistema" || module === "permissoes" || module === "configuracoes") return "false";
    if (module === "navlinks") {
      if (["nav_dashboard", "nav_obras"].includes(action)) return "true";
      return "false";
    }
    if (module === "chat") {
      if (action === "view") return "true";
      return "false";
    }
    if (action === "full_access" || action === "manage_permissions") return "false";
    if (readOnly.includes(action)) {
      if (module === "obras" && action === "financeiro") return "view";
      return "true";
    }
    if (action === "manage") return "false";
    return "false";
  }

  if (role === "cliente") {
    if (module === "chat") {
      if (action === "view" || action === "send") return "true";
      return "false";
    }
    if (module === "portal") {
      if (action === "download_gallery") return "false";
      if (["view", "export", "full_access"].includes(action)) return action === "full_access" ? "false" : "true";
    }
    if (module === "navlinks") return "false";
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

  for (const tab of PAGE_TABS) {
    for (const role of ROLES) {
      const key = `${role}|${tab.module}|${tab.action}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        role,
        module: tab.module,
        action: tab.action,
        allowed: defaultAllowedForTab(role, tab),
      });
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
    tabs: getTabsForGroup(group.id).map((t) => ({
      label: t.label,
      module: t.module,
      action: t.action,
      pageLabel: t.pageLabel,
      route: t.route,
    })),
    rows: group.actions.map((action) => ({
      label: ACTION_LABELS[action] || action,
      module: group.id,
      action,
      actionId: action,
      isTab: false,
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
  PAGE_TABS,
  TAB_PERMISSION_FALLBACKS,
  PAGE_ROUTE_GUARDS,
  defaultAllowedFor,
  defaultAllowedForTab,
  buildDefaultPermissions,
  buildDisplayCatalog,
  getTabsForGroup,
  permKey,
};
