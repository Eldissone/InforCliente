const { prisma } = require("../db");

const bankAccountSchema = {
  bankName: (v) => String(v || "").trim(),
  iban: (v) => String(v || "").trim(),
};

async function syncSupplierBankAccounts(supplierId, bankAccounts = []) {
  const normalized = bankAccounts
    .map((a) => ({
      bankName: bankAccountSchema.bankName(a.bankName) || "Banco",
      iban: bankAccountSchema.iban(a.iban),
      isPrimary: Boolean(a.isPrimary),
    }))
    .filter((a) => a.iban);

  await prisma.supplierBankAccount.deleteMany({ where: { supplierId } });

  if (normalized.length) {
    const hasPrimary = normalized.some((a) => a.isPrimary);
    await prisma.supplierBankAccount.createMany({
      data: normalized.map((a, index) => ({
        supplierId,
        bankName: a.bankName,
        iban: a.iban,
        isPrimary: hasPrimary ? Boolean(a.isPrimary) : index === 0,
      })),
    });
  }

  const primaryIban = normalized.find((a) => a.isPrimary)?.iban
    || normalized[0]?.iban
    || null;
  await prisma.supplier.update({
    where: { id: supplierId },
    data: { iban: primaryIban },
  });
}

const supplierInclude = {
  bankAccounts: {
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
  _count: { select: { products: true } },
};

module.exports = {
  syncSupplierBankAccounts,
  supplierInclude,
};
