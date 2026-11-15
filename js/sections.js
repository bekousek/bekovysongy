/**
 * sections.js - Render song sections (refrén / sloka / bridge) from fences.
 *
 * Songs are authored as the inner HTML of <pre class="song-text">. A section
 * is FENCED - the author says exactly where it starts and ends, and the
 * markers never show up in the rendered text:
 *
 *      //R    ...  R//     -> refrén (chorus)   [indented]
 *      //R2   ...  R2//    -> 2. refrén
 *      //S1   ...  S1//    -> 1. sloka          [labelled, baseline]
 *      //B    ...  B//     -> bridge            [indented, italic]
 *      //Coda ...  Coda//  -> any other name    [labelled, baseline]
 *      //:    ...  ://     -> repetice, rendered inline as |: ... :|
 *
 * "//NAME" opens and "NAME//" closes (a bare "//" closes whatever is open).
 * NAME is any run of characters that is neither whitespace nor "/", ":",
 * "<" or ">" - so a chord written straight after the marker ("//R<span
 * ...>G</span>") is the body, not part of the name. Markers are only
 * recognized at the very start (open) or very end (close) of a line, so a
 * "//" inside lyrics is harmless. Blank lines inside a fence do NOT end it -
 * that is the whole point of fencing. "//R//" (or "//R 2x//") on one line is
 * an empty section, i.e. "the chorus repeats here".
 *
 * Repeats ("//:" ... "://") are deliberately NOT structural: they are a
 * line-level annotation that renders as |: and :| wherever it appears,
 * including inside a section fence.
 *
 * The older prefix markers ("R:", "Ref.", "B:" at the start of a block) are
 * gone since 2026-11: every song is fenced, and the prefix form ate the start
 * of real lyrics ("S. O. S. volám", "B. B. King"). Such a line is now text.
 *
 * Outside fences, blocks are separated by blank lines and are plain verses
 * (baseline, no label). Fences that share an identity (type + number)
 * relate to the first one that carries real text (the "definition"). A later
 * one with the same identity is a collapsible repeat only when it clearly is
 * one:
 *
 *   - empty body ("//R//")                    -> repeat, expands to the definition
 *   - just a play count ("//R 2x//")          -> repeat, the count stays visible
 *   - body text-identical to the definition   -> repeat, expands to its own body
 *   - body opening with "..." (or "…")        -> repeat with a CHANGED ENDING
 *
 * Anything else with a reused identity (variant chorus, chord run) is NOT a
 * repeat and stays visible - collapsing it would hide lyrics/chords that exist
 * nowhere else in the song.
 *
 * The changed ending exists because the last chorus of a song so often ends
 * on a different line, and spelling the whole chorus out again just for that
 * loses the collapsing:
 *
 *      //R
 *      ...
 *      a víc už nechci nic.
 *      R//
 *
 * "..." means "the chorus as before"; the lines under it replace as many
 * lines at the END of the definition as were written (one line swaps the last
 * line, two swap the last two). "//R ... a víc už nechci nic. R//" on one
 * line means the same. The new ending is rendered twice: inside
 * .section-body, which is the expanded chorus, and again in its own
 * .section-tail, which is what stays on screen next to the collapsed pill -
 * so a reader who has the chorus by heart still sees what changes.
 *
 * transform(innerHTML) -> innerHTML wrapped into <div class="song-section ...">.
 * Section markup: <span class="section-head"> holds the label (and the play
 * count as .section-note); the body follows in <span class="section-body">.
 * It is a pure string transform (chord <span>s are preserved verbatim) so it
 * works both on the live song page (player.js) and in the editor preview;
 * interactivity of collapsed repeats (pill click/peek) is added by the caller.
 *
 * transform(innerHTML, { lines: true }) is the song page's version: every line
 * becomes its own <span class="ln"> (so a wrapped line can hang indented
 * instead of passing for the next verse), a chord is glued to the word after
 * it (the line never breaks between them), and consecutive tablature lines
 * are grouped in <span class="tabs"> to be set monospaced, unwrapped. The
 * editor preview and the PDF call it without, they know nothing of .ln.
 *
 * parseBlocks() additionally reports srcStart/srcEnd - the block's line range
 * in normalizeBreaks(html).split('\n') - so the editor can rewrite a block in
 * the source without re-parsing HTML.
 *
 * Browser: window.SongSections. Node: module.exports (for tests).
 */
