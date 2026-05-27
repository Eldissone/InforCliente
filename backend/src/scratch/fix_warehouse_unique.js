const { prisma } = require("../db");

async function main() {
  const constraints = await prisma.$queryRaw`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = '"Warehouse"'::regclass
  `;
  console.log("Constraints:", constraints);

  await prisma.$executeRawUnsafe(
    'ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS "Warehouse_projectId_key"'
  );

  const after = await prisma.$queryRaw`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = '"Warehouse"'::regclass
  `;
  console.log("After drop:", after);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
