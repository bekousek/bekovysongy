#!/usr/bin/env python3
"""
transfer_songs.py - Transfer the first 100 "below-the-line" external-link songs
from external_links.json into full local songs on the new site.

Pipeline:  fetch (per source) -> parse (-> text with inline [chord] markers)
           -> normalize (chords to canonical Czech 'mi' notation)
           -> generate (songs/<slug>.html + songs.json entry)

By default writes results to ./staging/ for inspection. Use --commit to write
into songs/, songs.json and external_links.json for real.
"""

import argparse
import html
import json
import os
import re
import sys
import time
import unicodedata
from urllib.parse import urlparse, parse_qs

import requests
from bs4 import BeautifulSoup

# Reuse language/capo heuristics from the original scraper.
from scrape import detect_language, detect_capo

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "cs,sk,en;q=0.8"}

ROOT = os.path.dirname(os.path.abspath(__file__))
SONGS_DIR = os.path.join(ROOT, "songs")
STAGING_DIR = os.path.join(ROOT, "staging")
EXTERNAL_LINKS = os.path.join(ROOT, "external_links.json")
# Stable, never-pruned snapshot of the original list -> defines the 100-song scope
# (the working external_links.json gets pruned as songs are transferred).
EXTERNAL_LINKS_ORIG = os.path.join(ROOT, "external_links.original.json")
SONGS_JSON = os.path.join(ROOT, "songs.json")
REPORT = os.path.join(ROOT, "transfer_report.md")
BUG_EMAIL = "ondrejbek8@gmail.com"

# The provided list ends here (inclusive). Everything before it = the 100.
CUTOFF_TITLE = "Píseň proti trudomyslnosti"

# Not real songs -> never transfer (footer/builder links etc.)
EXCLUDE_TITLES = {"Webnode"}

DELAY = 0.4

# Known-bad source URLs in external_links.json (wrong/placeholder links) -> corrected.
CORRECTIONS = {
    # listed link pointed at Sia – Snowman by mistake; correct song is MIRAI's.
    "Když nemůžeš, tak přidej": "https://supermusic.cz/skupina.php?idpiesne=989283",
}

# ----------------------------------------------------------------------------
# Slug handling
# ----------------------------------------------------------------------------
_TRANSLIT = {"ł": "l", "Ł": "l", "ø": "o", "ß": "ss", "æ": "ae", "œ": "oe"}


def strip_diacritics(text):
    text = "".join(_TRANSLIT.get(ch, ch) for ch in text)
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def slugify(title):
    s = strip_diacritics(title).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = re.sub(r"-{2,}", "-", s)
    if not s:
        s = "song"
    if s[0].isdigit():
        s = "a" + s
    return s


def unique_slug(base, taken):
    slug = base
    n = 2
    while slug in taken:
        slug = f"{base}-{n}"
        n += 1
    taken.add(slug)
    return slug


# ----------------------------------------------------------------------------
# Chord normalization  ->  canonical Czech 'mi' notation
#   H = English B (natural), B = English Bb. Minor suffix = 'mi'.
# ----------------------------------------------------------------------------
# German note names sometimes used by transcribers -> site notation
# flats: As=Ab, Es=Eb...   sharps: Gis=G#, Cis=C#...
GERMAN_FLATS = {"As": "Ab", "Es": "Eb", "Des": "Db", "Ges": "Gb", "Ces": "Cb",
                "Fes": "Fb", "Gis": "G#", "Cis": "C#", "Fis": "F#", "Dis": "D#",
                "Ais": "A#"}
ROOT_RE = re.compile(r"^([A-H])([#b]?)")


