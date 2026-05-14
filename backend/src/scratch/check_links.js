const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'cmp59pxao0001hxrkhmu5tpng'; // Maria
  const links = await prisma.userClient.findMany({
    where: { userId },
    include: { client: true }
  });
  console.log('Maria Client Links:', JSON.stringify(links, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
