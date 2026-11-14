'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ChordTheory = require('../js/chord-theory.js');

const { transposeChord, preferFlats, parse, isChord } = ChordTheory;
const ROOT = path.join(__dirname, '..');

// Every chord name the songbook uses, in the pages and in songs.json.
function dataChordNames() {
  const names = new Set();
  JSON.parse(fs.readFileSync(path.join(ROOT, 'songs.json'), 'utf8')).songs.forEach(s => {
    (s.chords || []).forEach(c => names.add(c));
    (s.progression || []).forEach(g => g.forEach(c => names.add(c)));
  });
  const dir = path.join(ROOT, 'songs');
  fs.readdirSync(dir).filter(f => f.endsWith('.html')).forEach(f => {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/data-chord="([^"]+)"/g)) names.add(m[1]);
  });
  return [...names];
}

test('parseChord: extracts root and suffix', () => {
  assert.deepEqual(ChordTheory.parseChord('Ami7'), { noteIndex: 9, suffix: 'mi7' });
  assert.deepEqual(ChordTheory.parseChord('F#'), { noteIndex: 6, suffix: '' });
  assert.deepEqual(ChordTheory.parseChord('Bb'), { noteIndex: 10, suffix: '' });
});

test('parseChord: returns null for an unrecognized root', () => {
  assert.equal(ChordTheory.parseChord('X7'), null);
});

test('parse: root, suffix and a slash bass; a slash before a non-note is suffix', () => {
  assert.deepEqual(parse('Ami7/G'), { root: 9, suffix: 'mi7', bass: 7 });
  assert.deepEqual(parse('E7/4'), { root: 4, suffix: '7/4', bass: null });
  assert.deepEqual(parse('H'), { root: 11, suffix: '', bass: null });
  assert.deepEqual(parse('Eb'), { root: 3, suffix: '', bass: null });
  assert.equal(parse('Xmi'), null);
  assert.equal(parse(''), null);
});

test('isChord: the strict grammar plus the songbook\'s own odd names', () => {
  for (const ok of ['C', 'Ami', 'F#mi7', 'Hmi7b5', 'Dsus4', 'D4sus', 'Cadd9', 'Ami9/Eb', 'G/H', 'Emi7+g', 'A7maj', 'E7/4', 'H7/4', 'D7+']) {
    assert.equal(isChord(ok), true, ok);
  }
  for (const bad of ['CEF', 'CGC', 'Es', 'Fis', 'ami', 'Ale', 'Den', 'X7', '', 'C/']) {
    assert.equal(isChord(bad), false, bad);
  }
});

test('transposeChord: simple up/down transposition', () => {
  assert.equal(transposeChord('C', 2), 'D');
  assert.equal(transposeChord('D', -2), 'C');
});

test('transposeChord: wraps around the octave', () => {
  assert.equal(transposeChord('H', 1), 'C');
  assert.equal(transposeChord('C', -1), 'H');
});

test('transposeChord: Czech H and B never mix up', () => {
  assert.equal(transposeChord('A', 1), 'B');
  assert.equal(transposeChord('B', 1), 'H');
  assert.equal(transposeChord('H', 1), 'C');
  assert.equal(transposeChord('A', 1, true), 'B', 'B is B in the flat spelling too');
});

test('transposeChord: slash chords transpose both root and bass', () => {
  assert.equal(transposeChord('D/F#', 2), 'E/G#');
  assert.equal(transposeChord('Emi7/H', 2), 'F#mi7/C#');
  assert.equal(transposeChord('Ab/H', 0, true), 'Ab/H');
});

test('transposeChord: suffixes stay, "E7/4" keeps its 4', () => {
  assert.equal(transposeChord('E7/4', 2), 'F#7/4');
  assert.equal(transposeChord('H7/4', 1), 'C7/4');
  assert.equal(transposeChord('Emi7+g', 3), 'Gmi7+g');
});

test('transposeChord: a name that isn\'t a chord comes back as it was', () => {
  assert.equal(transposeChord('X7', 3), 'X7');
  assert.equal(transposeChord('CEF', 1), 'CEF');
  assert.equal(transposeChord('Es', 2), 'Es');
  assert.equal(transposeChord('Fis', 2), 'Fis');
});

test('transposeChord: with flats', () => {
  assert.equal(transposeChord('Eb', 3, true), 'Gb');
  assert.equal(transposeChord('C', 1, true), 'Db');
  assert.equal(transposeChord('Ami', 1, true), 'Bmi');
});

// A song is spelled one way throughout.
const KEY = ['C', 'F', 'G', 'Ami'];
const inKey = (n) => { const f = preferFlats(KEY, n); return KEY.map(c => transposeChord(c, n, f)); };

test('preferFlats: B Eb F, never B D# F', () => {
  assert.equal(preferFlats(KEY, -2), true);
  assert.equal(preferFlats(KEY, 4), false);
  assert.deepEqual(inKey(-2), ['B', 'Eb', 'F', 'Gmi']);
  assert.deepEqual(inKey(3), ['Eb', 'Ab', 'B', 'Cmi']);
  assert.deepEqual(inKey(1), ['Db', 'Gb', 'Ab', 'Bmi']);
  assert.deepEqual(inKey(4), ['E', 'A', 'H', 'C#mi']);
  assert.deepEqual(inKey(2), ['D', 'G', 'A', 'Hmi']);
});

test('preferFlats: a major key\'s I IV V vi never mixes B with D# or G#, in any key', () => {
  // (A chromatic song may need B next to D#: Czech never writes A#.)
  for (let n = 0; n < 12; n++) {
    const flats = preferFlats(KEY, n);
    const roots = KEY.map(c => transposeChord(c, n, flats).replace(/mi$/, ''));
    assert.ok(!(roots.includes('B') && (roots.includes('D#') || roots.includes('G#'))), `${n}: ${roots.join(' ')}`);
    assert.ok(!(roots.some(r => r.includes('#')) && roots.some(r => /b$/.test(r))), `${n}: ${roots.join(' ')}`);
  }
});

test('every chord name in the data is a chord', () => {
  const bad = dataChordNames().filter(n => !isChord(n));
  assert.deepEqual(bad, []);
});

test('every name from the data, moved up by n and back, is the same chord again', () => {
  for (const name of dataChordNames()) {
    const p0 = parse(name);
    for (let n = 1; n < 12; n++) {
      for (const flats of [false, true]) {
        const back = transposeChord(transposeChord(name, n, flats), -n, flats);
        const p = parse(back);
        assert.ok(p, `${name} +${n} -${n} -> ${back}`);
        assert.equal(p.root, p0.root, `${name} +${n} -${n} -> ${back}`);
        assert.equal(p.bass, p0.bass, `${name} +${n} -${n} -> ${back}`);
        assert.equal(p.suffix, p0.suffix, `${name} +${n} -${n} -> ${back}`);
      }
    }
  }
});

test('0 semitones keeps every name from the data (sharp spelling of the same notes)', () => {
  for (const name of dataChordNames()) {
    const p0 = parse(name);
    const p = parse(transposeChord(name, 0));
    assert.deepEqual([p.root, p.suffix, p.bass], [p0.root, p0.suffix, p0.bass], name);
  }
});
