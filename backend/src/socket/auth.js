const jwt = require("jsonwebtoken");
const { config } = require("../config");

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
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

    const user = verifySocketToken(token);
    if (!user) {
      return next(new Error("UNAUTHORIZED"));
    }

    socket.user = user;
    return next();
  });
}

module.exports = { verifySocketToken, attachSocketAuth };
