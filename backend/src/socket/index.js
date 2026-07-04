const { Server } = require("socket.io");
const { attachSocketAuth } = require("./auth");
const { registerChatHandlers } = require("./handlers/chat");
const { registerPresenceHandlers } = require("./handlers/presence");

function createSocketServer(httpServer, { corsOrigins = [] } = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins.length ? corsOrigins : true,
      credentials: true,
    },
    path: "/socket.io",
  });

  attachSocketAuth(io);

  io.on("connection", (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);

    registerPresenceHandlers(io, socket);
    registerChatHandlers(io, socket);
  });

  return io;
}

module.exports = { createSocketServer };
