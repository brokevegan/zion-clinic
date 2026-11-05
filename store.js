/* The clinic's records on this phone: the copy from the computer (base) plus the changes made here
   since the last sync (ops). The screens and reports are worked out from those two, the same way the
   computer program does it, so both give the same answers. */
"use strict";

const CLINIC_NAME = "Zion Clinic", PATIENTS = "Patients", DEFAULT_FEE = 5000;
const NOT_RECORDED = "Not recorded", NOT_MAPPED = "Other (not in the map)";
const PHOTO_TABLE = {receipt: "phone_receipts", tally: "imm_photos", cash: "cash_photos"};

const Clinic = {
  base: null, ops: [], t: {}, by: {}, people: [], hidden: new Set(), extra: [], dx: new Map(), nextId: 1e9, D: null,
  has() { return !!this.base; },

  load() {
    let raw = null;
    try { raw = readBig("base"); this.base = raw ? JSON.parse(raw) : null; } catch (e) { this.base = null; }
    if (FINANCE && this.base && !this.base.money_only) { moneyOnly(this.base); writeFile("base", JSON.stringify(this.base)); }
    try { this.ops = JSON.parse(readBig("changes") || "[]"); } catch (e) { this.ops = []; }
    this.rebuild();
  },

  /* Plain tables from the base copy, with this phone's changes applied on top. */
  rebuild() {
    this.t = {}; this.by = {}; this.D = null; this.nextId = 1e9;
    const b = this.base;
    for (const name of ["invoices", "ledger", "immunisations", "eye_patients", "hiv_tests", "phone_receipts", "imm_photos", "cash_photos"]) {
      const tb = b && b.tables && b.tables[name];
      const rows = tb ? tb.rows.map(r => { const o = {}; tb.cols.forEach((c, i) => { o[c] = r[i]; }); return o; }) : [];
      this.t[name] = rows;
      this.by[name] = new Map(rows.map(r => [r.uid, r]));
    }
    this.people = b ? b.people.map(p => ({name: p[0], role: p[1], type: p[2]})) : [];
    this.hidden = new Set(b ? b.hidden_names : []);
    this.extra = b ? b.imm_extra.slice() : [];
    this.dx = new Map(b ? b.dx_map.map(m => [m[0], [m[1], m[2]]]) : []);
    this.ledgerPhotos = b ? Object.assign({}, b.ledger_photos) : {};
    for (const op of this.ops) this.applyLocal(op);
  },

  persist() { writeFile("changes", JSON.stringify(this.ops)); },

  applyLocal(op) {
    if (op.op === "save") {
      this.putRow(op.table, op.uid, op.fields);
      if (op.table === "ledger" && op.fields.receipt_uid) this.ledgerPhotos[op.uid] = op.fields.receipt_uid;
    }
    else if (op.op === "photo") this.putRow(PHOTO_TABLE[op.kind], op.uid, op.fields);
    else if (op.op === "delete") {
      const row = this.by[op.table].get(op.uid);
      if (row) {
        this.t[op.table].splice(this.t[op.table].indexOf(row), 1);
        this.by[op.table].delete(op.uid);
      }
    } else if (op.op === "person_save") {
      const old = (op.old_name || op.name).toLowerCase();
      this.people = this.people.filter(p => p.name.toLowerCase() !== old && p.name.toLowerCase() !== op.name.toLowerCase());
      this.people.push({name: op.name, role: op.role || "", type: op.type || "Other"});
      this.people.sort((x, y) => personOrder(x) - personOrder(y) || x.name.toLowerCase().localeCompare(y.name.toLowerCase()));
      this.hidden.delete(op.name.toLowerCase());
    } else if (op.op === "person_delete") {
      this.people = this.people.filter(p => p.name.toLowerCase() !== op.name.toLowerCase());
    } else if (op.op === "name_hide") this.hidden.add(op.name.toLowerCase());
    else if (op.op === "name_show") this.hidden.delete(op.name.toLowerCase());
    else if (op.op === "imm_option") this.extra.push([op.vaccine, op.dose, op.age]);
  },

  putRow(table, uid, fields) {
    let row = this.by[table].get(uid);
    const vals = worked(table, fields);
    if (row) Object.assign(row, vals);
    else {
      row = Object.assign({id: this.nextId++, uid}, vals);
      this.t[table].push(row);
      this.by[table].set(uid, row);
    }
    return row;
  },

  add(op) {
    op.at = Date.now();
    this.ops.push(op);
    this.applyLocal(op);
    this.persist();
    this.D = null;
  },

  /* A new or changed record: only its latest version needs to go to the computer. */
  save(table, uid, fields) {
    uid = uid || newId();
    const pendingPhoto = this.ops.find(o => o.op === "photo" && o.uid === uid);
    if (pendingPhoto) {   // a photo not yet sent: its details travel with it
      Object.assign(pendingPhoto.fields, fields);
      this.applyLocal(pendingPhoto);
      this.persist();
      this.D = null;
      return uid;
    }
    this.ops = this.ops.filter(o => !(o.op === "save" && o.table === table && o.uid === uid));
    this.add({op: "save", table, uid, fields});
    return uid;
  },

  remove(table, uid) {
    const inBase = this.base && this.base.tables[table] &&
      this.base.tables[table].rows.some(r => r[this.base.tables[table].cols.indexOf("uid")] === uid);
    this.ops = this.ops.filter(o => !((o.op === "save" || o.op === "photo") && o.uid === uid));
    this.add({op: "delete", table, uid});
    if (!inBase) {   // never reached the computer: nothing to tell it
      this.ops = this.ops.filter(o => o.uid !== uid);
      this.persist();
    }
  },

  /* A new or retaken photo: it goes to the computer with its details at the next sync. */
  savePhoto(kind, uid, fields) {
    const before = this.ops.find(o => o.op === "photo" && o.uid === uid);
    this.ops = this.ops.filter(o => !((o.op === "save" || o.op === "photo") && o.uid === uid));
    this.add({op: "photo", kind, uid, fields: Object.assign({}, before ? before.fields : {}, fields)});
    return uid;
  },

  pendingCount() { return this.ops.length; },

  /* ------------------------------------------------- what the report engine needs (as zion_tablet.snapshot) */
  mergedImm() {
    const here = new Set(DATA.sessions.map(s => s.id).concat(DATA.deleted));
    const rows = this.t.immunisations.filter(r => !fromSession(r.source, here));
    let id = 2e9;
    for (const s of DATA.sessions) {
      for (const ln of exportSession(s).imm) {
        rows.push({id: id++, uid: null, imm_date: s.date, vaccine: ln.vaccine, dose: ln.dose, age_group: ln.age,
          programme: ln.programme, male: ln.male, female: ln.female, total: ln.male + ln.female, location: s.location,
          post: "", notes: "Phone tally", source: `phone:${s.id}:${ln.id}`, session: s.id});
      }
    }
    return rows;
  },

  mergedHiv() {
    const here = new Set(DATA.sessions.map(s => s.id).concat(DATA.deleted));
    const rows = this.t.hiv_tests.filter(r => !fromSession(r.source, here));
    let id = 3e9;
    for (const s of DATA.sessions) {
      for (const ln of exportSession(s).hiv) {
        rows.push({id: id++, uid: null, test_date: s.date, location: s.location, age_group: ln.age, result: ln.result,
          male: ln.male, female: ln.female, total: ln.male + ln.female, notes: "Phone tally", source: `phone:${s.id}:${ln.id}`,
          session: s.id});
      }
    }
    return rows;
  },

  classify(text) {
    const t = (text || "").trim();
    if (!t) return [NOT_RECORDED, NOT_RECORDED];
    return this.dx.get(t.toLowerCase()) || [t.slice(0, 1).toUpperCase() + t.slice(1), NOT_MAPPED];
  },

  categories() {
    const cats = Array.from(new Set(Array.from(this.dx.values()).map(v => v[1]).filter(Boolean))).sort();
    return cats.concat([NOT_MAPPED, NOT_RECORDED]);
  },

  dxNames() {
    const count = new Map();
    for (const v of this.t.invoices) {
      const std = this.classify(v.diagnosis)[0];
      count.set(std, (count.get(std) || 0) + 1);
    }
    return Array.from(count.entries()).map((p, i) => [p[0], p[1], i]).sort((a, b) => b[1] - a[1] || a[2] - b[2])
      .map(p => p[0]).filter(d => d !== NOT_RECORDED);
  },

  entries() {
    const out = this.t.ledger.map(r => [r.id, 0, r.entry_date || null, r.description || "", r.amount_in || 0, r.amount_out || 0,
      r.from_party || "", r.to_party || "", r.cost_code || "", 0, 0, r.notes || ""]);
    const days = new Map();
    for (const v of this.t.invoices) {
      if (!v.visit_date) continue;
      const d = days.get(v.visit_date) || [0, 0, 0];
      d[0]++; d[1] += v.billed || 0; d[2] += v.paid || 0;
      days.set(v.visit_date, d);
    }
    for (const [date, [n, billed, paid]] of days) {
      const owed = billed - paid;
      const desc = `Patient services: ${n} visit${n !== 1 ? "s" : ""}, billed ${ZR.fmtNum(billed)}` + (owed ? `, ${ZR.fmtNum(owed)} owed` : "");
      out.push([null, 1, date, desc, paid, 0, PATIENTS, CLINIC_NAME, "101", billed, n, ""]);
    }
    const key = e => [e[2] || "", e[1] ? 0 : 1, e[0] || 0];
    return out.map(e => [key(e), e]).sort((a, b) => {
      for (let i = 0; i < 3; i++) { if (a[0][i] < b[0][i]) return -1; if (a[0][i] > b[0][i]) return 1; }
      return 0;
    }).map(p => p[1]);
  },

  vaccines() {
    const order = [];
    for (const s of LISTS.scheduleAll) if (!order.includes(s[0])) order.push(s[0]);
    const rest = Array.from(new Set(this.mergedImm().map(r => r.vaccine))).sort();
    for (const v of rest) if (!order.includes(v)) order.push(v);
    return order;
  },

  /* [label, vaccine, dose, age]: the schedule, then options the clinic added, then anything else in the records. */
  immOptions() {
    const seen = new Set(), out = [];
    const add = (v, d, a) => {
      const key = v.toLowerCase() + "|" + (d || "") + "|" + (a || "").toLowerCase();
      if (v && !seen.has(key)) { seen.add(key); out.push([immLabel(v, d || "", a || ""), v, d || "", a || ""]); }
    };
    for (const s of LISTS.scheduleAll) add(s[0], s[1], s[2]);
    for (const s of this.extra) add(s[0], s[1], s[2]);
    const rows = this.t.immunisations.map(r => [r.vaccine, r.dose || "", r.age_group || ""]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const r of rows) add(r[0], r[1], r[2]);
    return out;
  },

  locations() {
    const out = LISTS.locations.slice(), seen = new Set(out.map(l => l.toLowerCase())), count = new Map();
    for (const r of this.mergedImm()) {
      const l = (r.location || "").trim();
      if (l) { const k = l.toLowerCase(); const c = count.get(k) || [l, 0]; c[1]++; count.set(k, c); }
    }
    for (const c of Array.from(count.values()).sort((a, b) => b[1] - a[1])) {
      if (!seen.has(c[0].toLowerCase())) { seen.add(c[0].toLowerCase()); out.push(c[0]); }
    }
    return out;
  },

  hivLocations() {
    const out = this.locations(), seen = new Set(out.map(l => l.toLowerCase()));
    for (const r of this.mergedHiv()) {
      const l = (r.location || "").trim();
      if (l && !seen.has(l.toLowerCase())) { seen.add(l.toLowerCase()); out.push(r.location); }
    }
    return out;
  },

  districts() {
    const out = LISTS.districts.slice(), seen = new Set(out.map(d => d.toLowerCase()));
    for (const r of this.t.eye_patients) {
      const d = (r.district || "").trim();
      if (d && !seen.has(d.toLowerCase())) { seen.add(d.toLowerCase()); out.push(r.district); }
    }
    return out;
  },

  usedNames() {
    const count = new Map();
    for (const r of this.t.ledger) {
      for (const n of [r.to_party, r.from_party]) {
        if (n && n.trim()) { const k = n.toLowerCase(); const c = count.get(k) || [n, 0]; c[1]++; count.set(k, c); }
      }
    }
    return Array.from(count.values()).sort((a, b) => b[1] - a[1]).map(c => c[0]);
  },

  /* Staff, volunteers and contractors first, then the clinic, then other names already used. */
  names() {
    const listed = this.people.map(p => p.name), seen = new Set(listed.map(n => n.toLowerCase()).concat(Array.from(this.hidden)));
    const out = listed.slice();
    for (const n of [CLINIC_NAME, PATIENTS].concat(this.usedNames())) {
      if (!seen.has(n.toLowerCase())) { out.push(n); seen.add(n.toLowerCase()); }
    }
    return out;
  },

  snapForReports() {
    const visits = this.t.invoices.map(v => {
      const [std, cat] = this.classify(v.diagnosis);
      return [v.id, v.visit_date, v.patient, v.age_years, v.diagnosis || "", v.billed, v.paid, v.contact || "", v.notes || "", v.status || "", std, cat];
    });
    const imm = this.mergedImm().map(r => [r.id, r.imm_date, r.vaccine, r.dose || "", r.age_group || "", r.programme || "", r.male, r.female,
      r.total, r.location || "", r.post || "", r.notes || ""]);
    const flags = LISTS.eyeFlags.map(f => f[0]);
    const eye = this.t.eye_patients.map(r => [r.id, r.camp_date, r.patient, r.age || "", r.age_years, r.sex || "", r.district || "", r.address || "",
      r.nin || "", r.contact || "", r.visual_acuity || "", r.findings || "", r.glasses || "", r.notes || "", flags.map(c => (r[c] ? 1 : 0))]);
    const hiv = this.mergedHiv().map(r => [r.id, r.test_date, r.location || "", r.age_group || "", r.result, r.male, r.female, r.total, r.notes || ""]);
    return {
      made: this.base ? this.base.made : "", clinic: CLINIC_NAME,
      cost_codes: this.base ? this.base.cost_codes : LISTS.allCodes, names: this.names(), entries: this.entries(), visits,
      dx_categories: this.categories(), dx_names: this.dxNames(), imm, imm_vaccines: this.vaccines(), imm_options: this.immOptions().map(o => o.slice(1)),
      imm_locations: this.locations(), imm_programmes: LISTS.programmes, eye, eye_flags: LISTS.eyeFlags, eye_districts: this.districts(),
      hiv, hiv_locations: this.hivLocations(), receipts: this.t.phone_receipts,
    };
  },

  reportData() {
    if (!this.D) this.D = ZR.prepare(this.snapForReports());
    return this.D;
  },
};

