import { formatCurrency } from "./format.js";
import { resolveTimelineStatus, TIMELINE_STATUS } from "./paymentTimeline.js";

const GROUP_PALETTE = [
  { pill: "bg-violet-100 text-violet-700", row: "bg-violet-50/60", sticky: "bg-violet-50" },
  { pill: "bg-emerald-100 text-emerald-700", row: "bg-emerald-50/60", sticky: "bg-emerald-50" },
  { pill: "bg-sky-100 text-sky-700", row: "bg-sky-50/60", sticky: "bg-sky-50" },
  { pill: "bg-pink-100 text-pink-700", row: "bg-pink-50/60", sticky: "bg-pink-50" },
  { pill: "bg-amber-100 text-amber-700", row: "bg-amber-50/60", sticky: "bg-amber-50" },
  { pill: "bg-cyan-100 text-cyan-700", row: "bg-cyan-50/60", sticky: "bg-cyan-50" },
];

const BAR_BY_STATUS = {
  PENDENTE: "bg-blue-500 hover:bg-blue-600",
  VENCIDO: "bg-red-500 hover:bg-red-600",
  PAGO: "bg-emerald-500 hover:bg-emerald-600",
  CANCELADO: "bg-slate-300 hover:bg-slate-400",
};

const COL_WIDTH = { month: 40, week: 72, day: 120 };
const LABEL_WIDTH = 256;
const STATUS_WIDTH = 96;

