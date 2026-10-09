import { apiRequest } from "../../services/api.js";
import { formatCurrency, toDateKey } from "../../shared/format.js";
import { paymentPayableAmount } from "../../shared/supplierFiscal.js";
import { toast, openModal, escapeHtml, setButtonLoading } from "../../shared/ui.js";
import { can } from "../../shared/permissions.js";

const PT_MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const PT_MONTHS_SHORT = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
const GANTT_INK = "#212e3e";
const GANTT_STATUS_COLORS = {
  DRAFT: "#f43f5e",
  PENDING_MATERIAL: "#f43f5e",
  IN_PROGRESS: "#d97706",
  PENDING_VALIDATION: "#d97706",
  COMPLETED: "#059669",
  PENDING_RETURN: "#059669",
};
const GANTT_SCALES = ["day", "week", "month", "quarter", "year"];
const GANTT_SCALE_KEY = "InfoCliente.gantt.scale";
const GANTT_SCALE_PX = { day: 32, week: 52, month: 72, quarter: 100, year: 148 };
const GANTT_SCALE_MAX = { day: 800, week: 160, month: 60, quarter: 24, year: 12 };
const GANTT_BAR_MIN_PX = 100;
const GANTT_DEP_TYPES = ["FS", "SS", "FF", "SF"];
const PT_MONTHS_TINY = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const PONTO_KEY = "InfoCliente.registo.folhaPonto";
const BAREM_KEY = "InfoCliente.registo.barem";
const PLAN_TABS = new Set([
  "orcamento_custo",
  "orcamento_vendas",
  "plano_gantt",
  "plano_financeiro",
  "recursos_equipamentos",
  "recursos_materiais",
  "recursos_pessoal",
]);

let ctx = { getProjectId: () => null, getProject: () => null };
let wired = false;
const cache = {};

function projectId() {
  return ctx.getProjectId?.() || "";
}

function project() {
  return ctx.getProject?.() || {};
}

function currency() {
  return project()?.currency || "AOA";
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
}

function parseLocalDate(value) {
  const key = toDateKey(value);
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function formatPtLongDate(value) {
  const d = parseLocalDate(value);
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")} de ${PT_MONTHS_SHORT[d.getMonth()]} de ${d.getFullYear()}`;
}

function formatMonthYear(year, monthIndex) {
  const name = PT_MONTHS[monthIndex] || "";
  return `${name.toUpperCase()} DE ${year}`;
}

function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function startOfQuarter(date) {
  const month = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), month, 1, 0, 0, 0, 0);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function getGanttScale() {
  try {
    const saved = sessionStorage.getItem(GANTT_SCALE_KEY);
    if (GANTT_SCALES.includes(saved)) return saved;
  } catch {
    /* ignore */
  }
  return "week";
}

function setGanttScale(scale) {
  if (!GANTT_SCALES.includes(scale)) return;
  try {
    sessionStorage.setItem(GANTT_SCALE_KEY, scale);
  } catch {
    /* ignore */
  }
}

function syncGanttScaleButtons() {
  const scale = getGanttScale();
  document.querySelectorAll("[data-gantt-scale]").forEach((btn) => {
    const on = btn.getAttribute("data-gantt-scale") === scale;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function buildGanttUnits(scale, rangeStart, rangeEnd) {
  const units = [];
  const max = GANTT_SCALE_MAX[scale] || 100;
  const unitPx = GANTT_SCALE_PX[scale] || 52;
  if (!rangeStart || !rangeEnd) return { units, unitPx };

  if (scale === "day") {
    let cursor = startOfDay(startOfWeek(rangeStart));
    const last = endOfDay(rangeEnd);
    while (cursor <= last && units.length < max) {
      const start = new Date(cursor);
      const next = addDays(cursor, 1);
      units.push({ start, end: new Date(next.getTime() - 1), label: String(start.getDate()) });
      cursor = next;
    }
  } else if (scale === "week") {
    let cursor = startOfDay(startOfWeek(rangeStart));
    const last = startOfDay(startOfWeek(rangeEnd));
    let n = 1;
    while (cursor <= last && units.length < max) {
      const start = new Date(cursor);
      const next = addDays(cursor, 7);
      units.push({ start, end: new Date(next.getTime() - 1), label: `W${n}`, n });
      cursor = next;
      n += 1;
    }
  } else if (scale === "month") {
    let cursor = startOfMonth(rangeStart);
    const last = startOfMonth(rangeEnd);
    while (cursor <= last && units.length < max) {
      const start = new Date(cursor);
      const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      units.push({ start, end: new Date(next.getTime() - 1), label: PT_MONTHS_TINY[start.getMonth()] });
      cursor = next;
    }
  } else if (scale === "quarter") {
    let cursor = startOfYear(rangeStart);
    const last = startOfQuarter(rangeEnd);
    while (cursor <= last && units.length < max) {
      const start = new Date(cursor);
      const q = Math.floor(start.getMonth() / 3) + 1;
      const next = new Date(start.getFullYear(), start.getMonth() + 3, 1);
      units.push({ start, end: new Date(next.getTime() - 1), label: `Q${q}` });
      cursor = next;
    }
  } else if (scale === "year") {
    let cursor = startOfYear(rangeStart);
    const last = startOfYear(rangeEnd);
    while (cursor <= last && units.length < max) {
      const start = new Date(cursor);
      const next = new Date(start.getFullYear() + 1, 0, 1);
      units.push({ start, end: new Date(next.getTime() - 1), label: String(start.getFullYear()) });
      cursor = next;
    }
  }
  return { units, unitPx };
}

function ganttGroupUnits(units, scale) {
  if (!units.length) return [];
  if (scale === "year") {
    const y0 = units[0].start.getFullYear();
    const y1 = units[units.length - 1].start.getFullYear();
    return [{ label: y0 === y1 ? String(y0) : `${y0} - ${y1}`, span: units.length }];
  }
  const groups = [];
  units.forEach((u, idx) => {
    let key;
    let label;
    if (scale === "day" || scale === "week") {
      key = `${u.start.getFullYear()}-${u.start.getMonth()}`;
      label = formatMonthYear(u.start.getFullYear(), u.start.getMonth());
      if (scale === "day") {
        const next = units[idx + 1];
        const lastOfYear = !next || next.start.getFullYear() !== u.start.getFullYear();
        const name = (PT_MONTHS[u.start.getMonth()] || "").toUpperCase();
        label = lastOfYear ? `${name} DE ${u.start.getFullYear()}` : name;
      }
    } else {
      key = String(u.start.getFullYear());
      label = String(u.start.getFullYear());
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.span += 1;
      last.label = label;
    } else {
      groups.push({ key, label, span: 1 });
    }
  });
  return groups;
}

function dateToPx(date, units, unitPx) {
  if (!date || !units.length) return 0;
  const t = date.getTime();
  if (t <= units[0].start.getTime()) return 0;
  const last = units[units.length - 1];
  if (t >= last.end.getTime()) return units.length * unitPx;
  for (let i = 0; i < units.length; i += 1) {
    const start = units[i].start.getTime();
    const end = units[i].end.getTime();
    if (t >= start && t <= end) {
      const dur = Math.max(1, end - start);
      return i * unitPx + ((t - start) / dur) * unitPx;
    }
  }
  return units.length * unitPx;
}

function emptyRow(colspan, icon, message) {
  return `<tr><td colspan="${colspan}"><div class="pl-empty"><span class="material-symbols-outlined">${icon}</span><p class="text-sm font-semibold">${escapeHtml(message)}</p></div></td></tr>`;
}

function kpiCard(label, value, hint) {
  return `<div class="pl-kpi"><p>${escapeHtml(label)}</p><p class="pl-kpi-value">${value}</p>${hint ? `<p class="text-[10px] font-semibold text-slate-400 mt-1">${escapeHtml(hint)}</p>` : ""}</div>`;
}

function progressBar(pct) {
  const p = Math.max(0, Math.min(100, num(pct)));
  return `<div class="flex items-center gap-2"><div class="pl-bar-wrap flex-1"><div class="pl-bar" style="width:${p.toFixed(1)}%"></div></div><span class="text-[11px] font-black text-slate-600 w-10 text-right">${p.toFixed(0)}%</span></div>`;
}

function taskUnitValue(t) {
  const uvM = num(t.unitValueMaterial);
  const uvS = num(t.unitValueService);
  if (t.unitValue != null && t.unitValue !== undefined) return num(t.unitValue);
  return uvM + uvS;
}

function needLineTotal(n) {
  if (n.previstoTotal != null) return num(n.previstoTotal);
  const qty = num(n.quantity);
  const unit = num(n.originalUnitPrice ?? n.unitPrice);
  const hours = num(n.hours);
  return qty * unit * (hours > 0 ? hours : 1);
}

function productFamily(product) {
  const extras = product?.extras || product?.metadata || {};
  const family = extras.familia || extras.family || product?.costCategoryName || "";
  const sub = extras.subfamilia || extras.subfamily || product?.costSubcategoryName || "";
  const cat = String(product?.category || "MATERIAL").toUpperCase();
  const catLabel = cat === "CONSUMABLE" ? "Consumíveis" : cat === "TOOL" ? "Ferramentas" : cat === "EQUIPMENT" ? "Equipamentos" : "Materiais";
  return { family: family || catLabel, sub: sub || "—" };
}

function equipmentKindLabel(product) {
  const cat = String(product?.category || "").toUpperCase();
  if (cat === "TOOL") return "Ferramenta";
  const desc = String(product?.description || "");
  if (/viatura/i.test(desc)) return "Viatura";
  if (/maquinaria/i.test(desc)) return "Maquinaria";
  return "Equipamento";
}

function employeeLabel(p) {
  return [p.firstName || p.nome, p.lastName || p.apelido].filter(Boolean).join(" ").trim() || "—";
}

function pontoTipoNorm(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("extra")) return "Horas Extra";
  if (raw.includes("normal")) return "Horas Normais";
  return String(value || "");
}

function openExistingTab(tabId) {
  const trigger = document.querySelector(`[data-tab-trigger="${tabId}"]`);
  if (trigger && trigger.dataset.permDenied !== "true") trigger.click();
}

export function initProjectPlaneamento(options = {}) {
  ctx = { ...ctx, ...options };
  if (wired) return;
  wired = true;

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-pl-open-tab]");
    if (!btn) return;
    event.preventDefault();
    openExistingTab(btn.getAttribute("data-pl-open-tab"));
  });

  document.getElementById("plGanttRefresh")?.addEventListener("click", () => {
    cache.gantt = null;
    loadGantt();
  });
  document.getElementById("plGanttScale")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-gantt-scale]");
    if (!btn) return;
    const scale = btn.getAttribute("data-gantt-scale");
    if (!GANTT_SCALES.includes(scale) || scale === getGanttScale()) return;
    setGanttScale(scale);
    syncGanttScaleButtons();
    if (cache.gantt) renderGantt(cache.gantt);
  });
  document.getElementById("plGanttRoot")?.addEventListener("click", (event) => {
    const hit = event.target.closest("[data-gantt-id]");
    if (!hit || !cache.gantt?.fromPlans) return;
    event.preventDefault();
    openGanttDepsModal(String(hit.getAttribute("data-gantt-id")));
  });
  window.addEventListener("resize", () => {
    const root = document.getElementById("plGanttRoot");
    if (root && cache.gantt?.activities) paintGanttLinks(root, cache.gantt.activities);
  });
  syncGanttScaleButtons();
  document.getElementById("plBaremCreateBtn")?.addEventListener("click", () => openBaremModal());
  document.getElementById("plPessoalCreateBtn")?.addEventListener("click", () => openPessoalModal());
  document.getElementById("plPontoCreateBtn")?.addEventListener("click", () => openPontoModal());

  ["plPessoalNome", "plPessoalDe", "plPessoalAte", "plPessoalTipo", "plPessoalCusto"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => renderPessoalCustos());
    document.getElementById(id)?.addEventListener("change", () => renderPessoalCustos());
  });
}

