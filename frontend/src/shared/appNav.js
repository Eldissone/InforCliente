import { getSessionUser } from "../services/auth.js";
import { canAccessMenuEntry, canPermSpec, getCachedPermissionMap } from "./permissions.js";

const LOGISTICS_SELECTOR = "[data-nav-logistics], [data-nav-logistica]";

export const FOOTER_GESTAO_ENTRY = {
  type: "link",
  label: "Gestão",
  icon: "settings",
  selector: "[data-nav-users]",
  href: "/Users",
  navPerm: "navlinks:nav_users",
  perm: "sistema:view|permissoes:view|permissoes:manage_permissions|configuracoes:view",
};

/** Ordem do menu principal. Cada grupo e item declara `navPerm` e/ou `perm` para montagem dinâmica conforme perfil/utilizador. */
export const APP_MENU = [
  {
    type: "link",
    label: "Dashboard",
    icon: "home",
    selector: "[data-nav-dashboard]",
    href: "/Dashboard",
    navPerm: "navlinks:nav_dashboard",
    perm: "dashboard:view",
  },
  {
    type: "group",
    label: "Registos",
    icon: "folder_open",
    navPerm: "navlinks:nav_registos",
    autoBadge: true,
    children: [
      { label: "Contactos", icon: "contacts", href: "/registos/contactos", perm: "cadastros:view" },
      { label: "Obras", icon: "apartment", href: "/registos/obras", perm: "obras:create" },
      {
        label: "Terceiros",
        icon: "groups",
        autoBadge: true,
        children: [
          { label: "Novo Terceiro", icon: "person_add", href: "/registos/terceiros", perm: "fornecedores:view" },
          { label: "Setores", icon: "account_tree", href: "/registos/terceiros/setores", perm: "cadastros:view" },
          {
            label: "Clientes",
            icon: "business",
            selector: "[data-nav-clientes]",
            href: "/Clientes/clienteLista",
            navPerm: "navlinks:nav_clientes",
            perm: "clientes:view",
          },
        ],
      },
      { label: "Produtos e Serviços", icon: "inventory_2", href: "/produtos", perm: "materiais:view" },
      { label: "Categorias de Produtos e Serviços", icon: "category", href: "/registos/categorias-produtos", perm: "materiais:view" },
      { label: "Equipamentos, Maquinarias e Viaturas", icon: "agriculture", href: "/registos/equipamentos", perm: "ferramentas:view" },
      { label: "Pessoal", icon: "badge", href: "/registos/pessoal", perm: "cadastros:view" },
      { label: "Folha de Ponto", icon: "schedule", href: "/registos/folha-ponto", perm: "cadastros:view" },
    ],
  },
  {
    type: "group",
    label: "Comercial",
    icon: "request_quote",
    navPerm: "navlinks:nav_comercial",
    children: [
      {
        label: "Orçamentos",
        icon: "calculate",
        selector: "[data-nav-comercial]",
        href: "/comercial/orcamentos",
        perm: "comercial:tab_orcamentos",
      },
      { label: "Folha de Despacho", icon: "fact_check", href: "/comercial/despacho", perm: "comercial:tab_despacho" },
      { label: "Propostas", icon: "forward_to_inbox", href: "/comercial/propostas", perm: "comercial:tab_propostas" },
      { label: "Necessidades em orçamento", icon: "shopping_basket", href: "/comercial/necessidades", perm: "comercial:tab_orcamentos" },
      {
        label: "Base",
        icon: "dataset",
        children: [
          { label: "Baremes", icon: "price_change", href: "/comercial/base/baremes", perm: "comercial:tab_baremes" },
          { label: "Parâmetros", icon: "tune", href: "/comercial/base/parametros", perm: "comercial:tab_parametros" },
          { label: "Funcionários", icon: "engineering", href: "/comercial/base/funcionarios", perm: "comercial:tab_funcionarios" },
        ],
      },
    ],
  },
  {
    type: "group",
    label: "Obras",
    icon: "construction",
    navPerm: "navlinks:nav_obras",
    children: [
      { label: "Listagem", icon: "list", selector: "[data-nav-obras]", href: "/Projectos/ProjectGeral", perm: "obras:view" },
    ],
  },
  {
    type: "group",
    label: "Compras e Stock",
    icon: "local_shipping",
    navPerm: "navlinks:nav_logistica|navlinks:nav_cotacao|navlinks:nav_centros_gerais",
    children: [
      {
        label: "Compras",
        icon: "shopping_cart",
        children: [
          {
            label: "Pedidos de Cotação",
            icon: "request_quote",
            selector: "[data-nav-cotacao]",
            href: "/Projectos/Cotacao",
            navPerm: "navlinks:nav_cotacao",
            perm: "obras:view|stock:view|logistica:view",
          },
          {
            label: "Mapas Comparativos",
            icon: "compare",
            href: "/compras/mapas-comparativos",
            navPerm: "navlinks:nav_logistica|navlinks:nav_cotacao",
            perm: "stock:view|logistica:view|financeiro:view",
          },
          {
            label: "Base de Preços",
            icon: "sell",
            href: "/compras/base-precos",
            navPerm: "navlinks:nav_logistica|navlinks:nav_cotacao",
            perm: "stock:view|logistica:view|financeiro:view",
          },
          {
            label: "Fornecedores",
            icon: "local_shipping",
            href: "/fornecedores",
            navPerm: "navlinks:nav_logistica|navlinks:nav_cotacao|navlinks:nav_financeiro",
            perm: "fornecedores:view|stock:view|financeiro:view",
          },
        ],
      },
      {
        label: "Encomendas",
        icon: "assignment",
        navPerm: "navlinks:nav_logistica|navlinks:nav_cotacao",
        children: [
          {
            label: "Compromissos Pendentes",
            icon: "pending_actions",
            href: "/compras/compromissos",
            perm: "stock:view|logistica:view|financeiro:view",
          },
        ],
      },
      {
        label: "Stock",
        icon: "warehouse",
        navPerm: "navlinks:nav_logistica",
        children: [
          { label: "Requisições Internas", icon: "assignment_add", href: "/requisicoes", perm: "obras:view|stock:view" },
          { label: "Entregas por Confirmar", icon: "fact_check", href: "/Stock?tab=deliveries", perm: "logistica:tab_deliveries|logistica:view" },
          { label: "Stock por Armazém", icon: "inventory", href: "/compras/stock-armazem", perm: "stock:view" },
          { label: "Movimentos de Armazém", icon: "history", href: "/compras/movimentos-armazem", perm: "stock:view" },
          { label: "Ferramentas e Equipamentos", icon: "handyman", href: "/equipamentos", perm: "ferramentas:view|ferramentas:tab_tools" },
          { label: "Armazéns", icon: "warehouse", href: "/registos/armazens", perm: "stock:tab_warehouses|stock:view" },
          {
            label: "Pedidos de Logística",
            icon: "inventory_2",
            selector: LOGISTICS_SELECTOR,
            href: "/Stock",
            perm: "stock:view|logistica:view|obras:tab_stock_requests",
          },
        ],
      },
    ],
  },
  {
    type: "group",
    label: "Financeiro",
    icon: "account_balance",
    navPerm: "navlinks:nav_financeiro|navlinks:nav_centros_gerais",
    children: [
      {
        label: "Painel",
        icon: "insights",
        navPerm: "navlinks:nav_financeiro",
        children: [
          { label: "Painel Financeiro", icon: "insights", href: "/Financeiro/overview", perm: "financeiro:view" },
          { label: "Calendário Financeiro", icon: "calendar_month", href: "/Financeiro/calendario?ver=tudo", perm: "financeiro:view" },
          { label: "Mapa de Fluxos", icon: "table_chart", href: "/Financeiro/mapa-fluxos", perm: "financeiro:view" },
          { label: "Previsto × Realizado", icon: "query_stats", href: "/Financeiro/controlo", perm: "financeiro:view" },
        ],
      },
      {
        label: "Contas a Pagar",
        icon: "north_east",
        children: [
          {
            label: "Centro de Pagamentos",
            icon: "account_balance",
            href: "/Financeiro/centro-pagamentos",
            navPerm: "navlinks:nav_financeiro|navlinks:nav_centros_gerais",
            perm: "financeiro:view|pedidosExtras:view",
          },
          { label: "Calendário de Pagamentos", icon: "event", href: "/Financeiro/calendario?ver=pagar", navPerm: "navlinks:nav_financeiro", perm: "financeiro:view" },
          { label: "Despesas sem Comprovativo", icon: "receipt", href: "/Financeiro/despesas-sem-comprovativo", navPerm: "navlinks:nav_financeiro", perm: "financeiro:view" },
          { label: "Mapa de Obrigações", icon: "table_chart", href: "/Financeiro/mapa-obrigacoes", navPerm: "navlinks:nav_financeiro", perm: "financeiro:view" },
          {
            label: "Conta Corrente de Fornecedores",
            icon: "account_box",
            href: "/compras/conta-corrente-fornecedores",
            navPerm: "navlinks:nav_financeiro|navlinks:nav_logistica",
            perm: "financeiro:view|fornecedores:view|stock:view",
          },
          { label: "Pagamentos a Fornecedor", icon: "north_east", href: "/Financeiro/tesouraria/pagamentos", navPerm: "navlinks:nav_financeiro", perm: "financeiro:view" },
        ],
      },
      {
        label: "Contas a Receber",
        icon: "south_west",
        navPerm: "navlinks:nav_financeiro",
        children: [
          { label: "Centro de Recebimentos", icon: "post_add", href: "/Financeiro/faturacao/registar", perm: "financeiro:view" },
          { label: "Calendário de Recebimentos", icon: "event_available", href: "/Financeiro/calendario?ver=receber", perm: "financeiro:view" },
          { label: "Autos de Medição", icon: "straighten", href: "/Financeiro/autos-medicao", perm: "financeiro:view" },
          { label: "Conta Corrente de Clientes", icon: "account_box", href: "/Financeiro/conta-corrente", perm: "financeiro:view" },
        ],
      },
      {
        label: "Impostos",
        icon: "gavel",
        navPerm: "navlinks:nav_financeiro",
        children: [
          { label: "Impostos", icon: "receipt_long", href: "/Financeiro/impostos", perm: "financeiro:view" },
          { label: "Planos de Pagamento (PPP)", icon: "event_repeat", href: "/Financeiro/impostos-planos", perm: "financeiro:view" },
          { label: "IVA e Retenções", icon: "percent", href: "/Financeiro/impostos-iva", perm: "financeiro:view" },
          { label: "Mapa Fiscal", icon: "calendar_view_month", href: "/Financeiro/mapa-fiscal", perm: "financeiro:view" },
        ],
      },
      {
        label: "Financiamentos",
        icon: "account_balance",
        navPerm: "navlinks:nav_financeiro",
        children: [
          { label: "Financiamentos Bancários", icon: "account_balance", href: "/Financeiro/financiamentos", perm: "financeiro:view" },
          { label: "Empréstimos Obtidos e Concedidos", icon: "swap_horiz", href: "/Financeiro/emprestimos", perm: "financeiro:view" },
          { label: "Garantias e Livranças", icon: "verified_user", href: "/Financeiro/garantias", perm: "financeiro:view" },
          { label: "Distribuição aos Sócios", icon: "groups", href: "/Financeiro/socios", perm: "financeiro:view" },
        ],
      },
      {
        label: "Tesouraria",
        icon: "account_balance_wallet",
        navPerm: "navlinks:nav_financeiro",
        children: [
          { label: "Contas e Saldos", icon: "account_balance", href: "/Financeiro/contas-saldos", perm: "financeiro:view" },
          { label: "Conciliação Bancária", icon: "rule", href: "/Financeiro/conciliacao", perm: "financeiro:view" },
          { label: "Extratos Bancários", icon: "receipt_long", href: "/Financeiro/tesouraria/extratos", perm: "financeiro:view" },
          { label: "Previsão de Tesouraria", icon: "waterfall_chart", href: "/Financeiro/previsao-tesouraria", perm: "financeiro:view" },
          { label: "Mapa de Fluxo de Caixa", icon: "stacked_line_chart", href: "/Financeiro/fluxo-caixa", perm: "financeiro:view" },
          { label: "Contas e Cartões", icon: "credit_card", href: "/Financeiro/contas-cartoes", perm: "financeiro:view|fundoManeio:view" },
          { label: "Alocação de Cartões", icon: "badge", href: "/Financeiro/alocacao-cartoes", perm: "financeiro:view|fundoManeio:view" },
          { label: "Fundo de Maneio", icon: "savings", href: "/Financeiro/fundo-maneio", perm: "financeiro:view|fundoManeio:view" },
        ],
      },
      {
        label: "Análise de Custos",
        icon: "payments",
        navPerm: "navlinks:nav_financeiro",
        children: [
          { label: "Custos da Empresa", icon: "task_alt", href: "/Financeiro/custos/realizados", perm: "financeiro:view" },
        ],
      },
      {
        label: "Controlo de Obras",
        icon: "engineering",
        navPerm: "navlinks:nav_financeiro",
        children: [
          { label: "Resumo das Obras", icon: "dashboard", href: "/Financeiro/obras-resumo", perm: "financeiro:view" },
          { label: "Custos por Obra", icon: "price_check", href: "/Financeiro/obras-custos", perm: "financeiro:view" },
          { label: "Tesouraria da Obra", icon: "savings", href: "/Financeiro/obra-tesouraria", perm: "financeiro:view" },
          { label: "Previsões por Obra", icon: "trending_up", href: "/Financeiro/obra-previsoes", perm: "financeiro:view" },
          { label: "Áreas de Negócio", icon: "donut_small", href: "/Financeiro/areas-negocio", perm: "financeiro:view" },
        ],
      },
      {
        label: "Registos",
        icon: "folder_open",
        navPerm: "navlinks:nav_financeiro|navlinks:nav_centros_gerais",
        autoBadge: true,
        children: [
          { label: "Centros de Custo", icon: "account_tree", href: "/Financeiro/centros-custo", navPerm: "navlinks:nav_financeiro", perm: "financeiro:view" },
          { label: "Bancos", icon: "account_balance", href: "/Financeiro/bancos", navPerm: "navlinks:nav_financeiro", perm: "financeiro:view" },
          { label: "Tipo de Custo (Produto ou Serviço)", icon: "category", href: "/registos/tipo-custo", perm: "financeiro:view|pedidosExtras:view" },
          { label: "Categorias de Custo", icon: "account_tree", href: "/registos/categorias-custo", perm: "financeiro:view|pedidosExtras:view" },
          { label: "Subcategorias de Custo", icon: "subdirectory_arrow_right", href: "/registos/subcategorias-custo", perm: "financeiro:view|pedidosExtras:view" },
          { label: "Movimentos Financeiros", icon: "payments", href: "/registos/movimentos", perm: "financeiro:view|fundoManeio:view" },
        ],
      },
    ],
  },
];

