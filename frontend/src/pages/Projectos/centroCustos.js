import { apiRequest, getAssetUrl } from "/services/api.js";
import { guardPageAccess, initPermissionLayer } from "/shared/permissions.js";
import { getSessionUser, logout } from "/services/auth.js";
import { formatCurrency, formatDateBR } from "/shared/format.js";

// ── State ──────────────────────────────────────────────────────────────────────
let allProjects = [];
let selectedProject = null;
let costCenters = [];
let currentCC = null;
let currentTxStatus = "PENDING"; // Add variable to keep track of segmented tab
let dashSummary = null;
let chartInstance = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────────
(async () => {
  const ok = await guardPageAccess("obras", "view");
  if (!ok) return;

  const map = await initPermissionLayer();
  bootNav(map);
  await loadProjects();
  bindEvents();

  // Se veio URL com ?projectId=xxx, selecionar automaticamente
  const urlPid = new URLSearchParams(window.location.search).get("projectId");
  if (urlPid) {
    const p = allProjects.find((x) => x.id === urlPid);
    if (p) selectProject(p);
  }
})();

// ── Nav Bindings ───────────────────────────────────────────────────────────────
function bootNav(map) {
  const user = getSessionUser();
  // role badge
  document.querySelectorAll("[data-user-role]").forEach((el) => {
    el.textContent = user?.name || user?.email || "Utilizador";
  });
  // logout
  document.querySelectorAll("[data-logout]").forEach((btn) =>
    btn.addEventListener("click", () => { logout(); window.location.href = "/Auth/login.html"; })
  );
  // nav visibility
  const navDash   = document.querySelector("[data-nav-dashboard]");
  const navUsers  = document.querySelector("[data-nav-users]");
  if (navDash && !map["dashboard:view"]) navDash.classList.add("hidden");
  if (navUsers && (user?.role || "").toLowerCase() === "admin") navUsers.classList.remove("hidden");
}

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

  // Click events
  list.querySelectorAll(".proj-card").forEach((card) => {
    card.addEventListener("click", () => {
      const p = allProjects.find((x) => x.id === card.dataset.pid);
      if (p) selectProject(p);
    });
  });
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
  document.getElementById("noProjectState").classList.add("hidden");
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
    renderKPIs(data.totals);
    renderDashTable(data.summary);
    renderChart(data.summary);
    renderAlerts(data.summary);
    // Dashboard extra cards
    loadWeeklyBreakdown();
    loadTopExpenses();
  } catch (err) {
    showToast("Erro ao carregar resumo: " + err.message, "error");
  }
}

// ── KPIs ───────────────────────────────────────────────────────────────────────
function renderKPIs(totalsByCurrency) {
  if (!totalsByCurrency) return;
  const previstoEl = document.getElementById("kpiPrevisto");
  const pagoEl = document.getElementById("kpiPago");
  const saldoEl = document.getElementById("kpiSaldo");

  previstoEl.innerHTML = "";
  pagoEl.innerHTML = "";
  saldoEl.innerHTML = "";

  const currencies = Object.keys(totalsByCurrency);
  if (currencies.length === 0) {
    previstoEl.innerHTML = `<p class="text-xl font-bold text-slate-900 tracking-tight">—</p>`;
    pagoEl.innerHTML = `<p class="text-xl font-bold text-slate-900 tracking-tight">—</p>`;
    saldoEl.innerHTML = `<p class="text-xl font-bold text-slate-900 tracking-tight">—</p>`;
    document.getElementById("kpiPct").textContent = "0%";
    return;
  }

  let totalPct = 0;
  currencies.forEach(cur => {
    const t = totalsByCurrency[cur];
    previstoEl.innerHTML += `<p class="text-xl font-bold text-slate-900 tracking-tight" title="${cur}">${formatCurrency(t.budgeted, cur)}</p>`;
    pagoEl.innerHTML += `<p class="text-xl font-bold text-slate-900 tracking-tight" title="${cur}">${formatCurrency(t.paid, cur)}</p>`;
    
    const color = t.saldo < 0 ? "text-red-600" : "text-emerald-600";
    saldoEl.innerHTML += `<p class="text-xl font-bold tracking-tight ${color}" title="${cur}">${formatCurrency(t.saldo, cur)}</p>`;
    
    totalPct += t.pctExecutado || 0;
  });

  const avgPct = currencies.length > 0 ? (totalPct / currencies.length) : 0;
  const pct = Math.min(100, avgPct);
  document.getElementById("kpiPct").textContent = pct.toFixed(1) + "%";
  
  setTimeout(() => {
    const bar = document.getElementById("kpiBar");
    bar.style.width = pct + "%";
    bar.className = `prog-bar ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-[#2afc8d]"}`;
  }, 50);
}

