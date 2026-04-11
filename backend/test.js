const { prisma } = require('./src/db');
prisma.project.findMany({ orderBy: { createdAt: 'desc' }, take: 3, include: { progressTasks: true } })
  .then(res => console.log(JSON.stringify(res, null, 2)))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
