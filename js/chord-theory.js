/**
 * chord-theory.js - Czech-notation chord parsing and transposition.
 *
 * Single source of truth for the note math shared by player.js (song pages)
 * and song-cleanup.js (editor) - previously duplicated in both, which is how
 * they drifted out of sync (player.js's copy didn't handle slash chords).
 *
 * Czech notation: H = international B, B = international Bb.
 *
 * Browser: window.ChordTheory. Node: module.exports (for tests).
 */
(function (global) {
  'use strict';

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

  // Parse a single (non-slash) chord into root note index + suffix.
  function parseChord(chord) {
    var root = '';
    var i = 0;
    if (i < chord.length) { root += chord[i]; i++; }
    // Check for # or b
    if (i < chord.length && (chord[i] === '#' || chord[i] === 'b')) { root += chord[i]; i++; }
    var suffix = chord.slice(i);
    var noteIndex = NOTE_MAP[root];
    if (noteIndex === undefined) return null;
    return { noteIndex: noteIndex, suffix: suffix };
  }

  function transposeChordPart(chord, semitones) {
    var parsed = parseChord(chord);
    if (!parsed) return chord;
    var newIndex = (parsed.noteIndex + semitones) % 12;
    if (newIndex < 0) newIndex += 12;
    return NOTES[newIndex] + parsed.suffix;
  }

  // Slash chords (e.g. D/F#) transpose both the chord and the bass note.
  function transposeChord(chord, semitones) {
    return chord.split('/').map(function (part) {
      return transposeChordPart(part.trim(), semitones);
    }).join('/');
  }

  var api = {
    NOTES: NOTES,
    NOTE_MAP: NOTE_MAP,
    parseChord: parseChord,
    transposeChord: transposeChord
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof global !== 'undefined') global.ChordTheory = api;
})(typeof self !== 'undefined' ? self : this);
