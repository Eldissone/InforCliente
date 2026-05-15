const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const id = 'cmp6hopdn0001hxksmuekahxm';
  const warehouse = await prisma.warehouse.findUnique({ where: { id } });
  if (!warehouse) {
    console.log('Warehouse not found');
    return;
  }
  console.log(`Checking Warehouse: ${warehouse.name} (${id})`);

  const stockCount = await prisma.warehouseStock.count({
    where: { warehouseId: id, quantity: { gt: 0 } }
  });
  console.log(`Stock records (qty > 0): ${stockCount}`);

  const itemCount = await prisma.item.count({
    where: { 
      OR: [
        { warehouseId: id },
        { targetWarehouseId: id }
      ]
    }
  });
  console.log(`Individual items (Assets): ${itemCount}`);

  if (itemCount > 0) {
    const items = await prisma.item.findMany({
      where: { 
        OR: [
          { warehouseId: id },
          { targetWarehouseId: id }
        ]
      },
      include: { product: true }
    });
    console.log('Items found:');
    items.forEach(i => console.log(`- ${i.product.name} (Status: ${i.status})`));
  }
}

check().then(() => prisma.$disconnect());
