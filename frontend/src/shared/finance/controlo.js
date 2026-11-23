import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { formatCurrency } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { compactMoney as compact, destroyCharts } from "./charts.js";
import { meterHtml as meter, num, toneOf } from "./widgets.js";
import { renderEstrutura } from "./controloEstrutura.js";

/**
 * Ecrã «Controlo Financeiro» (Previsto × Realizado).
 *
 * Confronta o previsto com o realizado tendo em conta o avanço da obra:
 *  - custo esperado à data = orçamento de custo × avanço (físico; sem ele, a
 *    tabela de quantidades; em último caso, a faturação);
 *  - desvio à data = realizado − esperado (positivo = gasta acima do que devia
 *    para o que já está feito). Obras sem avanço não entram no desvio à data;
 *  - custo final previsto = realizado + comprometido, nunca abaixo do orçamento;
 *  - resultado = faturado − custo realizado, ambos sem IVA (o IVA dedutível
 *    dos pagamentos sai do custo).
 */

/** Margem realizada abaixo da prevista, em pontos percentuais, que gera aviso. */
const MARGIN_GAP_ALERT = 5;

const PROGRESS_SOURCE = {
  FISICO: "avanço físico",
  QUANTIDADES: "pelas quantidades",
  FATURACAO: "pela faturação",
  SEM_AVANCO: "sem avanço",
};

const state = {
  query: "",
  scope: "active",
  sort: "deviation",
  data: null,
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

function signed(value) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${compact(n)}`;
}

function signedPct(value) {
  const n = num(value);
  return `${n > 0 ? "+" : ""}${pct(n)}`;
}

/** Custo acima do esperado é mau (vermelho); abaixo é bom (verde). */
function costTone(value) {
  const n = num(value);
  if (n > 0.005) return "neg";
  if (n < -0.005) return "pos";
  return "muted";
}

function hasMovement(p) {
  return [p.forecastCost, p.realizedCost, p.committedCost, p.saleForecast, p.revenue].some((v) => num(v) > 0);
}

function isTracked(p) {
  return p.deviationToDate !== null && p.deviationToDate !== undefined && num(p.forecastCost) > 0;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <section class="finance-card ov-panel" id="ctrlTableCard">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Controlo por obra</h2>
            <p class="finance-chart-subtitle" id="ctrlHint">—</p>
          </div>
          <div class="ov-table-tools">
            <div class="finance-seg finance-seg--sm" id="ctrlScope">
              <button type="button" data-scope="active" class="active"><span>Com movimento</span></button>
              <button type="button" data-scope="all"><span>Todas</span></button>
            </div>
            <select id="ctrlSort" class="finance-select inv-filter" title="Ordenar">
              <option value="deviation">Maior desvio à data</option>
              <option value="eac">Maior derrapagem final</option>
              <option value="margin">Menor margem</option>
              <option value="sale">Maior venda prevista</option>
            </select>
            <label class="ov-search">
              <span class="material-symbols-outlined">search</span>
              <input id="ctrlSearch" type="search" placeholder="Obra ou código…" autocomplete="off" />
            </label>
          </div>
        </header>
        <div id="ctrlTable" class="finance-table-scroll"></div>
      </section>
      <div id="ctrlEstrutura"></div>
    </div>`;

  document.querySelectorAll("#ctrlScope button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scope = btn.dataset.scope;
      document.querySelectorAll("#ctrlScope button").forEach((b) => b.classList.toggle("active", b === btn));
      renderTable();
    });
  });
  document.getElementById("ctrlSort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderTable();
  });
  document.getElementById("ctrlSearch").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderTable();
  });
}

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function sortValue(p) {
  if (state.sort === "eac") return num(p.eacDeviation);
  if (state.sort === "margin") return num(p.revenue) > 0 ? -num(p.marginBase) : -Infinity;
  if (state.sort === "sale") return num(p.saleForecast);
  return isTracked(p) ? num(p.deviationToDate) : -Infinity;
}

