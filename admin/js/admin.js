const money = (cents) => `$${(cents / 100).toFixed(2)}`;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Renders the extended monthly-guest intake (DOB, license, spouse/co-applicant, occupants,
// vehicles, RV, pets) captured for stays of 28+ nights -- see public/js/app.js buildApplication().
function renderApplication(app) {
  if (!app) return "";
  const rows = [];
  if (app.dob) rows.push(["DOB", app.dob]);
  if (app.driversLicense?.number) rows.push(["License", `${app.driversLicense.number} (${app.driversLicense.state ?? "?"})`]);
  if (app.spouse?.name) {
    const lic = app.spouse.driversLicense?.number ? ` · Lic ${app.spouse.driversLicense.number} (${app.spouse.driversLicense.state ?? "?"})` : "";
    rows.push(["Co-applicant", `${app.spouse.name}${app.spouse.dob ? " · DOB " + app.spouse.dob : ""}${app.spouse.phone ? " · " + app.spouse.phone : ""}${lic}`]);
  }
  if (app.occupants?.length) {
    rows.push(["Occupants", app.occupants.filter((o) => o.name).map((o) => `${o.name} (${o.age || "?"}, ${o.relationship || "?"})`).join("; ")]);
  }
  if (app.vehicles?.length) {
    const v = app.vehicles.filter((v) => v.make || v.model || v.plate).map((v) => `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""} · plate ${v.plate ?? "?"}`.trim());
    if (v.length) rows.push(["Vehicles", v.join("; ")]);
  }
  if (app.rv && (app.rv.make || app.rv.model)) {
    rows.push([
      "RV",
      `${app.rv.year ?? ""} ${app.rv.make ?? ""} ${app.rv.model ?? ""} · Class ${app.rv.rvClass ?? "?"} · ${app.rv.trailerType ?? "?"} · ${app.rv.length ?? "?"}′×${app.rv.width ?? "?"}′ · ${app.rv.slides ?? "?"} slides · ${app.rv.amp ?? "?"} amp · plate ${app.rv.plate ?? "?"}`,
    ]);
  }
  if (app.pets?.length) {
    const p = app.pets.filter((p) => p.name || p.type).map((p) => `${p.name ?? "?"} (${p.type ?? "?"}${p.breed ? "/" + p.breed : ""}${p.spayedNeutered ? ", " + p.spayedNeutered + " S/N" : ""}${p.rabiesVaccine ? ", rabies " + p.rabiesVaccine : ""})`);
    if (p.length) rows.push(["Pets", p.join("; ")]);
  }
  if (!rows.length) return "";
  return `<details class="app-details"><summary>Monthly application</summary>${rows
    .map(([k, v]) => `<div class="app-row"><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</div>`)
    .join("")}</details>`;
}

let sites = [];
let reservations = [];

const content = document.getElementById("admin-content");
const panel = document.getElementById("booking-panel");
const panelTitle = document.getElementById("booking-panel-title");
const form = document.getElementById("admin-booking-form");
const formError = document.getElementById("admin-form-error");
const codeField = document.getElementById("f-code");
const siteField = document.getElementById("f-site");
const statusField = document.getElementById("f-status");
const checkinField = document.getElementById("f-checkin");
const checkoutField = document.getElementById("f-checkout");
const nameField = document.getElementById("f-name");
const emailField = document.getElementById("f-email");
const phoneField = document.getElementById("f-phone");
const guestsField = document.getElementById("f-guests");
const notesField = document.getElementById("f-notes");

document.getElementById("new-booking-btn").addEventListener("click", () => openForm());
document.getElementById("cancel-form-btn").addEventListener("click", closeForm);
form.addEventListener("submit", onSubmit);

function formatDate(iso) {
  const [y, m, d] = String(iso).split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function loadSites() {
  const res = await fetch("/api/sites");
  sites = res.ok ? await res.json() : [];
  siteField.innerHTML = sites.map((s) => `<option value="${s.id}">${s.name} · ${s.area} (${money(s.price_per_night_cents)}/night)</option>`).join("");
  renderFeedList();
}

function renderFeedList() {
  const feedList = document.getElementById("feed-list");
  feedList.innerHTML = sites
    .map((s) => {
      const url = `${window.location.origin}/calendar/sites/${s.id}.ics`;
      return `
    <div class="feed-row">
      <span>${s.name}</span>
      <input type="text" readonly value="${url}" onclick="this.select()" />
      <button type="button" class="btn btn-ghost" data-copy-feed="${url}">Copy</button>
    </div>`;
    })
    .join("");

  feedList.querySelectorAll("[data-copy-feed]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(btn.getAttribute("data-copy-feed"));
      const original = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = original), 1200);
    });
  });
}

