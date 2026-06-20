/**
 * editor.js - In-browser song editor with GitHub save
 */
(function () {
  'use strict';

  const REPO_PATH_PREFIX = 'songs/';
  const SONGS_JSON_PATH = 'songs.json';
  const BRANCH = 'main';

  // Google sign-in gate. GOOGLE_CLIENT_ID doplň z Google Cloud Console
  // (OAuth Client ID typu "Web application", vypadá jako "…apps.googleusercontent.com").
  const GOOGLE_CLIENT_ID = '606957226831-ii7i1f725cscngskp3htedeqvv9cinhk.apps.googleusercontent.com';
  const ALLOWED_EMAIL = 'ondrejbek8@gmail.com';

  // DOM refs
  const loginPanel = document.getElementById('login-panel');
  const googleBtnContainer = document.getElementById('google-signin-btn');
  const loginMsg = document.getElementById('login-msg');
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
  const editCapo = document.getElementById('edit-capo');
  const editLanguage = document.getElementById('edit-language');
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
  let isAuthed = false;

  // === Init ===
  function init() {
    ghToken = localStorage.getItem('gh_token') || '';
    ghRepo = localStorage.getItem('gh_repo') || 'bekousek/bekovysongy';

    // Until Google sign-in succeeds, show only the login gate.
    loginPanel.style.display = '';
    setupPanel.style.display = 'none';
    editorContainer.style.display = 'none';
    bootGoogleAuth();

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

  // === Google sign-in gate ===
  function bootGoogleAuth() {
    if (!GOOGLE_CLIENT_ID) {
      loginMsg.textContent = 'Editor zatím není nakonfigurovaný (chybí Google Client ID).';
      return;
    }
    // GSI knihovna se načítá asynchronně – počkej, až bude k dispozici.
    if (window.google && google.accounts && google.accounts.id) {
      initGoogleAuth();
    } else {
      window.onGoogleLibraryLoad = initGoogleAuth;
    }
  }

  function initGoogleAuth() {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: true
    });
    google.accounts.id.renderButton(googleBtnContainer, {
      theme: 'filled_blue',
      size: 'large',
      text: 'signin_with',
      shape: 'pill'
    });
    // One Tap (tichý návrat přihlášeného uživatele); tlačítko je fallback.
    google.accounts.id.prompt();
  }

  function handleCredentialResponse(response) {
    const payload = parseJwt(response && response.credential);
    if (!payload) {
      loginMsg.textContent = 'Přihlášení se nezdařilo, zkus to prosím znovu.';
      return;
    }
    const emailOk = payload.email === ALLOWED_EMAIL && payload.email_verified === true;
    const audOk = payload.aud === GOOGLE_CLIENT_ID;
    const notExpired = typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();

    if (emailOk && audOk && notExpired) {
      isAuthed = true;
      onAuthSuccess();
    } else {
      isAuthed = false;
      loginMsg.textContent = 'Přístup zamítnut pro účet: ' + (payload.email || 'neznámý') + '.';
    }
  }

  function onAuthSuccess() {
    loginPanel.style.display = 'none';
    if (ghToken) {
      showEditor();
    } else {
      setupPanel.style.display = '';
    }
  }

  function parseJwt(token) {
    if (!token) return null;
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
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
    editCapo.value = (song.tags && song.tags.capo) ? song.tags.capo : '';
    editLanguage.value = (song.tags && song.tags.language) ? song.tags.language : '';

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

  // === Save to GitHub (single atomic commit) ===
  async function saveToGitHub() {
    if (!currentSong || !ghToken) return;

    btnSave.disabled = true;
    setStatus('Ukládám na GitHub...', 'saving');

    try {
      const filePath = `${REPO_PATH_PREFIX}${currentSong.slug}.html`;

      // Values from the form
      const newTitle = editTitle.value.trim() || currentSong.title;
      const newAuthor = editAuthor.value.trim();
      const newCapo = editCapo.value ? parseInt(editCapo.value) : 0;
      const newLanguage = editLanguage.value || '';
      const newContent = editorArea.innerHTML;

      // 1. Build updated song HTML from the current file (preserve structure, UTF-8 safe)
      const originalHTML = await getFileContent(filePath);
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

      // Update capo
      if (newCapo > 0) {
        if (updatedHTML.includes('class="song-capo"')) {
          updatedHTML = updatedHTML.replace(
            /<p class="song-capo">.*?<\/p>/,
            `<p class="song-capo">Capo ${newCapo}</p>`
          );
        } else {
          // Insert before </div> that precedes <pre
          updatedHTML = updatedHTML.replace(
            /(\s*)(    <\/div>\s*\n\s*<pre class="song-text">)/,
            `\n      <p class="song-capo">Capo ${newCapo}</p>\n$2`
          );
        }
      } else {
        // Remove capo line if set to 0
        updatedHTML = updatedHTML.replace(/\s*<p class="song-capo">.*?<\/p>/, '');
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

      // Update mailto subject (if mailto link exists in the file)
      updatedHTML = updatedHTML.replace(
        /mailto:[^?]+\?subject=[^"]+/,
        `mailto:ondrejbek8@gmail.com?subject=Bug: ${encodeURIComponent(newTitle)}`
      );

      // 2. Build updated songs.json (metadata + chords)
      const newSongsJson = await buildUpdatedSongsJson(
        currentSong.slug, newTitle, newAuthor, newCapo, newLanguage, newContent
      );

      // 3. Commit song HTML + songs.json in a SINGLE commit (one deploy, no desync)
      const files = [{ path: filePath, content: updatedHTML }];
      if (newSongsJson !== null) files.push({ path: SONGS_JSON_PATH, content: newSongsJson });
      await commitFiles(files, `Edit: ${newTitle}`);

      // 4. Update local state
      currentSong.title = newTitle;
      currentSong.author = newAuthor;
      if (!currentSong.tags) currentSong.tags = {};
      currentSong.tags.capo = newCapo || false;
      currentSong.tags.language = newLanguage || '';
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

  async function buildUpdatedSongsJson(slug, newTitle, newAuthor, newCapo, newLanguage, htmlContent) {
    try {
      const data = JSON.parse(await getFileContent(SONGS_JSON_PATH));

      const song = data.songs.find(s => s.slug === slug);
      if (song) {
        song.title = newTitle;
        song.author = newAuthor;

        // Update tags
        if (!song.tags) song.tags = {};
        song.tags.capo = newCapo || false;
        if (newLanguage) {
          song.tags.language = newLanguage;
        }

        // Extract chords from HTML content
        const chords = new Set();
        const re = /data-chord="([^"]+)"/g;
        let m;
        while ((m = re.exec(htmlContent)) !== null) {
          chords.add(m[1]);
        }
        song.chords = Array.from(chords).sort();
      }

      return JSON.stringify(data, null, 2);
    } catch (e) {
      console.warn('Failed to build songs.json update:', e);
      return null;
    }
  }

  // === GitHub content read + atomic multi-file commit ===
  async function getFileContent(path) {
    const resp = await ghAPI(`/repos/${ghRepo}/contents/${path}?ref=${BRANCH}`);
    return base64ToUtf8(resp.content);
  }

  // Commit several files in ONE commit via the Git Data API
  // (blob -> tree with base_tree -> commit -> update ref). One push = one deploy.
  async function commitFiles(files, message) {
    const ref = await ghAPI(`/repos/${ghRepo}/git/ref/heads/${BRANCH}`);
    const baseCommitSha = ref.object.sha;
    const baseCommit = await ghAPI(`/repos/${ghRepo}/git/commits/${baseCommitSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    const blobShas = [];
    for (const f of files) {
      const blob = await ghAPI(`/repos/${ghRepo}/git/blobs`, 'POST', {
        content: utf8ToBase64(f.content),
        encoding: 'base64'
      });
      blobShas.push(blob.sha);
    }

    const tree = files.map((f, i) => ({
      path: f.path, mode: '100644', type: 'blob', sha: blobShas[i]
    }));

    const newTree = await ghAPI(`/repos/${ghRepo}/git/trees`, 'POST', {
      base_tree: baseTreeSha,
      tree
    });

    const newCommit = await ghAPI(`/repos/${ghRepo}/git/commits`, 'POST', {
      message,
      tree: newTree.sha,
      parents: [baseCommitSha]
    });

    await ghAPI(`/repos/${ghRepo}/git/refs/heads/${BRANCH}`, 'PATCH', {
      sha: newCommit.sha
    });
  }

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64)));
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
