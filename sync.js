/* Two-way sync with the computer, locked backups, and the app's lock (fingerprint or PIN). */
"use strict";

let syncState = null;
function setSync(state) { syncState = state; if (view.name === "sync") render(false); }

function call(fn) {
  return new Promise(resolve => {
    const id = String(nextCall++);
    waiting[id] = resolve;
    fn(id);
  });
}

/* ---- the iPhone: a Home Screen app cannot call the laptop's plain http address, so changes go by locked files. */
function fileSyncPage() {
  const pending = toSend().length + DATA.deleted.length, ops = Clinic.pendingCount(), busy = syncState && syncState.busy;
  const bits = [];
  if (ops) bits.push(`${ops} change${ops === 1 ? "" : "s"} made on this phone`);
  if (pending) bits.push(`${pending} ${pending === 1 ? "tally" : "tallies"}`);
  return `<h2 style="margin-top:4px">Sync with the computer</h2>
    <div class="card"><b>On the laptop:</b> open Zion Clinic and press <b>Sync with phone</b>. Point the iPhone's Camera at the
      code marked <b>iPhone</b>, and open the page in Safari. The iPhone and the laptop must be on the same Wi-Fi.</div>
    <p>${bits.length ? `<b>Waiting to go:</b> ${bits.join(", ")}.` : "Nothing is waiting on this phone."}</p>
    <h3>1. Send your changes</h3>
    <button class="send wide" data-act="fileMake" ${busy ? "disabled" : ""}>Make the file for the computer</button>
    <p class="muted">Then press Share below, choose Save to Files, and on the laptop's page in Safari choose that file and press Send.</p>
    <div id="ready">${readyHtml()}</div>
    <h3>2. Get the latest records</h3>
    <p class="muted">On the same page in Safari, press Download the latest data. Then come back here.</p>
    <button class="primary wide" data-act="fileOpenData" ${busy ? "disabled" : ""}>Open the file from the computer</button>
    ${syncState && syncState.message ? `<div class="result ${syncState.ok ? "ok" : "bad"}">${syncState.message}</div>` : ""}
    ${Clinic.has() ? `<p class="muted">Records on this phone are from ${esc(ZR.fmtDate(Clinic.base.made.slice(0, 10)))} ${esc(Clinic.base.made.slice(11))}.</p>` : ""}
    <p class="muted">If the same record was changed in both places, the latest change is kept.</p>
    <h3>Backup</h3><p class="muted">Makes one file with everything on this phone, locked with your backup password. Then choose Google Drive in the Share list, or Save to Files.</p>
    <button class="wide" data-act="backupNow" ${busy ? "disabled" : ""}>Back up to Google Drive…</button>
    <button class="wide small" data-act="backupRestore" ${busy ? "disabled" : ""}>Restore from a backup…</button>
    <h3>This app</h3>
    <button class="wide small" data-act="syncCodeChange">Change the sync code</button>
    <button class="wide small" data-act="pinChange">Change the PIN</button>
    <button class="wide small" data-act="lockNow">Lock now</button>
    <p class="muted" style="text-align:center;margin-top:18px">Zion Clinic ${esc(LISTS.appVersion)} for iPhone</p>`;
}

async function askSyncCode(message) {
  const v = await sheet(`<h2>Sync code</h2><p class="muted">${message || "The 8 letters and numbers shown in the laptop's Sync with phone window. You only type it once."}</p>
    <input id="sc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"><div class="grid2" style="margin-top:12px">
    <button data-act="sheetResult" data-v="">Cancel</button><button class="primary" data-act="scOk">OK</button></div>`);
  const code = (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code) NATIVE.setSyncCode(code);
  return code;
}

async function syncCode(message) { return NATIVE.syncCode() || askSyncCode(message); }

