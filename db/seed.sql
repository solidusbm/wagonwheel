-- Real site inventory for Bandera Wagon Wheel RV Park, pulled from the county-filed
-- septic/site engineering plan (Mangold Engineering, drawing 100-7799) and the park's own
-- figures. Numbering (1-12) and the Front/Center/Back Row grouping match that plan.
--
-- Rates and per-site details were confirmed by the park on 2026-08-12 and 2026-08-14 and are no
-- longer estimates: $45/night and $210/week at sites 1-11, $50/night and $210/week at Site 12,
-- and every site is a 60 ft back-in with both 30 and 50 amp service.
--
-- NOTE this file only runs against a COMPLETELY EMPTY sites table. The live rows carry per-site
-- monthly rates the park entered by hand ($300-$650, varying by site) that are NOT reproduced
-- here -- $350 below is a sane starting figure for a fresh database, not what the park charges.
-- Site 12's premium standing is its metered electric, not a higher weekly rate.
TRUNCATE reservations, sites, amenities, site_amenities RESTART IDENTITY CASCADE;

-- Any rate column may be NULL, meaning "N/A -- not sold by that term" (a monthly-only site sets
-- nightly and weekly to NULL). Rates live here, not in schema.sql, because schema.sql runs on
-- every boot and would overwrite a rate the office had deliberately changed or cleared.
INSERT INTO sites (name, area, amp_service, pull_through, max_rig_length, pet_friendly, price_per_night_cents, price_per_week_cents, price_per_month_cents, notes, sort_order) VALUES
  ('Site 1',  'Front Row',  '30/50', false, 60, true, 4500, 21000, 35000, NULL, 1),
  ('Site 2',  'Front Row',  '30/50', false, 60, true, 4500, 21000, 35000, NULL, 2),
  ('Site 3',  'Center Row', '30/50', false, 60, true, 4500, 21000, 35000, NULL, 3),
  ('Site 4',  'Center Row', '30/50', false, 60, true, 4500, 21000, 35000, NULL, 4),
  ('Site 5',  'Center Row', '30/50', false, 60, true, 4500, 21000, 35000, NULL, 5),
  ('Site 6',  'Center Row', '30/50', false, 60, true, 4500, 21000, 35000, NULL, 6),
  ('Site 7',  'Center Row', '30/50', false, 60, true, 4500, 21000, 35000, NULL, 7),
  ('Site 8',  'Back Row',   '30/50', false, 60, true, 4500, 21000, 35000, NULL, 8),
  ('Site 9',  'Back Row',   '30/50', false, 60, true, 4500, 21000, 35000, NULL, 9),
  ('Site 10', 'Back Row',   '30/50', false, 60, true, 4500, 21000, 35000, NULL, 10),
  ('Site 11', 'Back Row',   '30/50', false, 60, true, 4500, 21000, 35000, NULL, 11),
  -- The note is shown to guests on the booking page, so it says what they need to know and not
  -- who used to live here. It was rewritten 2026-08-12: the old wording ("electric NOT included
  -- in the rate -- unlike sites 1-11") dated from when this was the park's only exception, and
  -- read as wrong once the monthly rate started excluding electric everywhere. What is still
  -- particular to Site 12 is that its NIGHTLY and WEEKLY rates exclude it too.
  ('Site 12', 'Back Row',   '30/50', false, 60, true, 5000, 21000, 35000,
    'Premium site. Electric is metered separately and settled at the office. At this site that applies to every rate, including nightly and weekly; at the other sites only the monthly rate excludes electric.', 12);

-- Unified amenity catalog. show_on_homepage puts an amenity in the homepage's "What every
-- site includes" grid; show_per_site makes it toggleable on individual sites from /admin.
-- "Wired Ethernet" is confirmed real but not yet mapped to specific sites -- the park said
-- "some sites" have it without saying which, so no site_amenities rows are seeded; toggle
-- it on per site from /admin once that's known.
INSERT INTO amenities (name, sort_order, show_on_homepage, show_per_site) VALUES
  ('Water hookup', 1, true, true),
  ('30/50 amp electric', 2, true, true),
  ('Wastewater hookup', 3, true, true),
  ('Pet friendly', 4, true, false),
  ('Management on-site', 5, true, false),
  ('Trash service', 6, true, true),
  ('New high-speed WiFi', 7, true, true),
  ('Laundry on site', 8, true, false),
  ('Keyless entry', 9, true, false),
  ('Showers', 10, true, false),
  ('Dog park — large & small', 11, true, false),
  ('10% military discount — active or retired', 12, true, false),
  ('Wired Ethernet', 13, false, true);

-- Editable text and style defaults live in db/seed-content.sql instead -- that file runs
-- unconditionally on every boot (safe, ON CONFLICT DO NOTHING), unlike this one which only
-- runs once against a completely empty sites table. See server/lib/dbBootstrap.js.
