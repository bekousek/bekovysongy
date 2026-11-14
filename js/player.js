/**
 * player.js - every song page (songs/<slug>.html), built for a phone lying
 * on a knee: the song's chords pinned at the top, the two controls used
 * mid-song (key, autoscroll) at the bottom, everything else in one sheet.
 *
 * The ~600 song pages are static HTML from js/song-template.js and are never
 * edited for looks: this script takes the page as it is (h1, .song-author,
 * .song-capo, pre.song-text) and builds the new chrome around it. It reuses
 * the site's song logic - js/sections.js for refrén/bridge, folded repeats
 * and the one-block-per-line layout, js/chord-theory.js for transposition,
 * js/chords.js for fingering diagrams - and loads js/song-list-core.js,
 * js/vecer.js and js/tuner.js itself, so the pages don't have to list them.
 *
 * Also:
 *   - fingerings of all the song's chords one tap away under the chord bar,
 *   - the screen stays on while the song is open,
 *   - ?vecer=1 walks through tonight's setlist (shared or not), ?nahodne=1
 *     (opened from Objevit) offers the next random song,
 *   - a tap on the text stops autoscroll (and, once it has run, starts it
 *     again); Space and page-turner pedals (PageDown / arrows) work on a
 *     keyboard, and at the end of the song the pedal turns to the next one,
 *   - each song remembers its own key and scrolling speed,
 *   - a light theme for the sun and the projector, and a print layout.
 *
 * The arithmetic that went wrong before (the scroll step after a pause, the
 * pedal's page, the transposition range, the settings) is pure and exported
 * to Node for test/player.test.js; the rest needs a page.
 */
