import { apiRequest, apiUpload, getApiBaseUrl, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, toast, setButtonLoading, renderLoadingRow, initMobileMenu, escapeHtml } from "../../shared/ui.js";
import { formatCurrency, formatDateBR, formatPercent, getExchangeRate } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";
import { getSessionUser, getToken } from "../../services/auth.js";

checkAuth({ allowedRoles: ["admin", "operador", "cliente"] });

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function el(id) {
  return document.getElementById(id);
}

function getProjectId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function applyRoleVisibility() {
  const user = getSessionUser();
  const role = user?.role || "leitura";
  document.querySelectorAll("[data-role-visible]").forEach(el => {
    const roles = el.getAttribute("data-role-visible").split(",");
    if (roles.includes(role)) {
      el.classList.remove("hidden");
      if (el.tagName === "BUTTON") el.style.display = "flex";
    } else {
      el.classList.add("hidden");
      el.style.display = "none";
    }
  });
}


function statusLabel(s) {
  if (s === "PAID") return { text: "Liquidado", cls: "text-emerald-700", dot: "bg-[#2afc8d]" };
  if (s === "LATE") return { text: "Atrasado", cls: "text-error", dot: "bg-error" };
  return { text: "Pendente", cls: "text-slate-400", dot: "bg-slate-300" };
}

function catLabel(c) {
  const map = {
    MATERIALS: "Materiais",
    EQUIPMENT: "Equipamentos",
    LABOR: "MÃ£o de Obra",
    OTHER: "Outros",
    MATERIAIS_INSUMOS: "Materiais e Insumos",
    SERVICOS_MAO_DE_OBRA: "MÃ£o de Obra e ServiÃ§os",
    GASTOS_PESSOAL: "Gastos com Pessoal",
    DESPESAS_OPERACIONAIS: "Despesas Operacionais",
    INVESTIMENTOS: "Pagamentos",
    DEPRECIACAO: "DepreciaÃ§Ã£o",
    OUTRAS_DESPESAS: "Outras Despesas",
    DEDUCOES: "DeduÃ§Ã£o de Custos",
    IMPOSTOS: "Impostos",
  };
  return map[c] || c || "â€”";
}
const unitMap = {
  un: "UN",
  mts: "MTS",
  km: "KM",
  m2: "M2",
  m3: "M3",
  kg: "KG",
  ton: "TON",
  par: "PAR",
  litros: "LITROS",
  horas: "HORAS",
  dias: "DIAS",
  mes: "MÃŠS",
  global: "GLOBAL",
};

function formatUnit(u) {
  const key = String(u || "un").toLowerCase().trim();
  return unitMap[key] || key.toUpperCase();
}

function renderTxRow(t) {
  const st = statusLabel(t.status);
  return `
    <tr class="hover:bg-slate-50 transition-colors group">
      <td class="px-10 py-5 text-xs font-semibold text-slate-500">${formatDateBR(t.date)}</td>
      <td class="px-10 py-5">
        <div class="font-bold text-slate-900">${t.description}</div>
      </td>
      <td class="px-10 py-5">
        <span class="bg-slate-100 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-500">${catLabel(t.category)}</span>
      </td>
      <td class="px-10 py-5">
        <div class="flex items-center gap-2 ${st.cls}">
          <span class="w-1.5 h-1.5 rounded-full ${st.dot} shadow-sm"></span>
          <span class="text-[10px] font-black uppercase tracking-widest">${st.text}</span>
        </div>
      </td>
      <td class="px-10 py-5 text-right font-black text-slate-900">
        ${formatCurrency(t.amount, projectState?.currency)}
        ${t.realizedAmount != null && t.realizedAmount !== t.amount ? `<div class="text-[9px] text-emerald-600 font-black mt-1">REAL: ${formatCurrency(t.realizedAmount, projectState?.currency)}</div>` : ""}
      </td>
      <td class="px-10 py-5 text-center">
        ${t.status !== "PAID" ? `
          <button data-liquidate-tx="${t.id}" data-tx-desc="${escapeHtml(t.description)}" data-tx-amount="${t.amount}" title="Liquidado" class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all mx-auto">
            <span class="material-symbols-outlined text-lg">check_circle</span>
          </button>
        ` : `
          <div class="w-8 h-8 rounded-lg bg-slate-50 text-slate-300 flex items-center justify-center mx-auto">
            <span class="material-symbols-outlined text-lg">done_all</span>
          </div>
        `}
      </td>
    </tr>
  `;
}

function renderFileCard(f) {
  const isImage = f.mimeType.startsWith("image/");
  const icon = isImage ? "image" : (f.mimeType === "application/pdf" ? "picture_as_pdf" : "description");
  const iconColor = isImage ? "text-blue-500" : (f.mimeType === "application/pdf" ? "text-red-500" : "text-slate-400");
  const fileUrl = getAssetUrl(f.path);

  return `
    <div data-preview-file="${f.id}" class="bg-white rounded-[32px] p-6 border border-slate-100 shadow-sm hover:shadow-xl hover:scale-[1.02] transition-all group cursor-pointer overflow-hidden relative">
        <div class="flex items-start justify-between mb-6">
            <div class="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center ${iconColor}">
                <span class="material-symbols-outlined text-2xl">${icon}</span>
            </div>
            <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                <button data-delete-file="${f.id}" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all">
                    <span class="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        </div>
        <div class="mb-6">
            <h4 class="text-sm font-bold text-slate-900 truncate" title="${escapeHtml(f.originalName)}">${escapeHtml(f.originalName)}</h4>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">${formatBytes(f.size)}à ${formatDateBR(f.createdAt)}</p>
        </div>
        <a href="${fileUrl}" download="${f.originalName}" class="block w-full text-center py-3 bg-slate-50 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-900 hover:text-white transition-all">
            Transferir
        </a>
    </div>
  `;
}

function renderFolderCard(f) {
  return `
    <div data-enter-folder="${f.id}" data-folder-name="${escapeHtml(f.name)}" class="bg-white rounded-[32px] p-6 border border-slate-100 shadow-sm hover:shadow-xl hover:scale-[1.02] transition-all group cursor-pointer">
        <div class="flex items-start justify-between mb-6">
            <div class="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <span class="material-symbols-outlined text-3xl">folder</span>
            </div>
            <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                <button data-edit-folder="${f.id}" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all">
                    <span class="material-symbols-outlined text-sm">edit</span>
                </button>
                <button data-delete-folder="${f.id}" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all">
                    <span class="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        </div>
        <div>
            <h4 class="text-sm font-bold text-slate-900 truncate">${escapeHtml(f.name)}</h4>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">Pasta de Sistema</p>
        </div>
    </div>
  `;
}

async function loadProject() {
  const id = getProjectId();
  const data = await apiRequest(`/projects/${encodeURIComponent(id)}`);
  const p = data.project;
  projectState = p;

  el("projectTitle").textContent = p.name;
  if (el("projectType")) el("projectType").textContent = p.projectType || "TIPO DE OBRA NÃO DEFINIDO";
  el("projectBreadcrumb").textContent = p.code;
  el("projectClientName").textContent = p.client?.name || "Sem cliente vinculado";
  el("projectClientCode").textContent = p.client?.code || "Sem código";
  el("projectContact").textContent = p.contact || "-";
  el("projectLocation").textContent = p.location || p.region || "-";

  const total = Number(p.budgetTotal || 0);
  const consumed = Number(p.budgetConsumed || 0);
  const committed = Number(p.budgetCommitted || 0);
  // Always re-derive available so it's consistent even if DB lags
  const available = total - consumed - committed;

  const primaryCurrency = projectState?.currency || "AOA";
  const exchangeRate = await getExchangeRate();
  const secondaryCurrency = primaryCurrency === "USD" ? "AOA" : "USD";
  const convertedTotal = primaryCurrency === "USD" ? total * exchangeRate : total / exchangeRate;

  el("budgetTotal").textContent = formatCurrency(total, primaryCurrency);
  if (el("budgetTotalSecondary")) {
    el("budgetTotalSecondary").textContent = formatCurrency(convertedTotal, secondaryCurrency);
  }

  el("budgetConsumed").textContent = formatCurrency(consumed, primaryCurrency);
  el("budgetCommitted").textContent = "-" + formatCurrency(Math.max(0, committed), primaryCurrency);
  el("budgetAvailable").textContent = formatCurrency(available, primaryCurrency);

  const pct = total > 0 ? Math.round((consumed / total) * 100) : 0;
  el("budgetDelta").textContent = `Consumido: ${formatPercent(pct, { digits: 0 })}`;
  if (el("budgetBar")) el("budgetBar").style.width = `${Math.max(0, Math.min(100, pct))}%`;

  const progress = Number(p.physicalProgressPct || 0).toFixed(2);
  el("physicalProgress").textContent = `${progress}%`;
  if (el("physicalProgressPie")) {
    el("physicalProgressPie").style.background = `conic-gradient(#2afc8d 0%, #2afc8d ${progress}%, #f1f5f9 ${progress}%, #f1f5f9 100%)`;
  }

  el("projectStartDate").textContent = formatDateBR(p.startDate);
  el("projectDueDate").textContent = formatDateBR(p.dueDate);
  updateDateAnalysis(p);

  // New: Update Operation Status (CBS)
  if (p.cbsSummary) {
    updateOperationStatus(p.cbsSummary);
  }

  return p;
}

let projectState = null;
let txState = { search: "" };
let fileState = { currentFolderId: null, breadcrumbs: [], items: [], folders: [] };
let stockState = { items: [], filters: { search: "", category: "", condition: "", status: "", warehouse: "" } };
let galleryState = { items: [] }; // Cache para fotos da galeria

function updateOperationStatus(summary) {
  const mapping = {
    SERVICOS_MAO_DE_OBRA: "stat_labor",
    MATERIAIS_INSUMOS: "stat_materials",
    GASTOS_PESSOAL: "stat_pessoal",
    DESPESAS_OPERACIONAIS: "stat_operacional",
    INVESTIMENTOS: "stat_investimento",
    DEPRECIACAO: "stat_depreciacao",
    IMPOSTOS: "stat_impostos",
    DEDUCOES: "stat_deducoes",
    OUTRAS_DESPESAS: "stat_outras"
  };

  Object.entries(mapping).forEach(([cat, idPrefix]) => {
    const data = summary[cat] || { budgeted: 0, realized: 0 };
    const pctEl = el(`${idPrefix}_pct`);
    const subEl = el(`${idPrefix}_sub`);

    if (pctEl) {
      const pct = data.budgeted > 0 ? Math.round((data.realized / data.budgeted) * 100) : (data.realized > 0 ? 100 : 0);
      pctEl.textContent = `${pct}%`;

      // Visual indicator if over budget
      if (pct > 100) {
        pctEl.classList.remove("text-[#2afc8d]", "text-[#0d3fd1]", "text-yellow-400", "text-orange-400", "text-emerald-400", "text-slate-400", "text-red-400", "text-purple-400", "text-slate-300");
        pctEl.classList.add("text-error", "animate-pulse");
      }
    }

    if (subEl) {
      if (data.budgeted > 0 || data.realized > 0) {
        subEl.textContent = `${formatCurrency(data.realized, projectState?.currency)} / ${formatCurrency(data.budgeted, projectState?.currency)}`;
        subEl.classList.remove("text-slate-400");
        subEl.classList.add("text-slate-200");
      } else {
        subEl.textContent = "Sem lançamentos";
      }
    }
  });
}

function updateDateAnalysis(p) {
  if (!el("daysRemaining")) return;
  const now = new Date();
  const due = p.dueDate ? new Date(p.dueDate) : null;
  const start = p.startDate ? new Date(p.startDate) : null;

  if (due) {
    const diffTime = due - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      el("daysRemaining").textContent = `${diffDays} Dias Restantes`;
      el("dateAnalysis")?.classList.remove("bg-error/10", "border-error/20", "text-error");
      el("dateAnalysis")?.classList.add("bg-primary/5", "border-primary/10", "text-primary");
    } else if (diffDays === 0) {
      el("daysRemaining").textContent = "Entrega Hoje";
      el("dateAnalysis")?.classList.add("bg-warning/10", "border-warning/20");
    } else {
      el("daysRemaining").textContent = `${Math.abs(diffDays)} Dias de Atraso`;
      el("dateAnalysis")?.classList.remove("bg-primary/5", "border-primary/10", "text-primary");
      el("dateAnalysis")?.classList.add("bg-error/10", "border-error/20", "text-error");
    }
  } else {
    el("daysRemaining").textContent = "Sem prazo definido";
  }
}

async function loadTransactions() {
  const id = getProjectId();
  const tbody = el("transactionsTbody");
  if (!tbody) return;

  tbody.innerHTML = renderLoadingRow(7);
  const qs = new URLSearchParams({
    search: txState.search,
    page: "1",
    pageSize: "20",
  });
  const data = await apiRequest(`/projects/${encodeURIComponent(id)}/transactions?${qs.toString()}`);
  tbody.innerHTML = data.items.map(renderTxRow).join("");
}

/**
 * Renderiza a Curva S com barras simples HTML/CSS usando dados reais.
 * @param {Array}  allTxs      - todos os lançamentos do projeto
 * @param {Object} project     - dados do projeto (startDate, dueDate, budgetTotal)
 * @param {Array}  budgetLines - linhas de orÃ§amento
 */
