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

**Live URL:** https://banderawagonwheelrv.com/ (also served at https://wwrvb.sastx.net/)
**Admin:** https://banderawagonwheelrv.com/admin (HTTP Basic Auth — see "Admin access" below)
**Hosting:** Coolify app `wwrvb` on the SaStx IONOS VPS, against the shared `sastx-shared-pg`
Postgres. **Render is gone** — decommissioned 2026-08-11, don't look for it.

The domain is registered on the **client's** Cloudflare account and served through a second
`cloudflared` tunnel owned by that account (a tunnel can only be routed from a zone in the same
account, so the sastx tunnel cannot serve it). That connector runs on the VPS as the Docker
container `cloudflared-bwrv`. `www` 301s to the apex, and `http://` 301s to `https://`.

## Before you push

**Don't push to `origin/claude/rv-booking-project-6pigax` until the user explicitly asks.** Coolify
auto-deploys on every push to this branch (GitHub webhook, wired 2026-08-11 — builds land in about
40 seconds), so a push goes live immediately. Batch changes locally
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

`/admin` is protected by HTTP Basic Auth via `ADMIN_USERNAME`/`ADMIN_PASSWORD`, set as Coolify
environment variables (Coolify → `wwrvb` → Environment Variables) — never hardcoded in this repo.
**Rotated off the `admin`/`admin` placeholder by the user on 2026-08-11.** Claude does not hold
these credentials, so anything that needs to be checked or changed inside `/admin` has to be done
by the user — don't ask for the password unprompted. `server/index.js` still warns at boot if
`ADMIN_PASSWORD` is ever set back to a known-weak value; `/admin` exposes guest names, emails and
phone numbers, so that warning is worth heeding.

Every section below Reservations (Sites, Photos, Amenities, Content, Push notifications,
RoverPass/Hipcamp sync, Danger zone) is a `<details class="sync-feeds">`, closed by default. Keep
new admin sections consistent with that pattern rather than adding a plain always-open panel.

The **site editor lives inside the Sites section**, above the table it edits. It used to sit at
the bottom of the page, after Photos/Amenities/Content, so pressing Edit scrolled the user away
from the sites list into what looked like an unrelated part of the admin. `openSiteForm()` also
opens the enclosing `<details>` — a panel revealed inside a collapsed section is invisible.

## Payments

Square is **live**. `SQUARE_ENVIRONMENT=production` with production `SQUARE_ACCESS_TOKEN`,
`SQUARE_APPLICATION_ID` (`sq0idp-`…) and `SQUARE_LOCATION_ID` (`LWB7T9H0GY58E`) in Coolify.
Verified end to end on 2026-08-11 with a real card. Sandbox test numbers like
`4111 1111 1111 1111` are **declined in production** — there is no test card any more.

All four settings must come from the same environment. `SQUARE_ENVIRONMENT` is compared against
the exact string `"production"`, so `Production` silently leaves the app in sandbox, taking
bookings and charging nobody; `server/index.js` warns at boot about that and about an
environment/application-ID mismatch.

**Diagnose payment failures with `/admin` → Payments → "Check Square setup"** before assuming
anything. It asks Square which locations the token can actually see and whether the configured one
carries `CREDIT_CARD_PROCESSING`. "Not authorized to take payments with location ID" means one of
three things — wrong location, location in a different Square account, or an account not cleared
for cards — and they are indistinguishable at checkout. Both times it looked like an activation
problem it was a **truncated location ID**; Square location IDs are 13 characters.

**Refunds run through the app** (built 2026-08-11 — this section used to say there was no refund
path; there is). `/admin` has a refund-quote + refund action per reservation, and guests can
cancel themselves from the link in their confirmation email (`/cancel.html`, HMAC-token gated).
Both call Square, record `square_refund_id` / `refunded_cents` / `cancellation_fee_cents`, and
cancel the reservation in the same step, so the dates are released rather than left blocked.
Refunding directly in the Square dashboard still does *not* touch the reservation — if anyone does
that, the row must also be cancelled in `/admin`. Each reservation shows its `squarePaymentId`
under the total so a booking can be matched to its Square transaction.

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
  `sites` table is correct, and the amenity "30/50 amp electric" covers it. **The amp selector was
  removed from the `/admin` site editor and the Amp column from its table (2026-08-12)** at the
  user's direction, for exactly that reason — don't add either back. The `sites.amp_service`
  column stays and is still read by the guest site cards; the admin form simply omits the field,
  so `PATCH` falls through to `existing.amp_service` and `POST` defaults to `"30/50"`.
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

