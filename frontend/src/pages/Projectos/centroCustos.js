import { apiRequest, getAssetUrl, apiUpload } from "/services/api.js";
import { guardPageAccess, initPermissionLayer } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { openQuotePricingModal, submitQuoteForm } from "/shared/quotePricingModal.js";
import { formatCurrency, formatDateBR } from "/shared/format.js";
import { renderPaymentTimeline, renderGroupedListRows, TIMELINE_STATUS, formatTimelineDayLabel } from "/shared/paymentTimeline.js";
import { computeSupplierFiscalBreakdown, formatFiscalAmount } from "/shared/supplierFiscal.js";

// ── State ──────────────────────────────────────────────────────────────────────
let allProjects = [];
let selectedProject = null;
let costCenters = [];
let currentCC = null;
let currentTxStatus = "PENDING"; // Add variable to keep track of segmented tab
let dashSummary = null;
let cachedNeeds = [];
let currentSuppliers = [];

// ── Fase 7/8: Fundo de Maneio + Pedidos Extra ───────────────────────────────
let currentFunds = [];
let selectedFundId = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────────
(async () => {
  const ok = await guardPageAccess("obras", "view");
  if (!ok) return;

  await initPermissionLayer();
  wireLogout();
  wireUsersNav();
  await loadProjects();
  bindEvents();

  // Se veio URL com ?projectId=xxx, selecionar automaticamente
  const urlPid = new URLSearchParams(window.location.search).get("projectId");
  if (urlPid) {
    const p = allProjects.find((x) => x.id === urlPid);
    if (p) selectProject(p);
    else showGlobalView();
  } else {
    showGlobalView();
  }
})();

// ── Load Projects ──────────────────────────────────────────────────────────────
async function loadProjects() {
  try {
    const data = await apiRequest("/projects?pageSize=100&sort=updatedAt_desc");
    allProjects = data.items || [];
    renderProjectList(allProjects);
  } catch (err) {
    showToast("Erro ao carregar obras: " + err.message, "error");
  }
}

function renderProjectList(projects) {
  const list = document.getElementById("projList");
  const count = document.getElementById("projCount");
  count.textContent = projects.length;

  if (!projects.length) {
    list.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined text-3xl">construction</span><p class="text-xs">Nenhuma obra encontrada</p></div>`;
    return;
  }

  list.innerHTML = projects.map((p) => {
    const isSelected = selectedProject?.id === p.id;
    const statusColor = p.status === "ACTIVE" ? "bg-emerald-500" : p.status === "ON_HOLD" ? "bg-amber-400" : "bg-slate-400";
    return `
    <div class="proj-card ${isSelected ? "selected" : ""}" data-pid="${p.id}">
      <div class="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
        <span class="material-symbols-outlined text-base text-slate-600">construction</span>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-bold text-slate-900 truncate">${p.name}</p>
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">${p.code || ""}</p>
      </div>
      <span class="w-2 h-2 rounded-full flex-shrink-0 ${statusColor}"></span>
    </div>`;
  }).join("");

  // Click events — clicar na obra selecionada desseleciona
  list.querySelectorAll(".proj-card").forEach((card) => {
    card.addEventListener("click", () => {
      const p = allProjects.find((x) => x.id === card.dataset.pid);
      if (!p) return;
      if (selectedProject?.id === p.id) {
        clearProjectSelection();
        return;
      }
      selectProject(p);
    });
  });
}

function showGlobalView() {
  document.getElementById("globalPaymentsView")?.classList.remove("hidden");
  document.getElementById("projectContent")?.classList.add("hidden");
  populateGlobalFilters();
  loadGlobalPaymentTimeline();
  loadGlobalExtras();
}

function clearProjectSelection() {
  selectedProject = null;
  localStorage.removeItem("InfoCliente.currentProjectId");
  const url = new URL(window.location.href);
  url.searchParams.delete("projectId");
  window.history.replaceState({}, "", url.toString());
  renderProjectList(allProjects);
  showGlobalView();
}

function populateGlobalFilters() {
  const projSel = document.getElementById("globalProjFilter");
  if (projSel) {
    const current = projSel.value;
    projSel.innerHTML = `<option value="">Todas as Obras</option>` +
      allProjects.map((p) => `<option value="${p.id}">${p.name}${p.code ? ` (${p.code})` : ""}</option>`).join("");
    if (allProjects.some((p) => p.id === current)) projSel.value = current;
  }
}

function reloadPaymentsView() {
  if (selectedProject) {
    loadPayments();
    loadSummary();
    loadCronograma();
  } else {
    loadGlobalPaymentTimeline();
  }
}

function getGlobalTimelineFilters() {
  const params = new URLSearchParams();
  const projectId = document.getElementById("globalProjFilter")?.value;
  const status = document.getElementById("globalTimelineStatus")?.value;
  const search = document.getElementById("globalTimelineSearch")?.value?.trim();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  return params;
}

async function loadGlobalPaymentTimeline() {
  const el = document.getElementById("globalTimelineBody");
  if (!el) return;
  el.innerHTML = `<div class="spinner my-8"></div>`;

  try {
    const params = getGlobalTimelineFilters();
    const data = await apiRequest(`/cost-centers/payments/timeline?${params}`);
    el.innerHTML = renderPaymentTimeline(data.days, {
      showProject: true,
      emptyMessage: "Nenhum pagamento visível no cronograma.",
    });
  } catch (err) {
    el.innerHTML = `<p class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</p>`;
  }
}

function renderPaymentRowHtml(p, { showProject = false, allowEdit = false } = {}) {
  const statusClasses = { PENDENTE: "badge-pendente", CONFIRMADO: "badge-confirmado", CANCELADO: "badge-cancelado" };
  const statusLabels = { PENDENTE: "Pendente", CONFIRMADO: "Liquidado", CANCELADO: "Cancelado" };
  const typeLabels = { PRONTO_PAGAMENTO: "PP", CREDITO: "C" };
  const typeClasses = {
    PRONTO_PAGAMENTO: "bg-red-50 text-red-700 border border-red-200",
    CREDITO: "bg-sky-50 text-sky-700 border border-sky-100",
  };
  const cur = p.costCenter?.currency || "AOA";
  const payload = JSON.stringify(p).replace(/'/g, "&#39;");
  const projectCell = showProject
    ? `<td class="text-xs font-bold text-slate-700 max-w-[120px] truncate" title="${p.project?.name || ""}">${p.project?.name || "—"}</td>`
    : "";

  const editActions = allowEdit ? `
          <button onclick="event.stopPropagation(); editPay(${JSON.stringify(p).replace(/"/g, "&quot;")})" title="Editar lançamento"
            class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-emerald-100 hover:text-emerald-600 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">edit</span>
          </button>
          <button onclick="event.stopPropagation(); deletePay('${p.id}', '${p.costCenterId}')" title="Eliminar lançamento"
            class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>` : `
          <button onclick="event.stopPropagation(); openPaymentAsideHandler(this)" data-payload='${payload}' data-type="VIEW" title="Ver detalhes"
            class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-[#2afc8d] hover:text-slate-900 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">visibility</span>
          </button>`;

  return `
    <tr class="cursor-pointer hover:bg-slate-50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${payload}' data-type="${p.status === "PENDENTE" ? "PAYMENT" : "VIEW"}">
      <td class="text-xs font-bold text-slate-500">${p.docNumber || "—"}</td>
      <td class="text-xs text-slate-500">${formatDateBR(p.paymentDate)}</td>
      ${projectCell}
      <td class="text-sm font-medium text-slate-700 max-w-[120px] truncate">${p.supplier || "—"}</td>
      <td><span class="text-xs font-bold text-blue-600">${p.costCenter?.code || "—"}</span></td>
      <td class="text-sm font-medium text-slate-900 max-w-xs truncate">${p.description}</td>
      <td><span class="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${typeClasses[p.paymentType] || "bg-slate-100 text-slate-500 border border-slate-200"}">${typeLabels[p.paymentType] || "—"}</span></td>
      <td class="text-right tabular-nums text-sm font-medium text-slate-600">${formatCurrency(p.budgetedAmount, cur)}</td>
      <td class="text-right tabular-nums text-sm font-bold ${Number(p.paidAmount) > Number(p.budgetedAmount) ? "text-red-600" : "text-slate-900"}">${formatCurrency(p.paidAmount, cur)}</td>
      <td class="text-center text-xs font-bold text-slate-500">${p.week || "—"}</td>
      <td class="text-center"><span class="text-xs font-bold px-2.5 py-1 rounded-full ${statusClasses[p.status] || "badge-pendente"}">${statusLabels[p.status] || p.status}</span></td>
      <td class="text-center">
        <div class="flex justify-center gap-2">
          ${p.status === "PENDENTE" ? `
            <button onclick="event.stopPropagation(); openPaymentAsideHandler(this)" data-payload='${payload}' data-type="PAYMENT" title="Pagar lançamento"
              class="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all text-emerald-600">
              <span class="material-symbols-outlined text-base">check_circle</span>
            </button>
          ` : ""}
          ${editActions}
        </div>
      </td>
    </tr>`;
}

// ── Select Project ─────────────────────────────────────────────────────────────
async function selectProject(project) {
  selectedProject = project;
  localStorage.setItem("InfoCliente.currentProjectId", project.id);

  // Update URL
  const url = new URL(window.location.href);
  url.searchParams.set("projectId", project.id);
  window.history.replaceState({}, "", url.toString());

  // UI
  document.getElementById("globalPaymentsView")?.classList.add("hidden");
  document.getElementById("projectContent").classList.remove("hidden");
  document.getElementById("selectedProjName").textContent = project.name;
  document.getElementById("selectedProjCode").textContent = project.code || "";
  document.getElementById("viewProjectBtn").href = `./projectView.html?id=${project.id}`;

  // Re-render list to highlight
  renderProjectList(allProjects);

  // Load data
  await Promise.all([loadCostCenters(), loadSummary()]);
  switchTab("dashboard");
}

// ── Toggle Group (Orçamento Geral) ─────────────────────────────────────────────
window.toggleCCGroup = function (groupId) {
  const items = document.querySelectorAll(`.${groupId}-item`);
  const icon = document.getElementById(`${groupId}-icon`);
  let isHidden = false;

  items.forEach(item => {
    if (item.classList.contains('hidden')) {
      item.classList.remove('hidden');
      isHidden = false;
    } else {
      item.classList.add('hidden');
      isHidden = true;
    }
  });

  if (icon) {
    icon.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
  }
}

// ── Load Cost Centers ──────────────────────────────────────────────────────────
async function loadCostCenters() {
  if (!selectedProject) return;
  try {
    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}`);
    costCenters = data.items || [];
    renderCCTable();
    populateCCSelects();
  } catch (err) {
    showToast("Erro ao carregar centros de custo: " + err.message, "error");
  }
}

// ── Load Summary (Dashboard) ───────────────────────────────────────────────────
async function loadSummary() {
  if (!selectedProject) return;
  try {
    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/summary`);
    dashSummary = data;
    renderKPIs(data.totals, data.extras);
    renderPrevistoRealTable(data.summary, data.totals);
    // Dashboard extra cards
    loadWeeklyBreakdown();
    loadTopExpenses();
  } catch (err) {
    showToast("Erro ao carregar resumo: " + err.message, "error");
  }
}

// ── KPIs ───────────────────────────────────────────────────────────────────────
function renderKPIs(totalsByCurrency, extrasByCurrency = {}) {
  if (!totalsByCurrency) return;
  const baseEl = document.getElementById("kpiBasePrevisto");
  const realizadoEl = document.getElementById("kpiRealizado");
  const extrasEl = document.getElementById("kpiExtrasAprovados");

  baseEl.innerHTML = "";
  realizadoEl.innerHTML = "";
  extrasEl.innerHTML = "";

  const currencies = Object.keys(totalsByCurrency);
  const extraCurrencies = Object.keys(extrasByCurrency || {});
  const allCurrencies = [...new Set([...currencies, ...extraCurrencies])];

  if (allCurrencies.length === 0) {
    baseEl.innerHTML = `<p class="text-xl font-bold text-slate-900 tracking-tight">—</p>`;
    realizadoEl.innerHTML = `<p class="text-xl font-bold text-slate-900 tracking-tight">—</p>`;
    extrasEl.innerHTML = `<p class="text-xl font-bold text-slate-900 tracking-tight">—</p>`;
    document.getElementById("kpiPct").textContent = "0%";
    document.getElementById("kpiBar").style.width = "0%";
    return;
  }

  let totalPct = 0;
  let pctCount = 0;

  allCurrencies.forEach((cur) => {
    const t = totalsByCurrency[cur] || { basePrevisto: 0, budgeted: 0, paid: 0, pctExecutado: 0 };
    const ex = extrasByCurrency[cur] || { approved: 0, requested: 0 };

    baseEl.innerHTML += `<p class="text-xl font-bold text-slate-900 tracking-tight" title="${cur}">${formatCurrency(t.basePrevisto ?? t.budgeted ?? 0, cur)}</p>`;
    realizadoEl.innerHTML += `<p class="text-xl font-bold text-slate-900 tracking-tight" title="${cur}">${formatCurrency(t.paid, cur)}</p>`;

    const requestedHint = ex.requested > ex.approved
      ? `<p class="text-[10px] font-semibold text-slate-400 mt-0.5" title="${cur}">Total solicitado: ${formatCurrency(ex.requested, cur)}</p>`
      : "";
    extrasEl.innerHTML += `<div title="${cur}">
      <p class="text-xl font-bold text-slate-900 tracking-tight">${formatCurrency(ex.approved, cur)}</p>
      ${requestedHint}
    </div>`;

    if (totalsByCurrency[cur]) {
      totalPct += t.pctExecutado || 0;
      pctCount += 1;
    }
  });

  const avgPct = pctCount > 0 ? totalPct / pctCount : 0;
  const pct = Math.min(100, avgPct);
  document.getElementById("kpiPct").textContent = pct.toFixed(1) + "%";

  setTimeout(() => {
    const bar = document.getElementById("kpiBar");
    bar.style.width = pct + "%";
    bar.className = `prog-bar ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-[#2afc8d]"}`;
  }, 50);
}

// ── Previsto x Real (tabela de execução orçamental por CC) ─────────────────────
function renderPrevistoRealTable(summary) {
  const tbody = document.getElementById("dashPrevistoRealBody");
  if (!tbody) return;

  if (!summary?.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><p class="text-xs">Sem dados</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = summary.map((cc) => {
    const cur = cc.currency || "AOA";
    const pct = Math.min(100, Math.max(0, cc.pctExecutado || 0));
    const barColor = cc.overflow ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-500";
    return `
    <tr class="${cc.overflow ? "overflow-row" : ""}">
      <td class="font-semibold text-slate-900">${cc.name}</td>
      <td class="text-right tabular-nums font-bold ${cc.overflow ? "text-red-600" : "text-slate-900"}">${formatCurrency(cc.paid, cur)}</td>
      <td class="text-right tabular-nums font-medium text-slate-500">${formatCurrency(cc.basePrevisto ?? cc.budgeted ?? 0, cur)}</td>
      <td>
        <div class="flex items-center gap-2">
          <div class="prog-bar-wrap flex-1" style="min-width:80px">
            <div class="prog-bar ${barColor}" style="width:${pct}%"></div>
          </div>
          <span class="text-xs font-bold text-slate-600 w-12 text-right">${pct.toFixed(1)}%</span>
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ── CC Table ───────────────────────────────────────────────────────────────────
function renderCCTable() {
  const tbody = document.getElementById("ccTableBody");
  const countEl = document.getElementById("ccCount");
  countEl.textContent = `${costCenters.length} centro${costCenters.length !== 1 ? "s" : ""} registado${costCenters.length !== 1 ? "s" : ""}`;

  if (!costCenters.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <span class="material-symbols-outlined text-3xl">account_tree</span>
      <p class="text-sm font-semibold">Nenhum centro de custo criado</p>
      <p class="text-xs">Clica em "Novo CC" para criar o primeiro centro de custo.</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = costCenters.map((cc) => `
    <tr>
      <td class="font-bold text-slate-700">${cc.code}</td>
      <td class="font-semibold text-slate-900">${cc.name} <span class="text-xs text-slate-400 ml-1">(${cc.currency || "AOA"})</span></td>
      <td class="text-center">
        <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">${cc._count?.needs ?? 0}</span>
      </td>
      <td class="text-center">
        <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">${cc._count?.payments ?? 0}</span>
      </td>
      <td class="text-center">
        <span class="text-xs font-bold px-2.5 py-1 rounded-full ${cc.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}">
          ${cc.active ? "Ativo" : "Inativo"}
        </span>
      </td>
      <td class="text-center">
        <div class="flex justify-center gap-2">
          <button onclick="editCC('${cc.id}')"
            class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-100 hover:text-blue-600 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">edit</span>
          </button>
          <button onclick="deleteCC('${cc.id}', '${cc.name.replace(/'/g, "\\'")}')"
            class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

// ── Populate Selects ───────────────────────────────────────────────────────────
function populateCCSelects() {
  const opts = costCenters.map((cc) => `<option value="${cc.id}">${cc.code} — ${cc.name}</option>`).join("");
  ["needCC", "payCC"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = `<option value="">Selecionar...</option>${opts}`; }
  });
  // Filter dropdowns
  const filterOpts = `<option value="">Todos os CCs</option>` + costCenters.map((cc) =>
    `<option value="${cc.id}">${cc.code} — ${cc.name}</option>`).join("");
  ["needsCCFilter", "paysCCFilter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = filterOpts;
  });
}

