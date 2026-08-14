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

## Site photos and the booking list

- **Sites are grouped by availability, not by row.** Front/Center/Back Row meant scanning three
  headings for the handful bookable on those dates. The row moved onto the card
  (`.site-area-label`); the map above still shows the real geography, which is where it matters.
  The "not available" group is a collapsed `<details>` — shown, but not pushing bookable sites off
  screen — and opens by default only when nothing is available. `/api/availability` already returns
  sort_order, so don't sort by name: "Site 10" sorts before "Site 2".
- **Photos are assigned per site** through a `site_photos` join table (not a column on `photos`) —
  one photo legitimately covers several sites, as the row-level shots do. Assign them in `/admin`
  → Sites → Edit → Photos. **Selection order is the sort order**, and the first is what a guest
  sees; the picker labels it "Shown" so that isn't a guess.
- **`/photos/:id/image?w=320|640` serves thumbnails.** Twelve full-size shots is several megabytes
  and a lot of these guests are on cellular. Widths are a fixed allowlist because the width is part
  of the cache key — leaving it open lets anyone fill the cache with `?w=1..1600`. Cached in memory,
  which is safe because a photo's bytes never change (upload inserts, delete removes).
- **The card's photo MUST call `stopPropagation()`.** The whole card is a click target that selects
  the site and jumps to payment — without it, tapping a picture to look at it books that site.
  Verified by test, not by eye. Any new control added inside a site card needs the same treatment.
- A site with no photo gets a **placeholder tile of the same aspect**, so cards in a row line up and
  the gap reads as deliberate. Not all twelve sites are photographed.

## The guest application

The booking form doubles as the park's paper application. Three things render that data and they
must not disagree, so the fields are **defined once** in `admin/js/application-schema.js`:

- the booking form (`public/index.html`) — still hand-written HTML, it predates the schema;
- the editor in `/admin` (the **Application** button on a reservation row);
- the printable sheet (`/admin/application.html?code=XXXX`).

Adding a field means adding one entry to `APPLICATION_SECTIONS`; the editor and the print sheet
pick it up with no other change. If the public form is ever regenerated, generate it from there too.

- **Editing goes through `PUT /api/admin/reservations/:code/application`, not the reservation
  PATCH.** That PATCH re-prices the stay from the site and dates on every call, and fixing a typo
  in a licence plate must not touch what someone was charged — a re-quote can flip
  `monthly_rate_applied`, and with it the cancellation fee they were quoted.
- The client sends the record through `normalise()` first, so an application edited by the office
  is byte-for-byte the shape `buildApplication()` produces: blanks become `null`, empty rows are
  dropped, an unnamed co-applicant becomes `null` rather than an object of nulls.
