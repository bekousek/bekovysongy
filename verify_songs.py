#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_songs.py - Compare local song HTML files against old bekovysongy.cz website.
Fixes text/chord errors and writes a verification_report.md.

Usage: python verify_songs.py
Resume-safe: re-run picks up from last processed song.
"""

import json
import re
import sys
import time
from html import escape as html_escape
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

BASE_URL = "https://www.bekovysongy.cz"
SONGS_DIR = Path("songs")
SONGS_JSON = Path("songs.json")
REPORT_FILE = Path("verification_report.md")
DELAY = 0.35  # seconds between requests

CHORD_DB = {
    'C', 'D', 'E', 'F', 'G', 'A', 'H', 'B',
    'Ami', 'Am', 'Dmi', 'Dm', 'Emi', 'Em', 'Fmi', 'F#mi', 'F#m',
    'Gmi', 'G#mi', 'Hmi', 'Cmi', 'C#mi', 'C#m', 'D#mi',
    'C7', 'D7', 'E7', 'F7', 'G7', 'A7', 'H7', 'B7',
    'Ami7', 'Emi7', 'Dmi7', 'Gmi7',
    'Cmaj7', 'Fmaj7', 'Gmaj7', 'Cmaj',
    'Asus2', 'Asus4', 'Dsus2', 'Dsus4', 'Esus4', 'Gsus4',
    'Cadd9', 'Fadd9',
    'Cdim', 'C#dim', 'Fdim', 'F#dim', 'Gdim',
    'Ami6', 'F#', 'F#6', 'F6', 'G6', 'C#', 'Eb', 'Ab7', 'A2',
}


# ──────────────────────────────────────────────
# REPORT
# ──────────────────────────────────────────────

def load_done_slugs():
    """Return set of slugs already recorded in the report."""
    done = set()
    if not REPORT_FILE.exists():
        return done
    with open(REPORT_FILE, encoding='utf-8') as f:
        for line in f:
            if line.startswith('| ') and ' | ' in line:
                parts = [p.strip() for p in line.split('|')]
                if len(parts) >= 2 and parts[1] and parts[1] not in ('Slug', '---'):
                    done.add(parts[1])
    return done


def init_report():
    if not REPORT_FILE.exists():
        with open(REPORT_FILE, 'w', encoding='utf-8') as f:
            f.write('# Verification Report\n\n')
            f.write('| Slug | Title | Status | Notes |\n')
            f.write('|---|---|---|---|\n')


def append_report(slug, title, status, notes=''):
    notes_safe = notes.replace('|', '/').replace('\n', ' ')[:300]
    with open(REPORT_FILE, 'a', encoding='utf-8') as f:
        f.write(f'| {slug} | {title} | {status} | {notes_safe} |\n')


# ──────────────────────────────────────────────
# TOKEN HELPERS
# A "token" is (type, content) where type is 'chord', 'text', or 'newline'
# ──────────────────────────────────────────────

def tok_text(s):
    return ('text', s)

def tok_chord(name):
    return ('chord', name)

def tok_nl():
    return ('newline', '\n')


# ──────────────────────────────────────────────
# OLD WEBSITE PARSING
# ──────────────────────────────────────────────

def parse_font_element(font_el):
    """Parse <font class="wsw-12"> into a list of chord/text tokens."""
    raw = font_el.get_text().replace('\xa0', ' ')
    has_lead = raw != raw.lstrip(' ')
    has_trail = raw != raw.rstrip(' ')

    names = raw.split()
    tokens = []
    if has_lead:
        tokens.append(tok_text(' '))
    for i, name in enumerate(names):
        name = name.strip(',.;:')
        if name:
            tokens.append(tok_chord(name))
            if i < len(names) - 1:
                tokens.append(tok_text(' '))
    if has_trail and names:
        tokens.append(tok_text(' '))
    return tokens


def merge_adjacent_chord_fragments(tokens):
    """
    Merge consecutive chord tokens that have no text between them,
    when their concatenation is in CHORD_DB. E.g.: F + # + mi → F#mi.
    """
    result = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok[0] == 'chord':
            # Try to extend by consuming immediately-following chord tokens
            # (no text/newline between them = they're fragments of one chord name)
            combined = tok[1]
            j = i + 1
            while j < len(tokens) and tokens[j][0] == 'chord':
                candidate = combined + tokens[j][1]
                if candidate in CHORD_DB:
                    combined = candidate
                    j += 1
                else:
                    # Can't merge further — try one more step in case it's like F + # (→F#) + mi (→F#mi)
                    if j + 1 < len(tokens) and tokens[j + 1][0] == 'chord':
                        candidate2 = candidate + tokens[j + 1][1]
                        if candidate2 in CHORD_DB:
                            combined = candidate2
                            j += 2
                            continue
                    break
            result.append(('chord', combined))
            i = j
        else:
            result.append(tok)
            i += 1
    return result


def parse_p_element(p_el):
    """
    Parse a <p> element from old website into a flat token list.
    <br> → newline token; <font wsw-12> → chord tokens; text nodes → text tokens.
    Literal newlines in text nodes are whitespace in HTML, not line breaks.
    Consecutive adjacent chord fragments (like F + # + mi) are merged into one.
    """
    tokens = []
    for child in p_el.children:
        if isinstance(child, NavigableString):
            # In HTML, literal newlines in text nodes are whitespace (not <br>)
            text = str(child).replace('\xa0', ' ').replace('\n', ' ').replace('\r', '')
            if text:
                tokens.append(tok_text(text))
        elif isinstance(child, Tag):
            if child.name == 'br':
                tokens.append(tok_nl())
            elif child.name == 'font' and 'wsw-12' in child.get('class', []):
                tokens.extend(parse_font_element(child))
            elif child.name == 'font':
                # Nested font: look for wsw-12 inside
                inner = child.find('font', class_='wsw-12')
                if inner:
                    tokens.extend(parse_font_element(inner))
                else:
                    text = child.get_text().replace('\xa0', ' ')
                    if text:
                        tokens.append(tok_text(text))
            elif child.name == 'blockquote':
                pass  # skip fingering notes inside p
            else:
                text = child.get_text().replace('\xa0', ' ')
                if text:
                    tokens.append(tok_text(text))
    return merge_adjacent_chord_fragments(tokens)


def parse_old_song(html):
    """
    Parse old website HTML.
    Returns (list_of_stanzas, author_str, capo_str).
    Each stanza is a list of lines; each line is a list of tokens.
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Author from h3 in the first b-text-c block
    author = ''
    capo_text = ''
    h3 = soup.find('h3')
    if h3:
        author = h3.get_text(strip=True)

    content_divs = soup.find_all('div', class_='b-text-c')
    stanzas = []

    for div in content_divs:
        if div.find('h1'):
            continue  # page title block
        if div.find('blockquote') and not div.find('font', class_='wsw-12'):
            continue  # fingering-only block

        # Process ALL direct children in document order.
        # Some songs have content directly in div (no <p> wrapper): accumulate those.
        direct_tokens = []

        for child in list(div.children):
            if isinstance(child, NavigableString):
                text = str(child).replace('\xa0', ' ').replace('\n', ' ').replace('\r', '')
                if text.strip():
                    direct_tokens.append(tok_text(text))
            elif isinstance(child, Tag):
                if child.name == 'p':
                    # Flush any accumulated direct content first
                    if direct_tokens:
                        stanza = split_tokens_into_lines(merge_adjacent_chord_fragments(direct_tokens))
                        if stanza:
                            stanzas.append(stanza)
                        direct_tokens = []
                    # Process this <p> as its own stanza
                    if not child.find('blockquote'):
                        toks = parse_p_element(child)
                        if toks and any(c.strip() for t, c in toks if t in ('text', 'chord')):
                            flat = ''.join(c for t, c in toks if t == 'text')
                            if re.search(r'capo', flat, re.IGNORECASE):
                                m = re.search(r'[Cc]apo\s*(\d+)', flat)
                                if m:
                                    capo_text = f'Capo {m.group(1)}'
                            else:
                                stanza = split_tokens_into_lines(toks)
                                if stanza:
                                    stanzas.append(stanza)

                elif child.name == 'br':
                    direct_tokens.append(tok_nl())

                elif child.name == 'font' and 'wsw-12' in child.get('class', []):
                    direct_tokens.extend(parse_font_element(child))

                elif child.name in ('h2', 'h3'):
                    if direct_tokens:
                        stanza = split_tokens_into_lines(merge_adjacent_chord_fragments(direct_tokens))
                        if stanza:
                            stanzas.append(stanza)
                        direct_tokens = []
                    text = child.get_text(strip=True)
                    if text:
                        stanzas.append([[('text', text)]])

                elif child.name == 'div':
                    if direct_tokens:
                        stanza = split_tokens_into_lines(merge_adjacent_chord_fragments(direct_tokens))
                        if stanza:
                            stanzas.append(stanza)
                        direct_tokens = []
                    for nested_p in child.find_all('p'):
                        if nested_p.find('blockquote'):
                            continue
                        toks = parse_p_element(nested_p)
                        if not toks or not any(c.strip() for t, c in toks if t in ('text', 'chord')):
                            continue
                        flat = ''.join(c for t, c in toks if t == 'text')
                        if re.search(r'capo', flat, re.IGNORECASE):
                            m = re.search(r'[Cc]apo\s*(\d+)', flat)
                            if m:
                                capo_text = f'Capo {m.group(1)}'
                        else:
                            stanza = split_tokens_into_lines(toks)
                            if stanza:
                                stanzas.append(stanza)

                elif child.name == 'blockquote':
                    if direct_tokens:
                        stanza = split_tokens_into_lines(merge_adjacent_chord_fragments(direct_tokens))
                        if stanza:
                            stanzas.append(stanza)
                        direct_tokens = []

                elif child.name == 'font':
                    # Non-wsw-12 font — check for nested wsw-12
                    inner = child.find('font', class_='wsw-12')
                    if inner:
                        direct_tokens.extend(parse_font_element(inner))
                    else:
                        text = child.get_text().replace('\xa0', ' ').replace('\n', ' ')
                        if text.strip():
                            direct_tokens.append(tok_text(text))

        # Flush any remaining direct content
        if direct_tokens:
            stanza = split_tokens_into_lines(direct_tokens)
            if stanza:
                stanzas.append(stanza)

    return stanzas, author, capo_text


def split_tokens_into_lines(tokens):
    """Split flat token list by newline tokens into list-of-lines."""
    lines = [[]]
    for tok in tokens:
        if tok[0] == 'newline':
            lines.append([])
        else:
            lines[-1].append(tok)
    # Remove empty trailing lines
    while lines and not any(c.strip() for _, c in lines[-1]):
        lines.pop()
    # Remove empty leading lines
    while lines and not any(c.strip() for _, c in lines[0]):
        lines.pop(0)
    return lines


# ──────────────────────────────────────────────
# LOCAL FILE PARSING
# ──────────────────────────────────────────────

def get_inline_tokens(node):
    """Recursively extract (chord|text|newline) tokens from a node."""
    tokens = []
    if isinstance(node, NavigableString):
        text = str(node).replace('\xa0', ' ')
        if text:
            tokens.append(tok_text(text))
    elif isinstance(node, Tag):
        if node.name == 'span' and 'chord' in node.get('class', []):
            name = node.get('data-chord', '').strip()
            if name:
                tokens.append(tok_chord(name))
            else:
                tokens.append(tok_text(node.get_text()))
        elif node.name == 'br':
            tokens.append(tok_nl())
        elif node.name == 'div':
            # Treat div as stanza separator for normalization purposes
            tokens.append(('stanza-break', ''))
            for child in node.children:
                tokens.extend(get_inline_tokens(child))
            tokens.append(('stanza-break', ''))
        else:
            for child in node.children:
                tokens.extend(get_inline_tokens(child))
    return tokens


def parse_local_song(html):
    """
    Parse local song HTML.
    Returns flat token list (text/chord/newline/stanza-break).
    """
    soup = BeautifulSoup(html, 'html.parser')
    pre = soup.find('pre', class_='song-text')
    if not pre:
        return None
    tokens = []
    for child in pre.children:
        tokens.extend(get_inline_tokens(child))
    return tokens


# ──────────────────────────────────────────────
# NORMALIZATION + COMPARISON
# ──────────────────────────────────────────────

def stanzas_to_norm_lines(stanzas):
    """Convert list-of-stanzas to list of normalized line strings for comparison."""
    all_lines = []
    for stanza in stanzas:
        for line in stanza:
            norm = normalize_line(line)
            all_lines.append(norm)
        all_lines.append('')  # blank line between stanzas
    while all_lines and not all_lines[-1]:
        all_lines.pop()
    return all_lines


def normalize_line(tokens):
    parts = []
    for tok_type, tok_content in tokens:
        if tok_type == 'chord':
            parts.append(f'[{tok_content}]')
        else:
            parts.append(tok_content)
    result = ''.join(parts).replace('\xa0', ' ')
    return re.sub(r'[ \t]+', ' ', result).strip()


def flat_tokens_to_norm_lines(tokens):
    """
    Convert flat token list (with newline/stanza-break) to norm lines.
    stanza-break → blank line; newline → new line.
    """
    lines = [[]]
    prev_was_break = False

    for tok_type, tok_content in tokens:
        if tok_type == 'stanza-break':
            if lines[-1]:  # don't add double blank
                lines.append([])
            prev_was_break = True
        elif tok_type == 'newline':
            lines.append([])
            prev_was_break = False
        elif tok_type in ('text', 'chord'):
            if tok_type == 'text' and '\n' in tok_content:
                parts = tok_content.split('\n')
                if parts[0]:
                    lines[-1].append((tok_type, parts[0]))
                for part in parts[1:]:
                    lines.append([])
                    if part:
                        lines[-1].append(('text', part))
            else:
                lines[-1].append((tok_type, tok_content))
            prev_was_break = False

    # Normalize each line
    norm = []
    for line in lines:
        norm.append(normalize_line(line))

    # Collapse multiple blank lines to one
    out = []
    prev_blank = False
    for l in norm:
        if not l:
            if not prev_blank:
                out.append('')
            prev_blank = True
        else:
            out.append(l)
            prev_blank = False

    while out and not out[0]:
        out.pop(0)
    while out and not out[-1]:
        out.pop()

    return out


def compare(old_stanzas, local_tokens):
    """
    Compare old website stanzas with local token list.
    Returns (is_same: bool, diff_summary: str, old_norm_lines, new_norm_lines).
    """
    old_lines = stanzas_to_norm_lines(old_stanzas)
    new_lines = flat_tokens_to_norm_lines(local_tokens)

    if old_lines == new_lines:
        return True, '', old_lines, new_lines

    diffs = []
    max_len = max(len(old_lines), len(new_lines))
    for i in range(max_len):
        ol = old_lines[i] if i < len(old_lines) else '<MISSING>'
        nl = new_lines[i] if i < len(new_lines) else '<MISSING>'
        if ol != nl:
            diffs.append(f'L{i+1}: got "{nl}" | want "{ol}"')
            if len(diffs) >= 8:
                diffs.append(f'... ({max_len - i - 1} more lines differ)')
                break

    return False, '\n'.join(diffs), old_lines, new_lines


# ──────────────────────────────────────────────
# HTML REBUILD
# ──────────────────────────────────────────────

def chord_span(name):
    e = html_escape(name)
    return f'<span class="chord" data-chord="{e}">{e}</span>'


def line_to_html(line):
    parts = []
    for tok_type, tok_content in line:
        if tok_type == 'chord':
            parts.append(chord_span(tok_content))
        else:
            parts.append(html_escape(tok_content))
    return ''.join(parts)


def stanzas_to_pre_html(stanzas):
    """
    Build pre content from stanzas.
    Stanzas separated by blank line; lines within stanza by \\n.
    """
    stanza_htmls = []
    for stanza in stanzas:
        stanza_htmls.append('\n'.join(line_to_html(line) for line in stanza))
    return '\n\n'.join(stanza_htmls)


def fix_local_pre(slug, old_stanzas):
    """Replace <pre class="song-text"> content with rebuilt content from old stanzas."""
    local_file = SONGS_DIR / f'{slug}.html'
    if not local_file.exists():
        return False, 'File not found'

    with open(local_file, 'r', encoding='utf-8') as f:
        html = f.read()

    new_pre_content = stanzas_to_pre_html(old_stanzas)

    PRE_OPEN = '<pre class="song-text">'
    PRE_CLOSE = '</pre>'

    start = html.find(PRE_OPEN)
    if start == -1:
        return False, '<pre class="song-text"> not found'
    end = html.find(PRE_CLOSE, start)
    if end == -1:
        return False, '</pre> not found'

    new_html = html[:start + len(PRE_OPEN)] + new_pre_content + html[end:]

    with open(local_file, 'w', encoding='utf-8') as f:
        f.write(new_html)

    return True, ''


# ──────────────────────────────────────────────
# CHORD DB CHECK
# ──────────────────────────────────────────────

def chords_not_in_db(stanzas):
    missing = set()
    for stanza in stanzas:
        for line in stanza:
            for tok_type, tok_content in line:
                if tok_type == 'chord' and tok_content not in CHORD_DB:
                    missing.add(tok_content)
    return sorted(missing)


# ──────────────────────────────────────────────
# MAIN PROCESSING
# ──────────────────────────────────────────────

def process_song(slug, song_data, session):
    """Fetch, parse, compare, fix. Returns (status, notes)."""
    url = f'{BASE_URL}/{slug}/'

    try:
        resp = session.get(url, timeout=20)
    except requests.RequestException as e:
        return 'error', f'Network: {e}'

    if resp.status_code == 404:
        return '404', 'Old site returned 404'
    if resp.status_code != 200:
        return 'error', f'HTTP {resp.status_code}'

    resp.encoding = 'utf-8'  # Webnode site is UTF-8

    # Parse old website
    try:
        old_stanzas, old_author, old_capo = parse_old_song(resp.text)
    except Exception as e:
        return 'error', f'Parse old: {e}'

    if not old_stanzas:
        return 'error', 'No song content on old site'

    # Parse local file
    local_file = SONGS_DIR / f'{slug}.html'
    if not local_file.exists():
        return 'error', 'Local file missing'

    try:
        with open(local_file, 'r', encoding='utf-8') as f:
            local_html = f.read()
        local_tokens = parse_local_song(local_html)
    except Exception as e:
        return 'error', f'Parse local: {e}'

    if local_tokens is None:
        return 'error', 'No <pre class="song-text"> in local file'

    # Compare
    same, diff_str, old_norm, new_norm = compare(old_stanzas, local_tokens)

    # Check chords
    missing_chords = chords_not_in_db(old_stanzas)

    notes_parts = []

    if not same:
        ok, err = fix_local_pre(slug, old_stanzas)
        if ok:
            notes_parts.append(f'Fixed {len([l for l in old_norm if l]) - len([l for l in new_norm if l])} missing lines / chord diffs')
            notes_parts.append(diff_str)
        else:
            notes_parts.append(f'Fix failed ({err}): {diff_str}')
        status = 'fixed' if ok else 'error'
    else:
        status = 'OK'

    if missing_chords:
        notes_parts.append(f'Chords not in CHORD_DB: {", ".join(missing_chords)}')
        if status == 'OK':
            status = 'OK-chord-missing'

    return status, '\n'.join(notes_parts)


def main():
    print('=== Song Verifier ===')

    songs = json.loads(SONGS_JSON.read_text(encoding='utf-8'))['songs']
    done = load_done_slugs()

    print(f'Total: {len(songs)} | Already done: {len(done)}')

    pending = [s for s in songs if s['slug'] not in done]
    print(f'Pending: {len(pending)}')

    if not pending:
        print('All songs already verified.')
        return

    init_report()

    session = requests.Session()
    session.headers['User-Agent'] = 'Mozilla/5.0 (SongVerifier/1.0)'

    stats = {}

    for i, song in enumerate(pending):
        slug = song['slug']
        title = song['title']

        sys.stdout.write(f'[{i+1}/{len(pending)}] {slug}: ')
        sys.stdout.flush()

        try:
            status, notes = process_song(slug, song, session)
        except Exception as e:
            status, notes = 'error', f'Unexpected: {e}'

        stats[status] = stats.get(status, 0) + 1
        short = (notes[:120] + '...') if len(notes) > 120 else notes
        print(f'{status} | {short.replace(chr(10), " | ")}')

        append_report(slug, title, status, notes)
        time.sleep(DELAY)

    total = sum(stats.values())
    remaining = len(songs) - len(done) - total

    print('\n=== Summary ===')
    for k, v in sorted(stats.items()):
        print(f'  {k}: {v}')
    print(f'  Total processed this run: {total}')
    print(f'  Still remaining: {remaining}')


if __name__ == '__main__':
    main()