async function loadNeeds() {
  if (!selectedProject) return;
  const ccId = document.getElementById("needsCCFilter").value;
  const status = document.getElementById("needsStatusFilter").value;
  const tbody = document.getElementById("needsTableBody");
  tbody.innerHTML = `<tr><td colspan="12"><div class="spinner my-8"></div></td></tr>`;

  try {
    const params = new URLSearchParams({ pageSize: "1000" });
    if (ccId) params.set("costCenterId", ccId);
    if (status) params.set("status", status);

    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/needs?${params}`);
    const items = (data.items || [])
      .slice()
      .sort((a, b) => new Date(a.createdAt || a.date || 0) - new Date(b.createdAt || b.date || 0))
      .map((item, index) => ({ ...item, _orderNumber: index + 1 }));

    cachedNeeds = items;

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><span class="material-symbols-outlined text-3xl">assignment</span><p class="text-sm font-semibold">Sem itens de orçamento registados</p></div></td></tr>`;
      return;
    }

    const priorityLabels = { ALTA: "Alta", MEDIA: "Média", BAIXA: "Baixa" };
    const statusLabels = { PENDING: "Pendente", IN_QUOTATION: "Em Cotação", ORDERED: "Encomenda", APPROVED: "Aprovado", REJECTED: "Rejeitado", PAID: "Pago" };
    const statusClasses = { PENDING: "badge-pending", IN_QUOTATION: "badge-in-quotation", ORDERED: "badge-ordered", APPROVED: "badge-approved", REJECTED: "badge-rejected", PAID: "badge-paid" };
    const prioClasses = { ALTA: "badge-alta", MEDIA: "badge-media", BAIXA: "badge-baixa" };

    // Grouping
    const grouped = {};
    let totalObraGeral = 0;
    let totalSemanaGeral = 0;

    items.forEach(n => {
      const ccName = n.costCenter?.name || "Sem Centro";
      if (!grouped[ccName]) {
        grouped[ccName] = { name: ccName, items: [], totalObra: 0, totalSemana: 0, currency: n.costCenter?.currency || "AOA" };
      }

      const qty = Number(n.quantity) || 0;
      const price = (n.status === "APPROVED" || n.status === "PAID") ? (Number(n.unitPrice) || 0) : 0;
      const hours = Number(n.hours) || 1;

      const totalObra = qty * price * hours;
      const totalSemana = totalObra / hours;

      n._calcTotalObra = totalObra;
      n._calcTotalSemana = totalSemana;

      grouped[ccName].totalObra += totalObra;
      grouped[ccName].totalSemana += totalSemana;
      grouped[ccName].items.push(n);

      totalObraGeral += totalObra;
      totalSemanaGeral += totalSemana;
    });

    const currency = items.length > 0 ? (items[0].costCenter?.currency || "AOA") : "AOA";

    let html = `
      <tr class="bg-emerald-600" style="background-color: #0f172a !important;">
        <td class="font-bold text-white text-sm" colspan="2">Total Geral</td>
        <td colspan="4"></td>
        <td class="text-right font-bold text-white text-sm">${formatCurrency(totalObraGeral, currency)}</td>
        <td class="text-right font-bold text-white text-sm">${formatCurrency(totalSemanaGeral, currency)}</td>
        <td colspan="4"></td>
        <td colspan="4"></td>
      </tr>
    `;

    let groupIndex = 0;
    for (const [ccName, group] of Object.entries(grouped)) {
      const groupId = `cc-group-${groupIndex++}`;
      html += `
        <tr class="bg-slate-100 border-t border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors" onclick="toggleCCGroup('${groupId}')">
          <td colspan="2" class="pl-4">
            <span id="${groupId}-icon" class="material-symbols-outlined text-slate-400 text-sm align-middle transition-transform duration-200">keyboard_arrow_down</span>
          </td>
          <td class="font-bold text-slate-800 uppercase text-xs" colspan="4">${ccName}</td>
          <td class="text-right font-bold text-slate-800 text-xs">${formatCurrency(group.totalObra, group.currency)}</td>
          <td class="text-right font-bold text-slate-800 text-xs">${formatCurrency(group.totalSemana, group.currency)}</td>
          <td colspan="4"></td>
        </tr>
      `;

      html += group.items.map((n) => {
        const qty = Number(n.quantity) || 0;
        const price = (n.status === "APPROVED" || n.status === "PAID") ? (Number(n.unitPrice) || 0) : 0;
        const hours = Number(n.hours) || 1;
        const totalObra = qty * price * hours;

        return `
        <tr class="${groupId}-item">
          <!--<td class="text-xs text-slate-500">${formatDateBR(n.date)}</td>
          <td><span class="text-xs font-bold text-slate-600">${n.costCenter?.code || "—"}</span> <span class="text-xs text-slate-400">${n.costCenter?.name || ""}</span></td>-->
          <td class="text-center"><span class="inline-flex min-w-8 h-7 items-center justify-center rounded-lg text-xs font-black text-slate-600 tabular-nums">${n._orderNumber}</span></td>
          <td class="font-medium text-slate-900 max-w-xs truncate">${n.description}</td>
          <td class="text-center text-sm font-medium text-slate-700">${n.unit || "—"}</td>
          <td class="text-center text-sm font-medium text-slate-700">${n.quantity ? Number(n.quantity).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—"}</td>
          <td class="text-right text-sm font-medium text-slate-700">${n.unitPrice ? Number(n.unitPrice).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—"}</td>
          <td class="text-center text-sm font-medium text-slate-700">${n.hours ? Number(n.hours).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—"}</td>
          <td class="text-right text-sm font-bold text-slate-900">${formatCurrency(totalObra, n.costCenter?.currency || "AOA")}</td>
          <td class="text-right text-sm font-bold text-slate-900">${formatCurrency(n._calcTotalSemana, n.costCenter?.currency || "AOA")}</td>
          <td class="text-center"><span class="text-xs font-bold px-2.5 py-1 rounded-full ${prioClasses[n.priority] || ""}">${priorityLabels[n.priority] || n.priority}</span></td>
          <td class="text-sm text-slate-500">${n.responsible || "—"}</td>
          <td class="text-center"><span class="text-xs font-bold px-2.5 py-1 rounded-full ${statusClasses[n.status] || "badge-pending"}">${statusLabels[n.status] || n.status}</span></td>
          <td class="text-center">
            <div class="flex justify-center gap-2">
              ${n.status === "PENDING" || n.status === "IN_QUOTATION" || n.status === "ORDERED" || n.status === "APPROVED" ? `
              <button onclick="openPrecificarModal('${n.id}', '${n.costCenterId}')" title="${n.status === "ORDERED" ? "Carregar proforma" : "Precificar / Selecionar fornecedor"}"
                class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-[#2afc8d]/20 hover:text-green-600 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">fact_check</span>
              </button>
              ` : ""}
              ${n.status === "APPROVED" && !n.scheduled ? `
              <button onclick="sendToCronograma('${n.id}', '${n.costCenterId}')" title="Enviar para Cronograma"
                class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-amber-100 hover:text-amber-600 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">schedule</span>
              </button>
              ` : ""}
              <button onclick="editNeed('${n.id}')" data-need-raw='${JSON.stringify(n).replace(/'/g, "&#39;")}'
                class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-amber-100 hover:text-amber-600 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">edit</span>
              </button>
              <button onclick="deleteNeed('${n.id}', '${n.description.substring(0, 30).replace(/'/g, "\\'")}')"
                class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">delete</span>
              </button>
            </div>
          </td>
        </tr>
      `;
      }).join("");
    }

    tbody.innerHTML = html;

    // pagination
    document.getElementById("needsPagination").textContent =
      `${items.length} itens no Orçamento Geral`;

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

// ── Payments Table ─────────────────────────────────────────────────────────────
async function loadPayments() {
  if (!selectedProject) return;
  const ccId = document.getElementById("paysCCFilter").value;
  const status = document.getElementById("paysStatusFilter").value;
  const tbody = document.getElementById("paysTableBody");
  tbody.innerHTML = `<tr><td colspan="11"><div class="spinner my-8"></div></td></tr>`;

  try {
    const params = new URLSearchParams({ pageSize: "30" });
    if (ccId) params.set("costCenterId", ccId);
    if (status) params.set("status", status);

    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/payments?${params}`);
    const items = (data.items || []).slice().sort((a, b) => {
      const da = new Date(a.paymentDate || 0).getTime();
      const db = new Date(b.paymentDate || 0).getTime();
      return da - db || String(a.docNumber || "").localeCompare(String(b.docNumber || ""));
    });
    const cur = selectedProject?.currency || "AOA";

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><span class="material-symbols-outlined text-3xl">receipt_long</span><p class="text-sm font-semibold">Sem lançamentos registados</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((p) => renderPaymentRowHtml(p, { allowEdit: true })).join("");

    document.getElementById("paysPagination").textContent =
      `${items.length} de ${data.total || items.length} lançamentos`;

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

// ── Tabs ───────────────────────────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll(".cc-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".cc-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
  if (tabName === "necessidades") loadNeeds();
  if (tabName === "lancamentos") loadPayments();
  if (tabName === "cronograma") loadCronograma();
  if (tabName === "fundomaneio") loadFunds();
  if (tabName === "extras") loadExtras();
  if (tabName === "pendentes") {
    currentTxStatus = "PENDING";
    txPage = 1;
    loadTransactions();
  }
  if (tabName === "historico") {
    historyPage = 1;
    loadHistory();
  }
}

// ── Cronograma Functions ───────────────────────────────────────────────────────
let cronogramaViewMode = "list";
let cronogramaPendingNeeds = [];

function getCronogramaFilters() {
  const params = new URLSearchParams();
  const status = document.getElementById("cronogramaStatusFilter")?.value;
  const search = document.getElementById("cronogramaSearch")?.value?.trim();
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  if (status === "CONFIRMADO") params.set("includePaid", "true");
  return params;
}

async function loadCronograma() {
  if (!selectedProject) return;
  const tbody = document.getElementById("cronogramaTableBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="spinner my-8"></div></td></tr>`;

  try {
    const [needsData, timelineData] = await Promise.all([
      apiRequest(`/cost-centers/project/${selectedProject.id}/needs?pageSize=500&scheduled=true`),
      apiRequest(`/cost-centers/project/${selectedProject.id}/payments/timeline?${getCronogramaFilters()}`),
    ]);

    const items = needsData.items || [];
    cronogramaPendingNeeds = items.filter((n) => !n._count || n._count.payments === 0);

    renderCronogramaList(timelineData.days);

    if (cronogramaViewMode === "calendar") loadCronogramaCalendar();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

// ── Cronograma · Vista Calendário ───────────────────────────────────────────────
let cronogramaCalendarDate = new Date();
cronogramaCalendarDate.setDate(1);
let cronogramaCalendarDayMap = new Map();

window.shiftCronogramaCalendarMonth = function (delta) {
  cronogramaCalendarDate.setMonth(cronogramaCalendarDate.getMonth() + delta);
  loadCronogramaCalendar();
};

window.goToCurrentCronogramaMonth = function () {
  cronogramaCalendarDate = new Date();
  cronogramaCalendarDate.setDate(1);
  loadCronogramaCalendar();
};

async function loadCronogramaCalendar() {
  if (!selectedProject) return;
  const body = document.getElementById("cronogramaCalendarBody");
  const label = document.getElementById("calMonthLabel");
  if (label) {
    label.textContent = cronogramaCalendarDate.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  }
  if (body) body.innerHTML = `<div class="spinner my-8"></div>`;

  const year = cronogramaCalendarDate.getFullYear();
  const month = cronogramaCalendarDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysPast = Math.max(0, Math.ceil((today - firstOfMonth) / 86400000));
  const daysAhead = Math.max(7, Math.ceil((lastOfMonth - today) / 86400000));

  try {
    const params = getCronogramaFilters();
    params.set("onlyVisible", "false");
    params.set("includePaid", "true");
    params.set("daysPast", String(daysPast));
    params.set("daysAhead", String(daysAhead));

    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/payments/timeline?${params}`);
    renderCronogramaCalendar(data.days, firstOfMonth, lastOfMonth);
  } catch (err) {
    if (body) body.innerHTML = `<p class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</p>`;
  }
}

// Estado dominante do dia quando há vários pagamentos: mostra sempre o mais urgente.
const CRONOGRAMA_STATUS_PRIORITY = ["VENCIDO", "PENDENTE", "PAGO", "CANCELADO"];

const CRONOGRAMA_DAY_COLORS = {
  VENCIDO: "bg-red-100 border-red-200",
  PENDENTE: "bg-blue-100 border-blue-200",
  PAGO: "bg-emerald-100 border-emerald-200",
  CANCELADO: "bg-slate-100 border-slate-200",
};

function getDayDominantStatus(dayData) {
  const statuses = new Set((dayData?.items || []).map((p) => p.timelineStatus));
  return CRONOGRAMA_STATUS_PRIORITY.find((s) => statuses.has(s)) || null;
}

function renderCronogramaCalendarLegend() {
  return `
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 px-1">
      ${CRONOGRAMA_STATUS_PRIORITY.map((status) => `
        <div class="flex items-center gap-1.5">
          <span class="w-2.5 h-2.5 rounded-full ${TIMELINE_STATUS[status].dot}"></span>
          <span class="text-[10px] font-bold text-slate-500">${TIMELINE_STATUS[status].label}</span>
        </div>
      `).join("")}
    </div>`;
}

function renderCronogramaCalendar(days, firstOfMonth, lastOfMonth) {
  const body = document.getElementById("cronogramaCalendarBody");
  if (!body) return;

  const dayMap = new Map();
  (days || []).forEach((d) => {
    const key = new Date(d.date).toDateString();
    dayMap.set(key, d);
  });

  const weekdayNames = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const header = weekdayNames.map((w) => `
    <div class="text-center text-[11px] font-black uppercase tracking-wide text-slate-500 py-2 bg-slate-50 border border-slate-100">${w}</div>
  `).join("");

  const cells = [];
  const leadingBlanks = firstOfMonth.getDay();
  for (let i = 0; i < leadingBlanks; i++) {
    cells.push(`<div class="border border-transparent min-h-[92px]"></div>`);
  }

  const totalDays = lastOfMonth.getDate();
  const todayKey = new Date().toDateString();
  for (let d = 1; d <= totalDays; d++) {
    const cellDate = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), d);
    const key = cellDate.toDateString();
    const dayData = dayMap.get(key);
    const hasPayments = Boolean(dayData?.items?.length);
    const isToday = key === todayKey;
    const cur = dayData?.currency === "MIXED" ? "AOA" : (dayData?.currency || "AOA");

    const dominantStatus = hasPayments ? getDayDominantStatus(dayData) : null;
    const bgClass = dominantStatus ? CRONOGRAMA_DAY_COLORS[dominantStatus] : "bg-white border-slate-100";
    const ringClass = isToday ? "ring-2 ring-emerald-500 ring-inset" : "";

    const statusMeta = dominantStatus ? TIMELINE_STATUS[dominantStatus] : null;
    const statusBadge = statusMeta ? `
      <span class="inline-flex items-center gap-1 mt-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${statusMeta.badge}">
        <span class="w-1.5 h-1.5 rounded-full ${statusMeta.dot}"></span>${statusMeta.label}
      </span>` : "";

    const valueHtml = hasPayments ? `
      <p class="text-[10px] font-bold text-slate-600 mt-1 leading-tight">Valor a pagar:</p>
      <p class="text-xs font-black text-slate-900 leading-tight">${formatCurrency(dayData.totalBudgeted, cur)}</p>
      ${statusBadge}
    ` : "";

    cells.push(`
      <button type="button" ${hasPayments ? `onclick="openCronogramaDayDetails('${key}')"` : ""}
        class="min-h-[92px] p-2 text-left border ${bgClass} ${ringClass} flex flex-col ${hasPayments ? "cursor-pointer hover:brightness-95" : "cursor-default"} transition-all">
        <span class="text-xs font-black text-slate-700">${String(d).padStart(2, "0")}</span>
        ${valueHtml}
      </button>
    `);
  }

  body.innerHTML = `
    ${renderCronogramaCalendarLegend()}
    <div class="grid grid-cols-7 gap-px bg-slate-100 border border-slate-100 rounded-xl overflow-hidden">
      ${header}
      ${cells.join("")}
    </div>
  `;

  cronogramaCalendarDayMap = dayMap;
}

window.openCronogramaDayDetails = function (dayKey) {
  const dayData = cronogramaCalendarDayMap.get(dayKey);
  if (!dayData?.items?.length) return;
  if (dayData.items.length === 1) {
    openPaymentAside(dayData.items[0], "VIEW");
    return;
  }
  openCronogramaDayListModal(dayKey, dayData);
};

function openCronogramaDayListModal(dayKey, dayData) {
  const label = document.getElementById("cronogramaDayLabel");
  const body = document.getElementById("cronogramaDayListBody");
  if (label) label.textContent = `${formatTimelineDayLabel(dayKey)} · ${dayData.items.length} pagamento(s)`;

  if (body) {
    body.innerHTML = dayData.items.map((p) => {
      const meta = TIMELINE_STATUS[p.timelineStatus] || TIMELINE_STATUS.PENDENTE;
      const cur = p.costCenter?.currency || "AOA";
      return `
        <button type="button" onclick="openCronogramaDayItem('${dayKey}', '${p.id}')"
          class="w-full text-left flex items-center gap-3 p-3 rounded-xl border ${meta.border} bg-white hover:bg-slate-50 transition-colors">
          <div class="w-2 h-2 rounded-full shrink-0 ${meta.dot}"></div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-900 truncate">${(p.description || "—").replace(/</g, "&lt;")}</p>
            <p class="text-[10px] text-slate-500 truncate">${(p.supplier || "Sem fornecedor").replace(/</g, "&lt;")} · ${p.costCenter?.code || "—"}</p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-sm font-bold text-slate-900 tabular-nums">${formatCurrency(p.budgetedAmount, cur)}</p>
            <span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${meta.badge}">${meta.label}</span>
          </div>
        </button>`;
    }).join("");
  }

  document.getElementById("modalCronogramaDay").classList.add("open");
}

window.openCronogramaDayItem = function (dayKey, paymentId) {
  const dayData = cronogramaCalendarDayMap.get(dayKey);
  const payment = dayData?.items?.find((p) => p.id === paymentId);
  document.getElementById("modalCronogramaDay").classList.remove("open");
  if (payment) openPaymentAside(payment, "VIEW");
};

function renderCronogramaList(days) {
  const tbody = document.getElementById("cronogramaTableBody");
  if (!tbody) return;

  const needRows = cronogramaPendingNeeds.map((n) => {
    const qty = Number(n.quantity) || 0;
    const price = (n.status === "APPROVED" || n.status === "PAID") ? (Number(n.unitPrice) || 0) : 0;
    const hours = Number(n.hours) || 1;
    const totalObra = qty * price * hours;
    const currency = n.costCenter?.currency || "AOA";
    return `
      <tr class="bg-amber-50/30">
        <td class="text-xs font-bold text-amber-600 w-28">A definir</td>
        <td class="font-medium text-slate-900 max-w-xs truncate" title="${n.description.replace(/"/g, "&quot;")}">${n.description}</td>
        <td class="text-sm text-slate-500">${n.costCenter?.code || "—"} · ${n.costCenter?.name || ""}</td>
        <td class="text-right text-sm font-bold text-slate-900">${formatCurrency(totalObra, currency)}</td>
        <td class="text-center"><span class="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">Aguardar parcelamento</span></td>
        <td class="text-center">
          <button onclick="openCronogramaModal('${n.id}', '${n.costCenterId}', '${n.description.replace(/'/g, "\\'")}', ${totalObra}, '${currency}')" title="Definir Cronograma"
            class="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center hover:bg-amber-200 text-amber-600 border border-amber-200">
            <span class="material-symbols-outlined text-base">calendar_month</span>
          </button>
        </td>
      </tr>`;
  }).join("");

  const paymentRows = renderGroupedListRows(days);

  if (!needRows && !paymentRows) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="material-symbols-outlined text-3xl">schedule</span><p class="text-sm font-semibold">Nenhum item ou pagamento agendado</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = needRows + paymentRows;
}

let currentCronogramaTotal = 0;

window.openCronogramaModal = function (needId, ccId, description, total, currency = "AOA") {
  currentCronogramaTotal = total;
  document.getElementById("cronogramaNeedId").value = needId;
  document.getElementById("cronogramaCCId").value = ccId;
  document.getElementById("cronogramaItemDesc").textContent = description;
  document.getElementById("cronogramaTotalValue").textContent = formatCurrency(total, currency);
  document.getElementById("cronogramaNumParcelas").value = 1;
  document.getElementById("cronogramaParcelasBody").innerHTML = "";
  gerarParcelasAutomaticas();
  document.getElementById("modalCronograma").classList.add("open");
}

window.gerarParcelasAutomaticas = function () {
  const numParcelas = parseInt(document.getElementById("cronogramaNumParcelas").value) || 1;
  const tbody = document.getElementById("cronogramaParcelasBody");
  tbody.innerHTML = "";

  const valorParcela = currentCronogramaTotal / numParcelas;
  const percentParcela = 100 / numParcelas;

  let currentDate = new Date();
  for (let i = 1; i <= numParcelas; i++) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-100';
    tr.innerHTML = `
      <td class="py-2 px-2 text-center text-sm font-bold text-slate-700">${i}</td>
      <td class="py-2 px-2">
        <input type="date" required value="${dateStr}" class="parcela-data w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50">
      </td>
      <td class="py-2 px-2 text-right">
        <input type="number" step="0.01" min="0" max="100" value="${percentParcela.toFixed(2)}" class="parcela-percent w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50 text-right">
      </td>
      <td class="py-2 px-2 text-right">
        <input type="number" step="0.01" min="0" value="${valorParcela.toFixed(2)}" required class="parcela-valor w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50 text-right">
      </td>
      <td class="py-2 px-2 text-center">
        <button type="button" onclick="this.closest('tr').remove()" class="w-7 h-7 rounded bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-colors">
          <span class="material-symbols-outlined text-[14px]">close</span>
        </button>
      </td>
    `;
    tbody.appendChild(tr);

    // Add event listeners for percent/value changes
    const percentInput = tr.querySelector('.parcela-percent');
    const valorInput = tr.querySelector('.parcela-valor');

    percentInput.addEventListener('input', () => {
      const percent = parseFloat(percentInput.value) || 0;
      valorInput.value = ((percent / 100) * currentCronogramaTotal).toFixed(2);
    });

    valorInput.addEventListener('input', () => {
      const valor = parseFloat(valorInput.value) || 0;
      percentInput.value = ((valor / currentCronogramaTotal) * 100).toFixed(2);
    });

    // Add 30 days for next installment
    currentDate.setDate(currentDate.getDate() + 30);
  }
}

async function submitCronograma(e) {
  e.preventDefault();
  const needId = document.getElementById("cronogramaNeedId").value;
  const ccId = document.getElementById("cronogramaCCId").value;
  const paymentType = document.getElementById("cronogramaPaymentType").value;
  const parcelasRows = document.querySelectorAll("#cronogramaParcelasBody tr");

  if (parcelasRows.length === 0) {
    showToast("Adiciona pelo menos uma parcela", "error");
    return;
  }

  try {
    const installments = Array.from(parcelasRows).map((row, index) => {
      const dataInput = row.querySelector('.parcela-data');
      const valorInput = row.querySelector('.parcela-valor');
      return {
        paymentDate: dataInput.value,
        amount: valorInput.value,
        installment: index + 1
      };
    });

    await apiRequest(`/cost-centers/${ccId}/needs/${needId}/generate-installments`, {
      method: "POST",
      body: { paymentType, installments }
    });

    showToast("Lançamentos gerados com sucesso!", "success");
    document.getElementById("modalCronograma").classList.remove("open");
    await Promise.all([loadCronograma(), loadPayments(), loadSummary()]);
    switchTab("pendentes");
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}



// ── Form Cronograma Edition ──────────────────────────────────────────────────
window.editCronograma = function (pay) {
  if (typeof pay === "string") pay = JSON.parse(pay);
  openPayModal(pay);
  document.getElementById("modalPayTitle").textContent = "Editar Parcela do Cronograma";
}

window.toggleCronogramaView = function (view) {
  cronogramaViewMode = view;
  const btnList = document.getElementById("btnViewList");
  const btnCalendar = document.getElementById("btnViewCalendar");
  const listContainer = document.getElementById("cronogramaListContainer");
  const calendarContainer = document.getElementById("cronogramaCalendarContainer");

  const activeClass = "flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all bg-white text-slate-900 shadow-sm";
  const inactiveClass = "flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500 hover:text-slate-900";

  if (view === "list") {
    btnList.className = activeClass;
    btnCalendar.className = inactiveClass;
    listContainer.classList.remove("hidden");
    calendarContainer.classList.add("hidden");
  } else {
    btnCalendar.className = activeClass;
    btnList.className = inactiveClass;
    listContainer.classList.add("hidden");
    calendarContainer.classList.remove("hidden");
    loadCronogramaCalendar();
  }
};

// ── Send to Cronograma Functions ────────────────────────────────────────────────
window.sendToCronograma = async function (id, ccId) {
  try {
    showToast("A enviar para cronograma...", "info");
    await apiRequest(`/cost-centers/${ccId}/needs/${id}/schedule`, { method: "POST" });
    showToast("Item enviado para cronograma!", "success");
    loadNeeds();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

window.sendAllToCronograma = async function () {
  if (!selectedProject) return;
  try {
    // First load all approved needs to get their IDs
    const params = new URLSearchParams({ pageSize: "100", status: "APPROVED" });
    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/needs?${params}`);
    const items = data.items || [];

    if (!items.length) {
      showToast("Nenhum item aprovado para enviar", "info");
      return;
    }

    const needIds = items.filter(n => !n.scheduled).map(n => n.id);

    if (needIds.length === 0) {
      showToast("Todos os itens aprovados já estão no cronograma", "info");
      return;
    }

    if (!confirm(`Enviar ${needIds.length} item(ns) para o cronograma?`)) return;

    showToast("A enviar items para cronograma...", "info");
    await apiRequest(`/cost-centers/project/${selectedProject.id}/needs/schedule-bulk`, {
      method: "POST",
      body: { needIds }
    });

    showToast(`${needIds.length} item(ns) enviados para cronograma!`, "success");
    loadNeeds();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

// ── Bind Events ────────────────────────────────────────────────────────────────
function bindEvents() {
  // Tab navigation
  document.querySelectorAll(".cc-tab-btn").forEach((btn) =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );

  // Project search
  document.getElementById("projSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    renderProjectList(allProjects.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q)
    ));
  });

  // New CC button
  document.getElementById("newCCBtn").addEventListener("click", () => openCCModal());

  // New Need button
  document.getElementById("newNeedBtn").addEventListener("click", () => openNeedModal());

  // Import Excel button
  document.getElementById("importExcelBtn").addEventListener("click", () => openImportModal());

  // New Payment button
  document.getElementById("newPayBtn").addEventListener("click", () => openPayModal());

  document.getElementById("paySupplier")?.addEventListener("input", resolvePaySupplierFromText);

  document.getElementById("globalProjFilter")?.addEventListener("change", loadGlobalPaymentTimeline);

  let globalTimelineSearchTimer;
  document.getElementById("globalTimelineSearch")?.addEventListener("input", () => {
    clearTimeout(globalTimelineSearchTimer);
    globalTimelineSearchTimer = setTimeout(loadGlobalPaymentTimeline, 300);
  });
  document.getElementById("globalTimelineStatus")?.addEventListener("change", loadGlobalPaymentTimeline);

  let cronogramaSearchTimer;
  document.getElementById("cronogramaSearch")?.addEventListener("input", () => {
    clearTimeout(cronogramaSearchTimer);
    cronogramaSearchTimer = setTimeout(loadCronograma, 300);
  });
  document.getElementById("cronogramaStatusFilter")?.addEventListener("change", loadCronograma);

  // Filters
  ["needsCCFilter", "needsStatusFilter"].forEach((id) =>
    document.getElementById(id).addEventListener("change", loadNeeds)
  );
  ["paysCCFilter", "paysStatusFilter"].forEach((id) =>
    document.getElementById(id).addEventListener("change", loadPayments)
  );

  // Transaction filters (tabs are now separate — no segmented controls needed)
  document.getElementById("txCategoryFilter")?.addEventListener("change", () => { txPage = 1; loadTransactions(); });
  document.getElementById("historyCategoryFilter")?.addEventListener("change", () => { historyPage = 1; loadHistory(); });

  // Forms
  document.getElementById("formCC").addEventListener("submit", submitCC);
  document.getElementById("formNeed").addEventListener("submit", submitNeed);
  document.getElementById("formPay").addEventListener("submit", submitPay);

  // Fundo de Maneio
  document.getElementById("newFundBtn")?.addEventListener("click", () => {
    document.getElementById("formFund").reset();
    document.getElementById("fundCurrency").value = "AOA";
    document.getElementById("modalFund").classList.add("open");
  });
  document.getElementById("formFund")?.addEventListener("submit", submitFund);
  document.getElementById("fundReloadBtn")?.addEventListener("click", () => openFundMovementModal());
  document.getElementById("formFundMovement")?.addEventListener("submit", submitFundMovement);
  document.getElementById("fundAddCardBtn")?.addEventListener("click", () => openFundCardModal());
  document.getElementById("formFundCard")?.addEventListener("submit", submitFundCard);

  // Pedidos Extra
  document.getElementById("newExtraBtn")?.addEventListener("click", () => openExtraModal("OBRA"));
  document.getElementById("newGlobalExtraBtn")?.addEventListener("click", () => openExtraModal("GERAL"));
  document.getElementById("formExtra")?.addEventListener("submit", submitExtra);
  document.getElementById("extraSource")?.addEventListener("change", toggleExtraFundRow);
  document.getElementById("extraFundId")?.addEventListener("change", populateExtraCardOptions);
  document.getElementById("extrasStatusFilter")?.addEventListener("change", loadExtras);
  document.getElementById("globalExtrasStatusFilter")?.addEventListener("change", loadGlobalExtras);
  document.getElementById("formAddQuote")?.addEventListener("submit", (e) =>
    submitQuoteForm(e, {
      apiRequest,
      apiUpload,
      showToast,
      suppliers: currentSuppliers,
      openProformaViewer: window.openProformaViewer,
    })
  );
  document.getElementById("formCronograma").addEventListener("submit", submitCronograma);

  // Close modals on overlay click
  ["modalCC", "modalNeed", "modalPay", "modalLiq", "modalCronograma", "modalImportExcel", "modalQuote"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (e) => {
      if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
    });
  });

  // Transaction form
  document.getElementById("formLiq").addEventListener("submit", submitLiquidation);
}

