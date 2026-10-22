/**
 * song-list-core.js - the songbook's data and search logic, without any DOM
 * of its own: loads songs.json and the lyrics index, searches diacritic-blind
 * (lyric hits listed apart with the line they matched) with Google-style
 * operators (-slovo, "fráze", OR, autor:, before:...), filters by chords /
 * language / capo, sorts in Czech collation and picks random songs without
 * repeating the last twenty. Used by the song list (js/app.js) and the song
 * pages (js/player.js). Exposed as window.SongList.
 *
 * Also holds the browser-only stores: favourites, recently opened songs and
 * the local setlist. All of it is localStorage, wrapped so a private window
 * or blocked storage just forgets instead of throwing.
 */
(function () {
  'use strict';

  // The site root, worked out from where this file was loaded (it lives in
  // js/), so the same code works on the home page and on songs/*.html.
  const BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
    ? new URL('../', document.currentScript.src).href
    : '../';
  const DRAFT_STATUSES = ['navrh', 'k-vytvoreni'];
  const LYRICS_MIN_QUERY = 3;
  const RANDOM_HISTORY_KEY = 'random_history';
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

  // A song added within the last half year counts as new.
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

  // Where a song link points: the static song pages.
  let songHref = (slug) => BASE + 'songs/' + slug + '.html';

  // "H/F#" is played as H with an F# bass: two shapes. "E7/4" is a single
  // chord whose name happens to have a slash in it.
  function shapesOf(chord) {
    const parts = chord.split('/').map(p => p.trim()).filter(Boolean);
    return parts.length > 1 && parts.every(p => /^[A-H]/.test(p)) ? parts : [chord];
  }

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
    song._normTitle = norm(song.title);
    song._normAuthors = norm(authors.join(', '));
    song._prog = progressionOf(song);
    song._capo = capoLabel(song);
    song._new = !!song.added && song.added > NEW_SINCE;
    song._letter = indexLetter(song.title);
    song._needs = Array.from(new Set([].concat.apply([], song.chords.map(shapesOf))));
    song._normChords = Array.from(new Set(song.chords.concat(song._needs))).map(norm);
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

        // A slash chord (H/F#) is two shapes to know, the chord and the bass,
        // so the picker lists only the parts and never the combinations.
        const chordSet = new Set();
        songs.forEach(s => s._needs.forEach(c => chordSet.add(c)));
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

  // Where needle sits in hay; with whole, only where a word starts, so an
  // excluded "les" leaves "ples" alone (and still catches "lesy").
  const WORD_CHAR = /[\p{L}\p{N}]/u;

  function findIn(hay, needle, whole) {
    if (!whole) return hay.indexOf(needle);
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
      if (at === 0 || !WORD_CHAR.test(hay.charAt(at - 1))) return at;
    }
    return -1;
  }

  function findLyricHit(song, q, whole) {
    const entry = lyrics.index && lyrics.index.get(song.slug);
    if (!entry) return null;
    for (let i = 0; i < entry.norm.length; i++) {
      const at = findIn(entry.norm[i], q, whole);
      if (at !== -1) return { line: entry.lines[i], norm: entry.norm[i], at, len: q.length };
    }
    return null;
  }

  // === Search operators ====================================================

  // Google's tricks, keyed in Czech or English: -slovo leaves out songs that
  // have it, "..." wants exactly those words, OR takes either side and
  // key:value looks in one field only. Plain words still make one phrase,
  // searched in the title and artists and else within a single lyric line -
  // a remembered line is what people type, and splitting it into words
  // would match half the songbook.
  const OPERATORS = {
    autor: 'author', interpret: 'author', author: 'author', inauthor: 'author',
    nazev: 'title', title: 'title', intitle: 'title',
    text: 'text', intext: 'text',
    pred: 'before', before: 'before',
    po: 'after', after: 'after',
    akord: 'chord', chord: 'chord',
    jazyk: 'lang', lang: 'lang',
    capo: 'capo',
  };
  const TOKEN = /(-?)(?:([^\s:"„“”]+):)?(?:["„“”]([^"„“”]*)["„“”]?|(\S+))/g;

  // before: and after: take a year, a month or a day (2025, 2025-06,
  // 2025-06-01 or the Czech 1.6.2025) and compare the added date at that
  // precision, so before:2025 is anything from 2024 back.
  function datePrefix(v) {
    let y, m, d;
    let x = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(v);
    if (x) [, y, m, d] = x;
    else if ((x = /^(?:(\d{1,2})\.)?(\d{1,2})\.(\d{4})$/.exec(v))) [, d, m, y] = x;
    else return null;
    if ((m && (m < 1 || m > 12)) || (d && (d < 1 || d > 31))) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return y + (m ? '-' + pad(m) : '') + (d ? '-' + pad(d) : '');
  }

  // "Am" is how the rest of the world writes the "Ami" in songs.json.
  function chordSpellings(v) {
    const czech = v.replace(/^([a-h](?:#|b|is|es)?)m(?!aj|i)/, '$1mi');
    return czech === v ? [v] : [v, czech];
  }

  /**
   * Splits a query into groups that must all match (each a list of
   * alternatives joined by OR) and terms that must not. A term is
   * { field: 'any' | 'title' | 'author' | 'text' | 'chord' | 'lang' | 'capo'
   *   | 'before' | 'after', value (normalized), whole (match from a word
   *   start) }. An unknown key ("10:30") is plain text.
   */
  function parseQuery(raw) {
    const s = String(raw || '');
    const groups = [];
    const exclude = [];
    let phrase = null;   // the plain phrase that further plain words extend
    let or = false;

    for (const m of s.matchAll(TOKEN)) {
      const neg = m[1] === '-';
      let quoted = m[3] != null;
      let field = m[2] ? OPERATORS[norm(m[2])] : null;
      let value = quoted ? m[3] : m[4];
      const rest = s.slice(m.index + m[0].length).trim();

      if (m[2] && !field) { value = m[0].slice(m[1].length); quoted = false; }
      if (!m[2] && !quoted && !neg && (value === 'OR' || value === '|')) {
        or = true; phrase = null;
        continue;
      }
      // Half-typed: a key with nothing after it yet, or a dash at the end.
      const key = /^([^\s:]+):$/.exec(value);
      if (key && OPERATORS[norm(key[1])]) continue;
      if (value === '-' && !rest) continue;
      value = norm(value.trim());
      if (!value) continue;

      if (field === 'before' || field === 'after') {
        const day = datePrefix(value);
        if (day) value = day;
        else { field = null; value = norm(m[0].slice(m[1].length)); }
      }
      if (field === 'lang' && value === 'cs') value = 'cz';
      field = field || 'any';

      if (field === 'any' && !quoted && !neg && phrase && !or) {
        phrase.value += ' ' + value;
        continue;
      }
      const term = { field, value, whole: field === 'any' && (quoted || neg) };
      if (neg) exclude.push(term);
      else if (or && groups.length) groups[groups.length - 1].push(term);
      else groups.push([term]);
      phrase = field === 'any' && !quoted && !neg ? term : null;
      or = false;
    }
    return { groups, exclude };
  }

  // true when the song's own data answers the term, a lyric hit when only
  // its lyrics do (and they are loaded), false otherwise.
  function test(song, t, withLyrics) {
    const v = t.value;
    switch (t.field) {
      case 'title': return song._normTitle.includes(v);
      case 'author': return song._normAuthors.includes(v);
      case 'chord': return chordSpellings(v).some(c => song._normChords.indexOf(c) !== -1);
      case 'lang': return norm(song.tags.language || '') === v;
      case 'capo':
        if (/^\d+$/.test(v)) return Number(v) === 0 ? !song._capo : song.tags.capo === Number(v);
        if (['ano', 'yes'].indexOf(v) !== -1) return !!song._capo;
        if (['ne', 'no', 'bez'].indexOf(v) !== -1) return !song._capo;
        return false;
      case 'before': return !!song.added && song.added.slice(0, v.length) < v;
      case 'after': return !!song.added && song.added.slice(0, v.length) > v;
      case 'text': return (withLyrics && findLyricHit(song, v, false)) || false;
      default:
        if (findIn(song._name, v, t.whole) !== -1) return true;
        if (!withLyrics || (!t.whole && v.length < LYRICS_MIN_QUERY)) return false;
        return findLyricHit(song, v, t.whole) || false;
    }
  }

  function wantsLyrics(t) {
    return t.field === 'text' || (t.field === 'any' && (t.whole || t.value.length >= LYRICS_MIN_QUERY));
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
   * Returns { marks, named, lyric: [{ song, hit }], lyricsState, total, all }.
   * marks are the normalized words to pick out in a title; lyricsState is
   * 'off' when nothing in the query is searched for in the lyrics.
   */
  function query(state) {
    const parsed = parseQuery(state.q);
    const positive = [].concat.apply([], parsed.groups);
    const selected = state.chords || new Set();

    const passes = (song) => {
      if (state.lang && song.tags.language !== state.lang) return false;
      if (state.capo === 'yes' && !song._capo) return false;
      if (state.capo === 'no' && song._capo) return false;
      if (state.artist && song._authors.indexOf(state.artist) === -1) return false;
      if (selected.size > 0 && song._needs.length > 0) {
        for (const c of song._needs) if (!selected.has(c)) return false;
      }
      return true;
    };

    let lyricsState = 'off';
    if (positive.concat(parsed.exclude).some(wantsLyrics)) {
      ensureLyrics();
      lyricsState = lyrics.state;
    }
    const withLyrics = lyrics.state === 'ready';

    // A song the title, artists and tags answer in full is a named result;
    // one that needed its lyrics for some group is listed apart, with the
    // line that matched. Within a group a name match beats a lyric one.
    const named = [];
    const lyric = [];
    songs.forEach(song => {
      if (!passes(song)) return;
      if (parsed.exclude.some(t => test(song, t, withLyrics))) return;
      let hit = null;
      for (const group of parsed.groups) {
        let found = false;
        for (const t of group) {
          const r = test(song, t, withLyrics);
          if (r === true) { found = true; break; }
          if (r && !found) found = r;
        }
        if (!found) return;
        if (found !== true && !hit) hit = found;
      }
      if (hit) lyric.push({ song, hit });
      else named.push(song);
    });

    const cmp = compareBy(state.sort || 'title', state.dir || 1);
    named.sort(cmp);
    lyric.sort((a, b) => cmp(a.song, b.song));

    const marks = positive.filter(t => t.field === 'any' || t.field === 'title').map(t => t.value);
    return { marks, named, lyric, lyricsState, total: named.length + lyric.length, all: songs.length };
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

  // ?q= keeps a search shareable and is the target of the SearchAction in
  // the home page's JSON-LD: Google sends searchers straight to it.
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

  // The matched line, with the match picked out. norm() only
  // strips combining marks and lowercases, so for Czech the index carries
  // over; when it doesn't (a ligature), the plain line is shown instead.
  function snippet(hit, className) {
    const el = document.createElement('span');
    el.className = className || 'lyric-hit';
    if (hit.norm.length !== hit.line.length) {
      el.textContent = hit.line;
      return el;
    }
    el.appendChild(document.createTextNode(hit.line.slice(0, hit.at)));
    const mark = document.createElement('mark');
    mark.textContent = hit.line.slice(hit.at, hit.at + hit.len);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(hit.line.slice(hit.at + hit.len)));
    return el;
  }

  // One outline icon set (24px grid, drawn at 1.75px) for the whole site.
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
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4h-4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    print: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
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
    parseQuery,
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
