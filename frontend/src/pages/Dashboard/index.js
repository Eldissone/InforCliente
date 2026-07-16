import { apiRequest, getApiBaseUrl, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, setText, toast, setButtonLoading, renderLoadingRow, initMobileMenu } from "../../shared/ui.js";
import { guardPageAccess, initPermissionLayer } from "../../shared/permissions.js";

// Verifica se tem sessão — roles são geridas pelas permissões do servidor
checkAuth();
import { formatCompactNumber, formatPercent, formatCurrency } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

// Chart instance holders for dynamic animated updates
let clientsChart = null;
let billingChart = null;
let obrasProgressChart = null;
let projectsChart = null;

function byId(id) {
  return document.getElementById(id);
}

function statusPill(status) {
  if (status === "AT_RISK" || status === "ON_HOLD") {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100 shadow-sm">
      <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> PARADA
    </span>`;
  }
  if (status === "INACTIVE" || status === "COMPLETED") {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold border border-slate-200 shadow-sm">
      <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> CONCLUÍDA
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100 shadow-sm">
    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> EM CURSO
  </span>`;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("") || "—";
}

function renderObraRow(p) {
  const progress = Math.max(0, Math.min(100, Number(p.physicalProgressPct || 0)));
  let progressColor = "bg-emerald-500";
  if (progress < 30) progressColor = "bg-red-500";
  else if (progress < 65) progressColor = "bg-amber-500";

  const currency = String(p.currency || "AOA").toUpperCase();
  const valor = formatCurrency(p.budgetTotal, currency);
  const clientName = p.client?.name || "—";

  return `
    <tr class="hover:bg-slate-50/50 transition-all duration-200 group border-b border-slate-100 last:border-0">
      <td class="px-8 py-5">
        <div class="flex items-center gap-4">
          <div class="h-11 w-11 rounded-2xl bg-slate-900 flex items-center justify-center font-extrabold text-[#2afc8d] shadow-lg shadow-black/10 group-hover:scale-105 transition-transform text-sm">
            ${initials(p.name)}
          </div>
          <div>
            <div class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">${p.name}</div>
            <div class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">${p.code} &bull; ${clientName}</div>
          </div>
        </div>
      </td>
      <td class="px-8 py-5">${statusPill(p.status)}</td>
      <td class="px-8 py-5 text-sm font-bold text-slate-900 text-right">${valor}</td>
      <td class="px-8 py-5">
        <div class="flex items-center justify-center gap-3">
          <div class="flex-1 h-2 bg-slate-100 rounded-full w-24 overflow-hidden shadow-inner border border-slate-200/50">
            <div class="h-full ${progressColor} rounded-full transition-all duration-1000" style="width:${progress}%"></div>
          </div>
          <span class="text-xs font-bold text-slate-700 w-8 text-right">${progress}%</span>
        </div>
      </td>
      <td class="px-8 py-5 text-right">
        <button data-open-obra="${p.id}" class="ml-auto h-10 w-10 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-slate-900 hover:border-slate-300 hover:shadow-md transition-all active:scale-90">
          <span class="material-symbols-outlined text-xl">east</span>
        </button>
      </td>
    </tr>
  `;
}

async function loadKpis({ search = "" } = {}) {
  const kpiTotal = byId("kpiTotalClients");
  const kpiValue = byId("kpiPortfolioValue");
  const kpiEstimated = byId("kpiEstimatedBilling");
  const kpiObrasProgress = byId("kpiObrasProgress");
  const kpiObras = byId("kpiTotalObras");
  const kpiHealth = byId("kpiAvgHealth");
  const kpiHealthBar = byId("kpiAvgHealthBar");

  let url = `/dashboard/metrics?search=${encodeURIComponent(search)}`;
  if (currentProjectStatusFilter) url += `&projectStatus=${encodeURIComponent(currentProjectStatusFilter)}`;
  if (currentTaskStatusFilter) url += `&taskStatus=${encodeURIComponent(currentTaskStatusFilter)}`;

  const data = await apiRequest(url);

  setText(kpiTotal, formatCompactNumber(data.totalClients));
  setText(kpiValue, formatCurrency(data.portfolioValue, "AOA"));
  setText(kpiEstimated, formatCurrency(data.faturacaoEstimada, "AOA"));
  const avancoMedio = Number(data.obras?.avancoMedio ?? 0);
  setText(kpiObrasProgress, `${avancoMedio}%`);
  setText(kpiObras, formatCompactNumber(data.obras?.total || 0));
  setText(kpiHealth, `${data.avgHealth || 0}%`);

  if (kpiHealthBar) kpiHealthBar.style.width = `${Math.max(0, Math.min(100, data.avgHealth || 0))}%`;

  // Draw or update dynamic ApexCharts
  if (data.clientesStatus) renderClientsStatusChart(data.clientesStatus);
  renderBillingHistoryChart(Number(data.portfolioValue) || 0, Number(data.faturacaoEstimada) || 0);
  if (data.obras) renderObrasProgressChart(data.obras.avancoMedio ?? 0);
  if (data.obras) renderProjectsBarChart(data.obras);
}

// Chart 1: Clients Status Donut
function renderClientsStatusChart(statusData) {
  const active = statusData.ativas || 0;
  const risk = statusData.em_risco || 0;
  const inactive = statusData.inativas || 0;

  const options = {
    series: [active, risk, inactive],
    chart: {
      type: 'donut',
      height: 180,
      sparkline: { enabled: true },
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
    },
    colors: ["#10B981", "#F59E0B", "#94A3B8"],
    stroke: { show: false },
    plotOptions: {
      pie: {
        donut: {
          size: '75%',
          background: 'transparent',
          labels: {
            show: true,
            name: { show: false },
            value: {
              show: true,
              fontSize: '18px',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 800,
              color: '#0f172a',
              offsetY: 6,
              formatter: (val) => val
            },
            total: {
              show: true,
              showAlways: true,
              fontSize: '18px',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 800,
              color: '#0f172a',
              formatter: function (w) {
                return w.globals.seriesTotals.reduce((a, b) => a + b, 0);
              }
            }
          }
        }
      }
    },
    legend: { show: false },
    tooltip: {
      y: {
        formatter: (val) => `${val} Clientes`
      }
    }
  };

  const container = byId("clientsStatusChart");
  if (!container) return;

  if (clientsChart) {
    clientsChart.updateSeries([active, risk, inactive]);
  } else {
    clientsChart = new ApexCharts(container, options);
    clientsChart.render();
  }
}

// Chart 2: Billing comparison Area curve
function renderBillingHistoryChart(valReal, valEst) {
  const options = {
    series: [
      {
        name: "Realizada",
        data: [0, Math.round(valReal * 0.4), Math.round(valReal * 0.8), valReal]
      },
      {
        name: "Em Obras",
        data: [0, Math.round(valEst * 0.35), Math.round(valEst * 0.75), valEst]
      }
    ],
    chart: {
      type: 'area',
      height: 140,
      sparkline: { enabled: true },
      toolbar: { show: false },
      animations: { enabled: true, easing: 'easeinout', speed: 800 }
    },
    colors: ["#10B981", "#06B6D4"],
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.25,
        opacityTo: 0.02,
        stops: [0, 90, 100]
      }
    },
    stroke: {
      curve: 'smooth',
      width: 2
    },
    tooltip: {
      x: { show: false },
      y: {
        formatter: (val) => formatCurrency(val, "AOA")
      }
    }
  };

  const container = byId("billingHistoryChart");
  if (!container) return;

  if (billingChart) {
    billingChart.updateSeries([
      {
        name: "",
        data: [0, Math.round(valReal * 0.4), Math.round(valReal * 0.8), valReal]
      },
      {
        name: "",
        data: [0, Math.round(valEst * 0.35), Math.round(valEst * 0.75), valEst]
      }
    ]);
  } else {
    billingChart = new ApexCharts(container, options);
    billingChart.render();
  }
}

