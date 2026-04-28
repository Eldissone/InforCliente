import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const items = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      clientId: true,
      profilePic: true,
      createdAt: true,
      client: { select: { id: true, name: true, code: true, profilePic: true } },
    },
  });
  console.log('Users Response Sample:', JSON.stringify(items.slice(0, 3), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
