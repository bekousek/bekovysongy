/**
 * editor.js - In-browser song editor with GitHub save
 */
(function () {
  'use strict';

  const REPO_PATH_PREFIX = 'songs/';
  const SONGS_JSON_PATH = 'songs.json';
  // Override via localStorage('gh_branch') to dry-run saves against a
  // scratch branch instead of main - the deploy workflow only runs on main,
  // so nothing deploys while testing this way.
  const BRANCH = localStorage.getItem('gh_branch') || 'main';

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
  const songListUnchecked = document.getElementById('song-list-unchecked');
  const songListChecked = document.getElementById('song-list-checked');
  const countUnchecked = document.getElementById('count-unchecked');
  const countChecked = document.getElementById('count-checked');
  const sectionUnchecked = document.getElementById('section-unchecked');
  const sectionChecked = document.getElementById('section-checked');
  const btnNewSong = document.getElementById('btn-new-song');
  const btnSaveAll = document.getElementById('btn-save-all');
  const saveAllCount = document.getElementById('save-all-count');
  const newSongDialog = document.getElementById('new-song-dialog');
  const newSongForm = document.getElementById('new-song-form');
  const newTitleInput = document.getElementById('new-title');
  const newAuthorInput = document.getElementById('new-author');
  const newCapoInput = document.getElementById('new-capo');
  const newLanguageSelect = document.getElementById('new-language');
  const newSongSlugPreview = document.getElementById('new-song-slug-preview');
  const btnNewCancel = document.getElementById('btn-new-cancel');
  const editorPlaceholder = document.getElementById('editor-placeholder');
  const editorActive = document.getElementById('editor-active');
  const editTitle = document.getElementById('edit-title');
  const editAuthor = document.getElementById('edit-author');
  const editCapo = document.getElementById('edit-capo');
  const editLanguage = document.getElementById('edit-language');
  const editorArea = document.getElementById('editor-area');
  const editorBody = document.getElementById('editor-body');
  const editorPreview = document.getElementById('editor-preview');
  const previewCollapsed = document.getElementById('preview-collapsed');
  const editorStatus = document.getElementById('editor-status');
  const btnSave = document.getElementById('btn-save');
  const btnPreview = document.getElementById('btn-preview');
  const chordInput = document.getElementById('chord-input');
  const btnInsertChord = document.getElementById('btn-insert-chord');
  const btnFixSpacing = document.getElementById('btn-fix-spacing');
  const btnRemoveEmpty = document.getElementById('btn-remove-empty');
  const btnTransposeDown = document.getElementById('btn-transpose-down');
  const btnTransposeUp = document.getElementById('btn-transpose-up');
  const btnToggleShortcuts = document.getElementById('btn-toggle-shortcuts');

  let ghToken = '';
  let ghRepo = '';
  let allSongs = [];
  let currentSong = null;
  let isAuthed = false;
  let chordShortcutsEnabled = localStorage.getItem('chord_shortcuts') !== 'off';

  // Live preview: on wide screens it sits next to the editor, on narrow ones
  // it replaces it (CSS media query does the layout, JS only flips the class).
  let previewOn = localStorage.getItem('editor_preview') !== 'off';
  const narrowMQ = window.matchMedia('(max-width: 1099px)');

  // slug -> pending entry. An entry exists for every song opened this
  // session (clean or dirty) and every not-yet-pushed new song - it doubles
  // as a content cache so switching songs never needs a re-fetch and never
  // discards unsaved edits (unlike the old confirm-to-discard flow).
  //
  // entry shape: { isNew, rawHtml (song file as fetched; null for new songs),
  //   title, author, capo (int, 0 = none), language, body (<pre> innerHTML),
  //   baseTitle, baseAuthor, baseCapo, baseLanguage, baseBody (values at
  //   load time / last successful save - used to detect dirtiness) }
  const pendingEdits = new Map();

  // Slugs whose "checked" flag has been flipped from its last-persisted
  // value (toggle semantics: present = flipped, absent = at persisted
  // value). Never contains isNew slugs - a new song's checked state is
  // whatever's on its (not-yet-pushed) songs.json entry already.
  const pendingChecked = new Set();

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
    btnSave.addEventListener('click', saveCurrentSong);
    btnSaveAll.addEventListener('click', saveAll);
    btnPreview.addEventListener('click', togglePreview);
    applyPreviewState();

    // Preview interactivity: the collapse checkbox re-renders, section action
    // buttons (join/detach) rewrite the source, pills peek like on the site.
    previewCollapsed.addEventListener('change', () => {
      localStorage.setItem('editor_preview_collapsed', previewCollapsed.checked ? 'on' : 'off');
      renderPreview();
    });
    previewCollapsed.checked = localStorage.getItem('editor_preview_collapsed') !== 'off';
    editorPreview.addEventListener('click', handlePreviewClick);
    btnInsertChord.addEventListener('click', () => insertChord(chordInput.value.trim()));
    chordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        insertChord(chordInput.value.trim());
      }
    });

    // Quick chord buttons + number-key hints (1..9)
    document.querySelectorAll('.btn-quick-chord').forEach((btn, i) => {
      btn.addEventListener('click', () => insertChord(btn.dataset.chord));
      if (i < 9) {
        btn.title = 'Zkratka: ' + (i + 1);
        const hint = document.createElement('span');
        hint.className = 'key-hint';
        hint.textContent = (i + 1);
        btn.prepend(hint);
      }
    });

    // Section marker buttons (insert R: / R1: / S: / B: at the line start)
    document.querySelectorAll('.btn-section').forEach(btn => {
      btn.addEventListener('click', () => insertSectionMarker(btn.dataset.marker));
    });

    // Cleanup + transpose buttons
    btnFixSpacing.addEventListener('click', () => applyCleanup(SongCleanup.normalizeChordSpacing));
    btnRemoveEmpty.addEventListener('click', () => applyCleanup(SongCleanup.removeEmptyLines));
    btnTransposeDown.addEventListener('click', () => applyCleanup(h => SongCleanup.transposeSong(h, -1)));
    btnTransposeUp.addEventListener('click', () => applyCleanup(h => SongCleanup.transposeSong(h, 1)));

    // Chord number-key shortcuts (1..8) inside the editor
    updateShortcutToggle();
    btnToggleShortcuts.addEventListener('click', () => {
      chordShortcutsEnabled = !chordShortcutsEnabled;
      localStorage.setItem('chord_shortcuts', chordShortcutsEnabled ? 'on' : 'off');
      updateShortcutToggle();
    });
    editorArea.addEventListener('keydown', handleChordShortcut);

    // Track modifications (typing, and any toolbar action that edits the body)
    editorArea.addEventListener('input', syncCurrentEdits);

    // Metadata edits didn't mark anything dirty before - now they do too.
    editTitle.addEventListener('input', syncCurrentEdits);
    editAuthor.addEventListener('input', syncCurrentEdits);
    editCapo.addEventListener('input', syncCurrentEdits);
    editLanguage.addEventListener('change', syncCurrentEdits);

    // Keyboard shortcuts: Ctrl/Cmd+S saves the open song, +Shift saves all.
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) saveAll();
        else saveCurrentSong();
      }
    });

    // Warn before closing/reloading the tab with unsaved edits anywhere.
    window.addEventListener('beforeunload', (e) => {
      if (getDirtySlugs().length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Handle chord deletion - delete whole chord span on backspace
    editorArea.addEventListener('keydown', handleEditorKeydown);

    // New-song dialog
    btnNewSong.addEventListener('click', () => {
      newSongForm.reset();
      newCapoInput.value = '0';
      newLanguageSelect.value = 'CZ';
      newSongSlugPreview.textContent = '';
      newSongDialog.showModal();
    });
    btnNewCancel.addEventListener('click', () => newSongDialog.close());
    newTitleInput.addEventListener('input', () => {
      const title = newTitleInput.value.trim();
      if (!title) {
        newSongSlugPreview.textContent = '';
        return;
      }
      const taken = new Set(allSongs.map(s => s.slug));
      newSongSlugPreview.textContent = 'songs/' + SongTemplate.uniqueSlug(SongTemplate.slugify(title), taken) + '.html';
    });
    newSongForm.addEventListener('submit', (e) => {
      e.preventDefault();
      createNewSong();
    });
  }

  // === Google sign-in gate ===
  function bootGoogleAuth() {
    // Local dev: the Google gate is a UX convenience, not security - the
    // real credential is the GitHub PAT, which localStorage on localhost
    // doesn't have unless a developer puts it there deliberately.
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      isAuthed = true;
      onAuthSuccess();
      return;
    }

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
    const unchecked = songs.filter(s => !s.checked);
    const checked = songs.filter(s => s.checked);
    fillList(songListUnchecked, unchecked);
    fillList(songListChecked, checked);
    countUnchecked.textContent = '(' + unchecked.length + ')';
    countChecked.textContent = '(' + checked.length + ')';
  }

  function fillList(ul, songs) {
    ul.innerHTML = '';
    songs.forEach(song => {
      const li = document.createElement('li');
      li.dataset.slug = song.slug;

      const main = document.createElement('div');
      main.className = 'song-list-main';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'song-list-title';
      titleSpan.textContent = song.title;
      main.appendChild(titleSpan);
      const authorSpan = document.createElement('span');
      authorSpan.className = 'song-list-author';
      authorSpan.textContent = song.author || '';
      main.appendChild(authorSpan);
      li.appendChild(main);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn-check-toggle' + (song.checked ? ' on' : '');
      toggle.textContent = '✓';
      toggle.title = song.checked ? 'Vrátit ke kontrole' : 'Označit jako zkontrolováno';
      toggle.setAttribute('aria-pressed', String(!!song.checked));
      toggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleChecked(song);
      });
      li.appendChild(toggle);

      if (isDirty(song.slug)) li.classList.add('modified');
      if (currentSong && currentSong.slug === song.slug) li.classList.add('active');
      li.addEventListener('click', () => loadSong(song));
      ul.appendChild(li);
    });
  }

  function refreshListItemDirty(slug) {
    const li = document.querySelector('#song-list-wrap [data-slug="' + slug + '"]');
    if (li) li.classList.toggle('modified', isDirty(slug));
  }

  function refreshDirtyUI() {
    if (currentSong) refreshListItemDirty(currentSong.slug);
    const n = getDirtySlugs().length;
    saveAllCount.textContent = n ? '(' + n + ')' : '';
    btnSaveAll.disabled = n === 0;
  }

  // === Pending-edit / dirty-state helpers ===
  function isEditDirty(e) {
    return e.isNew || e.title !== e.baseTitle || e.author !== e.baseAuthor ||
      e.capo !== e.baseCapo || e.language !== e.baseLanguage || e.body !== e.baseBody;
  }

  function isDirty(slug) {
    const e = pendingEdits.get(slug);
    return (e ? isEditDirty(e) : false) || pendingChecked.has(slug);
  }

  function getDirtySlugs() {
    const out = new Set();
    pendingEdits.forEach((e, slug) => { if (isEditDirty(e)) out.add(slug); });
    pendingChecked.forEach(slug => out.add(slug));
    return Array.from(out);
  }

  // Pulls the topbar + editor area into the current song's pending entry.
  function syncCurrentEdits() {
    if (!currentSong) return;
    const e = pendingEdits.get(currentSong.slug);
    if (!e) return; // load failed earlier - edits aren't tracked, can't be saved
    e.title = editTitle.value;
    e.author = editAuthor.value;
    e.capo = parseInt(editCapo.value, 10) || 0;
    e.language = editLanguage.value;
    e.body = editorArea.innerHTML;
    refreshDirtyUI();
    schedulePreview();
  }

  function toggleChecked(song) {
    song.checked = !song.checked; // live value shown in the sidebar right away
    const e = pendingEdits.get(song.slug);
    if (!e || !e.isNew) {
      if (pendingChecked.has(song.slug)) pendingChecked.delete(song.slug);
      else pendingChecked.add(song.slug);
    }
    filterSongList(); // song jumps to the other section immediately
    refreshDirtyUI();
  }

  // Strip diacritics so e.g. "zelva" matches "želva" - handy on mobile
  // keyboards that don't type Czech háčky/čárky by default.
  // Combining Diacritical Marks block (U+0300-U+036F), built from numeric
  // char codes rather than a \u-escape literal - a literal here risks
  // silently becoming the raw combining characters themselves in transit
  // (see js/song-template.js's COMBINING_MARKS_RE for the same precaution).
  const COMBINING_MARKS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

  function normalizeForSearch(s) {
    return s.normalize('NFD').replace(COMBINING_MARKS_RE, '').toLowerCase();
  }

  function filterSongList() {
    const q = normalizeForSearch(editorSearch.value.trim());
    const filtered = allSongs.filter(s =>
      normalizeForSearch(s.title + ' ' + s.author).includes(q)
    );
    renderSongList(filtered);
    if (q) {
      // Make sure search hits in a collapsed section are visible.
      sectionUnchecked.open = true;
      sectionChecked.open = true;
    }
  }

  // === Load Song ===
  async function loadSong(song) {
    currentSong = song;
    editorPlaceholder.style.display = 'none';
    editorActive.style.display = 'flex';

    const cached = pendingEdits.get(song.slug);
    if (cached) {
      // Already opened this session (or brand new) - restore from memory,
      // no fetch, no discard prompt.
      editTitle.value = cached.title;
      editAuthor.value = cached.author;
      editCapo.value = cached.capo || '';
      editLanguage.value = cached.language;
      editorArea.innerHTML = cached.body;
      renderPreview();
      filterSongList();
      setStatus(
        cached.isNew ? `Nová píseň: ${cached.title} (zatím jen v prohlížeči)` : `Načteno (z mezipaměti): ${song.title}`,
        'success'
      );
      return;
    }

    editTitle.value = song.title;
    editAuthor.value = song.author || '';
    editCapo.value = (song.tags && song.tags.capo) ? song.tags.capo : '';
    editLanguage.value = (song.tags && song.tags.language) ? song.tags.language : '';

    setStatus('Načítám...', '');

    try {
      // Read via the GitHub API (not the Pages CDN, which caches for 10 min
      // and would otherwise serve a stale version right after a save).
      const html = await getFileContent(`${REPO_PATH_PREFIX}${song.slug}.html`);

      // Extract pre content
      const m = html.match(/<pre class="song-text">([\s\S]*?)<\/pre>/);
      if (!m) {
        setStatus('Chyba při načítání písně (chybí <pre class="song-text">)', 'error');
        return;
      }

      editorArea.innerHTML = m[1];
      renderPreview();
      // Read back the normalized markup (the browser can reflow raw HTML on
      // assignment) so later dirty-checks compare like with like instead of
      // diffing against the pre-normalization regex capture.
      const body = editorArea.innerHTML;
      const capo = (song.tags && typeof song.tags.capo === 'number') ? song.tags.capo : 0;
      const language = (song.tags && song.tags.language) || '';

      pendingEdits.set(song.slug, {
        isNew: false,
        rawHtml: html,
        title: song.title,
        author: song.author || '',
        capo, language, body,
        baseTitle: song.title,
        baseAuthor: song.author || '',
        baseCapo: capo,
        baseLanguage: language,
        baseBody: body
      });

      filterSongList();
      setStatus(`Načteno: ${song.title}`, 'success');
    } catch (e) {
      // Deliberately no pendingEdits entry on failure - saveCurrentSong()
      // refuses to save a song with no entry, so an error message can never
      // get written into the file in place of real content.
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
    if (currentSong) syncCurrentEdits();
  }

  // === Section markers ===
  // Insert a section marker (R:, R1:, S:, B:, ...) on its own line at the caret.
  function insertSectionMarker(marker) {
    if (!marker) return;
    editorArea.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount || !editorArea.contains(sel.anchorNode)) {
      // No caret in the editor: append at the end.
      editorArea.appendChild(document.createTextNode('\n' + marker + ' '));
    } else {
      const range = sel.getRangeAt(0);
      range.deleteContents();

      // Start a new line unless the caret already sits at the start of one.
      let atLineStart = true;
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
        const ch = node.textContent[range.startOffset - 1];
        if (ch && ch !== '\n') atLineStart = false;
      }

      const tn = document.createTextNode((atLineStart ? '' : '\n') + marker + ' ');
      range.insertNode(tn);
      range.setStartAfter(tn);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    if (currentSong) syncCurrentEdits();
  }

  // === Cleanup / transpose actions ===
  function applyCleanup(fn) {
    if (!currentSong) return;
    try {
      editorArea.innerHTML = fn(editorArea.innerHTML);
      syncCurrentEdits();
      setStatus('Upraveno (zatím neuloženo)', '');
    } catch (e) {
      setStatus('Chyba při úpravě: ' + e.message, 'error');
      console.error(e);
    }
  }

  function updateShortcutToggle() {
    if (!btnToggleShortcuts) return;
    btnToggleShortcuts.textContent = 'Zkratky 1–8: ' + (chordShortcutsEnabled ? 'ZAP' : 'VYP');
    btnToggleShortcuts.classList.toggle('active', chordShortcutsEnabled);
  }

  // Number keys 1..9 insert the matching toolbar chord at the caret.
  function handleChordShortcut(e) {
    if (!chordShortcutsEnabled || isEditorHidden()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^[1-9]$/.test(e.key)) return;
    const btns = document.querySelectorAll('.btn-quick-chord');
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= btns.length) return;
    const chord = btns[idx].dataset.chord;
    if (!chord) return;
    e.preventDefault();
    insertChord(chord);
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
            if (currentSong) syncCurrentEdits();
            return;
          }
        }

        // Check if we're at the start of editorArea and prev element is chord
        if (node === editorArea && offset > 0) {
          const child = editorArea.childNodes[offset - 1];
          if (child && child.classList && child.classList.contains('chord')) {
            e.preventDefault();
            child.remove();
            if (currentSong) syncCurrentEdits();
            return;
          }
        }
      }
    }
  }

  // === Live preview ===
  // Renders the song exactly like the live page (shared SongSections
  // transform + site CSS) and decorates it with editor-only controls:
  // join/detach buttons that decide what still belongs to a section.
  let previewTimer = null;

  function togglePreview() {
    previewOn = !previewOn;
    localStorage.setItem('editor_preview', previewOn ? 'on' : 'off');
    applyPreviewState();
  }

  function applyPreviewState() {
    editorBody.classList.toggle('preview-on', previewOn);
    btnPreview.classList.toggle('active', previewOn);
    if (previewOn) renderPreview();
  }

  // True when the editing surface isn't on screen (narrow screen, preview
  // shown instead) - used to suspend editing keyboard shortcuts.
  function isEditorHidden() {
    return previewOn && narrowMQ.matches;
  }

  function schedulePreview() {
    if (!previewOn) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 250);
  }

  function renderPreview() {
    clearTimeout(previewTimer);
    if (!previewOn) return;
    const src = editorArea.innerHTML;
    if (window.SongSections && SongSections.hasSections(src)) {
      editorPreview.innerHTML = SongSections.transform(src);
      editorPreview.classList.toggle('show-repeats', !previewCollapsed.checked);
      decoratePreview(src);
    } else {
      editorPreview.classList.remove('show-repeats');
      editorPreview.innerHTML = src;
    }
  }

  function sectionLabelOf(block) {
    const base = block.type === 'refren' ? 'R' : block.type === 'bridge' ? 'B' : 'S';
    return base + block.id + ':';
  }

  // Adds the editor-only controls onto the rendered sections:
  //  - a plain block right after a marked section gets "⤴ do R:" (join it),
  //  - a marked section with a merged continuation gets "⤵ odpojit konec",
  //  - a lowercase-starting block right after a section is flagged as a
  //    suspected chorus continuation (dashed outline, button always visible).
  function decoratePreview(src) {
    const blocks = SongSections.parseBlocks(src);
    const kids = editorPreview.children;
    if (kids.length !== blocks.length) return; // markup out of sync - skip controls

    const makeBtn = (act, blockIdx, text, title) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sec-act';
      btn.dataset.act = act;
      btn.dataset.block = blockIdx;
      btn.textContent = text;
      btn.title = title;
      return btn;
    };

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const prev = blocks[i - 1];

      if (!b.marker && prev && prev.marker) {
        const lbl = sectionLabelOf(prev);
        kids[i].appendChild(makeBtn(
          'join', i, '⤴ do ' + lbl,
          'Připojit tento blok k sekci ' + lbl + ' - bude se sbalovat a opakovat spolu s ní'
        ));
        const first = b.lines.find(l => l.trim() !== '') || '';
        const plain = first.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
        if (/^[a-záčďéěíňóřšťúůýž]/.test(plain)) {
          kids[i].classList.add('sec-suspect');
          kids[i].title = 'Blok začíná malým písmenem - nepatří ještě k ' + lbl + '?';
        }
      }

      if (b.marker && b.lines.indexOf('') > 0) {
        kids[i].appendChild(makeBtn(
          'detach', i, '⤵ odpojit konec',
          'Odpojit poslední připojený blok ze sekce (stane se z něj samostatná sloka)'
        ));
      }
    }
  }

  function handlePreviewClick(e) {
    const btn = e.target.closest('.sec-act');
    if (btn) {
      applySectionAction(btn.dataset.act, parseInt(btn.dataset.block, 10));
      return;
    }
    // Pills peek open/closed like on the live page.
    const head = e.target.closest('.is-repeat .section-head');
    if (head && !editorPreview.classList.contains('show-repeats')) {
      head.closest('.is-repeat').classList.toggle('peek');
    }
  }

  // Rewrites the source so a block joins/leaves the preceding marked section.
  // "Joined" is stored as indentation - the convention old songs already use
  // and sections.js already parses (and dedents for display).
  function applySectionAction(act, idx) {
    const src = editorArea.innerHTML;
    const lines = SongSections.normalizeBreaks(src).split('\n');
    const blocks = SongSections.parseBlocks(src);
    const b = blocks[idx];
    if (!b) return;

    if (act === 'join') {
      for (let i = b.srcStart; i <= b.srcEnd; i++) {
        if (lines[i].trim() !== '') lines[i] = '  ' + lines[i];
      }
    } else if (act === 'detach') {
      // The last merged continuation sits after the block's last blank line.
      let lastBlank = -1;
      for (let i = b.srcStart; i <= b.srcEnd; i++) {
        if (lines[i].trim() === '') lastBlank = i;
      }
      if (lastBlank === -1) return;
      let min = Infinity;
      for (let i = lastBlank + 1; i <= b.srcEnd; i++) {
        if (lines[i].trim() === '') continue;
        min = Math.min(min, (lines[i].match(/^[ \t]*/) || [''])[0].length);
      }
      if (!isFinite(min) || min === 0) return;
      for (let i = lastBlank + 1; i <= b.srcEnd; i++) {
        lines[i] = lines[i].slice(min);
      }
    }

    editorArea.innerHTML = lines.join('\n');
    syncCurrentEdits();
    renderPreview();
  }

  // === New song ===
  function createNewSong() {
    const title = newTitleInput.value.trim();
    if (!title) return;
    const author = newAuthorInput.value.trim();
    const capo = parseInt(newCapoInput.value, 10) || 0;
    const language = newLanguageSelect.value || 'CZ';

    const taken = new Set(allSongs.map(s => s.slug));
    const slug = SongTemplate.uniqueSlug(SongTemplate.slugify(title), taken);

    // Lives only in memory until Uložit/Uložit vše pushes it - insert
    // sorted so the sidebar and a future songs.json diff both read sanely.
    const song = { title, slug, author, chords: [], tags: { capo: capo || false, language }, checked: false };
    const idx = allSongs.findIndex(s => s.title.toLowerCase() > title.toLowerCase());
    if (idx === -1) allSongs.push(song); else allSongs.splice(idx, 0, song);

    pendingEdits.set(slug, {
      isNew: true,
      rawHtml: null,
      title, author, capo, language, body: '',
      baseTitle: null, baseAuthor: null, baseCapo: null, baseLanguage: null, baseBody: null
    });

    newSongDialog.close();
    filterSongList();
    loadSong(song); // pendingEdits already has it -> restores from memory, no fetch
    refreshDirtyUI();
  }

  // === Save to GitHub ===
  // Extracts the deduplicated chord list from a song body, in the order each
  // chord first appears (play order) - used to keep songs.json's "chords"
  // array in sync with whatever's actually typed.
  function extractChords(body) {
    const chords = new Set();
    const re = /data-chord="([^"]+)"/g;
    let m;
    while ((m = re.exec(body)) !== null) chords.add(m[1]);
    return Array.from(chords);
  }

  // Rebuilds songs/<slug>.html for one pending entry. Brand-new songs use
  // the canonical template; existing songs re-apply the same replacements
  // saveToGitHub always used, against the cached rawHtml (no re-fetch needed).
  function buildSongHtml(slug, e) {
    const title = e.title.trim() || e.baseTitle || 'Bez názvu';
    const author = e.author.trim();
    const capo = e.capo || 0;

    if (e.isNew || e.rawHtml == null) {
      return SongTemplate.generateSongHtml({ title, author, capo, body: e.body, slug });
    }

    let html = e.rawHtml;

    // Update title
    html = html.replace(/<h1>.*?<\/h1>/, `<h1>${escapeHtml(title)}</h1>`);

    // Update author
    if (author) {
      if (html.includes('class="song-author"')) {
        html = html.replace(
          /<p class="song-author">.*?<\/p>/,
          `<p class="song-author">${escapeHtml(author)}</p>`
        );
      } else {
        html = html.replace(
          '</div>\n    <pre',
          `<p class="song-author">${escapeHtml(author)}</p>\n    </div>\n    <pre`
        );
      }
    }

    // Update capo
    if (capo > 0) {
      if (html.includes('class="song-capo"')) {
        html = html.replace(
          /<p class="song-capo">.*?<\/p>/,
          `<p class="song-capo">Capo ${capo}</p>`
        );
      } else {
        html = html.replace(
          /(\s*)(    <\/div>\s*\n\s*<pre class="song-text">)/,
          `\n      <p class="song-capo">Capo ${capo}</p>\n$2`
        );
      }
    } else {
      // Remove capo line if set to 0
      html = html.replace(/\s*<p class="song-capo">.*?<\/p>/, '');
    }

    // Update song content
    html = html.replace(
      /<pre class="song-text">[\s\S]*?<\/pre>/,
      `<pre class="song-text">${e.body}</pre>`
    );

    // Update <title>
    html = html.replace(
      /<title>.*?<\/title>/,
      `<title>${escapeHtml(title)} - Bekovy songy</title>`
    );

    // Update mailto subject (if mailto link exists in the file)
    html = html.replace(
      /mailto:[^?]+\?subject=[^"]+/,
      `mailto:ondrejbek8@gmail.com?subject=Bug: ${encodeURIComponent(title)}`
    );

    return html;
  }

  // Fetches a FRESH songs.json and applies pending state for ONLY the given
  // slugs, so a per-song save can never leak some other song's unrelated
  // pending edits or checked-toggle into the committed file.
  async function buildMergedSongsJson(slugs) {
    const data = JSON.parse(await getFileContent(SONGS_JSON_PATH));

    for (const slug of slugs) {
      const e = pendingEdits.get(slug);
      const local = allSongs.find(s => s.slug === slug);
      let song = data.songs.find(s => s.slug === slug);

      if (!song) {
        if (!e || !e.isNew) continue; // shouldn't happen, nothing to do
        song = { title: '', slug, author: '', chords: [], tags: {} };
        const idx = data.songs.findIndex(s => s.title.toLowerCase() > e.title.toLowerCase());
        if (idx === -1) data.songs.push(song); else data.songs.splice(idx, 0, song);
      }

      if (e && isEditDirty(e)) {
        song.title = e.title.trim() || e.baseTitle || 'Bez názvu';
        song.author = e.author.trim();
        if (!song.tags) song.tags = {};
        song.tags.capo = e.capo || false;
        if (e.language) song.tags.language = e.language;
        song.chords = extractChords(e.body);
      }

      if (local && (pendingChecked.has(slug) || (e && e.isNew))) {
        if (local.checked) song.checked = true;
        else delete song.checked; // absence = "ke kontrole", keeps the file minimal
      }
    }

    return JSON.stringify(data, null, 2);
  }

  // Commits every dirty HTML file among `slugs` plus one merged songs.json,
  // in a single atomic commit (one push = one deploy, no desync).
  async function performSave(slugs, message) {
    const files = [];
    const builtHtml = new Map();

    for (const slug of slugs) {
      const e = pendingEdits.get(slug);
      if (e && isEditDirty(e)) {
        const html = buildSongHtml(slug, e);
        builtHtml.set(slug, html);
        files.push({ path: `${REPO_PATH_PREFIX}${slug}.html`, content: html });
      }
      // A slug that's only checked-toggled (not e/isEditDirty) contributes
      // no HTML file - only its songs.json entry changes.
    }
    files.push({ path: SONGS_JSON_PATH, content: await buildMergedSongsJson(slugs) });

    await commitFiles(files, message);

    // Bookkeeping: rebase each saved slug's pending entry onto its new
    // "clean" state, and reflect the same fields into allSongs.
    for (const slug of slugs) {
      const e = pendingEdits.get(slug);
      const local = allSongs.find(s => s.slug === slug);
      if (e) {
        const title = e.title.trim() || e.baseTitle || 'Bez názvu';
        if (local) {
          local.title = title;
          local.author = e.author.trim();
          if (!local.tags) local.tags = {};
          local.tags.capo = e.capo || false;
          if (e.language) local.tags.language = e.language;
          local.chords = extractChords(e.body);
        }
        e.isNew = false;
        if (builtHtml.has(slug)) e.rawHtml = builtHtml.get(slug);
        e.title = title;
        e.baseTitle = title;
        e.baseAuthor = e.author;
        e.baseCapo = e.capo;
        e.baseLanguage = e.language;
        e.baseBody = e.body;
      }
      pendingChecked.delete(slug);
    }

    filterSongList();
    refreshDirtyUI();
  }

  async function saveCurrentSong() {
    if (!currentSong || !ghToken) return;
    const e = pendingEdits.get(currentSong.slug);
    if (!e) {
      setStatus('Píseň se nenačetla, nelze uložit', 'error');
      return;
    }
    if (!isDirty(currentSong.slug)) {
      setStatus('Žádné změny k uložení', '');
      return;
    }

    btnSave.disabled = true;
    btnSaveAll.disabled = true;
    setStatus('Ukládám na GitHub...', 'saving');

    try {
      const title = e.title.trim() || e.baseTitle;
      const message = (e.isNew ? 'Add: ' : 'Edit: ') + title;
      await performSave([currentSong.slug], message);
      setStatus(`Uloženo: ${title}`, 'success');
    } catch (err) {
      setStatus(`Chyba: ${err.message}`, 'error');
      console.error(err);
    } finally {
      btnSave.disabled = false;
      refreshDirtyUI();
    }
  }

  async function saveAll() {
    if (!ghToken) return;
    const slugs = getDirtySlugs();
    if (!slugs.length) return;

    btnSave.disabled = true;
    btnSaveAll.disabled = true;
    setStatus('Ukládám na GitHub...', 'saving');

    try {
      const titles = slugs.map(slug => {
        const e = pendingEdits.get(slug);
        const local = allSongs.find(s => s.slug === slug);
        return (e && e.title) || (local && local.title) || slug;
      });
      const message = slugs.length === 1
        ? `Edit: ${titles[0]}`
        : `Edit: ${slugs.length} písní (${titles.slice(0, 3).join(', ')}${slugs.length > 3 ? ', …' : ''})`;
      await performSave(slugs, message);
      setStatus(`Uloženo ${slugs.length} písní`, 'success');
    } catch (err) {
      setStatus(`Chyba: ${err.message}`, 'error');
      console.error(err);
    } finally {
      btnSave.disabled = false;
      refreshDirtyUI();
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
