import { useState, useEffect } from 'react';
import { PLAYERS as STATIC_PLAYERS } from './data.js';

// Module-level mutable store — seeds with static data so app renders instantly.
// App.jsx replaces this with live Databricks/Sleeper data on startup.
let _players = STATIC_PLAYERS;
let _isLive  = false;
const _listeners = new Set();

/** Return the current player list (live when loaded, static until then). */
export function getPlayers() { return _players; }

/** True once live data has replaced the static seed. */
export function isLiveData() { return _isLive; }

/** Look up a player by numeric ID in the live store. */
export function findPlayer(id) {
  return _players.find(p => p.id === id);
}

/** Look up a player by name (case-insensitive) in the live store. */
export function findPlayerByName(name) {
  if (!name) return null;
  const norm = name.toLowerCase().trim();
  return _players.find(p => p.name?.toLowerCase().trim() === norm);
}

/**
 * Replace the player list with live data and notify all subscribers.
 * Called from App.jsx after fetching Databricks / Sleeper data.
 */
export function setPlayers(list) {
  _players = list;
  _isLive  = true;
  _listeners.forEach(fn => fn(list));
}

/**
 * React hook — returns the current player list and re-renders when live
 * data replaces the static seed.
 */
export function usePlayers() {
  const [list, setList] = useState(_players);
  useEffect(() => {
    setList(_players); // sync if store updated before mount
    _listeners.add(setList);
    return () => { _listeners.delete(setList); };
  }, []);
  return list;
}

/**
 * Normalize a raw player array (from Databricks or Sleeper) into the
 * shape expected by all app components.
 *
 * Strategy:
 *   - Keep the static numeric ID when a player name matches — the roster /
 *     waiver / trade systems rely on these stable IDs.
 *   - Unmatched live players get `Number(sleeper_player_id)` as their ID so
 *     they remain identifiable without colliding with static IDs (which top
 *     out at ~172).
 */
export function normalizePlayerList(rawArr) {
  const staticByName = new Map(
    STATIC_PLAYERS.map(p => [p.name.toLowerCase().trim(), p])
  );

  function injStatusCode(s) {
    if (!s || s === 'Na' || s === 'Active') return 'OK';
    if (s === 'Questionable')               return 'Q';
    if (s === 'Doubtful')                   return 'D';
    if (s === 'Out')                        return 'Out';
    if (s === 'Injured_Reserve' || s === 'IR') return 'IR';
    return s;
  }

  const seen   = new Set();
  const result = [];

  for (const p of rawArr) {
    const rawPos  = p.position;
    const rawTeam = p.team;
    if (!rawTeam || rawTeam === 'FA') continue;
    const pos = rawPos === 'DEF' ? 'DST' : (rawPos || '');
    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(pos)) continue;

    let name;
    if (pos === 'DST') {
      name = `${rawTeam.toUpperCase()} D/ST`;
    } else {
      name = (p.full_name || p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).trim();
      if (!name) continue;
    }

    const key = name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);

    const st         = staticByName.get(key);
    // Preserve static numeric ID for matched players so roster refs keep working.
    // Unmatched players get a large numeric ID from their Sleeper player_id.
    const sleeperId  = p.player_id || p.id || null;
    const id         = st ? st.id : (Number(sleeperId) || 10000 + result.length);

    const searchRank = Number(p.search_rank || p.ecr) || null;
    const ecr        = searchRank || st?.ecr || 999;
    const adp        = st?.adp || searchRank || 999;
    const owned      = st?.owned ?? (searchRank
      ? Math.max(0, parseFloat((100 - searchRank * 0.28).toFixed(1)))
      : 0);

    result.push({
      id,
      sleeperId,
      name,
      pos,
      team:        rawTeam,
      num:         Number(p.number)  || st?.num         || 0,
      age:         Number(p.age)     || st?.age          || 0,
      bye:         st?.bye           ?? 0,
      opp:         st?.opp           ?? '',
      oppRank:     st?.oppRank       ?? 0,
      proj:        st?.proj          ?? 0,
      last:        st?.last          ?? 0,
      avg:         st?.avg           ?? 0,
      trend:       st?.trend         ?? [0,0,0,0,0,0],
      depth:       st?.depth         ?? 1,
      targetShare: st?.targetShare   ?? 0,
      routes:      st?.routes        ?? 0,
      owned,
      adp,
      ecr,
      tier:        st?.tier ?? 0,
      news:        st?.news ?? '',
      status:      injStatusCode(p.injury_status),
    });
  }
  return result;
}
