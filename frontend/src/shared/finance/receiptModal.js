import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { meterHtml, num } from "./widgets.js";

/**
 * Registar o recebimento (parcial ou total) de uma fatura — usado em
 * Registar Faturas e em Contas a Receber › Recebimentos.
 */

export const RECEIPT_METHODS = ["Transferência bancária", "Depósito em conta", "Cheque", "Numerário", "Compensação"];

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

export function openReceiptModal(invoice, { onSaved } = {}) {
  const cur = invoice.project?.currency || "AOA";
  const remaining = num(invoice.missingAmount);
  const net = num(invoice.netAmount);
  const receivedPct = net > 0 ? (num(invoice.receivedAmount) / net) * 100 : 0;
  openModal({
    title: `Registar recebimento · ${invoice.docNumber || "Fatura"}`,
    contentHtml: `
      <div class="inv-receipt-head">
        <div><span>V. Líquido</span><strong>${esc(money(net, cur))}</strong></div>
        <div><span>Já recebido</span><strong class="ov-pos">${esc(money(invoice.receivedAmount, cur))}</strong></div>
        <div><span>Em falta</span><strong class="ov-warn">${esc(money(remaining, cur))}</strong></div>
      </div>
      ${meterHtml([{ value: receivedPct, tone: "emerald" }])}
      <div class="finance-form-grid finance-form-grid--2" style="margin-top:1.25rem">
        <div class="finance-field">
          <label class="finance-label" for="rec_amount">Valor <span class="inv-req">*</span></label>
          <input id="rec_amount" class="finance-input" type="number" min="0" max="${remaining}" step="0.01" required value="${remaining > 0 ? remaining : ""}" />
          <div class="inv-quick">
            <button type="button" data-fill="${remaining}">Total em falta</button>
            <button type="button" data-fill="${(remaining / 2).toFixed(2)}">50%</button>
          </div>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rec_date">Data <span class="inv-req">*</span></label>
          <input id="rec_date" class="finance-input" type="date" required value="${toDateKey(new Date())}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rec_method">Meio</label>
          <select id="rec_method" class="finance-select">
            <option value="">—</option>
            ${RECEIPT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("")}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rec_notes">Notas</label>
          <input id="rec_notes" class="finance-input" type="text" />
        </div>
      </div>`,
    primaryLabel: "Registar recebimento",
    onRender: ({ panel }) => {
      panel.querySelectorAll("[data-fill]").forEach((btn) => {
        btn.addEventListener("click", () => {
          panel.querySelector("#rec_amount").value = btn.dataset.fill;
        });
      });
    },
    onPrimary: async ({ btn, close, panel }) => {
      const amount = Number(panel.querySelector("#rec_amount").value);
      if (!amount || amount <= 0) return toast("Indique o valor recebido.", { type: "error" });
      if (amount > remaining + 0.005) {
        return toast(`O valor excede o que está em falta (${money(remaining, cur)}).`, { type: "error" });
      }
      setButtonLoading(btn, true);
      try {
        await apiRequest(`/finance/invoices/${invoice.id}/receipts`, {
          method: "POST",
          body: {
            amount,
            receivedDate: panel.querySelector("#rec_date").value,
            method: panel.querySelector("#rec_method").value || null,
            notes: panel.querySelector("#rec_notes").value.trim() || null,
          },
        });
        toast("Recebimento registado.", { type: "success" });
        close();
        await onSaved?.();
      } catch (err) {
        toast(err.message || "Falha ao registar recebimento.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}
