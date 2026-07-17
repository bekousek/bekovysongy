/**
 * sections.js - Render song sections (refrén / sloka / bridge) from markers.
 *
 * Songs are authored as the inner HTML of <pre class="song-text">, where blocks
 * are separated by blank lines and a block may start with a section marker on
 * its first line:
 *
 *   R:  / R1: / R2: / Ref: / Ref.   -> refrén (chorus)   [indented]
 *   B:  / B1: / Bridge:             -> bridge             [indented]
 *   S:  / S1: / Sloka:              -> sloka (verse)      [labelled, baseline]
 *
 * An unmarked block is a plain verse (baseline, no label). Blocks that share a
 * marker identity (type + number) relate to the first block of that identity
 * that carries real text (the "definition"). A later block with the same
 * identity is a collapsible repeat only when it clearly is one:
 *
 *   - empty body ("R:" alone)                 -> repeat, expands to the definition
 *   - just a play count ("R: 2x", "R: (3x)")  -> repeat, the count stays visible
 *   - body text-identical to the definition   -> repeat, expands to its own body
 *
 * Anything else with a reused identity (variant chorus, chord run) is NOT a
 * repeat and stays visible - collapsing it would hide lyrics/chords that exist
 * nowhere else in the song.
 *
 * transform(innerHTML) -> innerHTML wrapped into <div class="song-section ...">.
 * Section markup: <span class="section-head"> holds the label (and the play
 * count as .section-note); the body follows in <span class="section-body">.
 * It is a pure string transform (chord <span>s are preserved verbatim) so it
 * works both on the live song page (player.js) and in the editor preview;
 * interactivity of collapsed repeats (pill click/peek) is added by the caller.
 *
 * parseBlocks() additionally reports srcStart/srcEnd - the block's line range
 * in normalizeBreaks(html).split('\n') - so the editor can rewrite a block in
 * the source (join it to / detach it from a section) without re-parsing HTML.
 *
 * Browser: window.SongSections. Node: module.exports (for tests).
 */
