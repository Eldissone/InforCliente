const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function migrate() {
  console.log("Migrating User.clientId to UserClient join table...");
  const users = await prisma.user.findMany({
    where: { clientId: { not: null } }
  });

  for (const user of users) {
    console.log(`Linking user ${user.email} to client ${user.clientId}...`);
    try {
      await prisma.userClient.upsert({
        where: {
          userId_clientId: {
            userId: user.id,
            clientId: user.clientId
          }
        },
        create: {
          userId: user.id,
          clientId: user.clientId,
          role: user.role
        },
        update: {
          role: user.role
        }
      });
    } catch (err) {
      console.error(`Failed to link user ${user.id}: ${err.message}`);
    }
  }
  console.log("Migration finished.");
  await prisma.$disconnect();
}

migrate();
