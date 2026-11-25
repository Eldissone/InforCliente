import { apiRequest, apiUpload } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey, dateInputToUtcNoonIso } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { num } from "./widgets.js";

const PAYMENT_METHODS = ["Transferência", "Banco", "Multicaixa", "Cheque", "Caixa"];

const EXTRA_SOURCE_LABEL = {
  FUNDO_MANEIO: "Fundo de maneio",
  SOLICITACAO_TRANSFERENCIA: "Transferência bancária",
  TRANSFERENCIA_INTERNA_CARTAO: "Carregamento de cartão",
};

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

export function canPayHere(item) {
  if (item.stage !== "A_PAGAR") return false;
  if (item.source === "PAGAMENTO") return Boolean(item.costCenterId);
  if (item.source === "PEDIDO_EXTRA") return item.status === "APROVADO";
  if (item.source === "LANCAMENTO") return Boolean(item.projectId);
  if (item.source === "PEDIDO_COMPRA") return ["APROVADO", "EM_PAGAMENTO"].includes(item.status) && !item.onHold;
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

export function openPayModal(item, { onSaved, cards = [] } = {}) {
  const cur = item.currency || item.project?.currency || "AOA";
  const due = num(item.payable);
  const isCost = item.source === "PAGAMENTO";
  const isExtra = item.source === "PEDIDO_EXTRA";
  const isTx = item.source === "LANCAMENTO";
  const isOrder = item.source === "PEDIDO_COMPRA";
  const needsProof = isCost || (isExtra && item.detail === "SOLICITACAO_TRANSFERENCIA");
  const defaultCardId = item.typeData?.emTransito?.cardId || "";

  const withheld = num(item.withholdingAmount);
  const sourceNote = isExtra
    ? `Pedido extra pago por <strong>${esc(EXTRA_SOURCE_LABEL[item.detail] || "—")}</strong>${
        item.detail === "FUNDO_MANEIO" ? " — o valor é debitado do fundo de maneio do centro de custo." : "."
      }${
        withheld > 0
          ? ` O documento é de ${esc(money(item.amount, cur))}; ficam retidos ${esc(money(withheld, cur))} de retenção na fonte, a entregar ao Estado.`
          : ""
      }`
    : isTx
      ? "Lançamento do centro de custo: confirma o valor final realizado."
      : isOrder
        ? "Regista o pagamento desta requisição (total ou parcial). O comprovativo fica associado ao pedido."
        : "O comprovativo é enviado com a notificação de pagamento e fica no arquivo do custo.";

  const benefGenHtml = item.benefNome
    ? `<div class="pay-note" style="margin-bottom:8px"><span>Beneficiário da conta: <strong>${esc(item.benefNome)}</strong>${item.iban ? ` · IBAN ${esc(item.iban)}` : ""}</span></div>`
    : "";

  openModal({
    title: isOrder ? `Registar pagamento · ${item.docNumber || ""}` : "Pagar conta",
    width: 640,
    contentHtml: `
      ${benefGenHtml}
      <div class="pay-head">
        <div class="pay-head-main">
          <span class="finance-chip finance-chip--slate">${esc(item.sourceLabel || item.source)}</span>
          <strong>${esc(item.beneficiary || item.supplier || "Sem fornecedor")}</strong>
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
          isCost || isOrder
            ? `
        <div class="finance-field">
          <label class="finance-label" for="pay_date">Data do pagamento <span class="inv-req">*</span></label>
          <input id="pay_date" class="finance-input" type="date" value="${toDateKey(new Date())}" max="${toDateKey(new Date())}" />
        </div>`
            : ""
        }
        ${
          isCost
            ? `
        <div class="finance-field">
          <label class="finance-label" for="pay_method">Meio de pagamento</label>
          <select id="pay_method" class="finance-select">
            ${PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("")}
          </select>
        </div>`
            : isOrder
              ? `
        <div class="finance-field">
          <label class="finance-label" for="pay_card">Conta de saída</label>
          <select id="pay_card" class="finance-select">
            <option value="">— escolher conta —</option>
            ${cards.map((c) => `<option value="${esc(c.id)}" data-label="${esc([c.bank, c.label].filter(Boolean).join(" "))}"${c.id === defaultCardId ? " selected" : ""}>${esc([c.bank, c.label, c.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" "))}</option>`).join("")}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="pay_ref">Referência / N.º operação</label>
          <input id="pay_ref" class="finance-input" type="text" placeholder="ex.: TRF 00124" />
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
          const dt = panel.querySelector("#pay_date")?.value;
          if (dt) fd.append("paidAt", dt);
          const sel = panel.querySelector("#pay_card");
          if (sel?.value) {
            fd.append("cardId", sel.value);
            fd.append("cardLabel", sel.selectedOptions?.[0]?.dataset?.label || sel.selectedOptions?.[0]?.textContent || "");
          }
          const ref = panel.querySelector("#pay_ref")?.value?.trim();
          if (ref) fd.append("reference", ref);
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
