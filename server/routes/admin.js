import { Router } from "express";
import { pool } from "../db.js";
import { quote } from "../lib/pricing.js";
import { generateReservationCode } from "../lib/reservationCode.js";

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["pending", "confirmed", "cancelled"];

const SITE_SELECT = `
  SELECT s.*, COALESCE(am.ids, '[]'::json) AS amenity_ids
  FROM sites s
  LEFT JOIN LATERAL (
    SELECT json_agg(sa.amenity_id ORDER BY sa.amenity_id) AS ids
    FROM site_amenities sa WHERE sa.site_id = s.id
  ) am ON true
`;

function mapSite(row) {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    ampService: row.amp_service,
    pullThrough: row.pull_through,
    maxRigLength: row.max_rig_length,
    petFriendly: row.pet_friendly,
    pricePerNightCents: row.price_per_night_cents,
    pricePerWeekCents: row.price_per_week_cents,
    notes: row.notes,
    active: row.active,
    sortOrder: row.sort_order,
    amenityIds: row.amenity_ids,
  };
}

function mapAmenity(row) {
  return { id: row.id, name: row.name, sortOrder: row.sort_order, active: row.active };
}

function mapReservation(row) {
  return {
    reservationCode: row.reservation_code,
    status: row.status,
    site: { id: row.site_id, name: row.site_name, area: row.area },
    guest: { name: row.guest_name, email: row.guest_email, phone: row.guest_phone, numGuests: row.num_guests },
    notes: row.notes,
    applicationDetails: row.application_details ?? null,
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
         r.application_details,
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
      "SELECT id, price_per_night_cents, price_per_week_cents FROM sites WHERE id = $1 AND active = true",
      [siteId]
    );
    const site = siteResult.rows[0];
    if (!site) {
      return res.status(404).json({ error: "Site not found" });
    }

    const { nights, subtotalCents, bookingFeeCents, totalCents } = quote({
      pricePerNightCents: site.price_per_night_cents,
      pricePerWeekCents: site.price_per_week_cents,
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
          application_details, check_in, check_out, subtotal_cents, booking_fee_cents, total_cents, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        siteId,
        reservationCode,
        guest.name,
        guest.email,
        guest.phone ?? null,
        guest.numGuests ?? 1,
        guest.notes ?? null,
        guest.application ? JSON.stringify(guest.application) : null,
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
      `SELECT r.*, r.check_in::text AS check_in_text, r.check_out::text AS check_out_text,
              s.price_per_night_cents, s.price_per_week_cents
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
    let pricePerWeekCents = existing.price_per_week_cents;
    if (siteId !== undefined && siteId !== existing.site_id) {
      const siteResult = await client.query(
        "SELECT price_per_night_cents, price_per_week_cents FROM sites WHERE id = $1 AND active = true",
        [siteId]
      );
      if (!siteResult.rows[0]) {
        return res.status(404).json({ error: "Site not found" });
      }
      pricePerNightCents = siteResult.rows[0].price_per_night_cents;
      pricePerWeekCents = siteResult.rows[0].price_per_week_cents;
    }

    const { nights, subtotalCents, bookingFeeCents, totalCents } = quote({
      pricePerNightCents,
      pricePerWeekCents,
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

/* ---------- sites (park layout, rates, per-site amenity toggles) ---------- */

router.get("/sites", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${SITE_SELECT} ORDER BY s.sort_order`);
    res.json(rows.map(mapSite));
  } catch (err) {
    next(err);
  }
});

