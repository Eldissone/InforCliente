const { prisma } = require("../db");

async function debug() {
  const balances = await prisma.warehouseStock.findMany({
    include: { product: true, warehouse: true }
  });
  
  const items = await prisma.item.findMany({
    include: { product: true, warehouse: true }
  });

  console.log("=== BALANCES ===");
  balances.forEach(b => {
    console.log(`${b.product.name} [${b.product.category}] | ${b.warehouse.name} | Qty: ${b.quantity} | ID: ${b.warehouseId}`);
  });

  console.log("\n=== ITEMS ===");
  items.forEach(i => {
    console.log(`${i.product.name} [${i.product.category}] | ${i.warehouse?.name || 'N/A'} | ID: ${i.warehouseId}`);
  });
}

debug();