def _normalize_one(chord, english):
    """Normalize a single (non-slash) chord token. Returns (norm, ok).

    Site convention: H = B natural, B = B flat; other flats use 'b' (Eb, Ab...).
    """
    c = chord.strip().strip(",").strip()
    if not c:
        return "", False

    # German note names (As=Ab, Es=Eb, ...): only when the whole root token matches
    for ger, repl in GERMAN_FLATS.items():
        if c == ger or c.startswith(ger) and not c[len(ger):len(ger) + 1].isalpha():
            c = repl + c[len(ger):]
            break

    m = ROOT_RE.match(c)
    if not m:
        return c, False
    root, acc = m.group(1), m.group(2)
    suffix = c[m.end():]

    # Root normalization to site convention
    if root == "B" and acc == "b":
        acc = ""                  # Bb (English/transcriber) -> site B
    elif root == "B" and acc == "" and english:
        root = "H"                # English B natural -> Czech H

    # --- suffix normalization ---
    s = suffix
    # major seventh first (so the leading capital M / 'maj' isn't read as minor)
    s = re.sub(r"^(maj7|Maj7|MAJ7|M7|Δ7?|j7)", "maj7", s)
    s = re.sub(r"^(maj9|Maj9|M9)", "maj9", s)
    # minor: leading lowercase m / words / dash  ->  'mi'  (but not 'maj')
    if not s.startswith("maj") and not s.startswith("mi"):
        s = re.sub(r"^(min|mol|moll|m|-)", "mi", s)
    # diminished / augmented
    s = re.sub(r"^(dim|°)", "dim", s)
    s = re.sub(r"^(aug|\+)", "aug", s)
    # tidy stray spaces inside suffix (e.g. "F maj7" -> "Fmaj7")
    s = s.replace(" ", "")

    norm = root + acc + s
    ok = bool(VALID_CHORD_RE.match(norm))
    return norm, ok


VALID_CHORD_RE = re.compile(
    r"^[A-H][#b]?"
    r"(mi|maj|dim|aug|sus|add)?"
    r"[0-9]?"
    r"(sus|add)?[0-9]?$"
)


def normalize_chord(raw, english=False):
    """Normalize a chord that may contain a slash bass note."""
    raw = raw.strip()
    if "/" in raw:
        parts = raw.split("/", 1)
        a, ok_a = _normalize_one(parts[0], english)
        b, ok_b = _normalize_one(parts[1], english)
        return f"{a}/{b}", (ok_a and ok_b)
    return _normalize_one(raw, english)


# ----------------------------------------------------------------------------
# Inline [chord] text  ->  song HTML body with <span class="chord"> markers
# ----------------------------------------------------------------------------
BRACKET_RE = re.compile(r"\[([^\[\]]{1,12})\]")
# Heuristic: does the bracket content look like a chord (vs. [Verse], [2x], ...)?
LOOKS_CHORD_RE = re.compile(r"^[A-H][#b]?[A-Za-z0-9/#+°Δ -]*$")
# Lenient single-chord matcher (accepts Em and Emi, slash bass), for line detection
LENIENT_CHORD_RE = re.compile(
    r"^[A-H][#b]?(m|mi|min|mol|moll|maj|dim|aug|sus|add|°|\+|-)?\d?"
    r"(sus|add)?\d?(/[A-H][#b]?)?$")


def looks_like_chord_token(tok):
    return bool(LENIENT_CHORD_RE.match(tok.strip("().,|")))


def _debracket(line):
    """Replace [ and ] with spaces (same width -> column alignment preserved)."""
    return line.replace("[", " ").replace("]", " ")


def is_chordish_line(line):
    """English/Czech-agnostic chord-line test (for start detection & merging).
    Handles both bare chord rows and bracketed chord-only rows ([A]  [E])."""
    toks = _debracket(line).split()
    if not toks:
        return False
    n = 0
    for t in toks:
        if t in ("/:", ":/", "|", "x2", "x3", "2x", "3x", "%"):
            continue
        if looks_like_chord_token(t):
            n += 1
        else:
            return False
    return n >= 1


# Structural labels that can appear in [brackets] but are NOT chords
SECTION_WORDS = {"bridge", "verse", "chorus", "pre-chorus", "prechorus", "intro",
                 "outro", "refrain", "refren", "refrén", "solo", "coda", "mezihra",
                 "sloka", "predehra", "předehra", "dohra", "interlude", "break"}


def _chord_span(chord):
    esc = html.escape(chord, quote=True)
    return f'<span class="chord" data-chord="{esc}">{esc}</span>'


