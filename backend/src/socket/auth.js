const jwt = require("jsonwebtoken");
const { config } = require("../config");
const { getLiveUser } = require("../services/sessionUser");

function verifySocketToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (!payload?.sub) return null;
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      name: payload.name,
    };
  } catch {
    return null;
  }
}

function attachSocketAuth(io) {
  io.use(async (socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

    const user = verifySocketToken(token);
    if (!user) {
      return next(new Error("UNAUTHORIZED"));
    }

    try {
      const live = await getLiveUser(user.id);
      if (!live) return next(new Error("UNAUTHORIZED"));
      socket.user = {
        id: live.id,
        email: live.email,
        role: live.role,
        name: live.name,
      };
      return next();
    } catch (error) {
      console.error("Socket session revalidation error:", error);
      return next(new Error("UNAUTHORIZED"));
    }
  });
}

module.exports = { verifySocketToken, attachSocketAuth };
