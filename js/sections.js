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
 * marker identity (type + number) are treated as repeats of each other: the
 * first is the "definition", the rest are repeats. A marker line with no body
 * (e.g. a lone "R:") is a repeat reference and is filled from the first
 * occurrence so it can be shown when repeats are expanded.
 *
 * transform(innerHTML) -> innerHTML wrapped into <div class="song-section ...">.
 * It is a pure string transform (chord <span>s are preserved verbatim) so it
 * works both on the live song page (player.js) and in the editor preview.
 *
 * Browser: window.SongSections. Node: module.exports (for tests).
 */
(function (global) {
  'use strict';

  // Marker at the very start of a line (longest tokens first so "Refren"/"Sloka"
  // win over "R"/"S"). Optional number, then ":" or ".".
  var MARKER_RE = /^[ \t]*(Refr[ée]n|Ref|R|Sloka|Slo|S|Bridge|Br|B)[ \t]*(\d*)[ \t]*[:.]/i;

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
      .replace(/[\xa0  ]/g, ' ')
      .replace(/\r\n?/g, '\n');
  }

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // Split the song into ordered blocks. A block is { marker, type, id, lines }.
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
        cur = { marker: true, type: mk.type, id: mk.id, lines: [stripMarkerPrefix(line)] };
      } else if (isBlank(line)) {
        push();
      } else {
        if (!cur) cur = { marker: false, type: null, id: '', lines: [] };
        cur.lines.push(line);
      }
    }
    push();

    // Merge an indented unmarked block back into the preceding marker block:
    // old songs separate the two halves of a long chorus with a blank line, but
    // keep the continuation indented, so it belongs to the chorus, not a verse.
    var merged = [];
    blocks.forEach(function (b) {
      var prev = merged[merged.length - 1];
      if (!b.marker && prev && prev.marker) {
        var firstNonBlank = null;
        for (var j = 0; j < b.lines.length; j++) {
          if (!isBlank(b.lines[j])) { firstNonBlank = b.lines[j]; break; }
        }
        if (firstNonBlank != null && leadingWs(firstNonBlank) > 0) {
          prev.lines.push('');
          prev.lines = prev.lines.concat(b.lines);
          return;
        }
      }
      merged.push(b);
    });
    blocks = merged;

    // Dedent the body of marker blocks (old songs indent the body with spaces;
    // the visual indent is now done in CSS). The first line already had its
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
    var seen = {};        // identity -> true
    var firstBody = {};   // identity -> body html of first occurrence
    var out = '';

    blocks.forEach(function (b) {
      if (!b.marker) {
        out += '<div class="song-section section-plain">' + b.lines.join('\n') + '</div>';
        return;
      }

      var key = b.type + '|' + b.id;
      var body = b.lines.join('\n');
      var isRepeat = !!seen[key];

      if (!isRepeat) {
        seen[key] = true;
        if (body.trim() !== '') firstBody[key] = body;
      } else if (body.trim() === '' && firstBody[key] != null) {
        // Empty repeat reference -> reuse the chorus text so it can be revealed.
        body = firstBody[key];
      }

      var cls = 'song-section section-' + b.type + (isRepeat ? ' is-repeat' : '');
      out += '<div class="' + cls + '" data-section="' + escAttr(key) + '">' +
        '<span class="section-label">' + labelText(b.type, b.id) + '</span>' +
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

  var api = {
    transform: transform,
    hasSections: hasSections,
    parseBlocks: parseBlocks,
    _matchMarker: matchMarker
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof global !== 'undefined') global.SongSections = api;
})(typeof self !== 'undefined' ? self : this);
