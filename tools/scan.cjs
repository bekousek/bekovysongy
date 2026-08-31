#!/usr/bin/env node
/**
 * scan.cjs - find songs the script import left double-spaced.
 *
 * The import put a blank line after every lyric line, so the tell is a long
 * run of one-line "sections". A real song has the odd standalone line
 * (a "Mezihra:", a tag line); it does not have five in a row.
 *
 * Prints:  <longest run of 1-line blocks>  <1-line blocks>/<blocks>  <slug>
 */
const fs = require('fs');
const PRE = /<pre class="song-text">([\s\S]*?)<\/pre>/;
const rows = [];
for (const f of fs.readdirSync('songs').filter(f => f.endsWith('.html'))) {
  const m = fs.readFileSync('songs/' + f, 'utf8').replace(/\r\n?/g, '\n').match(PRE);
  if (!m) continue;
  const blocks = m[1].split('\n').map(l => l.replace(/[ \t]+$/, ''))
    .join('\n').split(/\n{2,}/).map(b => b.split('\n').filter(l => l !== ''))
    .filter(b => b.length);
  if (!blocks.length) continue;
  let run = 0, best = 0, ones = 0;
  for (const b of blocks) {
    if (b.length === 1) { ones++; best = Math.max(best, ++run); } else run = 0;
  }
  const lines = blocks.reduce((n, b) => n + b.length, 0);
  if (lines < 4) continue;
  rows.push({ slug: f.replace(/\.html$/, ''), best, ones, n: blocks.length, lines });
}
rows.sort((a, b) => b.best - a.best || b.ones / b.n - a.ones / a.n);
for (const r of rows) {
  if (r.best < 3) continue;
  console.log(String(r.best).padStart(3) + '  ' + String(r.ones).padStart(3) + '/' +
    String(r.n).padEnd(3) + ' ' + String(r.lines).padStart(3) + 'L  ' + r.slug);
}
console.error('total ' + rows.length + ', flagged ' + rows.filter(r => r.best >= 3).length);
