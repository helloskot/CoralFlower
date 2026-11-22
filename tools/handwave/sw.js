// SPDX-License-Identifier: GPL-3.0-only
// Handwave offline: its files kept, served from the cache, refreshed when there's a network. (The hand tracker comes
// from its CDN; the browser's own cache keeps it after the first time.)
const CACHE = "handwave-v2";
const FILES = ["./", "index.html", "handwave.js", "theory.js", "handwave-worklet.js", "handwave.css", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
