/**
 * Adiciona à base de dados, para a secção Logística (Compras e Logística),
 * um novo Pedido de Compra (ExtraRequest tipo OBRA) e uma nova Entrada de
 * stock (movimento ENTRY + actualização do saldo do armazém).
 *
 * Replica o comportamento dos endpoints:
 *   POST /extra-requests          (botão "Pedido de Compra")
 *   POST /stock/move { type: "ENTRY" } (botão "Nova Entrada")
 *
 * Uso: node scratch/add_logistica_pedido_entrada.js
 */
const { PrismaClient } = require('@prisma/client');
const { ensureQuotationNeedsFromPedido } = require('../src/services/quotationNeedService');

const prisma = new PrismaClient();

// Marcadores para tornar o script idempotente em re-execuções.
const PEDIDO_COMPRA_DESCRIPTION = '[DEMO] Pedido de Compra - Material para estaleiro';
const PEDIDO_OBRA_DESCRIPTION = '[DEMO] Pedido de Obra - Aplicação de cabo MT';
const ENTRY_REFERENCE = 'LOGISTICA-DEMO-ENTRY-001';
const ENTRY_QUANTITY = 40;

async function resolveContext() {
  const project = await prisma.project.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!project) throw new Error('Não existe nenhuma obra na base de dados.');

  const warehouse =
    (await prisma.warehouse.findFirst({ where: { projectId: project.id, type: 'SITE' } })) ||
    (await prisma.warehouse.findFirst({ where: { projectId: project.id } })) ||
    (await prisma.warehouse.findFirst({ where: { type: 'CENTRAL' } }));
  if (!warehouse) throw new Error('Não existe nenhum armazém na base de dados.');

  const costCenter =
    (await prisma.costCenter.findFirst({ where: { projectId: project.id, name: 'MATERIAL' } })) ||
    (await prisma.costCenter.findFirst({ where: { projectId: project.id } }));
  if (!costCenter) throw new Error('A obra não tem centros de custo.');

  const user =
    (await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } })) ||
    (await prisma.user.findFirst());
  if (!user) throw new Error('Não existe nenhum utilizador na base de dados.');

  const progressTask = await prisma.projectProgressTask.findFirst({
    where: { projectId: project.id },
    orderBy: { order: 'asc' },
  });

  return { project, warehouse, costCenter, user, progressTask };
}

async function ensureProduct() {
  return prisma.product.upsert({
    where: { sku: 'CIM-50-DEMO' },
    update: {},
    create: {
      sku: 'CIM-50-DEMO',
      name: 'Saco de Cimento 50kg (Demo)',
      category: 'MATERIAL',
      unit: 'UN',
      minStock: 10,
    },
  });
}

async function createPedido({ project, costCenter, user }) {
  const existing = await prisma.extraRequest.findFirst({
    where: { projectId: project.id, description: PEDIDO_COMPRA_DESCRIPTION },
  });
  if (existing) {
    console.log(`[pedido-compra] já existe (${existing.id}) — nada a fazer.`);
    return existing;
  }

  const items = [
    { description: 'Saco de Cimento 50kg', quantity: 40, unit: 'UN', unitPrice: 3500, totalPrice: 140000, order: 0 },
    { description: 'Areia fina', quantity: 5, unit: 'MT3', unitPrice: 12000, totalPrice: 60000, order: 1 },
  ];
  const amount = items.reduce((sum, item) => sum + item.totalPrice, 0);

  const pedido = await prisma.extraRequest.create({
    data: {
      type: 'OBRA',
      projectId: project.id,
      costCenterId: costCenter.id,
      description: PEDIDO_COMPRA_DESCRIPTION,
      amount,
      currency: 'AOA',
      paymentSource: 'SOLICITACAO_TRANSFERENCIA',
      status: 'PENDENTE',
      priority: 'NORMAL',
      requiresQuote: true,
      requestedBy: user.name || user.email,
      notes: 'Registo de exemplo criado para a secção Logística.',
      items: { create: items },
    },
    include: { items: true },
  });

  // Mantém a coerência com o endpoint: cria as necessidades de cotação.
  await ensureQuotationNeedsFromPedido(prisma, {
    projectId: pedido.projectId,
    costCenterId: pedido.costCenterId,
    description: pedido.description,
    items: pedido.items,
    extraRequestId: pedido.id,
    priority: pedido.priority,
    responsible: pedido.requestedBy,
    notes: pedido.notes,
  });

  console.log(`[pedido-compra] criado: ${pedido.id} — "${pedido.description}" (${amount} AOA)`);
  return pedido;
}

