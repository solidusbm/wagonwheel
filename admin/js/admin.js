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

(async function init() {
  await loadSites();
  await loadReservations();
})();
