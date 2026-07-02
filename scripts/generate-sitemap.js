#!/usr/bin/env node
'use strict';
/**
 * Generates sitemap.xml from songs.json. Run at build/deploy time (not
 * committed) so it's always in sync with the current song list:
 *   node scripts/generate-sitemap.js > _site/sitemap.xml
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://bekovysongy.cz';

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'songs.json'), 'utf-8'));

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const urls = [
  `${SITE}/`,
  `${SITE}/na-kytaru/`,
  `${SITE}/na-foukaci-harmoniku/`,
  `${SITE}/na-kalimbu/`,
  ...data.songs.map(s => `${SITE}/songs/${s.slug}.html`),
];

const body = urls.map(u => `  <url>\n    <loc>${escapeXml(u)}</loc>\n  </url>`).join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

process.stdout.write(xml);
