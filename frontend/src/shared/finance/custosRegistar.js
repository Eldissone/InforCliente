import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, drawAreaChart, drawDonutChart, destroyCharts, TONES } from "./charts.js";

/**
 * Ecrã «Registar Custos» (Financeiro · Custos).
 *
 * Lista TODOS os custos da plataforma numa só tabela, com a fonte identificada:
 * pagamentos/cotações, pedidos extra, lançamentos de obra e pedidos de compra.
 * Os custos realizados mostram o estado «Por confirmar / Confirmado» e podem
 * ser confirmados pelo financeiro.
 */

const CATEGORY = {
  MATERIAL: "Material",
  SERVICO: "Serviço",
  MAO_DE_OBRA: "Mão de Obra",
  EQUIPAMENTO: "Equipamento",
  TRANSPORTE: "Transporte",
  ADMINISTRATIVO: "Administrativo",
  OUTRO: "Outro",
};

const SOURCE_TONE = {
  PAGAMENTO: "blue",
  PEDIDO_EXTRA: "violet",
  LANCAMENTO: "amber",
  PEDIDO_COMPRA: "emerald",
  FRETE: "slate",
};

const SOURCE_DETAIL = {
  MERCADORIA_STOCK: "Stock (mercadoria)",
  PAGAMENTO_DIRETO: "Pagamento direto",
  ATM: "ATM",
  MANUAL: "Manual",
};

