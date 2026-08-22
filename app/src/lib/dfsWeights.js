// DFS Weights — lets a user weight which signals matter when choosing which
// player to slot into a DraftKings lineup, same UX pattern as the "Sleeper
// Slider" Player Ranking Weights in My Account/Team (AccountEdit.jsx).
//
// Deliberately a SMALLER feature set than the Sleeper Slider's — that one
// draws on the full Players page dataset (NextGen stats, efficiency
// metrics, etc.); the DFS player pool only has what DraftKings itself
// provides (salary, DK's own consensus avg) plus whatever we can match in
// by player name from other R2 exports already used elsewhere in the app.
// Every feature here is something that's actually fetchable — nothing
// invented to pad the list out.

import { getPrefs, patchPrefs } from './remotePrefs.js';

export const DFS_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

const SKILL_FEATURES = [
  { key: 'dkProj',    label: 'DraftKings Projection (AVG)' },
  { key: 'value',     label: 'Salary Value (Pts per $1K)' },
  { key: 'opportunity', label: 'Opportunity Score (Breakout Model)' },
  { key: 'newsSignal', label: 'News/Sleeper Signal (AI)' },
  { key: 'matchup',   label: 'Matchup (Opponent vs Position)' },
  { key: 'leverage',  label: 'Ownership Leverage (favors low-owned)' },
];

// K/DST aren't covered by the breakout-candidate or sleeper-picks models
// (those are skill-position-only), so those two features are omitted
// rather than always silently scoring 0.
const SIMPLE_FEATURES = [
  { key: 'dkProj',  label: 'DraftKings Projection (AVG)' },
  { key: 'value',   label: 'Salary Value (Pts per $1K)' },
  { key: 'matchup', label: 'Matchup (Opponent vs Position)' },
  { key: 'leverage', label: 'Ownership Leverage (favors low-owned)' },
];

export const DFS_POSITION_FEATURES = {
  QB: SKILL_FEATURES, RB: SKILL_FEATURES, WR: SKILL_FEATURES, TE: SKILL_FEATURES,
  K: SIMPLE_FEATURES, DST: SIMPLE_FEATURES,
};

// Default: 100% on DK's own projection, 0% everything else — matches the
// optimizer's prior behavior exactly, so turning this feature on doesn't
// silently change anyone's lineup until they actually move a slider.
function buildDefaultDfsWeights() {
  const result = {};
  for (const pos of DFS_POSITIONS) {
    result[pos] = DFS_POSITION_FEATURES[pos].map(f => ({ ...f, weight: f.key === 'dkProj' ? 100 : 0 }));
  }
  return result;
}

export function loadDfsWeights() {
  try {
    const saved = getPrefs().dfsWeights;
    const defaults = buildDefaultDfsWeights();
    if (!saved) return defaults;
    const result = {};
    for (const pos of DFS_POSITIONS) {
      if (Array.isArray(saved[pos]) && saved[pos].length > 0) {
        const savedKeys = new Set(saved[pos].map(f => f.key));
        const extras = defaults[pos].filter(f => !savedKeys.has(f.key));
        result[pos] = [...saved[pos], ...extras];
      } else {
        result[pos] = defaults[pos];
      }
    }
    return result;
  } catch { return buildDefaultDfsWeights(); }
}

export function saveDfsWeights(weights) {
  patchPrefs({ dfsWeights: weights });
}

export function resetDfsWeights() {
  const defaults = buildDefaultDfsWeights();
  patchPrefs({ dfsWeights: defaults });
  return defaults;
}

function normKey(name) {
  return (name || '').toLowerCase().trim();
}

/** Build name -> value lookup maps once per render, not once per player. */
function buildEnrichmentMaps({ breakoutCandidates, sleeperPicks, defenseVsPos, playerOwnership }) {
  const opportunityByName = new Map();
  for (const b of (Array.isArray(breakoutCandidates) ? breakoutCandidates : [])) {
    if (b.player_name) opportunityByName.set(normKey(b.player_name), Number(b.opportunity_score) || 0);
  }
  const newsByName = new Map();
  for (const s of (Array.isArray(sleeperPicks) ? sleeperPicks : [])) {
    if (s.player_name) newsByName.set(normKey(s.player_name), Math.min(100, (Number(s.value_score) || 0) * 10));
  }
  const rankVsPos = new Map(); // "TEAM|POS" -> rank_vs_pos (1-32, 1 = toughest)
  const posVsPosArr = Array.isArray(defenseVsPos) ? defenseVsPos : (defenseVsPos?.data || []);
  for (const row of posVsPosArr) {
    const team = (row.def_team || row.team || '').toUpperCase();
    const pos = (row.position || row.pos || '').toUpperCase();
    const rank = Number(row.rank_vs_pos ?? row.rank);
    if (team && pos && !Number.isNaN(rank)) rankVsPos.set(`${team}|${pos}`, rank);
  }
  const ownershipByName = new Map();
  const ownershipArr = Array.isArray(playerOwnership) ? playerOwnership : (playerOwnership?.data || playerOwnership?.players || []);
  for (const o of ownershipArr) {
    if (o.player_name) ownershipByName.set(normKey(o.player_name), Number(o.ownership_pct) || 0);
  }
  return { opportunityByName, newsByName, rankVsPos, ownershipByName };
}

