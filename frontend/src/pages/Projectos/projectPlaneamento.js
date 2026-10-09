import { apiRequest } from "../../services/api.js";
import { formatCurrency, toDateKey } from "../../shared/format.js";
import { paymentPayableAmount } from "../../shared/supplierFiscal.js";
import { toast, openModal, escapeHtml, setButtonLoading } from "../../shared/ui.js";

const PT_MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const PT_MONTHS_SHORT = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
const GANTT_DONE = ["#f87171", "#3b82f6"];
const WEEK_PX = 52;
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

function collectGanttActivities(tasks, plans, projectRef) {
  const byTask = new Map();
  (plans || []).forEach((plan) => {
    const date = parseLocalDate(plan.date);
    (plan.tasks || []).forEach((line) => {
      const id = line.progressTaskId || line.progressTask?.id;
      if (!id) return;
      if (!byTask.has(id)) byTask.set(id, { dates: [], plannedQty: 0, executedQty: 0, people: new Set() });
      const rec = byTask.get(id);
      if (date) rec.dates.push(date);
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
    list.forEach((t, idx) => {
      const rec = byTask.get(t.id);
      const start = rec?.dates?.length ? new Date(Math.min(...rec.dates.map((d) => d.getTime()))) : null;
      const end = rec?.dates?.length ? new Date(Math.max(...rec.dates.map((d) => d.getTime()))) : null;
      const predecessor = idx > 0 ? list[idx - 1] : null;
      activities.push({
        id: t.id,
        name: t.description || t.itemGroup || "Atividade",
        start,
        end,
        pct: plannedPct(t, byTask),
        execPct: executedPct(t),
        dependency: predecessor?.description || "",
        people: rec?.people ? [...rec.people] : [],
        wbs: t.wbsCode || "",
        group: t.itemGroup || "",
      });
    });
  });

  const dated = activities.filter((a) => a.start && a.end);
  if (!dated.length && (projectRef?.startDate || projectRef?.dueDate)) {
    return { activities, weeks: [], hint: "As barras aparecem quando as atividades tiverem datas nos planos diários." };
  }

  let rangeStart = dated.length ? new Date(Math.min(...dated.map((a) => a.start.getTime()))) : parseLocalDate(projectRef?.startDate);
  let rangeEnd = dated.length ? new Date(Math.max(...dated.map((a) => a.end.getTime()))) : parseLocalDate(projectRef?.dueDate);
  if (projectRef?.startDate) {
    const ps = parseLocalDate(projectRef.startDate);
    if (ps && (!rangeStart || ps < rangeStart)) rangeStart = ps;
  }
  if (projectRef?.dueDate) {
    const pe = parseLocalDate(projectRef.dueDate);
    if (pe && (!rangeEnd || pe > rangeEnd)) rangeEnd = pe;
  }
  if (!rangeStart || !rangeEnd) return { activities, weeks: [], hint: null };

  const weeks = [];
  let cursor = startOfWeek(rangeStart);
  const last = startOfWeek(rangeEnd);
  let n = 1;
  while (cursor <= last && n <= 104) {
    weeks.push({ n, start: new Date(cursor), end: addDays(cursor, 6) });
    cursor = addDays(cursor, 7);
    n += 1;
  }
  return { activities, weeks, hint: dated.length ? null : "As barras aparecem quando as atividades tiverem datas nos planos diários." };
}

function weekIndexAt(weeks, date) {
  if (!date || !weeks.length) return -1;
  const t = date.getTime();
  for (let i = 0; i < weeks.length; i += 1) {
    if (t >= weeks[i].start.getTime() && t <= addDays(weeks[i].end, 1).getTime() - 1) return i;
  }
  if (t < weeks[0].start.getTime()) return 0;
  if (t > weeks[weeks.length - 1].end.getTime()) return weeks.length - 1;
  return -1;
}

function monthGroups(weeks) {
  const groups = [];
  weeks.forEach((w) => {
    const key = `${w.start.getFullYear()}-${w.start.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.span += 1;
    else groups.push({ key, label: formatMonthYear(w.start.getFullYear(), w.start.getMonth()), span: 1 });
  });
  return groups;
}

function renderGantt(model) {
  const root = document.getElementById("plGanttRoot");
  const meta = document.getElementById("plGanttMeta");
  if (!root) return;
  const { activities, weeks, hint } = model;
  if (meta) {
    meta.classList.remove("hidden");
    meta.innerHTML = [
      `<span>${activities.length} atividade${activities.length === 1 ? "" : "s"}</span>`,
      `<span>Datas a partir dos planos diários · % planeada = qtd. planeada / prevista</span>`,
    ].join("");
  }
  if (!activities.length) {
    root.innerHTML = `<div class="pl-empty"><span class="material-symbols-outlined">view_timeline</span><p class="text-sm font-semibold">Sem atividades no avanço físico.</p><p class="text-xs mt-1">Importe a tabela de quantidades ou crie itens em Operação → Avanço Físico.</p></div>`;
    return;
  }
  if (!weeks.length) {
    const rows = activities.map((a) => `<tr>
      <td class="ex-gantt-sticky ex-gantt-col-act"><span class="ex-gantt-act" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-start"><span class="ex-gantt-date">${formatPtLongDate(a.start)}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-end"><span class="ex-gantt-date">${formatPtLongDate(a.end)}</span></td>
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

  const months = monthGroups(weeks);
  const monthRow = months.map((m) => `<th class="ex-gantt-month" colspan="${m.span}">${escapeHtml(m.label)}</th>`).join("");
  const weekRow = weeks.map((w) => `<th class="ex-gantt-week">W${w.n}</th>`).join("");
  const trackWidth = weeks.length * WEEK_PX;

  const body = activities.map((a, idx) => {
    const startIdx = weekIndexAt(weeks, a.start);
    const endIdx = weekIndexAt(weeks, a.end);
    let bar = "";
    let dep = "";
    if (startIdx >= 0 && endIdx >= 0 && a.start && a.end) {
      const span = Math.max(1, endIdx - startIdx + 1);
      const left = startIdx * WEEK_PX + 4;
      const width = span * WEEK_PX - 8;
      const done = a.execPct >= 99.5 || a.pct >= 99.5;
      const color = done ? GANTT_DONE[idx % GANTT_DONE.length] : (a.pct > 0 ? "#ef4444" : "#94a3b8");
      const title = [
        a.name,
        a.dependency ? `Dependência: ${a.dependency}` : "",
        a.people.length ? `Responsáveis: ${a.people.join(", ")}` : "",
        `% planeada: ${Math.round(a.pct)}`,
      ].filter(Boolean).join(" · ");
      bar = `<div class="ex-gantt-bar" style="left:${left}px;width:${width}px;background:${color}" title="${escapeHtml(title)}"><span>${escapeHtml(a.name)}</span></div>`;
      if (a.dependency) {
        dep = `<div class="ex-gantt-dep" style="left:${Math.max(0, left - 12)}px"></div>`;
      }
    }
    const pctClass = a.pct >= 100 ? "is-done" : "";
    return `<tr>
      <td class="ex-gantt-sticky ex-gantt-col-act"><span class="ex-gantt-act" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-start"><span class="ex-gantt-date">${formatPtLongDate(a.start)}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-end"><span class="ex-gantt-date">${formatPtLongDate(a.end)}</span></td>
      <td class="ex-gantt-sticky ex-gantt-col-pct"><span class="ex-gantt-pct ${pctClass}">${Math.round(a.pct)}</span></td>
      <td colspan="${weeks.length}" class="!p-0">
        <div class="ex-gantt-track" style="width:${trackWidth}px">${dep}${bar}</div>
      </td>
    </tr>`;
  }).join("");

  root.innerHTML = `${hint ? `<p class="px-6 py-3 text-xs font-semibold text-slate-500 border-b border-slate-100">${escapeHtml(hint)}</p>` : ""}
    <div class="ex-gantt-scroll">
      <table class="ex-gantt-table">
        <thead>
          <tr>
            <th class="ex-gantt-sticky ex-gantt-col-act" rowspan="2">Atividade</th>
            <th class="ex-gantt-sticky ex-gantt-col-start" rowspan="2">Início</th>
            <th class="ex-gantt-sticky ex-gantt-col-end" rowspan="2">Fim</th>
            <th class="ex-gantt-sticky ex-gantt-col-pct" rowspan="2">%</th>
            ${monthRow}
          </tr>
          <tr>${weekRow}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
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
    cache.gantt = collectGanttActivities(taskData.tasks || [], plans || [], project());
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
