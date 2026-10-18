'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ChordSheet = require('../js/chord-sheet.js');
const SongEdit = require('../js/song-edit.js');
const SongSections = require('../js/sections.js');

const M = ChordSheet.MARKER;

// A readable rendering of a result: chords as [Ami], newlines as \n.
function show(res) {
  let i = 0;
  return res.text.split('').map(c => (c === M ? '[' + res.chords[i++] + ']' : c)).join('');
}

function convert(lines) {
  return ChordSheet.convert(lines.join('\n'));
}

test('marker is the editor model marker', () => {
  assert.strictEqual(M, SongEdit.MARKER);
});

test('no chord line: null, so the paste stays ordinary', () => {
  assert.strictEqual(ChordSheet.convert('aaa bbb\nccc ddd'), null);
  assert.strictEqual(ChordSheet.convert(''), null);
});

test('chord above the start of a word lands before that word', () => {
  const res = convert([
    'C       G',
    'aaaa    bbbb cc'
  ]);
  assert.strictEqual(show(res), '[C] aaaa [G] bbbb cc');
  assert.strictEqual(res.count, 2);
});

test('chord above the middle of a word moves to the word start', () => {
  const res = convert([
    '   Ami     F',
    'aaaaaa bbbbbbb'
  ]);
  assert.strictEqual(show(res), '[Ami] aaaaaa [F] bbbbbbb');
});

test('chord above a gap belongs to the next word', () => {
  const res = convert([
    '     D',
    'aaaa   bbb'
  ]);
  assert.strictEqual(show(res), 'aaaa [D] bbb');
});

test('chord past the end of the words trails after them', () => {
  const res = convert([
    'G              C',
    'aaa bbb'
  ]);
  assert.strictEqual(show(res), '[G] aaa bbb [C]');
});

test('two chords over one word both stand before it', () => {
  const res = convert([
    'C  G',
    'aaaaaaa bbb'
  ]);
  assert.strictEqual(show(res), '[C] [G] aaaaaaa bbb');
});

test('chord line with nothing under it becomes a line of chords', () => {
  const res = convert([
    'C  G  Ami  F',
    '',
    'D',
    'aaa'
  ]);
  assert.strictEqual(show(res), '[C] [G] [Ami] [F]\n\n[D] aaa');
});

test('English notation: m -> mi, B -> H, Bb -> B, slash bass too', () => {
  const res = convert([
    'Am   F#m7  B7   Bb   G/B  Cmaj7 Dsus4',
    'aa   bb    cc   dd   ee   ff    gg'
  ]);
  assert.deepStrictEqual(res.chords, ['Ami', 'F#mi7', 'H7', 'B', 'G/H', 'Cmaj7', 'Dsus4']);
  assert.strictEqual(res.bToH, true);
});

test('Czech notation stays as it is: H is H, B is B flat', () => {
  const res = convert([
    'Ami  H7  B   F',
    'aa   bb  cc  dd'
  ]);
  assert.deepStrictEqual(res.chords, ['Ami', 'H7', 'B', 'F']);
  assert.strictEqual(res.bToH, false);
});

test('a bare B is read by the key: D A Bm G is H minor, F C Dm B is B flat', () => {
  assert.deepStrictEqual(convert(['D  A  Bm  G', 'a  b  c   d']).chords, ['D', 'A', 'Hmi', 'G']);
  assert.deepStrictEqual(convert(['F  C  Dm  B', 'a  b  c   d']).chords, ['F', 'C', 'Dmi', 'B']);
});

test('German note names and other spellings', () => {
  assert.strictEqual(ChordSheet.chordName('Fis'), 'F#');
  assert.strictEqual(ChordSheet.chordName('Es'), 'Eb');
  assert.strictEqual(ChordSheet.chordName('Cmin'), 'Cmi');
  assert.strictEqual(ChordSheet.chordName('CM7'), 'Cmaj7');
  assert.strictEqual(ChordSheet.chordName('A#'), 'B');
  assert.strictEqual(ChordSheet.chordName('Edim'), 'Edim');
  assert.strictEqual(ChordSheet.chordName('(C)'), 'C');
});

test('a lyric line starting with the word "A" is not a chord line', () => {
  assert.strictEqual(ChordSheet.convert('A aaa bbb\nA ccc'), null);
  assert.strictEqual(ChordSheet.parseChord('Ale'), null);
  assert.strictEqual(ChordSheet.parseChord('Den'), null);
  assert.strictEqual(ChordSheet.parseChord('Hej'), null);
});

test('inline [C] chords (ChordPro) land at word starts too', () => {
  const res = ChordSheet.convert('[C]aaa bb[G]bb [Am]ccc');
  assert.strictEqual(show(res), '[C] aaa [G] bbbb [Ami] ccc');
});