function progressCell(p) {
  if (p.progressSource === "SEM_AVANCO") return `<span class="ov-muted">Sem avanço</span>`;
  return `
    <div class="ov-cell-bar">
      <span>${esc(pct(p.progressPct, 0))}</span>
      ${meter([{ value: p.progressPct, tone: "violet" }])}
      <small>${esc(PROGRESS_SOURCE[p.progressSource] || "")}</small>
    </div>`;
}

function realizedCell(p, cur) {
  const budget = num(p.forecastCost);
  const realized = num(p.realizedCost);
  const committed = num(p.committedCost);
  if (budget <= 0) {
    return realized > 0 ? `<span>${esc(money(realized, cur))}</span>` : `<span class="ov-muted">—</span>`;
  }
  const rPct = (realized / budget) * 100;
  const over = isTracked(p) && num(p.deviationToDate) > 0;
  return `
    <div class="ov-cell-bar">
      <span>${esc(money(realized, cur))}</span>
      ${meter(
        [
          { value: rPct, tone: over ? "red" : "blue" },
          { value: (committed / budget) * 100, tone: "amber-soft" },
        ],
        { marker: isTracked(p) ? p.progressPct : null, title: "Marcador = avanço da obra (onde o realizado devia estar)" }
      )}
      <small>${esc(pct(rPct))} de ${esc(compact(budget))}${committed > 0 ? ` · +${esc(compact(committed))} compr.` : ""}</small>
    </div>`;
}

function deviationCell(p) {
  if (!isTracked(p)) return `<span class="ov-muted">—</span>`;
  const tone = costTone(p.deviationToDate);
  return `
    <div class="co-dev">
      <strong class="ov-${tone}">${esc(signed(p.deviationToDate))}</strong>
      <small class="ov-${tone}">${esc(signedPct(p.deviationToDatePct))} · esperado ${esc(compact(p.expectedCost))}</small>
    </div>`;
}

function eacCell(p, cur) {
  if (num(p.forecastCost) <= 0) return `<span class="ov-muted">Sem orçamento</span>`;
  const over = num(p.eacDeviation) > 0;
  return `
    <div class="co-dev">
      <strong>${esc(money(p.eac, cur))}</strong>
      <small class="ov-${over ? "neg" : "muted"}">${over ? `${esc(signed(p.eacDeviation))} · ${esc(signedPct(p.eacDeviationPct))}` : `de ${esc(compact(p.forecastCost))}`}</small>
    </div>`;
}

function revenueCell(p, cur) {
  const sale = num(p.saleForecast);
  const revenue = num(p.revenue);
  if (sale <= 0 && revenue <= 0) return `<span class="ov-muted">—</span>`;
  if (sale <= 0) {
    return `<div class="co-dev"><strong>${esc(money(revenue, cur))}</strong><small class="ov-warn">sem venda prevista</small></div>`;
  }
  const iPct = (revenue / sale) * 100;
  return `
    <div class="ov-cell-bar">
      <span>${esc(money(revenue, cur))}</span>
      ${meter(
        [
          { value: (num(p.received) / sale) * 100, tone: "emerald" },
          { value: iPct - (num(p.received) / sale) * 100, tone: "blue" },
        ],
        { title: "Verde = recebido · azul = faturado por receber" }
      )}
      <small>${esc(pct(iPct))} de ${esc(compact(sale))}</small>
    </div>`;
}

