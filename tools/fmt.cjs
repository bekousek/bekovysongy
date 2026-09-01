#!/usr/bin/env node
/**
 * fmt.cjs - reformat the <pre class="song-text"> body of a song file.
 *
 *   node tools/fmt.cjs dump  <slug> [--raw]   print numbered content lines
 *   node tools/fmt.cjs apply <slug> <spec>    rewrite the <pre> from a spec
 *
 * `dump` prints lyrics and exists for a human debugging by hand; a model wants
 * tools/skel.cjs, which prints the same structure with the words taken out.
 * `apply` reports a dropped line by its measurements for the same reason -
 * add --why to see the line itself.
 *
 * Lyric lines are never retyped - only reordered/regrouped - so chord spans
 * survive byte for byte. The spec addresses lines by the numbers `dump` prints.
 *
 * spec = JSON array of sections, in output order:
 *   {"t":"",   "l":"1-4"}     plain verse, lines 1..4
 *   {"t":"R",  "l":"5-8"}     //R <line5> ... <line8> R//
 *   {"t":"R",  "l":""}        //R R//              (repeat)
 *   {"t":"R",  "l":"", "n":"2x"}   //R 2x R//
 *   {"t":"B",  "l":"9-12"}    bridge
 *   {"t":"R",  "l":"20", "tail":true}   //R \n...\n<line20> R// (changed ending)
 *   {"t":"VYBRNKÁVÁNÍ", "l":"", "bare":true}  //VYBRNKÁVÁNÍ//
 *       an empty section normally renders as "//R R//"; "bare" asks for the
 *       one-marker spelling "//R//", which is what a standalone cue looks like
 *   {"t":"raw","l":"13-14"}   emit lines verbatim, no fence (tab, Mezihra, ...)
 * "l" accepts comma-separated ranges: "1-4,9".
 * A section may add "block":true to force the multi-line fence form.
 *
 * The array form may be wrapped to carry options:
 *   {"stripNum":true, "drop":"13", "sections":[ ... ]}
 * "stripNum" removes a leading "1." verse number from every line; "drop"
 * lists lines to delete (a bare "Refrén" cue that becomes a //R R// fence);
 * "strip" removes a declared piece of a line by number ({"15":"3. "}), or
 * several in order ({"15":["3 ",". "]}) when a chord span sits inside it.
 * Every other line must be placed exactly once, or apply refuses to write.
 */
const fs = require('fs');
const path = require('path');

const PRE_RE = /(<pre class="song-text">)([\s\S]*?)(<\/pre>)/;

function file(slug) { return path.join('songs', slug + '.html'); }

function readPre(slug) {
  const raw = fs.readFileSync(file(slug), 'utf8');
  // Work in LF and put the file's own line ending back on write, so a
  // reformat never rewrites every line of a CRLF file as a side effect.
  const eol = /\r\n/.test(raw) ? '\r\n' : '\n';
  const html = raw.replace(/\r\n?/g, '\n');
  const m = html.match(PRE_RE);
  if (!m) throw new Error('no <pre class="song-text"> in ' + slug);
  return { html, eol, open: m[1], body: m[2], close: m[3] };
}

// Strip section fences ("//R", "R//") but keep repeat marks ("//:", "://").
function stripFences(line) {
  let s = line;
  if (!/^[ \t]*\/\/:/.test(s)) s = s.replace(/^[ \t]*\/\/([^\s\/:]+):?[ \t]?/, '');
  if (!/:\/\/[ \t]*$/.test(s)) s = s.replace(/[ \t]*(?:[^\s\/:]+)?[ \t]*\/\/[ \t]*$/, '');
  return s;
}

function contentLines(body, opts = {}) {
  let lines = body.split('\n').map(l => l.replace(/[ \t]+$/, ''));
  const out = [];
  for (let raw of lines) {
    let s = stripFences(raw);
    if (opts.stripNum) s = s.replace(/^([ \t]*)\d{1,2}[ \t]*[.)][ \t]*/, '$1');
    if (s.trim() === '') continue;
    out.push(s);
  }
  // Global dedent: many imports indent the whole song, which then collides
  // with the "//R " the first line of a section gets prefixed with. Removing
  // only the indent every line shares keeps relative indentation (aligned
  // continuations, tab diagrams) exactly as it was.
  let min = Infinity;
  for (const l of out) min = Math.min(min, l.match(/^[ \t]*/)[0].length);
  const dedented = min > 0 && min < Infinity ? out.map(l => l.slice(min)) : out;

  // Declared prefix removals, by line number: the marker some imports carry
  // in a form no parser recognizes ("2x R:", "©1:", "®:"), which becomes a
  // real fence instead. Listed one by one in the spec so the deletion is
  // never a guess, and echoed back at apply time.
  // A list removes several pieces in order, for the numbering an import split
  // around a chord span ("3 <span>a</span> . text" is the verse number "3.").
  const strip = opts.strip || {};
  return dedented.map((l, i) => {
    const pre = strip[String(i + 1)];
    if (pre == null) return l;
    return (Array.isArray(pre) ? pre : [pre]).reduce((s, p) => {
      const at = s.indexOf(p);
      if (at === -1) throw new Error('line ' + (i + 1) + ' has no prefix ' + JSON.stringify(p));
      return s.slice(0, at) + s.slice(at + p.length);
    }, l);
  });
}

