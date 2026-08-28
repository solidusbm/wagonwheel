import { Router, urlencoded } from "express";
import { acknowledgeAlert, alertByToken } from "../lib/push.js";
import { ORIGIN } from "../lib/seo.js";

const router = Router();

/* SignalWire posts cXML webhooks form-encoded, and index.js only mounts express.json(). Scoped to
   this router rather than added globally: nothing else in the app accepts form posts, and widening
   the body parsers for every route to serve two is how a parser ends up somewhere it wasn't
   reasoned about. */
router.use(urlencoded({ extended: false }));

/* Deliberately outside /api/admin and its Basic Auth. The caller here is the service worker
   reacting to a tap on the notification, and a service worker's fetch does not reliably carry the
   browser's cached Basic Auth credentials -- an acknowledgement that only works while /admin
   happens to be open in a tab is one that fails at exactly the moment it is needed.

   The token from the push payload is the credential instead. It is unguessable, single-purpose
   (it acknowledges one alert and grants nothing else -- no read access, no guest data), and only
   ever reaches a device the office subscribed itself. */
const VIA = new Set(["notification-action", "notification-open", "admin-panel"]);

function xmlEscape(value) {
  return String(value).replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]
  );
}

/* The alert body is written to be read on a screen: "Site 7 · 2026-09-01 → 2026-09-04 · Jane Roe".
   Spoken verbatim that is punctuation names and digit soup, so the separators become words first.
   The guest's name still goes through xmlEscape on the way out -- it arrives from the booking form
   and an apostrophe in O'Brien would otherwise break the document, not just the pronunciation. */
function speakable(body) {
  return body
    .replace(/\s*→\s*/g, " through ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function cxml(res, body) {
  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`);
}

/* What SignalWire fetches when the escalation call connects. Unauthenticated for the same reason
   the ack route is, and guarded the same way: the token is in the URL, and the URL was handed to
   SignalWire by us over an authenticated API call. It is not linked anywhere and reveals one
   booking's site and dates to whoever already has the token. */
router.post("/voice/:token", async (req, res, next) => {
  try {
    const alert = await alertByToken(req.params.token);
    if (!alert) return cxml(res, `<Say>That booking alert was not found. Goodbye.</Say><Hangup/>`);
    if (alert.acknowledged_at) {
      return cxml(res, `<Say>That booking has already been acknowledged. Goodbye.</Say><Hangup/>`);
    }

    const message = xmlEscape(`New booking at Wagon Wheel R V Park. ${speakable(alert.body)}.`);
    const action = `${ORIGIN}/api/alerts/voice/${encodeURIComponent(req.params.token)}/ack`;

    /* Said twice inside the Gather on purpose. Gather keeps listening until timeout, so the repeat
       costs nothing when someone presses 1 immediately, and covers the far more likely case of a
       person who answered mid-sentence and missed the site number. */
    cxml(
      res,
      `<Gather numDigits="1" action="${xmlEscape(action)}" method="POST" timeout="8">` +
        `<Say>${message} Press 1 to acknowledge.</Say>` +
        `<Pause length="1"/>` +
        `<Say>${message} Press 1 to acknowledge.</Say>` +
        `</Gather>` +
        `<Say>No key was pressed. This booking is still waiting in the admin. Goodbye.</Say>`
    );
  } catch (err) {
    next(err);
  }
});

router.post("/voice/:token/ack", async (req, res, next) => {
  try {
    if (req.body?.Digits !== "1") {
      // Anything other than 1 is treated as "not acknowledged" -- a misdial should not silence it.
      return cxml(res, `<Say>Not acknowledged. Goodbye.</Say><Hangup/>`);
    }
    await acknowledgeAlert(req.params.token, "phone-call");
    cxml(res, `<Say>Acknowledged. Thank you. Goodbye.</Say><Hangup/>`);
  } catch (err) {
    next(err);
  }
});

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
