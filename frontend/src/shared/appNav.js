const LOGISTICS_SELECTOR = "[data-nav-logistics], [data-nav-logistica]";

/** Ordem do menu principal. Itens `pending` ainda não têm ecrã próprio. */
const APP_MENU = [
  { type: "link", label: "Dashboard", icon: "home", selector: "[data-nav-dashboard]", href: "/Dashboard" },
  {
    type: "group",
    label: "Registos",
    icon: "folder_open",
    badge: "13",
    children: [
      { label: "Contactos", icon: "contacts", href: "/registos/contactos" },
      { label: "Obras", icon: "apartment", href: "/registos/obras" },
      {
        label: "Terceiros",
        icon: "groups",
        badge: "3",
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
      { label: "Listagem", icon: "list", selector: "[data-nav-obras]", href: "/Projectos/ProjectGeral" },
      { label: "Planeamento", icon: "event_note", selector: "[data-nav-planeamento]", href: "/Projectos/centroCustos" },
      { label: "Cotação", icon: "request_quote", selector: "[data-nav-cotacao]", href: "/Projectos/Cotacao" },
    ],
  },
  {
    type: "group",
    label: "Compras e Logística",
    icon: "local_shipping",
    children: [
      { label: "Produtos e Serviços", icon: "category", href: "/produtos" },
      { label: "Logística", icon: "inventory_2", selector: LOGISTICS_SELECTOR, href: "/Stock" },
      { label: "Centro de Compras", icon: "shopping_cart", selector: "[data-nav-centros]", href: "/Financeiro/centroDeCompras" },
    ],
  },
  {
    type: "group",
    label: "Financeiro",
    icon: "account_balance",
    children: [
      { label: "Overview Financeiro", icon: "insights", href: "/Financeiro/overview", perm: "financeiro:view" },
      {
        label: "Faturação",
        icon: "request_quote",
        children: [
          { label: "Registar Faturas", icon: "post_add", href: "/Financeiro/faturacao/registar", perm: "financeiro:view" },
          { label: "Faturação Prevista", icon: "event_upcoming", href: "/Financeiro/faturacao/prevista", perm: "financeiro:view" },
          { label: "Resumo Faturas vs Previsão", icon: "compare_arrows", href: "/Financeiro/faturacao/resumo", perm: "financeiro:view" },
        ],
      },
      {
        label: "Custos",
        icon: "payments",
        children: [
          { label: "Overview Custos", icon: "monitoring", href: "/Financeiro/custos/overview", perm: "financeiro:view" },
          { label: "Registar Custos", icon: "receipt_long", href: "/Financeiro/custos/registar", perm: "financeiro:view" },
          { label: "Custos Realizados", icon: "task_alt", href: "/Financeiro/custos/realizados", perm: "financeiro:view" },
        ],
      },
      { label: "Contas a Receber / Pagar", icon: "swap_horiz", href: "/Financeiro/contas", perm: "financeiro:view" },
      {
        label: "Tesouraria",
        icon: "account_balance_wallet",
        children: [
          { label: "Extratos Bancários", icon: "receipt_long", href: "/Financeiro/tesouraria/extratos", perm: "financeiro:view" },
          { label: "Recebimentos do Cliente", icon: "south_west", href: "/Financeiro/tesouraria/recebimentos", perm: "financeiro:view" },
          { label: "Transferências Internas", icon: "swap_horiz", href: "/Financeiro/tesouraria/transferencias", perm: "financeiro:view" },
          { label: "Levantamentos ATM", icon: "local_atm", href: "/Financeiro/tesouraria/atm", perm: "financeiro:view" },
          { label: "Pagamentos a Fornecedor", icon: "north_east", href: "/Financeiro/tesouraria/pagamentos", perm: "financeiro:view" },
        ],
      },
      { label: "Centro de Pagamentos", icon: "account_balance", href: "/Financeiro/centro-pagamentos", perm: "financeiro:view" },
      { label: "Controlo Financeiro", icon: "query_stats", href: "/Financeiro/controlo", perm: "financeiro:view" },
    ],
  },
];

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
  const wasHidden = Boolean(origin?.classList.contains("hidden"));
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
    link.className = "";
  }
  if (definition.perm) link.setAttribute("data-nav-perm", definition.perm);
  if (wasHidden) link.classList.add("hidden");
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

  // Retrieve user session info for the profile card (inspired by ideia.mp4)
  let user = null;
  try {
    const rawUser = localStorage.getItem("gestor_user") || localStorage.getItem("user");
    if (rawUser) user = JSON.parse(rawUser);
  } catch {}
  const userName = user?.name || user?.email?.split("@")[0] || "Administrador";
  const userRole = (user?.role || "Gestor").toUpperCase();
  const initials = getUserInitials(user);

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

  const primary = document.createElement("div");
  primary.className = "app-sidebar-links";
  scrollArea.appendChild(primary);

  buildMenuNodes(APP_MENU, source, "sidebar", false).forEach((node) => {
    if (node.classList.contains("app-sidebar-link")) primary.appendChild(node);
    else scrollArea.appendChild(node);
  });
  sidebar.appendChild(scrollArea);

  // 4. Footer: Gestão & Sair (com o mesmo estilo e alinhamento)
  const footer = document.createElement("div");
  footer.className = "app-sidebar-footer";

  const users = createMenuLink({ label: "Gestão", icon: "settings", selector: "[data-nav-users]" }, source, "sidebar");
  footer.appendChild(users);

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

  document.body.appendChild(sidebar);
  document.body.classList.add("app-sidebar-layout", "app-sidebar-collapsed");

  if (localStorage.getItem("app_sidebar_pinned") === "true") {
    sidebar.classList.add("is-pinned");
    document.body.classList.add("app-sidebar-pinned");
  }

  source.classList.add("app-nav-desktop-source");
  setActiveState(sidebar);
  syncGroupVisibility(sidebar);
  wireSidebarInteractions(sidebar);
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