function renderScurve(allTxs, project, budgetLines) {
  const container = el("scurve_container");
  if (!container) return;

  const totalBudget = Number(project.budgetTotal || 0);
  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  // --- Intervalo real do projeto ---
  const startDate = project.startDate ? new Date(project.startDate) : new Date();
  const dueDate = project.dueDate ? new Date(project.dueDate) : new Date(startDate.getFullYear(), startDate.getMonth() + 11, 1);
  const rangeStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const rangeEnd = new Date(dueDate.getFullYear(), dueDate.getMonth(), 1);
  if (rangeEnd <= rangeStart) rangeEnd.setMonth(rangeStart.getMonth() + 2);

  // Construir lista de meses
  const projectMonths = [];
  const cur = new Date(rangeStart);
  while (cur <= rangeEnd) {
    projectMonths.push({
      year: cur.getFullYear(),
      month: cur.getMonth(),
      label: `${monthNames[cur.getMonth()]}/${String(cur.getFullYear()).slice(2)}`
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  const numMonths = projectMonths.length;

  const getColIdx = (d) => {
    const fd = new Date(d.getFullYear(), d.getMonth(), 1);
    if (fd < rangeStart) return 0;
    if (fd > rangeEnd) return numMonths - 1;
    return (fd.getFullYear() - rangeStart.getFullYear()) * 12 + (fd.getMonth() - rangeStart.getMonth());
  };

  // --- Planejado: idÃªntico Ã  coluna "Previsto (P.)" da tabela ---
  // 1) Budget lines distribuÃ­das linearmente (excluindo capital)
  const plannedByMonth = Array(numMonths).fill(0);
  const opLines = (budgetLines || []).filter(l => !["INVESTIMENTOS", "DEPRECIACAO"].includes(l.category));
  if (opLines.length > 0) {
    opLines.forEach(l => {
      const perMonth = Number(l.total || 0) / numMonths;
      for (let i = 0; i < numMonths; i++) plannedByMonth[i] += perMonth;
    });
  } else if (totalBudget > 0) {
    const perMonth = totalBudget / numMonths;
    for (let i = 0; i < numMonths; i++) plannedByMonth[i] = perMonth;
  }

  // 2) TransaÃ§Ãµes PENDING/LATE adicionadas ao mÃªs especÃ­fico da data (tal como a tabela)
  (allTxs || []).filter(t => t.status === "PENDING" || t.status === "LATE").forEach(t => {
    const idx = getColIdx(new Date(t.date));
    const cat = t.category || "";
    if (!["INVESTIMENTOS", "DEPRECIACAO"].includes(cat)) {
      plannedByMonth[idx] += Number(t.amount || 0);
    }
  });

  // --- Realizado: PAID â†’ realizedAmount ou amount (excluindo capital) ---
  const realizedByMonth = Array(numMonths).fill(0);
  (allTxs || []).filter(t => t.status === "PAID").forEach(t => {
    const cat = t.category || "";
    if (!["INVESTIMENTOS", "DEPRECIACAO"].includes(cat)) {
      const idx = getColIdx(new Date(t.date));
      realizedByMonth[idx] += Number(t.realizedAmount != null ? t.realizedAmount : t.amount || 0);
    }
  });

  // --- Acumulados (Curva S) ---
  const today = new Date();
  const todayIdx = getColIdx(today);
  const planCum = [];
  const realCum = [];
  let sumP = 0, sumR = 0;
  for (let i = 0; i < numMonths; i++) {
    sumP += plannedByMonth[i];
    planCum.push(sumP);
    if (i <= todayIdx) {
      sumR += realizedByMonth[i];
      realCum.push(sumR);
    } else {
      realCum.push(null);
    }
  }

  const maxVal = Math.max(...planCum, ...realCum.filter(v => v !== null), 1);

  // --- DEBUG (remover depois) ---
  console.group("Curva S Diagnóstico");
  console.log("totalBudget:", totalBudget);
  console.log("opLines:", opLines.length, opLines.map(l => `${l.description}=${l.total}`));
  console.log("allTxs:", (allTxs || []).length, "| PENDING/LATE:", (allTxs || []).filter(t => t.status === "PENDING" || t.status === "LATE").length, "| PAID:", (allTxs || []).filter(t => t.status === "PAID").length);
  console.log("plannedByMonth:", plannedByMonth.map((v, i) => `${projectMonths[i].label}:${Math.round(v)}`).join(" | "));
  console.log("realizedByMonth:", realizedByMonth.map((v, i) => `${projectMonths[i].label}:${Math.round(v)}`).join(" | "));
  console.log("planCum[-1]:", Math.round(planCum.at(-1)), "| realCum last:", Math.round(realCum.filter(v => v !== null).at(-1) ?? 0), "| maxVal:", Math.round(maxVal));
  console.groupEnd();

  const formatKZ = (v) => {
    if (v == null || v === 0) return "0";
    if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return String(Math.round(v));
  };

  // --- Renderizar barras via DOM API (evita bloqueio CSP de inline styles) ---
  container.innerHTML = "";
  container.style.overflowX = "auto";

  const wrap = document.createElement("div");
  wrap.style.cssText = `display:flex;align-items:flex-end;gap:6px;height:220px;padding:0 4px 28px;min-width:${numMonths * 48}px;`;
  container.appendChild(wrap);

  const isCurrent = (i) => i === Math.min(todayIdx, numMonths - 1);

  projectMonths.forEach((m, i) => {
    const pH = planCum[i] != null ? Math.max(2, Math.round((planCum[i] / maxVal) * 100)) : 0;
    const rH = realCum[i] != null ? Math.max(2, Math.round((realCum[i] / maxVal) * 100)) : 0;
    const isNow = isCurrent(i);
    const hasPaid = realCum[i] != null && realCum[i] > 0;
    const over = hasPaid && realCum[i] > planCum[i];

    // Coluna do mÃªs
    const col = document.createElement("div");
    col.style.cssText = "flex:1;min-width:36px;position:relative;height:100%;";

    // Barra Planejado (fundo, azul claro)
    const barPlan = document.createElement("div");
    barPlan.title = `Planejado: ${formatKZ(planCum[i])} kz`;
    barPlan.style.position = "absolute";
    barPlan.style.bottom = "0";
    barPlan.style.left = "0";
    barPlan.style.width = "100%";
    barPlan.style.height = pH + "%";
    barPlan.style.backgroundColor = isNow ? "#93c5fd" : "#bfdbfe";
    barPlan.style.borderRadius = "4px 4px 0 0";
    barPlan.style.transition = "height 0.6s ease";
    col.appendChild(barPlan);

    // Barra Realizado (frente, verde ou vermelho se acima do planejado)
    if (realCum[i] != null) {
      const barReal = document.createElement("div");
      barReal.title = `Realizado: ${formatKZ(realCum[i])} kz`;
      barReal.style.position = "absolute";
      barReal.style.bottom = "0";
      barReal.style.left = "20%";
      barReal.style.width = "60%";
      barReal.style.height = rH + "%";
      barReal.style.backgroundColor = over ? "#f87171" : "#2afc8d";
      barReal.style.borderRadius = "4px 4px 0 0";
      barReal.style.transition = "height 0.7s ease 0.1s";
      if (hasPaid) barReal.style.boxShadow = "0 0 10px rgba(42,252,141,0.6)";
      col.appendChild(barReal);
    }

    // Label do mÃªs
    const label = document.createElement("span");
    label.textContent = m.label;
    label.style.position = "absolute";
    label.style.bottom = "-20px";
    label.style.left = "50%";
    label.style.transform = "translateX(-50%)";
    label.style.fontSize = "9px";
    label.style.fontWeight = isNow ? "800" : "600";
    label.style.color = isNow ? "#0d3fd1" : "#94a3b8";
    label.style.whiteSpace = "nowrap";
    col.appendChild(label);

    // Ponto marcador do mÃªs atual
    if (isNow) {
      const dot = document.createElement("span");
      dot.style.position = "absolute";
      dot.style.bottom = "-5px";
      dot.style.left = "50%";
      dot.style.transform = "translateX(-50%)";
      dot.style.width = "4px";
      dot.style.height = "4px";
      dot.style.borderRadius = "50%";
      dot.style.backgroundColor = "#0d3fd1";
      col.appendChild(dot);
    }

    wrap.appendChild(col);
  });
}

async function loadBudgetExecution() {
  const id = getProjectId();
  const container = el("budgetExecutionMatrixContainer");
  if (!container) return;
  container.innerHTML = `<div class="p-8 text-center text-sm text-on-surface-variant">Construindo matriz...</div>`;

  // Get project, budget lines, and all transactions
  const [projRes, linesRes, txRes] = await Promise.all([
    apiRequest(`/projects/${encodeURIComponent(id)}`),
    apiRequest(`/projects/${encodeURIComponent(id)}/budget/lines`),
    apiRequest(`/projects/${encodeURIComponent(id)}/transactions?page=1&pageSize=10000`)
  ]);

  const p = projRes.project;
  const lines = linesRes.items || [];
  const txs = txRes.items || [];

  // --- Build dynamic month range from project start â†’ due date ---
  const monthNames = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const startDate = p.startDate ? new Date(p.startDate) : new Date();
  const endDate = p.dueDate ? new Date(p.dueDate) : new Date(startDate.getFullYear(), startDate.getMonth() + 11, 1);

  // Normalise to first of month
  const rangeStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const rangeEnd = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  // Build ordered list of {year, month, label}
  const projectMonths = [];
  const cur = new Date(rangeStart);
  while (cur <= rangeEnd) {
    projectMonths.push({
      year: cur.getFullYear(),
      month: cur.getMonth(),
      label: `${monthNames[cur.getMonth()]}/${String(cur.getFullYear()).slice(2)}`
    });
    cur.setMonth(cur.getMonth() + 1);
  }

  // Ensure at least 1 month
  if (projectMonths.length === 0) {
    projectMonths.push({ year: rangeStart.getFullYear(), month: rangeStart.getMonth(), label: `${monthNames[rangeStart.getMonth()]}/${String(rangeStart.getFullYear()).slice(2)}` });
  }

  const numMonths = projectMonths.length;

  // Helper: get column index for a given Date (clamp to range)
  const getColIdx = (date) => {
    const d = new Date(date.getFullYear(), date.getMonth(), 1);
    if (d < rangeStart) return 0;
    if (d > rangeEnd) return numMonths - 1;
    const diffYears = d.getFullYear() - rangeStart.getFullYear();
    const diffMonths = d.getMonth() - rangeStart.getMonth();
    return diffYears * 12 + diffMonths;
  };

  // --- Categorize ---
  const cats = {
    MATERIAIS_INSUMOS: { name: "CUSTO DE INSUMOS E MATERIAIS", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] },
    SERVICOS_MAO_DE_OBRA: { name: "CUSTO DE MÃO DE OBRA E SERVIÇOS", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] },
    GASTOS_PESSOAL: { name: "GASTOS COM PESSOAL", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] },
    DESPESAS_OPERACIONAIS: { name: "DESPESAS OPERACIONAIS", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] },
    INVESTIMENTOS: { name: "PAGAMENTOS", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] },
    DEPRECIACAO: { name: "DEPRECIAÇÃO", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] },
    OUTRAS_DESPESAS: { name: "OUTRAS DESPESAS", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] },
    IMPOSTOS: { name: "IMPOSTOS", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] },
    DEDUCOES: { name: "(-) DEDUÇÕES DE CUSTOS", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] }
  };

  const getCatKey = (c) => {
    if (c === "LABOR") return "SERVICOS_MAO_DE_OBRA";
    if (c === "MATERIALS") return "MATERIAIS_INSUMOS";
    if (c === "EQUIPMENT") return "INVESTIMENTOS";
    if (cats[c]) return c;
    return "OUTRAS_DESPESAS";
  };

  // Pre-process items mapping
  const itemsMap = new Map();

  lines.forEach(l => {
    const cKey = getCatKey(l.category);
    const totalP = Number(l.total || 0);
    const monthlyP = totalP / numMonths; // distribute linearly across all project months

    const obj = {
      id: l.id,
      desc: l.description,
      totalP,
      totalC: 0,
      byMonth: Array(numMonths).fill(0).map(() => ({ p: monthlyP, c: 0 }))
    };
    cats[cKey].items.push(obj);
    itemsMap.set(l.id, obj);

    cats[cKey].total += totalP;
    cats[cKey].byMonth.forEach((m) => m.p += monthlyP);
  });

  // Calculate forecast (Previsto) and consumed (Realizado) from transactions
  txs.forEach(t => {
    const d = new Date(t.date);
    const mIdx = getColIdx(d); // map to column in project range (clamped)
    const forecastAmount = Number(t.amount || 0);
    const realizedAmount = t.realizedAmount != null ? Number(t.realizedAmount) : forecastAmount;

    const cKey = getCatKey(t.category);

    if (t.status === "PENDING" || t.status === "LATE") {
      cats[cKey].total += forecastAmount;
      cats[cKey].byMonth[mIdx].p += forecastAmount;

      const cleanDesc = (t.description || "lançamento Avulso").trim();
      const descKey = `tx_${cKey}_${cleanDesc.toLowerCase()}`;
      let row = cats[cKey].items.find(i => i._key === descKey);
      if (!row) {
        row = { id: t.id, _key: descKey, desc: cleanDesc, totalP: 0, totalC: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })) };
        cats[cKey].items.push(row);
      }
      row.totalP += forecastAmount;
      row.byMonth[mIdx].p += forecastAmount;

    } else if (t.status === "PAID") {
      cats[cKey].consumed += realizedAmount;
      cats[cKey].byMonth[mIdx].c += realizedAmount;

      if (t.budgetLineId && itemsMap.has(t.budgetLineId)) {
        const bItem = itemsMap.get(t.budgetLineId);
        bItem.totalC += realizedAmount;
        bItem.byMonth[mIdx].c += realizedAmount;
      } else {
        const cleanDesc = (t.description || "lançamento Avulso").trim();
        const descKey = `tx_${cKey}_${cleanDesc.toLowerCase()}`;
        let row = cats[cKey].items.find(i => i._key === descKey);
        if (!row) {
          row = { id: t.id, _key: descKey, desc: cleanDesc, totalP: forecastAmount, totalC: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })) };
          cats[cKey].items.push(row);
          cats[cKey].total += forecastAmount;
          cats[cKey].byMonth[mIdx].p += forecastAmount;
          row.byMonth[mIdx].p += forecastAmount;
        }
        row.totalC += realizedAmount;
        row.byMonth[mIdx].c += realizedAmount;
      }
    }
  });

  // Render Table
  let gTotalP = 0;
  let gTotalC = 0;
  let gByMonth = Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 }));

  Object.keys(cats).forEach(key => {
    const cat = cats[key];
    const isDed = key === "DEDUCOES";
    const isCapital = ["INVESTIMENTOS", "DEPRECIACAO"].includes(key);
    // Capital and depreciation categories are off-budget à” excluded from grand totals
    if (isCapital) return;
    const sign = isDed ? -1 : 1;

    // Add logic here to invert logic of display if needed, but for sum calculations:
    gTotalP += cat.total * sign;
    gTotalC += cat.consumed * sign;
    cat.byMonth.forEach((m, i) => {
      gByMonth[i].p += m.p * sign;
      gByMonth[i].c += m.c * sign;
    });
  });

  const formatTableCurrency = (val) => val === 0 ? "-" : new Intl.NumberFormat('pt-AO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
  const formatPct = (c, p) => p > 0 ? Math.round((c / p) * 100) + '%' : (c > 0 ? '100%' : '0%');

  const drawRow = (title, totalP, totalC, monthsData, isHeader = false, customRowCls = null) => {
    let rowCls = customRowCls || (isHeader ? "bg-slate-100 font-black text-slate-900" : "bg-white text-slate-800 hover:bg-slate-50 transition-colors");
    let titleCls = customRowCls ? `px-2 md:px-4 py-2 sticky left-0 z-10 whitespace-nowrap ${customRowCls} text-[10px] md:text-xs` : (isHeader ? "px-2 md:px-4 py-2 sticky left-0 bg-slate-100 z-10 whitespace-nowrap text-[10px] md:text-xs" : "px-2 md:px-4 py-1.5 sticky left-0 bg-white group-hover:bg-slate-50 transition-colors whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px] md:max-w-[250px] pl-4 md:pl-8 text-[9px] md:text-xs font-semibold");

    let html = `<tr class="border-b border-slate-100 group ${rowCls}">`;
    html += `<td class="${titleCls}" title="${escapeHtml(title)}">${escapeHtml(title)}</td>`;

    // Total column
    html += `<td class="px-1.5 md:px-2 py-1.5 text-right font-black border-l border-slate-100 bg-slate-50 text-[10px] md:text-xs text-slate-900">${formatTableCurrency(totalP)}</td>`;
    html += `<td class="px-1.5 md:px-2 py-1.5 text-right text-[10px] md:text-xs ${totalC > totalP ? 'text-red-600' : 'text-slate-900'}">${formatTableCurrency(totalC)}</td>`;
    html += `<td class="px-1.5 md:px-2 py-1.5 text-right text-[8px] md:text-[9px] text-slate-400 font-bold">${formatPct(totalC, totalP)}</td>`;

    monthsData.forEach((m) => {
      html += `<td class="px-1.5 md:px-2 py-1.5 text-right border-l border-slate-100 text-[9px] md:text-[11px] text-slate-500">${formatTableCurrency(m.p)}</td>`;
      html += `<td class="px-1.5 md:px-2 py-1.5 text-right text-[9px] md:text-[11px] font-bold ${m.c > m.p ? 'text-red-600' : 'text-slate-900'}">${formatTableCurrency(m.c)}</td>`;
      html += `<td class="px-1.5 md:px-2 py-1.5 text-right text-[8px] md:text-[9px] text-slate-400">${formatPct(m.c, m.p)}</td>`;
    });

    html += `</tr>`;
    return html;
  };

  let theadHtml = `
    <thead>
      <tr class="bg-slate-900 text-white">
        <th rowspan="2" class="px-2 md:px-4 py-2 sticky left-0 bg-slate-900 z-20 whitespace-nowrap min-w-[150px] md:min-w-[250px] text-left text-[10px] md:text-xs font-black uppercase tracking-widest">Descrição</th>
        <th colspan="3" class="px-1 md:px-2 py-2 text-center text-[10px] md:text-xs font-black uppercase tracking-widest border-l border-white/10 bg-white/5">TOTAL OBRA</th>
        ${projectMonths.map(m => `<th colspan="3" class="px-1 md:px-2 py-2 text-center text-[10px] md:text-xs font-black uppercase tracking-widest border-l border-white/10">${m.label}</th>`).join('')}
      </tr>
      <tr class="bg-slate-800 text-slate-300 text-[8px] md:text-[9px] uppercase tracking-wider">
        <th class="px-1 md:px-2 py-1 text-right font-bold border-l border-white/10">Prev.</th>
        <th class="px-1 md:px-2 py-1 text-right font-bold">Real.</th>
        <th class="px-1 md:px-2 py-1 text-right font-bold text-slate-500">(%)</th>
        ${projectMonths.map(() => `
          <th class="px-1 md:px-2 py-1 text-right font-bold border-l border-white/10 text-slate-500">P.</th>
          <th class="px-1 md:px-2 py-1 text-right font-bold text-emerald-400">R.</th>
          <th class="px-1 md:px-2 py-1 text-right font-bold text-slate-500">%</th>
        `).join('')}
      </tr>
    </thead>
  `;

  let tbodyHtml = `<tbody class="divide-y divide-outline-variant/30">`;

  // Grand Total First Row (like DRE)
  tbodyHtml += drawRow(`= CUSTO LÍQUIDO TOTAL DA OBRA`, gTotalP, gTotalC, gByMonth, true);

  Object.keys(cats).forEach(key => {
    const cat = cats[key];
    if (cat.items.length === 0 && cat.total === 0 && cat.consumed === 0) return;

    const isInvestment = key === "INVESTIMENTOS";
    const isInfoOnly = key === "DEPRECIACAO"; // purely informational, no amounts shown

    // Category Header
    let catTitle = key === "DEDUCOES" ? cat.name : `+ ${cat.name}`;
    if (isInvestment) catTitle = `â–² ${cat.name}`;
    if (isInfoOnly) catTitle = `~ ${cat.name}`;

    const customCls = isInvestment ? "bg-[#0f2e1a] font-black text-[#2afc8d]" : (isInfoOnly ? "bg-[#0f2540] font-black text-slate-300" : null);
    tbodyHtml += drawRow(catTitle, isInfoOnly ? 0 : cat.total, isInfoOnly ? 0 : cat.consumed, cat.byMonth, true, customCls);

    // Category Items
    cat.items.forEach(item => {
      tbodyHtml += drawRow(item.desc, isInfoOnly ? 0 : item.totalP, isInfoOnly ? 0 : item.totalC, item.byMonth, false);
    });
  });

  tbodyHtml += `</tbody>`;

  container.innerHTML = `<table class="w-full text-left whitespace-nowrap border-collapse">${theadHtml}${tbodyHtml}</table>`;

  if (el("totalPlannedVal")) el("totalPlannedVal").textContent = formatCurrency(gTotalP, projectState?.currency);
  if (el("totalExecutedVal")) el("totalExecutedVal").textContent = formatCurrency(gTotalC, projectState?.currency);
  if (el("totalExecutionPct")) {
    const totalPct = gTotalP > 0 ? Math.round((gTotalC / gTotalP) * 100) : 0;
    el("totalExecutionPct").textContent = `${totalPct}% GERAL`;
  }

  // Renderiza Curva S com dados reais (todas as transaÃ§Ãµes + linhas de orÃ§amento)
  renderScurve(txs, p, lines);

  renderOperationStatus(lines);
}

async function renderOperationStatus(lines) {
  const id = getProjectId();
  // Busca todos os lançamentos para nÃ£o depender apenas dos vinculados
  const txData = await apiRequest(`/projects/${encodeURIComponent(id)}/transactions?page=1&pageSize=10000`);

  const cats = {
    MATERIALS: { total: 0, consumed: 0, pctId: "stat_materials_pct", subId: "stat_materials_sub" },
    LABOR: { total: 0, consumed: 0, pctId: "stat_labor_pct", subId: "stat_labor_sub" },
    EQUIPMENT: { total: 0, consumed: 0, pctId: "stat_machinery_pct", subId: "stat_machinery_sub" }
  };

  const getGroup = (c) => {
    if (c === "MATERIALS" || c === "MATERIAIS_INSUMOS") return "MATERIALS";
    if (c === "LABOR" || c === "SERVICOS_MAO_DE_OBRA" || c === "GASTOS_PESSOAL") return "LABOR";
    if (c === "EQUIPMENT" || c === "INVESTIMENTOS" || c === "DEPRECIACAO") return "EQUIPMENT";
    return null;
  };

  // Somar orÃ§amento total por categoria (das linhas de orÃ§amento)
  lines.forEach(l => {
    const group = getGroup(l.category);
    if (group && cats[group]) {
      cats[group].total += Number(l.total || 0);
    }
  });

  // Somar todos os custos lanÃ§ados por categoria
  (txData.items || []).forEach(t => {
    const group = getGroup(t.category);
    if (group && cats[group]) {
      cats[group].consumed += Number(t.amount || 0);
    }
  });

  Object.values(cats).forEach(c => {
    const pct = c.total > 0 ? Math.round((c.consumed / c.total) * 100) : 0;
    const pctEl = el(c.pctId);
    if (pctEl) {
      pctEl.textContent = `${pct}%`;
      pctEl.className = pct >= 100 ? "text-error font-bold" : "text-[#2afc8d] font-bold";
    }
    const subEl = el(c.subId);
    if (subEl) {
      subEl.textContent = `${formatCurrency(c.consumed, projectState?.currency)} lançados`;
    }
  });
}

