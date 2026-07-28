-- Real site inventory for Bandera Wagon Wheel RV Park, pulled from the county-filed
-- septic/site engineering plan (Mangold Engineering, drawing 100-7799) and the park's
-- printed rate notes -- see wagonwheel-inbox 2026-07-27 uploads. Numbering (1-12) and the
-- Front/Center/Back Row grouping match that plan. Daily/weekly rates for sites 1-11 are
-- confirmed ($45/night incl. electric, $210/week). Site 12 is a separate premium site
-- (formerly long-term-occupied by "Brady") at a confirmed $350/week with electric NOT
-- included; its nightly rate ($50) is derived arithmetically (350/7) since only a weekly
-- figure was given -- not itself confirmed as a nightly offering. Per-site amp/pull-through/
-- max-rig-length figures are NOT confirmed per site (the pamphlet only says the park offers
-- 30 and 50 amp service park-wide and is "big rig friendly" with some 60' sites) -- left
-- unset here rather than guessed.
TRUNCATE reservations, sites, amenities, site_amenities, park_amenities RESTART IDENTITY CASCADE;

INSERT INTO sites (name, area, amp_service, pull_through, max_rig_length, pet_friendly, price_per_night_cents, price_per_week_cents, notes, sort_order) VALUES
  ('Site 1',  'Front Row',  '30/50', false, NULL, true, 4500, 21000, NULL, 1),
  ('Site 2',  'Front Row',  '30/50', false, NULL, true, 4500, 21000, NULL, 2),
  ('Site 3',  'Center Row', '30/50', false, NULL, true, 4500, 21000, NULL, 3),
  ('Site 4',  'Center Row', '30/50', false, NULL, true, 4500, 21000, NULL, 4),
  ('Site 5',  'Center Row', '30/50', false, NULL, true, 4500, 21000, NULL, 5),
  ('Site 6',  'Center Row', '30/50', false, NULL, true, 4500, 21000, NULL, 6),
  ('Site 7',  'Center Row', '30/50', false, NULL, true, 4500, 21000, NULL, 7),
  ('Site 8',  'Back Row',   '30/50', false, NULL, true, 4500, 21000, NULL, 8),
  ('Site 9',  'Back Row',   '30/50', false, NULL, true, 4500, 21000, NULL, 9),
  ('Site 10', 'Back Row',   '30/50', false, NULL, true, 4500, 21000, NULL, 10),
  ('Site 11', 'Back Row',   '30/50', false, NULL, true, 4500, 21000, NULL, 11),
  ('Site 12', 'Back Row',   '30/50', false, NULL, true, 5000, 35000,
    'Premium site (formerly "Brady''s"). Electric is metered separately and NOT included in the rate -- unlike sites 1-11.', 12);

-- Global amenity catalog. Confirmed real but not yet mapped to specific sites -- the park
-- said "some sites" have wired Ethernet without saying which, so no site_amenities rows are
-- seeded; toggle them on per site from /admin once that's known.
INSERT INTO amenities (name, sort_order) VALUES
  ('Wired Ethernet', 1);

-- Park-wide amenities shown in the homepage's "What every site includes" grid. Seeded with
-- what's currently known real -- add/remove/reorder from /admin, no code change needed.
INSERT INTO park_amenities (name, sort_order) VALUES
  ('Water hookup', 1),
  ('30/50 amp electric', 2),
  ('Wastewater hookup', 3),
  ('Pet friendly', 4),
  ('Management on-site', 5),
  ('Trash service', 6),
  ('New high-speed WiFi', 7),
  ('Laundry on site', 8),
  ('Keyless entry', 9),
  ('Showers', 10),
  ('Dog park — large & small', 11),
  ('10% military discount — active or retired', 12);
