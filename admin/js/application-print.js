/* Renders one reservation's guest application as a sheet of paper.
 *
 * Every field defined in application-schema.js is printed, filled or not: a value that's missing
 * prints as an empty rule to write on. That is the point of the page -- the booking form doesn't
 * ask for everything the park's paper application did (a co-applicant's licence state, for one),
 * and guests skip optional sections, so the office needs a sheet it can complete by hand at
 * check-in. List sections print at least `rows` rows for the same reason.
 */
import { APPLICATION_SECTIONS, get, toDraft } from "./application-schema.js";

const sheet = document.getElementById("sheet");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const money = (cents) => (cents == null ? "" : `$${(cents / 100).toFixed(2)}`);

// Dates arrive as YYYY-MM-DD (or an ISO timestamp). Build them in UTC explicitly -- `new Date()`
// on a bare date string is UTC midnight, which renders as the PREVIOUS day in Texas.
function prettyDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("T")[0].split("-").map(Number);
  if (!y) return String(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function field(f, value) {
  const v = value == null || String(value).trim() === "" ? "" : String(value);
  const shown = f.type === "date" ? prettyDate(v) : v;
  return `<div class="f${f.width === "narrow" ? " narrow" : ""}">
    <span class="lab">${esc(f.label)}</span>
    <span class="val${shown ? " filled" : ""}">${esc(shown)}</span>
  </div>`;
}

function renderSection(section, draft) {
  if (section.kind === "object") {
    const rec = draft[section.key] ?? {};
    return `<section>
      <h2>${esc(section.title)}</h2>
      <div class="grid">${section.fields.map((f) => field(f, get(rec, f.path))).join("")}</div>
    </section>`;
  }

  // Always print at least `rows` rows, so there's somewhere to add the occupant or pet that
  // turned up with them.
  const records = draft[section.key] ?? [];
  const count = Math.max(records.length + 1, section.rows);
  const rows = Array.from({ length: count }, (_, i) =>
    `<div class="grid">${section.fields.map((f) => field(f, get(records[i] ?? {}, f.path))).join("")}</div>`
  ).join("");
  return `<section><h2>${esc(section.title)}</h2><div class="rows">${rows}</div></section>`;
}

function render(r) {
  const draft = toDraft(r.applicationDetails);
  const nights = (() => {
    const a = new Date(String(r.checkIn).split("T")[0] + "T00:00:00Z");
    const b = new Date(String(r.checkOut).split("T")[0] + "T00:00:00Z");
    const n = Math.round((b - a) / 86400000);
    return Number.isFinite(n) && n > 0 ? `${n} night${n === 1 ? "" : "s"}` : "";
  })();

  const booking = [
    ["Confirmation", r.reservationCode],
    ["Status", r.status],
    ["Site", `${r.site?.name ?? ""}${r.site?.area ? ` (${r.site.area})` : ""}`],
    ["Guests", r.guest?.numGuests],
    ["Arriving", prettyDate(r.checkIn)],
    ["Leaving", prettyDate(r.checkOut)],
    ["Length of stay", nights],
    ["Paid", money(r.totalCents)],
    ["Guest name", r.guest?.name],
    ["Email", r.guest?.email],
    ["Phone", r.guest?.phone],
    ["Monthly rate", r.monthlyRateApplied ? "Yes — electric metered separately" : "No"],
  ];

  sheet.innerHTML = `
    <h1>Bandera Wagon Wheel RV Park</h1>
    <p class="park-line">325 Polly Peak Dr &middot; Bandera, TX 78003</p>
    <p class="doc-title">Guest application &mdash; ${esc(r.reservationCode)}</p>

    <div class="booking">
      ${booking.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v ?? "—")}</div></div>`).join("")}
    </div>

    ${APPLICATION_SECTIONS.map((s) => renderSection(s, draft)).join("")}

    <p class="note">Blank lines are details the booking form didn't collect or the guest left out &mdash;
      fill them in here, then update the booking in the admin so the record matches.</p>

    <div class="sign">
      <div class="f"><span class="lab">Guest signature</span><span class="val"></span></div>
      <div class="f date"><span class="lab">Date</span><span class="val"></span></div>
      <div class="f"><span class="lab">Received by</span><span class="val"></span></div>
    </div>
  `;
  document.title = `Application ${r.reservationCode} — Wagon Wheel RV Park`;
}

const code = new URLSearchParams(location.search).get("code");

if (!code) {
  sheet.innerHTML = `<p class="err">No reservation code given. Open this from a booking's "Print application" button.</p>`;
} else {
  fetch(`/api/admin/reservations/${encodeURIComponent(code.toUpperCase())}`)
    .then(async (res) => {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Could not load ${code} (${res.status})`);
      return res.json();
    })
    .then(render)
    .catch((err) => {
      sheet.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    });
}

document.getElementById("print-btn").addEventListener("click", () => window.print());
