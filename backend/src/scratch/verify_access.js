const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'cmp59pxao0001hxrkhmu5tpng'; // Maria
  const assigned = await prisma.project.findMany({
    where: {
      assignedUsers: { some: { id: userId } }
    },
    select: { id: true, name: true, clientId: true }
  });
  console.log('Projects Maria is assigned to:', JSON.stringify(assigned, null, 2));

  const all = await prisma.project.findMany({
    select: { id: true, name: true, clientId: true }
  });
  console.log('All Projects in DB:', JSON.stringify(all, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
