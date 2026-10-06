const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 10_000,
    timeout: 20_000,
  },
});

module.exports = { prisma };

