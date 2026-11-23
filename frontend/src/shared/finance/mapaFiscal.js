/**
 * G4 Mapa Fiscal — o `V.fmfis` do protótipo.
 *
 * Em cima, a situação de hoje: dívida fiscal total (PPP e impostos), o que
 * está atrasado, o compromisso deste mês e do seguinte. Em baixo, cada imposto
 * e cada plano mês a mês num ano: pago, em pagamento, por pagar, atrasado, ou
 * «sem registo» (um imposto mensal que já devia estar lançado e não está).
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, codigoNoCabecalho, vazio, erro } from "./f2Ui.js";
import { monthLabel } from "./fluxosCore.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, erro: null, ano: null, tp: "" };
const MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const TXT = { pg: "Pago", pp: "Em pagamento", fu: "Por pagar", at: "Atrasado", sr: "Sem registo — não lançado?" };

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const { macro, linhas, ano } = S.d;
  const tipos = [...new Set(linhas.map((r) => r.tipo))].sort((a, b) => (a === "PPP" ? -1 : b === "PPP" ? 1 : a.localeCompare(b)));
  const R = linhas.filter((r) => !S.tp || r.tipo === S.tp);
  const chip = (v, l) => `<button type="button" class="fx2-chip${S.tp === v ? " on" : ""}" data-g4tp="${esc(v)}">${esc(l)}</button>`;
  el.innerHTML = `
    <div class="g4-mac">
      <div><span>Dívida fiscal total</span><b>${fmt(macro.divida)}</b><small>PPP ${fmt(macro.dividaPPP)} · Impostos ${fmt(macro.dividaImpostos)}</small></div>
      <div class="g4-bad"><span>Atrasado (vencido e não pago)</span><b>${fmt(macro.atrasado)}</b><small>${macro.nAtrasado} pagamento(s)</small></div>
      <div><span>Compromisso de ${esc(monthLabel(macro.mesHoje))}</span><b>${fmt(macro.compromissoMes)}</b><small>${esc(monthLabel(macro.prox))}: ${fmt(macro.compromissoProx)}</small></div>
    </div>
    <div class="cp-filtros">
      <span class="fx2-mut">Ano</span>
      <button type="button" class="finance-btn finance-btn--sm" data-g4ano="-1">‹</button><b>${ano}</b><button type="button" class="finance-btn finance-btn--sm" data-g4ano="1">›</button>
      <span class="fx2-mut" style="margin-left:12px">Tipo</span>${chip("", "Todos")}${tipos.map((t) => chip(t, t)).join("")}
    </div>
    ${
      R.length
        ? `<div class="fx2-tw"><table class="fx2-t g4-t">
      <thead><tr><th>Imposto / Plano</th><th>Meses</th><th class="r">Pago</th><th class="r">Atrasado</th><th class="r">Por pagar</th></tr></thead>
      <tbody>${R.map(
        (r) => `<tr><td><b>${esc(r.nome)}</b>${r.tipo === "PPP" ? ' <span class="fx2-mut">PPP</span>' : ""}</td>
          <td><div class="g4-ms">${r.celulas
            .map((c) => {
              const tip = `${r.nome} · ${monthLabel(c.m)}\n${c.s ? `${TXT[c.s]}${c.v ? ` · ${fmt(c.v)}` : ""}` : "Sem pagamento neste mês"}`;
              return `<i class="g4-${c.s || "nd"}" title="${esc(tip)}">${MES[Number(c.m.slice(5, 7)) - 1]}</i>`;
            })
            .join("")}</div></td>
          <td class="r">${fmt(r.pago)}</td><td class="r${r.atrasado ? " f0-neg" : ""}">${fmt(r.atrasado)}</td><td class="r">${fmt(r.futuro)}</td></tr>`
      ).join("")}</tbody></table></div>`
        : vazio("Sem impostos nem planos neste ano.")
    }
    <div class="g4-leg"><span><i class="g4-pg"></i>Pago</span><span><i class="g4-pp"></i>Em pagamento</span><span><i class="g4-fu"></i>Por pagar</span>
      <span><i class="g4-at"></i>Atrasado</span><span><i class="g4-sr"></i>Sem registo</span><span><i class="g4-nd"></i>Sem pagamento</span></div>
    <p class="fcal-nota">«Sem registo»: IVA, IRT ou INSS de um mês cuja data limite já passou e que não está lançado — verifique se falta lançar.
      Os impostos tratam-se em <a href="/Financeiro/impostos">G1 · Impostos</a>; os planos em <a href="/Financeiro/impostos-planos">G2</a>.
      Atualizado a ${fmtData(S.d.hoje)}.</p>`;
}

async function carregar() {
  try {
    S.d = await apiRequest(`/finance/taxes/map${S.ano ? `?ano=${S.ano}` : ""}`);
    S.ano = S.d.ano;
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  codigoNoCabecalho("G4");
  root().addEventListener("click", (e) => {
    const a = e.target.closest("[data-g4ano]");
    if (a) {
      S.ano = Number(S.ano) + Number(a.dataset.g4ano);
      return carregar();
    }
    const t = e.target.closest("[data-g4tp]");
    if (t) {
      S.tp = t.dataset.g4tp;
      desenhar();
    }
  });
  desenhar();
  await carregar();
}