function wireLiquidation() {
  document.addEventListener("click", async (e) => {
    const btn = e.target?.closest("[data-liquidate-tx]");
    if (!btn) return;

    const txId = btn.getAttribute("data-liquidate-tx");
    const txDesc = btn.getAttribute("data-tx-desc") || "este lançamento";
    const txAmount = btn.getAttribute("data-tx-amount") || "0";
    const projectId = getProjectId();

    openModal({
      title: "Liquidar Despesa",
      primaryLabel: "Confirmar LiquidaÃ§Ã£o",
      contentHtml: `
        <div class="space-y-4">
          <div class="bg-surface-container-low rounded-xl p-4 border border-outline-variant/30">
            <p class="text-xs text-on-surface-variant uppercase font-black tracking-widest mb-1">Despesa</p>
            <p class="font-bold text-[#212e3e] text-sm">${escapeHtml(txDesc)}</p>
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">
              Valor Previsto / Comprometido (${projectState?.currency || "Kz"})
            </label>
            <div class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-400 text-sm font-mono">
              ${Number(txAmount).toLocaleString('pt-AO')} ${projectState?.currency || "Kz"}
            </div>
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-primary mb-2">
              Valor Realmente Pago (${projectState?.currency || "Kz"})
            </label>
            <input 
              id="liq_realizedAmount" 
              type="number" 
              step="0.01" 
              value="${txAmount}" 
              class="w-full rounded-lg border-slate-300 font-mono text-sm focus:border-primary focus:ring-primary"
            />
            <p class="mt-1 text-[11px] text-on-surface-variant">
              Se o valor pago foi diferente do previsto, altere aqui. A diferenÃ§a serÃ¡ devolvida ao orÃ§amento disponÃ­vel.
            </p>
          </div>
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const realizedInput = panel.querySelector("#liq_realizedAmount");
        const realizedAmount = Number(realizedInput?.value || txAmount);
        const primaryBtn = panel.querySelector("[data-primary]");
        try {
          setButtonLoading(primaryBtn, true);
          await apiRequest(`/projects/${encodeURIComponent(projectId)}/transactions/${encodeURIComponent(txId)}/liquidate`, {
            method: "PATCH",
            body: { realizedAmount },
          });
          toast("lançamento liquidado com sucesso!", { type: "success" });
          close();
          await loadProject();
          await loadTransactions();
          await loadBudgetExecution();
          await loadPayments();
        } catch (err) {
          setButtonLoading(primaryBtn, false);
          toast(err.message || "Erro ao liquidar lançamento", { type: "error" });
        }
      },
    });
  });
}

function wireTabs() {
  const triggers = document.querySelectorAll("[data-tab-trigger]");
  triggers.forEach(t => {
    t.addEventListener("click", () => {
      const tabId = t.getAttribute("data-tab-trigger");

      // Update Triggers
      triggers.forEach(tr => {
        tr.classList.remove("border-slate-900", "text-slate-900");
        tr.classList.add("text-slate-400", "border-transparent");
      });
      t.classList.add("border-slate-900", "text-slate-900");
      t.classList.remove("text-slate-400", "border-transparent");

      // Update Contents
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      el(`tab_${tabId}`)?.classList.remove("hidden");

      if (tabId === "files") loadFiles();
      if (tabId === "relatorio") loadProgressTasks();
      if (tabId === "stock") loadStock();
      if (tabId === "galeria_obra") loadGallery();
    });
  });

  // Sub-tabs de Stock
  const subtriggers = document.querySelectorAll("[data-stock-subtab]");
  subtriggers.forEach(st => {
    st.addEventListener("click", () => {
      const subId = st.getAttribute("data-stock-subtab");
      subtriggers.forEach(s => {
        s.classList.remove("border-slate-900", "text-slate-900");
        s.classList.add("text-slate-400", "border-transparent");
      });
      st.classList.add("border-slate-900", "text-slate-900");
      st.classList.remove("text-slate-400", "border-transparent");

      el("stock_history_content").classList.toggle("hidden", subId !== "history");
      el("stock_gallery_content").classList.toggle("hidden", subId !== "gallery");
    });
  });
}

function renderGroupHeader(group, totalGroupValue = 0, currency = "Kz", groupProgress = 0) {
  const num = (v) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };
  const formattedTotal = `<span class="ml-auto text-xs font-black text-slate-500">${num(totalGroupValue).toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}</span>`;
  const safeGroupName = escapeHtml(group || "Outros / Geral");
  const formattedProgress = `<span class="ml-3 text-[10px] bg-blue-100 border border-blue-200 text-blue-700 px-2 py-0.5 rounded-full font-black shadow-sm">${num(groupProgress).toFixed(2)}% Exec.</span>`;

  return `
    <tr class="bg-slate-50 cursor-pointer select-none group" data-toggle-progress-group="${safeGroupName}">
      <td colspan="13" class="px-6 py-3 border-y border-slate-100 hover:bg-slate-100/50 transition-colors">
        <div class="flex items-center gap-3 w-full">
          <span class="material-symbols-outlined text-slate-400 group-hover:text-blue-600 transition-colors text-xl" data-icon>expand_more</span>
          <span class="text-[11px] font-black uppercase tracking-[0.2em] text-[#212e3e]">${safeGroupName}</span>
          ${formattedProgress}
          ${formattedTotal}
        </div>
      </td>
    </tr>
  `;
}

function renderProgressTaskRow(t, index, isSub = false, parentGroup = null, hasChildren = false, childItems = []) {
  const num = (v) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };

  let exp, exe, invoicingVal, invoicedVal;

  const uvM = num(t.unitValueMaterial);
  const uvS = num(t.unitValueService);
  const unitVal = (t.unitValue !== null && t.unitValue !== undefined) ? num(t.unitValue) : (uvM + uvS);

  if (hasChildren && childItems.length > 0) {
    // Para item principal: Agrega os VALORES totais dos filhos
    exp = childItems.reduce((s, c) => s + num(c.expectedQty), 0);
    exe = childItems.reduce((s, c) => s + num(c.executedQty), 0);

    invoicingVal = childItems.reduce((s, c) => {
      const uvC = (c.unitValue !== null && c.unitValue !== undefined) ? num(c.unitValue) : (num(c.unitValueMaterial) + num(c.unitValueService));
      return s + (uvC * num(c.expectedQty));
    }, 0);

    invoicedVal = childItems.reduce((s, c) => {
      const uvC = (c.unitValue !== null && c.unitValue !== undefined) ? num(c.unitValue) : (num(c.unitValueMaterial) + num(c.unitValueService));
      return s + (uvC * num(c.executedQty));
    }, 0);
  } else {
    // Para itens simples ou subitens
    exp = num(t.expectedQty);
    exe = num(t.executedQty);
    invoicingVal = unitVal * exp;
    invoicedVal = unitVal * exe;
  }

  const left = exp > exe ? (exp - exe) : 0;
  // Percentagem com 2 casas decimais (sem arredondar para inteiro)
  const rawPct = invoicingVal > 0 ? (invoicedVal / invoicingVal) * 100 : (exe > 0 ? 100 : 0);
  const exePct = Math.min(100, num(rawPct.toFixed(2)));
  const leftPct = Math.max(0, 100 - exePct);

  const currencyStr = t.currency === "USD" ? "USD" : "Kz";
  // Formatadores: 2 casas para totais, até 5 para preços unitários
  const fmt = (v) => num(v).toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtUV = (v) => num(v).toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 10 });
  const fmtQty = (v) => num(v).toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // No item pai, não mostramos preço unitário individual, pois é um somatório
  const uvSStr = (!hasChildren && num(t.unitValueService) > 0) ? `${fmtUV(t.unitValueService)} ${currencyStr}` : "-";
  const uvMStr = (!hasChildren && num(t.unitValueMaterial) > 0) ? `${fmtUV(t.unitValueMaterial)} ${currencyStr}` : "-";

  const invoicingValStr = invoicingVal > 0 ? `${fmt(invoicingVal)} ${currencyStr}` : "-";
  const invoicedValStr = invoicedVal > 0 ? `${fmt(invoicedVal)} ${currencyStr}` : "-";

  const pctFormula = hasChildren
    ? `Σ V.Faturado Filhos (${fmt(invoicedVal)}) ÷ Σ V.Faturação Filhos (${fmt(invoicingVal)}) × 100 = ${exePct.toFixed(2)}%`
    : `${exe.toLocaleString('pt-AO')} ÷ ${exp.toLocaleString('pt-AO')} × 100 = ${exePct.toFixed(2)}%`;


  // Utilizar o parentGroup se passado (SubItem), caso contrÃ¡rio ler do prÃ³prio t.itemGroup.
  const logicalGroup = (isSub && parentGroup !== null) ? parentGroup : t.itemGroup;
  const safeGroupName = escapeHtml(logicalGroup || "Outros / Geral");

  const indentStyle = isSub ? "pl-12 bg-slate-50/30" : "px-6";
  const iconSub = isSub ? `<span class="material-symbols-outlined text-[16px] text-slate-300 mr-2 -ml-6">subdirectory_arrow_right</span>` : "";
  const parentClass = hasChildren ? "bg-blue-50/40 border-y border-blue-100/50 cursor-pointer select-none" : "";
  const descClass = hasChildren ? "font-black text-[#1e293b]" : "font-bold text-[#212e3e]";
  const toggleAttr = hasChildren ? `data-toggle-sub-tasks="${t.id}"` : "";

  // Célula % Exec do item pai — fórmula compacta
  const pctBadge = hasChildren
    ? (() => {
      const color = exePct >= 100 ? '#2afc8d' : exePct >= 50 ? '#f59e0b' : '#ef4444';
      const barColor = color;
      return `
          <div class="flex flex-col items-center gap-0.5 min-w-[100px]">
            <span class="text-sm font-black" style="color:${color}">${exePct.toFixed(2)}%</span>
            <div style="width:64px;height:3px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
              <div style="width:${exePct}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.6s;"></div>
            </div>
            <div class="flex flex-col opacity-40 group-hover:opacity-100 transition-opacity">
               <span class="text-[9px] font-bold text-slate-500 uppercase tracking-tighter leading-none mt-1">Soma Filhos</span>
               <span class="text-[9px] font-medium text-slate-400 whitespace-nowrap">${fmt(invoicedVal)} / ${fmt(invoicingVal)}</span>
            </div>
          </div>`;
    })()
    : `<span class="text-[#0d3fd1] font-bold">${exePct.toFixed(2)}%</span>`;


  return `
    <tr class="hover:bg-surface-container-low transition-colors group ${parentClass}" data-progress-item-group="${safeGroupName}" ${toggleAttr}>
      <td class="px-6 py-4 text-center font-black text-slate-400 text-[11px]">${index}</td>
      <td class="py-4 ${indentStyle}">
        <div class="${descClass} flex flex-col relative">
          <div class="flex items-start">
            ${iconSub}
            ${hasChildren ? `<span class="material-symbols-outlined text-slate-400 mr-2 text-lg mt-0.5" data-sub-icon>expand_more</span>` : ""}
            <div class="flex flex-col">
              <div class="flex items-center gap-2">
                ${t.itemCode ? `<span class="text-[9px] font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/50">${escapeHtml(t.itemCode)}</span>` : ""}
                <span class="text-sm font-bold text-slate-900 leading-snug">${escapeHtml(t.description)}</span>
              </div>
              ${(!isSub && t.itemGroup && t.itemGroup.toUpperCase() !== "GERAL") ? `<span class="text-[10px] text-slate-400 uppercase tracking-widest mt-1 font-black">${escapeHtml(t.itemGroup)}</span>` : ""}
            </div>
          </div>
        </div>
      </td>
      <td class="px-4 py-4 text-center font-bold text-slate-800 text-xs">${fmtQty(exp)}</td>
      <td class="px-4 py-4 text-center tracking-widest text-slate-500 font-bold text-[10px] uppercase">${formatUnit(t.unit)}</td>
      <td class="px-4 py-4 text-center font-bold text-blue-600 text-xs">${uvSStr}</td>
      <td class="px-4 py-4 text-center font-bold text-emerald-600 text-xs">${uvMStr}</td>
      <td class="px-4 py-4 text-center font-black text-slate-900 text-xs">${invoicingValStr}</td>
      <td class="px-4 py-4 text-center font-bold text-slate-800 text-xs">${fmtQty(exe)}</td>
      <td class="px-4 py-4 text-center font-black text-emerald-700 bg-emerald-50/30 text-xs">${invoicedValStr}</td>
      <td class="px-4 py-4 text-center font-medium text-[#0d3fd1]">${pctBadge}</td>
      <td class="px-4 py-4 text-center font-bold text-slate-500 text-xs">${fmtQty(left)}</td>
      <td class="px-4 py-4 text-center font-black text-red-600 text-xs">${leftPct.toFixed(2)}%</td>
      <td class="px-4 py-4 text-right" data-actions>
        <button data-edit-task="${t.id}" data-task-desc="${escapeHtml(t.description)}" data-task-exe="${exe}" data-task-exp="${exp}" data-task-unit="${escapeHtml(t.unit)}" data-task-us="${uvS}" data-task-um="${uvM}" data-task-unit-value="${unitVal}" data-task-total-value="${t.totalValue || ''}" data-task-currency="${escapeHtml(t.currency || 'AOA')}" title="Atualizar Progresso" class="material-symbols-outlined text-slate-400 hover:text-[#0d3fd1] transition-colors p-1 rounded-md hover:bg-[#0d3fd1]/10">edit</button>
        <button data-delete-task="${t.id}" title="Remover" class="material-symbols-outlined text-slate-400 hover:text-error transition-colors p-1 rounded-md hover:bg-error/10">delete</button>
      </td>
    </tr>
  `;
}

async function loadProgressTasks() {
  const id = getProjectId();
  const tbody = el("progressTasksTbody");
  if (!tbody) return;

  tbody.innerHTML = renderLoadingRow(8);
  try {
    const data = await apiRequest("/projects/" + encodeURIComponent(id) + "/progress-tasks");
    window.projectProgressTasksCache = data.tasks || [];
    if (data.tasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="13" class="text-center py-6 text-xs text-slate-400 font-bold uppercase">Sem tarefas cadastradas</td</tr>`;
    } else {
      let html = "";
      let lastGroup = null;

      const groupTotals = {};
      const groupCurrencies = {};
      const groupTasks = {};

      // Calculate totals for parents or standalone items to avoid double counting if a parent aggregates
      // Sort by itemGroup so items of the same group are always consecutive
      const parentsAndOrphans = data.tasks
        .filter(t => !t.parentId)
        .sort((a, b) => (a.itemGroup || "").localeCompare(b.itemGroup || "", 'pt', { sensitivity: 'base' }));
      const groupInvoicingTotals = {};
      const groupInvoicedTotals = {};

      const num = (v) => {
        const n = Number(v);
        return isNaN(n) ? 0 : n;
      };

      parentsAndOrphans.forEach(t => {
        const g = t.itemGroup || "";
        if (!groupInvoicingTotals[g]) groupInvoicingTotals[g] = 0;
        if (!groupInvoicedTotals[g]) groupInvoicedTotals[g] = 0;
        if (!groupTasks[g]) groupTasks[g] = [];

        const exp = num(t.expectedQty);
        const exe = num(t.executedQty);

        // Unidade de Valor (com fallback para US+UM)
        const uvM = num(t.unitValueMaterial);
        const uvS = num(t.unitValueService);
        const uv = (t.unitValue !== null && t.unitValue !== undefined) ? num(t.unitValue) : (uvM + uvS);

        groupInvoicingTotals[g] += (uv * exp);
        groupInvoicedTotals[g] += (uv * exe);
        groupTasks[g].push(t);

        if (!groupCurrencies[g] || t.currency === "USD") {
          groupCurrencies[g] = t.currency === "USD" ? "USD" : "Kz";
        }
      });

      let globalInvoicing = 0;
      let globalInvoiced = 0;

      const groupProgressMap = {};
      Object.keys(groupTasks).forEach(g => {
        const totalInvoicing = groupInvoicingTotals[g] || 0;
        const totalInvoiced = groupInvoicedTotals[g] || 0;

        globalInvoicing += totalInvoicing;
        globalInvoiced += totalInvoiced;

        if (totalInvoicing > 0) {
          groupProgressMap[g] = Math.min(100, (totalInvoiced / totalInvoicing) * 100);
        } else {
          groupProgressMap[g] = 0;
        }
      });

      // Atualizar o resumo global no topo da página (Progresso Físico)
      // O denominador passa a ser o Valor Global (budgetTotal) do projeto
      const valorGlobal = (projectState && Number(projectState.budgetTotal) > 0)
        ? Number(projectState.budgetTotal)
        : globalInvoicing; // Fallback caso o projeto não tenha orçamento definido

      const globalPct = valorGlobal > 0 ? Math.min(100, (globalInvoiced / valorGlobal) * 100) : 0;

      const progressEl = el("physicalProgress");
      if (progressEl) {
        progressEl.textContent = `${globalPct.toFixed(2)}%`;
      }
      const pieEl = el("physicalProgressPie");
      if (pieEl) {
        pieEl.style.background = `conic-gradient(#2afc8d 0%, #2afc8d ${globalPct}%, #f1f5f9 ${globalPct}%, #f1f5f9 100%)`;
      }

      const children = data.tasks.filter(t => t.parentId);
      let groupIndex = 0;

      parentsAndOrphans.forEach((t) => {
        const currentGroup = t.itemGroup || "";
        if (currentGroup !== lastGroup) {
          html += renderGroupHeader(t.itemGroup, groupInvoicingTotals[currentGroup] || 0, groupCurrencies[currentGroup] || "Kz", groupProgressMap[currentGroup] || 0);
          lastGroup = currentGroup;
          groupIndex = 0; // zera contagem no novo separador
        }

        groupIndex++;
        const subs = children.filter(c => c.parentId === t.id);

        html += renderProgressTaskRow(t, groupIndex.toString(), false, t.itemGroup, subs.length > 0, subs);

        subs.forEach((sub, subI) => {
          const subRow = renderProgressTaskRow(sub, `${groupIndex}.${subI + 1}`, true, t.itemGroup, false, []);
          // Injetar o data-sub-of no tr retornado pelo helper
          html += subRow.replace('<tr', `<tr data-sub-of="${t.id}"`);
        });
      });
      tbody.innerHTML = html;

      // Populate Footer (Total Global da Tabela)
      const tfoot = el("progressTasksTfoot");
      if (tfoot) {
        const globalCurrency = (projectState && projectState.currency === "USD") ? "USD" : "Kz";
        const globalFmt = (v) => num(v).toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + globalCurrency;

        tfoot.innerHTML = `
          <tr>
            <td class="px-4 py-5 text-center" text-sm colspan="2">TOTAL GERAL DA OBRA</td>
            <td class="px-4 py-5 text-center" colspan="4"></td>
            <td class="px-4 py-5 text-center bg-slate-800 text-white">${globalFmt(globalInvoicing)}</td>
            <td class="px-4 py-5 text-center"></td>
            <td class="px-4 py-5 text-center bg-emerald-900 text-white">${globalFmt(globalInvoiced)}</td>
            <td class="px-4 py-5 text-center bg-blue-900 text-white">${globalPct.toFixed(2)}%</td>
            <td class="px-4 py-5 text-center"></td>
            <td class="px-4 py-5 text-center bg-red-900 text-white">${(100 - globalPct).toFixed(2)}%</td>
            <td class="px-8 py-5"></td>
          </tr>
        `;
      }

      // Calculate overall physical progress
      const numGroups = Object.keys(groupTasks).length;
      if (numGroups > 0) {
        const avgPct = globalPct.toFixed(2);


        // Update UI: Pie Chart
        if (el("physicalProgress")) el("physicalProgress").textContent = `${avgPct}%`;
        if (el("physicalProgressPie")) {
          el("physicalProgressPie").style.background = `conic-gradient(#2afc8d 0%, #2afc8d ${avgPct}%, #f1f5f9 ${avgPct}%, #f1f5f9 100%)`;
        }

        // Date Calculations
        if (projectState) {
          updateDateAnalysis(projectState);
        }

        // Sync with backend if projectState is available and value changed
        if (projectState && projectState.physicalProgressPct !== avgPct) {
          projectState.physicalProgressPct = avgPct;
          apiRequest(`/projects/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { physicalProgressPct: parseFloat(avgPct) }
          }).catch(err => console.error("Failed to sync physical progress:", err));
        }
      }
    }
  } catch (err) {
    toast("Erro ao carregar o relatório de avanço", { type: "error" });
  }
}

function wireProgressTasks() {
  const id = getProjectId();

  el("addProgressTaskBtn")?.addEventListener("click", () => {
    let parentOpts = `<option value="">Nenhuma (Item Principal Independente)</option>`;
    if (window.projectProgressTasksCache) {
      const parents = window.projectProgressTasksCache.filter(t => !t.parentId); // max depth 1
      parents.forEach(p => {
        parentOpts += `<option value="${p.id}">${escapeHtml(p.description)} (${escapeHtml(p.itemGroup || 'Geral')})</option>`;
      });
    }

    openModal({
      title: "Adicionar Item de Progresso",
      primaryLabel: "Salvar",
      contentHtml: `
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
             <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Grupo/Tipo</label><input id="rt_group" class="w-full rounded-lg border-slate-300" placeholder="Ex: MÉDIA TENSÃO" value="${escapeHtml(projectState?.projectType || '')}" /></div>
             <div>
                <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Vincular a Subitem de:</label>
                <select id="rt_parent" class="w-full rounded-lg border-slate-300 bg-slate-50 text-slate-600 font-semibold" onchange="const sel=this.value; const gInput=document.getElementById('rt_group'); if(sel){ const p=(window.projectProgressTasksCache||[]).find(x=>x.id===sel); if(p){ gInput.value=p.itemGroup||''; gInput.setAttribute('readonly','true'); gInput.classList.add('bg-slate-100'); } } else { gInput.removeAttribute('readonly'); gInput.classList.remove('bg-slate-100'); }">
                   ${parentOpts}
                </select>
             </div>
          </div>
          <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Descrição da Tarefa</label><input id="rt_desc" class="w-full rounded-lg border-slate-300" placeholder="Ex: Marcação da obra" /></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Qtd Prevista</label><input id="rt_exp" type="number" step="any" class="w-full rounded-lg border-slate-300" value="0" oninput="document.getElementById('rt_tv').value = (this.value * document.getElementById('rt_uv').value).toFixed(10);" /></div>
            <div>
              <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Unidade (UN)</label>
              <select id="rt_uni" class="w-full rounded-lg border-slate-300">
                <option value="un">un (unidade)</option>
                <option value="mts">mts (metros)</option>
                <option value="km">km (quilÃ³metros)</option>
                <option value="m">m (metros lineares)</option>
                <option value="m2">mÂ² (metros quadrados)</option>
                <option value="m3">mÂ³ (metros cÃºbicos)</option>
                <option value="kg">kg (quilogramas)</option>
                <option value="ton">ton (toneladas)</option>
                <option value="par">par</option>
                <option value="litros">litros</option>
                <option value="horas">horas</option>
                <option value="dias">dias</option>
                <option value="mes">mÃªs</option>
                <option value="global">global</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-4 gap-4">
            <div class="col-span-1">
              <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Moeda</label>
              <select id="rt_currency" class="w-full rounded-lg border-slate-300">
                <option value="AOA">AOA (Kz)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-black uppercase tracking-widest text-blue-500 mb-2">V. Serviço</label>
              <input id="rt_us" type="number" step="any" min="0" class="w-full rounded-lg border-slate-300" placeholder="0.00000" oninput="document.getElementById('rt_uv').value = (Number(this.value) + Number(document.getElementById('rt_um').value)).toFixed(10); document.getElementById('rt_tv').value = (document.getElementById('rt_uv').value * document.getElementById('rt_exp').value).toFixed(10);" />
            </div>
            <div>
              <label class="block text-xs font-black uppercase tracking-widest text-emerald-500 mb-2">V. Material</label>
              <input id="rt_um" type="number" step="any" min="0" class="w-full rounded-lg border-slate-300" placeholder="0.00000" oninput="document.getElementById('rt_uv').value = (Number(this.value) + Number(document.getElementById('rt_us').value)).toFixed(10); document.getElementById('rt_tv').value = (document.getElementById('rt_uv').value * document.getElementById('rt_exp').value).toFixed(10);" />
            </div>
            <div>
              <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">V. Total (Unit)</label>
              <input id="rt_uv" type="number" step="any" min="0" class="w-full rounded-lg border-slate-300 bg-slate-100" readonly value="0.00000" />
              <input type="hidden" id="rt_tv" value="0.00000" />
            </div>
          </div>
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const primaryBtn = panel.querySelector("[data-primary]");
        setButtonLoading(primaryBtn, true);
        try {
          const v = (id) => panel.querySelector("#" + id).value.trim();
          await apiRequest("/projects/" + encodeURIComponent(id) + "/progress-tasks", {
            method: "POST",
            body: {
              itemGroup: v("rt_group") || null,
              parentId: v("rt_parent") || null,
              description: v("rt_desc"),
              expectedQty: Number(v("rt_exp") || 0),
              executedQty: 0,
              unit: v("rt_uni").toLowerCase() || "un",
              unitValue: v("rt_uv"),
              unitValueMaterial: v("rt_um"),
              unitValueService: v("rt_us"),
              totalValue: v("rt_tv"),
              currency: v("rt_currency")
            }
          });
          toast("Item adicionado com sucesso", { type: "success" });
          close();
          loadProgressTasks();
        } catch (err) {
          setButtonLoading(primaryBtn, false);
          toast(err.message, { type: "error" });
        }
      }
    });
  });

  el("importExcelBtn")?.addEventListener("click", () => {
    const id = getProjectId();
    openModal({
      title: "Importar do Excel",
      primaryLabel: "Importar",
      contentHtml: `
        <div class="space-y-4">
          <p class="text-sm text-on-surface-variant">Selecione uma folha de cálculo Excel com a estrutura de orçamento da obra.</p>
          <div class="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
            <p class="text-[11px] text-emerald-700 font-bold italic leading-snug">Nota: O sistema detecta automaticamente hierarquias (ex: 1.1) e colunas como Item, Descritivo, Unid. e Quantidade.</p>
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Ficheiro Excel (.xlsx, .csv)</label>
            <input type="file" id="import_excel_file" accept=".xlsx, .xls, .csv" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100" />
          </div>
          <div id="import_preview_container" class="hidden border rounded-xl overflow-hidden bg-slate-50">
            <div class="px-4 py-2 bg-slate-100 border-b flex justify-between items-center">
              <span class="text-[10px] font-black uppercase tracking-widest text-slate-500">Pré-visualização</span>
              <span id="preview_count" class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full"></span>
            </div>
            <div class="max-h-[300px] overflow-y-auto">
              <table class="w-full text-left text-[11px] border-collapse">
                <thead class="sticky top-0 bg-white border-b shadow-sm">
                  <tr>
                    <th class="px-4 py-2 font-black text-slate-400 uppercase tracking-tighter">Item</th>
                    <th class="px-4 py-2 font-black text-slate-400 uppercase tracking-tighter">Descrição</th>
                    <th class="px-4 py-2 font-black text-slate-400 uppercase tracking-tighter">Qtd</th>
                    <th class="px-4 py-2 font-black text-slate-400 uppercase tracking-tighter">Preço</th>
                  </tr>
                </thead>
                <tbody id="import_preview_body" class="divide-y divide-slate-100 bg-white"></tbody>
              </table>
            </div>
          </div>
        </div>
      `,
      onPrimary: async ({ btn, close, panel }) => {
        setButtonLoading(btn, true);
        try {
          const fileInput = panel.querySelector("#import_excel_file");
          const file = fileInput.files[0];

          if (!file) {
            toast("Por favor, selecione um ficheiro Excel.", { type: "warning" });
            setButtonLoading(btn, false);
            return;
          }

          const res = await apiUpload(`/projects/${encodeURIComponent(id)}/progress-tasks/upload-excel`, { file });

          if (res.warnings && res.warnings.length) {
            toast(`Importação concluída com ${res.warnings.length} avisos.`, { type: "warning" });
          } else {
            toast(`${res.imported || 'Várias'} tarefas importadas com sucesso`, { type: "success" });
          }

          close();
          loadProgressTasks();
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message, { type: "error" });
        }
      },
      onRender: ({ panel }) => {
        const fileInput = panel.querySelector("#import_excel_file");
        const previewContainer = panel.querySelector("#import_preview_container");
        const previewBody = panel.querySelector("#import_preview_body");
        const previewCount = panel.querySelector("#preview_count");

        fileInput.addEventListener("change", async () => {
          const file = fileInput.files[0];
          if (!file) {
            previewContainer.classList.add("hidden");
            return;
          }

          try {
            previewBody.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-slate-400 italic">Processando ficheiro...</td></tr>`;
            previewContainer.classList.remove("hidden");

            const res = await apiUpload(`/projects/${encodeURIComponent(id)}/progress-tasks/preview-excel`, { file });

            if (!res.tasks || !res.tasks.length) {
              const warnMsg = res.warnings && res.warnings.length ? res.warnings.join("<br/>") : "Nenhum item encontrado.";
              previewBody.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-red-500 font-bold">${warnMsg}</td></tr>`;
              previewCount.textContent = "0 itens";
              return;
            }

            // Flatten for preview
            const flat = [];
            const rec = (items, depth = 0) => {
              items.forEach(it => {
                flat.push({ ...it, depth });
                if (it.subItems) rec(it.subItems, depth + 1);
              });
            };
            rec(res.tasks);

            previewCount.textContent = `${flat.length} itens encontrados`;
            previewBody.innerHTML = flat.map(t => `
              <tr class="hover:bg-slate-50">
                <td class="px-4 py-2 font-mono text-slate-400 border-r">${t.itemCode || t.order || "-"}</td>
                <td class="px-4 py-2">
                  <div class="font-bold text-slate-900" style="padding-left: ${t.depth * 1.5}rem">${t.depth > 0 ? 'â†³ ' : ''}${escapeHtml(t.description)}</div>
                  ${t.itemGroup ? `<div class="text-[8px] text-slate-400 uppercase" style="padding-left: ${t.depth * 1.5}rem">${escapeHtml(t.itemGroup)}</div>` : ""}
                </td>
                <td class="px-4 py-2 font-semibold text-slate-600">${t.expectedQty} ${escapeHtml(t.unit)}</td>
                <td class="px-4 py-2 font-black text-slate-900">${formatCurrency(t.unitValue, projectState?.currency)}</td>
              </tr>
            `).join("");

          } catch (err) {
            toast("Erro na pré-visualização: " + err.message, { type: "error" });
            previewContainer.classList.add("hidden");
          }
        });
      }
    });
  });

  el("importTemplateBtn")?.addEventListener("click", () => {
    const id = getProjectId();
    openModal({
      title: "Importar Modelo de Obra",
      primaryLabel: "Aplicar Modelo",
      contentHtml: `
        <div class="space-y-4">
          <p class="text-sm text-on-surface-variant">Escolha um dos modelos pré-definidos para preencher a lista de tarefas da obra.</p>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Tipo de Obra / Modelo</label>
            <select id="template_type" class="w-full rounded-xl border-slate-200 h-12 font-bold text-slate-700 bg-slate-50">
              <option value="MÉDIA TENSÃO">Média Tensão (MT)</option>
              <option value="BAIXA TENSÃO">Baixa Tensão (BT)</option>
              <option value="POSTO DE TRANSFORMAÇÃO 160KVA">PT 160kVA</option>
              <option value="POSTO DE TRANSFORMAÇÃO 250KVA">PT 250kVA</option>
              <option value="RAMAL SUBTERRÂNEO DE MÉDIA TENSÃO">Ramal Subterrâneo MT</option>
              <option value="BAIXA TENSÃO E TERRAS">BT e Terras</option>
              <option value="ABERTURA E FECHAMENTO DE VALA">Valas Técnicas</option>
            </select>
          </div>
          <div class="p-4 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-3">
            <span class="material-symbols-outlined text-blue-600">info</span>
            <p class="text-[11px] text-blue-700 leading-snug">Ao aplicar o modelo, as tarefas padrão serão adicionadas à obra. Poderá editá-las ou remover as que não forem necessárias posteriormente.</p>
          </div>
        </div>
      `,
      onPrimary: async ({ btn, close, panel }) => {
        setButtonLoading(btn, true);
        try {
          const type = panel.querySelector("#template_type").value;
          const res = await apiRequest(`/projects/${encodeURIComponent(id)}/progress-tasks/import-template`, {
            method: "POST",
            body: { templateType: type }
          });
          toast(`${res.count} tarefas do modelo "${type}" importadas.`, { type: "success" });
          close();
          loadProgressTasks();
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message, { type: "error" });
        }
      }
    });
  });

  document.addEventListener("click", async (e) => {
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

    const toggleSub = e.target?.closest("[data-toggle-sub-tasks]");
    if (toggleSub && !e.target.closest("[data-actions]")) {
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

    const editBtn = e.target?.closest("[data-edit-task]");
    if (editBtn) {
      const taskId = editBtn.getAttribute("data-edit-task");
      const desc = editBtn.getAttribute("data-task-desc");
      const exe = editBtn.getAttribute("data-task-exe");
      const exp = editBtn.getAttribute("data-task-exp");
      const uni = editBtn.getAttribute("data-task-unit");
      const us = editBtn.getAttribute("data-task-us") || "";
      const um = editBtn.getAttribute("data-task-um") || "";
      const uv = editBtn.getAttribute("data-task-unit-value") || "";
      const tv = editBtn.getAttribute("data-task-total-value") || "";
      const currency = editBtn.getAttribute("data-task-currency") || "AOA";

      const hasSubs = (window.projectProgressTasksCache || []).some(t => t.parentId === taskId);
      const readonlyAttr = hasSubs ? "readonly" : "";
      const bgClass = hasSubs ? "bg-slate-50 opacity-80" : "";
      const titleHint = hasSubs ? "Este valor é calculado automaticamente pela soma dos subitens." : "";

      openModal({
        title: "Atualizar Progresso",
        primaryLabel: "Atualizar",
        contentHtml: `
          <div class="space-y-4">
            <p class="font-bold text-[#212e3e] text-sm">${escapeHtml(desc)}</p>
            ${hasSubs ? `<p class="text-[10px] text-blue-600 font-bold uppercase tracking-widest bg-blue-50 p-2 rounded-lg"><span class="material-symbols-outlined text-xs align-middle mr-1">info</span> Item Pai: Valores somados automaticamente</p>` : ""}
            <div class="grid grid-cols-2 gap-4">
              <div class="col-span-2">
                <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Unidade (UN)</label>
                <select id="up_uni" class="w-full rounded-lg border-slate-300">
                  <option value="un" ${uni === 'un' ? 'selected' : ''}>un (unidade)</option>
                  <option value="mts" ${uni === 'mts' ? 'selected' : ''}>mts (metros)</option>
                  <option value="km" ${uni === 'km' ? 'selected' : ''}>km (quilómetros)</option>
                  <option value="m" ${uni === 'm' ? 'selected' : ''}>m (metros lineares)</option>
                  <option value="m2" ${uni === 'm2' ? 'selected' : ''}>m² (metros quadrados)</option>
                  <option value="m3" ${uni === 'm3' ? 'selected' : ''}>m³ (metros cúbicos)</option>
                  <option value="kg" ${uni === 'kg' ? 'selected' : ''}>kg (quilogramas)</option>
                  <option value="ton" ${uni === 'ton' ? 'selected' : ''}>ton (toneladas)</option>
                  <option value="par" ${uni === 'par' ? 'selected' : ''}>par</option>
                  <option value="litros" ${uni === 'litros' ? 'selected' : ''}>litros</option>
                  <option value="horas" ${uni === 'horas' ? 'selected' : ''}>horas</option>
                  <option value="dias" ${uni === 'dias' ? 'selected' : ''}>dias</option>
                  <option value="mes" ${uni === 'mes' ? 'selected' : ''}>més</option>
                  <option value="global" ${uni === 'global' ? 'selected' : ''}>global</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Qtd. Prevista</label>
                <input id="up_exp" type="number" step="any" value="${exp}" class="w-full rounded-lg border-slate-300" oninput="let uv=document.getElementById('up_uv').value; if(uv) document.getElementById('up_tv').value = (this.value * uv).toFixed(10);" />
              </div>
              <div>
                <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Qtd. Executada</label>
                <input id="up_exe" type="number" step="any" value="${exe}" class="w-full rounded-lg border-primary" />
              </div>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <div class="col-span-1">
                <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Moeda</label>
                <select id="up_currency" class="w-full rounded-lg border-slate-300">
                  <option value="AOA" ${currency === 'AOA' ? 'selected' : ''}>AOA (Kz)</option>
                  <option value="USD" ${currency === 'USD' ? 'selected' : ''}>USD ($)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-black uppercase text-blue-500 tracking-widest mb-2">V. Serviço</label>
                <input id="up_us" type="number" step="any" min="0" value="${us}" class="w-full rounded-lg border-slate-300 ${bgClass}" ${readonlyAttr} title="${titleHint}" oninput="document.getElementById('up_uv').value = (Number(this.value) + Number(document.getElementById('up_um').value)).toFixed(10); document.getElementById('up_tv').value = (document.getElementById('up_uv').value * document.getElementById('up_exp').value).toFixed(10);" />
              </div>
              <div>
                <label class="block text-xs font-black uppercase text-emerald-500 tracking-widest mb-2">V. Material</label>
                <input id="up_um" type="number" step="any" min="0" value="${um}" class="w-full rounded-lg border-slate-300 ${bgClass}" ${readonlyAttr} title="${titleHint}" oninput="document.getElementById('up_uv').value = (Number(this.value) + Number(document.getElementById('up_us').value)).toFixed(10); document.getElementById('up_tv').value = (document.getElementById('up_uv').value * document.getElementById('up_exp').value).toFixed(10);" />
              </div>
              <div>
                <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">V. Total (Unit)</label>
                <input id="up_uv" type="number" step="any" min="0" value="${uv || ''}" class="w-full bg-slate-100 rounded-lg border-slate-300" readonly />
              </div>
              <div>
                <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">V. Faturado <span class="text-slate-300 lowercase text-[9px]">(Global)</span></label>
                <input id="up_tv" type="number" step="any" min="0" value="${tv || ''}" class="w-full rounded-lg border-slate-300 ${bgClass}" ${readonlyAttr} title="${titleHint}" placeholder="Pode sobrescrever" />
              </div>
            </div>
          </div>
        `,
        onPrimary: async ({ close, panel }) => {
          const primaryBtn = panel.querySelector("[data-primary]");
          setButtonLoading(primaryBtn, true);
          try {
            await apiRequest("/projects/" + encodeURIComponent(id) + "/progress-tasks/" + encodeURIComponent(taskId), {
              method: "PATCH",
              body: {
                executedQty: Number(panel.querySelector("#up_exe").value || 0),
                expectedQty: Number(panel.querySelector("#up_exp").value || 0),
                unit: panel.querySelector("#up_uni").value.trim().toLowerCase() || "un",
                unitValue: panel.querySelector("#up_uv").value,
                unitValueMaterial: panel.querySelector("#up_um").value,
                unitValueService: panel.querySelector("#up_us").value,
                totalValue: panel.querySelector("#up_tv").value,
                currency: panel.querySelector("#up_currency").value
              }
            });
            toast("Progresso atualizado", { type: "success" });
            close();
            loadProgressTasks();
          } catch (err) {
            setButtonLoading(primaryBtn, false);
            toast(err.message, { type: "error" });
          }
        }
      });
      return;
    }

    const delBtn = e.target?.closest("[data-delete-task]");
    if (delBtn) {
      const taskId = delBtn.getAttribute("data-delete-task");
      if (!confirm("Tem certeza de que pretende apagar este item de progresso?")) return;
      try {
        setButtonLoading(delBtn, true);
        await apiRequest("/projects/" + encodeURIComponent(id) + "/progress-tasks/" + encodeURIComponent(taskId), { method: "DELETE" });
        toast("Apagado com sucesso!", { type: "success" });
        loadProgressTasks();
      } catch (err) {
        setButtonLoading(delBtn, false);
        toast("Erro ao apagar", { type: "error" });
      }
    }
  });
}

async function loadFiles() {
  const id = getProjectId();
  const list = el("projectFilesList");
  const empty = el("noFilesMsg");
  if (!list) return;

  // Criar breadcrumbs container se nÃ£o existir
  if (!el("fileBreadcrumbs")) {
    const header = list.parentElement.querySelector("div.flex.justify-between");
    const bread = document.createElement("div");
    bread.id = "fileBreadcrumbs";
    bread.className = "flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-slate-400";
    header?.insertAdjacentElement("afterend", bread);
  }

  try {
    const { currentFolderId, breadcrumbs } = fileState;

    // Actualizar UI dos breadcrumbs
    const breadEl = el("fileBreadcrumbs");
    if (breadEl) {
      const breadHtml = [
        `<button data-go-folder="root" class="hover:text-primary transition-colors flex items-center gap-1"><span class="material-symbols-outlined text-sm">home</span> Iní­cio</button>`,
        ...breadcrumbs.map((b, idx) => `
          <span class="material-symbols-outlined text-xs">chevron_right</span>
          <button data-go-folder="${b.id}" class="${idx === breadcrumbs.length - 1 ? 'text-[#212e3e] font-black' : 'hover:text-primary'} transition-colors">${escapeHtml(b.name)}</button>
        `)
      ].join("");
      breadEl.innerHTML = breadHtml;
    }

    // Carregar subpastas do nÃ­vel actual
    const parentParam = currentFolderId ? `?parentId=${currentFolderId}` : `?parentId=root`;
    const foldersRes = await apiRequest(`/projects/${encodeURIComponent(id)}/folders${parentParam}`);
    const folders = foldersRes.items || [];
    fileState.folders = folders;

    // Carregar ficheiros do nÃ­vel actual
    const qs = currentFolderId ? `?folderId=${currentFolderId}` : `?folderId=root`;
    const filesRes = await apiRequest(`/projects/${encodeURIComponent(id)}/files${qs}`);
    const files = filesRes.items || [];
    fileState.items = files;

    if (!folders.length && !files.length) {
      list.innerHTML = "";
      empty?.classList.remove("hidden");
    } else {
      empty?.classList.add("hidden");
      list.innerHTML = [
        ...folders.map(renderFolderCard),
        ...files.map(renderFileCard)
      ].join("");
    }
  } catch (err) {
    console.error(err);
    toast("Erro ao carregar arquivos", { type: "error" });
  }
}

function wireFilesUpload() {
  el("uploadFileBtn")?.addEventListener("click", async () => {
    const currentFolderName = fileState.breadcrumbs.length ? fileState.breadcrumbs[fileState.breadcrumbs.length - 1].name : "Raiz";
    const id = getProjectId();

    // Carrega todas as pastas para o selector de mover
    let allFolders = [];
    try {
      const fr = await apiRequest(`/projects/${encodeURIComponent(id)}/folders?parentId=root`);
      allFolders = fr.items || [];
    } catch (_) { }

    const folderOptions = [
      `<option value="" ${!fileState.currentFolderId ? 'selected' : ''}>Raiz (sem pasta)</option>`,
      ...allFolders.map(f => `<option value="${f.id}" ${fileState.currentFolderId === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`)
    ].join("");

    openModal({
      title: `Submeter Documento`,
      primaryLabel: "Enviar",
      contentHtml: `
        <div class="space-y-4">
          <p class="text-xs text-on-surface-variant font-medium">Capture ou selecione documentos técnicos para esta obra.</p>
          <div class="border-2 border-dashed border-surface-container rounded-2xl p-8 flex flex-col items-center justify-center bg-surface-container-low/20">
            <span class="material-symbols-outlined text-3xl text-primary mb-3">cloud_upload</span>
            <input id="f_input" type="file" class="block w-full text-xs text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
          </div>
          <div>
            <label class="block text-[10px] font-black uppercase text-on-surface-variant mb-2">Categoria</label>
            <select id="f_category" class="w-full rounded-xl border-surface-container bg-surface-container-low text-sm">
              <option value="OUTROS">Outros</option>
              <option value="PLANTA">Planta / Projecto</option>
              <option value="CONTRATO">Contrato / Legal</option>
              <option value="FOTO">Registo Fotográfico</option>
              <option value="RELATORIO">Relatório Técnico</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-black uppercase text-on-surface-variant mb-2">Pasta de Destino</label>
            <select id="f_folderId" class="w-full rounded-xl border-surface-container bg-surface-container-low text-sm">${folderOptions}</select>
          </div>
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const file = panel.querySelector("#f_input")?.files?.[0];
        if (!file) {
          toast("Selecione um arquivo", { type: "error" });
          return;
        }
        const category = panel.querySelector("#f_category")?.value;
        const folderId = panel.querySelector("#f_folderId")?.value;
        const btn = panel.querySelector("[data-primary]");

        try {
          setButtonLoading(btn, true);
          await apiUpload(`/projects/${encodeURIComponent(id)}/files`, {
            file,
            extraFields: { category, folderId: folderId || undefined }
          });
          toast("Arquivo submetido com sucesso", { type: "success" });
          close();
          await loadFiles();
        } catch (err) {
          setButtonLoading(btn, false);
          toast("Falha ao subir arquivo", { type: "error" });
        }
      }
    });
  });
}

function wireNewFolder() {
  if (!el("uploadFileBtn")) return;
  if (!el("createNewFolderBtn")) {
    const btn = document.createElement("button");
    btn.id = "createNewFolderBtn";
    btn.className = "bg-white text-primary px-6 py-3 rounded-xl text-sm font-bold flex items-end gap-3 hover:bg-primary/50 transition-all mr-4";
    btn.innerHTML = `<span class="material-symbols-outlined">create_new_folder</span> Nova Pasta`;
    el("uploadFileBtn").insertAdjacentElement("beforebegin", btn);
  }

  el("createNewFolderBtn")?.addEventListener("click", () => {
    const parentId = fileState.currentFolderId;
    const parentName = parentId && fileState.breadcrumbs.length
      ? fileState.breadcrumbs.at(-1).name
      : "Raiz";

    openModal({
      title: `Nova Pasta ${parentId ? `dentro de "${parentName}"` : ''}`,
      primaryLabel: "Criar",
      contentHtml: `
        <div class="space-y-3">
          <label class="block text-[10px] font-black uppercase text-on-surface-variant mb-2">Nome da Pasta</label>
          <input id="fold_name" class="w-full rounded-xl border-surface-container bg-surface-container-low text-sm" placeholder="Ex: 1- Administrativo" />
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const name = panel.querySelector("#fold_name")?.value?.trim();
        if (!name) { toast("Nome obrigatório", { type: "error" }); return; }
        const id = getProjectId();
        const btn = panel.querySelector("[data-primary]");
        try {
          setButtonLoading(btn, true);
          await apiRequest(`/projects/${encodeURIComponent(id)}/folders`, {
            method: "POST",
            body: { name, parentId: parentId || null }
          });
          toast("Pasta criada com sucesso", { type: "success" });
          close();
          await loadFiles();
        } catch (err) {
          setButtonLoading(btn, false);
          toast("Falha ao criar pasta", { type: "error" });
        }
      }
    });
  });
}