/* Zion Finance keeps the money only: as soon as a copy of the records arrives, patient details and the immunisation,
   eye camp and HIV records are taken out of it. Daily patient income still comes from what each visit billed and paid. */
function moneyOnly(b) {
  const inv = b.tables.invoices, keep = new Set(["id", "uid", "visit_date", "billed", "paid", "status"]);
  const gone = inv.cols.map((c, i) => (keep.has(c) ? -1 : i)).filter(i => i >= 0);
  for (const r of inv.rows) for (const i of gone) r[i] = null;
  const sheets = b.tables.imm_photos, uid = sheets.cols.indexOf("uid"), tally = new Set(sheets.rows.map(r => r[uid]));
  b.photos = (b.photos || []).filter(u => !tally.has(u));
  for (const name of ["immunisations", "eye_patients", "hiv_tests", "imm_photos"]) b.tables[name].rows = [];
  b.dx_map = [];
  b.imm_extra = [];
  b.money_only = true;
}

function fromSession(source, ids) {
  if (!source || !source.startsWith("phone:")) return false;
  return ids.has(source.split(":")[1]);
}

function personOrder(p) { return {Staff: 0, Volunteer: 1, Contractor: 2}[p.type] ?? 3; }

function readBig(name) {
  if (!NATIVE) return localStorage.getItem("zion_file_" + name);
  const n = NATIVE.fileOpen(name);
  if (n < 0) return null;
  let s = "";
  for (let i = 0; i < n; i += 400000) s += NATIVE.fileChunk(i, 400000);
  NATIVE.fileClose();
  return s;
}

