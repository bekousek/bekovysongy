'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const AuthorSuggest = require('../js/author-suggest.js');

// One array per song, the shape editor.js feeds buildIndex().
const SONGS = [
  ['Chinaski'], ['Chinaski'], ['Chinaski'],
  ['Karel Kryl'], ['Karel Kryl'],
  ['Karel Plíhal'],
  ['Xindl-X'], ['Xindl-X'],
  ['Xindl X'],
  ['Poletíme?'],
  ['Kabát', 'Chinaski']
];

const INDEX = AuthorSuggest.buildIndex(SONGS);
const names = (rows) => rows.map(r => r.name);

test('buildIndex: counts songs per spelling, most used first', () => {
  assert.deepEqual(INDEX[0], { name: 'Chinaski', count: 4 });
  assert.deepEqual(INDEX[1], { name: 'Karel Kryl', count: 2 });
  assert.equal(INDEX.find(r => r.name === 'Xindl X').count, 1);
});

test('buildIndex: the same name twice in one song counts once', () => {
  const idx = AuthorSuggest.buildIndex([['Lucie', 'Lucie', ' Lucie ']]);
  assert.deepEqual(idx, [{ name: 'Lucie', count: 1 }]);
});

test('buildIndex: blanks and nullish entries are dropped', () => {
  const idx = AuthorSuggest.buildIndex([['', '   ', null, undefined, 'Zrní'], null]);
  assert.deepEqual(idx, [{ name: 'Zrní', count: 1 }]);
});

test('match: empty query offers the most used spellings', () => {
  assert.deepEqual(names(AuthorSuggest.match(INDEX, '', { limit: 2 })), ['Chinaski', 'Karel Kryl']);
});

test('match: prefix beats a mid-word hit', () => {
  const rows = AuthorSuggest.match(INDEX, 'k');
  // The three prefix matches first (Kryl leads on song count, the other two
  // tie and go alphabetically), only then the "chinaski" hidden inside.
  assert.deepEqual(names(rows), ['Karel Kryl', 'Kabát', 'Karel Plíhal', 'Chinaski']);
});

test('match: a hit at a word start outranks one inside a word', () => {
  const rows = AuthorSuggest.match(INDEX, 'kryl');
  assert.equal(rows[0].name, 'Karel Kryl');
  const inside = AuthorSuggest.match(INDEX, 'ryl');
  assert.deepEqual(names(inside), ['Karel Kryl']);
});

test('match: ignores case and diacritics both ways', () => {
  assert.deepEqual(names(AuthorSuggest.match(INDEX, 'PLIHAL')), ['Karel Plíhal']);
  assert.deepEqual(names(AuthorSuggest.match(INDEX, 'poletime')), ['Poletíme?']);
});

test('match: ignores punctuation as a last resort, so near-duplicates surface', () => {
  // Typing the variant spelling is exactly when the established one must show.
  const rows = AuthorSuggest.match(INDEX, 'Xindl-X');
  assert.equal(rows[0].name, 'Xindl-X');
  assert.ok(names(rows).includes('Xindl X'));
  assert.equal(AuthorSuggest.match(INDEX, 'xindlx')[0].name, 'Xindl-X');
});

test('match: ties break by song count, so the established spelling leads', () => {
  const rows = AuthorSuggest.match(INDEX, 'xindl');
  assert.deepEqual(names(rows), ['Xindl-X', 'Xindl X']);
});

test('match: highlight offsets point into the original spelling', () => {
  const [row] = AuthorSuggest.match(INDEX, 'lihal');
  assert.equal(row.name.slice(row.from, row.to), 'líhal');
});

test('match: a loose-only hit has no highlight range', () => {
  const row = AuthorSuggest.match(INDEX, 'xindl x').find(r => r.name === 'Xindl-X');
  assert.equal(row.from, -1);
});

test('match: excluded names (already picked) are left out', () => {
  const rows = AuthorSuggest.match(INDEX, 'k', { exclude: ['Karel Kryl'] });
  assert.ok(!names(rows).includes('Karel Kryl'));
});

test('match: no match at all returns nothing', () => {
  assert.deepEqual(AuthorSuggest.match(INDEX, 'qqq'), []);
});

test('match: limit caps the list', () => {
  assert.equal(AuthorSuggest.match(INDEX, '', { limit: 3 }).length, 3);
});

test('fold: keeps a char-to-original map across decomposed diacritics', () => {
  const f = AuthorSuggest._fold('Plíhal');
  assert.equal(f.text, 'plihal');
  assert.equal(f.map[2], 2); // the folded "i" still points at "í"
  assert.equal(f.map[6], 6); // end sentinel
});
