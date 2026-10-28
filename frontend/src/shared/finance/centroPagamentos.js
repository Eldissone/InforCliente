import { apiRequest, getAssetUrl } from "../../services/api.js";
import { openModal, setButtonLoading, toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawBarChart, drawComboChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";
import { kpiCardsHtml, meterHtml, num, skeletonHtml, stripHtml } from "./widgets.js";
import { dueChip } from "./contasRecebimentos.js";
import { canPayHere, openPayModal } from "./payModal.js";

/**
 * Ecrã «Centro de Pagamentos» — a fila de trabalho de quem paga.
 *
 * Um pedido de pagamento passa por quatro etapas:
 *   Agendar  → necessidade com cotação escolhida, à espera do plano de prestações;
 *   Aprovar  → reforço do fundo de maneio pedido pela obra;
 *   Pagar    → conta a pagar (custos, pedidos extra e encomendas aprovados,
 *              lançamentos), pela ordem de vencimento — o vencido primeiro;
 *   Pago     → liquidado com comprovativo (últimos 30 dias).
 * Os compromissos (encomendas e pedidos ainda por aprovar) ficam à parte: vão
 * chegar, mas ainda não se podem pagar.
 *
 * O plano da semana confronta o que tem de sair com o saldo bancário e com o
 * que os clientes devem pagar nesses dias.
 */

const STAGES = {
  pay: { label: "A pagar", icon: "payments" },
  overdue: { label: "Vencidos", icon: "warning" },
  schedule: { label: "Por agendar", icon: "calendar_month" },
  approve: { label: "Por aprovar", icon: "approval" },
  commitments: { label: "Compromissos", icon: "lock_clock" },
  paid: { label: "Pagos · 30 dias", icon: "task_alt" },
};

const SOURCE_TONE = { PAGAMENTO: "blue", PEDIDO_EXTRA: "violet", LANCAMENTO: "amber", PEDIDO_COMPRA: "emerald", FRETE: "slate" };

const STATUS_LABEL = {
  PENDENTE: "Pendente",
  EM_ESPERA: "Em espera",
  APROVADO: "Aprovado",
  PENDING: "Por liquidar",
  LATE: "Atrasado",
  RASCUNHO: "Rascunho",
  PENDENTE_REQUISICAO: "Pend. requisição",
  PENDENTE_APROVACAO: "Pend. aprovação",
  EM_PAGAMENTO: "Em pagamento",
  EM_ANALISE: "Em análise",
};

/** Onde se tratam os compromissos (ainda não podem ser pagos). */
const COMMITMENT_LINK = {
  PEDIDO_COMPRA: { href: "/Financeiro/centrodecompras", label: "Compras" },
  PEDIDO_EXTRA: { href: "/Financeiro/centrodecompras", label: "Aprovar" },
  FRETE: { href: "/Financeiro/centrodecompras", label: "Compras" },
};

const LINKS = [
  { label: "Centro de Compras", href: "/Financeiro/centrodecompras", icon: "shopping_cart" },
  { label: "Novo pedido", href: "/Financeiro/novoPedido", icon: "playlist_add" },
];

const state = { stage: "pay", group: "priority", query: "", data: null };

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function canPay() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

function payableItems() {
  return (state.data?.items || []).filter((p) => p.stage === "A_PAGAR");
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = LINKS.map(
      (l) => `<a class="finance-btn finance-btn--ghost" href="${l.href}"><span class="material-symbols-outlined">${l.icon}</span><span>${esc(l.label)}</span></a>`
    ).join("");
  }

  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div id="cpKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>
      <div id="cpStrip" class="ov-strip">${skeletonHtml(6, "cell")}</div>

      <div class="ov-row ov-row--8-4">
        ${chartCardHtml({
          id: "cpChartPlan",
          title: "Plano de pagamentos",
          subtitle: "O que tem de sair por semana · linha = saldo bancário depois de pagar",
          height: 280,
          beforeChartHtml: `<div id="cpPlanTotals" class="ov-flow-totals"></div>`,
        })}
        <section class="finance-card ov-panel">
          <header class="finance-chart-head">
            <h2 class="finance-chart-title">Esta semana</h2>
            <p class="finance-chart-subtitle">Próximos 7 dias, com o vencido</p>
          </header>
          <div id="cpWeek">${skeletonHtml(4, "line")}</div>
        </section>
      </div>

      <div class="ov-row ov-row--6-6">
        ${chartCardHtml({ id: "cpChartSources", title: "A pagar por origem", subtitle: "De onde vêm as contas por pagar", height: 260 })}
        ${chartCardHtml({ id: "cpChartProjects", title: "A pagar por obra", subtitle: "Vencido e a vencer", height: 260 })}
      </div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title" id="cpTitle">A pagar</h2>
            <p class="finance-chart-subtitle" id="cpHint">—</p>
          </div>
          <div class="ov-table-tools">
            <div class="finance-seg finance-seg--sm" id="cpGroup">
              <button type="button" data-group="priority" class="active"><span class="material-symbols-outlined">sort</span><span>Prioridade</span></button>
              <button type="button" data-group="supplier"><span class="material-symbols-outlined">local_shipping</span><span>Fornecedor</span></button>
              <button type="button" data-group="project"><span class="material-symbols-outlined">apartment</span><span>Obra</span></button>
            </div>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="cpSearch" type="search" placeholder="Fornecedor, descrição ou obra…" autocomplete="off" />
            </label>
          </div>
        </header>
        <div id="cpTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  document.querySelectorAll("#cpGroup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.group = btn.dataset.group;
      document.querySelectorAll("#cpGroup button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });
  let timer = null;
  document.getElementById("cpSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      renderTable();
    }, 150);
  });
}

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis() {
  const t = state.data?.totals || {};
  const week = state.data?.week || {};
  const bal = state.data?.balances || {};
  const items = payableItems();
  const total = num(t.payable);
  const overduePct = total > 0 ? (num(t.overdue) / total) * 100 : 0;
  const balance = num(bal.total);
  const afterWeek = balance + num(week.inflow) - num(week.outflow);
  const coverage = num(week.outflow) > 0 ? (balance / num(week.outflow)) * 100 : null;
  const cards = [
    {
      key: "payable",
      label: "A pagar",
      icon: "north_east",
      tone: "blue",
      value: money(total),
      badge: `${items.length} conta${items.length === 1 ? "" : "s"}`,
      badgeTone: "blue",
      body: `
        ${meterHtml([{ value: overduePct, tone: "red" }, { value: 100 - overduePct, tone: "amber-soft" }])}
        <p class="ov-kpi-compare">${
          num(t.overdue) > 0
            ? `<strong class="ov-neg">${esc(compact(t.overdue))}</strong> vencido em ${t.overdueCount} conta${t.overdueCount === 1 ? "" : "s"}`
            : "Nada vencido."
        }</p>`,
    },
    {
      key: "week",
      label: "Sai esta semana",
      icon: "event_upcoming",
      tone: "amber",
      value: money(week.outflow),
      badge: `${week.outflowCount || 0} conta${week.outflowCount === 1 ? "" : "s"}`,
      badgeTone: "amber",
      body: `<p class="ov-kpi-compare">Entra de clientes: <strong class="ov-pos">${esc(compact(week.inflow))}</strong> (${week.inflowCount || 0} fatura${week.inflowCount === 1 ? "" : "s"}).</p>`,
    },
    {
      key: "balance",
      label: "Saldo bancário",
      icon: "account_balance",
      tone: afterWeek >= 0 ? "emerald" : "red",
      value: money(balance),
      badge: coverage === null ? "sem saídas" : `cobre ${Math.round(Math.min(coverage, 999))}%`,
      badgeTone: coverage === null || coverage >= 100 ? "emerald" : "red",
      body: `<p class="ov-kpi-compare">Depois da semana: <strong class="${afterWeek < 0 ? "ov-neg" : "ov-pos"}">${esc(compact(afterWeek))}</strong>${bal.estimated ? ` · <span class="ov-warn">saldo sem extrato</span>` : ""}</p>`,
    },
    {
      key: "paid",
      label: "Pago · 30 dias",
      icon: "task_alt",
      tone: "emerald",
      value: money(t.paid30),
      badge: `${(state.data?.paid || []).length} pagamento${(state.data?.paid || []).length === 1 ? "" : "s"}`,
      badgeTone: "emerald",
      body: `<p class="ov-kpi-compare">Liquidações registadas com comprovativo.</p>`,
    },
  ];
  document.getElementById("cpKpis").innerHTML = kpiCardsHtml(cards, "cp");
}

