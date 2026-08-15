import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/* Stylesheet and script changes were reaching returning visitors up to four hours late: the origin
 * sends max-age=0, but Cloudflare's Browser Cache TTL overrides that for cacheable extensions, and
 * that setting lives in the CLIENT's Cloudflare account. Rather than depend on a dashboard toggle
 * we can't see, this stamps a content hash onto the asset URLs. A changed file is a different URL,
 * so no cache anywhere -- browser, Cloudflare, or a proxy in between -- can serve the old one.
 *
 * The hash is computed once at boot and the rewritten HTML is memoised, so this costs one read per
 * page for the life of the process. Files don't change at runtime; a deploy restarts the process.
 */
/* Matches /css/x.css, /js/x.js AND /admin/js/x.js. That last alternative is not decoration: the
 * admin page's own scripts live at /admin/js/*.js, the pattern used to stop at /js/, and so
 * admin.js was never versioned at all. Its HTML is sent no-cache and is always fresh, while the
 * script sat in Cloudflare for up to four hours -- on 2026-08-12 that combination served a
 * deploy-old admin.js against new HTML, it went looking for a form field that had been removed,
 * threw, and the Edit button on the Sites table silently did nothing.
 *
 * If you add an asset under a new URL prefix, add it here AND teach resolveAsset in index.js
 * where the file lives. Missing either fails silently -- the asset just quietly stops being
 * versioned, and you find out days later when a deploy half-lands. */
const VERSIONED = /(?:href|src)="(\/(?:admin\/)?(?:css|js)\/[a-zA-Z0-9._-]+\.(?:css|js))"/g;

/* resolveAsset maps an asset URL, as the browser requests it, to the file that actually serves it.
 * It can't be assumed to sit under this middleware's own root: the admin page is served out of
 * admin/ but links the stylesheet at /css/style.css, which lives in public/. */
/* `injectHead` is optional: given (target, html) it returns a string to splice in before </head>.
 * It runs per request, OUTSIDE the memoised render below, because what it returns is derived from
 * the database (see lib/seo.js) and the memo here lives for the life of the process -- caching the
 * two together would freeze the park's rates into the structured data at boot. The asset-hash
 * rewrite is still memoised, so the per-request cost is one string replace. */
export function makeAssetVersioner(
  rootDir,
  resolveAsset = (urlPath) => path.join(rootDir, urlPath),
  injectHead = null
) {
  const cache = new Map();

  const hashOf = (urlPath) => {
    try {
      const buf = fs.readFileSync(resolveAsset(urlPath));
      return crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8);
    } catch {
      return null; // not ours to serve -- leave the URL untouched
    }
  };

  const render = (filePath) => {
    if (cache.has(filePath)) return cache.get(filePath);
    let html;
    try {
      html = fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
    const out = html.replace(VERSIONED, (whole, assetPath) => {
      const h = hashOf(assetPath);
      return h ? whole.replace(assetPath, `${assetPath}?v=${h}`) : whole;
    });
    cache.set(filePath, out);
    return out;
  };

  return async function assetVersioner(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const clean = req.path.split("?")[0];
    const target = clean === "/" ? "/index.html" : clean;
    if (!target.endsWith(".html")) return next();

    // Keep the traversal guard: resolve, then confirm the result is still inside the root.
    const filePath = path.resolve(rootDir, "." + target);
    if (!filePath.startsWith(path.resolve(rootDir))) return next();

    let body = render(filePath);
    if (body === null) return next();

    if (injectHead) {
      /* Never let a <head> tag cost someone a booking: if the database is unreachable or the
         builder throws, the page still goes out, just without the extra tags. */
      try {
        const extra = await injectHead(target, body);
        /* Function replacement, not a string one: the injected block contains dollar signs (the
           JSON-LD price range is "$45-$650"), and a string replacement treats $& and $' as
           substitution patterns, which would splice fragments of the page into its own <head>. */
        if (extra) body = body.replace("</head>", () => `${extra}\n</head>`);
      } catch (err) {
        console.warn("[assetVersion] head injection failed for", target, "--", err.message);
      }
    }

    res.set("Content-Type", "text/html; charset=utf-8");
    // The HTML itself must never be cached, or a visitor keeps asking for the old asset URLs and
    // the versioning achieves nothing.
    res.set("Cache-Control", "no-cache");
    return res.send(body);
  };
}
