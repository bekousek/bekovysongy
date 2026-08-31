#!/usr/bin/env node
/**
 * skel.cjs <slug> - the shape of a song, with the words taken out.
 *
 * `fmt.cjs dump` prints the lyrics, which is exactly what must not happen:
 * once the text is in the model's context it leaks back out - into a summary,
 * a justification, a thinking block - and the API's output filter kills the
 * whole turn with a 400. See CLAUDE.md.
 *
 * Everything a spec needs is structural, so print only that: where the blank
 * lines fall, which fences survived the import, how long each line is, how
 * many chords it carries, and a fingerprint that makes a repeated line
 * recognisable without reading it. No lyric character is ever emitted.
 *
 * Line numbers are the ones `dump` uses (blank lines and fence-only lines are
 * not counted), so a spec can be written straight off this listing. The walk
 * over the raw body is cross-checked against contentLines() and refuses to
 * print if the two disagree - a listing whose numbering is a guess is worse
 * than none.
 */
const { readPre, contentLines, stripFences } = require('./fmt.cjs');

const slug = process.argv[2];
if (!slug) { console.error('usage: skel.cjs <slug>'); process.exit(1); }

const { body } = readPre(slug);
const lines = contentLines(body);

const bare = s => s.replace(/<span class="chord" data-chord="[^"]*">[^<]*<\/span>/g, '')
                   .replace(/<[^>]*>/g, '').trim();

// 16-bit FNV digest of the bare words - enough to match a repeated line
// against its twin, far too little to recover anything from.
function fp(s) {
  const t = bare(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!t) return '----';
  let h = 0x811c9dc5;
  for (const ch of t) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h & 0xffff).toString(16).padStart(4, '0');
}

const FENCE = /^[ \t]*(\/\/[^\s\/]*|\d{1,2}[ \t]*[.)]|(?:Refr[ée]n|Ref|R|Sloka|Slo|S|Bridge|Br|B)[ \t]*\d*[ \t]*[:.])/i;

// null = blank line, string = fence-only line (numbered by nothing), else a row
const rows = [];
let idx = 0;
for (const raw of body.split('\n')) {
  if (raw.trim() === '') { rows.push(null); continue; }
  if (stripFences(raw).trim() === '') { rows.push(raw.trim()); continue; }
  const line = lines[idx++];
  if (line === undefined) break;
  rows.push({
    n: idx,
    head: (raw.match(FENCE) || [])[1] || '',
    tail: (raw.match(/(\S*\/\/)[ \t]*$/) || [])[1] || '',
    len: bare(line).length,
    chords: (line.match(/data-chord=/g) || []).length,
    fp: fp(line),
  });
}

if (idx !== lines.length) {
  console.error('numbering mismatch: walked ' + idx + ' lines, contentLines has ' +
    lines.length + ' - use `fmt.cjs dump` for this one');
  process.exit(1);
}

const blocks = [];
let cur = [];
for (const r of rows) {
  if (r === null) { if (cur.length) blocks.push(cur); cur = []; }
  else if (typeof r === 'object') cur.push(r);
}
if (cur.length) blocks.push(cur);
let run = 0, worst = 0;
for (const b of blocks) { if (b.length === 1) worst = Math.max(worst, ++run); else run = 0; }

console.log('  #  fence      délka  akordy  otisk');
for (const r of rows) {
  if (r === null) { console.log('     ' + '-'.repeat(36)); continue; }
  if (typeof r === 'string') { console.log('     ' + r + '   (jen značka)'); continue; }
  console.log(String(r.n).padStart(3) + '  ' + r.head.padEnd(9) + '  ' +
    String(r.len).padStart(4) + '  ' + String(r.chords).padStart(5) + '   ' + r.fp +
    (r.tail ? '  ' + r.tail : ''));
}
console.log('\n' + lines.length + ' řádků, ' + blocks.length + ' bloků, nejdelší série jednořádkových bloků: ' + worst);
