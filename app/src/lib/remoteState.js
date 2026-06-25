// remoteState.js
// League-wide shared state stored in Cloudflare R2 via the worker-api.
// This covers data that ALL users in the league need to see consistently:
//   - Trade offers (sent, pending, accepted, rejected)
//   - Waiver claims (dropped players on waivers) and waiver order
//
// NO localStorage — all state lives in memory, loaded from R2 on login.
//
// Usage:
//   import { loadRemoteState, getTradeOffers, getWaivers,
//            saveTradeOffers, saveWaivers } from './remoteState.js';
//
//   // On login:
//   await loadRemoteState();
//
//   // Read (synchronous after load):
//   const { offers } = getTradeOffers();
//   const { claims, order } = getWaivers();
//
//   // Write (immediately POSTs to R2):
//   await saveTradeOffers(updatedOffers);
//   await saveWaivers(updatedClaims, updatedOrder);

const API_BASE     = 'https://api.fantasai.net';
const FANTASAI_KEY = import.meta.env.VITE_FANTASAI_KEY || 'fantasai2026';

function apiHeaders() {
  return FANTASAI_KEY ? { 'X-FantasAI-Key': FANTASAI_KEY } : {};
}

let _tradeOffers = [];
let _waiverClaims = {};   // { [playerId]: { droppedAt, expiresAt, teamId } }
let _waiverOrder  = [];   // [teamId, teamId, ...]

const _tradeListeners  = new Set();
const _waiverListeners = new Set();

// ── Bootstrap: load both on login ─────────────────────────────────────────────

export async function loadRemoteState() {
  await Promise.allSettled([_fetchTradeOffers(), _fetchWaivers()]);
}

// ── Trade offers ──────────────────────────────────────────────────────────────

export function getTradeOffers() {
  return [..._tradeOffers];
}

export function subscribeTradeOffers(fn) {
  _tradeListeners.add(fn);
  return () => _tradeListeners.delete(fn);
}

export async function saveTradeOffers(offers) {
  _tradeOffers = Array.isArray(offers) ? offers : [];
  _notifyTrades();
  try {
    await fetch(`${API_BASE}/api/v1/trade-offers`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...apiHeaders() },
      body:    JSON.stringify({ offers: _tradeOffers }),
      signal:  AbortSignal.timeout(8000),
    });
  } catch (_) {}
}

// ── Waiver state ───────────────────────────────────────────────────────────────

export function getWaivers() {
  return { claims: { ..._waiverClaims }, order: [..._waiverOrder] };
}

export function subscribeWaivers(fn) {
  _waiverListeners.add(fn);
  return () => _waiverListeners.delete(fn);
}

export async function saveWaivers(claims, order) {
  if (claims !== undefined) _waiverClaims = { ...claims };
  if (order  !== undefined) _waiverOrder  = [...order];
  _notifyWaivers();
  try {
    await fetch(`${API_BASE}/api/v1/waivers`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...apiHeaders() },
      body:    JSON.stringify({ claims: _waiverClaims, order: _waiverOrder }),
      signal:  AbortSignal.timeout(8000),
    });
  } catch (_) {}
}

// Clear on logout
export function clearRemoteState() {
  _tradeOffers  = [];
  _waiverClaims = {};
  _waiverOrder  = [];
  _notifyTrades();
  _notifyWaivers();
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function _fetchTradeOffers() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/trade-offers`, {
      headers: apiHeaders(),
      signal:  AbortSignal.timeout(6000),
    });
    if (!res.ok) return;
    const data = await res.json();
    _tradeOffers = Array.isArray(data.offers) ? data.offers : [];
    _notifyTrades();
  } catch (_) {}
}

async function _fetchWaivers() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/waivers`, {
      headers: apiHeaders(),
      signal:  AbortSignal.timeout(6000),
    });
    if (!res.ok) return;
    const data = await res.json();
    // Prune expired waiver entries on load
    const now = Date.now();
    const raw = data.claims || {};
    _waiverClaims = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => new Date(v.expiresAt).getTime() > now)
    );
    _waiverOrder = Array.isArray(data.order) ? data.order : [];
    _notifyWaivers();
  } catch (_) {}
}

function _notifyTrades()  { _tradeListeners.forEach(fn  => fn(_tradeOffers)); }
function _notifyWaivers() { _waiverListeners.forEach(fn => fn({ claims: _waiverClaims, order: _waiverOrder })); }
