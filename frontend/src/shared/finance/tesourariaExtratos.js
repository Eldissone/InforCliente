import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import {
  MOVEMENT_TYPE,
  DOC_TYPE,
  money,
  dateOnly,
  movementChip,
  directionChip,
  loadMovementOptions,
  openClassifyModal,
  openAssignCostModal,
} from "./movementsShared.js";

/**
 * Ecrã «Extratos Bancários» (Financeiro · Tesouraria).
 * Importa extratos, lista-os e permite classificar os movimentos e
 * «Associar Custo» (mercadoria não permite custo direto).
 */

const state = {
  options: null,
  statements: [],
  selectedId: null,
  detail: null,
};

function canEdit() {
  return can("financeiro", "edit") || can("financeiro", "manage");
}

function renderShell() {
  document.getElementById("financeRoot").innerHTML = `<div id="stmtRoot"></div>`;
  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = canEdit()
      ? `<button id="stmtImport" type="button" class="finance-btn finance-btn--primary">
           <span class="material-symbols-outlined">upload_file</span>Importar Extrato
         </button>`
      : "";
    document.getElementById("stmtImport")?.addEventListener("click", openImportModal);
  }
}

function renderList() {
  const root = document.getElementById("stmtRoot");
  if (!state.statements.length) {
    root.innerHTML = `
      <section class="finance-card">
        <div class="finance-empty">
          <span class="material-symbols-outlined">account_balance</span>
          Ainda não há extratos bancários importados.
        </div>
      </section>`;
    return;
  }
  const movements = state.statements.reduce((a, s) => a + (s._count?.movements || 0), 0);
  const cards = [
    { label: "Extratos", value: String(state.statements.length), sub: "Importados", tone: "blue", icon: "description" },
    { label: "Movimentos", value: String(movements), sub: "Total nos extratos", tone: "slate", icon: "swap_vert" },
    {
      label: "Cartões",
      value: String(new Set(state.statements.map((s) => s.card?.id).filter(Boolean)).size),
      sub: "Cartões distintos",
      tone: "emerald",
      icon: "credit_card",
    },
  ];
  const kpis = `<div class="finance-kpi-grid">${cards
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
    .join("")}</div>`;

  const rows = state.statements
    .map(
      (s) => `
      <tr>
        <td>
          <div style="font-weight:700;color:#0f172a">${esc(s.name)}</div>
          ${s.fileName ? `<div style="font-size:11px;color:#94a3b8;font-weight:600">${esc(s.fileName)}</div>` : ""}
        </td>
        <td>${s.card ? `${esc(s.card.label)}${s.card.lastDigits ? ` ••••${esc(s.card.lastDigits)}` : ""}` : "—"}</td>
        <td>${esc(dateOnly(s.periodStart))} — ${esc(dateOnly(s.periodEnd))}</td>
        <td class="fin-num">${esc(String(s._count?.movements || 0))}</td>
        <td>${esc(dateOnly(s.createdAt))}</td>
        <td>
          <div class="fin-actions">
            <button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Abrir" data-open="${esc(s.id)}">
              <span class="material-symbols-outlined" style="font-size:17px">visibility</span>
            </button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  root.innerHTML = `
    ${kpis}
    <section class="finance-card">
      <div class="finance-table-scroll">
        <table class="fin-table">
          <thead><tr>
            <th>Extrato</th><th>Cartão</th><th>Período</th>
            <th style="text-align:right">Movimentos</th><th>Criado</th>
            <th style="text-align:center">Ações</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;

  root.querySelectorAll("[data-open]").forEach((btn) =>
    btn.addEventListener("click", () => openDetail(btn.dataset.open))
  );
}

async function openDetail(statementId) {
  state.selectedId = statementId;
  const root = document.getElementById("stmtRoot");
  root.innerHTML = `<div class="finance-empty">A carregar extrato…</div>`;
  try {
    const data = await apiRequest(`/finance/bank-statements/${statementId}`);
    state.detail = data.statement;
    renderDetail();
  } catch (err) {
    root.innerHTML = `<div class="finance-empty">Falha ao carregar extrato: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar extrato.", { type: "error" });
  }
}

function renderDetail() {
  const s = state.detail;
  const root = document.getElementById("stmtRoot");
  if (!s) return renderList();
  const movements = s.movements || [];
  const inflow = movements.filter((m) => m.direction === "ENTRADA").reduce((a, m) => a + (Number(m.amount) || 0), 0);
  const outflow = movements.filter((m) => m.direction === "SAIDA").reduce((a, m) => a + (Number(m.amount) || 0), 0);
  const pending = movements.filter((m) => !m.costAssigned).length;

  const cards = [
    { label: "Movimentos", value: String(movements.length), sub: s.name, tone: "slate", icon: "swap_vert" },
    { label: "Entradas", value: money(inflow), sub: "Total a crédito", tone: "emerald", icon: "south_west" },
    { label: "Saídas", value: money(outflow), sub: "Total a débito", tone: "red", icon: "north_east" },
    { label: "Por Associar", value: String(pending), sub: "Sem custo associado", tone: "amber", icon: "link_off" },
  ];
  const kpis = `<div class="finance-kpi-grid">${cards
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
    .join("")}</div>`;

  const body = movements.length
    ? movements
        .map(
          (m) => `
        <tr data-id="${esc(m.id)}">
          <td>${esc(dateOnly(m.movementDate))}</td>
          <td>${esc(m.project?.name || "—")}</td>
          <td>${esc(m.supplier?.name || "—")}</td>
          <td>${m.docType ? `${esc(m.docType)} ${esc(m.docNumber || "")}` : esc(m.docNumber || "—")}</td>
          <td>${movementChip(m.movementType)}</td>
          <td>${directionChip(m.direction)}</td>
          <td class="fin-num ${m.direction === "ENTRADA" ? "finance-pos" : "finance-neg"}">${esc(money(m.amount))}</td>
          <td>${
            m.costAssigned
              ? `<span class="finance-badge finance-badge--emerald">Associado</span>`
              : `<span class="finance-badge finance-badge--slate">Por associar</span>`
          }</td>
          <td>
            <div class="fin-actions">
              <button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Classificar" data-action="classify">
                <span class="material-symbols-outlined" style="font-size:17px">edit_note</span>
              </button>
              <button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Associar Custo" data-action="assign">
                <span class="material-symbols-outlined" style="font-size:17px">link</span>
              </button>
            </div>
          </td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="9"><div class="finance-empty">Sem movimentos neste extrato.</div></td></tr>`;

  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
      <button id="stmtBack" type="button" class="finance-btn finance-btn--ghost">
        <span class="material-symbols-outlined">arrow_back</span>Voltar
      </button>
      <div>
        <div style="font-weight:800;color:#0f172a">${esc(s.name)}</div>
        <div class="finance-note">
          ${esc(dateOnly(s.periodStart))} — ${esc(dateOnly(s.periodEnd))}
          ${s.card ? ` · ${esc(s.card.label)}` : ""}
        </div>
      </div>
    </div>
    ${kpis}
    <section class="finance-card">
      <div class="finance-table-scroll">
        <table class="fin-table" style="min-width:1150px">
          <thead><tr>
            <th>Data</th><th>Obra</th><th>Fornecedor</th><th>Documento</th>
            <th>Tipo</th><th>Direção</th><th style="text-align:right">Valor</th><th>Custo</th>
            <th style="text-align:center">Ações</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;

  document.getElementById("stmtBack").addEventListener("click", () => {
    state.selectedId = null;
    state.detail = null;
    renderList();
  });

  root.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    const m = movements.find((x) => x.id === tr.dataset.id);
    if (!m) return;
    tr.querySelector('[data-action="classify"]')?.addEventListener("click", () =>
      openClassifyModal(m, { options: state.options, onSaved: () => openDetail(s.id) })
    );
    tr.querySelector('[data-action="assign"]')?.addEventListener("click", () =>
      openAssignCostModal(m, { options: state.options, onSaved: () => openDetail(s.id) })
    );
  });
}

function movementRowHtml(index) {
  const { projects, suppliers, cards } = state.options;
  const opts = (items, valueKey, labelKey) =>
    items.map((it) => `<option value="${esc(it[valueKey])}">${esc(it[labelKey])}</option>`).join("");
  return `
    <div class="finance-card" data-row="${index}" style="padding:0.9rem;margin-bottom:0.75rem">
      <div class="finance-form-grid finance-form-grid--3">
        <div class="finance-field">
          <label class="finance-label">Data</label>
          <input class="finance-input" type="date" data-f="movementDate" />
        </div>
        <div class="finance-field">
          <label class="finance-label">Direção</label>
          <select class="finance-select" data-f="direction">
            <option value="SAIDA">Saída</option>
            <option value="ENTRADA">Entrada</option>
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label">Valor</label>
          <input class="finance-input" type="number" min="0" step="0.01" data-f="amount" />
        </div>
        <div class="finance-field">
          <label class="finance-label">Tipo</label>
          <select class="finance-select" data-f="movementType">
            ${opts(
              Object.entries(MOVEMENT_TYPE).map(([k, v]) => ({ id: k, name: v.label })),
              "id",
              "name"
            )}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label">Obra</label>
          <select class="finance-select" data-f="projectId"><option value="">—</option>${opts(projects, "id", "name")}</select>
        </div>
        <div class="finance-field">
          <label class="finance-label">Fornecedor</label>
          <select class="finance-select" data-f="supplierId"><option value="">—</option>${opts(suppliers, "id", "name")}</select>
        </div>
        <div class="finance-field">
          <label class="finance-label">Tipo Doc</label>
          <select class="finance-select" data-f="docType">
            <option value="">—</option>
            ${opts(
              Object.entries(DOC_TYPE).map(([k, v]) => ({ id: k, name: v })),
              "id",
              "name"
            )}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label">Nº Doc</label>
          <input class="finance-input" type="text" data-f="docNumber" />
        </div>
        <div class="finance-field">
          <label class="finance-label">Descrição</label>
          <input class="finance-input" type="text" data-f="description" />
        </div>
        <div class="finance-field finance-field--full">
          <label class="finance-check">
            <input type="checkbox" data-f="isMerchandise" />
            Compra de mercadorias (custo via saída de stock)
          </label>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:0.5rem">
        <button type="button" class="finance-btn finance-btn--ghost" data-remove="${index}">
          <span class="material-symbols-outlined">delete</span>Remover
        </button>
      </div>
    </div>`;
}

function openImportModal() {
  const { cards } = state.options;
  openModal({
    title: "Importar Extrato Bancário",
    contentHtml: `
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field finance-field--full">
          <label class="finance-label" for="st_name">Nome do extrato <span style="color:#dc2626">*</span></label>
          <input id="st_name" class="finance-input" type="text" required placeholder="Ex.: Extrato Caixa Outubro" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_card">Cartão</label>
          <select id="st_card" class="finance-select">
            <option value="">—</option>
            ${cards
              .map((c) => `<option value="${esc(c.id)}">${esc(c.label)}${c.lastDigits ? ` ••••${esc(c.lastDigits)}` : ""}</option>`)
              .join("")}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_file">Ficheiro</label>
          <input id="st_file" class="finance-input" type="text" placeholder="nome-do-ficheiro.pdf" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_start">Início do período</label>
          <input id="st_start" class="finance-input" type="date" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_end">Fim do período</label>
          <input id="st_end" class="finance-input" type="date" />
        </div>
      </div>
      <p class="finance-section-title">Movimentos</p>
      <div id="importRows"></div>
      <div style="display:flex;justify-content:flex-start;margin-top:0.5rem">
        <button type="button" id="importAddRow" class="finance-btn finance-btn--ghost">
          <span class="material-symbols-outlined">add</span>Adicionar movimento
        </button>
      </div>`,
    primaryLabel: "Importar",
    onRender: ({ panel }) => {
      const rows = panel.querySelector("#importRows");
      let counter = 0;
      const addRow = () => {
        rows.insertAdjacentHTML("beforeend", movementRowHtml(counter));
        counter += 1;
      };
      addRow();
      panel.querySelector("#importAddRow").addEventListener("click", addRow);
      rows.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-remove]");
        if (btn) btn.closest("[data-row]").remove();
      });
    },
    onPrimary: async ({ btn, close, panel }) => {
      const name = panel.querySelector("#st_name").value.trim();
      if (!name) return toast("Indique o nome do extrato.", { type: "error" });

      const movements = [];
      for (const row of panel.querySelectorAll("#importRows [data-row]")) {
        const val = (f) => row.querySelector(`[data-f="${f}"]`)?.value?.trim() ?? "";
        const amount = Number(val("amount"));
        const date = val("movementDate");
        if (!date || !amount) continue;
        movements.push({
          projectId: row.querySelector('[data-f="projectId"]').value || null,
          supplierId: row.querySelector('[data-f="supplierId"]').value || null,
          docType: row.querySelector('[data-f="docType"]').value || null,
          docNumber: val("docNumber") || null,
          movementType: row.querySelector('[data-f="movementType"]').value || "OUTRO",
          direction: row.querySelector('[data-f="direction"]').value,
          amount,
          movementDate: date,
          description: val("description") || null,
          isMerchandise: row.querySelector('[data-f="isMerchandise"]').checked,
        });
      }

      setButtonLoading(btn, true);
      try {
        await apiRequest("/finance/bank-statements", {
          method: "POST",
          body: {
            name,
            cardId: panel.querySelector("#st_card").value || null,
            fileName: panel.querySelector("#st_file").value.trim() || null,
            periodStart: panel.querySelector("#st_start").value || null,
            periodEnd: panel.querySelector("#st_end").value || null,
            movements,
          },
        });
        toast("Extrato importado.", { type: "success" });
        close();
        await loadStatements();
      } catch (err) {
        toast(err.message || "Falha ao importar extrato.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

async function loadStatements() {
  const root = document.getElementById("stmtRoot");
  if (root) root.innerHTML = `<div class="finance-empty">A carregar extratos…</div>`;
  try {
    const data = await apiRequest("/finance/bank-statements");
    state.statements = data.items || [];
    renderList();
  } catch (err) {
    if (root) root.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar extratos.", { type: "error" });
  }
}

export async function render() {
  try {
    state.options = await loadMovementOptions();
  } catch (err) {
    toast(err.message || "Falha ao carregar opções.", { type: "error" });
    state.options = { projects: [], suppliers: [], categories: [], cards: [] };
  }
  renderShell();
  await loadStatements();
}
