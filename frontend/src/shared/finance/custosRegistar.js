import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Ecrã «Registar Custos» (Financeiro · Custos).
 * Lista os lançamentos de custo (entradas automáticas de stock, pagamentos e
 * ATM) com estado «Por confirmar / Confirmado» e responsável.
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

const SOURCE = {
  MERCADORIA_STOCK: { label: "Stock", tone: "violet" },
  PAGAMENTO_DIRETO: { label: "Pagamento direto", tone: "blue" },
  ATM: { label: "ATM", tone: "amber" },
  MANUAL: { label: "Manual", tone: "" },
};

const state = {
  filters: { projectId: "", status: "", sourceType: "" },
  projects: [],
  items: [],
  totals: null,
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

function sourceChip(sourceType) {
  const s = SOURCE[sourceType] || { label: sourceType || "—", tone: "" };
  return `<span class="finance-chip ${s.tone ? `finance-chip--${s.tone}` : ""}">${esc(s.label)}</span>`;
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
            <option value="">Todas as origens</option>
            <option value="MERCADORIA_STOCK">Stock (mercadoria)</option>
            <option value="PAGAMENTO_DIRETO">Pagamento direto</option>
            <option value="ATM">ATM</option>
            <option value="MANUAL">Manual</option>
          </select>
          <button id="costClear" type="button" class="finance-btn finance-btn--ghost">
            <span class="material-symbols-outlined">filter_alt_off</span>Limpar
          </button>
        </div>
      </div>
      <p class="finance-hint">
        Os custos entram automaticamente: mercadoria só após a saída de stock, pagamentos diretos de
        imediato e levantamentos ATM aquando da sua classificação.
      </p>
      <div id="costTable" class="finance-table-scroll"></div>
    </section>`;

  const projectSel = document.getElementById("costProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.referencia ? `${p.referencia} — ${p.name}` : p.name)}</option>`).join("");

  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    load();
  });
  document.getElementById("costStatus").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    load();
  });
  document.getElementById("costSource").addEventListener("change", (e) => {
    state.filters.sourceType = e.target.value;
    load();
  });
  document.getElementById("costClear").addEventListener("click", () => {
    state.filters = { projectId: "", status: "", sourceType: "" };
    projectSel.value = "";
    document.getElementById("costStatus").value = "";
    document.getElementById("costSource").value = "";
    load();
  });
}

function renderKpis() {
  const t = state.totals || {};
  const cards = [
    { label: "Total de Custos", value: money(t.paid), sub: "Valor pago lançado", tone: "blue", icon: "payments" },
    { label: "Confirmados", value: money(t.confirmed), sub: "Custos confirmados", tone: "emerald", icon: "verified" },
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
      const cur = c.project?.currency || "AOA";
      const supplier = c.supplierRef?.name || c.supplier || "—";
      return `
      <tr data-id="${esc(c.id)}">
        <td>${esc(dateOnly(c.paymentDate))}</td>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(c.project?.name || "—")}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(c.project?.referencia || "—")}</div>
        </td>
        <td>${esc(c.costCenter?.name || "—")}</td>
        <td>${esc(supplier)}</td>
        <td style="max-width:260px">
          <div style="font-weight:600;color:#0f172a">${esc(c.description || "—")}</div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(c.docNumber || "")}</div>
        </td>
        <td>${esc(CATEGORY[c.category] || c.category || "—")}</td>
        <td class="fin-num">${esc(money(c.paidAmount, cur))}</td>
        <td>${confirmBadge(c.confirmationStatus)}</td>
        <td>${c.responsible ? esc(c.responsible) : '<span class="fin-empty-cell">—</span>'}</td>
        <td>${sourceChip(c.sourceType)}</td>
        <td>
          <div class="fin-actions">
            ${
              editable
                ? `${
                    c.confirmationStatus !== "CONFIRMADO" && canApprove()
                      ? `<button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Confirmar custo" data-action="confirm">
                           <span class="material-symbols-outlined" style="font-size:17px">done</span>
                         </button>`
                      : ""
                  }
                   <button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Detalhe" data-action="edit">
                     <span class="material-symbols-outlined" style="font-size:17px">edit</span>
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
    <table class="fin-table" style="min-width:1250px">
      <thead>
        <tr>
          <th>Data</th><th>Obra</th><th>Centro de Custo</th><th>Fornecedor</th><th>Descrição</th>
          <th>Categoria</th><th style="text-align:right">V. Pago</th><th>Confirmação</th>
          <th>Responsável</th><th>Origem</th><th style="text-align:center">Ações</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="6">Totais (${state.items.length} lançamentos)</td>
          <td class="fin-num">${esc(money(t.paid))}</td>
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
    renderKpis();
    renderTable();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar custos: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar custos.", { type: "error" });
  }
}

function openCostModal(cost, confirmMode) {
  const cur = cost.project?.currency || "AOA";
  openModal({
    title: confirmMode ? "Confirmar Custo" : "Detalhe do Custo",
    contentHtml: `
      <p class="finance-note" style="margin-bottom:1rem">
        ${esc(cost.description || "—")} · ${esc(money(cost.paidAmount, cur))} ·
        ${esc(cost.project?.name || "")}
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
          await apiRequest(`/finance/costs/${cost.id}/confirm`, { method: "POST", body: payload });
        } else {
          await apiRequest(`/finance/costs/${cost.id}`, {
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

export async function render() {
  try {
    const projects = await apiRequest("/finance/options/projects");
    state.projects = projects.items || [];
  } catch (err) {
    toast(err.message || "Falha ao carregar obras.", { type: "error" });
  }
  renderShell();
  await load();
}
