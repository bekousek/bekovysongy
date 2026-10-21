/**
 * songbook-pdf.js - the printable songbook (Moje → Na papír): the picked
 * songs as one PDF, one song per A4 page and two at most for a very long
 * one, set for a black-and-white printer.
 *
 * Loaded on demand by js/app.js. Pulls in jsPDF from cdnjs (pinned, with
 * SRI), the Figtree TTFs from assets/fonts (OFL; embedded, or Czech letters
 * would not print), js/sections.js for the refrén / bridge markers, and each
 * song's own page for its text (from the service worker's cache when the
 * songbook was downloaded for offline).
 *
 * What the print is built around:
 *   - chords bold on a light grey highlight box: they stand out on a
 *     black-and-white printer, where orange would come out as just more grey;
 *   - each song on one page, in 1-3 columns at 14 pt down to 6 pt, picked by
 *     size less a penalty for wrapped lines (a line broken in two is harder
 *     to follow while playing than one a point smaller); two pages only when
 *     one page would go under 8 pt and two score at least 2 pt better;
 *   - tablature in Courier with its spacing kept, shrunk to the column
 *     rather than broken;
 *   - a chord is never left at the end of a line without the word it sits on;
 *   - a repeated chorus prints as its label ("R:", "R: 2x"), the way the song
 *     page folds it, plus any changed ending;
 *   - contents with page numbers up front (clickable) and a PDF bookmark per
 *     song.
 *
 * window.SongbookPdf.build(songs, { onProgress, signal })
 *   songs: SongList entries ({ slug, title, _authors, _capo }), in book order
 *   -> Promise<{ blob, pages, failed: [titles], layouts: [{ slug, size, cols, pages }] }>
 */
