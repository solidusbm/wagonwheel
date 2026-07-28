import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, "..", "..", "db");

export async function applySchema() {
  const schemaSql = await readFile(path.join(DB_DIR, "schema.sql"), "utf8");
  await pool.query(schemaSql);
}

// Destructive -- truncates and reloads sites/reservations/amenities from db/seed.sql.
// Only call this from an explicitly-confirmed admin action, never automatically.
export async function applySeed() {
  const seedSql = await readFile(path.join(DB_DIR, "seed.sql"), "utf8");
  await pool.query(seedSql);
}

export async function sitesCount() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM sites");
  return rows[0].count;
}
