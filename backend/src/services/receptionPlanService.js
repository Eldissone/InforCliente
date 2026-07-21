const { prisma } = require("../db");
const { normalizeDateOnly } = require("../utils/dateOnly");

/** Sincroniza data prevista de recepção (WorkNeed) → entregas na logística (NeedQuote). */
async function syncNeedReceptionToOrderedQuotes(needId, siteReceptionPlannedAt, tx = prisma) {
  const plannedAt = normalizeDateOnly(siteReceptionPlannedAt);

  await tx.needQuote.updateMany({
    where: { needId, orderNumber: { not: null } },
    data: { expectedReceiptDate: plannedAt },
  });
}

function resolveExpectedReceiptDate(quote) {
  return quote?.expectedReceiptDate || quote?.need?.siteReceptionPlannedAt || null;
}

module.exports = {
  syncNeedReceptionToOrderedQuotes,
  resolveExpectedReceiptDate,
};
