const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export const DELIVERY_STATUS = {
  PENDENTE: { label: "Previsto", badge: "bg-blue-100 text-blue-700", dot: "bg-blue-400" },
  ATRASADO: { label: "Atrasado", badge: "bg-red-100 text-red-700", dot: "bg-red-500" },
  RECEBIDO: { label: "Recebido", badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-400" },
};

export function resolveDeliveryStatus(item) {
  return item.timelineStatus || item.deliveryStatus || "PENDENTE";
}

/** Grade mensal de entregas — usa o output de buildDeliveryTimeline (days). */
export function renderDeliveryCalendar(days, { year, month, onDayClick = "selectDeliveryDay" } = {}) {
  const dayMap = new Map();
  (days || []).forEach((d) => {
    const key = new Date(d.date).toISOString().slice(0, 10);
    dayMap.set(key, d);
  });

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
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
    const hasOverdue = dayData?.items?.some((q) => resolveDeliveryStatus(q) === "ATRASADO");
    const hasPending = dayData?.items?.some((q) => resolveDeliveryStatus(q) === "PENDENTE");

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
        ${count ? `<p class="text-[10px] font-bold text-slate-500 mt-1">${count} ent.</p>` : ""}
      </button>`;
  }

  html += `</div>`;
  return html;
}
