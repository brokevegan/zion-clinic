/* The photo tabs: Tally Sheets, Cash Book and Receipts. A photo stays inside the app (not in the phone's
   gallery) and goes to the computer at the next sync. */
"use strict";

const photoCache = {};
function photoUrl(id, thumb) {
  const k = id + (thumb ? "t" : "");
  if (!(k in photoCache)) {
    try {
      photoCache[k] = NATIVE ? NATIVE.photo(id, !!thumb) : localStorage.getItem((thumb ? "zion_thumb_" : "zion_photo_") + id) || "";
    } catch (e) { photoCache[k] = ""; }
  }
  return photoCache[k];
}
function forgetPhoto(id) { delete photoCache[id]; delete photoCache[id + "t"]; }

/* The iPhone reads a full-size photo from its database first, which takes a moment. */
async function ensurePhoto(id) { if (NATIVE && NATIVE.loadPhoto) { await NATIVE.loadPhoto(id); forgetPhoto(id); } }

function deletePhotoFile(id) {
  forgetPhoto(id);
  try {
    if (NATIVE) NATIVE.deletePhoto(id);
    else { localStorage.removeItem("zion_photo_" + id); localStorage.removeItem("zion_thumb_" + id); }
  } catch (e) { /* already gone */ }
}

/* Take a photo with the camera, or choose one already on the phone. Resolves "" when the photo is
   saved, "cancelled", or a message. The app keeps a smaller copy (enough to read the page). */
function capture(id, how) {
  return new Promise(resolve => {
    if (NATIVE) {
      const call = String(nextCall++);
      waiting[call] = r => resolve(r.code === 200 ? "" : (r.text || "No photo was taken"));
      if (how === "camera") NATIVE.takePhoto(call, id); else NATIVE.pickPhoto(call, id);
      return;
    }
    // In a browser (for testing): choose an image file and keep it in the browser's storage.
    const keep = async src => {
      try {
        localStorage.setItem("zion_photo_" + id, await shrink(src, 2000, 0.82));
        localStorage.setItem("zion_thumb_" + id, await shrink(src, 360, 0.7));
        resolve("");
      } catch (e) { resolve("The photo is too big to keep in this browser."); }
    };
    if (window.__testPhoto) { keep(window.__testPhoto); return; }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files[0];
      if (!f) { resolve("cancelled"); return; }
      const rd = new FileReader();
      rd.onload = () => keep(rd.result);
      rd.readAsDataURL(f);
    };
    input.click();
  });
}

function shrink(src, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = src;
  });
}

function monthChoices() {
  const t = new Date(), out = [];
  for (let i = 3; i >= -30; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() + i, 1);
    out.push([`${d.getFullYear()}-${pad(d.getMonth() + 1)}`, `${MONTHS[d.getMonth()]}-${d.getFullYear()}`]);
  }
  return out;
}

const thisMonth = () => today().slice(0, 7);
const expenseCodes = () => [["", "Not sure – choose on the computer"]].concat(
  LISTS.costCodes.map(c => [c.code, `${c.code} – ${c.label}`]));

const PHOTO_KINDS = {
  tally: {
    table: "imm_photos", title: "Tally Sheets", one: "tally sheet", dateKey: "month",
    intro: "Photos of the paper tally sheets, filed by month. Add them to the end of an immunisation report's PDF.",
    fresh: () => ({month: thisMonth(), label: "", tracking_no: ""}),
    fields: () => [{k: "month", label: "Month", type: "select", options: monthChoices},
      {k: "label", label: "Label (optional)"}, {k: "tracking_no", label: "Tracking number (optional)"}],
    head: r => ZR.fmtDate(r.month + "-01").slice(3),
    sub: r => [r.label, r.tracking_no ? "tracking no. " + r.tracking_no : ""].filter(Boolean).join(" · "),
    check: x => (x.month ? "" : "Choose the month."),
  },
  cash: {
    table: "cash_photos", title: "Cash Book", one: "cash book page", dateKey: "page_date",
    intro: "Photos of the paper cash flow pages, filed by date. Add them to the end of a cash flow report's PDF.",
    fresh: () => ({page_date: today(), label: "", notes: ""}),
    fields: () => [{k: "page_date", label: "Date of the page", type: "date", max: today()},
      {k: "label", label: "Label (optional, e.g. Page 12)"}, {k: "notes", label: "Notes (optional)"}],
    head: r => ZR.fmtDate(r.page_date),
    sub: r => [r.label, r.notes].filter(Boolean).join(" · "),
    check: x => (x.page_date ? "" : "Please enter the date."),
  },
  receipt: {
    table: "phone_receipts", title: "Receipts", one: "receipt", dateKey: "receipt_date",
    intro: "Take a photo of each receipt. The Receipt photos report turns them into a PDF.",
    fresh: () => ({receipt_date: today(), code: "", amount: null}),
    fields: () => [{k: "receipt_date", label: "Date on the receipt", type: "date", max: today()},
      {k: "code", label: "What was it for? (cost code, optional)", type: "select", options: expenseCodes},
      {k: "amount", label: "Amount paid (optional)", type: "num"}],
    head: r => ZR.fmtDate(r.receipt_date),
    sub: r => [r.code ? `${r.code} – ${(LISTS.costCodes.find(c => c.code === r.code) || {}).label || ""}` : "No cost code",
      r.amount !== null && r.amount !== undefined ? ZR.fmtNum(r.amount) + " UGX" : "", r.ledger_id ? `In ledger #${r.ledger_id}` : ""].filter(Boolean).join(" · "),
    check: x => (!x.receipt_date ? "Please enter the date." : Number.isNaN(x.amount) ? "The amount must be a number." : ""),
  },
};

