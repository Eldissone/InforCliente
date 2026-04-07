import { apiRequest } from "../../services/api.js";
import { openModal, setText, toast } from "../../shared/ui.js";
import { formatCompactNumber, formatPercent } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

function byId(id) {
  return document.getElementById(id);
}

function statusPill(status) {
  if (status === "AT_RISK") {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error-container text-on-error-container text-[10px] font-bold">
      <span class="w-1.5 h-1.5 rounded-full bg-error"></span> EM_RISCO
    </span>`;
  }
  if (status === "INACTIVE") {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant text-[10px] font-bold">
      <span class="w-1.5 h-1.5 rounded-full bg-outline"></span> INATIVO
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-[10px] font-bold">
    <span class="w-1.5 h-1.5 rounded-full bg-[#2afc8d] high-voltage-glow"></span> ATIVO
  </span>`;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("") || "—";
}

function renderClientRow(c) {
  const health = Math.max(0, Math.min(100, Number(c.healthScore || 0)));
  const healthBarColor = c.status === "AT_RISK" ? "bg-error" : "bg-[#2afc8d]";
  return `
    <tr class="hover:bg-surface-container-low/30 transition-colors group">
      <td class="px-6 py-4">
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded bg-surface-container flex items-center justify-center font-bold text-primary">
            ${initials(c.name)}
          </div>
          <div>
            <div class="text-sm font-bold text-on-surface">${c.name}</div>
            <div class="text-[11px] text-on-surface-variant">${c.industry || c.code}</div>
          </div>
        </div>
      </td>
      <td class="px-6 py-4">${statusPill(c.status)}</td>
      <td class="px-6 py-4 text-sm font-semibold text-on-surface text-right">${formatCompactNumber(
        c.ltvTotal
      )}</td>
      <td class="px-6 py-4">
        <div class="flex items-center gap-2">
          <div class="flex-1 h-1.5 bg-surface-container rounded-full max-w-[80px]">
            <div class="h-full ${healthBarColor} rounded-full" style="width:${health}%"></div>
          </div>
          <span class="text-[11px] font-bold text-on-surface">${health}</span>
        </div>
      </td>
      <td class="px-6 py-4 text-right">
        <button data-open-client="${c.id}" class="text-on-surface-variant hover:text-primary transition-colors" title="Abrir cliente">
          <span class="material-symbols-outlined text-xl" data-icon="arrow_forward">arrow_forward</span>
        </button>
      </td>
    </tr>
  `;
}

async function loadKpis() {
  const kpiTotal = byId("kpiTotalClients");
  const kpiValue = byId("kpiPortfolioValue");
  const kpiHealth = byId("kpiAvgHealth");
  const kpiHealthBar = byId("kpiAvgHealthBar");

  const data = await apiRequest("/dashboard/metrics");
  setText(kpiTotal, formatCompactNumber(data.totalClients));
  setText(kpiValue, formatCompactNumber(data.portfolioValue));
  setText(kpiHealth, formatPercent(data.avgHealth, { digits: 0 }));
  if (kpiHealthBar) kpiHealthBar.style.width = `${Math.max(0, Math.min(100, data.avgHealth))}%`;
}

let lastSearch = "";
let searchTimer = null;

async function loadClientMatrix({ search = "" } = {}) {
  const body = byId("clientMatrixBody");
  if (!body) return;
  body.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="5">Carregando...</td></tr>`;

  const data = await apiRequest(`/dashboard/clients?search=${encodeURIComponent(search)}&page=1&pageSize=10`);
  if (!data.items?.length) {
    body.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="5">Nenhum cliente encontrado.</td></tr>`;
    return;
  }

  body.innerHTML = data.items.map(renderClientRow).join("");
}

function wireClientMatrixActions() {
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-open-client]");
    const id = btn?.getAttribute?.("data-open-client");
    if (!id) return;
    window.location.href = `../ClienteDetalhe/client.html?id=${encodeURIComponent(id)}`;
  });
}

function wireFilter() {
  const input = byId("clientMatrixFilter");
  if (!input) return;
  input.addEventListener("input", () => {
    const search = input.value.trim();
    if (search === lastSearch) return;
    lastSearch = search;
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      loadClientMatrix({ search }).catch(() => toast("Erro ao carregar clientes", { type: "error" }));
    }, 250);
  });
}

function wireAddClient() {
  const addBtn = Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.toLowerCase?.().includes("add new client")
  );
  if (!addBtn) return;

  addBtn.addEventListener("click", () => {
    openModal({
      title: "Adicionar cliente",
      primaryLabel: "Criar",
      contentHtml: `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Código</label>
            <input id="c_code" class="w-full rounded-lg border-slate-300" placeholder="NX-90210" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Nome</label>
            <input id="c_name" class="w-full rounded-lg border-slate-300" placeholder="Empresa X" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Indústria</label>
            <input id="c_industry" class="w-full rounded-lg border-slate-300" placeholder="Tecnologia" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Região</label>
            <input id="c_region" class="w-full rounded-lg border-slate-300" placeholder="Sudeste" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">LTV Total (kz)</label>
            <input id="c_ltv" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Risco churn (%)</label>
            <input id="c_churn" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Potencial 24m (kz)</label>
            <input id="c_potential" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Health (0-100)</label>
            <input id="c_health" type="number" min="0" max="100" class="w-full rounded-lg border-slate-300" value="50" />
          </div>
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const get = (id) => panel.querySelector(`#${id}`)?.value?.trim?.();
        const payload = {
          code: get("c_code"),
          name: get("c_name"),
          industry: get("c_industry") || null,
          region: get("c_region") || null,
          ltvTotal: Number(get("c_ltv") || 0),
          churnRisk: Number(get("c_churn") || 0),
          ltvPotential: Number(get("c_potential") || 0),
          healthScore: Number(get("c_health") || 50),
        };
        await apiRequest("/clients", { method: "POST", body: payload });
        toast("Cliente criado", { type: "success" });
        close();
        await loadKpis();
        await loadClientMatrix({ search: byId("clientMatrixFilter")?.value?.trim?.() || "" });
      },
    });
  });
}

async function init() {
  wireLogout();
  wireUsersNav();
  await loadKpis();
  await loadClientMatrix({ search: "" });
  wireClientMatrixActions();
  wireFilter();
  wireAddClient();
}

init().catch(() => toast("Falha ao carregar Dashboard. Verifique login/API.", { type: "error" }));

