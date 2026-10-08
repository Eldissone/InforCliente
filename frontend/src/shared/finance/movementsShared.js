import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

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
  OUTRO: { label: "Outro", tone: "" },
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
 * «Associar Custo» — associa a categoria/subcategoria ao movimento. As compras
 * de mercadorias não podem ter custo direto (o custo vem da saída de stock).
 */
export function openAssignCostModal(movement, { options, onSaved }) {
  const { suppliers, categories } = options;
  const blocked = Boolean(movement.isMerchandise);
  openModal({
    title: "Associar Custo",
    contentHtml: `
      ${
        blocked
          ? `<div class="finance-card" style="border-color:#fecaca;background:#fef2f2;margin-bottom:1rem;padding:1rem">
               <strong style="color:#b91c1c">Compra de mercadorias</strong>
               <p class="finance-note" style="margin:0.4rem 0 0;color:#b91c1c">
                 O custo desta compra é gerado pela saída de stock, pelo que não pode ser associado diretamente.
               </p>
             </div>`
          : ""
      }
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field">
          <label class="finance-label" for="ac_category">Categoria</label>
          <select id="ac_category" class="finance-select"></select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="ac_subcategory">Subcategoria</label>
          <select id="ac_subcategory" class="finance-select"></select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="ac_supplier">Fornecedor</label>
          <select id="ac_supplier" class="finance-select">
            ${optionsHtml(suppliers, { selected: movement.supplierId || "" })}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="ac_docType">Tipo de Documento</label>
          <select id="ac_docType" class="finance-select">
            <option value="">—</option>
            ${optionsHtml(
              Object.entries(DOC_TYPE).map(([k, v]) => ({ id: k, name: v })),
              { selected: movement.docType || "", placeholder: null }
            )}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="ac_docNumber">Nº Documento</label>
          <input id="ac_docNumber" class="finance-input" type="text" value="${esc(movement.docNumber || "")}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="ac_desc">Descrição</label>
          <input id="ac_desc" class="finance-input" type="text" value="${esc(movement.description || "")}" />
        </div>
      </div>`,
    primaryLabel: "Associar Custo",
    onRender: ({ panel }) => {
      const cat = panel.querySelector("#ac_category");
      const sub = panel.querySelector("#ac_subcategory");
      const fillSubs = () => {
        const subs = subCategories(categories, cat.value);
        sub.innerHTML = optionsHtml(subs, { selected: movement.subcategoryId || "" });
        sub.disabled = !subs.length;
      };
      cat.innerHTML = optionsHtml(topCategories(categories), { selected: movement.costCategoryId || "" });
      fillSubs();
      cat.addEventListener("change", fillSubs);
      if (blocked) {
        panel.querySelector("#ac_category").disabled = true;
        panel.querySelector("#ac_subcategory").disabled = true;
      }
    },
    onPrimary: async ({ btn, close, panel }) => {
      if (blocked) {
        return toast("Mercadoria: o custo é gerado pela saída de stock.", { type: "error" });
      }
      setButtonLoading(btn, true);
      try {
        await apiRequest(`/finance/bank-movements/${movement.id}/assign-cost`, {
          method: "POST",
          body: {
            costCategoryId: panel.querySelector("#ac_category").value || null,
            subcategoryId: panel.querySelector("#ac_subcategory").value || null,
            supplierId: panel.querySelector("#ac_supplier").value || null,
            docType: panel.querySelector("#ac_docType").value || null,
            docNumber: panel.querySelector("#ac_docNumber").value.trim() || null,
            description: panel.querySelector("#ac_desc").value.trim() || null,
          },
        });
        toast("Custo associado.", { type: "success" });
        close();
        onSaved?.();
      } catch (err) {
        toast(err.message || "Falha ao associar custo.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}
