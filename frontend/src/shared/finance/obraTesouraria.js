/**
 * O3 Tesouraria da Obra — o `tesHtml` do protótipo.
 *
 * O que entrou e saiu de dinheiro numa obra: recebimentos do cliente,
 * pagamentos feitos pela conta principal e transferências para os cartões de
 * fundo de maneio. O saldo diz se a obra está a crédito ou se a empresa a está
 * a financiar. Os gastos com os cartões aparecem à parte: já saíram da conta
 * principal na transferência.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, codigoNoCabecalho, kpis, vazio, erro } from "./f2Ui.js";
import { MESES } from "./calendarioCore.js";
import { carregarObras, obraDoEndereco, gravarObra, obraSelect } from "./obraEscolha.js";

const root = () => document.getElementById("financeRoot");
const S = { obras: [], obra: "", de: "", ate: "", d: null, erro: null, carregando: false };
const mes = (k) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const neg = (v) => (v < -0.005 ? ' class="r fcal-out"' : ' class="r"');

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  const filtros = `<div class="fcal-filtros">
    ${obraSelect(S.obras, S.obra, "o3o")}
    <label class="fx2-ajuda">De <input class="fcal-ano" type="date" data-o3d="de" value="${esc(S.de)}"></label>
    <label class="fx2-ajuda">Até <input class="fcal-ano" type="date" data-o3d="ate" value="${esc(S.ate)}"></label>
  </div>`;
  if (!S.obra) return (el.innerHTML = filtros + vazio("Escolha uma obra."));
  if (S.carregando || !S.d) return (el.innerHTML = filtros + vazio("A carregar…"));
  const { totais: T, meses, categorias, cartoes, saldoCartoes, obra, outraMoeda = {} } = S.d;
  const outras = Object.entries(outraMoeda);

  el.innerHTML = `${filtros}
    ${
      outras.length
        ? `<ul class="fx3-alertas">${outras
            .map(([m, v]) => `<li>⚠ Pagamentos em ${esc(m)} nesta obra em ${esc(obra.moeda)}: ${fmt(v)} ${esc(m)}. Ficam fora dos totais — sem câmbio não se somam.</li>`)
            .join("")}</ul>`
        : ""
    }
    ${kpis([
      { tom: "neu", titulo: "Faturado", valor: fmt(T.fat), nota: obra.moeda },
      { tom: "good", titulo: "Recebido", valor: fmt(T.rec) },
      { tom: "bad", titulo: "Pago pela Conta Principal", valor: fmt(T.dir) },
      { tom: "warn", titulo: "Transferido para Cartões FM", valor: fmt(T.trf) },
      {
        tom: T.saldo < 0 ? "bad" : "good",
        titulo: "Saldo da Obra (Recebido − Saído)",
        valor: fmt(T.saldo),
        nota: T.saldo < 0 ? "a empresa está a financiar a obra" : "obra a crédito",
      },
    ])}
    <div class="fx2-chips">
      <span class="fx2-chip"><span>Gasto com os cartões</span><b>${fmt(T.car)}</b></span>
      <span class="fx2-chip"><span>Transferido e ainda por justificar</span><b>${fmt(T.porJustificar)}</b></span>
      <span class="fx2-chip"><span>Saldo atual nos cartões da obra${cartoes.length ? ` (${cartoes.map((c) => esc(c.nome)).join(", ")})` : ""}</span><b>${fmt(saldoCartoes)}</b></span>
    </div>
    ${
      meses.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Mês</th><th class="r">Faturado</th><th class="r">Recebido</th><th class="r">Pago pela Conta Principal</th><th class="r">Transferido p/ Cartões</th><th class="r">Total Saído</th><th class="r">Saldo do Mês</th><th class="r">Saldo Acumulado</th><th class="r">Gasto c/ Cartões</th></tr></thead>
      <tbody>${meses
        .map(
          (m) => `<tr>
          <td>${mes(m.k)}</td>
          <td class="r">${m.fat ? fmt(m.fat) : ""}</td>
          <td class="r">${m.rec ? fmt(m.rec) : ""}</td>
          <td class="r">${m.dir ? fmt(m.dir) : ""}</td>
          <td class="r">${m.trf ? fmt(m.trf) : ""}</td>
          <td class="r">${fmt(m.sai)}</td>
          <td${neg(m.sal)}>${fmt(m.sal)}</td>
          <td${neg(m.ac)}><b>${fmt(m.ac)}</b></td>
          <td class="r fx2-mut">${m.car ? fmt(m.car) : ""}</td>
        </tr>`
        )
        .join("")}</tbody>
      <tfoot><tr><td>Total</td><td class="r">${fmt(T.fat)}</td><td class="r">${fmt(T.rec)}</td><td class="r">${fmt(T.dir)}</td><td class="r">${fmt(T.trf)}</td><td class="r">${fmt(T.sai)}</td><td${neg(T.saldo)}>${fmt(T.saldo)}</td><td></td><td class="r fx2-mut">${fmt(T.car)}</td></tr></tfoot>
    </table></div>`
        : vazio(`Sem recebimentos nem pagamentos registados para esta obra${S.de || S.ate ? " no período" : ""}.`)
    }
    ${
      categorias.length
        ? `<section class="fx2-blk" style="margin-top:.875rem"><h3>Pagamentos por Categoria</h3><div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Categoria</th><th class="r">Conta Principal</th><th class="r">Cartões FM</th><th class="r">Total</th></tr></thead>
      <tbody>${categorias.map((c) => `<tr><td>${esc(c.k)}</td><td class="r">${fmt(c.dir)}</td><td class="r">${fmt(c.car)}</td><td class="r"><b>${fmt(c.total)}</b></td></tr>`).join("")}</tbody>
    </table></div></section>`
        : ""
    }
    <p class="fcal-nota">Levantamentos ATM e pedidos pagos pelo fundo de maneio contam como gasto com os cartões: o dinheiro saiu da conta principal quando foi transferido para o cartão. Valores em ${esc(obra.moeda)}.</p>`;
}

async function carregar() {
  if (!S.obra) return desenhar();
  S.carregando = true;
  S.erro = null;
  desenhar();
  const q = new URLSearchParams();
  if (S.de) q.set("de", S.de);
  if (S.ate) q.set("ate", S.ate);
  try {
    S.d = await apiRequest(`/finance/project-summary/${encodeURIComponent(S.obra)}/treasury?${q}`);
  } catch (e) {
    S.erro = e.message;
  }
  S.carregando = false;
  desenhar();
}

export async function render() {
  codigoNoCabecalho("O3");
  const el = root();
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.o3o !== undefined) {
      S.obra = t.value;
      gravarObra(S.obra);
      return carregar();
    }
    if (t.dataset.o3d) {
      S[t.dataset.o3d] = t.value;
      carregar();
    }
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
