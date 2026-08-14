import { APPLICATION_SECTIONS, get, set, normalise, toDraft } from "./application-schema.js";

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* A read-only digest of the guest application for the Notes column -- the editable version is the
   "Application" button, which opens the panel generated from application-schema.js.

   It is NOT a monthly-only intake: the booking form is one unified application for every booking,
   long stay or short. It used to be gated at 28+ nights and that split was deliberately removed. */
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
  return `<details class="app-details"><summary>Guest application</summary>${rows
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

/* A site sold only by the month has no nightly rate to quote. This label used to hardcode
   "/night", so such a site showed as "$0.00/night" in the booking dropdown -- a rate the park
   doesn't offer, at a price it would never charge. Lead with whatever term the site actually sells.
   Note this reads the PUBLIC /api/sites shape (snake_case), not /api/admin/sites. */
function leadRate(s) {
  if (s.price_per_night_cents) return `${money(s.price_per_night_cents)}/night`;
  if (s.price_per_week_cents) return `${money(s.price_per_week_cents)}/week`;
  if (s.price_per_month_cents) return `${money(s.price_per_month_cents)}/month`;
  return "no rate set";
}

async function loadSites() {
  const res = await fetch("/api/sites");
  sites = res.ok ? await res.json() : [];
  siteField.innerHTML = sites.map((s) => `<option value="${s.id}">${s.name} · ${s.area} (${leadRate(s)})</option>`).join("");
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
      <td data-label="Code">${r.reservationCode}</td>
      <td data-label="Status"><span class="status-pill ${r.status}">${r.status}</span></td>
      <td data-label="Site">${r.site.name}<br><span style="color:var(--parchment-dim);font-size:11px;">${r.site.area}</span></td>
      <td data-label="Dates">${formatDate(r.checkIn)} → ${formatDate(r.checkOut)}</td>
      <td data-label="Guest">${r.guest.name}<br><span style="color:var(--parchment-dim);font-size:11px;">${r.guest.email}${r.guest.phone ? " · " + r.guest.phone : ""}</span></td>
      <td data-label="Guests">${r.guest.numGuests}</td>
      <td data-label="Total">${money(r.totalCents)}${r.squarePaymentId ? `<br><span style="color:var(--parchment-dim);font-size:10.5px;font-family:'JetBrains Mono',monospace;" title="Square payment ID — search this in Square to find the transaction">${escapeHtml(r.squarePaymentId)}</span>` : `<br><span style="color:var(--parchment-dim);font-size:10.5px;font-style:italic;">no card payment</span>`}${r.refundedCents != null ? `<br><span style="color:var(--rust-bright);font-size:11px;">refunded ${money(r.refundedCents)}${r.cancellationFeeCents ? ` &middot; fee ${money(r.cancellationFeeCents)}` : ""}</span>` : ""}</td>
      <td data-label="Notes">${r.notes ?? ""}${renderApplication(r.applicationDetails)}</td>
      <td class="row-actions">
        <button type="button" class="btn btn-ghost" data-edit="${r.reservationCode}">Edit</button>
        <button type="button" class="btn btn-ghost" data-application="${r.reservationCode}">Application</button>
        <button type="button" class="btn btn-ghost" data-cancel="${r.reservationCode}">Cancel</button>
        ${r.squarePaymentId && !r.refundedCents ? `<button type="button" class="btn btn-ghost" data-refund="${r.reservationCode}" style="color:var(--rust-bright);">Refund &amp; cancel</button>` : ""}
      </td>
    </tr>`
    )
    .join("");

  content.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Code</th><th>Status</th><th>Site</th><th>Dates</th><th>Guest</th><th>Guests</th><th>Total</th><th>Notes</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  content.querySelectorAll("[data-application]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = reservations.find((x) => x.reservationCode === btn.getAttribute("data-application"));
      if (r) openApplicationForm(r);
    });
  });

  content.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = reservations.find((x) => x.reservationCode === btn.getAttribute("data-edit"));
      if (r) openForm(r);
    });
  });
  content.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => onCancel(btn.getAttribute("data-cancel")));
  });
  content.querySelectorAll("[data-refund]").forEach((btn) => {
    btn.addEventListener("click", () => refundReservation(btn.getAttribute("data-refund")));
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

/* ---------- guest application editor ----------
   Every input here is generated from APPLICATION_SECTIONS, so the form, the printable sheet, and
   the stored record can't drift apart. The office needs this because the booking form is a guest's
   best effort: sections get skipped, plates get mistyped, and a couple of fields (a co-applicant's
   licence state) the online form never asks for at all. */

const applicationPanel = document.getElementById("application-panel");
const applicationForm = document.getElementById("application-form");
const applicationSections = document.getElementById("application-sections");
const applicationError = document.getElementById("application-error");
const applicationCode = document.getElementById("app-code");
const printApplicationLink = document.getElementById("print-application-link");

// The working copy. Edits land here on input, so adding or removing a row never loses what's
// already typed into the other rows.
let applicationDraft = null;

document.getElementById("cancel-application-btn").addEventListener("click", closeApplicationForm);
applicationForm.addEventListener("submit", onApplicationSubmit);

function fieldInput(f, name, value) {
  const v = value == null ? "" : String(value);
  const cls = `field${f.width === "narrow" ? " narrow" : ""}`;
  const attrs = [
    `data-app-field="${escapeHtml(name)}"`,
    f.maxlength ? `maxlength="${f.maxlength}"` : "",
    f.type ? `type="${f.type}"` : `type="text"`,
  ].filter(Boolean).join(" ");

  const control = f.options
    ? `<select data-app-field="${escapeHtml(name)}">
         <option value=""${v ? "" : " selected"}>—</option>
         ${f.options.map((o) => `<option${o === v ? " selected" : ""}>${escapeHtml(o)}</option>`).join("")}
       </select>`
    : `<input ${attrs} value="${escapeHtml(v)}" />`;

  return `<div class="${cls}"><label>${escapeHtml(f.label)}</label>${control}</div>`;
}

function renderApplicationSections() {
  applicationSections.innerHTML = APPLICATION_SECTIONS.map((section) => {
    if (section.kind === "object") {
      const rec = applicationDraft[section.key] ?? {};
      const row = `<div class="app-edit-row">${section.fields.map((f) => fieldInput(f, `${section.key}.${f.path}`, get(rec, f.path))).join("")}</div>`;
      return `<div class="app-section"><h3>${escapeHtml(section.title)}</h3>${row}</div>`;
    }

    const records = applicationDraft[section.key] ?? [];
    const rows = records
      .map(
        (rec, i) => `<div class="app-edit-row">
          ${section.fields.map((f) => fieldInput(f, `${section.key}.${i}.${f.path}`, get(rec, f.path))).join("")}
          <div class="drop"><button type="button" class="btn btn-ghost" data-app-remove="${section.key}:${i}">Remove</button></div>
        </div>`
      )
      .join("");
    const empty = records.length ? "" : `<p class="app-empty">None recorded.</p>`;
    return `<div class="app-section">
      <h3>${escapeHtml(section.title)}</h3>
      ${empty}${rows}
      <button type="button" class="btn btn-ghost app-add" data-app-add="${section.key}">+ Add ${escapeHtml(section.title.replace(/s$/, "").toLowerCase())}</button>
    </div>`;
  }).join("");

  // Written straight into the draft, so a re-render (add/remove a row) keeps everything typed.
  applicationSections.querySelectorAll("[data-app-field]").forEach((el) => {
    el.addEventListener("input", () => {
      const [key, ...rest] = el.getAttribute("data-app-field").split(".");
      const section = APPLICATION_SECTIONS.find((s) => s.key === key);
      if (section.kind === "object") {
        set(applicationDraft[key], rest.join("."), el.value);
      } else {
        const idx = Number(rest.shift());
        set(applicationDraft[key][idx], rest.join("."), el.value);
      }
    });
  });

  applicationSections.querySelectorAll("[data-app-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applicationDraft[btn.getAttribute("data-app-add")].push({});
      renderApplicationSections();
    });
  });

  applicationSections.querySelectorAll("[data-app-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [key, i] = btn.getAttribute("data-app-remove").split(":");
      applicationDraft[key].splice(Number(i), 1);
      renderApplicationSections();
    });
  });
}

