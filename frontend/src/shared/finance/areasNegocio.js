/**
 * O5 Áreas de Negócio — alinhado com `V.fareas` do protótipo:
 * cartões de quota por área no topo, filtro por ano e coluna «% da Faturação».
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, codigoNoCabecalho, moedaSeg, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, ano: "", moeda: "AOA", erro: null };
const pc = (v) => (v === null || v === undefined ? "—" : `${v.toLocaleString("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const { areas, totais, anos, moedas } = S.d;
  const mx = Math.max(1, ...areas.map((a) => Math.max(a.fat, a.custo)));

  el.innerHTML = `
    <div class="fcal-filtros">
      <select class="fcal-ano" data-o5ano><option value="">Todos os anos</option>${anos
        .map((a) => `<option value="${esc(a)}"${S.ano === a ? " selected" : ""}>${esc(a)}</option>`)
        .join("")}</select>
      ${moedaSeg("o5", S.moeda, moedas)}
    </div>
    ${
      areas.length
        ? kpis(
            areas.slice(0, 4).map((a) => ({
              tom: "blue",
              titulo: a.area,
              valor: pc(a.pctFaturacao ?? (totais.fat > 0 ? (a.fat / totais.fat) * 100 : 0)),
              nota: `${fmt(a.fat)} ${S.moeda} · ${a.faturas} fatura(s)`,
            }))
          )
        : ""
    }
    ${kpis([
      { tom: "neu", titulo: "Faturação Total (s/ IVA)", valor: fmt(totais.fat), nota: S.ano || "todos os anos" },
      { tom: "good", titulo: "Recebido", valor: fmt(totais.rec) },
      { tom: "warn", titulo: "Custo Pago das Obras", valor: fmt(totais.custo) },
      { tom: totais.margem < 0 ? "bad" : "good", titulo: "Margem", valor: fmt(totais.margem), nota: "faturação − custo pago" },
    ])}
    ${
      areas.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Área de Negócio</th><th class="r">Obras</th><th class="r">Faturas</th><th class="r">Faturado s/ IVA</th><th class="r">% da Faturação</th><th class="r">Recebido</th><th class="r">Custo</th><th class="r">Margem</th><th class="r">Margem %</th><th>Faturação × custo</th></tr></thead>
      <tbody>${areas
        .map((a) => {
          const share = a.pctFaturacao ?? (totais.fat > 0 ? (a.fat / totais.fat) * 100 : 0);
          return `<tr>
          <td><b>${esc(a.area)}</b></td>
          <td class="r">${a.obras}</td>
          <td class="r">${a.faturas}</td>
          <td class="r">${fmt(a.fat)}</td>
          <td class="r"><b>${pc(share)}</b></td>
          <td class="r">${fmt(a.rec)}</td>
          <td class="r">${fmt(a.custo)}</td>
          <td class="r${a.margem < 0 ? " fcal-out" : ""}">${fmt(a.margem)}</td>
          <td class="r">${pc(a.margemPct)}</td>
          <td><span class="fx2-bar"><i class="fx2-bar--en" style="width:${((a.fat / mx) * 100).toFixed(1)}%"></i></span><span class="fx2-bar"><i class="fx2-bar--sa" style="width:${((a.custo / mx) * 100).toFixed(1)}%"></i></span></td>
        </tr>`;
        })
        .join("")}</tbody>
      <tfoot><tr><td>Total</td><td class="r">${areas.reduce((s, a) => s + a.obras, 0)}</td><td class="r">${areas.reduce((s, a) => s + a.faturas, 0)}</td><td class="r"><b>${fmt(totais.fat)}</b></td><td class="r">${totais.fat > 0 ? "100,0%" : "—"}</td><td class="r">${fmt(totais.rec)}</td><td class="r">${fmt(totais.custo)}</td><td class="r${totais.margem < 0 ? " fcal-out" : ""}"><b>${fmt(totais.margem)}</b></td><td class="r">${totais.fat > 0 ? pc((totais.margem / totais.fat) * 100) : "—"}</td><td></td></tr></tfoot>
    </table></div>`
        : vazio("Sem faturas nem custos nesta moeda.")
    }
    <p class="fcal-nota">Faturação = valor da fatura sem IVA (sem faturas anuladas). Custo = o que já foi pago nas obras dessa área. Valores em ${esc(S.moeda)}.</p>`;
}

async function carregar() {
  S.erro = null;
  const q = new URLSearchParams({ moeda: S.moeda });
  if (S.ano) q.set("ano", S.ano);
  try {
    S.d = await apiRequest(`/finance/business-areas?${q}`);
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  codigoNoCabecalho("O5");
  const el = root();
  el.addEventListener("change", (e) => {
    if (e.target.dataset.o5ano === undefined) return;
    S.ano = e.target.value;
    carregar();
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-o5]");
    if (!b) return;
    S.moeda = b.dataset.o5.split("|")[1];
    carregar();
  });
  desenhar();
  await carregar();
}