const state = {
  filters: { projectId: "", status: "", source: "" },
  projects: [],
  suppliers: [],
  sources: [],
  items: [],
  totals: null,
  charts: null,
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function canEdit() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

function canApprove() {
  return can("financeiro", "approve") || can("financeiro", "manage");
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function sourceChip(entry) {
  const tone = SOURCE_TONE[entry.source] || "";
  const detail = SOURCE_DETAIL[entry.detail] ? ` · ${SOURCE_DETAIL[entry.detail]}` : "";
  return `<span class="finance-chip ${tone ? `finance-chip--${tone}` : ""}">${esc(
    `${entry.sourceLabel || entry.source}${detail}`
  )}</span>`;
}

function confirmBadge(status) {
  if (status === "CONFIRMADO") {
    return `<span class="finance-badge finance-badge--emerald">Confirmado</span>`;
  }
  return `<span class="finance-badge finance-badge--amber">Por confirmar</span>`;
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `
    <div id="costKpis" class="finance-kpi-grid"></div>

    <div class="finance-chart-grid">
      ${chartCardHtml({
        id: "crChartMonthly",
        title: "Custos mês a mês",
        subtitle: "Custo pago e valor por liquidar nos últimos 12 meses",
        hint: "“Custo pago” é dinheiro que já saiu; “por liquidar” é o que está assumido mas ainda não foi pago.",
        span: 2,
        height: 300,
      })}
      ${chartCardHtml({
        id: "crChartSources",
        title: "Custos por fonte",
        subtitle: "Origem de cada custo no filtro actual",
        height: 290,
      })}
      ${chartCardHtml({
        id: "crChartAging",
        title: "Por pagar por antiguidade",
        subtitle: "Valor em falta pela data do custo",
        height: 290,
      })}
    </div>

    <section class="finance-card" style="margin-bottom:1.5rem">
      <div class="finance-chart-head">
        <h2 class="finance-chart-title">Como é que um custo chega aqui?</h2>
        <p class="finance-chart-subtitle">
          Esta página reúne todos os custos da plataforma num só sítio e serve para o financeiro os confirmar.
          Nada é duplicado: cada custo aparece uma única vez, com a área de onde veio identificada.
        </p>
      </div>
      <ul class="finance-steps">
        <li><span class="material-symbols-outlined">shopping_cart</span><span><strong>Pagamento / Cotação</strong> — aprovado no Centro de Compras ou lançado no centro de custo da obra. Entra no custo realizado assim que o valor é pago.</span></li>
        <li><span class="material-symbols-outlined">request_quote</span><span><strong>Pedido Extra</strong> — aprovado na obra ou no Centro de Compras. Fica comprometido e passa a realizado quando é pago.</span></li>
        <li><span class="material-symbols-outlined">receipt_long</span><span><strong>Lançamento de Obra</strong> — despesa registada no diário financeiro da obra, já paga ou por liquidar.</span></li>
        <li><span class="material-symbols-outlined">assignment</span><span><strong>Pedido de Compra</strong> — encomenda ainda aberta. Conta como comprometido até chegar a pagamento.</span></li>
        <li><span class="material-symbols-outlined">local_shipping</span><span><strong>Frete</strong> — alocação por obra que ainda não foi enviada ao financeiro.</span></li>
      </ul>
      <p class="finance-note" style="margin-top:0.85rem">
        Custos que nascem fora destas áreas (rendas, serviços pontuais, despesas administrativas ou pagamentos
        já feitos ao balcão) registam-se aqui com <strong>«Novo Custo»</strong>: escolhe-se a obra, o centro de custo
        e indica-se o valor total e o que já foi pago.
      </p>
    </section>

    <section class="finance-card">
      <div class="fin-toolbar" style="margin-bottom:1rem">
        <div class="fin-toolbar-filters">
          <select id="costProject" class="finance-select fin-proj-filter"></select>
          <select id="costStatus" class="finance-select">
            <option value="">Todos os estados</option>
            <option value="POR_CONFIRMAR">Por confirmar</option>
            <option value="CONFIRMADO">Confirmado</option>
          </select>
          <select id="costSource" class="finance-select">
            <option value="">Todas as fontes</option>
          </select>
          <button id="costClear" type="button" class="finance-btn finance-btn--ghost">
            <span class="material-symbols-outlined">filter_alt_off</span>Limpar
          </button>
        </div>
      </div>
      <p class="finance-hint">
        Todos os custos da plataforma estão ligados aqui: pagamentos e prestações de fornecedor,
        pedidos extra (caixa, banco e fundo de maneio), lançamentos de obra e pedidos de compra.
        A mercadoria entra pelo custo da compra, não pela saída de stock.
      </p>
      <div id="costTable" class="finance-table-scroll"></div>
    </section>`;

  const projectSel = document.getElementById("costProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.projects
      .map((p) => `<option value="${esc(p.id)}">${esc(p.code ? `${p.code} — ${p.name}` : p.name)}</option>`)
      .join("");

  const sourceSel = document.getElementById("costSource");
  sourceSel.innerHTML =
    `<option value="">Todas as fontes</option>` +
    state.sources.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join("");
  sourceSel.value = state.filters.source;

  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    load();
  });
  document.getElementById("costStatus").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    load();
  });
  sourceSel.addEventListener("change", (e) => {
    state.filters.source = e.target.value;
    load();
  });
  document.getElementById("costClear").addEventListener("click", () => {
    state.filters = { projectId: "", status: "", source: "" };
    projectSel.value = "";
    document.getElementById("costStatus").value = "";
    sourceSel.value = "";
    load();
  });

  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = canEdit()
      ? `<button id="costNew" type="button" class="finance-btn finance-btn--primary">
           <span class="material-symbols-outlined">add</span>Novo Custo
         </button>`
      : "";
    document.getElementById("costNew")?.addEventListener("click", openManualCostModal);
  }
}

function renderKpis() {
  const t = state.totals || {};
  const cards = [
    { label: "Custos Realizados", value: money(t.realized), sub: "Valor pago em todas as fontes", tone: "blue", icon: "payments" },
    { label: "Confirmados", value: money(t.confirmed), sub: "Custos confirmados pelo financeiro", tone: "emerald", icon: "verified" },
    { label: "Por Confirmar", value: money(t.pending), sub: "Aguarda confirmação", tone: "amber", icon: "pending_actions" },
    { label: "Lançamentos", value: String(state.items.length), sub: "No filtro actual", tone: "slate", icon: "list_alt" },
  ];
  document.getElementById("costKpis").innerHTML = cards
    .map(
      (c) => `
      <div class="finance-kpi finance-kpi--${c.tone}">
        <span class="finance-kpi-label">
          <span class="material-symbols-outlined" style="font-size:15px">${c.icon}</span>${esc(c.label)}
        </span>
        <span class="finance-kpi-value">${esc(c.value)}</span>
        <span class="finance-kpi-sub">${esc(c.sub)}</span>
      </div>`
    )
    .join("");
}