function openApplicationForm(r) {
  applicationError.hidden = true;
  applicationCode.value = r.reservationCode;
  applicationDraft = toDraft(r.applicationDetails);
  document.getElementById("application-panel-title").textContent = `Guest application — ${r.reservationCode}`;
  document.getElementById("application-panel-sub").textContent =
    `${r.guest.name} · ${r.site.name} · ${formatDate(r.checkIn)} → ${formatDate(r.checkOut)}`;
  printApplicationLink.href = `/admin/application.html?code=${encodeURIComponent(r.reservationCode)}`;
  renderApplicationSections();
  applicationPanel.classList.add("open");
  applicationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeApplicationForm() {
  applicationPanel.classList.remove("open");
  applicationDraft = null;
}

async function onApplicationSubmit(event) {
  event.preventDefault();
  applicationError.hidden = true;
  const btn = document.getElementById("save-application-btn");
  btn.disabled = true;
  try {
    // normalise() puts it back into exactly the shape a guest's own submission has -- blanks to
    // null, empty rows dropped, an unnamed co-applicant back to null.
    const application = normalise(applicationDraft);
    const res = await fetch(`/api/admin/reservations/${encodeURIComponent(applicationCode.value)}/application`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Save failed");
    closeApplicationForm();
    await loadReservations();
  } catch (err) {
    applicationError.textContent = err.message;
    applicationError.hidden = false;
  } finally {
    btn.disabled = false;
  }
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
const sRigField = document.getElementById("s-rig");
const sPullThroughField = document.getElementById("s-pullthrough");
const sNightField = document.getElementById("s-night");
const sWeekField = document.getElementById("s-week");
const sMonthField = document.getElementById("s-month");
const sNightNa = document.getElementById("s-night-na");
const sWeekNa = document.getElementById("s-week-na");
const sMonthNa = document.getElementById("s-month-na");
const sActiveField = document.getElementById("s-active");
const sOccupiedField = document.getElementById("s-occupied");
const sNotesField = document.getElementById("s-notes");
const siteAmenityChecks = document.getElementById("site-amenity-checks");
const sitePhotoPicker = document.getElementById("site-photo-picker");
const sitePhotoSummary = document.getElementById("site-photo-summary");
const sitePhotoDetails = document.getElementById("site-photo-details");

// Selection order matters: the first photo picked is the one that leads on the guest site card.
let sitePhotoSelection = [];

document.getElementById("new-site-btn").addEventListener("click", () => openSiteForm());
document.getElementById("cancel-site-btn").addEventListener("click", closeSiteForm);
siteForm.addEventListener("submit", onSiteSubmit);
amenityAddForm.addEventListener("submit", onAddAmenity);

/* Each rate is a number box plus an N/A tick. Ticking N/A clears and disables the box, so a term
   the park doesn't rent by can't be mistaken for one nobody has filled in yet -- and typing a
   figure back in unticks it, rather than leaving a number sitting greyed-out and ignored. */
const RATE_FIELDS = [
  [sNightField, sNightNa],
  [sWeekField, sWeekNa],
  [sMonthField, sMonthNa],
];

function applyNaState(input, na) {
  input.disabled = na.checked;
  if (na.checked) input.value = "";
}

RATE_FIELDS.forEach(([input, na]) => {
  na.addEventListener("change", () => {
    applyNaState(input, na);
    if (!na.checked) input.focus();
  });
});

// Reads a rate box as cents, or null when it's marked N/A (or simply left empty -- an empty box
// and a ticked N/A mean the same thing to the server, and the tick is just the legible way of
// saying it).
function rateCents(input, na) {
  if (na.checked) return null;
  const raw = input.value.trim();
  if (raw === "") return null;
  return Math.round(Number(raw) * 100);
}

function setRate(input, na, cents) {
  na.checked = !cents;
  input.value = cents ? (cents / 100).toFixed(2) : "";
  applyNaState(input, na);
}

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
      <div class="flags">
        <label><input type="checkbox" data-flag="showOnHomepage" data-id="${a.id}" ${a.showOnHomepage ? "checked" : ""} /> Homepage</label>
        <label><input type="checkbox" data-flag="showPerSite" data-id="${a.id}" ${a.showPerSite ? "checked" : ""} /> Per-site</label>
      </div>
      <button type="button" class="btn btn-ghost" data-toggle-amenity="${a.id}">${a.active ? "Deactivate" : "Activate"}</button>
      <button type="button" class="btn btn-ghost" data-delete-amenity="${a.id}">Delete</button>
    </div>`
    )
    .join("");

  amenityList.querySelectorAll("[data-flag]").forEach((el) => {
    el.addEventListener("change", () =>
      onUpdateAmenityFlag(Number(el.getAttribute("data-id")), el.getAttribute("data-flag"), el.checked)
    );
  });
  amenityList.querySelectorAll("[data-toggle-amenity]").forEach((btn) => {
    btn.addEventListener("click", () => onToggleAmenityActive(Number(btn.getAttribute("data-toggle-amenity"))));
  });
  amenityList.querySelectorAll("[data-delete-amenity]").forEach((btn) => {
    btn.addEventListener("click", () => onDeleteAmenity(Number(btn.getAttribute("data-delete-amenity"))));
  });
}

// The site editor's per-site checklist only offers amenities meant to be toggled per site --
// a homepage-only amenity like "Pet friendly" has nothing to do with an individual site.
function renderAmenityChecks(checkedIds = []) {
  const perSite = amenities.filter((a) => a.showPerSite);
  if (perSite.length === 0) {
    siteAmenityChecks.innerHTML = `<p class="empty-note">No per-site amenities in the catalog yet.</p>`;
    return;
  }
  siteAmenityChecks.innerHTML = perSite
    .map(
      (a) => `
    <label>
      <input type="checkbox" value="${a.id}" ${checkedIds.includes(a.id) ? "checked" : ""} ${a.active ? "" : "disabled"} />
      ${escapeHtml(a.name)}${a.active ? "" : " (inactive)"}
    </label>`
    )
    .join("");
}

/* Thumbnails of every uploaded photo, ticked for the ones assigned to this site. Order of
   selection is kept -- the first one picked is what a guest sees on the card, and the server
   stores that order as sort_order. */
/* What the picker says when it's shut. Thumbnails rather than "2 selected", because the question
   the office actually has is "which ones", and the lead photo -- the one guests see on the card --
   is ringed so that's answerable at a glance too. */
function renderSitePhotoSummary() {
  if (!sitePhotoSummary) return;
  if (sitePhotoSelection.length === 0) {
    sitePhotoSummary.innerHTML = `<span>None chosen &mdash; guests see a placeholder</span>`;
    return;
  }
  const shown = sitePhotoSelection.slice(0, 4);
  const more = sitePhotoSelection.length - shown.length;
  sitePhotoSummary.innerHTML =
    shown
      .map((id, i) => `<img class="${i === 0 ? "lead-dot" : ""}" src="/photos/${id}/image?w=320" alt="" loading="lazy" />`)
      .join("") +
    `<span>${sitePhotoSelection.length} chosen${more > 0 ? ` (${more} more)` : ""} &middot; ringed one leads</span>`;
}

function renderSitePhotoPicker(selected = []) {
  sitePhotoSelection = [...selected];
  if (photos.length === 0) {
    sitePhotoPicker.innerHTML = `<p class="empty-note">No photos uploaded yet — add some under Photos below, then come back.</p>`;
    return;
  }
  sitePhotoPicker.innerHTML = photos
    .map((p) => {
      const rank = sitePhotoSelection.indexOf(p.id);
      return `<label class="${rank >= 0 ? "on" : ""}" data-photo-pick="${p.id}">
        <input type="checkbox" value="${p.id}" ${rank >= 0 ? "checked" : ""} />
        ${rank === 0 ? `<span class="lead">Shown</span>` : ""}
        <img src="/photos/${p.id}/image?w=320" alt="" loading="lazy" />
        <span class="cap">${escapeHtml(p.caption ?? "(no caption)")}</span>
      </label>`;
    })
    .join("");

  renderSitePhotoSummary();

  sitePhotoPicker.querySelectorAll("input[type=checkbox]").forEach((el) => {
    el.addEventListener("change", () => {
      const id = Number(el.value);
      if (el.checked) sitePhotoSelection.push(id);
      else sitePhotoSelection = sitePhotoSelection.filter((x) => x !== id);
      // Re-render so the "Shown" badge follows the actual lead photo.
      renderSitePhotoPicker(sitePhotoSelection);
    });
  });
}

async function onUpdateAmenityFlag(id, flag, value) {
  const res = await fetch(`/api/admin/amenities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [flag]: value }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not update amenity.");
  }
  await loadAmenities();
  await loadAdminSites();
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
  if (!confirm(`Delete "${a.name}"? This removes it from the homepage (if shown there) and from every site it's toggled on.`)) return;
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

// Lists only the terms this site is actually rented by, so an N/A rate reads as absent rather
// than as $0.00. A monthly-only site shows one line, and says so.
function rateSummary(s) {
  const parts = [
    s.pricePerNightCents ? `${money(s.pricePerNightCents)}/night` : null,
    s.pricePerWeekCents ? `${money(s.pricePerWeekCents)}/week` : null,
    s.pricePerMonthCents ? `${money(s.pricePerMonthCents)}/month cap` : null,
  ].filter(Boolean);
  if (parts.length === 0) return `<span style="color:var(--rust-bright);">No rates — not bookable</span>`;
  const onlyMonthly = parts.length === 1 && s.pricePerMonthCents;
  return parts.join("<br>") + (onlyMonthly ? `<br><span style="color:var(--parchment-dim);font-size:11px;">monthly only</span>` : "");
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
      <td data-label="Site">${escapeHtml(s.name)}<br><span style="color:var(--parchment-dim);font-size:11px;">${escapeHtml(s.area)}</span></td>
      <td data-label="Rate">${rateSummary(s)}</td>
      <td data-label="Amenities">${siteAmenities.map((n) => `<span class="tag">${escapeHtml(n)}</span>`).join(" ") || "—"}</td>
      <td data-label="Status">${s.active ? (s.permanentlyOccupied ? "Occupied (not bookable)" : "Active") : "Inactive"}</td>
      <td class="row-actions"><button type="button" class="btn btn-ghost" data-edit-site="${s.id}">Edit</button></td>
    </tr>`;
    })
    .join("");

  sitesContent.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>Site</th><th>Rate</th><th>Amenities</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
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
    sRigField.value = site.maxRigLength ?? "";
    sPullThroughField.value = String(site.pullThrough);
    setRate(sNightField, sNightNa, site.pricePerNightCents);
    setRate(sWeekField, sWeekNa, site.pricePerWeekCents);
    setRate(sMonthField, sMonthNa, site.pricePerMonthCents);
    sActiveField.value = String(site.active);
    sOccupiedField.value = String(site.permanentlyOccupied);
    sNotesField.value = site.notes ?? "";
    renderAmenityChecks(site.amenityIds);
    renderSitePhotoPicker(site.photoIds ?? []);
  } else {
    sitePanelTitle.textContent = "New site";
    sIdField.value = "";
    sActiveField.value = "true";
    sOccupiedField.value = "false";
    sPullThroughField.value = "false";
    // form.reset() restores each checkbox's HTML default (unticked) but leaves the disabled
    // state it was last put in, so the boxes have to be re-synced by hand either way.
    RATE_FIELDS.forEach(([input, na]) => applyNaState(input, na));
    renderAmenityChecks([]);
    renderSitePhotoPicker([]);
  }
  // Shut again for each site opened, so it never inherits the previous site's expanded state --
  // the summary is the intended resting view.
  sitePhotoDetails?.removeAttribute("open");
  sitePanel.classList.add("open");
  // The panel lives inside the collapsed <details> for Sites; opening the form without opening
  // the section it sits in would scroll to nothing.
  sitePanel.closest("details")?.setAttribute("open", "");
  sitePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSiteForm() {
  sitePanel.classList.remove("open");
  siteForm.reset();
  RATE_FIELDS.forEach(([input, na]) => applyNaState(input, na));
}

async function onSiteSubmit(event) {
  event.preventDefault();
  siteFormError.hidden = true;

  const amenityIds = [...siteAmenityChecks.querySelectorAll('input[type="checkbox"]:checked')].map((el) => Number(el.value));

  const payload = {
    name: sNameField.value.trim(),
    area: sAreaField.value.trim(),
    maxRigLength: sRigField.value ? Number(sRigField.value) : null,
    pullThrough: sPullThroughField.value === "true",
    // null means N/A -- the site isn't rented by that term, and the server prices a stay with
    // whichever terms are left. Sent explicitly rather than omitted, because the PATCH treats a
    // missing key as "leave this one alone".
    pricePerNightCents: rateCents(sNightField, sNightNa),
    pricePerWeekCents: rateCents(sWeekField, sWeekNa),
    pricePerMonthCents: rateCents(sMonthField, sMonthNa),
    active: sActiveField.value === "true",
    permanentlyOccupied: sOccupiedField.value === "true",
    notes: sNotesField.value.trim() || null,
    amenityIds,
    photoIds: sitePhotoSelection,
  };

  if (!payload.pricePerNightCents && !payload.pricePerWeekCents && !payload.pricePerMonthCents) {
    siteFormError.textContent = "A site needs at least one rate — nightly, weekly, or monthly. They can't all be N/A.";
    siteFormError.hidden = false;
    return;
  }

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

/* ---------- photos ---------- */

let photos = [];
const photoGrid = document.getElementById("photo-grid");
const photoUploadForm = document.getElementById("photo-upload-form");
const photoFileInput = document.getElementById("photo-file-input");
const photoCaptionInput = document.getElementById("photo-caption-input");
const photoHomepageInput = document.getElementById("photo-homepage-input");
const photoUploadError = document.getElementById("photo-upload-error");
const photoUploadBtn = document.getElementById("photo-upload-btn");

photoUploadForm.addEventListener("submit", onUploadPhoto);

async function loadPhotos() {
  const res = await fetch("/api/admin/photos");
  photos = res.ok ? await res.json() : [];
  renderPhotoGrid();
  // The site editor's picker is built from this list. If a site was opened before the photos
  // arrived -- or one was just uploaded or deleted -- rebuild it, keeping the current selection.
  if (sitePanel.classList.contains("open")) renderSitePhotoPicker(sitePhotoSelection);
}

function renderPhotoGrid() {
  if (photos.length === 0) {
    photoGrid.innerHTML = `<p class="empty-note">No photos uploaded yet.</p>`;
    return;
  }

  /* Position is shown, and moving is done with arrows rather than drag-and-drop: this panel is
     used on a phone at the park, where dragging a tile inside a scrolling page is a fight. The
     badge counts only the homepage photos, because "which one do guests see first" is the actual
     question -- the grid order alone doesn't answer it when half the photos are gallery-only. */
  let homepageSeen = 0;
  photoGrid.innerHTML = photos
    .map((p, i) => {
      const homepageRank = p.showOnHomepage ? ++homepageSeen : null;
      return `
    <div class="photo-tile">
      <img src="/photos/${p.id}/image?w=320" alt="${escapeHtml(p.caption ?? "")}" loading="lazy" />
      ${homepageRank ? `<span class="home-rank" title="Position in the homepage gallery">Home #${homepageRank}</span>` : ""}
      <div class="body">
        <input type="text" data-caption="${p.id}" value="${escapeHtml(p.caption ?? "")}" placeholder="Caption" />
        <div class="order-row">
          <button type="button" class="btn btn-ghost" data-move="${p.id}:-1" ${i === 0 ? "disabled" : ""} aria-label="Move earlier">&larr;</button>
          <span class="pos">${i + 1} / ${photos.length}</span>
          <button type="button" class="btn btn-ghost" data-move="${p.id}:1" ${i === photos.length - 1 ? "disabled" : ""} aria-label="Move later">&rarr;</button>
        </div>
        <div class="row">
          <label><input type="checkbox" data-homepage="${p.id}" ${p.showOnHomepage ? "checked" : ""} /> Homepage</label>
          <button type="button" class="btn btn-ghost" data-delete-photo="${p.id}">Delete</button>
        </div>
      </div>
    </div>`;
    })
    .join("");

  photoGrid.querySelectorAll("[data-caption]").forEach((el) => {
    el.addEventListener("change", () => onUpdatePhoto(Number(el.getAttribute("data-caption")), { caption: el.value }));
  });
  photoGrid.querySelectorAll("[data-homepage]").forEach((el) => {
    el.addEventListener("change", () => onUpdatePhoto(Number(el.getAttribute("data-homepage")), { showOnHomepage: el.checked }));
  });
  photoGrid.querySelectorAll("[data-move]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [id, step] = btn.getAttribute("data-move").split(":");
      onMovePhoto(Number(id), Number(step));
    });
  });
  photoGrid.querySelectorAll("[data-delete-photo]").forEach((btn) => {
    btn.addEventListener("click", () => onDeletePhoto(Number(btn.getAttribute("data-delete-photo"))));
  });
}

/* Swaps a photo with its neighbour and sends the whole order. Sending the full list rather than
   two positions means the server can renumber from 1, so the gaps and duplicate positions left by
   earlier edits heal themselves instead of accumulating. */
let reordering = false;
async function onMovePhoto(id, step) {
  if (reordering) return;
  const from = photos.findIndex((p) => p.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= photos.length) return;

  // Move locally first so the grid responds immediately, then confirm against the server's answer.
  const next = [...photos];
  [next[from], next[to]] = [next[to], next[from]];
  photos = next;
  renderPhotoGrid();

  reordering = true;
  photoGrid.querySelectorAll("[data-move]").forEach((b) => (b.disabled = true));
  try {
    const res = await fetch("/api/admin/photos/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map((p) => p.id) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not save the new order");
    photos = data;
  } catch (err) {
    alert(err.message);
    await loadPhotos(); // put the grid back to whatever the server actually holds
  } finally {
    reordering = false;
    renderPhotoGrid();
  }
}

async function onUpdatePhoto(id, patch) {
  const res = await fetch(`/api/admin/photos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not update photo.");
  }
  await loadPhotos();
}

