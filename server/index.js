import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import sitesRouter from "./routes/sites.js";
import reservationsRouter from "./routes/reservations.js";
import adminRouter from "./routes/admin.js";
import calendarRouter from "./routes/calendar.js";
import photosRouter from "./routes/photos.js";
import seoRouter from "./routes/seo.js";
import { applyHead, snapshot } from "./lib/seo.js";
import { applyBody } from "./lib/ssr.js";
import { adminAuth } from "./middleware/adminAuth.js";
import { makeAssetVersioner } from "./lib/assetVersion.js";
import { styleGalleryCors } from "./middleware/styleGalleryCors.js";
import { applySchema, applySeed, applyContentSeed, sitesCount } from "./lib/dbBootstrap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Applies schema.sql (idempotent -- CREATE TABLE/INDEX IF NOT EXISTS) on every boot,
// and seed.sql only if the sites table is still empty, so a fresh deploy provisions
// itself without a manual migration step, while an existing deploy's data (including
// any admin-entered bookings) survives restarts and redeploys. To force a reseed of an
// already-provisioned database (e.g. to pick up corrected site data), use the "Danger
// zone" button in /admin instead of relying on this -- it won't touch a non-empty table.
async function bootstrapDatabase() {
  await applySchema();
  if ((await sitesCount()) === 0) {
    await applySeed();
    console.log("[bootstrap] sites table was empty -- applied db/seed.sql");
  }
  // Non-destructive (ON CONFLICT DO NOTHING) -- safe to run every boot regardless of the
  // above, so editable-content/style defaults exist even on an already-provisioned database
  // that never had an empty sites table to trigger the block above.
  await applyContentSeed();
}

app.use(express.json());

app.get("/api/config", (req, res) => {
  res.json({
    squareApplicationId: process.env.SQUARE_APPLICATION_ID ?? null,
    squareLocationId: process.env.SQUARE_LOCATION_ID ?? null,
    squareEnvironment: process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox",
  });
});

// Registered ahead of adminAuth so a CORS preflight OPTIONS request (sent without credentials,
// per browser spec) doesn't get rejected by Basic Auth before it ever reaches adminRouter.
app.use("/api/style-gallery-approvals", styleGalleryCors);
app.use("/api/admin/style-gallery-approvals", styleGalleryCors);

app.use("/api", sitesRouter);
app.use("/api/reservations", reservationsRouter);
app.use("/api/admin", adminAuth, adminRouter);
const adminDir = path.join(__dirname, "..", "admin");
const publicDir = path.join(__dirname, "..", "public");

/* Where an asset URL actually lives on disk. The admin page is the awkward one: it's mounted at
   /admin, so its own scripts are requested as /admin/js/*.js and served out of adminDir, but it
   borrows the site stylesheet at /css/style.css, which is in publicDir. A wrong answer here does
   not throw -- the asset simply stops being version-stamped and starts surviving deploys in a
   cache. See the note in lib/assetVersion.js. */
const resolveAsset = (urlPath) =>
  urlPath.startsWith("/admin/")
    ? path.join(adminDir, urlPath.slice("/admin".length))
    : path.join(publicDir, urlPath);

app.use("/admin", adminAuth, makeAssetVersioner(adminDir, resolveAsset), express.static(adminDir));
app.use("/calendar", calendarRouter);
app.use(photosRouter);
// /robots.txt, /sitemap.xml and the og:image share card. Ahead of the static mount so a stray
// file of the same name in public/ could never shadow the generated one.
app.use(seoRouter);

/* The guest pages are completed here, from one read of the database: the <head> gets its canonical,
   description, og:/twitter: tags and the homepage's JSON-LD (lib/seo.js), and the body gets its
   amenity grid, photo grid and rates panel rendered into the data-ssr containers (lib/ssr.js).
   One snapshot feeds both, so the structured data and the visible page always agree.

   The admin versioner above deliberately gets no transform: /admin is Basic-Auth'd and must never
   be described to a crawler. */
app.use(makeAssetVersioner(publicDir, resolveAsset, async (target, html) => {
  const snap = await snapshot();
  return applyBody(applyHead(target, html, snap), snap);
}));
app.use(express.static(publicDir));

/* Anything that reaches here is a URL nothing served. Express's default is a bare
   "Cannot GET /whatever" on an unstyled page, which reads as a broken site rather than a mistyped
   address. Registered after the static mounts so it only catches genuine misses, and it answers
   only page requests -- an unmatched /api/* call should still get JSON, not HTML. */
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.status(404).sendFile(path.join(publicDir, "404.html"));
});

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

// A From address on a reserved example domain is deliverable nowhere. The live deploy carried
// bookings@wagonwheelrv.example over from an early placeholder, which would have surfaced as a
// confusing relay rejection on the first real booking rather than as an obvious misconfiguration.
const FROM = process.env.SMTP_FROM;
if (FROM && /\.(example|invalid|test|localdomain|local)$/i.test(FROM.split("@").pop() ?? "")) {
  console.warn(
    `[startup] WARNING: SMTP_FROM is "${FROM}", which is on a reserved domain that can never receive ` +
      `or authenticate mail. Most relays will reject the message outright. Set it to the mailbox the ` +
      `app authenticates as, or unset it -- it falls back to SMTP_USER.`
  );
}

/* Square has four settings that must all agree, and getting them half-changed is the easy
   mistake: SQUARE_ENVIRONMENT is matched against the exact string "production", so "Production"
   or "prod" silently leaves the app in sandbox while the credentials say otherwise. The
   application ID prefix is a reliable tell -- sandbox IDs start "sandbox-sq0idb-", live ones
   "sq0idp-" -- so mismatches can be caught at boot rather than at the first real card. */
const SQ_ENV = process.env.SQUARE_ENVIRONMENT;
const SQ_APP = process.env.SQUARE_APPLICATION_ID ?? "";
const sqLive = SQ_ENV === "production";
if (SQ_ENV && !sqLive && /^prod/i.test(SQ_ENV)) {
  console.warn(
    `[startup] WARNING: SQUARE_ENVIRONMENT is "${SQ_ENV}", which is NOT the exact string ` +
      `"production" -- the app is running against Square's SANDBOX and no card will be charged.`
  );
}
if (sqLive && SQ_APP.startsWith("sandbox-")) {
  console.warn(
    `[startup] WARNING: SQUARE_ENVIRONMENT is "production" but SQUARE_APPLICATION_ID is a sandbox ` +
      `ID ("${SQ_APP}"). Checkout will fail. The access token and location ID almost certainly ` +
      `need changing too -- all four Square settings come from the same environment.`
  );
}
if (!sqLive && SQ_APP.startsWith("sq0idp-")) {
  console.warn(
    `[startup] WARNING: SQUARE_APPLICATION_ID is a live ID ("${SQ_APP}") but SQUARE_ENVIRONMENT is ` +
      `not "production", so the app is talking to Square's sandbox. Bookings will complete ` +
      `without charging anyone.`
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
