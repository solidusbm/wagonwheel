# Wagon Wheel RV Park

Booking + payments site for **Bandera Wagon Wheel RV Park** (325 Polly Peak Dr, Bandera, TX 78003).

Node/Express backend, PostgreSQL for reservations, Square for payments. This replaces the earlier chat prototype (static HTML, browser-storage "availability," a mocked checkout) with a real app: a database that actually prevents double-booking, and a server that talks to Square instead of faking it.

## Status / what's real vs. placeholder

- **Real:** address, phone, office hours, hookup type (30/50 amp park-wide, full hook-up), pet-friendly, site count/layout/numbering, and nightly/weekly/monthly rates — pulled from the park's county-filed engineering plan and confirmed by the park (see `db/seed.sql` and `CLAUDE.md` → "Data model notes"). `/hours.html` and `/monthly-stays.html` cover office hours, rates, and the posted Rules & Guidelines. Gallery photos (`/admin` → Photos, and `/gallery.html`) are real photos from an on-site shoot — there are no stock or illustrated placeholders left anywhere on the site (including the homepage's Nearby cards, which are plain text, not images).
- **Settled, not placeholder:** amp service is 30/50 park-wide, not per-site (the admin form no longer even has a per-site amp field). Every site's max rig length is a confirmed 60 ft. Real per-site monthly rates are entered and vary, $300–$650 depending on the site. Seven of the twelve sites are permanently occupied by long-term residents and excluded from booking; five are bookable at any given time. See `CLAUDE.md` for the full breakdown.
- **Amenities admin:** `/admin` has one unified "Amenities" panel — every amenity has two independent checkboxes, "Homepage" (shows in the homepage's "What every site includes" grid) and "Per-site" (toggleable on individual sites, like "Wired Ethernet"). An amenity can be either, both, or neither. Known amenities keep a curated icon on the homepage (`public/js/app.js` → `PARK_AMENITY_ICONS`); anything added later gets a generic checkmark icon.
- **Sites admin:** `/admin` → Sites edits each site's name, area/row, rig length, pull-through, nightly/weekly/monthly rate, notes (shown to guests), active status, "permanently occupied" (a long-term resident not going through reservations — excluded from booking but still shown on the map as unavailable), which per-site amenities apply, and which photos represent it. Amp service is not on this form — see above.
- **Photos admin:** `/admin` → Photos — upload, caption, toggle "show on homepage," and delete. Stored as `BYTEA` in Postgres, not on disk (the container's own filesystem doesn't persist across deploys). Every photo shows on `/gallery.html`; homepage-flagged ones also show on the homepage gallery section, in an order set from `/admin` → Photos.
- **Content admin:** `/admin` → Content edits homepage/hours-page text directly (hero badge/subtitle, About heading + 3 paragraphs, hours intro — footer and detailed policy lists are still hardcoded, not yet extended to this). The admin color-theme switcher ("Styles" panel) was removed. The live site's actual look is the light "Light Rustic" palette baked directly into `public/css/style.css` since 2026-08-12 — the `styles` table's "Dark Cowboy" row is now just a vestigial label with no color overrides (see `CLAUDE.md` → "Theming"), so despite the name, nothing on the live site is dark.
- **Admin layout:** every section below Reservations (Social posts, Sites, Photos, Review requests, Amenities, Content, Park map, Search & sharing, RoverPass/Hipcamp sync, Booking alert email, Push notifications) is a collapsible `<details>`, closed by default — click a heading to expand it. There is no "Danger zone" reseed panel — it was removed 2026-08-14 (see below).
- **Guest application:** the booking form doubles as the park's paper "Application for Monthly RV Guests" — DOB, driver's license, spouse/co-applicant, additional occupants, vehicles, RV details, and pets, all optional and stored per-reservation (`reservations.application_details` JSONB), visible to `/admin` under each booking's Notes column and printable from `/admin/application.html`. This is **one single application used for every booking** regardless of stay length — not a separate short-stay/long-stay form. The paper form's prior-residence/landlord-reference section and background-check questions were both struck out by the park on the original and are intentionally not collected here.
- **Payments:** wired to Square's real Payments API. **Production credentials are live** (since 2026-08-11) and have been verified end-to-end with a real card, charged and refunded (reservation `8YLQCZ5`). Sandbox is only relevant for local development — see "Local setup" below.
- **Booking notifications:** when a booking is confirmed, an admin alert email fires to `ADMIN_EMAIL` (a comma-separated recipient list), and **the guest also gets their own confirmation email** — site, dates, arrival/departure times, the office-registration reminder, and their specific cancellation terms (`server/lib/email.js`). `/admin` → Booking alert email can send a test admin alert and a sample guest-confirmation preview without taking a real booking. `SMTP_FROM` defaults to `SMTP_USER` — Gmail and most relays reject a From that isn't the authenticated mailbox.
- **Admin view:** `/admin` lists pending/confirmed reservations and lets the office create, reschedule/reassign, or cancel a booking directly (phone-ins, walk-ins, corrections — no card is charged through this path). Protected by a signed-session-cookie login at `/admin/login`, using `ADMIN_USERNAME`/`ADMIN_PASSWORD` set as Coolify environment variables (not in this repo). It was HTTP Basic Auth until 2026-08-28; Basic credentials are still accepted so nothing that had them breaks, but none are ever requested. Reschedules and cancellations go through the same database exclusion constraint as guest bookings, so they can't create a double-booking either. **The weak `admin`/`admin` placeholder was rotated out by the park on 2026-08-11** — this repo and Claude do not hold the current credentials.
- **Reseeding a live database is intentionally not possible.** The old "Danger zone" panel that force-reloaded `sites`/`amenities`/`reservations` from `db/seed.sql` was removed 2026-08-14, once the park's real data (rates, rig lengths, amenity/photo assignments) existed nowhere else and a reseed would have destroyed it with no way to restore it. See `CLAUDE.md` → "Database bootstrapping" for how to correct live data safely instead.
- **Site listings show upcoming booked dates:** each site card on the booking page lists its other upcoming reservations (`GET /api/availability` returns a `bookedRanges` array per site), not just a yes/no flag for the dates you searched.
- **Site map:** reflects the park's real physical layout, pulled from the county-filed septic/engineering plan — not an illustrative placeholder. It's a ladder of roads, not a loop: a spine down the east side, a leg down the west side, and three connecting rungs, with Sites 1–2 as a small angled pair north of the top rung. Editable from `/admin` → Park map (added 2026-08-17); pad and road sizes are still uniform defaults, not yet measured on site — see `CLAUDE.md` for the full topology notes.
- **RoverPass / Hipcamp sync feed:** `GET /calendar/sites/:id.ics` is a public, read-only iCal feed of one site's booked date ranges (no guest details — just DTSTART/DTEND blocks). It exists so a third-party platform can *import* this app's availability and avoid offering an already-booked site. `/admin` lists each site's feed URL with a one-click copy button. This is the "push our bookings out" half of a sync; the "pull RoverPass/Hipcamp's bookings in" half needs real accounts on those platforms first (there's nothing to import yet), so it isn't built.
- **Push notifications:** `/admin` can subscribe a device to Web Push, so a booking confirmation fires a real system notification on Windows, Android, and iOS — supplementing, not replacing, the admin email. No native app or app-store account involved; it's the standard Push API + a service worker, using a self-generated VAPID key pair. Click "Enable on this device" in the Push notifications panel. **iOS caveat:** Safari only delivers push to a site added to the Home Screen first (Share → Add to Home Screen) — the admin panel detects this and shows the install instructions instead of a non-functional button. Without `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` set, push is skipped (email still sends).
- **Findability:** `/admin` → Search & sharing controls per-page search-result descriptions, the Google Search Console verification tag, and the photo used when a link is shared to Facebook/social — see `CLAUDE.md` and `docs/README.md`. `/admin` → Review requests sends a Google-review ask a set number of days after checkout, and `/admin` → Social posts drafts (but never auto-posts) Facebook/Google post text from the park's own live data.
- **Not built yet:** the inbound half of the RoverPass/Hipcamp sync described above (pulling their bookings back into this app needs real accounts on those platforms first — nothing to import yet). Guest email confirmations and a refund flow are both built, contrary to what earlier drafts of this README said — see the Payments and Booking notifications bullets above.

## Stack

- Node.js + Express (`server/`)
- PostgreSQL, with an **exclusion constraint** on `(site_id, date range)` that makes double-booking a site impossible at the database level, not just something the app tries to check
- Vanilla HTML/CSS/JS frontend (`public/`), Square Web Payments SDK loaded client-side
- Square Payments API for the actual charge (sandbox until you flip `SQUARE_ENVIRONMENT=production`)

## Local setup

### 1. Database

You need a Postgres instance reachable via `DATABASE_URL`. Locally:

```bash
createuser wagonwheel --pwprompt --createdb   # or use an existing role
createdb -O wagonwheel wagonwheel
```

### 2. Environment

```bash
cp .env.example .env
```

Fill in `DATABASE_URL` and, when you have them, your Square sandbox values from the [Square Developer Dashboard](https://developer.squareup.com/apps):

- `SQUARE_APPLICATION_ID` — sandbox application ID (safe to expose to the browser)
- `SQUARE_LOCATION_ID` — sandbox location ID
- `SQUARE_ACCESS_TOKEN` — sandbox **access token** — server-side only, never commit this or send it to the frontend

Without these three set, the site still runs — availability and browsing work — but checkout will show "Square is not configured yet" instead of a card form.

### 3. Install, migrate, seed

```bash
npm install
npm run migrate   # applies db/schema.sql
npm run seed       # loads the 12 real sites (rates, layout, amenities)
```

### 4. Run

```bash
npm run dev
```

Visit `http://localhost:3000`.

## Testing payments

Use Square's [sandbox test card numbers](https://developer.squareup.com/docs/testing/test-values) — e.g. `4111 1111 1111 1111` with any future expiry/CVV — against your sandbox credentials. Nothing is charged for real until `SQUARE_ACCESS_TOKEN`/`SQUARE_ENVIRONMENT` point at production.

## How double-booking is prevented

`reservations` has a generated `stay_range daterange` column and a Postgres `EXCLUDE USING gist` constraint keyed on `(site_id, stay_range)` for any reservation in `pending` or `confirmed` status. Two requests racing to book the same site/dates can't both succeed — the database rejects the second `INSERT` outright (error code `23P01`), which the reservation route turns into a `409`. The booking flow inserts the reservation as `pending` *before* charging the card, so a lost race never touches Square, and a failed charge flips the row to `cancelled`, which releases the hold.

## Current status

This is not a staging build — it's the **live product** for a real client, at
https://banderawagonwheelrv.com/. Production Square credentials, real park data (rates, rig
lengths, amenities, the site map), guest and admin email, refunds, SPF/DMARC, and the domain
itself are all live; nothing above is still "pending." Hosting moved off Render entirely on
2026-08-11 — see `CLAUDE.md` → "What this branch is" for the current Coolify/Cloudflare setup.

What's genuinely still open is tracked in `CLAUDE.md` → "Known unresolved," not as a numbered
launch checklist here — a static list like the one this section used to be is exactly what goes
stale fastest on a live app. The `static-site` branch's `/todo/` page
(https://solidusbm.github.io/wagonwheel/todo/) mirrors the same open items in a guest-friendly
format.
