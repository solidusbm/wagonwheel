import { timingSafeEqual, createHmac } from "node:crypto";

/* /admin used to be HTTP Basic Auth. It is now a signed session cookie, because Basic Auth and a
   service worker on the same origin are a documented Chrome failure: the browser owns the login,
   and when a worker is registered the 401 comes back with no password prompt at all -- a blank
   admin nobody can get into. It also made the site uninstallable as a PWA, which on iOS means no
   booking notifications at all, since only a Home Screen install receives web push.
   The password itself is unchanged: same ADMIN_USERNAME / ADMIN_PASSWORD, different transport. */

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const COOKIE = "ww_admin";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/* The signing key is derived from the admin password rather than being its own env var. Two
   reasons, and the first one is why: nothing new has to be set in Coolify for this to work. A
   separate SESSION_SECRET that nobody remembered to set would mean nobody can log in at all, on a
   change whose entire purpose is to stop locking people out. Second, deriving it means changing
   the password invalidates every outstanding session, which is what a password change should do. */
function signingKey() {
  return createHmac("sha256", "wagonwheel-admin-session-v1")
    .update(`${process.env.ADMIN_USERNAME ?? ""}:${process.env.ADMIN_PASSWORD ?? ""}`)
    .digest();
}

function sign(issuedAt) {
  return createHmac("sha256", signingKey()).update(String(issuedAt)).digest("hex");
}

// express.cookie() can set one without a dependency, but reading needs cookie-parser, and one
// header parse is cheaper than a package.
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function hasSession(req) {
  const raw = readCookie(req, COOKIE);
  if (!raw) return false;

  const dot = raw.lastIndexOf(".");
  if (dot === -1) return false;

  const issuedAt = Number(raw.slice(0, dot));
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > MAX_AGE_MS) return false;

  return safeEqual(raw.slice(dot + 1), sign(issuedAt));
}

/* Errs towards NOT setting Secure. A Secure cookie on a connection the server wrongly believes is
   plain HTTP is silently dropped by the browser, which is an unbreakable login loop; an absent
   Secure flag on a site that is HTTPS-only in practice costs far less. Cloudflare's tunnel sets
   x-forwarded-proto, so in production this is true. */
function isSecure(req) {
  if (req.secure) return true;
  const proto = req.headers["x-forwarded-proto"];
  return typeof proto === "string" && proto.split(",")[0].trim() === "https";
}

export function verifyCredentials(username, password) {
  const configuredUser = process.env.ADMIN_USERNAME;
  const configuredPass = process.env.ADMIN_PASSWORD;
  if (!configuredUser || !configuredPass) return false;

  // Both compared every time, never short-circuited, so a wrong username and a wrong password
  // take the same time to reject.
  const okUser = safeEqual(String(username ?? ""), configuredUser);
  const okPass = safeEqual(String(password ?? ""), configuredPass);
  return okUser && okPass;
}

export function startSession(req, res) {
  const issuedAt = Date.now();
  res.cookie(COOKIE, `${issuedAt}.${sign(issuedAt)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(req),
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function endSession(req, res) {
  res.clearCookie(COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure: isSecure(req) });
}

// Only same-site admin paths survive. "//evil.com" is a protocol-relative URL, so a leading double
// slash has to be rejected explicitly -- checking for a scheme is not enough.
export function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/admin") || value.startsWith("//")) return "/admin/";
  return value;
}

function wantsJson(req) {
  if (req.originalUrl.startsWith("/api/")) return true;
  const accept = req.headers.accept ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

export function adminAuth(req, res, next) {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: "Admin view is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD." });
  }

  if (hasSession(req)) return next();

  /* A Basic header is still ACCEPTED, but one is never REQUESTED -- no WWW-Authenticate goes out
     any more, which is the part that actually caused the trouble. Accepting it keeps curl and any
     saved bookmark working, and means a browser still holding credentials cached from before this
     change logs straight in rather than being locked out by the migration. */
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? "" : decoded.slice(sep + 1);
    if (verifyCredentials(user, pass)) return next();
  }

  if (wantsJson(req)) {
    // login is in the body so the admin's own fetches can send the operator somewhere useful
    // instead of failing silently against a session that quietly expired.
    return res.status(401).json({ error: "Authentication required", login: "/admin/login" });
  }

  res.redirect(302, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
}