// ── Chart ──────────────────────────────────────────────────────────────────────
function renderChart(summary) {
  const canvas = document.getElementById("dashChart");
  if (!canvas) return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  if (!summary?.length) return;

  const labels = summary.map((cc) => `${cc.code} · ${cc.name}`);
  const budgeted = summary.map((cc) => cc.budgeted);
  const paid = summary.map((cc) => cc.paid);

  chartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Previsto",
          data: budgeted,
          backgroundColor: "rgba(59,130,246,0.15)",
          borderColor: "rgba(59,130,246,0.8)",
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          label: "Pago",
          data: paid,
          backgroundColor: "rgba(42,252,141,0.15)",
          borderColor: "rgba(42,252,141,0.9)",
          borderWidth: 2,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: "top", labels: { font: { size: 11, weight: "700" }, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const cc = summary[ctx.dataIndex];
              return ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y, cc.currency || "AOA")}`;
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v) => {
              if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
              if (v >= 1_000) return (v / 1_000).toFixed(0) + "k";
              return v;
            },
            font: { size: 10 },
          },
          grid: { color: "#f1f5f9" },
        },
        x: { ticks: { font: { size: 10 }, maxRotation: 30 }, grid: { display: false } },
      },
    },
  });
}

// ── Alerts ─────────────────────────────────────────────────────────────────────
function renderAlerts(summary) {
  const el = document.getElementById("alertsList");
  const overflows = (summary || []).filter((cc) => cc.overflow);
  if (!overflows.length) {
    el.innerHTML = `<p class="text-xs text-slate-500 text-center mt-6">Sem alertas de estouro 🎉</p>`;
    return;
  }
  el.innerHTML = overflows.map((cc) => `
    <div class="flex items-start gap-3 bg-red-500/10 rounded-xl p-3 border border-red-500/20">
      <span class="material-symbols-outlined text-red-400 text-base flex-shrink-0">warning</span>
      <div class="min-w-0">
        <p class="text-xs font-bold text-white truncate">${cc.code} · ${cc.name}</p>
        <p class="text-[10px] text-slate-400 mt-0.5">
          Pago: ${formatCurrency(cc.paid, cc.currency || "AOA")} |
          Previsto: ${formatCurrency(cc.budgeted, cc.currency || "AOA")}
        </p>
        <p class="text-[10px] font-bold text-red-400 mt-0.5">Desvio: +${Math.abs(cc.desvio).toFixed(1)}%</p>
      </div>
    </div>
  `).join("");
}

function renderDashTable(summary) {
  const tbody = document.getElementById("dashTableBody");
  if (!summary?.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p class="text-xs">Sem dados</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = summary.map((cc) => {
    const cur = cc.currency || "AOA";
    const desvioStr = cc.budgeted > 0
      ? `<span class="${cc.overflow ? "text-red-600 font-bold" : "text-emerald-600 font-bold"}">${cc.desvio > 0 ? "+" : ""}${cc.desvio.toFixed(1)}%</span>`
      : "—";
    const pct = Math.min(100, cc.pctExecutado);
    return `
    <tr class="${cc.overflow ? "overflow-row" : ""}">
      <td class="font-bold text-slate-600">${cc.code}</td>
      <td class="font-semibold text-slate-900">${cc.name}</td>
      <td class="text-right tabular-nums font-medium">${formatCurrency(cc.budgeted, cur)}</td>
      <td class="text-right tabular-nums font-medium">${formatCurrency(cc.paid, cur)}</td>
      <td class="text-right tabular-nums font-medium ${cc.saldo < 0 ? "text-red-600" : "text-emerald-600"}">${formatCurrency(cc.saldo, cur)}</td>
      <td class="text-right">${desvioStr}</td>
      <td class="text-center">
        <div class="flex items-center gap-2">
          <div class="prog-bar-wrap flex-1" style="min-width:60px">
            <div class="prog-bar ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-500"}" style="width:${pct}%"></div>
          </div>
          <span class="text-xs font-bold text-slate-600">${pct.toFixed(0)}%</span>
        </div>
      </td>
      <td class="text-center">
        ${cc.overflow
          ? `<span class="overflow-badge"><span class="material-symbols-outlined text-xs">warning</span>Estouro</span>`
          : `<span class="text-xs font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-600">OK</span>`
        }
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
      <p class="text-xs">Clica em "CCs Padrão" para adicionar os centros mais comuns.</p>
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
    const params = new URLSearchParams({ pageSize: "100" });
    if (ccId) params.set("costCenterId", ccId);
    if (status) params.set("status", status);

    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/needs?${params}`);
    const items = (data.items || [])
      .slice()
      .sort((a, b) => new Date(a.createdAt || a.date || 0) - new Date(b.createdAt || b.date || 0))
      .map((item, index) => ({ ...item, _orderNumber: index + 1 }));

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><span class="material-symbols-outlined text-3xl">assignment</span><p class="text-sm font-semibold">Sem itens de orçamento registados</p></div></td></tr>`;
      return;
    }

    const priorityLabels = { ALTA: "🔴 Alta", MEDIA: "🟡 Média", BAIXA: "🟢 Baixa" };
    const statusLabels = { PENDING: "Pendente", IN_QUOTATION: "Em Cotação", APPROVED: "Aprovado", REJECTED: "Rejeitado", PAID: "Pago" };
    const statusClasses = { PENDING: "badge-pending", IN_QUOTATION: "badge-in-quotation", APPROVED: "badge-approved", REJECTED: "badge-rejected", PAID: "badge-paid" };
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
      const price = Number(n.unitPrice) || 0;
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

    const currency = selectedProject?.currency || "AOA";
    
    let html = `
      <tr class="bg-emerald-600">
        <td class="font-bold text-white text-sm" colspan="2">Total Geral</td>
        <td colspan="3"></td>
        <td class="text-right font-bold text-white text-sm">${formatCurrency(totalObraGeral, currency)}</td>
        <td class="text-right font-bold text-white text-sm">${formatCurrency(totalSemanaGeral, currency)}</td>
        <td colspan="4"></td>
        <td colspan="4"></td>
      </tr>
    `;

    for (const [ccName, group] of Object.entries(grouped)) {
      html += `
        <tr class="bg-slate-100 border-t border-slate-200">
        <td colspan="2"></td>
        <td class="font-bold text-slate-800 uppercase text-xs" colspan="3">${ccName}</td>
          <td class="text-right font-bold text-slate-800 text-xs">${formatCurrency(group.totalObra, group.currency)}</td>
          <td class="text-right font-bold text-slate-800 text-xs">${formatCurrency(group.totalSemana, group.currency)}</td>
          <td colspan="4"></td>
          <td colspan="4"></td>
        </tr>
      `;

      html += group.items.map((n) => {
      const qty = Number(n.quantity) || 0;
      const price = Number(n.unitPrice) || 0;
      const hours = Number(n.hours) || 1;
      const totalObra = qty * price * hours;
      
      return `
        <tr>
          <!--<td class="text-xs text-slate-500">${formatDateBR(n.date)}</td>
          <td><span class="text-xs font-bold text-slate-600">${n.costCenter?.code || "—"}</span> <span class="text-xs text-slate-400">${n.costCenter?.name || ""}</span></td>-->
          <td class="text-center"><span class="inline-flex min-w-8 h-7 items-center justify-center rounded-lg bg-slate-100 text-xs font-black text-slate-600 tabular-nums">${n._orderNumber}</span></td>
          <td class="font-medium text-slate-900 max-w-xs truncate">${n.description}</td>
          <td class="text-center text-sm font-bold text-slate-700">${n.unit || "—"}</td>
          <td class="text-center text-sm font-bold text-slate-700">${n.quantity ? Number(n.quantity).toLocaleString("pt-PT", {minimumFractionDigits: 2}) : "—"}</td>
          <td class="text-right text-sm font-bold text-slate-700">${n.unitPrice ? Number(n.unitPrice).toLocaleString("pt-PT", {minimumFractionDigits: 2}) : "—"}</td>
          <td class="text-center text-sm font-bold text-slate-700">${n.hours ? Number(n.hours).toLocaleString("pt-PT", {minimumFractionDigits: 2}) : "—"}</td>
          <td class="text-right text-sm font-bold text-slate-900">${formatCurrency(totalObra, n.costCenter?.currency || "AOA")}</td>
          <td class="text-right text-sm font-bold text-slate-900">${formatCurrency(n._calcTotalSemana, n.costCenter?.currency || "AOA")}</td>
          <td class="text-center"><span class="text-xs font-bold px-2.5 py-1 rounded-full ${prioClasses[n.priority] || ""}">${priorityLabels[n.priority] || n.priority}</span></td>
          <td class="text-sm text-slate-500">${n.responsible || "—"}</td>
          <td class="text-center"><span class="text-xs font-bold px-2.5 py-1 rounded-full ${statusClasses[n.status] || "badge-pending"}">${statusLabels[n.status] || n.status}</span></td>
          <td class="text-center">
            <div class="flex justify-center gap-2">
              ${n.status === "PENDING" || n.status === "IN_QUOTATION" ? `
              <button onclick="sendToQuotation('${n.id}', '${n.costCenterId}')" title="Cotação / Precificação"
                class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-[#2afc8d]/20 hover:text-green-600 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">request_quote</span>
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
    const items = data.items || [];
    const cur = selectedProject?.currency || "AOA";

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><span class="material-symbols-outlined text-3xl">receipt_long</span><p class="text-sm font-semibold">Sem lançamentos registados</p></div></td></tr>`;
      return;
    }

    const statusClasses = { PENDENTE: "badge-pendente", CONFIRMADO: "badge-confirmado", CANCELADO: "badge-cancelado" };
    const typeLabels = { PRONTO_PAGAMENTO: "PP", CREDITO: "C" };
    const typeClasses = {
      PRONTO_PAGAMENTO: "bg-red-50 text-red-700 border border-red-200",
      CREDITO: "bg-sky-50 text-sky-700 border border-sky-100",
    };

    tbody.innerHTML = items.map((p) => {
      const cur = p.costCenter?.currency || "AOA";
      return `
      <tr class="cursor-pointer hover:bg-slate-50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${JSON.stringify(p).replace(/'/g, "&#39;")}' data-type="${p.status === 'PENDENTE' ? 'PAYMENT' : 'VIEW'}">
        <td class="text-xs font-bold text-slate-500">${p.docNumber || "—"}</td>
        <td class="text-xs text-slate-500">${formatDateBR(p.paymentDate)}</td>
        <td class="text-sm font-medium text-slate-700 max-w-[120px] truncate">${p.supplier || "—"}</td>
        <td><span class="text-xs font-bold text-blue-600">${p.costCenter?.code || "—"}</span></td>
        <td class="text-sm font-medium text-slate-900 max-w-xs truncate">${p.description}</td>
        <td><span class="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${typeClasses[p.paymentType] || "bg-slate-100 text-slate-500 border border-slate-200"}">${typeLabels[p.paymentType] || "—"}</span></td>
        <td class="text-right tabular-nums text-sm font-medium text-slate-600">${formatCurrency(p.budgetedAmount, cur)}</td>
        <td class="text-right tabular-nums text-sm font-bold ${Number(p.paidAmount) > Number(p.budgetedAmount) ? "text-red-600" : "text-slate-900"}">${formatCurrency(p.paidAmount, cur)}</td>
        <td class="text-center text-xs font-bold text-slate-500">${p.week || "—"}</td>
        <td class="text-center"><span class="text-xs font-bold px-2.5 py-1 rounded-full ${statusClasses[p.status] || "badge-pendente"}">${p.status}</span></td>
        <td class="text-center">
          <div class="flex justify-center gap-2">
            ${p.status === "PENDENTE" ? `
              <button onclick="event.stopPropagation(); openPaymentAsideHandler(this)" data-payload='${JSON.stringify(p).replace(/'/g, "&#39;")}' data-type="PAYMENT" title="Pagar lançamento"
                class="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all text-emerald-600">
                <span class="material-symbols-outlined text-base">payments</span>
              </button>
            ` : ""}
            <button onclick="event.stopPropagation(); editPay(${JSON.stringify(p).replace(/"/g, '&quot;')})" title="Editar lançamento"
              class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-emerald-100 hover:text-emerald-600 transition-all text-slate-500">
              <span class="material-symbols-outlined text-base">edit</span>
            </button>
            <button onclick="event.stopPropagation(); deletePay('${p.id}')" title="Eliminar lançamento"
              class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-all text-slate-500">
              <span class="material-symbols-outlined text-base">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `}).join("");

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
async function loadCronograma() {
  if (!selectedProject) return;
  const tbody = document.getElementById("cronogramaTableBody");
  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner my-8"></div></td></tr>`;

  try {
    const params = new URLSearchParams({ pageSize: "100", scheduled: "true" });
    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/needs?${params}`);
    const items = data.items || [];

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><span class="material-symbols-outlined text-3xl">schedule</span><p class="text-sm font-semibold">Nenhum item agendado</p></div></td></tr>`;
      return;
    }

    const statusLabels = { PENDING: "Pendente", IN_QUOTATION: "Em Cotação", APPROVED: "Aprovado", REJECTED: "Rejeitado", PAID: "Pago" };
    const statusClasses = { PENDING: "badge-pending", IN_QUOTATION: "badge-in-quotation", APPROVED: "badge-approved", REJECTED: "badge-rejected", PAID: "badge-paid" };

    tbody.innerHTML = items.map((n) => {
      const qty = Number(n.quantity) || 0;
      const price = Number(n.unitPrice) || 0;
      const hours = Number(n.hours) || 1;
      const totalObra = qty * price * hours;

      return `
        <tr>
          <td class="font-medium text-slate-900 max-w-xs truncate">${n.description}</td>
          <td class="text-center text-sm font-bold text-slate-700">${n.unit || "—"}</td>
          <td class="text-center text-sm font-bold text-slate-700">${n.quantity ? Number(n.quantity).toLocaleString("pt-PT", {minimumFractionDigits: 2}) : "—"}</td>
          <td class="text-right text-sm font-bold text-slate-700">${n.unitPrice ? Number(n.unitPrice).toLocaleString("pt-PT", {minimumFractionDigits: 2}) : "—"}</td>
          <td class="text-right text-sm font-bold text-slate-900">${formatCurrency(totalObra, n.costCenter?.currency || "AOA")}</td>
          <td class="text-sm text-slate-500">${n.costCenter?.code || "—"} · ${n.costCenter?.name || ""}</td>
          <td class="text-center"><span class="text-xs font-bold px-2.5 py-1 rounded-full ${statusClasses[n.status] || "badge-pending"}">${statusLabels[n.status] || n.status}</span></td>
          <td class="text-center">
            <div class="flex justify-center gap-2">
              <button onclick="openCronogramaModal('${n.id}', '${n.costCenterId}', '${n.description.replace(/'/g, "\\'")}', ${totalObra})" title="Definir Cronograma"
                class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-emerald-100 hover:text-emerald-600 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">calendar_month</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

let currentCronogramaTotal = 0;

window.openCronogramaModal = function(needId, ccId, description, total) {
  currentCronogramaTotal = total;
  document.getElementById("cronogramaNeedId").value = needId;
  document.getElementById("cronogramaCCId").value = ccId;
  document.getElementById("cronogramaItemDesc").textContent = description;
  document.getElementById("cronogramaTotalValue").textContent = formatCurrency(total, selectedProject?.currency || "AOA");
  document.getElementById("cronogramaNumParcelas").value = 1;
  document.getElementById("cronogramaParcelasBody").innerHTML = "";
  gerarParcelasAutomaticas();
  document.getElementById("modalCronograma").classList.add("open");
}

window.gerarParcelasAutomaticas = function() {
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

// ── Send to Cronograma Functions ────────────────────────────────────────────────
window.sendToCronograma = async function(id, ccId) {
  try {
    showToast("A enviar para cronograma...", "info");
    await apiRequest(`/cost-centers/${ccId}/needs/${id}/schedule`, { method: "POST" });
    showToast("Item enviado para cronograma!", "success");
    loadNeeds();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

window.sendAllToCronograma = async function() {
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

  // Seed default CCs
  document.getElementById("seedCCBtn").addEventListener("click", seedCCs);

  // New Need button
  document.getElementById("newNeedBtn").addEventListener("click", () => openNeedModal());

  // New Payment button
  document.getElementById("newPayBtn").addEventListener("click", () => openPayModal());

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
  document.getElementById("formCronograma").addEventListener("submit", submitCronograma);

  // Close modals on overlay click
  ["modalCC", "modalNeed", "modalPay", "modalLiq", "modalCronograma"].forEach((id) => {
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

window.editCC = function(id) {
  const cc = costCenters.find((x) => x.id === id);
  if (cc) openCCModal(cc);
};

window.deleteCC = async function(id, name) {
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

async function seedCCs() {
  if (!confirm("Criar centros de custo padrão para esta obra?")) return;
  try {
    const data = await apiRequest(`/cost-centers/project/${selectedProject.id}/seed`, { method: "POST" });
    showToast(`${data.created} centros de custo criados`, "success");
    await Promise.all([loadCostCenters(), loadSummary()]);
    switchTab("centros");
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

window.addNeedRow = function(need = null) {
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

window.editNeed = function(id) {
  const btn = document.querySelector(`[onclick="editNeed('${id}')"]`);
  if (!btn) return;
  try {
    const raw = btn.getAttribute("data-need-raw");
    const need = JSON.parse(raw);
    openNeedModal(need);
  } catch {}
};

window.deleteNeed = async function(id, desc) {
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

window.sendToQuotation = async function(id, ccId) {
  try {
    showToast("A enviar para cotação...", "info");
    // Muda o status para IN_QUOTATION
    await apiRequest(`/cost-centers/${ccId}/needs/${id}`, { 
      method: "PATCH", 
      body: { status: "IN_QUOTATION" } 
    });
    
    // Redireciona para a página de Cotação com o ID da obra na query string
    window.location.href = `../Projectos/Cotacao/index.html?project=${selectedProject.id}`;
  } catch (err) {
    showToast("Erro ao preparar cotação: " + err.message, "error");
  }
};

window.sendAllToQuotation = async function() {
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
function openPayModal(pay = null) {
  document.getElementById("modalPayTitle").textContent = pay ? "Editar Lançamento" : "Novo Lançamento";
  document.getElementById("payId").value = pay?.id || "";
  document.getElementById("payCCId").value = pay?.costCenterId || "";
  document.getElementById("payCC").value = pay?.costCenterId || "";
  document.getElementById("payDoc").value = pay?.docNumber || "";
  document.getElementById("payDate").value = pay?.paymentDate ? pay.paymentDate.substring(0, 10) : new Date().toISOString().substring(0, 10);
  document.getElementById("paySupplier").value = pay?.supplier || "";
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
}

window.editPay = function(pay) {
  if (typeof pay === "string") pay = JSON.parse(pay);
  openPayModal(pay);
};

window.deletePay = async function(id) {
  if (!confirm("Eliminar este lançamento?")) return;
  try {
    const pay = await apiRequest(`/cost-centers/project/${selectedProject.id}/payments`).then(
      (d) => d.items?.find((p) => p.id === id)
    );
    const ccId = pay?.costCenterId || "X";
    await apiRequest(`/cost-centers/${ccId}/payments/${id}`, { method: "DELETE" });
    showToast("Lançamento eliminado", "success");
    loadPayments();
    loadSummary();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
};

window.payCostPayment = async function(pay) {
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
    await Promise.all([loadPayments(), loadSummary()]);
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
    loadPayments();
    loadSummary();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

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

  const statusFilter = currentTxStatus;
  const catFilter = document.getElementById("txCategoryFilter").value;

  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner my-8"></div></td></tr>`;

  try {
    const data = await apiRequest(
      `/projects/${selectedProject.id}/transactions?page=${txPage}&pageSize=${TX_PAGE_SIZE}&status=${statusFilter}&category=${catFilter}`
    );

    // Update KPIs
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
      const isPaid = t.status === "PAID";
      const statusClass = isPaid ? "badge-approved" : "badge-pendente";
      const statusText = isPaid ? "Liquidado" : "Pendente";

      // Use html encoded description safely
      const descStr = t.description ? t.description.replace(/'/g, "\\'").replace(/"/g, "&quot;") : "";
      const isAPrazo = t.paymentType === "A_PRAZO";
      const paymentTypeStr = isAPrazo ? "A Prazo" : "Pronto Pag.";
      const paymentTypeBadge = `<span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isAPrazo ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}">${paymentTypeStr}</span>`;

      return `
        <tr class="cursor-pointer hover:bg-slate-50/50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${JSON.stringify(t).replace(/'/g, "&#39;")}' data-type="${!isPaid ? 'TRANSACTION' : 'VIEW'}">
          <td class="text-xs text-slate-500">${new Date(t.date).toLocaleDateString("pt-BR")}</td>
          <td class="font-bold text-slate-700">${t.description}</td>
          <td class="text-xs text-slate-500">${t.supplier || "-"}</td>
          <td class="text-xs text-slate-500">${catNames[t.category] || t.category}</td>
          <td class="text-xs text-slate-500">${paymentTypeBadge}</td>
          <td class="text-xs text-slate-500">${t.ownerName || "-"}</td>
          <td class="text-right font-black text-slate-900">${formatCurrency(t.amount, t.currency)}</td>
          <td class="text-right font-black ${isPaid ? 'text-emerald-600' : 'text-slate-400'}">${isPaid ? formatCurrency(t.realizedAmount, t.currency) : "-"}</td>
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
      `/projects/${selectedProject.id}/transactions?page=${historyPage}&pageSize=${TX_PAGE_SIZE}&status=PAID&category=${catFilter}`
    );

    if (data.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="material-symbols-outlined text-3xl">history</span><p class="text-sm font-semibold">Sem histórico de liquidações</p></div></td></tr>`;
      document.getElementById("historyPagination").innerHTML = "";
      return;
    }

    const catNames = {
      MATERIALS: "Materiais", LABOR: "Mão de Obra", EQUIPMENT: "Equipamentos",
      MATERIAIS_INSUMOS: "Materiais/Insumos", SERVICOS_MAO_DE_OBRA: "Serviços/Mão Obra",
      GASTOS_PESSOAL: "Gastos Pessoal", DESPESAS_OPERACIONAIS: "Desp. Operacionais",
      INVESTIMENTOS: "Investimentos", OTHER: "Outro"
    };

    tbody.innerHTML = data.items.map((t) => {
      const isAPrazo = t.paymentType === "A_PRAZO";
      const paymentTypeBadge = `<span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isAPrazo ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}">${isAPrazo ? 'A Prazo' : 'Pronto Pag.'}</span>`;
      return `
        <tr class="cursor-pointer hover:bg-slate-50/50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${JSON.stringify(t).replace(/'/g, "&#39;")}' data-type="VIEW">
          <td class="text-xs text-slate-500">${new Date(t.date).toLocaleDateString("pt-BR")}</td>
          <td class="font-bold text-slate-700">${t.description}</td>
          <td class="text-xs text-slate-500">${t.supplier || "-"}</td>
          <td class="text-xs text-slate-500">${catNames[t.category] || t.category}</td>
          <td class="text-xs text-slate-500">${paymentTypeBadge}</td>
          <td class="text-xs text-slate-500">${t.ownerName || "-"}</td>
          <td class="text-right font-black text-slate-900">${formatCurrency(t.amount, t.currency)}</td>
          <td class="text-right font-black text-emerald-600">${formatCurrency(t.realizedAmount || t.amount, t.currency)}</td>
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
        <button onclick="historyPage=Math.max(1,historyPage-1);loadHistory()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page===1?'opacity-50 pointer-events-none':''}">Anterior</button>
        <button onclick="historyPage=Math.min(${totalPages},historyPage+1);loadHistory()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page===totalPages?'opacity-50 pointer-events-none':''}">Próxima</button>
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
    if (t.status === "PENDING") {
      pending++;
      committed += Number(t.amount);
    } else if (t.status === "PAID") {
      paid += Number(t.realizedAmount || t.amount);
    }
  });

  const currency = items[0]?.currency || "AOA";

  document.getElementById("kpiTxPending").textContent = pending;
  document.getElementById("kpiTxCommitted").textContent = formatCurrency(committed, currency);
  document.getElementById("kpiTxPaid").textContent = formatCurrency(paid, currency);

  const badge = document.getElementById("pendentesCount");
  if (badge) {
    if (pending > 0) {
      badge.textContent = pending;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
}

window.openLiquidateModal = function(txId, description, amount) {
  document.getElementById("liqTxId").value = txId;
  document.getElementById("liqDesc").textContent = description;
  document.getElementById("liqCommitted").value = formatCurrency(amount, "AOA");
  document.getElementById("liqAmount").value = amount;
  document.getElementById("modalLiq").classList.add("open");
};

async function submitLiquidation(e) {
  e.preventDefault();
  const txId = document.getElementById("liqTxId").value;
  const realizedAmount = document.getElementById("liqAmount").value;
  
  if (!realizedAmount) return showToast("Valor é obrigatório", "error");

  try {
    await apiRequest(`/projects/${selectedProject.id}/transactions/${txId}/liquidate`, {
      method: "PATCH",
      body: { realizedAmount: Number(realizedAmount) }
    });
    showToast("Lançamento liquidado com sucesso!", "success");
    document.getElementById("modalLiq").classList.remove("open");
    loadTransactions();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

// ── Sidebar Toggle ────────────────────────────────────────────────────────────
window.toggleSidebar = function() {
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
window.openPaymentAsideHandler = function(btn) {
  try {
    const payload = JSON.parse(btn.getAttribute("data-payload"));
    const type = btn.getAttribute("data-type");
    openPaymentAside(payload, type);
  } catch (err) {
    console.error("Erro ao abrir aside de pagamento:", err);
  }
};

window.openPaymentAside = function(data, type) {
  const aside = document.getElementById("paymentAside");
  const overlay = document.getElementById("paymentAsideOverlay");

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

  const proformaContainer = document.getElementById("asideProformaContainer");
  if (data.proformaUrl) {
    const isImage = data.proformaUrl.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i);
    if (isImage) {
      proformaContainer.innerHTML = `
        <div class="relative w-full h-full flex flex-col items-center justify-center">
          <img src="${getAssetUrl(data.proformaUrl)}" alt="Proforma" class="w-full h-auto object-contain max-h-full rounded-lg shadow-sm border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity" onclick="window.open('${getAssetUrl(data.proformaUrl)}','_blank')">
          <button type="button" onclick="window.open('${getAssetUrl(data.proformaUrl)}','_blank')" class="absolute top-2 right-2 w-8 h-8 bg-white/80 backdrop-blur-md border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white hover:text-emerald-600 transition-all shadow-sm" title="Expandir Imagem">
            <span class="material-symbols-outlined text-[16px]">open_in_new</span>
          </button>
        </div>
      `;
    } else {
      proformaContainer.innerHTML = `
        <div class="relative w-full h-full min-h-[300px]">
          <iframe src="${getAssetUrl(data.proformaUrl)}" class="w-full h-full rounded-lg shadow-sm border border-slate-200"></iframe>
          <button type="button" onclick="window.open('${getAssetUrl(data.proformaUrl)}','_blank')" class="absolute top-2 right-2 w-8 h-8 bg-white/80 backdrop-blur-md border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white hover:text-emerald-600 transition-all shadow-sm" title="Expandir Documento">
            <span class="material-symbols-outlined text-[16px]">open_in_new</span>
          </button>
        </div>
      `;
    }
  } else {
    proformaContainer.innerHTML = `
      <div class="py-8 text-center text-slate-300">
        <span class="material-symbols-outlined text-4xl mb-2">description</span>
        <p class="text-xs font-semibold text-slate-500">Sem documento disponível.</p>
      </div>
    `;
  }

  const actionBtn = document.getElementById("asideActionBtn");
  
  if (type === 'VIEW') {
    actionBtn.classList.add("hidden");
  } else {
    actionBtn.classList.remove("hidden");
    actionBtn.onclick = () => {
      if (type === 'PAYMENT') {
        payCostPayment(data);
      } else if (type === 'TRANSACTION') {
        const descStr = data.description ? data.description.replace(/'/g, "\\'").replace(/"/g, "&quot;") : "";
        openLiquidateModal(data.id, descStr, amount);
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

window.closePaymentAside = function() {
  const aside = document.getElementById("paymentAside");
  const overlay = document.getElementById("paymentAsideOverlay");
  
  aside.classList.add("translate-x-full");
  overlay.classList.add("opacity-0");
  setTimeout(() => overlay.classList.add("hidden"), 300);
};
