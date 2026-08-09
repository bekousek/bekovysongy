/**
 * song-edit.js - The editing model behind the admin editor's text area.
 *
 * The song body is edited as ONE FLAT STRING in which every chord is a single
 * character (SongCleanup's MARKER) and every line break is a real "\n".
 * Positions are integer offsets into that string, so a chord is atomic by
 * construction: there is no position inside one, a selection cannot end
 * halfway through one, and one keypress removes exactly one unit - a letter
 * or a whole chord.
 *
 * That is the whole point of the model. Left to itself the browser edits the
 * DOM, where a chord is a contenteditable="false" <span> between text nodes,
 * and its idea of what a Backspace means there is wrong in ways nobody can
 * predict. Measured in Chrome on this very editor:
 *
 *   - forward-deleting the newline at the end of a line whose next line
 *     starts with a chord deletes the newline AND the chord;
 *   - a selection whose two ends fall inside chord spans deletes nothing at
 *     all, however many times you press Delete or Backspace;
 *   - deleting an explicitly selected "\n" can remove the character before
 *     it instead.
 *
 * None of those can happen to a string. editor.js therefore intercepts every
 * mutating `beforeinput`, runs it through here, and writes the result back.
 *
 * Everything in this file is pure string/array work (no DOM), which is what
 * makes it testable - see test/song-edit.test.js. editor.js owns the two
 * impure halves: reading the caret out of the DOM as an offset, and putting
 * the rendered model back.
 *
 * A model is SongCleanup's: { text: string, chords: string[] }, where the Nth
 * MARKER in `text` is named by chords[N]. parse()/render() are that module's,
 * re-exported here so callers only need one import.
 *
 * Browser: window.SongEdit. Node: module.exports (for tests).
 */
