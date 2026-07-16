/**
 * offline-download.js - drives the "Stáhnout offline" button in the footer.
 * The service worker already precaches everything silently on first visit;
 * this button just makes that visible (progress + a done/failed count) so
 * you can confirm it's safe to go offline instead of hoping it worked.
 */
(function () {
  const btn = document.getElementById('offline-download-btn');
  if (!btn || !('serviceWorker' in navigator)) return;

  const footer = document.getElementById('offline-footer');
  const statusEl = document.getElementById('offline-status');
  if (footer) footer.hidden = false;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;
    if (data.type === 'PRECACHE_PROGRESS') {
      setStatus(`Stahuji písně... ${data.done} / ${data.total}`);
    } else if (data.type === 'PRECACHE_DONE') {
      btn.disabled = false;
      if (data.total === 0) {
        setStatus('Nepodařilo se načíst seznam písní. Zkontroluj připojení a zkus to znovu.');
      } else if (data.failed > 0) {
        setStatus(`Staženo ${data.total - data.failed} z ${data.total} písní, ${data.failed} se nestáhlo - zkus to ještě jednou.`);
      } else {
        const now = new Date();
        const time = now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
        setStatus(`Hotovo - všech ${data.total} písní je stažených pro offline použití (${time}).`);
      }
    }
  });

  // If register() just found a newer sw.js than the one currently active,
  // that new worker starts out installing/waiting - not yet the one in
  // `reg.active`. Posting to `reg.active` in that window hits the outgoing
  // worker, which silently drops unknown messages (no PRECACHE_* handler on
  // old versions), so the button hangs on "Připravuji stahování...". Wait
  // for the incoming worker to finish activating first.
  function waitForActivation(worker) {
    return new Promise((resolve) => {
      if (worker.state === 'activated') { resolve(); return; }
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') resolve();
      });
    });
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    setStatus('Připravuji stahování...');
    try {
      const reg = await navigator.serviceWorker.register(btn.dataset.swPath);
      const incoming = reg.installing || reg.waiting;
      if (incoming) await waitForActivation(incoming);
      if (!reg.active) throw new Error('no active service worker');
      reg.active.postMessage({ type: 'PRECACHE_ALL' });
    } catch (e) {
      btn.disabled = false;
      setStatus('Stahování se nepovedlo spustit. Zkus obnovit stránku a zkusit to znovu.');
    }
  });
})();
