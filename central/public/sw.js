/* MTG Central service worker - app shell + Scryfall card art */
const VERSION = "mtg-central-v4";
const SHELL = `${VERSION}-shell`;
const PAGES = `${VERSION}-pages`;
const SCRYFALL_IMG = `${VERSION}-scryfall-img`;
const SCRYFALL_API = `${VERSION}-scryfall-api`;

const PRECACHE_URLS = [
  "/",
  "/offline",
  "/decks",
  "/precons",
  "/compare",
  "/improve",
  "/sage",
  "/play",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

async function collectLinkedAssets(htmlText, origin) {
  const urls = new Set();
  const re =
    /(?:href|src)=["'](\/_next\/static\/[^"']+\.(?:css|js)|\/icons\/[^"']+)["']/g;
  let match;
  while ((match = re.exec(htmlText))) {
    urls.add(new URL(match[1], origin).href);
  }
  return [...urls];
}

async function precacheShell(cache) {
  const origin = self.location.origin;
  for (const path of PRECACHE_URLS) {
    try {
      const res = await fetch(path, { cache: "reload" });
      if (!res.ok) continue;
      await cache.put(path, res.clone());
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        const html = await res.clone().text();
        const assets = await collectLinkedAssets(html, origin);
        await Promise.all(
          assets.map(async (assetUrl) => {
            try {
              const assetRes = await fetch(assetUrl, { cache: "reload" });
              if (assetRes.ok) await cache.put(assetUrl, assetRes);
            } catch {
              /* skip failed asset */
            }
          }),
        );
      }
    } catch {
      /* skip failed page */
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => precacheShell(cache))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (!key.startsWith(VERSION)) return caches.delete(key);
            return undefined;
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const offline = await caches.match(fallbackUrl);
      if (offline) return offline;
    }
    throw new Error("offline");
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  // Scryfall card images - CacheFirst (do not break loading when online)
  if (url.hostname === "cards.scryfall.io") {
    event.respondWith(cacheFirst(request, SCRYFALL_IMG));
    return;
  }

  // Scryfall API - NetworkFirst
  if (url.hostname === "api.scryfall.com") {
    event.respondWith(networkFirst(request, SCRYFALL_API));
    return;
  }

  // Same-origin navigations - NetworkFirst with offline fallback
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGES, "/offline"));
    return;
  }

  // Same-origin static assets
  if (url.origin === self.location.origin) {
    if (
      url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/")
    ) {
      event.respondWith(cacheFirst(request, SHELL));
      return;
    }
  }
});