export function loadPlaneamentoTab(tabId) {
  if (!PLAN_TABS.has(tabId)) return;
  const id = projectId();
  if (!id) return;

  const centro = `./centroCustos.html?projectId=${encodeURIComponent(id)}`;
  const custoLink = document.getElementById("plOrcamentoCustoLink");
  if (custoLink) custoLink.href = `${centro}&tab=necessidades`;
  const finLink = document.getElementById("plFinanceiroCronogramaLink");
  if (finLink) finLink.href = `${centro}&tab=cronograma`;

  if (tabId === "orcamento_custo") return loadOrcamentoCusto();
  if (tabId === "orcamento_vendas") return loadOrcamentoVendas();
  if (tabId === "plano_gantt") return loadGantt();
  if (tabId === "plano_financeiro") return loadFinanceiro();
  if (tabId === "recursos_equipamentos") return loadEquipamentos();
  if (tabId === "recursos_materiais") return loadMateriais();
  if (tabId === "recursos_pessoal") return loadPessoal();
}

async function loadOrcamentoCusto() {
  const body = document.getElementById("plOrcamentoCustoBody");
  const kpis = document.getElementById("plOrcamentoCustoKpis");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-xs text-slate-400 font-bold uppercase">A carregar...</td></tr>`;
  try {
    const data = await apiRequest(`/cost-centers/project/${encodeURIComponent(projectId())}/summary`);
    const summary = data.summary || [];
    const totalsMap = data.totals || {};
    const cur = currency();
    const totals = totalsMap[cur] || Object.values(totalsMap)[0] || {};
    const previsto = num(totals.basePrevisto ?? totals.previsto);
    const analise = num(totals.emAnaliseOrcamento ?? totals.realizadoOrcamento ?? totals.realizado);
    const liquidado = num(totals.liquidado);
    const pct = previsto > 0 ? (liquidado / previsto) * 100 : 0;

    if (kpis) {
      kpis.innerHTML = [
        kpiCard("Previsto", formatCurrency(previsto, cur), "Baseline aprovado"),
        kpiCard("Em análise", formatCurrency(analise, cur), "Propostas em revisão"),
        kpiCard("Liquidado", formatCurrency(liquidado, cur), "Pagamentos confirmados"),
        kpiCard("% Liquidado", `${pct.toFixed(0)}%`, "Sobre o previsto"),
      ].join("");
    }

    if (!summary.length) {
      body.innerHTML = emptyRow(5, "account_balance", "Sem centros de custo nesta obra.");
      return;
    }

    body.innerHTML = summary.map((row) => {
      const p = num(row.basePrevisto ?? row.previsto);
      const r = num(row.emAnaliseOrcamento ?? row.realizadoOrcamento ?? row.realizado);
      const l = num(row.liquidado);
      const pc = p > 0 ? (l / p) * 100 : 0;
      const label = [row.code, row.name].filter(Boolean).join(" · ") || "Centro";
      return `<tr>
        <td class="font-bold text-slate-900">${escapeHtml(label)}</td>
        <td class="text-right tabular-nums">${formatCurrency(p, row.currency || cur)}</td>
        <td class="text-right tabular-nums">${formatCurrency(r, row.currency || cur)}</td>
        <td class="text-right tabular-nums">${formatCurrency(l, row.currency || cur)}</td>
        <td>${progressBar(pc)}</td>
      </tr>`;
    }).join("");
  } catch (err) {
    body.innerHTML = emptyRow(5, "error", err.message || "Não foi possível carregar o orçamento de custo.");
  }
}

async function loadOrcamentoVendas() {
  const body = document.getElementById("plOrcamentoVendasBody");
  const kpis = document.getElementById("plOrcamentoVendasKpis");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-xs text-slate-400 font-bold uppercase">A carregar...</td></tr>`;
  try {
    const [taskData, payData] = await Promise.all([
      apiRequest(`/projects/${encodeURIComponent(projectId())}/progress-tasks`),
      apiRequest(`/projects/${encodeURIComponent(projectId())}/payments`).catch(() => ({ items: [], totals: {} })),
    ]);
    const tasks = (taskData.tasks || []).filter((t) => !t.parentId);
    const cur = currency();
    const groups = new Map();
    let previsto = 0;
    let medido = 0;
    tasks.forEach((t) => {
      const g = t.itemGroup || "Geral";
      if (!groups.has(g)) groups.set(g, { name: g, previsto: 0, medido: 0 });
      const uv = taskUnitValue(t);
      const exp = uv * num(t.expectedQty);
      const exe = uv * num(t.executedQty);
      groups.get(g).previsto += exp;
      groups.get(g).medido += exe;
      previsto += exp;
      medido += exe;
    });
    const global = num(project()?.budgetTotal) || previsto;
    const recebido = num(payData.totalPago ?? payData.totals?.pago);
    if (kpis) {
      kpis.innerHTML = [
        kpiCard("Contrato / global", formatCurrency(global, cur), "Orçamento da obra"),
        kpiCard("Faturação prevista", formatCurrency(previsto, cur), "Tabela de quantidades"),
        kpiCard("Já medido", formatCurrency(medido, cur), "Quantidade executada"),
        kpiCard("Recebido", formatCurrency(recebido, cur), "Pagamentos do cliente"),
      ].join("");
    }
    if (!groups.size) {
      body.innerHTML = emptyRow(5, "request_quote", "Sem itens de avanço físico para estimar vendas.");
      return;
    }
    const rows = [...groups.values()].map((g) => {
      const aberto = Math.max(0, g.previsto - g.medido);
      const pct = g.previsto > 0 ? (g.medido / g.previsto) * 100 : 0;
      return `<tr>
        <td class="font-bold text-slate-900">${escapeHtml(g.name)}</td>
        <td class="text-right tabular-nums">${formatCurrency(g.previsto, cur)}</td>
        <td class="text-right tabular-nums">${formatCurrency(g.medido, cur)}</td>
        <td class="text-right tabular-nums">${formatCurrency(aberto, cur)}</td>
        <td>${progressBar(pct)}</td>
      </tr>`;
    });
    body.innerHTML = rows.join("");
  } catch (err) {
    body.innerHTML = emptyRow(5, "error", err.message || "Não foi possível carregar o orçamento de vendas.");
  }
}

