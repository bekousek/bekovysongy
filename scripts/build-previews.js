#!/usr/bin/env node
/**
 * build-previews.js - resolves a 30s audio preview for every draft song.
 *
 * Triaging a few hundred návrhy means listening to each one first, and most
 * of them say nothing by title alone. This walks the drafts in songs.json,
 * asks the iTunes Search API for each, and writes song-previews.json, which
 * the admin sidebar plays inline (js/song-preview.js).
 *
 * The API is free, needs no key and sends CORS headers, so this could also
 * run in the browser - it doesn't, deliberately. Resolving once at build time
 * makes playback instant, survives Apple being slow or down, and keeps the
 * matches reviewable in git instead of re-guessing them on every page load.
 *
 * Two passes per song, because a naive "title + interpret" query misses a
 * good chunk of the Czech repertoire:
 *   1. title + interpret  -> match: 'exact'  (right song, right performer)
 *   2. title alone        -> match: 'title'  (right song, usually a cover)
 * A cover is fine for triage - the point is to recognise the melody - but the
 * UI marks those so a different voice isn't a surprise.
 *
 * Results are only accepted if the returned track title actually resembles
 * the one asked for; without that check the API happily answers an unknown
 * song with something entirely unrelated.
 *
 * Resumable: songs already in song-previews.json are skipped and the file is
 * flushed as it goes, so hitting the API's rate limit costs only the songs
 * not yet reached. Re-run it to pick up where it stopped.
 *
 *   node scripts/build-previews.js            # only songs not resolved yet
 *   node scripts/build-previews.js --recheck  # also retry previous misses
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SONGS_JSON = path.join(ROOT, 'songs.json');
const OUT_JSON = path.join(ROOT, 'song-previews.json');

const DRAFT_STATUSES = ['navrh', 'k-vytvoreni'];
const MAX_RETRIES = 4;

// The search API throttles somewhere around 20 requests a minute and stays
// cross once provoked. A fixed delay either wastes an hour being timid or -
// as the first run of this script did - clears its per-song backoff, walks
// straight back into the limit and spends longer waiting than working.
// So pacing is global and adaptive: start brisk, and every throttle
// permanently slows the rest of the run.
const MIN_DELAY_MS = 1100;
const MAX_DELAY_MS = 6000;
let delayMs = MIN_DELAY_MS;

function slowDown() {
  delayMs = Math.min(MAX_DELAY_MS, Math.round(delayMs * 1.4));
}

const recheck = process.argv.includes('--recheck');

// === Matching helpers ===

// Combining Diacritical Marks block (U+0300-U+036F), built from numeric char
// codes rather than a \u-escape literal, same as js/song-template.js - a
// literal range here is the raw combining characters and doesn't survive
// being read or edited as text.
const COMBINING_MARKS_RE = new RegExp(
  '[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'
);

// Lowercase, strip diacritics and punctuation, drop any trailing bracketed
// qualifier ("(Live Acoustic Version)", "[Remastered]"). Both sides of every
// comparison go through this.
function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '')
    .toLowerCase()
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Titles count as the same song when one is a prefix of the other - that
// covers "Mississippi Blues" vs "Mississippi Blues (Charlie)" without letting
// two unrelated songs match on a shared first word.
function titlesMatch(want, got) {
  const a = normalize(want);
  const b = normalize(got);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 4) return false;
  return longer.startsWith(shorter + ' ') || longer === shorter;
}

// songs.json holds interprets as one display string ("Suchý & Šlitr",
// "Zdeněk Svěrák a Jaroslav Uhlíř"); the API answers with its own combined
// credit. One name in common is enough.
function splitAuthors(author) {
  return String(author || '')
    .split(/[,&+\/]| a | feat\.? | ft\.? /i)
    .map(normalize)
    .filter(a => a.length >= 3);
}

function artistsMatch(author, artistName) {
  const want = splitAuthors(author);
  if (!want.length) return false;
  const got = normalize(artistName);
  if (!got) return false;
  return want.some(a => got.includes(a) || a.includes(got));
}

// === API ===

async function search(term) {
  const url = 'https://itunes.apple.com/search?media=music&entity=song&limit=5&country=CZ'
    + '&term=' + encodeURIComponent(term);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 403 || res.status === 429) {
        // Rate limited - back off and try again rather than recording a miss
        // we'd have to re-check later, and slow every later request too.
        slowDown();
        const wait = 5000 * Math.pow(2, attempt);
        process.stderr.write(`  … rate limit, čekám ${wait / 1000}s (tempo ${delayMs}ms)\n`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) return null;
      const json = await res.json();
      return Array.isArray(json.results) ? json.results : [];
    } catch (e) {
      if (attempt === MAX_RETRIES) return null;
      await sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Best usable hit: prefers one whose performer also matches, else the first
// result whose title matches. Returns null when nothing plausible came back.
function pickResult(results, title, author) {
  if (!results || !results.length) return null;
  const usable = results.filter(r => r.previewUrl && titlesMatch(title, r.trackName));
  if (!usable.length) return null;
  const sameArtist = author ? usable.find(r => artistsMatch(author, r.artistName)) : null;
  const hit = sameArtist || usable[0];
  return {
    url: hit.previewUrl,
    track: hit.trackName,
    artist: hit.artistName,
    match: sameArtist ? 'exact' : 'title'
  };
}

async function resolveSong(song) {
  const author = (song.author || '').trim();

  if (author) {
    const hit = pickResult(await search(song.title + ' ' + author), song.title, author);
    if (hit) return hit;
    await sleep(delayMs);
  }

  // Fallback: title alone. Often finds the song under a different performer,
  // which still answers "do I know this one?".
  return pickResult(await search(song.title), song.title, author);
}

// === Main ===

async function main() {
  const data = JSON.parse(fs.readFileSync(SONGS_JSON, 'utf8'));
  const drafts = data.songs.filter(s => DRAFT_STATUSES.includes(s.status));

  let out = {};
  if (fs.existsSync(OUT_JSON)) {
    try {
      out = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')).previews || {};
    } catch (e) {
      process.stderr.write('song-previews.json je poškozený, začínám znovu\n');
    }
  }

  // Drop entries whose song is no longer a draft (triaged or deleted), so the
  // file doesn't grow stale keys forever.
  const draftSlugs = new Set(drafts.map(s => s.slug));
  Object.keys(out).forEach(slug => {
    if (!draftSlugs.has(slug)) delete out[slug];
  });

  const todo = drafts.filter(s => {
    const known = out[s.slug];
    if (!known) return true;
    return recheck && known.match === 'none';
  });

  process.stderr.write(`${drafts.length} návrhů, ${todo.length} k dohledání\n`);

  let done = 0;
  let found = 0;
  for (const song of todo) {
    const hit = await resolveSong(song);
    out[song.slug] = hit || { match: 'none' };
    if (hit) {
      found++;
      const mark = hit.match === 'exact' ? ' ' : '~';
      process.stderr.write(`${mark} ${song.title} → ${hit.track} / ${hit.artist}\n`);
    } else {
      process.stderr.write(`✗ ${song.title}\n`);
    }

    done++;
    if (done % 10 === 0) flush(out, drafts.length);
    await sleep(delayMs);
  }

  flush(out, drafts.length);

  const exact = Object.values(out).filter(p => p.match === 'exact').length;
  const cover = Object.values(out).filter(p => p.match === 'title').length;
  const none = Object.values(out).filter(p => p.match === 'none').length;
  process.stderr.write(
    `\nhotovo: ${exact} přesně, ${cover} jiný interpret, ${none} nenalezeno `
    + `(${Math.round((exact + cover) / drafts.length * 100)}% pokrytí)\n`
  );
  if (todo.length) process.stderr.write(`nově dohledáno: ${found}/${todo.length}\n`);
}

function flush(previews, total) {
  const sorted = {};
  Object.keys(previews).sort().forEach(k => { sorted[k] = previews[k]; });
  fs.writeFileSync(OUT_JSON, JSON.stringify({
    generated: new Date().toISOString(),
    total,
    previews: sorted
  }, null, 2) + '\n', 'utf8');
}

main().catch(e => {
  process.stderr.write('chyba: ' + e.stack + '\n');
  process.exit(1);
});
