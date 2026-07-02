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

    injectRepeatsToggle(pre, showRepeats);
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

  buildSections();

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
  }

  function stopMetronome() {
    if (metronomeInterval) {
      clearInterval(metronomeInterval);
      metronomeInterval = null;
    }
    metronomeRunning = false;
    if (metronomeToggle) metronomeToggle.classList.remove('active');
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

  // === Tuner ===
  let tunerCtx = null;
  let tunerAnalyser = null;
  let tunerStream = null;
  let tunerRunning = false;
  let tunerAnimFrame = null;
  const tunerToggle = document.getElementById('tuner-toggle');
  const tunerDisplay = document.getElementById('tuner-display');

  const TUNER_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];

  function noteFromFreq(freq) {
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
    return Math.round(noteNum) + 69;
  }

  function freqFromNote(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function centsOff(freq, note) {
    return Math.floor(1200 * Math.log(freq / freqFromNote(note)) / Math.log(2));
  }

  // Autocorrelation pitch detection
  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1; // too quiet

    // Trim edges
    let r1 = 0, r2 = SIZE - 1;
    const thresh = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buf[i]) < thresh) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
      if (Math.abs(buf[SIZE - i]) < thresh) { r2 = SIZE - i; break; }
    }

    const trimBuf = buf.slice(r1, r2);
    const trimSize = trimBuf.length;

    const c = new Float32Array(trimSize);
    for (let i = 0; i < trimSize; i++) {
      for (let j = 0; j < trimSize - i; j++) {
        c[i] += trimBuf[j] * trimBuf[j + i];
      }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;

    let maxVal = -1, maxPos = -1;
    for (let i = d; i < trimSize; i++) {
      if (c[i] > maxVal) {
        maxVal = c[i];
        maxPos = i;
      }
    }

    let T0 = maxPos;
    // Parabolic interpolation
    const x1 = c[T0 - 1] || 0;
    const x2 = c[T0];
    const x3 = c[T0 + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
  }

  function updateTuner() {
    if (!tunerRunning) return;

    const buf = new Float32Array(tunerAnalyser.fftSize);
    tunerAnalyser.getFloatTimeDomainData(buf);
    const freq = autoCorrelate(buf, tunerCtx.sampleRate);

    if (freq === -1) {
      tunerDisplay.innerHTML = '<span style="color:#556677">--</span>';
    } else {
      const midi = noteFromFreq(freq);
      const noteName = TUNER_NOTES[midi % 12];
      const octave = Math.floor(midi / 12) - 1;
      const cents = centsOff(freq, midi);
      const inTune = Math.abs(cents) <= 5;
      const centsClass = inTune ? 'in-tune' : 'off-tune';
      const centsStr = (cents >= 0 ? '+' : '') + cents;
      tunerDisplay.innerHTML = `<span class="note">${noteName}${octave}</span> <span class="cents ${centsClass}">${centsStr}c</span>`;
    }

    tunerAnimFrame = requestAnimationFrame(updateTuner);
  }

  async function startTuner() {
    try {
      tunerCtx = new (window.AudioContext || window.webkitAudioContext)();
      tunerStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = tunerCtx.createMediaStreamSource(tunerStream);
      tunerAnalyser = tunerCtx.createAnalyser();
      tunerAnalyser.fftSize = 2048;
      source.connect(tunerAnalyser);
      tunerRunning = true;
      tunerToggle.classList.add('active');
      updateTuner();
    } catch (e) {
      tunerDisplay.innerHTML = '<span style="color:#e74c3c">Mikrofon nedostupný</span>';
    }
  }

  function stopTuner() {
    tunerRunning = false;
    if (tunerAnimFrame) cancelAnimationFrame(tunerAnimFrame);
    if (tunerStream) {
      tunerStream.getTracks().forEach(t => t.stop());
      tunerStream = null;
    }
    if (tunerCtx) {
      tunerCtx.close();
      tunerCtx = null;
    }
    if (tunerToggle) tunerToggle.classList.remove('active');
    if (tunerDisplay) tunerDisplay.textContent = '';
  }

  if (tunerToggle) {
    tunerToggle.addEventListener('click', () => {
      if (tunerRunning) stopTuner();
      else startTuner();
    });
  }

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
