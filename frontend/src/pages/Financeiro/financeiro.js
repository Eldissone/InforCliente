import { apiRequest } from "/services/api.js";
import { guardPageAccess, initPermissionLayer, can } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, openModal, toast } from "/shared/ui.js";
import { formatCurrency, formatDateBR } from "/shared/format.js";
import {
  resolveTimelineStatus,
  TIMELINE_STATUS,
} from "/shared/paymentTimeline.js";
import { renderPaymentGantt, getDateRangeForView } from "/shared/paymentGantt.js";
import { initPaymentDetailAside } from "/shared/paymentDetailAside.js";

let allProjects = [];
let ganttViewMode = "month";
let calendarAnchor = new Date();
calendarAnchor.setHours(0, 0, 0, 0);
let timelineCache = { days: [], total: 0 };
let dashboardCache = { days: [], total: 0 };
let extrasDashboardCache = [];
let pendingPaymentsCache = [];
let pendingReinforcementsCache = [];

const EXTRA_SOURCE_LABELS = {
  CAIXA: "Caixa",
  BANCO: "Banco",
  FUNDO_MANEIO: "Fundo de Maneio",
  SOLICITACAO_TRANSFERENCIA: "Transferência bancária",
};
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

const EXTRA_STATUS_META = {
  PENDENTE: { label: "Pendente", badge: "bg-amber-100 text-amber-700", icon: "hourglass_top" },
  APROVADO: { label: "A liquidar", badge: "bg-indigo-100 text-indigo-700", icon: "payments" },
  PAGO: { label: "Pago", badge: "bg-emerald-100 text-emerald-700", icon: "check_circle" },
  REJEITADO: { label: "Rejeitado", badge: "bg-red-100 text-red-700", icon: "block" },
  CANCELADO: { label: "Cancelado", badge: "bg-slate-100 text-slate-600", icon: "block" },
};

function isExtraOnlyFilter() {
  return document.getElementById("finStatusFilter")?.value === "EXTRA";
}

function extraReferenceDate(extra) {
  const raw = extra.approvedAt || extra.requestedAt || extra.createdAt;
  const d = new Date(raw);
  d.setHours(0, 0, 0, 0);
  return d;
}

function mapExtraToTimelineItem(extra) {
  const refDate = extra.approvedAt || extra.requestedAt || extra.createdAt;
  const timelineStatus =
    extra.status === "PAGO"
      ? "PAGO"
      : extra.status === "APROVADO"
        ? "VENCIDO"
        : extra.status === "PENDENTE"
          ? "PENDENTE"
          : "CANCELADO";
  return {
    id: extra.id,
    description: extra.description,
    budgetedAmount: extra.amount,
    paymentDate: refDate,
    project: extra.project,
    costCenter: extra.costCenter,
    currency: extra.currency || "AOA",
    status: extra.status === "PAGO" ? "CONFIRMADO" : "PENDENTE",
    timelineStatus,
    requestedBy: extra.requestedBy,
    _isExtra: true,
    _extraId: extra.id,
  };
}

function buildExtrasTimelineDays(extras) {
  const { from, to } = getDateRangeForView(ganttViewMode, calendarAnchor);
  const dayMap = new Map();

  extras.forEach((extra) => {
    const due = extraReferenceDate(extra);
    if (due < from || due > to) return;
    const key = due.toISOString();
    if (!dayMap.has(key)) {
      dayMap.set(key, { date: key, items: [], count: 0, totalBudgeted: 0 });
    }
    const day = dayMap.get(key);
    const item = mapExtraToTimelineItem(extra);
    day.items.push(item);
    day.count += 1;
    day.totalBudgeted += Number(extra.amount || 0);
  });

  return [...dayMap.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

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
  updateDashboardDate();
  await loadProjects();
  await reloadAll();
  await loadPendingPaymentsQueue();
  const hadExtraDeepLink = new URLSearchParams(window.location.search).get("extraRequestId");
  await handleFinanceiroDeepLink();
  if (!hadExtraDeepLink) await maybeAutoOpenPendingPaymentsModal();
})();

async function handleFinanceiroDeepLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("extraRequestId")) {
    await handleExtraDeepLink();
    return;
  }
  await handlePaymentDeepLink();
}

