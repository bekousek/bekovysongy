/**
 * Prototyp stránky písně (test4/pisen.html?s=<slug>[&vecer=1 | &nahodne=1]).
 *
 * Renders any published song from its static page (songs/<slug>.html) in
 * the new layout, reusing the site's own song logic: js/sections.js for
 * refrén/bridge and folded repeats, js/chord-theory.js for transposition,
 * js/chords.js for the fingering diagrams, and the tuner lifted out of
 * js/player.js. New here:
 *   - fingerings of all the song's chords one tap away under the chord bar,
 *   - the screen stays on while the song is open,
 *   - with &vecer=1 the page walks through tonight's setlist, with
 *     &nahodne=1 (opened from Objevit) it offers the next random song,
 *   - a tap on the text pauses autoscroll; Space and page-turner pedals
 *     (PageDown / arrows) work on a keyboard.
 */
(function () {
  'use strict';

  const SL = window.SongList;
  const EV = window.Evening;
  const { transposeChord } = window.ChordTheory;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const slug = params.get('s') || '';
  const fromSetlist = params.get('vecer') === '1';
  const fromRandom = !fromSetlist && params.get('nahodne') === '1';
  const songUrl = (s, mode) => 'pisen.html?s=' + encodeURIComponent(s) + (mode ? '&' + mode + '=1' : '');

  // ---- remembered settings -----------------------------------------------

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* not remembered */ }
  }

  // Keys shared with the live song pages where the setting is the same one.
  const FONT_KEY = 'song_font_scale';
  const REPEATS_KEY = 'show_repeats';
  const COLUMNS_KEY = 'song_columns';
  const SPEED_KEY = 'bs_scroll_speed';
  const BPM_KEY = 'bs_bpm';
  const WAKE_KEY = 'bs_keep_awake';

  let fontScale = clamp(parseInt(read(FONT_KEY, '100'), 10) || 100, 70, 150);
  let showRepeats = read(REPEATS_KEY, 'off') === 'on';
  let columns = clamp(parseInt(read(COLUMNS_KEY, '1'), 10) || 1, 1, 3);
  let speed = clamp(parseInt(read(SPEED_KEY, '3'), 10) || 3, 1, 10);
  let bpm = clamp(parseInt(read(BPM_KEY, '120'), 10) || 120, 40, 240);
  let keepAwake = read(WAKE_KEY, '1') !== '0';
  let transpose = 0;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // ---- helpers -----------------------------------------------------------

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

  // ---- chord diagrams ----------------------------------------------------

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
    let left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
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

  // ---- song state --------------------------------------------------------

  let song = null;           // songs.json entry
  let html = '';
  let groups = [];
  const lyrics = $('lyrics');

  function renderLyrics() {
    // Repeats share their section key, so remember the opened ones by position.
    const peeked = Array.from(lyrics.querySelectorAll('.is-repeat'))
      .map((sec, i) => (sec.classList.contains('peek') ? i : -1)).filter(i => i !== -1);
    lyrics.innerHTML = html;
    lyrics.classList.toggle('show-repeats', showRepeats);
    lyrics.classList.toggle('cols-2', columns === 2);
    lyrics.classList.toggle('cols-3', columns === 3);
    $('page').classList.toggle('wide', columns > 1);
    // Keep the repeats someone opened by hand open across a re-render.
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
        const b = el('button', 'ch', name);
        b.type = 'button';
        b.dataset.chord = name;
        chips.appendChild(b);
      });
    });
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

  // ---- transpose ---------------------------------------------------------

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

  // ---- autoscroll --------------------------------------------------------

  // Same pace as the live pages: speed 1 is 4 px/s, speed 10 is 40 px/s.
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

  // ---- taps on the song --------------------------------------------------

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

    // Tapping the text while it scrolls is the quickest way to stop it with
    // a hand that just left the strings.
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
    if (e.target.closest('input, textarea, dialog[open]')) return;
    if (e.key === ' ' && !e.target.closest('button, a')) {
      e.preventDefault();
      scrolling ? stopScroll() : startScroll();
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

  // ---- fingerings strip --------------------------------------------------

  const DIAGRAMS_KEY = 'bs_show_diagrams';
  function setDiagrams(on) {
    $('diagrams').hidden = !on;
    $('diagrams-toggle').setAttribute('aria-pressed', on ? 'true' : 'false');
    write(DIAGRAMS_KEY, on ? '1' : '0');
    if (on) renderDiagrams();
  }
  $('diagrams-toggle').addEventListener('click', () => setDiagrams($('diagrams').hidden));

  // ---- settings sheet ----------------------------------------------------

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

  // The tuner (tuner.js) opens its own overlay from #tuner-toggle; the
  // sheet has to get out of the way, a modal dialog would sit above it.
  $('tuner-toggle').addEventListener('click', () => more.close());

  // ---- metronome ---------------------------------------------------------

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

  // ---- keep the screen on ------------------------------------------------

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

  // ---- preview -----------------------------------------------------------

  function setupPreview() {
    fetch('../song-previews-public.json')
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
      .catch(() => { /* offline or not deployed: no preview button */ });
  }

  // ---- favourite, tonight, setlist walk ----------------------------------

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
    const on = EV.toggle(slug);
    paintToggles();
    renderSetlistNav();
    toast(on ? (EV.shared ? 'Přidáno do společného večera' : 'Přidáno do dnešního večera') : 'Odebráno z večera');
  });

  function renderSetlistNav() {
    const list = EV.list();
    const i = list.indexOf(slug);
    const active = fromSetlist && i !== -1;
    $('setlist-pos').hidden = !active;
    $('next-top').hidden = true;
    $('next-card').hidden = true;
    $('prev-link').hidden = true;
    $('next-again').hidden = true;
    if (fromRandom) { renderNextRandom(); return; }
    if (!active) return;

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
  // the same filters the list had, never one of the last twenty drawn.
  let nextRandom = null;

  function randomPool() {
    const saved = SL.loadState('test4') || {};
    const pool = SL.query({ lang: saved.lang || '', capo: saved.capo || '', chords: new Set(saved.chords || []) }).named;
    return pool.filter(s => s.slug !== slug);
  }

  function drawNext() {
    nextRandom = SL.pickRandom(randomPool());
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

  EV.onChange(() => { if (song) { paintToggles(); if (!fromRandom) renderSetlistNav(); } });

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

  // ---- bug report --------------------------------------------------------

  $('report').addEventListener('click', () => {
    $('bug-song').textContent = song ? `${song.title} · ${song._authors.join(', ')}` : '';
    $('bug-text').value = '';
    $('bug').showModal();
    $('bug-text').focus();
  });
  $('bug-send').addEventListener('click', () => {
    const text = $('bug-text').value.trim();
    if (!text) { $('bug-text').focus(); return; }
    const title = song ? song.title : slug;
    const subject = encodeURIComponent(`Bug: ${title}`);
    const body = encodeURIComponent(`Píseň: ${title}\nURL: https://bekovysongy.cz/songs/${slug}.html\n\n${text}`);
    $('bug').close();
    location.href = `mailto:ondrejbek8@gmail.com?subject=${subject}&body=${body}`;
  });

  // ---- load --------------------------------------------------------------

  function fail(message) {
    lyrics.innerHTML = '';
    const box = el('div', 'state');
    box.appendChild(el('strong', null, 'Píseň se nenačetla'));
    box.appendChild(document.createTextNode(message + ' '));
    const a = el('a', null, 'Zpět na seznam');
    a.href = './';
    box.appendChild(a);
    lyrics.appendChild(box);
    $('title').textContent = 'Píseň nenalezena';
  }

  function boot() {
    document.querySelectorAll('[data-icon]').forEach(n => { n.innerHTML = SL.icon(n.dataset.icon); });
    applyFont();
    paintScroll();
    paintMetro();
    lyrics.innerHTML = '<span class="skeleton"><span class="bar" style="width:70%"></span><span class="bar" style="width:55%"></span><span class="bar" style="width:80%"></span><span class="bar" style="width:40%"></span></span>';

    if (!slug) { fail('V odkazu chybí, která píseň to má být.'); return; }

    const page = fetch('../songs/' + encodeURIComponent(slug) + '.html').then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });

    Promise.all([SL.load(), page])
      .then(([, text]) => {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const pre = doc.querySelector('pre.song-text');
        if (!pre) throw new Error('no song text');
        song = SL.bySlug(slug);

        const title = song ? song.title : (doc.querySelector('h1') || {}).textContent || slug;
        const authors = song ? song._authors : [((doc.querySelector('.song-author') || {}).textContent || '').trim()];
        const capoEl = doc.querySelector('.song-capo');
        document.title = `${title} - Bekovy songy`;
        $('title').textContent = title;
        $('artist').textContent = authors.filter(Boolean).join(', ');
        const capo = capoEl ? capoEl.textContent.trim() : (song && song._capo) || '';
        $('capo').hidden = !capo;
        $('capo').textContent = capo;

        const raw = pre.innerHTML.replace(/class="chord"/g, 'class="ch"');
        const sectioned = window.SongSections ? SongSections.transform(raw) : raw;
        html = sectioned;
        $('repeats-row').hidden = !/is-repeat/.test(sectioned);

        const prog = song && Array.isArray(song.progression) && song.progression.length
          ? song.progression
          : (window.SongSections ? SongSections.deriveProgression(raw) : []);
        groups = prog.map(dedupe).filter(g => g.length);

        renderChips();
        renderLyrics();
        setDiagrams(read(DIAGRAMS_KEY, '0') === '1');
        paintToggles();
        renderSetlistNav();
        setupPreview();
        lockScreen();
        SL.recent.add(slug);
      })
      .catch(err => {
        console.error(err);
        fail('Možná je špatně odkaz, nebo jsi offline a tahle píseň ještě není stažená.');
      });
  }

  boot();
})();
