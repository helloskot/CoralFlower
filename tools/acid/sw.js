// SPDX-License-Identifier: GPL-3.0-only
// Acid Flower, offline: network first (a new build is used as soon as it is online), the last copy when there is no
// network. Everything the machine needs is fetched once at install.
const CACHE = "acid-flower-v14";
const FILES = ["./", "acid.js", "rave.js", "boot-sound.js", "acid.css", "acid-worklet.js", "manifest.webmanifest", "icon.svg", "icon-180.png",
               "icon-512.png", "favicon-40.png", "vj.html", "../fonts/DepartureMono.woff"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) =>
    fetch(f, { cache: "no-cache" }).then((r) => r.ok && c.put(f, r)).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k.startsWith("acid-flower")).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return r;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || Response.error()))
  );
});