Object.assign(ACTIONS, {
  scOk() { closeSheet($("#sc").value); },
  syncCodeChange() { askSyncCode(); },
  async fileMake() {
    const code = await syncCode();
    if (!code) return;
    setSync({busy: true, ok: true, message: "Making the file…"});
    try {
      const fileId = newId(), list = toSend(), photos = [];
      for (const op of Clinic.ops.filter(o => o.op === "photo")) {
        const f = op.fields;
        photos.push({uid: op.uid, kind: op.kind, meta: Object.assign({}, f, {date: f.receipt_date || f.page_date}), data: await NATIVE.photoB64(op.uid)});
      }
      const hashes = {};
      for (const s of list) hashes[s.id] = hashOf(s);
      DATA.sentFiles = DATA.sentFiles || {};
      DATA.sentFiles[fileId] = {sessions: hashes, deleted: DATA.deleted.slice()};
      for (const o of Clinic.ops) (o.files = o.files || []).push(fileId);
      Clinic.persist();
      save();
      const msg = {type: "file_sync", file_id: fileId, now: Date.now(), device_id: DATA.deviceId, device_name: deviceName(), app_version: LISTS.appVersion,
        ops: Clinic.ops.filter(o => o.op !== "photo"), photos, sessions: list.map(exportSession), deleted: DATA.deleted.slice(), have: JSON.parse(NATIVE.photoList())};
      const t = new Date(), stamp = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}${pad(t.getMinutes())}`;
      R.file = await NATIVE.lockOut(JSON.stringify(msg), code, `Zion changes ${stamp}.zionsync`);
      setSync({busy: false, ok: true, message: "File ready. Press Share above and choose Save to Files."});
    } catch (e) { setSync({busy: false, ok: false, message: "The file could not be made: " + esc(e.message)}); }
  },
  async fileOpenData() {
    const file = await NATIVE.pickData();
    if (!file) return;
    let code = await syncCode(), snap = null;
    if (!code) return;
    setSync({busy: true, ok: true, message: "Opening the file…"});
    for (let tries = 0; tries < 3 && !snap; tries++) {
      try { snap = await NATIVE.openData(file, code); } catch (e) {
        if (e.message === "not-a-zion-file") { setSync({busy: false, ok: false, message: "That is not the file from the computer. Choose the one named Zion data…"}); return; }
        code = await askSyncCode("That code did not open the file. Check the code in the laptop's Sync with phone window.");
        if (!code) { setSync({busy: false, ok: false, message: "The file was not opened."}); return; }
      }
    }
    if (!snap) { setSync({busy: false, ok: false, message: "The file was not opened."}); return; }
    if (snap.format !== 2) { setSync({busy: false, ok: false, message: "This file is from an older program. Please update the program on the laptop."}); return; }
    try {
      const incoming = snap.photo_data || {}, ids = Object.keys(incoming), applied = snap.applied_files || [], notes = snap.file_notes || [];
      let n = 0;
      for (const uid of ids) { setSync({busy: true, ok: true, message: `Keeping photo ${++n} of ${ids.length}…`}); await NATIVE.keepPhotoB64(uid, incoming[uid]); }
      delete snap.photo_data; delete snap.applied_files; delete snap.file_notes;
      writeFile("base", JSON.stringify(snap));
      // what the computer has now applied is finished with here; anything newer stays waiting
      Clinic.ops = Clinic.ops.filter(o => !(o.files || []).some(f => applied.includes(f)));
      Clinic.persist();
      for (const id of applied) {
        const sent = (DATA.sentFiles || {})[id];
        if (!sent) continue;
        for (const s of DATA.sessions) if (sent.sessions[s.id]) { s.sentHash = sent.sessions[s.id]; s.sentAt = Date.now(); }
        DATA.deleted = DATA.deleted.filter(d => !sent.deleted.includes(d));
        delete DATA.sentFiles[id];
      }
      save();
      Clinic.load();
      const have = JSON.parse(NATIVE.photoList()), keep = new Set((Clinic.base.photos || []).concat(Clinic.ops.filter(o => o.op === "photo").map(o => o.uid)));
      for (const u of have) if (!keep.has(u)) deletePhotoFile(u);
      R.file = null;
      setSync({busy: false, ok: true, message: `Done ✓ Records from ${esc(ZR.fmtDate(snap.made.slice(0, 10)))} ${esc(snap.made.slice(11))}.` +
        (ids.length ? `<br>${ids.length} photo${ids.length === 1 ? "" : "s"} received.` : "") + notes.map(x => "<br>" + esc(x)).join("")});
    } catch (e) { setSync({busy: false, ok: false, message: "The file could not be used: " + esc(e.message)}); }
  },
});

PAGES.sync = () => {
  if (NATIVE && NATIVE.fileSync) return fileSyncPage();
  const pending = toSend().length + DATA.deleted.length, ops = Clinic.pendingCount(), busy = syncState && syncState.busy, c = DATA.computer;
  const bits = [];
  if (ops) bits.push(`${ops} change${ops === 1 ? "" : "s"} made on this phone`);
  if (pending) bits.push(`${pending} ${pending === 1 ? "tally" : "tallies"}`);
  let h = `<h2 style="margin-top:4px">Sync with the computer</h2>
    <div class="card"><b>On the computer:</b> open Zion Clinic and press <b>Sync with phone</b>.
      <div class="muted" style="margin-top:6px">The phone and the computer must be on the same Wi-Fi. If the same record was changed in both places, the latest change is kept.</div></div>
    <p>${bits.length ? `<b>Waiting to go:</b> ${bits.join(", ")}.` : "Nothing is waiting on this phone."}</p>
    <button class="send wide" data-act="syncNow" ${busy ? "disabled" : ""}>${busy ? "Syncing…" : "Sync now"}</button>`;
  if (syncState && syncState.message) h += `<div class="result ${syncState.ok ? "ok" : "bad"}">${syncState.message}</div>`;
  if (syncState && syncState.offerAddress) h += `<button class="wide" data-act="typeAddress">Enter the computer's address</button>`;
  h += `<h3>Computer</h3><div class="card">${c ? `${esc(c.name)}<div class="muted">${esc(c.ip)} · paired${c.lastSent ? ` · last sync ${esc(niceTime(c.lastSent))}` : ""}</div>` :
    `<span class="muted">Not paired yet. The first time, you will be asked for the 4-number code shown on the computer.</span>`}
    ${Clinic.has() ? `<div class="muted" style="margin-top:6px">Records on this phone are from ${esc(ZR.fmtDate(Clinic.base.made.slice(0, 10)))} ${esc(Clinic.base.made.slice(11))}.</div>` : ""}</div>`;
  if (c) h += `<button class="wide small" data-act="forgetComputer" ${busy ? "disabled" : ""}>Forget this computer</button>`;
  if (!FINANCE) h += `<h3>Backup</h3><p class="muted">Makes one file with everything on this phone, locked with your backup password. Then choose Google Drive in the Share list, or save it to the phone.</p>
    <button class="wide" data-act="backupNow" ${busy ? "disabled" : ""}>Back up to Google Drive…</button>
    <button class="wide small" data-act="backupRestore" ${busy ? "disabled" : ""}>Restore from a backup…</button>
    <div id="ready">${typeof readyHtml === "function" ? readyHtml() : ""}</div>`;
  h += `<h3>This app</h3>
    <button class="wide small" data-act="pinChange">Change the PIN</button>
    <button class="wide small" data-act="lockNow">Lock now</button>
    <p class="muted" style="text-align:center;margin-top:18px">${APP_TITLE} ${esc(LISTS.appVersion)}</p>`;
  return h;
};

/* The pieces of one sync. Each goes through the Android side, which encrypts them. */
function syncClient(comp) {
  const base = `http://${comp.ip}:${PORT}`, dev = DATA.deviceId;
  return {
    pair: code => call(id => NATIVE.syncPair(id, base, dev, deviceName(), comp.id, code)),
    message: (obj, ms) => call(id => NATIVE.syncCall(id, base, dev, comp.id, JSON.stringify(obj), ms || 60000)),
    snapshot: () => call(id => NATIVE.syncSnapshot(id, base, dev, comp.id)),
    put: (uid, kind, meta) => call(id => NATIVE.syncPhotoPut(id, base, dev, comp.id, uid, kind, JSON.stringify(meta), deviceName())),
    get: uid => call(id => NATIVE.syncPhotoGet(id, base, dev, comp.id, uid)),
  };
}

async function pairWith(comp, cli) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await keypad("Pairing code", "", {max: 4, ok: "Pair",
      hint: `Type the 4 numbers shown on the computer (${esc(comp.name)}).` + (attempt ? " <b>That code was not right – try again.</b>" : "")});
    if (!code) return false;
    setSync({busy: true, ok: true, message: "Pairing…"});
    const r = await cli.pair(code);
    if (r.code === 200) return true;
    if (r.text !== "wrong code") { setSync({busy: false, ok: false, message: "Could not pair: " + esc(r.text)}); return false; }
  }
  setSync({busy: false, ok: false, message: "Not paired, nothing was sent."});
  return false;
}