async function handleExtraDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const extraId = params.get("extraRequestId");
  if (!extraId) return;

  const projectId = params.get("projectId");
  if (projectId) {
    const sel = document.getElementById("finProjFilter");
    if (sel) sel.value = projectId;
    await reloadAll();
  }

  try {
    const extra = await apiRequest(`/extra-requests/${encodeURIComponent(extraId)}`);
    window.history.replaceState({}, "", window.location.pathname);
    openExtraPayModal(extra);
  } catch (err) {
    toast(err.message || "Não foi possível abrir o pedido extra.", { type: "error" });
  }
}

function openExtraPayModal(extra) {
  document.getElementById("extraPayRequester").textContent = extra.requestedBy || "—";
  document.getElementById("extraPayDesc").textContent = extra.description || "—";
  document.getElementById("extraPayAmount").textContent = formatCurrency(extra.amount, extra.currency || "AOA");
  document.getElementById("extraPaySource").textContent =
    EXTRA_SOURCE_LABELS[extra.paymentSource] || extra.paymentSource || "—";
  document.getElementById("extraPayProject").textContent = extra.project?.name
    ? `Obra: ${extra.project.name}${extra.project.code ? ` (${extra.project.code})` : ""}`
    : extra.type === "GERAL"
      ? "Pedido Extra Geral"
      : "—";

  const btn = document.getElementById("extraPayConfirmBtn");
  const canPay = extra.status === "APROVADO";
  btn.disabled = !canPay;
  btn.classList.toggle("opacity-50", !canPay);
  btn.classList.toggle("cursor-not-allowed", !canPay);
  btn.onclick = canPay
    ? async () => {
        if (!confirm(`Confirmar liquidação de ${formatCurrency(extra.amount, extra.currency || "AOA")}?`)) return;
        try {
          await apiRequest(`/extra-requests/${extra.id}/pay`, { method: "POST" });
          toast("Pedido Extra liquidado com sucesso.", { type: "success" });
          document.getElementById("modalExtraPay").classList.remove("open");
          await loadPendingPaymentsQueue();
          await reloadAll();
        } catch (err) {
          toast(err.message || "Erro ao liquidar pedido extra.", { type: "error" });
        }
      }
    : null;

  document.getElementById("modalExtraPay").classList.add("open");
}

function activateFinTab(tabName) {
  document.querySelectorAll(".fin-tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });
  document.querySelectorAll(".fin-tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `tab-${tabName}`);
  });
}

async function handlePaymentDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get("paymentId");
  if (!paymentId) return;

  const projectId = params.get("projectId");
  const focus = params.get("focus") || undefined;

  if (projectId) {
    const sel = document.getElementById("finProjFilter");
    if (sel) sel.value = projectId;
    await reloadAll();
  }

  try {
    const payment = await apiRequest(`/cost-centers/payments/${encodeURIComponent(paymentId)}`);
    const st = payment.timelineStatus || resolveTimelineStatus(payment);
    const isPending = st === "PENDENTE" || st === "VENCIDO";

    window.history.replaceState({}, "", window.location.pathname);

    activateFinTab("plano");
    openPaymentAside(payment, isPending ? "PAYMENT" : "VIEW", focus ? { focus } : {});
  } catch (err) {
    toast(err.message || "Não foi possível abrir o lançamento.", { type: "error" });
  }
}

async function loadPendingPaymentsQueue() {
  const projectId = document.getElementById("finProjFilter")?.value;
  const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const [extrasResult, reinforcementsResult] = await Promise.allSettled([
    apiRequest(`/extra-requests/pending-finance-payment${params}`),
    apiRequest(`/petty-cash/reinforcement-requests/pending-finance-approval${params}`),
  ]);
  pendingPaymentsCache =
    extrasResult.status === "fulfilled" ? extrasResult.value.items || [] : [];
  pendingReinforcementsCache =
    reinforcementsResult.status === "fulfilled" ? reinforcementsResult.value.items || [] : [];
  updatePendingPaymentsBadge();
}