function stageCount(key) {
  const d = state.data || {};
  if (key === "pay") return { n: payableItems().length, v: num(d.totals?.payable) };
  if (key === "overdue") {
    const rows = payableItems().filter((p) => p.daysLate > 0);
    return { n: rows.length, v: rows.reduce((a, p) => a + num(p.payable), 0) };
  }
  if (key === "schedule") return { n: (d.schedule || []).length, v: num(d.totals?.toSchedule) };
  if (key === "approve") return { n: (d.approvals || []).length, v: num(d.totals?.toApprove) };
  if (key === "commitments") {
    const rows = (d.items || []).filter((p) => p.stage === "COMPROMISSO");
    return { n: rows.length, v: num(d.totals?.commitments) };
  }
  return { n: (d.paid || []).length, v: num(d.totals?.paid30) };
}

function renderStrip() {
  const tone = { overdue: "neg", schedule: "warn", approve: "warn" };
  const wrap = document.getElementById("cpStrip");
  wrap.innerHTML = stripHtml(
    Object.entries(STAGES).map(([key, s]) => {
      const c = stageCount(key);
      return {
        label: s.label,
        icon: s.icon,
        value: compact(c.v),
        valueTone: tone[key] && c.n ? tone[key] : null,
        sub: `${c.n} ${key === "schedule" ? "necessidade" : key === "approve" ? "pedido" : key === "paid" ? "pagamento" : "conta"}${c.n === 1 ? "" : "s"}`,
        subTone: (key === "schedule" || key === "approve") && c.n ? "warn" : null,
        action: key,
        active: state.stage === key,
      };
    })
  );
  wrap.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.stage = btn.dataset.action;
      renderStrip();
      renderTable();
      document.getElementById("cpTable")?.closest(".finance-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ─── Plano e semana ──────────────────────────────────────────────────────── */

/** Saídas por semana: vencido, as próximas 8 semanas e o resto. */
function weeklyPlan() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(monday.getTime() + i * 7 * 864e5);
    return { label: i === 0 ? "Esta semana" : `${start.getDate()} ${MONTHS[start.getMonth()]}`, start, end: new Date(start.getTime() + 7 * 864e5), out: 0 };
  });
  const late = { label: "Vencido", out: 0 };
  const later = { label: "Depois", out: 0 };
  let noDate = 0;
  payableItems().forEach((p) => {
    if (!p.dueDate) {
      noDate += num(p.payable);
      return;
    }
    const d = new Date(p.dueDate);
    d.setHours(0, 0, 0, 0);
    if (d < today) late.out += num(p.payable);
    else (weeks.find((w) => d >= w.start && d < w.end) || later).out += num(p.payable);
  });
  return { rows: [late, ...weeks], later, noDate };
}

