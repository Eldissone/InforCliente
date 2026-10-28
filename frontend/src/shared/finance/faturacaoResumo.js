import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { compactMoney as compact } from "./charts.js";
import { kpiCardsHtml, num, skeletonHtml, stripHtml } from "./widgets.js";

/**
 * Ecrã «Resumo» (Financeiro · Faturação).
 *
 * Decompõe a venda prevista de cada obra (o caderno de encargos) em quatro
 * partes que somam 100%:
 *  - AM faturado       → autos de medição já faturados
 *  - AM por faturar    → autos aprovados ainda sem fatura
 *  - Executado sem AM  → execução física das tarefas ainda não medida
 *  - Por executar      → o que falta fazer
 */

const PARTS = [
  { key: "amBilled", label: "AM faturado", color: "#0d3fd1", value: "withAmValue", pct: "amBilledPct" },
  { key: "amToBill", label: "AM por faturar", color: "#f59e0b", value: "withoutAmValue", pct: "amToBillPct" },
  { key: "executedNoAm", label: "Executado sem AM", color: "#7c9cf5", value: "executedNoAmValue", pct: "executedNoAmPct" },
  { key: "toExecute", label: "Por executar", color: "#e2e8f0", value: "toExecuteValue", pct: "toExecutePct" },
];

