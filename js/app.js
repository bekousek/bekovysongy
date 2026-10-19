/**
 * app.js - the home page: the whole songbook as one app. Tabs Písně
 * (search and the full list), Interpreti, Objevit (a drawn song and what's
 * new), Večer (tonight's setlist, shared with the party through an invite
 * link ?parta=<id>, see js/vecer.js) and Moje (favourites, what was played,
 * offline). Song logic is js/song-list-core.js; songs open on their static
 * pages, ?vecer=1 / ?nahodne=1 telling js/player.js how to go on after.
 */
(function () {
  'use strict';

  const SL = window.SongList;
  const EV = window.Evening;
  const $ = (id) => document.getElementById(id);
  // The app scrolls inside #scroller, not the page: the browser's own
  // toolbars then never collapse and expand under the fixed tab bar.
  const scroller = $('scroller');

  const setlistHref = (slug) => SL.href({ slug }) + '?vecer=1';

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
    const saved = SL.loadState('list');
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
    scrollByView[currentView] = scroller.scrollTop;
    SL.saveState('list', {
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
    paintAdd(b, EV.has(song.slug), song.title);
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
    if (o.by) {
      const by = el('p', 'by');
      by.innerHTML = SL.icon('users', 15);
      by.appendChild(el('span', null, o.by));
      by.setAttribute('aria-label', 'Přidal(a): ' + o.by);
      body.appendChild(by);
    }
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

  let toastTimer;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
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
  scroller.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      bands.forEach(b => b.classList.toggle('stuck', b.getBoundingClientRect().top <= 0 && scroller.scrollTop > 0));
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
    $('draw-title').href = SL.href(song) + '?nahodne=1';
    $('draw-title').dataset.slug = song.slug;
    $('draw-play').href = SL.href(song) + '?nahodne=1';
    $('draw-play').dataset.slug = song.slug;
    $('draw-add').dataset.add = song.slug;
    paintAdd($('draw-add'), EV.has(song.slug), song.title);
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

  let mergeOffer = [];   // own songs left over when joining someone's evening
  let editingName = false;

  function renderBadge() {
    const n = EV.list().length;
    const badge = $('vecer-badge');
    badge.hidden = !n;
    badge.textContent = String(n);
    const tab = document.querySelector('.tab[data-tab="vecer"]');
    tab.setAttribute('aria-label', n ? `Večer, ${count(n, 'píseň', 'písně', 'písní')}` : 'Večer');
    const pill = $('party-pill');
    pill.hidden = !EV.shared;
    pill.dataset.state = EV.status;
  }

  const STATUS_TEXT = {
    live: 'Naživo, změny vidí všichni hned',
    connecting: 'Připojuji se…',
    offline: 'Bez signálu, ukazuju poslední stav',
    error: 'Večer nefunguje',
  };

  const ROLE_TEXT = {
    owner: 'Večer je tvůj: můžeš všechno, i smazat celou frontu.',
    parta: 'Jsi tu jako parta: přidáváš, odebíráš cokoli a můžeš míchat pořadí.',
    host: 'Jsi tu jako host: přidáváš písně a odebíráš jen ty svoje.',
  };

  function peopleLine() {
    const people = EV.members();
    if (!people.length) return '';
    const named = people.filter(p => p.name).map(p => (p.me ? p.name + ' (ty)' : p.name));
    const unnamed = people.length - named.length;
    const n = people.length;
    let line = 'Ve večeru ' + (n === 1 ? 'je 1 člověk' : n <= 4 ? `jsou ${n} lidé` : `je ${n} lidí`);
    if (named.length) line += ': ' + named.join(', ') + (unnamed ? ` a ${unnamed} beze jména` : '');
    return line + '.';
  }

  function renderVecer() {
    if (!ready) return;
    const shared = EV.shared;
    const items = EV.items();
    const n = items.length;
    const missing = shared && EV.missing;

    $('h-vecer').textContent = shared ? 'Společný večer' : 'Dnešní večer';
    $('vecer-sub').textContent = shared
      ? (n ? `${count(n, 'píseň', 'písně', 'písní')} ve frontě.` : 'Fronta je zatím prázdná.')
      : (n ? `${count(n, 'píseň', 'písně', 'písní')}. Při hraní tě provedou jedna po druhé.` : 'Seznam písní na dnešek.');

    $('party').hidden = !shared || missing;
    if (shared) {
      const st = EV.status;
      $('party-status').dataset.state = st;
      let text = st === 'error' && EV.problem ? EV.problem : (STATUS_TEXT[st] || '');
      if (EV.pendingCount && st !== 'live' && st !== 'error') text += ` · ${count(EV.pendingCount, 'změna čeká', 'změny čekají', 'změn čeká')} na signál`;
      $('party-status-text').textContent = text;
      $('party-people').textContent = peopleLine();
      $('party-role').textContent = ROLE_TEXT[EV.role] || '';
      // Asked once; after that it folds to one line with a way to change it.
      const name = $('party-name');
      const known = EV.name() && !editingName;
      $('name-line').hidden = !known;
      $('name-field').hidden = known;
      $('name-show').textContent = EV.name();
      if (document.activeElement !== name) name.value = EV.name();
    }
    $('vecer-missing').hidden = !missing;

    $('merge').hidden = !(shared && !missing && mergeOffer.length);
    if (!$('merge').hidden) {
      const one = mergeOffer.length === 1;
      $('merge-text').textContent = `Na vlastním seznamu máš ${count(mergeOffer.length, 'píseň', 'písně', 'písní')}. Přidat ${one ? 'ji' : 'je'} do společného večera?`;
    }

    const canMove = EV.can('move');
    const ol = $('vecer-list');
    ol.innerHTML = '';
    if (!missing) {
      items.forEach((it, i) => {
        const song = SL.bySlug(it.s);
        const controls = [];
        if (canMove) {
          const up = el('button', 'row-btn');
          up.type = 'button';
          up.dataset.up = it.s;
          up.disabled = i === 0;
          up.setAttribute('aria-label', 'Posunout výš: ' + song.title);
          up.innerHTML = SL.icon('up', 20);
          controls.push(up);
        }
        if (EV.can('remove', it)) {
          const remove = el('button', 'row-btn');
          remove.type = 'button';
          remove.dataset.remove = it.s;
          remove.setAttribute('aria-label', 'Odebrat z večera: ' + song.title);
          remove.innerHTML = SL.icon('x', 20);
          controls.push(remove);
        }
        ol.appendChild(row(song, { rank: i + 1, controls, href: setlistHref, by: shared ? (it.mine ? (it.by || 'ty') : it.by) : '' }));
      });
    }

    $('vecer-empty').hidden = missing || n > 0;
    $('vecer-empty-title').textContent = shared ? 'Fronta je prázdná' : 'Večer je zatím prázdný';
    $('vecer-empty-text').textContent = shared
      ? ' Plusem u kterékoli písně ji sem přidáš a hned ji uvidí všichni ve večeru.'
      : ' Plusem u písně ji sem přidáš. Při hraní tě písně provedou jedna po druhé.';
    const confirming = !$('confirm').hidden;
    $('vecer-actions').hidden = missing || n === 0 || confirming;
    $('vecer-shuffle').hidden = n < 3 || !EV.can('shuffle');
    $('vecer-clear').hidden = !EV.can('clear');
    $('vecer-clear').textContent = shared ? 'Smazat frontu' : 'Vyčistit';
    if (n) {
      $('vecer-play').href = setlistHref(items[0].s);
      $('vecer-play').dataset.slug = items[0].s;
    }

    $('invite').hidden = shared;
    $('rejoin').hidden = !EV.lastId;
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
    const on = EV.has(slug);
    const song = SL.bySlug(slug);
    if (!song) return;
    document.querySelectorAll(`[data-add="${CSS.escape(slug)}"]`).forEach(b => paintAdd(b, on, song.title));
  }

  function syncAllAddButtons() {
    const seen = new Set();
    document.querySelectorAll('[data-add]').forEach(b => {
      if (seen.has(b.dataset.add)) return;
      seen.add(b.dataset.add);
      syncAddButtons(b.dataset.add);
    });
  }

  // Everything that shows the evening follows it: a friend's song lands on
  // every list's plus button and on the badge, not only in the Večer tab.
  EV.onChange(() => {
    if (!ready) return;
    renderBadge();
    syncAllAddButtons();
    if (currentView === 'vecer') renderVecer();
    const refused = EV.takeRefusal();
    if (refused) toast(refused);
  });

  // A second, explicit tap for what changes the evening for everybody.
  function askConfirm(text, yes, onYes) {
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yes;
    $('confirm').hidden = false;
    $('vecer-actions').hidden = true;
    $('confirm-yes').onclick = () => { $('confirm').hidden = true; onYes(); renderVecer(); };
    $('confirm-yes').focus();
  }
  $('confirm-no').addEventListener('click', () => { $('confirm').hidden = true; renderVecer(); });

  $('vecer-shuffle').addEventListener('click', () => {
    askConfirm(EV.shared
      ? 'Chystáš se zamíchat pořadí celé fronty. Změní se všem ve večeru.'
      : 'Chystáš se zamíchat pořadí celého večera.', 'Ano, zamíchat', () => EV.shuffle());
  });
  $('vecer-clear').addEventListener('click', () => {
    const before = EV.list();
    const done = () => {
      EV.clear();
      setStatus(EV.shared ? 'Fronta je smazaná pro všechny. ' : 'Večer je prázdný. ', () => { EV.restore(before); setStatus(''); });
    };
    if (EV.shared) askConfirm('Chystáš se smazat celou frontu. Zmizí všem ve večeru.', 'Ano, smazat', done);
    else done();
  });

  // ---- invite: QR code to show, link to send ------------------------------

  const QR_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  const QR_SRI = 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1';
  const INVITE_KIND_KEY = 'bs_invite_kind';
  let qrLoading = null;

  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrLoading) {
      qrLoading = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = QR_SRC;
        sc.integrity = QR_SRI;
        sc.crossOrigin = 'anonymous';
        sc.referrerPolicy = 'no-referrer';
        sc.onload = () => resolve(window.qrcode);
        sc.onerror = () => { qrLoading = null; reject(new Error('qr')); };
        document.head.appendChild(sc);
      });
    }
    return qrLoading;
  }

  // Square modules on white with a quiet zone: what every phone camera reads.
  function qrSvg(text) {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const q = 4;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
    }
    const size = n + q * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR kód s pozvánkou do večera"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  function inviteKind() {
    if (!EV.can('invite-parta')) return 'host';
    let k = 'host';
    try { k = localStorage.getItem(INVITE_KIND_KEY) || 'host'; } catch (e) { /* default */ }
    return k === 'parta' ? 'parta' : 'host';
  }

  const KIND_TEXT = {
    parta: 'Pro kamarády. Kdo kód načte, přidává písně, odebírá cokoli a může zamíchat pořadí.',
    host: 'Pro třídu nebo lidi, které neznáš. Přidávají písně a odebírají jen ty svoje.',
  };

  function fillInvite(kind) {
    const body = sheetBody;
    body.innerHTML = '';
    sheetFoot.innerHTML = '';
    const url = EV.inviteUrl(kind);

    if (EV.can('invite-parta')) {
      const seg = el('div', 'segmented invite-kind');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', 'Co smí pozvaní');
      [['parta', 'Parta'], ['host', 'Třída, cizí lidé']].forEach(([id, label]) => {
        const b = el('button', null, label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', id === kind ? 'true' : 'false');
        b.addEventListener('click', () => {
          try { localStorage.setItem(INVITE_KIND_KEY, id); } catch (e) { /* not kept */ }
          fillInvite(id);
        });
        seg.appendChild(b);
      });
      body.appendChild(seg);
    }
    body.appendChild(el('p', 'invite-kind-text', KIND_TEXT[kind]));

    const qrBox = el('div', 'qr');
    qrBox.appendChild(el('span', 'qr-wait', 'Připravuju QR kód…'));
    body.appendChild(qrBox);
    loadQr()
      .then(() => { qrBox.innerHTML = qrSvg(url); })
      .catch(() => { qrBox.innerHTML = ''; qrBox.appendChild(el('span', 'qr-wait', 'QR kód se bez signálu nepodařilo vytvořit. Pošli odkaz.')); });

    body.appendChild(el('p', 'qr-hint', 'Ať si ho ostatní načtou fotoaparátem v telefonu.'));
    const link = el('input', 'invite-link');
    link.type = 'text';
    link.readOnly = true;
    link.value = url;
    link.setAttribute('aria-label', 'Odkaz na pozvánku');
    link.addEventListener('focus', () => link.select());
    body.appendChild(link);

    const copy = el('button', 'btn btn-quiet');
    copy.type = 'button';
    copy.innerHTML = SL.icon('copy', 18);
    copy.appendChild(el('span', null, 'Kopírovat'));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.lastChild.textContent = 'Zkopírováno';
      } catch (e) {
        link.focus();
        link.select();
      }
    });
    sheetFoot.appendChild(copy);
    if (navigator.share) {
      const share = el('button', 'btn btn-primary');
      share.type = 'button';
      share.innerHTML = SL.icon('share', 18);
      share.appendChild(el('span', null, 'Poslat odkaz'));
      share.addEventListener('click', () => {
        navigator.share({ title: 'Společný večer', text: 'Přidej písně do našeho večera na Bekových songách', url }).catch(() => {});
      });
      sheetFoot.appendChild(share);
    }
  }

  function openInvite() {
    sheetBody.innerHTML = '';
    sheetFoot.innerHTML = '';
    sheet.dataset.kind = 'invite';
    $('sheet-title').textContent = 'Pozvat do večera';
    fillInvite(inviteKind());
    if (!sheet.open) sheet.showModal();
  }

  $('invite-btn').addEventListener('click', () => {
    EV.create();
    renderVecer();
    openInvite();
  });
  $('party-invite').addEventListener('click', openInvite);
  $('rejoin').addEventListener('click', () => { EV.rejoin(); setStatus(''); renderVecer(); });
  $('missing-leave').addEventListener('click', () => { EV.leave(); renderVecer(); });
  $('party-leave').addEventListener('click', () => {
    EV.leave();
    mergeOffer = [];
    renderVecer();
    setStatus('Večer opuštěný, tohle je zase tvůj vlastní seznam. ', () => { EV.rejoin(); setStatus(''); renderVecer(); });
  });
  $('party-name').addEventListener('change', (e) => {
    EV.setName(e.target.value);
    editingName = false;
    renderVecer();
  });
  $('party-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('name-edit').addEventListener('click', () => {
    editingName = true;
    renderVecer();
    $('party-name').focus();
  });
  $('merge-yes').addEventListener('click', () => {
    mergeOffer.forEach(slug => EV.add(slug));
    SL.setlist.save([]);
    mergeOffer = [];
    renderVecer();
  });
  $('merge-no').addEventListener('click', () => { mergeOffer = []; renderVecer(); });

  // ?parta=<id>[&k=<key>]: an invite. Joining keeps your own list aside and
  // offers to bring its songs along.
  function handleInvite() {
    const params = new URLSearchParams(location.search);
    const id = params.get('parta');
    if (!id) return false;
    const url = new URL(location.href);
    url.searchParams.delete('parta');
    url.searchParams.delete('k');
    url.hash = '#vecer';
    history.replaceState(null, '', url);
    const own = EV.shared ? [] : SL.setlist.list();
    if (EV.join(id, params.get('k'))) mergeOffer = own;
    else setStatus('Odkaz na večer je neúplný.');
    return true;
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
      if (!EV.has(slug)) EV.add(slug);
      else if (!EV.remove(slug)) toast('Tuhle přidal někdo jiný. Odebrat ji může zakladatel večera nebo parta.');
      return;
    }
    const up = e.target.closest('[data-up]');
    if (up) {
      EV.moveUp(up.dataset.up);
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const slug = remove.dataset.remove;
      const before = EV.list();
      EV.remove(slug);
      setStatus(`${SL.bySlug(slug).title} z večera pryč. `, () => {
        if (EV.shared) EV.add(slug); else EV.restore(before);
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
    scrollByView[currentView] = scroller.scrollTop;
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
    scroller.scrollTo({ top: y, behavior: 'instant' });
  }

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      const name = t.dataset.tab;
      // A second tap on the active tab goes back to its top, as in apps.
      if (name === currentView || (name === 'interpreti' && currentView === 'artist')) {
        if (currentView === 'artist') { go('#interpreti', false); return; }
        scroller.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      go(name === 'pisne' ? '' : '#' + name, false);
    });
  });
  window.addEventListener('popstate', () => route());
  window.addEventListener('hashchange', () => route());


  // Coming back from a song page restored from the back-forward cache: the
  // setlist or favourites may have changed there.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted || !ready) return;
    renderBadge();
    syncAllAddButtons();
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
      handleInvite();
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
