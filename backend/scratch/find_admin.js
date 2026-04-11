const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
    console.log('ADMIN_USER:', JSON.stringify(admin));
    
    const count = await prisma.client.count();
    console.log('CLIENT_COUNT:', count);
  } catch (err) {
    console.error('DB_ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
