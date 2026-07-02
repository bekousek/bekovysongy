'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderChordSVG, CHORD_DB } = require('../js/chords.js');

// Mirrors the NOTES array used across the codebase (player.js/song-cleanup.js).
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
// Open-string note index per position, [E,A,D,G,B,e] (same order CHORD_DB uses).
const OPEN = [4, 9, 2, 7, 11, 4];

function soundingTones(frets) {
  const tones = new Set();
  frets.forEach((f, i) => {
    if (f === -1) return;
    tones.add((OPEN[i] + f) % 12);
  });
  return tones;
}

test('every CHORD_DB entry has a well-formed frets array and baseFret', () => {
  for (const [name, chord] of Object.entries(CHORD_DB)) {
    assert.equal(chord.frets.length, 6, `${name}: frets must have 6 entries`);
    chord.frets.forEach(f => {
      assert.ok(Number.isInteger(f) && f >= -1 && f <= 20, `${name}: invalid fret value ${f}`);
    });
    assert.ok(Number.isInteger(chord.baseFret) && chord.baseFret >= 1, `${name}: invalid baseFret`);
  }
});

test('renderChordSVG returns SVG markup for every known chord, null for unknown', () => {
  for (const name of Object.keys(CHORD_DB)) {
    const svg = renderChordSVG(name);
    assert.ok(svg && svg.startsWith('<svg'), `${name}: expected SVG output`);
  }
  assert.equal(renderChordSVG('NotAChord'), null);
});

// Cross-checks the newly-added movable barre shapes against their actual
// musical content (which notes physically sound), not just the shape pattern.
// Each expected set was independently derived from chord theory, then
// verified again here against the fret data - two derivations agreeing is
// much stronger evidence of correctness than either alone.
const EXPECTED_TONES = {
  'G#':    ['G#', 'C', 'D#'],
  'Ab':    ['G#', 'C', 'D#'],
  'Db':    ['C#', 'F', 'G#'],
  'Gb':    ['F#', 'B', 'C#'],
  'D#':    ['D#', 'G', 'B'],
  'Bmi':   ['B', 'C#', 'F'],
  'Ebmi':  ['D#', 'F#', 'B'],
  'C#7':   ['C#', 'F', 'G#', 'H'],
  'F#7':   ['F#', 'B', 'C#', 'E'],
  'C#mi7': ['C#', 'E', 'G#', 'H'],
  'D#mi7': ['D#', 'F#', 'B', 'C#'],
  'Hmi7':  ['H', 'D', 'F#', 'A'],
};

for (const [name, expectedNames] of Object.entries(EXPECTED_TONES)) {
  test(`${name}: fretted notes match the chord's actual tones`, () => {
    const chord = CHORD_DB[name];
    assert.ok(chord, `${name} missing from CHORD_DB`);
    const actual = [...soundingTones(chord.frets)].map(i => NOTES[i]).sort();
    const expected = [...new Set(expectedNames)].sort();
    assert.deepEqual(actual, expected, `${name}: expected tones ${expected}, got ${actual}`);
  });
}
