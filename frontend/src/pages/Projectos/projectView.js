import { apiRequest, apiUpload, getApiBaseUrl, getAssetUrl, resolveProductImageUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import {
  initPermissionLayer,
  activateFirstVisibleProjectTab,
  activateFirstVisibleStockSubtab,
  guardPageAccess,
} from "../../shared/permissions.js";
import { openModal, toast, setButtonLoading, renderLoadingRow, initMobileMenu, escapeHtml, renderProductImageThumb } from "../../shared/ui.js";
import {
  parseStockMovementLogistics,
  buildStockMovementDetailHtml,
  buildStockInventoryOnlyHtml,
  computeStockTotals,
  pickPrimaryEntryMovement,
} from "../../shared/stockDetail.js";
import { formatCurrency, formatDateBR, formatPercent, getExchangeRate } from "../../shared/format.js";
import {
  buildMeasurementSnapshot,
  flattenTasksForParentSelect,
  getChildTasks,
  getRootTasks,
  resolveWbsCode,
} from "../../shared/wbsHelpers.js";
import { exportMeasurementExcel, exportMeasurementPdf } from "../../shared/measurementReportExport.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";
import { getSessionUser, getToken } from "../../services/auth.js";

checkAuth({ allowedRoles: ["admin", "operador", "supervisor", "leitura", "cliente"] });

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
  const role = (user?.role || "leitura").toLowerCase();
  document.querySelectorAll("[data-role-visible]").forEach(el => {
    if (el.dataset.permDenied === "true") return;
    const roles = el.getAttribute("data-role-visible").toLowerCase().split(",");
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
    LABOR: "Mão de Obra",
    OTHER: "Outros",
    MATERIAIS_INSUMOS: "Materiais e Insumos",
    SERVICOS_MAO_DE_OBRA: "Mão de Obra e Serviços",
    GASTOS_PESSOAL: "Gastos com Pessoal",
    DESPESAS_OPERACIONAIS: "Despesas Operacionais",
    INVESTIMENTOS: "Pagamentos",
    DEPRECIACAO: "Depreciação",
    OUTRAS_DESPESAS: "Outras Despesas",
    DEDUCOES: "Dedução de Custos",
    IMPOSTOS: "Impostos",
  };
  return map[c] || c || " ";
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
  mes: "MÊS",
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
  // el("budgetAvailable") is now dynamically updated by loadBudgetExecution with matrix costs

  const pct = total > 0 ? Math.round((consumed / total) * 100) : 0;
  el("budgetDelta").textContent = `Consumido: ${formatPercent(pct, { digits: 0 })}`;
  if (el("budgetBar")) el("budgetBar").style.width = `${Math.max(0, Math.min(100, pct))}%`;

  const progress = Number(p.physicalProgressPct || 0).toFixed(2);
  el("physicalProgress").textContent = `${progress}%`;
  if (el("physicalProgressPie")) {
    el("physicalProgressPie").style.background = `conic-gradient(#2afc8d 0%, #2afc8d ${progress}%, #f1f5f9 ${progress}%, #f1f5f9 100%)`;
  }

  el("projectStartDate").textContent = p.startDate ? formatDateBR(p.startDate) : "---";
  el("projectDueDate").textContent = p.dueDate ? formatDateBR(p.dueDate) : "---";
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
let stockState = {
  items: [],
  summary: [],
  projectWarehouses: [],
  selectedStockWarehouseId: null,
  filters: { search: "", category: "", condition: "", status: "", warehouse: "" },
  isSelectionModeStock: false,
  selectedStockItems: new Set(),
};

function isStockMaterialProduct(product) {
  const cat = (product?.category || "").toUpperCase();
  return cat === "MATERIAL" || cat === "CONSUMABLE" || cat === "BT" || cat === "MT";
}

function getSelectedProjectWarehouse() {
  const warehouses = stockState.projectWarehouses || [];
  if (!warehouses.length) return null;
  if (!stockState.selectedStockWarehouseId) return null;
  return warehouses.find((w) => w.id === stockState.selectedStockWarehouseId) || null;
}

function syncStockWarehouseFilterOptions() {
  const wrap = el("stockWarehouseFilterWrap");
  const select = el("stockFilterWarehouse");
  if (!wrap || !select) return;

  const warehouses = stockState.projectWarehouses || [];
  if (!warehouses.length) {
    wrap.classList.add("hidden");
    return;
  }

  if (warehouses.length === 1) {
    wrap.classList.add("hidden");
    stockState.selectedStockWarehouseId = warehouses[0].id;
    return;
  }

  wrap.classList.remove("hidden");
  const selected = stockState.selectedStockWarehouseId || "";
  select.innerHTML = `<option value="">Todos os armazéns</option>` + warehouses.map((w) => {
    const suffix = w.visibleToClient ? " (cliente)" : " (gestão)";
    return `<option value="${w.id}" ${w.id === selected ? "selected" : ""}>${escapeHtml(w.name + suffix)}</option>`;
  }).join("");
  select.value = selected;
}

function updateStockWarehouseContextLabel() {
  const ctx = el("stockWarehouseContext");
  if (!ctx) return;
  const warehouses = stockState.projectWarehouses || [];
  if (!warehouses.length) {
    ctx.classList.add("hidden");
    ctx.textContent = "";
    return;
  }
  const selected = getSelectedProjectWarehouse();
  ctx.classList.remove("hidden");
  if (!selected) {
    ctx.textContent = `${warehouses.length} armazéns · vista consolidada`;
    return;
  }
  const vis = selected.visibleToClient ? "visível ao cliente" : "apenas gestão";
  ctx.textContent = `Armazém: ${selected.name} · ${vis}`;
}
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
 * @param {Array}  budgetLines - linhas de orçamento
 */

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

  // Dashboard Cards
  if (el("budgetConsumed")) el("budgetConsumed").textContent = formatCurrency(gTotalC, projectState?.currency);
  if (el("budgetConsumedText")) el("budgetConsumedText").textContent = formatCurrency(gTotalC, projectState?.currency);

  const committed = gTotalP - gTotalC;
  if (el("budgetCommitted")) el("budgetCommitted").textContent = formatCurrency(committed, projectState?.currency);
  if (el("budgetAvailable")) el("budgetAvailable").textContent = formatCurrency(committed, projectState?.currency);

  if (el("totalExecutionPct")) {
    const totalPct = gTotalP > 0 ? Math.round((gTotalC / gTotalP) * 100) : 0;
    el("totalExecutionPct").textContent = `${totalPct}% GERAL`;
    if (el("budgetDelta")) el("budgetDelta").textContent = `Execução: ${totalPct}%`;
    if (el("budgetBar")) el("budgetBar").style.width = `${Math.max(0, Math.min(100, totalPct))}%`;
  }

  // Renderiza Curva S com dados reais (todas as transaÃ§Ãµes + linhas de orÃ§amento)

  renderOperationStatus(lines);
}

async function renderOperationStatus(lines) {
  const id = getProjectId();
  const txData = await apiRequest(`/projects/${encodeURIComponent(id)}/transactions?page=1&pageSize=10000`);

  const cats = {
    MATERIALS: { total: 0, consumed: 0, pctId: "stat_materials_pct", subId: "stat_materials_sub" },
    LABOR: { total: 0, consumed: 0, pctId: "stat_labor_pct", subId: "stat_labor_sub" },
    PESSOAL: { total: 0, consumed: 0, pctId: "stat_pessoal_pct", subId: "stat_pessoal_sub" },
    OPERACIONAL: { total: 0, consumed: 0, pctId: "stat_operacional_pct", subId: "stat_operacional_sub" }
  };

  const getGroup = (c) => {
    if (c === "MATERIALS" || c === "MATERIAIS_INSUMOS") return "MATERIALS";
    if (c === "LABOR" || c === "SERVICOS_MAO_DE_OBRA") return "LABOR";
    if (c === "GASTOS_PESSOAL" || c === "PESSOAL") return "PESSOAL";
    if (c === "DESPESAS_OPERACIONAIS" || c === "OPERACIONAL") return "OPERACIONAL";
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
      primaryLabel: "Confirmar Liquidação",
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
              Se o valor pago foi diferente do previsto, altere aqui. A diferença será devolvida ao orçamento disponível.
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
      if (t.dataset.permDenied === "true" || t.classList.contains("hidden")) return;
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
      if (tabId === "medicoes") loadMeasurements();
      if (tabId === "stock") loadStock();
      if (tabId === "galeria_obra") loadGallery();
      if (tabId === "planos_diarios") loadDailyPlans();
    });
  });

  // Sub-tabs de Stock are handled in wireStockEvents
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
          <span class="material-symbols-outlined text-slate-400 group-hover:text-blue-600 transition-colors text-xl" data-icon>chevron_right</span>
          <span class="text-[11px] font-black uppercase tracking-[0.2em] text-[#212e3e]">${safeGroupName}</span>
          ${formattedProgress}
          ${formattedTotal}
        </div>
      </td>
    </tr>
  `;
}

function renderProgressTaskRow(t, index, isSub = false, parentGroup = null, hasChildren = false, childItems = [], depth = 0) {
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

  const indentPx = depth > 0 ? 12 + depth * 14 : 0;
  const indentStyle = depth > 0 ? `bg-slate-50/30` : "px-6";
  const indentAttr = depth > 0 ? `style="padding-left:${indentPx}px"` : "";
  const iconSub = depth > 0 ? `<span class="material-symbols-outlined text-[16px] text-slate-300 mr-2">subdirectory_arrow_right</span>` : "";
  const wbsLabel = resolveWbsCode(t, index);
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
    <tr class="hidden hover:bg-surface-container-low transition-colors group ${parentClass}" data-progress-item-group="${safeGroupName}" ${toggleAttr}>
      <td class="px-6 py-4 text-center font-black text-slate-400 text-[11px] font-mono">${escapeHtml(wbsLabel)}</td>
      <td class="py-4 ${indentStyle}" ${indentAttr}>
        <div class="${descClass} flex flex-col relative">
          <div class="flex items-start">
            ${iconSub}
            ${hasChildren ? `<span class="material-symbols-outlined text-slate-400 mr-2 text-lg mt-0.5" data-sub-icon>chevron_right</span>` : ""}
            <div class="flex flex-col">
              <div class="flex items-center gap-2">
                ${(t.wbsCode || t.itemCode) ? `<span class="text-[9px] font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/50">${escapeHtml(t.wbsCode || t.itemCode)}</span>` : ""}
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
        <button data-edit-task="${t.id}" data-task-desc="${escapeHtml(t.description)}" data-task-wbs="${escapeHtml(t.wbsCode || t.itemCode || '')}" data-task-exe="${exe}" data-task-exp="${exp}" data-task-unit="${escapeHtml(t.unit)}" data-task-us="${uvS}" data-task-um="${uvM}" data-task-unit-value="${unitVal}" data-task-total-value="${t.totalValue || ''}" data-task-currency="${escapeHtml(t.currency || 'AOA')}" title="Atualizar Progresso" class="material-symbols-outlined text-slate-400 hover:text-[#0d3fd1] transition-colors p-1 rounded-md hover:bg-[#0d3fd1]/10">edit</button>
        <button data-delete-task="${t.id}" title="Remover" class="material-symbols-outlined text-slate-400 hover:text-error transition-colors p-1 rounded-md hover:bg-error/10">delete</button>
      </td>
    </tr>
  `;
}

const measurementState = {
  tasks: [],
  history: [],
  activeGroup: "all",
  snapshot: null,
  savedReports: [],
  currentReportId: null,
  nextReportNumber: "01",
  viewingSavedReport: false,
};

function syncMeasurementReportNumberInput() {
  const input = el("measurementReportNumber");
  const hint = el("measurementReportNumberHint");
  if (!input) return;

  if (measurementState.viewingSavedReport && measurementState.currentReportId) {
    const report = measurementState.savedReports.find((r) => r.id === measurementState.currentReportId);
    if (report) {
      input.value = report.reportNumber;
      if (hint) hint.textContent = "Auto guardado";
      return;
    }
  }

  input.value = measurementState.nextReportNumber || "01";
  if (hint) hint.textContent = "Próximo automático";
}

function computeNextReportNumber(reports) {
  const nums = (reports || []).map((r) => {
    const m = String(r.reportNumber || "").match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }).filter((n) => n > 0);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0");
}

function prepareNewMeasurementReport() {
  measurementState.currentReportId = null;
  measurementState.viewingSavedReport = false;
  syncMeasurementReportNumberInput();
  renderMeasurementTable();
}

