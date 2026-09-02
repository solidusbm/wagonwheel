import webpush from "web-push";
import { nanoid } from "nanoid";
import { pool } from "../db.js";
import { voiceConfigured, callAfterAttempt, placeAlertCall } from "./voiceCall.js";

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@wagonwheelrv.example",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

/* urgency:"high" is the one that matters on a phone. The default is "normal", which lets FCM and
   APNs hold the message until the device next wakes on its own -- a booking that lands at 2am can
   surface hours later, or after the batch it was folded into. "high" asks for immediate delivery
   and is what wakes an Android device out of Doze. TTL caps how long a push server holds an
   undelivered message: a day-old "new booking" alert is noise, so let it expire instead. */
const SEND_OPTIONS = { urgency: "high", TTL: 24 * 60 * 60 };

async function sendToAll(payload) {
  const { rows } = await pool.query("SELECT id, endpoint, p256dh, auth FROM push_subscriptions");

  const results = await Promise.all(
    rows.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        await webpush.sendNotification(subscription, payload, SEND_OPTIONS);
        return { ok: true };
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Browser has invalidated this subscription (uninstalled, permissions revoked, etc).
          await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]);
          return { ok: false, expired: true, error: "subscription expired, removed" };
        }
        console.error("[push] Failed to send to a subscription", err);
        return { ok: false, error: err.body?.trim() || err.message || String(err.statusCode) };
      }
    })
  );

  return {
    total: rows.length,
    sent: results.filter((r) => r.ok).length,
    expired: results.filter((r) => r.expired).length,
    errors: results.filter((r) => !r.ok && !r.expired).map((r) => r.error),
  };
}

// How many devices are currently signed up. Drives the admin readout -- "is the office's phone
// actually registered?" is otherwise unanswerable without taking a real booking to find out.
export async function subscriptionCount() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM push_subscriptions");
  return rows[0]?.n ?? 0;
}

/* How hard an alert pushes before it gives up. Every REMINDER_INTERVAL_MS an unacknowledged
   booking alert is re-sent, up to MAX_ATTEMPTS counting the first -- so one immediate alert and
   five reminders across the following twenty-five minutes, then silence and a loud log line.
   It stops on purpose rather than repeating forever: an alert nobody has acknowledged in half an
   hour is not going to be rescued by a sixth buzz, and a notification that can never be
   silenced is one the office learns to swipe away on reflex, which costs more than it buys. */
const REMINDER_INTERVAL_MS = 5 * 60 * 1000;
// Exported so the admin panel can say "alert 3 of 6" without keeping its own copy of the number.
export const MAX_ATTEMPTS = 6;

/* attempt is 1-based and changes the title from the second one on. A repeat must not look
   identical to the original -- "still unacknowledged" is the actual information, and without it a
   second buzz reads as a second booking. The tag stays the reservation code either way, so a
   repeat replaces its predecessor instead of stacking, and renotify in sw.js re-alerts on the
   swap rather than swapping it in silently. */
function alertPayload({ reservationCode, body, ackToken, attempt }) {
  return JSON.stringify({
    title: attempt > 1 ? `Still unacknowledged — booking ${reservationCode}` : `New booking ${reservationCode}`,
    body,
    url: "/admin",
    tag: `booking-${reservationCode}`,
    ackToken,
    attempt,
  });
}

// Fire-and-log, same as the email notification: a push failure should never
// fail a booking that already charged the card.
export async function notifyAdminPush(reservation) {
  if (!ensureConfigured()) {
    console.log("[push] VAPID keys not set - skipping push notification");
    return;
  }

  const body = `${reservation.site.name} · ${reservation.checkIn} → ${reservation.checkOut} · ${reservation.guest.name}`;
  const ackToken = nanoid();

  /* The row goes in before the send, not after. If the process dies mid-send the alert is still
     recorded as pending and the retry job picks it up a minute later; the other order loses it. */
  await pool.query(
    `INSERT INTO booking_alerts (reservation_code, ack_token, body, attempts, last_sent_at)
     VALUES ($1, $2, $3, 1, now())`,
    [reservation.reservationCode, ackToken, body]
  );

  const result = await sendToAll(
    alertPayload({ reservationCode: reservation.reservationCode, body, ackToken, attempt: 1 })
  );
  if (result.total === 0) console.log("[push] No devices subscribed - nothing sent");
}

