import { apiRequest, apiUpload } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * «Conciliar» uma saída do extrato — o FXDRAW.conc do protótipo (versão 624).
 *
 *  - «Ainda não está no Centro de Pagamentos? ＋ Registar o Pagamento e
 *    Conciliar»: abre a Requisição de Pagamento já preenchida com o valor e a
 *    descrição do movimento; ao submeter, o pedido fica pago e conciliado
 *    (só o comprovativo é obrigatório).
 *  - «Escolha o Pedido do Centro de Pagamentos»: pesquisa (n.º, fornecedor,
 *    produto, valor); por omissão só pedidos PF por conciliar, «mostrar todos
 *    os tipos» alarga. Os de valor igual ao movimento vêm primeiro.
 *  - «Confirmar a Conciliação»: regista o pagamento se o pedido ainda não
 *    estava pago, os comprovativos (obrigatórios, pode haver vários) e a
 *    fatura (opcional).
 *  - Sem pedido: «Associar o custo da obra diretamente» (o fluxo antigo).
 */

const fmt = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (iso) => {
  const s = String(iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—";
};
const contaCod = (c) => (c ? [c.bank, c.label].filter(Boolean).join(" ") + (c.lastDigits ? ` •${c.lastDigits}` : "") : "Sem conta");

/**
 * @param {object} m          movimento (saída)
 * @param {object} opts
 * @param {Function} opts.onSaved      depois de conciliar
 * @param {Function} [opts.onCusto]    abre o «Associar custo» antigo
 * @param {string}   [opts.returnTo]   para onde voltar depois de «Registar o Pagamento»
 */
export function abrirConciliarSaida(m, { onSaved, onCusto, returnTo = "/Financeiro/conciliacao" } = {}) {
  const st = { q: "", todos: false, itens: null, pick: null, registar: true, comps: [], fats: [], tempo: null };
  const valor = Number(m.amount) || 0;
  let corpo = null;
  let fechar = null;

  const tabela = () => {
    if (st.itens === null) return '<p class="fx2-mut t3-small">A procurar…</p>';
    if (!st.itens.length) return '<p class="fx2-mut t3-small">Nada encontrado. Procure pelo número ou pelo nome.</p>';
    return `<div class="fx2-tw"><table class="fx2-t cs-t"><thead><tr><th>Requisição</th><th>Venc.</th><th>Terceiro</th><th>Descrição</th><th class="r">Valor</th><th class="r">Já conciliado</th><th>Estado</th><th></th></tr></thead><tbody>
      ${st.itens
        .map(
          (o, i) => `<tr class="${o.proximo ? "cs-prox" : ""}"><td><b>${esc(o.number)}</b></td><td>${fmtD(o.dueDate)}</td><td>${esc(o.terceiro || "—")}</td><td>${esc(o.descricao)}</td>
        <td class="r">${fmt(o.total)}</td><td class="r">${o.conciliado ? fmt(o.conciliado) : "—"}</td>
        <td><span class="t2-pill${o.estado === "Pago" ? " t2-ok" : ""}">${esc(o.estado)}</span></td>
        <td><button type="button" class="finance-btn finance-btn--sm" data-cspick="${i}">Selecionar</button></td></tr>`
        )
        .join("")}</tbody></table></div>`;
  };

  const anexos = (L, tipo) =>
    L.map((f, i) => `<span class="cs-file">📎 ${esc(f.name)} <button type="button" class="t2-mini" data-csdel="${tipo}|${i}" title="Retirar">×</button></span>`).join("");

  const confirmar = () => {
    const o = st.pick;
    const pagoJa = o.estado === "Pago";
    return `<section class="cs-box cs-ok">
      <h4>Confirmar a Conciliação</h4>
      <p>O movimento de <b>${fmt(valor)}</b> com o pedido <b>${esc(o.number)}</b> · ${esc(o.terceiro || "—")} · ${fmt(o.total)} (${esc(o.estado)}).</p>
      ${
        pagoJa
          ? '<p class="fx2-mut t3-small">O pedido já está pago: fica só a ligação ao movimento.</p>'
          : `<label class="cs-chk"><input type="checkbox" data-csreg${st.registar ? " checked" : ""}> o pedido ainda não está pago: registar este movimento como pagamento</label>
             ${st.registar ? `<p class="fx2-mut t3-small">Fica registado um pagamento de <b>${fmt(valor)}</b>${valor < o.falta - 0.5 ? ` (faltam ${fmt(o.falta - valor)} do pedido)` : ""}.</p>` : ""}`
      }
      <div class="cs-doc"><span>Comprovativos de pagamento <b class="t3-req">*</b> <span class="fx2-mut">(pode anexar vários)</span></span>
        <label class="finance-btn finance-btn--sm">Anexar<input type="file" hidden multiple accept=".pdf,image/*" data-csfile="comp"></label>${anexos(st.comps, "comp")}</div>
      <p class="fx2-mut t3-small">Os dados do pedido não batem com o banco (valor, fornecedor, centro de custo)? <a class="t3-lnk" href="/Financeiro/novoPedido?id=${encodeURIComponent(o.id)}&returnTo=${encodeURIComponent(returnTo)}">✎ Editar o pedido ${esc(o.number)}</a> — a informação fica sempre no centro de pagamentos.</p>
      <div class="cs-fat"><b>Fatura</b> <span class="fx2-mut">${st.fats.length ? "" : "ainda sem fatura (opcional — só o comprovativo é obrigatório)"}</span>${anexos(st.fats, "fat")}
        <label class="finance-btn finance-btn--sm finance-btn--primary cs-right">+ Anexar Fatura<input type="file" hidden multiple accept=".pdf,image/*" data-csfile="fat"></label></div>
      <div class="t3-acts"><button type="button" class="finance-btn finance-btn--primary" data-csok>✓ Confirmar conciliação</button><button type="button" class="finance-btn" data-csback>Escolher outro</button></div>
    </section>`;
  };

  const desenhar = () => {
    if (!corpo) return;
    corpo.innerHTML = `
      <section class="cs-box cs-novo"><b>Ainda não está no Centro de Pagamentos?</b>
        <a class="finance-btn finance-btn--primary" href="/Financeiro/novoPedido?movimento=${encodeURIComponent(m.id)}&returnTo=${encodeURIComponent(returnTo)}">＋ Registar o Pagamento e Conciliar</a>
        <span class="fx2-mut t3-small">regista o pedido já pago e conciliado; só o comprovativo é obrigatório</span></section>
      ${
        st.pick
          ? confirmar()
          : `<section class="cs-box"><h4>Escolha o Pedido do Centro de Pagamentos</h4>
        <div class="t3-acts"><input type="search" class="finance-input cs-q" data-csq placeholder="Procurar por n.º, fornecedor, produto, data, valor…" value="${esc(st.q)}">
          <span class="t3-small">${st.todos ? "Todos os tipos de pedido" : "Só pedidos <b>PF — Pagamento a Fornecedor</b> por conciliar"} · <button type="button" class="t3-lnk cs-lnk" data-cstodos>${st.todos ? "só PF" : "mostrar todos os tipos"}</button></span></div>
        ${tabela()}
        <p class="fx2-mut t3-small">Um pedido pode ser conciliado com vários movimentos: concilie cada um com o mesmo pedido.</p></section>`
      }
      ${onCusto ? `<p class="fx2-mut t3-small">Sem pedido de pagamento? <button type="button" class="t3-lnk cs-lnk" data-cscusto>Associar o custo da obra diretamente</button></p>` : ""}`;
    const q = corpo.querySelector("[data-csq]");
    if (q && document.activeElement?.dataset?.csq === undefined && st._foco) {
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
  };

  const procurar = async () => {
    st.itens = null;
    desenhar();
    try {
      const r = await apiRequest(`/purchase-orders/bank-candidates?movementId=${encodeURIComponent(m.id)}&q=${encodeURIComponent(st.q)}${st.todos ? "&todos=1" : ""}`);
      st.itens = r.items || [];
    } catch (e) {
      st.itens = [];
      toast(e.data?.message || e.message || "Falha ao procurar pedidos.", { type: "error" });
    }
    desenhar();
  };

  const gravar = async (btn) => {
    const o = st.pick;
    if (!st.comps.length) return toast("Anexe o comprovativo de pagamento.", { type: "error" });
    btn.disabled = true;
    try {
      const fd = new FormData();
      fd.append("movementId", m.id);
      fd.append("registarPagamento", o.estado !== "Pago" && st.registar ? "1" : "0");
      st.comps.forEach((f) => fd.append("comprovativo", f));
      st.fats.forEach((f) => fd.append("fatura", f));
      await apiUpload(`/purchase-orders/${encodeURIComponent(o.id)}/bank-link`, fd);
      toast(`Conciliado com ${o.number}.`, { type: "success" });
      fechar?.();
      onSaved?.();
    } catch (e) {
      btn.disabled = false;
      toast(e.data?.message || e.message || "Falha ao conciliar.", { type: "error" });
    }
  };

  openModal({
    title: `<span class="rg-kick">CONCILIAR · ${esc(contaCod(m.card))}</span><br>Saída de ${fmt(valor)} AOA<div class="cs-sub">${fmtD(m.movementDate)} · ${esc(m.description || "")}</div>`,
    width: 1000,
    contentHtml: '<div data-cs></div>',
    primaryLabel: null,
    secondaryLabel: "Fechar",
    onRender: ({ panel, close }) => {
      fechar = close;
      corpo = panel.querySelector("[data-cs]");
      corpo.addEventListener("click", (e) => {
        const t = e.target;
        const pk = t.closest("[data-cspick]");
        if (pk) {
          st.pick = st.itens[Number(pk.dataset.cspick)];
          st.registar = st.pick.estado !== "Pago";
          return desenhar();
        }
        if (t.closest("[data-csback]")) {
          st.pick = null;
          return desenhar();
        }
        if (t.closest("[data-cstodos]")) {
          st.todos = !st.todos;
          return procurar();
        }
        if (t.closest("[data-csok]")) return gravar(t.closest("[data-csok]"));
        if (t.closest("[data-cscusto]")) {
          close();
          return onCusto?.();
        }
        const del = t.closest("[data-csdel]");
        if (del) {
          const [tipo, i] = del.dataset.csdel.split("|");
          (tipo === "comp" ? st.comps : st.fats).splice(Number(i), 1);
          return desenhar();
        }
      });
      corpo.addEventListener("change", (e) => {
        const t = e.target;
        if (t.dataset.csreg !== undefined) {
          st.registar = t.checked;
          return desenhar();
        }
        if (t.dataset.csfile) {
          const L = [...(t.files || [])].filter((f) => f.size <= 20 * 1024 * 1024);
          (t.dataset.csfile === "comp" ? st.comps : st.fats).push(...L);
          desenhar();
        }
      });
      corpo.addEventListener("input", (e) => {
        if (e.target.dataset.csq === undefined) return;
        st.q = e.target.value;
        st._foco = true;
        clearTimeout(st.tempo);
        st.tempo = setTimeout(procurar, 300);
      });
      procurar();
    },
  });
}
