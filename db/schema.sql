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
