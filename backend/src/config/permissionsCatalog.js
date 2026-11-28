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
  reply: "Responder",
  // Legado (rotas existentes)
  read: "Visualizar (leitura)",
  manage: "Gerir / operar",
  financeiro: "Módulo financeiro",
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
  // Comercial / Orçamentação
  tab_orcamentos: "Orçamentos (lista e documento)",
  tab_despacho: "Folha de despacho",
  tab_propostas: "Propostas ao cliente",
  tab_baremes: "Base: Baremes",
  tab_parametros: "Base: Parâmetros",
  tab_funcionarios: "Base: Funcionários",
  adjudicar: "Adjudicar (criar obra a partir do orçamento)",
  // Navlinks (Menus e Áreas de Navegação)
  nav_dashboard: "Menu: Dashboard",
  nav_registos: "Menu: Registos (Cadastros)",
  nav_clientes: "Menu: Clientes",
  nav_obras: "Menu: Obras",
  nav_logistica: "Menu: Compras e Stock / Logística",
  nav_planeamento: "Menu: Planeamento",
  nav_cotacao: "Menu: Pedidos de Cotação",
  nav_comercial: "Menu: Comercial / Orçamentação",
  nav_financeiro: "Menu: Financeiro",
  nav_centros_gerais: "Menu: Compras e Pedidos Extra",
  nav_frota: "Menu: Frota",
  nav_oficina: "Menu: Oficina (ordens de trabalho)",
  nav_users: "Menu: Administração / Gestão",
};

/**
 * Abas configuráveis por página — groupModule = módulo no mapa de permissões onde aparece.
 */