async function loadReservations() {
  const res = await fetch("/api/admin/reservations");
  if (!res.ok) {
    content.innerHTML = `<p class="error-msg">Could not load reservations (${res.status}).</p>`;
    return;
  }
  reservations = await res.json();

  if (reservations.length === 0) {
    content.innerHTML = `<p class="empty-note">No pending or confirmed reservations yet.</p>`;
    return;
  }

  const rows = reservations
    .map(
      (r) => `
    <tr>
      <td>${r.reservationCode}</td>
      <td><span class="status-pill ${r.status}">${r.status}</span></td>
      <td>${r.site.name}<br><span style="color:var(--parchment-dim);font-size:11px;">${r.site.area}</span></td>
      <td>${formatDate(r.checkIn)} → ${formatDate(r.checkOut)}</td>
      <td>${r.guest.name}<br><span style="color:var(--parchment-dim);font-size:11px;">${r.guest.email}${r.guest.phone ? " · " + r.guest.phone : ""}</span></td>
      <td>${r.guest.numGuests}</td>
      <td>${money(r.totalCents)}</td>
      <td>${r.notes ?? ""}${renderApplication(r.applicationDetails)}</td>
      <td class="row-actions">
        <button type="button" class="btn btn-ghost" data-edit="${r.reservationCode}">Edit</button>
        <button type="button" class="btn btn-ghost" data-cancel="${r.reservationCode}">Cancel</button>
      </td>
    </tr>`
    )
    .join("");

  content.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Code</th><th>Status</th><th>Site</th><th>Dates</th><th>Guest</th><th>Guests</th><th>Total</th><th>Notes</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  content.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = reservations.find((x) => x.reservationCode === btn.getAttribute("data-edit"));
      if (r) openForm(r);
    });
  });
  content.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => onCancel(btn.getAttribute("data-cancel")));
  });
}

function openForm(reservation) {
  formError.hidden = true;
  form.reset();
  if (reservation) {
    panelTitle.textContent = `Edit ${reservation.reservationCode}`;
    codeField.value = reservation.reservationCode;
    siteField.value = String(reservation.site.id);
    statusField.value = reservation.status;
    checkinField.value = String(reservation.checkIn).slice(0, 10);
    checkoutField.value = String(reservation.checkOut).slice(0, 10);
    nameField.value = reservation.guest.name;
    emailField.value = reservation.guest.email;
    phoneField.value = reservation.guest.phone ?? "";
    guestsField.value = reservation.guest.numGuests;
    notesField.value = reservation.notes ?? "";
  } else {
    panelTitle.textContent = "New booking";
    codeField.value = "";
    statusField.value = "confirmed";
    guestsField.value = 2;
  }
  panel.classList.add("open");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  panel.classList.remove("open");
  form.reset();
}

async function onSubmit(event) {
  event.preventDefault();
  formError.hidden = true;

  const payload = {
    siteId: Number(siteField.value),
    checkIn: checkinField.value,
    checkOut: checkoutField.value,
    status: statusField.value,
    guest: {
      name: nameField.value.trim(),
      email: emailField.value.trim(),
      phone: phoneField.value.trim() || null,
      numGuests: Number(guestsField.value || 1),
      notes: notesField.value.trim() || null,
    },
  };

  const editingCode = codeField.value;
  const url = editingCode ? `/api/admin/reservations/${editingCode}` : "/api/admin/reservations";
  const method = editingCode ? "PATCH" : "POST";

  const saveBtn = document.getElementById("save-booking-btn");
  saveBtn.disabled = true;
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Save failed");
    }
    closeForm();
    await loadReservations();
  } catch (err) {
    formError.textContent = err.message;
    formError.hidden = false;
  } finally {
    saveBtn.disabled = false;
  }
}

