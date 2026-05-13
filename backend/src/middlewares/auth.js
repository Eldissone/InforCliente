const jwt = require("jsonwebtoken");
const { config } = require("../config");
const { prisma } = require("../db");

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
  const allowedArray = Array.isArray(allowed) ? allowed : [allowed];
  const allowedSet = new Set(allowedArray.map(r => r.toUpperCase()));
  
  return (req, res, next) => {
    const role = (req.user?.role || "").toUpperCase();
    if (!role || !allowedSet.has(role)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    return next();
  };
}

function requirePermission(moduleName, action) {
  return async (req, res, next) => {
    const userRole = (req.user?.role || "").toLowerCase();
    if (!userRole) return res.status(401).json({ error: "UNAUTHORIZED" });

    // Superadmin bypass (normalized to check both cases if needed, but here lowercase is safer for DB)
    if (userRole === "admin") return next();

    try {
      const perm = await prisma.rolePermission.findFirst({
        where: { role: userRole, module: moduleName, action },
      });

      const allowed = perm ? perm.allowed : "false";

      if (allowed === "true") {
        return next();
      }

      if (allowed === "own") {
        req.permissionScope = "own";
        return next();
      }

      if (allowed === "view" && req.method === "GET") {
        req.permissionScope = "view";
        return next();
      }

      return res.status(403).json({ error: "FORBIDDEN_BY_PERMISSION" });
    } catch (error) {
      console.error("Permission check error:", error);
      return res.status(500).json({ error: "PERMISSION_CHECK_FAILED" });
    }
  };
}

module.exports = { authRequired, requireRole, requirePermission };