function renderTable() {
  const wrap = document.getElementById("costTable");
  if (!state.items.length) {
    wrap.innerHTML = `<div class="finance-empty"><span class="material-symbols-outlined">request_quote</span>Sem custos para os filtros selecionados.</div>`;
    return;
  }
  const editable = canEdit();
  const rows = state.items
    .map((c) => {
      const cur = c.currency || c.project?.currency || "AOA";
      const supplier = c.supplierRef?.name || c.supplier || "—";
      const isPayment = c.source === "PAGAMENTO";
      return `
      <tr data-id="${esc(c.id)}">
        <td>${esc(dateOnly(c.date))}</td>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(c.project?.name || "—")}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(c.project?.code || "")}</div>
        </td>
        <td>${esc(c.costCenter?.name || "—")}</td>
        <td>${esc(supplier)}</td>
        <td style="max-width:260px">
          <div style="font-weight:600;color:#0f172a">${esc(c.description || "—")}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(c.docNumber || "")}</div>
        </td>
        <td>${esc(CATEGORY[c.category] || c.category || "—")}</td>
        <td>${sourceChip(c)}</td>
        <td class="fin-num">${esc(money(c.paidAmount, cur))}</td>
        <td class="fin-num ${Number(c.remaining) > 0 ? "finance-muted" : ""}">${esc(money(c.remaining, cur))}</td>
        <td>${confirmBadge(c.confirmationStatus)}</td>
        <td>${c.responsible ? esc(c.responsible) : '<span class="fin-empty-cell">—</span>'}</td>
        <td>
          <div class="fin-actions">
            ${
              editable
                ? `${
                    isPayment && c.confirmationStatus !== "CONFIRMADO" && canApprove()
                      ? `<button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Confirmar custo" data-action="confirm">
                           <span class="material-symbols-outlined" style="font-size:17px">done</span>
                         </button>`
                      : ""
                  }
                   ${
                     isPayment
                       ? `<button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Detalhe do pagamento" data-action="edit">
                            <span class="material-symbols-outlined" style="font-size:17px">edit</span>
                          </button>`
                       : `<span class="fin-empty-cell" title="Gerido na área de origem">—</span>`
                   }`
                : `<span class="fin-empty-cell">—</span>`
            }
          </div>
        </td>
      </tr>`;
    })
    .join("");

  const t = state.totals || {};
  wrap.innerHTML = `
    <table class="fin-table" style="min-width:1450px">
      <thead>
        <tr>
          <th>Data</th><th>Obra</th><th>Centro de Custo</th><th>Fornecedor</th><th>Descrição</th>
          <th>Categoria</th><th>Fonte</th><th style="text-align:right">V. Pago</th>
          <th style="text-align:right">Por Liquidar</th><th>Confirmação</th>
          <th>Responsável</th><th style="text-align:center">Ações</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="7">Totais (${state.items.length} lançamentos)</td>
          <td class="fin-num">${esc(money(t.realized))}</td>
          <td colspan="4"></td>
        </tr>
      </tfoot>
    </table>`;

  wrap.querySelectorAll("tbody tr").forEach((tr) => {
    const cost = state.items.find((c) => c.id === tr.dataset.id);
    if (!cost) return;
    tr.querySelector('[data-action="edit"]')?.addEventListener("click", () => openCostModal(cost, false));
    tr.querySelector('[data-action="confirm"]')?.addEventListener("click", () => openCostModal(cost, true));
  });
}