async function onDeletePhoto(id) {
  if (!confirm("Delete this photo? This can't be undone.")) return;
  const res = await fetch(`/api/admin/photos/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not delete photo.");
    return;
  }
  await loadPhotos();
}

async function onUploadPhoto(event) {
  event.preventDefault();
  photoUploadError.hidden = true;

  const file = photoFileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);
  if (photoCaptionInput.value.trim()) formData.append("caption", photoCaptionInput.value.trim());
  formData.append("showOnHomepage", String(photoHomepageInput.checked));

  photoUploadBtn.disabled = true;
  try {
    const res = await fetch("/api/admin/photos", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Upload failed");
    }
    photoUploadForm.reset();
    await loadPhotos();
  } catch (err) {
    photoUploadError.textContent = err.message;
    photoUploadError.hidden = false;
  } finally {
    photoUploadBtn.disabled = false;
  }
}

/* ---------- refunds ----------
   Two steps on purpose: fetch the policy figures and show them, then act only on a confirmation
   that names the amount. A refund cannot be undone, so the office should never be one stray click
   away from sending money back. */
async function refundReservation(code) {
  let q;
  try {
    const res = await fetch(`/api/admin/reservations/${encodeURIComponent(code)}/refund-quote`);
    q = await res.json();
    if (!res.ok) throw new Error(q.error || "Could not read the refund figures.");
  } catch (err) {
    alert(err.message);
    return;
  }

  const basis =
    q.basis === "monthly"
      ? "charged at the monthly rate, so a flat $100 fee"
      : "a fee of 11.11% of what was charged";
  const typed = prompt(
    `Refund ${code}

` +
      `Paid: ${money(q.totalCents)}
` +
      `This booking was ${basis}.
` +
      `Fee ${money(q.feeCents)}, refund ${money(q.refundCents)}.

` +
      `This sends money back through Square and cannot be undone, and it cancels the booking.

` +
      `Amount to refund in dollars (edit for an edge case):`,
    (q.refundCents / 100).toFixed(2)
  );
  if (typed === null) return;
  const cents = Math.round(Number(typed) * 100);
  if (!Number.isInteger(cents) || cents < 0 || cents > q.totalCents) {
    alert(`That is not a valid amount. It must be between $0.00 and ${money(q.totalCents)}.`);
    return;
  }

  try {
    const res = await fetch(`/api/admin/reservations/${encodeURIComponent(code)}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountCents: cents }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Refund failed.");
    alert(
      `Refunded ${money(data.refundedCents)} for ${code}${data.followedPolicy ? "" : " (overriding the policy figure)"}.
` +
        `Fee kept: ${money(data.feeCents)}.
The booking is cancelled.`
    );
    loadReservations();
  } catch (err) {
    alert("Refund failed: " + err.message);
  }
}

