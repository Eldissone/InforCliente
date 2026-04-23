import { apiRequest, getApiBaseUrl } from "../../services/api.js";
import { wireLogout } from "../../shared/session.js";
import { formatCurrencyKZ, formatDateBR } from "../../shared/format.js";
import { toast, initMobileMenu, setButtonLoading, openModal, escapeHtml } from "../../shared/ui.js";

let dashboardData = null;
let charts = {
  finances: null,
  stock: null,
  progress: null,
  safety: null
};

let state = {
  projectId: "all",
  startDate: "",
  endDate: "",
  activeTab: "dashboard",
  currentFolderId: null,
  breadcrumbs: [],
  files: [],
  photos: [],
  progressTasks: [],
  galleryObraStartDate: "",
  galleryObraEndDate: "",
  galleryCampoStartDate: "",
  galleryCampoEndDate: ""
};

async function loadDashboardData() {
  try {
    let url = "/dashboard/client-summary";
    const params = new URLSearchParams();
    if (state.startDate) params.append("start", state.startDate);
    if (state.endDate) params.append("end", state.endDate);
    if (params.toString()) url += `?${params.toString()}`;

    dashboardData = await apiRequest(url);

    // Prioridade para a obra selecionada na tela de boas-vindas
    const savedProjectId = localStorage.getItem("selected_project_id");
    if (savedProjectId && dashboardData.projects.find(p => p.id === savedProjectId)) {
      state.projectId = savedProjectId;
      localStorage.removeItem("selected_project_id"); // Limpar após uso
    } else if (state.projectId === "all" && dashboardData.projects && dashboardData.projects.length > 0) {
      state.projectId = dashboardData.projects[0].id;
    }

    renderDashboard(state.projectId);

    // Update select filter if it still exists (fallback)
    const select = document.getElementById("projectFilter");
    if (select) {
      if (select.options.length === 1) {
        dashboardData.projects.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.name;
          select.appendChild(opt);
        });
      }
      select.value = state.projectId;
    }

    if (state.activeTab === "arquivos" && state.projectId !== "all") {
      await loadFiles();
    }
    if (state.activeTab === "galeria-obra" && state.projectId !== "all") {
      await loadPhotos();
    }
    if (state.activeTab === "galeria-campo" && state.projectId !== "all") {
      await loadPhotos();
    }
  } catch (err) {
    toast("Não foi possível carregar os dados.", { type: "error" });
    console.error(err);
  }
}

function renderDashboard(projectId) {
  const data = projectId === "all"
    ? dashboardData
    : filterDataByProject(projectId);

  if (!data) return;

  updateMetrics(data);
  renderFinancialChart(data.projects);
  renderStockChart(data.stock);

  if (projectId !== "all") {
    loadProgressBreakdown(projectId);
  } else {
    document.getElementById("progressBreakdownTbody").innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400">Selecione uma obra no filtro acima para ver os detalhes</td></tr>`;
  }

  updateTabUI();
}

function updateTabUI() {
  // Role-based visibility
  const user = JSON.parse(localStorage.getItem("inforcliente.user") || "{}");
  if (user.role === "cliente") {
    const campoBtn = document.querySelector('[data-tab-trigger="galeria-campo"]');
    if (campoBtn) campoBtn.classList.add("hidden");
    if (state.activeTab === "galeria-campo") state.activeTab = "galeria-obra";
  }

  document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
  document.getElementById(`tab-${state.activeTab}`)?.classList.remove("hidden");

  document.querySelectorAll("[data-tab-trigger]").forEach(btn => {
    if (btn.getAttribute("data-tab-trigger") === state.activeTab) {
      btn.classList.add("border-slate-900", "text-slate-900");
      btn.classList.remove("border-transparent", "text-slate-400");
    } else {
      btn.classList.remove("border-slate-900", "text-slate-900");
      btn.classList.add("border-transparent", "text-slate-400");
    }
  });

  const btnUpload = document.getElementById("btnUploadFile");
  if (state.activeTab === "arquivos") {
    if (state.projectId === "all") {
      if (btnUpload) btnUpload.classList.add("hidden");
      document.getElementById("filesTbody").innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400">Selecione uma obra no filtro acima para ver os arquivos.</td></tr>`;
    } else {
      if (btnUpload) btnUpload.classList.remove("hidden");
      // loadFiles() is called elsewhere or here
      loadFiles();
    }
  }

  if (state.activeTab === "galeria-obra") {
    if (state.projectId === "all") {
      document.getElementById("galleryObraContainer").innerHTML = `<div class="col-span-full p-8 text-center text-sm font-bold text-slate-400">Selecione uma obra no filtro acima para ver a galeria.</div>`;
    } else {
      loadPhotos();
    }
  }

  if (state.activeTab === "galeria-campo") {
    if (state.projectId === "all") {
      document.getElementById("galleryCampoContainer").innerHTML = `<div class="col-span-full p-8 text-center text-sm font-bold text-slate-400">Selecione uma obra no filtro acima para ver a galeria técnica.</div>`;
    } else {
      loadPhotos();
    }
  }

  if (state.activeTab === "stock" && dashboardData) {
    renderStockTable(dashboardData.stock || []);
  }
}

function filterDataByProject(pid) {
  if (!dashboardData) return null;
  const p = dashboardData.projects.find(x => x.id === pid);
  if (!p) return dashboardData;

  return {
    financials: {
      totalContract: p.budget,
      totalPaid: p.paid,
      totalDebt: p.debt
    },
    overallProgress: p.progress,
    projects: [p],
    stock: dashboardData.stock
  };
}