const EMPTY_MSG = {
  day: "Sem pagamentos neste dia.",
  week: "Sem pagamentos nesta semana.",
  month: "Sem pagamentos neste mês.",
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Converte data API para YYYY-MM-DD no calendário local (evita desvio UTC). */
function toLocalIsoDate(value) {
  if (!value) return null;
  const raw = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function paymentIso(p) {
  return toLocalIsoDate(p.paymentDate || p.dueDate || p._timelineDay);
}

function groupByProject(days) {
  const map = new Map();
  (days || []).forEach((day) => {
    (day.items || []).forEach((p) => {
      const key = p.project?.id || p.project?.name || "__none__";
      if (!map.has(key)) {
        map.set(key, {
          name: p.project?.name || "Sem obra",
          code: p.project?.code || "",
          payments: [],
        });
      }
      map.get(key).payments.push({ ...p, _timelineDay: day.date });
    });
  });
  return Array.from(map.values()).map((g) => ({
    ...g,
    payments: g.payments.sort(
      (a, b) => new Date(a.paymentDate || a.dueDate || a._timelineDay) - new Date(b.paymentDate || b.dueDate || b._timelineDay)
    ),
  }));
}

function buildAllDatesInMonth(periodFrom) {
  const year = periodFrom.getFullYear();
  const month = periodFrom.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: lastDay }, (_, i) => {
    const day = i + 1;
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
}

function collectActiveDates(groups) {
  const set = new Set();
  groups.forEach((g) => {
    g.payments.forEach((p) => {
      const iso = paymentIso(p);
      if (iso) set.add(iso);
    });
  });
  return Array.from(set).sort();
}

function buildAllDatesInWeek(periodFrom, periodTo) {
  const dates = [];
  const cur = new Date(periodFrom);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(periodTo);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    const iso = toLocalIsoDate(cur);
    if (iso) dates.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function resolveColumnDates(viewMode, periodFrom, periodTo, groups) {
  if (viewMode === "month") return buildAllDatesInMonth(periodFrom);
  if (viewMode === "week") return buildAllDatesInWeek(periodFrom, periodTo);
  if (viewMode === "day") {
    const iso = toLocalIsoDate(periodFrom);
    return iso ? [iso] : collectActiveDates(groups);
  }
  return collectActiveDates(groups);
}

function buildGridTemplate(colCount, colWidth, viewMode) {
  if (viewMode === "month") {
    return `${LABEL_WIDTH}px repeat(${colCount}, ${colWidth}px) ${STATUS_WIDTH}px`;
  }
  return `${LABEL_WIDTH}px repeat(${colCount}, minmax(${colWidth}px, 1fr)) ${STATUS_WIDTH}px`;
}

function rowStyle(gridTemplate, viewMode, tableWidth) {
  const base = `display:grid; grid-template-columns:${gridTemplate};`;
  if (viewMode === "month") return `${base} width:${tableWidth}px`;
  return `${base} width:100%; min-width:100%`;
}

function buildPeriodLabel(viewMode, periodFrom, periodTo) {
  if (viewMode === "day") {
    return periodFrom.toLocaleDateString("pt-PT", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  if (viewMode === "week") {
    const sameMonth = periodFrom.getMonth() === periodTo.getMonth();
    const fromStr = periodFrom.toLocaleDateString("pt-PT", {
      day: "numeric",
      month: sameMonth ? undefined : "short",
    });
    const toStr = periodTo.toLocaleDateString("pt-PT", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${fromStr} – ${toStr}`;
  }
  return periodFrom.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
}

function buildPeriodSubtitle(viewMode, colCount, totalPayments) {
  if (viewMode === "day") return `${totalPayments} pagamento(s)`;
  if (viewMode === "month") return `${colCount} dias · ${totalPayments} pagamento(s)`;
  if (viewMode === "week") return `${colCount} dias · ${totalPayments} pagamento(s)`;
  return `${colCount} dia(s) · ${totalPayments} pagamento(s)`;
}

function renderDateHeader(iso, todayIso, count, viewMode) {
  const isToday = iso === todayIso;
  const d = new Date(iso + "T12:00:00");
  const weekday = d.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "");
  const dayNum = d.getDate();
  const isWeekend = d.getDay() % 6 === 0;
  const hasPayments = count > 0;

  if (viewMode === "month") {
    return `
      <div class="text-center py-1.5 border-r border-slate-200/70 bg-slate-50/90
        ${isToday ? "!bg-emerald-50" : isWeekend ? "bg-slate-100/60" : ""}">
        <div class="text-[9px] font-bold uppercase ${isToday ? "text-emerald-600" : "text-slate-300"}">${weekday.charAt(0)}</div>
        <div class="text-xs font-bold leading-tight ${isToday ? "text-emerald-700" : hasPayments ? "text-slate-700" : "text-slate-400"}">${dayNum}</div>
        ${hasPayments ? `<div class="w-1 h-1 rounded-full bg-emerald-400 mx-auto mt-0.5"></div>` : ""}
      </div>`;
  }

  const monthShort = d.toLocaleDateString("pt-PT", { month: "short" }).replace(".", "");
  const weekendBg = viewMode === "week" && isWeekend ? "bg-slate-100/60" : "";
  return `
    <div class="text-center py-2 border-r border-slate-200/80 bg-slate-50/90 ${isToday ? "!bg-emerald-50" : weekendBg}">
      <div class="text-[10px] font-black uppercase tracking-wide ${isToday ? "text-emerald-700" : "text-slate-400"}">${weekday}</div>
      <div class="text-sm font-bold ${isToday ? "text-emerald-700" : "text-slate-700"}">${viewMode === "week" ? `${dayNum} ${monthShort}` : dayNum}</div>
      <div class="text-[9px] font-bold text-slate-400 mt-0.5">${count} pag.</div>
    </div>`;
}

function renderPaymentMarker(p, viewMode, barClass, payload, amount, onPaymentClick) {
  const title = `${p.description || "—"} · ${amount}`;
  if (viewMode === "month") {
    return `
      <button type="button"
        onclick="${onPaymentClick}(this)"
        data-payload='${payload}'
        title="${escapeHtml(title)}"
        aria-label="${escapeHtml(title)}"
        class="w-4 h-4 rounded-full ${barClass} ring-2 ring-white shadow-md transition-transform hover:scale-125 cursor-pointer">
      </button>`;
  }
  return `
    <button type="button"
      onclick="${onPaymentClick}(this)"
      data-payload='${payload}'
      title="${escapeHtml(title)}"
      class="w-full h-8 rounded-full ${barClass} text-white text-[10px] font-bold px-2 shadow-sm transition-all hover:shadow-md cursor-pointer flex items-center justify-center whitespace-nowrap">
      ${amount}
    </button>`;
}

function renderDayCell(iso, dueIso, barHtml, viewMode) {
  const d = new Date(iso + "T12:00:00");
  const isWeekend = d.getDay() % 6 === 0;
  const bg = isWeekend && viewMode !== "day" ? "bg-slate-50/80" : "";
  const pad = viewMode === "month" ? "" : "px-2";
  if (iso !== dueIso) {
    return `<div class="flex items-center justify-center min-h-[44px] border-r border-slate-100/70 ${bg} ${pad}"></div>`;
  }
  return `
    <div class="flex items-center justify-center min-h-[44px] border-r border-slate-100/70 ${bg} ${pad}">
      ${barHtml}
    </div>`;
}

/** Gráfico Gantt — pagamentos agrupados por obra. */
export function renderPaymentGantt(
  days,
  {
    viewMode = "month",
    periodFrom,
    periodTo,
    onPaymentClick = "window.openGanttPayment",
  } = {}
) {
  const groups = groupByProject(days);
  const todayIso = toLocalIsoDate(new Date()) || new Date().toISOString().slice(0, 10);
  const from = periodFrom ? new Date(periodFrom) : new Date();
  const to = periodTo ? new Date(periodTo) : from;
  const periodLabel = buildPeriodLabel(viewMode, from, to);

  if (!groups.length) {
    return `
      <div class="py-16 text-center flex flex-col items-center justify-center">
        <span class="material-symbols-outlined text-5xl text-slate-300 mb-3">view_timeline</span>
        <p class="text-sm font-bold text-slate-500 capitalize">${periodLabel}</p>
        <p class="text-xs text-slate-400 mt-2">${EMPTY_MSG[viewMode] || EMPTY_MSG.month}</p>
        <p class="text-xs text-slate-400 mt-1">Ajusta os filtros ou navega para outro período.</p>
      </div>`;
  }

  const columnDates = resolveColumnDates(viewMode, from, to, groups);
  const dateCounts = new Map();
  let totalPayments = 0;
  groups.forEach((g) => {
    g.payments.forEach((p) => {
      const iso = paymentIso(p);
      if (!iso) return;
      dateCounts.set(iso, (dateCounts.get(iso) || 0) + 1);
      totalPayments += 1;
    });
  });

  const colWidth = COL_WIDTH[viewMode] || COL_WIDTH.month;
  const colCount = columnDates.length;
  const gridTemplate = buildGridTemplate(colCount, colWidth, viewMode);
  const tableWidth = LABEL_WIDTH + colCount * colWidth + STATUS_WIDTH;
  const scrollClass = viewMode === "month" ? "gantt-scroll" : "gantt-scroll gantt-scroll--fluid";

  let bodyHtml = "";

  // Cabeçalho
  bodyHtml += `
    <div class="gantt-row gantt-row-header sticky top-0 z-20 border-b border-slate-200"
      style="${rowStyle(gridTemplate, viewMode, tableWidth)}">
      <div class="sticky left-0 z-30 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 border-r border-slate-200 bg-slate-50 flex items-center">
        Pagamento
      </div>
      ${columnDates.map((iso) => renderDateHeader(iso, todayIso, dateCounts.get(iso) || 0, viewMode)).join("")}
      <div class="sticky right-0 z-30 px-2 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center border-l border-slate-200 bg-slate-50 flex items-center justify-center">
        Estado
      </div>
    </div>`;

  groups.forEach((group, gi) => {
    const palette = GROUP_PALETTE[gi % GROUP_PALETTE.length];
    bodyHtml += `
      <div class="gantt-row gantt-row-group border-b border-slate-100/80 ${palette.row}"
        style="${rowStyle(gridTemplate, viewMode, tableWidth)}">
        <div class="col-span-full px-3 py-2 sticky left-0 ${palette.sticky}">
          <span class="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${palette.pill}">
            ${escapeHtml(group.name)}${group.code ? ` · ${escapeHtml(group.code)}` : ""}
          </span>
          <span class="text-[10px] font-bold text-slate-400 ml-2">${group.payments.length} pag.</span>
        </div>
      </div>`;

    group.payments.forEach((p) => {
      const dueIso = paymentIso(p);
      const st = p.timelineStatus || resolveTimelineStatus(p);
      const meta = TIMELINE_STATUS[st] || TIMELINE_STATUS.PENDENTE;
      const barClass = BAR_BY_STATUS[st] || BAR_BY_STATUS.PENDENTE;
      const cur = p.costCenter?.currency || "AOA";
      const payload = escapeHtml(JSON.stringify(p)).replace(/'/g, "&#39;");
      const amount = formatCurrency(p.budgetedAmount, cur);
      const supplier = p.supplier || "Sem fornecedor";
      const barHtml = renderPaymentMarker(p, viewMode, barClass, payload, amount, onPaymentClick);

      bodyHtml += `
        <div class="gantt-row gantt-row-payment border-b border-slate-100/80 ${palette.row} hover:bg-white/80 transition-colors"
          style="${rowStyle(gridTemplate, viewMode, tableWidth)}">
          <div class="sticky left-0 z-10 px-3 py-2 flex flex-col justify-center border-r border-slate-200/80 ${palette.sticky}">
            <p class="text-xs font-bold text-slate-800 truncate" title="${escapeHtml(p.description)}">${escapeHtml(p.description)}</p>
            <p class="text-[10px] text-slate-500 truncate mt-0.5">${escapeHtml(supplier)} · ${escapeHtml(p.costCenter?.code || "—")}</p>
          </div>
          ${columnDates.map((iso) => renderDayCell(iso, dueIso, barHtml, viewMode)).join("")}
          <div class="sticky right-0 z-10 flex items-center justify-center px-2 border-l border-slate-200/80 ${palette.sticky}">
            <span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${meta.badge}">${meta.label}</span>
          </div>
        </div>`;
    });
  });

  const viewBadge = { day: "Dia", week: "Semana", month: "Mês" }[viewMode] || "Mês";
  const clickHint = viewMode === "month"
    ? "Clica num ponto colorido para ver detalhes e liquidar. Passa o rato para ver o valor."
    : "Clica numa barra para abrir os detalhes e liquidar o pagamento.";

  return `
    <div class="payment-gantt">
      <div class="flex items-center justify-between gap-3 mb-4 px-1 flex-wrap">
        <div>
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${viewBadge}</span>
            <h3 class="text-base font-bold text-slate-900 capitalize">${periodLabel}</h3>
          </div>
          <p class="text-[10px] font-semibold text-slate-400 mt-0.5">${buildPeriodSubtitle(viewMode, colCount, totalPayments)}</p>
        </div>
        <div class="flex items-center gap-3 text-[10px] font-bold text-slate-500">
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span>Pendente</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-red-500"></span>Atrasado</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>Pago</span>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div class="${scrollClass} max-h-[calc(100vh-380px)] overflow-auto custom-scroll">
          ${bodyHtml}
        </div>
      </div>
      <p class="text-[10px] text-slate-400 font-semibold mt-3 px-1">${clickHint}</p>
    </div>`;
}

export function getDateRangeForView(viewMode, anchor) {
  const a = new Date(anchor);
  a.setHours(0, 0, 0, 0);

  if (viewMode === "day") {
    const to = new Date(a);
    to.setHours(23, 59, 59, 999);
    return { from: a, to };
  }

  if (viewMode === "week") {
    const monday = new Date(a);
    monday.setDate(a.getDate() - ((a.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { from: monday, to: sunday };
  }

  const from = new Date(a.getFullYear(), a.getMonth(), 1);
  const to = new Date(a.getFullYear(), a.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export const GANTT_VIEW_MODES = ["day", "week", "month"];

export const KPI_PERIOD_LABELS = {
  day: "Valor do Dia",
  week: "Valor da Semana",
  month: "Valor do Mês",
};