function renderPlan() {
  const plan = weeklyPlan();
  const balance = num(state.data?.balances?.total);
  let running = balance;
  const after = plan.rows.map((r) => {
    running -= r.out;
    return running;
  });
  const lowest = Math.min(...after);
  document.getElementById("cpPlanTotals").innerHTML = [
    { label: "Saldo bancário", value: compact(balance), dot: TONES.blue },
    { label: "Vencido", value: compact(plan.rows[0].out), dot: TONES.red },
    { label: "Próximas 8 semanas", value: compact(plan.rows.slice(1).reduce((a, r) => a + r.out, 0)), dot: TONES.amber },
    { label: "Saldo mais baixo", value: compact(lowest), dot: lowest < 0 ? TONES.red : TONES.emerald },
  ]
    .map((t) => `<div class="ov-flow-total"><span><i style="background:${t.dot}"></i>${esc(t.label)}</span><strong>${esc(t.value)}</strong></div>`)
    .join("");
  drawComboChart("cpChartPlan", {
    categories: plan.rows.map((r) => r.label),
    series: [
      { name: "A pagar", type: "column", data: plan.rows.map((r) => Math.round(r.out)), color: TONES.amber },
      { name: "Saldo depois de pagar", type: "line", data: after.map((v) => Math.round(v)), color: TONES.blue },
    ],
    height: 280,
  });

  // Esta semana: vencido + próximos 7 dias, do mais atrasado para o mais recente.
  const week = payableItems().filter((p) => p.daysLate !== null && p.daysLate >= -7);
  const out = week.reduce((a, p) => a + num(p.payable), 0);
  const inflow = num(state.data?.week?.inflow);
  const afterWeek = balance + inflow - out;
  document.getElementById("cpWeek").innerHTML = `
    <div class="cp-week">
      <div class="cp-week-row"><span>Saldo bancário</span><strong>${esc(money(balance))}</strong></div>
      <div class="cp-week-row"><span>+ Recebimentos previstos</span><strong class="ov-pos">${esc(money(inflow))}</strong></div>
      <div class="cp-week-row"><span>− Pagamentos a fazer</span><strong class="ov-neg">${esc(money(out))}</strong></div>
      <div class="cp-week-row cp-week-row--total"><span>Fica em caixa</span><strong class="${afterWeek < 0 ? "ov-neg" : ""}">${esc(money(afterWeek))}</strong></div>
      ${
        afterWeek < 0
          ? `<p class="cp-week-alert"><span class="material-symbols-outlined">priority_high</span>Faltam ${esc(compact(-afterWeek))} para pagar tudo: priorize o vencido e negocie o resto.</p>`
          : ""
      }
    </div>
    ${
      week.length
        ? `<ul class="ac-feed cp-week-list">
            ${week
              .slice(0, 5)
              .map(
                (p) => `
              <li>
                <span class="ac-feed-icon ${p.daysLate > 0 ? "ac-feed-icon--late" : "ac-feed-icon--out"}"><span class="material-symbols-outlined">${p.daysLate > 0 ? "priority_high" : "north_east"}</span></span>
                <div>
                  <strong>${esc(p.supplier || p.description || "—")}</strong>
                  <small>${esc([p.project?.name, p.sourceLabel].filter(Boolean).join(" · "))}</small>
                </div>
                <div class="ac-feed-value">
                  <strong>${esc(compact(p.payable))}</strong>
                  <small>${dueChip(p.daysLate)}</small>
                </div>
                ${canPay() && canPayHere(p) ? `<button type="button" class="ac-feed-pay" data-pay="${esc(p.id)}" title="Pagar"><span class="material-symbols-outlined">payments</span></button>` : ""}
              </li>`
              )
              .join("")}
          </ul>
          ${week.length > 5 ? `<button type="button" class="fl-link cp-more" data-goto="overdue">Ver as ${week.length} contas</button>` : ""}`
        : `<div class="ov-empty"><span class="material-symbols-outlined">event_available</span>Nada a pagar esta semana.</div>`
    }`;
  bindPay(document.getElementById("cpWeek"));
  document.querySelector("#cpWeek [data-goto]")?.addEventListener("click", () => {
    state.stage = "pay";
    renderStrip();
    renderTable();
  });
}