def inline_text_to_html(text, english, chords_out, unknown_out):
    """Convert text containing [chord] markers to escaped HTML with chord spans.

    chords_out: set collecting all normalized chords used.
    unknown_out: set collecting chords that failed validation.
    """
    result = []
    pos = 0
    for m in BRACKET_RE.finditer(text):
        # escaped literal text before this bracket (quotes kept literal, as in pre)
        result.append(html.escape(text[pos:m.start()], quote=False))
        inner = m.group(1).strip()
        if inner.lower().rstrip(":").strip() in SECTION_WORDS:
            # structural label like [Bridge] -> keep as literal text, not a chord
            result.append(html.escape(m.group(0), quote=False))
            pos = m.end()
            continue
        tokens = inner.split()
        normed = [normalize_chord(t.strip(",|"), english) for t in tokens] if tokens else []
        if normed and all(ok for _, ok in normed):
            # one or more chords inside the bracket (e.g. "[F C G Ami]")
            spans = []
            for norm, ok in normed:
                chords_out.add(norm)
                spans.append(_chord_span(norm))
            result.append(" ".join(spans))
        elif LOOKS_CHORD_RE.match(inner):
            # chord-ish (e.g. internal space like "F maj7/F#") -> normalize as one
            norm, ok = normalize_chord(inner, english)
            chords_out.add(norm)
            if not ok:
                unknown_out.add(norm)
            result.append(_chord_span(norm))
        else:
            # not a chord (e.g. [Verse], [2x]) -> keep literal bracket text
            result.append(html.escape(m.group(0), quote=False))
        pos = m.end()
    result.append(html.escape(text[pos:], quote=False))
    return "".join(result)


def chords_above_to_inline(chord_line, lyric_line):
    """Merge a chord line (chords positioned by column) into the lyric line,
    producing a single line with [chord] markers inserted at the right columns."""
    # Collect (column, token) for each chord on the chord line.
    chord_line = _debracket(chord_line)   # bracketed rows -> bare, columns preserved
    placements = []
    for m in re.finditer(r"\S+", chord_line):
        placements.append((m.start(), m.group(0)))
    if not placements:
        return lyric_line
    lyric = lyric_line.rstrip("\n")
    out = []
    last = 0
    for col, tok in placements:
        col = min(col, len(lyric))
        out.append(html.escape(lyric[last:col]) if False else lyric[last:col])
        out.append(f"[{tok}]")
        last = col
    out.append(lyric[last:])
    return "".join(out)


# ----------------------------------------------------------------------------
# HTML page generation (matches songs/andel.html template exactly)
# ----------------------------------------------------------------------------
def generate_song_html(title, author, capo, body_html):
    import urllib.parse
    subj = urllib.parse.quote(f"Bug: {title}")
    author_p = f'<p class="song-author">{html.escape(author)}</p>' if author else ""
    capo_p = '<p class="song-capo">Capo</p>' if capo else ""
    return f'''<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(title)} - Bekovy songy</title>
  <link rel="stylesheet" href="../css/style.css">
</head>
<body>
  <nav class="main-nav">
    <a href="../" class="nav-logo">Bekovy songy</a>
    <div class="nav-links">
      <a href="../na-kytaru/">Na kytaru</a>
      <a href="../na-foukaci-harmoniku/">Na harmoniku</a>
      <a href="../na-kalimbu/">Na kalimbu</a>
    </div>
  </nav>

  <main class="song-page">
    <div class="song-header">
      <h1>{html.escape(title)}</h1>
      {author_p}
      {capo_p}
    </div>
    <pre class="song-text">{body_html}</pre>
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
      <a href="mailto:{BUG_EMAIL}?subject={subj}" class="btn-player" title="Nahlásit chybu">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3 3 0 016 0v1M12 20c-3.87 0-7-3.13-7-7v-2h14v2c0 3.87-3.13 7-7 7zM5 11V9M19 11V9M7.13 17H2M22 17h-5.13"/></svg>
      </a>
    </div>
  </div>

  <script src="../js/chords.js"></script>
  <script src="../js/player.js"></script>
</body>
</html>'''


