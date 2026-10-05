import { pool } from "../db.js";
import { snapshot, ORIGIN } from "./seo.js";

/* Draft posts for Facebook and the Google Business Profile, written from live data and handed to
 * a person to publish.
 *
 * WHY THIS IS NOT AN API INTEGRATION. Posting straight to both platforms was the original plan and
 * was deliberately dropped:
 *   - Google gates the Business Profile API behind an access request tied to a Cloud project. It
 *     is an application with a review, and a single-location park is exactly the case that gets
 *     declined. Not something to build a feature on top of.
 *   - Facebook page tokens expire, and a token derived slightly wrong stops working after about
 *     sixty days. The failure is silent: posts simply stop, and nobody notices for a month.
 *   - Automatic availability posts are worse than either. "Three sites open this weekend" can be
 *     false thirty seconds after it publishes, because someone booked one -- and with cancellations
 *     it would post several times a week to an audience of twenty-two, which reads as spam.
 *
 * So the office gets the numbers, already written up, and two clicks. The human in the loop is the
 * feature, not a limitation of it: every word is read by someone before it is public, and a draft
 * that has gone stale while the tab sat open is visibly stale to the person about to post it.
 */

/* Where the office goes to publish. Held in app_settings rather than hardcoded because Meta and
 * Google both move these pages, and the office should not need a deploy to fix a link. */
export const KEY_FB_COMPOSE = "social_fb_compose_url";
export const KEY_GBP_COMPOSE = "social_gbp_compose_url";
const DEFAULT_FB_COMPOSE = "https://business.facebook.com/latest/composer";
const DEFAULT_GBP_COMPOSE = "https://business.google.com/posts";

const dollars = (cents) => `$${Math.round(cents / 100)}`;

/* A starting photo for each draft, picked from the homepage set (snap.photos) by matching words
 * in its caption. This is a GUESS, not a fact -- unlike the text, which is only ever numbers read
 * straight out of the database, there is no correct photo for a post about the amenities. So the
 * panel shows whichever one this picks and lets the office change it from a dropdown of the same
 * list; getting the guess wrong costs one click, not a wrong statement in public.
 *
 * Keywords are tried in order and the first match wins, so put anything caption-writers use
 * loosely (e.g. "site") after anything more specific ("dog park") or the specific photo would
 * never be reached. Falls back to the first homepage photo -- some picture beats none -- and to
 * nothing at all if the park has not flagged any photo for the homepage yet. */
function pickPhoto(snap, keywords) {
  const photos = snap?.photos ?? [];
  if (!photos.length) return null;
  for (const word of keywords) {
    const hit = photos.find((p) => p.caption?.toLowerCase().includes(word));
    if (hit) return hit.id;
  }
  return photos[0].id;
}

/** The coming Friday to Sunday. Returns the same weekend all week, and rolls over on Monday.
 *  Exported for its own sake -- the day arithmetic is the part of this file most likely to be
 *  wrong, and it is invisible in the finished draft. */
export function comingWeekend(today = new Date()) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // 0 Sun .. 6 Sat. Sunday counts as "this weekend", not next.
  const day = d.getUTCDay();
  const toFriday = day === 0 ? -2 : 5 - day;
  const fri = new Date(d);
  fri.setUTCDate(d.getUTCDate() + toFriday);
  const sun = new Date(fri);
  sun.setUTCDate(fri.getUTCDate() + 2);
  const iso = (x) => x.toISOString().slice(0, 10);
  const pretty = (x) =>
    x.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return { checkIn: iso(fri), checkOut: iso(sun), label: `${pretty(fri)}–${pretty(sun)}` };
}

/* How many sites are genuinely bookable across a range. Same three conditions the guest-facing
   availability route applies, so this can't advertise a site the booking page would refuse:
   active, not carrying a long-term resident, priced by at least one term, and not already held. */
