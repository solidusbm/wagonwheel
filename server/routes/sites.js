import { Router } from "express";
import { pool } from "../db.js";
import { quote, isPriceable } from "../lib/pricing.js";

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Per-site custom amenities (e.g. "Wired Ethernet"), toggled from /admin against the unified
// amenities catalog -- separate from the fixed columns below (amp_service, pull_through, ...).
// show_per_site filters out homepage-only amenities even if one somehow got assigned to a
// site (e.g. via a stale API call) before its show_per_site flag was toggled off.
const AMENITIES_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(a.name ORDER BY a.sort_order), '[]'::json) AS names
    FROM site_amenities sa
    JOIN amenities a ON a.id = sa.amenity_id AND a.active = true AND a.show_per_site = true
    WHERE sa.site_id = s.id
  ) am ON true
`;

router.get("/sites", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.area, s.amp_service, s.pull_through, s.max_rig_length, s.pet_friendly,
              s.price_per_night_cents, s.price_per_week_cents, s.price_per_month_cents, s.notes, s.permanently_occupied, am.names AS amenities
       FROM sites s
       ${AMENITIES_JOIN}
       WHERE s.active = true ORDER BY s.sort_order`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/availability", async (req, res, next) => {
  const { checkIn, checkOut } = req.query;
  if (!DATE_RE.test(checkIn ?? "") || !DATE_RE.test(checkOut ?? "")) {
    return res.status(400).json({ error: "checkIn and checkOut must be YYYY-MM-DD" });
  }
  if (checkOut <= checkIn) {
    return res.status(400).json({ error: "checkOut must be after checkIn" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.area, s.amp_service, s.pull_through, s.max_rig_length,
              s.pet_friendly, s.price_per_night_cents, s.price_per_week_cents, s.price_per_month_cents, s.notes,
              s.permanently_occupied, am.names AS amenities,
              -- A site with every rate set to N/A can't be priced, so it can't be offered --
              -- better greyed out in the list than failing at checkout.
              ((s.price_per_night_cents IS NOT NULL OR s.price_per_week_cents IS NOT NULL
                OR s.price_per_month_cents IS NOT NULL)
               AND NOT s.permanently_occupied AND NOT EXISTS (
                SELECT 1 FROM reservations r
                WHERE r.site_id = s.id
                  AND r.status IN ('pending', 'confirmed')
                  AND r.stay_range && daterange($1::date, $2::date, '[)')
              )) AS available,
              COALESCE(br.ranges, '[]'::json) AS booked_ranges
       FROM sites s
       ${AMENITIES_JOIN}
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('checkIn', sub.check_in, 'checkOut', sub.check_out) ORDER BY sub.check_in) AS ranges
         FROM (
           SELECT check_in, check_out FROM reservations
           WHERE site_id = s.id AND status IN ('pending', 'confirmed') AND check_out >= CURRENT_DATE
           ORDER BY check_in
           LIMIT 12
         ) sub
       ) br ON true
       WHERE s.active = true
       ORDER BY s.sort_order`,
      [checkIn, checkOut]
    );
    res.json(
      rows.map((row) => ({
        ...row,
        bookedRanges: row.booked_ranges.map((r) => ({ checkIn: r.checkIn, checkOut: r.checkOut })),
        booked_ranges: undefined,
      }))
    );
  } catch (err) {
    next(err);
  }
});

/* Prices a stay for the order summary on the booking page. The browser used to work this out for
   itself -- stacking weeks and nights, knowing nothing about the monthly cap, and adding a $5
   booking fee the park had stopped charging -- so the "estimated total" a guest agreed to could
   differ from what their card was charged. It asks the same quote() the checkout uses now, and
   there is exactly one place rates are interpreted. */
router.get("/quote", async (req, res, next) => {
  const { siteId, checkIn, checkOut } = req.query;
  if (!/^\d+$/.test(siteId ?? "")) {
    return res.status(400).json({ error: "siteId is required" });
  }
  if (!DATE_RE.test(checkIn ?? "") || !DATE_RE.test(checkOut ?? "") || checkOut <= checkIn) {
    return res.status(400).json({ error: "Invalid checkIn/checkOut" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT price_per_night_cents, price_per_week_cents, price_per_month_cents
       FROM sites WHERE id = $1 AND active = true`,
      [Number(siteId)]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Site not found" });
    }
    const rates = {
      pricePerNightCents: rows[0].price_per_night_cents,
      pricePerWeekCents: rows[0].price_per_week_cents,
      pricePerMonthCents: rows[0].price_per_month_cents,
    };
    if (!isPriceable(rates)) {
      return res.status(409).json({ error: "That site has no rates set, so it can't be booked online right now." });
    }
    res.json(quote({ ...rates, checkIn, checkOut }));
  } catch (err) {
    next(err);
  }
});

router.get("/homepage-amenities", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM amenities WHERE active = true AND show_on_homepage = true ORDER BY sort_order, name"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Editable text (see /admin -> Content) as a flat { key: value } map for public/js/content.js
// to apply to any element with a matching data-content-key attribute.
router.get("/content", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT key, value FROM content_blocks");
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  } catch (err) {
    next(err);
  }
});

// The currently-live style preset (see /admin -> Styles), or an empty override set if none is
// live -- the base stylesheet's defaults apply either way, so this is always safe to render.
router.get("/live-style", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT css_vars, logo_url FROM styles WHERE is_live = true LIMIT 1");
    res.json(rows[0] ?? { css_vars: {}, logo_url: null });
  } catch (err) {
    next(err);
  }
});

// Approval checklist for the static-site branch's style gallery (see db/schema.sql for the
// `style_gallery_approvals` table). A missing slug in this map means "not reviewed yet".
router.get("/style-gallery-approvals", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT slug, approved, dismissed, note FROM style_gallery_approvals");
    res.json(
      Object.fromEntries(rows.map((r) => [r.slug, { approved: r.approved, dismissed: r.dismissed, note: r.note }]))
    );
  } catch (err) {
    next(err);
  }
});

export default router;
