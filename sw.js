/* App-shell cache only -- the recipe data itself is already cached separately
   by the page's own IndexedDB logic (see NYT_CACHE_VERSION in index.html),
   this just makes sure the page ITSELF loads with no network at all (e.g. a
   grocery store with no signal), so that existing data cache can kick in.
   Bump CACHE_NAME any time the shell list below changes -- an old name left
   behind just means old files linger in a cache nothing points at anymore. */
const CACHE_NAME = 'cookbook-shell-v1';
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

/* network-first for the app shell so a normal online visit always gets the
   latest published version; only fall back to the cached copy when the
   network request itself fails (offline, or a spotty grocery-store signal).
   Anything not in SHELL_FILES (the Supabase API, Google Fonts, etc.) is left
   completely alone -- this worker doesn't intercept those requests at all. */
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