async function openCount(checkIn, checkOut) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
       FROM sites s
      WHERE s.active
        AND NOT s.permanently_occupied
        AND (s.price_per_night_cents IS NOT NULL
             OR s.price_per_week_cents IS NOT NULL
             OR s.price_per_month_cents IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM reservations r
           WHERE r.site_id = s.id
             AND r.status IN ('pending', 'confirmed')
             AND r.stay_range && daterange($1::date, $2::date, '[)')
        )`,
    [checkIn, checkOut]
  );
  return rows[0]?.n ?? 0;
}

async function composeUrls() {
  try {
    const { rows } = await pool.query(`SELECT key, value FROM app_settings WHERE key = ANY($1)`, [
      [KEY_FB_COMPOSE, KEY_GBP_COMPOSE],
    ]);
    const set = new Map(rows.map((r) => [r.key, r.value]));
    return {
      facebook: set.get(KEY_FB_COMPOSE) || DEFAULT_FB_COMPOSE,
      google: set.get(KEY_GBP_COMPOSE) || DEFAULT_GBP_COMPOSE,
    };
  } catch {
    return { facebook: DEFAULT_FB_COMPOSE, google: DEFAULT_GBP_COMPOSE };
  }
}

/** Every draft, plus where to publish them. Never throws -- a panel that fails to load is worse
 *  than one that offers fewer drafts. */
export async function draftPosts() {
  const [snap, links] = await Promise.all([snapshot(), composeUrls()]);
  const site = ORIGIN.replace(/^https?:\/\//, "");
  const weekend = comingWeekend();
  const drafts = [];

  let open = null;
  try {
    open = await openCount(weekend.checkIn, weekend.checkOut);
  } catch {
    /* Leave the weekend draft out rather than guess at a number. */
  }

  if (open !== null) {
    if (open > 0) {
      const from = snap?.nightLow ? ` from ${dollars(snap.nightLow)} a night` : "";
      drafts.push({
        id: "weekend",
        label: `This weekend — ${weekend.label}`,
        // Counted at the moment the panel was opened, so it is checked rather than assumed.
        note: `${open} site${open === 1 ? "" : "s"} free for ${weekend.checkIn} to ${weekend.checkOut}, counted just now.`,
        text:
          `${open} site${open === 1 ? " is" : "s are"} open this weekend at the Wagon Wheel` +
          `${from}. Full hookups, 30 and 50 amp, park-wide WiFi, laundry and showers, ` +
          `seven minutes from downtown Bandera.\n\nBook at ${site}`,
        photoId: pickPhoto(snap, ["site", "sunset"]),
      });
    } else {
      drafts.push({
        id: "weekend",
        label: `This weekend — ${weekend.label}`,
        note: "Nothing free this weekend, so this draft says so rather than inviting bookings.",
        text:
          `We're full this weekend — thank you. If you're planning ahead, the calendar at ` +
          `${site} shows what's open, and we take bookings by the night, the week or the month.`,
        photoId: pickPhoto(snap, ["sunset", "site"]),
      });
    }
  }

  if (snap?.monthLow) {
    const range =
      snap.monthLow === snap.monthHigh
        ? `${dollars(snap.monthLow)} a month`
        : `${dollars(snap.monthLow)} to ${dollars(snap.monthHigh)} a month depending on the site`;
    drafts.push({
      id: "monthly",
      label: "Monthly stays",
      note: "Rates read from the Sites panel, so they can't drift from what the booking page charges.",
      text:
        `Monthly RV sites in Bandera, ${range}. Full hookups, 30 and 50 amp, park-wide WiFi, ` +
        `laundry and showers. Electric is metered separately on monthly stays.\n\n` +
        `Most of the park is people staying a while — it's a settled place, not a holiday ` +
        `campground that empties out on Sunday night.\n\n${site}/monthly-stays.html`,
      photoId: pickPhoto(snap, ["site", "office"]),
    });
  }

  if (snap?.amenities?.length) {
    drafts.push({
      id: "amenities",
      label: "What's on site",
      note: "Taken from the Amenities panel — edit there and this follows.",
      text:
        `What's here at the Wagon Wheel:\n\n` +
        snap.amenities.map((a) => `• ${a}`).join("\n") +
        `\n\nSeven minutes from downtown Bandera. ${site}`,
      photoId: pickPhoto(snap, ["dog park", "laundry", "bathroom", "shower"]),
    });
  }

  drafts.push({
    id: "blank",
    label: "Something else",
    note: "Write your own. Nothing here is posted for you either way.",
    text: "",
    photoId: null,
  });

  return { drafts, links, weekend, photos: snap?.photos ?? [] };
}
