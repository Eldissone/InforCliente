const { prisma } = require("../db");
const bcrypt = require("bcryptjs");
require("dotenv").config();
const { ensureGeneralCostCenters } = require("../services/generalCostCenterService");

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

/**
 * Cria admin padrão se não existir
 */
async function ensureAdminUser() {
  const adminEmail = "admin@infocliente.com";
  const adminPassword = "admin123";

  try {
    const existing = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!existing) {
      console.log("🌱 Criando admin padrão...");

      const passwordHash = await bcrypt.hash(adminPassword, 10);

      await prisma.user.create({
        data: {
          email: adminEmail,
          name: "Administrador",
          passwordHash,
          role: "admin",
        },
      });

      console.log("✅ Admin criado:", adminEmail);
    } else {
      console.log("ℹ️ Admin já existe");
    }
  } catch (error) {
    console.error("❌ Erro ao criar admin:", error);
  }
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