function renderCharts() {
  const items = payableItems();
  const bySource = new Map();
  items.forEach((p) => bySource.set(p.sourceLabel || p.source, (bySource.get(p.sourceLabel || p.source) || 0) + num(p.payable)));
  const sources = [...bySource.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (sources.length) {
    drawDonutChart("cpChartSources", {
      labels: sources.map(([l]) => l),
      series: sources.map(([, v]) => v),
      totalLabel: "A pagar",
      height: 260,
    });
  } else {
    emptyChart("cpChartSources", "donut_small", "Sem contas a pagar.");
  }

  const byProject = new Map();
  items.forEach((p) => {
    const name = p.project?.name || p.costCenter?.name || "Sem obra";
    if (!byProject.has(name)) byProject.set(name, { overdue: 0, onTime: 0 });
    const b = byProject.get(name);
    if (p.daysLate > 0) b.overdue += num(p.payable);
    else b.onTime += num(p.payable);
  });
  const groups = [...byProject.entries()].map(([name, v]) => ({ name, ...v, total: v.overdue + v.onTime })).sort((a, b) => b.total - a.total).slice(0, 8);
  if (groups.length) {
    drawBarChart("cpChartProjects", {
      categories: groups.map((g) => (g.name.length > 28 ? `${g.name.slice(0, 26)}…` : g.name)),
      series: [
        { name: "Vencido", data: groups.map((g) => g.overdue), color: TONES.red },
        { name: "A vencer", data: groups.map((g) => g.onTime), color: "#fcd34d" },
      ],
      stacked: true,
      horizontal: true,
      height: Math.max(200, groups.length * 44 + 80),
    });
  } else {
    emptyChart("cpChartProjects", "apartment", "Sem contas a pagar.");
  }
}

async function emptyChart(id, icon, message) {
  await drawBarChart(id, {});
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">${icon}</span>${esc(message)}</div>`;
}

/* ─── Ações ───────────────────────────────────────────────────────────────── */

function bindPay(root) {
  root?.querySelectorAll("[data-pay]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = (state.data?.items || []).find((p) => p.id === btn.dataset.pay);
      if (item) openPayModal(item, { onSaved: load });
    });
  });
}