// Chart 3: Avanço geral das obras (radial com % no centro)
function progressChartColor(pct) {
  if (pct < 30) return "#EF4444";
  if (pct < 65) return "#F59E0B";
  return "#10B981";
}

function renderObrasProgressChart(avancoMedio) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(avancoMedio) || 0)));
  const color = progressChartColor(pct);

  const options = {
    series: [pct],
    chart: {
      type: "radialBar",
      height: 200,
      sparkline: { enabled: true },
      animations: { enabled: true, easing: "easeinout", speed: 800 },
    },
    colors: [color],
    plotOptions: {
      radialBar: {
        startAngle: -135,
        endAngle: 135,
        hollow: {
          size: "62%",
          background: "transparent",
        },
        track: {
          background: "rgba(15, 23, 42, 0.06)",
          strokeWidth: "100%",
        },
        dataLabels: {
          name: {
            show: true,
            offsetY: -6,
            fontSize: "10px",
            fontFamily: "Outfit, sans-serif",
            fontWeight: 700,
            color: "#64748b",
            formatter: () => "Avanço",
          },
          value: {
            show: true,
            offsetY: 8,
            fontSize: "26px",
            fontFamily: "Outfit, sans-serif",
            fontWeight: 800,
            color: "#0f172a",
            formatter: (val) => `${Math.round(val)}%`,
          },
        },
      },
    },
    stroke: { lineCap: "round" },
    labels: ["Avanço geral"],
    legend: { show: false },
    tooltip: {
      enabled: true,
      y: {
        formatter: () => `Média de progresso físico: ${pct}%`,
      },
    },
  };

  const container = byId("obrasProgressChart");
  if (!container) return;

  if (obrasProgressChart) {
    obrasProgressChart.updateOptions({
      colors: [color],
      plotOptions: options.plotOptions,
    });
    obrasProgressChart.updateSeries([pct]);
  } else {
    obrasProgressChart = new ApexCharts(container, options);
    obrasProgressChart.render();
  }
}

