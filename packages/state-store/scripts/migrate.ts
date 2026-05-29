import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const sqlPath = join(migrationsDir, "001_init.sql");

const pool = new pg.Pool({ connectionString });

try {
  const sql = await readFile(sqlPath, "utf-8");
  await pool.query(sql);
  console.log(`Migration applied: ${sqlPath}`);
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
