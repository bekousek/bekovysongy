/**
 * chord-sheet.js - Pasting a song copied from a chord website.
 *
 * Chord sites print a song as pairs of lines: the chords on one line, spaced
 * out so each one sits above the syllable it belongs to, and the words on the
 * line underneath. Pasted into the editor as-is that is two lines of plain
 * text and not a single chord. convert() turns it into the editor's model
 * instead ({ text, chords }, one SongEdit MARKER per chord - see
 * song-edit.js), laid out the way a finished song in this songbook is:
 *
 *   - a chord stands BETWEEN words, never inside one, so a chord that sat
 *     above the middle of a word moves to that word's start (the
 *     "zkontrolováno" songs: 0 of 275 chords are inside a word);
 *   - chord names are in Czech notation: Ami, H, and B for B flat;
 *   - a labelled chorus becomes a fenced //R ... R// section and a word-for-
 *     word repeat of it //R R//; verse labels and verse numbers go away;
 *   - at most one blank line between parts.
 *
 * ChordPro-style inline chords ("[C]words") are understood as well. Text with
 * no chord in it returns null - that is an ordinary paste.
 *
 * Pure string work, no DOM. Browser: window.ChordSheet. Node: module.exports
 * (test/chord-sheet.test.js). The chord grammar and the notation rules follow
 * transfer_songs.py, the import pipeline that used to do this server-side.
 */
