const { prisma } = require("../db");

/**
 * Lê campos de entrega adicionados na Fase 5 via SQL directo.
 * Necessário quando o Prisma Client ainda não foi regenerado após a migração.
 */
async function fetchDeliveryFieldsByQuoteIds(ids, tx = prisma) {
  if (!ids?.length) return new Map();
  const rows = await tx.$queryRawUnsafe(
    `SELECT id,
            "deliveryStatus"::text AS "deliveryStatus",
            "receivedAt",
            "expectedReceiptDate"
     FROM "NeedQuote"
     WHERE id = ANY($1::text[])`,
    ids
  );
  const map = new Map();
  for (const row of rows) map.set(row.id, row);
  return map;
}

async function getQuoteDeliveryGuard(quoteId, tx = prisma) {
  const rows = await tx.$queryRawUnsafe(
    `SELECT id,
            "orderNumber",
            "deliveryStatus"::text AS "deliveryStatus",
            "receivedAt"
     FROM "NeedQuote"
     WHERE id = $1`,
    quoteId
  );
  return rows[0] || null;
}

async function markQuoteReceived(quoteId, tx = prisma) {
  await tx.$executeRawUnsafe(
    `UPDATE "NeedQuote"
     SET "deliveryStatus" = 'RECEBIDO'::"DeliveryStatus",
         "receivedAt" = NOW()
     WHERE id = $1`,
    quoteId
  );
}

async function setMovementSourceQuote(movementId, quoteId, tx = prisma) {
  await tx.$executeRawUnsafe(
    `UPDATE "StockMovement" SET "sourceQuoteId" = $1 WHERE id = $2`,
    quoteId,
    movementId
  );
}

async function setQuoteDeliveryPending(quoteId, tx = prisma) {
  await tx.$executeRawUnsafe(
    `UPDATE "NeedQuote"
     SET "deliveryStatus" = 'PENDENTE'::"DeliveryStatus"
     WHERE id = $1 AND "deliveryStatus"::text <> 'RECEBIDO'`,
    quoteId
  );
}

module.exports = {
  fetchDeliveryFieldsByQuoteIds,
  getQuoteDeliveryGuard,
  markQuoteReceived,
  setMovementSourceQuote,
  setQuoteDeliveryPending,
};
