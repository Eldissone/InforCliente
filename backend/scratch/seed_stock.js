const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial stock data...');

  // 1. Create Central Warehouse
  const central = await prisma.warehouse.upsert({
    where: { id: 'warehouse-central' },
    update: {},
    create: {
      id: 'warehouse-central',
      name: 'Armazém Central (Sede)',
      type: 'CENTRAL',
    },
  });
  console.log('Created Warehouse:', central.name);

  // 2. Create some basic Products
  const products = [
    { sku: 'CONS-CIM-50', name: 'Saco de Cimento 50kg', category: 'CONSUMABLE', unit: 'UN' },
    { sku: 'CABO-AL-10MM', name: 'Cabo Alumínio 10mm', category: 'MATERIAL', unit: 'M' },
    { sku: 'TOOL-HILTI-TE1000', name: 'Martelo Demolidor Hilti TE 1000', category: 'TOOL', unit: 'UN' },
    { sku: 'TOOL-MAK-HR2470', name: 'Berbequim Makita HR2470', category: 'TOOL', unit: 'UN' },
  ];

  for (const p of products) {
    const prod = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: p,
    });
    console.log('Created Product:', prod.name);
  }

  // 3. Create initial Items for tools
  const tools = await prisma.product.findMany({ where: { category: 'TOOL' } });
  for (const t of tools) {
    await prisma.item.upsert({
      where: { internalTag: `${t.sku}-001` },
      update: {},
      create: {
        internalTag: `${t.sku}-001`,
        productId: t.id,
        warehouseId: central.id,
        status: 'AVAILABLE',
        condition: 'NEW',
      },
    });
  }
  console.log('Seeded tool items.');

  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
