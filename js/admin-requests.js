/**
 * admin-requests.js - songs visitors asked for from an empty search
 * (js/app.js, sent by Evening.request in js/vecer.js), listed in /admin.
 *
 * They live in the Firebase Realtime Database under /requests/<uid>/<key>,
 * which only the songbook's owner may read or delete
 * (firebase/database.rules.json). The Google sign-in that opens the editor
 * (js/editor.js, event "admin-signed-in") is traded here for a Firebase
 * session, so Firebase's Google sign-in provider has to be on and accept the
 * editor's OAuth client.
 *
 * The same wish asked twice is one row with a count; a wish the songbook
 * already has (even as a draft) says so. "Založit návrh" opens the editor's
 * new-song dialog filled in; "Vyřízeno" deletes the wish.
 */
(function () {
  'use strict';

  // The same project as js/vecer.js.
  const DB_URL = 'https://bekovysongy-default-rtdb.europe-west1.firebasedatabase.app';
  const API_KEY = 'AIzaSyBJHSLjwjiLwKbu5DUBFTW_Zq4_ycYBztY';
  const IDP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=' + API_KEY;
  const REFRESH_URL = 'https://securetoken.googleapis.com/v1/token?key=' + API_KEY;

  const STATUS_LABEL = { navrh: 'jako návrh', 'k-vytvoreni': 'k vytvoření', 'ke-kontrole': 'ke kontrole' };

  const btn = document.getElementById('btn-requests');
  const count = document.getElementById('requests-count');
  const dialog = document.getElementById('requests-dialog');
  const list = document.getElementById('requests-list');
  const note = document.getElementById('requests-note');

  let google = '';        // the Google ID token from the editor's sign-in
  let session = null;     // { token, refresh, exp } - Firebase
  let groups = [];
  let failed = false;     // the last load didn't get through - "no wishes" would be a lie
  let songs = null;       // songs.json, to tell wishes the songbook already has

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  async function token() {
    if (session && session.exp > Date.now() + 60000) return session.token;
    let res;
    if (session && session.refresh) {
      res = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refresh),
      });
      if (res.ok) {
        const d = await res.json();
        session = { token: d.id_token, refresh: d.refresh_token, exp: Date.now() + Number(d.expires_in) * 1000 };
        return session.token;
      }
    }
    if (!google) throw new Error('Přání se načtou po přihlášení Googlem na bekovysongy.cz (na localhostu přihlášení chybí).');
    res = await fetch(IDP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: 'id_token=' + encodeURIComponent(google) + '&providerId=google.com',
        requestUri: location.origin,
        returnSecureToken: true,
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      const code = (d && d.error && d.error.message) || String(res.status);
      throw new Error(code.indexOf('OPERATION_NOT_ALLOWED') === 0 || code.indexOf('INVALID_IDP_RESPONSE') === 0
        ? `Firebase nepustil přihlášení Googlem (${code}). Ve Firebase konzoli zapni Authentication → Sign-in method → Google a do „Safelist client IDs“ přidej Client ID editoru.`
        : 'Přihlášení k Firebase se nepovedlo (' + code + ').');
    }
    session = { token: d.idToken, refresh: d.refreshToken, exp: Date.now() + Number(d.expiresIn) * 1000 };
    return session.token;
  }

  async function db(method, path) {
    const t = await token();
    const res = await fetch(`${DB_URL}/${path}.json?auth=${encodeURIComponent(t)}`, { method });
    if (res.status === 401) throw new Error('Databáze přání nepustila. Jsou ve Firebase vložená pravidla z firebase/database.rules.json?');
    if (!res.ok) throw new Error('Databáze odpověděla ' + res.status + '.');
    return res.json();
  }

  function findSong(g) {
    if (!songs) return null;
    const t = norm(g.title);
    return songs.find(s => norm(s.title) === t) || null;
  }

  function group(data) {
    const byKey = new Map();
    Object.keys(data || {}).forEach(uid => {
      Object.keys(data[uid] || {}).forEach(key => {
        const r = data[uid][key] || {};
        if (typeof r.title !== 'string') return;
        const id = norm(r.title) + '|' + norm(r.artist);
        if (!byKey.has(id)) byKey.set(id, { title: r.title.trim(), artist: (r.artist || '').trim(), t: 0, refs: [], queries: new Set() });
        const g = byKey.get(id);
        g.refs.push(`requests/${uid}/${key}`);
        if (r.q && norm(r.q) !== norm(r.title)) g.queries.add(r.q);
        if ((r.t || 0) > g.t) g.t = r.t || 0;
      });
    });
    // The most wanted first, then the freshest.
    return Array.from(byKey.values()).sort((a, b) => (b.refs.length - a.refs.length) || (b.t - a.t));
  }

  function paintCount() {
    const n = groups.filter(g => !findSong(g)).length;
    count.textContent = n ? `(${n})` : '';
  }

  function render() {
    list.innerHTML = '';
    if (!groups.length) {
      if (!failed) list.appendChild(el('li', 'requests-empty', 'Zatím žádná přání.'));
      return;
    }
    groups.forEach(g => {
      const li = el('li', 'request-row');
      const text = el('div', 'request-text');
      const head = el('div', 'request-title', g.title);
      if (g.refs.length > 1) head.appendChild(el('span', 'request-count', `${g.refs.length}×`));
      text.appendChild(head);
      const meta = [];
      if (g.artist) meta.push(g.artist);
      if (g.t) meta.push(new Date(g.t).toLocaleDateString('cs-CZ'));
      if (meta.length) text.appendChild(el('div', 'request-meta', meta.join(' · ')));
      if (g.queries.size) text.appendChild(el('div', 'request-meta', 'Hledal(a): ' + Array.from(g.queries).join(', ')));
      const have = findSong(g);
      if (have) {
        const label = STATUS_LABEL[have.status];
        text.appendChild(el('div', 'request-have', label ? `Ve zpěvníku ${label}: ${have.title}` : `Už je ve zpěvníku: ${have.title}`));
      }
      li.appendChild(text);

      const actions = el('div', 'request-actions');
      if (!have) {
        const make = el('button', 'btn-sm', 'Založit návrh');
        make.type = 'button';
        make.addEventListener('click', () => propose(g));
        actions.appendChild(make);
      }
      const done = el('button', 'btn-sm', 'Vyřízeno');
      done.type = 'button';
      done.title = 'Smazat ' + (g.refs.length > 1 ? `všech ${g.refs.length} přání` : 'přání');
      done.addEventListener('click', () => remove(g, done));
      actions.appendChild(done);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  async function load() {
    note.textContent = 'Načítám přání…';
    try {
      if (!songs) songs = await fetch('../songs.json').then(r => r.json()).then(d => d.songs).catch(() => null);
      groups = group(await db('GET', 'requests'));
      failed = false;
      note.textContent = groups.length ? 'Seřazeno od nejžádanějších. Stejné přání od víc lidí je jeden řádek.' : '';
    } catch (e) {
      groups = [];
      failed = true;
      note.textContent = e.message;
    }
    paintCount();
    render();
  }

  async function remove(g, button) {
    button.disabled = true;
    try {
      await Promise.all(g.refs.map(ref => db('DELETE', ref)));
      groups = groups.filter(x => x !== g);
      paintCount();
      render();
    } catch (e) {
      button.disabled = false;
      note.textContent = e.message;
    }
  }

  // The editor's own new-song dialog, filled in as a draft.
  function propose(g) {
    dialog.close();
    document.getElementById('btn-new-song').click();
    const title = document.getElementById('new-title');
    title.value = g.title;
    document.getElementById('new-author').value = g.artist;
    document.getElementById('new-status').value = 'navrh';
    title.dispatchEvent(new Event('input'));
  }

  document.addEventListener('admin-signed-in', (e) => {
    google = (e.detail && e.detail.credential) || '';
    btn.hidden = false;
    load();
  });
  btn.addEventListener('click', () => { render(); dialog.showModal(); load(); });
  document.getElementById('btn-requests-close').addEventListener('click', () => dialog.close());
})();
