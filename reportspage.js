/* The Reports tab: the same reports as the computer, as a PDF to open, save to the phone or share
   (WhatsApp, Gmail, Drive...), or as an Excel file. */
"use strict";

const REPORT_KINDS = FINANCE ? {money: Object.keys(ZR.CASH_FLOW).concat(Object.keys(ZR.EXPENSES))} : ZR.KINDS;
const R = {kind: REPORT_KINDS.money[0], preset: "This year", from: "", to: "", ticks: {}, search: "", person: "", dx: "", immLoc: "", immProg: "",
  eyeDist: "", hivLoc: "", inc: {table: true, pies: true, bars: true, line: false, entries: true, photos: false}, page: "auto", rep: null, file: null};
const REPORT_PRESETS = ["This month", "Last month", "This quarter", "This year", "Last year", "Today", "This week", "All time", "Custom dates"];
const REPORT_GROUPS = {money: FINANCE ? "Cash flow and expenses" : "Revenue & expenses", visits: "Patient visits", imm: "Immunisations", eye: "Eye camps", hiv: "HIV tests", receipts: "Receipts"};
const PREVIEW_ROWS = 300;

function reportMode() { return ZR.modeOf(R.kind); }
const isCash = () => !!ZR.CASH_FLOW[R.kind];
const isExpenses = () => !!ZR.EXPENSES[R.kind];

function tickItems() {
  const D = Clinic.reportData(), s = D.snap, m = reportMode();
  if (m === "money" || m === "receipts") return D.reportCodes.map(c => [c, ZR.codeLabel(D, c)]);
  if (m === "visits") return s.dx_categories.map(c => [c, c]);
  if (m === "imm") return s.imm_vaccines.map(v => [v, v]);
  if (m === "eye") return s.eye_flags.concat([[ZR.NONE_LABEL, ZR.NONE_LABEL]]);
  return ZR.HIV_AGE_GROUPS.map(a => [a, ZR.HIV_AGE_LABEL[a]]);
}

function currentTicks() {
  const items = tickItems(), saved = R.ticks[reportMode()];
  return saved ? saved.filter(k => items.some(i => i[0] === k)) : items.map(i => i[0]);
}

