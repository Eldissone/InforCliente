const TRIGGER_BASE =
  "nav-dropdown-trigger text-sm font-semibold text-slate-400 hover:text-white transition-colors flex items-center gap-0.5 whitespace-nowrap";
const MENU_BASE =
  "nav-dropdown-menu absolute top-full left-0 mt-1.5 min-w-[12rem] py-1.5 bg-slate-900 border border-slate-700/80 rounded-xl shadow-xl shadow-black/30 z-[60]";
const ITEM_BASE =
  "block px-4 py-2.5 text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap";

function getDesktopNavLinksContainer() {
  const nav = document.querySelector("body > nav.fixed, body > nav[class*='fixed']");
  if (!nav) return null;
  const candidates = nav.querySelectorAll(".hidden.lg\\:flex.items-center");
  for (const el of candidates) {
    if (el.querySelector("[data-nav-dashboard], [data-nav-clientes], [data-nav-obras]")) {
      return el;
    }
  }
  return null;
}

function normalizeDropdownItem(link, fallbackLabel) {
  const a = link.cloneNode(true);
  const wasHidden = a.classList.contains("hidden");
  const label = (a.textContent || fallbackLabel || "").trim().replace(/\s+/g, " ");
  a.textContent = label || fallbackLabel;
  a.className = ITEM_BASE;
  if (wasHidden) a.classList.add("hidden");
  return a;
}

function isActiveNavLink(el) {
  if (!el) return false;
  const cls = el.className || "";
  return cls.includes("2afc8d") || cls.includes("#2afc8d");
}

function buildDropdown(label, links) {
  const visibleLinks = links.filter(Boolean);
  if (!visibleLinks.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "relative nav-dropdown shrink-0";
  wrap.setAttribute("data-nav-dropdown-group", label.toLowerCase());

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = TRIGGER_BASE;
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-haspopup", "true");
  trigger.innerHTML = `${label}<span class="material-symbols-outlined text-[18px] leading-none opacity-80" aria-hidden="true">expand_more</span>`;

  const menu = document.createElement("div");
  menu.className = MENU_BASE;
  menu.setAttribute("role", "menu");

  visibleLinks.forEach((link) => {
    menu.appendChild(normalizeDropdownItem(link, link.textContent?.trim()));
  });

  if (visibleLinks.some(isActiveNavLink)) {
    trigger.classList.remove("text-slate-400");
    trigger.classList.add("text-[#2afc8d]", "bg-[#2afc8d]/10", "px-3", "py-1.5", "rounded-lg");
  }

  wrap.appendChild(trigger);
  wrap.appendChild(menu);
  return wrap;
}

function insertDropdown(anchor, label, members) {
  const dropdown = buildDropdown(label, members);
  if (!dropdown || !anchor?.parentElement) return;
  anchor.replaceWith(dropdown);
  members.filter((m) => m && m !== anchor && m.isConnected).forEach((m) => m.remove());
}

/** Agrupa Obras, Logística e Financeiro em dropdowns no header desktop. */
export function transformDesktopNavToDropdowns() {
  const desktop = getDesktopNavLinksContainer();
  if (!desktop || desktop.dataset.navDropdownsReady === "1") return;

  const obras = desktop.querySelector("[data-nav-obras]");
  const planeamento = desktop.querySelector("[data-nav-planeamento]");
  const logistics = desktop.querySelector("[data-nav-logistics], [data-nav-logistica]");
  const cotacao = desktop.querySelector("[data-nav-cotacao]");
  const financeiro = desktop.querySelector("[data-nav-financeiro]");
  const centros = desktop.querySelector("[data-nav-centros]");

  if (obras) {
    insertDropdown(obras, "Obras", [obras, planeamento].filter(Boolean));
  }

  if (logistics) {
    insertDropdown(logistics, "Logística", [logistics, cotacao].filter(Boolean));
  } else if (cotacao?.isConnected && cotacao.parentElement === desktop) {
    cotacao.remove();
  }

  if (financeiro) {
    insertDropdown(financeiro, "Financeiro", [financeiro, centros].filter(Boolean));
  } else if (centros?.isConnected && centros.parentElement === desktop) {
    insertDropdown(centros, "Financeiro", [centros]);
  }

  desktop.dataset.navDropdownsReady = "1";
  markActiveDropdownTriggers();
}

export function markActiveDropdownTriggers() {
  const current = window.location.pathname.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  const hrefMatches = (href) => {
    if (!href || href === "#") return false;
    try {
      const linkPath = new URL(href, window.location.href).pathname.replace(/\/+$/, "").toLowerCase();
      return current === linkPath || current.endsWith(linkPath);
    } catch {
      return false;
    }
  };

  document.querySelectorAll("[data-nav-dropdown-group]").forEach((group) => {
    const trigger = group.querySelector(".nav-dropdown-trigger");
    const links = group.querySelectorAll(".nav-dropdown-menu a[href]");
    let active = false;
    links.forEach((a) => {
      if (!hrefMatches(a.getAttribute("href"))) return;
      active = true;
      a.classList.remove("text-slate-300");
      a.classList.add("text-[#2afc8d]", "bg-[#2afc8d]/10");
    });
    if (!trigger) return;
    if (active) {
      trigger.classList.remove("text-slate-400");
      trigger.classList.add("text-[#2afc8d]", "bg-[#2afc8d]/10", "px-3", "py-1.5", "rounded-lg");
    }
  });
}

/** Oculta grupos dropdown quando todos os filhos estão ocultos por permissão. */
export function syncNavDropdownGroups() {
  document.querySelectorAll("[data-nav-dropdown-group]").forEach((group) => {
    const items = group.querySelectorAll(".nav-dropdown-menu a");
    const anyVisible = [...items].some((a) => !a.classList.contains("hidden"));
    group.classList.toggle("hidden", !anyVisible);
  });
  markActiveDropdownTriggers();
}

let dropdownListenersBound = false;

export function initAppNavDropdowns() {
  if (dropdownListenersBound) return;
  dropdownListenersBound = true;

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".nav-dropdown-trigger");
    const group = e.target.closest(".nav-dropdown");

    if (trigger && group) {
      e.preventDefault();
      const open = group.classList.contains("nav-dropdown-open");
      document.querySelectorAll(".nav-dropdown-open").forEach((g) => {
        g.classList.remove("nav-dropdown-open");
        g.querySelector(".nav-dropdown-trigger")?.setAttribute("aria-expanded", "false");
      });
      if (!open) {
        group.classList.add("nav-dropdown-open");
        trigger.setAttribute("aria-expanded", "true");
      }
      return;
    }

    if (!e.target.closest(".nav-dropdown-menu")) {
      document.querySelectorAll(".nav-dropdown-open").forEach((g) => {
        g.classList.remove("nav-dropdown-open");
        g.querySelector(".nav-dropdown-trigger")?.setAttribute("aria-expanded", "false");
      });
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".nav-dropdown-open").forEach((g) => {
        g.classList.remove("nav-dropdown-open");
        g.querySelector(".nav-dropdown-trigger")?.setAttribute("aria-expanded", "false");
      });
    }
  });
}
