/**
 * table.js - Song table with filtering, sorting, and random pick
 */
(function () {
  'use strict';

  let allSongs = [];
  let filteredSongs = [];   // matched on title/author
  let lyricSongs = [];      // matched only on lyrics, listed after the above
  let sortCol = 'title';
  let sortAsc = true;
  let selectedChords = new Set();
  let allChords = [];

  // === Full-text search over the lyrics ===
  // One search box, not two: you type what you remember and the song turns
  // up whether that was its name or a line from it. What keeps that from
  // being confusing is that lyric-only hits are listed separately, under
  // their own heading, each showing the line it matched - so it's always
  // obvious why a song is in the list.
  //
  // search-index.json is ~570 kB, so it isn't loaded with the page: it's
  // fetched the first time a query is long enough to be worth searching
  // for, and the title/author results show immediately either way.
  const LYRICS_MIN_QUERY = 3;
  let lyricsIndex = null;    // slug -> { lines, norm } once loaded
  let lyricsState = 'idle';  // idle | loading | ready | failed

  function loadLyricsIndex() {
    if (lyricsState !== 'idle') return;
    lyricsState = 'loading';
    fetch('../search-index.json')
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(raw => {
        lyricsIndex = new Map();
        Object.keys(raw).forEach(slug => {
          const lines = raw[slug].split('\n');
          lyricsIndex.set(slug, { lines, norm: lines.map(normalizeForSearch) });
        });
        lyricsState = 'ready';
        applyFilters(); // fold in the hits for whatever is typed by now
      })
      .catch(err => {
        console.error('Failed to load search-index.json:', err);
        lyricsState = 'failed';
        applyFilters();
      });
  }

  // First line of `song` whose text contains `query`, as { line, at }.
  function findLyricHit(song, query) {
    const entry = lyricsIndex && lyricsIndex.get(song.slug);
    if (!entry) return null;
    for (let i = 0; i < entry.norm.length; i++) {
      const at = entry.norm[i].indexOf(query);
      if (at !== -1) return { line: entry.lines[i], norm: entry.norm[i], at };
    }
    return null;
  }

  // Random-pick no-repeat memory. Kept in localStorage (not a module-level
  // variable) because clicking "Random" navigates away to the song page,
  // which tears down this whole module.
  const RANDOM_HISTORY_KEY = 'random_history';
  const RANDOM_HISTORY_SIZE = 20;

  function loadRandomHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RANDOM_HISTORY_KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRandomHistory(history) {
    try {
      localStorage.setItem(RANDOM_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      // Private browsing / storage disabled: the pick above still happened,
      // it just won't be remembered for next time.
    }
  }

  // Admin-only statuses. A "návrh" / "k vytvoření" song is a title waiting
  // for a text - it has no songs/<slug>.html at all, so it must never reach
  // the table (its link would 404). Everything else, including entries with
  // no "status" field, is public.
  const DRAFT_STATUSES = ['navrh', 'k-vytvoreni'];

  function isPublic(song) {
    return DRAFT_STATUSES.indexOf(song.status) === -1;
  }

  // Interprets, newest shape first: "authors" is the canonical list, the
  // legacy "author" string is a single artist.
  function authorsOf(song) {
    if (Array.isArray(song.authors)) {
      const list = song.authors.map(a => String(a).trim()).filter(a => a !== '');
      if (list.length) return list;
    }
    const single = song.author ? String(song.author).trim() : '';
    return single ? [single] : [];
  }

  const tbody = document.getElementById('songs-tbody');
  const searchInput = document.getElementById('search-input');
  const langFilter = document.getElementById('lang-filter');
  const capoFilter = document.getElementById('capo-filter');
  const songCount = document.getElementById('song-count');
  const randomBtn = document.getElementById('random-btn');
  const chordGrid = document.getElementById('chord-grid');
  const chordFilterBtn = document.getElementById('chord-filter-btn');
  const chordDropdown = document.getElementById('chord-filter-dropdown');
  const chordSelectAll = document.getElementById('chord-select-all');
  const chordClearAll = document.getElementById('chord-clear-all');

  // Fetch songs.json
  fetch('../songs.json')
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(data => {
      allSongs = data.songs.filter(isPublic);
      collectChords();
      buildChordFilter();
      applyFilters();
      bindEvents();
    })
    .catch(err => {
      console.error('Failed to load songs.json:', err);
      songCount.textContent = '';
      tbody.innerHTML = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'table-error';
      td.textContent = 'Nepodařilo se načíst seznam písní — zkuste obnovit stránku.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    });

  function collectChords() {
    const set = new Set();
    allSongs.forEach(s => s.chords.forEach(c => set.add(c)));
    // Sort: major first, then minor, then others
    allChords = Array.from(set).sort((a, b) => {
      const aBase = a.replace(/[^A-H#b]/g, '');
      const bBase = b.replace(/[^A-H#b]/g, '');
      if (aBase !== bBase) return aBase.localeCompare(bBase);
      return a.length - b.length;
    });
  }

  function buildChordFilter() {
    chordGrid.innerHTML = '';
    allChords.forEach(chord => {
      const id = 'chord-' + chord.replace(/[^a-zA-Z0-9]/g, '_');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'chord-checkbox';
      cb.id = id;
      cb.value = chord;
      cb.addEventListener('change', function () {
        if (this.checked) selectedChords.add(chord);
        else selectedChords.delete(chord);
        updateChordBtnLabel();
        applyFilters();
      });

      const label = document.createElement('label');
      label.className = 'chord-label';
      label.htmlFor = id;
      label.textContent = chord;

      chordGrid.appendChild(cb);
      chordGrid.appendChild(label);
    });
  }

  function updateChordBtnLabel() {
    const n = selectedChords.size;
    chordFilterBtn.firstChild.textContent = n > 0
      ? `Akordy (${n})`
      : 'Vybrat akordy';
  }

  // Strip diacritics so e.g. "zelva" matches "želva" - handy on mobile
  // keyboards that don't type Czech háčky/čárky by default.
  function normalizeForSearch(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function applyFilters() {
    const query = normalizeForSearch(searchInput.value.trim());
    const lang = langFilter.value;
    const capo = capoFilter.value;

    // Everything except the text query - the lyric pass has to respect the
    // same language/capo/chord filters as the main list.
    const passesFilters = (song) => {
      if (lang && song.tags.language !== lang) return false;
      if (capo === 'yes' && !song.tags.capo) return false;
      if (capo === 'no' && song.tags.capo) return false;
      if (selectedChords.size > 0 && song.chords.length > 0) {
        for (const c of song.chords) {
          if (!selectedChords.has(c)) return false;
        }
      }
      return true;
    };

    const matchesName = (song) =>
      normalizeForSearch(song.title + ' ' + authorsOf(song).join(' ')).includes(query);

    filteredSongs = allSongs.filter(song =>
      passesFilters(song) && (!query || matchesName(song))
    );

    lyricSongs = [];
    if (query.length >= LYRICS_MIN_QUERY) {
      loadLyricsIndex();
      if (lyricsState === 'ready') {
        const named = new Set(filteredSongs.map(s => s.slug));
        allSongs.forEach(song => {
          if (named.has(song.slug) || !passesFilters(song)) return;
          const hit = findLyricHit(song, query);
          if (hit) lyricSongs.push({ song, hit });
        });
      }
    }

    sortSongs();
    render();
  }

  // Czech collation: č after c, ř after r, š after s, ž after z, etc.
  const csCollator = new Intl.Collator('cs', { sensitivity: 'base' });

  function sortSongs() {
    filteredSongs.sort(compareSongs);
    lyricSongs.sort((a, b) => compareSongs(a.song, b.song));
  }

  function compareSongs(a, b) {
    {
      let cmp;
      switch (sortCol) {
        case 'title':
          cmp = csCollator.compare(a.title, b.title);
          break;
        case 'author':
          // Sorted by the first-billed artist, the one the eye lands on.
          cmp = csCollator.compare(authorsOf(a)[0] || '', authorsOf(b)[0] || '');
          break;
        case 'chords':
          cmp = a.chords.length - b.chords.length;
          break;
        case 'language':
          cmp = csCollator.compare(a.tags.language, b.tags.language);
          break;
        default:
          cmp = csCollator.compare(a.title, b.title);
      }
      return sortAsc ? cmp : -cmp;
    }
  }

  function makeChordBadge(name) {
    const badge = document.createElement('span');
    badge.className = 'chord-badge';
    badge.textContent = name;
    return badge;
  }

  // The matched line, with the query itself picked out. normalizeForSearch
  // only strips combining marks and lowercases, so for Czech the normalized
  // line is the same length as the original and the match index carries over
  // - but a string where it doesn't (a ligature, say) would slice in the
  // wrong place, so fall back to the plain line rather than mangle it.
  function makeSnippet(hit, queryLength) {
    const el = document.createElement('div');
    el.className = 'song-lyric-hit';

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

  function render() {
    const total = filteredSongs.length + lyricSongs.length;
    songCount.textContent = `${total} z ${allSongs.length} písní` +
      (lyricSongs.length ? ` (z toho ${lyricSongs.length} podle textu)` : '');

    const fragment = document.createDocumentFragment();
    const query = normalizeForSearch(searchInput.value.trim());

    filteredSongs.forEach(song => fragment.appendChild(makeRow(song, null, query)));

    // Songs that only matched in their lyrics go under their own heading,
    // each showing the line that matched - so a hit is never a mystery.
    if (lyricSongs.length) {
      const headTr = document.createElement('tr');
      headTr.className = 'lyric-group-head';
      const th = document.createElement('td');
      th.colSpan = 4;
      th.textContent = 'Nalezeno v textu písně';
      headTr.appendChild(th);
      fragment.appendChild(headTr);
      lyricSongs.forEach(({ song, hit }) => fragment.appendChild(makeRow(song, hit, query)));
    }

    // A query long enough to search lyrics for, with the index still on its
    // way (or unreachable): say so rather than let a name-only result look
    // like the whole answer.
    if (query.length >= LYRICS_MIN_QUERY && lyricsState !== 'ready') {
      const tr = document.createElement('tr');
      tr.className = 'lyric-group-head';
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = lyricsState === 'failed'
        ? 'Hledání v textech písní se nepodařilo načíst — hledá se jen v názvech a interpretech.'
        : 'Hledám i v textech písní…';
      tr.appendChild(td);
      fragment.appendChild(tr);
    }

    if (!total && !(query.length >= LYRICS_MIN_QUERY && lyricsState === 'loading')) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'table-empty';
      td.textContent = 'Nic nenalezeno — zkus jiný název, interpreta nebo úryvek textu.';
      tr.appendChild(td);
      fragment.appendChild(tr);
    }

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function makeRow(song, hit, query) {
    {
      const tr = document.createElement('tr');

      // Title
      const tdTitle = document.createElement('td');
      const titleLink = document.createElement('a');
      titleLink.href = '../songs/' + song.slug + '.html';
      titleLink.className = 'song-title-link';
      titleLink.textContent = song.title;
      tdTitle.appendChild(titleLink);
      if (hit) tdTitle.appendChild(makeSnippet(hit, query.length));

      // Author(s) - one clickable chip per interpret, so a song credited to
      // two artists doesn't read as one band with a comma in its name, and
      // clicking either one filters by just that artist.
      const tdAuthor = document.createElement('td');
      authorsOf(song).forEach((name, i) => {
        if (i > 0) tdAuthor.appendChild(document.createTextNode(', '));
        const authorSpan = document.createElement('span');
        authorSpan.className = 'song-author-link';
        authorSpan.textContent = name;
        authorSpan.addEventListener('click', () => {
          searchInput.value = name;
          applyFilters();
        });
        tdAuthor.appendChild(authorSpan);
      });

      // Chords - grouped by section (song.progression) when available, with
      // a separator between groups; otherwise the flat deduped list, as
      // before. Filtering/sorting (collectChords/applyFilters/sortSongs)
      // always use the flat song.chords, untouched - this only changes what
      // gets drawn in the cell.
      const tdChords = document.createElement('td');
      const chordsDiv = document.createElement('div');
      chordsDiv.className = 'chord-badges';
      if (Array.isArray(song.progression) && song.progression.length) {
        song.progression.forEach((group, i) => {
          if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'chord-badge-sep';
            sep.setAttribute('aria-hidden', 'true');
            chordsDiv.appendChild(sep);
          }
          group.forEach(c => chordsDiv.appendChild(makeChordBadge(c)));
        });
      } else {
        song.chords.forEach(c => chordsDiv.appendChild(makeChordBadge(c)));
      }
      tdChords.appendChild(chordsDiv);

      // Language
      const tdLang = document.createElement('td');
      const langSpan = document.createElement('span');
      langSpan.className = 'song-lang';
      langSpan.textContent = song.tags.language;
      tdLang.appendChild(langSpan);

      tr.appendChild(tdTitle);
      tr.appendChild(tdAuthor);
      tr.appendChild(tdChords);
      tr.appendChild(tdLang);
      return tr;
    }
  }

  function bindEvents() {
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(applyFilters, 200);
    });

    langFilter.addEventListener('change', applyFilters);
    capoFilter.addEventListener('change', applyFilters);

    // Sort headers (mouse and keyboard - the header acts as a button)
    function sortByHeader(th) {
      const col = th.dataset.sort;
      if (sortCol === col) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col;
        sortAsc = true;
      }
      // Update header styles
      document.querySelectorAll('.songs-table th').forEach(h => {
        h.classList.remove('sorted');
        h.querySelector('.sort-arrow').textContent = '▲';
        h.setAttribute('aria-sort', 'none');
      });
      th.classList.add('sorted');
      th.querySelector('.sort-arrow').textContent = sortAsc ? '▲' : '▼';
      th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
      applyFilters();
    }

    document.querySelectorAll('.songs-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => sortByHeader(th));
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          sortByHeader(th);
        }
      });
    });

    // Random - skips the last ~20 picks so the same song doesn't keep coming
    // back. If the current filter/search narrows the pool below that (or
    // below 1), fall back to the full filtered pool rather than getting
    // stuck with nothing to pick - a small pool naturally repeats sooner,
    // which is fine; the history itself is left untouched in that case.
    randomBtn.addEventListener('click', () => {
      // Everything currently on screen, lyric hits included - they're as
      // much a result of the search as the title matches above them.
      const shown = filteredSongs.concat(lyricSongs.map(l => l.song));
      if (shown.length === 0) return;
      const history = loadRandomHistory();
      let pool = shown.filter(s => !history.includes(s.slug));
      if (pool.length === 0) pool = shown;

      const song = pool[Math.floor(Math.random() * pool.length)];

      const next = history.filter(slug => slug !== song.slug);
      next.push(song.slug);
      while (next.length > RANDOM_HISTORY_SIZE) next.shift();
      saveRandomHistory(next);

      window.location.href = '../songs/' + song.slug + '.html';
    });

    // Chord filter dropdown
    chordFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chordDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!chordDropdown.contains(e.target) && e.target !== chordFilterBtn) {
        chordDropdown.classList.remove('open');
      }
    });

    chordSelectAll.addEventListener('click', () => {
      allChords.forEach(c => selectedChords.add(c));
      chordGrid.querySelectorAll('.chord-checkbox').forEach(cb => cb.checked = true);
      updateChordBtnLabel();
      applyFilters();
    });

    chordClearAll.addEventListener('click', () => {
      selectedChords.clear();
      chordGrid.querySelectorAll('.chord-checkbox').forEach(cb => cb.checked = false);
      updateChordBtnLabel();
      applyFilters();
    });
  }
})();
