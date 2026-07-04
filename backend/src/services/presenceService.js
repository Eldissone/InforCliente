const { prisma } = require("../db");

const AWAY_MS = 60 * 1000;
const OFFLINE_MS = 5 * 60 * 1000;

async function upsertPresence(userId, status = "ONLINE") {
  return prisma.userPresence.upsert({
    where: { userId },
    create: { userId, status, lastSeenAt: new Date() },
    update: { status, lastSeenAt: new Date() },
  });
}

async function setOffline(userId) {
  return prisma.userPresence.upsert({
    where: { userId },
    create: { userId, status: "OFFLINE", lastSeenAt: new Date() },
    update: { status: "OFFLINE", lastSeenAt: new Date() },
  });
}

async function getPresence(userId) {
  const row = await prisma.userPresence.findUnique({ where: { userId } });
  if (!row) return { userId, status: "OFFLINE", lastSeenAt: null };
  return row;
}

function resolveEffectiveStatus(lastSeenAt, storedStatus) {
  if (storedStatus === "OFFLINE") return "OFFLINE";
  const elapsed = Date.now() - new Date(lastSeenAt).getTime();
  if (elapsed > OFFLINE_MS) return "OFFLINE";
  if (elapsed > AWAY_MS) return "AWAY";
  return storedStatus === "AWAY" ? "AWAY" : "ONLINE";
}

async function listUsersPresence(userIds) {
  if (!userIds.length) return [];
  const rows = await prisma.userPresence.findMany({
    where: { userId: { in: userIds } },
  });
  const map = new Map(rows.map((r) => [r.userId, r]));
  return userIds.map((userId) => {
    const row = map.get(userId);
    if (!row) return { userId, status: "OFFLINE", lastSeenAt: null };
    return {
      userId,
      status: resolveEffectiveStatus(row.lastSeenAt, row.status),
      lastSeenAt: row.lastSeenAt,
    };
  });
}

module.exports = {
  upsertPresence,
  setOffline,
  getPresence,
  resolveEffectiveStatus,
  listUsersPresence,
  AWAY_MS,
  OFFLINE_MS,
};
