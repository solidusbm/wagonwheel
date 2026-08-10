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

Every section below Reservations (Sites, Photos, Amenities, Content, Push notifications,
RoverPass/Hipcamp sync, Danger zone) is a `<details class="sync-feeds">`, closed by default. Keep
new admin sections consistent with that pattern rather than adding a plain always-open panel.

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
- Amp service is **confirmed park-wide (2026-08-10)**: every site is 30 *and* 50 amp. It is not a
  per-site distinction and shouldn't be presented as one — the uniform `30/50` already in the
  `sites` table is correct, and the amenity "30/50 amp electric" covers it.
- Max rig length is **still not confirmed** per site — don't invent specific values; the admin
  Sites panel is where real values get entered once the park provides them.
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
- Editable text lives in the `content_blocks` table (key/section/label/value), applied client-side
  by `public/js/content.js` to any element with a `data-content-key` attribute — `/admin` → Content
  edits it. Currently only hero badge/subtitle, About heading + 3 paragraphs, and the hours-page
  intro are wired up; footer, nearby-section blurbs, and the detailed hours.html policy lists are
  still hardcoded on purpose (not yet extended to the editable set).
- Color themes live in the `styles` table (`css_vars` JSONB, a curated subset of the base
  stylesheet's CSS custom properties — bg, panel bg, gold ×2, rust, parchment text — plus an
  optional `logo_url`). **The `/admin` → Styles panel that edited this table was removed
  (2026-07-29)** — style-gallery review moved to the static-site demo hub's approval checklist
  instead (see "Cross-branch API surface" below), so this admin panel was redundant. The table,
  its `server/routes/admin.js` CRUD routes, and the public `GET /api/live-style` (read by
  `public/js/content.js` on every page load) are all still there and still work — there's just no
  UI to change which style is live anymore, so it stays pinned to whatever's `is_live` in the DB
  (currently the original "Dark Cowboy" look, seeded that way). If a style switcher is wanted
  again later, re-add the admin panel rather than rebuilding the backend — it's untouched. Seeded
  via `db/seed-content.sql`, applied unconditionally on every boot (unlike `db/seed.sql`, which
  needs an empty `sites` table or a Danger Zone reseed) — see `applyContentSeed()` in
  `server/lib/dbBootstrap.js`.
- **Fixed (2026-07-28):** the homepage hero section, nav bar, and the always-dark accent panels
  (`.nearby-item`, `.site-card`, `.order-summary` — all backed by the hardcoded `--bg-panel-2`,
  which is not one of the 6 admin-overridable style vars) previously went dark-on-dark under a
  light style preset, because their text was wired to the overridable `--parchment`/`--gold-bright`
  vars while their backgrounds stayed fixed. Fixed by hardcoding those specific text-color
  declarations to fixed literals (commits `cbae53d`, `66eeceb`, `0819391`) instead of tying them to
  the variable system. **If you add a new component with a hardcoded/non-overridable background
  (anything not using `--bg` or `--bg-panel`), give its text fixed literal colors too** — don't let
  it inherit `--parchment`/`--gold`/`--gold-bright`, or it'll break the same way under a future
  light style.
