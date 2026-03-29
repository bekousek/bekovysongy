#!/usr/bin/env python3
"""
Scraper for bekovysongy.cz - fetches internal songs from the Webnode site,
parses chords+lyrics, generates songs.json and individual HTML files.
"""

import json
import os
import re
import sys
import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString

BASE_URL = "https://www.bekovysongy.cz"
INDEX_URL = f"{BASE_URL}/na-kytaru/"
SONGS_DIR = "songs"
DELAY = 0.2  # seconds between requests

# Navigation slugs to skip (not songs)
NAV_SLUGS = {
    "/home/", "/na-kytaru/", "/dle-autoru/", "/dle-zanru/",
    "/na-foukaci-harmoniku/", "/na-kalimbu/", "/random/", "/"
}

# Known chord pattern
CHORD_RE = re.compile(
    r'^[A-H][b#]?'
    r'(mi|m|mol|maj|dim|aug|add|sus)?'
    r'[0-9]?'
    r'(\/[A-H][b#]?)?$'
)

# Language detection heuristics
CZ_WORDS = {"jsem", "jsou", "není", "kde", "jak", "ale", "jeho", "její", "jako", "když", "nebo", "tak", "jen", "byl", "aby", "může", "bylo", "každý", "tohle", "ještě", "mám", "máš", "ráno", "láska", "srdce", "oči", "slunce", "nebe"}
EN_WORDS = {"the", "and", "you", "that", "was", "for", "are", "with", "his", "they", "this", "have", "from", "one", "had", "but", "not", "what", "all", "were", "when", "your", "can", "said", "each", "she", "love", "heart", "eyes"}
SK_WORDS = {"som", "sme", "nie", "ako", "keď", "alebo", "jeho", "jej", "ešte", "veľmi", "teraz", "potom", "lásku", "srdce", "môže", "byť", "neviem", "viem"}
PL_WORDS = {"jest", "nie", "jak", "ale", "jego", "jest", "gdzie", "kiedy", "tylko", "jeszcze", "bardzo", "teraz", "potem", "może", "być", "oczy", "serce"}


def detect_language(text):
    words = set(re.findall(r'[a-záčďéěíňóřšťúůýžąćęłńóśźż]+', text.lower()))
    scores = {
        "CZ": len(words & CZ_WORDS),
        "EN": len(words & EN_WORDS),
        "SK": len(words & SK_WORDS),
        "PL": len(words & PL_WORDS),
    }
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "CZ"  # default
    return best


def detect_capo(text):
    return bool(re.search(r'capo', text, re.IGNORECASE))


def fetch(url):
    resp = requests.get(url, timeout=30)
    resp.encoding = 'utf-8'
    return resp


def get_song_links(html):
    """Extract internal and external links from the main page."""
    soup = BeautifulSoup(html, 'html.parser')
    internal = []
    external = []

    for a in soup.find_all('a', href=True):
        href = a['href'].strip()
        text = a.get_text(strip=True)
        if not text or not href:
            continue

        # Determine if internal or external
        parsed = urlparse(href)

        if parsed.netloc and parsed.netloc not in ('www.bekovysongy.cz', 'bekovysongy.cz'):
            external.append({"title": text, "url": href})
            continue

        # Internal link - normalize to path
        if parsed.netloc:
            path = parsed.path
        else:
            path = href

        # Ensure trailing slash for consistency
        if not path.endswith('/'):
            path = path + '/'

        # Skip navigation pages
        if path in NAV_SLUGS:
            continue

        # Skip anchors, javascript, etc
        if path.startswith('#') or path.startswith('javascript:'):
            continue

        # Must be a simple slug path
        if re.match(r'^/[a-z0-9\-]+/$', path):
            slug = path.strip('/')
            internal.append({"title": text, "slug": slug, "path": path})

    # Deduplicate internal by slug
    seen = set()
    unique_internal = []
    for item in internal:
        if item['slug'] not in seen:
            seen.add(item['slug'])
            unique_internal.append(item)

    return unique_internal, external


