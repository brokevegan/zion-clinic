/* Zion Clinic on the phone: the app's shell (saved tallies, tabs, sheets, number pad) and the tally screens,
   where immunisations, deworming and HIV tests are counted with taps. store.js holds the clinic's records,
   pages.js, photos.js and reportspage.js the other tabs, sync.js the two-way sync with the computer. */
"use strict";

const LISTS = window.ZION_LISTS;              // lists.js, made from the computer program's lists
const NATIVE = window.ZionAndroid || null;    // the Android app; missing when opened in a browser to test
const FINANCE = LISTS.edition === "finance";  // Zion Finance, for finance staff: the money tabs only, no patient details
const APP_TITLE = FINANCE ? "Zion Finance" : "Zion Clinic";
const PORT = 8765;
const SEXES = [["m", "Boys"], ["f", "Girls"]];
const HIV_SEXES = [["m", "Male"], ["f", "Female"]];
const RESULTS = ["Negative", "Positive"];

const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
  c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

// ------------------------------------------------------------------ dates
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
function parseIso(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function niceDate(s) { const d = parseIso(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function addDays(s, n) { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
function niceTime(ms) { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// ------------------------------------------------------------------ saved data
let DATA = null;

function newId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

function load() {
  const read = backup => {
    try {
      const raw = NATIVE ? (backup ? NATIVE.loadBackup() : NATIVE.load()) : localStorage.getItem("zion_tally");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return undefined; }
  };
  let d = read(false);
  if (d === undefined) d = read(true);      // damaged file: use the copy made when the app last started
  DATA = Object.assign({deviceId: newId(), sessions: [], deleted: [], computer: null,
                        locations: LISTS.locations.slice()}, d || {});
  save();
}

function save() {
  const s = JSON.stringify(DATA);
  try {
    if (NATIVE) { if (!NATIVE.save(s)) toast("Could not save on the phone. Is the phone storage full?"); }
    else localStorage.setItem("zion_tally", s);
  } catch (e) { toast("Could not save: " + e); }
}

function buzz() { try { if (NATIVE) NATIVE.buzz(); } catch (e) { /* no vibration */ } }
function deviceName() { try { return NATIVE ? NATIVE.deviceName() + (FINANCE ? " (Zion Finance)" : "") : "Browser test"; } catch (e) { return "Phone"; } }

// ------------------------------------------------------------------ tallies
const groupOf = age => LISTS.groups.find(g => g.age === age);
const itemOf = key => LISTS.schedule.find(i => i.key === key);

function newSession(date, location) {
  return {id: newId(), date, location, created: Date.now(), updated: Date.now(), sentHash: null, sentAt: null,
          imm: [], deworm: {}, hiv: {}};
}

function counts(o, key) { return o[key] || (o[key] = {m: 0, f: 0}); }
function lineDoses(ln) { return (ln.m + ln.f) * (ln.group ? groupOf(ln.age).items.length : 1); }

function totals(s) {
  let doses = 0, dew = 0, hiv = 0, pos = 0;
  for (const ln of s.imm) doses += lineDoses(ln);
  for (const age of LISTS.dewormAges) { const c = s.deworm[age]; if (c) dew += c.m + c.f; }
  for (const k in s.hiv) {
    const c = s.hiv[k];
    hiv += c.m + c.f;
    if (k.endsWith("|Positive")) pos += c.m + c.f;
  }
  return {doses, dew, hiv, pos, any: doses + dew + hiv > 0};
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* What the computer receives: one line per vaccine / age group, without the empty ones.
   Line ids are stable, so sending a tally again replaces the lines sent before. */
function exportSession(s) {
  const imm = [], hiv = [];
  for (const ln of s.imm) {
    if (!(ln.m || ln.f)) continue;
    const items = ln.group ? groupOf(ln.age).items : [ln];
    for (const it of items) {
      imm.push({id: ln.group ? `${ln.id}-${slug(it.vaccine)}` : ln.id, vaccine: it.vaccine, dose: it.dose,
                age: ln.age, programme: ln.programme, male: ln.m, female: ln.f});
    }
  }
  for (const age of LISTS.dewormAges) {
    const c = s.deworm[age];
    if (c && (c.m || c.f)) {
      imm.push({id: "deworm-" + slug(age), vaccine: "Deworming", dose: "", age,
                programme: LISTS.dewormProgramme[age], male: c.m, female: c.f});
    }
  }
  for (const age of LISTS.hivAges) {
    for (const result of RESULTS) {
      const c = s.hiv[age + "|" + result];
      if (c && (c.m || c.f)) hiv.push({id: `hiv-${slug(age.replace("<", "under ").replace("+", " plus"))}-${result.toLowerCase()}`, age, result, male: c.m, female: c.f});
    }
  }
  return {id: s.id, date: s.date, location: s.location, imm, hiv};
}

function hashOf(s) { return fnv(JSON.stringify(exportSession(s))); }

function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

function status(s) {
  if (!s.sentHash) return totals(s).any ? "new" : "empty";
  return hashOf(s) === s.sentHash ? "sent" : "changed";
}

const STATUS_LABEL = {new: ["Not sent", "st-new"], empty: ["Empty", "st-sent"], sent: ["Sent ✓", "st-sent"],
                      changed: ["Changed – send again", "st-changed"]};

const toSend = () => DATA.sessions.filter(s => ["new", "changed"].includes(status(s)));

function summaryText(s) {
  const t = totals(s), parts = [];
  if (t.doses) parts.push(`Immunisation ${t.doses}`);
  if (t.dew) parts.push(`Deworming ${t.dew}`);
  if (t.hiv) parts.push(`HIV tests ${t.hiv}` + (t.pos ? ` (${t.pos} positive)` : ""));
  return parts.join(" · ") || "Nothing counted yet";
}

// ------------------------------------------------------------------ screens
const ROOT = FINANCE ? "home" : "menu";   // Zion Clinic starts on its home screen, Zion Finance on the ledger (PAGES.home in pages.js)
let view = {name: ROOT};
let flashId = null;

/* Zion Clinic: the sections on the home screen, and the name shown beside the logo on each screen. */
const MENU = [["home", "Tallies"], ["billing", "Patient Billing"], ["eye", "Eye Camps"], ["hiv", "HIV Tests"],
  ["money", "Revenue & Expenses"], ["reports", "Reports"], ["photos", "Photos"]];
const TITLES = {menu: APP_TITLE, home: "Tallies", immlist: "Tallies", session: "Tallies", billing: "Patient Billing", eye: "Eye Camps", hiv: "HIV Tests",
  money: "Revenue & Expenses", names: "Revenue & Expenses", reports: "Reports", photos: "Photos", tally: "Tally Sheets", cash: "Cash Book", receipt: "Receipts", sync: "Sync"};

/* Zion Finance: the tabs along the top, and which tab each screen belongs to. */
const TABS = FINANCE ? [["money", "Revenue & Expenses"], ["receipt", "Receipts"], ["cash", "Cash Book"], ["reports", "Reports"]] : [];
const TAB_OF = {names: "money", sync: "", home: "money"};
const PAGES = {};
const BACK = {session: "home", immlist: "home", names: "money"};   // the phone's back button
if (!FINANCE) Object.assign(BACK, {tally: "photos", cash: "photos", receipt: "photos"});

/* Remember the tally being worked on, so the app reopens on it (it is used on and off all day). */
function go(v) { view = v; remember(); render(true); }
function remember() {
  DATA.lastView = view.name === "session" ? {id: view.id, tab: view.tab || "imm"} : null;
  if (TABS.some(x => x[0] === view.name)) DATA.lastTab = view.name;
  save();
}
const current = () => DATA.sessions.find(s => s.id === view.id);

function render(top) {
  const y = window.scrollY;
  if (view.name === "session" && !current()) view = {name: "home"};
  const page = PAGES[view.name] || PAGES[ROOT];
  $("#view").innerHTML = page(view);
  drawTabs();
  window.scrollTo(0, top ? 0 : y);
  if (flashId) {
    const el = document.getElementById("line-" + flashId);
    flashId = null;
    if (el) { el.classList.add("flash"); el.scrollIntoView({block: "center"}); }
  }
}

function waitingCount() { return toSend().length + DATA.deleted.length + Clinic.pendingCount(); }

function drawTabs() {
  const on = TAB_OF[view.name] !== undefined ? TAB_OF[view.name] : view.tabName || view.name;
  const bar = $("#tabs");
  bar.classList.toggle("hidden", !TABS.length);
  bar.innerHTML = TABS.map(([k, label]) => `<button class="${k === on ? "on" : ""}" data-act="goTab" data-tab="${k}">${esc(label)}</button>`).join("");
  const active = bar.querySelector(".on");
  if (active && bar.dataset.on !== on) active.scrollIntoView({inline: "center", block: "nearest"});
  bar.dataset.on = on;
  if (!FINANCE) $(".top .app-name").textContent = TITLES[view.tabName || view.name] || APP_TITLE;
  const n = waitingCount(), badge = $("#syncBadge");
  badge.textContent = n;
  badge.classList.toggle("hidden", !n);
}

function segments(items, current_) {
  return `<div class="segments">` + items.map(([k, label]) =>
    `<button class="${k === current_ ? "on" : ""}" data-act="goTab" data-tab="${k}">${esc(label)}</button>`).join("") + `</div>`;
}

function renderHome() {
  const list = DATA.sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || b.updated - a.updated);
  let h = segments([["home", "Daily tallies"], ["immlist", "All immunisation lines"]], "home") +
    `<button class="primary wide" data-act="newTally">+ New tally</button>
    <h2>Saved tallies</h2>`;
  if (!list.length) h += `<div class="empty">No tallies yet.<br>Press <b>+ New tally</b> to start counting.</div>`;
  for (const s of list) {
    const [label, cls] = STATUS_LABEL[status(s)];
    h += `<div class="card session" data-act="open" data-id="${s.id}">
      <div><div class="when">${esc(niceDate(s.date))}</div><div>${esc(s.location)}</div>
      <div class="muted">${esc(summaryText(s))}</div></div>
      <span class="status ${cls}">${label}</span></div>`;
  }
  return h + `<h2>Immunisation history</h2>${immHistory()}`;
}

function counterRow(label, ref, value, what) {
  return `<div class="counter"><span class="who">${label}</span>
    <button class="minus" data-act="dec" data-ref="${esc(ref)}" ${value ? "" : "disabled"} aria-label="${label} minus one">−</button>
    <div class="count" data-act="setCount" data-ref="${esc(ref)}" data-label="${esc(what ? what + " – " + label : label)}">${value}</div>
    <button class="plus" data-act="inc" data-ref="${esc(ref)}" aria-label="${label} plus one">+</button></div>`;
}

function locationOptions(selected) {
  const list = DATA.locations.slice();
  if (selected && !list.includes(selected)) list.push(selected);
  return list.map(l => `<option ${l === selected ? "selected" : ""}>${esc(l)}</option>`).join("");
}

function renderSession(s) {
  const t = totals(s), tab = view.tab || "imm";
  const tabBtn = (key, label, n) =>
    `<button class="${tab === key ? "on" : ""}" data-act="tab" data-tab="${key}">${label}${n ? `<br><b>${n}</b>` : ""}</button>`;
  let h = `<button class="back" data-act="home">‹ All tallies</button>
    <div class="datebar">
      <button data-act="day" data-n="-1" aria-label="Day before">‹</button>
      <div class="day">${esc(niceDate(s.date))}
        <input type="date" data-change="date" value="${s.date}" max="${today()}" aria-label="Choose the date"></div>
      <button data-act="day" data-n="1" ${s.date >= today() ? "disabled" : ""} aria-label="Day after">›</button>
    </div>
    <div class="label">Location</div>
    <select data-change="location">${locationOptions(s.location)}</select>
    <div class="tabs">${tabBtn("imm", "Immunisation", t.doses)}${tabBtn("dew", "Deworming", t.dew)}${tabBtn("hiv", "HIV tests", t.hiv)}</div>`;
  h += tab === "dew" ? renderDeworm(s) : tab === "hiv" ? renderHiv(s) : renderImm(s);
  h += `<button class="primary wide" data-act="home" style="margin-top:18px">Done</button>
    <button class="danger wide" data-act="deleteTally">Delete this tally</button>`;
  return h;
}

function immSortKey(ln) {
  if (ln.group) return LISTS.schedule.findIndex(i => i.age === ln.age && LISTS.linkedVaccines.includes(i.vaccine)) - 0.5;
  const i = LISTS.schedule.findIndex(x => x.key === ln.key);
  return i < 0 ? 999 : i;
}

function renderImm(s) {
  let h = `<button class="primary wide" data-act="addVaccine">+ Add vaccine</button>`;
  if (!s.imm.length) h += `<div class="empty">Press <b>+ Add vaccine</b> and choose the vaccine and age.<br>Then press <b>+</b> for each child.</div>`;
  const lines = s.imm.slice().sort((a, b) => immSortKey(a) - immSortKey(b));
  if (lines.length > 1) {
    // Quick jumps between the vaccines on this tally, for adding children as they come all day.
    h += `<div class="jump">` + lines.map(ln => `<button data-act="jump" data-id="${ln.id}">${
      esc(ln.group ? `${ln.age} together` : `${ln.vaccine}${ln.dose && ln.dose !== "Birth" ? " " + ln.dose : ""}`)
    } <b>${ln.m + ln.f}</b></button>`).join("") + `</div>`;
  }
  for (const ln of lines) {
    let title, sub;
    if (ln.group) {
      const g = groupOf(ln.age);
      title = `${esc(ln.age)} – given together`;
      sub = esc(g.items.map(i => `${i.vaccine} ${i.dose}`).join(" · ")) + "<br>The same numbers count for each vaccine.";
    } else {
      title = esc(ln.vaccine) + (ln.dose ? ` · ${esc(doseText(ln.dose))}` : "");
      sub = esc(ln.age);
    }
    const progs = LISTS.programmes.map(p => `<option ${p === ln.programme ? "selected" : ""}>${esc(p)}</option>`).join("");
    h += `<div class="card line" id="line-${ln.id}">
      <div class="line-head"><div><div class="name">${title}</div><div class="sub">${sub}</div></div>
        <button class="trash" data-act="removeLine" data-id="${ln.id}">Remove</button></div>
      <select class="small prog" data-change="programme" data-id="${ln.id}" aria-label="Programme">${progs}</select>
      ${SEXES.map(([k, lab]) => counterRow(lab, `imm~${ln.id}~${k}`, ln[k], ln.group ? `${ln.age} together` : `${ln.vaccine} ${doseText(ln.dose)}`)).join("")}
      <div class="line-foot"><span class="muted">${ln.group ? `${lineDoses(ln)} doses` : ""}</span>
        <span class="total">Total ${ln.m + ln.f}</span></div></div>`;
  }
  return h;
}

function renderDeworm(s) {
  return LISTS.dewormAges.map(age => {
    const c = counts(s.deworm, age);
    return `<div class="card line"><div class="name">Deworming · ${esc(age)}</div>
      <div class="sub">${esc(LISTS.dewormProgramme[age])}</div>
      ${SEXES.map(([k, lab]) => counterRow(lab, `dw~${age}~${k}`, c[k], `Deworming ${age}`)).join("")}
      <div class="line-foot"><span></span><span class="total">Total ${c.m + c.f}</span></div></div>`;
  }).join("");
}

const HIV_AGE_LABEL = {"<15": "Under 15 years", "15-24": "15 – 24 years", "25-49": "25 – 49 years", "50+": "50 years and over"};

function renderHiv(s) {
  return LISTS.hivAges.map(age => {
    let tested = 0, pos = 0, rows = "";
    for (const result of RESULTS) {
      const c = counts(s.hiv, age + "|" + result);
      tested += c.m + c.f;
      if (result === "Positive") pos += c.m + c.f;
      rows += `<h3 class="${result === "Positive" ? "pos" : "neg"}">${result}</h3>` +
        HIV_SEXES.map(([k, lab]) => counterRow(lab, `hiv~${age}|${result}~${k}`, c[k], `${HIV_AGE_LABEL[age] || age}, ${result}`)).join("");
    }
    return `<div class="card line"><div class="name">${esc(HIV_AGE_LABEL[age] || age)}</div>${rows}
      <div class="line-foot"><span class="muted">Positive ${pos}</span><span class="total">Tested ${tested}</span></div></div>`;
  }).join("");
}

function doseText(d) {
  if (d === "Birth") return "birth dose";
  if (d === "Zero dose") return "zero dose";
  return d ? "dose " + d : "";
}

// ------------------------------------------------------------------ bottom sheets
let sheetResolve = null;

function openSheet(html) {
  $("#sheet").innerHTML = html;
  $("#modal").classList.remove("hidden");
  $("#sheet").scrollTop = 0;
}

function closeSheet(value) {
  $("#modal").classList.add("hidden");
  $("#sheet").innerHTML = "";
  const r = sheetResolve;
  sheetResolve = null;
  if (r) r(value);
}

function sheet(html) {
  if (sheetResolve) closeSheet(null);
  return new Promise(res => { sheetResolve = res; openSheet(html); });
}

function ask(title, text, okLabel, danger) {
  return sheet(`<h2>${title}</h2><p>${text}</p><div class="grid2">
    <button data-act="sheetResult" data-v="">Cancel</button>
    <button class="${danger ? "danger" : "primary"}" data-act="sheetResult" data-v="yes">${okLabel}</button></div>`)
    .then(v => v === "yes");
}

/* A big number pad: for setting a count or typing the computer's pairing code. */
let pad_ = null;

function keypad(title, initial, opts) {
  pad_ = Object.assign({value: initial == null ? "" : String(initial), max: 4, dot: false, hint: ""}, opts || {});
  pad_.fresh = true;    // the first key replaces the number shown
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", pad_.dot ? "." : "clear", "0", "back"];
  const shown = sheet(`<h2>${title}</h2>${pad_.hint ? `<p class="muted">${pad_.hint}</p>` : ""}
    <div class="display" id="padShow"></div>
    <div class="keypad">${keys.map(k => `<button data-act="padKey" data-k="${k}">${
      k === "back" ? "⌫" : k === "clear" ? "C" : k}</button>`).join("")}</div>
    <div class="grid2"><button data-act="sheetResult" data-v="">Cancel</button>
    <button class="primary" data-act="padOk">${opts && opts.ok || "OK"}</button></div>`);
  padShow();
  return shown.finally(() => { pad_ = null; });
}

function padShow() { const el = $("#padShow"); if (el && pad_) el.textContent = pad_.value || " "; }

// ------------------------------------------------------------------ actions
function touch(s) { s.updated = Date.now(); save(); }

function resolveRef(s, ref) {
  const [kind, key, sex] = ref.split("~");
  if (kind === "imm") return {obj: s.imm.find(l => l.id === key), sex};
  if (kind === "dw") return {obj: counts(s.deworm, key), sex};
  return {obj: counts(s.hiv, key), sex};
}

var ACTIONS = {
  home() { go({name: "home"}); },
  goHome() { go({name: ROOT}); },
  goTab(d) { go({name: d.tab}); },
  open(d) { go({name: "session", id: d.id, tab: "imm"}); },
  tab(d) { view.tab = d.tab; remember(); render(false); },
  jump(d) { flashId = d.id; render(false); },

  async newTally() {
    const date = today();
    const html = `<h2>New tally</h2><p class="muted">${esc(niceDate(date))} · where are you counting?</p>` +
      DATA.locations.map(l => `<button class="pick" data-act="sheetResult" data-v="${esc(l)}">${esc(l)}</button>`).join("") +
      `<button class="wide" data-act="sheetResult" data-v="">Cancel</button>`;
    const loc = await sheet(html);
    if (!loc) return;
    let s = DATA.sessions.find(x => x.date === date && x.location === loc);
    if (s) toast(`Opened today's tally for ${loc}`);
    else { s = newSession(date, loc); DATA.sessions.push(s); save(); }
    go({name: "session", id: s.id, tab: "imm"});
  },

  day(d) {
    const s = current(), next = addDays(s.date, Number(d.n));
    if (next > today()) return;
    s.date = next; touch(s); render(false);
  },

  inc(d) {
    const s = current(), {obj, sex} = resolveRef(s, d.ref);
    if (!obj) return;
    obj[sex] += 1; buzz(); touch(s); render(false);
  },

  dec(d) {
    const s = current(), {obj, sex} = resolveRef(s, d.ref);
    if (!obj || obj[sex] <= 0) return;
    obj[sex] -= 1; touch(s); render(false);
  },

  async setCount(d) {
    const s = current(), {obj, sex} = resolveRef(s, d.ref);
    if (!obj) return;
    const v = await keypad(esc(d.label), obj[sex], {max: 4, ok: "Set", number: true});
    if (v === null || v === undefined) return;
    obj[sex] = Number(v || 0); touch(s); render(false);
  },

  async addVaccine() {
    const s = current();
    const vaccines = [];
    for (const i of LISTS.schedule) if (!vaccines.includes(i.vaccine)) vaccines.push(i.vaccine);
    let html = `<h2>Add vaccine</h2><p class="muted">Which vaccine?</p>
      <button class="pick" data-act="sheetResult" data-v="__group" style="border-color:var(--leaf)">
        <b>Given together at 6, 10 or 14 weeks</b><br><span class="muted">${esc(LISTS.linkedVaccines.join(", "))} – one count for all</span></button>
      <div class="grid2">${vaccines.map(v => `<button class="pick" data-act="sheetResult" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div>
      <button class="wide" data-act="sheetResult" data-v="">Cancel</button>`;
    const vac = await sheet(html);
    if (!vac) return;
    if (vac === "__group") {
      html = `<h2>Given together</h2><p class="muted">Which age?</p>` + LISTS.groups.map(g =>
        `<button class="pick" data-act="sheetResult" data-v="${esc(g.age)}"><b>${esc(g.age)}</b><br>
         <span class="muted">${esc(g.items.map(i => `${i.vaccine} ${i.dose}`).join(" · "))}</span></button>`).join("") +
        `<button class="wide" data-act="sheetResult" data-v="">Cancel</button>`;
      const age = await sheet(html);
      if (age) addGroup(s, age);
      return;
    }
    const items = LISTS.schedule.filter(i => i.vaccine === vac);
    let key = items[0].key;
    if (items.length > 1) {
      html = `<h2>${esc(vac)}</h2><p class="muted">Which dose and age?</p>` + items.map(i =>
        `<button class="pick" data-act="sheetResult" data-v="${esc(i.key)}"><b>${esc(i.age)}</b>${
          i.dose ? ` · ${esc(doseText(i.dose))}` : ""}${i.programme === "Campaign" ? ` <span class="muted">(campaign)</span>` : ""}</button>`).join("") +
        `<button class="wide" data-act="sheetResult" data-v="">Cancel</button>`;
      key = await sheet(html);
      if (!key) return;
    }
    addItem(s, itemOf(key));
  },

  async removeLine(d) {
    const s = current(), ln = s.imm.find(l => l.id === d.id);
    if (!ln) return;
    const name = ln.group ? `the ${ln.age} vaccines given together` : `${ln.vaccine} ${doseText(ln.dose)} (${ln.age})`;
    if (ln.m + ln.f && !await ask("Remove this vaccine?", `Remove ${esc(name)} and its count of ${ln.m + ln.f}?`, "Remove", true)) return;
    s.imm = s.imm.filter(l => l !== ln); touch(s); render(false);
  },

  async deleteTally() {
    const s = current();
    const sent = !!s.sentHash;
    const ok = await ask("Delete this tally?", `${esc(niceDate(s.date))} · ${esc(s.location)}<br>${esc(summaryText(s))}` +
      (sent ? "<br><br>It was sent to the computer before, so it will also be removed from the computer the next time you press <b>Send</b>." : ""),
      "Delete", true);
    if (!ok) return;
    DATA.sessions = DATA.sessions.filter(x => x !== s);
    if (sent && !DATA.deleted.includes(s.id)) DATA.deleted.push(s.id);
    save(); toast("Tally deleted"); go({name: "home"});
  },

  sheetResult(d) { closeSheet(d.v); },
  padKey(d) {
    if (!pad_) return;
    if (pad_.fresh) { pad_.fresh = false; if (d.k !== "back" && !(pad_.dot && pad_.value)) pad_.value = ""; }
    if (d.k === "back") pad_.value = pad_.value.slice(0, -1);
    else if (d.k === "clear") pad_.value = "";
    else if (pad_.value.length < pad_.max) pad_.value += d.k;
    if (pad_.number) pad_.value = pad_.value.replace(/^0+(?=\d)/, "");
    padShow();
  },
  padOk() { closeSheet(pad_ ? pad_.value : null); },
};

function addItem(s, item) {
  if (item.linked) {
    const g = s.imm.find(l => l.group && l.age === item.age);
    if (g) { toast(`${item.vaccine} at ${item.age} is already counted in the “given together” group`); flashId = g.id; render(false); return; }
  }
  let ln = s.imm.find(l => !l.group && l.key === item.key);
  if (ln) toast("Already on this tally");
  else {
    ln = {id: newId(), key: item.key, vaccine: item.vaccine, dose: item.dose, age: item.age, programme: item.programme, m: 0, f: 0};
    s.imm.push(ln); touch(s);
  }
  flashId = ln.id; render(false);
}

function addGroup(s, age) {
  const g = groupOf(age);
  let ln = s.imm.find(l => l.group && l.age === age);
  if (ln) toast("Already on this tally");
  else {
    const single = s.imm.find(l => !l.group && l.age === age && g.items.some(i => i.vaccine === l.vaccine));
    if (single) {
      toast(`${single.vaccine} at ${age} is already on this tally by itself. Remove it first to count them together.`);
      flashId = single.id; render(false); return;
    }
    ln = {id: newId(), group: true, age, programme: g.programme, m: 0, f: 0};
    s.imm.push(ln); touch(s);
  }
  flashId = ln.id; render(false);
}

function onChange(e) {
  const el = e.target.closest("[data-change]");
  if (!el) return;
  const what = el.dataset.change;
  const s = current();
  if (!s) return;
  if (what === "date") {
    if (!el.value) return;
    s.date = el.value > today() ? today() : el.value;
  } else if (what === "location") s.location = el.value;
  else if (what === "programme") {
    const ln = s.imm.find(l => l.id === el.dataset.id);
    if (ln) ln.programme = el.value;
  }
  touch(s); render(false);
}

// ------------------------------------------------------------------ talking to the computer
const waiting = {};
let nextCall = 1;

window.zionNetDone = function (id, code, text) {
  if (id === "toast") { toast(text); return; }
  const done = waiting[id];
  delete waiting[id];
  if (done) done({code, text});
};

function http(method, url, body, timeoutMs) {
  return new Promise(resolve => {
    const id = String(nextCall++);
    waiting[id] = resolve;
    if (NATIVE) { NATIVE.request(id, method, url, body || "", timeoutMs || 8000); return; }
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), timeoutMs || 8000);
    fetch(url, {method, body: method === "POST" ? body : undefined, signal: ctl.signal})
      .then(async r => window.zionNetDone(id, r.status, await r.text()))
      .catch(e => window.zionNetDone(id, 0, String(e)));
  });
}

function json(r) { try { return JSON.parse(r.text); } catch (e) { return null; } }
function localIps() { try { return NATIVE ? JSON.parse(NATIVE.localIps()) : []; } catch (e) { return []; } }

async function hello(ip) {
  const r = await http("GET", `http://${ip}:${PORT}/zion/hello`, "", 2500);
  const j = r.code === 200 ? json(r) : null;
  return j && j.app === "Zion Clinic Finance" ? Object.assign({ip}, j) : null;
}

/* Every address on this Wi-Fi is asked "are you Zion Clinic?" - takes a few seconds. */
function scan() {
  return new Promise(resolve => {
    if (!NATIVE) { hello(location.hostname || "127.0.0.1").then(c => resolve(c ? [c] : [])); return; }
    const id = String(nextCall++);
    waiting[id] = r => {
      let found = [];
      try { found = JSON.parse(r.text); } catch (e) { /* none */ }
      resolve(found.map(f => { try { return Object.assign({ip: f.ip}, JSON.parse(f.body)); } catch (e) { return null; } })
        .filter(c => c && c.app === "Zion Clinic Finance"));
    };
    NATIVE.scan(id, PORT, "/zion/hello", 700);
  });
}

async function findComputer(address) {
  if (address) return await hello(address);
  if (DATA.computer) {
    const c = await hello(DATA.computer.ip);
    if (c) return c;
  }
  setSync({busy: true, ok: true, message: "Looking for the computer on this Wi-Fi…"});
  const found = await scan();
  if (found.length <= 1) return found[0] || null;
  const known = DATA.computer && found.find(c => c.id === DATA.computer.id);
  if (known) return known;
  const ip = await sheet(`<h2>Which computer?</h2>` + found.map(c =>
    `<button class="pick" data-act="sheetResult" data-v="${esc(c.ip)}">${esc(c.name)}<br><span class="muted">${esc(c.ip)}</span></button>`).join("") +
    `<button class="wide" data-act="sheetResult" data-v="">Cancel</button>`);
  return found.find(c => c.ip === ip) || null;
}

// ------------------------------------------------------------------ small things
let toastTimer = null;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3000);
}

/* The phone's back button: close a sheet, then go back to the list, then leave the app. */
window.zionBack = function () {
  if (!$("#modal").classList.contains("hidden")) { closeSheet(null); return true; }
  if (Lock.showing()) return false;
  if (view.back) { go(view.back); return true; }
  if (view.name !== ROOT) { go({name: BACK[view.name] || ROOT}); return true; }
  return false;
};

document.addEventListener("click", e => {
  if (e.target.id === "modal") { closeSheet(null); return; }
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = ACTIONS[el.dataset.act];
  if (act) act(el.dataset, el);
});
document.addEventListener("change", onChange);
PAGES.home = renderHome;
PAGES.session = () => renderSession(current());
PAGES.menu = () => `${noData()}<div class="menu">` +
  MENU.map(([k, label]) => `<button data-act="goTab" data-tab="${k}">${esc(label)}</button>`).join("") + `</div>`;
