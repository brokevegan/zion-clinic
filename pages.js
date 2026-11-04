/* The record-keeping tabs: Patient Billing, immunisation lines, Eye Camps, HIV Tests, Revenue & Expenses,
   Names & Staff. Each list has filters and a search box; tapping a line opens its form to change or delete it. */
"use strict";

// ------------------------------------------------------------------ forms

function fieldHtml(f, vals) {
  const v = vals[f.k] === null || vals[f.k] === undefined ? "" : vals[f.k];
  const name = `name="${f.k}" id="f_${f.k}"`;
  const label = f.label ? `<label class="label" for="f_${f.k}">${esc(f.label)}</label>` : "";
  if (f.type === "area") return `${label}<textarea ${name} rows="${f.rows || 2}" ${f.onchange ? `data-field="${f.k}"` : ""}>${esc(v)}</textarea>`;
  if (f.type === "select") {
    const opts = (typeof f.options === "function" ? f.options() : f.options).map(o => (Array.isArray(o) ? o : [o, o]));
    if (v !== "" && !opts.some(o => o[0] === v)) opts.push([v, v]);
    return `${label}<select ${name} ${f.onchange ? `data-field="${f.k}"` : ""}>` +
      opts.map(([val, text]) => `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(text)}</option>`).join("") + `</select>`;
  }
  if (f.type === "pick") {   // type freely, or press the arrow to choose from the list
    return `${label}<div class="pickrow"><input ${name} type="text" value="${esc(v)}" autocomplete="off">
      <button type="button" data-act="pickList" data-k="${f.k}" aria-label="Choose from the list">▾</button></div>`;
  }
  if (f.type === "check") {
    return `<label class="check"><input ${name} type="checkbox" ${v ? "checked" : ""}> ${esc(f.label)}</label>`;
  }
  if (f.type === "note") return `<p class="muted">${esc(f.text)}</p>`;
  if (f.type === "date") return `${label}<input ${name} type="date" value="${esc(v)}" ${f.max ? `max="${f.max}"` : ""}>`;
  if (f.type === "num") {
    return `${label}<input ${name} type="text" inputmode="numeric" value="${esc(v === "" ? "" : ZR.fmtNum(v))}" ${f.onchange ? `data-field="${f.k}"` : ""}>`;
  }
  return `${label}<input ${name} type="${f.type === "tel" ? "tel" : "text"}" value="${esc(v)}" autocomplete="off" ${f.onchange ? `data-field="${f.k}"` : ""}>`;
}

/* A form page. form: {title, backTo, fields, values, save(values) -> error text or nothing, del?, buttons?}. */
function openForm(form) { go({name: "form", form, tabName: form.tab, back: form.backTo}); }

PAGES.form = v => {
  const F = v.form;
  return `<button class="back" data-act="formBack">‹ ${esc(F.backLabel || "Back")}</button><h2>${esc(F.title)}</h2>
    ${F.top ? F.top() : ""}
    <form class="card form" id="form" onsubmit="return false">${F.fields.map(f => fieldHtml(f, F.values)).join("")}</form>
    <button class="primary wide" data-act="formSave">${esc(F.saveLabel || "Save")}</button>
    ${(F.buttons || []).map((b, i) => `<button class="wide" data-act="formBtn" data-i="${i}">${esc(b.label)}</button>`).join("")}
    ${F.del ? `<button class="danger wide" data-act="formDelete">${esc(F.delLabel || "Delete")}</button>` : ""}`;
};

function formValues() {
  const F = view.form, out = {};
  for (const f of F.fields) {
    if (f.type === "note") continue;
    const el = document.getElementById("f_" + f.k);
    if (f.type === "check") out[f.k] = el.checked ? 1 : 0;
    else if (f.type === "num") out[f.k] = parseAmount(el.value);
    else out[f.k] = el.value.trim();
  }
  return out;
}

/* '5,000' / '5000' / '5k' / '2.5k' -> a number. Blank -> null. Not a number -> NaN (as core.parse_amount). */
function parseAmount(text) {
  let s = String(text || "").trim().toLowerCase().replace(/,/g, "").replace("ugx", "").trim();
  if (!s) return null;
  const mult = s.endsWith("k") ? 1000 : 1;
  s = s.replace(/k+$/, "").trim();
  const v = Number(s);
  return s === "" || !isFinite(v) || v < 0 ? NaN : Math.round(v * mult);
}

Object.assign(ACTIONS, {
  formBack() { go(view.back); },
  formSave() {
    const F = view.form, vals = formValues();
    const err = F.save(vals);
    if (err) { toast(err); return; }
    if (F.after) F.after(vals); else go(F.backTo);
  },
  formBtn(d) { view.form.buttons[Number(d.i)].run(formValues()); },
  async formDelete() {
    const F = view.form;
    if (await ask(F.delAsk || "Delete this?", F.delText || "", "Delete", true)) { F.del(); go(F.backTo); }
  },
  /* A short list to choose from, narrowed by what is already typed. */
  async pickList(d) {
    const f = view.form.fields.find(x => x.k === d.k), el = document.getElementById("f_" + d.k);
    const all = typeof f.options === "function" ? f.options() : f.options;
    const typed = el.value.trim().toLowerCase();
    const near = typed ? all.filter(o => o.toLowerCase().includes(typed)) : all;
    const list = (near.length ? near : all).slice(0, 80);
    const v = await sheet(`<h2>${esc(f.label)}</h2>` + list.map(o =>
      `<button class="pick" data-act="sheetResult" data-v="${esc(o)}">${esc(o)}</button>`).join("") +
      `<button class="wide" data-act="sheetResult" data-v="">Cancel</button>`);
    if (v) { el.value = v; if (f.onpick) f.onpick(v); }
  },
});

