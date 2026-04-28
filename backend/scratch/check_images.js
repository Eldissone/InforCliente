import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const clients = await prisma.client.findMany({ where: { profilePic: { not: null } }, select: { id: true, name: true, profilePic: true } });
  console.log('Clients with images:', JSON.stringify(clients, null, 2));
  const users = await prisma.user.findMany({ where: { profilePic: { not: null } }, select: { id: true, email: true, profilePic: true } });
  console.log('Users with images:', JSON.stringify(users, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
