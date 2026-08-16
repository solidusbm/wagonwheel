import { pool } from "../db.js";

/* Everything a crawler, a Facebook scraper or an iMessage preview needs out of the <head>, built
 * in one place and injected server-side by the asset versioner (lib/assetVersion.js).
 *
 * WHY IT IS NOT IN THE HTML FILES. Before this, the live site answered /sitemap.xml and
 * /favicon.ico with 404s, carried no og: tags, no canonical and a meta description on exactly one
 * of five pages -- so a link posted to the park's Facebook page rendered as a bare URL. Putting
 * the tags in each file would fix that once and then rot: five files drift, and the rates and
 * amenities that belong in the structured data live in Postgres and are edited from /admin.
 * So the derivable parts are DERIVED -- the title is read back out of the page's own <title>, the
 * price range and the amenity list come from the same rows the booking page reads -- and only the
 * genuinely editorial part (the description) is written down, once, in PAGES below.
 *
 * PRIVACY. /privacy.html states that the site sets no cookies and runs no trackers, and that has
 * to stay true. Nothing here is a tracker: these are static tags plus one same-origin image. No
 * third-party script, no pixel, no analytics beacon, no new outbound request of any kind. Keep it
 * that way -- an og:image pointing at someone else's CDN would already be a request to a third
 * party on every share preview.
 */

/* Canonical origin. The app also answers on wwrvb.sastx.net, and a page reachable at two hostnames
 * with no canonical is two competing copies as far as a search engine is concerned. Overridable so
 * a staging deploy doesn't advertise itself as the live park. */
export const ORIGIN = (process.env.PUBLIC_ORIGIN ?? "https://banderawagonwheelrv.com").replace(/\/$/, "");

export const PARK = {
  name: "Bandera Wagon Wheel RV Park",
  street: "325 Polly Peak Dr",
  city: "Bandera",
  region: "TX",
  postal: "78003",
  country: "US",
  phone: "+1-830-850-0805",
  email: "banderawagonwheelrv@gmail.com",
  checkin: "15:00",
  checkout: "13:00",
};

/* One row per page served out of public/. `desc` is the meta description and the og:description;
 * the title is not repeated here because the file already has one and two copies would disagree.
 *
 * Deliberately NO rates, counts or amenities in this prose. Both would go stale -- rates are edited
 * in /admin, and the park has FIVE bookable sites against twelve pads (seven carry long-term
 * residents), so any sentence with a number in it is a sentence that will eventually be wrong or
 * will promise inventory that does not exist. Numbers belong in the JSON-LD, which is generated.
 *
 * `index:false` pages get the favicon and nothing else -- no canonical, no og: tags. They already
 * carry <meta name="robots"> in the file itself, which stays as a safety net for the case where
 * this middleware is bypassed and express.static serves the raw file. */
export const PAGES = {
  "/index.html": {
    canonical: "/",
    desc:
      "Full-hookup RV sites in Bandera, Texas Hill Country. Long back-in pads, 30/50 amp, " +
      "Wi-Fi and laundry. Book online by the night, week or month.",
    changefreq: "weekly",
    priority: "1.0",
    jsonLd: true,
  },
  "/hours.html": {
    canonical: "/hours.html",
    desc:
      "Office hours, check-in and check-out times, rates and the park rules for Bandera Wagon " +
      "Wheel RV Park in Bandera, Texas.",
    changefreq: "monthly",
    priority: "0.6",
  },
  "/gallery.html": {
    canonical: "/gallery.html",
    desc:
      "Photographs of Bandera Wagon Wheel RV Park -- the sites and hookups, the bathhouse, the " +
      "laundry and the grounds, in Bandera, Texas.",
    changefreq: "monthly",
    priority: "0.6",
  },
  "/privacy.html": {
    canonical: "/privacy.html",
    // Moved here verbatim from the file's own <meta name="description"> so there is one copy.
    desc:
      "What Bandera Wagon Wheel RV Park collects when you book, why, who can see it, and how to " +
      "have it corrected or deleted.",
    changefreq: "yearly",
    priority: "0.3",
  },
  // Reached only from a tokenised link in a confirmation email. Nothing should index it.
  "/cancel.html": { index: false },
  "/404.html": { index: false },
};

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------------------------------------------------------------------------------------------
 * The database half.
 *
 * Read once and held for a few minutes rather than queried per page view: a crawler walking the
 * site would otherwise put a query on every request for numbers that change a few times a year.
 * The TTL is the staleness an /admin rate edit can show for, which is a reasonable trade at five
 * minutes. Any failure degrades to null -- the page still serves, just without structured data.
 * Never let this throw into the request path.
 * ------------------------------------------------------------------------------------------- */
/* A minute, not the five it started at. This snapshot no longer feeds only the structured data --
 * the amenity grid, the photo grid and the rates panel are rendered from it too (lib/ssr.js), so
 * the TTL is now how long an /admin edit takes to reach the visible page. A minute keeps that
 * close to the instant reload the office had when those grids were fetched by the browser, and
 * still costs at most three queries a minute. */