## Settled — don't "fix" these back

- **Rates are capped at the monthly rate, PER MONTH.** `quote()` bills whole months at
  `price_per_month_cents` and the remainder the normal weekly/nightly way, never charging more
  than one further month for the remainder. A single flat ceiling on the whole stay would make a
  year cost the same as a fortnight -- don't "simplify" it to that. Set by the user 2026-08-11.
  **All twelve sites are currently $350/month, a placeholder** pending the real per-site figures
  from the Tuesday meeting. With that value the cap bites at about 11 nights, so an 11-night stay
  and a 29-night stay both cost $350.
- **Any rate may be N/A (NULL) -- a site need not be sold by every term.** Site 1 is rented by the
  month only, so its nightly and weekly rates are NULL. `quote()` bills a stay with whatever terms
  the site does sell, **rounding up to the smallest one available**: at a monthly-only site a
  three-night stay is a month's rent, and at a weekly-only site eight nights is two weeks. That is
  how such a site is actually let, not a rounding bug. What is *not* allowed is all three being
  N/A -- `rateProblem()` in `server/routes/admin.js` refuses it, the admin form refuses it, and the
  `sites_has_a_rate` CHECK constraint is the backstop. A site with no rates is also excluded from
  `/availability` rather than failing at checkout.
- **`db/schema.sql` runs on EVERY boot, so it must never carry data defaults.** It used to end
  with `UPDATE sites SET price_per_month_cents = 35000 WHERE price_per_month_cents IS NULL`,
  which became a trap once NULL started meaning N/A: a rate the office cleared in `/admin` came
  back as $350 on the next deploy. Placeholder values belong in `db/seed.sql`, which only runs on
  an empty database. Backfill `ALTER`s must also sit *below* the `CREATE TABLE` they alter --
  four `ALTER TABLE reservations` statements sat above it, which worked only because the live
  table already existed and would have failed the whole bootstrap on a fresh database.
- **Only the server prices a stay.** The browser asks `GET /api/quote?siteId=&checkIn=&checkOut=`
  and renders the `lines` it returns. It used to do the arithmetic itself and drifted: it stacked
  weeks and nights unaware of the monthly cap, and added a $5 booking fee the park had dropped, so
  the "estimated total" a guest agreed to was not what their card was charged. Don't reintroduce
  rate arithmetic in `public/js/app.js`.
- **The optional application sections start collapsed.** Spouse/co-applicant, occupants, vehicles,
  RV information and pets are `<details class="form-section">`, closed on load -- about forty
  fields that otherwise buried the card entry and Pay button on a phone (measured: the form is
  1450px tall closed vs 5629px open at 390px wide). The inputs stay in the DOM either way, so a
  section filled in and then closed still submits.
- **The sandbox warning at checkout is conditional.** `public/index.html` carries a hidden
  `#sandbox-note` that `app.js` reveals only when `/api/config` reports a non-production Square
  environment. It used to be hardcoded, so the live site told guests "no real card will be
  charged" while charging their card.
- **Cancellation: $100 flat if the booking was charged at the monthly rate** (including a shorter
  stay that hit the cap), **otherwise 11.11% of the amount charged.** The rest is refunded. This
  **replaced** the earlier deposit / 14-day / camping-credit terms entirely on 2026-08-11 -- those
  are gone from `/hours` and from the guest email, and should not come back. `monthlyRateApplied`
  is decided at booking time and stored on the reservation, so a later rate change cannot
  retroactively alter what a guest was told. Note the policy has a cliff: cancelling a 10-night
  stay costs $38.33 but an 11-night stay costs $100.
