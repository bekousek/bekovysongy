'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/player.js');

test('scrollStep: 4 px/s per speed step, fractions carried over', () => {
  let s = { lastT: 0, carry: 0 };
  s = P.scrollStep(s, 1000, 3);           // the first frame only starts the clock
  assert.equal(s.px, 0);
  let moved = 0;
  for (let t = 1016; t <= 2000; t += 16) { s = P.scrollStep(s, t, 3); moved += s.px; }
  assert.ok(moved >= 11 && moved <= 12, `about 12 px in a second at speed 3, got ${moved}`);
  assert.ok(s.carry >= 0 && s.carry < 1);
});

test('scrollStep: coming back to the tab does not jump by the whole absence', () => {
  // 30 s away at speed 3 used to move the page 360 px in one frame.
  let s = P.scrollStep({ lastT: 0, carry: 0 }, 1000, 3);
  s = P.scrollStep(s, 31000, 3);
  assert.ok(s.px <= Math.ceil(P.MAX_FRAME_MS / 1000 * 3 * 4), `one frame moved ${s.px} px`);
  assert.equal(P.scrollStep({ lastT: 31000, carry: 0 }, 1000, 10).px, 0, 'a clock going backwards moves nothing');
});

test('pageStep: one screenful between the bars, less one line', () => {
  // A phone on its side: 360 px, chord bar to 53 px, bottom bar from 290 px.
  assert.equal(P.pageStep(53, 290, 33), 290 - 53 - 33);
  // With the chord bar scrolled away (top 0) the page is taller.
  assert.equal(P.pageStep(0, 310, 33), 277);
  // Never less than a line, however crowded the screen.
  assert.equal(P.pageStep(200, 220, 33), 33);
});

test('pageStep: five pages on a landscape phone skip no line', () => {
  const top = 53;
  const bottom = 290;
  const line = 33;
  let shown = top;   // the top edge of the text in view, in page px
  for (let i = 0; i < 5; i++) {
    const nextTop = shown + P.pageStep(top, bottom, line);
    assert.ok(nextTop <= shown + (bottom - top), 'the next page starts within the one just read');
    shown = nextTop;
  }
});

test('nextTranspose: −5 … +6, the short way round', () => {
  assert.equal(P.nextTranspose(0, 1), 1);
  assert.equal(P.nextTranspose(6, 1), -5);
  assert.equal(P.nextTranspose(-5, -1), 6);
  assert.equal(P.nextTranspose(14, 0), 2, 'a stored value out of range comes back in');
  for (let t = -5; t <= 6; t++) assert.equal(P.nextTranspose(P.nextTranspose(t, 1), -1), t);
});

test('settings: stored strings are read into their range, junk gives the default', () => {
  assert.equal(P.settingFrom('fontScale', '250'), 250);
  assert.equal(P.settingFrom('fontScale', '400'), 250);
  assert.equal(P.settingFrom('fontScale', null), 100);
  assert.equal(P.settingFrom('speed', 'abc'), 3);
  assert.equal(P.settingFrom('bpm', '20'), 40);
  assert.equal(P.switchFrom('keepAwake', null), true);
  assert.equal(P.switchFrom('keepAwake', '0'), false);
  assert.equal(P.switchFrom('showRepeats', 'on'), true);
  assert.equal(P.switchFrom('light', 'dark'), false);
  assert.equal(P.switchFrom('light', 'light'), true);
});

test('song prefs: a song keeps its key and speed, and leaves the map at the defaults', () => {
  let all = P.withSongPrefs({}, 'andel', { t: -2, s: 5 });
  assert.deepEqual(all, { andel: { t: -2, s: 5 } });
  all = P.withSongPrefs(all, 'a-pak', { t: 3 });
  assert.deepEqual(all, { andel: { t: -2, s: 5 }, 'a-pak': { t: 3 } });
  all = P.withSongPrefs(all, 'andel', { t: 0 });
  assert.deepEqual(all, { 'a-pak': { t: 3 } });
});