function updateMetrics(data) {
  const { financials, projects } = data;

  // Se tivermos um projecto selecionado (que não seja "all")
  const currentProject = projects.length === 1 ? projects[0] : null;

  const projNameEl = document.getElementById("currentProjectName");
  if (projNameEl) {
    projNameEl.textContent = currentProject ? currentProject.name : "Visão Consolidada (Todos)";
  }

  document.getElementById("metricTotalContract").textContent = formatCurrencyKZ(financials.totalContract);
  document.getElementById("metricTotalPaid").textContent = formatCurrencyKZ(financials.totalPaid);
  document.getElementById("metricDebt").textContent = formatCurrencyKZ(financials.totalDebt);

  // Payment Progress
  const paymentPct = financials.totalContract > 0
    ? (financials.totalPaid / financials.totalContract) * 100
    : 0;

  const metricPayment = document.getElementById("metricPaymentProgress");
  if (metricPayment) metricPayment.textContent = `${paymentPct.toFixed(1)}%`;

  const paymentLine = document.getElementById("paymentProgressLine");
  if (paymentLine) paymentLine.style.width = `${paymentPct}%`;

  // Director Info (if on "Resumo da obra" tab or just update anyway)
  renderDirectorInfo(currentProject);

  // Safety & Staff Analytics
  renderSafetyAnalytics(data);
}

function renderDirectorInfo(project) {
  const nameEl = document.getElementById("directorName");
  const photoEl = document.getElementById("directorPhoto");
  const phoneEl = document.getElementById("directorPhone");
  const emailEl = document.getElementById("directorEmail");

  if (!nameEl) return;

  if (project && project.director) {
    nameEl.textContent = project.director.name || "Eng. Por Atribuir";
    phoneEl.textContent = project.director.phone || "—";
    emailEl.textContent = project.director.email || "—";
    if (project.director.photo) {
      photoEl.src = `${getApiBaseUrl()}/${project.director.photo}`;
    } else {
      photoEl.src = "/assets/images/placeholder-user.png";
    }
  } else {
    nameEl.textContent = "—";
    phoneEl.textContent = "—";
    emailEl.textContent = "—";
    photoEl.src = "/assets/images/placeholder-user.png";
  }

  // Render Additional Technicians
  const techSection = document.getElementById("techTeamSection");
  const techContainer = document.getElementById("techTeamContainer");
  if (techSection && techContainer) {
    if (project && project.technicians && Array.isArray(project.technicians) && project.technicians.length > 0) {
      techSection.classList.remove("hidden");
      techContainer.innerHTML = project.technicians.map(t => `
        <div class="glass-card p-6 rounded-[2rem] bg-white text-center flex flex-col items-center">
            <div class="w-16 h-16 rounded-full bg-slate-100 mb-3 overflow-hidden border-2 border-white shadow-md">
                <img src="${t.photo ? getApiBaseUrl() + '/' + t.photo : '/assets/images/placeholder-user.png'}" alt="${escapeHtml(t.name)}" class="w-full h-full object-cover" />
            </div>
            <h4 class="text-sm font-bold text-slate-800">${escapeHtml(t.name)}</h4>
            <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-4">${escapeHtml(t.role || 'Técnico')}</p>
            
            <div class="w-full space-y-2 pt-4 border-t border-slate-50 text-left">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-blue-500 text-sm">call</span>
                    <span class="text-[10px] font-bold text-slate-600">${escapeHtml(t.phone || '—')}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-emerald-500 text-sm">mail</span>
                    <span class="text-[10px] font-bold text-slate-600 truncate">${escapeHtml(t.email || '—')}</span>
                </div>
            </div>
        </div>
      `).join("");
    } else {
      techSection.classList.add("hidden");
      techContainer.innerHTML = "";
    }
  }
}

function renderFinancialChart(projects) {
  if (!projects) return;
  const options = {
    series: [
      { name: 'Orçamento', data: projects.map(p => p.budget) },
      { name: 'Pago', data: projects.map(p => p.paid) }
    ],
    chart: { type: 'bar', height: 350, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#0F172A', '#2afc8d'],
    plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 8 } },
    dataLabels: { enabled: false },
    stroke: { show: true, width: 2, colors: ['transparent'] },
    xaxis: { categories: projects.map(p => p.name) },
    yaxis: { title: { text: '' }, labels: { formatter: (val) => val.toLocaleString() } },
    fill: { opacity: 1 },
    tooltip: { y: { formatter: (val) => formatCurrencyKZ(val) } },
    legend: { position: 'top', fontWeight: 700 }
  };

  const container = document.querySelector("#financialChart");
  if (!container) {
    console.warn("Container #financialChart not found. Skipping financial chart render.");
    return;
  }

  if (charts.finances) {
    try {
      charts.finances.destroy();
    } catch (e) {
      console.warn("Error destroying previous financial chart:", e);
    }
    charts.finances = null;
  }

  charts.finances = new ApexCharts(container, options);
  charts.finances.render().catch(err => console.error("Error rendering financial chart:", err));
}

function renderStockChart(stock) {
  // Chamamos agora a função de renderização da tabela de stock também
  renderStockTable(stock);

  // O gráfico doughnut pode ser removido ou mantido em algum lugar, 
  // mas o usuário pediu "Armazém com filtro", então focamos na tabela.
  // Se quiser manter o gráfico, ele precisa de um container que ainda exista.
}

