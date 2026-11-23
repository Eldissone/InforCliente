/**
 * S3 Stock por Armazém — o `V.fstk` do protótipo.
 *
 * O que está em cada armazém, à quantidade e ao custo médio desse armazém.
 * O material comprado para armazém fica em stock (não é custo); o custo nasce
 * na saída. As entradas, saídas e transferências fazem-se em Pedidos de
 * Logística e na gestão de armazém de cada obra.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, kpis, vazio, erro, root, norm, fmtQ, select, pesquisa, ligar } from "./ui.js";

const S = { dados: null, erro: null, q: "", a: "", c: "", baixo: "" };

const CAT = { MATERIAL: "Material", TOOL: "Ferramenta", EQUIPMENT: "Equipamento", CONSUMABLE: "Consumível" };
const TIPO = { CENTRAL: "Central", SITE: "Obra", CLIENT: "Cliente" };

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.dados) return (el.innerHTML = vazio("A carregar…"));
  const { items, grupos, total, semCusto, armazens } = S.dados;
  const q = norm(S.q).trim();
  const L = items.filter(
    (i) =>
      (!S.a || i.armazemId === S.a) &&
      (!S.c || i.categoria === S.c) &&
      (!S.baixo || (i.minimo > 0 && i.quantidade < i.minimo)) &&
      (!q || norm([i.codigo, i.produto, i.armazem, i.obra].join(" ")).includes(q))
  );
  const soma = L.reduce((s, i) => s + i.valor, 0);
  const baixos = items.filter((i) => i.minimo > 0 && i.quantidade < i.minimo).length;
  el.innerHTML = `
    ${kpis([
      { tom: "blue", titulo: "Valor em Stock", valor: fmt(total), nota: `${items.length} linha(s) com quantidade` },
      ...grupos.map((g) => ({ tom: "neu", titulo: g.nome, valor: fmt(g.valor), nota: `${g.linhas} linha(s)` })),
      baixos ? { tom: "warn", titulo: "Abaixo do Mínimo", valor: String(baixos), nota: "produtos a repor" } : null,
    ])}
    <div class="fcal-filtros">
      ${pesquisa(S, "produto, código, armazém…")}
      ${select("a", S.a, (armazens || []).map((a) => [a.id, `${a.name} · ${TIPO[a.type] || a.type}`]), "Todos os armazéns")}
      ${select("c", S.c, Object.entries(CAT), "Todas as categorias")}
      ${select("baixo", S.baixo, [["1", "Só abaixo do mínimo"]], "Todos os níveis")}
      <a class="fcal-todos" href="/Stock">Entradas, saídas e transferências →</a>
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Armazém</th><th>Código</th><th>Produto</th><th>Categoria</th><th class="r">Quantidade</th><th>Un.</th><th class="r">Custo Médio</th><th class="r">Valor em Stock</th></tr></thead>
      <tbody>${L.map(
        (i) => `<tr>
          <td class="fx2-mut">${esc(i.armazem)}${i.obra ? ` · ${esc(i.obra)}` : ""}</td>
          <td class="fx2-mut">${esc(i.codigo || "")}</td>
          <td><b>${esc(i.produto)}</b>${i.terceiro ? ` <span class="fcal-pill fcal-pill--slate">de terceiro</span>` : ""}${
            i.minimo > 0 && i.quantidade < i.minimo ? ` <span class="fcal-pill fcal-pill--warn">mín. ${fmtQ(i.minimo)}</span>` : ""
          }</td>
          <td class="fx2-mut">${esc(CAT[i.categoria] || i.categoria || "")}</td>
          <td class="r"><b>${fmtQ(i.quantidade)}</b></td>
          <td class="fx2-mut">${esc(i.un)}</td>
          <td class="r">${i.custoMedio === null ? `<span class="fx2-mut">sem custo</span>` : fmt(i.custoMedio)}</td>
          <td class="r">${fmt(i.valor)}</td>
        </tr>`
      ).join("")}</tbody>
      <tfoot><tr><td colspan="7">Total (${L.length})</td><td class="r">${fmt(soma)}</td></tr></tfoot>
      </table></div>`
        : vazio(items.length ? "Nada a mostrar com estes filtros." : "Sem stock em nenhum armazém.")
    }
    <p class="fcal-nota">
      O custo médio é o de cada armazém, atualizado a cada entrada; a saída para a obra é custo da obra a esse
      valor. Transferências entre armazéns não são custo.${semCusto ? ` ${semCusto} linha(s) ainda sem custo médio (entradas sem preço): não contam para o valor.` : ""}
    </p>`;
}

export async function render() {
  ligar(S, desenhar);
  const a = new URLSearchParams(window.location.search).get("armazem");
  if (a) S.a = a;
  desenhar();
  try {
    S.dados = await apiRequest("/compras-stock/stock");
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
