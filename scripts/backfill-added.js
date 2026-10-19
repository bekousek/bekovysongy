#!/usr/bin/env node
'use strict';
/**
 * Backfills songs.json's per-song "added" field: the day a song first became
 * visible on the site, i.e. reached "ke kontrole" or "zkontrolováno" (a návrh
 * or k vytvoření has no page, so it doesn't count). /admin stamps the field on
 * the save that publishes a song; this fills in whatever is still missing:
 *
 *   - from git: the first commit whose songs.json lists the slug as public,
 *     following renames of songs/<slug>.html, as a Europe/Prague date;
 *   - with --from <file.json> ({ "slug": "YYYY-MM-DD", ... }) that date first,
 *     capped at the git one. Used once for the songs that predate this repo -
 *     they came over from the old Webnode site in the first commit, so git
 *     only knows the import day.
 *
 * Only fills entries that have no "added" yet, so dates set by /admin or by
 * hand survive a re-run.
 *
 * Usage:
 *   node scripts/backfill-added.js                    # fill missing from git, write
 *   node scripts/backfill-added.js --dry-run          # stats only, no write
 *   node scripts/backfill-added.js --from dates.json  # outside dates first
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SONGS_JSON = path.join(ROOT, 'songs.json');
const DRAFT_STATUSES = ['navrh', 'k-vytvoreni'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromAt = args.indexOf('--from');
const outside = fromAt !== -1 ? JSON.parse(fs.readFileSync(args[fromAt + 1], 'utf-8')) : {};

const isPublic = (s) => !DRAFT_STATUSES.includes(s.status);

function git(...argv) {
  return execFileSync('git', argv, { cwd: ROOT, maxBuffer: 1 << 28 }).toString();
}

function pragueDate(iso) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
}

// slug -> earliest date it was public in a committed songs.json
function firstPublicDates() {
  const first = {};
  const commits = git('log', '--reverse', '--format=%H %cI', '--', 'songs.json')
    .trim().split('\n').map(line => line.split(' '));
  for (const [hash, iso] of commits) {
    const data = JSON.parse(git('show', `${hash}:songs.json`));
    const songs = Array.isArray(data) ? data : data.songs;
    for (const s of songs) {
      if (isPublic(s) && !(s.slug in first)) first[s.slug] = pragueDate(iso);
    }
  }
  return first;
}

// new slug -> old slug, from renamed song pages (e.g. a typo fixed in the
// slug) - the song was on the site under its old name before that.
function previousSlugs() {
  const prev = {};
  const log = git('log', '--diff-filter=R', '-M', '--name-status', '--format=', '--', 'songs/');
  for (const line of log.split('\n')) {
    const m = line.match(/^R\d*\tsongs\/(.+)\.html\tsongs\/(.+)\.html$/);
    if (m) prev[m[2]] = m[1];
  }
  return prev;
}

const raw = fs.readFileSync(SONGS_JSON, 'utf-8').replace(/\r\n/g, '\n');
const data = JSON.parse(raw);
if (JSON.stringify(data, null, 2) !== raw) {
  console.error('songs.json does not round-trip through JSON.stringify(data, null, 2) - refusing to rewrite it.');
  process.exit(1);
}

const first = firstPublicDates();
const prev = previousSlugs();

function gitDate(slug) {
  let best = null;
  const seen = new Set();
  for (let s = slug; s && !seen.has(s); s = prev[s]) {
    seen.add(s);
    if (first[s] && (!best || first[s] < best)) best = first[s];
  }
  return best;
}

const counts = { had: 0, outside: 0, git: 0, unknown: 0 };
for (const song of data.songs) {
  if (!isPublic(song)) continue;
  if (song.added) { counts.had++; continue; }

  const fromGit = gitDate(song.slug);
  const fromOutside = outside[song.slug];
  let date = fromGit;
  if (fromOutside && (!fromGit || fromOutside < fromGit)) date = fromOutside;

  if (!date) {
    counts.unknown++;
    console.warn(`skip ${song.slug}: not public in any commit yet (commit it first)`);
    continue;
  }
  song.added = date;
  counts[date === fromGit ? 'git' : 'outside']++;
}

console.log(`Already had "added": ${counts.had}`);
console.log(`Filled from --from: ${counts.outside}`);
console.log(`Filled from git:    ${counts.git}`);
if (counts.unknown) console.log(`Left without a date: ${counts.unknown}`);

if (dryRun) {
  console.log('\n--dry-run: songs.json not written.');
} else {
  fs.writeFileSync(SONGS_JSON, JSON.stringify(data, null, 2));
  console.log('\nsongs.json written.');
}