- **Guests can cancel themselves.** The confirmation email carries a link to `/cancel.html`
  holding an HMAC of the reservation code (`server/lib/cancelToken.js`). Reservation codes are
  short and guessable, so **the code alone must never be enough to cancel a booking and move
  money** -- don't add a "look up by code" flow without the token. The secret is
  `CANCEL_TOKEN_SECRET`, falling back to a hash of `SQUARE_ACCESS_TOKEN` so links survive restarts;
  rotating the Square token invalidates outstanding links, and the office can still cancel from
  `/admin`. Self-service stops once `check_in` has arrived -- after that it is a phone call, since
  the policy says nothing about refunding a stay already under way.
- **No booking fee.** `BOOKING_FEE_CENTS=0` on the live deploy, and the code now defaults to 0 to
  match. Confirmed by the user 2026-08-11 after the first live card came through at the bare
  nightly rate ($45.00 for one night on Site 4, no fee added). This is the park's decision, not a
  misconfiguration — a reservation showing `bookingFeeCents: 0` is correct. Do not restore the old
  $5 default.
- **Square is live.** Production credentials since 2026-08-11, verified end to end with a real card
  (reservation `8YLQCZ5`, Square payment `fn2lStJEApIXYYPArBO1YUgxhgEZY`, refunded afterward).
  `/admin` -> Payments -> "Check Square setup" asks Square which locations the token can see and
  whether the configured one carries `CREDIT_CARD_PROCESSING` — use it before assuming a payment
  failure is an account-activation problem. It was a truncated location ID both times it looked
  like one (`LWB7T9H` vs the real 13-character `LWB7T9H0GY58E`).

## Known unresolved / don't guess at these

- A monthly rate for sites 1–11 (as distinct from the automatic weekly-rate stacking) — not
  confirmed.
- Which specific sites have "Wired Ethernet" — confirmed real, not confirmed which sites.
- Max rig length per site (see above). Amp service is settled — 30 and 50 at every site.
- Real footages for the site map. The map was rebuilt on 2026-08-10 against the filed plan
  (Mangold Engineering dwg 100-7799, sheet 2 of 5, "System Layout", 1" = 100'), supplied by the
  park first as a photo of the printed sheet and then as a copy marked up by hand — roads in
  green, sites in yellow, office in red. **The marked-up copy is the authority; it corrected a
  first pass that had the tilt, the position of Sites 1–2, and the number of street connections
  wrong.** Orientation, road topology, adjacency and numbering are now correct and should not be
  re-guessed:
    - The block sits about **18° off north** (not 12°) — rows run roughly square to the Polly
      Peak Dr. frontage rather than to the page. Broad Oak Drive bounds the northwest.
    - **Two connections to Polly Peak Dr.**, not one: the north entrance that runs south past the
      office, and a second access off the southeast corner.
    - The roads are a **ladder, not a loop** — a spine down the east side (the entrance drive
      continuing south), a leg down the west side, and three two-way rungs: above Sites 3–7,
      between the rows, and below Sites 8–12.
    - **Sites 1–2 are their own short row hanging north off the top rung** at the west end by the
      existing fence — outside the ladder, not a pocket between the rows, and not angled.
    - Every site is a back-in, matching `pull_through = false` on all twelve rows.
  **The layout now lives in `public/js/park-layout.js` — real feet, one object.** It was arranged
  by hand in a layout editor against the marked-up plan; `renderSiteMap()` in `app.js` only draws
  it, matching bays to sites by the number in the site name. To change where anything sits, edit
  that file; don't reach into the renderer. A site with no bay in the layout is drawn in an
  overflow row beneath the park rather than silently vanishing.

  What is *not* measured is sizes: every pad is a uniform 20 × 55 ft and every road 24 ft wide.
  Positions came off the plan; those two are defaults. The map says so on its face ("PAD SIZES NOT
  YET MEASURED") — remove that caption once real figures land. Closing it needs a few paced
  distances at the park or a measurement off the printed sheet at its stated 1" = 100'.

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
