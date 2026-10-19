/**
 * vecer.js - tonight's setlist, alone or together with the party.
 *
 * Alone, the setlist lives in this browser (SongList.setlist). Shared, it
 * lives in the Firebase Realtime Database under /evenings/<id>, and everyone
 * who opened an invite link adds to one queue that updates live on every
 * phone, like a shared playlist.
 *
 * Who may do what is enforced by the database rules
 * (firebase/database.rules.json), not just hidden in the UI:
 *   - the one who started the evening (owner): everything, and the only one
 *     who can empty the whole queue;
 *   - "parta" (the invite link carries the evening's key, ?parta=<id>&k=<key>):
 *     remove anyone's song, move songs, shuffle;
 *   - "host" (?parta=<id> alone, e.g. a school class): add songs and remove
 *     only the ones they added themselves.
 * Every phone gets an anonymous Firebase account for this (no sign-in, no
 * name required); its uid is what "added it themselves" and "owner" mean.
 *
 * Talks to Firebase over REST rather than the SDK: an EventSource on
 * /evenings/<id>.json streams every change, fetch() writes them. Writes made
 * without signal wait in localStorage and go out when the phone is back
 * online - at a chata that is the normal case.
 *
 * Exposed as window.Evening. Needs js/song-list-core.js.
 */
