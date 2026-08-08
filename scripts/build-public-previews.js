#!/usr/bin/env node
/**
 * build-public-previews.js - the songbook's slice of song-previews.json.
 *
 * Run at deploy time (like build-search-index.js), writing a slug -> preview
 * URL map to stdout. Two filters, both deliberate:
 *
 *   - only match: 'exact'   - title AND performer matched. A cover is fine
 *     for recognising a tune while triaging drafts, but a visitor tapping ▶
 *     on a song page expects that song, and the automatic title-only fallback
 *     is where the genuinely wrong matches live ("Placky" -> "Plačky").
 *     Hand-picked entries ("locked") count as exact - a human chose them.
 *   - only published songs  - drafts have no page to play them from.
 *
 * The result is a fraction of the full file's size, which matters: every song
 * page fetches it, and this is a songbook people open on phone data.
 *
 *   node scripts/build-public-previews.js > _site/song-previews-public.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRAFT_STATUSES = ['navrh', 'k-vytvoreni'];

const songs = JSON.parse(fs.readFileSync(path.join(ROOT, 'songs.json'), 'utf8')).songs;

let full = {};
try {
  full = JSON.parse(fs.readFileSync(path.join(ROOT, 'song-previews.json'), 'utf8')).previews || {};
} catch (e) {
  // Not generated yet - emit an empty map so the deploy still succeeds and the
  // player bar simply shows no ▶.
  process.stderr.write('song-previews.json chybí nebo je poškozený – prázdná mapa\n');
}

const previews = {};
songs
  .filter(s => !DRAFT_STATUSES.includes(s.status))
  .forEach(s => {
    const hit = full[s.slug];
    if (!hit || !hit.url) return;
    if (hit.match !== 'exact' && !hit.locked) return;
    previews[s.slug] = hit.url;
  });

process.stdout.write(JSON.stringify({
  generated: new Date().toISOString(),
  previews
}) + '\n');

const published = songs.filter(s => !DRAFT_STATUSES.includes(s.status)).length;
process.stderr.write(
  `song-previews-public: ${Object.keys(previews).length}/${published} písní `
  + `(${Math.round(Object.keys(previews).length / published * 100)}%)\n`
);
