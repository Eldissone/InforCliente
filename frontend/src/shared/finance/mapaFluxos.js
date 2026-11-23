/**
 * F2 Mapa de Fluxos — o `V.fmf` do protótipo.
 *
 * Um quadro por mês (os doze do ano) ou por semana (doze à volta da atual):
 * recebimentos e pagamentos agrupados, com o detalhe ao abrir cada grupo, o
 * saldo do período e o acumulado. Três modos: realizado + previsto, só
 * realizado, só compromissos.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmt0, codigoNoCabecalho, seg, moedaSeg, kpis, vazio, erro } from "./f2Ui.js";
import { mapaFluxos, monthLabel } from "./fluxosCore.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, F: null, aberto: new Set(), erro: null };

const v = (x) => (x ? fmt(x) : "—");

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const F = S.F;
  const C = mapaFluxos(S.d.registos, F, S.d.hoje);
  const lbl = (k) => (F.per === "S" ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : monthLabel(k));
  const cc = (k) => (k === C.atual ? ' class="cur"' : "");
  const anoAtual = Number(S.d.hoje.slice(0, 4));
  const anos = [anoAtual - 1, anoAtual, anoAtual + 1].map(String);
  const mx = Math.max(1, ...C.K.map((k) => Math.max(C.R.T[k] || 0, C.P.T[k] || 0)));

  const secao = (id, titulo, A, tom) =>
    `<tr class="sec"><td>${titulo}</td>${C.K.map((k) => `<td${cc(k)}><span class="${tom}">${v(A.T[k])}</span></td>`).join("")}<td><span class="${tom}">${v(A.T.t)}</span></td></tr>` +
    A.G.map((g) => {
      const chave = `${id}|${g.k}`;
      const aberto = S.aberto.has(chave);
      return (
        `<tr class="g" data-mfo="${esc(chave)}"><td>${aberto ? "▾" : "▸"} ${esc(g.k)}</td>${C.K.map((k) => `<td${cc(k)}>${v(g.v[k])}</td>`).join("")}<td><b>${v(g.v.t)}</b></td></tr>` +
        (aberto
          ? g.S.map((s) => `<tr class="s"><td>${esc(s.k)}</td>${C.K.map((k) => `<td${cc(k)}>${v(s.v[k])}</td>`).join("")}<td>${v(s.v.t)}</td></tr>`).join("")
          : "")
      );
    }).join("");

  el.innerHTML = `
    <div class="fcal-filtros">
      <a class="finance-btn" href="/Financeiro/calendario?ver=tudo">Calendário Financeiro</a>
      ${seg("mf", "modo", F.modo, [["tudo", "Realizado + Previsto"], ["real", "Só Realizado"], ["comp", "Só Compromissos (por pagar/receber)"]])}
      ${seg("mf", "per", F.per, [["M", "Por Mês"], ["S", "Por Semana"]])}
      ${F.per === "M" ? `<select class="fcal-ano" data-mfs="ano">${anos.map((a) => `<option${F.ano === a ? " selected" : ""}>${a}</option>`).join("")}</select>` : ""}
      ${moedaSeg("mf", F.moeda, S.d.moedas)}
      <a class="fcal-todos" href="/Financeiro/calendario?ver=tudo">Calendário Financeiro</a>
    </div>
    ${kpis([
      { tom: "good", titulo: "Recebimentos", valor: fmt(C.tR), nota: F.per === "S" ? "12 semanas" : F.ano },
      { tom: "bad", titulo: "Pagamentos", valor: fmt(C.tP) },
      { tom: C.tR - C.tP < 0 ? "bad" : "good", titulo: "Saldo do Período", valor: fmt(C.tR - C.tP), nota: "recebimentos − pagamentos" },
    ])}
    <section class="fx2-blk">
      <div class="fx2-graf">${C.K.map(
        (k) => `<div title="${lbl(k)}: recebe ${fmt(C.R.T[k] || 0)} · paga ${fmt(C.P.T[k] || 0)}">
          <span class="fx2-mes-b"><i class="fx2-bar--en" style="height:${(((C.R.T[k] || 0) / mx) * 100).toFixed(1)}%"></i><i class="fx2-bar--sa" style="height:${(((C.P.T[k] || 0) / mx) * 100).toFixed(1)}%"></i></span>
          <span class="fx2-mes-l${k === C.atual ? " on" : ""}">${lbl(k)}</span>
        </div>`
      ).join("")}</div>
    </section>
    <section class="fx2-blk fx2-mf"><div class="fx2-tw"><table>
      <thead><tr><th>${F.per === "S" ? "Semana de" : "Mês"}</th>${C.K.map((k) => `<th${cc(k)}>${lbl(k)}</th>`).join("")}<th>Total</th></tr></thead>
      <tbody>
        ${secao("R", "Recebimentos", C.R, "fcal-in")}
        ${secao("P", "Pagamentos", C.P, "fcal-out")}
        <tr class="bal"><td>Saldo do ${F.per === "S" ? "período" : "mês"}</td>${C.saldos.map((b) => `<td${cc(b.k)} class="${b.s < 0 ? "fcal-out" : "fcal-in"}">${b.s ? fmt0(b.s) : "—"}</td>`).join("")}<td class="${C.tR - C.tP < 0 ? "fcal-out" : "fcal-in"}">${fmt0(C.tR - C.tP)}</td></tr>
        <tr class="acc"><td>Saldo acumulado</td>${C.saldos.map((b) => `<td${cc(b.k)} class="${b.ac < 0 ? "fcal-out" : "fcal-in"}">${fmt0(b.ac)}</td>`).join("")}<td></td></tr>
      </tbody>
    </table></div></section>
    <p class="fcal-nota">
      Realizado = recebimentos e pagamentos já feitos, pela data em que aconteceram. Compromissos = o que está
      por receber e por pagar, pela data de vencimento. Previsto = os autos aprovados ainda sem fatura. Uma
      moeda de cada vez: os valores em ${esc(F.moeda)} não se misturam com os de outras moedas. Clique num
      grupo para ver o detalhe.
    </p>`;
}

export async function render() {
  codigoNoCabecalho("F2");
  const el = root();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mf],[data-mfo]");
    if (!b) return;
    if (b.dataset.mfo) {
      if (S.aberto.has(b.dataset.mfo)) S.aberto.delete(b.dataset.mfo);
      else S.aberto.add(b.dataset.mfo);
    } else {
      const [k, val] = b.dataset.mf.split("|");
      S.F[k] = val;
    }
    desenhar();
  });
  el.addEventListener("change", (e) => {
    if (!e.target.dataset.mfs) return;
    S.F[e.target.dataset.mfs] = e.target.value;
    desenhar();
  });
  desenhar();
  try {
    S.d = await apiRequest("/finance/flows");
    S.F = { per: "M", ano: S.d.hoje.slice(0, 4), modo: "tudo", moeda: S.d.moedas[0] || "AOA" };
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
