import { useState, useEffect } from 'react';
import { PLAYER_ID_MAP } from './data.js';

// Official 2026 NFL bye weeks (keyed by Sleeper team abbreviation).
// Used as a static fallback when Sleeper's player map hasn't published bye_week yet.
export const BYE_WEEKS_2026 = {
  ARI: 14, ATL: 11, BAL: 13, BUF:  7, CAR:  5,
  CHI: 10, CIN:  6, CLE: 11, DAL: 14, DEN: 10,
  DET:  6, GB:  11, HOU:  8, IND: 13, JAX:  7,
  KC:   5, LV:  13, LAC:  7, LAR: 11, MIA:  6,
  MIN:  6, NE:  11, NO:   8, NYG:  8, NYJ: 13,
  PHI: 10, PIT:  9, SF:   8, SEA: 11, TB:  10,
  TEN:  9, WAS:  7,
};

// Store starts empty — populated by App.jsx from Databricks / Sleeper on startup.
// No static player data is ever seeded here.
let _players = [];
let _isLive  = false;
const _listeners = new Set();

/** Return the current player list (empty until live data loads). */
export function getPlayers() { return _players; }

/** True once live data has been loaded into the store. */
export function isLiveData() { return _isLive; }

/** Look up a player by numeric ID. */
export function findPlayer(id) {
  return _players.find(p => p.id === id);
}

/** Look up a player by name (case-insensitive). */
export function findPlayerByName(name) {
  if (!name) return null;
  const norm = name.toLowerCase().trim();
  return _players.find(p => p.name?.toLowerCase().trim() === norm);
}

/** Replace the player list with live data and notify all subscribers. */
export function setPlayers(list) {
  _players = list;
  _isLive  = true;
  _listeners.forEach(fn => fn(list));
}

/** Apply a mapping function to each player without replacing isLive state. */
export function patchPlayers(fn) {
  if (_players.length === 0) return;
  _players = _players.map(fn);
  _listeners.forEach(cb => cb(_players));
}

/** React hook — returns current player list and re-renders when live data loads. */
export function usePlayers() {
  const [list, setList] = useState(_players);
  useEffect(() => {
    setList(_players);
    _listeners.add(setList);
    return () => { _listeners.delete(setList); };
  }, []);
  return list;
}

/**
 * Normalize a raw player array (from Databricks or Sleeper) into the shape
 * expected by all app components.
 *
 * ID strategy: if the player's name matches a name in PLAYER_ID_MAP, keep the
 * stable numeric ID so existing roster / waiver / trade records still resolve.
 * Unmatched players get a numeric Sleeper ID (or 10000 + index as fallback).
 */
