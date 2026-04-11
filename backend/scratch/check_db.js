const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.client.count();
  console.log(`Total clients in DB: ${count}`);
  const clients = await prisma.client.findMany({ take: 5 });
  console.log('Sample clients:', JSON.stringify(clients, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
