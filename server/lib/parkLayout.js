import { pool } from "../db.js";
import { PARK_LAYOUT } from "../../public/js/park-layout.js";

/* The park's physical layout: where the pads, roads and buildings actually are, in feet.
 *
 * It used to live only in public/js/park-layout.js, arranged in a standalone editor whose output
 * was pasted into the file by hand -- so moving a fence meant a developer, a commit and a deploy.
 * It is now stored as JSON in app_settings under `park_layout` and edited in /admin -> Park map.
 * The bundled file is the fallback when nothing has been saved yet or the database is down, on the
 * same rule as the SEO settings: an absent row means "use the built-in default".
 *
 * EVERYTHING THAT ARRIVES FROM THE EDITOR PASSES THROUGH normalise(). It is the only validation
 * there is, and it is deliberately total: every field is clamped or defaulted, and anything
 * unrecognised is dropped rather than stored. A layout that fails to draw takes the homepage's map
 * with it, and the guest sees a blank rectangle where the park should be -- so a bad save must be
 * impossible rather than merely unlikely.
 */

export const KEY_PARK_LAYOUT = "park_layout";

/* The building kinds the editor offers. `label` is the default caption -- the office can rename a
 * feature freely, so this is a starting point, not an enum the renderer depends on. `w`/`h` are
 * plausible starting footprints in feet so a newly added building lands at a sensible size and
 * gets dragged, not typed. An unknown kind is still drawn, as a plain labelled box. */
export const FEATURE_KINDS = {
  office: { label: "Office", w: 45, h: 40 },
  bathhouse: { label: "Laundry & bathhouse", w: 40, h: 28 },
  "dog-park-large": { label: "Dog park — large", w: 70, h: 55 },
  "dog-park-small": { label: "Dog park — small", w: 45, h: 40 },
  other: { label: "Building", w: 30, h: 24 },
};

const num = (v, fallback, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

const str = (v, fallback, max = 60) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : fallback;
};

/* Hard ceilings, not guesses about this park. They exist so a fat-fingered number can't produce a
 * layout whose bounding box makes every pad a sub-pixel speck on the guest map. 5000 ft is about a
 * mile across, which no RV park is. */
const MAX_FT = 5000;
const MAX_FEATURES = 40;
const MAX_BAYS = 120;
const MAX_ROADS = 60;
const MAX_PTS = 40;

/** Accepts anything -- a v1 layout with a single `office`, a v2 one with `features`, a half-typed
 *  object from the editor, or junk -- and returns a layout that is safe to draw. */
export function normalise(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {
    version: 2,
    units: "feet",
    bearing: num(src.bearing, 0, -360, 360),
    world: {
      w: num(src.world?.w, 400, 60, MAX_FT),
      h: num(src.world?.h, 340, 60, MAX_FT),
    },
    features: [],
    bays: [],
    roads: [],
  };

  /* v1 -> v2. The old shape carried exactly one building, as `office`, with no label or kind.
     Migrated here rather than in a database migration because the layout is a single JSON
     document that can arrive from an old browser tab as easily as from an old row. */
  const rawFeatures = Array.isArray(src.features)
    ? src.features
    : src.office
      ? [{ ...src.office, kind: "office", id: "office" }]
      : [];

  const seenIds = new Set();
  for (const f of rawFeatures.slice(0, MAX_FEATURES)) {
    if (!f || typeof f !== "object") continue;
    const kind = str(f.kind, "other", 40);
    const spec = FEATURE_KINDS[kind] ?? FEATURE_KINDS.other;
    /* Ids must be unique -- the editor addresses a feature by id, and two rows sharing one means
       editing either moves whichever the renderer happens to find first. */
    let id = str(f.id, "", 40).replace(/[^a-zA-Z0-9_-]/g, "") || `f${seenIds.size + 1}`;
    while (seenIds.has(id)) id = `${id}_`;
    seenIds.add(id);
    out.features.push({
      id,
      kind,
      label: str(f.label, spec.label),
      x: num(f.x, 0, -MAX_FT, MAX_FT),
      y: num(f.y, 0, -MAX_FT, MAX_FT),
      w: num(f.w, spec.w, 3, MAX_FT),
      h: num(f.h, spec.h, 3, MAX_FT),
      rot: num(f.rot, 0, -360, 360),
    });
  }

  /* Bays are keyed by site NUMBER, which is how the renderer matches them to rows in the sites
     table -- so a duplicate number would leave one of two real sites undrawable. Later wins,
     because the editor appends. */
  const seenN = new Map();
  for (const b of (Array.isArray(src.bays) ? src.bays : []).slice(0, MAX_BAYS)) {
    if (!b || typeof b !== "object") continue;
    const n = Math.round(num(b.n, 0, 0, 9999));
    if (!n) continue;
    seenN.set(n, {
      n,
      x: num(b.x, 0, -MAX_FT, MAX_FT),
      y: num(b.y, 0, -MAX_FT, MAX_FT),
      w: num(b.w, 20, 3, MAX_FT),
      h: num(b.h, 55, 3, MAX_FT),
      rot: num(b.rot, 0, -360, 360),
    });
  }
  out.bays = [...seenN.values()].sort((a, b) => a.n - b.n);

  for (const r of (Array.isArray(src.roads) ? src.roads : []).slice(0, MAX_ROADS)) {
    if (!r || typeof r !== "object" || !Array.isArray(r.pts)) continue;
    const pts = r.pts
      .slice(0, MAX_PTS)
      .filter((p) => p && typeof p === "object")
      .map((p) => ({ x: num(p.x, 0, -MAX_FT, MAX_FT), y: num(p.y, 0, -MAX_FT, MAX_FT) }));
    // A road needs two ends. A one-point road draws nothing and confuses the entrance detection,
    // which finds gates by looking for road ends that meet no other road.
    if (pts.length < 2) continue;
    out.roads.push({ w: num(r.w, 24, 4, 400), pts });
  }

  return out;
}

/** The saved layout, or the bundled fallback. Never throws and never returns null -- the map has
 *  to draw even with the database down. */
export async function readLayout() {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [KEY_PARK_LAYOUT]);
    if (!rows.length || !rows[0].value) return normalise(PARK_LAYOUT);
    return normalise(JSON.parse(rows[0].value));
  } catch (err) {
    console.warn("[park-layout] falling back to the bundled layout:", err.message);
    return normalise(PARK_LAYOUT);
  }
}

/** Validates, stores, and returns exactly what was stored, so the editor can show the corrected
 *  values rather than its own optimistic copy. */
export async function writeLayout(raw) {
  const clean = normalise(raw);
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY_PARK_LAYOUT, JSON.stringify(clean)]
  );
  return clean;
}