document.addEventListener("change", e => {
  const el = e.target.closest("[data-field]");
  if (!el || !view.form) return;
  const f = view.form.fields.find(x => x.k === el.dataset.field);
  if (f && f.onchange) f.onchange(el.value);
});

// ------------------------------------------------------------------ lists: filters, search, show more

const FILTERS = {};
const LIST_ROWS = {};
function filt(page, defaults) { return FILTERS[page] || (FILTERS[page] = Object.assign({limit: 100, search: ""}, defaults || {})); }
const RANGE_NAMES = ["Today", "This week", "This month", "Last month", "This year", "Last year", "All time"];

function rangeOf(name) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  const endOf = (yy, mm) => new Date(yy, mm + 1, 0);
  if (name === "Today") return [iso(t), iso(t)];
  if (name === "This week") {
    const s = new Date(y, m, t.getDate() - ((t.getDay() + 6) % 7));
    return [iso(s), iso(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6))];
  }
  if (name === "This month") return [iso(new Date(y, m, 1)), iso(endOf(y, m))];
  if (name === "Last month") return [iso(new Date(y, m - 1, 1)), iso(endOf(y, m - 1))];
  if (name === "This quarter") { const q = 3 * Math.floor(m / 3); return [iso(new Date(y, q, 1)), iso(endOf(y, q + 2))]; }
  if (name === "This year") return [y + "-01-01", y + "-12-31"];
  if (name === "Last year") return [(y - 1) + "-01-01", (y - 1) + "-12-31"];
  return ["", ""];
}

