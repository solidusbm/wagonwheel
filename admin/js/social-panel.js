/* Social posts -- drafts written from the park's own data, for a person to publish, plus the
 * Facebook queue (server/lib/facebook.js) those drafts can be put on with a date, an image and an
 * optional repeat. The queue is still a person's choice every time: nothing is queued from live
 * availability, and Google stays copy-and-paste until its API access is approved -- the reasons
 * are at the top of server/lib/socialPosts.js.
 *
 * The photo is a GUESS -- picked server-side by matching words in a caption, which has no
 * guarantee of being right the way the text's numbers do. That's why it is a dropdown over the
 * whole homepage set rather than a fixed choice: getting it wrong costs the office one click, not
 * a wrong photo in public.
 *
 * Its own file rather than more of admin.js, and self-contained rather than importing from it.
 * admin.js is a module loaded by its own <script src>, which the asset versioner stamps with a
 * content hash; an `import` specifier inside this file is not in the HTML, so it would NOT be
 * stamped -- the browser would fetch a second, unversioned copy of admin.js and run it twice.
 */
function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/* Tall enough that the whole draft is visible without scrolling -- the office is proof-reading it
   before it goes public, and a box that hides half the text defeats the point. Counts wrapped
   lines per line rather than dividing the total length, which got the amenity list (many short
   lines) badly wrong. */
function rowsFor(text) {
  if (!text) return 4;
  const lines = text
    .split(/\r?\n/)
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 90)), 0);
  return Math.min(20, Math.max(4, lines + 1));
}

const host = document.getElementById("social-panel");
let data = null;

let fbData = null;

async function load() {
  const [res, fbRes] = await Promise.all([fetch("/api/admin/social-posts"), fetch("/api/admin/social/queue")]);
  if (!res.ok) {
    host.innerHTML = `<p class="error-msg">Could not load the drafts.</p>`;
    return;
  }
  data = await res.json();
  fbData = fbRes.ok ? await fbRes.json() : null;
  render();
}

/* The default slot for a new queue entry: the coming Thursday at 6:30 pm, local time, formatted
   for a datetime-local input. Thursday because weekend trips get decided midweek. */