(function () {
  'use strict';

  // ---- pure helpers: no DOM, tested in test/player.test.js ---------------

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // Remembered numbers: localStorage key, default and range.
  const SETTINGS = {
    fontScale: { key: 'song_font_scale', def: 100, min: 70, max: 250 },
    columns: { key: 'song_columns', def: 1, min: 1, max: 3 },
    speed: { key: 'bs_scroll_speed', def: 3, min: 1, max: 10 },
    bpm: { key: 'bs_bpm', def: 120, min: 40, max: 240 },
  };

  // Remembered switches: localStorage key, the values stored for on and off,
  // and what an unset key means.
  const SWITCHES = {
    showRepeats: { key: 'show_repeats', on: 'on', off: 'off', def: false },
    keepAwake: { key: 'bs_keep_awake', on: '1', off: '0', def: true },
    diagrams: { key: 'bs_show_diagrams', on: '1', off: '0', def: false },
    light: { key: 'bs_theme', on: 'light', off: 'dark', def: false },
  };

  function settingFrom(name, raw) {
    const s = SETTINGS[name];
    return clamp(Math.round(parseInt(raw, 10) || s.def), s.min, s.max);
  }

  function switchFrom(name, raw) {
    const s = SWITCHES[name];
    return raw == null ? s.def : raw === s.on;
  }

  // Transposition moves −5 … +6 semitones: the short way round.
  function nextTranspose(t, delta) {
    const n = (((t + delta) % 12) + 12) % 12;
    return n > 6 ? n - 12 : n;
  }

  // One autoscroll frame. Speed 1 is 4 px/s, speed 10 is 40 px/s; what
  // doesn't make a whole pixel yet is carried to the next frame. rAF stops
  // while the page is hidden, and the first frame back must not carry the
  // whole absence: 30 s away once moved the song 360 px in one frame.
  const MAX_FRAME_MS = 100;

  function scrollStep(state, t, speed) {
    const dt = state.lastT ? clamp(t - state.lastT, 0, MAX_FRAME_MS) : 0;
    const carry = state.carry + dt / 1000 * speed * 4;
    const px = Math.floor(carry);
    return { lastT: t, carry: carry - px, px };
  }

  // One screenful of lyrics between the bars, less one line kept to find
  // your place again. (A page of 0.75 × the window skipped a line on a phone
  // on its side, where the bars cover a third of it.)
  function pageStep(top, bottom, line) {
    return Math.max(line, bottom - top - line);
  }

  // Each song's own key and scrolling speed: { slug: { t, s } }. A song
  // back at the defaults leaves the map.
  const PREFS_KEY = 'bs_song_prefs';

  function withSongPrefs(all, slug, prefs) {
    const out = Object.assign({}, all);
    const entry = {};
    if (prefs.t) entry.t = prefs.t;
    if (prefs.s) entry.s = prefs.s;
    if (Object.keys(entry).length) out[slug] = entry;
    else delete out[slug];
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { clamp, SETTINGS, SWITCHES, settingFrom, switchFrom, nextTranspose, scrollStep, MAX_FRAME_MS, pageStep, PREFS_KEY, withSongPrefs };
    return;
  }

  // ---- the page ----------------------------------------------------------

  // Every song page is exactly one directory deep, so the site root is "../"
  // relative to the page and to this file alike.
  const ROOT = new URL('../', document.currentScript.src).href;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register(ROOT + 'sw.js'));
  }

  const main = document.querySelector('main.song-page');
  const pre = main && main.querySelector('pre.song-text');
  if (!pre) return;

  function stored(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* not remembered */ }
  }

  // The theme goes on before anything else is drawn, so a light page doesn't
  // flash dark first.
  function applyTheme(light) {
    if (light) document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = light ? '#faf8f5' : '#0e0d0c';
  }
  applyTheme(switchFrom('light', stored(SWITCHES.light.key)));

  const rawBody = pre.innerHTML;   // before sections.js rewrites it

  // Downloaded together, run in the order given.
  function loadScripts(list) {
    return Promise.all(list.map(src => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ROOT + src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error(src));
      document.head.appendChild(s);
    })));
  }

  // Without its scripts the page would be bare text with no way back; the
  // old nav is hidden by css/style.css, so a link of our own goes up instead.
  function showFallback() {
    if (document.getElementById('player-failed')) return;
    const p = document.createElement('p');
    p.className = 'player-failed';
    p.id = 'player-failed';
    p.innerHTML = `<a href="${ROOT}">Zpět na seznam písní</a> · Ovládání se nenačetlo, zkus stránku obnovit.`;
    document.body.insertBefore(p, document.body.firstChild);
  }

  loadScripts(['js/song-list-core.js', 'js/vecer.js'])
    .then(init)
    .catch(err => {
      console.error('Song page scripts failed to load:', err);
      showFallback();
    });

  // ---- the new chrome ----------------------------------------------------

  const CBAR = `
    <div class="cbar-row">
      <a class="cbar-btn" id="back" href="${ROOT}" aria-label="Zpět na seznam"><span data-icon="back"></span></a>
      <div class="cbar-chips" id="chips" aria-label="Akordy písně"></div>
      <button type="button" class="cbar-btn" id="diagrams-toggle" aria-pressed="false" aria-controls="diagrams" aria-label="Prstoklady všech akordů"><span data-icon="fretboard"></span></button>
      <a class="cbar-btn cbar-next" id="next-top" href="#" hidden aria-label="Další píseň večera"><span data-icon="next"></span></a>
    </div>
    <div class="diagrams" id="diagrams" hidden></div>`;

  const ACTIONS = `
    <button type="button" class="pill" id="preview" hidden><span data-icon="play"></span><span>Ukázka</span></button>
    <button type="button" class="pill" id="fav" aria-pressed="false"><span data-icon="heart"></span><span>Oblíbit</span></button>
    <button type="button" class="pill" id="add" aria-pressed="false"><span data-icon="plus"></span><span>Do večera</span></button>
    <button type="button" class="pill" id="follow" aria-pressed="false" hidden><span data-icon="sync"></span><span>Sledovat zakladatele</span></button>`;

  const AFTER = `
    <a class="next-card" id="next-card" href="#" hidden>
      <span class="next-label" id="next-label"></span>
      <span class="next-title" id="next-title"></span>
      <span class="next-artist" id="next-artist"></span>
    </a>
    <button type="button" class="text-link" id="next-again" hidden><span data-icon="shuffle"></span><span>Vylosovat jinou</span></button>
    <a class="text-link" id="prev-link" href="#" hidden></a>
    <button type="button" class="text-link" id="report"><span data-icon="flag"></span><span>Nahlásit chybu v písni</span></button>`;

  const TOOLS = `
  <div class="toolbar" id="toolbar" role="toolbar" aria-label="Nástroje">
    <div class="tgroup" role="group" aria-label="Transpozice">
      <div class="tbuttons">
        <button type="button" class="tbtn" id="tr-down" aria-label="O půltón níž"><span data-icon="minus"></span></button>
        <button type="button" class="tval" id="tr-val">0</button>
        <button type="button" class="tbtn" id="tr-up" aria-label="O půltón výš"><span data-icon="plus"></span></button>
      </div>
      <span class="tlabel">Tónina</span>
    </div>
    <div class="tgroup" role="group" aria-label="Automatické rolování">
      <div class="tbuttons">
        <button type="button" class="tbtn" id="sp-down" aria-label="Pomaleji"><span data-icon="minus"></span></button>
        <button type="button" class="tplay" id="scroll" aria-pressed="false" aria-label="Spustit rolování"><span data-icon="play"></span></button>
        <button type="button" class="tbtn" id="sp-up" aria-label="Rychleji"><span data-icon="plus"></span></button>
      </div>
      <span class="tlabel" id="sp-label">Rolování 3</span>
    </div>
    <button type="button" class="tmore" id="more-btn" aria-haspopup="dialog" aria-label="Další nastavení a nástroje"><span data-icon="more"></span><span class="tlabel">Další</span></button>
  </div>

  <button type="button" class="metro-pill" id="metro-pill" hidden aria-label="Zastavit metronom">
    <span class="metro-dot" id="metro-dot"></span><span id="metro-pill-bpm">120</span><span class="metro-unit">BPM</span><span data-icon="pause"></span>
  </button>
  <p class="toast" id="toast" role="status" aria-live="polite"></p>
  <div class="diagram-pop" id="pop" hidden></div>

  <dialog class="sheet" id="more" aria-labelledby="more-title">
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="sheet-head">
      <h2 id="more-title" tabindex="-1" autofocus>Nastavení a nástroje</h2>
      <button type="button" class="icon-btn" data-close aria-label="Zavřít"><span data-icon="x"></span></button>
    </div>
    <div class="sheet-body">
      <section class="set">
        <div class="set-row">
          <span class="set-label">Velikost písma</span>
          <div class="stepper">
            <button type="button" id="font-down" aria-label="Menší písmo">A−</button>
            <span id="font-val">100 %</span>
            <button type="button" id="font-up" aria-label="Větší písmo">A+</button>
          </div>
        </div>
        <label class="set-row switch-row" id="repeats-row" hidden>
          <span class="set-label">Rozbalit opakované refrény</span>
          <input type="checkbox" class="switch" id="repeats">
        </label>
        <div class="set-row cols-row">
          <span class="set-label" id="cols-label">Sloupce</span>
          <div class="seg" role="radiogroup" aria-labelledby="cols-label">
            <button type="button" role="radio" data-cols="1">1</button>
            <button type="button" role="radio" data-cols="2">2</button>
            <button type="button" role="radio" data-cols="3">3</button>
          </div>
        </div>
        <label class="set-row switch-row">
          <span class="set-label">Světlý vzhled<small>Na slunci a na projektoru se čte líp.</small></span>
          <input type="checkbox" class="switch" id="light">
        </label>
        <label class="set-row switch-row" id="wake-row">
          <span class="set-label">Nezhasínat displej<small id="wake-hint">Telefon na koleni nezhasne uprostřed písně.</small></span>
          <input type="checkbox" class="switch" id="wake">
        </label>
      </section>
      <section class="set">
        <div class="set-row">
          <span class="set-label">Metronom</span>
          <div class="stepper">
            <button type="button" id="bpm-down" aria-label="Pomaleji o 5 BPM">−</button>
            <span><span id="bpm-val">120</span> <small>BPM</small></span>
            <button type="button" id="bpm-up" aria-label="Rychleji o 5 BPM">+</button>
          </div>
        </div>
        <div class="set-actions">
          <button type="button" class="btn btn-quiet" id="bpm-tap">Ťukni do rytmu</button>
          <button type="button" class="btn btn-primary" id="metro-toggle"><span data-icon="metronome"></span><span>Spustit</span></button>
        </div>
        <div class="set-actions">
          <button type="button" class="btn btn-quiet" id="tuner-toggle"><span data-icon="tuner"></span><span>Ladička</span></button>
        </div>
      </section>
    </div>
  </dialog>

  <dialog class="sheet" id="bug" aria-labelledby="bug-title">
    <div class="sheet-head">
      <h2 id="bug-title" tabindex="-1">Nahlásit chybu</h2>
      <button type="button" class="icon-btn" data-close aria-label="Zavřít"><span data-icon="x"></span></button>
    </div>
    <div class="sheet-body">
      <p class="bug-song" id="bug-song"></p>
      <label class="visually-hidden" for="bug-text">Popis chyby</label>
      <textarea id="bug-text" rows="4" placeholder="Co je špatně? (chybný akord, překlep v textu, špatný autor...)"></textarea>
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn btn-quiet" data-close>Zrušit</button>
      <button type="button" class="btn btn-primary" id="bug-send">Odeslat</button>
    </div>
  </dialog>`;

  function buildChrome() {
    const cbar = document.createElement('header');
    cbar.className = 'cbar';
    cbar.id = 'cbar';
    cbar.innerHTML = CBAR;
    document.body.insertBefore(cbar, main);

    main.id = 'page';
    pre.id = 'lyrics';
    const head = main.querySelector('.song-header');
    const pos = document.createElement('a');
    pos.className = 'setlist-pos';
    pos.id = 'setlist-pos';
    pos.href = ROOT + '#vecer';
    pos.hidden = true;
    head.insertBefore(pos, head.firstChild);
    const actions = document.createElement('div');
    actions.className = 'song-actions';
    actions.innerHTML = ACTIONS;
    head.appendChild(actions);

    const after = document.createElement('nav');
    after.className = 'after';
    after.id = 'after';
    after.setAttribute('aria-label', 'Pokračování');
    after.innerHTML = AFTER;
    main.appendChild(after);

    document.body.insertAdjacentHTML('beforeend', TOOLS);
  }

  // ---- everything else, once the shared scripts are in -------------------

  function init() {
    const SL = window.SongList;
    const EV = window.Evening;
    const { transposeChord, preferFlats } = window.ChordTheory;
    const $ = (id) => document.getElementById(id);

    // The old chrome (nav, #player-bar) goes only now that the new one can
    // be built; css/style.css keeps it hidden until then.
    ['.main-nav', '#player-bar'].forEach(sel => { const n = document.querySelector(sel); if (n) n.remove(); });

    const slug = decodeURIComponent(location.pathname.split('/').pop().replace(/\.html$/, ''));
    const params = new URLSearchParams(location.search);
    const fromSetlist = params.get('vecer') === '1';
    const fromRandom = !fromSetlist && params.get('nahodne') === '1';
    const songUrl = (s, mode) => SL.href({ slug: s }) + (mode ? '?' + mode + '=1' : '');

    buildChrome();
    loadScripts(['js/tuner.js']).catch(err => console.error(err));

    // ---- remembered settings ---------------------------------------------

    const settings = {};
    Object.keys(SETTINGS).forEach(name => { settings[name] = settingFrom(name, stored(SETTINGS[name].key)); });
    function setSetting(name, value) {
      const s = SETTINGS[name];
      settings[name] = clamp(Math.round(value), s.min, s.max);
      store(s.key, settings[name]);
      return settings[name];
    }

    const switches = {};
    Object.keys(SWITCHES).forEach(name => { switches[name] = switchFrom(name, stored(SWITCHES[name].key)); });
    function setSwitch(name, on) {
      const s = SWITCHES[name];
      switches[name] = !!on;
      store(s.key, on ? s.on : s.off);
    }

    // This song's own key and speed: whoever plays it two semitones lower
    // every time shouldn't have to click it down every time.
    function allPrefs() {
      const v = SL.readJSON(PREFS_KEY, {});
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    const mine = allPrefs()[slug] || {};
    let transpose = nextTranspose(parseInt(mine.t, 10) || 0, 0);
    let speed = mine.s ? clamp(parseInt(mine.s, 10) || settings.speed, SETTINGS.speed.min, SETTINGS.speed.max) : settings.speed;
    function rememberSong() {
      SL.writeJSON(PREFS_KEY, withSongPrefs(allPrefs(), slug, { t: transpose, s: mine.s }));
    }

    // ---- helpers ---------------------------------------------------------

    function el(tag, className, text) {
      const n = document.createElement(tag);
      if (className) n.className = className;
      if (text != null) n.textContent = text;
      return n;
    }

    let toastTimer;
    function toast(text) {
      const t = $('toast');
      t.textContent = text;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
    }

    const dedupe = SL.dedupe;

    // ---- chord diagrams --------------------------------------------------

    function diagramSvg(name) {
      return window.ChordDiagrams ? ChordDiagrams.renderChordSVG(name) : null;
    }

    const pop = $('pop');
    let popFor = null;

    function showDiagram(chEl) {
      if (popFor === chEl) { hideDiagram(); return; }
      hideDiagram();
      const name = chEl.textContent;
      const svg = diagramSvg(name);
      pop.innerHTML = '';
      pop.appendChild(el('div', 'pop-name', name));
      if (svg) pop.insertAdjacentHTML('beforeend', svg);
      else pop.appendChild(el('div', 'pop-missing', 'Diagram chybí'));
      pop.hidden = false;
      chEl.classList.add('on');
      popFor = chEl;

      const r = chEl.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      // The chord bar may have scrolled away (a phone on its side).
      const top0 = Math.max(0, $('cbar').getBoundingClientRect().bottom) + 8;
      const bottom0 = Math.min(window.innerHeight, $('toolbar').getBoundingClientRect().top) - 8;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      let top = r.bottom + 8;
      if (top + h > bottom0) top = r.top - h - 8;
      if (top < top0) top = top0;
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    }

    function hideDiagram() {
      if (popFor) popFor.classList.remove('on');
      popFor = null;
      pop.hidden = true;
    }

    // ---- the song --------------------------------------------------------

    let song = null;
    let loaded = false;
    const lyrics = pre;
    const raw = rawBody.replace(/class="chord"/g, 'class="ch"');
    // One block per line, chords glued to their words, tablature grouped
    // (sections.js, so it is the same code the tests run).
    const html = window.SongSections ? SongSections.transform(raw, { lines: true }) : raw;
    let groups = [];

    function setGroups(prog) {
      groups = (prog || []).map(dedupe).filter(g => g.length);
    }

    function renderLyrics() {
      // Repeats share their section key, so remember the opened ones by position.
      const peeked = Array.from(lyrics.querySelectorAll('.is-repeat'))
        .map((sec, i) => (sec.classList.contains('peek') ? i : -1)).filter(i => i !== -1);
      lyrics.innerHTML = html;
      lyrics.classList.toggle('show-repeats', switches.showRepeats);
      lyrics.classList.toggle('cols-2', settings.columns === 2);
      lyrics.classList.toggle('cols-3', settings.columns === 3);
      main.classList.toggle('wide', settings.columns > 1);
      const reps = lyrics.querySelectorAll('.is-repeat');
      peeked.forEach(i => { if (reps[i]) reps[i].classList.add('peek'); });
      lyrics.querySelectorAll('.is-repeat .section-head').forEach(h => {
        h.setAttribute('role', 'button');
        h.tabIndex = 0;
        h.setAttribute('aria-expanded', h.closest('.is-repeat').classList.contains('peek') ? 'true' : 'false');
        h.setAttribute('aria-label', 'Opakování, klepnutím rozbalíš');
      });
      visibleLines = null;
      applyTranspose();
    }

    function renderChips() {
      const chips = $('chips');
      chips.innerHTML = '';
      groups.forEach((g, i) => {
        if (i > 0) {
          const sep = el('span', 'cbar-sep');
          sep.setAttribute('aria-hidden', 'true');
          chips.appendChild(sep);
        }
        g.forEach(name => {
          const b = el('button', 'ch', shown(name));
          b.type = 'button';
          b.dataset.chord = name;
          chips.appendChild(b);
        });
      });
      chips.hidden = !groups.length;
    }

    function renderDiagrams() {
      const box = $('diagrams');
      box.innerHTML = '';
      const names = dedupe([].concat.apply([], groups)).map(shown);
      dedupe(names).forEach(name => {
        const d = el('div', 'dg');
        const svg = diagramSvg(name);
        if (svg) d.insertAdjacentHTML('beforeend', svg);
        else d.appendChild(el('span', 'dg-missing', 'Diagram chybí'));
        d.appendChild(el('span', 'dg-name', name));
        box.appendChild(d);
      });
    }

    // ---- transpose -------------------------------------------------------

    // One spelling for the whole song (B Eb F is a key, B D# F is not), and
    // untransposed the song shows exactly what its author wrote.
    let flats = false;
    const shown = (name) => (transpose ? transposeChord(name, transpose, flats) : name);

    function songChords() {
      return Array.from(lyrics.querySelectorAll('.ch'), c => c.dataset.chord).concat([].concat.apply([], groups));
    }

    // "Capo 2" goes on being true for the fingers, but the chords no longer
    // are the ones it was written for.
    const capoEl = main.querySelector('.song-capo');
    const capoText = capoEl ? capoEl.textContent : '';
    function paintCapo() {
      if (!capoEl) return;
      capoEl.textContent = transpose
        ? `${capoText} (akordy posunuté o ${transpose > 0 ? '+' : '−'}${Math.abs(transpose)})`
        : capoText;
    }

    function applyTranspose() {
      flats = preferFlats(songChords(), transpose);
      document.querySelectorAll('.ch').forEach(c => { c.textContent = shown(c.dataset.chord); });
      const v = $('tr-val');
      v.textContent = transpose > 0 ? '+' + transpose : String(transpose).replace('-', '−');
      v.classList.toggle('shifted', transpose !== 0);
      v.setAttribute('aria-label', transpose
        ? `Transpozice ${transpose > 0 ? '+' : ''}${transpose}, klepnutím zpět do původní tóniny`
        : 'Transpozice 0, původní tónina');
      paintCapo();
      if (!$('diagrams').hidden) renderDiagrams();
      hideDiagram();
    }

    function shift(delta) {
      transpose = nextTranspose(transpose, delta);
      applyTranspose();
      rememberSong();
    }

    $('tr-up').addEventListener('click', () => shift(1));
    $('tr-down').addEventListener('click', () => shift(-1));
    $('tr-val').addEventListener('click', () => {
      if (!transpose) return;
      transpose = 0;
      applyTranspose();
      rememberSong();
      toast('Původní tónina');
    });

    // ---- autoscroll ------------------------------------------------------

    let scrolling = false;
    let scrollUsed = false;   // started once in this song: from then on a tap on the text starts it too
    let rafId = 0;
    let frame = { lastT: 0, carry: 0 };
    let stalled = 0;          // frames that asked to move and didn't
    let held = false;         // a finger is on the text

    function atEnd() {
      return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    }

    function pulseNext() {
      const next = $('next-card');
      if (next.hidden) return;
      next.classList.remove('pulse');
      void next.offsetWidth;
      next.classList.add('pulse');
    }

    function step(t) {
      if (!scrolling) return;
      // While a finger moves the text, scrollBy every frame would fight it
      // (and on iOS kill the fling); the scroll waits for the finger.
      if (held) {
        frame.lastT = t;
        rafId = requestAnimationFrame(step);
        return;
      }
      const f = scrollStep(frame, t, speed);
      frame = { lastT: f.lastT, carry: f.carry };
      if (f.px >= 1) {
        const before = window.scrollY;
        window.scrollBy({ top: f.px, behavior: 'instant' });
        stalled = window.scrollY === before ? stalled + 1 : 0;
      }
      // atEnd() is the way out; the stall count is the safety net, so a
      // browser where it never quite fires can't leave the loop spinning and
      // the button showing pause.
      if (atEnd() || stalled > 5) {
        stopScroll();
        pulseNext();
        return;
      }
      rafId = requestAnimationFrame(step);
    }

    function startScroll() {
      if (atEnd()) window.scrollTo({ top: 0, behavior: 'instant' });
      cancelAnimationFrame(rafId);
      scrolling = true;
      scrollUsed = true;
      frame = { lastT: 0, carry: 0 };
      stalled = 0;
      paintScroll();
      rafId = requestAnimationFrame(step);
    }

    function stopScroll() {
      scrolling = false;
      cancelAnimationFrame(rafId);
      paintScroll();
    }

    function paintScroll() {
      const b = $('scroll');
      b.setAttribute('aria-pressed', scrolling ? 'true' : 'false');
      b.setAttribute('aria-label', scrolling ? 'Zastavit rolování' : 'Spustit rolování');
      b.innerHTML = SL.icon(scrolling ? 'pause' : 'play', 24);
      $('sp-label').textContent = 'Rolování ' + speed;
      // A phone on its side slides the bottom bar away meanwhile.
      document.body.classList.toggle('is-scrolling', scrolling);
    }

    function setSpeed(n) {
      speed = clamp(n, SETTINGS.speed.min, SETTINGS.speed.max);
      setSetting('speed', speed);      // the next new song starts here
      mine.s = speed;                  // and this one keeps it
      rememberSong();
      paintScroll();
      toast('Rychlost rolování ' + speed);
    }

    $('scroll').addEventListener('click', () => (scrolling ? stopScroll() : startScroll()));
    $('sp-up').addEventListener('click', () => setSpeed(speed + 1));
    $('sp-down').addEventListener('click', () => setSpeed(speed - 1));

    lyrics.addEventListener('touchstart', () => { held = true; }, { passive: true });
    ['touchend', 'touchcancel'].forEach(ev => lyrics.addEventListener(ev, () => { held = false; }, { passive: true }));

    // ---- taps on the song ------------------------------------------------

    function selecting() {
      const sel = window.getSelection && window.getSelection();
      return !!sel && String(sel).length > 0;
    }

    document.addEventListener('click', (e) => {
      const ch = e.target.closest('.ch');
      if (ch) { showDiagram(ch); return; }
      const hadPop = !!popFor;
      if (!e.target.closest('#pop')) hideDiagram();

      const head = e.target.closest('.is-repeat .section-head');
      if (head && !switches.showRepeats) {
        const sec = head.closest('.is-repeat');
        const on = sec.classList.toggle('peek');
        head.setAttribute('aria-expanded', String(on));
        visibleLines = null;
        return;
      }

      // The text is the biggest target there is for a hand that just left
      // the strings: a tap stops the scroll, and once it has run in this
      // song, the next tap starts it again.
      if (!e.target.closest('#lyrics')) return;
      if (scrolling) {
        stopScroll();
        toast('Rolování zastaveno');
      } else if (scrollUsed && !hadPop && !selecting()) {
        startScroll();
        toast('Rolování pokračuje');
      }
    });

    lyrics.addEventListener('keydown', (e) => {
      const head = e.target.closest('.is-repeat .section-head');
      if (head && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        head.click();
      }
    });

    function pageStepNow() {
      const top = Math.max(0, $('cbar').getBoundingClientRect().bottom);
      const bottom = Math.min(window.innerHeight, $('toolbar').getBoundingClientRect().top);
      const line = parseFloat(getComputedStyle(lyrics).lineHeight) || 32;
      return pageStep(top, bottom, line);
    }

    function go(id) {
      const a = $(id);
      if (a.hidden) return false;
      location.replace(a.getAttribute('href'));
      return true;
    }

    // Keyboard and page-turner pedals. At the end of a song the pedal turns
    // to the next one (of the evening, or the next random one), at the top
    // back to the one before - the only hands-free control there is.
    document.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, textarea, dialog[open]')) return;
      if (e.key === ' ' && !(e.target.closest && e.target.closest('button, a'))) {
        e.preventDefault();
        if (scrolling) stopScroll(); else startScroll();
      } else if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (atEnd() && go('next-card')) return;
        window.scrollBy({ top: pageStepNow(), behavior: 'smooth' });
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (window.scrollY <= 2 && go('prev-link')) return;
        window.scrollBy({ top: -pageStepNow(), behavior: 'smooth' });
      } else if (e.key === 'Escape') {
        hideDiagram();
      }
    });

    // ---- the place in the song survives turning the phone ------------------

    // The first line under the chord bar, kept up to date while reading, so
    // a turned phone (where Safari loses the place) scrolls back to it.
    let visibleLines = null;
    let anchor = null;
    let anchorQueued = false;

    function firstVisibleLine() {
      if (!visibleLines) visibleLines = Array.from(lyrics.querySelectorAll('.ln')).filter(ln => ln.getClientRects().length);
      const top = Math.max(0, $('cbar').getBoundingClientRect().bottom);
      let lo = 0;
      let hi = visibleLines.length - 1;
      let found = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (visibleLines[mid].getBoundingClientRect().bottom > top) { found = visibleLines[mid]; hi = mid - 1; } else lo = mid + 1;
      }
      return found;
    }

    window.addEventListener('scroll', () => {
      if (popFor && !scrolling) hideDiagram();
      if (anchorQueued) return;
      anchorQueued = true;
      requestAnimationFrame(() => { anchorQueued = false; anchor = firstVisibleLine(); });
    }, { passive: true });

    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
      hideDiagram();   // it is pinned where its chord was
      if (window.innerWidth === lastWidth) return;   // just the browser's own bars
      lastWidth = window.innerWidth;
      visibleLines = null;
      const keep = anchor;
      if (keep && window.scrollY > 0) requestAnimationFrame(() => keep.scrollIntoView({ block: 'start', behavior: 'instant' }));
    });

    // ---- fingerings strip ------------------------------------------------

    function setDiagrams(on) {
      $('diagrams').hidden = !on;
      $('diagrams-toggle').setAttribute('aria-pressed', on ? 'true' : 'false');
      setSwitch('diagrams', on);
      if (on) renderDiagrams();
    }
    $('diagrams-toggle').addEventListener('click', () => setDiagrams($('diagrams').hidden));

    // ---- settings sheet --------------------------------------------------

    const more = $('more');
    const FONT_STEP = 10;

    function paintSettings() {
      $('font-val').textContent = settings.fontScale + ' %';
      document.querySelectorAll('[data-cols]').forEach(b => b.setAttribute('aria-checked', Number(b.dataset.cols) === settings.columns ? 'true' : 'false'));
      $('repeats').checked = switches.showRepeats;
      $('wake').checked = switches.keepAwake && hasWakeLock;
      $('light').checked = switches.light;
      $('bpm-val').textContent = settings.bpm;
      const mt = $('metro-toggle');
      mt.classList.toggle('running', metroRunning);
      mt.lastElementChild.textContent = metroRunning ? 'Zastavit' : 'Spustit';
    }

    function applyFont() {
      document.documentElement.style.setProperty('--scale', settings.fontScale / 100);
      visibleLines = null;
    }

    function setFont(delta) {
      setSetting('fontScale', settings.fontScale + delta);
      applyFont();
      paintSettings();
    }

    $('more-btn').addEventListener('click', () => { paintSettings(); more.showModal(); });
    $('font-up').addEventListener('click', () => setFont(FONT_STEP));
    $('font-down').addEventListener('click', () => setFont(-FONT_STEP));
    document.querySelectorAll('[data-cols]').forEach(b => b.addEventListener('click', () => {
      setSetting('columns', Number(b.dataset.cols));
      renderLyrics();
      paintSettings();
    }));
    $('repeats').addEventListener('change', (e) => {
      setSwitch('showRepeats', e.target.checked);
      lyrics.classList.toggle('show-repeats', switches.showRepeats);
      visibleLines = null;
    });
    $('light').addEventListener('change', (e) => {
      setSwitch('light', e.target.checked);
      applyTheme(switches.light);
    });
    $('wake').addEventListener('change', (e) => {
      setSwitch('keepAwake', e.target.checked);
      if (switches.keepAwake) lockScreen(true); else releaseScreen();
    });

    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', (e) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    }));

    // The tuner (js/tuner.js) opens its own overlay from #tuner-toggle; the
    // sheet has to get out of the way, a modal dialog would sit above it.
    $('tuner-toggle').addEventListener('click', () => more.close());

    // ---- metronome -------------------------------------------------------

    // Beats are placed on the audio clock a little ahead of time; the timer
    // only has to wake up often enough, its own jitter is never heard (it
    // was, with setInterval playing each beat "now", and it added up).
    let metroCtx = null;
    let metroTimer = null;
    let metroRunning = false;
    let nextBeat = 0;
    const LOOKAHEAD = 0.12;   // s of beats scheduled ahead
    const TICK_MS = 25;

    function beep(at) {
      const osc = metroCtx.createOscillator();
      const gain = metroCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(metroCtx.destination);
      gain.gain.setValueAtTime(0.3, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      osc.start(at);
      osc.stop(at + 0.06);
      setTimeout(() => {
        const dot = $('metro-dot');
        dot.classList.add('beat');
        setTimeout(() => dot.classList.remove('beat'), 110);
      }, Math.max(0, (at - metroCtx.currentTime) * 1000));
    }

    function schedule() {
      if (!metroCtx) return;
      const now = metroCtx.currentTime;
      // Back from a throttled background tab: pick the beat up afresh rather
      // than play every missed one at once.
      if (nextBeat < now - 0.05) nextBeat = now + 0.05;
      while (nextBeat < now + LOOKAHEAD) {
        beep(nextBeat);
        nextBeat += 60 / settings.bpm;
      }
    }

    function startMetro() {
      if (!metroCtx) metroCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (metroCtx.state !== 'running') metroCtx.resume().catch(() => {});
      clearInterval(metroTimer);
      nextBeat = metroCtx.currentTime + 0.05;
      schedule();
      metroTimer = setInterval(schedule, TICK_MS);
      metroRunning = true;
      paintMetro();
    }

    function stopMetro() {
      clearInterval(metroTimer);
      metroTimer = null;
      metroRunning = false;
      paintMetro();
    }

    function paintMetro() {
      $('metro-pill').hidden = !metroRunning;
      $('metro-pill-bpm').textContent = settings.bpm;
      $('more-btn').classList.toggle('busy', metroRunning);
      paintSettings();
    }

    // No restart: the next beat simply lands 60/bpm after the last one.
    function setBpm(n) {
      setSetting('bpm', n);
      paintMetro();
    }

    // A locked phone suspends the audio; coming back wakes it up.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && metroRunning && metroCtx && metroCtx.state !== 'running') {
        metroCtx.resume().catch(() => {});
      }
    });

    $('metro-toggle').addEventListener('click', () => (metroRunning ? stopMetro() : startMetro()));
    $('metro-pill').addEventListener('click', stopMetro);
    $('bpm-up').addEventListener('click', () => setBpm(settings.bpm + 5));
    $('bpm-down').addEventListener('click', () => setBpm(settings.bpm - 5));

    // Tap tempo: the average of the last few gaps between taps.
    let taps = [];
    $('bpm-tap').addEventListener('click', () => {
      const now = performance.now();
      taps = taps.filter(t => now - t < 3000);
      taps.push(now);
      if (taps.length >= 3) {
        const gaps = taps.slice(1).map((t, i) => t - taps[i]).slice(-4);
        setBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
      }
    });

    // ---- keep the screen on ----------------------------------------------

    const hasWakeLock = 'wakeLock' in navigator;
    let wakeLock = null;
    let locking = false;
    let wakeWarned = false;

    // A refused request (battery saver, or Safari wanting a tap first) is
    // tried again at the next touch; refused after a touch, it's said once.
    async function lockScreen(fromTouch) {
      if (!switches.keepAwake || !hasWakeLock || document.visibilityState !== 'visible') return;
      if ((wakeLock && !wakeLock.released) || locking) return;
      locking = true;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } catch (e) {
        wakeLock = null;
        if (fromTouch && !wakeWarned) {
          wakeWarned = true;
          toast('Displej může zhasnout: telefon šetří baterii.');
        }
      } finally {
        locking = false;
      }
    }

    function releaseScreen() {
      if (wakeLock) wakeLock.release().catch(() => {});
      wakeLock = null;
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') lockScreen(false);
    });
    document.addEventListener('pointerdown', () => { if (!wakeLock) lockScreen(true); }, { passive: true });
    if (!hasWakeLock) {
      $('wake').disabled = true;
      $('wake-hint').textContent = 'Tenhle prohlížeč to neumí: displej zhasíná podle nastavení telefonu.';
    }

    // ---- preview ---------------------------------------------------------

    // A 30 s clip from the iTunes catalogue, so you can check how the song
    // goes. song-previews-public.json (built at deploy) holds only exact
    // title-and-performer matches; the button appears only when one exists.
    function setupPreview() {
      fetch(ROOT + 'song-previews-public.json')
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          const url = data && data.previews && data.previews[slug];
          if (!url) return;
          const btn = $('preview');
          const audio = new Audio(url);
          audio.preload = 'none';
          audio.volume = 0.8;
          const paint = (on) => {
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.firstElementChild.innerHTML = SL.icon(on ? 'pause' : 'play', 18);
            btn.lastElementChild.textContent = on ? 'Zastavit ukázku' : 'Ukázka';
          };
          btn.hidden = false;
          btn.addEventListener('click', () => {
            if (!audio.paused) { audio.pause(); audio.currentTime = 0; paint(false); return; }
            audio.currentTime = 0;
            const p = audio.play();
            if (p && p.catch) p.catch(() => paint(false));
            paint(true);
          });
          ['ended', 'error'].forEach(ev => audio.addEventListener(ev, () => paint(false)));
        })
        .catch(() => { /* offline: the audio is on Apple's CDN anyway */ });
    }

    // ---- favourite, tonight, what comes next -----------------------------

    function paintToggles() {
      const fav = SL.favourites.has(slug);
      $('fav').setAttribute('aria-pressed', fav ? 'true' : 'false');
      $('fav').lastElementChild.textContent = fav ? 'Oblíbená' : 'Oblíbit';
      const inSet = EV.has(slug);
      $('add').setAttribute('aria-pressed', inSet ? 'true' : 'false');
      $('add').firstElementChild.innerHTML = SL.icon(inSet ? 'check' : 'plus', 18);
      $('add').lastElementChild.textContent = inSet ? 'Ve večeru' : 'Do večera';
    }

    $('fav').addEventListener('click', () => {
      const on = SL.favourites.toggle(slug);
      paintToggles();
      toast(on ? 'Uloženo do oblíbených' : 'Odebráno z oblíbených');
    });

    // Waits for songs.json: before it, the setlist can't be read right (and a
    // shared evening would get the song twice), and on a weak signal that
    // can take a while.
    let adding = false;
    $('add').addEventListener('click', () => {
      if (adding) return;
      adding = true;
      SL.load().then(() => {
        if (EV.has(slug)) {
          if (!EV.remove(slug)) { toast('Tuhle přidal někdo jiný. Odebrat ji může zakladatel večera nebo parta.'); return; }
          toast('Odebráno z večera');
        } else {
          EV.add(slug);
          toast(EV.shared ? 'Přidáno do společného večera' : 'Přidáno do dnešního večera');
        }
        paintToggles();
        renderNext();
      }).catch(() => toast('Seznam písní se nenačetl, zkus to za chvíli.'))
        .then(() => { adding = false; });
    });

    function renderNext() {
      $('setlist-pos').hidden = true;
      $('next-top').hidden = true;
      $('next-card').hidden = true;
      $('prev-link').hidden = true;
      $('next-again').hidden = true;
      if (fromRandom) { renderNextRandom(); return; }
      const list = EV.list();
      const i = list.indexOf(slug);
      if (!fromSetlist || i === -1) return;

      $('setlist-pos').hidden = false;
      $('setlist-pos').textContent = `${EV.shared ? 'Společný večer' : 'Dnešní večer'} · ${i + 1} z ${list.length}`;
      const next = SL.bySlug(list[i + 1]);
      const prev = SL.bySlug(list[i - 1]);
      if (next) {
        const url = songUrl(next.slug, 'vecer');
        $('next-top').hidden = false;
        $('next-top').href = url;
        $('next-card').hidden = false;
        $('next-card').href = url;
        $('next-label').textContent = `Další · ${i + 2} z ${list.length}`;
        $('next-title').textContent = next.title;
        $('next-artist').textContent = next._authors.join(', ');
      }
      if (prev) {
        $('prev-link').hidden = false;
        $('prev-link').href = songUrl(prev.slug, 'vecer');
        $('prev-link').textContent = `Předchozí: ${prev.title}`;
      }
    }

    // Opened from Objevit: the next random song waits at the end, drawn from
    // the filters the list had, never one of the last twenty drawn.
    let nextRandom = null;

    function drawNext() {
      const saved = SL.loadState('list') || {};
      const pool = SL.query({ lang: saved.lang || '', capo: saved.capo || '', chords: new Set(saved.chords || []) })
        .named.filter(s => s.slug !== slug);
      nextRandom = SL.pickRandom(pool);
    }

    function renderNextRandom() {
      if (!nextRandom) drawNext();
      if (!nextRandom) return;
      $('after').classList.add('random');
      const url = songUrl(nextRandom.slug, 'nahodne');
      $('next-top').hidden = false;
      $('next-top').href = url;
      $('next-top').setAttribute('aria-label', 'Další náhodná píseň');
      $('next-card').hidden = false;
      $('next-card').href = url;
      $('next-label').textContent = 'Další náhodná';
      $('next-title').textContent = nextRandom.title;
      $('next-artist').textContent = nextRandom._authors.join(', ');
      $('next-again').hidden = false;
    }

    $('next-again').addEventListener('click', () => {
      drawNext();
      renderNextRandom();
      const card = $('next-card');
      card.classList.remove('pulse');
      void card.offsetWidth;
      card.classList.add('pulse');
    });

    EV.onChange(() => { if (loaded) { paintToggles(); if (!fromRandom) renderNext(); } });

    // ---- the evening plays from the founder's phone ----------------------

    // On the founder's phone this page is the one being played: everyone
    // sees it as playing, and ten seconds on screen make a queued song
    // played. Said once per page view and again on coming back to it, never
    // on someone else's change - two open tabs would take turns forever.
    let announced = false;
    let playedTimer = 0;

    function announce() {
      if (announced || !song || !EV.shared || EV.role !== 'owner') return;
      announced = true;
      EV.showing(slug);
    }

    function armPlayed() {
      clearTimeout(playedTimer);
      if (document.visibilityState === 'visible') playedTimer = setTimeout(() => EV.markPlayed(slug), 10000);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { announced = false; announce(); }
      armPlayed();
    });
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) { announced = false; announce(); armPlayed(); }
    });
    armPlayed();

    // Everyone else may follow: the page then turns over to whatever the
    // founder opens next.
    function paintFollow() {
      const b = $('follow');
      b.hidden = !EV.shared || EV.role === 'owner';
      const on = EV.following;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.lastElementChild.textContent = on ? 'Sleduješ zakladatele' : 'Sledovat zakladatele';
    }

    $('follow').addEventListener('click', () => {
      const on = !EV.following;
      EV.setFollowing(on);
      toast(on ? 'Písně se přepnou samy se zakladatelem večera' : 'Už nesleduješ zakladatele');
    });

    EV.onChange(() => {
      announce();
      paintFollow();
      const move = EV.takeMove();
      if (move && move !== slug) location.replace(songUrl(move, 'vecer'));
    });

    // The artist under the title leads to all of their songs in the list.
    function linkAuthors() {
      const p = main.querySelector('.song-author');
      if (!p || !song || !song._authors.length) return;
      p.textContent = '';
      song._authors.forEach((name, i) => {
        if (i > 0) p.appendChild(document.createTextNode(', '));
        const a = el('a', null, name);
        a.href = ROOT + '#interpret/' + encodeURIComponent(name);
        a.setAttribute('aria-label', 'Písně od: ' + name);
        p.appendChild(a);
      });
    }

    // Walking the setlist replaces the page instead of stacking history, so
    // the back arrow still means "back to the list" after five songs.
    ['next-top', 'next-card', 'prev-link'].forEach(id => $(id).addEventListener('click', (e) => {
      e.preventDefault();
      location.replace($(id).getAttribute('href'));
    }));

    // Back: to wherever the list was left, when we came from it.
    $('back').addEventListener('click', (e) => {
      let fromSite = false;
      try { fromSite = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (err) { /* plain link */ }
      if (fromSite && history.length > 1) {
        e.preventDefault();
        history.back();
      }
    });

    // ---- bug report ------------------------------------------------------

    const titleText = () => (song ? song.title : (main.querySelector('h1') || {}).textContent || slug);

    $('report').addEventListener('click', () => {
      const author = (main.querySelector('.song-author') || {}).textContent || '';
      $('bug-song').textContent = author ? `${titleText()} · ${author}` : titleText();
      $('bug-text').value = '';
      $('bug').showModal();
      $('bug-text').focus();
    });
    $('bug-send').addEventListener('click', () => {
      const text = $('bug-text').value.trim();
      if (!text) { $('bug-text').focus(); return; }
      const subject = encodeURIComponent(`Bug: ${titleText()}`);
      const body = encodeURIComponent(`Píseň: ${titleText()}\nURL: ${location.origin}${location.pathname}\n\n${text}`);
      $('bug').close();
      location.href = `mailto:ondrejbek8@gmail.com?subject=${subject}&body=${body}`;
    });

    // ---- songs.json ------------------------------------------------------

    function onSongs() {
      loaded = true;
      song = SL.bySlug(slug) || null;
      if (song && Array.isArray(song.progression) && song.progression.length) {
        setGroups(song.progression);
        renderChips();
        applyTranspose();
      }
      paintToggles();
      renderNext();
      linkAuthors();
      announce();
      paintFollow();
      SL.recent.add(slug);
    }

    // On a weak signal the first try may fail; the page keeps asking for a
    // while, and again when the phone says it's back online.
    let loadTries = 0;
    function loadSongs() {
      if (loaded) return;
      SL.load().then(onSongs).catch(err => {
        console.error('songs.json failed:', err);
        loadTries++;
        if (loadTries < 4) setTimeout(loadSongs, 5000 * loadTries);
      });
    }
    window.addEventListener('online', loadSongs);

    // ---- go --------------------------------------------------------------

    document.querySelectorAll('[data-icon]').forEach(n => { n.innerHTML = SL.icon(n.dataset.icon); });
    applyFont();
    paintScroll();
    paintMetro();
    $('repeats-row').hidden = !/is-repeat/.test(html);
    // The song's own text gives the chord bar at once; songs.json's
    // progression (grouped by section) replaces it when it arrives.
    setGroups(window.SongSections ? SongSections.deriveProgression(raw) : []);
    renderChips();
    renderLyrics();
    setDiagrams(switches.diagrams);
    lockScreen(false);
    setupPreview();
    loadSongs();
  }
})();