# ----------------------------------------------------------------------------
# Fetchers / parsers per source
# ----------------------------------------------------------------------------
def smart_decode(content):
    """Most sources are UTF-8; a few older ones are cp1250. Try strict UTF-8
    first, fall back to cp1250."""
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return content.decode("cp1250", "replace")


def http_get(url):
    return requests.get(url, headers=HEADERS, timeout=30, allow_redirects=True)


def soup_of(url):
    r = http_get(url)
    text = smart_decode(r.content)
    return BeautifulSoup(text, "html.parser"), text


def author_from_path(url):
    segs = [s for s in urlparse(url).path.split("/") if s]
    if len(segs) >= 2 and not segs[0].endswith(".aspx"):
        return segs[0].replace("-", " ").strip().title()
    return ""


def detect_capo_text(text):
    return bool(re.search(r"\b(capo|kapodast)", text, re.IGNORECASE))


from bs4 import NavigableString, Tag


def parse_kytary(url):
    """akordy.kytary.cz - song is in a JSON-LD MusicComposition block."""
    soup, raw = soup_of(url)
    author, lyrics = "", ""
    for sc in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(sc.string or "")
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for d in items:
            if isinstance(d, dict) and d.get("@type") == "MusicComposition":
                comp = d.get("composer")
                if isinstance(comp, list) and comp:
                    author = comp[0].get("name", "")
                elif isinstance(comp, dict):
                    author = comp.get("name", "")
                lyr = d.get("lyrics")
                if isinstance(lyr, dict):
                    lyrics = lyr.get("text", "")
    if not lyrics:
        raise ValueError("kytary: no JSON-LD lyrics")
    lines = [ln.rstrip() for ln in lyrics.replace("\r\n", "\n").split("\n")]
    return {"author": author, "lines": lines, "english": "/en/" in url,
            "capo": detect_capo_text(raw)}


def parse_pisnicky_akordy(url):
    """pisnicky-akordy.cz - <pre> with <el class=aline> chord rows + lyric text."""
    soup, raw = soup_of(url)
    pre = soup.find("pre")
    if not pre:
        raise ValueError("pisnicky-akordy: no <pre>")
    lines, cur = [], []

    def flush():
        if cur:
            lines.append("".join(cur).rstrip())
            cur.clear()

    for child in pre.children:
        if isinstance(child, Tag) and child.name == "el" and "aline" in (child.get("class") or []):
            flush()
            lines.append(child.get_text())          # chord row (spacing preserved)
        elif isinstance(child, Tag) and child.name == "br":
            flush()
        elif isinstance(child, NavigableString):
            cur.append(str(child))
        else:
            cur.append(child.get_text())
    flush()
    return {"author": author_from_path(url), "lines": lines, "english": False,
            "capo": detect_capo_text(raw)}


def parse_velkyzpevnik(url):
    """velkyzpevnik.cz - <pre> with <span class=chord> positioned above lyrics."""
    soup, raw = soup_of(url)
    pre = soup.find("pre", id="chordbox") or soup.find("pre", class_="format") or soup.find("pre")
    if not pre:
        raise ValueError("velkyzpevnik: no <pre>")
    for sp in pre.find_all("span"):
        sp.replace_with(sp.get_text())
    lines = [ln.rstrip() for ln in pre.get_text().split("\n")]
    return {"author": author_from_path(url), "lines": lines, "english": False,
            "capo": detect_capo_text(raw)}


def parse_yousongs(url):
    """yousongs.cz - #SongContent with div.cl_chords / div.cl_song-text rows."""
    soup, raw = soup_of(url)
    box = soup.find(id="SongContent")
    if not box:
        raise ValueError("yousongs: no #SongContent")
    lines = []
    for div in box.find_all("div"):
        cls = div.get("class") or []
        if "cl_chords" in cls:
            lines.append(div.get_text())
        elif any(c.startswith("cl_song") or c.startswith("cl_chorus") for c in cls):
            lines.append(div.get_text())
    author = ""
    h = soup.find(["h1", "h2"])
    return {"author": author, "lines": lines, "english": False,
            "capo": detect_capo_text(raw)}