// ── CC Modal ───────────────────────────────────────────────────────────────────
function openCCModal(cc = null) {
  document.getElementById("modalCCTitle").textContent = cc ? "Editar Centro de Custo" : "Novo Centro de Custo";
  document.getElementById("ccId").value = cc?.id || "";
  document.getElementById("ccCode").value = cc?.code || "";
  document.getElementById("ccName").value = cc?.name || "";
  document.getElementById("ccCurrency").value = cc?.currency || "AOA";
  document.getElementById("ccActive").value = cc?.active !== false ? "true" : "false";
  document.getElementById("modalCC").classList.add("open");
}

window.editCC = function (id) {
  const cc = costCenters.find((x) => x.id === id);
  if (cc) openCCModal(cc);
};

window.deleteCC = async function (id, name) {
  if (!confirm(`Eliminar "${name}"?\nTodos os dados associados serão perdidos.`)) return;
  try {
    await apiRequest(`/cost-centers/${id}`, { method: "DELETE" });
    showToast("Centro de custo eliminado", "success");
    await Promise.all([loadCostCenters(), loadSummary()]);
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
};

async function submitCC(e) {
  e.preventDefault();
  const id = document.getElementById("ccId").value;
  const body = {
    code: document.getElementById("ccCode").value.trim(),
    name: document.getElementById("ccName").value.trim(),
    currency: document.getElementById("ccCurrency").value,
    active: document.getElementById("ccActive").value === "true",
  };
  try {
    if (id) {
      await apiRequest(`/cost-centers/${id}`, { method: "PATCH", body });
      showToast("Centro de custo actualizado", "success");
    } else {
      await apiRequest(`/cost-centers/project/${selectedProject.id}`, { method: "POST", body });
      showToast("Centro de custo criado", "success");
    }
    document.getElementById("modalCC").classList.remove("open");
    await Promise.all([loadCostCenters(), loadSummary()]);
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

// ── Need Modal ─────────────────────────────────────────────────────────────────
async function openNeedModal(need = null) {
  document.getElementById("modalNeedTitle").textContent = need ? "Editar Item de Orçamento" : "Novo Item de Orçamento";
  document.getElementById("needId").value = need?.id || "";
  document.getElementById("needCC").value = need?.costCenterId || "";

  // Carregar lista de operadores/admins
  const respSel = document.getElementById("needResponsibleId");
  respSel.innerHTML = `<option value="">A carregar...</option>`;
  try {
    const data = await apiRequest("/users/receivers");
    const ops = data.items || [];
    respSel.innerHTML = `<option value="">Selecionar operador...</option>` +
      ops.map(u => {
        const label = u.name || u.email;
        const selected = need?.responsible === label ? "selected" : "";
        return `<option value="${u.id}" data-name="${label}" ${selected}>${label}</option>`;
      }).join("");
  } catch {
    respSel.innerHTML = `<option value="">Erro ao carregar...</option>`;
  }

  const tbody = document.getElementById("needItemsBody");
  tbody.innerHTML = "";

  addNeedRow(need || null);

  document.getElementById("modalNeed").classList.add("open");
}

window.addNeedRow = function (need = null) {
  const tbody = document.getElementById("needItemsBody");
  const tr = document.createElement("tr");
  tr.className = "border-b border-slate-100 need-item-row";

  tr.innerHTML = `
    <td class="py-2 px-1">
      <textarea rows="1" required placeholder="Ex: Serviço Electrificação" class="row-desc w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50 resize-none">${need?.description || ""}</textarea>
    </td>
    <td class="py-2 px-1">
      <input type="text" placeholder="un" value="${need?.unit || ""}" class="row-unit w-full h-8 px-2 bg-slate-50 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50">
    </td>
    <td class="py-2 px-1">
      <input type="number" step="0.01" placeholder="0.00" value="${need?.quantity || ""}" class="row-qty w-full h-8 px-2 bg-slate-50 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50">
    </td>
    <td class="py-2 px-1">
      <input type="number" step="0.01" placeholder="0.00" value="${need?.unitPrice || ""}" class="row-price w-full h-8 px-2 bg-slate-50 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50">
    </td>
    <td class="py-2 px-1">
      <input type="number" step="0.01" placeholder="1.0" value="${need?.hours || ""}" class="row-hours w-full h-8 px-2 bg-slate-50 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50">
    </td>
    <td class="py-2 px-1">
      <select class="row-priority w-full h-8 px-1 bg-slate-50 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50">
        <option value="ALTA" ${need?.priority === 'ALTA' ? 'selected' : ''}>Alta</option>
        <option value="MEDIA" ${(!need || need?.priority === 'MEDIA') ? 'selected' : ''}>Média</option>
        <option value="BAIXA" ${need?.priority === 'BAIXA' ? 'selected' : ''}>Baixa</option>
      </select>
    </td>
    <td class="py-2 px-1">
      <select class="row-status w-full h-8 px-1 bg-slate-50 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50">
        <option value="PENDING" ${(!need || need?.status === 'PENDING') ? 'selected' : ''}>Pendente</option>
        <option value="IN_QUOTATION" ${need?.status === 'IN_QUOTATION' ? 'selected' : ''}>Em Cotação</option>
        <option value="ORDERED" ${need?.status === 'ORDERED' ? 'selected' : ''}>Encomenda</option>
        <option value="APPROVED" ${need?.status === 'APPROVED' ? 'selected' : ''}>Aprovado</option>
        <option value="REJECTED" ${need?.status === 'REJECTED' ? 'selected' : ''}>Rejeitado</option>
        <option value="PAID" ${need?.status === 'PAID' ? 'selected' : ''}>Pago</option>
      </select>
    </td>
    <td class="py-2 px-1">
      <textarea rows="1" placeholder="Obs..." class="row-notes w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50 resize-none">${need?.notes || ""}</textarea>
    </td>
    <td class="py-2 px-1 text-center">
      <button type="button" onclick="this.closest('tr').remove()" class="w-7 h-7 rounded bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-colors">
        <span class="material-symbols-outlined text-[14px]">close</span>
      </button>
    </td>
  `;
  tbody.appendChild(tr);
};

window.editNeed = function (id) {
  const btn = document.querySelector(`[onclick="editNeed('${id}')"]`);
  if (!btn) return;
  try {
    const raw = btn.getAttribute("data-need-raw");
    const need = JSON.parse(raw);
    openNeedModal(need);
  } catch { }
};

window.deleteNeed = async function (id, desc) {
  if (!confirm(`Eliminar necessidade "${desc}..."?`)) return;
  try {
    await apiRequest(`/cost-centers/X/needs/${id}`, { method: "DELETE" });
    showToast("Item eliminado", "success");
    loadNeeds();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
};

async function submitNeed(e) {
  e.preventDefault();
  const id = document.getElementById("needId").value;
  const ccId = document.getElementById("needCC").value;
  if (!ccId) { showToast("Seleciona um Centro de Custo", "error"); return; }

  const respSel = document.getElementById("needResponsibleId");
  const responsibleName = respSel.options[respSel.selectedIndex]?.getAttribute("data-name") || null;
  if (!respSel.value) { showToast("Seleciona um Responsável (Operador)", "error"); return; }

  const rows = document.querySelectorAll(".need-item-row");
  if (rows.length === 0) { showToast("Adiciona pelo menos um item", "error"); return; }

  try {
    const promises = Array.from(rows).map(row => {
      const body = {
        costCenterId: ccId,
        description: row.querySelector(".row-desc").value.trim(),
        quantity: row.querySelector(".row-qty").value || null,
        unit: row.querySelector(".row-unit").value.trim() || null,
        unitPrice: row.querySelector(".row-price").value || null,
        hours: row.querySelector(".row-hours").value || null,
        priority: row.querySelector(".row-priority").value,
        status: row.querySelector(".row-status").value,
        responsible: responsibleName,
        notes: row.querySelector(".row-notes").value.trim() || null,
      };

      if (id && rows.length === 1) {
        return apiRequest(`/cost-centers/${ccId}/needs/${id}`, { method: "PATCH", body });
      } else {
        return apiRequest(`/cost-centers/${ccId}/needs`, { method: "POST", body });
      }
    });

    await Promise.all(promises);

    showToast(id && rows.length === 1 ? "Item actualizado" : `${rows.length} item(ns) adicionado(s)`, "success");
    document.getElementById("modalNeed").classList.remove("open");
    loadNeeds();
    loadSummary();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

window.openPrecificarModal = async function (needId, ccId) {
  let need = cachedNeeds.find((n) => n.id === needId);
  if (!need) {
    showToast("Item não encontrado. Recarregue a lista.", "error");
    return;
  }

  try {
    if (need.status === "PENDING") {
      await apiRequest(`/cost-centers/${ccId}/needs/${needId}`, {
        method: "PATCH",
        body: { status: "IN_QUOTATION" },
      });
      need = { ...need, status: "IN_QUOTATION" };
      cachedNeeds = cachedNeeds.map((n) => (n.id === needId ? need : n));
    }

    if (!currentSuppliers.length) {
      const data = await apiRequest("/suppliers");
      currentSuppliers = data.items || [];
    }

    need.project = selectedProject
      ? { id: selectedProject.id, name: selectedProject.name, code: selectedProject.code }
      : need.project;

    window.onQuoteApproved = async () => {
      await loadNeeds();
      await loadSummary();
    };
    window.showQuoteToast = showToast;

    await openQuotePricingModal({
      need,
      suppliers: currentSuppliers,
      apiRequest,
      openProformaViewer: window.openProformaViewer,
    });
  } catch (err) {
    showToast("Erro ao abrir precificação: " + err.message, "error");
  }
};

window.openProformaViewer = function (url) {
  const iframe = document.getElementById("sideViewerIframe");
  const loading = document.getElementById("sideViewerLoading");
  const downloadBtn = document.getElementById("sideViewerDownloadBtn");
  if (!iframe) return window.open(url, "_blank");
  iframe.classList.add("hidden");
  if (loading) loading.style.display = "flex";
  iframe.src = url;
  if (downloadBtn) downloadBtn.href = url;
  document.getElementById("sideViewerOverlay")?.classList.remove("opacity-0", "pointer-events-none");
  const panel = document.getElementById("sideViewerPanel");
  if (panel) panel.style.transform = "translateX(0)";
};

window.closeProformaViewer = function () {
  document.getElementById("sideViewerOverlay")?.classList.add("opacity-0", "pointer-events-none");
  const panel = document.getElementById("sideViewerPanel");
  if (panel) panel.style.transform = "translateX(100%)";
  setTimeout(() => {
    const iframe = document.getElementById("sideViewerIframe");
    if (iframe) iframe.src = "";
  }, 300);
};

window.sendAllToQuotation = async function () {
  if (!confirm("Enviar todos os itens pendentes para Cotação?")) return;
  try {
    showToast("A carregar itens...", "info");
    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/needs?pageSize=1000`);
    const pendingItems = (data.items || []).filter(n => n.status === "PENDING");

    if (pendingItems.length === 0) {
      showToast("Não há itens pendentes.", "warning");
      return;
    }

    showToast(`A enviar ${pendingItems.length} itens...`, "info");
    const promises = pendingItems.map(n =>
      apiRequest(`/cost-centers/${n.costCenterId}/needs/${n.id}`, {
        method: "PATCH",
        body: { status: "IN_QUOTATION" }
      })
    );

    await Promise.all(promises);

    window.location.href = `../Projectos/Cotacao/index.html?project=${selectedProject.id}`;
  } catch (err) {
    showToast("Erro ao preparar cotações em lote: " + err.message, "error");
  }
};

// ── Pay Modal ──────────────────────────────────────────────────────────────────

// Fase 4: relação explícita Custo ↔ Pagamento ↔ Fornecedor. O campo de texto
// "Fornecedor" permanece livre (retrocompatibilidade), mas quando o nome
// corresponde a um fornecedor registado, associamos o supplierId (FK).
async function ensureSuppliersLoadedForPay() {
  if (!currentSuppliers.length) {
    try {
      const data = await apiRequest("/suppliers");
      currentSuppliers = data.items || [];
    } catch (err) {
      console.error("Erro ao carregar fornecedores:", err);
    }
  }
  const datalist = document.getElementById("paySupplierDatalist");
  if (datalist) {
    datalist.innerHTML = currentSuppliers
      .map((s) => `<option value="${(s.name || "").replace(/"/g, "&quot;")}"></option>`)
      .join("");
  }
}

function resolvePaySupplierFromText() {
  const input = document.getElementById("paySupplier");
  const hiddenId = document.getElementById("paySupplierId");
  const hint = document.getElementById("paySupplierHint");
  const name = (input?.value || "").trim().toLowerCase();
  const match = name ? currentSuppliers.find((s) => (s.name || "").trim().toLowerCase() === name) : null;
  if (hiddenId) hiddenId.value = match ? match.id : "";
  if (hint) hint.classList.toggle("hidden", !match);
}

async function openPayModal(pay = null) {
  document.getElementById("modalPayTitle").textContent = pay ? "Editar Lançamento" : "Novo Lançamento";
  document.getElementById("payId").value = pay?.id || "";
  document.getElementById("payCCId").value = pay?.costCenterId || "";
  document.getElementById("payCC").value = pay?.costCenterId || "";
  document.getElementById("payDoc").value = pay?.docNumber || "";
  document.getElementById("payDate").value = pay?.paymentDate ? pay.paymentDate.substring(0, 10) : new Date().toISOString().substring(0, 10);
  document.getElementById("paySupplier").value = pay?.supplierName || pay?.supplier || "";
  document.getElementById("paySupplierId").value = pay?.supplierId || "";
  document.getElementById("payDesc").value = pay?.description || "";
  document.getElementById("payCat").value = pay?.category || "MATERIAL";
  document.getElementById("payType").value = pay?.paymentType || "PRONTO_PAGAMENTO";
  document.getElementById("payBudgeted").value = pay?.budgetedAmount || "";
  document.getElementById("payPaid").value = pay?.paidAmount || "";
  document.getElementById("payMethod").value = pay?.paymentMethod || "";
  document.getElementById("payWeek").value = pay?.week || "";
  document.getElementById("payStatus").value = pay?.status || "PENDENTE";
  document.getElementById("payNotes").value = pay?.notes || "";
  document.getElementById("modalPay").classList.add("open");

  await ensureSuppliersLoadedForPay();
  resolvePaySupplierFromText();
}

window.editPay = function (pay) {
  if (typeof pay === "string") pay = JSON.parse(pay);
  openPayModal(pay);
};

window.deletePay = async function (id, ccId) {
  if (!confirm("Eliminar este lançamento?")) return;
  try {
    let costCenterId = ccId;
    if (!costCenterId && selectedProject) {
      const pay = await apiRequest(`/cost-centers/project/${selectedProject.id}/payments`).then(
        (d) => d.items?.find((p) => p.id === id)
      );
      costCenterId = pay?.costCenterId;
    }
    if (!costCenterId) {
      showToast("Não foi possível identificar o centro de custo", "error");
      return;
    }
    await apiRequest(`/cost-centers/${costCenterId}/payments/${id}`, { method: "DELETE" });
    showToast("Lançamento eliminado", "success");
    reloadPaymentsView();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
};

window.payCostPayment = async function (pay) {
  if (typeof pay === "string") pay = JSON.parse(pay);
  const paidAmount = Number(pay.paidAmount) > 0 ? Number(pay.paidAmount) : Number(pay.budgetedAmount) || 0;

  if (!confirm(`Confirmar pagamento de ${formatCurrency(paidAmount, pay.costCenter?.currency || "AOA")}?`)) return;

  try {
    await apiRequest(`/cost-centers/${pay.costCenterId}/payments/${pay.id}`, {
      method: "PATCH",
      body: {
        paidAmount,
        status: "CONFIRMADO",
      },
    });
    showToast("Lançamento pago com sucesso", "success");
    reloadPaymentsView();
  } catch (err) {
    showToast("Erro ao pagar: " + err.message, "error");
  }
};

async function submitPay(e) {
  e.preventDefault();
  const id = document.getElementById("payId").value;
  const ccId = document.getElementById("payCC").value;
  if (!ccId) { showToast("Seleciona um Centro de Custo", "error"); return; }

  const payDateVal = document.getElementById("payDate").value;
  const body = {
    docNumber: document.getElementById("payDoc").value.trim() || null,
    paymentDate: payDateVal ? new Date(payDateVal).toISOString() : new Date().toISOString(),
    supplier: document.getElementById("paySupplier").value.trim() || null,
    supplierId: document.getElementById("paySupplierId").value || null,
    description: document.getElementById("payDesc").value.trim(),
    category: document.getElementById("payCat").value,
    paymentType: document.getElementById("payType").value,
    budgetedAmount: parseFloat(document.getElementById("payBudgeted").value) || 0,
    paidAmount: parseFloat(document.getElementById("payPaid").value) || 0,
    paymentMethod: document.getElementById("payMethod").value || null,
    week: document.getElementById("payWeek").value || null,
    status: document.getElementById("payStatus").value,
    notes: document.getElementById("payNotes").value.trim() || null,
  };

  try {
    if (id) {
      await apiRequest(`/cost-centers/${ccId}/payments/${id}`, { method: "PATCH", body });
      showToast("Lançamento actualizado", "success");
    } else {
      await apiRequest(`/cost-centers/${ccId}/payments`, { method: "POST", body });
      showToast("Lançamento criado", "success");
    }
    document.getElementById("modalPay").classList.remove("open");
    reloadPaymentsView();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

// ── Fase 7/8: Fundo de Maneio ────────────────────────────────────────────────
async function loadFunds() {
  if (!selectedProject) return;
  const grid = document.getElementById("fundsGrid");
  grid.innerHTML = `<div class="spinner my-8"></div>`;
  try {
    const data = await apiRequest(`/petty-cash/funds?projectId=${selectedProject.id}`);
    currentFunds = data.items || [];
    renderFundsGrid();
    if (currentFunds.length > 0) {
      const stillExists = currentFunds.find((f) => f.id === selectedFundId);
      await selectFund(stillExists ? selectedFundId : currentFunds[0].id);
    } else {
      selectedFundId = null;
      document.getElementById("fundDetailPanel").classList.add("hidden");
    }
  } catch (err) {
    grid.innerHTML = `<p class="text-center py-8 text-red-500 text-xs font-bold col-span-full">${err.message}</p>`;
  }
}

function renderFundsGrid() {
  const grid = document.getElementById("fundsGrid");
  if (currentFunds.length === 0) {
    grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-12 text-slate-400">
      <span class="material-symbols-outlined text-4xl mb-2">account_balance_wallet</span>
      <p class="text-sm font-semibold">Nenhum Fundo de Maneio criado para esta obra</p>
    </div>`;
    return;
  }
  grid.innerHTML = currentFunds
    .map((f) => {
      const active = f.id === selectedFundId;
      return `<button onclick="window.selectFundHandler('${f.id}')"
        class="text-left p-4 rounded-2xl border transition-all ${active ? "border-emerald-500 bg-emerald-50 shadow-md" : "border-slate-100 bg-white hover:border-emerald-200"}">
        <p class="text-xs font-bold text-slate-400 uppercase tracking-wide">${f.name}</p>
        <p class="text-2xl font-bold text-slate-900 mt-1">${formatCurrency(f.currentBalance, f.currency)}</p>
        <p class="text-[11px] text-slate-400 mt-1">${(f.cards || []).length} cartão(ões) · saldo disponível</p>
      </button>`;
    })
    .join("");
}

window.selectFundHandler = function (id) {
  selectFund(id);
};

async function selectFund(fundId) {
  selectedFundId = fundId;
  renderFundsGrid();
  const panel = document.getElementById("fundDetailPanel");
  panel.classList.remove("hidden");
  document.getElementById("fundMovementsBody").innerHTML = `<tr><td colspan="6"><div class="spinner my-8"></div></td></tr>`;
  try {
    const data = await apiRequest(`/petty-cash/funds/${fundId}?pageSize=30`);
    const fund = data.fund;
    document.getElementById("fundDetailName").textContent = `${fund.name} · ${formatCurrency(fund.currentBalance, fund.currency)}`;

    const cardsRow = document.getElementById("fundCardsRow");
    cardsRow.innerHTML =
      (fund.cards || [])
        .map(
          (c) =>
            `<span class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5">
              <span class="material-symbols-outlined text-sm">credit_card</span>${c.label}${c.lastDigits ? ` •••• ${c.lastDigits}` : ""}
            </span>`
        )
        .join("") || `<span class="text-xs text-slate-400">Sem cartões associados</span>`;

    const movements = data.movements.items || [];
    document.getElementById("fundMovementsBody").innerHTML =
      movements
        .map((m) => {
          const typeColor = m.type === "DEBITO" ? "text-red-600" : m.type === "CREDITO" ? "text-emerald-600" : "text-amber-600";
          const sign = m.type === "DEBITO" ? "-" : "+";
          return `<tr>
            <td class="text-xs text-slate-500">${formatDateBR(m.createdAt)}</td>
            <td class="text-xs font-bold ${typeColor}">${m.type}</td>
            <td class="text-xs text-slate-500">${m.card?.label || "—"}</td>
            <td class="text-xs text-slate-700">${m.description}</td>
            <td class="text-xs font-bold ${typeColor} text-right">${sign}${formatCurrency(m.amount, fund.currency)}</td>
            <td class="text-xs text-slate-500 text-right">${formatCurrency(m.balanceAfter, fund.currency)}</td>
          </tr>`;
        })
        .join("") ||
      `<tr><td colspan="6" class="text-center py-8 text-slate-400 text-xs">Sem movimentações registadas</td></tr>`;
  } catch (err) {
    showToast("Erro ao carregar fundo: " + err.message, "error");
  }
}

async function submitFund(e) {
  e.preventDefault();
  if (!selectedProject) return;
  const body = {
    projectId: selectedProject.id,
    name: document.getElementById("fundName").value.trim(),
    initialBalance: parseFloat(document.getElementById("fundInitialBalance").value) || 0,
    currency: document.getElementById("fundCurrency").value.trim() || "AOA",
    notes: document.getElementById("fundNotes").value.trim() || null,
  };
  try {
    await apiRequest("/petty-cash/funds", { method: "POST", body });
    showToast("Fundo de Maneio criado", "success");
    document.getElementById("modalFund").classList.remove("open");
    await loadFunds();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

function openFundMovementModal() {
  if (!selectedFundId) {
    showToast("Seleciona um Fundo de Maneio primeiro", "warning");
    return;
  }
  document.getElementById("formFundMovement").reset();
  document.getElementById("fundMovementFundId").value = selectedFundId;
  const fund = currentFunds.find((f) => f.id === selectedFundId);
  const cardSelect = document.getElementById("fundMovementCard");
  cardSelect.innerHTML =
    `<option value="">— Sem cartão —</option>` +
    (fund?.cards || []).map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
  document.getElementById("modalFundMovement").classList.add("open");
}

async function submitFundMovement(e) {
  e.preventDefault();
  const fundId = document.getElementById("fundMovementFundId").value;
  const body = {
    type: document.getElementById("fundMovementType").value,
    cardId: document.getElementById("fundMovementCard").value || null,
    amount: parseFloat(document.getElementById("fundMovementAmount").value) || 0,
    description: document.getElementById("fundMovementDesc").value.trim(),
  };
  try {
    await apiRequest(`/petty-cash/funds/${fundId}/movements`, { method: "POST", body });
    showToast("Movimentação registada", "success");
    document.getElementById("modalFundMovement").classList.remove("open");
    await loadFunds();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

function openFundCardModal() {
  if (!selectedFundId) {
    showToast("Seleciona um Fundo de Maneio primeiro", "warning");
    return;
  }
  document.getElementById("formFundCard").reset();
  document.getElementById("fundCardFundId").value = selectedFundId;
  document.getElementById("modalFundCard").classList.add("open");
}

async function submitFundCard(e) {
  e.preventDefault();
  const fundId = document.getElementById("fundCardFundId").value;
  const body = {
    label: document.getElementById("fundCardLabel").value.trim(),
    lastDigits: document.getElementById("fundCardLastDigits").value.trim() || null,
  };
  try {
    await apiRequest(`/petty-cash/funds/${fundId}/cards`, { method: "POST", body });
    showToast("Cartão adicionado", "success");
    document.getElementById("modalFundCard").classList.remove("open");
    await loadFunds();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

// ── Fase 7/8: Pedidos Extra (Obra) ───────────────────────────────────────────
const EXTRA_STATUS_STYLES = {
  PENDENTE: "bg-amber-100 text-amber-700",
  APROVADO: "bg-blue-100 text-blue-700",
  PAGO: "bg-emerald-100 text-emerald-700",
  REJEITADO: "bg-red-100 text-red-700",
  CANCELADO: "bg-slate-100 text-slate-500",
};
const EXTRA_STATUS_LABELS = {
  PENDENTE: "Pendente",
  APROVADO: "Aprovado",
  PAGO: "Pago",
  REJEITADO: "Rejeitado",
  CANCELADO: "Cancelado",
};

async function loadExtras() {
  if (!selectedProject) return;
  const tbody = document.getElementById("extrasTableBody");
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner my-8"></div></td></tr>`;
  const status = document.getElementById("extrasStatusFilter")?.value || "";
  try {
    const params = new URLSearchParams({ type: "OBRA", projectId: selectedProject.id, pageSize: "100" });
    if (status) params.set("status", status);
    const data = await apiRequest(`/extra-requests?${params.toString()}`);
    const items = data.items || [];
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 text-xs">Nenhum pedido extra registado</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((it) => renderExtraRow(it)).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

// CAIXA/BANCO mantidos apenas para exibir correctamente pedidos antigos já
// registados; o formulário actual só permite FUNDO_MANEIO/SOLICITACAO_TRANSFERENCIA.
const EXTRA_SOURCE_LABELS = {
  CAIXA: "Caixa",
  BANCO: "Banco",
  SOLICITACAO_TRANSFERENCIA: "Solicitação de Transferência",
};

function renderExtraRow(it) {
  const sourceLabel =
    it.paymentSource === "FUNDO_MANEIO"
      ? `Fundo: ${it.fund?.name || "—"}`
      : EXTRA_SOURCE_LABELS[it.paymentSource] || it.paymentSource;
  const statusBadge = `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${EXTRA_STATUS_STYLES[it.status] || ""}">${EXTRA_STATUS_LABELS[it.status] || it.status}</span>`;

  const actions = [];
  if (it.status === "PENDENTE") {
    actions.push(`<button onclick="window.approveExtraHandler('${it.id}')" class="text-xs font-bold text-emerald-600 hover:underline">Aprovar</button>`);
    actions.push(`<button onclick="window.rejectExtraHandler('${it.id}')" class="text-xs font-bold text-red-600 hover:underline">Rejeitar</button>`);
  }
  if (it.status === "APROVADO") {
    actions.push(`<button onclick="window.payExtraHandler('${it.id}')" class="text-xs font-bold text-indigo-600 hover:underline">Pagar</button>`);
  }
  if (it.status === "PENDENTE" || it.status === "APROVADO") {
    actions.push(`<button onclick="window.cancelExtraHandler('${it.id}')" class="text-xs font-bold text-slate-500 hover:underline">Cancelar</button>`);
  }

  return `<tr>
    <td class="text-xs text-slate-500">${formatDateBR(it.createdAt)}</td>
    <td class="text-xs font-semibold text-slate-700 max-w-[220px] truncate">${it.description}</td>
    <td class="text-xs text-slate-500">${sourceLabel}</td>
    <td class="text-xs font-bold text-slate-900 text-right">${formatCurrency(it.amount, it.currency)}</td>
    <td class="text-xs text-slate-500">${it.requestedBy || "—"}</td>
    <td class="text-center">${statusBadge}</td>
    <td class="text-center"><div class="flex items-center justify-center gap-2">${actions.join("") || "—"}</div></td>
  </tr>`;
}

function toggleExtraFundRow() {
  const source = document.getElementById("extraSource").value;
  document.getElementById("extraFundRow").classList.toggle("hidden", source !== "FUNDO_MANEIO");
}

async function ensureFundsLoadedForExtra(type) {
  try {
    const query = type === "OBRA" && selectedProject ? `?projectId=${selectedProject.id}` : "";
    const data = await apiRequest(`/petty-cash/funds${query}`);
    currentFunds = data.items || [];
  } catch (err) {
    console.error("Erro ao carregar fundos:", err);
  }
  const fundSelect = document.getElementById("extraFundId");
  fundSelect.innerHTML =
    `<option value="">Selecionar...</option>` +
    currentFunds.map((f) => `<option value="${f.id}">${f.name} (${formatCurrency(f.currentBalance, f.currency)})</option>`).join("");
  populateExtraCardOptions();
}

function populateExtraCardOptions() {
  const fundId = document.getElementById("extraFundId").value;
  const fund = currentFunds.find((f) => f.id === fundId);
  const cardSelect = document.getElementById("extraCardId");
  cardSelect.innerHTML =
    `<option value="">— Sem cartão —</option>` +
    (fund?.cards || []).map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
}

async function openExtraModal(type = "OBRA") {
  document.getElementById("formExtra").reset();
  document.getElementById("extraId").value = "";
  document.getElementById("extraType").value = type;
  document.getElementById("extraProjectId").value = type === "OBRA" ? selectedProject?.id || "" : "";
  document.getElementById("modalExtraTitle").textContent = type === "OBRA" ? "Novo Pedido Extra da Obra" : "Novo Pedido Extra Geral";
  toggleExtraFundRow();
  await ensureFundsLoadedForExtra(type);
  document.getElementById("modalExtra").classList.add("open");
}

async function submitExtra(e) {
  e.preventDefault();
  const source = document.getElementById("extraSource").value;
  const type = document.getElementById("extraType").value || "OBRA";
  const body = {
    type,
    projectId: document.getElementById("extraProjectId").value || null,
    description: document.getElementById("extraDesc").value.trim(),
    amount: parseFloat(document.getElementById("extraAmount").value) || 0,
    paymentSource: source,
    fundId: source === "FUNDO_MANEIO" ? document.getElementById("extraFundId").value || null : null,
    cardId: source === "FUNDO_MANEIO" ? document.getElementById("extraCardId").value || null : null,
    notes: document.getElementById("extraNotes").value.trim() || null,
  };
  try {
    await apiRequest("/extra-requests", { method: "POST", body });
    showToast("Pedido Extra criado", "success");
    document.getElementById("modalExtra").classList.remove("open");
    if (type === "OBRA") loadExtras();
    else loadGlobalExtras();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

// ── Fase 7/8: Pedidos Extra Gerais (Visão Global) ────────────────────────────
async function loadGlobalExtras() {
  const tbody = document.getElementById("globalExtrasTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner my-8"></div></td></tr>`;
  const status = document.getElementById("globalExtrasStatusFilter")?.value || "";
  try {
    const params = new URLSearchParams({ type: "GERAL", pageSize: "100" });
    if (status) params.set("status", status);
    const data = await apiRequest(`/extra-requests?${params.toString()}`);
    const items = data.items || [];
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 text-xs">Nenhum pedido extra geral registado</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((it) => renderExtraRow(it)).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

function refreshExtrasLists() {
  loadExtras();
  loadGlobalExtras();
  loadSummary();
}

window.approveExtraHandler = async function (id) {
  if (!confirm("Aprovar este Pedido Extra?")) return;
  try {
    await apiRequest(`/extra-requests/${id}/approve`, { method: "PATCH" });
    showToast("Pedido aprovado", "success");
    refreshExtrasLists();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
};

window.rejectExtraHandler = async function (id) {
  const reason = prompt("Motivo da rejeição (opcional):") || "";
  try {
    await apiRequest(`/extra-requests/${id}/reject`, { method: "PATCH", body: { reason } });
    showToast("Pedido rejeitado", "success");
    refreshExtrasLists();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
};

window.payExtraHandler = async function (id) {
  if (!confirm("Confirmar execução do pagamento deste Pedido Extra?")) return;
  try {
    await apiRequest(`/extra-requests/${id}/pay`, { method: "POST" });
    showToast("Pedido pago", "success");
    refreshExtrasLists();
    if (document.getElementById("tab-fundomaneio")?.classList.contains("active")) loadFunds();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
};

window.cancelExtraHandler = async function (id) {
  if (!confirm("Cancelar este Pedido Extra?")) return;
  try {
    await apiRequest(`/extra-requests/${id}/cancel`, { method: "PATCH" });
    showToast("Pedido cancelado", "success");
    refreshExtrasLists();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
};

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const container = document.getElementById("toast");
  const colors = {
    success: "bg-emerald-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-slate-800 text-white",
  };
  const icons = { success: "check_circle", error: "error", info: "info" };
  const el = document.createElement("div");
  el.className = `pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl text-sm font-bold ${colors[type]} animate-fade-in`;
  el.innerHTML = `<span class="material-symbols-outlined text-base">${icons[type]}</span>${msg}`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.classList.add("opacity-0"), 4000);
    setTimeout(() => el.remove(), 4500);
  }, 3500);
}

// ── Pendentes (Lançamentos por Liquidar) ────────────────────────────────────────────────
let txPage = 1;
let historyPage = 1;
const TX_PAGE_SIZE = 20;

function openPaymentAsideHandler(el) {
  const data = JSON.parse(el.getAttribute('data-payload'));
  const type = el.getAttribute('data-type');
  openPaymentAside(data, type);
}

async function loadTransactions() {
  if (!selectedProject) return;
  const tbody = document.getElementById("txTableBody");
  if (!tbody) return;

  const statusFilter = currentTxStatus === "PENDING" ? "PENDENTE" : "CONFIRMADO";
  const catFilter = document.getElementById("txCategoryFilter").value;

  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner my-8"></div></td></tr>`;

  try {
    const data = await apiRequest(
      `/cost-centers/project/${selectedProject.id}/payments?page=${txPage}&pageSize=${TX_PAGE_SIZE}&status=${statusFilter}`
    );

    // Update KPIs using the fetched data (if pagination is an issue, we should fetch all for KPI)
    updateTxKPIs(data.items);

    if (data.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 text-sm">Nenhum lançamento encontrado.</td></tr>`;
      document.getElementById("txPagination").innerHTML = "";
      return;
    }

    const catNames = {
      MATERIALS: "Materiais",
      LABOR: "Mão de Obra",
      EQUIPMENT: "Equipamentos",
      MATERIAIS_INSUMOS: "Materiais/Insumos",
      SERVICOS_MAO_DE_OBRA: "Serviços/Mão Obra",
      GASTOS_PESSOAL: "Gastos Pessoal",
      DESPESAS_OPERACIONAIS: "Desp. Operacionais",
      INVESTIMENTOS: "Investimentos",
      OTHER: "Outro"
    };

    tbody.innerHTML = data.items.map((t) => {
      const isPaid = t.status === "CONFIRMADO";
      const statusClass = isPaid ? "badge-approved" : (t.status === "CANCELADO" ? "badge-rejected" : "badge-pendente");
      const statusText = isPaid ? "Liquidado" : (t.status === "CANCELADO" ? "Cancelado" : "Pendente");

      // Use html encoded description safely
      const descStr = t.description ? t.description.replace(/'/g, "\\'").replace(/"/g, "&quot;") : "";
      const isAPrazo = t.paymentType === "CREDITO";
      const paymentTypeStr = isAPrazo ? "C" : "PP";
      const paymentTypeClass = isAPrazo
        ? "bg-sky-50 text-sky-700 border border-sky-100"
        : "bg-red-50 text-red-700 border border-red-200";
      const paymentTypeBadge = `<span class="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${paymentTypeClass}">${paymentTypeStr}</span>`;

      return `
        <tr class="cursor-pointer hover:bg-slate-50/50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${JSON.stringify(t).replace(/'/g, "&#39;")}' data-type="PAYMENT">
          <td class="text-xs text-slate-500">${new Date(t.paymentDate).toLocaleDateString("pt-PT")}</td>
          <td class="font-bold text-slate-700 max-w-[200px] truncate" title="${descStr}">${t.description}</td>
          <td class="text-xs text-slate-500">${t.supplier || "-"}</td>
          <!--<td class="text-xs text-slate-500">${catNames[t.category] || t.category || "-"}</td>-->
          <td>${paymentTypeBadge}</td>
          <td class="text-xs text-slate-500">${t.costCenter?.name || "Geral"}</td>
          <td class="text-right font-black text-slate-900">${formatCurrency(t.budgetedAmount, t.costCenter?.currency || "AOA")}</td>
          <td class="text-right font-black ${isPaid ? 'text-emerald-600' : 'text-slate-400'}">${isPaid ? formatCurrency(t.paidAmount, t.costCenter?.currency || "AOA") : "-"}</td>
          <td class="text-center">
            <span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusClass}">
              ${statusText}
            </span>
          </td>
          <td class="text-center">
            <div class="flex items-center justify-center gap-2">
              ${!isPaid ? `
                <button onclick="event.stopPropagation(); openPaymentAsideHandler(this)" data-payload='${JSON.stringify(t).replace(/'/g, "&#39;")}' data-type="TRANSACTION" title="Liquidar" class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all">
                  <span class="material-symbols-outlined text-base">check_circle</span>
                </button>
              ` : `
                <button title="Liquidado" class="w-8 h-8 rounded-lg bg-slate-50 text-slate-300 flex items-center justify-center cursor-not-allowed">
                  <span class="material-symbols-outlined text-base">done_all</span>
                </button>
              `}
              <button onclick="event.stopPropagation(); openPaymentAsideHandler(this)" data-payload='${JSON.stringify(t).replace(/'/g, "&#39;")}' data-type="PAYMENT" title="Ver Detalhes" class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-[#2afc8d] hover:text-slate-900 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">visibility</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    const totalPages = Math.ceil(data.total / data.pageSize);
    document.getElementById("txPagination").innerHTML = `
      <span>Página ${data.page} de ${totalPages} (${data.total} itens)</span>
      <div class="flex gap-2">
        <button onclick="txPage=Math.max(1, txPage-1); loadTransactions()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page === 1 ? 'opacity-50 pointer-events-none' : ''}">Anterior</button>
        <button onclick="txPage=Math.min(${totalPages}, txPage+1); loadTransactions()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page === totalPages ? 'opacity-50 pointer-events-none' : ''}">Próxima</button>
      </div>
    `;

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-red-400 text-sm">Erro ao carregar lançamentos pendentes.</td></tr>`;
  }
}

// ── Histórico de Liquidações ───────────────────────────────────────────────────
async function loadHistory() {
  if (!selectedProject) return;
  const tbody = document.getElementById("historyTableBody");
  if (!tbody) return;

  const catFilter = document.getElementById("historyCategoryFilter")?.value || "";
  tbody.innerHTML = `<tr><td colspan="10"><div class="spinner my-8"></div></td></tr>`;

  try {
    const data = await apiRequest(
      `/cost-centers/project/${selectedProject.id}/payments?page=${historyPage}&pageSize=${TX_PAGE_SIZE}&status=CONFIRMADO&category=${catFilter}`
    );

    if (data.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="material-symbols-outlined text-3xl">history</span><p class="text-sm font-semibold">Sem histórico de liquidações</p></div></td></tr>`;
      document.getElementById("historyPagination").innerHTML = "";
      return;
    }

    const catNames = {
      MATERIAL: "Material", SERVICO: "Serviço", MAO_DE_OBRA: "Mão de Obra",
      EQUIPAMENTO: "Equipamentos", TRANSPORTE: "Transporte", ADMINISTRATIVO: "Administrativo", OUTRO: "Outro"
    };

    tbody.innerHTML = data.items.map((t) => {
      const isAPrazo = t.paymentType === "CREDITO";
      const paymentTypeBadge = `<span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isAPrazo ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}">${isAPrazo ? 'C' : 'PP'}</span>`;
      return `
        <tr class="cursor-pointer hover:bg-slate-50/50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${JSON.stringify(t).replace(/'/g, "&#39;")}' data-type="VIEW">
          <td class="text-xs text-slate-500">${new Date(t.paymentDate).toLocaleDateString("pt-PT")}</td>
          <td class="font-bold text-slate-700">${t.description}</td>
          <td class="text-xs text-slate-500">${t.supplier || "-"}</td>
          <td class="text-xs text-slate-500">${catNames[t.category] || t.category || "-"}</td>
          <td class="text-xs text-slate-500">${paymentTypeBadge}</td>
          <td class="text-xs text-slate-500">${t.costCenter?.name || "Geral"}</td>
          <td class="text-right font-black text-slate-900">${formatCurrency(t.budgetedAmount, t.costCenter?.currency || "AOA")}</td>
          <td class="text-right font-black text-emerald-600">${formatCurrency(t.paidAmount || t.budgetedAmount, t.costCenter?.currency || "AOA")}</td>
          <td class="text-center">
            <span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold uppercase badge-approved">Liquidado</span>
          </td>
          <td class="text-center"><span class="text-xs text-slate-300">—</span></td>
        </tr>`;
    }).join("");

    const totalPages = Math.ceil(data.total / data.pageSize);
    document.getElementById("historyPagination").innerHTML = `
      <span>Página ${data.page} de ${totalPages} (${data.total} itens)</span>
      <div class="flex gap-2">
        <button onclick="historyPage=Math.max(1,historyPage-1);loadHistory()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page === 1 ? 'opacity-50 pointer-events-none' : ''}">Anterior</button>
        <button onclick="historyPage=Math.min(${totalPages},historyPage+1);loadHistory()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page === totalPages ? 'opacity-50 pointer-events-none' : ''}">Próxima</button>
      </div>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-red-400 text-sm">Erro ao carregar histórico.</td></tr>`;
  }
}

// ── Dashboard: Pagamentos por Semana ─────────────────────────────────────────
async function loadWeeklyBreakdown() {
  const el = document.getElementById("weeklyBreakdownList");
  if (!el || !selectedProject) return;
  try {
    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/weekly-summary`);
    if (!data.weeks?.length) {
      el.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Sem dados semanais registados</p>`;
      return;
    }
    const max = Math.max(...data.weeks.map(w => w.paid));
    el.innerHTML = data.weeks.map(w => {
      const pct = max > 0 ? (w.paid / max) * 100 : 0;
      return `
        <div class="flex items-center gap-3">
          <span class="text-[10px] font-black text-slate-400 uppercase w-12 flex-shrink-0">${w.week}</span>
          <div class="flex-1 prog-bar-wrap">
            <div class="prog-bar bg-blue-500" style="width:${pct.toFixed(1)}%"></div>
          </div>
          <span class="text-xs font-bold text-slate-700 w-32 text-right tabular-nums">${formatCurrency(w.paid, w.currency || 'AOA')}</span>
        </div>`;
    }).join("");
  } catch {
    el.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Sem dados semanais</p>`;
  }
}

// ── Dashboard: Top 5 Maiores Despesas ─────────────────────────────────────────
async function loadTopExpenses() {
  const el = document.getElementById("topExpensesList");
  if (!el || !selectedProject) return;
  try {
    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/top-expenses?limit=5`);
    if (!data.items?.length) {
      el.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Sem despesas registadas</p>`;
      return;
    }
    const colors = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-blue-500", "bg-slate-400"];
    el.innerHTML = data.items.map((p, i) => `
      <div class="flex items-center gap-3 py-1">
        <span class="w-5 h-5 rounded-full ${colors[i]} text-white text-[10px] font-black flex items-center justify-center flex-shrink-0">${i + 1}</span>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-bold text-slate-900 truncate">${p.supplier || p.description}</p>
          <p class="text-[10px] text-slate-400">${p.costCenter?.code || "—"} · ${p.category}</p>
        </div>
        <span class="text-sm font-black text-slate-900 tabular-nums">${formatCurrency(p.paidAmount, p.costCenter?.currency || 'AOA')}</span>
      </div>`).join("");
  } catch {
    el.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Sem despesas registadas</p>`;
  }
}

function updateTxKPIs(items) {
  let pending = 0;
  let committed = 0;
  let paid = 0;

  items.forEach(t => {
    if (t.status === "PENDENTE") {
      pending++;
      committed += Number(t.budgetedAmount);
    } else if (t.status === "CONFIRMADO") {
      paid += Number(t.paidAmount || t.budgetedAmount);
    }
  });

  const currency = items[0]?.costCenter?.currency || "AOA";

  document.getElementById("kpiTxPending").textContent = pending;
  document.getElementById("kpiTxCommitted").textContent = formatCurrency(committed, currency);
  document.getElementById("kpiTxPaid").textContent = formatCurrency(paid, currency);

}

// Indica se a liquidação em curso já tinha sido confirmada anteriormente
// (reabertura do formulário apenas para anexar a fatura/substituir ficheiros).
let liqAlreadyConfirmed = false;

let _notificationRecipientsCache = null;
async function fetchNotificationRecipients() {
  if (_notificationRecipientsCache) return _notificationRecipientsCache;
  try {
    const data = await apiRequest("/users/notification-recipients");
    _notificationRecipientsCache = data.items || [];
  } catch {
    _notificationRecipientsCache = [];
  }
  return _notificationRecipientsCache;
}

async function renderLiqRecipients(preSelectedIds) {
  const list = document.getElementById("liqRecipientsList");
  if (!list) return;
  list.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">A carregar utilizadores...</p>`;

  const users = await fetchNotificationRecipients();
  if (!users.length) {
    list.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">Sem utilizadores disponíveis.</p>`;
    return;
  }

  const preSelected = new Set(preSelectedIds && preSelectedIds.length
    ? preSelectedIds
    : users.filter(u => u.isFinancialReceiver).map(u => u.id));

  list.innerHTML = users.map(u => {
    const checked = preSelected.has(u.id) ? "checked" : "";
    const label = u.name || u.email || "Utilizador";
    const badge = u.isFinancialReceiver
      ? `<span class="text-[9px] font-black uppercase tracking-wide text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Receptor</span>`
      : "";
    return `
      <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white cursor-pointer transition-colors">
        <input type="checkbox" class="liq-recipient-checkbox w-4 h-4 rounded accent-emerald-600" value="${u.id}" ${checked} />
        <span class="text-xs font-semibold text-slate-700 flex-1 truncate">${label}</span>
        ${badge}
      </label>`;
  }).join("");
}

function getSelectedLiqRecipientIds() {
  return Array.from(document.querySelectorAll(".liq-recipient-checkbox:checked")).map(el => el.value);
}

window.openLiquidateModal = function (payment) {
  // Retrocompatibilidade: aceita também a assinatura antiga (txId, description, amount, ccId).
  const data = (payment && typeof payment === "object")
    ? payment
    : { id: arguments[0], description: arguments[1], budgetedAmount: arguments[2], costCenterId: arguments[3] };

  const amount = data.paidAmount ?? data.budgetedAmount ?? data.amount ?? 0;
  liqAlreadyConfirmed = data.status === "CONFIRMADO" || data.status === "PAID";

  document.getElementById("liqTxId").value = data.id;
  document.getElementById("liqDesc").textContent = data.description || "";
  document.getElementById("liqCommitted").value = formatCurrency(data.budgetedAmount ?? amount, "AOA");
  document.getElementById("liqAmount").value = amount;

  // Create or update a hidden field for ccId
  let ccInput = document.getElementById("liqCcId");
  if (!ccInput) {
    ccInput = document.createElement("input");
    ccInput.type = "hidden";
    ccInput.id = "liqCcId";
    document.getElementById("formLiq").appendChild(ccInput);
  }
  ccInput.value = data.costCenterId;

  const compInput = document.getElementById("liqComprovativo");
  const compLabel = document.getElementById("liqComprovativoLabel");
  const compHint = document.getElementById("liqComprovativoHint");
  const title = document.getElementById("liqModalTitle");
  const subtitle = document.getElementById("liqModalSubtitle");
  const submitBtn = document.getElementById("liqSubmitBtn");

  if (compInput) compInput.value = "";
  const fatInput = document.getElementById("liqFatura");
  if (fatInput) fatInput.value = "";

  const recipientsSection = document.getElementById("liqRecipientsSection");

  if (liqAlreadyConfirmed) {
    // Já foi liquidado (comprovativo já existe). Reabertura serve tipicamente
    // para anexar/substituir a fatura final — não obriga a re-enviar o comprovativo
    // nem repete o envio de notificações (já disparadas na liquidação inicial).
    compInput?.removeAttribute("required");
    if (compLabel) compLabel.textContent = "Comprovativo (substituir, opcional)";
    compHint?.classList.remove("hidden");
    if (title) title.textContent = data.faturaUrl ? "Editar Liquidação" : "Anexar Fatura";
    if (subtitle) subtitle.textContent = data.faturaUrl
      ? "Atualiza documentos da liquidação"
      : "Ainda não há fatura final — podes anexá-la agora";
    if (submitBtn) submitBtn.textContent = "Guardar";
    recipientsSection?.classList.add("hidden");
    const recipientsList = document.getElementById("liqRecipientsList");
    if (recipientsList) recipientsList.innerHTML = "";
  } else {
    compInput?.setAttribute("required", "required");
    if (compLabel) compLabel.textContent = "Comprovativo*";
    compHint?.classList.add("hidden");
    if (title) title.textContent = "Liquidar Lançamento";
    if (subtitle) subtitle.textContent = "Confirma o valor final pago";
    if (submitBtn) submitBtn.textContent = "Confirmar Liquidação";
    recipientsSection?.classList.remove("hidden");
    renderLiqRecipients(data.notifiedRecipientIds);
  }

  document.getElementById("modalLiq").classList.add("open");
};

async function submitLiquidation(e) {
  e.preventDefault();
  const txId = document.getElementById("liqTxId").value;
  const ccId = document.getElementById("liqCcId").value;
  const realizedAmount = document.getElementById("liqAmount").value;

  if (!realizedAmount) return showToast("Valor é obrigatório", "error");

  const compInput = document.getElementById("liqComprovativo");
  if (!liqAlreadyConfirmed && (!compInput || !compInput.files[0])) {
    return showToast("Comprovativo de pagamento é obrigatório", "error");
  }

  const fd = new FormData();
  fd.append("paidAmount", realizedAmount);
  if (!liqAlreadyConfirmed) fd.append("status", "CONFIRMADO");
  if (compInput && compInput.files[0]) fd.append("comprovativo", compInput.files[0]);

  const fatInput = document.getElementById("liqFatura");
  if (fatInput && fatInput.files[0]) {
    fd.append("fatura", fatInput.files[0]);
  }

  const recipientIds = getSelectedLiqRecipientIds();
  if (recipientIds.length) fd.append("recipientIds", JSON.stringify(recipientIds));

  try {
    const btn = e.target.querySelector("button[type='submit']");
    const oldText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner w-4 h-4 mr-2 inline-block align-middle border-white"></span> A guardar...`;
    btn.disabled = true;

    const result = await apiUpload(`/cost-centers/${ccId}/payments/${txId}`, fd, "PATCH");

    btn.innerHTML = oldText;
    btn.disabled = false;

    const sent = Number(result?.notificationsSent ?? 0);
    let toastMsg = liqAlreadyConfirmed ? "Lançamento atualizado com sucesso!" : "Lançamento liquidado com sucesso!";
    if (!liqAlreadyConfirmed && recipientIds.length) {
      toastMsg += sent
        ? ` Notificação enviada a ${sent} destinatário(s) (in-app).`
        : " Nenhuma notificação foi entregue — confirma que o backend foi reiniciado e que estás com sessão aberta.";
    }
    showToast(toastMsg, sent || liqAlreadyConfirmed ? "success" : "info");
    document.getElementById("modalLiq").classList.remove("open");

    // Reset inputs
    compInput.value = "";
    if (fatInput) fatInput.value = "";

    if (selectedProject) loadTransactions();
    else reloadPaymentsView();
  } catch (err) {
    const btn = e.target.querySelector("button[type='submit']");
    btn.innerHTML = liqAlreadyConfirmed ? "Guardar" : "Confirmar Liquidação";
    btn.disabled = false;
    showToast("Erro: " + err.message, "error");
  }
}

// ── Sidebar Toggle ────────────────────────────────────────────────────────────
window.toggleSidebar = function () {
  const sidebar = document.getElementById("sidebar");
  const floatingBtn = document.getElementById("floatingToggleBtn");

  sidebar.classList.toggle("collapsed");

  if (sidebar.classList.contains("collapsed")) {
    floatingBtn.classList.remove("hidden");
  } else {
    floatingBtn.classList.add("hidden");
  }
};

// ── Payment Aside Logic ────────────────────────────────────────────────────────
window.openPaymentAsideHandler = function (btn) {
  try {
    const payload = JSON.parse(btn.getAttribute("data-payload"));
    const type = btn.getAttribute("data-type");
    openPaymentAside(payload, type);
  } catch (err) {
    console.error("Erro ao abrir aside de pagamento:", err);
  }
};

function renderAsideFiscalSection(data) {
  const section = document.getElementById("asideFiscalSection");
  const container = document.getElementById("asideFiscalBreakdown");
  if (!section || !container) return;

  const supplier = data?.supplierRef || null;
  const base = Number(data.budgetedAmount ?? data.amount ?? 0);
  const currency = data.currency || data.costCenter?.currency || "AOA";
  const { lines } = computeSupplierFiscalBreakdown(supplier, base);

  if (!lines.length) {
    section.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  container.innerHTML = lines
    .map((line) => {
      const sign = line.amount >= 0 ? "+" : "−";
      const color = line.amount >= 0 ? "text-emerald-600" : "text-red-600";
      return `<div class="flex justify-between items-center text-xs">
        <span class="text-slate-500 font-medium">${line.label}</span>
        <span class="font-bold tabular-nums ${color}">${sign}${formatFiscalAmount(line.amount, currency)}</span>
      </div>`;
    })
    .join("");
}

window.openPaymentAside = function (data, type) {
  const aside = document.getElementById("paymentAside");
  const overlay = document.getElementById("paymentAsideOverlay");

  const badge = document.getElementById("asideStatusBadge");
  if (badge) {
    badge.classList.remove("hidden", "bg-emerald-100", "text-emerald-700", "bg-amber-100", "text-amber-700", "bg-red-100", "text-red-700");
    if (data.status === "CONFIRMADO" || data.status === "PAID") {
      badge.textContent = "Liquidado";
      badge.classList.add("bg-emerald-100", "text-emerald-700");
    } else if (data.status === "CANCELADO") {
      badge.textContent = "Cancelado";
      badge.classList.add("bg-red-100", "text-red-700");
    } else {
      badge.textContent = "Pendente";
      badge.classList.add("bg-amber-100", "text-amber-700");
    }
  }

  document.getElementById("asideDesc").textContent = data.description || "—";
  document.getElementById("asideDate").textContent = data.paymentDate ? formatDateBR(data.paymentDate) : (data.date ? formatDateBR(data.date) : "—");
  document.getElementById("asideSupplier").textContent = data.supplier || "—";
  document.getElementById("asideCategory").textContent = data.category || "—";

  document.getElementById("asideNIF").textContent = data.supplierNif || data.nif || "—";
  document.getElementById("asideIBAN").textContent = data.supplierIban || data.iban || "—";

  const supplierDetails = document.getElementById("asideSupplierDetails");
  // Mostra sempre o bloco de detalhes (NIF/IBAN)
  supplierDetails.classList.remove("hidden");

  const amount = data.budgetedAmount || data.amount || 0;
  const currency = data.currency || (data.costCenter ? data.costCenter.currency : "AOA");
  document.getElementById("asideAmount").textContent = formatCurrency(amount, currency);
  renderAsideFiscalSection(data);

  function renderAsideDocument(url, title = "Documento") {
    if (!url) {
      return `
        <div class="py-8 text-center text-slate-300">
          <span class="material-symbols-outlined text-4xl mb-2">description</span>
          <p class="text-xs font-semibold text-slate-500">Sem ${title.toLowerCase()} disponível.</p>
        </div>
      `;
    }
    const isImage = url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i);
    if (isImage) {
      return `
        <div class="relative w-full h-full flex flex-col items-center justify-center">
          <img src="${getAssetUrl(url)}" alt="${title}" class="w-full h-auto object-contain max-h-full rounded-lg shadow-sm border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity" onclick="window.open('${getAssetUrl(url)}','_blank')">
          <button type="button" onclick="window.open('${getAssetUrl(url)}','_blank')" class="absolute top-2 right-2 w-8 h-8 bg-white/80 backdrop-blur-md border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white hover:text-emerald-600 transition-all shadow-sm" title="Expandir Imagem">
            <span class="material-symbols-outlined text-[16px]">open_in_new</span>
          </button>
        </div>
      `;
    } else {
      return `
        <div class="relative w-full h-full min-h-[300px]">
          <iframe src="${getAssetUrl(url)}" class="w-full h-full rounded-lg shadow-sm border border-slate-200"></iframe>
          <button type="button" onclick="window.open('${getAssetUrl(url)}','_blank')" class="absolute top-2 right-2 w-8 h-8 bg-white/80 backdrop-blur-md border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white hover:text-emerald-600 transition-all shadow-sm" title="Expandir Documento">
            <span class="material-symbols-outlined text-[16px]">open_in_new</span>
          </button>
        </div>
      `;
    }
  }

  document.getElementById("asideProformaContainer").innerHTML = renderAsideDocument(data.proformaUrl, "Documento");

  const compSection = document.getElementById("asideComprovativoSection");
  const compContainer = document.getElementById("asideComprovativoContainer");
  const faturaSection = document.getElementById("asideFaturaSection");
  const faturaContainer = document.getElementById("asideFaturaContainer");

  if (data.status === "CONFIRMADO" || data.status === "PAID") {
    if (data.comprovativoUrl) {
      compSection.classList.remove("hidden");
      compContainer.innerHTML = renderAsideDocument(data.comprovativoUrl, "Comprovativo");
    } else {
      compSection.classList.add("hidden");
    }

    if (data.faturaUrl) {
      faturaSection.classList.remove("hidden");
      faturaContainer.innerHTML = renderAsideDocument(data.faturaUrl, "Fatura");
    } else {
      faturaSection.classList.add("hidden");
    }
  } else {
    compSection.classList.add("hidden");
    faturaSection.classList.add("hidden");
  }

  const actionBtn = document.getElementById("asideActionBtn");

  if (type === 'VIEW') {
    actionBtn.classList.add("hidden");
  } else {
    actionBtn.classList.remove("hidden");
    actionBtn.onclick = () => {
      if (type === 'PAYMENT' || type === 'TRANSACTION') {
        openLiquidateModal(data);
      }
      closePaymentAside();
    };
  }

  overlay.classList.remove("hidden");
  // Força reflow
  void overlay.offsetWidth;
  overlay.classList.remove("opacity-0");
  aside.classList.remove("translate-x-full");
};

window.closePaymentAside = function () {
  const aside = document.getElementById("paymentAside");
  const overlay = document.getElementById("paymentAsideOverlay");

  aside.classList.add("translate-x-full");
  overlay.classList.add("opacity-0");
  setTimeout(() => overlay.classList.add("hidden"), 300);
};

// ══════════════════════════════════════════════════════════════════════════════
// ── IMPORT EXCEL FEATURE ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

let importCurrentStep = 1;
let importParsedGroups = []; // [{ sheetGroupName, items: [] }]
let importMapping = {};      // sheetGroupName -> ccId or ""

// Column name aliases (handles different spellings from the spreadsheet)
const COL_ALIASES = {
  tipo: ["tipo", "type", "categoria"],
  desc: ["descri\u00e7\u00e3o", "descricao", "description", "desc", "item", "material", "servi\u00e7o"],
  unit: ["un", "und", "unit", "unidade", "un.", "und."],
  qty: ["qtd", "qtde", "qty", "quantidade", "quant"],
  price: ["p. uni", "p.uni", "preco unit", "pre\u00e7o unit\u00e1rio", "unit price", "p_uni", "p uni", "pu", "valor unit\u00e1rio"],
  hours: ["hf", "hrs", "horas", "factor", "h/f", "h.f", "hours"],
};

function resolveCol(headers) {
  const idx = {};
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  headers.forEach((h, i) => {
    const hn = norm(h);
    for (const [key, aliases] of Object.entries(COL_ALIASES)) {
      if (!idx[key] && aliases.some(a => hn.includes(a))) {
        idx[key] = i;
      }
    }
  });
  return idx;
}

// ── Open / Close ──────────────────────────────────────────────────────────────
function openImportModal() {
  if (!selectedProject) { showToast("Seleciona uma Obra primeiro", "error"); return; }

  importCurrentStep = 1;
  importParsedGroups = [];
  importMapping = {};

  // Reset file input
  const fi = document.getElementById("importFileInput");
  if (fi) fi.value = "";

  // Reset drop zone appearance
  const dz = document.getElementById("importDropZone");
  if (dz) {
    dz.innerHTML = `
      <div class="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
        <span class="material-symbols-outlined text-4xl text-emerald-500">upload_file</span>
      </div>
      <div>
        <p class="font-bold text-slate-800 text-base">Arrasta o ficheiro Excel aqui</p>
        <p class="text-sm text-slate-400 mt-1">ou clica para selecionar · .xlsx, .xls</p>
      </div>
      <input type="file" id="importFileInput" accept=".xlsx,.xls" class="hidden"
        onchange="handleImportFile(this.files[0])">
      <div class="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">check_circle</span> .xlsx</span>
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">check_circle</span> .xls</span>
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">check_circle</span> Até 20 MB</span>
      </div>`;
  }

  updateImportStepUI(1);
  document.getElementById("modalImportExcel").classList.add("open");
}

window.closeImportModal = function () {
  document.getElementById("modalImportExcel").classList.remove("open");
};

// ── File handling ─────────────────────────────────────────────────────────────
window.handleImportDrop = function (event) {
  const file = event.dataTransfer.files[0];
  if (file) handleImportFile(file);
};

window.handleImportFile = function (file) {
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["xlsx", "xls"].includes(ext)) {
    showToast("Formato inválido. Use .xlsx ou .xls", "error");
    return;
  }

  // Show loading in drop zone
  const dz = document.getElementById("importDropZone");
  dz.innerHTML = `
    <div class="spinner"></div>
    <p class="text-sm font-semibold text-slate-500">A processar <strong>${file.name}</strong>...</p>`;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      // Try to find the most relevant sheet (first one with data, or the one with budget keywords)
      const sheetNames = workbook.SheetNames;
      let targetSheet = sheetNames[0];
      for (const sn of sheetNames) {
        const lower = sn.toLowerCase();
        if (lower.includes("custo") || lower.includes("or") || lower.includes("tp") || lower.includes("budget")) {
          targetSheet = sn;
          break;
        }
      }

      const ws = workbook.Sheets[targetSheet];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      importParsedGroups = parseSheetRows(rows);

      if (importParsedGroups.length === 0) {
        dz.innerHTML = `
          <div class="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
            <span class="material-symbols-outlined text-4xl text-red-400">error</span>
          </div>
          <p class="font-bold text-red-700">Não foram encontrados itens válidos</p>
          <p class="text-sm text-slate-400">Verifica se a planilha tem o formato correcto.</p>`;
        return;
      }

      const totalItems = importParsedGroups.reduce((s, g) => s + g.items.length, 0);

      // Show success in drop zone
      dz.innerHTML = `
        <div class="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
          <span class="material-symbols-outlined text-4xl text-emerald-500">check_circle</span>
        </div>
        <div>
          <p class="font-bold text-slate-800 text-base">${file.name}</p>
          <p class="text-sm text-emerald-600 font-semibold mt-1">
            ${importParsedGroups.length} grupo(s) detectado(s) · ${totalItems} itens
          </p>
        </div>
        <button type="button"
          onclick="document.getElementById('importFileInput').click()"
          class="h-8 px-4 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-all">
          Trocar ficheiro
        </button>
        <input type="file" id="importFileInput" accept=".xlsx,.xls" class="hidden"
          onchange="handleImportFile(this.files[0])">`;

      // Enable Next button
      document.getElementById("importBtnNext").disabled = false;

    } catch (err) {
      console.error("Import parse error:", err);
      dz.innerHTML = `
        <div class="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
          <span class="material-symbols-outlined text-4xl text-red-400">error</span>
        </div>
        <p class="font-bold text-red-700">Erro ao ler o ficheiro</p>
        <p class="text-sm text-slate-400">${err.message}</p>`;
    }
  };
  reader.readAsArrayBuffer(file);
};

// ── Parser ────────────────────────────────────────────────────────────────────
function parseSheetRows(rows) {
  if (!rows || rows.length < 2) return [];

  // Find header row (contains column names like TIPO, DESCRIÇÃO, UN, QTD, etc.)
  let headerRowIdx = -1;
  let colIdx = {};

  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i];
    const candidate = resolveCol(r);
    // Need at least desc column to be a valid header
    if (candidate.desc !== undefined) {
      colIdx = candidate;
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) return [];

  // Parse data rows below header
  const groups = {};
  let currentGroup = "GERAL";

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];

    // Skip completely empty rows
    const allEmpty = row.every(c => String(c).trim() === "");
    if (allEmpty) continue;

    const tipo = String(row[colIdx.tipo] ?? "").trim();
    const desc = String(row[colIdx.desc] ?? "").trim();
    const unit = String(row[colIdx.unit] ?? "").trim();
    const qtyRaw = row[colIdx.qty] ?? "";
    const priceRaw = row[colIdx.price] ?? "";
    const hoursRaw = row[colIdx.hours] ?? "";

    const qty = parseFloat(String(qtyRaw).replace(",", ".")) || 0;
    const price = parseFloat(String(priceRaw).replace(",", ".")) || 0;
    const hours = parseFloat(String(hoursRaw).replace(",", ".")) || 1;

    if (tipo) {
      currentGroup = tipo.toUpperCase();
    }

    // Must have description to be a valid item
    if (!desc) continue;

    // Ignore summary or empty-ish rows that might be mistaken as items
    if (desc.toLowerCase().includes("total") && qty === 0 && price === 0) continue;

    if (!groups[currentGroup]) {
      groups[currentGroup] = { sheetGroupName: currentGroup, items: [] };
    }

    groups[currentGroup].items.push({
      description: desc,
      unit: unit || null,
      quantity: qty || null,
      unitPrice: price || null,
      hours: hours !== 1 ? hours : null,
      priority: "MEDIA",
      status: "PENDING",
      _totalObra: qty * price * hours,
    });
  }

  return Object.values(groups).filter(g => g.items.length > 0);
}

// ── Step Navigation ───────────────────────────────────────────────────────────
function updateImportStepUI(step) {
  importCurrentStep = step;

  // Hide all steps
  document.querySelectorAll(".import-step").forEach(el => el.classList.remove("active"));

  // Show current
  const stepIds = ["", "importStep1", "importStep2", "importStep3", "importStep4", "importStep5"];
  if (stepIds[step]) document.getElementById(stepIds[step])?.classList.add("active");

  // Step indicator dots
  [1, 2, 3].forEach(n => {
    const numEl = document.getElementById(n === 1 ? null : `stepNum${n}`);
    const lblEl = document.getElementById(n === 1 ? null : `stepLabel${n}`);
    if (numEl) numEl.className = `w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${n <= step ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500"}`;
    if (lblEl) lblEl.className = `text-xs font-bold ${n <= step ? "text-emerald-700" : "text-slate-400"}`;
  });

  // Connector lines
  const l12 = document.getElementById("stepLine12");
  const l23 = document.getElementById("stepLine23");
  if (l12) l12.style.background = step >= 2 ? "#2afc8d" : "#e2e8f0";
  if (l23) l23.style.background = step >= 3 ? "#2afc8d" : "#e2e8f0";

  // Step 1 dot (always active in step 1+)
  const dot1 = document.querySelector("#stepDot1 > div");
  if (dot1) dot1.className = `w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold`;

  // Back button
  const backBtn = document.getElementById("importBtnBack");
  if (backBtn) backBtn.classList.toggle("hidden", step <= 1 || step >= 4);

  // Next button
  const nextBtn = document.getElementById("importBtnNext");
  const nextIcon = document.getElementById("importBtnNextIcon");
  const nextLabel = document.getElementById("importBtnNextLabel");
  const cancelBtn = document.getElementById("importBtnCancel");

  if (step === 1) {
    nextBtn.disabled = importParsedGroups.length === 0;
    nextIcon.textContent = "arrow_forward";
    nextLabel.textContent = "Continuar";
    nextBtn.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
  } else if (step === 2) {
    nextBtn.disabled = false;
    nextIcon.textContent = "visibility";
    nextLabel.textContent = "Pré-visualizar";
    nextBtn.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
  } else if (step === 3) {
    nextBtn.disabled = false;
    nextIcon.textContent = "upload";
    nextLabel.textContent = "Confirmar Importação";
    nextBtn.style.background = "";
    nextBtn.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
  } else if (step === 4) {
    nextBtn.classList.add("hidden");
    cancelBtn.classList.add("hidden");
    backBtn.classList.add("hidden");
  } else if (step === 5) {
    nextBtn.classList.add("hidden");
    cancelBtn.textContent = "Fechar";
    cancelBtn.classList.remove("hidden");
  }
}

window.importGoNext = function () {
  if (importCurrentStep === 1) {
    renderCCMappingStep();
    updateImportStepUI(2);
  } else if (importCurrentStep === 2) {
    collectCCMapping();
    renderPreviewStep();
    updateImportStepUI(3);
  } else if (importCurrentStep === 3) {
    runImport();
  }
};

window.importGoBack = function () {
  if (importCurrentStep === 2) updateImportStepUI(1);
  else if (importCurrentStep === 3) updateImportStepUI(2);
};

// ── Step 2: CC Mapping ────────────────────────────────────────────────────────
function renderCCMappingStep() {
  const container = document.getElementById("importCCMappingList");
  if (!container) return;

  const ccOptions = costCenters.map(cc =>
    `<option value="${cc.id}">${cc.code} — ${cc.name}</option>`).join("");

  container.innerHTML = importParsedGroups.map((group, idx) => {
    // Try auto-match by name similarity
    const autoMatch = tryAutoMatch(group.sheetGroupName);
    const selectedId = autoMatch ? autoMatch.id : "CREATE_NEW";

    return `
      <div class="import-cc-group">
        <div class="import-cc-header">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0 text-xs font-bold text-slate-600">
              ${group.items.length}
            </div>
            <div class="min-w-0">
              <p class="text-xs font-bold text-slate-800 truncate">${group.sheetGroupName}</p>
              <p class="text-[10px] text-slate-400">${group.items.length} item(s) · Total: ${formatCurrency(
      group.items.reduce((s, it) => s + (it._totalObra || 0), 0), "AOA")}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            ${autoMatch ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Auto-mapeado</span>` : `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Novo CC</span>`}
            <select data-group-idx="${idx}" id="ccMapSelect_${idx}"
              class="h-9 px-3 bg-white border ${autoMatch ? "border-emerald-300" : "border-slate-200"} rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40 min-w-[200px]">
              <option value="CREATE_NEW">✨ Criar automaticamente</option>
              <option value="">— Ignorar grupo —</option>
              <optgroup label="Centros Existentes">
                ${ccOptions}
              </optgroup>
            </select>
          </div>
        </div>
        <!-- Preview of first 3 items -->
        <div class="px-4 py-2 text-[10px] text-slate-400 font-semibold">
          ${group.items.slice(0, 3).map(it => `<span class="inline-block mr-3">${it.description.substring(0, 40)}</span>`).join("")}
          ${group.items.length > 3 ? `<span class="text-slate-300">+${group.items.length - 3} mais...</span>` : ""}
        </div>
      </div>`;
  }).join("");

  // Set auto-matched values
  importParsedGroups.forEach((group, idx) => {
    const autoMatch = tryAutoMatch(group.sheetGroupName);
    const sel = document.getElementById(`ccMapSelect_${idx}`);
    if (sel) {
      sel.value = autoMatch ? autoMatch.id : "CREATE_NEW";
    }
  });
}

function tryAutoMatch(groupName) {
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const gn = norm(groupName);

  // Exact match on name or code
  let match = costCenters.find(cc => norm(cc.name) === gn || norm(cc.code) === gn);
  if (match) return match;

  // Partial contains match
  match = costCenters.find(cc => gn.includes(norm(cc.name)) || norm(cc.name).includes(gn));
  if (match) return match;

  // Keyword match (e.g. "FERRAMENTAS" matches CC named "Ferramentas de Obra")
  const keywords = gn.split(/[\s\-_/]+/);
  match = costCenters.find(cc => {
    const ccNorm = norm(cc.name);
    return keywords.some(kw => kw.length > 3 && ccNorm.includes(kw));
  });
  return match || null;
}

function collectCCMapping() {
  importMapping = {};
  importParsedGroups.forEach((group, idx) => {
    const sel = document.getElementById(`ccMapSelect_${idx}`);
    if (sel && sel.value) {
      importMapping[group.sheetGroupName] = sel.value;
    }
  });
}

// ── Step 3: Preview ───────────────────────────────────────────────────────────
function renderPreviewStep() {
  const summaryBar = document.getElementById("importSummaryBar");
  const previewGroups = document.getElementById("importPreviewGroups");

  // Only include mapped groups
  const mappedGroups = importParsedGroups.filter(g => importMapping[g.sheetGroupName]);
  const totalItems = mappedGroups.reduce((s, g) => s + g.items.length, 0);
  const totalValue = mappedGroups.reduce((s, g) =>
    s + g.items.reduce((gs, it) => gs + (it._totalObra || 0), 0), 0);
  const ignoredGroups = importParsedGroups.length - mappedGroups.length;

  summaryBar.innerHTML = `
    <div class="kpi-card">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Grupos Mapeados</p>
      <p class="text-xl font-bold text-emerald-600">${mappedGroups.length}</p>
    </div>
    <div class="kpi-card">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total de Itens</p>
      <p class="text-xl font-bold text-slate-900">${totalItems}</p>
    </div>
    <div class="kpi-card">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Valor Total Estimado</p>
      <p class="text-xl font-bold text-slate-900">${formatCurrency(totalValue, "AOA")}</p>
    </div>`;

  if (mappedGroups.length === 0) {
    previewGroups.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined text-3xl">warning</span>
        <p class="text-sm font-semibold">Nenhum grupo mapeado</p>
        <p class="text-xs text-slate-400">Volta ao passo anterior e mapeia pelo menos um Centro de Custo.</p>
      </div>`;
    document.getElementById("importBtnNext").disabled = true;
    return;
  }

  document.getElementById("importBtnNext").disabled = false;

  if (ignoredGroups > 0) {
    previewGroups.innerHTML = `
      <div class="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4 text-xs font-semibold text-amber-700 flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">info</span>
        ${ignoredGroups} grupo(s) sem mapeamento serão ignorados.
      </div>`;
  } else {
    previewGroups.innerHTML = "";
  }

  mappedGroups.forEach(group => {
    let ccName = "Novo Centro de Custo";
    let ccCode = "NOVO";
    let cur = selectedProject?.currency || "AOA";
    if (importMapping[group.sheetGroupName] !== "CREATE_NEW") {
      const cc = costCenters.find(c => c.id === importMapping[group.sheetGroupName]);
      if (cc) {
        ccName = cc.name;
        ccCode = cc.code;
        cur = cc.currency || "AOA";
      }
    }
    const groupTotal = group.items.reduce((s, it) => s + (it._totalObra || 0), 0);

    previewGroups.innerHTML += `
      <div class="import-cc-group">
        <div class="import-cc-header">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">${group.sheetGroupName}</span>
            <span class="material-symbols-outlined text-sm text-emerald-500">arrow_forward</span>
            <span class="text-xs font-bold ${ccCode === 'NOVO' ? 'text-blue-600' : 'text-slate-900'}">${ccCode === 'NOVO' ? '✨ ' : ''}${ccCode} — ${ccName}</span>
          </div>
          <span class="text-xs font-bold text-slate-600">${group.items.length} itens · ${formatCurrency(groupTotal, cur)}</span>
        </div>
        <div class="overflow-x-auto custom-scroll">
          <table class="w-full import-preview-table">
            <thead>
              <tr>
                <th class="text-left">Descrição</th>
                <th class="text-center">UN</th>
                <th class="text-right">Qtd</th>
                <th class="text-right">P. Unit.</th>
                <th class="text-right">Hrs</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${group.items.map(it => `
                <tr>
                  <td class="font-medium text-slate-800 max-w-xs" style="max-width:280px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${(it.description || "").replace(/"/g, "&quot;")}">${it.description}</td>
                  <td class="text-center text-slate-500">${it.unit || "—"}</td>
                  <td class="text-right text-slate-700">${it.quantity ? Number(it.quantity).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—"}</td>
                  <td class="text-right text-slate-700">${it.unitPrice ? Number(it.unitPrice).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—"}</td>
                  <td class="text-right text-slate-500">${it.hours ? Number(it.hours).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—"}</td>
                  <td class="text-right font-bold text-slate-900">${formatCurrency(it._totalObra || 0, cur)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  });
}

// ── Step 4: Run Import ────────────────────────────────────────────────────────
async function runImport() {
  updateImportStepUI(4);
  const progressFill = document.getElementById("importProgressFill");
  const progressLabel = document.getElementById("importProgressLabel");
  const progressSub = document.getElementById("importProgressSub");
  let done = 0;
  const errors = [];

  // First create missing cost centers
  progressLabel.textContent = "A criar Centros de Custo...";
  for (let i = 0; i < importParsedGroups.length; i++) {
    const group = importParsedGroups[i];
    if (importMapping[group.sheetGroupName] === "CREATE_NEW") {
      try {
        let safeName = (group.sheetGroupName || "").trim();
        if (safeName.length < 2) safeName = safeName ? `CC ${safeName}` : "CUSTO GERAL";
        let safeCode = safeName.substring(0, 4).toUpperCase().trim();
        if (safeCode.length < 1) safeCode = "GER";
        // Append a short random suffix to guarantee uniqueness (e.g., GER-X2)
        safeCode = `${safeCode}-${Math.random().toString(36).substring(2, 4).toUpperCase()}`;

        const body = {
          code: safeCode,
          name: safeName,
          currency: selectedProject.currency || "AOA",
          active: true
        };
        const newCc = await apiRequest(`/cost-centers/project/${selectedProject.id}`, { method: "POST", body });
        importMapping[group.sheetGroupName] = newCc.id || newCc.ccId || (newCc.items && newCc.items[0]?.id) || newCc;
        // In case the API returns the object differently, we try a few id paths. Usually just newCc.id.
        if (typeof newCc === 'object' && newCc.id) {
          importMapping[group.sheetGroupName] = newCc.id;
        }
      } catch (err) {
        errors.push(`Erro ao criar CC ${group.sheetGroupName}: ${err.message}`);
        importMapping[group.sheetGroupName] = null; // Prevent importing items for this CC
      }
    }
  }

  // Build list of items to import
  const toImport = [];
  for (const group of importParsedGroups) {
    let ccId = importMapping[group.sheetGroupName];
    if (!ccId || ccId === "CREATE_NEW") continue; // Skip if failed to create or ignored
    // Just to ensure ccId is a string, if api returned an object fallback
    if (typeof ccId === "object" && ccId.id) ccId = ccId.id;

    for (const item of group.items) {
      toImport.push({ ccId, ...item });
    }
  }

  if (toImport.length === 0 && errors.length === 0) {
    showToast("Nenhum item para importar", "warning");
    updateImportStepUI(1);
    return;
  }

  // Get responsible name — use the first available user or a fallback
  let responsibleName = null;
  try {
    const ud = await apiRequest("/users/receivers");
    if (ud.items && ud.items.length > 0) responsibleName = ud.items[0].name || ud.items[0].email;
  } catch { /* ignore — responsible is optional */ }

  for (const item of toImport) {
    try {
      const body = {
        costCenterId: item.ccId,
        description: item.description,
        unit: item.unit || null,
        quantity: item.quantity || null,
        unitPrice: item.unitPrice || null,
        hours: item.hours || null,
        priority: item.priority || "MEDIA",
        status: item.status || "PENDING",
        responsible: responsibleName || null,
      };
      await apiRequest(`/cost-centers/${item.ccId}/needs`, { method: "POST", body });
      done++;
    } catch (err) {
      errors.push(`"${item.description.substring(0, 40)}": ${err.message}`);
    }

    // Update progress
    const pct = Math.round((done / toImport.length) * 100);
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressLabel) progressLabel.textContent = `A importar itens... (${pct}%)`;
    if (progressSub) progressSub.textContent = `${done} de ${toImport.length} itens processados`;
  }

  // Step 5: Done
  updateImportStepUI(5);
  document.getElementById("importDoneTitle").textContent =
    done > 0 ? "Importação concluída!" : "Sem itens importados";
  document.getElementById("importDoneSub").textContent =
    `${done} de ${toImport.length} itens importados com sucesso.`;

  if (errors.length > 0) {
    const errDiv = document.getElementById("importDoneErrors");
    const errList = document.getElementById("importDoneErrorList");
    errDiv.classList.remove("hidden");
    errList.innerHTML = errors.slice(0, 10).map(e => `<li>${e}</li>`).join("");
    if (errors.length > 10) errList.innerHTML += `<li>...e mais ${errors.length - 10} erros.</li>`;
  }

  // Refresh data
  if (done > 0) {
    showToast(`${done} itens importados com sucesso!`, "success");
    await Promise.all([loadNeeds(), loadSummary()]);
    // Switch to the needs tab when modal is closed
    const cancelBtn = document.getElementById("importBtnCancel");
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        closeImportModal();
        switchTab("necessidades");
      };
    }
  }
}