function plannedPct(task, planByTask) {
  const expected = num(task.expectedQty);
  const planned = num(planByTask.get(task.id)?.plannedQty);
  if (expected > 0 && planned > 0) return Math.min(100, (planned / expected) * 100);
  const executed = num(task.executedQty);
  if (expected > 0) return Math.min(100, (executed / expected) * 100);
  return 0;
}

function executedPct(task) {
  const expected = num(task.expectedQty);
  if (expected <= 0) return 0;
  return Math.min(100, (num(task.executedQty) / expected) * 100);
}

function progressTaskOfLine(line, tasksById) {
  return line?.progressTask || tasksById.get(line?.progressTaskId) || null;
}

function dailyPlanResumo(plan) {
  return String(plan?.description || plan?.descricao || plan?.resumo || plan?.summary || "").trim();
}

function dailyPlanWbsName(plan, tasksById) {
  const names = [];
  (plan?.tasks || []).forEach((line) => {
    const task = progressTaskOfLine(line, tasksById);
    const label = String(task?.description || task?.itemGroup || "").trim();
    if (label && !names.includes(label)) names.push(label);
  });
  return names.join(", ");
}

function dailyPlanLabel(plan, tasksById) {
  return dailyPlanResumo(plan) || dailyPlanWbsName(plan, tasksById) || "Atividade";
}

function planPlannedEnd(plan) {
  return parseLocalDate(plan?.plannedEndDate || plan?.endDate || plan?.dataPrevistaFim || plan?.plannedEnd || null);
}

function planDisplayEnd(plan, start) {
  const raw = planPlannedEnd(plan);
  if (raw && start && raw < start) return start;
  return raw || start || null;
}

function normalizeDepType(value) {
  const type = String(value || "FS").toUpperCase();
  return GANTT_DEP_TYPES.includes(type) ? type : "FS";
}

function explicitPredecessors(source) {
  const raw = source?.predecessors || source?.dependencies || source?.dependencias;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((item) => {
    if (item == null) return;
    let predecessorId = "";
    let type = "FS";
    let lagDays = 0;
    let id = "";
    if (typeof item === "string" || typeof item === "number") {
      predecessorId = String(item);
    } else {
      predecessorId = String(item.predecessorId || item.predecessor_id || item.predecessor?.id || "");
      type = normalizeDepType(item.type);
      const lag = Number(item.lagDays ?? item.lag ?? 0);
      lagDays = Number.isFinite(lag) ? Math.trunc(lag) : 0;
      id = item.id ? String(item.id) : "";
    }
    if (!predecessorId || seen.has(predecessorId)) return;
    seen.add(predecessorId);
    out.push({ id, predecessorId, type, lagDays });
  });
  return out;
}

function depTypeOptions(selected) {
  const current = normalizeDepType(selected);
  return GANTT_DEP_TYPES.map((type) =>
    `<option value="${type}"${type === current ? " selected" : ""}>${type}</option>`
  ).join("");
}

function ganttBarDateRange(activity, scale) {
  const start = activity?.start;
  const end = activity?.end || activity?.start;
  if (!start) return null;
  if (scale === "week") {
    return {
      start: startOfDay(startOfWeek(start)),
      end: endOfDay(addDays(startOfWeek(end), 6)),
    };
  }
  return { start: startOfDay(start), end: endOfDay(end) };
}

function ganttBarLayout(activity, scale, units, unitPx) {
  const range = ganttBarDateRange(activity, scale);
  if (!range || !units.length) return null;
  const leftRaw = dateToPx(range.start, units, unitPx);
  let rightRaw = dateToPx(range.end, units, unitPx);
  if (rightRaw <= leftRaw) rightRaw = leftRaw + unitPx;
  const pad = 4;
  return {
    left: leftRaw + pad,
    width: Math.max(GANTT_BAR_MIN_PX, rightRaw - leftRaw - pad * 2),
  };
}

function ganttPeopleFromLines(lines) {
  const people = new Set();
  (lines || []).forEach((line) => {
    const tech = line.technician?.name || line.technician?.fullName || line.technician?.email;
    if (tech) people.add(tech);
  });
  return [...people];
}

