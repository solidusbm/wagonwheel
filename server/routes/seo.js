import { Router } from "express";
import sharp from "sharp";
import { pool } from "../db.js";
import { robotsTxt, sitemapXml, snapshot } from "../lib/seo.js";

const router = Router();

/* /robots.txt and /sitemap.xml are generated rather than checked in as files so that the list of
 * pages has one home (PAGES in lib/seo.js). A checked-in sitemap is a file nobody remembers to
 * edit; this one cannot disagree with the tags on the pages themselves. */

router.get("/robots.txt", async (req, res, next) => {
  try {
    res.type("text/plain; charset=utf-8");
    /* Short, because this one answers to a switch in /admin: an hour is how long "hide the site
       from search" would appear not to have worked. */
    res.set("Cache-Control", "public, max-age=300");
    res.send(robotsTxt(await snapshot()));
  } catch (err) {
    next(err);
  }
});

router.get("/sitemap.xml", (req, res) => {
  res.type("application/xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  res.send(sitemapXml());
});

/* The share card -- what Facebook, iMessage, WhatsApp and Slack put above a link to the park.
 *
 * Cut from whichever photograph /admin -> Search & sharing nominates -- the one leading the
 * homepage grid unless somebody chose otherwise -- and cut to exactly 1200x630 here rather than by handing the
 * scraper an arbitrary phone photo: those are portrait as often as not, and every one of those
 * previews crops to landscape anyway, badly and differently on each platform. Doing it once, with
 * `cover`, means the same considered crop everywhere.
 *
 * Same-origin on purpose. The privacy page says the site runs no trackers, and an og:image on a
 * third-party CDN would be a request to that third party every time anyone previewed a link.
 */
const OG_W = 1200;
const OG_H = 630;

let cardCache = { key: null, buf: null };

/* Fallback for a park with no homepage photograph yet -- a brand mark, deliberately with no
 * lettering in it. Text in an SVG is rendered by librsvg using whatever fonts the container
 * happens to have, and this one is Debian slim; a missing font draws tofu boxes, and a share card
 * full of empty rectangles is worse than a plain graphic. The wheel is the nav's brand mark. */
function fallbackCard() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">
    <rect width="${OG_W}" height="${OG_H}" fill="#f6ecd8"/>
    <rect y="${OG_H - 26}" width="${OG_W}" height="26" fill="#8c3a2b"/>
    <rect y="${OG_H - 34}" width="${OG_W}" height="8" fill="#87590f"/>
    <g transform="translate(600 296) scale(2.4)" stroke="#8c3a2b" fill="none" stroke-width="5">
      <circle cx="0" cy="0" r="46"/>
      <circle cx="0" cy="0" r="10" fill="#8c3a2b"/>
      <line x1="0" y1="-46" x2="0" y2="46"/>
      <line x1="-46" y1="0" x2="46" y2="0"/>
      <line x1="-32.5" y1="-32.5" x2="32.5" y2="32.5"/>
      <line x1="32.5" y1="-32.5" x2="-32.5" y2="32.5"/>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

router.get("/og-image.jpg", async (req, res, next) => {
  try {
    const snap = await snapshot();
    const key = snap?.sharePhotoId ?? "fallback";

    // One entry, keyed by the photo it was cut from: change the lead photo and this regenerates.
    if (cardCache.key !== key) {
      let buf = null;
      if (snap?.sharePhotoId) {
        const { rows } = await pool.query("SELECT data FROM photos WHERE id = $1", [snap.sharePhotoId]);
        if (rows[0]) {
          buf = await sharp(rows[0].data, { failOn: "none" })
            .rotate() // EXIF orientation, before the tag is stripped -- otherwise phone shots land sideways
            .resize({ width: OG_W, height: OG_H, fit: "cover", position: "attention" })
            .jpeg({ quality: 82, mozjpeg: true })
            .toBuffer();
        }
      }
      cardCache = { key, buf: buf ?? (await fallbackCard()) };
    }

    res.type("image/jpeg");
    /* The URL carries ?v=<photo id>, so a given URL's bytes never change and this can be cached
       hard. Change the lead photo and the URL changes with it, which is also what makes Facebook
       re-scrape instead of showing last month's picture. */
    res.set("Cache-Control", "public, max-age=86400");
    res.send(cardCache.buf);
  } catch (err) {
    next(err);
  }
});

export default router;