function renderStockTable(stock) {
  const tbody = document.getElementById("stockTbody");
  const totalItemsEl = document.getElementById("stockTotalItems");
  if (!tbody) return;

  // Filtros
  const fMat = document.getElementById("stockFilterMaterial")?.value?.toLowerCase() || "";
  const fState = document.getElementById("stockFilterState")?.value || "all";
  // O filtro de data precisaria de datas individuais nos itens de stock
  // Por agora fazemos o filtro básico de material e estado se disponível

  const filtered = stock.filter(s => {
    const matchMat = s.name.toLowerCase().includes(fMat);
    return matchMat;
  });

  if (totalItemsEl) totalItemsEl.textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Sem Stock correspondente</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const usagePct = s.totalIn > 0 ? Math.round((s.totalOut / s.totalIn) * 100) : 0;
    const usageColor = usagePct > 90 ? 'text-red-600' : (usagePct > 50 ? 'text-orange-600' : 'text-blue-600');

    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-8 py-4 font-bold text-slate-900">${escapeHtml(s.name)}</td>
        <td class="px-4 py-4 text-center text-xs font-bold text-slate-400 uppercase">${escapeHtml(s.unit)}</td>
        <td class="px-4 py-4 text-center font-bold text-slate-600">${s.totalIn.toLocaleString('pt-AO')}</td>
        <td class="px-4 py-4 text-center font-bold text-slate-600">${s.totalOut.toLocaleString('pt-AO')}</td>
        <td class="px-4 py-4 text-center font-black text-blue-600 bg-blue-50/30">${s.qty.toLocaleString('pt-AO')}</td>
        <td class="px-4 py-4 text-center">
            <div class="flex flex-col items-center">
                <span class="text-[10px] font-black ${usageColor}">${usagePct}%</span>
                <div class="w-12 h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                    <div class="h-full ${usagePct > 90 ? 'bg-red-500' : (usagePct > 50 ? 'bg-orange-500' : 'bg-blue-500')}" style="width: ${Math.min(100, usagePct)}%"></div>
                </div>
            </div>
        </td>
        <td class="px-4 py-4 text-center text-[10px] font-bold text-slate-400">${s.lastActivity ? new Date(s.lastActivity).toLocaleDateString('pt-PT') : '--'}</td>
        <td class="px-8 py-4 text-right">
           <span class="px-2 py-0.5 rounded-md ${s.state === 'Bom Estado' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'} text-[9px] font-black uppercase tracking-widest">${escapeHtml(s.state)}</span>
        </td>
      </tr>
    `;
  }).join("");
}


function renderSafetyAnalytics(data) {
  const { projects } = data;

  // 1. Agregação de Dados
  let totalActiveStaff = 0;
  let mostRecentAccident = null;
  const monthlyAccidents = {}; // { "Jan": 2, ... }

  projects.forEach(p => {
    totalActiveStaff += (p.activeStaffCount || 0);

    if (p.lastAccidentDate) {
      const d = new Date(p.lastAccidentDate);
      if (!mostRecentAccident || d > mostRecentAccident) {
        mostRecentAccident = d;
      }
    }

    // Agregar histórico
    if (p.safetyHistory && Array.isArray(p.safetyHistory)) {
      p.safetyHistory.forEach(entry => {
        if (entry.month && entry.count !== undefined) {
          monthlyAccidents[entry.month] = (monthlyAccidents[entry.month] || 0) + entry.count;
        }
      });
    }
  });

  // 2. Calcular Dias sem Acidentes
  let daysWithoutAccidents = 0;
  if (mostRecentAccident) {
    const diff = Date.now() - mostRecentAccident.getTime();
    daysWithoutAccidents = Math.floor(diff / (1000 * 60 * 60 * 24));
  } else {
    daysWithoutAccidents = projects.length > 0 ? 30 : 0; // Fallback se nunca houve
  }

  // 3. Atualizar UI Textual
  document.getElementById("dashboardSafetyDays").textContent = daysWithoutAccidents;
  document.getElementById("dashboardActiveStaffCount").textContent = totalActiveStaff;

  // 4. Preparar Gráfico
  const consolidatedHistory = Object.entries(monthlyAccidents).map(([month, count]) => ({ month, count }));
  if (consolidatedHistory.length === 0) {
    // Mock se vazio
    ["Jan", "Fev", "Mar"].forEach(m => consolidatedHistory.push({ month: m, count: 0 }));
  }

  const options = {
    chart: {
      type: 'area',
      height: 140,
      sparkline: { enabled: true },
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      fontFamily: 'Inter, sans-serif',
      dropShadow: {
        enabled: true,
        top: 8,
        left: 0,
        blur: 8,
        opacity: 0.1,
        color: '#3b82f6'
      }
    },
    stroke: { curve: 'smooth', width: 4, lineCap: 'round' },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.5,
        opacityTo: 0.0,
        stops: [0, 90],
        colorStops: [
          { offset: 0, color: '#3b82f6', opacity: 0.4 },
          { offset: 100, color: '#3b82f6', opacity: 0 }
        ]
      }
    },
    markers: {
      size: 4,
      colors: ['#3b82f6'],
      strokeColors: '#fff',
      strokeWidth: 2,
      hover: { size: 6 }
    },
    series: [{
      name: 'Acidentes',
      data: consolidatedHistory.map(h => h.count)
    }],
    xaxis: {
      categories: consolidatedHistory.map(h => h.month),
      crosshairs: { show: false }
    },
    colors: ['#3b82f6'],
    tooltip: {
      theme: 'light',
      y: { formatter: (val) => `${val} incidente(s)` },
      fixed: { enabled: false },
      x: { show: true },
      marker: { show: false }
    }
  };

  const container = document.querySelector("#dashboardSafetyChart");
  if (!container) return;

  if (charts.safety) {
    charts.safety.destroy();
    charts.safety = null;
  }

  charts.safety = new ApexCharts(container, options);
  charts.safety.render();
}

async function loadProgressBreakdown(projectId) {
  const tbody = document.getElementById("progressBreakdownTbody");
  const filterSelect = document.getElementById("progressGroupFilter");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400">Carregando dados...</td></tr>`;

  try {
    const data = await apiRequest(`/projects/${projectId}/progress-tasks`);
    state.progressTasks = data.tasks || [];

    if (state.progressTasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Sem tarefas de Avanço Físico registadas</td></tr>`;
      if (filterSelect) filterSelect.innerHTML = `<option value="all">Todos os Separadores</option>`;
      return;
    }

    // Popular o Select de Filtro
    if (filterSelect) {
      // extraimos os separators unicos mantendo a ordem aproximada
      const groupNames = Array.from(new Set(state.progressTasks.map(t => escapeHtml(t.itemGroup || "Outros / Geral"))));
      let opts = `<option value="all">Todos os Separadores</option>`;
      groupNames.forEach(g => {
        opts += `<option value="${g}">${g}</option>`;
      });
      // não alterar o valor se já estiver selecionado um válido e se ele existir no novo dropdown
      const currentVal = filterSelect.value;
      filterSelect.innerHTML = opts;
      if (groupNames.includes(currentVal)) {
        filterSelect.value = currentVal;
      } else {
        filterSelect.value = "all";
      }
    }

    renderProgressBreakdownRows();
  } catch (err) {
    console.error("Erro ao carregar avanço físico", err);
    tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-red-500">Erro ao carregar dados do Avanço Físico</td></tr>`;
  }
}

function renderProgressBreakdownRows() {
  const tbody = document.getElementById("progressBreakdownTbody");
  const filterSelect = document.getElementById("progressGroupFilter");
  if (!tbody) return;

  const filterVal = filterSelect ? filterSelect.value : "all";
  const tasksToRender = state.progressTasks.filter(t => filterVal === "all" || escapeHtml(t.itemGroup || "Outros / Geral") === filterVal);

  if (tasksToRender.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Nenhuma tarefa neste separador</td></tr>`;
    return;
  }

  let html = "";
  let lastGroup = null;

  const groupInvoicingTotals = {};
  const groupInvoicedTotals = {};
  const groupCurrencies = {};
  const groupTasks = {};

  tasksToRender.forEach(t => {
    const g = t.itemGroup || "";
    if (!groupInvoicingTotals[g]) groupInvoicingTotals[g] = 0;
    if (!groupInvoicedTotals[g]) groupInvoicedTotals[g] = 0;
    if (!groupTasks[g]) groupTasks[g] = [];

    const exp = Number(t.expectedQty || 0);
    const exe = Number(t.executedQty || 0);
    const uv = Number(t.unitValue || 0);

    groupInvoicingTotals[g] += (uv * exp);
    groupInvoicedTotals[g] += (uv * exe);
    groupTasks[g].push(t);

    if (!groupCurrencies[g] || t.currency === "USD") {
      groupCurrencies[g] = t.currency === "USD" ? "USD" : "Kz";
    }
  });

  const groupProgressMap = {};
  Object.keys(groupTasks).forEach(g => {
    const tasks = groupTasks[g];
    const sumPct = tasks.reduce((acc, t) => {
      const exp = Number(t.expectedQty || 0);
      const exe = Number(t.executedQty || 0);
      const pct = exp > 0 ? (exe / exp) * 100 : (exe > 0 ? 100 : 0);
      return acc + Math.min(100, pct);
    }, 0);
    groupProgressMap[g] = sumPct / tasks.length;
  });

  // Separar pais ou independentes e as filhas
  const parentsAndOrphans = tasksToRender.filter(t => !t.parentId);
  const children = tasksToRender.filter(t => t.parentId);
  let groupIndex = 0;

  parentsAndOrphans.forEach(t => {
    const safeGroupName = escapeHtml(t.itemGroup || "Outros / Geral");

    if (t.itemGroup !== lastGroup) {
      const c = groupCurrencies[t.itemGroup || ""] || "Kz";
      const tgv = groupInvoicingTotals[t.itemGroup || ""] || 0;
      const gPct = Math.round(groupProgressMap[t.itemGroup || ""] || 0);

      const ft = `<span class="ml-auto text-[11px] font-black text-slate-500">${tgv.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}</span>`;
      const fPct = `<span class="ml-3 text-[9px] bg-blue-100 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded-md font-black shadow-sm">${gPct}% Exec.</span>`;

      html += `
        <tr class="bg-slate-50 cursor-pointer select-none group" data-toggle-progress-group="${safeGroupName}">
          <td colspan="4" class="px-6 py-2 border-y border-slate-100 hover:bg-slate-100/50 transition-colors">
            <div class="flex items-center gap-2 w-full">
              <span class="material-symbols-outlined text-slate-400 group-hover:text-blue-600 transition-colors text-lg" data-icon>expand_more</span>
              <span class="w-1.5 h-3 bg-blue-600 rounded-full"></span>
              <span class="text-[10px] font-black uppercase tracking-[0.2em] text-[#212e3e]">${safeGroupName}</span>
              ${fPct}
            </div>
          </td>
        </tr>
      `;
      lastGroup = t.itemGroup;
      groupIndex = 0;
    }

    groupIndex++;
    const subs = children.filter(c => c.parentId === t.id);

    const renderRow = (task, prefixStr, isSub = false, hasChildren = false) => {
      const exp = Number(task.expectedQty || 0);
      const exe = Number(task.executedQty || 0);
      const exePct = exp > 0 ? Math.round((exe / exp) * 100) : (exe > 0 ? 100 : 0);

      const uvS = Number(task.unitValueService || 0);
      const uvM = Number(task.unitValueMaterial || 0);
      const uv = Number(task.unitValue || (uvS + uvM));

      const invoicingVal = uv * exp; // Valor da faturação (Total previsto)
      const invoicedVal = uv * exe;   // Valor faturado (Total executado)

      const cStr = task.currency === "USD" ? "USD" : "Kz";
      const uvSStr = uvS > 0 ? `${uvS.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cStr}` : "-";
      const uvMStr = uvM > 0 ? `${uvM.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cStr}` : "-";
      const invoicingValStr = invoicingVal > 0 ? `${invoicingVal.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cStr}` : "-";
      const invoicedValStr = invoicedVal > 0 ? `${invoicedVal.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cStr}` : "-";

      const indentStyle = isSub ? "pl-14 bg-slate-50/40" : "px-6";
      const iconSub = isSub ? `<span class="material-symbols-outlined text-[16px] text-slate-300 mr-2 -ml-6">subdirectory_arrow_right</span>` : "";
      const parentClass = hasChildren ? "bg-slate-100 border-y border-slate-200/50 cursor-pointer select-none" : "";
      const descClass = hasChildren ? "font-black text-slate-900" : "font-medium text-slate-800";
      const toggleAttr = hasChildren ? `data-toggle-sub-tasks="${task.id}"` : "";

      return `
        <tr class="hover:bg-slate-50 transition-colors text-sm ${parentClass}" data-progress-item-group="${safeGroupName}" ${toggleAttr}>
          <td class="py-3 ${descClass} ${indentStyle}">
             <div class="flex items-center">
                ${iconSub}
                ${hasChildren ? `<span class="material-symbols-outlined text-slate-400 mr-2 text-lg" data-sub-icon>expand_more</span>` : ""}
                <span class="font-bold text-slate-400 mr-2">${prefixStr} -</span>
                <span>${escapeHtml(task.description)}</span>
             </div>
          </td>
          <td class="px-4 py-3 text-center text-slate-500">${exp.toLocaleString('pt-AO')} <span class="text-[9px] uppercase tracking-wider">${escapeHtml(task.unit)}</span></td>
          <td class="px-4 py-3 text-center font-bold text-blue-600">
             ${exe.toLocaleString('pt-AO')}
          </td>
          <td class="px-6 py-3 text-right">
             <span class="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-bold">${exePct}%</span>
          </td>
        </tr>
      `;
    };

    html += renderRow(t, groupIndex.toString(), false, subs.length > 0);

    subs.forEach((sub, subI) => {
      const subRow = renderRow(sub, `${groupIndex}.${subI + 1}`, true, false);
      // Injetar o data-sub-of no tr do subitem
      html += subRow.replace('<tr', `<tr data-sub-of="${t.id}"`);
    });
  });
  let activeProgress = 0;
  if (filterVal === "all") {
    const numGroups = Object.keys(groupProgressMap).length;
    if (numGroups > 0) {
      const totalPct = Object.values(groupProgressMap).reduce((a, b) => a + b, 0);
      activeProgress = Math.round(totalPct / numGroups);
    }
  } else {
    activeProgress = Math.round(groupProgressMap[filterVal] || 0);
  }

  if (charts.progress) {
    charts.progress.updateSeries([activeProgress]);
  }

  const summaryTbody = document.getElementById("progressBreakdownSummaryTbody");
  if (summaryTbody) {
    if (filterVal === "all") {
      let summaryHtml = "";
      Object.keys(groupProgressMap).forEach(g => {
          const gPct = Math.round(groupProgressMap[g] || 0);
          summaryHtml += `
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="px-6 py-4 font-bold text-slate-800 text-xs">${escapeHtml(g)}</td>
              <td class="px-4 py-4 text-right">
                 <div class="flex items-center justify-end gap-3">
                     <div class="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                         <div class="h-full bg-blue-500" style="width: ${gPct}%"></div>
                     </div>
                     <span class="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-bold">${gPct}%</span>
                 </div>
              </td>
            </tr>
          `;
      });
      summaryTbody.innerHTML = summaryHtml;
    } else {
      let summaryHtml = "";
      const gPct = Math.round(groupProgressMap[filterVal] || 0);
      summaryHtml += `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="px-6 py-4 font-bold text-slate-800 text-xs">${escapeHtml(filterVal)}</td>
          <td class="px-4 py-4 text-right">
             <div class="flex items-center justify-end gap-3">
                 <div class="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                     <div class="h-full bg-blue-500" style="width: ${gPct}%"></div>
                 </div>
                 <span class="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-bold">${gPct}%</span>
             </div>
          </td>
        </tr>
      `;
      summaryTbody.innerHTML = summaryHtml;
    }
  }

  tbody.innerHTML = html;
}

/* =================================================================================
 *  FILE MANAGEMENT
 * ================================================================================= */

async function loadFiles() {
  if (state.projectId === "all") return;
  const tbody = document.getElementById("filesTbody");
  if (!tbody) return;

  try {
    tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400">Carregando...</td></tr>`;

    // Load Folders & Files
    const qs = state.currentFolderId ? `?parentId=${state.currentFolderId}` : `?parentId=root`;
    const fqs = state.currentFolderId ? `?folderId=${state.currentFolderId}` : `?folderId=root`;

    const [fRes, filesRes] = await Promise.all([
      apiRequest(`/projects/${state.projectId}/folders${qs}`),
      apiRequest(`/projects/${state.projectId}/files${fqs}`)
    ]);

    const folders = fRes.items || [];
    const files = filesRes.items || [];

    renderFiles(folders, files);
    renderBreadcrumbs();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-red-400">Falha ao carregar arquivos</td></tr>`;
  }
}

function renderFiles(folders, files) {
  const tbody = document.getElementById("filesTbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (folders.length === 0 && files.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400">Nenhum documento encontrado.</td></tr>`;
    return;
  }

  folders.forEach(f => {
    tbody.insertAdjacentHTML("beforeend", `
      <tr class="hover:bg-slate-50/50 transition-colors group cursor-pointer" data-enter-folder="${f.id}" data-folder-name="${escapeHtml(f.name)}">
        <td class="px-8 py-4">
          <div class="flex items-center gap-3">
             <div class="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-400"><span class="material-symbols-outlined">folder</span></div>
             <span class="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">${escapeHtml(f.name)}</span>
          </div>
        </td>
        <td class="px-8 py-4 hidden md:table-cell text-xs font-bold text-slate-400">Pasta</td>
        <td class="px-8 py-4 hidden md:table-cell text-xs font-bold text-slate-400">--</td>
        <td class="px-8 py-4 text-right text-xs font-bold text-slate-400">${formatDateBR(f.createdAt)}</td>
      </tr>
    `);
  });

  files.forEach(f => {
    const kb = (f.size / 1024).toFixed(1);
    const url = `${getApiBaseUrl()}/${f.path}`;
    tbody.insertAdjacentHTML("beforeend", `
      <tr class="hover:bg-slate-50/50 transition-colors group">
        <td class="px-8 py-4">
          <a href="${url}" target="_blank" class="flex items-center gap-3">
             <div class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500"><span class="material-symbols-outlined">description</span></div>
             <span class="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">${escapeHtml(f.originalName)}</span>
          </a>
        </td>
        <td class="px-8 py-4 hidden md:table-cell text-xs font-bold text-slate-400">${escapeHtml(f.category)}</td>
        <td class="px-8 py-4 hidden md:table-cell text-xs font-bold text-slate-400">${kb} KB</td>
        <td class="px-8 py-4 text-right text-xs font-bold text-slate-400">${formatDateBR(f.createdAt)}</td>
      </tr>
    `);
  });
}

function renderBreadcrumbs() {
  const container = document.getElementById("fileBreadcrumbs");
  if (!container) return;
  let html = `<button data-go-folder="root" class="hover:text-slate-900 transition-colors flex items-center gap-1"><span class="material-symbols-outlined text-sm">home</span> Raiz Geral</button>`;

  state.breadcrumbs.forEach(b => {
    html += ` <span class="text-slate-300">/</span> <button data-go-folder="${b.id}" class="hover:text-slate-900 transition-colors">${escapeHtml(b.name)}</button>`;
  });
  container.innerHTML = html;
}

function wireFileNavigation() {
  document.addEventListener("click", async (e) => {
    const enterBtn = e.target?.closest("[data-enter-folder]");
    if (enterBtn) {
      const fid = enterBtn.getAttribute("data-enter-folder");
      const fname = enterBtn.getAttribute("data-folder-name");
      state.currentFolderId = fid;
      state.breadcrumbs.push({ id: fid, name: fname });
      loadFiles();
      return;
    }

    const goBtn = e.target?.closest("[data-go-folder]");
    if (goBtn) {
      const gid = goBtn.getAttribute("data-go-folder");
      if (gid === "root") {
        state.currentFolderId = null;
        state.breadcrumbs = [];
      } else {
        const idx = state.breadcrumbs.findIndex(b => b.id === gid);
        if (idx !== -1) {
          state.currentFolderId = gid;
          state.breadcrumbs = state.breadcrumbs.slice(0, idx + 1);
        }
      }
      loadFiles();
      return;
    }
  });

  const uploadBtn = document.getElementById("btnUploadFile");
  if (uploadBtn) {
    uploadBtn.addEventListener("click", () => {
      if (state.projectId === "all") return;
      openModal({
        title: "Enviar Arquivo",
        primaryLabel: "Enviar",
        contentHtml: `
           <div class="space-y-4">
             <div>
               <label class="block text-[10px] font-black uppercase text-slate-500 mb-2">Arquivo</label>
               <input type="file" id="upload_file" class="w-full text-sm border border-slate-200 rounded-xl p-2 bg-slate-50"/>
             </div>
             <div>
               <label class="block text-[10px] font-black uppercase text-slate-500 mb-2">Categoria</label>
               <select id="upload_cat" class="w-full rounded-xl border-slate-300 text-sm">
                 <option value="OUTROS">Outros</option>
                 <option value="PLANTA">Planta / Projecto</option>
                 <option value="CONTRATO">Contrato / Legal</option>
                 <option value="FOTO">Registo Fotográfico</option>
                 <option value="RELATORIO">Relatório Técnico</option>
               </select>
             </div>
           </div>
        `,
        onPrimary: async ({ close, panel }) => {
          const fileInput = panel.querySelector("#upload_file");
          const file = fileInput.files?.[0];
          if (!file) { toast("Selecione um arquivo", { type: "error" }); return; }
          const cat = panel.querySelector("#upload_cat").value;

          const formData = new FormData();
          formData.append("file", file);
          formData.append("category", cat);
          if (state.currentFolderId) formData.append("folderId", state.currentFolderId);

          const btn = panel.querySelector("[data-primary]");
          try {
            setButtonLoading(btn, true);
            await apiRequest(`/projects/${state.projectId}/files`, { method: "POST", body: formData });
            toast("Arquivo enviado com sucesso", { type: "success" });
            close();
            loadFiles();
          } catch (err) {
            setButtonLoading(btn, false);
            toast("Erro ao enviar arquivo", { type: "error" });
          }
        }
      });
    });
  }
}

/* =================================================================================
 *  PHOTO GALLERY
 * ================================================================================= */

function getDateCategory(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();

  const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffTime = Math.abs(nowMidnight - dMidnight);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays <= 7) return "Última semana";

  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
    return "Anteriormente neste mês";
  }
  return "Anteriormente";
}

async function loadPhotos() {
  if (state.projectId === "all") return;

  const containerObra = document.getElementById("galleryObraContainer");
  const containerCampo = document.getElementById("galleryCampoContainer");

  try {
    if (containerObra) containerObra.innerHTML = `<div class="p-8 text-center text-sm font-bold text-slate-400">Carregando fotos...</div>`;
    if (containerCampo) containerCampo.innerHTML = `<div class="p-8 text-center text-sm font-bold text-slate-400">Carregando fotos...</div>`;

    const res = await apiRequest(`/projects/${state.projectId}/photos`);
    const allPhotos = res.items || [];

    // 1. Fotos da Obra (movementId is null)
    let photosObra = allPhotos.filter(p => !p.movementId);
    if (state.galleryObraStartDate) {
      const gs = new Date(state.galleryObraStartDate).getTime();
      photosObra = photosObra.filter(p => new Date(p.createdAt).getTime() >= gs);
    }
    if (state.galleryObraEndDate) {
      const ge = new Date(state.galleryObraEndDate);
      ge.setHours(23, 59, 59, 999);
      photosObra = photosObra.filter(p => new Date(p.createdAt).getTime() <= ge.getTime());
    }

    // 2. Fotos de Campo (movementId is NOT null)
    let photosCampo = allPhotos.filter(p => !!p.movementId);
    if (state.galleryCampoStartDate) {
      const gs = new Date(state.galleryCampoStartDate).getTime();
      photosCampo = photosCampo.filter(p => new Date(p.createdAt).getTime() >= gs);
    }
    if (state.galleryCampoEndDate) {
      const ge = new Date(state.galleryCampoEndDate);
      ge.setHours(23, 59, 59, 999);
      photosCampo = photosCampo.filter(p => new Date(p.createdAt).getTime() <= ge.getTime());
    }

    renderGallerySection("galleryObraContainer", photosObra, false);
    renderGallerySection("galleryCampoContainer", photosCampo, true);

  } catch (err) {
    console.error(err);
    if (containerObra) containerObra.innerHTML = `<div class="p-8 text-center text-sm font-bold text-red-400">Erro ao carregar fotos.</div>`;
  }
}

function renderGallerySection(containerId, photos, isCampo) {
  const grid = document.getElementById(containerId);
  if (!grid) return;

  if (photos.length === 0) {
    grid.innerHTML = `<div class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest bg-white rounded-[2rem] border border-dashed border-slate-200">Sem registos encontrados nesta galeria</div>`;
    return;
  }

  // Group photos
  const groups = {};
  photos.forEach(p => {
    const cat = getDateCategory(p.createdAt);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });

  const order = ["Hoje", "Ontem", "Última semana", "Anteriormente neste mês", "Anteriormente"];

  grid.innerHTML = "";
  order.forEach(cat => {
    if (!groups[cat] || groups[cat].length === 0) return;

    const groupId = `${containerId}-${cat.replace(/\s+/g, '-').toLowerCase()}`;

    let html = `
       <div class="gallery-group mb-4">
          <button class="flex items-center gap-2 mb-4 text-sm font-bold text-slate-800 hover:text-slate-600 transition-colors w-full text-left focus:outline-none group/btn" 
                  onclick="const list = document.getElementById('${groupId}'); list.classList.toggle('hidden'); this.querySelector('.chevron').classList.toggle('rotate-[-90deg]')">
             <span class="material-symbols-outlined text-lg transition-transform duration-300 chevron">expand_more</span>
             ${cat}
          </button>
          
          <div id="${groupId}" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 transition-all duration-500">
     `;

    groups[cat].forEach(p => {
      const url = `${getApiBaseUrl()}/${p.path}`;
      const matName = p.movement?.material?.name || p.description || "Registo Fotográfico";
      const dateStr = new Date(p.createdAt).toLocaleDateString('pt-PT');

      html += `
         <div data-preview-url="${url}" data-preview-title="${escapeHtml(matName)}" data-preview-date="${dateStr}" 
              class="group gallery-item flex items-center gap-3 p-2 rounded-xl border border-transparent hover:border-slate-100 hover:bg-slate-50 transition-all cursor-pointer">
            <!-- Thumbnail -->
            <div class="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-slate-100 shadow-sm border border-slate-100">
                <img src="${url}" class="w-full h-full object-cover transition-transform group-hover:scale-110" loading="lazy" />
            </div>
            
            <!-- Metadata -->
            <div class="flex-1 min-w-0">
               <p class="text-[11px] font-bold text-slate-900 truncate leading-tight mb-0.5" title="${escapeHtml(matName)}">${escapeHtml(matName)}</p>
               <p class="text-[9px] font-medium text-slate-400 uppercase tracking-tighter leading-none mb-1">Ficheiro JPG</p>
               <p class="text-[9px] font-semibold text-slate-500 leading-none">${dateStr}</p>
            </div>
         </div>
       `;
    });

    html += `</div></div>`;
    grid.insertAdjacentHTML("beforeend", html);
  });
}

/* =================================================================================
 *  INITIALIZATION & LISTENERS
 * ================================================================================= */

function wireEvents() {
  // Filters
  const filterSelect = document.getElementById("projectFilter");
  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      state.projectId = e.target.value;
      renderDashboard(state.projectId);
    });
  }

  // Progress Group Filter
  const progressFilter = document.getElementById("progressGroupFilter");
  if (progressFilter) {
    progressFilter.addEventListener("change", () => {
      renderProgressBreakdownRows();
    });
  }

  // Stock Filters
  ["stockFilterMaterial", "stockFilterState"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => {
      if (dashboardData && dashboardData.stock) {
        renderStockTable(dashboardData.stock);
      }
    });
  });

  // Handle document clicks for interactive components like progress group toggles, breadcrumbs, logic
  document.addEventListener("click", async (e) => {
    // Progress Breakdown Group Toggle
    const toggleRow = e.target?.closest("[data-toggle-progress-group]");
    if (toggleRow) {
      const groupName = toggleRow.getAttribute("data-toggle-progress-group");
      const icon = toggleRow.querySelector("[data-icon]");
      const items = document.querySelectorAll(`[data-progress-item-group="${groupName}"]`);
      let isHidden = false;
      items.forEach(item => {
        isHidden = item.classList.toggle("hidden");
      });
      if (icon) {
        icon.textContent = isHidden ? "chevron_right" : "expand_more";
      }
      return;
    }

    // Progress Sub-tasks Toggle
    const toggleSub = e.target?.closest("[data-toggle-sub-tasks]");
    if (toggleSub) {
      const parentId = toggleSub.getAttribute("data-toggle-sub-tasks");
      const icon = toggleSub.querySelector("[data-sub-icon]");
      const children = document.querySelectorAll(`[data-sub-of="${parentId}"]`);

      let isHidden = false;
      children.forEach(child => {
        isHidden = child.classList.toggle("hidden");
      });

      if (icon) {
        icon.textContent = isHidden ? "chevron_right" : "expand_more";
      }
      return;
    }

    // Breadcrumbs nav for files
    const btnBread = e.target.closest("[data-go-folder]");
    if (btnBread) {
      const fid = btnBread.getAttribute("data-go-folder");
      state.currentFolderId = fid === "root" ? null : fid;

      if (fid === "root") {
        state.breadcrumbs = [];
      } else {
        const crtIdx = state.breadcrumbs.findIndex(x => x.id === fid);
        if (crtIdx >= 0) {
          state.breadcrumbs = state.breadcrumbs.slice(0, crtIdx + 1);
        }
      }
      loadFiles();
    }

    // Lightbox Toggle
    const galleryItem = e.target.closest("[data-preview-url]");
    if (galleryItem) {
      const url = galleryItem.getAttribute("data-preview-url");
      const title = galleryItem.getAttribute("data-preview-title");
      const date = galleryItem.getAttribute("data-preview-date");
      openLightbox(url, title, date);
      return;
    }

    const lightboxOverlay = document.getElementById("imageLightbox");
    const closeBtn = e.target.closest("#closeLightbox");
    if (closeBtn || e.target === lightboxOverlay) {
      closeLightbox();
    }
  });

  // Handle ESC key for Lightbox
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
  const updateDates = () => {
    state.startDate = document.getElementById("filterStart")?.value || "";
    state.endDate = document.getElementById("filterEnd")?.value || "";
    loadDashboardData();
  };

  document.getElementById("filterStart")?.addEventListener("change", updateDates);
  document.getElementById("filterEnd")?.addEventListener("change", updateDates);

  // Gallery Filters - Obra
  const updateGalleryObraDates = () => {
    state.galleryObraStartDate = document.getElementById("galleryObraFilterStart")?.value || "";
    state.galleryObraEndDate = document.getElementById("galleryObraFilterEnd")?.value || "";
    if (state.activeTab === "galeria-obra") loadPhotos();
  };
  document.getElementById("galleryObraFilterStart")?.addEventListener("change", updateGalleryObraDates);
  document.getElementById("galleryObraFilterEnd")?.addEventListener("change", updateGalleryObraDates);

  // Gallery Filters - Campo
  const updateGalleryCampoDates = () => {
    state.galleryCampoStartDate = document.getElementById("galleryCampoFilterStart")?.value || "";
    state.galleryCampoEndDate = document.getElementById("galleryCampoFilterEnd")?.value || "";
    if (state.activeTab === "galeria-campo") loadPhotos();
  };
  document.getElementById("galleryCampoFilterStart")?.addEventListener("change", updateGalleryCampoDates);
  document.getElementById("galleryCampoFilterEnd")?.addEventListener("change", updateGalleryCampoDates);

  // Tabs — event delegation para funcionar com botões dentro do conteúdo
  document.addEventListener("click", (e) => {
    const tabBtn = e.target?.closest("[data-tab-trigger]");
    if (tabBtn) {
      state.activeTab = tabBtn.getAttribute("data-tab-trigger");
      updateTabUI();
    }
  });

  wireFileNavigation();
}

function openLightbox(url, title, date) {
  const lightbox = document.getElementById("imageLightbox");
  const img = document.getElementById("lightboxImage");
  const titleEl = document.getElementById("lightboxTitle");
  const dateEl = document.getElementById("lightboxDate");

  if (!lightbox || !img) return;

  img.src = url;
  titleEl.textContent = title;
  dateEl.textContent = date;

  lightbox.classList.add("active");
  document.body.style.overflow = "hidden"; // Prevent scrolling
}

function closeLightbox() {
  const lightbox = document.getElementById("imageLightbox");
  if (!lightbox) return;

  lightbox.classList.remove("active");
  document.body.style.overflow = ""; // Restore scrolling
}

function init() {
  initMobileMenu();
  wireLogout();

  const user = JSON.parse(localStorage.getItem("inforcliente.user") || "{}");
  if (user && user.client) {
    const headerName = document.getElementById("clientNameHeader");
    if (headerName) headerName.textContent = user.client.name;
  }

  wireEvents();
  loadDashboardData();
}

document.addEventListener("DOMContentLoaded", init);