- **The print sheet prints every field whether or not it has a value**, blanks as rules to write
  on, plus spare rows for occupants/vehicles/pets. That's the point of it: the online form doesn't
  ask for everything the paper one did (it never asks for a co-applicant's licence *state*), and
  guests skip optional sections. A booking with no application at all still prints a full blank
  form to hand over at check-in.
- `GET /api/admin/reservations/:code` returns a booking **whatever its status** — the list route
  is pending/confirmed only, but a cancelled booking still needs to be printable.
- The application is **not** monthly-only. It was once gated at 28+ nights; that split was
  deliberately removed. Don't reintroduce "monthly application" wording.
- `.app-row` belongs to the read-only digest in the Notes column (styled in `public/css/style.css`);
  the editor's rows are `.app-edit-row`. They collided once — the admin's inline CSS loads later
  and turned the digest into flex rows.

## Theming — the light palette is the stylesheet's default

`public/css/style.css` `:root` **is** the light theme ("Light Rustic"), taken from the style
gallery's **v2** page on the `static-site` branch (`v2/css/style.css`) — read out of the file, not
eyeballed. Before 2026-08-12 the stylesheet was still the *dark* palette and the light values
arrived only at runtime, via `content.js` fetching `/api/live-style` and injecting a `<style>` tag
after first paint. Two consequences, both fixed by moving the palette into the stylesheet:

- every page painted dark for **~141ms** and then flipped (measured on the live site);
- **`/admin` stayed dark permanently**, because it never loads `content.js`.

The `styles` table row still exists and still overrides — it now sets the same values it already
had. If you change the palette, change **both**, or the DB will quietly repaint the page.

**Rules that follow from this — don't undo them:**

- **Illustrations use `--hero-*` tokens, never literal hex.** The homepage hero and the two
  placeholder figures hardcoded the dark palette's hexes, which is exactly why the artwork stayed
  night-time when the site went light. The 8 hero tokens are a warm daytime sky, from v2.
- **Two deliberate departures from v2's palette**, both for contrast, both measured:
  `--parchment-dim` is `#6b5844` (v2's `#7a6650` is 4.16:1, under AA), and the golds are shifted
  one step darker — `--gold: #87590f`, `--gold-bright: #a9721f` (v2's `#a9721f`/`#c98a2b` measure
  3.50:1 and 2.23:1 as text). Re-syncing from the gallery must not reintroduce these.
- **The gold semantics invert on a light theme.** On dark, "bright" meant more contrast; here it
  means less. `--gold` is the text-safe end (4.6–5.8:1 on every surface); `--gold-bright` is for
  decoration and text at 24px or larger **only**. Links and small labels use `--gold`.
- **Measure, don't look.** Every contrast bug in this file was invisible to the eye and obvious to
  a calculation. After any palette change, walk the homepage, both booking steps and `/admin` with
  a contrast sweep (compare each text node's computed colour against its nearest opaque ancestor
  background; 4.5:1, or 3:1 at ≥24px). The last sweep found 11 failures across guest pages and
  `/admin`, including the order-summary **total**.
- Watch specificity when adding a rule inside `.order-summary`: `.order-summary p` beat
  `.summary-note` and silently repainted a callout in the dim colour at 2.30:1.

## Asset caching — why a deploy can half-land

Cloudflare serves JS/CSS with `max-age=14400` (four hours), and that Browser Cache TTL lives in the
**client's** Cloudflare account, so it can't be changed from here. `server/lib/assetVersion.js`
therefore rewrites asset URLs in the HTML with a content hash (`?v=<sha1>`), and sends the HTML
itself `no-cache`. A changed file becomes a different URL, so no cache can serve the old one.

**The failure this prevents is silent and nasty.** Until 2026-08-12 the rewrite pattern only matched
`/css/*` and `/js/*`, while the admin's own scripts are requested as `/admin/js/*.js` — so
`admin.js` was never versioned. A deploy then served **fresh HTML against a four-hour-old script**:
the old `admin.js` looked for a form field the new HTML no longer had, threw
`TypeError: Cannot set properties of null`, and every Edit button on the Sites table silently did
nothing. Nothing in the logs, nothing on screen.

If you add an asset under a new URL prefix you must update **both**: the `VERSIONED` regex in
`lib/assetVersion.js` and `resolveAsset()` in `index.js` (which maps a URL to the file that serves
it — note `/admin/*` resolves into `admin/` while `/css/*` resolves into `public/`, even on the
admin page). Getting either wrong doesn't error; the asset just quietly stops being stamped.

To check, load a page and confirm every `href`/`src` for a local css/js carries a `?v=`.

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

## Privacy

`/privacy.html` went up 2026-08-14, linked from every footer and from the booking form itself. It
is written to describe **only what the app actually does** — verified before writing, not assumed:
no cookies, no analytics, no trackers; card details go straight to Square and never reach this
server; the public iCal feeds carry dates only. If you change what is collected, stored, or shared,
that page has to change with it, or it becomes a false statement on a live commercial site.

Two things it deliberately does **not** promise: automatic deletion after N months (nothing in the
app does that), or a fixed retention period. It says the park keeps records for its accounts and
deletes on request, which is true and enforceable by a person.

The guest application is framed to guests as **pre-filling, not paperwork** — every field below the
contact details is genuinely optional (none carry `required`), and the office finishes it at
check-in using the printable sheet. Keep those three things consistent: the form's note, the
privacy page, and the fields actually being optional.

## Settled — don't "fix" these back

- **Rates are capped at the monthly rate, PER MONTH.** `quote()` bills whole months at
  `price_per_month_cents` and the remainder the normal weekly/nightly way, never charging more
  than one further month for the remainder. A single flat ceiling on the whole stay would make a
  year cost the same as a fortnight -- don't "simplify" it to that. Set by the user 2026-08-11.
  **The real per-site monthly rates are now in (2026-08-12)** and they vary: $300 (Site 7), $325
  (Sites 4, 5, 10), $350 (most), $650 (Site 2, which carries the storage/cover/carport/slab
  extras). The $350 placeholder is gone -- don't reintroduce a uniform figure. At $350 the cap
  bites at about 11 nights, so an 11-night stay and a 29-night stay cost the same there.
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
- **Electric is NOT included in the monthly rate.** It's read at the meter and settled separately
  at the office; nightly and weekly rates do include it. Set by the user 2026-08-12. This keys off
  the same `monthlyRateApplied` flag as the cancellation terms, so **a short stay that merely
  reached the cap is on monthly terms for electric too** — explicitly confirmed, not an accident.
  It is stated in five places and they must not drift: the site card (`siteRates()`), the order
  summary before payment (`renderOrderSummary()`), the guest confirmation email
  (`ELECTRIC_LEAD`/`ELECTRIC_DETAIL` in `server/lib/email.js`), `/hours`, and the `/admin` site
  editor's hint. The `sendSampleGuestEmail()` fixture is a **monthly** booking on purpose — that
  version of the email is a superset, carrying both the electric notice and the $100 wording.
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

Most of what used to sit here was answered by the park on **2026-08-12** and entered directly in
`/admin` — real per-site monthly rates, max rig length, and the per-site amenity assignments
(which also gained Privacy Fence, Private Storage, RV Cover, Carport and Concrete Slab). Amp
service was settled earlier — 30 and 50 at every site. Settled on **2026-08-14**: every site is
**60 ft** (Sites 2 and 12 had been left blank), and **Site 12's weekly rate is $210**, not $350 — it
had matched its own monthly rate, so a month there cost exactly what a week cost. Site 12's premium
standing is its metered electric, not a higher weekly rate.

What's still open:

- **Site 10 is the only site with no amenities assigned** — every other site carries Wired
  Ethernet. Could be deliberate; worth confirming rather than assuming it was missed.

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
