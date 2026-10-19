/**
 * Návrh 1 "Aplikace": the song list split into four jobs behind a bottom
 * tab bar - Písně (search and the full list), Interpreti, Objevit (a drawn
 * song and what's new) and Moje (favourites, what was played, offline).
 * All the song logic lives in js/song-list-core.js.
 */
(function () {
  'use strict';

  const SL = window.SongList;
  const $ = (id) => document.getElementById(id);

  // ---- state -------------------------------------------------------------

  const state = {
    q: SL.queryFromUrl(),
    lang: '',
    capo: '',
    chords: new Set(),
    sort: 'title',
    dir: 1,
  };
  let artistSort = 'az';
  let artistQuery = '';
  let drawnSlug = '';
  const scrollByView = {};
  let currentView = 'pisne';
  let ready = false;

  const SORTS = [
    { id: 'title', label: 'Název', dirs: ['A → Z', 'Z → A'] },
    { id: 'author', label: 'Interpret', dirs: ['A → Z', 'Z → A'] },
    { id: 'chords', label: 'Počet akordů', dirs: ['Od nejméně', 'Od nejvíc'] },
    { id: 'language', label: 'Jazyk', dirs: ['A → Z', 'Z → A'] },
    { id: 'added', label: 'Přidáno', dirs: ['Od nejstarších', 'Od nejnovějších'], defaultDir: -1 },
  ];
  const LANGS = [
    { id: '', label: 'Všechny jazyky' },
    { id: 'CZ', label: 'Čeština' },
    { id: 'EN', label: 'Angličtina' },
    { id: 'SK', label: 'Slovenština' },
    { id: 'PL', label: 'Polština' },
  ];
  const CAPOS = [
    { id: '', label: 'S capem i bez' },
    { id: 'yes', label: 'Jen s capem' },
    { id: 'no', label: 'Jen bez capa' },
  ];

  // Restore filters after coming back from a song page when the browser
  // didn't keep this page alive in its back-forward cache.
  (function restore() {
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (!nav || nav.type !== 'back_forward') return;
    const saved = SL.loadState('test1');
    if (!saved) return;
    state.lang = saved.lang || '';
    state.capo = saved.capo || '';
    state.chords = new Set(saved.chords || []);
    state.sort = saved.sort || 'title';
    state.dir = saved.dir || 1;
    artistSort = saved.artistSort || 'az';
    drawnSlug = saved.drawn || '';
    Object.assign(scrollByView, saved.scroll || {});
  })();

  window.addEventListener('pagehide', () => {
    scrollByView[currentView] = window.scrollY;
    SL.saveState('test1', {
      lang: state.lang, capo: state.capo, chords: Array.from(state.chords),
      sort: state.sort, dir: state.dir, artistSort, drawn: drawnSlug, scroll: scrollByView,
    });
  });

  // ---- small DOM helpers -------------------------------------------------

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(n => {
      if (!n.firstChild) n.innerHTML = SL.icon(n.dataset.icon);
    });
  }

  // The query picked out inside a title (the normalized title has the same
  // length as the original for Czech, so the index carries over).
  function highlighted(text, q) {
    const frag = document.createDocumentFragment();
    if (!q) { frag.appendChild(document.createTextNode(text)); return frag; }
    const n = SL.norm(text);
    const at = n.indexOf(q);
    if (at === -1 || n.length !== text.length) { frag.appendChild(document.createTextNode(text)); return frag; }
    frag.appendChild(document.createTextNode(text.slice(0, at)));
    const m = el('mark', 'title-mark', text.slice(at, at + q.length));
    frag.appendChild(m);
    frag.appendChild(document.createTextNode(text.slice(at + q.length)));
    return frag;
  }

  function tagsOf(song) {
    const tags = [];
    if (song.tags.language && song.tags.language !== 'CZ') tags.push(song.tags.language);
    if (song._capo) tags.push(song._capo);
    if (song._new) tags.push('Nová');
    return tags;
  }

  function chordsEl(song, className) {
    const p = el('p', className || 'chords');
    p.appendChild(el('span', 'visually-hidden', 'Akordy: '));
    song._prog.forEach((group, i) => {
      if (i > 0) {
        const sep = el('span', 'chord-sep');
        sep.setAttribute('aria-hidden', 'true');
        p.appendChild(sep);
      }
      p.appendChild(document.createTextNode(group.join(' ')));
    });
    return p;
  }

  function favButton(song) {
    const b = el('button', 'fav');
    b.type = 'button';
    b.dataset.fav = song.slug;
    const on = SL.favourites.has(song.slug);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', (on ? 'Odebrat z oblíbených: ' : 'Přidat do oblíbených: ') + song.title);
    b.innerHTML = SL.icon('heart', 22);
    return b;
  }

  function row(song, opts) {
    const o = opts || {};
    const li = el('li', 'row');
    const body = el('div', 'row-body');
    const main = el('div', 'row-main');

    const a = el('a', 'row-title');
    a.href = SL.href(song);
    a.dataset.slug = song.slug;
    a.appendChild(highlighted(song.title, o.q));
    main.appendChild(a);
    tagsOf(song).forEach(t => main.appendChild(el('span', 'tag', t)));

    if (!o.hideArtist && song._authors.length) {
      const meta = el('div', 'row-meta');
      song._authors.forEach((name, i) => {
        if (i > 0) meta.appendChild(document.createTextNode(', '));
        const b = el('button', 'artist-btn', name);
        b.type = 'button';
        b.dataset.artist = name;
        b.setAttribute('aria-label', 'Písně od: ' + name);
        meta.appendChild(b);
      });
      main.appendChild(meta);
    }

    body.appendChild(main);
    body.appendChild(chordsEl(song));
    if (o.hit) body.appendChild(SL.snippet(o.hit, o.q.length));
    li.appendChild(body);
    li.appendChild(favButton(song));
    return li;
  }

  function songList(songs, opts) {
    const ul = el('ul', 'songs');
    songs.forEach(s => ul.appendChild(row(s, opts)));
    return ul;
  }

  function stateBox(title, text, action) {
    const box = el('div', 'state');
    if (title) box.appendChild(el('strong', null, title));
    box.appendChild(document.createTextNode(text));
    if (action) {
      const wrap = el('div');
      wrap.style.marginTop = '12px';
      wrap.appendChild(action);
      box.appendChild(wrap);
    }
    return box;
  }

  function skeleton(n) {
    const ul = el('ul', 'songs');
    for (let i = 0; i < n; i++) {
      const li = el('li', 'row skeleton');
      const body = el('div', 'row-body');
      body.append(el('span', 'bar'), el('span', 'bar'), el('span', 'bar'));
      li.appendChild(body);
      ul.appendChild(li);
    }
    return ul;
  }

  // ---- Písně ------------------------------------------------------------

  const qInput = $('q');
  const results = $('results');

  function renderSongs() {
    if (!ready) return;
    const res = SL.query(state);
    $('count').textContent = SL.countLine(res);
    results.innerHTML = '';

    if (res.named.length) results.appendChild(songList(res.named, { q: res.q }));

    if (res.lyric.length) {
      const head = el('div', 'group-head');
      head.appendChild(el('h2', null, 'Nalezeno v textu písně'));
      head.appendChild(el('span', null, String(res.lyric.length)));
      results.appendChild(head);
      const ul = el('ul', 'songs');
      res.lyric.forEach(({ song, hit }) => ul.appendChild(row(song, { q: res.q, hit })));
      results.appendChild(ul);
    }

    if (res.lyricsState === 'loading') {
      results.appendChild(el('p', 'state state-quiet', 'Hledám i v textech písní…'));
    } else if (res.lyricsState === 'failed') {
      results.appendChild(el('p', 'state state-quiet', 'Hledání v textech písní se nepodařilo načíst, hledá se jen v názvech a interpretech.'));
    }

    if (!res.total && res.lyricsState !== 'loading') {
      let action = null;
      if (SL.filtersActive(state)) {
        action = el('button', 'btn btn-quiet', 'Zrušit filtry');
        action.type = 'button';
        action.addEventListener('click', resetFilters);
      }
      results.appendChild(stateBox('Nic nenalezeno', 'Zkus jiný název, interpreta nebo úryvek textu.', action));
    }

    renderChips();
  }

  function renderChips() {
    const sort = SORTS.find(s => s.id === state.sort);
    const arrow = state.dir < 0 ? ' ↓' : '';
    $('chip-sort').querySelector('.chip-text').textContent = sort.label + arrow;

    const lang = $('chip-lang');
    lang.classList.toggle('on', !!state.lang);
    lang.querySelector('.chip-text').textContent = state.lang || 'Jazyk';

    const capo = $('chip-capo');
    capo.classList.toggle('on', !!state.capo);
    capo.querySelector('.chip-text').textContent =
      state.capo === 'yes' ? 'S capem' : state.capo === 'no' ? 'Bez capa' : 'Capo';

    const chords = $('chip-chords');
    chords.classList.toggle('on', state.chords.size > 0);
    chords.querySelector('.chip-text').textContent =
      state.chords.size ? `Akordy (${state.chords.size})` : 'Akordy, co umím';

    $('chip-reset').hidden = !SL.filtersActive(state);
  }

  function resetFilters() {
    state.lang = '';
    state.capo = '';
    state.chords.clear();
    renderSongs();
  }

  let searchTimer;
  qInput.value = state.q;
  $('q-clear').hidden = !state.q;
  qInput.addEventListener('input', () => {
    $('q-clear').hidden = !qInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = qInput.value;
      SL.syncQueryToUrl(state.q);
      renderSongs();
    }, 160);
  });
  qInput.addEventListener('focus', () => document.body.classList.add('typing'));
  qInput.addEventListener('blur', () => document.body.classList.remove('typing'));
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') qInput.blur();
  });
  $('q-clear').addEventListener('click', () => {
    qInput.value = '';
    state.q = '';
    $('q-clear').hidden = true;
    SL.syncQueryToUrl('');
    renderSongs();
    qInput.focus();
  });
  $('chip-reset').addEventListener('click', resetFilters);
  SL.onLyrics(() => renderSongs());

  // The band gets a rule once content scrolls under it.
  const bands = document.querySelectorAll('.search-band');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      bands.forEach(b => b.classList.toggle('stuck', b.getBoundingClientRect().top <= 0 && window.scrollY > 0));
      ticking = false;
    });
  }, { passive: true });

  // ---- sheets ------------------------------------------------------------

  const sheet = $('sheet');
  const sheetBody = $('sheet-body');
  const sheetFoot = $('sheet-foot');

  function option(label, checked, count, onPick) {
    const b = el('button', 'option');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', checked ? 'true' : 'false');
    b.appendChild(el('span', null, label));
    if (count != null) b.appendChild(el('span', 'option-count', String(count)));
    const tick = el('span');
    tick.innerHTML = SL.icon('check', 20);
    b.appendChild(tick);
    b.addEventListener('click', onPick);
    return b;
  }

  function openSheet(kind) {
    sheetBody.innerHTML = '';
    sheetFoot.innerHTML = '';
    const all = SL.songs;

    if (kind === 'sort') {
      $('sheet-title').textContent = 'Řadit podle';
      const group = el('div');
      group.setAttribute('role', 'radiogroup');
      SORTS.forEach(s => group.appendChild(option(s.label, s.id === state.sort, null, () => {
        if (state.sort !== s.id) { state.sort = s.id; state.dir = s.defaultDir || 1; }
        renderSongs();
        closeSheet();
      })));
      sheetBody.appendChild(group);

      const current = SORTS.find(s => s.id === state.sort);
      sheetBody.appendChild(el('p', 'sheet-label', 'Směr'));
      const seg = el('div', 'segmented');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', 'Směr řazení');
      current.dirs.forEach((label, i) => {
        const dir = i === 0 ? 1 : -1;
        const b = el('button', null, label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', state.dir === dir ? 'true' : 'false');
        b.addEventListener('click', () => { state.dir = dir; renderSongs(); openSheet('sort'); });
        seg.appendChild(b);
      });
      sheetBody.appendChild(seg);
    }

    if (kind === 'lang') {
      $('sheet-title').textContent = 'Jazyk';
      const group = el('div');
      group.setAttribute('role', 'radiogroup');
      LANGS.forEach(l => {
        const n = l.id ? all.filter(s => s.tags.language === l.id).length : all.length;
        group.appendChild(option(l.label, state.lang === l.id, n, () => {
          state.lang = l.id; renderSongs(); closeSheet();
        }));
      });
      sheetBody.appendChild(group);
    }

    if (kind === 'capo') {
      $('sheet-title').textContent = 'Capo';
      const withCapo = all.filter(s => s._capo).length;
      const counts = { '': all.length, yes: withCapo, no: all.length - withCapo };
      const group = el('div');
      group.setAttribute('role', 'radiogroup');
      CAPOS.forEach(c => group.appendChild(option(c.label, state.capo === c.id, counts[c.id], () => {
        state.capo = c.id; renderSongs(); closeSheet();
      })));
      sheetBody.appendChild(group);
    }

    if (kind === 'chords') {
      $('sheet-title').textContent = 'Akordy, které umím';
      const summary = el('p', 'chord-summary');
      const actions = el('div', 'chord-summary-actions');
      const allBtn = el('button', 'btn btn-quiet', 'Vybrat vše');
      const noneBtn = el('button', 'btn btn-quiet', 'Zrušit vše');
      allBtn.type = noneBtn.type = 'button';
      actions.append(allBtn, noneBtn);
      const grid = el('div', 'chord-grid');
      const done = el('button', 'btn btn-primary');
      done.type = 'button';

      const refresh = () => {
        const n = SL.query(state).total;
        summary.textContent = state.chords.size
          ? `Vybráno ${state.chords.size} z ${SL.chords.length} akordů. Ukážou se jen písně, které mají všechny akordy z výběru.`
          : `Vyber akordy, které umíš (je jich ${SL.chords.length}), a ukážou se jen písně, které si s nimi zahraješ.`;
        done.textContent = `Zobrazit ${n} ${SL.plural(n, 'píseň', 'písně', 'písní')}`;
        grid.querySelectorAll('.chord-toggle').forEach(t => {
          t.setAttribute('aria-pressed', state.chords.has(t.dataset.chord) ? 'true' : 'false');
        });
      };

      SL.chords.forEach(c => {
        const t = el('button', 'chord-toggle', c);
        t.type = 'button';
        t.dataset.chord = c;
        t.addEventListener('click', () => {
          if (state.chords.has(c)) state.chords.delete(c); else state.chords.add(c);
          refresh();
          renderSongs();
        });
        grid.appendChild(t);
      });
      allBtn.addEventListener('click', () => { SL.chords.forEach(c => state.chords.add(c)); refresh(); renderSongs(); });
      noneBtn.addEventListener('click', () => { state.chords.clear(); refresh(); renderSongs(); });
      done.addEventListener('click', closeSheet);

      sheetBody.append(summary, actions, grid);
      sheetFoot.appendChild(done);
      refresh();
    }

    if (!sheet.open) sheet.showModal();
  }

  function closeSheet() {
    if (sheet.open) sheet.close();
  }

  document.querySelectorAll('[data-sheet]').forEach(chip => {
    chip.addEventListener('click', () => openSheet(chip.dataset.sheet));
  });
  $('sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => {
    if (e.target !== sheet) return;
    const r = sheet.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeSheet();
  });

  // ---- Interpreti --------------------------------------------------------

  function renderArtists() {
    if (!ready) return;
    const list = $('artist-list');
    list.innerHTML = '';
    const q = SL.norm(artistQuery.trim());
    let artists = SL.artists.filter(a => !q || a.norm.includes(q));
    if (artistSort === 'count') {
      artists = artists.slice().sort((a, b) => (b.songs.length - a.songs.length) || SL.collator.compare(a.name, b.name));
    }
    $('artists-sub').textContent = `${SL.artists.length} interpretů ve zpěvníku`;

    let letter = null;
    artists.forEach(a => {
      if (artistSort === 'az' && !q && a.letter !== letter) {
        letter = a.letter;
        const h = el('li', 'letter-head', letter);
        h.setAttribute('aria-hidden', 'true');
        list.appendChild(h);
      }
      const li = el('li');
      const link = el('a', 'artist-link');
      link.href = '#interpret/' + encodeURIComponent(a.name);
      link.appendChild(el('span', 'artist-name', a.name));
      link.appendChild(el('span', 'artist-count', `${a.songs.length} ${SL.plural(a.songs.length, 'píseň', 'písně', 'písní')}`));
      li.appendChild(link);
      list.appendChild(li);
    });
    if (!artists.length) {
      const li = el('li');
      li.appendChild(stateBox('Nikdo takový', 'Zkus jinou část jména, třeba jen příjmení.'));
      list.appendChild(li);
    }
  }

  $('aq').addEventListener('input', (e) => { artistQuery = e.target.value; renderArtists(); });
  $('aq').addEventListener('focus', () => document.body.classList.add('typing'));
  $('aq').addEventListener('blur', () => document.body.classList.remove('typing'));
  document.querySelectorAll('[data-artist-sort]').forEach(b => {
    b.addEventListener('click', () => {
      artistSort = b.dataset.artistSort;
      document.querySelectorAll('[data-artist-sort]').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
      renderArtists();
    });
  });

  let currentArtist = '';

  function renderArtist(name) {
    if (!ready) return;
    currentArtist = name;
    const res = SL.query({ artist: name, sort: 'title', dir: 1 });
    $('h-artist').textContent = name;
    $('artist-sub').textContent = `${res.total} ${SL.plural(res.total, 'píseň', 'písně', 'písní')} ve zpěvníku`;
    const box = $('artist-songs');
    box.innerHTML = '';
    if (res.total) box.appendChild(songList(res.named, { hideArtist: res.named.every(s => s._authors.length === 1) }));
    else box.appendChild(stateBox('Nic tu není', 'Tenhle interpret ve zpěvníku nemá žádnou píseň.'));
    $('artist-random').hidden = res.total < 2;
  }

  $('artist-random').addEventListener('click', () => {
    const pool = SL.query({ artist: currentArtist }).named;
    openSong(SL.pickRandom(pool));
  });

  // ---- Objevit -----------------------------------------------------------

  function drawPool() {
    const res = SL.query(state);
    return res.named.concat(res.lyric.map(l => l.song));
  }

  function renderDraw(animate) {
    if (!ready) return;
    const pool = drawPool();
    let song = drawnSlug && SL.bySlug(drawnSlug);
    if (!song || pool.indexOf(song) === -1) {
      song = SL.pickRandom(pool);
      drawnSlug = song ? song.slug : '';
    }
    const card = document.querySelector('.draw');
    if (!song) {
      $('draw-title').textContent = 'Není z čeho losovat';
      $('draw-artist').textContent = 'Filtry v Písních teď nepouští žádnou píseň.';
      $('draw-chords').textContent = '';
      $('draw-tags').innerHTML = '';
      $('draw-play').hidden = true;
      $('draw-next').hidden = true;
      $('draw-note').textContent = '';
      return;
    }
    $('draw-play').hidden = false;
    $('draw-next').hidden = false;
    $('draw-title').textContent = song.title;
    $('draw-title').href = SL.href(song);
    $('draw-title').dataset.slug = song.slug;
    $('draw-play').href = SL.href(song);
    $('draw-play').dataset.slug = song.slug;
    $('draw-artist').textContent = song._authors.join(', ');
    const chords = chordsEl(song, 'chords draw-chords');
    $('draw-chords').replaceWith(chords);
    chords.id = 'draw-chords';
    const tags = $('draw-tags');
    tags.innerHTML = '';
    tagsOf(song).forEach(t => tags.appendChild(el('span', 'tag', t)));

    const filtered = SL.filtersActive(state) || state.q.trim();
    $('draw-note').textContent = filtered
      ? `Losuje se z ${pool.length} ${SL.plural(pool.length, 'písně', 'písní', 'písní')}, které teď ukazují Písně. Posledních 20 vylosovaných se neopakuje.`
      : `Losuje se z celého zpěvníku. Posledních 20 vylosovaných se neopakuje.`;

    if (animate) {
      card.classList.remove('swap');
      void card.offsetWidth;
      card.classList.add('swap');
    }
  }

  $('draw-next').addEventListener('click', () => {
    const pool = drawPool().filter(s => s.slug !== drawnSlug);
    const song = SL.pickRandom(pool.length ? pool : drawPool());
    drawnSlug = song ? song.slug : '';
    renderDraw(true);
  });

  function renderNew() {
    if (!ready) return;
    const newest = SL.query({ sort: 'added', dir: -1 }).named;
    const count = SL.songs.filter(s => s._new).length;
    const box = $('new-list');
    box.innerHTML = '';
    box.appendChild(songList(newest.slice(0, 8)));
    $('new-all').textContent = `Všech ${count} za půl roku`;
  }

  $('new-all').addEventListener('click', (e) => {
    e.preventDefault();
    state.sort = 'added';
    state.dir = -1;
    renderSongs();
    go('', false, true);
  });

  // ---- Moje --------------------------------------------------------------

  const WEEKDAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];

  // A night at the fire runs past midnight, so plays before 5 a.m. count
  // towards the evening before.
  function eveningKey(t) {
    const d = new Date(t - 5 * 3600 * 1000);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function eveningLabel(t) {
    const d = new Date(t - 5 * 3600 * 1000);
    const now = Date.now();
    if (eveningKey(t) === eveningKey(now)) return 'Dnes';
    if (eveningKey(t) === eveningKey(now - 86400000)) return 'Včera';
    const day = WEEKDAYS[d.getDay()];
    return `${day.charAt(0).toUpperCase() + day.slice(1)} ${d.getDate()}. ${d.getMonth() + 1}.`;
  }

  function renderMine() {
    if (!ready) return;
    const favs = SL.favourites.list().map(SL.bySlug).filter(Boolean);
    $('fav-count').textContent = favs.length ? String(favs.length) : '';
    const favBox = $('fav-list');
    favBox.innerHTML = '';
    if (favs.length) favBox.appendChild(songList(favs));
    else favBox.appendChild(stateBox(null, 'Klepni na srdíčko u písně a uložíš si ji sem. Hodí se na ty, co se hrajou pořád.'));

    const recentBox = $('recent-list');
    recentBox.innerHTML = '';
    const entries = SL.recent.list();
    $('recent-clear').hidden = !entries.length;
    if (!entries.length) {
      recentBox.appendChild(stateBox(null, 'Písně, které otevřeš, se tu seřadí po večerech. Druhý den tak najdeš, co se hrálo.'));
      return;
    }
    let key = null;
    let ul = null;
    let head = null;
    let n = 0;
    entries.forEach(e => {
      const k = eveningKey(e.t);
      if (k !== key) {
        if (head) head.querySelector('span').textContent = `${n} ${SL.plural(n, 'píseň', 'písně', 'písní')}`;
        key = k; n = 0;
        head = el('div', 'group-head');
        head.appendChild(el('h3', null, eveningLabel(e.t)));
        head.appendChild(el('span'));
        ul = el('ul', 'songs');
        recentBox.append(head, ul);
      }
      ul.appendChild(row(SL.bySlug(e.s)));
      n++;
    });
    if (head) head.querySelector('span').textContent = `${n} ${SL.plural(n, 'píseň', 'písně', 'písní')}`;
  }

  $('recent-clear').addEventListener('click', () => {
    try { localStorage.removeItem('bs_recent'); } catch (e) { /* nothing to clear */ }
    renderMine();
  });

  // ---- shared row actions ------------------------------------------------

  function openSong(song) {
    if (!song) return;
    SL.recent.add(song.slug);
    location.href = SL.href(song);
  }

  document.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const on = SL.favourites.toggle(fav.dataset.fav);
      document.querySelectorAll(`[data-fav="${CSS.escape(fav.dataset.fav)}"]`).forEach(b => {
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (currentView === 'moje') renderMine();
      return;
    }
    const artist = e.target.closest('[data-artist]');
    if (artist) {
      go('#interpret/' + encodeURIComponent(artist.dataset.artist), true);
      return;
    }
    const link = e.target.closest('a[data-slug]');
    if (link) SL.recent.add(link.dataset.slug);
  });

  // ---- views -------------------------------------------------------------

  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h.indexOf('interpret/') === 0) return { view: 'artist', artist: h.slice('interpret/'.length) };
    if (h === 'interpreti' || h === 'objevit' || h === 'moje') return { view: h };
    return { view: 'pisne' };
  }

  function go(hash, push, toTop) {
    scrollByView[currentView] = window.scrollY;
    const url = location.pathname + location.search + hash;
    if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
    route(toTop);
  }

  function route(toTop) {
    const r = parseHash();
    currentView = r.view;
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== r.view; });
    const tabName = r.view === 'artist' ? 'interpreti' : r.view;
    document.querySelectorAll('.tab').forEach(t => {
      if (t.dataset.tab === tabName) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });

    if (r.view === 'pisne') renderSongs();
    if (r.view === 'interpreti') renderArtists();
    if (r.view === 'artist') renderArtist(r.artist);
    if (r.view === 'objevit') { renderDraw(false); renderNew(); }
    if (r.view === 'moje') renderMine();

    const y = toTop || r.view === 'artist' ? 0 : (scrollByView[r.view] || 0);
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      const name = t.dataset.tab;
      // A second tap on the active tab goes back to its top, as in apps.
      if (name === currentView || (name === 'interpreti' && currentView === 'artist')) {
        if (currentView === 'artist') { go('#interpreti', false); return; }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      go(name === 'pisne' ? '' : '#' + name, false);
    });
  });
  window.addEventListener('popstate', () => route());
  window.addEventListener('hashchange', () => route());

  // Instrument menu closes on an outside tap.
  const instrument = document.querySelector('.instrument');
  document.addEventListener('click', (e) => {
    if (instrument.open && !instrument.contains(e.target)) instrument.open = false;
  });

  // ---- boot --------------------------------------------------------------

  $('brand-mark').innerHTML = SL.mark(26);
  hydrateIcons();
  results.appendChild(skeleton(7));
  route();

  SL.load()
    .then(() => {
      ready = true;
      route();
    })
    .catch(err => {
      console.error(err);
      $('count').textContent = '';
      results.innerHTML = '';
      const retry = el('button', 'btn btn-quiet', 'Obnovit stránku');
      retry.type = 'button';
      retry.addEventListener('click', () => location.reload());
      results.appendChild(stateBox('Seznam se nenačetl', 'Nepodařilo se načíst seznam písní, zkus obnovit stránku.', retry));
    });
})();
