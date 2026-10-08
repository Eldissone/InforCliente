/**
 * Cabeçalho único das páginas com data-shell="figma".
 * Edite este ficheiro para alterar a barra em todas essas páginas.
 */

const LINK = "text-sm font-semibold text-slate-400 hover:text-white transition-colors";
const MOBILE = "flex items-center gap-3 text-sm font-semibold text-slate-400 py-3 px-4 rounded-xl hover:bg-slate-800 transition-all";

function isDashboardPage() {
  const path = window.location.pathname.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return /\/dashboard(\/index)?$/.test(path);
}

function renderAppHeader() {
  const search = isDashboardPage()
    ? `<label class="shell-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input id="clientMatrixFilter" type="search" placeholder="Buscar obra" aria-label="Buscar obra por nome ou código" />
      </label>`
    : "";

  return `<nav class="app-top-nav fixed top-0 w-full z-50 bg-[#212e3e] border-b border-slate-800 transition-all duration-300" data-shared-header>
    <div class="max-w-[1500px] mx-auto px-4 md:px-8 h-16 flex justify-between items-center">
      <div class="flex items-center gap-10">
        <a href="/Dashboard" class="app-nav-brand text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <span class="app-nav-mark w-14 h-8 bg-[#2afc8d] rounded-lg flex items-center justify-center text-[#212e3e] font-black italic">Info</span>
          <span id="navBrandText">Gestor</span>
        </a>
        <div class="hidden lg:flex items-center gap-6">
          <a class="${LINK}" data-nav-dashboard href="/Dashboard">Dashboard</a>
          <a class="${LINK}" data-nav-clientes href="/Clientes/clienteLista">Clientes</a>
          <a class="${LINK}" data-nav-obras href="/Projectos/ProjectGeral">Obras</a>
          <a class="${LINK}" data-nav-logistics href="/Stock">Logística</a>
          <a class="${LINK}" data-nav-planeamento href="/Projectos/centroCustos">Planeamento</a>
          <a class="${LINK} hidden" data-nav-cotacao href="/Projectos/Cotacao">Cotação</a>
          <a class="${LINK} hidden" data-nav-centros href="/Financeiro/centroDeCompras">Centro de Compras</a>
        </div>
      </div>
      <div class="flex flex-1 items-center justify-end gap-3 min-w-0">
        ${search}
        <a data-nav-users class="hidden px-3 py-1.5 rounded-lg text-xs font-bold text-white/80 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2" href="/Users">
          <span class="material-symbols-outlined text-lg">manage_accounts</span>
          Gestão
        </a>
        <button data-user-profile class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-[#2afc8d] hover:bg-[#2afc8d]/10 transition-all" type="button">
          <span class="material-symbols-outlined text-sm">person</span>
          <span data-user-role></span>
        </button>
        <button data-logout class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-white/60 hover:text-white transition-all" type="button">Sair</button>
        <button id="mobileMenuBtn" aria-expanded="false" class="lg:hidden w-10 h-10 flex items-center justify-center rounded-xl bg-slate-800 text-slate-400 hover:text-white transition-colors" type="button">
          <span class="material-symbols-outlined">menu</span>
        </button>
      </div>
    </div>
    <div id="navMenu" class="hidden lg:hidden flex-col bg-[#212e3e] border-b border-slate-800 px-4 pb-6 gap-1">
      <a class="${MOBILE}" data-nav-dashboard href="/Dashboard"><span class="material-symbols-outlined text-lg">dashboard</span> Dashboard</a>
      <a class="${MOBILE}" data-nav-clientes href="/Clientes/clienteLista"><span class="material-symbols-outlined text-lg">group</span> Clientes</a>
      <a class="${MOBILE}" data-nav-obras href="/Projectos/ProjectGeral"><span class="material-symbols-outlined text-lg">construction</span> Obras</a>
      <a class="${MOBILE}" data-nav-logistics href="/Stock"><span class="material-symbols-outlined text-lg">inventory_2</span> Logística</a>
      <a class="${MOBILE}" data-nav-planeamento href="/Projectos/centroCustos"><span class="material-symbols-outlined text-lg">account_balance</span> Planeamento</a>
      <a class="${MOBILE} hidden" data-nav-cotacao href="/Projectos/Cotacao"><span class="material-symbols-outlined text-lg">request_quote</span> Cotação</a>
      <a class="${MOBILE} hidden" data-nav-centros href="/Financeiro/centroDeCompras"><span class="material-symbols-outlined text-lg">account_balance</span> Centro de Compras</a>
      <button data-logout class="flex items-center gap-3 text-left text-sm font-semibold text-red-400 py-3 px-4 rounded-xl hover:bg-red-400/10 transition-all mt-2" type="button">
        <span class="material-symbols-outlined text-lg">logout</span> Sair
      </button>
    </div>
  </nav>`;
}

export function mountAppHeader() {
  if (document.body?.dataset.shell !== "figma") return;
  if (document.querySelector("nav.app-top-nav[data-shared-header]")) return;

  const template = document.createElement("template");
  template.innerHTML = renderAppHeader().trim();
  const nav = template.content.firstElementChild;
  const existing = document.querySelector("body > nav.app-top-nav");
  const slot = document.getElementById("appHeader");
  if (existing) existing.replaceWith(nav);
  else if (slot) slot.replaceWith(nav);
  else document.body.prepend(nav);
}