function measFmtQty(v) {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function measFmtMoney(v, currency = "Kz") {
  const n = Number(v);
  if (!Number.isFinite(n) || (n === 0 && v !== 0)) return "—";
  return `${n.toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function measFmtPct(v) {
  const n = Number(v);
  return `${(Number.isFinite(n) ? n : 0).toFixed(2)}%`;
}

function measRowClassToTr(rowClass) {
  if (rowClass === "grand") return "measurement-row-grand";
  if (rowClass === "section") return "measurement-row-section";
  if (rowClass === "category") return "measurement-row-category";
  return "measurement-row-item";
}

function measRowCells(row) {
  const q = row;
  const curr = q.currency || "Kz";
  const totalVal = q.totalVal || 0;
  const accPct = totalVal > 0 ? (q.accVal / totalVal) * 100 : (q.acc > 0 ? 100 : 0);
  const prevPct = totalVal > 0 ? (q.prevVal / totalVal) * 100 : 0;
  const periodPct = totalVal > 0 ? (q.periodVal / totalVal) * 100 : 0;
  const openVal = q.openVal ?? Math.max(0, totalVal - (q.accVal || 0));
  const openPct = totalVal > 0 ? (openVal / totalVal) * 100 : 0;
  const indentPad = (q.depth || 0) > 0 ? `padding-left:${(q.depth || 0) * 16}px` : "";
  const trClass = measRowClassToTr(q.rowClass || "item");

  return `
    <tr class="${trClass}">
      <td class="px-3 py-3 measurement-wbs">${escapeHtml(q.wbs || "")}</td>
      <td class="px-3 py-3 font-semibold" style="${indentPad}">${escapeHtml(q.description || "")}</td>
      <td class="px-2 py-3 text-center text-[10px] font-bold uppercase text-slate-500">${formatUnit(q.unit || "un")}</td>
      <td class="px-2 py-3 measurement-num">${measFmtQty(q.exp)}</td>
      <td class="px-2 py-3 measurement-num">${q.uv > 0 ? measFmtMoney(q.uv, curr) : "—"}</td>
      <td class="px-2 py-3 measurement-num font-bold">${totalVal > 0 ? measFmtMoney(totalVal, curr) : "—"}</td>
      <td class="px-2 py-3 measurement-num">${measFmtPct(q.pctGlobal ?? 0)}</td>
      <td class="px-2 py-3 measurement-num">${measFmtQty(q.acc)}</td>
      <td class="px-2 py-3 measurement-num font-bold text-emerald-700">${q.accVal > 0 ? measFmtMoney(q.accVal, curr) : "—"}</td>
      <td class="px-2 py-3 measurement-num text-emerald-600">${measFmtPct(accPct)}</td>
      <td class="px-2 py-3 measurement-num">${measFmtQty(q.prev)}</td>
      <td class="px-2 py-3 measurement-num text-blue-700">${q.prevVal > 0 ? measFmtMoney(q.prevVal, curr) : "—"}</td>
      <td class="px-2 py-3 measurement-num text-blue-600">${measFmtPct(prevPct)}</td>
      <td class="px-2 py-3 measurement-num font-bold text-violet-700 bg-violet-50/40">${measFmtQty(q.period)}</td>
      <td class="px-2 py-3 measurement-num font-bold text-violet-800 bg-violet-50/40">${q.periodVal > 0 ? measFmtMoney(q.periodVal, curr) : "—"}</td>
      <td class="px-2 py-3 measurement-num text-violet-600 bg-violet-50/40">${measFmtPct(periodPct)}</td>
      <td class="px-2 py-3 measurement-num">${measFmtQty(q.open)}</td>
      <td class="px-2 py-3 measurement-num text-red-700">${openVal > 0 ? measFmtMoney(openVal, curr) : "—"}</td>
      <td class="px-2 py-3 measurement-num text-red-600">${measFmtPct(openPct)}</td>
    </tr>`;
}

function getMeasurementOptions() {
  return {
    filterGroup: measurementState.activeGroup || "all",
    currentDate: el("measurementCurrentDate")?.value || "",
    prevDate: el("measurementPrevDate")?.value || "",
    reportNumber: el("measurementReportNumber")?.value || "01",
    projectName: projectState?.name || "Obra",
    currency: projectState?.currency === "USD" ? "USD" : "Kz",
  };
}

function renderMeasurementGroupTabs(groups) {
  const container = el("measurementGroupTabs");
  if (!container) return;

  const active = measurementState.activeGroup || "all";
  let html = `<button data-measurement-group="all" class="px-5 py-2.5 text-xs font-bold uppercase border-b-2 whitespace-nowrap transition-all ${active === "all" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}">Controlo</button>`;

  groups.forEach((g) => {
    const safe = escapeHtml(g);
    const isActive = active === g;
    html += `<button data-measurement-group="${safe}" class="px-5 py-2.5 text-xs font-bold uppercase border-b-2 whitespace-nowrap transition-all ${isActive ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}">${safe}</button>`;
  });

  container.innerHTML = html;

  container.querySelectorAll("[data-measurement-group]").forEach((btn) => {
    btn.addEventListener("click", () => {
      measurementState.activeGroup = btn.getAttribute("data-measurement-group");
      renderMeasurementTable();
      renderMeasurementGroupTabs(groups);
    });
  });
}

function renderMeasurementTable() {
  const tbody = el("measurementsTbody");
  const tfoot = el("measurementsTfoot");
  if (!tbody) return;

  const opts = getMeasurementOptions();
  const currency = opts.currency;

  el("measurementPuHeader").textContent = `PU (${currency})`;
  el("measurementTotalHeader").textContent = `TOTAL (${currency})`;

  const subtitle = el("measurementTableSubtitle");
  if (subtitle) {
    const parts = [`Auto Nº ${opts.reportNumber}`];
    if (opts.currentDate) parts.push(`Data: ${formatDateBR(opts.currentDate)}`);
    if (opts.prevDate) parts.push(`Anterior até: ${formatDateBR(opts.prevDate)}`);
    subtitle.textContent = parts.join(" · ");
  }

  const titleEl = el("measurementTableTitle");
  if (titleEl) {
    titleEl.textContent = opts.filterGroup === "all" ? "Controlo de Medições" : `Controlo — ${opts.filterGroup}`;
  }

  if (!measurementState.tasks.length) {
    tbody.innerHTML = `<tr><td colspan="19" class="text-center py-10 text-xs text-slate-400 font-bold uppercase">Sem itens de medição cadastrados</td></tr>`;
    if (tfoot) tfoot.innerHTML = "";
    measurementState.snapshot = null;
    return;
  }

  const snapshot = buildMeasurementSnapshot(measurementState.tasks, measurementState.history, opts);
  measurementState.snapshot = snapshot;

  const grand = snapshot.grand;
  tbody.innerHTML = measRowCells(grand) + snapshot.rows.map(measRowCells).join("");

  if (tfoot) {
    const accPct = grand.totalVal > 0 ? (grand.accVal / grand.totalVal) * 100 : 0;
    const periodPct = grand.totalVal > 0 ? (grand.periodVal / grand.totalVal) * 100 : 0;
    const openVal = grand.openVal || Math.max(0, grand.totalVal - grand.accVal);
    const openPct = grand.totalVal > 0 ? (openVal / grand.totalVal) * 100 : 0;
    tfoot.innerHTML = `
      <tr>
        <td colspan="2" class="px-4 py-4 text-center">TOTAL GERAL</td>
        <td class="px-2 py-4 text-center">vg</td>
        <td class="px-2 py-4 measurement-num">${measFmtQty(grand.exp)}</td>
        <td class="px-2 py-4"></td>
        <td class="px-2 py-4 measurement-num">${measFmtMoney(grand.totalVal, currency)}</td>
        <td class="px-2 py-4 measurement-num">100,00%</td>
        <td class="px-2 py-4 measurement-num">${measFmtQty(grand.acc)}</td>
        <td class="px-2 py-4 measurement-num">${measFmtMoney(grand.accVal, currency)}</td>
        <td class="px-2 py-4 measurement-num">${measFmtPct(accPct)}</td>
        <td class="px-2 py-4 measurement-num">${measFmtQty(grand.prev)}</td>
        <td class="px-2 py-4 measurement-num">${measFmtMoney(grand.prevVal, currency)}</td>
        <td class="px-2 py-4"></td>
        <td class="px-2 py-4 measurement-num text-violet-300">${measFmtQty(grand.period)}</td>
        <td class="px-2 py-4 measurement-num text-violet-300">${measFmtMoney(grand.periodVal, currency)}</td>
        <td class="px-2 py-4 measurement-num text-violet-300">${measFmtPct(periodPct)}</td>
        <td class="px-2 py-4 measurement-num">${measFmtQty(grand.open)}</td>
        <td class="px-2 py-4 measurement-num">${measFmtMoney(openVal, currency)}</td>
        <td class="px-2 py-4 measurement-num">${measFmtPct(openPct)}</td>
      </tr>`;
  }
}

function renderSavedMeasurementReports() {
  const container = el("measurementReportsItems");
  if (!container) return;

  const reports = measurementState.savedReports || [];
  if (!reports.length) {
    container.innerHTML = `<p class="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Nenhum auto guardado</p>`;
    return;
  }

  container.innerHTML = reports.map((r) => {
    const statusCls = r.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700";
    const statusLabel = r.status === "APPROVED" ? "Aprovado" : "Rascunho";
    const val = Number(r.periodValTotal || 0);
    return `
      <div class="flex items-center gap-2 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-all">
        <button type="button" data-load-report="${r.id}"
          class="flex-1 text-left flex flex-wrap items-center justify-between gap-2 min-w-0">
          <div>
            <span class="font-black text-slate-900">Auto Nº ${escapeHtml(r.reportNumber)}</span>
            <span class="ml-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusCls}">${statusLabel}</span>
          </div>
          <div class="text-slate-500 font-semibold">
            ${formatDateBR(r.reportDate)} · Período: ${measFmtMoney(val, projectState?.currency === "USD" ? "USD" : "Kz")}
          </div>
        </button>
        <button type="button" data-delete-report="${r.id}" data-report-number="${escapeHtml(r.reportNumber)}"
          data-report-status="${escapeHtml(r.status || "DRAFT")}" data-role-visible="admin,operador"
          class="shrink-0 w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100 transition-all"
          title="Apagar auto">
          <span class="material-symbols-outlined text-lg">delete</span>
        </button>
      </div>`;
  }).join("");

  applyRoleVisibility();

  container.querySelectorAll("[data-load-report]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reportId = btn.getAttribute("data-load-report");
      await loadMeasurementReportById(reportId);
    });
  });

  container.querySelectorAll("[data-delete-report]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const reportId = btn.getAttribute("data-delete-report");
      const reportNumber = btn.getAttribute("data-report-number");
      const status = btn.getAttribute("data-report-status");
      await deleteMeasurementReport(reportId, reportNumber, status);
    });
  });
}

async function deleteMeasurementReport(reportId, reportNumber, status) {
  const projectId = getProjectId();
  const isApproved = status === "APPROVED";
  const msg = isApproved
    ? `O Auto Nº ${reportNumber} está APROVADO. Tem a certeza que pretende apagá-lo? Esta ação é irreversível.`
    : `Apagar o Auto Nº ${reportNumber}?`;

  if (!confirm(msg)) return;

  try {
    await apiRequest(`/projects/${encodeURIComponent(projectId)}/measurement-reports/${encodeURIComponent(reportId)}`, {
      method: "DELETE",
    });

    measurementState.savedReports = measurementState.savedReports.filter((r) => r.id !== reportId);
    if (measurementState.currentReportId === reportId) {
      measurementState.currentReportId = null;
      measurementState.viewingSavedReport = false;
      prepareNewMeasurementReport();
    }
    measurementState.nextReportNumber = computeNextReportNumber(measurementState.savedReports);
    syncMeasurementReportNumberInput();
    renderSavedMeasurementReports();
    toast(`Auto Nº ${reportNumber} apagado`, { type: "success" });
  } catch (err) {
    toast(err.message || "Erro ao apagar auto", { type: "error" });
  }
}

async function loadMeasurementReportById(reportId) {
  const id = getProjectId();
  try {
    const res = await apiRequest(`/projects/${encodeURIComponent(id)}/measurement-reports/${encodeURIComponent(reportId)}`);
    const report = res.report;
    if (!report) return;

    measurementState.currentReportId = report.id;
    measurementState.viewingSavedReport = true;
    syncMeasurementReportNumberInput();
    if (report.reportDate) el("measurementCurrentDate").value = String(report.reportDate).slice(0, 10);
    if (report.prevDate) el("measurementPrevDate").value = String(report.prevDate).slice(0, 10);

    if (report.snapshotData) {
      measurementState.snapshot = report.snapshotData;
      const tbody = el("measurementsTbody");
      const tfoot = el("measurementsTfoot");
      const snap = report.snapshotData;
      const currency = snap.meta?.currency || "Kz";
      tbody.innerHTML = measRowCells(snap.grand) + (snap.rows || []).map(measRowCells).join("");
      if (tfoot && snap.grand) {
        const g = snap.grand;
        const accPct = g.totalVal > 0 ? (g.accVal / g.totalVal) * 100 : 0;
        const periodPct = g.totalVal > 0 ? (g.periodVal / g.totalVal) * 100 : 0;
        const openVal = g.openVal || Math.max(0, g.totalVal - g.accVal);
        const openPct = g.totalVal > 0 ? (openVal / g.totalVal) * 100 : 0;
        tfoot.innerHTML = `
          <tr>
            <td colspan="2" class="px-4 py-4 text-center">TOTAL GERAL (${report.status === "APPROVED" ? "APROVADO" : "RASCUNHO"})</td>
            <td class="px-2 py-4 text-center">vg</td>
            <td class="px-2 py-4 measurement-num">${measFmtQty(g.exp)}</td>
            <td class="px-2 py-4"></td>
            <td class="px-2 py-4 measurement-num">${measFmtMoney(g.totalVal, currency)}</td>
            <td class="px-2 py-4 measurement-num">100,00%</td>
            <td class="px-2 py-4 measurement-num">${measFmtQty(g.acc)}</td>
            <td class="px-2 py-4 measurement-num">${measFmtMoney(g.accVal, currency)}</td>
            <td class="px-2 py-4 measurement-num">${measFmtPct(accPct)}</td>
            <td class="px-2 py-4 measurement-num">${measFmtQty(g.prev)}</td>
            <td class="px-2 py-4 measurement-num">${measFmtMoney(g.prevVal, currency)}</td>
            <td class="px-2 py-4"></td>
            <td class="px-2 py-4 measurement-num text-violet-300">${measFmtQty(g.period)}</td>
            <td class="px-2 py-4 measurement-num text-violet-300">${measFmtMoney(g.periodVal, currency)}</td>
            <td class="px-2 py-4 measurement-num text-violet-300">${measFmtPct(periodPct)}</td>
            <td class="px-2 py-4 measurement-num">${measFmtQty(g.open)}</td>
            <td class="px-2 py-4 measurement-num">${measFmtMoney(openVal, currency)}</td>
            <td class="px-2 py-4 measurement-num">${measFmtPct(openPct)}</td>
          </tr>`;
      }
      toast(`Auto Nº ${report.reportNumber} carregado`, { type: "success" });
    } else {
      renderMeasurementTable();
    }
  } catch (err) {
    toast(err.message || "Erro ao carregar auto", { type: "error" });
  }
}