function wireFileNavigation() {
  document.addEventListener("click", async (e) => {
    // Entrar numa pasta
    const enterBtn = e.target?.closest("[data-enter-folder]");
    if (enterBtn && !e.target.closest("button[data-edit-folder]") && !e.target.closest("button[data-delete-folder]")) {
      const fid = enterBtn.getAttribute("data-enter-folder");
      const fname = enterBtn.getAttribute("data-folder-name");
      fileState.currentFolderId = fid;
      fileState.breadcrumbs.push({ id: fid, name: fname });
      loadFiles();
      return;
    }

    // Navegar pelos breadcrumbs
    const goBtn = e.target?.closest("[data-go-folder]");
    if (goBtn) {
      const gid = goBtn.getAttribute("data-go-folder");
      if (gid === "root") {
        fileState.currentFolderId = null;
        fileState.breadcrumbs = [];
      } else {
        const idx = fileState.breadcrumbs.findIndex(b => b.id === gid);
        if (idx !== -1) {
          fileState.currentFolderId = gid;
          fileState.breadcrumbs = fileState.breadcrumbs.slice(0, idx + 1);
        }
      }
      loadFiles();
      return;
    }

    // Apagar pasta
    const delFolderBtn = e.target?.closest("[data-delete-folder]");
    if (delFolderBtn) {
      e.stopPropagation();
      if (!confirm("Apagar esta pasta eliminará permanentemente TODOS os arquivos e subpastas. Continuar?")) return;
      const folderId = delFolderBtn.getAttribute("data-delete-folder");
      const id = getProjectId();
      try {
        await apiRequest(`/projects/${encodeURIComponent(id)}/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
        toast("Pasta removida", { type: "success" });
        await loadFiles();
      } catch (err) {
        toast("Erro ao apagar pasta", { type: "error" });
      }
      return;
    }

    // Apagar ficheiro
    const delFileBtn = e.target?.closest("[data-delete-file]");
    if (delFileBtn) {
      e.stopPropagation();
      if (!confirm("Eliminar este arquivo permanentemente?")) return;
      const fileId = delFileBtn.getAttribute("data-delete-file");
      const id = getProjectId();
      try {
        await apiRequest(`/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
        toast("Arquivo removido", { type: "success" });
        await loadFiles();
      } catch (err) {
        toast("Erro ao apagar arquivo", { type: "error" });
      }
      return;
    }

    // Editar (renomear) pasta
    const editFolderBtn = e.target?.closest("[data-edit-folder]");
    if (editFolderBtn) {
      e.stopPropagation();
      const folderId = editFolderBtn.getAttribute("data-edit-folder");
      const currentName = editFolderBtn.getAttribute("data-folder-name");
      const id = getProjectId();
      openModal({
        title: "Renomear Pasta",
        primaryLabel: "Guardar",
        contentHtml: `
          <div class="space-y-3">
            <label class="block text-[10px] font-black uppercase text-on-surface-variant mb-2">Novo Nome</label>
            <input id="rename_folder" class="w-full rounded-xl border-slate-300 text-sm" value="${escapeHtml(currentName)}" />
          </div>
        `,
        onPrimary: async ({ close, panel }) => {
          const name = panel.querySelector("#rename_folder")?.value?.trim();
          if (!name) { toast("Nome obrigatório", { type: "error" }); return; }
          const btn = panel.querySelector("[data-primary]");
          try {
            setButtonLoading(btn, true);
            await apiRequest(`/projects/${encodeURIComponent(id)}/folders/${encodeURIComponent(folderId)}`, {
              method: "PATCH", body: { name }
            });
            toast("Pasta renomeada", { type: "success" });
            close();
            await loadFiles();
          } catch (err) {
            setButtonLoading(btn, false);
            toast("Falha ao renomear pasta", { type: "error" });
          }
        }
      });
      return;
    }

    // Editar ficheiro
    const editFileBtn = e.target?.closest("[data-edit-file]");
    if (editFileBtn) {
      e.stopPropagation();
      const fileId = editFileBtn.getAttribute("data-edit-file");
      const currentName = editFileBtn.getAttribute("data-file-name");
      const currentCat = editFileBtn.getAttribute("data-file-cat") || "OUTROS";
      const id = getProjectId();

      // Carrega todas as pastas para o selector de mover
      let allFolders = [];
      try {
        const fr = await apiRequest(`/projects/${encodeURIComponent(id)}/folders?parentId=root`);
        allFolders = fr.items || [];
      } catch (_) { }

      const folderOptions = [
        `<option value="">Raiz (sem pasta)</option>`,
        ...allFolders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`)
      ].join("");

      openModal({
        title: "Editar Arquivo",
        primaryLabel: "Guardar",
        contentHtml: `
          <div class="space-y-4">
            <div>
              <label class="block text-[10px] font-black uppercase text-on-surface-variant mb-2">Nome do Arquivo</label>
              <input id="edit_fname" class="w-full rounded-xl border-slate-300 text-sm" value="${escapeHtml(currentName)}" />
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase text-on-surface-variant mb-2">Categoria</label>
              <select id="edit_fcat" class="w-full rounded-xl border-slate-300 text-sm">
                <option value="OUTROS" ${currentCat === 'OUTROS' ? 'selected' : ''}>Outros</option>
                <option value="PLANTA" ${currentCat === 'PLANTA' ? 'selected' : ''}>Planta / Projecto</option>
                <option value="CONTRATO" ${currentCat === 'CONTRATO' ? 'selected' : ''}>Contrato / Legal</option>
                <option value="FOTO" ${currentCat === 'FOTO' ? 'selected' : ''}>Registo Fotográfico</option>
                <option value="RELATORIO" ${currentCat === 'RELATORIO' ? 'selected' : ''}>Relatório Técnico</option>
              </select>
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase text-on-surface-variant mb-2">Mover para Pasta</label>
              <select id="edit_ffolder" class="w-full rounded-xl border-slate-300 text-sm">${folderOptions}</select>
            </div>
          </div>
        `,
        onPrimary: async ({ close, panel }) => {
          const name = panel.querySelector("#edit_fname")?.value?.trim();
          if (!name) { toast("Nome obrigatório", { type: "error" }); return; }
          const category = panel.querySelector("#edit_fcat")?.value;
          const folderId = panel.querySelector("#edit_ffolder")?.value || null;
          const btn = panel.querySelector("[data-primary]");
          try {
            setButtonLoading(btn, true);
            await apiRequest(`/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, {
              method: "PATCH",
              body: { originalName: name, category, folderId: folderId || null }
            });
            toast("Arquivo actualizado", { type: "success" });
            close();
            await loadFiles();
          } catch (err) {
            setButtonLoading(btn, false);
            toast("Falha ao actualizar arquivo", { type: "error" });
          }
        }
      });
      return;
    }
  });
}

