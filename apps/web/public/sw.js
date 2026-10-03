// Mazeosaur web app shell cache. The sim itself needs no network once
// loaded (packages/sim is pure, no remote assets); this service worker's
// only job is making sure the shell that hosts it survives a dropped
// connection mid-migration. Runtime-cached, not precached: the first
// online load populates the cache, every load after (online or not)
// is served from it until a newer deploy replaces the entries.
const CACHE_NAME = "mazeosaur-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest" || url.pathname.startsWith("/icon")) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    cache.put("/index.html", response.clone());
    return response;
  } catch {
    const cached = await cache.match("/index.html");
    if (cached) return cached;
    throw new Error("offline and no cached shell");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
