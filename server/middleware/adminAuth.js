import { timingSafeEqual } from "node:crypto";

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function adminAuth(req, res, next) {
  const configuredUser = process.env.ADMIN_USERNAME;
  const configuredPass = process.env.ADMIN_PASSWORD;
  if (!configuredUser || !configuredPass) {
    return res.status(503).json({ error: "Admin view is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD." });
  }

  const header = req.headers.authorization ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? "" : decoded.slice(sep + 1);
    if (safeEqual(user, configuredUser) && safeEqual(pass, configuredPass)) {
      return next();
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Wagon Wheel Admin"');
  res.status(401).json({ error: "Authentication required" });
}
