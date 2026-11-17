// Cronograma de pagamentos (lista, calendário, parcelas, receção em obra)
import { apiRequest, getAssetUrl, apiUpload } from "/services/api.js";
import { can } from "/shared/permissions.js";
import { getSessionUser } from "/services/auth.js";
import { formatCurrency, formatDateBR, formatDateOnlyBR, toDateKey, dateInputToUtcNoonIso } from "/shared/format.js";
import { renderGroupedListRows, TIMELINE_STATUS, formatTimelineDayLabel } from "/shared/paymentTimeline.js";
import { computeFiscalBreakdown, paymentPayableAmount } from "/shared/supplierFiscal.js";
import { renderAsideProductSection, renderAsideAccountingLine } from "/shared/paymentDetailAside.js";

let _ctx = null;
const ctx = () => _ctx;
const budgetViewMode = "realizado"; // o cronograma trabalha sempre sobre valores realizados

/** ctx: { getProject, showToast(msg,type), onChanged(), showCronograma() } */
export function initCronograma(context) {
  _ctx = context;
}

const PANEL_HTML = `                    <!-- Entrega ↔ Pagamento (Fase I) -->
                    <div id="cronogramaPlanningSection"
                        class="hidden mb-6 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div class="px-6 py-4 border-b border-slate-50">
                            <h3 class="font-bold text-slate-900">Entrega ↔ Pagamento</h3>
                            <p class="text-xs text-slate-400 mt-0.5">Entrega prevista, recepção planeadas (cotação) ou confirmada em obra, e próximo vencimento</p>
                        </div>
                        <div class="overflow-x-auto custom-scroll">
                            <table class="w-full cc-table">
                                <thead>
                                    <tr>
                                        <th class="text-left">Item</th>
                                        <th class="text-left">Fornecedor</th>
                                        <th class="text-center">Entrega prevista</th>
                                        <th class="text-center">Recepção armazém</th>
                                        <th class="text-center">Recepção obra</th>
                                        <th class="text-center">Próx. pagamento</th>
                                    </tr>
                                </thead>
                                <tbody id="cronogramaPlanningBody"></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div
                            class="px-6 py-5 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div>
                                <h3 class="font-bold text-slate-900">Cronograma de Pagamentos</h3>
                                <p class="text-xs text-slate-400 mt-0.5">Linhas «A definir» aguardam parcelamento ·
                                    parcelas da cotação e do cronograma aparecem com data (estado «Planeado» até 1 dia
                                    antes do vencimento)</p>
                            </div>
                            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                <input id="cronogramaSearch" type="search" placeholder="Pesquisar..."
                                    class="h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2afc8d]/50 w-full sm:w-36">
                                <select id="cronogramaStatusFilter"
                                    class="h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none">
                                    <option value="">Todos</option>
                                    <option value="PENDENTE">Pendentes</option>
                                    <option value="VENCIDO">Atrasados</option>
                                    <option value="CONFIRMADO">Liquidados</option>
                                </select>
                                <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                                    <button id="btnViewList"
                                        class="flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all bg-white text-slate-900 shadow-sm"
                                        onclick="toggleCronogramaView('list')"><span
                                            class="material-symbols-outlined text-base">list</span> Lista</button>
                                    <button id="btnViewCalendar"
                                        class="flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500 hover:text-slate-900"
                                        onclick="toggleCronogramaView('calendar')"><span
                                            class="material-symbols-outlined text-base">calendar_month</span>
                                        Calendário</button>
                                </div>
                            </div>
                        </div>
                        <div id="cronogramaListContainer" class="overflow-x-auto custom-scroll">
                            <table class="w-full cc-table">
                                <thead>
                                    <tr>
                                        <th class="text-left w-28">Data</th>
                                        <th class="text-left">Descrição</th>
                                        <th class="text-left">CC</th>
                                        <th class="text-right">Valor</th>
                                        <th class="text-center">Status</th>
                                        <th class="text-center">Ações</th>
                                    </tr>
                                </thead>
                                <tbody id="cronogramaTableBody">
                                    <tr>
                                        <td colspan="6">
                                            <div class="spinner my-8"></div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div id="cronogramaCalendarContainer" class="hidden p-4 md:p-6 bg-white">
                        <div class="flex items-center justify-between mb-4">
                            <button type="button" onclick="shiftCronogramaCalendarMonth(-1)" title="Mês anterior"
                                class="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">
                                <span class="material-symbols-outlined text-lg">chevron_left</span>
                            </button>
                            <div class="flex items-center gap-3">
                                <h4 id="calMonthLabel"
                                    class="text-sm font-black text-slate-800 uppercase tracking-wide"></h4>
                                <button type="button" onclick="goToCurrentCronogramaMonth()"
                                    class="text-[10px] font-bold uppercase tracking-wide text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors">Hoje</button>
                            </div>
                            <button type="button" onclick="shiftCronogramaCalendarMonth(1)" title="Mês seguinte"
                                class="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">
                                <span class="material-symbols-outlined text-lg">chevron_right</span>
                            </button>
                        </div>
                        <div id="cronogramaCalendarBody">
                            <div class="p-8 text-center text-slate-400 text-sm font-medium">A carregar calendário...
                            </div>
                        </div>
                    </div>`;
