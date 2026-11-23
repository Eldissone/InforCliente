/**
 * T8 Mapa de Fluxo de Caixa — o `V.fcxm` do protótipo.
 *
 * Doze meses a partir de três para trás. Parte do saldo das contas hoje: o
 * saldo inicial do primeiro mês é o de hoje menos o que entrou e saiu desde
 * então. Os meses passados são realizado, o atual mistura realizado e
 * previsto, os futuros são previsto. O que já venceu e continua por pagar ou
 * por receber entra no mês atual. Avisa o primeiro mês em que o saldo fica
 * negativo.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, codigoNoCabecalho, seg, moedaSeg, kpis, vazio, erro } from "./f2Ui.js";
import { mapaCaixa, monthLabel } from "./fluxosCore.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, F: null, erro: null };

const FASE = { real: "realizado", misto: "real. + previsto", prev: "previsto" };

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const F = S.F;
  const sal = S.d.saldos[F.moeda] || { saldo: 0, contas: 0, estimado: false };
  const C = mapaCaixa(S.d.registos, F, S.d.hoje, sal.saldo);
  const cel = (z) => (z && z.v > 0.5 ? fmt(z.v) : "");
  const titulo = (z) =>
    z && z.L.length
      ? ` title="${esc(
          z.L.slice()
            .sort((a, b) => b.valor - a.valor)
            .slice(0, 12)
            .map((x) => `${fmtData(x.data)} · ${x.sub} · ${fmt(x.valor)}${x.prev ? " (prev.)" : ""}`)
            .join("\n")
        )}"`
      : "";
  const linhas = (R) =>
    R.map(
      (r) => `<tr class="s"><td>${esc(r.g)}</td>${r.vals.map((z) => `<td${titulo(z)}>${cel(z)}</td>`).join("")}<td><b>${fmt(r.total)}</b></td></tr>`
    ).join("");
  const somaE = C.totE.reduce((s, x) => s + x, 0);
  const somaS = C.totS.reduce((s, x) => s + x, 0);

  el.innerHTML = `
    <div class="fcal-filtros">
      ${seg("cx", "vis", F.vis, [["tudo", "Realizado + Previsto"], ["real", "Só Realizado"], ["prev", "Só Previsto"]])}
      ${moedaSeg("cx", F.moeda, S.d.moedas)}
      <span class="finance-seg">
        <button type="button" data-cx="ini|-1">‹ mês</button>
        <button type="button" data-cx="ini|0">Hoje</button>
        <button type="button" data-cx="ini|1">mês ›</button>
      </span>
    </div>
    ${kpis([
      {
        tom: "good",
        titulo: `Saldo Hoje (${F.moeda})`,
        valor: fmt(sal.saldo),
        nota: `${sal.contas} conta(s)${sal.estimado ? " · há saldos estimados" : ""}`,
      },
      {
        tom: C.atrE > 0.5 ? "warn" : "good",
        titulo: "A Receber em Atraso",
        valor: fmt(C.atrE),
        nota: C.porFaturar > 0.5 ? `+ ${fmt(C.porFaturar)} de autos por faturar` : "faturas vencidas · no mês atual",
      },
      { tom: C.atrS > 0.5 ? "bad" : "good", titulo: "A Pagar em Atraso", valor: fmt(C.atrS), nota: "contado no mês atual" },
      C.negativo
        ? { tom: "bad", titulo: "Saldo Negativo a Partir de", valor: esc(monthLabel(C.negativo)), nota: "falta dinheiro para o previsto" }
        : { tom: "good", titulo: `Saldo Previsto em ${monthLabel(C.M[C.M.length - 1])}`, valor: fmt(C.fim[C.fim.length - 1]), nota: "sem saldo negativo previsto" },
    ])}
    <section class="fx2-blk fx2-mf"><div class="fx2-tw"><table>
      <thead><tr><th>Mês</th>${C.M.map(
        (mk) => `<th${mk === C.m0 ? ' class="cur"' : ""}>${monthLabel(mk)}<div class="fx2-fase fx2-fase--${C.fase(mk)}">${FASE[C.fase(mk)]}</div></th>`
      ).join("")}<th>Total</th></tr></thead>
      <tbody>
        <tr class="bal"><td>Saldo inicial</td>${C.ini.map((x) => `<td class="${x < 0 ? "fcal-out" : ""}">${fmt(x)}</td>`).join("")}<td></td></tr>
        <tr class="sec"><td>Entradas</td>${C.totE.map((x) => `<td class="fcal-in">${x ? fmt(x) : "—"}</td>`).join("")}<td class="fcal-in">${fmt(somaE)}</td></tr>
        ${linhas(C.E)}
        <tr class="sec"><td>Saídas</td>${C.totS.map((x) => `<td class="fcal-out">${x ? fmt(x) : "—"}</td>`).join("")}<td class="fcal-out">${fmt(somaS)}</td></tr>
        ${linhas(C.S)}
        <tr class="acc"><td>Saldo final</td>${C.fim.map((x) => `<td class="${x < 0 ? "fcal-out" : "fcal-in"}">${fmt(x)}</td>`).join("")}<td></td></tr>
      </tbody>
    </table></div></section>
    <p class="fcal-nota">
      O saldo de hoje é o das contas em ${esc(F.moeda)} (último extrato ou acerto, mais os movimentos seguintes;
      sem saldo registado, o do cartão). Passe o rato numa célula para ver os documentos que a formam.
      ${S.d.saldoDesde ? `O saldo mais antigo em uso é de ${fmtData(S.d.saldoDesde)}.` : ""}
    </p>`;
}

export async function render() {
  codigoNoCabecalho("T8");
  const el = root();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cx]");
    if (!b) return;
    const [k, val] = b.dataset.cx.split("|");
    if (k === "ini") S.F.ini = val === "0" ? -3 : S.F.ini + Number(val);
    else S.F[k] = val;
    desenhar();
  });
  desenhar();
  try {
    S.d = await apiRequest("/finance/flows");
    S.F = { ini: -3, n: 12, vis: "tudo", moeda: S.d.moedas[0] || "AOA" };
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
