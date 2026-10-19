/**
 * song-list-core.js - the song list's data and search logic without any DOM
 * of its own, shared by the three /test1-3/ redesign proposals. It does what
 * table.js does with songs.json and the lyrics index (diacritic-blind search,
 * lyric hits listed apart with the line they matched, chord/language/capo
 * filters, Czech collation, the no-repeat random pick) so each proposal only
 * has to draw a list. Exposed as window.SongList.
 *
 * Also holds the browser-only stores the proposals add on top: favourites,
 * recently opened songs and tonight's setlist. All of it is localStorage,
 * wrapped so a private window or blocked storage just forgets instead of
 * throwing.
 */
(function () {
  'use strict';

  const BASE = '../';
  const DRAFT_STATUSES = ['navrh', 'k-vytvoreni'];
  const LYRICS_MIN_QUERY = 3;
  const RANDOM_HISTORY_KEY = 'random_history';   // shared with table.js
  const RANDOM_HISTORY_SIZE = 20;

  const collator = new Intl.Collator('cs', { sensitivity: 'base' });

  // === Storage =============================================================

  function readJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Storage disabled: the action still happened, it just isn't remembered.
    }
  }

  // === Song helpers ========================================================

  function norm(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function authorsOf(song) {
    if (Array.isArray(song.authors)) {
      const list = song.authors.map(a => String(a).trim()).filter(a => a !== '');
      if (list.length) return list;
    }
    const single = song.author ? String(song.author).trim() : '';
    return single ? [single] : [];
  }

  function isoDay(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Same half-year window as the NEW badge in table.js.
  const NEW_SINCE = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return isoDay(d);
  })();

  function formatDay(added) {
    const [y, m, d] = added.split('-');
    return `${Number(d)}. ${Number(m)}. ${y}`;
  }

  const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen',
    'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

  function formatMonth(added) {
    const [y, m] = added.split('-');
    const name = MONTHS[Number(m) - 1];
    return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + y;
  }

  // Chords in a section, each once, in the order they first appear - the
  // progression arrays repeat a chord every time it comes round, which is
  // right for the song page and noise in a one-line summary.
  function dedupe(list) {
    const seen = new Set();
    return list.filter(c => (seen.has(c) ? false : (seen.add(c), true)));
  }

  // Up to four sections read as sloka | refrén | bridge; a song cut into
  // more pieces than that turns the summary into a wall, so it falls back to
  // the plain list of its chords.
  const MAX_GROUPS = 4;

  function progressionOf(song) {
    if (Array.isArray(song.progression) && song.progression.length) {
      const groups = song.progression.map(dedupe).filter(g => g.length);
      if (groups.length && groups.length <= MAX_GROUPS) return groups;
    }
    return song.chords.length ? [song.chords.slice()] : [];
  }

  function capoLabel(song) {
    const capo = song.tags && song.tags.capo;
    if (typeof capo === 'number' && capo > 0) return 'Capo ' + capo;
    return capo ? 'Capo' : '';
  }

  // The letter a song files under in a Czech index: Č, Ř, Š, Ž and Ch are
  // letters of their own, the other accented capitals file with their base
  // letter, and anything that isn't a letter goes under "#".
  const OWN_LETTERS = new Set(['Č', 'Ř', 'Š', 'Ž']);

  function indexLetter(text) {
    const t = String(text).trim();
    if (!t) return '#';
    if (/^ch/i.test(t)) return 'Ch';
    const ch = t.charAt(0).toUpperCase();
    if (OWN_LETTERS.has(ch)) return ch;
    const base = ch.normalize('NFD').charAt(0);
    return /[A-Z]/.test(base) ? base : '#';
  }

  // Chord picker order: by root up the scale from C (Czech names, so B is
  // B-flat and H is B), then plain major, minor and seventh before the rest.
  const ROOTS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 10, H: 11 };

  function chordKey(name) {
    const m = /^([A-H])(#|b|is|es)?(.*)$/.exec(name);
    if (!m) return [99, 9, name];
    let root = ROOTS[m[1]];
    if (m[2] === '#' || m[2] === 'is') root += 0.5;
    if ((m[2] === 'b' || m[2] === 'es') && m[1] !== 'B') root -= 0.5;
    const rest = m[3];
    const rank = rest === '' ? 0 : rest === 'mi' ? 1 : rest === '7' ? 2 : rest === 'mi7' ? 3 : 4;
    return [(root + 12) % 12, rank, rest];
  }

  function compareChords(a, b) {
    const ka = chordKey(a);
    const kb = chordKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    if (ka[2].length !== kb[2].length) return ka[2].length - kb[2].length;
    return ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0;
  }

  // The chord picker groups chords by the letter they start on, so C# sits
  // under C: tap the root, then pick among everything built on it. Within a
  // family: the plain major, minor and seventh first, then the sharps and
  // flats, then everything else (maj7, sus4, slash chords...).
  const FAMILY_ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'H'];

  function chordFamilies(chords) {
    const make = (root) => ({ root, basic: [], accidental: [], other: [], all: [] });
    const fam = new Map(FAMILY_ORDER.map(l => [l, make(l)]));
    const rest = make('?');
    chords.slice().sort(compareChords).forEach(c => {
      const m = /^([A-H])(#|b|is|es)?(.*)$/.exec(c);
      const f = m ? fam.get(m[1]) : rest;
      f.all.push(c);
      if (!m) f.other.push(c);
      else if (m[2]) f.accidental.push(c);
      else if (m[3] === '' || m[3] === 'mi' || m[3] === '7') f.basic.push(c);
      else f.other.push(c);
    });
    const list = FAMILY_ORDER.map(l => fam.get(l)).filter(f => f.all.length);
    if (rest.all.length) list.push(rest);
    return list;
  }

  // Where a song link points. The real list links the static song pages; a
  // page that renders songs itself (the /test4/ prototype) swaps this out.
  let songHref = (slug) => BASE + 'songs/' + slug + '.html';

  function href(song) {
    return songHref(song.slug);
  }

  function setSongHref(fn) {
    songHref = fn;
  }

  // === Loading =============================================================

  let songs = [];
  const bySlug = new Map();
  let allChords = [];
  let artists = [];
  let loadPromise = null;

  function prepare(song) {
    const authors = authorsOf(song);
    song._authors = authors;
    song._name = norm(song.title + ' ' + authors.join(' '));
    song._prog = progressionOf(song);
    song._capo = capoLabel(song);
    song._new = !!song.added && song.added > NEW_SINCE;
    song._letter = indexLetter(song.title);
    return song;
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(BASE + 'songs.json')
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        songs = data.songs.filter(s => DRAFT_STATUSES.indexOf(s.status) === -1).map(prepare);
        songs.forEach(s => bySlug.set(s.slug, s));

        const chordSet = new Set();
        songs.forEach(s => s.chords.forEach(c => chordSet.add(c)));
        allChords = Array.from(chordSet).sort(compareChords);

        const byArtist = new Map();
        songs.forEach(s => s._authors.forEach(a => {
          if (!byArtist.has(a)) byArtist.set(a, []);
          byArtist.get(a).push(s);
        }));
        artists = Array.from(byArtist, ([name, list]) => ({
          name,
          norm: norm(name),
          letter: indexLetter(name),
          songs: list.sort((a, b) => collator.compare(a.title, b.title)),
        })).sort((a, b) => collator.compare(a.name, b.name));

        return { songs, chords: allChords, artists };
      });
    return loadPromise;
  }

  // === Lyrics index ========================================================

  const lyrics = { state: 'idle', index: null, listeners: [] };

  function ensureLyrics() {
    if (lyrics.state !== 'idle') return;
    lyrics.state = 'loading';
    fetch(BASE + 'search-index.json')
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(raw => {
        lyrics.index = new Map();
        Object.keys(raw).forEach(slug => {
          const lines = raw[slug].split('\n');
          lyrics.index.set(slug, { lines, norm: lines.map(norm) });
        });
        lyrics.state = 'ready';
      })
      .catch(err => {
        console.error('Failed to load search-index.json:', err);
        lyrics.state = 'failed';
      })
      .then(() => lyrics.listeners.forEach(fn => fn(lyrics.state)));
  }

  function onLyrics(fn) {
    lyrics.listeners.push(fn);
  }

  function findLyricHit(song, q) {
    const entry = lyrics.index && lyrics.index.get(song.slug);
    if (!entry) return null;
    for (let i = 0; i < entry.norm.length; i++) {
      const at = entry.norm[i].indexOf(q);
      if (at !== -1) return { line: entry.lines[i], norm: entry.norm[i], at };
    }
    return null;
  }

  // === Query ===============================================================

  function compareBy(sort, dir) {
    const sign = dir < 0 ? -1 : 1;
    return function (a, b) {
      let cmp;
      switch (sort) {
        case 'author':
          cmp = collator.compare(a._authors[0] || '', b._authors[0] || '') ||
            collator.compare(a.title, b.title) * sign;
          break;
        case 'chords':
          cmp = (a.chords.length - b.chords.length) || collator.compare(a.title, b.title) * sign;
          break;
        case 'language':
          cmp = collator.compare(a.tags.language, b.tags.language) || collator.compare(a.title, b.title) * sign;
          break;
        case 'added':
          // Undated last either way round; a shared day stays alphabetical.
          if (!a.added !== !b.added) return a.added ? -1 : 1;
          if (a.added === b.added) return collator.compare(a.title, b.title);
          cmp = a.added < b.added ? -1 : 1;
          break;
        default:
          cmp = collator.compare(a.title, b.title);
      }
      return cmp * sign;
    };
  }

  /**
   * state: { q, lang, capo ('' | 'yes' | 'no'), chords (Set), artist,
   *          sort ('title' | 'author' | 'chords' | 'language' | 'added'),
   *          dir (1 | -1) }
   * Returns { q, named, lyric: [{ song, hit }], lyricsState, total, all }.
   * lyricsState is 'off' when the query is too short to search lyrics for.
   */
  function query(state) {
    const q = norm((state.q || '').trim());
    const selected = state.chords || new Set();

    const passes = (song) => {
      if (state.lang && song.tags.language !== state.lang) return false;
      if (state.capo === 'yes' && !song._capo) return false;
      if (state.capo === 'no' && song._capo) return false;
      if (state.artist && song._authors.indexOf(state.artist) === -1) return false;
      if (selected.size > 0 && song.chords.length > 0) {
        for (const c of song.chords) if (!selected.has(c)) return false;
      }
      return true;
    };

    const named = songs.filter(s => passes(s) && (!q || s._name.includes(q)));
    const lyric = [];
    let lyricsState = 'off';

    if (q.length >= LYRICS_MIN_QUERY) {
      ensureLyrics();
      lyricsState = lyrics.state;
      if (lyrics.state === 'ready') {
        const seen = new Set(named.map(s => s.slug));
        songs.forEach(song => {
          if (seen.has(song.slug) || !passes(song)) return;
          const hit = findLyricHit(song, q);
          if (hit) lyric.push({ song, hit });
        });
      }
    }

    const cmp = compareBy(state.sort || 'title', state.dir || 1);
    named.sort(cmp);
    lyric.sort((a, b) => cmp(a.song, b.song));

    return { q, named, lyric, lyricsState, total: named.length + lyric.length, all: songs.length };
  }

  function filtersActive(state) {
    return !!(state.lang || state.capo || state.artist || (state.chords && state.chords.size));
  }

  // "123 z 611 písní (z toho 5 podle textu)"
  function plural(n, one, few, many) {
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
  }

  function countLine(res) {
    let line = res.total === res.all && !res.lyric.length
      ? `${res.all} ${plural(res.all, 'píseň', 'písně', 'písní')}`
      : `${res.total} z ${res.all} písní`;
    if (res.lyric.length) line += ` (z toho ${res.lyric.length} podle textu)`;
    return line;
  }

  // === Random pick =========================================================

  function pickRandom(pool) {
    if (!pool.length) return null;
    const history = readJSON(RANDOM_HISTORY_KEY, []);
    const list = Array.isArray(history) ? history : [];
    let candidates = pool.filter(s => list.indexOf(s.slug) === -1);
    if (!candidates.length) candidates = pool;
    const song = candidates[Math.floor(Math.random() * candidates.length)];
    const next = list.filter(slug => slug !== song.slug);
    next.push(song.slug);
    while (next.length > RANDOM_HISTORY_SIZE) next.shift();
    writeJSON(RANDOM_HISTORY_KEY, next);
    return song;
  }

  function randomHistory() {
    const v = readJSON(RANDOM_HISTORY_KEY, []);
    return Array.isArray(v) ? v : [];
  }

  // A dealt song that actually got opened counts as a random pick, so it
  // stays out of the next twenty draws like one picked by the button.
  function rememberRandom(slug) {
    const next = randomHistory().filter(s => s !== slug);
    next.push(slug);
    while (next.length > RANDOM_HISTORY_SIZE) next.shift();
    writeJSON(RANDOM_HISTORY_KEY, next);
  }

  // Several distinct songs at once, for a "dealt for you" block. Doesn't
  // touch the random history: nothing has been played yet.
  function deal(pool, n, avoid) {
    const skip = new Set(avoid || []);
    const rest = pool.filter(s => !skip.has(s.slug));
    const from = rest.length >= n ? rest : pool.slice();
    for (let i = from.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = from[i]; from[i] = from[j]; from[j] = t;
    }
    return from.slice(0, n);
  }

  // === Browser stores (new) ================================================

  const FAV_KEY = 'bs_favourites';
  const RECENT_KEY = 'bs_recent';
  const SETLIST_KEY = 'bs_setlist';
  const RECENT_MAX = 120;

  const favourites = {
    list() {
      const v = readJSON(FAV_KEY, []);
      return Array.isArray(v) ? v : [];
    },
    has(slug) {
      return this.list().indexOf(slug) !== -1;
    },
    toggle(slug) {
      const list = this.list();
      const i = list.indexOf(slug);
      if (i === -1) list.unshift(slug); else list.splice(i, 1);
      writeJSON(FAV_KEY, list);
      return i === -1;
    },
  };

  // Every song opened from a list, newest first, as { s: slug, t: ms }.
  const recent = {
    list() {
      const v = readJSON(RECENT_KEY, []);
      return Array.isArray(v) ? v.filter(e => e && bySlug.has(e.s)) : [];
    },
    add(slug) {
      const list = readJSON(RECENT_KEY, []);
      const next = (Array.isArray(list) ? list : []).filter(e => e && e.s !== slug);
      next.unshift({ s: slug, t: Date.now() });
      writeJSON(RECENT_KEY, next.slice(0, RECENT_MAX));
    },
  };

  const setlist = {
    list() {
      const v = readJSON(SETLIST_KEY, []);
      return Array.isArray(v) ? v.filter(slug => bySlug.has(slug)) : [];
    },
    save(list) {
      writeJSON(SETLIST_KEY, list);
    },
    has(slug) {
      return this.list().indexOf(slug) !== -1;
    },
    toggle(slug) {
      const list = this.list();
      const i = list.indexOf(slug);
      if (i === -1) list.push(slug); else list.splice(i, 1);
      this.save(list);
      return i === -1;
    },
  };

  // === Page state ==========================================================

  // ?q= keeps a search shareable and is the target of the SearchAction on
  // the home page, so every proposal reads and writes it like table.js does.
  function queryFromUrl() {
    return new URLSearchParams(location.search).get('q') || '';
  }

  function syncQueryToUrl(q) {
    const url = new URL(location.href);
    if (q && q.trim()) url.searchParams.set('q', q.trim());
    else url.searchParams.delete('q');
    history.replaceState(history.state, '', url);
  }

  // Filters and scroll survive the round trip to a song page even when the
  // browser drops this page from its back-forward cache.
  function saveState(key, value) {
    try {
      sessionStorage.setItem('bs_state_' + key, JSON.stringify(value));
    } catch (e) { /* not remembered */ }
  }

  function loadState(key) {
    try {
      return JSON.parse(sessionStorage.getItem('bs_state_' + key)) || null;
    } catch (e) {
      return null;
    }
  }

  // === DOM helpers =========================================================

  // The matched line, with the query picked out (see table.js makeSnippet).
  function snippet(hit, queryLength, className) {
    const el = document.createElement('span');
    el.className = className || 'lyric-hit';
    if (hit.norm.length !== hit.line.length) {
      el.textContent = hit.line;
      return el;
    }
    el.appendChild(document.createTextNode(hit.line.slice(0, hit.at)));
    const mark = document.createElement('mark');
    mark.textContent = hit.line.slice(hit.at, hit.at + queryLength);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(hit.line.slice(hit.at + queryLength)));
    return el;
  }

  // One outline icon set (24px grid, drawn at 1.75px), so every proposal
  // speaks the same icon language.
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    compass: '<circle cx="12" cy="12" r="9.5"/><path d="m15.8 8.2-1.9 5.7-5.7 1.9 1.9-5.7z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/>',
    sort: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
    note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    playlist: '<path d="M21 15V6"/><circle cx="18.5" cy="15.5" r="2.5"/><path d="M12 12H3M16 6H3M12 18H3"/>',
    minus: '<path d="M5 12h14"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    fretboard: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 8.5h14M5 14h14M9.7 3v18M14.3 3v18"/>',
    metronome: '<path d="M9 3h6l4 18H5z"/><path d="M12 15l5-9"/><path d="M7.5 15h9"/>',
    tuner: '<path d="M3.3 19a10 10 0 1 1 17.4 0"/><path d="m12 14 4-5"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    next: '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/>',
    prev: '<path d="M19 20 9 12l10-8z"/><path d="M5 19V5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  };

  function icon(name, size) {
    const s = size || 20;
    return `<svg class="icon" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  }

  // The site's own mark (the eighth note from assets/favicon.svg), drawn in
  // whatever colour the proposal gives it.
  function mark(size) {
    const s = size || 28;
    return `<svg class="mark" viewBox="0 0 32 32" width="${s}" height="${s}" aria-hidden="true" focusable="false"><rect x="18" y="6" width="2.6" height="15.5" fill="currentColor"/><path d="M20.6 6c3.6 1.6 5 4 4.4 7.4-1-2-2.6-3.2-4.4-3.8V6z" fill="currentColor"/><ellipse cx="15.8" cy="23" rx="4.2" ry="3.2" transform="rotate(-18 15.8 23)" fill="currentColor"/></svg>`;
  }

  window.SongList = {
    BASE,
    LYRICS_MIN_QUERY,
    collator,
    load,
    get songs() { return songs; },
    get chords() { return allChords; },
    get artists() { return artists; },
    bySlug: (slug) => bySlug.get(slug),
    norm,
    authorsOf,
    formatDay,
    formatMonth,
    indexLetter,
    compareChords,
    chordFamilies,
    href,
    setSongHref,
    query,
    filtersActive,
    countLine,
    plural,
    ensureLyrics,
    onLyrics,
    get lyricsState() { return lyrics.state; },
    pickRandom,
    deal,
    randomHistory,
    rememberRandom,
    favourites,
    recent,
    setlist,
    queryFromUrl,
    syncQueryToUrl,
    saveState,
    loadState,
    snippet,
    icon,
    mark,
  };
})();
