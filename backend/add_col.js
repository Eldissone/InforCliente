const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "DailyPlanStatus" ADD VALUE IF NOT EXISTS 'PENDING_RETURN';`);
    console.log("Enum updated successfully.");
  } catch (error) {
    console.error("Error updating enum:", error.message);
  }
  
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "DailyPlan" ADD COLUMN IF NOT EXISTS "returnedBy" TEXT;`);
    console.log("Column returnedBy added successfully.");
  } catch (error) {
    console.error("Error adding column:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
