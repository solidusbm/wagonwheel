import { Router } from "express";
import multer from "multer";
import { pool } from "../db.js";
import { quote } from "../lib/pricing.js";
import { generateReservationCode } from "../lib/reservationCode.js";
import { applySchema, applySeed, applyContentSeed, sitesCount } from "../lib/dbBootstrap.js";

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
    permanentlyOccupied: row.permanently_occupied,
    sortOrder: row.sort_order,
    amenityIds: row.amenity_ids,
  };
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
  const { name, area, ampService, pullThrough, maxRigLength, petFriendly, pricePerNightCents, pricePerWeekCents, notes, sortOrder, amenityIds, permanentlyOccupied } =
    req.body ?? {};

  if (!name?.trim() || !area?.trim()) {
    return res.status(400).json({ error: "name and area are required" });
  }
  if (!Number.isInteger(pricePerNightCents)) {
    return res.status(400).json({ error: "pricePerNightCents is required" });
  }
  if (!Number.isInteger(pricePerWeekCents)) {
    return res.status(400).json({ error: "pricePerWeekCents is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO sites (name, area, amp_service, pull_through, max_rig_length, pet_friendly, price_per_night_cents, price_per_week_cents, notes, sort_order, permanently_occupied)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        name.trim(),
        area.trim(),
        ampService ?? "30/50",
        !!pullThrough,
        maxRigLength ?? null,
        petFriendly ?? true,
        pricePerNightCents,
        pricePerWeekCents,
        notes ?? null,
        Number.isInteger(sortOrder) ? sortOrder : 0,
        !!permanentlyOccupied,
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
  const { name, area, ampService, pullThrough, maxRigLength, petFriendly, pricePerNightCents, pricePerWeekCents, notes, active, sortOrder, amenityIds, permanentlyOccupied } =
    req.body ?? {};

  if (pricePerWeekCents !== undefined && !Number.isInteger(pricePerWeekCents)) {
    return res.status(400).json({ error: "pricePerWeekCents must be a whole number of cents" });
  }

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
         notes = $9, active = $10, sort_order = $11, permanently_occupied = $12
       WHERE id = $13`,
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
      const { rows } = await pool.query(
        `INSERT INTO photos (caption, mime_type, data, show_on_homepage, sort_order)
         VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM photos), 0))
         RETURNING id, caption, show_on_homepage, sort_order`,
        [caption?.trim() || null, req.file.mimetype, req.file.buffer, showOnHomepage === "true" || showOnHomepage === true]
      );
      res.status(201).json(mapPhoto(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

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
  const { approved, note } = req.body ?? {};
  if (!STYLE_GALLERY_SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "Invalid style gallery slug" });
  }
  if (approved === undefined && note === undefined) {
    return res.status(400).json({ error: "approved and/or note is required" });
  }
  if (approved !== undefined && typeof approved !== "boolean") {
    return res.status(400).json({ error: "approved must be a boolean" });
  }
  if (note !== undefined && (typeof note !== "string" || note.length > STYLE_GALLERY_NOTE_MAX_LENGTH)) {
    return res.status(400).json({ error: `note must be a string up to ${STYLE_GALLERY_NOTE_MAX_LENGTH} characters` });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO style_gallery_approvals (slug, approved, note, updated_at)
       VALUES ($1, COALESCE($2, false), COALESCE($3, ''), now())
       ON CONFLICT (slug) DO UPDATE SET
         approved = COALESCE($2, style_gallery_approvals.approved),
         note = COALESCE($3, style_gallery_approvals.note),
         updated_at = now()
       RETURNING slug, approved, note`,
      [slug, approved ?? null, note ?? null]
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

/* ---------- danger zone: force a reseed of an already-provisioned database ----------
   bootstrapDatabase() in server/index.js only runs db/seed.sql when the sites table is
   completely empty, so an already-deployed database (like the live Render demo) doesn't
   pick up corrected seed data automatically. This lets an authenticated admin trigger it
   explicitly instead of needing direct database credentials. TRUNCATEs reservations, sites,
   amenities, and site_amenities -- irreversible. */
router.post("/db/reseed", async (req, res, next) => {
  const { confirm } = req.body ?? {};
  if (confirm !== "RESEED") {
    return res.status(400).json({ error: 'Send { "confirm": "RESEED" } to proceed. This truncates and reloads sites, amenities, and reservations.' });
  }
  try {
    await applySchema();
    await applySeed();
    await applyContentSeed();
    const count = await sitesCount();
    res.json({ ok: true, sitesCount: count });
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
