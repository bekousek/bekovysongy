/**
 * Návrh 3 "Večer": the list page built around tonight. Search adds songs to
 * a setlist with one tap, the setlist goes to the party as a link
 * (?vecer=slug,slug,...), a few songs are dealt at random, and the whole
 * songbook sits underneath with its filters. Song logic is in
 * js/song-list-core.js.
 */
(function () {
  'use strict';

  const SL = window.SongList;
  const $ = (id) => document.getElementById(id);

  const RESULTS_CAP = 25;

  // The book's filters; the search at the top obeys them too.
  const book = {
    lang: '',
    capo: '',
    chords: new Set(),
    artist: '',
    sort: 'title',
    dir: 1,
  };
  let q = SL.queryFromUrl();
  let showAllResults = false;
  let dealt = [];
  let ready = false;
  let restoreY = 0;

  const SORTS = [
    { id: 'title', label: 'Název', dirs: ['A → Z', 'Z → A'] },
    { id: 'author', label: 'Interpret', dirs: ['A → Z', 'Z → A'] },
    { id: 'added', label: 'Přidáno', dirs: ['nejstarší první', 'nejnovější první'], defaultDir: -1 },
    { id: 'chords', label: 'Počet akordů', dirs: ['nejméně první', 'nejvíc první'] },
    { id: 'language', label: 'Jazyk', dirs: ['A → Z', 'Z → A'] },
  ];
  const LANG_NAMES = { CZ: 'Čeština', EN: 'Angličtina', SK: 'Slovenština', PL: 'Polština' };

  (function restore() {
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (!nav || nav.type !== 'back_forward') return;
    const saved = SL.loadState('test3');
    if (!saved) return;
    book.lang = saved.lang || '';
    book.capo = saved.capo || '';
    book.chords = new Set(saved.chords || []);
    book.artist = saved.artist || '';
    book.sort = saved.sort || 'title';
    book.dir = saved.dir || 1;
    dealt = saved.dealt || [];
    restoreY = saved.y || 0;
  })();

  window.addEventListener('pagehide', () => {
    SL.saveState('test3', {
      lang: book.lang, capo: book.capo, chords: Array.from(book.chords), artist: book.artist,
      sort: book.sort, dir: book.dir, dealt, y: window.scrollY,
    });
  });

  // ---- helpers -----------------------------------------------------------

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  const count = (n, one, few, many) => `${n} ${SL.plural(n, one, few, many)}`;

  function highlighted(text, query) {
    const frag = document.createDocumentFragment();
    const norm = SL.norm(text);
    const at = query ? norm.indexOf(query) : -1;
    if (at === -1 || norm.length !== text.length) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    frag.appendChild(document.createTextNode(text.slice(0, at)));
    frag.appendChild(el('mark', null, text.slice(at, at + query.length)));
    frag.appendChild(document.createTextNode(text.slice(at + query.length)));
    return frag;
  }

  function metaEl(song, hideArtist) {
    const p = el('p', 'card-meta');
    if (!hideArtist) {
      song._authors.forEach((name, i) => {
        if (i > 0) p.appendChild(document.createTextNode(', '));
        const b = el('button', 'artist', name);
        b.type = 'button';
        b.dataset.artist = name;
        b.setAttribute('aria-label', 'Zpěvník jen s písněmi od: ' + name);
        p.appendChild(b);
      });
      if (song._authors.length) p.appendChild(el('span', 'meta-sep', '·'));
    }
    const chords = el('span', 'chords');
    chords.appendChild(el('span', 'visually-hidden', 'Akordy: '));
    song._prog.forEach((group, i) => {
      if (i > 0) {
        const sep = el('span', 'sep', '|');
        sep.setAttribute('aria-hidden', 'true');
        chords.appendChild(sep);
      }
      chords.appendChild(document.createTextNode(group.join(' ')));
    });
    p.appendChild(chords);
    return p;
  }

  function titleLink(song, className, query, from) {
    const a = el('a', className);
    a.href = SL.href(song);
    a.dataset.slug = song.slug;
    if (from) a.dataset.from = from;
    a.appendChild(highlighted(song.title, query));
    return a;
  }

  function tagEls(song) {
    const tags = [];
    if (song.tags.language !== 'CZ') tags.push(el('span', 'tag', song.tags.language));
    if (song._capo) tags.push(el('span', 'tag', song._capo));
    if (song._new) tags.push(el('span', 'tag', 'Nová'));
    return tags;
  }

  function addButton(song) {
    const b = el('button', 'add');
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

  // A song card inside a panel.
  function card(song, opts) {
    const o = opts || {};
    const li = el('li', 'card');
    if (o.rank) li.appendChild(el('span', 'card-rank', String(o.rank)));
    const body = el('div', 'card-body');
    const head = el('div');
    head.appendChild(titleLink(song, 'card-title', o.q, o.from));
    tagEls(song).forEach(t => head.appendChild(t));
    body.appendChild(head);
    body.appendChild(metaEl(song));
    if (o.hit) body.appendChild(SL.snippet(o.hit, o.q.length));
    li.appendChild(body);
    if (o.controls) o.controls.forEach(c => li.appendChild(c));
    else li.appendChild(addButton(song));
    return li;
  }

  // A plain row in the whole book.
  function bookRow(song, hideArtist) {
    const li = el('li', 'row');
    const body = el('div', 'row-body');
    const head = el('div');
    head.appendChild(titleLink(song, 'row-title'));
    tagEls(song).forEach(t => head.appendChild(t));
    body.appendChild(head);
    body.appendChild(metaEl(song, hideArtist));
    li.appendChild(body);
    li.appendChild(addButton(song));
    return li;
  }

  function stateBox(title, text, button) {
    const box = el('div', 'state');
    box.appendChild(el('strong', null, title));
    box.appendChild(document.createTextNode(text));
    if (button) { box.appendChild(el('br')); box.appendChild(button); }
    return box;
  }

  // ---- greeting ----------------------------------------------------------

  const WEEKDAYS = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
  const MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

  function renderGreeting() {
    const now = new Date();
    const h = now.getHours();
    $('greeting').textContent = h >= 5 && h < 10 ? 'Dobré ráno.' : h >= 10 && h < 17 ? 'Dobrý den.' : 'Dobrý večer.';
    const date = `${WEEKDAYS[now.getDay()]} ${now.getDate()}. ${MONTHS_GEN[now.getMonth()]}.`;
    const n = SL.setlist.list().length;
    $('greet-line').textContent = n
      ? `${date} Na večer máš vybrané ${count(n, 'písničku', 'písničky', 'písniček')}.`
      : `${date} Co dneska zahrajeme? Ve zpěvníku je ${count(SL.songs.length || 0, 'píseň', 'písně', 'písní')}.`;
  }

  // ---- search ------------------------------------------------------------

  const qInput = $('q');

  function bookFilters() {
    return { lang: book.lang, capo: book.capo, chords: book.chords, artist: book.artist };
  }

  function describeFilters() {
    const parts = [];
    if (book.artist) parts.push(book.artist);
    if (book.lang) parts.push(LANG_NAMES[book.lang]);
    if (book.capo) parts.push(book.capo === 'yes' ? 's capem' : 'bez capa');
    if (book.chords.size) parts.push(`akordy, co umím (${book.chords.size})`);
    return parts.join(', ');
  }

  function renderResults() {
    const box = $('results');
    box.innerHTML = '';
    if (!ready || !q.trim()) return;

    const res = SL.query(Object.assign({ q, sort: 'title', dir: 1 }, bookFilters()));
    const head = el('p', 'results-head');
    head.appendChild(el('span', null, SL.countLine(res)));
    box.appendChild(head);

    if (SL.filtersActive(book)) {
      const note = el('p', 'filters-note', `Platí filtry zpěvníku: ${describeFilters()}. `);
      const clear = el('button', null, 'Zrušit');
      clear.type = 'button';
      clear.addEventListener('click', resetFilters);
      note.appendChild(clear);
      box.appendChild(note);
    }

    const query = res.q;
    const named = showAllResults ? res.named : res.named.slice(0, RESULTS_CAP);
    if (named.length) {
      const ul = el('ul', 'cards');
      named.forEach(s => ul.appendChild(card(s, { q: query })));
      box.appendChild(ul);
    }
    if (named.length < res.named.length) {
      const more = el('button', 'btn btn-ghost', `Ukázat všech ${res.named.length}`);
      more.type = 'button';
      more.style.marginTop = '10px';
      more.addEventListener('click', () => { showAllResults = true; renderResults(); });
      box.appendChild(more);
    }

    if (res.lyric.length) {
      box.appendChild(el('h3', null, `Nalezeno v textu písně (${res.lyric.length})`));
      const ul = el('ul', 'cards');
      res.lyric.forEach(({ song, hit }) => ul.appendChild(card(song, { q: query, hit })));
      box.appendChild(ul);
    }

    if (res.lyricsState === 'loading') box.appendChild(el('p', 'note', 'Hledám i v textech písní…'));
    if (res.lyricsState === 'failed') box.appendChild(el('p', 'note', 'Hledání v textech písní se nepodařilo načíst, hledá se jen v názvech a interpretech.'));

    if (!res.total && res.lyricsState !== 'loading') {
      box.appendChild(stateBox('Nic nenalezeno', 'Zkus jiný název, interpreta nebo úryvek textu.'));
    }
  }

  qInput.value = q;
  $('q-clear').hidden = !q;
  let timer;
  qInput.addEventListener('input', () => {
    $('q-clear').hidden = !qInput.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      q = qInput.value;
      showAllResults = false;
      SL.syncQueryToUrl(q);
      renderResults();
    }, 160);
  });
  qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') qInput.blur(); });
  $('q-clear').addEventListener('click', () => {
    qInput.value = '';
    q = '';
    $('q-clear').hidden = true;
    SL.syncQueryToUrl('');
    renderResults();
    qInput.focus();
  });
  SL.onLyrics(() => renderResults());

  // ---- tonight -----------------------------------------------------------

  let undoList = null;

  function renderTonight() {
    if (!ready) return;
    const list = SL.setlist.list();
    const ol = $('tonight-list');
    ol.innerHTML = '';
    list.forEach((slug, i) => {
      const song = SL.bySlug(slug);
      const up = el('button', 'card-btn');
      up.type = 'button';
      up.dataset.up = slug;
      up.disabled = i === 0;
      up.setAttribute('aria-label', 'Posunout výš: ' + song.title);
      up.innerHTML = SL.icon('up', 20);
      const remove = el('button', 'card-btn');
      remove.type = 'button';
      remove.dataset.remove = slug;
      remove.setAttribute('aria-label', 'Odebrat z večera: ' + song.title);
      remove.innerHTML = SL.icon('x', 20);
      ol.appendChild(card(song, { rank: i + 1, controls: [up, remove], from: 'tonight' }));
    });
    $('tonight-count').textContent = list.length ? String(list.length) : '';
    $('tonight-empty').hidden = list.length > 0;
    $('tonight-actions').hidden = list.length === 0;
    $('tonight-share').hidden = list.length === 0;
    if (list.length) $('tonight-play').href = SL.href(SL.bySlug(list[0]));
    $('tonight-play').dataset.slug = list[0] || '';
    $('tonight-shuffle').hidden = list.length < 3;
    renderGreeting();
  }

  function syncAddButtons(slug) {
    const on = SL.setlist.has(slug);
    const song = SL.bySlug(slug);
    document.querySelectorAll(`[data-add="${CSS.escape(slug)}"]`).forEach(b => paintAdd(b, on, song.title));
  }

  function setStatus(text, undo) {
    const s = $('tonight-status');
    s.textContent = text;
    if (undo) {
      const b = el('button', null, 'Vrátit');
      b.type = 'button';
      b.addEventListener('click', undo);
      s.appendChild(b);
    }
  }

  $('tonight-shuffle').addEventListener('click', () => {
    const list = SL.setlist.list();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = list[i]; list[i] = list[j]; list[j] = t;
    }
    SL.setlist.save(list);
    renderTonight();
  });

  $('tonight-clear').addEventListener('click', () => {
    undoList = SL.setlist.list();
    SL.setlist.save([]);
    renderTonight();
    undoList.forEach(syncAddButtons);
    setStatus('Večer je prázdný.', () => {
      SL.setlist.save(undoList);
      renderTonight();
      undoList.forEach(syncAddButtons);
      setStatus('');
    });
  });

  function shareUrl() {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('vecer', SL.setlist.list().join(','));
    return url.toString();
  }

  $('tonight-share').addEventListener('click', async () => {
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

  // ---- a setlist that came as a link -------------------------------------

  function renderShared() {
    const param = new URLSearchParams(location.search).get('vecer');
    const box = $('shared');
    if (!param) { box.hidden = true; return; }
    const slugs = param.split(',').map(s => s.trim()).filter(s => SL.bySlug(s));
    const mine = SL.setlist.list();
    if (!slugs.length || slugs.join(',') === mine.join(',')) {
      box.hidden = true;
      dropSharedParam();
      return;
    }
    box.hidden = false;
    $('shared-text').textContent = `${count(slugs.length, 'písnička', 'písničky', 'písniček')} na dnešek.` +
      (mine.length ? ` Převzetím nahradíš svůj večer (${mine.length}).` : '');
    const ol = $('shared-list');
    ol.innerHTML = '';
    slugs.forEach((slug, i) => ol.appendChild(card(SL.bySlug(slug), { rank: i + 1, controls: [] })));
    $('shared-take').onclick = () => {
      SL.setlist.save(slugs);
      box.hidden = true;
      dropSharedParam();
      renderTonight();
      document.querySelectorAll('[data-add]').forEach(b => syncAddButtons(b.dataset.add));
      $('tonight').scrollIntoView({ block: 'start' });
    };
    $('shared-dismiss').onclick = () => { box.hidden = true; dropSharedParam(); };
  }

  function dropSharedParam() {
    const url = new URL(location.href);
    url.searchParams.delete('vecer');
    history.replaceState(history.state, '', url);
  }

  // ---- dealt -------------------------------------------------------------

  function dealPool() {
    return SL.query(Object.assign({ sort: 'title', dir: 1 }, bookFilters())).named;
  }

  function renderDraw(fresh) {
    if (!ready) return;
    const pool = dealPool();
    const valid = dealt.map(SL.bySlug).filter(s => s && pool.indexOf(s) !== -1);
    let songs = valid.length === 3 && !fresh ? valid : null;
    if (!songs) {
      songs = SL.deal(pool, 3, SL.randomHistory().concat(fresh ? dealt : []));
      dealt = songs.map(s => s.slug);
    }
    const ul = $('draw-list');
    ul.innerHTML = '';
    songs.forEach(s => ul.appendChild(card(s, { from: 'draw' })));
    if (!songs.length) ul.appendChild(stateBox('Není z čeho losovat', 'Filtry zpěvníku teď nepouští žádnou píseň.'));
    $('draw-note').textContent = SL.filtersActive(book)
      ? `Losuje se z ${count(pool.length, 'písně', 'písní', 'písní')} podle filtrů zpěvníku.`
      : 'Losuje se z celého zpěvníku. Co se nedávno hrálo z losování, se hned nevrací.';
  }

  $('draw-again').addEventListener('click', () => renderDraw(true));

  // ---- fresh -------------------------------------------------------------

  function renderFresh() {
    const newest = SL.query({ sort: 'added', dir: -1 }).named.slice(0, 5);
    const ul = $('fresh-list');
    ul.innerHTML = '';
    newest.forEach(s => ul.appendChild(card(s)));
    $('fresh-all').textContent = `Všech ${SL.songs.filter(s => s._new).length} za půl roku`;
  }

  $('fresh-all').addEventListener('click', (e) => {
    e.preventDefault();
    book.sort = 'added';
    book.dir = -1;
    renderBook();
    $('zpevnik').scrollIntoView({ block: 'start' });
  });

  // ---- the book ----------------------------------------------------------

  function renderBook() {
    if (!ready) return;
    const res = SL.query(Object.assign({ sort: book.sort, dir: book.dir }, bookFilters()));
    $('book-count').textContent = SL.countLine(res);

    document.querySelectorAll('#book-modes [data-mode]').forEach(b => {
      b.setAttribute('aria-checked', b.dataset.mode === book.sort ? 'true' : 'false');
    });
    const nActive = [book.artist, book.lang, book.capo, book.chords.size].filter(Boolean).length;
    $('filter-btn').classList.toggle('on', nActive > 0);
    $('filter-label').textContent = nActive ? `Filtry (${nActive})` : 'Filtry';

    const groups = [];
    if (book.sort === 'author') {
      const shown = new Set(res.named);
      let artists = SL.artists.map(a => ({ a, songs: a.songs.filter(s => shown.has(s)) })).filter(x => x.songs.length);
      if (book.dir < 0) artists.reverse();
      artists.forEach(x => groups.push({ label: x.a.name, songs: x.songs, artist: true }));
    } else {
      const map = new Map();
      res.named.forEach(s => {
        let key, make;
        if (book.sort === 'title') { key = s._letter; make = () => ({ letter: s._letter, songs: [] }); }
        else if (book.sort === 'added') { key = s.added.slice(0, 7); make = () => ({ label: SL.formatMonth(s.added), songs: [] }); }
        else if (book.sort === 'chords') { key = s.chords.length; make = () => ({ label: count(s.chords.length, 'akord', 'akordy', 'akordů'), songs: [] }); }
        else { key = s.tags.language; make = () => ({ label: LANG_NAMES[key] || key, songs: [] }); }
        if (!map.has(key)) map.set(key, make());
        map.get(key).songs.push(s);
      });
      map.forEach(g => groups.push(g));
    }

    const box = $('book');
    box.innerHTML = '';
    const frag = document.createDocumentFragment();
    groups.forEach(g => {
      const head = el('h3', 'book-group-head');
      if (g.letter) head.appendChild(el('span', 'letter', g.letter));
      else head.appendChild(el('span', 'label', g.label));
      head.appendChild(el('span', 'n', String(g.songs.length)));
      frag.appendChild(head);
      const ul = el('ul', 'rows rows-grid');
      g.songs.forEach(s => ul.appendChild(bookRow(s, g.artist && s._authors.length === 1)));
      frag.appendChild(ul);
    });
    if (!groups.length) {
      const btn = el('button', 'btn btn-ghost', 'Zrušit filtry');
      btn.type = 'button';
      btn.addEventListener('click', resetFilters);
      frag.appendChild(stateBox('Nic nenalezeno', 'S těmihle filtry ve zpěvníku nic není.', btn));
    }
    box.appendChild(frag);
  }

  document.querySelectorAll('#book-modes [data-mode]').forEach(b => {
    b.addEventListener('click', () => {
      const s = SORTS.find(x => x.id === b.dataset.mode);
      book.sort = s.id;
      book.dir = s.defaultDir || 1;
      renderBook();
    });
  });

  function resetFilters() {
    book.lang = '';
    book.capo = '';
    book.artist = '';
    book.chords.clear();
    renderAllFiltered();
  }

  function renderAllFiltered() {
    renderBook();
    renderResults();
    renderDraw(false);
    if ($('sheet').open) fillSheet();
  }

  // ---- sheet -------------------------------------------------------------

  const sheet = $('sheet');

  function pill(label, small, checked, onPick, pressed) {
    const b = el('button');
    b.type = 'button';
    if (pressed) b.setAttribute('aria-pressed', checked ? 'true' : 'false');
    else { b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', checked ? 'true' : 'false'); }
    b.appendChild(document.createTextNode(label));
    if (small != null) b.appendChild(el('small', null, String(small)));
    b.addEventListener('click', onPick);
    return b;
  }

  function field(title, note) {
    const sec = el('section', 'field');
    sec.appendChild(el('h3', null, title));
    if (note) sec.appendChild(el('p', 'field-note', note));
    return sec;
  }

  function fillSheet() {
    const body = $('sheet-body');
    const scroll = body.scrollTop;
    body.innerHTML = '';
    const all = SL.songs;

    if (book.artist) {
      const f = field('Interpret');
      const p = el('div', 'pills');
      p.appendChild(pill(book.artist + '  ×', null, true, () => { book.artist = ''; renderAllFiltered(); }));
      f.appendChild(p);
      body.appendChild(f);
    }

    const fSort = field('Řadit podle');
    const sorts = el('div', 'pills');
    sorts.setAttribute('role', 'radiogroup');
    SORTS.forEach(s => sorts.appendChild(pill(s.label, null, book.sort === s.id, () => {
      if (book.sort !== s.id) { book.sort = s.id; book.dir = s.defaultDir || 1; }
      renderAllFiltered();
    })));
    fSort.appendChild(sorts);
    const cur = SORTS.find(s => s.id === book.sort);
    const dir = el('button', 'text-btn');
    dir.type = 'button';
    dir.innerHTML = SL.icon(book.dir < 0 ? 'down' : 'up', 18);
    dir.appendChild(document.createTextNode(book.dir < 0 ? cur.dirs[1] : cur.dirs[0]));
    dir.addEventListener('click', () => { book.dir = -book.dir; renderAllFiltered(); });
    fSort.appendChild(dir);
    body.appendChild(fSort);

    const fLang = field('Jazyk');
    const langs = el('div', 'pills');
    langs.setAttribute('role', 'radiogroup');
    [['', 'Vše'], ['CZ', 'CZ'], ['EN', 'EN'], ['SK', 'SK'], ['PL', 'PL']].forEach(([id, label]) => {
      const n = id ? all.filter(s => s.tags.language === id).length : all.length;
      langs.appendChild(pill(label, n, book.lang === id, () => { book.lang = id; renderAllFiltered(); }));
    });
    fLang.appendChild(langs);
    body.appendChild(fLang);

    const fCapo = field('Capo');
    const capos = el('div', 'pills');
    capos.setAttribute('role', 'radiogroup');
    const withCapo = all.filter(s => s._capo).length;
    [['', 'Vše', all.length], ['yes', 'S capem', withCapo], ['no', 'Bez capa', all.length - withCapo]].forEach(([id, label, n]) => {
      capos.appendChild(pill(label, n, book.capo === id, () => { book.capo = id; renderAllFiltered(); }));
    });
    fCapo.appendChild(capos);
    body.appendChild(fCapo);

    const fChords = field('Akordy, které umím', book.chords.size
      ? `Vybráno ${book.chords.size} z ${SL.chords.length}. Zůstanou jen písně, které mají všechny akordy z výběru.`
      : 'Vyber, co umíš, a zůstanou jen písně, které s tím zahraješ.');
    const actions = el('div', 'chord-actions');
    const allBtn = el('button', 'btn btn-ghost', 'Vybrat vše');
    const noneBtn = el('button', 'btn btn-ghost', 'Zrušit vše');
    allBtn.type = noneBtn.type = 'button';
    allBtn.addEventListener('click', () => { SL.chords.forEach(c => book.chords.add(c)); renderAllFiltered(); });
    noneBtn.addEventListener('click', () => { book.chords.clear(); renderAllFiltered(); });
    actions.append(allBtn, noneBtn);
    fChords.appendChild(actions);
    const grid = el('div', 'chord-grid');
    SL.chords.forEach(c => {
      const b = el('button', null, c);
      b.type = 'button';
      b.setAttribute('aria-pressed', book.chords.has(c) ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (book.chords.has(c)) book.chords.delete(c); else book.chords.add(c);
        renderAllFiltered();
      });
      grid.appendChild(b);
    });
    fChords.appendChild(grid);
    body.appendChild(fChords);

    const total = SL.query(Object.assign({}, bookFilters())).total;
    $('sheet-done').textContent = `Zobrazit ${count(total, 'píseň', 'písně', 'písní')}`;
    $('sheet-reset').disabled = !SL.filtersActive(book);
    body.scrollTop = scroll;
  }

  $('filter-btn').addEventListener('click', () => { fillSheet(); sheet.showModal(); });
  $('sheet-close').addEventListener('click', () => sheet.close());
  $('sheet-done').addEventListener('click', () => sheet.close());
  $('sheet-reset').addEventListener('click', resetFilters);
  sheet.addEventListener('click', (e) => {
    if (e.target !== sheet) return;
    const r = sheet.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) sheet.close();
  });

  // ---- delegated row actions ----------------------------------------------

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const slug = add.dataset.add;
      const on = SL.setlist.toggle(slug);
      syncAddButtons(slug);
      renderTonight();
      const song = SL.bySlug(slug);
      setStatus(on ? `${song.title} je ve večeru.` : `${song.title} z večera pryč.`);
      return;
    }
    const up = e.target.closest('[data-up]');
    if (up) {
      const list = SL.setlist.list();
      const i = list.indexOf(up.dataset.up);
      if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); SL.setlist.save(list); renderTonight(); }
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const slug = remove.dataset.remove;
      const before = SL.setlist.list();
      SL.setlist.toggle(slug);
      renderTonight();
      syncAddButtons(slug);
      setStatus(`${SL.bySlug(slug).title} z večera pryč.`, () => {
        SL.setlist.save(before);
        renderTonight();
        syncAddButtons(slug);
        setStatus('');
      });
      return;
    }
    const artist = e.target.closest('[data-artist]');
    if (artist) {
      book.artist = artist.dataset.artist;
      book.sort = 'title';
      book.dir = 1;
      renderAllFiltered();
      $('zpevnik').scrollIntoView({ block: 'start' });
      return;
    }
    const link = e.target.closest('a[data-slug]');
    if (link && link.dataset.slug) {
      SL.recent.add(link.dataset.slug);
      if (link.dataset.from === 'draw') SL.rememberRandom(link.dataset.slug);
    }
  });

  // ---- boot --------------------------------------------------------------

  $('brand-mark').innerHTML = SL.mark(26);
  document.querySelectorAll('[data-icon]').forEach(n => { n.innerHTML = SL.icon(n.dataset.icon); });
  renderGreeting();

  (function skeleton() {
    const ul = el('ul', 'rows');
    for (let i = 0; i < 6; i++) {
      const li = el('li', 'row skeleton');
      const body = el('div', 'row-body');
      body.append(el('span', 'bar'), el('span', 'bar'));
      li.appendChild(body);
      ul.appendChild(li);
    }
    $('book').appendChild(ul);
  })();

  SL.load()
    .then(() => {
      ready = true;
      renderGreeting();
      renderShared();
      renderTonight();
      renderResults();
      renderDraw(false);
      renderFresh();
      renderBook();
      if (restoreY) window.scrollTo({ top: restoreY, behavior: 'instant' });
    })
    .catch(err => {
      console.error(err);
      const retry = el('button', 'btn btn-ghost', 'Obnovit stránku');
      retry.type = 'button';
      retry.addEventListener('click', () => location.reload());
      $('book').innerHTML = '';
      $('book').appendChild(stateBox('Seznam se nenačetl', 'Nepodařilo se načíst seznam písní, zkus obnovit stránku.', retry));
    });
})();
