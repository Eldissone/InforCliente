import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { meterHtml, num } from "./widgets.js";
import { bindMoneyInputs, readMoney, setMoney } from "./moneyInput.js";

/**
 * Registar o recebimento (parcial ou total) de uma fatura — usado em
 * Registar Faturas e em Contas a Receber › Recebimentos.
 */

export const RECEIPT_METHODS = ["Transferência bancária", "Depósito em conta", "Cheque", "Numerário", "Compensação"];

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
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
      <div class="finance-field" style="margin-top:1.25rem">
        <label class="finance-label" for="rec_movement">Movimento do extrato bancário</label>
        <select id="rec_movement" class="finance-select">
          <option value="">A carregar entradas do extrato…</option>
        </select>
        <small class="pay-hint" id="rec_movementHint">Ligar ao extrato confirma o recebimento na conta bancária (reconciliação).</small>
      </div>
      <div class="finance-form-grid finance-form-grid--2" style="margin-top:1rem">
        <div class="finance-field">
          <label class="finance-label" for="rec_amount">Valor <span class="inv-req">*</span></label>
          <div class="inv-money-input">
            <input id="rec_amount" class="finance-input" data-money required placeholder="0,00" value="${remaining > 0 ? remaining : ""}" />
            <span>${esc(cur)}</span>
          </div>
          <div class="inv-quick">
            <button type="button" data-fill="${remaining}">Total em falta</button>
            <button type="button" data-fill="${(remaining / 2).toFixed(2)}">50%</button>
          </div>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="rec_date">Data <span class="inv-req">*</span></label>
          <input id="rec_date" class="finance-input" type="date" required min="${esc(toDateKey(invoice.docDate))}" max="${toDateKey(new Date())}" value="${toDateKey(new Date())}" />
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
      bindMoneyInputs(panel);
      const amountEl = panel.querySelector("#rec_amount");
      setMoney(amountEl, remaining > 0 ? remaining : 0);
      panel.querySelectorAll("[data-fill]").forEach((btn) => {
        btn.addEventListener("click", () => setMoney(amountEl, Number(btn.dataset.fill)));
      });

      // Entradas do extrato (recebimentos de clientes) ainda por ligar a faturas.
      const sel = panel.querySelector("#rec_movement");
      const hint = panel.querySelector("#rec_movementHint");
      let candidates = [];
      apiRequest(`/finance/invoices/${invoice.id}/movement-candidates`)
        .then((data) => {
          candidates = data.items || [];
          sel.innerHTML =
            `<option value="">${candidates.length ? "Sem ligação ao extrato (ligar depois na Tesouraria)" : "Sem entradas do extrato por ligar"}</option>` +
            candidates
              .map(
                (m) =>
                  `<option value="${esc(m.id)}">${esc(dateOnly(m.movementDate))} · ${esc(money(m.free, cur))} livre${m.account ? ` · ${esc(m.account)}` : ""}${m.description ? ` · ${esc(m.description)}` : ""}${m.sameProject ? " · esta obra" : ""}</option>`
              )
              .join("");
          if (!candidates.length) {
            hint.textContent = "Não há entradas classificadas como «Recebimento de cliente» com valor por ligar. Importe o extrato na Tesouraria para reconciliar.";
          }
        })
        .catch(() => {
          sel.innerHTML = `<option value="">Sem ligação ao extrato</option>`;
        });
      sel.addEventListener("change", () => {
        const m = candidates.find((c) => c.id === sel.value);
        if (!m) return;
        // O recebimento herda a data do movimento e não pode passar o valor livre.
        panel.querySelector("#rec_date").value = toDateKey(m.movementDate);
        if (!readMoney(amountEl) || readMoney(amountEl) > m.free) setMoney(amountEl, Math.min(m.free, remaining));
        const method = panel.querySelector("#rec_method");
        if (!method.value) method.value = "Transferência bancária";
        hint.textContent = `Movimento de ${money(m.amount, cur)} com ${money(m.free, cur)} ainda por ligar a faturas.`;
      });
    },
    onPrimary: async ({ btn, close, panel }) => {
      const amount = readMoney(panel.querySelector("#rec_amount")) || 0;
      const date = panel.querySelector("#rec_date").value;
      const movementId = panel.querySelector("#rec_movement").value || null;
      if (!amount || amount <= 0) return toast("Indique o valor recebido.", { type: "error" });
      if (amount > remaining + 0.005) {
        return toast(`O valor excede o que está em falta (${money(remaining, cur)}).`, { type: "error" });
      }
      if (!date || date > toDateKey(new Date()) || date < toDateKey(invoice.docDate)) {
        return toast("A data do recebimento tem de estar entre a data da fatura e hoje.", { type: "error" });
      }
      setButtonLoading(btn, true);
      try {
        await apiRequest(`/finance/invoices/${invoice.id}/receipts`, {
          method: "POST",
          body: {
            amount,
            receivedDate: date,
            bankMovementId: movementId,
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