const PAGE_TABS = [
  { groupModule: "stock", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Armazéns", module: "stock", action: "tab_warehouses" },
  { groupModule: "obras", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Pedidos de Obra", module: "obras", action: "tab_stock_requests" },
  { groupModule: "stock", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Devoluções", module: "stock", action: "tab_returns" },
  { groupModule: "materiais", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Catálogo", module: "materiais", action: "tab_catalog" },
  { groupModule: "ferramentas", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Ferramentas", module: "ferramentas", action: "tab_tools" },
  { groupModule: "logistica", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Entregas", module: "logistica", action: "tab_deliveries" },
  { groupModule: "stock", pageLabel: "Logística & Stock", route: "/Stock/index.html", label: "Histórico", module: "stock", action: "tab_movements" },
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
      { id: "obras.requisicoes", label: "Requisições de material", route: "/requisicoes" },
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
      { id: "financeiro.overview", label: "Overview Financeiro", route: "/Financeiro/overview" },
      { id: "financeiro.faturacaoRegistar", label: "Registar Faturas", route: "/Financeiro/faturacao/registar" },
      { id: "financeiro.faturacaoPrevista", label: "Faturação Prevista", route: "/Financeiro/faturacao/prevista" },
      { id: "financeiro.faturacaoResumo", label: "Resumo Faturas vs Previsão", route: "/Financeiro/faturacao/resumo" },
      { id: "financeiro.custosRegistar", label: "Registar Custos", route: "/Financeiro/custos/registar" },
      { id: "financeiro.custosRealizados", label: "Custos Realizados", route: "/Financeiro/custos/realizados" },
      { id: "financeiro.custosOverview", label: "Overview Custos", route: "/Financeiro/custos/overview" },
      { id: "financeiro.contas", label: "Contas a Pagar / Receber", route: "/Financeiro/contas" },
      { id: "financeiro.tesourariaExtratos", label: "Extratos Bancários", route: "/Financeiro/tesouraria/extratos" },
      { id: "financeiro.tesourariaRecebimentos", label: "Recebimentos do Cliente", route: "/Financeiro/tesouraria/recebimentos" },
      { id: "financeiro.tesourariaTransferencias", label: "Transferências Internas", route: "/Financeiro/tesouraria/transferencias" },
      { id: "financeiro.tesourariaAtm", label: "Levantamentos ATM", route: "/Financeiro/tesouraria/atm" },
      { id: "financeiro.tesourariaPagamentos", label: "Pagamentos a Fornecedor", route: "/Financeiro/tesouraria/pagamentos" },
      { id: "financeiro.centroPagamentos", label: "Centro de Pagamentos", route: "/Financeiro/centro-pagamentos" },
      { id: "financeiro.controlo", label: "Controlo Financeiro", route: "/Financeiro/controlo" },
      { id: "financeiro.centrosGerais", label: "Compras e Pedidos e Pedidos Extra", route: "/Financeiro/centro-pagamentos" },
      { id: "financeiro.centrosCusto", label: "Registos: Centros de Custo", route: "/Financeiro/centros-custo" },
      { id: "financeiro.tipoCusto", label: "Registos: Tipo de Custo", route: "/registos/tipo-custo" },
      { id: "financeiro.categoriasCusto", label: "Registos: Categorias de Custo", route: "/registos/categorias-custo" },
      { id: "financeiro.subcategoriasCusto", label: "Registos: Subcategorias de Custo", route: "/registos/subcategorias-custo" },
      { id: "financeiro.movimentos", label: "Registos: Movimentos Financeiros", route: "/registos/movimentos" },
      { id: "financeiro.obras", label: "Financeiro por obra", route: "/Projectos/projectView.html" },
      { id: "financeiro.relatorios", label: "Resumos financeiros", route: "/Projectos/projectView.html" },
    ],
    actions: ["view", "edit", "export", "approve", "confirm_invoice", "certify_expense", "full_access"],
  },
  {
    id: "comercial",
    label: "Comercial / Orçamentação",
    icon: "request_quote",
    pages: [
      { id: "comercial.orcamentacao", label: "Orçamentação de Obras", route: "/orcamentacao/" },
      { id: "comercial.orcamentos", label: "Orçamentos (lista)", route: "/comercial/orcamentos" },
      { id: "comercial.orcamento", label: "Orçamento (documento)", route: "/comercial/orcamento" },
      { id: "comercial.despacho", label: "Folha de despacho", route: "/comercial/despacho" },
      { id: "comercial.propostas", label: "Propostas", route: "/comercial/propostas" },
      { id: "comercial.baremes", label: "Base: Baremes", route: "/comercial/base/baremes" },
      { id: "comercial.parametros", label: "Base: Parâmetros", route: "/comercial/base/parametros" },
      { id: "comercial.funcionarios", label: "Base: Funcionários", route: "/comercial/base/funcionarios" },
    ],
    actions: [
      "view",
      "create",
      "edit",
      "delete",
      "approve",
      "adjudicar",
      "export",
      "tab_orcamentos",
      "tab_despacho",
      "tab_propostas",
      "tab_baremes",
      "tab_parametros",
      "tab_funcionarios",
      "full_access",
    ],
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
    id: "ajuda",
    label: "Ajuda & Sugestões",
    icon: "help",
    pages: [
      { id: "ajuda.widget", label: "Botão de ajuda (global)", route: "*" },
      { id: "ajuda.inbox", label: "Inbox de ajuda", route: "/Users/index.html" },
    ],
    actions: ["create", "view", "reply", "full_access"],
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
    pages: [{ id: "fundoManeio.main", label: "Gestão de Cartões", route: "/Financeiro/centro-pagamentos" }],
    actions: ["view", "create", "edit", "manage", "full_access"],
  },
  {
    id: "pedidosExtras",
    label: "Pedidos Extras",
    icon: "request_quote",
    pages: [{ id: "pedidosExtras.main", label: "Compras e Pedidos e Pedidos Extra", route: "/Financeiro/centro-pagamentos" }],
    actions: ["view", "create", "edit", "approve", "pay", "delete", "reject", "cancel", "full_access"],
  },
  {
    id: "fornecedores",
    label: "Fornecedores",
    icon: "local_shipping",
    pages: [
      { id: "fornecedores.list", label: "Gestão de fornecedores", route: "/fornecedores" },
      { id: "fornecedores.main", label: "Fornecedores (Centro de Compras)", route: "/Financeiro/centro-pagamentos" },
    ],
    actions: ["view", "create", "edit", "delete", "manage", "full_access"],
  },
  {
    id: "cadastros",
    label: "Cadastros (Contactos, Setores, Pessoal)",
    icon: "contacts",
    pages: [
      { id: "cadastros.contactos", label: "Contactos", route: "/registos/contactos" },
      { id: "cadastros.setores", label: "Setores", route: "/registos/terceiros/setores" },
      { id: "cadastros.pessoal", label: "Pessoal", route: "/registos/pessoal" },
      { id: "cadastros.folhaPonto", label: "Folha de ponto", route: "/registos/folha-ponto" },
    ],
    actions: ["view", "create", "edit", "delete", "manage", "full_access"],
  },
  {
    id: "frota",
    label: "Frota",
    icon: "local_shipping",
    pages: [
      { id: "frota.painel", label: "Painel da Frota e Alertas", route: "/frota/painel" },
      { id: "frota.viaturas", label: "Viaturas e Equipamentos", route: "/frota/viaturas" },
      { id: "frota.motoristas", label: "Motoristas", route: "/frota/motoristas" },
      { id: "frota.operacao", label: "Abastecimentos, Manutenções, Planos e Ocorrências", route: "/frota/abastecimentos" },
      { id: "frota.controlo", label: "Documentos e Seguros", route: "/frota/documentos" },
      { id: "frota.custos", label: "Custos por Viatura", route: "/frota/custos" },
      { id: "frota.configuracoes", label: "Configurações da Frota", route: "/frota/configuracoes" },
    ],
    actions: ["view", "create", "edit", "delete", "export", "full_access"],
  },
  {
    id: "oficina",
    label: "Oficina",
    icon: "car_repair",
    pages: [
      { id: "oficina.calendario", label: "Calendário da Oficina", route: "/frota/oficina" },
      { id: "oficina.ordens", label: "Ordens de Trabalho", route: "/frota/ordens" },
      { id: "oficina.material", label: "Material da Oficina", route: "/frota/material" },
      { id: "oficina.indicadores", label: "Indicadores da Oficina", route: "/frota/indicadores" },
    ],
    actions: ["view", "create", "edit", "delete", "full_access"],
  },
  {
    id: "navlinks",
    label: "Menus & Áreas de Navegação",
    icon: "menu_open",
    pages: [
      { id: "navlinks.dashboard", label: "Menu: Dashboard", route: "/Dashboard/index.html" },
      { id: "navlinks.registos", label: "Menu: Registos", route: "/registos/contactos" },
      { id: "navlinks.clientes", label: "Menu: Clientes", route: "/Clientes/clienteLista.html" },
      { id: "navlinks.obras", label: "Menu: Obras", route: "/Projectos/ProjectGeral.html" },
      { id: "navlinks.logistica", label: "Menu: Compras e Stock / Logística", route: "/Stock/index.html" },
      { id: "navlinks.planeamento", label: "Menu: Planeamento", route: "/Projectos/ProjectGeral.html" },
      { id: "navlinks.cotacao", label: "Menu: Pedidos de Cotação", route: "/Projectos/Cotacao/index.html" },
      { id: "navlinks.comercial", label: "Menu: Comercial", route: "/comercial/orcamentos" },
      { id: "navlinks.financeiro", label: "Menu: Financeiro", route: "/Financeiro/overview" },
      { id: "navlinks.centros_gerais", label: "Menu: Compras e Pedidos Extra", route: "/Financeiro/centro-pagamentos" },
      { id: "navlinks.frota", label: "Menu: Frota", route: "/frota/painel" },
      { id: "navlinks.oficina", label: "Menu: Oficina", route: "/frota/oficina" },
      { id: "navlinks.users", label: "Menu: Gestão / Administração", route: "/Users/index.html" },
    ],
    actions: [
      "nav_dashboard",
      "nav_registos",
      "nav_clientes",
      "nav_obras",
      "nav_logistica",
      "nav_planeamento",
      "nav_cotacao",
      "nav_comercial",
      "nav_financeiro",
      "nav_centros_gerais",
      "nav_frota",
      "nav_oficina",
      "nav_users",
    ],
  },
];

/** Rotas → permissão mínima para aceder à página */
const PAGE_ROUTE_GUARDS = [
  { route: "/Dashboard/index.html", module: "dashboard", action: "view" },
  { route: "/Dashboard/clientDashboard.html", module: "portal", action: "view", roles: ["cliente"] },
  { route: "/Clientes/clienteLista.html", module: "clientes", action: "view" },
  { route: "/ClienteDetalhe/client.html", module: "clientes", action: "view" },
  { route: "/Projectos/ProjectGeral.html", module: "obras", action: "view" },
  { route: "/Projectos/projectView.html", module: "obras", action: "view" },
  { route: "/Projectos/tecnicoPlanos.html", module: "obras", action: "view", roles: ["tecnico", "admin", "supervisor", "operador"] },
  { route: "/Projectos/Cotacao/index.html", module: "obras", action: "view" },
  { route: "/Stock/index.html", module: "stock", action: "view" },
  { route: "/fornecedores", module: "fornecedores", action: "view" },
  { route: "/equipamentos", module: "ferramentas", action: "view" },
  { route: "/compras/mapas-comparativos", module: "stock", action: "view" },
  { route: "/compras/base-precos", module: "stock", action: "view" },
  { route: "/compras/compromissos", module: "stock", action: "view" },
  { route: "/compras/stock-armazem", module: "stock", action: "view" },
  { route: "/compras/movimentos-armazem", module: "stock", action: "view" },
  { route: "/compras/conta-corrente-fornecedores", module: "financeiro", action: "view" },
  { route: "/Financeiro/financeiro.html", module: "financeiro", action: "view" },
  { route: "/Financeiro/overview", module: "financeiro", action: "view" },
  { route: "/Financeiro/faturacao/registar", module: "financeiro", action: "view" },
  { route: "/Financeiro/faturacao/prevista", module: "financeiro", action: "view" },
  { route: "/Financeiro/faturacao/resumo", module: "financeiro", action: "view" },
  { route: "/Financeiro/custos/registar", module: "financeiro", action: "view" },
  { route: "/Financeiro/custos/realizados", module: "financeiro", action: "view" },
  { route: "/Financeiro/custos/overview", module: "financeiro", action: "view" },
  { route: "/Financeiro/contas", module: "financeiro", action: "view" },
  { route: "/Financeiro/tesouraria/extratos", module: "financeiro", action: "view" },
  { route: "/Financeiro/tesouraria/recebimentos", module: "financeiro", action: "view" },
  { route: "/Financeiro/tesouraria/transferencias", module: "financeiro", action: "view" },
  { route: "/Financeiro/tesouraria/atm", module: "financeiro", action: "view" },
  { route: "/Financeiro/tesouraria/pagamentos", module: "financeiro", action: "view" },
  { route: "/Financeiro/centro-pagamentos", module: "financeiro", action: "view" },
  { route: "/Financeiro/controlo", module: "financeiro", action: "view" },
  { route: "/Financeiro/centroDeCompras.html", module: "pedidosExtras", action: "view" },
  { route: "/requisicoes", module: "obras", action: "view" },
  { route: "/orcamentacao", module: "comercial", action: "view" },
  { route: "/orcamentacao/orcamento", module: "comercial", action: "view" },
  { route: "/comercial/orcamentos", module: "comercial", action: "tab_orcamentos" },
  { route: "/comercial/orcamento", module: "comercial", action: "tab_orcamentos" },
  { route: "/comercial/necessidades", module: "comercial", action: "tab_orcamentos" },
  { route: "/comercial/despacho", module: "comercial", action: "tab_despacho" },
  { route: "/comercial/propostas", module: "comercial", action: "tab_propostas" },
  { route: "/comercial/base/baremes", module: "comercial", action: "tab_baremes" },
  { route: "/comercial/base/parametros", module: "comercial", action: "tab_parametros" },
  { route: "/comercial/base/funcionarios", module: "comercial", action: "tab_funcionarios" },
  { route: "/frota/painel", module: "frota", action: "view" },
  { route: "/frota/alertas", module: "frota", action: "view" },
  { route: "/frota/viaturas", module: "frota", action: "view" },
  { route: "/frota/motoristas", module: "frota", action: "view" },
  { route: "/frota/abastecimentos", module: "frota", action: "view" },
  { route: "/frota/manutencoes", module: "frota", action: "view" },
  { route: "/frota/planos", module: "frota", action: "view" },
  { route: "/frota/ocorrencias", module: "frota", action: "view" },
  { route: "/frota/documentos", module: "frota", action: "view" },
  { route: "/frota/seguros", module: "frota", action: "view" },
  { route: "/frota/custos", module: "frota", action: "view" },
  { route: "/frota/configuracoes", module: "frota", action: "view" },
  { route: "/frota/oficina", module: "oficina", action: "view" },
  { route: "/frota/ordens", module: "oficina", action: "view" },
  { route: "/frota/material", module: "oficina", action: "view" },
  { route: "/frota/indicadores", module: "oficina", action: "view" },
  { route: "/Users/index.html", module: "sistema", action: "view" },
  { route: "/registos/contactos", module: "cadastros", action: "view" },
  { route: "/registos/obras", module: "obras", action: "create" },
  { route: "/registos/terceiros/setores", module: "cadastros", action: "view" },
  { route: "/registos/produtos", module: "materiais", action: "view" },
  { route: "/registos/equipamentos", module: "ferramentas", action: "view" },
  { route: "/registos/armazens", module: "stock", action: "tab_warehouses" },
  { route: "/registos/pessoal", module: "cadastros", action: "view" },
  { route: "/registos/folha-ponto", module: "cadastros", action: "view" },
  { route: "/registos/tipo-custo", module: "financeiro", action: "view" },
  { route: "/registos/categorias-custo", module: "financeiro", action: "view" },
  { route: "/registos/subcategorias-custo", module: "financeiro", action: "view" },
  { route: "/registos/movimentos", module: "financeiro", action: "view" },
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

  if (module === "ajuda") {
    if (role === "cliente") return "false";
    if (action === "create") return "true";
    return "false";
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
      comercial: {
        view: "true", create: "false", edit: "false", delete: "true",
        approve: "true", adjudicar: "false", export: "true",
        tab_orcamentos: "true", tab_despacho: "true", tab_propostas: "view",
        tab_baremes: "view", tab_parametros: "view", tab_funcionarios: "view",
        full_access: "false",
      },
      relatorios: { view: "true", export: "true", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "view", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
      fundoManeio: { view: "true", create: "true", edit: "true", manage: "true", full_access: "false" },
      pedidosExtras: { view: "true", create: "true", edit: "own", approve: "true", reject: "true", cancel: "true", pay: "false", delete: "true", full_access: "false" },
      fornecedores: { view: "true", create: "true", edit: "true", delete: "false", manage: "true", full_access: "false" },
      cadastros: { view: "true", create: "true", edit: "true", delete: "true", manage: "true", full_access: "false" },
      oficina: { view: "true", create: "true", edit: "true", delete: "false", full_access: "false" },
      frota: { view: "true", create: "true", edit: "true", delete: "false", export: "true", full_access: "false" },
      navlinks: { nav_dashboard: "true", nav_registos: "true", nav_clientes: "true", nav_obras: "true", nav_logistica: "true", nav_planeamento: "true", nav_cotacao: "true", nav_comercial: "true", nav_financeiro: "true", nav_centros_gerais: "true", nav_frota: "true", nav_oficina: "true", nav_users: "false" },
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
      comercial: {
        view: "true", create: "true", edit: "true", delete: "true",
        approve: "false", adjudicar: "false", export: "true",
        tab_orcamentos: "true", tab_despacho: "true", tab_propostas: "true",
        tab_baremes: "true", tab_parametros: "true", tab_funcionarios: "true",
        full_access: "false",
      },
      relatorios: { view: "true", export: "true", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "false", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
      fundoManeio: { view: "true", create: "true", edit: "true", manage: "true", full_access: "false" },
      pedidosExtras: { view: "true", create: "true", edit: "own", approve: "false", reject: "false", cancel: "true", pay: "true", delete: "false", full_access: "false" },
      fornecedores: { view: "true", create: "true", edit: "true", delete: "false", manage: "false", full_access: "false" },
      cadastros: { view: "true", create: "true", edit: "true", delete: "false", manage: "false", full_access: "false" },
      oficina: { view: "true", create: "true", edit: "true", delete: "false", full_access: "false" },
      frota: { view: "true", create: "true", edit: "true", delete: "false", export: "true", full_access: "false" },
      navlinks: { nav_dashboard: "true", nav_registos: "true", nav_clientes: "true", nav_obras: "true", nav_logistica: "true", nav_planeamento: "true", nav_cotacao: "false", nav_comercial: "true", nav_financeiro: "true", nav_centros_gerais: "true", nav_frota: "true", nav_oficina: "true", nav_users: "false" },
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
      comercial: {
        view: "view", create: "false", edit: "false", delete: "false",
        approve: "false", adjudicar: "false", export: "true",
        tab_orcamentos: "view", tab_despacho: "view", tab_propostas: "false",
        tab_baremes: "view", tab_parametros: "false", tab_funcionarios: "false",
        full_access: "false",
      },
      relatorios: { view: "true", export: "true", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "false", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
      fundoManeio: { view: "view", create: "false", edit: "false", manage: "false", full_access: "false" },
      pedidosExtras: { view: "true", create: "false", edit: "false", approve: "false", reject: "false", cancel: "false", pay: "true", delete: "false", full_access: "false" },
      fornecedores: { view: "true", create: "true", edit: "true", delete: "false", manage: "false", full_access: "false" },
      cadastros: { view: "view", create: "false", edit: "false", delete: "false", manage: "false", full_access: "false" },
      oficina: { view: "view", create: "false", edit: "false", delete: "false", full_access: "false" },
      frota: { view: "view", create: "false", edit: "false", delete: "false", export: "true", full_access: "false" },
      navlinks: { nav_dashboard: "true", nav_registos: "true", nav_clientes: "false", nav_obras: "true", nav_logistica: "false", nav_planeamento: "false", nav_cotacao: "false", nav_comercial: "true", nav_financeiro: "true", nav_centros_gerais: "true", nav_frota: "true", nav_oficina: "false", nav_users: "false" },
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
      comercial: {
        view: "false", create: "false", edit: "false", delete: "false",
        approve: "false", adjudicar: "false", export: "false",
        tab_orcamentos: "false", tab_despacho: "false", tab_propostas: "false",
        tab_baremes: "false", tab_parametros: "false", tab_funcionarios: "false",
        full_access: "false",
      },
      relatorios: { view: "view", export: "false", full_access: "false" },
      sistema: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      permissoes: { view: "false", edit: "false", manage_permissions: "false", full_access: "false" },
      configuracoes: { view: "false", edit: "false", full_access: "false" },
      portal: { view: "false", export: "false", full_access: "false" },
      fundoManeio: { view: "false", create: "false", edit: "false", manage: "false", full_access: "false" },
      pedidosExtras: { view: "true", create: "true", edit: "own", approve: "false", reject: "false", cancel: "false", pay: "false", delete: "false", full_access: "false" },
      fornecedores: { view: "view", create: "false", edit: "false", delete: "false", manage: "false", full_access: "false" },
      cadastros: { view: "view", create: "false", edit: "false", delete: "false", manage: "false", full_access: "false" },
      oficina: { view: "false", create: "false", edit: "false", delete: "false", full_access: "false" },
      frota: { view: "false", create: "false", edit: "false", delete: "false", export: "false", full_access: "false" },
      navlinks: { nav_dashboard: "true", nav_registos: "true", nav_clientes: "false", nav_obras: "true", nav_logistica: "false", nav_planeamento: "true", nav_cotacao: "false", nav_comercial: "false", nav_financeiro: "false", nav_centros_gerais: "true", nav_frota: "false", nav_oficina: "false", nav_users: "false" },
    };
    return map[module]?.[action] ?? "false";
  }

  if (role === "leitura") {
    const readOnly = ["view", "read", "export"];
    if (module === "portal") return "false";
    if (module === "sistema" || module === "permissoes" || module === "configuracoes") return "false";
    if (module === "navlinks") {
      if (["nav_dashboard", "nav_registos", "nav_obras", "nav_comercial"].includes(action)) return "true";
      return "false";
    }
    if (module === "chat") {
      if (action === "view") return "true";
      return "false";
    }
    if (module === "comercial") {
      // Consulta do orçamento e dos baremes; nada de propostas, parâmetros ou pessoal.
      if (["view", "export", "tab_orcamentos", "tab_baremes"].includes(action)) return "view";
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