(function (global) {
  'use strict';

  var SongCleanup = (typeof require !== 'undefined')
    ? require('./song-cleanup.js')
    : global.SongCleanup;

  // Same private-use placeholder song-cleanup.js parses to. Built from its
  // char code so this file stays pure ASCII (a literal has a habit of
  // arriving as the raw character, or worse, as nothing at all).
  var MARKER = String.fromCharCode(0xe000);

  function parse(html) {
    return SongCleanup._parse(html);
  }

  function render(model) {
    return SongCleanup._render(model);
  }

  function countMarkers(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === MARKER) n++;
    }
    return n;
  }

  // === The one primitive ===
  // Replace text[from..to) with `text` (which may itself contain MARKERs, one
  // per name in `chords`). Everything else in this file is built from it, so
  // there is exactly one place where the text and the chord list can fall out
  // of step - and it keeps them in step.
  function splice(model, from, to, text, chords) {
    var lo = Math.max(0, Math.min(from, to));
    var hi = Math.min(model.text.length, Math.max(from, to));
    var head = model.text.slice(0, lo);
    var body = model.text.slice(lo, hi);
    var tail = model.text.slice(hi);
    var ins = text || '';
    var names = chords || [];
    var kept = countMarkers(head);
    return {
      text: head + ins + tail,
      chords: model.chords.slice(0, kept)
        .concat(names)
        .concat(model.chords.slice(kept + countMarkers(body)))
    };
  }

  // === Movement: what "one unit" means in each direction ===
  // A chord is one unit because it is one character. Astral characters (an
  // emoji in a title someone pasted) are one unit because deleting half a
  // surrogate pair produces a replacement glyph nobody asked for.
  function stepBack(text, i) {
    if (i <= 1) return 0;
    var lo = text.charCodeAt(i - 1);
    if (lo >= 0xdc00 && lo <= 0xdfff) {
      var hi = text.charCodeAt(i - 2);
      if (hi >= 0xd800 && hi <= 0xdbff) return i - 2;
    }
    return i - 1;
  }

  function stepForward(text, i) {
    if (i >= text.length - 1) return text.length;
    var hi = text.charCodeAt(i);
    if (hi >= 0xd800 && hi <= 0xdbff) {
      var lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) return i + 2;
    }
    return i + 1;
  }

  function isSpace(ch) {
    return ch === ' ' || ch === '\t';
  }

  function isWordBreak(ch) {
    return isSpace(ch) || ch === '\n' || ch === MARKER;
  }

  // Ctrl+Backspace. A line break is a unit of its own (so the word jump never
  // silently swallows the end of the previous line), and so is a chord.
  function wordBack(text, i) {
    var j = Math.max(0, Math.min(i, text.length));
    if (j === 0) return 0;
    if (text.charAt(j - 1) === '\n') return j - 1;
    while (j > 0 && isSpace(text.charAt(j - 1))) j--;
    if (j > 0 && text.charAt(j - 1) === MARKER) return j - 1;
    while (j > 0 && !isWordBreak(text.charAt(j - 1))) j--;
    return j;
  }

  function wordForward(text, i) {
    var j = Math.max(0, Math.min(i, text.length));
    var n = text.length;
    if (j === n) return n;
    if (text.charAt(j) === '\n') return j + 1;
    while (j < n && isSpace(text.charAt(j))) j++;
    if (j < n && text.charAt(j) === MARKER) return j + 1;
    while (j < n && !isWordBreak(text.charAt(j))) j++;
    return j;
  }

  // Start of the line the offset sits on; when it is already there, the line
  // break itself (which is what "delete to start of line" has to mean at
  // column 0 if it is to do anything at all).
  function lineBack(text, i) {
    var j = Math.max(0, Math.min(i, text.length));
    if (j === 0) return 0;
    if (text.charAt(j - 1) === '\n') return j - 1;
    var at = text.lastIndexOf('\n', j - 1);
    return at === -1 ? 0 : at + 1;
  }

  function lineForward(text, i) {
    var j = Math.max(0, Math.min(i, text.length));
    if (j >= text.length) return text.length;
    if (text.charAt(j) === '\n') return j + 1;
    var at = text.indexOf('\n', j);
    return at === -1 ? text.length : at;
  }

  // === Edits ===
  // Each returns { model, from, to } - the new model and where the caret (or
  // selection) belongs afterwards, so the caller never has to work it out.

  function replace(model, from, to, text) {
    return {
      model: splice(model, from, to, text || '', []),
      from: Math.min(from, to) + (text || '').length,
      to: Math.min(from, to) + (text || '').length
    };
  }

  function remove(model, from, to) {
    return replace(model, from, to, '');
  }

  // A chord always lands with a space on each side: right after a word it
  // would otherwise glue itself onto it, and after another chord the two
  // would read as one name.
  function insertChord(model, from, to, name) {
    var lo = Math.min(from, to);
    var before = lo > 0 ? model.text.charAt(lo - 1) : '';
    var lead = (before === '' || before === ' ' || before === '\n') ? '' : ' ';
    var ins = lead + MARKER + ' ';
    return {
      model: splice(model, lo, Math.max(from, to), ins, [name]),
      from: lo + ins.length,
      to: lo + ins.length
    };
  }

  function atLineStart(text, i) {
    return i <= 0 || text.charAt(i - 1) === '\n';
  }

  // "//NAME" ... "NAME//" around [from, to), or an empty pair with the caret
  // parked between the markers. A repeat ("//:" ... "://") is the same thing
  // inline, on one line, so one function covers both buttons.
  //
  // Working on the string is what fixes the reported "the chord highlight
  // swallows the whole chorus": wrapping used to extract and re-insert a DOM
  // range, and a range that starts inside the chorus's leading chord span put
  // everything back INSIDE that span.
  function wrapFence(model, from, to, name, inline) {
    var lo = Math.min(from, to);
    var hi = Math.max(from, to);
    var sep = inline ? ' ' : '\n';
    var head = (inline || atLineStart(model.text, lo) ? '' : '\n') + '//' + name + sep;
    var tail = sep + name + '//';
    var withTail = splice(model, hi, hi, tail, []);
    var withBoth = splice(withTail, lo, lo, head, []);
    // Empty pair: the caret goes where the text is about to be typed.
    // Around a selection: after the closing marker, as before.
    var caret = lo === hi ? lo + head.length : hi + head.length + tail.length;
    return { model: withBoth, from: caret, to: caret };
  }

  var api = {
    MARKER: MARKER,
    parse: parse,
    render: render,
    splice: splice,
    countMarkers: countMarkers,
    stepBack: stepBack,
    stepForward: stepForward,
    wordBack: wordBack,
    wordForward: wordForward,
    lineBack: lineBack,
    lineForward: lineForward,
    atLineStart: atLineStart,
    replace: replace,
    remove: remove,
    insertChord: insertChord,
    wrapFence: wrapFence
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof global !== 'undefined') global.SongEdit = api;
})(typeof self !== 'undefined' ? self : this);
