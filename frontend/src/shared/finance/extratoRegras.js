import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { MOVEMENT_TYPE } from "./movementsShared.js";

/**
 * «Regras de Classificação Automática» e «Tipos» — os botões do topo dos
 * Extratos (T3) e da Conciliação (T2), como no protótipo (FXDRAW.regras).
 *
 * Cada regra: «A descrição contém» · Sinal (qualquer / saída / entrada) ·
 * Tipo · Obra / CC (opcional). A primeira que corresponde ganha. Aplicam-se
 * ao importar e em «⟳ Aplicar regras»: classificam os movimentos sem tipo e
 * voltam a classificar os que foram classificados por regras — nunca um tipo
 * escolhido à mão nem um movimento já conciliado. Ficam no servidor
 * (`/finance/bank-rules`); sem regras gravadas valem as de base.
 */

const edita = () => can("financeiro", "edit");
let PROJETOS = null;

async function projetos() {
  if (PROJETOS) return PROJETOS;
  try {
    const r = await apiRequest("/finance/options/projects");
    PROJETOS = r.items || [];
  } catch {
    PROJETOS = [];
  }
  return PROJETOS;
}

const nomeObra = (p) => [p.referencia, p.name].filter(Boolean).join(" · ") || p.code || p.id;

/**
 * Abre a janela. `regras` é a lista atual; `onSaved(lista)` corre depois de
 * gravar; `onApplied()` depois de «Aplicar Regras»; `cardId` limita a
 * aplicação a uma conta (a escolhida na Conciliação).
 */
export async function abrirRegras({ regras = [], onSaved, onApplied, cardId = null } = {}) {
  const ed = edita();
  let base = [];
  try {
    const r = await apiRequest("/finance/bank-rules");
    base = r.regrasBase || [];
    if (!regras.length) regras = r.items || [];
  } catch {
    /* fica a lista recebida */
  }
  const obras = await projetos();
  const dis = ed ? "" : " disabled";
  const tipos = (v) => Object.entries(MOVEMENT_TYPE).filter(([k]) => k !== "OUTRO").map(([k, t]) => `<option value="${k}"${k === v ? " selected" : ""}>${esc(t.label)}</option>`).join("");
  const obraOpts = (v) =>
    `<option value="">—</option>${obras.map((p) => `<option value="${esc(p.id)}"${p.id === v ? " selected" : ""}>${esc(nomeObra(p))}</option>`).join("")}`;
  const linha = (r = { texto: "", sinal: "", tipo: "PF", projectId: null }) => `<tr>
      <td><input class="finance-input rg-in rg-txt" data-rg="texto" value="${esc(r.texto)}" placeholder="ex.: TRF INT, SUBCONT, MCX-LEV"${dis}></td>
      <td><select class="finance-input rg-in rg-sel" data-rg="sinal"${dis}><option value=""${!r.sinal ? " selected" : ""}>qualquer</option><option value="-"${r.sinal === "-" ? " selected" : ""}>saída</option><option value="+"${r.sinal === "+" ? " selected" : ""}>entrada</option></select></td>
      <td><select class="finance-input rg-in rg-sel" data-rg="tipo"${dis}>${tipos(r.tipo)}</select></td>
      <td><select class="finance-input rg-in rg-obra" data-rg="projectId"${dis}>${obraOpts(r.projectId)}</select></td>
      <td>${ed ? '<button type="button" class="t2-mini rg-del" data-rgdel="1" title="Apagar esta regra">×</button>' : ""}</td></tr>`;
  const corpo = (L) => (L.length ? L : ed ? [undefined] : []).map((r) => linha(r)).join("");
  const ler = (body) =>
    [...body.querySelectorAll("#rgBody tr")]
      .map((tr) => ({
        texto: tr.querySelector('[data-rg="texto"]').value.trim(),
        sinal: tr.querySelector('[data-rg="sinal"]').value,
        tipo: tr.querySelector('[data-rg="tipo"]').value,
        projectId: tr.querySelector('[data-rg="projectId"]').value || null,
      }))
      .filter((r) => r.texto.length >= 2);
  const gravar = async (body) => {
    const items = ler(body);
    const r = await apiRequest("/finance/bank-rules", { method: "PUT", body: { items } });
    onSaved?.(r.items || items);
    return r.items || items;
  };

  openModal({
    title: `<span class="rg-kick">TESOURARIA</span><br>Regras de Classificação Automática`,
    width: 1100,
    contentHtml: `<p class="fx2-mut t3-small">O tipo do movimento (PF, transferência interna, recebimento…) é proposto a partir da descrição do extrato. A primeira regra que corresponder ganha.</p>
      <div class="fx2-tw"><table class="fx2-t rg-t"><thead><tr><th>A descrição contém</th><th>Sinal</th><th>Tipo</th><th>Obra / CC (opcional)</th><th></th></tr></thead><tbody id="rgBody">${corpo(regras)}</tbody></table></div>
      ${ed ? '<button type="button" class="finance-btn finance-btn--sm" id="rgAdd" style="margin-top:8px">+ Nova regra</button>' : ""}
      <p class="fx2-mut t3-small" style="margin-top:10px">As regras aplicam-se ao importar e no botão «⟳ Aplicar regras»: classificam os movimentos sem tipo e voltam a classificar os que foram classificados por regras. Nunca alteram um tipo escolhido à mão nem movimentos já conciliados (com custo associado, mercadoria ou ligados a faturas).</p>
      ${ed ? `<div class="t3-acts"><button type="button" class="finance-btn" id="rgAplicar">⟳ Aplicar Regras aos Movimentos sem Tipo</button><button type="button" class="finance-btn" id="rgRepor">Repor as regras de base</button></div>` : ""}`,
    primaryLabel: ed ? "Gravar regras" : null,
    secondaryLabel: ed ? "Cancelar" : "Fechar",
    onRender: ({ panel }) => {
      const body = panel.querySelector("[data-body]");
      panel.querySelector("#rgAdd")?.addEventListener("click", () => {
        body.querySelector("#rgBody").insertAdjacentHTML("beforeend", linha());
        body.querySelector("#rgBody tr:last-child [data-rg=texto]")?.focus();
      });
      panel.querySelector("#rgRepor")?.addEventListener("click", () => {
        if (!window.confirm("Repor as regras de base? As regras escritas nesta janela são substituídas (só ficam gravadas com «Gravar regras»).")) return;
        body.querySelector("#rgBody").innerHTML = corpo(base);
      });
      panel.querySelector("#rgAplicar")?.addEventListener("click", async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await gravar(body);
          const r = await apiRequest("/finance/bank-rules/apply", { method: "POST", body: { cardId } });
          toast(`Regras gravadas e aplicadas: ${r.classificados} movimento(s) classificado(s)${r.desfeitos ? ` · ${r.desfeitos} voltaram a «sem tipo»` : ""}.`, { type: "success" });
          onApplied?.(r);
        } catch (err) {
          toast(err.data?.message || err.message || "Falha ao aplicar as regras.", { type: "error" });
        } finally {
          b.disabled = false;
        }
      });
      panel.addEventListener("click", (e) => {
        if (e.target.closest("[data-rgdel]")) e.target.closest("tr").remove();
      });
    },
    onPrimary: async ({ close, body, btn }) => {
      btn.disabled = true;
      try {
        const L = await gravar(body);
        toast(`${L.length} regra(s) gravada(s).`, { type: "success" });
        close();
      } catch (err) {
        btn.disabled = false;
        toast(err.data?.message || err.message || "Falha ao gravar as regras.", { type: "error" });
      }
    },
  });
}

