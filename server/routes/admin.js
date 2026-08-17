import { Router } from "express";
import multer from "multer";
import { pool } from "../db.js";
import { quote, cancellationQuote, isPriceable } from "../lib/pricing.js";
import { generateReservationCode } from "../lib/reservationCode.js";
import { applySchema, applySeed, applyContentSeed, sitesCount } from "../lib/dbBootstrap.js";
import { mailConfigStatus, sendTestEmail, sendSampleGuestEmail } from "../lib/email.js";
import { listLocations, refundPayment } from "../lib/square.js";
import { shrinkImage } from "../lib/imageResize.js";
import { readLayout, writeLayout, FEATURE_KINDS } from "../lib/parkLayout.js";
import {
  reviewSettings,
  blockedReason,
  reviewEmail,
  sendDueReviewRequests,
} from "../lib/reviewRequest.js";
import { getTransporter, fromAddress } from "../lib/email.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAGES,
  DESC_PREFIX,
  KEY_INDEXING,
  KEY_SHARE_PHOTO,
  KEY_GOOGLE_VERIFICATION,
  ORIGIN,
  descriptionFor,
  titleOf,
  snapshot,
  invalidateSnapshot,
} from "../lib/seo.js";

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["pending", "confirmed", "cancelled"];

// Photos are stored in Postgres (BYTEA), not on disk -- Render's free-tier filesystem is
// wiped on every deploy/restart. Memory storage + a size cap keeps that from growing
// unbounded against the database's 1GB free-tier storage limit.
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

