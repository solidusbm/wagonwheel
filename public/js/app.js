import { PARK_LAYOUT } from "./park-layout.js";

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const escapeHtml = (str) =>
  String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STEPS = ["Dates", "Site", "Details & Payment", "Confirmed"];

const state = {
  config: null,
  step: 0,
  checkIn: null,
  checkOut: null,
  numGuests: 1,
  sites: [],
  selectedSite: null,
  card: null,
};

const trail = document.getElementById("trail");
const datesPanel = document.getElementById("dates-panel");
const availabilityForm = document.getElementById("availability-form");
const availabilityError = document.getElementById("availability-error");
const sitesSection = document.getElementById("sites-section");
const siteMap = document.getElementById("site-map");
const siteGroups = document.getElementById("site-groups");
const stayummary = document.getElementById("stay-summary");
const bookingSection = document.getElementById("booking-section");
const bookingForm = document.getElementById("booking-form");
const bookingError = document.getElementById("booking-error");
const orderSummary = document.getElementById("order-summary");
const confirmationSection = document.getElementById("confirmation-section");
const payBtn = document.getElementById("pay-btn");
const occupantsList = document.getElementById("occupants-list");
const addOccupantBtn = document.getElementById("add-occupant");

init();

async function init() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("checkIn").min = today;
  document.getElementById("checkOut").min = today;

  state.config = await fetch("/api/config").then((r) => r.json());

  // Only warn about the sandbox when we are genuinely in it. The warning was hardcoded into the
  // page, so the live site was promising guests at checkout that no real card would be charged.
  if (state.config.squareEnvironment !== "production") {
    document.getElementById("sandbox-note").hidden = false;
    document.getElementById("card-label").textContent = "Card details (Square sandbox)";
  }

  availabilityForm.addEventListener("submit", onCheckAvailability);
  bookingForm.addEventListener("submit", onSubmitBooking);
  document.getElementById("backDates").addEventListener("click", () => goToStep(0));
  document.getElementById("backSite").addEventListener("click", () => goToStep(1));
  document.getElementById("bookAnother").addEventListener("click", resetToStart);
  addOccupantBtn.addEventListener("click", () => addOccupantRow());

  // Browsing/availability doesn't depend on Square, so a slow or failed SDK
  // load shouldn't block the rest of the page -- only checkout needs it,
  // and mountCard() reports that failure on its own.
  state.squareSdkReady = loadSquareSdk(state.config.squareEnvironment).catch((err) => {
    console.error("Square SDK failed to load", err);
    return null;
  });

  loadParkAmenities();
  loadHomepagePhotos();
  renderTrail();
}

// All real gallery photos come from /admin -> Photos now (DB-backed). Photos flagged
// "show on homepage" are inserted before the two illustrated placeholder figures (Medina
// River, Downtown Bandera) that are still hardcoded until real shots exist for those.
async function loadHomepagePhotos() {
  try {
    const res = await fetch("/api/photos");
    const photos = res.ok ? await res.json() : [];
    const homepagePhotos = photos.filter((p) => p.showOnHomepage);
    if (homepagePhotos.length === 0) return;
    const grid = document.getElementById("gallery-grid");
    grid.insertAdjacentHTML(
      "afterbegin",
      homepagePhotos
        .map(
          (p) => `
      <figure>
        <img src="/photos/${p.id}/image" alt="${escapeHtml(p.caption ?? "Wagon Wheel RV Park photo")}" loading="lazy" />
        ${p.caption ? `<figcaption><b>${escapeHtml(p.caption)}</b></figcaption>` : ""}
      </figure>`
        )
        .join("")
    );
  } catch (err) {
    console.error("Failed to load homepage photos", err);
  }
}

/* ---------- park-wide amenities ("what every site includes") ----------
   Curated icons for the amenities known at build time; anything added later from
   /admin's "Park amenities" panel falls back to DEFAULT_AMENITY_ICON. */
