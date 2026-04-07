const jwt = require("jsonwebtoken");
const { config } = require("../config");

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
}

function requireRole(allowed) {
  const allowedSet = new Set(Array.isArray(allowed) ? allowed : [allowed]);
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !allowedSet.has(role)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    return next();
  };
}

module.exports = { authRequired, requireRole };

