/**
 * player.js - Transpose, autoscroll, metronome, tuner
 */
(function () {
  'use strict';

  // Register the offline service worker. Every song page is exactly one
  // directory deep, so "../sw.js" (which lives at the site root) is always
  // the right relative path here regardless of hosting subpath vs. root.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('../sw.js'));
  }

  // === Sections (refrén / sloka / bridge) + repeats toggle ===
  // Wrap the song text into labelled, indented sections and add a player-bar
  // toggle that reveals/hides repeated parts (all but the first occurrence).
  const REPEATS_KEY = 'show_repeats';

  function buildSections() {
    const pre = document.querySelector('.song-text');
    if (!pre || !window.SongSections) return;
    if (!SongSections.hasSections(pre.innerHTML)) return; // plain song, leave as-is

    pre.innerHTML = SongSections.transform(pre.innerHTML);

    const showRepeats = localStorage.getItem(REPEATS_KEY) === 'on';
    pre.classList.toggle('show-repeats', showRepeats);

    bindRepeatPeek(pre);
    injectRepeatsToggle(pre, showRepeats);
  }

  // Collapsed repeats render as pills; tapping one peeks at just that
  // occurrence (the player-bar toggle still expands them all at once).
  function bindRepeatPeek(pre) {
    pre.querySelectorAll('.is-repeat .section-head').forEach((head) => {
      head.setAttribute('role', 'button');
      head.tabIndex = 0;
      head.title = 'Rozbalit / sbalit opakování';
      head.setAttribute('aria-expanded', 'false');
    });

    const togglePeek = (head) => {
      const sec = head.closest('.is-repeat');
      const on = sec.classList.toggle('peek');
      head.setAttribute('aria-expanded', String(on));
    };
    pre.addEventListener('click', (e) => {
      const head = e.target.closest('.is-repeat .section-head');
      if (head && !pre.classList.contains('show-repeats')) togglePeek(head);
    });
    pre.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const head = e.target.closest('.is-repeat .section-head');
      if (head && !pre.classList.contains('show-repeats')) {
        e.preventDefault();
        togglePeek(head);
      }
    });
  }

  function injectRepeatsToggle(pre, showRepeats) {
    const bar = document.getElementById('player-bar');
    if (!bar) return;

    const section = document.createElement('div');
    section.className = 'player-section player-repeats';
    section.innerHTML =
      '<button class="btn-player" id="repeats-toggle" title="Zobrazit opakování" aria-label="Zobrazit opakování">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">' +
      '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>' +
      '<polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>' +
      '</button><span class="player-label">Opakování</span>';
    // Place it as the first control on the bar.
    bar.insertBefore(section, bar.firstChild);

    const btn = section.querySelector('#repeats-toggle');
    btn.classList.toggle('active', showRepeats);
    btn.addEventListener('click', () => {
      const on = !pre.classList.contains('show-repeats');
      pre.classList.toggle('show-repeats', on);
      btn.classList.toggle('active', on);
      localStorage.setItem(REPEATS_KEY, on ? 'on' : 'off');
    });
  }

  // === Mobile chord bar (sticky top bar replacing the hidden nav) ===
  // Injected at runtime so the ~570 static song pages don't need editing.
  // Chords are grouped by section - songs.json's "progression" field, with a
  // separator chip between groups - instead of one flat deduped list, so the
  // bar reads like "G C Emi │ Ami C G D │ F B Dmi". The bar's skeleton (back
  // arrow + empty chip strip) is built synchronously so it never waits on
  // the songs.json fetch below; chips are filled in once the progression is
  // known, falling back to deriving it straight from the song's own text
  // (rawBody, captured before buildSections() rewrites the <pre>) if the
  // fetch fails or songs.json has no progression for this song yet.
  function buildChordBar(rawBody) {
    const main = document.querySelector('main.song-page');
    if (!main) return;

    const bar = document.createElement('div');
    bar.className = 'chord-bar';

    // Back arrow: real <a> so it degrades to plain ../ navigation; history.back()
    // only when we verifiably arrived from this site (preserves list scroll and
    // filter state). Song pages are always exactly one directory deep, so ../ is
    // the site root (same invariant as the sw.js registration above).
    const back = document.createElement('a');
    back.className = 'chord-bar-back';
    back.href = '../';
    back.setAttribute('aria-label', 'Zpět na seznam písní');
    back.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
      'stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
    back.addEventListener('click', (e) => {
      let fromSite = false;
      try {
        fromSite = !!document.referrer &&
          new URL(document.referrer).origin === location.origin;
      } catch (err) { /* malformed referrer -> plain navigation */ }
      if (fromSite && history.length > 1) {
        e.preventDefault();
        history.back();
      }
    });
    bar.appendChild(back);

    const chips = document.createElement('div');
    chips.className = 'chord-bar-chips';
    bar.appendChild(chips);

    document.body.insertBefore(bar, main);
    document.body.classList.add('has-chord-bar');

    function renderGroups(groups) {
      chips.innerHTML = '';
      let any = false;
      groups.forEach((group, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'chord-bar-sep';
          sep.setAttribute('aria-hidden', 'true');
          chips.appendChild(sep);
        }
        group.forEach((name) => {
          if (!name) return;
          any = true;
          const chip = document.createElement('span');
          chip.className = 'chord';          // opts into transpose + tooltip
          chip.dataset.chord = name;
          chip.textContent = name;
          chips.appendChild(chip);
        });
      });
      chips.style.display = any ? '' : 'none';

      // The chips above never went through applyTranspose() - refresh them
      // from the currently active offset so they don't show root chords
      // while the rest of the song is already transposed. currentTranspose/
      // applyTranspose are declared further down this IIFE, but this always
      // runs from the fetch callback below, i.e. after the whole IIFE (incl.
      // those declarations) has finished its synchronous run.
      if (currentTranspose !== 0) applyTranspose(0);
    }

    // Song pages are always ".../songs/<slug>.html".
    const slug = location.pathname.split('/').pop().replace(/\.html$/, '');

    fetch('../songs.json')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((data) => {
        const entry = (data.songs || []).find((s) => s.slug === slug);
        const prog = entry && Array.isArray(entry.progression) && entry.progression.length
          ? entry.progression
          : (window.SongSections ? SongSections.deriveProgression(rawBody) : []);
        renderGroups(prog);
      })
      .catch(() => {
        renderGroups(window.SongSections ? SongSections.deriveProgression(rawBody) : []);
      });
  }

  // === "More" (⋯) overflow menu ===
  // The static player bar ships with .player-metronome/.player-tuner/
  // .player-bug (and, from here, a new .player-fontsize) as top-level
  // sections; on narrow screens there isn't room to keep all of them inline
  // and still fit the bar on one row. Rather than duplicate markup for two
  // layouts, this moves those sections into a collapsible panel appended at
  // the end of the bar - CSS then decides with `display: contents` whether
  // the panel is an invisible wrapper (desktop: sections look exactly like
  // today, plus the new font-size control) or an actual dropdown (mobile).
  // Must run before the handler-wiring code below, which finds its buttons
  // via getElementById - unaffected by which parent they live under, so
  // moving the nodes here first is safe.
  function buildMoreMenu() {
    const bar = document.getElementById('player-bar');
    if (!bar) return;

    const more = document.createElement('div');
    more.className = 'player-section player-more';
    more.innerHTML =
      '<button class="btn-player" id="more-toggle" aria-label="Další nástroje" ' +
      'title="Další nástroje" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>' +
      '</button>' +
      '<div class="player-more-panel" id="more-panel"></div>';
    bar.appendChild(more);

    const toggle = more.querySelector('#more-toggle');
    const panel = more.querySelector('#more-panel');

    // New font-size control (behaviour wired up further down, once
    // #font-dec/#font-value/#font-inc exist) - built here so it can take
    // its place as the panel's first section.
    const fontSize = document.createElement('div');
    fontSize.className = 'player-section player-fontsize';
    fontSize.innerHTML =
      '<span class="player-label">Velikost textu</span>' +
      '<button class="btn-transpose" id="font-dec" aria-label="Zmenšit text" title="Zmenšit text">A−</button>' +
      '<span id="font-value">100 %</span>' +
      '<button class="btn-transpose" id="font-inc" aria-label="Zvětšit text" title="Zvětšit text">A+</button>';
    panel.appendChild(fontSize);

    // Move the existing sections in after it, in order, labelling each one
    // (they only ever had an icon + control before - fine inline, but a
    // stacked panel row needs the label to stay legible).
    [
      ['player-metronome', 'Metronom'],
      ['player-tuner', 'Ladička'],
      ['player-bug', 'Nahlásit chybu']
    ].forEach(([cls, labelText]) => {
      const section = bar.querySelector('.' + cls);
      if (!section) return;
      if (!section.querySelector('.player-label')) {
        const label = document.createElement('span');
        label.className = 'player-label';
        label.textContent = labelText;
        section.insertBefore(label, section.firstChild);
      }
      panel.appendChild(section);
    });

    // Open/close - same dropdown pattern as the chord filter on the song
    // list (js/table.js's #chord-filter-btn / .chord-filter-dropdown).
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.player-more')) {
        panel.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) {
        panel.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    // Tuner and bug-report open their own fullscreen overlay on top of
    // everything - close the panel so it doesn't linger behind it. BPM and
    // font-size are meant to be adjusted with the panel still open, so
    // clicks there (and everywhere else in the panel) leave it be.
    panel.addEventListener('click', (e) => {
      if (e.target.closest('#tuner-toggle') || e.target.closest('.player-bug')) {
        panel.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Raw markup of the song text, captured before buildSections() below
  // transforms it (it rewrites the <pre>'s innerHTML into labelled section
  // markup, destroying the original marker text) - buildChordBar's fallback
  // deriver needs the pristine version.
  const songTextEl = document.querySelector('.song-text');
  const rawSongBody = songTextEl ? songTextEl.innerHTML : '';

  buildSections();
  buildChordBar(rawSongBody);
  buildMoreMenu();

  // Chord parsing/transposition lives in chord-theory.js (shared with the
  // editor's song-cleanup.js), loaded before this script.
  const { transposeChord } = window.ChordTheory;

  // === Transpose ===
  let currentTranspose = 0;
  const transposeUp = document.getElementById('transpose-up');
  const transposeDown = document.getElementById('transpose-down');
  const transposeValue = document.getElementById('transpose-value');

  function applyTranspose(delta) {
    currentTranspose += delta;
    transposeValue.textContent = (currentTranspose >= 0 ? '+' : '') + currentTranspose;

    document.querySelectorAll('.chord').forEach(el => {
      const original = el.dataset.chord;
      if (!original) return;
      const transposed = transposeChord(original, currentTranspose);
      el.textContent = transposed;
      // Update data attribute for chord diagram lookup
      el.dataset.display = transposed;
    });
  }

  if (transposeUp) {
    transposeUp.addEventListener('click', () => applyTranspose(1));
  }
  if (transposeDown) {
    transposeDown.addEventListener('click', () => applyTranspose(-1));
  }

  // === Font size ===
  // Independent of transpose; applied as a CSS custom property so
  // .song-text (and its <=768px override) can scale off of it without JS
  // touching every line of the song. #font-dec/#font-value/#font-inc live
  // inside the panel buildMoreMenu() just built.
  const FONT_SCALE_KEY = 'song_font_scale';
  const FONT_SCALE_MIN = 70;
  const FONT_SCALE_MAX = 150;
  const FONT_SCALE_STEP = 10;
  const fontDec = document.getElementById('font-dec');
  const fontInc = document.getElementById('font-inc');
  const fontValue = document.getElementById('font-value');

  function loadFontScale() {
    const saved = parseInt(localStorage.getItem(FONT_SCALE_KEY), 10);
    if (!saved || saved < FONT_SCALE_MIN || saved > FONT_SCALE_MAX) return 100;
    return saved;
  }

  let fontScale = loadFontScale();

  function applyFontScale() {
    document.documentElement.style.setProperty('--song-font-scale', fontScale / 100);
    if (fontValue) fontValue.textContent = fontScale + ' %';
  }

  function setFontScale(next) {
    fontScale = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, next));
    localStorage.setItem(FONT_SCALE_KEY, String(fontScale));
    applyFontScale();
  }

  applyFontScale(); // apply immediately (before first paint) so the text never jumps

  if (fontDec) fontDec.addEventListener('click', () => setFontScale(fontScale - FONT_SCALE_STEP));
  if (fontInc) fontInc.addEventListener('click', () => setFontScale(fontScale + FONT_SCALE_STEP));

  // === Autoscroll ===
  let scrollInterval = null;
  const scrollToggle = document.getElementById('scroll-toggle');
  const scrollSpeed = document.getElementById('scroll-speed');

  function startScroll() {
    stopScroll();
    const speed = parseInt(scrollSpeed.value) || 3;
    // speed 1 = 0.4px/100ms (very slow), speed 10 = 4px/100ms
    scrollInterval = setInterval(() => {
      window.scrollBy(0, speed * 0.4);
      // Stop at bottom
      if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight) {
        stopScroll();
      }
    }, 100);
    scrollToggle.classList.add('active');
  }

  function stopScroll() {
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
    if (scrollToggle) scrollToggle.classList.remove('active');
  }

  if (scrollToggle) {
    scrollToggle.addEventListener('click', () => {
      if (scrollInterval) stopScroll();
      else startScroll();
    });
  }

  if (scrollSpeed) {
    scrollSpeed.addEventListener('input', () => {
      if (scrollInterval) {
        startScroll(); // restart with new speed
      }
    });
  }

  // === Metronome ===
  let metronomeCtx = null;
  let metronomeInterval = null;
  let metronomeRunning = false;
  const metronomeToggle = document.getElementById('metronome-toggle');
  const bpmInput = document.getElementById('bpm-input');
  // Metronome lives inside the ⋯ panel on mobile, where a running state
  // would otherwise be invisible until the panel is opened - mirror it onto
  // the toggle itself.
  const moreToggle = document.getElementById('more-toggle');

  function playClick() {
    if (!metronomeCtx) metronomeCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = metronomeCtx.createOscillator();
    const gain = metronomeCtx.createGain();
    osc.connect(gain);
    gain.connect(metronomeCtx.destination);
    osc.frequency.value = 880;
    osc.type = 'square';
    gain.gain.setValueAtTime(0.3, metronomeCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, metronomeCtx.currentTime + 0.05);
    osc.start(metronomeCtx.currentTime);
    osc.stop(metronomeCtx.currentTime + 0.05);
  }

  function startMetronome() {
    stopMetronome();
    const bpm = Math.max(40, Math.min(240, parseInt(bpmInput.value) || 120));
    bpmInput.value = bpm;
    const interval = 60000 / bpm;
    playClick(); // immediate first click
    metronomeInterval = setInterval(playClick, interval);
    metronomeRunning = true;
    metronomeToggle.classList.add('active');
    if (moreToggle) moreToggle.classList.add('has-active');
  }

  function stopMetronome() {
    if (metronomeInterval) {
      clearInterval(metronomeInterval);
      metronomeInterval = null;
    }
    metronomeRunning = false;
    if (metronomeToggle) metronomeToggle.classList.remove('active');
    if (moreToggle) moreToggle.classList.remove('has-active');
  }

  if (metronomeToggle) {
    metronomeToggle.addEventListener('click', () => {
      if (metronomeRunning) stopMetronome();
      else startMetronome();
    });
  }

  if (bpmInput) {
    bpmInput.addEventListener('change', () => {
      if (metronomeRunning) startMetronome();
    });
  }

  // === Tuner (fullscreen overlay, guitar + ukulele) ===
  // Clicking the player-bar button opens a large, distraction-free overlay so
  // you can tune without the song/chords in the way. It shows the target
  // string, a live needle for how far off you are, and clickable reference
  // tones. All the UI is built here in JS so no per-song HTML changes are
  // needed (every page already ships the #tuner-toggle button).
  const tunerToggle = document.getElementById('tuner-toggle');

  // Tuning constants for the MPM pitch detector and the temporal
  // stabilization state machine below (see updateTuner). Keeping every
  // magic number in one place makes the "feel" easy to retune.
  const TUNER_CFG = {
    FREQ_MIN: 60, FREQ_MAX: 600,      // detection band (E2=82.4 … A4=440 + headroom)
    HP_FREQ: 60, LP_FREQ: 1000,       // biquad pre-filters
    DETECT_MS: 40,                    // detection cadence (~25 Hz, not every rAF)
    RMS_MIN: 0.008,                   // silence gate
    MPM_K: 0.93,                      // first-peak tolerance (0.8–1.0)
    CLARITY_MIN: 0.90,                // reject frames below this periodicity
    MEDIAN_N: 5, HISTORY_N: 8,        // pitch history ring buffer
    STABLE_N: 3,                      // accepted frames within ±50 cents before first display
    SWITCH_N: 6,                      // consecutive frames on another string to re-lock
    INTUNE_CENTS: 5,                  // |cents| ≤ this counts as in tune
    INTUNE_HOLD_MS: 700,              // hold in tune this long → string ✓
    DISPLAY_HOLD_MS: 1500,            // keep last reading through silence
    EMA_ALPHA: 0.3,                   // needle smoothing
    MANUAL_LOCK_MS: 8000,             // chip tap = manual target lock duration
  };

  const TUNER_INSTRUMENTS = {
    guitar: {
      label: 'Kytara',
      // Standard tuning, low to high (Czech note names: H = B).
      strings: [
        { name: 'E', oct: '2', midi: 40 },
        { name: 'A', oct: '2', midi: 45 },
        { name: 'D', oct: '3', midi: 50 },
        { name: 'G', oct: '3', midi: 55 },
        { name: 'H', oct: '3', midi: 59 },
        { name: 'E', oct: '4', midi: 64 },
      ],
    },
    ukulele: {
      label: 'Ukulele',
      // Standard GCEA (reentrant high-G).
      strings: [
        { name: 'G', oct: '4', midi: 67 },
        { name: 'C', oct: '4', midi: 60 },
        { name: 'E', oct: '4', midi: 64 },
        { name: 'A', oct: '4', midi: 69 },
      ],
    },
  };
  const TUNER_INST_KEY = 'tuner_instrument';

  function freqFromMidi(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // MPM (McLeod Pitch Method) pitch detection via NSDF, restricted to the
  // instrument frequency band. Picking the *first* peak that clears MPM_K of
  // the global max (rather than just the tallest peak) is what kills
  // octave-up errors on harmonically rich signals. Returns { freq, clarity }
  // or null when nothing periodic enough was found (silence or noise).
  function detectPitch(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < TUNER_CFG.RMS_MIN) return null; // too quiet

    const minLag = Math.max(1, Math.floor(sampleRate / TUNER_CFG.FREQ_MAX));
    const maxLag = Math.min(Math.ceil(sampleRate / TUNER_CFG.FREQ_MIN), SIZE - 1);
    if (maxLag <= minLag) return null;

    // NSDF (normalized square difference function), lags minLag..maxLag only
    // - we don't care about periodicity outside the instrument band.
    const nsdf = new Float32Array(maxLag + 1);
    for (let tau = minLag; tau <= maxLag; tau++) {
      let acf = 0, energy = 0;
      const n = SIZE - tau;
      for (let i = 0; i < n; i++) {
        const a = buf[i], b = buf[i + tau];
        acf += a * b;
        energy += a * a + b * b;
      }
      nsdf[tau] = energy > 0 ? (2 * acf) / energy : 0;
    }

    // MPM peak picking: skip the initial descent from lag 0, then collect
    // every local maximum (parabolic-interpolated) from there on.
    let tau = minLag;
    while (tau <= maxLag && nsdf[tau] > 0) tau++;
    const maxima = [];
    for (; tau < maxLag; tau++) {
      if (nsdf[tau] > nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1]) {
        const x1 = nsdf[tau - 1], x2 = nsdf[tau], x3 = nsdf[tau + 1];
        const a = (x1 + x3 - 2 * x2) / 2;
        const b = (x3 - x1) / 2;
        let interpLag = tau, interpVal = x2;
        if (a) {
          interpLag = tau - b / (2 * a);
          interpVal = x2 - (b * b) / (4 * a);
        }
        maxima.push({ lag: interpLag, value: interpVal });
      }
    }
    if (!maxima.length) return null;

    let globalMax = -Infinity;
    for (const m of maxima) if (m.value > globalMax) globalMax = m.value;
    if (globalMax <= 0) return null;

    let chosen = null;
    for (const m of maxima) {
      if (m.value >= TUNER_CFG.MPM_K * globalMax) { chosen = m; break; }
    }
    if (!chosen || chosen.lag <= 0) return null;

    const clarity = Math.min(1, chosen.value);
    if (clarity < TUNER_CFG.CLARITY_MIN) return null;

    const freq = sampleRate / chosen.lag;
    if (freq < TUNER_CFG.FREQ_MIN || freq > TUNER_CFG.FREQ_MAX) return null;
    return { freq, clarity };
  }

  // Median of a small array (used for the pitch-history smoothing window).
  function median(arr) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Which string (by index into the current instrument's strings array) is
  // closest to a given MIDI-float pitch.
  function nearestStringIndex(midiFloat, strings) {
    let best = 0, bestDist = Infinity;
    strings.forEach((s, i) => {
      const dist = Math.abs(midiFloat - s.midi);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }

  // --- Tuner state ---
  let T = null;                 // built DOM references (lazy, first open)
  let tunerCtx = null, tunerAnalyser = null, tunerStream = null;
  let tunerRunning = false, tunerAnimFrame = null;
  let toneCtx = null;           // for reference-tone / confirmation-blip playback
  let smoothCents = 0;          // smoothed needle position (EMA)
  let tunerInstrument = TUNER_INSTRUMENTS[localStorage.getItem(TUNER_INST_KEY)]
    ? localStorage.getItem(TUNER_INST_KEY) : 'guitar';

  // --- Stabilization state (tuning knobs live in TUNER_CFG above) ---
  let tunerBuf = null;          // reused Float32Array(fftSize) - no per-frame GC churn
  let pitchHist = [];           // ring buffer of recent accepted pitches (MIDI float)
  let lockedStringIdx = null;   // index into the current instrument's strings, or null
  let switchCount = 0;          // consecutive frames pointing at switchCandidate
  let switchCandidate = null;   // string index switchCount is counting toward
  let inTuneSince = 0;          // timestamp the needle first settled in-tune; 0 = not currently
  let lastAcceptedAt = 0;       // timestamp of the last accepted (non-null) detection
  let manualLockUntil = 0;      // timestamp until which the target string is pinned by a chip tap
  let tunedStrings = new Set(); // string indices confirmed with ✓ this session
  let lastDetectTime = 0;       // throttles detection to TUNER_CFG.DETECT_MS
  let toneUntil = 0;            // timestamp until which our own tone/blip may still be ringing

  // Reset the stabilization state machine (fresh mic session or instrument
  // switch - either way, any in-progress lock/history is no longer valid).
  function resetTunerDetectionState() {
    pitchHist = [];
    lockedStringIdx = null;
    switchCount = 0;
    switchCandidate = null;
    inTuneSince = 0;
    lastAcceptedAt = 0;
    manualLockUntil = 0;
    smoothCents = 0;
    toneUntil = 0;
    lastDetectTime = 0;
    if (T) T.stringEls.forEach(el => el.classList.remove('manual', 'near', 'tuned'));
  }

  // Clear the persistent per-string ✓ confirmations (new session / instrument
  // switch - a ✓ earned on one instrument's strings means nothing on another's).
  function resetTunedStrings() {
    tunedStrings.clear();
    if (T) T.stringEls.forEach(el => el.classList.remove('done'));
  }

  function buildTunerOverlay() {
    if (T) return;
    const overlay = document.createElement('div');
    overlay.className = 'tuner-overlay';
    overlay.innerHTML = `
      <div class="tuner-modal" role="dialog" aria-label="Ladička">
        <div class="tuner-head">
          <div class="tuner-instruments">
            <button type="button" data-inst="guitar">Kytara</button>
            <button type="button" data-inst="ukulele">Ukulele</button>
          </div>
          <button type="button" class="tuner-close" aria-label="Zavřít ladičku">✕</button>
        </div>
        <div class="tuner-note"><span class="tuner-note-name">–</span><span class="tuner-note-oct"></span></div>
        <div class="tuner-status">Zahraj strunu…</div>
        <div class="tuner-meter">
          <div class="tuner-meter-scale"><span>♭ nízko</span><span>0</span><span>vysoko ♯</span></div>
          <div class="tuner-meter-track">
            <div class="tuner-meter-zone"></div>
            <div class="tuner-meter-center"></div>
            <div class="tuner-meter-needle"></div>
          </div>
          <div class="tuner-cents"></div>
        </div>
        <div class="tuner-strings"></div>
        <p class="tuner-error"></p>
        <p class="tuner-hint">Klepni na strunu pro přehrání tónu, pak zahraj tu samou strunu na nástroji — ručička ukáže, jestli je moc nízko, nebo vysoko.</p>
      </div>`;
    document.body.appendChild(overlay);

    T = {
      overlay,
      note: overlay.querySelector('.tuner-note'),
      noteName: overlay.querySelector('.tuner-note-name'),
      noteOct: overlay.querySelector('.tuner-note-oct'),
      status: overlay.querySelector('.tuner-status'),
      needle: overlay.querySelector('.tuner-meter-needle'),
      cents: overlay.querySelector('.tuner-cents'),
      strings: overlay.querySelector('.tuner-strings'),
      error: overlay.querySelector('.tuner-error'),
      instBtns: overlay.querySelectorAll('.tuner-instruments button'),
      stringEls: [],
    };
    T.error.style.display = 'none';

    overlay.querySelector('.tuner-close').addEventListener('click', closeTuner);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTuner(); });
    T.instBtns.forEach(b => b.addEventListener('click', () => setInstrument(b.dataset.inst)));

    setInstrument(tunerInstrument);
  }

  function setInstrument(inst) {
    if (!TUNER_INSTRUMENTS[inst]) inst = 'guitar';
    tunerInstrument = inst;
    localStorage.setItem(TUNER_INST_KEY, inst);
    T.instBtns.forEach(b => b.classList.toggle('active', b.dataset.inst === inst));
    renderStrings();
    // A locked string index / ✓ set from one instrument means nothing once
    // the string list underneath it changes.
    resetTunerDetectionState();
    resetTunedStrings();
  }

  function renderStrings() {
    T.strings.innerHTML = '';
    T.stringEls = [];
    TUNER_INSTRUMENTS[tunerInstrument].strings.forEach((s, idx) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tuner-string';
      el.innerHTML = `${s.name}<small>${s.oct}</small>`;
      el.addEventListener('click', () => {
        playReference(s.midi);
        // Tapping a chip pins it as the detection target for a while, so a
        // player who already knows which string they're about to tune isn't
        // at the mercy of the auto-detected nearest-string guess.
        manualLockUntil = performance.now() + TUNER_CFG.MANUAL_LOCK_MS;
        lockedStringIdx = idx;
        switchCount = 0;
        switchCandidate = null;
        inTuneSince = 0;
        T.stringEls.forEach((el2, i2) => el2.classList.toggle('manual', i2 === idx));
      });
      T.strings.appendChild(el);
      T.stringEls.push(el);
    });
  }

  function clearStringHighlight() {
    T.stringEls.forEach(el => el.classList.remove('near', 'tuned'));
  }

  function highlightString(idx, inTune) {
    T.stringEls.forEach((el, i) => {
      el.classList.toggle('near', i === idx && !inTune);
      el.classList.toggle('tuned', i === idx && inTune);
    });
  }

  // Play a short reference tone for a tapped string.
  function playReference(midi) {
    try {
      if (!toneCtx) toneCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (toneCtx.state === 'suspended') toneCtx.resume();
      const now = toneCtx.currentTime;
      const osc = toneCtx.createOscillator();
      const gain = toneCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freqFromMidi(midi);
      osc.connect(gain);
      gain.connect(toneCtx.destination);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
      osc.start(now);
      osc.stop(now + 1.7);
      // Self-hearing guard: don't let the mic pick up our own reference tone
      // and mistake it for the string being tuned.
      toneUntil = performance.now() + 1700;
    } catch (e) { /* ignore audio errors */ }
  }

  // Short two-note confirmation "ding" played once a string settles in tune
  // long enough to earn its persistent ✓.
  function playConfirmationBlip() {
    try {
      if (!toneCtx) toneCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (toneCtx.state === 'suspended') toneCtx.resume();
      const now = toneCtx.currentTime;
      [[0, 880], [0.1, 1318.51]].forEach(([offset, freq]) => {
        const osc = toneCtx.createOscillator();
        const gain = toneCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(toneCtx.destination);
        const t0 = now + offset;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
        osc.start(t0);
        osc.stop(t0 + 0.1);
      });
      // Same self-hearing guard as the reference tone, just shorter.
      toneUntil = performance.now() + 200;
    } catch (e) { /* ignore audio errors */ }
  }

  // Runs every rAF, but the actual detection work only happens every
  // TUNER_CFG.DETECT_MS - detection is the expensive part (NSDF over ~720
  // lags), the needle just rides along on whatever was last computed.
  function updateTuner() {
    if (!tunerRunning) return;
    const now = performance.now();
    if (now - lastDetectTime < TUNER_CFG.DETECT_MS) {
      tunerAnimFrame = requestAnimationFrame(updateTuner);
      return;
    }
    lastDetectTime = now;

    // Manual lock expiry is independent of mic activity, so check it every tick.
    if (manualLockUntil && now >= manualLockUntil) {
      manualLockUntil = 0;
      T.stringEls.forEach(el => el.classList.remove('manual'));
    }

    // Self-hearing guard: while our own reference tone / confirmation blip
    // is still ringing out, skip detection so the mic can't hear itself and
    // falsely confirm a string as in tune.
    let result = null;
    if (now >= toneUntil) {
      tunerAnalyser.getFloatTimeDomainData(tunerBuf);
      result = detectPitch(tunerBuf, tunerCtx.sampleRate);
    }

    if (result) {
      lastAcceptedAt = now;
      const midiFloat = 69 + 12 * Math.log2(result.freq / 440);
      pitchHist.push(midiFloat);
      if (pitchHist.length > TUNER_CFG.HISTORY_N) pitchHist.shift();

      // Display gate: only trust the reading once the last STABLE_N accepted
      // values agree with each other - kills single-frame flicker before it
      // ever reaches the screen.
      let stable = false;
      if (pitchHist.length >= TUNER_CFG.STABLE_N) {
        const recent = pitchHist.slice(-TUNER_CFG.STABLE_N);
        const med = median(recent);
        stable = recent.every((v) => Math.abs(v - med) <= 0.5);
      }

      if (stable) {
        T.note.classList.remove('stale');

        const med = median(pitchHist.slice(-TUNER_CFG.MEDIAN_N));
        const strings = TUNER_INSTRUMENTS[tunerInstrument].strings;

        // Target string: a manual pin (chip tap) wins outright. Otherwise
        // the nearest string wins, but only after SWITCH_N consecutive
        // frames agree - this hysteresis is what stops the target flipping
        // frame-to-frame near a string boundary in noise.
        let targetIdx;
        if (manualLockUntil > now) {
          targetIdx = lockedStringIdx;
        } else {
          const nearest = nearestStringIndex(med, strings);
          if (lockedStringIdx === null) {
            lockedStringIdx = nearest;
            switchCount = 0;
            switchCandidate = null;
          } else if (nearest !== lockedStringIdx) {
            if (nearest === switchCandidate) switchCount++;
            else { switchCandidate = nearest; switchCount = 1; }
            if (switchCount >= TUNER_CFG.SWITCH_N) {
              lockedStringIdx = nearest;
              switchCount = 0;
              switchCandidate = null;
              inTuneSince = 0;
              smoothCents = 0;
            }
            // else: keep displaying the currently locked string.
          } else {
            switchCount = 0;
            switchCandidate = null;
          }
          targetIdx = lockedStringIdx;
        }

        const s = strings[targetIdx];
        const cents = (med - s.midi) * 100;
        smoothCents += (cents - smoothCents) * TUNER_CFG.EMA_ALPHA;
        const shown = smoothCents;
        const inTune = Math.abs(shown) <= TUNER_CFG.INTUNE_CENTS;
        const rounded = Math.round(shown);

        T.noteName.textContent = s.name;
        T.noteOct.textContent = s.oct;
        T.note.classList.toggle('tuned', inTune);

        const clamped = Math.max(-50, Math.min(50, shown));
        T.needle.style.left = (clamped + 50) + '%';
        T.needle.classList.toggle('tuned', inTune);

        if (inTune) {
          T.status.className = 'tuner-status tuned';
          T.status.textContent = '✓ Naladěno';
          T.cents.textContent = '0 centů';
        } else if (shown < 0) {
          T.status.className = 'tuner-status off';
          T.status.textContent = '♭ Nízko — utáhni strunu';
          T.cents.textContent = rounded + ' centů';
        } else {
          T.status.className = 'tuner-status off';
          T.status.textContent = '♯ Vysoko — povol strunu';
          T.cents.textContent = '+' + rounded + ' centů';
        }

        highlightString(targetIdx, inTune);

        // Hold in tune for INTUNE_HOLD_MS -> permanent per-string checkmark
        // (GuitarTuna-style progress across all strings). Leaving tune resets
        // the hold timer but never takes back an earned ✓.
        if (inTune) {
          if (!inTuneSince) inTuneSince = now;
          if (now - inTuneSince >= TUNER_CFG.INTUNE_HOLD_MS && !tunedStrings.has(targetIdx)) {
            tunedStrings.add(targetIdx);
            if (T.stringEls[targetIdx]) T.stringEls[targetIdx].classList.add('done');
            playConfirmationBlip();
          }
        } else {
          inTuneSince = 0;
        }
      }
      // else: not stable yet - keep whatever is currently displayed.
    } else if (now - lastAcceptedAt < TUNER_CFG.DISPLAY_HOLD_MS) {
      // Rejected frame (silence, noise, or the self-hearing guard), but we
      // had a real reading recently - hold the display instead of flickering
      // back to idle between plucks.
      T.note.classList.add('stale');
    } else {
      // Extended silence - reset to idle.
      T.note.classList.remove('stale', 'tuned');
      T.status.className = 'tuner-status';
      T.status.textContent = 'Zahraj strunu…';
      T.noteName.textContent = '–';
      T.noteOct.textContent = '';
      T.cents.textContent = '';
      T.needle.classList.remove('tuned');
      T.needle.style.left = '50%';
      clearStringHighlight();
      smoothCents = 0;
      pitchHist = [];
      inTuneSince = 0;
      // A manual pin survives silence - it only clears on expiry or another tap.
      if (!(manualLockUntil > now)) {
        lockedStringIdx = null;
        switchCount = 0;
        switchCandidate = null;
      }
    }

    tunerAnimFrame = requestAnimationFrame(updateTuner);
  }

  async function startTuner() {
    T.error.style.display = 'none';
    T.error.textContent = '';
    T.status.className = 'tuner-status';
    T.status.textContent = 'Povol přístup k mikrofonu…';
    try {
      tunerCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (tunerCtx.state === 'suspended') await tunerCtx.resume();
      // Turn off browser processing that would distort the pitch.
      tunerStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const source = tunerCtx.createMediaStreamSource(tunerStream);
      // Band-pass the mic signal to the instrument range before detection -
      // strips most ambient/room noise so the NSDF has a cleaner signal to
      // work with. 1 kHz top end still keeps the 2nd/3rd harmonics MPM wants.
      const highpass = tunerCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = TUNER_CFG.HP_FREQ;
      highpass.Q.value = 0.707;
      const lowpass = tunerCtx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = TUNER_CFG.LP_FREQ;
      lowpass.Q.value = 0.707;
      tunerAnalyser = tunerCtx.createAnalyser();
      tunerAnalyser.fftSize = 4096; // larger window = steadier low strings (E2)
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(tunerAnalyser);
      tunerBuf = new Float32Array(tunerAnalyser.fftSize); // allocated once, reused every frame
      resetTunerDetectionState();
      tunerRunning = true;
      T.status.textContent = 'Zahraj strunu…';
      updateTuner();
    } catch (e) {
      tunerRunning = false;
      T.status.className = 'tuner-status';
      T.status.textContent = '';
      T.noteName.textContent = '–';
      T.noteOct.textContent = '';
      T.cents.textContent = '';
      T.error.textContent = 'Mikrofon není dostupný. Povol přístup k mikrofonu v prohlížeči a zkus to znovu.';
      T.error.style.display = 'block';
    }
  }

  function stopTuner() {
    tunerRunning = false;
    if (tunerAnimFrame) { cancelAnimationFrame(tunerAnimFrame); tunerAnimFrame = null; }
    if (tunerStream) {
      tunerStream.getTracks().forEach(t => t.stop());
      tunerStream = null;
    }
    if (tunerCtx) {
      tunerCtx.close();
      tunerCtx = null;
    }
  }

  function openTuner() {
    buildTunerOverlay();
    resetTunedStrings(); // fresh session - re-earn every string's ✓
    T.overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (tunerToggle) tunerToggle.classList.add('active');
    startTuner();
  }

  function closeTuner() {
    stopTuner();
    if (T) T.overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (tunerToggle) tunerToggle.classList.remove('active');
  }

  if (tunerToggle) {
    tunerToggle.addEventListener('click', () => {
      if (T && T.overlay.classList.contains('open')) closeTuner();
      else openTuner();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && T && T.overlay.classList.contains('open')) closeTuner();
    });
  }

  // Expose the pitch detector for manual/automated verification (no mic
  // needed - callers can feed it synthesized Float32Array buffers directly).
  // Harmless in production: just a reference to a pure function.
  window.__tunerTest = { detectPitch };

  // === Bug Report Modal ===
  const bugLink = document.querySelector('.player-bug a');
  if (bugLink) {
    // Get song title from the page
    const songTitle = document.querySelector('.song-header h1')?.textContent || '';

    // Create modal HTML (song title comes from page data, so it's set via
    // textContent below rather than interpolated into innerHTML).
    const overlay = document.createElement('div');
    overlay.className = 'bug-modal-overlay';
    overlay.innerHTML = `
      <div class="bug-modal">
        <h2>Nahlásit chybu</h2>
        <p class="bug-song-name"></p>
        <textarea id="bug-text" placeholder="Co je špatně? (chybný akord, překlep v textu, špatný autor...)"></textarea>
        <div class="bug-modal-actions">
          <button type="button" class="btn-bug-cancel" id="bug-cancel">Zrušit</button>
          <button type="button" class="btn-bug-send" id="bug-send">Odeslat</button>
        </div>
      </div>
    `;
    overlay.querySelector('.bug-song-name').textContent = songTitle;
    document.body.appendChild(overlay);

    const bugText = document.getElementById('bug-text');
    const bugSend = document.getElementById('bug-send');
    const bugCancel = document.getElementById('bug-cancel');

    // Open modal instead of mailto
    bugLink.addEventListener('click', (e) => {
      e.preventDefault();
      overlay.classList.add('open');
      bugText.value = '';
      bugText.focus();
    });

    // Close modal
    function closeModal() {
      overlay.classList.remove('open');
    }

    bugCancel.addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
    });

    // Send via mailto with body
    bugSend.addEventListener('click', () => {
      const text = bugText.value.trim();
      if (!text) {
        bugText.focus();
        return;
      }
      const subject = encodeURIComponent(`Bug: ${songTitle}`);
      const body = encodeURIComponent(`Píseň: ${songTitle}\nURL: ${window.location.href}\n\n${text}`);
      window.location.href = `mailto:ondrejbek8@gmail.com?subject=${subject}&body=${body}`;
      closeModal();
    });
  }
})();
