/* The park's physical layout, in real feet.
 *
 * Arranged by hand in the layout editor against Mangold Engineering drawing 100-7799
 * (sheet 2 of 5, "System Layout", 1" = 100'), which the park supplied marked up -- roads
 * in green, sites in yellow, office in red. This file is the single source of truth for
 * where things physically are; `renderSiteMap()` in app.js just draws it.
 *
 * Coordinates: origin top-left, +x east, +y south, before `bearing` is applied. `bearing`
 * is the whole block's rotation off north in degrees (negative turns it anticlockwise), so
 * the pads can be authored square and the site turned once.
 *
 * Pad sizes are currently a uniform 20 x 55 ft -- a sensible default, NOT measured. Road
 * widths are a uniform 24 ft on the same basis. Positions came off the plan; the
 * dimensions are still to be confirmed by pacing the park. To update, re-open the layout
 * editor, adjust, and paste the exported JSON over the object below -- nothing else in the
 * app needs touching.
 *
 * Last arranged: 2026-08-10. Pending: on-site measurement.
 */
export const PARK_LAYOUT = {
  version: 1,
  units: "feet",
  bearing: -18,
  world: { w: 400, h: 340 },
  office: { x: 303, y: 49, w: 45, h: 40, rot: 0 },
  bays: [
    { n: 1, x: 93, y: 52, w: 20, h: 55, rot: 0 },
    { n: 2, x: 142, y: 49, w: 20, h: 55, rot: 0 },
    { n: 3, x: 79, y: 135, w: 20, h: 55, rot: 0 },
    { n: 4, x: 127, y: 132, w: 20, h: 55, rot: 0 },
    { n: 5, x: 175, y: 129, w: 20, h: 55, rot: 0 },
    { n: 6, x: 220, y: 125, w: 20, h: 55, rot: 0 },
    { n: 7, x: 266, y: 123, w: 20, h: 55, rot: 0 },
    { n: 8, x: 82, y: 215, w: 20, h: 55, rot: 0 },
    { n: 9, x: 129, y: 211, w: 20, h: 55, rot: 0 },
    { n: 10, x: 176, y: 208, w: 20, h: 55, rot: 0 },
    { n: 11, x: 221, y: 204, w: 20, h: 55, rot: 0 },
    { n: 12, x: 267, y: 200, w: 20, h: 55, rot: 0 },
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
