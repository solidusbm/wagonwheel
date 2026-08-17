import { pool } from "../db.js";

const KEY_SECTION_ORDER = "admin_section_order";

/* The collapsible sections below Reservations in /admin, keyed by what admin/index.html marks
 * each <details> with (data-section). This list is the source of truth for which keys are valid
 * -- a saved order can only ever be a permutation of it, so a stale key left behind by a removed
 * section, or a typo, can never wedge the page into a broken or hidden state.
 */
export const SECTION_KEYS = [
  "sites",
  "photos",
  "amenities",
  "content",
  "map",
  "social",
  "seo",
  "push",
  "reviews",
  "feeds",
  "payments",
  "email",
];

function normalise(raw) {
  const seen = new Set();
  const order = [];
  if (Array.isArray(raw)) {
    for (const key of raw) {
      if (typeof key === "string" && SECTION_KEYS.includes(key) && !seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  // Anything not mentioned -- a section added after this was last saved -- goes at the end, in
  // the page's own built-in order, so a new section is never silently missing from the page.
  for (const key of SECTION_KEYS) {
    if (!seen.has(key)) order.push(key);
  }
  return order;
}

/** The saved order, healed against SECTION_KEYS. Never throws -- the page falls back to its own
 *  built-in order if the database is unreachable. */
export async function readSectionOrder() {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = $1", [KEY_SECTION_ORDER]);
    if (!rows.length || !rows[0].value) return SECTION_KEYS.slice();
    return normalise(JSON.parse(rows[0].value));
  } catch (err) {
    console.warn("[section-order] falling back to the default order:", err.message);
    return SECTION_KEYS.slice();
  }
}

/** Validates, stores, and returns exactly what was stored, so the page reflects what's actually
 *  saved rather than its own optimistic copy. */
export async function writeSectionOrder(raw) {
  const clean = normalise(raw);
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY_SECTION_ORDER, JSON.stringify(clean)]
  );
  return clean;
}