function filterSelect(page, key, label, options) {
  const f = filt(page), opts = options.map(o => (Array.isArray(o) ? o : [o, o]));
  return `<div class="filter"><label class="label">${esc(label)}</label><select data-filter="${key}" data-page="${page}">` +
    opts.map(([v, t]) => `<option value="${esc(v)}" ${String(f[key]) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("") + `</select></div>`;
}

function searchBox(page, hint) {
  return `<input class="search" type="search" placeholder="${esc(hint || "Search")}" value="${esc(filt(page).search)}" data-search="${page}" autocomplete="off">`;
}

function refreshResults(page) {
  const el = document.getElementById("results");
  if (el && LIST_ROWS[page]) el.innerHTML = LIST_ROWS[page]();
}

document.addEventListener("input", e => {
  const page = e.target.dataset && e.target.dataset.search;
  if (!page) return;
  const f = filt(page);
  f.search = e.target.value;
  f.limit = 100;
  clearTimeout(f.timer);
  f.timer = setTimeout(() => refreshResults(page), 200);
});
document.addEventListener("change", e => {
  const page = e.target.dataset && e.target.dataset.filter ? e.target.dataset.page : null;
  if (!page) return;
  const f = filt(page);
  f[e.target.dataset.filter] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  f.limit = 100;
  refreshResults(page);
});
ACTIONS.showMore = d => { filt(d.page).limit += 200; refreshResults(d.page); };

function limited(page, rows, rowHtml) {
  const f = filt(page), shown = rows.slice(0, f.limit);
  let h = shown.map(rowHtml).join("");
  if (!rows.length) h = `<div class="empty">Nothing matches.</div>`;
  if (rows.length > shown.length) h += `<button class="wide small" data-act="showMore" data-page="${page}">Show more (${(rows.length - shown.length).toLocaleString("en-US")} more)</button>`;
  return h;
}

const contains = (s, q) => String(s === null || s === undefined ? "" : s).toLowerCase().includes(q);
const noData = () => (Clinic.has() ? "" : `<div class="card result bad">This phone does not have the clinic's records yet. Press <b>Sync</b> at the top
  while Sync with phone is open on the computer.</div>`);
const money = n => (n === null || n === undefined || n === "" ? "" : ZR.fmtNum(n));

// ------------------------------------------------------------------ Patient Billing

PAGES.billing = () => {
  filt("billing", {range: "This month"});
  return `${noData()}<div class="stats" id="todayStats">${todayStats()}</div>
    <button class="primary wide" data-act="visitNew">+ New visit</button>
    ${searchBox("billing", "Search name, diagnosis, contact…")}
    <div class="filters">${filterSelect("billing", "range", "Dates", RANGE_NAMES)}${filterSelect("billing", "status", "Status",
      [["", "All"], "Paid", "Partial", "Unpaid", "Not recorded"])}</div>
    <div id="results">${LIST_ROWS.billing()}</div>`;
};

function todayStats() {
  const t = today(), rows = Clinic.t.invoices.filter(v => v.visit_date === t);
  const paid = rows.reduce((s, v) => s + (v.paid || 0), 0), billed = rows.reduce((s, v) => s + (v.billed || 0), 0);
  return `<b>Today:</b> ${rows.length} visit${rows.length === 1 ? "" : "s"} · billed ${money(billed)} · received ${money(paid)}`;
}

LIST_ROWS.billing = () => {
  const f = filt("billing"), [a, b] = rangeOf(f.range), q = f.search.trim().toLowerCase();
  const rows = Clinic.t.invoices.filter(v => {
    if (a && (!v.visit_date || v.visit_date < a || v.visit_date > b)) return false;
    if (f.status && v.status !== f.status) return false;
    return !q || contains(v.patient, q) || contains(v.diagnosis, q) || contains(v.contact, q) || contains(v.notes, q) || contains(v.status, q);
  }).sort((x, y) => (y.visit_date || "").localeCompare(x.visit_date || "") || y.id - x.id);
  const billed = rows.reduce((s, v) => s + (v.billed || 0), 0), paid = rows.reduce((s, v) => s + (v.paid || 0), 0);
  return `<p class="muted">${rows.length.toLocaleString("en-US")} visits · billed ${money(billed)} · received ${money(paid)} · owed ${money(billed - paid)}</p>` +
    limited("billing", rows, v => `<div class="card row" data-act="visitEdit" data-uid="${esc(v.uid)}">
      <div class="grow"><div class="name">${esc(v.patient)}${v.age ? ` <span class="muted">${esc(v.age)}</span>` : ""}</div>
        <div class="muted">${esc(ZR.fmtDate(v.visit_date))}${v.diagnosis ? " · " + esc(v.diagnosis) : ""}</div></div>
      <div class="amt">${money(v.paid || 0)}<br><span class="status ${v.status === "Paid" ? "st-sent" : v.status === "Partial" ? "st-changed" : "st-new"}">${esc(v.status || "")}</span></div></div>`);
};

function visitForm(v) {
  const values = v ? Object.assign({}, v) : {visit_date: today(), billed: DEFAULT_FEE, paid: 0};
  openForm({title: v ? "Change visit" : "New visit", tab: "billing", backTo: {name: "billing"}, backLabel: "Patient Billing", values,
    fields: [{k: "visit_date", label: "Visit date", type: "date", max: today()}, {k: "patient", label: "Patient name"},
      {k: "age", label: "Age (e.g. 34y, 6m, 1y 2m)"}, {k: "contact", label: "Contact", type: "tel"},
      {k: "diagnosis", label: "Diagnosis", type: "pick", options: () => Clinic.dxNames()},
      {k: "billed", label: "Billed (UGX)", type: "num"}, {k: "paid", label: "Paid (UGX)", type: "num"},
      {k: "notes", label: "Notes", type: "area"}],
    save(x) {
      if (!x.visit_date) return "Please enter the visit date.";
      if (!x.patient) return "Please enter the patient's name.";
      if (Number.isNaN(x.billed) || Number.isNaN(x.paid)) return "Billed and paid must be numbers, e.g. 5000 or 5k.";
      x.paid = x.paid || 0;
      Clinic.save("invoices", v ? v.uid : null, x);
      toast("Visit saved");
    },
    del: v ? () => Clinic.remove("invoices", v.uid) : null, delAsk: "Delete this visit?",
    delText: v ? `${esc(v.patient)} · ${esc(ZR.fmtDate(v.visit_date))}` : ""});
}
ACTIONS.visitNew = () => visitForm(null);
ACTIONS.visitEdit = d => visitForm(Clinic.by.invoices.get(d.uid));

// ------------------------------------------------------------------ all immunisation lines

PAGES.immlist = () => {
  filt("imm", {range: "This month", vaccine: "", programme: "", location: ""});
  return segments([["home", "Daily tallies"], ["immlist", "All immunisation lines"]], "immlist") + noData() +
    `<button class="primary wide" data-act="immNew">+ Add a line</button>
    ${searchBox("imm", "Search vaccine, place, notes…")}
    <div class="filters">${filterSelect("imm", "range", "Dates", RANGE_NAMES)}
      ${filterSelect("imm", "vaccine", "Vaccine", [["", "All vaccines"]].concat(Clinic.vaccines()))}
      ${filterSelect("imm", "programme", "Programme", [["", "All programmes"]].concat(LISTS.programmes))}
      ${filterSelect("imm", "location", "Location", [["", "All locations"]].concat(Clinic.locations()))}</div>
    <div id="results">${LIST_ROWS.imm()}</div>`;
};

LIST_ROWS.imm = () => {
  const f = filt("imm"), [a, b] = rangeOf(f.range), q = f.search.trim().toLowerCase();
  const rows = Clinic.mergedImm().filter(r => {
    if (a && (r.imm_date < a || r.imm_date > b)) return false;
    if (f.vaccine && r.vaccine !== f.vaccine) return false;
    if (f.programme && r.programme !== f.programme) return false;
    if (f.location && (r.location || "").toLowerCase() !== f.location.toLowerCase()) return false;
    return !q || [r.vaccine, r.age_group, r.programme, r.location, r.post, r.notes, r.dose].some(x => contains(x, q));
  }).sort((x, y) => y.imm_date.localeCompare(x.imm_date) || y.id - x.id);
  const m = rows.reduce((s, r) => s + (r.male || 0), 0), w = rows.reduce((s, r) => s + (r.female || 0), 0), t = rows.reduce((s, r) => s + (r.total || 0), 0);
  return `<p class="muted">${rows.length.toLocaleString("en-US")} lines · Male ${money(m)} · Female ${money(w)}${t - m - w ? ` · Sex not recorded ${money(t - m - w)}` : ""} · Total ${money(t)} doses</p>` +
    limited("imm", rows, r => `<div class="card row" data-act="immEdit" data-uid="${esc(r.uid || "")}" data-session="${esc(r.session || "")}">
      <div class="grow"><div class="name">${esc(immLabel(r.vaccine, r.dose || "", r.age_group || ""))}</div>
        <div class="muted">${esc(ZR.fmtDate(r.imm_date))} · ${esc(r.location || "")} · ${esc(r.programme || "")}${r.session ? " · on a tally" : ""}</div></div>
      <div class="amt"><b>${money(r.total)}</b><br><span class="muted">M ${r.male === null ? "–" : r.male} F ${r.female === null ? "–" : r.female}</span></div></div>`);
};

function immForm(r) {
  const opts = Clinic.immOptions();
  const optionOf = x => immLabel(x.vaccine, x.dose || "", x.age_group || "");
  const values = r ? Object.assign({}, r, {option: optionOf(r)}) : {imm_date: today(), programme: LISTS.programmes[0], linked: 1, location: filt("imm").lastLocation || ""};
  const fields = [{k: "imm_date", label: "Date", type: "date", max: today()},
    {k: "option", label: "Vaccine and age", type: "select", options: () => [["", "Choose…"]].concat(opts.map(o => o[0])),
      onchange(label) {
        const o = opts.find(x => x[0] === label);
        if (o) document.getElementById("f_programme").value = LISTS.schedule.concat(LISTS.deworm).find(i => i.vaccine === o[1] && i.age === o[3] && i.dose === o[2])?.programme || LISTS.programmes[0];
      }},
    {k: "programme", label: "Programme", type: "select", options: LISTS.programmes},
    {k: "location", label: "Location", type: "pick", options: () => Clinic.locations()},
    {k: "male", label: "Male", type: "num"}, {k: "female", label: "Female", type: "num"},
    {k: "post", label: "Post / notes (optional)"}];
  if (!r) fields.push({k: "linked", label: "Use the same numbers for Polio, IPV, DPT-HepB-Hib, PCV and Rotavirus at this age (6, 10 and 14 weeks)", type: "check"});
  openForm({title: r ? "Change line" : "Add a line", tab: "home", backTo: {name: "immlist"}, backLabel: "All immunisation lines", values, fields,
    buttons: [{label: "+ New vaccine / age option", run: () => newImmOption()}],
    save(x) {
      const o = opts.find(i => i[0] === x.option);
      if (!o) return "Choose the vaccine and age.";
      if (!x.imm_date) return "Please enter a valid date.";
      if (Number.isNaN(x.male) || Number.isNaN(x.female)) return "Male and female must be whole numbers.";
      if (x.male === null && x.female === null && !(r && r.male === null && r.female === null)) return "Enter the number of males and/or females.";
      if (!x.location) return "Please choose or type the location.";
      filt("imm").lastLocation = x.location;
      const line = (v, d, a, old) => ({imm_date: x.imm_date, vaccine: v, dose: d, age_group: a, programme: old ? old.programme || x.programme : x.programme,
        male: x.male, female: x.female, total: old && x.male === null && x.female === null ? old.total : null, location: x.location,
        post: x.post || (old ? old.post || "" : ""), notes: old ? old.notes || "" : "", source: old ? old.source : null});
      const group = !r && x.linked && LISTS.linkedAges.includes(o[3]) && LISTS.linkedVaccines.includes(o[1]) ?
        LISTS.scheduleAll.filter(s => LISTS.linkedVaccines.includes(s[0]) && s[2] === o[3]) : null;
      if (group) {   // one form fills the whole age group: entries already there are updated, not doubled
        for (const [v, d, a] of group) {
          const old = Clinic.t.immunisations.find(i => i.imm_date === x.imm_date && (i.location || "").toLowerCase() === x.location.toLowerCase() &&
            i.vaccine === v && (i.dose || "") === d && (i.age_group || "") === a);
          Clinic.save("immunisations", old ? old.uid : null, line(v, d, a, old));
        }
        toast(`Saved ${group.length} lines for ${o[3]}`);
      } else {
        Clinic.save("immunisations", r ? r.uid : null, line(o[1], o[2], o[3], r));
        toast("Line saved");
      }
    },
    del: r ? () => Clinic.remove("immunisations", r.uid) : null, delAsk: "Delete this line?",
    delText: r ? `${esc(optionOf(r))} · ${esc(ZR.fmtDate(r.imm_date))}` : ""});
}

async function newImmOption() {
  const vals = await sheet(`<h2>New vaccine / age option</h2>
    <label class="label">Vaccine</label><input id="o_v" type="text" autocomplete="off">
    <label class="label">Dose (optional)</label><input id="o_d" type="text" autocomplete="off">
    <label class="label">Age group</label><input id="o_a" type="text" autocomplete="off">
    <div class="grid2" style="margin-top:12px"><button data-act="sheetResult" data-v="">Cancel</button>
    <button class="primary" data-act="optionOk">Add</button></div>`);
  if (vals && vals.vaccine) {
    Clinic.add({op: "imm_option", vaccine: vals.vaccine, dose: vals.dose, age: vals.age});
    toast("Option added");
    immForm(null);
  }
}
ACTIONS.optionOk = () => closeSheet({vaccine: $("#o_v").value.trim(), dose: $("#o_d").value.trim(), age: $("#o_a").value.trim()});
ACTIONS.immNew = () => immForm(null);
ACTIONS.immEdit = d => {
  if (d.session) { go({name: "session", id: d.session, tab: "imm"}); return; }
  immForm(Clinic.by.immunisations.get(d.uid));
};

// ------------------------------------------------------------------ Eye Camps

PAGES.eye = () => {
  filt("eye", {camp: "", cond: "", sex: "", age: "", district: ""});
  const camps = Array.from(new Set(Clinic.t.eye_patients.map(r => r.camp_date))).sort().reverse();
  return `${noData()}<button class="primary wide" data-act="eyeNew">+ New patient</button>
    ${searchBox("eye", "Search name, address, findings…")}
    <div class="filters">${filterSelect("eye", "camp", "Camp", [["", "All camps"]].concat(camps.map(c => [c, ZR.fmtDate(c)])))}
      ${filterSelect("eye", "cond", "Condition", [["", "All conditions"]].concat(LISTS.eyeFlags).concat([[ZR.NONE_LABEL, ZR.NONE_LABEL]]))}
      ${filterSelect("eye", "sex", "Sex", [["", "All"], ["M", "Male"], ["F", "Female"]])}
      ${filterSelect("eye", "age", "Age group", [["", "All ages"]].concat(LISTS.eyeAgeGroups.map(g => g[1])).concat(["Age not recorded"]))}
      ${filterSelect("eye", "district", "District", [["", "All districts"]].concat(Clinic.districts()))}</div>
    <div id="results">${LIST_ROWS.eye()}</div>`;
};

function eyeConditions(r) { return LISTS.eyeFlags.filter(f => r[f[0]]).map(f => f[1]).join(", "); }

LIST_ROWS.eye = () => {
  const f = filt("eye"), q = f.search.trim().toLowerCase(), flags = LISTS.eyeFlags.map(x => x[0]);
  const rows = Clinic.t.eye_patients.filter(r => {
    if (f.camp && r.camp_date !== f.camp) return false;
    if (f.sex && (r.sex || "") !== f.sex) return false;
    if (f.district && (r.district || "").toLowerCase() !== f.district.toLowerCase()) return false;
    if (f.age && eyeAgeGroup(r.age_years) !== f.age) return false;
    if (f.cond === ZR.NONE_LABEL ? flags.some(c => r[c]) : f.cond && !r[f.cond]) return false;
    return !q || [r.patient, r.address, r.findings, r.visual_acuity, r.nin, r.contact, r.notes].some(x => contains(x, q));
  }).sort((x, y) => y.camp_date.localeCompare(x.camp_date) || x.patient.toLowerCase().localeCompare(y.patient.toLowerCase()));
  const sum = c => rows.reduce((s, r) => s + (r[c] ? 1 : 0), 0);
  return `<p class="muted">${rows.length.toLocaleString("en-US")} patients · ${rows.filter(r => r.sex === "M").length} male · ${rows.filter(r => r.sex === "F").length} female · cataract ${sum("cataract")} · reading glasses ${sum("presbyopia")} · referred ${sum("referred")}</p>` +
    limited("eye", rows, r => `<div class="card row" data-act="eyeEdit" data-uid="${esc(r.uid)}">
      <div class="grow"><div class="name">${esc(r.patient)} <span class="muted">${esc(r.age || "")} ${esc(r.sex || "")}</span></div>
        <div class="muted">${esc(ZR.fmtDate(r.camp_date))}${r.district ? " · " + esc(r.district) : ""}${r.glasses ? " · " + esc(r.glasses) : ""}</div>
        <div class="muted">${esc(eyeConditions(r) || r.findings || "")}</div></div></div>`);
};

function eyeForm(r, keep) {
  const values = r ? Object.assign({}, r) : {camp_date: keep ? keep.camp_date : today(), district: keep ? keep.district : "", sex: ""};
  const auto = () => {   // the ticks and glasses power fill in from what is written (check them)
    const acuity = document.getElementById("f_visual_acuity").value, findings = document.getElementById("f_findings").value;
    const flags = flagsFromText(acuity, findings);
    for (const c in flags) document.getElementById("f_" + c).checked = !!flags[c];
    const g = glassesPower(findings);
    if (g) document.getElementById("f_glasses").value = LISTS.glasses.includes(g) ? g : "";
  };
  openForm({title: r ? "Change patient" : "New eye camp patient", tab: "eye", backTo: {name: "eye"}, backLabel: "Eye Camps", values,
    fields: [{k: "camp_date", label: "Camp date", type: "date", max: today()}, {k: "patient", label: "Patient name"},
      {k: "age", label: "Age (e.g. 45y)"}, {k: "sex", label: "Sex", type: "select", options: [["", "Choose…"], ["M", "Male"], ["F", "Female"]]},
      {k: "district", label: "District", type: "pick", options: () => Clinic.districts()}, {k: "address", label: "Address"},
      {k: "nin", label: "National ID"}, {k: "contact", label: "Contact", type: "tel"},
      {k: "visual_acuity", label: "Visual acuity", onchange: auto}, {k: "findings", label: "Findings / treatment", type: "area", onchange: auto},
      {k: "glasses", label: "Glasses power", type: "select", options: LISTS.glasses.map(g => [g, g || "None"])}]
      .concat(LISTS.eyeFlags.map(f => ({k: f[0], label: f[1], type: "check"}))).concat([{k: "notes", label: "Notes", type: "area"}]),
    save(x) {
      if (!x.patient) return "Please enter the patient's name.";
      if (!x.camp_date) return "Please enter the camp date.";
      Clinic.save("eye_patients", r ? r.uid : null, x);
      toast("Patient saved");
    },
    after(x) { if (r) go({name: "eye"}); else eyeForm(null, x); },
    saveLabel: r ? "Save" : "Save and add the next patient",
    del: r ? () => Clinic.remove("eye_patients", r.uid) : null, delAsk: "Delete this patient?", delText: r ? esc(r.patient) : ""});
}
ACTIONS.eyeNew = () => eyeForm(null);
ACTIONS.eyeEdit = d => eyeForm(Clinic.by.eye_patients.get(d.uid));

// ------------------------------------------------------------------ HIV Tests

const HIV_LABEL = {"<15": "Under 15", "15-24": "15-24", "25-49": "25-49", "50+": "50 and over"};

PAGES.hiv = () => {
  filt("hiv", {range: "This year", age: "", result: "", location: ""});
  return `${noData()}<div class="row2"><button class="primary" data-act="hivNew">+ Add a line</button>
      <button data-act="goTab" data-tab="home">Count on a tally</button></div>
    ${searchBox("hiv", "Search place, notes…")}
    <div class="filters">${filterSelect("hiv", "range", "Dates", RANGE_NAMES)}
      ${filterSelect("hiv", "age", "Age group", [["", "All ages"]].concat(LISTS.hivAges.map(a => [a, HIV_LABEL[a]])))}
      ${filterSelect("hiv", "result", "Result", [["", "All results"], "Negative", "Positive"])}
      ${filterSelect("hiv", "location", "Location", [["", "All locations"]].concat(Clinic.hivLocations()))}</div>
    <div id="results">${LIST_ROWS.hiv()}</div>`;
};

LIST_ROWS.hiv = () => {
  const f = filt("hiv"), [a, b] = rangeOf(f.range), q = f.search.trim().toLowerCase();
  const rows = Clinic.mergedHiv().filter(r => {
    if (a && (r.test_date < a || r.test_date > b)) return false;
    if (f.age && r.age_group !== f.age) return false;
    if (f.result && r.result !== f.result) return false;
    if (f.location && (r.location || "").toLowerCase() !== f.location.toLowerCase()) return false;
    return !q || [r.location, r.age_group, r.result, r.notes].some(x => contains(x, q));
  }).sort((x, y) => y.test_date.localeCompare(x.test_date) || y.id - x.id);
  const t = rows.reduce((s, r) => s + (r.total || 0), 0), pos = rows.filter(r => r.result === "Positive").reduce((s, r) => s + (r.total || 0), 0);
  return `<p class="muted">Tested ${money(t)} · Negative ${money(t - pos)} · Positive ${money(pos)}${t ? ` (${ZR.pyFixed(100 * pos / t, 1)}%)` : ""}</p>` +
    limited("hiv", rows, r => `<div class="card row" data-act="hivEdit" data-uid="${esc(r.uid || "")}" data-session="${esc(r.session || "")}">
      <div class="grow"><div class="name ${r.result === "Positive" ? "pos" : ""}">${esc(HIV_LABEL[r.age_group] || r.age_group || "")} · ${esc(r.result)}</div>
        <div class="muted">${esc(ZR.fmtDate(r.test_date))} · ${esc(r.location || "")}${r.session ? " · on a tally" : ""}</div></div>
      <div class="amt"><b>${money(r.total)}</b><br><span class="muted">M ${r.male} F ${r.female}</span></div></div>`);
};

function hivForm(r) {
  const values = r ? Object.assign({}, r) : {test_date: today(), location: filt("hiv").lastLocation || "", result: "", age_group: ""};
  openForm({title: r ? "Change line" : "Add HIV tests", tab: "hiv", backTo: {name: "hiv"}, backLabel: "HIV Tests", values,
    fields: [{k: "test_date", label: "Date", type: "date", max: today()}, {k: "location", label: "Location", type: "pick", options: () => Clinic.hivLocations()},
      {k: "age_group", label: "Age group", type: "select", options: [["", "Choose…"]].concat(LISTS.hivAges.map(a => [a, HIV_LABEL[a]]))},
      {k: "result", label: "Result", type: "select", options: [["", "Choose…"], "Negative", "Positive"]},
      {k: "male", label: "Male", type: "num"}, {k: "female", label: "Female", type: "num"}, {k: "notes", label: "Notes"}],
    save(x) {
      if (!x.test_date) return "Please enter a valid date.";
      if (!x.location) return "Please choose or type the location.";
      if (!x.age_group) return "Choose the age group.";
      if (!x.result) return "Choose the result: Negative or Positive.";
      if (Number.isNaN(x.male) || Number.isNaN(x.female)) return "Male and female must be whole numbers.";
      x.male = x.male || 0; x.female = x.female || 0;
      if (!x.male && !x.female) return "Enter the number of males and/or females tested.";
      filt("hiv").lastLocation = x.location;
      Clinic.save("hiv_tests", r ? r.uid : null, Object.assign({source: r ? r.source : null}, x));
      toast("Saved");
    },
    del: r ? () => Clinic.remove("hiv_tests", r.uid) : null, delAsk: "Delete this line?", delText: r ? `${esc(ZR.fmtDate(r.test_date))} · ${esc(r.result)}` : ""});
}
ACTIONS.hivNew = () => hivForm(null);
ACTIONS.hivEdit = d => {
  if (d.session) { go({name: "session", id: d.session, tab: "hiv"}); return; }
  hivForm(Clinic.by.hiv_tests.get(d.uid));
};

// ------------------------------------------------------------------ Revenue & Expenses

const costLabel = c => { const x = Clinic.reportData().codeName[c]; return x ? `${c} - ${x}` : "(no code yet)"; };

PAGES.money = () => {
  filt("money", {range: "This month", code: "*", auto: true});
  const D = Clinic.reportData();
  const cash = D.entries.reduce((s, e) => s + e.amount_in - e.amount_out, 0);
  return segments([["money", "Ledger"], ["names", "Names & Staff"]], "money") + noData() +
    `<div class="stats"><b>Cash balance:</b> ${money(cash)} UGX</div>
    <button class="primary wide" data-act="entryNew">+ New entry</button>
    ${searchBox("money", "Search description, name, amount…")}
    <div class="filters">${filterSelect("money", "range", "Dates", RANGE_NAMES)}
      ${filterSelect("money", "code", "Cost code", [["*", "All cost codes"]].concat(D.reportCodes.map(c => [c, costLabel(c)])))}</div>
    <label class="check"><input type="checkbox" data-filter="auto" data-page="money" ${filt("money").auto ? "checked" : ""}> Include daily patient income (101)</label>
    <div id="results">${LIST_ROWS.money()}</div>`;
};

LIST_ROWS.money = () => {
  const f = filt("money"), D = Clinic.reportData(), [a, b] = rangeOf(f.range), q = f.search.trim().toLowerCase();
  const rows = D.entries.filter(e => {
    if (!f.auto && e.auto) return false;
    if (a && (!e.date || e.date < a || e.date > b)) return false;
    if (f.code !== "*" && e.code !== f.code) return false;
    return !q || [e.description, e.from_party, e.to_party, e.code, e.notes, e.amount_in, e.amount_out, money(e.amount_in), money(e.amount_out), ZR.fmtDate(e.date)].some(x => contains(x, q));
  }).reverse();
  const tin = rows.reduce((s, e) => s + e.amount_in, 0), tout = rows.reduce((s, e) => s + e.amount_out, 0);
  return `<p class="muted">${rows.length.toLocaleString("en-US")} entries · in ${money(tin)} · out ${money(tout)} · net ${money(tin - tout)}</p>` +
    limited("money", rows, e => `<div class="card row" data-act="entryEdit" data-id="${e.id === null ? "" : e.id}" data-date="${esc(e.date || "")}">
      <div class="grow"><div class="name">${esc(e.description || "(no description)")}</div>
        <div class="muted">${esc(ZR.fmtDate(e.date))} · ${esc(e.code || "no code")}${e.amount_in ? (e.from_party ? " · from " + esc(e.from_party) : "") : (e.to_party ? " · to " + esc(e.to_party) : "")}</div></div>
      <div class="amt ${e.amount_in ? "neg" : "pos"}"><b>${e.amount_in ? "+" + money(e.amount_in) : "-" + money(e.amount_out)}</b></div></div>`);
};

function entryForm(r, preset) {
  const values = r ? Object.assign({}, r) : Object.assign({entry_date: today()}, preset || {});
  const D = Clinic.reportData();
  const codeChanged = code => {   // revenue: money in, to the clinic. Expense: money out, from the clinic
    const kind = D.codeKind[code];
    const frm = document.getElementById("f_from_party"), to = document.getElementById("f_to_party");
    const mi = document.getElementById("f_amount_in"), mo = document.getElementById("f_amount_out");
    if (kind === "Revenue") {
      if (mo.value && !mi.value) mi.value = mo.value;
      mo.value = "";
      if (!to.value.trim()) to.value = CLINIC_NAME;
      if (frm.value.trim() === CLINIC_NAME) frm.value = "";
    } else if (kind === "Expense") {
      if (mi.value && !mo.value) mo.value = mi.value;
      mi.value = "";
      if (!frm.value.trim()) frm.value = CLINIC_NAME;
      if (to.value.trim() === CLINIC_NAME) to.value = "";
    }
    if (code === "101") toast("Daily patient income is added automatically; use 101 here only for extra patient payments.");
  };
  const buttons = [];
  if (r && (r.amount_in || r.amount_out)) buttons.push({label: "Split between two cost codes", run: () => splitEntry(r)});
  const photo = r && Clinic.ledgerPhotos[r.uid];
  if (photo) buttons.push({label: "See the receipt photo", run: () => showPhoto(photo)});
  openForm({title: r ? "Change entry" : "New entry", tab: "money", backTo: {name: "money"}, backLabel: "Revenue & Expenses", values,
    fields: [{k: "entry_date", label: "Date", type: "date", max: today()},
      {k: "cost_code", label: "Cost code", type: "select", options: () => [["", "Choose…"]].concat(D.allCodes.map(c => [c, costLabel(c)])), onchange: codeChanged},
      {k: "description", label: "Description"}, {k: "amount_in", label: "Money in (UGX)", type: "num"}, {k: "amount_out", label: "Money out (UGX)", type: "num"},
      {k: "from_party", label: "From", type: "pick", options: () => Clinic.names()}, {k: "to_party", label: "To", type: "pick", options: () => Clinic.names()},
      {k: "notes", label: "Notes", type: "area"}],
    buttons,
    save(x) {
      if (!x.entry_date) return "Please enter a valid date.";
      if (!x.cost_code) return "Please choose a cost code.";
      if (!x.description) return "Please write a short description.";
      if (Number.isNaN(x.amount_in) || Number.isNaN(x.amount_out)) return "Amounts must be numbers, e.g. 25000 or 25,000 or 25k.";
      x.amount_in = x.amount_in || 0; x.amount_out = x.amount_out || 0;
      if (!x.amount_in && !x.amount_out) return "Please enter the amount.";
      if (x.amount_in && x.amount_out) return "Enter either money in or money out, not both.";
      if (preset && preset.receipt_uid) x.receipt_uid = preset.receipt_uid;
      Clinic.save("ledger", r ? r.uid : null, x);
      toast("Entry saved");
    },
    del: r ? () => Clinic.remove("ledger", r.uid) : null, delAsk: "Delete this entry?", delText: r ? esc(r.description || "") : ""});
}

async function splitEntry(r) {
  const total = (r.amount_in || 0) + (r.amount_out || 0);
  const D = Clinic.reportData();
  const code = await sheet(`<h2>Split this entry</h2><p class="muted">${money(total)} UGX stays under ${esc(r.cost_code)}, except the part you move. Which cost code gets the second part?</p>` +
    D.allCodes.map(c => `<button class="pick" data-act="sheetResult" data-v="${esc(c)}">${esc(costLabel(c))}</button>`).join("") +
    `<button class="wide" data-act="sheetResult" data-v="">Cancel</button>`);
  if (!code) return;
  const v = await keypad("Amount for the second part", String(Math.floor(total / 2)), {max: 12, ok: "Split", number: true});
  if (v === null || v === undefined || v === "") return;
  const second = Number(v);
  if (!(second > 0 && second < total)) { toast("The second part must be more than 0 and less than the whole amount."); return; }
  const isIn = !!r.amount_in, first = total - second, note = `Split from one entry of ${ZR.fmtNum(total)}`;
  const notes = [r.notes, note].filter(Boolean).join("; ");
  const base = {entry_date: r.entry_date, description: r.description, to_party: r.to_party, from_party: r.from_party, notes};
  Clinic.save("ledger", r.uid, Object.assign({}, base, {cost_code: r.cost_code, amount_in: isIn ? first : 0, amount_out: isIn ? 0 : first}));
  Clinic.save("ledger", null, Object.assign({}, base, {cost_code: code, amount_in: isIn ? second : 0, amount_out: isIn ? 0 : second}));
  toast("Entry split");
  go({name: "money"});
}

ACTIONS.entryNew = () => entryForm(null);
ACTIONS.entryEdit = d => {
  if (!d.id) {
    toast("Daily patient income comes from Patient Billing.");
    return;
  }
  const r = Clinic.t.ledger.find(x => x.id === Number(d.id));
  if (r) entryForm(r);
};

// ------------------------------------------------------------------ Names & Staff

PAGES.names = () => {
  const listed = new Set(Clinic.people.map(p => p.name.toLowerCase()).concat([CLINIC_NAME.toLowerCase(), PATIENTS.toLowerCase()]));
  const others = Clinic.usedNames().filter(n => !listed.has(n.toLowerCase()));
  return segments([["money", "Ledger"], ["names", "Names & Staff"]], "names") + noData() +
    `<p class="muted">The names that come first when choosing From and To.</p>
    <button class="primary wide" data-act="personNew">+ Add a name</button>
    ${Clinic.people.map(p => `<div class="card row" data-act="personEdit" data-name="${esc(p.name)}"><div class="grow"><div class="name">${esc(p.name)}</div>
       <div class="muted">${esc(p.type)}${p.role ? " · " + esc(p.role) : ""}</div></div></div>`).join("")}
    <h3>Other names used in entries</h3><p class="muted">Tap to take a name off the From and To lists (or put it back). The entries keep it.</p>
    ${others.map(n => { const off = Clinic.hidden.has(n.toLowerCase());
      return `<div class="card row" data-act="nameToggle" data-name="${esc(n)}"><div class="grow">${esc(n)}</div>
        <span class="status ${off ? "st-new" : "st-sent"}">${off ? "Off the lists" : "On the lists"}</span></div>`; }).join("")}`;
};

function personForm(p) {
  openForm({title: p ? "Change name" : "Add a name", tab: "money", backTo: {name: "names"}, backLabel: "Names & Staff",
    values: p ? Object.assign({}, p) : {type: "Staff"},
    fields: [{k: "name", label: "Name"}, {k: "role", label: "Role (optional)"}, {k: "type", label: "Type", type: "select", options: LISTS.personTypes}],
    save(x) {
      if (!x.name) return "Please type a name.";
      Clinic.add({op: "person_save", name: x.name, role: x.role, type: x.type, old_name: p ? p.name : null});
      toast("Saved");
    },
    del: p ? () => Clinic.add({op: "person_delete", name: p.name}) : null, delLabel: "Remove from the list",
    delAsk: "Remove this name?", delText: "Entries that used it are not changed."});
}
ACTIONS.personNew = () => personForm(null);
ACTIONS.personEdit = d => personForm(Clinic.people.find(p => p.name === d.name));
ACTIONS.nameToggle = d => {
  Clinic.add({op: Clinic.hidden.has(d.name.toLowerCase()) ? "name_show" : "name_hide", name: d.name});
  render(false);
};