async function onCancel(code) {
  if (!confirm(`Cancel reservation ${code}? This releases the site for those dates.`)) return;
  const res = await fetch(`/api/admin/reservations/${code}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not cancel reservation.");
    return;
  }
  await loadReservations();
}

/* ---------- park-wide amenities (homepage grid) admin ---------- */

let parkAmenities = [];
const parkAmenityList = document.getElementById("park-amenity-list");
const parkAmenityAddForm = document.getElementById("park-amenity-add-form");
const parkAmenityNameInput = document.getElementById("park-amenity-name-input");

parkAmenityAddForm.addEventListener("submit", onAddParkAmenity);

async function loadParkAmenitiesAdmin() {
  const res = await fetch("/api/admin/park-amenities");
  parkAmenities = res.ok ? await res.json() : [];
  renderParkAmenityList();
}

function renderParkAmenityList() {
  if (parkAmenities.length === 0) {
    parkAmenityList.innerHTML = `<p class="empty-note">No park amenities yet — add one below.</p>`;
    return;
  }
  parkAmenityList.innerHTML = parkAmenities
    .map(
      (a) => `
    <div class="amenity-row${a.active ? "" : " inactive"}">
      <span class="name">${escapeHtml(a.name)}</span>
      <button type="button" class="btn btn-ghost" data-toggle-park-amenity="${a.id}">${a.active ? "Hide from site" : "Show on site"}</button>
      <button type="button" class="btn btn-ghost" data-delete-park-amenity="${a.id}">Delete</button>
    </div>`
    )
    .join("");

  parkAmenityList.querySelectorAll("[data-toggle-park-amenity]").forEach((btn) => {
    btn.addEventListener("click", () => onToggleParkAmenityActive(Number(btn.getAttribute("data-toggle-park-amenity"))));
  });
  parkAmenityList.querySelectorAll("[data-delete-park-amenity]").forEach((btn) => {
    btn.addEventListener("click", () => onDeleteParkAmenity(Number(btn.getAttribute("data-delete-park-amenity"))));
  });
}

async function onAddParkAmenity(event) {
  event.preventDefault();
  const name = parkAmenityNameInput.value.trim();
  if (!name) return;
  const res = await fetch("/api/admin/park-amenities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not add park amenity.");
    return;
  }
  parkAmenityNameInput.value = "";
  await loadParkAmenitiesAdmin();
}

async function onToggleParkAmenityActive(id) {
  const a = parkAmenities.find((x) => x.id === id);
  if (!a) return;
  const res = await fetch(`/api/admin/park-amenities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: !a.active }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not update park amenity.");
    return;
  }
  await loadParkAmenitiesAdmin();
}

