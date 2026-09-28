const NAV_LINKS = {
  dashboard: { selector: "[data-nav-dashboard]", label: "Dashboard", icon: "home" },
  obras: { selector: "[data-nav-obras]", label: "Listagem", icon: "format_list_bulleted" },
  planeamento: { selector: "[data-nav-planeamento]", label: "Planeamento", icon: "event_note" },
  cotacao: { selector: "[data-nav-cotacao]", label: "Cotação", icon: "request_quote" },
  logistica: { selector: "[data-nav-logistics], [data-nav-logistica]", label: "Logística", icon: "inventory_2" },
  centros: { selector: "[data-nav-centros]", label: "Centro de Compras", icon: "calendar_month" },
  financeiro: { selector: "[data-nav-financeiro]", label: "Financeiro", icon: "bar_chart" },
  clientes: { selector: "[data-nav-clientes]", label: "Clientes", icon: "person" },
  users: { selector: "[data-nav-users]", label: "Definições", icon: "settings" },
};

function getTopNav() {
  return document.querySelector("body > nav.fixed, body > nav[class*='fixed']");
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

function cloneSidebarLink(link, { label, icon }) {
  if (!link) return null;
  const item = link.cloneNode(true);
  item.className = "app-sidebar-link";
  item.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span><span>${label}</span>`;
  item.removeAttribute("id");
  return item;
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

function isSidebarLinkActive(link) {
  if (currentPathMatches(link.getAttribute("href"))) return true;

  const current = window.location.pathname.toLowerCase();
  // Detail pages belong to Obras even though their URL is not the listing URL.
  return link.matches("[data-nav-obras]")
    && current.includes("/projectos/")
    && !current.includes("/projectos/centrocustos")
    && !current.includes("/projectos/cotacao");
}

function setActiveState(sidebar = document.getElementById("appPrimarySidebar")) {
  if (!sidebar) return;
  sidebar.querySelectorAll(".app-sidebar-link").forEach((link) => {
    link.classList.toggle("is-active", isSidebarLinkActive(link));
  });
  sidebar.querySelectorAll(".app-sidebar-group").forEach((group) => {
    const active = Boolean(group.querySelector(".app-sidebar-link.is-active"));
    group.classList.toggle("has-active-link", active);
    if (active) group.open = true;
  });
}

function syncGroupVisibility(sidebar = document.getElementById("appPrimarySidebar")) {
  if (!sidebar) return;
  sidebar.querySelectorAll(".app-sidebar-group, .app-sidebar-section").forEach((section) => {
    const links = [...section.querySelectorAll(".app-sidebar-link")];
    if (links.length) section.classList.toggle("hidden", !links.some((link) => !link.classList.contains("hidden")));
  });
}

function createSection(title, content) {
  const section = document.createElement("section");
  section.className = "app-sidebar-section";
  const heading = document.createElement("p");
  heading.className = "app-sidebar-section-title";
  heading.textContent = title;
  section.append(heading, content);
  return section;
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

/** Builds the shared desktop sidebar, retaining each original data-nav-* link. */
export function transformDesktopNavToDropdowns() {
  const source = getDesktopNavLinksContainer();
  const nav = getTopNav();
  // Screens that already have a task-specific desktop sidebar (admin, project
  // selector and purchase centre) keep their dedicated working area intact.
  if (!source || !nav || document.getElementById("appPrimarySidebar") || document.querySelector(".admin-sidebar, #sidebar, .cc-sidebar")) return;

  const links = Object.fromEntries(Object.entries(NAV_LINKS).map(([key, definition]) => [key, getLink(source, definition)]));
  const item = (key) => cloneSidebarLink(links[key], NAV_LINKS[key]);

  const sidebar = document.createElement("aside");
  sidebar.id = "appPrimarySidebar";
  sidebar.className = "app-primary-sidebar";
  sidebar.setAttribute("aria-label", "Menu principal");
  sidebar.innerHTML = `<div class="app-sidebar-top"><span class="app-sidebar-caption">Principal</span><button class="app-sidebar-collapse" type="button" aria-label="Recolher menu" aria-expanded="true"><span class="material-symbols-outlined" aria-hidden="true">chevron_left</span></button></div>`;

  const primary = document.createElement("div");
  primary.className = "app-sidebar-links";
  const dashboard = item("dashboard");
  if (dashboard) primary.appendChild(dashboard);
  sidebar.appendChild(createSection("", primary));

  sidebar.appendChild(createGroup("Obras", "person", [item("obras"), item("planeamento"), item("cotacao")], { open: true }));

  const records = document.createElement("div");
  records.className = "app-sidebar-links";
  [item("logistica"), item("centros"), item("financeiro")].filter(Boolean).forEach((link) => records.appendChild(link));
  sidebar.appendChild(createSection("Registos", records));

  const analysis = document.createElement("div");
  analysis.className = "app-sidebar-links";
  [item("clientes"), item("users")].filter(Boolean).forEach((link) => analysis.appendChild(link));
  sidebar.appendChild(createSection("Análise", analysis));

  const footer = document.createElement("div");
  footer.className = "app-sidebar-footer";
  footer.innerHTML = `<button type="button" data-logout class="app-sidebar-logout"><span class="material-symbols-outlined" aria-hidden="true">logout</span><span>Terminar sessão</span></button>`;
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
  if (sidebarListenersBound) return;
  sidebarListenersBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".app-sidebar-group[open]").forEach((group) => {
      if (!group.classList.contains("has-active-link")) group.open = false;
    });
  });
}