const SITE_SELECT = `
  SELECT s.*, COALESCE(am.ids, '[]'::json) AS amenity_ids, COALESCE(ph.ids, '[]'::json) AS photo_ids
  FROM sites s
  LEFT JOIN LATERAL (
    SELECT json_agg(sa.amenity_id ORDER BY sa.amenity_id) AS ids
    FROM site_amenities sa WHERE sa.site_id = s.id
  ) am ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(sp.photo_id ORDER BY sp.sort_order, sp.photo_id) AS ids
    FROM site_photos sp WHERE sp.site_id = s.id
  ) ph ON true
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
    pricePerMonthCents: row.price_per_month_cents,
    notes: row.notes,
    active: row.active,
    permanentlyOccupied: row.permanently_occupied,
    sortOrder: row.sort_order,
    amenityIds: row.amenity_ids,
    photoIds: row.photo_ids,
  };
}

/* null on a rate means "N/A -- this site isn't sold by that term": Site 1 is rented by the month
   only, so its nightly and weekly rates are null. None of the three is individually required.
   What IS required is that at least one survives -- a site with all three N/A is inventory
   nobody can price, and it would fail at checkout rather than at save time. Returns a message
   fit to show the office, or null if the rates are fine. */
function rateProblem(rates) {
  for (const [key, value] of Object.entries(rates)) {
    if (value === null || value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      return `${key} must be a whole number of cents, or N/A`;
    }
  }
  if (!isPriceable(rates)) {
    return "A site needs at least one rate — nightly, weekly, or monthly. They can't all be N/A.";
  }
  return null;
}

function mapAmenity(row) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    active: row.active,
    showOnHomepage: row.show_on_homepage,
    showPerSite: row.show_per_site,
  };
}

function mapPhoto(row) {
  return { id: row.id, caption: row.caption, showOnHomepage: row.show_on_homepage, sortOrder: row.sort_order };
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
    // Null for admin-entered walk-ins, which never touch Square. For a guest booking it is the
    // only link back to the Square transaction -- without it, reconciling a disputed charge means
    // matching on timestamp and amount alone.
    squarePaymentId: row.square_payment_id ?? null,
    monthlyRateApplied: row.monthly_rate_applied ?? false,
    squareRefundId: row.square_refund_id ?? null,
    refundedCents: row.refunded_cents ?? null,
    cancellationFeeCents: row.cancellation_fee_cents ?? null,
    createdAt: row.created_at,
  };
}

const SELECT_RESERVATION = `
  SELECT r.reservation_code, r.status, r.guest_name, r.guest_email, r.guest_phone, r.num_guests, r.notes,
         r.application_details,
         r.check_in::text AS check_in, r.check_out::text AS check_out,
         r.subtotal_cents, r.booking_fee_cents, r.total_cents, r.created_at, r.square_payment_id,
         r.monthly_rate_applied, r.square_refund_id, r.refunded_cents, r.cancellation_fee_cents,
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
      "SELECT id, price_per_night_cents, price_per_week_cents, price_per_month_cents FROM sites WHERE id = $1 AND active = true",
      [siteId]
    );
    const site = siteResult.rows[0];
    if (!site) {
      return res.status(404).json({ error: "Site not found" });
    }

    const rates = {
      pricePerNightCents: site.price_per_night_cents,
      pricePerWeekCents: site.price_per_week_cents,
      pricePerMonthCents: site.price_per_month_cents,
    };
    if (!isPriceable(rates)) {
      return res.status(400).json({ error: "That site has no rates set, so a stay can't be priced." });
    }

    const { nights, subtotalCents, bookingFeeCents, totalCents, monthlyRateApplied } = quote({
      ...rates,
      checkIn,
      checkOut,
    });
    if (nights < 1) {
      return res.status(400).json({ error: "Stay must be at least 1 night" });
    }

    // monthly_rate_applied decides which cancellation fee this booking carries ($100 flat vs
    // 11.11%). A phone-in keyed here has to record it just like a web booking does, or a
    // long-stay guest gets refunded on the wrong terms.
    const reservationCode = generateReservationCode();
    await client.query(
      `INSERT INTO reservations
         (site_id, reservation_code, guest_name, guest_email, guest_phone, num_guests, notes,
          application_details, check_in, check_out, subtotal_cents, booking_fee_cents, total_cents,
          monthly_rate_applied, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
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
        monthlyRateApplied,
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
              s.price_per_night_cents, s.price_per_week_cents, s.price_per_month_cents
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
    let pricePerMonthCents = existing.price_per_month_cents;
    if (siteId !== undefined && siteId !== existing.site_id) {
      const siteResult = await client.query(
        "SELECT price_per_night_cents, price_per_week_cents, price_per_month_cents FROM sites WHERE id = $1 AND active = true",
        [siteId]
      );
      if (!siteResult.rows[0]) {
        return res.status(404).json({ error: "Site not found" });
      }
      pricePerNightCents = siteResult.rows[0].price_per_night_cents;
      pricePerWeekCents = siteResult.rows[0].price_per_week_cents;
      pricePerMonthCents = siteResult.rows[0].price_per_month_cents;
    }

    if (!isPriceable({ pricePerNightCents, pricePerWeekCents, pricePerMonthCents })) {
      return res.status(400).json({ error: "That site has no rates set, so a stay can't be priced." });
    }

    const { nights, subtotalCents, bookingFeeCents, totalCents, monthlyRateApplied } = quote({
      pricePerNightCents,
      pricePerWeekCents,
      pricePerMonthCents,
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
         monthly_rate_applied = $12,
         status = $13, updated_at = now()
       WHERE reservation_code = $14`,
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
        monthlyRateApplied,
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

/* One reservation by code, whatever its status. The list route above deliberately returns only
   pending/confirmed bookings, but the printable application sheet has to be able to print a
   cancelled one too -- the paper record outlives the booking. */
router.get("/reservations/:code", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${SELECT_RESERVATION} WHERE r.reservation_code = $1`, [
      req.params.code.toUpperCase(),
    ]);
    if (!rows[0]) return res.status(404).json({ error: "Reservation not found" });
    res.json(mapReservation(rows[0]));
  } catch (err) {
    next(err);
  }
});

/* Replaces a reservation's guest application wholesale.
 *
 * Deliberately NOT folded into PATCH /reservations/:code. That route re-prices the stay from the
 * site and dates on every call, and correcting a typo in someone's licence plate has no business
 * touching what they were charged -- particularly now that a re-quote can flip
 * monthly_rate_applied and with it the cancellation fee they were quoted. This endpoint writes one
 * column and nothing else.
 *
 * The body is stored as given (after a shape check). The client normalises it with normalise()
 * from admin/js/application-schema.js so an edited record is indistinguishable from one a guest
 * submitted; the guard here is about not letting a malformed body into a JSONB column, not about
 * re-deriving that shape server-side. */
router.put("/reservations/:code/application", async (req, res, next) => {
  const code = req.params.code.toUpperCase();
  const { application } = req.body ?? {};

  if (application !== null && (typeof application !== "object" || Array.isArray(application))) {
    return res.status(400).json({ error: "application must be an object, or null to clear it" });
  }
  for (const key of ["occupants", "vehicles", "pets"]) {
    if (application && application[key] !== undefined && !Array.isArray(application[key])) {
      return res.status(400).json({ error: `application.${key} must be an array` });
    }
  }

  try {
    const { rows } = await pool.query(
      `UPDATE reservations SET application_details = $1, updated_at = now()
       WHERE reservation_code = $2 RETURNING reservation_code`,
      [application ? JSON.stringify(application) : null, code]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Reservation not found" });
    }
    const { rows: full } = await pool.query(`${SELECT_RESERVATION} WHERE r.reservation_code = $1`, [code]);
    res.json(mapReservation(full[0]));
  } catch (err) {
    next(err);
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
  const { name, area, ampService, pullThrough, maxRigLength, petFriendly, pricePerNightCents, pricePerWeekCents, pricePerMonthCents, notes, sortOrder, amenityIds, photoIds, permanentlyOccupied } =
    req.body ?? {};

  if (!name?.trim() || !area?.trim()) {
    return res.status(400).json({ error: "name and area are required" });
  }
  const badRates = rateProblem({
    pricePerNightCents: pricePerNightCents ?? null,
    pricePerWeekCents: pricePerWeekCents ?? null,
    pricePerMonthCents: pricePerMonthCents ?? null,
  });
  if (badRates) {
    return res.status(400).json({ error: badRates });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO sites (name, area, amp_service, pull_through, max_rig_length, pet_friendly, price_per_night_cents, price_per_week_cents, price_per_month_cents, notes, sort_order, permanently_occupied)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        name.trim(),
        area.trim(),
        ampService ?? "30/50",
        !!pullThrough,
        maxRigLength ?? null,
        petFriendly ?? true,
        pricePerNightCents ?? null,
        pricePerWeekCents ?? null,
        pricePerMonthCents ?? null,
        notes ?? null,
        Number.isInteger(sortOrder) ? sortOrder : 0,
        !!permanentlyOccupied,
      ]
    );
    const siteId = rows[0].id;
    if (Array.isArray(amenityIds) && amenityIds.length) {
      await client.query(`INSERT INTO site_amenities (site_id, amenity_id) SELECT $1, UNNEST($2::int[])`, [siteId, amenityIds]);
    }
    // WITH ORDINALITY keeps the order the office arranged them in, rather than the array's
    // arbitrary insert order deciding which photo leads on the site card.
    if (Array.isArray(photoIds) && photoIds.length) {
      await client.query(
        `INSERT INTO site_photos (site_id, photo_id, sort_order)
         SELECT $1, p.id, p.ord FROM UNNEST($2::int[]) WITH ORDINALITY AS p(id, ord)`,
        [siteId, photoIds]
      );
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
  const { name, area, ampService, pullThrough, maxRigLength, petFriendly, pricePerNightCents, pricePerWeekCents, pricePerMonthCents, notes, active, sortOrder, amenityIds, photoIds, permanentlyOccupied } =
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

    /* Every rate is `!== undefined ? incoming : existing`, never `incoming ?? existing`: a null
       here is the office deliberately setting that term to N/A, and `??` would treat it as
       "unchanged" and silently keep the old rate. The check runs against the MERGED rates, since
       clearing one field is only invalid in light of what the other two already are. */
    const nextRates = {
      pricePerNightCents: pricePerNightCents !== undefined ? pricePerNightCents : existing.price_per_night_cents,
      pricePerWeekCents: pricePerWeekCents !== undefined ? pricePerWeekCents : existing.price_per_week_cents,
      pricePerMonthCents: pricePerMonthCents !== undefined ? pricePerMonthCents : existing.price_per_month_cents,
    };
    const badRates = rateProblem(nextRates);
    if (badRates) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: badRates });
    }

    await client.query(
      `UPDATE sites SET
         name = $1, area = $2, amp_service = $3, pull_through = $4, max_rig_length = $5,
         pet_friendly = $6, price_per_night_cents = $7, price_per_week_cents = $8,
         price_per_month_cents = $9,
         notes = $10, active = $11, sort_order = $12, permanently_occupied = $13
       WHERE id = $14`,
      [
        name?.trim() || existing.name,
        area?.trim() || existing.area,
        ampService ?? existing.amp_service,
        pullThrough !== undefined ? pullThrough : existing.pull_through,
        maxRigLength !== undefined ? maxRigLength : existing.max_rig_length,
        petFriendly !== undefined ? petFriendly : existing.pet_friendly,
        nextRates.pricePerNightCents,
        nextRates.pricePerWeekCents,
        nextRates.pricePerMonthCents,
        notes !== undefined ? notes : existing.notes,
        active !== undefined ? active : existing.active,
        Number.isInteger(sortOrder) ? sortOrder : existing.sort_order,
        permanentlyOccupied !== undefined ? permanentlyOccupied : existing.permanently_occupied,
        id,
      ]
    );

    if (Array.isArray(amenityIds)) {
      await client.query("DELETE FROM site_amenities WHERE site_id = $1", [id]);
      if (amenityIds.length) {
        await client.query(`INSERT INTO site_amenities (site_id, amenity_id) SELECT $1, UNNEST($2::int[])`, [id, amenityIds]);
      }
    }

    // Replace-all, like amenities: an omitted photoIds leaves the assignment alone, an empty array
    // clears it. Anything else and un-assigning the last photo would be impossible.
    if (Array.isArray(photoIds)) {
      await client.query("DELETE FROM site_photos WHERE site_id = $1", [id]);
      if (photoIds.length) {
        await client.query(
          `INSERT INTO site_photos (site_id, photo_id, sort_order)
           SELECT $1, p.id, p.ord FROM UNNEST($2::int[]) WITH ORDINALITY AS p(id, ord)`,
          [id, photoIds]
        );
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

/* ---------- unified amenity catalog ----------
   Each amenity independently controls showOnHomepage (the homepage grid) and showPerSite
   (available to toggle per site in the site editor) -- see db/schema.sql. */

router.get("/amenities", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM amenities ORDER BY sort_order, name");
    res.json(rows.map(mapAmenity));
  } catch (err) {
    next(err);
  }
});

router.post("/amenities", async (req, res, next) => {
  const { name, showOnHomepage, showPerSite } = req.body ?? {};
  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO amenities (name, sort_order, show_on_homepage, show_per_site)
       VALUES ($1, COALESCE((SELECT MAX(sort_order) + 1 FROM amenities), 0), $2, $3)
       RETURNING *`,
      [name.trim(), !!showOnHomepage, showPerSite !== false]
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
  const { name, active, showOnHomepage, showPerSite } = req.body ?? {};
  try {
    const existingResult = await pool.query("SELECT * FROM amenities WHERE id = $1", [id]);
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ error: "Amenity not found" });
    }
    const { rows } = await pool.query(
      `UPDATE amenities SET name = $1, active = $2, show_on_homepage = $3, show_per_site = $4 WHERE id = $5 RETURNING *`,
      [
        name?.trim() || existing.name,
        active !== undefined ? active : existing.active,
        showOnHomepage !== undefined ? showOnHomepage : existing.show_on_homepage,
        showPerSite !== undefined ? showPerSite : existing.show_per_site,
        id,
      ]
    );
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

