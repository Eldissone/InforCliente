import { apiRequest, getApiBaseUrl } from "../../services/api.js";
import { wireLogout } from "../../shared/session.js";
import { formatCurrencyKZ, formatDateBR } from "../../shared/format.js";
import { toast, initMobileMenu, setButtonLoading, openModal, escapeHtml } from "../../shared/ui.js";

let dashboardData = null;
let charts = {
  finances: null,
  stock: null,
  progress: null
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
  galleryStartDate: "",
  galleryEndDate: ""
};

async function loadDashboardData() {
  try {
    let url = "/dashboard/client-summary";
    const params = new URLSearchParams();
    if (state.startDate) params.append("start", state.startDate);
    if (state.endDate) params.append("end", state.endDate);
    if (params.toString()) url += `?${params.toString()}`;

    dashboardData = await apiRequest(url);

    if (state.projectId === "all" && dashboardData.projects && dashboardData.projects.length > 0) {
      state.projectId = dashboardData.projects[0].id;
    }

    renderDashboard(state.projectId);

    // Update select filter if it still exists (fallback)
    const select = document.getElementById("projectFilter");
    if (select && select.options.length === 1) {
      dashboardData.projects.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
    }

    if (state.activeTab === "arquivos" && state.projectId !== "all") {
       await loadFiles();
    }
    if (state.activeTab === "galeria" && state.projectId !== "all") {
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
  renderProgressGauge(data.overallProgress);
  
  if (projectId !== "all") {
    loadProgressBreakdown(projectId);
  } else {
    document.getElementById("progressBreakdownTbody").innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400">Selecione uma obra no filtro acima para ver os detalhes</td></tr>`;
  }
  
  updateTabUI();
}

function updateTabUI() {
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

  if (state.activeTab === "galeria") {
    if (state.projectId === "all") {
      document.getElementById("galleryGrid").innerHTML = `<div class="col-span-full p-8 text-center text-sm font-bold text-slate-400">Selecione uma obra no filtro acima para ver a galeria.</div>`;
    } else {
      loadPhotos();
    }
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
  const { financials, overallProgress } = data;
  
  document.getElementById("metricTotalContract").textContent = formatCurrencyKZ(financials.totalContract);
  document.getElementById("metricTotalPaid").textContent = formatCurrencyKZ(financials.totalPaid);
  document.getElementById("metricDebt").textContent = formatCurrencyKZ(financials.totalDebt);
  document.getElementById("metricProgress").textContent = `${overallProgress}%`;
  
  const progLine = document.getElementById("progressLine");
  if (progLine) progLine.style.width = `${overallProgress}%`;

  const percentPaid = document.getElementById("percentPaid");
  if (percentPaid && financials.totalContract > 0) {
    const pct = (financials.totalPaid / financials.totalContract) * 100;
    percentPaid.textContent = `${pct.toFixed(1)}%`;
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

  if (charts.finances) charts.finances.destroy();
  charts.finances = new ApexCharts(document.querySelector("#financialChart"), options);
  charts.finances.render();
}

function renderStockChart(stock) {
  const container = document.querySelector("#stockChart");
  if (!stock || stock.length === 0) {
    container.innerHTML = `<div class="text-center"><span class="material-symbols-outlined text-4xl text-slate-100 mb-3">box_add</span><p class="text-xs text-slate-400 font-bold uppercase tracking-widest">Sem Stock Registado</p></div>`;
    return;
  }
  container.innerHTML = "";

  const options = {
    series: stock.map(s => s.qty),
    labels: stock.map(s => `${s.name} (${s.unit})`),
    chart: { type: 'donut', height: 350, fontFamily: 'Inter, sans-serif' },
    colors: ['#0F172A', '#1E293B', '#334155', '#475569', '#2afc8d', '#10b981'],
    legend: { position: 'bottom', fontWeight: 600 },
    stroke: { width: 0 },
    plotOptions: {
      pie: {
        donut: {
          size: '75%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Total Itens',
              formatter: () => stock.reduce((acc, s) => acc + s.qty, 0)
            }
          }
        }
      }
    },
    dataLabels: { enabled: false }
  };

  if (charts.stock) charts.stock.destroy();
  charts.stock = new ApexCharts(container, options);
  charts.stock.render();
}

function renderProgressGauge(progress) {
  const options = {
    series: [progress],
    chart: { height: 350, type: 'radialBar', fontFamily: 'Inter, sans-serif' },
    plotOptions: {
      radialBar: {
        startAngle: -135,
        endAngle: 135,
        hollow: { size: '70%', },
        track: { background: '#f1f5f9', strokeWidth: '97%', margin: 5, },
        dataLabels: {
          name: { show: true, color: '#64748b', fontSize: '12px', fontWeight: 800, offsetY: 20 },
          value: { offsetY: -20, fontSize: '40px', fontWeight: 900, color: '#0F172A', formatter: (val) => `${val}%` }
        }
      }
    },
    fill: {
      type: 'gradient',
      gradient: {
        shade: 'dark',
        type: 'horizontal',
        shadeIntensity: 0.5,
        gradientToColors: ['#2afc8d'],
        inverseColors: true,
        opacityFrom: 1,
        opacityTo: 1,
        stops: [0, 100]
      }
    },
    stroke: { lineCap: 'round' },
    labels: ['Execução Geral'],
  };

  if (charts.progress) charts.progress.destroy();
  charts.progress = new ApexCharts(document.querySelector("#progressGauge"), options);
  charts.progress.render();
}

async function loadProgressBreakdown(projectId) {
  const tbody = document.getElementById("progressBreakdownTbody");
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400">Carregando dados...</td></tr>`;
  
  try {
    const data = await apiRequest(`/projects/${projectId}/progress-tasks`);
    if (!data.tasks || data.tasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Sem tarefas de Avanço Físico registadas</td></tr>`;
      return;
    }
    
    let html = "";
    let lastGroup = null;

    const groupTotals = {};
    const groupCurrencies = {};
    const groupTasks = {};
    data.tasks.forEach(t => {
      const g = t.itemGroup || "";
      if (!groupTotals[g]) groupTotals[g] = 0;
      if (!groupTasks[g]) groupTasks[g] = [];
      
      const exe = Number(t.executedQty || 0);
      const uv = Number(t.unitValue || 0);
      
      groupTotals[g] += (uv * exe);
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

    data.tasks.forEach(t => {
      const safeGroupName = escapeHtml(t.itemGroup || "Outros / Geral");

      if (t.itemGroup !== lastGroup) {
        const c = groupCurrencies[t.itemGroup || ""] || "Kz";
        const tgv = groupTotals[t.itemGroup || ""] || 0;
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
                ${ft}
              </div>
            </td>
          </tr>
        `;
        lastGroup = t.itemGroup;
      }
      
      const exp = Number(t.expectedQty || 0);
      const exe = Number(t.executedQty || 0);
      const exePct = exp > 0 ? Math.round((exe / exp) * 100) : (exe > 0 ? 100 : 0);
      
      const uv = Number(t.unitValue || 0);
      const tv = uv * exe;
      const cStr = t.currency === "USD" ? "USD" : "Kz";
      const tvStr = tv > 0 ? `${tv.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cStr}` : "-";

      html += `
        <tr class="hover:bg-slate-50 transition-colors text-sm" data-progress-item-group="${safeGroupName}">
          <td class="px-6 py-3 font-medium text-slate-800">${escapeHtml(t.description)}</td>
          <td class="px-4 py-3 text-center text-slate-500">${exp.toLocaleString('pt-AO')} <span class="text-[9px] uppercase tracking-wider">${escapeHtml(t.unit)}</span></td>
          <td class="px-4 py-3 text-center">
             <span class="font-bold text-blue-600">${exe.toLocaleString('pt-AO')}</span> 
             <span class="text-[10px] ml-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-bold">${exePct}%</span>
          </td>
          <td class="px-6 py-3 text-right font-bold text-slate-700">${tvStr}</td>
        </tr>
      `;
    });
    
    tbody.innerHTML = html;
  } catch (err) {
    console.error("Erro ao carregar avanço físico", err);
    tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-sm font-bold text-red-500">Erro ao carregar dados do Avanço Físico</td></tr>`;
  }
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
  const grid = document.getElementById("galleryContainer");
  if (!grid) return;

  try {
    grid.innerHTML = `<div class="p-8 text-center text-sm font-bold text-slate-400">Carregando fotos...</div>`;
    
    // Fetch all photos for this project
    const res = await apiRequest(`/projects/${state.projectId}/photos`);
    let photos = res.items || [];
    
    // Filter locally by date
    if (state.galleryStartDate) {
      const gs = new Date(state.galleryStartDate).getTime();
      photos = photos.filter(p => new Date(p.createdAt).getTime() >= gs);
    }
    if (state.galleryEndDate) {
      const ge = new Date(state.galleryEndDate).getTime();
      // To include the whole End Date, add 24 hours to its time logic if needed 
      // or set Hours to 23:59:59. For simplicity:
      const endD = new Date(state.galleryEndDate);
      endD.setHours(23, 59, 59, 999);
      photos = photos.filter(p => new Date(p.createdAt).getTime() <= endD.getTime());
    }
    
    if (photos.length === 0) {
      grid.innerHTML = `<div class="p-8 text-center text-sm font-bold text-slate-400">Nenhum registo fotográfico encontrado.</div>`;
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
       
       let html = `
         <div class="gallery-group mb-8">
            <button class="flex items-center gap-2 mb-4 text-sm font-bold text-slate-800 hover:text-slate-600 transition-colors w-full text-left focus:outline-none" onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('span').innerText = this.nextElementSibling.classList.contains('hidden') ? 'chevron_right' : 'expand_more'">
               <span class="material-symbols-outlined text-lg">expand_more</span>
               ${cat}
            </button>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
       `;
       
       groups[cat].forEach(p => {
         const url = `${getApiBaseUrl()}/${p.path}`;
         // Visual semelhante ao Windows Explorer: miniatura/ícone à esquerda, 3 linhas de texto à direita
         html += `
          <a href="${url}" target="_blank" class="group flex flex-row items-center gap-3 p-2 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer border border-transparent hover:border-slate-200">
            <!-- Miniatura da Foto -->
            <div class="w-10 h-10 shrink-0 rounded overflow-hidden bg-slate-200 shadow-sm relative">
                <img src="${url}" alt="Thumbnail" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 relative z-0" />
            </div>
            <!-- Detalhes estilo File Explorer -->
            <div class="flex-1 min-w-0 flex flex-col justify-center">
               <p class="text-xs font-semibold text-slate-900 truncate leading-tight" title="${escapeHtml(p.description) || "Imagem da Obra"}">
                  ${escapeHtml(p.description) || "Registo Fotográfico"}
               </p>
               <p class="text-[10px] font-medium text-slate-500 truncate leading-tight">
                  Ficheiro JPG
               </p>
               <p class="text-[10px] font-medium text-slate-400 truncate leading-tight">
                  ${formatDateBR(p.createdAt)}
               </p>
            </div>
          </a>
         `;
       });
       
       html += `</div></div>`;
       grid.insertAdjacentHTML("beforeend", html);
    });
  } catch (err) {
    grid.innerHTML = `<div class="p-8 text-center text-sm font-bold text-red-400">Erro ao carregar a galeria</div>`;
  }
}

