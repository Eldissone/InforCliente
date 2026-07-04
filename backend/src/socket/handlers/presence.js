const { upsertPresence, setOffline } = require("../../services/presenceService");

function registerPresenceHandlers(io, socket) {
  const userId = socket.user.id;
  let heartbeatTimer = null;

  async function broadcastPresence(status) {
    const presence = await upsertPresence(userId, status);
    io.emit("presence:changed", {
      userId,
      status: presence.status,
      lastSeenAt: presence.lastSeenAt,
    });
  }

  socket.on("presence:heartbeat", async (_payload, ack) => {
    try {
      const presence = await upsertPresence(userId, "ONLINE");
      if (typeof ack === "function") {
        ack({ ok: true, status: presence.status, lastSeenAt: presence.lastSeenAt });
      }
    } catch (err) {
      if (typeof ack === "function") ack({ ok: false, error: err.message });
    }
  });

  broadcastPresence("ONLINE").catch(() => {});

  heartbeatTimer = setInterval(() => {
    upsertPresence(userId, "ONLINE").catch(() => {});
  }, 45_000);

  socket.on("disconnect", async () => {
    clearInterval(heartbeatTimer);
    await setOffline(userId).catch(() => {});
    io.emit("presence:changed", {
      userId,
      status: "OFFLINE",
      lastSeenAt: new Date(),
    });
  });
}

module.exports = { registerPresenceHandlers };
