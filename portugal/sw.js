/* App-shell cache -- this is a static reference doc (no live data source
   to worry about, unlike the cookbook's Supabase-backed recipes), so
   caching the whole page as the shell is enough to make it load with no
   network at all. Bump CACHE_NAME any time this file list changes -- an
   old name left behind just means old files linger in a cache nothing
   points at anymore. */
const CACHE_NAME = 'portugal-shell-v1';
const SHELL_FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

/* network-first so a normal online visit always gets the latest published
   version; only fall back to the cached copy when the network request
   itself fails (offline, or a spotty signal abroad). */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