PAGES.reports = () => {
  if (!Clinic.has()) return noData();
  const D = Clinic.reportData(), s = D.snap, m = reportMode(), cash = isCash();
  const kinds = Object.keys(REPORT_KINDS).map(g => `<optgroup label="${esc(REPORT_GROUPS[g])}">` +
    REPORT_KINDS[g].map(k => `<option ${k === R.kind ? "selected" : ""}>${esc(k)}</option>`).join("") + `</optgroup>`).join("");
  const sel = (key, label, options, first) => `<label class="label">${esc(label)}</label><select data-r="${key}">` +
    (first ? `<option value="">${esc(first)}</option>` : "") +
    options.map(o => `<option ${o === R[key] ? "selected" : ""}>${esc(o)}</option>`).join("") + `</select>`;
  let extra = "";
  if (R.kind === ZR.BY_PERSON) extra = `<label class="label">Name (part of a name is enough; blank = everyone)</label><input data-r="person" type="text" value="${esc(R.person)}" autocomplete="off">`;
  if (m === "visits") extra = `<label class="label">Diagnosis (part of one; blank = all)</label><input data-r="dx" type="text" value="${esc(R.dx)}" autocomplete="off">`;
  if (m === "imm") extra = sel("immLoc", "Location", s.imm_locations, "All locations") + sel("immProg", "Programme", s.imm_programmes, "All programmes");
  if (m === "eye") extra = sel("eyeDist", "District", s.eye_districts, "All districts");
  if (m === "hiv") extra = sel("hivLoc", "Location", s.hiv_locations, "All locations");
  const on = new Set(currentTicks()), items = tickItems();
  const tickLabel = {imm: "Vaccines", visits: "Diagnosis groups", eye: "Conditions", hiv: "Age groups", receipts: "Cost codes"}[m] || "Categories";
  const ticks = cash ? `<p class="muted">Every category is included, so the balances are true.</p>` :
    `<details class="ticks"><summary>${tickLabel}: ${on.size === items.length ? "all" : on.size + " of " + items.length} ticked</summary>
      <div class="row2 small-row"><button data-act="tickAll" data-q="all">All</button><button data-act="tickAll" data-q="none">None</button>
        ${m === "money" || m === "receipts" ? `<button data-act="tickAll" data-q="rev">Revenue</button><button data-act="tickAll" data-q="exp">Expenses</button>` : ""}</div>
      ${items.map(([k, label], i) => `<label class="check"><input type="checkbox" data-tick="${i}" ${on.has(k) ? "checked" : ""}> ${esc(label)}</label>`).join("")}</details>`;
  const box = (key, label, off) => `<label class="check ${off ? "off" : ""}"><input type="checkbox" data-inc="${key}" ${R.inc[key] && !off ? "checked" : ""} ${off ? "disabled" : ""}> ${esc(label)}</label>`;
  const photoLabel = m === "receipts" || isExpenses() ? "Receipt photos" : cash ? "Cash book photos" : "Tally sheet photos";
  return `${FINANCE ? `<h2 style="margin-top:4px">Reports</h2>` : ""}
    <p class="muted">Records up to ${esc(Clinic.base.made ? ZR.fmtDate(Clinic.base.made.slice(0, 10)) : "")}${Clinic.pendingCount() ? " plus changes on this phone" : ""}.</p>
    <div class="card form">
      <label class="label">Report</label><select data-r="kind">${kinds}</select>
      ${extra}
      <label class="label">Dates</label><select data-r="preset">${REPORT_PRESETS.map(p => `<option ${p === R.preset ? "selected" : ""}>${p}</option>`).join("")}</select>
      <div class="grid2"><div><label class="label">From</label><input data-r="from" type="date" value="${esc(R.from)}"></div>
        <div><label class="label">To</label><input data-r="to" type="date" value="${esc(R.to)}"></div></div>
      ${ticks}
      <label class="label">Search words (optional)</label><input data-r="search" type="text" value="${esc(R.search)}" autocomplete="off" ${cash ? "disabled" : ""}>
    </div>
    <div class="card form"><div class="name">Include in the PDF</div>
      ${box("table", "Table")}${box("pies", "Pie charts")}${box("bars", m === "eye" ? "Bar graph by age group" : "Bar graph by month")}
      ${box("line", {imm: "Doses line graph", visits: "Visits line graph", hiv: "Tests line graph"}[m] || "Balance line graph", m === "eye" || m === "receipts" || isExpenses())}
      ${box("entries", ZR.listsEntries(R.kind) ? "Line by line entries (this report's table already lists them)" : "Line by line entries, after the charts", ZR.listsEntries(R.kind))}
      ${box("photos", photoLabel, !(m === "imm" || m === "receipts" || cash || isExpenses()))}
      <label class="label">Page</label><select data-r="page"><option value="auto" ${R.page === "auto" ? "selected" : ""}>Automatic</option>
        <option value="portrait" ${R.page === "portrait" ? "selected" : ""}>Portrait (tall)</option><option value="landscape" ${R.page === "landscape" ? "selected" : ""}>Landscape (wide)</option></select>
    </div>
    <button class="send wide" data-act="reportPdf" id="pdfBtn">Make PDF</button>
    <div class="grid2"><button data-act="reportShow">Show on screen</button><button data-act="reportXlsx">Make Excel file</button></div>
    ${FINANCE ? "" : `<button class="wide small" data-act="exportAll">Export everything to Excel</button>`}
    <div id="ready">${readyHtml()}</div>
    <div id="repOut"></div>`;
};

function readyHtml() {
  if (!R.file) return "";
  return `<div class="card result ok"><div>Ready: ${esc(R.file)}</div>
    <div class="grid3" style="margin-top:8px"><button data-act="outOpen">Open</button><button data-act="outSave">Save to phone</button><button class="send" data-act="outShare">Share</button></div></div>`;
}

function reportParams() {
  const ticks = currentTicks(), m = reportMode();
  if (!ticks.length && !isCash()) {
    throw new Error("Tick at least one " + ({imm: "vaccine", visits: "diagnosis group", eye: "condition", hiv: "age group", receipts: "cost code"}[m] || "category") + " (or press All).");
  }
  if (R.from && R.to && R.from > R.to) throw new Error("The From date is after the To date.");
  return {kind: R.kind, start: R.from || null, end: R.to || null, ticks, search: isCash() ? "" : R.search.trim(), person: R.person.trim(), dx: R.dx.trim(),
    location: m === "imm" ? R.immLoc : R.hivLoc, programme: R.immProg, district: R.eyeDist, detail: R.inc.entries};
}

