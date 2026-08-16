/* Search & sharing -- plan item 4.1.
 *
 * Narrow on purpose. The office gets the three decisions that actually need a person: the sentence
 * under the blue link, which photograph fronts a shared link, and whether the site should be in an
 * index at all. Each one comes with a preview, because none of them can be judged from a form
 * field. Everything else a crawler reads is derived server-side (server/lib/seo.js) and appears
 * here read-only, so the panel answers "what does Google see?" without inviting anyone to type
 * something different into it.
 *
 * There is deliberately NO free-text box for meta tags. It reads as flexibility and behaves as a
 * second source of truth: within a month it disagrees with the database and starts quietly telling
 * Google something the site no longer does.
 *
 * Its own file rather than more of admin.js, and self-contained rather than importing from it.
 * admin.js is a module loaded by its own <script src>, which the asset versioner stamps with a
 * content hash; an `import` specifier inside this file is not in the HTML, so it would NOT be
 * stamped -- the browser would fetch a second, unversioned copy of admin.js and run the whole
 * thing twice. Hence the three-line escapeHtml below instead of sharing one.
 */
function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

const panel = document.getElementById("seo-panel");
let data = null;
let draft = null;

/* Google truncates a description around 155-160 characters. Going over is not an error -- the tail
   is simply cut, which is fine for a sentence that front-loads the point -- so this warns and never
   blocks. The server's own limit is 320 and exists to stop a paste of the whole page body. */
const DESC_IDEAL_MAX = 160;

const prettyUrl = (u) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
const descOf = (page) => draft.descriptions[page.target] || page.defaultDescription;

async function load() {
  const res = await fetch("/api/admin/seo");
  if (!res.ok) {
    panel.innerHTML = `<p class="empty-note">Could not load the search settings.</p>`;
    return;
  }
  data = await res.json();
  draft = {
    // A page using the built-in wording starts with an EMPTY box showing that wording as a
    // placeholder, so "no opinion" and "typed the default out by hand" stay distinguishable.
    descriptions: Object.fromEntries(data.pages.map((p) => [p.target, p.isCustom ? p.description : ""])),
    sharePhotoId: data.sharePhotoId,
    indexing: data.indexing,
  };
  render();
}

/* The readout is why this panel is worth having for anyone technical: a plain answer to "what is
   actually on the page", without going to view-source on the live site. */