(function () {
  'use strict';

  const SL = window.SongList;

  // From the bekovysongy Firebase project's web config. Neither is a secret:
  // the database rules decide what any request may do.
  const DB_URL = 'https://bekovysongy-default-rtdb.europe-west1.firebasedatabase.app';
  const API_KEY = 'AIzaSyBJHSLjwjiLwKbu5DUBFTW_Zq4_ycYBztY';
  const SIGNUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + API_KEY;
  const REFRESH_URL = 'https://securetoken.googleapis.com/v1/token?key=' + API_KEY;

  const JOINED_KEY = 'bs_evening';         // { id, k, friend } of the evening this browser is in
  const LAST_KEY = 'bs_evening_last';      // the last one, to find the way back after leaving
  const CACHE_KEY = 'bs_evening_cache';    // { id, server } - last state seen, for offline
  const PENDING_KEY = 'bs_evening_pending';
  const AUTH_KEY = 'bs_fb_auth';           // { uid, token, refresh, exp }
  const NAME_KEY = 'bs_name';
  const ID_RE = /^[A-Za-z0-9]{16}$/;
  const KEY_RE = /^[A-Za-z0-9]{20}$/;
  const ME = '__me';                        // stands for our uid in writes queued before we know it
  const MAX_ITEMS = 150;

  function readJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* not remembered */ }
  }

  function randomId(n) {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => abc[b % abc.length]).join('');
  }

  // Item keys are made here, not by the server, so a write retried after the
  // signal comes back lands on the same key instead of adding the song twice.
  function itemKey() {
    return Date.now().toString(36) + randomId(6);
  }

  // ---- state -------------------------------------------------------------

  let joined = readJSON(JOINED_KEY, null);
  if (joined && !ID_RE.test(joined.id || '')) joined = null;

  let auth = readJSON(AUTH_KEY, null);
  let server = null;            // the evening as the database last told us
  let gotServer = false;        // the stream has delivered at least one full state
  let pending = readJSON(PENDING_KEY, []);
  if (!Array.isArray(pending)) pending = [];
  let acked = [];               // just-confirmed writes, kept on top until the stream echoes them
  let status = joined ? 'connecting' : 'local';
  let problem = '';             // why the shared evening doesn't work, in words
  let refusal = '';             // the last write the rules turned down, in words
  let stream = null;
  const listeners = [];

  (function loadCache() {
    const c = readJSON(CACHE_KEY, null);
    if (joined && c && c.id === joined.id) server = c.server || null;
  })();

  function emit() {
    listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }

  function saveJoined() {
    writeJSON(JOINED_KEY, joined);
  }

  const myUid = () => (auth && auth.uid) || '';
  const isMe = (u) => !!u && (u === ME || u === myUid());

  // ---- anonymous sign-in -------------------------------------------------

  let authPromise = null;

  async function token() {
    if (auth && auth.token && auth.exp > Date.now() + 120000) return auth.token;
    if (authPromise) return authPromise;
    authPromise = (async () => {
      let res = null;
      if (auth && auth.refresh) {
        // A network error throws out of here on purpose: offline must never
        // turn into "make a new account", that would cost ownership.
        res = await fetch(REFRESH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(auth.refresh),
        });
        if (res.ok) {
          const d = await res.json();
          auth = { uid: d.user_id, token: d.id_token, refresh: d.refresh_token, exp: Date.now() + Number(d.expires_in) * 1000 };
        }
      }
      if (!res || !res.ok) {
        res = await fetch(SIGNUP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnSecureToken: true }),
        });
        const d = await res.json();
        if (!res.ok) {
          const err = new Error('auth');
          err.code = (d && d.error && d.error.message) || String(res.status);
          throw err;
        }
        auth = { uid: d.localId, token: d.idToken, refresh: d.refreshToken, exp: Date.now() + Number(d.expiresIn) * 1000 };
      }
      writeJSON(AUTH_KEY, auth);
      emit();
      return auth.token;
    })();
    try {
      return await authPromise;
    } finally {
      authPromise = null;
    }
  }

  // ---- the view: server state with our own unconfirmed writes on top ------

  function setAt(obj, segs, value) {
    if (!segs.length) return value;
    const root = obj && typeof obj === 'object' ? Object.assign({}, obj) : {};
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const k = segs[i];
      node[k] = node[k] && typeof node[k] === 'object' ? Object.assign({}, node[k]) : {};
      node = node[k];
    }
    const last = segs[segs.length - 1];
    if (value === null || value === undefined) delete node[last];
    else node[last] = value;
    return root;
  }

  const split = (path) => path.split('/').filter(Boolean);

  function resolveSv(v) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return Date.now();
      const out = {};
      Object.keys(v).forEach(k => { out[k] = resolveSv(v[k]); });
      return out;
    }
    return v;
  }

  // Ops carry a path from the database root; only the ones inside this
  // evening change what is shown.
  function applyOp(tree, op) {
    const base = `evenings/${joined.id}/`;
    const path = op.path.replace(ME, myUid() || ME);
    if (path.indexOf(base) !== 0) return tree;
    const rel = split(path.slice(base.length));
    if (op.method === 'PATCH') {
      let t = tree;
      Object.keys(op.body).forEach(k => { t = setAt(t, rel.concat(split(k)), resolveSv(op.body[k])); });
      return t;
    }
    return setAt(tree, rel, op.method === 'DELETE' ? null : resolveSv(op.body));
  }

  function view() {
    if (!joined) return null;
    let t = server || {};
    acked.concat(pending.filter(op => op.id === joined.id)).forEach(op => { t = applyOp(t, op); });
    return t;
  }

  function items() {
    const t = view();
    const map = (t && t.items) || {};
    return Object.keys(map)
      .map(key => Object.assign({ key }, map[key]))
      .filter(it => it && typeof it.s === 'string' && SL.bySlug(it.s))
      .sort((a, b) => (a.o - b.o) || (a.key < b.key ? -1 : 1));
  }

  function meta() {
    const t = view();
    return (t && t.meta) || null;
  }

  function role() {
    if (!joined) return 'local';
    const m = meta();
    if (m && isMe(m.owner)) return 'owner';
    return joined.friend ? 'parta' : 'host';
  }

  // ---- writes ------------------------------------------------------------

  function send(method, path, body, kind) {
    const op = { id: joined.id, method, path, body: body === undefined ? null : body };
    if (kind) op.kind = kind;
    pending.push(op);
    writeJSON(PENDING_KEY, pending);
    emit();
    flush();
  }

  function withUid(v, uid) {
    if (v === ME) return uid;
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).forEach(k => { out[k] = withUid(v[k], uid); });
      return out;
    }
    return v;
  }

  const REFUSED = {
    items: 'Tohle může jen ten, kdo večer založil, nebo parta.',
    grant: 'Odkaz pro partu už neplatí, jsi tu jako host: přidáváš a odebíráš svoje písně.',
  };

  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (pending.length) {
        let t;
        try {
          t = await token();
        } catch (e) {
          if (e.code) {
            problem = e.code === 'ADMIN_ONLY_OPERATION' || e.code === 'OPERATION_NOT_ALLOWED'
              ? 'Společný večer ještě není zapnutý: ve Firebase chybí anonymní přihlášení.'
              : 'Přihlášení k večeru se nepovedlo (' + e.code + ').';
            setStatus('error');
          } else {
            setStatus('offline');
          }
          return;
        }
        const op = pending[0];
        const uid = myUid();
        const url = `${DB_URL}/${op.path.replace(ME, uid)}.json?auth=${encodeURIComponent(t)}`;
        let res;
        try {
          res = await fetch(url, {
            method: op.method,
            body: op.method === 'DELETE' ? undefined : JSON.stringify(withUid(op.body, uid)),
          });
        } catch (e) {
          setStatus('offline');
          return;
        }
        if (res.status === 401) { auth.exp = 0; continue; }      // stale token: refresh, retry
        if (res.status >= 500) { setStatus('offline'); return; }
        pending.shift();
        writeJSON(PENDING_KEY, pending);
        if (op.kind === 'grant' && joined && op.id === joined.id) {
          joined.friend = res.ok;
          if (!res.ok) { joined.k = ''; refusal = REFUSED.grant; }
          saveJoined();
        }
        if (res.ok) {
          // Keep it applied until the stream has had time to echo it, so the
          // song doesn't blink out between "saved" and "here's the change".
          acked.push(op);
          setTimeout(() => { acked = acked.filter(a => a !== op); emit(); }, 4000);
        } else if (op.kind !== 'grant') {
          console.warn('Evening write refused', res.status, op.path);
          refusal = REFUSED.items;
        }
        emit();
      }
    } finally {
      flushing = false;
    }
  }

  window.addEventListener('online', () => { flush(); if (joined && !stream) connect(); });

  // ---- the live stream ---------------------------------------------------

  function setStatus(s) {
    if (status === s) return;
    status = s;
    emit();
  }

  function saveCache() {
    if (joined) writeJSON(CACHE_KEY, { id: joined.id, server });
  }

  function connect() {
    disconnect();
    if (!joined) { setStatus('local'); return; }
    setStatus(navigator.onLine === false ? 'offline' : 'connecting');
    const es = new EventSource(`${DB_URL}/evenings/${joined.id}.json`);
    stream = es;
    es.addEventListener('put', (e) => {
      const msg = JSON.parse(e.data);
      server = msg.path === '/' ? msg.data : setAt(server, split(msg.path), msg.data);
      gotServer = true;
      saveCache();
      if (status !== 'error') setStatus('live');
      emit();
    });
    es.addEventListener('patch', (e) => {
      const msg = JSON.parse(e.data);
      Object.keys(msg.data || {}).forEach(k => {
        server = setAt(server, split(msg.path).concat(split(k)), msg.data[k]);
      });
      saveCache();
      emit();
    });
    es.addEventListener('cancel', () => {
      problem = 'Databáze večer nepustila. Jsou ve Firebase vložená pravidla?';
      setStatus('error');
      disconnect();
    });
    es.onopen = () => { flush(); };
    es.onerror = () => { if (status !== 'error') setStatus(navigator.onLine === false ? 'offline' : 'connecting'); };
  }

  function disconnect() {
    if (stream) stream.close();
    stream = null;
  }

  function announce() {
    // Who's here, for the "ve večeru" line.
    send('PUT', `evenings/${joined.id}/members/${ME}`, { n: api.name(), t: { '.sv': 'timestamp' } });
  }

  // ---- public API --------------------------------------------------------

  const api = {
    get shared() { return !!joined; },
    get id() { return joined ? joined.id : ''; },
    get status() { return status; },
    get problem() { return problem; },
    get role() { return role(); },
    get lastId() { const l = readJSON(LAST_KEY, null); return l && ID_RE.test(l.id || '') ? l.id : ''; },
    get pendingCount() { return joined ? pending.filter(op => op.id === joined.id).length : 0; },

    // The last write the rules turned down, once: the UI says it and forgets.
    takeRefusal() { const r = refusal; refusal = ''; return r; },

    // The evening exists when the database (or our own unsent creation) has
    // its meta; a link to one that doesn't is an old or mistyped link.
    get missing() {
      if (!joined || !gotServer) return false;
      return !meta();
    },

    members() {
      const t = view();
      const map = Object.assign({}, (t && t.members) || {});
      if (map[ME] && myUid()) { map[myUid()] = map[ME]; delete map[ME]; }
      return Object.keys(map).map(k => ({ uid: k, name: (map[k] || {}).n || '', me: isMe(k) }));
    },

    onChange(fn) { listeners.push(fn); },

    name() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } },
    setName(n) {
      try { localStorage.setItem(NAME_KEY, String(n).trim().slice(0, 30)); } catch (e) { /* not kept */ }
      if (joined) announce();
    },

    items() {
      if (!joined) return SL.setlist.list().map((s, i) => ({ key: s, s, o: i, mine: true }));
      return items().map(it => Object.assign(it, { mine: isMe(it.u) }));
    },
    list() { return api.items().map(it => it.s); },
    has(slug) { return api.list().indexOf(slug) !== -1; },

    can(action, item) {
      const r = role();
      if (r === 'local' || r === 'owner') return true;
      if (action === 'clear') return false;
      if (action === 'remove') return r === 'parta' || !!(item && item.mine);
      if (action === 'move' || action === 'shuffle') return r === 'parta';
      if (action === 'invite-parta') return r === 'parta' && !!joined.k;
      return true;
    },

    add(slug) {
      if (!joined) { if (!SL.setlist.has(slug)) SL.setlist.toggle(slug); emit(); return; }
      if (api.has(slug)) return;
      const list = items();
      if (list.length >= MAX_ITEMS) return;
      const last = list.length ? list[list.length - 1].o : 0;
      const item = { s: slug, o: Math.max(Date.now(), last + 1), t: { '.sv': 'timestamp' }, u: ME };
      const by = api.name();
      if (by) item.by = by;
      send('PUT', `evenings/${joined.id}/items/${itemKey()}`, item);
    },

    remove(slug) {
      if (!joined) { if (SL.setlist.has(slug)) SL.setlist.toggle(slug); emit(); return true; }
      const mine = api.items().filter(it => it.s === slug && api.can('remove', it));
      mine.forEach(it => send('DELETE', `evenings/${joined.id}/items/${it.key}`));
      return mine.length > 0;
    },

    toggle(slug) {
      if (!api.has(slug)) { api.add(slug); return true; }
      api.remove(slug);
      return false;
    },

    moveUp(slug) {
      if (!joined) {
        const list = SL.setlist.list();
        const i = list.indexOf(slug);
        if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); SL.setlist.save(list); emit(); }
        return;
      }
      if (!api.can('move')) return;
      const list = items();
      const i = list.findIndex(it => it.s === slug);
      if (i < 1) return;
      // Between the two above it, so nobody else's order has to change.
      const above = list[i - 1].o;
      const twoUp = list[i - 2] ? list[i - 2].o : null;
      const o = twoUp == null ? above - 1000 : (above + twoUp) / 2;
      send('PATCH', `evenings/${joined.id}/items`, { [list[i].key + '/o']: o });
    },

    shuffle() {
      const list = api.items();
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = list[i]; list[i] = list[j]; list[j] = t;
      }
      if (!joined) { SL.setlist.save(list.map(it => it.s)); emit(); return; }
      if (!api.can('shuffle')) return;
      const body = {};
      const base = Date.now();
      list.forEach((it, i) => { body[it.key + '/o'] = base + i; });
      send('PATCH', `evenings/${joined.id}/items`, body);
    },

    // Puts songs back after an undo. Shared, they go back on at the end.
    restore(slugs) {
      if (!joined) { SL.setlist.save(slugs); emit(); return; }
      slugs.forEach(s => api.add(s));
    },

    clear() {
      if (!joined) { SL.setlist.save([]); emit(); return; }
      if (!api.can('clear')) return;
      send('DELETE', `evenings/${joined.id}/items`);
    },

    // Start a shared evening from whatever is on the local list. Works
    // offline too: it just goes up when the signal does.
    create() {
      const local = SL.setlist.list();
      const id = randomId(16);
      joined = { id, k: randomId(20), friend: true };
      server = null;
      gotServer = false;
      problem = '';
      saveJoined();
      writeJSON(LAST_KEY, { id, k: joined.k });
      send('PUT', `evenings/${id}/meta`, { created: { '.sv': 'timestamp' }, owner: ME });
      send('PUT', `secrets/${id}`, joined.k);
      announce();
      local.forEach(s => api.add(s));
      SL.setlist.save([]);
      connect();
      return id;
    },

    // An invite: the evening's id, and with "parta" rights its key too.
    join(id, key) {
      if (!ID_RE.test(id || '')) return false;
      const k = KEY_RE.test(key || '') ? key : '';
      if (joined && joined.id === id) {
        if (k && !joined.friend && role() !== 'owner') {
          joined.k = k;
          saveJoined();
          send('PUT', `grants/${id}/${ME}`, k, 'grant');
        }
        return true;
      }
      joined = { id, k, friend: false };
      const c = readJSON(CACHE_KEY, null);
      server = c && c.id === id ? c.server : null;
      gotServer = false;
      problem = '';
      saveJoined();
      writeJSON(LAST_KEY, { id, k });
      if (k) send('PUT', `grants/${id}/${ME}`, k, 'grant');
      announce();
      connect();
      return true;
    },

    rejoin() {
      const l = readJSON(LAST_KEY, null);
      return l ? api.join(l.id, l.k) : false;
    },

    leave() {
      disconnect();
      if (joined) writeJSON(LAST_KEY, { id: joined.id, k: joined.k || '' });
      joined = null;
      server = null;
      gotServer = false;
      problem = '';
      saveJoined();
      setStatus('local');
      emit();
    },

    // "parta": anyone opening it may remove and move songs; "host": add and
    // remove their own only.
    inviteUrl(kind, page) {
      const url = new URL(page || location.pathname, location.origin);
      url.search = '';
      url.hash = '';
      url.searchParams.set('parta', joined ? joined.id : '');
      if (kind === 'parta' && joined && joined.k) url.searchParams.set('k', joined.k);
      return url.toString();
    },
  };

  window.Evening = api;

  // Reconnect when the page comes back from the background or the
  // back-forward cache: phones drop the stream while the screen is off.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && joined && (!stream || stream.readyState === 2)) connect();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && joined) connect(); });

  if (joined) SL.load().then(() => { connect(); emit(); });
})();
