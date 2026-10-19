/**
 * Návrh 2 "Rejstřík": the whole songbook as one index - section letters,
 * an alphabet rail to scrub with the thumb, and the same index regrouped by
 * artist or by date added. Search narrows the index in place; sorting and
 * filters live in one sheet. Song logic is in js/song-list-core.js.
 */
(function () {
  'use strict';

  const SL = window.SongList;
  const $ = (id) => document.getElementById(id);

  const state = {
    q: SL.queryFromUrl(),
    lang: '',
    capo: '',
    chords: new Set(),
    artist: '',
    sort: 'title',
    dir: 1,
  };
  let ready = false;
  let restoreY = 0;

  const SORTS = [
    { id: 'title', label: 'Název', dirs: ['A → Z', 'Z → A'] },
    { id: 'author', label: 'Interpret', dirs: ['A → Z', 'Z → A'] },
    { id: 'added', label: 'Přidáno', dirs: ['nejstarší první', 'nejnovější první'], defaultDir: -1 },
    { id: 'chords', label: 'Počet akordů', dirs: ['nejméně akordů první', 'nejvíc akordů první'] },
    { id: 'language', label: 'Jazyk', dirs: ['A → Z', 'Z → A'] },
  ];
  const LANGS = [['', 'Vše'], ['CZ', 'CZ'], ['EN', 'EN'], ['SK', 'SK'], ['PL', 'PL']];
  const LANG_NAMES = { CZ: 'Čeština', EN: 'Angličtina', SK: 'Slovenština', PL: 'Polština' };
  const CAPOS = [['', 'Vše'], ['yes', 'S capem'], ['no', 'Bez capa']];

  (function restore() {
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (!nav || nav.type !== 'back_forward') return;
    const saved = SL.loadState('test2');
    if (!saved) return;
    state.lang = saved.lang || '';
    state.capo = saved.capo || '';
    state.chords = new Set(saved.chords || []);
    state.artist = saved.artist || '';
    state.sort = saved.sort || 'title';
    state.dir = saved.dir || 1;
    restoreY = saved.y || 0;
  })();

  window.addEventListener('pagehide', () => {
    SL.saveState('test2', {
      lang: state.lang, capo: state.capo, chords: Array.from(state.chords), artist: state.artist,
      sort: state.sort, dir: state.dir, y: window.scrollY,
    });
  });

  // ---- helpers -----------------------------------------------------------

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function n(count, one, few, many) {
    return `${count} ${SL.plural(count, one, few, many)}`;
  }

  function highlighted(text, q) {
    const frag = document.createDocumentFragment();
    const norm = SL.norm(text);
    const at = q ? norm.indexOf(q) : -1;
    if (at === -1 || norm.length !== text.length) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    frag.appendChild(document.createTextNode(text.slice(0, at)));
    frag.appendChild(el('mark', null, text.slice(at, at + q.length)));
    frag.appendChild(document.createTextNode(text.slice(at + q.length)));
    return frag;
  }

  function artistsEl(song) {
    const wrap = el('span', 'artists');
    song._authors.forEach((name, i) => {
      if (i > 0) wrap.appendChild(document.createTextNode(', '));
      const b = el('button', 'artist', name);
      b.type = 'button';
      b.dataset.artist = name;
      b.setAttribute('aria-label', 'Jen písně od: ' + name);
      wrap.appendChild(b);
    });
    return wrap;
  }

  function chordsEl(song) {
    const span = el('span', 'chords');
    span.appendChild(el('span', 'visually-hidden', 'Akordy: '));
    song._prog.forEach((group, i) => {
      if (i > 0) {
        const sep = el('span', 'sep', '|');
        sep.setAttribute('aria-hidden', 'true');
        span.appendChild(sep);
      }
      span.appendChild(document.createTextNode(group.join(' ')));
    });
    return span;
  }

  function row(song, opts) {
    const o = opts || {};
    const li = el('li', 'row');

    const lead = el('div', 'lead');
    const a = el('a', 'title');
    a.href = SL.href(song);
    a.dataset.slug = song.slug;
    a.appendChild(highlighted(song.title, o.q));
    lead.appendChild(a);

    const tags = el('span', 'tags');
    if (song.tags.language !== 'CZ') tags.appendChild(el('span', 'tag', song.tags.language));
    if (song._capo) tags.appendChild(el('span', 'tag', song._capo));
    if (song._new) tags.appendChild(el('span', 'tag tag-new', 'Nová'));
    if (tags.childNodes.length) lead.appendChild(tags);

    const showArtist = !o.hideArtist && song._authors.length;
    if (showArtist) {
      const leader = el('span', 'leader');
      leader.setAttribute('aria-hidden', 'true');
      lead.appendChild(leader);
      lead.appendChild(artistsEl(song));
    }
    li.appendChild(lead);

    const line2 = el('p', 'line2');
    if (showArtist) line2.appendChild(artistsEl(song));
    line2.appendChild(chordsEl(song));
    li.appendChild(line2);

    if (o.hit) li.appendChild(SL.snippet(o.hit, o.q.length));
    return li;
  }

  function stateBox(title, text, button) {
    const box = el('div', 'state');
    box.appendChild(el('strong', null, title));
    box.appendChild(document.createTextNode(text));
    if (button) {
      box.appendChild(el('br'));
      box.appendChild(button);
    }
    return box;
  }

  // ---- grouping ----------------------------------------------------------

  function groupsFor(res) {
    if (res.q) {
      const groups = [];
      if (res.named.length) groups.push({ id: 'g-named', label: 'V názvu nebo interpretovi', songs: res.named });
      if (res.lyric.length) groups.push({ id: 'g-lyric', label: 'Nalezeno v textu písně', items: res.lyric });
      return groups;
    }

    const songs = res.named;
    const map = new Map();
    const add = (key, make, song) => {
      if (!map.has(key)) map.set(key, make());
      map.get(key).songs.push(song);
    };

    if (state.sort === 'author') {
      const shown = new Set(songs);
      let artists = SL.artists
        .map(a => ({ a, songs: a.songs.filter(s => shown.has(s)) }))
        .filter(x => x.songs.length);
      if (state.dir < 0) artists = artists.reverse();
      return artists.map((x, i) => ({
        id: 'g-a' + i,
        label: x.a.name,
        letter: x.a.letter,
        artist: x.a.name,
        songs: x.songs,
      }));
    }

    songs.forEach(s => {
      if (state.sort === 'title') {
        add(s._letter, () => ({ id: 'g-' + encodeURIComponent(s._letter).replace(/%/g, '_'), letter: s._letter, big: true, songs: [] }), s);
      } else if (state.sort === 'added') {
        const key = s.added ? s.added.slice(0, 7) : '';
        add(key, () => ({ id: 'g-m' + key, label: s.added ? SL.formatMonth(s.added) : 'Bez data', songs: [] }), s);
      } else if (state.sort === 'chords') {
        const c = s.chords.length;
        add(c, () => ({ id: 'g-c' + c, label: n(c, 'akord', 'akordy', 'akordů'), songs: [] }), s);
      } else if (state.sort === 'language') {
        const l = s.tags.language;
        add(l, () => ({ id: 'g-l' + l, label: LANG_NAMES[l] || l, songs: [] }), s);
      }
    });
    return Array.from(map.values());
  }

  // ---- render ------------------------------------------------------------

  const index = $('index');
  const rail = $('rail');

  function render() {
    if (!ready) return;
    const res = SL.query(state);
    $('count').textContent = SL.countLine(res);
    renderModes();
    renderActive();

    const groups = groupsFor(res);
    const frag = document.createDocumentFragment();

    groups.forEach(g => {
      const sec = el('section', 'group');
      sec.id = g.id;
      if (g.letter) sec.dataset.letter = g.letter;
      const head = el('h2', 'group-head');
      if (g.big) {
        head.appendChild(el('span', 'letter', g.letter));
      } else {
        head.appendChild(el('span', 'label', g.label));
      }
      const count = g.songs ? g.songs.length : g.items.length;
      head.appendChild(el('span', 'n', String(count)));
      if (g.artist && !state.artist) {
        const only = el('button', 'artist-filter', 'Jen tyhle');
        only.type = 'button';
        only.dataset.artist = g.artist;
        only.setAttribute('aria-label', 'Jen písně od: ' + g.artist);
        head.appendChild(only);
      }
      sec.appendChild(head);

      const ul = el('ul', 'rows');
      if (g.items) g.items.forEach(({ song, hit }) => ul.appendChild(row(song, { q: res.q, hit })));
      else g.songs.forEach(s => ul.appendChild(row(s, { q: res.q, hideArtist: !!g.artist && s._authors.length === 1 })));
      sec.appendChild(ul);
      frag.appendChild(sec);
    });

    if (res.lyricsState === 'loading') frag.appendChild(el('p', 'note', 'Hledám i v textech písní…'));
    if (res.lyricsState === 'failed') frag.appendChild(el('p', 'note', 'Hledání v textech písní se nepodařilo načíst, hledá se jen v názvech a interpretech.'));

    if (!res.total && res.lyricsState !== 'loading') {
      let btn = null;
      if (SL.filtersActive(state)) {
        btn = el('button', 'btn btn-line', 'Zrušit filtry');
        btn.type = 'button';
        btn.addEventListener('click', resetFilters);
      }
      frag.appendChild(stateBox('Nic nenalezeno', 'Zkus jiný název, interpreta nebo úryvek textu.', btn));
    }

    index.innerHTML = '';
    index.appendChild(frag);
    renderRail(groups, res);
    placeRail();
    $('random').disabled = !res.total;
  }

  function renderModes() {
    document.querySelectorAll('#modes [data-mode]').forEach(b => {
      b.setAttribute('aria-checked', b.dataset.mode === state.sort ? 'true' : 'false');
    });
    $('modes').hidden = !!state.q.trim();
  }

  function renderActive() {
    const box = $('active');
    box.innerHTML = '';
    const chip = (label, clear) => {
      const b = el('button', 'active-chip');
      b.type = 'button';
      b.appendChild(el('span', null, label));
      const x = el('span');
      x.innerHTML = SL.icon('x', 18);
      b.appendChild(x);
      b.setAttribute('aria-label', 'Zrušit filtr: ' + label);
      b.addEventListener('click', () => { clear(); render(); });
      box.appendChild(b);
    };
    if (state.artist) chip('Interpret: ' + state.artist, () => { state.artist = ''; });
    if (state.lang) chip(LANG_NAMES[state.lang], () => { state.lang = ''; });
    if (state.capo) chip(state.capo === 'yes' ? 'S capem' : 'Bez capa', () => { state.capo = ''; });
    if (state.chords.size) chip(`Akordy, co umím (${state.chords.size})`, () => { state.chords.clear(); });

    const active = [state.artist, state.lang, state.capo, state.chords.size].filter(Boolean).length;
    $('filter-badge').hidden = !active;
    $('filter-badge').textContent = String(active);
    $('filter-btn').classList.toggle('on', active > 0);
  }

  function resetFilters() {
    state.lang = '';
    state.capo = '';
    state.artist = '';
    state.chords.clear();
    render();
    if ($('sheet').open) fillSheet();
  }

  // ---- alphabet rail -----------------------------------------------------

  let railItems = [];

  function renderRail(groups, res) {
    const alpha = !res.q && (state.sort === 'title' || state.sort === 'author') && groups.length > 8;
    rail.hidden = !alpha;
    index.classList.toggle('no-rail', !alpha);
    rail.innerHTML = '';
    railItems = [];
    if (!alpha) return;
    const seen = new Set();
    groups.forEach(g => {
      if (!g.letter || seen.has(g.letter)) return;
      seen.add(g.letter);
      const b = el('button', null, g.letter);
      b.type = 'button';
      b.dataset.target = g.id;
      b.setAttribute('aria-label', 'Skočit na ' + g.letter);
      rail.appendChild(b);
      railItems.push(b);
    });
  }

  // The rail starts under the search band wherever the band is, so at the
  // top of the page it never sits over the title or the Filtr button.
  function placeRail() {
    const bottom = $('band').getBoundingClientRect().bottom;
    rail.style.top = Math.max(bottom, 0) + 8 + 'px';
  }
  window.addEventListener('resize', () => placeRail());

  function jumpTo(id) {
    const target = document.getElementById(id);
    if (!target) return;
    const bandH = $('band').offsetHeight;
    const y = target.getBoundingClientRect().top + window.scrollY - bandH + 1;
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  const bubble = $('rail-bubble');
  let scrubbing = false;
  let lastLetter = null;

  function scrubAt(clientY) {
    if (!railItems.length) return;
    const r = rail.getBoundingClientRect();
    let i = Math.floor(((clientY - r.top) / r.height) * railItems.length);
    i = Math.max(0, Math.min(railItems.length - 1, i));
    const item = railItems[i];
    if (item.textContent === lastLetter) return;
    lastLetter = item.textContent;
    bubble.textContent = lastLetter;
    bubble.classList.add('show');
    jumpTo(item.dataset.target);
  }

  rail.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    lastLetter = null;
    rail.setPointerCapture(e.pointerId);
    rail.classList.add('scrubbing');
    scrubAt(e.clientY);
    e.preventDefault();
  });
  rail.addEventListener('pointermove', (e) => { if (scrubbing) scrubAt(e.clientY); });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    rail.classList.remove('scrubbing');
    setTimeout(() => bubble.classList.remove('show'), 250);
  };
  rail.addEventListener('pointerup', endScrub);
  rail.addEventListener('pointercancel', endScrub);
  // Keyboard and screen readers: each letter is a real button.
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && e.detail === 0) jumpTo(b.dataset.target);
  });

  // ---- search + band -----------------------------------------------------

  const qInput = $('q');
  qInput.value = state.q;
  $('q-clear').hidden = !state.q;
  let timer;
  qInput.addEventListener('input', () => {
    $('q-clear').hidden = !qInput.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = qInput.value;
      SL.syncQueryToUrl(state.q);
      render();
    }, 160);
  });
  qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') qInput.blur(); });
  $('q-clear').addEventListener('click', () => {
    qInput.value = '';
    state.q = '';
    $('q-clear').hidden = true;
    SL.syncQueryToUrl('');
    render();
    qInput.focus();
  });
  SL.onLyrics(() => render());

  function measureBand() {
    document.documentElement.style.setProperty('--band-h', $('band').offsetHeight + 'px');
  }
  window.addEventListener('resize', measureBand);

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const band = $('band');
      band.classList.toggle('stuck', band.getBoundingClientRect().top <= 0 && window.scrollY > 0);
      placeRail();
      ticking = false;
    });
  }, { passive: true });

  document.querySelectorAll('#modes [data-mode]').forEach(b => {
    b.addEventListener('click', () => {
      const s = SORTS.find(x => x.id === b.dataset.mode);
      state.sort = s.id;
      state.dir = s.defaultDir || 1;
      render();
    });
  });

  // ---- random, artists, recents -----------------------------------------

  $('random').addEventListener('click', () => {
    const res = SL.query(state);
    const song = SL.pickRandom(res.named.concat(res.lyric.map(l => l.song)));
    if (!song) return;
    SL.recent.add(song.slug);
    location.href = SL.href(song);
  });

  document.addEventListener('click', (e) => {
    const artist = e.target.closest('[data-artist]');
    if (artist) {
      state.artist = artist.dataset.artist;
      render();
      const top = $('band').getBoundingClientRect().top + window.scrollY;
      if (window.scrollY > top) window.scrollTo({ top, behavior: 'instant' });
      return;
    }
    const link = e.target.closest('a[data-slug]');
    if (link) SL.recent.add(link.dataset.slug);
  });

  // ---- sheet -------------------------------------------------------------

  const sheet = $('sheet');

  function radio(label, checked, onPick) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', checked ? 'true' : 'false');
    if (typeof label === 'string') b.textContent = label; else b.appendChild(label);
    b.addEventListener('click', onPick);
    return b;
  }

  function fillSheet() {
    const all = SL.songs;

    const pills = $('sort-pills');
    pills.innerHTML = '';
    SORTS.forEach(s => pills.appendChild(radio(s.label, state.sort === s.id, () => {
      if (state.sort !== s.id) { state.sort = s.id; state.dir = s.defaultDir || 1; }
      render(); fillSheet();
    })));
    const sort = SORTS.find(s => s.id === state.sort);
    const dir = $('dir-btn');
    dir.innerHTML = SL.icon(state.dir < 0 ? 'down' : 'up', 18);
    dir.appendChild(document.createTextNode(state.dir < 0 ? sort.dirs[1] : sort.dirs[0]));
    dir.setAttribute('aria-label', 'Směr řazení: ' + (state.dir < 0 ? sort.dirs[1] : sort.dirs[0]) + '. Klepnutím otočíš.');

    const langSeg = $('lang-seg');
    langSeg.innerHTML = '';
    LANGS.forEach(([id, label]) => {
      const c = id ? all.filter(s => s.tags.language === id).length : all.length;
      const content = document.createDocumentFragment();
      content.appendChild(document.createTextNode(label));
      content.appendChild(el('small', null, String(c)));
      langSeg.appendChild(radio(content, state.lang === id, () => { state.lang = id; render(); fillSheet(); }));
    });

    const capoSeg = $('capo-seg');
    capoSeg.innerHTML = '';
    const withCapo = all.filter(s => s._capo).length;
    const capoCount = { '': all.length, yes: withCapo, no: all.length - withCapo };
    CAPOS.forEach(([id, label]) => {
      const content = document.createDocumentFragment();
      content.appendChild(document.createTextNode(label));
      content.appendChild(el('small', null, String(capoCount[id])));
      capoSeg.appendChild(radio(content, state.capo === id, () => { state.capo = id; render(); fillSheet(); }));
    });

    $('chord-note').textContent = state.chords.size
      ? `Vybráno ${state.chords.size} z ${SL.chords.length}. Zůstanou jen písně, které mají všechny akordy z výběru.`
      : `Vyber, co umíš, a zůstanou jen písně, které s tím zahraješ.`;
    $('chord-grid').querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-pressed', state.chords.has(b.dataset.chord) ? 'true' : 'false');
    });

    const total = SL.query(state).total;
    $('sheet-done').textContent = `Zobrazit ${n(total, 'píseň', 'písně', 'písní')}`;
    $('sheet-reset').disabled = !SL.filtersActive(state);
  }

  function buildChordGrid() {
    const grid = $('chord-grid');
    SL.chords.forEach(c => {
      const b = el('button', null, c);
      b.type = 'button';
      b.dataset.chord = c;
      b.addEventListener('click', () => {
        if (state.chords.has(c)) state.chords.delete(c); else state.chords.add(c);
        render(); fillSheet();
      });
      grid.appendChild(b);
    });
  }

  $('filter-btn').addEventListener('click', () => { fillSheet(); sheet.showModal(); });
  $('sheet-close').addEventListener('click', () => sheet.close());
  $('sheet-done').addEventListener('click', () => sheet.close());
  $('sheet-reset').addEventListener('click', resetFilters);
  $('dir-btn').addEventListener('click', () => { state.dir = -state.dir; render(); fillSheet(); });
  $('chords-all').addEventListener('click', () => { SL.chords.forEach(c => state.chords.add(c)); render(); fillSheet(); });
  $('chords-none').addEventListener('click', () => { state.chords.clear(); render(); fillSheet(); });
  sheet.addEventListener('click', (e) => {
    if (e.target !== sheet) return;
    const r = sheet.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) sheet.close();
  });

  // ---- boot --------------------------------------------------------------

  $('brand-mark').innerHTML = SL.mark(26);
  document.querySelectorAll('[data-icon]').forEach(n => { n.innerHTML = SL.icon(n.dataset.icon); });
  measureBand();

  (function skeleton() {
    const ul = el('ul', 'rows');
    for (let i = 0; i < 8; i++) {
      const li = el('li', 'row skeleton');
      li.append(el('span', 'bar'), el('span', 'bar'));
      ul.appendChild(li);
    }
    index.appendChild(ul);
  })();

  SL.load()
    .then(() => {
      ready = true;
      const newCount = SL.songs.filter(s => s._new).length;
      const sub = $('sub');
      sub.textContent = `${n(SL.songs.length, 'píseň', 'písně', 'písní')} · `;
      const newBtn = el('button', 'link-btn', `${newCount} nových za půl roku`);
      newBtn.type = 'button';
      newBtn.addEventListener('click', () => { state.sort = 'added'; state.dir = -1; state.q = ''; qInput.value = ''; SL.syncQueryToUrl(''); render(); });
      sub.appendChild(newBtn);
      buildChordGrid();
      render();
      measureBand();
      if (restoreY) window.scrollTo({ top: restoreY, behavior: 'instant' });
    })
    .catch(err => {
      console.error(err);
      index.innerHTML = '';
      const retry = el('button', 'btn btn-line', 'Obnovit stránku');
      retry.type = 'button';
      retry.addEventListener('click', () => location.reload());
      index.appendChild(stateBox('Seznam se nenačetl', 'Nepodařilo se načíst seznam písní, zkus obnovit stránku.', retry));
    });
})();
