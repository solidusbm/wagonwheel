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
  renderTrail();
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
    const res = await fetch("/api/park-amenities");
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
    site.pet_friendly ? "Pet friendly" : null,
    site.max_rig_length ? `Up to ${site.max_rig_length} ft` : null,
    ...(site.amenities ?? []),
  ].filter(Boolean);

  card.innerHTML = `
    <h4>${escapeHtml(site.name)}</h4>
    <div class="site-tags">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
    <div class="site-price">${money(site.price_per_night_cents)} <span style="font-size:11px;color:var(--parchment-dim);">/night</span>${site.price_per_week_cents ? ` <span style="font-size:11px;color:var(--parchment-dim);">· ${money(site.price_per_week_cents)}/week</span>` : ""}</div>
    ${site.notes ? `<div class="site-notes">${escapeHtml(site.notes)}</div>` : ""}
    <div class="availability-flag ${site.available ? "available" : "unavailable"}">
      ${site.available ? "Available" : "Booked for these dates"}
    </div>
    ${renderBookedRanges(site.bookedRanges)}
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
   Schematic of the park's real layout, from the county-filed septic/site engineering
   plan (Mangold Engineering, drawing 100-7799): a loop of 2-way road off the Polly Peak
   Dr. entrance, the office near the front, and 12 numbered sites in three rows -- a short
   Front Row by the office, then two 5-site rows (Center, Back). Row grouping and site
   count/numbering come from that plan; it is not an illustrative placeholder. */
const MAP_VW = 900;
const ROW_WIDTH = 780;
const MARGIN_X = (MAP_VW - ROW_WIDTH) / 2;
const BAY_H = 78;
const GAP = 18;
const ROW_PITCH = 148; // vertical distance between row tops
const FIRST_ROW_Y = 150;

function renderSiteMap(sites) {
  const byArea = new Map();
  for (const site of sites) {
    if (!byArea.has(site.area)) byArea.set(site.area, []);
    byArea.get(site.area).push(site);
  }
  const areas = [...byArea.keys()];
  const maxPerRow = Math.max(1, ...areas.map((a) => byArea.get(a).length));
  const bayW = (ROW_WIDTH - (maxPerRow - 1) * GAP) / maxPerRow;
  const mapVH = FIRST_ROW_Y + (areas.length - 1) * ROW_PITCH + BAY_H + 70;

  let roads = "";
  let bays = "";
  let labels = "";

  areas.forEach((area, rowIndex) => {
    const rowSites = byArea.get(area);
    const rowY = FIRST_ROW_Y + rowIndex * ROW_PITCH;
    const rowTotalW = rowSites.length * bayW + (rowSites.length - 1) * GAP;
    const startX = MARGIN_X + (ROW_WIDTH - rowTotalW) / 2;
    const roadY = rowY - 26;

    roads += `<line x1="${MARGIN_X}" y1="${roadY}" x2="${MARGIN_X + ROW_WIDTH}" y2="${roadY}" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/>`;
    labels += `<text x="${MARGIN_X + ROW_WIDTH + 4}" y="${roadY + 4}" fill="var(--parchment-dim)" font-family="JetBrains Mono, monospace" font-size="10" letter-spacing="0.5" text-anchor="start">${escapeHtml(area.toUpperCase())}</text>`;

    rowSites.forEach((site, i) => {
      const x = startX + i * (bayW + GAP);
      const cx = x + bayW / 2;
      const selected = state.selectedSite?.id === site.id;
      const cls = `site-pin ${site.available ? "" : "taken"} ${selected ? "selected" : ""}`;
      const num = site.name.replace(/[^0-9]/g, "") || "•";
      bays += `<line x1="${cx}" y1="${roadY}" x2="${cx}" y2="${rowY}" stroke="var(--line)" stroke-width="3"/>`;
      bays += `<g class="${cls}" data-site-id="${site.id}">
        <rect class="base" x="${x}" y="${rowY}" width="${bayW}" height="${BAY_H}" rx="6"/>
        <text x="${cx}" y="${rowY + BAY_H / 2 + 6}">${num}</text>
      </g>`;
    });
  });

  const lastRowBottom = FIRST_ROW_Y + (areas.length - 1) * ROW_PITCH + BAY_H;
  const entranceX = MARGIN_X + ROW_WIDTH / 2;

  siteMap.setAttribute("viewBox", `0 0 ${MAP_VW} ${mapVH}`);
  siteMap.innerHTML = `
    <rect x="${entranceX - 60}" y="18" width="120" height="46" rx="6" fill="var(--bg-panel-2)" stroke="var(--gold)" stroke-width="2"/>
    <text x="${entranceX}" y="46" text-anchor="middle" fill="var(--gold)" font-family="JetBrains Mono, monospace" font-size="14" letter-spacing="1">OFFICE</text>
    <line x1="${entranceX}" y1="64" x2="${entranceX}" y2="${FIRST_ROW_Y - 26}" stroke="var(--line)" stroke-width="6"/>
    ${roads}
    ${bays}
    ${labels}
    <line x1="${entranceX}" y1="${lastRowBottom + 4}" x2="${entranceX}" y2="${mapVH - 24}" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/>
    <text x="${entranceX}" y="${mapVH - 6}" text-anchor="middle" fill="var(--parchment-dim)" font-family="JetBrains Mono, monospace" font-size="11" letter-spacing="1">ENTRANCE · POLLY PEAK DR.</text>
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
