// DFS AI Lineup Analysis — stage one of a two-stage optimizer+critic system:
// the ILP optimizer already picked the mathematically-optimal lineup under
// the salary cap; this module computes a REAL, data-backed metrics record
// for that lineup, then hands it to Qwen to critique (weaknesses,
// correlation, market disagreement) — not to re-pick players.
//
// Deliberately excludes anything that would require fabricating numbers:
// no projected ownership (DraftKings doesn't publish it), no "chalk/
// contrarian player" counts (those are derived from ownership). Every
// metric below traces to a real R2 export.
//
// Floor/Ceiling added 2026-08-22 — empirical 25th/90th percentile from each
// player's actual game log (ingest_floor_ceiling.py), not a simulation.
// Only covers players with a big-enough real sample; players without a
// floor/ceiling entry are simply omitted from the lineup total rather than
// assigned a guessed number.

import { getPrefs, patchPrefs } from './remotePrefs.js';
import { findImpliedGameTotal, findWinProbability } from './kalshi.js';

export const DFS_ANALYSIS_METRICS = [
  { key: 'salary',      label: 'Salary' },
  { key: 'projPoints',  label: 'Projected Points' },
  { key: 'floor',       label: 'Floor (25th %ile, real game log)' },
  { key: 'ceiling',     label: 'Ceiling (90th %ile, real game log)' },
  { key: 'value',       label: 'Value (Pts per $1K)' },
  { key: 'qbStack',     label: 'QB Stack' },
  { key: 'bringBack',   label: 'Bring-Back' },
  { key: 'vegasTotal',  label: 'Vegas Game Total (Kalshi)' },
  { key: 'teamImplied', label: 'Team Implied Total (Kalshi, approx.)' },
  { key: 'injuryRisk',  label: 'Injury Risk' },
  { key: 'weatherRisk', label: 'Weather Risk' },
  { key: 'gameSpread',  label: 'Game Time Spread' },
];

export const DEFAULT_WEATHER_THRESHOLDS = { lowMaxMph: 10, medMaxMph: 20 }; // > medMax = High

function buildDefaultAnalysisSettings() {
  const enabled = {};
  for (const m of DFS_ANALYSIS_METRICS) enabled[m.key] = true;
  return { enabled, weatherThresholds: { ...DEFAULT_WEATHER_THRESHOLDS } };
}

export function loadAnalysisSettings() {
  try {
    const saved = getPrefs().dfsAnalysisSettings;
    const defaults = buildDefaultAnalysisSettings();
    if (!saved) return defaults;
    return {
      enabled: { ...defaults.enabled, ...(saved.enabled || {}) },
      weatherThresholds: { ...defaults.weatherThresholds, ...(saved.weatherThresholds || {}) },
    };
  } catch { return buildDefaultAnalysisSettings(); }
}

export function saveAnalysisSettings(settings) {
  patchPrefs({ dfsAnalysisSettings: settings });
}

export function resetAnalysisSettings() {
  const d = buildDefaultAnalysisSettings();
  patchPrefs({ dfsAnalysisSettings: d });
  return d;
}

function weatherRiskForTeam(weatherForecast, homeTeam, thresholds) {
  const teams = weatherForecast?.teams;
  if (!teams || !homeTeam) return null;
  const entry = teams[homeTeam];
  if (!entry) return null;
  if (entry.is_dome) return { label: 'None (Dome)', windMph: 0 };
  const day = entry.forecast?.[0];
  const hour = day?.hourly?.find(h => h.time === '1300') || day?.hourly?.[0];
  if (!hour) return null;
  const wind = Math.round(hour.wind_mph || 0);
  const label = wind <= thresholds.lowMaxMph ? 'Low' : wind <= thresholds.medMaxMph ? 'Medium' : 'High';
  return { label, windMph: wind };
}

/**
 * Computes the full metrics record for a 9-player optimal lineup.
 * @param lineup  optimized.lineup — [{slot, player}], player has
 *                {name, team, opponent, isHome, salary, projection, status}
 */
