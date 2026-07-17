#!/usr/bin/env node
'use strict';
/**
 * Backfills songs.json's per-song "progression" field (chords grouped by
 * section, e.g. [["G","C","Emi"],["Ami","C","G","D"],["F","B","Dmi"]]) by
 * deriving it from each song's own songs/<slug>.html via
 * SongSections.deriveProgression() (js/sections.js - the same algorithm the
 * top chord bar falls back to on song pages, and the admin's ↻ button uses).
 * The flat "chords" field is untouched either way.
 *
 * Default: fills only entries that don't already have a "progression" field,
 * so manual edits made in the admin survive a re-run (e.g. after adding new
 * songs via transfer_songs.py, run this again to backfill just those).
 *
 * Usage:
 *   node scripts/backfill-progression.js            # fill missing, write
 *   node scripts/backfill-progression.js --dry-run  # stats only, no write
 *   node scripts/backfill-progression.js --force    # recompute + overwrite all
 */
const fs = require('fs');
const path = require('path');
const SongSections = require('../js/sections.js');

const ROOT = path.join(__dirname, '..');
const SONGS_JSON = path.join(ROOT, 'songs.json');
const SONGS_DIR = path.join(ROOT, 'songs');
const PRE_RE = /<pre class="song-text">([\s\S]*?)<\/pre>/;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

const data = JSON.parse(fs.readFileSync(SONGS_JSON, 'utf-8'));
const songs = data.songs || [];

let skippedExisting = 0;
let missingFile = 0;
let missingPre = 0;
let gained = 0;
let emptyDerived = 0;
const samples = [];

for (const song of songs) {
  if (!force && Array.isArray(song.progression) && song.progression.length) {
    skippedExisting++;
    continue;
  }

  const file = path.join(SONGS_DIR, `${song.slug}.html`);
  if (!fs.existsSync(file)) {
    missingFile++;
    console.warn(`skip ${song.slug}: songs/${song.slug}.html not found`);
    continue;
  }

  const html = fs.readFileSync(file, 'utf-8');
  const m = html.match(PRE_RE);
  if (!m) {
    missingPre++;
    console.warn(`skip ${song.slug}: no <pre class="song-text"> found`);
    continue;
  }

  const progression = SongSections.deriveProgression(m[1]);
  if (progression.length) {
    song.progression = progression;
    gained++;
    if (samples.length < 8) {
      samples.push(`${song.slug}: ${SongSections.progressionToText(progression)}`);
    }
  } else {
    emptyDerived++;
    delete song.progression; // no chords at all -> field stays omitted
  }
}

console.log(`Songs total: ${songs.length}`);
if (!force) console.log(`Already had progression (skipped): ${skippedExisting}`);
console.log(`Gained/updated progression: ${gained}`);
console.log(`No chords (progression left unset): ${emptyDerived}`);
if (missingFile) console.log(`Missing HTML file: ${missingFile}`);
if (missingPre) console.log(`Missing <pre class="song-text">: ${missingPre}`);

if (samples.length) {
  console.log('\nSamples:');
  samples.forEach((s) => console.log(`  ${s}`));
}

// Acceptance check: always re-derive this one song straight from its HTML
// (independent of the skip/force logic above) so this line is meaningful
// no matter how the script was invoked.
const watchedSlug = 'a1-signalni';
const watchedFile = path.join(SONGS_DIR, `${watchedSlug}.html`);
let watchedLine = '(file not found)';
if (fs.existsSync(watchedFile)) {
  const wm = fs.readFileSync(watchedFile, 'utf-8').match(PRE_RE);
  watchedLine = wm
    ? SongSections.progressionToText(SongSections.deriveProgression(wm[1]))
    : '(no <pre class="song-text"> found)';
}
console.log(`\n${watchedSlug}: ${watchedLine}`);

if (dryRun) {
  console.log('\n--dry-run: no files written.');
  process.exit(0);
}

fs.writeFileSync(SONGS_JSON, JSON.stringify(data, null, 2));
console.log(`\nWrote ${SONGS_JSON}`);
