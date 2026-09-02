import pg from "pg";

const { Pool } = pg;

// Render (and most managed Postgres hosts) require SSL and present a cert that
// isn't in Node's default trust store; local dev Postgres has neither.
const isManagedHost = /render\.com/.test(process.env.DATABASE_URL ?? "");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isManagedHost ? { rejectUnauthorized: false } : false,
});