def parse_song_page(html, slug, link_title):
    """Parse a song page HTML and return song data."""
    soup = BeautifulSoup(html, 'html.parser')

    # Find title
    h1 = soup.find('h1')
    title = link_title  # fallback to link text
    if h1:
        title = h1.get_text(strip=True)

    # Find author - look for h3 or first p after h1
    author = ""
    if h1:
        # Check for h3 sibling
        parent_div = h1.find_parent('div', class_='b-text-c')
        if parent_div:
            h3 = parent_div.find('h3')
            if h3:
                author = h3.get_text(strip=True)
            else:
                # Check first p in same div
                p = parent_div.find('p')
                if p:
                    p_text = p.get_text(strip=True)
                    # If it's short and doesn't contain chord-like content, it's likely the author
                    if len(p_text) < 100 and not re.search(r'<font', str(p)) and p_text:
                        # Check if the p contains font tags (chords) = not author
                        if not p.find('font', class_='wsw-12'):
                            author = p_text

    # Find content sections with chords/lyrics
    content_divs = soup.find_all('div', class_='b-text-c')

    chords_found = set()
    song_lines = []
    full_text = ""

    for div in content_divs:
        # Skip the title div
        if div.find('h1'):
            continue

        # Process paragraphs
        for elem in div.children:
            if isinstance(elem, NavigableString):
                text = str(elem).strip()
                if text:
                    song_lines.append(text)
                    full_text += text + " "
                continue

            if elem.name == 'p':
                line_parts = []
                for child in elem.children:
                    if isinstance(child, NavigableString):
                        text = str(child)
                        # Replace &nbsp; and normalize
                        text = text.replace('\xa0', ' ')
                        line_parts.append(text)
                    elif child.name == 'font' and 'wsw-12' in child.get('class', []):
                        chord_text = child.get_text(strip=True)
                        if chord_text:
                            chords_found.add(chord_text.rstrip(',').strip())
                            line_parts.append(f'<span class="chord" data-chord="{chord_text.strip()}">{chord_text.strip()}</span>')
                    elif child.name == 'br':
                        line_parts.append('\n')
                    elif child.name == 'font':
                        # font tag with chord inside but different class
                        inner_font = child.find('font', class_='wsw-12')
                        if inner_font:
                            chord_text = inner_font.get_text(strip=True)
                            if chord_text:
                                chords_found.add(chord_text.rstrip(',').strip())
                                line_parts.append(f'<span class="chord" data-chord="{chord_text.strip()}">{chord_text.strip()}</span>')
                        else:
                            text = child.get_text()
                            text = text.replace('\xa0', ' ')
                            line_parts.append(text)
                    else:
                        text = child.get_text()
                        text = text.replace('\xa0', ' ')
                        line_parts.append(text)

                line = ''.join(line_parts)
                full_text += line + " "
                song_lines.append(line)

    song_content = '\n'.join(song_lines)

    # Clean up chords - remove empty/weird entries
    clean_chords = []
    for c in chords_found:
        c = c.strip().rstrip(',').strip()
        if c and len(c) <= 10:
            clean_chords.append(c)
    clean_chords = sorted(set(clean_chords))

    # Detect language and capo
    plain_text = re.sub(r'<[^>]+>', '', song_content)
    language = detect_language(plain_text)
    capo = detect_capo(plain_text)

    return {
        "title": title,
        "slug": slug,
        "author": author,
        "chords": clean_chords,
        "group": "",  # Will need manual categorization
        "tags": {
            "capo": capo,
            "language": language
        },
        "content": song_content
    }


def generate_song_html(song):
    """Generate individual song HTML file."""
    return f'''<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{song["title"]} - Bekovy songy</title>
  <link rel="stylesheet" href="../css/style.css">
</head>
<body>
  <nav class="main-nav">
    <a href="/" class="nav-logo">Bekovy songy</a>
    <div class="nav-links">
      <a href="/na-kytaru/">Na kytaru</a>
      <a href="/na-foukaci-harmoniku/">Na harmoniku</a>
      <a href="/na-kalimbu/">Na kalimbu</a>
    </div>
  </nav>

  <main class="song-page">
    <div class="song-header">
      <h1>{song["title"]}</h1>
      {f'<p class="song-author">{song["author"]}</p>' if song["author"] else ''}
      {f'<p class="song-capo">Capo</p>' if song["tags"]["capo"] else ''}
    </div>
    <pre class="song-text">{song["content"]}</pre>
  </main>

  <div class="player-bar" id="player-bar">
    <div class="player-section player-transpose">
      <span class="player-label">Transpozice</span>
      <button class="btn-transpose" id="transpose-down">-1</button>
      <span id="transpose-value">0</span>
      <button class="btn-transpose" id="transpose-up">+1</button>
    </div>
    <div class="player-section player-scroll">
      <button class="btn-player" id="scroll-toggle">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
      </button>
      <input type="range" id="scroll-speed" min="1" max="10" value="3" class="speed-slider">
    </div>
    <div class="player-section player-metronome">
      <button class="btn-player" id="metronome-toggle">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 20,22 4,22"/><line x1="12" y1="22" x2="12" y2="8"/></svg>
      </button>
      <input type="number" id="bpm-input" min="40" max="240" value="120" class="bpm-input">
    </div>
    <div class="player-section player-tuner">
      <button class="btn-player" id="tuner-toggle">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
      </button>
      <span id="tuner-display" class="tuner-display"></span>
    </div>
    <div class="player-section player-bug">
      <a href="mailto:bek@bekovysongy.cz?subject=Bug: {song["title"]}" class="btn-player" title="Nahlásit chybu">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3 3 0 016 0v1M12 20c-3.87 0-7-3.13-7-7v-2h14v2c0 3.87-3.13 7-7 7zM5 11V9M19 11V9M7.13 17H2M22 17h-5.13"/></svg>
      </a>
    </div>
  </div>

  <script src="../js/chords.js"></script>
  <script src="../js/player.js"></script>
</body>
</html>'''


