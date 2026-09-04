const { prisma } = require("../db");

const CACHE_TTL_MS = 15_000;
const cache = new Map();

async function getLiveUser(userId) {
  if (!userId) return null;
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.user;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true, name: true },
  });
  if (!user) {
    cache.delete(userId);
    return null;
  }
  cache.set(userId, { at: now, user });
  return user;
}

function applyLiveUser(payload, user) {
  if (!payload || !user) return payload;
  payload.role = user.role;
  payload.email = user.email;
  payload.name = user.name;
  return payload;
}

function invalidateLiveUserCache(userId) {
  if (userId) cache.delete(userId);
}

module.exports = {
  getLiveUser,
  applyLiveUser,
  invalidateLiveUserCache,
};
