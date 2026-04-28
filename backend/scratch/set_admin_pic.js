import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@infocliente.com' } });
  if (admin) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { profilePic: 'https://avatar.iran.liara.run/public/admin' }
    });
    console.log('Admin profile pic updated');
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
