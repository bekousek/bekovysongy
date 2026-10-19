/**
 * Prototyp: Bekovy songy as one app at the site root. The song list from
 * návrh 1 (tabs Písně / Interpreti / Objevit / Moje) plus the setlist from
 * návrh 3 as its own tab, Večer: songs go in with one tap and the whole
 * evening travels to the party as a link (?vecer=slug,slug,...). Songs open
 * in the prototype song page (pisen.html), which walks through tonight's
 * setlist one song after another. All song logic is js/song-list-core.js.
 */
(function () {
  'use strict';

  const SL = window.SongList;
  const $ = (id) => document.getElementById(id);

  SL.setSongHref((slug) => 'pisen.html?s=' + encodeURIComponent(slug));
  const setlistHref = (slug) => 'pisen.html?s=' + encodeURIComponent(slug) + '&vecer=1';

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
  let openFamily = '';
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
    const saved = SL.loadState('test4');
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
    SL.saveState('test4', {
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

  const count = (n, one, few, many) => `${n} ${SL.plural(n, one, few, many)}`;

  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(n => {
      if (!n.firstChild) n.innerHTML = SL.icon(n.dataset.icon);
    });
  }

  // The query picked out inside a title (the normalized title has the same
  // length as the original for Czech, so the index carries over).
  function highlighted(text, q) {
    const frag = document.createDocumentFragment();
    const n = q ? SL.norm(text) : '';
    const at = q ? n.indexOf(q) : -1;
    if (at === -1 || n.length !== text.length) { frag.appendChild(document.createTextNode(text)); return frag; }
    frag.appendChild(document.createTextNode(text.slice(0, at)));
    frag.appendChild(el('mark', 'title-mark', text.slice(at, at + q.length)));
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
    const b = el('button', 'row-btn fav');
    b.type = 'button';
    b.dataset.fav = song.slug;
    paintFav(b, SL.favourites.has(song.slug), song.title);
    return b;
  }

  function paintFav(b, on, title) {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', (on ? 'Odebrat z oblíbených: ' : 'Přidat do oblíbených: ') + title);
    b.innerHTML = SL.icon('heart', 22);
  }

  function addButton(song) {
    const b = el('button', 'row-btn add');
    b.type = 'button';
    b.dataset.add = song.slug;
    paintAdd(b, SL.setlist.has(song.slug), song.title);
    return b;
  }

  function paintAdd(b, on, title) {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', (on ? 'Odebrat z dnešního večera: ' : 'Přidat do dnešního večera: ') + title);
    b.innerHTML = SL.icon(on ? 'check' : 'plus', 22);
  }

  function row(song, opts) {
    const o = opts || {};
    const li = el('li', 'row' + (o.rank ? ' row-ranked' : ''));
    if (o.rank) li.appendChild(el('span', 'rank', String(o.rank)));
    const body = el('div', 'row-body');
    const main = el('div', 'row-main');

    const a = el('a', 'row-title');
    a.href = o.href ? o.href(song.slug) : SL.href(song);
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

    const actions = el('div', 'row-actions');
    if (o.controls) o.controls.forEach(c => actions.appendChild(c));
    else {
      actions.appendChild(favButton(song));
      actions.appendChild(addButton(song));
    }
    li.appendChild(actions);
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
      const wrap = el('div', 'state-action');
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
      state.chords.size ? `Akordy, co umím (${state.chords.size})` : 'Akordy, co umím';

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

  function option(label, checked, n, onPick) {
    const b = el('button', 'option');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', checked ? 'true' : 'false');
    b.appendChild(el('span', null, label));
    if (n != null) b.appendChild(el('span', 'option-count', String(n)));
    const tick = el('span');
    tick.innerHTML = SL.icon('check', 20);
    b.appendChild(tick);
    b.addEventListener('click', onPick);
    return b;
  }

  function openSheet(kind) {
    sheetBody.innerHTML = '';
    sheetFoot.innerHTML = '';
    sheet.dataset.kind = kind;
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
      fillChordSheet();
    }

    if (!sheet.open) sheet.showModal();
  }

  // ---- chord picker: roots first, the rest of each family on demand ------

  function fillChordSheet() {
    const body = sheetBody;
    const scroll = body.scrollTop;
    body.innerHTML = '';
    sheetFoot.innerHTML = '';

    const families = SL.chordFamilies(SL.chords);
    const res = SL.query(state);

    // What's picked so far, as chips that take themselves off on a tap -
    // the families are folded away, so this is where the choice stays visible.
    const picked = el('div', 'picked');
    if (state.chords.size) {
      Array.from(state.chords).sort(SL.compareChords).forEach(c => {
        const b = el('button', 'picked-chip');
        b.type = 'button';
        b.appendChild(el('span', null, c));
        const x = el('span');
        x.innerHTML = SL.icon('x', 16);
        b.appendChild(x);
        b.setAttribute('aria-label', 'Odebrat akord ' + c);
        b.addEventListener('click', () => { state.chords.delete(c); renderSongs(); fillChordSheet(); });
        picked.appendChild(b);
      });
    } else {
      picked.appendChild(el('p', 'picked-empty', 'Klepni na tón a vyber akordy, které umíš. Zůstanou jen písně, které s nimi zahraješ celé.'));
    }
    body.appendChild(picked);

    const roots = el('div', 'roots');
    roots.setAttribute('role', 'tablist');
    roots.setAttribute('aria-label', 'Základní tón');
    families.forEach(f => {
      const sel = f.all.filter(c => state.chords.has(c)).length;
      const b = el('button', 'root' + (sel ? ' has' : '') + (openFamily === f.root ? ' open' : ''));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', openFamily === f.root ? 'true' : 'false');
      b.setAttribute('aria-controls', 'family-panel');
      b.appendChild(el('span', 'root-letter', f.root === '?' ? 'Jiné' : f.root));
      b.appendChild(el('span', 'root-count', sel ? `${sel} z ${f.all.length}` : String(f.all.length)));
      b.addEventListener('click', () => {
        openFamily = openFamily === f.root ? '' : f.root;
        fillChordSheet();
      });
      roots.appendChild(b);
    });
    body.appendChild(roots);

    const fam = families.find(f => f.root === openFamily);
    if (fam) {
      const panel = el('div', 'family');
      panel.id = 'family-panel';
      panel.setAttribute('role', 'tabpanel');
      const head = el('div', 'family-head');
      head.appendChild(el('h3', null, fam.root === '?' ? 'Jiné akordy' : `Akordy na ${fam.root}`));
      const allOn = fam.all.every(c => state.chords.has(c));
      const toggleAll = el('button', 'text-btn', allOn ? 'Zrušit všechny' : 'Vybrat všechny');
      toggleAll.type = 'button';
      toggleAll.addEventListener('click', () => {
        fam.all.forEach(c => (allOn ? state.chords.delete(c) : state.chords.add(c)));
        renderSongs(); fillChordSheet();
      });
      head.appendChild(toggleAll);
      panel.appendChild(head);

      [['Základní', fam.basic], ['S křížkem a béčkem', fam.accidental], ['Další', fam.other]].forEach(([label, list]) => {
        if (!list.length) return;
        panel.appendChild(el('p', 'family-label', label));
        const grid = el('div', 'chord-grid' + (label === 'Základní' ? ' chord-grid-basic' : ''));
        list.forEach(c => {
          const t = el('button', 'chord-toggle', c);
          t.type = 'button';
          t.setAttribute('aria-pressed', state.chords.has(c) ? 'true' : 'false');
          t.addEventListener('click', () => {
            if (state.chords.has(c)) state.chords.delete(c); else state.chords.add(c);
            renderSongs(); fillChordSheet();
          });
          grid.appendChild(t);
        });
        panel.appendChild(grid);
      });
      body.appendChild(panel);
    }

    const clear = el('button', 'btn btn-quiet', 'Zrušit vše');
    clear.type = 'button';
    clear.disabled = !state.chords.size;
    clear.addEventListener('click', () => { state.chords.clear(); renderSongs(); fillChordSheet(); });
    const done = el('button', 'btn btn-primary', `Zobrazit ${count(res.total, 'píseň', 'písně', 'písní')}`);
    done.type = 'button';
    done.addEventListener('click', closeSheet);
    sheetFoot.append(clear, done);
    body.scrollTop = scroll;
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
      link.appendChild(el('span', 'artist-count', count(a.songs.length, 'píseň', 'písně', 'písní')));
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
    $('artist-sub').textContent = `${count(res.total, 'píseň', 'písně', 'písní')} ve zpěvníku`;
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
    const has = !!song;
    $('draw-play').hidden = !has;
    $('draw-next').hidden = !has;
    $('draw-add').hidden = !has;
    if (!has) {
      $('draw-title').textContent = 'Není z čeho losovat';
      $('draw-artist').textContent = 'Filtry v Písních teď nepouští žádnou píseň.';
      $('draw-chords').textContent = '';
      $('draw-tags').innerHTML = '';
      $('draw-note').textContent = '';
      return;
    }
    $('draw-title').textContent = song.title;
    $('draw-title').href = SL.href(song);
    $('draw-title').dataset.slug = song.slug;
    $('draw-play').href = SL.href(song);
    $('draw-play').dataset.slug = song.slug;
    $('draw-add').dataset.add = song.slug;
    paintAdd($('draw-add'), SL.setlist.has(song.slug), song.title);
    $('draw-artist').textContent = song._authors.join(', ');
    const chords = chordsEl(song, 'chords draw-chords');
    $('draw-chords').replaceWith(chords);
    chords.id = 'draw-chords';
    const tags = $('draw-tags');
    tags.innerHTML = '';
    tagsOf(song).forEach(t => tags.appendChild(el('span', 'tag', t)));

    const filtered = SL.filtersActive(state) || state.q.trim();
    $('draw-note').textContent = filtered
      ? `Losuje se z ${count(pool.length, 'písně', 'písní', 'písní')}, které teď ukazují Písně. Posledních 20 vylosovaných se neopakuje.`
      : 'Losuje se z celého zpěvníku. Posledních 20 vylosovaných se neopakuje.';

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
    const box = $('new-list');
    box.innerHTML = '';
    box.appendChild(songList(newest.slice(0, 8)));
    $('new-all').textContent = `Všech ${SL.songs.filter(s => s._new).length} za půl roku`;
  }

  $('new-all').addEventListener('click', (e) => {
    e.preventDefault();
    state.sort = 'added';
    state.dir = -1;
    renderSongs();
    go('', false, true);
  });

  // ---- Večer -------------------------------------------------------------

  let undoList = null;

  function renderBadge() {
    const n = SL.setlist.list().length;
    const badge = $('vecer-badge');
    badge.hidden = !n;
    badge.textContent = String(n);
    const tab = document.querySelector('.tab[data-tab="vecer"]');
    tab.setAttribute('aria-label', n ? `Večer, ${count(n, 'píseň', 'písně', 'písní')}` : 'Večer');
  }

  function renderVecer() {
    if (!ready) return;
    const list = SL.setlist.list();
    const ol = $('vecer-list');
    ol.innerHTML = '';
    list.forEach((slug, i) => {
      const song = SL.bySlug(slug);
      const up = el('button', 'row-btn');
      up.type = 'button';
      up.dataset.up = slug;
      up.disabled = i === 0;
      up.setAttribute('aria-label', 'Posunout výš: ' + song.title);
      up.innerHTML = SL.icon('up', 20);
      const remove = el('button', 'row-btn');
      remove.type = 'button';
      remove.dataset.remove = slug;
      remove.setAttribute('aria-label', 'Odebrat z večera: ' + song.title);
      remove.innerHTML = SL.icon('x', 20);
      ol.appendChild(row(song, { rank: i + 1, controls: [up, remove], href: setlistHref }));
    });
    const n = list.length;
    $('vecer-sub').textContent = n
      ? `${count(n, 'píseň', 'písně', 'písní')}. Při hraní tě provedou jedna po druhé.`
      : 'Seznam písní na dnešek, který pošleš partě jedním odkazem.';
    $('vecer-empty').hidden = n > 0;
    $('vecer-actions').hidden = n === 0;
    $('vecer-share').hidden = n === 0;
    $('vecer-shuffle').hidden = n < 3;
    if (n) {
      $('vecer-play').href = setlistHref(list[0]);
      $('vecer-play').dataset.slug = list[0];
    }
    renderShared();
    renderBadge();
  }

  function setStatus(text, undo) {
    const s = $('vecer-status');
    s.textContent = text;
    if (undo) {
      const b = el('button', 'text-btn', 'Vrátit');
      b.type = 'button';
      b.addEventListener('click', undo);
      s.appendChild(b);
    }
  }

  function syncAddButtons(slug) {
    const on = SL.setlist.has(slug);
    const song = SL.bySlug(slug);
    document.querySelectorAll(`[data-add="${CSS.escape(slug)}"]`).forEach(b => paintAdd(b, on, song.title));
  }

  $('vecer-shuffle').addEventListener('click', () => {
    const list = SL.setlist.list();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = list[i]; list[i] = list[j]; list[j] = t;
    }
    SL.setlist.save(list);
    renderVecer();
  });

  $('vecer-clear').addEventListener('click', () => {
    undoList = SL.setlist.list();
    SL.setlist.save([]);
    renderVecer();
    undoList.forEach(syncAddButtons);
    setStatus('Večer je prázdný. ', () => {
      SL.setlist.save(undoList);
      renderVecer();
      undoList.forEach(syncAddButtons);
      setStatus('');
    });
  });

  function shareUrl() {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('vecer', SL.setlist.list().join(','));
    return url.toString();
  }

  $('vecer-share').addEventListener('click', async () => {
    const url = shareUrl();
    const n = SL.setlist.list().length;
    const text = `Dnešní večer: ${count(n, 'písnička', 'písničky', 'písniček')} z Bekových songů`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Dnešní večer', text, url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Odkaz je zkopírovaný. Pošli ho partě, každý uvidí stejný seznam.');
    } catch (e) {
      setStatus('Odkaz: ' + url);
    }
  });

  // A setlist that came as a link: shown above your own, taken over on a tap.
  let sharedSlugs = null;

  function readShared() {
    const param = new URLSearchParams(location.search).get('vecer');
    if (!param) return;
    const slugs = param.split(',').map(s => s.trim()).filter(s => SL.bySlug(s));
    dropSharedParam();
    if (!slugs.length || slugs.join(',') === SL.setlist.list().join(',')) return;
    sharedSlugs = slugs;
  }

  function renderShared() {
    const box = $('shared');
    if (!sharedSlugs) { box.hidden = true; return; }
    box.hidden = false;
    const mine = SL.setlist.list();
    $('shared-text').textContent = `${count(sharedSlugs.length, 'písnička', 'písničky', 'písniček')} na dnešek.` +
      (mine.length ? ` Převzetím nahradíš svůj večer (${mine.length}).` : '');
    const ol = $('shared-list');
    ol.innerHTML = '';
    sharedSlugs.forEach((slug, i) => ol.appendChild(row(SL.bySlug(slug), { rank: i + 1, controls: [] })));
  }

  $('shared-take').addEventListener('click', () => {
    const slugs = sharedSlugs;
    sharedSlugs = null;
    SL.setlist.save(slugs);
    renderVecer();
    document.querySelectorAll('[data-add]').forEach(b => syncAddButtons(b.dataset.add));
    setStatus('Večer převzatý. Klepni na Začít hrát.');
  });
  $('shared-dismiss').addEventListener('click', () => { sharedSlugs = null; renderShared(); });

  function dropSharedParam() {
    const url = new URL(location.href);
    url.searchParams.delete('vecer');
    history.replaceState(history.state, '', url);
  }

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
    const closeGroup = () => { if (head) head.querySelector('span').textContent = count(n, 'píseň', 'písně', 'písní'); };
    entries.forEach(e => {
      const k = eveningKey(e.t);
      if (k !== key) {
        closeGroup();
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
    closeGroup();
  }

  $('recent-clear').addEventListener('click', () => {
    try { localStorage.removeItem('bs_recent'); } catch (e) { /* nothing to clear */ }
    renderMine();
  });

  // ---- shared row actions ------------------------------------------------

  function openSong(song) {
    if (!song) return;
    location.href = SL.href(song);
  }

  document.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const slug = fav.dataset.fav;
      const on = SL.favourites.toggle(slug);
      const song = SL.bySlug(slug);
      document.querySelectorAll(`[data-fav="${CSS.escape(slug)}"]`).forEach(b => paintFav(b, on, song.title));
      if (currentView === 'moje') renderMine();
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const slug = add.dataset.add;
      SL.setlist.toggle(slug);
      syncAddButtons(slug);
      renderBadge();
      if (currentView === 'vecer') renderVecer();
      return;
    }
    const up = e.target.closest('[data-up]');
    if (up) {
      const list = SL.setlist.list();
      const i = list.indexOf(up.dataset.up);
      if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); SL.setlist.save(list); renderVecer(); }
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const slug = remove.dataset.remove;
      const before = SL.setlist.list();
      SL.setlist.toggle(slug);
      renderVecer();
      syncAddButtons(slug);
      setStatus(`${SL.bySlug(slug).title} z večera pryč. `, () => {
        SL.setlist.save(before);
        renderVecer();
        syncAddButtons(slug);
        setStatus('');
      });
      return;
    }
    const artist = e.target.closest('[data-artist]');
    if (artist) {
      go('#interpret/' + encodeURIComponent(artist.dataset.artist), true);
    }
  });

  // ---- views -------------------------------------------------------------

  const VIEWS = ['interpreti', 'objevit', 'vecer', 'moje'];

  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h.indexOf('interpret/') === 0) return { view: 'artist', artist: h.slice('interpret/'.length) };
    if (VIEWS.indexOf(h) !== -1) return { view: h };
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
    if (r.view === 'vecer') { setStatus(''); renderVecer(); }
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

  // Coming back from a song page restored from the back-forward cache: the
  // setlist or favourites may have changed there.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted || !ready) return;
    renderBadge();
    document.querySelectorAll('[data-add]').forEach(b => syncAddButtons(b.dataset.add));
    if (currentView === 'vecer') renderVecer();
    if (currentView === 'moje') renderMine();
  });

  // ---- boot --------------------------------------------------------------

  $('brand-mark').innerHTML = SL.mark(26);
  hydrateIcons();
  results.appendChild(skeleton(7));
  route();

  SL.load()
    .then(() => {
      ready = true;
      readShared();
      if (sharedSlugs) history.replaceState(null, '', location.pathname + location.search + '#vecer');
      renderBadge();
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
