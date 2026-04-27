const { exec, spawn } = require("child_process");
const { prisma } = require("../db");
const bcrypt = require("bcryptjs");
require("dotenv").config();

/**
 * Tests the database connection.
 */
async function testConnection() {
  try {
    console.log("🔍 Testing database connection...");
    await prisma.$queryRaw`SELECT 1`;
    console.log("✅ Database connection successful.");
  } catch (error) {
    console.error("❌ Database connection failed!");
    throw error;
  }
}

/**
 * Checks if tables exist in the database.
 */
async function checkTables() {
  try {
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `;
    const tableNames = tables.map(t => t.table_name);
    if (tableNames.length > 0) {
      console.log(`📊 Database tables found: ${tableNames.join(", ")}`);
    } else {
      console.log("⚠️ No tables found in the database.");
    }
  } catch (error) {
    console.error("❌ Failed to list tables:", error.message);
  }
}


/**
 * Ensures an admin user exists in the database.
 */
async function ensureAdminUser() {
  const adminEmail = "admin@infocliente.com";
  const adminPassword = "admin123";

  try {
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!existingAdmin) {
      console.log("🌱 Seeding default admin user...");
      const passwordHash = await bcrypt.hash(adminPassword, 10);

      await prisma.user.create({
        data: {
          email: adminEmail,
          name: "Administrador",
          passwordHash,
          role: "admin",
        },
      });

      console.log(`✅ Admin user created: ${adminEmail}`);
      console.log(`🔑 Password: ${adminPassword}`);
    } else {
      console.log("ℹ️ Admin user already exists.");
    }
  } catch (error) {
    console.error("❌ Error seeding admin user:", error);
    throw error;
  }
}

/**
 * Main initialization function to be called on server start.
 */
async function initialize() {
  console.log("--------------------------------------------------");
  console.log("🚀 Iniciando inicialização do sistema...");

  try {
    console.log("Step 1: Testando conexão...");
    await testConnection();
    
    console.log("Step 2: Verificando tabelas...");
    await checkTables();
    
    console.log("Step 3: Verificando/Criando Admin...");
    await ensureAdminUser();
    
    console.log("✅ Sistema inicializado com sucesso.");
  } catch (error) {
    console.error("❌ A inicialização falhou criticamente!");
    console.error("Erro detalhado:", error);
  }
  
  console.log("--------------------------------------------------");
}

module.exports = { initialize };
