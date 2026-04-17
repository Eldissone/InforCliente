const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function populateNames() {
  console.log("Populating User.name from email prefixes...");
  const users = await prisma.user.findMany();

  for (const user of users) {
    if (!user.name) {
      // Extrair parte antes do @, substituir pontos/traços por espaços e capitalizar
      const prefix = user.email.split("@")[0];
      const name = prefix
        .split(/[._-]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      console.log(`Updating ${user.email} -> ${name}`);
      await prisma.user.update({
        where: { id: user.id },
        data: { name }
      });
    }
  }
  console.log("Names populated successfully.");
  await prisma.$disconnect();
}

populateNames();
