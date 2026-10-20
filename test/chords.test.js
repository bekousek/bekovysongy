'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const CD = require('../js/chords.js');
const { transposeChord } = require('../js/chord-theory.js');

const ROOT = path.join(__dirname, '..');
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
// Open strings low to high, as pitch classes - worked out here again rather
// than taken from chords.js, so the tone checks below are independent of it.
const OPEN = [4, 9, 2, 7, 11, 4];
const tones = (frets) => new Set(frets.map((f, i) => (f < 0 ? null : (OPEN[i] + f) % 12)).filter(x => x !== null));
const shape = (s) => s.split(' ').map(x => (x === 'x' ? -1 : Number(x)));

// Song data that isn't a chord name; fix the song, then drop it from here.
const NOT_CHORDS = new Set(['EHDA', 'HH']);

function songChordNames() {
  const names = new Set();
  JSON.parse(fs.readFileSync(path.join(ROOT, 'songs.json'), 'utf8')).songs
    .forEach(s => (s.chords || []).forEach(c => names.add(c.trim())));
  const dir = path.join(ROOT, 'songs');
  fs.readdirSync(dir).filter(f => f.endsWith('.html')).forEach(f => {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/data-chord="([^"]+)"/g)) names.add(m[1].trim());
  });
  return names;
}

test('every chord the songs use has a diagram in every key', () => {
  const missing = [];
  for (const name of songChordNames()) {
    if (NOT_CHORDS.has(name)) continue;
    for (let t = 0; t < 12; t++) {
      const shown = transposeChord(name, t);
      const chord = CD.parseName(shown);
      const v = CD.resolve(shown);
      if (!chord || !v || !CD.verify(v.frets, chord) || !CD.playable(v.frets, v.barres) || !CD.renderChordSVG(shown)) {
        missing.push(shown);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'chords without a correct diagram');
});

// The shapes a Czech songbook draws, checked note by note against the
// chord's tones written out by hand.
const KNOWN = {
  'C':     ['x 3 2 0 1 0', ['C', 'E', 'G']],
  'F':     ['1 3 3 2 1 1', ['F', 'A', 'C']],
  'H':     ['x 2 4 4 4 2', ['H', 'D#', 'F#']],
  'B':     ['x 1 3 3 3 1', ['B', 'D', 'F']],
  'Ami':   ['x 0 2 2 1 0', ['A', 'C', 'E']],
  'C#mi':  ['x 4 6 6 5 4', ['C#', 'E', 'G#']],
  'F#mi':  ['2 4 4 2 2 2', ['F#', 'A', 'C#']],
  'Hmi':   ['x 2 4 4 3 2', ['H', 'D', 'F#']],
  'Gmi':   ['3 5 5 3 3 3', ['G', 'B', 'D']],
  'H7':    ['x 2 1 2 0 2', ['H', 'D#', 'F#', 'A']],
  'G#mi7': ['4 6 4 4 4 4', ['G#', 'H', 'D#', 'F#']],
  'Amaj7': ['x 0 2 1 2 0', ['A', 'C#', 'E', 'G#']],
  'Dmaj7': ['x x 0 2 2 2', ['D', 'F#', 'A', 'C#']],
  'Cmaj7': ['x 3 2 0 0 0', ['C', 'E', 'G', 'H']],
  'D/F#':  ['2 x 0 2 3 2', ['F#', 'D', 'A']],
  'C/G':   ['3 3 2 0 1 0', ['G', 'C', 'E']],
  'G/H':   ['x 2 0 0 0 3', ['H', 'G', 'D']],
};
for (const [name, [frets, expected]] of Object.entries(KNOWN)) {
  test(`${name} is ${frets} and sounds ${expected.join(' ')}`, () => {
    const v = CD.resolve(name);
    assert.ok(v, `${name}: no voicing`);
    assert.deepEqual(v.frets, shape(frets));
    assert.deepEqual([...tones(v.frets)].map(i => NOTES[i]).sort(), [...expected].sort());
  });
}

test('the lowest sounding note is the root, or the bass of a slash chord', () => {
  for (const [name, bass] of [['Cmaj7', 'C'], ['H', 'H'], ['C#mi', 'C#'], ['D/F#', 'F#'], ['Ami/G', 'G']]) {
    const v = CD.resolve(name);
    const lowest = v.frets.findIndex(f => f >= 0);
    assert.equal(NOTES[(OPEN[lowest] + v.frets[lowest]) % 12], bass, name);
  }
});

test('the ways songs write the same chord give the same diagram', () => {
  for (const [a, b] of [['A7maj', 'Amaj7'], ['E7/4', 'E7sus4'], ['D4sus', 'Dsus4'], ['Am', 'Ami'], ['D2', 'Dsus2'],
    ['Emi7+g', 'Emi7'], ['Cmaj', 'C'], ['Ab', 'G#'], ['Eb', 'D#'], ['Db/F', 'C#/F']]) {
    assert.deepEqual(CD.resolve(a), CD.resolve(b), `${a} = ${b}`);
  }
});

test('no diagram for something that is not a chord', () => {
  for (const name of ['EHDA', 'HH', 'Xmi', 'C/', 'Cfoo', '']) assert.equal(CD.renderChordSVG(name), null, name);
});

test('a chord up the neck is drawn from its own fret, with every dot on the grid', () => {
  const svg = CD.renderChordSVG('C#mi');           // x 4 6 6 5 4
  assert.match(svg, />4<\/text>/, 'fret number 4 at the side');
  const dots = [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)" r="4.5"/g)].map(m => Number(m[1]));
  assert.equal(dots.length, 3, 'three dots above the barre');
  dots.forEach(y => assert.ok(y > 18 && y < 90, `dot at y=${y} off the grid`));
  assert.match(svg, /stroke-width="7"/, 'the barre');
});

test('every stored voicing is playable and sounds its chord', () => {
  for (const [q, list] of Object.entries(CD.VOICINGS)) {
    list.forEach((code, root) => {
      const v = CD.decode(code);
      assert.ok(CD.playable(v.frets, v.barres), `${NOTES[root]} ${q}: ${code}`);
      assert.ok(CD.verify(v.frets, { root, quality: q, bass: null }), `${NOTES[root]} ${q}: ${code}`);
    });
  }
  for (const [key, code] of Object.entries(CD.SLASH)) {
    const [quality, root, bass] = key.split(' ');
    const v = CD.decode(code);
    assert.ok(CD.verify(v.frets, { root: Number(root), quality, bass: Number(bass) }), `${key}: ${code}`);
  }
});
