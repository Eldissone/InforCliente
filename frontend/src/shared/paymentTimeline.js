import { formatCurrency, formatDateBR } from "./format.js";
import { renderSupplierFiscalBreakdownHtml } from "./supplierFiscal.js";

export const TIMELINE_STATUS = {
  PENDENTE: { label: "Pendente", dot: "bg-blue-400", badge: "bg-blue-100 text-blue-700", border: "border-blue-200" },
  VENCIDO: { label: "Atrasado", dot: "bg-red-400", badge: "bg-red-100 text-red-700", border: "border-red-200" },
  PAGO: { label: "Pago", dot: "bg-emerald-400", badge: "bg-emerald-100 text-emerald-700", border: "border-emerald-200" },
  CANCELADO: { label: "Cancelado", dot: "bg-slate-300", badge: "bg-slate-100 text-slate-500", border: "border-slate-200" },
};

export function resolveTimelineStatus(payment, now = new Date()) {
  const status = String(payment.status || payment.timelineStatus || "").toUpperCase();
  if (status === "CONFIRMADO" || status === "PAGO") return "PAGO";
  if (status === "CANCELADO") return "CANCELADO";
  const due = new Date(payment.paymentDate || payment.dueDate);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  if (due < today) return "VENCIDO";
  return "PENDENTE";
}

