/**
 * Compara os modelos e enums do schema.prisma com o que as migrações realmente criam.
 * Serve para detectar deriva causada por `prisma db push` sem migração correspondente.
 *
 * Uso: node scripts/checkMigrationDrift.js
 */
const fs = require("fs");
const path = require("path");

const schemaPath = path.join(__dirname, "..", "prisma", "schema.prisma");
const migrationsDir = path.join(__dirname, "..", "prisma", "migrations");

const schema = fs.readFileSync(schemaPath, "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
const enums = [...schema.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]);

let sql = "";
for (const dir of fs.readdirSync(migrationsDir)) {
  const file = path.join(migrationsDir, dir, "migration.sql");
  if (fs.existsSync(file)) sql += fs.readFileSync(file, "utf8") + "\n";
}

const createsTable = (name) =>
  new RegExp(`CREATE TABLE\\s+(IF NOT EXISTS\\s+)?"${name}"`, "i").test(sql);
const createsType = (name) => new RegExp(`CREATE TYPE\\s+"${name}"`, "i").test(sql);

const missingModels = models.filter((m) => !createsTable(m));
const missingEnums = enums.filter((e) => !createsType(e));

console.log(`\nModelos sem migração: ${missingModels.length} de ${models.length}`);
missingModels.forEach((m) => console.log(`  - ${m}`));

console.log(`\nEnums sem migração: ${missingEnums.length} de ${enums.length}`);
missingEnums.forEach((e) => console.log(`  - ${e}`));
console.log("");
