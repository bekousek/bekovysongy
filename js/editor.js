/**
 * editor.js - In-browser song editor with GitHub save
 */
(function () {
  'use strict';

  const REPO_PATH_PREFIX = 'songs/';
  const SONGS_JSON_PATH = 'songs.json';
  const BRANCH = 'main';

  // DOM refs
  const setupPanel = document.getElementById('setup-panel');
  const editorContainer = document.getElementById('editor-container');
  const ghTokenInput = document.getElementById('gh-token');
  const ghRepoInput = document.getElementById('gh-repo');
  const saveTokenBtn = document.getElementById('save-token-btn');
  const editorSearch = document.getElementById('editor-search');
  const songListEl = document.getElementById('song-list');
  const editorPlaceholder = document.getElementById('editor-placeholder');
  const editorActive = document.getElementById('editor-active');
  const editTitle = document.getElementById('edit-title');
  const editAuthor = document.getElementById('edit-author');
  const editorArea = document.getElementById('editor-area');
  const editorPreview = document.getElementById('editor-preview');
  const editorStatus = document.getElementById('editor-status');
  const btnSave = document.getElementById('btn-save');
  const btnPreview = document.getElementById('btn-preview');
  const chordInput = document.getElementById('chord-input');
  const btnInsertChord = document.getElementById('btn-insert-chord');

  let ghToken = '';
  let ghRepo = '';
  let allSongs = [];
  let currentSong = null;
  let originalContent = '';
  let isPreviewMode = false;
  let modifiedSlugs = new Set();

  // === Init ===
  function init() {
    ghToken = localStorage.getItem('gh_token') || '';
    ghRepo = localStorage.getItem('gh_repo') || 'bekousek/bekovysongy';

    if (ghToken) {
      showEditor();
    } else {
      setupPanel.style.display = '';
      editorContainer.style.display = 'none';
    }

    saveTokenBtn.addEventListener('click', saveToken);
    editorSearch.addEventListener('input', filterSongList);
    btnSave.addEventListener('click', saveToGitHub);
    btnPreview.addEventListener('click', togglePreview);
    btnInsertChord.addEventListener('click', () => insertChord(chordInput.value.trim()));
    chordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        insertChord(chordInput.value.trim());
      }
    });

    // Quick chord buttons
    document.querySelectorAll('.btn-quick-chord').forEach(btn => {
      btn.addEventListener('click', () => insertChord(btn.dataset.chord));
    });

    // Track modifications
    editorArea.addEventListener('input', () => {
      if (currentSong) {
        modifiedSlugs.add(currentSong.slug);
        updateSongListItem(currentSong.slug);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveToGitHub();
      }
    });

    // Handle chord deletion - delete whole chord span on backspace
    editorArea.addEventListener('keydown', handleEditorKeydown);
  }

  function saveToken() {
    const token = ghTokenInput.value.trim();
    const repo = ghRepoInput.value.trim();
    if (!token) return;
    ghToken = token;
    ghRepo = repo || 'bekousek/bekovysongy';
    localStorage.setItem('gh_token', ghToken);
    localStorage.setItem('gh_repo', ghRepo);
    showEditor();
  }

  function showEditor() {
    setupPanel.style.display = 'none';
    editorContainer.style.display = 'flex';
    ghRepoInput.value = ghRepo;
    loadSongList();
  }

  // === Song List ===
  async function loadSongList() {
    try {
      const resp = await fetch('../songs.json');
      const data = await resp.json();
      allSongs = data.songs;
      renderSongList(allSongs);
    } catch (e) {
      setStatus('Chyba při načítání songs.json', 'error');
    }
  }

  function renderSongList(songs) {
    songListEl.innerHTML = '';
    songs.forEach(song => {
      const li = document.createElement('li');
      li.dataset.slug = song.slug;
      li.innerHTML = `${song.title}<span class="song-list-author">${song.author || ''}</span>`;
      if (modifiedSlugs.has(song.slug)) li.classList.add('modified');
      if (currentSong && currentSong.slug === song.slug) li.classList.add('active');
      li.addEventListener('click', () => loadSong(song));
      songListEl.appendChild(li);
    });
  }

  function updateSongListItem(slug) {
    const li = songListEl.querySelector(`[data-slug="${slug}"]`);
    if (li) li.classList.add('modified');
  }

  function filterSongList() {
    const q = editorSearch.value.toLowerCase().trim();
    const filtered = allSongs.filter(s =>
      (s.title + ' ' + s.author).toLowerCase().includes(q)
    );
    renderSongList(filtered);
  }

  // === Load Song ===
  async function loadSong(song) {
    currentSong = song;
    editorPlaceholder.style.display = 'none';
    editorActive.style.display = 'flex';
    isPreviewMode = false;
    editorArea.style.display = '';
    editorPreview.style.display = 'none';

    editTitle.value = song.title;
    editAuthor.value = song.author || '';

    setStatus('Načítám...', '');

    try {
      const resp = await fetch(`../songs/${song.slug}.html`);
      const html = await resp.text();

      // Extract pre content
      const m = html.match(/<pre class="song-text">([\s\S]*?)<\/pre>/);
      if (m) {
        originalContent = m[1];
        editorArea.innerHTML = m[1];
      } else {
        editorArea.innerHTML = '<em>Nepodařilo se načíst obsah</em>';
      }

      // Update active state in list
      songListEl.querySelectorAll('li').forEach(li => {
        li.classList.toggle('active', li.dataset.slug === song.slug);
      });

      setStatus(`Načteno: ${song.title}`, 'success');
    } catch (e) {
      setStatus('Chyba při načítání písně', 'error');
    }
  }

  // === Chord insertion ===
  function insertChord(chordName) {
    if (!chordName) return;

    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    if (!editorArea.contains(sel.anchorNode)) {
      editorArea.focus();
    }

    const range = sel.getRangeAt(0);

    const span = document.createElement('span');
    span.className = 'chord';
    span.dataset.chord = chordName;
    span.textContent = chordName;
    span.contentEditable = 'false';

    // Insert space before if needed
    const before = range.startContainer;
    if (before.nodeType === Node.TEXT_NODE && before.textContent.length > 0) {
      const charBefore = before.textContent[range.startOffset - 1];
      if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
        range.insertNode(document.createTextNode(' '));
        range.collapse(false);
      }
    }

    range.insertNode(span);

    // Insert space after
    const spaceAfter = document.createTextNode(' ');
    span.after(spaceAfter);

    // Move cursor after the space
    range.setStartAfter(spaceAfter);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    chordInput.value = '';
    if (currentSong) modifiedSlugs.add(currentSong.slug);
  }

  // === Editor keydown handling ===
  function handleEditorKeydown(e) {
    // When backspace is pressed and cursor is right after a chord span, delete the whole span
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);

      if (range.collapsed) {
        const node = range.startContainer;
        const offset = range.startOffset;

        // Check if previous sibling is a chord span
        if (node.nodeType === Node.TEXT_NODE && offset === 0) {
          const prev = node.previousSibling;
          if (prev && prev.classList && prev.classList.contains('chord')) {
            e.preventDefault();
            prev.remove();
            if (currentSong) modifiedSlugs.add(currentSong.slug);
            return;
          }
        }

        // Check if we're at the start of editorArea and prev element is chord
        if (node === editorArea && offset > 0) {
          const child = editorArea.childNodes[offset - 1];
          if (child && child.classList && child.classList.contains('chord')) {
            e.preventDefault();
            child.remove();
            if (currentSong) modifiedSlugs.add(currentSong.slug);
            return;
          }
        }
      }
    }
  }

  // === Preview ===
  function togglePreview() {
    isPreviewMode = !isPreviewMode;
    if (isPreviewMode) {
      editorArea.style.display = 'none';
      editorPreview.style.display = '';
      editorPreview.innerHTML = editorArea.innerHTML;
    } else {
      editorArea.style.display = '';
      editorPreview.style.display = 'none';
    }
  }

  // === Save to GitHub ===
  async function saveToGitHub() {
    if (!currentSong || !ghToken) return;

    btnSave.disabled = true;
    setStatus('Ukládám na GitHub...', 'saving');

    try {
      // 1. Get the current file content from GitHub to get its SHA
      const filePath = `${REPO_PATH_PREFIX}${currentSong.slug}.html`;
      const fileResp = await ghAPI(`/repos/${ghRepo}/contents/${filePath}?ref=${BRANCH}`);
      const fileSha = fileResp.sha;

      // 2. Build updated HTML
      const newTitle = editTitle.value.trim() || currentSong.title;
      const newAuthor = editAuthor.value.trim();
      const newContent = editorArea.innerHTML;

      // Read the full original file to preserve structure
      const originalHTML = atob(fileResp.content);
      let updatedHTML = originalHTML;

      // Update title
      updatedHTML = updatedHTML.replace(
        /<h1>.*?<\/h1>/,
        `<h1>${escapeHtml(newTitle)}</h1>`
      );

      // Update author
      if (newAuthor) {
        if (updatedHTML.includes('class="song-author"')) {
          updatedHTML = updatedHTML.replace(
            /<p class="song-author">.*?<\/p>/,
            `<p class="song-author">${escapeHtml(newAuthor)}</p>`
          );
        } else {
          updatedHTML = updatedHTML.replace(
            '</div>\n    <pre',
            `<p class="song-author">${escapeHtml(newAuthor)}</p>\n    </div>\n    <pre`
          );
        }
      }

      // Update song content
      updatedHTML = updatedHTML.replace(
        /<pre class="song-text">[\s\S]*?<\/pre>/,
        `<pre class="song-text">${newContent}</pre>`
      );

      // Update <title>
      updatedHTML = updatedHTML.replace(
        /<title>.*?<\/title>/,
        `<title>${escapeHtml(newTitle)} - Bekovy songy</title>`
      );

      // Update mailto subject
      updatedHTML = updatedHTML.replace(
        /mailto:bek@bekovysongy\.cz\?subject=[^"]+/,
        `mailto:bek@bekovysongy.cz?subject=Bug: ${encodeURIComponent(newTitle)}`
      );

      // 3. Commit the file
      const encoded = btoa(unescape(encodeURIComponent(updatedHTML)));
      await ghAPI(`/repos/${ghRepo}/contents/${filePath}`, 'PUT', {
        message: `Edit: ${newTitle}`,
        content: encoded,
        sha: fileSha,
        branch: BRANCH
      });

      // 4. Update songs.json if title or author changed
      if (newTitle !== currentSong.title || newAuthor !== (currentSong.author || '')) {
        await updateSongsJson(currentSong.slug, newTitle, newAuthor, newContent);
      }

      // Update local state
      currentSong.title = newTitle;
      currentSong.author = newAuthor;
      modifiedSlugs.delete(currentSong.slug);
      originalContent = newContent;

      // Refresh list
      filterSongList();

      setStatus(`Uloženo: ${newTitle}`, 'success');
    } catch (e) {
      setStatus(`Chyba: ${e.message}`, 'error');
      console.error(e);
    } finally {
      btnSave.disabled = false;
    }
  }

  async function updateSongsJson(slug, newTitle, newAuthor, htmlContent) {
    try {
      const resp = await ghAPI(`/repos/${ghRepo}/contents/${SONGS_JSON_PATH}?ref=${BRANCH}`);
      const content = decodeURIComponent(escape(atob(resp.content)));
      const data = JSON.parse(content);

      const song = data.songs.find(s => s.slug === slug);
      if (song) {
        song.title = newTitle;
        song.author = newAuthor;

        // Extract chords from HTML content
        const chords = new Set();
        const re = /data-chord="([^"]+)"/g;
        let m;
        while ((m = re.exec(htmlContent)) !== null) {
          chords.add(m[1]);
        }
        song.chords = Array.from(chords).sort();
      }

      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
      await ghAPI(`/repos/${ghRepo}/contents/${SONGS_JSON_PATH}`, 'PUT', {
        message: `Update metadata: ${newTitle}`,
        content: encoded,
        sha: resp.sha,
        branch: BRANCH
      });
    } catch (e) {
      console.warn('Failed to update songs.json:', e);
    }
  }

  // === GitHub API helper ===
  async function ghAPI(path, method = 'GET', body = null) {
    const opts = {
      method,
      headers: {
        'Authorization': `token ${ghToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(`https://api.github.com${path}`, opts);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API ${resp.status}`);
    }
    return resp.json();
  }

  // === Utilities ===
  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStatus(msg, type) {
    editorStatus.textContent = msg;
    editorStatus.className = 'editor-status' + (type ? ' ' + type : '');
  }

  // Boot
  init();
})();
