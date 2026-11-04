/* Starts the app: the lock first, and only then are the clinic's records read and shown. */
"use strict";

function start() {
  Clinic.load();
  // Receipts from app version 1.1 become photos like the others (those already sent are simply replaced).
  if (DATA.receipts) {
    for (const r of DATA.receipts) {
      if (r.hasPhoto) Clinic.savePhoto("receipt", r.id, {receipt_date: r.date, code: r.code || "", amount: r.amount === undefined ? null : r.amount});
    }
    delete DATA.receipts;
    save();
  }
  const last = DATA.lastView && DATA.sessions.find(s => s.id === DATA.lastView.id);
  if (last && last.date === today()) view = {name: "session", id: last.id, tab: DATA.lastView.tab};
  else if (DATA.lastTab && TABS.some(t => t[0] === DATA.lastTab)) view = {name: DATA.lastTab};
  applyPreset();
  render(true);
}

(window.ZION_READY || Promise.resolve()).then(() => {   // the iPhone reads its stored records first
  load();
  Lock.show(start);
});
