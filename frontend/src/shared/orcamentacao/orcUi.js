import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { AREAS, TT_PROJ, SV_PROJ, ESTADOS, PRICING_DEF } from "./orcCore.js";

/**
 * Orçamentação de Obras — peças comuns aos ecrãs: formatação, pílula do
 * estado, a ficha do orçamento (o «Novo Orçamento» do protótipo) e as listas
 * de clientes.
 */

export { esc };
export const fmt = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtQ = (v) => {
  const x = Number(v) || 0;
  return Math.abs(x - Math.round(x)) < 1e-9 ? x.toLocaleString("pt-PT") : x.toLocaleString("pt-PT", { maximumFractionDigits: 3 });
};
export const fmtD = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—");
export const fmtPct = (v) => (v == null ? "—" : `${Number(v).toLocaleString("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const mLbl = (k) => `${MES[+k.slice(5, 7) - 1]}/${k.slice(2, 4)}`;
const ESTC = { "Em Orçamentação": "warn", "Em Análise pelo Cliente": "neu", "Em Pausa": "neu", Adjudicado: "good", "Não Adjudicado": "bad" };
export const estPill = (s) => `<span class="orc-pill orc-pill--${ESTC[s] || "neu"}">${esc(s || "—")}</span>`;
export const margemTom = (mp, P) => (mp == null ? "" : mp < 0 || mp < Number(P?.mMin ?? 15) ? "bad" : mp < Number(P?.mObj ?? 25) ? "warn" : "good");
export const errMsg = (e) => e?.data?.message || (typeof e?.data?.error === "string" ? e.data.error : null) || e?.message || "Falhou.";

let CLIENTES = null;
export async function clientes() {
  if (CLIENTES) return CLIENTES;
  try {
    const r = await apiRequest("/clients?pageSize=100&sort=name_asc");
    CLIENTES = (r.items || r.data || []).map((c) => ({ id: c.id, name: c.name }));
  } catch {
    CLIENTES = [];
  }
  return CLIENTES;
}

const PROVINCIAS = ["Bengo", "Benguela", "Bié", "Cabinda", "Cuando", "Cubango", "Cuanza Norte", "Cuanza Sul", "Cunene", "Huambo", "Huíla", "Icolo e Bengo", "Luanda", "Lunda Norte", "Lunda Sul", "Malanje", "Moxico", "Moxico Leste", "Namibe", "Uíge", "Zaire", "Fora de Angola"];
const opt = (L, sel, ph) =>
  `${ph != null ? `<option value="">${esc(ph)}</option>` : ""}${L.map((x) => {
    const [v, l] = Array.isArray(x) ? x : [x, x];
    return `<option value="${esc(v)}"${String(sel ?? "") === String(v) ? " selected" : ""}>${esc(l)}</option>`;
  }).join("")}`;
const multi = (name, L, sel) =>
  `<div class="orc-multi">${L.map((v) => `<label><input type="checkbox" data-multi="${name}" value="${esc(v)}"${(sel || []).includes(v) ? " checked" : ""}> ${esc(v)}</label>`).join("")}</div>`;

/** Os campos da ficha (Novo Orçamento e Ficha do Orçamento). */
export function fichaHtml(b = {}, clientesL = [], { comPreco = true } = {}) {
  const f = b.ficha || {};
  const P = { ...PRICING_DEF, ...(b.pricing || {}) };
  const f2 = (label, ctl, cls = "", req = false) => `<label class="t3-f ${cls}"><span>${label}${req ? ' <b class="t3-req">*</b>' : ""}</span>${ctl}</label>`;
  return `<section class="t3-sec"><h3>Informação Geral</h3><div class="t3-grid">
      ${f2("Área de negócio", `<select class="finance-input" name="areaNeg">${opt(AREAS, f.areaNeg || "PROJ", null)}</select>`, "", true)}
      ${f2("Descrição da obra / serviço", `<input class="finance-input" name="name" value="${esc(b.name || "")}" placeholder="ex.: Electrificação rural do Município da Quibala">`, "t3-w2", true)}
      ${f2("Sigla", `<input class="finance-input" name="sigla" value="${esc(f.sigla || "")}" placeholder="ex.: MTR-QUIB" maxlength="16">`)}
      <div class="t3-f t3-w2"><span>Tipos de trabalho</span>${multi("tipos", TT_PROJ, f.tipos)}</div>
      <div class="t3-f t3-w2"><span>Composição de serviços</span>${multi("servicos", SV_PROJ, f.servicos)}</div>
      ${f2("Cliente", `<select class="finance-input" name="clientId">${opt(clientesL.map((c) => [c.id, c.name]), b.clientId || "", "— escolher —")}</select>`, "t3-w2", true)}
      ${f2("Tem subempreiteiro?", `<select class="finance-input" name="temSub">${opt(["Não", "Sim"], f.temSub || "Não", null)}</select>`)}
      ${f2("Província / região", `<select class="finance-input" name="provincia">${opt(PROVINCIAS, f.provincia || "", "— escolher —")}</select>`)}
      ${f2("Localidade / município", `<input class="finance-input" name="local" value="${esc(f.local || "")}">`)}
    </div></section>
    ${
      comPreco
        ? `<section class="t3-sec"><h3>Moeda e Formação do Preço</h3><div class="t3-grid">
      ${f2("Moeda do contrato", `<select class="finance-input" name="currency">${opt(["AOA", "USD", "EUR"], b.currency || "AOA", null)}</select>`)}
      ${f2("Metodologia do preço", `<select class="finance-input" name="metodo">${opt([["MARGEM", "Margem sobre a venda — PV = Custo ÷ (1 − margem)"], ["MARKUP", "Markup sobre o custo — PV = Custo × (1 + markup)"]], P.metodo, null)}</select>`, "t3-w2")}
      ${f2("Margem mínima (%)", `<input class="finance-input" type="number" step="0.1" name="mMin" value="${esc(P.mMin)}">`)}
      ${f2("Margem objetivo (%)", `<input class="finance-input" type="number" step="0.1" name="mObj" value="${esc(P.mObj)}">`)}
    </div><p class="fx2-mut t3-small">Sem IVA no orçamento: a MBT fatura sempre com IVA e retenção na fonte nos serviços.</p></section>`
        : ""
    }
    <section class="t3-sec"><h3>Observações</h3><textarea class="finance-input orc-obs" name="obs" rows="3">${esc(f.obs || "")}</textarea></section>`;
}

/** Lê a ficha do formulário. Devolve { erro } ou os campos para o servidor. */
export function lerFicha(root, clientesL = [], base = {}) {
  const v = (n) => root.querySelector(`[name=${n}]`)?.value?.trim() ?? "";
  const ms = (n) => [...root.querySelectorAll(`[data-multi=${n}]:checked`)].map((i) => i.value);
  const falta = [];
  if (v("name").length < 2) falta.push("a descrição da obra / serviço");
  if (!v("clientId")) falta.push("o cliente");
  if (falta.length) return { erro: `Falta ${falta.join(" e ")}.` };
  const cli = clientesL.find((c) => c.id === v("clientId"));
  const out = {
    name: v("name"),
    clientId: v("clientId"),
    clientName: cli?.name || null,
    ficha: { ...(base.ficha || {}), areaNeg: v("areaNeg") || "PROJ", sigla: v("sigla").toUpperCase(), tipos: ms("tipos"), servicos: ms("servicos"), temSub: v("temSub") || "Não", provincia: v("provincia"), local: v("local"), obs: v("obs") },
  };
  if (root.querySelector("[name=currency]")) {
    out.currency = v("currency") || "AOA";
    out.pricing = { ...(base.pricing || {}), metodo: v("metodo") || "MARGEM", mMin: Number(v("mMin")) || 0, mObj: Number(v("mObj")) || 0 };
  }
  return out;
}

/** «+ Novo Orçamento». */
export async function novoOrcamento() {
  const L = await clientes();
  openModal({
    title: '<span class="rg-kick">NOVO ORÇAMENTO</span><br>Novo Orçamento',
    width: 980,
    contentHtml: `<p class="fx2-mut t3-small">Dados do orçamento. Os prazos e o contrato indicam-se na adjudicação.</p><div data-ficha>${fichaHtml({}, L)}</div>`,
    primaryLabel: "Criar Orçamento",
    secondaryLabel: "Cancelar",
    onPrimary: async ({ body, btn, close }) => {
      const d = lerFicha(body, L);
      if (d.erro) return toast(d.erro, { type: "error" });
      btn.disabled = true;
      try {
        const b = await apiRequest("/work-budgets", { method: "POST", body: d });
        close();
        location.href = `/orcamentacao/orcamento/?id=${encodeURIComponent(b.id)}&v=resumo`;
      } catch (e) {
        btn.disabled = false;
        toast(errMsg(e), { type: "error" });
      }
    },
  });
}

export { ESTADOS };