export function formatTimelineDayLabel(isoDate) {
  const d = new Date(isoDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  d.setHours(0, 0, 0, 0);

  const weekday = d.toLocaleDateString("pt-PT", { weekday: "long" });
  const dateStr = d.toLocaleDateString("pt-PT", { day: "numeric", month: "long" });

  if (d.getTime() === today.getTime()) return `Hoje · ${dateStr}`;
  if (d.getTime() === tomorrow.getTime()) return `Amanhã · ${dateStr}`;
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${dateStr}`;
}

function escapeAttr(value) {
  return String(value || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

function renderTimelineItem(p, { showProject = false, compact = false } = {}) {
  const timelineStatus = p.timelineStatus || resolveTimelineStatus(p);
  const meta = TIMELINE_STATUS[timelineStatus] || TIMELINE_STATUS.PENDENTE;
  const cur = p.costCenter?.currency || "AOA";
  const payload = escapeAttr(JSON.stringify(p));
  const fiscalHtml = renderSupplierFiscalBreakdownHtml(p.supplierRef, p.budgetedAmount, cur);
  const projectLine = showProject && p.project?.name
    ? `<p class="text-[10px] font-bold text-slate-400 truncate">${escapeAttr(p.project.name)}</p>`
    : "";

  if (compact) {
    return `
      <button type="button" onclick="openPaymentAsideHandler(this)" data-payload='${payload}' data-type="VIEW"
        class="w-full text-left flex items-center gap-3 p-3 rounded-xl border ${meta.border} bg-white hover:bg-slate-50 transition-colors">
        <div class="w-2 h-2 rounded-full shrink-0 ${meta.dot}"></div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-slate-900 truncate">${escapeAttr(p.description)}</p>
          <p class="text-[10px] text-slate-500 truncate">${escapeAttr(p.supplier || "Sem fornecedor")} · ${escapeAttr(p.costCenter?.code || "—")}</p>
          ${fiscalHtml}
          ${projectLine}
        </div>
        <div class="text-right shrink-0">
          <p class="text-sm font-bold text-slate-900 tabular-nums">${formatCurrency(p.budgetedAmount, cur)}</p>
          <span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${meta.badge}">${meta.label}</span>
        </div>
      </button>`;
  }

  return `
    <div class="flex gap-3 group">
      <div class="flex flex-col items-center pt-1">
        <div class="w-2.5 h-2.5 rounded-full ${meta.dot} ring-4 ring-white shadow-sm"></div>
        <div class="w-px flex-1 bg-slate-200 group-last:hidden min-h-[12px]"></div>
      </div>
      <button type="button" onclick="openPaymentAsideHandler(this)" data-payload='${payload}' data-type="VIEW"
        class="flex-1 mb-3 p-4 rounded-xl border ${meta.border} bg-white hover:shadow-sm transition-all text-left">
        <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-bold text-slate-900 truncate">${escapeAttr(p.description)}</p>
            <p class="text-xs text-slate-500 mt-0.5">${escapeAttr(p.supplier || "Sem fornecedor")} · CC ${escapeAttr(p.costCenter?.code || "—")}</p>
            ${fiscalHtml}
            ${projectLine}
          </div>
          <div class="text-left sm:text-right shrink-0">
            <p class="text-base font-black text-slate-900 tabular-nums">${formatCurrency(p.budgetedAmount, cur)}</p>
            <span class="inline-flex mt-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${meta.badge}">${meta.label}</span>
          </div>
        </div>
      </button>
    </div>`;
}

export function renderPaymentTimeline(days, { showProject = false, emptyMessage } = {}) {
  if (!days?.length) {
    return `
      <div class="py-12 text-center flex flex-col items-center justify-center">
        <span class="material-symbols-outlined text-4xl text-slate-300 mb-2">event_available</span>
        <p class="text-sm font-bold text-slate-500">${emptyMessage || "Sem pagamentos visíveis neste período."}</p>
        <p class="text-xs text-slate-400 mt-1">Os pagamentos aparecem 1 dia antes do vencimento.</p>
      </div>`;
  }

  return days.map((day) => {
    const cur = day.currency === "MIXED" ? "AOA" : (day.currency || "AOA");
    const totalLabel = day.currency === "MIXED"
      ? `${day.count} pagamento(s)`
      : formatCurrency(day.totalBudgeted, cur);

    return `
      <section class="relative">
        <div class="sticky top-0 z-10 flex items-center justify-between gap-3 py-2 mb-2 bg-white/95 backdrop-blur-sm border-b border-slate-100">
          <div class="flex items-center gap-2 min-w-0">
            <span class="material-symbols-outlined text-base text-slate-400">calendar_today</span>
            <h4 class="text-sm font-black text-slate-800 truncate">${formatTimelineDayLabel(day.date)}</h4>
          </div>
          <span class="text-xs font-bold text-slate-500 tabular-nums shrink-0">${totalLabel}</span>
        </div>
        <div class="pl-1 space-y-0">
          ${day.items.map((p) => renderTimelineItem(p, { showProject })).join("")}
        </div>
      </section>`;
  }).join("");
}

export function renderGroupedListRows(days, { showProject = false, onEdit = null } = {}) {
  if (!days?.length) return "";

  return days.map((day) => {
    const dayHeader = `
      <tr class="bg-slate-50/80">
        <td colspan="6" class="py-2 px-4">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-black uppercase tracking-wide text-slate-600">${formatTimelineDayLabel(day.date)}</span>
            <span class="text-[10px] font-bold text-slate-400">${day.count} pagamento(s)</span>
          </div>
        </td>
      </tr>`;

    const rows = day.items.map((item) => {
      if (item.type === "NEED") return item.html;
      const timelineStatus = item.timelineStatus || resolveTimelineStatus(item);
      const meta = TIMELINE_STATUS[timelineStatus] || TIMELINE_STATUS.PENDENTE;
      const isPaid = timelineStatus === "PAGO";
      const isPlanned = item.isVisible === false && timelineStatus === "PENDENTE";
      const statusBadge = isPlanned
        ? `<span class="text-[10px] font-bold px-2.5 py-1 rounded-full bg-violet-100 text-violet-700">Planeado</span>`
        : `<span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${meta.badge}">${meta.label}</span>`;
      const payload = escapeAttr(JSON.stringify(item));
      const projectCol = showProject
        ? `<td class="text-xs font-bold text-slate-600 max-w-[100px] truncate">${escapeAttr(item.project?.name || "—")}</td>`
        : "";

      return `
        <tr class="cursor-pointer hover:bg-slate-50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${payload}' data-type="VIEW">
          <td class="text-xs font-bold text-slate-600 w-28">${formatDateBR(item.paymentDate || item.dueDate)}</td>
          ${projectCol}
          <td class="font-medium text-slate-900 max-w-xs truncate" title="${escapeAttr(item.description)}">${escapeAttr(item.description)}</td>
          <td class="text-sm text-slate-500">${escapeAttr(item.costCenter?.code || "—")} · ${escapeAttr(item.costCenter?.name || "")}</td>
          <td class="text-right text-sm font-bold text-slate-900">${formatCurrency(item.budgetedAmount, item.costCenter?.currency || "AOA")}</td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center">
            <div class="flex justify-center gap-2">
              ${!isPaid && timelineStatus !== "CANCELADO" ? `
              <button onclick="event.stopPropagation(); editCronograma(${JSON.stringify(item).replace(/"/g, "&quot;")})" title="Editar"
                class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-emerald-100 hover:text-emerald-600 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">edit</span>
              </button>
              <button onclick="event.stopPropagation(); deletePay('${escapeAttr(item.id)}', '${escapeAttr(item.costCenterId)}')" title="Eliminar"
                class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">delete</span>
              </button>` : `
              <button onclick="event.stopPropagation(); openPaymentAsideHandler(this)" data-payload='${payload}' data-type="VIEW" title="Ver"
                class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">visibility</span>
              </button>`}
            </div>
          </td>
        </tr>`;
    }).join("");

    return dayHeader + rows;
  }).join("");
}

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Grade mensal de pagamentos — usa o output de buildPaymentTimeline (days). */
export function renderPaymentCalendar(days, { year, month, onDayClick = "selectCalendarDay" } = {}) {
  const dayMap = new Map();
  (days || []).forEach((d) => {
    const key = new Date(d.date).toISOString().slice(0, 10);
    dayMap.set(key, d);
  });

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  // Segunda-feira = 0 … Domingo = 6
  const startPad = (first.getDay() + 6) % 7;
  const totalCells = startPad + last.getDate();
  const rows = Math.ceil(totalCells / 7);

  const monthLabel = first.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });

  let html = `
    <div class="mb-4 flex items-center justify-between gap-3">
      <h3 class="text-base font-bold text-slate-900 capitalize">${monthLabel}</h3>
    </div>
    <div class="grid grid-cols-7 gap-1 mb-1">
      ${WEEKDAY_LABELS.map((w) => `<div class="text-center text-[10px] font-black uppercase tracking-widest text-slate-400 py-1">${w}</div>`).join("")}
    </div>
    <div class="grid grid-cols-7 gap-1">`;

  for (let i = 0; i < rows * 7; i++) {
    const dayNum = i - startPad + 1;
    if (dayNum < 1 || dayNum > last.getDate()) {
      html += `<div class="min-h-[72px] rounded-xl bg-slate-50/50"></div>`;
      continue;
    }
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    const dayData = dayMap.get(iso);
    const count = dayData?.count || 0;
    const isToday = iso === new Date().toISOString().slice(0, 10);
    const hasOverdue = dayData?.items?.some((p) => (p.timelineStatus || resolveTimelineStatus(p)) === "VENCIDO");
    const hasPending = dayData?.items?.some((p) => (p.timelineStatus || resolveTimelineStatus(p)) === "PENDENTE");

    let dotClass = "";
    if (hasOverdue) dotClass = "bg-red-500";
    else if (hasPending) dotClass = "bg-blue-400";
    else if (count > 0) dotClass = "bg-emerald-400";

    html += `
      <button type="button" onclick="${onDayClick}('${iso}')"
        class="min-h-[72px] p-2 rounded-xl border text-left transition-all hover:shadow-sm
          ${count ? "border-slate-200 bg-white hover:border-emerald-300" : "border-transparent bg-slate-50/80"}
          ${isToday ? "ring-2 ring-[#2afc8d]/40" : ""}">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold ${isToday ? "text-emerald-700" : "text-slate-700"}">${dayNum}</span>
          ${dotClass ? `<span class="w-2 h-2 rounded-full ${dotClass}"></span>` : ""}
        </div>
        ${count ? `<p class="text-[10px] font-bold text-slate-500 mt-1">${count} pag.</p>` : ""}
      </button>`;
  }

  html += `</div>`;
  return html;
}

/** Lista compacta de pagamentos de um dia (painel lateral do calendário). */
export function renderCalendarDayDetail(dayData, { showProject = true } = {}) {
  if (!dayData?.items?.length) {
    return `<p class="text-sm text-slate-400 text-center py-8">Sem pagamentos neste dia.</p>`;
  }
  return dayData.items.map((p) => renderTimelineItem(p, { showProject, compact: true })).join("");
}