function parseRange(spec) {
  if (spec === '' || spec == null) return [];
  const idx = [];
  for (const part of String(spec).split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error('bad range: ' + t);
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = a; i <= b; i++) idx.push(i);
  }
  return idx;
}

// Remove the indent all of a section's lines share. Old imports indented whole
// choruses to set them off; with a fence doing that job the indent only pushes
// the body out of line with the "//R " the first line now carries.
function dedent(lines) {
  let min = Infinity;
  for (const l of lines) if (l.trim() !== '') min = Math.min(min, l.match(/^[ \t]*/)[0].length);
  return min > 0 && min < Infinity ? lines.map(l => l.slice(min)) : lines;
}

function render(sections, lines) {
  const blocks = [];
  for (const sec of sections) {
    const idx = parseRange(sec.l);
    let got = idx.map(i => {
      if (i < 1 || i > lines.length) throw new Error('line out of range: ' + i);
      return lines[i - 1];
    });
    const t = sec.t == null ? '' : String(sec.t);

    if (t === '' || t === 'raw') { blocks.push(got.join('\n')); continue; }
    got = dedent(got);

    const note = sec.n ? ' ' + sec.n : '';
    if (!got.length && !sec.tail) {
      blocks.push(sec.bare ? '//' + t + note + '//' : '//' + t + note + ' ' + t + '//');
      continue;
    }

    const inner = sec.tail ? ['...'].concat(got) : got;
    if (sec.block || sec.tail) {
      blocks.push('//' + t + note + '\n' + inner.join('\n') + '\n' + t + '//');
    } else {
      const b = inner.slice();
      b[0] = '//' + t + note + ' ' + b[0];
      b[b.length - 1] = b[b.length - 1] + ' ' + t + '//';
      blocks.push(b.join('\n'));
    }
  }
  return blocks.join('\n\n');
}

module.exports = { PRE_RE, readPre, contentLines, stripFences, parseRange, render };

if (require.main !== module) return;

const [, , cmd, slug, arg] = process.argv;

if (cmd === 'dump') {
  const { body } = readPre(slug);
  const raw = process.argv.includes('--raw');
  const stripNum = process.argv.includes('--num');
  const lines = contentLines(body, { stripNum });
  lines.forEach((l, i) => {
    const shown = raw ? l : l.replace(/<span class="chord" data-chord="[^"]*">([^<]*)<\/span>/g, '[$1]');
    console.log(String(i + 1).padStart(3) + ' | ' + shown);
  });
} else if (cmd === 'apply') {
  const { html, eol, open, body, close } = readPre(slug);
  const spec = JSON.parse(fs.readFileSync(arg, 'utf8'));
  const stripNum = !!spec.stripNum;
  const sections = Array.isArray(spec) ? spec : spec.sections;
  const lines = contentLines(body, { stripNum, strip: spec.strip });
  const built = render(sections, lines);

  // Every content line must be used exactly once - a dropped or duplicated
  // lyric line is the one failure mode that must never pass silently.
  const used = [];
  sections.forEach(s => used.push(...parseRange(s.l)));
  const dropped = parseRange(spec.drop);
  const seen = new Set(used.concat(dropped));
  const missing = [];
  for (let i = 1; i <= lines.length; i++) if (!seen.has(i)) missing.push(i);
  if (missing.length) throw new Error('unused lines: ' + missing.join(','));
  if (used.length + dropped.length !== seen.size) throw new Error('duplicate line use');
  // What a drop removed is echoed back so the deletion is never silent, but by
  // default only its measurements: the text of a deleted line is still lyric,
  // and CLAUDE.md keeps lyric out of whatever reads this. --why spells it out.
  const why = process.argv.includes('--why');
  dropped.forEach(i => {
    const l = lines[i - 1];
    console.log('  drop ' + i + ': ' + (why
      ? l.replace(/<span class="chord" data-chord="[^"]*">([^<]*)<\/span>/g, '[$1]')
      : l.replace(/<span class="chord" data-chord="[^"]*">[^<]*<\/span>/g, '').replace(/<[^>]*>/g, '').trim().length +
        ' znaků, ' + (l.match(/data-chord=/g) || []).length + ' akordů'));
  });
  Object.keys(spec.strip || {}).forEach(i => console.log('  strip ' + i + ': ' + JSON.stringify(spec.strip[i])));

  const next = html.replace(PRE_RE, () => open + built + close);
  fs.writeFileSync(file(slug), eol === '\n' ? next : next.replace(/\n/g, eol));
  console.log('ok ' + slug + ' (' + lines.length + ' lines, ' + sections.length + ' sections)');
} else {
  console.error('usage: fmt.cjs dump|apply <slug> [spec.json]');
  process.exit(1);
}
