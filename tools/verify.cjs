#!/usr/bin/env node
/**
 * verify.cjs <slug...> - prove a reformat changed only layout.
 *
 * Compares the working copy against git HEAD: the ordered list of chords and
 * the lyric text (markers, numbering and whitespace removed) must be equal.
 *
 * Lines a spec deliberately deleted (a bare "Refrén" cue that became a
 * "//R R//" fence) are removed from the HEAD side first, using the very same
 * line numbering fmt.cjs used to write them - so the comparison still proves
 * that nothing else moved. A deletion not declared in .fmt-specs/<slug>.json
 * is a failure, which is the point.
 *
 * A failure says WHICH song broke, not which words: printing the mismatch puts
 * the lyric in whatever is reading the output, and for a model that is the one
 * thing CLAUDE.md forbids. Pass --why to see the differing words; that output
 * is for a human at a terminal, never for a model's context.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const { contentLines } = require('./fmt.cjs');

const PRE_RE = /<pre class="song-text">([\s\S]*?)<\/pre>/;

function pre(text) {
  const m = text.replace(/\r\n?/g, '\n').match(PRE_RE);
  return m ? m[1] : null;
}
function chords(body) {
  return (body.match(/data-chord="([^"]*)"/g) || []).join(' ');
}
function words(body) {
  return body
    .replace(/<span class="chord" data-chord="[^"]*">[^<]*<\/span>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .split('\n')
    .map(l => l
      // "//R 2x" - the play count belongs to the fence, not to the lyrics,
      // so it drops out on both sides of the comparison.
      .replace(/^[ \t]*\/\/(?!:)[^\s\/:]*:?(?:[ \t]*\(?\s*(?:\d{1,2}\s*[x×]|[x×]\s*\d{1,2})\s*\)?\.?(?=[ \t]|$))?/, ' ')
      .replace(/(?<!:)[ \t]*[^\s\/:]*[ \t]*\/\/[ \t]*$/, ' ')
      .replace(/^[ \t]*(?:Refr[ée]n|Ref|R|Sloka|Slo|S|Bridge|Br|B)[ \t]*\d*[ \t]*[:.]/i, ' ')
      .replace(/^[ \t]*\d{1,2}[ \t]*\.[ \t]*/, ' '))
    .join(' ')
    .replace(/\.\.\.|…/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function spec(slug) {
  const p = '.fmt-specs/' + slug + '.json';
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

// Drop the declared lines from HEAD, addressed exactly as the spec addressed
// them: fmt.cjs numbers the content lines it derives from the body, not the
// raw lines, so the numbering has to come from the same function.
function headText(body, s) {
  if (!s.drop && !s.strip && !s.stripNum) return body;
  const drop = new Set();
  for (const part of String(s.drop).split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    for (let i = +m[1]; i <= (m[2] ? +m[2] : +m[1]); i++) drop.add(i);
  }
  const lines = contentLines(body, { stripNum: !!s.stripNum, strip: s.strip });
  return lines.filter((_, i) => !drop.has(i + 1)).join('\n');
}

const args = process.argv.slice(2);
const why = args.includes('--why');
let bad = 0;
for (const slug of args.filter(a => a !== '--why')) {
  const path = 'songs/' + slug + '.html';
  const head = execSync('git show HEAD:' + path, { encoding: 'utf8', maxBuffer: 1 << 26 });
  const now = fs.readFileSync(path, 'utf8');
  const s = spec(slug);
  const a = headText(pre(head), s), b = pre(now);
  const problems = [];
  if (chords(a) !== chords(b)) problems.push('chords differ');
  if (words(a) !== words(b)) {
    const wa = words(a).split(' '), wb = words(b).split(' ');
    let at = 0;
    while (at < Math.max(wa.length, wb.length) && wa[at] === wb[at]) at++;
    problems.push('lyrics differ, first at word ' + at + ' of ' + wa.length);
    if (why) problems.push('  HEAD=' + JSON.stringify(wa.slice(at, at + 8).join(' ')) +
                           ' NOW=' + JSON.stringify(wb.slice(at, at + 8).join(' ')));
  }
  if (problems.length) { bad++; console.log('FAIL ' + slug + '\n  ' + problems.join('\n  ')); }
  else console.log('ok   ' + slug);
}
process.exit(bad ? 1 : 0);