test('bracketed chord rows keep their columns', () => {
  const res = convert([
    '[C]     [G]',
    'aaaa    bbbb'
  ]);
  assert.strictEqual(show(res), '[C] aaaa [G] bbbb');
});

test('labelled chorus is fenced, its word-for-word repeat collapses', () => {
  const res = convert([
    '[Verse 1]',
    'C   G',
    'aaa bbb ccc',
    '',
    '[Chorus]',
    'F   C',
    'ddd eee',
    'fff ggg',
    '',
    '[Verse 2]',
    'hhh iii',
    '',
    '[Chorus]',
    'F       C',
    'ddd eee',
    'fff ggg'
  ]);
  assert.strictEqual(show(res),
    '[C] aaa [G] bbb ccc\n\n' +
    '//R [F] ddd [C] eee\nfff ggg R//\n\n' +
    'hhh iii\n\n' +
    '//R R//');
  // the repeat's own copy of the chords is gone with it
  assert.deepStrictEqual(res.chords, ['C', 'G', 'F', 'C']);
});

test('Czech prefix labels: R: on the first line, verse numbers dropped', () => {
  const res = convert([
    '   C   G',
    '1. aaa bbb ccc',
    '',
    'R: ddd eee',
    'fff',
    '',
    'Ref.'
  ]);
  assert.strictEqual(show(res), '[C] aaa [G] bbb ccc\n\n//R ddd eee\nfff R//\n\n//R R//');
});

test('a label on the chord line keeps the columns of the words below', () => {
  const res = convert([
    'R:  C    G',
    '    aaa  bbb'
  ]);
  assert.strictEqual(show(res), '//R [C] aaa [G] bbb R//');
});

test('changed chorus is not collapsed', () => {
  const res = convert(['[Chorus]', 'aaa C', '', '[Chorus]', 'aaa bbb', 'C']);
  assert.ok(!/R R\/\//.test(res.text));
});

test('intro chords get a Czech label on their line', () => {
  const res = convert(['[Intro]', 'C G Am F', '', 'C', 'aaa']);
  assert.strictEqual(show(res), 'Předehra: [C] [G] [Ami] [F]\n\n[C] aaa');
});

test('play count on a chord line is kept as text', () => {
  const res = convert(['C  G  2x', '', 'D', 'aaa']);
  assert.strictEqual(show(res), '[C] [G] 2x\n\n[D] aaa');
});

test('blank lines collapse to one, padding inside words collapses', () => {
  const res = convert(['C', 'aaa    bbb', '', '', '', 'G', 'ccc']);
  assert.strictEqual(show(res), '[C] aaa bbb\n\n[G] ccc');
});

test('tabs and non-breaking spaces keep the columns', () => {
  const res = ChordSheet.convert('\tG\naaaaaaaa bbb   ccc');
  // the tab puts G at column 8, over "bbb"
  assert.strictEqual(show(res), 'aaaaaaaa [G] bbb ccc');
});

test('the result renders and parses as the songbook would', () => {
  const res = convert(['[Chorus]', 'Am      F', 'aaa bbb ccc', '', '[Chorus]', 'Am      F', 'aaa bbb ccc']);
  const html = SongEdit.render(res);
  const blocks = SongSections.parseBlocks(html);
  assert.strictEqual(blocks.length, 2);
  assert.ok(blocks.every(b => b.type === 'refren' && b.fenced));
  assert.deepStrictEqual(SongEdit.parse(html).chords, ['Ami', 'F']);
});

test('compareSources: same set, same set in another key, sevenths only, different', () => {
  assert.deepStrictEqual(ChordSheet.compareSources(['G', 'D', 'Emi', 'C'], ['C', 'G', 'D', 'Emi']),
    { level: 'same', shift: 0 });
  // a whole tone up from G C Emi Ami
  assert.deepStrictEqual(ChordSheet.compareSources(['G', 'C', 'Emi', 'Ami'], ['A', 'D', 'F#mi', 'Hmi']),
    { level: 'same', shift: 2 });
  assert.strictEqual(ChordSheet.compareSources(['G', 'D7', 'Emi7', 'Cadd9'], ['G', 'D', 'Emi', 'C']).level,
    'similar');
  // one source adds a passing chord: 4 of 5 shared is still the same song
  assert.strictEqual(ChordSheet.compareSources(['G', 'D', 'Emi', 'C', 'Hmi'], ['G', 'D', 'Emi', 'C']).level,
    'similar');
  assert.strictEqual(ChordSheet.compareSources(['G', 'D', 'Emi', 'C'], ['F', 'B', 'Dmi', 'Gmi', 'A7']).level,
    'different');
  assert.strictEqual(ChordSheet.compareSources([], ['G']), null);
});
