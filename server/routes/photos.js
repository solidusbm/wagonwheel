import { Router } from "express";
import sharp from "sharp";
import { pool } from "../db.js";

const router = Router();

router.get("/api/photos", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, caption, show_on_homepage, sort_order FROM photos ORDER BY sort_order, created_at"
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        caption: r.caption,
        showOnHomepage: r.show_on_homepage,
        sortOrder: r.sort_order,
      }))
    );
  } catch (err) {
    next(err);
  }
});

/* Thumbnails, so the booking page can show a photo on every site card without pulling megabytes.
 * A dozen full-size shots is several MB, and a lot of this park's guests are on cellular in the
 * Hill Country -- the site list has to appear before the photos do.
 *
 * Only a few widths are allowed: the width is part of the cache key, so leaving it open would let
 * anyone fill the cache (and burn CPU) with /photos/1/image?w=1..1600.
 *
 * Cached in memory rather than in the database because a photo's BYTES never change -- upload
 * inserts a new row and delete removes one; captions and flags are separate columns. A deleted
 * photo can leave a stale entry behind, but its id is gone, so nothing will ever ask for it again.
 */
const THUMB_WIDTHS = new Set([320, 640]);
const THUMB_CACHE_MAX = 96;
const thumbCache = new Map();

async function thumbnail(id, width, source) {
  const key = `${id}:${width}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const buf = await sharp(source, { failOn: "none" })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  // Cheapest sane eviction: Map preserves insertion order, so the oldest key is the first one.
  if (thumbCache.size >= THUMB_CACHE_MAX) thumbCache.delete(thumbCache.keys().next().value);
  thumbCache.set(key, buf);
  return buf;
}

// Not under /api -- this serves raw image bytes, referenced directly as an <img src>.
router.get("/photos/:id/image", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).end();
  }
  const width = req.query.w ? Number(req.query.w) : null;
  if (width !== null && !THUMB_WIDTHS.has(width)) {
    return res.status(400).json({ error: `w must be one of ${[...THUMB_WIDTHS].join(", ")}` });
  }
  try {
    const { rows } = await pool.query("SELECT mime_type, data FROM photos WHERE id = $1", [id]);
    const photo = rows[0];
    if (!photo) {
      return res.status(404).end();
    }
    if (width) {
      const buf = await thumbnail(id, width, photo.data);
      res.set("Content-Type", "image/jpeg");
      // Immutable: the bytes behind a given id never change, and the width is in the URL.
      res.set("Cache-Control", "public, max-age=604800, immutable");
      return res.send(buf);
    }
    res.set("Content-Type", photo.mime_type);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(photo.data);
  } catch (err) {
    next(err);
  }
});

export default router;
