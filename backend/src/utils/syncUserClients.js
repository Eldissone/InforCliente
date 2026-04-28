/**
 * syncUserClients.js
 * 
 * One-time migration script: populates the UserClient join table
 * for all existing users that already have a clientId set but
 * don't have a corresponding UserClient record.
 * 
 * Run: node src/utils/syncUserClients.js
 */

const { prisma } = require("../db");

async function sync() {
  console.log("🔄 Syncing UserClient join table...");

  // Find all users with a clientId that are missing a UserClient record
  const usersWithClient = await prisma.user.findMany({
    where: {
      clientId: { not: null },
    },
    select: { id: true, email: true, clientId: true, role: true },
  });

  let created = 0;
  let skipped = 0;

  for (const user of usersWithClient) {
    const existing = await prisma.userClient.findUnique({
      where: { userId_clientId: { userId: user.id, clientId: user.clientId } },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.userClient.create({
      data: {
        userId: user.id,
        clientId: user.clientId,
        role: user.role,
      },
    });
    created++;
    console.log(`  ✅ Linked ${user.email} → client ${user.clientId}`);
  }

  console.log(`\nDone. Created: ${created} | Already existed: ${skipped}`);
  await prisma.$disconnect();
}

sync().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
