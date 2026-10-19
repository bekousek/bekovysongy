/**
 * player.js - every song page (songs/<slug>.html), built for a phone lying
 * on a knee: the song's chords pinned at the top, the two controls used
 * mid-song (key, autoscroll) at the bottom, everything else in one sheet.
 *
 * The ~600 song pages are static HTML from js/song-template.js and are never
 * edited for looks: this script takes the page as it is (h1, .song-author,
 * .song-capo, pre.song-text), removes the old nav and player bar, and builds
 * the new chrome around it. It reuses the site's song logic - js/sections.js
 * for refrén/bridge and folded repeats, js/chord-theory.js for transposition,
 * js/chords.js for fingering diagrams - and loads js/song-list-core.js,
 * js/vecer.js and js/tuner.js itself, so the pages don't have to list them.
 *
 * Also:
 *   - fingerings of all the song's chords one tap away under the chord bar,
 *   - the screen stays on while the song is open,
 *   - ?vecer=1 walks through tonight's setlist (shared or not), ?nahodne=1
 *     (opened from Objevit) offers the next random song,
 *   - a tap on the text stops autoscroll; Space and page-turner pedals
 *     (PageDown / arrows) work on a keyboard.
 */
(function () {
  'use strict';

  // Every song page is exactly one directory deep, so the site root is "../"
  // relative to the page and to this file alike.
  const ROOT = new URL('../', document.currentScript.src).href;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register(ROOT + 'sw.js'));
  }

  const main = document.querySelector('main.song-page');
  const pre = main && main.querySelector('pre.song-text');
  if (!pre) return;

  // The old chrome stays hidden by css/style.css until it's gone.
  ['.main-nav', '#player-bar'].forEach(sel => { const n = document.querySelector(sel); if (n) n.remove(); });
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = '#0e0d0c';

  const rawBody = pre.innerHTML;   // before sections.js rewrites it

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ROOT + src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(src));
      document.head.appendChild(s);
    });
  }

  loadScript('js/song-list-core.js')
    .then(() => loadScript('js/vecer.js'))
    .then(init)
    .catch(err => console.error('Song page scripts failed to load:', err));

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
    <button type="button" class="pill" id="add" aria-pressed="false"><span data-icon="plus"></span><span>Do večera</span></button>`;

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
        <label class="set-row switch-row" id="wake-row" hidden>
          <span class="set-label">Nezhasínat displej<small>Telefon na koleni nezhasne uprostřed písně.</small></span>
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
    const { transposeChord } = window.ChordTheory;
    const $ = (id) => document.getElementById(id);

    const slug = decodeURIComponent(location.pathname.split('/').pop().replace(/\.html$/, ''));
    const params = new URLSearchParams(location.search);
    const fromSetlist = params.get('vecer') === '1';
    const fromRandom = !fromSetlist && params.get('nahodne') === '1';
    const songUrl = (s, mode) => SL.href({ slug: s }) + (mode ? '?' + mode + '=1' : '');

    buildChrome();
    loadScript('js/tuner.js').catch(err => console.error(err));

    // ---- remembered settings ---------------------------------------------

    function read(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch (e) { return fallback; }
    }
    function write(key, value) {
      try { localStorage.setItem(key, String(value)); } catch (e) { /* not remembered */ }
    }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

    const FONT_KEY = 'song_font_scale';
    const REPEATS_KEY = 'show_repeats';
    const COLUMNS_KEY = 'song_columns';
    const SPEED_KEY = 'bs_scroll_speed';
    const BPM_KEY = 'bs_bpm';
    const WAKE_KEY = 'bs_keep_awake';
    const DIAGRAMS_KEY = 'bs_show_diagrams';

    let fontScale = clamp(parseInt(read(FONT_KEY, '100'), 10) || 100, 70, 150);
    let showRepeats = read(REPEATS_KEY, 'off') === 'on';
    let columns = clamp(parseInt(read(COLUMNS_KEY, '1'), 10) || 1, 1, 3);
    let speed = clamp(parseInt(read(SPEED_KEY, '3'), 10) || 3, 1, 10);
    let bpm = clamp(parseInt(read(BPM_KEY, '120'), 10) || 120, 40, 240);
    let keepAwake = read(WAKE_KEY, '1') !== '0';
    let transpose = 0;

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

    function dedupe(list) {
      const seen = new Set();
      return list.filter(c => (seen.has(c) ? false : (seen.add(c), true)));
    }

    // ---- chord diagrams --------------------------------------------------

    // chords.js draws on the old navy palette; recolour it for black.
    function diagramSvg(name) {
      const svg = window.ChordDiagrams && ChordDiagrams.renderChordSVG(name);
      if (!svg) return null;
      return svg
        .replace('fill="#16213e"', 'fill="none"')
        .replace(/#556677/g, '#5d5955')
        .replace(/#8899aa/g, '#b6b1aa')
        .replace(/#e0e0e0/g, '#f2f2f0')
        .replace(/#e74c3c/g, '#98928b')
        .replace(/#27ae60/g, '#f2f2f0');
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
      const top0 = $('cbar').getBoundingClientRect().bottom + 8;
      const bottom0 = window.innerHeight - $('toolbar').offsetHeight - 8;
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
    const lyrics = pre;
    const raw = rawBody.replace(/class="chord"/g, 'class="ch"');
    const html = window.SongSections ? SongSections.transform(raw) : raw;
    let groups = [];

    function setGroups(prog) {
      groups = (prog || []).map(dedupe).filter(g => g.length);
    }

    // Each line of the song becomes its own block (.ln), so a line too long
    // for the phone wraps with a hanging indent instead of passing for the
    // next line. Chord spans move along untouched.
    function splitLines(box) {
      const kids = Array.from(box.childNodes);
      if (kids.some(n => n.nodeType === 1 && n.textContent.indexOf('\n') !== -1)) return;
      const lines = [el('span', 'ln')];
      kids.forEach(n => {
        if (n.nodeType !== 3) { lines[lines.length - 1].appendChild(n); return; }
        n.data.split('\n').forEach((part, i) => {
          if (i > 0) lines.push(el('span', 'ln'));
          if (part) lines[lines.length - 1].appendChild(document.createTextNode(part));
        });
      });
      // A closing newline draws no empty line in pre-wrap; keep it that way.
      if (lines.length > 1 && !lines[lines.length - 1].firstChild) lines.pop();
      box.textContent = '';
      lines.forEach(l => box.appendChild(l));
    }

    function renderLyrics() {
      // Repeats share their section key, so remember the opened ones by position.
      const peeked = Array.from(lyrics.querySelectorAll('.is-repeat'))
        .map((sec, i) => (sec.classList.contains('peek') ? i : -1)).filter(i => i !== -1);
      lyrics.innerHTML = html;
      if (lyrics.querySelector('.song-section')) lyrics.querySelectorAll('.section-plain, .section-body, .section-tail').forEach(splitLines);
      else splitLines(lyrics);
      lyrics.classList.toggle('show-repeats', showRepeats);
      lyrics.classList.toggle('cols-2', columns === 2);
      lyrics.classList.toggle('cols-3', columns === 3);
      main.classList.toggle('wide', columns > 1);
      const reps = lyrics.querySelectorAll('.is-repeat');
      peeked.forEach(i => { if (reps[i]) reps[i].classList.add('peek'); });
      lyrics.querySelectorAll('.is-repeat .section-head').forEach(h => {
        h.setAttribute('role', 'button');
        h.tabIndex = 0;
        h.setAttribute('aria-expanded', h.closest('.is-repeat').classList.contains('peek') ? 'true' : 'false');
        h.setAttribute('aria-label', 'Opakování, klepnutím rozbalíš');
      });
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
          const b = el('button', 'ch', transposeChord(name, transpose));
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
      const names = dedupe([].concat.apply([], groups)).map(c => transposeChord(c, transpose));
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

    function applyTranspose() {
      document.querySelectorAll('.ch').forEach(c => {
        c.textContent = transposeChord(c.dataset.chord, transpose);
      });
      const v = $('tr-val');
      v.textContent = transpose > 0 ? '+' + transpose : String(transpose).replace('-', '−');
      v.classList.toggle('shifted', transpose !== 0);
      v.setAttribute('aria-label', transpose
        ? `Transpozice ${transpose > 0 ? '+' : ''}${transpose}, klepnutím zpět do původní tóniny`
        : 'Transpozice 0, původní tónina');
      if (!$('diagrams').hidden) renderDiagrams();
      hideDiagram();
    }

    function shift(delta) {
      let t = ((transpose + delta) % 12 + 12) % 12;
      if (t > 6) t -= 12;   // −5 … +6, the short way round
      transpose = t;
      applyTranspose();
    }

    $('tr-up').addEventListener('click', () => shift(1));
    $('tr-down').addEventListener('click', () => shift(-1));
    $('tr-val').addEventListener('click', () => {
      if (!transpose) return;
      transpose = 0;
      applyTranspose();
      toast('Původní tónina');
    });

    // ---- autoscroll ------------------------------------------------------

    // Same pace as before: speed 1 is 4 px/s, speed 10 is 40 px/s.
    let scrolling = false;
    let rafId = 0;
    let lastT = 0;
    let carry = 0;

    function atEnd() {
      return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    }

    function step(t) {
      if (!scrolling) return;
      if (lastT) {
        carry += (t - lastT) / 1000 * speed * 4;
        const px = Math.floor(carry);
        if (px >= 1) {
          window.scrollBy(0, px);
          carry -= px;
        }
      }
      lastT = t;
      if (atEnd()) {
        stopScroll();
        const next = $('next-card');
        if (!next.hidden) {
          next.classList.remove('pulse');
          void next.offsetWidth;
          next.classList.add('pulse');
        }
        return;
      }
      rafId = requestAnimationFrame(step);
    }

    function startScroll() {
      if (atEnd()) window.scrollTo({ top: 0, behavior: 'instant' });
      scrolling = true;
      lastT = 0;
      carry = 0;
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
    }

    function setSpeed(n) {
      speed = clamp(n, 1, 10);
      write(SPEED_KEY, speed);
      paintScroll();
      toast('Rychlost rolování ' + speed);
    }

    $('scroll').addEventListener('click', () => (scrolling ? stopScroll() : startScroll()));
    $('sp-up').addEventListener('click', () => setSpeed(speed + 1));
    $('sp-down').addEventListener('click', () => setSpeed(speed - 1));

    // ---- taps on the song ------------------------------------------------

    document.addEventListener('click', (e) => {
      const ch = e.target.closest('.ch');
      if (ch) { showDiagram(ch); return; }
      if (!e.target.closest('#pop')) hideDiagram();

      const head = e.target.closest('.is-repeat .section-head');
      if (head && !showRepeats) {
        const sec = head.closest('.is-repeat');
        const on = sec.classList.toggle('peek');
        head.setAttribute('aria-expanded', String(on));
        return;
      }

      // Tapping the text while it scrolls is the quickest way to stop it
      // with a hand that just left the strings.
      if (scrolling && e.target.closest('#lyrics')) {
        stopScroll();
        toast('Rolování zastaveno');
      }
    });

    lyrics.addEventListener('keydown', (e) => {
      const head = e.target.closest('.is-repeat .section-head');
      if (head && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        head.click();
      }
    });

    // Keyboard and page-turner pedals.
    document.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, textarea, dialog[open]')) return;
      if (e.key === ' ' && !(e.target.closest && e.target.closest('button, a'))) {
        e.preventDefault();
        if (scrolling) stopScroll(); else startScroll();
      } else if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        window.scrollBy({ top: window.innerHeight * 0.75, behavior: 'smooth' });
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        window.scrollBy({ top: -window.innerHeight * 0.75, behavior: 'smooth' });
      } else if (e.key === 'Escape') {
        hideDiagram();
      }
    });

    window.addEventListener('scroll', () => { if (popFor && !scrolling) hideDiagram(); }, { passive: true });

    // ---- fingerings strip ------------------------------------------------

    function setDiagrams(on) {
      $('diagrams').hidden = !on;
      $('diagrams-toggle').setAttribute('aria-pressed', on ? 'true' : 'false');
      write(DIAGRAMS_KEY, on ? '1' : '0');
      if (on) renderDiagrams();
    }
    $('diagrams-toggle').addEventListener('click', () => setDiagrams($('diagrams').hidden));

    // ---- settings sheet --------------------------------------------------

    const more = $('more');

    function paintSettings() {
      $('font-val').textContent = fontScale + ' %';
      document.querySelectorAll('[data-cols]').forEach(b => b.setAttribute('aria-checked', Number(b.dataset.cols) === columns ? 'true' : 'false'));
      $('repeats').checked = showRepeats;
      $('wake').checked = keepAwake;
      $('bpm-val').textContent = bpm;
      const mt = $('metro-toggle');
      mt.classList.toggle('running', metroRunning);
      mt.lastElementChild.textContent = metroRunning ? 'Zastavit' : 'Spustit';
    }

    function applyFont() {
      document.documentElement.style.setProperty('--scale', fontScale / 100);
    }

    $('more-btn').addEventListener('click', () => { paintSettings(); more.showModal(); });
    $('font-up').addEventListener('click', () => { fontScale = clamp(fontScale + 10, 70, 150); write(FONT_KEY, fontScale); applyFont(); paintSettings(); });
    $('font-down').addEventListener('click', () => { fontScale = clamp(fontScale - 10, 70, 150); write(FONT_KEY, fontScale); applyFont(); paintSettings(); });
    document.querySelectorAll('[data-cols]').forEach(b => b.addEventListener('click', () => {
      columns = Number(b.dataset.cols);
      write(COLUMNS_KEY, columns);
      renderLyrics();
      paintSettings();
    }));
    $('repeats').addEventListener('change', (e) => {
      showRepeats = e.target.checked;
      write(REPEATS_KEY, showRepeats ? 'on' : 'off');
      lyrics.classList.toggle('show-repeats', showRepeats);
    });
    $('wake').addEventListener('change', (e) => {
      keepAwake = e.target.checked;
      write(WAKE_KEY, keepAwake ? '1' : '0');
      if (keepAwake) lockScreen(); else releaseScreen();
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

    let metroCtx = null;
    let metroTimer = null;
    let metroRunning = false;

    function click() {
      if (!metroCtx) metroCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = metroCtx.createOscillator();
      const gain = metroCtx.createGain();
      osc.connect(gain);
      gain.connect(metroCtx.destination);
      osc.frequency.value = 880;
      osc.type = 'square';
      gain.gain.setValueAtTime(0.3, metroCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, metroCtx.currentTime + 0.05);
      osc.start(metroCtx.currentTime);
      osc.stop(metroCtx.currentTime + 0.05);
      const dot = $('metro-dot');
      dot.classList.add('beat');
      setTimeout(() => dot.classList.remove('beat'), 110);
    }

    function startMetro() {
      stopMetro();
      click();
      metroTimer = setInterval(click, 60000 / bpm);
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
      $('metro-pill-bpm').textContent = bpm;
      $('more-btn').classList.toggle('busy', metroRunning);
      paintSettings();
    }

    function setBpm(n) {
      bpm = clamp(Math.round(n), 40, 240);
      write(BPM_KEY, bpm);
      if (metroRunning) startMetro(); else paintMetro();
    }

    $('metro-toggle').addEventListener('click', () => (metroRunning ? stopMetro() : startMetro()));
    $('metro-pill').addEventListener('click', stopMetro);
    $('bpm-up').addEventListener('click', () => setBpm(bpm + 5));
    $('bpm-down').addEventListener('click', () => setBpm(bpm - 5));

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

    let wakeLock = null;

    async function lockScreen() {
      if (!keepAwake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch (e) {
        wakeLock = null;   // battery saver or no permission: the phone just sleeps as usual
      }
    }

    function releaseScreen() {
      if (wakeLock) wakeLock.release().catch(() => {});
      wakeLock = null;
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') lockScreen();
    });
    $('wake-row').hidden = !('wakeLock' in navigator);

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
    $('add').addEventListener('click', () => {
      if (EV.has(slug)) {
        if (!EV.remove(slug)) { toast('Tuhle přidal někdo jiný. Odebrat ji může zakladatel večera nebo parta.'); return; }
        toast('Odebráno z večera');
      } else {
        EV.add(slug);
        toast(EV.shared ? 'Přidáno do společného večera' : 'Přidáno do dnešního večera');
      }
      paintToggles();
      renderNext();
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

    EV.onChange(() => { if (song) { paintToggles(); if (!fromRandom) renderNext(); } });

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
    setDiagrams(read(DIAGRAMS_KEY, '0') === '1');
    lockScreen();
    setupPreview();

    SL.load()
      .then(() => {
        song = SL.bySlug(slug) || null;
        if (song && Array.isArray(song.progression) && song.progression.length) {
          setGroups(song.progression);
          renderChips();
          if (!$('diagrams').hidden) renderDiagrams();
        }
        paintToggles();
        renderNext();
        SL.recent.add(slug);
      })
      .catch(err => console.error('songs.json failed:', err));
  }
})();
