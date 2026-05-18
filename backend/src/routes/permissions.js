const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

const permissionsRoutes = express.Router();
permissionsRoutes.use(authRequired);
permissionsRoutes.use(requireRole(["admin"]));

// ─── Default permission matrix ────────────────────────────────────────────────
// "true" = full access | "false" = no access | "own" = own records only
const DEFAULT_PERMISSIONS = [
  // Dashboard & Analytics
  { role: "admin",    module: "dashboard",    action: "view",   allowed: "true"  },
  { role: "operador", module: "dashboard",    action: "view",   allowed: "true"  },
  { role: "leitura",  module: "dashboard",    action: "view",   allowed: "true"  },
  { role: "cliente",  module: "dashboard",    action: "view",   allowed: "false" },

  { role: "admin",    module: "analytics",    action: "view",   allowed: "true"  },
  { role: "operador", module: "analytics",    action: "view",   allowed: "true"  },
  { role: "leitura",  module: "analytics",    action: "view",   allowed: "true"  },
  { role: "cliente",  module: "analytics",    action: "view",   allowed: "false" },

  // Clientes
  { role: "admin",    module: "clientes",     action: "view",   allowed: "true"  },
  { role: "operador", module: "clientes",     action: "view",   allowed: "true"  },
  { role: "leitura",  module: "clientes",     action: "view",   allowed: "true"  },
  { role: "cliente",  module: "clientes",     action: "view",   allowed: "own"   },

  { role: "admin",    module: "clientes",     action: "create", allowed: "true"  },
  { role: "operador", module: "clientes",     action: "create", allowed: "true"  },
  { role: "leitura",  module: "clientes",     action: "create", allowed: "false" },
  { role: "cliente",  module: "clientes",     action: "create", allowed: "false" },

  { role: "admin",    module: "clientes",     action: "edit",   allowed: "true"  },
  { role: "operador", module: "clientes",     action: "edit",   allowed: "true"  },
  { role: "leitura",  module: "clientes",     action: "edit",   allowed: "false" },
  { role: "cliente",  module: "clientes",     action: "edit",   allowed: "false" },

  { role: "admin",    module: "clientes",     action: "delete", allowed: "true"  },
  { role: "operador", module: "clientes",     action: "delete", allowed: "false" },
  { role: "leitura",  module: "clientes",     action: "delete", allowed: "false" },
  { role: "cliente",  module: "clientes",     action: "delete", allowed: "false" },

  // Obras
  { role: "admin",    module: "obras",        action: "view",   allowed: "true"  },
  { role: "operador", module: "obras",        action: "view",   allowed: "true"  },
  { role: "tecnico",  module: "obras",        action: "view",   allowed: "true"  },
  { role: "supervisor",module: "obras",        action: "view",   allowed: "true"  },
  { role: "leitura",  module: "obras",        action: "view",   allowed: "true"  },
  { role: "cliente",  module: "obras",        action: "view",   allowed: "own"   },

  { role: "admin",    module: "obras",        action: "read",   allowed: "true"  },
  { role: "operador", module: "obras",        action: "read",   allowed: "true"  },
  { role: "tecnico",  module: "obras",        action: "read",   allowed: "true"  },
  { role: "supervisor",module: "obras",        action: "read",   allowed: "true"  },
  { role: "leitura",  module: "obras",        action: "read",   allowed: "true"  },
  { role: "cliente",  module: "obras",        action: "read",   allowed: "own"   },

  { role: "admin",    module: "obras",        action: "create", allowed: "true"  },
  { role: "operador", module: "obras",        action: "create", allowed: "true"  },
  { role: "tecnico",  module: "obras",        action: "create", allowed: "false" },
  { role: "supervisor",module: "obras",        action: "create", allowed: "true"  },
  { role: "leitura",  module: "obras",        action: "create", allowed: "false" },
  { role: "cliente",  module: "obras",        action: "create", allowed: "false" },

  { role: "admin",    module: "obras",        action: "edit",   allowed: "true"  },
  { role: "operador", module: "obras",        action: "edit",   allowed: "true"  },
  { role: "tecnico",  module: "obras",        action: "edit",   allowed: "true"  },
  { role: "supervisor",module: "obras",        action: "edit",   allowed: "true"  },
  { role: "leitura",  module: "obras",        action: "edit",   allowed: "false" },
  { role: "cliente",  module: "obras",        action: "edit",   allowed: "false" },

  { role: "admin",    module: "obras",        action: "delete", allowed: "true"  },
  { role: "operador", module: "obras",        action: "delete", allowed: "false" },
  { role: "tecnico",  module: "obras",        action: "delete", allowed: "false" },
  { role: "supervisor",module: "obras",        action: "delete", allowed: "false" },
  { role: "leitura",  module: "obras",        action: "delete", allowed: "false" },
  { role: "cliente",  module: "obras",        action: "delete", allowed: "false" },

  { role: "admin",    module: "obras",        action: "manage", allowed: "true"  },
  { role: "operador", module: "obras",        action: "manage", allowed: "true"  },
  { role: "tecnico",  module: "obras",        action: "manage", allowed: "true"  },
  { role: "supervisor",module: "obras",        action: "manage", allowed: "true"  },
  { role: "leitura",  module: "obras",        action: "manage", allowed: "false" },
  { role: "cliente",  module: "obras",        action: "manage", allowed: "false" },

  { role: "admin",    module: "obras",        action: "financeiro", allowed: "true"  },
  { role: "operador", module: "obras",        action: "financeiro", allowed: "true"  },
  { role: "tecnico",  module: "obras",        action: "financeiro", allowed: "false" },
  { role: "supervisor",module: "obras",        action: "financeiro", allowed: "false" },
  { role: "leitura",  module: "obras",        action: "financeiro", allowed: "view"  },
  { role: "cliente",  module: "obras",        action: "financeiro", allowed: "own"   },

  // Interações
  { role: "admin",    module: "interacoes",   action: "view",   allowed: "true"  },
  { role: "operador", module: "interacoes",   action: "view",   allowed: "true"  },
  { role: "leitura",  module: "interacoes",   action: "view",   allowed: "true"  },
  { role: "cliente",  module: "interacoes",   action: "view",   allowed: "own"   },

  { role: "admin",    module: "interacoes",   action: "create", allowed: "true"  },
  { role: "operador", module: "interacoes",   action: "create", allowed: "true"  },
  { role: "leitura",  module: "interacoes",   action: "create", allowed: "false" },
  { role: "cliente",  module: "interacoes",   action: "create", allowed: "false" },

  // Sistema (administração de utilizadores)
  { role: "admin",    module: "sistema",      action: "view",   allowed: "true"  },
  { role: "operador", module: "sistema",      action: "view",   allowed: "false" },
  { role: "leitura",  module: "sistema",      action: "view",   allowed: "false" },
  { role: "cliente",  module: "sistema",      action: "view",   allowed: "false" },

  { role: "admin",    module: "sistema",      action: "create", allowed: "true"  },
  { role: "operador", module: "sistema",      action: "create", allowed: "false" },
  { role: "leitura",  module: "sistema",      action: "create", allowed: "false" },
  { role: "cliente",  module: "sistema",      action: "create", allowed: "false" },

  { role: "admin",    module: "sistema",      action: "edit",   allowed: "true"  },
  { role: "operador", module: "sistema",      action: "edit",   allowed: "false" },
  { role: "leitura",  module: "sistema",      action: "edit",   allowed: "false" },
  { role: "cliente",  module: "sistema",      action: "edit",   allowed: "false" },

  { role: "admin",    module: "sistema",      action: "delete", allowed: "true"  },
  { role: "operador", module: "sistema",      action: "delete", allowed: "false" },
  { role: "leitura",  module: "sistema",      action: "delete", allowed: "false" },
  { role: "cliente",  module: "sistema",      action: "delete", allowed: "false" },

  // Portal do Cliente
  { role: "admin",    module: "portal",       action: "view",   allowed: "false" },
  { role: "operador", module: "portal",       action: "view",   allowed: "false" },
  { role: "leitura",  module: "portal",       action: "view",   allowed: "false" },
  { role: "cliente",  module: "portal",       action: "view",   allowed: "true"  },

  // Stock
  { role: "admin",    module: "stock",        action: "view",   allowed: "true"  },
  { role: "operador", module: "stock",        action: "view",   allowed: "true"  },
  { role: "leitura",  module: "stock",        action: "view",   allowed: "true"  },
  { role: "cliente",  module: "stock",        action: "view",   allowed: "own"   },

  { role: "admin",    module: "stock",        action: "manage", allowed: "true"  },
  { role: "operador", module: "stock",        action: "manage", allowed: "true"  },
  { role: "leitura",  module: "stock",        action: "manage", allowed: "false" },
  { role: "cliente",  module: "stock",        action: "manage", allowed: "false" },

  // Materiais
  { role: "admin",    module: "materiais",    action: "view",   allowed: "true"  },
  { role: "operador", module: "materiais",    action: "view",   allowed: "true"  },
  { role: "leitura",  module: "materiais",    action: "view",   allowed: "true"  },
  { role: "cliente",  module: "materiais",    action: "view",   allowed: "false" },

  { role: "admin",    module: "materiais",    action: "manage", allowed: "true"  },
  { role: "operador", module: "materiais",    action: "manage", allowed: "false" },
  { role: "leitura",  module: "materiais",    action: "manage", allowed: "false" },
  { role: "cliente",  module: "materiais",    action: "manage", allowed: "false" },
];

