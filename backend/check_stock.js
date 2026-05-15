const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const warehouses = await prisma.warehouse.findMany({
    include: {
      _count: {
        select: { stock: true, movements: true }
      }
    }
  });
  console.log(JSON.stringify(warehouses, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
