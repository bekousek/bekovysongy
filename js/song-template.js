/**
 * song-template.js - New-song HTML generation + slug helpers for the admin editor.
 *
 * slugify()/uniqueSlug() are a faithful JS port of the Python helpers in
 * transfer_songs.py (ř. 101-128), used there to seed songs/*.html from
 * external sources and here to name brand-new songs created in /admin.
 *
 * generateSongHtml() mirrors transfer_songs.py's generate_song_html() and the
 * committed songs/andel.html template byte-for-byte, aside from the
 * interpolated title/author/capo/body/slug and where the editor's behavior
 * wins over the (older) Python script: capo is rendered as "Capo N" (not a
 * bare "Capo"). The page is only the head, the song and the scripts: the old
 * nav and #player-bar are gone (2026-11) - js/player.js builds all the
 * chrome, the bug-report mailto included, and scripts/strip-song-chrome.js
 * took them out of the existing pages.
 *
 * Browser: window.SongTemplate. Node: module.exports (for tests, and for
 * js/editor.js which loads this as a plain <script> before itself).
 */
(function (global) {
  'use strict';

  // Diacritics that NFKD decomposition does NOT reduce to base+combining-mark
  // (they're distinct letters, not precomposed accents) - ported verbatim
  // from transfer_songs.py's _TRANSLIT map, including its gaps (no uppercase
  // Æ/Œ entries there either).
  var TRANSLIT = { 'ł': 'l', 'Ł': 'l', 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe' };
  var TRANSLIT_RE = /[łŁøßæœ]/g;

  // Combining Diacritical Marks block (U+0300-U+036F), built from numeric
  // char codes rather than a \u-escape literal to avoid any transcription
  // risk with the raw combining characters themselves.
  var COMBINING_MARKS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

  function stripDiacritics(text) {
    var replaced = text.replace(TRANSLIT_RE, function (ch) { return TRANSLIT[ch]; });
    return replaced.normalize('NFKD').replace(COMBINING_MARKS_RE, '');
  }

  // Port of transfer_songs.py:slugify (ř. 110-118).
  function slugify(title) {
    var s = stripDiacritics(String(title == null ? '' : title)).toLowerCase();
    s = s.replace(/[^a-z0-9]+/g, '-');
    s = s.replace(/^-+|-+$/g, '');
    s = s.replace(/-{2,}/g, '-');
    if (!s) s = 'song';
    if (/^[0-9]/.test(s)) s = 'a' + s;
    return s;
  }

  // Port of transfer_songs.py:unique_slug (ř. 121-128). Mutates `taken`
  // (adds the returned slug), same as the Python version.
  function uniqueSlug(base, taken) {
    var slug = base;
    var n = 2;
    while (taken.has(slug)) {
      slug = base + '-' + n;
      n += 1;
    }
    taken.add(slug);
    return slug;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Generates a full songs/<slug>.html page, matching songs/andel.html aside
  // from the interpolated pieces below. `capo` is an int (0 = none).
  //
  // IMPORTANT: the song-header block keeps the exact 4-space indent on
  // </div> and <pre> that js/editor.js's save-time regexes anchor on (the
  // literal '</div>\n    <pre' author-insert match, and the capo-insert
  // regex /(\s*)(    <\/div>\s*\n\s*<pre class="song-text">)/) - don't
  // reflow this block's whitespace.
  function generateSongHtml(opts) {
    opts = opts || {};
    var title = opts.title || '';
    var author = opts.author || '';
    var capo = opts.capo || 0;
    var body = opts.body || '';
    var slug = opts.slug || '';

    var escTitle = escapeHtml(title);
    var ogTitle = escTitle + ' - Bekovy songy';
    var authorP = author ? '<p class="song-author">' + escapeHtml(author) + '</p>' : '';
    var capoP = capo ? '<p class="song-capo">Capo ' + capo + '</p>' : '';
    var by = author ? ' od ' + author : '';
    var description = escapeHtml('Akordy a text písně ' + title + by + '. Transpozice, capo, ladička a metronom na Bekovy songy.');
    var canonical = 'https://bekovysongy.cz/songs/' + slug + '.html';

    return '<!DOCTYPE html>\n' +
      '<html lang="cs">\n' +
      '<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>' + ogTitle + '</title>\n' +
      '  <meta name="description" content="' + description + '">\n' +
      '  <link rel="canonical" href="' + canonical + '">\n' +
      '  <meta property="og:type" content="music.song">\n' +
      '  <meta property="og:url" content="' + canonical + '">\n' +
      '  <meta property="og:title" content="' + ogTitle + '">\n' +
      '  <meta property="og:description" content="' + description + '">\n' +
      '  <meta property="og:site_name" content="Bekovy songy">\n' +
      '  <meta property="og:image" content="https://bekovysongy.cz/assets/og-image.png">\n' +
      '  <meta property="og:image:width" content="1200">\n' +
      '  <meta property="og:image:height" content="630">\n' +
      '  <meta property="og:image:alt" content="Bekovy songy — zpěvník s akordy">\n' +
      '  <meta name="twitter:card" content="summary_large_image">\n' +
      '  <meta name="twitter:image" content="https://bekovysongy.cz/assets/og-image.png">\n' +
      '  <meta name="twitter:title" content="' + ogTitle + '">\n' +
      '  <meta name="twitter:description" content="' + description + '">\n' +
      '  <link rel="icon" type="image/svg+xml" href="../assets/favicon.svg">\n' +
      '  <link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">\n' +
      '  <link rel="manifest" href="../manifest.json">\n' +
      '  <meta name="theme-color" content="#0e0d0c">\n' +
      '  <link rel="stylesheet" href="../css/style.css">\n' +
      '  <script type="application/ld+json">' + songJsonLd({ title: title, author: author, slug: slug }) + '</script>\n' +
      '</head>\n' +
      '<body>\n' +
      '  <main class="song-page">\n' +
      '    <div class="song-header">\n' +
      '      <h1>' + escTitle + '</h1>\n' +
      '      ' + authorP + '\n' +
      '      ' + capoP + '\n' +
      '    </div>\n' +
      '    <pre class="song-text">' + body + '</pre>\n' +
      '  </main>\n' +
      '\n' +
      '  <script src="../js/chords.js"></script>\n' +
      '  <script src="../js/sections.js"></script>\n' +
      '  <script src="../js/chord-theory.js"></script>\n' +
      '  <script src="../js/player.js"></script>\n' +
      '</body>\n' +
      '</html>';
  }

  // JSON-LD pro stranku pisne. Vlastni funkce proto, ze ji js/editor.js
  // po prejmenovani pisne prepisuje stejne jako <title>.
  function songJsonLd(opts) {
    opts = opts || {};
    var data = {
      '@context': 'https://schema.org',
      '@type': 'MusicComposition',
      name: opts.title || '',
      url: 'https://bekovysongy.cz/songs/' + (opts.slug || '') + '.html',
      inLanguage: 'cs'
    };
    // "author" v songs.json je interpret, ne skladatel - proto visi na
    // nahravce, a ne na composer/lyricist.
    if (opts.author) {
      data.recordedAs = {
        '@type': 'MusicRecording',
        byArtist: { '@type': 'MusicGroup', name: opts.author }
      };
    }
    return JSON.stringify(data).replace(/</g, '\\u003c');
  }

  var api = {
    slugify: slugify,
    uniqueSlug: uniqueSlug,
    generateSongHtml: generateSongHtml,
    songJsonLd: songJsonLd,
    escapeHtml: escapeHtml
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof global !== 'undefined') global.SongTemplate = api;
})(typeof self !== 'undefined' ? self : this);
