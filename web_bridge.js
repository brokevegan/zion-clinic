/* Zion Clinic on the iPhone: everything the Android shell does for the pages, done with what Safari offers.
   Records and photos are kept in the browser's own database on the phone; photos come from the camera through a
   file input; PDFs go out through the Share sheet. An app added to the Home Screen cannot call the laptop's plain
   http address, so it syncs with locked files (see sync.js, "file sync", and /iphone on the laptop). */
"use strict";
(function () {
  const MAGIC = "ZIONTAB1", ITERATIONS = 250000, BACKUP_MAGIC = "ZIONBAK1", BACKUP_ITERATIONS = 200000;
  const mem = new Map();    // everything but the full-size photos, read at start so the pages can ask without waiting
  const full = new Map();   // full-size photos fetched for the page in use
  let db = null, out = null, openText = null;

  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("zion-clinic", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onerror = () => reject(r.error);
      r.onsuccess = () => resolve(r.result);
    });
  }
  const put = (k, v) => { const tx = db.transaction("kv", "readwrite"); if (v === null) tx.objectStore("kv").delete(k); else tx.objectStore("kv").put(v, k); return tx; };
  const set = (k, v) => { if (v === null) mem.delete(k); else mem.set(k, v); put(k, v); };
  const fetchKey = k => new Promise(resolve => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(undefined); });
  const done = (call, code, text) => window.zionNetDone(call, code, text);
  const enc = new TextEncoder(), dec = new TextDecoder();

  /* A plain SHA-256, because the PIN check must answer at once (Safari's own is only asynchronous). */
  function sha256(bytes) {
    const K = [], H = [];
    let n = 0;
    for (let p = 2; n < 64; p++) {
      let prime = true;
      for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
      if (prime) {
        if (n < 8) H[n] = (Math.pow(p, 1 / 2) % 1) * 4294967296 >>> 0;
        K[n++] = (Math.pow(p, 1 / 3) % 1) * 4294967296 >>> 0;
      }
    }
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    new DataView(m.buffer).setUint32(total - 4, len * 8);
    const w = new Int32Array(64), rr = (x, c) => (x >>> c) | (x << (32 - c));
    for (let o = 0; o < total; o += 64) {
      const v = new DataView(m.buffer, o, 64);
      for (let i = 0; i < 16; i++) w[i] = v.getInt32(i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + (rr(a, 7) ^ rr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rr(b, 17) ^ rr(b, 19) ^ (b >>> 10))) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((x, i) => { H[i] = (H[i] + x) >>> 0; });
    }
    return H.map(x => x.toString(16).padStart(8, "0")).join("");
  }
  const hashPin = (pin, salt) => { let s = salt + pin; for (let i = 0; i < 3000; i++) s = sha256(enc.encode(s)); return s; };

  const toB64 = bytes => { let bin = ""; for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(bin); };
  const fromB64 = s => { const bin = atob(s), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };

  async function aesKey(secret, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name: "PBKDF2", salt, iterations, hash: "SHA-256"}, base, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]);
  }

  /* magic + salt + nonce + AES-GCM(data): the computer's zion_tablet.lock and zion_backup use this layout. */
  async function lock(bytes, secret, magic, iterations) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12));
    const body = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv: nonce}, await aesKey(secret, salt, iterations), bytes));
    const res = new Uint8Array(36 + body.length);
    res.set(enc.encode(magic)); res.set(salt, 8); res.set(nonce, 24); res.set(body, 36);
    return res;
  }
  async function unlock(bytes, secret, magic, iterations) {
    if (dec.decode(bytes.slice(0, 8)) !== magic) throw new Error("not-a-zion-file");
    return new Uint8Array(await crypto.subtle.decrypt({name: "AES-GCM", iv: bytes.slice(24, 36)}, await aesKey(secret, bytes.slice(8, 24), iterations), bytes.slice(36)));
  }

  function pickFile(accept, capture) {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      if (accept) input.accept = accept;
      if (capture) input.capture = "environment";
      input.style.display = "none";
      document.body.appendChild(input);
      input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
      input.oncancel = () => { resolve(null); input.remove(); };
      input.click();
    });
  }

  async function keepPhoto(id, src) {
    const large = await shrink(src, 2000, 0.82), small = await shrink(large, 360, 0.7);
    set("thumb:" + id, small);
    put("photo:" + id, large);
    full.set(id, large);
  }

  async function takeInto(call, id, capture) {
    const f = window.__testPhoto ? null : await pickFile("image/*", capture);
    if (!f && !window.__testPhoto) { done(call, 0, "cancelled"); return; }
    try {
      const src = window.__testPhoto || await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      await keepPhoto(id, src);
      done(call, 200, "ok");
    } catch (e) { done(call, 0, "The photo could not be saved: " + e.message); }
  }

  function shareOut() {
    const f = new File([out.blob], out.name, {type: out.type});
    if (navigator.canShare && navigator.canShare({files: [f]})) {
      navigator.share({files: [f], title: out.name}).catch(e => { if (e.name !== "AbortError") toast("Could not share: " + e.message); });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(out.blob);
      a.download = out.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  function setOut(name, parts) {
    const type = name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".xlsx") ?
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/octet-stream";
    out = {name, type, blob: new Blob(parts, {type})};
  }

  async function allPhotoIds() {
    return Array.from(mem.keys()).filter(k => k.startsWith("thumb:")).map(k => k.slice(6));
  }

  window.ZionAndroid = {
    fileSync: true,
    load() { return mem.get("file:tallies") || ""; },
    loadBackup() { return ""; },
    save(json) { set("file:tallies", json); return true; },
    fileOpen(name) { openText = mem.get("file:" + name); if (openText === undefined) return -1; return openText.length; },
    fileChunk(from, len) { return openText.substr(from, len); },
    fileClose() { openText = null; },
    fileWrite(name, text) { set("file:" + name, text); return true; },
    buzz() {},
    deviceName() { return /iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "iPad" : "iPhone"; },   // an iPad's Safari calls itself a Mac
    localIps() { return "[]"; },

    pinIsSet() { return mem.has("lock:hash"); },
    pinSet(pin) {
      const salt = toB64(crypto.getRandomValues(new Uint8Array(12)));
      set("lock:salt", salt);
      set("lock:hash", hashPin(pin, salt));
      set("lock:wrong", "0");
      set("lock:wait", "0");
      return true;
    },
    pinCheck(pin) {
      const now = Date.now(), wait = Number(mem.get("lock:wait") || 0);
      if (wait > now) return Math.floor((wait - now) / 1000) + 1;
      if (hashPin(pin, mem.get("lock:salt")) === mem.get("lock:hash")) { set("lock:wrong", "0"); return 0; }
      const wrong = Number(mem.get("lock:wrong") || 0) + 1;
      set("lock:wrong", String(wrong));
      if (wrong >= 5) set("lock:wait", String(now + 30000 * (wrong - 4)));
      return -1;
    },
    bioAvailable() { return false; },    // an app added to the Home Screen cannot use Face ID for its own lock
    bioPrompt(call) { done(call, 0, "cancelled"); },
    wipeAll() {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").clear();
      tx.oncomplete = () => location.reload();
    },

    takePhoto(call, id) { takeInto(call, id, true); },
    pickPhoto(call, id) { takeInto(call, id, false); },
    photo(id, thumb) { return (thumb ? mem.get("thumb:" + id) : full.get(id)) || ""; },
    async loadPhoto(id) { if (!full.has(id)) { const v = await fetchKey("photo:" + id); if (v) full.set(id, v); } },
    forgetFull(id) { full.delete(id); },
    hasPhoto(id) { return mem.has("thumb:" + id); },
    deletePhoto(id) { set("thumb:" + id, null); put("photo:" + id, null); full.delete(id); },
    photoList() { return JSON.stringify(Array.from(mem.keys()).filter(k => k.startsWith("thumb:")).map(k => k.slice(6))); },

    outBegin(name) { out = {name, chunks: []}; return true; },
    outChunk(b64) { out.chunks.push(fromB64(b64)); return true; },
    outEnd() { setOut(out.name, out.chunks); return true; },
    currentOut() { return out; },
    outOpen() { window.open(URL.createObjectURL(out.blob), "_blank"); },
    outShare() { shareOut(); },
    outSave() { shareOut(); return "In the list that opens, choose Save to Files."; },

    // ---- file sync
    syncCode() { return mem.get("lock:synccode") || ""; },
    setSyncCode(c) { set("lock:synccode", c); },
    async lockOut(text, code, name) {
      setOut(name, [await lock(enc.encode(text), code, MAGIC, ITERATIONS)]);
      return name;
    },
    async photoB64(id) {
      await this.loadPhoto(id);
      const u = full.get(id) || "";
      full.delete(id);
      return u.slice(u.indexOf(",") + 1);
    },
    pickData() { return pickFile(""); },
    async openData(file, code) {
      const text = dec.decode(await unlock(new Uint8Array(await file.arrayBuffer()), code, MAGIC, ITERATIONS));
      return JSON.parse(text);
    },
    keepPhotoB64(id, b64) { return keepPhoto(id, "data:image/jpeg;base64," + b64); },

    // ---- locked backups, in the same format as the computer and Android
    async backupMake(call, password, stamp) {
      try {
        const files = [];
        for (const [k, n] of [["file:tallies", "tallies.json"], ["file:base", "clinic-base.json"], ["file:changes", "clinic-changes.json"]]) {
          if (mem.has(k)) files.push(["phone/" + n, enc.encode(mem.get(k))]);
        }
        for (const id of await allPhotoIds()) {
          const u = await fetchKey("photo:" + id);
          if (u) files.push([`phone/photos/${id}.jpg`, fromB64(u.slice(u.indexOf(",") + 1))]);
        }
        const name = `Zion phone backup ${stamp}.zionbak`;
        setOut(name, [await lock(zipStore(files), password, BACKUP_MAGIC, BACKUP_ITERATIONS)]);
        done(call, 200, name);
      } catch (e) { done(call, 0, "The backup could not be made: " + e.message); }
    },
    backupPick(call) { pickFile("").then(f => { this.backupFile = f; done(call, f ? 200 : 0, f ? "ok" : "cancelled"); }); },
    async backupRestore(call, password) {
      try {
        const plain = await unlock(new Uint8Array(await this.backupFile.arrayBuffer()), password, BACKUP_MAGIC, BACKUP_ITERATIONS)
          .catch(e => { throw new Error(e.message === "not-a-zion-file" ? "This is not a Zion backup file." : "Wrong password, or the file is damaged."); });
        const entries = await unzip(plain);
        let count = 0;
        for (const [name, data] of entries) {
          if (name === "phone/tallies.json") { set("file:tallies", dec.decode(data)); count++; }
          else if (name === "phone/clinic-base.json") { set("file:base", dec.decode(data)); count++; }
          else if (name === "phone/clinic-changes.json") { set("file:changes", dec.decode(data)); count++; }
          else if (name.startsWith("phone/photos/")) { await keepPhoto(name.slice(13).replace(".jpg", ""), "data:image/jpeg;base64," + toB64(data)); count++; }
        }
        if (!count) throw new Error("This backup was made on the computer. Open it there with Open a locked backup.");
        done(call, 200, "ok");
      } catch (e) { done(call, 0, e.message); }
    },
  };

  /* Reads a zip: this app's own (stored) or an Android backup (deflated). */
  async function unzip(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.length), out_ = [];
    let e = b.length - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("The backup file is damaged.");
    let p = v.getUint32(e + 16, true);
    for (let i = 0, n = v.getUint16(e + 10, true); i < n; i++) {
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true),
        xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      let data = b.subarray(start, start + csize);
      if (method === 8) {
        if (typeof DecompressionStream === "undefined") throw new Error("This backup was made on an Android phone, and this device's software is too old to open it (it needs version 16.4).");
        const s = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(s).arrayBuffer());
      }
      out_.push([name, data]);
      p += 46 + nlen + xlen + clen;
    }
    return out_;
  }

  /* The pages wait for this before starting. */
  window.ZION_READY = (async () => {
    db = await idb();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await new Promise((resolve, reject) => {
      const r = db.transaction("kv").objectStore("kv").openCursor();
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c) { resolve(); return; }
        if (!String(c.key).startsWith("photo:")) mem.set(c.key, c.value);
        c.continue();
      };
    });
  })();

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
