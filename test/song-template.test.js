'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SongTemplate = require('../js/song-template.js');

// === slugify ===

test('slugify: lowercases and strips diacritics', () => {
  assert.equal(SongTemplate.slugify('Želva'), 'zelva');
});

test('slugify: leading digit gets an "a" prefix', () => {
  assert.equal(SongTemplate.slugify('1. Signální'), 'a1-signalni');
});

test('slugify: strips combining diacritics from NFKD decomposition', () => {
  assert.equal(SongTemplate.slugify('Kůň'), 'kun');
  assert.equal(SongTemplate.slugify('Příliš žluťoučký kůň'), 'prilis-zlutoucky-kun');
});

test('slugify: all-punctuation title falls back to "song"', () => {
  assert.equal(SongTemplate.slugify('???'), 'song');
});

test('slugify: collapses non-alnum runs and trims leading/trailing dashes', () => {
  assert.equal(SongTemplate.slugify('  Hello,   World!!  '), 'hello-world');
});

test('slugify: translit map covers ł/ø/ß/æ/œ (lowercase) and Ł (uppercase)', () => {
  assert.equal(SongTemplate.slugify('ł'), 'l');
  assert.equal(SongTemplate.slugify('Ł'), 'l');
  assert.equal(SongTemplate.slugify('ø'), 'o');
  assert.equal(SongTemplate.slugify('ß'), 'ss');
  assert.equal(SongTemplate.slugify('æ'), 'ae');
  assert.equal(SongTemplate.slugify('œ'), 'oe');
});

test('slugify: matches existing real slugs in songs.json (a1970, a1-signalni)', () => {
  assert.equal(SongTemplate.slugify('1970'), 'a1970');
});

// === uniqueSlug ===

test('uniqueSlug: returns the base slug unchanged when not taken', () => {
  const taken = new Set();
  assert.equal(SongTemplate.uniqueSlug('andel', taken), 'andel');
});

test('uniqueSlug: first collision appends -2', () => {
  const taken = new Set(['andel']);
  assert.equal(SongTemplate.uniqueSlug('andel', taken), 'andel-2');
});

test('uniqueSlug: second collision appends -3', () => {
  const taken = new Set(['andel', 'andel-2']);
  assert.equal(SongTemplate.uniqueSlug('andel', taken), 'andel-3');
});

test('uniqueSlug: marks the returned slug as taken (repeated calls advance)', () => {
  const taken = new Set();
  assert.equal(SongTemplate.uniqueSlug('andel', taken), 'andel');
  assert.equal(SongTemplate.uniqueSlug('andel', taken), 'andel-2');
  assert.equal(SongTemplate.uniqueSlug('andel', taken), 'andel-3');
});

// === generateSongHtml ===

function baseOpts(overrides) {
  return Object.assign(
    { title: 'Testovací píseň', author: '', capo: 0, body: 'text', slug: 'testovaci-pisen' },
    overrides || {}
  );
}

test('generateSongHtml: exactly one h1, one pre.song-text, and a title tag', () => {
  const html = SongTemplate.generateSongHtml(baseOpts());
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  assert.equal((html.match(/<pre class="song-text">/g) || []).length, 1);
  assert.match(html, /<title>.*<\/title>/);
});

test('generateSongHtml: contains both editor save-time anchors when capo=0', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ capo: 0 }));
  // Literal anchor used by editor.js to insert a missing <p class="song-author">.
  assert.match(html, /<\/div>\n    <pre/);
  // Regex anchor used by editor.js to insert a missing <p class="song-capo">.
  assert.match(html, /(\s*)(    <\/div>\s*\n\s*<pre class="song-text">)/);
});

test('generateSongHtml: contains both editor save-time anchors when capo is set', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ capo: 3 }));
  assert.match(html, /<\/div>\n    <pre/);
  assert.match(html, /(\s*)(    <\/div>\s*\n\s*<pre class="song-text">)/);
});

test('generateSongHtml: capo 3 renders as "Capo 3"', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ capo: 3 }));
  assert.match(html, /<p class="song-capo">Capo 3<\/p>/);
});

test('generateSongHtml: capo 0 renders no song-capo element', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ capo: 0 }));
  assert.doesNotMatch(html, /song-capo/);
});

test('generateSongHtml: empty author renders no song-author element', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ author: '' }));
  assert.doesNotMatch(html, /song-author/);
});

test('generateSongHtml: author is HTML-escaped', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ author: 'Tom & Jerry <band>' }));
  assert.match(html, /<p class="song-author">Tom &amp; Jerry &lt;band&gt;<\/p>/);
});

test('generateSongHtml: title is HTML-escaped in <h1> and <title>', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ title: 'Rock & Roll' }));
  assert.match(html, /<h1>Rock &amp; Roll<\/h1>/);
  assert.match(html, /<title>Rock &amp; Roll - Bekovy songy<\/title>/);
});

test('generateSongHtml: canonical link and og:url use the slug', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ slug: 'moje-pisen' }));
  assert.match(html, /<link rel="canonical" href="https:\/\/bekovysongy\.cz\/songs\/moje-pisen\.html">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/bekovysongy\.cz\/songs\/moje-pisen\.html">/);
});

test('generateSongHtml: mailto keeps a literal "Bug: " prefix with only the title encoded', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ title: 'Anděl' }));
  assert.match(html, /mailto:ondrejbek8@gmail\.com\?subject=Bug: And%C4%9Bl/);
});

test('generateSongHtml: body html is inserted verbatim into the pre', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ body: '<span class="chord" data-chord="G">G</span> text' }));
  assert.match(html, /<pre class="song-text"><span class="chord" data-chord="G">G<\/span> text<\/pre>/);
});

test('generateSongHtml: empty body is allowed (empty pre, no crash)', () => {
  const html = SongTemplate.generateSongHtml(baseOpts({ body: '' }));
  assert.match(html, /<pre class="song-text"><\/pre>/);
});

test('generateSongHtml: description mentions the author when present, omits "od" when absent', () => {
  const withAuthor = SongTemplate.generateSongHtml(baseOpts({ title: 'Anděl', author: 'Karel Kryl' }));
  assert.match(withAuthor, /Akordy a text písně Anděl od Karel Kryl\./);

  const noAuthor = SongTemplate.generateSongHtml(baseOpts({ title: 'Anděl', author: '' }));
  assert.match(noAuthor, /Akordy a text písně Anděl\. Transpozice/);
});
