const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning up stock tables...');
  try {
    await prisma.stockMovement.deleteMany({});
    await prisma.projectStock.deleteMany({});
    await prisma.material.deleteMany({});
    console.log('Cleanup successful.');
  } catch (err) {
    console.error('Cleanup failed (maybe tables already deleted?):', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
