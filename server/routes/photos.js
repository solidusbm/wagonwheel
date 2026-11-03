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
/* Three formats x two widths, so the ceiling had to rise with them: 19 photos on /gallery.html at
   w=640 alone is 57 entries, and 96 was close enough to thrash and re-encode on every page view --
   which is the one thing this cache exists to prevent. */
const THUMB_CACHE_MAX = 256;
const thumbCache = new Map();

/* WebP is offered as a SEPARATE URL (?f=webp) rather than by content negotiation on the Accept
 * header, and that is deliberate. Cloudflare sits in front of this origin and has never honoured
 * `Vary` on anything but Accept-Encoding, so a negotiated response risks the edge caching a WebP
 * and handing it to a client that asked for JPEG. A distinct URL cannot be got wrong by any cache.
 *
 * The browser does the choosing, through <picture><source type="image/webp"> in lib/ssr.js -- which
 * is also the only way to be right about it, since the HTML is rendered before anyone knows who is
 * asking for it.
 *
 * Quality 74 rather than the JPEG's 78: WebP holds detail better at the same number, so matching
 * the figure would give away most of the saving for invisible quality. */
const THUMB_FORMATS = new Set(["jpeg", "webp", "avif"]);
/* Quality numbers are not comparable across formats -- these were chosen by measuring the park's
   own homepage photographs re-encoded from the JPEG thumbnails actually being served:

     jpeg q78 (mozjpeg)   624K   the baseline
     webp q74             508K   19% off
     avif q50             352K   44% off

   which is why AVIF is offered first despite costing about 200ms to encode. That is paid once per
   image per process and then cached; the guest pays it on one request and nobody pays it again. */
const WEBP_QUALITY = 74;
const AVIF_QUALITY = 50;
const JPEG_THUMB_QUALITY = 78;

async function thumbnail(id, width, format, source) {
  const key = `${id}:${width}:${format}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const pipeline = sharp(source, { failOn: "none" })
    .rotate()
    .resize({ width, withoutEnlargement: true });
  const encoded =
    format === "avif"
      ? pipeline.avif({ quality: AVIF_QUALITY })
      : format === "webp"
        ? pipeline.webp({ quality: WEBP_QUALITY })
        : pipeline.jpeg({ quality: JPEG_THUMB_QUALITY, mozjpeg: true });
  const buf = await encoded.toBuffer();
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
  // Same reason as the width allowlist: the format is part of the cache key, so it can't be open.
  const format = req.query.f ? String(req.query.f) : "jpeg";
  if (!THUMB_FORMATS.has(format)) {
    return res.status(400).json({ error: `f must be one of ${[...THUMB_FORMATS].join(", ")}` });
  }
  try {
    const { rows } = await pool.query("SELECT mime_type, data FROM photos WHERE id = $1", [id]);
    const photo = rows[0];
    if (!photo) {
      return res.status(404).end();
    }
    if (width) {
      const buf = await thumbnail(id, width, format, photo.data);
      res.set("Content-Type", `image/${format}`);
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