// Seed defaults if the table is empty
async function ensureDefaults() {
  const count = await prisma.rolePermission.count();
  if (count === 0) {
    await prisma.rolePermission.createMany({ data: DEFAULT_PERMISSIONS, skipDuplicates: true });
  }
}

// ─── GET /permissions ─────────────────────────────────────────────────────────
permissionsRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    await ensureDefaults();
    const rows = await prisma.rolePermission.findMany({
      orderBy: [{ module: "asc" }, { action: "asc" }, { role: "asc" }],
    });
    return res.json({ items: rows });
  })
);

// ─── PUT /permissions/:role/:module/:action ───────────────────────────────────
permissionsRoutes.put(
  "/:role/:module/:action",
  asyncHandler(async (req, res) => {
    const { role, module: mod, action } = z
      .object({
        role:   z.enum(["admin", "operador", "tecnico", "supervisor", "leitura", "cliente"]),
        module: z.string().min(1),
        action: z.string().min(1),
      })
      .parse(req.params);

    const { allowed } = z
      .object({ allowed: z.enum(["true", "false", "own", "view"]) })
      .parse(req.body);

    // Prevent locking out admins from system management
    const userRole = (req.user?.role || "").toUpperCase();
    if (userRole === "ADMIN" && mod === "sistema" && allowed === "false") {
      return res.status(400).json({ error: "CANNOT_REVOKE_ADMIN_SYSTEM_ACCESS" });
    }

    const updated = await prisma.rolePermission.upsert({
      where: { role_module_action: { role, module: mod, action } },
      create: { role, module: mod, action, allowed },
      update: { allowed },
    });

    return res.json(updated);
  })
);

// ─── POST /permissions/reset ──────────────────────────────────────────────────
permissionsRoutes.post(
  "/reset",
  asyncHandler(async (_req, res) => {
    await prisma.rolePermission.deleteMany({});
    await prisma.rolePermission.createMany({ data: DEFAULT_PERMISSIONS, skipDuplicates: true });
    return res.json({ ok: true });
  })
);

module.exports = { permissionsRoutes };
