const { prisma } = require("../db");

const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function normalizePriority(priority) {
  const p = String(priority || "").toUpperCase();
  return PRIORITIES.has(p) ? p : "NORMAL";
}

/**
 * Cria uma notificação in-app.
 *
 * Com `groupKey`, se o utilizador já tiver uma notificação não lida com a
 * mesma chave criada há menos de 5 min, essa é atualizada (groupCount + 1,
 * título/corpo novos, createdAt = agora) em vez de criar outra — evita
 * encher o centro de notificações com 10 avisos da mesma conversa.
 * `groupTitle` pode conter `{count}` para o título agrupado.
 */
async function createNotification({
  userId,
  type,
  title,
  body,
  link,
  metadata,
  priority,
  projectId,
  groupKey,
  groupTitle,
}) {
  const resolvedProjectId = projectId || metadata?.projectId || null;
  const base = {
    type,
    body: body || null,
    link: link || null,
    metadata: metadata || undefined,
    priority: normalizePriority(priority),
    projectId: resolvedProjectId,
  };

  if (groupKey) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        groupKey,
        read: false,
        createdAt: { gte: new Date(Date.now() - GROUP_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const groupCount = existing.groupCount + 1;
      return prisma.notification.update({
        where: { id: existing.id },
        data: {
          ...base,
          title: groupTitle ? groupTitle.replace("{count}", String(groupCount)) : title,
          groupCount,
          createdAt: new Date(),
        },
      });
    }
  }

  return prisma.notification.create({
    data: { ...base, userId, title, groupKey: groupKey || null },
  });
}

async function listNotifications(userId, { unreadOnly = false, limit = 30, types, projectId } = {}) {
  const typeList = Array.isArray(types) ? types.filter(Boolean) : [];
  return prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { read: false } : {}),
      ...(typeList.length ? { type: { in: typeList } } : {}),
      ...(projectId ? { projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(limit) || 30, 100),
    include: { project: { select: { id: true, code: true, name: true } } },
  });
}

async function countUnread(userId) {
  return prisma.notification.count({ where: { userId, read: false } });
}

async function markRead(notificationId, userId) {
  const row = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!row) {
    const err = new Error("NOTIFICATION_NOT_FOUND");
    err.status = 404;
    throw err;
  }
  return prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
  });
}

async function markAllRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
  return { marked: result.count };
}

// ── Preferências de alertas ────────────────────────────────────────────────

const PREFERENCE_DEFAULTS = {
  soundEnabled: true,
  volume: 0.6,
  desktopEnabled: false,
  dndEnabled: false,
  dndFrom: "22:00",
  dndTo: "07:00",
  mutedTypes: [],
  mutedProjectIds: [],
};

function serializePreferences(row) {
  if (!row) return { ...PREFERENCE_DEFAULTS };
  return {
    soundEnabled: row.soundEnabled,
    volume: row.volume,
    desktopEnabled: row.desktopEnabled,
    dndEnabled: row.dndEnabled,
    dndFrom: row.dndFrom,
    dndTo: row.dndTo,
    mutedTypes: Array.isArray(row.mutedTypes) ? row.mutedTypes : [],
    mutedProjectIds: Array.isArray(row.mutedProjectIds) ? row.mutedProjectIds : [],
  };
}

async function getPreferences(userId) {
  const row = await prisma.userNotificationPreference.findUnique({ where: { userId } });
  return serializePreferences(row);
}

/** `data` já validado pela rota (zod). Só os campos presentes são alterados. */
async function updatePreferences(userId, data) {
  const row = await prisma.userNotificationPreference.upsert({
    where: { userId },
    create: { userId, ...PREFERENCE_DEFAULTS, ...data },
    update: data,
  });
  return serializePreferences(row);
}

module.exports = {
  createNotification,
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
  getPreferences,
  updatePreferences,
  PREFERENCE_DEFAULTS,
};
