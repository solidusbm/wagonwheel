/* Review requests -- plan item 2.4.
 *
 * Self-contained for the same reason as seo-panel.js: admin.js is a module loaded by its own
 * <script src>, which the asset versioner stamps with a content hash. An `import` from here would
 * not be in the HTML, so it would not be stamped, and the browser would fetch a second unversioned
 * copy of admin.js and run the whole thing twice.
 *
 * The panel's job is to make the two things that stop mail going out VISIBLE. A feature that mails
 * real guests and silently does nothing is worse than one that isn't built.
 */
function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

const panel = document.getElementById("review-panel");
let state = null;

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

async function load() {
  const res = await fetch("/api/admin/review-requests");
  if (!res.ok) {
    panel.innerHTML = `<p class="empty-note">Could not load the review-request settings.</p>`;
    return;
  }
  state = await res.json();
  render();
}

function render() {
  panel.innerHTML = `
    <div class="${state.blocked ? "review-status off" : "review-status on"}">
      <p>${
        state.blocked
          ? `<b>Nothing is being sent.</b> ${escapeHtml(state.blocked)}`
          : `<b>On.</b> Guests are asked ${state.delayDays === 0 ? "on the day they check out" : `${state.delayDays} day${state.delayDays === 1 ? "" : "s"} after they check out`}, once each.`
      }</p>
    </div>

    <label style="display:flex; align-items:center; gap:9px; margin:0 0 16px; cursor:pointer;">
      <input type="checkbox" id="rr-enabled" ${state.enabled ? "checked" : ""} style="width:auto; margin:0;" />
      <span>Ask guests for a review after they stay</span>
    </label>

    <div class="field">
      <label for="rr-url">Your Google review link</label>
      <input type="url" id="rr-url" placeholder="https://g.page/r/..." value="${escapeHtml(state.url ?? "")}" />
      <p class="sub" style="margin:5px 0 0;">In your Google Business Profile, choose <b>Ask for reviews</b> and copy the short link it gives you. Until this is filled in, nothing can be sent.</p>
    </div>

    <div class="field">
      <label for="rr-delay">Days to wait after check-out</label>
      <input type="number" id="rr-delay" min="0" max="30" value="${state.delayDays}" style="max-width:120px;" />
      <p class="sub" style="margin:5px 0 0;">A day or two is usual &mdash; long enough to be home, soon enough to remember the stay.</p>
    </div>

    <div class="btn-row" style="margin:16px 0 8px;">
      <button type="button" class="btn btn-primary" id="rr-save">Save</button>
      <button type="button" class="btn btn-ghost" id="rr-preview">Send me a preview</button>
      <button type="button" class="btn btn-ghost" id="rr-run">Send any that are due now</button>
    </div>
    <p class="sub" id="rr-msg" style="min-height:18px; margin:0 0 18px;"></p>

    <div class="sub" style="margin-bottom:6px;">
      Sending as <b>${escapeHtml(state.sendingAs)}</b> &middot; ${state.sentTotal} sent in total,
      ${state.sent30d} in the last 30 days.
    </div>
    ${
      state.recent.length === 0
        ? `<p class="empty-note">None sent yet.</p>`
        : `<div class="table-scroll"><table>
             <thead><tr><th>Booking</th><th>Guest</th><th>Checked out</th><th>Asked</th></tr></thead>
             <tbody>${state.recent
               .map(
                 (r) => `<tr>
                   <td data-label="Booking">${escapeHtml(r.code)}</td>
                   <td data-label="Guest">${escapeHtml(r.guest)}</td>
                   <td data-label="Checked out">${fmtDate(r.checkOut)}</td>
                   <td data-label="Asked">${fmtDate(r.sentAt)}</td>
                 </tr>`
               )
               .join("")}</tbody>
           </table></div>`
    }`;

  wire();
}

function msg(text, isError) {
  const el = document.getElementById("rr-msg");
  el.textContent = text;
  el.style.color = isError ? "var(--rust)" : "var(--cedar)";
}

function wire() {
  document.getElementById("rr-save").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const res = await fetch("/api/admin/review-requests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: document.getElementById("rr-enabled").checked,
          url: document.getElementById("rr-url").value,
          delayDays: Number(document.getElementById("rr-delay").value),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return msg(body.error ?? "Could not save.", true);
      await load();
      msg("Saved.", false);
    } finally {
      e.target.disabled = false;
    }
  });

  document.getElementById("rr-preview").addEventListener("click", async (e) => {
    e.target.disabled = true;
    msg("Sending…", false);
    try {
      const res = await fetch("/api/admin/review-requests/preview", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return msg(body.error ?? "Could not send.", true);
      msg(
        `Sent to ${body.sentTo}.` + (body.usedPlaceholderLink ? " It used a placeholder link, because none is saved yet." : ""),
        false
      );
    } finally {
      e.target.disabled = false;
    }
  });

  document.getElementById("rr-run").addEventListener("click", async (e) => {
    e.target.disabled = true;
    msg("Checking…", false);
    try {
      const res = await fetch("/api/admin/review-requests/run", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return msg(body.error ?? "Could not run.", true);
      if (body.skipped) return msg(body.skipped, true);
      msg(
        body.sent === 0 && body.failed === 0
          ? "Nobody is due right now."
          : `Sent ${body.sent}${body.failed ? `, ${body.failed} failed — check the log` : ""}.`,
        Boolean(body.failed)
      );
      await load();
    } finally {
      e.target.disabled = false;
    }
  });
}

load();