export function normalizePlayerList(rawArr) {
  const idByName = new Map(
    PLAYER_ID_MAP.map(p => [p.name.toLowerCase().trim(), p.id])
  );

  function injStatusCode(s) {
    if (!s || s === 'Na' || s === 'Active' || s === 'Active 2025') return 'OK';
    if (s === 'Questionable')               return 'Q';
    if (s === 'Doubtful')                   return 'D';
    if (s === 'Out')                        return 'Out';
    if (s === 'Injured_Reserve' || s === 'IR') return 'IR';
    return s;
  }

  // Map season_tier string to numeric tier (1 = elite)
  function tierFromString(s) {
    if (!s) return 0;
    const l = s.toLowerCase();
    if (l === 'elite') return 1;
    if (l === 'high')  return 2;
    if (l === 'mid')   return 3;
    if (l === 'low')   return 4;
    return 0;
  }

  const seen   = new Set();
  const result = [];

  for (const p of rawArr) {
    // Support both camelCase (new export) and snake_case (old schema)
    const isDraftable = p.isDraftable ?? p.is_draftable;
    if (isDraftable === false || isDraftable === 'false') continue;

    const rawPos  = p.position;
    const rawTeam = p.team;
    if (!rawTeam || rawTeam === 'FA') continue;
    // Map source positions to canonical set; reject anything unexpected
    let pos = rawPos === 'DEF' ? 'DST' : (rawPos || '');
    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(pos)) continue;

    let name;
    if (pos === 'DST') {
      // DST entries always get a team-based name — never a real player name
      name = `${rawTeam.toUpperCase()} D/ST`;
    } else {
      name = (p.full_name || p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).trim();
      if (!name) continue;
      // Guard: if a non-DST entry somehow has a D/ST-style name, treat it as DST
      if (/\bd\/st\b/i.test(name)) {
        pos  = 'DST';
        name = `${rawTeam.toUpperCase()} D/ST`;
      }
    }

    const key = name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);

    // camelCase (new) takes priority over snake_case (old)
    const sleeperId  = p.playerId || p.player_id || p.id || null;
    const stableId   = idByName.get(key);
    const id         = stableId ?? (Number(sleeperId) || 10000 + result.length);

    // proj: new schema has p.proj directly; old schema uses projected_avg_points
    const projRaw    = Number(p.proj) || Number(p.projected_avg_points) || 0;
    // ECR: new schema has positionRank; old has position_rank / search_rank
    const posRank    = Number(p.positionRank || p.position_rank) || null;
    const searchRank = Number(p.search_rank || p.ecr) || null;
    const ecr        = posRank ?? searchRank ?? 999;
    const adp        = Number(p.adp) || searchRank || 999;
    const owned      = Number(p.owned) || (ecr < 999
      ? Math.max(0, parseFloat((100 - ecr * 0.28).toFixed(1)))
      : 0);

    // Proj fallback: estimate from ECR when no source provides a projection.
    // Used when Databricks R2 export isn't available yet — Sleeper/Databricks news fallback.
    // ECR is positional rank when available (players_2026_draft), else overall search_rank.
    let proj = projRaw;
    if (proj === 0) {
      if (pos === 'DST') {
        // Always synthesize a DST proj — cap ECR at 32 so unranked DSTs get a mid-tier value (~8).
        const dstRank = ecr < 500 ? ecr : 16;
        proj = parseFloat(Math.max(4, 15 - dstRank * 0.6).toFixed(1));
      } else if (ecr < 500) {
        // Skill positions: base ± ECR-scaled drop-off, floored at a minimum.
        const base  = { QB: 26, RB: 22, WR: 20, TE: 16, K: 10 }[pos] ?? 18;
        const slope = { QB: 0.5, RB: 0.5, WR: 0.5, TE: 0.65, K: 0.4 }[pos] ?? 0.5;
        const floor = { QB: 10, RB: 5,  WR: 5,  TE: 5,  K:  4 }[pos] ?? 5;
        proj = parseFloat(Math.max(floor, base - ecr * slope).toFixed(1));
      }
    }

    // tier: new schema has string like "Elite"; old has season_tier
    const tierStr    = (typeof p.tier === 'string' ? p.tier : null) || p.season_tier || null;

    // trend: support both native array and JSON-encoded string
    const rawTrend   = p.trend;
    const trend      = Array.isArray(rawTrend) ? rawTrend
                       : (typeof rawTrend === 'string' && rawTrend.trim().startsWith('['))
                         ? (() => { try { return JSON.parse(rawTrend); } catch { return []; } })()
                         : [];

    result.push({
      id,
      sleeperId,
      masterId:    p.master_player_id || null,
      name,
      pos,
      team:        rawTeam,
      num:         Number(p.number)       || 0,
      age:         Number(p.age)          || 0,
      bye:         Number(p.bye ?? p.bye_week) || BYE_WEEKS_2026[rawTeam] || 0,
      opp:         p.opp                  || '',
      oppRank:     Number(p.oppRank)      || 0,
      proj,
      last:        Number(p.last)         || 0,
      avg:         Number(p.avg)          || proj || 0,
      trend,
      depth:       Number(p.depth)        || 1,
      targetShare: Number(p.targetShare)  || 0,
      routes:      Number(p.routes)       || 0,
      yac:         Number(p.yac)          || 0,
      photoUrl:    p.headshot_url || p.avatar_url || p.photoUrl || null,
      owned,
      adp,
      ecr,
      tier:        tierFromString(tierStr) || Number(p.tier) || 0,
      seasonTier:  tierStr,
      news:        p.news || '',
      status:      injStatusCode(p.injury_status || p.player_status),
    });
  }

  return result;
}