(function (global) {
  'use strict';

  // Fence name reserved for repetice ("//:" ... "://"), handled as inline
  // marks rather than as a section.
  var REPEAT_NAME = ':';

  // "//NAME" at the start of a line. NAME is anything but whitespace, "/",
  // ":", "<" and ">" - ":" is excluded so that "//:Obzor neklesne níž" reads
  // as a repeat opening a line of lyrics, not as a section named ":Obzor",
  // and "<" / ">" so a chord span typed straight after "//R" stays a chord. A
  // colon typed right after the name ("//R:") is swallowed as punctuation.
  var FENCE_OPEN_RE = /^[ \t]*\/\/([^\s\/:<>]+):?/;
  var REPEAT_OPEN_RE = /^[ \t]*\/\/:/;

  // "//" at the very end of a line, optionally preceded by an echo of the
  // fence's own name ("R//").
  var FENCE_END_RE = /\/\/[ \t]*$/;
  var REPEAT_CLOSE_RE = /:\/\/[ \t]*$/;

  // The known section-type tokens a fence name may use, so "//Refren" and
  // "//R" are the same chorus.
  var FENCE_TYPE_RE = /^(Refr[ée]n|Ref|R|Sloka|Slo|S|Bridge|Br|B)(\d*)$/i;

  // A bare play-count annotation: "2x", "(2x)", "2×", "x3", "3X."
  var MULT_RE = /^\(?\s*(?:\d{1,2}\s*[x×]|[x×]\s*\d{1,2})\s*\)?\.?$/i;

  // "..." (or "…") opening a repeat's body: "the chorus as before, only it
  // ends differently". What follows replaces as many lines at the END of the
  // definition as were written - see applyTail().
  var TAIL_RE = /^[ \t]*(?:\.\.\.|…)[ \t]*/;

  function stripTags(s) {
    return s.replace(/<[^>]*>/g, '');
  }

  function classifyType(token) {
    var c = token.charAt(0).toLowerCase();
    if (c === 'r') return 'refren';
    if (c === 'b') return 'bridge';
    if (c === 's') return 'sloka';
    return null;
  }

  function sameName(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  // Identity + label for a fence name. Known tokens (R/S/B and their long
  // forms, with an optional number) map to a type + number, so "//R" and
  // "//Refrén" collapse together; any other name becomes a custom section
  // labelled with the name as typed.
  function fenceIdentity(name) {
    var m = name.match(FENCE_TYPE_RE);
    if (m) {
      var type = classifyType(m[1]);
      if (type) return { type: type, id: m[2] || '', label: labelText(type, m[2] || '') };
    }
    return { type: 'custom', id: name.toUpperCase(), label: name + ':' };
  }

  // "//NAME" opening a section fence on this line -> { name, end } (end =
  // index just past the marker), or null. A repeat opener ("//:") is not a
  // section and reports null.
  function matchFenceOpen(line) {
    if (REPEAT_OPEN_RE.test(line)) return null;
    var m = line.match(FENCE_OPEN_RE);
    if (!m) return null;
    return { name: m[1], end: m[0].length };
  }

  // Index at which the marker closing the fence named `name` starts in
  // `text`, or -1 if this line doesn't close it. Whatever precedes that
  // index is still body content, so "//R 2x//" keeps its "2x".
  function fenceCloseAt(text, name) {
    // A repeat's "://" is an inline mark, never the end of a section.
    if (REPEAT_CLOSE_RE.test(text)) return -1;
    var m = text.match(FENCE_END_RE);
    if (!m) return -1;
    var before = text.slice(0, m.index);
    var echo = before.match(/([^\s\/:<>]+)[ \t]*$/);
    if (echo && sameName(echo[1], name)) return echo.index;
    return m.index;
  }

  function leadingWs(line) {
    var m = line.match(/^[ \t]*/);
    return m ? m[0].length : 0;
  }

  function isBlank(line) {
    return line.trim() === '';
  }

  // The editor's contenteditable mixes <br>/<div>/<p> with literal newlines and
  // emits non-breaking spaces. Normalize all line breaks to "\n" (keeping chord
  // spans intact) and nbsp to plain spaces so block/indent detection works.
  function normalizeBreaks(html) {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p)\s*>/gi, '')
      .replace(/<(div|p)\b[^>]*>/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/[\xa0  ]/g, ' ')
      .replace(/\r\n?/g, '\n');
  }

  // Text and attribute values alike.
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Tag-stripped, whitespace-collapsed text of a body chunk.
  function plainText(html) {
    return stripTags(html)
      .replace(/&nbsp;/gi, ' ')
      .replace(/\xa0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Comparable fingerprint of a body: chord spans become [Ami] tokens (chords
  // are information - "same lyrics, other chords" must NOT collapse), case and
  // whitespace differences are ignored.
  function compareText(html) {
    var s = html.replace(/<span[^>]*data-chord="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi, ' [$1] ');
    return plainText(s).toLowerCase();
  }

  // Split the song into ordered blocks. A block is
  // { marker, fenced, type, id, label, lines, srcStart, srcEnd }.
  function parseBlocks(html) {
    var lines = normalizeBreaks(html).split('\n');
    var blocks = [];
    var cur = null;    // current unfenced block (blank-line delimited)
    var fence = null;  // current fenced section, if any

    function push() {
      if (cur) { blocks.push(cur); cur = null; }
    }

    function openFence(name, i) {
      var ident = fenceIdentity(name);
      return {
        marker: true, fenced: true, name: name,
        type: ident.type, id: ident.id, label: ident.label,
        lines: [], srcStart: i, srcEnd: i
      };
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (fence) {
        var at = fenceCloseAt(line, fence.name);
        if (at !== -1) {
          var tail = line.slice(0, at).replace(/[ \t]+$/, '');
          if (!isBlank(tail)) fence.lines.push(tail);
          fence.srcEnd = i;
          blocks.push(fence);
          fence = null;
          continue;
        }
        // An unterminated fence gives way to the next one rather than
        // swallowing the rest of the song (this is the state the editor is
        // in for every keystroke between typing "//R" and typing "R//").
        var reopen = matchFenceOpen(line);
        if (!reopen) {
          fence.lines.push(line);
          fence.srcEnd = i;
          continue;
        }
        blocks.push(fence);
        fence = null;
      }

      var op = matchFenceOpen(line);
      if (op) {
        push();
        fence = openFence(op.name, i);
        var after = line.slice(op.end);
        var closeAt = fenceCloseAt(after, op.name);
        if (closeAt !== -1) {
          // Opened and closed on one line: "//R//", "//R 2x//", "//B text B//".
          var inner = after.slice(0, closeAt).trim();
          if (inner !== '') fence.lines.push(inner);
          blocks.push(fence);
          fence = null;
        } else if (!isBlank(after)) {
          fence.lines.push(after.replace(/^[ \t]/, ''));
        }
        continue;
      }

      if (isBlank(line)) {
        push();
      } else {
        if (!cur) cur = { marker: false, fenced: false, type: null, id: '', label: '', lines: [], srcStart: i, srcEnd: i };
        cur.lines.push(line);
        cur.srcEnd = i;
      }
    }
    push();
    if (fence) blocks.push(fence); // still being typed - render what's there

    // Dedent the body of a fenced section as a whole (the indent is a source
    // convention; the visual indent is done in CSS).
    blocks.forEach(function (b) {
      if (!b.fenced || !b.lines.length) return;
      var min = Infinity;
      for (var j = 0; j < b.lines.length; j++) {
        if (isBlank(b.lines[j])) continue;
        min = Math.min(min, leadingWs(b.lines[j]));
      }
      if (min === Infinity || min === 0) return;
      for (var k = 0; k < b.lines.length; k++) {
        b.lines[k] = b.lines[k].slice(min);
      }
    });

    return blocks;
  }

  function labelText(type, id) {
    var base = type === 'refren' ? 'R' : type === 'bridge' ? 'B' : 'S';
    return base + id + ':';
  }

  // Repetice: the source writes "//:" / "://" (two characters no one types
  // by accident in lyrics), the reader sees the usual sheet-music brackets.
  // Applied at render time on the final body, so it works inside a section
  // fence, inside a plain verse, and inside a repeat filled in from its
  // definition alike. Line-anchored, so a stray "//" mid-line is left alone.
  var REPEAT_OPEN_HTML = '<span class="repeat-mark">|:</span>';
  var REPEAT_CLOSE_HTML = '<span class="repeat-mark">:|</span>';

  function renderRepeatMarks(html) {
    if (html.indexOf('//') === -1) return html;
    return html.split('\n').map(function (line) {
      return line
        .replace(/^([ \t]*)\/\/:/, '$1' + REPEAT_OPEN_HTML)
        .replace(/:\/\/([ \t]*)$/, REPEAT_CLOSE_HTML + '$1');
    }).join('\n');
  }

  // === One block per line (the song page: transform(html, { lines: true })) ===

  // Splits rendered HTML at its newlines, but only at newlines between
  // elements: a newline inside a tag or inside a span's text would leave a
  // span cut in two, so then it gives up (null) and the text stays one block.
  function splitLines(html) {
    var out = [];
    var start = 0;
    var depth = 0;
    for (var i = 0; i < html.length; i++) {
      var c = html.charAt(i);
      if (c === '<') {
        var end = html.indexOf('>', i);
        if (end === -1) return null;
        var tag = html.slice(i, end + 1);
        if (/^<\//.test(tag)) depth--;
        else if (!/\/>$/.test(tag) && !/^<(br|hr|img|wbr)\b/i.test(tag)) depth++;
        if (tag.indexOf('\n') !== -1) return null;
        i = end;
      } else if (c === '\n') {
        if (depth !== 0) return null;
        out.push(html.slice(start, i));
        start = i + 1;
      }
    }
    out.push(html.slice(start));
    return out;
  }

  // A tablature line: long, and mostly dashes ("E |--0--2--|").
  function isTabLine(text) {
    return text.length >= 12 && (text.match(/-/g) || []).length / text.length > 0.5;
  }

  // A chord belongs to the word after it: the space between them must not be
  // where the line wraps, or the chord hangs at the end of the line above. A
  // run of chords with no word between them ("G D Emi C") stays breakable.
  var NBSP = String.fromCharCode(0xa0);
  var CHORD_THEN_WORD_RE = /(<span\b[^>]*\bdata-chord="[^"]*"[^>]*>[^<]*<\/span>) (?=[^\s<])/g;

  function glueChords(line) {
    return line.replace(CHORD_THEN_WORD_RE, '$1' + NBSP);
  }

  // Each line its own <span class="ln">; consecutive tablature lines go into
  // one <span class="tabs"> that scrolls sideways as a whole, so the six
  // strings stay under each other.
  function renderLines(html) {
    if (html === '') return '';
    var lines = splitLines(html);
    if (!lines) return html;
    // A closing newline draws no empty line in pre-wrap; keep it that way.
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    var out = '';
    var inTabs = false;
    lines.forEach(function (line) {
      var tab = isTabLine(stripTags(line));
      if (tab && !inTabs) { out += '<span class="tabs">'; inTabs = true; }
      if (!tab && inTabs) { out += '</span>'; inTabs = false; }
      out += tab ? '<span class="ln tab">' + line + '</span>' : '<span class="ln">' + glueChords(line) + '</span>';
    });
    if (inTabs) out += '</span>';
    return out;
  }

  function hasRepeatMarks(html) {
    var lines = normalizeBreaks(html).split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (REPEAT_OPEN_RE.test(lines[i]) || REPEAT_CLOSE_RE.test(lines[i])) return true;
    }
    return false;
  }

  // The changed ending of a repeat, if it declares one: the "..." line and
  // everything after it. Returns null when the body doesn't start with the
  // marker. Tested against the tag-stripped text so a chord span later on the
  // line can't interfere; the marker itself is plain text at the line start.
  function matchTail(lines) {
    var i = 0;
    while (i < lines.length && isBlank(lines[i])) i++;
    if (i >= lines.length) return null;
    if (!TAIL_RE.test(stripTags(lines[i]))) return null;

    // "... a víc už nechci nic." on one line is the compact form; a bare
    // "..." puts the new ending on the lines below.
    var rest = lines[i].replace(TAIL_RE, '');
    var out = isBlank(rest) ? [] : [rest];
    return out.concat(lines.slice(i + 1)).filter(function (l, n, all) {
      return !(isBlank(l) && n === all.length - 1);
    });
  }

  // Definition body with its last lines swapped for the new ending - as many
  // as were written, so a two-line ending replaces the last two lines.
  function applyTail(defBodyHtml, tailLines) {
    var lines = defBodyHtml.split('\n');
    while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
    var tail = tailLines.slice();
    while (tail.length && isBlank(tail[tail.length - 1])) tail.pop();
    if (!tail.length) return defBodyHtml;
    var keep = Math.max(0, lines.length - tail.length);
    return lines.slice(0, keep).concat(tail).join('\n');
  }

  // identity -> index of the block that defines it: the FIRST one with a real
  // body (not empty, not just "2x", not merely a changed ending). A bare "R:"
  // may appear before the chorus is ever written out, so this is its own pass.
  function definitions(blocks) {
    var defIdx = {};
    blocks.forEach(function (b, i) {
      if (!b.marker) return;
      var key = b.type + '|' + b.id;
      if (defIdx[key] != null) return;
      var plain = plainText(b.lines.join('\n'));
      if (plain === '' || MULT_RE.test(plain) || matchTail(b.lines)) return;
      defIdx[key] = i;
    });
    return defIdx;
  }

  function transform(html, opts) {
    var blocks = parseBlocks(html);
    var byLine = !!(opts && opts.lines);
    var render = function (s) {
      var marked = renderRepeatMarks(s);
      return byLine ? renderLines(marked) : marked;
    };

    // Pass 1: find each identity's definition and remember its body.
    var defIdx = definitions(blocks);
    var defBody = {};  // identity -> body html of the definition
    var defNorm = {};  // identity -> comparable fingerprint of the definition
    Object.keys(defIdx).forEach(function (key) {
      var body = blocks[defIdx[key]].lines.join('\n');
      defBody[key] = body;
      defNorm[key] = compareText(body);
    });

    // Pass 2: classify and render.
    var out = '';
    blocks.forEach(function (b, i) {
      if (!b.marker) {
        out += '<div class="song-section section-plain">' + render(b.lines.join('\n')) + '</div>';
        return;
      }

      var key = b.type + '|' + b.id;
      var body = b.lines.join('\n');
      var plain = plainText(body);
      var isDef = defIdx[key] === i;
      var isRepeat = false;
      var note = '';
      var tail = '';   // changed ending, shown next to the collapsed pill

      // An empty section with no definition anywhere in the song isn't a
      // repeat of anything - it's a standalone heading the author wrote to
      // mark a passage ("//VYBRNKÁVÁNÍ//"). Rendering it as a collapsed
      // repeat pill would promise content that doesn't exist.
      var hasDef = defIdx[key] != null;

      if (!isDef) {
        var tailLines = matchTail(b.lines);
        if (tailLines && hasDef) {
          // "The chorus, only it ends like this." Collapses like any other
          // repeat, but the changed ending stays on screen while it's
          // collapsed - that's the whole reason for writing it this way
          // instead of spelling the chorus out again.
          isRepeat = true;
          tail = tailLines.join('\n');
          body = applyTail(defBody[key], tailLines);
        } else if (plain === '') {
          isRepeat = hasDef;
          body = hasDef ? defBody[key] : '';
        } else if (MULT_RE.test(plain)) {
          isRepeat = true;
          note = plain;
          body = hasDef ? defBody[key] : '';
        } else if (hasDef && compareText(body) === defNorm[key]) {
          isRepeat = true; // written out in full, but identical -> collapsible
        }
        // else: variant chorus / chord run - keep it visible, no collapsing.
      }

      var cls = 'song-section section-' + b.type +
        (isRepeat ? ' is-repeat' : '') +
        (note ? ' has-note' : '') +
        (tail ? ' has-tail' : '') +
        (!isRepeat && plainText(body) === '' ? ' is-heading' : '');
      out += '<div class="' + cls + '" data-section="' + esc(key) + '">' +
        '<span class="section-head">' +
        '<span class="section-label">' + esc(b.label || labelText(b.type, b.id)) + '</span>' +
        (note ? '<span class="section-note">' + esc(note) + '</span>' : '') +
        '</span>' +
        (tail ? '<span class="section-tail">' + render(tail) + '</span>' : '') +
        '<span class="section-body">' + render(body) + '</span>' +
        '</div>';
    });

    return out;
  }

  // True if the song uses anything this module renders - section fences or
  // repeat brackets - so callers can leave a genuinely plain song's <pre>
  // untouched.
  function hasSections(html) {
    return parseBlocks(html).some(function (b) { return b.marker; }) || hasRepeatMarks(html);
  }

  // === Chord progression (grouped, per section) ===
  //
  // deriveProgression(html) walks the same parseBlocks() blocks used above
  // and reduces each block's chords (in play order) to a short list of
  // "groups" - runs of chords that read as one phrase - then merges those
  // groups across the whole song. It backs the top chord bar (grouped chips
  // with a separator between groups) and the songs.json "progression" field
  // (admin-editable; falls back to this deriver when left blank).
  //
  // Example (1. Signální): the verse "G C Emi" (sung twice, so it collapses
  // to one group) + the chorus "Ami C G D" + its closing couplet "F B Dmi"
  // (also sung twice, collapsing to one group) -> stored/rendered as
  // "G C Emi | Ami C G D | F B Dmi".

  // Ordered chord names found across a block's lines. A fresh regex per
  // line avoids lastIndex leaking between lines (the same literal, reused
  // across iterations of a loop, keeps its lastIndex from the previous line).
  function blockChordSeq(lines) {
    var chords = [];
    for (var i = 0; i < lines.length; i++) {
      var re = /data-chord="([^"]+)"/g;
      var m;
      while ((m = re.exec(lines[i])) !== null) chords.push(m[1]);
    }
    return chords;
  }

  // Collapses one block's ordered chord sequence into groups:
  //   a) collapse adjacent identical chords ("A A B" -> "A B"),
  //   b) scan left to right; at each position look for the SHORTEST phrase
  //      (length 2 .. floor((n-i)/2)) that immediately repeats itself. When
  //      found, close whatever's accumulated so far into its own group, emit
  //      the phrase as a group of its own, and consume every contiguous
  //      repeat of it. Shortest-first matters: "A B A B A B A B" collapses
  //      to a single ["A","B"] group, not ["A","B","A","B"] - a length-4
  //      phrase also "repeats" there, but the length-2 one is found first
  //      and consumes the whole run.
  function collapseSection(seq) {
    var s = [];
    for (var i = 0; i < seq.length; i++) {
      if (i === 0 || seq[i] !== seq[i - 1]) s.push(seq[i]);
    }

    function samePhrase(a, b, plen) {
      for (var k = 0; k < plen; k++) {
        if (s[a + k] !== s[b + k]) return false;
      }
      return true;
    }

    var n = s.length;
    var groups = [];
    var acc = [];
    var pos = 0;
    while (pos < n) {
      var maxPlen = Math.floor((n - pos) / 2);
      var matchedPlen = 0;
      for (var plen = 2; plen <= maxPlen; plen++) {
        if (samePhrase(pos, pos + plen, plen)) { matchedPlen = plen; break; }
      }
      if (matchedPlen) {
        var reps = 2;
        while (pos + reps * matchedPlen + matchedPlen <= n &&
               samePhrase(pos, pos + reps * matchedPlen, matchedPlen)) {
          reps++;
        }
        if (acc.length) { groups.push(acc); acc = []; }
        groups.push(s.slice(pos, pos + matchedPlen));
        pos += reps * matchedPlen;
      } else {
        acc.push(s[pos]);
        pos++;
      }
    }
    if (acc.length) groups.push(acc);
    return groups;
  }

  function deriveProgression(html) {
    var blocks = parseBlocks(html);

    var allGroups = [];
    blocks.forEach(function (b) {
      allGroups = allGroups.concat(collapseSection(blockChordSeq(b.lines)));
    });

    // Global dedup: an identical group (same chords, same order) is only
    // ever emitted once, at its first occurrence.
    var seen = {};
    var deduped = [];
    allGroups.forEach(function (g) {
      var key = g.join('\x00');
      if (seen[key]) return;
      seen[key] = true;
      deduped.push(g);
    });

    // Prune fragments: drop a group that is fully contained, as a
    // contiguous run, inside a group already kept (e.g. a leftover lone
    // "Ami" after an earlier "C Ami" group). Conservative - only ever drops
    // a group whose chords are all already visible elsewhere, in the same
    // order.
    function isContiguousIn(small, big) {
      if (small.length === 0 || small.length > big.length) return false;
      for (var start = 0; start + small.length <= big.length; start++) {
        var ok = true;
        for (var k = 0; k < small.length; k++) {
          if (big[start + k] !== small[k]) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    }

    var kept = [];
    deduped.forEach(function (g) {
      var isFragment = kept.some(function (big) { return isContiguousIn(g, big); });
      if (!isFragment) kept.push(g);
    });

    return kept;
  }

  // "G C Emi | Ami C G D | F B Dmi"
  function progressionToText(prog) {
    if (!prog || !prog.length) return '';
    return prog.map(function (g) { return g.join(' '); }).join(' | ');
  }

  // Groups split ONLY on "|" (never "/" - that's a slash-chord character,
  // e.g. "C/G"); tokens within a group split on whitespace. Empty groups
  // (blank between two "|", or a leading/trailing "|") are dropped.
  function parseProgressionText(text) {
    if (!text) return [];
    var out = [];
    String(text).split('|').forEach(function (part) {
      var tokens = part.trim().split(/\s+/).filter(function (t) { return t !== ''; });
      if (tokens.length) out.push(tokens);
    });
    return out;
  }

  var api = {
    transform: transform,
    hasSections: hasSections,
    hasRepeatMarks: hasRepeatMarks,
    parseBlocks: parseBlocks,
    definitions: definitions,
    matchTail: matchTail,
    normalizeBreaks: normalizeBreaks,
    deriveProgression: deriveProgression,
    progressionToText: progressionToText,
    parseProgressionText: parseProgressionText,
    REPEAT_NAME: REPEAT_NAME,
    _fenceIdentity: fenceIdentity,
    _renderLines: renderLines,
    _isTabLine: isTabLine,
    _fenceCloseAt: fenceCloseAt,
    _compareText: compareText,
    _isMultiplier: function (s) { return MULT_RE.test(s); },
    _collapseSection: collapseSection
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof global !== 'undefined') global.SongSections = api;
})(typeof self !== 'undefined' ? self : this);