function wireFileDeletion() {
  // DelegaÃ§Ã£o unificada em wireFileNavigation à” este stub mantÃ©m compatibilidade
}

function wireSearch() {
  const input = el("transactionsSearch");
  let t = null;
  input?.addEventListener("input", () => {
    txState.search = input.value.trim();
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => loadTransactions().catch(() => toast("Erro ao carregar lançamentos", { type: "error" })), 250);
  });
}

function wireExport() {
  el("exportProjectBtn")?.addEventListener("click", async () => {
    const id = getProjectId();
    const project = (await apiRequest(`/projects/${encodeURIComponent(id)}`)).project;
    const tx = await apiRequest(`/projects/${encodeURIComponent(id)}/transactions?page=1&pageSize=200`);

    const lines = [
      ["Projeto", project.name],
      ["Código", project.code],
      ["Orçamento_total", project.budgetTotal],
      ["Consumido", project.budgetConsumed],
      [],
      ["data", "descricao", "categoria", "responsavel", "status", "valor"],
      ...(tx.items || []).map((t) => [
        new Date(t.date).toISOString(),
        String(t.description || "").replaceAll('"', '""'),
        t.category,
        t.ownerName || "",
        t.status,
        t.amount,
      ]),
    ];
    const csv = lines
      .map((row) => (row.length ? row.map((c) => `"${String(c ?? "")}"`).join(",") : ""))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `projeto-${project.code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function wireNewTransaction() {
  el("newTransactionBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    try {
      const id = getProjectId();
    const budgetData = await apiRequest(`/projects/${encodeURIComponent(id)}/budget/lines`);
    const budgetOptions = [
      `<option value="">(Nenhum item específico)</option>`,
      ...(budgetData.items || []).map(l => `<option value="${l.id}">${escapeHtml(l.description)} [Previsto: ${formatCurrency(l.total, projectState?.currency)}]</option>`)
    ].join("");

    openModal({
      title: "Novo lançamento",
      primaryLabel: "Salvar",
      contentHtml: `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Descrição</label>
            <input id="t_desc" class="w-full rounded-lg border-slate-300" placeholder="Descrição..." />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Categoria</label>
            <select id="t_cat" class="w-full rounded-lg border-slate-300">
              <optgroup label="Custos Operacionais e Diretos">
                <option value="MATERIAIS_INSUMOS">Materiais e Insumos</option>
                <option value="SERVICOS_MAO_DE_OBRA">Mão de Obra e Serviços</option>
              </optgroup>
              <optgroup label="Gastos e Despesas">
                <option value="GASTOS_PESSOAL">Gastos com Pessoal</option>
                <option value="DESPESAS_OPERACIONAIS">Despesas Operacionais</option>
                <option value="DEPRECIACAO">Depreciação</option>
                <option value="IMPOSTOS">Impostos</option>
                <option value="OUTRAS_DESPESAS">Outras Despesas</option>
              </optgroup>
              <optgroup label="Deduções">
                <option value="DEDUCOES">Dedução de Custos / Reembolso</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Status</label>
            <select id="t_status" class="w-full rounded-lg border-slate-300">
              <option value="PENDING">Pendente</option>
              <option value="PAID">Liquidado</option>
              <option value="LATE">Atrasado</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Responsável</label>
            <input id="t_owner" class="w-full rounded-lg border-slate-300" placeholder="Nome" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Valor (${projectState?.currency || "Kz"})</label>
            <input id="t_amount" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-black uppercase tracking-widest text-primary mb-2">Vincular Item do Orçamento</label>
            <select id="t_line" class="w-full rounded-lg border-slate-300 text-sm">
              ${budgetOptions}
            </select>
          </div>
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const id = getProjectId();
        const v = (x) => panel.querySelector(`#${x}`)?.value?.trim?.();
        const btn = panel.querySelector("[data-primary]");
        try {
          setButtonLoading(btn, true);
          await apiRequest(`/projects/${encodeURIComponent(id)}/transactions`, {
            method: "POST",
            body: {
              description: v("t_desc"),
              category: v("t_cat"),
              status: v("t_status"),
              ownerName: v("t_owner") || null,
              amount: Number(v("t_amount") || 0),
              budgetLineId: v("t_line") || null,
            },
          });
          toast("lançamento criado com sucesso", { type: "success" });
          close();
          await loadProject();
          await loadTransactions();
          await loadBudgetExecution();
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message || "Erro ao criar lançamento", { type: "error" });
        }
      },
    });
    } finally {
      setButtonLoading(btn, false);
    }
  });
}


// =============================================================================
// PAGAMENTOS DO CLIENTE
// =============================================================================

function metodoPagtoLabel(m) {
  const map = {
    transferencia: "Transferência",
    cash: "Numerário",
    cheque: "Cheque",
    mbway: "MBWay",
    outro: "Outro",
  };
  return m ? (map[m.toLowerCase()] || m) : "â€”";
}