def parse_kytaristka(url):
    """kytaristka.cz - div.line with <span class=chord><sup>X</sup></span> inline."""
    soup, raw = soup_of(url)
    rows = soup.select("div.line")
    if not rows:
        raise ValueError("kytaristka: no div.line")
    lines = []
    for line in rows:
        parts = []
        for ch in line.children:
            if isinstance(ch, Tag) and "chord" in (ch.get("class") or []):
                parts.append(f"[{ch.get_text(strip=True)}]")
            elif isinstance(ch, NavigableString):
                parts.append(str(ch))
            else:
                parts.append(ch.get_text())
        lines.append("".join(parts))
    return {"author": author_from_path(url), "lines": lines, "english": False,
            "capo": detect_capo_text(raw)}


def supermusic_id(url):
    q = parse_qs(urlparse(url).query)
    for key in ("idpiesne", "id"):
        if key in q and q[key] and q[key][0].isdigit():
            return q[key][0]
    return None


def fetch_supermusic(url):
    """Returns dict: title, author, lines (list of str, with inline [chord]),
    has_inline (bool)."""
    sid = supermusic_id(url)
    if not sid:
        raise ValueError(f"no supermusic id in URL: {url}")
    exp = f"https://www.supermusic.cz/export.php?idpiesne={sid}&typ=TXT"
    r = requests.get(exp, headers=HEADERS, timeout=30, allow_redirects=True)
    raw = smart_decode(r.content)

    # author from the idskupiny anchor
    author = ""
    am = re.search(r'idskupiny=\d+"[^>]*>([^<]+)</a>', raw)
    if am:
        author = am.group(1).strip()

    # Body: drop <head>, scripts, and the trailing footer div.
    body = re.split(r"<div style=\"border-top", raw)[0]
    body = re.sub(r"(?is)<head>.*?</head>", "", body)
    body = re.sub(r"(?is)<script.*?</script>", "", body)
    # normalize line breaks
    body = re.sub(r"(?i)<br\s*/?>", "\n", body)
    body = re.sub(r"(?is)<[^>]+>", "", body)        # strip remaining tags
    body = html.unescape(body)
    lines = [ln.rstrip() for ln in body.split("\n")]

    # Drop leading noise: keep from the first line that has a [chord] or a verse
    # marker; also remove the duplicated author/title header lines.
    cleaned = []
    started = False
    for ln in lines:
        if not started:
            if (re.search(r"\[[A-H]", ln) or re.match(r"\s*(R:|\d+\.|/:)", ln)
                    or is_chordish_line(ln)):
                started = True
            else:
                continue
        cleaned.append(ln)
    # capo: detect from raw, then drop standalone capo lines from the body
    capo = bool(re.search(r"capo", raw, re.IGNORECASE))
    cleaned = [ln for ln in cleaned if not re.match(r"\s*capo\s*\d*\s*$", ln, re.IGNORECASE)]
    # collapse runs of 2+ blank lines to a single blank line
    collapsed = []
    for ln in cleaned:
        if not ln.strip() and collapsed and not collapsed[-1].strip():
            continue
        collapsed.append(ln)
    cleaned = collapsed
    # trim leading/trailing empties
    while cleaned and not cleaned[0].strip():
        cleaned.pop(0)
    while cleaned and not cleaned[-1].strip():
        cleaned.pop()
    has_inline = any("[" in ln for ln in cleaned)
    # detect notation language from lyric text (chord tokens/lines removed)
    lyric = "\n".join(ln for ln in cleaned if not is_chordish_line(ln))
    lyric = BRACKET_RE.sub(" ", lyric)
    # supermusic uses Czech chord notation (H/B); keep english=False so we never
    # wrongly convert a Czech B (=Bb) to H. m->mi still handles English 'Em' etc.
    return {"title": None, "author": author, "lines": cleaned, "capo": capo,
            "has_inline": has_inline, "english": False, "export": exp}


