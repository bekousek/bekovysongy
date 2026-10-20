/**
 * tuner.js - the guitar / ukulele tuner on the song pages: a full-screen
 * <dialog> opened from #tuner-toggle, which js/player.js puts in the song
 * page's settings sheet. Styles are in css/style.css under "Tuner".
 *
 * Built for the same phone on the knee as the rest of the page:
 *   - it works out which string is ringing by itself (Auto); a tap on a
 *     string plays its tone and pins the tuner to that string instead,
 *   - one big letter, a needle and a bar that shrinks towards the middle say
 *     how far off the string is, and the words say which way to turn the peg
 *     ("utáhni" / "povol"), so nobody has to know what a cent is,
 *   - a string held in tune for a moment earns a tick; all ticks = done,
 *   - a level meter in the head shows the microphone hears anything at all,
 *     and every way the microphone can fail has its own sentence and a retry,
 *   - reference tones work with no microphone at all (tuning by ear),
 *   - the screen stays on while it is open, the microphone is let go when the
 *     page is hidden or the tuner closes.
 *
 * Pitch: McLeod's NSDF (MPM) over a 4096-sample window. The search over every
 * period runs on a copy decimated to ~12 kHz, which is cheap and good enough
 * to pick the right period (and so the right octave); the winner is then
 * re-measured at the full sample rate around that one period only.
 */