(function () {
  'use strict';

  const BASE = new URL('../', document.currentScript.src).href;
  const JSPDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js';
  const JSPDF_SRI = 'sha512-plOdviVmws4Y3JAvbnpfKb2hVxKM1lCwsi3vmElYRj+tiDLffZ4FVUj5a8vyKJ9pIgl8JCAHEJ4D1iUKBecswg==';
  const FONT = 'Figtree';

  // A4 in points and the type area.
  const PAGE_W = 595.28, PAGE_H = 841.89;
  const MX = 42, MTOP = 46, MBOTTOM = 50;
  const W = PAGE_W - 2 * MX;
  const BODY_BOTTOM = PAGE_H - MBOTTOM;
  const COL_GAP = 20;
  const FOOT_BASE = PAGE_H - 24;
  const MIN_COL = 150;          // narrowest column worth setting

  // Lyric sizes tried, and when a song may take a second page.
  const MAX_SIZE = 14, MIN_SIZE = 6, STEP = 0.25;
  const ONE_PAGE_MIN = 8, TWO_PAGE_GAIN = 2;
  // A line broken in two is harder to follow while playing than one a size
  // smaller: a song whose every line wraps scores this many points lower.
  const WRAP_COST = 5;

  // In ems of the lyric size.
  const LEAD = 1.45;            // line pitch
  const GAP = 0.8;              // between sections
  const BLANK = 0.55;           // a blank line inside a section
  const HANG = 1.2;             // continuation of a wrapped line
  const PAD = 0.22;             // chord box, each side
  const BOX_UP = 0.86, BOX_DOWN = 0.3;
  const BOX_R = 0.2;
  const BASELINE = 1.05;        // from the top of a line to its baseline
  const HIGHLIGHT = 212;        // chord box grey, 0 black … 255 white
  const MONO = 0.92;            // tablature in Courier, a touch smaller

  // ---- loading -------------------------------------------------------------

  function loadScript(src, sri) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      if (sri) {
        s.integrity = sri;
        s.crossOrigin = 'anonymous';
        s.referrerPolicy = 'no-referrer';
      }
      s.onload = resolve;
      s.onerror = () => reject(new Error(src));
      document.head.appendChild(s);
    });
  }

  let libs = null;
  function loadLibs() {
    if (!libs) {
      libs = Promise.all([
        window.jspdf ? null : loadScript(JSPDF_SRC, JSPDF_SRI),
        window.SongSections ? null : loadScript(BASE + 'js/sections.js'),
        fontData('Figtree-Regular.ttf'),
        fontData('Figtree-Bold.ttf'),
      ]).then(([, , regular, bold]) => ({ JsPDF: window.jspdf.jsPDF, regular, bold }))
        .catch(err => { libs = null; throw err; });
    }
    return libs;
  }

  async function fontData(file) {
    const res = await fetch(BASE + 'assets/fonts/' + file);
    if (!res.ok) throw new Error(file);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function fetchText(slug, signal) {
    const res = await fetch(BASE + 'songs/' + encodeURIComponent(slug) + '.html', { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const page = new DOMParser().parseFromString(await res.text(), 'text/html');
    const pre = page.querySelector('pre.song-text');
    if (!pre) throw new Error('no text');
    return pre.innerHTML;
  }

  // ---- the song as sections of lines of runs ---------------------------------

  // One array of runs per source line: { text, bold } or { chord }.
  function linesOf(node) {
    const lines = [[]];
    const text = (s, bold) => s.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, bold: !!bold });
    });
    (function walk(n) {
      n.childNodes.forEach(c => {
        if (c.nodeType === 3) text(c.nodeValue);
        else if (c.nodeType !== 1) return;
        else if (c.classList.contains('chord')) {
          const raw = c.textContent;
          const name = (c.getAttribute('data-chord') || raw).trim();
          if (name) lines[lines.length - 1].push({ chord: name });
          (raw.match(/\n/g) || []).forEach(() => lines.push([]));
        } else if (c.classList.contains('repeat-mark')) text(c.textContent, true);
        else walk(c);
      });
    })(node);
    return lines;
  }

  // A line of tablature ("E |--3--2--|") is mostly dashes; it only reads
  // in letters of one width, with its leading spaces kept.
  function isTab(text) {
    const dashes = (text.match(/-/g) || []).length;
    return dashes >= 6 && dashes >= 0.45 * text.replace(/\s/g, '').length;
  }

  // Trim each line, keep at most one blank line in a row (as null), none at
  // either end. Tablature becomes a single { tab } run.
  function tidy(lines) {
    const out = [];
    lines.forEach(runs => {
      if (!runs.some(x => x.chord)) {
        const text = runs.map(x => x.text).join('').replace(/\t/g, '    ').replace(/\s+$/, '');
        if (isTab(text)) { out.push([{ tab: text }]); return; }
      }
      const r = runs.map(x => (x.chord ? x : { text: x.text.replace(/\t/g, ' ').replace(/\u00a0/g, ' '), bold: x.bold }));
      if (r.length && !r[0].chord) r[0] = { text: r[0].text.replace(/^\s+/, ''), bold: r[0].bold };
      const last = r.length - 1;
      if (last >= 0 && !r[last].chord) r[last] = { text: r[last].text.replace(/\s+$/, ''), bold: r[last].bold };
      const kept = r.filter(x => x.chord || x.text);
      if (kept.length) out.push(kept);
      else if (out.length && out[out.length - 1] !== null) out.push(null);
    });
    while (out.length && out[out.length - 1] === null) out.pop();
    return out;
  }

  function sectionsOf(preHtml) {
    const html = window.SongSections.transform(preHtml);
    const root = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html').body.firstChild;
    const out = [];
    root.childNodes.forEach(div => {
      if (div.nodeType !== 1) return;
      const c = div.classList;
      const head = div.querySelector(':scope > .section-head');
      const labelEl = head && head.querySelector('.section-label');
      const noteEl = head && head.querySelector('.section-note');
      const repeat = c.contains('is-repeat');
      let src = div;
      if (!c.contains('section-plain')) src = div.querySelector(repeat ? ':scope > .section-tail' : ':scope > .section-body');
      const lines = src ? tidy(linesOf(src)) : [];
      const label = labelEl ? labelEl.textContent.trim() : '';
      if (!label && !lines.length) return;
      out.push({
        label,
        note: noteEl ? noteEl.textContent.trim() : '',
        tail: repeat && lines.length > 0,
        lines,
      });
    });
    return out;
  }

  // ---- measuring and wrapping ----------------------------------------------

  // Widths in ems (jsPDF's unit width): every width scales with the size, so
  // a song is measured once and wrapped at any size by arithmetic.
  function tokensOf(runs, measure) {
    if (runs.length === 1 && runs[0].tab) {
      const w = measure(runs[0].tab, 'mono') * MONO;
      return [{ toks: [{ kind: 'mono', s: runs[0].tab, w }], w, mono: true, charW: measure('-', 'mono') * MONO }];
    }
    const toks = [];
    runs.forEach(r => {
      if (r.chord) { toks.push({ kind: 'chord', s: r.chord, w: measure(r.chord, true) + 2 * PAD }); return; }
      r.text.split(/( +)/).forEach(part => {
        if (!part) return;
        if (part[0] === ' ') toks.push({ kind: 'space', s: part, w: measure(' ', false) * part.length });
        else toks.push({ kind: 'word', s: part, bold: r.bold, w: measure(part, r.bold) });
      });
    });
    // A chord stays with the word it sits on, so a line never ends on a
    // chord whose syllable went to the next line.
    const units = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.kind === 'chord') {
        const unit = { toks: [t], w: t.w };
        const a = toks[i + 1], b = toks[i + 2];
        if (a && a.kind === 'space' && a.s.length === 1 && b && b.kind === 'word') { unit.toks.push(a, b); unit.w += a.w + b.w; i += 2; }
        else if (a && a.kind === 'word') { unit.toks.push(a); unit.w += a.w; i += 1; }
        units.push(unit);
      } else units.push({ toks: [t], w: t.w, space: t.kind === 'space' });
    }
    return units;
  }

  // Lines of units no wider than `avail` ems; continuation lines HANG in.
  // `over` is set when a single unit is wider than its line.
  function wrap(units, avail, state) {
    // Tablature shrinks to the column rather than break. A "line" that would
    // have to shrink below 60 % is several lines run together in the song's
    // data; it is cut into column-wide pieces, every letter being as wide as
    // the next.
    if (units.length === 1 && units[0].mono) {
      const u = units[0];
      const scale = Math.min(1, avail / u.w);
      if (scale >= 0.6) return [{ units, hang: false, scale }];
      const per = Math.max(8, Math.floor(avail / u.charW));
      return u.toks[0].s.match(new RegExp('.{1,' + per + '}', 'g')).map(piece => {
        const w = piece.length * u.charW;
        return { units: [{ toks: [{ kind: 'mono', s: piece, w }], w }], hang: false, scale: 1 };
      });
    }
    const out = [];
    let cur = [], w = 0;
    const flush = () => {
      while (cur.length && cur[cur.length - 1].space) w -= cur.pop().w;
      if (cur.length) out.push({ units: cur, hang: out.length > 0 });
      cur = []; w = 0;
    };
    units.forEach(u => {
      if (u.space) { if (cur.length) { cur.push(u); w += u.w; } return; }
      const limit = avail - (out.length ? HANG : 0);
      if (cur.length && w + u.w > limit) flush();
      if (u.w > avail - (out.length ? HANG : 0) + 1e-9) state.over = true;
      cur.push(u); w += u.w;
    });
    flush();
    return out;
  }

  // The song ready to lay out at any size: header, sections with measured
  // lines, the label gutter.
  function prepare(song, sections, measure, doc) {
    const prepared = { song, sections: [] };
    let gutter = 0;
    sections.forEach(s => {
      if (s.label) gutter = Math.max(gutter, measure(s.label, true) + 0.5);
    });
    prepared.gutter = gutter;
    sections.forEach(s => {
      const lines = s.lines.map(runs => (runs === null ? null : tokensOf(runs, measure)));
      if (s.tail && lines.length && lines[0]) lines[0] = tokensOf([{ text: '… ' }], measure).concat(lines[0]);
      if (s.label && !s.tail && !lines.length) {
        // A folded repeat or a bare heading: the label, and the play count.
        lines.push(s.note ? tokensOf([{ text: s.note }], measure) : []);
      } else if (s.note && lines.length && lines[0]) {
        lines[0] = tokensOf([{ text: s.note + ' ' }], measure).concat(lines[0]);
      }
      prepared.sections.push({ label: s.label, lines });
    });
    prepared.header = headerOf(song, doc);
    return prepared;
  }

  // ---- the page header -----------------------------------------------------

  function wordsToLines(doc, text, size, width) {
    doc.setFontSize(size);
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach(word => {
      const next = cur ? cur + ' ' + word : word;
      if (cur && doc.getTextWidth(next) > width) { lines.push(cur); cur = word; } else cur = next;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function headerOf(song, doc) {
    doc.setFont(FONT, 'bold');
    let size = 21;
    doc.setFontSize(size);
    while (size > 15 && doc.getTextWidth(song.title) > W) { size -= 1; doc.setFontSize(size); }
    const title = wordsToLines(doc, song.title, size, W).slice(0, 2);
    const by = (song._authors || []).join(', ');
    const titleBase = MTOP + size * 0.78;
    const lastTitle = titleBase + (title.length - 1) * size * 1.12;
    const subBase = lastTitle + 17;
    const hasSub = by || song._capo;
    return {
      size, title, titleBase, by, capo: song._capo || '', subBase,
      bodyTop: (hasSub ? subBase : lastTitle) + 18,
      contTop: MTOP + 11 + 16,
    };
  }

  function drawHeader(doc, h, page, title) {
    doc.setTextColor(0);
    if (page > 0) {
      doc.setFont(FONT, 'bold');
      doc.setFontSize(11);
      doc.text(title, MX, MTOP + 9);
      const w = doc.getTextWidth(title + ' ');
      doc.setFont(FONT, 'normal');
      doc.text('(pokračování)', MX + w, MTOP + 9);
      return;
    }
    doc.setFont(FONT, 'bold');
    doc.setFontSize(h.size);
    h.title.forEach((line, i) => doc.text(line, MX, h.titleBase + i * h.size * 1.12));
    let x = MX;
    doc.setFontSize(11);
    if (h.by) {
      doc.setFont(FONT, 'normal');
      doc.text(h.by, x, h.subBase);
      x += doc.getTextWidth(h.by) + 10;
    }
    if (h.capo) {
      // Capo as an outlined tag: it has to be noticed before the first chord.
      doc.setFont(FONT, 'bold');
      doc.setFontSize(9.5);
      const tw = doc.getTextWidth(h.capo);
      doc.setLineWidth(0.9);
      doc.setDrawColor(0);
      doc.roundedRect(x, h.subBase - 9.6, tw + 10, 13, 6.5, 6.5, 'S');
      doc.text(h.capo, x + 5, h.subBase);
    }
  }

  // ---- layout --------------------------------------------------------------

  // Flow the song into `cols` columns at `size` pt. Returns the placed lines
  // and how many pages that takes, or null when the columns would be too
  // narrow or a word doesn't fit its line.
  function layout(p, size, cols, allowOver) {
    const colW = (W - (cols - 1) * COL_GAP) / cols;
    if (colW < MIN_COL) return null;
    const colEm = colW / size;
    const state = { over: false };
    let lines = 0, wraps = 0;

    const blocks = p.sections.map(s => {
      const indent = s.label ? p.gutter : 0;
      const items = [];
      s.lines.forEach((units, i) => {
        if (units === null) { items.push({ blank: true }); return; }
        const visual = units.length ? wrap(units, colEm - indent, state) : [{ units: [], hang: false }];
        lines++;
        wraps += visual.length - 1;
        visual.forEach((v, j) => items.push({ units: v.units, hang: v.hang, scale: v.scale || 1, label: i === 0 && j === 0 ? s.label : '', indent }));
      });
      if (!items.length && s.label) items.push({ units: [], hang: false, label: s.label, indent });
      let h = 0;
      items.forEach(it => { h += it.blank ? BLANK : LEAD; });
      return { items, h };
    });
    if (state.over && !allowOver) return null;

    const top = (page) => (page === 0 ? p.header.bodyTop : p.header.contTop);
    const colH = (page) => (BODY_BOTTOM - top(page)) / size;
    const placed = [];
    let page = 0, col = 0, y = 0;
    const next = () => { col++; y = 0; if (col === cols) { col = 0; page++; } };

    blocks.forEach(b => {
      const gap = y > 0 ? GAP : 0;
      if (y + gap + b.h > colH(page)) {
        // Doesn't fit what's left of the column: start a new one if the
        // section would fit there whole, or if only a scrap is left here.
        if (y > 0 && (b.h <= colH(page) || colH(page) - y - gap < 3 * LEAD)) next();
        else y += gap;
      } else y += gap;
      b.items.forEach(it => {
        const h = it.blank ? BLANK : LEAD;
        if (y + h > colH(page) + 1e-6) {
          next();
          if (it.blank) return;
        }
        if (!it.blank) placed.push({ page, col, y, it });
        y += h;
      });
    });
    const pages = placed.length ? placed[placed.length - 1].page + 1 : 1;
    const score = size - WRAP_COST * (wraps / Math.max(1, lines));
    return { size, cols, colW, pages, placed, top, score, wraps: wraps / Math.max(1, lines) };
  }

  // The best-scoring layout on one page, unless that needs tiny type and two
  // pages read clearly better. A score never beats its size, so the search
  // stops once the sizes left can't win.
  function bestLayout(p) {
    let one = null, two = null;
    for (let size = MAX_SIZE; size >= MIN_SIZE - 1e-9; size -= STEP) {
      if (one && size < one.score) break;
      for (let cols = 1; cols <= 3; cols++) {
        const L = layout(p, size, cols);
        if (!L) continue;
        if (L.pages === 1 && (!one || L.score > one.score)) one = L;
        if (L.pages === 2 && (!two || L.score > two.score)) two = L;
      }
    }
    if (one && (one.size >= ONE_PAGE_MIN || !two || two.score - one.score < TWO_PAGE_GAIN)) return one;
    if (two) return two;
    // Longer than two pages even at the smallest type: let it run on rather
    // than drop lines.
    return layout(p, MIN_SIZE, 3, true);
  }

  // ---- drawing -------------------------------------------------------------

  // Draws the song from the current page on; returns how many pages it took.
  function drawLines(doc, p, L) {
    const { size, colW } = L;
    let current = 0;
    drawHeader(doc, p.header, 0, p.song.title);
    L.placed.forEach(({ page, col, y, it }) => {
      while (page > current) {
        doc.addPage();
        current++;
        drawHeader(doc, p.header, current, p.song.title);
      }
      const x0 = MX + col * (colW + COL_GAP);
      const base = L.top(page) + (y + BASELINE) * size;
      if (it.label) {
        doc.setFont(FONT, 'bold');
        doc.setFontSize(size);
        doc.text(it.label, x0, base);
      }
      let x = x0 + (it.indent + (it.hang ? HANG : 0)) * size;
      // Words and spaces of one weight go out as one string.
      let run = '', runBold = false, runX = x;
      const flush = () => {
        if (!run) return;
        doc.setFont(FONT, runBold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.text(run, runX, base);
        run = '';
      };
      it.units.forEach(u => u.toks.forEach(t => {
        if (t.kind === 'mono') {
          flush();
          doc.setFont('courier', 'normal');
          doc.setFontSize(size * MONO * it.scale);
          doc.text(t.s, x, base);
          x += t.w * size * it.scale;
          return;
        }
        if (t.kind === 'chord') {
          flush();
          doc.setFillColor(HIGHLIGHT);
          doc.roundedRect(x, base - BOX_UP * size, t.w * size, (BOX_UP + BOX_DOWN) * size, BOX_R * size, BOX_R * size, 'F');
          doc.setFont(FONT, 'bold');
          doc.setFontSize(size);
          doc.text(t.s, x + PAD * size, base);
        } else {
          const bold = !!t.bold;
          if (run && bold !== runBold) flush();
          if (!run) { runX = x; runBold = bold; }
          run += t.s;
        }
        x += t.w * size;
      }));
      flush();
    });
    return current + 1;
  }

  function drawFooter(doc, n) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(0);
    doc.text('Bekovy songy', MX, FOOT_BASE);
    doc.text(String(n), PAGE_W - MX, FOOT_BASE, { align: 'right' });
  }

  // ---- contents ------------------------------------------------------------

  const TOC = { cols: 3, size: 9, lead: 12.5, letterGap: 7, top1: MTOP + 92, top: MTOP + 6 };

  function letterOf(title) {
    const t = title.trim();
    if (/^ch/i.test(t)) return 'Ch';
    const c = t.charAt(0).toUpperCase();
    if ('ČŘŠŽ'.includes(c)) return c;
    const base = c.normalize('NFD').charAt(0);
    return /[A-Z]/.test(base) ? base : '#';
  }

  // Contents lines (letter heads and entries) flowed into columns; returns
  // the page count and where each line goes.
  function tocLayout(entries) {
    const colW = (W - (TOC.cols - 1) * COL_GAP) / TOC.cols;
    const placed = [];
    let page = 0, col = 0, y = 0, letter = null;
    const top = (pg) => (pg === 0 ? TOC.top1 : TOC.top);
    const room = (pg) => BODY_BOTTOM - top(pg);
    const next = () => { col++; y = 0; if (col === TOC.cols) { col = 0; page++; } };
    entries.forEach(e => {
      const l = letterOf(e.title);
      if (l !== letter) {
        letter = l;
        const need = (y > 0 ? TOC.letterGap : 0) + TOC.lead * 2;
        if (y + need > room(page)) next();
        if (y > 0) y += TOC.letterGap;
        placed.push({ page, col, y, head: l });
        y += TOC.lead;
      }
      if (y + TOC.lead > room(page)) next();
      placed.push({ page, col, y, e });
      y += TOC.lead;
    });
    return { pages: page + 1, placed, colW, top };
  }

  function drawToc(doc, toc, count, date) {
    doc.setTextColor(0);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(30);
    doc.text('Bekovy songy', MX, MTOP + 26);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(11);
    doc.text(`Zpěvník s akordy · ${count} ${count === 1 ? 'píseň' : count < 5 ? 'písně' : 'písní'} · ${date}`, MX, MTOP + 48);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(14);
    doc.text('Obsah', MX, MTOP + 76);

    let current = 0;
    toc.placed.forEach(({ page, col, y, head, e }) => {
      while (page > current) { doc.addPage(); current++; }
      const x = MX + col * (toc.colW + COL_GAP);
      const base = toc.top(page) + y + TOC.size;
      if (head) {
        doc.setFont(FONT, 'bold');
        doc.setFontSize(TOC.size + 1);
        doc.text(head, x, base);
        return;
      }
      doc.setFont(FONT, 'normal');
      doc.setFontSize(TOC.size);
      const num = String(e.page);
      const numW = doc.getTextWidth(num);
      let title = e.title;
      const room = toc.colW - numW - 8;
      if (doc.getTextWidth(title) > room) {
        while (title.length > 1 && doc.getTextWidth(title + '…') > room) title = title.slice(0, -1);
        title = title.trimEnd() + '…';
      }
      doc.text(title, x, base);
      doc.text(num, x + toc.colW, base, { align: 'right' });
      doc.link(x, base - TOC.size, toc.colW, TOC.lead, { pageNumber: e.page });
    });
  }

  // ---- the book --------------------------------------------------------------

  async function build(songs, opts) {
    const onProgress = (opts && opts.onProgress) || (() => {});
    const signal = opts && opts.signal;
    const stop = () => { if (signal && signal.aborted) throw new DOMException('Zrušeno', 'AbortError'); };

    onProgress({ stage: 'load', done: 0, total: songs.length });
    const { JsPDF, regular, bold } = await loadLibs();
    stop();

    const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
    doc.addFileToVFS('Figtree-Regular.ttf', regular);
    doc.addFont('Figtree-Regular.ttf', FONT, 'normal');
    doc.addFileToVFS('Figtree-Bold.ttf', bold);
    doc.addFont('Figtree-Bold.ttf', FONT, 'bold');
    doc.setProperties({ title: 'Bekovy songy – zpěvník', subject: 'Zpěvník s akordy', creator: 'bekovysongy.cz' });

    const widths = new Map();
    // style: false regular, true bold, 'mono' Courier (tablature).
    const measure = (s, style) => {
      const key = (style === 'mono' ? 'm' : style ? 'b' : 'r') + s;
      let w = widths.get(key);
      if (w === undefined) {
        if (style === 'mono') doc.setFont('courier', 'normal');
        else doc.setFont(FONT, style ? 'bold' : 'normal');
        w = doc.getStringUnitWidth(s);
        widths.set(key, w);
      }
      return w;
    };

    // Fetch the songs, a few at a time.
    const texts = new Array(songs.length);
    const failed = [];
    let fetched = 0, nextIdx = 0;
    async function worker() {
      while (nextIdx < songs.length) {
        const i = nextIdx++;
        try { texts[i] = await fetchText(songs[i].slug, signal); } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          texts[i] = null;
        }
        fetched++;
        onProgress({ stage: 'fetch', done: fetched, total: songs.length });
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, songs.length) }, worker));
    stop();

    // Lay every song out before drawing anything: the contents need the
    // page numbers.
    const book = [];
    songs.forEach((song, i) => {
      if (texts[i] == null) { failed.push(song.title); return; }
      const p = prepare(song, sectionsOf(texts[i]), measure, doc);
      book.push({ p, L: bestLayout(p) });
      if (i % 20 === 0) onProgress({ stage: 'layout', done: i + 1, total: songs.length });
    });
    stop();
    if (!book.length) throw new Error('Žádnou píseň se nepodařilo načíst.');

    const withToc = book.length > 3;
    let toc = null;
    let first = 1;
    if (withToc) {
      // Contents pages first; their count moves every song's page number.
      let tocPages = 1;
      for (let guess = 0; guess < 3; guess++) {
        let pg = tocPages + 1;
        const entries = book.map(b => { const e = { title: b.p.song.title, page: pg }; pg += b.L.pages; return e; });
        toc = tocLayout(entries);
        if (toc.pages === tocPages) break;
        tocPages = toc.pages;
      }
      first = toc.pages + 1;
      const date = new Date().toLocaleDateString('cs-CZ');
      drawToc(doc, toc, book.length, date);
    }

    let page = first;
    book.forEach((b, i) => {
      if (page > 1) doc.addPage();
      const start = page;
      page += drawLines(doc, b.p, b.L);
      doc.outline.add(null, b.p.song.title, { pageNumber: start });
      if (i % 10 === 0) onProgress({ stage: 'draw', done: i + 1, total: book.length });
    });

    const pages = doc.getNumberOfPages();
    for (let n = 1; n <= pages; n++) {
      doc.setPage(n);
      drawFooter(doc, n);
    }
    onProgress({ stage: 'done', done: book.length, total: book.length });
    const layouts = book.map(b => ({ slug: b.p.song.slug, size: b.L.size, cols: b.L.cols, pages: b.L.pages, wraps: b.L.wraps }));
    return { blob: doc.output('blob'), pages, failed, layouts };
  }

  window.SongbookPdf = { build };
})();