function nextSlot() {
  const d = new Date();
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7));
  d.setHours(18, 30, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function imageLabel(image, photos) {
  if (!image) return "no image";
  if (image === "evergreen-square") return "the ad (square)";
  if (image === "evergreen-4x3") return "the ad (4:3)";
  const id = Number(image.replace("photo:", ""));
  return photos.find((p) => p.id === id)?.caption || `photo ${id}`;
}

/* The office lands back here from Facebook with ?social=… in the address. */
function connectMessage() {
  const q = new URLSearchParams(location.search);
  const why = q.get("why");
  return {
    connected: "Facebook connected.",
    denied: "Facebook sign-in was cancelled.",
    expired: "That sign-in link had expired. Press Connect again.",
    nopages: "That Facebook account doesn't manage any Page it can post to.",
    unconfigured: "Facebook posting is not set up on the server yet.",
    failed: `Could not connect: ${why || "Facebook returned an error"}.`,
  }[q.get("social")] || "";
}

function facebookBlock() {
  if (!fbData) return `<div class="social-fb"><p class="social-note">The Facebook queue could not be loaded.</p></div>`;
  const { configured, account, queue, redirectUri } = fbData;
  const photos = data.photos;
  let head;
  if (!configured) {
    head = `<p class="map-hint">Not set up yet: the server needs <code>FB_APP_ID</code> and <code>FB_APP_SECRET</code> from a Meta app owned by the park, with <code>${escapeHtml(redirectUri)}</code> as its sign-in redirect. Until then the drafts are copy-and-paste, as before.</p>`;
  } else if (!account) {
    head = `<p>No Page connected. Sign in with the Facebook account that manages the park's Page.</p>
      <a class="btn btn-primary" href="/api/admin/social/facebook/connect">Connect Facebook</a>`;
  } else {
    head = `<p>Posting as <strong>${escapeHtml(account.page_name)}</strong>, connected ${escapeHtml(fmtWhen(account.connected_at))}${account.connected_by ? ` by ${escapeHtml(account.connected_by)}` : ""}.
      <button type="button" class="btn btn-ghost" id="fb-disconnect">Disconnect</button></p>`;
  }
  const msg = connectMessage();
  const rows = queue.length
    ? queue
        .map((r) => {
          const what = r.draft_id ? (data.drafts.find((d) => d.id === r.draft_id)?.label || r.draft_id) : (r.text || "").split("\n")[0].slice(0, 70);
          const status =
            r.status === "posted" ? `posted ${fmtWhen(r.posted_at)}` :
            r.status === "failed" ? `<span class="social-fail">failed: ${escapeHtml(r.error || "")}</span>` :
            r.status;
          const actions =
            r.status === "queued" ? `<button type="button" class="btn btn-ghost" data-qnow="${r.id}">Post now</button> <button type="button" class="btn btn-ghost" data-qcancel="${r.id}">Cancel</button>` :
            r.status === "failed" || r.status === "cancelled" ? `<button type="button" class="btn btn-ghost" data-qnow="${r.id}">${r.status === "failed" ? "Retry" : "Post now"}</button>` : "";
          return `<tr class="q-${r.status}"><td>${escapeHtml(fmtWhen(r.publish_at))}</td><td>${escapeHtml(what)}${r.repeat_days ? `<br><small>repeats every ${r.repeat_days} days</small>` : ""}</td><td>${escapeHtml(imageLabel(r.image, photos))}</td><td>${status}</td><td>${actions}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="empty-note">Nothing queued. Each draft below has a "Queue on Facebook" row.</td></tr>`;
  return `<div class="social-fb">
      <h3>Facebook posting</h3>
      ${msg ? `<p class="social-status">${escapeHtml(msg)}</p>` : ""}
      ${head}
      <table class="social-queue"><thead><tr><th>When</th><th>What</th><th>Image</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      ${account ? "" : `<p class="map-hint">Posts can be queued now; they go out once a Page is connected.</p>`}
    </div>`;
}

function queueRow(d, i) {
  if (!fbData || !fbData.configured) return "";
  const photos = data.photos;
  const isAd = /^evergreen-/.test(d.id);
  const opts = [
    [`""`, "No image", !isAd && !d.photoId],
    [`"evergreen-square"`, "The ad (square)", isAd],
    [`"evergreen-4x3"`, "The ad (4:3)", false],
    ...photos.map((p) => [`"photo:${p.id}"`, p.caption || `Photo ${p.id}`, !isAd && p.id === d.photoId]),
  ]
    .map(([v, label, sel]) => `<option value=${v}${sel ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  return `<div class="social-queue-row">
      <label>Queue on Facebook <input type="datetime-local" id="q-when-${i}" value="${nextSlot()}"></label>
      <label>Image <select id="q-img-${i}">${opts}</select></label>
      <label><input type="checkbox" id="q-rep-${i}"${isAd ? " checked" : ""}> repeat every 2 weeks</label>
      <button type="button" class="btn btn-primary" data-queue="${i}">Queue</button>
      <span class="social-status" data-qstatus="${i}"></span>
    </div>`;
}

/** The photo block for one draft: a dropdown over every homepage photo, a thumbnail, and a
 *  full-size link -- or nothing, if the park hasn't flagged any photo for the homepage yet. */
function photoBlock(photos, photoId, i) {
  if (!photos.length) return "";
  const options =
    `<option value=""${photoId ? "" : " selected"}>No photo</option>` +
    photos
      .map(
        (p) =>
          `<option value="${p.id}"${p.id === photoId ? " selected" : ""}>${escapeHtml(p.caption || `Photo ${p.id}`)}</option>`
      )
      .join("");
  const shown = photoId ? "" : ' hidden="hidden"';
  const alt = escapeHtml(photos.find((p) => p.id === photoId)?.caption || "");
  return `
        <div class="social-photo">
          <select id="photo-sel-${i}" aria-label="Photo for this post">${options}</select>
          <div class="social-photo-preview"${shown} id="photo-preview-${i}">
            <img id="photo-img-${i}" src="/photos/${photoId}/image?w=320" alt="${alt}" />
            <a id="photo-link-${i}" href="/photos/${photoId}/image" target="_blank" rel="noopener">Open full size</a>
          </div>
        </div>`;
}

function render() {
  const { drafts, links, photos } = data;
  host.innerHTML =
    facebookBlock() +
    `<div class="social-links">
       <div class="map-rows">
         <label for="fb-url">Facebook composer</label>
         <input type="url" id="fb-url" value="${escapeHtml(links.facebook)}" />
         <label for="gbp-url">Google post page</label>
         <input type="url" id="gbp-url" value="${escapeHtml(links.google)}" />
       </div>
       <button type="button" class="btn btn-ghost" id="save-links">Save links</button>
       <span class="social-status" id="link-status"></span>
       <p class="map-hint">Where the buttons below take you. Both platforms move these pages from
         time to time; clear a box to go back to the built-in default.</p>
     </div>` +
    drafts
      .map(
        (d, i) => `
      <div class="social-draft">
        <h3>${escapeHtml(d.label)}</h3>
        <p class="social-note">${escapeHtml(d.note)}</p>
        <textarea id="draft-${i}" rows="${rowsFor(d.text)}">${escapeHtml(d.text)}</textarea>
        ${photoBlock(photos, d.photoId, i)}
        <div class="social-actions">
          <button type="button" class="btn btn-primary" data-copy="${i}">Copy text</button>
          <a class="btn btn-ghost" href="${escapeHtml(links.facebook)}" target="_blank" rel="noopener">Open Facebook</a>
          <a class="btn btn-ghost" href="${escapeHtml(links.google)}" target="_blank" rel="noopener">Open Google</a>
          <span class="social-status" data-status="${i}"></span>
        </div>
        ${photos.length ? `<p class="social-photo-hint">Drag the photo above into the post window, or open it full size and save it &mdash; there's no automatic attach, so this is the whole step.</p>` : ""}
        ${queueRow(d, i)}
      </div>`
      )
      .join("");

  photos.length &&
    host.querySelectorAll("[id^='photo-sel-']").forEach((sel) => {
      sel.addEventListener("change", () => {
        const i = sel.id.replace("photo-sel-", "");
        const preview = document.getElementById(`photo-preview-${i}`);
        if (!sel.value) {
          preview.hidden = true;
          return;
        }
        const chosen = photos.find((p) => String(p.id) === sel.value);
        document.getElementById(`photo-img-${i}`).src = `/photos/${sel.value}/image?w=320`;
        document.getElementById(`photo-img-${i}`).alt = chosen?.caption || "";
        document.getElementById(`photo-link-${i}`).href = `/photos/${sel.value}/image`;
        preview.hidden = false;
      });
    });

  host.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = btn.getAttribute("data-copy");
      const text = document.getElementById(`draft-${i}`).value;
      const status = host.querySelector(`[data-status="${i}"]`);
      /* Copy whatever is in the box, not the generated draft -- the point of the textarea is that
         the office edits before posting, and copying the original would silently discard that. */
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = "Copied. Paste it into the post.";
      } catch {
        // Clipboard permission can be refused; select the text so Ctrl+C still works.
        const el = document.getElementById(`draft-${i}`);
        el.focus();
        el.select();
        status.textContent = "Press Ctrl+C to copy.";
      }
      setTimeout(() => (status.textContent = ""), 4000);
    });
  });

  /* Queue a draft. If the box still holds the generated text, only the draft id goes: the server
     re-renders it at post time so the rates line is that day's. An edited box is sent as written. */
  host.querySelectorAll("[data-queue]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = btn.getAttribute("data-queue");
      const d = drafts[i];
      const status = host.querySelector(`[data-qstatus="${i}"]`);
      const text = document.getElementById(`draft-${i}`).value;
      const edited = text.trim() !== (d.text || "").trim();
      const when = document.getElementById(`q-when-${i}`).value;
      if (!when) { status.textContent = "Pick a date and time."; return; }
      status.textContent = "Queuing…";
      const res = await fetch("/api/admin/social/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: edited || d.id === "blank" ? null : d.id,
          text: edited || d.id === "blank" ? text : null,
          image: document.getElementById(`q-img-${i}`).value || null,
          publishAt: new Date(when).toISOString(),
          repeatDays: document.getElementById(`q-rep-${i}`).checked ? 14 : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { status.textContent = body.error || "Could not queue."; return; }
      fbData.queue = body.queue;
      render();
    });
  });
  const queueCall = (url, method) => async () => {
    const res = await fetch(url, { method });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.queue) { fbData.queue = body.queue; render(); }
  };
  host.querySelectorAll("[data-qcancel]").forEach((b) => b.addEventListener("click", queueCall(`/api/admin/social/queue/${b.dataset.qcancel}`, "DELETE")));
  host.querySelectorAll("[data-qnow]").forEach((b) => b.addEventListener("click", queueCall(`/api/admin/social/queue/${b.dataset.qnow}/now`, "POST")));
  document.getElementById("fb-disconnect")?.addEventListener("click", async () => {
    if (!confirm("Disconnect the Facebook Page? Queued posts stay, but nothing goes out until a Page is connected again.")) return;
    await fetch("/api/admin/social/facebook", { method: "DELETE" });
    history.replaceState(null, "", location.pathname);
    load();
  });

  document.getElementById("save-links").addEventListener("click", async () => {
    const status = document.getElementById("link-status");
    status.textContent = "Saving…";
    const res = await fetch("/api/admin/social-posts/links", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facebook: document.getElementById("fb-url").value,
        google: document.getElementById("gbp-url").value,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      status.textContent = body.error || "Could not save.";
      return;
    }
    data = body;
    render();
    document.getElementById("link-status").textContent = "Saved.";
  });
}

load();
