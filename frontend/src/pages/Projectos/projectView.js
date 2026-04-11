import { apiRequest, apiUpload } from "../../services/api.js";
import { openModal, toast, setButtonLoading, renderLoadingRow } from "../../shared/ui.js";
import { formatCurrencyKZ, formatDateBR, formatPercent } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";
import { getSessionUser } from "../../services/auth.js";

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

function splitPhaseLabel(value) {
  const phaseLabel = String(value || "").trim();
  if (!phaseLabel) {
    return { code: "FASE —", name: "Sem fase" };
  }

  const [code, ...rest] = phaseLabel.split(" - ");
  return {
    code: code || phaseLabel,
    name: rest.join(" - ") || phaseLabel,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
    INVESTIMENTOS: "Investimentos",
    DEPRECIACAO: "Depreciação",
    OUTRAS_DESPESAS: "Outras Despesas",
    DEDUCOES: "Dedução de Custos",
    IMPOSTOS: "Impostos",
  };
  return map[c] || c || "—";
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
  return unitMap[u] || u || "un";
}

function renderTxRow(t) {
  const st = statusLabel(t.status);
  return `
    <tr class="hover:bg-surface-container-low transition-colors group">
      <td class="px-8 py-4 text-sm">${formatDateBR(t.date)}</td>
      <td class="px-8 py-4">
        <div class="font-bold text-on-surface">${t.description}</div>
      </td>
      <td class="px-8 py-4">
        <span class="bg-surface-container px-2 py-1 rounded text-[10px] font-bold">${catLabel(t.category)}</span>
      </td>
      <td class="px-8 py-4 text-sm font-medium">${t.ownerName || "-"}</td>
      <td class="px-8 py-4">
        <div class="flex items-center gap-2 ${st.cls}">
          <span class="w-2 h-2 rounded-full ${st.dot} ${t.status === "PAID" ? "shadow-[0_0_6px_#2afc8d]" : ""}"></span>
          <span class="text-xs font-semibold">${st.text}</span>
        </div>
      </td>
      <td class="px-8 py-4 text-right font-bold text-on-surface">
        ${formatCurrencyKZ(t.amount)}
        ${t.realizedAmount != null && t.realizedAmount !== t.amount ? `<div class="text-[10px] text-[#2afc8d] font-black">Real: ${formatCurrencyKZ(t.realizedAmount)}</div>` : ""}
      </td>
      <td class="px-8 py-4 text-center">
        ${t.status !== "PAID" ? `
          <button data-liquidate-tx="${t.id}" data-tx-desc="${escapeHtml(t.description)}" data-tx-amount="${t.amount}" title="Marcar como Liquidado" class="material-symbols-outlined text-slate-400 hover:text-[#2afc8d] transition-colors p-1 rounded-md hover:bg-[#2afc8d]/10">check_circle</button>
        ` : `
          <span class="material-symbols-outlined text-[#2afc8d] opacity-50">done_all</span>
        `}
      </td>
    </tr>
  `;
}

function renderFileCard(f) {
  const isImage = f.mimeType.startsWith("image/");
  const icon = isImage ? "image" : (f.mimeType === "application/pdf" ? "picture_as_pdf" : "description");
  const iconColor = isImage ? "text-primary" : (f.mimeType === "application/pdf" ? "text-error" : "text-slate-400");
  const baseUrl = window.location.origin.replace(/:5173$/, ":4000");
  const fileUrl = `${baseUrl}/${f.path}`;

  return `
    <div data-preview-file="${f.id}" class="bg-white rounded-2xl p-5 shadow-sm border border-surface-container hover:shadow-md hover:border-primary/20 transition-all group overflow-hidden cursor-pointer">
        <div class="flex items-start justify-between mb-4">
            <div class="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center ${iconColor}">
                <span class="material-symbols-outlined">${icon}</span>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button data-edit-file="${f.id}" data-file-name="${escapeHtml(f.originalName)}" data-file-folder="${f.folderId || ''}" data-file-cat="${f.category || ''}" title="Editar" class="p-1.5 hover:bg-primary/10 rounded-lg text-primary transition-colors">
                    <span class="material-symbols-outlined text-sm">edit</span>
                </button>
                <a href="${fileUrl}" target="_blank" title="Abrir em Nova Aba" class="p-1.5 hover:bg-primary/10 rounded-lg text-primary transition-colors">
                    <span class="material-symbols-outlined text-sm">open_in_new</span>
                </a>
                <button data-delete-file="${f.id}" title="Apagar" class="p-1.5 hover:bg-error/10 rounded-lg text-error transition-colors">
                    <span class="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        </div>
        <div class="mb-4">
            <h4 class="text-sm font-bold text-[#212e3e] truncate" title="${escapeHtml(f.originalName)}">${escapeHtml(f.originalName)}</h4>
            <p class="text-[10px] text-on-surface-variant font-bold uppercase mt-0.5">${formatBytes(f.size)} • ${formatDateBR(f.createdAt)}</p>
        </div>
        <a href="${fileUrl}" download="${f.originalName}" class="block w-full text-center py-2 bg-surface-container-low rounded-lg text-[10px] font-black uppercase tracking-widest text-[#212e3e] hover:bg-primary hover:text-white transition-all">
            Transferir
        </a>
    </div>
  `;
}

