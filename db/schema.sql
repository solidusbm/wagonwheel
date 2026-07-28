-- Wagon Wheel RV Park booking schema
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  amp_service TEXT NOT NULL,
  pull_through BOOLEAN NOT NULL DEFAULT false,
  max_rig_length INTEGER,
  pet_friendly BOOLEAN NOT NULL DEFAULT true,
  price_per_night_cents INTEGER NOT NULL,
  -- Nullable (not NOT NULL): lets this column be added to an already-deployed sites table
  -- via ALTER TABLE below without a backfill. quote() in pricing.js falls back to pure
  -- nightly pricing when it's null.
  price_per_week_cents INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  -- A site with a long-term resident who isn't going through the reservation system --
  -- distinct from `active`, which controls whether the site is shown at all. A permanently
  -- occupied site still shows on the map/site list (as unavailable), it just can never be
  -- booked, regardless of dates.
  permanently_occupied BOOLEAN NOT NULL DEFAULT false
);

-- CREATE TABLE IF NOT EXISTS above is a no-op against an already-provisioned database, so
-- these backfill any columns added after that table was first created (safe to re-run).
ALTER TABLE sites ADD COLUMN IF NOT EXISTS price_per_week_cents INTEGER;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS permanently_occupied BOOLEAN NOT NULL DEFAULT false;

-- Global, admin-managed amenity catalog (e.g. "Wired Ethernet") that can be toggled on a
-- per-site basis via site_amenities, separate from the fixed built-in site columns above
-- (amp_service, pull_through, etc.) which the park may not add to over time the way it adds
-- amenities.
CREATE TABLE IF NOT EXISTS amenities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS site_amenities (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  amenity_id INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  PRIMARY KEY (site_id, amenity_id)
);

-- Park-wide amenities shown in the homepage's "What every site includes" grid (water
-- hookup, WiFi, dog park, military discount, ...). Separate from `amenities` above, which
-- are per-site toggles (e.g. one site having Wired Ethernet) rather than park-wide features.
CREATE TABLE IF NOT EXISTS park_amenities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  reservation_code TEXT NOT NULL UNIQUE,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT,
  num_guests INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  -- Extended intake for long (monthly) stays: DOB, driver's license, spouse/co-applicant,
  -- additional occupants, vehicle & RV details, and pet info -- mirrors the park's paper
  -- "Application for Monthly RV Guests" minus the prior-residence and background-check
  -- sections, which the park struck from that form. Null for ordinary nightly/weekly bookings.
  application_details JSONB,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  stay_range DATERANGE GENERATED ALWAYS AS (daterange(check_in, check_out, '[)')) STORED,
  subtotal_cents INTEGER NOT NULL,
  booking_fee_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  square_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out > check_in),
  -- Prevents two overlapping pending/confirmed reservations on the same site
  -- at the database level, so a race between two simultaneous bookings can't
  -- double-book a site regardless of what the application code does.
  EXCLUDE USING gist (site_id WITH =, stay_range WITH &&) WHERE (status IN ('pending', 'confirmed'))
);

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS application_details JSONB;

CREATE INDEX IF NOT EXISTS idx_reservations_site ON reservations(site_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);

-- One row per admin device/browser subscribed to push notifications (a park
-- manager checking bookings from a Windows desktop, an Android phone, and an
-- iPhone all gets three rows). Invalid/expired subscriptions are pruned when
-- a push send comes back 404/410 from the browser's push service.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
