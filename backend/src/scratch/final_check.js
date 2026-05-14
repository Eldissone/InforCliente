const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const maria = await prisma.user.findUnique({ where: { email: 'maria@m.com' } });
  
  // Simulating token payload after selecting "Teste A"
  const req = {
    user: {
      sub: maria.id,
      email: maria.email,
      role: 'cliente',
      clientId: null // No client for Teste A
    }
  };

  const clientId = req.user.clientId;
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        ...(clientId ? [{ clientId }] : []),
        { assignedUsers: { some: { id: req.user.sub } } }
      ]
    },
    select: { id: true, name: true, clientId: true }
  });

  console.log('Final Verification - Result for Maria:', JSON.stringify(projects, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
