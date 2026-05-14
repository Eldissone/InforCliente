const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'cmp59pxao0001hxrkhmu5tpng'; // Maria
  const clientId = null; // Maria selected Teste A (no client)

  const projects = await prisma.project.findMany({
    where: {
      OR: [
        ...(clientId ? [{ clientId }] : []),
        { assignedUsers: { some: { id: userId } } }
      ]
    },
    select: { id: true, name: true, clientId: true }
  });

  console.log('Backend result for /client-summary:', JSON.stringify(projects, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
