'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SongSections = require('../js/sections.js');

const bodiesOf = (out) => [...out.matchAll(/<span class="section-body">([\s\S]*?)<\/span>/g)].map(m => m[1]);

test('hasSections: false for plain unmarked text', () => {
  assert.equal(SongSections.hasSections('1. Verse one\n\n2. Verse two'), false);
});

test('hasSections: true when a fence is present', () => {
  assert.equal(SongSections.hasSections('Verse\n\n//R Chorus text R//'), true);
});

test('the old prefix markers are plain text now', () => {
  // "S. O. S. volám" used to become a sloka "O. S. volám", "B. B. King" a bridge.
  for (const line of ['R: Chorus', 'Ref. text', 'S. O. S. volám', 'B. B. King', 'Bridge: x', 'R:']) {
    const blocks = SongSections.parseBlocks(line);
    assert.equal(blocks.length, 1, line);
    assert.equal(blocks[0].marker, false, `"${line}" must not be a section`);
    assert.deepEqual(blocks[0].lines, [line]);
  }
  assert.equal(SongSections.hasSections('Verse\n\nR: Chorus text'), false);
});

test('transform: first refrén occurrence is not marked as repeat', () => {
  const out = SongSections.transform('//R Chorus line one R//\n\nSecond verse');
  assert.match(out, /class="song-section section-refren"[^>]*>/);
  assert.doesNotMatch(out.split('section-plain')[0], /is-repeat/);
});

test('transform: empty repeat reference collapses and is filled from the definition', () => {
  const out = SongSections.transform('//R Chorus body here R//\n\nVerse two\n\n//R//');
  const matches = out.match(/section-refren( is-repeat)?/g);
  assert.deepEqual(matches, ['section-refren', 'section-refren is-repeat']);
  const bodies = bodiesOf(out);
  assert.equal(bodies[0], 'Chorus body here');
  assert.equal(bodies[bodies.length - 1], 'Chorus body here');
});

test('transform: bare reference BEFORE the definition is still filled (two-pass)', () => {
  const out = SongSections.transform('//R//\n\nVerse\n\n//R Real chorus text R//');
  assert.equal(bodiesOf(out)[0], 'Real chorus text');
  // The definition itself must not be a repeat.
  assert.deepEqual(out.match(/section-refren( is-repeat)?/g), ['section-refren is-repeat', 'section-refren']);
});

test('transform: play-count body ("//R 2x//") is a repeat with a visible note', () => {
  const out = SongSections.transform('//R Chorus body R//\n\nVerse\n\n//R 2x//');
  assert.match(out, /is-repeat has-note/);
  assert.match(out, /<span class="section-note">2x<\/span>/);
  // Expanded body comes from the definition, not the "2x" text.
  const bodies = bodiesOf(out);
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
  // Amazonka case: the final chorus reuses the name but has its own lyrics.
  const out = SongSections.transform('//R Chorus body R//\n\nVerse\n\n//R Completely different final chorus R//');
  assert.deepEqual(out.match(/section-refren( is-repeat)?/g), ['section-refren', 'section-refren']);
  const bodies = bodiesOf(out);
  assert.equal(bodies[bodies.length - 1], 'Completely different final chorus');
});

test('transform: written-out repeat with identical text collapses', () => {
  const out = SongSections.transform('//R Chorus body R//\n\nVerse two\n\n//R Chorus body R//');
  assert.deepEqual(out.match(/section-refren( is-repeat)?/g), ['section-refren', 'section-refren is-repeat']);
});

test('compareText: chords matter, case/whitespace do not', () => {
  const a = 'la <span class="chord" data-chord="Ami">Ami</span> la';
  const sameLoose = 'La  <span class="chord" data-chord="Ami">Ami</span> LA';
  const otherChord = 'la <span class="chord" data-chord="Dmi">Dmi</span> la';
  assert.equal(SongSections._compareText(a), SongSections._compareText(sameLoose));
  assert.notEqual(SongSections._compareText(a), SongSections._compareText(otherChord));
});

test('transform: distinct ids (//R vs //R2) are independent, neither is a repeat', () => {
  const out = SongSections.transform('//R First hook R//\n\n//R2 Second hook R2//');
  assert.doesNotMatch(out, /is-repeat/);
});

test('transform: unmarked block stays a plain section', () => {
  const out = SongSections.transform('Just a verse, no marker');
  assert.match(out, /class="song-section section-plain"/);
});

