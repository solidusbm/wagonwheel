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

// Fire-and-log, same as the email notification: a push failure should never
// fail a booking that already charged the card.
export async function notifyAdminPush(reservation) {
  if (!ensureConfigured()) {
    console.log("[push] VAPID keys not set - skipping push notification");
    return;
  }

  const { rows } = await pool.query("SELECT id, endpoint, p256dh, auth FROM push_subscriptions");
  if (rows.length === 0) return;

  const payload = JSON.stringify({
    title: `New booking ${reservation.reservationCode}`,
    body: `${reservation.site.name} · ${reservation.checkIn} → ${reservation.checkOut} · ${reservation.guest.name}`,
    url: "/admin",
  });

  await Promise.all(
    rows.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        await webpush.sendNotification(subscription, payload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Browser has invalidated this subscription (uninstalled, permissions revoked, etc).
          await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]);
        } else {
          console.error("[push] Failed to send to a subscription", err);
        }
      }
    })
  );
}
