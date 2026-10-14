import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Registar Faturas» (Financeiro · Faturação).
 * Listagem com filtros + linha de totais, destaque de atrasadas e
 * formulário de fatura com cálculo automático (retenção, IVA cativo,
 * seguro CAR, garantia) e registo de recebimentos.
 */

const STATUS = {
  EM_ABERTO: { label: "Em Aberto", badge: "slate" },
  PAGO_PARCIAL: { label: "Pago Parcial", badge: "amber" },
  PAGO_TOTAL: { label: "Pago Total", badge: "emerald" },
  ATRASADO: { label: "Atrasado", badge: "red" },
};

const state = {
  filters: { month: "", status: "", clientId: "", projectId: "" },
  projects: [],
  clients: [],
  items: [],
  totals: null,
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function canEdit() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

function projectById(id) {
  return state.projects.find((p) => p.id === id) || null;
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

function renderShell() {
  const root = document.getElementById("financeRoot");
  root.innerHTML = `
    <div id="invoiceKpis" class="finance-kpi-grid"></div>
    <section class="finance-card">
      <div class="fin-toolbar" style="margin-bottom:1rem">
        <div class="fin-toolbar-filters">
          <input id="invFilterMonth" class="finance-input" type="month" title="Mês do documento" />
          <select id="invFilterStatus" class="finance-select" title="Estado">
            <option value="">Todos os estados</option>
            ${Object.entries(STATUS)
              .map(([key, s]) => `<option value="${key}">${s.label}</option>`)
              .join("")}
          </select>
          <select id="invFilterClient" class="finance-select fin-proj-filter" title="Cliente">
            <option value="">Todos os clientes</option>
          </select>
          <select id="invFilterProject" class="finance-select fin-proj-filter" title="Obra">
            <option value="">Todas as obras</option>
          </select>
          <button id="invFilterClear" type="button" class="finance-btn finance-btn--ghost">
            <span class="material-symbols-outlined">filter_alt_off</span>Limpar
          </button>
        </div>
      </div>
      <div id="invoiceTable" class="finance-table-scroll"></div>
    </section>`;

  document.getElementById("invoiceKpis").innerHTML = "";

  const clientSel = document.getElementById("invFilterClient");
  clientSel.innerHTML =
    `<option value="">Todos os clientes</option>` +
    state.clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

  const projectSel = document.getElementById("invFilterProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.referencia ? `${p.referencia} — ${p.name}` : p.name)}</option>`).join("");

  clientSel.value = state.filters.clientId;
  projectSel.value = state.filters.projectId;
  document.getElementById("invFilterMonth").value = state.filters.month;
  document.getElementById("invFilterStatus").value = state.filters.status;

  clientSel.addEventListener("change", () => {
    state.filters.clientId = clientSel.value;
    loadInvoices();
  });
  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    loadInvoices();
  });
  document.getElementById("invFilterMonth").addEventListener("change", (e) => {
    state.filters.month = e.target.value;
    loadInvoices();
  });
  document.getElementById("invFilterStatus").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    loadInvoices();
  });
  document.getElementById("invFilterClear").addEventListener("click", () => {
    state.filters = { month: "", status: "", clientId: "", projectId: "" };
    document.getElementById("invFilterMonth").value = "";
    document.getElementById("invFilterStatus").value = "";
    clientSel.value = "";
    projectSel.value = "";
    loadInvoices();
  });

  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = canEdit()
      ? `<button id="invNew" type="button" class="finance-btn finance-btn--primary">
           <span class="material-symbols-outlined">add</span>Nova Fatura
         </button>`
      : "";
    document.getElementById("invNew")?.addEventListener("click", () => openInvoiceModal(null));
  }
}

