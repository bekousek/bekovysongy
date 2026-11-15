'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// The browser bits song-list-core.js touches, stubbed: storage and fetch.
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const SONGS = {
  songs: [
    { title: 'Anděl', slug: 'andel', author: 'Karel Kryl', chords: ['Ami', 'C'], tags: { language: 'CZ' } },
    { title: 'A pak', slug: 'a-pak', author: 'Tomáš Klus', chords: ['G', 'Hmi'], tags: { language: 'CZ', capo: 2 } },
    { title: 'Amerika', slug: 'amerika', author: 'Lucie', chords: ['Dmi', 'B'], tags: { language: 'CZ' } },
    { title: 'A Star Is Born', slug: 'a-star-is-born', author: 'Lady Gaga', chords: ['G', 'D', 'Eb'], tags: { language: 'EN' } },
  ],
};
let failNext = 0;
let fetches = 0;
global.fetch = async () => {
  fetches++;
  if (failNext > 0) { failNext--; throw new TypeError('Failed to fetch'); }
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(SONGS)) };
};

const SL = require('../js/song-list-core.js');
const stored = () => JSON.parse(store.get('bs_setlist'));

test('setlist: "Do večera" before songs.json is in keeps what was stored', () => {
  // The bug: list() filtered through the not-yet-loaded index came out
  // empty, toggle() wrote that back, and the evening was gone.
  store.set('bs_setlist', JSON.stringify(['andel', 'a-pak', 'amerika']));
  assert.deepEqual(SL.setlist.list(), [], 'nothing can be shown yet');
  assert.equal(SL.setlist.has('andel'), true, 'but it is still there');
  assert.equal(SL.setlist.toggle('a-star-is-born'), true);
  assert.deepEqual(stored(), ['andel', 'a-pak', 'amerika', 'a-star-is-born']);
  assert.equal(SL.setlist.toggle('a-pak'), false, 'removing works before the load too');
  assert.deepEqual(stored(), ['andel', 'amerika', 'a-star-is-born']);
});

test('load: a failed songs.json is asked for again, not remembered as failed', async () => {
  failNext = 1;
  const before = fetches;
  await assert.rejects(SL.load());
  const data = await SL.load();
  assert.equal(fetches - before, 2);
  assert.equal(data.songs.length, 4);
  assert.equal(SL.load(), SL.load(), 'a load that worked is shared');
});

test('setlist: once songs.json is in, list() shows the known songs in order', () => {
  store.set('bs_setlist', JSON.stringify(['andel', 'gone-song', 'amerika']));
  assert.deepEqual(SL.setlist.list(), ['andel', 'amerika']);
  assert.deepEqual(SL.setlist.raw(), ['andel', 'gone-song', 'amerika']);
  SL.setlist.toggle('a-pak');
  assert.deepEqual(stored(), ['andel', 'gone-song', 'amerika', 'a-pak'], 'an unknown slug is not dropped by a write');
});

test('chord picker order reads names through chord-theory.js', () => {
  assert.deepEqual(SL.chords, ['Ami', 'B', 'C', 'D', 'Dmi', 'Eb', 'G', 'Hmi']
    .sort((a, b) => SL.compareChords(a, b)));
  assert.ok(SL.compareChords('C', 'D') < 0);
  assert.ok(SL.compareChords('Eb', 'E') < 0);
  assert.ok(SL.compareChords('Ami', 'A') > 0, 'plain major first');
  assert.ok(SL.compareChords('H', 'B') > 0, 'H after B');
});

test('writeJSON(key, null) forgets the key', () => {
  SL.writeJSON('bs_tmp', { a: 1 });
  assert.deepEqual(SL.readJSON('bs_tmp', null), { a: 1 });
  SL.writeJSON('bs_tmp', null);
  assert.equal(store.has('bs_tmp'), false);
  assert.equal(SL.readJSON('bs_tmp', 'fallback'), 'fallback');
});
