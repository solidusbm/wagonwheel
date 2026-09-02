import { Router } from "express";
import { pool } from "../db.js";
import { generateSiteIcs } from "../lib/ical.js";

const router = Router();

// Public iCal feed of one site's booked date ranges, for RoverPass/Hipcamp (or
// any other calendar-based sync) to import so they don't offer a site that's
// already booked here. No guest details are included -- just the date ranges.
router.get("/sites/:siteFile", async (req, res, next) => {
  if (!req.params.siteFile.endsWith(".ics")) {
    return res.status(404).send("Not found");
  }
  const siteId = Number(req.params.siteFile.slice(0, -4));
  if (!Number.isInteger(siteId)) {
    return res.status(400).send("Invalid site id");
  }

  try {
    const siteResult = await pool.query("SELECT id, name FROM sites WHERE id = $1 AND active = true", [siteId]);
    const site = siteResult.rows[0];
    if (!site) {
      return res.status(404).send("Site not found");
    }

    const { rows } = await pool.query(
      `SELECT reservation_code AS code, check_in::text AS "checkIn", check_out::text AS "checkOut"
       FROM reservations
       WHERE site_id = $1 AND status IN ('pending', 'confirmed') AND check_out >= CURRENT_DATE
       ORDER BY check_in`,
      [siteId]
    );

    const ics = generateSiteIcs({ siteName: site.name, bookings: rows });
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", `inline; filename="site-${siteId}.ics"`);
    res.send(ics);
  } catch (err) {
    next(err);
  }
});

export default router;
