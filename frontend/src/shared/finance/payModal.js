import { apiRequest, apiUpload } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey, dateInputToUtcNoonIso } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { num } from "./widgets.js";

/**
 * Pagar / confirmar o pagamento de uma conta a pagar (Contas › Pagamentos).
 *
 * Usa os fluxos de liquidação que já existem para cada fonte — assim o
 * pagamento tem os mesmos efeitos que nos outros ecrãs (frete passa a pago,
 * notificações, débito no fundo de maneio…):
 *  - Pagamento / Cotação → PATCH /cost-centers/:cc/payments/:id (CONFIRMADO, comprovativo obrigatório);
 *  - Pedido extra aprovado → POST /extra-requests/:id/pay;
 *  - Lançamento → PATCH /projects/:id/transactions/:tx/liquidate;
 *  - Encomenda aprovada → POST /purchase-orders/:id/pay (liquida a encomenda toda).
 */

const PAYMENT_METHODS = ["Transferência", "Banco", "Multicaixa", "Cheque", "Caixa"];

const EXTRA_SOURCE_LABEL = {
  FUNDO_MANEIO: "Fundo de maneio",
  SOLICITACAO_TRANSFERENCIA: "Transferência bancária",
  TRANSFERENCIA_INTERNA_CARTAO: "Carregamento de cartão",
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

/** Pode ser pago a partir de Contas › Pagamentos? */
export function canPayHere(item) {
  if (item.stage !== "A_PAGAR") return false;
  if (item.source === "PAGAMENTO") return Boolean(item.costCenterId);
  if (item.source === "PEDIDO_EXTRA") return item.status === "APROVADO";
  if (item.source === "LANCAMENTO") return Boolean(item.projectId);
  if (item.source === "PEDIDO_COMPRA") return ["APROVADO", "EM_PAGAMENTO"].includes(item.status);
  return false;
}

function fileField(id, label, { required = false, hint = "" } = {}) {
  return `
    <div class="finance-field">
      <label class="finance-label" for="${id}">${esc(label)}${required ? ` <span class="inv-req">*</span>` : ""}</label>
      <input id="${id}" class="finance-input pay-file" type="file" accept="application/pdf,image/*" />
      ${hint ? `<small class="pay-hint">${esc(hint)}</small>` : ""}
    </div>`;
}

export function openPayModal(item, { onSaved } = {}) {
  const cur = item.currency || item.project?.currency || "AOA";
  const due = num(item.payable);
  const isCost = item.source === "PAGAMENTO";
  const isExtra = item.source === "PEDIDO_EXTRA";
  const isTx = item.source === "LANCAMENTO";
  const isOrder = item.source === "PEDIDO_COMPRA";
  const needsProof = isCost || (isExtra && item.detail === "SOLICITACAO_TRANSFERENCIA");

  const sourceNote = isExtra
    ? `Pedido extra pago por <strong>${esc(EXTRA_SOURCE_LABEL[item.detail] || "—")}</strong>${
        item.detail === "FUNDO_MANEIO" ? " — o valor é debitado do fundo de maneio do centro de custo." : "."
      }`
    : isTx
      ? "Lançamento do centro de custo: confirma o valor final realizado."
      : isOrder
        ? "Liquida a encomenda: todas as prestações em aberto ficam pagas e a encomenda passa a concluída."
      : "O comprovativo é enviado com a notificação de pagamento e fica no arquivo do custo.";

  openModal({
    title: "Pagar conta",
    width: 620,
    contentHtml: `
      <div class="pay-head">
        <div class="pay-head-main">
          <span class="finance-chip finance-chip--slate">${esc(item.sourceLabel || item.source)}</span>
          <strong>${esc(item.supplier || "Sem fornecedor")}</strong>
          <small>${esc([item.docNumber, item.description].filter(Boolean).join(" · "))}</small>
          <small>${esc([item.project?.name, item.costCenter?.name].filter(Boolean).join(" · "))}</small>
        </div>
        <div class="pay-head-amount">
          <span>Por pagar</span>
          <strong>${esc(money(due, cur))}</strong>
          ${item.daysLate > 0 ? `<small class="ov-neg">vencida há ${item.daysLate} dias</small>` : item.dueDate ? `<small>vence ${esc(toDateKey(item.dueDate).split("-").reverse().join("/"))}</small>` : ""}
        </div>
      </div>
      <p class="pay-note"><span class="material-symbols-outlined">info</span><span>${sourceNote}</span></p>
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field">
          <label class="finance-label" for="pay_amount">Valor pago <span class="inv-req">*</span></label>
          <input id="pay_amount" class="finance-input" type="number" min="0" step="0.01" value="${due > 0 ? due : ""}" />
          ${num(item.paidAmount) > 0 ? `<small class="pay-hint">Já pago antes: ${esc(money(item.paidAmount, cur))}</small>` : ""}
        </div>
        ${
          isCost
            ? `
        <div class="finance-field">
          <label class="finance-label" for="pay_date">Data do pagamento <span class="inv-req">*</span></label>
          <input id="pay_date" class="finance-input" type="date" value="${toDateKey(new Date())}" max="${toDateKey(new Date())}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="pay_method">Meio de pagamento</label>
          <select id="pay_method" class="finance-select">
            ${PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("")}
          </select>
        </div>`
            : ""
        }
        ${needsProof || isExtra || isOrder ? fileField("pay_proof", "Comprovativo", { required: needsProof }) : ""}
        ${isCost || isOrder ? fileField("pay_invoice", "Fatura final", { hint: "Opcional — pode anexar mais tarde." }) : ""}
      </div>`,
    primaryLabel: "Confirmar pagamento",
    onPrimary: async ({ btn, close, panel }) => {
      const amount = Number(panel.querySelector("#pay_amount").value);
      if (!amount || amount <= 0) return toast("Indique o valor pago.", { type: "error" });
      const proof = panel.querySelector("#pay_proof")?.files?.[0] || null;
      if (needsProof && !proof) return toast("Anexe o comprovativo do pagamento.", { type: "error" });
      if (amount > due + 0.005 && !window.confirm(`O valor é superior ao que está por pagar (${money(due, cur)}). Continuar?`)) return;

      setButtonLoading(btn, true);
      try {
        if (isCost) {
          const date = panel.querySelector("#pay_date").value;
          if (!date) {
            setButtonLoading(btn, false);
            return toast("Indique a data do pagamento.", { type: "error" });
          }
          const fd = new FormData();
          fd.append("status", "CONFIRMADO");
          // O custo guarda o total pago (o que já tinha sido pago + este pagamento).
          fd.append("paidAmount", String(Math.round((num(item.paidAmount) + amount) * 100) / 100));
          fd.append("confirmedAt", dateInputToUtcNoonIso(date));
          fd.append("paymentMethod", panel.querySelector("#pay_method").value);
          fd.append("comprovativo", proof);
          const invoice = panel.querySelector("#pay_invoice")?.files?.[0];
          if (invoice) fd.append("fatura", invoice);
          await apiUpload(`/cost-centers/${encodeURIComponent(item.costCenterId)}/payments/${encodeURIComponent(item.sourceId)}`, fd, "PATCH");
        } else if (isExtra) {
          const fd = new FormData();
          fd.append("paidAmount", String(amount));
          if (proof) fd.append("comprovativo", proof);
          await apiUpload(`/extra-requests/${encodeURIComponent(item.sourceId)}/pay`, fd, "POST");
        } else if (isOrder) {
          const fd = new FormData();
          fd.append("paidAmount", String(amount));
          if (proof) fd.append("comprovativo", proof);
          const invoice = panel.querySelector("#pay_invoice")?.files?.[0];
          if (invoice) fd.append("fatura", invoice);
          await apiUpload(`/purchase-orders/${encodeURIComponent(item.sourceId)}/pay`, fd, "POST");
        } else if (isTx) {
          await apiRequest(`/projects/${encodeURIComponent(item.projectId)}/transactions/${encodeURIComponent(item.sourceId)}/liquidate`, {
            method: "PATCH",
            body: { realizedAmount: amount },
          });
        }
        toast(`Pagamento de ${money(amount, cur)} registado.`, { type: "success" });
        close();
        onSaved?.();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Não foi possível registar o pagamento.", { type: "error" });
      }
    },
  });
}
