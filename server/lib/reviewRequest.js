import { pool } from "../db.js";
import { getTransporter, fromAddress, PARK } from "./email.js";

/* The review-request follow-up -- plan item 2.4.
 *
 * A short note to a guest a day or two after they leave, with a link to the park's Google review
 * form. Review count and recency are among the strongest local ranking factors, and the park
 * already had every piece needed: a guest email address, a working mailer, and a known check-out
 * date.
 *
 * TWO RULES THAT ARE NOT NEGOTIABLE, both from Google's policies and both detectable:
 *   - Never offer anything in exchange for a review. No discount, no free night, no entry into a
 *     draw. It is review-gating's cousin and it gets listings penalised.
 *   - Never send only to guests believed to be happy. Everyone who completed a stay gets the same
 *     message, or nobody does. Filtering for good reviews is against Google's terms and is the
 *     single most common way a small business gets its reviews wiped.
 * There is deliberately no "how was your stay?" branch in here that would make either possible.
 *
 * SENDING AS. This goes out through the same mailer as the booking confirmation, which sends as
 * banderawagonwheelrv@gmail.com through smtp.gmail.com. That matters: the park's domain publishes
 * `v=spf1 -all` and `p=reject`, so mail claiming to come from @banderawagonwheelrv.com is rejected
 * outright. Do not point SMTP_FROM at the park's own domain to make this look tidier without
 * rewriting the SPF record in the same sitting.
 */

const KEY_ENABLED = "review_enabled";
const KEY_URL = "review_url";
const KEY_DELAY = "review_delay_days";
/* Stamped the moment the switch is turned on, and used as a floor on which stays qualify. Without
 * it, enabling the feature would mail every guest in the park's history at once -- people who left
 * eight months ago, asking them to review a stay they have forgotten. */
const KEY_ENABLED_AT = "review_enabled_at";

const DEFAULT_DELAY_DAYS = 2;
/* However far back the floor allows, never chase a stay older than this. It bounds the damage from
 * a fortnight of downtime or a clock problem: the job comes back and sends a fortnight of
 * follow-ups, not a year of them. */
const MAX_AGE_DAYS = 14;

export async function reviewSettings() {
  const { rows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key = ANY($1)",
    [[KEY_ENABLED, KEY_URL, KEY_DELAY, KEY_ENABLED_AT]]
  );
  const set = new Map(rows.map((r) => [r.key, r.value]));
  const delay = Number(set.get(KEY_DELAY));
  return {
    // Off unless explicitly turned on. A feature that mails guests should never default to on.
    enabled: set.get(KEY_ENABLED) === "on",
    url: set.get(KEY_URL) || null,
    delayDays: Number.isInteger(delay) && delay >= 0 && delay <= 30 ? delay : DEFAULT_DELAY_DAYS,
    enabledAt: set.get(KEY_ENABLED_AT) || null,
  };
}

/** Whether the job could send anything at all, and if not, the reason -- so /admin can say so. */
export function blockedReason(settings) {
  if (!settings.enabled) return "Review requests are switched off.";
  if (!settings.url) return "No review link has been set yet.";
  if (!getTransporter()) return "SMTP is not configured, so nothing can be sent.";
  return null;
}

/* Who is due. Confirmed stays only -- a cancelled booking never happened and a pending one was
   never paid for. `review_request_sent_at IS NULL` is what makes this safe to run hourly. */
async function due(settings) {
  const { rows } = await pool.query(
    `SELECT r.id, r.reservation_code, r.guest_name, r.guest_email, r.check_out, s.name AS site_name
       FROM reservations r
       JOIN sites s ON s.id = r.site_id
      WHERE r.status = 'confirmed'
        AND r.review_request_sent_at IS NULL
        AND r.guest_email <> ''
        AND r.check_out <= (CURRENT_DATE - ($1 || ' days')::interval)
        AND r.check_out >= (CURRENT_DATE - ($2 || ' days')::interval)
        AND ($3::timestamptz IS NULL OR r.check_out >= $3::timestamptz::date)
      ORDER BY r.check_out`,
    [String(settings.delayDays), String(settings.delayDays + MAX_AGE_DAYS), settings.enabledAt]
  );
  return rows;
}