- **Cross-branch API surface:** the `static-site` branch's demo hub (GitHub Pages,
  `solidusbm.github.io`) calls this app's API directly for the style-gallery approval checklist
  (`GET /api/style-gallery-approvals` public, `PATCH/POST /api/admin/style-gallery-approvals/*`
  Basic Auth) — the only place this app is called cross-origin. CORS for just those two path
  prefixes is handled by `server/middleware/styleGalleryCors.js`, mounted in `server/index.js`
  *before* the `adminAuth`-protected `/api/admin` mount specifically so CORS preflight `OPTIONS`
  requests (sent without credentials, per spec) don't get bounced by Basic Auth before ever
  reaching the route. If you add more cross-origin endpoints, follow the same
  registration-order pattern — don't just slap `adminAuth` in front and assume CORS still works.
  The `style_gallery_approvals` table (see `db/schema.sql`) is a plain approval/dismiss +
  free-text-note checklist for the 36-page static style gallery — unrelated to the `styles`
  table's real switchable color presets. `GET /api/style-gallery-approvals` returns
  `{slug: {approved, dismissed, note}}` (shape has changed twice — started as a flat boolean map,
  then gained `note`, then `dismissed`; don't trust old examples). `approved` and `dismissed` are
  mutually exclusive — a slug is a favorite (`approved`), explicitly archived (`dismissed`), or
  neither (still under review, the default, shown in the demo hub's "Needs review" bucket, not
  hidden away). Setting one true always clears the other, enforced in the PATCH handler
  (`server/routes/admin.js`), not a DB constraint. **Un-approving something must never set
  `dismissed`** — that was a deliberate fix (2026-07-29): the two used to be conflated, so
  toggling approval off silently archived a style the user might still be considering.
  `PATCH /api/admin/style-gallery-approvals/:slug` accepts `approved`, `dismissed`, and/or `note`
  independently via `COALESCE` in the upsert — a note-only save doesn't touch the other two.

## Known unresolved / don't guess at these

- A monthly rate for sites 1–11 (as distinct from the automatic weekly-rate stacking) — not
  confirmed.
- Which specific sites have "Wired Ethernet" — confirmed real, not confirmed which sites.
- Max rig length per site (see above). Amp service is settled — 30 and 50 at every site.
- Real footages for the site map. The map was rebuilt on 2026-08-10 directly against the filed
  plan (Mangold Engineering dwg 100-7799, sheet 2 of 5, "System Layout", 1" = 100'), supplied by
  the park as a photo of the printed sheet. **Orientation, road topology, adjacency and numbering
  are now correct and should not be re-guessed**: the block sits about 12° off north, the entrance
  is off Polly Peak Dr. at the northeast, Broad Oak Drive bounds the northwest, the office and its
  turnaround are at the north end, a two-way loop rings the block with a rung through the middle,
  Sites 1–2 are an angled pair at the west end by the existing fence, and every site is a back-in.
  What is *not* from the plan is dimensions — bay sizes and road widths are legible-on-a-phone
  proportions, not measured off the sheet. Closing that needs either a scan/measurement of the
  printed sheet at its stated scale or a few paced distances at the park.

These are tracked as open items on the `static-site` branch's `/todo/` action list
(https://solidusbm.github.io/wagonwheel/todo/) — check there for the current launch checklist
before assuming something is or isn't done.

## Testing UI changes

There's no automated test suite. For anything touching the booking flow, admin panel, or payment
form, actually click through it — locally with `npm run dev`, or against the live Render URL for
anything that depends on production-only config (Square sandbox, the live database). Screenshot
or describe what you verified rather than assuming code review is sufficient.

**Testing phone/tablet layouts:** the browser automation's `resize_window` doesn't actually change
`window.innerWidth` in this environment (only the outer window bounds) — CSS media queries won't
respond to it, so it can't be used to test responsive breakpoints. Instead, inject an `<iframe>`
at the exact width you want to test (e.g. 390px for phone, 768px for tablet) pointing at the real
URL — an iframe gets its own genuine viewport for media-query purposes, unlike the outer window.
Screenshot/zoom into that iframe region rather than the full tab.

**Fixed (2026-07-29):** two phone/tablet bugs found this way. (1) The homepage hero's SVG art
(`viewBox` ~2.3:1) sized the hero box via `width:100%;height:auto`, so below 820px the box got too
short for the vertically-centered hero text, which overflowed upward behind the sticky nav; fixed
with an explicit `min-height` on `.hero` below 820px, with the art absolutely-filling it via its
existing `preserveAspectRatio="xMidYMid slice"` (crop-to-cover). (2) The admin Reservations/Sites
tables have more columns than a phone/tablet is wide. First pass just contained the overflow to a
scrollable `.table-scroll` wrapper so the whole page stopped scrolling sideways — but the table
itself still needed a sideways swipe to see every column, which wasn't good enough. Second pass:
below 820px each `<tr>` now renders as a stacked card instead of a table row — `<thead>` is
visually hidden (kept in the accessibility tree via a clip-rect, not `display:none`), and each
`<td>` shows a small uppercase label (from its `data-label` attribute) above its value instead of
sitting in a column. No scrolling needed at all below 820px now. **If you add a new admin table,
add `data-label="..."` to every `<td>` (skip it on action-button cells) and wrap the table in
`.table-scroll`** — both pieces are needed: the CSS media query keys off `[data-label]`, and
`.table-scroll` stays as a fallback safety net above 820px in case a row ever doesn't fit even as a
normal table.