function buildReport() {
  try {
    const p = reportParams(), rep = ZR.build(Clinic.reportData(), p);
    rep._p = p;
    R.rep = rep;
    return rep;
  } catch (e) { toast(e.message); return null; }
}

function showReport(rep) {
  const D = Clinic.reportData(), money_ = new Set(rep.money_cols), right = new Set(rep.money_cols), totals = new Set(rep.total_rows);
  rep.columns.forEach((c, i) => { if (c === "Entries" || c === "Visits") right.add(i); });
  const idx = [];
  rep.rows.forEach((r, i) => { if (i < PREVIEW_ROWS || totals.has(i)) idx.push(i); });
  let html = `<h3>${esc(rep.title)}</h3><p class="muted">${esc(ZR.caption(D, rep, rep._p.search, " · "))}</p>
    <div class="tablewrap"><table class="rep"><thead><tr>${rep.columns.map((c, i) => `<th class="${right.has(i) ? "r" : ""}">${esc(c)}</th>`).join("")}</tr></thead><tbody>`;
  for (const i of idx) {
    html += `<tr class="${totals.has(i) ? "total" : ""}">` + rep.rows[i].map((v, j) => `<td class="${right.has(j) ? "r" : ""}">${esc(typeof v === "number" && money_.has(j) ? ZR.fmtNum(v) : v === null || v === undefined ? "" : v)}</td>`).join("") + `</tr>`;
  }
  html += `</tbody></table></div>`;
  if (idx.length < rep.rows.length) html += `<p class="muted">Showing the first ${PREVIEW_ROWS} of ${rep.rows.length} rows here. The PDF has them all.</p>`;
  if (rep.note) html += `<p class="muted">${esc(rep.note)}</p>`;
  $("#repOut").innerHTML = html;
  $("#repOut").scrollIntoView({behavior: "smooth", block: "start"});
}

function imageSize(data) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
    img.onerror = () => resolve([1, 1]);
    img.src = data;
  });
}

async function reportPhotos(rep) {
  let list = [], title = "", empty = "";
  if (rep.receipts) { list = rep.photos; title = rep.photos_title; empty = rep.photos_empty; }
  else if (ZR.CASH_FLOW[rep.title]) {
    title = "Cash book photos"; empty = "No cash book photos for these dates.";
    list = Clinic.t.cash_photos.filter(r => r.page_date >= rep.start && r.page_date <= rep.end).sort((a, b) => a.page_date.localeCompare(b.page_date) || a.id - b.id)
      .map(r => ({uid: r.uid, caption: [ZR.fmtDate(r.page_date), r.label, r.notes].filter(Boolean).join("  ·  ")}));
  } else if (ZR.EXPENSES[rep.title]) {
    title = "Receipt photos"; empty = "No receipt photos for these dates.";
    list = Clinic.t.phone_receipts.filter(r => r.receipt_date >= rep.start && r.receipt_date <= rep.end).sort((a, b) => a.receipt_date.localeCompare(b.receipt_date) || a.id - b.id)
      .map(r => ({uid: r.uid, caption: [ZR.fmtDate(r.receipt_date), r.code, r.amount === null || r.amount === undefined ? "" : ZR.fmtNum(r.amount) + " UGX"].filter(Boolean).join("  ·  ")}));
  } else {
    title = "Tally sheet photos"; empty = "No tally sheet photos have been added for these months.";
    const a = rep.start.slice(0, 7), b = rep.end.slice(0, 7);
    list = Clinic.t.imm_photos.filter(r => r.month >= a && r.month <= b).sort((x, y) => x.month.localeCompare(y.month) || x.id - y.id)
      .map(r => ({uid: r.uid, caption: [ZR.fmtDate(r.month + "-01").slice(3), r.label, r.tracking_no ? `tracking no. ${r.tracking_no}` : ""].filter(Boolean).join("  ·  ")}));
  }
  const out = [];
  for (const p of list) {
    await ensurePhoto(p.uid);
    const data = photoUrl(p.uid, false);
    if (!data) { out.push({caption: p.caption}); continue; }
    const [width, height] = await imageSize(data);
    out.push({data, width, height, caption: p.caption});
    forgetPhoto(p.uid);   // the report keeps its own copy; no need to hold two
    if (NATIVE && NATIVE.forgetFull) NATIVE.forgetFull(p.uid);
  }
  return {photos: out, photosTitle: title, photosEmpty: empty};
}