export function reviewEmail(guestName, siteName, url) {
  const first = String(guestName ?? "").trim().split(" ")[0] || "there";
  const subject = `How was your stay at ${PARK.name}?`;
  /* Deliberately short, and it asks once. No incentive, no "if you enjoyed your stay" qualifier --
     that phrasing is what turns a review request into review gating. */
  const lines = [
    `Hi ${first},`,
    ``,
    `Thanks for staying with us on ${siteName}. We hope the Hill Country treated you well.`,
    ``,
    `If you have a minute, we'd be grateful if you'd leave us a review. It genuinely helps other`,
    `travellers find the park:`,
    ``,
    `  ${url}`,
    ``,
    `An honest one is worth far more to us than a kind one -- if something wasn't right, we'd`,
    `rather hear it and fix it.`,
    ``,
    `This is the only time we'll ask about this stay.`,
    ``,
    `— The team at ${PARK.name}`,
  ];
  const text = lines.join("\n");
  const html =
    `<p>Hi ${escapeHtml(first)},</p>` +
    `<p>Thanks for staying with us on ${escapeHtml(siteName)}. We hope the Hill Country treated you well.</p>` +
    `<p>If you have a minute, we'd be grateful if you'd <a href="${escapeHtml(url)}">leave us a review</a>. ` +
    `It genuinely helps other travellers find the park.</p>` +
    `<p>An honest one is worth far more to us than a kind one — if something wasn't right, we'd rather ` +
    `hear it and fix it.</p>` +
    `<p style="color:#666; font-size:13px;">This is the only time we'll ask about this stay.</p>` +
    `<p>— The team at ${escapeHtml(PARK.name)}</p>`;
  return { subject, text, html };
}

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/**
 * Send whatever is due. Safe to call on a timer: it is idempotent per reservation and does nothing
 * at all unless the office has switched it on and supplied a link.
 */
export async function sendDueReviewRequests() {
  const settings = await reviewSettings();
  if (blockedReason(settings)) return { sent: 0, failed: 0, skipped: blockedReason(settings) };

  const mailer = getTransporter();
  const rows = await due(settings);
  let sent = 0;
  let failed = 0;

  for (const r of rows) {
    const { subject, text, html } = reviewEmail(r.guest_name, r.site_name, settings.url);
    try {
      await mailer.sendMail({ from: fromAddress(), to: r.guest_email, subject, text, html });
      /* Marked only after the send resolves. The other order -- mark, then send -- loses the
         message silently if the send throws, and nobody ever finds out. This way a failure is
         retried on the next run, and the MAX_AGE_DAYS window stops it retrying forever. */
      await pool.query("UPDATE reservations SET review_request_sent_at = now() WHERE id = $1", [r.id]);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[review] could not send for ${r.reservation_code}:`, err.message);
    }
  }
  if (sent || failed) console.log(`[review] sent ${sent}, failed ${failed}`);
  return { sent, failed, skipped: null };
}

/* Hourly. The window is a whole day wide, so the exact minute does not matter, and an hourly tick
 * costs one indexed query against a table with a few hundred rows. Deliberately a plain interval
 * rather than a scheduler dependency: one container, same reasoning as middleware/rateLimit.js.
 * unref() so the timer never holds the process open on shutdown. */
const TICK_MS = 60 * 60 * 1000;

export function startReviewRequestJob() {
  const run = () =>
    sendDueReviewRequests().catch((err) => console.error("[review] job failed:", err.message));
  // Not at boot: a deploy restarts the process, and a crash-loop would otherwise mean a burst of
  // attempts. A few minutes in is soon enough for a once-a-day window.
  setTimeout(run, 5 * 60 * 1000).unref();
  setInterval(run, TICK_MS).unref();
}
