#!/usr/bin/env node
/**
 * scan.cjs - find the songs whose layout the import broke.
 *
 * Three shapes of damage, three lists:
 *
 * ROZSYP - the import put a blank line after every lyric line, so the tell is
 *   a long run of one-line "sections". A real song has the odd standalone line
 *   (a "Mezihra:", a tag line); it does not have five in a row. Note that a
 *   song ending in a stack of "//R//" repeat markers looks the same from here
 *   and is fine - check the skeleton before rewriting one.
 *
 * OSAMOCENÝ ŘÁDEK - the same import also nicked single lines off the end of a
 *   verse, one at a time. One 1-line block is not a run, so the first list
 *   cannot see it. The tell is a long line alone between blocks where folding
 *   it back into its neighbour restores the song's usual block size.
 *
 * ČÍSLOVÁNÍ - verse numbers, which come out unless a verse repeats somewhere
 *   (a "4.=1." back-reference, or the same number twice), because then the
 *   numbers are what says which verse comes back.
 *
 * No lyric is printed: a song is named by slug, a line by number.
 */
const fs = require('fs');
const { readPre, contentLines, stripFences } = require('./fmt.cjs');

const bare = s => s.replace(/<span class="chord" data-chord="[^"]*">[^<]*<\/span>/g, '')
                   .replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
const NUM = /^(\d{1,2})[ \t]*[.)]/;
const BACKREF = /^\d{1,2}[ \t]*[.)][ \t]*=?[ \t]*\d{1,2}[ \t]*[.)]?[ \t]*$/;

const loose = [], orphans = [], numbered = [];
let total = 0;

for (const f of fs.readdirSync('songs').filter(f => f.endsWith('.html'))) {
  const slug = f.replace(/\.html$/, '');
  let body;
  try { body = readPre(slug).body; } catch (e) { continue; }
  const lines = contentLines(body);

  // walk the raw body once, so a block knows which numbered lines it holds
  const rows = [];
  let idx = 0;
  for (const raw of body.split('\n')) {
    if (raw.trim() === '') { rows.push(null); continue; }
    if (stripFences(raw).trim() === '') { rows.push('marker'); continue; }
    rows.push({ n: ++idx, text: bare(lines[idx - 1]) });
  }
  if (idx !== lines.length) continue;
  const blocks = [];
  let cur = [];
  for (const r of rows) { if (r === null) { if (cur.length) blocks.push(cur); cur = []; } else cur.push(r); }
  if (cur.length) blocks.push(cur);
  if (!blocks.length || lines.length < 4) continue;
  total++;

  // 1. runs of one-line blocks
  let run = 0, best = 0, ones = 0;
  for (const b of blocks) {
    if (b.length === 1) { ones++; best = Math.max(best, ++run); } else run = 0;
  }
  if (best >= 3) loose.push({ slug, best, ones, n: blocks.length, lines: lines.length });

  // 2. a lyric line stranded alone next to a block one short of the usual size
  const sizes = blocks.map(b => b.filter(r => r.n).length).filter(n => n >= 2);
  if (sizes.length) {
    const tally = {};
    sizes.forEach(n => tally[n] = (tally[n] || 0) + 1);
    const mode = +Object.keys(tally).sort((a, b) => tally[b] - tally[a] || b - a)[0];
    const hits = [];
    blocks.forEach((b, i) => {
      const ns = b.filter(r => r.n);
      if (ns.length !== 1 || ns[0].text.length <= 16) return;   // a cue, a chord line, a tag
      const sz = j => (blocks[j] || []).filter(r => r.n).length;
      if (sz(i - 1) + 1 === mode || sz(i + 1) + 1 === mode) hits.push(ns[0].n);
    });
    if (hits.length) orphans.push({ slug, mode, hits });
  }

  // 3. verse numbering, and whether it still carries information
  const nums = [], refs = [];
  lines.forEach((l, i) => {
    const t = bare(l), m = t.match(NUM);
    if (!m) return;
    nums.push(m[1] + '@' + (i + 1));
    if (BACKREF.test(t)) refs.push(i + 1);
  });
  const repeated = new Set(nums.map(s => s.split('@')[0])).size < nums.length;
  // Numbers on lines that touch are a first/second ending ("1. ..." / "2. ..."),
  // not verse numbering, and they say which line to sing when - so they stay.
  const at = nums.map(s => +s.split('@')[1]);
  const endings = at.every((n, i) => i === 0 || n === at[i - 1] + 1);
  if (nums.length >= 2) numbered.push({ slug, nums, keep: refs.length > 0 || repeated || endings });
}

console.log('== ROZSYP (série jednořádkových bloků) ==');
loose.sort((a, b) => b.best - a.best || b.ones / b.n - a.ones / a.n);
for (const r of loose) {
  console.log(String(r.best).padStart(3) + '  ' + String(r.ones).padStart(3) + '/' +
    String(r.n).padEnd(3) + ' ' + String(r.lines).padStart(3) + 'L  ' + r.slug);
}

console.log('\n== OSAMOCENÝ ŘÁDEK (blok o jeden kratší než obvykle) ==');
for (const r of orphans) {
  console.log('  obvykle ' + r.mode + ' řádků, samotné: ' + r.hits.join(',') + '   ' + r.slug);
}

console.log('\n== ČÍSLOVÁNÍ SLOK ==');
for (const r of numbered) {
  console.log('  ' + (r.keep ? 'PONECHAT ' : 'sundat   ') + r.slug.padEnd(34) + r.nums.join(' '));
}

console.error('\ntotal ' + total + ' | rozsyp ' + loose.length +
  ', osamocené ' + orphans.length + ', číslování ' + numbered.filter(r => !r.keep).length +
  ' (+' + numbered.filter(r => r.keep).length + ' ponechat)');