function renderPaymentRow(p, role) {
  const isConf = p.status === "CONFIRMADO";
  const statusCls = isConf ? "text-emerald-700 bg-emerald-50 border border-emerald-100" : "text-amber-600 bg-amber-50 border border-amber-100";
  const statusDot = isConf ? "bg-emerald-500" : "bg-amber-400";
  const statusText = isConf ? "Confirmado" : "Pendente";
  const canConfirm = !isConf && role === "admin";
  const canDelete = role === "admin";

  return `
    <tr class="hover:bg-slate-50/70 transition-colors">
      <td class="px-10 py-4 text-xs font-semibold text-slate-500 whitespace-nowrap">${formatDateBR(p.dataPagamento)}</td>
      <td class="px-10 py-4 font-bold text-slate-700 whitespace-nowrap">${p.metodo ? escapeHtml(p.metodo).toUpperCase() : "-"}</td>
      <td class="px-10 py-4 text-xs text-slate-500 hidden lg:table-cell">${escapeHtml(p.referencia || "â€”")}</td>
      <td class="px-10 py-4 text-xs text-slate-400 hidden xl:table-cell">${escapeHtml(p.criadoPor || "â€”")}</td>
      <td class="px-10 py-4 text-right font-black text-slate-900 whitespace-nowrap">${formatCurrency(p.valor, projectState?.currency)}</td>
      <td class="px-10 py-4 text-center">
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusCls}">
          <span class="w-1.5 h-1.5 rounded-full ${statusDot}"></span>${statusText}
        </span>
      </td>
      <td class="px-10 py-4 text-center">
        <div class="flex items-center justify-center gap-2">
          ${p.comprovativoPath ? `<a href="${getAssetUrl(p.comprovativoPath)}" target="_blank" title="Ver Comprovativo" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all"><span class="material-symbols-outlined text-base">picture_as_pdf</span></a>` : ""}
          ${canConfirm ? `<button data-confirm-payment="${p.id}" title="Confirmar pagamento" class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all"><span class="material-symbols-outlined text-base">check_circle</span></button>` : ""}
          ${canDelete ? `<button data-delete-payment="${p.id}" title="Apagar pagamento" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all"><span class="material-symbols-outlined text-base">delete</span></button>` : ""}
          ${!canConfirm && !canDelete && !p.comprovativoPath ? `<span class="text-slate-300 text-xs">â€”</span>` : ""}
        </div>
      </td>
    </tr>
  `;
}

function updatePaymentKPIs(data) {
  const pct = Math.min(100, Math.max(0, data.percentualPago || 0));
  if (el("paymentTotalPago")) el("paymentTotalPago").textContent = formatCurrency(data.totalPago || 0, projectState?.currency);
  if (el("paymentDivida")) el("paymentDivida").textContent = formatCurrency(Math.max(0, data.divida || 0), projectState?.currency);
  if (el("paymentPct")) el("paymentPct").textContent = `${pct}%`;
  if (el("paymentPctLabel")) el("paymentPctLabel").textContent = `${pct}%`;
  if (el("paymentProgressBar")) {
    el("paymentProgressBar").style.width = `${pct}%`;
    if (pct >= 100) {
      el("paymentProgressBar").classList.replace("bg-emerald-500", "bg-blue-500");
    }
  }
}

async function loadPayments() {
  const id = getProjectId();
  const tbody = el("paymentsTbody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="px-10 py-8 text-center text-xs text-slate-400">A carregar...</td></tr>`;
  try {
    const role = getSessionUser()?.role;
    const data = await apiRequest(`/projects/${encodeURIComponent(id)}/payments`);
    updatePaymentKPIs(data);
    if (!data.items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="px-10 py-10 text-center text-xs text-slate-400"><span class="material-symbols-outlined text-3xl block mb-2 mx-auto text-slate-200">account_balance_wallet</span>Nenhum pagamento registado</td></tr>`;
      return;
    }
    tbody.innerHTML = data.items.map(p => renderPaymentRow(p, role)).join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="7" class="px-10 py-8 text-center text-xs text-red-400">Erro ao carregar pagamentos</td></tr>`;
  }
}

function openPaymentModal() {
  const today = new Date().toISOString().split("T")[0];
  openModal({
    title: "Registar Pagamento",
    contentHtml: `
      <div class="space-y-5">
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Valor (${projectState?.currency || "Kz"}) *</label>
          <input id="pm_valor" type="number" min="1" step="0.01" placeholder="0.00" required
            class="w-full px-4 h-12 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all" />
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Data do Pagamento *</label>
          <input id="pm_data" type="date" value="${today}" required
            class="w-full px-4 h-12 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Método</label>
            <select id="pm_metodo" class="w-full px-4 h-12 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all">
              <option value="">â€” Seleccionar à”</option>
              <option value="transferencia">Transferência Bancária</option>
              <option value="cash">Numerário (Cash)</option>
              <option value="cheque">Cheque</option>
              <option value="mbway">MBWay</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Referência</label>
            <input id="pm_ref" type="text" placeholder="Ex: TRF-001"
              class="w-full px-4 h-12 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Comprovativo (PDF)</label>
          <div class="relative group">
            <input id="pm_file" type="file" accept="application/pdf"
              class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div class="w-full h-12 px-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl flex items-center gap-2 group-hover:bg-slate-100 transition-all">
              <span class="material-symbols-outlined text-slate-400">upload_file</span>
              <span id="pm_file_name" class="text-xs text-slate-500 font-semibold truncate">Escolher ficheiro...</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
          <span class="material-symbols-outlined text-amber-500 text-xl">info</span>
          <p class="text-xs text-amber-700 font-semibold italic">O pagamento ficará <strong>Pendente</strong> até confirmação.</p>
        </div>
      </div>
    `,
    primaryLabel: "Registar",
    onPrimary: async ({ btn, close, panel }) => {
      const v = (id) => panel.querySelector(`#${id}`)?.value?.trim() || "";
      const valor = v("pm_valor");
      const data = v("pm_data");
      const fileInput = panel.querySelector("#pm_file");

      if (!valor) return toast("Valor obrigatório", { type: "error" });

      setButtonLoading(btn, true);
      try {
        const id = getProjectId();
        const fd = new FormData();
        fd.append("valor", valor);
        fd.append("dataPagamento", new Date(data).toISOString());
        fd.append("metodo", v("pm_metodo") || "");
        fd.append("referencia", v("pm_ref") || "");
        if (fileInput?.files?.length) {
          fd.append("comprovativo", fileInput.files[0]);
        }

        await apiUpload(`/projects/${encodeURIComponent(id)}/payments`, {
          file: fileInput?.files?.[0],
          fieldName: "comprovativo",
          extraFields: {
            valor,
            dataPagamento: new Date(data).toISOString(),
            metodo: v("pm_metodo") || "",
            referencia: v("pm_ref") || ""
          }
        });



        toast("Pagamento registado!", { type: "success" });
        close();
        await loadPayments();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message, { type: "error" });
      }
    },
  });

  // Atualiza nome do ficheiro ao selecionar
  setTimeout(() => {
    const fileInput = document.getElementById("pm_file");
    const nameEl = document.getElementById("pm_file_name");
    fileInput?.addEventListener("change", (e) => {
      if (e.target.files.length) {
        nameEl.textContent = e.target.files[0].name;
        nameEl.classList.remove("text-slate-500");
        nameEl.classList.add("text-emerald-600");
      }
    });
  }, 100);
}

function wirePayments() {
  el("addPaymentBtn")?.addEventListener("click", openPaymentModal);

  document.addEventListener("click", async (e) => {
    // Confirmar pagamento (admin)
    const confirmBtn = e.target.closest("[data-confirm-payment]");
    if (confirmBtn) {
      const pid = confirmBtn.getAttribute("data-confirm-payment");
      try {
        setButtonLoading(confirmBtn, true);
        const id = getProjectId();
        await apiRequest(`/projects/${encodeURIComponent(id)}/payments/${pid}`, {
          method: "PATCH",
          body: { status: "CONFIRMADO" },
        });
        toast("Pagamento confirmado", { type: "success" });
        await loadPayments();
      } catch (err) {
        setButtonLoading(confirmBtn, false);
        toast(err.message || "Erro ao confirmar", { type: "error" });
      }
      return;
    }

    // Apagar pagamento (admin)
    const deleteBtn = e.target.closest("[data-delete-payment]");
    if (deleteBtn) {
      const pid = deleteBtn.getAttribute("data-delete-payment");
      if (!confirm("Tem a certeza que deseja apagar este pagamento? Esta acção é irreversí­vel.")) return;
      try {
        setButtonLoading(deleteBtn, true);
        const id = getProjectId();
        await apiRequest(`/projects/${encodeURIComponent(id)}/payments/${pid}`, { method: "DELETE" });
        toast("Pagamento apagado", { type: "success" });
        await loadPayments();
      } catch (err) {
        setButtonLoading(deleteBtn, false);
        toast(err.message || "Erro ao apagar", { type: "error" });
      }
    }
  });
}

let uiState = {
  collapsedTables: JSON.parse(localStorage.getItem("InfoCliente.collapsedTables") || "{}")
};

function toggleTable(tableId, manual = true) {
  const body = document.querySelector(`[data-table-body="${tableId}"]`);
  const btn = document.querySelector(`[data-toggle-table="${tableId}"]`);
  if (!body) return;

  if (manual) {
    uiState.collapsedTables[tableId] = !uiState.collapsedTables[tableId];
    localStorage.setItem("InfoCliente.collapsedTables", JSON.stringify(uiState.collapsedTables));
  }

  const isCollapsed = uiState.collapsedTables[tableId];

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

function wireTablesToggle() {
  document.querySelectorAll("[data-toggle-table]").forEach(btn => {
    const tableId = btn.getAttribute("data-toggle-table");
    btn.addEventListener("click", () => toggleTable(tableId, true));

    // Apply initial state
    toggleTable(tableId, false);
  });
}

async function init() {
  initMobileMenu();
  wireLogout();
  wireUsersNav();
  await loadProject();
  await loadTransactions();
  await loadBudgetExecution();
  await loadPayments();
  wireSearch();
  wireExport();
  wireNewTransaction();
  wireLiquidation();
  wireTabs();
  wireFilesUpload();
  wireNewFolder();
  wireFileNavigation();
  wireFileDeletion();
  wirePreview();
  wireProgressTasks();
  wirePayments();
  wireStock();
  wireGallery();
  wireTablesToggle();

  // Photo Previews Lightbox
  document.addEventListener("click", e => {
    const photoItem = e.target.closest("[data-preview-photo]");
    if (photoItem) {
      const photoId = photoItem.getAttribute("data-preview-photo");
      openPhotoPreview(photoId);
      return;
    }

    // Close Lightbox on backdrop click
    const lightbox = el("imageLightbox");
    if (e.target === lightbox || e.target.closest("#closeLightbox")) {
      closeLightbox();
    }
  });

  // ESC key for Lightbox
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  // Redirecionamento automÃ¡tico para cliente
  const user = getSessionUser();
  if (user?.role === "cliente" || user?.role === "client") {
    const tabBtn = el("tabTriggerGaleria");
    if (tabBtn) tabBtn.click();
  } else {
    applyRoleVisibility();
  }
}

function openPreview(fileId) {
  const file = fileState.items.find(f => f.id === fileId);
  if (!file) return;

  const fileUrl = getAssetUrl(file.path);

  el("previewFileName").textContent = file.originalName;
  el("previewFileMeta").textContent = `${formatBytes(file.size)}à ${formatDateBR(file.createdAt)}à ${file.category}`;
  el("previewDownloadBtn").href = fileUrl;
  el("previewDownloadBtn").setAttribute("download", file.originalName);

  const body = el("previewBody");
  body.innerHTML = "";

  if (file.mimeType.startsWith("image/")) {
    body.innerHTML = `<img src="${fileUrl}" class="max-w-full max-h-full rounded-lg shadow-lg object-contain" />`;
  } else if (file.mimeType === "application/pdf") {
    body.innerHTML = `<iframe src="${fileUrl}" class="w-full h-full rounded-lg border-0 bg-white"></iframe>`;
  } else {
    body.innerHTML = `
      <div class="text-center">
        <span class="material-symbols-outlined text-7xl text-on-surface-variant/20 mb-6">description</span>
        <p class="text-on-surface-variant font-bold mb-4 text-sm">Este arquivo nÃ£o suporta prÃ©-visualizaÃ§Ã£o direta.</p>
        <a href="${fileUrl}" download="${file.originalName}" class="inline-flex items-center gap-2 bg-primary text-white px-8 py-3 rounded-xl font-bold hover:brightness-110 transition-all">
          <span class="material-symbols-outlined">download</span> Download do Arquivo
        </a>
      </div>
    `;
  }

  el("previewPanel").classList.add("open");
  el("previewBackdrop").classList.add("open");
}

function openPhotoPreview(photoId) {
  const photo = galleryState.items.find(p => p.id === photoId);
  if (!photo) return;

  const url = getAssetUrl(photo.path);
  const title = photo.description || (photo.movement?.material?.name ? `Registo: ${photo.movement.material.name}` : "Foto de Obra");
  const date = formatDateBR(photo.createdAt);

  openLightbox(url, title, date);
}

function openLightbox(url, title, date) {
  const lightbox = el("imageLightbox");
  const img = el("lightboxImage");
  const titleEl = el("lightboxTitle");
  const dateEl = el("lightboxDate");

  if (!lightbox || !img) return;

  img.src = url;
  titleEl.textContent = title;
  dateEl.textContent = date;

  lightbox.classList.add("active");
  document.body.style.overflow = "hidden"; // Prevent scrolling
}

function closeLightbox() {
  const lightbox = el("imageLightbox");
  if (!lightbox) return;

  lightbox.classList.remove("active");
  document.body.style.overflow = ""; // Restore scrolling
}

function wirePreview() {
  el("closePreviewBtn")?.addEventListener("click", () => {
    el("previewPanel").classList.remove("open");
    el("previewBackdrop").classList.remove("open");
  });

  el("previewBackdrop")?.addEventListener("click", () => {
    el("previewPanel").classList.remove("open");
    el("previewBackdrop").classList.remove("open");
  });

  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-preview-file]");
    if (card && !e.target.closest("button") && !e.target.closest("a")) {
      const id = card.getAttribute("data-preview-file");
      openPreview(id);
    }
  });
}

init().catch(() => toast("Falha ao carregar projeto. Verifique login/API.", { type: "error" }));
async function loadStock() {
  const id = getProjectId();
  renderLoadingRow(el("stockMovementsTbody"), 7);

  try {
    const [summaryRes, movementsRes] = await Promise.all([
      apiRequest(`/stock/${encodeURIComponent(id)}/summary`),
      apiRequest(`/stock/${encodeURIComponent(id)}/movements`),
    ]);

    stockState.items = movementsRes.items;
    stockState.summary = summaryRes.items; // Guardar o resumo consolidado
    renderStockSummary(summaryRes.items);
    applyStockFilters();
  } catch (err) {
    toast("Erro ao carregar dados de stock", { type: "error" });
  }
}

function renderStockSummary(items) {
  const materialTypesCount = items.length;
  const goodTotal = items.reduce((acc, curr) => acc + Number(curr.quantityGood || 0), 0);
  const damagedTotal = items.reduce((acc, curr) => acc + Number(curr.quantityDamaged || 0), 0);

  el("stockSummary").innerHTML = `
    <div class="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Tipos de Materiais</p>
        <p class="text-2xl font-bold text-slate-900">${materialTypesCount}</p>
    </div>
    <div class="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
        <p class="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-2">Stock (BOM)</p>
        <p class="text-2xl font-bold text-emerald-600">${goodTotal}</p>
    </div>
    <div class="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
        <p class="text-[10px] font-black uppercase tracking-widest text-red-500 mb-2">Perca / Danificado</p>
        <p class="text-2xl font-bold text-red-500">${damagedTotal}</p>
    </div>
    <div class="bg-[#0F172A] p-6 rounded-[32px] border border-slate-800 shadow-xl">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Aguardando Auditoria</p>
        <p id="stockPendingCount" class="text-2xl font-bold text-[#2afc8d]">---</p>
    </div>
  `;
}

