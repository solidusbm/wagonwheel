import { esc } from "./seo.js";
import { ELECTRIC_LEAD, ELECTRIC_DETAIL } from "./email.js";

/* Server-rendered page content -- plan item 1.3, "put the facts in the HTML, not just the
 * JavaScript".
 *
 * The homepage's amenity grid and photo grid used to arrive empty and be filled by app.js from
 * /api/homepage-amenities and /api/photos. Anything that does not run scripts therefore saw an
 * empty <div> where the park describes what it sells -- which is most of what a crawler was
 * missing. The rates were worse than invisible: they existed nowhere on the site until a guest had
 * already picked dates inside the booking flow.
 *
 * These render into containers marked `data-ssr="..."` in the HTML, from the same snapshot the
 * structured data is built from, so the JSON-LD and the visible page cannot disagree.
 *
 * The client-side loaders are GONE rather than left in place. Two copies of the same template is
 * the thing that rots, and there is no reason for a browser to fetch and re-render markup the
 * server has already sent -- it costs two round-trips on the cellular connections this park's
 * guests are usually on.
 */

/* Moved here from app.js, whole. It is on the server now because the server draws the grid; a
 * shared module imported by both would have been neater to look at and would have sat outside the
 * asset versioner's reach -- the versioner rewrites asset URLs it finds in the HTML, and an
 * `import` specifier inside app.js is not in the HTML, so the file could have gone on being served
 * from a four-hour cache after a deploy. That is the exact failure described in
 * lib/assetVersion.js, and it is not worth re-creating for a set of decorative icons. */
const AMENITY_ICONS = {
  "Water hookup": '<path d="M12 3c3 4 6 7 6 11a6 6 0 1 1-12 0c0-4 3-7 6-11z"/>',
  "30/50 amp electric": '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
  "Wastewater hookup": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  "Pet friendly":
    '<circle cx="12" cy="14" r="4"/><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/>',
  "Management on-site": '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
  "Trash service": '<path d="M4 7h16l-1.5 13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2L4 7zM9 7V4h6v3"/>',
  "New high-speed WiFi": '<path d="M5 12.5a11 11 0 0 1 14 0M8 16a6.5 6.5 0 0 1 8 0M12 19.5h.01"/>',
  "Laundry on site": '<path d="M4 4h16v16H4zM4 12h16M9 4v16"/>',
  "Keyless entry": '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  Showers: '<path d="M4 4v6a8 8 0 0 0 16 0V4M4 4h16M9 20h6"/>',
  "Dog park — large & small":
    '<circle cx="12" cy="14" r="4"/><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/>',
  "10% military discount — active or retired": '<path d="M12 2 4 7v6c0 5 3.4 7.4 8 9 4.6-1.6 8-4 8-9V7l-8-5z"/>',
};
const DEFAULT_AMENITY_ICON = '<path d="M20 6 9 17l-5-5"/>';

function amenitiesHtml(snap) {
  if (!snap?.amenities?.length) return null;
  return snap.amenities
    .map(
      (name) => `
      <div class="amenity">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${
          AMENITY_ICONS[name] ?? DEFAULT_AMENITY_ICON
        }</svg>
        <div class="t">${esc(name)}</div>
      </div>`
    )
    .join("");
}

function galleryHtml(snap) {
  if (!snap?.photos?.length) return null;
  /* ?w=640, as app.js asked for: the originals run to 8.4MB across fifteen photos, which is a
     spinner rather than a homepage on Hill Country cellular. `loading="lazy"` stays -- a crawler
     reads the src and the alt text regardless, and a phone should not fetch fifteen images to
     show three. */
  return snap.photos
    .map(
      (p) => `
      <figure>
        <img src="/photos/${p.id}/image?w=640" alt="${esc(
          p.caption ?? "Wagon Wheel RV Park photo"
        )}" loading="lazy" />
        ${p.caption ? `<figcaption><b>${esc(p.caption)}</b></figcaption>` : ""}
      </figure>`
    )
    .join("");
}

/* /gallery.html -- the whole album. Full-size sources, as the page asked for before: this is the
 * page someone opens to look at the photographs, not a thumbnail strip. It carries its own empty
 * note because the page has nothing else in it, and a bare heading over blank space reads as a
 * broken page rather than a park that hasn't uploaded yet. */
