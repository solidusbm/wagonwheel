import { Router } from "express";
import { pool } from "../db.js";
import { quote } from "../lib/pricing.js";
import { chargeCard, SquareError } from "../lib/square.js";
import { notifyAdminOfBooking } from "../lib/email.js";
import { notifyAdminPush } from "../lib/push.js";
import { generateReservationCode } from "../lib/reservationCode.js";

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.post("/", async (req, res, next) => {
  const { siteId, checkIn, checkOut, guest, sourceId, idempotencyKey } = req.body ?? {};

  if (!Number.isInteger(siteId)) {
    return res.status(400).json({ error: "siteId is required" });
  }
  if (!DATE_RE.test(checkIn ?? "") || !DATE_RE.test(checkOut ?? "") || checkOut <= checkIn) {
    return res.status(400).json({ error: "Invalid checkIn/checkOut" });
  }
  if (!guest?.name || !guest?.email) {
    return res.status(400).json({ error: "Guest name and email are required" });
  }
  if (!sourceId) {
    return res.status(400).json({ error: "sourceId (card token) is required" });
  }

  const client = await pool.connect();
  try {
    const siteResult = await client.query(
      "SELECT id, name, area, price_per_night_cents FROM sites WHERE id = $1 AND active = true",
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
    let reservationId;

    try {
      await client.query("BEGIN");
      const insertResult = await client.query(
        `INSERT INTO reservations
           (site_id, reservation_code, guest_name, guest_email, guest_phone, num_guests, notes,
            check_in, check_out, subtotal_cents, booking_fee_cents, total_cents, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')
         RETURNING id`,
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
        ]
      );
      reservationId = insertResult.rows[0].id;
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23P01") {
        // Exclusion constraint violation: someone else booked this range first.
        return res.status(409).json({ error: "That site is no longer available for those dates" });
      }
      throw err;
    }

    try {
      const { paymentId } = await chargeCard({
        sourceId,
        amountCents: totalCents,
        idempotencyKey: idempotencyKey ?? reservationCode,
        referenceId: reservationCode,
        note: `Wagon Wheel RV Park - ${reservationCode}`,
      });

      await client.query(
        `UPDATE reservations SET status = 'confirmed', square_payment_id = $1, updated_at = now() WHERE id = $2`,
        [paymentId, reservationId]
      );

      const confirmedReservation = {
        reservationCode,
        status: "confirmed",
        site: { id: site.id, name: site.name, area: site.area },
        guest: { name: guest.name, email: guest.email, phone: guest.phone ?? null, numGuests: guest.numGuests ?? 1 },
        checkIn,
        checkOut,
        nights,
        subtotalCents,
        bookingFeeCents,
        totalCents,
      };

      await notifyAdminOfBooking(confirmedReservation);
      await notifyAdminPush(confirmedReservation);

      return res.status(201).json(confirmedReservation);
    } catch (paymentErr) {
      // Freeing the row (status != pending/confirmed) releases the exclusion-constraint hold
      // on this date range so someone else can book it.
      await client.query(
        `UPDATE reservations SET status = 'cancelled', updated_at = now() WHERE id = $1`,
        [reservationId]
      );
      const message = paymentErr instanceof SquareError ? paymentErr.message : "Payment failed";
      return res.status(402).json({ error: message });
    }
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

router.get("/:code", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.reservation_code, r.status, r.guest_name, r.guest_email, r.guest_phone, r.num_guests,
              r.check_in, r.check_out, r.subtotal_cents, r.booking_fee_cents, r.total_cents,
              s.id AS site_id, s.name AS site_name, s.area
       FROM reservations r
       JOIN sites s ON s.id = r.site_id
       WHERE r.reservation_code = $1 AND r.status = 'confirmed'`,
      [req.params.code.toUpperCase()]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ error: "Reservation not found" });
    }
    res.json({
      reservationCode: row.reservation_code,
      status: row.status,
      site: { id: row.site_id, name: row.site_name, area: row.area },
      guest: { name: row.guest_name, email: row.guest_email, phone: row.guest_phone, numGuests: row.num_guests },
      checkIn: row.check_in,
      checkOut: row.check_out,
      subtotalCents: row.subtotal_cents,
      bookingFeeCents: row.booking_fee_cents,
      totalCents: row.total_cents,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
