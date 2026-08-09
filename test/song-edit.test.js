'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SongEdit = require('../js/song-edit.js');

const M = SongEdit.MARKER;
const chord = (n) => '<span class="chord" data-chord="' + n + '">' + n + '</span>';

function model(text, chords) {
  return { text: text, chords: chords || [] };
}

// A readable rendering of a model: chords as [Ami], newlines as \n.
function show(m) {
  let i = 0;
  return m.text.split('').map(c => (c === M ? '[' + m.chords[i++] + ']' : c)).join('');
}

test('parse: chord spans become one MARKER character each', () => {
  const m = SongEdit.parse(chord('Ami') + ' text ' + chord('G') + ' more');
  assert.strictEqual(m.text, M + ' text ' + M + ' more');
  assert.deepStrictEqual(m.chords, ['Ami', 'G']);
});

test('parse/render round-trips a body unchanged', () => {
  const html = chord('Ami') + ' Láska &amp; jaro\n' + chord('F') + ' večernice';
  assert.strictEqual(SongEdit.render(SongEdit.parse(html)), html);
});

test('splice keeps the chord list in step with the text', () => {
  const m = model(M + 'ab' + M + 'cd' + M, ['A', 'B', 'C']);
  // drop "ab" + the second chord + "c"
  const out = SongEdit.splice(m, 1, 5, '', []);
  assert.strictEqual(show(out), '[A]d[C]');
});

test('splice can insert chords of its own', () => {
  const m = model('ab', []);
  const out = SongEdit.splice(m, 1, 1, M + M, ['G', 'D']);
  assert.strictEqual(show(out), 'a[G][D]b');
});

// === The reported bugs ===

test('forward-deleting a newline before a chord removes only the newline', () => {
  // "prvni radek\n[Ami] druhy radek", caret at the end of line 1.
  const m = SongEdit.parse('prvni radek\n' + chord('Ami') + ' druhy radek');
  const at = 'prvni radek'.length;
  const out = SongEdit.remove(m, at, SongEdit.stepForward(m.text, at));
  assert.strictEqual(show(out.model), 'prvni radek[Ami] druhy radek');
  assert.strictEqual(out.from, at);
});

test('backspacing at the start of a line whose previous line ends in a chord removes only the newline', () => {
  const m = SongEdit.parse('radek ' + chord('G') + '\ndalsi');
  const at = m.text.indexOf('\n') + 1;
  const out = SongEdit.remove(m, SongEdit.stepBack(m.text, at), at);
  assert.strictEqual(show(out.model), 'radek [G]dalsi');
});

test('a selection spanning a chord is deleted in one go', () => {
  const m = SongEdit.parse('abc ' + chord('G') + ' def');
  const out = SongEdit.remove(m, 2, m.text.length - 1);
  assert.strictEqual(show(out.model), 'abf');
  assert.deepStrictEqual(out.model.chords, []);
});

test('one backspace removes a whole chord, never part of one', () => {
  const m = SongEdit.parse('abc ' + chord('Ami') + ' def');
  const at = m.text.indexOf(M) + 1;
  const out = SongEdit.remove(m, SongEdit.stepBack(m.text, at), at);
  assert.strictEqual(show(out.model), 'abc  def');
  assert.deepStrictEqual(out.model.chords, []);
});

test('a chord at the very end and at the very start can both be deleted', () => {
  const tail = SongEdit.parse('abc ' + chord('G'));
  const t = SongEdit.remove(tail, SongEdit.stepBack(tail.text, tail.text.length), tail.text.length);
  assert.strictEqual(show(t.model), 'abc ');

  const head = SongEdit.parse(chord('G') + ' abc');
  const h = SongEdit.remove(head, 0, SongEdit.stepForward(head.text, 0));
  assert.strictEqual(show(h.model), ' abc');
});

