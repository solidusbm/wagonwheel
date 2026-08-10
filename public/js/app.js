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

  const byArea = new Map();
  for (const site of sites) {
    if (!byArea.has(site.area)) byArea.set(site.area, []);
    byArea.get(site.area).push(site);
  }

  siteGroups.innerHTML = "";
  for (const [area, areaSites] of byArea) {
    const section = document.createElement("div");
    section.className = "site-area";
    section.innerHTML = `<h3>${area}</h3>`;
    const grid = document.createElement("div");
    grid.className = "site-grid";
    for (const site of areaSites) {
      grid.appendChild(renderSiteCard(site, nights));
    }
    section.appendChild(grid);
    siteGroups.appendChild(section);
  }
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

  card.innerHTML = `
    <h4>${escapeHtml(site.name)}</h4>
    <div class="site-tags">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
    <div class="site-price">${money(site.price_per_night_cents)} <span style="font-size:11px;color:var(--parchment-dim);">/night</span>${site.price_per_week_cents ? ` <span style="font-size:11px;color:var(--parchment-dim);">· ${money(site.price_per_week_cents)}/week</span>` : ""}</div>
    ${site.notes ? `<div class="site-notes">${escapeHtml(site.notes)}</div>` : ""}
    <div class="availability-flag ${site.available ? "available" : "unavailable"}">
      ${site.available ? "Available" : site.permanently_occupied ? "Occupied — not bookable" : "Booked for these dates"}
    </div>
    ${site.permanently_occupied ? "" : renderBookedRanges(site.bookedRanges)}
  `;

  if (site.available) {
    card.addEventListener("click", () => selectSite(site, nights));
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
   Traced from the county-filed septic/site plan -- Mangold Engineering drawing 100-7799,
   sheet 2 of 5, "System Layout", scale 1" = 100' -- photographed and supplied by the park
   on 2026-08-10. What that plan establishes, and what this map therefore reproduces:

     - The developed block sits on a parcel bounded by Broad Oak Drive along the northwest
       and Polly Peak Dr. along the east, and it is rotated roughly 12 degrees off north:
       the rows run WSW-ENE, parallel to the Polly Peak frontage, NOT square to the page.
     - The entrance comes off Polly Peak Dr. at the northeast corner and runs west to the
       office, which sits at the north end with a turnaround loop beside it.
     - A two-way road loops the whole block, with a two-way rung through the middle. Every
       site is a back-in bay hanging off one of those roads -- there are no pull-throughs
       in the plan, which matches `pull_through = false` on all twelve rows in the database.
     - Sites 1-2 are a small angled pair at the west end against the existing fence, set
       apart from the two uniform rows (3-7 north of the rung, 8-12 south of it).

   Grade falls from about 1355 ft at the Polly Peak corner to 1335 ft at the south end. The
   1250-gal septic tank and the drainfield occupy the south corner and are deliberately not
   drawn -- they are on the plan, but they are not something a guest picks a site by.

   NOT yet to scale: bay dimensions and road widths here are legible-on-a-phone proportions,
   not measured off the 1" = 100' sheet. Orientation, topology, adjacency and numbering are
   from the plan and are correct; the footages are not. Measuring the sheet (or pacing a
   couple of pads at the park) is what closes that gap.

   Row membership is still read from each site's `area`, so edits made in /admin flow
   through: the smallest/first area renders as the angled pair, every other area as a row. */
const PARK_TILT = -12; // degrees off north, per the plan
const LOOP_LEFT = 132;
const LOOP_RIGHT = 760;
const ROW_LEFT = 292; // rows begin east of the sites 1-2 pair, leaving it a clear pocket
const BAY_H = 88;
const BAY_GAP = 12;
const ROAD_GAP = 30; // two-way road width between a row's foot and the next road
const FIRST_ROW_Y = 300;
const ENTRY_Y = 216;
const OFFICE = { x: 408, y: 150 };
const TURNAROUND = { x: 540, y: ENTRY_Y - 52, r: 52 };

const ROAD = `stroke="var(--line)" stroke-linecap="round" fill="none"`;

function mapText(x, y, text, opts = {}) {
  const { size = 17, fill = "var(--parchment-dim)", anchor = "middle", tilt = -PARK_TILT, ls = 1 } = opts;
  return `<text x="${x}" y="${y}" transform="rotate(${tilt} ${x} ${y})" text-anchor="${anchor}" fill="${fill}" font-family="JetBrains Mono, monospace" font-size="${size}" letter-spacing="${ls}">${escapeHtml(text)}</text>`;
}

function renderSiteMap(sites) {
  const byArea = new Map();
  for (const site of sites) {
    if (!byArea.has(site.area)) byArea.set(site.area, []);
    byArea.get(site.area).push(site);
  }
  const areas = [...byArea.keys()];
  const rowAreas = areas.slice();
  let pairSites = null;
  if (areas.length > 1 && byArea.get(areas[0]).length < Math.max(...areas.map((a) => byArea.get(a).length))) {
    pairSites = byArea.get(rowAreas.shift());
  }

  const rowWidth = LOOP_RIGHT - ROW_LEFT - 22;
  const maxPerRow = Math.max(1, ...rowAreas.map((a) => byArea.get(a).length));
  const bayW = (rowWidth - (maxPerRow - 1) * BAY_GAP) / maxPerRow;

  let roads = "";
  let bays = "";

  rowAreas.forEach((area, i) => {
    const rowSites = byArea.get(area);
    const roadY = FIRST_ROW_Y + i * (BAY_H + ROAD_GAP);
    const totalW = rowSites.length * bayW + (rowSites.length - 1) * BAY_GAP;
    const startX = ROW_LEFT + (rowWidth - totalW) / 2;

    roads += `<line x1="${LOOP_LEFT}" y1="${roadY}" x2="${LOOP_RIGHT}" y2="${roadY}" stroke-width="11" ${ROAD}/>`;

    rowSites.forEach((site, j) => {
      const x = startX + j * (bayW + BAY_GAP);
      bays += bayMarkup(site, x, roadY + 7, bayW, BAY_H - 7, x + bayW / 2, roadY, roadY + 7);
    });
  });

  const southY = FIRST_ROW_Y + rowAreas.length * (BAY_H + ROAD_GAP);

  // Sites 1-2: angled pair against the existing fence at the west end, off the loop's west leg.
  // They sit in the pocket west of ROW_LEFT, one per row band, so no road runs through them.
  let pair = "";
  if (pairSites) {
    const pw = 100;
    const ph = 58;
    const span = southY - FIRST_ROW_Y;
    pairSites.forEach((site, i) => {
      const cy =
        pairSites.length <= rowAreas.length
          ? FIRST_ROW_Y + i * (BAY_H + ROAD_GAP) + BAY_H / 2
          : FIRST_ROW_Y + (span * (i + 1)) / (pairSites.length + 1);
      const cx = LOOP_LEFT + 28 + pw / 2;
      const angle = i % 2 === 0 ? -14 : 14;
      pair += `<line x1="${LOOP_LEFT}" y1="${cy}" x2="${cx - pw / 2}" y2="${cy}" stroke-width="4" ${ROAD}/>`;
      pair += `<g transform="rotate(${angle} ${cx} ${cy})">${bayMarkup(
        site,
        cx - pw / 2,
        cy - ph / 2,
        pw,
        ph,
        cx,
        cy,
        cy,
        -PARK_TILT - angle,
      )}</g>`;
    });
  }

  const park = `
    <line x1="${LOOP_LEFT}" y1="${FIRST_ROW_Y}" x2="${LOOP_LEFT}" y2="${southY}" stroke-width="11" ${ROAD}/>
    <line x1="${LOOP_RIGHT}" y1="${FIRST_ROW_Y}" x2="${LOOP_RIGHT}" y2="${southY}" stroke-width="11" ${ROAD}/>
    <line x1="${LOOP_LEFT}" y1="${southY}" x2="${LOOP_RIGHT}" y2="${southY}" stroke-width="11" ${ROAD}/>
    ${roads}
    <line x1="${LOOP_RIGHT}" y1="${FIRST_ROW_Y}" x2="${LOOP_RIGHT}" y2="${ENTRY_Y}" stroke-width="11" ${ROAD}/>
    <line x1="${LOOP_RIGHT}" y1="${ENTRY_Y}" x2="${LOOP_RIGHT + 116}" y2="${ENTRY_Y}" stroke-width="11" ${ROAD}/>
    <line x1="${TURNAROUND.x}" y1="${ENTRY_Y}" x2="${LOOP_RIGHT}" y2="${ENTRY_Y}" stroke-width="11" ${ROAD}/>
    <circle cx="${TURNAROUND.x}" cy="${TURNAROUND.y}" r="${TURNAROUND.r}" stroke-width="11" ${ROAD}/>
    <line x1="${TURNAROUND.x - TURNAROUND.r}" y1="${TURNAROUND.y}" x2="${OFFICE.x + 56}" y2="${OFFICE.y + 2}" stroke-width="6" ${ROAD}/>
    <line x1="${LOOP_LEFT - 22}" y1="${FIRST_ROW_Y - 16}" x2="${LOOP_LEFT - 22}" y2="${southY + 16}" stroke="var(--parchment-dim)" stroke-width="1.5" stroke-dasharray="2 6" opacity="0.75"/>
    ${mapText(LOOP_LEFT - 30, (FIRST_ROW_Y + southY) / 2, "EXISTING FENCE", { size: 15, anchor: "middle", tilt: -PARK_TILT - 90 })}
    ${pair}
    ${bays}
    <rect x="${OFFICE.x - 56}" y="${OFFICE.y - 22}" width="112" height="44" rx="6" fill="var(--bg-panel-2)" stroke="var(--gold)" stroke-width="2"/>
    ${mapText(OFFICE.x, OFFICE.y + 5, "OFFICE", { size: 22, fill: "var(--gold)" })}
    ${mapText(LOOP_RIGHT + 116, ENTRY_Y - 16, "ENTRANCE", { size: 20, fill: "var(--gold)", anchor: "end" })}
  `;

  // Rotate the whole park to its real bearing, then size the viewBox to the rotated bounds.
  const cx = (LOOP_LEFT + LOOP_RIGHT) / 2;
  const cy = (FIRST_ROW_Y + southY) / 2;
  const b = rotatedBounds(LOOP_LEFT - 60, OFFICE.y - 60, LOOP_RIGHT + 150, southY + 18, cx, cy, PARK_TILT);
  const pad = 34;
  const vx = b.minX - pad;
  const vy = b.minY - pad;
  const vw = b.maxX - b.minX + pad * 2;
  const vh = b.maxY - b.minY + pad * 2;

  // Boundary streets, drawn in page space (north is up) so they read against the tilted park.
  const corner = { x: vx + vw * 0.66, y: vy + 10 };
  const oak = { x: vx + 6, y: vy + vh * 0.42 };
  const peak = { x: vx + vw - 6, y: vy + vh * 0.9 };
  const bearing = (a, c) => (Math.atan2(c.y - a.y, c.x - a.x) * 180) / Math.PI;

  siteMap.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  siteMap.innerHTML = `
    <g stroke="var(--parchment-dim)" stroke-width="1.5" stroke-dasharray="7 6" opacity="0.5" fill="none">
      <path d="M${oak.x} ${oak.y} L${corner.x} ${corner.y} L${peak.x} ${peak.y}"/>
    </g>
    ${mapText((oak.x + corner.x) / 2, (oak.y + corner.y) / 2 - 9, "BROAD OAK DRIVE", { size: 16, tilt: bearing(oak, corner) })}
    ${mapText((corner.x + peak.x) / 2 + 12, (corner.y + peak.y) / 2, "POLLY PEAK DR.", { size: 16, tilt: bearing(corner, peak) })}
    <g transform="translate(${vx + 34} ${vy + vh - 60})">
      <line x1="0" y1="22" x2="0" y2="-22" stroke="var(--parchment-dim)" stroke-width="1.5"/>
      <path d="M0 -30 L7 -14 L0 -18 L-7 -14 Z" fill="var(--parchment-dim)"/>
      <text x="0" y="40" text-anchor="middle" fill="var(--parchment-dim)" font-family="JetBrains Mono, monospace" font-size="17" letter-spacing="1">N</text>
    </g>
    <g transform="rotate(${PARK_TILT} ${cx} ${cy})">${park}</g>
  `;

  siteMap.querySelectorAll("[data-site-id]").forEach((el) => {
    if (el.classList.contains("taken")) return;
    el.addEventListener("click", () => {
      const id = Number(el.getAttribute("data-site-id"));
      const site = sites.find((s) => s.id === id);
      if (site) selectSite(site, nightsBetween(state.checkIn, state.checkOut));
    });
  });
}

function rotatedBounds(x0, y0, x1, y1, cx, cy, deg) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pts = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function bayMarkup(site, x, y, w, h, stubX, stubY1, stubY2, textTilt = -PARK_TILT) {
  const selected = state.selectedSite?.id === site.id;
  const cls = `site-pin ${site.available ? "" : "taken"} ${selected ? "selected" : ""}`;
  const num = site.name.replace(/[^0-9]/g, "") || "•";
  const tx = x + w / 2;
  const ty = y + h / 2 + 10;
  const stub = stubY1 !== stubY2 ? `<line x1="${stubX}" y1="${stubY1}" x2="${stubX}" y2="${stubY2}" stroke="var(--line)" stroke-width="4"/>` : "";
  return `${stub}<g class="${cls}" data-site-id="${site.id}">
    <rect class="base" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>
    <text x="${tx}" y="${ty}" transform="rotate(${textTilt} ${tx} ${ty})">${num}</text>
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

async function selectSite(site, nights) {
  state.selectedSite = site;
  renderSites(state.sites);

  const weeks = site.price_per_week_cents ? Math.floor(nights / 7) : 0;
  const remainderNights = site.price_per_week_cents ? nights % 7 : nights;
  const subtotal = weeks * site.price_per_week_cents + remainderNights * site.price_per_night_cents;
  const bookingFee = 500;
  const total = subtotal + bookingFee;

  const rateRows = [
    weeks > 0 ? `<div class="summary-row"><span>${money(site.price_per_week_cents)} × ${weeks} week${weeks === 1 ? "" : "s"}</span><span>${money(weeks * site.price_per_week_cents)}</span></div>` : "",
    remainderNights > 0 ? `<div class="summary-row"><span>${money(site.price_per_night_cents)} × ${remainderNights} night${remainderNights === 1 ? "" : "s"}</span><span>${money(remainderNights * site.price_per_night_cents)}</span></div>` : "",
  ].join("");

  orderSummary.innerHTML = `
    <h3>${escapeHtml(site.name)}</h3>
    <p>${escapeHtml(site.area)}</p>
    <div class="summary-row"><span>${formatDate(state.checkIn)} → ${formatDate(state.checkOut)}</span><span>${nights} night${nights === 1 ? "" : "s"}</span></div>
    ${rateRows}
    <div class="summary-row"><span>Booking fee</span><span>${money(bookingFee)}</span></div>
    <div class="summary-row total"><span>Estimated total</span><span>${money(total)}</span></div>
    <p style="font-size:0.75rem;opacity:0.75;margin-top:8px;">Final total is confirmed by the server at checkout.</p>
  `;

  bookingError.hidden = true;
  bookingForm.reset();
  resetApplicationFields();
  goToStep(2);

  await mountCard();
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
