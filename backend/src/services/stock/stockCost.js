/**
 * Custo médio ponderado por armazém e produto.
 *
 * A regra, igual à do protótipo: **material comprado para armazém não é custo**.
 * O custo nasce na **saída** — consumo na obra, na viatura ou na sede — e é o custo
 * médio do armazém de onde saiu, no momento em que saiu.
 *
 * O custo fica gravado no próprio movimento (`StockMovement.unitCost` e `totalValue`),
 * para o custo da obra não mudar quando o custo médio mudar depois.
 *
 * ⚠️ Nota de arquitetura: o `financeLedgerService` calcula, para o razão financeiro,
 * um custo médio **global por produto** derivado dos preços das cotações. Esta função
 * é por **armazém** e usa o custo gravado nos movimentos. Enquanto os dois existirem,
 * o razão financeiro mantém a sua própria vista e esta serve o armazém e as obras;
 * reconciliar as duas é um ponto da Fase 6 (ver o plano, risco 4).
 */

const { prisma } = require("../../db");

const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round4 = (v) => Math.round(N(v) * 1e4) / 1e4;
const round2 = (v) => Math.round(N(v) * 100) / 100;

/** Movimentos que acrescentam stock ao armazém. */
const IN_TYPES = ["ENTRY", "TRANSFER_IN", "RETURN"];
/** Movimentos que tiram stock do armazém. */
const OUT_TYPES = ["EXIT", "TRANSFER_OUT", "LOSS", "ALLOCATION"];

/** O movimento acrescenta (+1), tira (-1) ou é um acerto (0, a quantidade é o sinal). */
function direction(type) {
  if (IN_TYPES.includes(type)) return 1;
  if (OUT_TYPES.includes(type)) return -1;
  return 0; // ADJUSTMENT: o sinal vem na quantidade
}

/**
 * Nova média depois de uma entrada.
 *
 *   média = (quantidade × média anterior + quantidade que entra × custo que entra)
 *           ÷ (quantidade total)
 *
 * Entrada sem custo não mexe na média: preferimos manter a média conhecida a
 * diluí-la para zero com uma entrada sem preço.
 */
function averageAfterEntry({ qtyBefore, avgBefore, qtyIn, unitCostIn }) {
  const q0 = N(qtyBefore);
  const a0 = N(avgBefore);
  const qi = N(qtyIn);
  const ci = N(unitCostIn);
  if (!(qi > 0)) return a0 || null;
  if (!(ci > 0)) return a0 || null;
  const total = q0 + qi;
  if (!(total > 0)) return round4(ci);
  // Com stock negativo ou a zero, a média passa a ser a da entrada
  if (q0 <= 0 || !(a0 > 0)) return round4(ci);
  return round4((q0 * a0 + qi * ci) / total);
}

/**
 * Lê a quantidade e a média de um produto num armazém.
 * @returns {Promise<{quantity:number, avgCost:number|null, rowId:string|null}>}
 */
async function readStock(warehouseId, productId, { ownerId = null, client } = {}) {
  const db = client || prisma;
  const row = await db.warehouseStock.findFirst({
    where: { warehouseId, productId, ownerId },
    select: { id: true, quantity: true, avgCost: true },
  });
  return {
    quantity: row ? N(row.quantity) : 0,
    avgCost: row && row.avgCost !== null ? N(row.avgCost) : null,
    rowId: row ? row.id : null,
  };
}

/**
 * Custo médio a usar numa saída deste armazém. Se o armazém não tem média
 * (nunca entrou nada com preço), devolve null — a saída fica sem custo e isso
 * aparece como aviso, em vez de se inventar um valor.
 */
async function exitUnitCost(warehouseId, productId, { ownerId = null, client } = {}) {
  const { avgCost } = await readStock(warehouseId, productId, { ownerId, client });
  return avgCost && avgCost > 0 ? avgCost : null;
}

/**
 * Aplica um movimento ao stock: mexe na quantidade e, numa entrada com custo,
 * recalcula a média. Devolve o custo unitário e o valor a gravar no movimento.
 *
 * Não cria o `StockMovement` — quem chama é que o faz, para poder juntar tudo
 * na mesma transação.
 *
 * @param {object} o
 * @param {string} o.warehouseId
 * @param {string} o.productId
 * @param {string} o.type        MovementType
 * @param {number} o.quantity    sempre positiva (o sentido vem do tipo)
 * @param {number} [o.unitCost]  custo de compra, só nas entradas
 * @param {string|null} [o.ownerId]
 * @param {object} [o.client]    cliente Prisma dentro de uma transação
 * @returns {Promise<{unitCost:number|null, totalValue:number|null, quantityAfter:number, avgCostAfter:number|null, warning:string|null}>}
 */
