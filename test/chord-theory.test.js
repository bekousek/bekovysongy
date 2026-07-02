'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ChordTheory = require('../js/chord-theory.js');

test('parseChord: extracts root and suffix', () => {
  assert.deepEqual(ChordTheory.parseChord('Ami7'), { noteIndex: 9, suffix: 'mi7' });
  assert.deepEqual(ChordTheory.parseChord('F#'), { noteIndex: 6, suffix: '' });
  assert.deepEqual(ChordTheory.parseChord('Bb'), { noteIndex: 10, suffix: '' });
});

test('parseChord: returns null for an unrecognized root', () => {
  assert.equal(ChordTheory.parseChord('X7'), null);
});

test('transposeChord: simple up/down transposition', () => {
  assert.equal(ChordTheory.transposeChord('C', 2), 'D');
  assert.equal(ChordTheory.transposeChord('D', -2), 'C');
});

test('transposeChord: wraps around the octave', () => {
  assert.equal(ChordTheory.transposeChord('H', 1), 'C');
  assert.equal(ChordTheory.transposeChord('C', -1), 'H');
});

test('transposeChord: 0 semitones is a no-op (stable under repeated transpose-to-origin)', () => {
  assert.equal(ChordTheory.transposeChord('Emi7', 0), 'Emi7');
});

test('transposeChord: slash chords transpose both root and bass', () => {
  assert.equal(ChordTheory.transposeChord('D/F#', 2), 'E/G#');
  assert.equal(ChordTheory.transposeChord('Emi7/H', 2), 'F#mi7/C#');
});

test('transposeChord: unrecognized chord is returned unchanged', () => {
  assert.equal(ChordTheory.transposeChord('X7', 3), 'X7');
});
