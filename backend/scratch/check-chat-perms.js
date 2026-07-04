const { prisma } = require('../src/db');

async function main() {
  const chatPerms = await prisma.rolePermission.findMany({ where: { module: 'chat' } });
  console.log('=== chat rolePermissions ===');
  console.table(chatPerms.map(r => ({ role: r.role, action: r.action, allowed: r.allowed })));

  // Verificar se há overrides de userPermission que bloqueiam o chat
  const chatOverrides = await prisma.userPermission.findMany({ where: { module: 'chat' } });
  console.log('\n=== chat userPermission overrides ===');
  console.table(chatOverrides.map(r => ({ userId: r.userId, action: r.action, allowed: r.allowed })));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
