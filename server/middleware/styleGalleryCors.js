const ALLOWED_ORIGINS = ["https://solidusbm.github.io"];
const isLocalhost = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");

// The style-gallery approval checklist lives on the static-site branch's demo hub, deployed to
// GitHub Pages -- a different origin than this app, so its fetch()/PATCH calls need CORS. Scoped
// narrowly to just the style-gallery-approvals routes rather than applied globally.
export function styleGalleryCors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || isLocalhost(origin))) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "GET, PATCH, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
}