const SNAPSHOT_TTL_MS = 60 * 1000;
/* A failure is cached too, for much less time. Caching only successes looks harmless and isn't:
 * with the database down, every single page view would re-run three queries against it and log a
 * warning -- turning a degraded site into a busy one, and burying the real error in a log nobody
 * can then read. Thirty seconds is short enough that the structured data comes back promptly once
 * the database does. */
const FAILURE_TTL_MS = 30 * 1000;
let snapshotCache = { at: 0, value: null };

export async function snapshot() {
  const ttl = snapshotCache.value ? SNAPSHOT_TTL_MS : FAILURE_TTL_MS;
  if (snapshotCache.at && Date.now() - snapshotCache.at < ttl) return snapshotCache.value;
  try {
    const [rates, amenities, photos] = await Promise.all([
      /* Only sites that are actually sold: `active` and not carrying a long-term resident. The
         range shown to a guest, and to Google, has to be one somebody can actually book -- a
         permanently occupied site's rate is not on offer to anybody.

         Per term rather than one overall range, because the rates panel on /hours.html quotes
         each term separately. Postgres MIN/MAX ignore NULLs, which is exactly the behaviour
         wanted here: NULL means "this site isn't sold by that term" (Site 1 is monthly-only), so
         a term nobody sells comes back NULL and is dropped rather than shown as zero. */
      pool.query(
        `SELECT MIN(price_per_night_cents) AS night_low, MAX(price_per_night_cents) AS night_high,
                MIN(price_per_week_cents)  AS week_low,  MAX(price_per_week_cents)  AS week_high,
                MIN(price_per_month_cents) AS month_low, MAX(price_per_month_cents) AS month_high
           FROM sites
          WHERE active AND NOT permanently_occupied`
      ),
      pool.query(
        `SELECT name FROM amenities WHERE active AND show_on_homepage ORDER BY sort_order, name`
      ),
      /* Every photo, in the order /admin put them in: /gallery.html shows the lot and the homepage
         shows the show_on_homepage subset, which is cheaper to filter here than to ask for twice.
         The first of the homepage set is also what the share card is cut from, so the picture on a
         Facebook post is the picture at the top of the site. */
      pool.query(
        `SELECT id, caption, show_on_homepage FROM photos ORDER BY sort_order, created_at`
      ),
    ]);
    const r = rates.rows[0] ?? {};
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
    const value = {
      nightLow: num(r.night_low),
      nightHigh: num(r.night_high),
      weekLow: num(r.week_low),
      weekHigh: num(r.week_high),
      monthLow: num(r.month_low),
      monthHigh: num(r.month_high),
      amenities: amenities.rows.map((a) => a.name),
      allPhotos: photos.rows.map((p) => ({ id: p.id, caption: p.caption })),
      photos: photos.rows
        .filter((p) => p.show_on_homepage)
        .map((p) => ({ id: p.id, caption: p.caption })),
    };
    value.photoId = value.photos[0]?.id ?? null;
    // What schema.org's priceRange wants is the span of the whole offering, across every term.
    const lows = [value.nightLow, value.weekLow, value.monthLow].filter(Boolean);
    const highs = [value.nightHigh, value.weekHigh, value.monthHigh].filter(Boolean);
    value.priceLow = lows.length ? Math.min(...lows) : null;
    value.priceHigh = highs.length ? Math.max(...highs) : null;
    snapshotCache = { at: Date.now(), value };
  } catch (err) {
    console.warn("[seo] could not read the database for structured data:", err.message);
    snapshotCache = { at: Date.now(), value: null };
  }
  return snapshotCache.value;
}

const dollars = (cents) => `$${Math.round(cents / 100)}`;

/* Office hours, from /hours.html. Kept here as data rather than scraped out of that page: the
   page renders them as "8-5" against a label, which is for a human to read, not a parser. If the
   office hours change, they change in both places. */
const OPENING_HOURS = [
  { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "17:00" },
  { days: ["Saturday"], opens: "09:00", closes: "15:00" },
  { days: ["Sunday"], opens: "13:00", closes: "17:00" },
];

