-- Defaults for admin-editable text and the baseline color style. Unlike db/seed.sql (which
-- TRUNCATEs and only runs when the sites table is completely empty), this file is safe to run
-- unconditionally on every boot -- ON CONFLICT DO NOTHING means it only ever fills in rows that
-- don't exist yet, never overwrites an edit made from /admin. See server/lib/dbBootstrap.js.

INSERT INTO content_blocks (key, section, label, value) VALUES
  ('hero_badge', 'Homepage — Hero', 'Badge text', 'New high-speed WiFi, park-wide'),
  ('hero_subtitle', 'Homepage — Hero', 'Subtitle', 'A rustic, family-run stop seven minutes from downtown Bandera — the Cowboy Capital of the World.'),
  ('about_heading', 'Homepage — About', 'Heading', 'Hill Country, without the drive'),
  ('about_paragraph_1', 'Homepage — About', 'Paragraph 1', 'Bandera Wagon Wheel RV Park sits just outside town in the heart of the Texas Hill Country — close enough that downtown Bandera''s shops, honky-tonks, and historic storefronts are a short drive away, far enough that the evenings stay quiet.'),
  ('about_paragraph_2', 'Homepage — About', 'Paragraph 2', 'It''s a small, family-run park: the managers live on site, so there''s almost always someone around to help. Sites are simple and well kept, with full hookups ready to go when you pull in. Bring the dog — the park welcomes pets as part of the family, and there''s a dog park (large and small) right on the property.'),
  ('about_paragraph_3', 'Homepage — About', 'Paragraph 3', 'On higher ground, on purpose: the whole property sits outside the FEMA 100-year floodplain. A hard rain in the Hill Country means a nice view of the Medina River running high — not a 2am scramble to hitch up and move your rig.'),
  ('hours_intro', 'Hours page', 'Intro line', 'Reservations can be made online 24/7 — these are the hours the office itself is staffed.')
ON CONFLICT (key) DO NOTHING;

-- Baseline style matching the site's original hardcoded palette, marked live so the switch to a
-- styles-driven theme is invisible until an admin actually picks a different one.
INSERT INTO styles (name, description, css_vars, approved, is_live, sort_order) VALUES
  ('Original — Dark Cowboy', 'The site''s original palette: dark parchment-on-charcoal with gold and rust accents.', '{}'::jsonb, true, true, 1)
ON CONFLICT (name) DO NOTHING;
