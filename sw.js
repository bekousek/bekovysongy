/**
 * sw.js - offline support. Precaches the whole site (it's small, ~5 MB for
 * 570 songs) on install so the songbook works with no signal - its natural
 * environment (chata, les). Cache-first at runtime, refreshed from network
 * in the background so edits made in /admin show up next time you're online.
 *
 * Exception: songs.json is network-first (falling back to cache offline).
 * It's the index the admin and the random-pick/search features read, and
 * cache-first here could serve a stale song list to a returning visitor for
 * up to this cache's lifetime - not just the fresh-in-background delay above.
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
// Bump on every change to a JS/CSS/HTML asset - activate deletes every cache
// that isn't this name, and that's the only thing that makes returning
// visitors load new code on the *first* visit instead of the second.
//
// Not being in APP_SHELL is no exemption: the runtime handler below caches
// whatever it fetches, so admin-only files (js/editor.js, css/editor.css)
// end up cached just the same, and cache-first then serves them stale.
const CACHE_NAME = 'bekovysongy-v9';
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

  // The lyrics index for the song list's full-text search. Cached on its own
  // rather than in APP_SHELL above: it's generated at deploy time, so on a
  // local checkout it doesn't exist, and one addAll rejection would take the
  // whole shell down with it.
  try {
    await cache.add(BASE + 'search-index.json');
  } catch (e) {
    // Not deployed (or offline) - search falls back to names only.
  }

  let total = 0;
  let failed = 0;
  try {
    const res = await fetch(BASE + 'songs.json');
    const data = await res.json();
    // Admin-only drafts ("navrh" / "k-vytvoreni") have no page to cache -
    // every one of them would just be a 404 counted as a failure below.
    const slugs = data.songs
      .filter((s) => s.status !== 'navrh' && s.status !== 'k-vytvoreni')
      .map((s) => s.slug);
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

  // songs.json: always hit the network first (admin's loadSongList and the
  // random-pick/search pool all read from it, and cache-first could otherwise
  // serve a returning visitor a stale song list indefinitely). Falls back to
  // cache only when offline.
  //
  // song-previews.json rides along: it's regenerated whenever new návrhy are
  // triaged, and it'd be a cache bump every time otherwise - for a file only
  // /admin reads, and only while online.
  if (url.pathname.endsWith('/songs.json')
      || url.pathname.endsWith('/song-previews.json')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

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