function galleryAllHtml(snap) {
  if (!snap?.allPhotos) return null;
  if (!snap.allPhotos.length) {
    return `<p class="empty-note" style="color:var(--parchment-dim); font-style:italic;">No photos uploaded yet.</p>`;
  }
  const figures = snap.allPhotos
    .map(
      (p) => `
        <figure>
          <img src="/photos/${p.id}/image" alt="${esc(
            p.caption ?? "Wagon Wheel RV Park photo"
          )}" loading="lazy" />
          ${p.caption ? `<figcaption><b>${esc(p.caption)}</b></figcaption>` : ""}
        </figure>`
    )
    .join("");
  return `<div class="full-gallery" id="full-gallery">${figures}
      </div>`;
}

const money = (cents) => `$${Math.round(cents / 100)}`;

/* A range rather than a row per site. The park has five bookable sites against twelve pads and
 * that set changes as residents come and go, so a table naming each one would need reprinting
 * every time somebody moves -- and would advertise, by name, sites a guest cannot book. "From $45
 * a night" stays true through all of it. Terms the park does not sell at all are dropped rather
 * than shown as N/A. */
function ratesHtml(snap) {
  const terms = [
    { label: "Per night", lo: snap?.nightLow, hi: snap?.nightHigh },
    { label: "Per week", lo: snap?.weekLow, hi: snap?.weekHigh },
    { label: "Per month", lo: snap?.monthLow, hi: snap?.monthHigh },
  ].filter((t) => t.lo);

  if (!terms.length) return null;

  const cells = terms
    .map(
      (t) => `
        <div class="stat">
          <div class="n">${t.lo === t.hi ? money(t.lo) : `${money(t.lo)}–${money(t.hi)}`}</div>
          <div class="l">${t.label}</div>
        </div>`
    )
    .join("");

  return `
      <div class="stat-list" style="grid-template-columns:repeat(${terms.length},1fr); margin-bottom:18px;">${cells}
      </div>
      <p class="sub" style="margin:0 0 16px;">Rates vary by site. Pick your dates on the
        <a href="/#booking">booking page</a> to see what each available site costs for your stay.</p>`;
}

/* The monthly figure on its own, for /monthly-stays.html. Same source as the three-term panel on
 * /hours.html -- a page about monthly stays that quoted a nightly rate would just be noise. */
function monthlyRatesHtml(snap) {
  if (!snap?.monthLow) return null;
  const range = snap.monthLow === snap.monthHigh ? money(snap.monthLow) : `${money(snap.monthLow)}–${money(snap.monthHigh)}`;
  return `
      <div class="stat-list" style="grid-template-columns:1fr; margin-bottom:18px;">
        <div class="stat">
          <div class="n">${range}</div>
          <div class="l">Per month, depending on the site</div>
        </div>
      </div>`;
}

/* Straight from the constants the guest confirmation email uses. This claim is made in six places
 * now and they must not drift -- see the note in CLAUDE.md -- so the sixth reads the same string
 * the others do rather than restating it. */
function electricTermsHtml() {
  return `<p><strong>${esc(ELECTRIC_LEAD)}</strong> ${esc(ELECTRIC_DETAIL)}
        Nightly and weekly rates do include it.</p>`;
}

const RENDERERS = {
  amenities: amenitiesHtml,
  gallery: galleryHtml,
  "gallery-all": galleryAllHtml,
  rates: ratesHtml,
  "monthly-rates": monthlyRatesHtml,
  "electric-terms": electricTermsHtml,
};

/* Fills every empty element carrying data-ssr="<name>". The containers ARE empty in the source --
 * the regex deliberately only matches an open tag followed immediately by its close tag, so this
 * can never eat hand-written markup if one of them gains content later. An unknown name, or a
 * renderer with no data (the database is down, the park has no photos yet), leaves the element
 * exactly as it was: an empty grid, which is what the page did before this existed. */
const SSR_SLOT = /(<(div|section)\b[^>]*\bdata-ssr="([a-z-]+)"[^>]*>)(<\/\2>)/g;

export function applyBody(html, snap) {
  return html.replace(SSR_SLOT, (whole, open, tag, name, close) => {
    const rendered = RENDERERS[name]?.(snap);
    return rendered ? `${open}${rendered}\n    ${close}` : whole;
  });
}
