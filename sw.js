/**
 * sw.js - offline support. Precaches the whole site (it's small, ~5 MB for
 * 570 songs) on install so the songbook works with no signal - its natural
 * environment (chata, les). Cache-first at runtime, refreshed from network
 * in the background so edits made in /admin show up next time you're online.
 *
 * Must live at the site root: a service worker's default scope is the
 * directory it's served from, and this one needs to control every page.
 * All URLs below are built from self.registration.scope so this works both
 * on the GitHub Pages project subpath and the eventual custom domain root.
 *
 * precacheAll() also runs on demand, triggered by a postMessage({type:
 * 'PRECACHE_ALL'}) from js/offline-download.js (the "Stáhnout offline"
 * button), so the install-time precache above isn't the only way in - useful
 * right before going offline, or to retry songs that failed the first time.
 */
const CACHE_NAME = 'bekovysongy-v1';
const BASE = self.registration.scope;

const APP_SHELL = [
  '',
  'na-kytaru/',
  'na-foukaci-harmoniku/',
  'na-kalimbu/',
  'css/style.css',
  'js/chords.js',
  'js/sections.js',
  'js/chord-theory.js',
  'js/player.js',
  'js/table.js',
  'songs.json',
  'assets/favicon.svg',
  'assets/fonts/Metropolis-Light.woff2',
  'assets/fonts/Metropolis-Regular.woff2',
  'assets/fonts/Metropolis-Medium.woff2',
  'assets/fonts/Metropolis-SemiBold.woff2',
  'assets/fonts/Metropolis-Bold.woff2',
  'offline.html',
].map((p) => BASE + p);

// Caches every song, reporting progress via onProgress(done, total) - used
// both silently on install and on demand from the download button. Songs are
// cached individually with limited concurrency (not one big addAll/allSettled)
// so a handful of flaky fetches can't abort the rest and 570 requests don't
// all fire at once.
async function precacheAll(onProgress) {
  const cache = await caches.open(CACHE_NAME);
  try {
    await cache.addAll(APP_SHELL);
  } catch (e) {
    // A shell asset is missing/unreachable - songs are still worth caching.
  }

  let total = 0;
  let failed = 0;
  try {
    const res = await fetch(BASE + 'songs.json');
    const data = await res.json();
    const slugs = data.songs.map((s) => s.slug);
    total = slugs.length;
    if (onProgress) onProgress(0, total);

    let next = 0;
    let done = 0;
    const CONCURRENCY = 12;
    async function worker() {
      while (next < slugs.length) {
        const slug = slugs[next++];
        try {
          await cache.add(BASE + 'songs/' + slug + '.html');
        } catch (e) {
          failed++;
        }
        done++;
        if (onProgress) onProgress(done, total);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slugs.length) }, worker));
  } catch (e) {
    // No network, or songs.json failed - app shell is still cached;
    // individual songs get cached as they're visited.
  }

  return { total, failed };
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAll());
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'PRECACHE_ALL') return;
  const client = event.source;
  event.waitUntil(
    precacheAll((done, total) => {
      if (client) client.postMessage({ type: 'PRECACHE_PROGRESS', done, total });
    }).then(({ total, failed }) => {
      if (client) client.postMessage({ type: 'PRECACHE_DONE', total, failed });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // e.g. Google Sign-In on /admin

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match(BASE + 'offline.html'));
      return cached || networkFetch;
    })()
  );
});