/* ---------- payments ---------- */
const squareCheckBtn = document.getElementById("square-check-btn");
const squareResult = document.getElementById("square-result");

squareCheckBtn.addEventListener("click", async () => {
  squareCheckBtn.disabled = true;
  squareResult.textContent = "Asking Square…";
  try {
    const res = await fetch("/api/admin/square/locations");
    const d = await res.json();
    if (!d.ok) {
      squareResult.innerHTML =
        "<strong>Square refused the request.</strong> " + escapeHtml(d.error ?? "Unknown error") +
        (d.code ? " (" + escapeHtml(d.code) + ")" : "") +
        "<br>Usually the access token does not match the environment, or it belongs to a different Square account.";
      return;
    }
    const rows = d.locations
      .map((l) => {
        const marks = [];
        if (l.isConfigured) marks.push("<strong>this site uses this one</strong>");
        marks.push(l.canTakePayments ? "can take cards" : "<strong>cannot take cards</strong>");
        if (l.status) marks.push(escapeHtml(l.status.toLowerCase()));
        return "<div class=\"app-row\"><b>" + escapeHtml(l.name || l.id) + "</b> " +
          escapeHtml(l.id) + " &mdash; " + marks.join(" &middot; ") + "</div>";
      })
      .join("");

    let verdict;
    if (!d.found) {
      verdict = "<strong>The configured location is not in this Square account.</strong> " +
        escapeHtml(d.configuredLocationId ?? "(none set)") +
        " was not returned by these credentials — either it is from a different account, or from the other environment.";
    } else if (!d.canTakePayments) {
      verdict = "<strong>The configured location cannot take card payments.</strong> This is an account activation matter, not a setting: Square withholds card processing until business details and a bank account are on file and verified.";
    } else {
      verdict = "<strong>Ready.</strong> The configured location exists and can take card payments.";
    }

    squareResult.innerHTML =
      "<div style=\"margin-bottom:10px\">Environment: <b>" + escapeHtml(d.environment) + "</b></div>" +
      (rows || "<div>No locations returned at all.</div>") +
      "<div style=\"margin-top:10px\">" + verdict + "</div>";
  } catch (err) {
    squareResult.textContent = "Failed: " + err.message;
  } finally {
    squareCheckBtn.disabled = false;
  }
});