/* ---------- photos ----------
   Stored as BYTEA in Postgres (see db/schema.sql) since Render's free-tier filesystem
   doesn't persist across deploys/restarts. Served publicly at GET /photos/:id/image
   (server/routes/photos.js), not behind adminAuth. */

router.get("/photos", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, caption, show_on_homepage, sort_order FROM photos ORDER BY sort_order, created_at");
    res.json(rows.map(mapPhoto));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/photos",
  (req, res, next) => {
    photoUpload.single("file")(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: `Image must be ${PHOTO_MAX_BYTES / (1024 * 1024)}MB or smaller` });
      }
      return res.status(400).json({ error: err.message });
    });
  },
  async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ error: "No image file was uploaded" });
    }
    const { caption, showOnHomepage } = req.body ?? {};
    try {
      // Shrink before storing, not on the way out: the resize happens once per photo instead of
      // once per page view, and the database stops growing by a megabyte per upload.
      const shrunk = await shrinkImage(req.file.buffer);
      console.log(
        `[photos] ${req.file.originalname}: ${(shrunk.before / 1024).toFixed(0)}KB -> ` +
          `${(shrunk.after / 1024).toFixed(0)}KB${shrunk.resized ? "" : " (kept original)"}`
      );
      const { rows } = await pool.query(
        `INSERT INTO photos (caption, mime_type, data, show_on_homepage, sort_order)
         VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM photos), 0))
         RETURNING id, caption, show_on_homepage, sort_order`,
        [caption?.trim() || null, shrunk.mimeType ?? req.file.mimetype, shrunk.buffer, showOnHomepage === "true" || showOnHomepage === true]
      );
      res.status(201).json(mapPhoto(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

/* Reorders the whole gallery in one call.
 *
 * sort_order already existed and PATCH /photos/:id already accepted it, but moving one photo up a
 * place means renumbering everything after it -- a batch of PATCHes that can half-apply and leave
 * two photos claiming the same position. One ordered array, renumbered server-side, can't.
 *
 * Send every photo id in the order you want them. Positions are rewritten from 1, so gaps and
 * duplicates left by earlier edits get cleaned up as a side effect. This drives both the homepage
 * grid (which shows the flagged subset, in this order) and /gallery.html.
 */
router.put("/photos/order", async (req, res, next) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: "ids must be an array of photo ids, in the order you want them" });
  }
  if (new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: "ids contains the same photo twice" });
  }
  try {
    if (ids.length) {
      await pool.query(
        `UPDATE photos SET sort_order = o.ord
         FROM UNNEST($1::int[]) WITH ORDINALITY AS o(id, ord)
         WHERE photos.id = o.id`,
        [ids]
      );
    }
    const { rows } = await pool.query(
      "SELECT id, caption, show_on_homepage, sort_order FROM photos ORDER BY sort_order, created_at"
    );
    res.json(rows.map(mapPhoto));
  } catch (err) {
    next(err);
  }
});