function writeFile(name, text) {
  try {
    if (NATIVE) { if (!NATIVE.fileWrite(name, text)) toast("Could not save on the phone. Is the phone storage full?"); }
    else localStorage.setItem("zion_file_" + name, text);
  } catch (e) { toast("Could not save: " + e); }
}

function visitStatus(billed, paid) {
  if (billed === null || billed === undefined) return "Not recorded";
  paid = paid || 0;
  if (billed <= 0 || paid >= billed) return "Paid";
  return paid > 0 ? "Partial" : "Unpaid";
}

function immLabel(vaccine, dose, age) {
  const d = !dose ? "" : dose === "Birth" ? " · birth dose" : dose === "Zero dose" ? " · zero dose" : ` · dose ${dose}`;
  return age ? `${vaccine}${d} · ${age}` : `${vaccine}${d}`;
}

/* The values worked out from what was entered, the same as the computer's save functions. */
function worked(table, f) {
  const o = Object.assign({}, f);
  if (table === "invoices") {
    o.age_years = parseAge(f.age);
    o.status = visitStatus(f.billed, f.paid);
  } else if (table === "immunisations") {
    if (f.male !== null && f.male !== undefined || f.female !== null && f.female !== undefined) o.total = (f.male || 0) + (f.female || 0);
  } else if (table === "eye_patients") {
    o.age_years = parseAge(f.age);
  } else if (table === "hiv_tests") {
    o.total = (f.male || 0) + (f.female || 0);
  }
  return o;
}

