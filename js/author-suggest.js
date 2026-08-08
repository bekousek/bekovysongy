/**
 * author-suggest.js - Interpret autocomplete for the admin editor.
 *
 * The interpret field is free text, so the same band drifts into several
 * spellings ("Xindl-X" / "Xindl X", "Poletíme?" / "Poletime", "Sto zvířat" /
 * "Sto Zvířat") and the site then lists them as different artists. This
 * offers what the collection already uses instead of relying on memory.
 *
 * Two halves, split so the ranking can be tested without a DOM:
 *
 *   buildIndex(lists)   - counts how many songs use each spelling
 *   match(index, query) - ranks that index against what's typed: case- and
 *                         diacritics-insensitive, and as a last resort
 *                         ignoring punctuation too, so "xindl x" still finds
 *                         "Xindl-X" - which is exactly the moment a duplicate
 *                         spelling would otherwise be born
 *   attach(input, opts) - hangs the ranked list under an <input> as a
 *                         dropdown (arrows to move, Enter or click to pick)
 *
 * Every row carries its song count and ties sort by it, so the spelling
 * already used most is always the first one offered - that's what makes the
 * list a decision ("which of these two is mine?") and not just a reminder.
 *
 * Nothing is highlighted until an arrow key or the mouse says so: Enter on a
 * fresh dropdown must still mean "take what I typed", or every new interpret
 * whose name starts like an old one would be silently renamed.
 *
 * Browser: window.AuthorSuggest. Node: module.exports (ranking half only).
 */
