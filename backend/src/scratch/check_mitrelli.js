const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'acesso@mitrelli.com' },
    include: {
      assignedProjects: true,
      accounts: { include: { client: true } }
    }
  });

  console.log('User Profile:', JSON.stringify({ id: user?.id, email: user?.email, role: user?.role, clientId: user?.clientId }, null, 2));
  console.log('Client Links (Accounts):', JSON.stringify(user?.accounts, null, 2));
  console.log('Assigned Projects:', JSON.stringify(user?.assignedProjects, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
