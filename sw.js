/* Keeps the app's own files on the iPhone so it opens with no internet. Never holds clinic data (that is in the
   phone's private database and never reaches the website). A new version is picked up when opened with internet. */
const CACHE = "zion-clinic-1fc049bafa15";
const FILES = ["./", "app.js", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "index.html", "lists.js", "logo.png", "logo_data.js", "main.js", "manifest.webmanifest", "pages.js", "pdf.js", "photos.js", "reports.js", "reportspage.js", "store.js", "style.css", "sync.js", "vendor/jspdf.plugin.autotable.min.js", "vendor/jspdf.umd.min.js", "web_bridge.js"];

self.addEventListener("install", e => {
  // Fresh from the website: the browser may keep a file for 10 minutes, and an old one must never be saved as this version.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(hit => hit || fetch(e.request)));
});
