import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { MOVEMENT_TYPE } from "./movementsShared.js";

/**
 * «Regras de Classificação» e «Tipos» — os botões do topo dos Extratos (T3) e
 * da Conciliação (T2), como no protótipo. As regras ficam no servidor
 * (`/finance/bank-rules`): «a descrição contém X» → tipo de movimento.
 */

const edita = () => can("financeiro", "edit");


export function abrirRegras({ regras = [], onSaved } = {}) {
  const ed = edita();
  const opts = (v) => Object.entries(MOVEMENT_TYPE).map(([k, t]) => `<option value="${k}"${k === v ? " selected" : ""}>${esc(t.label)}</option>`).join("");
  const linha = (r = { texto: "", tipo: "TRANSFERENCIA_INTERNA" }) =>
    `<tr><td><input class="finance-input" data-rg="texto" value="${esc(r.texto)}" placeholder="ex.: TRF, LEVANT, COMISS"${ed ? "" : " disabled"}></td><td><select class="finance-input" data-rg="tipo"${ed ? "" : " disabled"}>${opts(r.tipo)}</select></td><td>${ed ? '<button type="button" class="finance-btn finance-btn--sm" data-rgdel="1">×</button>' : ""}</td></tr>`;
  openModal({
    title: "Regras de Classificação",
    width: 720,
    contentHtml: `<p class="fx2-mut t3-small">Ao importar, a descrição de cada movimento é comparada com estas regras, por ordem: a primeira que casa dá o tipo. As que não casam ficam «Pagamento / outro» e classificam-se na Conciliação.</p>
      <table class="fx2-t"><thead><tr><th>A descrição contém</th><th>Tipo</th><th></th></tr></thead><tbody id="rgBody">${(regras.length ? regras : ed ? [undefined] : []).map((r) => linha(r)).join("")}</tbody></table>
      ${ed ? '<button type="button" class="finance-btn finance-btn--sm" id="rgAdd" style="margin-top:8px">+ Regra</button>' : ""}`,
    primaryLabel: ed ? "Gravar regras" : null,
    secondaryLabel: "Fechar",
    onRender: ({ panel }) => {
      panel.querySelector("#rgAdd")?.addEventListener("click", () => panel.querySelector("#rgBody").insertAdjacentHTML("beforeend", linha()));
      panel.addEventListener("click", (e) => {
        if (e.target.closest("[data-rgdel]")) e.target.closest("tr").remove();
      });
    },
    onPrimary: async ({ close, body, btn }) => {
      const items = [...body.querySelectorAll("#rgBody tr")]
        .map((tr) => ({ texto: tr.querySelector('[data-rg="texto"]').value.trim(), tipo: tr.querySelector('[data-rg="tipo"]').value }))
        .filter((r) => r.texto.length >= 2);
      btn.disabled = true;
      try {
        const r = await apiRequest("/finance/bank-rules", { method: "PUT", body: { items } });
        toast(`${(r.items || items).length} regra(s) gravada(s).`, { type: "success" });
        close();
        onSaved?.(r.items || items);
      } catch (err) {
        btn.disabled = false;
        toast(err.message || "Falha ao gravar as regras.", { type: "error" });
      }
    },
  });
}

export function abrirTipos() {
  const DESC = {
    TRANSFERENCIA_INTERNA: "Entre contas e cartões da MBT. Não leva custo.",
    PF: "Pagamento a fornecedor. Leva custo associado.",
    REEMBOLSO: "Devolução de um valor pago.",
    OPERACAO_ANULADA: "Tentativa de pagamento devolvida pelo banco. Não leva custo.",
    RECEBIMENTO_CLIENTE: "Entrada de um cliente: liga-se às faturas.",
    LEVANTAMENTO_ATM: "Levantamento em numerário. O custo associa-se item a item.",
    OUTRO: "Pagamento ou movimento ainda por classificar.",
  };
  openModal({
    title: "Tipos de movimento",
    width: 640,
    contentHtml: `<table class="fx2-t"><thead><tr><th>Tipo</th><th>Para que serve</th></tr></thead><tbody>${Object.entries(MOVEMENT_TYPE)
      .map(([k, t]) => `<tr><td><b>${esc(t.label)}</b></td><td class="fx2-mut">${esc(DESC[k] || "")}</td></tr>`)
      .join("")}</tbody></table>
      <p class="fx2-mut t3-small">Os tipos são os da Conciliação Bancária (T2), onde cada movimento se classifica.</p>`,
    primaryLabel: null,
    secondaryLabel: "Fechar",
  });
}

