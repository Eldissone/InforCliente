const { prisma } = require("../src/db");
(async () => {
  const rows = await prisma.user.groupBy({ by: ["role"], _count: { _all: true } });
  console.log(rows.map((r) => `${r.role}=${r._count._all}`).join("  "));
  await prisma.$disconnect();
})();
