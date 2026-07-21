import { apiRequest, apiUpload, getAssetUrl } from "/services/api.js";
import { guardPageAccess, initPermissionLayer } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, openModal, toast } from "/shared/ui.js";
import { formatCurrency, formatDateBR } from "/shared/format.js";
import {
  resolveTimelineStatus,
  TIMELINE_STATUS,
} from "/shared/paymentTimeline.js";
import { renderPaymentGantt, getDateRangeForView } from "/shared/paymentGantt.js";
import { initPaymentDetailAside } from "/shared/paymentDetailAside.js";
import { paymentPayableAmount } from "/shared/supplierFiscal.js";

let allProjects = [];
let ganttViewMode = "month";
let paymentViewMode = "gantt";
let calendarAnchor = new Date();
calendarAnchor.setHours(0, 0, 0, 0);
let timelineCache = { days: [], total: 0 };
let dashboardCache = { days: [], total: 0 };
let extrasDashboardCache = [];
let pendingPaymentsCache = [];
let pendingReinforcementsCache = [];
let pendingFinanceNeedsCache = [];

const EXTRA_SOURCE_LABELS = {
  CAIXA: "Caixa",
  BANCO: "Banco",
  FUNDO_MANEIO: "Fundo de Maneio",
  SOLICITACAO_TRANSFERENCIA: "Transferência bancária",
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

const FIN_GENERAL_CENTERS = "__geral__";
const FIN_DASHBOARD_VISIBLE_KEY = "InfoCliente.finDashboardVisible";

function getFinStatusFilter() {
  return document.getElementById("finStatusFilter")?.value || "";
}

function getProjectFilterValue() {
  return document.getElementById("finProjFilter")?.value || "";
}

function isGeneralCentersFilter() {
  return getProjectFilterValue() === FIN_GENERAL_CENTERS;
}

function isExtraOnlyFilter() {
  const status = getFinStatusFilter();
  return status === "EXTRA" || status.startsWith("EXTRA_");
}

function shouldShowPayments() {
  return !isExtraOnlyFilter() && !isGeneralCentersFilter();
}

function extraReferenceDate(extra) {
  const raw = extra.paymentDueDate || extra.approvedAt || extra.requestedAt || extra.createdAt;
  const d = new Date(raw);
  d.setHours(0, 0, 0, 0);
  return d;
}

function mapExtraToTimelineItem(extra) {
  const refDate = extra.paymentDueDate || extra.approvedAt || extra.requestedAt || extra.createdAt;
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

function mergeTimelineDays(paymentDays, extras) {
  const extraDays = buildExtrasTimelineDays(extras);
  const dayMap = new Map();

  (paymentDays || []).forEach((day) => {
    const key = new Date(day.date).toISOString();
    dayMap.set(key, {
      date: day.date,
      items: [...(day.items || [])],
      count: day.count || (day.items || []).length,
      totalBudgeted: Number(day.totalBudgeted || 0),
    });
  });

  extraDays.forEach((day) => {
    const key = new Date(day.date).toISOString();
    if (!dayMap.has(key)) {
      dayMap.set(key, { date: day.date, items: [], count: 0, totalBudgeted: 0 });
    }
    const bucket = dayMap.get(key);
    (day.items || []).forEach((item) => {
      bucket.items.push(item);
      bucket.count += 1;
      bucket.totalBudgeted += paymentPayableAmount(item);
    });
  });

  return [...dayMap.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function extraMatchesStatusFilter(extra) {
  const status = getFinStatusFilter();
  if (!status || status === "EXTRA") return true;
  if (status === "PENDENTE") return extra.status === "PENDENTE";
  if (status === "VENCIDO" || status === "EXTRA_A_LIQUIDAR") return extra.status === "APROVADO";
  if (status === "CONFIRMADO" || status === "EXTRA_PAGO") return extra.status === "PAGO";
  if (status === "EXTRA_PENDENTE") return extra.status === "PENDENTE";
  return true;
}

function escapeAttr(value) {
  return String(value || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extraRequestReference(extra) {
  if (extra.type === "GERAL") {
    const name = extra.generalCostCenter?.name || "Centro geral";
    const desc = extra.generalCostCenter?.description;
    return desc ? `${name} — ${desc}` : name;
  }
  if (extra.project) {
    return `${extra.project.name}${extra.project.code ? ` (${extra.project.code})` : ""}`;
  }
  return "—";
}

function extraRequestPaymentLabel(extra) {
  const src = EXTRA_SOURCE_LABELS[extra.paymentSource] || extra.paymentSource || "—";
  if (extra.paymentSource === "FUNDO_MANEIO") {
    const parts = [src];
    if (extra.fund?.name) parts.push(extra.fund.name);
    if (extra.card?.label) parts.push(`Cartão: ${extra.card.label}`);
    return parts.join(" · ");
  }
  return src;
}

function renderExtraDocumentLink(url, label) {
  if (!url) return "—";
  const href = getAssetUrl(url);
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"
    class="text-emerald-600 font-bold hover:underline inline-flex items-center gap-1">
    <span class="material-symbols-outlined text-sm">open_in_new</span>Ver ${escapeHtml(label)}
  </a>`;
}

function renderProformaCell(url, title = "Proforma") {
  if (!url) return `<span class="text-slate-300">—</span>`;
  return `<button type="button" title="Ver ${escapeAttr(title)}"
    class="fin-icon-btn fin-icon-btn--emerald" onclick="event.stopPropagation(); openDocumentAside('${escapeAttr(url)}', '${escapeAttr(title)}')">
    <span class="material-symbols-outlined text-base">description</span>
  </button>`;
}

function formatIbanCell(iban) {
  if (!iban) return `<span class="text-slate-300">—</span>`;
  return `<span class="text-xs font-mono text-slate-600 truncate max-w-[140px] inline-block align-middle" title="${escapeAttr(iban)}">${escapeHtml(iban)}</span>`;
}

function flattenPlanRows(days) {
  const rows = [];
  (days || []).forEach((day) => {
    (day.items || []).forEach((item) => {
      rows.push({ item, dayDate: day.date });
    });
  });
  rows.sort((a, b) => {
    const da = new Date(a.item.dueDate || a.item.paymentDate || a.dayDate);
    const db = new Date(b.item.dueDate || b.item.paymentDate || b.dayDate);
    return da - db;
  });
  return rows;
}

function renderPlanPaymentRow(p) {
  const st = p.timelineStatus || resolveTimelineStatus(p);
  const meta = TIMELINE_STATUS[st] || TIMELINE_STATUS.PENDENTE;
  const icon = TIMELINE_ICONS[st] || TIMELINE_ICONS.PENDENTE;
  const cur = p.costCenter?.currency || "AOA";
  const isPending = st === "PENDENTE" || st === "VENCIDO";
  const supplier = p.supplierName || p.supplier || "—";

  return `
    <tr class="group">
      <td class="text-sm font-medium text-slate-900 max-w-xs truncate" title="${escapeAttr(p.description)}">${escapeHtml(p.description || "—")}</td>
      <td class="text-xs text-slate-600 max-w-[160px] truncate" title="${escapeAttr(supplier)}">${escapeHtml(supplier)}</td>
      <td>${formatIbanCell(p.iban)}</td>
      <td class="text-right text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">${formatCurrency(paymentPayableAmount(p), cur)}</td>
      <td class="text-center">${renderProformaCell(p.proformaUrl)}</td>
      <td class="text-center">${renderPaymentTypeBadge(p.paymentType)}</td>
      <td class="text-center">${renderStatusBadge(meta.label, meta.badge, icon)}</td>
      <td class="text-center">
        <div class="fin-actions">
          ${isPending
            ? renderIconBtn("done_all", "Liquidar pagamento", "emerald", {
                attrs: `onclick="liquidateFromPlan('${escapeAttr(p.id)}')"`,
              })
            : `<span class="text-slate-300 text-xs">—</span>`}
        </div>
      </td>
    </tr>`;
}

function renderPlanExtraRow(extra, p) {
  const meta = EXTRA_STATUS_META[extra?.status] || EXTRA_STATUS_META.PENDENTE;
  const cur = extra?.currency || "AOA";
  const canPay = extra?.status === "APROVADO";
  const supplier = extraRequestPaymentLabel(extra);

  return `
    <tr class="group">
      <td class="text-sm font-medium text-slate-900 max-w-xs truncate" title="${escapeAttr(extra?.description)}">
        <span class="text-[10px] font-black uppercase tracking-wide text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded mr-1.5">Extra</span>${escapeHtml(extra?.description || "—")}
      </td>
      <td class="text-xs text-slate-600 max-w-[160px] truncate" title="${escapeAttr(supplier)}">${escapeHtml(supplier)}</td>
      <td>${formatIbanCell(null)}</td>
      <td class="text-right text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">${formatCurrency(extra?.amount, cur)}</td>
      <td class="text-center">${renderProformaCell(extra?.proformaUrl)}</td>
      <td class="text-center"><span class="text-[10px] font-bold text-slate-400 uppercase">Extra</span></td>
      <td class="text-center">${renderStatusBadge(meta.label, meta.badge, meta.icon)}</td>
      <td class="text-center">
        <div class="fin-actions">
          ${canPay
            ? renderIconBtn("done_all", "Liquidar pedido extra", "emerald", {
                attrs: `onclick="openExtraFromPlan('${extra?.id || p._extraId}')"`,
              })
            : `<span class="text-slate-300 text-xs">—</span>`}
        </div>
      </td>
    </tr>`;
}

function renderPaymentTypeBadge(paymentType) {
  const isCredit = paymentType === "CREDITO";
  const label = isCredit ? "C" : "PP";
  const cls = isCredit
    ? "bg-amber-100 text-amber-700"
    : "bg-red-50 text-red-700 border border-red-200";
  return `<span class="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${cls}">${label}</span>`;
}

const PLAN_TABLE_COLSPAN = 8;

function renderExtraDetailGrid(extra, { showNotes = true, dense = false } = {}) {
  const cur = extra.currency || "AOA";
  const fields = [
    { label: "Tipo", value: extra.type === "GERAL" ? "Geral" : "Obra", wide: false },
    { label: "Referência", value: extraRequestReference(extra), wide: false },
    { label: "Descrição", value: extra.description || "—", wide: true },
    { label: "Valor", value: formatCurrency(extra.amount, cur), wide: false, highlight: true },
    { label: "Moeda", value: cur, wide: false },
    { label: "Origem do pagamento", value: extraRequestPaymentLabel(extra), wide: false },
    { label: "Solicitante", value: extra.requestedBy || "—", wide: false },
    { label: "Data do pedido", value: formatDateBR(extra.requestedAt || extra.createdAt), wide: false },
    {
      label: "Liquidação prevista",
      value: extra.paymentDueDate ? formatDateBR(extra.paymentDueDate) : "—",
      wide: false,
      highlight: Boolean(extra.paymentDueDate),
    },
    { label: "Aprovado por", value: extra.approvedBy || "—", wide: false },
    { label: "Data de aprovação", value: extra.approvedAt ? formatDateBR(extra.approvedAt) : "—", wide: false },
  ];

  if (extra.paymentSource === "SOLICITACAO_TRANSFERENCIA") {
    fields.push({
      label: "Proforma",
      value: extra.proformaUrl ? renderExtraDocumentLink(extra.proformaUrl, "proforma") : "Não anexada",
      wide: false,
      isHtml: Boolean(extra.proformaUrl),
    });
  }
  if (extra.comprovativoUrl) {
    fields.push({
      label: "Comprovativo",
      value: renderExtraDocumentLink(extra.comprovativoUrl, "comprovativo"),
      wide: false,
      isHtml: true,
    });
  }

  if (showNotes) {
    fields.push({ label: "Observações", value: extra.notes?.trim() || "—", wide: true });
  }

  const pad = dense ? "p-2" : "p-3";
  const gap = dense ? "gap-2" : "gap-3";
  const labelClass = dense ? "text-[9px]" : "text-[10px]";
  const valueClass = dense
    ? "text-xs font-semibold text-slate-800 break-words"
    : "text-sm font-semibold text-slate-800 break-words";

  return `
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 ${gap}">
      ${fields
        .map(
          ({ label, value, wide, highlight, isHtml }) => `
        <div class="${pad} rounded-xl border border-slate-100 ${wide ? "sm:col-span-2 lg:col-span-3" : ""} ${highlight ? "bg-emerald-50/60" : "bg-slate-50"}">
          <p class="${labelClass} font-black uppercase tracking-widest text-slate-400 mb-0.5">${label}</p>
          <div class="${valueClass} ${highlight ? "!text-base font-black text-emerald-700" : ""}">${isHtml ? value : escapeHtml(value)}</div>
        </div>`
        )
        .join("")}
    </div>`;
}

function renderExtraPayComprovativoSection() {
  return `
    <div class="p-4 rounded-xl border border-amber-200 bg-amber-50/60">
      <label for="extraPayComprovativo"
        class="block text-[10px] font-black uppercase tracking-widest text-amber-800 mb-2">
        Comprovativo da transferência *
      </label>
      <input id="extraPayComprovativo" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" required
        class="w-full text-sm font-semibold text-slate-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-white file:text-emerald-700 file:font-bold hover:file:bg-emerald-50">
      <p class="text-[11px] text-amber-700/80 mt-2">Anexe o comprovativo bancário para concluir a liquidação.</p>
    </div>`;
}

function renderPendingFinanceNeedCard(need) {
  const cur = need.currency || "AOA";
  const label = need.displayDescription || need.description || "—";
  const supplierName = need.supplierLabel || need.supplier?.name || "—";
  const proformaBtn = need.proformaUrl
    ? `<a href="${getAssetUrl(need.proformaUrl)}" target="_blank" rel="noopener"
        class="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-bold hover:bg-slate-50 inline-flex items-center gap-1">
        <span class="material-symbols-outlined text-sm">description</span> Proforma
      </a>`
    : "";
  const quoteParam = need.quoteId ? `, '${need.quoteId}'` : "";
  return `
    <article class="border border-amber-100 rounded-xl p-4 bg-amber-50/40">
      <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-bold text-slate-900">${escapeHtml(label)}</p>
          <p class="text-[11px] text-slate-500 mt-1">
            ${escapeHtml(need.project?.name || "—")} · ${escapeHtml(need.costCenter?.code || "—")}
            · <strong>${escapeHtml(supplierName)}</strong>
          </p>
          <p class="text-sm font-bold text-slate-900 mt-2 tabular-nums">${formatCurrency(need.amount, cur)}</p>
        </div>
        <div class="shrink-0 flex flex-wrap items-center gap-2 justify-end">
          ${proformaBtn}
          <button type="button" onclick="openPendingFinanceNeed('${need.id}', '${need.projectId}', '${need.costCenterId}'${quoteParam})"
            class="h-8 px-4 rounded-lg bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700 transition-all inline-flex items-center gap-1">
            <span class="material-symbols-outlined text-sm">calendar_month</span>
            Definir parcelas
          </button>
        </div>
      </div>
    </article>`;
}

window.openPendingFinanceNeed = function (needId, projectId, costCenterId, quoteId) {
  const url = new URL("../Projectos/centroCustos.html", window.location.href);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("tab", "cronograma");
  url.searchParams.set("needId", needId);
  if (quoteId) url.searchParams.set("quoteId", quoteId);
  window.location.href = url.pathname + url.search;
};

function renderPendingExtraCard(extra, index, total) {
  const cur = extra.currency || "AOA";
  const typeBadge =
    extra.type === "GERAL"
      ? `<span class="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold bg-violet-100 text-violet-700">Geral</span>`
      : `<span class="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-100 text-sky-700">Obra</span>`;

  if (total <= 1) {
    return `
    <article class="border border-slate-100 rounded-xl p-4 bg-white shadow-sm">
      <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div class="flex-1 min-w-0">
          ${renderExtraDetailGrid(extra)}
        </div>
        <div class="shrink-0 flex lg:flex-col justify-end">
          <button type="button" onclick="openPendingExtraPay('${extra.id}')"
            class="h-9 px-4 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-all inline-flex items-center justify-center gap-1.5">
            <span class="material-symbols-outlined text-base">payments</span>
            Liquidar
          </button>
        </div>
      </div>
    </article>`;
  }

  const detailId = `extra-detail-${extra.id}`;
  const refShort = extra.type === "GERAL"
    ? (extra.generalCostCenter?.name || "Centro geral")
    : (extra.project?.name || "Obra");

  return `
    <article class="border border-slate-100 rounded-xl bg-white shadow-sm overflow-hidden">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
        <div class="flex items-start gap-2 flex-1 min-w-0">
          <span class="text-[10px] font-black text-slate-300 mt-1 w-4 shrink-0">${index + 1}.</span>
          ${typeBadge}
          <div class="min-w-0 flex-1">
            <p class="text-sm font-bold text-slate-900 truncate" title="${escapeAttr(extra.description)}">${escapeHtml(extra.description || "—")}</p>
            <p class="text-[11px] text-slate-500 truncate mt-0.5" title="${escapeAttr(extraRequestReference(extra))}">
              ${escapeHtml(refShort)} · ${escapeHtml(extraRequestPaymentLabel(extra))} · ${escapeHtml(extra.requestedBy || "—")}
            </p>
          </div>
        </div>
        <div class="flex items-center justify-between sm:justify-end gap-2 shrink-0 pl-6 sm:pl-0">
          <p class="text-sm font-black text-emerald-700 tabular-nums">${formatCurrency(extra.amount, cur)}</p>
          <button type="button" onclick="togglePendingExtraDetail('${detailId}', this)"
            class="h-8 px-2.5 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-bold hover:bg-slate-50 transition-all inline-flex items-center gap-1"
            data-expanded="false" aria-expanded="false" aria-controls="${detailId}">
            <span class="material-symbols-outlined text-sm">expand_more</span>
            Detalhes
          </button>
          <button type="button" onclick="openPendingExtraPay('${extra.id}')"
            class="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition-all inline-flex items-center gap-1">
            <span class="material-symbols-outlined text-sm">payments</span>
            Liquidar
          </button>
        </div>
      </div>
      <div id="${detailId}" class="hidden border-t border-slate-100 bg-slate-50/50 px-3 py-3">
        ${renderExtraDetailGrid(extra, { dense: true })}
      </div>
    </article>`;
}

window.togglePendingExtraDetail = function (detailId, btn) {
  const panel = document.getElementById(detailId);
  if (!panel || !btn) return;
  const open = panel.classList.toggle("hidden") === false;
  btn.dataset.expanded = open ? "true" : "false";
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  const icon = btn.querySelector(".material-symbols-outlined");
  if (icon) icon.textContent = open ? "expand_less" : "expand_more";
};

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
  wireLogout();
  wireUsersNav();
  initMobileMenu();
  initPaymentDetailAside({
    onLiquidated: reloadAll,
    showToast: (msg, type) => toast(msg, { type }),
  });
  bindEvents();
  initDashboardVisibility();
  syncGanttViewButtons();
  syncPaymentViewMode();
  updateDashboardDate();
  await loadProjects();
  await reloadAll();
  await loadPendingPaymentsQueue();
  const hadExtraDeepLink = new URLSearchParams(window.location.search).get("extraRequestId");
  await handleFinanceiroDeepLink();
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
  const needsComprovativo = extra.paymentSource === "SOLICITACAO_TRANSFERENCIA";
  document.getElementById("extraPayBody").innerHTML =
    renderExtraDetailGrid(extra) + (needsComprovativo ? renderExtraPayComprovativoSection() : "");

  const btn = document.getElementById("extraPayConfirmBtn");
  const canPay = extra.status === "APROVADO";
  btn.disabled = !canPay;
  btn.classList.toggle("opacity-50", !canPay);
  btn.classList.toggle("cursor-not-allowed", !canPay);
  btn.onclick = canPay
    ? async () => {
        if (!confirm(`Confirmar liquidação de ${formatCurrency(extra.amount, extra.currency || "AOA")}?`)) return;
        try {
          if (needsComprovativo) {
            const file = document.getElementById("extraPayComprovativo")?.files?.[0];
            if (!file) {
              toast("Anexe o comprovativo da transferência bancária.", { type: "error" });
              return;
            }
            const fd = new FormData();
            fd.append("comprovativo", file);
            await apiUpload(`/extra-requests/${extra.id}/pay`, fd, "POST");
          } else {
            await apiRequest(`/extra-requests/${extra.id}/pay`, { method: "POST" });
          }
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
    window.history.replaceState({}, "", window.location.pathname);

    if (focus === "comprovativo" && payment.comprovativoUrl) {
      openDocumentAside(payment.comprovativoUrl, "Comprovativo de pagamento");
      return;
    }

    const st = payment.timelineStatus || resolveTimelineStatus(payment);
    const isPending = st === "PENDENTE" || st === "VENCIDO";
    if (isPending) {
      openLiquidateModal({
        ...payment,
        costCenterId: payment.costCenterId || payment.costCenter?.id,
      });
      return;
    }

    openPaymentAside(payment, "VIEW", focus ? { focus } : {});
  } catch (err) {
    toast(err.message || "Não foi possível abrir o lançamento.", { type: "error" });
  }
}

async function loadPendingPaymentsQueue() {
  const projectId = getProjectFilterValue();
  const params =
    projectId && projectId !== FIN_GENERAL_CENTERS
      ? `?projectId=${encodeURIComponent(projectId)}`
      : "";
  const [extrasResult, reinforcementsResult, needsResult] = await Promise.allSettled([
    apiRequest(`/extra-requests/pending-finance-payment${params}`),
    isGeneralCentersFilter()
      ? Promise.resolve({ items: [] })
      : apiRequest(`/petty-cash/reinforcement-requests/pending-finance-approval${params}`),
    isGeneralCentersFilter()
      ? Promise.resolve({ items: [] })
      : apiRequest(`/cost-centers/pending-finance-scheduling${params}`),
  ]);
  pendingPaymentsCache =
    extrasResult.status === "fulfilled" ? extrasResult.value.items || [] : [];
  if (projectId === FIN_GENERAL_CENTERS) {
    pendingPaymentsCache = pendingPaymentsCache.filter((e) => e.type === "GERAL");
  }
  pendingReinforcementsCache =
    reinforcementsResult.status === "fulfilled" ? reinforcementsResult.value.items || [] : [];
  pendingFinanceNeedsCache =
    needsResult.status === "fulfilled" ? needsResult.value.items || [] : [];
  updatePendingPaymentsBadge();
}

function updatePendingPaymentsBadge() {
  const badge = document.getElementById("pendingPaymentsBadge");
  const btn = document.getElementById("btnPendingPayments");
  const count =
    pendingPaymentsCache.length +
    pendingReinforcementsCache.length +
    pendingFinanceNeedsCache.length;
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
  const hasFinanceNeeds = pendingFinanceNeedsCache.length > 0;

  if (!hasExtras && !hasReinforcements && !hasFinanceNeeds) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400">
        <span class="material-symbols-outlined text-4xl text-slate-300 mb-2 block">check_circle</span>
        <p class="text-sm font-semibold">Sem pedidos extra, reforços ou itens a agendar.</p>
      </div>`;
    return;
  }

  const financeNeedsSection = hasFinanceNeeds
    ? `
    <section class="mb-6">
      <h3 class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-2">
        <span class="material-symbols-outlined text-base text-amber-600">calendar_month</span>
        Itens a agendar (cronograma)
        <span class="text-[10px] font-bold text-slate-400 normal-case tracking-normal">(${pendingFinanceNeedsCache.length})</span>
      </h3>
      <div class="flex flex-col gap-2">
        ${pendingFinanceNeedsCache.map((n) => renderPendingFinanceNeedCard(n)).join("")}
      </div>
    </section>`
    : "";

  const extrasSection = hasExtras
    ? `
    <section class="mb-6">
      <h3 class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-2">
        <span class="material-symbols-outlined text-base text-emerald-600">payments</span>
        Pedidos extra a liquidar
        <span class="text-[10px] font-bold text-slate-400 normal-case tracking-normal">(${pendingPaymentsCache.length})</span>
      </h3>
      <div class="flex flex-col gap-2">
        ${pendingPaymentsCache.map((e, i) => renderPendingExtraCard(e, i, pendingPaymentsCache.length)).join("")}
      </div>
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

  container.innerHTML = financeNeedsSection + extrasSection + reinforcementsSection;
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
  document.getElementById("btnToggleDashboard")?.addEventListener("click", () => {
    const panel = document.getElementById("finDashboardPanel");
    const visible = panel?.classList.contains("is-hidden");
    setDashboardVisible(Boolean(visible));
  });

  ["finProjFilter", "finStatusFilter", "finSearch", "finIncludePaid"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      reloadAll();
    });
    document.getElementById(id)?.addEventListener("input", debounce(() => {
      reloadAll();
    }, 350));
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

  document.querySelectorAll("[data-payment-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.paymentView;
      if (mode === paymentViewMode) return;
      paymentViewMode = mode;
      syncPaymentViewMode();
    });
  });

  document.getElementById("btnPendingPayments")?.addEventListener("click", () => {
    openPendingPaymentsModal();
  });

  document.querySelectorAll("[data-fin-main-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.finMainTab;
      switchFinMainTab(tab);
    });
  });

  document.getElementById("auditCertFilter")?.addEventListener("change", () => loadAuditList());
  document.getElementById("auditSearch")?.addEventListener("input", debounce(() => loadAuditList(), 350));
  document.getElementById("auditCertConfirmBtn")?.addEventListener("click", submitAuditCertification);
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

function syncPaymentViewMode() {
  document.querySelectorAll("[data-payment-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.paymentView === paymentViewMode);
  });
  const ganttEl = document.getElementById("planGanttView");
  const listEl = document.getElementById("planListView");
  if (ganttEl) ganttEl.classList.toggle("hidden", paymentViewMode !== "gantt");
  if (listEl) listEl.classList.toggle("hidden", paymentViewMode !== "list");
}

function initDashboardVisibility() {
  const stored = localStorage.getItem(FIN_DASHBOARD_VISIBLE_KEY);
  const visible = stored === null ? true : stored === "true";
  setDashboardVisible(visible, { persist: false });
}

function setDashboardVisible(visible, { persist = true } = {}) {
  const panel = document.getElementById("finDashboardPanel");
  const btn = document.getElementById("btnToggleDashboard");
  if (!panel || !btn) return;
  panel.classList.toggle("is-hidden", !visible);
  btn.setAttribute("aria-expanded", visible ? "true" : "false");
  btn.title = visible ? "Ocultar dashboard financeiro" : "Mostrar dashboard financeiro";
  if (persist) {
    localStorage.setItem(FIN_DASHBOARD_VISIBLE_KEY, String(visible));
  }
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

  const heading = document.getElementById("finDashboardGreeting");
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
      sel.innerHTML =
        `<option value="">Todas as Obras</option>` +
        `<option value="${FIN_GENERAL_CENTERS}">Centros Gerais</option>` +
        allProjects.map((p) => `<option value="${p.id}">${p.name}${p.code ? ` (${p.code})` : ""}</option>`).join("");
    }
    updateDashboardDate();
  } catch (err) {
    console.error(err);
  }
}

function getDashboardFilterParams() {
  const params = new URLSearchParams();
  const projectId = getProjectFilterValue();
  const status = getFinStatusFilter();
  const search = document.getElementById("finSearch")?.value?.trim();
  const includePaid = document.getElementById("finIncludePaid")?.checked;

  if (projectId && projectId !== FIN_GENERAL_CENTERS) params.set("projectId", projectId);
  if (status && !status.startsWith("EXTRA")) params.set("status", status);
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
  const extras = extrasDashboardCache;

  if (isExtraOnlyFilter()) {
    dashboardCache = { days: [], total: 0 };
    updateDashboardKPIsFromExtras(extras);
    renderDashboardChartsFromExtras(extras);
    return;
  }

  let paymentData = { days: [], total: 0 };
  if (shouldShowPayments()) {
    paymentData = await apiRequest(`/cost-centers/payments/timeline?${getDashboardFilterParams()}`);
  }
  dashboardCache = paymentData;
  updateDashboardKPIsCombined(paymentData, extras);
  renderDashboardChartsCombined(paymentData, extras);
}

async function loadDashboardExtras() {
  const params = new URLSearchParams();
  const projectId = getProjectFilterValue();
  if (projectId === FIN_GENERAL_CENTERS) {
    params.set("type", "GERAL");
  } else if (projectId) {
    params.set("projectId", projectId);
  }
  params.set("pageSize", "100");
  try {
    const data = await apiRequest(`/extra-requests?${params}`);
    extrasDashboardCache = filterDashboardExtras(data.items || []);
  } catch {
    extrasDashboardCache = [];
  }
}

function filterDashboardExtras(items) {
  const search = document.getElementById("finSearch")?.value?.trim().toLowerCase();
  const includePaid = document.getElementById("finIncludePaid")?.checked;

  return items.filter((e) => {
    if (!extraMatchesStatusFilter(e)) return false;
    if (search) {
      const hay = [
        e.description,
        e.requestedBy,
        e.project?.name,
        e.project?.code,
        e.generalCostCenter?.name,
        e.generalCostCenter?.code,
        extraRequestPaymentLabel(e),
        extraRequestReference(e),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
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

function updateDashboardKPIsCombined(paymentData, extras) {
  const paymentItems = flattenTimelineItems(paymentData.days);
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

  paymentItems.forEach((p) => {
    const due = paymentDueDate(p);
    const amount = paymentPayableAmount(p);
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
    if (e.status === "APROVADO") pending += 1;
    else if (e.status === "PENDENTE") overdue += 1;
  });

  const totalRecords = (paymentData.total || paymentItems.length) + extras.length;

  setKpiText("kpiMonthly", formatCurrency(monthlyAmount, "AOA"));
  setKpiText(
    "kpiMonthlySub",
    `${monthlyCount} registo${monthlyCount === 1 ? "" : "s"} este mês`
  );
  setKpiText("kpiDaily", formatCurrency(dailyAmount, "AOA"));
  setKpiText("kpiDailySub", `${dailyCount} registo${dailyCount === 1 ? "" : "s"}`);
  setKpiText("kpiWeekly", formatCurrency(weeklyAmount, "AOA"));
  setKpiText("kpiWeeklySub", `${weeklyCount} registo${weeklyCount === 1 ? "" : "s"}`);
  setKpiText("kpiPending", String(pending));
  setKpiText("kpiOverdue", String(overdue));
  setKpiText("kpiTotal", String(totalRecords));
}

function updateDashboardKPIs(paymentData) {
  const items = flattenTimelineItems(paymentData.days);
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
    const amount = paymentPayableAmount(p);
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
  setKpiText("kpiTotal", String(paymentData.total || items.length));
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

function renderDashboardChartsCombined(paymentData, extras) {
  renderBarChartCombined(paymentData.days || [], extras);
  renderPaymentDonut(flattenTimelineItems(paymentData.days));
  renderExtrasDonut(extras);
  updateDonutSubtitle(paymentData, extras);
}

function renderDashboardCharts(paymentData) {
  renderBarChart(paymentData.days || []);
  renderPaymentDonut(flattenTimelineItems(paymentData.days));
  renderExtrasDonut(extrasDashboardCache);
  updateDonutSubtitle(paymentData, extrasDashboardCache);
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
      { label: "Pagos", value: paid, color: "#10b981" },
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

function renderBarChartCombined(paymentDays, extras) {
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

  flattenTimelineItems(paymentDays).forEach((p) => {
    const due = paymentDueDate(p);
    const bucket = buckets.find((b) => b.date.getTime() === due.getTime());
    if (bucket) bucket.total += paymentPayableAmount(p);
  });

  extras.forEach((e) => {
    const due = extraReferenceDate(e);
    const bucket = buckets.find((b) => b.date.getTime() === due.getTime());
    if (bucket) bucket.total += Number(e.amount || 0);
  });

  const max = Math.max(...buckets.map((b) => b.total), 0);
  if (max === 0) {
    container.innerHTML = `
      <p class="text-xs text-slate-400 w-full text-center py-10">
        Sem pagamentos nem pedidos extra nos últimos 7 dias.
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
    if (bucket) bucket.total += paymentPayableAmount(p);
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
  const projectId = getProjectFilterValue();
  const status = getFinStatusFilter();
  const search = document.getElementById("finSearch")?.value?.trim();
  const includePaid = document.getElementById("finIncludePaid")?.checked;

  if (projectId && projectId !== FIN_GENERAL_CENTERS) params.set("projectId", projectId);
  if (status && !status.startsWith("EXTRA")) params.set("status", status);
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
  if (planBody) planBody.innerHTML = `<tr><td colspan="${PLAN_TABLE_COLSPAN}"><div class="spinner my-8"></div></td></tr>`;

  try {
    await loadDashboardExtras();
    const extrasForView = extrasDashboardCache;

    if (isExtraOnlyFilter()) {
      await loadDashboard();
      await loadPendingPaymentsQueue();
      timelineCache = {
        days: buildExtrasTimelineDays(extrasForView),
        total: extrasForView.length,
      };
      renderCalendar();
      renderExtrasPlanTable(extrasForView);
      syncTodayButton();
      return;
    }

    let paymentTimeline = { days: [], total: 0 };
    if (shouldShowPayments()) {
      paymentTimeline = await fetchTimeline();
    }

    const mergedDays = mergeTimelineDays(paymentTimeline.days, extrasForView);
    timelineCache = {
      days: mergedDays,
      total: mergedDays.reduce((sum, day) => sum + day.count, 0),
    };

    await Promise.all([loadDashboard(), loadPendingPaymentsQueue()]);
    renderCalendar();
    renderPlanTable(timelineCache.days);
    syncTodayButton();
  } catch (err) {
    if (grid) grid.innerHTML = `<p class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</p>`;
    if (planBody) planBody.innerHTML = `<tr><td colspan="${PLAN_TABLE_COLSPAN}"><p class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</p></td></tr>`;
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
        <td colspan="${PLAN_TABLE_COLSPAN}">
          <div class="py-12 text-center text-slate-400">
            <span class="material-symbols-outlined text-4xl text-slate-300 mb-2 block">inventory_2</span>
            <p class="text-sm font-semibold">Sem pedidos extra no período seleccionado.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  const rows = flattenPlanRows(days)
    .map(({ item }) => {
      const extra = extras.find((e) => e.id === item._extraId);
      return renderPlanExtraRow(extra, item);
    })
    .join("");

  tbody.innerHTML = rows;
}

window.openExtraFromPlan = function (extraId) {
  const extra = extrasDashboardCache.find((e) => e.id === extraId);
  if (extra) openExtraPayModal(extra);
};

window.liquidateFromPlan = function (paymentId) {
  for (const day of timelineCache.days || []) {
    const payment = day.items.find((item) => item.id === paymentId && !item._isExtra);
    if (payment) {
      openLiquidateModal({
        ...payment,
        costCenterId: payment.costCenterId || payment.costCenter?.id,
      });
      return;
    }
  }
  toast("Não foi possível localizar o lançamento.", { type: "error" });
};

function renderPlanTable(days) {
  const tbody = document.getElementById("planTableBody");
  if (!tbody) return;

  const flatRows = flattenPlanRows(days);

  if (!flatRows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${PLAN_TABLE_COLSPAN}">
          <div class="py-12 text-center text-slate-400">
            <span class="material-symbols-outlined text-4xl text-slate-300 mb-2 block">event_busy</span>
            <p class="text-sm font-semibold">Sem pagamentos nem pedidos extra no período seleccionado.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = flatRows
    .map(({ item }) => {
      if (item._isExtra) {
        const extra = extrasDashboardCache.find((e) => e.id === item._extraId);
        return renderPlanExtraRow(extra, item);
      }
      return renderPlanPaymentRow(item);
    })
    .join("");
}

// ── Auditoria de Faturas (Fase I) ─────────────────────────────────────────────
let finMainTab = "pagamentos";
let auditCertContext = null;

const CERT_BADGES = {
  PENDENTE: { label: "Pendente", cls: "bg-amber-100 text-amber-700" },
  CONFORME: { label: "Conforme", cls: "bg-emerald-100 text-emerald-700" },
  DIVERGENTE: { label: "Divergente", cls: "bg-red-100 text-red-700" },
};

function switchFinMainTab(tab) {
  finMainTab = tab;
  document.querySelectorAll("[data-fin-main-tab]").forEach((btn) => {
    const active = btn.dataset.finMainTab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.getElementById("fin-panel-pagamentos")?.classList.toggle("hidden", tab !== "pagamentos");
  document.getElementById("fin-panel-auditoria")?.classList.toggle("hidden", tab !== "auditoria");
  if (tab === "auditoria") loadAuditList();
}

function getAuditFilterParams() {
  const params = new URLSearchParams();
  const proj = getProjectFilterValue();
  if (proj) params.set("projectId", proj);
  const cert = document.getElementById("auditCertFilter")?.value;
  if (cert) params.set("certificationStatus", cert);
  const search = document.getElementById("auditSearch")?.value?.trim();
  if (search) params.set("search", search);
  params.set("pageSize", "50");
  return params;
}

async function loadAuditList() {
  const tbody = document.getElementById("auditTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner my-8"></div></td></tr>`;

  try {
    const params = getAuditFilterParams();
    const data = await apiRequest(`/cost-centers/payments/audit?${params}`);
    const summary = data.summary || {};
    document.getElementById("auditKpiPending").textContent = summary.pending ?? 0;
    document.getElementById("auditKpiConforme").textContent = summary.conforme ?? 0;
    document.getElementById("auditKpiDivergente").textContent = summary.divergente ?? 0;
    document.getElementById("auditKpiTotal").textContent = summary.total ?? 0;

    const items = data.items || [];
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="py-12 text-center text-slate-400"><p class="text-sm font-semibold">Sem faturas liquidadas no filtro actual.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((p) => {
      const cur = p.costCenter?.currency || "AOA";
      const cert = CERT_BADGES[p.certificationStatus] || CERT_BADGES.PENDENTE;
      const ccId = p.costCenterId || p.costCenter?.id;
      return `
      <tr>
        <td class="font-semibold text-slate-800 text-sm">${p.project?.name || "—"}</td>
        <td class="text-sm text-slate-700 max-w-xs truncate" title="${escapeAttr(p.description || "")}">${p.description || "—"}</td>
        <td class="text-sm text-slate-600">${p.supplier || "—"}</td>
        <td class="text-right font-bold tabular-nums">${formatCurrency(p.paidAmount ?? p.budgetedAmount, cur)}</td>
        <td class="text-center text-xs text-slate-500">${formatDateBR(p.paymentDate)}</td>
        <td class="text-center"><span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${cert.cls}">${cert.label}</span></td>
        <td class="text-center">
          <div class="flex justify-center gap-1">
            ${renderIconBtn("visibility", "Ver detalhes", "slate", {
              attrs: `onclick="viewAuditPayment('${p.id}')"`,
            })}
            ${p.certificationStatus === "PENDENTE" ? renderIconBtn("verified", "Certificar", "emerald", {
              attrs: `onclick="openAuditCertModal('${p.id}', '${ccId}')"`,
            }) : renderIconBtn("info", "Ver certificação", "slate", {
              attrs: `onclick="openAuditCertModal('${p.id}', '${ccId}', true)"`,
            })}
          </div>
        </td>
      </tr>`;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

window.viewAuditPayment = function (paymentId) {
  for (const day of timelineCache.days || []) {
    const payment = day.items?.find((item) => item.id === paymentId && !item._isExtra);
    if (payment) {
      openPaymentAside(payment, "VIEW");
      return;
    }
  }
  toast("Abra o Plano de Pagamentos para ver o detalhe completo.", { type: "info" });
};

window.openAuditCertModal = async function (payId, ccId, readOnly = false) {
  try {
    const data = await apiRequest(`/cost-centers/${ccId}/payments/${payId}/certification-preview`);
    auditCertContext = { payId, ccId, readOnly };
    const analysis = data.analysis || {};
    const preview = document.getElementById("auditCertPreview");
    const evidence = (analysis.evidence || [])
      .map((e) => `<li>${e.type}: ${e.label} — ${formatCurrency(e.amount, data.payment?.costCenter?.currency || "AOA")}</li>`)
      .join("");
    preview.innerHTML = `
      <p class="font-bold text-slate-800 mb-2">${data.payment?.description || ""}</p>
      <p class="text-xs mb-2">Sugestão: <strong>${analysis.suggestedStatus || "—"}</strong> — ${analysis.reason || ""}</p>
      ${evidence ? `<ul class="text-xs list-disc pl-4 space-y-1">${evidence}</ul>` : "<p class=\"text-xs text-slate-400\">Sem evidências automáticas.</p>"}
      ${data.payment?.certificationNotes ? `<p class="text-xs mt-2 text-slate-500">Notas: ${data.payment.certificationNotes}</p>` : ""}`;

    const statusEl = document.getElementById("auditCertStatus");
    const notesEl = document.getElementById("auditCertNotes");
    const suggestEl = document.getElementById("auditUseSuggestion");
    const confirmBtn = document.getElementById("auditCertConfirmBtn");

    if (analysis.suggestedStatus) statusEl.value = analysis.suggestedStatus;
    notesEl.value = data.payment?.certificationNotes || "";
    suggestEl.checked = true;

    statusEl.disabled = readOnly;
    notesEl.disabled = readOnly;
    suggestEl.disabled = readOnly;
    confirmBtn.classList.toggle("hidden", readOnly);

    document.getElementById("modalAuditCert").classList.add("open");
  } catch (err) {
    toast(err.message || "Erro ao carregar análise.", { type: "error" });
  }
};

async function submitAuditCertification() {
  if (!auditCertContext || auditCertContext.readOnly) return;
  const { payId, ccId } = auditCertContext;
  try {
    await apiRequest(`/cost-centers/${ccId}/payments/${payId}/certify`, {
      method: "PATCH",
      body: {
        status: document.getElementById("auditCertStatus").value,
        notes: document.getElementById("auditCertNotes").value || null,
        useSuggestion: document.getElementById("auditUseSuggestion").checked,
      },
    });
    toast("Fatura certificada.", { type: "success" });
    document.getElementById("modalAuditCert").classList.remove("open");
    auditCertContext = null;
    await loadAuditList();
  } catch (err) {
    toast(err.message || "Erro ao certificar.", { type: "error" });
  }
}

window.switchFinMainTab = switchFinMainTab;

