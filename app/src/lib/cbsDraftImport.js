import { LEAGUE_TEAMS } from './data.js';

const API_BASE = 'https://api.fantasai.net';

// Fetch a completed real draft for a given season directly from CBS Sports.
// Requires a connected CBS session cookie (Sources -> CBS Connect). Throws on
// any failure (network, auth, no data) — callers should catch and surface it.
export async function fetchCbsLeagueDraft(year) {
  const cookie = (() => { try { return localStorage.getItem('fantasai_cbs_cookie') || ''; } catch { return ''; } })();
  const key = import.meta.env.VITE_FANTASAI_KEY || 'fantasai2026';
  const res = await fetch(`${API_BASE}/api/v1/draft?year=${year}`, {
    headers: { 'X-CBS-Cookie': cookie, 'X-FantasAI-Key': key },
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  if (!Array.isArray(data.picks) || data.picks.length === 0) throw new Error(`No picks found on CBS for ${year}.`);
  return data; // { source, fetchedAt, year, picks, teams }
}

function matchPlayer(pick, storePlayerList) {
  if (!storePlayerList?.length) return null;
  if (pick.pos === 'DST') {
    return storePlayerList.find(p => p.pos === 'DST' && p.team === pick.nflTeam) || null;
  }
  const norm = (pick.player || '').toLowerCase().trim();
  const exact = storePlayerList.filter(p => p.name?.toLowerCase().trim() === norm);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 && pick.pos) {
    const byPos = exact.find(p => p.pos === pick.pos);
    if (byPos) return byPos;
  }
  return exact[0] || null;
}

// Resolve each CBS pick's team (via its stable cbsId, not name — names can be
// renamed between seasons) against our own LEAGUE_TEAMS, and each pick's
// player against the live player store. Team assignment per pick comes
// entirely from CBS's own data, never from this app's own snake-order
// template, which doesn't match CBS's real, separately-determined draft order.
export function matchCbsDraft(data, storePlayerList) {
  const idByName = {};
  Object.entries(data.teams || {}).forEach(([id, name]) => { idByName[name] = id; });

  return data.picks.map(pk => {
    const cbsTeamId = idByName[pk.team];
    const team = cbsTeamId ? LEAGUE_TEAMS.find(t => t.cbsId === cbsTeamId) : null;
    const player = matchPlayer(pk, storePlayerList);
    return { ...pk, matchedTeam: team, matchedPlayer: player };
  });
}

export function hasCbsCookie() {
  try { return !!localStorage.getItem('fantasai_cbs_cookie'); } catch { return false; }
}
