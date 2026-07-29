# Wagon Wheel RV Park — full-service app

This file is read automatically by any Claude Code session that opens this directory. It's the
operational quick-reference for maintaining this specific app. For the product description,
stack, and setup steps, see `README.md` — this file covers things a maintenance session needs
to know that aren't just "read the code."

## What this branch is

This branch (`claude/rv-booking-project-6pigax`) is the **real, live product** — a Node/Express +
PostgreSQL + Square booking app for Bandera Wagon Wheel RV Park. It is the chosen direction over
an earlier static-site + third-party-widget alternative (see the `static-site` branch, which is
now a design-reference hub only — not a competing implementation, don't merge the two).

**Live URL:** https://wagonwheel-rv-park.onrender.com/
**Admin:** https://wagonwheel-rv-park.onrender.com/admin (HTTP Basic Auth — see "Admin access" below)
**Render service:** `wagonwheel-rv-park` (web service) + `wagonwheel-db` (Postgres), both on the free tier

**⚠️ `wagonwheel-db` was created ~2026-07-21 and Render deletes free-tier Postgres databases 30
days after creation (~2026-08-20) unless upgraded to a paid instance.** If this is still on the
free tier as that date approaches, proactively flag it to the user — check Render → `wagonwheel-db`
→ Info tab for the current expiry banner, since the exact date may have changed if it was ever
upgraded, recreated, or reseeded.

## Before you push

**Don't push to `origin/claude/rv-booking-project-6pigax` until the user explicitly asks.** Render
auto-deploys on every push to this branch, so a push goes live immediately. Batch changes locally
(commit freely — commits are cheap and don't deploy anything), and push only when told to. If the
user's message *is* the go-ahead ("push it", "deploy this", "yes" in response to "should I push?"),
that counts — you don't need to ask a second time in the same turn.

## Database bootstrapping — read this before touching `db/schema.sql` or `db/seed.sql`

`server/index.js` runs `bootstrapDatabase()` on every boot:
1. Applies `db/schema.sql` unconditionally (must be idempotent — `CREATE TABLE IF NOT EXISTS`,
   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, etc.)
2. Applies `db/seed.sql` **only if the `sites` table is completely empty**

This means: on an already-provisioned database (like the live one), new columns/tables you add to
`schema.sql` show up automatically on the next deploy, but corrected *data* in `seed.sql` (new
site names, rates, amenity lists, etc.) does **not** apply automatically — the `sites` table
already has rows, so step 2 never runs. If you change `seed.sql`, the live database won't reflect
it until someone manually reseeds.

**To force a reseed:** `/admin` has a "Danger zone" panel → "Reseed database from seed.sql". It
calls `POST /api/admin/db/reseed` (Basic Auth protected, requires typing `RESEED` to confirm).
This **truncates and reloads** `sites`, `reservations`, `amenities`, `site_amenities`, and
`photos` — irreversible, deletes any real bookings that exist at the time. Use with the user's
explicit go-ahead only, same as a push.

Do not try to reseed by connecting to the database directly with credentials pulled from the
Render dashboard — that pattern gets blocked by the permission system (rightly: an automated
process using scraped DB credentials to write to production is exactly what it's designed to
catch). The reseed endpoint above is the sanctioned path; it never requires exposing DB
credentials at all.

## Admin access

`/admin` is protected by HTTP Basic Auth via `ADMIN_USERNAME`/`ADMIN_PASSWORD`, set as Render
environment variables (Dashboard → `wagonwheel-rv-park` → Environment) — never hardcoded in this
repo. **As of this writing both are still set to the weak local-dev placeholder** (`admin`/`admin`)
— the server prints a startup warning about this every boot. This must be changed to a real
username/strong password before the park actually starts taking bookings; `/admin` exposes guest
names, emails, and phone numbers. Rotating it means going into Render's Environment tab and
setting new values — no code change needed.

## Payments

Square **sandbox** credentials (`SQUARE_ACCESS_TOKEN`, `SQUARE_APPLICATION_ID`,
`SQUARE_LOCATION_ID`) are configured in Render's environment and have been tested end-to-end with
a real sandbox checkout. `SQUARE_ENVIRONMENT=sandbox`. Going live for real means: get
**production** credentials from the Square Developer Dashboard, set the same three env vars to
the production values, and flip `SQUARE_ENVIRONMENT=production`. Test card for sandbox:
`4111 1111 1111 1111`, any future expiry, any CVV.

Square's card entry fields are rendered in a cross-origin iframe (Square's Web Payments SDK) —
this is intentional PCI-compliance isolation. Browser automation cannot read or fill those fields,
and shouldn't try to; if you need to test a real checkout, that step needs a human.

## Data model notes worth knowing before editing site/rate data

- 12 sites, real numbering and Front/Center/Back Row grouping pulled from the park's county-filed
  septic/site engineering plan — not placeholder. Site map in `public/js/app.js`
  (`renderSiteMap`) draws this from live `sites.area` groupings, not hardcoded.
- Site 12 is a separate premium unit ($350/week, electric **not** included, unlike sites 1–11's
  $45/night-with-electric / $210/week) — a former long-term tenant's site. Don't "normalize" its
  pricing to match the others without checking with the user first.
- Per-site amp service and max rig length are **still not confirmed** per site — don't invent
  specific values; the admin Sites panel is where real values get entered once the park provides
  them.
- Amenities are a single unified catalog (`amenities` table) with two independent flags:
  `show_on_homepage` (the homepage "what every site includes" grid) and `show_per_site`
  (toggleable per individual site, like "Wired Ethernet"). An amenity can be either, both, or
  (while inactive) neither. Don't reintroduce the old split `park_amenities` table — it was
  deliberately merged away.
- Photos are stored as `BYTEA` in Postgres (`photos` table), not on local disk — Render's
  free-tier web service filesystem is wiped on every deploy/restart, so anything written to disk
  at runtime doesn't survive. All gallery management happens through `/admin` → Photos; there is
  no hardcoded gallery content left in `public/index.html` or `public/gallery.html`.
- The booking form doubles as the park's paper "Application for Monthly RV Guests" — **one single
  application for every booking, not a separate short-stay/long-stay form** (a prior version had
  a stay-length-gated split; the user explicitly asked for it to be unified — don't reintroduce
  that split). The paper form's prior-residence/landlord-reference section and background-check
  questions (eviction history, criminal record, etc.) were struck out by the park on the original
  and are intentionally not collected — don't add them back without the user asking.

## Known unresolved / don't guess at these

- A monthly rate for sites 1–11 (as distinct from the automatic weekly-rate stacking) — not
  confirmed.
- Which specific sites have "Wired Ethernet" — confirmed real, not confirmed which sites.
- Per-site amp service and max rig length (see above).

These are tracked as open items on the `static-site` branch's `/todo/` action list
(https://solidusbm.github.io/wagonwheel/todo/) — check there for the current launch checklist
before assuming something is or isn't done.

## Testing UI changes

There's no automated test suite. For anything touching the booking flow, admin panel, or payment
form, actually click through it — locally with `npm run dev`, or against the live Render URL for
anything that depends on production-only config (Square sandbox, the live database). Screenshot
or describe what you verified rather than assuming code review is sufficient.