/* Free-text age ('16y', '4y, 6m', '7m', '6/12', '1y 1/2', 40) -> years, as core.parse_age. */
function parseAge(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s || ["na", "n/a", "nd", "-", "none", "unknown"].includes(s)) return null;
  s = s.replace(/(?<=\d)o(?=n)|\band\b|(?<=\d)and(?=\d)|&/g, m => (m === "o" ? "0" : " "));
  let total = 0, found = false;
  const frac = /(\d+(?:\.\d+)?)\s*\/\s*(12|52|7|2)\b/g;
  for (const m of s.matchAll(frac)) {
    total += parseFloat(m[1]) / {12: 12, 52: 52, 7: 365, 2: 2}[m[2]];
    found = true;
  }
  s = s.replace(frac, " ");
  const re = /(\d+(?:\.\d+)?)\s*(?:(y(?:ea)?r?s?(?:\s*old)?|ys|yo)|(m(?:on)?(?:th)?s?|mths?|mo)|(w(?:ee)?k?s?)|(d(?:ay)?s?))?(?![a-z])/g;
  let first = true;
  for (const m of s.matchAll(re)) {
    const v = parseFloat(m[1]);
    const factor = m[2] ? 1 : m[3] ? 1 / 12 : m[4] ? 1 / 52 : m[5] ? 1 / 365 : first ? 1 : 1 / 12;
    total += v * factor;
    found = true;
    first = false;
  }
  if (!found || !(total >= 0 && total <= 120)) return null;
  return Number(ZR.pyFixed(total, 2));
}

