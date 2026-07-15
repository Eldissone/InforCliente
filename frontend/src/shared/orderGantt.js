import { formatCurrency } from "./format.js";
import { DELIVERY_STATUS, resolveDeliveryStatus } from "./deliveryTimeline.js";
export { getDateRangeForView, GANTT_VIEW_MODES } from "./paymentGantt.js";

const GROUP_PALETTE = [
  { pill: "bg-violet-100 text-violet-700", row: "bg-violet-50/60", sticky: "bg-violet-50" },
  { pill: "bg-emerald-100 text-emerald-700", row: "bg-emerald-50/60", sticky: "bg-emerald-50" },
  { pill: "bg-sky-100 text-sky-700", row: "bg-sky-50/60", sticky: "bg-sky-50" },
  { pill: "bg-pink-100 text-pink-700", row: "bg-pink-50/60", sticky: "bg-pink-50" },
  { pill: "bg-amber-100 text-amber-700", row: "bg-amber-50/60", sticky: "bg-amber-50" },
  { pill: "bg-cyan-100 text-cyan-700", row: "bg-cyan-50/60", sticky: "bg-cyan-50" },
];

export const GANTT_ORDER_STATUS = {
  ...DELIVERY_STATUS,
  EXTRA_A_LIQUIDAR: { label: "A liquidar", badge: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500" },
  REFORCO_PENDENTE: { label: "Reforço", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
};

const BAR_BY_STATUS = {
  PENDENTE: "bg-blue-500 hover:bg-blue-600",
  ATRASADO: "bg-red-500 hover:bg-red-600",
  RECEBIDO: "bg-emerald-500 hover:bg-emerald-600",
  EXTRA_A_LIQUIDAR: "bg-indigo-500 hover:bg-indigo-600",
  REFORCO_PENDENTE: "bg-amber-500 hover:bg-amber-600",
};

export function resolveOrderGanttStatus(item) {
  const st = item.timelineStatus || item.deliveryStatus;
  if (st === "EXTRA_A_LIQUIDAR" || st === "REFORCO_PENDENTE") return st;
  return resolveDeliveryStatus(item);
}

export function resolveGanttPlacementDate(rawDate, periodFrom, periodTo) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(periodFrom);
  from.setHours(0, 0, 0, 0);
  const to = new Date(periodTo);
  to.setHours(0, 0, 0, 0);
  let d = rawDate ? new Date(rawDate) : new Date(today);
  d.setHours(0, 0, 0, 0);
  if (d < today) d = today;
  if (d < from) d = from;
  if (d > to) d = to;
  return toLocalIsoDate(d);
}

/** Junta entregas, pedidos extra a liquidar e reforços pendentes num único cronograma. */
export function mergeOrdersGanttDays(deliveryDays, extraItems, reinforcementItems, { search } = {}) {
  const dayMap = new Map();

  const matchesSearch = (item) => {
    if (!search) return true;
    const term = search.toLowerCase();
    const hay = [
      item.need?.description,
      item.orderRef,
      item.supplier?.name,
      item.need?.project?.name,
      item.need?.costCenter?.code,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(term);
  };

  const addItem = (item) => {
    if (!matchesSearch(item)) return;
    const iso = orderIso(item);
    if (!iso) return;
    if (!dayMap.has(iso)) {
      dayMap.set(iso, { date: new Date(`${iso}T12:00:00`).toISOString(), items: [], count: 0 });
    }
    const day = dayMap.get(iso);
    day.items.push(item);
    day.count += 1;
  };

  (deliveryDays || []).forEach((day) => {
    (day.items || []).forEach((o) => addItem({ ...o, _ganttKind: o._ganttKind || "delivery" }));
  });
  (extraItems || []).forEach(addItem);
  (reinforcementItems || []).forEach(addItem);

  return [...dayMap.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

const COL_WIDTH = { month: 40, week: 72, day: 120 };
const LABEL_WIDTH = 256;
const STATUS_WIDTH = 96;

const EMPTY_MSG = {
  day: "Sem pedidos neste dia.",
  week: "Sem pedidos nesta semana.",
  month: "Sem pedidos neste mês.",
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toLocalIsoDate(value) {
  if (!value) return null;
  const raw = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function orderIso(o) {
  return toLocalIsoDate(o.expectedReceiptDate || o.dueDate || o._timelineDay);
}

function orderAmount(o) {
  const total = Number(o.totalValue);
  if (Number.isFinite(total) && total > 0) return total;
  const qty = Number(o.quantity) || 0;
  const price = Number(o.quotedPrice) || 0;
  return qty * price;
}

function groupByProject(days) {
  const map = new Map();
  (days || []).forEach((day) => {
    (day.items || []).forEach((o) => {
      const key = o.need?.project?.id || o.need?.project?.name || "__none__";
      if (!map.has(key)) {
        map.set(key, {
          name: o.need?.project?.name || "Sem obra",
          code: o.need?.project?.code || "",
          orders: [],
        });
      }
      map.get(key).orders.push({ ...o, _timelineDay: day.date });
    });
  });
  return Array.from(map.values()).map((g) => ({
    ...g,
    orders: g.orders.sort(
      (a, b) => new Date(a.expectedReceiptDate || a.dueDate || a._timelineDay) - new Date(b.expectedReceiptDate || b.dueDate || b._timelineDay)
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
    return iso ? [iso] : [];
  }
  return [];
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
  return `${base} width:100%; min-width:100%;`;
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

function buildPeriodSubtitle(viewMode, colCount, totalOrders) {
  if (viewMode === "day") return `${totalOrders} pedido(s)`;
  return `${colCount} dias · ${totalOrders} pedido(s)`;
}

function renderDateHeader(iso, todayIso, count, viewMode) {
  const isToday = iso === todayIso;
  const d = new Date(iso + "T12:00:00");
  const weekday = d.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "");
  const dayNum = d.getDate();
  const isWeekend = d.getDay() % 6 === 0;
  const hasOrders = count > 0;

  if (viewMode === "month") {
    return `
      <div class="text-center py-1.5 border-r border-slate-200/70 bg-slate-50/90
        ${isToday ? "!bg-emerald-50" : isWeekend ? "bg-slate-100/60" : ""}">
        <div class="text-[9px] font-bold uppercase ${isToday ? "text-emerald-600" : "text-slate-300"}">${weekday.charAt(0)}</div>
        <div class="text-xs font-bold leading-tight ${isToday ? "text-emerald-700" : hasOrders ? "text-slate-700" : "text-slate-400"}">${dayNum}</div>
        ${hasOrders ? `<div class="w-1 h-1 rounded-full bg-indigo-400 mx-auto mt-0.5"></div>` : ""}
      </div>`;
  }

  const monthShort = d.toLocaleDateString("pt-PT", { month: "short" }).replace(".", "");
  const weekendBg = viewMode === "week" && isWeekend ? "bg-slate-100/60" : "";
  return `
    <div class="text-center py-2 border-r border-slate-200/80 bg-slate-50/90 ${isToday ? "!bg-emerald-50" : weekendBg}">
      <div class="text-[10px] font-black uppercase tracking-wide ${isToday ? "text-emerald-700" : "text-slate-400"}">${weekday}</div>
      <div class="text-sm font-bold ${isToday ? "text-emerald-700" : "text-slate-700"}">${viewMode === "week" ? `${dayNum} ${monthShort}` : dayNum}</div>
      <div class="text-[9px] font-bold text-slate-400 mt-0.5">${count} ped.</div>
    </div>`;
}

function renderOrderMarker(o, viewMode, barClass, payload, amountLabel, onOrderClick) {
  const title = `${o.need?.description || "—"} · ${amountLabel}`;
  if (viewMode === "month") {
    return `
      <button type="button"
        onclick="${onOrderClick}(this)"
        data-payload='${payload}'
        title="${escapeHtml(title)}"
        aria-label="${escapeHtml(title)}"
        class="w-4 h-4 rounded-full ${barClass} ring-2 ring-white shadow-md transition-transform hover:scale-125 cursor-pointer">
      </button>`;
  }
  return `
    <button type="button"
      onclick="${onOrderClick}(this)"
      data-payload='${payload}'
      title="${escapeHtml(title)}"
      class="w-full h-8 rounded-full ${barClass} text-white text-[10px] font-bold px-2 shadow-sm transition-all hover:shadow-md cursor-pointer flex items-center justify-center whitespace-nowrap">
      ${amountLabel}
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

/** Gantt de encomendas/pedidos agrupados por obra. */
export function renderOrderGantt(
  days,
  {
    viewMode = "month",
    periodFrom,
    periodTo,
    onOrderClick = "window.openGanttOrder",
    pendingQueueOnly = false,
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
        <span class="material-symbols-outlined text-5xl text-slate-300 mb-3">local_shipping</span>
        <p class="text-sm font-bold text-slate-500 capitalize">${periodLabel}</p>
        <p class="text-xs text-slate-400 mt-2">${EMPTY_MSG[viewMode] || EMPTY_MSG.month}</p>
        <p class="text-xs text-slate-400 mt-1">${pendingQueueOnly
          ? "Só aparecem pedidos extra a liquidar e reforços de fundo de maneio aguardando aprovação."
          : "Inclui encomendas com data prevista, pedidos extra a liquidar e reforços de fundo de maneio."}</p>
      </div>`;
  }

  const columnDates = resolveColumnDates(viewMode, from, to, groups);
  const dateCounts = new Map();
  let totalOrders = 0;
  groups.forEach((g) => {
    g.orders.forEach((o) => {
      const iso = orderIso(o);
      if (!iso) return;
      dateCounts.set(iso, (dateCounts.get(iso) || 0) + 1);
      totalOrders += 1;
    });
  });

  const colWidth = COL_WIDTH[viewMode] || COL_WIDTH.month;
  const colCount = columnDates.length;
  const gridTemplate = buildGridTemplate(colCount, colWidth, viewMode);
  const tableWidth = LABEL_WIDTH + colCount * colWidth + STATUS_WIDTH;
  const scrollClass = viewMode === "month" ? "gantt-scroll" : "gantt-scroll gantt-scroll--fluid";

  let bodyHtml = "";

  bodyHtml += `
    <div class="gantt-row gantt-row-header sticky top-0 z-20 border-b border-slate-200"
      style="${rowStyle(gridTemplate, viewMode, tableWidth)}">
      <div class="sticky left-0 z-30 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 border-r border-slate-200 bg-slate-50 flex items-center">
        Pedido
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
          <span class="text-[10px] font-bold text-slate-400 ml-2">${group.orders.length} ped.</span>
        </div>
      </div>`;

    group.orders.forEach((o) => {
      const dueIso = orderIso(o);
      const st = resolveOrderGanttStatus(o);
      const meta = GANTT_ORDER_STATUS[st] || GANTT_ORDER_STATUS.PENDENTE;
      const barClass = BAR_BY_STATUS[st] || BAR_BY_STATUS.PENDENTE;
      const amountLabel = formatCurrency(orderAmount(o), "AOA");
      const supplier = o.supplier?.name || "Sem fornecedor";
      const orderRef = o.orderRef || (o.orderNumber ? `EF${String(o.orderNumber).padStart(3, "0")}` : "—");
      const desc = o.need?.description || "—";
      const payload = escapeHtml(JSON.stringify(o)).replace(/'/g, "&#39;");
      const barHtml = renderOrderMarker(o, viewMode, barClass, payload, amountLabel, onOrderClick);

      bodyHtml += `
        <div class="gantt-row gantt-row-payment border-b border-slate-100/80 ${palette.row} hover:bg-white/80 transition-colors"
          style="${rowStyle(gridTemplate, viewMode, tableWidth)}">
          <div class="sticky left-0 z-10 px-3 py-2 flex flex-col justify-center border-r border-slate-200/80 ${palette.sticky}">
            <p class="text-xs font-bold text-slate-800 truncate" title="${escapeHtml(desc)}">${escapeHtml(desc)}</p>
            <p class="text-[10px] text-slate-500 truncate mt-0.5">${escapeHtml(orderRef)} · ${escapeHtml(supplier)}</p>
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
    ? "Clica num ponto colorido para ver detalhes do pedido."
    : "Clica numa barra para ver detalhes do pedido.";

  return `
    <div class="payment-gantt order-gantt">
      <div class="flex items-center justify-between gap-3 mb-4 px-1 flex-wrap">
        <div>
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${viewBadge}</span>
            <h3 class="text-base font-bold text-slate-900 capitalize">${periodLabel}</h3>
          </div>
          <p class="text-[10px] font-semibold text-slate-400 mt-0.5">${buildPeriodSubtitle(viewMode, colCount, totalOrders)}</p>
        </div>
        <div class="flex items-center gap-3 text-[10px] font-bold text-slate-500 flex-wrap justify-end">
          ${pendingQueueOnly
            ? `
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>A liquidar</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>Reforço</span>`
            : `
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span>Previsto</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-red-500"></span>Atrasado</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>Recebido</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>A liquidar</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>Reforço</span>`}
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