const state = {
  items: [],
  query: "",
  scope: "forecast",
  sort: { key: "forecastValue", dir: "desc" },
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Totais da carteira — só obras com venda prevista entram nas percentagens. */
function portfolio(items) {
  const withForecast = items.filter((i) => num(i.forecastValue) > 0);
  const sum = (list, key) => list.reduce((a, i) => a + num(i[key]), 0);
  const forecast = sum(withForecast, "forecastValue");
  const share = (key) => (forecast > 0 ? (sum(withForecast, key) / forecast) * 100 : 0);
  return {
    count: items.length,
    withForecast: withForecast.length,
    forecast,
    measured: sum(withForecast, "measuredValue"),
    billed: sum(items, "billedValue"),
    billedWithoutAm: sum(items, "billedWithoutAm"),
    withAmCount: sum(items, "withAmCount"),
    withoutAmCount: sum(items, "withoutAmCount"),
    values: Object.fromEntries(PARTS.map((p) => [p.key, sum(withForecast, p.value)])),
    pcts: Object.fromEntries(PARTS.map((p) => [p.key, share(p.value)])),
    withoutExecution: withForecast.filter((i) => !i.hasExecution).length,
  };
}

/** Barra empilhada a 100% com as quatro partes da venda prevista. */
function stackHtml(item, { tall = false } = {}) {
  const cur = item.project?.currency;
  return `
    <div class="rs-stack ${tall ? "rs-stack--tall" : ""}">
      ${PARTS.map((p) => {
        const value = num(item[p.pct]);
        return value > 0
          ? `<span style="width:${Math.min(value, 100).toFixed(2)}%;background:${p.color}" title="${esc(p.label)}: ${esc(pct(value))} · ${esc(money(item[p.value], cur))}"></span>`
          : "";
      }).join("")}
    </div>`;
}

function legendHtml(values, pcts) {
  return `
    <ul class="rs-legend">
      ${PARTS.map(
        (p) => `
        <li>
          <span class="rs-legend-label"><i style="background:${p.color}"></i>${esc(p.label)}</span>
          <strong>${esc(pct(pcts[p.key]))}</strong>
          <small>${esc(compact(values[p.key]))}</small>
        </li>`
      ).join("")}
    </ul>`;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div id="rsKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Caderno de encargos da carteira</h2>
            <p class="finance-chart-subtitle" id="rsPortfolioSub">—</p>
          </div>
        </header>
        <div id="rsPortfolio">${skeletonHtml(2, "line")}</div>
      </section>

      <div id="rsStrip" class="ov-strip">${skeletonHtml(6, "cell")}</div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Resumo por obra</h2>
            <p class="finance-chart-subtitle">Passe o cursor sobre a barra para ver cada parte · % sobre a venda prevista da obra</p>
          </div>
          <div class="ov-table-tools">
            <div class="finance-seg finance-seg--sm" id="rsScope">
              <button type="button" data-scope="forecast" class="active">Com venda prevista</button>
              <button type="button" data-scope="all">Todas</button>
            </div>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="rsSearch" type="search" placeholder="Obra, código ou cliente…" autocomplete="off" />
            </label>
          </div>
        </header>
        <div id="rsTable" class="finance-table-scroll"></div>
      </section>
    </div>`;

  document.querySelectorAll("#rsScope button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scope = btn.dataset.scope;
      document.querySelectorAll("#rsScope button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });

  let timer = null;
  document.getElementById("rsSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      renderTable();
    }, 150);
  });
}

/* ─── Indicadores e carteira ──────────────────────────────────────────────── */

function renderKpis(t) {
  const amPct = t.pcts.amBilled + t.pcts.amToBill;
  const cards = [
    {
      key: "withAm",
      label: "% obra com AM feitos",
      icon: "fact_check",
      tone: "blue",
      value: pct(amPct),
      badge: `${t.withAmCount + t.withoutAmCount} autos`,
      badgeTone: "blue",
      body: `
        <dl class="ov-kpi-split">
          <div><dt>AM faturados (${t.withAmCount})</dt><dd>${esc(compact(t.values.amBilled))} · ${esc(pct(t.pcts.amBilled))}</dd></div>
          <div><dt>AM por faturar (${t.withoutAmCount})</dt><dd class="ov-warn">${esc(compact(t.values.amToBill))} · ${esc(pct(t.pcts.amToBill))}</dd></div>
        </dl>`,
    },
    {
      key: "withoutAm",
      label: "% obra sem AM feitos",
      icon: "pending",
      tone: "slate",
      value: pct(Math.max(100 - amPct, 0)),
      badge: compact(t.forecast - t.measured),
      badgeTone: "blue",
      body: `<p class="ov-kpi-compare">Parte da venda prevista ainda sem auto de medição: executada sem AM + por executar.</p>`,
    },
    {
      key: "executedNoAm",
      label: "% obra executada sem AM",
      icon: "construction",
      tone: "violet",
      value: pct(t.pcts.executedNoAm),
      badge: compact(t.values.executedNoAm),
      badgeTone: "violet",
      body: `<p class="ov-kpi-compare">${
        t.pcts.executedNoAm > 0
          ? "Trabalho feito no terreno que ainda não foi medido. <strong>Preparar auto de medição.</strong>"
          : "Toda a execução registada já está medida."
      }${t.withoutExecution ? ` ${t.withoutExecution} obra(s) sem quantidades executadas.` : ""}</p>`,
    },
    {
      key: "toExecute",
      label: "% obra por executar",
      icon: "hourglass_bottom",
      tone: "amber",
      value: pct(t.pcts.toExecute),
      badge: compact(t.values.toExecute),
      badgeTone: "amber",
      body: `<p class="ov-kpi-compare">Venda prevista ainda por executar em ${t.withForecast} obra${t.withForecast === 1 ? "" : "s"} com previsão.</p>`,
    },
  ];
  document.getElementById("rsKpis").innerHTML = kpiCardsHtml(cards, "rs");
}

function renderPortfolio(t) {
  document.getElementById("rsPortfolioSub").textContent =
    `Venda prevista de ${t.withForecast} obra${t.withForecast === 1 ? "" : "s"} (${compact(t.forecast)}) decomposta pelo estado de medição e execução`;
  const wrap = document.getElementById("rsPortfolio");
  if (!(t.forecast > 0)) {
    wrap.innerHTML = `<div class="ov-empty"><span class="material-symbols-outlined">target</span>Nenhuma obra tem venda prevista. Defina a tabela de quantidades ou o valor da obra.</div>`;
    return;
  }
  wrap.innerHTML = `
    ${stackHtml({ ...Object.fromEntries(PARTS.map((p) => [p.pct, t.pcts[p.key]])), ...Object.fromEntries(PARTS.map((p) => [p.value, t.values[p.key]])) }, { tall: true })}
    ${legendHtml(t.values, t.pcts)}`;
}

function renderStrip(t) {
  document.getElementById("rsStrip").innerHTML = stripHtml([
    { label: "Venda prevista", icon: "target", value: compact(t.forecast), sub: `${t.withForecast} de ${t.count} obras` },
    { label: "Medido (AM)", icon: "fact_check", value: compact(t.measured), sub: `${pct(t.forecast > 0 ? (t.measured / t.forecast) * 100 : 0)} da previsão` },
    { label: "Faturado", icon: "receipt_long", value: compact(t.billed), sub: "total emitido", href: "/Financeiro/faturacao/registar" },
    {
      label: "Faturado sem AM",
      icon: "receipt",
      value: compact(t.billedWithoutAm),
      valueTone: t.billedWithoutAm > 0 ? "warn" : null,
      sub: "faturas sem auto associado",
    },
    {
      label: "AM por faturar",
      icon: "pending_actions",
      value: String(t.withoutAmCount),
      valueTone: t.withoutAmCount > 0 ? "warn" : null,
      sub: `${compact(t.values.amToBill)} prontos a faturar`,
      href: "/Financeiro/faturacao/registar",
    },
    {
      label: "Sem previsão",
      icon: "report",
      value: String(t.count - t.withForecast),
      valueTone: t.count - t.withForecast > 0 ? "warn" : null,
      sub: "obras sem venda prevista",
    },
  ]);
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

const COLUMNS = [
  { key: "project", label: "Obra" },
  { key: "forecastValue", label: "Venda prevista", num: true },
  { key: "composition", label: "Composição do caderno de encargos", sortable: false },
  { key: "withAmValue", label: "AM faturados", num: true },
  { key: "withoutAmValue", label: "AM por faturar", num: true },
  { key: "billedValue", label: "Faturado", num: true },
  { key: "physicalPct", label: "% executada", num: true },
  { key: "toExecutePct", label: "% por executar", num: true },
];

function sortValue(item, key) {
  if (key === "project") return String(item.project?.name || "").toLowerCase();
  return num(item[key]);
}

function renderTable() {
  const q = state.query.trim().toLowerCase();
  const rows = state.items
    .filter((i) => state.scope === "all" || num(i.forecastValue) > 0)
    .filter((i) => !q || [i.project?.name, i.project?.code, i.project?.client?.name].some((v) => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => {
      const va = sortValue(a, state.sort.key);
      const vb = sortValue(b, state.sort.key);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return state.sort.dir === "asc" ? cmp : -cmp;
    });

  const wrap = document.getElementById("rsTable");
  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">summarize</span>${
      state.items.length ? "Nenhuma obra corresponde aos filtros." : "Sem obras para apresentar."
    }</div>`;
    return;
  }

  const head = COLUMNS.map((c) => {
    const align = c.num ? ' style="text-align:right"' : "";
    if (c.sortable === false) return `<th>${esc(c.label)}</th>`;
    const active = state.sort.key === c.key;
    const icon = active ? (state.sort.dir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more";
    return `<th${align}><button type="button" class="ov-sort ${active ? "active" : ""}" data-sort="${c.key}">${esc(c.label)}<span class="material-symbols-outlined">${icon}</span></button></th>`;
  }).join("");

  const body = rows
    .map((i) => {
      const cur = i.project?.currency;
      const hasForecast = num(i.forecastValue) > 0;
      return `
      <tr>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(i.project?.name || "—")}</span>
            <span class="ov-project-meta">${esc([i.project?.code, i.project?.client?.name].filter(Boolean).join(" · "))}</span>
          </div>
        </td>
        <td class="fin-num">${hasForecast ? esc(money(i.forecastValue, cur)) : `<span class="ov-muted">Sem previsão</span>`}</td>
        <td class="rs-comp-cell">
          ${
            hasForecast
              ? `${stackHtml(i)}
                 <div class="rs-comp-meta">
                   <span>AM ${esc(pct(num(i.amBilledPct) + num(i.amToBillPct)))}</span>
                   <span>${i.hasExecution ? `Exec. s/ AM ${esc(pct(i.executedNoAmPct))}` : `<span class="ov-muted">sem quantidades executadas</span>`}</span>
                 </div>`
              : `<span class="ov-muted">—</span>`
          }
        </td>
        <td class="fin-num">
          <div class="ov-margin-cell"><strong>${esc(money(i.withAmValue, cur))}</strong><small class="ov-muted">${i.withAmCount} auto${i.withAmCount === 1 ? "" : "s"}</small></div>
        </td>
        <td class="fin-num">
          <div class="ov-margin-cell"><strong class="${num(i.withoutAmValue) > 0 ? "ov-warn" : ""}">${esc(money(i.withoutAmValue, cur))}</strong><small class="ov-muted">${i.withoutAmCount} auto${i.withoutAmCount === 1 ? "" : "s"}</small></div>
        </td>
        <td class="fin-num">
          <div class="ov-margin-cell">
            <strong>${esc(money(i.billedValue, cur))}</strong>
            <small class="${num(i.billedWithoutAm) > 0 ? "ov-warn" : "ov-muted"}">${num(i.billedWithoutAm) > 0 ? `${esc(compact(i.billedWithoutAm))} sem AM` : hasForecast ? `${esc(pct(i.billedPct))} da previsão` : "—"}</small>
          </div>
        </td>
        <td class="fin-num"><strong>${hasForecast ? esc(pct(i.physicalPct)) : "—"}</strong></td>
        <td class="fin-num">${hasForecast ? esc(pct(i.toExecutePct)) : "—"}</td>
      </tr>`;
    })
    .join("");

  wrap.innerHTML = `
    <table class="fin-table rs-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  wrap.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort;
      state.sort = state.sort.key === key ? { key, dir: state.sort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "project" ? "asc" : "desc" };
      renderTable();
    });
  });
}

/* ─── Entrada ─────────────────────────────────────────────────────────────── */

async function load() {
  const wrap = document.getElementById("rsTable");
  if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">A carregar resumo de faturação…</div>`;
  try {
    const data = await apiRequest("/finance/billing-summary");
    state.items = data.items || [];
    const totals = portfolio(state.items);
    renderKpis(totals);
    renderPortfolio(totals);
    renderStrip(totals);
    renderTable();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o resumo de faturação.", { type: "error" });
  }
}

export async function render() {
  renderShell();
  await load();
}
