/**
 * O1 Resumo das Obras — o `V.fsobra` do protótipo.
 *
 * Por obra: quanto está feito (avanço físico), medido (autos aprovados),
 * faturado e recebido, em percentagem da venda; o custo real, o desvio, a
 * margem prevista e o dinheiro da obra. Clique numa obra para ver a ficha,
 * com os alertas e as ligações para os custos, a tesouraria e as previsões.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, codigoNoCabecalho, seg, moedaSeg, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, e: "ativas", q: "", moeda: "AOA", aberta: null, erro: null };

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const pc = (v) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);
const w = (v) => Math.max(0, Math.min(100, v || 0)).toFixed(1);

function barra(x) {
  return `<div class="fx3-prod" title="Avanço ${pc(x.av)} · Medido ${pc(x.pMed)} · Faturado ${pc(x.pFat)}">
    <i class="fx3-prod--av" style="width:${w(x.av)}%"></i><i class="fx3-prod--med" style="width:${w(x.pMed)}%"></i><i class="fx3-prod--fat" style="width:${w(x.pFat)}%"></i>
  </div>`;
}

function ficha(x) {
  const lin = (l, v, s) => `<tr><td>${l}${s ? `<div class="fx2-mut">${s}</div>` : ""}</td><td class="r"><b>${v}</b></td></tr>`;
  return `<tr class="fx3-ficha"><td colspan="11">
    ${x.alertas.length ? `<ul class="fx3-alertas">${x.alertas.map((a) => `<li>⚠ ${esc(a)}</li>`).join("")}</ul>` : `<p class="fx2-mut">Sem alertas.</p>`}
    <div class="fx3-ficha-g">
      <table class="fx2-t"><tbody>
        ${lin("Venda prevista", fmt(x.contr), x.fonteContrato === "TABELA_QUANTIDADES" ? "da tabela de quantidades" : "")}
        ${lin("Medido (autos aprovados)", fmt(x.medido), pc(x.pMed))}
        ${lin("Faturado", fmt(x.fat), pc(x.pFat))}
        ${lin("Recebido", fmt(x.rec), pc(x.pRec))}
      </tbody></table>
      <table class="fx2-t"><tbody>
        ${lin("Custo orçado", x.orc ? fmt(x.orc) : "—")}
        ${lin("Custo real (pago)", fmt(x.real))}
        ${lin("Comprometido", fmt(x.comp))}
        ${lin("Custo previsto final", fmt(x.eac), x.desv !== null ? `desvio ${fmt(x.desv)}` : "sem custo orçado")}
      </tbody></table>
    </div>
    <div class="fx3-links">
      <a class="fcal-todos" href="/Financeiro/obras-custos?obra=${encodeURIComponent(x.id)}">O2 · Custos da obra</a>
      <a class="fcal-todos" href="/Financeiro/obra-tesouraria?obra=${encodeURIComponent(x.id)}">O3 · Tesouraria da obra</a>
      <a class="fcal-todos" href="/Financeiro/obra-previsoes?obra=${encodeURIComponent(x.id)}">O4 · Previsões</a>
    </div>
  </td></tr>`;
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const q = norm(S.q).trim();
  const L = S.d.obras
    .filter((x) => x.moeda === S.moeda)
    .filter((x) => S.e !== "ativas" || (x.ativa && (x.contr || x.real || x.fat || x.medido)))
    .filter((x) => !q || norm([x.codigo, x.nome, x.cliente].join(" ")).includes(q))
    .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));

  el.innerHTML = `
    <div class="fcal-filtros">
      <input type="search" class="fcal-q" data-o1q placeholder="código, obra, cliente…" value="${esc(S.q)}">
      ${seg("o1", "e", S.e, [["ativas", "Obras em curso"], ["todas", "Todas"]])}
      ${moedaSeg("o1", S.moeda, S.d.moedas)}
      <span class="fx2-ajuda">Barra: <span class="fx3-lg fx3-prod--av"></span> avanço · <span class="fx3-lg fx3-prod--med"></span> medido · <span class="fx3-lg fx3-prod--fat"></span> faturado</span>
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Obra</th><th class="r">Venda Prevista</th><th>Produção</th><th class="r">Avanço</th><th class="r">Medido</th><th class="r">Faturado</th><th class="r">Recebido</th><th class="r">Custo Real</th><th class="r">Desvio Custo</th><th class="r">Margem Prev.</th><th class="r">Dinheiro da Obra</th></tr></thead>
      <tbody>${L.map(
        (x) => `<tr class="fx2-k-row" data-o1x="${esc(x.id)}">
          <td><b>${esc(x.codigo)}</b> <span class="fx2-mut">${esc(x.nome)}</span>${x.cliente ? `<div class="fx2-mut">${esc(x.cliente)}</div>` : ""}${x.alertas.length ? ` <span class="fcal-pill fcal-pill--warn" title="${esc(x.alertas.join("\n"))}">${x.alertas.length} alerta(s)</span>` : ""}</td>
          <td class="r">${x.contr ? fmt(x.contr) : "—"}</td>
          <td>${barra(x)}</td>
          <td class="r">${pc(x.av)}</td>
          <td class="r${x.pMed > 100.5 ? " fcal-out" : ""}">${pc(x.pMed)}</td>
          <td class="r">${pc(x.pFat)}</td>
          <td class="r">${pc(x.pRec)}</td>
          <td class="r">${fmt(x.real)}</td>
          <td class="r${x.desv > 0.5 ? " fcal-out" : ""}">${x.desv === null ? "—" : fmt(x.desv)}</td>
          <td class="r${x.mPrevPct < 0 ? " fcal-out" : ""}">${x.mPrevPct === null ? "—" : pc(x.mPrevPct)}</td>
          <td class="r"><b class="${x.cash < 0 ? "fcal-out" : ""}">${fmt(x.cash)}</b></td>
        </tr>${S.aberta === x.id ? ficha(x) : ""}`
      ).join("")}</tbody>
    </table></div>`
        : vazio("Sem obras com estes filtros.")
    }
    <p class="fcal-nota">
      Percentagens sobre a venda prevista (contrato ou tabela de quantidades). Medido = autos aprovados. Custo
      real = o que já foi pago. Desvio = custo previsto final − custo orçado; só existe com custo orçado. Dinheiro
      da obra = recebido − (pago pela conta principal + transferido para os cartões da obra): negativo quer dizer
      que a empresa está a financiar a obra. Valores em ${esc(S.moeda)}.
    </p>`;
}

export async function render() {
  codigoNoCabecalho("O1");
  const el = root();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-o1],[data-o1x]");
    if (!b || e.target.closest("a")) return;
    if (b.dataset.o1x) S.aberta = S.aberta === b.dataset.o1x ? null : b.dataset.o1x;
    else {
      const [k, v] = b.dataset.o1.split("|");
      S[k] = v;
    }
    desenhar();
  });
  el.addEventListener("input", (e) => {
    if (e.target.dataset.o1q === undefined) return;
    S.q = e.target.value;
    const pos = e.target.selectionStart;
    desenhar();
    const n = root().querySelector("[data-o1q]");
    if (n) {
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });
  desenhar();
  try {
    S.d = await apiRequest("/finance/project-summary");
    S.moeda = S.d.moedas[0] || "AOA";
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
