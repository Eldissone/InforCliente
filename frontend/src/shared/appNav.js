const LOGISTICS_SELECTOR = "[data-nav-logistics], [data-nav-logistica]";

/** Ordem do menu principal. Itens `pending` ainda não têm ecrã próprio. */
const APP_MENU = [
  { type: "link", label: "Dashboard", icon: "home", selector: "[data-nav-dashboard]" },
  {
    type: "group",
    label: "Registos",
    icon: "folder_open",
    children: [
      { label: "Obras", icon: "apartment", selector: "[data-nav-obras]" },
      { label: "Terceiros", icon: "groups", selector: "[data-nav-clientes]" },
      { label: "Produtos e Serviços", icon: "inventory_2", selector: LOGISTICS_SELECTOR, href: "/Stock?tab=catalog" },
      { label: "Equipamentos, Maquinarias e Viaturas", icon: "agriculture", selector: LOGISTICS_SELECTOR, href: "/Stock?tab=tools" },
      { label: "Pessoal", icon: "badge", pending: true },
      { label: "Armazéns", icon: "warehouse", selector: LOGISTICS_SELECTOR, href: "/Stock?tab=warehouses" },
      { label: "Tipo de Custo (Produto ou Serviço)", icon: "category", pending: true },
      { label: "Categorias de Custo", icon: "account_tree", pending: true },
      { label: "Subcategorias de Custo", icon: "subdirectory_arrow_right", pending: true },
      { label: "Cartões Bancários", icon: "credit_card", pending: true },
      { label: "Movimentos Financeiros", icon: "payments", pending: true },
    ],
  },
  {
    type: "group",
    label: "Obras",
    icon: "construction",
    children: [
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
  { type: "group", label: "Financeiro", icon: "account_balance", children: [] },
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
  link.className = variant === "sidebar" ? "app-sidebar-link" : "";
  if (wasHidden) link.classList.add("hidden");
  if (definition.pending) {
    link.classList.add("is-pending");
    link.href = "#";
    link.title = "Módulo em preparação";
    link.addEventListener("click", (event) => event.preventDefault());
  }
  link.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${definition.icon}</span><span>${definition.label}</span>`;
  return link;
}

function menuLinks(children, source, variant) {
  return (children || []).map((child) => createMenuLink(child, source, variant));
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
  if (link.matches("[data-nav-centros]")) return current.includes("/financeiro/");
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
  document.querySelectorAll(".app-sidebar-group, .app-nav-mobile-group").forEach((group) => {
    const active = Boolean(group.querySelector("a.is-active"));
    group.classList.toggle("has-active-link", active);
    if (active) group.open = true;
  });
}

function syncGroupVisibility(sidebar = document.getElementById("appPrimarySidebar")) {
  const roots = [sidebar, document.getElementById("navMenu")].filter(Boolean);
  roots.forEach((root) => {
    root.querySelectorAll(".app-sidebar-group, .app-sidebar-section, .app-nav-mobile-group").forEach((section) => {
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
  APP_MENU.forEach((entry) => {
    if (entry.type === "link") {
      parent.appendChild(createMenuLink(entry, source, variant));
      return;
    }
    const links = menuLinks(entry.children, source, variant);
    parent.appendChild(variant === "sidebar"
      ? createGroup(entry.label, entry.icon, links)
      : createMobileGroup(entry.label, links));
  });
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
  if (document.body.dataset.appSidebar === "off" || !nav) return;

  rebuildMobileMenu(nav, source);

  // Screens that already have a task-specific desktop sidebar (admin, project
  // selector and purchase centre) keep their dedicated working area intact.
  if (!source || document.getElementById("appPrimarySidebar") || document.querySelector(".admin-sidebar, #sidebar, .cc-sidebar")) {
    setActiveState();
    syncGroupVisibility();
    return;
  }

  const sidebar = document.createElement("aside");
  sidebar.id = "appPrimarySidebar";
  sidebar.className = "app-primary-sidebar";
  sidebar.setAttribute("aria-label", "Menu principal");
  sidebar.innerHTML = `<div class="app-sidebar-top"><span class="app-sidebar-caption">Principal</span><button class="app-sidebar-collapse" type="button" aria-label="Recolher menu" aria-expanded="true"><span class="material-symbols-outlined" aria-hidden="true">chevron_left</span></button></div>`;

  const primary = document.createElement("div");
  primary.className = "app-sidebar-links";
  sidebar.appendChild(primary);
  APP_MENU.forEach((entry) => {
    if (entry.type === "link") {
      primary.appendChild(createMenuLink(entry, source, "sidebar"));
      return;
    }
    sidebar.appendChild(createGroup(entry.label, entry.icon, menuLinks(entry.children, source, "sidebar")));
  });

  const users = createMenuLink({ label: "Gestão", icon: "settings", selector: "[data-nav-users]" }, source, "sidebar");
  const footer = document.createElement("div");
  footer.className = "app-sidebar-footer";
  footer.appendChild(users);
  footer.insertAdjacentHTML("beforeend", `<button type="button" data-logout class="app-sidebar-logout"><span class="material-symbols-outlined" aria-hidden="true">logout</span><span>Terminar sessão</span></button>`);
  sidebar.appendChild(footer);

  document.body.appendChild(sidebar);
  document.body.classList.add("app-sidebar-layout");
  source.classList.add("app-nav-desktop-source");

  sidebar.querySelector(".app-sidebar-collapse")?.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("app-sidebar-collapsed");
    const button = sidebar.querySelector(".app-sidebar-collapse");
    button?.setAttribute("aria-expanded", String(!collapsed));
    button?.setAttribute("aria-label", collapsed ? "Expandir menu" : "Recolher menu");
  });
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
    document.querySelectorAll(".app-sidebar-group[open], .app-nav-mobile-group[open]").forEach((group) => {
      if (!group.classList.contains("has-active-link")) group.open = false;
    });
  });
}
