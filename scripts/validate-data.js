#!/usr/bin/env node
'use strict';
/**
 * Cross-checks songs.json against songs/*.html and scans for known-bad data
 * patterns. Run before deploy: `node scripts/validate-data.js`.
 * Exits 0 if clean, 1 if any check fails.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SONGS_JSON = path.join(ROOT, 'songs.json');
const SONGS_DIR = path.join(ROOT, 'songs');

// Pre-existing, already-tracked data issues that don't block CI. Keep this
// list narrow and named per-file - it's for known debt, not a way to silence
// new failures. Remove an entry once the underlying song is fixed.
const KNOWN_ISSUES = {
  'frantiskovy-lazne.html': ['stray "®" character'],
};

const errors = [];
const warnings = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

// Route a failure to a warning instead of an error if it matches a known,
// already-tracked issue for that file.
function failUnlessKnown(file, shortDesc, msg) {
  const known = KNOWN_ISSUES[file] || [];
  if (known.includes(shortDesc)) {
    warn(`${msg} (known issue, tracked separately)`);
  } else {
    fail(msg);
  }
}

// === Load songs.json ===
let data;
try {
  data = JSON.parse(fs.readFileSync(SONGS_JSON, 'utf-8'));
} catch (e) {
  console.error('FATAL: could not read/parse songs.json:', e.message);
  process.exit(1);
}
const songs = data.songs || [];

// === Duplicate slug check ===
const seenSlugs = new Map();
for (const s of songs) {
  if (seenSlugs.has(s.slug)) {
    fail(`Duplicate slug in songs.json: "${s.slug}" (${seenSlugs.get(s.slug)} and ${s.title})`);
  }
  seenSlugs.set(s.slug, s.title);
}

// === songs.json -> file existence ===
for (const s of songs) {
  const fp = path.join(SONGS_DIR, `${s.slug}.html`);
  if (!fs.existsSync(fp)) {
    fail(`songs.json references "${s.slug}" but songs/${s.slug}.html does not exist`);
  }
}

// === songs/*.html -> songs.json entry existence (orphan files) ===
const htmlFiles = fs.readdirSync(SONGS_DIR).filter(f => f.endsWith('.html'));
const jsonSlugs = new Set(songs.map(s => s.slug));
for (const f of htmlFiles) {
  const slug = f.slice(0, -'.html'.length);
  if (!jsonSlugs.has(slug)) {
    fail(`songs/${f} exists but has no entry in songs.json`);
  }
}

// === Known-bad chord data patterns (regressions this project has hit before) ===
const BAD_CHORD_RE = /data-chord="([/#.,;]?|mi7?)"/g; // single punctuation or a bare "mi"/"mi7" leftover
const MOJIBAKE_RE = /Ã.|â€./;
const STRAY_MARKER_RE = /®/;

for (const f of htmlFiles) {
  const fp = path.join(SONGS_DIR, f);
  const content = fs.readFileSync(fp, 'utf-8');

  let m;
  BAD_CHORD_RE.lastIndex = 0;
  while ((m = BAD_CHORD_RE.exec(content)) !== null) {
    fail(`songs/${f}: suspicious chord data-chord="${m[1]}" (looks like a split/corrupted chord span)`);
  }

  if (MOJIBAKE_RE.test(content)) {
    fail(`songs/${f}: contains a mojibake byte sequence (double-encoded UTF-8, e.g. "Ã¡")`);
  }

  if (STRAY_MARKER_RE.test(content)) {
    failUnlessKnown(f, 'stray "®" character',
      `songs/${f}: contains a stray "®" character (should be a recognized R:/S:/B: marker or removed)`);
  }

  // Basic structural sanity: exactly one <h1>, one <pre class="song-text">, a <title>.
  const h1Count = (content.match(/<h1>/g) || []).length;
  const preCount = (content.match(/<pre class="song-text">/g) || []).length;
  const hasTitleTag = /<title>.*<\/title>/.test(content);
  if (h1Count !== 1) fail(`songs/${f}: expected exactly one <h1>, found ${h1Count}`);
  if (preCount !== 1) fail(`songs/${f}: expected exactly one <pre class="song-text">, found ${preCount}`);
  if (!hasTitleTag) fail(`songs/${f}: missing <title> tag`);
}

// === songs.json field sanity ===
for (const s of songs) {
  if (!s.title || !s.title.trim()) fail(`songs.json: "${s.slug}" has an empty title`);
  if (!Array.isArray(s.chords)) fail(`songs.json: "${s.slug}" is missing a chords array`);
  if (!s.tags || typeof s.tags.language !== 'string') warn(`songs.json: "${s.slug}" has no tags.language`);
  if ('checked' in s && typeof s.checked !== 'boolean') fail(`songs.json: "${s.slug}" has a non-boolean "checked" field`);

  // progression is optional (omitted for chordless songs), but when present
  // must be a non-empty array of non-empty arrays of non-empty strings -
  // e.g. [["G","C","Emi"],["Ami","C","G","D"]].
  if ('progression' in s) {
    const p = s.progression;
    if (!Array.isArray(p) || p.length === 0) {
      fail(`songs.json: "${s.slug}" has an invalid "progression" (must be a non-empty array of groups)`);
    } else {
      p.forEach((group, gi) => {
        if (!Array.isArray(group) || group.length === 0) {
          fail(`songs.json: "${s.slug}" progression group ${gi} must be a non-empty array of chords`);
          return;
        }
        group.forEach((chord, ci) => {
          if (typeof chord !== 'string' || !chord.trim()) {
            fail(`songs.json: "${s.slug}" progression group ${gi} chord ${ci} must be a non-empty string`);
          }
        });
      });
    }
  }
}

// === Report ===
console.log(`Checked ${songs.length} songs.json entries and ${htmlFiles.length} songs/*.html files.`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  warnings.forEach(w => console.log('  - ' + w));
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  errors.forEach(e => console.log('  - ' + e));
  process.exit(1);
}
console.log('\nAll checks passed.');
