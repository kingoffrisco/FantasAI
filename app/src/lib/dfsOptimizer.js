// DraftKings Classic NFL lineup optimizer — true ILP via javascript-lp-solver.
//
// Roster rules verified live against DK's own rules endpoint 2026-08-22
// (GET https://api.draftkings.com/lineups/v1/gametypes/1/rules):
//   $50,000 salary cap, 9 players: QB(1) RB(2) WR(3) TE(1) FLEX(1: RB/WR/TE) DST(1)
//
// Standard DFS ILP formulation — no explicit slot-assignment variables needed:
// QB==1, DST==1, RB>=2, WR>=3, TE>=1, total==9. Because 1+1+2+3+1=8, the 9th
// selected player is necessarily the FLEX and is guaranteed to be RB/WR/TE by
// the >= constraints. Slot labels (which specific player is "FLEX") are then
// just a display-time grouping of the solved result, not part of the model.

import solver from 'javascript-lp-solver';

export const DK_SALARY_CAP = 50000;
export const DK_MIN_GAMES = 2; // DK rule: lineup must include players from at least 2 different games
const CORE_MIN = { QB: 1, RB: 2, WR: 3, TE: 1, DST: 1 };
const ELIGIBLE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DST'];

// Matchup key independent of which side (home/away) a player is on, so both
// teams in a game collapse to the same group.
function gameKey(p) {
  if (!p.team || !p.opponent) return `__unknown_${p.id}`;
  return [p.team, p.opponent].sort().join('|');
}

function eligiblePool(players, excludeIds) {
  return (players || []).filter(p =>
    ELIGIBLE_POSITIONS.includes(p.position) &&
    Number(p.salary) > 0 &&
    !excludeIds.has(p.id)
  );
}

/**
 * Solves one ILP lineup against an already-filtered pool. extraConstraints /
 * extraVariableTags let callers (optimizeDiverseLineups) bolt on additional
 * linear constraints — e.g. "share at most N players with a prior lineup" —
 * without duplicating the whole model-building logic.
 */
function solveOnce(pool, { lockIds = new Set(), extraConstraints = {}, extraVariableTags = {}, objectiveKey = 'projection' } = {}) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
  for (const p of pool) counts[p.position] += 1;
  const missing = Object.entries(CORE_MIN).filter(([pos, min]) => counts[pos] < min);
  if (missing.length > 0) {
    return {
      feasible: false,
      reason: `Not enough players in the pool: need at least ${missing.map(([pos, min]) => `${min} ${pos}`).join(', ')}.`,
    };
  }

  const gameGroups = new Map(); // gameKey -> player ids
  for (const p of pool) {
    const key = gameKey(p);
    if (!gameGroups.has(key)) gameGroups.set(key, []);
    gameGroups.get(key).push(p.id);
  }
  if (gameGroups.size < DK_MIN_GAMES) {
    return {
      feasible: false,
      reason: `DK requires players from at least ${DK_MIN_GAMES} different games — this pool only spans ${gameGroups.size}.`,
    };
  }

  const variables = {};
  const binaries = {};
  for (const p of pool) {
    variables[p.id] = {
      points:  Number(p[objectiveKey]) || 0,
      salary:  Number(p.salary),
      qb:  p.position === 'QB'  ? 1 : 0,
      rb:  p.position === 'RB'  ? 1 : 0,
      wr:  p.position === 'WR'  ? 1 : 0,
      te:  p.position === 'TE'  ? 1 : 0,
      dst: p.position === 'DST' ? 1 : 0,
      total: 1,
      [`game_${gameKey(p)}`]: 1,
      ...(extraVariableTags[p.id] || {}),
    };
    binaries[p.id] = 1;
  }

  const constraints = {
    salary: { max: DK_SALARY_CAP },
    qb:     { equal: 1 },
    rb:     { min: CORE_MIN.RB },
    wr:     { min: CORE_MIN.WR },
    te:     { min: CORE_MIN.TE },
    dst:    { equal: 1 },
    total:  { equal: 9 },
    ...extraConstraints,
  };

  // Enforce "players from at least DK_MIN_GAMES different games" by capping
  // any single game's contribution at (9 - DK_MIN_GAMES + 1) — with the
  // standard 9-player roster and DK_MIN_GAMES=2, that's <= 8, which just
  // rules out an all-one-game lineup. Only matters on small slates (e.g. a
  // 4-game preseason night) where the ILP might otherwise concentrate value
  // into one high-scoring matchup.
  const maxPerGame = 9 - DK_MIN_GAMES + 1;
  for (const key of gameGroups.keys()) {
    constraints[`game_${key}`] = { max: maxPerGame };
  }

  // Locked players: force selection via a per-player equality constraint (>=1 -> must be 1 since binary).
  for (const id of lockIds) {
    if (variables[id]) constraints[`lock_${id}`] = { min: 1 };
    if (variables[id]) variables[id][`lock_${id}`] = 1;
  }

  const model = { optimize: 'points', opType: 'max', constraints, variables, binaries };
  const result = solver.Solve(model);

  if (!result || !result.feasible) {
    return { feasible: false, reason: 'No valid lineup exists under the salary cap with the current pool/locks/exclusions.' };
  }

  const lineup = pool.filter(p => Math.round(result[p.id] || 0) === 1);
  const round2 = n => Math.round(n * 100) / 100;
  // totalProjection always reflects real DK/weighted projection, regardless
  // of what the solve actually optimized for (points/leverageScore/ceiling)
  // — so every generated lineup can be compared on the same basis. ceiling/
  // ownership totals are informational only when that data exists on the
  // pool; a player missing it just doesn't contribute (not assumed 0).
  const withCeiling = lineup.filter(p => p.ceiling != null);
  const withOwnership = lineup.filter(p => p.ownership != null);
  return {
    feasible: true,
    lineup: assignSlots(lineup),
    totalSalary: lineup.reduce((s, p) => s + Number(p.salary), 0),
    totalProjection: round2(lineup.reduce((s, p) => s + (Number(p.projection) || 0), 0)),
    totalCeiling: withCeiling.length ? round2(withCeiling.reduce((s, p) => s + Number(p.ceiling), 0)) : null,
    ceilingCoverage: withCeiling.length,
    avgOwnership: withOwnership.length ? round2(withOwnership.reduce((s, p) => s + Number(p.ownership), 0) / withOwnership.length) : null,
    ownershipCoverage: withOwnership.length,
    salaryCap: DK_SALARY_CAP,
    remainingSalary: DK_SALARY_CAP - lineup.reduce((s, p) => s + Number(p.salary), 0),
  };
}