/* The one-shot for bookings the office typed in itself -- deliberately NOT the repeat-until-
   acknowledged chain. That machinery exists to guarantee a human saw the booking, and for a
   manual entry a human typed it: the guarantee is satisfied by construction. This exists to keep
   the OTHER phones in the loop -- the owner hearing about a staff phone-in and vice versa -- so
   it is one notification, with nothing to acknowledge and nothing that repeats.
   "Office booking" in the title is load-bearing: a website booking is evidence the site earns its
   keep and a phone-in is not, and the two must not read alike on a lock screen. */
export async function notifyOfficeBookingPush(reservation) {
  if (!ensureConfigured()) {
    console.log("[push] VAPID keys not set - skipping office-booking push");
    return;
  }

  const payload = JSON.stringify({
    title: `Office booking ${reservation.reservationCode}`,
    body: `${reservation.site.name} · ${reservation.checkIn} → ${reservation.checkOut} · ${reservation.guest.name}`,
    url: "/admin",
    tag: `booking-${reservation.reservationCode}`,
  });

  const result = await sendToAll(payload);
  if (result.total === 0) console.log("[push] No devices subscribed - nothing sent");
}

/* One pass of the retry loop. Idempotent by construction: it selects only rows that are
   unacknowledged and overdue and stamps last_sent_at as it goes, so a second run straight after
   the first sends nothing. All the state is in the table, so this survives a restart mid-loop. */
export async function sendDueAlertReminders() {
  if (!ensureConfigured()) return;

  /* The cutoff is computed here rather than as `now() - ($2 * INTERVAL '1 millisecond')` in SQL.
     Postgres has to infer a type for a bare parameter inside interval arithmetic, and that is the
     kind of thing that resolves fine until the day it doesn't; a timestamp parameter has exactly
     one interpretation. Clock skew is not a concern -- the app and the database are the same box. */
  const dueBefore = new Date(Date.now() - REMINDER_INTERVAL_MS);

  const { rows } = await pool.query(
    `SELECT id, reservation_code, ack_token, body, attempts, call_placed_at
       FROM booking_alerts
      WHERE acknowledged_at IS NULL
        AND attempts < $1
        AND last_sent_at < $2
      ORDER BY last_sent_at`,
    [MAX_ATTEMPTS, dueBefore]
  );

  for (const row of rows) {
    const attempt = row.attempts + 1;
    /* Stamped before the send for the same reason the insert is: a send that throws must not leave
       the row looking due forever and re-fire on every tick. */
    await pool.query("UPDATE booking_alerts SET attempts = $1, last_sent_at = now() WHERE id = $2", [
      attempt,
      row.id,
    ]);
    await sendToAll(
      alertPayload({ reservationCode: row.reservation_code, body: row.body, ackToken: row.ack_token, attempt })
    );

    /* Escalate to a phone call, once. Gated on call_placed_at rather than on the attempt number
       alone so that a restart, a clock change, or a slow tick can't dial the office twice for one
       booking -- >= rather than === for the same reason, since an attempt can be skipped if the
       job was down when it came due. Stamped before dialling: a call that throws halfway is still
       a call that may have rung, and ringing twice is worse than not retrying. */
    if (voiceConfigured() && !row.call_placed_at && attempt >= callAfterAttempt()) {
      await pool.query("UPDATE booking_alerts SET call_placed_at = now() WHERE id = $1", [row.id]);
      const { placed } = await placeAlertCall(row.ack_token);
      console.log(`[voice] Booking ${row.reservation_code} unacknowledged at attempt ${attempt} - called ${placed} number(s)`);
    }

    if (attempt >= MAX_ATTEMPTS) {
      console.error(
        `[push] Booking ${row.reservation_code} went unacknowledged through ${MAX_ATTEMPTS} alerts - giving up. ` +
          "Confirm by some other route that the office knows about it."
      );
    }
  }
}