function collectGanttFromDailyPlans(plans, tasksById) {
  const sorted = [...plans].sort((a, b) => {
    const da = parseLocalDate(a.date)?.getTime() || 0;
    const db = parseLocalDate(b.date)?.getTime() || 0;
    if (da !== db) return da - db;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const byId = new Map(sorted.map((plan) => [String(plan.id), plan]));
  return sorted.map((plan) => {
    const date = parseLocalDate(plan.date);
    const end = planDisplayEnd(plan, date);
    const first = (plan.tasks || [])[0];
    const firstTask = progressTaskOfLine(first, tasksById);
    const predecessors = explicitPredecessors(plan);
    const names = predecessors.map((dep) => {
      const pred = byId.get(String(dep.predecessorId));
      return pred ? dailyPlanLabel(pred, tasksById) : "";
    }).filter(Boolean);
    let plannedQty = 0;
    let executedQty = 0;
    (plan.tasks || []).forEach((line) => {
      plannedQty += num(line.plannedQty);
      executedQty += num(line.executedQty);
    });
    const pct = plannedQty > 0 ? Math.min(100, (executedQty / plannedQty) * 100) : 0;
    const wbsName = dailyPlanWbsName(plan, tasksById);
    return {
      id: plan.id,
      name: dailyPlanLabel(plan, tasksById),
      wbsName,
      start: date,
      end,
      pct,
      execPct: pct,
      status: plan.status || "DRAFT",
      predecessors,
      predecessorId: predecessors[0]?.predecessorId || null,
      dependency: names.join(", "),
      people: ganttPeopleFromLines(plan.tasks),
      wbs: firstTask?.wbsCode || "",
      group: firstTask?.itemGroup || "",
    };
  });
}

function collectGanttFromWbs(tasks, plans) {
  const byTask = new Map();
  (plans || []).forEach((plan) => {
    const date = parseLocalDate(plan.date);
    (plan.tasks || []).forEach((line) => {
      const id = line.progressTaskId || line.progressTask?.id;
      if (!id) return;
      if (!byTask.has(id)) byTask.set(id, { dates: [], plannedQty: 0, executedQty: 0, people: new Set() });
      const rec = byTask.get(id);
      if (date) rec.dates.push(date);
      const plannedEnd = planPlannedEnd(plan);
      if (plannedEnd) rec.dates.push(plannedEnd);
      rec.plannedQty += num(line.plannedQty);
      rec.executedQty += num(line.executedQty);
      const tech = line.technician?.name || line.technician?.fullName || line.technician?.email;
      if (tech) rec.people.add(tech);
    });
  });

  const roots = (tasks || []).filter((t) => !t.parentId);
  const byGroup = new Map();
  roots.forEach((t) => {
    const g = t.itemGroup || "";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(t);
  });

  const activities = [];
  [...byGroup.values()].forEach((list) => {
    list.forEach((t) => {
      const rec = byTask.get(t.id);
      const start = rec?.dates?.length ? new Date(Math.min(...rec.dates.map((d) => d.getTime()))) : null;
      const end = rec?.dates?.length ? new Date(Math.max(...rec.dates.map((d) => d.getTime()))) : start;
      const predecessors = explicitPredecessors(t);
      const name = t.description || t.itemGroup || "Atividade";
      activities.push({
        id: t.id,
        name,
        wbsName: name,
        start,
        end,
        pct: plannedPct(t, byTask),
        execPct: executedPct(t),
        predecessors,
        predecessorId: predecessors[0]?.predecessorId || null,
        dependency: predecessors.map((dep) => {
          const pred = list.find((item) => String(item.id) === String(dep.predecessorId));
          return pred?.description || "";
        }).filter(Boolean).join(", "),
        people: rec?.people ? [...rec.people] : [],
        wbs: t.wbsCode || "",
        group: t.itemGroup || "",
      });
    });
  });
  return activities;
}

function collectGanttActivities(tasks, plans, projectRef) {
  const tasksById = new Map((tasks || []).map((t) => [t.id, t]));
  const planList = Array.isArray(plans) ? plans.filter(Boolean) : [];
  const fromPlans = planList.length > 0;
  const activities = fromPlans
    ? collectGanttFromDailyPlans(planList, tasksById)
    : collectGanttFromWbs(tasks, planList);

  const dated = activities.filter((a) => a.start);
  if (!dated.length && (projectRef?.startDate || projectRef?.dueDate)) {
    return { activities, rangeStart: null, rangeEnd: null, fromPlans, hint: "As barras aparecem quando as atividades tiverem datas nos planos diários." };
  }

  let rangeStart = dated.length ? new Date(Math.min(...dated.map((a) => a.start.getTime()))) : parseLocalDate(projectRef?.startDate);
  let rangeEnd = dated.length
    ? new Date(Math.max(...dated.map((a) => (a.end || a.start).getTime())))
    : parseLocalDate(projectRef?.dueDate);
  if (projectRef?.startDate) {
    const ps = parseLocalDate(projectRef.startDate);
    if (ps && (!rangeStart || ps < rangeStart)) rangeStart = ps;
  }
  if (projectRef?.dueDate) {
    const pe = parseLocalDate(projectRef.dueDate);
    if (pe && (!rangeEnd || pe > rangeEnd)) rangeEnd = pe;
  }
  if (!rangeStart || !rangeEnd) return { activities, rangeStart: null, rangeEnd: null, fromPlans, hint: null };
  if (rangeEnd < rangeStart) rangeEnd = new Date(rangeStart);

  return { activities, rangeStart, rangeEnd, fromPlans, hint: dated.length ? null : "As barras aparecem quando as atividades tiverem datas nos planos diários." };
}

function ganttActivityTooltip(a) {
  return [
    a.wbsName && a.wbsName !== a.name ? `WBS: ${a.wbsName}` : "",
    a.start || a.end ? `${formatPtLongDate(a.start)} – ${formatPtLongDate(a.end)}` : "",
    a.people?.length ? `Responsáveis: ${a.people.join(", ")}` : "",
    a.dependency ? `Dependência: ${a.dependency}` : "",
  ].filter(Boolean).join(" · ");
}

function safeGanttHex(value, fallback) {
  const raw = String(value || "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : fallback;
}

function ganttHexLuminance(hex) {
  const raw = String(hex || "").replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return 0;
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

function loadGanttBoardConfig() {
  try {
    const raw = localStorage.getItem(`InfoCliente.dailyPlanBoard.${projectId()}`);
    if (!raw) return { customColumns: [], placements: {} };
    const parsed = JSON.parse(raw);
    return {
      customColumns: Array.isArray(parsed.customColumns) ? parsed.customColumns : [],
      placements: parsed.placements && typeof parsed.placements === "object" ? parsed.placements : {},
    };
  } catch {
    return { customColumns: [], placements: {} };
  }
}

function ganttBarAppearance(activity, board) {
  const customId = board?.placements?.[String(activity.id)];
  const custom = customId
    ? (board.customColumns || []).find((col) => col.id === customId)
    : null;
  const fallback = GANTT_STATUS_COLORS[activity.status] || GANTT_STATUS_COLORS.DRAFT;
  const color = safeGanttHex(custom?.color, fallback);
  const darkText = ganttHexLuminance(color) > 0.62;
  const text = darkText ? GANTT_INK : "#fff";
  return { color, text, outlineText: darkText ? GANTT_INK : color, darkText };
}

function ganttBarBox(el, inner) {
  const innerRect = inner.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    left: r.left - innerRect.left,
    right: r.right - innerRect.left,
    midY: r.top - innerRect.top + r.height / 2,
  };
}

function ganttLinkAnchors(from, to, type) {
  const t = normalizeDepType(type);
  const fromStart = t === "SS" || t === "SF";
  const toStart = t === "FS" || t === "SS";
  return {
    type: t,
    x1: fromStart ? from.left : from.right,
    y1: from.midY,
    x2: toStart ? to.left : to.right,
    y2: to.midY,
    fromStart,
    toStart,
  };
}

function ganttLinkPath(link) {
  const { x1, y1, x2, y2, type, fromStart, toStart } = link;
  const stub = 14;
  const f = (n) => n.toFixed(1);
  if (type === "FS" && x2 >= x1 + stub * 2) {
    const elbow = x1 + stub;
    return `M ${f(x1)} ${f(y1)} H ${f(elbow)} V ${f(y2)} H ${f(x2)}`;
  }
  if (type === "SS") {
    const elbow = Math.min(x1, x2) - stub;
    return `M ${f(x1)} ${f(y1)} H ${f(elbow)} V ${f(y2)} H ${f(x2)}`;
  }
  if (type === "FF") {
    const elbow = Math.max(x1, x2) + stub;
    return `M ${f(x1)} ${f(y1)} H ${f(elbow)} V ${f(y2)} H ${f(x2)}`;
  }
  if (type === "SF") {
    const left = Math.min(x1, x2) - stub;
    return `M ${f(x1)} ${f(y1)} H ${f(left)} V ${f(y2)} H ${f(x2)}`;
  }
  const xOut = fromStart ? x1 - stub : x1 + stub;
  const xIn = toStart ? Math.min(x2 - 8, xOut) : Math.max(x2 + 8, xOut);
  return `M ${f(x1)} ${f(y1)} H ${f(xOut)} V ${f(y2)} H ${f(xIn)} H ${f(x2)}`;
}

function paintGanttLinks(root, activities) {
  const inner = root.querySelector(".ex-gantt-inner");
  const svg = root.querySelector(".ex-gantt-links");
  if (!inner || !svg) return;
  const w = Math.max(inner.scrollWidth, inner.clientWidth, 1);
  const h = Math.max(inner.scrollHeight, inner.clientHeight, 1);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.style.width = `${w}px`;
  svg.style.height = `${h}px`;

  const byId = new Map();
  inner.querySelectorAll(".ex-gantt-bar[data-gantt-id]").forEach((el) => {
    byId.set(String(el.getAttribute("data-gantt-id")), ganttBarBox(el, inner));
  });

  const lines = [];
  (activities || []).forEach((activity) => {
    const deps = Array.isArray(activity.predecessors) ? activity.predecessors : [];
    deps.forEach((dep) => {
      const predId = String(dep.predecessorId || "");
      if (!predId) return;
      const from = byId.get(predId);
      const to = byId.get(String(activity.id));
      if (!from || !to) return;
      const link = ganttLinkAnchors(from, to, dep.type);
      if (!Number.isFinite(link.x1) || !Number.isFinite(link.x2)) return;
      lines.push(`<path d="${ganttLinkPath(link)}" marker-end="url(#ganttArrow)" />`);
    });
  });

  svg.innerHTML = `<defs>
    <marker id="ganttArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <polygon points="0 0, 8 4, 0 8" fill="#64748b" />
    </marker>
  </defs>${lines.join("")}`;
}

function canEditGanttDeps() {
  return can("obras", "manage") || can("obras", "full_access");
}

function refreshGanttFromCache() {
  cache.gantt = collectGanttActivities(cache.ganttTasks || [], cache.ganttPlans || [], project());
  renderGantt(cache.gantt);
}

function ganttActivityById(id) {
  return (cache.gantt?.activities || []).find((a) => String(a.id) === String(id)) || null;
}

function predOptionsHtml(successorId, selectedId) {
  return (cache.gantt?.activities || [])
    .filter((a) => String(a.id) !== String(successorId))
    .map((a) => {
      const selected = String(a.id) === String(selectedId) ? " selected" : "";
      return `<option value="${escapeHtml(String(a.id))}"${selected}>${escapeHtml(a.name)}</option>`;
    })
    .join("");
}

function renderDepList(panel, rows) {
  const list = panel.querySelector("#exDepList");
  const empty = panel.querySelector("#exDepEmpty");
  if (!list || !empty) return;
  empty.classList.toggle("hidden", rows.length > 0);
  if (!rows.length) {
    list.innerHTML = "";
    return;
  }
  const successorId = panel.dataset.successorId;
  list.innerHTML = rows.map((row, idx) => `
    <div class="ex-dep-saved" data-dep-idx="${idx}">
      <label>Predecessora
        <select data-dep-pred class="ex-dep-input">${predOptionsHtml(successorId, row.predecessorId)}</select>
      </label>
      <label>Tipo de dependência
        <select data-dep-type class="ex-dep-input">${depTypeOptions(row.type)}</select>
      </label>
      <label>Atraso (dias)
        <input data-dep-lag class="ex-dep-input" type="number" step="1" value="${Number(row.lagDays) || 0}">
      </label>
      <button type="button" class="ex-dep-remove" data-dep-remove="${idx}" title="Remover predecessora">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  `).join("");
}

function collectDepRows(panel) {
  return Array.from(panel.querySelectorAll(".ex-dep-saved")).map((row) => ({
    predecessorId: String(row.querySelector("[data-dep-pred]")?.value || "").trim(),
    type: normalizeDepType(row.querySelector("[data-dep-type]")?.value),
    lagDays: Number(row.querySelector("[data-dep-lag]")?.value) || 0,
  })).filter((row) => row.predecessorId);
}

function fillAddPredSelect(panel, successorId, usedIds) {
  const select = panel.querySelector("#exDepPred");
  if (!select) return;
  const used = new Set((usedIds || []).map(String));
  const options = (cache.gantt?.activities || [])
    .filter((a) => String(a.id) !== String(successorId) && !used.has(String(a.id)))
    .map((a) => `<option value="${escapeHtml(String(a.id))}">${escapeHtml(a.name)}</option>`)
    .join("");
  select.innerHTML = `<option value="">Selecionar atividade...</option>${options}`;
}

function openGanttDepsModal(activityId) {
  const activity = ganttActivityById(activityId);
  if (!activity) return;
  const editable = canEditGanttDeps();
  const rows = (activity.predecessors || []).map((dep) => ({
    predecessorId: String(dep.predecessorId),
    type: normalizeDepType(dep.type),
    lagDays: Number(dep.lagDays) || 0,
  }));

  openModal({
    title: "Editar dependências",
    primaryLabel: "Concluído",
    secondaryLabel: "",
    contentHtml: `
      <div class="ex-dep">
        <p class="ex-dep-name">${escapeHtml(activity.name)}</p>
        <p class="ex-dep-dates">${escapeHtml(formatPtLongDate(activity.start))} – ${escapeHtml(formatPtLongDate(activity.end || activity.start))}</p>
        <div class="ex-dep-section">
          <p class="ex-dep-section-title">
            <span class="material-symbols-outlined">account_tree</span>
            Predecessores
          </p>
          <p class="ex-dep-empty" id="exDepEmpty">Ainda não há predecessores. Adicione uma abaixo para que esta tarefa dependa de outra.</p>
          <div id="exDepList" class="ex-dep-list"></div>
          <div class="ex-dep-add-box">
            <div class="ex-dep-add-grid">
              <label>Predecessora
                <select id="exDepPred" class="ex-dep-input"${editable ? "" : " disabled"}>
                  <option value="">Selecionar atividade...</option>
                </select>
              </label>
              <label>Tipo de dependência
                <select id="exDepType" class="ex-dep-input"${editable ? "" : " disabled"}>
                  ${depTypeOptions("FS")}
                </select>
              </label>
              <label>Atraso (dias)
                <input id="exDepLag" class="ex-dep-input" type="number" step="1" value="0"${editable ? "" : " disabled"}>
              </label>
            </div>
            <button type="button" id="exDepAdd" class="ex-dep-add-btn"${editable ? "" : " disabled"}>+ Adicionar predecessora</button>
          </div>
        </div>
      </div>`,
    onRender: ({ panel }) => {
      panel.classList.remove("max-w-[640px]");
      panel.classList.add("max-w-[720px]");
      panel.dataset.successorId = String(activity.id);
      panel._depRows = rows.slice();
      const sync = () => {
        renderDepList(panel, panel._depRows);
        fillAddPredSelect(panel, activity.id, panel._depRows.map((r) => r.predecessorId));
        panel.querySelector("#exDepType").value = "FS";
        panel.querySelector("#exDepLag").value = "0";
      };
      sync();
      panel.querySelector("#exDepAdd")?.addEventListener("click", () => {
        if (!editable) return;
        const predecessorId = String(panel.querySelector("#exDepPred")?.value || "").trim();
        if (!predecessorId) {
          toast("Seleccione a atividade predecessora.", { type: "error" });
          return;
        }
        if (predecessorId === String(activity.id)) {
          toast("Uma atividade não pode depender de si própria.", { type: "error" });
          return;
        }
        if (panel._depRows.some((r) => String(r.predecessorId) === predecessorId)) {
          toast("Esta predecessora já está na lista.", { type: "error" });
          return;
        }
        panel._depRows.push({
          predecessorId,
          type: normalizeDepType(panel.querySelector("#exDepType")?.value),
          lagDays: Number(panel.querySelector("#exDepLag")?.value) || 0,
        });
        sync();
      });
      panel.querySelector("#exDepList")?.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-dep-remove]");
        if (!btn || !editable) return;
        const idx = Number(btn.getAttribute("data-dep-remove"));
        if (!Number.isInteger(idx)) return;
        panel._depRows.splice(idx, 1);
        sync();
      });
      panel.querySelector("#exDepList")?.addEventListener("change", () => {
        panel._depRows = collectDepRows(panel);
        fillAddPredSelect(panel, activity.id, panel._depRows.map((r) => r.predecessorId));
      });
      panel.querySelector("#exDepList")?.addEventListener("input", () => {
        panel._depRows = collectDepRows(panel);
      });
    },
    onPrimary: async ({ close, btn, panel }) => {
      if (!editable) {
        close();
        return;
      }
      panel._depRows = collectDepRows(panel);
      const pendingPred = String(panel.querySelector("#exDepPred")?.value || "").trim();
      if (pendingPred && !panel._depRows.some((r) => String(r.predecessorId) === pendingPred)) {
        panel._depRows.push({
          predecessorId: pendingPred,
          type: normalizeDepType(panel.querySelector("#exDepType")?.value),
          lagDays: Number(panel.querySelector("#exDepLag")?.value) || 0,
        });
      }
      const predecessors = (panel._depRows || []).filter((r) => r.predecessorId);
      setButtonLoading(btn, true);
      try {
        const saved = await apiRequest(`/daily-plans/${encodeURIComponent(activity.id)}/dependencies`, {
          method: "PUT",
          body: { predecessors },
        });
        const plans = Array.isArray(cache.ganttPlans) ? cache.ganttPlans : [];
        const idx = plans.findIndex((p) => String(p.id) === String(activity.id));
        if (idx >= 0) plans[idx] = { ...plans[idx], predecessors: saved.predecessors || predecessors };
        cache.ganttPlans = plans;
        toast("Dependências atualizadas.", { type: "success" });
        close();
        refreshGanttFromCache();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Não foi possível guardar as dependências.", { type: "error" });
      }
    },
  });
}

