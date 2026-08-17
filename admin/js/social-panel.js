/* Social posts -- drafts written from the park's own data, for a person to publish.
 *
 * It copies text and opens a tab. It does not post anything, and that is deliberate: see the note
 * at the top of server/lib/socialPosts.js before anyone "finishes" this by wiring it to Meta and
 * Google. The short version is that Google gates its Business Profile API behind an approval the
 * park does not control, Facebook page tokens expire in ways that fail silently, and an automatic
 * "three sites open this weekend" can be false within a minute of publishing.
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

async function load() {
  const res = await fetch("/api/admin/social-posts");
  if (!res.ok) {
    host.innerHTML = `<p class="error-msg">Could not load the drafts.</p>`;
    return;
  }
  data = await res.json();
  render();
}

function render() {
  const { drafts, links } = data;
  host.innerHTML =
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
        <div class="social-actions">
          <button type="button" class="btn btn-primary" data-copy="${i}">Copy</button>
          <a class="btn btn-ghost" href="${escapeHtml(links.facebook)}" target="_blank" rel="noopener">Open Facebook</a>
          <a class="btn btn-ghost" href="${escapeHtml(links.google)}" target="_blank" rel="noopener">Open Google</a>
          <span class="social-status" data-status="${i}"></span>
        </div>
      </div>`
      )
      .join("");

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
