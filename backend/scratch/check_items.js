const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const products = await prisma.product.findMany({
    include: { _count: { select: { items: true } } }
  });
  console.log("Produtos e contagem de itens individuais:");
  products.forEach(p => {
    console.log(`- ${p.name} (ID: ${p.id}) [${p.category}]: ${p._count.items} itens`);
  });
  
  const movements = await prisma.stockMovement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { product: true }
  });
  console.log("\nÚltimos 10 movimentos de stock:");
  movements.forEach(m => {
    console.log(`- Data: ${m.createdAt.toISOString()} | Produto: ${m.product.name} | Tipo: ${m.type} | Qtd: ${m.quantity}`);
  });
}

check().catch(console.error).finally(() => prisma.$disconnect());