/** Aplica as regras gravadas (o botão «⟳ Aplicar regras» da Conciliação). */
export async function aplicarRegras(cardId = null) {
  return apiRequest("/finance/bank-rules/apply", { method: "POST", body: { cardId } });
}

export function abrirTipos() {
  const DESC = {
    TRANSFERENCIA_INTERNA: "Entre contas e cartões da MBT. Concilia-se indicando a outra conta (de onde veio ou para onde foi).",
    PF: "Pagamento a fornecedor. Leva custo associado.",
    REEMBOLSO: "Devolução de um valor pago.",
    OPERACAO_ANULADA: "Tentativa de pagamento devolvida pelo banco. Não leva custo.",
    RECEBIMENTO_CLIENTE: "Entrada de um cliente: liga-se às faturas.",
    LEVANTAMENTO_ATM: "Levantamento em numerário. O custo associa-se item a item.",
    OUTRO: "Sem tipo: pagamento ou movimento ainda por classificar.",
  };
  openModal({
    title: "Tipos de movimento",
    width: 640,
    contentHtml: `<table class="fx2-t"><thead><tr><th>Tipo</th><th>Para que serve</th></tr></thead><tbody>${Object.entries(MOVEMENT_TYPE)
      .map(([k, t]) => `<tr><td><b>${esc(k === "OUTRO" ? "— (sem tipo)" : t.label)}</b></td><td class="fx2-mut">${esc(DESC[k] || "")}</td></tr>`)
      .join("")}</tbody></table>
      <p class="fx2-mut t3-small">Os tipos são os da Conciliação Bancária (T2), onde cada movimento se classifica.</p>`,
    primaryLabel: null,
    secondaryLabel: "Fechar",
  });
}