(function (global) {
  'use strict';

  // Marker at the very start of a line (longest tokens first so "Refren"/"Sloka"
  // win over "R"/"S"). Optional number, then ":" or ".".
  var MARKER_RE = /^[ \t]*(Refr[ée]n|Ref|R|Sloka|Slo|S|Bridge|Br|B)[ \t]*(\d*)[ \t]*[:.]/i;

  // A bare play-count annotation: "2x", "(2x)", "2×", "x3", "3X."
  var MULT_RE = /^\(?\s*(?:\d{1,2}\s*[x×]|[x×]\s*\d{1,2})\s*\)?\.?$/i;

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

  // Detect a marker on a line. Tested against the tag-stripped text so a chord
  // span inside the line doesn't interfere; markers are always plain text at
  // the line start.
  function matchMarker(line) {
    var plain = stripTags(line);
    var m = plain.match(MARKER_RE);
    if (!m) return null;
    var type = classifyType(m[1]);
    if (!type) return null;
    return { type: type, id: m[2] || '' };
  }

  // Remove the marker prefix from the raw HTML line (the marker is literal text
  // at the start, so the same regex matches the raw line). Also drop one space
  // that usually follows the colon.
  function stripMarkerPrefix(line) {
    return line.replace(MARKER_RE, '').replace(/^[ \t]/, '');
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

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  // { marker, type, id, lines, srcStart, srcEnd }.
  function parseBlocks(html) {
    var lines = normalizeBreaks(html).split('\n');
    var blocks = [];
    var cur = null;

    function push() {
      if (cur) { blocks.push(cur); cur = null; }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var mk = matchMarker(line);
      if (mk) {
        push();
        cur = { marker: true, type: mk.type, id: mk.id, lines: [stripMarkerPrefix(line)], srcStart: i, srcEnd: i };
      } else if (isBlank(line)) {
        push();
      } else {
        if (!cur) cur = { marker: false, type: null, id: '', lines: [], srcStart: i, srcEnd: i };
        cur.lines.push(line);
        cur.srcEnd = i;
      }
    }
    push();

    // Merge an indented unmarked block back into the preceding marker block:
    // songs separate the two halves of a long chorus with a blank line but
    // keep the continuation indented, so it belongs to the chorus, not a
    // verse. (This is also what the editor's "připojit k sekci" writes.)
    // The indent is only a join-marker - strip the continuation's own common
    // indent so it lines up with the rest of the section body.
    var merged = [];
    blocks.forEach(function (b) {
      var prev = merged[merged.length - 1];
      if (!b.marker && prev && prev.marker) {
        var firstNonBlank = null;
        var min = Infinity;
        for (var j = 0; j < b.lines.length; j++) {
          if (isBlank(b.lines[j])) continue;
          if (firstNonBlank == null) firstNonBlank = b.lines[j];
          min = Math.min(min, leadingWs(b.lines[j]));
        }
        if (firstNonBlank != null && leadingWs(firstNonBlank) > 0) {
          prev.lines.push('');
          prev.lines = prev.lines.concat(b.lines.map(function (l) {
            return isBlank(l) || min === 0 ? l : l.slice(min);
          }));
          prev.srcEnd = b.srcEnd;
          return;
        }
      }
      merged.push(b);
    });
    blocks = merged;

    // Dedent the body of marker blocks (the indent is a source convention;
    // the visual indent is done in CSS). The first line already had its
    // marker stripped, so dedent is computed from the remaining lines.
    blocks.forEach(function (b) {
      if (!b.marker || b.lines.length < 2) return;
      var min = Infinity;
      for (var j = 1; j < b.lines.length; j++) {
        if (isBlank(b.lines[j])) continue;
        min = Math.min(min, leadingWs(b.lines[j]));
      }
      if (min === Infinity || min === 0) return;
      for (var k = 1; k < b.lines.length; k++) {
        b.lines[k] = b.lines[k].slice(min);
      }
    });

    return blocks;
  }

  function labelText(type, id) {
    var base = type === 'refren' ? 'R' : type === 'bridge' ? 'B' : 'S';
    return base + id + ':';
  }

  function transform(html) {
    var blocks = parseBlocks(html);

    // Pass 1: find each identity's definition - the FIRST block with a real
    // body (not empty, not just "2x"). A bare "R:" may appear before the
    // chorus is ever written out; two passes make the fill work anyway.
    var defIdx = {};   // identity -> block index of the definition
    var defBody = {};  // identity -> body html of the definition
    var defNorm = {};  // identity -> comparable fingerprint of the definition
    blocks.forEach(function (b, i) {
      if (!b.marker) return;
      var key = b.type + '|' + b.id;
      if (defIdx[key] != null) return;
      var body = b.lines.join('\n');
      var plain = plainText(body);
      if (plain === '' || MULT_RE.test(plain)) return;
      defIdx[key] = i;
      defBody[key] = body;
      defNorm[key] = compareText(body);
    });

    // Pass 2: classify and render.
    var out = '';
    blocks.forEach(function (b, i) {
      if (!b.marker) {
        out += '<div class="song-section section-plain">' + b.lines.join('\n') + '</div>';
        return;
      }

      var key = b.type + '|' + b.id;
      var body = b.lines.join('\n');
      var plain = plainText(body);
      var isDef = defIdx[key] === i;
      var isRepeat = false;
      var note = '';

      if (!isDef) {
        if (plain === '') {
          isRepeat = true;
          body = defBody[key] != null ? defBody[key] : '';
        } else if (MULT_RE.test(plain)) {
          isRepeat = true;
          note = plain;
          body = defBody[key] != null ? defBody[key] : '';
        } else if (defIdx[key] != null && compareText(body) === defNorm[key]) {
          isRepeat = true; // written out in full, but identical -> collapsible
        }
        // else: variant chorus / chord run - keep it visible, no collapsing.
      }

      var cls = 'song-section section-' + b.type +
        (isRepeat ? ' is-repeat' : '') +
        (note ? ' has-note' : '');
      out += '<div class="' + cls + '" data-section="' + escAttr(key) + '">' +
        '<span class="section-head">' +
        '<span class="section-label">' + labelText(b.type, b.id) + '</span>' +
        (note ? '<span class="section-note">' + escHtml(note) + '</span>' : '') +
        '</span>' +
        '<span class="section-body">' + body + '</span>' +
        '</div>';
    });

    return out;
  }

  // True if the song actually uses any section markers (so callers can skip the
  // toggle UI for plain songs).
  function hasSections(html) {
    return parseBlocks(html).some(function (b) { return b.marker; });
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
    parseBlocks: parseBlocks,
    normalizeBreaks: normalizeBreaks,
    deriveProgression: deriveProgression,
    progressionToText: progressionToText,
    parseProgressionText: parseProgressionText,
    _matchMarker: matchMarker,
    _compareText: compareText,
    _isMultiplier: function (s) { return MULT_RE.test(s); },
    _collapseSection: collapseSection
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof global !== 'undefined') global.SongSections = api;
})(typeof self !== 'undefined' ? self : this);
