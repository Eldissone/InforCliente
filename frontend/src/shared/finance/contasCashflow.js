import { apiRequest } from "../../services/api.js";
import { openModal, setButtonLoading, toast } from "../ui.js";
import { can } from "../permissions.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, compactMoney as compact, drawComboChart, destroyCharts, TONES } from "./charts.js";
import { kpiCardsHtml, meterHtml, num, skeletonHtml } from "./widgets.js";

/**
 * Ecrã «Cash Flow» (Financeiro · Contas a Receber e a Pagar).
 *
 * Previsão em base de caixa: faturas por receber (pelo vencimento) contra
 * contas a pagar (pelo vencimento da prestação). O que já venceu e não entrou
 * ou não saiu fica num período próprio, «Em atraso» — é dinheiro que conta
 * mas cuja data já não é fiável. Os compromissos (encomendas abertas, pedidos
 * extra por aprovar) só entram se o utilizador os quiser ver.
 *
 * Parte do saldo bancário atual (último extrato ou acerto de cada conta, mais
 * os movimentos seguintes); a linha é o saldo projetado no fim de cada período.
 * Contas sem saldo registado usam o saldo do cartão e ficam assinaladas.
 */

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DAY_MS = 24 * 60 * 60 * 1000;

const state = { horizon: "weeks", commitments: false, data: null, open: new Set() };

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function startOfDay(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/* ─── Períodos ────────────────────────────────────────────────────────────── */

/** Períodos do horizonte (12 semanas a começar à segunda-feira, ou 6 meses). */
function buildPeriods() {
  const today = startOfDay(new Date());
  const periods = [];
  if (state.horizon === "weeks") {
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    for (let i = 0; i < 12; i += 1) {
      const start = new Date(monday.getTime() + i * 7 * DAY_MS);
      const end = new Date(start.getTime() + 7 * DAY_MS);
      const last = new Date(end.getTime() - DAY_MS);
      periods.push({
        key: `w${i}`,
        label: i === 0 ? "Esta semana" : `${start.getDate()} ${MONTHS[start.getMonth()]}`,
        long: `${dateOnly(start)} – ${dateOnly(last)}`,
        start,
        end,
      });
    }
  } else {
    for (let i = 0; i < 6; i += 1) {
      const start = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const end = new Date(today.getFullYear(), today.getMonth() + i + 1, 1);
      periods.push({
        key: `m${i}`,
        label: `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}`,
        long: i === 0 ? "Mês corrente (a partir de hoje)" : `${MONTHS[start.getMonth()]} ${start.getFullYear()}`,
        start,
        end,
      });
    }
  }
  return periods;
}

/**
 * Distribui entradas e saídas pelos períodos:
 *  late    → venceu antes de hoje e ainda está em aberto;
 *  periods → dentro do horizonte;
 *  later   → depois do horizonte;
 *  noDate  → sem data de vencimento (só saídas — faturas usam a data do documento).
 */
function buildBuckets() {
  const today = startOfDay(new Date());
  const periods = buildPeriods();
  const blank = (extra) => ({ inflow: 0, outflow: 0, inItems: [], outItems: [], ...extra });
  const late = blank({ key: "late", label: "Em atraso", long: "Venceu e ainda não entrou / saiu" });
  const later = blank({ key: "later", label: "Depois", long: `Depois de ${dateOnly(new Date(periods.at(-1).end.getTime() - DAY_MS))}` });
  const noDate = blank({ key: "noDate", label: "Sem data", long: "Contas sem data de vencimento" });
  const rows = periods.map((p) => blank(p));
  const horizonEnd = periods.at(-1).end;

  const place = (date) => {
    if (!date) return noDate;
    const d = startOfDay(date);
    if (d < today) return late;
    if (d >= horizonEnd) return later;
    return rows.find((p) => d >= p.start && d < p.end) || later;
  };

  (state.data?.inflows || []).forEach((i) => {
    const b = place(i.date);
    b.inflow += num(i.amount);
    b.inItems.push(i);
  });
  (state.data?.outflows || [])
    .filter((o) => state.commitments || o.stage !== "COMPROMISSO")
    .forEach((o) => {
      const b = place(o.date);
      b.outflow += num(o.amount);
      b.outItems.push(o);
    });

  // Saldo projetado: parte do saldo bancário atual; o atraso conta já (assume-se
  // que é regularizado agora) e depois segue o horizonte.
  const opening = num(state.data?.balances?.total);
  let running = opening;
  [late, ...rows].forEach((b) => {
    b.net = b.inflow - b.outflow;
    running += b.net;
    b.cumulative = running;
  });
  later.net = later.inflow - later.outflow;
  noDate.net = noDate.inflow - noDate.outflow;
  return { opening, late, rows, later, noDate };
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div class="ov">
      <div class="fl-toolbar">
        <div class="finance-seg finance-seg--sm" id="cfHorizon">
          <button type="button" data-horizon="weeks" class="active"><span class="material-symbols-outlined">view_week</span>12 semanas</button>
          <button type="button" data-horizon="months"><span class="material-symbols-outlined">calendar_month</span>6 meses</button>
        </div>
        <label class="fl-switch">
          <span class="inv-switch"><input type="checkbox" id="cfCommitments" /><span></span></span>
          <span>Incluir compromissos <small>encomendas abertas e pedidos por aprovar</small></span>
        </label>
      </div>

      <div id="cfKpis" class="ov-kpis">${skeletonHtml(4, "kpi")}</div>

      ${chartCardHtml({
        id: "cfChartForecast",
        title: "Previsão de tesouraria",
        subtitle: "Entradas e saídas previstas pelo vencimento · linha = saldo bancário projetado",
        height: 300,
        beforeChartHtml: `<div id="cfForecastTotals" class="ov-flow-totals"></div>`,
      })}

      <section class="finance-card ov-panel">
        <header class="finance-chart-head">
          <h2 class="finance-chart-title">Períodos</h2>
          <p class="finance-chart-subtitle">Clique num período para ver o que entra e sai</p>
        </header>
        <div id="cfPeriods" class="finance-table-scroll">${skeletonHtml(5, "line")}</div>
      </section>

      <div class="ov-row ov-row--6-6">
        <section class="finance-card ov-panel">
          <header class="finance-chart-head finance-chart-head--row">
            <div>
              <h2 class="finance-chart-title">Contas bancárias</h2>
              <p class="finance-chart-subtitle">Saldo de partida da previsão</p>
            </div>
            ${canEditBalances() ? `<button type="button" class="cr-act cr-act--slate" id="cfSetBalance"><span class="material-symbols-outlined">edit</span><span>Acertar saldo</span></button>` : ""}
          </header>
          <div id="cfBalances">${skeletonHtml(3, "line")}</div>
        </section>
        ${chartCardHtml({
          id: "cfChartHistory",
          title: "Últimos 6 meses",
          subtitle: "O que realmente entrou e saiu da caixa · linha = líquido do mês",
          height: 260,
        })}
      </div>

      <section class="finance-card ov-panel">
        <header class="finance-chart-head finance-chart-head--row">
          <div>
            <h2 class="finance-chart-title">Posição por obra</h2>
            <p class="finance-chart-subtitle">A receber contra a pagar · saldo negativo = a obra está a consumir caixa</p>
          </div>
        </header>
        <div id="cfProjects" class="finance-table-scroll">${skeletonHtml(4, "line")}</div>
      </section>
    </div>`;

  document.querySelectorAll("#cfHorizon button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.horizon = btn.dataset.horizon;
      state.open.clear();
      document.querySelectorAll("#cfHorizon button").forEach((b) => b.classList.toggle("active", b === btn));
      renderForecast();
    });
  });
  document.getElementById("cfSetBalance")?.addEventListener("click", () => openBalanceModal());
  document.getElementById("cfCommitments").addEventListener("change", (e) => {
    state.commitments = e.target.checked;
    renderForecast();
    renderProjects();
  });
}

/* ─── Indicadores e previsão ──────────────────────────────────────────────── */

function renderKpis(b) {
  const bal = state.data?.balances || {};
  const inflow = b.rows.reduce((a, r) => a + r.inflow, 0);
  const outflow = b.rows.reduce((a, r) => a + r.outflow, 0);
  const horizonLabel = state.horizon === "weeks" ? "12 semanas" : "6 meses";
  const end = b.rows.at(-1)?.cumulative ?? b.opening;
  const lowest = [b.late, ...b.rows].reduce((min, r) => (r.cumulative < min.cumulative ? r : min), b.late);
  const balanceNote = bal.estimated
    ? (bal.items || []).some((i) => i.source !== "CARTAO")
      ? "Algumas contas sem extrato: usa o saldo do cartão."
      : "Sem extrato importado: saldo dos cartões."
    : bal.asOf
      ? `Último extrato / acerto: ${dateOnly(bal.asOf)}.`
      : "Sem contas bancárias ativas.";
  const cards = [
    {
      key: "balance",
      label: "Saldo bancário",
      icon: "account_balance",
      tone: b.opening >= 0 ? "blue" : "red",
      value: money(b.opening),
      badge: `${(bal.items || []).length} conta${(bal.items || []).length === 1 ? "" : "s"}`,
      badgeTone: bal.estimated ? "amber" : "blue",
      body: `<p class="ov-kpi-compare ${bal.estimated ? "ov-warn" : ""}">${esc(balanceNote)}</p>`,
    },
    {
      key: "in",
      label: `Entradas · ${horizonLabel}`,
      icon: "south_west",
      tone: "emerald",
      value: money(inflow),
      badge: `${b.rows.reduce((a, r) => a + r.inItems.length, 0)} faturas`,
      badgeTone: "emerald",
      body: `<p class="ov-kpi-compare">Faturas que vencem no horizonte${b.late.inflow ? ` · <span class="ov-warn">+ ${esc(compact(b.late.inflow))} em atraso</span>` : ""}.</p>`,
    },
    {
      key: "out",
      label: `Saídas · ${horizonLabel}`,
      icon: "north_east",
      tone: "red",
      value: money(outflow),
      badge: `${b.rows.reduce((a, r) => a + r.outItems.length, 0)} contas`,
      badgeTone: "red",
      body: `<p class="ov-kpi-compare">Contas a pagar${state.commitments ? " e compromissos" : ""}${b.late.outflow ? ` · <span class="ov-neg">− ${esc(compact(b.late.outflow))} em atraso</span>` : ""}.</p>`,
    },
    {
      key: "end",
      label: "Saldo no fim",
      icon: "flag",
      tone: end >= 0 ? "emerald" : "red",
      value: money(end),
      badge: lowest.cumulative < 0 ? "fica negativo" : "sempre positivo",
      badgeTone: lowest.cumulative < 0 ? "red" : "emerald",
      body: `<p class="ov-kpi-compare">${
        lowest.cumulative < 0
          ? `Mínimo <strong class="ov-neg">${esc(compact(lowest.cumulative))}</strong> · ${esc(lowest.label.toLowerCase())}.`
          : `Mínimo ${esc(compact(lowest.cumulative))} · ${esc(lowest.label.toLowerCase())}.`
      }</p>`,
    },
  ];
  document.getElementById("cfKpis").innerHTML = kpiCardsHtml(cards, "cf");
}

function itemListHtml(items, kind) {
  if (!items.length) return `<p class="fl-none">${kind === "in" ? "Sem entradas." : "Sem saídas."}</p>`;
  const top = [...items].sort((a, b) => num(b.amount) - num(a.amount));
  const shown = top.slice(0, 8);
  return `
    <ul class="fl-items">
      ${shown
        .map(
          (i) => `
        <li>
          <div>
            <strong>${esc(i.party || i.label || "—")}</strong>
            <small>${esc([kind === "in" ? `Fatura ${i.label}` : i.label, i.project?.name, i.stage === "COMPROMISSO" ? "compromisso" : null].filter(Boolean).join(" · "))}</small>
          </div>
          <div class="fl-items-value">
            <strong class="${kind === "in" ? "ov-pos" : "ov-neg"}">${kind === "in" ? "+" : "−"} ${esc(compact(i.amount))}</strong>
            <small>${esc(i.date ? dateOnly(i.date) : "sem data")}</small>
          </div>
        </li>`
        )
        .join("")}
    </ul>
    ${top.length > shown.length ? `<p class="fl-none">+ ${top.length - shown.length} outros · ${esc(compact(top.slice(8).reduce((a, i) => a + num(i.amount), 0)))}</p>` : ""}`;
}

function renderPeriods(b) {
  const rows = [b.late, ...b.rows, b.later, ...(b.noDate.outItems.length ? [b.noDate] : [])];
  const wrap = document.getElementById("cfPeriods");
  wrap.innerHTML = `
    <table class="fin-table fl-table">
      <thead><tr>
        <th>Período</th>
        <th style="text-align:right">Entradas</th>
        <th style="text-align:right">Saídas</th>
        <th style="text-align:right">Líquido</th>
        <th style="text-align:right">Saldo</th>
      </tr></thead>
      <tbody>
        <tr class="fl-period fl-period--start">
          <td><div class="fl-period-name"><span class="material-symbols-outlined fl-caret">account_balance</span><div><strong>Saldo atual</strong><small>Contas bancárias hoje</small></div></div></td>
          <td></td><td></td><td></td>
          <td class="fin-num ${b.opening < 0 ? "ov-neg" : ""}"><strong>${esc(compact(b.opening))}</strong></td>
        </tr>${rows
        .map((r) => {
          const empty = !r.inItems.length && !r.outItems.length;
          const open = state.open.has(r.key);
          const outside = r.key === "later" || r.key === "noDate";
          return `
          <tr class="fl-period ${r.key === "late" ? "fl-period--late" : ""} ${outside ? "fl-period--outside" : ""} ${empty ? "" : "fl-period--click"}" data-key="${r.key}">
            <td>
              <div class="fl-period-name">
                ${empty ? `<span class="fl-caret"></span>` : `<span class="material-symbols-outlined fl-caret">${open ? "expand_more" : "chevron_right"}</span>`}
                <div><strong>${esc(r.label)}</strong><small>${esc(r.long)}</small></div>
              </div>
            </td>
            <td class="fin-num ${r.inflow ? "ov-pos" : "ov-muted"}">${r.inflow ? esc(compact(r.inflow)) : "—"}</td>
            <td class="fin-num ${r.outflow ? "ov-neg" : "ov-muted"}">${r.outflow ? esc(compact(r.outflow)) : "—"}</td>
            <td class="fin-num ${r.net > 0 ? "ov-pos" : r.net < 0 ? "ov-neg" : "ov-muted"}"><strong>${r.net ? esc(compact(r.net)) : "—"}</strong></td>
            <td class="fin-num ${outside ? "ov-muted" : r.cumulative < 0 ? "ov-neg" : ""}">${outside ? "fora" : esc(compact(r.cumulative))}</td>
          </tr>
          ${
            open
              ? `<tr class="fl-detail"><td colspan="5">
                  <div class="fl-detail-grid">
                    <div><h4><span class="material-symbols-outlined">south_west</span>Entradas</h4>${itemListHtml(r.inItems, "in")}</div>
                    <div><h4><span class="material-symbols-outlined">north_east</span>Saídas</h4>${itemListHtml(r.outItems, "out")}</div>
                  </div>
                </td></tr>`
              : ""
          }`;
        })
        .join("")}</tbody>
    </table>`;
  wrap.querySelectorAll(".fl-period--click").forEach((tr) => {
    tr.addEventListener("click", () => {
      const key = tr.dataset.key;
      if (state.open.has(key)) state.open.delete(key);
      else state.open.add(key);
      renderPeriods(b);
    });
  });
}

function renderForecast() {
  const b = buildBuckets();
  renderKpis(b);
  const chartRows = [b.late, ...b.rows];
  const inflow = b.rows.reduce((a, r) => a + r.inflow, 0);
  const outflow = b.rows.reduce((a, r) => a + r.outflow, 0);
  const lowest = chartRows.reduce((min, r) => (r.cumulative < min.cumulative ? r : min), chartRows[0]);
  document.getElementById("cfForecastTotals").innerHTML = [
    { label: "Saldo atual", value: compact(b.opening), dot: TONES.blue },
    { label: "Entradas / saídas", value: `+${compact(inflow)} / −${compact(outflow)}`, dot: TONES.emerald },
    { label: "Ponto mais baixo", value: `${compact(lowest.cumulative)} · ${lowest.label}`, dot: lowest.cumulative < 0 ? TONES.red : TONES.slate },
    { label: "Depois do horizonte", value: `+${compact(b.later.inflow)} / −${compact(b.later.outflow)}`, dot: TONES.slate },
  ]
    .map((t) => `<div class="ov-flow-total"><span><i style="background:${t.dot}"></i>${esc(t.label)}</span><strong>${esc(t.value)}</strong></div>`)
    .join("");
  drawComboChart("cfChartForecast", {
    categories: chartRows.map((r) => r.label),
    series: [
      { name: "Entradas", type: "column", data: chartRows.map((r) => Math.round(r.inflow)), color: TONES.emerald },
      { name: "Saídas", type: "column", data: chartRows.map((r) => Math.round(r.outflow)), color: TONES.red },
      { name: "Saldo projetado", type: "line", data: chartRows.map((r) => Math.round(r.cumulative)), color: TONES.blue },
    ],
    height: 300,
  });
  renderPeriods(b);
}

/* ─── Contas bancárias ────────────────────────────────────────────────────── */

const BALANCE_SOURCE = { EXTRATO: "Extrato", MANUAL: "Acerto manual", CARTAO: "Saldo do cartão" };

function canEditBalances() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

function renderBalances() {
  const bal = state.data?.balances || {};
  const items = bal.items || [];
  const wrap = document.getElementById("cfBalances");
  if (!items.length) {
    wrap.innerHTML = `<div class="ov-empty"><span class="material-symbols-outlined">account_balance</span>Sem contas / cartões bancários ativos.</div>`;
    return;
  }
  wrap.innerHTML = `
    <ul class="ac-feed">
      ${items
        .map(
          (i) => `
        <li>
          <span class="ac-feed-icon ${i.source === "CARTAO" ? "ac-feed-icon--muted" : "ac-feed-icon--out"}"><span class="material-symbols-outlined">${i.source === "CARTAO" ? "credit_card" : "account_balance"}</span></span>
          <div>
            <strong>${esc(i.card.label)}${i.card.lastDigits ? ` · ••${esc(i.card.lastDigits)}` : ""}</strong>
            <small>${esc(
              [
                i.card.bank,
                i.project?.name,
                BALANCE_SOURCE[i.source] + (i.asOf ? ` de ${dateOnly(i.asOf)}` : ""),
                i.movementsAfter ? `+${i.movementsAfter} mov.` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            )}</small>
          </div>
          <div class="ac-feed-value">
            <strong class="${i.balance < 0 ? "ov-neg" : ""}">${esc(money(i.balance, i.currency))}</strong>
            ${canEditBalances() ? `<button type="button" class="fl-link" data-card="${esc(i.card.id)}">acertar</button>` : ""}
          </div>
        </li>`
        )
        .join("")}
    </ul>
    <div class="fl-balance-total"><span>Total</span><strong>${esc(money(bal.total))}</strong></div>`;
  wrap.querySelectorAll("[data-card]").forEach((btn) => btn.addEventListener("click", () => openBalanceModal(btn.dataset.card)));
}

function openBalanceModal(cardId = "") {
  const items = state.data?.balances?.items || [];
  if (!items.length) return toast("Não há contas / cartões bancários ativos.", { type: "error" });
  const today = toDateKey(new Date());
  const current = (id) => items.find((i) => i.card.id === id);
  openModal({
    title: "Acertar saldo bancário",
    width: 560,
    contentHtml: `
      <p class="pay-note"><span class="material-symbols-outlined">info</span><span>
        Indique o saldo que o banco mostra numa data. A partir daí o sistema soma os movimentos
        dos extratos importados. Ao importar um extrato com saldo final, o saldo é atualizado sozinho.
      </span></p>
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field" style="grid-column: 1 / -1">
          <label class="finance-label" for="bal_card">Conta / cartão <span class="inv-req">*</span></label>
          <select id="bal_card" class="finance-select">
            ${items
              .map(
                (i) =>
                  `<option value="${esc(i.card.id)}" ${i.card.id === cardId ? "selected" : ""}>${esc([i.card.label, i.card.bank].filter(Boolean).join(" · "))}</option>`
              )
              .join("")}
          </select>
          <small class="pay-hint" id="bal_current"></small>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="bal_value">Saldo <span class="inv-req">*</span></label>
          <input id="bal_value" class="finance-input" type="number" step="0.01" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="bal_date">Data do saldo <span class="inv-req">*</span></label>
          <input id="bal_date" class="finance-input" type="date" max="${today}" value="${today}" />
        </div>
        <div class="finance-field" style="grid-column: 1 / -1">
          <label class="finance-label" for="bal_notes">Notas</label>
          <input id="bal_notes" class="finance-input" type="text" placeholder="Ex.: saldo do homebanking" />
        </div>
      </div>`,
    primaryLabel: "Guardar saldo",
    onRender: ({ panel }) => {
      const sync = () => {
        const i = current(panel.querySelector("#bal_card").value);
        panel.querySelector("#bal_current").textContent = i
          ? `Hoje: ${money(i.balance, i.currency)} (${BALANCE_SOURCE[i.source]}${i.asOf ? ` de ${dateOnly(i.asOf)}` : ""})`
          : "";
      };
      panel.querySelector("#bal_card").addEventListener("change", sync);
      sync();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const value = panel.querySelector("#bal_value").value;
      const date = panel.querySelector("#bal_date").value;
      if (value === "" || !Number.isFinite(Number(value))) return toast("Indique o saldo.", { type: "error" });
      if (!date) return toast("Indique a data do saldo.", { type: "error" });
      if (date > today) return toast("A data do saldo não pode ser futura.", { type: "error" });
      setButtonLoading(btn, true);
      try {
        // Fim do dia: os movimentos desse dia já estão refletidos no saldo indicado.
        const end = new Date(`${date}T23:59:59`);
        const res = await apiRequest("/finance/treasury/balances", {
          method: "POST",
          body: {
            cardId: panel.querySelector("#bal_card").value,
            balance: Number(value),
            balanceDate: (end > new Date() ? new Date() : end).toISOString(),
            notes: panel.querySelector("#bal_notes").value.trim() || null,
          },
        });
        state.data.balances = res.balances;
        toast("Saldo atualizado.", { type: "success" });
        close();
        renderBalances();
        renderForecast();
      } catch (err) {
        toast(err.message || "Não foi possível guardar o saldo.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

function renderHistory() {
  const history = state.data?.history || [];
  drawComboChart("cfChartHistory", {
    categories: history.map((m) => m.label),
    series: [
      { name: "Entrou", type: "column", data: history.map((m) => num(m.inflow)), color: TONES.emerald },
      { name: "Saiu", type: "column", data: history.map((m) => num(m.outflow)), color: TONES.red },
      { name: "Líquido", type: "line", data: history.map((m) => num(m.net)), color: TONES.blue },
    ],
    height: 300,
  });
}

/* ─── Posição por obra ────────────────────────────────────────────────────── */

function renderProjects() {
  const map = new Map();
  const ensure = (project) => {
    const key = project?.id || "__none__";
    if (!map.has(key)) map.set(key, { name: project?.name || "Sem obra", code: project?.code || "", receive: 0, receiveLate: 0, pay: 0, payLate: 0 });
    return map.get(key);
  };
  (state.data?.inflows || []).forEach((i) => {
    const r = ensure(i.project);
    r.receive += num(i.amount);
    if (i.daysLate > 0) r.receiveLate += num(i.amount);
  });
  (state.data?.outflows || [])
    .filter((o) => state.commitments || o.stage !== "COMPROMISSO")
    .forEach((o) => {
      const r = ensure(o.project);
      r.pay += num(o.amount);
      if (o.daysLate > 0) r.payLate += num(o.amount);
    });
  const rows = [...map.values()].map((r) => ({ ...r, balance: r.receive - r.pay })).sort((a, b) => a.balance - b.balance);
  const wrap = document.getElementById("cfProjects");
  if (!rows.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">balance</span>Sem valores em aberto por obra.</div>`;
    return;
  }
  const max = Math.max(...rows.map((r) => Math.max(r.receive, r.pay)), 1);
  const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
  wrap.innerHTML = `
    <table class="fin-table fl-table">
      <thead><tr>
        <th>Obra</th>
        <th style="text-align:right">A receber</th>
        <th style="text-align:right">A pagar</th>
        <th class="fl-col-bars">Exposição</th>
        <th style="text-align:right">Saldo</th>
      </tr></thead>
      <tbody>${rows
        .map(
          (r) => `
        <tr>
          <td><div class="ov-project"><span class="ov-project-name">${esc(r.name)}</span><span class="ov-project-meta">${esc(r.code)}</span></div></td>
          <td class="fin-num">
            <div class="ov-cell-bar"><span class="ov-pos">${esc(money(r.receive))}</span>${r.receiveLate > 0 ? `<small class="ov-warn">${esc(compact(r.receiveLate))} vencido</small>` : ""}</div>
          </td>
          <td class="fin-num">
            <div class="ov-cell-bar"><span class="ov-neg">${esc(money(r.pay))}</span>${r.payLate > 0 ? `<small class="ov-neg">${esc(compact(r.payLate))} vencido</small>` : ""}</div>
          </td>
          <td class="fl-col-bars">
            <div class="fl-bars">
              <i class="fl-bar fl-bar--in" style="width:${((r.receive / max) * 100).toFixed(1)}%"></i>
              <i class="fl-bar fl-bar--out" style="width:${((r.pay / max) * 100).toFixed(1)}%"></i>
            </div>
          </td>
          <td class="fin-num ${r.balance >= 0 ? "ov-pos" : "ov-neg"}"><strong>${esc(money(r.balance))}</strong></td>
        </tr>`
        )
        .join("")}</tbody>
      <tfoot><tr>
        <td>Totais (${rows.length} obras)</td>
        <td class="fin-num">${esc(money(sum("receive")))}</td>
        <td class="fin-num">${esc(money(sum("pay")))}</td>
        <td class="fl-col-bars"></td>
        <td class="fin-num">${esc(money(sum("balance")))}</td>
      </tr></tfoot>
    </table>`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function load() {
  try {
    state.data = await apiRequest("/finance/cash-flow?months=6");
    renderBalances();
    renderForecast();
    renderHistory();
    renderProjects();
  } catch (err) {
    const wrap = document.getElementById("cfPeriods");
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o cash flow.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  const horizon = new URLSearchParams(window.location.search).get("horizon");
  if (horizon === "months" || horizon === "weeks") state.horizon = horizon;
  renderShell();
  document.querySelectorAll("#cfHorizon button").forEach((b) => b.classList.toggle("active", b.dataset.horizon === state.horizon));
  await load();
}
