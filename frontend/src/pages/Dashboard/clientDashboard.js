import { apiRequest, getApiBaseUrl, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

checkAuth({ allowedRoles: ["cliente", "admin", "operador", "user"] });
import { formatCurrencyKZ, formatCurrency, formatDateBR, getExchangeRate } from "../../shared/format.js";
import { toast, initMobileMenu, setButtonLoading, openModal, escapeHtml, renderProductImageThumb } from "../../shared/ui.js";
import {
  parseStockMovementLogistics,
  buildStockMovementDetailHtml,
  buildStockInventoryOnlyHtml,
  computeStockTotals,
  pickPrimaryEntryMovement,
  filterLogisticsEntries,
} from "../../shared/stockDetail.js";

const STOCK_ENTRY_TYPES = new Set(["ENTRY", "TRANSFER_IN", "ENTRADA"]);

function isStockEntryMovement(m) {
  return STOCK_ENTRY_TYPES.has(m.type);
}

let stockPageData = { summary: [], movements: [] };

let dashboardData = null;
let charts = {
  finances: null,
  stock: null,
  progress: null,
  safety: null
};

let state = {
  projectId: null,
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
  stockSubTab: "history",
  stockFilters: {
    search: "",
  },
  selectedStockWarehouseId: null,
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
    } else if ((!state.projectId || state.projectId === "all") && dashboardData.projects && dashboardData.projects.length > 0) {
      state.projectId = dashboardData.projects[0].id;
    }

    renderDashboard(state.projectId);

    // Update select filter if it still exists (fallback)
    const select = document.getElementById("projectFilter");
    if (select) {
      if (select.options.length === 0) {
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
  const data = !projectId
    ? dashboardData
    : filterDataByProject(projectId);

  if (!data) return;

  await updateMetrics(data);
  renderStockChart(data.stock);

  if (projectId) {
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
    loadStock();
  }

  if (state.activeTab === "obra" && dashboardData) {
    loadProgressBreakdown(state.projectId);
    loadProgressHistoryData();
  }
  updateStockRequestsBadge();
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
      photoEl.src = getAssetUrl(project.director.photo);
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



function renderStockChart(stock) {
  // Não é mais usada para render — os dados do stock são carregados via API direta
}

async function loadStock() {
  if (!state.projectId || state.projectId === "all") return;

  const historyTbody = document.getElementById("stockMovementsTbody");
  const inventoryTbody = document.getElementById("stockInventoryTbody");
  const galleryContainer = document.getElementById("stockGalleryContainer");

  if (historyTbody) historyTbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-sm font-bold text-slate-400">A carregar fluxo...</td></tr>`;
  if (inventoryTbody) inventoryTbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-sm font-bold text-slate-400">A carregar inventário...</td></tr>`;

  try {
    const { items: warehouses } = await apiRequest("/warehouses");
    const projectWarehouses = warehouses.filter(
      (w) => w.projectId === state.projectId && w.type === "SITE"
    );
    const hasMultipleWarehouses = projectWarehouses.length > 1;

    if (!projectWarehouses.length) {
      stockPageData = { summary: [], movements: [] };
      state.selectedStockWarehouseId = null;
      renderStockSummaryCards([], []);
      renderStockWarehouseSelector([], null);
      renderStockMovements([]);
      renderStockInventory([], []);
      renderStockGallery([]);
      return;
    }

    if (!state.selectedStockWarehouseId || !projectWarehouses.some((w) => w.id === state.selectedStockWarehouseId)) {
      state.selectedStockWarehouseId = projectWarehouses[0].id;
    }
    const projectWarehouse = projectWarehouses.find((w) => w.id === state.selectedStockWarehouseId) || projectWarehouses[0];

    const movementsUrl = projectWarehouse
      ? `/stock/movements?warehouseId=${encodeURIComponent(projectWarehouse.id)}`
      : `/stock/movements?projectId=${state.projectId}`;

    const balanceUrl = projectWarehouse
      ? `/stock/project/${state.projectId}/balance?warehouseId=${encodeURIComponent(projectWarehouse.id)}`
      : `/stock/project/${state.projectId}/balance`;

    const [balanceRes, movementsRes, photosRes] = await Promise.all([
      apiRequest(balanceUrl),
      apiRequest(movementsUrl),
      apiRequest(`/projects/${state.projectId}/photos`)
    ]);

    const summaryItems = (balanceRes.items || []).filter(
      (item) => item?.product?.category === "MATERIAL" || item?.product?.category === "CONSUMABLE"
    );
    const movements = (movementsRes.items || []).filter(isStockEntryMovement);
    const photos = photosRes.items || [];

    stockPageData = { summary: summaryItems, movements };

    renderStockSummaryCards(summaryItems, movements);
    renderStockWarehouseSelector(projectWarehouses, hasMultipleWarehouses ? projectWarehouse.id : null);
    renderStockMovements(movements);
    renderStockInventory(summaryItems, movements);
    renderStockGallery(photos);

  } catch (err) {
    console.error("Erro ao carregar stock", err);
    toast("Erro ao carregar dados de stock", { type: "error" });
  }
}

function renderStockSummaryCards(summary, movements) {
  const container = document.getElementById("stockSummary");
  if (!container) return;

  const entryMovements = filterLogisticsEntries(movements || []);
  const visibleSummary = (summary || []).filter((item) => {
    const balance = Number(item.quantity || 0);
    const totalIn = entryMovements
      .filter((m) => m.productId === item.productId && String(m.warehouseId || "") === String(item.warehouseId || ""))
      .reduce((acc, m) => acc + Number(m.quantity || 0), 0);
    return balance > 0 || totalIn > 0;
  });

  const uniqueProducts = visibleSummary.length;
  const totalEntries = entryMovements.reduce((acc, m) => acc + Number(m.quantity || 0), 0);
  const currentBalance = visibleSummary.reduce((acc, s) => acc + Number(s.quantity || 0), 0);
  container.innerHTML = `
        <div class="w-full bg-white p-6 rounded-2xl border border-slate-100 shadow-sm min-h-[118px] flex flex-col justify-between">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Total de Artigos</p>
            <p class="text-4xl leading-none font-black text-slate-900">${uniqueProducts}</p>
        </div>
        <div class="w-full bg-white p-6 rounded-2xl border border-slate-100 shadow-sm min-h-[118px] flex flex-col justify-between">
            <p class="text-[10px] font-black uppercase tracking-widest text-emerald-600">Total Recebido (Entradas)</p>
            <p class="text-4xl leading-none font-black text-emerald-600">${totalEntries.toLocaleString("pt-AO")}</p>
        </div>
        <div class="w-full bg-[#0F172A] p-6 rounded-2xl border border-slate-800 shadow-lg min-h-[118px] flex flex-col justify-between">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Saldo em Armazém</p>
            <p class="text-4xl leading-none font-black text-[#2afc8d]">${currentBalance.toLocaleString("pt-AO")}</p>
        </div>
    `;
}

function renderStockWarehouseSelector(projectWarehouses = [], selectedWarehouseId = null) {
  const inventoryContent = document.getElementById("stock_inventory_content");
  if (!inventoryContent) return;

  const existing = document.getElementById("clientStockWarehouseSelectorWrap");
  if (existing) existing.remove();

  if ((projectWarehouses || []).length <= 1) return;

  const wrap = document.createElement("div");
  wrap.id = "clientStockWarehouseSelectorWrap";
  wrap.className = "mb-4 px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3";
  wrap.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-slate-400 text-lg">warehouse</span>
      <div>
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Armazém visível</p>
        <p class="text-[10px] font-bold text-slate-500">${projectWarehouses.length} armazéns disponíveis</p>
      </div>
    </div>
    <div class="flex items-center gap-2 md:min-w-[320px]">
      <select id="clientStockWarehouseSelectInline" class="h-10 w-full bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
        ${projectWarehouses.map((w) => `<option value="${w.id}" ${w.id === selectedWarehouseId ? "selected" : ""}>${escapeHtml(w.name)}</option>`).join("")}
      </select>
    </div>
  `;
  inventoryContent.prepend(wrap);

  const select = document.getElementById("clientStockWarehouseSelectInline");
  select?.addEventListener("change", async (e) => {
    state.selectedStockWarehouseId = e.target.value || null;
    await loadStock();
  });
}

function buildClientEntryStockSummary(productId, warehouseId, warehouseName) {
  const item = stockPageData.summary?.find(
    (s) => s.productId === productId && String(s.warehouseId || "") === String(warehouseId || "")
  );
  const productEntries = filterLogisticsEntries(
    (stockPageData.movements || []).filter(
      (m) => m.productId === productId && String(m.warehouseId || "") === String(warehouseId || "")
    )
  );
  const totalIn = productEntries.reduce((acc, m) => acc + Number(m.quantity || 0), 0);
  return {
    planned: Number(item?.quantityPlanned || 0),
    totalIn,
    balance: Number(item?.quantity || 0),
    warehouseName: warehouseName || item?.warehouse?.name || "Geral",
    entriesOnly: true,
  };
}

function openStockMovementDetailModal(moveId) {
  const movements = document.getElementById("stockMovementsTable")?._movementsData || stockPageData.movements || [];
  const m = movements.find((x) => x.id === moveId);
  if (!m) return;

  const { entries } = pickPrimaryEntryMovement(
    movements.filter(
      (x) => x.productId === m.productId && String(x.warehouseId || "") === String(m.warehouseId || "")
    )
  );

  openModal({
    title: "Detalhes da Entrada em Armazém",
    contentHtml: buildStockMovementDetailHtml(m, {
      entriesOnly: true,
      stockSummary: buildClientEntryStockSummary(m.productId, m.warehouseId, m.warehouse?.name),
      entryHistory: entries,
    }),
    primaryLabel: "Fechar",
    onPrimary: async ({ close }) => close(),
  });
}

function openStockInventoryDetailModal(productId, warehouseId) {
  const summary = stockPageData.summary || [];
  const movements = stockPageData.movements || [];
  const item = summary.find(
    (s) => s.productId === productId && String(s.warehouseId || "") === String(warehouseId || "")
  );
  if (!item) return;

  const stockSummary = buildClientEntryStockSummary(productId, warehouseId);
  const { primary, entries } = pickPrimaryEntryMovement(
    filterLogisticsEntries(
      movements.filter((m) => m.productId === productId && String(m.warehouseId || "") === String(warehouseId || ""))
    )
  );

  if (!primary) {
    openModal({
      title: "Material em Armazém",
      contentHtml: buildStockInventoryOnlyHtml(item, stockSummary, { entriesOnly: true }),
      primaryLabel: "Fechar",
      onPrimary: async ({ close }) => close(),
    });
    return;
  }

  openModal({
    title: "Detalhes da Entrada em Armazém",
    contentHtml: buildStockMovementDetailHtml(primary, {
      entriesOnly: true,
      stockSummary,
      entryHistory: entries,
    }),
    primaryLabel: "Fechar",
    onPrimary: async ({ close }) => close(),
  });
}

function renderStockMovements(items) {
  const tbody = document.getElementById("stockMovementsTbody");
  const table = document.getElementById("stockMovementsTable");
  if (!tbody) return;
  if (table) table._movementsData = items;

  const search = state.stockFilters.search.toLowerCase();

  const filtered = items.filter((m) => {
    if (!isStockEntryMovement(m)) return false;
    const { driverInfo, vehicleInfo } = parseStockMovementLogistics(m);
    return !search ||
      (m.product?.name || "").toLowerCase().includes(search) ||
      (m.notes || "").toLowerCase().includes(search) ||
      driverInfo.toLowerCase().includes(search) ||
      vehicleInfo.toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Sem entradas registadas</td></tr>`;
    return;
  }

  const typeLabel = { ENTRY: "Entrada", ENTRADA: "Entrada", TRANSFER_IN: "Entrada (Transf.)" };
  const typeColor = { ENTRY: "bg-emerald-50 text-emerald-700", ENTRADA: "bg-emerald-50 text-emerald-700", TRANSFER_IN: "bg-emerald-50 text-emerald-700" };

  tbody.innerHTML = filtered.map(m => {
    const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString("pt-PT") : "—";
    const qty = Number(m.quantity || 0);
    const tc = typeColor[m.type] || "bg-slate-50 text-slate-600";

    const { driverInfo: driver, vehicleInfo: vehicle } = parseStockMovementLogistics(m);

    return `
          <tr class="hover:bg-slate-50 transition-colors cursor-pointer" data-view-stock="${m.id}">
            <td class="px-6 md:px-10 py-5 hidden md:table-cell">
                <div class="text-xs font-bold text-slate-900">${date}</div>
                <div class="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1">${m.user?.name || 'Sistema'}</div>
            </td>
            <td class="px-6 md:px-10 py-5">
                <div class="text-xs font-bold text-slate-900">${escapeHtml(m.product?.name || "—")}</div>
                <div class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase inline-block mt-1 ${tc}">${typeLabel[m.type] || m.type}</div>
            </td>
            <td class="px-6 md:px-10 py-5">
                <div class="text-xs font-black text-slate-900">${qty.toLocaleString("pt-AO")} <span class="text-[9px] text-slate-400">${escapeHtml(m.product?.unit || "")}</span></div>
            </td>
            <td class="px-10 py-5 hidden md:table-cell">
                <div class="text-[10px] font-bold text-slate-700">${escapeHtml(driver)}</div>
                <div class="text-[9px] font-black text-slate-400 uppercase tracking-widest">${escapeHtml(vehicle)}</div>
            </td>
            <td class="px-6 md:px-10 py-5 text-right">
                <span class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-emerald-50 text-emerald-600">Aprovado</span>
            </td>
          </tr>`;
  }).join("");
}

function renderStockInventory(summary, movements) {
  const tbody = document.getElementById("stockInventoryTbody");
  const root = document.getElementById("stock_inventory_content");
  if (!tbody) return;

  stockPageData = { summary, movements };
  if (root) {
    root._summary = summary;
    root._movements = movements;
  }

  if (!summary || summary.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Sem stock em armazém</td></tr>`;
    return;
  }

  const entryMovements = filterLogisticsEntries(movements);
  const visibleSummary = summary.filter((item) => {
    const balance = Number(item.quantity || 0);
    const totalIn = entryMovements
      .filter((m) => m.productId === item.productId && String(m.warehouseId || "") === String(item.warehouseId || ""))
      .reduce((acc, m) => acc + Number(m.quantity || 0), 0);
    return balance > 0 || totalIn > 0;
  });

  if (visibleSummary.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Sem stock em armazém</td></tr>`;
    return;
  }

  tbody.innerHTML = visibleSummary.map(item => {
    const saldo = Number(item.quantity || 0);
    const product = item.product || {};
    const warehouseName = item.warehouse?.name || "Geral";
    const colorClass = saldo < 0 ? "text-red-600" : "text-slate-900";

    const totalIn = entryMovements
      .filter((m) => m.productId === item.productId && String(m.warehouseId || "") === String(item.warehouseId || ""))
      .reduce((acc, m) => acc + Number(m.quantity || 0), 0);
    const planned = Number(item.quantityPlanned || 0);

    return `
          <tr class="hover:bg-slate-50 transition-colors cursor-pointer hover:bg-slate-50/80" data-view-inventory="${item.productId}::${item.warehouseId || ""}" title="Clique para ver detalhes da entrada">
            <td class="px-4 py-5 text-center">${renderProductImageThumb(product)}</td>
            <td class="px-6 md:px-10 py-5 font-bold text-slate-900">
                <div class="text-sm">${escapeHtml(product.name || "Desconhecido")}</div>
                <div class="text-[9px] text-slate-400 font-black uppercase tracking-widest">${product.sku || ""}</div>
            </td>
            <td class="px-6 md:px-10 py-5 text-center"><span class="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-widest">${escapeHtml(warehouseName)}</span></td>
            <td class="px-10 py-5 text-center text-[10px] font-bold text-slate-400 hidden sm:table-cell">${escapeHtml(product.unit || "un")}</td>
            <td class="px-10 py-5 text-center text-xs font-black text-blue-600 bg-blue-50/20 hidden md:table-cell">${planned}</td>
            <td class="px-10 py-5 text-center text-xs font-bold text-emerald-600 hidden md:table-cell">${totalIn.toLocaleString("pt-AO")}</td>
            <td class="px-6 md:px-10 py-5 text-right font-black ${colorClass}">${saldo.toLocaleString("pt-AO")}</td>
          </tr>`;
  }).join("");
}

function renderStockGallery(photos) {
  const container = document.getElementById("stockGalleryContainer");
  if (!container) return;

  // Apenas fotos que tenham relação com stock ou sejam da categoria obra mas enviadas via stock
  // Na verdade, projectPhotos podem ter movementId.
  const stockPhotos = photos.filter(p => p.movementId || (p.description && p.description.toLowerCase().includes("stock")));

  if (stockPhotos.length === 0) {
    container.innerHTML = `<div class="p-10 text-center text-sm font-bold text-slate-400 uppercase tracking-widest bg-slate-50 rounded-2xl border border-dashed border-slate-200">Nenhuma evidência fotográfica registada.</div>`;
    return;
  }

  // Agrupar por data
  const groups = {};
  stockPhotos.forEach(p => {
    const d = p.createdAt ? new Date(p.createdAt).toLocaleDateString("pt-PT") : "Sem Data";
    if (!groups[d]) groups[d] = [];
    groups[d].push(p);
  });

  container.innerHTML = Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(date => `
        <div class="space-y-4">
            <div class="flex items-center gap-3">
                <span class="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-200"></span>
                <h4 class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">${date}</h4>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                ${groups[date].map(p => `
                    <div data-preview-photo="${p.id}" class="aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-100 hover:scale-105 active:scale-95 transition-all cursor-pointer shadow-sm">
                        <img src="${getAssetUrl(p.path)}" class="w-full h-full object-cover" loading="lazy" />
                    </div>
                `).join("")}
            </div>
        </div>
    `).join("");
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
          <span class="material-symbols-outlined text-slate-400 group-hover:text-blue-600 transition-colors text-lg" data-icon style="transform: rotate(-90deg);">expand_more</span>
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
      <tr class="hover:bg-slate-50 transition-colors text-sm ${parentClass} hidden" data-progress-item-group="${safeGroupName}" ${toggleAttr}>
          <td class="py-3 ${descClass} ${indentStyle}">
             <div class="flex items-center">
                ${iconSub}
                ${hasChildren ? `<span class="material-symbols-outlined text-slate-400 mr-2 text-lg" data-sub-icon style="transform: rotate(-90deg);">expand_more</span>` : ""}
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
  if (!state.projectId || state.projectId === "all") return;
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
  state.files = files; // Store files for lookup in openPreview

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
      <tr class="hover:bg-slate-50/50 transition-colors group cursor-pointer" data-preview-file="${f.id}">
        <td class="px-8 py-4">
          <div class="flex items-center gap-3">
             <div class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500"><span class="material-symbols-outlined">description</span></div>
             <span class="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">${escapeHtml(f.originalName)}</span>
          </div>
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
  let html = `<button data-go-folder="root" class="hover:text-slate-900 transition-colors flex items-center gap-1"><span class="material-symbols-outlined text-sm">home</span> Geral</button>`;

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
      select.innerHTML = '<option value="all">Todos as tarefas</option>';
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

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function openPreview(fileId) {
  const file = state.files.find(f => f.id === fileId);
  if (!file) return;

  const fileUrl = getAssetUrl(file.path);

  document.getElementById("previewFileName").textContent = file.originalName;
  document.getElementById("previewFileMeta").textContent = `${formatBytes(file.size)} • ${formatDateBR(file.createdAt)} • ${file.category}`;
  const downloadBtn = document.getElementById("previewDownloadBtn");
  downloadBtn.href = fileUrl;
  downloadBtn.setAttribute("download", file.originalName);

  const body = document.getElementById("previewBody");
  body.innerHTML = "";

  const mime = (file.mimeType || "").toLowerCase();

  if (mime.startsWith("image/")) {
    body.innerHTML = `<img src="${fileUrl}" class="max-w-full max-h-full rounded-lg shadow-lg object-contain" />`;
  } else if (mime === "application/pdf") {
    body.innerHTML = `<iframe src="${fileUrl}" class="w-full h-full rounded-lg border-0 bg-white"></iframe>`;
  } else {
    body.innerHTML = `
      <div class="text-center">
        <span class="material-symbols-outlined text-7xl text-slate-200 mb-6">description</span>
        <p class="text-slate-500 font-bold mb-4 text-sm">Este arquivo não suporta pré-visualização direta.</p>
        <a href="${fileUrl}" download="${file.originalName}" class="inline-flex items-center gap-2 bg-[#0F172A] text-white px-8 py-3 rounded-xl font-bold hover:scale-105 transition-all">
          <span class="material-symbols-outlined">download</span> Download do Arquivo
        </a>
      </div>
    `;
  }

  document.getElementById("previewPanel").classList.add("open");
  document.getElementById("previewBackdrop").classList.add("open");
}

function wirePreview() {
  document.getElementById("closePreviewBtn")?.addEventListener("click", () => {
    document.getElementById("previewPanel").classList.remove("open");
    document.getElementById("previewBackdrop").classList.remove("open");
  });

  document.getElementById("previewBackdrop")?.addEventListener("click", () => {
    document.getElementById("previewPanel").classList.remove("open");
    document.getElementById("previewBackdrop").classList.remove("open");
  });

  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-preview-file]");
    if (card && !e.target.closest("button") && !e.target.closest("a")) {
      const id = card.getAttribute("data-preview-file");
      openPreview(id);
    }
  });
}

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
      const date = galleryItem.getAttribute("data-preview-date") || "";
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