const MODALS_HTML = `    <!-- Modal: Recepção em Obra (Fase I) -->
    <div class="modal-overlay" id="modalSiteReception">
        <div class="modal-box" style="max-width:480px">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h2 class="text-xl font-bold text-slate-900 tracking-tight">Recepção em Obra</h2>
                    <p id="siteReceptionDesc" class="text-xs font-semibold text-slate-400 mt-0.5"></p>
                </div>
                <button type="button" onclick="document.getElementById('modalSiteReception').classList.remove('open')"
                    class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <form id="formSiteReception" class="flex flex-col gap-4">
                <input type="hidden" id="siteReceptionNeedId" />
                <input type="hidden" id="siteReceptionCCId" />
                <div>
                    <label class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Data de
                        recepção</label>
                    <input type="date" id="siteReceptionDate" required
                        class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold">
                </div>
                <div>
                    <label class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Notas
                        (opcional)</label>
                    <textarea id="siteReceptionNotes" rows="2"
                        class="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"></textarea>
                </div>
                <div class="flex justify-end gap-3 pt-2">
                    <button type="button"
                        onclick="document.getElementById('modalSiteReception').classList.remove('open')"
                        class="h-10 px-5 rounded-xl font-bold text-xs text-slate-500 hover:bg-slate-100">Cancelar</button>
                    <button type="submit"
                        class="h-10 px-6 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700">Confirmar
                        recepção</button>
                </div>
            </form>
        </div>
    </div>


    <!-- Modal: Definir Cronograma de Pagamento -->
    <div class="modal-overlay" id="modalCronograma">
        <div class="modal-box" style="max-width:720px">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h2 class="text-xl font-bold text-slate-900 tracking-tight">Definir Cronograma de Pagamento</h2>
                    <p id="cronogramaItemDesc" class="text-xs font-semibold text-slate-400 mt-0.5"></p>
                </div>
                <button type="button" onclick="document.getElementById('modalCronograma').classList.remove('open')"
                    aria-label="Fechar"
                    class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
                    <span class="material-symbols-outlined text-lg">close</span>
                </button>
            </div>
            <form id="formCronograma" class="flex flex-col gap-5">
                <input type="hidden" id="cronogramaNeedId" />
                <input type="hidden" id="cronogramaCCId" />
                <input type="hidden" id="cronogramaQuoteId" />

                <p id="cronogramaSupplierLabel" class="hidden text-xs font-bold text-indigo-700 mb-1"></p>

                <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-2">
                    <div>
                        <p id="cronogramaTotalLabel" class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                            Valor líquido a pagar
                        </p>
                        <p id="cronogramaTotalValue" class="text-lg font-bold text-slate-900"></p>
                    </div>
                    <p id="cronogramaBaseValue" class="hidden text-[11px] font-semibold text-slate-500"></p>
                    <p id="cronogramaFiscalHint" class="hidden text-[10px] font-semibold text-emerald-700">
                        Impostos definidos na cotação — parcelas usam este valor líquido.
                    </p>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="cronogramaPaymentType"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Tipo de
                            Pagamento</label>
                        <select id="cronogramaPaymentType"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40">
                            <option value="PRONTO_PAGAMENTO">PP</option>
                            <option value="CREDITO">C</option>
                        </select>
                    </div>
                    <div>
                        <label for="cronogramaNumParcelas"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Número de
                            Parcelas</label>
                        <div class="flex items-center gap-1 w-full">
                            <input id="cronogramaNumParcelas" type="number" min="1" value="1"
                                class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40" />
                            <button type="button" onclick="gerarParcelasAutomaticas()"
                                class="h-11 px-4 rounded-xl bg-[#212e3e] text-[#2afc8d] text-xs font-bold hover:bg-slate-800 transition-all">
                                Gerar
                            </button>
                        </div>
                    </div>
                </div>

                <div class="overflow-x-auto custom-scroll">
                    <table class="w-full text-left border-collapse min-w-[600px]">
                        <thead>
                            <tr
                                class="border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                <th class="py-2 px-2 w-12 text-center">Parcela</th>
                                <th class="py-2 px-2">Data de Pagamento *</th>
                                <th class="py-2 px-2 w-32 text-right">Valor (%)</th>
                                <th class="py-2 px-2 w-40 text-right">Valor (AOA) *</th>
                                <th class="py-2 px-2 w-8"></th>
                            </tr>
                        </thead>
                        <tbody id="cronogramaParcelasBody">
                            <!-- Linhas de parcelas inseridas via JS -->
                        </tbody>
                    </table>
                </div>

                <div class="flex items-center justify-end gap-3 mt-4">
                    <button type="button" onclick="document.getElementById('modalCronograma').classList.remove('open')"
                        class="h-10 px-5 rounded-xl font-bold text-xs text-slate-500 hover:bg-slate-100 transition-all">Cancelar</button>
                    <button type="submit"
                        class="h-10 px-5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition-all shadow-md shadow-emerald-600/20">Gerar
                        Lançamentos</button>
                </div>
            </form>
        </div>
    </div>


    <!-- Modal: Pagamentos do Dia (Calendário do Cronograma) -->
    <div class="modal-overlay" id="modalCronogramaDay">
        <div class="modal-box">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h2 class="text-xl font-bold text-slate-900 tracking-tight">Pagamentos do Dia</h2>
                    <p id="cronogramaDayLabel" class="text-xs font-semibold text-slate-400 mt-0.5"></p>
                </div>
                <button type="button" onclick="document.getElementById('modalCronogramaDay').classList.remove('open')"
                    aria-label="Fechar"
                    class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
                    <span class="material-symbols-outlined text-lg">close</span>
                </button>
            </div>
            <div id="cronogramaDayListBody" class="flex flex-col gap-2 max-h-[420px] overflow-y-auto custom-scroll">
            </div>
        </div>
    </div>
`;