test('transform: section markup wraps label (and note) in .section-head', () => {
  const out = SongSections.transform('//R Chorus R//');
  assert.match(out, /<span class="section-head"><span class="section-label">R:<\/span><\/span><span class="section-body">Chorus<\/span>/);
});

test('parseBlocks: dedents an indented fenced body', () => {
  const blocks = SongSections.parseBlocks('//R\n    first line\n    second line\nR//');
  assert.deepEqual(blocks[0].lines, ['first line', 'second line']);
});

test('parseBlocks: srcStart/srcEnd give the block line range', () => {
  const src = 'Verse one\nverse line two\n\n//R\nchorus\n\nsecond half\nR//\n\nOutside';
  const blocks = SongSections.parseBlocks(src);
  assert.equal(blocks.length, 3);
  assert.deepEqual([blocks[0].srcStart, blocks[0].srcEnd], [0, 1]);
  assert.deepEqual([blocks[1].srcStart, blocks[1].srcEnd], [3, 7]);
  assert.deepEqual([blocks[2].srcStart, blocks[2].srcEnd], [9, 9]);
  // Ranges index into normalizeBreaks(src).split('\n'):
  const lines = SongSections.normalizeBreaks(src).split('\n');
  assert.equal(lines[blocks[1].srcEnd], 'R//');
});

test('transform: chord spans inside a fenced line are preserved verbatim', () => {
  const out = SongSections.transform('//R <span class="chord" data-chord="Ami">Ami</span>text R//');
  assert.match(out, /<span class="chord" data-chord="Ami">Ami<\/span>text/);
});

test('normalizeBreaks (via hasSections) treats <br>/<div> as line breaks', () => {
  // A fence only counts if it starts its own line - <br> must act as a real newline.
  assert.equal(SongSections.hasSections('Verse one<br>//R Chorus R//'), true);
  assert.equal(SongSections.hasSections('<div>Verse one</div><div>//R Chorus R//</div>'), true);
});

// === A chord right at the marker: "//R<span ...>" ===

const G = '<span class="chord" data-chord="G">G</span>';

test('fence: a chord typed straight after "//R" is the body, not the name', () => {
  const out = SongSections.transform('//R' + G + ' text\nmore R//');
  assert.match(out, /section-refren/);
  assert.match(out, /<span class="section-label">R:<\/span>/);
  assert.match(out, /<span class="section-body"><span class="chord" data-chord="G">G<\/span> text\nmore<\/span>/);
  assert.match(out, /data-section="refren\|"/);
});

test('fence: a chord right before "R//" closes the fence and leaves no stray "R"', () => {
  const out = SongSections.transform('//R text ' + G + 'R//');
  assert.match(out, /<span class="section-body">text <span class="chord" data-chord="G">G<\/span><\/span>/);
});

// === transform(html, { lines: true }) - the song page ===

test('lines: every line is its own .ln, a closing newline adds none', () => {
  const out = SongSections._renderLines('one\ntwo\n\nfour\n');
  assert.equal(out, '<span class="ln">one</span><span class="ln">two</span><span class="ln"></span><span class="ln">four</span>');
  assert.equal(SongSections._renderLines(''), '');
});

test('lines: a newline inside a span leaves the text as one block', () => {
  const odd = '<span class="chord" data-chord="G">G\n</span> text';
  assert.equal(SongSections._renderLines(odd), odd);
});

test('lines: a chord is glued to the word after it, a run of chords is not', () => {
  const D = '<span class="chord" data-chord="D">D</span>';
  const out = SongSections._renderLines(G + ' Jednou ' + G + ' ' + D + ' slovo');
  assert.equal(out, '<span class="ln">' + G + ' Jednou ' + G + ' ' + D + ' slovo</span>');
});

