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

  const seen      = new Set(); // keyed by name
  const seenIds   = new Set(); // keyed by Sleeper player_id string
  const result    = [];

  // Process real-team entries before teamless/corrupt ones so a valid NFL entry always wins
  // the name-based dedup over a corrupt duplicate with an invalid team abbreviation.
  const sortedArr = [
    ...rawArr.filter(p => BYE_WEEKS_2026[p.team]),
    ...rawArr.filter(p => !BYE_WEEKS_2026[p.team]),
  ];

  for (const p of sortedArr) {
    // Support both camelCase (new export) and snake_case (old schema)
    const isDraftable = p.isDraftable ?? p.is_draftable;
    if (isDraftable === false || isDraftable === 'false') continue;

    const rawPos  = p.position || p.pos;
    const rawTeam = p.team;
    // Only accept the 32 real NFL team abbreviations. Anything else (FA, UNK, corrupt values
    // like "TEPHI") is treated as teamless. BYE_WEEKS_2026 keys are exactly the 32 teams.
    const isTeamless = !rawTeam || !BYE_WEEKS_2026[rawTeam];
    if (isTeamless) {
      // Keep free agents / unknowns only if they have evidence of NFL relevance
      const hasRank  = Number(p.positionRank || p.position_rank || p.search_rank || p.ecr) > 0;
      const hasGames = Number(p.games_played_2025 || p.games_played) > 0;
      if (!hasRank && !hasGames) continue;
    }
    // Map source positions to canonical set; reject anything unexpected.
    // Use fantasy_positions only as a fallback when `position` is absent or unrecognised —
    // NOT as an override when `position` is already a valid canonical value.  Overriding
    // caused QBs with stale/multi-value fantasy_positions arrays (e.g. ["WR","QB"]) to be
    // misclassified as WR.
    let pos = rawPos === 'DEF' ? 'DST' : (rawPos || '');
    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(pos)) {
      // position field is missing or unrecognised — try fantasy_positions as rescue
      const fp0 = Array.isArray(p.fantasy_positions) ? p.fantasy_positions[0] : null;
      if (fp0) pos = fp0 === 'DEF' ? 'DST' : fp0;
    }

    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(pos)) continue;

    let name;
    if (pos === 'DST') {
      if (isTeamless) continue; // DST without a real team is meaningless
      name = `${rawTeam.toUpperCase()} D/ST`;
    } else {
      name = (p.full_name || p.name || p.player_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).trim();
      if (!name) continue;
      // Guard: if a non-DST entry somehow has a D/ST-style name, treat it as DST
      if (/\bd\/st\b/i.test(name)) {
        pos  = 'DST';
        name = `${rawTeam.toUpperCase()} D/ST`;
      }
    }

    const nameKey = name.toLowerCase().trim();

    // Secondary dedup: when both first_name and last_name are present, also index by
    // "firstname lastname" so the same player doesn't slip through when one source uses
    // full_name and another uses first_name + last_name with different formatting.
    const fnlnKey = pos !== 'DST' && p.first_name && p.last_name
      ? `${p.first_name.toLowerCase().trim()} ${p.last_name.toLowerCase().trim()}`
      : null;

    if (seen.has(nameKey)) continue;
    if (fnlnKey && fnlnKey !== nameKey && seen.has(fnlnKey)) continue;

    // Tertiary dedup: same Sleeper player_id in the same source file means the same player
    // regardless of minor name formatting differences (e.g. "Geno Smith" vs "Geno C Smith").
    const sleeperId  = p.playerId || p.player_id || p.id || null;
    const sleeperKey = sleeperId ? String(sleeperId) : null;
    if (sleeperKey && seenIds.has(sleeperKey)) continue;

    seen.add(nameKey);
    if (fnlnKey && fnlnKey !== nameKey) seen.add(fnlnKey);
    if (sleeperKey) seenIds.add(sleeperKey);
    const stableId   = idByName.get(nameKey);
    const id         = stableId ?? (Number(sleeperId) || 10000 + result.length);

    // proj: R2 export uses season_avg_points_2025; older schemas use proj / projected_avg_points
    const projRaw    = Number(p.proj) || Number(p.projected_avg_points)
                    || Number(p.season_avg_points_2025) || Number(p.career_ppg) || 0;
    // ECR: use positionRank → p.ecr → 999. Never use search_rank (Sleeper popularity index, not a rank).
    let posRank    = Number(p.positionRank || p.position_rank) || null;
    const searchRank = Number(p.ecr) || null;
    // DST positionRank is positional (1-32) — convert to overall
    if (pos === 'DST' && posRank && posRank <= 32) {
      posRank = 150 + (posRank - 1) * 3;
    }
    const ecr        = posRank ?? searchRank ?? 999;
    // Accept any ADP field name used across our data sources:
    //   adp           — legacy/Sleeper field
    //   adp_ppr       — export_players_2026_draft / player_profiles (PPR value)
    //   adp_rank_ppr  — integer rank from same tables
    //   adp_value     — adp_ppr.json / adp_standard.json dedicated files
    //   adp_rank      — integer rank from same files
    let adpRaw = Number(p.adp) || Number(p.adp_ppr) || Number(p.adp_rank_ppr)
                 || Number(p.adp_value) || Number(p.adp_rank) || 0;
    // DST adp_rank is positional (1-32) — convert to overall draft position
    if (pos === 'DST' && adpRaw > 0 && adpRaw <= 32) {
      adpRaw = 150 + (adpRaw - 1) * 3;
    }
    // search_rank is Sleeper's popularity rank, NOT a draft position — never use it as ADP
    const adp    = adpRaw || 999;
    const searchRk   = Number(p.search_rank) || 0;
    const owned      = Number(p.owned) || (searchRk > 0
      ? Math.max(0, parseFloat((100 - searchRk * 0.15).toFixed(1)))
      : ecr < 999
        ? Math.max(0, parseFloat((100 - ecr * 0.28).toFixed(1)))
        : 0);

    // Proj: if we have real stats data (season_avg_points_2025), use it directly.
    // Otherwise fall back to ECR-based estimate (used when only Sleeper data is available).
    let proj = projRaw;
    if (proj === 0) {
      if (pos === 'DST') {
        const dstRank = ecr < 500 ? ecr : 16;
        proj = parseFloat(Math.max(4, 15 - dstRank * 0.6).toFixed(1));
      } else if (ecr < 500) {
        const base  = { QB: 26, RB: 22, WR: 20, TE: 16, K: 10 }[pos] ?? 18;
        const slope = { QB: 0.5, RB: 0.5, WR: 0.5, TE: 0.65, K: 0.4 }[pos] ?? 0.5;
        const floor = { QB: 10, RB: 5,  WR: 5,  TE: 5,  K:  4 }[pos] ?? 5;
        proj = parseFloat(Math.max(floor, base - ecr * slope).toFixed(1));
      }
    }

    // tier: new schema has string like "Elite"; R2 export uses draft_tier (e.g. "QB1"); old has season_tier
    const tierStr    = (typeof p.tier === 'string' ? p.tier : null) || p.draft_tier || p.season_tier || null;

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
      last:        Number(p.last_pts) || Number(p.last) || Number(p.avg_fantasy_points_per_game_2025) || 0,
      avg:         Number(p.season_avg_points_2025) || Number(p.avg) || Number(p.career_ppg) || 0,
      pts2025:     Number(p.total_fantasy_points_2025) || Number(p.season_total_points_2025) || 0,
      rookie:      p.pos !== 'DST' && (p.is_rookie === true || p.is_rookie === 'true' || (p.years_exp != null && Number(p.years_exp) === 0)),
      trend,
      depth:       Number(p.depth)        || 1,
      targetShare: Number(p.targetShare || p.target_share) || 0,
      routes:      Number(p.routes)       || 0,
      yac:         Number(p.yac)          || 0,
      adot:        Number(p.adot)         || null,
      airYds:      Number(p.airYds || p.air_yards) || null,
      avgSnaps:    Number(p.avg_snaps || p.avgSnaps) || null,
      snapPct:     Number(p.snap_pct || p.snapPct) || null,
      avgTargetsG: Number(p.avg_targets_g || p.avgTargetsG) || null,
      avgCarriesG: Number(p.avg_carries_g || p.avgCarriesG) || null,
      avgRzAttG:   Number(p.avg_rz_att_g || p.avgRzAttG) || null,
      comboYdsG:   Number(p.combo_yds_g || p.comboYdsG) || null,
      yptgt:       Number(p.yds_per_tgt || p.yptgt) || null,
      tgtG:        Number(p.avg_targets_g || p.tgtG) || null,
      attG:        Number(p.avg_carries_g || p.attG) || null,
      forty:       Number(p.forty) || null,
      vertical:    Number(p.vertical) || null,
      broadJump:   Number(p.broad_jump || p.broadJump) || null,
      benchPress:  Number(p.bench_press || p.benchPress) || null,
      combineWt:   Number(p.combine_weight || p.combineWt) || null,
      cone:        Number(p.cone) || null,
      shuttle:     Number(p.shuttle) || null,
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

  // ECR starts at 999 for all players; the async ECR patch (ecr_ppr.json / ecr_std.json)
  // sets real FantasyPros ranks after normalizePlayerList returns. Never derive fake ranks
  // from proj here — that produced duplicate #1s when players without stats sorted
  // alphabetically and collided with the real #1 from the ECR patch.

  return result;
}
