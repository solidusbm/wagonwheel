-- Placeholder site inventory for Bandera Wagon Wheel RV Park.
-- The actual site count, numbering, and nightly rates are not published
-- anywhere online. These 12 sites are placeholders laid out as an
-- "Inner Ring" (closer to the office hub) and outer "Rim Row" -- swap in
-- the real site list, layout, and pricing before going live.
TRUNCATE reservations, sites RESTART IDENTITY CASCADE;

INSERT INTO sites (name, area, amp_service, pull_through, max_rig_length, pet_friendly, price_per_night_cents, sort_order) VALUES
  ('Inner Ring 1', 'Inner Ring', '30/50', true,  40, true, 5500, 1),
  ('Inner Ring 2', 'Inner Ring', '30/50', true,  40, true, 5500, 2),
  ('Inner Ring 3', 'Inner Ring', '50',    true,  45, true, 6000, 3),
  ('Inner Ring 4', 'Inner Ring', '50',    true,  45, true, 6000, 4),
  ('Inner Ring 5', 'Inner Ring', '30',    false, 32, true, 4800, 5),
  ('Inner Ring 6', 'Inner Ring', '30',    false, 32, true, 4800, 6),
  ('Rim Row 1',    'Rim Row',    '30',    false, 30, true, 4200, 7),
  ('Rim Row 2',    'Rim Row',    '30',    false, 30, true, 4200, 8),
  ('Rim Row 3',    'Rim Row',    '30/50', false, 35, true, 4500, 9),
  ('Rim Row 4',    'Rim Row',    '30/50', false, 35, true, 4500, 10),
  ('Rim Row 5',    'Rim Row',    '30',    false, 28, true, 4000, 11),
  ('Rim Row 6',    'Rim Row',    '30',    false, 28, true, 4000, 12);