function renderStockMovements(items) {
  const tbody = el("stockMovementsTbody");
  if (!tbody) return;

  // Guardar os dados no prÃ³prio elemento para o modal de detalhes
  el("stockMovementsTable")._movementsData = items;
  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-10 py-10 text-center text-slate-400 font-medium">Nenhum movimento registrado nesta obra.</td></tr>`;
    if (el("stockPendingCount")) el("stockPendingCount").textContent = "0";
    return;
  }

  const pendingChanges = items.filter(i => i.auditStatus === "PENDENTE" || i.auditStatus === "VALIDACAO").length;
  const countEl = el("stockPendingCount");
  if (countEl) countEl.textContent = pendingChanges;

  tbody.innerHTML = items.map(m => {
    const auditCls = {
      PENDENTE: "bg-amber-50 text-amber-600",
      VALIDACAO: "bg-blue-50 text-blue-600",
      APROVADO: "bg-emerald-50 text-emerald-600",
      REJEITADO: "bg-red-50 text-red-600",
    }[m.auditStatus];

    return `
      <tr class="border-b border-slate-50 hover:bg-slate-50/80 transition-all cursor-pointer group" data-view-stock="${m.id}">
        <td class="px-10 py-5">
          <div class="text-xs font-bold text-slate-900">${formatDateBR(m.dateEntry)}</div>
          <div class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">${escapeHtml(m.technicianName || "TÃ‰CNICO")}</div>
        </td>
        <td class="px-10 py-5">
          <div class="text-xs font-bold text-slate-900">${escapeHtml(m.material.name)}</div>
          <div class="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">${m.material.code}à ${m.material.category}</div>
        </td>
        <td class="px-10 py-5">
          <div class="flex flex-col gap-1">
            ${m.quantityGood > 0 ? `<div class="flex items-center gap-2"><span class="text-xs font-black text-slate-900">${m.quantityGood} ${m.material.unit}</span> <span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[8px] font-black">BOM</span></div>` : ""}
            ${m.quantityDamaged > 0 ? `<div class="flex items-center gap-2"><span class="text-xs font-black text-slate-900">${m.quantityDamaged} ${m.material.unit}</span> <span class="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[8px] font-black">MAU</span></div>` : ""}
            ${!(Number(m.quantityGood) > 0) && !(Number(m.quantityDamaged) > 0) ? `<span class="text-xs font-black text-slate-900">${m.quantity} ${m.material.unit}</span>` : ""}
          </div>
        </td>
        <td class="px-10 py-5 text-[10px] font-medium text-slate-500">
           ${escapeHtml(m.driverName || "-")} | ${escapeHtml(m.vehiclePlate || "S/M")} <br>
           <span class="text-slate-400 uppercase text-[9px] font-black">${m.entryType || "PROPRIO"}</span>
        </td>
        <td class="px-10 py-5">
          <span class="px-3 py-1 rounded-lg text-[9px] font-black bg-slate-100 text-slate-600 uppercase tracking-widest">${m.movementStatus}</span>
        </td>
        <td class="px-10 py-5">
          <span class="px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${auditCls}">${m.auditStatus}</span>
        </td>
        <td class="px-10 py-5 text-right">
           ${(m.auditStatus === "PENDENTE" || m.auditStatus === "VALIDACAO") && m.type !== "AJUSTE" ? `
              <button data-approve-stock="${m.id}" class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 inline-flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all">
                <span class="material-symbols-outlined text-sm">done_all</span>
              </button>
              <button data-reject-stock="${m.id}" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 inline-flex items-center justify-center hover:bg-red-600 hover:text-white transition-all">
                <span class="material-symbols-outlined text-sm">close</span>
              </button>
           ` : `
              <span class="text-slate-300 material-symbols-outlined text-sm">lock</span>
           `}
           <button data-delete-stock-move="${m.id}" class="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 inline-flex items-center justify-center hover:bg-red-600 hover:text-white transition-all ml-1">
             <span class="material-symbols-outlined text-sm">delete</span>
           </button>
        </td>
      </tr>
    `;
  }).join("");

  wireStockWorkflow();
}

function wireStockWorkflow() {
  document.querySelectorAll("[data-approve-stock]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      approveStockMovement(btn.dataset.approveStock);
    });
  });
  document.querySelectorAll("[data-reject-stock]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      rejectStockMovement(btn.dataset.rejectStock);
    });
  });
  // Removido o event listener de [data-view-stock] aqui pois ele jÃ¡ Ã© delegado via document no wireStock!
}

async function openStockMovementDetailModal(moveId) {
  const movements = el("stockMovementsTable")._movementsData || [];
  const m = movements.find(x => x.id === moveId);
  if (!m) return;

  const renderPhotos = (cond) => {
    const pList = m.photos.filter(p => !cond || p.condition === cond);
    if (pList.length === 0) return `<p class="text-[10px] text-slate-400 italic">Sem evidências.</p>`;
    return `<div class="flex flex-wrap gap-3">
      ${pList.map(p => {
      const url = getAssetUrl(p.path);
      return `
          <div class="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
            <a href="${url}" target="_blank">
               <img src="${url}" class="w-full h-full object-cover hover:scale-105 transition-all">
            </a>
          </div>
        `;
    }).join("")}
    </div>`;
  };

  const isClosed = (m.auditStatus === "APROVADO" || m.auditStatus === "REJEITADO");

  openModal({
    title: "Detalhes do lançamento",
    contentHtml: `
      <div class="space-y-6">
        <div class="grid grid-cols-2 gap-8">
          <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">InformaÃ§Ã£o Base</p>
            <div class="space-y-1">
              <h4 class="text-lg font-bold text-slate-900">${escapeHtml(m.material.name)}</h4>
              <p class="text-xs text-slate-500 font-medium">${m.material.code}à ${m.material.category}</p>
              <div class="mt-4 flex flex-col gap-2">
                 <div class="flex justify-between items-center py-2 border-b border-slate-100">
                    <span class="text-[10px] font-bold text-slate-500">TIPO</span>
                    <span class="text-[10px] font-black text-slate-900">${m.type}</span>
                 </div>
                 <div class="flex justify-between items-center py-2 border-b border-slate-100">
                    <span class="text-[10px] font-bold text-slate-500">QUANT. BOA</span>
                    <span class="text-[10px] font-black text-emerald-600">${m.quantityGood || 0} ${m.material.unit}</span>
                 </div>
                 <div class="flex justify-between items-center py-2 border-b border-slate-100">
                    <span class="text-[10px] font-bold text-slate-500">QUANT. DANIFICADA</span>
                    <span class="text-[10px] font-black text-red-600">${m.quantityDamaged || 0} ${m.material.unit}</span>
                 </div>
              </div>
            </div>
          </div>
          <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Controlo Logístico</p>
            <div class="bg-slate-50 rounded-2xl p-4 space-y-3">
               <div>
                  <span class="text-[9px] font-black text-slate-400 block uppercase">Motorista</span>
                  <span class="text-xs font-bold text-slate-900">${escapeHtml(m.driverName || "Não informado")}</span>
               </div>
               <div>
                  <span class="text-[9px] font-black text-slate-400 block uppercase">Viatura / Matrícula</span>
                  <span class="text-xs font-bold text-slate-900">${escapeHtml(m.vehicleBrand || "")} ${escapeHtml(m.vehiclePlate || "N/D")}</span>
               </div>
               <div>
                  <span class="text-[9px] font-black text-slate-400 block uppercase">Origem</span>
                  <span class="text-xs font-bold text-slate-900 uppercase">${m.entryType || "PROPRIO"}</span>
               </div>
            </div>
          </div>
        </div>

        <div>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Evidências Fotográficas</p>
          <div class="space-y-4">
             <div>
                <span class="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-2 block">Material em Bom Estado</span>
                ${renderPhotos("BOA")}
             </div>
             <div>
                <span class="text-[9px] font-black text-red-600 uppercase tracking-widest mb-2 block">Cargas com Danos / Defeitos</span>
                ${renderPhotos("DANIFICADA")}
             </div>
          </div>
        </div>

        ${m.notes ? `
          <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Observações</p>
            <p class="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border-l-4 border-slate-200 font-medium">${escapeHtml(m.notes)}</p>
          </div>
        ` : ""}

        ${(!isClosed && m.type !== "AJUSTE") ? `
          <div class="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex gap-3">
             <span class="material-symbols-outlined text-emerald-600">info</span>
             <p class="text-[11px] text-emerald-800 font-medium leading-relaxed">
                Ao <strong>Aprovar</strong> este lançamento, apenas a <span class="font-bold">Quantidade BOA</span> (${m.quantityGood}) será integrada no inventário útil do armazém. O material <span class="text-red-600 font-bold">Danificado</span> (${m.quantityDamaged}) será mantido apenas como registo de evidência e não constará no saldo disponível para uso.
             </p>
          </div>
        ` : ""}
      </div>
    `,
    primaryLabel: isClosed ? "Fechar" : "Aprovar lançamento",
    onPrimary: async ({ close, btn }) => {
      if (isClosed) {
        close();
        return;
      }

      setButtonLoading(btn, true);
      try {
        await approveStockMovement(m.id);
        close();
      } catch (err) {
        setButtonLoading(btn, false);
      }
    },
    secondaryLabel: isClosed ? null : "Rejeitar",
    onSecondary: async ({ close }) => {
      if (confirm("Tem certeza que deseja REJEITAR este lançamento?")) {
        await rejectStockMovement(m.id);
        close();
      }
    }
  });
}
async function approveStockMovement(id) {
  const moveId = id;
  const projectId = getProjectId();
  try {
    await apiRequest(`/stock/${encodeURIComponent(projectId)}/movements/${encodeURIComponent(moveId)}/audit`, {
      method: "PATCH",
      body: { status: "APROVADO", notes: "Aprovado via dashboard administrativo." }
    });
    toast("lançamento aprovado com sucesso", { type: "success" });
    loadStock();
  } catch (err) {
    toast(err.message || "Erro ao aprovar lançamento", { type: "error" });
  }
}

async function rejectStockMovement(id) {
  const moveId = id;
  const projectId = getProjectId();
  try {
    await apiRequest(`/stock/${encodeURIComponent(projectId)}/movements/${encodeURIComponent(moveId)}/audit`, {
      method: "PATCH",
      body: { status: "REJEITADO", notes: "Rejeitado pelo administrador." }
    });
    toast("lançamento rejeitado", { type: "warning" });
  } catch (err) {
    toast(err.message || "Erro ao rejeitar lançamento", { type: "error" });
  }
}
async function openStockMovementModal() {
  const projectId = getProjectId();

  try {
    const materialsRes = await apiRequest("/stock/materials");
    const materials = materialsRes.items || [];

    if (materials.length === 0) {
      toast("Inicializando catálogo básico...", { type: "info" });
      await apiRequest("/stock/init-catalog", { method: "POST" });
      return openStockMovementModal();
    }

    const materialOptions = materials.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.unit})</option>`).join("");

    openModal({
      title: "Novo lançamento de Stock",
      contentHtml: `
        <div class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1">Material</label>
              <select id="st_mId" class="w-full h-12 bg-slate-50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all">
                ${materialOptions}
              </select>
            </div>
            <div class="space-y-1.5">
              <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1">Tipo de Movimento</label>
              <select id="st_type" class="w-full h-12 bg-slate-50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all">
                <option value="ENTRADA">Entrada / Recebimento</option>
                <option value="SAIDA">Saída / Aplicação</option>
                <option value="TRANSFERENCIA">Transferência</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-[10px] font-black uppercase tracking-widest text-emerald-600 pl-1">Quantidade BOA</label>
              <input type="number" id="st_qtyGood" placeholder="0.00" class="w-full h-12 bg-emerald-50/50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all">
            </div>
            <div class="space-y-1.5">
              <label class="text-[10px] font-black uppercase tracking-widest text-red-600 pl-1">Quantidade DANIFICADA</label>
              <input type="number" id="st_qtyDamaged" placeholder="0.00" class="w-full h-12 bg-red-50/50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-red-500 transition-all">
            </div>
          </div>
          
          <div class="p-4 bg-slate-50 rounded-2xl space-y-4">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Logística e Dados de Transporte</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
               <input id="st_driver" placeholder="Nome do Motorista" class="h-10 bg-white rounded-lg px-3 text-[11px] font-bold border border-slate-100">
               <input id="st_plate" placeholder="Matrícula" class="h-10 bg-white rounded-lg px-3 text-[11px] font-bold border border-slate-100 uppercase">
               <input id="st_brand" placeholder="Marca Viatura" class="h-10 bg-white rounded-lg px-3 text-[11px] font-bold border border-slate-100">
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
               <select id="st_entryType" class="h-10 bg-white rounded-lg px-3 text-[11px] font-bold border border-slate-100">
                  <option value="proprio">Material Próprio (InfoCliente)</option>
                  <option value="cliente">Fornecido pelo Cliente</option>
                  <option value="fornecedor">Compra Direta Fornecedor</option>
               </select>
                <select id="st_warehouse" class="h-10 bg-white rounded-lg px-3 text-[11px] font-bold border border-slate-100">
                  <option value="Armazém Principal">Armazém Principal</option>
                  <option value="Armazém do Cliente">Armazém do Cliente</option>
                  <option value="Contentor Obra">Contentor Obra</option>
                  <option value="Viatura Técnica">Viatura Técnica</option>
                  <option value="Estaleiro">Estaleiro</option>
               </select>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-1.5">
              <label class="text-[10px] font-black uppercase tracking-widest text-emerald-600 pl-1">Evidência: Bom Estado</label>
              <input type="file" id="st_photos_good" multiple accept="image/*" class="w-full text-[10px] text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-[10px] file:font-black file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100">
            </div>
            <div class="space-y-1.5">
              <label class="text-[10px] font-black uppercase tracking-widest text-red-600 pl-1">Evidência: Danificado</label>
              <input type="file" id="st_photos_bad" multiple accept="image/*" class="w-full text-[10px] text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-[10px] file:font-black file:bg-red-50 file:text-red-700 hover:file:bg-red-100">
            </div>
          </div>
        </div>
      `,
      primaryText: "Registrar lançamento",
      onPrimary: async ({ btn, close, panel }) => {
        const v = (id) => panel.querySelector(`#${id}`)?.value?.trim() || "";
        const mId = v("st_mId");
        if (!mId) return toast("Selecione um material", { type: "error" });

        setButtonLoading(btn, true);
        try {
          const qtyGood = Number(v("st_qtyGood") || 0);
          const qtyBad = Number(v("st_qtyDamaged") || 0);

          const move = await apiRequest(`/stock/${encodeURIComponent(projectId)}/movements`, {
            method: "POST",
            body: {
              materialId: mId,
              type: v("st_type"),
              quantityGood: qtyGood,
              quantityDamaged: qtyBad,
              entryType: v("st_entryType"),
              driverName: v("st_driver"),
              vehiclePlate: v("st_plate"),
              vehicleBrand: v("st_brand"),
              batch: v("st_warehouse"),
              technicianName: getSessionUser()?.email?.split("@")[0] || "TÃ©cnico"
            }
          });

          // Upload Photos with condition tags
          const uploadFiles = async (input, cond) => {
            if (!input || input.files.length === 0) return;

            let lat = "", lng = "";
            try {
              const pos = await new Promise((res, rej) => {
                navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 });
              });
              lat = pos.coords.latitude.toString();
              lng = pos.coords.longitude.toString();
            } catch (e) { }

            for (const file of input.files) {
              await apiUpload(`/stock/${encodeURIComponent(projectId)}/photos`, {
                file,
                extraFields: { movementId: move.id, materialId: mId, lat: lat, lng: lng, condition: cond }
              });
            }
          };

          await uploadFiles(el("st_photos_good"), "BOA");
          await uploadFiles(el("st_photos_bad"), "DANIFICADA");

          toast("lançamento registrado e aguardando validação", { type: "success" });
          close();
          loadStock();
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message || "Erro ao salvar", { type: "error" });
        }
      }
    });

    // Auto-select ArmazÃ©m do Cliente if entry type is cliente
    const entryTypeEl = document.getElementById("st_entryType");
    const warehouseEl = document.getElementById("st_warehouse");
    entryTypeEl?.addEventListener("change", (e) => {
      if (e.target.value === "cliente") {
        warehouseEl.value = "Armazém do Cliente";
      }
    });
  } catch (err) {
    toast("Erro ao carregar catálogo", { type: "error" });
  }
}

function applyStockFilters() {
  const { search, condition, status, category, warehouse } = stockState.filters;
  const filtered = stockState.items.filter(m => {
    const s = search.toLowerCase();
    const matchesSearch = !s ||
      m.material.name.toLowerCase().includes(s) ||
      m.material.code.toLowerCase().includes(s) ||
      (m.driverName || "").toLowerCase().includes(s) ||
      (m.vehiclePlate || "").toLowerCase().includes(s);

    const matchesCond = !condition || m.condition === condition;
    const matchesStatus = !status || m.auditStatus === status;
    const matchesCat = !category || m.material.category === category;
    const matchesWarehouse = !warehouse || m.batch === warehouse;

    return matchesSearch && matchesCond && matchesStatus && matchesCat && matchesWarehouse;
  });

  renderStockMovements(filtered);
  renderStockInventory(filtered, stockState.summary || []);
}

function renderStockInventory(movements, summary) {
  const tbody = el("stockInventoryTbody");
  if (!tbody) return;

  const approved = movements.filter(m => m.auditStatus === "APROVADO");

  // Agrupar por Material + ArmazÃ©m (batch)
  const inventoryMap = {};

  approved.forEach(m => {
    // Danificadas nÃ£o entram no armazÃ©m (conforme pedido)
    const qty = Number(m.quantityGood || 0);
    if (qty <= 0) return;

    const key = `${m.materialId}_${m.batch || "Geral"}`;
    if (!inventoryMap[key]) {
      inventoryMap[key] = {
        materialId: m.materialId,
        material: m.material,
        warehouse: m.batch || "Geral",
        totalIn: 0,
        totalOut: 0
      };
    }

    if (m.type === "ENTRADA") inventoryMap[key].totalIn += qty;
    else if (m.type === "SAIDA") inventoryMap[key].totalOut += qty;
  });

  const lines = Object.values(inventoryMap);
  if (lines.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-10 py-10 text-center text-slate-400 font-medium">Sem stock útil disponível no armazém.</td></tr>`;
    return;
  }

  tbody.innerHTML = lines.map(l => {
    const balance = l.totalIn - l.totalOut;
    const sItem = summary.find(s => s.materialId === l.materialId);
    const planned = sItem ? Number(sItem.quantityPlanned || 0) : 0;
    return `
      <tr class="border-b border-slate-50 hover:bg-slate-50/80 transition-all">
        <td class="px-10 py-5">
           <div class="text-xs font-bold text-slate-900">${escapeHtml(l.material.name)}</div>
           <div class="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">${l.material.code}à ${l.material.category}</div>
        </td>
        <td class="px-10 py-5 text-center">
           <span class="px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest">${escapeHtml(l.warehouse)}</span>
        </td>
        <td class="px-10 py-5 text-center text-[10px] font-bold text-slate-500">${l.material.unit}</td>
        <td class="px-10 py-5 text-center text-xs font-black text-blue-600 bg-blue-50/30">${planned}</td>
        <td class="px-10 py-5 text-center text-xs font-bold text-emerald-600">${l.totalIn}</td>
        <td class="px-10 py-5 text-center text-xs font-bold text-red-500">${l.totalOut}</td>
        <td class="px-10 py-5 text-right font-black text-slate-900 text-sm">${balance}</td>
        <td class="px-10 py-5 text-right flex items-center justify-end gap-2">
           <button onclick="openEditPlannedModal('${l.materialId}', '${escapeHtml(l.material.name)}', ${planned})" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 inline-flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all shadow-sm" title="Editar Quantidade Prevista">
              <span class="material-symbols-outlined text-sm">edit_square</span>
           </button>
           <button data-adjust-stock="${l.material.id}" data-warehouse="${escapeHtml(l.warehouse)}" class="h-8 px-3 rounded-lg bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all">
             Ajustar
           </button>
        </td>
      </tr>
    `;
  }).join("");
}

async function openMaterialManagerModal() {
  openModal({
    title: "Gestão do Catálogo de Materiais",
    contentHtml: `
      <div class="space-y-6">
        <div id="materialForm" class="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
           <h4 class="text-[10px] font-black uppercase tracking-widest text-slate-400">Novo Material / Editar</h4>
           <input type="hidden" id="mt_id">
           <div class="grid grid-cols-2 gap-4">
              <input id="mt_code" placeholder="Código (ex: CABO-MT-50)" class="h-10 bg-white rounded-lg px-3 text-xs font-bold border border-slate-200">
              <input id="mt_name" placeholder="Nome do Material" class="h-10 bg-white rounded-lg px-3 text-xs font-bold border border-slate-200">
           </div>
           <div class="grid grid-cols-2 gap-4">
              <select id="mt_cat" class="h-10 bg-white rounded-lg px-3 text-xs font-bold border border-slate-200">
                 <option value="MT">Média Tensão (MT)</option>
                 <option value="BT">Baixa Tensão (BT)</option>
                 <option value="IP">Iluminação Pública (IP)</option>
                 <option value="OUTROS">Outros</option>
              </select>
              <input id="mt_unit" placeholder="Unidade (ex: un, mts, kg)" class="h-10 bg-white rounded-lg px-3 text-xs font-bold border border-slate-200">
           </div>
           <div class="flex gap-2">
              <button id="saveMaterialBtn" class="flex-1 h-10 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:brightness-110">Gravar Material</button>
              <button id="resetMaterialBtn" class="px-4 h-10 bg-white text-slate-400 rounded-lg text-[10px] font-black uppercase border border-slate-200">Limpar</button>
           </div>
        </div>

        <div class="max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
           <table class="w-full text-left">
              <thead class="sticky top-0 bg-white z-10 border-b border-slate-100">
                 <tr>
                    <th class="py-3 text-[9px] font-black text-slate-400 uppercase">Material</th>
                    <th class="py-3 text-[9px] font-black text-slate-400 uppercase">Cat / Un</th>
                    <th class="py-3 text-right text-[9px] font-black text-slate-400 uppercase">Ações</th>
                 </tr>
              </thead>
              <tbody id="materialListTbody">
                 <!-- JS -->
              </tbody>
           </table>
        </div>
      </div>
    `,
    onPrimary: ({ close }) => close(),
    primaryLabel: "Fechar"
  });

  const loadMaterials = async () => {
    const tbody = el("materialListTbody");
    tbody.innerHTML = `<tr><td colspan="3" class="py-10 text-center text-xs text-slate-400">Carregando catÃ¡logo...</td></tr>`;
    try {
      const { items } = await apiRequest("/materials");
      tbody.innerHTML = items.map(m => `
        <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
          <td class="py-3 pr-4">
             <div class="text-xs font-bold text-slate-900">${escapeHtml(m.name)}</div>
             <div class="text-[9px] font-black text-slate-400 uppercase tracking-tighter">${m.code}</div>
          </td>
          <td class="py-3">
             <span class="text-[9px] font-black px-2 py-0.5 rounded bg-slate-100 text-slate-500">${m.category}</span>
             <span class="text-[9px] font-bold text-slate-400 ml-1">${m.unit}</span>
          </td>
          <td class="py-3 text-right">
             <button data-edit-mat='${JSON.stringify(m)}' class="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-all"><span class="material-symbols-outlined text-sm">edit</span></button>
             <button data-delete-mat="${m.id}" class="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-all"><span class="material-symbols-outlined text-sm">delete</span></button>
          </td>
        </tr>
      `).join("");

      // Bind edit
      document.querySelectorAll("[data-edit-mat]").forEach(btn => {
        btn.addEventListener("click", () => {
          const m = JSON.parse(btn.dataset.editMat);
          el("mt_id").value = m.id;
          el("mt_code").value = m.code;
          el("mt_name").value = m.name;
          el("mt_cat").value = m.category;
          el("mt_unit").value = m.unit;
          el("saveMaterialBtn").textContent = "Atualizar Material";
        });
      });

      // Bind delete
      document.querySelectorAll("[data-delete-mat]").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm("Tem certeza? Esta ação removerá o material do catálogo global.")) return;
          try {
            await apiRequest(`/materials/${btn.dataset.deleteMat}`, { method: "DELETE" });
            toast("Material removido", { type: "success" });
            loadMaterials();
          } catch (err) {
            toast(err.message || "Erro ao remover material", { type: "error" });
          }
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" class="py-10 text-center text-xs text-red-400">Erro ao carregar catálogo.</td></tr>`;
    }
  };

  el("resetMaterialBtn").addEventListener("click", () => {
    el("mt_id").value = "";
    el("mt_code").value = "";
    el("mt_name").value = "";
    el("mt_unit").value = "";
    el("saveMaterialBtn").textContent = "Gravar Material";
  });

  el("saveMaterialBtn").addEventListener("click", async () => {
    const btn = el("saveMaterialBtn");
    const mId = el("mt_id").value;
    const body = {
      code: el("mt_code").value,
      name: el("mt_name").value,
      category: el("mt_cat").value,
      unit: el("mt_unit").value
    };

    if (!body.code || !body.name) return toast("Preencha cÃ³digo e nome", { type: "warning" });

    setButtonLoading(btn, true);
    try {
      await apiRequest(mId ? `/materials/${mId}` : "/materials", {
        method: mId ? "PATCH" : "POST",
        body
      });
      toast(mId ? "Material atualizado" : "Material criado", { type: "success" });
      el("resetMaterialBtn").click();
      loadMaterials();
    } catch (err) {
      toast(err.message || "Erro ao salvar material", { type: "error" });
    } finally {
      setButtonLoading(btn, false);
    }
  });

  loadMaterials();
}