// --- Wire Events ---
function wireStockEvents() {
  // Sub-tabs
  document.querySelectorAll("[data-stock-subtab]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.stockSubTab = btn.getAttribute("data-stock-subtab");

      // Update buttons UI
      document.querySelectorAll("[data-stock-subtab]").forEach(b => {
        b.classList.remove("text-slate-900", "border-slate-900");
        b.classList.add("text-slate-400", "border-transparent");
      });
      btn.classList.add("text-slate-900", "border-slate-900");
      btn.classList.remove("text-slate-400", "border-transparent");

      // Update content visibility
      const historyContent = document.getElementById("stock_history_content");
      const inventoryContent = document.getElementById("stock_inventory_content");
      const galleryContent = document.getElementById("stock_gallery_content");
      const requestsContent = document.getElementById("stock_requests_content");

      if (historyContent) historyContent.classList.add("hidden");
      if (inventoryContent) inventoryContent.classList.add("hidden");
      if (galleryContent) galleryContent.classList.add("hidden");
      if (requestsContent) requestsContent.classList.add("hidden");

      const targetContent = document.getElementById(`stock_${state.stockSubTab}_content`);
      if (targetContent) targetContent.classList.remove("hidden");

      if (state.stockSubTab === "requests") {
        loadStockRequests();
      }
    });
  });

  // Initial badge update
  updateStockRequestsBadge();

  document.addEventListener("click", (e) => {
    const rowStock = e.target.closest("[data-view-stock]");
    if (rowStock) {
      openStockMovementDetailModal(rowStock.dataset.viewStock);
      return;
    }
    const rowInv = e.target.closest("[data-view-inventory]");
    if (rowInv) {
      const [productId, warehouseId] = String(rowInv.dataset.viewInventory || "").split("::");
      openStockInventoryDetailModal(productId, warehouseId || null);
    }
  });
}

