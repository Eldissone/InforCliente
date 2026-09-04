const { prisma } = require("../db");
const bcrypt = require("bcryptjs");
require("dotenv").config();
const { ensureGeneralCostCenters } = require("../services/generalCostCenterService");
const { ensureCostCategories } = require("../services/costCategoryService");

/**
 * Testa conexão com banco
 */
async function testConnection() {
  try {
    console.log("🔍 Testando conexão com banco...");
    await prisma.$queryRaw`SELECT 1`;
    console.log("✅ Conexão com banco OK");
  } catch (error) {
    console.error("❌ Falha na conexão com banco:", error);
    throw error;
  }
}

/**
 * Verifica tabelas existentes
 */
async function checkTables() {
  try {
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `;

    if (tables.length > 0) {
      console.log("📊 Tabelas encontradas:", tables.map(t => t.table_name).join(", "));
    } else {
      console.log("⚠️ Nenhuma tabela encontrada");
    }
  } catch (error) {
    console.error("❌ Erro ao verificar tabelas:", error);
  }
}

const FORBIDDEN_BOOTSTRAP_PASSWORDS = new Set([
  "admin123",
  "password",
  "password123",
  "12345678",
  "admin",
  "infocliente",
]);

/**
 * Cria o primeiro admin apenas se BOOTSTRAP_ADMIN_EMAIL e
 * BOOTSTRAP_ADMIN_PASSWORD estiverem definidos. Nunca usa senha hardcoded.
 */
async function ensureAdminUser() {
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "");
  const name = String(process.env.BOOTSTRAP_ADMIN_NAME || "Administrador").trim() || "Administrador";

  if (!email && !password) {
    console.log("ℹ️ Bootstrap de admin omitido (BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD).");
    return;
  }

  if (!email || !password) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD devem ser definidos em conjunto.");
  }

  if (password.length < 8 || FORBIDDEN_BOOTSTRAP_PASSWORDS.has(password.toLowerCase())) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD recusada: use no mínimo 8 caracteres e não reutilize senhas conhecidas (ex.: admin123)."
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    console.log("ℹ️ Utilizador bootstrap já existe:", email);
    return;
  }

  console.log("🌱 Criando admin via variáveis de ambiente...");
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: "admin",
    },
  });
  console.log("✅ Admin criado:", email);
}

/**
 * Função principal de inicialização
 */
async function initialize() {
  console.log("\n====================================");
  console.log("🚀 INICIALIZAÇÃO DO SISTEMA");
  console.log("====================================");

  try {
    await testConnection();
    await checkTables();
    await ensureAdminUser();
    await ensureGeneralCostCenters();
    await ensureCostCategories();

    console.log("====================================");
    console.log("✅ SISTEMA INICIALIZADO COM SUCESSO");
    console.log("====================================\n");
  } catch (error) {
    console.error("❌ FALHA CRÍTICA NA INICIALIZAÇÃO:", error);
    process.exit(1);
  }
}

/**
 * 🔥 EXECUÇÃO AUTOMÁTICA (IMPORTANTE)
 */
if (require.main === module) {
  initialize();
}

module.exports = { initialize };