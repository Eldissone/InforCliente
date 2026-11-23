/**
 * C5 Compromissos Pendentes — o `V.fcomp` do protótipo.
 *
 * Compras já assumidas que ainda não são uma dívida documentada, em três
 * grupos: requisições das obras sem pedido de compra, pedidos por aprovar /
 * em cotação, e pedidos aprovados sem fatura.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, vazio, erro, root, norm, chip, select, pesquisa, ligar } from "./ui.js";

const S = { dados: null, erro: null, g: "", q: "", obra: "" };

const G = [
  ["req", "Requisições das Obras sem Pedido"],
  ["apr", "Por Aprovar / Em Cotação"],
  ["sft", "Aprovados sem Fatura"],
];

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.dados) return (el.innerHTML = vazio("A carregar…"));
  const { items, grupos, total } = S.dados;
  const q = norm(S.q).trim();
  const L = items.filter(
    (x) =>
      (!S.g || x.g === S.g) &&
      (!S.obra || (S.obra === "_" ? !x.obra : x.obra === S.obra)) &&
      (!q || norm([x.ref, x.fornecedor, x.descricao, x.obra].join(" ")).includes(q))
  );
  const soma = L.reduce((s, x) => s + x.valor, 0);
  const obras = [...new Set(items.map((x) => x.obra).filter(Boolean))].sort().map((o) => [o, o]);
  const v = (n) => `<i class="cs-chip-v">${fmt(n)}</i>`;
  el.innerHTML = `
    <div class="fx2-chips">
      ${chip("g", "", S.g, "Todos", items.length, v(total))}
      ${G.map(([k, l]) => chip("g", k, S.g, l, grupos[k].n, v(grupos[k].valor))).join("")}
    </div>
    <div class="fcal-filtros">
      ${pesquisa(S, "fornecedor, descrição, n.º…")}
      ${select("obra", S.obra, [["_", "Sede (sem obra)"], ...obras], "Todas as obras")}
      <span class="fx2-ajuda">${L.length} compromisso(s) · <b>${fmt(soma)}</b> AOA</span>
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>N.º</th><th>Data</th><th>Obra</th><th>Fornecedor</th><th>Descrição</th><th>Situação</th><th class="r">Valor</th></tr></thead>
      <tbody>${L.map(
        (x) => `<tr>
          <td><b>${x.link ? `<a href="${esc(x.link)}">${esc(x.ref || "—")}</a>` : esc(x.ref || "—")}</b></td>
          <td>${fmtData(x.data)}</td>
          <td class="fx2-mut">${esc(x.obra || "Sede")}</td>
          <td>${esc(x.fornecedor)}</td>
          <td class="fx2-mut" title="${esc(x.descricao)}">${esc(String(x.descricao).slice(0, 90))}</td>
          <td class="fx2-mut">${esc(x.situacao)}</td>
          <td class="r"><b>${fmt(x.valor)}</b>${x.moeda !== "AOA" ? ` <span class="fx2-mut">${esc(x.moeda)}</span>` : ""}</td>
        </tr>`
      ).join("")}</tbody>
      <tfoot><tr><td colspan="6">Total</td><td class="r">${fmt(soma)}</td></tr></tfoot>
      </table></div>`
        : vazio("Sem compromissos pendentes.")
    }
    <p class="fcal-nota">As requisições contam pelo que falta entregar, ao preço estimado na requisição. Os pedidos contam pelo valor a pagar (com IVA e retenção). Os pedidos aprovados já estão autorizados para pagamento: aparecem também no Centro de Pagamentos e na <a href="/compras/conta-corrente-fornecedores">C6 Conta Corrente de Fornecedores</a> — aqui ficam enquanto não estiverem pagos, para não se perder o que a fatura ainda vai trazer.</p>`;
}

export async function render() {
  ligar(S, desenhar);
  desenhar();
  try {
    S.dados = await apiRequest("/compras-stock/commitments");
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
