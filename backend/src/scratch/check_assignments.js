const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const maria = await prisma.user.findUnique({
    where: { email: 'maria@m.com' },
    include: {
      assignedProjects: {
        select: { id: true, name: true, clientId: true }
      }
    }
  });

  console.log('Maria Profile:', JSON.stringify({ id: maria.id, email: maria.email, clientId: maria.clientId }, null, 2));
  console.log('Maria Assigned Projects:', JSON.stringify(maria.assignedProjects, null, 2));

  const allProjects = await prisma.project.findMany({
    select: { id: true, name: true, clientId: true }
  });
  console.log('All Projects:', JSON.stringify(allProjects, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
