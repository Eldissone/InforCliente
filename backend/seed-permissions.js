const { prisma } = require("./src/db");
const { buildDefaultPermissions } = require("./src/config/permissionsCatalog");

const DEFAULT_PERMISSIONS = buildDefaultPermissions();

async function seed() {
  console.log(`Sincronizando ${DEFAULT_PERMISSIONS.length} permissões do catálogo…`);
  let created = 0;
  let updated = 0;

  for (const perm of DEFAULT_PERMISSIONS) {
    const existing = await prisma.rolePermission.findUnique({
      where: {
        role_module_action: {
          role: perm.role,
          module: perm.module,
          action: perm.action,
        },
      },
    });
    if (!existing) {
      await prisma.rolePermission.create({ data: perm });
      created++;
    } else if (existing.allowed !== perm.allowed) {
      // Não sobrescreve personalizações — apenas cria em falta
    }
  }

  console.log(`✅ Permissões: ${created} novas entradas (${DEFAULT_PERMISSIONS.length} no catálogo).`);
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
