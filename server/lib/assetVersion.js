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
export function makeAssetVersioner(rootDir, resolveAsset = (urlPath) => path.join(rootDir, urlPath)) {
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

  return function assetVersioner(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const clean = req.path.split("?")[0];
    const target = clean === "/" ? "/index.html" : clean;
    if (!target.endsWith(".html")) return next();

    // Keep the traversal guard: resolve, then confirm the result is still inside the root.
    const filePath = path.resolve(rootDir, "." + target);
    if (!filePath.startsWith(path.resolve(rootDir))) return next();

    const body = render(filePath);
    if (body === null) return next();

    res.set("Content-Type", "text/html; charset=utf-8");
    // The HTML itself must never be cached, or a visitor keeps asking for the old asset URLs and
    // the versioning achieves nothing.
    res.set("Cache-Control", "no-cache");
    return res.send(body);
  };
}
