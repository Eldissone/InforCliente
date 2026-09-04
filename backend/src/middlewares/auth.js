const jwt = require("jsonwebtoken");
const { config } = require("../config");
const { checkUserPermission } = require("../services/permissionResolver");

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
  const allowedSet = new Set(allowedArray.map((r) => r.toUpperCase()));

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
    const userId = req.user?.sub;
    const userRole = (req.user?.role || "").toLowerCase();
    if (!userId || !userRole) return res.status(401).json({ error: "UNAUTHORIZED" });

    try {
      const { allowed } = await checkUserPermission(userId, userRole, moduleName, action, req.method);

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

/**
 * Fonte de verdade preferencial: sistema centralizado de permissões
 * (checkUserPermission). Como fallback de migração gradual, aceita também
 * roles antigos (igual de segurança ao existente). Ideal para substituir
 * requireRole([...]) sem quebrar ambientes com permissões não sincronizadas.
 */
function requirePermissionOrLegacyRole(moduleName, action, legacyRoles = []) {
  const legacyAllowed = Array.isArray(legacyRoles) ? legacyRoles : [legacyRoles];
  const allowedSet = new Set(legacyAllowed.map((r) => r.toUpperCase()));

  return async (req, res, next) => {
    const userId = req.user?.sub;
    const userRoleRaw = req.user?.role || "";
    const userRole = String(userRoleRaw).toLowerCase();

    if (!userId || !userRole) return res.status(401).json({ error: "UNAUTHORIZED" });

    try {
      const { allowed } = await checkUserPermission(userId, userRole, moduleName, action, req.method);

      let passed = false;
      if (allowed === "true") {
        passed = true;
      } else if (allowed === "own") {
        req.permissionScope = "own";
        passed = true;
      } else if (allowed === "view" && req.method === "GET") {
        req.permissionScope = "view";
        passed = true;
      }

      if (passed) return next();

      // Fallback legado por role (exatamente igual à antiga verificação)
      if (allowedSet.size > 0 && allowedSet.has(userRoleRaw.toUpperCase())) {
        req._permissionPassedByRole = true;
        return next();
      }

      return res.status(403).json({ error: "FORBIDDEN" });
    } catch (error) {
      console.error("Permission check error:", error);
      return res.status(500).json({ error: "PERMISSION_CHECK_FAILED" });
    }
  };
}

/**
 * Leitura de armazém/stock no portal do cliente.
 * Staff continua a precisar de stock.view. Cliente não é perfil de armazém:
 * entra com obras.read (ou papel cliente) e o isolamento fica nas queries
 * (visibleToClient + obras do JWT).
 */
function requireStockViewOrClientePortal() {
  return (req, res, next) => {
    const role = (req.user?.role || "").toLowerCase();
    if (role === "cliente") {
      return requirePermissionOrLegacyRole("obras", "read", ["cliente"])(req, res, next);
    }
    return requirePermission("stock", "view")(req, res, next);
  };
}

module.exports = {
  authRequired,
  requireRole,
  requirePermission,
  requirePermissionOrLegacyRole,
  requireStockViewOrClientePortal,
};
