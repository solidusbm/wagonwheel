import crypto from "node:crypto";

/* A guest cancelling their own booking needs to prove the booking is theirs without logging in.
 * The link carries an HMAC of the reservation code, so a code alone is not enough -- reservation
 * codes are short and guessable, and without this anyone could cancel anyone's stay and send the
 * refund on its way.
 *
 * The secret is CANCEL_TOKEN_SECRET when set. Failing that it derives from SQUARE_ACCESS_TOKEN,
 * which is already secret, already required for payments, and stable across restarts -- important
 * because a secret regenerated at boot would silently break every link already in a guest's inbox.
 * Rotating the Square token invalidates outstanding links; the office can still cancel from /admin,
 * so nobody is stranded.
 */
function secret() {
  const configured = process.env.CANCEL_TOKEN_SECRET || process.env.SQUARE_ACCESS_TOKEN;
  if (!configured) return null;
  return crypto.createHash("sha256").update(`wagonwheel-cancel:${configured}`).digest();
}

export function cancelToken(reservationCode) {
  const key = secret();
  if (!key) return null;
  return crypto.createHmac("sha256", key).update(String(reservationCode)).digest("base64url").slice(0, 22);
}

/* Constant-time compare: a plain === leaks how much of the token matched, which is enough to
   reconstruct one guess at a time. */
export function cancelTokenValid(reservationCode, token) {
  const expected = cancelToken(reservationCode);
  if (!expected || !token) return false;
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Absolute URL, because an email has no request to take a host from. PUBLIC_URL overrides; the
   default is the park's live domain, recorded in CLAUDE.md. */
export function cancelUrl(reservationCode) {
  const token = cancelToken(reservationCode);
  if (!token) return null;
  const base = (process.env.PUBLIC_URL || "https://banderawagonwheelrv.com").replace(/\/$/, "");
  return `${base}/cancel.html?code=${encodeURIComponent(reservationCode)}&t=${token}`;
}