async function onDeleteParkAmenity(id) {
  const a = parkAmenities.find((x) => x.id === id);
  if (!a) return;
  if (!confirm(`Delete "${a.name}"? This removes it from the homepage.`)) return;
  const res = await fetch(`/api/admin/park-amenities/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not delete park amenity.");
    return;
  }
  await loadParkAmenitiesAdmin();
}

/* ---------- sites & amenities admin ---------- */

let amenities = [];
let adminSites = [];

const sitesContent = document.getElementById("sites-content");
const amenityList = document.getElementById("amenity-list");
const amenityAddForm = document.getElementById("amenity-add-form");
const amenityNameInput = document.getElementById("amenity-name-input");

const sitePanel = document.getElementById("site-panel");
const sitePanelTitle = document.getElementById("site-panel-title");
const siteForm = document.getElementById("site-form");
const siteFormError = document.getElementById("site-form-error");
const sIdField = document.getElementById("s-id");
const sNameField = document.getElementById("s-name");
const sAreaField = document.getElementById("s-area");
const sAmpField = document.getElementById("s-amp");
const sRigField = document.getElementById("s-rig");
const sPullThroughField = document.getElementById("s-pullthrough");
const sNightField = document.getElementById("s-night");
const sWeekField = document.getElementById("s-week");
const sActiveField = document.getElementById("s-active");
const sOccupiedField = document.getElementById("s-occupied");
const sNotesField = document.getElementById("s-notes");
const siteAmenityChecks = document.getElementById("site-amenity-checks");

document.getElementById("new-site-btn").addEventListener("click", () => openSiteForm());
document.getElementById("cancel-site-btn").addEventListener("click", closeSiteForm);
siteForm.addEventListener("submit", onSiteSubmit);
amenityAddForm.addEventListener("submit", onAddAmenity);

async function loadAmenities() {
  const res = await fetch("/api/admin/amenities");
  amenities = res.ok ? await res.json() : [];
  renderAmenityList();
  renderAmenityChecks();
}

function renderAmenityList() {
  if (amenities.length === 0) {
    amenityList.innerHTML = `<p class="empty-note">No amenities yet — add one below.</p>`;
    return;
  }
  amenityList.innerHTML = amenities
    .map(
      (a) => `
    <div class="amenity-row${a.active ? "" : " inactive"}">
      <span class="name">${escapeHtml(a.name)}</span>
      <button type="button" class="btn btn-ghost" data-toggle-amenity="${a.id}">${a.active ? "Deactivate" : "Activate"}</button>
      <button type="button" class="btn btn-ghost" data-delete-amenity="${a.id}">Delete</button>
    </div>`
    )
    .join("");

  amenityList.querySelectorAll("[data-toggle-amenity]").forEach((btn) => {
    btn.addEventListener("click", () => onToggleAmenityActive(Number(btn.getAttribute("data-toggle-amenity"))));
  });
  amenityList.querySelectorAll("[data-delete-amenity]").forEach((btn) => {
    btn.addEventListener("click", () => onDeleteAmenity(Number(btn.getAttribute("data-delete-amenity"))));
  });
}

function renderAmenityChecks(checkedIds = []) {
  if (amenities.length === 0) {
    siteAmenityChecks.innerHTML = `<p class="empty-note">No amenities in the catalog yet.</p>`;
    return;
  }
  siteAmenityChecks.innerHTML = amenities
    .map(
      (a) => `
    <label>
      <input type="checkbox" value="${a.id}" ${checkedIds.includes(a.id) ? "checked" : ""} ${a.active ? "" : "disabled"} />
      ${escapeHtml(a.name)}${a.active ? "" : " (inactive)"}
    </label>`
    )
    .join("");
}

async function onAddAmenity(event) {
  event.preventDefault();
  const name = amenityNameInput.value.trim();
  if (!name) return;
  const res = await fetch("/api/admin/amenities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not add amenity.");
    return;
  }
  amenityNameInput.value = "";
  await loadAmenities();
}

async function onToggleAmenityActive(id) {
  const a = amenities.find((x) => x.id === id);
  if (!a) return;
  const res = await fetch(`/api/admin/amenities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: !a.active }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not update amenity.");
    return;
  }
  await loadAmenities();
}

async function onDeleteAmenity(id) {
  const a = amenities.find((x) => x.id === id);
  if (!a) return;
  if (!confirm(`Delete "${a.name}"? This removes it from every site it's toggled on.`)) return;
  const res = await fetch(`/api/admin/amenities/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not delete amenity.");
    return;
  }
  await loadAmenities();
  await loadAdminSites();
}

async function loadAdminSites() {
  const res = await fetch("/api/admin/sites");
  if (!res.ok) {
    sitesContent.innerHTML = `<p class="error-msg">Could not load sites (${res.status}).</p>`;
    return;
  }
  adminSites = await res.json();
  renderSitesTable();
}

function renderSitesTable() {
  if (adminSites.length === 0) {
    sitesContent.innerHTML = `<p class="empty-note">No sites yet.</p>`;
    return;
  }
  const rows = adminSites
    .map((s) => {
      const siteAmenities = s.amenityIds.map((id) => amenities.find((a) => a.id === id)?.name).filter(Boolean);
      return `
    <tr${s.active ? "" : ' style="opacity:0.5;"'}>
      <td>${escapeHtml(s.name)}<br><span style="color:var(--parchment-dim);font-size:11px;">${escapeHtml(s.area)}</span></td>
      <td>${money(s.pricePerNightCents)}/night${s.pricePerWeekCents ? `<br>${money(s.pricePerWeekCents)}/week` : ""}</td>
      <td>${escapeHtml(s.ampService)} amp</td>
      <td>${siteAmenities.map((n) => `<span class="tag">${escapeHtml(n)}</span>`).join(" ") || "—"}</td>
      <td>${s.active ? (s.permanentlyOccupied ? "Occupied (not bookable)" : "Active") : "Inactive"}</td>
      <td class="row-actions"><button type="button" class="btn btn-ghost" data-edit-site="${s.id}">Edit</button></td>
    </tr>`;
    })
    .join("");

  sitesContent.innerHTML = `
    <table>
      <thead><tr><th>Site</th><th>Rate</th><th>Amp</th><th>Amenities</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  sitesContent.querySelectorAll("[data-edit-site]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = adminSites.find((x) => x.id === Number(btn.getAttribute("data-edit-site")));
      if (s) openSiteForm(s);
    });
  });
}

