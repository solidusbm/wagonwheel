# Wagon Wheel RV Park

Booking + payments site for **Bandera Wagon Wheel RV Park** (325 Polly Peak Dr, Bandera, TX 78003).

Node/Express backend, PostgreSQL for reservations, Square for payments. This replaces the earlier chat prototype (static HTML, browser-storage "availability," a mocked checkout) with a real app: a database that actually prevents double-booking, and a server that talks to Square instead of faking it.

## Status / what's real vs. placeholder

- **Real:** address, phone, office hours, hookup type (30/50 amp, full hook-up), pet-friendly, site count/layout/numbering, and daily+weekly rates — pulled from the park's county-filed engineering plan and printed rate notes (see `db/seed.sql`). `/hours.html` covers office hours and the posted Rules & Guidelines. Gallery photos (`/admin` → Photos, and `/gallery.html`) are real photos of the property, not stock/illustrated placeholders — except two homepage tiles (Medina River, downtown Bandera) still marked as illustrated placeholders pending real shots.
- **Still placeholder:** per-site amp service and max rig length (the park's own list only gives 30/50 amp and "some 60' sites" park-wide, not a per-site breakdown) — enter real per-site values from `/admin` → Sites when the park provides them. A monthly rate for sites 1–11 was mentioned but not confirmed clearly enough to enter as a number; the weekly-rate tier (`price_per_week_cents`) is real and applies automatically to any 7+ night stay. Site 12 is a separate premium unit ($350/week, electric not included) with its own confirmed rate.
- **Amenities admin:** `/admin` has one unified "Amenities" panel — every amenity has two independent checkboxes, "Homepage" (shows in the homepage's "What every site includes" grid) and "Per-site" (toggleable on individual sites, like "Wired Ethernet"). An amenity can be either, both, or neither. Known amenities keep a curated icon on the homepage (`public/js/app.js` → `PARK_AMENITY_ICONS`); anything added later gets a generic checkmark icon.
- **Sites admin:** `/admin` → Sites edits each site's name, area/row, amp service, rig length, pull-through, daily/weekly rate, notes (shown to guests), active status, "permanently occupied" (a long-term resident not going through reservations — excluded from booking but still shown on the map as unavailable), and which per-site amenities apply.
- **Photos admin:** `/admin` → Photos — upload, caption, toggle "show on homepage," and delete. Stored as `BYTEA` in Postgres, not on disk (Render's free-tier filesystem doesn't persist across deploys). Every photo shows on `/gallery.html`; homepage-flagged ones also show on the homepage gallery section.
- **Content & style admin:** `/admin` → Content edits homepage/hours-page text directly (hero badge/subtitle, About heading + 3 paragraphs, hours intro — footer and detailed policy lists are still hardcoded, not yet extended to this). `/admin` → Styles holds named color-theme presets with an "Approved" curation checkbox and a "Set live" toggle (only one live at a time); seeded with the original look plus one unapproved draft using the real scanned logo and a lighter palette. **Known bug:** the hero section's SVG art has hardcoded dark colors and doesn't respond to style overrides, so a light style currently breaks hero readability — needs fixing before any light style goes live.
- **Guest application:** the booking form doubles as the park's paper "Application for Monthly RV Guests" — DOB, driver's license, spouse/co-applicant, additional occupants, vehicles, RV details, and pets, all optional and stored per-reservation (`reservations.application_details` JSONB), visible to `/admin` under each booking's Notes column. This is **one single application used for every booking** regardless of stay length — not a separate short-stay/long-stay form. The paper form's prior-residence/landlord-reference section and background-check questions were both struck out by the park on the original and are intentionally not collected here.
- **Payments:** wired to Square's real Payments API (not a mock). **Sandbox credentials are configured in Render and have been tested end-to-end with a real sandbox checkout.** Production credentials are a pre-launch step — see below.
- **Admin notifications:** when a booking is confirmed, an email fires to `ADMIN_EMAIL`. Without SMTP credentials configured it logs to the server console instead of sending, so it works out of the box in dev.
- **Admin view:** `/admin` lists pending/confirmed reservations and lets the office create, reschedule/reassign, or cancel a booking directly (phone-ins, walk-ins, corrections — no card is charged through this path). Protected by HTTP Basic Auth via `ADMIN_USERNAME`/`ADMIN_PASSWORD` — the route returns 503 until both are set. Reschedules and cancellations go through the same database exclusion constraint as guest bookings, so they can't create a double-booking either. **Currently still set to the weak placeholder `admin`/`admin` in Render's environment — change it before this goes live publicly; the server warns on startup if it's still a weak placeholder.**
- **"Danger zone" reseed:** `/admin` has a Danger Zone panel that force-reloads `sites`/`amenities`/`reservations` from `db/seed.sql` on an already-provisioned database (normal boot only seeds a completely empty `sites` table — see `server/lib/dbBootstrap.js`). Destructive, requires typing a confirmation phrase. Does **not** touch `photos`/`content_blocks`/`styles` — those seed independently and non-destructively on every boot via `db/seed-content.sql`.
- **Site listings show upcoming booked dates:** each site card on the booking page lists its other upcoming reservations (`GET /api/availability` returns a `bookedRanges` array per site), not just a yes/no flag for the dates you searched.
- **Site map:** reflects the park's real physical layout (a 2-way road loop around the office, Sites 1–2 as a small angled pair by the office, Sites 3–12 in two rows) pulled from the county-filed engineering plan — not an illustrative placeholder.
- **RoverPass / Hipcamp sync feed:** `GET /calendar/sites/:id.ics` is a public, read-only iCal feed of one site's booked date ranges (no guest details — just DTSTART/DTEND blocks). It exists so a third-party platform can *import* this app's availability and avoid offering an already-booked site. `/admin` lists each site's feed URL with a one-click copy button. This is the "push our bookings out" half of a sync; the "pull RoverPass/Hipcamp's bookings in" half needs real accounts on those platforms first (there's nothing to import yet), so it isn't built.
- **Push notifications:** `/admin` can subscribe a device to Web Push, so a booking confirmation fires a real system notification on Windows, Android, and iOS — supplementing, not replacing, the admin email. No native app or app-store account involved; it's the standard Push API + a service worker, using a self-generated VAPID key pair. Click "Enable on this device" in the Push notifications panel. **iOS caveat:** Safari only delivers push to a site added to the Home Screen first (Share → Add to Home Screen) — the admin panel detects this and shows the install instructions instead of a non-functional button. Without `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` set, push is skipped (email still sends).
- **Not built yet:** guest email confirmations (only the admin gets notified so far), refunds — cancelling a booking in `/admin` releases the site but does not call Square to refund a card that was actually charged — and the inbound half of the RoverPass/Hipcamp sync described above.

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
npm run seed       # loads the 12 real sites (rates + layout; still-placeholder amp/rig-length noted above)
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

## Remaining path to a real launch

From the original planning conversation, still open:

1. ~~Real site list, layout, and nightly/weekly rates from the park~~ — done, see `db/seed.sql`. Still open: per-site amp service/max rig length, and a confirmed monthly rate for sites 1–11.
2. ~~Square sandbox credentials + a working test checkout~~ — done, configured in Render and tested end-to-end. Still open: **production** Square credentials, then flip `SQUARE_ENVIRONMENT=production`.
3. **Change `ADMIN_USERNAME`/`ADMIN_PASSWORD`** from the local-dev placeholder (`admin`/`admin`) to a real username and a strong, unique password in Render's Environment tab. The server prints a startup warning every boot until this is done — `/admin` exposes guest names, emails, and phone numbers.
4. Hosting is already live (Render); still open: DNS pointed at the park's own domain (once registered) + SSL (automatic on Render once DNS is pointed).
5. Transactional email for confirmations (Postmark/SendGrid, or Square's own receipt emails) — guests currently only see an on-screen confirmation code.
6. A refund flow (cancelling in `/admin` releases the site but does not call Square to refund; nothing in this app calls Square's refund API yet).
7. ~~Some way for the park to see upcoming reservations~~ — done, see `/admin`.
8. Real per-site amp service / max rig length once the park provides them — enter from `/admin` → Sites, no code change needed.
9. Domain registration — the live app currently only has the Render-provided subdomain.

The `static-site` branch's `/todo/` page (https://solidusbm.github.io/wagonwheel/todo/) tracks this same checklist in a guest-friendly format kept in sync with this list.
