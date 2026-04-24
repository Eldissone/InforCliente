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
  return new Promise((resolve, reject) => {
    console.log("--------------------------------------------------");
    console.log("🚀 Running database migrations...");

    if (!process.env.DATABASE_URL) {
      console.error("❌ DATABASE_URL is not defined!");
      return reject(new Error("DATABASE_URL_MISSING"));
    }

    console.log("🛠️ Using local Prisma binary...");
    const prismaPath = require("path").join(__dirname, "../../../node_modules/.bin/prisma");
    
    const proc = spawn(prismaPath, ["migrate", "deploy"], {
      env: process.env,
      shell: true,
    });

    proc.stdout.on("data", (data) => {
      process.stdout.write(`✅ ${data}`);
    });

    proc.stderr.on("data", (data) => {
      // Only log stderr if it's not a known warning
      const msg = data.toString();
      if (!msg.includes("The database is already up to date")) {
        process.stderr.write(`⚠️ ${msg}`);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log("✨ Migrations finished successfully.");
        resolve();
      } else {
        console.error(`❌ Migrations failed with code ${code}`);
        reject(new Error(`Migration failed with code ${code}`));
      }
    });
  });
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
