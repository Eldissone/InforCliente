/**
 * P3 Despesas sem Comprovativo — as linhas de pedidos de pagamento que não
 * têm documento fiscal.
 *
 * No protótipo (`V.fdsc`) cada linha marcada «sem comprovativo» espera uma
 * decisão: mantém-se como DSC, passa a autofaturação, ou apareceu a fatura.
 * Na app, quem pede marca a linha (`PurchaseOrderItem.docException`: DSC ou
 * AF); o financeiro decide depois, aqui (`dscDecision`): mantém DSC, passa a
 * autofaturação, ou apareceu a fatura (anexa-se). Sem decisão, a linha está
 * «por decidir».
 *
 * **O encargo da DSC.** Uma despesa sem documento não é aceite como custo
 * fiscal; o protótipo soma-lhe 25% de encargo (`DSC_ENC = 0.25`) para se ver o
 * custo verdadeiro da decisão. Mantém-se a mesma regra.
 *
 * O valor da linha é o do pedido: base + IVA − retenção, pela mesma conta de
 * `purchaseTotals.lineTotals` que todos os ecrãs de pagamentos usam.
 */

const { lineTotals } = require("../purchase/purchaseTotals");

const DSC_ENCARGO = 0.25;

const DECISOES = ["DSC", "AF", "FATURA"];

/** DSC enquanto não houver decisão contrária: por decidir com marca DSC, ou mantém DSC. */
function efetiva(it) {
  if (it.dscDecision) return it.dscDecision;
  return it.docException === "DSC" ? "DSC" : it.docException;
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Estados de pedido que não chegam a ser despesa. */
const FORA = new Set(["RASCUNHO", "NAO_APROVADO", "CANCELADO"]);

/**
 * @param {Array} orders pedidos com `items`, `number`, `status`, `createdAt`,
 *   `supplierName`, `supplier: { name }`, `project: { code, name }`,
 *   `costCenter: { code, name }`
 */
function dscLines(orders) {
  const linhas = [];
  for (const o of orders || []) {
    if (FORA.has(o.status)) continue;
    for (const it of o.items || []) {
      if (!it.docException) continue;
      const t = lineTotals(it);
      linhas.push({
        id: it.id,
        pedidoId: o.id,
        pedido: o.number,
        estado: o.status,
        data: o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : null,
        fornecedor: o.supplier?.name || o.supplierName || "—",
        produto: it.name,
        obra: o.project ? [o.project.code, o.project.name].filter(Boolean).join(" · ") : o.costCenter?.name || "",
        // O que quem pediu marcou, e o que o financeiro decidiu.
        marcado: it.docException,
        decisao: it.dscDecision || null,
        decididoEm: it.dscDecidedAt || null,
        decididoPor: it.dscDecidedBy || null,
        documento: it.dscDocPath || null,
        documentoNome: it.dscDocName || null,
        valor: t.total,
        // Encargo de 25% enquanto a linha for (ou puder ficar) sem comprovativo.
        encargo: efetiva(it) === "DSC" ? round2(t.total * DSC_ENCARGO) : 0,
      });
    }
  }
  linhas.sort((a, b) => (b.data || "").localeCompare(a.data || ""));

  const de = (d) => linhas.filter((l) => l.decisao === d);
  const soma = (L, k = "valor") => round2(L.reduce((s, l) => s + l[k], 0));
  const dsc = de("DSC");
  const af = de("AF");
  const fat = de("FATURA");
  const pd = de(null);
  return {
    linhas,
    totais: {
      porDecidir: soma(pd),
      nPorDecidir: pd.length,
      porDecidirEncargo: soma(pd, "encargo"),
      dsc: soma(dsc),
      dscEncargo: soma(dsc, "encargo"),
      dscCustoTotal: round2(soma(dsc) + soma(dsc, "encargo")),
      nDsc: dsc.length,
      af: soma(af),
      nAf: af.length,
      fatura: soma(fat),
      nFatura: fat.length,
    },
    encargo: DSC_ENCARGO,
  };
}

module.exports = { dscLines, DSC_ENCARGO, DECISOES };
