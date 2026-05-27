/**
 * Validação rápida: múltiplos armazéns por obra + visibilidade cliente
 */
const { prisma } = require("../db");
const {
  buildWarehouseListWhere,
  isClienteRole,
} = require("../utils/warehouseAccess");

async function main() {
  const client = await prisma.client.findFirst({ select: { id: true, name: true } });
  if (!client) {
    console.log("SKIP: sem clientes na BD");
    return;
  }

  const project = await prisma.project.create({
    data: {
      code: `TEST-${Date.now()}`,
      name: "Obra Teste Multi Armazém",
      budgetTotal: "1000",
      budgetAllocated: "1000",
      budgetConsumed: "0",
      budgetCommitted: "0",
      budgetAvailable: "1000",
      clientId: client.id,
    },
    select: { id: true, name: true },
  });

  await prisma.warehouse.create({
    data: {
      name: `Estaleiro: ${project.name}`,
      type: "SITE",
      projectId: project.id,
      visibleToClient: true,
    },
  });

  await prisma.warehouse.create({
    data: {
      name: "Consumo Cozinha",
      type: "SITE",
      projectId: project.id,
      visibleToClient: false,
    },
  });

  const allForProject = await prisma.warehouse.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
  });
  console.assert(allForProject.length === 2, "Esperados 2 armazéns por obra");

  const clienteReq = {
    user: { role: "cliente", sub: "user-test", clientId: client.id },
  };
  const whereCliente = buildWarehouseListWhere(clienteReq, { projectId: project.id });
  const visibleToClient = await prisma.warehouse.findMany({ where: whereCliente });
  console.assert(visibleToClient.length === 1, "Cliente deve ver só 1 armazém visível");
  console.assert(visibleToClient[0].name.startsWith("Estaleiro"), "Armazém visível deve ser o estaleiro");

  const staffReq = { user: { role: "operador", sub: "op-test" } };
  console.assert(!isClienteRole(staffReq), "Operador não é cliente");
  const whereStaff = buildWarehouseListWhere(staffReq, { projectId: project.id });
  const allStaff = await prisma.warehouse.findMany({ where: whereStaff });
  console.assert(allStaff.length === 2, "Gestão deve ver os 2 armazéns");

  await prisma.warehouse.deleteMany({ where: { projectId: project.id } });
  await prisma.project.delete({ where: { id: project.id } });

  console.log("OK: validação multi-armazém concluída");
}

main()
  .catch((err) => {
    console.error("FAIL:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