let mounted = false;
export function mountCronograma(container) {
  if (mounted || !container) return;
  mounted = true;
  container.innerHTML = PANEL_HTML;
  document.body.insertAdjacentHTML("beforeend", MODALS_HTML);

  let timer;
  document.getElementById("cronogramaSearch")?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadCronograma, 300);
  });
  document.getElementById("cronogramaStatusFilter")?.addEventListener("change", loadCronograma);
  document.getElementById("formCronograma")?.addEventListener("submit", submitCronograma);
  document.getElementById("formSiteReception")?.addEventListener("submit", submitSiteReception);
  document.getElementById("modalCronograma")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
  });
}

export function openCronogramaFromLink(needId, quoteId) {
  window.__pendingOpenCronogramaNeedId = needId;
  window.__pendingOpenCronogramaQuoteId = quoteId || null;
}

function needFiscalPercents(n) {
  return {
    vatPercent: Number(n?.fiscalVatPercent) || 0,
    withholdingPercent: Number(n?.fiscalWithholdingPercent) || 0,
    discountPercent: Number(n?.fiscalDiscountPercent) || 0,
  };
}

function needHasFiscalPercents(n) {
  const p = needFiscalPercents(n);
  return p.vatPercent > 0 || p.withholdingPercent > 0 || p.discountPercent > 0;
}