/**
 * @param {Array<{id, name, team, opponent, position, salary, projection, status}>} players
 * @param {{excludeIds?: Set<string|number>, lockIds?: Set<string|number>}} [opts]
 */
export function optimizeLineup(players, opts = {}) {
  const { excludeIds = new Set(), lockIds = new Set() } = opts;
  const pool = eligiblePool(players, excludeIds);
  return solveOnce(pool, { lockIds });
}

// Default per-lineup objective sequence: pure points, then leverage
// (points discounted by ownership — rewards low-owned production), then
// ceiling (90th-percentile real game-log outcome). A player missing
// leverageScore/ceiling data falls back to plain projection for that
// solve (neutral, not fabricated high/low) — see DfsOptimizer.jsx where
// these fields get attached to the pool before calling this.
const DEFAULT_STRATEGIES = ['projection', 'leverageScore', 'ceiling'];

/**
 * Generates up to `count` distinct lineups from the same (already
 * weight-adjusted) pool, each required to differ from every earlier one by
 * at least `minDiff` players. Re-solves the ILP once per lineup, each time
 * adding a "share at most (9 - minDiff) players with lineup i" constraint
 * for every prior lineup — so lineup 2 is still the best lineup available
 * that's meaningfully different from lineup 1, not a random variation.
 * Stops early (returns fewer than `count`) if no sufficiently different
 * lineup exists under the cap/locks — a small slate may only support 1-2.
 *
 * `config.strategies` picks what each successive lineup optimizes for —
 * e.g. ['projection', 'leverageScore', 'ceiling'] for Optimal / Non-Chalk /
 * Best Ceiling. Diversity is still enforced against every prior lineup
 * regardless of strategy, so lineup 2 isn't just "best ceiling" in a
 * vacuum, it's "best ceiling that's also meaningfully different from the
 * optimal lineup."
 *
 * @param {Array} players
 * @param {{excludeIds?: Set, lockIds?: Set}} [opts]
 * @param {{count?: number, minDiff?: number, strategies?: string[]}} [config]
 * @returns {Array<ReturnType<typeof optimizeLineup>>}
 */
export function optimizeDiverseLineups(players, opts = {}, config = {}) {
  const { excludeIds = new Set(), lockIds = new Set() } = opts;
  const { count = 3, minDiff = 2, strategies = DEFAULT_STRATEGIES } = config;
  const pool = eligiblePool(players, excludeIds);

  const results = [];
  const priorLineups = []; // arrays of player ids
  for (let i = 0; i < count; i++) {
    const extraConstraints = {};
    const extraVariableTags = {};
    priorLineups.forEach((prevIds, idx) => {
      const key = `diverse_${idx}`;
      extraConstraints[key] = { max: 9 - minDiff };
      for (const id of prevIds) {
        extraVariableTags[id] = { ...(extraVariableTags[id] || {}), [key]: 1 };
      }
    });
    const objectiveKey = strategies[i] || 'projection';
    const result = solveOnce(pool, { lockIds, extraConstraints, extraVariableTags, objectiveKey });
    results.push(result);
    if (!result.feasible) break; // no more sufficiently-different lineups available
    priorLineups.push(result.lineup.map(l => l.player.id));
  }
  return results;
}

/** Label each selected player with its DK roster slot (QB, RB1, RB2, WR1-3, TE, FLEX, DST). */
function assignSlots(lineup) {
  const byPos = pos => lineup.filter(p => p.position === pos).sort((a, b) => (b.projection || 0) - (a.projection || 0));
  const qb  = byPos('QB');
  const rb  = byPos('RB');
  const wr  = byPos('WR');
  const te  = byPos('TE');
  const dst = byPos('DST');

  let flex = null;
  if (rb.length > CORE_MIN.RB) flex = rb.pop();
  else if (wr.length > CORE_MIN.WR) flex = wr.pop();
  else if (te.length > CORE_MIN.TE) flex = te.pop();

  const slots = [
    { slot: 'QB', player: qb[0] },
    { slot: 'RB', player: rb[0] },
    { slot: 'RB', player: rb[1] },
    { slot: 'WR', player: wr[0] },
    { slot: 'WR', player: wr[1] },
    { slot: 'WR', player: wr[2] },
    { slot: 'TE', player: te[0] },
    { slot: 'FLEX', player: flex },
    { slot: 'DST', player: dst[0] },
  ];
  return slots.filter(s => s.player);
}