/**
 * Conta o total de links folha numa árvore de entradas já filtrada.
 */
function countLeafLinks(entries) {
  let total = 0;
  for (const entry of entries || []) {
    if (Array.isArray(entry.children)) {
      total += countLeafLinks(entry.children);
    } else {
      total += 1;
    }
  }
  return total;
}

/**
 * Filtra recursivamente a árvore `APP_MENU` com base no mapa de permissões do utilizador.
 * Remove links não autorizados, omite grupos/subgrupos sem filhos visíveis e calcula
 * dinamicamente os badges de contagem.
 */
export function filterMenuEntriesByPermissions(entries = APP_MENU, map = getCachedPermissionMap()) {
  const user = getSessionUser();
  const role = (user?.role || "").toLowerCase();
  if (!role || role === "cliente") return [];

  // Se não for admin e ainda não houver mapa carregado, não monta links não confirmados
  const hasMap = role === "admin" || (map && Object.keys(map).length > 0);
  if (!hasMap) return [];

  const out = [];
  for (const entry of entries || []) {
    if (!canAccessMenuEntry(entry, map)) continue;

    if (Array.isArray(entry.children)) {
      const children = filterMenuEntriesByPermissions(entry.children, map);
      if (!children.length) continue;
      const leafCount = countLeafLinks(children);
      const badge = entry.autoBadge || entry.badge ? String(leafCount) : "";
      out.push({ ...entry, children, badge });
    } else {
      out.push({ ...entry });
    }
  }
  return out;
}

