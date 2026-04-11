const { prisma } = require('./src/db');
const id = 'cmnu49hgi0001hx9ctx0e586m'; // Use an ID from previous runs or any valid one
prisma.projectProgressTask.findMany({ where: { projectId: id } })
  .then(tasks => {
    console.log("Tasks found:", tasks.length);
    tasks.forEach(t => console.log(`Task: ${t.description}, Unit: '${t.unit}'`));
  })
  .finally(() => prisma.$disconnect());
