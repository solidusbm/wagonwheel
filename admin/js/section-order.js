/* Lets the office reorder the collapsible sections below Reservations (Sites, Photos, Amenities,
 * etc.) and remembers it. Arrows, not drag-and-drop -- same reasoning as the photo grid: this page
 * gets run one-handed on a phone at the park, where dragging a tile inside a scrolling page is a
 * fight. The order is persisted server-side (PUT /api/admin/section-order) so it's the same on
 * every device, not a per-browser localStorage guess.
 *
 * The arrows are built here rather than hand-duplicated in every <summary> in index.html -- one
 * place to change if the markup or labels ever need to change. Reordering moves the live <details>
 * nodes with before()/after(), never re-renders them, so an open panel (mid-edit form state,
 * scroll position) survives a reorder of a different section untouched.
 */

const SECTIONS_SELECTOR = ".sync-feeds[data-section]";

function getSections() {
  return Array.from(document.querySelectorAll(SECTIONS_SELECTOR));
}

function currentOrder() {
  return getSections().map((el) => el.dataset.section);
}

function updateButtonStates() {
  const sections = getSections();
  sections.forEach((el, i) => {
    const up = el.querySelector('.section-move[data-dir="up"]');
    const down = el.querySelector('.section-move[data-dir="down"]');
    if (up) up.disabled = i === 0;
    if (down) down.disabled = i === sections.length - 1;
  });
}

function addControls() {
  for (const section of getSections()) {
    const summary = section.querySelector("summary");
    if (!summary || summary.querySelector(".section-reorder")) continue;
    const wrap = document.createElement("span");
    wrap.className = "section-reorder";
    for (const [dir, label, glyph] of [
      ["up", "Move this section up", "▲"],
      ["down", "Move this section down", "▼"],
    ]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "section-move";
      btn.dataset.dir = dir;
      btn.textContent = glyph;
      btn.setAttribute("aria-label", label);
      // Clicking anywhere in a <summary> otherwise toggles the <details> open/closed --
      // preventDefault cancels that (it's the click event's default action), stopPropagation
      // keeps it from also reaching any other click handling on the summary.
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        moveSection(section, dir);
      });
      wrap.appendChild(btn);
    }
    summary.appendChild(wrap);
  }
}

function moveSection(section, dir) {
  const sections = getSections();
  const idx = sections.indexOf(section);
  const target = dir === "up" ? sections[idx - 1] : sections[idx + 1];
  if (!target) return;
  if (dir === "up") target.before(section);
  else target.after(section);
  updateButtonStates();
  persistOrder();
}

function applyOrder(order) {
  const byKey = new Map(getSections().map((el) => [el.dataset.section, el]));
  let ref = document.getElementById("admin-content");
  for (const key of order) {
    const el = byKey.get(key);
    if (!el) continue; // an unrecognised key from a stale save -- ignore, don't throw
    ref.after(el);
    ref = el;
  }
}

let saveTimer = null;
function persistOrder() {
  // Debounced: a user tapping an arrow several times in a row shouldn't fire a request per tap.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch("/api/admin/section-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: currentOrder() }),
      });
    } catch {
      // Best-effort. The new order still holds on screen for this session even if the save
      // failed to reach the server -- it'll just revert on the next page load.
    }
  }, 400);
}

(async function init() {
  addControls();
  updateButtonStates();
  try {
    const res = await fetch("/api/admin/section-order");
    const { order } = await res.json();
    if (Array.isArray(order) && order.length) {
      applyOrder(order);
      updateButtonStates();
    }
  } catch {
    // Keep the page's built-in HTML order.
  }
})();