function needLineBase(n, unitPrice = null) {
  const unit = unitPrice ?? needDisplayUnitPrice(n);
  if (unit == null) return 0;
  const qty = Number(n?.quantity) || 0;
  const hours = Number(n?.hours) || 1;
  return qty * unit * hours;
}

function needFiscalBreakdown(n, { perUnit = false } = {}) {
  const pct = needFiscalPercents(n);
  const unit = needDisplayUnitPrice(n);
  if (unit == null) return null;
  const baseAmount = perUnit ? unit : needLineBase(n, unit);
  return computeFiscalBreakdown({
    fiscalPercents: pct,
    baseAmount,
    applyVat: pct.vatPercent > 0,
    applyWithholding: pct.withholdingPercent > 0,
    applyDiscount: pct.discountPercent > 0,
  });
}

function isNeedPaidLocked(n) {
  return n?.status === "PAID";
}

function canModifyPaidNeed() {
  const role = (getSessionUser()?.role || "").toLowerCase();
  if (role === "admin") return true;
  return can("obras", "manage") || can("obras", "full_access");
}

function needIsLockedForEdit(n) {
  return isNeedPaidLocked(n) && !canModifyPaidNeed();
}

function canRealizadoAgendar(n) {
  if (needIsLockedForEdit(n)) return false;
  const st = n.status;
  const hasPrice = Number(n.realizadoUnitPrice ?? n.unitPrice) > 0;
  return (st === "EM_ANALISE" || st === "APPROVED") && n.marketWorkflowStarted && !n.scheduled && hasPrice;
}

function needDisplayUnitPrice(n) {
  if (budgetViewMode === "realizado") {
    return n.realizadoUnitPrice != null ? Number(n.realizadoUnitPrice) : null;
  }
  return Number(n.previstoUnitPrice ?? n.originalUnitPrice ?? n.unitPrice) || 0;
}

function needDisplayLineTotal(n) {
  if (budgetViewMode === "realizado") {
    const unit = needDisplayUnitPrice(n);
    if (unit == null) return null;
    if (!needHasFiscalPercents(n)) {
      const base = needLineBase(n, unit);
      return base > 0 ? base : (n.realizadoTotal != null ? Number(n.realizadoTotal) : null);
    }
    const breakdown = needFiscalBreakdown(n);
    return breakdown?.net ?? null;
  }
  return Number(n.previstoTotal) || 0;
}

function needCronogramaTotal(n) {
  if (n.amount != null) return Number(n.amount) || 0;
  const displayTotal = needDisplayLineTotal(n);
  if (displayTotal != null && displayTotal > 0) return displayTotal;
  if (n.realizadoTotal != null) return Number(n.realizadoTotal) || 0;
  const qty = Number(n.quantity) || 0;
  const price = Number(n.realizadoUnitPrice ?? n.unitPrice) || 0;
  const hours = Number(n.hours) || 1;
  return qty * price * hours;
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
  // Mostrar todos os pagamentos planeados (cotação/fatura ou cronograma manual), não só 1 dia antes do vencimento
  params.set("onlyVisible", "false");
  return params;
}

