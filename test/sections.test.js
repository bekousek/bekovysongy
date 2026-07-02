'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SongSections = require('../js/sections.js');

test('hasSections: false for plain unmarked text', () => {
  assert.equal(SongSections.hasSections('1. Verse one\n\n2. Verse two'), false);
});

test('hasSections: true when a marker is present', () => {
  assert.equal(SongSections.hasSections('Verse\n\nR: Chorus text'), true);
});

test('marker aliases are all recognized (case-insensitive, with number)', () => {
  const cases = ['R:', 'r:', 'R1:', 'Ref:', 'Refrén:', 'Refren:', 'S:', 'Sloka:', 'B:', 'Bridge:', 'R.'];
  for (const marker of cases) {
    const blocks = SongSections.parseBlocks(`${marker} body text`);
    assert.equal(blocks.length, 1, `expected one block for "${marker}"`);
    assert.equal(blocks[0].marker, true, `expected "${marker}" to be recognized as a marker`);
  }
});

test('marker classification: R/S/B map to refren/sloka/bridge', () => {
  assert.equal(SongSections._matchMarker('R: x').type, 'refren');
  assert.equal(SongSections._matchMarker('S: x').type, 'sloka');
  assert.equal(SongSections._matchMarker('B: x').type, 'bridge');
  assert.equal(SongSections._matchMarker('Plain line'), null);
});

test('transform: first refrén occurrence is not marked as repeat', () => {
  const out = SongSections.transform('R: Chorus line one\n\nSecond verse');
  assert.match(out, /class="song-section section-refren"[^>]*>/);
  assert.doesNotMatch(out.split('section-plain')[0], /is-repeat/);
});

test('transform: second occurrence of the same marker collapses as a repeat', () => {
  const html = 'R: Chorus body\n\nVerse two\n\nR: Chorus body';
  const out = SongSections.transform(html);
  const matches = out.match(/section-refren( is-repeat)?/g);
  assert.equal(matches.length, 2);
  assert.equal(matches[0], 'section-refren');
  assert.equal(matches[1], 'section-refren is-repeat');
});

test('transform: empty repeat reference is filled from the first occurrence', () => {
  const html = 'R: Chorus body here\n\nVerse two\n\nR:';
  const out = SongSections.transform(html);
  const bodies = [...out.matchAll(/<span class="section-body">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  // First is the chorus body, last (repeat reference) should have been filled with the same text.
  assert.equal(bodies[0], 'Chorus body here');
  assert.equal(bodies[bodies.length - 1], 'Chorus body here');
});

test('transform: distinct marker ids (R: vs R2:) are independent, neither is a repeat', () => {
  const html = 'R: First hook\n\nR2: Second hook';
  const out = SongSections.transform(html);
  assert.doesNotMatch(out, /is-repeat/);
});

test('transform: unmarked block stays a plain section', () => {
  const out = SongSections.transform('Just a verse, no marker');
  assert.match(out, /class="song-section section-plain"/);
});

test('parseBlocks: dedents an indented marker body', () => {
  const blocks = SongSections.parseBlocks('R: first line\n    second line\n    third line');
  assert.equal(blocks[0].lines[1], 'second line');
  assert.equal(blocks[0].lines[2], 'third line');
});

test('parseBlocks: merges an indented unmarked continuation into the preceding marker block', () => {
  // Documents existing behavior: old songs split a chorus across a blank line,
  // keeping the second half indented so it's absorbed back into the chorus
  // rather than becoming its own verse. An UNINDENTED continuation is not merged.
  const merged = SongSections.parseBlocks('R: first half\n\n  indented second half');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].lines.join('\n'), 'first half\n\nindented second half');

  const notMerged = SongSections.parseBlocks('R: first half\n\nunindented text');
  assert.equal(notMerged.length, 2);
  assert.equal(notMerged[1].marker, false);
});

test('transform: chord spans inside a marked line are preserved verbatim', () => {
  const html = 'R: <span class="chord" data-chord="Ami">Ami</span>text';
  const out = SongSections.transform(html);
  assert.match(out, /<span class="chord" data-chord="Ami">Ami<\/span>text/);
});

test('normalizeBreaks (via hasSections) treats <br>/<div> as line breaks', () => {
  // A marker only counts if it starts its own line - <br> must act as a real newline.
  assert.equal(SongSections.hasSections('Verse one<br>R: Chorus'), true);
  assert.equal(SongSections.hasSections('<div>Verse one</div><div>R: Chorus</div>'), true);
});
