/**
 * chord-theory.js - Czech-notation chord names: parsing, checking and
 * transposition.
 *
 * The one place that knows what a chord name is. player.js (song pages),
 * song-cleanup.js (editor), chords.js (fingerings), chord-sheet.js (pasting)
 * and song-list-core.js (the chord picker) all read names through parse()
 * here - they used to carry four parsers and four note tables of their own,
 * and those drifted apart (player.js's copy once missed slash chords; the
 * loose one still "transposed" Es to Fs and CEF to C#EF).
 *
 * Czech notation: H = international B, B = international Bb.
 *
 * Browser: window.ChordTheory. Node: module.exports (for tests).
 */
(function (global) {
  'use strict';

  // Note name -> pitch class, C = 0.
  var NOTE_MAP = {
    'C': 0, 'C#': 1, 'Db': 1,
    'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'Fb': 4,
    'F': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'B': 10, 'Bb': 10,
    'H': 11, 'Cb': 11
  };

  // How a pitch class is written, with sharps or with flats. Czech B (B flat)
  // is the one flat everybody writes, so it stays B in both.
  var SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
  var FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'B', 'H'];
  var NOTES = SHARP;

  // Where each spelling sits on the line of fifths (C = 0, G = 1, F = -1).
  var FIFTHS_SHARP = [0, 7, 2, 9, 4, -1, 6, 1, 8, 3, -2, 5];
  var FIFTHS_FLAT = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5];

  // The strict grammar: root, accidental, quality, extension, sus/add and
  // alterations, slash bass. Strict on purpose - chord-sheet.js tells a
  // chord line from a lyric line by every word parsing here, so "Ale" or
  // "Den" must not.
  var CHORD_RE = new RegExp(
    '^([A-H])(#|b)?' +
    '(maj|Maj|M|min|mi|moll|mol|m|dim|°|aug|\\+|-)?' +
    '(\\d{1,2})?' +
    '((?:sus\\d?|add\\d{1,2}|[b#]\\d{1,2})*)' +
    '(?:/([A-H])(#|b)?)?$'
  );

  // Suffixes the grammar doesn't know but the songbook writes on purpose
  // (Emi7+g, A7maj, E7/4, H7/4, D7+), on any root so they still are chords
  // once transposed. chords.js has a fingering for each.
  var ODD_SUFFIXES = ['mi7+g', '7maj', '7/4', '7+'];

  function wrap(n) { return ((n % 12) + 12) % 12; }

  // "Ami7/G" -> { root: 9, suffix: 'mi7', bass: 7 }; null when it doesn't
  // start with a note. A slash before something that isn't a note belongs to
  // the suffix ("E7/4").
  function parse(name) {
    var parts = String(name).trim().split('/').map(function (p) { return p.trim(); });
    var bass = null;
    if (parts.length > 1 && NOTE_MAP[parts[parts.length - 1]] !== undefined) bass = NOTE_MAP[parts.pop()];
    var m = /^([A-H])([#b]?)(.*)$/.exec(parts.join('/'));
    if (!m || NOTE_MAP[m[1] + m[2]] === undefined) return null;
    return { root: NOTE_MAP[m[1] + m[2]], suffix: m[3], bass: bass };
  }

  // Is this a chord name, as the songbook writes them?
  function isChord(name) {
    var s = String(name);
    if (CHORD_RE.test(s)) return true;
    var p = parse(s);
    return !!p && p.bass == null && ODD_SUFFIXES.indexOf(p.suffix) !== -1 && s === s.trim();
  }

  // Old shape, kept for callers that only need the root of one part.
  function parseChord(chord) {
    var m = /^([A-H])([#b]?)(.*)$/.exec(chord);
    if (!m || NOTE_MAP[m[1] + m[2]] === undefined) return null;
    return { noteIndex: NOTE_MAP[m[1] + m[2]], suffix: m[3] };
  }

  // Should these chords, moved by `semitones`, be written with flats? A song
  // is spelled one way throughout: whichever keeps its roots and basses
  // closer together on the line of fifths (B Eb F is a key, B D# F is not).
  function preferFlats(chords, semitones) {
    var lo = [Infinity, Infinity];
    var hi = [-Infinity, -Infinity];
    (chords || []).forEach(function (chord) {
      if (!isChord(chord)) return;
      var p = parse(chord);
      if (!p) return;
      [p.root, p.bass].forEach(function (pc) {
        if (pc == null) return;
        var n = wrap(pc + (semitones || 0));
        [FIFTHS_SHARP[n], FIFTHS_FLAT[n]].forEach(function (f, i) {
          lo[i] = Math.min(lo[i], f);
          hi[i] = Math.max(hi[i], f);
        });
      });
    });
    if (lo[0] === Infinity) return false;
    return (hi[1] - lo[1]) < (hi[0] - lo[0]);
  }

  // Moves a chord by `semitones`, slash bass included, and spells it with
  // flats or sharps (sharps unless told otherwise, which also makes
  // transposeChord(x, 0) a normalization - compareSources in chord-sheet.js
  // relies on that). A name that isn't a chord comes back as it was.
  function transposeChord(chord, semitones, flats) {
    if (!isChord(chord)) return chord;
    var p = parse(chord);
    if (!p) return chord;
    var names = flats ? FLAT : SHARP;
    var out = names[wrap(p.root + semitones)] + p.suffix;
    if (p.bass != null) out += '/' + names[wrap(p.bass + semitones)];
    return out;
  }

  var api = {
    NOTES: NOTES,
    SHARP: SHARP,
    FLAT: FLAT,
    NOTE_MAP: NOTE_MAP,
    CHORD_RE: CHORD_RE,
    ODD_SUFFIXES: ODD_SUFFIXES,
    parse: parse,
    isChord: isChord,
    parseChord: parseChord,
    preferFlats: preferFlats,
    transposeChord: transposeChord
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof global !== 'undefined') global.ChordTheory = api;
})(typeof self !== 'undefined' ? self : this);
