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

test('transform: empty repeat reference collapses and is filled from the definition', () => {
  const html = 'R: Chorus body here\n\nVerse two\n\nR:';
  const out = SongSections.transform(html);
  const matches = out.match(/section-refren( is-repeat)?/g);
  assert.equal(matches.length, 2);
  assert.equal(matches[0], 'section-refren');
  assert.equal(matches[1], 'section-refren is-repeat');
  const bodies = [...out.matchAll(/<span class="section-body">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  assert.equal(bodies[0], 'Chorus body here');
  assert.equal(bodies[bodies.length - 1], 'Chorus body here');
});

test('transform: bare reference BEFORE the definition is still filled (two-pass)', () => {
  const html = 'R:\n\nVerse\n\nR: Real chorus text';
  const out = SongSections.transform(html);
  const bodies = [...out.matchAll(/<span class="section-body">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  assert.equal(bodies[0], 'Real chorus text');
  // The definition itself must not be a repeat.
  const classes = out.match(/section-refren( is-repeat)?/g);
  assert.equal(classes[0], 'section-refren is-repeat');
  assert.equal(classes[1], 'section-refren');
});

test('transform: play-count body ("R: 2x") is a repeat with a visible note', () => {
  const html = 'R: Chorus body\n\nVerse\n\nR: 2x';
  const out = SongSections.transform(html);
  assert.match(out, /is-repeat has-note/);
  assert.match(out, /<span class="section-note">2x<\/span>/);
  // Expanded body comes from the definition, not the "2x" text.
  const bodies = [...out.matchAll(/<span class="section-body">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  assert.equal(bodies[bodies.length - 1], 'Chorus body');
});

test('multiplier detection accepts common forms and rejects text/chords', () => {
  for (const s of ['2x', '(2x)', '2 x', 'x3', '2×', '3X.']) {
    assert.equal(SongSections._isMultiplier(s), true, `"${s}" should be a multiplier`);
  }
  for (const s of ['2x Ami G', 'text', 'Ami', '', '12345x']) {
    assert.equal(SongSections._isMultiplier(s), false, `"${s}" should NOT be a multiplier`);
  }
});

test('transform: same-identity block with DIFFERENT text stays visible (not a repeat)', () => {
  // Amazonka case: the final chorus reuses "R:" but has its own lyrics.
  const html = 'R: Chorus body\n\nVerse\n\nR: Completely different final chorus';
  const out = SongSections.transform(html);
  const classes = out.match(/section-refren( is-repeat)?/g);
  assert.equal(classes.length, 2);
  assert.equal(classes[0], 'section-refren');
  assert.equal(classes[1], 'section-refren');
  const bodies = [...out.matchAll(/<span class="section-body">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  assert.equal(bodies[bodies.length - 1], 'Completely different final chorus');
});

test('transform: written-out repeat with identical text collapses', () => {
  const html = 'R: Chorus body\n\nVerse two\n\nR: Chorus body';
  const out = SongSections.transform(html);
  const matches = out.match(/section-refren( is-repeat)?/g);
  assert.equal(matches.length, 2);
  assert.equal(matches[1], 'section-refren is-repeat');
});

test('compareText: chords matter, case/whitespace do not', () => {
  const a = 'la <span class="chord" data-chord="Ami">Ami</span> la';
  const sameLoose = 'La  <span class="chord" data-chord="Ami">Ami</span> LA';
  const otherChord = 'la <span class="chord" data-chord="Dmi">Dmi</span> la';
  assert.equal(SongSections._compareText(a), SongSections._compareText(sameLoose));
  assert.notEqual(SongSections._compareText(a), SongSections._compareText(otherChord));
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

test('transform: section markup wraps label (and note) in .section-head', () => {
  const out = SongSections.transform('R: Chorus');
  assert.match(out, /<span class="section-head"><span class="section-label">R:<\/span><\/span><span class="section-body">Chorus<\/span>/);
});

test('parseBlocks: dedents an indented marker body', () => {
  const blocks = SongSections.parseBlocks('R: first line\n    second line\n    third line');
  assert.equal(blocks[0].lines[1], 'second line');
  assert.equal(blocks[0].lines[2], 'third line');
});

test('parseBlocks: merges an indented unmarked continuation into the preceding marker block', () => {
  // Old songs split a chorus across a blank line, keeping the second half
  // indented so it's absorbed back into the chorus rather than becoming its
  // own verse. An UNINDENTED continuation is not merged.
  const merged = SongSections.parseBlocks('R: first half\n\n  indented second half');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].lines.join('\n'), 'first half\n\nindented second half');

  const notMerged = SongSections.parseBlocks('R: first half\n\nunindented text');
  assert.equal(notMerged.length, 2);
  assert.equal(notMerged[1].marker, false);
});

test('parseBlocks: merged continuation is dedented even when the section body sits at column 0', () => {
  // The indent is only a join-marker; it must not survive into the display,
  // otherwise a joined chorus half renders shifted by two spaces.
  const blocks = SongSections.parseBlocks('R: line one\nline two\n\n  joined half\n  joined half two');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lines.join('\n'), 'line one\nline two\n\njoined half\njoined half two');
});

test('parseBlocks: srcStart/srcEnd give the block line range, incl. merged continuations', () => {
  const src = 'Verse one\nverse line two\n\nR: chorus\n\n  merged half\n\nOutside';
  const blocks = SongSections.parseBlocks(src);
  assert.equal(blocks.length, 3);
  assert.deepEqual([blocks[0].srcStart, blocks[0].srcEnd], [0, 1]);
  assert.deepEqual([blocks[1].srcStart, blocks[1].srcEnd], [3, 5]); // R: through merged half
  assert.deepEqual([blocks[2].srcStart, blocks[2].srcEnd], [7, 7]);
  // Ranges index into normalizeBreaks(src).split('\n'):
  const lines = SongSections.normalizeBreaks(src).split('\n');
  assert.equal(lines[blocks[1].srcEnd], '  merged half');
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

// === Fenced sections: //R ... R// ===

test('fence: markers never appear in the body and delimit exactly one block', () => {
  const blocks = SongSections.parseBlocks('//R\nChorus line\nR//\n\nVerse');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].marker, true);
  assert.equal(blocks[0].fenced, true);
  assert.deepEqual(blocks[0].lines, ['Chorus line']);
  assert.equal(blocks[1].marker, false);
  const out = SongSections.transform('//R\nChorus line\nR//');
  assert.doesNotMatch(out, /\/\//);
  assert.match(out, /<span class="section-body">Chorus line<\/span>/);
});

test('fence: a blank line inside the fence does NOT end the section', () => {
  const blocks = SongSections.parseBlocks('//R\nfirst half\n\nsecond half\nR//');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lines.join('\n'), 'first half\n\nsecond half');
});

test('fence: name decides the type, R/S/B share identity with the legacy markers', () => {
  assert.deepEqual(SongSections._fenceIdentity('R'), { type: 'refren', id: '', label: 'R:' });
  assert.deepEqual(SongSections._fenceIdentity('R2'), { type: 'refren', id: '2', label: 'R2:' });
  assert.deepEqual(SongSections._fenceIdentity('S1'), { type: 'sloka', id: '1', label: 'S1:' });
  assert.deepEqual(SongSections._fenceIdentity('B'), { type: 'bridge', id: '', label: 'B:' });
  assert.deepEqual(SongSections._fenceIdentity('Coda'), { type: 'custom', id: 'CODA', label: 'Coda:' });
});

test('fence: an arbitrary name renders as a labelled custom section', () => {
  const out = SongSections.transform('//Coda\nlast lines\nCoda//');
  assert.match(out, /class="song-section section-custom" data-section="custom\|CODA"/);
  assert.match(out, /<span class="section-label">Coda:<\/span>/);
  assert.match(out, /<span class="section-body">last lines<\/span>/);
});

test('fence: "//R//" on one line is a repeat, filled from the definition', () => {
  const out = SongSections.transform('//R\nChorus body\nR//\n\nVerse\n\n//R//');
  const classes = out.match(/section-refren( is-repeat)?/g);
  assert.deepEqual(classes, ['section-refren', 'section-refren is-repeat']);
  const bodies = [...out.matchAll(/<span class="section-body">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  assert.equal(bodies[bodies.length - 1], 'Chorus body');
});

test('fence: "//R 2x//" keeps the play count as a visible note', () => {
  const out = SongSections.transform('//R\nChorus body\nR//\n\nVerse\n\n//R 2x//');
  assert.match(out, /is-repeat has-note/);
  assert.match(out, /<span class="section-note">2x<\/span>/);
});

test('fence: a legacy R: block and a //R fence are the same identity', () => {
  const out = SongSections.transform('//R\nChorus body\nR//\n\nVerse\n\nR:');
  const classes = out.match(/section-refren( is-repeat)?/g);
  assert.deepEqual(classes, ['section-refren', 'section-refren is-repeat']);
});

test('fence: an unterminated fence gives way to the next one', () => {
  // The state the editor is in between typing "//R" and typing "R//".
  const blocks = SongSections.parseBlocks('//R\nabc\n//S\ndef');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].lines, ['abc']);
  assert.deepEqual(blocks[1].lines, ['def']);
  assert.equal(blocks[1].label, 'S:');
});

test('fence: an empty section with no definition is a heading, not a repeat', () => {
  const out = SongSections.transform('//VYBRNKÁVÁNÍ//\n\nVerse');
  assert.match(out, /section-custom is-heading/);
  assert.doesNotMatch(out, /is-repeat/);
  assert.match(out, /<span class="section-label">VYBRNKÁVÁNÍ:<\/span>/);
});

test('fence: "//" inside a lyric line is left alone', () => {
  const blocks = SongSections.parseBlocks('a // b\nnormal line');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].marker, false);
});

test('fenceCloseAt: matches the fence name, a bare "//", but never a repeat close', () => {
  assert.equal(SongSections._fenceCloseAt('R//', 'R'), 0);
  assert.equal(SongSections._fenceCloseAt('text R//', 'R'), 5);
  assert.equal(SongSections._fenceCloseAt('//', 'R'), 0);
  assert.equal(SongSections._fenceCloseAt(' 2x//', 'R'), 3); // "2x" stays body
  assert.equal(SongSections._fenceCloseAt('line two ://', 'R'), -1);
  assert.equal(SongSections._fenceCloseAt('plain line', 'R'), -1);
});

// === Repeats: //: ... :// rendered as |: ... :| ===

test('repeat: "//:" and "://" render as the sheet-music brackets', () => {
  const out = SongSections.transform('//: první řádek\ndruhý řádek ://');
  assert.match(out, /<span class="repeat-mark">\|:<\/span> první řádek/);
  assert.match(out, /druhý řádek <span class="repeat-mark">:\|<\/span>/);
  assert.doesNotMatch(out, /\/\//);
});

test('repeat: text glued straight onto "//:" still opens a repeat', () => {
  // How the songs that already use this notation are written.
  const out = SongSections.transform('//:Obzor neklesne níž\ntext ://');
  assert.match(out, /<span class="repeat-mark">\|:<\/span>Obzor neklesne níž/);
  const blocks = SongSections.parseBlocks('//:Obzor neklesne níž\ntext ://');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].marker, false, 'a repeat is not a section');
});

test('repeat: works inside a section fence without closing it', () => {
  const blocks = SongSections.parseBlocks('//R\n//: hook ://\nmore\nR//');
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].lines, ['//: hook ://', 'more']);
  const out = SongSections.transform('//R\n//: hook ://\nmore\nR//');
  assert.match(out, /<span class="repeat-mark">\|:<\/span> hook <span class="repeat-mark">:\|<\/span>/);
});

test('hasSections: true for a plain song that only uses repeat brackets', () => {
  assert.equal(SongSections.hasRepeatMarks('//: line ://'), true);
  assert.equal(SongSections.hasSections('//: line ://'), true);
  assert.equal(SongSections.hasSections('plain line\n\nanother'), false);
});

test('hasSections: true for a fenced song with no legacy markers', () => {
  assert.equal(SongSections.hasSections('//R\nbody\nR//'), true);
});
