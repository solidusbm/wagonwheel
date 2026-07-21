const money = (cents) => `$${(cents / 100).toFixed(2)}`;

const state = {
  config: null,
  checkIn: null,
  checkOut: null,
  numGuests: 1,
  selectedSite: null,
  card: null,
};

const availabilityForm = document.getElementById("availability-form");
const availabilityError = document.getElementById("availability-error");
const sitesSection = document.getElementById("sites-section");
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

  // Browsing/availability doesn't depend on Square, so a slow or failed SDK
  // load shouldn't block the rest of the page -- only checkout needs it,
  // and mountCard() reports that failure on its own.
  state.squareSdkReady = loadSquareSdk(state.config.squareEnvironment).catch((err) => {
    console.error("Square SDK failed to load", err);
    return null;
  });
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
  renderSites(sites);
  bookingSection.hidden = true;
  confirmationSection.hidden = true;
}

function renderSites(sites) {
  const nights = nightsBetween(state.checkIn, state.checkOut);
  stayummary.textContent = `${formatDate(state.checkIn)} → ${formatDate(state.checkOut)} · ${nights} night${nights === 1 ? "" : "s"}`;

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

  sitesSection.hidden = false;
  sitesSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSiteCard(site, nights) {
  const card = document.createElement("div");
  card.className = `site-card${site.available ? "" : " unavailable"}`;
  const tags = [
    `${site.amp_service} amp`,
    site.pull_through ? "Pull-through" : "Back-in",
    site.pet_friendly ? "Pet friendly" : null,
    site.max_rig_length ? `Up to ${site.max_rig_length} ft` : null,
  ].filter(Boolean);

  card.innerHTML = `
    <h4>${site.name}</h4>
    <div class="site-tags">${tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
    <div class="site-price">${money(site.price_per_night_cents)} / night</div>
    <div class="availability-flag ${site.available ? "available" : "unavailable"}">
      ${site.available ? "Available" : "Booked for these dates"}
    </div>
  `;

  if (site.available) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "Select this site";
    btn.addEventListener("click", () => selectSite(site, nights));
    card.appendChild(btn);
  }

  return card;
}

async function selectSite(site, nights) {
  state.selectedSite = site;
  const subtotal = site.price_per_night_cents * nights;
  const bookingFee = 500;
  const total = subtotal + bookingFee;

  orderSummary.innerHTML = `
    <h3>${site.name}</h3>
    <p>${site.area}</p>
    <div class="line"><span>${formatDate(state.checkIn)} → ${formatDate(state.checkOut)}</span><span>${nights} night${nights === 1 ? "" : "s"}</span></div>
    <div class="line"><span>${money(site.price_per_night_cents)} × ${nights}</span><span>${money(subtotal)}</span></div>
    <div class="line"><span>Booking fee</span><span>${money(bookingFee)}</span></div>
    <div class="line total"><span>Estimated total</span><span>${money(total)}</span></div>
    <p style="font-size:0.75rem;opacity:0.75;">Final total is confirmed by the server at checkout.</p>
  `;

  bookingSection.hidden = false;
  bookingError.hidden = true;
  bookingForm.reset();
  bookingSection.scrollIntoView({ behavior: "smooth", block: "start" });

  await mountCard();
}

async function mountCard() {
  const container = document.getElementById("card-container");
  container.innerHTML = "";

  if (!state.config.squareApplicationId || !state.config.squareLocationId) {
    container.innerHTML = '<p class="form-error">Square is not configured yet (missing application/location ID). Payment is disabled until SQUARE_APPLICATION_ID and SQUARE_LOCATION_ID are set.</p>';
    payBtn.disabled = true;
    return;
  }

  payBtn.disabled = true;
  await state.squareSdkReady;
  if (!window.Square) {
    container.innerHTML = '<p class="form-error">Payment form failed to load. Check your connection and try again.</p>';
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
  bookingSection.hidden = true;
  document.getElementById("confirmation-code").textContent = reservation.reservationCode;
  document.getElementById("confirmation-details").innerHTML = `
    <p><strong>${reservation.site.name}</strong> (${reservation.site.area})</p>
    <p>${formatDate(reservation.checkIn)} → ${formatDate(reservation.checkOut)} · ${reservation.nights} night${reservation.nights === 1 ? "" : "s"}</p>
    <p>Guest: ${reservation.guest.name} · ${reservation.guest.email}</p>
    <p>Total paid: ${money(reservation.totalCents)}</p>
  `;
  confirmationSection.hidden = false;
  confirmationSection.scrollIntoView({ behavior: "smooth", block: "start" });
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
