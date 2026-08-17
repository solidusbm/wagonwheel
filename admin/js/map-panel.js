/* Park map -- the editor for where everything physically is.
 *
 * This began as a standalone artifact the park used once, whose output was pasted into
 * public/js/park-layout.js by hand. That made the one piece of the site nobody could change
 * without a developer, a commit and a deploy. It now reads and writes
 * GET/PUT /api/admin/park-layout, which stores the layout as JSON in app_settings, and the guest
 * map on the homepage picks it up on the next load.
 *
 * Its own file rather than more of admin.js, and self-contained rather than importing from it.
 * admin.js is a module loaded by its own <script src>, which the asset versioner stamps with a
 * content hash; an `import` specifier inside this file is not in the HTML, so it would NOT be
 * stamped -- the browser would fetch a second, unversioned copy of admin.js and run the whole
 * thing twice. Hence the escapeHtml below rather than sharing one.
 *
 * Coordinates are REAL FEET. Origin top-left, +x east, +y south, before `bearing` -- the whole
 * block's rotation off north -- is applied. Pads are authored square and the park is turned once,
 * which is why every drag converts the pointer back into unrotated space through toLocal().
 */
function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

const host = document.getElementById("map-panel");
const SNAP = 1; // feet

let L = null; // the layout being edited
let savedJson = ""; // what the server last confirmed, for dirty detection
let kinds = {}; // FEATURE_KINDS, from the server so the list can't drift
let sel = null; // {kind:"bay"|"feature"|"road", i}
let tool = "select";
let draft = null; // road being drawn
let drag = null;
let busy = false;

/* ---------- data ---------- */

async function load() {
  const res = await fetch("/api/admin/park-layout");
  if (!res.ok) {
    host.innerHTML = `<p class="error-msg">Could not load the park map.</p>`;
    return;
  }
  const body = await res.json();
  kinds = body.kinds ?? {};
  L = body.layout;
  savedJson = JSON.stringify(L);
  chrome();
  redraw();
}

async function save() {
  if (busy) return;
  busy = true;
  status("Saving…");
  try {
    const res = await fetch("/api/admin/park-layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: L }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      status(body.error || "Could not save the map.", true);
      return;
    }
    /* Take the server's copy back, not our own. normalise() clamps sizes, drops incomplete roads
       and de-duplicates ids, so what was stored can differ from what was sent -- and the editor
       should show what guests will actually see. */
    L = body.layout;
    savedJson = JSON.stringify(L);
    sel = null;
    redraw();
    status("Saved. The guest map updates on its next load.");
  } catch {
    status("Could not reach the server.", true);
  } finally {
    busy = false;
  }
}

const dirty = () => JSON.stringify(L) !== savedJson;

