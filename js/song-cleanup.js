/**
 * song-cleanup.js - Pure (DOM-free) helpers for tidying song <pre> content.
 *
 * The editor's contenteditable produces messy HTML: chord spans with extra
 * attributes (contenteditable), stray spaces inside chord spans, junk inline
 * formatting (<font>/<b>/styled spans), and mixed <br>/<div> line breaks.
 *
 * Each public function takes the inner HTML of the song <pre> and returns
 * cleaned inner HTML. Internally we parse to a model { text, chords } where
 * every chord span becomes a single MARKER char (chords are atomic and always
 * rebuilt cleanly from their data-chord value), then re-render. This also
 * strips junk markup and normalizes chord spans as a side effect.
 *
 * Works in the browser (window.SongCleanup) and in Node (module.exports) so
 * the logic can be unit-tested without a DOM.
 */
(function (global) {
  'use strict';

  // Private-use char used as an atomic placeholder for a chord. Never appears
  // in real song text. Declared via escape so the source stays pure ASCII.
  var MARKER = '';
  var NBSP = ' ';

  // === Czech notation: H = international B, B = international Bb ===
  var NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
  var NOTE_MAP = {
    'C': 0, 'C#': 1, 'Db': 1,
    'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'Fb': 4,
    'F': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'B': 10, 'Bb': 10,
    'H': 11, 'Cb': 11
  };

  function parseChord(chord) {
    var root = '';
    var i = 0;
    if (i < chord.length) { root += chord[i]; i++; }
    if (i < chord.length && (chord[i] === '#' || chord[i] === 'b')) { root += chord[i]; i++; }
    var suffix = chord.slice(i);
    var noteIndex = NOTE_MAP[root];
    if (noteIndex === undefined) return null;
    return { noteIndex: noteIndex, suffix: suffix };
  }

  function transposeChord(chord, semitones) {
    var parsed = parseChord(chord);
    if (!parsed) return chord;
    var newIndex = (parsed.noteIndex + semitones) % 12;
    if (newIndex < 0) newIndex += 12;
    return NOTES[newIndex] + parsed.suffix;
  }

  // Handle slash chords (e.g. D/F# -> bass note transposed too)
  function transposeChordFull(chord, semitones) {
    return chord.split('/').map(function (part) {
      return transposeChord(part.trim(), semitones);
    }).join('/');
  }

  // === HTML entity helpers ===
  function decodeEntities(s) {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&'); // decode &amp; last
  }

  function escText(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return escText(s).replace(/"/g, '&quot;');
  }

  function chordSpan(name) {
    return '<span class="chord" data-chord="' + escAttr(name) + '">' + escText(name) + '</span>';
  }

  // === Parse inner HTML -> { text, chords } ===
  // text: plain text with '\n' line breaks and a MARKER char per chord
  // chords: chord names (from data-chord) in document order
  function parse(html) {
    var chords = [];

    // 1) Chord spans -> MARKER (use the clean data-chord value)
    var s = html.replace(/<span\b[^>]*\bclass="chord"[^>]*>[\s\S]*?<\/span>/gi, function (tag) {
      var dm = tag.match(/data-chord="([^"]*)"/i);
      var name = dm ? dm[1] : tag.replace(/<[^>]*>/g, '');
      chords.push(decodeEntities(name).trim());
      return MARKER;
    });

    // 2) Line breaks: <br> and block boundaries -> \n
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(div|p)\s*>/gi, '');
    s = s.replace(/<(div|p)\b[^>]*>/gi, '\n');

    // 3) Strip any remaining tags (font, b, i, styled spans, ...)
    s = s.replace(/<[^>]+>/g, '');

    // 4) Decode entities, normalize whitespace chars and newlines
    s = decodeEntities(s);
    s = s.split(NBSP).join(' ');     // nbsp char -> normal space
    s = s.replace(/\r\n?/g, '\n');

    return { text: s, chords: chords };
  }

  // === Render model -> inner HTML ===
  function render(model) {
    var parts = model.text.split(MARKER);
    var html = '';
    for (var i = 0; i < parts.length; i++) {
      html += escText(parts[i]);
      if (i < parts.length - 1) html += chordSpan(model.chords[i]);
    }
    return html;
  }

  // === Public: normalize spacing between a chord and adjacent text ===
  // Exactly one space between a chord and neighbouring text. Leading
  // indentation is preserved, no space is forced before a line-leading chord,
  // and chord-to-chord gaps and other in-text spacing are left untouched.
  // (Only spaces directly adjacent to a chord MARKER are touched.)
  var RE_BEFORE = new RegExp('([^\\s' + MARKER + ']) *' + MARKER, 'g'); // text  spaces chord
  var RE_AFTER = new RegExp(MARKER + ' *([^\\s' + MARKER + '])', 'g');  // chord spaces text

  function normLine(line) {
    var m = line.match(/^([ \t]*)([\s\S]*)$/);
    var indent = m[1];
    var body = m[2];
    body = body.replace(RE_BEFORE, '$1 ' + MARKER);
    body = body.replace(RE_AFTER, MARKER + ' $1');
    return indent + body;
  }

  function normalizeChordSpacing(html) {
    var model = parse(html);
    model.text = model.text.split('\n').map(normLine).join('\n');
    return render(model);
  }

  // === Public: remove empty lines (no chord and only whitespace) ===
  function removeEmptyLines(html) {
    var model = parse(html);
    model.text = model.text.split('\n').filter(function (line) {
      return line.indexOf(MARKER) !== -1 || line.trim() !== '';
    }).join('\n');
    return render(model);
  }

  // === Public: permanently transpose all chords by N semitones ===
  function transposeSong(html, semitones) {
    var model = parse(html);
    model.chords = model.chords.map(function (c) {
      return transposeChordFull(c, semitones);
    });
    return render(model);
  }

  var api = {
    normalizeChordSpacing: normalizeChordSpacing,
    removeEmptyLines: removeEmptyLines,
    transposeSong: transposeSong,
    // exposed for tests
    _parse: parse,
    _render: render,
    _transposeChordFull: transposeChordFull
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SongCleanup = api;
})(typeof self !== 'undefined' ? self : this);
