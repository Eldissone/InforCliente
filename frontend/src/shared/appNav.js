const LOGISTICS_SELECTOR = "[data-nav-logistics], [data-nav-logistica]";

/** Ordem do menu principal. Itens `pending` ainda não têm ecrã próprio. */
const APP_MENU = [
  { type: "link", label: "Dashboard", icon: "home", selector: "[data-nav-dashboard]" },
  {
    type: "group",
    label: "Registos",
    icon: "folder_open",
    children: [
      { label: "Contactos", icon: "contacts", href: "/registos/contactos" },
      { label: "Obras", icon: "apartment", href: "/registos/obras" },
      {
        label: "Terceiros",
        icon: "groups",
        children: [
          { label: "Setores", icon: "account_tree", href: "/registos/terceiros/setores" },
          { label: "Fornecedores", icon: "local_shipping", href: "/registos/terceiros/fornecedores" },
          { label: "Clientes", icon: "business", selector: "[data-nav-clientes]", href: "/registos/terceiros/clientes" },
        ],
      },
      { label: "Produtos e Serviços", icon: "inventory_2", href: "/registos/produtos" },
      { label: "Equipamentos, Maquinarias e Viaturas", icon: "agriculture", href: "/registos/equipamentos" },
      { label: "Pessoal", icon: "badge", href: "/registos/pessoal" },
      { label: "Folha de Ponto", icon: "schedule", href: "/registos/folha-ponto" },
      { label: "Armazéns", icon: "warehouse", href: "/registos/armazens" },
      { label: "Tipo de Custo (Produto ou Serviço)", icon: "category", href: "/registos/tipo-custo" },
      { label: "Categorias de Custo", icon: "account_tree", href: "/registos/categorias-custo" },
      { label: "Subcategorias de Custo", icon: "subdirectory_arrow_right", href: "/registos/subcategorias-custo" },
      { label: "Cartões Bancários", icon: "credit_card", href: "/registos/cartoes" },
      { label: "Movimentos Financeiros", icon: "payments", href: "/registos/movimentos" },
    ],
  },
  {
    type: "group",
    label: "Obras",
    icon: "construction",
    children: [
      { label: "Listagem", icon: "list", selector: "[data-nav-obras]" },
      { label: "Planeamento", icon: "event_note", selector: "[data-nav-planeamento]" },
      { label: "Cotação", icon: "request_quote", selector: "[data-nav-cotacao]" },
    ],
  },
  {
    type: "group",
    label: "Compras e Logística",
    icon: "local_shipping",
    children: [
      { label: "Logística", icon: "inventory_2", selector: LOGISTICS_SELECTOR },
      { label: "Centro de Compras", icon: "shopping_cart", selector: "[data-nav-centros]" },
    ],
  },
  {
    type: "group",
    label: "Financeiro",
    icon: "account_balance",
    children: [
      {
        label: "Contas a Pagar",
        icon: "north_east",
        children: [
          { code: "P1", label: "Centro de Pagamentos", icon: "account_balance", href: "/Financeiro/contas-pagar/centro-pagamentos", perm: "financeiro:view" },
          { code: "P2", label: "Calendário de Pagamentos", icon: "event", href: "/Financeiro/contas-pagar/calendario-pagamentos", perm: "financeiro:view", pending: true },
          { code: "P3", label: "Despesas sem Comprovativo", icon: "receipt", href: "/Financeiro/contas-pagar/despesas-sem-comprovativo", perm: "financeiro:view", pending: true },
        ],
      },
      {
        label: "Contas a Receber",
        icon: "south_west",
        children: [
          { code: "R1", label: "Centro de Recebimentos", icon: "account_balance", href: "/Financeiro/contas-receber/centro-recebimentos", perm: "financeiro:view" },
          { code: "R2", label: "Calendário de Recebimentos", icon: "event", href: "/Financeiro/contas-receber/calendario-recebimentos", perm: "financeiro:view", pending: true },
          { code: "R3", label: "Autos de Medição", icon: "straighten", href: "/Financeiro/contas-receber/autos-medicao", perm: "financeiro:view", pending: true },
          { code: "R4", label: "Conta Corrente de Clientes", icon: "account_box", href: "/Financeiro/contas-receber/conta-corrente-clientes", perm: "financeiro:view", pending: true },
        ],
      },
      {
        label: "Tesouraria",
        icon: "account_balance_wallet",
        children: [
          { code: "T1", label: "Contas e Saldos", icon: "account_balance", href: "/Financeiro/tesouraria/contas-saldos", perm: "financeiro:view", pending: true },
          { code: "T2", label: "Conciliação Bancária", icon: "rule", href: "/Financeiro/tesouraria/conciliacao-bancaria", perm: "financeiro:view" },
          { code: "T3", label: "Extratos Bancários", icon: "receipt_long", href: "/Financeiro/tesouraria/extratos-bancarios", perm: "financeiro:view", pending: true },
          { code: "T4", label: "Previsão de Tesouraria", icon: "trending_up", href: "/Financeiro/tesouraria/previsao-tesouraria", perm: "financeiro:view", pending: true },
          { code: "T8", label: "Mapa de Fluxo de Caixa", icon: "swap_vert", href: "/Financeiro/tesouraria/fluxo-caixa", perm: "financeiro:view", pending: true },
          { code: "T5", label: "Contas e Cartões", icon: "credit_card", href: "/Financeiro/tesouraria/contas-cartoes", perm: "financeiro:view", pending: true },
          { code: "T6", label: "Alocação de Cartões", icon: "assignment_ind", href: "/Financeiro/tesouraria/alocacao-cartoes", perm: "financeiro:view", pending: true },
          { code: "T7", label: "Fundo de Maneio", icon: "savings", href: "/Financeiro/tesouraria/fundo-maneio", perm: "financeiro:view", pending: true },
        ],
      },
    ],
  },
];

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
  const wasHidden = Boolean(origin?.classList.contains("hidden"));
  const link = origin ? origin.cloneNode(false) : document.createElement("a");
  link.removeAttribute("id");
  if (!origin) link.href = definition.href || "#";
  else if (definition.href) link.href = definition.href;
  if (definition.selector) {
    const attr = definition.selector.match(/data-nav-[\w-]+/)?.[0];
    if (attr) link.setAttribute(attr, "");
  }
  if (variant === "sidebar") link.className = "app-sidebar-link";
  else if (!origin) link.className = "flex items-center gap-3 text-sm font-semibold text-slate-400 py-3 px-4 rounded-xl hover:bg-slate-800 transition-all";
  else link.className = "";
  if (definition.perm) link.setAttribute("data-nav-perm", definition.perm);
  if (wasHidden) link.classList.add("hidden");
  if (definition.pending) {
    link.classList.add("is-pending");
    link.href = "#";
    link.title = "Módulo em preparação";
    link.addEventListener("click", (event) => event.preventDefault());
  }
  const code = definition.code ? `<span class="app-sidebar-code">${definition.code}</span>` : "";
  link.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${definition.icon || "chevron_right"}</span>${code}<span>${definition.label}</span>`;
  return link;
}

function buildMenuNodes(entries, source, variant, nested) {
  return (entries || []).map((entry) => {
    if (entry.children) {
      const nodes = buildMenuNodes(entry.children, source, variant, true);
      if (variant === "mobile") return createMobileGroup(entry.label, nodes);
      if (nested) return createSubgroup(entry.label, nodes);
      return createGroup(entry.label, entry.icon || "folder", nodes);
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
  if (link.matches("[data-nav-centros]")) {
    return current.includes("/financeiro/centrodecompras") || current.includes("/financeiro/financeiro");
  }
  if (link.matches("[data-nav-planeamento]")) return current.includes("centrocustos");
  if (link.matches("[data-nav-cotacao]")) return current.includes("/cotacao");
  if (link.matches("[data-nav-users]")) return current.includes("/users/");
  if (link.matches("[data-nav-dashboard]")) return /\/dashboard(\/index)?\/?$/.test(current);
  return false;
}

function setActiveState(sidebar = document.getElementById("appPrimarySidebar")) {
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
}

function syncGroupVisibility(sidebar = document.getElementById("appPrimarySidebar")) {
  const roots = [sidebar, document.getElementById("navMenu")].filter(Boolean);
  roots.forEach((root) => {
    root.querySelectorAll(".app-sidebar-group, .app-sidebar-subgroup, .app-sidebar-section, .app-nav-mobile-group").forEach((section) => {
      const links = [...section.querySelectorAll("a")];
      if (links.length) section.classList.toggle("hidden", !links.some((link) => !link.classList.contains("hidden")));
    });
  });
}

function createGroup(label, icon, links, { open = false } = {}) {
  const group = document.createElement("details");
  group.className = "app-sidebar-group";
  group.open = open;
  const summary = document.createElement("summary");
  summary.innerHTML = `<span class="app-sidebar-group-label"><span class="material-symbols-outlined" aria-hidden="true">${icon}</span><span>${label}</span></span><span class="material-symbols-outlined app-sidebar-chevron" aria-hidden="true">expand_more</span>`;
  const children = document.createElement("div");
  children.className = "app-sidebar-children";
  links.filter(Boolean).forEach((link) => children.appendChild(link));
  group.append(summary, children);
  return group;
}

function createSubgroup(label, nodes) {
  const group = document.createElement("details");
  group.className = "app-sidebar-subgroup";
  const summary = document.createElement("summary");
  summary.innerHTML = `<span>${label}</span><span class="material-symbols-outlined app-sidebar-chevron" aria-hidden="true">expand_more</span>`;
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

function appendMenu(parent, source, variant) {
  buildMenuNodes(APP_MENU, source, variant, false).forEach((node) => parent.appendChild(node));
}

function rebuildMobileMenu(nav, source) {
  const menu = nav.querySelector("#navMenu");
  if (!menu) return;
  const logout = menu.querySelector("[data-logout]");
  [...menu.children].forEach((child) => {
    if (child !== logout) child.remove();
  });
  const fragment = document.createDocumentFragment();
  appendMenu(fragment, source, "mobile");
  fragment.appendChild(createMenuLink(
    { label: "Gestão", icon: "settings", selector: "[data-nav-users]" },
    source,
    "mobile"
  ));
  if (logout) menu.insertBefore(fragment, logout);
  else menu.appendChild(fragment);
}

/** Builds the shared desktop sidebar and the mobile menu from APP_MENU. */
export function transformDesktopNavToDropdowns() {
  const source = getDesktopNavLinksContainer();
  const nav = getTopNav();
  if (document.body.dataset.appSidebar === "off" || document.body.dataset.appNav === "off" || !nav) return;

  rebuildMobileMenu(nav, source);

  // Screens that already have a task-specific desktop sidebar (admin, project
  // selector) keep their dedicated working area intact.
  if (!source || document.getElementById("appPrimarySidebar") || document.querySelector(".admin-sidebar, #sidebar")) {
    setActiveState();
    syncGroupVisibility();
    return;
  }

  const sidebar = document.createElement("aside");
  sidebar.id = "appPrimarySidebar";
  sidebar.className = "app-primary-sidebar";
  sidebar.setAttribute("aria-label", "Menu principal");

  if (document.body.dataset.shell === "figma") {
    sidebar.classList.add("is-figma-shell");
    const brandLabel = document.getElementById("navBrandText")?.textContent?.trim() || "Gestor";
    const brand = document.createElement("a");
    brand.className = "app-sidebar-brand";
    brand.href = "/Dashboard";
    brand.innerHTML = `<span class="app-sidebar-mark">Info</span><span class="app-sidebar-brand-text">${brandLabel}</span>`;
    sidebar.appendChild(brand);
  }

  const primary = document.createElement("div");
  primary.className = "app-sidebar-links";
  sidebar.appendChild(primary);
  buildMenuNodes(APP_MENU, source, "sidebar", false).forEach((node) => {
    if (node.classList.contains("app-sidebar-link")) primary.appendChild(node);
    else sidebar.appendChild(node);
  });

  const users = createMenuLink({ label: "Gestão", icon: "settings", selector: "[data-nav-users]" }, source, "sidebar");
  const footer = document.createElement("div");
  footer.className = "app-sidebar-footer";
  footer.appendChild(users);
  footer.insertAdjacentHTML("beforeend", `<button type="button" data-logout class="app-sidebar-logout"><span class="material-symbols-outlined" aria-hidden="true">logout</span><span>Terminar sessão</span></button>`);
  sidebar.appendChild(footer);

  document.body.appendChild(sidebar);
  document.body.classList.add("app-sidebar-layout", "app-sidebar-collapsed");
  source.classList.add("app-nav-desktop-source");
  setActiveState(sidebar);
  syncGroupVisibility(sidebar);
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
  });
}