(function () {
  'use strict';

  const toggle = document.getElementById('tuner-toggle');
  if (!toggle) return;

  const SL = window.SongList;
  const icon = (name, size) => (SL && SL.icon ? SL.icon(name, size) : '');

  // Every magic number in one place, so the feel is easy to retune.
  const CFG = {
    FREQ_MIN: 60, FREQ_MAX: 700,      // detection band: E2 = 82 Hz … A4 = 440 Hz, with room for badly tuned strings
    HP_FREQ: 55, LP_FREQ: 1200,       // pre-filters in front of the analyser
    FFT: 4096,                        // window (~85 ms): steady even on the low E
    COARSE_RATE: 12000,               // the period search runs at about this rate
    DETECT_MS: 30,                    // detection cadence (~33 Hz)
    GATE_MIN: 0.0012,                 // RMS below this is silence, whatever the room
    GATE_RATIO: 3,                    // a note has to be this much louder than the room's own hum
    MPM_K: 0.9,                       // first period within this much of the best one wins (no octave-up errors)
    CLARITY_MIN: 0.82,                // how periodic a frame must be to count as a note
    STABLE_N: 3,                      // this many frames must agree before anything is shown
    STABLE_SPREAD: 0.35,              // … within this many semitones of each other
    MEDIAN_N: 5,                      // pitch shown = median of the last few frames
    NEW_NOTE: 0.6,                    // a jump bigger than this (semitones) starts a new note
    SWITCH_N: 3,                      // stable frames on another string before Auto follows it
    SWITCH_MARGIN: 0.5,               // … and it must be this many semitones nearer than the current one
    INTUNE_IN: 5, INTUNE_OUT: 8,      // in tune at |cents| <= 5, out again only past 8 (no flicker)
    INTUNE_HOLD_MS: 600,              // held in tune this long = the string's tick
    STALE_MS: 400,                    // no note for this long = show the last reading dimmed
    RANGE: 50,                        // the gauge spans ±50 cents
    NEEDLE_MS: 70,                    // needle easing time constant
    TONE_S: 1.8,                      // reference tone length
  };

  // Czech note names: H is the international B, B is B-flat.
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];

  // Strings low to high as they sit on the instrument; n is the string's
  // number the way players count them (1 = the thinnest).
  const INSTRUMENTS = {
    guitar: {
      label: 'Kytara',
      strings: [
        { name: 'E', midi: 40, n: 6 },
        { name: 'A', midi: 45, n: 5 },
        { name: 'D', midi: 50, n: 4 },
        { name: 'G', midi: 55, n: 3 },
        { name: 'H', midi: 59, n: 2 },
        { name: 'E', midi: 64, n: 1 },
      ],
    },
    ukulele: {
      label: 'Ukulele',
      // Standard GCEA with the high (re-entrant) G.
      strings: [
        { name: 'G', midi: 67, n: 4 },
        { name: 'C', midi: 60, n: 3 },
        { name: 'E', midi: 64, n: 2 },
        { name: 'A', midi: 69, n: 1 },
      ],
    },
  };
  const INST_KEY = 'tuner_instrument';

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* not remembered */ }
  }

  const freqOf = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function noteName(midi) {
    return NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12];
  }

  function centsText(c) {
    const r = Math.round(c);
    const a = Math.abs(r);
    return (r < 0 ? '−' : r > 0 ? '+' : '') + a + ' ' + plural(a, 'cent', 'centy', 'centů');
  }

  // ---- pitch detection -----------------------------------------------------

  let centered = null, decimated = null, coarse = null;

  // Normalised square difference of x against itself shifted by tau
  // (1 = the signal repeats exactly every tau samples).
  function nsdf(x, n, tau) {
    let acf = 0, m = 0;
    for (let i = 0, end = n - tau; i < end; i++) {
      const a = x[i], b = x[i + tau];
      acf += a * b;
      m += a * a + b * b;
    }
    return m > 0 ? (2 * acf) / m : 0;
  }

  // Vertex of the parabola through (-1, a), (0, b), (1, c): [offset, height].
  function parabola(a, b, c) {
    const d = a - 2 * b + c;
    if (!d) return [0, b];
    const off = (0.5 * (a - c)) / d;
    return [off, b - 0.25 * (a - c) * off];
  }

  // Returns { rms, freq, clarity }; freq is 0 when the frame holds no note.
  function detectPitch(buf, sampleRate, gate) {
    const N = buf.length;
    let mean = 0;
    for (let i = 0; i < N; i++) mean += buf[i];
    mean /= N;
    if (!centered || centered.length !== N) centered = new Float32Array(N);
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const v = buf[i] - mean;
      centered[i] = v;
      energy += v * v;
    }
    const rms = Math.sqrt(energy / N);
    const none = { rms, freq: 0, clarity: 0 };
    if (rms < gate) return none;

    // 1. Coarse: every period in the band, on a box-filtered, decimated copy.
    const D = Math.max(1, Math.round(sampleRate / CFG.COARSE_RATE));
    const M = Math.floor(N / D);
    if (!decimated || decimated.length !== M) decimated = new Float32Array(M);
    for (let i = 0, j = 0; i < M; i++) {
      let s = 0;
      for (let k = 0; k < D; k++) s += centered[j++];
      decimated[i] = s / D;
    }
    const rate = sampleRate / D;
    const minLag = Math.max(2, Math.floor(rate / CFG.FREQ_MAX));
    const maxLag = Math.min(Math.ceil(rate / CFG.FREQ_MIN) + 1, M >> 1);
    if (!coarse || coarse.length < maxLag + 2) coarse = new Float32Array(maxLag + 2);
    for (let tau = 0; tau <= maxLag + 1; tau++) coarse[tau] = nsdf(decimated, M, tau);

    // MPM key maxima: the highest point of every positive lobe after the
    // one around lag 0.
    const keys = [];
    let t = 1;
    while (t <= maxLag && coarse[t] > 0) t++;
    let best = -1, bestT = 0;
    for (; t <= maxLag; t++) {
      const v = coarse[t];
      if (v > 0) {
        if (v > best) { best = v; bestT = t; }
      } else if (best > 0) {
        keys.push(bestT);
        best = -1;
      }
    }
    if (best > 0 && bestT < maxLag) keys.push(bestT);

    let top = 0;
    keys.forEach(k => { if (k >= minLag && coarse[k] > top) top = coarse[k]; });
    if (top < CFG.CLARITY_MIN * 0.9) return none;
    // The first period that comes close to the best one is the fundamental;
    // taking the best one outright is what produces octave errors.
    const pick = keys.find(k => k >= minLag && coarse[k] >= CFG.MPM_K * top);
    if (!pick) return none;

    // 2. Fine: re-measure at the full rate, only around that period.
    const guess = (pick + parabola(coarse[pick - 1], coarse[pick], coarse[pick + 1])[0]) * D;
    const lo = Math.max(2, Math.floor(guess) - D - 1);
    const hi = Math.min((N >> 1) - 2, Math.ceil(guess) + D + 1);
    if (hi <= lo) return none;
    const fine = [];
    for (let tau = lo - 1; tau <= hi + 1; tau++) fine.push(nsdf(centered, N, tau));
    let at = 1;
    for (let i = 2; i < fine.length - 1; i++) if (fine[i] > fine[at]) at = i;
    const [off, peak] = parabola(fine[at - 1], fine[at], fine[at + 1]);
    const clarity = Math.min(1, peak);
    if (clarity < CFG.CLARITY_MIN) return { rms, freq: 0, clarity };
    const freq = sampleRate / (lo - 1 + at + off);
    if (freq < CFG.FREQ_MIN || freq > CFG.FREQ_MAX) return none;
    return { rms, freq, clarity };
  }

  // ---- state ---------------------------------------------------------------

  let instrument = INSTRUMENTS[read(INST_KEY)] ? read(INST_KEY) : 'guitar';
  const strings = () => INSTRUMENTS[instrument].strings;

  let ui = null;              // DOM references, built on first open
  let ctx = null;             // one AudioContext for the microphone and the tones
  let stream = null, nodes = [], analyser = null, buf = null;
  let listening = false, starting = false, problem = '';
  let raf = 0, lastDetect = 0, lastDraw = 0;
  let wake = null;
  let noise = 0.002;          // the room's own level, followed while nothing plays
  let level = 0, levelShown = 0;

  let manualIdx = null;       // string pinned by a tap, or null for Auto
  let autoIdx = null;         // string Auto settled on
  let switchVotes = 0, switchTo = null;
  let hist = [];              // recent pitches of the current note (MIDI floats)
  let current = null;         // string the display is about
  let heard = false;          // anything shown since the last reset
  let stale = false;
  let lastHeard = 0;
  let cents = 0, heardMidi = 0;
  let inTune = false, inTuneSince = 0;
  let targetCents = 0, shownCents = 0;
  let toneUntil = 0, toneSource = null;
  const done = new Set();
  let lastSaid = '', lastSaidAt = 0;

  function resetDetection() {
    hist = [];
    autoIdx = null;
    switchVotes = 0;
    switchTo = null;
    current = manualIdx;
    heard = false;
    stale = false;
    lastHeard = 0;
    inTune = false;
    inTuneSince = 0;
    targetCents = 0;
  }

  // ---- the dialog ------------------------------------------------------------

  // The gauge: a flat arc whose pivot sits below the picture, so the needle
  // sweeps like a meter's and the arc takes little height. ±50 cents = ±30°.
  const PIVOT_X = 160, PIVOT_Y = 300, R = 258, SWEEP = 30;
  function polar(r, deg) {
    const a = (deg * Math.PI) / 180;
    return [PIVOT_X + r * Math.sin(a), PIVOT_Y - r * Math.cos(a)];
  }
  function arc(r, from, to) {
    const [x1, y1] = polar(r, from);
    const [x2, y2] = polar(r, to);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 0 ${to > from ? 1 : 0} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  function gaugeSVG() {
    const deg = (c) => (c / CFG.RANGE) * SWEEP;
    let ticks = '';
    for (let c = -CFG.RANGE; c <= CFG.RANGE; c += 10) {
      const major = c === 0;
      const [x1, y1] = polar(R + 12, deg(c));
      const [x2, y2] = polar(R + (major ? 30 : 22), deg(c));
      ticks += `<line class="${major ? 'tg-tick tg-tick-0' : 'tg-tick'}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }
    // The needle runs out past the bottom edge, as if from a pivot below.
    const [n1x, n1y] = polar(R - 120, 0);
    const [n2x, n2y] = polar(R + 34, 0);
    return `<svg class="tuner-gauge" viewBox="0 0 320 128" aria-hidden="true" focusable="false">
      <path class="tg-track" d="${arc(R, -SWEEP, SWEEP)}"/>
      <path class="tg-zone" d="${arc(R, deg(-CFG.INTUNE_IN), deg(CFG.INTUNE_IN))}"/>
      <path class="tg-dev tg-dev-low" d="${arc(R, 0, -SWEEP)}" pathLength="${CFG.RANGE}"/>
      <path class="tg-dev tg-dev-high" d="${arc(R, 0, SWEEP)}" pathLength="${CFG.RANGE}"/>
      ${ticks}
      <g class="tg-needle"><line x1="${n1x}" y1="${n1y}" x2="${n2x}" y2="${n2y}"/></g>
    </svg>`;
  }

  // Same stroke style as SL.icon; the shared set has no microphone.
  const MIC = '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/></svg>';

  function build() {
    if (ui) return;
    const d = document.createElement('dialog');
    d.className = 'tuner';
    d.id = 'tuner';
    d.setAttribute('aria-labelledby', 'tuner-title');
    d.innerHTML = `
      <div class="tuner-head">
        <h2 id="tuner-title">Ladička</h2>
        <span class="tuner-mic" title="Co slyší mikrofon">${MIC}<span class="tuner-level"><span></span></span></span>
        <button type="button" class="icon-btn tuner-close" aria-label="Zavřít ladičku">${icon('x', 22)}</button>
      </div>
      <div class="tuner-stage">
        <p class="tuner-which"></p>
        <div class="tuner-note"><span class="tuner-letter"></span><span class="tuner-prompt"></span></div>
        <p class="tuner-status"><span class="tuner-status-icon"></span><span class="tuner-status-text"></span></p>
        <div class="tuner-meter">
          ${gaugeSVG()}
          <div class="tuner-scale"><span>nízko</span><span class="tuner-detail"></span><span>vysoko</span></div>
        </div>
        <div class="tuner-problem" hidden>
          <p class="tuner-problem-title"></p>
          <p class="tuner-problem-text"></p>
          <button type="button" class="btn btn-quiet tuner-retry">Zkusit znovu</button>
        </div>
      </div>
      <div class="tuner-dock">
        <div class="tuner-controls">
          <div class="seg" role="radiogroup" aria-label="Nástroj">
            <button type="button" role="radio" data-inst="guitar">Kytara</button>
            <button type="button" role="radio" data-inst="ukulele">Ukulele</button>
          </div>
          <button type="button" class="tuner-auto" aria-pressed="true">Auto</button>
        </div>
        <div class="tuner-strings" role="group" aria-label="Struny"></div>
        <p class="tuner-hint"></p>
        <div class="tuner-finished" hidden>
          <p>${icon('check', 20)}<span>Všechny struny jsou naladěné.</span></p>
          <button type="button" class="btn btn-primary tuner-back">Zpět k písni</button>
        </div>
      </div>
      <p class="visually-hidden tuner-live" aria-live="polite"></p>`;
    document.body.appendChild(d);

    const q = (sel) => d.querySelector(sel);
    ui = {
      dialog: d,
      which: q('.tuner-which'),
      letter: q('.tuner-letter'),
      prompt: q('.tuner-prompt'),
      status: q('.tuner-status'),
      statusIcon: q('.tuner-status-icon'),
      statusText: q('.tuner-status-text'),
      meter: q('.tuner-meter'),
      detail: q('.tuner-detail'),
      needle: q('.tg-needle'),
      devLow: q('.tg-dev-low'),
      devHigh: q('.tg-dev-high'),
      level: q('.tuner-level > span'),
      problem: q('.tuner-problem'),
      problemTitle: q('.tuner-problem-title'),
      problemText: q('.tuner-problem-text'),
      retry: q('.tuner-retry'),
      insts: d.querySelectorAll('[data-inst]'),
      auto: q('.tuner-auto'),
      strings: q('.tuner-strings'),
      hint: q('.tuner-hint'),
      finished: q('.tuner-finished'),
      live: q('.tuner-live'),
      buttons: [],
      last: {},
    };

    q('.tuner-close').addEventListener('click', () => d.close());
    q('.tuner-back').addEventListener('click', () => d.close());
    ui.retry.addEventListener('click', () => { problem = ''; startMic(); });
    ui.insts.forEach(b => b.addEventListener('click', () => setInstrument(b.dataset.inst)));
    ui.auto.addEventListener('click', () => {
      manualIdx = null;
      resetDetection();
      paint();
    });
    d.addEventListener('close', onClosed);
    // A tap on the dimmed backdrop (the desktop panel) closes, like the sheets.
    d.addEventListener('click', (e) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    });

    setInstrument(instrument);
  }

  function setInstrument(inst) {
    if (!INSTRUMENTS[inst]) inst = 'guitar';
    instrument = inst;
    write(INST_KEY, inst);
    ui.insts.forEach(b => b.setAttribute('aria-checked', b.dataset.inst === inst ? 'true' : 'false'));
    ui.strings.dataset.count = strings().length;
    ui.strings.innerHTML = '';
    ui.last = {};   // new buttons: paint() must set everything again
    ui.buttons = strings().map((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tuner-str';
      b.innerHTML = `<span class="tuner-str-name">${s.name}</span><span class="tuner-str-n">${s.n}</span><span class="tuner-str-tick">${icon('check', 14)}</span>`;
      b.addEventListener('click', () => pickString(i));
      ui.strings.appendChild(b);
      return b;
    });
    manualIdx = null;
    done.clear();
    resetDetection();
    paint();
  }

  // A tap on a string: pin the tuner to it and play how it should sound.
  // Another tap on the pinned string just plays the tone again.
  function pickString(i) {
    if (manualIdx !== i) {
      manualIdx = i;
      resetDetection();
    }
    playTone(strings()[i].midi);
    paint();
  }

  // ---- painting ----------------------------------------------------------------

  function set(key, el, prop, value) {
    if (ui.last[key] === value) return;
    ui.last[key] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop === 'class') el.className = value;
    else el.setAttribute(prop, value);
  }

  // Everything but the needle, from the state above. Cheap enough to run on
  // every detection; set() only touches what changed.
  function paint() {
    const list = strings();
    const s = current != null ? list[current] : null;
    const tone = performance.now() < toneUntil;
    let state = 'idle';
    if (problem) state = 'problem';
    else if (heard && s) state = inTune ? 'tuned' : (cents < 0 ? 'low' : 'high');
    else if (starting) state = 'asking';

    let which = '', letter = '', prompt = '', status = '', statusIcon = '', detail = '';
    if (s) {
      which = `${s.n}. struna`;
      letter = s.name;
    }
    if (state === 'tuned' || state === 'low' || state === 'high') {
      const far = Math.abs(cents) > CFG.RANGE;
      if (state === 'tuned') {
        status = 'Naladěno';
        statusIcon = icon('check', 22);
      } else if (state === 'low') {
        status = far ? 'Moc nízko, utáhni' : 'Nízko, utáhni';
        statusIcon = icon('up', 22);
      } else {
        status = far ? 'Moc vysoko, povol' : 'Vysoko, povol';
        statusIcon = icon('down', 22);
      }
      if (far) {
        const k = Math.max(1, Math.round(Math.abs(cents) / 100));
        detail = `hraješ ${noteName(heardMidi)}, o ${k} ${plural(k, 'půltón', 'půltóny', 'půltónů')} ${cents < 0 ? 'níž' : 'výš'}`;
      } else {
        detail = centsText(cents);
      }
    } else if (state === 'asking') {
      prompt = 'Povol mikrofon';
      status = 'Ladička potřebuje slyšet, co hraješ.';
    } else if (state === 'problem') {
      if (tone && s) status = 'Nalaď strunu podle tónu';
    } else if (tone && s) {
      status = 'Poslouchej tón, pak zahraj strunu';
    } else if (s) {
      status = 'Brnkni na ni a sleduj ručičku';
    } else {
      which = listening ? 'Poslouchám' : '';
      prompt = 'Zahraj jednu strunu';
      status = listening ? 'Ladička pozná sama, která to je.' : '';
    }

    const d = ui.dialog;
    set('state', d, 'data-state', state);
    set('stale', d, 'data-stale', stale && heard ? 'true' : 'false');
    set('which', ui.which, 'text', which);
    set('letter', ui.letter, 'text', letter);
    set('prompt', ui.prompt, 'text', prompt);
    set('status', ui.statusText, 'text', status);
    set('statusIcon', ui.statusIcon, 'html', statusIcon);
    set('detail', ui.detail, 'text', detail);
    ui.meter.hidden = state === 'problem';
    ui.problem.hidden = state !== 'problem';

    // Strings: the one being tuned, the pinned one, the ticked ones.
    ui.buttons.forEach((b, i) => {
      const str = list[i];
      const isOn = i === current && heard;
      set('b' + i, b, 'class', 'tuner-str' +
        (isOn ? (inTune ? ' is-tuned-now' : ' is-on') : '') +
        (done.has(i) ? ' is-done' : ''));
      set('bp' + i, b, 'aria-pressed', manualIdx === i ? 'true' : 'false');
      set('bl' + i, b, 'aria-label', `${str.n}. struna ${str.name}${done.has(i) ? ', naladěná' : ''}`);
    });
    set('auto', ui.auto, 'aria-pressed', manualIdx == null ? 'true' : 'false');

    const all = done.size === list.length;
    ui.finished.hidden = !all;
    ui.hint.hidden = all;
    let hint = 'Klepnutím na strunu uslyšíš její tón.';
    if (problem) hint = 'Ladit jde i podle sluchu: klepni na strunu a zazní její tón.';
    else if (manualIdx != null) hint = `Ladička hlídá jen ${list[manualIdx].n}. strunu. Auto vrátí rozpoznávání.`;
    set('hint', ui.hint, 'text', hint);

    // One sentence for a screen reader when something worth hearing changes,
    // never once per frame.
    if (state === 'tuned' || state === 'low' || state === 'high') {
      say(`${s.n}. struna ${s.name}: ${status}`);
    }
  }

  function say(text, force) {
    const now = performance.now();
    if (text === lastSaid && !force) return;
    if (!force && now - lastSaidAt < 1500) return;
    lastSaid = text;
    lastSaidAt = now;
    ui.live.textContent = text;
  }

  function showProblem(kind) {
    problem = kind;
    const texts = {
      insecure: ['Mikrofon jde jen přes https', 'Prohlížeč pustí mikrofon jen na zabezpečené stránce. Otevři zpěvník přes https://.'],
      unsupported: ['Tenhle prohlížeč mikrofon neumí', 'Zkus ladičku v Chromu, Safari nebo Firefoxu.'],
      denied: ['Mikrofon je zakázaný', 'Povol ho v nastavení stránky (ikona vedle adresy) a klepni na Zkusit znovu.'],
      missing: ['Nenašel jsem mikrofon', 'Připoj nějaký a klepni na Zkusit znovu.'],
      busy: ['Mikrofon teď používá něco jiného', 'Ukonči hovor nebo appku, která ho drží, a zkus to znovu.'],
      other: ['Mikrofon se nepodařilo spustit', 'Zkus to znovu, případně stránku načti znovu.'],
    };
    const [title, text] = texts[kind] || texts.other;
    ui.problemTitle.textContent = title;
    ui.problemText.textContent = text;
    ui.retry.hidden = kind === 'insecure' || kind === 'unsupported';
    paint();
    say(title + '. ' + text, true);
  }

  // The needle and the level meter, every animation frame, eased towards the
  // last detection so a 33 Hz reading still moves smoothly.
  function draw(now) {
    const dt = lastDraw ? Math.min(100, now - lastDraw) : 16;
    lastDraw = now;
    const k = 1 - Math.exp(-dt / CFG.NEEDLE_MS);
    const target = heard ? clamp(targetCents, -CFG.RANGE - 6, CFG.RANGE + 6) : 0;
    shownCents += (target - shownCents) * k;
    if (Math.abs(target - shownCents) < 0.02) shownCents = target;
    const v = clamp(shownCents, -CFG.RANGE, CFG.RANGE);
    const angle = (shownCents / CFG.RANGE) * SWEEP;
    if (ui.last.angle !== angle) {
      ui.last.angle = angle;
      ui.needle.setAttribute('transform', `rotate(${angle.toFixed(2)} ${PIVOT_X} ${PIVOT_Y})`);
      ui.devLow.style.strokeDasharray = `${Math.max(0, -v).toFixed(2)} 100`;
      ui.devHigh.style.strokeDasharray = `${Math.max(0, v).toFixed(2)} 100`;
    }

    levelShown += ((listening ? level : 0) - levelShown) * (level > levelShown ? 0.5 : 0.12);
    // -60 dBFS (a quiet room) … -12 dBFS (a string close to the phone)
    const db = levelShown > 0 ? 20 * Math.log10(levelShown) : -100;
    const fill = clamp((db + 60) / 48, 0, 1);
    if (Math.abs((ui.last.level || 0) - fill) > 0.01) {
      ui.last.level = fill;
      ui.level.style.transform = `scaleX(${fill.toFixed(3)})`;
    }
  }

  // ---- listening -----------------------------------------------------------------

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (listening && now - lastDetect >= CFG.DETECT_MS) {
      lastDetect = now;
      detect(now);
    }
    if (toneUntil && now >= toneUntil) {
      toneUntil = 0;
      paint();
    }
    draw(now);
  }

  function detect(now) {
    // Our own reference tone or tick is still ringing: the microphone would
    // hear it and call the string in tune.
    if (now < toneUntil) { level = 0; return; }
    analyser.getFloatTimeDomainData(buf);
    const gate = Math.max(CFG.GATE_MIN, noise * CFG.GATE_RATIO);
    const r = detectPitch(buf, ctx.sampleRate, gate);
    level = r.rms;
    if (r.freq) onPitch(r.freq, now);
    else {
      // Follow the room: quickly down, slowly up, only while nothing plays.
      noise += (r.rms - noise) * (r.rms < noise ? 0.3 : 0.01);
      onSilence(now);
    }
  }

  function nearestString(midi) {
    let best = 0, dist = Infinity;
    strings().forEach((s, i) => {
      const d = Math.abs(midi - s.midi);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }

  function onPitch(freq, now) {
    const midi = 69 + 12 * Math.log2(freq / 440);
    lastHeard = now;
    if (hist.length && Math.abs(midi - median(hist)) > CFG.NEW_NOTE) hist = [];
    hist.push(midi);
    if (hist.length > CFG.MEDIAN_N) hist.shift();
    if (hist.length < CFG.STABLE_N) return;
    const recent = hist.slice(-CFG.STABLE_N);
    const m = median(recent);
    if (!recent.every(v => Math.abs(v - m) <= CFG.STABLE_SPREAD)) return;
    const med = median(hist);

    let idx;
    if (manualIdx != null) idx = manualIdx;
    else {
      // Auto follows a new string only when it is clearly nearer (a string
      // tuned halfway between two would flip-flop otherwise) and after a few
      // agreeing frames, showing nothing meanwhile rather than the old
      // string wildly off.
      let near = nearestString(med);
      const list = strings();
      if (autoIdx != null && near !== autoIdx &&
          Math.abs(med - list[autoIdx].midi) - Math.abs(med - list[near].midi) < CFG.SWITCH_MARGIN) near = autoIdx;
      if (autoIdx == null || near === autoIdx) {
        autoIdx = near;
        switchVotes = 0;
      } else {
        if (near === switchTo) switchVotes++;
        else { switchTo = near; switchVotes = 1; }
        if (switchVotes < CFG.SWITCH_N) return;
        autoIdx = near;
        switchVotes = 0;
      }
      idx = autoIdx;
    }

    if (idx !== current) {
      current = idx;
      inTune = false;
      inTuneSince = 0;
    }
    const s = strings()[idx];
    heardMidi = med;
    cents = (med - s.midi) * 100;
    targetCents = cents;
    heard = true;
    stale = false;
    const a = Math.abs(cents);
    inTune = inTune ? a <= CFG.INTUNE_OUT : a <= CFG.INTUNE_IN;

    if (inTune) {
      if (!inTuneSince) inTuneSince = now;
      if (now - inTuneSince >= CFG.INTUNE_HOLD_MS && !done.has(idx)) {
        done.add(idx);
        tick();
        say(`${s.n}. struna je naladěná.`, true);
      }
    } else {
      inTuneSince = 0;
    }
    paint();
  }

  function onSilence(now) {
    if (heard && !stale && now - lastHeard > CFG.STALE_MS) {
      // Keep the last reading on screen (dimmed) while the peg turns,
      // instead of jumping back to the empty state between plucks.
      stale = true;
      hist = [];
      inTuneSince = 0;
      paint();
    }
  }

  function audioContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  }

  async function startMic() {
    if (listening || starting || !ui.dialog.open) return;
    if (!window.isSecureContext) return showProblem('insecure');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !audioContext()) return showProblem('unsupported');
    starting = true;
    paint();
    let s;
    try {
      // No echo cancelling, noise suppression or auto gain: all three bend
      // or swallow a sustained string.
      s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      starting = false;
      const name = e && e.name;
      return showProblem(
        name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' :
        name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' :
        name === 'NotReadableError' || name === 'AbortError' ? 'busy' : 'other');
    }
    starting = false;
    // Closed or hidden while the permission prompt was up.
    if (!ui.dialog.open || document.visibilityState === 'hidden') {
      s.getTracks().forEach(t => t.stop());
      paint();
      return;
    }
    stream = s;
    let source;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch (e) {
      // Firefox refuses a microphone whose sample rate differs from the
      // context's: start again with a context at the microphone's rate.
      try {
        const track = stream.getAudioTracks()[0];
        const rate = track && track.getSettings ? track.getSettings().sampleRate : undefined;
        ctx.close().catch(() => {});
        ctx = new (window.AudioContext || window.webkitAudioContext)(rate ? { sampleRate: rate } : undefined);
        source = ctx.createMediaStreamSource(stream);
      } catch (e2) {
        releaseMic();
        return showProblem('other');
      }
    }
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = CFG.HP_FREQ;
    hp.Q.value = 0.707;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = CFG.LP_FREQ;
    lp.Q.value = 0.707;
    analyser = ctx.createAnalyser();
    analyser.fftSize = CFG.FFT;
    source.connect(hp);
    hp.connect(lp);
    lp.connect(analyser);
    nodes = [source, hp, lp, analyser];
    buf = new Float32Array(analyser.fftSize);
    stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => {
      if (!listening) return;
      releaseMic();
      showProblem('busy');
    }));
    problem = '';
    listening = true;
    resetDetection();
    paint();
  }

  function releaseMic() {
    listening = false;
    starting = false;
    nodes.forEach(n => { try { n.disconnect(); } catch (e) { /* already gone */ } });
    nodes = [];
    analyser = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    level = 0;
  }

  // ---- sound -------------------------------------------------------------------

  // A plucked-string-like tone: harmonics that fade faster the higher they
  // are, rendered once per string and context. Exact pitch, unlike a
  // Karplus-Strong delay line rounded to whole samples.
  const toneCache = new Map();
  function toneBuffer(c, midi) {
    const key = c.sampleRate + ':' + midi;
    if (toneCache.has(key)) return toneCache.get(key);
    const sr = c.sampleRate;
    const len = Math.floor(sr * CFG.TONE_S);
    const b = c.createBuffer(1, len, sr);
    const out = b.getChannelData(0);
    const f = freqOf(midi);
    const H = Math.min(10, Math.floor(5000 / f));
    for (let h = 1; h <= H; h++) {
      const amp = (h === 1 ? 0.8 : 1) / Math.pow(h, 1.1);
      const decay = Math.exp(-1 / (sr * 0.65 / Math.pow(h, 0.7)));
      const w = (2 * Math.PI * f * h) / sr;
      let env = amp;
      for (let i = 0; i < len; i++) {
        out[i] += env * Math.sin(w * i);
        env *= decay;
      }
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
    const attack = Math.floor(sr * 0.004), release = Math.floor(sr * 0.25);
    for (let i = 0; i < len; i++) {
      let g = 0.9 / (peak || 1);
      if (i < attack) g *= i / attack;
      if (i > len - release) g *= (len - i) / release;
      out[i] *= g;
    }
    toneCache.set(key, b);
    return b;
  }

  function playTone(midi) {
    const c = audioContext();
    if (!c) return;
    try {
      if (toneSource) { try { toneSource.stop(); } catch (e) { /* ended */ } }
      const src = c.createBufferSource();
      src.buffer = toneBuffer(c, midi);
      const gain = c.createGain();
      gain.gain.value = 0.55;
      src.connect(gain);
      gain.connect(c.destination);
      src.start();
      toneSource = src;
      toneUntil = performance.now() + CFG.TONE_S * 1000 + 100;
      hist = [];
    } catch (e) { /* no sound, tuning still works */ }
  }

  // Two short notes when a string earns its tick.
  function tick() {
    const c = audioContext();
    if (!c) return;
    try {
      const now = c.currentTime;
      [[0, 880], [0.09, 1318.5]].forEach(([at, f]) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        osc.connect(gain);
        gain.connect(c.destination);
        const t0 = now + at;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
        osc.start(t0);
        osc.stop(t0 + 0.13);
      });
      toneUntil = Math.max(toneUntil, performance.now() + 260);
    } catch (e) { /* silent tick */ }
  }

  // ---- open / close ------------------------------------------------------------

  async function keepAwake() {
    if (wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } catch (e) { wake = null; }
  }

  function open() {
    build();
    if (ui.dialog.open) return;
    problem = '';
    manualIdx = null;
    done.clear();
    resetDetection();
    shownCents = 0;
    lastSaid = '';
    ui.dialog.showModal();
    toggle.classList.add('active');
    audioContext();   // inside the tap, so iOS lets it make sound
    keepAwake();
    cancelAnimationFrame(raf);
    lastDraw = 0;
    raf = requestAnimationFrame(loop);
    paint();
    startMic();
  }

  function onClosed() {
    releaseMic();
    cancelAnimationFrame(raf);
    raf = 0;
    if (toneSource) { try { toneSource.stop(); } catch (e) { /* ended */ } toneSource = null; }
    toneUntil = 0;
    if (wake) { wake.release().catch(() => {}); wake = null; }
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    toggle.classList.remove('active');
    // The sheet that held the toggle is closed; give focus back to its button.
    const more = document.getElementById('more-btn');
    if (more) more.focus({ preventScroll: true });
  }

  toggle.addEventListener('click', open);

  // Let go of the microphone while the page is hidden (phone locked, another
  // app), pick it up again on return.
  document.addEventListener('visibilitychange', () => {
    if (!ui || !ui.dialog.open) return;
    if (document.visibilityState === 'hidden') {
      releaseMic();
      paint();
    } else {
      audioContext();
      keepAwake();
      if (!problem) startMic();
    }
  });

  // For checks without a microphone: feed detectPitch synthesized buffers.
  window.Tuner = { detectPitch, open };
})();
