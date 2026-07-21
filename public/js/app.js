const money = (cents) => `$${(cents / 100).toFixed(2)}`;

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

  // Browsing/availability doesn't depend on Square, so a slow or failed SDK
  // load shouldn't block the rest of the page -- only checkout needs it,
  // and mountCard() reports that failure on its own.
  state.squareSdkReady = loadSquareSdk(state.config.squareEnvironment).catch((err) => {
    console.error("Square SDK failed to load", err);
    return null;
  });

  renderTrail();
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
  ].filter(Boolean);

  card.innerHTML = `
    <h4>${site.name}</h4>
    <div class="site-tags">${tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
    <div class="site-price">${money(site.price_per_night_cents)} <span style="font-size:11px;color:var(--parchment-dim);">/night</span></div>
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

/* ---------- wagon-wheel site map ---------- */
const CX = 450,
  CY = 450,
  HUB_R = 95,
  INNER_R = 250,
  OUTER_R = 350;

function polar(radius, index, total, offsetDeg = -90) {
  const angle = ((offsetDeg + index * (360 / total)) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

function renderSiteMap(sites) {
  const byArea = new Map();
  for (const site of sites) {
    if (!byArea.has(site.area)) byArea.set(site.area, []);
    byArea.get(site.area).push(site);
  }
  const areas = [...byArea.keys()];
  const outerArea = areas[areas.length - 1];
  const outerSites = byArea.get(outerArea) ?? [];

  let spokes = "";
  outerSites.forEach((_, i) => {
    const a = polar(HUB_R, i, outerSites.length);
    const b = polar(OUTER_R, i, outerSites.length);
    spokes += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--line)" stroke-width="2"/>`;
  });

  let pins = "";
  areas.forEach((area, areaIndex) => {
    const areaSites = byArea.get(area);
    const radius = areas.length === 1 ? INNER_R : INNER_R + areaIndex * ((OUTER_R - INNER_R) / (areas.length - 1));
    areaSites.forEach((site, i) => {
      const p = polar(radius, i, areaSites.length);
      const selected = state.selectedSite?.id === site.id;
      const cls = `site-pin ${site.available ? "" : "taken"} ${selected ? "selected" : ""}`;
      pins += `<g class="${cls}" data-site-id="${site.id}">
        <circle class="base" cx="${p.x}" cy="${p.y}" r="28"/>
        <text x="${p.x}" y="${p.y + 5}">${site.name.replace(/[^0-9]/g, "") || "•"}</text>
      </g>`;
    });
  });

  siteMap.innerHTML = `
    <circle cx="${CX}" cy="${CY}" r="${OUTER_R}" fill="none" stroke="var(--line)" stroke-width="2"/>
    ${spokes}
    <circle cx="${CX}" cy="${CY}" r="${HUB_R}" fill="var(--bg-panel-2)" stroke="var(--gold)" stroke-width="2"/>
    <text x="${CX}" y="${CY - 5}" text-anchor="middle" fill="var(--gold)" font-family="JetBrains Mono, monospace" font-size="16" letter-spacing="1">OFFICE</text>
    <text x="${CX}" y="${CY + 15}" text-anchor="middle" fill="var(--parchment-dim)" font-family="JetBrains Mono, monospace" font-size="11">CHECK-IN</text>
    ${pins}
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

async function selectSite(site, nights) {
  state.selectedSite = site;
  renderSites(state.sites);

  const subtotal = site.price_per_night_cents * nights;
  const bookingFee = 500;
  const total = subtotal + bookingFee;

  orderSummary.innerHTML = `
    <h3>${site.name}</h3>
    <p>${site.area}</p>
    <div class="summary-row"><span>${formatDate(state.checkIn)} → ${formatDate(state.checkOut)}</span><span>${nights} night${nights === 1 ? "" : "s"}</span></div>
    <div class="summary-row"><span>${money(site.price_per_night_cents)} × ${nights}</span><span>${money(subtotal)}</span></div>
    <div class="summary-row"><span>Booking fee</span><span>${money(bookingFee)}</span></div>
    <div class="summary-row total"><span>Estimated total</span><span>${money(total)}</span></div>
    <p style="font-size:0.75rem;opacity:0.75;margin-top:8px;">Final total is confirmed by the server at checkout.</p>
  `;

  bookingError.hidden = true;
  bookingForm.reset();
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
    <div class="summary-row"><span>Site</span><span>${reservation.site.name} · ${reservation.site.area}</span></div>
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
