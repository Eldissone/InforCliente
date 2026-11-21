/**
 * O que a obra consumiu do armazém → linhas da folha de Materiais.
 *
 * As obras nunca tiveram custo registado: as tabelas de quantidades são preços
 * de venda, o stock não tem custo médio e os movimentos não têm custo unitário.
 * O que o armazém **sabe** é o que saiu e quanto: 1 468 saídas em 12 obras.
 *
 * Isto traz essas quantidades para a folha de Materiais do orçamento e **deixa
 * o preço por preencher**, de propósito. Dá o levantamento feito — que material
 * e que quantidade — sem inventar um único valor. O orçamento fica logo com o
 * alerta «Custo unitário não preenchido» a apontar às linhas que faltam valorizar.
 *
 * ─── O que conta como consumo ──────────────────────────────────────────────
 *
 * **EXIT e LOSS**, que é o que o `financeLedgerService` já trata como custo
 * realizado da obra. Usa-se o mesmo critério de propósito: dois vocabulários de
 * consumo no mesmo sistema davam dois números para a mesma pergunta.
 *
 * **ALLOCATION e RETURN ficam de fora.** O próprio esquema diz o que são:
 * entrega a um plano diário (custódia da equipa, não é consumo) e devolução ao
 * estaleiro do que não foi consumido. Contá-las era contar duas vezes o que
 * depois sai como EXIT.
 */

const { productUnit } = require("./units");

/** Os tipos de movimento que são consumo da obra. */
const CONSUMPTION_TYPES = ["EXIT", "LOSS"];

function round4(v) {
  return Math.round((Number(v) || 0) * 10000) / 10000;
}

/**
 * Agrega movimentos por produto e devolve linhas da folha `mat`.
 *
 * @param {Array} movements `{ productId, quantity, type, product: { name, sku, unit } }`
 * @param {object} [opts]
 * @param {string} [opts.currency] moeda base do orçamento, só para a coluna
 * @returns {{ rows: Array, resumo: object }}
 */
function consumptionRows(movements, { currency = "AOA" } = {}) {
  const byProduct = new Map();
  let ignorados = 0;

  for (const mv of movements || []) {
    if (!CONSUMPTION_TYPES.includes(mv.type)) {
      ignorados += 1;
      continue;
    }
    const id = mv.productId || mv.product?.id;
    const nome = String(mv.product?.name ?? "").trim();
    if (!id || !nome) {
      ignorados += 1;
      continue;
    }
    const q = Number(mv.quantity) || 0;
    const e =
      byProduct.get(id) ||
      byProduct
        .set(id, { id, nome, sku: mv.product?.sku || "", unidade: mv.product?.unit, q: 0, movimentos: 0, perdas: 0 })
        .get(id);
    e.q += q;
    e.movimentos += 1;
    if (mv.type === "LOSS") e.perdas += q;
  }

  const unidadesPorReconhecer = new Map();
  const rows = [...byProduct.values()]
    // Quantidade a zero ou negativa não é consumo: não se leva para o orçamento.
    .filter((p) => p.q > 0)
    .sort((a, b) => b.q - a.q || a.nome.localeCompare(b.nome))
    .map((p) => {
      const u = productUnit(p.unidade);
      if (!u.matched && u.original) {
        unidadesPorReconhecer.set(u.original, (unidadesPorReconhecer.get(u.original) || 0) + 1);
      }
      return {
        cod: p.sku || "",
        fam: "",
        desc: p.nome,
        un: u.unit,
        q: round4(p.q),
        cli: "Não",
        // O preço fica por preencher: é o que o sistema não sabe. A linha
        // entra no alerta «Custo unitário não preenchido» até alguém a valorizar.
        preco: null,
        moeda: currency,
      };
    });

  return {
    rows,
    resumo: {
      artigos: rows.length,
      movimentos: (movements || []).filter((m) => CONSUMPTION_TYPES.includes(m.type)).length,
      ignorados,
      quantidadeTotal: round4(rows.reduce((a, r) => a + r.q, 0)),
      comPerdas: [...byProduct.values()].filter((p) => p.perdas > 0).length,
      unidadesPorReconhecer: [...unidadesPorReconhecer.entries()].map(([original, artigos]) => ({ original, artigos })),
    },
  };
}

module.exports = { CONSUMPTION_TYPES, consumptionRows };