# ----------------------------------------------------------------------------
# List loading & cleaning
# ----------------------------------------------------------------------------
def load_scope(process_all=False):
    """The first-100 list (default) or the entire external list (process_all).
    Scope comes from the pristine snapshot so it is stable across re-runs."""
    src = EXTERNAL_LINKS_ORIG if os.path.exists(EXTERNAL_LINKS_ORIG) else EXTERNAL_LINKS
    with open(src, encoding="utf-8") as f:
        links = json.load(f)
    out = []
    for item in links:
        title = item["title"].strip()
        if title in EXCLUDE_TITLES or "webnode.cz" in item["url"]:
            continue
        if title in CORRECTIONS:
            item = dict(item, url=CORRECTIONS[title])
        out.append(item)
        if not process_all and title == CUTOFF_TITLE:
            break
    return out


def existing_index():
    with open(SONGS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    slugs = {s["slug"] for s in data["songs"]}
    for fn in os.listdir(SONGS_DIR):
        if fn.endswith(".html"):
            slugs.add(fn[:-5])
    titles = {strip_diacritics(s["title"]).lower().strip() for s in data["songs"]}
    return data, slugs, titles


def domain_of(url):
    return urlparse(url).netloc.lower().replace("www.", "")


# ----------------------------------------------------------------------------
# Build the song body (HTML) from a list of raw lines that may have chords
# inline ([C]) or on separate lines above the lyrics.
# ----------------------------------------------------------------------------
def is_chord_line(line, english):
    return is_chordish_line(line)


def lines_to_body(lines, english, chords_out, unknown_out):
    """Return (body_html, needs_review). Merges above-text chord lines into the
    following lyric line; passes inline [chord] lines through."""
    needs_review = False
    merged = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        # a chord-only row (bare "A  E" or bracketed "[A]  [E]") sitting above lyrics
        if ln.strip() and is_chordish_line(ln):
            # look ahead past blank lines for a lyric line to merge chords into
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if (j < len(lines) and not is_chordish_line(lines[j])
                    and "[" not in lines[j]):
                merged.append(chords_above_to_inline(ln, lines[j]))
                needs_review = True
                i = j + 1
                continue
            # no lyric to merge into: keep already-bracketed rows as-is,
            # otherwise wrap bare chord tokens so they render as chords
            if "[" in ln:
                merged.append(ln)
            else:
                merged.append(re.sub(
                    r"\S+",
                    lambda m: f"[{m.group(0)}]" if looks_like_chord_token(m.group(0)) else m.group(0),
                    ln))
            i += 1
            continue
        merged.append(ln)
        i += 1
    text = "\n".join(merged)
    body = inline_text_to_html(text, english, chords_out, unknown_out)
    return body, needs_review


# ----------------------------------------------------------------------------
# Dispatch
# ----------------------------------------------------------------------------
def fetch_item(item):
    """Return parsed dict {title, author, lines, english, has_inline, source}."""
    url = item["url"]
    dom = domain_of(url)
    parsers = {
        "supermusic.cz": fetch_supermusic,
        "pisnicky-akordy.cz": parse_pisnicky_akordy,
        "velkyzpevnik.cz": parse_velkyzpevnik,
        "yousongs.cz": parse_yousongs,
        "kytaristka.cz": parse_kytaristka,
    }
    if dom in parsers:
        d = parsers[dom](url)
        d["source"] = url
        return d
    if dom in BROWSER_DOMAINS:
        return fetch_staged(item)
    raise NotImplementedError(f"source not yet implemented: {dom}")


# JS-rendered / bot-protected sources: fetched via browser into staging/<slug>.src.txt
BROWSER_DOMAINS = {"tabs.ultimate-guitar.com", "akordy.kytary.cz", "pisnicky.cz",
                   "google.com", "chordify.net"}


class NeedsBrowser(Exception):
    pass


def fetch_staged(item):
    """Read a browser-captured song text from staging/<slug>.src.txt.
    Optional first line 'AUTHOR: X' sets the author. Raises NeedsBrowser if
    the capture file is missing."""
    url = item["url"]
    dom = domain_of(url)
    src = os.path.join(STAGING_DIR, slugify(item["title"]) + ".src.txt")
    if not os.path.exists(src):
        raise NeedsBrowser(f"browser fetch needed: {dom}")
    with open(src, encoding="utf-8") as f:
        raw = f.read()
    lines = raw.replace("\r\n", "\n").split("\n")
    author = ""
    if lines and lines[0].startswith("AUTHOR:"):
        author = lines[0][7:].strip()
        lines = lines[1:]
    english = (dom == "tabs.ultimate-guitar.com") or ("/en/" in url)
    return {"author": author, "lines": [ln.rstrip() for ln in lines],
            "english": english, "capo": detect_capo_text(raw), "source": url}


def process_item(item, taken, existing_titles, seen_titles, staging=True):
    rec = {"title": item["title"], "url": item["url"],
           "domain": domain_of(item["url"]), "status": "ok",
           "chords": [], "unknown": [], "note": "", "slug": None,
           "author": "", "language": "", "capo": False}

    norm_title = strip_diacritics(item["title"]).lower().strip()
    if norm_title in existing_titles:
        rec["status"] = "skipped-duplicate"
        rec["note"] = "už existuje na webu"
        return rec
    if norm_title in seen_titles:
        rec["status"] = "skipped-duplicate"
        rec["note"] = "duplicita v seznamu (zpracováno z jiného zdroje)"
        return rec
    seen_titles.add(norm_title)

    try:
        parsed = fetch_item(item)
    except (NotImplementedError, NeedsBrowser) as e:
        rec["status"] = "pending-source"
        rec["note"] = str(e)
        return rec
    except Exception as e:
        rec["status"] = "error"
        rec["note"] = repr(e)
        return rec

    chords, unknown = set(), set()
    body, needs_review = lines_to_body(parsed["lines"], parsed.get("english", False),
                                       chords, unknown)
    plain = re.sub(r"<[^>]+>", "", body)
    if not plain.strip():
        rec["status"] = "error"
        rec["note"] = "prázdný obsah po parsování"
        return rec

    title = item["title"]
    author = parsed.get("author", "") or ""
    language = detect_language(plain)
    capo = parsed.get("capo", False) or detect_capo(plain)
    slug = unique_slug(slugify(title), taken)

    rec.update({"slug": slug, "author": author, "language": language,
                "capo": capo, "chords": sorted(chords),
                "unknown": sorted(unknown)})
    if needs_review:
        rec["status"] = "needs-review"
        rec["note"] = "akordy nad textem – zkontrolovat zarovnání"

    page = generate_song_html(title, author, capo, body)
    out_dir = STAGING_DIR if staging else SONGS_DIR
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, slug + ".html"), "w", encoding="utf-8") as f:
        f.write(page)
    rec["_entry"] = {"title": title, "slug": slug, "author": author,
                     "chords": sorted(chords), "group": "",
                     "tags": {"capo": capo, "language": language}}
    return rec


