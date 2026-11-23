/**
 * F2 Previsto × Realizado — as duas partes do protótipo (`V.fctl`) que a app
 * ainda não tinha, por baixo do controlo das obras:
 *
 *  - **Estrutura**: os centros de custo gerais (Sede, Frota, outros), com o
 *    orçamento anual indicado em RG8, o realizado, o que falta gastar e a
 *    execução;
 *  - **Pagamentos e recebimentos — últimos 12 meses**: o realizado de cada
 *    mês, numa moeda, com o saldo.
 *
 * Os números vêm de `/finance/cost-centers/summary` e `/finance/flows` (as
 * mesmas fontes do RG8 e do F1/T8).
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtPct, vazio, erro } from "./f2Ui.js";
import { addMonths, monthLabel } from "./fluxosCore.js";

export async function renderEstrutura(el) {
  if (!el) return;
  el.innerHTML = vazio("A carregar…");
  let cc;
  let fl;
  try {
    [cc, fl] = await Promise.all([apiRequest("/finance/cost-centers/summary"), apiRequest("/finance/flows")]);
  } catch (e) {
    el.innerHTML = erro(e.message || "erro");
    return;
  }

  const gerais = (cc.linhas || []).filter((l) => l.tipo === "GERAL" && l.ativo);
  const NAT = { SEDE: "Sede", FROTA: "Frota", OUTRO: "Outro" };
  const estrutura = gerais.length
    ? `<div class="fx2-tw"><table class="fx2-t">
        <thead><tr><th>Centro de custo</th><th>Tipo</th><th class="r">Orçamento</th><th class="r">Realizado</th><th class="r">Por gastar</th><th class="r">Execução</th></tr></thead>
        <tbody>${gerais
          .map((l) => {
            const orc = l.orcamentoAnual;
            const falta = orc === null || orc === undefined ? null : orc - l.realizado;
            return `<tr><td><b>${esc(l.codigo)}</b> <span class="fx2-mut">${esc(l.nome)}</span></td><td class="fx2-mut">${esc(NAT[l.natureza] || "Sede")}</td>
              <td class="r">${orc === null || orc === undefined ? '<a class="fx2-mut" href="/Financeiro/centros-custo" title="Indique o orçamento anual em RG8">—</a>' : fmt(orc)}</td>
              <td class="r">${fmt(l.realizado)}</td>
              <td class="r${falta !== null && falta < 0 ? " f0-neg" : ""}">${falta === null ? "—" : fmt(falta)}</td>
              <td class="r${l.execucao > 1 ? " f0-neg" : ""}">${l.execucao === null ? "—" : fmtPct(l.execucao)}</td></tr>`;
          })
          .join("")}</tbody></table></div>`
    : vazio("Não há centros de custo gerais ativos.");

  // 12 meses até ao atual, só o realizado, na moeda principal.
  const moeda = (fl.moedas || []).includes("AOA") ? "AOA" : fl.moedas?.[0] || "AOA";
  const fim = fl.hoje.slice(0, 7);
  const meses = Array.from({ length: 12 }, (_, i) => addMonths(fim, i - 11));
  const real = (fl.registos || []).filter((r) => r.tipo === "real" && r.moeda === moeda && r.data);
  const soma = (k, lado) => real.filter((r) => r.lado === lado && r.data.startsWith(k)).reduce((s, r) => s + r.valor, 0);
  const linhas = meses.map((k) => ({ k, rec: soma(k, "R"), pag: soma(k, "P") }));
  const tot = linhas.reduce((a, x) => ({ rec: a.rec + x.rec, pag: a.pag + x.pag }), { rec: 0, pag: 0 });
  const fluxo = `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Mês</th><th class="r">Recebimentos</th><th class="r">Pagamentos</th><th class="r">Saldo</th></tr></thead>
      <tbody>${linhas
        .map(
          (x) => `<tr><td>${esc(monthLabel(x.k))}</td><td class="r fcal-in">${x.rec ? fmt(x.rec) : "—"}</td><td class="r fcal-out">${x.pag ? fmt(x.pag) : "—"}</td>
            <td class="r${x.rec - x.pag < 0 ? " f0-neg" : ""}">${x.rec || x.pag ? fmt(x.rec - x.pag) : "—"}</td></tr>`
        )
        .join("")}</tbody>
      <tfoot><tr class="f0-tot"><td>Total</td><td class="r">${fmt(tot.rec)}</td><td class="r">${fmt(tot.pag)}</td><td class="r${tot.rec - tot.pag < 0 ? " f0-neg" : ""}">${fmt(tot.rec - tot.pag)}</td></tr></tfoot>
    </table></div>`;

  el.innerHTML = `
    <section class="finance-card f0-blk"><h3 class="f0-h3">Estrutura <small>· centros de custo gerais (Sede, Frota) · orçamento anual em RG8</small></h3>${estrutura}</section>
    <section class="finance-card f0-blk"><h3 class="f0-h3">Pagamentos e recebimentos — últimos 12 meses <small>· realizado, em ${esc(moeda)}</small></h3>${fluxo}</section>`;
}