export function parkJsonLd(snap) {
  const ld = {
    "@context": "https://schema.org",
    /* RVPark is the specific type and the one Google understands for this category;
       LodgingBusiness is its parent and is what older consumers look for. Both is legal and
       costs nothing. */
    "@type": ["RVPark", "LodgingBusiness"],
    "@id": `${ORIGIN}/#park`,
    name: PARK.name,
    url: `${ORIGIN}/`,
    telephone: PARK.phone,
    email: PARK.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: PARK.street,
      addressLocality: PARK.city,
      addressRegion: PARK.region,
      postalCode: PARK.postal,
      addressCountry: PARK.country,
    },
    openingHoursSpecification: OPENING_HOURS.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    })),
    checkinTime: PARK.checkin,
    checkoutTime: PARK.checkout,
    /* A blanket park policy, not a per-site tag -- the per-site "pet friendly" flag was
       deliberately dropped from the guest-facing cards for exactly that reason. */
    petsAllowed: true,
    currenciesAccepted: "USD",
    image: `${ORIGIN}${ogImagePath(snap)}`,
    potentialAction: {
      "@type": "ReserveAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${ORIGIN}/#booking`,
        actionPlatform: [
          "http://schema.org/DesktopWebPlatform",
          "http://schema.org/MobileWebPlatform",
        ],
      },
      result: { "@type": "Reservation", name: "RV site reservation" },
    },
  };

  /* No geo block. The park's coordinates are not in this repository and a lat/long guessed off a
     street address would be a fabricated fact on a live commercial listing. Google Business
     Profile (phase 2) sets the authoritative pin; add it here from that once it exists. */

  if (snap?.priceLow && snap?.priceHigh) {
    ld.priceRange =
      snap.priceLow === snap.priceHigh
        ? dollars(snap.priceLow)
        : `${dollars(snap.priceLow)}-${dollars(snap.priceHigh)}`;
  }
  if (snap?.amenities?.length) {
    ld.amenityFeature = snap.amenities.map((name) => ({
      "@type": "LocationFeatureSpecification",
      name,
      value: true,
    }));
  }
  return ld;
}

/** Same-origin share card. `?v=` changes when the lead homepage photo does, so Facebook re-scrapes
 *  instead of serving the previous park's picture out of its cache for a month. */
export function ogImagePath(snap) {
  return snap?.photoId ? `/og-image.jpg?v=${snap.photoId}` : "/og-image.jpg";
}

/* --------------------------------------------------------------------------------------------- */

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

/**
 * The block injected before </head>. `html` is the page as it will be sent, so the title can be
 * read back out of it rather than kept in a second list that disagrees with the first.
 */
export function headBlock(target, html, snap) {
  const page = PAGES[target];
  const icons = [
    `<link rel="icon" href="/favicon.ico" sizes="32x32" />`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
    `<meta name="theme-color" content="#8c3a2b" />`,
  ];

  // Unknown page, or one that must not be indexed: an icon and nothing that invites a crawler.
  if (!page || page.index === false) return icons.join("\n");

  const title = TITLE_RE.exec(html)?.[1]?.trim() ?? PARK.name;
  const url = `${ORIGIN}${page.canonical}`;
  const image = `${ORIGIN}${ogImagePath(snap)}`;

  const tags = [
    ...icons,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta name="description" content="${esc(page.desc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(PARK.name)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(page.desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(PARK.name)}, Bandera, Texas" />`,
    `<meta property="og:locale" content="en_US" />`,
    /* summary_large_image, not summary: the small card crops a landscape photograph of a park
       into an unreadable square thumbnail. */
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(page.desc)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ];

  if (page.jsonLd) {
    /* Built from the same snapshot the visible page is rendered from (lib/ssr.js), so the rates
       in the markup and the rates in the structured data cannot disagree. */
    /* JSON.stringify cannot produce "</script>", but it can produce a literal "<" -- escaping it
       is what stops a stray character in an amenity name from closing the tag early. */
    const json = JSON.stringify(parkJsonLd(snap)).replace(/</g, "\\u003c");
    tags.push(`<script type="application/ld+json">${json}</script>`);
  }
  return tags.join("\n");
}

/** Splices the head block into a page. Kept beside headBlock so callers deal in whole pages. */
export function applyHead(target, html, snap) {
  const extra = headBlock(target, html, snap);
  if (!extra) return html;
  /* A function replacement, not a string one: the block contains dollar signs (the JSON-LD price
     range is "$45-$650") and a string replacement reads $& and $' as substitution patterns, which
     would splice fragments of the page into its own <head>. */
  return html.replace("</head>", () => `${extra}\n</head>`);
}

export function sitemapXml() {
  const urls = Object.entries(PAGES)
    .filter(([, p]) => p.index !== false)
    .map(
      ([, p]) =>
        `  <url>\n` +
        `    <loc>${ORIGIN}${p.canonical}</loc>\n` +
        `    <changefreq>${p.changefreq}</changefreq>\n` +
        `    <priority>${p.priority}</priority>\n` +
        `  </url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/* Disallow is not a security control -- /admin is protected by Basic Auth and /cancel.html by an
 * HMAC token, and both stay that way. It keeps the calendar feeds and the tokenised cancel links
 * out of the index, which is a privacy matter: a reservation-cancelling URL should not be
 * discoverable through a search engine. */
export function robotsTxt() {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /api/",
    "Disallow: /calendar/",
    "Disallow: /cancel.html",
    "",
    `Sitemap: ${ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}