/* ---------- booking alert email ---------- */
const emailStatusEl = document.getElementById("email-status");
const emailTestBtn = document.getElementById("email-test-btn");
const emailTestStatus = document.getElementById("email-test-status");

function describeMailConfig(c) {
  if (!c.smtpHost) {
    return "<strong>Not sending.</strong> No mail server is configured (<code>SMTP_HOST</code>), so booking alerts are only written to the server log.";
  }
  if (!c.adminEmail) {
    return "<strong>Not sending.</strong> A mail server is set up, but <code>ADMIN_EMAIL</code> is empty, so there is no address to alert.";
  }
  const warn = c.hasPassword
    ? ""
    : " <strong>No password is set</strong> (<code>SMTP_PASS</code>) &mdash; most servers will refuse to send.";
  return (
    "Alerts go to <strong>" + escapeHtml(c.adminEmail) + "</strong>, sent from " +
    escapeHtml(c.from) + " via " + escapeHtml(c.smtpHost) + ":" + c.smtpPort + "." + warn
  );
}

async function loadEmailStatus() {
  try {
    const res = await fetch("/api/admin/email/status");
    if (!res.ok) throw new Error("Could not read the mail settings.");
    emailStatusEl.innerHTML = describeMailConfig(await res.json());
  } catch (err) {
    emailStatusEl.textContent = err.message;
  }
}

