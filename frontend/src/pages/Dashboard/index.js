import { apiRequest, getApiBaseUrl, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, setText, toast, setButtonLoading, renderLoadingRow, initMobileMenu } from "../../shared/ui.js";

checkAuth({ allowedRoles: ["admin", "operador", "supervisor", "leitura", "user"] });
import { formatCompactNumber, formatPercent, formatCurrency } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

// Chart instance holders for dynamic animated updates
let clientsChart = null;
let billingChart = null;
let tasksChart = null;
let projectsChart = null;

function byId(id) {
  return document.getElementById(id);
}

function statusPill(status) {
  if (status === "AT_RISK") {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100 shadow-sm">
      <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> EM RISCO
    </span>`;
  }
  if (status === "INACTIVE") {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold border border-slate-200 shadow-sm">
      <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> INATIVO
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100 shadow-sm">
    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> ATIVO
  </span>`;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("") || "—";
}

function renderClientRow(c) {
  const health = Math.max(0, Math.min(100, Number(c.healthScore || 0)));
  let healthBarColor = "bg-emerald-500";
  if (health < 40) healthBarColor = "bg-red-500";
  else if (health < 70) healthBarColor = "bg-amber-500";
  
  const picUrl = getAssetUrl(c.profilePic);

  return `
    <tr class="hover:bg-slate-50/50 transition-all duration-200 group border-b border-slate-100 last:border-0">
      <td class="px-8 py-5">
        <div class="flex items-center gap-4">
          <div class="h-11 w-11 rounded-2xl bg-slate-900 flex items-center justify-center font-extrabold text-[#2afc8d] shadow-lg shadow-black/10 group-hover:scale-105 transition-transform overflow-hidden">
            ${picUrl ? `<img src="${picUrl}" alt="${c.name}" class="w-full h-full object-cover" />` : initials(c.name)}
          </div>
          <div>
            <div class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">${c.name}</div>
            <div class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">${c.industry || c.code}</div>
          </div>
        </div>
      </td>
      <td class="px-8 py-5">${statusPill(c.status)}</td>
      <td class="px-8 py-5 text-sm font-bold text-slate-900 text-right">${formatCurrency(c.ltvTotal, "AOA")}</td>
      <td class="px-8 py-5">
        <div class="flex items-center justify-center gap-3">
          <div class="flex-1 h-2 bg-slate-100 rounded-full w-24 overflow-hidden shadow-inner border border-slate-200/50">
            <div class="h-full ${healthBarColor} rounded-full transition-all duration-1000" style="width:${health}%"></div>
          </div>
          <span class="text-xs font-bold text-slate-700 w-8 text-right">${health}%</span>
        </div>
      </td>
      <td class="px-8 py-5 text-right">
        <button data-open-client="${c.id}" class="ml-auto h-10 w-10 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-slate-900 hover:border-slate-300 hover:shadow-md transition-all active:scale-90">
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
  const kpiTasks = byId("kpiTotalTasks");
  const kpiObras = byId("kpiTotalObras");
  const kpiHealth = byId("kpiAvgHealth");
  const kpiHealthBar = byId("kpiAvgHealthBar");

  let url = `/dashboard/metrics?search=${encodeURIComponent(search)}`;
  if (currentStatusFilter) url += `&status=${encodeURIComponent(currentStatusFilter)}`;
  if (currentProjectStatusFilter) url += `&projectStatus=${encodeURIComponent(currentProjectStatusFilter)}`;
  if (currentTaskStatusFilter) url += `&taskStatus=${encodeURIComponent(currentTaskStatusFilter)}`;

  const data = await apiRequest(url);
  
  setText(kpiTotal, formatCompactNumber(data.totalClients));
  setText(kpiValue, formatCurrency(data.portfolioValue, "AOA"));
  setText(kpiEstimated, formatCurrency(data.faturacaoEstimada, "AOA"));
  setText(kpiTasks, formatCompactNumber(data.tarefas?.total || 0));
  setText(kpiObras, formatCompactNumber(data.obras?.total || 0));
  setText(kpiHealth, `${data.avgHealth || 0}%`);
  
  if (kpiHealthBar) kpiHealthBar.style.width = `${Math.max(0, Math.min(100, data.avgHealth || 0))}%`;

  // Draw or update dynamic ApexCharts
  if (data.clientesStatus) renderClientsStatusChart(data.clientesStatus);
  renderBillingHistoryChart(Number(data.portfolioValue) || 0, Number(data.faturacaoEstimada) || 0);
  if (data.tarefas) renderTasksConcentricChart(data.tarefas);
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
      events: {
        dataPointSelection: (event, chartContext, config) => {
          const statuses = ["ACTIVE", "AT_RISK", "INACTIVE"];
          const status = statuses[config.dataPointIndex];
          if (status) {
            toggleStatusFilter(status);
          }
        }
      }
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
        name: "Realizada (LTV)",
        data: [0, Math.round(valReal * 0.4), Math.round(valReal * 0.8), valReal]
      },
      {
        name: "Estimada (Potencial)",
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
        name: "Realizada (LTV)",
        data: [0, Math.round(valReal * 0.4), Math.round(valReal * 0.8), valReal]
      },
      {
        name: "Estimada (Potencial)",
        data: [0, Math.round(valEst * 0.35), Math.round(valEst * 0.75), valEst]
      }
    ]);
  } else {
    billingChart = new ApexCharts(container, options);
    billingChart.render();
  }
}

// Chart 3: Radial concentric progress of tasks
function renderTasksConcentricChart(tarefas) {
  const total = tarefas.total || 0;
  const pctFeito = total ? Math.round((tarefas.executadas / total) * 100) : 0;
  const pctCurso = total ? Math.round((tarefas.em_curso / total) * 100) : 0;
  const pctPendente = total ? Math.round((tarefas.pendentes / total) * 100) : 0;

  const options = {
    series: [pctFeito, pctCurso, pctPendente],
    chart: {
      type: 'radialBar',
      height: 180,
      sparkline: { enabled: true },
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      events: {
        dataPointSelection: (event, chartContext, config) => {
          const taskStatuses = ["COMPLETED", "IN_PROGRESS", "PENDING"];
          const taskStatus = taskStatuses[config.dataPointIndex];
          if (taskStatus) {
            toggleTaskStatusFilter(taskStatus);
          }
        }
      }
    },
    plotOptions: {
      radialBar: {
        track: {
          background: 'rgba(15, 23, 42, 0.05)',
          strokeWidth: '97%'
        },
        dataLabels: {
          name: { show: false },
          value: {
            fontSize: '18px',
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 800,
            color: '#0f172a',
            offsetY: 6,
            formatter: (val) => `${val}%`
          }
        }
      }
    },
    colors: ["#10B981", "#06B6D4", "#F59E0B"],
    labels: ["Feito", "Em Curso", "Pendente"],
    legend: { show: false }
  };

  const container = byId("tasksConcentricChart");
  if (!container) return;

  if (tasksChart) {
    tasksChart.updateSeries([pctFeito, pctCurso, pctPendente]);
  } else {
    tasksChart = new ApexCharts(container, options);
    tasksChart.render();
  }
}

// Chart 4: Vertical column project count metrics
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
    colors: ["#10B981"],
    plotOptions: {
      bar: {
        columnWidth: '55%',
        borderRadius: 6,
        distributed: true,
        dataLabels: { position: 'top' }
      }
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
      categories: ["Ativas", "Pausadas", "Concluídas"],
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: { show: false }
  };

  const container = byId("projectsBarChart");
  if (!container) return;

  if (projectsChart) {
    projectsChart.updateSeries([{
      name: "Obras",
      data: [active, paused, completed]
    }]);
  } else {
    projectsChart = new ApexCharts(container, options);
    projectsChart.render();
  }
}

let lastSearch = "";
let searchTimer = null;

let currentStatusFilter = null;
let currentProjectStatusFilter = null;
let currentTaskStatusFilter = null;

function toggleStatusFilter(status) {
  if (currentStatusFilter === status) {
    currentStatusFilter = null;
  } else {
    currentStatusFilter = status;
  }
  refreshClientsGrid();
}

function toggleProjectStatusFilter(projStatus) {
  if (currentProjectStatusFilter === projStatus) {
    currentProjectStatusFilter = null;
  } else {
    currentProjectStatusFilter = projStatus;
  }
  refreshClientsGrid();
}

function toggleTaskStatusFilter(taskStatus) {
  if (currentTaskStatusFilter === taskStatus) {
    currentTaskStatusFilter = null;
  } else {
    currentTaskStatusFilter = taskStatus;
  }
  refreshClientsGrid();
}

async function refreshClientsGrid() {
  const search = byId("clientMatrixFilter")?.value?.trim() || "";
  try {
    await Promise.all([
      loadKpis({ search }),
      loadClientMatrix({ search })
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

  if (currentStatusFilter) {
    const labels = { ACTIVE: "Clientes Ativos", AT_RISK: "Clientes Em Risco", INACTIVE: "Clientes Inativos" };
    const classes = { ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-100", AT_RISK: "bg-amber-50 text-amber-700 border-amber-100", INACTIVE: "bg-slate-50 text-slate-700 border-slate-200" };
    createBadge(labels[currentStatusFilter], classes[currentStatusFilter], () => {
      currentStatusFilter = null;
      refreshClientsGrid();
    });
  }

  if (currentProjectStatusFilter) {
    const labels = { ACTIVE: "Obras Ativas", ON_HOLD: "Obras Pausadas", COMPLETED: "Obras Concluídas" };
    createBadge(labels[currentProjectStatusFilter], "bg-cyan-50 text-cyan-700 border-cyan-100", () => {
      currentProjectStatusFilter = null;
      refreshClientsGrid();
    });
  }

  if (currentTaskStatusFilter) {
    const labels = { PENDING: "Tarefas Pendentes", IN_PROGRESS: "Tarefas Em Curso", COMPLETED: "Tarefas Executadas" };
    createBadge(labels[currentTaskStatusFilter], "bg-purple-50 text-purple-700 border-purple-100", () => {
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
      currentStatusFilter = null;
      currentProjectStatusFilter = null;
      currentTaskStatusFilter = null;
      refreshClientsGrid();
    });
    container.appendChild(clearAllBtn);
  } else {
    container.classList.add("hidden");
  }
}

async function loadClientMatrix({ search = "" } = {}) {
  const body = byId("clientMatrixBody");
  if (!body) return;
  body.innerHTML = renderLoadingRow(5);

  let url = `/dashboard/clients?search=${encodeURIComponent(search)}&page=1&pageSize=10`;
  if (currentStatusFilter) url += `&status=${encodeURIComponent(currentStatusFilter)}`;
  if (currentProjectStatusFilter) url += `&projectStatus=${encodeURIComponent(currentProjectStatusFilter)}`;
  if (currentTaskStatusFilter) url += `&taskStatus=${encodeURIComponent(currentTaskStatusFilter)}`;

  const data = await apiRequest(url);
  updateFiltersUI();

  if (!data.items?.length) {
    body.innerHTML = `<tr><td class="px-8 py-8 text-center text-sm font-bold text-slate-400" colspan="5">Nenhum cliente encontrado.</td></tr>`;
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
  initMobileMenu();
  wireLogout();
  wireUsersNav();
  loadSessionGreeting();
  await refreshClientsGrid();
  wireClientMatrixActions();
  wireFilter();
  wireSync();
  wireAddClient();
}

init().catch((err) => toast(err.message || "Falha ao carregar Dashboard. Verifique login/API.", { type: "error" }));
