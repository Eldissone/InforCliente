import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { can } from "../permissions.js";
import { toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { chartCardHtml, drawAreaChart, destroyCharts, TONES } from "./charts.js";
import {
  MOVEMENT_TYPE,
  DOC_TYPE,
  money,
  dateOnly,
  movementChip,
  directionChip,
  isIncoming,
  needsCostAssignment,
  movementStatusCell,
  parseStatementText,
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
  const inflow = movements.filter(isIncoming).reduce((a, m) => a + (Number(m.amount) || 0), 0);
  const outflow = movements.filter(needsCostAssignment).reduce((a, m) => a + (Number(m.amount) || 0), 0);
  // Só as saídas têm custo para associar (as entradas são recebimentos ou transferências).
  const pending = movements.filter((m) => needsCostAssignment(m) && !m.costAssigned).length;

  const cards = [
    { label: "Movimentos", value: String(movements.length), sub: s.name, tone: "slate", icon: "swap_vert" },
    { label: "Entradas", value: money(inflow), sub: "Total a crédito", tone: "emerald", icon: "south_west" },
    { label: "Saídas", value: money(outflow), sub: "Total a débito", tone: "red", icon: "north_east" },
    { label: "Saídas por Associar", value: String(pending), sub: "Sem custo associado", tone: pending ? "amber" : "emerald", icon: "link_off" },
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
          <td class="fin-num ${isIncoming(m) ? "finance-pos" : "finance-neg"}">${esc(money(m.amount))}</td>
          <td>${movementStatusCell(m)}</td>
          <td>
            <div class="fin-actions">
              <button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Classificar" data-action="classify">
                <span class="material-symbols-outlined" style="font-size:17px">edit_note</span>
              </button>
              ${
                needsCostAssignment(m)
                  ? `<button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Associar Custo" data-action="assign">
                          <span class="material-symbols-outlined" style="font-size:17px">link</span>
                        </button>`
                  : ""
              }
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
    <div class="finance-chart-grid">
      ${chartCardHtml({
        id: "stmtChartMonthly",
        title: "Entradas e saídas do extrato",
        subtitle: "Movimento mês a mês",
        span: 2,
        height: 290,
      })}
    </div>
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
    destroyCharts(root);
    renderList();
  });

  renderDetailCharts(movements);

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

/** Entradas e saídas do extrato agrupadas por mês. */
function renderDetailCharts(movements) {
  const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const keys = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const index = new Map(keys.map((k, i) => [k, i]));
  const inflow = keys.map(() => 0);
  const outflow = keys.map(() => 0);

  movements.forEach((m) => {
    const key = toDateKey(m.movementDate)?.slice(0, 7);
    const i = index.get(key);
    if (i === undefined) return;
    const amount = Number(m.amount) || 0;
    if (isIncoming(m)) inflow[i] += amount;
    else outflow[i] += amount;
  });

  drawAreaChart("stmtChartMonthly", {
    categories: keys.map((k) => {
      const [y, m] = k.split("-").map(Number);
      return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
    }),
    series: [
      { name: "Entradas", key: "received", color: TONES.emerald, data: inflow },
      { name: "Saídas", key: "cost", color: TONES.red, data: outflow },
    ],
    height: 290,
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

      <p class="finance-section-title">Colar do extrato (opcional)</p>
      <div class="finance-field finance-field--full">
        <label class="finance-label" for="st_paste">Uma linha por movimento: data, descrição e valor</label>
        <textarea id="st_paste" class="finance-textarea" rows="4"
          placeholder="2026-10-01; Pagamento fornecedor X; -150000&#10;2026-10-03; Recebimento do cliente; 250000"></textarea>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.4rem">
          <button type="button" id="st_parse" class="finance-btn finance-btn--ghost">
            <span class="material-symbols-outlined">playlist_add</span>Preencher movimentos
          </button>
          <button type="button" id="st_csvBtn" class="finance-btn finance-btn--ghost">
            <span class="material-symbols-outlined">upload_file</span>Carregar CSV
          </button>
          <input id="st_csv" type="file" accept=".csv,text/csv,text/plain" hidden />
        </div>
        <p class="finance-note" id="st_pasteNote">
          Aceita separador «;», tabulação ou «|», e valores com vírgula ou ponto decimal. Valores negativos são
          tratados como saídas. As linhas de cabeçalho são ignoradas.
        </p>
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
      const pasteNote = panel.querySelector("#st_pasteNote");
      let counter = 0;

      // `prefill` permite trazer já os movimentos lidos do extrato colado/CSV.
      const addRow = (prefill = null) => {
        rows.insertAdjacentHTML("beforeend", movementRowHtml(counter));
        const rowEl = rows.lastElementChild;
        if (prefill && rowEl) {
          rowEl.querySelector('[data-f="movementDate"]').value = prefill.movementDate || "";
          rowEl.querySelector('[data-f="amount"]').value = prefill.amount ?? "";
          rowEl.querySelector('[data-f="direction"]').value = prefill.direction || "SAIDA";
          rowEl.querySelector('[data-f="description"]').value = prefill.description || "";
        }
        counter += 1;
      };
      addRow();
      panel.querySelector("#importAddRow").addEventListener("click", () => addRow());
      rows.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-remove]");
        if (btn) btn.closest("[data-row]").remove();
      });

      // Colar / carregar o extrato do banco e criar uma linha por movimento.
      const fillFromText = (text) => {
        const parsed = parseStatementText(text);
        if (!parsed.length) {
          pasteNote.textContent =
            "Não foi possível ler nenhum movimento. Use o formato «data; descrição; valor», uma linha por movimento.";
          return;
        }
        // Se a grelha só tem a linha-modelo vazia, é substituída pelas lidas.
        const onlyPlaceholder = rows.children.length === 1 && !rows.querySelector('[data-f="amount"]')?.value;
        if (onlyPlaceholder) {
          rows.innerHTML = "";
          counter = 0;
        }
        parsed.forEach((movement) => addRow(movement));
        pasteNote.textContent = `${parsed.length} movimento(s) lido(s) do extrato. Confirme a obra, o fornecedor e o tipo de cada um antes de importar.`;
      };

      panel.querySelector("#st_parse").addEventListener("click", () => {
        fillFromText(panel.querySelector("#st_paste").value);
      });

      const csvInput = panel.querySelector("#st_csv");
      panel.querySelector("#st_csvBtn").addEventListener("click", () => csvInput.click());
      csvInput.addEventListener("change", async () => {
        const file = csvInput.files?.[0];
        if (!file) return;
        try {
          fillFromText(await file.text());
        } catch (err) {
          pasteNote.textContent = err.message || "Falha ao ler o ficheiro.";
        }
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