function openSiteForm(site) {
  siteFormError.hidden = true;
  siteForm.reset();
  if (site) {
    sitePanelTitle.textContent = `Edit ${site.name}`;
    sIdField.value = site.id;
    sNameField.value = site.name;
    sAreaField.value = site.area;
    sAmpField.value = site.ampService;
    sRigField.value = site.maxRigLength ?? "";
    sPullThroughField.value = String(site.pullThrough);
    sNightField.value = (site.pricePerNightCents / 100).toFixed(2);
    sWeekField.value = site.pricePerWeekCents ? (site.pricePerWeekCents / 100).toFixed(2) : "";
    sActiveField.value = String(site.active);
    sOccupiedField.value = String(site.permanentlyOccupied);
    sNotesField.value = site.notes ?? "";
    renderAmenityChecks(site.amenityIds);
  } else {
    sitePanelTitle.textContent = "New site";
    sIdField.value = "";
    sActiveField.value = "true";
    sOccupiedField.value = "false";
    sPullThroughField.value = "false";
    renderAmenityChecks([]);
  }
  sitePanel.classList.add("open");
  sitePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSiteForm() {
  sitePanel.classList.remove("open");
  siteForm.reset();
}

async function onSiteSubmit(event) {
  event.preventDefault();
  siteFormError.hidden = true;

  const amenityIds = [...siteAmenityChecks.querySelectorAll('input[type="checkbox"]:checked')].map((el) => Number(el.value));

  const payload = {
    name: sNameField.value.trim(),
    area: sAreaField.value.trim(),
    ampService: sAmpField.value,
    maxRigLength: sRigField.value ? Number(sRigField.value) : null,
    pullThrough: sPullThroughField.value === "true",
    pricePerNightCents: Math.round(Number(sNightField.value) * 100),
    pricePerWeekCents: Math.round(Number(sWeekField.value) * 100),
    active: sActiveField.value === "true",
    permanentlyOccupied: sOccupiedField.value === "true",
    notes: sNotesField.value.trim() || null,
    amenityIds,
  };

  const editingId = sIdField.value;
  const url = editingId ? `/api/admin/sites/${editingId}` : "/api/admin/sites";
  const method = editingId ? "PATCH" : "POST";

  const saveBtn = document.getElementById("save-site-btn");
  saveBtn.disabled = true;
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Save failed");
    }
    closeSiteForm();
    await loadAdminSites();
    await loadSites(); // refresh the booking-form site dropdown + feed list too
  } catch (err) {
    siteFormError.textContent = err.message;
    siteFormError.hidden = false;
  } finally {
    saveBtn.disabled = false;
  }
}

/* ---------- danger zone: force reseed ---------- */

const reseedBtn = document.getElementById("reseed-btn");
const reseedStatus = document.getElementById("reseed-status");

reseedBtn.addEventListener("click", async () => {
  const sure = confirm(
    "This deletes ALL current reservations, sites, and amenities and reloads them from db/seed.sql. This cannot be undone. Continue?"
  );
  if (!sure) return;
  const typed = prompt('Type RESEED to confirm.');
  if (typed !== "RESEED") {
    reseedStatus.textContent = "Cancelled — input didn't match.";
    return;
  }

  reseedBtn.disabled = true;
  reseedStatus.textContent = "Reseeding…";
  try {
    const res = await fetch("/api/admin/db/reseed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "RESEED" }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Reseed failed");
    }
    reseedStatus.textContent = `Done — ${data.sitesCount} sites loaded. Refreshing…`;
    await loadSites();
    await loadReservations();
    await loadAmenities();
    await loadAdminSites();
    await loadParkAmenitiesAdmin();
  } catch (err) {
    reseedStatus.textContent = `Failed: ${err.message}`;
  } finally {
    reseedBtn.disabled = false;
  }
});

(async function init() {
  await loadSites();
  await loadReservations();
  await loadAmenities();
  await loadAdminSites();
  await loadParkAmenitiesAdmin();
})();
