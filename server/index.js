import "dotenv/config";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import { pool } from "./db.js";
import sitesRouter from "./routes/sites.js";
import reservationsRouter from "./routes/reservations.js";
import adminRouter from "./routes/admin.js";
import { adminAuth } from "./middleware/adminAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Applies schema.sql (idempotent -- CREATE TABLE/INDEX IF NOT EXISTS) on every boot,
// and seed.sql only if the sites table is still empty, so a fresh deploy provisions
// itself without a manual migration step, while an existing deploy's data (including
// any admin-entered bookings) survives restarts and redeploys.
async function bootstrapDatabase() {
  const schemaSql = await readFile(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await pool.query(schemaSql);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM sites");
  if (rows[0].count === 0) {
    const seedSql = await readFile(path.join(__dirname, "..", "db", "seed.sql"), "utf8");
    await pool.query(seedSql);
    console.log("[bootstrap] sites table was empty -- applied db/seed.sql");
  }
}

app.use(express.json());

app.get("/api/config", (req, res) => {
  res.json({
    squareApplicationId: process.env.SQUARE_APPLICATION_ID ?? null,
    squareLocationId: process.env.SQUARE_LOCATION_ID ?? null,
    squareEnvironment: process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox",
  });
});

app.use("/api", sitesRouter);
app.use("/api/reservations", reservationsRouter);
app.use("/api/admin", adminAuth, adminRouter);
app.use("/admin", adminAuth, express.static(path.join(__dirname, "..", "admin")));

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const WEAK_ADMIN_PASSWORDS = ["admin", "password", "changeme", "wagonwheel"];
if (process.env.ADMIN_PASSWORD && WEAK_ADMIN_PASSWORDS.includes(process.env.ADMIN_PASSWORD.toLowerCase())) {
  console.warn(
    `[startup] WARNING: ADMIN_PASSWORD is set to a weak placeholder value ("${process.env.ADMIN_PASSWORD}"). ` +
      `This is fine for local dev but MUST be changed to a strong, unique password before this app is ` +
      `deployed anywhere reachable by the public -- the /admin view exposes guest names, emails, and phone numbers.`
  );
}

const port = process.env.PORT ?? 3000;

try {
  await bootstrapDatabase();
} catch (err) {
  console.error("[bootstrap] Failed to prepare the database schema", err);
  process.exit(1);
}

app.listen(port, () => {
  console.log(`Wagon Wheel RV Park server listening on port ${port}`);
});
