import { Router } from "express";
import { pool } from "../db.js";
import { quote } from "../lib/pricing.js";
import { generateReservationCode } from "../lib/reservationCode.js";

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["pending", "confirmed", "cancelled"];

function mapReservation(row) {
  return {
    reservationCode: row.reservation_code,
    status: row.status,
    site: { id: row.site_id, name: row.site_name, area: row.area },
    guest: { name: row.guest_name, email: row.guest_email, phone: row.guest_phone, numGuests: row.num_guests },
    notes: row.notes,
    checkIn: row.check_in,
    checkOut: row.check_out,
    subtotalCents: row.subtotal_cents,
    bookingFeeCents: row.booking_fee_cents,
    totalCents: row.total_cents,
    createdAt: row.created_at,
  };
}

const SELECT_RESERVATION = `
  SELECT r.reservation_code, r.status, r.guest_name, r.guest_email, r.guest_phone, r.num_guests, r.notes,
         r.check_in::text AS check_in, r.check_out::text AS check_out,
         r.subtotal_cents, r.booking_fee_cents, r.total_cents, r.created_at,
         s.id AS site_id, s.name AS site_name, s.area
  FROM reservations r
  JOIN sites s ON s.id = r.site_id
`;

router.get("/reservations", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `${SELECT_RESERVATION} WHERE r.status IN ('pending', 'confirmed') ORDER BY r.check_in ASC`
    );
    res.json(rows.map(mapReservation));
  } catch (err) {
    next(err);
  }
});

// Admin-created bookings (phone/walk-in) skip Square entirely -- the office collected
// payment some other way, so this just reserves the site at the normal nightly rate.
router.post("/reservations", async (req, res, next) => {
  const { siteId, checkIn, checkOut, guest, status } = req.body ?? {};

  if (!Number.isInteger(siteId)) {
    return res.status(400).json({ error: "siteId is required" });
  }
  if (!DATE_RE.test(checkIn ?? "") || !DATE_RE.test(checkOut ?? "") || checkOut <= checkIn) {
    return res.status(400).json({ error: "Invalid checkIn/checkOut" });
  }
  if (!guest?.name || !guest?.email) {
    return res.status(400).json({ error: "Guest name and email are required" });
  }
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const client = await pool.connect();
  try {
    const siteResult = await client.query(
      "SELECT id, price_per_night_cents FROM sites WHERE id = $1 AND active = true",
      [siteId]
    );
    const site = siteResult.rows[0];
    if (!site) {
      return res.status(404).json({ error: "Site not found" });
    }

    const { nights, subtotalCents, bookingFeeCents, totalCents } = quote({
      pricePerNightCents: site.price_per_night_cents,
      checkIn,
      checkOut,
    });
    if (nights < 1) {
      return res.status(400).json({ error: "Stay must be at least 1 night" });
    }

    const reservationCode = generateReservationCode();
    await client.query(
      `INSERT INTO reservations
         (site_id, reservation_code, guest_name, guest_email, guest_phone, num_guests, notes,
          check_in, check_out, subtotal_cents, booking_fee_cents, total_cents, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        siteId,
        reservationCode,
        guest.name,
        guest.email,
        guest.phone ?? null,
        guest.numGuests ?? 1,
        guest.notes ?? null,
        checkIn,
        checkOut,
        subtotalCents,
        bookingFeeCents,
        totalCents,
        status ?? "confirmed",
      ]
    );

    const { rows } = await client.query(`${SELECT_RESERVATION} WHERE r.reservation_code = $1`, [reservationCode]);
    res.status(201).json(mapReservation(rows[0]));
  } catch (err) {
    if (err.code === "23P01") {
      return res.status(409).json({ error: "That site is already booked for those dates" });
    }
    next(err);
  } finally {
    client.release();
  }
});

// Reschedules, reassigns, or cancels an existing reservation. Any of siteId/checkIn/checkOut/
// guest/status may be omitted to leave that part unchanged; price is recomputed whenever the
// site or dates change.
router.patch("/reservations/:code", async (req, res, next) => {
  const code = req.params.code.toUpperCase();
  const { siteId, checkIn, checkOut, guest, status } = req.body ?? {};

  if (checkIn && !DATE_RE.test(checkIn)) {
    return res.status(400).json({ error: "Invalid checkIn" });
  }
  if (checkOut && !DATE_RE.test(checkOut)) {
    return res.status(400).json({ error: "Invalid checkOut" });
  }
  if (siteId !== undefined && !Number.isInteger(siteId)) {
    return res.status(400).json({ error: "siteId must be an integer" });
  }
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const client = await pool.connect();
  try {
    const existingResult = await client.query(
      `SELECT r.*, r.check_in::text AS check_in_text, r.check_out::text AS check_out_text, s.price_per_night_cents
       FROM reservations r JOIN sites s ON s.id = r.site_id WHERE r.reservation_code = $1`,
      [code]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ error: "Reservation not found" });
    }

    const nextSiteId = siteId ?? existing.site_id;
    const nextCheckIn = checkIn ?? existing.check_in_text;
    const nextCheckOut = checkOut ?? existing.check_out_text;
    const nextStatus = status ?? existing.status;
    if (nextCheckOut <= nextCheckIn) {
      return res.status(400).json({ error: "checkOut must be after checkIn" });
    }

    let pricePerNightCents = existing.price_per_night_cents;
    if (siteId !== undefined && siteId !== existing.site_id) {
      const siteResult = await client.query(
        "SELECT price_per_night_cents FROM sites WHERE id = $1 AND active = true",
        [siteId]
      );
      if (!siteResult.rows[0]) {
        return res.status(404).json({ error: "Site not found" });
      }
      pricePerNightCents = siteResult.rows[0].price_per_night_cents;
    }

    const { nights, subtotalCents, bookingFeeCents, totalCents } = quote({
      pricePerNightCents,
      checkIn: nextCheckIn,
      checkOut: nextCheckOut,
    });
    if (nights < 1) {
      return res.status(400).json({ error: "Stay must be at least 1 night" });
    }

    await client.query(
      `UPDATE reservations SET
         site_id = $1, check_in = $2, check_out = $3,
         guest_name = $4, guest_email = $5, guest_phone = $6, num_guests = $7, notes = $8,
         subtotal_cents = $9, booking_fee_cents = $10, total_cents = $11,
         status = $12, updated_at = now()
       WHERE reservation_code = $13`,
      [
        nextSiteId,
        nextCheckIn,
        nextCheckOut,
        guest?.name ?? existing.guest_name,
        guest?.email ?? existing.guest_email,
        guest?.phone !== undefined ? guest.phone : existing.guest_phone,
        guest?.numGuests ?? existing.num_guests,
        guest?.notes !== undefined ? guest.notes : existing.notes,
        subtotalCents,
        bookingFeeCents,
        totalCents,
        nextStatus,
        code,
      ]
    );

    const { rows } = await client.query(`${SELECT_RESERVATION} WHERE r.reservation_code = $1`, [code]);
    res.json(mapReservation(rows[0]));
  } catch (err) {
    if (err.code === "23P01") {
      return res.status(409).json({ error: "That site is already booked for those dates" });
    }
    next(err);
  } finally {
    client.release();
  }
});

router.get("/push/vapid-public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
});

router.post("/push/subscribe", async (req, res, next) => {
  const { endpoint, keys } = req.body?.subscription ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: "Invalid push subscription" });
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
       VALUES ($1, $2, $3)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [endpoint, keys.p256dh, keys.auth]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/push/unsubscribe", async (req, res, next) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) {
    return res.status(400).json({ error: "endpoint is required" });
  }
  try {
    await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
