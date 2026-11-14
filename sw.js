/* App-shell cache only -- recipe data is cached separately by the page's own
   IndexedDB logic (see nytBoot in src/app.js). This makes the page ITSELF load
   with no network at all (a grocery store with no signal), so that data cache
   and the offline write queue can do their jobs.
   Bump CACHE_NAME any time SHELL_FILES changes; the old cache is deleted on
   activate. tests/sw_harness.html (run by tests/run.sh) exercises all of this
   in a real browser. */
const CACHE_NAME = 'cookbook-shell-v2';
/* './' is the page (index.html). The sync library is served from this site so it
   can be here too -- without it the app can't queue writes offline. */
const SHELL_FILES = ['./', './manifest.json', './icon-192.png', './icon-512.png',
  './vendor/supabase-js-2.119.0.min.js'];
/* how long a request waits on the network before the cached copy is used instead --
   one bar of signal is worse than none: the request neither fails nor finishes */
const NETWORK_TIMEOUT_MS = 4000;
/* after one request has timed out, the files a page load asks for next (the sync
   library, icons) would each wait out the same timeout in turn -- so for a short
   while the cache answers straight away instead */
const SLOW_MODE_MS = 30000;
let slowUntil = 0;

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

/* Network-first, so a normal online visit always gets the latest published
   version. The cached copy is used when the network request fails, answers with
   an error status (a hosting outage must not replace the page with an error
   page -- and is never stored over the good copy), or takes longer than
   NETWORK_TIMEOUT_MS. A slow request keeps going in the
   background and refreshes the cache for next time.
   Anything from another site (the Supabase API, Google Fonts) is left alone. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  /* the static recipe archive (data/archive/, ~120MB) is cached by the page itself in
     IndexedDB -- caching it here too would just double the storage */
  if (url.pathname.includes('/data/archive/')) return;

  const isPage = req.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    /* any page URL (?hh=..., #r/...) is the same one page */
    const cached = (await cache.match(req)) || (isPage ? await cache.match('./') : undefined);
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(isPage ? './' : req, res.clone()).catch(() => {});
      return res;
    });
    if (!cached) return network;
    network.catch(() => {}); /* may lose the race below; its failure is then nobody's problem */
    if (Date.now() < slowUntil) return cached;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
    try {
      const res = await Promise.race([network, timeout]);
      if (!res) slowUntil = Date.now() + SLOW_MODE_MS;
      return (res && res.ok) ? res : cached;
    } catch (e) {
      return cached;
    }
  })());
});
