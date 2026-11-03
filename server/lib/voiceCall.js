import { ORIGIN } from "./seo.js";

/* An automated phone call for a booking alert nobody acknowledged. Inert until every variable
   below is set, the same as push and Square and SMTP -- an unconfigured integration has to be a
   no-op rather than a throw, because the only code path that reaches it runs after a guest's card
   has already been charged.

   SignalWire's Compatibility API is Twilio-shaped: HTTP Basic auth with the project ID and token,
   and a Url that the platform fetches for cXML instructions once the call connects. Pointing that
   at our own /api/alerts/voice/:token is what makes "press 1 to acknowledge" possible -- the
   inline Laml parameter can speak the booking perfectly well but has nowhere to send a keypress
   back to, and an alert you cannot silence from the call is one that keeps buzzing after you have
   dealt with it. */
function config() {
  const space = process.env.SIGNALWIRE_SPACE_URL;
  const project = process.env.SIGNALWIRE_PROJECT_ID;
  const token = process.env.SIGNALWIRE_API_TOKEN;
  const from = process.env.SIGNALWIRE_FROM_NUMBER;
  const to = (process.env.ALERT_CALL_NUMBERS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  if (!space || !project || !token || !from || to.length === 0) return null;
  // Tolerate the space being pasted with or without a scheme -- it is copied out of a dashboard.
  return { space: space.replace(/^https?:\/\//, "").replace(/\/$/, ""), project, token, from, to };
}

export function voiceConfigured() {
  return config() !== null;
}

/* Which push attempt escalates to a call. Default 3: against the five-minute reminder interval
   that is about ten minutes of being ignored -- long enough to be confident the phone genuinely
   was not seen, short enough that a same-day arrival still gets dealt with. */
export function callAfterAttempt() {
  const raw = Number(process.env.ALERT_CALL_AFTER_ATTEMPT);
  return Number.isInteger(raw) && raw > 0 ? raw : 3;
}

export async function placeAlertCall(ackToken) {
  const cfg = config();
  if (!cfg) return { placed: 0 };

  const endpoint = `https://${cfg.space}/api/laml/2010-04-01/Accounts/${cfg.project}/Calls.json`;
  const auth = Buffer.from(`${cfg.project}:${cfg.token}`).toString("base64");

  let placed = 0;
  for (const to of cfg.to) {
    const body = new URLSearchParams({
      To: to,
      From: cfg.from,
      Url: `${ORIGIN}/api/alerts/voice/${ackToken}`,
      Method: "POST",
    });

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (res.ok) {
        placed++;
      } else {
        /* Logged with the body, because SignalWire's refusals are specific and actionable -- an
           unverified destination on a trial project, a From that isn't a number on the account,
           an exhausted balance. A bare status code sends you to the dashboard guessing. */
        console.error(`[voice] SignalWire refused the call to ${to}: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      console.error(`[voice] Call to ${to} failed:`, err.message);
    }
  }

  return { placed };
}