function renderGantt(model) {
  const root = document.getElementById("plGanttRoot");
  const meta = document.getElementById("plGanttMeta");
  if (!root) return;
  syncGanttScaleButtons();
  const { activities, rangeStart, rangeEnd, hint, fromPlans } = model;
  const scale = getGanttScale();
  if (meta) {
    meta.classList.remove("hidden");
    // meta.innerHTML = [
    //   `<span>${activities.length} atividade${activities.length === 1 ? "" : "s"}</span>`,
    //   `<span>${fromPlans
    //     ? "Cada linha é um plano diário · Atividade = descrição/resumo · datas e % do plano"
    //     : "Datas a partir dos planos diários · % planeada = qtd. planeada / prevista"}</span>`,
    // ].join("");
  }
  if (!activities.length) {
    root.innerHTML = `<div class="pl-empty"><span class="material-symbols-outlined">view_timeline</span><p class="text-sm font-semibold">Sem atividades no avanço físico.</p><p class="text-xs mt-1">Importe a tabela de quantidades ou crie itens em Operação → Avanço Físico.</p></div>`;
    return;
  }

  const { units, unitPx } = buildGanttUnits(scale, rangeStart, rangeEnd);
  if (!units.length) {
    const rows = activities.map((a) => `<tr>
      <td class="ex-gantt-sticky ex-gantt-col-act"><span class="ex-gantt-act" title="${escapeHtml(ganttActivityTooltip(a) || a.name)}">${escapeHtml(a.name)}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-start"><span class="ex-gantt-date">${formatPtLongDate(a.start)}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-end"><span class="ex-gantt-date">${formatPtLongDate(a.end || a.start)}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-pct"><span class="ex-gantt-pct ${a.pct >= 100 ? "is-done" : ""}">${Math.round(a.pct)}</span></td>
    </tr>`).join("");
    root.innerHTML = `${hint ? `<p class="px-6 py-3 text-xs font-semibold text-slate-500 border-b border-slate-100">${escapeHtml(hint)}</p>` : ""}
      <div class="ex-gantt-scroll"><table class="ex-gantt-table w-full"><thead><tr>
        <th class="ex-gantt-sticky ex-gantt-col-act">Atividade</th>
        <th class="ex-gantt-sticky ex-gantt-col-start">Início</th>
        <th class="ex-gantt-sticky ex-gantt-col-end">Fim</th>
        <th class="ex-gantt-sticky ex-gantt-col-pct">%</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
    return;
  }

  const groups = ganttGroupUnits(units, scale);
  const groupRow = groups.map((g) => `<th class="ex-gantt-month" colspan="${g.span}">${escapeHtml(g.label)}</th>`).join("");
  const unitRow = units.map((u) => `<th class="ex-gantt-unit" style="width:${unitPx}px;min-width:${unitPx}px">${escapeHtml(u.label)}</th>`).join("");
  const trackWidth = units.length * unitPx;
  const now = new Date();
  const todayInRange = now >= units[0].start && now <= units[units.length - 1].end;
  const todayLeft = todayInRange ? dateToPx(now, units, unitPx) : -1;
  const todayMark = todayLeft >= 0
    ? `<div class="ex-gantt-hoje" style="--hoje-left:${todayLeft.toFixed(1)}px"><span class="ex-gantt-hoje-flag">Hoje</span></div>`
    : "";

  const board = loadGanttBoardConfig();
  const body = activities.map((a, idx) => {
    let bar = "";
    const layout = a.start ? ganttBarLayout(a, scale, units, unitPx) : null;
    if (layout) {
      const pct = Math.max(0, Math.min(100, num(a.execPct ?? a.pct)));
      const done = pct >= 99.5;
      const none = pct <= 0.5;
      const { color, text, outlineText, darkText } = ganttBarAppearance(a, board);
      const title = [
        a.name,
        ganttActivityTooltip(a),
        `%: ${Math.round(a.pct)}`,
        fromPlans ? "Clique para editar dependências" : "",
      ].filter(Boolean).join(" · ");
      const fill = !done && !none
        ? `<div class="ex-gantt-bar-fill" style="width:${pct}%"></div>`
        : "";
      const barClass = `${done ? "" : (none ? " is-outline" : " is-split")}${darkText ? " is-dark-text" : ""}`;
      bar = `<div class="ex-gantt-bar${barClass}" data-gantt-id="${escapeHtml(String(a.id || idx))}" role="button" tabindex="0" style="left:${layout.left}px;width:${layout.width}px;--gantt-bar-color:${color};--gantt-bar-text:${text};--gantt-bar-outline-text:${outlineText}" title="${escapeHtml(title)}">${fill}<span>${escapeHtml(a.name)}</span></div>`;
    }
    const pctClass = a.pct >= 100 ? "is-done" : "";
    const endLabel = formatPtLongDate(a.end || a.start);
    const depBtn = fromPlans
      ? `<button type="button" class="ex-gantt-dep-btn" data-gantt-id="${escapeHtml(String(a.id || idx))}" title="Editar dependências"><span class="material-symbols-outlined">account_tree</span></button>`
      : "";
    return `<tr>
      <td class="ex-gantt-sticky ex-gantt-col-act"><div class="ex-gantt-act-wrap"><span class="ex-gantt-act" title="${escapeHtml(ganttActivityTooltip(a) || a.name)}">${escapeHtml(a.name)}</span>${depBtn}</div></td>
      <td class="ex-gantt-sticky ex-gantt-col-start"><span class="ex-gantt-date">${formatPtLongDate(a.start)}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-end"><span class="ex-gantt-date">${endLabel}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-pct"><span class="ex-gantt-pct ${pctClass}">${Math.round(a.pct)}</span></td>
      <td colspan="${units.length}" class="!p-0">
        <div class="ex-gantt-track" style="width:${trackWidth}px;background-size:${unitPx}px 100%">${bar}</div>
      </td>
    </tr>`;
  }).join("");

  root.dataset.ganttScale = scale;
  root.innerHTML = `${hint ? `<p class="px-6 py-3 text-xs font-semibold text-slate-500 border-b border-slate-100">${escapeHtml(hint)}</p>` : ""}
    <div class="ex-gantt-scroll">
      <div class="ex-gantt-inner">
        <table class="ex-gantt-table">
          <thead>
            <tr>
              <th class="ex-gantt-sticky ex-gantt-col-act" rowspan="2">Atividade</th>
              <th class="ex-gantt-sticky ex-gantt-col-start" rowspan="2">Início</th>
              <th class="ex-gantt-sticky ex-gantt-col-end" rowspan="2">Fim</th>
              <th class="ex-gantt-sticky ex-gantt-col-pct" rowspan="2">%</th>
              ${groupRow}
            </tr>
            <tr>${unitRow}</tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
        ${todayMark}
        <svg class="ex-gantt-links" aria-hidden="true"></svg>
      </div>
    </div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => paintGanttLinks(root, activities)));
}

