const { prisma } = require('./src/db');
const { getTemplateForProjectType } = require('./src/utils/projectTemplates');

async function migrate() {
  const projects = await prisma.project.findMany({
    where: { projectType: { not: null } },
    include: { progressTasks: true }
  });

  let count = 0;
  for (const p of projects) {
    if (p.progressTasks.length === 0 && p.projectType) {
      const templates = getTemplateForProjectType(p.projectType);
      if (templates.length > 0) {
        await prisma.projectProgressTask.createMany({
          data: templates.map(t => ({
            projectId: p.id,
            itemGroup: p.projectType,
            order: t.order,
            description: t.description,
            expectedQty: t.expectedQty,
            executedQty: 0,
            unit: t.unit
          }))
        });
        count++;
      }
    }
  }
  console.log(`Migrated ${count} projects`);
}

migrate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
