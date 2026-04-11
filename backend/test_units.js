const { prisma } = require('./src/db');
prisma.projectProgressTask.findMany({ select: { id: true, description: true, unit: true } })
  .then(tasks => console.log(JSON.stringify(tasks, null, 2)))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
