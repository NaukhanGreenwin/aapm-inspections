/* Offline shell for the AA Property Management inspections preview (/aapm-inspections/): a reload in a suite with weak
   signal still opens. Pages: network first, cache fallback. Static assets (hashed): cache first.
   A new version waits until the app is on its home screen (the page posts "activate"). */
const CACHE = "aapm-insp-v1";
const B = "/aapm-inspections";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([B + "/", B + "/brand/mark.svg", B + "/brand/favicon.png"])));
});
self.addEventListener("message", (e) => { if (e.data === "activate") self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("aapm-insp-") && k !== CACHE).map((k) => caches.delete(k)))));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(B + "/")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(B + "/", copy)); } return res; }).catch(() => caches.match(B + "/")));
    return;
  }
  if (url.pathname.startsWith(B + "/_next/") || url.pathname.startsWith(B + "/brand/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
  }
});