(function (global) {
  'use strict';

  // Combining Diacritical Marks (U+0300-U+036F), built from char codes rather
  // than a \u-escape literal for the same reason as js/song-cleanup.js's copy:
  // a literal risks silently becoming the raw combining characters in transit.
  var COMBINING_MARKS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

  // Folded (lowercase, diacritics stripped) text plus a map from each folded
  // character back to its index in the original. Folding runs per character
  // precisely so that map can exist - the dropdown highlights the matched run
  // in the original spelling, which needs original offsets.
  function fold(s) {
    var text = '';
    var map = [];
    for (var i = 0; i < s.length; i++) {
      var f = s.charAt(i).normalize('NFD').replace(COMBINING_MARKS_RE, '').toLowerCase();
      for (var j = 0; j < f.length; j++) {
        text += f.charAt(j);
        map.push(i);
      }
    }
    map.push(s.length); // sentinel: end offset of a match running to the end
    return { text: text, map: map };
  }

  // Folded text with everything that isn't a letter or digit removed. Applied
  // to both sides of the comparison, so "Xindl X" and "Xindl-X" meet. Czech
  // folds to ASCII; other alphabets are dropped here and just fall through to
  // no loose match, which is no worse than not trying.
  function looseFold(folded) {
    return folded.replace(/[^a-z0-9]/g, '');
  }

  // Ranks, best first. Only the first three can highlight - a loose match's
  // offsets don't line up with the original string.
  var RANK_PREFIX = 0; // "chin"    -> "Chinaski"
  var RANK_WORD = 1;   // "kryl"    -> "Karel Kryl"
  var RANK_INSIDE = 2; // "ryl"     -> "Karel Kryl"
  var RANK_LOOSE = 3;  // "xindl x" -> "Xindl-X"

  // A match right after anything that isn't a letter or digit counts as
  // hitting a word start. Folded Czech is ASCII, so an ASCII test is enough.
  function isWordStart(text, at) {
    return !/[a-z0-9]/.test(text.charAt(at - 1));
  }

  var collator;
  function compareNames(a, b) {
    if (collator === undefined) {
      try { collator = new Intl.Collator('cs'); } catch (e) { collator = null; }
    }
    return collator ? collator.compare(a, b) : a.localeCompare(b);
  }

  /**
   * lists: one array of interpret names per song (the same name twice in one
   * song counts once). -> [{ name, count }], most used first, ties by name.
   */
  function buildIndex(lists) {
    // Null prototype: interpret names are user text, and "constructor" or
    // "__proto__" must be countable like any other name.
    var counts = Object.create(null);
    (lists || []).forEach(function (names) {
      var seen = Object.create(null);
      (names || []).forEach(function (raw) {
        var name = String(raw == null ? '' : raw).trim();
        if (name === '' || seen[name]) return;
        seen[name] = true;
        counts[name] = (counts[name] || 0) + 1;
      });
    });
    return Object.keys(counts).map(function (name) {
      return { name: name, count: counts[name] };
    }).sort(function (a, b) {
      return b.count - a.count || compareNames(a.name, b.name);
    });
  }

  /**
   * index: buildIndex() output. query: the raw text typed.
   * opts:  { limit = 8, exclude = [] (names already picked) }
   * -> [{ name, count, rank, from, to }], best first; from/to bound the
   *    matched run inside `name` (-1 when there is nothing to highlight).
   */
  function match(index, query, opts) {
    opts = opts || {};
    var limit = opts.limit == null ? 8 : opts.limit;
    var skip = Object.create(null);
    (opts.exclude || []).forEach(function (n) { skip[String(n).trim()] = true; });

    var rows = (index || []).filter(function (r) { return !skip[r.name]; });
    var q = fold(String(query == null ? '' : query).trim()).text;

    // Nothing typed yet: offer the most used ones - already the index order.
    if (q === '') {
      return rows.slice(0, limit).map(function (r) {
        return { name: r.name, count: r.count, rank: RANK_PREFIX, from: -1, to: -1 };
      });
    }

    var qLoose = looseFold(q);
    var hits = [];
    rows.forEach(function (r) {
      var f = fold(r.name);
      var at = f.text.indexOf(q);
      var rank;
      if (at === 0) rank = RANK_PREFIX;
      else if (at > 0) rank = isWordStart(f.text, at) ? RANK_WORD : RANK_INSIDE;
      else if (qLoose !== '' && looseFold(f.text).indexOf(qLoose) !== -1) rank = RANK_LOOSE;
      else return;
      hits.push({
        name: r.name,
        count: r.count,
        rank: rank,
        from: at < 0 ? -1 : f.map[at],
        to: at < 0 ? -1 : f.map[at + q.length]
      });
    });

    hits.sort(function (a, b) {
      return a.rank - b.rank || b.count - a.count || compareNames(a.name, b.name);
    });
    return hits.slice(0, limit);
  }

  // === Dropdown ===

  var menuSeq = 0;

  function songCountTitle(n) {
    if (n === 1) return '1 píseň s tímto zápisem';
    return n + (n < 5 ? ' písně' : ' písní') + ' s tímto zápisem';
  }

  /**
   * Attaches the dropdown to an <input>.
   *
   * opts:
   *   anchor     - positioned element the menu hangs under (default: the
   *                input's parent; it needs position:relative)
   *   candidates - () -> buildIndex() output. Read fresh on every keystroke,
   *                so a name typed a minute ago is already offered.
   *   query      - () -> the text to match (default: the whole input value)
   *   exclude    - () -> names to leave out (the ones already picked)
   *   pick       - (name) -> apply the choice; the menu closes itself first
   *   limit      - rows to show (default 8)
   *   emptyText  - line shown when something is typed and nothing matches;
   *                omit it to just close instead
   *
   * -> { open, close, isOpen }
   */
  function attach(input, opts) {
    opts = opts || {};
    var doc = input.ownerDocument;
    var anchor = opts.anchor || input.parentNode;
    var limit = opts.limit || 8;
    var id = 'ac-menu-' + (++menuSeq);

    var menu = doc.createElement('div');
    menu.className = 'ac-menu';
    menu.id = id;
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    anchor.appendChild(menu);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');

    var rows = [];
    var active = -1;
    // Set by a pick, so refocusing the field it just filled doesn't pop the
    // menu straight back open under the cursor.
    var quiet = false;

    function currentQuery() {
      return opts.query ? opts.query() : input.value;
    }

    function isOpen() {
      return !menu.hidden;
    }

    function close() {
      if (menu.hidden) return;
      menu.hidden = true;
      rows = [];
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function open() {
      var q = String(currentQuery() || '').trim();
      rows = match(opts.candidates ? opts.candidates() : [], q, {
        limit: limit,
        exclude: opts.exclude ? opts.exclude() : []
      });
      // Typed out in full with nothing else near it: there is nothing left to
      // offer, and falling through to emptyText below would claim this
      // spelling is new when it's the established one. Say nothing instead.
      // A full match that DOES have neighbours (typing "Poletíme" while
      // "Poletíme?" exists) is the opposite case - that list has to show.
      if (rows.length === 1 && rows[0].name === q) {
        close();
        return;
      }
      if (rows.length === 0 && !(q !== '' && opts.emptyText)) {
        close();
        return;
      }
      render();
      menu.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function render() {
      menu.textContent = '';
      active = -1;
      input.removeAttribute('aria-activedescendant');
      if (rows.length === 0) {
        var empty = doc.createElement('div');
        empty.className = 'ac-empty';
        empty.textContent = opts.emptyText;
        menu.appendChild(empty);
        return;
      }
      rows.forEach(function (row, i) { menu.appendChild(buildItem(row, i)); });
    }

    function buildItem(row, i) {
      var item = doc.createElement('div');
      item.className = 'ac-item';
      item.id = id + '-' + i;
      item.setAttribute('role', 'option');
      item.dataset.index = String(i);

      var name = doc.createElement('span');
      name.className = 'ac-name';
      if (row.from >= 0 && row.to > row.from) {
        var hit = doc.createElement('span');
        hit.className = 'ac-hit';
        hit.textContent = row.name.slice(row.from, row.to);
        name.appendChild(doc.createTextNode(row.name.slice(0, row.from)));
        name.appendChild(hit);
        name.appendChild(doc.createTextNode(row.name.slice(row.to)));
      } else {
        name.textContent = row.name;
      }
      item.appendChild(name);

      var count = doc.createElement('span');
      count.className = 'ac-count';
      count.textContent = String(row.count);
      count.title = songCountTitle(row.count);
      item.appendChild(count);
      return item;
    }

    function setActive(i) {
      var items = menu.querySelectorAll('.ac-item');
      if (items.length === 0) return;
      if (i < 0) i = items.length - 1;
      if (i >= items.length) i = 0;
      if (i === active) return;
      if (active >= 0 && items[active]) items[active].classList.remove('is-active');
      active = i;
      items[active].classList.add('is-active');
      input.setAttribute('aria-activedescendant', items[active].id);
      if (items[active].scrollIntoView) items[active].scrollIntoView({ block: 'nearest' });
    }

    function choose(i) {
      var row = rows[i];
      if (!row) return false;
      close();
      quiet = true;
      if (opts.pick) opts.pick(row.name);
      return true;
    }

    input.addEventListener('input', function () { quiet = false; open(); });
    input.addEventListener('focus', function () { if (!quiet) open(); });
    input.addEventListener('blur', function () { quiet = false; close(); });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen()) {
          quiet = false;
          open();
          if (!isOpen()) return;
        }
        setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (!isOpen()) return;
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (active < 0) {
          if (e.key === 'Enter') close(); // committing what's typed - get out of the way
          return;
        }
        // Picking has to win over everything else this key does here: the chip
        // field's own Enter handler, and the dialog's implicit submit. Only
        // stopImmediatePropagation reaches listeners on this same element,
        // which is why this one is attached first (see js/editor.js).
        e.stopImmediatePropagation();
        if (e.key === 'Enter') e.preventDefault(); // Tab still moves on
        choose(active);
        return;
      }
      if (e.key === 'Escape') {
        // Close the menu, not the dialog around it.
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });

    // Keep focus in the field: a blur between mousedown and click would let
    // the chip field commit the half-typed text and steal the pick.
    menu.addEventListener('mousedown', function (e) { e.preventDefault(); });

    menu.addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('.ac-item');
      if (!item) return;
      choose(parseInt(item.dataset.index, 10));
      input.focus();
    });

    menu.addEventListener('mousemove', function (e) {
      var item = e.target.closest && e.target.closest('.ac-item');
      if (item) setActive(parseInt(item.dataset.index, 10));
    });

    doc.addEventListener('mousedown', function (e) {
      if (!isOpen() || e.target === input || menu.contains(e.target)) return;
      close();
    });

    return { open: open, close: close, isOpen: isOpen };
  }

  var api = {
    buildIndex: buildIndex,
    match: match,
    attach: attach,
    // exposed for tests
    _fold: fold
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof global !== 'undefined') global.AuthorSuggest = api;
})(typeof self !== 'undefined' ? self : this);