export function computeLineupMetrics(lineup, { kalshiMarkets, weatherForecast, weatherThresholds, enabled, floorCeilingData }) {
  const players = lineup.map(l => l.player);
  const salary = players.reduce((s, p) => s + (Number(p.salary) || 0), 0);
  const projPoints = players.reduce((s, p) => s + (Number(p.projection) || 0), 0);
  const value = salary > 0 ? projPoints / (salary / 1000) : 0;

  // Lineup floor/ceiling = sum of each player's own floor/ceiling — only
  // over players who actually have a real sample; anyone missing (rookie,
  // limited history) is excluded from the sum and called out by count
  // rather than assumed to contribute 0.
  const fcList = Array.isArray(floorCeilingData?.players) ? floorCeilingData.players : [];
  const fcByName = new Map(fcList.map(p => [(p.player_name || '').toLowerCase().trim(), p]));
  let floorSum = 0, ceilingSum = 0, fcCoveredCount = 0;
  for (const p of players) {
    const fc = fcByName.get((p.name || '').toLowerCase().trim());
    if (fc) { floorSum += fc.floor_pts; ceilingSum += fc.ceiling_pts; fcCoveredCount++; }
  }

  const qb = lineup.find(l => l.slot === 'QB')?.player || null;
  const qbStackWith = qb ? players.filter(p => p !== qb && p.team === qb.team && ['WR', 'TE'].includes(p.position)) : [];
  const bringBackWith = qb ? players.filter(p => p.team === qb.opponent) : [];

  // Vegas total / implied total — computed per unique game represented in
  // the lineup (a lineup can span multiple games), reported per game.
  const games = new Map(); // "TEAM@OPP" (home-away pair, order-independent key) -> {teamA, teamB}
  for (const p of players) {
    if (!p.team || !p.opponent) continue;
    const key = [p.team, p.opponent].sort().join('|');
    if (!games.has(key)) games.set(key, { teamA: p.team, teamB: p.opponent });
  }
  const vegasByGame = [];
  for (const { teamA, teamB } of games.values()) {
    const total = kalshiMarkets ? findImpliedGameTotal(kalshiMarkets, teamA, teamB) : null;
    vegasByGame.push({ teamA, teamB, total });
  }
  let teamImplied = null;
  if (qb) {
    const gameTotal = vegasByGame.find(g => g.teamA === qb.team || g.teamB === qb.team)?.total;
    if (gameTotal != null) {
      const winProb = kalshiMarkets ? findWinProbability(kalshiMarkets, qb.team, qb.opponent) : null;
      // No confirmed win-prob split -> honest even split, not a guess at direction.
      teamImplied = gameTotal * (winProb != null ? winProb : 0.5);
    }
  }

  const injuryFlags = players.filter(p => p.status && !['none', 'active', ''].includes((p.status || '').toLowerCase()));
  const injuryRiskLabel = injuryFlags.length === 0 ? 'Low' : injuryFlags.length <= 2 ? 'Medium' : 'High';

  const weatherEntries = [];
  const seenTeams = new Set();
  for (const p of players) {
    const homeTeam = p.isHome ? p.team : p.opponent;
    if (!homeTeam || seenTeams.has(homeTeam)) continue;
    seenTeams.add(homeTeam);
    const w = weatherForecast ? weatherRiskForTeam(weatherForecast, homeTeam, weatherThresholds) : null;
    if (w) weatherEntries.push({ team: homeTeam, ...w });
  }
  const worstWeather = weatherEntries.reduce((worst, w) => {
    const rank = { Low: 0, 'None (Dome)': 0, Medium: 1, High: 2 };
    return !worst || rank[w.label] > rank[worst.label] ? w : worst;
  }, null);

  const kickoffs = players.map(p => p.gameStartTime).filter(Boolean).map(t => new Date(t).getTime());
  const uniqueGames = games.size;
  const gameSpreadHours = kickoffs.length > 1 ? Math.round((Math.max(...kickoffs) - Math.min(...kickoffs)) / 3600000 * 10) / 10 : 0;

  const metrics = {
    salary: { value: salary, display: `$${salary.toLocaleString()}` },
    projPoints: { value: projPoints, display: projPoints.toFixed(1) },
    floor: { value: floorSum, display: fcCoveredCount > 0 ? `${floorSum.toFixed(1)} (${fcCoveredCount}/${players.length} players covered)` : 'unknown (no real game-log data for this lineup yet)' },
    ceiling: { value: ceilingSum, display: fcCoveredCount > 0 ? `${ceilingSum.toFixed(1)} (${fcCoveredCount}/${players.length} players covered)` : 'unknown (no real game-log data for this lineup yet)' },
    value: { value, display: `${value.toFixed(2)}x` },
    qbStack: { value: qbStackWith.length > 0, display: qbStackWith.length > 0 ? `Yes (${qb.name} + ${qbStackWith.map(p => p.name).join(', ')})` : 'No' },
    bringBack: { value: bringBackWith.length > 0, display: bringBackWith.length > 0 ? `Yes (${bringBackWith.map(p => p.name).join(', ')})` : 'No' },
    vegasTotal: { value: vegasByGame, display: vegasByGame.map(g => `${g.teamA}/${g.teamB}: ${g.total != null ? g.total : 'unknown'}`).join('; ') || 'unknown' },
    teamImplied: { value: teamImplied, display: teamImplied != null ? teamImplied.toFixed(1) : 'unknown' },
    injuryRisk: { value: injuryRiskLabel, display: injuryFlags.length === 0 ? 'Low (no flagged statuses)' : `${injuryRiskLabel} (${injuryFlags.map(p => `${p.name}: ${p.status}`).join(', ')})` },
    weatherRisk: { value: worstWeather?.label ?? 'unknown', display: worstWeather ? `${worstWeather.label}${worstWeather.windMph ? ` (${worstWeather.windMph}mph, ${worstWeather.team})` : ''}` : 'unknown (no forecast data)' },
    gameSpread: { value: gameSpreadHours, display: `${uniqueGames} game${uniqueGames === 1 ? '' : 's'}${gameSpreadHours ? `, ${gameSpreadHours}h kickoff spread` : ''}` },
  };

  const promptLines = DFS_ANALYSIS_METRICS
    .filter(m => enabled?.[m.key] !== false)
    .map(m => `${m.label}: ${metrics[m.key]?.display ?? 'unknown'}`);

  return { metrics, promptLines };
}
