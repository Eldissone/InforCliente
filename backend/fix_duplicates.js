const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("A procurar produtos duplicados nos armazéns...");

  // Get all warehouse stocks
  const stocks = await prisma.warehouseStock.findMany({
    include: {
      product: true,
      warehouse: true
    }
  });

  // Group by warehouseId + productId
  const grouped = {};
  for (const s of stocks) {
    const key = `${s.warehouseId}_${s.productId}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(s);
  }

  let mergedCount = 0;

  for (const key in grouped) {
    const items = grouped[key];
    if (items.length > 1) {
      console.log(`\nEncontrados ${items.length} registos para o produto '${items[0].product.name}' no armazém '${items[0].warehouse.name}'`);
      
      // Calculate total quantity
      let totalQty = 0;
      for (const item of items) {
        totalQty += Number(item.quantity || 0);
      }

      // We will keep the first item and delete the rest
      const [primaryToKeep, ...toDelete] = items;
      
      console.log(`-> Consolidando quantidade total para: ${totalQty}`);

      await prisma.$transaction(async (tx) => {
        // Update the primary item with the total sum
        await tx.warehouseStock.update({
          where: { id: primaryToKeep.id },
          data: { quantity: totalQty, ownerId: null } // Ensure ownerId is null for future consistency
        });

        // Delete the duplicates
        for (const item of toDelete) {
          await tx.warehouseStock.delete({
            where: { id: item.id }
          });
        }
      });

      mergedCount++;
      console.log(`-> Resolvido com sucesso!`);
    }
  }

  if (mergedCount === 0) {
    console.log("\nNão foram encontrados produtos duplicados nos armazéns.");
  } else {
    console.log(`\nConcluído! ${mergedCount} produtos com duplicações foram consolidados.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
