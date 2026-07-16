'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SongCleanup = require('../js/song-cleanup.js');

function chord(name) {
  return `<span class="chord" data-chord="${name}">${name}</span>`;
}

test('normalizeChordSpacing: collapses multiple spaces around a chord to exactly one', () => {
  const input = `text   ${chord('C')}   more`;
  const out = SongCleanup.normalizeChordSpacing(input);
  assert.equal(out, `text ${chord('C')} more`);
});

test('normalizeChordSpacing: inserts the missing space after a chord glued to following text', () => {
  const input = `${chord('Ami')}Text right after`;
  const out = SongCleanup.normalizeChordSpacing(input);
  assert.equal(out, `${chord('Ami')} Text right after`);
});

test('normalizeChordSpacing: a line-leading chord gets no space forced before it', () => {
  const input = `${chord('Ami')} text`;
  const out = SongCleanup.normalizeChordSpacing(input);
  assert.equal(out, `${chord('Ami')} text`);
});

test('normalizeChordSpacing: preserves leading indentation', () => {
  const input = `    indented ${chord('G')} text`;
  const out = SongCleanup.normalizeChordSpacing(input);
  assert.match(out, /^ {4}indented/);
});

test('normalizeChordSpacing: decodes a hex numeric char ref instead of double-escaping it', () => {
  const input = `I${chord('C')}don&#x27;t know`;
  const out = SongCleanup.normalizeChordSpacing(input);
  assert.equal(out, `I ${chord('C')} don't know`);
});

test('removeEmptyLines: strips blank lines but keeps lines that only contain a chord', () => {
  const input = `line one\n\n\nline two\n${chord('C')}\n\nline three`;
  const out = SongCleanup.removeEmptyLines(input);
  assert.equal(out, `line one\nline two\n${chord('C')}\nline three`);
});

test('parse/render round-trip preserves text and chord order', () => {
  const input = `Verse ${chord('Ami')} text ${chord('C')} end`;
  const model = SongCleanup._parse(input);
  assert.deepEqual(model.chords, ['Ami', 'C']);
  assert.equal(SongCleanup._render(model), input);
});

test('transposeSong: transposes a simple chord up and down', () => {
  assert.equal(SongCleanup.transposeSong(chord('C'), 2), chord('D'));
  assert.equal(SongCleanup.transposeSong(chord('D'), -2), chord('C'));
});

test('transposeSong: wraps around the octave in both directions', () => {
  assert.equal(SongCleanup.transposeSong(chord('H'), 1), chord('C'));
  assert.equal(SongCleanup.transposeSong(chord('C'), -1), chord('H'));
});

test('transposeSong: preserves chord suffix (minor/7th/etc)', () => {
  assert.equal(SongCleanup.transposeSong(chord('Ami7'), 2), chord('Hmi7'));
  assert.equal(SongCleanup.transposeSong(chord('Gsus4'), 1), chord('G#sus4'));
});

test('transposeSong: slash chords transpose both root and bass note', () => {
  assert.equal(SongCleanup.transposeSong(chord('D/F#'), 2), chord('E/G#'));
  assert.equal(SongCleanup.transposeSong(chord('C/G'), -1), chord('H/F#'));
});

test('transposeSong: unrecognized chord root is left unchanged', () => {
  assert.equal(SongCleanup.transposeSong(chord('X7')), chord('X7'));
});

test('_transposeChordFull: Czech H/B convention (H=international B, B=international Bb)', () => {
  // H up a semitone is C (H sits at index 11, same as international B).
  assert.equal(SongCleanup._transposeChordFull('H', 1), 'C');
  // B (Bb) up a semitone is H (Bb -> B international == H Czech).
  assert.equal(SongCleanup._transposeChordFull('B', 1), 'H');
});
