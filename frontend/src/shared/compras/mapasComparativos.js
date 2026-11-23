/**
 * C2 Mapas Comparativos — o `V.cmap` do protótipo.
 *
 * Uma caixa por necessidade com cotações: as propostas dos fornecedores lado a
 * lado (preço, total, crédito, entrega), a mais barata a verde e a escolhida
 * marcada. A escolha continua a fazer-se em Cotação (C1).
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, kpis, vazio, erro, root, norm, fmtQ, chip, pesquisa, ligar } from "./ui.js";

const S = { dados: null, erro: null, e: "", q: "" };

function mapa(m) {
  const pill =
    m.estado === "Adjudicado"
      ? `<span class="fcal-pill fcal-pill--good">Adjudicado</span>`
      : m.estado === "Para decidir"
        ? `<span class="fcal-pill fcal-pill--warn">Para decidir</span>`
        : `<span class="fcal-pill fcal-pill--slate">Só uma proposta</span>`;
  return `<section class="cs-mapa">
    <div class="cs-mapa-h">
      <b>${esc(m.descricao)}</b>
      <span class="fx2-mut">${fmtQ(m.quantidade)} ${esc(m.un)}</span>
      <span class="fx2-mut">${esc(m.obra || m.centro || "Sede")}</span>
      <span class="fx2-mut">${fmtData(m.data)}</span>
      ${pill}
      ${m.poupanca > 0.5 ? `<span class="fx2-ajuda">a escolhida custa mais <b>${fmt(m.poupanca)}</b> que a mais barata</span>` : ""}
    </div>
    <div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Fornecedor</th><th class="r">Preço unit.</th><th class="r">Qtd.</th><th class="r">Total</th><th>Crédito</th><th>Entrega</th><th></th></tr></thead>
      <tbody>${m.propostas
        .map(
          (p) => `<tr class="${p.maisBarata ? "cs-best" : ""}">
          <td><b>${esc(p.fornecedor)}</b>${p.maisBarata ? ` <span class="fcal-pill fcal-pill--good">mais barata</span>` : ""}</td>
          <td class="r">${fmt(p.preco)} <span class="fx2-mut">${esc(p.moeda)}</span></td>
          <td class="r">${fmtQ(p.quantidade)}</td>
          <td class="r"><b>${fmt(p.total)}</b></td>
          <td class="fx2-mut">${p.credito ? `${p.credito} dias` : "pronto"}</td>
          <td class="fx2-mut">${p.entrega ? fmtData(p.entrega) : "—"}</td>
          <td>${p.escolhida ? `<span class="fcal-pill fcal-pill--blue">escolhida</span>` : ""}${p.proforma ? ` <a href="${esc(p.proforma)}" target="_blank" rel="noopener" class="fx2-ajuda">proforma</a>` : ""}</td>
        </tr>`
        )
        .join("")}</tbody>
    </table></div>
  </section>`;
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.dados) return (el.innerHTML = vazio("A carregar…"));
  const { mapas, totais: T } = S.dados;
  const q = norm(S.q).trim();
  const L = mapas.filter(
    (m) =>
      (!S.e || m.estado === S.e) &&
      (!q || norm([m.descricao, m.obra, m.centro, ...m.propostas.map((p) => p.fornecedor)].join(" ")).includes(q))
  );
  el.innerHTML = `
    ${kpis([
      { tom: "neu", titulo: "Mapas", valor: String(T.mapas), nota: "necessidades com cotações (12 meses)" },
      { tom: T.decidir ? "warn" : "good", titulo: "Para Decidir", valor: String(T.decidir), nota: "duas ou mais propostas, nenhuma escolhida", acao: "/Projectos/Cotacao" },
      { tom: "good", titulo: "Adjudicados", valor: String(T.adjudicados) },
      { tom: "neu", titulo: "Só Uma Proposta", valor: String(T.unica), nota: "sem comparação possível" },
    ])}
    <div class="fx2-chips">
      ${chip("e", "", S.e, "Todos", T.mapas)}
      ${chip("e", "Para decidir", S.e, "Para decidir", T.decidir)}
      ${chip("e", "Adjudicado", S.e, "Adjudicados", T.adjudicados)}
      ${chip("e", "Só uma proposta", S.e, "Só uma proposta", T.unica)}
    </div>
    <div class="fcal-filtros">
      ${pesquisa(S, "artigo, obra ou fornecedor…")}
      <span class="fx2-ajuda">Para escolher uma proposta, abra o artigo em <a href="/Projectos/Cotacao">C1 Pedidos de Cotação</a>.</span>
    </div>
    ${L.length ? L.map(mapa).join("") : vazio(mapas.length ? "Nada a mostrar com estes filtros." : "Ainda não há cotações registadas.")}`;
}

export async function render() {
  ligar(S, desenhar);
  desenhar();
  try {
    S.dados = await apiRequest("/compras-stock/comparisons");
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
