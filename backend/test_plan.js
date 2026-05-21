const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const planId = "cmpf50xiq0001hx10gbsrw10w";
  const plan = await prisma.dailyPlan.findUnique({
    where: { id: planId },
    include: { tasks: true, materials: true }
  });
  console.log("Plan:", JSON.stringify(plan, null, 2));

  for (const t of plan.tasks) {
    const pt = await prisma.projectProgressTask.findUnique({ where: { id: t.progressTaskId }});
    console.log(`Task ${t.id} -> ProgressTask ${t.progressTaskId}:`, pt ? "FOUND" : "NOT FOUND");
  }

  const estaleiro = await prisma.warehouse.findFirst({
    where: { projectId: plan.projectId }
  });
  console.log("Estaleiro:", estaleiro ? "FOUND" : "NOT FOUND");
}

main().catch(console.error).finally(() => prisma.$disconnect());
