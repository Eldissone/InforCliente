const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const balances = await prisma.warehouseStock.findMany({ include: { product: true, warehouse: true }});
  const allItems = await prisma.item.findMany({ include: { product: true, warehouse: true }});
  
  const groups = {};
  const getGroupKey = (item) => `${item.productId || item.product?.id}-${item.warehouseId || item.warehouse?.id}-${item.ownerId || 'proprio'}`;
  
  balances.forEach(b => {
    const key = getGroupKey(b);
    if (!groups[key]) groups[key] = { name: b.product.name, q: 0, hasStock: true, hasAsset: false };
    groups[key].q += Number(b.quantity);
    groups[key].hasStock = true;
  });
  
  allItems.forEach(item => {
    if (!item.warehouseId) return;
    const key = getGroupKey(item);
    const isTool = item.product?.category === 'TOOL' || item.product?.category === 'EQUIPMENT';
    if (!groups[key]) groups[key] = { name: item.product.name, q: 0, hasStock: false, hasAsset: true };
    if (isTool) {
      if (!groups[key].hasAsset) {
        groups[key].q = 1;
        groups[key].hasAsset = true;
      } else {
        groups[key].q += 1;
      }
    } else {
      if (!groups[key].hasStock) {
        groups[key].q += 1;
      }
      groups[key].hasAsset = true;
    }
  });
  
  console.log(groups);
}
test();