async function loadMeasurements() {
  const id = getProjectId();
  const tbody = el("measurementsTbody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="19" class="text-center py-10 text-xs text-slate-400 font-bold uppercase">Carregando...</td></tr>`;

  const dateInput = el("measurementCurrentDate");
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  try {
    const [tasksRes, historyRes, reportsRes] = await Promise.all([
      apiRequest("/projects/" + encodeURIComponent(id) + "/progress-tasks"),
      apiRequest("/projects/" + encodeURIComponent(id) + "/progress-history"),
      apiRequest("/projects/" + encodeURIComponent(id) + "/measurement-reports").catch(() => ({ reports: [] })),
    ]);

    measurementState.tasks = tasksRes.tasks || [];
    measurementState.history = historyRes.items || [];
    measurementState.savedReports = reportsRes.reports || [];
    measurementState.nextReportNumber = reportsRes.nextReportNumber || "01";
    measurementState.currentReportId = null;
    measurementState.viewingSavedReport = false;
    syncMeasurementReportNumberInput();

    const groups = [...new Set(measurementState.tasks.map((t) => t.itemGroup).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt", { sensitivity: "base" })
    );

    renderMeasurementGroupTabs(groups);
    renderMeasurementTable();
    renderSavedMeasurementReports();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="19" class="text-center py-10 text-xs text-red-500 font-bold uppercase">Erro ao carregar autos de medição</td></tr>`;
    toast("Erro ao carregar autos de medição", { type: "error" });
  }
}

function wireMeasurements() {
  el("refreshMeasurementsBtn")?.addEventListener("click", () => loadMeasurements());
  el("measurementCurrentDate")?.addEventListener("change", () => {
    if (measurementState.viewingSavedReport) prepareNewMeasurementReport();
    else renderMeasurementTable();
  });
  el("measurementPrevDate")?.addEventListener("change", () => {
    if (measurementState.viewingSavedReport) prepareNewMeasurementReport();
    else renderMeasurementTable();
  });
  el("newMeasurementReportBtn")?.addEventListener("click", () => prepareNewMeasurementReport());

  el("showMeasurementReportsBtn")?.addEventListener("click", () => {
    el("measurementReportsList")?.classList.remove("hidden");
    el("showMeasurementReportsBtn")?.classList.add("hidden");
  });
  el("toggleMeasurementReportsBtn")?.addEventListener("click", () => {
    el("measurementReportsList")?.classList.add("hidden");
    el("showMeasurementReportsBtn")?.classList.remove("hidden");
  });

  el("saveMeasurementReportBtn")?.addEventListener("click", async () => {
    const projectId = getProjectId();
    const opts = getMeasurementOptions();
    if (!opts.currentDate) {
      toast("Defina a data do auto", { type: "warning" });
      return;
    }
    try {
      const res = await apiRequest(`/projects/${encodeURIComponent(projectId)}/measurement-reports`, {
        method: "POST",
        body: {
          reportDate: opts.currentDate,
          prevDate: opts.prevDate || null,
          filterGroup: opts.filterGroup,
        },
      });
      const saved = res.report;
      measurementState.currentReportId = saved?.id;
      measurementState.viewingSavedReport = true;
      measurementState.savedReports = [saved, ...measurementState.savedReports.filter((r) => r.id !== saved?.id)];
      measurementState.nextReportNumber = computeNextReportNumber(measurementState.savedReports);
      syncMeasurementReportNumberInput();
      renderSavedMeasurementReports();
      toast(`Auto Nº ${saved?.reportNumber} guardado`, { type: "success" });
    } catch (err) {
      if (err?.data?.nextReportNumber) {
        measurementState.nextReportNumber = err.data.nextReportNumber;
        syncMeasurementReportNumberInput();
      }
      toast(err.data?.message || err.message || "Erro ao guardar auto", { type: "error" });
    }
  });

  el("approveMeasurementReportBtn")?.addEventListener("click", async () => {
    const projectId = getProjectId();
    let reportId = measurementState.currentReportId;

    try {
      if (!reportId) {
        const opts = getMeasurementOptions();
        if (!opts.currentDate) {
          toast("Defina a data do auto antes de aprovar", { type: "warning" });
          return;
        }
        const created = await apiRequest(`/projects/${encodeURIComponent(projectId)}/measurement-reports`, {
          method: "POST",
          body: {
            reportDate: opts.currentDate,
            prevDate: opts.prevDate || null,
            filterGroup: opts.filterGroup,
          },
        });
        const saved = created.report;
        reportId = saved?.id;
        measurementState.viewingSavedReport = true;
        measurementState.savedReports = [saved, ...measurementState.savedReports.filter((r) => r.id !== saved?.id)];
        measurementState.nextReportNumber = computeNextReportNumber(measurementState.savedReports);
        syncMeasurementReportNumberInput();
      }

      const res = await apiRequest(`/projects/${encodeURIComponent(projectId)}/measurement-reports/${encodeURIComponent(reportId)}`, {
        method: "PATCH",
        body: { status: "APPROVED" },
      });
      measurementState.currentReportId = reportId;
      measurementState.viewingSavedReport = true;
      measurementState.savedReports = measurementState.savedReports.map((r) =>
        r.id === reportId ? res.report : r
      );
      if (!measurementState.savedReports.find((r) => r.id === reportId)) {
        measurementState.savedReports.unshift(res.report);
      }
      syncMeasurementReportNumberInput();
      renderSavedMeasurementReports();
      toast(`Auto Nº ${res.report?.reportNumber} aprovado com sucesso`, { type: "success" });
    } catch (err) {
      if (err?.data?.nextReportNumber) {
        measurementState.nextReportNumber = err.data.nextReportNumber;
        syncMeasurementReportNumberInput();
      }
      toast(err.data?.message || err.message || "Erro ao aprovar auto", { type: "error" });
    }
  });

  el("exportMeasurementExcelBtn")?.addEventListener("click", () => {
    if (!measurementState.snapshot) {
      toast("Não há dados para exportar", { type: "warning" });
      return;
    }
    try {
      exportMeasurementExcel(measurementState.snapshot, {
        name: projectState?.name,
        location: projectState?.location,
        currency: projectState?.currency === "USD" ? "USD" : "Kz",
      });
    } catch (err) {
      toast(err.message, { type: "error" });
    }
  });

  el("exportMeasurementPdfBtn")?.addEventListener("click", () => {
    if (!measurementState.snapshot) {
      toast("Não há dados para exportar", { type: "warning" });
      return;
    }
    try {
      exportMeasurementPdf(measurementState.snapshot, {
        name: projectState?.name,
        location: projectState?.location,
        currency: projectState?.currency === "USD" ? "USD" : "Kz",
      });
    } catch (err) {
      toast(err.message, { type: "error" });
    }
  });
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

      let groupIndex = 0;

      function renderProgressSubtree(task, indexPath, depth, itemGroup, hidden) {
        const subs = getChildTasks(data.tasks, task.id);
        let row = renderProgressTaskRow(task, indexPath, depth > 0, itemGroup, subs.length > 0, subs, depth);
        if (depth > 0 && task.parentId) {
          row = row.replace("<tr", `<tr data-sub-of="${task.parentId}"`);
        }
        if (hidden) {
          row = row.replace('<tr class="', '<tr class="hidden ');
        }
        let out = row;
        subs.forEach((child, i) => {
          const childPath = resolveWbsCode(child, `${indexPath}.${i + 1}`);
          out += renderProgressSubtree(child, childPath, depth + 1, itemGroup, true);
        });
        return out;
      }

      parentsAndOrphans.forEach((t) => {
        const currentGroup = t.itemGroup || "";
        if (currentGroup !== lastGroup) {
          html += renderGroupHeader(t.itemGroup, groupInvoicingTotals[currentGroup] || 0, groupCurrencies[currentGroup] || "Kz", groupProgressMap[currentGroup] || 0);
          lastGroup = currentGroup;
          groupIndex = 0;
        }

        groupIndex++;
        const wbs = resolveWbsCode(t, String(groupIndex));
        html += renderProgressSubtree(t, wbs, 0, t.itemGroup, false);
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
      flattenTasksForParentSelect(window.projectProgressTasksCache).forEach(({ task: p, depth }) => {
        const prefix = depth > 0 ? `${"—".repeat(depth)} ` : "";
        const wbs = p.wbsCode || p.itemCode ? `[${p.wbsCode || p.itemCode}] ` : "";
        parentOpts += `<option value="${p.id}">${prefix}${wbs}${escapeHtml(p.description)} (${escapeHtml(p.itemGroup || "Geral")})</option>`;
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
          <div class="grid grid-cols-3 gap-4">
            <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Código WBS</label><input id="rt_wbs" class="w-full rounded-lg border-slate-300 font-mono" placeholder="Ex: 1.1.2" /></div>
            <div class="col-span-2"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Descrição da Tarefa</label><input id="rt_desc" class="w-full rounded-lg border-slate-300" placeholder="Ex: Marcação da obra" /></div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Qtd Prevista</label><input id="rt_exp" type="number" step="any" class="w-full rounded-lg border-slate-300" value="0" oninput="document.getElementById('rt_tv').value = (this.value * document.getElementById('rt_uv').value).toFixed(10);" /></div>
            <div>
              <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Unidade (UN)</label>
              <select id="rt_uni" class="w-full rounded-lg border-slate-300">
                <option value="un">un (unidade)</option>
                <option value="mts">mts (metros)</option>
                <option value="km">km (quilômetros)</option>
                <option value="m">m (metros lineares)</option>
                <option value="m2">m² (metros quadrados)</option>
                <option value="m3">m³ (metros cúbicos)</option>
                <option value="kg">kg (quilogramas)</option>
                <option value="ton">ton (toneladas)</option>
                <option value="par">par</option>
                <option value="litros">litros</option>
                <option value="horas">horas</option>
                <option value="dias">dias</option>
                <option value="mes">mês</option>
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
              wbsCode: v("rt_wbs") || null,
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
      const wbs = editBtn.getAttribute("data-task-wbs") || "";
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
            <div class="grid grid-cols-3 gap-4">
              <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Código WBS</label><input id="up_wbs" class="w-full rounded-lg border-slate-300 font-mono" value="${escapeHtml(wbs)}" placeholder="Ex: 1.1.2" /></div>
              <div class="col-span-2"><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Descrição</label><input id="up_desc" class="w-full rounded-lg border-slate-300" value="${escapeHtml(desc)}" /></div>
            </div>
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
                wbsCode: panel.querySelector("#up_wbs").value.trim() || null,
                description: panel.querySelector("#up_desc").value.trim(),
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
    btn.innerHTML = `Nova Pasta <span class="material-symbols-outlined">create_new_folder</span>`;
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
  return m ? (map[m.toLowerCase()] || m) : "-";
}

function renderPaymentRow(p, roleRaw) {
  // Extract role name if it's an object, otherwise use string
  const role = (typeof roleRaw === 'object' ? (roleRaw.name || roleRaw.slug || "") : (roleRaw || "")).toLowerCase();

  const isConf = p.status === "CONFIRMADO";
  const statusCls = isConf ? "text-emerald-700 bg-emerald-50 border border-emerald-100" : "text-amber-600 bg-amber-50 border border-amber-100";
  const statusDot = isConf ? "bg-emerald-500" : "bg-amber-400";
  const statusText = isConf ? "Confirmado" : "Pendente";

  // Authorized roles: admin, administrador, operador, supervisor
  const isAuthorized = ["admin", "administrador", "operador", "supervisor"].includes(role);

  const canConfirm = !isConf && isAuthorized;
  const canDelete = isAuthorized;

  return `
    <tr class="hover:bg-slate-50/70 transition-colors">
      <td class="px-10 py-4 text-xs font-semibold text-slate-500 whitespace-nowrap">${p.dataPagamento ? formatDateBR(p.dataPagamento) : "-"}</td>
      <td class="px-10 py-4 font-bold text-slate-700 whitespace-nowrap">${p.metodo ? escapeHtml(p.metodo).toUpperCase() : "-"}</td>
      <td class="px-10 py-4 text-xs text-slate-500 hidden lg:table-cell">${escapeHtml(p.referencia || "-")}</td>
      <td class="px-10 py-4 text-xs text-slate-400 hidden xl:table-cell">${escapeHtml(p.criadoPor || "-")}</td>
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
          ${!canConfirm && !canDelete && !p.comprovativoPath ? `<span class="text-slate-300 text-xs">-</span>` : ""}
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
              <option value="">Seleccionar</option>
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
  collapsedTables: (function () {
    const saved = localStorage.getItem("InfoCliente.collapsedTables");
    if (saved) return JSON.parse(saved);
    // Default: all tables collapsed
    return {
      matrix: true,
      transactions: true,
      payments: true,
      progress: true,
      stock: true
    };
  })()
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
  await guardPageAccess("obras", "view");
  await initPermissionLayer();
  await loadProject();
  await loadTransactions();
  await loadBudgetExecution();
  await loadPayments();
  wireSearch();
  wireExport();
  wireNewTransaction();
  wireLiquidation();
  wireTabs();
  applyRoleVisibility();
  const user = getSessionUser();
  const role = (user?.role || "").toLowerCase();
  if (role === "cliente" || role === "client") {
    const galeria = el("tabTriggerGaleria");
    if (galeria && galeria.dataset.permDenied !== "true" && !galeria.classList.contains("hidden")) {
      galeria.click();
    } else {
      activateFirstVisibleProjectTab();
    }
  } else {
    activateFirstVisibleProjectTab();
  }
  wireFilesUpload();
  wireNewFolder();
  wireFileNavigation();
  wireFileDeletion();
  wirePreview();
  wireProgressTasks();
  wireMeasurements();
  wirePayments();
  wireStock();
  activateFirstVisibleStockSubtab();
  wireGallery();
  wireTablesToggle();

  // Photo Previews Lightbox
  document.addEventListener("click", e => {
    const productImgBtn = e.target.closest("[data-preview-url]");
    if (productImgBtn) {
      openLightbox(
        productImgBtn.getAttribute("data-preview-url"),
        productImgBtn.getAttribute("data-preview-title") || "Produto",
        ""
      );
      return;
    }

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
  const title = photo.description || (photo.movement?.product?.name ? `Registo: ${photo.movement.product.name}` : "Foto de Obra");
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

init().catch((err) => toast(err.message || "Falha ao carregar projeto. Verifique login/API.", { type: "error" }));
async function loadStock() {
  const id = getProjectId();
  renderLoadingRow(el("stockMovementsTbody"), 7);

  try {
    const { items: warehouses } = await apiRequest("/warehouses");
    const projectWarehouses = warehouses.filter((w) => w.projectId === id && w.type === "SITE");
    stockState.projectWarehouses = projectWarehouses;

    if (!projectWarehouses.length) {
      stockState.selectedStockWarehouseId = null;
      stockState.warehouseId = null;
      stockState.summary = [];
      stockState.items = [];
      el("stockMovementsTbody").innerHTML = `<tr><td colspan="7" class="px-10 py-10 text-center text-slate-400 font-medium">Nenhum armazém associado a esta obra.</td></tr>`;
      el("stockSummary").innerHTML = "";
      syncStockWarehouseFilterOptions();
      updateStockWarehouseContextLabel();
      renderStockInventory([], []);
      return;
    }

    if (
      stockState.selectedStockWarehouseId &&
      !projectWarehouses.some((w) => w.id === stockState.selectedStockWarehouseId)
    ) {
      stockState.selectedStockWarehouseId = null;
    }

    const selectedWarehouse = getSelectedProjectWarehouse();
    stockState.warehouseId = selectedWarehouse?.id || projectWarehouses[0]?.id || null;

    const balanceUrl = selectedWarehouse
      ? `/stock/project/${id}/balance?warehouseId=${encodeURIComponent(selectedWarehouse.id)}`
      : `/stock/project/${id}/balance`;

    const movementsUrl = selectedWarehouse
      ? `/stock/movements?warehouseId=${encodeURIComponent(selectedWarehouse.id)}`
      : `/stock/movements?projectId=${encodeURIComponent(id)}`;

    const [balanceRes, movementsRes] = await Promise.all([
      apiRequest(balanceUrl),
      apiRequest(movementsUrl),
    ]);

    const summaryItems = (balanceRes.items || []).filter((item) => isStockMaterialProduct(item.product));
    const movements = movementsRes.items || [];

    stockState.summary = summaryItems;
    stockState.items = movements;

    syncStockWarehouseFilterOptions();
    updateStockWarehouseContextLabel();
    renderStockSummary(summaryItems, movements);
    applyStockFilters();
  } catch (err) {
    toast("Erro ao carregar dados de stock", { type: "error" });
  }
}

function renderStockSummary(items, movements = []) {
  const visible = (items || []).filter((item) => {
    const balance = Number(item.quantity || 0);
    const planned = Number(item.quantityPlanned || 0);
    const { totalIn } = computeStockTotals(movements, item.productId, item.warehouseId);
    return balance > 0 || planned > 0 || totalIn > 0;
  });

  const uniqueProducts = visible.length;
  const totalStock = visible.reduce((acc, curr) => acc + Number(curr.quantity || 0), 0);
  const btCount = visible.filter((i) => i.product?.category === "BT").length;
  const mtCount = visible.filter((i) => i.product?.category === "MT").length;

  el("stockSummary").innerHTML = `
    <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Tipos de Materiais</p>
        <p class="text-2xl font-bold text-slate-900">${uniqueProducts}</p>
    </div>
    <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <p class="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-2">Total no Estaleiro</p>
        <p class="text-2xl font-bold text-emerald-600">${totalStock.toLocaleString("pt-AO")}</p>
    </div>
    <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <p class="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-2">Material BT</p>
        <p class="text-2xl font-bold text-blue-500">${btCount}</p>
    </div>
    <div class="bg-[#0F172A] p-6 rounded-3xl border border-slate-800 shadow-xl">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Material MT</p>
        <p class="text-2xl font-bold text-[#2afc8d]">${mtCount}</p>
    </div>
  `;
}

function movementMatchesStockTypeFilter(m, filterType) {
  if (!filterType) return true;
  const t = (m.type || "").toUpperCase();
  if (filterType === "ENTRADA") {
    return t === "IN" || t === "ENTRY" || t === "TRANSFER_IN";
  }
  if (filterType === "SAIDA") {
    return t === "OUT" || t === "EXIT" || t === "TRANSFER_OUT";
  }
  if (filterType === "TRANSFERENCIA") {
    return t.includes("TRANSFER");
  }
  return true;
}

function renderStockMovements(items) {
  const tbody = el("stockMovementsTbody");
  if (!tbody) return;

  el("stockMovementsTable")._movementsData = items;
  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-10 py-10 text-center text-slate-400 font-medium">Nenhum movimento registrado nesta obra.</td></tr>`;
    return;
  }

  tbody.innerHTML = (items || []).map((m, idx) => {
    const isEntry = m.type === "IN" || m.type === "ENTRY" || m.type === "TRANSFER_IN";
    const typeLabel = isEntry ? "ENTRADA" : "SAÍDA";
    const typeColor = isEntry ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50";
    const { driverInfo, vehicleInfo } = parseStockMovementLogistics(m);

    return `
      <tr class="border-b border-slate-50 hover:bg-slate-50/80 transition-all cursor-pointer group" data-view-stock="${m.id}">
        <td class="px-6 py-5 text-center text-xs font-bold text-slate-400 w-12">${idx + 1}</td>
        <td class="px-3 md:px-10 py-5 hidden md:table-cell">
          <div class="text-xs font-bold text-slate-900">${formatDateBR(m.createdAt)}</div>
          <div class="text-[10px] font-black uppercase tracking-widest ${typeColor} inline-block px-2 py-0.5 rounded mt-1">${typeLabel}</div>
        </td>
        <td class="px-3 md:px-10 py-5">
          <div class="text-xs font-bold text-slate-900">${escapeHtml(m.product?.name || 'Material')}</div>
          <div class="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">${m.product?.reference || '-'}</div>
        </td>
        <td class="px-3 md:px-10 py-5">
          <div class="text-xs font-black text-slate-900">${m.quantity} ${m.product?.unit || 'un'}</div>
        </td>
        <td class="px-10 py-5 text-[10px] font-medium text-slate-500 hidden md:table-cell">
           <div class="font-bold text-slate-700">${escapeHtml(driverInfo)}</div>
           <div class="uppercase text-[9px] font-black text-slate-400">${escapeHtml(vehicleInfo)}</div>
        </td>
        <td class="px-6 md:px-10 py-5 text-right">
           <button class="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 inline-flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all">
             <span class="material-symbols-outlined text-sm">visibility</span>
           </button>
        </td>
      </tr>
    `;
  }).join("");
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

function openStockMovementDetailModal(moveId) {
  const movements = el("stockMovementsTable")._movementsData || stockState.items || [];
  const m = movements.find((x) => x.id === moveId);
  if (!m) return;

  const { pMovements, totalIn, totalOut } = computeStockTotals(movements, m.productId, m.warehouseId);
  const { entries } = pickPrimaryEntryMovement(pMovements);
  const balance = Number(
    stockState.summary?.find(
      (s) => s.productId === m.productId && String(s.warehouseId || "") === String(m.warehouseId || "")
    )?.quantity ?? totalIn - totalOut
  );

  openModal({
    title: "Nova Operação Logística — Detalhes da Entrada",
    contentHtml: buildStockMovementDetailHtml(m, {
      stockSummary: {
        planned: Number(
          stockState.summary?.find(
            (s) => s.productId === m.productId && String(s.warehouseId || "") === String(m.warehouseId || "")
          )?.quantityPlanned || 0
        ),
        totalIn,
        totalOut,
        balance,
        warehouseName: m.warehouse?.name,
      },
      entryHistory: entries,
    }),
    primaryLabel: "Fechar",
    onPrimary: async ({ close }) => close(),
  });
}

function openStockInventoryDetailModal(productId, warehouseId = null) {
  const root = el("stock_inventory_content");
  const summary = root?._summary || stockState.summary || [];
  const movements = root?._movements || stockState.items || [];
  const item = summary.find(
    (s) => s.productId === productId && String(s.warehouseId || "") === String(warehouseId || "")
  );
  if (!item) return;

  const product = item.product || {};
  const planned = Number(item.quantityPlanned || 0);
  const balance = Number(item.quantity || 0);
  const warehouseName = item.warehouse?.name || (warehouseId ? "Geral" : "Obra (planeado)");
  const { pMovements, totalIn, totalOut } = computeStockTotals(movements, productId, warehouseId);
  const { primary, entries } = pickPrimaryEntryMovement(pMovements);

  if (!primary) {
    openModal({
      title: "Material em Armazém",
      contentHtml: buildStockInventoryOnlyHtml(item, { planned, totalIn, totalOut, balance, warehouseName }),
      primaryLabel: "Fechar",
      onPrimary: async ({ close }) => close(),
    });
    return;
  }

  openModal({
    title: "Nova Operação Logística — Detalhes da Entrada",
    contentHtml: buildStockMovementDetailHtml(primary, {
      stockSummary: { planned, totalIn, totalOut, balance, warehouseName },
      entryHistory: entries,
    }),
    primaryLabel: "Fechar",
    onPrimary: async ({ close }) => close(),
  });
}

async function openProjectWarehouseModal(warehouseId = null) {
  const projectId = getProjectId();
  if (!projectId) return toast("Obra não identificada.", { type: "error" });

  let warehouse = null;
  if (warehouseId) {
    warehouse = stockState.projectWarehouses.find((w) => w.id === warehouseId) || null;
    if (!warehouse) {
      const { items } = await apiRequest("/warehouses");
      warehouse = items.find((w) => w.id === warehouseId);
    }
  }

  const visibleChecked = warehouse?.visibleToClient !== false ? "checked" : "";
  const warehouses = stockState.projectWarehouses || [];

  openModal({
    title: warehouse ? "Editar Armazém da Obra" : "Novo Armazém da Obra",
    contentHtml: `
      <form id="formProjectWarehouse" class="space-y-6 pt-4">
        <input type="hidden" name="projectId" value="${escapeHtml(projectId)}">
        <input type="hidden" name="type" value="SITE">
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Nome do Armazém</label>
          <input type="text" name="name" value="${escapeHtml(warehouse?.name || "")}" required placeholder="Ex: Consumo Cozinha"
            class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
        </div>
        <label class="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 cursor-pointer">
          <input type="checkbox" name="visibleToClient" value="true" ${visibleChecked}
            class="mt-1 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-[#2afc8d]" />
          <span>
            <span class="block text-sm font-bold text-slate-800">Visível para o cliente</span>
            <span class="block text-[11px] text-slate-500 mt-1">O cliente só vê armazéns com esta opção activa.</span>
          </span>
        </label>
        ${warehouses.length ? `
          <div class="pt-2 border-t border-slate-100">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Armazéns desta obra</p>
            <ul class="space-y-2 max-h-40 overflow-y-auto">
              ${warehouses.map((w) => `
                <li class="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 text-xs font-bold text-slate-700">
                  <span>${escapeHtml(w.name)}</span>
                  <button type="button" data-edit-project-warehouse="${w.id}" class="text-[9px] font-black uppercase text-emerald-700 hover:underline">Editar</button>
                </li>
              `).join("")}
            </ul>
          </div>
        ` : ""}
      </form>
    `,
    primaryLabel: warehouse ? "Atualizar" : "Criar Armazém",
    onPrimary: async ({ body, close }) => {
      const form = body.querySelector("#formProjectWarehouse");
      const data = Object.fromEntries(new FormData(form).entries());
      data.visibleToClient = form.querySelector('[name="visibleToClient"]')?.checked === true;
      try {
        await apiRequest(warehouseId ? `/warehouses/${warehouseId}` : "/warehouses", {
          method: warehouseId ? "PATCH" : "POST",
          body: data,
        });
        toast(warehouseId ? "Armazém actualizado." : "Armazém criado.", { type: "success" });
        close();
        loadStock();
      } catch (error) {
        toast(error.message || "Erro ao guardar armazém.", { type: "error" });
      }
    },
  });

  document.querySelectorAll("[data-edit-project-warehouse]").forEach((btn) => {
    btn.addEventListener("click", () => openProjectWarehouseModal(btn.dataset.editProjectWarehouse));
  });
}

async function openStockMovementModal() {
  const warehouses = stockState.projectWarehouses || [];
  if (!warehouses.length) {
    return toast("Nenhum armazém configurado para esta obra.", { type: "error" });
  }

  const defaultWarehouseId = getSelectedProjectWarehouse()?.id || warehouses[0].id;

  try {
    const [productsRes, warehousesRes] = await Promise.all([
      apiRequest("/products"),
      apiRequest("/warehouses"),
    ]);

    const products = (productsRes.items || []).filter(
      (p) => p.category === "MATERIAL" || p.category === "CONSUMABLE"
    );
    const warehouseOptions = warehouses.map((w) =>
      `<option value="${w.id}" ${w.id === defaultWarehouseId ? "selected" : ""}>${escapeHtml(w.name)}</option>`
    ).join("");

    const warehouse = (warehousesRes.items || []).find((w) => w.id === defaultWarehouseId);
    const linkedClient = warehouse?.project?.client || projectState?.client;
    let ownerOptions = `<option value="">${escapeHtml(warehouse?.name || "Armazém")}</option>`;
    if (linkedClient?.id && linkedClient?.name) {
      ownerOptions += `<option value="${escapeHtml(linkedClient.id)}">${escapeHtml(linkedClient.name)}</option>`;
    }

    const productOptions = products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.unit || 'un'})</option>`).join("");

    const warehouseField = warehouses.length > 1
      ? `
          <div class="space-y-2 md:col-span-2">
            <label class="text-[11px] font-black uppercase tracking-widest text-slate-400">Armazém de destino</label>
            <select name="warehouseId" id="st_warehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
              ${warehouseOptions}
            </select>
          </div>
        `
      : `<input type="hidden" name="warehouseId" value="${defaultWarehouseId}">`;

    openModal({
      title: "Nova Operação Logística",
      contentHtml: `
        <form id="formStockMove" class="space-y-6 pt-4">
          ${warehouseField}
          <input type="hidden" name="projectId" value="${getProjectId() || ""}">
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
              <label class="text-[11px] font-black uppercase tracking-widest text-slate-400">Material / Referência</label>
              <select name="productId" id="st_mId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                <option value="">Selecionar...</option>
                ${productOptions}
              </select>
            </div>
            <div class="space-y-2">
              <label class="text-[11px] font-black uppercase tracking-widest text-slate-400">Tipo de Operação</label>
              <select name="type" id="st_type" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                <option value="ENTRY">Entrada (Receber Material)</option>
                <option value="EXIT">Saída (Aplicar na Obra)</option>
              </select>
            </div>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
               <label class="text-[11px] font-black uppercase tracking-widest text-emerald-600">Quantidade</label>
               <input type="number" step="0.01" name="quantity" id="st_qty" placeholder="0.00" required class="w-full bg-emerald-50/50 border-none rounded-2xl p-4 text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
            </div>
            <div class="space-y-2">
               <label class="text-[11px] font-black uppercase tracking-widest text-slate-400">Proprietário</label>
               <select name="ownerId" id="st_ownerId" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                  ${ownerOptions}
               </select>
            </div>
          </div>

          <div class="space-y-2">
              <label class="text-[11px] font-black uppercase tracking-widest text-slate-400 pl-1">Foto de Evidência / Guia</label>
              <input type="file" name="photo" accept="image/*" capture="environment" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-xs font-bold text-slate-400">
          </div>
          
          <div class="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 space-y-6">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-slate-400 shadow-sm">
                    <span class="material-symbols-outlined text-lg">local_shipping</span>
                </div>
                <p class="text-[11px] font-black uppercase tracking-widest text-slate-400">Controlo de Transporte (Opcional)</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div class="space-y-2">
                  <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1">Motorista</label>
                  <input id="st_driver" name="driver" placeholder="Nome completo" class="w-full bg-white border border-slate-100 rounded-xl p-3 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
               </div>
               <div class="space-y-2">
                  <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1">Viatura / Matrícula</label>
                  <input id="st_plate" name="plate" placeholder="Ex: LD-00-00-AA" class="w-full bg-white border border-slate-100 rounded-xl p-3 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all uppercase">
               </div>
            </div>
            <div class="space-y-2">
              <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1">Foto da Viatura</label>
              <input type="file" name="vehiclePhoto" accept="image/*" capture="environment" class="w-full bg-white border border-slate-100 rounded-xl p-3 text-xs font-bold text-slate-500 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:font-bold file:text-slate-600">
            </div>
          </div>
        </form>
      `,
      primaryText: "Registrar",
      onPrimary: async ({ btn, close, panel }) => {
        const form = panel.querySelector("#formStockMove");
        const formData = new FormData(form);

        const mId = formData.get("productId");
        const qty = Number(formData.get("quantity") || 0);

        if (!mId) return toast("Selecione um material", { type: "error" });
        if (qty <= 0) return toast("Quantidade deve ser maior que 0", { type: "error" });

        setButtonLoading(btn, true);
        try {
          const driver = formData.get("driver");
          const plate = formData.get("plate");
          if (driver || plate) {
            formData.append("notes", `Motorista: ${driver || 'N/A'} | Matrícula: ${plate || 'N/A'}`);
          }

          await apiUpload("/stock/move", formData, "POST");

          toast("Operação registada com sucesso", { type: "success" });
          close();
          loadStock();
          loadBudgetExecution();
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message || "Erro ao salvar", { type: "error" });
        }
      }
    });

    // Auto-select Armazém do Cliente if entry type is cliente
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
  const typeFilter = el("stockFilterType")?.value?.trim() || stockState.filters.type || "";

  const filteredMovements = stockState.items.filter((m) => {
    const s = search.toLowerCase();
    const { driverInfo, vehicleInfo } = parseStockMovementLogistics(m);
    const matchesSearch = !s ||
      (m.product?.name || "").toLowerCase().includes(s) ||
      (m.product?.sku || m.product?.reference || "").toLowerCase().includes(s) ||
      driverInfo.toLowerCase().includes(s) ||
      vehicleInfo.toLowerCase().includes(s);

    const matchesCond = !condition || m.condition === condition;
    const matchesStatus = !status || m.auditStatus === status;
    const matchesCat = !category || m.product?.category === category;
    const matchesWarehouse = !warehouse || m.warehouse?.name === warehouse;
    const matchesType = movementMatchesStockTypeFilter(m, typeFilter);

    return matchesSearch && matchesCond && matchesStatus && matchesCat && matchesWarehouse && matchesType;
  });

  let filteredSummary = (stockState.summary || []).filter((item) => isStockMaterialProduct(item.product));
  if (search) {
    const s = search.toLowerCase();
    filteredSummary = filteredSummary.filter((item) => {
      const p = item.product || {};
      return (p.name || "").toLowerCase().includes(s) ||
        (p.sku || p.reference || "").toLowerCase().includes(s) ||
        (item.warehouse?.name || "").toLowerCase().includes(s);
    });
  }
  if (warehouse) {
    filteredSummary = filteredSummary.filter((item) => item.warehouse?.name === warehouse);
  }

  renderStockMovements(filteredMovements);
  renderStockInventory(stockState.items, filteredSummary);
}

function renderStockInventory(movements, summary) {
  const tbody = el("stockInventoryTbody");
  const root = el("stock_inventory_content");
  if (!tbody) return;

  if (root) {
    root._summary = summary;
    root._movements = movements;
  }

  const visible = (summary || []).filter((item) => {
    const balance = Number(item.quantity || 0);
    const planned = Number(item.quantityPlanned || 0);
    const { totalIn } = computeStockTotals(movements, item.productId, item.warehouseId);
    return balance > 0 || planned > 0 || totalIn > 0;
  });

  if (!visible.length) {
    const msg = stockState.projectWarehouses?.length
      ? "Sem materiais com saldo ou planeados no armazém seleccionado."
      : "Sem stock disponível no armazém desta obra.";
    tbody.innerHTML = `<tr><td colspan="11" class="px-10 py-10 text-center text-slate-400 font-medium">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map((item, idx) => {
    const balance = Number(item.quantity || 0);
    const product = item.product || {};
    const planned = Number(item.quantityPlanned || 0);
    const warehouseName = item.warehouse?.name || "Obra (planeado)";

    const { totalIn, totalOut } = computeStockTotals(movements, item.productId, item.warehouseId);

    return `
      <tr class="border-b border-slate-50 hover:bg-slate-50/80 transition-all cursor-pointer group" data-view-inventory="${item.productId}::${item.warehouseId || ""}" title="Clique para ver detalhes da entrada">
        <td class="px-6 py-5 text-center text-xs font-bold text-slate-400 w-12">${idx + 1}</td>
        <td class="selection-cell-stock ${stockState.isSelectionModeStock ? "" : "hidden"} px-6 py-5">
          <input type="checkbox" class="stock-item-checkbox rounded border-slate-300" onclick="event.stopPropagation()"
            data-product-id="${item.productId}" 
            ${stockState.selectedStockItems.has(item.productId) ? "checked" : ""}>
        </td>
        <td class="px-4 py-5 text-center">${renderProductImageThumb(product)}</td>
        <td class="px-3 md:px-10 py-5">
           <div class="text-xs font-bold text-slate-900">${escapeHtml(product.name || "Desconhecido")}</div>
           <div class="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">${product.sku || ""} | ${product.category || ""}</div>
        </td>
        <td class="px-6 md:px-10 py-5 text-center">
           <span class="px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest">${escapeHtml(warehouseName)}</span>
           ${item.warehouse?.visibleToClient === false ? `<span class="block mt-1 text-[8px] font-black uppercase text-slate-400">Só gestão</span>` : ""}
        </td>
        <td class="px-10 py-5 text-center text-[10px] font-bold text-slate-500 hidden sm:table-cell">${product.unit || "un"}</td>
        <td class="px-10 py-5 text-center text-xs font-black text-blue-600 bg-blue-50/30 hidden md:table-cell">${planned}</td>
        <td class="px-10 py-5 text-center text-xs font-bold text-emerald-600 hidden md:table-cell">${totalIn}</td>
        <td class="px-10 py-5 text-center text-xs font-bold text-red-500 hidden md:table-cell">${totalOut}</td>
        <td class="px-6 md:px-10 py-5 text-right font-black text-slate-900 text-sm">${balance}</td>
        <td class="px-6 md:px-10 py-5 text-right flex items-center justify-end gap-2">
           <button onclick="event.stopPropagation(); openEditPlannedModal('${item.productId}', '${escapeHtml(product.name)}', ${planned})" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 inline-flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all shadow-sm" title="Editar Quantidade Prevista">
              <span class="material-symbols-outlined text-sm">edit_square</span>
           </button>
           <button onclick="event.stopPropagation()" data-adjust-stock="${item.productId}" data-warehouse="${escapeHtml(warehouseName)}" class="h-8 px-3 rounded-lg bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all">
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
      <div class="space-y-8 pt-4">
        <div id="materialForm" class="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 space-y-6 shadow-inner">
           <div class="flex items-center gap-3 mb-2">
                <div class="w-10 h-10 rounded-2xl bg-[#2afc8d]/10 text-[#2afc8d] flex items-center justify-center shadow-sm">
                    <span class="material-symbols-outlined text-xl">edit_note</span>
                </div>
                <h4 class="text-xs font-black uppercase tracking-widest text-slate-600">Configuração de Referência</h4>
           </div>
           <input type="hidden" id="mt_id">
           <div class="flex items-center gap-4 mb-2">
              <div id="mt_photo_preview" class="w-16 h-16 rounded-2xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-slate-300 text-2xl">inventory_2</span>
              </div>
              <div class="flex-1 space-y-2">
                <label class="text-[11px] font-black uppercase tracking-widest text-slate-400 pl-1">Foto do Material</label>
                <input type="file" id="mt_photo" accept="image/*" class="w-full bg-white border-none rounded-2xl p-3 text-xs font-bold text-slate-500 focus:ring-2 focus:ring-[#2afc8d] shadow-sm">
              </div>
           </div>
           <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="space-y-2">
                  <label class="text-[11px] font-black uppercase tracking-widest text-slate-400 pl-1">Código / SKU</label>
                  <input id="mt_code" placeholder="Ex: CABO-MT-50" class="w-full bg-white border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] shadow-sm transition-all">
              </div>
              <div class="space-y-2">
                  <label class="text-[11px] font-black uppercase tracking-widest text-slate-400 pl-1">Nome do Material</label>
                  <input id="mt_name" placeholder="Descrição completa" class="w-full bg-white border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] shadow-sm transition-all">
              </div>
           </div>
           <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="space-y-2">
                  <label class="text-[11px] font-black uppercase tracking-widest text-slate-400 pl-1">Categoria</label>
                  <select id="mt_cat" class="w-full bg-white border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] shadow-sm transition-all">
                     <option value="MT">Média Tensão (MT)</option>
                     <option value="BT">Baixa Tensão (BT)</option>
                     <option value="IP">Iluminação Pública (IP)</option>
                     <option value="OUTROS">Outros</option>
                  </select>
              </div>
              <div class="space-y-2">
                  <label class="text-[11px] font-black uppercase tracking-widest text-slate-400 pl-1">Unidade</label>
                  <input id="mt_unit" placeholder="Ex: un, mts, kg" class="w-full bg-white border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] shadow-sm transition-all">
              </div>
           </div>
           <div class="flex gap-4 pt-2">
              <button id="saveMaterialBtn" class="flex-1 h-14 bg-slate-900 text-[#2afc8d] rounded-2xl text-[11px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-slate-900/10">Gravar Material</button>
              <button id="resetMaterialBtn" class="px-8 h-14 bg-white text-slate-400 rounded-2xl text-[11px] font-black uppercase border border-slate-200 hover:bg-slate-50 transition-all">Limpar</button>
           </div>
        </div>

        <div class="max-h-[400px] overflow-y-auto custom-scroll pr-4">
           <table class="w-full text-left">
              <thead class="sticky top-0 bg-white z-10 border-b border-slate-100 pb-4">
                 <tr class="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <th class="py-5 px-4 text-center w-14">Img</th>
                    <th class="py-5 px-4">Material / Referência</th>
                    <th class="py-5 px-4">Cat / Unid.</th>
                    <th class="py-5 px-4 text-right">Ações</th>
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
    tbody.innerHTML = `<tr><td colspan="4" class="py-10 text-center text-xs text-slate-400">Carregando catálogo...</td></tr>`;
    try {
      const { items } = await apiRequest("/products");
      tbody.innerHTML = items.map(m => `
        <tr class="border-b border-slate-50 hover:bg-slate-50/80 transition-all group">
          <td class="py-5 px-4 text-center">${renderProductImageThumb(m, { sizeClass: "w-10 h-10" })}</td>
          <td class="py-5 px-4">
             <div class="text-sm font-bold text-slate-900 mb-0.5">${escapeHtml(m.name)}</div>
             <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${m.sku || m.code || ""}</div>
          </td>
          <td class="py-5 px-4">
             <div class="flex items-center gap-2">
                <span class="text-[10px] font-black px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 uppercase tracking-tighter">${m.category}</span>
                <span class="text-[10px] font-bold text-slate-400 uppercase">${m.unit}</span>
             </div>
          </td>
          <td class="py-5 px-4 text-right">
             <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button data-edit-mat='${JSON.stringify(m)}' class="w-9 h-9 rounded-xl text-blue-500 hover:bg-blue-50 transition-all flex items-center justify-center" title="Editar">
                   <span class="material-symbols-outlined text-xl">edit</span>
                </button>
                <button data-delete-mat="${m.id}" class="w-9 h-9 rounded-xl text-red-500 hover:bg-red-50 transition-all flex items-center justify-center" title="Eliminar">
                   <span class="material-symbols-outlined text-xl">delete</span>
                </button>
             </div>
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
          const preview = el("mt_photo_preview");
          const url = resolveProductImageUrl(m);
          if (preview) {
            preview.innerHTML = url
              ? `<img src="${escapeHtml(url)}" class="w-full h-full object-cover" alt="" />`
              : `<span class="material-symbols-outlined text-slate-300 text-2xl">inventory_2</span>`;
          }
          if (el("mt_photo")) el("mt_photo").value = "";
        });
      });

      // Bind delete
      document.querySelectorAll("[data-delete-mat]").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm("Tem certeza? Esta ação removerá o material do catálogo global.")) return;
          try {
            await apiRequest(`/products/${btn.dataset.deleteMat}`, { method: "DELETE" });
            toast("Material removido", { type: "success" });
            loadMaterials();
          } catch (err) {
            toast(err.message || "Erro ao remover material", { type: "error" });
          }
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="py-10 text-center text-xs text-red-400">Erro ao carregar catálogo.</td></tr>`;
    }
  };

  el("resetMaterialBtn").addEventListener("click", () => {
    el("mt_id").value = "";
    el("mt_code").value = "";
    el("mt_name").value = "";
    el("mt_unit").value = "";
    el("saveMaterialBtn").textContent = "Gravar Material";
    const preview = el("mt_photo_preview");
    if (preview) preview.innerHTML = `<span class="material-symbols-outlined text-slate-300 text-2xl">inventory_2</span>`;
    if (el("mt_photo")) el("mt_photo").value = "";
  });

  el("mt_photo")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    const preview = el("mt_photo_preview");
    if (!file || !preview) return;
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" class="w-full h-full object-cover" alt="" />`;
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
      const photoFile = el("mt_photo")?.files?.[0];
      const saved = await apiRequest(mId ? `/products/${mId}` : "/products", {
        method: mId ? "PATCH" : "POST",
        body
      });
      const productId = mId || saved?.id;
      if (photoFile && photoFile.size > 0 && productId) {
        const fd = new FormData();
        fd.append("photo", photoFile);
        await apiUpload(`/products/${productId}/photo`, fd);
      }
      toast(mId ? "Material atualizado" : "Material criado", { type: "success" });
      el("resetMaterialBtn").click();
      loadMaterials();
      if (typeof loadStock === "function") loadStock();
    } catch (err) {
      toast(err.message || "Erro ao salvar material", { type: "error" });
    } finally {
      setButtonLoading(btn, false);
    }
  });

  loadMaterials();
}