async function updateStockRequestsBadge() {
  try {
    if (!state.projectId || state.projectId === "all") return;
    const plans = await apiRequest(`/daily-plans/all-pending?projectId=${encodeURIComponent(state.projectId)}`);
    const badge = document.getElementById("stock_requests_badge");
    if (badge) {
      if (plans.length > 0) {
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }
  } catch (err) {
    console.error("Erro ao atualizar stock badge:", err);
  }
}

async function loadStockRequests() {
  const container = document.getElementById("stockRequestsContainer");
  if (!container) return;

  if (!state.projectId || state.projectId === "all") {
    container.innerHTML = `<div class="p-10 text-center text-slate-400 font-bold">Selecione uma obra para ver os pedidos.</div>`;
    return;
  }

  container.innerHTML = `<div class="p-10 text-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto"></div></div>`;

  try {
    const plans = await apiRequest(`/daily-plans/all-pending?projectId=${encodeURIComponent(state.projectId)}`);

    if (!plans || plans.length === 0) {
      container.innerHTML = `
                <div class="p-10 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-100">
                    <span class="material-symbols-outlined text-4xl text-slate-300 mb-2">fact_check</span>
                    <p class="text-slate-500 font-bold">Sem pedidos pendentes para esta obra.</p>
                </div>
            `;
      return;
    }

    const esc = (t) => (t || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    container.innerHTML = plans.map(p => `
            <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col lg:flex-row">
                <div class="p-6 flex-1">
                    <div class="flex items-center gap-3 mb-4">
                        <span class="px-2 py-1 bg-amber-100 text-amber-600 rounded-lg text-[10px] font-black tracking-widest uppercase">Aguardando Material</span>
                        <span class="text-xs font-bold text-slate-400">${new Date(p.date).toLocaleDateString('pt-PT')}</span>
                    </div>
                    <h3 class="text-lg font-bold text-slate-900 mb-1">${esc(p.description || "Sem descrição")}</h3>
                    <p class="text-xs text-slate-500 mb-4">${p.tasks.length} Tarefas associadas</p>

                    <div class="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <h5 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">inventory_2</span> Materiais Requisitados
                        </h5>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            ${p.materials.map(m => `
                                <div class="bg-white rounded-xl p-3 shadow-sm border border-slate-100 flex items-center justify-between">
                                    <span class="text-sm font-bold text-slate-800 line-clamp-1">${esc(m.product?.name || "Desconhecido")}</span>
                                    <span class="bg-amber-100 text-amber-800 px-2 py-1 rounded-lg text-xs font-black">${m.requestedQty}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                </div>
            </div>
        `).join('');

  } catch (err) {
    container.innerHTML = `<div class="p-8 text-center text-red-600 bg-red-50 rounded-2xl font-bold">Erro: ${err.message}</div>`;
  }
}

// O cliente apenas visualiza, por isso removemos a função providePlanMaterialsGlobal deste ficheiro

// Filtro de pesquisa do diário (apenas entradas)
const searchInput = document.getElementById("stockFilterSearch");

if (searchInput) {
  searchInput.addEventListener("input", () => {
    state.stockFilters.search = searchInput.value;
    renderStockMovements(stockPageData.movements || []);
  });
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
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lightbox = document.getElementById("imageLightbox");
  if (!lightbox) return;
  lightbox.classList.remove("active");
  document.body.style.overflow = "";
}

function hoistTabs() {
  // Ensure all .tab-content divs are direct children of <main>
  // This corrects any HTML nesting errors without touching the HTML source
  const main = document.querySelector("main");
  if (!main) return;
  document.querySelectorAll(".tab-content").forEach(tab => {
    if (tab.parentElement !== main) {
      main.appendChild(tab);
    }
  });
}

function init() {
  hoistTabs(); // Fix any tab nesting issues first
  initMobileMenu();
  wireLogout();

  const user = JSON.parse(localStorage.getItem("InfoCliente.user") || "{}");
  if (user) {
    const userDisplay = document.getElementById("userName");
    if (userDisplay) userDisplay.textContent = user.name || user.email || "Cliente";

    // Se for um cliente, podemos mostrar também o nome da empresa se houver um local para isso
    const clientHeader = document.getElementById("clientNameHeader");
    if (clientHeader && user.client) {
      clientHeader.textContent = user.client.name;
    }
  }

  wireUsersNav();
  wireEvents();
  wirePreview();
  wireStockEvents();
  loadDashboardData();

  // Global click for photos and lightbox
  document.addEventListener("click", e => {
    const photoItem = e.target.closest("[data-preview-photo]");
    if (photoItem) {
      const img = photoItem.querySelector("img");
      if (img) {
        openLightbox(img.src, "Evidência de Obra", "");
      }
      return;
    }

    if (e.target.id === "imageLightbox" || e.target.closest("#closeLightbox")) {
      closeLightbox();
    }
  });

  // ESC key for Lightbox
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeLightbox();
  });
}

document.addEventListener("DOMContentLoaded", init);
