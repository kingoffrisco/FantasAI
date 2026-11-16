// One shared loader for league rosters + CBS lineups, used by every matchup
// view (Dashboard scoreboard, sidebar H2H card, Head-to-Head screen).
//
// Why this exists (2026-11-16): only the Head-to-Head screen ever ran
// refreshTeamRostersFromServer() + syncLineupsFromCbs(). Server rosters land
// with every player tagged BENCH, so the Dashboard — reading TEAM_ROSTERS
// directly — saw the opponent with "0 starters" and a wrong score until the
// user happened to open H2H (which assigned real slots), then went back.
//
// TEAM_ROSTERS is a plain mutable object, so screens can't observe changes;
// this fires a 'fantasai:rosters-updated' window event after each load.

import React from 'react';
import { TEAM_ROSTERS, refreshTeamRostersFromServer, syncLineupsFromCbs, CBS_LINEUP_SYNCED, assignRoster } from './data.js';
import { findPlayer, findPlayerByName } from './playerStore.js';
import { fetchLiveWeek } from './liveScoring.js';

const TTL_MS = 5 * 60 * 1000;
let _inflight = null;
let _loadedAt = 0;

export const ROSTERS_UPDATED_EVENT = 'fantasai:rosters-updated';

function notify() {
  try { window.dispatchEvent(new CustomEvent(ROSTERS_UPDATED_EVENT)); } catch {}
}

/** Current rosters from R2, then CBS's real starters on top. Cached ~5 min. */
export function loadLeagueRosters({ force = false } = {}) {
  if (_inflight) return _inflight;
  if (!force && _loadedAt && Date.now() - _loadedAt < TTL_MS) return Promise.resolve();
  _inflight = (async () => {
    try {
      await refreshTeamRostersFromServer();
      CBS_LINEUP_SYNCED.clear();
      notify();
      try { await syncLineupsFromCbs(findPlayerByName, findPlayer); } catch { /* CBS unreachable — keep server rosters */ }
      _loadedAt = Date.now();
      notify();
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** React hook: a counter that bumps whenever league rosters change. */
export function useRostersVersion() {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setV(x => x + 1);
    window.addEventListener(ROSTERS_UPDATED_EVENT, bump);
    loadLeagueRosters();
    return () => window.removeEventListener(ROSTERS_UPDATED_EVENT, bump);
  }, []);
  return v;
}

/**
 * React hook: this week's live stats from R2 (same source and shapes as the
 * Head-to-Head screen), re-polled every 60s while any game is in progress and
 * again when the tab becomes visible. Returns null until the first load.
 */
export function useLiveWeek(week) {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    if (!week) return undefined;
    let cancelled = false, timer = null;
    const load = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      fetchLiveWeek(week).then(d => {
        if (cancelled) return;
        setData(d);
        if (d.anyLive && !document.hidden) timer = setTimeout(load, 60000);
      }).catch(() => {});
    };
    const onVis = () => { if (!document.hidden) load(); };
    load();
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [week]);
  return data;
}

/** Slot-assigned roster for any team, honouring a synced CBS lineup order. */
export function buildTeamRoster(teamId, frame) {
  const ids = (TEAM_ROSTERS[teamId] || []).map(e => e.playerId).filter(Boolean);
  return ids.length ? assignRoster(frame, ids, {}, findPlayer) : [];
}

/**
 * The user's own matchup roster: CBS's real lineup when it's been synced and
 * covers exactly the saved roster's players; otherwise the in-app slot
 * assignment (saved roster + the user's slot overrides).
 */
export function buildMyMatchupRoster(teamId, myRosterIds, slotOverrides, frame) {
  const mine = myRosterIds instanceof Set ? myRosterIds : new Set(myRosterIds || []);
  const cbs = CBS_LINEUP_SYNCED.has(teamId) ? (TEAM_ROSTERS[teamId] || []).map(e => e.playerId).filter(Boolean) : [];
  if (cbs.length && cbs.length === mine.size && cbs.every(id => mine.has(id))) {
    return assignRoster(frame, cbs, {}, findPlayer);
  }
  return assignRoster(frame, [...mine], slotOverrides || {}, findPlayer);
}
