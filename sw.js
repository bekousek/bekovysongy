/**
 * sw.js - offline support. The songbook's natural environment (chata, les)
 * has no signal, so everything is cached: the app shell on install, every
 * song too, and the runtime serves from the cache first and refreshes it in
 * the background, so edits made in /admin show up on the next visit.
 *
 * Two caches:
 *   - "shell-<version>": the JS/CSS/HTML skeleton. The version is a hash of
 *     those files, written in at deploy (.github/workflows/deploy-pages.yml
 *     replaces SHELL_VERSION below), so a change to any of them reaches
 *     returning visitors on their next visit - nobody has to remember to
 *     bump a number. An old shell cache goes when a new one takes over.
 *   - "songs": the song pages and the data (songs.json, the lyrics index).
 *     It outlives every shell version: a new deploy doesn't download 628
 *     pages again, and a song that a weak signal kept out of one install
 *     never drops out of offline. Song pages refresh in the background
 *     whenever they're opened online; "Stáhnout offline" refreshes them all.
 *
 * songs.json and song-previews.json are network-first, with a time limit:
 * on one bar of signal fetch() can hang for a minute before it fails, and
 * until then the page has no setlist position, no next song and no artist
 * links. After NETWORK_WAIT_MS the cached copy answers; the request still
 * finishes in the background and refreshes the cache for next time.
 *
 * A page opened with a query (?vecer=1, ?nahodne=1, ?q=, ?parta=) is the
 * same document - the page's own script reads the query - so pages are
 * stored and looked up without it.
 *
 * Must live at the site root: a service worker's default scope is the
 * directory it's served from, and this one needs to control every page.
 * All URLs below are built from self.registration.scope so this works both
 * on the GitHub Pages project subpath and the custom domain root.
 *
 * precacheAll() also runs on demand, triggered by a postMessage({type:
 * 'PRECACHE_ALL'}) from js/offline-download.js (the "Stáhnout offline"
 * button) - useful right before going offline, or to retry songs that
 * failed the first time.
 */

// Replaced at deploy with a hash of the shell files; 'dev' on a checkout.
const SHELL_VERSION = 'dev';
const SHELL_CACHE = 'shell-' + SHELL_VERSION;
const SONGS_CACHE = 'songs';
const BASE = self.registration.scope;
const NETWORK_WAIT_MS = 3000;

const APP_SHELL = [
  '',
  'na-kytaru/',
  'css/tokens.css',
  'css/app.css',
  'css/style.css',
  'assets/fonts/Figtree-Variable-latin.woff2',
  'assets/fonts/Figtree-Variable-latin-ext.woff2',
  'js/song-list-core.js',
  'js/vecer.js',
  'js/app.js',
  'js/offline-download.js',
  'js/chords.js',
  'js/sections.js',
  'js/chord-theory.js',
  'js/player.js',
  'js/tuner.js',
  'manifest.json',
  'assets/favicon.svg',
  'offline.html',
].map((p) => BASE + p);

// Which cache a URL belongs in.
function isSongPage(pathname) { return /\/songs\/[^/]+\.html$/.test(pathname); }
function isData(pathname) {
  return /\/(songs|song-previews|search-index|song-previews-public)\.json$/.test(pathname);
}
function cacheFor(url) {
  const { pathname } = new URL(url);
  return isSongPage(pathname) || isData(pathname) ? SONGS_CACHE : SHELL_CACHE;
}

function put(key, response) {
  const url = typeof key === 'string' ? key : key.url;
  return caches.open(cacheFor(url)).then((cache) => cache.put(key, response));
}

// Song pages and data from caches of the old single-cache layout
// ("bekovysongy-v41" and before) move into the songs cache before anything
// is downloaded, so a phone that had everything offline keeps it and the
// first install of this version doesn't fetch 628 pages again.
async function adoptOldCaches() {
  const songs = await caches.open(SONGS_CACHE);
  for (const name of await caches.keys()) {
    if (name === SONGS_CACHE || name.startsWith('shell-')) continue;
    const old = await caches.open(name);
    for (const req of await old.keys()) {
      const { pathname } = new URL(req.url);
      if (!isSongPage(pathname) && !isData(pathname)) continue;
      if (await songs.match(req)) continue;
      const res = await old.match(req);
      if (res) await songs.put(req, res);
    }
  }
}

