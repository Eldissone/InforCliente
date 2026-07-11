import { apiRequest } from "/services/api.js";
import { guardPageAccess, initPermissionLayer, can } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, openModal, toast } from "/shared/ui.js";
import { formatCurrency, formatDateBR } from "/shared/format.js";
import {
  resolveTimelineStatus,
  TIMELINE_STATUS,
} from "/shared/paymentTimeline.js";
import { renderPaymentGantt, getDateRangeForView, KPI_PERIOD_LABELS } from "/shared/paymentGantt.js";
import { initPaymentDetailAside } from "/shared/paymentDetailAside.js";

let allProjects = [];
let ganttViewMode = "month";
let calendarAnchor = new Date();
calendarAnchor.setHours(0, 0, 0, 0);
let timelineCache = { days: [], total: 0 };
let auditCache = { items: [], summary: null };
let canCertifyExpenses = false;

const CERT_STATUS = {
  PENDENTE: { label: "Por certificar", badge: "bg-amber-100 text-amber-700", icon: "pending_actions" },
  CONFORME: { label: "Conforme", badge: "bg-emerald-100 text-emerald-700", icon: "verified" },
  DIVERGENTE: { label: "Divergente", badge: "bg-red-100 text-red-700", icon: "gpp_bad" },
};

const TIMELINE_ICONS = {
  PENDENTE: "schedule",
  VENCIDO: "error",
  PAGO: "check_circle",
  CANCELADO: "block",
};

function escapeAttr(value) {
  return String(value || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

function renderStatusBadge(label, badgeClass, icon) {
  return `
    <span class="fin-status-badge ${badgeClass}">
      <span class="material-symbols-outlined">${icon}</span>
      ${label}
    </span>`;
}

function renderIconBtn(icon, title, variant = "slate", { attrs = "", disabled = false } = {}) {
  const disabledAttr = disabled ? "disabled" : "";
  const mutedClass = disabled ? " fin-icon-btn--muted" : "";
  return `
    <button type="button" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}"
      class="fin-icon-btn fin-icon-btn--${variant}${mutedClass}" ${disabledAttr} ${attrs}>
      <span class="material-symbols-outlined text-base">${icon}</span>
    </button>`;
}

(async () => {
  const ok = await guardPageAccess("financeiro", "view");
  if (!ok) return;
  await initPermissionLayer();
  canCertifyExpenses = can("financeiro", "certify_expense");
  wireLogout();
  wireUsersNav();
  initMobileMenu();
  initPaymentDetailAside({
    onLiquidated: reloadAll,
    showToast: (msg, type) => toast(msg, { type }),
  });
  bindEvents();
  syncGanttViewButtons();
  await loadProjects();
  await reloadAll();
})();

function bindEvents() {
  document.querySelectorAll(".fin-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fin-tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".fin-tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add("active");
      if (btn.dataset.tab === "auditoria") loadAuditList();
    });
  });

  ["finProjFilter", "finStatusFilter", "finSearch", "finIncludePaid"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", reloadAll);
    document.getElementById(id)?.addEventListener("input", debounce(reloadAll, 350));
  });

  ["auditProjFilter", "auditStatusFilter", "auditSearch"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", loadAuditList);
    document.getElementById(id)?.addEventListener("input", debounce(loadAuditList, 350));
  });

  document.querySelectorAll("[data-gantt-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.ganttView;
      if (mode === ganttViewMode) return;
      ganttViewMode = mode;
      if (mode === "month") {
        calendarAnchor.setDate(1);
      }
      syncGanttViewButtons();
      reloadAll();
    });
  });

  document.getElementById("calPrev")?.addEventListener("click", () => navigateCalendar(-1));
  document.getElementById("calNext")?.addEventListener("click", () => navigateCalendar(1));
  document.getElementById("calToday")?.addEventListener("click", () => {
    calendarAnchor = new Date();
    calendarAnchor.setHours(0, 0, 0, 0);
    if (ganttViewMode === "month") {
      calendarAnchor.setDate(1);
    }
    reloadAll();
  });
}

