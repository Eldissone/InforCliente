/**
 * O4 Previsões por Obra — o `V.fobra` do protótipo.
 *
 * O previsto da obra contra o que já entrou e saiu, mês a mês.
 *
 * No protótipo as previsões são validadas pela equipa de obra. Essa figura não
 * existe na app: o previsto aqui é o que a obra já tem — a venda prevista, o
 * custo orçado, o prazo — e, mês a mês, o que se espera receber (faturas por
 * receber e autos por faturar) e pagar (contas a pagar). O ecrã di-lo.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, codigoNoCabecalho, kpis, vazio, erro } from "./f2Ui.js";
import { MESES } from "./calendarioCore.js";
import { carregarObras, obraDoEndereco, gravarObra, obraSelect } from "./obraEscolha.js";

const root = () => document.getElementById("financeRoot");
const S = { obras: [], obra: "", d: null, erro: null, carregando: false };
const mes = (k) => `${MESES[Number(k.slice(5, 7)) - 1].slice(0, 3)} ${k.slice(0, 4)}`;
const cel = (v) => (v ? fmt(v) : "—");
const pc = (v) => (v === null || v === undefined ? "" : `${v.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}% sobre a venda`);

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  const filtros = `<div class="fcal-filtros">${obraSelect(S.obras, S.obra, "o4o")}</div>`;
  if (!S.obra) return (el.innerHTML = filtros + vazio("Escolha uma obra."));
  if (S.carregando || !S.d) return (el.innerHTML = filtros + vazio("A carregar…"));
  const d = S.d;
  const hoje = new Date().toISOString().slice(0, 7);

  el.innerHTML = `${filtros}
    <p class="fx3-aviso">
      No protótipo estas previsões são validadas pela equipa de obra. A app ainda não tem essa validação: o
      previsto vem da ${d.fonteValor === "TABELA_QUANTIDADES" ? "tabela de quantidades" : "obra"} (venda), do custo
      orçado e do prazo registados na obra, e das faturas, autos e contas a pagar em aberto.
    </p>
    ${kpis([
      { tom: "blue", titulo: "Venda prevista", valor: d.valor ? fmt(d.valor) : "—", nota: d.obra.moeda },
      { tom: "neu", titulo: "Custo previsto", valor: d.custoPrevisto ? fmt(d.custoPrevisto) : "—", nota: `custo real até agora: ${fmt(d.custoReal)}` },
      { tom: d.margem < 0 ? "bad" : "good", titulo: "Margem prevista", valor: d.margem === null ? "—" : fmt(d.margem), nota: pc(d.margemPct) },
      {
        tom: "neu",
        titulo: "Prazo",
        valor: d.dias === null ? "—" : `${d.dias} dias`,
        nota: d.inicio || d.fim ? `${fmtData(d.inicio)} → ${fmtData(d.fim)}` : "sem datas na obra",
      },
    ])}
    ${
      d.meses.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Mês</th><th class="r">Entradas Previstas</th><th class="r">Entradas Reais</th><th class="r">Saídas Previstas</th><th class="r">Saídas Reais</th><th class="r">Acumulado Previsto</th><th class="r">Acumulado Real</th></tr></thead>
      <tbody>${d.meses
        .map(
          (m) => `<tr${m.k === hoje ? ' class="fx3-hoje"' : ""}>
          <td>${mes(m.k)}</td>
          <td class="r">${cel(m.entPrev)}</td>
          <td class="r fcal-in">${cel(m.ent)}</td>
          <td class="r">${cel(m.saiPrev)}</td>
          <td class="r fcal-out">${cel(m.sai)}</td>
          <td class="r${m.acPrev < 0 ? " fcal-out" : ""}">${fmt(m.acPrev)}</td>
          <td class="r${m.acReal < 0 ? " fcal-out" : ""}"><b>${fmt(m.acReal)}</b></td>
        </tr>`
        )
        .join("")}</tbody>
    </table></div>`
        : vazio("Esta obra ainda não tem nada previsto nem realizado.")
    }
    <p class="fcal-nota">
      Previsto: faturas por receber pelo vencimento, autos aprovados por faturar (data do auto + prazo padrão) e
      contas a pagar pelo vencimento. Real: recebimentos e pagamentos já feitos. Valores em ${esc(d.obra.moeda)}.
    </p>`;
}

async function carregar() {
  if (!S.obra) return desenhar();
  S.carregando = true;
  S.erro = null;
  desenhar();
  try {
    S.d = await apiRequest(`/finance/project-summary/${encodeURIComponent(S.obra)}/forecast`);
  } catch (e) {
    S.erro = e.message;
  }
  S.carregando = false;
  desenhar();
}

export async function render() {
  codigoNoCabecalho("O4");
  root().addEventListener("change", (e) => {
    if (e.target.dataset.o4o === undefined) return;
    S.obra = e.target.value;
    gravarObra(S.obra);
    carregar();
  });
  S.obra = obraDoEndereco();
  desenhar();
  try {
    S.obras = await carregarObras();
  } catch (e) {
    S.erro = e.message;
  }
  await carregar();
}