test('lines: transform without the option is unchanged (editor preview, PDF)', () => {
  const src = '//R ' + G + ' text R//\n\nverse\nline two';
  assert.doesNotMatch(SongSections.transform(src), /class="ln/);
  const out = SongSections.transform(src, { lines: true });
  assert.match(out, /<span class="section-body"><span class="ln">/);
  assert.match(out, /<div class="song-section section-plain"><span class="ln">verse<\/span><span class="ln">line two<\/span><\/div>/);
});

test('lines: consecutive tablature lines are grouped, unglued, and the rest is not', () => {
  const tab = 'E |----0----2----|\nH |----1--------3-|';
  const out = SongSections.transform('Intro:\n' + tab + '\nzpěv ' + G + ' dál', { lines: true });
  assert.match(out, /<span class="ln">Intro:<\/span><span class="tabs"><span class="ln tab">E \|----0----2----\|<\/span><span class="ln tab">H \|----1--------3-\|<\/span><\/span><span class="ln">zpěv /);
  assert.equal(SongSections._isTabLine('E |----0----2----|'), true);
  assert.equal(SongSections._isTabLine('- a - b -'), false, 'too short');
  assert.equal(SongSections._isTabLine('Jednou štěstí dohoní i ty jezdce'), false);
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

test('fence: name decides the type, R/S/B with an optional number', () => {
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

test('fence: //Refrén and //R are the same identity', () => {
  const out = SongSections.transform('//Refrén\nChorus body\nRefrén//\n\nVerse\n\n//R//');
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

// === Repeat with a changed ending ("//R ... nový konec R//") ===

const CHORUS = '//R\nKdyž jsi u mě,\nnic mi nechybí,\na víc už nechci nic.\nR//';

test('changed ending: collapses like a repeat and keeps the new line visible', () => {
  const out = SongSections.transform(
    CHORUS + '\n\nsloka\n\n//R\n...\na pak už nechci nic.\nR//'
  );
  const blocks = out.match(/section-refren[^"]*/g);
  assert.equal(blocks[0], 'section-refren');
  assert.equal(blocks[1], 'section-refren is-repeat has-tail');
  // The tail sits next to the pill, before the (hidden) full body.
  assert.match(out, /<span class="section-tail">a pak už nechci nic\.<\/span>/);
});

test('changed ending: the body is the chorus with its last line swapped', () => {
  const out = SongSections.transform(
    CHORUS + '\n\n//R\n...\na pak už nechci nic.\nR//'
  );
  const body = out.split('section-tail">a pak už nechci nic.</span>')[1];
  assert.match(body, /Když jsi u mě,\nnic mi nechybí,\na pak už nechci nic\./);
  assert.doesNotMatch(body.split('</div>')[0], /a víc už nechci nic/);
});

test('changed ending: two lines replace the last two', () => {
  const out = SongSections.transform(CHORUS + '\n\n//R\n...\nprvní jinak,\ndruhý jinak.\nR//');
  const body = out.split('class="section-body"')[2];
  assert.match(body, /Když jsi u mě,\nprvní jinak,\ndruhý jinak\./);
  assert.doesNotMatch(body.split('</div>')[0], /nic mi nechybí/);
});

test('changed ending: the compact one-line form means the same', () => {
  const wide = SongSections.transform(CHORUS + '\n\n//R\n...\na pak už nechci nic.\nR//');
  const tight = SongSections.transform(CHORUS + '\n\n//R ... a pak už nechci nic. R//');
  assert.equal(tight, wide);
});

test('changed ending: "…" is accepted as well as "..."', () => {
  const dots = SongSections.transform(CHORUS + '\n\n//R ... a pak už nechci nic. R//');
  const ell = SongSections.transform(CHORUS + '\n\n//R … a pak už nechci nic. R//');
  assert.equal(ell, dots);
});

test('changed ending: chords in the new line survive', () => {
  const chord = '<span class="chord" data-chord="Ami">Ami</span>';
  const out = SongSections.transform(CHORUS + '\n\n//R\n...\n' + chord + ' a pak už nic.\nR//');
  assert.match(out, /<span class="section-tail"><span class="chord" data-chord="Ami">/);
});

test('changed ending: without a definition it stays an ordinary visible block', () => {
  const out = SongSections.transform('//R\n...\na pak už nechci nic.\nR//');
  assert.doesNotMatch(out, /is-repeat/);
  assert.doesNotMatch(out, /section-tail/);
});

test('changed ending: never counts as the definition of the chorus', () => {
  // The "..." block comes first here; the real chorus below it still defines.
  const out = SongSections.transform(
    '//R\n...\na pak už nechci nic.\nR//\n\n' + CHORUS
  );
  const blocks = out.match(/section-refren[^"]*/g);
  assert.equal(blocks[0], 'section-refren is-repeat has-tail');
  assert.equal(blocks[1], 'section-refren');
});

test('changed ending: an indented definition works too', () => {
  const out = SongSections.transform(
    '//R první řádek\n   poslední řádek R//\n\n//R ... jiný konec R//'
  );
  assert.match(out, /is-repeat has-tail/);
  assert.match(out, /první řádek\njiný konec/);
});

test('a plain "..." line outside a repeat is left alone', () => {
  const out = SongSections.transform('sloka\n...\ndál');
  assert.doesNotMatch(out, /section-tail/);
  assert.match(out, /sloka\n\.\.\.\ndál/);
});
