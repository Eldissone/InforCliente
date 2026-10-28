import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { openCostForm, isAssignableMovement } from "./costForm.js";

/**
 * Utilitários partilhados dos movimentos bancários (Tesouraria):
 * etiquetas, carregamento de opções e modais de classificação / Associar Custo.
 */

export const MOVEMENT_TYPE = {
  TRANSFERENCIA_INTERNA: { label: "Transferência interna", tone: "blue" },
  PF: { label: "PF", tone: "" },
  REEMBOLSO: { label: "Reembolso", tone: "amber" },
  OPERACAO_ANULADA: { label: "Operação anulada", tone: "" },
  RECEBIMENTO_CLIENTE: { label: "Recebimento cliente", tone: "emerald" },
  LEVANTAMENTO_ATM: { label: "Levantamento ATM", tone: "violet" },
  OUTRO: { label: "Pagamento / outro", tone: "" },
};

export const DOC_TYPE = {
  FATURA: "Fatura",
  AF: "Auto de Fatura",
};

export function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

export function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

export function movementChip(type) {
  const t = MOVEMENT_TYPE[type] || { label: type || "—", tone: "" };
  return `<span class="finance-chip ${t.tone ? `finance-chip--${t.tone}` : ""}">${esc(t.label)}</span>`;
}

export function directionChip(direction) {
  if (direction === "ENTRADA") return `<span class="finance-badge finance-badge--emerald">Entrada</span>`;
  return `<span class="finance-badge finance-badge--red">Saída</span>`;
}

/**
 * Regra de negócio partilhada: «Associar Custo» só se aplica a SAÍDAS.
 * Numa entrada não há custo a associar — ou é um recebimento a ligar à fatura
 * do cliente, ou uma transferência interna entre contas/cartões da empresa.
 */
export function isIncoming(movement) {
  return movement?.direction === "ENTRADA";
}

export function needsCostAssignment(movement) {
  return !isIncoming(movement) && isAssignableMovement({ ...movement, costAssigned: false });
}

/**
 * Recebimento todo registado em faturas do cliente. A ligação é guardada no
 * recebimento da fatura (`InvoiceReceipt.bankMovementId`); o servidor devolve
 * o resumo em `receiptLink` (LIGADO / PARCIAL / POR_LIGAR).
 */
export function isReceiptLinked(movement) {
  return movement?.receiptLink?.state === "LIGADO";
}

/** Valor do recebimento ainda por ligar a faturas. */
export function receiptFree(movement) {
  const link = movement?.receiptLink;
  return link ? Number(link.free) || 0 : Number(movement?.amount) || 0;
}

export function receiptStateHtml(movement) {
  const link = movement?.receiptLink || { state: "POR_LIGAR", invoices: [] };
  const docs = (link.invoices || []).map((i) => i.docNumber || "s/ nº").join(", ");
  if (link.state === "LIGADO") {
    return `<span class="finance-chip finance-chip--emerald" title="${esc(docs)}">Ligado · ${esc(docs || "fatura")}</span>`;
  }
  if (link.state === "PARCIAL") {
    return `<span class="finance-chip finance-chip--amber" title="Ligado a ${esc(docs)}">Parcial · falta ${esc(money(link.free))}</span>`;
  }
  return `<span class="finance-chip finance-chip--red">Por ligar</span>`;
}

/** Estado do custo de uma saída: associado, por associar ou mercadoria (via stock). */
export function costStatusHtml(movement) {
  if (isIncoming(movement)) return `<span class="finance-chip finance-chip--slate">Entrada</span>`;
  if (movement.isMerchandise) return `<span class="finance-chip finance-chip--amber" title="O custo nasce na saída de stock para a obra">Via stock</span>`;
  if (!needsCostAssignment(movement) && !movement.costAssigned) return `<span class="finance-chip finance-chip--slate">Sem custo</span>`;
  if (!movement.costAssigned) return `<span class="finance-chip finance-chip--red">Por associar</span>`;
  const n = movement.costSummary?.count || 0;
  return `<span class="finance-chip finance-chip--emerald">Associado${n > 1 ? ` · ${n} custos` : ""}</span>`;
}


/** Lê valores no formato português (1.234,56) ou inglês (1,234.56). */
export function parseMoneyCell(raw) {
  let text = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/Kz|AOA/gi, "");
  if (!text) return null;
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) {
    text =
      text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
  } else if (hasComma) {
    text = text.replace(",", ".");
  } else if (hasDot && /^[+-]?\d{1,3}(\.\d{3})+$/.test(text)) {
    // "45.000" num extrato em português são 45 000. Só tratamos o ponto como
    // separador de milhares quando todos os grupos têm exatamente 3 dígitos
    // ("45.00" e "45.5" continuam a ser valores decimais).
    text = text.replace(/\./g, "");
  }
  const n = Number(text.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Data em AAAA-MM-DD (aceita AAAA-MM-DD e DD/MM/AAAA). */
export function parseDateCell(raw) {
  const text = String(raw || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return `${year}-${String(Number(dmy[2])).padStart(2, "0")}-${String(Number(dmy[1])).padStart(2, "0")}`;
  }
  return null;
}

/**
 * Lê o texto de um extrato colado do banco: uma linha por movimento com
 * `data ; descrição ; valor` (também aceita tabulação ou `|`).
 * Valores negativos são saídas; positivos são entradas.
 */
export function parseStatementText(text) {
  const rows = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const raw = line.trim();
      if (!raw) return;
      const parts = raw
        .split(/[;\t|]/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length < 2) return;
      const movementDate = parseDateCell(parts[0]);
      const value = parseMoneyCell(parts[parts.length - 1]);
      if (!movementDate || value === null || value === 0) return;
      rows.push({
        movementDate,
        amount: Math.abs(value),
        direction: value < 0 ? "SAIDA" : "ENTRADA",
        description: parts.slice(1, -1).join(" · ") || parts[1] || "",
      });
    });
  return rows;
}