/* Hands a finished file to the Android side, a piece at a time. */
function handOver(name, base64) {
  if (!NATIVE) {
    const a = document.createElement("a");
    a.href = (name.endsWith(".pdf") ? "data:application/pdf;base64," : "data:application/octet-stream;base64,") + base64;
    a.download = name;
    window.__lastFile = {name, size: base64.length};
    R.file = name;
    return;
  }
  if (!NATIVE.outBegin(name)) throw new Error("the phone could not start the file");
  const size = 400000;   // whole groups of 4 base64 letters
  for (let i = 0; i < base64.length; i += size) {
    if (!NATIVE.outChunk(base64.slice(i, i + size))) throw new Error("the phone could not write the file. Is its storage full?");
  }
  if (!NATIVE.outEnd()) throw new Error("the phone could not finish the file");
  R.file = name;
}

function drawReady() {
  const el = $("#ready");
  if (el) { el.innerHTML = readyHtml(); el.scrollIntoView({behavior: "smooth", block: "center"}); }
}

Object.assign(ACTIONS, {
  reportShow() { const rep = buildReport(); if (rep) showReport(rep); },
  async reportPdf() {
    const rep = buildReport();
    if (!rep) return;
    const btn = $("#pdfBtn");
    btn.disabled = true;
    btn.textContent = "Making PDF…";
    await new Promise(r => setTimeout(r, 40));   // let the button change show before the work starts
    try {
      const m = reportMode(), wantPhotos = R.inc.photos && (m === "imm" || m === "receipts" || isCash() || isExpenses());
      const extra = wantPhotos ? await reportPhotos(rep) : {};
      const D = Clinic.reportData(), periods = isCash() || isExpenses();
      // A cash flow or expenses report: its table has the period totals, and the entries come after the charts.
      const main = periods ? ZR.build(D, Object.assign({}, rep._p, {detail: false})) : rep;
      const doc = ZPDF.make(D, main, {entries: R.inc.entries ? ZR.entries(D, rep._p) : null, table: R.inc.table, pies: R.inc.pies, bars: R.inc.bars, line: R.inc.line && m !== "eye" && m !== "receipts" && !isExpenses(),
        orientation: R.page, search: rep._p.search, photos: extra.photos, photosTitle: extra.photosTitle, photosEmpty: extra.photosEmpty}, window.ZION_LOGO);
      const uri = doc.output("datauristring");
      handOver(ZPDF.fileName(rep, rep._p.dx), uri.slice(uri.indexOf(",") + 1));
      drawReady();
    } catch (e) {
      toast("Could not make the PDF: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Make PDF";
    }
  },
  reportXlsx() {
    const rep = buildReport();
    if (!rep) return;
    try {
      const sheet_ = [[rep.title], [ZR.caption(Clinic.reportData(), rep, rep._p.search, "  ·  ")], [], rep.columns].concat(rep.rows);
      handOver(ZPDF.fileName(rep, rep._p.dx).replace(/\.pdf$/, ".xlsx"), xlsxBase64([[rep.title.slice(0, 31), sheet_]]));
      drawReady();
    } catch (e) { toast("Could not make the file: " + e.message); }
  },
  exportAll() {
    try {
      const D = Clinic.reportData(), sheets = [];
      for (const kind of ZR.KINDS.money) {
        if (kind === "Cash flow - daily" || kind === "Cash flow - weekly") continue;
        const rep = ZR.build(D, {kind, start: null, end: null, ticks: D.reportCodes, search: "", person: ""});
        sheets.push([kind.slice(0, 31), [rep.columns].concat(rep.rows)]);
      }
      const rows = (name, cols, tb) => sheets.push([name, [cols].concat(tb.map(r => cols.map(c => (r[c] === undefined ? null : r[c]))))]);
      rows("Patient Billing", ["visit_date", "patient", "age", "age_years", "contact", "diagnosis", "billed", "paid", "status", "notes"], Clinic.t.invoices);
      rows("Immunisations", ["imm_date", "vaccine", "dose", "age_group", "programme", "male", "female", "total", "location", "post", "notes"], Clinic.mergedImm());
      rows("Eye Camps", ["camp_date", "patient", "nin", "age", "sex", "district", "address", "contact", "visual_acuity", "findings", "glasses", "notes"], Clinic.t.eye_patients);
      rows("HIV tests", ["test_date", "location", "age_group", "result", "male", "female", "total", "notes"], Clinic.mergedHiv());
      rows("Receipt photos", ["receipt_date", "code", "amount", "device", "received_at"], Clinic.t.phone_receipts);
      handOver(`Zion Clinic ${ZR.fmtDate(today())}.xlsx`, xlsxBase64(sheets));
      drawReady();
    } catch (e) { toast("Could not make the file: " + e.message); }
  },
  tickAll(d) {
    const D = Clinic.reportData(), all = tickItems().map(i => i[0]);
    R.ticks[reportMode()] = d.q === "all" ? all : d.q === "none" ? [] : d.q === "rev" ? D.revenueCodes.slice() : D.expenseCodes.slice();
    render(false);
    const det = document.querySelector("details.ticks");
    if (det) det.open = true;
  },
  outOpen() { if (NATIVE) NATIVE.outOpen(); else toast("Opening works in the phone app"); },
  outShare() { if (NATIVE) NATIVE.outShare(); else toast("Sharing works in the phone app"); },
  outSave() {
    if (!NATIVE) { toast("Saving works in the phone app"); return; }
    const why = NATIVE.outSave();
    toast(why || "Saved in Downloads, in the Zion Clinic folder");
  },
});

/* What is typed or chosen on the page is kept in R, so it survives the page being redrawn. */
document.addEventListener("change", e => {
  const t = e.target, key = t.dataset && t.dataset.r;
  if (t.dataset && t.dataset.inc) { R.inc[t.dataset.inc] = t.checked; return; }
  if (t.dataset && t.dataset.tick !== undefined) {
    const items = tickItems();
    R.ticks[reportMode()] = Array.from(document.querySelectorAll("[data-tick]")).filter(b => b.checked).map(b => items[Number(b.dataset.tick)][0]);
    return;
  }
  if (!key) return;
  R[key] = t.type === "checkbox" ? t.checked : t.value;
  if (key === "kind") {
    const m = reportMode();
    if (m === "eye" && !["All time", "Custom dates"].includes(R.preset)) { R.preset = "All time"; applyPreset(); }
    if (m === "receipts") R.inc.photos = true;
    render(false);
  } else if (key === "preset") {
    applyPreset();
    render(false);
  } else if (key === "from" || key === "to") {
    R.preset = "Custom dates";
    render(false);
  }
});
document.addEventListener("input", e => {
  const key = e.target.dataset && e.target.dataset.r;
  if (key === "search" || key === "person" || key === "dx") R[key] = e.target.value;
});

function applyPreset() {
  if (R.preset === "Custom dates") return;
  const [a, b] = rangeOf(R.preset);
  R.from = a;
  R.to = b;
}

// ------------------------------------------------------------------ a small Excel file writer

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {   // [[name, Uint8Array]] -> Uint8Array (a zip without compression, which Excel accepts)
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const [name, data] of files) {
    const nm = enc.encode(name), crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
    const head = new Uint8Array([0x50, 0x4B, 3, 4, ...common]);
    parts.push(head, nm, data);
    central.push(new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nm);
    offset += head.length + nm.length + data.length;
  }
  const cSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cSize), ...u32(offset), ...u16(0)]);
  const all = parts.concat(central, [end]), out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

function xlsxBase64(sheets) {
  const enc = new TextEncoder(), x = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const col = i => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const used = new Set();
  const names = sheets.map(([n]) => {
    let name = n.replace(/[\\/*?:[\]]/g, "-").slice(0, 31), k = 2;
    while (used.has(name.toLowerCase())) name = n.slice(0, 28) + " " + k++;
    used.add(name.toLowerCase());
    return name;
  });
  const files = [["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`]];
  sheets.forEach(([, rows], i) => {
    const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
      if (v === null || v === undefined || v === "") return "";
      const ref = col(ci) + (ri + 1);
      return typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    }).join("") + `</row>`).join("");
    files.push([`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`]);
  });
  const zip = zipStore(files.map(([n, s]) => [n, enc.encode(s)]));
  let bin = "";
  for (let i = 0; i < zip.length; i += 32768) bin += String.fromCharCode.apply(null, zip.subarray(i, i + 32768));
  return btoa(bin);
}