def main():
    print("=== Bekovy Songy Scraper ===")
    print(f"Fetching index page: {INDEX_URL}")

    resp = fetch(INDEX_URL)
    if resp.status_code != 200:
        print(f"ERROR: Could not fetch index page (status {resp.status_code})")
        sys.exit(1)

    internal_links, external_links = get_song_links(resp.text)
    print(f"Found {len(internal_links)} internal song links")
    print(f"Found {len(external_links)} external links")

    # Save external links
    with open("external_links.json", "w", encoding="utf-8") as f:
        json.dump(external_links, f, ensure_ascii=False, indent=2)
    print(f"Saved external_links.json")

    # Scrape each internal song
    songs = []
    errors = []
    skipped = 0

    for i, link in enumerate(internal_links):
        slug = link['slug']
        url = f"{BASE_URL}/{slug}/"
        print(f"[{i+1}/{len(internal_links)}] Scraping: {link['title']} ({slug})")

        try:
            resp = fetch(url)
            if resp.status_code == 404:
                errors.append(f"404: {slug} ({link['title']})")
                print(f"  WARNING: 404 Not Found")
                continue
            if resp.status_code != 200:
                errors.append(f"HTTP {resp.status_code}: {slug}")
                print(f"  WARNING: HTTP {resp.status_code}")
                continue

            song = parse_song_page(resp.text, slug, link['title'])

            if not song['content'].strip():
                errors.append(f"Empty content: {slug} ({link['title']})")
                print(f"  WARNING: Empty content")
                skipped += 1
                continue

            # Generate song HTML
            html = generate_song_html(song)
            filepath = os.path.join(SONGS_DIR, f"{slug}.html")
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(html)

            # Add to songs list (without content for songs.json)
            songs.append({
                "title": song["title"],
                "slug": song["slug"],
                "author": song["author"],
                "chords": song["chords"],
                "group": song["group"],
                "tags": song["tags"]
            })

        except Exception as e:
            errors.append(f"Error: {slug} - {str(e)}")
            print(f"  ERROR: {str(e)}")

        time.sleep(DELAY)

    # Save songs.json
    songs_data = {"songs": sorted(songs, key=lambda s: s["title"].lower())}
    with open("songs.json", "w", encoding="utf-8") as f:
        json.dump(songs_data, f, ensure_ascii=False, indent=2)
    print(f"\nSaved songs.json with {len(songs)} songs")

    # Save scraping report
    report = f"""Scraping Report
===============
Date: {time.strftime('%Y-%m-%d %H:%M:%S')}

Internal songs found: {len(internal_links)}
Successfully scraped: {len(songs)}
Skipped (empty): {skipped}
Errors: {len(errors)}
External links saved: {len(external_links)}

"""
    if errors:
        report += "Errors:\n"
        for e in errors:
            report += f"  - {e}\n"

    # Chord statistics
    all_chords = set()
    for s in songs:
        all_chords.update(s['chords'])
    report += f"\nUnique chords found: {len(all_chords)}\n"
    report += f"Chords: {', '.join(sorted(all_chords))}\n"

    # Language stats
    lang_counts = {}
    for s in songs:
        lang = s['tags']['language']
        lang_counts[lang] = lang_counts.get(lang, 0) + 1
    report += f"\nLanguage distribution:\n"
    for lang, count in sorted(lang_counts.items()):
        report += f"  {lang}: {count}\n"

    with open("scraping_report.txt", "w", encoding="utf-8") as f:
        f.write(report)
    print(f"Saved scraping_report.txt")
    print(f"\nDone! {len(songs)} songs scraped successfully.")


if __name__ == "__main__":
    main()