function updatePendingPaymentsBadge() {
  const badge = document.getElementById("pendingPaymentsBadge");
  const btn = document.getElementById("btnPendingPayments");
  const count = pendingPaymentsCache.length + pendingReinforcementsCache.length;
  if (!badge || !btn) return;
  if (count > 0) {
    badge.textContent = String(count);
    badge.classList.remove("hidden");
    btn.classList.add("ring-2", "ring-indigo-300", "ring-offset-1");
  } else {
    badge.classList.add("hidden");
    btn.classList.remove("ring-2", "ring-indigo-300", "ring-offset-1");
  }
}

function renderPendingPaymentsList() {
  const container = document.getElementById("pendingPaymentsBody");
  if (!container) return;

  const hasExtras = pendingPaymentsCache.length > 0;
  const hasReinforcements = pendingReinforcementsCache.length > 0;

  if (!hasExtras && !hasReinforcements) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400">
        <span class="material-symbols-outlined text-4xl text-slate-300 mb-2 block">check_circle</span>
        <p class="text-sm font-semibold">Sem pedidos extra nem reforços aguardando acção.</p>
      </div>`;
    return;
  }

  const extrasSection = hasExtras
    ? `
    <section class="mb-6">
      <h3 class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-2">
        <span class="material-symbols-outlined text-base text-emerald-600">payments</span>
        Pedidos extra a liquidar
      </h3>
      <table class="w-full fin-table">
        <thead>
          <tr>
            <th class="text-left">Obra</th>
            <th class="text-left min-w-[140px]">Solicitante</th>
            <th class="text-left min-w-[160px]">Descrição</th>
            <th class="text-right w-28">Valor</th>
            <th class="text-center w-24">Acção</th>
          </tr>
        </thead>
        <tbody>
          ${pendingPaymentsCache
            .map((e) => {
              const cur = e.currency || "AOA";
              const obra = e.project?.name || (e.type === "GERAL" ? "Geral" : "—");
              return `
          <tr class="hover:bg-slate-50/80">
            <td class="text-xs font-bold text-slate-700 max-w-[120px] truncate" title="${escapeAttr(obra)}">${obra}</td>
            <td class="text-xs text-slate-600">${escapeAttr(e.requestedBy || "—")}</td>
            <td class="text-sm font-medium text-slate-900 max-w-[200px] truncate" title="${escapeAttr(e.description)}">${escapeAttr(e.description)}</td>
            <td class="text-right text-sm font-bold text-slate-900 tabular-nums">${formatCurrency(e.amount, cur)}</td>
            <td class="text-center">
              <button type="button" onclick="openPendingExtraPay('${e.id}')"
                class="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition-all inline-flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">check_circle</span>Pagar
              </button>
            </td>
          </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </section>`
    : "";

  const reinforcementsSection = hasReinforcements
    ? `
    <section>
      <h3 class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-2">
        <span class="material-symbols-outlined text-base text-indigo-600">account_balance_wallet</span>
        Pedidos de reforço a aprovar
      </h3>
      <table class="w-full fin-table">
        <thead>
          <tr>
            <th class="text-left">Obra</th>
            <th class="text-left min-w-[120px]">Fundo / Cartão</th>
            <th class="text-left min-w-[140px]">Solicitante</th>
            <th class="text-left min-w-[160px]">Motivo</th>
            <th class="text-right w-28">Valor</th>
            <th class="text-center w-36">Acção</th>
          </tr>
        </thead>
        <tbody>
          ${pendingReinforcementsCache
            .map((r) => {
              const cur = r.fund?.currency || "AOA";
              const obra = r.fund?.project?.name || "—";
              const fundLabel = [r.fund?.name, r.card?.label].filter(Boolean).join(" · ") || "—";
              return `
          <tr class="hover:bg-slate-50/80">
            <td class="text-xs font-bold text-slate-700 max-w-[120px] truncate" title="${escapeAttr(obra)}">${escapeAttr(obra)}</td>
            <td class="text-xs text-slate-600 max-w-[140px] truncate" title="${escapeAttr(fundLabel)}">${escapeAttr(fundLabel)}</td>
            <td class="text-xs text-slate-600">${escapeAttr(r.requestedBy || "—")}</td>
            <td class="text-sm font-medium text-slate-900 max-w-[200px] truncate" title="${escapeAttr(r.reason)}">${escapeAttr(r.reason)}</td>
            <td class="text-right text-sm font-bold text-slate-900 tabular-nums">${formatCurrency(r.amount, cur)}</td>
            <td class="text-center whitespace-nowrap">
              <button type="button" onclick="approveReinforcementFinance('${r.id}')"
                class="h-8 px-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition-all inline-flex items-center gap-1 mr-1">
                <span class="material-symbols-outlined text-sm">check_circle</span>Aprovar
              </button>
              <button type="button" onclick="rejectReinforcementFinance('${r.id}')"
                class="h-8 px-2.5 rounded-lg bg-white border border-red-200 text-red-600 text-[11px] font-bold hover:bg-red-50 transition-all">
                Rejeitar
              </button>
            </td>
          </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </section>`
    : "";

  container.innerHTML = extrasSection + reinforcementsSection;
}

function openPendingPaymentsModal() {
  renderPendingPaymentsList();
  document.getElementById("modalPendingPayments")?.classList.add("open");
}

window.openPendingExtraPay = function (extraId) {
  const extra = pendingPaymentsCache.find((e) => e.id === extraId);
  if (extra) {
    document.getElementById("modalPendingPayments")?.classList.remove("open");
    openExtraPayModal(extra);
  }
};

async function maybeAutoOpenPendingPaymentsModal() {
  if (pendingPaymentsCache.length === 0 && pendingReinforcementsCache.length === 0) return;
  openPendingPaymentsModal();
}

window.approveReinforcementFinance = async function (id) {
  if (!confirm("Aprovar este Pedido de Reforço? O saldo do cartão será creditado.")) return;
  try {
    await apiRequest(`/petty-cash/reinforcement-requests/${id}/approve`, { method: "PATCH" });
    toast("Pedido de Reforço aprovado", { type: "success" });
    await loadPendingPaymentsQueue();
    renderPendingPaymentsList();
    await reloadAll();
  } catch (err) {
    toast(err.message || "Não foi possível aprovar o reforço.", { type: "error" });
  }
};

window.rejectReinforcementFinance = async function (id) {
  const reason = prompt("Motivo da rejeição (opcional):") || null;
  try {
    await apiRequest(`/petty-cash/reinforcement-requests/${id}/reject`, {
      method: "PATCH",
      body: { reason },
    });
    toast("Pedido de Reforço rejeitado", { type: "success" });
    await loadPendingPaymentsQueue();
    renderPendingPaymentsList();
  } catch (err) {
    toast(err.message || "Não foi possível rejeitar o reforço.", { type: "error" });
  }
};

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

  document.getElementById("btnPendingPayments")?.addEventListener("click", () => {
    openPendingPaymentsModal();
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
  syncTodayButton();
}

function updateDashboardDate() {
  const el = document.getElementById("finDashboardDate");
  if (!el) return;
  const now = new Date();
  const formatted = now.toLocaleDateString("pt-AO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  el.textContent = `Hoje é ${formatted.charAt(0).toUpperCase()}${formatted.slice(1)}`;

  const heading = document.querySelector(".fin-dashboard h2");
  if (heading) {
    const hour = now.getHours();
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    const nameEl = heading.querySelector("[data-user-name]");
    const name = nameEl?.textContent?.trim() || "—";
    heading.innerHTML = `${greeting}, <span data-user-name class="text-[#059669]">${name}</span>!`;
  }
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
    updateDashboardDate();
  } catch (err) {
    console.error(err);
  }
}

function getDashboardFilterParams() {
  const params = new URLSearchParams();
  const projectId = document.getElementById("finProjFilter")?.value;
  const status = document.getElementById("finStatusFilter")?.value;
  const search = document.getElementById("finSearch")?.value?.trim();
  const includePaid = document.getElementById("finIncludePaid")?.checked;

  if (projectId) params.set("projectId", projectId);
  if (status && status !== "EXTRA") params.set("status", status);
  if (search) params.set("search", search);
  params.set("onlyVisible", "false");
  params.set("includePaid", includePaid ? "true" : "false");
  params.set("daysPast", "90");
  params.set("daysAhead", "365");
  return params;
}

function paymentDueDate(p) {
  const raw = String(p.paymentDate || p.dueDate || "");
  const d = /^\d{4}-\d{2}-\d{2}/.test(raw)
    ? new Date(`${raw.slice(0, 10)}T12:00:00`)
    : new Date(raw);
  d.setHours(0, 0, 0, 0);
  return d;
}

function flattenTimelineItems(days) {
  return (days || []).flatMap((day) => day.items || []);
}

async function loadDashboard() {
  await loadDashboardExtras();

  if (isExtraOnlyFilter()) {
    dashboardCache = { days: [], total: 0 };
    updateDashboardKPIsFromExtras(extrasDashboardCache);
    renderDashboardChartsFromExtras(extrasDashboardCache);
    return;
  }

  const data = await apiRequest(`/cost-centers/payments/timeline?${getDashboardFilterParams()}`);
  dashboardCache = data;
  updateDashboardKPIs(data);
  renderDashboardCharts(data);
}

async function loadDashboardExtras() {
  const params = new URLSearchParams();
  const projectId = document.getElementById("finProjFilter")?.value;
  if (projectId) params.set("projectId", projectId);
  params.set("pageSize", "500");
  try {
    const data = await apiRequest(`/extra-requests?${params}`);
    extrasDashboardCache = filterDashboardExtras(data.items || []);
  } catch {
    extrasDashboardCache = [];
  }
}

function filterDashboardExtras(items) {
  const status = document.getElementById("finStatusFilter")?.value;
  const search = document.getElementById("finSearch")?.value?.trim().toLowerCase();
  const includePaid = document.getElementById("finIncludePaid")?.checked;

  return items.filter((e) => {
    if (search) {
      const hay = [e.description, e.requestedBy, e.project?.name, e.project?.code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (status === "PENDENTE" && e.status !== "PENDENTE") return false;
    if (status === "VENCIDO" && e.status !== "APROVADO") return false;
    if (status === "CONFIRMADO" && e.status !== "PAGO") return false;
    if (!includePaid && e.status === "PAGO") return false;
    if (!includePaid && (e.status === "REJEITADO" || e.status === "CANCELADO")) return false;
    return true;
  });
}

function setKpiText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateDashboardKPIsFromExtras(extras) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { from: weekFrom, to: weekTo } = getDateRangeForView("week", today);
  const { from: monthFrom, to: monthTo } = getDateRangeForView("month", today);

  let dailyAmount = 0;
  let dailyCount = 0;
  let weeklyAmount = 0;
  let weeklyCount = 0;
  let monthlyAmount = 0;
  let monthlyCount = 0;
  let pending = 0;
  let toLiquidate = 0;

  extras.forEach((e) => {
    const due = extraReferenceDate(e);
    const amount = Number(e.amount || 0);

    if (due.getTime() === today.getTime()) {
      dailyAmount += amount;
      dailyCount += 1;
    }
    if (due >= weekFrom && due <= weekTo) {
      weeklyAmount += amount;
      weeklyCount += 1;
    }
    if (due >= monthFrom && due <= monthTo) {
      monthlyAmount += amount;
      monthlyCount += 1;
    }
    if (e.status === "PENDENTE") pending += 1;
    if (e.status === "APROVADO") toLiquidate += 1;
  });

  setKpiText("kpiMonthly", formatCurrency(monthlyAmount, "AOA"));
  setKpiText("kpiMonthlySub", `${monthlyCount} pedido${monthlyCount === 1 ? "" : "s"} extra este mês`);
  setKpiText("kpiDaily", formatCurrency(dailyAmount, "AOA"));
  setKpiText("kpiDailySub", `${dailyCount} pedido${dailyCount === 1 ? "" : "s"} extra`);
  setKpiText("kpiWeekly", formatCurrency(weeklyAmount, "AOA"));
  setKpiText("kpiWeeklySub", `${weeklyCount} pedido${weeklyCount === 1 ? "" : "s"} extra`);
  setKpiText("kpiPending", String(pending));
  setKpiText("kpiOverdue", String(toLiquidate));
  setKpiText("kpiTotal", String(extras.length));
}

function updateDashboardKPIs(data) {
  const items = flattenTimelineItems(data.days);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { from: weekFrom, to: weekTo } = getDateRangeForView("week", today);
  const { from: monthFrom, to: monthTo } = getDateRangeForView("month", today);

  let dailyAmount = 0;
  let dailyCount = 0;
  let weeklyAmount = 0;
  let weeklyCount = 0;
  let monthlyAmount = 0;
  let monthlyCount = 0;
  let pending = 0;
  let overdue = 0;

  items.forEach((p) => {
    const due = paymentDueDate(p);
    const amount = Number(p.budgetedAmount || 0);
    const st = p.timelineStatus || resolveTimelineStatus(p);

    if (due.getTime() === today.getTime()) {
      dailyAmount += amount;
      dailyCount += 1;
    }
    if (due >= weekFrom && due <= weekTo) {
      weeklyAmount += amount;
      weeklyCount += 1;
    }
    if (due >= monthFrom && due <= monthTo) {
      monthlyAmount += amount;
      monthlyCount += 1;
    }
    if (st === "PENDENTE") pending += 1;
    if (st === "VENCIDO") overdue += 1;
  });

  setKpiText("kpiMonthly", formatCurrency(monthlyAmount, "AOA"));
  setKpiText("kpiMonthlySub", `${monthlyCount} pagamento${monthlyCount === 1 ? "" : "s"} este mês`);
  setKpiText("kpiDaily", formatCurrency(dailyAmount, "AOA"));
  setKpiText("kpiDailySub", `${dailyCount} pagamento${dailyCount === 1 ? "" : "s"}`);
  setKpiText("kpiWeekly", formatCurrency(weeklyAmount, "AOA"));
  setKpiText("kpiWeeklySub", `${weeklyCount} pagamento${weeklyCount === 1 ? "" : "s"}`);
  setKpiText("kpiPending", String(pending));
  setKpiText("kpiOverdue", String(overdue));
  setKpiText("kpiTotal", String(data.total || items.length));
}

function renderDashboardChartsFromExtras(extras) {
  renderBarChartFromExtras(extras);
  const payContainer = document.getElementById("finDonutPayments");
  if (payContainer) {
    payContainer.innerHTML = `<p class="text-xs text-slate-400 w-full text-center py-6">Filtro activo: só pedidos extra.</p>`;
  }
  renderExtrasDonut(extras);
  const subtitle = document.getElementById("finDonutSubtitle");
  if (subtitle) {
    subtitle.textContent = `${extras.length} pedido${extras.length === 1 ? "" : "s"} extra`;
  }
}

function renderDashboardCharts(data) {
  renderBarChart(data.days || []);
  renderPaymentDonut(flattenTimelineItems(data.days));
  renderExtrasDonut(extrasDashboardCache);
  updateDonutSubtitle(data, extrasDashboardCache);
}

function renderStatusDonut(containerId, segments, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (!total) {
    container.innerHTML = `<p class="text-xs text-slate-400 w-full text-center py-6">${emptyMessage}</p>`;
    return;
  }

  let cursor = 0;
  const gradientStops = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const pct = (s.value / total) * 100;
      const start = cursor;
      cursor += pct;
      return `${s.color} ${start}% ${cursor}%`;
    })
    .join(", ");

  const legend = segments
    .filter((s) => s.value > 0)
    .map(
      (s) =>
        `<div class="fin-legend-item"><span class="fin-legend-dot" style="background:${s.color}"></span>${s.label} · ${s.value}</div>`
    )
    .join("");

  container.innerHTML = `
    <div class="fin-donut" style="background: conic-gradient(${gradientStops});">
      <div class="fin-donut-hole">${total}<br><span class="text-[9px] font-semibold">total</span></div>
    </div>
    <div class="flex flex-col gap-2.5 flex-1 min-w-[120px]">${legend}</div>`;
}

function updateDonutSubtitle(data, extras) {
  const subtitle = document.getElementById("finDonutSubtitle");
  if (!subtitle) return;
  const payCount = data.total || flattenTimelineItems(data.days).length;
  const extraCount = extras.length;
  subtitle.textContent = `${payCount} pagamento${payCount === 1 ? "" : "s"} · ${extraCount} pedido${extraCount === 1 ? "" : "s"} extra`;
}

function renderPaymentDonut(items) {
  let pending = 0;
  let overdue = 0;
  let paid = 0;
  let other = 0;

  items.forEach((p) => {
    const st = p.timelineStatus || resolveTimelineStatus(p);
    if (st === "PENDENTE") pending += 1;
    else if (st === "VENCIDO") overdue += 1;
    else if (st === "PAGO") paid += 1;
    else other += 1;
  });

  renderStatusDonut(
    "finDonutPayments",
    [
      { label: "Pendentes", value: pending, color: "#3b82f6" },
      { label: "Atrasados", value: overdue, color: "#ef4444" },
      { label: "Liquidados", value: paid, color: "#10b981" },
      { label: "Outros", value: other, color: "#cbd5e1" },
    ],
    "Sem pagamentos no período."
  );
}

function renderExtrasDonut(extras) {
  let pending = 0;
  let approved = 0;
  let paid = 0;
  let closed = 0;

  extras.forEach((e) => {
    if (e.status === "PENDENTE") pending += 1;
    else if (e.status === "APROVADO") approved += 1;
    else if (e.status === "PAGO") paid += 1;
    else closed += 1;
  });

  renderStatusDonut(
    "finDonutExtras",
    [
      { label: "Pendentes", value: pending, color: "#f59e0b" },
      { label: "A liquidar", value: approved, color: "#6366f1" },
      { label: "Pagos", value: paid, color: "#10b981" },
      { label: "Rej./Cancel.", value: closed, color: "#94a3b8" },
    ],
    "Sem pedidos extra no período."
  );
}

function renderBarChartFromExtras(extras) {
  const container = document.getElementById("finBarChart");
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [];
  const chartMaxHeight = 112;

  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({
      date: d,
      total: 0,
      label: d.toLocaleDateString("pt-AO", { weekday: "short" }).replace(".", ""),
    });
  }

  extras.forEach((e) => {
    const due = extraReferenceDate(e);
    const bucket = buckets.find((b) => b.date.getTime() === due.getTime());
    if (bucket) bucket.total += Number(e.amount || 0);
  });

  const max = Math.max(...buckets.map((b) => b.total), 0);
  if (max === 0) {
    container.innerHTML = `
      <p class="text-xs text-slate-400 w-full text-center py-10">
        Sem pedidos extra nos últimos 7 dias.
      </p>`;
    return;
  }

  container.innerHTML = buckets
    .map((b) => {
      const heightPx = b.total > 0 ? Math.max(Math.round((b.total / max) * chartMaxHeight), 12) : 0;
      return `
        <div class="fin-bar-col">
          <div class="fin-bar" style="height:${heightPx}px;background:#6366f1" title="${formatCurrency(b.total, "AOA")}"></div>
          <span class="fin-bar-label">${b.label}</span>
        </div>`;
    })
    .join("");
}

function renderBarChart(days) {
  const container = document.getElementById("finBarChart");
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [];
  const chartMaxHeight = 112;

  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({
      date: d,
      total: 0,
      label: d.toLocaleDateString("pt-AO", { weekday: "short" }).replace(".", ""),
    });
  }

  flattenTimelineItems(days).forEach((p) => {
    const due = paymentDueDate(p);
    const bucket = buckets.find((b) => b.date.getTime() === due.getTime());
    if (bucket) bucket.total += Number(p.budgetedAmount || 0);
  });

  const max = Math.max(...buckets.map((b) => b.total), 0);
  if (max === 0) {
    container.innerHTML = `
      <p class="text-xs text-slate-400 w-full text-center py-10">
        Sem vencimentos nos últimos 7 dias.
      </p>`;
    return;
  }

  container.innerHTML = buckets
    .map((b) => {
      const heightPx = b.total > 0 ? Math.max(Math.round((b.total / max) * chartMaxHeight), 12) : 0;
      return `
        <div class="fin-bar-col">
          <div class="fin-bar" style="height:${heightPx}px" title="${formatCurrency(b.total, "AOA")}"></div>
          <span class="fin-bar-label">${b.label}</span>
        </div>`;
    })
    .join("");
}

function getFilters() {
  const params = new URLSearchParams();
  const projectId = document.getElementById("finProjFilter")?.value;
  const status = document.getElementById("finStatusFilter")?.value;
  const search = document.getElementById("finSearch")?.value?.trim();
  const includePaid = document.getElementById("finIncludePaid")?.checked;

  if (projectId) params.set("projectId", projectId);
  if (status && status !== "EXTRA") params.set("status", status);
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
    if (isExtraOnlyFilter()) {
      await loadDashboard();
      await loadPendingPaymentsQueue();
      timelineCache = {
        days: buildExtrasTimelineDays(extrasDashboardCache),
        total: extrasDashboardCache.length,
      };
      renderCalendar();
      renderExtrasPlanTable(extrasDashboardCache);
      syncTodayButton();
      return;
    }

    const [timeline] = await Promise.all([fetchTimeline(), loadDashboard(), loadPendingPaymentsQueue()]);
    timelineCache = timeline;
    renderCalendar();
    renderPlanTable(timelineCache.days);
    syncTodayButton();
  } catch (err) {
    if (grid) grid.innerHTML = `<p class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</p>`;
    if (planBody) planBody.innerHTML = `<tr><td colspan="7"><p class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</p></td></tr>`;
  }
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
    if (payload._isExtra) {
      const extra = extrasDashboardCache.find((e) => e.id === payload._extraId);
      if (extra) {
        openExtraPayModal(extra);
        return;
      }
    }
    const st = payload.timelineStatus || resolveTimelineStatus(payload);
    const isPending = st === "PENDENTE" || st === "VENCIDO";
    openPaymentAside(payload, isPending ? "PAYMENT" : "VIEW");
  } catch (err) {
    console.error("Erro ao abrir pagamento no Gantt:", err);
    toast("Não foi possível abrir os detalhes do pagamento.", { type: "error" });
  }
};

function renderExtrasPlanTable(extras) {
  const tbody = document.getElementById("planTableBody");
  if (!tbody) return;

  const days = buildExtrasTimelineDays(extras);

  if (!days.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="py-12 text-center text-slate-400">
            <span class="material-symbols-outlined text-4xl text-slate-300 mb-2 block">inventory_2</span>
            <p class="text-sm font-semibold">Sem pedidos extra no período seleccionado.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = days
    .map((day) => {
      const dayHeader = `
      <tr class="fin-day-header">
        <td colspan="7">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-base text-indigo-400">request_quote</span>
            <span class="text-xs font-black uppercase tracking-wide text-slate-600">${formatDateBR(day.date)}</span>
            <span class="text-[10px] font-bold text-slate-400">${day.count} pedido(s) extra</span>
          </div>
        </td>
      </tr>`;

      const rows = day.items
        .map((item) => {
          const extra = extras.find((e) => e.id === item._extraId);
          const meta = EXTRA_STATUS_META[extra?.status] || EXTRA_STATUS_META.PENDENTE;
          const cur = extra?.currency || "AOA";
          const canPay = extra?.status === "APROVADO";

          return `
        <tr class="group">
          <td class="fin-empty-cell">—</td>
          <td class="text-xs font-bold text-slate-700 max-w-[140px] truncate" title="${escapeAttr(extra?.project?.name)}">${extra?.project?.name || (extra?.type === "GERAL" ? "Geral" : "—")}</td>
          <td class="text-sm font-medium text-slate-900 max-w-xs truncate" title="${escapeAttr(extra?.description)}">
            <span class="text-[10px] font-black uppercase tracking-wide text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded mr-1.5">Extra</span>${extra?.description || "—"}
          </td>
          <td class="text-xs text-slate-500 max-w-[160px] truncate">${extra?.requestedBy || "—"}</td>
          <td class="text-right text-sm font-bold text-slate-900 tabular-nums">${formatCurrency(extra?.amount, cur)}</td>
          <td class="text-center">${renderStatusBadge(meta.label, meta.badge, meta.icon)}</td>
          <td class="text-center">
            <div class="fin-actions">
              ${canPay
                ? renderIconBtn("payments", "Liquidar pedido extra", "emerald", {
                    attrs: `onclick="openExtraFromPlan('${extra.id}')"`,
                  })
                : renderIconBtn("visibility", "Ver pedido extra", "blue", {
                    attrs: `onclick="openExtraFromPlan('${extra.id}')"`,
                  })}
            </div>
          </td>
        </tr>`;
        })
        .join("");

      return dayHeader + rows;
    })
    .join("");
}

window.openExtraFromPlan = function (extraId) {
  const extra = extrasDashboardCache.find((e) => e.id === extraId);
  if (extra) openExtraPayModal(extra);
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
