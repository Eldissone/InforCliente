const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const id = 'cmp6hopdn0001hxksmuekahxm';
  try {
    console.log(`Attempting to delete warehouse ${id}...`);
    await prisma.$transaction([
      prisma.warehouseStock.deleteMany({ where: { warehouseId: id } }),
      prisma.stockMovement.deleteMany({ where: { warehouseId: id } }),
      prisma.stockMovement.deleteMany({ where: { targetWarehouseId: id } }),
      prisma.item.updateMany({ where: { targetWarehouseId: id }, data: { targetWarehouseId: null } }),
      prisma.warehouse.delete({ where: { id } })
    ]);
    console.log('Successfully deleted');
  } catch(e) {
    console.error('Delete failed:', e);
  }
}

check().then(() => prisma.$disconnect());