router.patch("/photos/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid photo id" });
  }
  const { caption, showOnHomepage, sortOrder } = req.body ?? {};
  try {
    const existingResult = await pool.query("SELECT * FROM photos WHERE id = $1", [id]);
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ error: "Photo not found" });
    }
    const { rows } = await pool.query(
      `UPDATE photos SET caption = $1, show_on_homepage = $2, sort_order = $3 WHERE id = $4
       RETURNING id, caption, show_on_homepage, sort_order`,
      [
        caption !== undefined ? caption?.trim() || null : existing.caption,
        showOnHomepage !== undefined ? showOnHomepage : existing.show_on_homepage,
        Number.isInteger(sortOrder) ? sortOrder : existing.sort_order,
        id,
      ]
    );
    res.json(mapPhoto(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.delete("/photos/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid photo id" });
  }
  try {
    await pool.query("DELETE FROM photos WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------- editable content blocks ---------- */

router.get("/content", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT key, section, label, value FROM content_blocks ORDER BY section, key");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.patch("/content/:key", async (req, res, next) => {
  const { key } = req.params;
  const { value } = req.body ?? {};
  if (typeof value !== "string") {
    return res.status(400).json({ error: "value is required" });
  }
  try {
    const { rows } = await pool.query(
      "UPDATE content_blocks SET value = $1, updated_at = now() WHERE key = $2 RETURNING key, section, label, value",
      [value, key]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Unknown content key" });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ---------- style presets ----------
   Only one style may be is_live at a time -- enforced here, not by a DB constraint, since
   "at most one true" isn't expressible as a simple column constraint in Postgres. */

function mapStyle(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cssVars: row.css_vars,
    logoUrl: row.logo_url,
    approved: row.approved,
    isLive: row.is_live,
    sortOrder: row.sort_order,
  };
}

router.get("/styles", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM styles ORDER BY sort_order, name");
    res.json(rows.map(mapStyle));
  } catch (err) {
    next(err);
  }
});

router.post("/styles", async (req, res, next) => {
  const { name, description, cssVars, logoUrl } = req.body ?? {};
  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO styles (name, description, css_vars, logo_url, sort_order)
       VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM styles), 0))
       RETURNING *`,
      [name.trim(), description?.trim() || null, JSON.stringify(cssVars ?? {}), logoUrl?.trim() || null]
    );
    res.status(201).json(mapStyle(rows[0]));
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "A style with that name already exists" });
    }
    next(err);
  }
});

router.patch("/styles/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid style id" });
  }
  const { name, description, cssVars, logoUrl, approved, isLive } = req.body ?? {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query("SELECT * FROM styles WHERE id = $1 FOR UPDATE", [id]);
    const existing = existingResult.rows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Style not found" });
    }

    if (isLive === true) {
      await client.query("UPDATE styles SET is_live = false WHERE is_live = true AND id != $1", [id]);
    }

    const { rows } = await client.query(
      `UPDATE styles SET name = $1, description = $2, css_vars = $3, logo_url = $4, approved = $5, is_live = $6
       WHERE id = $7 RETURNING *`,
      [
        name?.trim() || existing.name,
        description !== undefined ? description?.trim() || null : existing.description,
        cssVars !== undefined ? JSON.stringify(cssVars) : JSON.stringify(existing.css_vars),
        logoUrl !== undefined ? logoUrl?.trim() || null : existing.logo_url,
        approved !== undefined ? approved : existing.approved,
        isLive !== undefined ? isLive : existing.is_live,
        id,
      ]
    );
    await client.query("COMMIT");
    res.json(mapStyle(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: "A style with that name already exists" });
    }
    next(err);
  } finally {
    client.release();
  }
});

router.delete("/styles/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid style id" });
  }
  try {
    await pool.query("DELETE FROM styles WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------- style gallery approval checklist (static-site branch's 36-page gallery) ---------- */

const STYLE_GALLERY_SLUG_RE = /^v(1[0-2]|[1-9])[bc]?$/;

const STYLE_GALLERY_NOTE_MAX_LENGTH = 2000;

router.patch("/style-gallery-approvals/:slug", async (req, res, next) => {
  const { slug } = req.params;
  const { approved, dismissed, note } = req.body ?? {};
  if (!STYLE_GALLERY_SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "Invalid style gallery slug" });
  }
  if (approved === undefined && dismissed === undefined && note === undefined) {
    return res.status(400).json({ error: "approved, dismissed, and/or note is required" });
  }
  if (approved !== undefined && typeof approved !== "boolean") {
    return res.status(400).json({ error: "approved must be a boolean" });
  }
  if (dismissed !== undefined && typeof dismissed !== "boolean") {
    return res.status(400).json({ error: "dismissed must be a boolean" });
  }
  if (note !== undefined && (typeof note !== "string" || note.length > STYLE_GALLERY_NOTE_MAX_LENGTH)) {
    return res.status(400).json({ error: `note must be a string up to ${STYLE_GALLERY_NOTE_MAX_LENGTH} characters` });
  }

  // approved/dismissed are mutually exclusive -- setting one true forces the other false,
  // overriding whatever the client sent (or didn't send) for it.
  let nextApproved = approved;
  let nextDismissed = dismissed;
  if (approved === true) nextDismissed = false;
  if (dismissed === true) nextApproved = false;

  try {
    const { rows } = await pool.query(
      `INSERT INTO style_gallery_approvals (slug, approved, dismissed, note, updated_at)
       VALUES ($1, COALESCE($2, false), COALESCE($3, false), COALESCE($4, ''), now())
       ON CONFLICT (slug) DO UPDATE SET
         approved = COALESCE($2, style_gallery_approvals.approved),
         dismissed = COALESCE($3, style_gallery_approvals.dismissed),
         note = COALESCE($4, style_gallery_approvals.note),
         updated_at = now()
       RETURNING slug, approved, dismissed, note`,
      [slug, nextApproved ?? null, nextDismissed ?? null, note ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post("/style-gallery-approvals/reset", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM style_gallery_approvals");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------- email ----------
   Booking alerts are the only mail the app sends, and they only fire on a completed,
   paid reservation -- so without this, the only way to find out whether SMTP is configured
   correctly is to take a real booking and charge a real card. These two let an admin see the
   settings the server actually loaded and send itself a test message. */
router.get("/email/status", (req, res) => {
  res.json(mailConfigStatus());
});

router.post("/email/guest-preview", async (req, res) => {
  try {
    const result = await sendSampleGuestEmail();
    res.json({ ok: true, sentTo: result.accepted, messageId: result.messageId });
  } catch (err) {
    console.error("[email] Guest preview failed", err);
    res.status(400).json({ ok: false, error: err.message, code: err.code ?? null });
  }
});

router.post("/email/test", async (req, res) => {
  try {
    const result = await sendTestEmail();
    res.json({ ok: true, sentTo: result.accepted, messageId: result.messageId });
  } catch (err) {
    // The SMTP error is the useful part here, so pass it through instead of a bare 500.
    console.error("[email] Test send failed", err);
    res.status(400).json({ ok: false, error: err.message, code: err.code ?? null });
  }
});

/* ---------- refunds ----------
   The park's policy, applied by the machine instead of by memory: a booking charged at the monthly
   rate carries a flat $100 fee, anything else 11.11% of what was taken, and the balance goes back.
   `monthly_rate_applied` was recorded when the booking was made, so changing a rate later cannot
   alter what an existing guest was quoted.

   The quote is a separate GET so the office can see the numbers before committing to anything.
   The POST takes an explicit amount -- defaulting to "refund everything" on an irreversible money
   movement is how accidents happen -- which is also what lets the office override the policy for
   an edge case without touching code. */
router.get("/reservations/:code/refund-quote", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT reservation_code, status, total_cents, monthly_rate_applied, square_payment_id, refunded_cents FROM reservations WHERE reservation_code = $1",
      [req.params.code]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: "Reservation not found" });
    const policy = cancellationQuote({ totalCents: r.total_cents, monthlyRateApplied: r.monthly_rate_applied });
    res.json({
      reservationCode: r.reservation_code,
      status: r.status,
      totalCents: r.total_cents,
      alreadyRefundedCents: r.refunded_cents ?? 0,
      cardPayment: Boolean(r.square_payment_id),
      ...policy,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/:code/refund", async (req, res, next) => {
  const { amountCents, reason } = req.body ?? {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM reservations WHERE reservation_code = $1 FOR UPDATE",
      [req.params.code]
    );
    const r = rows[0];
    if (!r) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reservation not found" });
    }
    if (r.refunded_cents) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Already refunded ${(r.refunded_cents / 100).toFixed(2)} on this reservation.` });
    }

    const policy = cancellationQuote({ totalCents: r.total_cents, monthlyRateApplied: r.monthly_rate_applied });
    const amount = Number.isInteger(amountCents) ? amountCents : policy.refundCents;
    if (amount < 0 || amount > r.total_cents) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Refund must be between $0.00 and ${(r.total_cents / 100).toFixed(2)}.` });
    }

    let refund = null;
    if (amount > 0) {
      if (!r.square_payment_id) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "This booking has no card payment -- it was entered by hand. Cancel it instead; there is nothing for Square to refund.",
        });
      }
      // Square dedupes on this key, so a double-click cannot refund twice.
      refund = await refundPayment({
        paymentId: r.square_payment_id,
        amountCents: amount,
        idempotencyKey: `refund-${r.reservation_code}-${amount}`,
        reason: reason || `Cancellation of ${r.reservation_code}`,
      });
    }

    await client.query(
      `UPDATE reservations
          SET status = 'cancelled', square_refund_id = $1, refunded_cents = $2,
              cancellation_fee_cents = $3, updated_at = now()
        WHERE id = $4`,
      [refund?.refundId ?? null, amount, r.total_cents - amount, r.id]
    );
    await client.query("COMMIT");

    res.json({
      ok: true,
      reservationCode: r.reservation_code,
      refundedCents: amount,
      feeCents: r.total_cents - amount,
      followedPolicy: amount === policy.refundCents,
      squareRefundId: refund?.refundId ?? null,
      squareStatus: refund?.status ?? null,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err?.errors?.length) {
      return res.status(400).json({ error: err.errors[0].detail ?? err.message, code: err.errors[0].code ?? null });
    }
    next(err);
  } finally {
    client.release();
  }
});

/* Re-encodes photos already stored at full resolution. Uploads are shrunk on the way in now,
   but anything added before that lands as a ~1MB original -- and the homepage pulls all of them.
   Idempotent: a photo that is already small comes back unchanged and is left alone. */
router.post("/photos/optimize", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, caption, mime_type, data FROM photos ORDER BY id");
    const results = [];
    let saved = 0;
    for (const p of rows) {
      const shrunk = await shrinkImage(p.data);
      if (!shrunk.resized || shrunk.after >= p.data.length) {
        results.push({ id: p.id, caption: p.caption, beforeKb: Math.round(p.data.length / 1024), afterKb: Math.round(p.data.length / 1024), changed: false });
        continue;
      }
      await pool.query("UPDATE photos SET data = $1, mime_type = $2 WHERE id = $3", [shrunk.buffer, shrunk.mimeType ?? p.mime_type, p.id]);
      saved += p.data.length - shrunk.after;
      results.push({ id: p.id, caption: p.caption, beforeKb: Math.round(shrunk.before / 1024), afterKb: Math.round(shrunk.after / 1024), changed: true });
    }
    res.json({ ok: true, photos: results.length, savedKb: Math.round(saved / 1024), results });
  } catch (err) {
    next(err);
  }
});

/* ---------- payments ----------
   Asks Square which locations the configured token can see. Checkout failing with "not
   authorized to take payments with location ID" is ambiguous on its own -- it means either the
   wrong location, a location in a different Square account, or an account that has not finished
   activation. This distinguishes them without putting a card through. */
router.get("/square/locations", async (req, res) => {
  try {
    const result = await listLocations();
    res.json({ ok: true, environment: process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox", ...result });
  } catch (err) {
    console.error("[square] Could not list locations", err);
    res.status(400).json({
      ok: false,
      error: err?.errors?.[0]?.detail ?? err.message,
      code: err?.errors?.[0]?.code ?? err.code ?? null,
    });
  }
});

/* ---------- danger zone: force a reseed of an already-provisioned database ----------
   bootstrapDatabase() in server/index.js only runs db/seed.sql when the sites table is
   completely empty, so an already-deployed database (like the live Render demo) doesn't
   pick up corrected seed data automatically. This lets an authenticated admin trigger it
   explicitly instead of needing direct database credentials. TRUNCATEs reservations, sites,
   amenities, and site_amenities -- irreversible. */
/* The "reseed database" endpoint was removed on 2026-08-14, and should not come back in this form.
 *
 * It truncated sites/reservations/amenities and reloaded them from db/seed.sql, behind a typed
 * RESEED confirmation. That made sense while seed.sql WAS the source of truth. It stopped being
 * true once the park keyed in real data: per-site monthly rates ($300-$650), rig lengths, amenity
 * assignments, photo assignments, Site 12's note, and actual bookings -- none of which exist in
 * seed.sql. Pressing it destroyed all of that with nothing in the repository to restore from.
 *
 * Note what it was NOT needed for: bootstrapDatabase() in server/index.js already applies seed.sql
 * automatically whenever the sites table is empty, so a genuinely fresh database seeds itself. The
 * only thing this endpoint could do that the boot path can't is reseed a NON-empty database --
 * which is precisely the destructive case with no remaining legitimate use.
 *
 * If a future schema change really needs data rewritten on a live database, write a migration in
 * schema.sql (it runs every boot and is idempotent), not a truncate-and-reload button in the admin.
 */


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

/* ---------------------------------------------------------------------------------------------
 * Search & sharing (plan item 4.1).
 *
 * Deliberately narrow. Everything derivable stays derived -- the titles come from each page's own
 * <title>, the rates and amenities in the structured data come from the sites and amenities
 * tables, the sitemap builds itself from PAGES. What the office actually gets a say in is the
 * three things a person has to judge: the sentence under the search result, which photograph
 * fronts a shared link, and whether the site should be in an index at all.
 *
 * There is NO free-text box for meta tags here, on purpose. It reads as flexibility and behaves as
 * a second source of truth: within a month it disagrees with the database and starts quietly
 * telling Google something the site no longer does.
 * ------------------------------------------------------------------------------------------- */
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
/* The <title> as shipped, so the panel's previews show the real headline rather than a guess.
   titleOf decodes the entities in it -- these are HTML files, so hours.html says "Office Hours
   &amp; Policies" -- and the panel escapes once when it renders. Read per request: this is an
   admin page opened a few times a day, not the guest path. */
function pageTitle(target) {
  try {
    return titleOf(fs.readFileSync(path.join(publicDir, target), "utf8"));
  } catch {
    return null;
  }
}

router.get("/seo", async (req, res, next) => {
  try {
    const snap = await snapshot();
    const { rows } = await pool.query("SELECT key, value FROM app_settings");
    const set = new Map(rows.map((r) => [r.key, r.value]));

    res.json({
      origin: ORIGIN,
      indexing: set.get(KEY_INDEXING) !== "off",
      googleVerification: set.get(KEY_GOOGLE_VERIFICATION) || "",
      sharePhotoId: snap?.sharePhotoId ?? null,
      // Whether that id is a choice or just the default, so the panel can say which.
      sharePhotoIsExplicit: set.has(KEY_SHARE_PHOTO),
      photos: snap?.allPhotos ?? [],
      pages: Object.entries(PAGES)
        .filter(([, p]) => p.index !== false)
        .map(([target, p]) => ({
          target,
          url: `${ORIGIN}${p.canonical}`,
          title: pageTitle(target),
          defaultDescription: p.desc,
          // What is actually being served right now -- the override if there is one, else default.
          description: descriptionFor(target, snap),
          isCustom: Boolean(set.get(DESC_PREFIX + target)),
        })),
    });
  } catch (err) {
    next(err);
  }
});

/* One PUT for the whole panel rather than a route per field: these settings are read together,
   previewed together and saved with one button, and a half-applied batch (a description saved,
   the indexing switch not) is a state nobody asked for. Any key omitted is left alone; a
   description sent empty is a RESET -- the row is deleted and the built-in default takes over
   again, which is why an absent row has to mean "default" rather than "blank". */
router.put("/seo", async (req, res, next) => {
  const { descriptions, sharePhotoId, indexing, googleVerification } = req.body ?? {};
  const writes = [];

  if (descriptions !== undefined) {
    if (descriptions === null || typeof descriptions !== "object") {
      return res.status(400).json({ error: "descriptions must be an object" });
    }
    for (const [target, text] of Object.entries(descriptions)) {
      if (!PAGES[target] || PAGES[target].index === false) {
        return res.status(400).json({ error: `Unknown page: ${target}` });
      }
      if (text !== null && typeof text !== "string") {
        return res.status(400).json({ error: `Description for ${target} must be text` });
      }
      /* 320 is past the point any engine will show and well past where one is useful; it is here
         to stop a paste of the whole page body, not to enforce a style rule. Google truncates
         around 155-160 and the panel warns there, without refusing. */
      if (typeof text === "string" && text.length > 320) {
        return res.status(400).json({ error: `Description for ${target} is too long (max 320)` });
      }
      writes.push([DESC_PREFIX + target, text && text.trim() ? text.trim() : null]);
    }
  }

  if (sharePhotoId !== undefined) {
    if (sharePhotoId === null) {
      writes.push([KEY_SHARE_PHOTO, null]);
    } else {
      const id = Number(sharePhotoId);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "sharePhotoId must be a photo id" });
      const { rowCount } = await pool.query("SELECT 1 FROM photos WHERE id = $1", [id]);
      if (!rowCount) return res.status(400).json({ error: "That photo no longer exists" });
      writes.push([KEY_SHARE_PHOTO, String(id)]);
    }
  }

  if (indexing !== undefined) {
    if (typeof indexing !== "boolean") return res.status(400).json({ error: "indexing must be true or false" });
    writes.push([KEY_INDEXING, indexing ? "on" : "off"]);
  }

  if (googleVerification !== undefined) {
    if (googleVerification !== null && typeof googleVerification !== "string") {
      return res.status(400).json({ error: "The verification code must be text" });
    }
    let token = (googleVerification ?? "").trim();
    /* Google hands you a whole <meta> tag and tells you to paste it into your HTML, so that is
       what people copy. Pull the content out rather than rejecting it and making them edit a tag
       by hand -- this is the step that decides whether the park ever gets Search Console at all. */
    if (/google-site-verification/i.test(token)) {
      const content = /content=["']([^"']+)["']/i.exec(token);
      if (content) token = content[1].trim();
    }
    if (token && !/^[A-Za-z0-9_-]{10,128}$/.test(token)) {
      return res.status(400).json({
        error: "That doesn't look like a verification code. Paste either the code itself or the whole <meta> tag Google gives you.",
      });
    }
    writes.push([KEY_GOOGLE_VERIFICATION, token || null]);
  }

  try {
    for (const [key, value] of writes) {
      if (value === null) {
        // Delete rather than store a blank: an absent row is what means "use the default".
        await pool.query("DELETE FROM app_settings WHERE key = $1", [key]);
      } else {
        await pool.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, value]
        );
      }
    }
    /* Without this the office saves a description, reloads the site and sees the old one for up to
       a minute -- and reasonably concludes the save didn't work. */
    invalidateSnapshot();
    res.json({ ok: true, saved: writes.length });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------------------------------
 * Review requests (plan item 2.4).
 *
 * Off until somebody turns it on AND supplies a link, because the failure mode is mailing real
 * guests. Both conditions are reported back to the panel so "why has nothing sent?" has a visible
 * answer rather than needing the log.
 * ------------------------------------------------------------------------------------------- */
router.get("/review-requests", async (req, res, next) => {
  try {
    const settings = await reviewSettings();
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE review_request_sent_at IS NOT NULL)               AS sent,
              count(*) FILTER (WHERE review_request_sent_at IS NOT NULL
                                 AND review_request_sent_at > now() - interval '30 days') AS sent_30d
         FROM reservations`
    );
    const recent = await pool.query(
      `SELECT reservation_code, guest_name, check_out, review_request_sent_at
         FROM reservations
        WHERE review_request_sent_at IS NOT NULL
        ORDER BY review_request_sent_at DESC
        LIMIT 10`
    );
    res.json({
      ...settings,
      blocked: blockedReason(settings),
      smtpReady: Boolean(getTransporter()),
      sendingAs: fromAddress(),
      sentTotal: Number(rows[0].sent),
      sent30d: Number(rows[0].sent_30d),
      recent: recent.rows.map((r) => ({
        code: r.reservation_code,
        guest: r.guest_name,
        checkOut: r.check_out,
        sentAt: r.review_request_sent_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/review-requests", async (req, res, next) => {
  const { enabled, url, delayDays } = req.body ?? {};
  try {
    const before = await reviewSettings();
    const writes = [];

    if (url !== undefined) {
      if (url !== null && typeof url !== "string") {
        return res.status(400).json({ error: "The review link must be text" });
      }
      const trimmed = typeof url === "string" ? url.trim() : "";
      if (trimmed) {
        /* An http(s) URL and nothing else. This value goes into an email to a real guest -- a
           typo that turns into a mailto: or a javascript: link is worth refusing outright. */
        let parsed;
        try {
          parsed = new URL(trimmed);
        } catch {
          return res.status(400).json({ error: "That doesn't look like a link" });
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return res.status(400).json({ error: "The review link must start with https://" });
        }
      }
      writes.push(["review_url", trimmed || null]);
    }

    if (delayDays !== undefined) {
      const n = Number(delayDays);
      if (!Number.isInteger(n) || n < 0 || n > 30) {
        return res.status(400).json({ error: "The delay must be a whole number of days, 0 to 30" });
      }
      writes.push(["review_delay_days", String(n)]);
    }

    if (enabled !== undefined) {
      if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
      writes.push(["review_enabled", enabled ? "on" : "off"]);
      /* Stamped on the off -> on transition only. It is the floor on which stays qualify, so
         re-saving while already on must not move it forward and skip a guest who was due. */
      if (enabled && !before.enabled) writes.push(["review_enabled_at", new Date().toISOString()]);
    }

    for (const [key, value] of writes) {
      if (value === null) {
        await pool.query("DELETE FROM app_settings WHERE key = $1", [key]);
      } else {
        await pool.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, value]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* Sends the real template to ADMIN_EMAIL, same idea as the guest-confirmation preview: the park
   can read exactly what a guest gets without waiting for someone to check out. */
router.post("/review-requests/preview", async (req, res, next) => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return res.status(400).json({ error: "ADMIN_EMAIL is not set - there is nowhere to send it." });
    const mailer = getTransporter();
    if (!mailer) return res.status(400).json({ error: "SMTP_HOST is not set - no mail server to send through." });
    const settings = await reviewSettings();
    const url = settings.url ?? "https://example.com/your-review-link";
    const { subject, text, html } = reviewEmail("Sample Guest", "Site 4", url);
    await mailer.sendMail({ from: fromAddress(), to: adminEmail, subject: `[preview] ${subject}`, text, html });
    res.json({ ok: true, sentTo: adminEmail, usedPlaceholderLink: !settings.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Runs the job now instead of waiting for the hourly tick. Same code path, same idempotency --
   this cannot send a guest a second copy. */
router.post("/review-requests/run", async (req, res, next) => {
  try {
    res.json(await sendDueReviewRequests());
  } catch (err) {
    next(err);
  }
});

/* ---------- park map ----------
   The park's physical layout, edited in /admin -> Park map and drawn on the homepage. Stored as a
   single JSON document in app_settings rather than a table of shapes: it is read whole and written
   whole, never queried across, and a row per pad would buy nothing but joins.

   The PUT hands back the stored document rather than 204. normalise() clamps sizes, drops
   incomplete roads and de-duplicates ids, so what the editor sent and what was saved can differ --
   and the editor should show what is actually on the guest map, not its own optimistic copy. */
router.get("/park-layout", async (req, res) => {
  res.json({ layout: await readLayout(), kinds: FEATURE_KINDS });
});

router.put("/park-layout", async (req, res, next) => {
  try {
    const raw = req.body?.layout;
    if (!raw || typeof raw !== "object") {
      return res.status(400).json({ error: "layout must be an object" });
    }
    if (!Array.isArray(raw.bays) || !raw.bays.length) {
      // Saving an empty layout is almost certainly a bug in the editor rather than a park with no
      // pads, and it would blank the homepage map. Refuse rather than store it.
      return res.status(400).json({ error: "A layout needs at least one site." });
    }
    const layout = await writeLayout(raw);
    res.json({ layout });
  } catch (err) {
    next(err);
  }
});

export default router;
