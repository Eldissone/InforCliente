import { apiRequest, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, setText, toast, setButtonLoading, renderLoadingRow, initMobileMenu } from "../../shared/ui.js";

checkAuth({ allowedRoles: ["admin", "operador", "leitura"] });
import { formatCurrency, formatPercent, formatDateBR, getExchangeRate } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

function el(id) {
  return document.getElementById(id);
}

function getClientId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function timelineDotColor(type) {
  if (String(type).toLowerCase().includes("support")) return "border-primary-container";
  if (String(type).toLowerCase().includes("upgrade")) return "border-primary-container";
  return "border-[#2afc8d]";
}

function renderLinkedProjectCard(project, exchangeRate) {
  const progress = Math.max(0, Math.min(100, Number(project.physicalProgressPct || 0)));
  const primaryCurrency = project.currency || "AOA";
  const secondaryCurrency = primaryCurrency === "USD" ? "AOA" : "USD";
  const total = Number(project.budgetTotal || 0);
  const convertedTotal = primaryCurrency === "USD" ? total * exchangeRate : total / exchangeRate;

  return `
    <article class="p-6 rounded-[32px] bg-white border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-900/5 transition-all duration-300 group">
      <div class="flex items-start justify-between gap-4 mb-6">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-[#2afc8d] shadow-lg shadow-black/10 group-hover:scale-105 transition-transform">
            <span class="material-symbols-outlined text-xl">construction</span>
          </div>
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-[#0d3fd1]">${project.code}</div>
            <h4 class="text-lg font-bold text-slate-900 leading-tight">${project.name}</h4>
          </div>
        </div>
        <button data-open-project="${project.id}" class="h-10 px-5 rounded-xl bg-slate-50 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-900 hover:text-[#2afc8d] transition-all">
          Detalhes
        </button>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="p-3 rounded-2xl bg-slate-50 border border-slate-100/50">
          <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Orçamento</p>
          <p class="text-xs font-bold text-slate-900">${formatCurrency(total, primaryCurrency)}</p>
          <p class="text-[10px] font-bold text-slate-400 mt-0.5">${formatCurrency(convertedTotal, secondaryCurrency)}</p>
        </div>
        <div class="p-3 rounded-2xl bg-slate-50 border border-slate-100/50">
          <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Início</p>
          <p class="text-xs font-bold text-slate-700">${formatDateBR(project.startDate)}</p>
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
          <span>Progresso Físico</span>
          <span class="text-slate-900">${formatPercent(progress, { digits: 0 })}</span>
        </div>
        <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div class="h-full bg-emerald-500 rounded-full transition-all duration-1000" style="width:${progress}%"></div>
        </div>
      </div>
    </article>
  `;
}

function renderClientProjects(projects, exchangeRate) {
  const host = el("clientProjects");
  const count = el("clientProjectsCount");
  if (!host || !count) return;

  count.textContent = `${projects.length} ${projects.length === 1 ? "obra" : "obras"}`;
  if (!projects.length) {
    host.innerHTML = `<div class="rounded-2xl border border-dashed border-outline-variant bg-surface-container-low px-6 py-8 text-sm text-on-surface-variant">Nenhuma obra vinculada a este cliente.</div>`;
    return;
  }

  host.innerHTML = projects.map(p => renderLinkedProjectCard(p, exchangeRate)).join("");
}

function renderTimelineItem(item) {
  const isPriority = String(item.type).toLowerCase().includes("support") || String(item.type).toLowerCase().includes("upgrade");
  return `
    <div class="relative pl-6 border-l-2 ${isPriority ? 'border-blue-200' : 'border-slate-200'} group pb-8 last:pb-0">
      <div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-4 ${isPriority ? 'border-blue-600' : 'border-[#2afc8d]'} group-hover:scale-125 transition-transform duration-300 shadow-sm"></div>
      <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">${formatDateBR(item.occurredAt)}</span>
      <h4 class="font-bold text-slate-900 text-sm mb-1 leading-tight">${item.title}</h4>
      <p class="text-xs text-slate-500 mb-3 leading-relaxed">${item.description || ""}</p>
      ${
        item.leadName
          ? `<div class="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 w-fit">
               <span class="material-symbols-outlined text-xs text-slate-400">person</span>
               <span class="text-[10px] font-bold text-slate-500">${item.leadName}</span>
             </div>`
          : ""
      }
    </div>
  `;
}

async function loadClient() {
  const id = getClientId();
  if (!id) throw new Error("missing id");

  const data = await apiRequest(`/clients/${encodeURIComponent(id)}`);
  const c = data.client;

  setText(el("clientName"), c.name);
  setText(el("clientBreadcrumb"), c.name);
  setText(el("clientCode"), `ID: ${c.code}`);
  if (c.profilePic) {
    const imgEl = el("clientProfilePic");
    if (imgEl) {
      imgEl.src = getAssetUrl(c.profilePic);
      imgEl.classList.remove("grayscale"); // Optional: remove grayscale if it's a custom photo
    }
  }

  setText(el("clientLocationTier"), `${c.region || "Região não informada"} • ${c.tier || "Perfil Info Cliente"}`);
  setText(el("clientAccountEmail"), c.accountEmail || "Sem conta vinculada");

  const statusBadgeEl = el("clientStatusBadge");
  if (statusBadgeEl) {
    const s = c.status || "ACTIVE";
    const labels = { ACTIVE: "Ativo", AT_RISK: "Em Risco", INACTIVE: "Inativo" };
    const styles = {
      ACTIVE: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100", dot: "bg-emerald-500 animate-pulse" },
      AT_RISK: { bg: "bg-red-50", text: "text-red-700", border: "border-red-100", dot: "bg-red-500" },
      INACTIVE: { bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-100", dot: "bg-slate-400" }
    };
    const current = styles[s] || styles.ACTIVE;
    statusBadgeEl.className = `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${current.bg} ${current.text} border ${current.border}`;
    statusBadgeEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${current.dot}"></span> ${labels[s]}`;
  }

  const tagsHost = el("clientTags");
  if (tagsHost) {
    const industryTag = c.industry ? `<span class="px-3 py-1 rounded-xl bg-slate-900 text-[#2afc8d] text-[10px] font-black uppercase tracking-widest shadow-lg shadow-black/10">${c.industry}</span>` : "";
    const otherTags = (c.tags || []).map(t => `<span class="px-3 py-1 rounded-xl bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest">${t}</span>`).join("");
    tagsHost.innerHTML = industryTag + otherTags;
  }

  const exchangeRate = await getExchangeRate();
  renderClientProjects(c.projects || [], exchangeRate);

  return c;
}

function wireProjectLinks() {
  document.addEventListener("click", (e) => {
    const id = e.target?.closest?.("[data-open-project]")?.getAttribute?.("data-open-project");
    if (!id) return;
    window.location.href = `../Projectos/projectView.html?id=${encodeURIComponent(id)}`;
  });
}

async function init() {
  initMobileMenu();
  wireLogout();
  wireUsersNav();
  wireProjectLinks();
  await loadClient();
}

init().catch((err) => toast(err.message || "Falha ao carregar cliente. Verifique login/API.", { type: "error" }));
