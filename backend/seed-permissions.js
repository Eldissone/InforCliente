const { prisma } = require("./src/db");

const DEFAULT_PERMISSIONS = [
  // Obras for view, read, edit, delete, manage, financeiro for technical/supervisor
  { role: "tecnico",  module: "obras",        action: "view",   allowed: "true"  },
  { role: "supervisor",module: "obras",        action: "view",   allowed: "true"  },

  { role: "admin",    module: "obras",        action: "read",   allowed: "true"  },
  { role: "operador", module: "obras",        action: "read",   allowed: "true"  },
  { role: "tecnico",  module: "obras",        action: "read",   allowed: "true"  },
  { role: "supervisor",module: "obras",        action: "read",   allowed: "true"  },
  { role: "leitura",  module: "obras",        action: "read",   allowed: "true"  },
  { role: "cliente",  module: "obras",        action: "read",   allowed: "own"   },

  { role: "tecnico",  module: "obras",        action: "create", allowed: "false" },
  { role: "supervisor",module: "obras",        action: "create", allowed: "true"  },

  { role: "tecnico",  module: "obras",        action: "edit",   allowed: "true"  },
  { role: "supervisor",module: "obras",        action: "edit",   allowed: "true"  },

  { role: "tecnico",  module: "obras",        action: "delete", allowed: "false" },
  { role: "supervisor",module: "obras",        action: "delete", allowed: "false" },

  { role: "admin",    module: "obras",        action: "manage", allowed: "true"  },
  { role: "operador", module: "obras",        action: "manage", allowed: "true"  },
  { role: "tecnico",  module: "obras",        action: "manage", allowed: "true"  },
  { role: "supervisor",module: "obras",        action: "manage", allowed: "true"  },
  { role: "leitura",  module: "obras",        action: "manage", allowed: "false" },
  { role: "cliente",  module: "obras",        action: "manage", allowed: "false" },

  { role: "tecnico",  module: "obras",        action: "financeiro", allowed: "false" },
  { role: "supervisor",module: "obras",        action: "financeiro", allowed: "false" }
];

async function seed() {
  console.log("Seeding custom and new permissions...");
  for (const perm of DEFAULT_PERMISSIONS) {
    await prisma.rolePermission.upsert({
      where: {
        role_module_action: {
          role: perm.role,
          module: perm.module,
          action: perm.action
        }
      },
      update: {
        allowed: perm.allowed
      },
      create: {
        role: perm.role,
        module: perm.module,
        action: perm.action,
        allowed: perm.allowed
      }
    });
  }
  console.log("✅ Done seeding permissions!");
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