async function loadCronograma() {
  if (!ctx().getProject()) return;
  const tbody = document.getElementById("cronogramaTableBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="spinner my-8"></div></td></tr>`;

  try {
    const [needsData, timelineData, deliveriesData] = await Promise.all([
      apiRequest(
        `/cost-centers/project/${ctx().getProject().id}/needs?pageSize=500&awaitingInstallments=true`
      ),
      apiRequest(`/cost-centers/project/${ctx().getProject().id}/payments/timeline?${getCronogramaFilters()}`),
      apiRequest(`/cost-centers/project/${ctx().getProject().id}/deliveries/timeline?includeReceived=true`).catch(() => ({ planningLinks: [] })),
    ]);

    cronogramaPendingNeeds = needsData.items || [];
    renderCronogramaPlanning(deliveriesData.planningLinks || []);

    renderCronogramaList(timelineData.days);

    const pendingNeedId = window.__pendingOpenCronogramaNeedId;
    const pendingQuoteId = window.__pendingOpenCronogramaQuoteId;
    if (pendingNeedId) {
      window.__pendingOpenCronogramaNeedId = null;
      window.__pendingOpenCronogramaQuoteId = null;
      const n = cronogramaPendingNeeds.find((item) => item.id === pendingNeedId && (!pendingQuoteId || item.quoteId === pendingQuoteId));
      if (n) {
        const total = needCronogramaTotal(n);
        const currency = n.currency || n.costCenter?.currency || "AOA";
        setTimeout(
          () => openCronogramaModalFromNeed(n),
          150
        );
      }
    }

    if (cronogramaViewMode === "calendar") loadCronogramaCalendar();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

function renderCronogramaPlanning(links) {
  const section = document.getElementById("cronogramaPlanningSection");
  const tbody = document.getElementById("cronogramaPlanningBody");
  if (!section || !tbody) return;

  if (!links?.length) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  tbody.innerHTML = links.map((row) => {
    const entrega = row.expectedReceiptDate ? formatDateOnlyBR(row.expectedReceiptDate) : "—";
    const armazem = row.warehouseReceivedAt ? formatDateOnlyBR(row.warehouseReceivedAt) : "—";
    let obraHtml = "—";
    if (row.siteReceivedAt) {
      obraHtml = `<span class="text-sky-700 font-semibold" title="Recepção confirmada">${formatDateOnlyBR(row.siteReceivedAt)}</span>`;
    } else if (row.siteReceptionPlannedAt) {
      const dateLabel = formatDateOnlyBR(row.siteReceptionPlannedAt);
      const locRaw = row.siteReceptionLocation?.trim() || "";
      const locEsc = locRaw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
      obraHtml = `<div class="leading-tight"><span class="text-sky-600 font-semibold" title="Recepção planeadas na cotação">${dateLabel}</span>${locEsc ? `<div class="text-[10px] text-slate-400 font-normal mt-0.5">${locEsc}</div>` : ""}</div>`;
    }
    const pagamento = row.nextPaymentDate ? formatDateOnlyBR(row.nextPaymentDate) : "—";
    const payBadge = row.nextPaymentStatus === "CONFIRMADO"
      ? "bg-emerald-100 text-emerald-700"
      : row.nextPaymentDate
        ? "bg-indigo-100 text-indigo-700"
        : "bg-slate-100 text-slate-500";
    return `
    <tr>
      <td class="font-medium text-slate-900 text-sm max-w-xs truncate" title="${(row.description || "").replace(/"/g, "&quot;")}">${row.description || "—"}</td>
      <td class="text-sm text-slate-600">${row.supplier || "—"}</td>
      <td class="text-center text-xs font-semibold text-slate-700">${entrega}</td>
      <td class="text-center text-xs text-slate-500">${armazem}</td>
      <td class="text-center text-xs">${obraHtml}</td>
      <td class="text-center"><span class="text-[10px] font-bold px-2 py-1 rounded-full ${payBadge}">${pagamento}</span></td>
    </tr>`;
  }).join("");
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
  if (!ctx().getProject()) return;
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

    const data = await apiRequest(`/cost-centers/project/${ctx().getProject().id}/payments/timeline?${params}`);
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
    const totalObra = needCronogramaTotal(n);
    const currency = n.currency || n.costCenter?.currency || "AOA";
    const supplierLabel = n.supplierLabel || n.supplier?.name;
    const desc = (n.displayDescription || n.description || "").replace(/'/g, "\\'");
    const quoteArg = n.quoteId ? `'${n.quoteId}'` : "null";
    const supplierArg = supplierLabel ? `'${supplierLabel.replace(/'/g, "\\'")}'` : "null";
    return `
      <tr class="bg-amber-50/30">
        <td class="text-xs font-bold text-amber-600 w-28">A definir</td>
        <td class="font-medium text-slate-900 max-w-xs truncate" title="${(n.displayDescription || n.description || "").replace(/"/g, "&quot;")}">${n.displayDescription || n.description}</td>
        <td class="text-sm text-slate-500">${n.costCenter?.code || "—"} · ${supplierLabel || n.costCenter?.name || ""}</td>
        <td class="text-right text-sm font-bold text-slate-900">${formatCurrency(totalObra, currency)}</td>
        <td class="text-center"><span class="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">Aguardar parcelamento</span></td>
        <td class="text-center">
          <button onclick="openCronogramaModalFromNeedById('${n.id}', ${quoteArg})" title="Definir Cronograma"
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
let _cronogramaSyncing = false;

function getCronogramaParcelRows() {
  return Array.from(document.querySelectorAll("#cronogramaParcelasBody tr"));
}

function setParcelRowAmounts(row, percent) {
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const percentInput = row.querySelector(".parcela-percent");
  const valorInput = row.querySelector(".parcela-valor");
  if (percentInput) percentInput.value = pct.toFixed(2);
  if (valorInput) valorInput.value = ((pct / 100) * currentCronogramaTotal).toFixed(2);
  return pct;
}

function rebalanceCronogramaPercents(changedInput) {
  if (_cronogramaSyncing || !changedInput) return;
  _cronogramaSyncing = true;
  try {
    const rows = getCronogramaParcelRows();
    if (!rows.length) return;

    const changedRow = changedInput.closest("tr");
    const changedIdx = rows.indexOf(changedRow);
    if (changedIdx < 0) return;

    if (changedInput.classList.contains("parcela-percent")) {
      const pct = setParcelRowAmounts(changedRow, changedInput.value);

      if (rows.length === 1) return;

      if (rows.length === 2) {
        const otherIdx = changedIdx === 0 ? 1 : 0;
        setParcelRowAmounts(rows[otherIdx], 100 - pct);
        return;
      }

      let sumExceptLast = 0;
      for (let i = 0; i < rows.length - 1; i++) {
        sumExceptLast += parseFloat(rows[i].querySelector(".parcela-percent")?.value) || 0;
      }
      if (sumExceptLast > 100) {
        const overflow = sumExceptLast - 100;
        const adjusted = Math.max(0, pct - overflow);
        setParcelRowAmounts(changedRow, adjusted);
        sumExceptLast = 100;
      }
      setParcelRowAmounts(rows[rows.length - 1], Math.max(0, 100 - sumExceptLast));
      return;
    }

    if (changedInput.classList.contains("parcela-valor")) {
      const valor = parseFloat(changedInput.value) || 0;
      const pct =
        currentCronogramaTotal > 0 ? (valor / currentCronogramaTotal) * 100 : 0;
      changedInput.closest("tr").querySelector(".parcela-percent").value = pct.toFixed(2);
      _cronogramaSyncing = false;
      rebalanceCronogramaPercents(changedRow.querySelector(".parcela-percent"));
    }
  } finally {
    _cronogramaSyncing = false;
  }
}

function bindCronogramaParcelRowEvents(tr) {
  const percentInput = tr.querySelector(".parcela-percent");
  const valorInput = tr.querySelector(".parcela-valor");

  percentInput?.addEventListener("input", () => rebalanceCronogramaPercents(percentInput));
  valorInput?.addEventListener("input", () => rebalanceCronogramaPercents(valorInput));

  tr.querySelector('button[type="button"]')?.addEventListener("click", () => {
    setTimeout(() => {
      const rows = getCronogramaParcelRows();
      if (!rows.length) return;
      const equal = 100 / rows.length;
      rows.forEach((row, idx) => {
        const pct = idx === rows.length - 1 ? 100 - equal * (rows.length - 1) : equal;
        setParcelRowAmounts(row, pct);
      });
    }, 0);
  });
}

function openCronogramaModalFromNeed(n) {
  if (!n) return;
  const currency = n.currency || n.costCenter?.currency || "AOA";
  openCronogramaModal(
    n.id,
    n.costCenterId,
    n.displayDescription || n.description,
    needCronogramaTotal(n),
    currency,
    n.quoteId || null,
    n.supplierLabel || n.supplier?.name || null,
    { baseAmount: n.baseAmount, hasFiscal: n.hasFiscal }
  );
}

window.openCronogramaModalFromNeedById = function (needId, quoteId = null) {
  const n = cronogramaPendingNeeds.find(
    (item) => item.id === needId && (!quoteId || item.quoteId === quoteId)
  );
  openCronogramaModalFromNeed(n);
};

window.openCronogramaModal = function (
  needId,
  ccId,
  description,
  total,
  currency = "AOA",
  quoteId = null,
  supplierName = null,
  fiscalMeta = null
) {
  currentCronogramaTotal = total;
  document.getElementById("cronogramaNeedId").value = needId;
  document.getElementById("cronogramaCCId").value = ccId;
  document.getElementById("cronogramaQuoteId").value = quoteId || "";
  const supplierEl = document.getElementById("cronogramaSupplierLabel");
  if (supplierEl) {
    supplierEl.textContent = supplierName ? `Fornecedor: ${supplierName}` : "";
    supplierEl.classList.toggle("hidden", !supplierName);
  }
  document.getElementById("cronogramaItemDesc").textContent = description;
  document.getElementById("cronogramaTotalValue").textContent = formatCurrency(total, currency);

  const baseEl = document.getElementById("cronogramaBaseValue");
  const hintEl = document.getElementById("cronogramaFiscalHint");
  const labelEl = document.getElementById("cronogramaTotalLabel");
  const baseAmount = Number(fiscalMeta?.baseAmount);
  const hasFiscal =
    Boolean(fiscalMeta?.hasFiscal) || (baseAmount > 0 && Math.abs(baseAmount - total) > 0.05);

  if (baseEl && hintEl && labelEl) {
    if (hasFiscal && baseAmount > 0) {
      baseEl.textContent = `Base orçamental (cotação): ${formatCurrency(baseAmount, currency)}`;
      baseEl.classList.remove("hidden");
      hintEl.classList.remove("hidden");
      labelEl.textContent = "Valor líquido a pagar (com impostos)";
    } else {
      baseEl.classList.add("hidden");
      hintEl.classList.add("hidden");
      labelEl.textContent = "Valor total do item";
    }
  }

  document.getElementById("cronogramaNumParcelas").value = 1;
  document.getElementById("cronogramaParcelasBody").innerHTML = "";
  gerarParcelasAutomaticas();
  document.getElementById("modalCronograma").classList.add("open");
};

window.openSiteReceptionModal = function (needId, ccId, description) {
  document.getElementById("siteReceptionNeedId").value = needId;
  document.getElementById("siteReceptionCCId").value = ccId;
  document.getElementById("siteReceptionDesc").textContent = description;
  document.getElementById("siteReceptionDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("siteReceptionNotes").value = "";
  document.getElementById("modalSiteReception").classList.add("open");
};

async function submitSiteReception(e) {
  e.preventDefault();
  const needId = document.getElementById("siteReceptionNeedId").value;
  const ccId = document.getElementById("siteReceptionCCId").value;
  const dateStr = document.getElementById("siteReceptionDate").value;
  const notes = document.getElementById("siteReceptionNotes").value?.trim() || null;

  if (!needId || !ccId || !dateStr) return;

  try {
    const receivedAt = new Date(`${dateStr}T12:00:00`).toISOString();
    await apiRequest(`/cost-centers/${ccId}/needs/${needId}/site-reception`, {
      method: "POST",
      body: { receivedAt, notes },
    });
    ctx().showToast("Recepção em obra registada.", "success");
    document.getElementById("modalSiteReception").classList.remove("open");
    await ctx().onChanged?.();
    if (document.getElementById("tab-cronograma")?.classList.contains("active")) {
      await loadCronograma();
    }
  } catch (err) {
    ctx().showToast("Erro: " + err.message, "error");
  }
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
    bindCronogramaParcelRowEvents(tr);

    // Add 30 days for next installment
    currentDate.setDate(currentDate.getDate() + 30);
  }
}

async function submitCronograma(e) {
  e.preventDefault();
  const needId = document.getElementById("cronogramaNeedId").value;
  const ccId = document.getElementById("cronogramaCCId").value;
  const quoteId = document.getElementById("cronogramaQuoteId")?.value?.trim() || null;
  const paymentType = document.getElementById("cronogramaPaymentType").value;
  const parcelasRows = document.querySelectorAll("#cronogramaParcelasBody tr");

  if (parcelasRows.length === 0) {
    ctx().showToast("Adiciona pelo menos uma parcela", "error");
    return;
  }

  const percentSum = Array.from(parcelasRows).reduce(
    (sum, row) => sum + (parseFloat(row.querySelector(".parcela-percent")?.value) || 0),
    0
  );
  if (Math.abs(percentSum - 100) > 0.05) {
    ctx().showToast(`As parcelas devem totalizar 100% (actual: ${percentSum.toFixed(2)}%).`, "error");
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
      body: { paymentType, installments, ...(quoteId ? { quoteId } : {}) },
    });

    ctx().showToast("Lançamentos gerados com sucesso!", "success");
    document.getElementById("modalCronograma").classList.remove("open");
    await Promise.all([loadCronograma(), ctx().onChanged?.()]);
    switchTab("pendentes");
  } catch (err) {
    ctx().showToast("Erro: " + err.message, "error");
  }
}



// ── Form Cronograma Edition ──────────────────────────────────────────────────
window.editCronograma = function (pay) {
  if (typeof pay === "string") pay = JSON.parse(pay);
  window.__openPayModal?.(pay);
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
    ctx().showToast("A enviar ao financeiro...", "info");
    await apiRequest(`/cost-centers/${ccId}/needs/${id}/send-to-finance`, { method: "POST" });

    await goToCronogramaAfterSchedule(1);
  } catch (err) {
    ctx().showToast(err.message || "Erro ao enviar ao financeiro.", "error");
  }
}

window.sendAllToCronograma = async function () {
  if (!ctx().getProject()) return;
  try {
    // First load all approved needs to get their IDs
    const params = new URLSearchParams({ pageSize: "1000" });
    const data = await apiRequest(`/cost-centers/project/${ctx().getProject().id}/needs?${params}`);
    const items = (data.items || []).filter((n) => canRealizadoAgendar(n));

    if (!items.length) {
      ctx().showToast("Nenhum item aprovado no realizado para enviar", "info");
      return;
    }

    const needIds = items.map((n) => n.id);

    if (!confirm(`Enviar ${needIds.length} item(ns) ao financeiro para agendamento?`)) return;

    ctx().showToast("A enviar items ao financeiro...", "info");
    await apiRequest(`/cost-centers/project/${ctx().getProject().id}/needs/schedule-bulk`, {
      method: "POST",
      body: { needIds }
    });

    await goToCronogramaAfterSchedule(needIds.length);
  } catch (err) {
    ctx().showToast("Erro: " + err.message, "error");
  }
}


export { loadCronograma };
