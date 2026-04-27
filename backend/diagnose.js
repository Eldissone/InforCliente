const { prisma } = require("./src/db");

async function diagnose() {
  const users = await prisma.user.findMany({
    select: { email: true, role: true, clientId: true }
  });
  console.log("--- USERS DIAGNOSIS ---");
  console.table(users);
  
  const userClients = await prisma.userClient.findMany();
  console.log("--- USER-CLIENT LINKS ---");
  console.table(userClients);
  
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, clientId: true }
  });
  console.log("--- PROJECTS ---");
  console.table(projects);
}

diagnose().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