function payActionHtml(p) {
  if (p.stage === "A_PAGAR") {
    return canPay() && canPayHere(p)
      ? `<button type="button" class="cr-act cr-act--emerald" data-pay="${esc(p.id)}"><span class="material-symbols-outlined">payments</span><span>Pagar</span></button>`
      : "";
  }
  const link = COMMITMENT_LINK[p.source];
  return link ? `<a class="cr-act cr-act--slate" href="${link.href}"><span class="material-symbols-outlined">open_in_new</span><span>${esc(link.label)}</span></a>` : "";
}

async function decideReinforcement(request, approve) {
  if (approve) {
    openModal({
      title: "Aprovar reforço do fundo",
      width: 520,
      contentHtml: `
        <p class="pay-note"><span class="material-symbols-outlined">info</span><span>
          O valor entra já no fundo <strong>${esc(request.fund?.name || "—")}</strong>${request.card ? ` (cartão ${esc(request.card.label)})` : ""}
          e fica disponível para a obra gastar.
        </span></p>
        <div class="pay-head">
          <div class="pay-head-main"><strong>${esc(request.reason)}</strong><small>${esc([request.fund?.project?.name, request.requestedBy].filter(Boolean).join(" · "))}</small></div>
          <div class="pay-head-amount"><span>Reforço</span><strong>${esc(money(request.amount, request.currency))}</strong></div>
        </div>`,
      primaryLabel: "Aprovar reforço",
      onPrimary: async ({ btn, close }) => {
        setButtonLoading(btn, true);
        try {
          await apiRequest(`/petty-cash/reinforcement-requests/${encodeURIComponent(request.id)}/approve`, { method: "POST" });
          toast("Reforço aprovado e creditado no fundo.", { type: "success" });
          close();
          await load();
        } catch (err) {
          toast(err.message || "Não foi possível aprovar.", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
        }
      },
    });
    return;
  }
  openModal({
    title: "Rejeitar reforço do fundo",
    width: 520,
    contentHtml: `
      <div class="finance-field">
        <label class="finance-label" for="rf_reason">Motivo <span class="inv-req">*</span></label>
        <input id="rf_reason" class="finance-input" type="text" placeholder="Ex.: saldo do fundo ainda suficiente" />
      </div>`,
    primaryLabel: "Rejeitar",
    onPrimary: async ({ btn, close, panel }) => {
      const reason = panel.querySelector("#rf_reason").value.trim();
      if (!reason) return toast("Indique o motivo da rejeição.", { type: "error" });
      setButtonLoading(btn, true);
      try {
        await apiRequest(`/petty-cash/reinforcement-requests/${encodeURIComponent(request.id)}/reject`, { method: "POST", body: { reason } });
        toast("Reforço rejeitado.", { type: "success" });
        close();
        await load();
      } catch (err) {
        toast(err.message || "Não foi possível rejeitar.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

function scheduleUrl(n) {
  const url = new URL("/Projectos/centroCustos", window.location.origin);
  url.searchParams.set("projectId", n.projectId);
  url.searchParams.set("tab", "cronograma");
  url.searchParams.set("needId", n.id);
  if (n.quoteId) url.searchParams.set("quoteId", n.quoteId);
  return url.pathname + url.search;
}

/* ─── Tabelas ─────────────────────────────────────────────────────────────── */

function matches(values) {
  const q = state.query.trim().toLowerCase();
  return !q || values.some((v) => String(v || "").toLowerCase().includes(q));
}

function payRowsHtml(items) {
  return items
    .map((p) => {
      const cur = p.currency || "AOA";
      const due = p.stage === "A_PAGAR";
      return `
      <tr class="${due && p.daysLate > 0 ? "fin-row--overdue" : ""}">
        <td><div class="inv-due-cell">${esc(p.dueDate ? dateOnly(p.dueDate) : "—")}${due ? dueChip(p.daysLate) : ""}</div></td>
        <td>
          <div class="ov-project cr-desc">
            <span class="ov-project-name cr-desc-title">${esc(p.supplier || "Sem fornecedor")}</span>
            <span class="ov-project-meta">${esc([p.docNumber, p.description].filter(Boolean).join(" · "))}</span>
          </div>
        </td>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(p.project?.name || p.costCenter?.name || "—")}</span>
            <span class="ov-project-meta">${esc(p.project ? p.costCenter?.name || p.project.code || "" : "")}</span>
          </div>
        </td>
        <td><span class="finance-chip finance-chip--${SOURCE_TONE[p.source] || "slate"}">${esc(p.sourceLabel || p.source)}</span></td>
        <td class="fin-num ${due && p.daysLate > 0 ? "ov-neg" : ""}"><strong>${esc(money(p.payable, cur))}</strong>${
          num(p.paidAmount) > 0 ? `<small class="cp-sub">de ${esc(compact(p.amount))}</small>` : ""
        }</td>
        <td><span class="finance-badge finance-badge--${due ? "slate" : "violet"}">${esc(STATUS_LABEL[p.status] || p.status || "—")}</span></td>
        <td>${payActionHtml(p)}</td>
      </tr>`;
    })
    .join("");
}

function renderPayTable(wrap, items) {
  if (state.group !== "priority") {
    const keyOf = state.group === "supplier" ? (p) => p.supplier || "Sem fornecedor" : (p) => p.project?.name || p.costCenter?.name || "Sem obra";
    const groups = new Map();
    items.forEach((p) => {
      const k = keyOf(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    });
    const ordered = [...groups.entries()]
      .map(([name, rows]) => ({ name, rows, total: rows.reduce((a, p) => a + num(p.payable), 0), overdue: rows.filter((p) => p.daysLate > 0).reduce((a, p) => a + num(p.payable), 0) }))
      .sort((a, b) => b.total - a.total);
    wrap.innerHTML = `
      <table class="fin-table ac-table">
        <thead><tr><th>Vencimento</th><th>Fornecedor · Documento</th><th>Obra · Centro</th><th>Fonte</th><th style="text-align:right">Por pagar</th><th>Estado</th><th></th></tr></thead>
        <tbody>${ordered
          .map(
            (g) => `
          <tr class="cp-group-row"><td colspan="7">
            <div class="cp-group-head"><strong>${esc(g.name)}</strong><span>${g.rows.length} conta${g.rows.length === 1 ? "" : "s"}</span>
              ${g.overdue > 0 ? `<span class="ov-neg">${esc(compact(g.overdue))} vencido</span>` : ""}<strong class="cp-group-total">${esc(money(g.total))}</strong></div>
          </td></tr>${payRowsHtml(g.rows)}`
          )
          .join("")}</tbody>
      </table>`;
  } else {
    // Prioridade: o mais atrasado primeiro, depois pela data de vencimento.
    const sorted = [...items].sort((a, b) => (b.daysLate ?? -1e9) - (a.daysLate ?? -1e9));
    wrap.innerHTML = `
      <table class="fin-table ac-table">
        <thead><tr><th>Vencimento</th><th>Fornecedor · Documento</th><th>Obra · Centro</th><th>Fonte</th><th style="text-align:right">Por pagar</th><th>Estado</th><th></th></tr></thead>
        <tbody>${payRowsHtml(sorted)}</tbody>
        <tfoot><tr><td colspan="4">Total (${items.length})</td><td class="fin-num">${esc(money(items.reduce((a, p) => a + num(p.payable), 0)))}</td><td colspan="2"></td></tr></tfoot>
      </table>`;
  }
  bindPay(wrap);
}

function renderSchedule(wrap) {
  const rows = (state.data?.schedule || []).filter((n) => matches([n.description, n.supplier, n.project?.name]));
  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">event_available</span>Nenhuma necessidade à espera de agendamento.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table class="fin-table ac-table">
      <thead><tr><th>Enviado</th><th>Necessidade · Fornecedor</th><th>Obra · Centro</th><th>Prazo do fornecedor</th><th style="text-align:right">Valor</th><th></th></tr></thead>
      <tbody>${rows
        .map(
          (n) => `
        <tr>
          <td>${esc(dateOnly(n.sentAt))}</td>
          <td><div class="ov-project cr-desc"><span class="ov-project-name cr-desc-title">${esc(n.description)}</span><span class="ov-project-meta">${esc(n.supplier || "—")}</span></div></td>
          <td><div class="ov-project"><span class="ov-project-name">${esc(n.project?.name || "—")}</span><span class="ov-project-meta">${esc(n.costCenter?.code || n.costCenter?.name || "")}</span></div></td>
          <td>${esc(n.paymentTerm || "—")}</td>
          <td class="fin-num"><strong>${esc(money(n.amount, n.currency))}</strong></td>
          <td><div class="ac-actions">
            ${n.proformaUrl ? `<a class="cr-act cr-act--slate" href="${esc(getAssetUrl(n.proformaUrl))}" target="_blank" rel="noopener"><span class="material-symbols-outlined">description</span><span>Proforma</span></a>` : ""}
            <a class="cr-act cr-act--amber" href="${esc(scheduleUrl(n))}"><span class="material-symbols-outlined">calendar_month</span><span>Definir parcelas</span></a>
          </div></td>
        </tr>`
        )
        .join("")}</tbody>
      <tfoot><tr><td colspan="4">Total (${rows.length})</td><td class="fin-num">${esc(money(rows.reduce((a, n) => a + num(n.amount), 0)))}</td><td></td></tr></tfoot>
    </table>`;
}

function renderApprovals(wrap) {
  const rows = (state.data?.approvals || []).filter((r) => matches([r.reason, r.fund?.name, r.fund?.project?.name, r.requestedBy]));
  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">approval</span>Nenhum pedido de reforço por aprovar.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table class="fin-table ac-table">
      <thead><tr><th>Pedido</th><th>Motivo</th><th>Fundo · Obra</th><th>Pedido por</th><th style="text-align:right">Valor</th><th></th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `
        <tr data-id="${esc(r.id)}">
          <td>${esc(dateOnly(r.requestedAt))}</td>
          <td><div class="ov-project cr-desc"><span class="ov-project-name cr-desc-title">${esc(r.reason)}</span><span class="ov-project-meta">Reforço do fundo de maneio</span></div></td>
          <td><div class="ov-project"><span class="ov-project-name">${esc(r.fund?.name || "—")}</span><span class="ov-project-meta">${esc([r.fund?.project?.name, r.card?.label].filter(Boolean).join(" · "))}</span></div></td>
          <td>${esc(r.requestedBy || "—")}</td>
          <td class="fin-num"><strong>${esc(money(r.amount, r.currency))}</strong></td>
          <td>${
            canPay()
              ? `<div class="ac-actions">
                  <button type="button" class="cr-act cr-act--slate" data-reject><span class="material-symbols-outlined">close</span><span>Rejeitar</span></button>
                  <button type="button" class="cr-act cr-act--emerald" data-approve><span class="material-symbols-outlined">check</span><span>Aprovar</span></button>
                </div>`
              : ""
          }</td>
        </tr>`
        )
        .join("")}</tbody>
    </table>`;
  wrap.querySelectorAll("[data-approve], [data-reject]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const request = rows.find((r) => r.id === btn.closest("tr").dataset.id);
      if (request) decideReinforcement(request, btn.hasAttribute("data-approve"));
    });
  });
}

function renderPaid(wrap) {
  const rows = (state.data?.paid || []).filter((p) => matches([p.party, p.description, p.project?.name]));
  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">task_alt</span>Sem pagamentos nos últimos 30 dias.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table class="fin-table ac-table">
      <thead><tr><th>Pago em</th><th>Fornecedor · Descrição</th><th>Obra</th><th>Fonte</th><th>Meio</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>${rows
        .map(
          (p) => `
        <tr>
          <td>${esc(dateOnly(p.date))}</td>
          <td><div class="ov-project cr-desc"><span class="ov-project-name cr-desc-title">${esc(p.party || "—")}</span><span class="ov-project-meta">${esc(p.description || "")}</span></div></td>
          <td>${esc(p.project?.name || "—")}</td>
          <td><span class="finance-chip finance-chip--${SOURCE_TONE[p.source] || "slate"}">${esc(p.sourceLabel)}</span></td>
          <td>${esc(p.method || "—")}${p.hasProof === false ? ` <span class="inv-due inv-due--soon" title="Sem comprovativo anexado">sem comprovativo</span>` : ""}</td>
          <td class="fin-num"><strong class="ov-pos">${esc(money(p.amount))}</strong></td>
        </tr>`
        )
        .join("")}</tbody>
      <tfoot><tr><td colspan="5">Total (${rows.length})</td><td class="fin-num">${esc(money(rows.reduce((a, p) => a + num(p.amount), 0)))}</td></tr></tfoot>
    </table>`;
}

const HINTS = {
  pay: "O mais atrasado primeiro · «Pagar» regista o pagamento com o comprovativo",
  overdue: "Contas vencidas e ainda por pagar",
  schedule: "Cotações aprovadas pela obra: defina as prestações para entrarem no plano de pagamentos",
  approve: "Pedidos de reforço do fundo de maneio feitos pelas obras",
  commitments: "Encomendas e pedidos ainda por aprovar: passam a «A pagar» quando forem aprovados",
  paid: "Liquidações dos últimos 30 dias",
};

function renderTable() {
  const wrap = document.getElementById("cpTable");
  document.getElementById("cpTitle").textContent = STAGES[state.stage].label;
  document.getElementById("cpHint").textContent = HINTS[state.stage];
  document.getElementById("cpGroup").hidden = !["pay", "overdue", "commitments"].includes(state.stage);
  if (state.stage === "schedule") return renderSchedule(wrap);
  if (state.stage === "approve") return renderApprovals(wrap);
  if (state.stage === "paid") return renderPaid(wrap);
  const items = (state.data?.items || []).filter((p) => {
    if (state.stage === "commitments" ? p.stage !== "COMPROMISSO" : p.stage !== "A_PAGAR") return false;
    if (state.stage === "overdue" && !(p.daysLate > 0)) return false;
    return matches([p.supplier, p.description, p.docNumber, p.project?.name, p.costCenter?.name]);
  });
  if (!items.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">task_alt</span>Nada nesta etapa.</div>`;
    return;
  }
  renderPayTable(wrap, items);
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  try {
    state.data = await apiRequest("/finance/payment-center");
    renderKpis();
    renderStrip();
    renderTable();
    renderPlan();
    renderCharts();
  } catch (err) {
    const wrap = document.getElementById("cpTable");
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o Centro de Pagamentos.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  const stage = new URLSearchParams(window.location.search).get("stage");
  if (stage && STAGES[stage]) state.stage = stage;
  renderShell();
  await load();
}
