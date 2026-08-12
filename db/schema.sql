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
-- Monthly rate. The park caps any stay at this figure PER MONTH: a month-long stay never
-- costs more than one month, two months never more than two, and so on. Placeholder $350 set
-- 2026-08-11 at the user's direction pending the real per-site figures.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS price_per_month_cents INTEGER;
-- Refund bookkeeping. monthly_rate_applied is captured at booking time because it decides
-- which cancellation fee applies -- a later rate change must not alter what a guest was told.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS monthly_rate_applied BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS square_refund_id TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS refunded_cents INTEGER;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancellation_fee_cents INTEGER;
UPDATE sites SET price_per_month_cents = 35000 WHERE price_per_month_cents IS NULL;

-- Unified, admin-managed amenity catalog. Each amenity independently controls where it
-- shows: show_on_homepage puts it in the homepage's "What every site includes" grid;
-- show_per_site makes it available to toggle on individual sites (via site_amenities) --
-- e.g. "Wired Ethernet" (per-site only), "Dog park" (homepage only), or both.
CREATE TABLE IF NOT EXISTS amenities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  show_on_homepage BOOLEAN NOT NULL DEFAULT false,
  show_per_site BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE amenities ADD COLUMN IF NOT EXISTS show_on_homepage BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE amenities ADD COLUMN IF NOT EXISTS show_per_site BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS site_amenities (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  amenity_id INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  PRIMARY KEY (site_id, amenity_id)
);

-- One-time migration: the homepage grid used to be a separate park_amenities table.
-- Fold any existing rows into the unified amenities catalog above, then retire it.
-- Safe to re-run -- a no-op once park_amenities no longer exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'park_amenities') THEN
    INSERT INTO amenities (name, sort_order, active, show_on_homepage, show_per_site)
    SELECT name, sort_order, active, true, false FROM park_amenities
    ON CONFLICT (name) DO UPDATE SET show_on_homepage = true;
    DROP TABLE park_amenities;
  END IF;
END $$;

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

-- Admin-uploaded photos, stored directly in Postgres (BYTEA) rather than on local disk --
-- Render's free web-service filesystem is ephemeral and wiped on every deploy/restart, so
-- anything written to disk at runtime wouldn't survive. show_on_homepage controls whether a
-- photo appears in the homepage gallery; every active photo (homepage or not) shows on the
-- full /gallery.html page. Kept deliberately size-capped at upload time (server/routes/
-- photos.js) to avoid ballooning the database's 1GB free-tier storage limit.
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  caption TEXT,
  mime_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  show_on_homepage BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Editable text content. Every key referenced by public/js/content.js gets a row here; the
-- frontend fetches this map on load and fills in any element with a matching data-content-key
-- attribute. `label` and `section` are just for grouping/labeling in the admin UI -- the `key`
-- is the only thing the frontend actually looks up.
CREATE TABLE IF NOT EXISTS content_blocks (
  key TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Named color-theme presets, switchable from /admin without a code change or redeploy. Only
-- fields present in css_vars are overridden -- anything omitted falls back to the base
-- stylesheet's defaults, so a style can tweak just a couple of colors or override the whole
-- palette. approved is a curation flag (sort/dismiss candidates); is_live controls which single
-- style (if any) is actually applied on the public site -- enforced as at-most-one-true by the
-- application layer (server/routes/admin.js), not a DB constraint.
CREATE TABLE IF NOT EXISTS styles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  css_vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  logo_url TEXT,
  approved BOOLEAN NOT NULL DEFAULT false,
  is_live BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approval curation for the static-site branch's 36-page style gallery (v1-v12 plus two
-- alternates each) -- distinct from the `styles` table above, which holds real switchable
-- color-theme presets for the live booking site. This table is just a checklist: slug is the
-- page's folder name (e.g. "v1", "v1b"), a missing row means "not reviewed yet". Read from
-- GitHub Pages via GET /api/style-gallery-approvals (public, CORS-enabled); written via
-- /api/admin/style-gallery-approvals (Basic Auth required).
-- approved and dismissed are mutually exclusive -- a slug is "approved" (favorite), "dismissed"
-- (explicitly rejected, archived), or neither (still under review, the default). Enforced in the
-- application layer (server/routes/admin.js), not a DB constraint: setting one true clears the
-- other. Un-approving something just clears approved back to false -- it does NOT set dismissed,
-- so it lands back in "needs review", not the archive. Dismissing is a separate explicit action.
CREATE TABLE IF NOT EXISTS style_gallery_approvals (
  slug TEXT PRIMARY KEY,
  approved BOOLEAN NOT NULL DEFAULT false,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE style_gallery_approvals ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE style_gallery_approvals ADD COLUMN IF NOT EXISTS dismissed BOOLEAN NOT NULL DEFAULT false;