async function applyMovement({ warehouseId, productId, type, quantity, unitCost, ownerId = null, client }) {
  const db = client || prisma;
  const dir = direction(type);
  const qty = N(quantity);
  const before = await readStock(warehouseId, productId, { ownerId, client: db });

  let cost = null;
  let avgAfter = before.avgCost;
  let warning = null;
  let delta;

  if (dir === 1) {
    delta = qty;
    cost = N(unitCost) > 0 ? round4(unitCost) : before.avgCost;
    avgAfter = averageAfterEntry({
      qtyBefore: before.quantity,
      avgBefore: before.avgCost,
      qtyIn: qty,
      unitCostIn: N(unitCost),
    });
    if (!(N(unitCost) > 0)) {
      warning = "Entrada sem custo de compra: a média do armazém não mudou.";
    }
  } else if (dir === -1) {
    delta = -qty;
    cost = before.avgCost;
    if (!cost) {
      warning = "O armazém não tem custo médio para este produto: a saída fica sem custo.";
    }
    if (qty > before.quantity) {
      warning = `Só há ${before.quantity} em stock: a saída deixa o armazém negativo.`;
    }
  } else {
    // Acerto de inventário: a quantidade é a diferença, com sinal
    delta = qty;
    cost = before.avgCost;
  }

  const quantityAfter = round4(before.quantity + delta);

  if (before.rowId) {
    await db.warehouseStock.update({
      where: { id: before.rowId },
      data: { quantity: quantityAfter, avgCost: avgAfter },
    });
  } else {
    await db.warehouseStock.create({
      data: { warehouseId, productId, ownerId, quantity: quantityAfter, avgCost: avgAfter },
    });
  }

  return {
    unitCost: cost && cost > 0 ? round4(cost) : null,
    totalValue: cost && cost > 0 ? round2(cost * qty) : null,
    quantityAfter,
    avgCostAfter: avgAfter,
    warning,
  };
}

/**
 * Recalcula a média de um produto num armazém a partir do histórico de movimentos.
 * Para corrigir dados antigos ou depois de apagar um movimento.
 */
async function recomputeAverage(warehouseId, productId, { ownerId = null, client } = {}) {
  const db = client || prisma;
  const movements = await db.stockMovement.findMany({
    where: { warehouseId, productId, ownerId },
    orderBy: { createdAt: "asc" },
    select: { type: true, quantity: true, unitCost: true },
  });

  let qty = 0;
  let avg = null;
  for (const m of movements) {
    const dir = direction(m.type);
    const q = N(m.quantity);
    if (dir === 1) {
      const next = averageAfterEntry({ qtyBefore: qty, avgBefore: avg, qtyIn: q, unitCostIn: N(m.unitCost) });
      avg = next;
      qty += q;
    } else if (dir === -1) {
      qty -= q;
    } else {
      qty += q;
    }
  }

  const row = await db.warehouseStock.findFirst({ where: { warehouseId, productId, ownerId }, select: { id: true } });
  if (row) {
    await db.warehouseStock.update({ where: { id: row.id }, data: { quantity: round4(qty), avgCost: avg } });
  }
  return { quantity: round4(qty), avgCost: avg, movements: movements.length };
}

/** Valor em stock de um armazém: soma de quantidade × custo médio. */
async function warehouseValue(warehouseId, { client } = {}) {
  const db = client || prisma;
  const rows = await db.warehouseStock.findMany({
    where: { warehouseId, quantity: { gt: 0 } },
    select: { quantity: true, avgCost: true, productId: true },
  });
  let value = 0;
  let withoutCost = 0;
  for (const r of rows) {
    const c = N(r.avgCost);
    if (c > 0) value += N(r.quantity) * c;
    else withoutCost += 1;
  }
  return { value: round2(value), lines: rows.length, withoutCost };
}

module.exports = {
  IN_TYPES,
  OUT_TYPES,
  direction,
  averageAfterEntry,
  readStock,
  exitUnitCost,
  applyMovement,
  recomputeAverage,
  warehouseValue,
};
