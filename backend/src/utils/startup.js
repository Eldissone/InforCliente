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
 * Runs Prisma migrations automatically.
 */
async function runMigrations() {
  console.log("--------------------------------------------------");
  console.log("🚀 Running database migrations...");

  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is not defined!");
    throw new Error("DATABASE_URL_MISSING");
  }

  try {
    const { execSync } = require("child_process");
    console.log("📂 Directory:", process.cwd());
    
    // Using execSync with stdio: 'inherit' ensures output goes directly to Render logs
    execSync("npx prisma migrate deploy", { 
      env: process.env, 
      stdio: "inherit" 
    });
    
    console.log("✨ Migrations finished successfully.");
  } catch (error) {
    console.error(`❌ Migrations failed: ${error.message}`);
    throw error;
  }
}

/**
 * Ensures an admin user exists in the database.
 */
async function ensureAdminUser() {
  const adminEmail = "admin@inforcliente.com";
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

  try {
    await testConnection();
    await runMigrations();
    await checkTables();
  } catch (error) {
    console.error("⚠️ Migrations failed to apply automatically. You may need to run 'npx prisma migrate dev' manually.");
  }

  try {
    await ensureAdminUser();
  } catch (error) {
    console.error("❌ Failed to ensure admin user.");
  }

  console.log("✨ Startup initialization attempt completed.");
  console.log("--------------------------------------------------");
}

module.exports = { initialize };
