const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const createLog = async (logData) => {
  try {
    return await prisma.systemLog.create({
      data: logData,
    });
  } catch (error) {
    console.error("Error creating system log:", error);
    // Non-blocking error
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
  clearAllLogs
};