def chords_js_db():
    js = open(os.path.join(ROOT, "js", "chords.js"), encoding="utf-8").read()
    return set(re.findall(r"'([^']+)':\s*\{ frets", js))


def write_report(records):
    db = chords_js_db()
    by_status = {}
    for r in records:
        by_status.setdefault(r["status"], []).append(r)
    missing = set()
    for r in records:
        if r["status"] in ("ok", "needs-review"):
            for c in r["chords"]:
                if c not in db:
                    missing.add(c)

    L = []
    L.append("# Transfer report – „pod-čarou\" písně\n")
    L.append(f"Celkem v rozsahu: **{len(records)}**\n")
    order = ["ok", "needs-review", "pending-source", "skipped-duplicate", "error"]
    names = {"ok": "Hotovo", "needs-review": "Hotovo – ke kontrole zarovnání akordů",
             "pending-source": "Čeká na stažení přes prohlížeč",
             "skipped-duplicate": "Přeskočeno (duplicita)", "error": "Chyba"}
    L.append("| stav | počet |")
    L.append("|---|---|")
    for s in order:
        if s in by_status:
            L.append(f"| {names[s]} | {len(by_status[s])} |")
    L.append("")
    for s in order:
        if s not in by_status:
            continue
        L.append(f"\n## {names[s]} ({len(by_status[s])})\n")
        for r in by_status[s]:
            bits = [f"**{r['title']}**"]
            if r["slug"]:
                bits.append(f"`{r['slug']}.html`")
            bits.append(f"[{r['domain']}]")
            if r["author"]:
                bits.append(f"– {r['author']}")
            if r["unknown"]:
                bits.append(f"⚠ nestandardní akordy: {', '.join(r['unknown'])}")
            if r["note"]:
                bits.append(f"– {r['note']}")
            L.append("- " + " ".join(bits))
    L.append("\n## Akordy bez diagramu v js/chords.js\n")
    L.append("Tyto akordy fungují pro transpozici, ale nemají nákresový diagram "
             "(volitelně doplnit do `js/chords.js`):\n")
    L.append(", ".join(sorted(missing)) if missing else "– žádné –")
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