const isPending = uid => Clinic.ops.some(o => o.uid === uid);

for (const kind of Object.keys(PHOTO_KINDS)) {
  const K = PHOTO_KINDS[kind];
  PAGES[kind] = () => {
    filt(kind, {year: ""});
    return `<h2 style="margin-top:4px">${esc(K.title)}</h2><p class="muted">${esc(K.intro)}</p>
      <div class="grid2"><button class="primary" data-act="photoNew" data-kind="${kind}" data-how="camera">📷 Take photo</button>
        <button data-act="photoNew" data-kind="${kind}" data-how="gallery">🖼 Choose photo</button></div>
      ${searchBox(kind, "Search date, label…")}
      <div id="results">${LIST_ROWS[kind]()}</div>`;
  };
  LIST_ROWS[kind] = () => {
    const q = filt(kind).search.trim().toLowerCase();
    const rows = Clinic.t[K.table].filter(r => !q || contains(K.head(r), q) || contains(K.sub(r), q))
      .sort((a, b) => String(b[K.dateKey]).localeCompare(String(a[K.dateKey])) || b.id - a.id);
    const have = NATIVE ? new Set(JSON.parse(NATIVE.photoList())) : null;
    return `<p class="muted">${rows.length} photo${rows.length === 1 ? "" : "s"}</p>` + limited(kind, rows, r => {
      const on = !have || have.has(r.uid);
      return `<div class="card receipt" data-act="photoOpen" data-kind="${kind}" data-uid="${esc(r.uid)}">
        ${on ? `<img class="thumb" src="${photoUrl(r.uid, true)}" alt="">` : `<div class="thumb none">Not on this phone yet</div>`}
        <div class="info"><div class="when">${esc(K.head(r))}</div><div class="muted">${esc(K.sub(r))}</div></div>
        ${isPending(r.uid) ? `<span class="status st-new">Not synced</span>` : ""}</div>`;
    });
  };
}

async function photoForm(kind, uid) {
  await ensurePhoto(uid);
  const K = PHOTO_KINDS[kind], r = Clinic.by[K.table].get(uid);
  openForm({title: K.title.replace(/s$/, ""), tab: kind, backTo: {name: kind}, backLabel: K.title, values: Object.assign({}, r),
    top: () => `<div class="photo-box" data-act="photoFull" data-uid="${esc(uid)}"><img src="${photoUrl(uid, false)}" alt="Photo">
      <span>Tap to see it full size</span></div>`,
    fields: K.fields(),
    buttons: [{label: "📷 Take again", run: () => photoAgain(kind, uid, "camera")}, {label: "🖼 Choose another", run: () => photoAgain(kind, uid, "gallery")}]
      .concat(kind === "receipt" && !r.ledger_id && !Object.values(Clinic.ledgerPhotos).includes(uid) ? [{label: "Make a ledger entry from this receipt", run: x => {
        entryForm(null, {entry_date: x.receipt_date, cost_code: x.code, amount_out: x.amount, from_party: CLINIC_NAME, receipt_uid: uid});
      }}] : []),
    save(x) {
      const err = K.check(x);
      if (err) return err;
      Clinic.save(K.table, uid, x);
      toast("Saved");
    },
    del() { Clinic.remove(K.table, uid); deletePhotoFile(uid); },
    delAsk: `Delete this ${K.one}?`, delText: "The photo is deleted here, and from the computer at the next sync."});
}

async function photoAgain(kind, uid, how) {
  const err = await capture(uid, how);
  if (err) { if (err !== "cancelled") toast(err); return; }
  forgetPhoto(uid);
  const vals = formValues();
  if (Number.isNaN(vals.amount)) vals.amount = null;
  Clinic.savePhoto(kind, uid, vals);
  photoForm(kind, uid);
}

async function showPhoto(uid) {
  await ensurePhoto(uid);
  const url = photoUrl(uid, false);
  if (!url) { toast("This photo is not on this phone yet: sync with the computer to get it."); return; }
  await sheet(`<img class="full" src="${url}" alt="Photo"><button class="primary wide" data-act="sheetResult" data-v="">Close</button>`);
}

Object.assign(ACTIONS, {
  async photoNew(d) {
    const uid = newId(), K = PHOTO_KINDS[d.kind];
    const err = await capture(uid, d.how);
    if (err) { if (err !== "cancelled") toast(err); return; }
    Clinic.savePhoto(d.kind, uid, K.fresh());
    photoForm(d.kind, uid);
  },
  photoOpen(d) { photoForm(d.kind, d.uid); },
  photoFull(d) { showPhoto(d.uid); },
});
