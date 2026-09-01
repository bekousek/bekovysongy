#!/usr/bin/env node
/**
 * skel.cjs <slug> - the shape of a song, with the words taken out.
 *
 * `fmt.cjs dump` prints the lyrics, which is exactly what must not happen:
 * once the text is in the model's context it leaks back out - into a summary,
 * a justification, a thinking block - and the API's output filter kills the
 * whole turn with a 400. See CLAUDE.md.
 *
 * Everything a spec needs is structural, so print only that:
 *
 *   #        line number, the one fmt.cjs specs address
 *   fence    marker the import left on the line ("//R", "1.", "Refrén:")
 *   délka    characters of lyric, chords and markup removed
 *   otisk    16-bit digest of the words, with *N when the line occurs N times
 *   akordy   the chords in order, by name
 *   značka   set when the line is a section label, not lyric
 *
 * The otisk is what resolves refrains: line 39 carrying the same digest as
 * line 21 is the same line, so 39 opens a repeat - readable without reading.
 * The chord names resolve section length, because a verse and its chorus keep
 * different progressions and a repeating cycle marks the block boundary. The
 * značka resolves the short lines: "[Chorus]" or "Mezihra:" is a cue to be
 * dropped or kept as raw, and it is matched against a whitelist in here, so
 * only the verdict is printed and a real lyric line stays unprinted.
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
                   .replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();

// 16-bit FNV digest of the bare words - enough to match a repeated line
// against its twin, far too little to recover anything from.
function fp(s) {
  const t = bare(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!t) return '----';
  let h = 0x811c9dc5;
  for (const ch of t) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h & 0xffff).toString(16).padStart(4, '0');
}

// Section labels an import may have left in the body as ordinary lines. Only
// the matched keyword is ever printed, never the line, so a line that is not
// on this list stays a line nobody has read.
const LABELS = new Set(['verse', 'chorus', 'pre chorus', 'prechorus', 'post chorus',
  'bridge', 'outro', 'intro', 'refrain', 'refren', 'refrén', 'ref', 'solo', 'sloka',
  'slo', 'mezihra', 'predehra', 'předehra', 'dohra', 'coda', 'kóda', 'interlude',
  'hook', 'break', 'instrumental', 'tag', 'vamp', 'riff', 'vybrnkavani',
  'vybrnkávání', 'recitativ', 'rap', 'finale', 'závěr', 'zaver', 'konec', 'sbor',
  'opakuj', 'repeat', 'melodie', 'akordy', 'capo', 'nastup', 'nástup']);
function label(s) {
  const t = bare(s);
  if (!t || t.length > 20) return '';
  const core = t.toLowerCase()
    .replace(/[\[\]()]/g, ' ')
    .replace(/\d+\s*[x×]|[x×]\s*\d+/g, ' ')
    .replace(/[0-9.:;,\-–—_*|/]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return LABELS.has(core) ? core : '';
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
    chords: [...line.matchAll(/data-chord="([^"]*)"/g)].map(m => m[1]),
    fp: fp(line),
    label: label(line),
  });
}

if (idx !== lines.length) {
  console.error('numbering mismatch: walked ' + idx + ' lines, contentLines has ' +
    lines.length + ' - use `fmt.cjs dump` for this one');
  process.exit(1);
}

// how often each digest occurs, so a repeated line is marked where it stands
const seen = {};
for (const r of rows) if (typeof r === 'object' && r) seen[r.fp] = (seen[r.fp] || 0) + 1;

const blocks = [];
let cur = [];
for (const r of rows) {
  if (r === null) { if (cur.length) blocks.push(cur); cur = []; }
  else if (typeof r === 'object') cur.push(r);
}
if (cur.length) blocks.push(cur);
let run = 0, worst = 0;
for (const b of blocks) { if (b.length === 1) worst = Math.max(worst, ++run); else run = 0; }

console.log('  #  fence      délka  otisk    akordy / značka');
for (const r of rows) {
  if (r === null) { console.log('     ' + '-'.repeat(46)); continue; }
  if (typeof r === 'string') { console.log('     ' + r + '   (jen značka)'); continue; }
  const rep = r.fp !== '----' && seen[r.fp] > 1 ? '*' + seen[r.fp] : '';
  console.log(String(r.n).padStart(3) + '  ' + r.head.padEnd(9) + '  ' +
    String(r.len).padStart(4) + '  ' + (r.fp + rep).padEnd(7) + '  ' +
    r.chords.join(' ') + (r.label ? '  ZNAČKA <' + r.label + '>' : '') +
    (r.tail ? '  ' + r.tail : ''));
}
console.log('\n' + lines.length + ' řádků, ' + blocks.length + ' bloků, nejdelší série jednořádkových bloků: ' + worst);
