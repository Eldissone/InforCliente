/**
 * C3 Base de Preços — o `V.cprec` do protótipo.
 *
 * Os preços de compra que a empresa já tem: as tabelas de preço de cada
 * fornecedor e os preços das cotações adjudicadas. Um preço vale 90 dias
 * (ou até à validade da tabela); o mais barato válido de cada artigo fica
 * destacado.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, kpis, vazio, erro, root, norm, chip, select, pesquisa, ligar } from "./ui.js";

const S = { dados: null, erro: null, q: "", v: "", origem: "" };

const CAT = { MATERIAL: "Material", TOOL: "Ferramenta", EQUIPMENT: "Equipamento", CONSUMABLE: "Consumível" };

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.dados) return (el.innerHTML = vazio("A carregar…"));
  const { items, totais: T, validadeDias } = S.dados;
  const q = norm(S.q).trim();
  const L = items.filter(
    (r) =>
      (!S.v || (S.v === "1" ? r.valido : !r.valido)) &&
      (!S.origem || r.origem === S.origem) &&
      (!q || norm([r.artigo, r.codigo, r.fornecedor, r.obra].join(" ")).includes(q))
  );
  const origens = [...new Set(items.map((r) => r.origem))].map((o) => [o, o]);
  el.innerHTML = `
    ${kpis([
      { tom: "neu", titulo: "Preços na Base", valor: String(T.precos), nota: `${T.artigos} artigo(s)` },
      { tom: "good", titulo: "Válidos", valor: String(T.validos), nota: `até ${validadeDias} dias ou pela validade da tabela` },
      { tom: T.precos - T.validos ? "warn" : "good", titulo: "Expirados", valor: String(T.precos - T.validos), nota: "pedir nova cotação" },
      { tom: "blue", titulo: "Fornecedores", valor: String(T.fornecedores) },
    ])}
    <div class="fx2-chips">
      ${chip("v", "", S.v, "Todos", T.precos)}
      ${chip("v", "1", S.v, "Válidos", T.validos)}
      ${chip("v", "0", S.v, "Expirados", T.precos - T.validos)}
    </div>
    <div class="fcal-filtros">
      ${pesquisa(S, "artigo, código ou fornecedor…")}
      ${select("origem", S.origem, origens, "Todas as origens")}
      <span class="fx2-ajuda">${L.length} preço(s). A verde, o mais barato válido de cada artigo.</span>
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Estado</th><th>Artigo</th><th>Un.</th><th class="r">Preço s/ IVA</th><th class="r">IVA</th><th>Fornecedor</th><th>Origem</th><th>Obra</th><th>Data</th><th>Validade</th></tr></thead>
      <tbody>${L.map(
        (r) => `<tr class="${r.melhor ? "cs-best" : ""}">
          <td>${r.valido ? `<span class="fcal-pill fcal-pill--good">válido</span>` : `<span class="fcal-pill fcal-pill--warn">${r.idade ?? "?"} dias</span>`}</td>
          <td><b>${esc(r.artigo)}</b>${r.codigo ? ` <span class="fx2-mut">${esc(r.codigo)}</span>` : ""}${r.tipo ? ` <span class="fx2-mut">· ${esc(CAT[r.tipo] || r.tipo)}</span>` : ""}</td>
          <td class="fx2-mut">${esc(r.un || "")}</td>
          <td class="r"><b>${fmt(r.preco)}</b> <span class="fx2-mut">${esc(r.moeda)}</span></td>
          <td class="r fx2-mut">${r.iva != null ? `${r.iva}%` : ""}</td>
          <td>${esc(r.fornecedor || "—")}</td>
          <td class="fx2-mut">${esc(r.origem)}${r.condicao ? ` · ${esc(r.condicao)}` : ""}</td>
          <td class="fx2-mut">${esc(r.obra || "")}</td>
          <td class="fx2-mut">${fmtData(r.data)}</td>
          <td class="fx2-mut">${r.validade ? fmtData(r.validade) : ""}</td>
        </tr>`
      ).join("")}</tbody></table></div>`
        : vazio(
            items.length
              ? "Nada a mostrar com estes filtros."
              : "Ainda não há preços. Entram aqui as tabelas de preço dos fornecedores e as cotações adjudicadas."
          )
    }
    <p class="fcal-nota">As tabelas de preço editam-se na ficha do fornecedor (<a href="/fornecedores">C4 Fornecedores</a>); os preços das cotações vêm da proposta escolhida em <a href="/Projectos/Cotacao">C1 Pedidos de Cotação</a>.</p>`;
}

export async function render() {
  ligar(S, desenhar);
  desenhar();
  try {
    S.dados = await apiRequest("/compras-stock/prices");
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