test('deleting at the very start or very end is a no-op', () => {
  const m = model('abc', []);
  assert.strictEqual(SongEdit.stepBack(m.text, 0), 0);
  assert.strictEqual(SongEdit.stepForward(m.text, 3), 3);
});

test('surrogate pairs are one unit', () => {
  const m = model('a🎸', []); // guitar emoji
  assert.strictEqual(SongEdit.stepBack(m.text, 3), 1);
  assert.strictEqual(SongEdit.stepForward(m.text, 1), 3);
});

// === Word / line units ===

test('word delete treats a chord as one word and stops at a line break', () => {
  const m = SongEdit.parse('prvni ' + chord('Ami') + ' druhy');
  assert.strictEqual(SongEdit.wordBack(m.text, m.text.length), m.text.length - 'druhy'.length);
  const afterChord = m.text.indexOf(M) + 1;
  assert.strictEqual(SongEdit.wordBack(m.text, afterChord), afterChord - 1);
  const nl = model('radek\ndalsi', []);
  assert.strictEqual(SongEdit.wordBack(nl.text, 6), 5); // just the break
});

test('line delete goes to the start of the line, or eats the break at column 0', () => {
  const m = model('prvni\ndruhy radek', []);
  assert.strictEqual(SongEdit.lineBack(m.text, m.text.length), 6);
  assert.strictEqual(SongEdit.lineBack(m.text, 6), 5);
  assert.strictEqual(SongEdit.lineForward(m.text, 0), 5);
});

// === Chord insertion ===

test('inserting a chord spaces it off from the word before it', () => {
  const out = SongEdit.insertChord(model('slovo', []), 5, 5, 'Ami');
  assert.strictEqual(show(out.model), 'slovo [Ami] ');
  assert.strictEqual(out.from, out.model.text.length);
});

test('inserting a chord at a line start adds no leading space', () => {
  const out = SongEdit.insertChord(model('a\n', []), 2, 2, 'G');
  assert.strictEqual(show(out.model), 'a\n[G] ');
});

test('inserting a chord replaces the selection', () => {
  const m = SongEdit.parse('abc ' + chord('D') + ' def');
  const out = SongEdit.insertChord(m, 0, m.text.length, 'G');
  assert.strictEqual(show(out.model), '[G] ');
});

// === Fences ===

test('fencing a selection that starts with a chord keeps the chord a chord', () => {
  const m = SongEdit.parse(chord('Ami') + ' refren\ndruhy radek');
  const out = SongEdit.wrapFence(m, 0, m.text.length, 'R', false);
  assert.strictEqual(show(out.model), '//R\n[Ami] refren\ndruhy radek\nR//');
  assert.deepStrictEqual(out.model.chords, ['Ami']);
  assert.strictEqual(out.from, out.model.text.length);
});

test('fencing mid-line breaks the line first', () => {
  const out = SongEdit.wrapFence(model('abc def', []), 4, 7, 'R', false);
  assert.strictEqual(show(out.model), 'abc \n//R\ndef\nR//');
});

test('an empty fence parks the caret between the markers', () => {
  const out = SongEdit.wrapFence(model('', []), 0, 0, 'R', false);
  assert.strictEqual(show(out.model), '//R\n\nR//');
  assert.strictEqual(out.from, '//R\n'.length);
});

test('a repeat brackets the selection inline', () => {
  const m = SongEdit.parse('a ' + chord('G') + ' b');
  const out = SongEdit.wrapFence(m, 0, m.text.length, ':', true);
  assert.strictEqual(show(out.model), '//: a [G] b ://');
});

test('the fenced result still parses as the section it claims to be', () => {
  const SongSections = require('../js/sections.js');
  const m = SongEdit.parse(chord('Ami') + ' refren');
  const out = SongEdit.wrapFence(m, 0, m.text.length, 'R', false);
  const blocks = SongSections.parseBlocks(SongEdit.render(out.model));
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].type, 'refren');
  assert.strictEqual(blocks[0].fenced, true);
});
