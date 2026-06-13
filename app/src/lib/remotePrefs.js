// remotePrefs.js
// Per-user preferences stored in Cloudflare R2 via the worker-api.
// NO localStorage — all state lives in memory and is loaded from R2 on login.
//
// Usage:
//   import { loadUserPrefs, patchPrefs, getPrefs, subscribePrefs, clearPrefs } from './remotePrefs.js';
//
//   // On login:
//   const prefs = await loadUserPrefs(teamId);
//
//   // Read anywhere (synchronous after load):
//   const { watchlist, theme } = getPrefs();
//
//   // Write (debounced R2 save happens automatically):
//   patchPrefs({ watchlist: [...newList] });
//
//   // React components that need reactivity:
//   const prefs = usePrefs();
//
//   // On logout:
//   clearPrefs();

import React from 'react';

const API_BASE     = 'https://api.fantasai.net';
const FANTASAI_KEY = import.meta.env.VITE_FANTASAI_KEY ?? '';

function apiHeaders() {
  return FANTASAI_KEY ? { 'X-FantasAI-Key': FANTASAI_KEY } : {};
}

export const PREFS_DEFAULTS = {
  watchlist:         [],      // player IDs on watchlist
  slotOverrides:     {},      // roster slot overrides { slotKey: playerId }
  customRankings:    [],      // user's custom player ranking overrides
  scoringWeights:    null,    // custom scoring weight config
  scoringRules:      null,    // scoring test rules
  columns:           null,    // player table column visibility
  theme:             'sportsbook-dark',
  lightMode:         false,
  sleeperUsername:   '',
  sleeperLeagueId:   '',
  sleeperAdpWeight:  70,
  sleeperAutoSync:   false,
  sources:           null,    // news source toggle state
  limitedApis:       {},      // which limited APIs are enabled
  personalRankings:  [],      // CBSConnectModal personal ADP rankings
  savedRankings:     [],      // CBSConnectModal saved ranking lists
  draftOwnerRanks:   {},      // DraftRoom per-owner rank overrides
};

let _prefs    = { ...PREFS_DEFAULTS };
let _teamId   = null;
let _timer    = null;
let _loaded   = false;
const _listeners = new Set();

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadUserPrefs(teamId) {
  _teamId = String(teamId);
  _loaded = false;
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/user-prefs?teamId=${encodeURIComponent(_teamId)}`,
      { headers: apiHeaders(), signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const data = await res.json();
      _prefs = { ...PREFS_DEFAULTS, ...(data.prefs || {}) };
    }
  } catch (_) {
    _prefs = { ...PREFS_DEFAULTS };
  }
  _loaded = true;
  _notify();
  return { ..._prefs };
}

export function getPrefs() {
  return _prefs;
}

export function isPrefsLoaded() {
  return _loaded;
}

// Merge patch into current prefs and schedule a debounced R2 save.
export function patchPrefs(patch) {
  _prefs = { ..._prefs, ...patch };
  _notify();
  _scheduleSave();
}

// Remove the user's prefs from memory (call on logout).
export function clearPrefs() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _teamId = null;
  _prefs  = { ...PREFS_DEFAULTS };
  _loaded = false;
  _notify();
}

// Subscribe to pref changes. Returns an unsubscribe function.
export function subscribePrefs(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// React hook — re-renders whenever prefs change.
export function usePrefs() {
  const [prefs, setPrefs] = React.useState(() => ({ ..._prefs }));
  React.useEffect(() => subscribePrefs(p => setPrefs({ ...p })), []);
  return prefs;
}

// Force an immediate save (e.g. before page unload).
export async function flushPrefs() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  return _saveToR2();
}

// ── Internals ─────────────────────────────────────────────────────────────────

function _notify() {
  _listeners.forEach(fn => fn(_prefs));
}

function _scheduleSave() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(_saveToR2, 800);
}

async function _saveToR2() {
  _timer = null;
  if (!_teamId) return;
  try {
    await fetch(`${API_BASE}/api/v1/user-prefs`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...apiHeaders() },
      body:    JSON.stringify({ teamId: _teamId, prefs: _prefs }),
      signal:  AbortSignal.timeout(8000),
    });
  } catch (_) {}
}