/* =================================================================================
 *  INITIALIZATION & LISTENERS
 * ================================================================================= */

function wireEvents() {
  // Filters
  const filterSelect = document.getElementById("projectFilterTable");
  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      state.projectId = e.target.value;
      renderDashboard(state.projectId);
    });
  }

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
  });
  const updateDates = () => {
    state.startDate = document.getElementById("filterStart")?.value || "";
    state.endDate = document.getElementById("filterEnd")?.value || "";
    loadDashboardData();
  };

  document.getElementById("filterStart")?.addEventListener("change", updateDates);
  document.getElementById("filterEnd")?.addEventListener("change", updateDates);

  const updateGalleryDates = () => {
    state.galleryStartDate = document.getElementById("galleryFilterStart")?.value || "";
    state.galleryEndDate = document.getElementById("galleryFilterEnd")?.value || "";
    if (state.activeTab === "galeria") loadPhotos();
  };

  document.getElementById("galleryFilterStart")?.addEventListener("change", updateGalleryDates);
  document.getElementById("galleryFilterEnd")?.addEventListener("change", updateGalleryDates);

  // Tabs
  document.querySelectorAll("[data-tab-trigger]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.getAttribute("data-tab-trigger");
      updateTabUI();
    });
  });

  wireFileNavigation();
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
