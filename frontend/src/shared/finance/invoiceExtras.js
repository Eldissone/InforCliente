import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { num } from "./widgets.js";
import { bindMoneyInputs, readMoney, setMoney } from "./moneyInput.js";
import { RECEIPT_METHODS } from "./receiptModal.js";

/**
 * Documentos e controlos complementares da faturação:
 *  - nota de crédito sobre uma fatura (anulação total ou parcial);
 *  - garantias retidas pelo cliente e a sua devolução;
 *  - extrato de conta corrente do cliente (imprimir / guardar em PDF).
 */

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ─── Nota de crédito ─────────────────────────────────────────────────────── */

/** Ilíquido ainda por anular numa fatura (descontando notas de crédito já emitidas). */
export function creditableGross(inv) {
  const credited = (inv.creditNotes || []).reduce((a, n) => a - num(n.grossAmount), 0);
  return round2(num(inv.grossAmount) - credited);
}

export function openCreditNoteModal(inv, { onSaved } = {}) {
  const cur = inv.project?.currency || "AOA";
  const creditable = creditableGross(inv);
  const today = toDateKey(new Date());
  const ratioNet = num(inv.grossAmount) > 0 ? num(inv.netAmount) / num(inv.grossAmount) : 0;

  openModal({
    title: `Nota de crédito · ${inv.docNumber || "Fatura"}`,
    width: 720,
    contentHtml: `
      <div class="inv-receipt-head">
        <div><span>V. Ilíquido da fatura</span><strong>${esc(money(inv.grossAmount, cur))}</strong></div>
        <div><span>Por anular</span><strong>${esc(money(creditable, cur))}</strong></div>
        <div><span>Em falta hoje</span><strong class="ov-warn">${esc(money(inv.missingAmount, cur))}</strong></div>
      </div>
      <p class="finance-note" style="margin-top:0.9rem">
        A nota de crédito anula parte (ou a totalidade) da fatura com as mesmas percentagens de IVA, retenção, CAR e garantia.
        O valor anulado deixa de estar em falta; se a fatura já estiver paga, fica um crédito a favor do cliente.
      </p>
      <div class="finance-form-grid finance-form-grid--2" style="margin-top:1rem">
        <div class="finance-field">
          <label class="finance-label" for="nc_number">Nº da nota de crédito <span class="inv-req">*</span></label>
          <input id="nc_number" class="finance-input" type="text" required placeholder="NC 2026/001" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="nc_date">Data <span class="inv-req">*</span></label>
          <input id="nc_date" class="finance-input" type="date" required min="${esc(toDateKey(inv.docDate))}" max="${today}" value="${today}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="nc_gross">V. Ilíquido a anular <span class="inv-req">*</span></label>
          <div class="inv-money-input">
            <input id="nc_gross" class="finance-input" data-money required placeholder="0,00" />
            <span>${esc(cur)}</span>
          </div>
          <div class="inv-quick">
            <button type="button" data-fill="${creditable}">Anular tudo</button>
            <button type="button" data-fill="${round2(creditable / 2)}">50%</button>
          </div>
        </div>
        <div class="finance-field">
          <span class="finance-label">Efeito</span>
          <div class="nc-effect">
            <div><span>Líquido anulado</span><strong id="nc_net" class="ov-neg">—</strong></div>
            <div><span>Em falta depois</span><strong id="nc_after">—</strong></div>
          </div>
        </div>
        <div class="finance-field finance-field--full">
          <label class="finance-label" for="nc_reason">Motivo <span class="inv-req">*</span></label>
          <textarea id="nc_reason" class="finance-textarea" rows="2" required minlength="3" placeholder="Ex.: correção de quantidades do AM-03, desconto acordado, anulação da fatura…"></textarea>
        </div>
      </div>`,
    primaryLabel: "Emitir nota de crédito",
    onRender: ({ panel }) => {
      bindMoneyInputs(panel);
      const gross = panel.querySelector("#nc_gross");
      const refresh = () => {
        const g = readMoney(gross) || 0;
        const net = round2(g * ratioNet);
        const after = round2(num(inv.missingAmount) - net);
        panel.querySelector("#nc_net").textContent = `− ${money(net, cur)}`;
        const afterEl = panel.querySelector("#nc_after");
        afterEl.textContent = after < -0.005 ? `${money(-after, cur)} a favor do cliente` : money(after, cur);
        afterEl.className = after < -0.005 ? "ov-pos" : after > 0.005 ? "ov-warn" : "";
      };
      gross.addEventListener("input", refresh);
      panel.querySelectorAll("[data-fill]").forEach((btn) =>
        btn.addEventListener("click", () => {
          setMoney(gross, Number(btn.dataset.fill));
          refresh();
        })
      );
      refresh();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const g = readMoney(panel.querySelector("#nc_gross")) || 0;
      const reason = panel.querySelector("#nc_reason").value.trim();
      const date = panel.querySelector("#nc_date").value;
      if (g <= 0) return toast("Indique o valor ilíquido a anular.", { type: "error" });
      if (g > creditable + 0.005) return toast(`Só há ${money(creditable, cur)} por anular nesta fatura.`, { type: "error" });
      if (reason.length < 3) return toast("Indique o motivo da nota de crédito.", { type: "error" });
      if (date < toDateKey(inv.docDate) || date > today) {
        return toast("A data tem de estar entre a data da fatura e hoje.", { type: "error" });
      }
      setButtonLoading(btn, true);
      try {
        await apiRequest(`/finance/invoices/${inv.id}/credit-notes`, {
          method: "POST",
          body: { docNumber: panel.querySelector("#nc_number").value.trim(), docDate: date, grossAmount: g, notes: reason },
        });
        toast("Nota de crédito emitida.", { type: "success" });
        close();
        await onSaved?.();
      } catch (err) {
        toast(err.message || "Falha ao emitir a nota de crédito.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

/* ─── Garantias retidas ───────────────────────────────────────────────────── */

export async function openGuaranteesModal({ projectId = "", clientId = "", canEdit = false, canApprove = false, onChanged } = {}) {
  let data = null;
  let openFormFor = null;

  const load = async () => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (clientId) params.set("clientId", clientId);
    data = await apiRequest(`/finance/guarantees?${params.toString()}`);
  };

  const formHtml = (item) => {
    const today = toDateKey(new Date());
    return `
      <tr class="gr-form-row"><td colspan="5">
        <div class="gr-form" data-form="${esc(item.project.id)}">
          <div class="finance-field">
            <label class="finance-label">Valor devolvido <span class="inv-req">*</span></label>
            <input class="finance-input" data-money data-f="amount" placeholder="0,00" />
            <div class="inv-quick">
              <button type="button" data-fill="${item.outstanding}">Tudo</button>
              <button type="button" data-fill="${round2(item.outstanding / 2)}">50%</button>
            </div>
          </div>
          <div class="finance-field">
            <label class="finance-label">Data <span class="inv-req">*</span></label>
            <input class="finance-input" type="date" data-f="date" max="${today}" value="${today}" />
          </div>
          <div class="finance-field">
            <label class="finance-label">Meio</label>
            <select class="finance-select" data-f="method">
              <option value="">—</option>
              ${RECEIPT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("")}
            </select>
          </div>
          <div class="finance-field">
            <label class="finance-label">Notas</label>
            <input class="finance-input" data-f="notes" placeholder="Ex.: receção provisória" />
          </div>
          <div class="gr-form-actions">
            <button type="button" class="finance-btn finance-btn--ghost" data-cancel>Cancelar</button>
            <button type="button" class="finance-btn finance-btn--primary" data-save="${esc(item.project.id)}">Registar devolução</button>
          </div>
        </div>
      </td></tr>`;
  };

  const bodyHtml = () => {
    const items = data?.items || [];
    const t = data?.totals || { retained: 0, released: 0, outstanding: 0 };
    if (!items.length) {
      return `<div class="ov-empty ov-empty--lg"><span class="material-symbols-outlined">verified_user</span>Não há garantias retidas nas faturas deste filtro.</div>`;
    }
    const rows = items
      .map((item) => {
        const cur = item.project.currency || "AOA";
        const history = item.releases.length
          ? `<ul class="inv-receipts">${item.releases
              .map(
                (r) => `
              <li>
                <span>${esc(dateOnly(r.releasedDate))}</span>
                <strong>${esc(money(r.amount, cur))}</strong>
                <span class="ov-muted">${esc([r.method, r.notes].filter(Boolean).join(" · ") || "—")}</span>
                ${canApprove ? `<button type="button" class="inv-link-btn inv-link-btn--danger" data-undo="${esc(r.id)}"><span class="material-symbols-outlined">undo</span>Anular</button>` : ""}
              </li>`
              )
              .join("")}</ul>`
          : "";
        return `
        <tr>
          <td>
            <div class="ov-project">
              <span class="ov-project-name">${esc(item.project.name)}</span>
              <span class="ov-project-meta">${esc([item.project.code, item.project.client?.name].filter(Boolean).join(" · "))}</span>
            </div>
          </td>
          <td class="fin-num">${esc(money(item.retained, cur))}</td>
          <td class="fin-num ov-pos">${esc(money(item.released, cur))}</td>
          <td class="fin-num ${item.outstanding > 0 ? "ov-warn" : ""}"><strong>${esc(money(item.outstanding, cur))}</strong></td>
          <td style="text-align:right">
            ${
              canEdit && item.outstanding > 0.005
                ? `<button type="button" class="finance-btn finance-btn--ghost gr-release-btn" data-release="${esc(item.project.id)}">
                     <span class="material-symbols-outlined">savings</span>Devolução
                   </button>`
                : ""
            }
          </td>
        </tr>
        ${history ? `<tr class="gr-history-row"><td colspan="5">${history}</td></tr>` : ""}
        ${openFormFor === item.project.id ? formHtml(item) : ""}`;
      })
      .join("");
    return `
      <div class="inv-receipt-head">
        <div><span>Retido nas faturas</span><strong>${esc(money(t.retained))}</strong></div>
        <div><span>Já devolvido</span><strong class="ov-pos">${esc(money(t.released))}</strong></div>
        <div><span>Por devolver</span><strong class="ov-warn">${esc(money(t.outstanding))}</strong></div>
      </div>
      <p class="finance-note" style="margin:0.9rem 0">
        A garantia de boa execução é descontada em cada fatura e devolvida pelo cliente com a receção da obra.
        O valor por devolver é dinheiro a receber que não aparece no «Em falta» das faturas.
      </p>
      <div class="finance-table-scroll">
        <table class="fin-table gr-table">
          <thead><tr>
            <th>Obra</th>
            <th style="text-align:right">Retido</th>
            <th style="text-align:right">Devolvido</th>
            <th style="text-align:right">Por devolver</th>
            <th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  try {
    await load();
  } catch (err) {
    return toast(err.message || "Falha ao carregar as garantias.", { type: "error" });
  }

  openModal({
    title: "Garantias retidas",
    width: 920,
    contentHtml: `<div id="grBody">${bodyHtml()}</div>`,
    primaryLabel: null,
    secondaryLabel: "Fechar",
    onRender: ({ panel }) => {
      const body = panel.querySelector("#grBody");
      const rerender = () => {
        body.innerHTML = bodyHtml();
        bind();
      };
      const reload = async () => {
        await load();
        rerender();
        await onChanged?.();
      };
      function bind() {
        bindMoneyInputs(body);
        body.querySelectorAll("[data-release]").forEach((btn) =>
          btn.addEventListener("click", () => {
            openFormFor = openFormFor === btn.dataset.release ? null : btn.dataset.release;
            rerender();
            body.querySelector('[data-f="amount"]')?.focus();
          })
        );
        body.querySelector("[data-cancel]")?.addEventListener("click", () => {
          openFormFor = null;
          rerender();
        });
        body.querySelectorAll("[data-fill]").forEach((btn) =>
          btn.addEventListener("click", () => setMoney(body.querySelector('[data-f="amount"]'), Number(btn.dataset.fill)))
        );
        body.querySelector("[data-save]")?.addEventListener("click", async (e) => {
          const form = body.querySelector("[data-form]");
          const f = (k) => form.querySelector(`[data-f="${k}"]`);
          const item = data.items.find((i) => i.project.id === form.dataset.form);
          const amount = readMoney(f("amount")) || 0;
          if (amount <= 0) return toast("Indique o valor devolvido.", { type: "error" });
          if (amount > item.outstanding + 0.005) {
            return toast(`Só há ${money(item.outstanding)} por devolver nesta obra.`, { type: "error" });
          }
          if (!f("date").value || f("date").value > toDateKey(new Date())) {
            return toast("Indique uma data até hoje.", { type: "error" });
          }
          const btn = e.currentTarget;
          setButtonLoading(btn, true);
          try {
            await apiRequest(`/finance/projects/${item.project.id}/guarantee-releases`, {
              method: "POST",
              body: { amount, releasedDate: f("date").value, method: f("method").value || null, notes: f("notes").value.trim() || null },
            });
            toast("Devolução de garantia registada.", { type: "success" });
            openFormFor = null;
            await reload();
          } catch (err) {
            toast(err.message || "Falha ao registar a devolução.", { type: "error" });
            setButtonLoading(btn, false);
          }
        });
        body.querySelectorAll("[data-undo]").forEach((btn) =>
          btn.addEventListener("click", async () => {
            if (!window.confirm("Anular esta devolução de garantia? O valor volta a ficar por devolver.")) return;
            try {
              await apiRequest(`/finance/guarantee-releases/${btn.dataset.undo}`, { method: "DELETE" });
              toast("Devolução anulada.", { type: "success" });
              await reload();
            } catch (err) {
              toast(err.message || "Falha ao anular.", { type: "error" });
            }
          })
        );
      }
      bind();
    },
  });
}

/* ─── Extrato de conta corrente ───────────────────────────────────────────── */

export function openStatementModal({ clients = [], clientId = "" } = {}) {
  const today = toDateKey(new Date());
  const yearStart = `${today.slice(0, 4)}-01-01`;
  openModal({
    title: "Extrato de conta corrente do cliente",
    width: 620,
    contentHtml: `
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field finance-field--full">
          <label class="finance-label" for="st_client">Cliente <span class="inv-req">*</span></label>
          <select id="st_client" class="finance-select" required>
            <option value="">Selecionar cliente…</option>
            ${clients.map((c) => `<option value="${esc(c.id)}" ${c.id === clientId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_from">De</label>
          <input id="st_from" class="finance-input" type="date" value="${yearStart}" max="${today}" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="st_to">Até</label>
          <input id="st_to" class="finance-input" type="date" value="${today}" max="${today}" />
        </div>
      </div>
      <p class="finance-note" style="margin-top:0.9rem">
        Abre o extrato numa nova janela, pronto a imprimir ou a guardar em PDF para enviar ao cliente.
        Os movimentos antes da data «De» entram no saldo inicial.
      </p>`,
    primaryLabel: "Gerar extrato",
    onPrimary: async ({ btn, close, panel }) => {
      const id = panel.querySelector("#st_client").value;
      const from = panel.querySelector("#st_from").value;
      const to = panel.querySelector("#st_to").value;
      if (!id) return toast("Escolha o cliente.", { type: "error" });
      if (from && to && from > to) return toast("A data «De» tem de ser anterior a «Até».", { type: "error" });
      // A janela abre já (no clique), para não ser bloqueada pelo navegador.
      const win = window.open("", "_blank");
      if (!win) return toast("O navegador bloqueou a nova janela. Permita pop-ups para este site.", { type: "error" });
      win.document.write(`<p style="font-family:sans-serif;padding:2rem">A preparar o extrato…</p>`);
      setButtonLoading(btn, true);
      try {
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const data = await apiRequest(`/finance/clients/${id}/statement?${params.toString()}`);
        win.document.open();
        win.document.write(statementHtml(data));
        win.document.close();
        close();
      } catch (err) {
        win.close();
        toast(err.message || "Falha ao gerar o extrato.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

const LINE_TYPES = {
  FATURA: "Fatura",
  ADIANTAMENTO: "Adiantamento",
  NOTA_CREDITO: "Nota de crédito",
  RECEBIMENTO: "Recebimento",
};

function statementHtml(data) {
  const m = (v) => (Math.abs(Number(v) || 0) < 0.005 ? "" : formatCurrency(Number(v) || 0, "AOA").replace(/\s*Kz$/, ""));
  const bal = (v) => formatCurrency(Number(v) || 0, "AOA").replace(/\s*Kz$/, "");
  const period = [data.from ? `de ${dateOnly(data.from)}` : "desde o início", data.to ? `até ${dateOnly(data.to)}` : ""].filter(Boolean).join(" ");
  const rows = data.lines
    .map(
      (l) => `
      <tr>
        <td>${esc(dateOnly(l.date))}</td>
        <td>${esc(LINE_TYPES[l.type] || l.type)}</td>
        <td>${esc(l.document || "—")}</td>
        <td>${esc(l.project?.name || "")}<div class="muted">${esc(l.description || "")}${l.dueDate ? ` · vence ${esc(dateOnly(l.dueDate))}` : ""}</div></td>
        <td class="num">${m(l.debit)}</td>
        <td class="num">${m(l.credit)}</td>
        <td class="num strong">${bal(l.balance)}</td>
      </tr>`
    )
    .join("");
  const g = data.guarantees || {};
  return `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8" />
<title>Extrato · ${esc(data.client.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Inter", "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px 40px; font-size: 12px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 14px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #64748b; font-size: 11px; }
  .meta { text-align: right; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
  .card span { display: block; color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; }
  .card strong { font-size: 15px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 8px 6px; }
  td { padding: 7px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; }
  tfoot td { border-top: 2px solid #0f172a; font-weight: 700; }
  .opening td { background: #f8fafc; font-style: italic; }
  .neg { color: #b91c1c; }
  .note { margin-top: 18px; padding: 10px 12px; background: #f8fafc; border-radius: 10px; }
  .toolbar { position: fixed; top: 12px; right: 16px; }
  .toolbar button { background: #0f172a; color: #fff; border: 0; border-radius: 10px; padding: 9px 16px; font-weight: 700; cursor: pointer; }
  @media print { .toolbar { display: none; } body { padding: 0; } @page { margin: 14mm; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <header>
    <div>
      <h1>Extrato de conta corrente</h1>
      <div><strong>${esc(data.client.name)}</strong>${data.client.code ? ` · ${esc(data.client.code)}` : ""}</div>
      <div class="muted">Período ${esc(period)} · valores em Kz</div>
    </div>
    <div class="meta muted">Emitido em ${esc(dateOnly(data.generatedAt))}</div>
  </header>
  <div class="cards">
    <div class="card"><span>Saldo inicial</span><strong>${bal(data.opening)}</strong></div>
    <div class="card"><span>Débitos (faturado)</span><strong>${bal(data.totals.debit)}</strong></div>
    <div class="card"><span>Créditos (recebido e NC)</span><strong>${bal(data.totals.credit)}</strong></div>
    <div class="card"><span>Saldo em dívida</span><strong>${bal(data.totals.closing)}</strong>${data.totals.overdue > 0 ? `<div class="muted neg">${bal(data.totals.overdue)} vencido</div>` : ""}</div>
  </div>
  <table>
    <thead><tr><th>Data</th><th>Tipo</th><th>Documento</th><th>Obra · descrição</th><th class="num">Débito</th><th class="num">Crédito</th><th class="num">Saldo</th></tr></thead>
    <tbody>
      <tr class="opening"><td colspan="6">Saldo inicial</td><td class="num">${bal(data.opening)}</td></tr>
      ${rows || `<tr><td colspan="7" class="muted">Sem movimentos no período.</td></tr>`}
    </tbody>
    <tfoot><tr><td colspan="4">Totais do período</td><td class="num">${bal(data.totals.debit)}</td><td class="num">${bal(data.totals.credit)}</td><td class="num">${bal(data.totals.closing)}</td></tr></tfoot>
  </table>
  <div class="note">
    <strong>Garantias retidas:</strong> ${bal(g.retained)} retidos nas faturas, ${bal(g.released)} devolvidos,
    <strong>${bal(g.outstanding)} por devolver</strong> (não incluídos no saldo acima).
    <div class="muted" style="margin-top:4px">Débito = valor líquido a receber de cada fatura (com IVA, deduzidas retenção, IVA cativo, CAR e garantia).</div>
  </div>
</body></html>`;
}