// Caches every song, reporting progress via onProgress(done, total). On
// install only the songs not cached yet are fetched (the rest refresh as
// they're opened); the download button (refresh: true) fetches them all.
// Songs go one by one with limited concurrency (not one big addAll) so a
// handful of flaky fetches can't abort the rest and 600 requests don't all
// fire at once.
async function precacheAll(onProgress, refresh) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    await shell.addAll(APP_SHELL);
  } catch (e) {
    // A shell asset is missing/unreachable - songs are still worth caching.
  }

  const songs = await caches.open(SONGS_CACHE);
  // The lyrics index for the song list's full-text search. Generated at
  // deploy time, so on a local checkout it doesn't exist.
  try {
    if (refresh || !(await songs.match(BASE + 'search-index.json'))) await songs.add(BASE + 'search-index.json');
  } catch (e) {
    // Not deployed (or offline) - search falls back to names only.
  }

  let total = 0;
  let failed = 0;
  try {
    const res = await fetch(BASE + 'songs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await songs.put(BASE + 'songs.json', res.clone());
    const data = await res.json();
    // Admin-only drafts ("navrh" / "k-vytvoreni") have no page to cache -
    // every one of them would just be a 404 counted as a failure below.
    const urls = data.songs
      .filter((s) => s.status !== 'navrh' && s.status !== 'k-vytvoreni')
      .map((s) => BASE + 'songs/' + s.slug + '.html');

    // A song that is gone from songs.json goes from the cache too.
    const keep = new Set(urls);
    for (const req of await songs.keys()) {
      if (isSongPage(new URL(req.url).pathname) && !keep.has(req.url)) await songs.delete(req);
    }

    const todo = [];
    for (const url of urls) {
      if (refresh || !(await songs.match(url))) todo.push(url);
    }
    total = urls.length;
    let done = total - todo.length;
    if (onProgress) onProgress(done, total);

    let next = 0;
    const CONCURRENCY = 12;
    async function worker() {
      while (next < todo.length) {
        const url = todo[next++];
        try {
          await songs.add(url);
        } catch (e) {
          failed++;
        }
        done++;
        if (onProgress) onProgress(done, total);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  } catch (e) {
    // No network, or songs.json failed - the shell is still cached;
    // individual songs get cached as they're visited.
  }

  return { total, failed };
}

self.addEventListener('install', (event) => {
  event.waitUntil(adoptOldCaches().then(() => precacheAll(null, false)));
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'PRECACHE_ALL') return;
  const client = event.source;
  event.waitUntil(
    precacheAll((done, total) => {
      if (client) client.postMessage({ type: 'PRECACHE_PROGRESS', done, total });
    }, true).then(({ total, failed }) => {
      if (client) client.postMessage({ type: 'PRECACHE_DONE', total, failed });
    })
  );
});

// Everything but the songs cache and this version's shell goes - the old
// layout's caches included, after install has adopted their songs.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await adoptOldCaches();
    for (const name of await caches.keys()) {
      if (name !== SONGS_CACHE && name !== SHELL_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// Network first, but not forever: after `ms` the cached copy answers, and the
// request still finishes in the background and refreshes the cache.
function networkFirst(request, ms) {
  const fromNet = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response.ok) put(request, response.clone());
    return response;
  });
  const fromCache = caches.match(request);
  const late = new Promise((resolve) => setTimeout(resolve, ms))
    .then(() => fromCache)
    .then((cached) => cached || fromNet);
  return Promise.race([fromNet, late])
    .catch(() => fromCache.then((cached) => cached || Response.error()));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // e.g. Google Sign-In on /admin

  // songs.json: the admin, the random pick and the search all read it, and
  // cache-first could serve a returning visitor a stale song list
  // indefinitely. song-previews.json rides along: it's regenerated whenever
  // new návrhy are triaged, for a file only /admin reads.
  if (url.pathname.endsWith('/songs.json') || url.pathname.endsWith('/song-previews.json')) {
    event.respondWith(networkFirst(event.request, NETWORK_WAIT_MS));
    return;
  }

  const isPage = event.request.mode === 'navigate';
  const key = isPage ? url.origin + url.pathname : event.request;

  event.respondWith((async () => {
    const cached = await caches.match(key);
    const network = fetch(event.request)
      .then((response) => {
        // A redirected response can't answer a navigation from the cache
        // later (the browser refuses it), so those aren't kept.
        if (response.ok && !(isPage && response.redirected)) put(key, response.clone());
        return response;
      })
      // Only a page falls back to the offline page; a script or JSON that
      // got HTML back would just break in a stranger way.
      .catch(() => cached || (isPage ? caches.match(BASE + 'offline.html') : Response.error()));
    return cached || network;
  })());
});