async function doSync(address) {
  if (syncState && syncState.busy) return;
  if (!NATIVE) { toast("Sync works in the phone app"); return; }
  setSync({busy: true, ok: true, message: "Connecting…"});
  try {
    const comp = await findComputer(address);
    if (!comp) {
      setSync({busy: false, ok: false, offerAddress: true, message:
        "Could not find the computer.<br>• Is <b>Sync with phone</b> open on the computer?<br>• Are both on the same Wi-Fi?<br>• If it still fails, enter the address shown on the computer."});
      return;
    }
    if (!comp.sync) { setSync({busy: false, ok: false, message: "The program on the computer is too old for this app. Please update it first."}); return; }
    const cli = syncClient(comp);
    if (!NATIVE.syncHasKey(comp.id) && !await pairWith(comp, cli)) {
      if (syncState && syncState.busy) setSync({busy: false, ok: false, message: "Not paired, nothing was sent."});
      return;
    }
    DATA.computer = Object.assign({}, DATA.computer, {id: comp.id, name: comp.name, ip: comp.ip});
    save();
    for (let round = 0; round < 2; round++) {
      const res = await syncOnce(comp, cli);
      if (res !== "pair") return;
      if (!await pairWith(comp, cli)) return;
    }
    setSync({busy: false, ok: false, message: "The computer did not accept the pairing. Try again."});
  } catch (e) {
    setSync({busy: false, ok: false, message: "Sync failed: " + esc(String(e)) + "<br>Nothing was lost – try again."});
  }
}

