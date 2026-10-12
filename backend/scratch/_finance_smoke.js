const jwt = require("jsonwebtoken");
const { prisma } = require("../src/db");
const { config } = require("../src/config");

(async () => {
  const tables = await prisma.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('Invoice','InvoiceReceipt','BankStatement','BankMovement') ORDER BY tablename"
  );
  console.log("TABLES=" + tables.map((t) => t.tablename).join(","));

  const user =
    (await prisma.user.findFirst({ where: { role: "financeiro" } })) ||
    (await prisma.user.findFirst({ where: { role: "admin" } }));
  if (!user) {
    console.log("NO_USER");
    process.exit(1);
  }
  const token = jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.name },
    config.jwtSecret,
    { expiresIn: "2h" }
  );
  console.log("TOKEN=" + token);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