const emailGuestBtn = document.getElementById("email-guest-btn");
emailGuestBtn.addEventListener("click", async () => {
  emailGuestBtn.disabled = true;
  emailTestStatus.textContent = "Sending the guest preview…";
  try {
    const res = await fetch("/api/admin/email/guest-preview", { method: "POST" });
    const data = await res.json();
    emailTestStatus.textContent = data.ok
      ? "Guest preview sent to " + (data.sentTo.join(", ") || "the alert address") + ". It is marked [SAMPLE]."
      : "Failed: " + data.error;
  } catch (err) {
    emailTestStatus.textContent = "Failed: " + err.message;
  } finally {
    emailGuestBtn.disabled = false;
  }
});

emailTestBtn.addEventListener("click", async () => {
  emailTestBtn.disabled = true;
  emailTestStatus.textContent = "Sending…";
  try {
    const res = await fetch("/api/admin/email/test", { method: "POST" });
    const data = await res.json();
    emailTestStatus.textContent = data.ok
      ? "Sent to " + (data.sentTo.join(", ") || "the alert address") + ". Check the inbox — and the spam folder."
      : "Failed: " + data.error;
  } catch (err) {
    emailTestStatus.textContent = "Failed: " + err.message;
  } finally {
    emailTestBtn.disabled = false;
  }
});