/**
 * Percentile-rank a numeric field (0-100) within a group — used only for the
 * two features with no natural 0-100 scale (raw projection, salary value).
 * Everything else is already 0-100 (or transformed to be) at lookup time.
 */
function percentileRank(items, getValue) {
  const withVals = items.map(it => ({ it, v: getValue(it) }));
  const sorted = [...withVals].sort((a, b) => a.v - b.v);
  const n = sorted.length;
  const rankOf = new Map();
  sorted.forEach((entry, i) => {
    rankOf.set(entry.it, n <= 1 ? 100 : Math.round((i / (n - 1)) * 100));
  });
  return rankOf;
}

/**
 * Returns a new pool array with each player's `projection` adjusted by the
 * configured weights. Formula: adjusted = dkProj * (0.5 + composite/100),
 * where composite (0-100) is the weighted sum of this player's percentile/
 * normalized score on each configured feature. A player who's exactly
 * average on every weighted criterion (composite=50) keeps their DK
 * projection unchanged; dominating their position on the weighted criteria
 * pushes toward 1.5x, being weak on all of them pulls toward 0.5x.
 *
 * With the default weights (100% dkProj, 0% else) this is a no-op —
 * composite is just the player's own percentile on dkProj itself, but
 * dkProj * (0.5 + pctile/100) would still shuffle the raw values, so the
 * caller should skip calling this entirely when weights are all-default to
 * guarantee byte-identical behavior to "no DFS weights" mode (see
 * isDefaultWeights below).
 */
export function applyDfsWeights(pool, weights, enrichmentData) {
  const maps = buildEnrichmentMaps(enrichmentData || {});
  const byPos = new Map();
  for (const p of pool) {
    if (!byPos.has(p.position)) byPos.set(p.position, []);
    byPos.get(p.position).push(p);
  }

  const out = [];
  for (const [pos, players] of byPos.entries()) {
    const features = weights[pos] || [];
    const activeFeatures = features.filter(f => (f.weight || 0) > 0);
    if (activeFeatures.length === 0) {
      out.push(...players);
      continue;
    }

    const dkProjRank = percentileRank(players, p => Number(p.projection) || 0);
    const valueRank = percentileRank(players, p => (Number(p.projection) || 0) / Math.max(1, (Number(p.salary) || 1) / 1000));

    for (const p of players) {
      let composite = 0;
      let weightSum = 0;
      for (const f of activeFeatures) {
        let val = 0;
        if (f.key === 'dkProj') val = dkProjRank.get(p) ?? 0;
        else if (f.key === 'value') val = valueRank.get(p) ?? 0;
        else if (f.key === 'opportunity') val = maps.opportunityByName.get(normKey(p.name)) ?? 0;
        else if (f.key === 'newsSignal') val = maps.newsByName.get(normKey(p.name)) ?? 0;
        else if (f.key === 'matchup') {
          const rank = maps.rankVsPos.get(`${(p.opponent || '').toUpperCase()}|${pos}`);
          val = rank != null ? ((32 - rank) / 31) * 100 : 50; // neutral if unknown
        } else if (f.key === 'leverage') {
          const owned = maps.ownershipByName.get(normKey(p.name));
          val = owned != null ? Math.max(0, 100 - owned) : 50; // neutral if unknown
        }
        composite += val * (f.weight || 0);
        weightSum += (f.weight || 0);
      }
      composite = weightSum > 0 ? composite / weightSum : 50;
      const dkProj = Number(p.projection) || 0;
      const adjusted = dkProj * (0.5 + composite / 100);
      out.push({ ...p, projection: Math.round(adjusted * 100) / 100, dkRawProjection: dkProj, dfsCompositeScore: Math.round(composite) });
    }
  }
  return out;
}

export function isDefaultWeights(weights) {
  for (const pos of DFS_POSITIONS) {
    for (const f of (weights[pos] || [])) {
      const isDkProj = f.key === 'dkProj';
      const expected = isDkProj ? 100 : 0;
      if ((f.weight || 0) !== expected) return false;
    }
  }
  return true;
}
