#!/usr/bin/env node
'use strict';
/**
 * Builds the fingering tables in js/chords.js (between the GENERATED
 * markers) from chords-db, and checks that every chord the songbook can show
 * gets a diagram.
 *
 *   curl -o guitar.json https://cdn.jsdelivr.net/npm/@tombatossals/chords-db@0.5.1/lib/guitar.json
 *   node scripts/build-chord-diagrams.js guitar.json
 *
 * chords-db (github.com/tombatossals/chords-db, MIT) lists every voicing with
 * its MIDI notes. For each quality and root this takes the first of its
 * voicings that passes ChordDiagrams.verify - exactly the chord's tones,
 * root lowest - after checking the frets really give the MIDI notes chords-db
 * lists. Power chords (not in chords-db) are the usual two-finger shape.
 * Slash chords: chords-db's own when it has them, otherwise the bass is put
 * under one of its voicings (ChordDiagrams.withBass) and verified the same
 * way. Only the slash chords the songs use (in all twelve keys) are stored;
 * the page builds others on the fly.
 *
 * Exits 1 if any chord a song uses, in any transposition, has no diagram.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHORDS_JS = path.join(ROOT, 'js', 'chords.js');
const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: node scripts/build-chord-diagrams.js <chords-db guitar.json>');
  process.exit(2);
}
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const T = require(path.join(ROOT, 'js', 'chord-theory.js'));
let CD = require(CHORDS_JS);

// chords-db's names: keys by pitch class, suffixes by our quality.
const DB_KEYS = ['C', 'Csharp', 'D', 'Eb', 'E', 'F', 'Fsharp', 'G', 'Ab', 'A', 'Bb', 'B'];
const DB_BASS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const DB_SUFFIX = {
  maj: 'major', min: 'minor', 7: '7', m7: 'm7', maj7: 'maj7', 6: '6', m6: 'm6',
  sus2: 'sus2', sus4: 'sus4', '7sus4': '7sus4', add9: 'add9', 9: '9', m9: 'm9', '7b9': '7b9',
  dim7: 'dim7', m7b5: 'm7b5', aug: 'aug', aug7: 'aug7',
};

const problems = [];

// chords-db positions are relative to baseFret; make them absolute and make
// sure they really give the notes chords-db says they do.
function positions(key, suffix) {
  const entry = (db.chords[key] || []).find(c => c.suffix === suffix);
  if (!entry) return [];
  return entry.positions.map(p => {
    const shift = p.baseFret - 1;
    const frets = p.frets.map(f => (f > 0 ? f + shift : f));
    const barres = (p.barres || []).map(b => b + shift);
    const midi = CD.pitches(frets);
    if (p.midi && p.midi.join() !== midi.join()) {
      problems.push(`chords-db ${key}${suffix}: frets ${frets} give ${midi}, it lists ${p.midi}`);
    }
    return { frets, barres };
  });
}

// A chords-db voicing and its variants with the lowest strings muted one by
// one: chords-db often strums all six with the fifth at the bottom (H as
// 2 2 4 4 4 2), a songbook shows the root there (x 2 4 4 4 2).
function withTrims(list) {
  const out = [];
  list.forEach((p, i) => {
    out.push({ ...p, order: i });
    const frets = p.frets.slice();
    for (let s = 0; s < 3; s++) {
      if (frets[s] < 0) continue;
      frets[s] = -1;
      if (frets.filter(f => f >= 0).length < 3) break;
      out.push({ frets: frets.slice(), barres: CD.rebarre(frets, p.barres), order: i });
    }
  });
  return out;
}

// chords-db lists the usual voicing first, so the first candidate that
// sounds exactly right wins - with at least four strings ringing if any
// candidate manages that, so a three-string scrap never beats a full chord.
function pick(candidates, chord) {
  const ok = candidates.filter(c => CD.playable(c.frets, c.barres) && CD.verify(c.frets, chord));
  const best = ok.find(c => c.frets.filter(f => f >= 0).length >= 4) || ok[0];
  return best && { frets: best.frets, barres: best.barres };
}

// chords-db orders voicings by their place on the neck, not by how common
// they are, so for C#mi it offers x 4 2 1 2 x before x 4 6 6 5 4. For the
// five kinds of chord a songbook shows most, these are the shapes Czech
// songbooks draw (open chords, else the E- or A-shape barre). Each one must
// still be among chords-db's voicings and pass the check, or the script
// says so. Roots C, C#, D, D#, E, F, F#, G, G#, A, B, H.
const STANDARD = {
  maj: ['x32010', 'x46664', 'xx0232', 'xx1343', '022100', '133211', '244322', '320003', '466544', 'x02220', 'x13331', 'x24442'],
  min: ['x35543', 'x46654', 'xx0231', 'xx1342', '022000', '133111', '244222', '355333', '466444', 'x02210', 'x13321', 'x24432'],
  7: ['x32310', 'x46464', 'xx0212', 'xx1323', '020100', '131211', '242322', '320001', '464544', 'x02020', 'x13131', 'x21202'],
  m7: ['x35343', 'x46454', 'xx0211', 'xx1322', '020000', '131111', '242222', '353333', '464444', 'x02010', 'x13121', 'x24232'],
  maj7: ['x32000', 'x46564', 'xx0222', 'xx1333', '021100', 'xx3210', '243322', '320002', '465544', 'x02120', 'x13231', 'x24342'],
};
const standardFrets = (s) => s.split('').map(c => (c === 'x' ? -1 : Number(c))).join(',');

// ---- plain chords --------------------------------------------------------

const voicings = {};
for (const q of Object.keys(CD.QUALITIES)) {
  voicings[q] = [];
  for (let pc = 0; pc < 12; pc++) {
    const chord = { root: pc, quality: q, bass: null };
    let v = null;
    if (STANDARD[q]) {
      const want = standardFrets(STANDARD[q][pc]);
      const found = withTrims(positions(DB_KEYS[pc], DB_SUFFIX[q])).find(c => c.frets.join(',') === want);
      if (found && CD.verify(found.frets, chord) && CD.playable(found.frets, found.barres)) {
        voicings[q][pc] = CD.encode(found);
        continue;
      }
      problems.push(`${DB_KEYS[pc]}${DB_SUFFIX[q]}: the songbook shape ${STANDARD[q][pc]} is ${found ? 'not a valid voicing' : 'not in chords-db'}`);
    }
    if (q === '5') {
      // Root on the low E or A string, fifth and octave above it.
      const onE = (pc - 4 + 12) % 12, onA = (pc - 9 + 12) % 12;
      v = onE <= onA
        ? { frets: [onE, onE + 2, onE + 2, -1, -1, -1], barres: [] }
        : { frets: [-1, onA, onA + 2, onA + 2, -1, -1], barres: [] };
      if (!CD.verify(v.frets, chord)) problems.push(`power chord on ${pc} fails the check`);
    } else {
      v = pick(withTrims(positions(DB_KEYS[pc], DB_SUFFIX[q])), chord);
      if (!v) {
        problems.push(`no voicing in chords-db passes the check for ${q} on ${DB_KEYS[pc]}`);
        continue;
      }
    }
    voicings[q][pc] = CD.encode(v);
  }
}

// ---- every chord the songbook can show -----------------------------------

const names = new Set();
const songs = JSON.parse(fs.readFileSync(path.join(ROOT, 'songs.json'), 'utf8')).songs;
songs.forEach(s => (s.chords || []).forEach(c => names.add(c.trim())));
const songsDir = path.join(ROOT, 'songs');
fs.readdirSync(songsDir).filter(f => f.endsWith('.html')).forEach(f => {
  const html = fs.readFileSync(path.join(songsDir, f), 'utf8');
  for (const m of html.matchAll(/data-chord="([^"]+)"/g)) names.add(m[1].trim());
});
const shown = new Set();
for (const n of names) for (let t = 0; t < 12; t++) shown.add(T.transposeChord(n, t));

// ---- slash chords --------------------------------------------------------

const sounding = (v) => v.frets.filter(f => f >= 0).length;

// Effort, plus: a voicing that rings on three strings or fewer is thin, and
// a muted string between ringing ones has to be damped by hand.
function slashCost(v) {
  const ring = v.frets.map((f, i) => (f >= 0 ? i : -1)).filter(i => i >= 0);
  let inner = 0;
  for (let i = ring[0]; i <= ring[ring.length - 1]; i++) if (v.frets[i] < 0) inner++;
  return CD.effort(v) + inner * 3 + (ring.length < 4 ? 20 : 0);
}

// Every fingering within four frets starting at fret `from` … `to`; the
// friendliest that passes the same check.
function search(chord, from, to) {
  let best = null, bestCost = Infinity;
  for (let start = from; start <= to; start++) {
    const options = [-1, 0, start, start + 1, start + 2, start + 3];
    const frets = new Array(6);
    (function walk(s) {
      if (s === 6) {
        const v = { frets: frets.slice(), barres: CD.barresOf(frets) };
        if (!CD.playable(v.frets, v.barres) || !CD.verify(v.frets, chord)) return;
        const cost = slashCost(v);
        if (cost < bestCost) { best = v; bestCost = cost; }
        return;
      }
      for (const f of options) { frets[s] = f; walk(s + 1); }
    })(0);
  }
  return best;
}

const slash = {};
const slashFrom = { db: 0, built: 0, searched: 0 };
for (const name of shown) {
  const chord = CD.parseName(name);
  if (!chord || chord.bass == null) continue;
  const key = chord.quality + ' ' + chord.root + ' ' + chord.bass;
  if (slash[key]) continue;
  // Candidates: the chord's own shape from the table above with the bass put
  // under it (how C/E, D/F# or G/H are usually played, so it gets a head
  // start), chords-db's own slash voicings, the bass under any of its
  // voicings of the chord, and every fingering on the first four frets. The
  // friendliest verified one wins, so an open D9/F# beats a stretch at the
  // fifth fret.
  const candidates = [];
  const own = CD.withBass(CD.decode(voicings[chord.quality][chord.root]), chord);
  if (own) candidates.push({ ...own, from: 'built', bonus: 5 });
  if (chord.quality === 'maj' || chord.quality === 'min') {
    const suffix = (chord.quality === 'min' ? 'm/' : '/') + DB_BASS[chord.bass];
    positions(DB_KEYS[chord.root], suffix).forEach(p => candidates.push({ ...p, from: 'db' }));
  }
  if (chord.quality !== '5') {
    withTrims(positions(DB_KEYS[chord.root], DB_SUFFIX[chord.quality])).forEach(base => {
      const w = CD.withBass(base, chord);
      if (w) candidates.push({ ...w, from: 'built' });
    });
  }
  const low = search(chord, 1, 1);
  if (low) candidates.push({ ...low, from: 'searched' });
  let v = null, cost = Infinity;
  for (const c of candidates) {
    if (!CD.playable(c.frets, c.barres) || !CD.verify(c.frets, chord)) continue;
    const e = slashCost(c) - (c.bonus || 0);
    if (e < cost) { v = c; cost = e; }
  }
  if (!v) {
    const far = search(chord, 1, 12);
    if (far) v = { ...far, from: 'searched' };
  }
  if (v) slashFrom[v.from]++;
  if (!v) { problems.push(`no playable voicing for ${name}`); continue; }
  slash[key] = CD.encode(v);
}

// ---- write the tables ----------------------------------------------------

const qs = Object.keys(voicings);
const voicingsSrc = '  const VOICINGS = {\n' + qs.map(q =>
  `    ${JSON.stringify(q)}: [${voicings[q].map(v => JSON.stringify(v)).join(', ')}],`).join('\n') + '\n  };\n';
const slashKeys = Object.keys(slash).sort((a, b) => {
  const [qa, ra, ba] = a.split(' '), [qb, rb, bb] = b.split(' ');
  return qs.indexOf(qa) - qs.indexOf(qb) || ra - rb || ba - bb;
});
const slashSrc = '  // "quality root bass" (pitch classes, C = 0) -> voicing\n  const SLASH = {\n' +
  slashKeys.map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(slash[k])},`).join('\n') + '\n  };\n';

const START = '  // ==== GENERATED by scripts/build-chord-diagrams.js - do not edit by hand ====\n';
const END = '  // ==== end GENERATED ====\n';
const src = fs.readFileSync(CHORDS_JS, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const text = src.replace(/\r\n/g, '\n');
const a = text.indexOf(START), b = text.indexOf(END);
if (a < 0 || b < a) throw new Error('GENERATED markers not found in js/chords.js');
const out = text.slice(0, a + START.length) + voicingsSrc + slashSrc + text.slice(b);
fs.writeFileSync(CHORDS_JS, out.replace(/\n/g, eol));

// ---- check what the page will do -----------------------------------------

delete require.cache[require.resolve(CHORDS_JS)];
CD = require(CHORDS_JS);
const unparsed = [], missing = [];
for (const name of [...shown].sort()) {
  const chord = CD.parseName(name);
  if (!chord) { if (names.has(name)) unparsed.push(name); continue; }
  const v = CD.resolve(name);
  if (!v || !CD.verify(v.frets, chord) || !CD.playable(v.frets, v.barres) || !CD.renderChordSVG(name)) missing.push(name);
}

console.log(`chords-db ${db.main && db.main.numberOfChords} voicings -> ${qs.length} qualities x 12 roots, ${slashKeys.length} slash chords (${slashFrom.db} from chords-db, ${slashFrom.built} built on its voicings, ${slashFrom.searched} found by search)`);
console.log(`names in songs: ${names.size}, shown in some key: ${shown.size}, without a diagram: ${missing.length}`);
if (unparsed.length) console.log('not chord names (fix the song): ' + unparsed.join(', '));
if (missing.length) console.log('MISSING: ' + missing.join(', '));
if (problems.length) console.log('PROBLEMS:\n  ' + problems.join('\n  '));
process.exit(missing.length || problems.length ? 1 : 0);