const failed = (what, r) => setSync({busy: false, ok: false, message: `${what}: ` + esc(r.text || "no answer from the computer") + "<br>Nothing was lost – try again."});

async function syncOnce(comp, cli) {
  // 1. Photos taken on this phone, with their details. Each is ticked off as soon as the computer has it.
  const photos = Clinic.ops.filter(o => o.op === "photo" && !o.done);
  let n = 0;
  for (const op of photos) {
    setSync({busy: true, ok: true, message: `Sending photo ${n + 1} of ${photos.length}…`});
    const f = op.fields, meta = Object.assign({}, f, {date: f.receipt_date || f.page_date});
    const r = await cli.put(op.uid, op.kind, meta), j = r.code === 200 ? json(r) : null;
    if (j && j.error === "pair") return "pair";
    if (!j || !j.ok) { failed("A photo could not be sent", j ? {text: j.error} : r); return "failed"; }
    op.done = true;
    Clinic.persist();
    n++;
  }
  // 2. Changes and tallies.
  const sent = new Set(Clinic.ops);
  const list = toSend();
  setSync({busy: true, ok: true, message: `Sending changes to ${esc(comp.name)}…`});
  const r = await cli.message({type: "sync", now: Date.now(), device_name: deviceName(), app_version: LISTS.appVersion,
    ops: Clinic.ops.filter(o => o.op !== "photo"), sessions: list.map(exportSession), deleted: DATA.deleted.slice()}, 120000);
  const j = r.code === 200 ? json(r) : null;
  if (j && j.error === "pair") return "pair";
  if (!j || !j.ok) { failed("Sync failed", j ? {text: j.error} : r); return "failed"; }
  const hashes = {};
  for (const s of list) hashes[s.id] = hashOf(s);
  for (const s of DATA.sessions) {
    if (hashes[s.id] && (j.saved || []).includes(s.id)) { s.sentHash = hashes[s.id]; s.sentAt = Date.now(); }
  }
  DATA.deleted = DATA.deleted.filter(id => !(j.removed || []).includes(id));
  if (Array.isArray(j.locations) && j.locations.length) DATA.locations = j.locations;
  save();
  // 3. A fresh copy of everything, then this phone's sent changes are finished with.
  setSync({busy: true, ok: true, message: "Getting the latest records…"});
  const snap = await cli.snapshot();
  if (snap.code !== 200) { failed("Could not get the latest records", snap); return "failed"; }
  Clinic.ops = Clinic.ops.filter(o => !sent.has(o));
  Clinic.persist();
  Clinic.load();
  // 4. Photos from the computer or other phones.
  const have = new Set(JSON.parse(NATIVE.photoList())), want = Clinic.base.photos || [];
  const missing = want.filter(u => !have.has(u));
  let got = 0, bad = 0;
  for (const uid of missing) {
    setSync({busy: true, ok: true, message: `Getting photo ${got + bad + 1} of ${missing.length}…`});
    const g = await cli.get(uid);
    if (g.code === 200) got++; else bad++;
  }
  // Photos deleted elsewhere are removed here too.
  const keep = new Set(want.concat(Clinic.ops.filter(o => o.op === "photo").map(o => o.uid)));
  for (const u of have) if (!keep.has(u)) deletePhotoFile(u);
  DATA.computer = {id: comp.id, name: comp.name, ip: comp.ip, lastSent: Date.now()};
  save();
  buzz();
  const lines = [esc(j.summary || "")];
  if (n) lines.push(`${n} photo${n === 1 ? "" : "s"} sent`);
  if (got) lines.push(`${got} photo${got === 1 ? "" : "s"} received`);
  if (bad) lines.push(`${bad} photo${bad === 1 ? "" : "s"} could not be fetched; sync again to retry`);
  for (const note of j.notes || []) lines.push(esc(note));
  setSync({busy: false, ok: !bad, message: "Synced ✓<br>" + lines.filter(Boolean).join("<br>")});
  return "done";
}