function renderFolderCard(f) {
  return `
    <div data-enter-folder="${f.id}" data-folder-name="${escapeHtml(f.name)}" class="bg-white rounded-2xl p-5 shadow-sm border border-surface-container hover:shadow-md hover:border-primary/20 transition-all group cursor-pointer">
        <div class="flex items-start justify-between mb-4">
            <div class="w-12 h-12 rounded-xl bg-primary/5 flex items-center justify-center text-primary">
                <span class="material-symbols-outlined text-3xl">folder</span>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button data-edit-folder="${f.id}" data-folder-name="${escapeHtml(f.name)}" title="Renomear Pasta" class="p-1.5 hover:bg-primary/10 rounded-lg text-primary transition-colors">
                    <span class="material-symbols-outlined text-sm">edit</span>
                </button>
                <button data-delete-folder="${f.id}" title="Apagar Pasta" class="p-1.5 hover:bg-error/10 rounded-lg text-error transition-colors">
                    <span class="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        </div>
        <div>
            <h4 class="text-sm font-bold text-[#212e3e] truncate">${escapeHtml(f.name)}</h4>
            <p class="text-[10px] text-on-surface-variant font-bold uppercase mt-0.5">Pasta de Arquivos</p>
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

  el("budgetTotal").textContent = formatCurrencyKZ(total);
  el("budgetConsumed").textContent = formatCurrencyKZ(consumed);
  el("budgetCommitted").textContent = "-" + formatCurrencyKZ(Math.max(0, committed));
  el("budgetAvailable").textContent = formatCurrencyKZ(available);

  const pct = total > 0 ? Math.round((consumed / total) * 100) : 0;
  el("budgetDelta").textContent = `Consumido: ${formatPercent(pct, { digits: 0 })}`;
  if (el("budgetBar")) el("budgetBar").style.width = `${Math.max(0, Math.min(100, pct))}%`;

  const progress = Number(p.physicalProgressPct || 0);
  el("physicalProgress").textContent = formatPercent(progress, { digits: 0 });
  const gaugeEl = el("physicalProgressGauge");
  if (gaugeEl) {
    // 0% = -135deg (início), 100% = 45deg (fim do semi-círculo)
    const rotation = (progress * 1.8) - 135;
    gaugeEl.style.transform = `rotate(${rotation}deg)`;
  }
  el("projectStartDate").textContent = formatDateBR(p.startDate);
  el("projectDueDate").textContent = formatDateBR(p.dueDate);

  const phase = splitPhaseLabel(p.phaseLabel);
  el("projectPhaseLabel").textContent = phase.code;
  el("projectPhaseName").textContent = phase.name;

  return p;
}

let projectState = null;
let txState = { search: "" };
let fileState = { currentFolderId: null, breadcrumbs: [], items: [], folders: [] };

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

  // --- Planejado: idêntico à coluna "Previsto (P.)" da tabela ---
  // 1) Budget lines distribuídas linearmente (excluindo capital)
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

  // 2) Transações PENDING/LATE adicionadas ao mês específico da data (tal como a tabela)
  (allTxs || []).filter(t => t.status === "PENDING" || t.status === "LATE").forEach(t => {
    const idx = getColIdx(new Date(t.date));
    const cat = t.category || "";
    if (!["INVESTIMENTOS", "DEPRECIACAO"].includes(cat)) {
      plannedByMonth[idx] += Number(t.amount || 0);
    }
  });

  // --- Realizado: PAID → realizedAmount ou amount (excluindo capital) ---
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
  console.group("🔵 Curva S — Diagnóstico");
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

    // Coluna do mês
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

    // Label do mês
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

    // Ponto marcador do mês atual
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

  // --- Build dynamic month range from project start → due date ---
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
    INVESTIMENTOS: { name: "INVESTIMENTOS", total: 0, consumed: 0, byMonth: Array(numMonths).fill(0).map(() => ({ p: 0, c: 0 })), items: [] },
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

      const cleanDesc = (t.description || "Lançamento Avulso").trim();
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
        const cleanDesc = (t.description || "Lançamento Avulso").trim();
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
    // Capital and depreciation categories are off-budget — excluded from grand totals
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
    let rowCls = customRowCls || (isHeader ? "bg-[#e2e8f0] font-black text-[#212e3e]" : "bg-white text-on-surface hover:bg-surface-container-low transition-colors");
    let titleCls = customRowCls ? `px-4 py-2 sticky left-0 z-10 whitespace-nowrap ${customRowCls}` : (isHeader ? "px-4 py-2 sticky left-0 bg-[#e2e8f0] z-10 whitespace-nowrap" : "px-4 py-1.5 sticky left-0 bg-white group-hover:bg-surface-container-low transition-colors whitespace-nowrap overflow-hidden text-ellipsis max-w-[250px] pl-8 text-xs font-semibold");

    let html = `<tr class="border-b border-outline-variant/30 group ${rowCls}">`;
    html += `<td class="${titleCls}" title="${escapeHtml(title)}">${escapeHtml(title)}</td>`;

    // Total column
    html += `<td class="px-2 py-1.5 text-right font-black border-l border-outline-variant/30 bg-primary/5">${formatTableCurrency(totalP)}</td>`;
    html += `<td class="px-2 py-1.5 text-right ${totalC > totalP ? 'text-error' : ''}">${formatTableCurrency(totalC)}</td>`;
    html += `<td class="px-2 py-1.5 text-right text-[9px] text-on-surface-variant font-bold">${formatPct(totalC, totalP)}</td>`;

    monthsData.forEach((m) => {
      html += `<td class="px-2 py-1.5 text-right border-l border-outline-variant/30 text-[11px] text-slate-500">${formatTableCurrency(m.p)}</td>`;
      html += `<td class="px-2 py-1.5 text-right text-[11px] font-bold ${m.c > m.p ? 'text-error' : 'text-[#212e3e]'}">${formatTableCurrency(m.c)}</td>`;
      html += `<td class="px-2 py-1.5 text-right text-[9px] text-on-surface-variant">${formatPct(m.c, m.p)}</td>`;
    });

    html += `</tr>`;
    return html;
  };

  let theadHtml = `
    <thead>
      <tr class="bg-[#1e293b] text-[#121210]">
        <th rowspan="2" class="px-4 py-2 sticky left-0 bg-[#1e293b] z-20 whitespace-nowrap min-w-[250px] text-left text-xs font-black uppercase tracking-widest text-black">Descrição</th>
        <th colspan="3" class="px-2 py-2 text-center text-xs font-black uppercase tracking-widest border-l border-white/20 bg-primary/20 text-black">TOTAL OBRA</th>
        ${projectMonths.map(m => `<th colspan="3" class="px-2 py-2 text-center text-xs font-black uppercase tracking-widest border-l border-white/20 text-black">${m.label}</th>`).join('')}
      </tr>
      <tr class="bg-[#334155] text-black text-[9px] uppercase tracking-wider">
        <th class="px-2 py-1 text-right font-bold border-l border-white/20 text-black">Prev.</th>
        <th class="px-2 py-1 text-right font-bold text-black">Real.</th>
        <th class="px-2 py-1 text-right font-bold text-white/70">(%)</th>
        ${projectMonths.map(() => `
          <th class="px-2 py-1 text-right font-bold border-l border-white/20 text-white/70">P.</th>
          <th class="px-2 py-1 text-right font-bold text-[#2afc8d]">R.</th>
          <th class="px-2 py-1 text-right font-bold text-white/70">%</th>
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
    if (isInvestment) catTitle = `▲ ${cat.name}`;
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

  if (el("totalPlannedVal")) el("totalPlannedVal").textContent = formatCurrencyKZ(gTotalP);
  if (el("totalExecutedVal")) el("totalExecutedVal").textContent = formatCurrencyKZ(gTotalC);
  if (el("totalExecutionPct")) {
    const totalPct = gTotalP > 0 ? Math.round((gTotalC / gTotalP) * 100) : 0;
    el("totalExecutionPct").textContent = `${totalPct}% GERAL`;
  }

  // Renderiza Curva S com dados reais (todas as transações + linhas de orçamento)
  renderScurve(txs, p, lines);

  renderOperationStatus(lines);
}

async function renderOperationStatus(lines) {
  const id = getProjectId();
  // Busca todos os lançamentos para não depender apenas dos vinculados
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

  // Somar orçamento total por categoria (das linhas de orçamento)
  lines.forEach(l => {
    const group = getGroup(l.category);
    if (group && cats[group]) {
      cats[group].total += Number(l.total || 0);
    }
  });

  // Somar todos os custos lançados por categoria
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
      subEl.textContent = `${formatCurrencyKZ(c.consumed)} lançados`;
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
              Valor Previsto / Comprometido (kz)
            </label>
            <div class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-400 text-sm font-mono">
              ${Number(txAmount).toLocaleString('pt-AO')} kz
            </div>
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-primary mb-2">
              Valor Realmente Pago (kz)
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
          toast("Lançamento liquidado com sucesso!", { type: "success" });
          close();
          await loadProject();
          await loadTransactions();
          await loadBudgetExecution();
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
        tr.classList.remove("border-primary", "text-primary");
        tr.classList.add("text-on-surface-variant", "border-transparent");
      });
      t.classList.add("border-primary", "text-primary");
      t.classList.remove("text-on-surface-variant", "border-transparent");

      // Update Contents
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      el(`tab_${tabId}`)?.classList.remove("hidden");

      if (tabId === "files") loadFiles();
      if (tabId === "relatorio") loadProgressTasks();
    });
  });
}

function renderProgressTaskRow(t, index) {
  const exp = Number(t.expectedQty || 0);
  const exe = Number(t.executedQty || 0);
  const left = exp > exe ? (exp - exe) : 0;

  const exePct = exp > 0 ? Math.round((exe / exp) * 100) : (exe > 0 ? 100 : 0);
  const leftPct = Math.max(0, 100 - exePct);

  return `
    <tr class="hover:bg-surface-container-low transition-colors group">
      <td class="px-6 py-4 text-center font-black text-slate-400 text-xs">${index + 1}</td>
      <td class="px-6 py-4">
        <div class="font-bold text-[#212e3e] flex flex-col">
          <span>${escapeHtml(t.description)}</span>
          ${t.itemGroup ? `<span class="text-[10px] text-on-surface-variant uppercase tracking-widest">${escapeHtml(t.itemGroup)}</span>` : ""}
        </div>
      </td>
      <td class="px-4 py-4 text-center font-black">${exp.toLocaleString('pt-AO')}</td>
      <td class="px-4 py-4 text-center text-[10px] tracking-widest text-[#212e3e] font-black uppercase bg-surface-container-low/30 rounded-lg shadow-inner">${formatUnit(t.unit)}</td>
      <td class="px-4 py-4 text-center font-black text-[#212e3e]">${exe.toLocaleString('pt-AO')}</td>
      <td class="px-4 py-4 text-center font-black text-[#0d3fd1]">${exePct}%</td>
      <td class="px-4 py-4 text-center font-black text-slate-500">${left.toLocaleString('pt-AO')}</td>
      <td class="px-4 py-4 text-center font-black text-error">${leftPct}%</td>
      <td class="px-4 py-4 text-right">
        <button data-edit-task="${t.id}" data-task-desc="${escapeHtml(t.description)}" data-task-exe="${exe}" data-task-exp="${exp}" data-task-unit="${escapeHtml(t.unit)}" title="Atualizar Progresso" class="material-symbols-outlined text-slate-400 hover:text-[#0d3fd1] transition-colors p-1 rounded-md hover:bg-[#0d3fd1]/10">edit</button>
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
    if (data.tasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-xs text-slate-400 font-bold uppercase">Sem tarefas cadastradas</td</tr>`;
    } else {
      tbody.innerHTML = data.tasks.map((t, i) => renderProgressTaskRow(t, i)).join("");
    }
  } catch (err) {
    toast("Erro ao carregar o relatório de avanço", { type: "error" });
  }
}

function wireProgressTasks() {
  const id = getProjectId();

  el("addProgressTaskBtn")?.addEventListener("click", () => {
    openModal({
      title: "Adicionar Item de Progresso",
      primaryLabel: "Salvar",
      contentHtml: `
        <div class="space-y-4">
          <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Grupo/Tipo</label><input id="rt_group" class="w-full rounded-lg border-slate-300" placeholder="Ex: MÉDIA TENSÃO" value="${escapeHtml(projectState?.projectType || '')}" /></div>
          <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Descrição da Tarefa</label><input id="rt_desc" class="w-full rounded-lg border-slate-300" placeholder="Ex: Marcação da obra" /></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Qtd Prevista</label><input id="rt_exp" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" /></div>
            <div>
              <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Unidade (UN)</label>
              <select id="rt_uni" class="w-full rounded-lg border-slate-300">
                <option value="un">un (unidade)</option>
                <option value="mts">mts (metros)</option>
                <option value="km">km (quilómetros)</option>
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
              description: v("rt_desc"),
              expectedQty: Number(v("rt_exp") || 0),
              executedQty: 0,
              unit: v("rt_uni") || "un",
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

  document.addEventListener("click", async (e) => {
    const editBtn = e.target?.closest("[data-edit-task]");
    if (editBtn) {
      const taskId = editBtn.getAttribute("data-edit-task");
      const desc = editBtn.getAttribute("data-task-desc");
      const exe = editBtn.getAttribute("data-task-exe");
      const exp = editBtn.getAttribute("data-task-exp");
      const uni = editBtn.getAttribute("data-task-unit");

      openModal({
        title: "Atualizar Progresso",
        primaryLabel: "Atualizar",
        contentHtml: `
          <div class="space-y-4">
            <p class="font-bold text-[#212e3e] text-sm">${escapeHtml(desc)}</p>
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
                  <option value="mes" ${uni === 'mes' ? 'selected' : ''}>mês</option>
                  <option value="global" ${uni === 'global' ? 'selected' : ''}>global</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Qtd. Prevista</label>
                <input id="up_exp" type="number" step="0.01" value="${exp}" class="w-full rounded-lg border-slate-300" />
              </div>
              <div>
                <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Qtd. Executada</label>
                <input id="up_exe" type="number" step="0.01" value="${exe}" class="w-full rounded-lg border-primary" />
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
                unit: panel.querySelector("#up_uni").value.trim() || undefined,
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
        await apiRequest("/projects/" + encodeURIComponent(id) + "/progress-tasks/" + encodeURIComponent(taskId), { method: "DELETE" });
        toast("Apagado com sucesso!", { type: "success" });
        loadProgressTasks();
      } catch (err) {
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

  // Criar breadcrumbs container se não existir
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
        `<button data-go-folder="root" class="hover:text-primary transition-colors flex items-center gap-1"><span class="material-symbols-outlined text-sm">home</span> Início</button>`,
        ...breadcrumbs.map((b, idx) => `
          <span class="material-symbols-outlined text-xs">chevron_right</span>
          <button data-go-folder="${b.id}" class="${idx === breadcrumbs.length - 1 ? 'text-[#212e3e] font-black' : 'hover:text-primary'} transition-colors">${escapeHtml(b.name)}</button>
        `)
      ].join("");
      breadEl.innerHTML = breadHtml;
    }

    // Carregar subpastas do nível actual
    const parentParam = currentFolderId ? `?parentId=${currentFolderId}` : `?parentId=root`;
    const foldersRes = await apiRequest(`/projects/${encodeURIComponent(id)}/folders${parentParam}`);
    const folders = foldersRes.items || [];
    fileState.folders = folders;

    // Carregar ficheiros do nível actual
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
    btn.className = "bg-primary/10 text-primary px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-3 hover:bg-primary/20 transition-all mr-4";
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
          <input id="fold_name" class="w-full rounded-xl border-surface-container bg-surface-container-low text-sm" placeholder="Ex: Plantas Técnicas" />
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
  // Delegação unificada em wireFileNavigation — este stub mantém compatibilidade
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
  el("newTransactionBtn")?.addEventListener("click", async () => {
    const id = getProjectId();
    const budgetData = await apiRequest(`/projects/${encodeURIComponent(id)}/budget/lines`);
    const budgetOptions = [
      `<option value="">(Nenhum item específico)</option>`,
      ...(budgetData.items || []).map(l => `<option value="${l.id}">${escapeHtml(l.description)} [Previsto: ${formatCurrencyKZ(l.total)}]</option>`)
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
                <option value="INVESTIMENTOS">Investimentos</option>
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
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Valor (kz)</label>
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
          toast("Lançamento criado com sucesso", { type: "success" });
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
  });
}

function wireBudgetUpload() {
  if (getSessionUser()?.role === "cliente") return;
  // adiciona um botão "Importar Orçamento" ao lado do Exportar
  const exportBtn = el("exportProjectBtn");
  if (!exportBtn) return;
  const wrap = exportBtn.parentElement;
  if (!wrap) return;

  if (!document.getElementById("uploadBudgetBtn")) {
    const btn = document.createElement("button");
    btn.id = "uploadBudgetBtn";
    btn.className =
      "bg-surface-container-low px-6 py-2.5 text-primary text-sm font-semibold rounded-lg hover:bg-surface-container-high transition-all flex items-center gap-2";
    btn.innerHTML = `<span class="material-symbols-outlined text-sm">upload_file</span> Importar`;
    wrap.insertBefore(btn, exportBtn);
  }

  el("uploadBudgetBtn")?.addEventListener("click", () => {
    openModal({
      title: "Upload de planilha de orçamento",
      primaryLabel: "Enviar",
      contentHtml: `
        <div class="space-y-3">
          <div class="text-sm text-slate-700">
            Formatos aceitos: <span class="font-bold">.xlsx</span> ou <span class="font-bold">.csv</span>.
            A planilha precisa ter uma coluna de <span class="font-bold">descrição</span> e uma coluna de <span class="font-bold">total/valor</span>.
          </div>
          <input id="budgetFile" type="file" accept=".xlsx,.xls,.csv" class="block w-full text-sm" />
          <div class="text-xs text-slate-500">
            Dica de colunas: descricao/description, total/valor/valor_total, (opcionais: categoria, unidade, quantidade, preco_unitario).
          </div>
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const file = panel.querySelector("#budgetFile")?.files?.[0];
        if (!file) {
          toast("Selecione um arquivo para enviar.", { type: "error" });
          return;
        }

        const id = getProjectId();
        const btn = panel.querySelector("[data-primary]");
        try {
          setButtonLoading(btn, true);
          const res = await apiUpload(`/projects/${encodeURIComponent(id)}/budget/upload`, { file });
          toast(`Orçamento importado: ${res.imported} linhas`, { type: "success" });
          if (res.warnings?.length) {
            toast(`Avisos: ${res.warnings.slice(0, 1).join(" ")}`, { type: "info", timeoutMs: 6000 });
          }
          close();
          await loadProject();
          await loadBudgetExecution();
        } catch (err) {
          setButtonLoading(btn, false);
          toast("Erro ao importar orçamento", { type: "error" });
        }
      },
    });
  });
}

async function init() {
  wireLogout();
  wireUsersNav();
  await loadProject();
  await loadTransactions();
  await loadBudgetExecution();
  wireSearch();
  wireExport();
  wireBudgetUpload();
  wireNewTransaction();
  wireLiquidation();
  wireTabs();
  wireFilesUpload();
  wireNewFolder();
  wireFileNavigation();
  wireFileDeletion();
  wirePreview();
  wireProgressTasks();
}

function openPreview(fileId) {
  const file = fileState.items.find(f => f.id === fileId);
  if (!file) return;

  const baseUrl = window.location.origin.replace(/:5173$/, ":4000");
  const fileUrl = `${baseUrl}/${file.path}`;

  el("previewFileName").textContent = file.originalName;
  el("previewFileMeta").textContent = `${formatBytes(file.size)} • ${formatDateBR(file.createdAt)} • ${file.category}`;
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
        <p class="text-on-surface-variant font-bold mb-4 text-sm">Este arquivo não suporta pré-visualização direta.</p>
        <a href="${fileUrl}" download="${file.originalName}" class="inline-flex items-center gap-2 bg-primary text-white px-8 py-3 rounded-xl font-bold hover:brightness-110 transition-all">
          <span class="material-symbols-outlined">download</span> Download do Arquivo
        </a>
      </div>
    `;
  }

  el("previewPanel").classList.add("open");
  el("previewBackdrop").classList.add("open");
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
