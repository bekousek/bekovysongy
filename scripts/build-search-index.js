#!/usr/bin/env node
'use strict';
/**
 * Builds search-index.json - the lyrics of every published song, as plain
 * text, so the song list can find a song from a half-remembered line.
 *
 * Derived data, generated at deploy time next to sitemap.xml rather than
 * committed: songs/*.html changes on every save from /admin, and a committed
 * copy would silently go stale between deploys.
 *   node scripts/build-search-index.js > _site/search-index.json
 *
 * Shape: { "<slug>": "line\nline\n..." }. Chords, section markers and repeat
 * brackets are stripped - they aren't lyrics, they'd make "Ami" match half
 * the songbook, and they'd turn up inside the snippet shown under a hit.
 * Line structure is kept because the snippet is one line of the song.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SONGS_DIR = path.join(ROOT, 'songs');
const SongSections = require(path.join(ROOT, 'js/sections.js'));

// Drafts have no page and nothing to index.
const DRAFT_STATUSES = ['navrh', 'k-vytvoreni'];
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'songs.json'), 'utf-8'));
const published = data.songs.filter(s => !DRAFT_STATUSES.includes(s.status));

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
  bdquo: '„', ldquo: '“', rdquo: '”', sbquo: '‚', lsquo: '‘', rsquo: '’',
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

function lyricsOf(html) {
  const m = html.match(/<pre class="song-text">([\s\S]*?)<\/pre>/);
  if (!m) return '';

  // parseBlocks already drops "//R"/"R//" fences and legacy "R:" prefixes,
  // so the same rules the renderer uses decide what counts as lyrics.
  const lines = [];
  for (const block of SongSections.parseBlocks(m[1])) {
    for (const line of block.lines) lines.push(line);
  }

  const out = [];
  for (let line of lines) {
    line = line
      .replace(/<span[^>]*data-chord="[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ') // chords
      .replace(/<[^>]*>/g, ' ');
    // Markers again, but this time anywhere on the line, not only where the
    // renderer recognizes them. Songs written before fences existed put "R:"
    // after a chord or "//:" mid-line, and parseBlocks leaves those alone -
    // correctly, since there it can't tell them from lyrics. In a search
    // snippet they're pure noise, and stripping them here cannot affect what
    // the song page shows.
    line = decodeEntities(line)
      .replace(/\/\/[^\s\/]*\/\//g, ' ')   // //VYBRNKÁVÁNÍ//
      .replace(/\/\/:|:\/\//g, ' ')        // |: and :| anywhere
      .replace(/^\s*\/\/[^\s\/]+/, ' ')    // //R opening the line
      .replace(/[^\s\/]+\/\/\s*$/, ' ')    // R// closing it
      .replace(/^\s*(?:Refr[ée]n|Ref|R|Sloka|Slo|S|Bridge|Br|B)\s*\d*\s*[:.]\s*/i, '')
      .replace(/[   ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) out.push(line);
  }
  return out.join('\n');
}

const index = {};
let indexed = 0;
let empty = 0;
for (const song of published) {
  const fp = path.join(SONGS_DIR, `${song.slug}.html`);
  if (!fs.existsSync(fp)) continue;
  const text = lyricsOf(fs.readFileSync(fp, 'utf-8'));
  if (!text) { empty++; continue; }
  index[song.slug] = text;
  indexed++;
}

const json = JSON.stringify(index);
process.stdout.write(json);

// Progress goes to stderr so stdout stays pure JSON for the redirect above.
process.stderr.write(
  `search-index: ${indexed} songs, ${empty} without text, ` +
  `${(Buffer.byteLength(json) / 1024).toFixed(0)} kB\n`
);
