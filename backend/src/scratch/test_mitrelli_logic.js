const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const user = await prisma.user.findUnique({ where: { email: 'acesso@mitrelli.com' } });
  const sub = user.id;
  const clientId = user.clientId;
  const role = user.role;

  console.log('Testing access for:', user.email);
  console.log('User ID (sub):', sub);
  console.log('User ClientID:', clientId);

  // Simulating ensureProjectReadable logic
  const projectId = 'cmohe64kx0001hxg4vru9vyyy'; // SUMBE
  
  const scopedClientId = (role === 'cliente') ? (clientId || null) : null;
  console.log('Scoped Client ID:', scopedClientId);

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        ...(scopedClientId ? [{ clientId: scopedClientId }] : []),
        { assignedUsers: { some: { id: sub } } }
      ]
    }
  });

  console.log('Project Found:', project ? project.name : 'NULL (404)');

  // Simulating list logic
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        ...(scopedClientId ? [{ clientId: scopedClientId }] : []),
        { assignedUsers: { some: { id: sub } } }
      ]
    },
    select: { id: true, name: true, clientId: true }
  });

  console.log('Visible Projects:', JSON.stringify(projects, null, 2));
}

test().catch(console.error).finally(() => prisma.$disconnect());