// ------------------------------------------------------------------ backups

async function askPassword(title, hint, confirmIt) {
  const ask1 = (t, h) => sheet(`<h2>${esc(t)}</h2><p class="muted">${h}</p>
    <input id="pw" type="password" autocomplete="off"><div class="grid2" style="margin-top:12px">
    <button data-act="sheetResult" data-v="">Cancel</button><button class="primary" data-act="pwOk">OK</button></div>`);
  const a = await ask1(title, hint);
  if (!a) return null;
  if (a.length < 8) { toast("Please use at least 8 letters or numbers."); return null; }
  if (confirmIt) {
    const b = await ask1("Type it again", "To be sure it was typed correctly.");
    if (a !== b) { toast("The two passwords were different."); return null; }
  }
  return a;
}

Object.assign(ACTIONS, {
  openSync() { go({name: "sync", tabName: ""}); },
  syncNow() { doSync(); },
  pwOk() { closeSheet($("#pw").value); },
  async forgetComputer() {
    if (!await ask("Forget this computer?", "Next time you sync, the phone looks for the computer again and asks for its code.", "Forget")) return;
    if (DATA.computer && NATIVE) NATIVE.syncForget(DATA.computer.id);
    DATA.computer = null;
    save();
    render(false);
  },
  async typeAddress() {
    const ips = localIps();
    const start = ips.length ? ips[0].slice(0, ips[0].lastIndexOf(".") + 1) : "192.168.";
    const v = await keypad("Computer address", start, {max: 15, dot: true, ok: "Use",
      hint: "The address is shown in the Sync with phone window on the computer."});
    if (!v) return;
    syncState = null;
    doSync(v.trim());
  },
  async backupNow() {
    if (!NATIVE) { toast("Backups work in the phone app"); return; }
    const pw = await askPassword("Backup password", "Choose a password of at least 8 letters or numbers. <b>Keep it somewhere safe: a backup cannot be opened without it.</b>", true);
    if (!pw) return;
    const t = new Date(), stamp = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}${pad(t.getMinutes())}`;
    setSync({busy: true, ok: true, message: "Making the backup…"});
    const r = await call(id => NATIVE.backupMake(id, pw, stamp));
    if (r.code !== 200) { setSync({busy: false, ok: false, message: esc(r.text)}); return; }
    R.file = r.text;
    setSync({busy: false, ok: true, message: "Backup ready. Press Share below and choose Drive, then Save."});
  },
  async backupRestore() {
    if (!NATIVE) { toast("Backups work in the phone app"); return; }
    if (!await ask("Restore from a backup?", "This replaces the tallies, records and changes now on this phone with the ones in the backup.", "Choose the file", true)) return;
    const picked = await call(id => NATIVE.backupPick(id));
    if (picked.code !== 200) return;
    const pw = await askPassword("Backup password", "The password chosen when this backup was made.", false);
    if (!pw) return;
    setSync({busy: true, ok: true, message: "Restoring…"});
    const r = await call(id => NATIVE.backupRestore(id, pw));
    if (r.code !== 200) { setSync({busy: false, ok: false, message: esc(r.text)}); return; }
    location.reload();
  },
  async pinChange() { if (await Lock.choosePin()) toast("PIN changed"); },
  lockNow() { Lock.show(); },
});

// ------------------------------------------------------------------ the lock

const Lock = {
  IDLE_MS: 5 * 60 * 1000, AWAY_MS: 3 * 60 * 1000, lastTouch: Date.now(), entered: "", onUnlock: null,
  showing() { return !$("#lock").classList.contains("hidden"); },

  draw(message) {
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "bio", "0", "back"];
    const bio = NATIVE && NATIVE.bioAvailable();
    $("#lock").innerHTML = `<img src="logo.png" alt="Zion Community" class="lock-logo"><div class="app-name">${APP_TITLE}</div>
      <p class="${message ? "pos" : "muted"}">${message || "Enter your PIN"}</p>
      <div class="display dots">${"●".repeat(this.entered.length) || " "}</div>
      <div class="keypad">${keys.map(k => (k === "bio" ? (bio ? `<button data-act="lockBio" aria-label="Use fingerprint">👆</button>` : `<span></span>`) :
        `<button data-act="lockKey" data-k="${k}">${k === "back" ? "⌫" : k}</button>`)).join("")}</div>
      <button class="link" data-act="lockForgot">Forgot the PIN?</button>`;
  },

  show(then) {
    if (!NATIVE) { if (then) then(); return; }
    this.onUnlock = then || this.onUnlock;
    this.entered = "";
    $("#lock").classList.remove("hidden");
    $("#view").innerHTML = "";      // nothing shows behind the lock
    if (!NATIVE.pinIsSet()) { this.firstPin(); return; }
    this.draw("");
    if (NATIVE.bioAvailable()) ACTIONS.lockBio();
  },

  unlocked() {
    $("#lock").classList.add("hidden");
    $("#lock").innerHTML = "";
    this.lastTouch = Date.now();
    const then = this.onUnlock;
    this.onUnlock = null;
    if (then) then(); else render(false);
  },

  /* Choosing a PIN uses the same number pad as the rest of the app. */
  async choosePin() {
    const a = await keypad("Choose a PIN", "", {max: 4, ok: "Next", hint: "4 numbers, to protect the clinic's records on this phone."});
    if (!a) return false;
    if (a.length < 4) { toast("The PIN needs 4 numbers."); return false; }
    const b = await keypad("Type the PIN again", "", {max: 4, ok: "Save"});
    if (a !== b) { toast("The two PINs were different."); return false; }
    return NATIVE ? NATIVE.pinSet(a) : true;
  },

  async firstPin() {
    $("#lock").innerHTML = `<img src="logo.png" alt="Zion Community" class="lock-logo"><div class="app-name">${APP_TITLE}</div>
      <p class="muted">This app holds ${FINANCE ? "the clinic's money records" : "patient records"}, so it needs a PIN${NATIVE.bioAvailable() ? " (and your fingerprint)" : ""}.</p>
      <button class="primary wide" data-act="lockSetup">Choose a PIN</button>`;
  },
};

Object.assign(ACTIONS, {
  async lockSetup() {
    if (await Lock.choosePin()) Lock.unlocked();
  },
  lockKey(d) {
    if (d.k === "back") Lock.entered = Lock.entered.slice(0, -1);
    else if (Lock.entered.length < 4) Lock.entered += d.k;
    if (Lock.entered.length === 4) {
      const res = NATIVE.pinCheck(Lock.entered);
      if (res === 0) { Lock.unlocked(); return; }
      Lock.entered = "";
      Lock.draw(res > 0 ? `Too many wrong tries. Wait ${res} seconds.` : "That PIN is not right.");
      return;
    }
    Lock.draw("");
  },
  async lockBio() {
    const r = await call(id => NATIVE.bioPrompt(id));
    if (r.code === 200) Lock.unlocked();
  },
  async lockForgot() {
    if (await ask("Forgot the PIN?", "The only way back in is to <b>erase everything on this phone</b>: records, tallies, photos, and any changes not yet synced. What was already synced is safe on the computer, and comes back at the next sync.", "Erase and start again", true)) {
      NATIVE.wipeAll();
    }
  },
});

window.zionResume = away => { if (away >= Lock.AWAY_MS && !Lock.showing()) Lock.show(); };
document.addEventListener("click", () => { Lock.lastTouch = Date.now(); }, true);
setInterval(() => {
  if (!document.hidden && Date.now() - Lock.lastTouch > Lock.IDLE_MS && !Lock.showing() && !(syncState && syncState.busy)) Lock.show();
}, 30000);