async function openStockAdjustmentModal(materialId, warehouse) {
  const materialsRes = await apiRequest("/products");
  const mat = materialsRes.items.find(i => i.id === materialId);
  if (!mat) return;

  openModal({
    title: "Ajuste de Saldo de Stock",
    contentHtml: `
       <div class="space-y-6">
          <div class="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
             <h4 class="text-[10px] font-black uppercase text-blue-600 mb-1">Material a Ajustar</h4>
             <p class="text-xs font-bold text-slate-800">${escapeHtml(mat.name)}</p>
             <p class="text-[9px] font-black uppercase text-slate-500 mt-1">Armazém: <span class="text-slate-900">${warehouse}</span></p>
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


function updateBulkDeleteBtnStock() {
  const btn = el("btnDeleteSelectedStock");
  const countEl = el("selectedStockCount");
  const count = stockState.selectedStockItems.size;

  if (count > 0) {
    btn.classList.remove("hidden");
    btn.classList.add("flex");
    if (countEl) countEl.textContent = count;
  } else {
    btn.classList.add("hidden");
    btn.classList.remove("flex");
  }
}

async function deleteSelectedStockItems() {
  const count = stockState.selectedStockItems.size;
  if (!confirm(`Confirmar eliminação de ${count} referências do catálogo global?`)) return;

  const btn = el("btnDeleteSelectedStock");
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>`;
  btn.disabled = true;

  let success = 0;
  let errors = 0;

  for (const id of stockState.selectedStockItems) {
    try {
      await apiRequest(`/products/${id}`, { method: "DELETE" });
      success++;
    } catch (err) {
      console.error(`Erro ao apagar material ${id}:`, err);
      errors++;
    }
  }

  toast(`Operação concluída. Sucesso: ${success}, Erros: ${errors}`, { type: success > 0 ? "success" : "error" });

  stockState.selectedStockItems.clear();
  stockState.isSelectionModeStock = false;
  loadStock(); // Refresh data

  btn.disabled = false;
  btn.innerHTML = originalHtml;
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

  el("btnDeleteSelectedStock")?.addEventListener("click", deleteSelectedStockItems);

  el("manageMaterialsBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    try {
      await openMaterialManagerModal();
    } finally {
      setButtonLoading(btn, false);
    }
  });

  el("stockFilterWarehouse")?.addEventListener("change", (e) => {
    const value = e.target.value || null;
    stockState.selectedStockWarehouseId = value;
    loadStock();
  });

  el("btnManageProjectWarehouses")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    try {
      await openProjectWarehouseModal();
    } finally {
      setButtonLoading(btn, false);
    }
  });

  const filters = ["Search", "Type"];
  filters.forEach(f => {
    const input = el(`stockFilter${f}`);
    if (input) {
      input.addEventListener(f === "Search" ? "input" : "change", (e) => {
        const key = f === "Type" ? "type" : f.toLowerCase();
        stockState.filters[key] = e.target.value.trim();
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
      return;
    }

    const invRow = e.target.closest("[data-view-inventory]");
    if (invRow && !e.target.closest("button")) {
      const [productId, warehouseId] = String(invRow.dataset.viewInventory || "").split("::");
      openStockInventoryDetailModal(productId, warehouseId || null);
    }
  });

  // Sub-tabs de Stock (Fluxo, InventÃ¡rio, Galeria)
  document.querySelectorAll("[data-stock-subtab]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.permDenied === "true" || btn.classList.contains("hidden")) return;
      const tab = btn.dataset.stockSubtab;

      // Estilo dos botÃµes
      document.querySelectorAll("[data-stock-subtab]").forEach(b => {
        b.classList.remove("text-slate-900", "border-slate-900");
        b.classList.add("text-slate-400", "border-transparent");
      });
      btn.classList.add("text-slate-900", "border-slate-900");
      btn.classList.remove("text-slate-400", "border-transparent");

      // Visibilidade do conteÃºdo
      ["stock_history_content", "stock_inventory_content", "stock_gallery_content", "stock_requests_content"].forEach(id => {
        el(id)?.classList.add("hidden");
      });
      el(`stock_${tab}_content`)?.classList.remove("hidden");

      if (tab === "gallery") {
        loadStockGallery();
      }
      if (tab === "requests") {
        loadStockRequests();
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

  // Initial badge update
  updateStockRequestsBadge();
}

async function updateStockRequestsBadge() {
  try {
    const id = getProjectId();
    const plans = await apiRequest(`/daily-plans/all-pending?projectId=${encodeURIComponent(id)}`);
    const badge = el("stock_requests_badge");
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
  const container = el("stockRequestsContainer");
  if (!container) return;

  container.innerHTML = `<div class="p-10 text-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto"></div></div>`;

  try {
    const id = getProjectId();
    const plans = await apiRequest(`/daily-plans/all-pending?projectId=${encodeURIComponent(id)}`);

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
                        <span class="text-xs font-bold text-slate-400">${formatDateBR(p.date)}</span>
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

                <div class="p-6 bg-slate-50 border-t lg:border-t-0 lg:border-l border-slate-100 flex items-center justify-center">
                    <button onclick="window.providePlanMaterialsGlobal('${p.id}', event)" 
                        style="background-color: #ea580c !important;"
                        class="w-full lg:w-auto h-12 text-white px-8 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-orange-600/20 active:scale-95 hover:brightness-110">
                        <span class="material-symbols-outlined text-lg">check_circle</span>
                        Disponibilizar Stock
                    </button>
                </div>
            </div>
        `).join('');

  } catch (err) {
    container.innerHTML = `<div class="p-8 text-center text-red-600 bg-red-50 rounded-2xl font-bold">Erro: ${err.message}</div>`;
  }
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
  if (diffDays <= 7) return "última semana";

  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
    return "Anteriormente neste mês";
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

    const order = ["Hoje", "Ontem", "última semana", "Anteriormente neste mês", "Anteriormente"];
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
                  <div class="aspect-video relative overflow-hidden bg-slate-100 table-responsive">
                      <img src="${url}" alt="Thumbnail" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      <div class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                         <span class="material-symbols-outlined text-white text-3xl">visibility</span>
                      </div>
                  </div>
                  <div class="p-2">
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
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">JPG, PNG até 10MB</p>
            </div>
          </div>

          <div class="space-y-4">
            <div>
               <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 pl-1">Descrição do Momento</label>
               <div class="relative">
                 <select id="gal_desc_plan" class="w-full rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 focus:ring-4 focus:ring-[#2afc8d]/10 focus:border-[#2afc8d] transition-all px-4 h-14 appearance-none pr-10">
                   <option value="">A carregar planos diários...</option>
                 </select>
                 <span class="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-slate-400 text-xl">expand_more</span>
               </div>
               <textarea id="gal_desc_custom" class="hidden w-full rounded-2xl border-slate-200 bg-slate-50 text-sm font-medium focus:ring-4 focus:ring-[#2afc8d]/10 focus:border-[#2afc8d] transition-all p-4 mt-3" rows="2" placeholder="Descreva manualmente o momento da obra..."></textarea>
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

        // ── Carregar planos diários e popular o select ──
        const descSelect = panel.querySelector("#gal_desc_plan");
        const descCustom = panel.querySelector("#gal_desc_custom");

        const dpStatusLabel = (s) => {
          if (s === "DRAFT") return "Disponível";
          if (s === "PENDING_MATERIAL") return "Ag. Material";
          if (s === "IN_PROGRESS") return "Em Execução";
          if (s === "COMPLETED") return "Concluído";
          return s;
        };

        (async () => {
          try {
            const plans = await apiRequest(`/daily-plans?projectId=${encodeURIComponent(id)}`);
            if (!plans || plans.length === 0) {
              descSelect.innerHTML = `<option value="__outro__">✏️ Outro (texto livre)</option>`;
              descCustom.classList.remove("hidden");
            } else {
              descSelect.innerHTML = `
                <option value="">Selecione um Plano Diário...</option>
                ${plans.map(p => `<option value="${escapeHtml(p.description || '')}">${formatDateBR(p.date)} — ${escapeHtml(p.description || 'Sem descrição')} [${dpStatusLabel(p.status)}]</option>`).join("")}
                <option value="__outro__">✏️ Outro (texto livre)</option>
              `;
            }
          } catch {
            descSelect.innerHTML = `<option value="__outro__">✏️ Outro (texto livre)</option>`;
            descCustom.classList.remove("hidden");
          }
        })();

        descSelect.addEventListener("change", () => {
          if (descSelect.value === "__outro__") {
            descCustom.classList.remove("hidden");
            descCustom.focus();
          } else {
            descCustom.classList.add("hidden");
          }
        });
      },
      onPrimary: async ({ close, panel }) => {
        const fileInput = panel.querySelector("#gal_input");
        const file = fileInput?.files?.[0];

        if (!file) {
          toast("Por favor, selecione uma imagem", { type: "error" });
          return;
        }

        const descSel = panel.querySelector("#gal_desc_plan");
        const description = (!descSel?.value || descSel?.value === "__outro__")
          ? panel.querySelector("#gal_desc_custom")?.value
          : descSel?.value;
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
      <div class="space-y-6 pt-4">
        <div class="p-6 bg-blue-50/50 border border-blue-100 rounded-[2rem] flex items-center gap-4 shadow-sm">
            <div class="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-blue-500 shadow-sm">
                <span class="material-symbols-outlined text-2xl">inventory_2</span>
            </div>
            <div>
              <p class="text-[11px] font-black uppercase tracking-widest text-blue-600/60 mb-0.5">Referência do Material</p>
              <p class="text-sm font-bold text-slate-900">${materialName}</p>
            </div>
        </div>
        <div class="space-y-3">
          <label class="text-[11px] font-black uppercase tracking-widest text-slate-400 pl-1">Quantidade Prevista Total (BoQ)</label>
          <div class="relative">
              <input type="number" id="edit_planned_qty" value="${currentPlanned}" step="0.01" class="w-full bg-slate-50 border-none rounded-2xl p-5 text-lg font-black text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:bg-white transition-all">
              <div class="absolute right-5 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Unidades</div>
          </div>
          <p class="text-[10px] text-slate-400 font-bold leading-relaxed pl-1">
            <span class="text-amber-500">Atenção:</span> Esta quantidade representa o total planeado para este projeto, independente do armazém físico.
          </p>
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

function renderDailyPlansList() {
  const container = el("dailyPlansList");
  if (!container || !window.dailyPlansState) return;

  const searchQuery = (el("dpFilterSearch")?.value || "").toLowerCase().trim();
  const filterStatus = el("dpFilterStatus")?.value || "all";
  const sortBy = el("dpFilterSort")?.value || "date_desc";

  let filtered = [...window.dailyPlansState];

  // 1. Apply search filter (by description or technician name)
  if (searchQuery) {
    filtered = filtered.filter(p => {
      const descMatch = (p.description || "").toLowerCase().includes(searchQuery);

      // Check if any technician matches
      const techMatch = p.tasks.some(t => {
        const name = (t.technician?.name || "").toLowerCase();
        const email = (t.technician?.email || "").toLowerCase();
        return name.includes(searchQuery) || email.includes(searchQuery);
      });

      return descMatch || techMatch;
    });
  }

  // 2. Apply status filter
  if (filterStatus !== "all") {
    filtered = filtered.filter(p => p.status === filterStatus);
  }

  // 3. Apply sort
  filtered.sort((a, b) => {
    if (sortBy === "date_desc") {
      return new Date(b.date) - new Date(a.date);
    } else if (sortBy === "date_asc") {
      return new Date(a.date) - new Date(b.date);
    } else if (sortBy === "created_desc") {
      return new Date(b.createdAt) - new Date(a.createdAt);
    } else if (sortBy === "created_asc") {
      return new Date(a.createdAt) - new Date(b.createdAt);
    }
    return 0;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-10 flex flex-col items-center text-center text-slate-400 font-bold border-2 border-dashed border-slate-100 rounded-3xl w-full">
        <span class="material-symbols-outlined text-4xl mb-2 text-slate-350">event_busy</span>
        Nenhum plano diário corresponde aos filtros aplicados.
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(p => {
    let statusBadge = "";
    if (p.status === "DRAFT") statusBadge = `<span class="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black tracking-widest uppercase">Disponível</span>`;
    if (p.status === "PENDING_MATERIAL") statusBadge = `<span class="px-2 py-1 bg-amber-100 text-amber-600 rounded-lg text-[10px] font-black tracking-widest uppercase animate-pulse">Aguardando Material</span>`;
    if (p.status === "IN_PROGRESS") statusBadge = `<span class="px-2 py-1 bg-blue-100 text-blue-600 rounded-lg text-[10px] font-black tracking-widest uppercase">Em Execução</span>`;
    if (p.status === "PENDING_VALIDATION") statusBadge = `<span class="px-2 py-1 bg-orange-100 text-orange-600 rounded-lg text-[10px] font-black tracking-widest uppercase animate-pulse">Pendente Validação</span>`;
    if (p.status === "COMPLETED") statusBadge = `<span class="px-2 py-1 bg-emerald-100 text-emerald-600 rounded-lg text-[10px] font-black tracking-widest uppercase">Concluído</span>`;

    // Fetch technicians assigned
    const uniqueTechs = [...new Set(p.tasks.map(t => t.technician?.name || t.technician?.email || "Sem Técnico").filter(Boolean))];
    const techDisplay = uniqueTechs.length > 0 ? uniqueTechs.join(', ') : "Sem Técnico";

    return `
      <div class="p-6 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4 group w-full">
        <div>
          <div class="flex items-center gap-3 mb-2">
            <span class="text-xs font-black uppercase tracking-widest text-slate-400">${formatDateBR(p.date)}</span>
            ${statusBadge}
          </div>
          <p class="text-sm font-bold text-slate-900 line-clamp-2">${escapeHtml(p.description || "Sem descrição")}</p>
          <div class="mt-2 text-xs font-semibold text-slate-500 flex flex-wrap gap-4 items-center">
            <span>${p.tasks.length} Tarefa(s)</span>
            <span>${p.materials.length} Material(ais)</span>
            <span class="flex items-center gap-1 text-slate-400 font-medium">
              <span class="material-symbols-outlined text-xs">person</span> ${escapeHtml(techDisplay)}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar shrink-0">
          ${p.status === "PENDING_MATERIAL" ? `
            <button data-role-visible="admin,supervisor,operador" onclick="window.providePlanMaterials('${p.id}')" class="h-10 bg-amber-50 hover:bg-amber-100 text-amber-600 px-4 rounded-xl font-bold flex items-center gap-2 transition-all whitespace-nowrap text-xs">
              <span class="material-symbols-outlined text-sm">inventory_2</span> Disponibilizar Material
            </button>
          ` : ""}
          ${p.status === "PENDING_VALIDATION" ? `
            <button data-role-visible="admin,supervisor,operador" onclick="window.validatePlan('${p.id}')" class="h-10 bg-orange-50 hover:bg-orange-100 text-orange-600 px-4 rounded-xl font-bold flex items-center gap-2 transition-all whitespace-nowrap text-xs">
              <span class="material-symbols-outlined text-sm">fact_check</span> Validar Relatório
            </button>
          ` : ""}
          ${(p.status === "IN_PROGRESS" || p.status === "DRAFT") ? `
            <button data-role-visible="admin,tecnico,supervisor,operador" onclick="window.completePlan('${p.id}')" class="h-10 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-4 rounded-xl font-bold flex items-center gap-2 transition-all whitespace-nowrap text-xs">
              <span class="material-symbols-outlined text-sm">check_circle</span> Concluir Plano
            </button>
          ` : ""}
          ${(p.status === "DRAFT" || p.status === "PENDING_MATERIAL" || p.status === "IN_PROGRESS") ? `
            <button data-role-visible="admin,operador" onclick="window.openEditPlanModal('${p.id}')" class="w-10 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-blue-600 flex items-center justify-center transition-all shrink-0">
              <span class="material-symbols-outlined text-sm">edit</span>
            </button>
          ` : ""}
          <button onclick="window.viewPlanDetails('${p.id}')" class="w-10 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-blue-600 flex items-center justify-center transition-all shrink-0">
            <span class="material-symbols-outlined text-sm">visibility</span>
          </button>
          ${(p.status !== "IN_PROGRESS" && p.status !== "PENDING_VALIDATION" && p.status !== "COMPLETED") ? `
            <button data-role-visible="admin,operador" onclick="window.deletePlan('${p.id}')" class="w-10 h-10 rounded-xl bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 flex items-center justify-center transition-all shrink-0">
              <span class="material-symbols-outlined text-sm">delete</span>
            </button>
          ` : ""}
        </div>
      </div>
    `;
  }).join('');

  applyRoleVisibility();
}

async function loadDailyPlans() {
  const id = getProjectId();
  const container = el("dailyPlansList");
  if (!container) return;

  try {
    container.innerHTML = `<div class="p-10 text-center text-slate-400 font-bold border-2 border-dashed border-slate-100 rounded-3xl w-full">Carregando planos...</div>`;

    const plans = await apiRequest(`/daily-plans?projectId=${encodeURIComponent(id)}`);
    window.dailyPlansState = plans || [];

    // Wire up event listeners if they haven't been wired yet
    if (!window.dailyPlansListenersWired) {
      el("dpFilterSearch")?.addEventListener("input", renderDailyPlansList);
      el("dpFilterStatus")?.addEventListener("change", renderDailyPlansList);
      el("dpFilterSort")?.addEventListener("change", renderDailyPlansList);
      window.dailyPlansListenersWired = true;
    }

    renderDailyPlansList();

  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="p-10 text-center text-red-500 font-bold border-2 border-dashed border-red-100 rounded-3xl w-full">Erro ao carregar planos.</div>`;
  }
}
window.loadDailyPlans = loadDailyPlans;

async function providePlanMaterialsGlobal(planId, event) {
  if (event) event.stopPropagation();
  if (!confirm("Confirmar a saída de materiais do armazém para este plano? Isso deduzirá o stock imediatamente.")) return;

  try {
    await apiRequest(`/daily-plans/${encodeURIComponent(planId)}/provide-materials`, { method: "POST" });
    toast("Materiais disponibilizados com sucesso!", { type: "success" });

    // Refresh both possible views
    if (typeof loadDailyPlans === "function") loadDailyPlans();

    const activeSubtab = document.querySelector("[data-stock-subtab].text-slate-900")?.dataset.stockSubtab;
    if (activeSubtab === "requests") {
      loadStockRequests();
    }
    updateStockRequestsBadge();
  } catch (err) {
    toast(err.message || "Erro ao disponibilizar materiais.", { type: "error" });
  }
}
window.providePlanMaterialsGlobal = providePlanMaterialsGlobal;

async function providePlanMaterials(planId) {
  return providePlanMaterialsGlobal(planId);
}
window.providePlanMaterials = providePlanMaterials;

async function deletePlan(planId) {
  if (!confirm("Tem a certeza que deseja apagar este plano?")) return;
  try {
    await apiRequest(`/daily-plans/${encodeURIComponent(planId)}`, { method: "DELETE" });
    toast("Plano apagado com sucesso!", { type: "success" });
    loadDailyPlans();
  } catch (err) {
    toast(err.message || "Erro ao apagar plano.", { type: "error" });
  }
}
window.deletePlan = deletePlan;

// O complete e create (addDailyPlanBtn) dependem do form detalhado.

async function wireDailyPlans() {
  const addBtn = el("addDailyPlanBtn");
  if (!addBtn) return;

  addBtn.addEventListener("click", async () => {
    const id = getProjectId();

    // Fetch available tasks (from avanço físico) and materials (from stock)
    let progressTasks = [];
    let products = [];
    let technicians = [];
    try {
      const pData = await apiRequest(`/projects/${encodeURIComponent(id)}/progress-tasks`);
      progressTasks = pData.tasks || [];

      const sData = await apiRequest(`/stock/project/${encodeURIComponent(id)}/balance`);
      products = (sData.items || []).filter((item) => isStockMaterialProduct(item.product));

      const tData = await apiRequest("/users/technicians");
      technicians = tData.items || [];
    } catch (err) {
      console.error(err);
      toast("Erro ao carregar dependências para o plano.", { type: "error" });
      return;
    }

    let selectedTasks = [];
    let selectedMaterials = [];

    const updateTasksUI = (panel) => {
      const container = panel.querySelector("#selectedTasksContainer");
      if (selectedTasks.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-400 italic">Nenhuma tarefa selecionada</p>`;
        return;
      }
      container.innerHTML = selectedTasks.map((t, idx) => {
        const parts = t.name.split(' — ');
        const mainName = parts.pop();
        const parentName = parts.length > 0 ? parts.join(' — ') : t.groupName || "Geral";
        return `
        <div class="flex items-center justify-between p-3 mb-2 rounded-lg border border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}">
          <div class="flex items-center gap-4">
             <div class="font-black text-slate-400 text-[11px] w-4 text-center">${idx + 1}</div>
             <div class="flex flex-col">
               <span class="font-bold text-slate-900">${escapeHtml(mainName)}</span>
               <span class="text-[10px] text-slate-400 uppercase tracking-widest mt-1 font-black">${escapeHtml(parentName)}</span>
             </div>
          </div>
          <div class="flex items-center gap-4 shrink-0">
            <span class="text-slate-500 font-medium text-[10px] uppercase tracking-widest">Qtd: ${t.plannedQty}</span>
            <button type="button" class="text-red-500 hover:text-red-700 p-1" onclick="window.removeSelectedTask(${idx})">
              <span class="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        </div>
      `}).join('');
    };

    const updateMaterialsUI = (panel) => {
      const container = panel.querySelector("#selectedMaterialsContainer");
      if (selectedMaterials.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-400 italic">Nenhum material selecionado</p>`;
        return;
      }
      container.innerHTML = selectedMaterials.map((m, idx) => `
        <div class="flex items-center justify-between bg-slate-50 p-2 rounded-lg mb-2">
          <div class="text-xs flex flex-col">
            <span class="font-bold text-slate-900">${escapeHtml(m.name)}</span>
            <span class="text-slate-500">Qtd. Req.: ${m.requestedQty}</span>
          </div>
          <button type="button" class="text-red-500 hover:text-red-700" onclick="window.removeSelectedMaterial(${idx})">
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      `).join('');
    };

    openModal({
      title: "Criar Plano Diário",
      primaryLabel: "Gravar Plano",
      contentHtml: `
        <div class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Data do Plano</label>
              <input type="date" id="dp_date" value="${new Date().toISOString().split('T')[0]}" class="w-full h-12 bg-slate-50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all">
            </div>
            <div>
              <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Descrição / Resumo</label>
              <input type="text" id="dp_desc" placeholder="Ex: Betonagem dos pilares" class="w-full h-12 bg-slate-50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all">
            </div>
            <div>
              <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Técnico Responsável</label>
              <select id="dp_plan_tech" class="w-full h-12 bg-slate-50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all">
                <option value="">Selecione o Técnico ...</option>
                ${technicians.map(t => `<option value="${t.id}">${escapeHtml(t.name || t.email)}</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- Tarefas -->
          <div class="border border-slate-100 rounded-xl p-4">
            <h4 class="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2"><span class="material-symbols-outlined text-blue-600">task</span> Tarefas a Executar</h4>
            <div class="flex flex-col gap-2 mb-4">
              <select id="dp_task_select" class="w-full h-10 bg-slate-50 border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500">
                <option value="">Selecione a tarefa do Avanço Físico...</option>
                ${(() => {
          const groups = {};
          progressTasks.forEach(pt => {
            const g = pt.itemGroup || "Geral";
            if (!groups[g]) groups[g] = [];
            groups[g].push(pt);
          });
          return Object.keys(groups).map(g => {
            const groupTitle = escapeHtml(g);
            const options = groups[g].map(pt => {
              const buildPath = (t, visited = new Set()) => {
                if (!t || visited.has(t.id)) return "";
                visited.add(t.id);
                if (!t.parentId) return t.description;
                const parent = progressTasks.find(p => p.id === t.parentId);
                return parent ? buildPath(parent, visited) + " — " + t.description : t.description;
              };
              const fullDesc = buildPath(pt);
              return `<option value="${pt.id}">${escapeHtml(fullDesc)} (Falta: ${Number(pt.expectedQty) - Number(pt.executedQty)} ${pt.unit})</option>`;
            }).join('');
            return `<optgroup label="${groupTitle}">${options}</optgroup>`;
          }).join('');
        })()}
              </select>
              <div class="flex gap-2">
                <input type="number" id="dp_task_qty" placeholder="Qtd. Planeada" step="0.01" class="flex-1 h-10 bg-slate-50 border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500">
                <button type="button" id="dp_add_task_btn" class="h-10 bg-slate-900 text-white px-4 rounded-lg text-xs font-bold hover:bg-slate-800 transition-all">Adicionar</button>
              </div>
            </div>
            <div id="selectedTasksContainer" class="max-h-40 overflow-y-auto space-y-2"></div>
          </div>

          <!-- Materiais -->
          <div class="border border-slate-100 rounded-xl p-4">
            <h4 class="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2"><span class="material-symbols-outlined text-amber-600">inventory_2</span> Materiais a Requisitar</h4>
            <div class="flex flex-col gap-2 mb-4">
              <select id="dp_mat_select" class="w-full h-10 bg-slate-50 border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500">
                <option value="">Selecione o material do Stock...</option>
                ${products.map(pr => `<option value="${pr.product?.id}">${escapeHtml(pr.product?.name)} (Stock Atual: ${pr.quantity})</option>`).join('')}
              </select>
              <div class="flex gap-2">
                <input type="number" id="dp_mat_qty" placeholder="Qtd. Requisitada" step="0.01" class="flex-1 h-10 bg-slate-50 border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500">
                <button type="button" id="dp_add_mat_btn" class="h-10 bg-slate-900 text-white px-4 rounded-lg text-xs font-bold hover:bg-slate-800 transition-all">Adicionar</button>
              </div>
            </div>
            <div id="selectedMaterialsContainer" class="max-h-40 overflow-y-auto space-y-2"></div>
          </div>
        </div>
      `,
      onRender: ({ panel }) => {
        window.removeSelectedTask = (idx) => {
          selectedTasks.splice(idx, 1);
          updateTasksUI(panel);
        };
        window.removeSelectedMaterial = (idx) => {
          selectedMaterials.splice(idx, 1);
          updateMaterialsUI(panel);
        };

        panel.querySelector("#dp_add_task_btn").addEventListener("click", () => {
          const sel = panel.querySelector("#dp_task_select");
          const qty = panel.querySelector("#dp_task_qty").value;
          if (!sel.value || !qty || Number(qty) <= 0) return toast("Selecione tarefa e quantidade válida.");

          const opt = sel.options[sel.selectedIndex];

          const optgroup = opt.parentElement;
          const groupName = optgroup.tagName === "OPTGROUP" ? optgroup.label : "";
          selectedTasks.push({
            progressTaskId: sel.value,
            name: opt.text.split('(Falta:')[0].trim(),
            groupName: groupName,
            plannedQty: Number(qty)
          });
          updateTasksUI(panel);

          sel.value = "";
          panel.querySelector("#dp_task_qty").value = "";
        });

        panel.querySelector("#dp_add_mat_btn").addEventListener("click", () => {
          const sel = panel.querySelector("#dp_mat_select");
          const qty = panel.querySelector("#dp_mat_qty").value;
          if (!sel.value || !qty || Number(qty) <= 0) return toast("Selecione material e quantidade válida.");

          const opt = sel.options[sel.selectedIndex];
          selectedMaterials.push({ productId: sel.value, name: opt.text.split('(')[0].trim(), requestedQty: Number(qty) });
          updateMaterialsUI(panel);

          sel.value = "";
          panel.querySelector("#dp_mat_qty").value = "";
        });

        updateTasksUI(panel);
        updateMaterialsUI(panel);
      },
      onPrimary: async ({ close, btn, panel }) => {
        const date = panel.querySelector("#dp_date").value;
        const description = panel.querySelector("#dp_desc").value;
        const planTechId = panel.querySelector("#dp_plan_tech").value;

        if (!planTechId) {
          return toast("Por favor, selecione o Técnico Responsável.", { type: "error" });
        }

        if (selectedTasks.length === 0) {
          return toast("Adicione pelo menos uma tarefa ao plano.", { type: "error" });
        }

        // All tasks are assigned to the main selected technician
        const finalTasks = selectedTasks.map(t => ({
          ...t,
          technicianId: planTechId
        }));

        setButtonLoading(btn, true);
        try {
          await apiRequest(`/daily-plans`, {
            method: "POST",
            body: {
              projectId: id,
              date,
              description,
              tasks: finalTasks,
              materials: selectedMaterials
            }
          });
          toast("Plano Diário criado com sucesso!", { type: "success" });
          close();
          loadDailyPlans();
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message || "Erro ao criar plano", { type: "error" });
        }
      }
    });
  });
}
document.addEventListener("DOMContentLoaded", wireDailyPlans);

async function completePlan(planId) {
  const id = getProjectId();
  try {
    const plans = await apiRequest(`/daily-plans?projectId=${encodeURIComponent(id)}`);
    const plan = plans.find(p => p.id === planId);
    if (!plan) return toast("Plano não encontrado.");

    let tasksHtml = plan.tasks.map(t => `
      <div class="bg-slate-50 p-3 rounded-xl mb-2 flex items-center gap-4">
        <div class="flex-1">
          <p class="text-xs font-bold text-slate-900">${escapeHtml(t.progressTask?.description || "Tarefa")}</p>
          <p class="text-[10px] text-slate-500">Planeado: ${t.plannedQty}</p>
        </div>
        <div class="w-32">
          <label class="text-[9px] font-black uppercase text-slate-400">Executado</label>
          <input type="number" step="0.01" data-task-id="${t.id}" value="${t.plannedQty}" class="w-full h-8 bg-white border border-slate-200 rounded px-2 text-xs font-bold focus:ring-2 focus:ring-emerald-500">
        </div>
      </div>
    `).join('');

    let matsHtml = plan.materials.map(m => `
      <div class="bg-slate-50 p-3 rounded-xl mb-2 flex items-center gap-4">
        <div class="flex-1">
          <p class="text-xs font-bold text-slate-900">${escapeHtml(m.product?.name || "Material")}</p>
          <p class="text-[10px] text-slate-500">Disponibilizado: ${m.providedQty}</p>
        </div>
        <div class="w-32">
          <label class="text-[9px] font-black uppercase text-slate-400">Consumido</label>
          <input type="number" step="0.01" data-mat-id="${m.id}" value="${m.providedQty}" max="${m.providedQty}" class="w-full h-8 bg-white border border-slate-200 rounded px-2 text-xs font-bold focus:ring-2 focus:ring-emerald-500">
        </div>
      </div>
    `).join('');

    if (!tasksHtml) tasksHtml = '<p class="text-xs text-slate-400 italic">Sem tarefas.</p>';
    if (!matsHtml) matsHtml = '<p class="text-xs text-slate-400 italic">Sem materiais.</p>';

    openModal({
      title: "Concluir Plano Diário",
      primaryLabel: "Confirmar Conclusão",
      contentHtml: `
        <div class="space-y-6">
          <div class="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
            <p class="text-xs text-emerald-700">Ao concluir este plano, o avanço físico será atualizado com as quantidades executadas. Os materiais não consumidos retornarão ao armazém.</p>
          </div>
          <div>
            <h4 class="text-sm font-bold text-slate-900 mb-3"><span class="material-symbols-outlined text-blue-600 align-middle text-sm">task</span> Validação de Tarefas</h4>
            ${tasksHtml}
          </div>
          <div>
            <h4 class="text-sm font-bold text-slate-900 mb-3"><span class="material-symbols-outlined text-amber-600 align-middle text-sm">inventory_2</span> Validação de Materiais</h4>
            ${matsHtml}
          </div>
        </div>
      `,
      onPrimary: async ({ close, btn, panel }) => {
        const executedTasks = Array.from(panel.querySelectorAll("input[data-task-id]")).map(el => ({
          dailyPlanTaskId: el.getAttribute("data-task-id"),
          executedQty: el.value
        }));

        const consumedMaterials = Array.from(panel.querySelectorAll("input[data-mat-id]")).map(el => ({
          dailyPlanMaterialId: el.getAttribute("data-mat-id"),
          consumedQty: el.value
        }));

        setButtonLoading(btn, true);
        try {
          await apiRequest(`/daily-plans/${encodeURIComponent(planId)}/complete`, {
            method: "POST",
            body: { executedTasks, consumedMaterials }
          });
          toast("Plano concluído com sucesso!", { type: "success" });
          close();
          loadDailyPlans();
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message || "Erro ao concluir plano", { type: "error" });
        }
      }
    });
  } catch (err) {
    console.error(err);
    toast("Erro ao carregar dados do plano.", { type: "error" });
  }
}
window.completePlan = completePlan;

async function validatePlan(planId) {
  const id = getProjectId();
  try {
    const plans = await apiRequest(`/daily-plans?projectId=${encodeURIComponent(id)}`);
    const plan = plans.find(p => p.id === planId);
    if (!plan) return toast("Plano não encontrado.");

    let tasksHtml = plan.tasks.map(t => {
      const unit = escapeHtml(t.progressTask?.unit || "");
      return `
      <div class="bg-slate-50 p-3 rounded-xl mb-2 flex items-center gap-4">
        <div class="flex-1">
          <p class="text-xs font-bold text-slate-900">${escapeHtml(t.progressTask?.description || "Tarefa")}</p>
          <div class="flex items-center gap-3 mt-1 flex-wrap">
            <span class="text-[10px] text-slate-500">Planeado: <span class="font-bold text-slate-700">${t.plannedQty}${unit ? ` <span class="font-black text-slate-600">${unit}</span>` : ""}</span> | Reportado pelo Técnico: <strong class="text-indigo-600">${t.executedQty || 0}${unit ? ` ${unit}` : ""}</strong></span>
            ${t.technician ? `
              <span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold text-[9px] flex items-center gap-0.5 border border-blue-100">
                <span class="material-symbols-outlined text-[10px]">person</span>
                ${escapeHtml(t.technician.name || t.technician.email)}
              </span>
            ` : ""}
          </div>
        </div>
        <div class="w-36 shrink-0">
          <label class="text-[9px] font-black uppercase text-slate-400 block mb-0.5">Validado${unit ? ` (${unit})` : ""}</label>
          <input type="number" step="0.01" data-task-id="${t.id}" value="${t.executedQty ?? t.plannedQty}" class="w-full h-8 bg-white border border-slate-200 rounded px-2 text-xs font-bold focus:ring-2 focus:ring-orange-500">
        </div>
      </div>
    `;
    }).join('');

    const returnAlreadyDone = !!plan.returnConfirmedAt;

    let matsHtml = plan.materials.map(m => {
      const consumed = Number(m.consumedQty || 0);
      const provided = Number(m.providedQty || 0);
      const toReturn = provided - consumed;
      const unit = escapeHtml(m.product?.unit || "un");
      return `
      <div class="bg-slate-50 p-3 rounded-xl mb-2 flex items-center gap-4">
        <div class="flex-1">
          <p class="text-xs font-bold text-slate-900">${escapeHtml(m.product?.name || "Material")}</p>
          <p class="text-[10px] text-slate-500">Disponibilizado: <span class="font-bold text-slate-700">${provided} <span class="font-black text-slate-600">${unit}</span></span> | Consumido Reportado: <strong class="text-indigo-600">${consumed} ${unit}</strong>${toReturn > 0 ? ` | <span class="text-amber-600 font-bold">Devolvido: ${toReturn.toFixed(2)} ${unit}</span>` : ''}</p>
        </div>
        <div class="w-36 shrink-0">
          <label class="text-[9px] font-black uppercase text-slate-400 block mb-0.5">${returnAlreadyDone ? `Consumido (${unit})` : `Validado (${unit})`}</label>
          <input type="number" step="0.01" data-mat-id="${m.id}" value="${m.consumedQty ?? m.providedQty}" max="${m.providedQty}" ${returnAlreadyDone ? 'readonly class="w-full h-8 bg-slate-100 border border-slate-200 rounded px-2 text-xs font-bold text-slate-500 cursor-not-allowed"' : 'class="w-full h-8 bg-white border border-slate-200 rounded px-2 text-xs font-bold focus:ring-2 focus:ring-orange-500"'}>
        </div>
      </div>
    `;
    }).join('');

    if (!tasksHtml) tasksHtml = '<p class="text-xs text-slate-400 italic">Sem tarefas.</p>';
    if (!matsHtml) matsHtml = '<p class="text-xs text-slate-400 italic">Sem materiais.</p>';

    const returnNotice = returnAlreadyDone ? `
      <div class="bg-emerald-50 p-4 rounded-xl border border-emerald-200 flex items-start gap-3">
        <span class="material-symbols-outlined text-emerald-600 text-xl mt-0.5">check_circle</span>
        <div>
          <p class="text-xs font-black text-emerald-800 uppercase tracking-widest mb-0.5">Devolução já Confirmada pela Logística</p>
          <p class="text-xs text-emerald-700">Os materiais sobrantes foram rececionados no armazém por <strong>${escapeHtml(plan.returnedBy || 'Desconhecido')}</strong>. O consumo acima está bloqueado pois já foi validado pela logística.</p>
        </div>
      </div>
    ` : '';

    openModal({
      title: "Validar e Aprovar Diário de Obra",
      primaryLabel: "Confirmar Validação",
      contentHtml: `
        <div class="space-y-6">
          ${returnNotice}
          <div class="bg-orange-50 p-4 rounded-xl border border-orange-100">
            <p class="text-xs text-orange-700">Verifique as quantidades reportadas pelo técnico. Ajuste se necessário. Ao confirmar, o avanço físico será incrementado no projeto.</p>
          </div>
          <div>
            <h4 class="text-sm font-bold text-slate-900 mb-3"><span class="material-symbols-outlined text-blue-600 align-middle text-sm">task</span> Tarefas Executadas</h4>
            ${tasksHtml}
          </div>
          <div>
            <h4 class="text-sm font-bold text-slate-900 mb-3"><span class="material-symbols-outlined text-amber-600 align-middle text-sm">inventory_2</span> Materiais Consumidos</h4>
            ${matsHtml}
          </div>
        </div>
      `,
      onPrimary: async ({ close, btn, panel }) => {
        const validatedTasks = Array.from(panel.querySelectorAll("input[data-task-id]")).map(el => ({
          dailyPlanTaskId: el.getAttribute("data-task-id"),
          executedQty: el.value
        }));

        const validatedMaterials = Array.from(panel.querySelectorAll("input[data-mat-id]")).map(el => ({
          dailyPlanMaterialId: el.getAttribute("data-mat-id"),
          consumedQty: el.value
        }));

        setButtonLoading(btn, true);
        try {
          await apiRequest(`/daily-plans/${encodeURIComponent(planId)}/approve`, {
            method: "POST",
            body: { validatedTasks, validatedMaterials }
          });
          toast("Diário de Obra validado e concluído com sucesso!", { type: "success" });
          close();
          loadDailyPlans();
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message || "Erro ao validar diário", { type: "error" });
        }
      }
    });
  } catch (err) {
    console.error(err);
    toast("Erro ao carregar dados do plano.", { type: "error" });
  }
}
window.validatePlan = validatePlan;

window.viewPlanDetails = async function (planId) {
  try {
    const plan = await apiRequest(`/daily-plans/${encodeURIComponent(planId)}`);

    let statusBadge = "";
    if (plan.status === "DRAFT") statusBadge = `<span class="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black tracking-widest uppercase">Disponível</span>`;
    if (plan.status === "PENDING_MATERIAL") statusBadge = `<span class="px-2 py-1 bg-amber-100 text-amber-600 rounded-lg text-[10px] font-black tracking-widest uppercase">Aguardando Material</span>`;
    if (plan.status === "IN_PROGRESS") statusBadge = `<span class="px-2 py-1 bg-blue-100 text-blue-600 rounded-lg text-[10px] font-black tracking-widest uppercase">Em Execução</span>`;
    if (plan.status === "PENDING_VALIDATION") statusBadge = `<span class="px-2 py-1 bg-orange-100 text-orange-600 rounded-lg text-[10px] font-black tracking-widest uppercase animate-pulse">Pendente Validação</span>`;
    if (plan.status === "PENDING_RETURN") statusBadge = `<span class="px-2 py-1 bg-blue-100 text-blue-600 rounded-lg text-[10px] font-black tracking-widest uppercase animate-pulse">Aguardando Devolução Logística</span>`;
    if (plan.status === "COMPLETED") statusBadge = `<span class="px-2 py-1 bg-emerald-100 text-emerald-600 rounded-lg text-[10px] font-black tracking-widest uppercase">Concluído</span>`;

    const uniqueTechnicians = [];
    const seenTechIds = new Set();
    plan.tasks.forEach(t => {
      if (t.technician && !seenTechIds.has(t.technician.id)) {
        seenTechIds.add(t.technician.id);
        uniqueTechnicians.push(t.technician);
      }
    });

    const contentHtml = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-xs font-black uppercase tracking-widest text-slate-400">${formatDateBR(plan.date)}</span>
            ${statusBadge}
          </div>
        </div>

        <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <h4 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Descrição / Resumo</h4>
            <p class="text-sm font-bold text-slate-900">${escapeHtml(plan.description || "Sem descrição")}</p>
          </div>
          <div>
            <h4 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Técnico(s) Responsável(eis)</h4>
            <div class="flex flex-wrap gap-1.5 mt-1">
              ${uniqueTechnicians.length > 0 ? uniqueTechnicians.map(t => `
                <span class="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-xl font-bold text-[11px] flex items-center gap-1 border border-blue-100">
                  <span class="material-symbols-outlined text-[14px]">person</span>
                  ${escapeHtml(t.name || t.email)}
                </span>
              `).join('') : '<span class="text-xs text-slate-400 italic">Sem técnico atribuído</span>'}
            </div>
          </div>
        </div>

        <!-- Tarefas -->
        <div>
          <h4 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
            <span class="material-symbols-outlined text-sm">task</span> Tarefas Planeadas
          </h4>
          <div class="space-y-2">
            ${plan.tasks.map(t => `
              <div class="p-4 bg-white border border-slate-100 rounded-xl flex items-center justify-between shadow-sm">
                <div>
                  <p class="text-sm font-bold text-slate-900">${escapeHtml(t.progressTask?.description || "Tarefa")}</p>
                  <div class="flex items-center gap-3 mt-1">
                    <span class="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Qtd: ${t.plannedQty}</span>
                    ${t.technician ? `
                      <span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold text-[10px] flex items-center gap-1">
                        <span class="material-symbols-outlined text-[10px]">person</span>
                        ${escapeHtml(t.technician.name || t.technician.email)}
                      </span>
                    ` : '<span class="text-[10px] text-slate-300 font-bold italic">Sem técnico atribuído</span>'}
                  </div>
                </div>
                ${t.executedQty > 0 ? `<span class="text-emerald-500 font-black text-xs">Exec: ${t.executedQty}</span>` : ""}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Materiais -->
        ${plan.materials && plan.materials.length > 0 ? `
          <div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
              <h4 class="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">inventory_2</span> Materiais Requisitados
              </h4>
              ${plan.receivedBy ? `
                <div class="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-lg text-[10px] font-bold text-slate-600">
                  <span class="material-symbols-outlined text-[12px]">person</span> Recebido por: ${escapeHtml(plan.receivedBy)}
                </div>
              ` : ''}
              ${plan.returnedBy ? `
                <div class="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-lg text-[10px] font-bold text-slate-600">
                  <span class="material-symbols-outlined text-[12px]">person</span> Devolvido por: ${escapeHtml(plan.returnedBy)}
                </div>
              ` : ''}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              ${plan.materials.map(m => {
      const returned = Number(m.providedQty) - Number(m.consumedQty);
      return `
                <div class="p-3 bg-white border border-slate-100 rounded-xl flex items-center justify-between shadow-sm">
                  <div class="flex-1">
                    <span class="text-xs font-bold text-slate-800 line-clamp-1">${escapeHtml(m.product?.name || "Material")}</span>
                    <div class="flex gap-2 mt-1">
                       <span class="text-[9px] font-bold text-slate-400">Ped: ${m.requestedQty} ${escapeHtml(m.product?.unit || "")}</span>
                       ${m.providedQty > 0 ? `<span class="text-[9px] font-bold text-blue-500">Entreg: ${m.providedQty} ${escapeHtml(m.product?.unit || "")}</span>` : ""}
                    </div>
                  </div>
                  <div class="flex flex-col items-end shrink-0">
                    ${plan.status === "COMPLETED" ? `
                      <span class="text-[10px] font-black text-emerald-600">Usado: ${m.consumedQty} ${escapeHtml(m.product?.unit || "")}</span>
                      ${returned > 0 ? `<span class="text-[9px] font-bold text-amber-500">Devolv: ${returned.toFixed(2)} ${escapeHtml(m.product?.unit || "")}</span>` : ""}
                    ` : `
                      <span class="text-xs font-black text-amber-600">${m.requestedQty} ${escapeHtml(m.product?.unit || "")}</span>
                    `}
                  </div>
                </div>
                `;
    }).join('')}
            </div>
          </div>
        ` : ""}
      </div>
    `;

    openModal({
      title: "Detalhes do Plano Diário",
      contentHtml,
      primaryLabel: "Fechar",
      onPrimary: ({ close }) => close()
    });

  } catch (err) {
    console.error(err);
    toast("Erro ao carregar detalhes do plano.", { type: "error" });
  }
};

window.openEditPlanModal = async (planId) => {
  const id = getProjectId();
  let plan;
  let progressTasks = [];
  let products = [];
  let technicians = [];

  try {
    plan = await apiRequest(`/daily-plans/${encodeURIComponent(planId)}`);
    const pData = await apiRequest(`/projects/${encodeURIComponent(id)}/progress-tasks`);
    progressTasks = pData.tasks || [];

    const sData = await apiRequest(`/stock/project/${encodeURIComponent(id)}/balance`);
    products = (sData.items || []).filter((item) => isStockMaterialProduct(item.product));

    const tData = await apiRequest("/users/technicians");
    technicians = tData.items || [];
  } catch (err) {
    console.error(err);
    toast("Erro ao carregar dependências para o plano.", { type: "error" });
    return;
  }

  const canEditMaterials = plan.status === "DRAFT" || plan.status === "PENDING_MATERIAL" || plan.status === "IN_PROGRESS";

  let selectedTasks = plan.tasks.map(t => {
    const pt = progressTasks.find(p => p.id === t.progressTaskId);
    const buildPath = (curr, visited = new Set()) => {
      if (!curr || visited.has(curr.id)) return "";
      visited.add(curr.id);
      if (!curr.parentId) return curr.description;
      const parent = progressTasks.find(p => p.id === curr.parentId);
      return parent ? buildPath(parent, visited) + " — " + curr.description : curr.description;
    };
    return {
      progressTaskId: t.progressTaskId,
      name: pt ? buildPath(pt) : "Tarefa",
      groupName: pt?.itemGroup || "",
      plannedQty: Number(t.plannedQty),
      technicianId: t.technicianId
    };
  });

  let selectedMaterials = plan.materials.map(m => {
    const pr = products.find(p => p.product.id === m.productId);
    return {
      productId: m.productId,
      name: pr?.product?.name || m.product?.name || "Material",
      requestedQty: Number(m.requestedQty)
    };
  });

  const updateTasksUI = (panel) => {
    const container = panel.querySelector("#edit_selectedTasksContainer");
    if (selectedTasks.length === 0) {
      container.innerHTML = `<p class="text-xs text-slate-400 italic">Nenhuma tarefa selecionada</p>`;
      return;
    }
    container.innerHTML = selectedTasks.map((t, idx) => {
      const parts = t.name.split(' — ');
      const mainName = parts.pop();
      const parentName = parts.length > 0 ? parts.join(' — ') : t.groupName || "Geral";
      return `
      <div class="flex items-center justify-between p-3 mb-2 rounded-lg border border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}">
        <div class="flex items-center gap-4">
           <div class="font-black text-slate-400 text-[11px] w-4 text-center">${idx + 1}</div>
           <div class="flex flex-col">
             <span class="font-bold text-slate-900">${escapeHtml(mainName)}</span>
             <span class="text-[10px] text-slate-400 uppercase tracking-widest mt-1 font-black">${escapeHtml(parentName)}</span>
           </div>
        </div>
        <div class="flex items-center gap-4 shrink-0">
          <span class="text-slate-500 font-medium text-[10px] uppercase tracking-widest">Qtd: ${t.plannedQty}</span>
          <button type="button" class="text-red-500 hover:text-red-700 p-1" onclick="window.removeEditSelectedTask(${idx})">
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      </div>
    `}).join('');
  };

  const updateMaterialsUI = (panel) => {
    const container = panel.querySelector("#edit_selectedMaterialsContainer");
    if (!canEditMaterials) {
      container.innerHTML = `<p class="text-xs text-amber-600 font-bold p-3 bg-amber-50 rounded-lg border border-amber-100">Os materiais não podem ser editados pois o plano já está em execução.</p>`;
      return;
    }
    if (selectedMaterials.length === 0) {
      container.innerHTML = `<p class="text-xs text-slate-400 italic">Nenhum material selecionado</p>`;
      return;
    }
    container.innerHTML = selectedMaterials.map((m, idx) => `
      <div class="flex items-center justify-between bg-slate-50 p-2 rounded-lg mb-2">
        <div class="text-xs flex flex-col">
          <span class="font-bold text-slate-900">${escapeHtml(m.name)}</span>
          <span class="text-slate-500">Qtd. Req.: ${m.requestedQty}</span>
        </div>
        <button type="button" class="text-red-500 hover:text-red-700" onclick="window.removeEditSelectedMaterial(${idx})">
          <span class="material-symbols-outlined text-sm">close</span>
        </button>
      </div>
    `).join('');
  };

  const contentHtml = `
    <div class="space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Data do Plano</label>
          <input type="date" id="edit_dp_date" value="${new Date(plan.date).toISOString().split('T')[0]}" class="w-full h-12 bg-slate-50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all">
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Descrição / Resumo</label>
          <input type="text" id="edit_dp_desc" value="${escapeHtml(plan.description || '')}" placeholder="Ex: Betonagem dos pilares" class="w-full h-12 bg-slate-50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all">
        </div>
        <div>
          <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Técnico Responsável</label>
          <select id="edit_dp_plan_tech" class="w-full h-12 bg-slate-50 border-none rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all">
            <option value="">Selecione o Técnico ...</option>
            ${technicians.map(t => `<option value="${t.id}" ${plan.tasks.some(pt => pt.technicianId === t.id) ? 'selected' : ''}>${escapeHtml(t.name || t.email)}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Tarefas -->
      <div class="border border-slate-100 rounded-xl p-4">
        <h4 class="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2"><span class="material-symbols-outlined text-blue-600">task</span> Tarefas a Executar</h4>
        <div class="flex flex-col gap-2 mb-4">
          <select id="edit_dp_task_select" class="w-full h-10 bg-slate-50 border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500">
            <option value="">Selecione a tarefa do Avanço Físico...</option>
            ${(() => {
      const groups = {};
      progressTasks.forEach(pt => {
        const g = pt.itemGroup || "Geral";
        if (!groups[g]) groups[g] = [];
        groups[g].push(pt);
      });
      return Object.keys(groups).map(g => {
        const groupTitle = escapeHtml(g);
        const options = groups[g].map(pt => {
          const buildPath = (t, visited = new Set()) => {
            if (!t || visited.has(t.id)) return "";
            visited.add(t.id);
            if (!t.parentId) return t.description;
            const parent = progressTasks.find(p => p.id === t.parentId);
            return parent ? buildPath(parent, visited) + " — " + t.description : t.description;
          };
          const fullDesc = buildPath(pt);
          return `<option value="${pt.id}">${escapeHtml(fullDesc)} (Falta: ${Number(pt.expectedQty) - Number(pt.executedQty)} ${pt.unit})</option>`;
        }).join('');
        return `<optgroup label="${groupTitle}">${options}</optgroup>`;
      }).join('');
    })()}
          </select>
          <div class="flex gap-2">
            <input type="number" id="edit_dp_task_qty" placeholder="Qtd. Planeada" step="0.01" class="flex-1 h-10 bg-slate-50 border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500">
            <button type="button" id="edit_dp_add_task_btn" class="h-10 bg-slate-900 text-white px-4 rounded-lg text-xs font-bold hover:bg-slate-800 transition-all">Adicionar</button>
          </div>
        </div>
        <div id="edit_selectedTasksContainer" class="max-h-40 overflow-y-auto space-y-2"></div>
      </div>

      <!-- Materiais -->
      <div class="border border-slate-100 rounded-xl p-4 ${canEditMaterials ? '' : 'opacity-70'}">
        <h4 class="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2"><span class="material-symbols-outlined text-amber-600">inventory_2</span> Materiais a Requisitar</h4>
        <div class="flex flex-col gap-2 mb-4" style="display: ${canEditMaterials ? 'flex' : 'none'}">
          <select id="edit_dp_mat_select" class="w-full h-10 bg-slate-50 border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500">
            <option value="">Selecione o material do Stock...</option>
            ${products.map(pr => `<option value="${pr.product?.id}">${escapeHtml(pr.product?.name)} (Stock Atual: ${pr.quantity})</option>`).join('')}
          </select>
          <div class="flex gap-2">
            <input type="number" id="edit_dp_mat_qty" placeholder="Qtd. Requisitada" step="0.01" class="flex-1 h-10 bg-slate-50 border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500">
            <button type="button" id="edit_dp_add_mat_btn" class="h-10 bg-slate-900 text-white px-4 rounded-lg text-xs font-bold hover:bg-slate-800 transition-all">Adicionar</button>
          </div>
        </div>
        <div id="edit_selectedMaterialsContainer" class="max-h-40 overflow-y-auto space-y-2"></div>
      </div>
    </div>
  `;

  openModal({
    title: "Editar Plano Diário",
    contentHtml,
    primaryLabel: "Guardar Alterações",
    onRender: ({ panel }) => {
      window.removeEditSelectedTask = (idx) => {
        selectedTasks.splice(idx, 1);
        updateTasksUI(panel);
      };
      window.removeEditSelectedMaterial = (idx) => {
        if (!canEditMaterials) return;
        selectedMaterials.splice(idx, 1);
        updateMaterialsUI(panel);
      };

      panel.querySelector("#edit_dp_add_task_btn").addEventListener("click", () => {
        const sel = panel.querySelector("#edit_dp_task_select");
        const qty = panel.querySelector("#edit_dp_task_qty").value;
        if (!sel.value || !qty || Number(qty) <= 0) return toast("Selecione tarefa e quantidade válida.");

        const opt = sel.options[sel.selectedIndex];
        const optgroup = opt.parentElement;
        const groupName = optgroup.tagName === "OPTGROUP" ? optgroup.label : "";

        selectedTasks.push({
          progressTaskId: sel.value,
          name: opt.text.split('(Falta:')[0].trim(),
          groupName: groupName,
          plannedQty: Number(qty)
        });
        updateTasksUI(panel);

        sel.value = "";
        panel.querySelector("#edit_dp_task_qty").value = "";
      });

      if (canEditMaterials) {
        panel.querySelector("#edit_dp_add_mat_btn").addEventListener("click", () => {
          const sel = panel.querySelector("#edit_dp_mat_select");
          const qty = panel.querySelector("#edit_dp_mat_qty").value;
          if (!sel.value || !qty || Number(qty) <= 0) return toast("Selecione material e quantidade válida.");

          const opt = sel.options[sel.selectedIndex];

          selectedMaterials.push({
            productId: sel.value,
            name: opt.text.split('(')[0].trim(),
            requestedQty: Number(qty)
          });
          updateMaterialsUI(panel);

          sel.value = "";
          panel.querySelector("#edit_dp_mat_qty").value = "";
        });
      }

      updateTasksUI(panel);
      updateMaterialsUI(panel);
    },
    onPrimary: async ({ panel, close }) => {
      const date = panel.querySelector("#edit_dp_date").value;
      const desc = panel.querySelector("#edit_dp_desc").value;
      const techId = panel.querySelector("#edit_dp_plan_tech").value;

      if (!date || selectedTasks.length === 0) {
        toast("Data e pelo menos uma tarefa são obrigatórios.", { type: "warning" });
        return;
      }

      const payloadTasks = selectedTasks.map(t => ({
        progressTaskId: t.progressTaskId,
        plannedQty: t.plannedQty,
        technicianId: techId || null
      }));

      const payload = {
        date,
        description: desc,
        tasks: payloadTasks
      };

      if (canEditMaterials) {
        payload.materials = selectedMaterials.map(m => ({
          productId: m.productId,
          requestedQty: m.requestedQty
        }));
      }

      try {
        await apiRequest(`/daily-plans/${encodeURIComponent(planId)}`, {
          method: "PATCH",
          body: payload
        });
        toast("Plano Diário atualizado com sucesso!", { type: "success" });
        close();
        if (window.loadDailyPlans) window.loadDailyPlans();
      } catch (err) {
        console.error(err);
        toast(err.message || "Erro ao atualizar plano diário", { type: "error" });
      }
    }
  });
};