function status(msg, bad) {
  const el = document.getElementById("map-status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = bad ? "var(--rust)" : "var(--cedar)";
}

/* ---------- geometry ---------- */

const centre = () => ({ x: L.world.w / 2, y: L.world.h / 2 });

function spin(p, c, deg) {
  const a = (deg * Math.PI) / 180;
  const s = Math.sin(a);
  const co = Math.cos(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
}

/** Pointer position in unrotated plan feet, which is the space every stored coordinate is in. */
function localPoint(evt) {
  const svg = document.getElementById("map-board");
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const w = pt.matrixTransform(m.inverse());
  return spin({ x: w.x, y: w.y }, centre(), -L.bearing);
}

const snap = (v) => Math.round(v / SNAP) * SNAP;

/* Where the map's own captions sit. ENTRANCE, the second way in and the street name are placed off
   the ROAD ENDS -- a gate is an end that meets no other road -- so they follow the layout instead
   of being pinned to particular roads. Deliberately the same rule as the guest map (app.js); if it
   changes, change it in both or the editor will show captions the guest map doesn't draw.

   Only their OFFSETS are stored, in labelOffsets, because the automatic placement is right until
   two captions land on each other. */
const JOIN_FT = 15; // two road ends closer than this are the same junction

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function openEnds() {
  const ends = [];
  L.roads.forEach((r, i) => {
    [r.pts[0], r.pts[r.pts.length - 1]].forEach((end) => {
      const met = L.roads.some((other, j) => {
        if (j === i) return false;
        for (let k = 1; k < other.pts.length; k++) {
          if (distToSegment(end, other.pts[k - 1], other.pts[k]) <= JOIN_FT) return true;
        }
        return false;
      });
      if (!met) ends.push(end);
    });
  });
  return ends.sort((a, b) => a.y - b.y);
}

/** Read a caption's nudge without creating it. */
const readOffset = (key) =>
  (key === "street" ? L.labelOffsets?.street : L.labelOffsets?.gates?.[key]) ?? { dx: 0, dy: 0 };

/** The same, but ready to be written to -- fills the gates array out to the index if need be. */
function editOffset(key) {
  if (!L.labelOffsets) L.labelOffsets = { gates: [], street: { dx: 0, dy: 0 } };
  if (key === "street") {
    if (!L.labelOffsets.street) L.labelOffsets.street = { dx: 0, dy: 0 };
    return L.labelOffsets.street;
  }
  if (!Array.isArray(L.labelOffsets.gates)) L.labelOffsets.gates = [];
  while (L.labelOffsets.gates.length <= Number(key)) L.labelOffsets.gates.push({ dx: 0, dy: 0 });
  return L.labelOffsets.gates[Number(key)];
}

/** Every caption on the map, with where it currently sits. One list, so drawing and the
 *  properties panel can never disagree about which caption is which. */
function mapLabels() {
  const gates = openEnds();
  const out = gates.map((g, i) => {
    const first = i === 0;
    const o = readOffset(i);
    return {
      key: String(i),
      text: first ? "ENTRANCE" : "SECOND ACCESS",
      x: g.x + (first ? 4 : 6) + o.dx,
      y: g.y + (first ? -24 : 8) + o.dy,
      size: first ? 13 : 11,
      anchor: first ? "end" : "start",
      tilt: -L.bearing,
      fill: first ? "var(--gold)" : "var(--parchment-dim)",
    };
  });
  if (gates.length) {
    const o = readOffset("street");
    out.push({
      key: "street",
      text: "POLLY PEAK DR.",
      x: Math.max(...gates.map((g) => g.x)) + 96 + o.dx,
      y: gates.reduce((sum, g) => sum + g.y, 0) / gates.length + o.dy,
      size: 11,
      anchor: "middle",
      tilt: -L.bearing - 90,
      fill: "var(--parchment-dim)",
    });
  }
  return out;
}

/* ---------- chrome (built once) ---------- */

function chrome() {
  const kindOptions = Object.entries(kinds)
    .map(([k, spec]) => `<option value="${escapeHtml(k)}">${escapeHtml(spec.label)}</option>`)
    .join("");

  host.innerHTML = `
    <div class="map-toolbar">
      <button type="button" class="btn btn-ghost" id="map-tool-select" aria-pressed="true">Select</button>
      <button type="button" class="btn btn-ghost" id="map-tool-road" aria-pressed="false">Draw road</button>
      <span class="map-sep"></span>
      <button type="button" class="btn btn-ghost" id="map-add-site">+ Site</button>
      <select id="map-kind">${kindOptions}</select>
      <button type="button" class="btn btn-ghost" id="map-add-feature">+ Building</button>
      <span class="map-sep"></span>
      <button type="button" class="btn btn-primary" id="map-save">Save map</button>
      <button type="button" class="btn btn-ghost" id="map-revert">Revert</button>
    </div>
    <p id="map-status" class="map-status"></p>
    <div class="map-board-wrap">
      <div class="map-canvas"><svg id="map-board" xmlns="http://www.w3.org/2000/svg"></svg></div>
      <div class="map-side">
        <div class="map-card">
          <h3>Selected</h3>
          <div id="map-props"><p class="empty-note">Nothing selected. Click a pad, a building or a road.</p></div>
        </div>
        <div class="map-card">
          <h3>Whole park</h3>
          <div class="map-rows">
            <label for="map-bearing">Bearing °</label><input type="number" id="map-bearing" step="1" />
            <label for="map-world-w">Lot width ft</label><input type="number" id="map-world-w" step="10" />
            <label for="map-world-h">Lot depth ft</label><input type="number" id="map-world-h" step="10" />
          </div>
          <p class="map-hint">Bearing turns the whole block at once, so pads stay square while you work.</p>
        </div>
      </div>
    </div>
    <p class="map-hint">
      <b>Move</b> — drag a pad, building or road point. <b>Resize</b> — drag the corner square.
      <b>Nudge</b> — arrow keys by 1&nbsp;ft, hold Shift for 10. <b>Delete</b> — select and press
      Delete. <b>Finish a road</b> — press Enter or double-click.
      <b>Captions</b> — drag ENTRANCE, SECOND ACCESS or the street name to stop them overlapping.
      Nothing reaches the guest map until you press <b>Save map</b>.
    </p>
  `;

  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on("map-tool-select", "click", () => setTool("select"));
  on("map-tool-road", "click", () => setTool("road"));
  on("map-add-site", "click", addSite);
  on("map-add-feature", "click", addFeature);
  on("map-save", "click", save);
  on("map-revert", "click", () => {
    L = JSON.parse(savedJson);
    sel = null;
    draft = null;
    redraw();
    status("Back to the last saved map.");
  });

  const worldNum = (id, set) =>
    on(id, "input", (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isNaN(v)) return;
      set(v);
      redraw();
    });
  worldNum("map-bearing", (v) => (L.bearing = v));
  worldNum("map-world-w", (v) => (L.world.w = Math.max(60, v)));
  worldNum("map-world-h", (v) => (L.world.h = Math.max(60, v)));

  const svg = document.getElementById("map-board");
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("dblclick", () => tool === "road" && finishRoad());
  document.addEventListener("keydown", onKey);
}

/* ---------- adding ---------- */

/** Lowest unused positive number, so deleting Site 7 and adding one gives 7 back rather than 13. */
function nextSiteNumber() {
  const used = new Set(L.bays.map((b) => b.n));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

function addSite() {
  const n = nextSiteNumber();
  // Dropped near the middle of the lot rather than at the origin, so it lands somewhere visible
  // and gets dragged into place instead of being hunted for behind the grid label.
  const c = centre();
  L.bays.push({ n, x: Math.round(c.x - 10), y: Math.round(c.y - 27), w: 20, h: 55, rot: 0 });
  sel = { kind: "bay", i: L.bays.length - 1 };
  redraw();
  status(`Site ${n} added to the map. Drag it into place, then Save.`);
}

function addFeature() {
  const kind = document.getElementById("map-kind").value;
  const spec = kinds[kind] ?? { label: "Building", w: 30, h: 24 };
  const c = centre();
  const id = `${kind}-${Date.now().toString(36)}`;
  L.features.push({
    id,
    kind,
    label: spec.label,
    x: Math.round(c.x - spec.w / 2),
    y: Math.round(c.y - spec.h / 2),
    w: spec.w,
    h: spec.h,
    rot: 0,
  });
  sel = { kind: "feature", i: L.features.length - 1 };
  redraw();
  status(`${spec.label} added. Drag it into place, then Save.`);
}

function deleteSelected() {
  if (!sel) return;
  // A caption isn't a thing you can remove -- its wording comes from the layout. "Put it back"
  // is the only reset it has.
  if (sel.kind === "label") return;
  if (sel.kind === "road") {
    L.roads.splice(sel.i, 1);
    status("Road removed.");
  } else if (sel.kind === "feature") {
    const [gone] = L.features.splice(sel.i, 1);
    status(`${gone.label} removed.`);
  } else {
    const [gone] = L.bays.splice(sel.i, 1);
    /* Removing a pad from the MAP does not delete the site itself -- that lives in the sites
       table and is edited in the Sites section. The guest map draws any site it can't place in a
       "not on the plan yet" row underneath, so the site stays bookable either way. */
    status(`Site ${gone.n} taken off the map. The site itself is untouched.`);
  }
  sel = null;
  redraw();
}

/* ---------- drawing ---------- */

// Keyed on the drawing, not the place -- see FEATURE_KINDS in server/lib/parkLayout.js.
const FEATURE_STYLE = {
  fenced: { stroke: "var(--cedar)", fill: "none", dash: "6 4" },
};
const FEATURE_STYLE_DEFAULT = { stroke: "var(--gold)", fill: "var(--bg-panel)", dash: "" };

function grid() {
  let out = "";
  for (let x = 0; x <= L.world.w; x += 10) {
    const major = x % 50 === 0;
    out += `<line x1="${x}" y1="0" x2="${x}" y2="${L.world.h}" stroke="var(--line)" stroke-width="${major ? 0.7 : 0.3}" opacity="${major ? 0.8 : 0.45}"/>`;
  }
  for (let y = 0; y <= L.world.h; y += 10) {
    const major = y % 50 === 0;
    out += `<line x1="0" y1="${y}" x2="${L.world.w}" y2="${y}" stroke="var(--line)" stroke-width="${major ? 0.7 : 0.3}" opacity="${major ? 0.8 : 0.45}"/>`;
  }
  return out;
}

const handle = (b) =>
  `<rect class="map-handle" data-handle="1" x="${b.x + b.w - 3}" y="${b.y + b.h - 3}" width="6" height="6"/>`;

/* The visible area. NOT just the lot rectangle: the park is drawn rotated on an unrotated grid,
   and the access roads deliberately run off the lot to reach the street -- so "0 0 w h" clipped the
   entrance captions at the edge. That was survivable while they were scenery and is not now they
   are things you drag. */
function viewBox() {
  const c = centre();
  const pts = [
    { x: 0, y: 0 },
    { x: L.world.w, y: 0 },
    { x: L.world.w, y: L.world.h },
    { x: 0, y: L.world.h },
  ];
  const corners = (b) => {
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    return [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
    ].map((p) => spin(spin(p, { x: bx, y: by }, b.rot || 0), c, L.bearing));
  };
  [...L.bays, ...L.features].forEach((b) => pts.push(...corners(b)));
  L.roads.forEach((r) => {
    const half = r.w / 2;
    r.pts.forEach((p) => {
      const q = spin(p, c, L.bearing);
      pts.push({ x: q.x - half, y: q.y - half }, { x: q.x + half, y: q.y + half });
    });
  });
  mapLabels().forEach((lb) => {
    const w = Math.max(12, lb.text.length * lb.size * 0.62);
    const q = spin({ x: lb.x, y: lb.y }, c, L.bearing);
    pts.push({ x: q.x - w, y: q.y - w }, { x: q.x + w, y: q.y + w });
  });

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 10;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return `${minX} ${minY} ${Math.max(...xs) + pad - minX} ${Math.max(...ys) + pad - minY}`;
}

function redraw() {
  const svg = document.getElementById("map-board");
  if (!svg) return;
  const c = centre();
  let park = "";

  L.roads.forEach((r, i) => {
    const d = r.pts.map((p, k) => `${k ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    const on = sel?.kind === "road" && sel.i === i;
    park += `<path class="map-road${on ? " sel" : ""}" data-road="${i}" d="${d}" stroke-width="${r.w}"/>`;
    if (on) {
      r.pts.forEach((p, k) => {
        park += `<circle class="map-vtx" data-road="${i}" data-vtx="${k}" cx="${p.x}" cy="${p.y}" r="4"/>`;
      });
    }
  });

  L.features.forEach((f, i) => {
    const st = FEATURE_STYLE[f.kind] ?? FEATURE_STYLE_DEFAULT;
    const on = sel?.kind === "feature" && sel.i === i;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    // Same rule as the guest map: a caption that can't be read inside its box goes under it.
    const fitted = f.label ? (f.w - 6) / (f.label.length * 0.62) : 0;
    const inside = fitted >= 7.5;
    const size = inside ? Math.min(10, fitted) : 7.5;
    const ty = inside ? cy + size / 2.6 : f.y + f.h + size * 1.2;
    park +=
      `<g class="map-feature${on ? " sel" : ""}" data-feature="${i}" transform="rotate(${f.rot} ${cx} ${cy})">` +
      `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="2" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${on ? 3 : 2}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""}/>` +
      `<text x="${cx}" y="${ty}" font-size="${size}" fill="${st.stroke}" text-anchor="middle" stroke="var(--bg)" stroke-width="${size / 4}" paint-order="stroke" stroke-linejoin="round" transform="rotate(${-f.rot - L.bearing} ${cx} ${cy})">${escapeHtml(f.label)}</text>` +
      (on ? handle(f) : "") +
      `</g>`;
  });

  L.bays.forEach((b, i) => {
    const on = sel?.kind === "bay" && sel.i === i;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    park +=
      `<g class="map-bay${on ? " sel" : ""}" data-bay="${i}" transform="rotate(${b.rot} ${cx} ${cy})">` +
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="1.5"/>` +
      `<text x="${cx}" y="${cy + 5}" font-size="14" transform="rotate(${-b.rot - L.bearing} ${cx} ${cy})">${b.n}</text>` +
      (on ? handle(b) : "") +
      `</g>`;
  });

  /* The captions, drawn last so they sit on top of everything and stay grabbable. Each carries a
     transparent hit rectangle: glyphs alone are a thin target, and this has to be draggable with a
     thumb on a phone at the park. */
  mapLabels().forEach((lb) => {
    const on = sel?.kind === "label" && sel.key === lb.key;
    const w = Math.max(12, lb.text.length * lb.size * 0.62);
    const x0 = lb.anchor === "end" ? lb.x - w : lb.anchor === "middle" ? lb.x - w / 2 : lb.x;
    park +=
      `<g class="map-label${on ? " sel" : ""}" data-label="${lb.key}" ` +
      `transform="rotate(${lb.tilt} ${lb.x} ${lb.y})">` +
      `<rect x="${x0 - 3}" y="${lb.y - lb.size}" width="${w + 6}" height="${lb.size * 1.5}" ` +
      `fill="transparent"/>` +
      `<text x="${lb.x}" y="${lb.y}" font-size="${lb.size}" text-anchor="${lb.anchor}" ` +
      `fill="${on ? "var(--gold-bright)" : lb.fill}" letter-spacing="0.6">${escapeHtml(lb.text)}</text>` +
      `</g>`;
  });

  if (draft?.pts.length) {
    const d = draft.pts.map((p, k) => `${k ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    park += `<path d="${d}" stroke="var(--gold)" stroke-width="${draft.w}" fill="none" opacity="0.5" stroke-linecap="round"/>`;
  }

  svg.setAttribute("viewBox", viewBox());
  svg.innerHTML =
    `<rect x="0" y="0" width="${L.world.w}" height="${L.world.h}" fill="var(--bg)"/>${grid()}` +
    `<g transform="rotate(${L.bearing} ${c.x} ${c.y})">${park}</g>`;
  svg.classList.toggle("road-mode", tool === "road");

  document.getElementById("map-bearing").value = L.bearing;
  document.getElementById("map-world-w").value = L.world.w;
  document.getElementById("map-world-h").value = L.world.h;
  document.getElementById("map-save").textContent = dirty() ? "Save map •" : "Save map";
  props();
}

/* ---------- selected-item panel ---------- */

const numField = (id, label, value) =>
  `<label for="${id}">${label}</label><input type="number" id="${id}" step="1" value="${Math.round(value * 10) / 10}" />`;

function bindNum(id, set) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    if (Number.isNaN(v)) return;
    set(v);
    redraw();
  });
}

function props() {
  const box = document.getElementById("map-props");
  if (!sel) {
    box.innerHTML = `<p class="empty-note">Nothing selected. Click a pad, a building or a road.</p>`;
    return;
  }

  if (sel.kind === "label") {
    const lb = mapLabels().find((l) => l.key === sel.key);
    if (!lb) {
      sel = null;
      box.innerHTML = `<p class="empty-note">That caption has gone — the roads changed.</p>`;
      return;
    }
    const off = editOffset(sel.key);
    box.innerHTML =
      `<p class="map-selname">${escapeHtml(lb.text)}</p>` +
      `<div class="map-rows">${numField("map-ldx", "Move right ft", off.dx)}${numField("map-ldy", "Move down ft", off.dy)}</div>` +
      `<button type="button" class="btn btn-ghost" id="map-lreset">Put it back</button>` +
      `<p class="map-hint">Drag it on the map, or type exact figures. The wording itself comes from the ` +
      `layout — this only moves it, so two captions stop sitting on each other.</p>`;
    bindNum("map-ldx", (v) => (off.dx = v));
    bindNum("map-ldy", (v) => (off.dy = v));
    document.getElementById("map-lreset").addEventListener("click", () => {
      off.dx = 0;
      off.dy = 0;
      redraw();
      status("Caption back where it started.");
    });
    return;
  }

  if (sel.kind === "road") {
    const r = L.roads[sel.i];
    box.innerHTML =
      `<div class="map-rows">${numField("map-rw", "Width ft", r.w)}</div>` +
      `<button type="button" class="btn btn-ghost" id="map-del">Remove road</button>`;
    bindNum("map-rw", (v) => (r.w = Math.max(4, v)));
    document.getElementById("map-del").addEventListener("click", deleteSelected);
    return;
  }

  const isFeature = sel.kind === "feature";
  const it = isFeature ? L.features[sel.i] : L.bays[sel.i];
  const title = isFeature ? it.label : `Site ${it.n}`;

  box.innerHTML =
    `<p class="map-selname">${escapeHtml(title)}</p>` +
    (isFeature
      ? `<div class="map-rows"><label for="map-label">Name</label><input type="text" id="map-label" value="${escapeHtml(it.label)}" maxlength="60" />` +
        `<label for="map-kind-sel">Draw as</label><select id="map-kind-sel">` +
        Object.entries(kinds)
          .map(([k, spec]) => `<option value="${escapeHtml(k)}"${k === it.kind ? " selected" : ""}>${escapeHtml(spec.label)}</option>`)
          .join("") +
        `</select></div>`
      : `<div class="map-rows">${numField("map-n", "Site number", it.n)}</div>`) +
    `<div class="map-rows">` +
    numField("map-x", "Left ft", it.x) +
    numField("map-y", "Top ft", it.y) +
    numField("map-w", "Width ft", it.w) +
    numField("map-h", "Depth ft", it.h) +
    numField("map-rot", "Turn °", it.rot) +
    `</div>` +
    (isFeature ? "" : `<button type="button" class="btn btn-ghost" id="map-all">Use this size for every pad</button>`) +
    `<button type="button" class="btn btn-ghost" id="map-del">${isFeature ? "Remove building" : "Take off the map"}</button>`;

  bindNum("map-x", (v) => (it.x = v));
  bindNum("map-y", (v) => (it.y = v));
  bindNum("map-w", (v) => (it.w = Math.max(3, v)));
  bindNum("map-h", (v) => (it.h = Math.max(3, v)));
  bindNum("map-rot", (v) => (it.rot = v));
  if (!isFeature) bindNum("map-n", (v) => (it.n = Math.max(1, Math.round(v))));

  const label = document.getElementById("map-label");
  if (label) {
    label.addEventListener("input", () => {
      it.label = label.value;
      redraw();
      // Redrawing rebuilds this panel, so put the caret back where the typist left it.
      const again = document.getElementById("map-label");
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    });
  }

  /* Changing the type of an existing feature. Without this, adding one as the wrong kind meant
     deleting and re-adding it -- which is exactly what happened to the park's two dog parks. */
  const kindSel = document.getElementById("map-kind-sel");
  if (kindSel) {
    kindSel.addEventListener("change", () => {
      it.kind = kindSel.value;
      redraw();
      status(`Now drawn as a ${(kinds[it.kind]?.label ?? it.kind).toLowerCase()}.`);
    });
  }

  const all = document.getElementById("map-all");
  if (all) {
    all.addEventListener("click", () => {
      L.bays.forEach((b) => {
        b.w = it.w;
        b.h = it.h;
      });
      redraw();
      status(`Every pad set to ${it.w} × ${it.h} ft.`);
    });
  }
  document.getElementById("map-del").addEventListener("click", deleteSelected);
}

/* ---------- pointer ---------- */

function onPointerDown(evt) {
  const p = localPoint(evt);

  if (tool === "road") {
    if (!draft) draft = { w: 24, pts: [] };
    draft.pts.push({ x: snap(p.x), y: snap(p.y) });
    redraw();
    return;
  }

  const svg = document.getElementById("map-board");
  const t = evt.target;
  const vtx = t.getAttribute?.("data-vtx");
  const lb = t.closest?.("[data-label]");
  if (lb) {
    const key = lb.getAttribute("data-label");
    const off = editOffset(key);
    sel = { kind: "label", key };
    drag = { mode: "label", off, ox: p.x, oy: p.y, dx0: off.dx, dy0: off.dy };
    svg.setPointerCapture(evt.pointerId);
    redraw();
    return;
  }

  const g = t.closest?.("[data-bay],[data-feature],[data-road]");

  if (t.getAttribute?.("data-handle") && sel && sel.kind !== "road") {
    const it = sel.kind === "feature" ? L.features[sel.i] : L.bays[sel.i];
    drag = { mode: "resize", it, ox: p.x, oy: p.y, w0: it.w, h0: it.h };
    svg.setPointerCapture(evt.pointerId);
    return;
  }
  if (vtx !== null && vtx !== undefined && vtx !== "") {
    const ri = Number(t.getAttribute("data-road"));
    drag = { mode: "vtx", pt: L.roads[ri].pts[Number(vtx)] };
    svg.setPointerCapture(evt.pointerId);
    return;
  }
  if (!g) {
    sel = null;
    redraw();
    return;
  }

  if (g.hasAttribute("data-road")) {
    sel = { kind: "road", i: Number(g.getAttribute("data-road")) };
    redraw();
    return;
  }
  const isFeature = g.hasAttribute("data-feature");
  const i = Number(g.getAttribute(isFeature ? "data-feature" : "data-bay"));
  sel = { kind: isFeature ? "feature" : "bay", i };
  const it = isFeature ? L.features[i] : L.bays[i];
  drag = { mode: "move", it, ox: p.x, oy: p.y, x0: it.x, y0: it.y };
  svg.setPointerCapture(evt.pointerId);
  redraw();
}

function onPointerMove(evt) {
  if (!drag) return;
  const p = localPoint(evt);
  if (drag.mode === "move") {
    drag.it.x = snap(drag.x0 + (p.x - drag.ox));
    drag.it.y = snap(drag.y0 + (p.y - drag.oy));
  } else if (drag.mode === "label") {
    drag.off.dx = snap(drag.dx0 + (p.x - drag.ox));
    drag.off.dy = snap(drag.dy0 + (p.y - drag.oy));
  } else if (drag.mode === "resize") {
    drag.it.w = Math.max(3, snap(drag.w0 + (p.x - drag.ox)));
    drag.it.h = Math.max(3, snap(drag.h0 + (p.y - drag.oy)));
  } else {
    drag.pt.x = snap(p.x);
    drag.pt.y = snap(p.y);
  }
  redraw();
}

function endDrag() {
  if (!drag) return;
  drag = null;
  redraw();
}

function finishRoad() {
  if (draft && draft.pts.length > 1) {
    L.roads.push(draft);
    status("Road added.");
  }
  draft = null;
  redraw();
}

function setTool(t) {
  tool = t;
  if (t !== "road") draft = null;
  document.getElementById("map-tool-select").setAttribute("aria-pressed", String(t === "select"));
  document.getElementById("map-tool-road").setAttribute("aria-pressed", String(t === "road"));
  status(t === "road" ? "Click to drop points. Enter or double-click to finish." : "");
  redraw();
}

function onKey(evt) {
  // The whole admin page shares this listener, so ignore anything typed into a field -- including
  // the Sites editor's, which is why this checks the target rather than a panel flag.
  const tag = (evt.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (!L || !host.offsetParent) return; // panel collapsed or not loaded

  if (evt.key === "Enter" && tool === "road") return finishRoad();
  if (evt.key === "Escape") {
    draft = null;
    sel = null;
    return redraw();
  }
  if (evt.key === "Delete" || evt.key === "Backspace") {
    if (!sel) return;
    evt.preventDefault();
    return deleteSelected();
  }
  if (!sel || sel.kind === "road") return;
  if (sel.kind === "label") {
    const off = editOffset(sel.key);
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[evt.key];
    if (!d) return;
    evt.preventDefault();
    const step = evt.shiftKey ? 10 : 1;
    off.dx += d[0] * step;
    off.dy += d[1] * step;
    return redraw();
  }

  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[evt.key];
  if (!d) return;
  evt.preventDefault();
  const step = evt.shiftKey ? 10 : 1;
  const it = sel.kind === "feature" ? L.features[sel.i] : L.bays[sel.i];
  it.x += d[0] * step;
  it.y += d[1] * step;
  redraw();
}

/* Leaving with unsaved geometry loses it -- there is no draft on the server and, unlike the
   standalone editor this replaced, no localStorage copy either. */
window.addEventListener("beforeunload", (e) => {
  if (L && dirty()) e.preventDefault();
});

load();
