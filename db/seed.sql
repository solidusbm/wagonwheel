-- Real site inventory for Bandera Wagon Wheel RV Park, pulled from the county-filed
-- septic/site engineering plan (Mangold Engineering, drawing 100-7799) and the park's
-- printed rate notes -- see wagonwheel-inbox 2026-07-27 uploads. Numbering (1-12) and the
-- Front/Center/Back Row grouping match that plan. Daily and weekly rates are confirmed;
-- per-site amp/pull-through/max-rig-length figures are NOT confirmed per site (the pamphlet
-- only says the park offers 30 and 50 amp service park-wide and is "big rig friendly" with
-- some 60' sites) -- left conservative/unset here rather than guessed.
TRUNCATE reservations, sites RESTART IDENTITY CASCADE;

INSERT INTO sites (name, area, amp_service, pull_through, max_rig_length, pet_friendly, price_per_night_cents, price_per_week_cents, sort_order) VALUES
  ('Site 1',  'Front Row',  '30/50', false, NULL, true, 4500, 21000, 1),
  ('Site 2',  'Front Row',  '30/50', false, NULL, true, 4500, 21000, 2),
  ('Site 3',  'Center Row', '30/50', false, NULL, true, 4500, 21000, 3),
  ('Site 4',  'Center Row', '30/50', false, NULL, true, 4500, 21000, 4),
  ('Site 5',  'Center Row', '30/50', false, NULL, true, 4500, 21000, 5),
  ('Site 6',  'Center Row', '30/50', false, NULL, true, 4500, 21000, 6),
  ('Site 7',  'Center Row', '30/50', false, NULL, true, 4500, 21000, 7),
  ('Site 8',  'Back Row',   '30/50', false, NULL, true, 4500, 21000, 8),
  ('Site 9',  'Back Row',   '30/50', false, NULL, true, 4500, 21000, 9),
  ('Site 10', 'Back Row',   '30/50', false, NULL, true, 4500, 21000, 10),
  ('Site 11', 'Back Row',   '30/50', false, NULL, true, 4500, 21000, 11),
  ('Site 12', 'Back Row',   '30/50', false, NULL, true, 4500, 21000, 12);