const PARK_AMENITY_ICONS = {
  "Water hookup": '<path d="M12 3c3 4 6 7 6 11a6 6 0 1 1-12 0c0-4 3-7 6-11z"/>',
  "30/50 amp electric": '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
  "Wastewater hookup": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  "Pet friendly": '<circle cx="12" cy="14" r="4"/><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/>',
  "Management on-site": '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
  "Trash service": '<path d="M4 7h16l-1.5 13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2L4 7zM9 7V4h6v3"/>',
  "New high-speed WiFi": '<path d="M5 12.5a11 11 0 0 1 14 0M8 16a6.5 6.5 0 0 1 8 0M12 19.5h.01"/>',
  "Laundry on site": '<path d="M4 4h16v16H4zM4 12h16M9 4v16"/>',
  "Keyless entry": '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  Showers: '<path d="M4 4v6a8 8 0 0 0 16 0V4M4 4h16M9 20h6"/>',
  "Dog park — large & small": '<circle cx="12" cy="14" r="4"/><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/>',
  "10% military discount — active or retired": '<path d="M12 2 4 7v6c0 5 3.4 7.4 8 9 4.6-1.6 8-4 8-9V7l-8-5z"/>',
};
const DEFAULT_AMENITY_ICON = '<path d="M20 6 9 17l-5-5"/>';

async function loadParkAmenities() {
  const grid = document.getElementById("amenities-grid");
  try {
    const res = await fetch("/api/homepage-amenities");
    const list = res.ok ? await res.json() : [];
    grid.innerHTML = list
      .map(
        (a) => `
      <div class="amenity">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${PARK_AMENITY_ICONS[a.name] ?? DEFAULT_AMENITY_ICON}</svg>
        <div class="t">${escapeHtml(a.name)}</div>
      </div>`
      )
      .join("");
  } catch (err) {
    console.error("Failed to load amenities", err);
  }
}