router.post("/sites", async (req, res, next) => {
  const { name, area, ampService, pullThrough, maxRigLength, petFriendly, pricePerNightCents, pricePerWeekCents, notes, sortOrder, amenityIds } =
    req.body ?? {};

  if (!name?.trim() || !area?.trim()) {
    return res.status(400).json({ error: "name and area are required" });
  }
  if (!Number.isInteger(pricePerNightCents)) {
    return res.status(400).json({ error: "pricePerNightCents is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO sites (name, area, amp_service, pull_through, max_rig_length, pet_friendly, price_per_night_cents, price_per_week_cents, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        name.trim(),
        area.trim(),
        ampService ?? "30/50",
        !!pullThrough,
        maxRigLength ?? null,
        petFriendly ?? true,
        pricePerNightCents,
        pricePerWeekCents ?? null,
        notes ?? null,
        Number.isInteger(sortOrder) ? sortOrder : 0,
      ]
    );
    const siteId = rows[0].id;
    if (Array.isArray(amenityIds) && amenityIds.length) {
      await client.query(`INSERT INTO site_amenities (site_id, amenity_id) SELECT $1, UNNEST($2::int[])`, [siteId, amenityIds]);
    }
    await client.query("COMMIT");

    const { rows: siteRows } = await pool.query(`${SITE_SELECT} WHERE s.id = $1`, [siteId]);
    res.status(201).json(mapSite(siteRows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

router.patch("/sites/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid site id" });
  }
  const { name, area, ampService, pullThrough, maxRigLength, petFriendly, pricePerNightCents, pricePerWeekCents, notes, active, sortOrder, amenityIds } =
    req.body ?? {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query("SELECT * FROM sites WHERE id = $1 FOR UPDATE", [id]);
    const existing = existingResult.rows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Site not found" });
    }

    await client.query(
      `UPDATE sites SET
         name = $1, area = $2, amp_service = $3, pull_through = $4, max_rig_length = $5,
         pet_friendly = $6, price_per_night_cents = $7, price_per_week_cents = $8,
         notes = $9, active = $10, sort_order = $11
       WHERE id = $12`,
      [
        name?.trim() || existing.name,
        area?.trim() || existing.area,
        ampService ?? existing.amp_service,
        pullThrough !== undefined ? pullThrough : existing.pull_through,
        maxRigLength !== undefined ? maxRigLength : existing.max_rig_length,
        petFriendly !== undefined ? petFriendly : existing.pet_friendly,
        pricePerNightCents ?? existing.price_per_night_cents,
        pricePerWeekCents !== undefined ? pricePerWeekCents : existing.price_per_week_cents,
        notes !== undefined ? notes : existing.notes,
        active !== undefined ? active : existing.active,
        Number.isInteger(sortOrder) ? sortOrder : existing.sort_order,
        id,
      ]
    );

    if (Array.isArray(amenityIds)) {
      await client.query("DELETE FROM site_amenities WHERE site_id = $1", [id]);
      if (amenityIds.length) {
        await client.query(`INSERT INTO site_amenities (site_id, amenity_id) SELECT $1, UNNEST($2::int[])`, [id, amenityIds]);
      }
    }

    await client.query("COMMIT");
    const { rows } = await pool.query(`${SITE_SELECT} WHERE s.id = $1`, [id]);
    res.json(mapSite(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/* ---------- global amenity catalog ---------- */

router.get("/amenities", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, name, sort_order, active FROM amenities ORDER BY sort_order, name");
    res.json(rows.map(mapAmenity));
  } catch (err) {
    next(err);
  }
});

router.post("/amenities", async (req, res, next) => {
  const { name } = req.body ?? {};
  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO amenities (name, sort_order)
       VALUES ($1, COALESCE((SELECT MAX(sort_order) + 1 FROM amenities), 0))
       RETURNING id, name, sort_order, active`,
      [name.trim()]
    );
    res.status(201).json(mapAmenity(rows[0]));
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An amenity with that name already exists" });
    }
    next(err);
  }
});

router.patch("/amenities/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid amenity id" });
  }
  const { name, active } = req.body ?? {};
  try {
    const existingResult = await pool.query("SELECT * FROM amenities WHERE id = $1", [id]);
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ error: "Amenity not found" });
    }
    const { rows } = await pool.query(`UPDATE amenities SET name = $1, active = $2 WHERE id = $3 RETURNING id, name, sort_order, active`, [
      name?.trim() || existing.name,
      active !== undefined ? active : existing.active,
      id,
    ]);
    res.json(mapAmenity(rows[0]));
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An amenity with that name already exists" });
    }
    next(err);
  }
});

router.delete("/amenities/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid amenity id" });
  }
  try {
    await pool.query("DELETE FROM amenities WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
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
