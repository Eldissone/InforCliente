const { createLog } = require("../services/logService");

const auditMiddleware = (moduleName) => {
  return async (req, res, next) => {
    // Registar modificações, logins/logouts explícitos e acessos a dados (GET)
    const isModifying = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    const isLogin = req.path.includes("login") || req.path.includes("logout");
    const isGet = req.method === "GET";
    
    // Ignorar endpoints internos ou de alta frequência para evitar spam
    const excludedGets = ["/health", "/logs", "/uploads", "/permissions/me"];
    const isExcludedGet = isGet && excludedGets.some(route => req.path.startsWith(route));
    
    if (!isModifying && !isLogin && (!isGet || isExcludedGet)) {
      return next();
    }

    const originalSend = res.send;
    
    res.send = function (body) {
      res.send = originalSend;
      
      // Operação assíncrona para não bloquear a resposta original
      setImmediate(() => {
        try {
          const status = res.statusCode >= 200 && res.statusCode < 400 ? "SUCCESS" : "ERROR";
          let action = req.method;
          
          if (isLogin) {
            action = req.path.includes("logout") ? "LOGOUT" : "LOGIN";
          } else {
            switch (req.method) {
              case "POST": action = "CREATE"; break;
              case "PUT":
              case "PATCH": action = "UPDATE"; break;
              case "DELETE": action = "DELETE"; break;
              case "GET": action = "ACCESS"; break;
            }
          }

          let safeBody = undefined;
          if (action !== "LOGIN" && req.body) {
              // Create a copy of the body and remove sensitive fields
              safeBody = { ...req.body };
              if (safeBody.password) delete safeBody.password;
              if (safeBody.newPassword) delete safeBody.newPassword;
          }

          const extractedModule = req.baseUrl ? req.baseUrl.split('/')[1]?.toUpperCase() : null;
          
          const logData = {
            userId: req.user?.sub || req.user?.id || null,
            userName: req.user?.name || null,
            userEmail: req.user?.email || req.body?.email || null,
            action,
            module: moduleName || extractedModule || "GENERAL",
            status,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
            userAgent: req.headers['user-agent'],
            details: {
              path: req.originalUrl,
              method: req.method,
              statusCode: res.statusCode,
              body: safeBody 
            }
          };

          createLog(logData);
        } catch (e) {
          console.error("Audit Middleware Error:", e);
        }
      });
      
      return res.send(body);
    };

    next();
  };
};

module.exports = { auditMiddleware };