function loadSquareSdk(environment) {
  return new Promise((resolve, reject) => {
    const src =
      environment === "production"
        ? "https://web.squarecdn.com/v1/square.js"
        : "https://sandbox.web.squarecdn.com/v1/square.js";
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function renderTrail() {
  trail.innerHTML = STEPS.map((label, i) => {
    const cls = i === state.step ? "active" : i < state.step ? "done" : "";
    const line = i < STEPS.length - 1 ? '<div class="line"></div>' : "";
    return `<div class="marker ${cls}"><div class="dot"></div>${label}${line}</div>`;
  }).join("");
}

function goToStep(step) {
  state.step = step;
  datesPanel.hidden = step !== 0;
  sitesSection.hidden = step !== 1;
  bookingSection.hidden = step !== 2;
  confirmationSection.hidden = step !== 3;
  renderTrail();
  (step === 1 ? sitesSection : step === 2 ? bookingSection : step === 3 ? confirmationSection : datesPanel).scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

async function onCheckAvailability(event) {
  event.preventDefault();
  availabilityError.hidden = true;

  const checkIn = document.getElementById("checkIn").value;
  const checkOut = document.getElementById("checkOut").value;
  const numGuests = Number(document.getElementById("numGuests").value || 1);

  if (!checkIn || !checkOut || checkOut <= checkIn) {
    availabilityError.textContent = "Pick a check-out date after your check-in date.";
    availabilityError.hidden = false;
    return;
  }

  state.checkIn = checkIn;
  state.checkOut = checkOut;
  state.numGuests = numGuests;

  const params = new URLSearchParams({ checkIn, checkOut });
  const res = await fetch(`/api/availability?${params}`);
  if (!res.ok) {
    availabilityError.textContent = "Could not check availability. Try again in a moment.";
    availabilityError.hidden = false;
    return;
  }
  const sites = await res.json();
  state.sites = sites;
  state.selectedSite = null;
  renderSites(sites);
  goToStep(1);
}

function renderSites(sites) {
  const nights = nightsBetween(state.checkIn, state.checkOut);
  stayummary.textContent = `${formatDate(state.checkIn)} → ${formatDate(state.checkOut)} · ${nights} night${nights === 1 ? "" : "s"}`;

  renderSiteMap(sites);

  /* Grouped by whether you can book it, not by which row it's in. Front/Center/Back Row meant
     scanning three headings for the handful actually available on those dates -- the row matters
     when you're standing in the park, not when you're choosing. It moved onto the card instead,
     and the map above still shows the real geography. */
  // /api/availability already returns sites in sort_order, so both groups stay in park order
  // (Site 1..12) without re-sorting -- note that sorting by name here would put Site 10 before
  // Site 2. Within the unavailable group, sites merely booked for these dates come before ones
  // that can never be booked: the first might free up if the guest shifts a day, the second won't.
  const available = sites.filter((s) => s.available);
  const unavailable = sites
    .filter((s) => !s.available)
    .sort((a, b) => Number(a.permanently_occupied) - Number(b.permanently_occupied));

  siteGroups.innerHTML = "";

  const grid = (list) => {
    const el = document.createElement("div");
    el.className = "site-grid";
    for (const site of list) el.appendChild(renderSiteCard(site, nights));
    return el;
  };

  if (available.length === 0) {
    const none = document.createElement("p");
    none.className = "no-sites";
    none.textContent = "No sites are free for those dates. Try shifting them by a day or two, or call the office — they may be able to help.";
    siteGroups.appendChild(none);
  } else {
    const section = document.createElement("div");
    section.className = "site-area";
    section.innerHTML = `<h3>Available · ${available.length} site${available.length === 1 ? "" : "s"}</h3>`;
    section.appendChild(grid(available));
    siteGroups.appendChild(section);
  }

  // Shown, but folded away: a guest looking at a full park still wants to see the park, and it
  // shouldn't push the bookable sites off the screen to do it. Open by default only when there is
  // nothing available, since then it's the whole answer.
  if (unavailable.length > 0) {
    const section = document.createElement("details");
    section.className = "site-area site-unavailable";
    if (available.length === 0) section.open = true;
    section.innerHTML = `<summary><h3>Not available for these dates · ${unavailable.length}</h3></summary>`;
    section.appendChild(grid(unavailable));
    siteGroups.appendChild(section);
  }
}

/* Shows only the terms a site is actually rented by. A rate of null is N/A -- Site 1 is let by
   the month only -- so leading with a nightly figure would advertise a price the park won't sell.
   The first available term is shown large, the rest as an aside. */
function siteRates(site) {
  const small = (t) => `<span style="font-size:11px;color:var(--parchment-dim);">${t}</span>`;
  const rates = [
    [site.price_per_night_cents, "night"],
    [site.price_per_week_cents, "week"],
    [site.price_per_month_cents, "month"],
  ].filter(([cents]) => cents);

  if (rates.length === 0) return small("Rates not set");
  const [[leadCents, leadUnit], ...rest] = rates;
  // Electric is metered separately on anything charged at the monthly rate, so the monthly figure
  // must never appear on its own -- a guest comparing $350/month against a nightly rate that does
  // include power is comparing two different things.
  const elec = site.price_per_month_cents
    ? `<div class="rate-note">Monthly rate excludes electric &mdash; metered separately</div>`
    : "";
  return (
    `${money(leadCents)} ${small(`/${leadUnit}`)}` +
    rest.map(([cents, unit]) => ` ${small(`· ${money(cents)}/${unit}`)}`).join("") +
    elec
  );
}

/* A plain overlay rather than a gallery: one photo, tap anywhere or press Escape to close. It's
   built on demand and removed on close, so it can't sit in the DOM intercepting clicks meant for
   the card underneath -- which, on this page, would book a site. */
function openLightbox(site) {
  const box = document.createElement("div");
  box.className = "lightbox";
  box.innerHTML = `
    <button type="button" class="lightbox-close" aria-label="Close">&times;</button>
    <figure>
      <img src="/photos/${site.photo_id}/image?w=640" alt="${escapeHtml(site.name)}" />
      <figcaption>${escapeHtml(site.name)} · ${escapeHtml(site.area)}</figcaption>
    </figure>`;

  const close = () => {
    box.remove();
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  box.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.style.overflow = "hidden";
  document.body.appendChild(box);
  box.querySelector(".lightbox-close").focus();
}

function renderSiteCard(site, nights) {
  const card = document.createElement("div");
  card.className = `site-card${site.available ? "" : " unavailable"}${state.selectedSite?.id === site.id ? " selected" : ""}`;
  const tags = [
    `${site.amp_service} amp`,
    site.pull_through ? "Pull-through" : "Back-in",
    site.max_rig_length ? `Up to ${site.max_rig_length} ft` : null,
    ...(site.amenities ?? []),
  ].filter(Boolean);

  /* Assigned in /admin -> Sites -> Edit -> Photos. Served at a capped width: twelve full-size
     shots is several megabytes, and the list has to appear before the pictures do on cellular.
     The fixed-ratio box means cards don't reflow as images arrive, and a site with no photo simply
     has no box rather than a broken frame. */
  /* A site with no photo assigned still gets a box, so the cards in a row line up and the odd one
     out reads as "no picture yet" rather than as a broken image. Not all twelve are photographed. */
  const photo = site.photo_id
    ? `<button type="button" class="site-photo" data-photo="${site.photo_id}"
         aria-label="Enlarge the photo of ${escapeHtml(site.name)}">
         <img src="/photos/${site.photo_id}/image?w=320" alt="${escapeHtml(site.name)}" loading="lazy" />
       </button>`
    : `<div class="site-photo site-photo-none" aria-hidden="true">
         <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="50" cy="50" r="10" fill="currentColor"/><g stroke="currentColor" stroke-width="5"><line x1="50" y1="4" x2="50" y2="96"/><line x1="4" y1="50" x2="96" y2="50"/><line x1="17" y1="17" x2="83" y2="83"/><line x1="17" y1="83" x2="83" y2="17"/></g></svg>
       </div>`;

  card.innerHTML = `
    ${photo}
    <h4>${escapeHtml(site.name)}</h4>
    <div class="site-area-label">${escapeHtml(site.area)}</div>
    <div class="site-tags">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
    <div class="site-price">${siteRates(site)}</div>
    ${site.notes ? `<div class="site-notes">${escapeHtml(site.notes)}</div>` : ""}
    <div class="availability-flag ${site.available ? "available" : "unavailable"}">
      ${site.available ? "Available" : site.permanently_occupied ? "Occupied — not bookable" : "Booked for these dates"}
    </div>
    ${site.permanently_occupied ? "" : renderBookedRanges(site.bookedRanges)}
  `;

  /* The whole card is a click target that selects the site and jumps to payment, so the photo
     MUST stop the event. Without this, tapping a picture to look at it silently books that site. */
  card.querySelector(".site-photo")?.addEventListener("click", (event) => {
    event.stopPropagation();
    openLightbox(site);
  });

  if (site.available) {
    card.addEventListener("click", () => selectSite(site));
  }

  return card;
}

function renderBookedRanges(ranges) {
  if (!ranges || ranges.length === 0) return "";
  const shown = ranges.slice(0, 4).map((r) => `${formatDate(r.checkIn)}–${formatDate(r.checkOut)}`);
  const extra = ranges.length > 4 ? ` +${ranges.length - 4} more` : "";
  return `<div class="booked-ranges"><span class="l">Booked</span>${shown.join(", ")}${extra}</div>`;
}

/* ---------- site map ----------
   Draws `PARK_LAYOUT` (public/js/park-layout.js) -- the park's real geometry in feet,
   arranged by hand against Mangold Engineering drawing 100-7799 as marked up by the park.
   All the "where is everything" knowledge lives in that file; this code only renders it,
   so correcting the park means editing the layout, not this function.

   The SVG works directly in feet: the viewBox is the park's own footprint plus a margin,
   and every size below is a real-world dimension. Type is sized in feet too, which is what
   keeps the site numbers legible when the map scales down to a phone.

   Sites are matched to bays by the number in their name, so availability, selection and
   the permanently-occupied flag all still come from the database. A site with no bay in
   the layout is drawn in an overflow row beneath the park rather than silently vanishing.

   Still not measured: pad sizes (a uniform 20 x 55 ft) and road widths (24 ft). Positions
   are from the plan; those two are defaults awaiting a tape measure. */
const PLAN_MARGIN = 30; // feet of breathing room around the park
const NUM_FT = 11; // site number height, in feet
const JOIN_FT = 15; // two road ends closer than this are the same junction

function renderSiteMap(sites) {
  const plan = PARK_LAYOUT;
  const bearing = plan.bearing || 0;

  const byNumber = new Map();
  for (const site of sites) {
    const n = Number(String(site.name).replace(/[^0-9]/g, ""));
    if (!Number.isNaN(n)) byNumber.set(n, site);
  }

  // Bays that have a matching site, plus any site the layout doesn't know about yet.
  const placed = plan.bays.filter((b) => byNumber.has(b.n));
  const known = new Set(placed.map((b) => b.n));
  const orphans = sites.filter((s) => {
    const n = Number(String(s.name).replace(/[^0-9]/g, ""));
    return Number.isNaN(n) || !known.has(n);
  });

  const corners = (r) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ].map((p) => spin(p, { x: cx, y: cy }, r.rot || 0));
  };

  // Everything the park occupies, in plan coordinates, so the viewBox can be derived
  // rather than guessed.
  const extent = [];
  placed.forEach((b) => extent.push(...corners(b)));
  extent.push(...corners(plan.office));
  plan.roads.forEach((r) => {
    const half = r.w / 2;
    r.pts.forEach((p) => {
      extent.push({ x: p.x - half, y: p.y - half }, { x: p.x + half, y: p.y + half });
    });
  });

  const raw = boundsOf(extent);
  const pivot = { x: (raw.minX + raw.maxX) / 2, y: (raw.minY + raw.maxY) / 2 };

  // The overflow row sits below the park in plan space, so it rotates along with it.
  let overflow = "";
  if (orphans.length) {
    const w = 20;
    const h = 55;
    const gap = 5;
    const y = raw.maxY + 34;
    orphans.forEach((site, i) => {
      const x = raw.minX + i * (w + gap);
      overflow += bayMarkup(site, { x, y, w, h, rot: 0 }, bearing);
      extent.push({ x, y }, { x: x + w, y: y + h });
    });
    overflow =
      mapText(raw.minX, raw.maxY + 26, "NOT ON THE PLAN YET", {
        size: 10,
        anchor: "start",
        tilt: -bearing,
      }) + overflow;
  }

  let roads = "";
  plan.roads.forEach((r) => {
    const d = r.pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    roads += `<path d="${d}" stroke="var(--line)" stroke-width="${r.w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  });

  const o = plan.office;
  const office =
    `<g transform="rotate(${o.rot || 0} ${o.x + o.w / 2} ${o.y + o.h / 2})">` +
    `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="3" fill="var(--bg-panel-2)" stroke="var(--gold)" stroke-width="2"/></g>` +
    mapText(o.x + o.w / 2, o.y + o.h / 2 + 4, "OFFICE", { size: 11, fill: "var(--gold)", tilt: -bearing });

  const bays = placed.map((b) => bayMarkup(byNumber.get(b.n), b, bearing)).join("");

  // A road end that meets no other road is where the park opens onto Polly Peak Dr.
  // Finding them from the geometry means the labels follow the layout instead of being
  // pinned to particular entries in it.
  const gates = openEnds(plan.roads).sort((a, b) => a.y - b.y);
  let gateLabels = "";
  gates.forEach((g, i) => {
    const first = i === 0;
    const spec = first
      ? { text: "ENTRANCE", x: g.x + 4, y: g.y - 24, size: 13, anchor: "end", fill: "var(--gold)" }
      : { text: "SECOND ACCESS", x: g.x + 6, y: g.y + 8, size: 11, anchor: "start", fill: "var(--parchment-dim)" };
    gateLabels += mapText(spec.x, spec.y, spec.text, {
      size: spec.size,
      fill: spec.fill,
      anchor: spec.anchor,
      tilt: -bearing,
    });
    extent.push(...labelExtent(spec, -bearing));
  });
  if (gates.length) {
    const spec = {
      text: "POLLY PEAK DR.",
      x: Math.max(...gates.map((g) => g.x)) + 96,
      y: gates.reduce((sum, g) => sum + g.y, 0) / gates.length,
      size: 11,
      anchor: "middle",
    };
    gateLabels += mapText(spec.x, spec.y, spec.text, { size: spec.size, tilt: -bearing - 90 });
    extent.push(...labelExtent(spec, -bearing - 90));
  }

  const box = boundsOf(extent.map((p) => spin(p, pivot, bearing)));
  const vx = box.minX - PLAN_MARGIN;
  const vy = box.minY - PLAN_MARGIN;
  const vw = box.maxX - box.minX + PLAN_MARGIN * 2;
  const vh = box.maxY - box.minY + PLAN_MARGIN * 2;

  siteMap.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  siteMap.innerHTML = `
    <g transform="translate(${vx + 16} ${vy + vh - 26})">
      <line x1="0" y1="10" x2="0" y2="-10" stroke="var(--parchment-dim)" stroke-width="1"/>
      <path d="M0 -14 L3.4 -6 L0 -8.4 L-3.4 -6 Z" fill="var(--parchment-dim)"/>
      <text x="0" y="20" text-anchor="middle" fill="var(--parchment-dim)" font-family="JetBrains Mono, monospace" font-size="10">N</text>
    </g>
    <g transform="rotate(${bearing} ${pivot.x} ${pivot.y})">
      ${roads}${office}${bays}${overflow}${gateLabels}
    </g>
    <text x="${vx + vw - 8}" y="${vy + vh - 8}" text-anchor="end" fill="var(--parchment-dim)" font-family="JetBrains Mono, monospace" font-size="9" opacity="0.7">PAD SIZES NOT YET MEASURED</text>
  `;

  siteMap.querySelectorAll("[data-site-id]").forEach((el) => {
    if (el.classList.contains("taken")) return;
    el.addEventListener("click", () => {
      const id = Number(el.getAttribute("data-site-id"));
      const site = sites.find((s) => s.id === id);
      if (site) selectSite(site);
    });
  });
}

function spin(p, c, deg) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function boundsOf(pts) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/* Road ends that no other road reaches -- the park's openings onto the street.
   Measured against whole segments, not just vertices: a rung that meets the west leg
   halfway along it is joined, even though it is nowhere near either of the leg's ends. */
function openEnds(roads) {
  const ends = [];
  roads.forEach((r, i) => {
    [r.pts[0], r.pts[r.pts.length - 1]].forEach((end) => {
      const met = roads.some((other, j) => {
        if (j === i) return false;
        for (let k = 1; k < other.pts.length; k++) {
          if (distToSegment(end, other.pts[k - 1], other.pts[k]) <= JOIN_FT) return true;
        }
        return false;
      });
      if (!met) ends.push(end);
    });
  });
  return ends;
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/* Roughly where a label's baseline starts and ends, so the viewBox reserves room for it
   instead of cropping it. Monospace at ~0.62 em per character. */
function labelExtent(spec, tilt) {
  const len = spec.text.length * spec.size * 0.62;
  const lead = spec.anchor === "end" ? -len : spec.anchor === "middle" ? -len / 2 : 0;
  const a = (tilt * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pad = spec.size;
  return [lead, lead + len].map((d) => ({
    x: spec.x + d * cos + (d < 0 ? -pad : pad) * 0,
    y: spec.y + d * sin,
  })).concat([{ x: spec.x, y: spec.y - pad }, { x: spec.x, y: spec.y + pad }]);
}

function mapText(x, y, text, opts = {}) {
  const { size = 11, fill = "var(--parchment-dim)", anchor = "middle", tilt = 0, ls = 0.6 } = opts;
  return `<text x="${x}" y="${y}" transform="rotate(${tilt} ${x} ${y})" text-anchor="${anchor}" fill="${fill}" font-family="JetBrains Mono, monospace" font-size="${size}" letter-spacing="${ls}">${escapeHtml(text)}</text>`;
}

function bayMarkup(site, bay, bearing) {
  const selected = state.selectedSite?.id === site.id;
  const cls = `site-pin ${site.available ? "" : "taken"} ${selected ? "selected" : ""}`;
  const num = String(site.name).replace(/[^0-9]/g, "") || "•";
  const rot = bay.rot || 0;
  const cx = bay.x + bay.w / 2;
  const cy = bay.y + bay.h / 2;
  return `<g class="${cls}" data-site-id="${site.id}" transform="rotate(${rot} ${cx} ${cy})">
    <rect class="base" x="${bay.x}" y="${bay.y}" width="${bay.w}" height="${bay.h}" rx="2"/>
    <text x="${cx}" y="${cy + NUM_FT / 2.6}" transform="rotate(${-rot - bearing} ${cx} ${cy})">${num}</text>
  </g>`;
}

let occupantRowCount = 0;

function addOccupantRow() {
  occupantRowCount += 1;
  const id = occupantRowCount;
  const row = document.createElement("div");
  row.className = "occupant-row";
  row.dataset.occupantRow = id;
  row.innerHTML = `
    <div class="field"><label for="occName${id}">Name</label><input type="text" id="occName${id}" /></div>
    <div class="field"><label for="occAge${id}">Age</label><input type="text" id="occAge${id}" inputmode="numeric" /></div>
    <div class="field"><label for="occRel${id}">Relationship</label><input type="text" id="occRel${id}" /></div>
    <button type="button" class="btn btn-ghost" data-remove-occupant="${id}">Remove</button>
  `;
  row.querySelector("[data-remove-occupant]").addEventListener("click", () => row.remove());
  occupantsList.appendChild(row);
}

function resetApplicationFields() {
  occupantsList.innerHTML = "";
  occupantRowCount = 0;
  addOccupantRow();
  // Re-collapse the optional application sections. form.reset() clears the inputs inside them but
  // leaves a section the previous guest opened standing open for the next one.
  document.querySelectorAll("details.form-section").forEach((d) => d.removeAttribute("open"));
}

function val(id) {
  return (document.getElementById(id)?.value ?? "").trim() || null;
}

function buildApplication() {
  const occupants = [...occupantsList.querySelectorAll("[data-occupant-row]")]
    .map((row) => {
      const id = row.dataset.occupantRow;
      return { name: val(`occName${id}`), age: val(`occAge${id}`), relationship: val(`occRel${id}`) };
    })
    .filter((o) => o.name || o.age || o.relationship);

  const vehicles = [1, 2]
    .map((n) => ({ make: val(`v${n}Make`), model: val(`v${n}Model`), year: val(`v${n}Year`), plate: val(`v${n}Plate`) }))
    .filter((v) => v.make || v.model || v.year || v.plate);

  const pets = [1, 2]
    .map((n) => ({
      type: val(`pet${n}Type`),
      name: val(`pet${n}Name`),
      color: val(`pet${n}Color`),
      weight: val(`pet${n}Weight`),
      age: val(`pet${n}Age`),
      gender: val(`pet${n}Gender`),
      spayedNeutered: val(`pet${n}Spayed`),
      rabiesVaccine: val(`pet${n}Rabies`),
    }))
    .filter((p) => p.type || p.name);

  const rv = {
    make: val("rvMake"),
    model: val("rvModel"),
    year: val("rvYear"),
    length: val("rvLength"),
    width: val("rvWidth"),
    slides: val("rvSlides"),
    plate: val("rvPlate"),
    amp: val("rvAmp"),
    rvClass: val("rvClass"),
    trailerType: val("rvTrailerType"),
  };

  const spouse = {
    name: val("spouseName"),
    dob: val("spouseDob"),
    phone: val("spousePhone"),
    driversLicense: { number: val("spouseLicenseNumber"), state: null },
  };

  return {
    dob: val("appDob"),
    driversLicense: { number: val("appLicenseNumber"), state: val("appLicenseState") },
    spouse: spouse.name ? spouse : null,
    occupants,
    vehicles,
    rv: rv.make || rv.model ? rv : null,
    pets,
  };
}

async function renderOrderSummary(site) {
  const head = `<h3>${escapeHtml(site.name)}</h3><p>${escapeHtml(site.area)}</p>`;
  const params = new URLSearchParams({ siteId: site.id, checkIn: state.checkIn, checkOut: state.checkOut });

  let q;
  try {
    const res = await fetch(`/api/quote?${params}`);
    q = await res.json();
    if (!res.ok) throw new Error(q.error ?? "Could not price this stay");
  } catch (err) {
    orderSummary.innerHTML = `${head}<div class="summary-row"><span>${escapeHtml(err.message)}</span><span></span></div>`;
    return;
  }

  /* A stay billed at the monthly rate carries two consequences the guest has to be told BEFORE
     they pay, not after: electric is metered separately and isn't in this total, and cancelling
     costs a flat $100 rather than 11.11%. Both hang off the same monthlyRateApplied flag, so a
     short stay that merely reached the cap gets the same treatment as a full month -- confirmed
     by the park 2026-08-12. The confirmation email repeats both back. */
  const monthlyNote = q.monthlyRateApplied
    ? `<p class="summary-note"><b>Charged at the monthly rate.</b> A stay is never billed more than the monthly rate for each month.
       <b>Electric is not included</b> — it's metered separately and settled at the office. Cancelling a booking charged at the
       monthly rate carries a flat $100 service fee.</p>`
    : "";

  orderSummary.innerHTML = `
    ${head}
    <div class="summary-row"><span>${formatDate(state.checkIn)} → ${formatDate(state.checkOut)}</span><span>${q.nights} night${q.nights === 1 ? "" : "s"}</span></div>
    ${q.lines.map((l) => `<div class="summary-row"><span>${escapeHtml(l.label)}</span><span>${money(l.amountCents)}</span></div>`).join("")}
    ${q.bookingFeeCents ? `<div class="summary-row"><span>Booking fee</span><span>${money(q.bookingFeeCents)}</span></div>` : ""}
    <div class="summary-row total"><span>Total</span><span>${money(q.totalCents)}</span></div>
    ${monthlyNote}
  `;
}

async function selectSite(site) {
  state.selectedSite = site;
  renderSites(state.sites);

  /* The price comes from the server, which is the only thing that prices a stay. This used to be
     worked out here -- stacking weeks and nights, unaware of the monthly cap, and adding a $5
     booking fee the park had already dropped -- so the total a guest agreed to could differ from
     what their card was charged. Anything with a rate in it belongs on the server side now. */
  orderSummary.innerHTML = `
    <h3>${escapeHtml(site.name)}</h3>
    <p>${escapeHtml(site.area)}</p>
    <div class="summary-row"><span>Working out your total…</span><span></span></div>
  `;

  bookingError.hidden = true;
  bookingForm.reset();
  resetApplicationFields();
  goToStep(2);

  await Promise.all([renderOrderSummary(site), mountCard()]);
}

async function mountCard() {
  const container = document.getElementById("card-container");
  container.innerHTML = "";

  if (!state.config.squareApplicationId || !state.config.squareLocationId) {
    container.innerHTML = '<p class="error-msg" style="margin:0;">Square is not configured yet (missing application/location ID). Payment is disabled until SQUARE_APPLICATION_ID and SQUARE_LOCATION_ID are set.</p>';
    payBtn.disabled = true;
    return;
  }

  payBtn.disabled = true;
  await state.squareSdkReady;
  if (!window.Square) {
    container.innerHTML = '<p class="error-msg" style="margin:0;">Payment form failed to load. Check your connection and try again.</p>';
    return;
  }

  payBtn.disabled = false;
  const payments = window.Square.payments(state.config.squareApplicationId, state.config.squareLocationId);
  state.card = await payments.card();
  await state.card.attach("#card-container");
}

async function onSubmitBooking(event) {
  event.preventDefault();
  bookingError.hidden = true;

  if (!state.selectedSite || !state.card) {
    bookingError.textContent = "Select a site first.";
    bookingError.hidden = false;
    return;
  }

  payBtn.disabled = true;
  payBtn.textContent = "Processing…";

  try {
    const tokenResult = await state.card.tokenize();
    if (tokenResult.status !== "OK") {
      throw new Error(tokenResult.errors?.[0]?.message ?? "Card could not be verified");
    }

    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId: state.selectedSite.id,
        checkIn: state.checkIn,
        checkOut: state.checkOut,
        sourceId: tokenResult.token,
        guest: {
          name: document.getElementById("guestName").value,
          email: document.getElementById("guestEmail").value,
          phone: document.getElementById("guestPhone").value || null,
          numGuests: state.numGuests,
          notes: document.getElementById("guestNotes").value || null,
          application: buildApplication(),
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Booking failed");
    }

    showConfirmation(data);
  } catch (err) {
    bookingError.textContent = err.message;
    bookingError.hidden = false;
  } finally {
    payBtn.disabled = false;
    payBtn.textContent = "Pay & reserve";
  }
}

function showConfirmation(reservation) {
  document.getElementById("confirmation-code").textContent = reservation.reservationCode;
  document.getElementById("confirmation-details").innerHTML = `
    <div class="summary-row"><span>Site</span><span>${escapeHtml(reservation.site.name)} · ${escapeHtml(reservation.site.area)}</span></div>
    <div class="summary-row"><span>Dates</span><span>${formatDate(reservation.checkIn)} → ${formatDate(reservation.checkOut)}</span></div>
    <div class="summary-row"><span>Nights</span><span>${reservation.nights}</span></div>
    <div class="summary-row"><span>Guest</span><span>${reservation.guest.name}</span></div>
    <div class="summary-row total"><span>Total paid</span><span>${money(reservation.totalCents)}</span></div>
  `;
  goToStep(3);
}

function resetToStart() {
  state.checkIn = null;
  state.checkOut = null;
  state.sites = [];
  state.selectedSite = null;
  state.card = null;
  availabilityForm.reset();
  goToStep(0);
}

function nightsBetween(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