loadEmailStatus();


/* ---------- content blocks ---------- */

const contentList = document.getElementById("content-list");

async function loadContent() {
  const res = await fetch("/api/admin/content");
  const blocks = res.ok ? await res.json() : [];
  renderContentList(blocks);
}

function renderContentList(blocks) {
  if (blocks.length === 0) {
    contentList.innerHTML = `<p class="empty-note">No editable content registered yet.</p>`;
    return;
  }
  contentList.innerHTML = blocks
    .map(
      (b) => `
    <div class="content-row">
      <div class="meta-line">
        <span><span class="section-label">${escapeHtml(b.section)}</span> · <span class="field-label">${escapeHtml(b.label)}</span></span>
        <span class="save-hint" data-hint="${escapeHtml(b.key)}">Saved</span>
      </div>
      <textarea rows="2" data-content-key="${escapeHtml(b.key)}">${escapeHtml(b.value)}</textarea>
    </div>`
    )
    .join("");

  contentList.querySelectorAll("textarea[data-content-key]").forEach((el) => {
    el.addEventListener("change", () => onSaveContent(el.getAttribute("data-content-key"), el.value));
  });
}

async function onSaveContent(key, value) {
  const res = await fetch(`/api/admin/content/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Could not save.");
    return;
  }
  const hint = contentList.querySelector(`[data-hint="${CSS.escape(key)}"]`);
  if (hint) {
    hint.classList.add("show");
    setTimeout(() => hint.classList.remove("show"), 1500);
  }
}

(async function init() {
  await loadSites();
  await loadReservations();
  await loadAmenities();
  await loadAdminSites();
  await loadPhotos();
  await loadContent();
})();
