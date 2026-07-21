import { Router } from "express";
import { pool } from "../db.js";

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/sites", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, area, amp_service, pull_through, max_rig_length, pet_friendly, price_per_night_cents
       FROM sites WHERE active = true ORDER BY sort_order`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/availability", async (req, res, next) => {
  const { checkIn, checkOut } = req.query;
  if (!DATE_RE.test(checkIn ?? "") || !DATE_RE.test(checkOut ?? "")) {
    return res.status(400).json({ error: "checkIn and checkOut must be YYYY-MM-DD" });
  }
  if (checkOut <= checkIn) {
    return res.status(400).json({ error: "checkOut must be after checkIn" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.area, s.amp_service, s.pull_through, s.max_rig_length,
              s.pet_friendly, s.price_per_night_cents,
              NOT EXISTS (
                SELECT 1 FROM reservations r
                WHERE r.site_id = s.id
                  AND r.status IN ('pending', 'confirmed')
                  AND r.stay_range && daterange($1::date, $2::date, '[)')
              ) AS available
       FROM sites s
       WHERE s.active = true
       ORDER BY s.sort_order`,
      [checkIn, checkOut]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
