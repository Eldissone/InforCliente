/**
 * T4 Previsão de Tesouraria — o `V.fflx` do protótipo.
 *
 * A partir do saldo das contas hoje, por dia (31 dias), semana (13) ou mês
 * (12): o que se espera receber, o que já está comprometido para sair e o que
 * se prevê sair, com dois saldos — só com o comprometido e o previsto.
 * Clique numa linha para ver os documentos que a formam.
 *
 * Os registos vêm de `/finance/flows` (os mesmos do F2 e do T8).
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, codigoNoCabecalho, seg, moedaSeg, kpis, vazio, erro } from "./f2Ui.js";
import { previsaoT4 } from "./fluxosCore.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, g: "S", moeda: "AOA", sel: "", erro: null };

const cel = (v, cls = "") => (v > 0.5 ? `<td class="r ${cls}">${fmt(v)}</td>` : '<td class="r fx2-mut">—</td>');

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const sal = S.d.saldos[S.moeda] || { saldo: 0, contas: 0, estimado: false };
  const T = previsaoT4(S.d.registos, { g: S.g, hoje: S.d.hoje, moeda: S.moeda, saldoHoje: sal.saldo });
  const fimTxt = fmtData(T.fim);
  const sel = T.linhas.find((r) => r.k === S.sel);

  el.innerHTML = `
    <div class="fcal-filtros">
      ${seg("t4", "g", S.g, [["D", "Por Dia"], ["S", "Por Semana"], ["M", "Por Mês"]])}
      ${moedaSeg("t4", S.moeda, S.d.moedas)}
    </div>
    <p class="fx2-lead"><b>Real</b> = dinheiro nas contas hoje. <b>Comprometido</b> = saídas já assumidas (pedidos aprovados,
      prestações, créditos de fornecedores). <b>Previsto</b> = o que se espera mas ainda não está firme (faturas a receber,
      autos por faturar, pedidos por aprovar).</p>
    ${kpis([
      { tom: "good", titulo: "Real · Saldo Hoje", valor: fmt(sal.saldo), nota: `${sal.contas} conta(s) em ${esc(S.moeda)}${sal.estimado ? " · há saldos estimados" : ""}` },
      { tom: "bad", titulo: "Comprometido (saídas)", valor: fmt(T.comprometido), nota: `até ${fimTxt} · em atraso ${fmt(T.atrasoComprometido)}` },
      { tom: "neu", titulo: "Previsto · Entradas", valor: fmt(T.entradas), nota: `até ${fimTxt}` },
      { tom: "warn", titulo: "Previsto · Saídas", valor: fmt(T.saidasPrevistas), nota: `até ${fimTxt}` },
      {
        tom: T.negativo ? "bad" : "good",
        titulo: `Saldo Previsto a ${fimTxt}`,
        valor: fmt(T.saldoFim),
        nota: T.negativo ? `fica negativo: ${esc(T.negativo)}` : "sem saldo negativo previsto",
      },
    ])}
    <section class="fx2-blk"><div class="fx2-tw"><table class="fx2-t t4-t">
      <thead><tr><th>Período</th><th class="r">Entradas Previstas</th><th class="r">Saídas Comprometidas</th><th class="r">Saídas Previstas</th>
        <th class="r">Saldo só c/ Comprometido</th><th class="r">Saldo Previsto</th></tr></thead>
      <tbody>
        <tr class="f0-tot"><td>Real — saldo de hoje</td><td></td><td></td><td></td><td class="r">${fmt(sal.saldo)}</td><td class="r">${fmt(sal.saldo)}</td></tr>
        ${T.linhas
          .map(
            (r) => `<tr class="fx2-k-row${r.k === S.sel ? " t4-on" : ""}${r.fora ? " t4-fora" : ""}${r.k === "atr" && (r.en || r.sc || r.sp) ? " t4-atr" : ""}" data-t4sel="${esc(r.k)}">
              <td>${esc(r.l)} <small class="fx2-mut">${r.L.length ? `· ${r.L.length}` : ""}</small></td>
              ${cel(r.en, "fcal-in")}${cel(r.sc, "fcal-out")}${cel(r.sp)}
              ${r.fora ? "<td></td><td></td>" : `<td class="r${r.rc < 0 ? " f0-neg" : ""}">${fmt(r.rc)}</td><td class="r${r.rp < 0 ? " f0-neg" : ""}"><b>${fmt(r.rp)}</b></td>`}
            </tr>`
          )
          .join("")}
      </tbody>
    </table></div></section>
    ${
      sel
        ? `<section class="fx2-blk"><h3>${esc(sel.l)} · ${sel.L.length} documento(s)</h3>${
            sel.L.length
              ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Data</th><th>Tipo</th><th>Entidade</th><th>Documento</th><th class="r">Entrada</th><th class="r">Saída</th></tr></thead><tbody>${sel.L.slice()
                  .sort((a, b) => (a.data || "9").localeCompare(b.data || "9"))
                  .map(
                    (x) => `<tr><td>${x.data ? fmtData(x.data) : "—"}</td><td>${x.lado === "R" ? "A receber" : x.tipo === "comp" ? "Comprometido" : "Previsto"}</td>
                      <td>${esc(x.grupo || "")}<div class="fx2-mut">${esc(x.sub || "")}</div></td><td>${esc(x.texto || "")}</td>
                      <td class="r fcal-in">${x.lado === "R" ? fmt(x.valor) : ""}</td><td class="r fcal-out">${x.lado === "P" ? fmt(x.valor) : ""}</td></tr>`
                  )
                  .join("")}</tbody></table></div>`
              : `<p class="fx2-mut">Nada neste período.</p>`
          }</section>`
        : ""
    }
    <p class="fcal-nota">O que já venceu e continua por receber ou pagar está em «Em atraso» e entra logo nos saldos.
      «Depois de» e «Sem data» não entram nos saldos. Clique numa linha para ver os documentos.
      O mês a mês com o realizado está em <a href="/Financeiro/fluxo-caixa">T8 · Mapa de Fluxo de Caixa</a>.</p>`;
}

export async function render() {
  codigoNoCabecalho("T4");
  const el = root();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-t4]");
    if (b) {
      const [k, v] = b.dataset.t4.split("|");
      S[k] = v;
      S.sel = "";
      return desenhar();
    }
    const r = e.target.closest("[data-t4sel]");
    if (r) {
      S.sel = S.sel === r.dataset.t4sel ? "" : r.dataset.t4sel;
      desenhar();
    }
  });
  desenhar();
  try {
    S.d = await apiRequest("/finance/flows");
    S.moeda = S.d.moedas.includes("AOA") ? "AOA" : S.d.moedas[0] || "AOA";
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
