// Two levels of "forget stale stuff this site has stored in your browser" —
// for the recurring class of bug this session where a browser tab, once
// open, has no way to notice a new deploy and keeps running old code
// indefinitely (see App.jsx's version-check banner). A normal reload only
// re-fetches the page; it doesn't unregister a stuck service worker or
// clear the Cache Storage API a stale one may have written to.

async function clearServiceWorkersAndCaches() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch {}
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {}
}

// Lightweight: clears stuck service worker/cache and force-reloads fresh
// code, but leaves localStorage (and the logged-in session) alone. This is
// what the version-check banner uses — it fires on every routine deploy, so
// it should never surprise someone with a forced logout.
export async function reloadFreshCode() {
  await clearServiceWorkersAndCaches();
  window.location.href = window.location.origin + window.location.pathname + '?_cc=' + Date.now();
}

// Full wipe: also clears localStorage/sessionStorage, which is where this
// session's actual data-corruption bugs traced back to (a browser's own
// stale fantasai_live_picks/mock-draft cache getting synced back to the
// server). This logs the user out, so it's reserved for the deliberate
// "Clear Site Data" troubleshooting button, never fired automatically.
export async function clearSiteDataAndReload() {
  await clearServiceWorkersAndCaches();
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
  window.location.href = window.location.origin + window.location.pathname + '?_cc=' + Date.now();
}
