# Wagon Wheel RV Park

Booking + payments site for **Bandera Wagon Wheel RV Park** (325 Polly Peak Dr, Bandera, TX 78003).

Node/Express backend, PostgreSQL for reservations, Square for payments. This replaces the earlier chat prototype (static HTML, browser-storage "availability," a mocked checkout) with a real app: a database that actually prevents double-booking, and a server that talks to Square instead of faking it.

## Status / what's real vs. placeholder

- **Real:** address, phone, office hours, hookup type (30/50 amp, full hook-up), pet-friendly — pulled from what's publicly listed for the park.
- **Placeholder, needs your input:** the 14 sites (names, "Inner Ring"/"Rim Row" grouping, nightly rates in `db/seed.sql`). Nobody publishes the actual site list or rates — swap in the real ones before this goes live.
- **Payments:** wired to Square's real Payments API (not a mock), but requires your Square **sandbox** credentials to actually run a charge. See setup below.
- **Not built yet:** email confirmations, an admin view for the park to manage reservations/cancellations. The confirmation screen and lookup-by-code (`GET /api/reservations/:code`) are the receipt for now.

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
npm run seed       # loads the 14 placeholder sites
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

1. Real site list, layout, and nightly rates from the park
2. Production Square credentials + going live with `SQUARE_ENVIRONMENT=production`
3. Hosting (backend: Render/Railway/Fly/VPS; this app serves its own frontend, so one deploy target is enough) + DNS pointed at the park's domain + SSL (automatic on most of those hosts)
4. Transactional email for confirmations (Postmark/SendGrid, or Square's own receipt emails)
5. A cancellation/refund flow (Square supports refunds via API or dashboard; nothing in this app calls it yet)
6. Some way for the park to see upcoming reservations (currently only queryable by reservation code or directly in the database)