(function (global) {
  'use strict';

  // Same private-use placeholder as song-edit.js / song-cleanup.js.
  var MARKER = String.fromCharCode(0xe000);
  var NBSP = String.fromCharCode(0xa0);
  var TAB_WIDTH = 8;

  // === Chord names ===
  // root, accidental, quality, extension, sus/add/alterations, slash bass.
  // Deliberately strict: a lyric line is told apart from a chord line only by
  // every one of its words parsing here, so "Ale" or "Den" must not.
  var CHORD_RE = new RegExp(
    '^([A-H])(#|b)?' +
    '(maj|Maj|M|min|mi|moll|mol|m|dim|°|aug|\\+|-)?' +
    '(\\d{1,2})?' +
    '((?:sus\\d?|add\\d{1,2}|[b#]\\d{1,2})*)' +
    '(?:/([A-H])(#|b)?)?$'
  );

  // German/Czech note names some songbooks use (Fis = F#, As = Ab, ...).
  var GERMAN = [
    ['Cis', 'C#'], ['Dis', 'D#'], ['Fis', 'F#'], ['Gis', 'G#'], ['Ais', 'A#'],
    ['Des', 'Db'], ['Ges', 'Gb'], ['Hes', 'B'], ['Es', 'Eb'], ['As', 'Ab']
  ];

  function degerman(tok) {
    for (var i = 0; i < GERMAN.length; i++) {
      var g = GERMAN[i][0];
      if (tok.indexOf(g) !== 0) continue;
      var next = tok.charAt(g.length);
      // "Fis7", "Fismi", "Es" - but not a longer word that merely starts so.
      if (next === '' || !/[a-z]/.test(next) || next === 'm') {
        return GERMAN[i][1] + tok.slice(g.length);
      }
    }
    return tok;
  }

  // Token -> parsed chord, or null. Optional-chord brackets "(C)" and
  // trailing "*" or "," are shrugged off.
  function parseChord(raw) {
    var tok = raw.replace(/^\(+|[)*,]+$/g, '');
    if (!tok) return null;
    var m = degerman(tok).match(CHORD_RE);
    if (!m) return null;
    return {
      root: m[1], acc: m[2] || '', qual: m[3] || '', ext: m[4] || '',
      mods: m[5] || '', bass: m[6] || '', bassAcc: m[7] || ''
    };
  }

  function normRoot(root, acc, bIsH) {
    if ((root === 'B' || root === 'H') && acc === 'b') return 'B';
    if (root === 'A' && acc === '#') return 'B';
    if (root === 'B' && !acc && bIsH) return 'H';
    return root + acc;
  }

  function normQual(qual, ext) {
    switch (qual) {
      case 'maj': case 'Maj': return 'maj';
      case 'M': return ext ? 'maj' : '';
      case 'min': case 'mi': case 'mol': case 'moll': case 'm': case '-': return 'mi';
      case 'dim': case '°': return 'dim';
      case 'aug': case '+': return 'aug';
      default: return '';
    }
  }

  function chordName(p, bIsH) {
    return normRoot(p.root, p.acc, bIsH) + normQual(p.qual, p.ext) + p.ext + p.mods +
      (p.bass ? '/' + normRoot(p.bass, p.bassAcc, bIsH) : '');
  }

  // English "B" is the Czech "H"; Czech "B" is B flat. Only a bare B is in
  // doubt, so decide that once for the whole paste, from what else is in it.
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11 };

  function pitchOf(root, acc, bIsH) {
    var base;
    if (root === 'B') {
      if (acc === 'b') return 10;
      base = bIsH ? 11 : 10;
    } else {
      base = PC[root];
    }
    if (acc === '#') base += 1;
    else if (acc === 'b') base -= 1;
    return (base + 12) % 12;
  }

  // Which scale degrees of a major key carry a chord of each quality:
  // I IV V major, ii iii vi minor, vii diminished.
  var DEGREES = { maj: [0, 5, 7], mi: [2, 4, 9], dim: [11] };

  // How many of the chords fit the best-fitting key, quality included - "D A
  // Bm G" fits D major with B as H, but the roots alone would fit F major
  // just as well with B as B flat.
  function keyFit(parsed, bIsH) {
    var best = 0;
    for (var k = 0; k < 12; k++) {
      var s = 0;
      parsed.forEach(function (p) {
        var q = normQual(p.qual, p.ext);
        var degree = (pitchOf(p.root, p.acc, bIsH) - k + 12) % 12;
        if (DEGREES[q === 'mi' || q === 'dim' ? q : 'maj'].indexOf(degree) !== -1) s++;
      });
      if (s > best) best = s;
    }
    return best;
  }

  function decideB(parsed) {
    var plainB = parsed.some(function (p) {
      return (p.root === 'B' && !p.acc) || (p.bass === 'B' && !p.bassAcc);
    });
    if (!plainB) return { bIsH: false, ambiguous: false };
    var czech = parsed.some(function (p) { return p.root === 'H' || p.bass === 'H' || p.qual === 'mi'; });
    if (czech) return { bIsH: false, ambiguous: false };
    var flatsSpelled = parsed.some(function (p) { return p.root === 'B' && p.acc === 'b'; });
    if (flatsSpelled) return { bIsH: true, ambiguous: false };
    var asH = keyFit(parsed, true);
    var asBb = keyFit(parsed, false);
    if (asH !== asBb) return { bIsH: asH > asBb, ambiguous: false };
    return { bIsH: false, ambiguous: true };
  }

  // === Lines ===
  // Tokens a chord line may carry besides chords: bar lines, repeat signs.
  var FILLER_RE = /^(\|+|%|-|\/\/?:|:\/\/?|\.\.\.?|…)$/;
  var COUNT_RE = /^\(?(\d+x|x\d+)\)?$/i;

  function expandTabs(line) {
    var out = '';
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '\t') {
        do { out += ' '; } while (out.length % TAB_WIDTH);
      } else {
        out += ch === NBSP ? ' ' : ch;
      }
    }
    return out;
  }

  // Chord tokens of a chord line with their columns, or null when the line
  // has a word that is not a chord. Bracketed rows ("[A]   [E]") count too:
  // the brackets become spaces, so the columns stay put.
  function chordLine(line) {
    var bare = line.replace(/[\[\]]/g, ' ');
    var re = /\S+/g;
    var m;
    var chords = [];
    var count = '';
    while ((m = re.exec(bare))) {
      var tok = m[0];
      if (FILLER_RE.test(tok)) continue;
      if (COUNT_RE.test(tok)) { count = tok; continue; }
      var p = parseChord(tok);
      if (!p) return null;
      chords.push({ col: m.index, chord: p });
    }
    return chords.length ? { chords: chords, count: count } : null;
  }

  // "[C]words w[G]ords" -> the words without brackets, plus where each chord
  // stood in them. null when the line has no bracketed chord.
  function inlineChords(line) {
    var re = /\[([^\[\]\s]{1,12})\]/g;
    var m;
    var text = '';
    var last = 0;
    var chords = [];
    while ((m = re.exec(line))) {
      var p = parseChord(m[1]);
      if (!p) continue;
      text += line.slice(last, m.index);
      chords.push({ col: text.length, chord: p });
      last = m.index + m[0].length;
    }
    if (!chords.length) return null;
    return { text: text + line.slice(last), chords: chords };
  }

  // Where a chord standing at column `col` belongs: the start of the word
  // under it, or of the next word when it stands over a gap.
  function anchorFor(words, col) {
    if (col >= words.length) return words.length;
    var i = col;
    if (words.charAt(i) === ' ') {
      while (i < words.length && words.charAt(i) === ' ') i++;
      return i;
    }
    while (i > 0 && words.charAt(i - 1) !== ' ') i--;
    return i;
  }

  // Words + positioned chords -> one line with a MARKER (and a space on each
  // side) before every word a chord falls on. Chords past the end of the
  // words trail after them.
  function mergeLine(words, chords, out) {
    var groups = [];
    chords.forEach(function (c) {
      var at = anchorFor(words, c.col);
      var g = groups.length && groups[groups.length - 1].at === at ? groups[groups.length - 1] : null;
      if (!g) { g = { at: at, chords: [] }; groups.push(g); }
      g.chords.push(c.chord);
    });
    var text = '';
    var last = 0;
    var tail = null;
    groups.forEach(function (g) {
      if (g.at >= words.length) { tail = g; return; }
      text += words.slice(last, g.at) + markers(g.chords, out) + ' ';
      last = g.at;
    });
    text += words.slice(last);
    if (tail) {
      text = text.replace(/ +$/, '');
      text += (text.trim() ? ' ' : '') + markers(tail.chords, out);
    }
    return text;
  }

  function markers(chords, out) {
    return chords.map(function (c) { out.push(c); return MARKER; }).join(' ');
  }

  // === Section labels ===
  // [Chorus], Ref:, R:, Refrén, [Verse 2], Intro:, 1. ... -> what to do.
  var LABELS = {
    chorus: 'R', refrain: 'R', refren: 'R', ref: 'R', r: 'R',
    bridge: 'B', b: 'B',
    verse: 'verse', sloka: 'verse', strofa: 'verse', s: 'verse',
    'pre-chorus': 'verse', prechorus: 'verse', hook: 'verse',
    intro: 'instr:Předehra', predehra: 'instr:Předehra',
    outro: 'instr:Dohra', dohra: 'instr:Dohra', coda: 'instr:Dohra', ending: 'instr:Dohra',
    solo: 'instr:Sólo', interlude: 'instr:Mezihra', instrumental: 'instr:Mezihra',
    mezihra: 'instr:Mezihra', break: 'instr:Mezihra'
  };

  function fold(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // Returns { kind, count, len } for a label at the start of the line (len =
  // how many characters it takes up), or null. Short labels (R, Ref, B, S)
  // and labels with words after them need their punctuation - "[R]", "R:",
  // "Ref." - so a lyric line starting with such a word stays a lyric line.
  function leadingLabel(line) {
    var num = line.match(/^(\s*)(\d{1,2})[.)](\s+|$)/);
    if (num) return { kind: 'verse', count: '', len: num[0].length };
    var m = line.match(/^(\s*)(\[)?\s*([A-Za-zÀ-ſ-]+)(\.)?\s*(\d{1,2})?\.?\s*(\])?\s*(:)?\s*(\(?(?:\d+x|x\d+)\)?)?(\s*)/i);
    if (!m) return null;
    var kind = LABELS[fold(m[3])];
    if (!kind) return null;
    var bracketed = !!(m[2] && m[6]);
    if (!!m[2] !== !!m[6]) return null;
    // "[B]words" is an inline chord, not a bridge.
    if (bracketed && !m[5] && parseChord(m[3])) return null;
    var punct = bracketed || !!m[7] || !!m[4];
    var rest = line.slice(m[0].length);
    if (!punct && (m[3].length <= 3 || rest.trim())) return null;
    return { kind: kind, count: m[8] || '', len: m[0].length };
  }

  function blank(line, len) {
    return new Array(len + 1).join(' ') + line.slice(len);
  }

  // === convert ===
  function convert(input) {
    var lines = String(input).replace(/\r\n?/g, '\n').split('\n').map(function (l) {
      return expandTabs(l).replace(/\s+$/, '');
    });

    // 1) Label prefixes come off (blanked, so chord columns stay true) and
    //    each line is classified once.
    var rows = lines.map(function (line) {
      var label = leadingLabel(line);
      var body = label ? blank(line, label.len).replace(/\s+$/, '') : line;
      var row = { label: label, body: body };
      if (!body.trim()) row.type = label ? 'label' : 'blank';
      else if ((row.chordLine = chordLine(body))) row.type = 'chords';
      else if ((row.inline = inlineChords(body))) row.type = 'inline';
      else row.type = 'text';
      return row;
    });

    // 2) Every chord seen, to settle the notation before naming anything.
    var parsed = [];
    rows.forEach(function (r) {
      var cs = r.type === 'chords' ? r.chordLine.chords : r.type === 'inline' ? r.inline.chords : [];
      cs.forEach(function (c) { parsed.push(c.chord); });
    });
    if (!parsed.length) return null;
    var notation = decideB(parsed);

    // 3) Chord lines merge into the words under them; positioned chords
    //    become MARKERs, in order, in `found`.
    var found = [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var next = rows[i + 1];
      if (r.type === 'chords') {
        var cl = r.chordLine;
        if (next && next.type === 'text' && !(next.label && r.label)) {
          var merged = mergeLine(next.body, cl.chords, found);
          out.push({ label: r.label || next.label, text: merged + (cl.count ? ' ' + cl.count : '') });
          i++;
        } else {
          out.push({ label: r.label, text: markers(cl.chords.map(function (c) { return c.chord; }), found) +
            (cl.count ? ' ' + cl.count : '') });
        }
      } else if (r.type === 'inline') {
        out.push({ label: r.label, text: mergeLine(r.inline.text, r.inline.chords, found) });
      } else if (r.type === 'text') {
        out.push({ label: r.label, text: r.body });
      } else {
        out.push({ label: r.label, text: '', blank: r.type === 'blank' });
      }
    }

    // 4) Blocks: a blank line ends one, a label starts one.
    var blocks = [];
    var cur = null;
    out.forEach(function (o) {
      if (o.blank) { cur = null; return; }
      if (o.label || !cur) {
        cur = { label: o.label, lines: [] };
        blocks.push(cur);
      }
      // Chord sites pad the words to make room for long chord names; once
      // the chords are inline that padding is just a gap.
      var t = o.text.trim().replace(/ {2,}/g, ' ');
      if (t) cur.lines.push(t);
    });

    // 5) Render. Chord names are fixed up here, in MARKER order.
    var choruses = [];
    var parts = [];
    blocks.forEach(function (b) {
      var kind = b.label ? b.label.kind : '';
      var count = b.label ? b.label.count : '';
      var plain = b.lines.join('\n').split(MARKER).join('').replace(/\s+/g, ' ').trim().toLowerCase();
      var repeatOf = plain && choruses.indexOf(plain) !== -1;

      if (kind === 'R' || kind === 'B') {
        if (!b.lines.length || repeatOf) {
          parts.push({ text: '//' + kind + ' ' + (count ? count + ' ' : '') + kind + '//', drop: b.lines });
          return;
        }
        if (kind === 'R') choruses.push(plain);
        var ls = b.lines.slice();
        ls[0] = '//' + kind + ' ' + ls[0];
        ls[ls.length - 1] = ls[ls.length - 1] + ' ' + kind + '//';
        parts.push({ text: ls.join('\n') });
        return;
      }
      if (!kind && repeatOf) {
        parts.push({ text: '//R R//', drop: b.lines });
        return;
      }
      if (kind.indexOf('instr:') === 0) {
        var name = kind.slice(6) + ':';
        if (!b.lines.length) return;
        var first = b.lines[0];
        var rest = b.lines.slice(1);
        var chordsOnly = first.replace(new RegExp('[' + MARKER + '\\s]', 'g'), '') === '' ||
          /^[ ]+\(?(\d+x|x\d+)\)?$/i.test(first);
        parts.push({ text: chordsOnly ? [name + ' ' + first].concat(rest).join('\n')
                                      : [name].concat(b.lines).join('\n') });
        return;
      }
      if (b.lines.length) parts.push({ text: b.lines.join('\n') });
    });

    // A collapsed repeat drops the chords its copy carried; the rest keep
    // their place in `found`, which runs in text order.
    var chords = [];
    var k = 0;
    var text = parts.map(function (p) {
      if (p.drop) {
        p.drop.forEach(function (l) { k += l.split(MARKER).length - 1; });
        return p.text;
      }
      var n = p.text.split(MARKER).length - 1;
      for (var j = 0; j < n; j++) chords.push(chordName(found[k++], notation.bIsH));
      return p.text;
    }).join('\n\n');

    var english = notation.bIsH && parsed.some(function (p) { return p.root === 'B' && !p.acc; });
    return {
      text: text,
      chords: chords,
      count: chords.length,
      bToH: english,
      bAmbiguous: notation.ambiguous
    };
  }

  // === Comparing two sources ===
  // Two chord sites seldom agree to the letter: one adds sevenths or a
  // passing chord, one plays in another key. Compare the sets of chords used,
  // over all 12 transpositions: 'same' (identical sets), 'similar' (reduced
  // to root + major/minor/dim/aug, at least SIMILAR of them shared), or
  // 'different'. `shift` is the transposition that matched, in semitones
  // (0 = same key).
  var SIMILAR = 0.6;
  var ChordTheory = (typeof require !== 'undefined')
    ? require('./chord-theory.js')
    : global.ChordTheory;

  function triad(name) {
    var p = parseChord(name);
    if (!p) return name;
    var q = normQual(p.qual, p.ext);
    return normRoot(p.root, p.acc, false) + (q === 'maj' ? '' : q);
  }

  function chordSet(list, shift, reduce) {
    var seen = {};
    list.forEach(function (c) {
      seen[ChordTheory.transposeChord(reduce ? triad(c) : c, shift)] = true;
    });
    return Object.keys(seen).sort();
  }

  // Shared chords over all chords used by either source (Jaccard index).
  function overlap(x, y) {
    var shared = x.filter(function (c) { return y.indexOf(c) !== -1; }).length;
    return shared / (x.length + y.length - shared);
  }

  function compareSources(a, b) {
    if (!a || !b || !a.length || !b.length) return null;
    var exact = chordSet(b, 0, false).join(' ');
    var triads = chordSet(b, 0, true);
    var best = { score: -1, shift: null };
    for (var shift = 0; shift < 12; shift++) {
      if (chordSet(a, shift, false).join(' ') === exact) return { level: 'same', shift: shift };
      var score = overlap(chordSet(a, shift, true), triads);
      if (score > best.score) best = { score: score, shift: shift };
    }
    return best.score >= SIMILAR
      ? { level: 'similar', shift: best.shift }
      : { level: 'different', shift: null };
  }

  var api = {
    MARKER: MARKER,
    convert: convert,
    compareSources: compareSources,
    parseChord: parseChord,
    chordName: function (raw, bIsH) {
      var p = parseChord(raw);
      return p ? chordName(p, !!bIsH) : null;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof global !== 'undefined') global.ChordSheet = api;
})(typeof self !== 'undefined' ? self : this);
