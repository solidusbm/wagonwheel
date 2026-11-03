/* The park's guest application, described once.
 *
 * Three things render this data and they must not disagree: the booking form a guest fills in
 * (public/index.html), the editor in /admin, and the printable sheet. The booking form is still
 * hand-written HTML -- it predates this file -- but the editor and the print sheet are both
 * generated from here, so adding a field to the application means adding one entry below and
 * nothing else. If you ever regenerate the public form, do it from this file too.
 *
 * `path` is the key inside its section's object. Section shapes mirror what buildApplication()
 * in public/js/app.js produces, and that shape is what's stored in reservations.application_details:
 *
 *   { dob, driversLicense:{number,state},
 *     spouse: null | {name, dob, phone, driversLicense:{number,state}},
 *     occupants: [{name, age, relationship}],
 *     vehicles: [{make, model, year, plate}],
 *     rv: null | {make, model, year, length, width, slides, plate, amp, rvClass, trailerType},
 *     pets: [{type, name, color, weight, age, gender, spayedNeutered, rabiesVaccine}] }
 *
 * The paper form's prior-residence / landlord-reference and background-check questions were
 * struck out by the park on the original and are deliberately NOT collected. Don't add them back
 * without being asked.
 */

// `rows` is how many blank rows a list section prints when empty -- enough to be worth writing on.
export const APPLICATION_SECTIONS = [
  {
    key: "applicant",
    title: "Applicant",
    kind: "object",
    fields: [
      { path: "dob", label: "Date of birth", type: "date" },
      { path: "driversLicense.number", label: "Driver's license #" },
      { path: "driversLicense.state", label: "State", maxlength: 2, width: "narrow" },
    ],
  },
  {
    key: "spouse",
    title: "Spouse / co-applicant",
    kind: "object",
    // The booking form never asks for the co-applicant's licence STATE -- it hardcodes null. It's
    // here so the office can fill it in later, on screen or on paper. That gap is the reason the
    // printable sheet exists.
    fields: [
      { path: "name", label: "Full name" },
      { path: "dob", label: "Date of birth", type: "date" },
      { path: "phone", label: "Phone", type: "tel" },
      { path: "driversLicense.number", label: "License #" },
      { path: "driversLicense.state", label: "State", maxlength: 2, width: "narrow" },
    ],
  },
  {
    key: "occupants",
    title: "Additional occupants",
    kind: "list",
    rows: 3,
    fields: [
      { path: "name", label: "Name" },
      { path: "age", label: "Age", width: "narrow" },
      { path: "relationship", label: "Relationship" },
    ],
  },
  {
    key: "vehicles",
    title: "Vehicles (not counting the RV)",
    kind: "list",
    rows: 2,
    fields: [
      { path: "make", label: "Make" },
      { path: "model", label: "Model" },
      { path: "year", label: "Year", width: "narrow" },
      { path: "plate", label: "Plate" },
    ],
  },
  {
    key: "rv",
    title: "RV",
    kind: "object",
    fields: [
      { path: "make", label: "Make" },
      { path: "model", label: "Model" },
      { path: "year", label: "Year", width: "narrow" },
      { path: "length", label: "Length (ft)", width: "narrow" },
      { path: "width", label: "Width (ft)", width: "narrow" },
      { path: "slides", label: "Slides", width: "narrow" },
      { path: "plate", label: "Plate" },
      { path: "amp", label: "Amp", options: ["30", "50"], width: "narrow" },
      { path: "rvClass", label: "Class", options: ["A", "B", "C"], width: "narrow" },
      { path: "trailerType", label: "Trailer type", options: ["Bumper Pull", "Fifth Wheel"] },
    ],
  },
  {
    key: "pets",
    title: "Pets",
    kind: "list",
    rows: 2,
    fields: [
      { path: "type", label: "Type & breed" },
      { path: "name", label: "Name" },
      { path: "color", label: "Color" },
      { path: "weight", label: "Weight", width: "narrow" },
      { path: "age", label: "Age", width: "narrow" },
      { path: "gender", label: "Gender", width: "narrow" },
      { path: "spayedNeutered", label: "Spayed/neutered", options: ["Yes", "No"], width: "narrow" },
      { path: "rabiesVaccine", label: "Rabies current", options: ["Yes", "No"], width: "narrow" },
    ],
  },
];

/* A dotted path reader/writer, so "driversLicense.number" works as a single field key. get()
   tolerates a missing branch (an application saved before a field existed, or a null spouse);
   set() creates the branch on the way down. */
export function get(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function set(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let node = obj;
  for (const k of keys) {
    if (node[k] == null || typeof node[k] !== "object") node[k] = {};
    node = node[k];
  }
  node[last] = value;
  return obj;
}

// True when every field in a row/object is blank -- used to drop empty rows on save rather than
// storing a list of nulls, and to decide whether a section is worth showing as "filled in".
export function isBlank(record, fields) {
  return fields.every((f) => {
    const v = get(record, f.path);
    return v === null || v === undefined || String(v).trim() === "";
  });
}

/* Normalises whatever came out of the form into the exact shape buildApplication() produces, so a
   record edited in /admin is indistinguishable from one a guest submitted. Empty strings become
   null (the booking form's val() does the same), empty rows are dropped, and a section with
   nothing in it becomes null rather than an object full of nulls. */
export function normalise(draft) {
  const clean = (v) => {
    const s = v === null || v === undefined ? "" : String(v).trim();
    return s === "" ? null : s;
  };
  const cleanRecord = (rec, fields) => {
    const out = {};
    for (const f of fields) set(out, f.path, clean(get(rec, f.path)));
    return out;
  };
  const section = (key) => APPLICATION_SECTIONS.find((s) => s.key === key);

  const applicant = cleanRecord(draft.applicant ?? {}, section("applicant").fields);
  const spouseRec = cleanRecord(draft.spouse ?? {}, section("spouse").fields);
  const rvRec = cleanRecord(draft.rv ?? {}, section("rv").fields);

  const list = (key) =>
    (draft[key] ?? [])
      .map((r) => cleanRecord(r, section(key).fields))
      .filter((r) => !isBlank(r, section(key).fields));

  return {
    dob: applicant.dob,
    driversLicense: applicant.driversLicense,
    // A co-applicant with no name isn't a co-applicant. Matches buildApplication().
    spouse: spouseRec.name ? spouseRec : null,
    occupants: list("occupants"),
    vehicles: list("vehicles"),
    // Same rule the booking form uses: an RV is recorded once it has a make or a model.
    rv: rvRec.make || rvRec.model ? rvRec : null,
    pets: list("pets"),
  };
}

/* Pulls the stored record apart into the per-section shape the editor and the print sheet work
   with. The inverse of normalise(). */
export function toDraft(app) {
  const a = app ?? {};
  return {
    applicant: { dob: a.dob ?? null, driversLicense: a.driversLicense ?? {} },
    spouse: a.spouse ?? {},
    occupants: Array.isArray(a.occupants) ? a.occupants : [],
    vehicles: Array.isArray(a.vehicles) ? a.vehicles : [],
    rv: a.rv ?? {},
    pets: Array.isArray(a.pets) ? a.pets : [],
  };
}
