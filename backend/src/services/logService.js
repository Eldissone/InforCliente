const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function resetLogConnection() {
  await prisma.$disconnect();
  await prisma.$connect();
}

async function writeLog(logData) {
  return prisma.systemLog.create({ data: logData });
}

const createLog = async (logData) => {
  try {
    return await writeLog(logData);
  } catch (error) {
    if (error?.code === "P1017") {
      try {
        await resetLogConnection();
        return await writeLog(logData);
      } catch (retryError) {
        if (retryError?.code !== "P2003") {
          console.error("Registo de auditoria indisponível:", retryError.code || retryError.message);
          return;
        }
        error = retryError;
      }
    }

    if (error?.code === "P2003" && logData?.userId) {
      try {
        const { userId, ...rest } = logData;
        return await writeLog(rest);
      } catch (retryError) {
        console.error("Registo de auditoria sem utilizador falhou:", retryError.code || retryError.message);
        return;
      }
    }

    console.error("Registo de auditoria falhou:", error.code || error.message);
  }
};

const getLogs = async ({ skip = 0, take = 50, filters = {} }) => {
  const where = {};
  
  if (filters.search) {
    where.OR = [
      { userName: { contains: filters.search, mode: 'insensitive' } },
      { userEmail: { contains: filters.search, mode: 'insensitive' } },
      { action: { contains: filters.search, mode: 'insensitive' } },
      { module: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  
  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  if (filters.module) where.module = filters.module;
  if (filters.status) where.status = filters.status;
  
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
  }

  const [total, logs] = await Promise.all([
    prisma.systemLog.count({ where }),
    prisma.systemLog.findMany({
      where,
      skip: Number(skip),
      take: Number(take),
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { name: true, email: true, role: true }
        }
      }
    }),
  ]);

  return { total, logs };
};

const clearAllLogs = async () => {
  try {
    await prisma.systemLog.deleteMany({});
    return { success: true };
  } catch (error) {
    console.error("Error clearing logs:", error);
    throw error;
  }
};

module.exports = {
  createLog,
  getLogs,
  clearAllLogs,
  resetLogConnection,
};
