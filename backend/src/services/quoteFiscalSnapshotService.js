const { prisma } = require("../db");
const { quoteFiscalSnapshot } = require("./needInstallmentSchedulingService");

const quoteFiscalInclude = {
  supplier: {
    select: {
      vatPercent: true,
      withholdingPercent: true,
      discountPercent: true,
    },
  },
  supplierProduct: {
    select: {
      vatPercent: true,
      withholdingPercent: true,
      discountPercent: true,
    },
  },
  need: { select: { quantity: true, hours: true } },
};

/** Calcula e persiste IVA/retenção/desconto + líquido a pagar na cotação. */
async function syncQuoteFiscalSnapshot(quoteId, client = prisma) {
  const quote = await client.needQuote.findUnique({
    where: { id: quoteId },
    include: quoteFiscalInclude,
  });
  if (!quote) return null;

  const snapshot = quoteFiscalSnapshot(quote, quote.need);

  return client.needQuote.update({
    where: { id: quoteId },
    data: {
      netTotal: String(snapshot.net),
      vatAmount: snapshot.vat > 0 ? String(snapshot.vat) : null,
      withholdingAmount: snapshot.withholding > 0 ? String(snapshot.withholding) : null,
      discountAmount: snapshot.discount > 0 ? String(snapshot.discount) : null,
      fiscalApplyVat: snapshot.applyVat,
      fiscalApplyWithholding: snapshot.applyWithholding,
      fiscalApplyDiscount: snapshot.applyDiscount,
    },
  });
}

async function syncAllSelectedQuoteFiscalSnapshots(needId, client = prisma) {
  const selected = await client.needQuote.findMany({
    where: { needId, selected: true },
    select: { id: true },
  });
  for (const q of selected) {
    await syncQuoteFiscalSnapshot(q.id, client);
  }
}

module.exports = {
  syncQuoteFiscalSnapshot,
  syncAllSelectedQuoteFiscalSnapshots,
  quoteFiscalInclude,
};