function marginCell(p) {
  const hasRevenue = num(p.revenue) > 0;
  const hasPlan = num(p.saleForecast) > 0;
  if (!hasRevenue && !hasPlan) return `<span class="ov-muted">—</span>`;
  if (!hasRevenue) {
    return `<div class="co-dev"><span class="ov-muted">Sem faturação</span><small>prevista ${esc(pct(p.plannedMarginPct))}</small></div>`;
  }
  const below = hasPlan && num(p.plannedMarginPct) - num(p.marginBase) > MARGIN_GAP_ALERT;
  return `
    <div class="co-dev">
      <strong class="ov-${toneOf(p.resultBase)}">${esc(compact(p.resultBase))} · ${esc(pct(p.marginBase))}</strong>
      <small class="${below ? "ov-warn" : "ov-muted"}">${hasPlan ? `prevista ${esc(pct(p.plannedMarginPct))}` : "sem margem prevista"}</small>
    </div>`;
}

function renderTable() {
  const wrap = document.getElementById("ctrlTable");
  const q = state.query.trim().toLowerCase();
  const rows = (state.data?.byProject || [])
    .filter((p) => (state.scope === "active" ? hasMovement(p) : true))
    .filter((p) => !q || [p.project.name, p.project.code, p.project.client?.name].some((v) => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => sortValue(b) - sortValue(a));

  document.getElementById("ctrlHint").textContent =
    `${rows.length} obras · esperado = orçamento de custo × avanço · resultado sem IVA`;

  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">apartment</span>Sem obras para os filtros.</div>`;
    return;
  }

  const body = rows
    .map((p) => {
      const cur = p.project.currency || "AOA";
      return `
      <tr>
        <td>
          <div class="ov-project">
            <span class="ov-project-name">${esc(p.project.name)}</span>
            <span class="ov-project-meta">${esc([p.project.referencia || p.project.code, p.project.client?.name].filter(Boolean).join(" · "))}</span>
          </div>
        </td>
        <td>${progressCell(p)}</td>
        <td class="fin-num">${realizedCell(p, cur)}</td>
        <td class="fin-num">${deviationCell(p)}</td>
        <td class="fin-num">${eacCell(p, cur)}</td>
        <td class="fin-num">${revenueCell(p, cur)}</td>
        <td class="fin-num">${marginCell(p)}</td>
      </tr>`;
    })
    .join("");

  const sum = (fn) => rows.reduce((a, p) => a + fn(p), 0);
  const tDev = sum((p) => (isTracked(p) ? num(p.deviationToDate) : 0));
  const tRevenue = sum((p) => num(p.revenue));
  const tResult = sum((p) => num(p.resultBase));
  wrap.innerHTML = `
    <table class="fin-table co-table ctrl-table">
      <thead><tr>
        <th>Obra</th>
        <th>Avanço</th>
        <th style="text-align:right">Realizado</th>
        <th style="text-align:right" title="Realizado − orçamento × avanço">Desvio à data</th>
        <th style="text-align:right" title="Realizado + comprometido, nunca abaixo do orçamento">Custo final previsto</th>
        <th style="text-align:right">Faturado</th>
        <th style="text-align:right" title="Faturado − custo realizado, sem IVA">Resultado</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Totais (${rows.length} obras)</td>
        <td></td>
        <td class="fin-num">${esc(compact(sum((p) => num(p.realizedCost))))}</td>
        <td class="fin-num ov-${costTone(tDev)}">${esc(signed(tDev))}</td>
        <td class="fin-num">${esc(compact(sum((p) => num(p.eac))))}</td>
        <td class="fin-num">${esc(compact(tRevenue))}</td>
        <td class="fin-num ov-${toneOf(tResult)}">${esc(compact(tResult))}${tRevenue > 0 ? ` · ${esc(pct((tResult / tRevenue) * 100))}` : ""}</td>
      </tr></tfoot>
    </table>`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  try {
    state.data = await apiRequest("/finance/control");
    renderTable();
  } catch (err) {
    const wrap = document.getElementById("ctrlTable");
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o controlo financeiro.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  renderShell();
  // «Estrutura» e os últimos 12 meses do protótipo (V.fctl), por baixo das obras.
  await Promise.all([load(), renderEstrutura(document.getElementById("ctrlEstrutura"))]);
}
