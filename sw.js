// Momster Helper service worker: offline-capable but update-friendly
// CACHE version bumps on every deploy; navigation requests hit the network first
// so users get the new version on their next visit, falling back to cache offline.
const CACHE = "momster-helper-v67-kid-header";
const ASSETS = ["./", "./index.html", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/maskable-192.png", "./icons/maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;

  // App shell (navigations): network first, cache fallback. Users get updates; offline still works.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // Static assets: cache first, refresh in background (stale-while-revalidate)
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(hit => {
      const refresh = fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});