/** Carrega obras, fornecedores, categorias de custo e cartões. */
export async function loadMovementOptions() {
  const [projects, suppliers, categories, cards] = await Promise.all([
    apiRequest("/finance/options/projects"),
    apiRequest("/finance/options/suppliers"),
    apiRequest("/finance/options/cost-categories"),
    apiRequest("/finance/options/cards"),
  ]);
  return {
    projects: projects.items || [],
    suppliers: suppliers.items || [],
    categories: categories.items || [],
    cards: cards.items || [],
  };
}

function optionsHtml(items, { valueKey = "id", labelKey = "name", selected = "", placeholder = "—" } = {}) {
  const head = placeholder === null ? "" : `<option value="">${esc(placeholder)}</option>`;
  return (
    head +
    items
      .map(
        (it) =>
          `<option value="${esc(it[valueKey])}" ${String(selected ?? "") === String(it[valueKey]) ? "selected" : ""}>${esc(
            it[labelKey]
          )}</option>`
      )
      .join("")
  );
}

function topCategories(categories) {
  return categories.filter((c) => !c.parentId && c.isSelectable !== false);
}

function subCategories(categories, parentId) {
  return categories.filter((c) => c.parentId && String(c.parentId) === String(parentId));
}

/** Modal de classificação: obra, tipo de movimento, fornecedor, doc e categoria. */
export function openClassifyModal(movement, { options, onSaved }) {
  const { projects, suppliers, categories } = options;
  openModal({
    title: "Classificar Movimento",
    contentHtml: `
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field">
          <label class="finance-label" for="mv_project">Obra</label>
          <select id="mv_project" class="finance-select">
            ${optionsHtml(projects, { selected: movement.projectId || "", labelKey: "name" })}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="mv_type">Tipo de Movimento</label>
          <select id="mv_type" class="finance-select">
            ${optionsHtml(
              Object.entries(MOVEMENT_TYPE).map(([k, v]) => ({ id: k, name: v.label })),
              { selected: movement.movementType || "OUTRO", placeholder: null }
            )}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="mv_supplier">Fornecedor</label>
          <select id="mv_supplier" class="finance-select">
            ${optionsHtml(suppliers, { selected: movement.supplierId || "" })}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="mv_docType">Tipo de Documento</label>
          <select id="mv_docType" class="finance-select">
            <option value="">—</option>
            ${optionsHtml(
              Object.entries(DOC_TYPE).map(([k, v]) => ({ id: k, name: v })),
              { selected: movement.docType || "", placeholder: null }
            )}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="mv_docNumber">Nº Documento</label>
          <input id="mv_docNumber" class="finance-input" type="text" value="${esc(movement.docNumber || "")}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="mv_category">Categoria de Custo</label>
          <select id="mv_category" class="finance-select"></select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="mv_subcategory">Subcategoria</label>
          <select id="mv_subcategory" class="finance-select"></select>
        </div>
        <div class="finance-field finance-field--full">
          <label class="finance-label" for="mv_notes">Notas</label>
          <input id="mv_notes" class="finance-input" type="text" value="${esc(movement.notes || "")}" />
        </div>
      </div>`,
    primaryLabel: "Guardar",
    onRender: ({ panel }) => {
      const cat = panel.querySelector("#mv_category");
      const sub = panel.querySelector("#mv_subcategory");
      const fillSubs = () => {
        const subs = subCategories(categories, cat.value);
        sub.innerHTML = optionsHtml(subs, { selected: movement.subcategoryId || "" });
        sub.disabled = !subs.length;
      };
      cat.innerHTML = optionsHtml(topCategories(categories), { selected: movement.costCategoryId || "" });
      fillSubs();
      cat.addEventListener("change", fillSubs);
    },
    onPrimary: async ({ btn, close, panel }) => {
      setButtonLoading(btn, true);
      try {
        await apiRequest(`/finance/bank-movements/${movement.id}`, {
          method: "PATCH",
          body: {
            projectId: panel.querySelector("#mv_project").value || null,
            movementType: panel.querySelector("#mv_type").value,
            supplierId: panel.querySelector("#mv_supplier").value || null,
            docType: panel.querySelector("#mv_docType").value || null,
            docNumber: panel.querySelector("#mv_docNumber").value.trim() || null,
            costCategoryId: panel.querySelector("#mv_category").value || null,
            subcategoryId: panel.querySelector("#mv_subcategory").value || null,
            notes: panel.querySelector("#mv_notes").value.trim() || null,
          },
        });
        toast("Movimento classificado.", { type: "success" });
        close();
        onSaved?.();
      } catch (err) {
        toast(err.message || "Falha ao classificar movimento.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

/**
 * «Associar e Confirmar Custo» de um movimento do extrato — usa o formulário
 * partilhado dos Custos (cria o custo da obra ou liga a um pagamento existente).
 */
export function openAssignCostModal(movement, { options, onSaved }) {
  if (!isAssignableMovement(movement)) {
    return toast(movement.costAssigned ? "Este movimento já tem custo associado." : "Só as saídas de valores têm custo associado.", { type: "error" });
  }
  openCostForm({ movement, options, onSaved });
}