/**
 * "Pedidos de Obra" na página Logística = DailyPlan com estado PENDING_MATERIAL
 * (GET /daily-plans/all-pending). É isto que aparece na aba "Pedidos de Obra".
 */
async function createPedidoObra({ project, progressTask, product }) {
  const existing = await prisma.dailyPlan.findFirst({
    where: { projectId: project.id, description: PEDIDO_OBRA_DESCRIPTION },
  });
  if (existing) {
    console.log(`[pedido-obra] já existe (${existing.id}) — nada a fazer.`);
    return existing;
  }

  const plan = await prisma.dailyPlan.create({
    data: {
      projectId: project.id,
      date: new Date(),
      description: PEDIDO_OBRA_DESCRIPTION,
      status: 'PENDING_MATERIAL',
      tasks: progressTask
        ? {
            create: [
              {
                progressTaskId: progressTask.id,
                plannedQty: 1,
                notes: 'Tarefa de exemplo para o pedido de obra.',
              },
            ],
          }
        : undefined,
      materials: {
        create: [
          { productId: product.id, requestedQty: 20 },
        ],
      },
    },
    include: { tasks: true, materials: true },
  });

  console.log(
    `[pedido-obra] criado: ${plan.id} — "${plan.description}" (PENDING_MATERIAL, ${plan.tasks.length} tarefa(s), ${plan.materials.length} material(is))`
  );
  return plan;
}

async function createEntrada({ project, warehouse, user, product }) {
  const existing = await prisma.stockMovement.findFirst({ where: { reference: ENTRY_REFERENCE } });
  if (existing) {
    console.log(`[entrada] já existe (${existing.id}) — nada a fazer.`);
    return existing;
  }

  const movement = await prisma.$transaction(async (tx) => {
    const created = await tx.stockMovement.create({
      data: {
        productId: product.id,
        warehouseId: warehouse.id,
        projectId: warehouse.projectId || project.id,
        userId: user.id,
        type: 'ENTRY',
        quantity: ENTRY_QUANTITY,
        reference: ENTRY_REFERENCE,
        notes: 'Entrada de exemplo criada para a secção Logística.',
      },
    });

    const existingStock = await tx.warehouseStock.findFirst({
      where: { warehouseId: warehouse.id, productId: product.id, ownerId: null },
    });
    if (existingStock) {
      await tx.warehouseStock.update({
        where: { id: existingStock.id },
        data: { quantity: { increment: ENTRY_QUANTITY } },
      });
    } else {
      await tx.warehouseStock.create({
        data: {
          warehouseId: warehouse.id,
          productId: product.id,
          ownerId: null,
          quantity: ENTRY_QUANTITY,
        },
      });
    }

    return created;
  });

  console.log(
    `[entrada] criada: ${movement.id} — ${ENTRY_QUANTITY} x ${product.name} @ ${warehouse.name}`
  );
  return movement;
}

async function main() {
  const ctx = await resolveContext();
  console.log(
    `Contexto: obra="${ctx.project.name}" · armazém="${ctx.warehouse.name}" · centroCusto="${ctx.costCenter.name}" · utilizador="${ctx.user.email}"`
  );

  const product = await ensureProduct();

  await createPedido(ctx);
  await createPedidoObra({ ...ctx, product });
  await createEntrada({ ...ctx, product });

  const [pedidos, pedidosObra, entradas] = await Promise.all([
    prisma.extraRequest.count(),
    prisma.dailyPlan.count({ where: { status: 'PENDING_MATERIAL' } }),
    prisma.stockMovement.count({ where: { type: 'ENTRY' } }),
  ]);
  console.log(
    `Resumo → Pedidos de Compra (ExtraRequest): ${pedidos} · Pedidos de Obra (DailyPlan PENDING_MATERIAL): ${pedidosObra} · Entradas de stock (ENTRY): ${entradas}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