function renderKpis() {
  const el = document.getElementById("invoiceKpis");
  if (!el) return;
  const totals = state.totals || {};
  const overdue = state.items.filter((i) => i.status === "ATRASADO");
  const overdueValue = overdue.reduce((a, i) => a + (Number(i.missingAmount) || 0), 0);

  const cards = [
    { label: "Total Faturado", value: money(totals.gross), sub: "V. Ilíquido", tone: "blue", icon: "receipt_long" },
    { label: "Total Recebido", value: money(totals.received), sub: "Recebimentos registados", tone: "emerald", icon: "savings" },
    { label: "Em Falta", value: money(totals.missing), sub: "V. Líquido por receber", tone: "amber", icon: "pending_actions" },
    {
      label: "Faturas Atrasadas",
      value: String(overdue.length),
      sub: `${money(overdueValue)} em atraso`,
      tone: overdue.length ? "red" : "emerald",
      icon: "warning",
    },
    { label: "N.º de Faturas", value: String(state.items.length), sub: "No filtro actual", tone: "slate", icon: "tag" },
  ];

  el.innerHTML = cards
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

/* ─── Tabela ──────────────────────────────────────────────────────────────── */

function statusBadge(status) {
  const s = STATUS[status] || { label: status, badge: "slate" };
  return `<span class="finance-badge finance-badge--${s.badge}">${esc(s.label)}</span>`;
}

function renderTable() {
  const wrap = document.getElementById("invoiceTable");
  if (!wrap) return;

  if (!state.items.length) {
    wrap.innerHTML = `
      <div class="finance-empty">
        <span class="material-symbols-outlined">receipt_long</span>
        Sem faturas para os filtros selecionados.
      </div>`;
    return;
  }

  const editable = canEdit();
  const rows = state.items
    .map((inv) => {
      const cur = inv.project?.currency || "AOA";
      const overdue = inv.status === "ATRASADO";
      return `
      <tr data-id="${esc(inv.id)}" class="${overdue ? "fin-row--overdue" : ""}">
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(inv.project?.name || "—")}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(inv.project?.referencia || "—")}</div>
        </td>
        <td>${esc(inv.client?.name || "—")}</td>
        <td>${esc(inv.docNumber || "—")}</td>
        <td>${esc(formatDateOnly(inv.docDate))}</td>
        <td>${esc(formatDateOnly(inv.dueDate))}</td>
        <td>${inv.measurement ? esc(inv.measurement.reportNumber || "AM") : '<span class="fin-empty-cell">—</span>'}</td>
        <td class="fin-num">${esc(money(inv.grossAmount, cur))}</td>
        <td class="fin-num">${esc(money(inv.withholdingAmount, cur))}</td>
        <td class="fin-num">${inv.flagVatCativo ? '<span class="fin-empty-cell">cativo</span>' : esc(money(inv.vatAmount, cur))}</td>
        <td class="fin-num">${esc(money(inv.carInsuranceAmount, cur))}</td>
        <td class="fin-num">${esc(money(inv.guaranteeAmount, cur))}</td>
        <td class="fin-num" style="font-weight:800">${esc(money(inv.netAmount, cur))}</td>
        <td class="fin-num">${esc(pct(inv.workPercent))}</td>
        <td class="fin-num" style="color:#059669;font-weight:700">${esc(money(inv.receivedAmount, cur))}</td>
        <td class="fin-num" style="color:${Number(inv.missingAmount) > 0 ? "#dc2626" : "#059669"};font-weight:700">${esc(money(inv.missingAmount, cur))}</td>
        <td>${statusBadge(inv.status)}</td>
        <td>
          <div class="fin-actions">
            ${
              editable
                ? `<button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Registar recebimento" data-action="receipt">
                     <span class="material-symbols-outlined" style="font-size:17px">payments</span>
                   </button>
                   <button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Editar" data-action="edit">
                     <span class="material-symbols-outlined" style="font-size:17px">edit</span>
                   </button>
                   <button type="button" class="fin-icon-btn fin-icon-btn--red" title="Eliminar" data-action="delete">
                     <span class="material-symbols-outlined" style="font-size:17px">delete</span>
                   </button>`
                : `<span class="fin-empty-cell">—</span>`
            }
          </div>
        </td>
      </tr>`;
    })
    .join("");

  const t = state.totals || {};
  wrap.innerHTML = `
    <table class="fin-table">
      <thead>
        <tr>
          <th>Obra</th><th>Cliente</th><th>Nº Doc</th><th>Data Doc</th><th>Venc.</th><th>AM</th>
          <th style="text-align:right">V. Ilíquido</th>
          <th style="text-align:right">Retenção</th>
          <th style="text-align:right">IVA</th>
          <th style="text-align:right">Seg. CAR</th>
          <th style="text-align:right">Garantia</th>
          <th style="text-align:right">V. Líquido</th>
          <th style="text-align:right">% Obra</th>
          <th style="text-align:right">Recebido</th>
          <th style="text-align:right">Em Falta</th>
          <th>Estado</th>
          <th style="text-align:center">Ações</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="6">Totais (${state.items.length} faturas)</td>
          <td class="fin-num">${esc(money(t.gross))}</td>
          <td class="fin-num">${esc(money(t.withholding))}</td>
          <td class="fin-num">${esc(money(t.vat))}</td>
          <td class="fin-num">${esc(money(t.car))}</td>
          <td class="fin-num">${esc(money(t.guarantee))}</td>
          <td class="fin-num">${esc(money(t.net))}</td>
          <td></td>
          <td class="fin-num">${esc(money(t.received))}</td>
          <td class="fin-num">${esc(money(t.missing))}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>`;

  wrap.querySelectorAll("tbody tr").forEach((tr) => {
    const id = tr.dataset.id;
    const inv = state.items.find((i) => i.id === id);
    if (!inv) return;
    tr.querySelector('[data-action="edit"]')?.addEventListener("click", () => openInvoiceModal(inv));
    tr.querySelector('[data-action="receipt"]')?.addEventListener("click", () => openReceiptModal(inv));
    tr.querySelector('[data-action="delete"]')?.addEventListener("click", () => removeInvoice(inv));
  });
}

/** Data «só dia» (docDate/dueDate vêm em ISO) — evita desvio de fuso. */
function formatDateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function loadOptions() {
  const [projects, clients] = await Promise.all([
    apiRequest("/finance/options/projects"),
    apiRequest("/finance/options/clients"),
  ]);
  state.projects = projects.items || [];
  state.clients = clients.items || [];
}

async function loadInvoices() {
  const wrap = document.getElementById("invoiceTable");
  if (wrap) wrap.innerHTML = `<div class="finance-empty">A carregar faturas…</div>`;
  const params = new URLSearchParams();
  Object.entries(state.filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  try {
    const data = await apiRequest(`/finance/invoices?${params.toString()}`);
    state.items = data.items || [];
    state.totals = data.totals || null;
    renderKpis();
    renderTable();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar faturas: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar faturas.", { type: "error" });
  }
}

/* ─── Formulário de fatura ────────────────────────────────────────────────── */

function buildPreview(draft) {
  const g = Number(draft.grossAmount) || 0;
  const vat = draft.flagVatCativo ? 0 : (g * (Number(draft.vatPercent) || 0)) / 100;
  const withholding = (g * (Number(draft.withholdingPercent) || 0)) / 100;
  const car = (g * (Number(draft.carPercent) || 0)) / 100;
  const guarantee = (g * (Number(draft.guaranteePercent) || 0)) / 100;
  const net = g + vat - withholding - car - guarantee;
  const budget = Number(draft.budgetTotal) || 0;
  const workPercent = budget > 0 ? (g / budget) * 100 : null;
  return { vat, net, workPercent };
}

async function openInvoiceModal(invoice) {
  const isEdit = Boolean(invoice);
  const content = `
    <div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full">
        <label class="finance-label" for="inv_project">Obra <span style="color:#dc2626">*</span></label>
        <select id="inv_project" class="finance-select" required ${isEdit ? "disabled" : ""}>
          <option value="">Selecionar obra…</option>
          ${state.projects
            .map((p) => `<option value="${esc(p.id)}" ${invoice?.projectId === p.id ? "selected" : ""}>${esc(p.referencia ? `${p.referencia} — ${p.name}` : p.name)}</option>`)
            .join("")}
        </select>
      </div>
      <div class="finance-field">
        <label class="finance-label">Cliente</label>
        <input id="inv_client" class="finance-input" type="text" value="${esc(invoice?.client?.name || "")}" readonly placeholder="—" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="inv_measurement">Auto de Medição (em aberto)</label>
        <select id="inv_measurement" class="finance-select" ${isEdit ? "disabled" : ""}>
          <option value="">Sem AM associado</option>
        </select>
      </div>

      <p class="finance-section-title">Documento</p>
      <div class="finance-field">
        <label class="finance-label" for="inv_docNumber">Nº Doc</label>
        <input id="inv_docNumber" class="finance-input" type="text" value="${esc(invoice?.docNumber || "")}" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="inv_docDate">Data Doc <span style="color:#dc2626">*</span></label>
        <input id="inv_docDate" class="finance-input" type="date" required value="${invoice?.docDate ? esc(toDateKey(invoice.docDate)) : toDateKey(new Date())}" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="inv_dueDate">Data Vencimento</label>
        <input id="inv_dueDate" class="finance-input" type="date" value="${invoice?.dueDate ? esc(toDateKey(invoice.dueDate)) : ""}" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="inv_gross">V. Ilíquido <span style="color:#dc2626">*</span></label>
        <input id="inv_gross" class="finance-input" type="number" min="0" step="0.01" required value="${invoice ? Number(invoice.grossAmount) : ""}" />
      </div>

      <p class="finance-section-title">Deduções e impostos (%)</p>
      <div class="finance-field">
        <label class="finance-label" for="inv_withholding">Retenção na Fonte (%)</label>
        <input id="inv_withholding" class="finance-input" type="number" min="0" max="100" step="0.01" value="${numOr(invoice?.withholdingPercent, "")}" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="inv_vat">IVA (%)</label>
        <input id="inv_vat" class="finance-input" type="number" min="0" max="100" step="0.01" value="${numOr(invoice?.vatPercent, "")}" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="inv_car">Seguro CAR (%)</label>
        <input id="inv_car" class="finance-input" type="number" min="0" max="100" step="0.01" value="${numOr(invoice?.carPercent, "")}" />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="inv_guarantee">Garantia (%)</label>
        <input id="inv_guarantee" class="finance-input" type="number" min="0" max="100" step="0.01" value="${numOr(invoice?.guaranteePercent, "")}" />
      </div>
      <div class="finance-field finance-field--full">
        <label class="finance-check">
          <input id="inv_vatCativo" type="checkbox" ${invoice?.flagVatCativo ? "checked" : ""} />
          IVA cativo (não é somado ao valor do recebimento)
        </label>
        <p class="finance-note">A configuração de faturação da obra é carregada automaticamente ao escolher a obra.</p>
      </div>
      <div class="finance-field finance-field--full">
        <button id="inv_saveConfig" type="button" class="finance-btn finance-btn--ghost" style="align-self:flex-start">
          <span class="material-symbols-outlined">save</span>Guardar % na configuração da obra
        </button>
      </div>

      <div class="finance-preview finance-field--full">
        <div class="finance-preview-item">
          <span class="finance-preview-label">Valor IVA</span>
          <span id="pv_vat" class="finance-preview-value">—</span>
        </div>
        <div class="finance-preview-item">
          <span class="finance-preview-label">V. Líquido</span>
          <span id="pv_net" class="finance-preview-value finance-preview-value--accent">—</span>
        </div>
        <div class="finance-preview-item">
          <span class="finance-preview-label">% Obra</span>
          <span id="pv_work" class="finance-preview-value">—</span>
        </div>
      </div>

      <p class="finance-section-title">Recebimento</p>
      <div class="finance-field">
        <label class="finance-label" for="inv_received">V. Recebido</label>
        <input id="inv_received" class="finance-input" type="number" min="0" step="0.01" value="${invoice ? Number(invoice.receivedAmount) : 0}" ${isEdit ? "disabled" : ""} />
      </div>
      <div class="finance-field">
        <label class="finance-label" for="inv_receivedDate">Data Recebido</label>
        <input id="inv_receivedDate" class="finance-input" type="date" value="${invoice?.receivedDate ? esc(toDateKey(invoice.receivedDate)) : ""}" ${isEdit ? "disabled" : ""} />
      </div>
      <div class="finance-field finance-field--full">
        <label class="finance-label" for="inv_notes">Notas</label>
        <input id="inv_notes" class="finance-input" type="text" value="${esc(invoice?.notes || "")}" />
      </div>
    </div>`;

  openModal({
    title: isEdit ? "Editar Fatura" : "Nova Fatura",
    contentHtml: content,
    primaryLabel: isEdit ? "Guardar" : "Criar Fatura",
    onRender: ({ panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const projectSel = $("inv_project");
      const amSel = $("inv_measurement");
      let currentProject = projectById(invoice?.projectId || projectSel.value) || null;

      const setClient = () => {
        const p = projectById(projectSel.value);
        $("inv_client").value = p?.clientName || "";
      };

      const refreshPreview = () => {
        const pv = buildPreview({
          grossAmount: $("inv_gross").value,
          vatPercent: $("inv_vat").value,
          withholdingPercent: $("inv_withholding").value,
          carPercent: $("inv_car").value,
          guaranteePercent: $("inv_guarantee").value,
          flagVatCativo: $("inv_vatCativo").checked,
          budgetTotal: currentProject?.budgetTotal,
        });
        const cur = currentProject?.currency || "AOA";
        $("pv_vat").textContent = $("inv_vatCativo").checked ? "Cativo" : money(pv.vat, cur);
        $("pv_net").textContent = money(pv.net, cur);
        $("pv_work").textContent = pv.workPercent === null ? "—" : `${pv.workPercent.toFixed(2)}%`;
        $("inv_vat").disabled = $("inv_vatCativo").checked;
      };

      const applyBillingConfig = (cfg) => {
        if (cfg.billingVatPercent !== null && cfg.billingVatPercent !== undefined) $("inv_vat").value = Number(cfg.billingVatPercent);
        if (cfg.billingWithholdingPercent !== null && cfg.billingWithholdingPercent !== undefined) $("inv_withholding").value = Number(cfg.billingWithholdingPercent);
        if (cfg.billingCarPercent !== null && cfg.billingCarPercent !== undefined) $("inv_car").value = Number(cfg.billingCarPercent);
        if (cfg.billingGuaranteePercent !== null && cfg.billingGuaranteePercent !== undefined) $("inv_guarantee").value = Number(cfg.billingGuaranteePercent);
        $("inv_vatCativo").checked = Boolean(cfg.billingVatCativo);
      };

      const loadProjectContext = async () => {
        const id = projectSel.value;
        currentProject = projectById(id);
        setClient();
        if (!id) {
          amSel.innerHTML = `<option value="">Sem AM associado</option>`;
          refreshPreview();
          return;
        }
        try {
          const [billing, open] = await Promise.all([
            apiRequest(`/finance/projects/${id}/billing`),
            apiRequest(`/finance/projects/${id}/open-measurements`),
          ]);
          if (!isEdit) applyBillingConfig(billing.project || {});
          currentProject = { ...(currentProject || {}), ...(billing.project || {}) };
          amSel.innerHTML =
            `<option value="">Sem AM associado</option>` +
            (open.items || [])
              .map(
                (r) =>
                  `<option value="${esc(r.id)}" data-total="${Number(r.periodValTotal) || 0}">${esc(
                    `${r.reportNumber || "AM"} · ${formatDateOnly(r.reportDate)} · ${money(r.periodValTotal, currentProject?.currency)}`
                  )}</option>`
              )
              .join("");
        } catch (err) {
          toast(err.message || "Falha ao carregar dados da obra.", { type: "error" });
        }
        refreshPreview();
      };

      // Pré-enche os campos com a fatura existente (modo edição).
      if (isEdit) {
        $("inv_withholding").value = pctValue(invoice.withholdingAmount, invoice.grossAmount);
        $("inv_vat").value = pctValue(invoice.vatAmount, invoice.grossAmount);
        $("inv_car").value = pctValue(invoice.carInsuranceAmount, invoice.grossAmount);
        $("inv_guarantee").value = pctValue(invoice.guaranteeAmount, invoice.grossAmount);
      }

      projectSel.addEventListener("change", loadProjectContext);
      amSel.addEventListener("change", () => {
        const total = Number(amSel.selectedOptions[0]?.dataset.total || 0);
        if (total > 0) $("inv_gross").value = total;
        refreshPreview();
      });
      ["inv_gross", "inv_vat", "inv_withholding", "inv_car", "inv_guarantee"].forEach((id) =>
        $(id).addEventListener("input", refreshPreview)
      );
      $("inv_vatCativo").addEventListener("change", refreshPreview);

      $("inv_saveConfig").addEventListener("click", async (e) => {
        const id = projectSel.value;
        if (!id) return toast("Escolha a obra primeiro.", { type: "error" });
        const btn = e.currentTarget;
        setButtonLoading(btn, true);
        try {
          await apiRequest(`/finance/projects/${id}/billing`, {
            method: "PATCH",
            body: {
              billingVatCativo: $("inv_vatCativo").checked,
              billingVatPercent: numOrNull($("inv_vat").value),
              billingWithholdingPercent: numOrNull($("inv_withholding").value),
              billingCarPercent: numOrNull($("inv_car").value),
              billingGuaranteePercent: numOrNull($("inv_guarantee").value),
            },
          });
          toast("Configuração de faturação guardada na obra.", { type: "success" });
        } catch (err) {
          toast(err.message || "Falha ao guardar configuração.", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
        }
      });

      if (projectSel.value) loadProjectContext();
      else refreshPreview();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const raw = {
        docNumber: $("inv_docNumber").value.trim() || null,
        docDate: $("inv_docDate").value,
        dueDate: $("inv_dueDate").value || null,
        grossAmount: Number($("inv_gross").value),
        vatPercent: numOrNull($("inv_vat").value),
        withholdingPercent: numOrNull($("inv_withholding").value),
        carPercent: numOrNull($("inv_car").value),
        guaranteePercent: numOrNull($("inv_guarantee").value),
        flagVatCativo: $("inv_vatCativo").checked,
        notes: $("inv_notes").value.trim() || null,
      };
      if (!raw.grossAmount || raw.grossAmount <= 0) return toast("Indique o V. Ilíquido.", { type: "error" });

      setButtonLoading(btn, true);
      try {
        if (isEdit) {
          await apiRequest(`/finance/invoices/${invoice.id}`, { method: "PATCH", body: raw });
          toast("Fatura actualizada.", { type: "success" });
        } else {
          const projectId = $("inv_project").value;
          if (!projectId) {
            setButtonLoading(btn, false);
            return toast("Selecione a obra.", { type: "error" });
          }
          await apiRequest("/finance/invoices", {
            method: "POST",
            body: {
              ...raw,
              projectId,
              measurementId: $("inv_measurement").value || null,
              receivedAmount: numOrNull($("inv_received").value) || 0,
              receivedDate: $("inv_receivedDate").value || null,
            },
          });
          toast("Fatura criada.", { type: "success" });
        }
        close();
        await loadInvoices();
      } catch (err) {
        toast(err.message || "Falha ao guardar a fatura.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

function numOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value) {
  return numOr(value, null);
}

/** Percentagem implícita (valor / base × 100) para pré-encher em edição. */
function pctValue(amount, base) {
  const a = Number(amount) || 0;
  const b = Number(base) || 0;
  if (b <= 0) return "";
  return Math.round((a / b) * 10000) / 100;
}

/* ─── Recebimento ─────────────────────────────────────────────────────────── */

function openReceiptModal(invoice) {
  const cur = invoice.project?.currency || "AOA";
  const remaining = Number(invoice.missingAmount) || 0;
  openModal({
    title: `Recebimento — ${invoice.docNumber || "Fatura"}`,
    contentHtml: `
      <p class="finance-note" style="margin-bottom:1rem">
        Valor líquido ${esc(money(invoice.netAmount, cur))} · em falta
        <strong>${esc(money(remaining, cur))}</strong>
      </p>
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field">
          <label class="finance-label" for="rec_amount">Valor <span style="color:#dc2626">*</span></label>
          <input id="rec_amount" class="finance-input" type="number" min="0" step="0.01" required value="${remaining > 0 ? remaining : ""}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rec_date">Data <span style="color:#dc2626">*</span></label>
          <input id="rec_date" class="finance-input" type="date" required value="${toDateKey(new Date())}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rec_method">Meio</label>
          <input id="rec_method" class="finance-input" type="text" placeholder="Transferência, cheque…" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rec_notes">Notas</label>
          <input id="rec_notes" class="finance-input" type="text" />
        </div>
      </div>`,
    primaryLabel: "Registar",
    onPrimary: async ({ btn, close, panel }) => {
      const amount = Number(panel.querySelector("#rec_amount").value);
      if (!amount || amount <= 0) return toast("Indique o valor recebido.", { type: "error" });
      setButtonLoading(btn, true);
      try {
        await apiRequest(`/finance/invoices/${invoice.id}/receipts`, {
          method: "POST",
          body: {
            amount,
            receivedDate: panel.querySelector("#rec_date").value,
            method: panel.querySelector("#rec_method").value.trim() || null,
            notes: panel.querySelector("#rec_notes").value.trim() || null,
          },
        });
        toast("Recebimento registado.", { type: "success" });
        close();
        await loadInvoices();
      } catch (err) {
        toast(err.message || "Falha ao registar recebimento.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

/* ─── Eliminar ────────────────────────────────────────────────────────────── */

async function removeInvoice(invoice) {
  const label = invoice.docNumber || invoice.project?.name || "esta fatura";
  if (!window.confirm(`Eliminar a fatura ${label}? Esta ação não pode ser revertida.`)) return;
  try {
    await apiRequest(`/finance/invoices/${invoice.id}`, { method: "DELETE" });
    toast("Fatura eliminada.", { type: "success" });
    await loadInvoices();
  } catch (err) {
    toast(err.message || "Falha ao eliminar fatura.", { type: "error" });
  }
}

/* ─── Entrada ─────────────────────────────────────────────────────────────── */

export async function render() {
  try {
    await loadOptions();
  } catch (err) {
    toast(err.message || "Falha ao carregar obras e clientes.", { type: "error" });
  }
  renderShell();
  await loadInvoices();
}
