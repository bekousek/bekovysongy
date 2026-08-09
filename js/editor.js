/**
 * editor.js - In-browser song editor with GitHub save
 */
(function () {
  'use strict';

  const REPO_PATH_PREFIX = 'songs/';
  const SONGS_JSON_PATH = 'songs.json';
  const PREVIEWS_JSON_PATH = 'song-previews.json';
  // Memory of thrown-away návrhy, so the next batch of generated suggestions
  // doesn't hand back what's already been turned down. Never fetched by the
  // site or shown anywhere in here - it exists purely to be read later, and
  // it isn't in the deploy allowlist, so it never leaves the repository.
  const REJECTED_JSON_PATH = 'navrhy-zamitnute.json';

  // === Song status ===
  // Four buckets in the sidebar, in workflow order. The first two are
  // drafts: a návrh has nothing but a title, a "k vytvoření" song is one
  // I've committed to writing. Neither has a songs/<slug>.html file, so
  // neither may leak onto the public site (js/table.js, the sitemap and the
  // SW precache all filter them out).
  //
  // Persisted minimally, so adding this costs zero diff on the ~580 existing
  // entries: the two public states keep using the old boolean ("checked":
  // true, or the field absent), and only the two new ones write an explicit
  // "status". statusOf() reads either shape.
  const STATUSES = [
    { id: 'navrh', label: 'Návrhy', draft: true },
    { id: 'k-vytvoreni', label: 'K vytvoření', draft: true },
    { id: 'ke-kontrole', label: 'Ke kontrole', draft: false },
    { id: 'zkontrolovano', label: 'Zkontrolováno', draft: false }
  ];
  const STATUS_IDS = STATUSES.map(s => s.id);
  const DRAFT_IDS = STATUSES.filter(s => s.draft).map(s => s.id);

  function statusOf(song) {
    if (song && STATUS_IDS.indexOf(song.status) !== -1) return song.status;
    return song && song.checked ? 'zkontrolovano' : 'ke-kontrole';
  }

  function isDraftStatusId(status) {
    return DRAFT_IDS.indexOf(status) !== -1;
  }

  function isDraft(song) {
    return isDraftStatusId(statusOf(song));
  }

  function statusLabel(id) {
    const s = STATUSES.find(x => x.id === id);
    return s ? s.label : id;
  }

  // Czech counts split three ways (1 / 2-4 / 5+), and the verb agrees with
  // the noun - "smazán 1 návrh", "smazány 2 návrhy", "smazáno 5 návrhů".
  function plural(n, one, few, many) {
    if (n === 1) return one;
    return n >= 2 && n <= 4 ? few : many;
  }

  // Writes `status` onto a songs.json entry (in memory or about to be
  // committed) in whichever of the two shapes above applies.
  function applyStatus(song, status) {
    if (status === 'zkontrolovano') {
      delete song.status;
      song.checked = true;
    } else if (status === 'ke-kontrole') {
      delete song.status;
      delete song.checked;
    } else {
      song.status = status;
      delete song.checked;
    }
  }

  // === Interpreti (multi-artist) ===
  // "authors" is the canonical list when present; a song written before this
  // existed just has the single "author" string. Both are always written on
  // save (author = the joined display form) so nothing that reads only
  // "author" - the static song pages, older tooling - has to change.
  function authorsOf(song) {
    if (song && Array.isArray(song.authors)) {
      const list = song.authors.map(a => String(a).trim()).filter(a => a !== '');
      if (list.length) return list;
    }
    const single = song && song.author ? String(song.author).trim() : '';
    return single ? [single] : [];
  }

  function authorsText(list) {
    return (list || []).join(', ');
  }

  function applyAuthors(target, list) {
    target.author = authorsText(list);
    if (list.length > 1) target.authors = list.slice();
    else delete target.authors;
  }

  // The new-song dialog keeps its interprets as one comma-separated string
  // (the editor's field uses chips instead), so both the autocomplete and
  // createNewSong() cut it up the same way.
  function splitAuthors(text) {
    return String(text || '').split(',').map(s => s.trim());
  }

  // Every interpret spelling the collection already uses, most used first.
  // Rebuilt on demand rather than cached: one pass over the song list costs
  // microseconds, and in exchange it's never stale - a name typed into another
  // song a minute ago is offered here without a rebuild hook. Pending edits
  // win over the songs.json entry they belong to.
  function buildAuthorIndex() {
    return AuthorSuggest.buildIndex(allSongs.map(s => {
      const e = pendingEdits.get(s.slug);
      return e ? e.authors : authorsOf(s);
    }));
  }

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
  const listSort = document.getElementById('list-sort');
  const listFilter = document.getElementById('list-filter');
  const previewFilter = document.getElementById('preview-filter');
  const songListWrap = document.getElementById('song-list-wrap');
  const btnNewSong = document.getElementById('btn-new-song');
  const btnSaveAll = document.getElementById('btn-save-all');
  const saveAllCount = document.getElementById('save-all-count');
  const newSongDialog = document.getElementById('new-song-dialog');
  const newSongForm = document.getElementById('new-song-form');
  const newTitleInput = document.getElementById('new-title');
  const newAuthorInput = document.getElementById('new-author');
  const newCapoInput = document.getElementById('new-capo');
  const newLanguageSelect = document.getElementById('new-language');
  const newStatusSelect = document.getElementById('new-status');
  const newSongSlugPreview = document.getElementById('new-song-slug-preview');
  const btnNewCancel = document.getElementById('btn-new-cancel');
  const editorPlaceholder = document.getElementById('editor-placeholder');
  const editorActive = document.getElementById('editor-active');
  const editTitle = document.getElementById('edit-title');
  const editAuthors = document.getElementById('edit-authors');
  const editAuthorInput = document.getElementById('edit-author');
  const editCapo = document.getElementById('edit-capo');
  const editLanguage = document.getElementById('edit-language');
  const editProgression = document.getElementById('edit-progression');
  const btnProgressionAuto = document.getElementById('btn-progression-auto');
  const editNote = document.getElementById('edit-note');
  const editorArea = document.getElementById('editor-area');
  const editorBody = document.getElementById('editor-body');
  const editorPreview = document.getElementById('editor-preview');
  const previewCollapsed = document.getElementById('preview-collapsed');
  const editorStatus = document.getElementById('editor-status');
  const btnSave = document.getElementById('btn-save');
  const btnPreview = document.getElementById('btn-preview');
  const chordInput = document.getElementById('chord-input');
  const btnInsertChord = document.getElementById('btn-insert-chord');
  const chordHotbar = document.getElementById('chord-hotbar');
  const btnHotbarReset = document.getElementById('btn-hotbar-reset');
  const sectionNameInput = document.getElementById('section-name');
  const sectionBtnPreview = document.getElementById('section-btn-preview');
  const btnInsertSection = document.getElementById('btn-insert-section');
  const btnInsertRepeat = document.getElementById('btn-insert-repeat');
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
  // entry shape: { isNew, rawHtml (song file as fetched; null for new songs
  //   and for drafts that have none yet), title, authors (string[]),
  //   capo (int, 0 = none), language, body (<pre> innerHTML),
  //   progression (#edit-progression's raw text, e.g. "G C | Ami D"),
  //   note (internal remark, songs.json only - never rendered on the site),
  //   baseTitle, baseAuthors, baseCapo, baseLanguage, baseBody,
  //   baseProgression, baseNote (values at load time / last successful save -
  //   used to detect dirtiness) }
  const pendingEdits = new Map();

  // slug -> the status the song had when songs.json was loaded (or when it
  // was last saved). A song is status-dirty while statusOf() differs from
  // this; the live value lives on the allSongs entry itself, so the sidebar
  // can move it between sections the moment it changes.
  const baseStatus = new Map();

  // Drafts thrown away with the ✗ button, kept until the next save so they
  // can be put back. Insertion-ordered, and undo pops the last one - that
  // makes triaging a long Návrhy list forgiving: a misclick is one click
  // back, and several misclicks unwind in order.
  //
  // entry shape: { song (the songs.json entry), idx (its place in allSongs) }
  const pendingDeletes = new Map();

  // Sidebar list controls.
  let listSortMode = localStorage.getItem('editor_list_sort') || 'title';
  let listStatusFilter = '';
  // Deliberately not persisted: it hides most of the songbook, and coming
  // back to a near-empty list days later reads as data loss, not a filter.
  let listPreviewFilter = '';
  const sectionOpen = new Map(STATUS_IDS.map(id => [
    id, localStorage.getItem('editor_section_' + id) !== 'closed'
  ]));

  // Chord hotbar: the buttons under "Vložit akord". Reordered by dragging,
  // extended by inserting a chord that isn't on it yet, and refilled from
  // the song's own chords whenever a song with chords is opened.
  const DEFAULT_HOTBAR = ['Ami', 'Emi', 'C', 'G', 'D', 'F', 'E', 'H'];
  const HOTBAR_MAX = 14;
  let hotbar = loadHotbar();

  function loadHotbar() {
    try {
      const saved = JSON.parse(localStorage.getItem('chord_hotbar'));
      if (Array.isArray(saved) && saved.length) {
        return saved.map(String).filter(c => c.trim() !== '').slice(0, HOTBAR_MAX);
      }
    } catch (e) { /* corrupt entry - fall back to the defaults */ }
    return DEFAULT_HOTBAR.slice();
  }

  function saveHotbar() {
    try {
      localStorage.setItem('chord_hotbar', JSON.stringify(hotbar));
    } catch (e) { /* storage disabled - the bar still works for this session */ }
  }

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
    listSort.value = listSortMode;
    listSort.addEventListener('change', () => {
      listSortMode = listSort.value;
      localStorage.setItem('editor_list_sort', listSortMode);
      filterSongList();
    });
    listFilter.addEventListener('change', () => {
      listStatusFilter = listFilter.value;
      filterSongList();
    });
    previewFilter.addEventListener('change', () => {
      listPreviewFilter = previewFilter.value;
      filterSongList();
      // Narrowing to a handful of rows is pointless if they're inside a
      // collapsed section.
      if (listPreviewFilter) listSections.forEach(sec => { sec.details.open = true; });
    });
    buildListSections();
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

    renderHotbar();
    btnHotbarReset.addEventListener('click', () => {
      hotbar = DEFAULT_HOTBAR.slice();
      saveHotbar();
      renderHotbar();
    });

    // Section fences: "//<name>" ... "<name>//" around the selection (or an
    // empty pair with the caret inside), and the repeat pair "//:" / "://".
    sectionNameInput.addEventListener('input', updateSectionButton);
    sectionNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        insertFence(sectionNameInput.value.trim());
      }
    });
    updateSectionButton();
    btnInsertSection.addEventListener('click', () => insertFence(sectionNameInput.value.trim()));
    btnInsertRepeat.addEventListener('click', () => insertFence(SongSections.REPEAT_NAME));

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
    bindAuthorChips();
    editCapo.addEventListener('input', syncCurrentEdits);
    editLanguage.addEventListener('change', syncCurrentEdits);
    editProgression.addEventListener('input', syncCurrentEdits);
    editNote.addEventListener('input', syncCurrentEdits);
    btnProgressionAuto.addEventListener('click', () => {
      if (!currentSong) return;
      editProgression.value = SongSections.progressionToText(SongSections.deriveProgression(readBody()));
      syncCurrentEdits();
    });

    // The per-song category popover closes on any click elsewhere, on Esc,
    // and whenever the list scrolls out from under it.
    document.addEventListener('click', closeStatusMenu);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeStatusMenu();
    });
    songListWrap.addEventListener('scroll', closeStatusMenu);

    // Ctrl+Z takes back the last ✗ - but only outside a text field, where it
    // still has to mean the browser's own undo.
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      if (!pendingDeletes.size) return;
      const el = document.activeElement;
      if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      undoLastDelete();
    });

    // Keyboard shortcuts: Ctrl/Cmd+S saves the open song, +Shift saves all.
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) saveAll();
        else saveCurrentSong();
      }
    });

    // Triage keys. Registered after the shortcuts above so the modifier
    // combinations are already handled; this one ignores them anyway.
    document.addEventListener('keydown', handleTriageKey);
    SongPreview.onChange(refreshPlayButtons);

    // Warn before closing/reloading the tab with unsaved edits anywhere.
    window.addEventListener('beforeunload', (e) => {
      if (getDirtySlugs().length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Every edit to the song text goes through the flat model in
    // js/song-edit.js (see handleBeforeInput) - that's what keeps the
    // contenteditable down to text nodes + chord spans and makes a chord
    // behave as one indivisible character. Ctrl+Z/Ctrl+Y drive this
    // editor's own history, and paste stays plain text.
    editorArea.addEventListener('beforeinput', handleBeforeInput);
    editorArea.addEventListener('keydown', handleEditorKeydown);
    editorArea.addEventListener('paste', handlePaste);

    // New-song dialog
    btnNewSong.addEventListener('click', () => {
      newSongForm.reset();
      newCapoInput.value = '0';
      newLanguageSelect.value = 'CZ';
      newStatusSelect.value = 'ke-kontrole';
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

    // Same suggestions in the dialog, only here the field is one
    // comma-separated string: complete the segment after the last comma and
    // leave the ones before it alone.
    AuthorSuggest.attach(newAuthorInput, {
      anchor: newAuthorInput.parentNode, // .ac-anchor wrapper in admin/index.html
      candidates: buildAuthorIndex,
      query: () => splitAuthors(newAuthorInput.value).pop(),
      exclude: () => splitAuthors(newAuthorInput.value).slice(0, -1),
      emptyText: 'Nový interpret – tenhle zápis tu ještě není',
      pick: (name) => {
        const parts = splitAuthors(newAuthorInput.value);
        parts[parts.length - 1] = name;
        newAuthorInput.value = parts.join(', ');
      }
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
      allSongs.forEach(s => baseStatus.set(s.slug, statusOf(s)));
      // Previews are optional decoration on the list, so the song list must
      // not wait on them - or break if song-previews.json isn't generated.
      SongPreview.load().then(() => filterSongList());
      filterSongList();
    } catch (e) {
      setStatus('Chyba při načítání songs.json', 'error');
    }
  }

  // One <details> per status, built once; filterSongList() only refills the
  // <ul>s so the open/closed state and scroll position survive re-renders.
  const listSections = new Map();

  function buildListSections() {
    STATUSES.forEach(st => {
      const details = document.createElement('details');
      details.className = 'song-section';
      details.open = sectionOpen.get(st.id);
      details.addEventListener('toggle', () => {
        sectionOpen.set(st.id, details.open);
        localStorage.setItem('editor_section_' + st.id, details.open ? 'open' : 'closed');
      });

      const summary = document.createElement('summary');
      summary.textContent = st.label + ' ';
      const count = document.createElement('span');
      count.className = 'section-count';
      summary.appendChild(count);
      details.appendChild(summary);

      // Návrhy is the bucket that gets triaged, so the keys are spelled out
      // right where they're used - nobody remembers four shortcuts from a
      // README.
      if (st.id === 'navrh') {
        const hint = document.createElement('p');
        hint.className = 'triage-hint';
        // Left-to-right in the same order as the ✗ / ✓ buttons on each row.
        hint.innerHTML = '<kbd>␣</kbd> přehrát · <kbd>↑</kbd><kbd>↓</kbd> pohyb · '
          + '<kbd>←</kbd> smazat · <kbd>→</kbd> k vytvoření';
        details.appendChild(hint);
      }

      const ul = document.createElement('ul');
      ul.className = 'song-list';
      details.appendChild(ul);

      songListWrap.appendChild(details);
      listSections.set(st.id, { details, ul, count });
    });
  }

  const csCollator = new Intl.Collator('cs', { sensitivity: 'base' });

  function sortForList(songs) {
    const sorted = songs.slice();
    sorted.sort((a, b) => {
      if (listSortMode === 'author') {
        const cmp = csCollator.compare(authorsText(authorsOf(a)), authorsText(authorsOf(b)));
        return cmp !== 0 ? cmp : csCollator.compare(a.title, b.title);
      }
      const cmp = csCollator.compare(a.title, b.title);
      return listSortMode === 'title-desc' ? -cmp : cmp;
    });
    return sorted;
  }

  function renderSongList(songs) {
    const sorted = sortForList(songs);
    STATUSES.forEach(st => {
      const sec = listSections.get(st.id);
      const inSection = listStatusFilter && listStatusFilter !== st.id
        ? []
        : sorted.filter(s => statusOf(s) === st.id);
      fillList(sec.ul, inSection);
      sec.count.textContent = '(' + inSection.length + ')';
      // A section filtered away entirely is hidden, not shown as "(0)".
      sec.details.hidden = !!listStatusFilter && listStatusFilter !== st.id;
    });
    markTriageCursor();
    refreshPlayButtons();
  }

  function fillList(ul, songs) {
    ul.innerHTML = '';
    songs.forEach(song => {
      const status = statusOf(song);
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
      authorSpan.textContent = authorsText(authorsOf(song));
      main.appendChild(authorSpan);
      // An internal note is marked, not printed: the rows have to stay one
      // line tall to scroll through 750 of them, and the note itself is
      // mostly a reminder to my future self ("ověř, zda ≠ …"). The full text
      // is one hover away, and in the editor when the song is open. Pending
      // edits win, so typing a note lights the row up straight away.
      const pending = pendingEdits.get(song.slug);
      const noteText = ((pending ? pending.note : song.note) || '').trim();
      if (noteText) {
        const noteMark = document.createElement('span');
        noteMark.className = 'song-list-note';
        noteMark.textContent = '✎';
        noteMark.title = noteText;
        noteMark.setAttribute('aria-label', 'Poznámka: ' + noteText);
        titleSpan.appendChild(document.createTextNode(' '));
        titleSpan.appendChild(noteMark);
      }
      li.appendChild(main);

      // "Listen before you judge" controls, on every row. Drafts need them to
      // be triaged at all; finished songs need them to check that the preview
      // the songbook plays is actually the right recording.
      {
        const preview = window.SongPreview && SongPreview.get(song.slug);
        if (preview) {
          const play = document.createElement('button');
          play.type = 'button';
          play.className = 'btn-preview-play';
          play.dataset.slug = song.slug;
          play.textContent = '▶';
          // A title-only match is the right song by a different performer -
          // fine for recognising a melody, but say so rather than surprise
          // him with an unexpected voice. It's also the state worth reviewing:
          // the automatic fallback is where genuinely wrong songs come from,
          // and the songbook hides these until they're confirmed by hand.
          play.title = (preview.locked ? 'Vybráno ručně: ' : preview.match === 'title' ? 'Jiný interpret: ' : '')
            + preview.track + ' / ' + preview.artist + ' (mezerník)';
          if (preview.match === 'title' && !preview.locked) play.classList.add('is-cover');
          if (preview.locked) play.classList.add('is-locked');
          play.addEventListener('click', (ev) => {
            ev.stopPropagation();
            setTriageCursor(song.slug);
            SongPreview.toggle(song.slug);
          });
          li.appendChild(play);
        }

        const yt = document.createElement('a');
        yt.className = 'btn-yt-search' + (preview ? '' : ' no-preview');
        yt.href = SongPreview.youtubeUrl(song.title, authorsText(authorsOf(song)));
        yt.target = '_blank';
        yt.rel = 'noopener';
        yt.textContent = '↗';
        yt.title = preview ? 'Najít na YouTube' : 'Náhled se nenašel – najít na YouTube';
        yt.addEventListener('click', (ev) => ev.stopPropagation());
        li.appendChild(yt);
      }

      // ✗ throws the draft away. Only drafts get it: they're the ones being
      // triaged, and they're the only songs with no songs/<slug>.html behind
      // them, so a stray click can't take a finished song's page with it.
      //
      // Sits left of the ✓ to line the buttons up with the keys that do the
      // same thing: ← is reject, → is accept. Non-draft rows have no ✗, so
      // there the ✓ is simply the only button.
      if (isDraftStatusId(status)) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-delete-draft';
        del.textContent = '✗';
        del.title = 'Smazat „' + song.title + '“ ze seznamu (←)';
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          deleteDraft(song);
        });
        li.appendChild(del);
      }

      // ✓ advances one step along the workflow; on the last step it toggles
      // back, so "zkontrolováno" stays a checkbox the way it always was.
      const next = nextStatus(status);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn-check-toggle' + (status === 'zkontrolovano' ? ' on' : '');
      toggle.textContent = '✓';
      toggle.title = 'Přesunout do: ' + statusLabel(next)
        + (isDraftStatusId(status) ? ' (→)' : '');
      toggle.setAttribute('aria-pressed', String(status === 'zkontrolovano'));
      toggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setSongStatus(song, next);
      });
      li.appendChild(toggle);

      const menu = document.createElement('button');
      menu.type = 'button';
      menu.className = 'btn-song-menu';
      menu.textContent = '⋯';
      menu.title = 'Přesunout do jiné kategorie';
      menu.setAttribute('aria-haspopup', 'true');
      menu.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openStatusMenu(menu, song);
      });
      li.appendChild(menu);

      if (isDirty(song.slug)) li.classList.add('modified');
      if (currentSong && currentSong.slug === song.slug) li.classList.add('active');
      li.addEventListener('click', () => loadSong(song));
      ul.appendChild(li);
    });
  }

  function nextStatus(status) {
    if (status === 'zkontrolovano') return 'ke-kontrole';
    return STATUS_IDS[STATUS_IDS.indexOf(status) + 1] || 'ke-kontrole';
  }

  // === Triage ===
  // Going through a few hundred návrhy is: hear it, keep it or bin it, next.
  // Doing that with the mouse costs a round trip to the row and back for
  // every song, so the same loop runs off the keyboard - ↑/↓ to move,
  // mezerník to listen, →/← to judge - and judging plays the next one
  // straight away, so the hands never leave the arrow keys.
  //
  // The cursor is a slug rather than an element: every judgement re-renders
  // the list, and a remembered <li> would be stale by the time it lands.
  let triageSlug = null;

  function triageSection() {
    const sec = listSections.get('navrh');
    if (!sec || sec.details.hidden || !sec.details.open) return null;
    return sec;
  }

  // Rows in the order they're on screen, so the cursor follows whatever
  // sorting, search and filtering are currently in force.
  function triageRows() {
    const sec = triageSection();
    return sec ? Array.from(sec.ul.children) : [];
  }

  function markTriageCursor() {
    songListWrap.querySelectorAll('li.triage-cursor')
      .forEach(li => li.classList.remove('triage-cursor'));
    if (!triageSlug) return;
    const sec = triageSection();
    if (!sec) return;
    const li = sec.ul.querySelector('li[data-slug="' + CSS.escape(triageSlug) + '"]');
    if (li) li.classList.add('triage-cursor');
  }

  function setTriageCursor(slug, opts) {
    triageSlug = slug;
    markTriageCursor();
    if (!slug) return;
    const sec = triageSection();
    const li = sec && sec.ul.querySelector('li[data-slug="' + CSS.escape(slug) + '"]');
    // 'instant': the stylesheet scrolls smoothly, which here would trail the
    // cursor by a row or two while judging at speed.
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    if (opts && opts.play) SongPreview.play(slug);
  }

  function moveTriage(delta) {
    const rows = triageRows();
    if (!rows.length) return;
    const at = rows.findIndex(li => li.dataset.slug === triageSlug);
    const next = at === -1
      ? 0
      : Math.max(0, Math.min(rows.length - 1, at + delta));
    setTriageCursor(rows[next].dataset.slug);
  }

  // ✓/✗ on the row under the cursor, then move on. Both paths re-render the
  // list, so the follow-up row is worked out from the old order first.
  function judgeTriage(accept) {
    const rows = triageRows();
    const at = rows.findIndex(li => li.dataset.slug === triageSlug);
    if (at === -1) return;
    const song = allSongs.find(s => s.slug === triageSlug);
    if (!song || !isDraft(song)) return;

    const after = rows[at + 1] || rows[at - 1];
    const afterSlug = after ? after.dataset.slug : null;

    SongPreview.stop();
    if (accept) setSongStatus(song, nextStatus(statusOf(song)));
    else deleteDraft(song);

    // Autoplay only on a judgement: it's a deliberate keypress, so the
    // browser allows the sound, and it's the one moment he wants the next
    // song immediately. Plain ↑/↓ stays silent for scanning the list.
    setTriageCursor(afterSlug, { play: true });
  }

  function refreshPlayButtons() {
    const playing = window.SongPreview ? SongPreview.playing() : null;
    songListWrap.querySelectorAll('.btn-preview-play').forEach(btn => {
      const on = btn.dataset.slug === playing;
      btn.classList.toggle('playing', on);
      btn.textContent = on ? '■' : '▶';
    });
  }

  function handleTriageKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.isContentEditable || el.tagName === 'INPUT'
      || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    if (!triageSection()) return;

    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveTriage(1); break;
      case 'ArrowUp': e.preventDefault(); moveTriage(-1); break;
      case ' ':
        e.preventDefault();
        if (!triageSlug) { moveTriage(1); }
        if (triageSlug) SongPreview.toggle(triageSlug);
        break;
      case 'ArrowRight': e.preventDefault(); judgeTriage(true); break;
      case 'ArrowLeft': e.preventDefault(); judgeTriage(false); break;
      default: break;
    }
  }

  // Little popover listing all four categories, anchored under the ⋯ button.
  let openMenuEl = null;

  function closeStatusMenu() {
    if (openMenuEl) {
      openMenuEl.remove();
      openMenuEl = null;
    }
  }

  function openStatusMenu(anchor, song) {
    const wasFor = openMenuEl && openMenuEl.dataset.slug === song.slug;
    closeStatusMenu();
    if (wasFor) return; // second click on the same ⋯ closes it

    const current = statusOf(song);
    const menu = document.createElement('div');
    menu.className = 'status-menu';
    menu.dataset.slug = song.slug;
    STATUSES.forEach(st => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'status-menu-item' + (st.id === current ? ' current' : '');
      item.textContent = st.label;
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeStatusMenu();
        if (st.id !== current) setSongStatus(song, st.id);
      });
      menu.appendChild(item);
    });

    const sep = document.createElement('div');
    sep.className = 'status-menu-sep';
    menu.appendChild(sep);

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'status-menu-item';
    pick.textContent = 'Vybrat ukázku…';
    pick.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeStatusMenu();
      openPreviewPicker(song);
    });
    menu.appendChild(pick);

    const rect = anchor.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = Math.max(8, rect.right - 150) + 'px';
    document.body.appendChild(menu);
    openMenuEl = menu;
  }

  // === Preview picker ===
  // The resolver takes the catalogue's first plausible answer, which is right
  // most of the time and occasionally lands on a different song with the same
  // name ("Placky" -> "Plačky"). This is the way out: search the catalogue
  // live, audition the alternatives, pick one. The choice is stored with
  // "locked": true, which build-previews.js never overwrites and the songbook
  // treats as an exact match - a human vouched for it.
  //
  // Nothing here touches GitHub; the pick lands in pendingPreviews and rides
  // along with the next Uložit, so a review session is one commit.
  const pendingPreviews = new Map();
  let previewDialog = null;

  function openPreviewPicker(song) {
    if (previewDialog) previewDialog.remove();

    const dialog = document.createElement('dialog');
    dialog.className = 'preview-picker';
    dialog.innerHTML =
      '<div class="picker-head">'
      + '<h2></h2>'
      + '<p class="picker-current"></p>'
      + '</div>'
      + '<div class="picker-search">'
      + '<input type="text" class="filter-input" id="picker-query" '
      + 'placeholder="Název a interpret, nebo odkaz z Apple Music">'
      + '<button type="button" class="btn-editor" id="picker-go">Hledat</button>'
      + '</div>'
      + '<div class="picker-results" id="picker-results"></div>'
      + '<div class="picker-actions">'
      + '<button type="button" class="btn-editor" id="picker-none">Bez ukázky</button>'
      + '<button type="button" class="btn-editor" id="picker-close">Zavřít</button>'
      + '</div>';
    document.body.appendChild(dialog);
    previewDialog = dialog;

    const author = authorsText(authorsOf(song));
    dialog.querySelector('h2').textContent = song.title;
    const current = dialog.querySelector('.picker-current');
    const now = SongPreview.get(song.slug);
    current.textContent = now
      ? 'Teď hraje: ' + now.track + ' / ' + now.artist
        + (now.locked ? ' (vybráno ručně)' : now.match === 'title' ? ' (jiný interpret)' : '')
      : 'Zatím bez ukázky';

    const query = dialog.querySelector('#picker-query');
    query.value = (song.title + ' ' + author).trim();
    const results = dialog.querySelector('#picker-results');

    function choose(entry) {
      // One object for both sides: the row has to show the "locked" ring
      // straight away, or a review pass can't tell which songs are already
      // confirmed. (Search results carry album/year too - those are for the
      // dialog only and don't belong in the committed file.)
      const saved = entry
        ? { url: entry.url, track: entry.track, artist: entry.artist, match: 'exact', locked: true }
        : null;
      SongPreview.set(song.slug, saved);
      pendingPreviews.set(song.slug, saved);
      close();
      filterSongList();
      refreshDirtyUI();
      setStatus(entry
        ? `Ukázka pro „${song.title}“: ${entry.track} / ${entry.artist} – ulož změny`
        : `„${song.title}“ zůstane bez ukázky – ulož změny`, '');
    }

    function render(list) {
      results.innerHTML = '';
      if (!list.length) {
        // The dead end where a link is the answer: the catalogue's search
        // index misses songs its lookup endpoint knows perfectly well.
        results.innerHTML = '<p class="picker-empty">Nic se nenašlo. Zkus jiný dotaz –'
          + ' nebo píseň najdi na music.apple.com a vlož sem odkaz na ni.</p>';
        return;
      }
      list.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'picker-row';

        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'btn-preview-play';
        play.dataset.slug = 'picker-' + i;
        play.textContent = '▶';
        play.title = 'Poslechnout';
        play.addEventListener('click', () => {
          if (SongPreview.playing() === 'picker-' + i) SongPreview.stop();
          else SongPreview.playUrl(r.url, 'picker-' + i);
        });
        row.appendChild(play);

        const info = document.createElement('div');
        info.className = 'picker-info';
        info.innerHTML = '<span class="picker-track"></span><span class="picker-artist"></span>';
        info.querySelector('.picker-track').textContent = r.track;
        info.querySelector('.picker-artist').textContent =
          r.artist + (r.album ? ' · ' + r.album : '') + (r.year ? ' · ' + r.year : '');
        row.appendChild(info);

        const take = document.createElement('button');
        take.type = 'button';
        take.className = 'btn-editor btn-save';
        take.textContent = 'Vybrat';
        take.addEventListener('click', () => choose(r));
        row.appendChild(take);

        results.appendChild(row);
      });
    }

    function runSearch() {
      results.innerHTML = '<p class="picker-empty">Hledám…</p>';
      SongPreview.searchCatalogue(query.value).then(render);
    }

    function close() {
      SongPreview.stop();
      dialog.close();
      dialog.remove();
      if (previewDialog === dialog) previewDialog = null;
    }

    dialog.querySelector('#picker-go').addEventListener('click', runSearch);
    query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
      e.stopPropagation(); // triage keys must not fire while typing here
    });
    dialog.querySelector('#picker-none').addEventListener('click', () => choose(null));
    dialog.querySelector('#picker-close').addEventListener('click', close);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

    dialog.showModal();
    runSearch();
  }

  function refreshListItemDirty(slug) {
    const li = document.querySelector('#song-list-wrap [data-slug="' + slug + '"]');
    if (li) li.classList.toggle('modified', isDirty(slug));
  }

  function refreshDirtyUI() {
    if (currentSong) refreshListItemDirty(currentSong.slug);
    // Hand-picked previews are unsaved work too, even when they're the only
    // thing pending and no song itself changed.
    const n = new Set(getDirtySlugs().concat(Array.from(pendingPreviews.keys()))).size;
    saveAllCount.textContent = n ? '(' + n + ')' : '';
    btnSaveAll.disabled = n === 0;
  }

  // === Pending-edit / dirty-state helpers ===
  function isEditDirty(e) {
    return e.isNew || e.title !== e.baseTitle ||
      authorsText(e.authors) !== authorsText(e.baseAuthors) ||
      e.capo !== e.baseCapo || e.language !== e.baseLanguage || e.body !== e.baseBody ||
      e.progression !== e.baseProgression || e.note !== e.baseNote;
  }

  function isStatusDirty(slug) {
    const song = allSongs.find(s => s.slug === slug);
    return !!song && baseStatus.has(slug) && statusOf(song) !== baseStatus.get(slug);
  }

  function isDirty(slug) {
    const e = pendingEdits.get(slug);
    return (e ? isEditDirty(e) : false) || isStatusDirty(slug);
  }

  function getDirtySlugs() {
    const out = new Set();
    pendingEdits.forEach((e, slug) => { if (isEditDirty(e)) out.add(slug); });
    allSongs.forEach(s => { if (isStatusDirty(s.slug)) out.add(s.slug); });
    // A deleted draft is only removed from songs.json on the next save, so
    // it has to count as unsaved work (and hold up the beforeunload warning).
    pendingDeletes.forEach((d, slug) => out.add(slug));
    return Array.from(out);
  }

  // Pulls the topbar + editor area into the current song's pending entry.
  function syncCurrentEdits() {
    if (!currentSong) return;
    const e = pendingEdits.get(currentSong.slug);
    if (!e) return; // load failed earlier - edits aren't tracked, can't be saved
    e.title = editTitle.value;
    e.authors = readAuthorChips();
    e.capo = parseInt(editCapo.value, 10) || 0;
    e.language = editLanguage.value;
    e.body = readBody();
    e.progression = editProgression.value;
    e.note = editNote.value;
    refreshDirtyUI();
    schedulePreview();
  }

  function setSongStatus(song, status) {
    applyStatus(song, status); // live value, so the sidebar moves it at once
    filterSongList();
    refreshDirtyUI();
  }

  // === Throwing a draft away ===
  // Drops the row immediately (no confirm dialog - clicking through a few
  // hundred návrhy has to stay one click per song) and offers "Vrátit" in
  // the status bar. Nothing leaves the browser until Uložit / Uložit vše.
  function deleteDraft(song) {
    if (!isDraft(song)) return;
    const idx = allSongs.indexOf(song);
    if (idx === -1) return;

    allSongs.splice(idx, 1);
    pendingDeletes.set(song.slug, { song, idx });

    // The editor can't stay open on a song that's no longer in the list.
    if (currentSong && currentSong.slug === song.slug) {
      currentSong = null;
      editorActive.style.display = 'none';
      editorPlaceholder.style.display = '';
    }

    filterSongList();
    refreshDirtyUI();
    showDeleteUndo();
  }

  function undoLastDelete() {
    const slugs = Array.from(pendingDeletes.keys());
    const slug = slugs[slugs.length - 1];
    if (!slug) return;
    const { song, idx } = pendingDeletes.get(slug);
    pendingDeletes.delete(slug);
    allSongs.splice(Math.min(idx, allSongs.length), 0, song);
    filterSongList();
    refreshDirtyUI();
    showDeleteUndo();
  }

  // Status line naming the most recent deletion, with the undo button that
  // unwinds the stack one at a time.
  function showDeleteUndo() {
    const slugs = Array.from(pendingDeletes.keys());
    if (!slugs.length) {
      setStatus('Smazání vráceno', '');
      return;
    }
    const last = pendingDeletes.get(slugs[slugs.length - 1]);
    const n = slugs.length;
    setStatus(
      `Smazáno: ${last.song.title}` +
      (n > 1 ? ` (celkem ${n} ${plural(n, 'návrh', 'návrhy', 'návrhů')} ke smazání)` : '') + ' ',
      ''
    );
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'status-undo';
    btn.textContent = 'Vrátit';
    btn.title = 'Vrátit poslední smazání (Ctrl+Z)';
    btn.addEventListener('click', undoLastDelete);
    editorStatus.appendChild(btn);
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

  // Narrows the list to one preview state. Checking a few hundred matches by
  // eye means hunting for dashed rings down a list of hundreds; "ke kontrole"
  // turns that into a short list of exactly the ones the matcher guessed at.
  function matchesPreviewFilter(song) {
    if (!listPreviewFilter) return true;
    const p = window.SongPreview && SongPreview.get(song.slug);
    const raw = window.SongPreview && SongPreview.all()[song.slug];
    switch (listPreviewFilter) {
      // Someone else's recording, picked automatically - the state where a
      // genuinely wrong song hides. Hand-picked ones drop out: they're done.
      case 'review': return !!p && p.match === 'title' && !p.locked;
      case 'none': return !p;
      case 'locked': return !!(raw && raw.locked);
      default: return true;
    }
  }

  function filterSongList() {
    const q = normalizeForSearch(editorSearch.value.trim());
    const filtered = allSongs.filter(s =>
      normalizeForSearch(s.title + ' ' + authorsText(authorsOf(s))).includes(q)
      && matchesPreviewFilter(s)
    );
    renderSongList(filtered);
    if (q) {
      // Make sure search hits in a collapsed section are visible.
      listSections.forEach(sec => { sec.details.open = true; });
    }
  }

  // === Interpret chips ===
  // The author field is a list, not a string: each interpret is its own chip
  // so the song list can show "Nedvědi, Karel Plíhal" as two artists rather
  // than one oddly-named band.
  function readAuthorChips() {
    return Array.from(editAuthors.querySelectorAll('.author-chip'))
      .map(chip => chip.dataset.author)
      .filter(a => a && a.trim() !== '');
  }

  function renderAuthorChips(list) {
    editAuthors.querySelectorAll('.author-chip').forEach(c => c.remove());
    list.forEach(name => {
      const chip = document.createElement('span');
      chip.className = 'author-chip';
      chip.dataset.author = name;

      const label = document.createElement('span');
      label.className = 'author-chip-name';
      label.textContent = name;
      chip.appendChild(label);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'author-chip-del';
      del.textContent = '×';
      del.title = 'Odebrat interpreta';
      del.addEventListener('click', () => {
        chip.remove();
        syncCurrentEdits();
      });
      chip.appendChild(del);

      editAuthors.insertBefore(chip, editAuthorInput);
    });
  }

  // Commits whatever is typed in the trailing input as one or more chips
  // (a pasted "A, B" splits). Returns true if anything was added.
  function commitAuthorInput() {
    const parts = editAuthorInput.value.split(',').map(s => s.trim()).filter(s => s !== '');
    if (!parts.length) {
      editAuthorInput.value = '';
      return false;
    }
    const existing = readAuthorChips();
    parts.forEach(p => { if (existing.indexOf(p) === -1) existing.push(p); });
    renderAuthorChips(existing);
    editAuthorInput.value = '';
    syncCurrentEdits();
    return true;
  }

  function bindAuthorChips() {
    // Attached before the handlers below, because that's what lets Enter on a
    // highlighted suggestion pick it instead of committing the typed prefix:
    // the suggest listener stops the rest of this element's keydown listeners,
    // and only listeners registered after it can be stopped.
    AuthorSuggest.attach(editAuthorInput, {
      anchor: editAuthors,
      candidates: buildAuthorIndex,
      exclude: readAuthorChips,
      emptyText: 'Nový interpret – tenhle zápis tu ještě není',
      pick: (name) => {
        editAuthorInput.value = name;
        commitAuthorInput();
      }
    });

    editAuthorInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commitAuthorInput();
        return;
      }
      // Backspace in an empty field pulls the last chip back for editing,
      // the way tag inputs normally behave.
      if (e.key === 'Backspace' && editAuthorInput.value === '') {
        const chips = editAuthors.querySelectorAll('.author-chip');
        const last = chips[chips.length - 1];
        if (last) {
          e.preventDefault();
          editAuthorInput.value = last.dataset.author;
          last.remove();
          syncCurrentEdits();
        }
      }
    });
    // Leaving the field must not silently drop half-typed input.
    editAuthorInput.addEventListener('blur', commitAuthorInput);
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
      renderAuthorChips(cached.authors);
      editAuthorInput.value = '';
      editCapo.value = cached.capo || '';
      editLanguage.value = cached.language;
      editProgression.value = cached.progression || '';
      editNote.value = cached.note || '';
      setBody(cached.body);
      resetHistory();
      syncHotbarToSong(song, cached.body);
      renderPreview();
      filterSongList();
      setStatus(
        cached.isNew ? `Nová píseň: ${cached.title} (zatím jen v prohlížeči)` : `Načteno (z mezipaměti): ${song.title}`,
        'success'
      );
      return;
    }

    editTitle.value = song.title;
    renderAuthorChips(authorsOf(song));
    editAuthorInput.value = '';
    editCapo.value = (song.tags && song.tags.capo) ? song.tags.capo : '';
    editLanguage.value = (song.tags && song.tags.language) ? song.tags.language : '';
    // song.progression comes from the already-loaded songs.json listing
    // (like title/author/tags above), not the per-song GitHub fetch below.
    const progressionText = SongSections.progressionToText(song.progression || []);
    editProgression.value = progressionText;
    const note = song.note || '';
    editNote.value = note;

    const capo = (song.tags && typeof song.tags.capo === 'number') ? song.tags.capo : 0;
    const language = (song.tags && song.tags.language) || '';

    function startEditing(rawHtml, body) {
      setBody(body);
      resetHistory(); // undo never reaches back into a previously open song
      syncHotbarToSong(song, body);
      renderPreview();
      pendingEdits.set(song.slug, {
        isNew: false,
        rawHtml: rawHtml,
        title: song.title,
        authors: authorsOf(song),
        capo, language,
        // Read back the normalized markup (setBody sanitizes, and the
        // browser can reflow raw HTML on assignment) so later dirty-checks
        // compare like with like instead of diffing against the
        // pre-normalization regex capture.
        body: readBody(),
        progression: progressionText,
        note,
        baseTitle: song.title,
        baseAuthors: authorsOf(song),
        baseCapo: capo,
        baseLanguage: language,
        baseBody: readBody(),
        baseProgression: progressionText,
        baseNote: note
      });
      filterSongList();
    }

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

      startEditing(html, m[1]);
      setStatus(`Načteno: ${song.title}`, 'success');
    } catch (e) {
      // A draft (návrh / k vytvoření) legitimately has no songs/*.html yet -
      // that's the whole point, it's a title waiting for a text. Open it
      // empty so it can be written; anything else is a real load failure.
      if (e.status === 404 && isDraft(song)) {
        startEditing(null, '');
        setStatus(`${statusLabel(statusOf(song))}: ${song.title} — text zatím prázdný`, '');
        return;
      }
      // Deliberately no pendingEdits entry on failure - saveCurrentSong()
      // refuses to save a song with no entry, so an error message can never
      // get written into the file in place of real content.
      setStatus('Chyba při načítání písně', 'error');
    }
  }

  // === The editing surface ===
  // .editor-area holds exactly two kinds of node: text nodes containing real
  // "\n" characters (the area is white-space: pre-wrap, so they render as
  // line breaks), and chord <span>s. Nothing else - no <div>, no <br>, no
  // pasted formatting. That invariant is what makes the editor and the live
  // preview agree: sections.js sees the very same lines the caret moves
  // through. setBody() enforces it on the way in, readBody() on the way out.
  function makeChordSpan(name) {
    const span = document.createElement('span');
    span.className = 'chord';
    span.dataset.chord = name;
    span.textContent = name;
    span.contentEditable = 'false';
    return span;
  }

  function sanitizeBody(html) {
    const src = document.createElement('div');
    // normalizeBreaks turns <br>/<div>/<p> and &nbsp; into "\n" and plain
    // spaces while leaving chord spans alone - the same function sections.js
    // parses with, so both sides see identical line breaks.
    src.innerHTML = SongSections.normalizeBreaks(html);

    const out = document.createElement('div');
    (function visit(node, into) {
      Array.prototype.forEach.call(node.childNodes, (n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          into.appendChild(document.createTextNode(n.nodeValue));
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          const chord = n.dataset && n.dataset.chord;
          if (chord) into.appendChild(makeChordSpan(chord));
          else visit(n, into); // unwrap anything else, keep its text
        }
      });
    })(src, out);

    return out.innerHTML;
  }

  function setBody(html) {
    editorArea.innerHTML = sanitizeBody(html || '');
  }

  // contenteditable="false" is an editing affordance (it makes a chord
  // atomic under the caret), not song data - strip it so songs/*.html stays
  // exactly as clean as it is today.
  function readBody() {
    return editorArea.innerHTML.replace(/ contenteditable="false"/g, '');
  }

  // === Caret <-> model offsets ===
  // The DOM side of js/song-edit.js: the area's children map onto that
  // module's flat string, a chord span counting as the single MARKER
  // character it is there. Every edit is expressed as offsets into that
  // string, so nothing in this editor ever has to reason about a range
  // boundary that landed inside a chord span again.

  // Direct child of .editor-area that contains `node`, or null.
  function topChildOf(node) {
    while (node && node !== editorArea && node.parentNode !== editorArea) {
      node = node.parentNode;
    }
    return node && node !== editorArea ? node : null;
  }

  function childLength(n) {
    return n.nodeType === Node.TEXT_NODE ? n.nodeValue.length : 1;
  }

  // DOM position -> model offset. `side` decides where a position that fell
  // INSIDE a chord span goes: 'left'/'right' push a selection's ends outwards
  // so the chord is wholly in or wholly out, 'near' snaps a caret to the
  // closer edge.
  function modelOffset(node, offset, side) {
    if (!node) return 0;
    if (node === editorArea) {
      let at = 0;
      for (let k = 0; k < offset && k < editorArea.childNodes.length; k++) {
        at += childLength(editorArea.childNodes[k]);
      }
      return at;
    }
    const top = topChildOf(node);
    if (!top) return 0;
    let at = 0;
    for (let k = 0; k < editorArea.childNodes.length; k++) {
      const child = editorArea.childNodes[k];
      if (child === top) {
        if (child.nodeType === Node.TEXT_NODE) {
          return at + Math.min(offset, child.nodeValue.length);
        }
        if (side === 'left') return at;
        if (side === 'right') return at + 1;
        return at + (offset > 0 ? 1 : 0);
      }
      at += childLength(child);
    }
    return at;
  }

  // Model offset -> DOM position, for putting the caret back.
  function domPosition(index) {
    const nodes = editorArea.childNodes;
    let at = 0;
    for (let k = 0; k < nodes.length; k++) {
      const child = nodes[k];
      if (child.nodeType === Node.TEXT_NODE) {
        const len = child.nodeValue.length;
        if (index <= at + len) return { node: child, offset: index - at };
        at += len;
      } else {
        if (index <= at) return { node: editorArea, offset: k };
        at += 1;
      }
    }
    return { node: editorArea, offset: nodes.length };
  }

  // The current selection as model offsets, or null when the caret isn't in
  // the editing area at all.
  function selectionOffsets() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const root = range.commonAncestorContainer;
    if (root !== editorArea && !editorArea.contains(root)) return null;
    if (range.collapsed) {
      const at = modelOffset(range.startContainer, range.startOffset, 'near');
      return { from: at, to: at };
    }
    return {
      from: modelOffset(range.startContainer, range.startOffset, 'left'),
      to: modelOffset(range.endContainer, range.endOffset, 'right')
    };
  }

  // Same thing, but never null: with no caret in the area (a toolbar button
  // clicked before ever clicking into the text) an edit lands at the end.
  function selectionOrEnd() {
    const sel = selectionOffsets();
    if (sel) return sel;
    const end = readModel().text.length;
    return { from: end, to: end };
  }

  function readModel() {
    return SongEdit.parse(readBody());
  }

  function placeCaret(from, to) {
    const sel = window.getSelection();
    const range = document.createRange();
    const a = domPosition(from);
    const b = to === from ? a : domPosition(to);
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Writes an edit back: rendered model in, caret restored, song marked
  // dirty. Assigning innerHTML fires no `input` event, so the sync is
  // explicit - and it re-establishes the "text nodes + chord spans only"
  // invariant on every single edit rather than hoping it survived.
  function writeModel(result, historyKind) {
    if (historyKind !== null) pushHistory(historyKind === undefined ? '' : historyKind);
    setBody(SongEdit.render(result.model));
    editorArea.focus();
    placeCaret(result.from, result.to === undefined ? result.from : result.to);
    if (currentSong) syncCurrentEdits();
  }

  // === Undo / redo ===
  // The editor's own, because the browser's stopped being usable here long
  // ago: every chord insert, every Enter and every toolbar action rewrites
  // the DOM behind its back, and it silently skips them - undo after
  // inserting a chord takes back whatever was typed BEFORE it and leaves the
  // chord sitting there. This stack sees every edit, because every edit goes
  // through writeModel().
  //
  // Consecutive edits of the same kind inside COALESCE_MS collapse into one
  // entry, so undo takes back a typed word rather than a letter.
  const HISTORY_MAX = 200;
  const COALESCE_MS = 1200;
  let undoStack = [];
  let redoStack = [];
  let historyKind = '';
  let historyAt = 0;

  function snapshotState() {
    const model = readModel();
    const sel = selectionOffsets() || { from: model.text.length, to: model.text.length };
    return { text: model.text, chords: model.chords.slice(), from: sel.from, to: sel.to };
  }

  function resetHistory() {
    undoStack = [];
    redoStack = [];
    historyKind = '';
    historyAt = 0;
  }

  function pushHistory(kind) {
    const now = Date.now();
    const coalesce = undoStack.length && kind !== '' &&
      kind === historyKind && (now - historyAt) < COALESCE_MS;
    if (!coalesce) {
      undoStack.push(snapshotState());
      if (undoStack.length > HISTORY_MAX) undoStack.shift();
    }
    historyKind = kind;
    historyAt = now;
    redoStack = [];
  }

  function restoreState(state) {
    setBody(SongEdit.render({ text: state.text, chords: state.chords }));
    editorArea.focus();
    placeCaret(state.from, state.to);
    if (currentSong) syncCurrentEdits();
  }

  function undoEdit() {
    if (!undoStack.length) return;
    redoStack.push(snapshotState());
    restoreState(undoStack.pop());
    historyKind = '';
  }

  function redoEdit() {
    if (!redoStack.length) return;
    undoStack.push(snapshotState());
    restoreState(redoStack.pop());
    historyKind = '';
  }

  // === Chord insertion ===
  function insertChord(chordName) {
    if (!chordName) return;
    editorArea.focus();
    const sel = selectionOrEnd();
    writeModel(SongEdit.insertChord(readModel(), sel.from, sel.to, chordName), 'chord');
    chordInput.value = '';
    addToHotbar(chordName);
  }

  // === Chord hotbar ===
  // A chord I just typed goes to the front of the bar, because the next
  // thing I do with a new chord is use it again. One that's already there
  // keeps its slot - the number shortcuts would be useless if every insert
  // reshuffled them.
  function addToHotbar(chordName) {
    if (!chordName || hotbar.indexOf(chordName) !== -1) return;
    hotbar.unshift(chordName);
    if (hotbar.length > HOTBAR_MAX) hotbar.length = HOTBAR_MAX;
    saveHotbar();
    renderHotbar();
  }

  // Opening a song puts its own chords on the bar, in the order they're
  // first played, then tops the bar up with what was there before so the
  // usual suspects stay within reach.
  function syncHotbarToSong(song, body) {
    const fromBody = extractChords(body || '');
    const chords = fromBody.length ? fromBody : (song && Array.isArray(song.chords) ? song.chords : []);
    if (!chords.length) return;

    const next = chords.slice(0, HOTBAR_MAX);
    hotbar.concat(DEFAULT_HOTBAR).forEach(c => {
      if (next.length < HOTBAR_MAX && next.indexOf(c) === -1) next.push(c);
    });
    hotbar = next;
    saveHotbar();
    renderHotbar();
  }

  let hotbarDragFrom = -1;

  function renderHotbar() {
    chordHotbar.innerHTML = '';
    hotbar.forEach((chord, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-sm btn-quick-chord';
      btn.dataset.chord = chord;
      btn.dataset.index = i;
      btn.draggable = true;
      btn.title = (i < 9 ? 'Zkratka: ' + (i + 1) + ' · ' : '') +
        'Táhni pro přesun · pravé tlačítko odebere';

      if (i < 9) {
        const hint = document.createElement('span');
        hint.className = 'key-hint';
        hint.textContent = (i + 1);
        btn.appendChild(hint);
      }
      btn.appendChild(document.createTextNode(chord));

      btn.addEventListener('click', () => insertChord(chord));
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        hotbar.splice(i, 1);
        saveHotbar();
        renderHotbar();
      });

      btn.addEventListener('dragstart', (e) => {
        hotbarDragFrom = i;
        btn.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Firefox only starts a drag once some data is set.
        e.dataTransfer.setData('text/plain', chord);
      });
      btn.addEventListener('dragend', () => {
        hotbarDragFrom = -1;
        btn.classList.remove('dragging');
      });
      btn.addEventListener('dragover', (e) => {
        if (hotbarDragFrom === -1) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        btn.classList.add('drop-target');
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('drop-target'));
      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        btn.classList.remove('drop-target');
        if (hotbarDragFrom === -1 || hotbarDragFrom === i) return;
        const [moved] = hotbar.splice(hotbarDragFrom, 1);
        hotbar.splice(i, 0, moved);
        hotbarDragFrom = -1;
        saveHotbar();
        renderHotbar();
      });

      chordHotbar.appendChild(btn);
    });
  }

  // === Section fences ===
  // "//R" ... "R//" around the selection, or an empty pair with the caret
  // parked inside it. The repeat pair ("//:" / "://") is the same thing with
  // name ":", so one function covers both buttons.
  function updateSectionButton() {
    const name = sectionNameInput.value.trim() || 'R';
    sectionBtnPreview.textContent = '//' + name + ' … ' + name + '//';
  }

  // The markers are wrapped around the SELECTED OFFSETS, not around a DOM
  // range: the chorus being fenced usually starts with a chord, and a range
  // that starts inside that chord's span used to swallow the whole section
  // into it - the fence markers included, which is why the chord highlight
  // ran on to the end of the chorus.
  function insertFence(name) {
    if (!name) return;
    editorArea.focus();
    const sel = selectionOrEnd();
    const inline = name === SongSections.REPEAT_NAME;
    writeModel(SongEdit.wrapFence(readModel(), sel.from, sel.to, name, inline), 'fence');
  }

  // === Cleanup / transpose actions ===
  function applyCleanup(fn) {
    if (!currentSong) return;
    try {
      pushHistory('');
      setBody(fn(readBody()));
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

  // Number keys 1..9 insert the matching hotbar chord at the caret.
  function handleChordShortcut(e) {
    if (!chordShortcutsEnabled || isEditorHidden()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^[1-9]$/.test(e.key)) return;
    const idx = parseInt(e.key, 10) - 1;
    const chord = hotbar[idx];
    if (!chord) return;
    e.preventDefault();
    insertChord(chord);
  }

  // === Editor keydown handling ===
  // Only the two things `beforeinput` can't do: undo/redo (the browser stops
  // reporting historyUndo once its own stack is empty, and preventing every
  // edit empties it immediately) and Escape-free navigation. Everything that
  // changes the text is handled in handleBeforeInput.
  function handleEditorKeydown(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undoEdit();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      redoEdit();
    }
  }

  // === Every edit, in one place ===
  // The area is contenteditable, so the browser wants to do the editing. It
  // is not allowed to: `beforeinput` names what is about to happen, this
  // turns that into offsets on the flat model in js/song-edit.js, and
  // writeModel() renders the result back. One keypress therefore always
  // removes exactly one unit - a character or a whole chord - whatever the
  // DOM around the caret happens to look like.
  //
  // Composition (dead keys, IME) is left to the browser: it owns a
  // multi-keystroke sequence and interrupting it mid-way loses the accent.
  // The `input` listener syncs whatever it produces.
  const DELETE_RANGE = {
    deleteContentBackward: (t, i) => [SongEdit.stepBack(t, i), i],
    deleteContent: (t, i) => [SongEdit.stepBack(t, i), i],
    deleteContentForward: (t, i) => [i, SongEdit.stepForward(t, i)],
    deleteWordBackward: (t, i) => [SongEdit.wordBack(t, i), i],
    deleteWordForward: (t, i) => [i, SongEdit.wordForward(t, i)],
    deleteSoftLineBackward: (t, i) => [SongEdit.lineBack(t, i), i],
    deleteHardLineBackward: (t, i) => [SongEdit.lineBack(t, i), i],
    deleteSoftLineForward: (t, i) => [i, SongEdit.lineForward(t, i)],
    deleteHardLineForward: (t, i) => [i, SongEdit.lineForward(t, i)]
  };

  function handleBeforeInput(e) {
    if (e.isComposing) return;
    const type = e.inputType || '';
    if (type.indexOf('Composition') !== -1) return;

    const sel = selectionOffsets();
    if (!sel) return;

    if (type.indexOf('delete') === 0) {
      e.preventDefault();
      // Dragging text about is off (see insertFromDrop below), so the
      // matching delete has to be off too - otherwise the dragged text is
      // removed here and never put back down.
      if (type === 'deleteByDrag') return;
      const model = readModel();
      let from = sel.from;
      let to = sel.to;
      if (from === to) {
        const unit = DELETE_RANGE[type];
        if (!unit) return; // deleteByDrag/deleteByCut with nothing selected
        const span = unit(model.text, from);
        from = span[0];
        to = span[1];
      }
      if (from === to) return; // already at the very start / very end
      writeModel(SongEdit.remove(model, from, to), 'delete');
      scrollCaretIntoView();
      return;
    }

    // Enter is a blank line (that's what separates blocks in a song),
    // Shift+Enter a plain line break inside the block.
    let text = null;
    if (type === 'insertText' || type === 'insertReplacementText') text = e.data || '';
    else if (type === 'insertParagraph') text = '\n\n';
    else if (type === 'insertLineBreak') text = '\n';

    if (text !== null) {
      e.preventDefault();
      writeModel(SongEdit.replace(readModel(), sel.from, sel.to, text),
        text.indexOf('\n') === -1 ? 'type' : '');
      scrollCaretIntoView();
      return;
    }

    // Bold/italic/links from a stray Ctrl+B, and drag-and-drop of rich
    // content: a song is plain text plus chords, so none of it is wanted.
    // (Paste has its own handler below and never reaches this.)
    e.preventDefault();
  }

  // Programmatic insertion doesn't scroll the caret into view the way typing
  // does; nudge it so Enter at the bottom of a long song doesn't type blind.
  function scrollCaretIntoView() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.height && !rect.top) return; // collapsed at a break - no useful box
    // Only when the caret is genuinely off-box, and only far enough to bring
    // it back: this now runs on every keystroke, and a nudge that fires while
    // the caret is still visible would make the view creep as you type.
    const box = editorArea.getBoundingClientRect();
    const margin = 24;
    if (rect.bottom > box.bottom) editorArea.scrollTop += (rect.bottom - box.bottom) + margin;
    else if (rect.top < box.top) editorArea.scrollTop -= (box.top - rect.top) + margin;
  }

  // Paste is plain text only. Pasting a verse off a chord site otherwise
  // brings that site's markup - fonts, colours, tables - into the song.
  function handlePaste(e) {
    e.preventDefault();
    const clip = e.clipboardData || window.clipboardData;
    const text = clip ? clip.getData('text/plain') : '';
    if (!text) return;
    const sel = selectionOrEnd();
    writeModel(SongEdit.replace(readModel(), sel.from, sel.to, text.replace(/\r\n?/g, '\n')), '');
    scrollCaretIntoView();
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
    const src = readBody();
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
    if (block.label) return block.label;
    const base = block.type === 'refren' ? 'R' : block.type === 'bridge' ? 'B' : 'S';
    return base + block.id + ':';
  }

  // Adds the editor-only controls onto the rendered sections:
  //  - a plain block right after a marked section gets "⤴ do R:" (join it),
  //  - a marked section with a merged continuation gets "⤵ odpojit konec",
  //  - a lowercase-starting block right after a section is flagged as a
  //    suspected chorus continuation (dashed outline, button always visible).
  //
  // All three are about the legacy indent convention for "what still belongs
  // to this section". A fenced section states its own end, so it gets none
  // of them.
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

      if (!b.marker && prev && prev.marker && !prev.fenced) {
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

      if (b.marker && !b.fenced && b.lines.indexOf('') > 0) {
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
    const src = readBody();
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

    setBody(lines.join('\n'));
    syncCurrentEdits();
    renderPreview();
  }

  // === New song ===
  function createNewSong() {
    const title = newTitleInput.value.trim();
    if (!title) return;
    const authors = splitAuthors(newAuthorInput.value).filter(s => s !== '');
    const capo = parseInt(newCapoInput.value, 10) || 0;
    const language = newLanguageSelect.value || 'CZ';
    const status = newStatusSelect.value || 'ke-kontrole';

    const taken = new Set(allSongs.map(s => s.slug));
    const slug = SongTemplate.uniqueSlug(SongTemplate.slugify(title), taken);

    // Lives only in memory until Uložit/Uložit vše pushes it - insert
    // sorted so the sidebar and a future songs.json diff both read sanely.
    const song = { title, slug, chords: [], tags: { capo: capo || false, language } };
    applyAuthors(song, authors);
    applyStatus(song, status);
    const idx = allSongs.findIndex(s => s.title.toLowerCase() > title.toLowerCase());
    if (idx === -1) allSongs.push(song); else allSongs.splice(idx, 0, song);
    // A brand-new song is dirty through isNew, so its "base" status is
    // whatever it was created with - it only counts as moved if I move it.
    baseStatus.set(slug, status);

    pendingEdits.set(slug, {
      isNew: true,
      rawHtml: null,
      title, authors, capo, language, body: '', progression: '', note: '',
      baseTitle: null, baseAuthors: null, baseCapo: null, baseLanguage: null, baseBody: null,
      baseProgression: null, baseNote: null
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

  // songs.json's grouped "progression" for a pending entry: a non-blank
  // #edit-progression is authoritative (manual edits win), otherwise it's
  // derived fresh from the current body - same rule the ↻ button uses,
  // just without overwriting the input field. Shared by buildMergedSongsJson
  // (what gets committed) and performSave's bookkeeping (what's mirrored
  // into the in-memory song list) so the two can never disagree.
  function progressionForEntry(e) {
    const text = (e.progression || '').trim();
    return text ? SongSections.parseProgressionText(text) : SongSections.deriveProgression(e.body);
  }

  // Rebuilds songs/<slug>.html for one pending entry. Brand-new songs use
  // the canonical template; existing songs re-apply the same replacements
  // saveToGitHub always used, against the cached rawHtml (no re-fetch needed).
  function buildSongHtml(slug, e) {
    const title = e.title.trim() || e.baseTitle || 'Bez názvu';
    // The song page shows one author line; several interprets join with ", ".
    const author = authorsText(e.authors);
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

  // A draft is done waiting the moment it has a text: saving one with a body
  // promotes it to "ke kontrole" and gives it a real songs/<slug>.html.
  // That's the workflow ("čeká, dokud k ní nepřidám text"), and it's also
  // what keeps the save honest - a draft writes no HTML file, so a body left
  // on a draft would be silently dropped.
  function statusForSave(song, e) {
    const status = statusOf(song);
    const hasBody = !!(e && e.body && e.body.trim() !== '');
    if (isDraftStatusId(status) && hasBody) return 'ke-kontrole';
    return status;
  }

  // Fetches a FRESH songs.json and applies pending state for ONLY the given
  // slugs, so a per-song save can never leak some other song's unrelated
  // pending edits or status change into the committed file.
  // Same read-modify-write as songs.json below: the file on GitHub is the
  // base, not the copy this tab loaded. scripts/build-previews.js and other
  // sessions both write it, and a whole-file overwrite from a stale copy
  // would silently drop hundreds of resolved previews.
  async function buildMergedPreviewsJson() {
    const data = JSON.parse(await getFileContent(PREVIEWS_JSON_PATH));
    data.previews = data.previews || {};
    pendingPreviews.forEach((entry, slug) => {
      data.previews[slug] = entry || { match: 'none', locked: true };
    });
    // Keep the key order the script writes, so a hand-pick shows up in the
    // diff as one changed entry rather than a reshuffled file.
    const sorted = {};
    Object.keys(data.previews).sort().forEach(k => { sorted[k] = data.previews[k]; });
    data.previews = sorted;
    return JSON.stringify(data, null, 2) + '\n';
  }

  // Appends the drafts being deleted to navrhy-zamitnute.json. Same
  // read-modify-write against GitHub as the two above: the list only ever
  // grows, and losing entries to a stale copy would defeat the whole point of
  // keeping it. A slug already in there is left alone (deleted, put back with
  // Ctrl+Z, deleted again).
  async function buildMergedRejectedJson(slugs) {
    let data;
    try {
      data = JSON.parse(await getFileContent(REJECTED_JSON_PATH));
    } catch (err) {
      if (err.status !== 404) throw err;
      data = {};
    }
    if (!Array.isArray(data.rejected)) data.rejected = [];

    const known = new Set(data.rejected.map(r => r.slug));
    const today = new Date().toISOString().slice(0, 10);
    slugs.forEach(slug => {
      const d = pendingDeletes.get(slug);
      if (!d || known.has(slug)) return;
      known.add(slug);
      data.rejected.push({
        title: d.song.title,
        author: authorsText(authorsOf(d.song)),
        slug: slug,
        date: today,
        reason: 'odmítnuto'
      });
    });

    data.rejected.sort((a, b) => {
      const at = String(a.title || '').toLowerCase();
      const bt = String(b.title || '').toLowerCase();
      return at < bt ? -1 : at > bt ? 1 : String(a.slug).localeCompare(String(b.slug));
    });
    return JSON.stringify(data, null, 2) + '\n';
  }

  async function buildMergedSongsJson(slugs) {
    const data = JSON.parse(await getFileContent(SONGS_JSON_PATH));

    for (const slug of slugs) {
      if (pendingDeletes.has(slug)) {
        const at = data.songs.findIndex(s => s.slug === slug);
        if (at !== -1) data.songs.splice(at, 1);
        continue;
      }

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
        applyAuthors(song, e.authors);
        if (!song.tags) song.tags = {};
        song.tags.capo = e.capo || false;
        if (e.language) song.tags.language = e.language;
        song.chords = extractChords(e.body);
        const progression = progressionForEntry(e);
        if (progression.length) song.progression = progression;
        else delete song.progression;
        // An emptied note leaves no trace in the file - the field is absent
        // on almost every song and should stay that way.
        const note = (e.note || '').trim();
        if (note) song.note = note;
        else delete song.note;
      }

      if (local) applyStatus(song, statusForSave(local, e));
    }

    return JSON.stringify(data, null, 2);
  }

  // songs/*.html paths that must disappear along with the deleted entries.
  // A draft normally has no page at all, but one demoted back out of review
  // keeps its file - leaving that behind would orphan it, which is exactly
  // what scripts/validate-data.js fails CI over. Rather than guess, ask the
  // repo which of them actually exist (one listing request, only when
  // something is being deleted).
  async function filesToDelete(slugs) {
    const deleting = slugs.filter(slug => pendingDeletes.has(slug));
    if (!deleting.length) return [];

    let present;
    try {
      const listing = await ghAPI(`/repos/${ghRepo}/contents/${REPO_PATH_PREFIX.replace(/\/$/, '')}?ref=${BRANCH}`);
      present = new Set(listing.map(f => f.name));
    } catch (err) {
      // Couldn't check - deleting the JSON entry while leaving an unknown
      // file behind would break the build, so don't guess.
      throw new Error('Nepodařilo se ověřit soubory písní před smazáním: ' + err.message);
    }

    return deleting
      .filter(slug => present.has(slug + '.html'))
      .map(slug => ({ path: `${REPO_PATH_PREFIX}${slug}.html`, remove: true }));
  }

  // Commits every dirty HTML file among `slugs` plus one merged songs.json,
  // in a single atomic commit (one push = one deploy, no desync).
  async function performSave(slugs, message) {
    const files = [];
    const builtHtml = new Map();

    for (const slug of slugs) {
      if (pendingDeletes.has(slug)) continue; // going away, not being written
      const e = pendingEdits.get(slug);
      const local = allSongs.find(s => s.slug === slug);
      // A draft has no public page - writing one would put an unfinished
      // song on the site and break validate-data.js's file/JSON pairing in
      // the other direction. Only its songs.json entry moves.
      const wantsFile = !local || !isDraftStatusId(statusForSave(local, e));
      if (e && isEditDirty(e) && wantsFile) {
        const html = buildSongHtml(slug, e);
        builtHtml.set(slug, html);
        files.push({ path: `${REPO_PATH_PREFIX}${slug}.html`, content: html });
      }
      // A slug that's only been moved between categories (not isEditDirty)
      // contributes no HTML file either - only its songs.json entry changes.
    }
    files.push(...await filesToDelete(slugs));
    files.push({ path: SONGS_JSON_PATH, content: await buildMergedSongsJson(slugs) });
    if (slugs.some(slug => pendingDeletes.has(slug))) {
      files.push({ path: REJECTED_JSON_PATH, content: await buildMergedRejectedJson(slugs) });
    }
    if (pendingPreviews.size) {
      files.push({ path: PREVIEWS_JSON_PATH, content: await buildMergedPreviewsJson() });
    }

    await commitFiles(files, message);

    // Hand-picked previews are committed now; SongPreview already holds the
    // same values, so clearing the pending map is all that's left.
    pendingPreviews.clear();

    // Bookkeeping: rebase each saved slug's pending entry onto its new
    // "clean" state, and reflect the same fields into allSongs.
    for (const slug of slugs) {
      if (pendingDeletes.has(slug)) {
        // It's gone from songs.json now; forget it entirely so it can't
        // come back as a stale cache entry or an undo target.
        pendingDeletes.delete(slug);
        pendingEdits.delete(slug);
        baseStatus.delete(slug);
        continue;
      }
      const e = pendingEdits.get(slug);
      const local = allSongs.find(s => s.slug === slug);
      if (local) {
        applyStatus(local, statusForSave(local, e));
        baseStatus.set(slug, statusOf(local));
      }
      if (e) {
        const title = e.title.trim() || e.baseTitle || 'Bez názvu';
        if (local) {
          local.title = title;
          applyAuthors(local, e.authors);
          if (!local.tags) local.tags = {};
          local.tags.capo = e.capo || false;
          if (e.language) local.tags.language = e.language;
          local.chords = extractChords(e.body);
          const progression = progressionForEntry(e);
          if (progression.length) local.progression = progression;
          else delete local.progression;
          const note = (e.note || '').trim();
          if (note) local.note = note;
          else delete local.note;
        }
        e.isNew = false;
        if (builtHtml.has(slug)) e.rawHtml = builtHtml.get(slug);
        e.title = title;
        e.baseTitle = title;
        e.baseAuthors = e.authors.slice();
        e.baseCapo = e.capo;
        e.baseLanguage = e.language;
        e.baseBody = e.body;
        e.baseProgression = e.progression;
        e.baseNote = e.note;
      }
    }

    filterSongList();
    refreshDirtyUI();
  }

  async function saveCurrentSong() {
    if (!currentSong || !ghToken) return;
    // Ctrl+S doesn't blur the interpret field, so an artist typed but not yet
    // turned into a chip would otherwise never make it into the save.
    commitAuthorInput();
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
      const before = statusOf(currentSong);
      await performSave([currentSong.slug], message);
      const after = statusOf(currentSong);
      setStatus(
        after === before
          ? `Uloženo: ${title}`
          : `Uloženo: ${title} — přesunuto do „${statusLabel(after)}“`,
        'success'
      );
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
    commitAuthorInput();
    const slugs = getDirtySlugs();
    if (!slugs.length && !pendingPreviews.size) return;

    btnSave.disabled = true;
    btnSaveAll.disabled = true;
    setStatus('Ukládám na GitHub...', 'saving');

    try {
      const removed = slugs.filter(slug => pendingDeletes.has(slug));
      const edited = slugs.filter(slug => !pendingDeletes.has(slug));
      const titleOf = (slug) => {
        const d = pendingDeletes.get(slug);
        if (d) return d.song.title;
        const e = pendingEdits.get(slug);
        const local = allSongs.find(s => s.slug === slug);
        return (e && e.title) || (local && local.title) || slug;
      };
      const list = (arr) =>
        `${arr.map(titleOf).slice(0, 3).join(', ')}${arr.length > 3 ? ', …' : ''}`;

      // Say plainly what left the songbook - a deletion shouldn't hide
      // inside a commit message that only says "Edit".
      const parts = [];
      if (edited.length) {
        parts.push(edited.length === 1
          ? `Edit: ${titleOf(edited[0])}`
          : `Edit: ${edited.length} písní (${list(edited)})`);
      }
      if (removed.length) {
        parts.push(removed.length === 1
          ? `Remove: ${titleOf(removed[0])}`
          : `Remove: ${removed.length} ${plural(removed.length, 'návrh', 'návrhy', 'návrhů')} (${list(removed)})`);
      }
      if (pendingPreviews.size) {
        const n = pendingPreviews.size;
        parts.push(n === 1
          ? `Ukázka: ${titleOf(Array.from(pendingPreviews.keys())[0])}`
          : `Ukázky: ${n} ${plural(n, 'píseň', 'písně', 'písní')}`);
      }
      const message = parts.join('; ');

      const e = edited.length;
      const d = removed.length;
      const savedMsg = `${plural(e, 'Uložena', 'Uloženy', 'Uloženo')} ${e} ${plural(e, 'píseň', 'písně', 'písní')}`;
      const delMsg = `${plural(d, 'smazán', 'smazány', 'smazáno')} ${d} ${plural(d, 'návrh', 'návrhy', 'návrhů')}`;
      await performSave(slugs, message);
      setStatus(
        e && d ? `${savedMsg}, ${delMsg}`
          : d ? delMsg.charAt(0).toUpperCase() + delMsg.slice(1)
            : savedMsg,
        'success'
      );
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
  //
  // A file entry is either { path, content } to write or { path, remove: true }
  // to delete - a tree entry with sha: null is how the Git Data API removes a
  // path from base_tree.
  async function commitFiles(files, message) {
    const ref = await ghAPI(`/repos/${ghRepo}/git/ref/heads/${BRANCH}`);
    const baseCommitSha = ref.object.sha;
    const baseCommit = await ghAPI(`/repos/${ghRepo}/git/commits/${baseCommitSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    const blobShas = [];
    for (const f of files) {
      if (f.remove) {
        blobShas.push(null);
        continue;
      }
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
      const e = new Error(err.message || `GitHub API ${resp.status}`);
      e.status = resp.status; // callers distinguish "no such file" from "no network"
      throw e;
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
