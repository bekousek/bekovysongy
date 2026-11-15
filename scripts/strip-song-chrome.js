#!/usr/bin/env node
'use strict';
/**
 * Cuts the dead chrome out of songs/*.html: the old <nav class="main-nav">
 * and <div id="player-bar">, which js/player.js removes the moment a page
 * loads. They were 2.2 kB of each of 600+ pages - a third of what every
 * phone downloads for offline. js/song-template.js no longer writes them.
 *
 * Only those two blocks go, whole lines, matched by their own nesting (the
 * player bar has divs inside). Each file keeps its own line endings (the
 * songs are a mix of CRLF and LF), and the <pre> with the song is checked to
 * come out byte for byte the same. Safe to run again: a page without the
 * blocks is left alone.
 *
 *   node scripts/strip-song-chrome.js          rewrite the pages
 *   node scripts/strip-song-chrome.js --check  only count, write nothing
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'songs');
const check = process.argv.includes('--check');

// The block that opens at `start` with tag `tag`, through its matching
// closing tag: [start, end) in the text.
function blockEnd(text, start, tag) {
  const re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'g');
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(text))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return re.lastIndex;
  }
  throw new Error('unclosed <' + tag + '>');
}

// Removes the block starting with `opener` as whole lines, plus one blank
// line after it, so "</main>\n\n  <script" is what's left around it.
function cut(text, opener, tag) {
  const at = text.indexOf(opener);
  if (at === -1) return text;
  const lineStart = text.lastIndexOf('\n', at) + 1;
  if (text.slice(lineStart, at).trim() !== '') throw new Error(opener + ' does not start its line');
  let end = blockEnd(text, at, tag);
  const nl = text.indexOf('\n', end);
  if (nl === -1 || text.slice(end, nl).trim() !== '') throw new Error(opener + ' does not end its line');
  end = nl + 1;
  if (text.slice(end, end + 1) === '\n') end += 1;   // the blank line after it
  return text.slice(0, lineStart) + text.slice(end);
}

const songOf = (t) => {
  const m = t.match(/<pre class="song-text">[\s\S]*?<\/pre>/);
  if (!m) throw new Error('no <pre class="song-text">');
  return m[0];
};

let changed = 0;
let saved = 0;
for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.html')).sort()) {
  const file = path.join(DIR, f);
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  const text = raw.replace(/\r\n/g, '\n');
  let out;
  try {
    out = cut(cut(text, '<nav class="main-nav">', 'nav'), '<div class="player-bar" id="player-bar">', 'div');
  } catch (e) {
    console.error(`songs/${f}: ${e.message}`);
    process.exitCode = 1;
    continue;
  }
  if (out === text) continue;
  if (songOf(out) !== songOf(text)) throw new Error(`songs/${f}: the song itself changed`);
  if (/player-bar|main-nav/.test(out)) throw new Error(`songs/${f}: leftovers`);
  const written = crlf ? out.replace(/\n/g, '\r\n') : out;
  saved += Buffer.byteLength(raw) - Buffer.byteLength(written);
  changed++;
  if (!check) fs.writeFileSync(file, written);
}
console.log(`${check ? 'Would strip' : 'Stripped'} ${changed} page(s), ${(saved / 1024).toFixed(0)} kB less.`);
