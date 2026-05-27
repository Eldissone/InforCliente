const { prisma } = require("../db");

async function main() {
  const indexes = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'Warehouse'
  `;
  console.log(indexes);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
