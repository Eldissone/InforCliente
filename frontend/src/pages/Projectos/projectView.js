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
  const baseUrl = window.location.origin.replace(/:5173$/, ":4000"); // Ajuste conforme porta da API
  const fileUrl = `${baseUrl}/${f.path}`;

  return `
    <div data-preview-file="${f.id}" class="bg-white rounded-2xl p-5 shadow-sm border border-surface-container hover:shadow-md hover:border-primary/20 transition-all group overflow-hidden cursor-pointer">
        <div class="flex items-start justify-between mb-4">
            <div class="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center ${iconColor}">
                <span class="material-symbols-outlined">${icon}</span>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
            <button data-delete-folder="${f.id}" title="Apagar Pasta" class="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-error/10 rounded-lg text-error transition-all">
                <span class="material-symbols-outlined text-sm">delete</span>
            </button>
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

  el("projectTitle").textContent = p.name;
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

let txState = { search: "" };
let fileState = { currentFolderId: null, breadcrumbs: [], items: [] };

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

  const projectData = await apiRequest(`/projects/${encodeURIComponent(id)}`);
  renderScurve(data.items, projectData.project);
}

function renderScurve(transactions, project) {
  const container = el("scurve_container");
  if (!container) return;

  const totalBudget = Number(project.budgetTotal || 0);
  if (totalBudget <= 0) {
    container.innerHTML = `<div class="flex items-center justify-center w-full h-full text-slate-400 text-xs">Defina o orçamento para visualizar o gráfico.</div>`;
    return;
  }

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: d.toLocaleString('pt-BR', { month: 'short' }).toUpperCase(),
      year: d.getFullYear(),
      month: d.getMonth(),
      executed: 0,
      planned: 0
    });
  }

  months.forEach((m, idx) => { m.planned = (totalBudget / 6) * (idx + 1); });

  let cumulative = 0;
  const sortedTx = transactions
    .filter(t => t.status === "PAID")
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  months.forEach(m => {
    const monthTx = sortedTx.filter(t => {
      const td = new Date(t.date);
      return td.getMonth() === m.month && td.getFullYear() === m.year;
    });
    cumulative += monthTx.reduce((acc, t) => acc + Number(t.amount || 0), 0);
    m.executed = cumulative;
  });

  const maxVal = Math.max(totalBudget, ...months.map(m => m.executed));

  container.innerHTML = months.map((m, idx) => {
    const planH = Math.round((m.planned / maxVal) * 100);
    const execH = Math.round((m.executed / maxVal) * 100);
    const isCurrent = idx === 5;
    return `
      <div class="flex-1 group relative">
        <div class="w-full bg-[#eff4ff] rounded-t-sm group-hover:bg-[#dce9ff] transition-all duration-500" style="height: ${planH}%"></div>
        <div class="absolute bottom-0 w-full bg-[#0d3fd1] rounded-t-sm transition-all duration-700 delay-100" style="height: ${execH}%; opacity: ${isCurrent ? 1 : 0.4}"></div>
        <span class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-on-surface-variant ${isCurrent ? 'font-bold' : ''}">${m.label}</span>
      </div>
    `;
  }).join("");
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
        <th class="px-2 py-1 text-right font-bold border-l border-white/20 text-white/70">Prev.</th>
        <th class="px-2 py-1 text-right font-bold text-white/70">Real.</th>
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
    });
  });
}

async function loadFiles() {
  const id = getProjectId();
  const list = el("projectFilesList");
  const empty = el("noFilesMsg");
  if (!list) return;

  // Add Breadcrumbs container if missing
  if (!el("fileBreadcrumbs")) {
    const header = list.parentElement.querySelector("div.flex.justify-between");
    const bread = document.createElement("div");
    bread.id = "fileBreadcrumbs";
    bread.className = "flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-slate-400";
    header.insertAdjacentElement("afterend", bread);
  }

  try {
    const { currentFolderId, breadcrumbs } = fileState;

    // Update breadcrumbs UI
    const breadHtml = [
      `<button data-go-folder="root" class="hover:text-primary transition-colors">Início</button>`,
      ...breadcrumbs.map((b, idx) => `
        <span class="material-symbols-outlined text-[10px]" data-icon="chevron_right">chevron_right</span>
        <button data-go-folder="${b.id}" class="${idx === breadcrumbs.length - 1 ? 'text-[#212e3e]' : 'hover:text-primary'} transition-colors">${b.name}</button>
      `)
    ].join("");
    el("fileBreadcrumbs").innerHTML = breadHtml;

    // Load Folders (only if at root for now, or all folders in project)
    const foldersRes = await apiRequest(`/projects/${encodeURIComponent(id)}/folders`);
    // Filter folders by parentId if we had nested, but for now we list all at root
    // For MVP: if not at root, we show no folders (one level only)
    const folders = currentFolderId ? [] : foldersRes.items;

    // Load Files
    const qs = currentFolderId ? `?folderId=${currentFolderId}` : `?folderId=root`;
    const filesRes = await apiRequest(`/projects/${encodeURIComponent(id)}/files${qs}`);

    if (!folders.length && !filesRes.items?.length) {
      list.innerHTML = "";
      empty?.classList.remove("hidden");
    } else {
      fileState.items = filesRes.items; // Store for preview
      empty?.classList.add("hidden");
      list.innerHTML = [
        ...folders.map(renderFolderCard),
        ...filesRes.items.map(renderFileCard)
      ].join("");
    }
  } catch (err) {
    toast("Erro ao carregar arquivos", { type: "error" });
  }
}

function wireFilesUpload() {
  el("uploadFileBtn")?.addEventListener("click", () => {
    const currentFolderName = fileState.breadcrumbs.length ? fileState.breadcrumbs[fileState.breadcrumbs.length - 1].name : "Raiz";
    openModal({
      title: `Submeter Documento [Pasta: ${currentFolderName}]`,
      primaryLabel: "Enviar",
      contentHtml: `
        <div class="space-y-4">
          <p class="text-xs text-on-surface-variant font-medium">Capture ou selecione documentos técnicos para esta obra.</p>
          <div class="border-2 border-dashed border-surface-container rounded-2xl p-8 flex flex-col items-center justify-center bg-surface-container-low/20">
            <span class="material-symbols-outlined text-3xl text-primary mb-3">cloud_upload</span>
            <input id="f_input" type="file" class="block w-full text-xs text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
          </div>
          <input type="hidden" id="f_folderId" value="${fileState.currentFolderId || ''}" />
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
        const id = getProjectId();
        const btn = panel.querySelector("[data-primary]");

        try {
          setButtonLoading(btn, true);
          await apiUpload(`/projects/${encodeURIComponent(id)}/files`, { file, body: { category, folderId: folderId || undefined } });
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
  // Add Create Folder button next to upload
  if (!el("createNewFolderBtn")) {
    const btn = document.createElement("button");
    btn.id = "createNewFolderBtn";
    btn.className = "bg-primary/10 text-primary px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-3 hover:bg-primary/20 transition-all mr-4";
    btn.innerHTML = `<span class="material-symbols-outlined">create_new_folder</span> Nova Pasta`;
    el("uploadFileBtn").insertAdjacentElement("beforebegin", btn);
  }

  el("createNewFolderBtn")?.addEventListener("click", () => {
    openModal({
      title: "Nova Pasta",
      primaryLabel: "Criar",
      contentHtml: `
        <div class="space-y-3">
          <label class="block text-[10px] font-black uppercase text-on-surface-variant mb-2">Nome da Pasta</label>
          <input id="fold_name" class="w-full rounded-xl border-surface-container bg-surface-container-low text-sm" placeholder="Ex: Plantas Técnicas" />
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const name = panel.querySelector("#fold_name")?.value?.trim();
        if (!name) {
          toast("Nome obrigatório", { type: "error" });
          return;
        }
        const id = getProjectId();
        const btn = panel.querySelector("[data-primary]");
        try {
          setButtonLoading(btn, true);
          await apiRequest(`/projects/${encodeURIComponent(id)}/folders`, { method: "POST", body: { name } });
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
    // Enter Folder
    const enterBtn = e.target?.closest("[data-enter-folder]");
    if (enterBtn) {
      const id = enterBtn.getAttribute("data-enter-folder");
      const name = enterBtn.getAttribute("data-folder-name");
      fileState.currentFolderId = id;
      fileState.breadcrumbs.push({ id, name });
      loadFiles();
      return;
    }

    // Go to Folder (Breadcrumbs)
    const goBtn = e.target?.closest("[data-go-folder]");
    if (goBtn) {
      const id = goBtn.getAttribute("data-go-folder");
      if (id === "root") {
        fileState.currentFolderId = null;
        fileState.breadcrumbs = [];
      } else {
        const idx = fileState.breadcrumbs.findIndex(b => b.id === id);
        if (idx !== -1) {
          fileState.currentFolderId = id;
          fileState.breadcrumbs = fileState.breadcrumbs.slice(0, idx + 1);
        }
      }
      loadFiles();
      return;
    }

    // Delete Folder
    const delBtn = e.target?.closest("[data-delete-folder]");
    if (delBtn) {
      if (!confirm("Apagar esta pasta eliminará permanentemente TODOS os arquivos contidos nela. Continuar?")) return;
      const folderId = delBtn.getAttribute("data-delete-folder");
      const id = getProjectId();
      try {
        await apiRequest(`/projects/${encodeURIComponent(id)}/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
        toast("Pasta removida", { type: "success" });
        await loadFiles();
      } catch (err) {
        toast("Erro ao apagar pasta", { type: "error" });
      }
    }
  });
}

function wireFileDeletion() {
  document.addEventListener("click", async (e) => {
    const btn = e.target?.closest("[data-delete-file]");
    if (!btn) return;

    if (!confirm("Tem a certeza que deseja eliminar este arquivo permanentemente?")) return;

    const fileId = btn.getAttribute("data-delete-file");
    const id = getProjectId();

    try {
      await apiRequest(`/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
      toast("Arquivo removido", { type: "success" });
      await loadFiles();
    } catch (err) {
      toast("Erro ao apagar arquivo", { type: "error" });
    }
  });
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
    btn.innerHTML = `<span class="material-symbols-outlined text-sm">upload_file</span> Importar Orçamento`;
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
