/* A small in-process rate limiter. No dependency: this app runs as a single container, the traffic
 * is a twelve-site RV park, and a package that ships its own store and clustering support would be
 * more moving parts than the problem has.
 *
 * WHAT THIS IS ACTUALLY FOR. The obvious worry -- someone floods the booking endpoint and blocks
 * the calendar -- turns out not to be the real one: a reservation is only held while its charge is
 * in flight, and a failed charge cancels the row and releases the dates. Blocking the calendar
 * would mean paying for it.
 *
 * The real exposure is CARD TESTING. A public endpoint that takes a card number and reports back
 * whether the charge succeeded is exactly what someone validating stolen cards wants, and the
 * merchant wears the chargebacks and the processor's attention, not the attacker. That's why the
 * booking limit counts ATTEMPTS rather than successes, and why it's the tightest of the three.
 *
 * Fixed windows, not a sliding log: at these volumes the burst a fixed window allows at a boundary
 * is irrelevant, and the memory is one small object per caller rather than a list of timestamps.
 */

/* THE CLIENT IP IS NOT req.ip. This app sits behind Cloudflare, which reaches the origin through a
 * cloudflared tunnel running on the same host -- so every request arrives from the connector, and
 * req.ip is the same value for every visitor in the world. A limiter keyed on that throttles all
 * guests as one person, which is worse than no limiter at all.
 *
 * Cloudflare sets CF-Connecting-IP to the real client and strips any inbound copy, so it's
 * trustworthy HERE specifically because the origin is only reachable through the tunnel. If this
 * app is ever exposed directly, this header becomes attacker-controlled and this must change.
 */
export function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.length) return cf.trim();
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}

const SWEEP_EVERY_MS = 60_000;

export function makeRateLimit({ windowMs, max, message, key = clientIp }) {
  const hits = new Map();

  /* Expired entries are dropped on a timer rather than only when their key is next seen -- a
     scanner hitting thousands of distinct addresses would otherwise leave one entry each, forever.
     unref() so this timer never holds the process open on shutdown. */
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.resetAt <= now) hits.delete(k);
  }, SWEEP_EVERY_MS);
  sweep.unref?.();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const id = key(req);
    let entry = hits.get(id);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(remaining));
    res.set("RateLimit-Reset", String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      // Tells the guest what to do, not what went wrong internally. Someone who genuinely fumbled
      // a card three times needs a phone number, not a status code.
      return res.status(429).json({ error: message });
    }
    return next();
  };
}