/* --------------------------------------------- reading an eye camp's handwritten findings (as zion_eye) */
const EYE_PATTERNS = [
  ["cataract", /catar/], ["presbyopia", /presb|presboy|reading\s*glass|\+\s*\d|\d[.,]\d{2}\s*ds/],
  ["allergy", /allerg|dexona|olopat|olapat|cetiriz|antihist/], ["conjunctivitis", /conj/],
  ["dry_eye", /dry|\bdes\b|lubric|tears/], ["sunglasses", /sun\s*-?\s*glass/], ["referred", /\bref+e?r+|surgery|sent to|optician/],
];
const EYE_OTHER = /myop|hyperop|pteryg|glaucom|ulcer|phakia|ectropi|entropi|inflam|trauma|patholog|kerat|cornea|foreign body|squint|strabism|blind|chalazi|stye|uveit/;

function glassesPower(text) {
  const t = (text || "").replace(/\b\d+\s*\/\s*\d+\b/g, " ").replace(/\b(?:x|tds|bd|od|qid)\s*\d+/gi, " ");
  for (const m of t.matchAll(/(?<![\d/.])([+-])?\s*(\d)(?:[.,](\d{1,2}))?(?![\d/])/g)) {
    const whole = Number(m[2]);
    if (whole > 6 || (!m[3] && !m[1] && !/^\s*\.?\+?\d\s*$/.test(t))) continue;
    return `${m[1] || "+"}${whole}.${(m[3] || "0").padEnd(2, "0").slice(0, 2)}`;
  }
  return "";
}

function flagsFromText(acuity, findings) {
  const text = `${acuity || ""} ${findings || ""}`.toLowerCase(), flags = {};
  for (const [c, p] of EYE_PATTERNS) flags[c] = p.test(text) ? 1 : 0;
  if (glassesPower(findings).startsWith("+")) flags.presbyopia = 1;
  const f = (findings || "").trim();
  flags.other = EYE_OTHER.test(text) || (!!f && !Object.values(flags).some(Boolean) && !/^[\d.,+\-\s]+$/.test(f) && !/^\s*normal/i.test(f)) ? 1 : 0;
  return flags;
}

function eyeAgeGroup(years) {
  if (years === null || years === undefined) return "Age not recorded";
  let label = LISTS.eyeAgeGroups[0][1];
  for (const [start, name] of LISTS.eyeAgeGroups) if (years >= start) label = name;
  return label;
}
