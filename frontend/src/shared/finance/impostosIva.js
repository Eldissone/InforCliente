/**
 * G3 IVA e Retenções — o `V.fret` do protótipo.
 *
 * Apuramento indicativo, mês a mês (12 meses): IVA liquidado nas faturas
 * emitidas, IVA suportado nos pedidos de pagamento a fornecedores, retenções
 * na fonte feitas pela MBT (a entregar ao Estado) e sofridas (retidas pelos
 * clientes). Clicar num mês mostra as retenções feitas nesse mês.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, codigoNoCabecalho, vazio, erro } from "./f2Ui.js";
import { monthLabel } from "./fluxosCore.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, erro: null, mes: "" };

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const { meses, sel, retencoes } = S.d;
  el.innerHTML = `
    <p class="fx2-lead">Apuramento indicativo, mês a mês: IVA liquidado nas faturas emitidas, IVA suportado nos pedidos de pagamento a
      fornecedores, retenções na fonte feitas pela MBT (a entregar ao Estado) e sofridas (retidas pelos clientes). Valores em AOA.</p>
    <div class="cm-note is-warn g3-nota">Valores de apoio à preparação das declarações; a declaração oficial é feita no Portal do Contribuinte
      da AGT e deve ser validada pela contabilidade. O IVA suportado só é dedutível com fatura válida.</div>
    <section class="fx2-blk"><div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Mês</th><th class="r">IVA liquidado</th><th class="r">IVA suportado</th><th class="r">IVA a entregar (estimativa)</th><th class="r">Retenções feitas (a entregar)</th><th class="r">Retenções sofridas</th></tr></thead>
      <tbody>${meses
        .map((m) => {
          const cred = m.aEntregar < 0;
          return `<tr class="fx2-k-row${m.k === sel ? " t4-on" : ""}" data-g3mes="${m.k}"><td><b>${esc(monthLabel(m.k))}</b></td>
            <td class="r">${fmt(m.liq)}</td><td class="r">${fmt(m.ded)}</td>
            <td class="r${cred ? " fcal-in" : ""}">${fmt(m.aEntregar)}${cred ? ' <small>(crédito)</small>' : ""}</td>
            <td class="r">${fmt(m.rfE)}</td><td class="r">${fmt(m.rfS)}</td></tr>`;
        })
        .join("")}</tbody></table></div></section>
    <section class="fx2-blk"><h3>Retenções feitas em ${esc(monthLabel(sel))}</h3>${
      retencoes.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Pedido</th><th>Fornecedor</th><th>NIF</th><th class="r">Base</th><th class="r">Retenção</th></tr></thead><tbody>${retencoes
            .map(
              (r) => `<tr><td><a href="/Financeiro/centro-pagamentos"><b>${esc(r.numero)}</b></a></td><td>${esc(r.fornecedor)}</td><td class="fx2-mut">${esc(r.nif || "")}</td>
                <td class="r">${fmt(r.base)}</td><td class="r">${fmt(r.retencao)}</td></tr>`
            )
            .join("")}</tbody><tfoot><tr class="f0-tot"><td colspan="4">Total</td><td class="r">${fmt(retencoes.reduce((s, r) => s + r.retencao, 0))}</td></tr></tfoot></table></div>`
        : `<p class="fx2-mut">Sem retenções neste mês.</p>`
    }</section>`;
}

async function carregar() {
  try {
    S.d = await apiRequest(`/finance/taxes/vat${S.mes ? `?mes=${S.mes}` : ""}`);
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  codigoNoCabecalho("G3");
  root().addEventListener("click", (e) => {
    const r = e.target.closest("[data-g3mes]");
    if (!r) return;
    S.mes = r.dataset.g3mes;
    carregar();
  });
  desenhar();
  await carregar();
}