function isViewingCurrentPeriod() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { from, to } = getDateRangeForView(ganttViewMode, calendarAnchor);

  if (ganttViewMode === "day") {
    return calendarAnchor.getTime() === today.getTime();
  }
  if (ganttViewMode === "week") {
    const fromDay = new Date(from);
    fromDay.setHours(0, 0, 0, 0);
    const toDay = new Date(to);
    toDay.setHours(0, 0, 0, 0);
    return today >= fromDay && today <= toDay;
  }
  return (
    calendarAnchor.getFullYear() === today.getFullYear()
    && calendarAnchor.getMonth() === today.getMonth()
  );
}

function syncTodayButton() {
  const btn = document.getElementById("calToday");
  if (!btn) return;
  btn.classList.toggle("active", isViewingCurrentPeriod());
}

function syncGanttViewButtons() {
  document.querySelectorAll("[data-gantt-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.ganttView === ganttViewMode);
  });
  const kpiLabel = document.getElementById("kpiPeriodTotalLabel");
  if (kpiLabel) {
    kpiLabel.textContent = KPI_PERIOD_LABELS[ganttViewMode] || KPI_PERIOD_LABELS.month;
  }
  syncTodayButton();
}

function navigateCalendar(direction) {
  const next = new Date(calendarAnchor);
  if (ganttViewMode === "day") {
    next.setDate(next.getDate() + direction);
  } else if (ganttViewMode === "week") {
    next.setDate(next.getDate() + direction * 7);
  } else {
    next.setMonth(next.getMonth() + direction);
    next.setDate(1);
  }
  calendarAnchor = next;
  calendarAnchor.setHours(0, 0, 0, 0);
  syncTodayButton();
  reloadAll();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function loadProjects() {
  try {
    const data = await apiRequest("/projects?pageSize=100&sort=updatedAt_desc");
    allProjects = data.items || [];
    const sel = document.getElementById("finProjFilter");
    if (sel) {
      sel.innerHTML = `<option value="">Todas as Obras</option>` +
        allProjects.map((p) => `<option value="${p.id}">${p.name}${p.code ? ` (${p.code})` : ""}</option>`).join("");
    }
    const auditSel = document.getElementById("auditProjFilter");
    if (auditSel) {
      auditSel.innerHTML = `<option value="">Todas as Obras</option>` +
        allProjects.map((p) => `<option value="${p.id}">${p.name}${p.code ? ` (${p.code})` : ""}</option>`).join("");
    }
  } catch (err) {
    console.error(err);
  }
}

function getFilters() {
  const params = new URLSearchParams();
  const projectId = document.getElementById("finProjFilter")?.value;
  const status = document.getElementById("finStatusFilter")?.value;
  const search = document.getElementById("finSearch")?.value?.trim();
  const includePaid = document.getElementById("finIncludePaid")?.checked;

  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  params.set("onlyVisible", "false");
  if (includePaid) params.set("includePaid", "true");

  const { from, to } = getDateRangeForView(ganttViewMode, calendarAnchor);
  params.set("dateFrom", from.toISOString());
  params.set("dateTo", to.toISOString());

  return params;
}

async function fetchTimeline() {
  const params = getFilters();
  return apiRequest(`/cost-centers/payments/timeline?${params}`);
}

async function reloadAll() {
  const grid = document.getElementById("calendarGrid");
  const planBody = document.getElementById("planTableBody");
  if (grid) grid.innerHTML = `<div class="spinner my-8"></div>`;
  if (planBody) planBody.innerHTML = `<tr><td colspan="7"><div class="spinner my-8"></div></td></tr>`;

  try {
    timelineCache = await fetchTimeline();
    updateKPIs(timelineCache);
    renderCalendar();
    renderPlanTable(timelineCache.days);
    syncTodayButton();
  } catch (err) {
    if (grid) grid.innerHTML = `<p class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</p>`;
    if (planBody) planBody.innerHTML = `<tr><td colspan="7"><p class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</p></td></tr>`;
  }
}

function updateKPIs(data) {
  let pending = 0;
  let overdue = 0;
  let monthTotal = 0;

  (data.days || []).forEach((day) => {
    day.items.forEach((p) => {
      const st = p.timelineStatus || resolveTimelineStatus(p);
      if (st === "PENDENTE") pending += 1;
      if (st === "VENCIDO") overdue += 1;
      monthTotal += Number(p.budgetedAmount || 0);
    });
  });

  document.getElementById("kpiPending").textContent = String(pending);
  document.getElementById("kpiOverdue").textContent = String(overdue);
  document.getElementById("kpiMonthTotal").textContent = formatCurrency(monthTotal, "AOA");
  document.getElementById("kpiTotal").textContent = String(data.total || 0);
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  if (!grid) return;
  const { from, to } = getDateRangeForView(ganttViewMode, calendarAnchor);
  grid.innerHTML = renderPaymentGantt(timelineCache.days, {
    viewMode: ganttViewMode,
    periodFrom: from,
    periodTo: to,
    onPaymentClick: "window.openGanttPayment",
  });
}

window.openGanttPayment = function (btn) {
  try {
    const payload = JSON.parse(btn.getAttribute("data-payload"));
    const st = payload.timelineStatus || resolveTimelineStatus(payload);
    const isPending = st === "PENDENTE" || st === "VENCIDO";
    openPaymentAside(payload, isPending ? "PAYMENT" : "VIEW");
  } catch (err) {
    console.error("Erro ao abrir pagamento no Gantt:", err);
    toast("Não foi possível abrir os detalhes do pagamento.", { type: "error" });
  }
};

function renderPlanTable(days) {
  const tbody = document.getElementById("planTableBody");
  if (!tbody) return;

  if (!days?.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="py-12 text-center text-slate-400">
            <span class="material-symbols-outlined text-4xl text-slate-300 mb-2 block">event_busy</span>
            <p class="text-sm font-semibold">Sem pagamentos no período seleccionado.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = days.map((day) => {
    const dayHeader = `
      <tr class="fin-day-header">
        <td colspan="7">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-base text-slate-400">calendar_today</span>
            <span class="text-xs font-black uppercase tracking-wide text-slate-600">${formatDateBR(day.date)}</span>
            <span class="text-[10px] font-bold text-slate-400">${day.count} pagamento(s)</span>
          </div>
        </td>
      </tr>`;

    const rows = day.items.map((p) => {
      const st = p.timelineStatus || resolveTimelineStatus(p);
      const meta = TIMELINE_STATUS[st] || TIMELINE_STATUS.PENDENTE;
      const icon = TIMELINE_ICONS[st] || TIMELINE_ICONS.PENDENTE;
      const cur = p.costCenter?.currency || "AOA";
      const payload = escapeAttr(JSON.stringify(p));
      const isPending = st === "PENDENTE" || st === "VENCIDO";
      const viewType = isPending ? "PAYMENT" : "VIEW";

      return `
        <tr class="group">
          <td class="fin-empty-cell">—</td>
          <td class="text-xs font-bold text-slate-700 max-w-[140px] truncate" title="${escapeAttr(p.project?.name)}">${p.project?.name || "—"}</td>
          <td class="text-sm font-medium text-slate-900 max-w-xs truncate" title="${escapeAttr(p.description)}">${p.description || "—"}</td>
          <td class="text-xs text-slate-500 max-w-[160px] truncate">${p.costCenter?.code || "—"} · ${p.costCenter?.name || ""}</td>
          <td class="text-right text-sm font-bold text-slate-900 tabular-nums">${formatCurrency(p.budgetedAmount, cur)}</td>
          <td class="text-center">${renderStatusBadge(meta.label, meta.badge, icon)}</td>
          <td class="text-center">
            <div class="fin-actions">
              ${renderIconBtn("visibility", "Ver detalhes", "blue", {
                attrs: `onclick="openPaymentAsideHandler(this)" data-payload='${payload}' data-type="${viewType}"`,
              })}
            </div>
          </td>
        </tr>`;
    }).join("");

    return dayHeader + rows;
  }).join("");
}

function getAuditFilters() {
  const params = new URLSearchParams();
  const projectId = document.getElementById("auditProjFilter")?.value;
  const certificationStatus = document.getElementById("auditStatusFilter")?.value;
  const search = document.getElementById("auditSearch")?.value?.trim();
  if (projectId) params.set("projectId", projectId);
  if (certificationStatus) params.set("certificationStatus", certificationStatus);
  if (search) params.set("search", search);
  params.set("pageSize", "50");
  return params;
}

async function loadAuditList() {
  const tbody = document.getElementById("auditTableBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="spinner my-8"></div></td></tr>`;

  try {
    const params = getAuditFilters();
    const data = await apiRequest(`/cost-centers/payments/audit?${params}`);
    auditCache = data;
    updateAuditKPIs(data.summary);
    renderAuditTable(data.items || []);
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8"><p class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</p></td></tr>`;
    }
  }
}

function updateAuditKPIs(summary) {
  if (!summary) return;
  document.getElementById("auditKpiPending").textContent = String(summary.pending ?? 0);
  document.getElementById("auditKpiConforme").textContent = String(summary.conforme ?? 0);
  document.getElementById("auditKpiDivergente").textContent = String(summary.divergente ?? 0);
  document.getElementById("auditKpiTotal").textContent = String(summary.total ?? 0);
}

function renderAuditTable(items) {
  const tbody = document.getElementById("auditTableBody");
  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="py-12 text-center text-slate-400">
            <span class="material-symbols-outlined text-4xl text-slate-300 mb-2 block">fact_check</span>
            <p class="text-sm font-semibold">Sem faturas liquidadas para auditoria.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = items.map((p) => {
    const cur = p.costCenter?.currency || "AOA";
    const cert = CERT_STATUS[p.certificationStatus] || CERT_STATUS.PENDENTE;
    const payload = escapeAttr(JSON.stringify(p));

    const faturaCell = p.faturaUrl
      ? `<div class="fin-actions">${renderIconBtn("receipt_long", "Ver fatura", "blue", {
          attrs: `onclick="openPaymentAsideHandler(this)" data-payload='${payload}' data-type="VIEW" data-focus="fatura"`,
        })}</div>`
      : `<div class="fin-actions">${renderIconBtn("receipt_long", "Sem fatura", "slate", { disabled: true })}</div>`;

    let actionsHtml = `<div class="fin-actions">`;
    if (canCertifyExpenses && p.certificationStatus === "PENDENTE") {
      actionsHtml += renderIconBtn("fact_check", "Certificar despesa", "emerald", {
        attrs: `data-certify="${p.id}" data-cc="${p.costCenterId}"`,
      });
    } else if (p.certifiedBy) {
      actionsHtml += renderIconBtn("verified_user", `Certificado por ${p.certifiedBy}`, "slate", { disabled: true });
    } else {
      actionsHtml += renderIconBtn("lock", "Sem permissão para certificar", "slate", { disabled: true });
    }
    actionsHtml += `</div>`;

    return `
      <tr class="group">
        <td class="text-xs text-slate-500 tabular-nums">${formatDateBR(p.paymentDate)}</td>
        <td class="text-xs font-bold text-slate-700 max-w-[140px] truncate" title="${escapeAttr(p.project?.name)}">${p.project?.name || "—"}</td>
        <td class="text-sm font-medium text-slate-900 max-w-xs truncate" title="${escapeAttr(p.description)}">${p.description || "—"}</td>
        <td class="text-xs text-slate-500 max-w-[120px] truncate">${p.supplierName || p.supplier || "—"}</td>
        <td class="text-right text-sm font-bold text-slate-900 tabular-nums">${formatCurrency(p.paidAmount, cur)}</td>
        <td class="text-center">${faturaCell}</td>
        <td class="text-center">${renderStatusBadge(cert.label, cert.badge, cert.icon)}</td>
        <td class="text-center">${actionsHtml}</td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-certify]").forEach((btn) => {
    btn.addEventListener("click", () => openCertifyModal(btn.dataset.certify, btn.dataset.cc));
  });
}

async function openCertifyModal(payId, costCenterId) {
  try {
    const { payment, analysis } = await apiRequest(
      `/cost-centers/${costCenterId}/payments/${payId}/certification-preview`
    );
    const cur = payment.costCenter?.currency || "AOA";
    const suggested = CERT_STATUS[analysis.suggestedStatus] || CERT_STATUS.PENDENTE;

    const evidenceHtml = analysis.evidence?.length
      ? analysis.evidence.map((e) => `
          <li class="text-xs text-slate-600 flex justify-between gap-2 py-1 border-b border-slate-50">
            <span>${e.type.replace(/_/g, " ")} · ${e.label || "—"}</span>
            <span class="font-bold tabular-nums">${formatCurrency(e.amount, cur)}</span>
          </li>`).join("")
      : `<li class="text-xs text-slate-400 py-2">Nenhum movimento financeiro correspondente encontrado automaticamente.</li>`;

    openModal({
      title: "Certificar despesa",
      contentHtml: `
        <div class="space-y-4">
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <p class="text-sm font-bold text-slate-900">${payment.description || "—"}</p>
            <p class="text-xs text-slate-500 mt-1">${payment.project?.name || "—"} · ${payment.costCenter?.code || "—"}</p>
            <p class="text-lg font-bold text-slate-900 mt-2">${formatCurrency(payment.paidAmount, cur)}</p>
          </div>
          <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Análise automática</p>
            <p class="text-xs text-slate-600 mb-2">${analysis.reason}</p>
            <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${suggested.badge}">Sugestão: ${suggested.label}</span>
          </div>
          <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Histórico financeiro encontrado</p>
            <ul class="max-h-40 overflow-y-auto custom-scroll">${evidenceHtml}</ul>
            <p class="text-xs font-bold text-slate-700 mt-2 text-right">Total: ${formatCurrency(analysis.evidenceTotal || 0, cur)}</p>
          </div>
          <div>
            <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Estado de certificação</label>
            <select id="certStatusSelect" class="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm font-semibold">
              <option value="CONFORME" ${analysis.suggestedStatus === "CONFORME" ? "selected" : ""}>Conforme</option>
              <option value="DIVERGENTE" ${analysis.suggestedStatus === "DIVERGENTE" ? "selected" : ""}>Divergente</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Notas (opcional)</label>
            <textarea id="certNotesInput" rows="3" class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" placeholder="Observações da auditoria...">${analysis.reason || ""}</textarea>
          </div>
        </div>`,
      primaryLabel: "Certificar",
      secondaryLabel: "Cancelar",
      onPrimary: async ({ close, panel }) => {
        const status = panel.querySelector("#certStatusSelect")?.value;
        const notes = panel.querySelector("#certNotesInput")?.value?.trim();
        await apiRequest(`/cost-centers/${costCenterId}/payments/${payId}/certify`, {
          method: "PATCH",
          body: JSON.stringify({ status, notes }),
        });
        toast("Despesa certificada com sucesso.", { type: "success" });
        close();
        await loadAuditList();
      },
    });
  } catch (err) {
    toast(err.message || "Erro ao carregar análise.", { type: "error" });
  }
}