async function load() {
  const wrap = document.getElementById("costTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar custos…</div>`;
  const params = new URLSearchParams();
  Object.entries(state.filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  try {
    const data = await apiRequest(`/finance/costs?${params.toString()}`);
    state.items = data.items || [];
    state.totals = data.totals || null;
    state.charts = data.charts || null;
    if (Array.isArray(data.sources)) {
      state.sources = data.sources;
      const sourceSel = document.getElementById("costSource");
      if (sourceSel) {
        sourceSel.innerHTML =
          `<option value="">Todas as fontes</option>` +
          state.sources.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join("");
        sourceSel.value = state.filters.source;
      }
    }
    renderKpis();
    renderTable();
    renderCharts();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar custos: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar custos.", { type: "error" });
  }
}

/* ─── Gráficos ────────────────────────────────────────────────────────────── */

function renderCharts() {
  const charts = state.charts || {};
  const monthly = charts.monthly || [];

  drawAreaChart("crChartMonthly", {
    categories: monthly.map((m) => m.label),
    series: [
      { name: "Custo pago", key: "cost", color: TONES.red, data: monthly.map((m) => Number(m.cost) || 0) },
      { name: "Por liquidar", key: "committed", color: TONES.amber, data: monthly.map((m) => Number(m.committed) || 0) },
    ],
  });

  const sources = (charts.costBySource || []).filter((s) => Number(s.total) > 0);
  drawDonutChart("crChartSources", {
    labels: sources.map((s) => s.label || s.source),
    series: sources.map((s) => Number(s.total) || 0),
    totalLabel: "Custo total",
  });

  const aging = (charts.payablesAging || []).filter((a) => Number(a.value) > 0);
  drawDonutChart("crChartAging", {
    labels: aging.map((a) => a.label),
    series: aging.map((a) => Number(a.value) || 0),
    colors: [TONES.emerald, TONES.amber, "#f97316", TONES.red, "#991b1b"],
    totalLabel: "Por pagar",
  });
}

function openCostModal(cost, confirmMode) {
  const cur = cost.currency || cost.project?.currency || "AOA";
  openModal({
    title: confirmMode ? "Confirmar Custo" : "Detalhe do Custo",
    contentHtml: `
      <p class="finance-note" style="margin-bottom:1rem">
        ${esc(cost.description || "—")} · ${esc(money(cost.paidAmount, cur))} ·
        ${esc(cost.project?.name || "")} · ${esc(cost.sourceLabel || cost.source || "")}
      </p>
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field">
          <label class="finance-label" for="cst_doc">Nº Documento</label>
          <input id="cst_doc" class="finance-input" type="text" value="${esc(cost.docNumber || "")}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="cst_resp">Responsável</label>
          <input id="cst_resp" class="finance-input" type="text" value="${esc(cost.responsible || "")}" />
        </div>
        <div class="finance-field finance-field--full">
          <label class="finance-label" for="cst_status">Estado de Confirmação</label>
          <select id="cst_status" class="finance-select">
            <option value="POR_CONFIRMAR" ${cost.confirmationStatus !== "CONFIRMADO" ? "selected" : ""}>Por confirmar</option>
            <option value="CONFIRMADO" ${cost.confirmationStatus === "CONFIRMADO" ? "selected" : ""}>Confirmado</option>
          </select>
        </div>
      </div>`,
    primaryLabel: confirmMode ? "Confirmar" : "Guardar",
    onRender: ({ panel }) => {
      if (confirmMode) {
        const sel = panel.querySelector("#cst_status");
        sel.value = "CONFIRMADO";
        sel.disabled = true;
      }
    },
    onPrimary: async ({ btn, close, panel }) => {
      const payload = {
        docNumber: panel.querySelector("#cst_doc").value.trim() || null,
        responsible: panel.querySelector("#cst_resp").value.trim() || null,
      };
      setButtonLoading(btn, true);
      try {
        // A confirmação usa o endpoint dedicado (permissão financeiro:approve).
        if (confirmMode) {
          await apiRequest(`/finance/costs/${cost.sourceId}/confirm`, { method: "POST", body: payload });
        } else {
          await apiRequest(`/finance/costs/${cost.sourceId}`, {
            method: "PATCH",
            body: { ...payload, confirmationStatus: panel.querySelector("#cst_status").value },
          });
        }
        toast(confirmMode ? "Custo confirmado." : "Custo actualizado.", { type: "success" });
        close();
        await load();
      } catch (err) {
        toast(err.message || "Falha ao guardar o custo.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

/* ─── Lançamento manual de custo ──────────────────────────────────────────── */

const PAYMENT_METHODS = ["Caixa", "Banco", "Transferência", "Cheque", "Multicaixa"];

/**
 * Registo manual de um custo do financeiro.
 * Serve para despesas que não nascem nas outras áreas (cotações, pedidos extra,
 * pedidos de compra, fretes): rendas, serviços pontuais, pagamentos ao balcão.
 */
function openManualCostModal() {
  const today = toDateKey(new Date());
  const content = `
    <p class="finance-note" style="margin-bottom:1rem">
      Use este formulário para despesas que não vêm de cotações, pedidos extra, pedidos de compra ou fretes
      — rendas, serviços pontuais, despesas administrativas ou pagamentos já feitos. O registo fica confirmado
      e assinado por si, e o que ficar por pagar aparece nas Contas a Pagar.
    </p>
    <div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full">
        <label class="finance-label" for="mc_project">Obra <span style="color:#dc2626">*</span></label>
        <select id="mc_project" class="finance-select" required>
          <option value="">Selecionar obra…</option>
          ${state.projects
            .map((p) => `<option value="${esc(p.id)}">${esc(p.code ? `${p.code} — ${p.name}` : p.name)}</option>`)
            .join("")}
        </select>
      </div>
      <div class="finance-field">
        <label class="finance-label" for="mc_center">Centro de custo <span style="color:#dc2626">*</span></label>
        <select id="mc_center" class="finance-select" required disabled>
          <option value="">Escolha primeiro a obra</option>
        </select>
        <p class="finance-note" id="mc_centerHint">O custo é imputado a um centro de custo da obra.</p>
      </div>
      <div class="finance-field">
        <label class="finance-label" for="mc_category">Categoria</label>
        <select id="mc_category" class="finance-select">
          ${Object.entries(CATEGORY)
            .map(([key, label]) => `<option value="${key}">${esc(label)}</option>`)
            .join("")}
        </select>
      </div>

      <p class="finance-section-title">Documento e fornecedor</p>
      <div class="finance-field">
        <label class="finance-label" for="mc_supplier">Fornecedor</label>
        <select id="mc_supplier" class="finance-select">
          <option value="">—</option>
          ${state.suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}
        </select>
      </div>
      <div class="finance-field">
        <label class="finance-label" for="mc_doc">Nº documento / fatura</label>
        <input id="mc_doc" class="finance-input" type="text" placeholder="Ex.: FT 2026/123" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="mc_date">Data do custo <span style="color:#dc2626">*</span></label>
        <input id="mc_date" class="finance-input" type="date" required value="${today}" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="mc_desc">Descrição <span style="color:#dc2626">*</span></label>
        <input id="mc_desc" class="finance-input" type="text" required placeholder="Ex.: Renda do escritório — Outubro" />
      </div>

      <p class="finance-section-title">Valores</p>
      <div class="finance-field">
        <label class="finance-label" for="mc_budgeted">Valor total do custo <span style="color:#dc2626">*</span></label>
        <input id="mc_budgeted" class="finance-input" type="number" min="0" step="0.01" required />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="mc_paid">Valor pago agora</label>
        <input id="mc_paid" class="finance-input" type="number" min="0" step="0.01" value="0" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="mc_method">Meio de pagamento</label>
        <select id="mc_method" class="finance-select">
          <option value="">—</option>
          ${PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("")}
        </select>
      </div>
      <div class="finance-field">
        <label class="finance-label" for="mc_type">Forma de pagamento</label>
        <select id="mc_type" class="finance-select">
          <option value="PRONTO_PAGAMENTO">Pronto pagamento</option>
          <option value="CREDITO">Crédito (a pagar)</option>
        </select>
      </div>
      <div class="finance-field finance-field--full">
        <label class="finance-label" for="mc_notes">Notas</label>
        <input id="mc_notes" class="finance-input" type="text" />
      </div>

      <div class="finance-stat-row finance-field--full">
        <div class="finance-stat finance-stat--blue">
          <span class="finance-stat-label">Custo total</span>
          <span class="finance-stat-value" id="mc_sum_total">—</span>
        </div>
        <div class="finance-stat finance-stat--emerald">
          <span class="finance-stat-label">Pago agora</span>
          <span class="finance-stat-value" id="mc_sum_paid">—</span>
        </div>
        <div class="finance-stat finance-stat--amber">
          <span class="finance-stat-label">Fica por pagar</span>
          <span class="finance-stat-value" id="mc_sum_remaining">—</span>
        </div>
      </div>
    </div>`;

  openModal({
    title: "Novo Custo (lançamento manual)",
    contentHtml: content,
    primaryLabel: "Registar Custo",
    onRender: ({ panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const projectSel = $("mc_project");
      const centerSel = $("mc_center");
      const hint = $("mc_centerHint");

      const refreshSummary = () => {
        const total = Number($("mc_budgeted").value) || 0;
        const paid = Math.min(Number($("mc_paid").value) || 0, total);
        $("mc_sum_total").textContent = money(total);
        $("mc_sum_paid").textContent = money(paid);
        $("mc_sum_remaining").textContent = money(Math.max(total - paid, 0));
      };

      const loadCenters = async () => {
        const projectId = projectSel.value;
        centerSel.innerHTML = `<option value="">Escolha primeiro a obra</option>`;
        centerSel.disabled = true;
        if (!projectId) {
          hint.textContent = "O custo é imputado a um centro de custo da obra.";
          return;
        }
        hint.textContent = "A carregar centros de custo…";
        try {
          const data = await apiRequest(
            `/finance/options/cost-centers?projectId=${encodeURIComponent(projectId)}`
          );
          const centers = data.items || [];
          centerSel.innerHTML = centers.length
            ? `<option value="">Selecionar centro de custo…</option>` +
              centers
                .map((c) => `<option value="${esc(c.id)}">${esc(`${c.code} — ${c.name}`)}</option>`)
                .join("")
            : `<option value="">Sem centros de custo ativos</option>`;
          centerSel.disabled = !centers.length;
          hint.textContent = centers.length
            ? `Centros de custo ativos desta obra (${centers.length}).`
            : "Esta obra ainda não tem centros de custo ativos. Crie um na vista da obra antes de lançar o custo.";
        } catch (err) {
          hint.textContent = err.message || "Falha ao carregar os centros de custo.";
        }
      };

      projectSel.addEventListener("change", loadCenters);
      ["mc_budgeted", "mc_paid"].forEach((id) => $(id).addEventListener("input", refreshSummary));
      loadCenters();
      refreshSummary();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const projectId = $("mc_project").value;
      if (!projectId) return toast("Selecione a obra.", { type: "error" });
      if (!$("mc_center").value) return toast("Selecione o centro de custo da obra.", { type: "error" });
      const description = $("mc_desc").value.trim();
      if (description.length < 2) return toast("Indique a descrição do custo.", { type: "error" });
      const budgetedAmount = Number($("mc_budgeted").value);
      if (!budgetedAmount || budgetedAmount <= 0) {
        return toast("Indique o valor total do custo.", { type: "error" });
      }
      const paidAmount = Number($("mc_paid").value) || 0;
      if (paidAmount > budgetedAmount) {
        return toast("O valor pago não pode ser maior do que o valor total do custo.", { type: "error" });
      }

      setButtonLoading(btn, true);
      try {
        await apiRequest("/finance/costs", {
          method: "POST",
          body: {
            projectId,
            costCenterId: $("mc_center").value,
            supplierId: $("mc_supplier").value || null,
            docNumber: $("mc_doc").value.trim() || null,
            paymentDate: $("mc_date").value,
            category: $("mc_category").value,
            description,
            budgetedAmount,
            paidAmount,
            paymentMethod: $("mc_method").value || null,
            paymentType: $("mc_type").value,
            notes: $("mc_notes").value.trim() || null,
          },
        });
        toast(
          paidAmount > 0 ? "Custo registado e contabilizado como pago." : "Custo registado e por pagar.",
          { type: "success" }
        );
        close();
        await load();
      } catch (err) {
        toast(err.message || "Falha ao registar o custo.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

export async function render() {
  destroyCharts();
  state.filters = { projectId: "", status: "", source: "" };
  try {
    const [projects, suppliers] = await Promise.all([
      apiRequest("/finance/options/projects"),
      apiRequest("/finance/options/suppliers"),
    ]);
    state.projects = projects.items || [];
    state.suppliers = suppliers.items || [];
  } catch (err) {
    toast(err.message || "Falha ao carregar obras.", { type: "error" });
  }
  renderShell();
  await load();
}
