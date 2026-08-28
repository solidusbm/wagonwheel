import webpush from "web-push";
import { pool } from "../db.js";

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

// Fire-and-log, same as the email notification: a push failure should never
// fail a booking that already charged the card.
export async function notifyAdminPush(reservation) {
  if (!ensureConfigured()) {
    console.log("[push] VAPID keys not set - skipping push notification");
    return;
  }

  const payload = JSON.stringify({
    title: `New booking ${reservation.reservationCode}`,
    body: `${reservation.site.name} · ${reservation.checkIn} → ${reservation.checkOut} · ${reservation.guest.name}`,
    url: "/admin",
    // One notification per booking. Re-sending the same code replaces the earlier one instead of
    // stacking a duplicate; two different bookings stay two separate alerts.
    tag: `booking-${reservation.reservationCode}`,
  });

  const result = await sendToAll(payload);
  if (result.total === 0) console.log("[push] No devices subscribed - nothing sent");
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
