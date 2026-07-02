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

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      // Cache every song individually (not one addAll) so a single flaky
      // fetch can't abort caching for all the others.
      try {
        const res = await fetch(BASE + 'songs.json');
        const data = await res.json();
        await Promise.allSettled(
          data.songs.map((s) => cache.add(BASE + 'songs/' + s.slug + '.html'))
        );
      } catch (e) {
        // No network at install time, or songs.json failed - app shell is
        // still cached; individual songs get cached as they're visited.
      }
    })()
  );
  self.skipWaiting();
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
