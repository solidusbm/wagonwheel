/* The park's physical layout, in real feet.
 *
 * Positions were arranged by hand in the layout editor against Mangold Engineering drawing
 * 100-7799 (sheet 2 of 5, "System Layout", 1" = 100'), which the park supplied marked up --
 * roads in green, sites in yellow, office in red. This file is the single source of truth for
 * where things physically are; `renderSiteMap()` in app.js just draws it.
 *
 * *** THE NUMBERING RUNS EAST TO WEST, AND DOES NOT MATCH THE ENGINEERING DRAWING. ***
 *
 * The plan numbers each row west to east. The park numbered the pads the other way round when
 * they actually put the markers out, and the markers are what a guest standing in the park sees.
 * So the LOWEST number in each row sits at its EASTERN end:
 *
 *     west  <--------------------------------->  east
 *     Front       2   1
 *     Center      7   6   5   4   3
 *     Back       12  11  10   9   8
 *
 * Confirmed by the park 2026-08-14: sites 2, 7 and 12 are on the western edge of their rows;
 * sites 1, 3 and 8 are on the eastern edge. Reversed here on the same date.
 *
 * If you ever compare this file against the drawing they will disagree, and the drawing is the
 * one that's wrong about numbering. Do not "correct" it back. Positions, rows, orientation and
 * road topology still come from the drawing and are right.
 *
 * Coordinates: origin top-left, +x east, +y south, before `bearing` is applied. `bearing`
 * is the whole block's rotation off north in degrees (negative turns it anticlockwise), so
 * the pads can be authored square and the site turned once.
 *
 * Pad sizes are a uniform 20 x 55 ft -- a sensible default, NOT measured. Road widths are a
 * uniform 24 ft on the same basis. Positions came off the plan; the dimensions are still to be
 * confirmed by pacing the park.
 *
 * *** THIS FILE IS THE FALLBACK, NOT THE LIVE LAYOUT. ***
 *
 * The park now edits the map itself in /admin -> Park map, and the result is stored as JSON in
 * app_settings under `park_layout`. The app reads that; this object is what it falls back to when
 * no row has been saved yet or the database is unreachable, so the map still draws. Same rule as
 * the SEO settings: an absent row means "use the built-in default". Editing this file changes the
 * fallback only -- to change what guests actually see, use /admin.
 *
 * `features` are the buildings and fenced areas: the office, the bathhouse, the two dog parks.
 * It replaced a single hardcoded `office` object in v2. `kind` drives how one is drawn and
 * nothing else, so an unfamiliar kind still renders as a labelled box rather than vanishing.
 *
 * Last arranged: 2026-08-10. Numbering corrected: 2026-08-14. Became a fallback: 2026-08-16.
 * Pending: on-site measurement.
 */
export const PARK_LAYOUT = {
  version: 2,
  units: "feet",
  bearing: -18,
  world: { w: 400, h: 340 },
  features: [{ id: "office", kind: "office", label: "Office", x: 303, y: 49, w: 45, h: 40, rot: 0 }],
  /* The road the park opens onto. Present here, not just in normalise(), because renderSiteMap
     reads this object directly when the layout request fails -- leaving it out would quietly drop
     the street name from the map on exactly the days the site is already having a bad time. */
  street: "POLLY PEAK DR.",
  /* Names for the ways in and out. Empty means "use the defaults", which are ENTRANCE for the
     northernmost opening and EXIT for the rest. The gates themselves are found from the road
     geometry, so there is nothing to list here until the office renames one. */
  gates: [],
  bays: [
    { n: 1, x: 142, y: 49, w: 20, h: 55, rot: 0 },
    { n: 2, x: 93, y: 52, w: 20, h: 55, rot: 0 },
    { n: 3, x: 266, y: 123, w: 20, h: 55, rot: 0 },
    { n: 4, x: 220, y: 125, w: 20, h: 55, rot: 0 },
    { n: 5, x: 175, y: 129, w: 20, h: 55, rot: 0 },
    { n: 6, x: 127, y: 132, w: 20, h: 55, rot: 0 },
    { n: 7, x: 79, y: 135, w: 20, h: 55, rot: 0 },
    { n: 8, x: 267, y: 200, w: 20, h: 55, rot: 0 },
    { n: 9, x: 221, y: 204, w: 20, h: 55, rot: 0 },
    { n: 10, x: 176, y: 208, w: 20, h: 55, rot: 0 },
    { n: 11, x: 129, y: 211, w: 20, h: 55, rot: 0 },
    { n: 12, x: 82, y: 215, w: 20, h: 55, rot: 0 },
  ],
  roads: [
    { w: 24, pts: [{ x: 40, y: 127 }, { x: 320, y: 107 }] },
    { w: 24, pts: [{ x: 40, y: 206 }, { x: 313, y: 185 }] },
    { w: 24, pts: [{ x: 40, y: 285 }, { x: 321, y: 264 }] },
    { w: 24, pts: [{ x: 40, y: 127 }, { x: 40, y: 285 }] },
    { w: 24, pts: [{ x: 324, y: 106 }, { x: 323, y: 264 }] },
    { w: 24, pts: [{ x: 333, y: 106 }, { x: 411, y: 97 }] },
    { w: 24, pts: [{ x: 323, y: 263 }, { x: 381, y: 258 }] },
  ],
};