function readout(page) {
  const desc = descOf(page);
  return [
    `<title>${page.title ?? ""}</title>`,
    `<link rel="canonical" href="${page.url}">`,
    `<meta name="description" content="${desc}">`,
    `<meta property="og:title" content="${page.title ?? ""}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:image" content="${data.origin}/og-image.jpg">`,
    draft.indexing ? null : `<meta name="robots" content="noindex, nofollow">`,
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join("\n");
}

function render() {
  const home = data.pages[0];
  const shareSrc = draft.sharePhotoId ? `/photos/${draft.sharePhotoId}/image?w=640` : "";

  panel.innerHTML = `
    ${
      draft.indexing
        ? ""
        : `<div class="seo-danger"><p><b>This site is hidden from search engines.</b> Google and Bing are being asked not to index any page, and pages already listed will drop out over the following days. Only leave this off deliberately &mdash; it does not affect the booking form, which keeps working normally.</p></div>`
    }

    <label style="display:flex; align-items:center; gap:9px; margin:0 0 22px; cursor:pointer;">
      <input type="checkbox" id="seo-indexing" ${draft.indexing ? "checked" : ""} style="width:auto; margin:0;" />
      <span>Let search engines find this site</span>
    </label>

    <h3 style="margin:0 0 4px;">Photo for shared links</h3>
    <div class="sub" style="margin-bottom:10px;">Used whenever a link to the park is posted to Facebook or sent in a message. It gets cropped to a wide banner automatically, so a photo with its subject near the middle works best.</div>
    <p class="seo-preview-label">How a shared link will look</p>
    <div class="fb-card" style="margin-bottom:12px;">
      <img src="${shareSrc}" alt="" />
      <div class="fb-body">
        <div class="fb-domain">${escapeHtml(prettyUrl(data.origin))}</div>
        <div class="fb-title">${escapeHtml(home.title ?? "")}</div>
        <div class="fb-desc" data-fb-desc>${escapeHtml(descOf(home))}</div>
      </div>
    </div>
    <details class="photo-picker" style="margin-bottom:26px;">
      <summary><b>Choose the photo</b> <span class="seo-default">${
        data.sharePhotoIsExplicit ? "chosen" : "currently the first homepage photo"
      }</span></summary>
      <div style="padding:0 14px 14px;">
        ${
          data.photos.length === 0
            ? `<p class="empty-note">No photos uploaded yet &mdash; add some under Photos above.</p>`
            : `<div class="site-photo-picker">${data.photos
                .map(
                  (p) => `<label class="${p.id === draft.sharePhotoId ? "on" : ""}">
                    <input type="radio" name="seo-share-photo" value="${p.id}" ${
                      p.id === draft.sharePhotoId ? "checked" : ""
                    } />
                    <img src="/photos/${p.id}/image?w=320" alt="" loading="lazy" />
                    <span class="cap">${escapeHtml(p.caption ?? "(no caption)")}</span>
                  </label>`
                )
                .join("")}</div>`
        }
      </div>
    </details>

    <h3 style="margin:0 0 4px;">What each page says in search results</h3>
    <div class="sub" style="margin-bottom:12px;">The sentence underneath the blue link. Leave a box empty to use the wording built into the site.</div>
    ${data.pages.map(pageBlock).join("")}

    <div class="btn-row" style="margin-top:6px;">
      <button type="button" class="btn btn-primary" id="seo-save">Save search settings</button>
      <span class="seo-default" id="seo-saved" style="opacity:0; transition:opacity .2s;">Saved</span>
    </div>`;

  wire();
}

function pageBlock(page) {
  const value = draft.descriptions[page.target] ?? "";
  const shown = descOf(page);
  const over = shown.length > DESC_IDEAL_MAX;
  const crumb = page.target === "/index.html" ? "" : page.target.replace(/^\/|\.html$/g, "");
  return `
      <div class="seo-page">
        <h4>${escapeHtml(page.title ?? page.target)}</h4>
        <p class="path">${escapeHtml(page.url)}</p>
        <textarea data-seo-desc="${page.target}" placeholder="${escapeHtml(page.defaultDescription)}">${escapeHtml(value)}</textarea>
        <div class="seo-meta">
          <span class="seo-count ${over ? "warn" : ""}" data-seo-count="${page.target}">${countText(shown)}</span>
          ${
            value
              ? `<button type="button" class="btn btn-ghost" data-seo-reset="${page.target}" style="padding:4px 10px; font-size:12px;">Use the built-in wording</button>`
              : `<span class="seo-default">Using the built-in wording</span>`
          }
        </div>
        <p class="seo-preview-label">How this looks in Google</p>
        <div class="snippet" style="margin-bottom:12px;">
          <div class="s-url">${escapeHtml(prettyUrl(data.origin))}${crumb ? ` <span>&rsaquo; ${escapeHtml(crumb)}</span>` : ""}</div>
          <div class="s-title">${escapeHtml(page.title ?? "")}</div>
          <div class="s-desc" data-seo-snippet="${page.target}">${escapeHtml(shown)}</div>
        </div>
        <details class="photo-picker">
          <summary><b>What search engines see</b></summary>
          <pre class="seo-readout" data-seo-readout="${page.target}">${readout(page)}</pre>
        </details>
      </div>`;
}

function countText(shown) {
  return shown.length > DESC_IDEAL_MAX
    ? `${shown.length} characters — Google will cut this off around ${DESC_IDEAL_MAX}`
    : `${shown.length} characters`;
}

function wire() {
  document.getElementById("seo-indexing").addEventListener("change", (e) => {
    draft.indexing = e.target.checked;
    render(); // the warning banner and every readout depend on it
  });

  panel.querySelectorAll("[data-seo-desc]").forEach((el) => {
    el.addEventListener("input", () => {
      const target = el.dataset.seoDesc;
      draft.descriptions[target] = el.value;
      const page = data.pages.find((p) => p.target === target);
      const shown = descOf(page);

      /* Updated in place rather than by re-rendering: rebuilding the panel on each keystroke
         would pull the focus out of the box being typed in. */
      const sel = (attr) => panel.querySelector(`[${attr}="${CSS.escape(target)}"]`);
      const count = sel("data-seo-count");
      count.textContent = countText(shown);
      count.classList.toggle("warn", shown.length > DESC_IDEAL_MAX);
      sel("data-seo-snippet").textContent = shown;
      sel("data-seo-readout").textContent = readout(page);
      if (target === data.pages[0].target) panel.querySelector("[data-fb-desc]").textContent = shown;
    });
  });

  panel.querySelectorAll("[data-seo-reset]").forEach((el) => {
    el.addEventListener("click", () => {
      draft.descriptions[el.dataset.seoReset] = "";
      render();
    });
  });

  panel.querySelectorAll('input[name="seo-share-photo"]').forEach((el) => {
    el.addEventListener("change", () => {
      draft.sharePhotoId = Number(el.value);
      data.sharePhotoIsExplicit = true;
      render();
    });
  });

  document.getElementById("seo-save").addEventListener("click", save);
}

async function save() {
  const btn = document.getElementById("seo-save");
  btn.disabled = true;
  try {
    const res = await fetch("/api/admin/seo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // An empty box means "go back to the built-in wording"; the server stores that as a
        // deleted row rather than an empty string, so the default can change later and take.
        descriptions: Object.fromEntries(
          Object.entries(draft.descriptions).map(([k, v]) => [k, v?.trim() ? v.trim() : null])
        ),
        sharePhotoId: draft.sharePhotoId,
        indexing: draft.indexing,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Could not save.");
      return;
    }
    const flag = document.getElementById("seo-saved");
    flag.style.opacity = "1";
    setTimeout(() => (flag.style.opacity = "0"), 1500);
    await load(); // re-read, so "chosen" vs "using the default" reflects what was actually stored
  } finally {
    btn.disabled = false;
  }
}

load();
