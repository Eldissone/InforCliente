const { prisma } = require("../db");

async function main() {
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "Warehouse_projectId_key"');
  console.log("Dropped Warehouse_projectId_key");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