async function loadGantt() {
  const root = document.getElementById("plGanttRoot");
  if (!root) return;
  root.innerHTML = `<div class="py-16 text-center text-xs font-bold uppercase tracking-widest text-slate-400">A carregar Gantt...</div>`;
  try {
    const [taskData, plans] = await Promise.all([
      apiRequest(`/projects/${encodeURIComponent(projectId())}/progress-tasks`),
      apiRequest(`/daily-plans?projectId=${encodeURIComponent(projectId())}`),
    ]);
    cache.ganttTasks = taskData.tasks || [];
    cache.ganttPlans = plans || [];
    cache.gantt = collectGanttActivities(cache.ganttTasks, cache.ganttPlans, project());
    renderGantt(cache.gantt);
  } catch (err) {
    root.innerHTML = `<div class="pl-empty"><span class="material-symbols-outlined">error</span><p class="text-sm font-semibold">${escapeHtml(err.message || "Erro ao carregar o Gantt.")}</p></div>`;
  }
}

function addMonthBucket(map, key) {
  if (!map.has(key)) map.set(key, { custos: 0, faturacao: 0, recebimentos: 0 });
  return map.get(key);
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return formatMonthYear(y, m - 1);
}

async function loadFinanceiro() {
  const body = document.getElementById("plFinanceiroBody");
  const foot = document.getElementById("plFinanceiroFoot");
  const kpis = document.getElementById("plFinanceiroKpis");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-xs text-slate-400 font-bold uppercase">A carregar...</td></tr>`;
  if (foot) foot.innerHTML = "";
  try {
    const id = projectId();
    const [timeline, needsData, payments, taskData] = await Promise.all([
      apiRequest(`/cost-centers/project/${encodeURIComponent(id)}/payments/timeline?onlyVisible=false`).catch(() => ({ days: [] })),
      apiRequest(`/cost-centers/project/${encodeURIComponent(id)}/needs?pageSize=1000`).catch(() => ({ items: [] })),
      apiRequest(`/projects/${encodeURIComponent(id)}/payments`).catch(() => ({ items: [] })),
      apiRequest(`/projects/${encodeURIComponent(id)}/progress-tasks`).catch(() => ({ tasks: [] })),
    ]);

    const buckets = new Map();
    (timeline.days || []).forEach((day) => {
      const d = parseLocalDate(day.date);
      if (!d) return;
      const bucket = addMonthBucket(buckets, monthKeyFromDate(d));
      (day.items || []).forEach((p) => {
        if (String(p.status || "").toUpperCase() === "CANCELADO") return;
        bucket.custos += paymentPayableAmount(p) || num(p.budgetedAmount) || num(p.paidAmount);
      });
    });
    (needsData.items || []).forEach((n) => {
      if (n.scheduled) return;
      const d = parseLocalDate(n.date || n.createdAt);
      if (!d) return;
      addMonthBucket(buckets, monthKeyFromDate(d)).custos += needLineTotal(n);
    });
    (payments.items || []).forEach((p) => {
      const d = parseLocalDate(p.dataPagamento || p.date);
      if (!d) return;
      addMonthBucket(buckets, monthKeyFromDate(d)).recebimentos += num(p.valor);
    });

    const roots = (taskData.tasks || []).filter((t) => !t.parentId);
    let salesTotal = 0;
    roots.forEach((t) => { salesTotal += taskUnitValue(t) * num(t.expectedQty); });
    const start = parseLocalDate(project()?.startDate) || parseLocalDate(project()?.launchDate);
    const end = parseLocalDate(project()?.dueDate);
    if (salesTotal > 0 && start && end && end >= start) {
      const months = [];
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const last = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cursor <= last && months.length < 60) {
        months.push(monthKeyFromDate(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
      }
      const share = months.length ? salesTotal / months.length : salesTotal;
      months.forEach((key) => { addMonthBucket(buckets, key).faturacao += share; });
    } else if (salesTotal > 0) {
      const key = monthKeyFromDate(start || new Date());
      addMonthBucket(buckets, key).faturacao += salesTotal;
    }

    const keys = [...buckets.keys()].sort();
    const cur = currency();
    let totC = 0;
    let totF = 0;
    let totR = 0;
    let totCf = 0;
    if (!keys.length) {
      if (kpis) {
        kpis.innerHTML = [
          kpiCard("Custos previstos", formatCurrency(0, cur)),
          kpiCard("Faturação prevista", formatCurrency(0, cur)),
          kpiCard("Recebimentos", formatCurrency(0, cur)),
          kpiCard("Cash flow", formatCurrency(0, cur)),
        ].join("");
      }
      body.innerHTML = emptyRow(5, "payments", "Sem dados de cronograma, faturação ou recebimentos para esta obra.");
      return;
    }

    body.innerHTML = keys.map((key) => {
      const row = buckets.get(key);
      const cf = row.recebimentos - row.custos;
      totC += row.custos;
      totF += row.faturacao;
      totR += row.recebimentos;
      totCf += cf;
      const cfCls = cf >= 0 ? "text-emerald-600" : "text-red-600";
      return `<tr>
        <td class="font-bold text-slate-900">${escapeHtml(monthLabel(key))}</td>
        <td class="text-right tabular-nums">${formatCurrency(row.custos, cur)}</td>
        <td class="text-right tabular-nums">${formatCurrency(row.faturacao, cur)}</td>
        <td class="text-right tabular-nums">${formatCurrency(row.recebimentos, cur)}</td>
        <td class="text-right tabular-nums font-bold ${cfCls}">${formatCurrency(cf, cur)}</td>
      </tr>`;
    }).join("");
    if (foot) {
      foot.innerHTML = `<tr>
        <td>Total</td>
        <td class="text-right">${formatCurrency(totC, cur)}</td>
        <td class="text-right">${formatCurrency(totF, cur)}</td>
        <td class="text-right">${formatCurrency(totR, cur)}</td>
        <td class="text-right">${formatCurrency(totCf, cur)}</td>
      </tr>`;
    }
    if (kpis) {
      kpis.innerHTML = [
        kpiCard("Custos previstos", formatCurrency(totC, cur), "Cronograma + itens por agendar"),
        kpiCard("Faturação prevista", formatCurrency(totF, cur), "WBS distribuída pelo prazo"),
        kpiCard("Recebimentos previstos", formatCurrency(totR, cur), "Pagamentos do cliente"),
        kpiCard("Cash flow previsto", formatCurrency(totCf, cur), "Recebimentos − custos"),
      ].join("");
    }
  } catch (err) {
    body.innerHTML = emptyRow(5, "error", err.message || "Não foi possível carregar o plano financeiro.");
  }
}

function projectBarem() {
  return readStore(BAREM_KEY).filter((row) => row.projectId === projectId());
}

async function loadEquipamentos() {
  const resumo = document.getElementById("plEquipResumoBody");
  const list = document.getElementById("plBaremBody");
  const kpis = document.getElementById("plEquipKpis");
  if (!resumo || !list) return;
  const rows = projectBarem();
  const cur = currency();
  const byType = new Map();
  let total = 0;
  let qty = 0;
  rows.forEach((row) => {
    const tipo = row.tipo || "Equipamento";
    if (!byType.has(tipo)) byType.set(tipo, { tipo, count: 0, qty: 0, custo: 0 });
    const rec = byType.get(tipo);
    rec.count += 1;
    rec.qty += num(row.qtd);
    rec.custo += num(row.custo);
    total += num(row.custo);
    qty += num(row.qtd);
  });
  if (kpis) {
    kpis.innerHTML = [
      kpiCard("Registos BAREM", String(rows.length), "Nesta obra"),
      kpiCard("Utilização", qty.toLocaleString("pt-PT"), "Horas / dias"),
      kpiCard("Custo de utilização", formatCurrency(total, cur), "Total BAREM"),
    ].join("");
  }
  if (!byType.size) {
    resumo.innerHTML = emptyRow(4, "agriculture", "Ainda não há custos de utilização registados. Use Registo BAREM.");
  } else {
    resumo.innerHTML = [...byType.values()].map((r) => `<tr>
      <td class="font-bold text-slate-900">${escapeHtml(r.tipo)}</td>
      <td class="text-center">${r.count}</td>
      <td class="text-right tabular-nums">${r.qty.toLocaleString("pt-PT")}</td>
      <td class="text-right tabular-nums font-bold">${formatCurrency(r.custo, cur)}</td>
    </tr>`).join("");
  }
  if (!rows.length) {
    list.innerHTML = emptyRow(6, "receipt_long", "Sem registos BAREM nesta obra.");
    return;
  }
  list.innerHTML = rows
    .slice()
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")))
    .map((row) => `<tr>
      <td>${escapeHtml(formatPtLongDate(row.data))}</td>
      <td class="font-bold text-slate-900">${escapeHtml(row.equipamentoNome || "—")}</td>
      <td>${escapeHtml(row.tipo || "—")}</td>
      <td class="text-right">${num(row.qtd).toLocaleString("pt-PT")}</td>
      <td class="text-right">${formatCurrency(num(row.taxa), cur)}</td>
      <td class="text-right font-bold">${formatCurrency(num(row.custo), cur)}</td>
    </tr>`).join("");
}

async function loadToolsCatalog() {
  try {
    const data = await apiRequest("/products/tools");
    return data.items || [];
  } catch {
    try {
      const data = await apiRequest("/products?category=EQUIPMENT");
      return data.items || [];
    } catch {
      return [];
    }
  }
}

function openBaremModal() {
  openModal({
    title: "Registo BAREM",
    primaryLabel: "Guardar",
    contentHtml: `
      <div class="space-y-4">
        <p class="text-xs text-slate-500 font-medium">Custo de utilização de equipamento ou viatura nesta obra.</p>
        <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Equipamento
          <select id="baremEquip" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
            <option value="">A carregar...</option>
          </select>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Data
            <input id="baremData" type="date" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Quantidade (h / dias)
            <input id="baremQtd" type="number" min="0" step="0.5" value="1" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
        </div>
        <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Taxa
          <input id="baremTaxa" type="number" min="0" step="0.01" value="0" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
        </label>
        <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Notas
          <input id="baremNotas" type="text" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold" placeholder="Opcional">
        </label>
      </div>`,
    onRender: async ({ panel }) => {
      const select = panel.querySelector("#baremEquip");
      const today = new Date();
      panel.querySelector("#baremData").value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const items = await loadToolsCatalog();
      if (!items.length) {
        select.innerHTML = `<option value="">Sem equipamentos no catálogo</option>`;
        return;
      }
      select.innerHTML = `<option value="">Seleccionar...</option>` + items.map((p) =>
        `<option value="${escapeHtml(p.id)}" data-kind="${escapeHtml(equipmentKindLabel(p))}">${escapeHtml(p.name)}</option>`
      ).join("");
    },
    onPrimary: async ({ close, btn }) => {
      const select = document.getElementById("baremEquip");
      const option = select?.selectedOptions?.[0];
      const equipamentoId = select?.value || "";
      const equipamentoNome = option?.textContent || "";
      const tipo = option?.getAttribute("data-kind") || "Equipamento";
      const data = document.getElementById("baremData")?.value;
      const qtd = num(document.getElementById("baremQtd")?.value);
      const taxa = num(document.getElementById("baremTaxa")?.value);
      if (!equipamentoId) { toast("Seleccione o equipamento.", { type: "error" }); return; }
      if (!data) { toast("Indique a data.", { type: "error" }); return; }
      if (qtd <= 0) { toast("Indique a quantidade.", { type: "error" }); return; }
      setButtonLoading(btn, true);
      const items = readStore(BAREM_KEY);
      items.unshift({
        id: `barem_${Date.now()}`,
        projectId: projectId(),
        equipamentoId,
        equipamentoNome,
        tipo,
        data,
        qtd,
        taxa,
        custo: qtd * taxa,
        notas: document.getElementById("baremNotas")?.value || "",
      });
      writeStore(BAREM_KEY, items);
      toast("Registo BAREM guardado.", { type: "success" });
      close();
      loadEquipamentos();
    },
  });
}

async function loadMateriais() {
  const body = document.getElementById("plMateriaisBody");
  const kpis = document.getElementById("plMateriaisKpis");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-xs text-slate-400 font-bold uppercase">A carregar...</td></tr>`;
  try {
    const id = projectId();
    const [balanceRes, needsData] = await Promise.all([
      apiRequest(`/stock/project/${encodeURIComponent(id)}/balance`).catch(() => ({ items: [] })),
      apiRequest(`/cost-centers/project/${encodeURIComponent(id)}/needs?pageSize=1000`).catch(() => ({ items: [] })),
    ]);
    const priceByName = new Map();
    (needsData.items || []).forEach((n) => {
      const key = String(n.description || "").trim().toUpperCase();
      if (!key) return;
      const unit = num(n.originalUnitPrice ?? n.unitPrice);
      if (unit > 0) priceByName.set(key, unit);
    });
    const items = (balanceRes.items || []).filter((item) => {
      const cat = String(item.product?.category || "").toUpperCase();
      return cat === "MATERIAL" || cat === "CONSUMABLE" || cat === "BT" || cat === "MT" || !cat;
    });
    const groups = new Map();
    let consQty = 0;
    let openQty = 0;
    let consVal = 0;
    let openVal = 0;
    items.forEach((item) => {
      const planned = num(item.quantityPlanned);
      const consumed = num(item.totalConsumed ?? item.totalOut);
      const remaining = Math.max(0, planned > 0 ? planned - consumed : num(item.quantity));
      const fam = productFamily(item.product);
      const key = `${fam.family}||${fam.sub}`;
      if (!groups.has(key)) groups.set(key, { family: fam.family, sub: fam.sub, consumed: 0, remaining: 0, consVal: 0, openVal: 0 });
      const rec = groups.get(key);
      rec.consumed += consumed;
      rec.remaining += remaining;
      const unit = priceByName.get(String(item.product?.name || "").trim().toUpperCase()) || 0;
      rec.consVal += consumed * unit;
      rec.openVal += remaining * unit;
      consQty += consumed;
      openQty += remaining;
      consVal += consumed * unit;
      openVal += remaining * unit;
    });
    const cur = currency();
    if (kpis) {
      kpis.innerHTML = [
        kpiCard("Famílias", String(groups.size), "Com movimento ou plano"),
        kpiCard("Valor consumido", formatCurrency(consVal, cur), consQty ? `${consQty.toLocaleString("pt-PT")} un.` : "Sem preço no orçamento"),
        kpiCard("Ainda por consumir", formatCurrency(openVal, cur), openQty ? `${openQty.toLocaleString("pt-PT")} un.` : "—"),
      ].join("");
    }
    if (!groups.size) {
      body.innerHTML = emptyRow(6, "inventory_2", "Sem materiais no stock desta obra.");
      return;
    }
    body.innerHTML = [...groups.values()]
      .sort((a, b) => a.family.localeCompare(b.family, "pt") || a.sub.localeCompare(b.sub, "pt"))
      .map((g) => `<tr>
        <td class="font-bold text-slate-900">${escapeHtml(g.family)}</td>
        <td>${escapeHtml(g.sub)}</td>
        <td class="text-right tabular-nums">${g.consumed.toLocaleString("pt-PT")}</td>
        <td class="text-right tabular-nums">${g.remaining.toLocaleString("pt-PT")}</td>
        <td class="text-right tabular-nums">${g.consVal ? formatCurrency(g.consVal, cur) : "—"}</td>
        <td class="text-right tabular-nums">${g.openVal ? formatCurrency(g.openVal, cur) : "—"}</td>
      </tr>`).join("");
  } catch (err) {
    body.innerHTML = emptyRow(6, "error", err.message || "Não foi possível carregar os materiais.");
  }
}

let pessoalState = { people: [], records: [] };

async function loadPessoal() {
  const body = document.getElementById("plPessoalBody");
  const kpis = document.getElementById("plPessoalKpis");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-xs text-slate-400 font-bold uppercase">A carregar...</td></tr>`;
  try {
    const id = projectId();
    let people = [];
    try {
      const res = await apiRequest(`/personnel?projectId=${encodeURIComponent(id)}&pageSize=200`);
      people = res.items || [];
    } catch {
      people = [];
    }
    pessoalState.people = people;
    pessoalState.records = readStore(PONTO_KEY);
    const internos = people.filter((p) => String(p.type || "").toUpperCase() === "INTERNO").length;
    const subs = people.filter((p) => String(p.type || "").toUpperCase() === "SUBCONTRATADO").length;
    if (kpis) {
      kpis.innerHTML = [
        kpiCard("Funcionários alocados", String(people.length), "A esta obra"),
        kpiCard("Internos", String(internos)),
        kpiCard("Subcontratados", String(subs)),
      ].join("");
    }
    renderPessoalCustos();
  } catch (err) {
    if (kpis) {
      kpis.innerHTML = [
        kpiCard("Funcionários alocados", "—"),
        kpiCard("Internos", "—"),
        kpiCard("Subcontratados", "—"),
      ].join("");
    }
    body.innerHTML = emptyRow(6, "error", err.message || "Não foi possível carregar o pessoal.");
  }
}

function renderPessoalCustos() {
  const body = document.getElementById("plPessoalBody");
  if (!body) return;
  const nome = String(document.getElementById("plPessoalNome")?.value || "").trim().toLowerCase();
  const de = document.getElementById("plPessoalDe")?.value || "";
  const ate = document.getElementById("plPessoalAte")?.value || "";
  const tipo = document.getElementById("plPessoalTipo")?.value || "";
  const custo = document.getElementById("plPessoalCusto")?.value || "";
  const id = projectId();
  const peopleById = new Map((pessoalState.people || []).map((p) => [p.id, p]));

  const lines = [];
  (pessoalState.records || []).forEach((rec) => {
    const recLines = rec.lines?.length ? rec.lines : [{
      tipoHora: rec.tipoCusto,
      qtd: rec.qtd || rec.hours,
      valorHora: rec.valorHora,
      dataInicio: rec.date,
      dataFim: rec.date,
      projectId: rec.projectId,
    }];
    recLines.forEach((line) => {
      const lineProject = line.projectId || rec.projectId;
      if (lineProject && lineProject !== id) return;
      if (!lineProject && rec.projectId && rec.projectId !== id) return;
      const person = peopleById.get(rec.personnelId);
      const type = String(person?.type || rec.type || "").toUpperCase();
      const tipoHora = pontoTipoNorm(line.tipoHora || rec.tipoCusto);
      const start = toDateKey(line.dataInicio || rec.date) || "";
      const end = toDateKey(line.dataFim || line.dataInicio || rec.date) || start;
      const employeeName = rec.employeeName || (person ? employeeLabel(person) : "");
      if (nome && !employeeName.toLowerCase().includes(nome)) return;
      if (tipo && type !== tipo) return;
      if (custo && tipoHora !== custo) return;
      if (de && end && end < de) return;
      if (ate && start && start > ate) return;
      if (de && !ate && start !== de && end !== de && !(start <= de && end >= de)) return;
      lines.push({
        name: employeeName || "—",
        type,
        tipoHora,
        start,
        end,
        hours: num(line.qtd),
        cost: num(line.qtd) * num(line.valorHora),
      });
    });
  });

  if (!lines.length) {
    body.innerHTML = emptyRow(6, "badge", "Sem horas na folha de ponto para os filtros escolhidos.");
    return;
  }
  const cur = currency();
  body.innerHTML = lines.map((line) => {
    const periodo = line.start === line.end
      ? formatPtLongDate(line.start)
      : `${formatPtLongDate(line.start)} a ${formatPtLongDate(line.end)}`;
    const tipoLabel = line.type === "SUBCONTRATADO" ? "Subcontratado" : line.type === "INTERNO" ? "Interno" : "—";
    return `<tr>
      <td class="font-bold text-slate-900">${escapeHtml(line.name)}</td>
      <td>${escapeHtml(tipoLabel)}</td>
      <td>${escapeHtml(line.tipoHora || "—")}</td>
      <td>${escapeHtml(periodo)}</td>
      <td class="text-right tabular-nums">${line.hours.toLocaleString("pt-PT")}</td>
      <td class="text-right tabular-nums font-bold">${formatCurrency(line.cost, cur)}</td>
    </tr>`;
  }).join("");
}

function openPessoalModal() {
  const id = projectId();
  openModal({
    title: "Novo funcionário",
    primaryLabel: "Criar",
    contentHtml: `
      <div class="space-y-4">
        <p class="text-xs text-slate-500">Ficha rápida — a obra actual fica alocada. Para a ficha completa use <a class="text-blue-600 font-bold" href="/registos/pessoal" target="_blank">Registos → Pessoal</a>.</p>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Nome *
            <input id="plFn" required class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Apelido
            <input id="plLn" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
        </div>
        <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Função *
          <input id="plRole" required class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold" placeholder="Pedreiro, encarregado...">
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Tipo
            <select id="plType" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
              <option value="INTERNO">Interno</option>
              <option value="SUBCONTRATADO">Subcontratado</option>
            </select>
          </label>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">ID funcionário
            <input id="plCode" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Telefone
            <input id="plPhone" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Categoria
            <input id="plCat" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
        </div>
      </div>`,
    onPrimary: async ({ close, btn }) => {
      const firstName = String(document.getElementById("plFn")?.value || "").trim();
      const role = String(document.getElementById("plRole")?.value || "").trim();
      if (firstName.length < 2) { toast("Indique o nome.", { type: "error" }); return; }
      if (role.length < 2) { toast("Indique a função.", { type: "error" }); return; }
      setButtonLoading(btn, true);
      try {
        await apiRequest("/personnel", {
          method: "POST",
          body: {
            firstName,
            lastName: String(document.getElementById("plLn")?.value || "").trim() || null,
            role,
            type: document.getElementById("plType")?.value || "INTERNO",
            employeeCode: String(document.getElementById("plCode")?.value || "").trim() || null,
            phone: String(document.getElementById("plPhone")?.value || "").trim() || null,
            category: String(document.getElementById("plCat")?.value || "").trim() || null,
            projectId: id,
            projectIds: [id],
          },
        });
        toast("Funcionário criado e alocado a esta obra.", { type: "success" });
        close();
        loadPessoal();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Não foi possível criar o funcionário.", { type: "error" });
      }
    },
  });
}

function openPontoModal() {
  const id = projectId();
  const people = pessoalState.people || [];
  const options = people.length
    ? people.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(employeeLabel(p))}</option>`).join("")
    : "";
  openModal({
    title: "Registar horas",
    primaryLabel: "Guardar",
    contentHtml: `
      <div class="space-y-4">
        <p class="text-xs text-slate-500">O mesmo registo aparece em Registos → Folha de Ponto.</p>
        <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Funcionário *
          <select id="ptPerson" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
            <option value="">Seleccionar...</option>${options}
          </select>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Data início *
            <input id="ptDe" type="date" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Data fim
            <input id="ptAte" type="date" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
        </div>
        <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Tipo de custo
          <select id="ptTipo" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
            <option value="Horas Normais">Horas Normais</option>
            <option value="Horas Extra">Horas Extras</option>
          </select>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Quantidade (horas)
            <input id="ptQtd" type="number" min="0" step="0.5" value="8" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400">Valor / hora
            <input id="ptRate" type="number" min="0" step="0.01" value="0" class="mt-1 w-full h-11 px-3 bg-slate-50 border-none rounded-xl text-sm font-semibold">
          </label>
        </div>
      </div>`,
    onRender: ({ panel }) => {
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      panel.querySelector("#ptDe").value = iso;
      panel.querySelector("#ptAte").value = iso;
    },
    onPrimary: async ({ close, btn }) => {
      const personnelId = document.getElementById("ptPerson")?.value;
      const person = people.find((p) => p.id === personnelId);
      const dataInicio = document.getElementById("ptDe")?.value;
      const dataFim = document.getElementById("ptAte")?.value || dataInicio;
      const qtd = String(document.getElementById("ptQtd")?.value || "").trim();
      if (!personnelId || !person) { toast("Seleccione o funcionário.", { type: "error" }); return; }
      if (!dataInicio) { toast("Indique a data.", { type: "error" }); return; }
      if (!num(qtd)) { toast("Indique as horas.", { type: "error" }); return; }
      setButtonLoading(btn, true);
      const tipoHora = document.getElementById("ptTipo")?.value || "Horas Normais";
      const valorHora = String(document.getElementById("ptRate")?.value || "0");
      const items = readStore(PONTO_KEY);
      items.unshift({
        id: `ponto_${Date.now()}`,
        personnelId,
        employeeName: employeeLabel(person),
        date: dataInicio,
        projectId: id,
        projectName: project()?.name || "",
        tipoCusto: tipoHora,
        role: person.role || "",
        type: person.type || "",
        category: person.category || "",
        lines: [{
          tipoHora,
          descricao: tipoHora,
          qtd,
          valorHora,
          periodo: "",
          dataInicio,
          dataFim,
          projectId: id,
          projectName: project()?.name || "",
        }],
      });
      writeStore(PONTO_KEY, items);
      toast("Horas registadas.", { type: "success" });
      close();
      pessoalState.records = items;
      renderPessoalCustos();
    },
  });
}
