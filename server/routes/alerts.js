import { Router } from "express";
import { acknowledgeAlert } from "../lib/push.js";

const router = Router();

/* Deliberately outside /api/admin and its Basic Auth. The caller here is the service worker
   reacting to a tap on the notification, and a service worker's fetch does not reliably carry the
   browser's cached Basic Auth credentials -- an acknowledgement that only works while /admin
   happens to be open in a tab is one that fails at exactly the moment it is needed.

   The token from the push payload is the credential instead. It is unguessable, single-purpose
   (it acknowledges one alert and grants nothing else -- no read access, no guest data), and only
   ever reaches a device the office subscribed itself. */
const VIA = new Set(["notification-action", "notification-open", "admin-panel"]);

router.post("/ack", async (req, res, next) => {
  const token = typeof req.body?.token === "string" ? req.body.token : null;
  if (!token) return res.status(400).json({ ok: false, error: "Missing token" });

  const via = VIA.has(req.body?.via) ? req.body.via : "unknown";

  try {
    const reservationCode = await acknowledgeAlert(token, via);
    /* An unknown token and an already-acknowledged one both land here as ok:true with a null code.
       Neither deserves an error status: the device has nothing useful to do with the failure, and
       retrying would not change the answer. The null is enough for the admin panel to tell the
       difference when it cares. */
    res.json({ ok: true, acknowledged: reservationCode });
  } catch (err) {
    next(err);
  }
});

export default router;
