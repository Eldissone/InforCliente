import { apiRequest, getApiBaseUrl, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { wireLogout } from "../../shared/session.js";

checkAuth({ allowedRoles: ["cliente", "admin", "operador"] });
import { formatCurrencyKZ, formatCurrency, formatDateBR, getExchangeRate } from "../../shared/format.js";
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
  galleryObraMaterial: "all",
  galleryCampoStartDate: "",
  galleryCampoEndDate: "",
  galleryCampoMaterial: "all",
  collapsedTables: JSON.parse(localStorage.getItem("InfoCliente.clientCollapsedTables") || "{}")
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

    checkInteractionsBadge();
  } catch (err) {
    toast("Não foi possível carregar os dados.", { type: "error" });
    console.error(err);
  }
}

async function renderDashboard(projectId) {
  const data = projectId === "all"
    ? dashboardData
    : filterDataByProject(projectId);

  if (!data) return;

  await updateMetrics(data);
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
  const user = JSON.parse(localStorage.getItem("InfoCliente.user") || "{}");
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
    loadStockData();
  }

  if (state.activeTab === "obra" && dashboardData) {
    loadProgressHistoryData();
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

async function updateMetrics(data) {
  const { financials, projects } = data;

  // Se tivermos um projecto selecionado (que não seja "all")
  const currentProject = projects.length === 1 ? projects[0] : null;

  const projNameEl = document.getElementById("currentProjectName");
  if (projNameEl) {
    projNameEl.textContent = currentProject ? currentProject.name : "Visão Consolidada (Todos)";
  }

  const projectCurrency = currentProject ? (currentProject.currency || "AOA") : "AOA";
  const exchangeRate = await getExchangeRate(); 
  
  const setMetric = (id, value, primaryCurrency) => {
    const el = document.getElementById(id);
    const secEl = document.getElementById(id + "Secondary");
    if (!el) return;

    el.textContent = formatCurrency(value, primaryCurrency);

    if (secEl) {
      const secondaryCurrency = primaryCurrency === "USD" ? "AOA" : "USD";
      const convertedValue = primaryCurrency === "USD" ? value * exchangeRate : value / exchangeRate;
      secEl.textContent = formatCurrency(convertedValue, secondaryCurrency);
    }
  };

  setMetric("metricTotalContract", financials.totalContract, projectCurrency);
  setMetric("metricTotalPaid", financials.totalPaid, projectCurrency);
  setMetric("metricDebt", financials.totalDebt, projectCurrency);

  // Payment Progress
  const paymentPct = financials.totalContract > 0
    ? (financials.totalPaid / financials.totalContract) * 100
    : 0;

  const metricPayment = document.getElementById("metricPaymentProgress");
  if (metricPayment) metricPayment.textContent = `${paymentPct.toFixed(2)}%`;

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
        <div class="glass-card p-6 rounded-[2rem] bg-white text-center flex flex-col items-center h-full">
            <div class="w-16 h-16 rounded-full bg-slate-100 mb-3 overflow-hidden border-2 border-white shadow-md">
                <img src="${t.photo ? getApiBaseUrl() + '/' + t.photo : '/assets/images/placeholder-user.png'}" alt="${escapeHtml(t.name)}" class="w-full h-full object-cover" />
            </div>
            <h4 class="text-sm font-bold text-slate-800">${escapeHtml(t.name)}</h4>
            <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-4">${escapeHtml(t.role || 'Técnico')}</p>
            
            <div class="w-full space-y-2 pt-4 border-t border-slate-50 text-left mt-auto">
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
  // Não é mais usada para render — os dados do stock são carregados via API direta
}

async function loadStockData() {
  if (!state.projectId || state.projectId === "all") return;

  const summaryTbody = document.getElementById("stockSummaryTbody");
  const dailyTbody = document.getElementById("stockDailyTbody");
  if (!summaryTbody || !dailyTbody) return;

  summaryTbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-sm font-bold text-slate-400">A carregar...</td></tr>`;
  dailyTbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-sm font-bold text-slate-400">A carregar...</td></tr>`;

  try {
    const [summaryRes, movementsRes] = await Promise.all([
      apiRequest(`/stock/${state.projectId}/summary`),
      apiRequest(`/stock/${state.projectId}/movements`)
    ]);

    const summaryItems = summaryRes.items || [];
    const movements = movementsRes.items || [];

    // --- Tabela 1: Resumo por Material ---
    // Calcular Entregue e Aplicado a partir dos movimentos aprovados
    const materialMap = {};
    movements.forEach(m => {
      const mId = m.materialId;
      if (!materialMap[mId]) {
        materialMap[mId] = {
          name: m.material?.name || "—",
          unit: m.material?.unit || "",
          previsto: 0, entregue: 0, aplicado: 0
        };
      }
      const qty = Number(m.quantityGood || 0) + Number(m.quantityDamaged || 0);
      if (m.auditStatus === "APROVADO") {
        if (m.type === "ENTRADA") materialMap[mId].entregue += qty;
        if (m.type === "SAIDA") materialMap[mId].aplicado += qty;
      }
    });

    // Integrar com o summary (saldo actual e previsto)
    summaryItems.forEach(s => {
      const mId = s.materialId;
      if (!materialMap[mId]) {
        materialMap[mId] = {
          name: s.material?.name || "—",
          unit: s.material?.unit || "",
          previsto: Number(s.quantityPlanned || 0),
          entregue: 0, 
          aplicado: 0
        };
      } else {
        materialMap[mId].previsto = Number(s.quantityPlanned || 0);
      }
    });

    const fSummary = document.getElementById("stockSummaryFilter")?.value?.toLowerCase() || "";
    const summaryRows = Object.values(materialMap).filter(m => m.name.toLowerCase().includes(fSummary));

    if (summaryRows.length === 0) {
      summaryTbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Sem material registado</td></tr>`;
    } else {
      summaryTbody.innerHTML = summaryRows.map(m => {
        const saldo = m.entregue - m.aplicado;
        const saldoColor = saldo < 0 ? "text-red-600" : saldo === 0 ? "text-slate-400" : "text-emerald-600";
        return `
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-bold text-slate-900">${escapeHtml(m.name)}</td>
            <td class="px-4 py-4 text-center text-xs text-slate-900 font-bold">${m.previsto.toLocaleString("pt-AO")} <span class="text-[9px] text-slate-400">${escapeHtml(m.unit)}</span></td>
            <td class="px-4 py-4 text-center font-bold text-emerald-600">${m.entregue.toLocaleString("pt-AO")} <span class="text-[9px] text-slate-400">${escapeHtml(m.unit)}</span></td>
            <td class="px-4 py-4 text-center font-bold text-blue-600">${m.aplicado.toLocaleString("pt-AO")} <span class="text-[9px] text-slate-400">${escapeHtml(m.unit)}</span></td>
            <td class="px-4 py-4 text-center font-black ${saldoColor}">${saldo.toLocaleString("pt-AO")} <span class="text-[9px]">${escapeHtml(m.unit)}</span></td>
          </tr>`;
      }).join("");
    }

    // --- Tabela 2: Diário de Movimentos ---
    const fMat = document.getElementById("stockDailyFilterMaterial")?.value?.toLowerCase() || "";
    const fDate = document.getElementById("stockDailyFilterDate")?.value || "";
    const fType = document.getElementById("stockDailyFilterType")?.value || "all";

    const filtered = movements.filter(m => {
      const matName = m.material?.name?.toLowerCase() || "";
      const matchMat = matName.includes(fMat);
      const matchType = fType === "all" || m.type === fType;
      const matchDate = !fDate || (m.dateEntry && m.dateEntry.startsWith(fDate));
      return matchMat && matchType && matchDate;
    });

    if (filtered.length === 0) {
      dailyTbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Sem registos correspondentes</td></tr>`;
    } else {
      const typeLabel = { "ENTRADA": "Entrada", "SAIDA": "Saída", "AJUSTE": "Ajuste", "TRANSFERENCIA": "Transferência" };
      const typeColor = { "ENTRADA": "bg-emerald-50 text-emerald-700", "SAIDA": "bg-red-50 text-red-700", "AJUSTE": "bg-orange-50 text-orange-700", "TRANSFERENCIA": "bg-blue-50 text-blue-700" };
      const statusLabel = { "PENDENTE": "Pendente", "VALIDACAO": "Em Validação", "APROVADO": "Aprovado", "REJEITADO": "Rejeitado" };
      const statusColor = { "PENDENTE": "bg-orange-50 text-orange-600", "VALIDACAO": "bg-blue-50 text-blue-600", "APROVADO": "bg-emerald-50 text-emerald-600", "REJEITADO": "bg-red-50 text-red-600" };

      dailyTbody.innerHTML = filtered.map(m => {
        const date = m.dateEntry ? new Date(m.dateEntry).toLocaleDateString("pt-PT") : "—";
        const qty = Number(m.quantityGood || 0) + Number(m.quantityDamaged || 0);
        const tc = typeColor[m.type] || "bg-slate-50 text-slate-600";
        const sc = statusColor[m.auditStatus] || "bg-slate-50 text-slate-600";

        // Tooltip de logística
        const hasLogistics = m.driverName || m.vehicleBrand || m.vehiclePlate;
        const tooltipHtml = hasLogistics ? `
          <div class="logistics-tooltip">
            <span class="material-symbols-outlined text-slate-400 hover:text-blue-600 transition-colors text-base cursor-help">local_shipping</span>
            <div class="tooltip-box">
              <div class="text-[9px] font-black uppercase tracking-widest text-blue-400 mb-2">Dados de Transporte</div>
              <div class="tooltip-row">
                <span class="tooltip-label">Motorista</span>
                <span>${escapeHtml(m.driverName || "—")}</span>
              </div>
              <div class="tooltip-row">
                <span class="tooltip-label">Viatura</span>
                <span>${escapeHtml(m.vehicleBrand || "—")}</span>
              </div>
              <div class="tooltip-row">
                <span class="tooltip-label">Matrícula</span>
                <span class="font-mono">${escapeHtml(m.vehiclePlate || "—")}</span>
              </div>
            </div>
          </div>` : `<span class="text-slate-300 text-sm material-symbols-outlined">local_shipping</span>`;

        return `
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 text-xs font-bold text-slate-500">${date}</td>
            <td class="px-4 py-4 font-bold text-slate-900">${escapeHtml(m.material?.name || "—")}</td>
            <td class="px-4 py-4 text-center font-black text-slate-700">${qty.toLocaleString("pt-AO")} <span class="text-[9px] text-slate-400">${escapeHtml(m.material?.unit || "")}</span></td>
            <td class="px-4 py-4 text-center"><span class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${tc}">${typeLabel[m.type] || m.type}</span></td>
            <td class="px-4 py-4 text-center">${tooltipHtml}</td>
            <td class="px-6 py-4 text-right"><span class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${sc}">${statusLabel[m.auditStatus] || m.auditStatus}</span></td>
          </tr>`;
      }).join("");
    }

  } catch (err) {
    console.error("Erro ao carregar stock", err);
    summaryTbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-sm font-bold text-red-500">Erro ao carregar dados</td></tr>`;
    dailyTbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-sm font-bold text-red-500">Erro ao carregar dados</td></tr>`;
  }
}

async function loadProgressHistoryData() {
  if (!state.projectId || state.projectId === "all") return;

  const dailyTbody = document.getElementById("progressDailyTbody");
  if (!dailyTbody) return;

  dailyTbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-sm font-bold text-slate-400">A carregar...</td></tr>`;

  try {
    const res = await apiRequest(`/projects/${state.projectId}/progress-history`);
    const history = res.items || [];

    const fTask = document.getElementById("progressDailyFilterTask")?.value?.toLowerCase() || "";
    const fDate = document.getElementById("progressDailyFilterDate")?.value || "";

    const filtered = history.filter(h => {
      const matchTask = h.task?.description?.toLowerCase().includes(fTask) || false;
      const matchDate = !fDate || (h.date && h.date.startsWith(fDate));
      return matchTask && matchDate;
    });

    if (filtered.length === 0) {
      dailyTbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Sem registos correspondentes</td></tr>`;
    } else {
      dailyTbody.innerHTML = filtered.map(h => {
        const date = h.date ? new Date(h.date).toLocaleDateString("pt-PT") : "—";
        const qtyExec = Number(h.executedQty || 0);
        const qtyAcc = Number(h.accumulatedQty || 0);
        const unit = h.task?.unit || "un";
        const isNegative = qtyExec < 0;
        const colorClass = isNegative ? "text-red-500" : "text-blue-600";
        const sign = isNegative ? "" : "+";

        return `
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 text-xs font-bold text-slate-500">${date}</td>
            <td class="px-4 py-4 font-bold text-slate-900">${escapeHtml(h.task?.description || "—")}</td>
            <td class="px-4 py-4 text-center font-black ${colorClass}">${sign}${qtyExec.toLocaleString("pt-AO")} <span class="text-[9px] text-slate-400">${escapeHtml(unit)}</span></td>
            <td class="px-4 py-4 text-center font-black text-emerald-600">${qtyAcc.toLocaleString("pt-AO")} <span class="text-[9px] text-slate-400">${escapeHtml(unit)}</span></td>
            <td class="px-6 py-4 text-right"><span class="text-xs font-bold text-slate-500">${escapeHtml(h.technicianName || "—")}</span></td>
          </tr>`;
      }).join("");
    }
  } catch (err) {
    console.error("Erro ao carregar histórico de progresso", err);
    dailyTbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-sm font-bold text-red-500">Erro ao carregar dados</td></tr>`;
  }
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

  // Calcular Máximo (Simulação baseada no histórico ou valor atual + margem se não houver dados reais)
  let maxStaff = totalActiveStaff;
  projects.forEach(p => {
    // Se no futuro houver p.maxStaffCount vindo da API, usamos aqui.
    // Por agora, garantimos que o máximo é pelo menos o atual.
    if (p.activeStaffCount > maxStaff) maxStaff = p.activeStaffCount;
  });
  // Se for 0, mantemos 0. Se houver pessoas, mostramos um pico realista (ex: +12% do atual) se não houver registo histórico
  const peak = maxStaff > 0 ? Math.max(maxStaff, Math.round(totalActiveStaff * 2.15)) : 0;
  if (document.getElementById("dashboardMaxStaffCount")) {
    document.getElementById("dashboardMaxStaffCount").textContent = peak;
  }

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

  // Ordenar por grupo para evitar repetições
  tasksToRender.sort((a, b) => (a.itemGroup || "").localeCompare(b.itemGroup || "", 'pt', { sensitivity: 'base' }));

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
    const invVal = groupInvoicingTotals[g] || 0;
    const exdVal = groupInvoicedTotals[g] || 0;
    groupProgressMap[g] = invVal > 0 ? (exdVal / invVal) * 100 : 0;
  });

  // Separar pais ou independentes e as filhas
  const parentsAndOrphans = tasksToRender.filter(t => !t.parentId);
  const children = tasksToRender.filter(t => t.parentId);
  let groupIndex = 0;

  parentsAndOrphans.forEach(t => {
    const safeGroupName = escapeHtml(t.itemGroup || "Outros / Geral");

    if (t.itemGroup !== lastGroup) {
      const tgv = groupInvoicingTotals[t.itemGroup || ""] || 0;
      const tge = groupInvoicedTotals[t.itemGroup || ""] || 0;
      const gPct = groupProgressMap[t.itemGroup || ""] || 0;
      const c = groupCurrencies[t.itemGroup || ""] || "Kz";

      const fPct = `<span class="text-[10px] bg-blue-100 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded-md font-black shadow-sm">${gPct.toFixed(2)}%</span>`;

      html += `
    <tr class="bg-slate-50/80 cursor-pointer select-none group" data-toggle-progress-group="${safeGroupName}">
      <td class="px-6 py-3 border-y border-slate-100 hover:bg-slate-100/50 transition-colors">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-slate-400 group-hover:text-blue-600 transition-colors text-lg" data-icon>expand_more</span>
          <span class="w-1.5 h-3 bg-blue-600 rounded-full"></span>
          <span class="text-[10px] font-black uppercase tracking-[0.2em] text-[#212e3e]">${safeGroupName}</span>
        </div>
      </td>
      <td class="px-4 py-3 border-y border-slate-100 text-center font-bold text-slate-400 text-[10px]">${tgv.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} ${c}</td>
      <td class="px-4 py-3 border-y border-slate-100 text-center font-bold text-slate-400 text-[10px]">${tge.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} ${c}</td>
      <td class="px-6 py-3 border-y border-slate-100 text-right">${fPct}</td>
    </tr>
      `;
      lastGroup = t.itemGroup;
    }

    groupIndex++;
    const subs = children.filter(c => c.parentId === t.id);

    const renderRow = (task, prefixStr, isSub = false, hasChildren = false) => {
      let exp = Number(task.expectedQty || 0);
      let exe = Number(task.executedQty || 0);
      
      const uvS = Number(task.unitValueService || 0);
      const uvM = Number(task.unitValueMaterial || 0);
      const uv = Number(task.unitValue || (uvS + uvM));

      let invoicingVal = uv * exp;
      let invoicedVal = uv * exe;

      if (hasChildren) {
        const subs = children.filter(c => c.parentId === task.id);
        const sInv = subs.reduce((acc, s) => acc + (Number(s.unitValue || 0) * Number(s.expectedQty || 0)), 0);
        const sExd = subs.reduce((acc, s) => acc + (Number(s.unitValue || 0) * Number(s.executedQty || 0)), 0);
        const sExp = subs.reduce((acc, s) => acc + Number(s.expectedQty || 0), 0);
        const sExe = subs.reduce((acc, s) => acc + Number(s.executedQty || 0), 0);
        
        invoicingVal = sInv;
        invoicedVal = sExd;
        exp = sExp;
        exe = sExe;
      }

      const exePct = invoicingVal > 0 ? (invoicedVal / invoicingVal) * 100 : (exe > 0 ? 100 : 0);

      const cStr = task.currency === "USD" ? "USD" : "Kz";
      const uvSStr = uvS > 0 ? `${uvS.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cStr} ` : "-";
      const uvMStr = uvM > 0 ? `${uvM.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cStr} ` : "-";
      const invoicingValStr = invoicingVal > 0 ? `${invoicingVal.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cStr} ` : "-";
      const invoicedValStr = invoicedVal > 0 ? `${invoicedVal.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cStr} ` : "-";

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
                <div class="flex items-center gap-2">
                  ${task.itemCode ? `<span class="text-[9px] font-mono text-slate-400 bg-slate-100 px-1 py-0.5 rounded border border-slate-200/50">${escapeHtml(task.itemCode)}</span>` : ""}
                  <span>${escapeHtml(task.description)}</span>
                </div>
             </div>
          </td>
          <td class="px-4 py-3 text-center text-slate-500">${exp.toLocaleString('pt-AO')} <span class="text-[9px] uppercase tracking-wider">${escapeHtml(task.unit)}</span></td>
          <td class="px-4 py-3 text-center font-bold text-blue-600">
             ${exe.toLocaleString('pt-AO')}
          </td>
          <td class="px-6 py-3 text-right">
             <span class="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-bold">${exePct.toFixed(2)}%</span>
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
        const gPct = groupProgressMap[g] || 0;
        const tgv = groupInvoicingTotals[g] || 0;
        const tge = groupInvoicedTotals[g] || 0;
        const c = (groupCurrencies[g] || "Kz").replace('kz', 'Kz');

        summaryHtml += `
      <tr class="hover:bg-slate-50 transition-colors">
              <td class="px-6 py-4 font-bold text-slate-800 text-xs">${escapeHtml(g)}</td>
              <td class="px-4 py-4 text-center text-[10px] font-bold text-slate-400">${tgv.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} ${c}</td>
              <td class="px-4 py-4 text-center text-[10px] font-bold text-slate-400">${tge.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} ${c}</td>
              <td class="px-4 py-4 text-right">
                 <div class="flex items-center justify-end gap-3">
                     <div class="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                         <div class="h-full bg-blue-500" style="width: ${gPct}%"></div>
                     </div>
                     <span class="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-bold">${gPct.toFixed(2)}%</span>
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
    const url = getAssetUrl(f.path);
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

    // Populate Material Filters
    populateMaterialFilters(allPhotos);

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
    if (state.galleryObraMaterial !== "all") {
      photosObra = photosObra.filter(p => (p.movement?.material?.name || p.description) === state.galleryObraMaterial);
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
    if (state.galleryCampoMaterial !== "all") {
      photosCampo = photosCampo.filter(p => (p.movement?.material?.name || p.description) === state.galleryCampoMaterial);
    }

    renderGallerySection("galleryObraContainer", photosObra, false);
    renderGallerySection("galleryCampoContainer", photosCampo, true);

  } catch (err) {
    console.error(err);
    if (containerObra) containerObra.innerHTML = `<div class="p-8 text-center text-sm font-bold text-red-400">Erro ao carregar fotos.</div>`;
  }
}

function populateMaterialFilters(photos) {
  const obraSelect = document.getElementById("galleryObraFilterMaterial");
  const campoSelect = document.getElementById("galleryCampoFilterMaterial");

  if (!obraSelect || !campoSelect) return;

  const materialsObra = new Set();
  const materialsCampo = new Set();

  photos.forEach(p => {
    const name = p.movement?.material?.name || p.description;
    if (name) {
      if (!p.movementId) materialsObra.add(name);
      else materialsCampo.add(name);
    }
  });

  const updateSelect = (select, materials, currentVal) => {
    const options = Array.from(materials).sort();
    const currentOptions = Array.from(select.options).map(o => o.value);

    // Only re-populate if options changed
    const newOptionsStr = ["all", ...options].join(",");
    const oldOptionsStr = currentOptions.join(",");

    if (newOptionsStr !== oldOptionsStr) {
      select.innerHTML = '<option value="all">Todos os Materiais</option>';
      options.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
      });
      select.value = currentVal;
    }
  };

  updateSelect(obraSelect, materialsObra, state.galleryObraMaterial);
  updateSelect(campoSelect, materialsCampo, state.galleryCampoMaterial);
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
      const url = getAssetUrl(p.path);
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

function toggleTable(tableId, manual = true) {
  const body = document.querySelector(`[data-table-body="${tableId}"]`);
  const btn = document.querySelector(`[data-toggle-table="${tableId}"]`);
  if (!body) return;

  if (manual) {
    state.collapsedTables[tableId] = !state.collapsedTables[tableId];
    localStorage.setItem("InfoCliente.clientCollapsedTables", JSON.stringify(state.collapsedTables));
  }

  const isCollapsed = state.collapsedTables[tableId];
  
  if (isCollapsed) {
    body.classList.add("hidden");
  } else {
    body.classList.remove("hidden");
  }

  if (btn) {
    const icon = btn.querySelector(".material-symbols-outlined");
    if (icon) {
      icon.style.transform = isCollapsed ? "rotate(-90deg)" : "rotate(0deg)";
    }
  }
}

/* =================================================================================
 *  INITIALIZATION & LISTENERS
 * ================================================================================= */

function wireEvents() {
  // Filters
  const filterSelect = document.getElementById("projectFilter");
  if (filterSelect) {
    filterSelect.addEventListener("change", async (e) => {
      state.projectId = e.target.value;
      await renderDashboard(state.projectId);
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

    // Individual Table Toggles
    const toggleTableBtn = e.target.closest("[data-toggle-table]");
    if (toggleTableBtn) {
      const tableId = toggleTableBtn.getAttribute("data-toggle-table");
      toggleTable(tableId, true);
      return;
    }
  });

  // Apply initial states for tables
  document.querySelectorAll("[data-toggle-table]").forEach(btn => {
    const tableId = btn.getAttribute("data-toggle-table");
    toggleTable(tableId, false);
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
  document.getElementById("galleryObraFilterMaterial")?.addEventListener("change", (e) => {
    state.galleryObraMaterial = e.target.value;
    if (state.activeTab === "galeria-obra") loadPhotos();
  });

  // Gallery Filters - Campo
  const updateGalleryCampoDates = () => {
    state.galleryCampoStartDate = document.getElementById("galleryCampoFilterStart")?.value || "";
    state.galleryCampoEndDate = document.getElementById("galleryCampoFilterEnd")?.value || "";
    if (state.activeTab === "galeria-campo") loadPhotos();
  };
  document.getElementById("galleryCampoFilterStart")?.addEventListener("change", updateGalleryCampoDates);
  document.getElementById("galleryCampoFilterEnd")?.addEventListener("change", updateGalleryCampoDates);
  document.getElementById("galleryCampoFilterMaterial")?.addEventListener("change", (e) => {
    state.galleryCampoMaterial = e.target.value;
    if (state.activeTab === "galeria-campo") loadPhotos();
  });

  // Stock Filters
  const reloadStock = () => { if (state.activeTab === "stock") loadStockData(); };
  document.getElementById("stockSummaryFilter")?.addEventListener("input", reloadStock);
  document.getElementById("stockDailyFilterMaterial")?.addEventListener("input", reloadStock);
  document.getElementById("stockDailyFilterDate")?.addEventListener("change", reloadStock);
  document.getElementById("stockDailyFilterType")?.addEventListener("change", reloadStock);

  // Progress Diary Filters
  const reloadProgressDiary = () => { if (state.activeTab === "obra") loadProgressHistoryData(); };
  document.getElementById("progressDailyFilterTask")?.addEventListener("input", reloadProgressDiary);
  document.getElementById("progressDailyFilterDate")?.addEventListener("change", reloadProgressDiary);

  // Tabs — event delegation para funcionar com botões dentro do conteúdo
  document.addEventListener("click", (e) => {
    const tabBtn = e.target?.closest("[data-tab-trigger]");
    if (tabBtn) {
      state.activeTab = tabBtn.getAttribute("data-tab-trigger");
      updateTabUI();
    }
  });

  document.getElementById("btnInteractions")?.addEventListener("click", () => {
    loadInteractions();
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

async function loadInteractions() {
  if (!dashboardData || !dashboardData.clientId) {
    return toast("Dados do cliente não carregados", { type: "error" });
  }

  openModal({
    title: "Histórico de Interação",
    contentHtml: `
          <div id="interactionsContainer" class="flex flex-col gap-4 max-h-[50vh] overflow-y-auto p-4 custom-scroll bg-slate-50/50 rounded-2xl mb-4">
              <div class="flex items-center justify-center p-12">
                  <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
          </div>
          <div class="flex gap-2">
              <input type="text" id="interactionReplyInput" placeholder="Escreva uma resposta..." class="flex-1 h-12 bg-slate-100 border-none rounded-xl px-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 transition-all">
              <button id="btnSendInteraction" class="w-12 h-12 bg-[#0F172A] text-[#2afc8d] rounded-xl flex items-center justify-center hover:scale-105 transition-all shadow-lg active:scale-95 disabled:opacity-50">
                  <span class="material-symbols-outlined">send</span>
              </button>
          </div>
      `,
    onRender: ({ panel }) => {
      const input = panel.querySelector("#interactionReplyInput");
      const btn = panel.querySelector("#btnSendInteraction");
      if (!input || !btn) return;

      const send = async () => {
        const text = input.value.trim();
        if (!text) return;

        setButtonLoading(btn, true);
        btn.disabled = true;
        try {
          await apiRequest(`/clients/${dashboardData.clientId}/interactions`, {
            method: "POST",
            body: {
              type: "CLIENT_REPLY",
              title: "Resposta do Cliente",
              description: text
            }
          });
          input.value = "";
          // Recarregar apenas a lista de interações
          await fetchAndRenderInteractions();
        } catch (err) {
          toast("Erro ao enviar resposta", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
          btn.disabled = false;
          input.focus();
        }
      };

      btn.onclick = send;
      input.onkeydown = (e) => { if (e.key === "Enter") send(); };
    },
    primaryLabel: "Fechar",
    onPrimary: ({ close }) => close()
  });

  const fetchAndRenderInteractions = async () => {
    try {
      const res = await apiRequest(`/clients/${dashboardData.clientId}/interactions`);
    const interactions = res.items || [];

    // Marcar como lidas
    if (interactions.length > 0) {
      const latest = new Date(interactions[0].occurredAt).getTime();
      localStorage.setItem(`lastSeenInteractions_${dashboardData.clientId}`, latest);
      document.getElementById("interactionBadge")?.classList.add("hidden");
    }

    const container = document.getElementById("interactionsContainer");
    if (!container) return;

    if (interactions.length === 0) {
      container.innerHTML = `
              <div class="flex flex-col items-center justify-center p-12 text-center">
                  <span class="material-symbols-outlined text-5xl text-slate-200 mb-4">forum</span>
                  <p class="text-slate-400 font-medium">Sem interações registadas até ao momento.</p>
              </div>
          `;
      return;
    }

    // Inverter para mostrar a mais recente em baixo ou manter a ordem? 
    // Geralmente chat é de cima para baixo (antiga -> nova). 
    // Mas interações de log costumam ser nova -> antiga.
    // Vamos manter Nova -> Antiga (descendente) como está na API, mas inverter para o visual de "mensagens" se quisermos fluxo de chat.
    // O pedido diz "como mensagens", então vamos inverter para fluxo cronológico.
    const chronological = [...interactions].reverse();

    container.innerHTML = chronological.map(i => {
      const date = new Date(i.occurredAt).toLocaleString("pt-PT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });

      const typeLabel = i.type || "Mensagem";

      return `
              <div class="flex flex-col gap-1 mb-2">
                  <div class="flex items-center gap-2 mb-1">
                      <span class="text-[9px] font-black uppercase tracking-widest text-slate-400">${date}</span>
                      <span class="h-px flex-1 bg-slate-200/50"></span>
                      <span class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-[8px] font-black uppercase tracking-widest">${escapeHtml(typeLabel)}</span>
                  </div>
                  <div class="bg-white rounded-2xl rounded-tl-none p-4 border border-slate-100 shadow-sm transition-all hover:border-blue-100">
                      <h4 class="text-xs font-black text-slate-900 mb-1 tracking-tight">${escapeHtml(i.title)}</h4>
                      <p class="text-xs text-slate-600 leading-relaxed font-medium">${escapeHtml(i.description || "")}</p>
                      ${i.leadName ? `
                      <div class="mt-3 pt-3 border-t border-slate-50 flex items-center gap-2">
                          <span class="material-symbols-outlined text-slate-400 text-sm">person</span>
                          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Responsável: ${escapeHtml(i.leadName)}</span>
                      </div>` : ""}
                  </div>
              </div>
          `;
    }).join("");

    // Scroll to bottom to see latest
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 100);

    } catch (err) {
      console.error("Erro ao carregar interações", err);
      const container = document.getElementById("interactionsContainer");
      if (container) {
        container.innerHTML = `<div class="p-8 text-center text-sm font-bold text-red-500">Erro ao carregar interações</div>`;
      }
    }
  };

  await fetchAndRenderInteractions();
}

async function checkInteractionsBadge() {
  if (!dashboardData || !dashboardData.clientId) return;

  try {
    const res = await apiRequest(`/clients/${dashboardData.clientId}/interactions`);
    const interactions = res.items || [];
    if (interactions.length === 0) return;

    const latest = new Date(interactions[0].occurredAt).getTime();
    const lastSeen = Number(localStorage.getItem(`lastSeenInteractions_${dashboardData.clientId}`) || 0);

    const badge = document.getElementById("interactionBadge");
    if (badge && latest > lastSeen) {
      badge.classList.remove("hidden");
    } else if (badge) {
      badge.classList.add("hidden");
    }
  } catch (err) {
    console.warn("Erro ao verificar badge de interações", err);
  }
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

  const user = JSON.parse(localStorage.getItem("InfoCliente.user") || "{}");
  if (user && user.client) {
    const headerName = document.getElementById("clientNameHeader");
    if (headerName) headerName.textContent = user.client.name;
  }

  wireEvents();
  loadDashboardData();
}

document.addEventListener("DOMContentLoaded", init);
