import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

router.get("/api/photos", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, caption, show_on_homepage, sort_order FROM photos ORDER BY sort_order, created_at"
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        caption: r.caption,
        showOnHomepage: r.show_on_homepage,
        sortOrder: r.sort_order,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Not under /api -- this serves raw image bytes, referenced directly as an <img src>.
router.get("/photos/:id/image", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).end();
  }
  try {
    const { rows } = await pool.query("SELECT mime_type, data FROM photos WHERE id = $1", [id]);
    const photo = rows[0];
    if (!photo) {
      return res.status(404).end();
    }
    res.set("Content-Type", photo.mime_type);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(photo.data);
  } catch (err) {
    next(err);
  }
});

export default router;
