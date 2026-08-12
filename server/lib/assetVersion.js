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
const VERSIONED = /(?:href|src)="(\/(?:css|js)\/[a-zA-Z0-9._-]+\.(?:css|js))"/g;

export function makeAssetVersioner(rootDir) {
  const cache = new Map();

  const hashOf = (urlPath) => {
    try {
      const buf = fs.readFileSync(path.join(rootDir, urlPath));
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