async function openStockAdjustmentModal(materialId, warehouse) {
  const materialsRes = await apiRequest("/materials");
  const mat = materialsRes.items.find(i => i.id === materialId);
  if (!mat) return;

  openModal({
    title: "Ajuste de Saldo de Stock",
    contentHtml: `
       <div class="space-y-6">
          <div class="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
             <h4 class="text-[10px] font-black uppercase text-blue-600 mb-1">Material a Ajustar</h4>
             <p class="text-xs font-bold text-slate-800">${escapeHtml(mat.name)}</p>
             <p class="text-[9px] font-black uppercase text-slate-500 mt-1">ArmazÃ©m: <span class="text-slate-900">${warehouse}</span></p>
          </div>

          <div class="grid grid-cols-2 gap-4">
             <div class="space-y-1.5">
                <label class="text-[10px] font-black uppercase tracking-widest text-emerald-600 pl-1">Dif. Quant. BOA</label>
                <input type="number" id="adjGood" placeholder="+/- 0.00" class="w-full h-12 bg-white border border-slate-200 rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500">
             </div>
             <div class="space-y-1.5">
                <label class="text-[10px] font-black uppercase tracking-widest text-red-600 pl-1">Dif. Quant. DANIFICADA</label>
                <input type="number" id="adjBad" placeholder="+/- 0.00" class="w-full h-12 bg-white border border-slate-200 rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-red-500">
             </div>
          </div>

          <div class="p-4 bg-amber-50 border border-amber-100 rounded-xl flex gap-3">
             <span class="material-symbols-outlined text-amber-500 text-sm">warning</span>
             <p class="text-[10px] text-amber-800 font-medium leading-relaxed">
                Este ajuste criará um movimento do tipo <span class="font-bold">AJUSTE</span> aprovado automaticamente. Use para corrigir erros de inventÃ¡rio fÃ­sico.
             </p>
          </div>
       </div>
    `,
    primaryLabel: "Aplicar Ajuste",
    onPrimary: async ({ btn, close, panel }) => {
      const g = Number(panel.querySelector("#adjGood").value || 0);
      const b = Number(panel.querySelector("#adjBad").value || 0);

      if (g === 0 && b === 0) return toast("Informe uma diferenÃ§a", { type: "warning" });

      setButtonLoading(btn, true);
      try {
        await apiRequest(`/stock/${encodeURIComponent(getProjectId())}/movements`, {
          method: "POST",
          body: {
            materialId,
            type: "AJUSTE",
            quantityGood: g,
            quantityDamaged: b,
            batch: warehouse,
            notes: "Ajuste manual administrativo."
          }
        });
        toast("Ajuste concluí­do", { type: "success" });
        close();
        loadStock();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro no ajuste", { type: "error" });
      }
    }
  });
}

async function deleteStockMovement(moveId) {
  if (!confirm("Tem certeza que deseja ELIMINAR este movimento? O saldo no armazém será revertido automaticamente.")) return;

  try {
    const pid = getProjectId();
    await apiRequest(`/stock/${encodeURIComponent(pid)}/movements/${encodeURIComponent(moveId)}`, {
      method: "DELETE"
    });
    toast("Movimento eliminado e saldo revertido", { type: "success" });
    loadStock();
  } catch (err) {
    toast(err.message || "Erro ao eliminar movimento", { type: "error" });
  }
}

function wireStock() {
  el("newStockMovementBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    try {
      await openStockMovementModal();
    } finally {
      setButtonLoading(btn, false);
    }
  });

  el("manageMaterialsBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    try {
      await openMaterialManagerModal();
    } finally {
      setButtonLoading(btn, false);
    }
  });

  const filters = ["Search", "Category", "Condition", "Status", "Warehouse"];
  filters.forEach(f => {
    const input = el(`stockFilter${f}`);
    if (input) {
      input.addEventListener(f === "Search" ? "input" : "change", (e) => {
        stockState.filters[f.toLowerCase()] = e.target.value.trim();
        applyStockFilters();
      });
    }
  });

  // Delegated events for dynamic buttons
  document.addEventListener("click", (e) => {
    const btnDel = e.target.closest("[data-delete-stock-move]");
    if (btnDel) {
      e.stopPropagation();
      deleteStockMovement(btnDel.dataset.deleteStockMove);
      return;
    }

    const btnAdj = e.target.closest("[data-adjust-stock]");
    if (btnAdj) {
      e.stopPropagation();
      openStockAdjustmentModal(btnAdj.dataset.adjustStock, btnAdj.dataset.warehouse);
      return;
    }

    const rowView = e.target.closest("[data-view-stock]");
    if (rowView && !e.target.closest("button")) {
      const mid = rowView.dataset.viewStock;
      openStockMovementDetailModal(mid);
    }
  });

  // Sub-tabs de Stock (Fluxo, InventÃ¡rio, Galeria)
  document.querySelectorAll("[data-stock-subtab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.stockSubtab;

      // Estilo dos botÃµes
      document.querySelectorAll("[data-stock-subtab]").forEach(b => {
        b.classList.remove("text-slate-900", "border-slate-900");
        b.classList.add("text-slate-400", "border-transparent");
      });
      btn.classList.add("text-slate-900", "border-slate-900");
      btn.classList.remove("text-slate-400", "border-transparent");

      // Visibilidade do conteÃºdo
      ["stock_history_content", "stock_inventory_content", "stock_gallery_content"].forEach(id => {
        el(id)?.classList.add("hidden");
      });
      el(`stock_${tab}_content`)?.classList.remove("hidden");

      if (tab === "gallery") {
        loadStockGallery();
      }
    });
  });

  const updateGalleryDates = () => {
    if (!el(`stock_gallery_content`)?.classList.contains("hidden")) {
      loadStockGallery();
    }
  };

  el("stockGalleryFilterStart")?.addEventListener("change", updateGalleryDates);
  el("stockGalleryFilterEnd")?.addEventListener("change", updateGalleryDates);
}

function getDateCategory(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();

  const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffTime = Math.abs(nowMidnight - dMidnight);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays <= 7) return "Ãšltima semana";

  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
    return "Anteriormente neste mÃªs";
  }
  return "Anteriormente";
}

async function loadStockGallery() {
  const grid = el("stockGalleryContainer");
  if (!grid) return;

  grid.innerHTML = `
    <div class="col-span-full py-20 flex flex-col items-center justify-center animate-pulse">
      <div class="w-12 h-12 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin mb-4"></div>
      <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">Carregando registos...</p>
    </div>
  `;

  try {
    const id = getProjectId();
    const res = await apiRequest(`/projects/${encodeURIComponent(id)}/photos`);
    let photos = res.items || [];

    // Filter locally
    const dStart = el("stockGalleryFilterStart")?.value;
    const dEnd = el("stockGalleryFilterEnd")?.value;

    if (dStart) {
      const gs = new Date(dStart).getTime();
      photos = photos.filter(p => new Date(p.createdAt).getTime() >= gs);
    }
    if (dEnd) {
      const endD = new Date(dEnd);
      endD.setHours(23, 59, 59, 999);
      photos = photos.filter(p => new Date(p.createdAt).getTime() <= endD.getTime());
    }

    if (photos.length === 0) {
      grid.innerHTML = `<div class="p-8 text-center text-sm font-bold text-slate-400">Nenhum registo fotográfico encontrado.</div>`;
      return;
    }

    const groups = {};
    photos.forEach(p => {
      const cat = getDateCategory(p.createdAt); // Need to define getDateCategory inside projectView.js or import it
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });

    const order = ["Hoje", "Ontem", "Ãšltima semana", "Anteriormente neste mÃªs", "Anteriormente"];
    grid.innerHTML = "";
    galleryState.items = photos; // Update global photo cache

    order.forEach(cat => {
      if (!groups[cat] || groups[cat].length === 0) return;

      let html = `
               <div class="gallery-group mb-8">
                  <button class="flex items-center gap-2 mb-4 text-sm font-bold text-slate-800 hover:text-slate-600 transition-colors w-full text-left focus:outline-none" onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('span').innerText = this.nextElementSibling.classList.contains('hidden') ? 'chevron_right' : 'expand_more'">
                     <span class="material-symbols-outlined text-lg">expand_more</span>
                     ${cat}
                  </button>
                  <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            `;

      groups[cat].forEach(p => {
        const url = getAssetUrl(p.path);
        const equipName = p.movement?.material?.name
          ? escapeHtml(p.movement.material.name)
          : "Registo Fotográfico";

        html += `
                <div data-preview-photo="${p.id}" class="group bg-white rounded-[2rem] overflow-hidden border border-slate-100 shadow-sm hover:shadow-xl transition-all cursor-pointer">
                  <div class="aspect-video relative overflow-hidden bg-slate-100">
                      <img src="${url}" alt="Thumbnail" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      <div class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                         <span class="material-symbols-outlined text-white text-3xl">visibility</span>
                      </div>
                  </div>
                  <div class="p-4">
                     <p class="text-xs font-bold text-slate-900 truncate mb-1" title="${escapeHtml(p.description) || equipName}">
                        ${equipName}
                     </p>
                     <div class="flex items-center justify-between mt-2">
                        <span class="text-[9px] font-black uppercase tracking-widest text-slate-400">${formatDateBR(p.createdAt)}</span>
                        ${p.movement ? `<span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[8px] font-black uppercase">Campo</span>` : ""}
                     </div>
                  </div>
                </div>
               `;
      });
      html += `</div></div>`;
      grid.insertAdjacentHTML("beforeend", html);
    });

  } catch (err) {
    grid.innerHTML = `<div class="p-8 text-center text-sm font-bold text-red-500">Erro ao carregar galeria</div>`;
  }
}

// =============================================================================
// GESTÃO DA GALERIA DA OBRA (ADMIN)
// =============================================================================

async function loadGallery() {
  const grid = el("adminGalleryGrid");
  const empty = el("noPhotosMsg");
  if (!grid) return;

  grid.innerHTML = `
    <div class="col-span-full py-20 flex flex-col items-center justify-center animate-pulse">
      <div class="w-12 h-12 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin mb-4"></div>
      <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">A carregar galeria...</p>
    </div>
  `;

  try {
    const id = getProjectId();
    const res = await apiRequest(`/projects/${encodeURIComponent(id)}/photos`);
    const photos = (res.items || []).filter(p => !p.movementId); // Apenas fotos gerais
    galleryState.items = photos; // Guardar em cache para preview

    if (photos.length === 0) {
      grid.innerHTML = "";
      empty?.classList.remove("hidden");
      return;
    }

    empty?.classList.add("hidden");
    grid.innerHTML = photos.map(p => {
      const url = getAssetUrl(p.path);
      return `
        <div class="bg-white rounded-[2rem] overflow-hidden border border-slate-100 shadow-sm hover:shadow-xl transition-all group">
          <div class="aspect-video relative overflow-hidden bg-slate-100">
            <img src="${url}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
            <div class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
               <button data-preview-photo="${p.id}" class="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md text-white flex items-center justify-center hover:bg-white/40 transition-all border border-white/20">
                  <span class="material-symbols-outlined text-2xl">visibility</span>
               </button>
               <button data-role-visible="admin,supervisor,tecnico" data-delete-photo="${p.id}" class="w-12 h-12 rounded-2xl bg-red-500/80 backdrop-blur-md text-white flex items-center justify-center hover:bg-red-600 transition-all border border-white/20">
                  <span class="material-symbols-outlined text-2xl">delete</span>
               </button>
            </div>
          </div>
          <div class="p-5">
            <p class="text-xs font-bold text-slate-900 line-clamp-2 mb-3 h-8" title="${escapeHtml(p.description || '')}">${escapeHtml(p.description || 'Sem Descrição')}</p>
            <div class="flex items-center justify-between pt-3 border-t border-slate-50">
              <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">${formatDateBR(p.createdAt)}</span>
              <span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[8px] font-black uppercase">Geral</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    // Wire delete buttons
    grid.querySelectorAll("[data-delete-photo]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Tem certeza que deseja apagar esta foto da galeria?")) return;
        const photoId = btn.dataset.deletePhoto;
        try {
          await apiRequest(`/projects/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
          toast("Foto apagada!", { type: "success" });
          loadGallery();
        } catch (err) {
          toast("Erro ao apagar foto", { type: "error" });
        }
      });
    });

  } catch (err) {
    grid.innerHTML = `<div class="col-span-full py-20 text-center text-red-500 font-bold">Erro ao carregar fotos</div>`;
  }
}

function wireGallery() {
  el("addPhotoBtn")?.addEventListener("click", () => {
    const id = getProjectId();
    openModal({
      title: "Novo Registo Fotográfico",
      primaryLabel: "Carregar Foto",
      contentHtml: `
        <div class="space-y-6">
          <div id="gal_preview_container" class="hidden aspect-video rounded-[32px] overflow-hidden border-4 border-white shadow-2xl relative group bg-slate-100">
             <img id="gal_preview_img" class="w-full h-full object-cover" src="" />
             <div class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                <button type="button" id="gal_remove_btn" class="w-12 h-12 rounded-2xl bg-white text-red-500 flex items-center justify-center shadow-xl hover:scale-110 active:scale-90 transition-all">
                  <span class="material-symbols-outlined text-2xl">delete</span>
                </button>
             </div>
          </div>

          <div id="gal_dropzone" class="border-2 border-dashed border-slate-200 rounded-[32px] p-12 flex flex-col items-center justify-center bg-slate-50/50 hover:bg-slate-50 hover:border-[#2afc8d] transition-all relative group">
            <input id="gal_input" type="file" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer z-20" />
            <div class="flex flex-col items-center justify-center pointer-events-none">
              <div class="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 group-hover:text-[#2afc8d] transition-all text-slate-400">
                <span class="material-symbols-outlined text-3xl">add_a_photo</span>
              </div>
              <p class="text-sm font-bold text-slate-600">Clique para selecionar foto</p>
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">JPG, PNG atÃ© 10MB</p>
            </div>
          </div>

          <div class="space-y-4">
            <div>
               <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 pl-1">Descrição do Momento</label>
               <textarea id="gal_desc" class="w-full rounded-2xl border-slate-200 bg-slate-50 text-sm font-medium focus:ring-4 focus:ring-[#2afc8d]/10 focus:border-[#2afc8d] transition-all p-4" rows="3" placeholder="Descreva o que está a acontecer na obra..."></textarea>
            </div>
            <div>
               <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 pl-1">Data do Registo</label>
               <input id="gal_date" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full h-12 rounded-xl border-slate-200 bg-slate-50 text-sm font-bold px-4 focus:ring-4 focus:ring-[#2afc8d]/10 focus:border-[#2afc8d] transition-all" />
            </div>
          </div>
        </div>
      `,
      onRender: ({ panel }) => {
        const input = panel.querySelector("#gal_input");
        const previewContainer = panel.querySelector("#gal_preview_container");
        const previewImg = panel.querySelector("#gal_preview_img");
        const dropzone = panel.querySelector("#gal_dropzone");
        const removeBtn = panel.querySelector("#gal_remove_btn");

        input.addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (file) {
            if (!file.type.startsWith("image/")) {
              toast("Por favor, selecione um ficheiro de imagem", { type: "error" });
              input.value = "";
              return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
              previewImg.src = ev.target.result;
              previewContainer.classList.remove("hidden");
              dropzone.classList.add("hidden");
            };
            reader.readAsDataURL(file);
          }
        });

        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          input.value = "";
          previewImg.src = "";
          previewContainer.classList.add("hidden");
          dropzone.classList.remove("hidden");
        });
      },
      onPrimary: async ({ close, panel }) => {
        const fileInput = panel.querySelector("#gal_input");
        const file = fileInput?.files?.[0];

        if (!file) {
          toast("Por favor, selecione uma imagem", { type: "error" });
          return;
        }

        const description = panel.querySelector("#gal_desc")?.value;
        const date = panel.querySelector("#gal_date")?.value;
        const btn = panel.querySelector("[data-primary]");

        try {
          setButtonLoading(btn, true);
          await apiUpload(`/projects/${encodeURIComponent(id)}/photos`, {
            file,
            fieldName: "photo",
            extraFields: { description, date }
          });

          toast("Foto carregada com sucesso!", { type: "success" });
          close();
          loadGallery();
        } catch (err) {
          setButtonLoading(btn, false);
          toast("Erro ao carregar foto", { type: "error" });
        }
      }
    });
  });
}
async function openEditPlannedModal(materialId, materialName, currentPlanned) {
  const projectId = getProjectId();
  openModal({
    title: "Definir Quantidade Prevista",
    contentHtml: `
      <div class="space-y-4">
        <div>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Material</p>
          <p class="text-sm font-bold text-slate-900">${materialName}</p>
        </div>
        <div class="space-y-1.5">
          <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1">Quantidade Prevista Total (BoQ)</label>
          <input type="number" id="edit_planned_qty" value="${currentPlanned}" step="0.01" class="w-full h-12 bg-slate-50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all">
          <p class="text-[9px] text-slate-400 font-medium">Esta quantidade representa o total planeado para este projeto independente do armazÃ©m.</p>
        </div>
      </div>
    `,
    primaryLabel: "Guardar Alteração",
    onPrimary: async ({ close, btn, panel }) => {
      const qtyInput = panel.querySelector("#edit_planned_qty");
      const qty = Number(qtyInput.value);

      if (isNaN(qty)) return toast("Valor inválido", { type: "error" });

      setButtonLoading(btn, true);
      try {
        await apiRequest(`/stock/${encodeURIComponent(projectId)}/planned`, {
          method: "PATCH",
          body: { materialId, quantityPlanned: qty }
        });
        toast("Quantidade prevista atualizada", { type: "success" });
        close();
        loadStock();
      } catch (err) {
        setButtonLoading(btn, false);
        toast("Erro ao atualizar", { type: "error" });
      }
    }
  });
}
window.openEditPlannedModal = openEditPlannedModal;