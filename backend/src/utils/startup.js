const { exec } = require("child_process");
const { prisma } = require("../db");
const bcrypt = require("bcryptjs");

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

    // Use 'npx prisma migrate deploy' for applying pending migrations in production/automated environments
    exec("npx prisma migrate deploy", (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Migration error: ${error.message}`);
        return reject(error);
      }
      if (stderr && !stderr.includes("The database is already up to date")) {
        console.log(`⚠️ Migration stderr: ${stderr}`);
      }
      console.log(`✅ Migration output: ${stdout || "Database is already up to date."}`);
      resolve();
    });
  });
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
