/* Runnable check for the /admin session auth -- `node tools/check-admin-auth.mjs` from the repo
   root. Not wired to a test runner because this repo has none; it is a script in tools/ like
   make-icons.mjs. Worth keeping as a file rather than a one-off because it is the login for a
   page full of guest names, emails and phone numbers, and because the failure it guards against
   (locking the office out of its own admin) is only discoverable in production otherwise.

   It runs the REAL middleware against a real express app on a throwaway port. It sets its own
   ADMIN_USERNAME/ADMIN_PASSWORD, so it neither reads nor needs the live ones. */
import express from "express";
import {
  adminAuth, hasSession, verifyCredentials, startSession, endSession, safeNext,
} from "../server/middleware/adminAuth.js";

process.env.ADMIN_USERNAME = "office";
process.env.ADMIN_PASSWORD = "correct-horse-battery";

const app = express();
app.set("trust proxy", true);
app.get("/admin/login", (req, res) => { if (hasSession(req)) return res.redirect(302, "/admin/"); res.send("LOGIN PAGE"); });
app.post("/admin/login", express.urlencoded({ extended: false }), (req, res) => {
  const { username, password, next: requested } = req.body ?? {};
  if (!verifyCredentials(username, password)) {
    const s = typeof requested === "string" && requested ? `&next=${encodeURIComponent(requested)}` : "";
    return res.redirect(302, `/admin/login?error=1${s}`);
  }
  startSession(req, res);
  res.redirect(302, safeNext(requested));
});
app.post("/admin/logout", (req, res) => { endSession(req, res); res.redirect(302, "/admin/login"); });
app.use("/api/admin", adminAuth, (req, res) => res.json({ ok: true }));
app.use("/admin", adminAuth, (req, res) => res.send("ADMIN PAGE"));

const server = app.listen(4321);
const B = "http://127.0.0.1:4321";
const form = (o) => new URLSearchParams(o);
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { console.log("PASS ", name); pass++; } else { console.log("FAIL ", name, extra); fail++; } };

// 1. No credentials at all -> redirected to the login page, not a 401 dialog.
let r = await fetch(`${B}/admin/`, { redirect: "manual" });
check("no session -> 302 to login", r.status === 302 && r.headers.get("location").startsWith("/admin/login"), r.status + " " + r.headers.get("location"));
check("no WWW-Authenticate sent (the whole point)", !r.headers.get("www-authenticate"), r.headers.get("www-authenticate"));

// 2. API paths get JSON, not a redirect -- admin fetches must not follow a redirect into HTML.
r = await fetch(`${B}/api/admin/sites`, { redirect: "manual" });
check("api without session -> 401 JSON", r.status === 401 && (await r.json()).login === "/admin/login");

// 3. Wrong password.
r = await fetch(`${B}/admin/login`, { method: "POST", body: form({ username: "office", password: "wrong" }), redirect: "manual" });
check("wrong password -> error redirect", r.headers.get("location") === "/admin/login?error=1");
check("wrong password sets no cookie", !r.headers.get("set-cookie"), r.headers.get("set-cookie"));

// 4. Wrong username, right password.
r = await fetch(`${B}/admin/login`, { method: "POST", body: form({ username: "nope", password: "correct-horse-battery" }), redirect: "manual" });
check("wrong username rejected", !r.headers.get("set-cookie"));

// 5. Correct credentials.
r = await fetch(`${B}/admin/login`, { method: "POST", body: form({ username: "office", password: "correct-horse-battery" }), redirect: "manual" });
const setCookie = r.headers.get("set-cookie") ?? "";
check("correct login sets cookie", setCookie.includes("ww_admin="), setCookie);
check("cookie is HttpOnly", /HttpOnly/i.test(setCookie));
check("cookie is SameSite=Lax", /SameSite=Lax/i.test(setCookie));
check("correct login redirects to /admin/", r.headers.get("location") === "/admin/");
const cookie = setCookie.split(";")[0];

// 6. The cookie actually opens the door.
r = await fetch(`${B}/admin/`, { headers: { cookie }, redirect: "manual" });
check("session cookie grants access", r.status === 200 && (await r.text()) === "ADMIN PAGE", r.status);
r = await fetch(`${B}/api/admin/sites`, { headers: { cookie }, redirect: "manual" });
check("session cookie works for api", r.status === 200);

// 7. Tampering.
const [name, value] = cookie.split("=");
const [ts, mac] = decodeURIComponent(value).split(".");
r = await fetch(`${B}/admin/`, { headers: { cookie: `${name}=${ts}.${"0".repeat(mac.length)}` }, redirect: "manual" });
check("forged signature rejected", r.status === 302);
r = await fetch(`${B}/admin/`, { headers: { cookie: `${name}=${Date.now()}.${mac}` }, redirect: "manual" });
check("replayed mac with new timestamp rejected", r.status === 302);
r = await fetch(`${B}/admin/`, { headers: { cookie: `${name}=${Date.now() - 31 * 24 * 3600 * 1000}.${mac}` }, redirect: "manual" });
check("expired session rejected", r.status === 302);

// 8. Legacy Basic Auth still accepted, so nobody is locked out by the migration.
const basic = "Basic " + Buffer.from("office:correct-horse-battery").toString("base64");
r = await fetch(`${B}/admin/`, { headers: { authorization: basic }, redirect: "manual" });
check("legacy Basic Auth still accepted", r.status === 200);
r = await fetch(`${B}/admin/`, { headers: { authorization: "Basic " + Buffer.from("office:bad").toString("base64") }, redirect: "manual" });
check("wrong Basic Auth rejected", r.status === 302);

// 9. Open redirect.
check("safeNext blocks //evil.com", safeNext("//evil.com") === "/admin/");
check("safeNext blocks absolute url", safeNext("https://evil.com/x") === "/admin/");
check("safeNext blocks non-admin path", safeNext("/etc/passwd") === "/admin/");
check("safeNext allows admin subpath", safeNext("/admin/summary.html") === "/admin/summary.html");

// 10. Password rotation invalidates outstanding sessions.
process.env.ADMIN_PASSWORD = "a-brand-new-password";
r = await fetch(`${B}/admin/`, { headers: { cookie }, redirect: "manual" });
check("password change invalidates old session", r.status === 302);
process.env.ADMIN_PASSWORD = "correct-horse-battery";

// 11. Logout.
r = await fetch(`${B}/admin/logout`, { method: "POST", headers: { cookie }, redirect: "manual" });
check("logout clears the cookie", /ww_admin=;|ww_admin=;\s/.test(r.headers.get("set-cookie") ?? ""), r.headers.get("set-cookie"));

// 12. Unconfigured server must not silently allow everything.
delete process.env.ADMIN_USERNAME;
r = await fetch(`${B}/admin/`, { redirect: "manual" });
check("unconfigured -> 503, never open", r.status === 503, r.status);
process.env.ADMIN_USERNAME = "office";

console.log(`\n${pass} passed, ${fail} failed`);
server.close();
process.exitCode = fail ? 1 : 0;