function getUserInitials(user) {
  if (user?.name) {
    const parts = user.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts[0]?.length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return parts[0]?.toUpperCase() || "IG";
  }
  if (user?.email) {
    return user.email.slice(0, 2).toUpperCase();
  }
  return "MC";
}

function getTopNav() {
  return document.querySelector("body > nav.app-top-nav, body > nav.fixed, body > nav[class*='fixed']");
}

function getDesktopNavLinksContainer() {
  const nav = getTopNav();
  if (!nav) return null;
  return [...nav.querySelectorAll(".hidden.lg\\:flex.items-center")].find((el) =>
    el.querySelector("[data-nav-dashboard], [data-nav-clientes], [data-nav-obras]")
  );
}

function getLink(source, definition) {
  return source?.querySelector(definition.selector) || document.querySelector(definition.selector);
}

function createMenuLink(definition, source, variant) {
  const origin = definition.selector ? getLink(source, definition) : null;
  const link = origin ? origin.cloneNode(false) : document.createElement("a");
  link.removeAttribute("id");
  if (!origin) link.href = definition.href || "#";
  else if (definition.href) link.href = definition.href;
  if (definition.selector) {
    const attr = definition.selector.match(/data-nav-[\w-]+/)?.[0];
    if (attr) link.setAttribute(attr, "");
  }
  if (variant === "sidebar") {
    link.className = "app-sidebar-link";
    link.title = definition.label;
  } else if (!origin) {
    link.className = "flex items-center gap-3 text-sm font-semibold text-slate-400 py-3 px-4 rounded-xl hover:bg-slate-800 transition-all";
  } else {
    link.className = "flex items-center gap-3 text-sm font-semibold text-slate-400 py-3 px-4 rounded-xl hover:bg-slate-800 transition-all";
  }
  const combinedPerm = [definition.navPerm, definition.perm].filter(Boolean).join("&");
  if (combinedPerm) link.setAttribute("data-nav-perm", combinedPerm);
  if (definition.pending) {
    link.classList.add("is-pending");
    link.href = "#";
    link.title = "Módulo em preparação";
    link.addEventListener("click", (event) => event.preventDefault());
  }

  const badgeHtml = definition.badge ? `<span class="app-sidebar-badge">${definition.badge}</span>` : "";

  if (variant === "sidebar") {
    link.innerHTML = `
      <span class="app-sidebar-icon-wrap" aria-hidden="true">
        <span class="material-symbols-outlined">${definition.icon || "article"}</span>
      </span>
      <span class="app-sidebar-label">${definition.label}</span>
      ${badgeHtml}
    `;
  } else {
    link.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${definition.icon || "article"}</span><span>${definition.label}</span>`;
  }
  return link;
}

function buildMenuNodes(entries, source, variant, nested) {
  return (entries || []).map((entry) => {
    if (entry.children) {
      const nodes = buildMenuNodes(entry.children, source, variant, true);
      if (variant === "mobile") return createMobileGroup(entry.label, nodes);
      if (nested) return createSubgroup(entry.label, entry.icon || "folder", nodes, { badge: entry.badge });
      return createGroup(entry.label, entry.icon || "folder", nodes, { badge: entry.badge });
    }
    return createMenuLink(entry, source, variant);
  });
}

function currentPathMatches(href) {
  if (!href || href === "#") return false;
  try {
    const current = window.location.pathname.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const target = new URL(href, window.location.href).pathname.replace(/\/+$/, "").toLowerCase();
    return current === target || current.endsWith(target);
  } catch {
    return false;
  }
}

function isBrandLink(nav, link) {
  const cluster = nav.querySelector(":scope > div > div");
  return Boolean(cluster && link.parentElement === cluster);
}

function pathsLooselyMatch(currentPath, targetPath) {
  const strip = (path) => path.replace(/\.html$/, "").replace(/\/index$/, "");
  return strip(currentPath) === strip(targetPath);
}

function locationMatchesHref(href) {
  if (!href || href === "#") return false;
  let target;
  try {
    target = new URL(href, window.location.href);
  } catch {
    return false;
  }
  const currentPath = window.location.pathname.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const targetPath = target.pathname.replace(/\/+$/, "").toLowerCase();
  if (!pathsLooselyMatch(currentPath, targetPath)) return false;

  const currentParams = new URLSearchParams(window.location.search);
  const keys = [...target.searchParams.keys()];
  if (keys.length) return keys.every((key) => currentParams.get(key) === target.searchParams.get(key));
  if (currentParams.get("tab") && targetPath.includes("/stock")) return false;
  return true;
}

function isTopNavLinkActive(link) {
  return isSidebarLinkActive(link);
}

/** Marca o separador da página atual. O aspecto fica em assets/styles/top-nav.css (.is-active). */
export function markTopNavActive(nav = getTopNav()) {
  if (!nav) return;
  nav.querySelectorAll("a[href]").forEach((link) => {
    if (isBrandLink(nav, link)) return;
    link.classList.toggle("is-active", isTopNavLinkActive(link));
  });
}

function isSidebarLinkActive(link) {
  if (locationMatchesHref(link.getAttribute("href"))) return true;

  const current = window.location.pathname.replace(/\\/g, "/").toLowerCase();
  if (link.matches("[data-nav-obras]")) {
    return current.includes("/projectos/")
      && !current.includes("/projectos/centrocustos")
      && !current.includes("/projectos/cotacao")
      && !current.includes("/projectos/tecnicoplanos");
  }
  if (link.matches("[data-nav-clientes]")) return current.includes("/clientes/") || current.includes("/clientedetalhe/");
  if (link.matches("[data-nav-cotacao]")) return current.includes("/cotacao");
  if (link.matches("[data-nav-comercial]")) return current.includes("/comercial/orcamento");
  if (link.matches("[data-nav-users]")) return current.includes("/users/");
  if (link.matches("[data-nav-dashboard]")) return /\/dashboard(\/index)?\/?$/.test(current);
  return false;
}

const SIDEBAR_SCROLL_KEY = "app_sidebar_scroll_top";

function ensureActiveLinkVisible(sidebar = document.getElementById("appPrimarySidebar"), { preferSaved = false } = {}) {
  if (!sidebar) return;
  const scrollArea = sidebar.querySelector(".app-sidebar-scroll");
  if (!scrollArea) return;
  const active = scrollArea.querySelector(".app-sidebar-link.is-active");

  if (preferSaved) {
    try {
      const saved = sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
      if (saved !== null) {
        sessionStorage.removeItem(SIDEBAR_SCROLL_KEY);
        scrollArea.scrollTop = Number(saved) || 0;
      }
    } catch {}
  }

  if (!active || active.offsetParent === null) return;
  const areaRect = scrollArea.getBoundingClientRect();
  const linkRect = active.getBoundingClientRect();
  if (areaRect.height <= 0) return;

  const topPad = 12;
  const bottomPad = 16;
  if (linkRect.top < areaRect.top + topPad) {
    scrollArea.scrollTop += linkRect.top - (areaRect.top + topPad);
  } else if (linkRect.bottom > areaRect.bottom - bottomPad) {
    scrollArea.scrollTop += linkRect.bottom - (areaRect.bottom - bottomPad);
  }
}

function setActiveState(sidebar = document.getElementById("appPrimarySidebar"), opts = {}) {
  const links = [
    ...(sidebar ? sidebar.querySelectorAll(".app-sidebar-link") : []),
    ...document.querySelectorAll("#navMenu a"),
  ];
  links.forEach((link) => {
    link.classList.toggle("is-active", isSidebarLinkActive(link));
  });
  document.querySelectorAll(".app-sidebar-group, .app-sidebar-subgroup, .app-nav-mobile-group").forEach((group) => {
    const active = Boolean(group.querySelector("a.is-active"));
    group.classList.toggle("has-active-link", active);
    if (active) group.open = true;
  });
  ensureActiveLinkVisible(sidebar, opts);
}

function syncGroupVisibility(sidebar = document.getElementById("appPrimarySidebar")) {
  const roots = [sidebar, document.getElementById("navMenu")].filter(Boolean);
  roots.forEach((root) => {
    root.querySelectorAll(".app-sidebar-group, .app-sidebar-subgroup, .app-sidebar-section, .app-nav-mobile-group").forEach((section) => {
      const links = [...section.querySelectorAll("a")];
      const visibleLinks = links.filter((link) => !link.classList.contains("hidden"));
      if (links.length) section.classList.toggle("hidden", visibleLinks.length === 0);
      const badgeEl = section.querySelector(":scope > summary .app-sidebar-badge");
      if (badgeEl) {
        badgeEl.textContent = String(visibleLinks.length);
      }
    });
  });
}

function createGroup(label, icon, links, { open = false, badge = "" } = {}) {
  const group = document.createElement("details");
  group.className = "app-sidebar-group";
  group.open = open;
  const summary = document.createElement("summary");
  summary.title = label;
  const badgeHtml = badge ? `<span class="app-sidebar-badge">${badge}</span>` : "";
  summary.innerHTML = `
    <span class="app-sidebar-group-label">
      <span class="app-sidebar-icon-wrap" aria-hidden="true">
        <span class="material-symbols-outlined">${icon}</span>
      </span>
      <span class="app-sidebar-label-with-arrow">
        <span class="app-sidebar-label">${label}</span>
        <span class="material-symbols-outlined app-sidebar-chevron" aria-hidden="true">expand_more</span>
      </span>
    </span>
    ${badgeHtml ? `<span class="app-sidebar-group-right">${badgeHtml}</span>` : ""}
  `;
  const children = document.createElement("div");
  children.className = "app-sidebar-children";
  links.filter(Boolean).forEach((link) => children.appendChild(link));
  group.append(summary, children);
  return group;
}

function createSubgroup(label, icon, nodes, { badge = "" } = {}) {
  const group = document.createElement("details");
  group.className = "app-sidebar-subgroup";
  const summary = document.createElement("summary");
  summary.title = label;
  const badgeHtml = badge ? `<span class="app-sidebar-badge">${badge}</span>` : "";
  const iconHtml = icon
    ? `<span class="app-sidebar-subgroup-icon material-symbols-outlined" aria-hidden="true">${icon}</span>`
    : "";
  summary.innerHTML = `
    <span class="app-sidebar-subgroup-label-wrap">
      ${iconHtml}
      <span class="app-sidebar-label-with-arrow">
        <span class="app-sidebar-subgroup-label">${label}</span>
        <span class="material-symbols-outlined app-sidebar-chevron" aria-hidden="true">expand_more</span>
      </span>
    </span>
    ${badgeHtml ? `<span class="app-sidebar-group-right">${badgeHtml}</span>` : ""}
  `;
  const children = document.createElement("div");
  children.className = "app-sidebar-subgroup-links";
  nodes.filter(Boolean).forEach((node) => children.appendChild(node));
  group.append(summary, children);
  return group;
}

function createMobileGroup(label, links) {
  const group = document.createElement("details");
  group.className = "app-nav-mobile-group";
  const summary = document.createElement("summary");
  summary.innerHTML = `<span>${label}</span><span class="material-symbols-outlined" aria-hidden="true">expand_more</span>`;
  const children = document.createElement("div");
  links.forEach((link) => children.appendChild(link));
  group.append(summary, children);
  return group;
}

function appendMenu(parent, source, variant, map = getCachedPermissionMap()) {
  const filtered = filterMenuEntriesByPermissions(APP_MENU, map);
  buildMenuNodes(filtered, source, variant, false).forEach((node) => parent.appendChild(node));
}

function rebuildMobileMenu(nav, source, map = getCachedPermissionMap()) {
  const menu = nav.querySelector("#navMenu");
  if (!menu) return;
  const logout = menu.querySelector("[data-logout]");
  [...menu.children].forEach((child) => {
    if (child !== logout) child.remove();
  });
  const fragment = document.createDocumentFragment();
  appendMenu(fragment, source, "mobile", map);
  if (canAccessMenuEntry(FOOTER_GESTAO_ENTRY, map)) {
    fragment.appendChild(createMenuLink(FOOTER_GESTAO_ENTRY, source, "mobile"));
  }
  if (logout) menu.insertBefore(fragment, logout);
  else menu.appendChild(fragment);
}

function populateSidebarMenuNodes(sidebar, source, map = getCachedPermissionMap()) {
  const scrollArea = sidebar?.querySelector(".app-sidebar-scroll");
  if (!scrollArea) return;

  // Preservar quais grupos estavam abertos pelo utilizador
  const openGroups = new Set(
    [...scrollArea.querySelectorAll("details[open] > summary .app-sidebar-label, details[open] > summary .app-sidebar-subgroup-label")]
      .map((el) => el.textContent?.trim())
      .filter(Boolean)
  );

  scrollArea.innerHTML = "";
  const primary = document.createElement("div");
  primary.className = "app-sidebar-links";
  scrollArea.appendChild(primary);

  const filtered = filterMenuEntriesByPermissions(APP_MENU, map);
  buildMenuNodes(filtered, source, "sidebar", false).forEach((node) => {
    if (node.classList.contains("app-sidebar-link")) primary.appendChild(node);
    else scrollArea.appendChild(node);
  });

  if (openGroups.size > 0) {
    scrollArea.querySelectorAll("details").forEach((details) => {
      const lbl = details.querySelector(":scope > summary .app-sidebar-label, :scope > summary .app-sidebar-subgroup-label")?.textContent?.trim();
      if (lbl && openGroups.has(lbl)) details.open = true;
    });
  }

  // Atualizar rodapé (botão Gestão)
  const footer = sidebar.querySelector(".app-sidebar-footer");
  if (footer) {
    const existingUsers = footer.querySelector("[data-nav-users]");
    const canGestao = canAccessMenuEntry(FOOTER_GESTAO_ENTRY, map);
    if (canGestao && !existingUsers) {
      const users = createMenuLink(FOOTER_GESTAO_ENTRY, source, "sidebar");
      footer.insertBefore(users, footer.firstChild);
    } else if (!canGestao && existingUsers) {
      existingUsers.remove();
    } else if (canGestao && existingUsers) {
      existingUsers.classList.remove("hidden");
    }
  }
}

/**
 * Reconstrói dinamicamente o menu lateral, o menu mobile e a barra superior
 * de acordo com o mapa de permissões efetivas do utilizador.
 */
export function refreshNavigationForPermissions(map = getCachedPermissionMap()) {
  if (document.documentElement.classList.contains("is-embed") || document.body?.classList.contains("is-embed")) return;
  const nav = getTopNav();
  const source = getDesktopNavLinksContainer();
  if (!nav || document.body.dataset.appNav === "off") return;

  // 1. Atualizar links da barra superior (source)
  const topSpecs = [
    { sel: "[data-nav-dashboard]", spec: "navlinks:nav_dashboard&dashboard:view" },
    { sel: "[data-nav-clientes]", spec: "navlinks:nav_clientes&clientes:view" },
    { sel: "[data-nav-obras]", spec: "navlinks:nav_obras&obras:view" },
    { sel: "[data-nav-logistica], [data-nav-logistics]", spec: "navlinks:nav_logistica&(stock:view|logistica:view|obras:tab_stock_requests)" },
    { sel: "[data-nav-planeamento]", spec: "navlinks:nav_planeamento&obras:view" },
    { sel: "[data-nav-cotacao]", spec: "navlinks:nav_cotacao&(obras:view|stock:view|logistica:view)" },
    { sel: "[data-nav-comercial]", spec: "navlinks:nav_comercial&(comercial:tab_orcamentos|comercial:view)" },
    { sel: "[data-nav-financeiro]", spec: "navlinks:nav_financeiro&financeiro:view" },
    { sel: "[data-nav-centros]", spec: "navlinks:nav_centros_gerais&(pedidosExtras:view|financeiro:view)" },
    { sel: "[data-nav-users]", spec: "navlinks:nav_users&(sistema:view|permissoes:view|permissoes:manage_permissions|configuracoes:view)" },
  ];

  const role = (getSessionUser()?.role || "").toLowerCase();
  topSpecs.forEach(({ sel, spec }) => {
    const allowed = role === "admin" ? true : role === "cliente" ? false : canPermSpec(map, spec);
    nav.querySelectorAll(sel).forEach((el) => {
      if (isBrandLink(nav, el)) return;
      el.classList.toggle("hidden", !allowed);
    });
  });

  // 2. Reconstruir menu mobile apenas com itens permitidos
  rebuildMobileMenu(nav, source, map);

  // 3. Reconstruir sidebar principal apenas com itens/grupos permitidos
  const sidebar = document.getElementById("appPrimarySidebar");
  if (sidebar) {
    populateSidebarMenuNodes(sidebar, source, map);
  }

  setActiveState(sidebar);
  syncGroupVisibility(sidebar);
}

function wireSidebarInteractions(sidebar) {
  const pinBtn = sidebar.querySelector("#btnTogglePinSidebar");
  if (pinBtn) {
    pinBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isPinned = sidebar.classList.toggle("is-pinned");
      document.body.classList.toggle("app-sidebar-pinned", isPinned);
      try {
        localStorage.setItem("app_sidebar_pinned", isPinned ? "true" : "false");
      } catch {}
    });
  }

  // Animação suave tipo accordion ao expandir/recolher grupos e subgrupos
  sidebar.addEventListener("click", (e) => {
    const summary = e.target.closest("summary");
    if (!summary) return;
    const details = summary.parentElement;
    if (!details || (!details.classList.contains("app-sidebar-group") && !details.classList.contains("app-sidebar-subgroup"))) return;

    const content = details.querySelector(".app-sidebar-children, .app-sidebar-subgroup-links");
    if (!content) return;

    e.preventDefault();

    if (details.open) {
      details.classList.add("is-closing");
      const startHeight = content.offsetHeight;
      content.style.overflow = "hidden";
      const anim = content.animate(
        [
          { height: `${startHeight}px`, opacity: 1 },
          { height: "0px", opacity: 0 }
        ],
        { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
      anim.onfinish = () => {
        details.open = false;
        details.classList.remove("is-closing");
        content.style.height = "";
        content.style.opacity = "";
        content.style.overflow = "";
      };
    } else {
      details.classList.remove("is-closing");
      details.open = true;
      content.style.overflow = "hidden";
      const targetHeight = content.scrollHeight;
      const anim = content.animate(
        [
          { height: "0px", opacity: 0 },
          { height: `${targetHeight}px`, opacity: 1 }
        ],
        { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
      anim.onfinish = () => {
        content.style.height = "";
        content.style.opacity = "";
        content.style.overflow = "";
      };
    }
  });

  const scrollArea = sidebar.querySelector(".app-sidebar-scroll");
  if (scrollArea) {
    sidebar.addEventListener("click", (e) => {
      const link = e.target.closest("a.app-sidebar-link[href]");
      if (!link || link.getAttribute("href") === "#") return;
      try {
        sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(scrollArea.scrollTop));
      } catch {}
    });
  }
  sidebar.addEventListener("mouseenter", () => ensureActiveLinkVisible(sidebar));
  sidebar.addEventListener("focusin", () => ensureActiveLinkVisible(sidebar));

  const searchInput = sidebar.querySelector("#sidebarSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      const links = sidebar.querySelectorAll(".app-sidebar-scroll .app-sidebar-link");
      const groups = sidebar.querySelectorAll(".app-sidebar-group, .app-sidebar-subgroup");

      if (!q) {
        links.forEach((l) => l.classList.remove("is-search-hidden", "is-search-match"));
        groups.forEach((g) => {
          g.classList.remove("is-search-hidden");
          if (!g.classList.contains("has-active-link")) g.open = false;
        });
        return;
      }

      links.forEach((link) => {
        const text = (link.textContent || "").toLowerCase();
        const match = text.includes(q);
        link.classList.toggle("is-search-hidden", !match);
        link.classList.toggle("is-search-match", match);
      });

      groups.forEach((group) => {
        const hasMatch = Boolean(group.querySelector(".app-sidebar-link.is-search-match"));
        group.classList.toggle("is-search-hidden", !hasMatch);
        if (hasMatch) group.open = true;
      });
    });
  }

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });
}

/** Builds the shared desktop sidebar and the mobile menu from APP_MENU. */
export function transformDesktopNavToDropdowns() {
  if (document.documentElement.classList.contains("is-embed") || document.body?.classList.contains("is-embed")) return;
  const source = getDesktopNavLinksContainer();
  const nav = getTopNav();
  if (document.body.dataset.appSidebar === "off" || document.body.dataset.appNav === "off" || !nav) return;

  rebuildMobileMenu(nav, source);

  // Screens that already have a task-specific desktop sidebar (admin, project selector)
  if (!source || document.getElementById("appPrimarySidebar") || document.querySelector(".admin-sidebar, #sidebar")) {
    setActiveState();
    syncGroupVisibility();
    return;
  }

  const sidebar = document.createElement("aside");
  sidebar.id = "appPrimarySidebar";
  sidebar.className = "app-primary-sidebar";
  sidebar.setAttribute("aria-label", "Menu principal");

  // Retrieve user session info
  const user = getSessionUser();
  const map = getCachedPermissionMap();

  // 1. Top Header: Navigation title/icon + Pin Button
  const header = document.createElement("div");
  header.className = "app-sidebar-header";
  header.innerHTML = `
    <div class="app-sidebar-header-left">
      <span class="material-symbols-outlined app-sidebar-menu-icon" aria-hidden="true">dashboard_customize</span>
      <span class="app-sidebar-menu-title">Navegação</span>
    </div>
    <button type="button" id="btnTogglePinSidebar" class="app-sidebar-pin-btn" title="Fixar / Desafixar menu" aria-label="Fixar menu">
      <span class="material-symbols-outlined" aria-hidden="true">dock_to_left</span>
    </button>
  `;
  sidebar.appendChild(header);

  // 2. Search Bar (inspired by ideia.mp4)
  const searchBox = document.createElement("div");
  searchBox.className = "app-sidebar-search";
  searchBox.innerHTML = `
    <span class="material-symbols-outlined app-sidebar-search-icon" aria-hidden="true">search</span>
    <input type="text" id="sidebarSearchInput" class="app-sidebar-search-input" placeholder="Buscar no menu..." autocomplete="off" spellcheck="false" />
    
  `;
  sidebar.appendChild(searchBox);

  // 3. Scroll Area for links & groups
  const scrollArea = document.createElement("div");
  scrollArea.className = "app-sidebar-scroll";
  sidebar.appendChild(scrollArea);

  // 4. Footer: Gestão & Sair (com o mesmo estilo e alinhamento)
  const footer = document.createElement("div");
  footer.className = "app-sidebar-footer";

  if (canAccessMenuEntry(FOOTER_GESTAO_ENTRY, map) || (user?.role || "").toLowerCase() === "admin") {
    const users = createMenuLink(FOOTER_GESTAO_ENTRY, source, "sidebar");
    footer.appendChild(users);
  }

  const logoutBtn = document.createElement("button");
  logoutBtn.type = "button";
  logoutBtn.setAttribute("data-logout", "");
  logoutBtn.className = "app-sidebar-link app-sidebar-logout-btn";
  logoutBtn.title = "Terminar sessão";
  logoutBtn.setAttribute("aria-label", "Terminar sessão");
  logoutBtn.innerHTML = `
    <span class="app-sidebar-icon-wrap" aria-hidden="true">
      <span class="material-symbols-outlined">logout</span>
    </span>
    <span class="app-sidebar-label">Sair</span>
  `;
  footer.appendChild(logoutBtn);
  sidebar.appendChild(footer);

  populateSidebarMenuNodes(sidebar, source, map);

  document.body.appendChild(sidebar);
  document.body.classList.add("app-sidebar-layout", "app-sidebar-collapsed");

  if (localStorage.getItem("app_sidebar_pinned") === "true") {
    sidebar.classList.add("is-pinned");
    document.body.classList.add("app-sidebar-pinned");
  }

  source.classList.add("app-nav-desktop-source");
  setActiveState(sidebar, { preferSaved: true });
  syncGroupVisibility(sidebar);
  wireSidebarInteractions(sidebar);
  requestAnimationFrame(() => ensureActiveLinkVisible(sidebar));
}

export function markActiveDropdownTriggers() {
  setActiveState();
}

/** Keeps sections hidden when permissions hide all of their child links. */
export function syncNavDropdownGroups() {
  syncGroupVisibility();
  setActiveState();
}

let sidebarListenersBound = false;

export function initAppNavDropdowns() {
  markTopNavActive();
  if (sidebarListenersBound) return;
  sidebarListenersBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".app-sidebar-group[open], .app-sidebar-subgroup[open], .app-nav-mobile-group[open]").forEach((group) => {
      if (!group.classList.contains("has-active-link")) group.open = false;
    });
    const searchInput = document.getElementById("sidebarSearchInput");
    if (searchInput && document.activeElement === searchInput) {
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
      searchInput.blur();
    }
  });
}