// Chart 4: Vertical column project count metrics
const OBRAS_BAR_COLORS = ["#10B981", "#F59E0B", "#94A3B8"]; // Em curso, Pausadas, Concluídas

function renderProjectsBarChart(obras) {
  const active = obras.ativas || 0;
  const paused = obras.pausadas || 0;
  const completed = obras.concluidas || 0;

  const options = {
    series: [{
      name: "Obras",
      data: [active, paused, completed]
    }],
    chart: {
      type: 'bar',
      height: 160,
      toolbar: { show: false },
      sparkline: { enabled: true },
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      events: {
        dataPointSelection: (event, chartContext, config) => {
          const projectStatuses = ["ACTIVE", "ON_HOLD", "COMPLETED"];
          const projectStatus = projectStatuses[config.dataPointIndex];
          if (projectStatus) {
            toggleProjectStatusFilter(projectStatus);
          }
        }
      }
    },
    colors: OBRAS_BAR_COLORS,
    plotOptions: {
      bar: {
        columnWidth: '55%',
        borderRadius: 6,
        distributed: true,
        dataLabels: { position: 'top' },
      },
    },
    dataLabels: {
      enabled: true,
      formatter: (val) => val,
      offsetY: -20,
      style: {
        fontSize: '11px',
        fontFamily: 'Outfit, sans-serif',
        fontWeight: 700,
        colors: ["#0f172a"]
      }
    },
    legend: { show: false },
    xaxis: {
      categories: ["Em Curso", "Pausadas", "Concluídas"],
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: { show: false }
  };

  const container = byId("projectsBarChart");
  if (!container) return;

  if (projectsChart) {
    projectsChart.updateOptions({ colors: OBRAS_BAR_COLORS });
    projectsChart.updateSeries([{
      name: "Obras",
      data: [active, paused, completed],
    }]);
  } else {
    projectsChart = new ApexCharts(container, options);
    projectsChart.render();
  }
}

let lastSearch = "";
let searchTimer = null;

// Filtros de obras: por estado de obra e por estado de tarefa
let currentProjectStatusFilter = null;
let currentTaskStatusFilter = null;

function toggleProjectStatusFilter(projStatus) {
  currentProjectStatusFilter = currentProjectStatusFilter === projStatus ? null : projStatus;
  refreshClientsGrid();
}

function toggleTaskStatusFilter(taskStatus) {
  currentTaskStatusFilter = currentTaskStatusFilter === taskStatus ? null : taskStatus;
  refreshClientsGrid();
}

async function refreshClientsGrid() {
  const search = byId("clientMatrixFilter")?.value?.trim() || "";
  try {
    await Promise.all([
      loadKpis({ search }),
      loadObrasMatrix({ search })
    ]);
  } catch (err) {
    console.error(err);
    toast("Erro ao filtrar dados", { type: "error" });
  }
}

function updateFiltersUI() {
  const container = byId("activeFiltersContainer");
  if (!container) return;

  container.innerHTML = "";
  let hasFilters = false;

  const createBadge = (label, colorClass, onRemove) => {
    hasFilters = true;
    const badge = document.createElement("div");
    badge.className = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold border shadow-sm ${colorClass}`;
    badge.innerHTML = `
      <span>${label}</span>
      <button class="hover:text-red-600 transition-colors flex items-center justify-center pointer-events-auto ml-1.5">
        <span class="material-symbols-outlined text-xs font-black">close</span>
      </button>
    `;
    badge.querySelector("button").addEventListener("click", onRemove);
    container.appendChild(badge);
  };

  // Filtro: Estado da Obra (clique no gráfico de barras)
  if (currentProjectStatusFilter) {
    const labels = { ACTIVE: "Obras em Curso", ON_HOLD: "Obras Paradas", COMPLETED: "Obras Concluídas" };
    const classes = { ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-100", ON_HOLD: "bg-amber-50 text-amber-700 border-amber-100", COMPLETED: "bg-slate-50 text-slate-600 border-slate-200" };
    createBadge(labels[currentProjectStatusFilter], classes[currentProjectStatusFilter] || "bg-cyan-50 text-cyan-700 border-cyan-100", () => {
      currentProjectStatusFilter = null;
      refreshClientsGrid();
    });
  }

  // Filtro: Estado de Tarefas (clique no gráfico radial)
  if (currentTaskStatusFilter) {
    const labels = { PENDING: "Tarefas Pendentes", IN_PROGRESS: "Tarefas Em Curso", COMPLETED: "Tarefas Executadas" };
    createBadge(labels[currentTaskStatusFilter], "bg-indigo-50 text-indigo-700 border-indigo-100", () => {
      currentTaskStatusFilter = null;
      refreshClientsGrid();
    });
  }

  if (hasFilters) {
    container.classList.remove("hidden");
    const clearAllBtn = document.createElement("button");
    clearAllBtn.className = "text-[9px] font-black text-red-500 hover:text-red-700 transition-colors ml-3 uppercase tracking-widest";
    clearAllBtn.textContent = "Limpar Filtros";
    clearAllBtn.addEventListener("click", () => {
      currentProjectStatusFilter = null;
      currentTaskStatusFilter = null;
      refreshClientsGrid();
    });
    container.appendChild(clearAllBtn);
  } else {
    container.classList.add("hidden");
  }
}

async function loadObrasMatrix({ search = "" } = {}) {
  const body = byId("clientMatrixBody");
  if (!body) return;
  body.innerHTML = renderLoadingRow(5);

  let url = `/projects?search=${encodeURIComponent(search)}&page=1&pageSize=15&sort=updatedAt_desc`;
  if (currentProjectStatusFilter) url += `&status=${encodeURIComponent(currentProjectStatusFilter)}`;

  const data = await apiRequest(url);
  updateFiltersUI();

  if (!data.items?.length) {
    body.innerHTML = `<tr><td class="px-8 py-8 text-center text-sm font-bold text-slate-400" colspan="5">Nenhuma obra encontrada.</td></tr>`;
    return;
  }

  body.innerHTML = data.items.map(renderObraRow).join("");
}

function wireClientMatrixActions() {
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-open-obra]");
    const id = btn?.getAttribute?.("data-open-obra");
    if (!id) return;
    window.location.href = `../Projectos/ProjectGeral.html?id=${encodeURIComponent(id)}`;
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
      refreshClientsGrid().catch(() => toast("Erro ao carregar clientes", { type: "error" }));
    }, 250);
  });
}

function wireSync() {
  const syncBtn = byId("syncBtn");
  const syncIcon = byId("syncIcon");
  if (!syncBtn) return;

  syncBtn.addEventListener("click", async () => {
    try {
      if (syncIcon) {
        syncIcon.classList.add("animate-spin");
      }
      syncBtn.disabled = true;

      await refreshClientsGrid();

      toast("Dados sincronizados com sucesso", { type: "success" });
    } catch (err) {
      console.error(err);
      toast("Erro ao sincronizar dados", { type: "error" });
    } finally {
      if (syncIcon) {
        syncIcon.classList.remove("animate-spin");
      }
      syncBtn.disabled = false;
    }
  });
}

function wireAddClient() {
  const addBtn = byId("addClientBtn");
  if (!addBtn) return;

  addBtn.addEventListener("click", () => {
    window.location.href = "../Clientes/clienteLista.html";
  });
}

function loadSessionGreeting() {
  const user = JSON.parse(localStorage.getItem("InfoCliente.user") || "{}");
  if (user && user.name) {
    const greetLabel = byId("userNameLabel");
    if (greetLabel) {
      greetLabel.textContent = user.name.split(" ")[0]; // Greet by first name
    }
  }
}

async function init() {
  // Verificar permissão dinâmica — qualquer perfil com acesso ao dashboard pode entrar
  const ok = await guardPageAccess("navlinks", "nav_dashboard");
  if (!ok) return;

  initMobileMenu();
  wireLogout();
  wireUsersNav();
  await initPermissionLayer();
  loadSessionGreeting();
  await refreshClientsGrid();
  wireClientMatrixActions();
  wireFilter();
  wireSync();
  wireAddClient();
}


init().catch((err) => toast(err.message || "Falha ao carregar Dashboard. Verifique login/API.", { type: "error" }));