def commit_results(records):
    """Write songs.json entries and prune external_links.json. Song HTML files
    were already written to songs/ by process_item (staging=False)."""
    with open(SONGS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    existing_slugs = {s["slug"] for s in data["songs"]}
    added = 0
    for r in records:
        if r["status"] in ("ok", "needs-review") and r.get("_entry"):
            if r["_entry"]["slug"] not in existing_slugs:
                data["songs"].append(r["_entry"])
                existing_slugs.add(r["_entry"]["slug"])
                added += 1
    data["songs"].sort(key=lambda s: s["title"].casefold())
    with open(SONGS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # remove transferred / resolved titles from external_links.json
    done = {r["title"] for r in records
            if r["status"] in ("ok", "needs-review", "skipped-duplicate")}
    with open(EXTERNAL_LINKS, encoding="utf-8") as f:
        links = json.load(f)
    kept = [l for l in links if l["title"].strip() not in done]
    with open(EXTERNAL_LINKS, "w", encoding="utf-8") as f:
        json.dump(kept, f, ensure_ascii=False, indent=2)
    print(f"\nPřidáno do songs.json: {added}.  external_links.json: "
          f"{len(links)} -> {len(kept)}.")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="print scope + source breakdown")
    ap.add_argument("--source", help="only process this domain substring")
    ap.add_argument("--limit", type=int, default=0, help="max items to process")
    ap.add_argument("--commit", action="store_true", help="write to songs/ + json (else staging/)")
    ap.add_argument("--all", action="store_true", help="process the entire external list, not just the first 100")
    args = ap.parse_args()

    items = load_scope(process_all=args.all)
    if args.list:
        from collections import Counter
        print(f"Total in scope: {len(items)}")
        for dom, n in Counter(domain_of(i["url"]) for i in items).most_common():
            print(f"  {n:3d}  {dom}")
        sys.exit(0)

    data, slugs, titles = existing_index()
    taken = set(slugs)
    seen_titles = set()
    records = []
    n = 0
    for item in items:
        if args.source and args.source not in domain_of(item["url"]):
            continue
        rec = process_item(item, taken, titles, seen_titles, staging=not args.commit)
        records.append(rec)
        flag = {"ok": "OK", "needs-review": "~~", "skipped-duplicate": "==",
                "pending-source": "..", "error": "XX"}.get(rec["status"], "??")
        print(f"{flag} [{rec['status']:16}] {rec['title']}  "
              f"({len(rec['chords'])} akordů{' ' + ','.join(rec['unknown']) if rec['unknown'] else ''})")
        if rec["status"] in ("ok", "needs-review", "error"):
            n += 1
            time.sleep(DELAY)
        if args.limit and n >= args.limit:
            break

    from collections import Counter
    print("\nSouhrn:", dict(Counter(r["status"] for r in records)))

    # report covers the full scope; only write it on a full (unfiltered) run
    if not args.source and not args.limit:
        write_report(records)
        print(f"Report: {REPORT}")
        if args.commit:
            commit_results(records)
