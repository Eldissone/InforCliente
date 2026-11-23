/**
 * T7 Fundo de Maneio — o `V.ffm` do protótipo: por cartão, o dinheiro que lá
 * entrou, o que se gastou, o que está por gastar (pedidos aprovados ainda por
 * pagar), o saldo e a sobra livre.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, codigoNoCabecalho, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, erro: null };

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  // Uma moeda de cada vez: os totais de cima são só dos cartões em kwanzas.
  const L = S.d.items;
  const aoa = L.filter((x) => x.moeda === "AOA");
  const soma = (k) => aoa.reduce((s, x) => s + x[k], 0);
  el.innerHTML = `
    ${kpis([
      { tom: "neu", titulo: "Transferido", valor: fmt(soma("transferido")), nota: "para os cartões (AOA)" },
      { tom: "warn", titulo: "Gasto", valor: fmt(soma("gasto")), nota: "saídas dos cartões" },
      { tom: "blue", titulo: "Por Gastar", valor: fmt(soma("porGastar")), nota: "pedidos aprovados por pagar" },
      { tom: soma("sobra") < 0 ? "bad" : "good", titulo: "Sobra Livre", valor: fmt(soma("sobra")), nota: `saldo ${fmt(soma("saldo"))} − por gastar` },
    ])}
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Cartão</th><th>Obra / Local</th><th>Responsável</th><th>Último Movimento</th><th class="r">Transferido</th><th class="r">Gasto</th><th class="r">Por Gastar</th><th class="r">Saldo no Cartão</th><th class="r">Sobra Livre</th></tr></thead>
      <tbody>${L.map(
        (x) => `<tr>
          <td><b>${esc(x.cartao)}</b>${x.fundo ? `<div class="fx2-mut">${esc(x.fundo)}</div>` : ""}</td>
          <td class="fx2-mut">${esc(x.obra)}</td><td>${esc(x.responsavel || "—")}</td>
          <td>${x.ultimo ? fmtData(x.ultimo) : "—"}</td>
          <td class="r">${fmt(x.transferido)}</td><td class="r">${fmt(x.gasto)}</td><td class="r">${fmt(x.porGastar)}</td>
          <td class="r">${fmt(x.saldo)}${x.moeda !== "AOA" ? ` <small class="fx2-mut">${esc(x.moeda)}</small>` : ""}</td>
          <td class="r${x.sobra < 0 ? " f0-neg" : ""}"><b>${fmt(x.sobra)}</b></td></tr>`
      ).join("")}</tbody></table></div>`
        : vazio("Não há cartões ativos.")
    }
    <p class="fcal-nota">Transferido = carregamentos do fundo e entradas do extrato do cartão. Gasto = utilizações do fundo e saídas do extrato
      (sem operações anuladas). Por gastar = pedidos extra aprovados, a pagar por este cartão (ou pelo seu fundo). Sobra livre = saldo − por gastar.
      Os movimentos tratam-se em <a href="/Financeiro/conciliacao">T2 · Conciliação</a>; a quem está entregue cada cartão em
      <a href="/Financeiro/alocacao-cartoes">T6</a>.</p>`;
}

export async function render() {
  codigoNoCabecalho("T7");
  desenhar();
  try {
    S.d = await apiRequest("/finance/working-capital");
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