/* The full lifecycle, not just transport: inserts a real booking_alerts row, so the drill repeats
   every five minutes, shows in the pending panel, escalates to the phone call at the usual attempt
   when SignalWire is configured, and stops the moment anyone acknowledges it -- exactly what a
   missed real booking does. After a drill, the only untested piece left is the booking insert
   itself, which Square's production-only setup makes expensive to rehearse.

   Any older drill still shouting is acknowledged first. Two drills repeating over each other teach
   people to swipe the notification away, which is the exact reflex this system exists to avoid. */
export async function startAlertDrill() {
  if (!ensureConfigured()) {
    throw new Error("VAPID keys are not set on the server — push notifications are switched off.");
  }

  const total = await subscriptionCount();
  if (total === 0) {
    throw new Error(
      "No devices are signed up yet. Press “Enable on this device” on each phone that should get alerts."
    );
  }

  await pool.query(
    `UPDATE booking_alerts SET acknowledged_at = now(), acknowledged_via = 'superseded-by-new-drill'
      WHERE reservation_code LIKE 'TEST-DRILL%' AND acknowledged_at IS NULL`
  );

  const reservationCode = `TEST-DRILL-${nanoid().replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase()}`;
  const body =
    "This is a drill, not a booking. Ignore it once — a repeat should arrive in about five minutes. Tap “Got it” to end it.";
  const ackToken = nanoid();

  await pool.query(
    `INSERT INTO booking_alerts (reservation_code, ack_token, body, attempts, last_sent_at)
     VALUES ($1, $2, $3, 1, now())`,
    [reservationCode, ackToken, body]
  );

  return sendToAll(alertPayload({ reservationCode, body, ackToken, attempt: 1 }));
}

/* An already-acknowledged token is deliberately not an error. Two phones can both tap "Got it" on
   the same alert, and the loser of that race should be a quiet no-op rather than a failure the
   device treats as worth retrying. */
export async function acknowledgeAlert(token, via) {
  const { rows } = await pool.query(
    `UPDATE booking_alerts
        SET acknowledged_at = now(), acknowledged_via = $2
      WHERE ack_token = $1 AND acknowledged_at IS NULL
      RETURNING reservation_code`,
    [token, via]
  );
  return rows[0]?.reservation_code ?? null;
}

// Looked up by the cXML endpoints when SignalWire connects the call, to speak the right booking.
export async function alertByToken(token) {
  const { rows } = await pool.query(
    "SELECT reservation_code, body, acknowledged_at FROM booking_alerts WHERE ack_token = $1",
    [token]
  );
  return rows[0] ?? null;
}

// Drives the admin readout, so a still-shouting alert is visible on the page as well -- the
// notification itself may already have been swiped away by the time anyone goes looking.
export async function pendingBookingAlerts() {
  const { rows } = await pool.query(
    `SELECT reservation_code, body, attempts, created_at, ack_token
       FROM booking_alerts
      WHERE acknowledged_at IS NULL
      ORDER BY created_at DESC`
  );
  return rows;
}

/* Same shape as startReviewRequestJob(): a bare timer, one container, unref()'d so it never holds
   the process open at shutdown. Ticks every minute for one-minute granularity on a five-minute
   interval; the overdue check lives in the query, not the timer. Delayed at boot because a deploy
   restarts the process and a crash-loop should not become a burst of repeat alerts. */
export function startBookingAlertJob() {
  const run = () =>
    sendDueAlertReminders().catch((err) => console.error("[push] reminder job failed:", err.message));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 1000).unref();
}

/* Prove push works without waiting for a real booking to test it, mirroring sendTestEmail().
   Throws rather than swallowing, because surfacing the failure is the entire point. */
export async function sendTestPush() {
  if (!ensureConfigured()) {
    throw new Error("VAPID keys are not set on the server — push notifications are switched off.");
  }

  const total = await subscriptionCount();
  if (total === 0) {
    throw new Error(
      "No devices are signed up yet. Press “Enable on this device” on each phone that should get alerts."
    );
  }

  const payload = JSON.stringify({
    title: "Wagon Wheel — test alert",
    body: "If you can see this, new bookings will reach this device.",
    url: "/admin",
    tag: "wagonwheel-test",
  });

  return sendToAll(payload);
}
