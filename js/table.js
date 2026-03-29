/**
 * table.js - Song table with filtering, sorting, and random pick
 */
(function () {
  'use strict';

  let allSongs = [];
  let filteredSongs = [];
  let sortCol = 'title';
  let sortAsc = true;
  let selectedChords = new Set();
  let allChords = [];

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
    .then(r => r.json())
    .then(data => {
      allSongs = data.songs;
      collectChords();
      buildChordFilter();
      applyFilters();
      bindEvents();
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

  function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();
    const lang = langFilter.value;
    const capo = capoFilter.value;

    filteredSongs = allSongs.filter(song => {
      // Text search
      if (query) {
        const haystack = (song.title + ' ' + song.author).toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      // Language
      if (lang && song.tags.language !== lang) return false;
      // Capo
      if (capo === 'yes' && !song.tags.capo) return false;
      if (capo === 'no' && song.tags.capo) return false;
      // Chord filter: all song chords must be in selected set
      if (selectedChords.size > 0 && song.chords.length > 0) {
        for (const c of song.chords) {
          if (!selectedChords.has(c)) return false;
        }
      }
      return true;
    });

    sortSongs();
    render();
  }

  // Czech collation: č after c, ř after r, š after s, ž after z, etc.
  const csCollator = new Intl.Collator('cs', { sensitivity: 'base' });

  function sortSongs() {
    filteredSongs.sort((a, b) => {
      let cmp;
      switch (sortCol) {
        case 'title':
          cmp = csCollator.compare(a.title, b.title);
          break;
        case 'author':
          cmp = csCollator.compare(a.author, b.author);
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
    });
  }

  function render() {
    songCount.textContent = `${filteredSongs.length} z ${allSongs.length} písní`;

    const fragment = document.createDocumentFragment();
    filteredSongs.forEach(song => {
      const tr = document.createElement('tr');

      // Title
      const tdTitle = document.createElement('td');
      const titleLink = document.createElement('a');
      titleLink.href = '../songs/' + song.slug + '.html';
      titleLink.className = 'song-title-link';
      titleLink.textContent = song.title;
      tdTitle.appendChild(titleLink);

      // Author
      const tdAuthor = document.createElement('td');
      if (song.author) {
        const authorSpan = document.createElement('span');
        authorSpan.className = 'song-author-link';
        authorSpan.textContent = song.author;
        authorSpan.addEventListener('click', () => {
          searchInput.value = song.author;
          applyFilters();
        });
        tdAuthor.appendChild(authorSpan);
      }

      // Chords
      const tdChords = document.createElement('td');
      const chordsDiv = document.createElement('div');
      chordsDiv.className = 'chord-badges';
      song.chords.forEach(c => {
        const badge = document.createElement('span');
        badge.className = 'chord-badge';
        badge.textContent = c;
        chordsDiv.appendChild(badge);
      });
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
      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function bindEvents() {
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(applyFilters, 200);
    });

    langFilter.addEventListener('change', applyFilters);
    capoFilter.addEventListener('change', applyFilters);

    // Sort headers
    document.querySelectorAll('.songs-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
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
        });
        th.classList.add('sorted');
        th.querySelector('.sort-arrow').textContent = sortAsc ? '▲' : '▼';
        applyFilters();
      });
    });

    // Random
    randomBtn.addEventListener('click', () => {
      if (filteredSongs.length === 0) return;
      const song = filteredSongs[Math.floor(Math.random() * filteredSongs.length)];
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
